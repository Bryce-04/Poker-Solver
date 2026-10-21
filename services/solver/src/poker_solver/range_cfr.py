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

    `current` is the regret-matched strategy, cached: it only changes when
    this node's own regrets do (right after its player's update), so it's
    recomputed once per iteration there instead of on every visit."""

    __slots__ = ("actions", "actor", "regret", "strategy_sum", "current", "index", "children")

    def __init__(self, actions: tuple[str, ...], actor: int, combo_count: int, index: int) -> None:
        self.actions = actions
        self.actor = actor
        self.index = index
        # Child references, one per action: >= 0 is another decision node's
        # index, < 0 is the terminal ~ref (so -1 is terminal 0).
        self.children: tuple[int, ...] = ()
        self.regret = np.zeros((combo_count, len(actions)))
        self.strategy_sum = np.zeros((combo_count, len(actions)))
        self.current = np.full((combo_count, len(actions)), 1.0 / len(actions))  # zero regret = uniform

    @staticmethod
    def _normalize(weights: np.ndarray) -> np.ndarray:
        totals = weights.sum(axis=1, keepdims=True)
        uniform = 1.0 / weights.shape[1]
        return np.where(totals > 0, weights / np.where(totals > 0, totals, 1.0), uniform)

    def current_strategy(self) -> np.ndarray:
        return self.current

    def refresh_current(self) -> None:
        # DCFR keeps (discounted) negative regrets, so take the positive part.
        self.current = self._normalize(np.maximum(self.regret, 0.0))

    def average_strategy(self) -> np.ndarray:
        return self._normalize(self.strategy_sum)


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
      * Regret-matched strategies are cached per node and refreshed only when
        that node's regrets change.
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
        node = _PublicNode(
            state.legal_actions(), state.to_act, len(self.combos[state.to_act]), len(self._decisions)
        )
        self._decisions.append(node)
        self._nodes[state.history] = node
        node.children = tuple(self._build_tree(state.apply(action)) for action in node.actions)
        return node.index

    def _terminal_tables(self) -> tuple:
        """Per-terminal scalars as arrays, so every terminal's value in a
        pass is one vectorized expression."""
        pot = np.array(self._terminal_pot)
        winner = np.array(self._terminal_fold_winner)
        contrib = np.array(self._terminal_contrib)  # (T, 2)
        is_fold = winner >= 0
        per_player = []
        for player in (0, 1):
            own = contrib[:, player]
            # What a fold hands the non-folder is the WHOLE pot, dead money
            # from earlier streets included -- see betting_round.terminal_utility.
            fold_share = np.where(winner == player, pot, 0.0)
            per_player.append((own, fold_share - own))
        return pot, is_fold, per_player

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

    def _mass_vs(self, player: int, vectors: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """For each of `player`'s combos and each column of `vectors` (an
        (opponent combos, T) array of reach weights): the equity-weighted
        opponent mass it wins at showdown, and the total opponent mass it
        could be facing (card-sharing combos excluded). Shapes (own combos, T).

        The win mass is one matrix multiply. The facing mass needs no matrix:
        total reach, minus the reach of opponent combos holding either of my
        two cards, plus back the combo identical to mine (it was subtracted
        for both cards). Inclusion-exclusion over a 52-card table."""
        matrix = self._win[player]
        win = (matrix @ vectors.astype(matrix.dtype, copy=False)).astype(np.float64)
        first, second, incidence, same = self._blockers[player]
        per_card = incidence.T @ vectors  # (52, T): reach of opponent combos holding each card
        padded = np.vstack([vectors, np.zeros((1, vectors.shape[1]))])  # row m = "no identical twin"
        facing = vectors.sum(axis=0)[None, :] - per_card[first] - per_card[second] + padded[same]
        return win, facing

    def _terminal_values(self, player: int, vectors: np.ndarray) -> np.ndarray:
        """Counterfactual value of each of `player`'s combos at every terminal
        (columns, in terminal order): sum over every opponent combo it could be
        facing (weighted by that combo's reach) of the player's payoff. Same
        arithmetic as betting_round.terminal_utility, including its fold
        pitfall: the winner's share is the whole pot."""
        pot, is_fold, per_player = self._terminal_arrays
        own, fold_net = per_player[player]
        win, facing = self._mass_vs(player, vectors)
        return np.where(
            is_fold[None, :], fold_net[None, :] * facing, pot[None, :] * win - own[None, :] * facing
        )

    # --- one pass over the tree ------------------------------------------

    def _pass(self, player: int, *, train: bool) -> np.ndarray:
        """One traversal for `player`. With train=True: both players play their
        current strategies, `player`'s regrets and strategy sums are updated
        (DCFR), and each node's strategy refreshed. With train=False: the
        opponent plays its AVERAGE strategy and `player` best-responds -- the
        exploitability measure. Returns `player`'s per-combo value at the root."""
        decisions = self._decisions
        terminals = len(self._terminal_pot)
        opp: list[np.ndarray | None] = [None] * len(decisions)
        own: list[np.ndarray | None] = [None] * len(decisions)
        terminal_opp: list[np.ndarray | None] = [None] * terminals
        opp[0] = self.weights[1 - player]
        own[0] = self.weights[player]

        # Top-down: the reach vectors each node and terminal is entered with.
        for node in decisions:
            mine = node.actor == player
            if mine:
                strategy = node.current if train else None
            else:
                strategy = node.current if train else node.average_strategy()
            for k, ref in enumerate(node.children):
                if mine:
                    child_own = own[node.index] * strategy[:, k] if train else None
                    child_opp = opp[node.index]
                else:
                    child_own = own[node.index]
                    child_opp = opp[node.index] * strategy[:, k]
                if ref >= 0:
                    own[ref], opp[ref] = child_own, child_opp
                else:
                    terminal_opp[~ref] = child_opp

        # Every terminal at once.
        values = self._terminal_values(player, np.column_stack(terminal_opp))

        # Bottom-up.
        value: list[np.ndarray | None] = [None] * len(decisions)
        if train:
            t = self.iterations - 1
            positive = t**_DCFR_ALPHA / (t**_DCFR_ALPHA + 1)
            negative = t**_DCFR_BETA / (t**_DCFR_BETA + 1)
            gamma = (t / (t + 1)) ** _DCFR_GAMMA
        for node in reversed(decisions):
            columns = [value[ref] if ref >= 0 else values[:, ~ref] for ref in node.children]
            if node.actor != player:
                total = columns[0]
                for column in columns[1:]:
                    total = total + column
                value[node.index] = total
            elif not train:
                value[node.index] = np.max(np.stack(columns, axis=1), axis=1)
            else:
                action_values = np.stack(columns, axis=1)
                strategy = node.current
                node_value = (strategy * action_values).sum(axis=1)
                # DCFR: discount what's accumulated so far before adding this
                # iteration -- positive regrets by t^a/(t^a+1), negative by
                # t^b/(t^b+1), the average strategy by (t/(t+1))^g -- so early,
                # badly-informed iterations fade instead of anchoring the result.
                node.regret = (
                    np.where(node.regret > 0, node.regret * positive, node.regret * negative)
                    + action_values
                    - node_value[:, None]
                )
                node.strategy_sum = node.strategy_sum * gamma + own[node.index][:, None] * strategy
                node.refresh_current()
                value[node.index] = node_value
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
