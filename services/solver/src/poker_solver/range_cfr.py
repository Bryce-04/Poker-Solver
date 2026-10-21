"""Range-vs-range Discounted CFR for one postflop street -- the replacement for
postflop_mccfr.py's Monte-Carlo trainer.

Why it exists (docs/decisions.md, 2026-10-07): postflop_mccfr.py samples
one hole-card combo per player per iteration, so with realistic ~500-combo
ranges each combo is only visited on the rare iterations chance picks it.
At the production setting of 4,000 iterations that left strategies mostly
noise -- e.g. K6s jamming 96bb into a 4bb pot 8% of the time when the
converged answer is ~0%, and still visibly drifting after 200,000
iterations. This trainer never samples hole cards: every combo in both
ranges gets a strategy at every node on every iteration, weighted by how
likely it is to have reached that node, with equity against the whole
opposing range taken from an exact precomputed matrix (equity.py). That's
the standard approach every serious open-source solver takes.

Update rule is Discounted CFR (Brown & Sandholm, "Solving Imperfect-
Information Games via Discounted Regret Minimization") and alternating
player updates. CFR+ was implemented first and measured head to head on
the wide-range regression scenario below: DCFR reached 1.1% of the pot in
exploitability at 100 iterations (CFR+: 2.4%) and 0.35% at 200 (CFR+:
1.2%) -- roughly 2-3x fewer iterations for the same precision, for a few
extra lines. The discount parameters are alpha=1.5, beta=0.5, gamma=3
(the paper recommends 1.5 / 0 / 2; postflop-solver uses gamma=3): swept
on eight spots (benchmarks/sweep_dcfr.py), that setting reached the same
precision in up to a third of the iterations on wide flops -- the slow
case -- and was level elsewhere. See docs/decisions.md, 2026-10-21.

Game model is unchanged from postflop_mccfr.py: betting_round.py's state
machine for one street, then -- if nobody folds -- the rest of the board
runs out with no further betting and the hand goes to showdown. The
equity matrix encodes exactly that.
"""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np

from .betting_round import DEFAULT_BET_MENU, BetMenu, BettingRoundState
from .combos import Combo, combo_key, expand_range, label_to_combos
from .equity import compute_equity_matrix

# DCFR discount parameters (see the module docstring for why these differ from
# Brown & Sandholm's recommended 1.5 / 0 / 2).
_DCFR_ALPHA = 1.5
_DCFR_BETA = 0.5
_DCFR_GAMMA = 3.0

# posterior_ranges collapses a label's combos back into one label weight when
# they all agree to within this FRACTION of the label's heaviest combo. Relative,
# not absolute: a narrowed range isn't normalized (a rarely taken line scales
# every weight down, to ~1e-4), and an absolute tolerance would call every
# combo of such a line "equal" and throw away the suit differences it exists
# to keep.
_COLLAPSE_TOLERANCE = 1e-3


@dataclass
class RangeSpotConfig:
    """Same shape as postflop_mccfr.PostflopSpotConfig, so apps/api's call
    site barely changes. first_to_act is whoever acts once prior_history
    has played out (see BettingRoundState.initial)."""

    board: tuple[int, ...]  # 3 (flop), 4 (turn), or 5 (river) cards
    pot_bb: float
    effective_stack_bb: float
    range0: dict[str, float]
    range1: dict[str, float]
    first_to_act: int = 0
    prior_history: tuple[str, ...] = ()
    # What a bet or raise can be on this street (betting_round.BetMenu); the
    # default is the fixed 25 / 75 / 125 / all-in menu.
    bet_menu: BetMenu = DEFAULT_BET_MENU

    def __post_init__(self) -> None:
        if len(self.board) not in (3, 4, 5):
            raise ValueError(
                f"board must be 3 (flop), 4 (turn), or 5 (river) cards, got {len(self.board)}"
            )


def _expand(range_weights: dict[str, float], blocked: frozenset[int]) -> tuple[list[Combo], np.ndarray, list[str]]:
    """Like combos.expand_range_to_combos, but also keeps each combo's
    169-type label so strategies can be rolled back up per label. Handles
    specific-combo keys ('AhKh') as well as labels (combos.expand_range)."""
    expanded = expand_range(range_weights, blocked)
    if not expanded:
        raise ValueError("range has no combos left after removing blocked cards")
    combos, weights, labels = (list(column) for column in zip(*expanded))
    return combos, np.array(weights, dtype=np.float64), labels


class _PublicNode:
    """One public betting history. Holds a regret and a strategy-sum row
    for EVERY combo of the acting player at once, rather than one
    _InfoSetNode per (combo, history) the way postflop_mccfr.py does.

    `regret`, `strategy_sum` and `current` (the regret-matched strategy the
    node plays this iteration) are not arrays of their own: they are views into
    the acting player's _PlayerStore, one column slice each, so the whole tree
    can be updated with a few array operations instead of a few dozen per node."""

    __slots__ = ("actions", "actor", "index", "children", "slot", "col0", "regret", "strategy_sum", "current")

    def __init__(self, actions: tuple[str, ...], actor: int, index: int) -> None:
        self.actions = actions
        self.actor = actor
        self.index = index
        # Child references, one per action: >= 0 is another decision node's
        # index, < 0 is the terminal ~ref (so -1 is terminal 0).
        self.children: tuple[int, ...] = ()
        # Set by RangeCfrTrainer._allocate: this node's position among its
        # player's nodes, its first column in that player's arrays, and the views.
        self.slot = self.col0 = -1

    @staticmethod
    def _normalize(weights: np.ndarray) -> np.ndarray:
        totals = weights.sum(axis=1, keepdims=True)
        uniform = 1.0 / weights.shape[1]
        return np.where(totals > 0, weights / np.where(totals > 0, totals, 1.0), uniform)

    def current_strategy(self) -> np.ndarray:
        return self.current

    def average_strategy(self) -> np.ndarray:
        return self._normalize(self.strategy_sum)


class _PlayerStore:
    """One player's decision nodes' training state, side by side: regrets,
    strategy sums and current strategies as (combos x total actions) arrays in
    which each node owns a contiguous run of columns. Plus the index arrays that
    let one expression act on every node at once, and scratch buffers a pass fills."""

    __slots__ = (
        "nodes", "regret", "strategy_sum", "current", "starts", "column_node",
        "inv_actions", "action_values", "node_value", "own_reach",
    )

    def __init__(self, nodes: list[_PublicNode], combos: int) -> None:
        sizes = np.array([len(n.actions) for n in nodes], dtype=np.intp)
        total = int(sizes.sum())
        self.nodes = nodes
        # Where each node's columns start, and which node each column belongs to.
        self.starts = np.concatenate([[0], np.cumsum(sizes)[:-1]]).astype(np.intp) if nodes else sizes
        self.column_node = np.repeat(np.arange(len(nodes), dtype=np.intp), sizes)
        self.inv_actions = 1.0 / np.repeat(sizes, sizes) if nodes else np.zeros(0)
        self.regret = np.zeros((combos, total))
        self.strategy_sum = np.zeros((combos, total))
        self.current = np.tile(self.inv_actions, (combos, 1))  # zero regret = uniform
        self.action_values = np.empty((combos, total))
        self.node_value = np.empty((combos, len(nodes)))
        self.own_reach = np.empty((combos, len(nodes)))
        for slot, (node, start, size) in enumerate(zip(nodes, self.starts, sizes)):
            node.slot, node.col0 = slot, int(start)
            columns = slice(int(start), int(start + size))
            node.regret = self.regret[:, columns]
            node.strategy_sum = self.strategy_sum[:, columns]
            node.current = self.current[:, columns]

    def normalize(self, weights: np.ndarray) -> np.ndarray:
        """Each node's columns normalized to sum to 1 per combo (rows with no
        weight fall back to uniform) -- _PublicNode._normalize, for every node at once."""
        if weights.shape[1] == 0:
            return weights.copy()
        totals = np.add.reduceat(weights, self.starts, axis=1)[:, self.column_node]
        positive = totals > 0
        return np.where(positive, weights / np.where(positive, totals, 1.0), self.inv_actions)


class RangeCfrTrainer:
    """Trains (and measures) one street's range-vs-range game.

    Speed notes, in the order they were found by profiling (docs/decisions.md,
    2026-10-21; tests/reference_range_cfr.py is the unoptimized original and
    test_range_cfr_matches_reference.py holds this class to its answers):

      * The game tree is built ONCE, in __init__, as plain arrays of node and
        terminal records. The original rebuilt a BettingRoundState (a frozen
        dataclass) for every visit of every node, every iteration.
      * A pass over the tree is three phases, not one recursion: top-down, each
        node's reach vectors; then ALL of the pass's terminals evaluated in one
        matrix multiply (the equity matrix against every terminal's opponent-
        reach vector at once -- one pass over the matrix instead of ~150); then
        bottom-up, values and regret updates.
      * "How much opponent weight can I be facing" (the matrix's second half
        in the original) is counted with per-card sums and inclusion-exclusion,
        O(combos) instead of a second matrix product -- the same blocker trick
        postflop-solver (b-inary) uses for its fold and showdown evaluation.
      * Regret-matched strategies are cached and refreshed only when regrets
        change, and every node's regrets, strategy sums and strategies live in
        three contiguous arrays per player (a node owns a column slice), so the
        DCFR update and the regret matching for the WHOLE tree are a handful of
        array operations rather than ~25 numpy calls per node.
      * Terminals that share an opponent-reach vector (the fold and the call under
        one decision) share one column of the matrix multiply.
    """

    def __init__(self, config: RangeSpotConfig) -> None:
        self._config = config
        blocked = frozenset(config.board)
        combos0, weights0, labels0 = _expand(config.range0, blocked)
        combos1, weights1, labels1 = _expand(config.range1, blocked)
        self.combos = (combos0, combos1)
        self.weights = (weights0, weights1)
        self.labels = (labels0, labels1)

        equity = compute_equity_matrix(combos0, combos1, config.board)
        # NaN marks pairs that share a card -- they can never be dealt
        # together, so they carry no weight at all (never "hero loses").
        possible = (~np.isnan(equity)).astype(np.float64)
        win0 = np.where(np.isnan(equity), 0.0, equity)
        # Per player p, a stacked matrix taking the opponent's reach vector to
        # [equity-weighted share p wins at showdown; total opponent weight p
        # could be facing] for each of p's combos. Training uses only the top
        # half (`_win`, a view; the bottom half is computed by card counting,
        # `_mass_vs`); combo_equities uses both. float32 halves memory traffic
        # (the product is the hot loop); regrets and strategy sums stay float64.
        self._payoff = (
            np.vstack([win0, possible]).astype(np.float32),
            np.vstack([(possible - win0).T, possible.T]).astype(np.float32),
        )
        self._win = (
            self._payoff[0][: len(combos0)],
            self._payoff[1][: len(combos1)],
        )
        self._chance_mass = float(weights0 @ possible @ weights1)
        if self._chance_mass <= 0:
            raise ValueError("no possible deal: every combo pair shares a card")
        self._blockers = tuple(self._build_blockers(p) for p in (0, 1))

        self._root = BettingRoundState.initial(
            config.pot_bb,
            config.effective_stack_bb,
            config.first_to_act,
            config.prior_history,
            config.bet_menu,
        )
        self._nodes: dict[tuple[str, ...], _PublicNode] = {}
        self._decisions: list[_PublicNode] = []  # preorder: a parent precedes its children
        self._terminal_pot: list[float] = []
        self._terminal_contrib: list[tuple[float, float]] = []
        self._terminal_fold_winner: list[int] = []  # the non-folder's seat, or -1 for a showdown
        self._build_tree(self._root)
        self._terminal_arrays = self._terminal_tables()
        self._stores = tuple(
            _PlayerStore([n for n in self._decisions if n.actor == player], len(self.combos[player]))
            for player in (0, 1)
        )
        self.iterations = 0

    # --- setup ----------------------------------------------------------

    def _build_tree(self, state: BettingRoundState) -> int:
        """Builds the node and terminal records under `state`; returns its
        child reference (see _PublicNode.children)."""
        if state.is_terminal():
            self._terminal_pot.append(state.pot_bb + state.contributed[0] + state.contributed[1])
            self._terminal_contrib.append(state.contributed)
            # apply() has already flipped to_act to the non-folder on a fold.
            self._terminal_fold_winner.append(state.to_act if state.history[-1] == "fold" else -1)
            return ~(len(self._terminal_pot) - 1)
        node = _PublicNode(state.legal_actions(), state.to_act, len(self._decisions))
        self._decisions.append(node)
        self._nodes[state.history] = node
        node.children = tuple(self._build_tree(state.apply(action)) for action in node.actions)
        return node.index

    def _terminal_tables(self) -> tuple:
        """Per player and terminal, the two coefficients that turn the opponent
        masses into a value: value = alpha * (equity-weighted mass won) + beta *
        (mass faced). A showdown is pot * win - own * facing; a fold is
        (share - own) * facing, where the share is the WHOLE pot for the
        non-folder (dead money from earlier streets included -- see
        betting_round.terminal_utility) and nothing for the folder. Shapes (T,)."""
        pot = np.array(self._terminal_pot)
        winner = np.array(self._terminal_fold_winner)
        contrib = np.array(self._terminal_contrib)  # (T, 2)
        is_fold = winner >= 0
        per_player = []
        for player in (0, 1):
            own = contrib[:, player]
            fold_share = np.where(winner == player, pot, 0.0)
            alpha = np.where(is_fold, 0.0, pot)
            beta = np.where(is_fold, fold_share - own, -own)
            per_player.append((alpha[:, None], beta[:, None]))
        return tuple(per_player)

    def _build_blockers(self, player: int) -> tuple:
        """What `_mass_vs` needs to count, for each of `player`'s combos, the
        opponent weight it is NOT blocked from: its two cards, an opponent-
        combo-by-card incidence matrix, and each combo's identical twin in
        the opponent range (if there is one)."""
        mine, theirs = self.combos[player], self.combos[1 - player]
        own_cards = np.array(mine, dtype=np.intp)  # (n, 2)
        incidence = np.zeros((len(theirs), 52))
        for j, (a, b) in enumerate(theirs):
            incidence[j, a] = incidence[j, b] = 1.0
        # Keyed by the sorted pair: the same two cards can be listed in either
        # order (a pair built from a label vs. from a specific-combo key).
        index_of = {tuple(sorted(combo)): j for j, combo in enumerate(theirs)}
        same = np.array(
            [index_of.get(tuple(sorted(combo)), len(theirs)) for combo in mine], dtype=np.intp
        )
        return own_cards[:, 0], own_cards[:, 1], incidence, same

    @property
    def root(self) -> BettingRoundState:
        return self._root

    # --- evaluating terminals -------------------------------------------

    def _mass_rows(self, player: int, rows: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """For each of `player`'s combos and each ROW of `rows` (a (T, opponent
        combos) array of reach weights): the equity-weighted opponent mass it wins
        at showdown, and the total opponent mass it could be facing (combos
        sharing a card excluded). Shapes (T, own combos).

        The win mass is one matrix multiply. The facing mass needs no matrix:
        total reach, minus the reach of opponent combos holding either of my
        two cards, plus back the combo identical to mine (it was subtracted
        for both cards). Inclusion-exclusion over a 52-card table. One row per
        terminal (rather than one column) keeps each terminal's values
        contiguous, which is what the gathers and the bottom-up pass want."""
        matrix = self._win[player]
        win = (rows.astype(matrix.dtype, copy=False) @ matrix.T).astype(np.float64)
        first, second, incidence, same = self._blockers[player]
        per_card = rows @ incidence  # (T, 52): reach of opponent combos holding each card
        padded = np.concatenate([rows, np.zeros((rows.shape[0], 1))], axis=1)  # column m = "no identical twin"
        facing = rows.sum(axis=1)[:, None] - per_card[:, first] - per_card[:, second] + padded[:, same]
        return win, facing

    def _mass_vs(self, player: int, vectors: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """_mass_rows for callers holding the vectors as columns: `vectors` is
        (opponent combos, T) and the masses come back (own combos, T)."""
        win, facing = self._mass_rows(player, np.ascontiguousarray(vectors.T))
        return win.T, facing.T

    # --- one pass over the tree ------------------------------------------

    def _pass(self, player: int, *, train: bool) -> np.ndarray:
        """One traversal for `player`. With train=True: both players play their
        current strategies, `player`'s regrets and strategy sums are updated
        (DCFR), and its strategies refreshed. With train=False: the opponent
        plays its AVERAGE strategy and `player` best-responds -- the
        exploitability measure. Returns `player`'s per-combo value at the root."""
        decisions = self._decisions
        mine, theirs = self._stores[player], self._stores[1 - player]
        opp: list[np.ndarray | None] = [None] * len(decisions)
        own: list[np.ndarray | None] = [None] * len(decisions)
        opp[0] = self.weights[1 - player]
        own[0] = self.weights[player]
        opponent_average = None if train else theirs.normalize(theirs.strategy_sum)

        # Opponent-reach vectors the terminals are entered with. Terminals under
        # one of the updating player's own decisions all see the SAME vector (only
        # the updating player's action differs), so each distinct vector is one
        # column of the matrix product, shared.
        vectors: list[np.ndarray] = []
        column_of: dict[int, int] = {}
        terminal_column = np.empty(len(self._terminal_pot), dtype=np.intp)

        # Top-down: the reach vectors each node and terminal is entered with.
        for node in decisions:
            i = node.index
            if node.actor == player:
                if train:
                    child_own = own[i][:, None] * node.current
                    mine.own_reach[:, node.slot] = own[i]
                child_opp_all = None
            else:
                strategy = node.current if train else opponent_average[:, node.col0 : node.col0 + len(node.children)]
                child_opp_all = opp[i][:, None] * strategy
            for k, ref in enumerate(node.children):
                if child_opp_all is None:
                    c_own = child_own[:, k] if train else None
                    c_opp = opp[i]
                else:
                    c_own = own[i]
                    c_opp = child_opp_all[:, k]
                if ref >= 0:
                    own[ref], opp[ref] = c_own, c_opp
                else:
                    column = column_of.get(id(c_opp))
                    if column is None:
                        column = column_of[id(c_opp)] = len(vectors)
                        vectors.append(c_opp)
                    terminal_column[~ref] = column

        # Every terminal at once: row t of `values` is terminal t's value for each
        # of the player's combos.
        alpha, beta = self._terminal_arrays[player]
        win, facing = self._mass_rows(player, np.stack(vectors))
        values = alpha * win[terminal_column] + beta * facing[terminal_column]

        # Bottom-up: each node's value (and, training, its action values).
        value: list[np.ndarray | None] = [None] * len(decisions)
        for node in reversed(decisions):
            columns = [value[ref] if ref >= 0 else values[~ref] for ref in node.children]
            if node.actor != player:
                total = columns[0]
                for column in columns[1:]:
                    total = total + column
                value[node.index] = total
            elif not train:
                value[node.index] = np.max(np.stack(columns, axis=1), axis=1)
            else:
                action_values = mine.action_values[:, node.col0 : node.col0 + len(columns)]
                np.stack(columns, axis=1, out=action_values)
                node_value = (node.current * action_values).sum(axis=1)
                mine.node_value[:, node.slot] = node_value
                value[node.index] = node_value

        if train and mine.nodes:
            # DCFR, for every one of the player's nodes at once: discount what's
            # accumulated so far before adding this iteration -- positive regrets
            # by t^a/(t^a+1), negative by t^b/(t^b+1), the average strategy by
            # (t/(t+1))^g -- so early, badly-informed iterations fade instead of
            # anchoring the result. Then regret-match the new current strategies.
            t = self.iterations - 1
            positive = t**_DCFR_ALPHA / (t**_DCFR_ALPHA + 1)
            negative = t**_DCFR_BETA / (t**_DCFR_BETA + 1)
            gamma = (t / (t + 1)) ** _DCFR_GAMMA
            regret, strategy_sum, current = mine.regret, mine.strategy_sum, mine.current
            np.multiply(regret, np.where(regret > 0, positive, negative), out=regret)
            regret += mine.action_values
            regret -= mine.node_value[:, mine.column_node]
            strategy_sum *= gamma
            strategy_sum += mine.own_reach[:, mine.column_node] * current  # the strategy played THIS iteration
            # DCFR keeps (discounted) negative regrets, so take the positive part.
            current[...] = mine.normalize(np.maximum(regret, 0.0))
        return value[0]

    def train(self, iterations: int) -> None:
        for _ in range(iterations):
            self.iterations += 1
            # Alternating updates: player 1's pass already sees player 0's
            # freshly updated strategy.
            for player in (0, 1):
                self._pass(player, train=True)

    def train_until(
        self,
        target_pct_of_pot: float,
        max_iterations: int,
        check_every: int = 25,
        deadline: float | None = None,
    ) -> float:
        """Train until exploitability falls below `target_pct_of_pot` (% of
        the pot at the start of this street, seeded bets included), checking
        every `check_every` iterations, or until `max_iterations`. Returns
        the exploitability actually reached, as % of that pot.

        Iteration-based by default, so the same request stops at the same
        iteration on any machine. `deadline` (a time.perf_counter() value)
        is the escape hatch for a host too slow to finish in time: training
        stops after the first iteration past it, and the exploitability
        returned says honestly how converged the result got. A check costs
        about one extra iteration (two best-response passes)."""
        pot = self._root.pot_bb + self._root.contributed[0] + self._root.contributed[1]
        while self.iterations < max_iterations:
            batch = min(check_every, max_iterations - self.iterations)
            for _ in range(batch):
                self.train(1)
                if deadline is not None and time.perf_counter() >= deadline:
                    return 100 * self.exploitability() / pot
            pct = 100 * self.exploitability() / pot
            if pct < target_pct_of_pot or self.iterations >= max_iterations:
                return pct
        # Only reached if already at max_iterations before starting.
        return 100 * self.exploitability() / pot if self.iterations else float("inf")

    # --- reading results -----------------------------------------------

    def average_strategy(self, history: tuple[str, ...] | None = None) -> tuple[tuple[str, ...], np.ndarray]:
        """(actions, (combo_count, action_count) average strategy) for the
        acting player at `history` -- the root decision by default."""
        if history is None:
            history = self._root.history
        node = self._nodes.get(history)
        if node is None:
            raise KeyError(f"no node trained at history {history!r} -- train() first, or unreachable")
        return node.actions, node.average_strategy()

    def combo_equities(self, player: int) -> tuple[np.ndarray, float]:
        """Each of `player`'s combos' showdown equity against the opponent's
        whole weighted range (every runout counted, card-sharing pairs
        excluded), plus the range's overall equity -- read off the same
        matrix training uses, so nothing is recomputed. NaN for a combo that
        can't be dealt against any of the opponent's range."""
        n = len(self.combos[player])
        shares = self._payoff[player].astype(np.float64) @ self.weights[1 - player]
        wins, totals = shares[:n], shares[n:]
        equities = np.divide(wins, totals, out=np.full(n, np.nan), where=totals > 0)
        mine = self.weights[player]
        overall = float(mine @ wins) / float(mine @ totals)
        return equities, overall

    def label_strategies(self, history: tuple[str, ...] | None = None) -> dict[str, dict[str, float]]:
        """Combo-level average strategies rolled up to 169-type labels,
        averaged uniformly over each label's unblocked combos -- same
        semantics as postflop_mccfr.aggregate_label_strategies, but every
        combo is genuinely trained here, so no label is ever silently
        missing for lack of samples."""
        if history is None:
            history = self._root.history
        node = self._nodes[history]
        actions, strategy = node.actions, node.average_strategy()
        sums: dict[str, np.ndarray] = {}
        counts: dict[str, int] = {}
        for label, row in zip(self.labels[node.actor], strategy):
            sums[label] = sums.get(label, 0) + row
            counts[label] = counts.get(label, 0) + 1
        return {
            label: {a: float(p) for a, p in zip(actions, sums[label] / counts[label])}
            for label in sums
        }

    def _reach_along(self, line: tuple[str, ...]) -> list[np.ndarray]:
        """Each player's per-combo weight after `line` has been played from
        the root: prior weight times the average-strategy probability of
        each of that player's actions along it."""
        state = self._root
        reach = [self.weights[0].copy(), self.weights[1].copy()]
        for action in line:
            if state.is_terminal():
                raise ValueError(f"line continues past a terminal state at {state.history!r}")
            if action not in state.legal_actions():
                raise ValueError(f"{action!r} isn't legal after {state.history!r}")
            node = self._nodes[state.history]
            reach[node.actor] = reach[node.actor] * node.average_strategy()[:, node.actions.index(action)]
            state = state.apply(action)

        return reach

    def line_probability(self, line: tuple[str, ...]) -> tuple[float, float]:
        """How likely each player was to take their side of `line` at all:
        posterior mass over prior mass, per player. Near 0 means the
        equilibrium (almost) never plays that line, so the posterior
        ranges are numerical noise -- worth warning about before chaining
        them into another solve."""
        reach = self._reach_along(line)
        return tuple(float(r.sum() / w.sum()) for r, w in zip(reach, self.weights))  # type: ignore[return-value]

    def posterior_ranges(self, line: tuple[str, ...]) -> tuple[dict[str, float], dict[str, float]]:
        """Both players' ranges conditional on `line` -- action labels
        played from this trainer's root (i.e. after any prior_history,
        which is seeded, never trained, so it contributes no update; to
        narrow on a whole street's play, solve it with no prior_history)
        -- having happened: a Bayesian update of each
        combo's prior weight by the average-strategy probability of
        every action that player took along it. This is what makes a
        later street's range a consequence of this street's equilibrium
        instead of something the user has to guess (docs/plan.md,
        "where does a later street's range come from?").

        Weights are NOT renormalized, so they stay in [0, 1] like a
        painted range and a combo that took the line with certainty
        keeps its prior weight.

        Keys are combo-aware: a 169-type label ('AKs') where every one of
        its live combos ended up within _COLLAPSE_TOLERANCE (relative) of
        the same weight, otherwise one specific-combo key ('AhKh') per combo --
        because the suits are the point (the nut flush draw is the hand
        that bluffed, its blocker-free sibling isn't), and averaging them
        back into a label would throw that away. A label whose every
        combo is blocked by this street's board is absent; combos the line
        ruled out (weight ~0) are kept as 0.0 -- callers drop them.

        Not exact joint-equilibrium reasoning: nothing here accounts for
        how this street's strategy sets up the next one (no backward
        induction), only for what actually got played."""
        reach = self._reach_along(line)
        board = frozenset(self._config.board)
        result: list[dict[str, float]] = []
        for player in (0, 1):
            by_label: dict[str, list[tuple[Combo, float]]] = {}
            for label, combo, weight in zip(self.labels[player], self.combos[player], reach[player]):
                by_label.setdefault(label, []).append((combo, float(weight)))
            weights: dict[str, float] = {}
            for label, members in by_label.items():
                values = [w for _, w in members]
                # Only collapse when the label has every combo this board
                # leaves: a prior that excluded one (AKs minus AhKh) must
                # not get it back by a label key standing for all four.
                whole_label = len(members) == sum(
                    1 for c in label_to_combos(label) if c[0] not in board and c[1] not in board
                )
                if whole_label and max(values) - min(values) <= _COLLAPSE_TOLERANCE * max(values):
                    weights[label] = sum(values) / len(values)
                else:
                    for combo, weight in members:
                        weights[combo_key(combo)] = weight
            result.append(weights)
        return result[0], result[1]

    def combo_strategies(
        self, history: tuple[str, ...] | None = None, min_spread: float = 0.01
    ) -> dict[str, dict[str, float]]:
        """Per-combo average strategies ('AhKh' -> {action: probability}),
        but only for hand types whose suit combos actually play differently
        (some action's probability differs by more than `min_spread`
        between two of its combos -- flush draws, blockers). Hand types
        whose combos all play alike are left out: label_strategies already
        says it all, and sending 1326 near-identical rows would just bloat
        the response."""
        if history is None:
            history = self._root.history
        node = self._nodes[history]
        strategy = node.average_strategy()
        by_label: dict[str, list[int]] = {}
        for i, label in enumerate(self.labels[node.actor]):
            by_label.setdefault(label, []).append(i)
        out: dict[str, dict[str, float]] = {}
        for rows in by_label.values():
            block = strategy[rows]
            if len(rows) < 2 or float((block.max(axis=0) - block.min(axis=0)).max()) <= min_spread:
                continue
            for i in rows:
                out[combo_key(self.combos[node.actor][i])] = {
                    a: float(p) for a, p in zip(node.actions, strategy[i])
                }
        return out

    # --- convergence measurement ---------------------------------------

    def best_response_value(self, player: int) -> float:
        """Expected payoff (bb per deal) of `player`'s best response against
        the opponent's current average strategy."""
        per_combo = self._pass(player, train=False)
        return float(self.weights[player] @ per_combo) / self._chance_mass

    def exploitability(self) -> float:
        """How much (bb per deal, averaged over the two players) a perfect
        opponent could gain against the current average strategies -- 0 at
        an exact equilibrium. Payoffs always sum to the dead pot (pot_bb),
        so that's subtracted out. The principled convergence measure for
        choosing an iteration count, rather than eyeballing frequencies."""
        return (self.best_response_value(0) + self.best_response_value(1) - self._config.pot_bb) / 2
