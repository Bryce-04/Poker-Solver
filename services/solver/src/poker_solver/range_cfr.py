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
Information Games via Discounted Regret Minimization", with their
recommended alpha=1.5, beta=0, gamma=2) and alternating player updates.
CFR+ was implemented first and measured head to head on the wide-range
regression scenario below: DCFR reached 1.1% of the pot in exploitability
at 100 iterations (CFR+: 2.4%) and 0.35% at 200 (CFR+: 1.2%) -- roughly
2-3x fewer iterations for the same precision, for a few extra lines.

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

# Brown & Sandholm's recommended DCFR parameters.
_DCFR_ALPHA = 1.5
_DCFR_BETA = 0.0
_DCFR_GAMMA = 2.0

# posterior_ranges collapses a label's combos back into one label weight when
# they all agree to within this much; a bigger spread keeps them separate.
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
    _InfoSetNode per (combo, history) the way postflop_mccfr.py does."""

    __slots__ = ("actions", "actor", "regret", "strategy_sum")

    def __init__(self, actions: tuple[str, ...], actor: int, combo_count: int) -> None:
        self.actions = actions
        self.actor = actor
        self.regret = np.zeros((combo_count, len(actions)))
        self.strategy_sum = np.zeros((combo_count, len(actions)))

    @staticmethod
    def _normalize(weights: np.ndarray) -> np.ndarray:
        totals = weights.sum(axis=1, keepdims=True)
        uniform = 1.0 / weights.shape[1]
        return np.where(totals > 0, weights / np.where(totals > 0, totals, 1.0), uniform)

    def current_strategy(self) -> np.ndarray:
        # DCFR keeps (discounted) negative regrets, so take the positive part.
        return self._normalize(np.maximum(self.regret, 0.0))

    def average_strategy(self) -> np.ndarray:
        return self._normalize(self.strategy_sum)


class _OpponentReach:
    """The opponent's reach vector, plus its product with the payoff
    matrices -- computed lazily, at most once. Profiling showed terminal
    matrix-vector products at ~65% of training time; every terminal
    under the updating player's own decision sees the *same* opponent
    reach (only the updating player's action differs), so sharing one
    product across those siblings removes a large share of them."""

    __slots__ = ("vector", "_matrix", "_products")

    def __init__(self, vector: np.ndarray, matrix: np.ndarray) -> None:
        self.vector = vector
        self._matrix = matrix
        self._products: tuple[np.ndarray, np.ndarray] | None = None

    def products(self) -> tuple[np.ndarray, np.ndarray]:
        """(equity-weighted opponent mass, total opponent mass), per own combo."""
        if self._products is None:
            stacked = self._matrix @ self.vector.astype(np.float32)
            half = stacked.shape[0] // 2
            self._products = (stacked[:half].astype(np.float64), stacked[half:].astype(np.float64))
        return self._products

    def scaled(self, factor: np.ndarray) -> _OpponentReach:
        return _OpponentReach(self.vector * factor, self._matrix)


class RangeCfrTrainer:
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
        # Per player p, one stacked matrix taking the opponent's reach
        # vector to [equity-weighted share p wins at showdown; total
        # opponent weight p could be facing] for each of p's combos -- one
        # matrix-vector product per terminal instead of two. float32 halves
        # memory traffic (the product is the hot loop); regrets and
        # strategy sums stay float64.
        self._payoff = (
            np.vstack([win0, possible]).astype(np.float32),
            np.vstack([(possible - win0).T, possible.T]).astype(np.float32),
        )
        self._chance_mass = float(weights0 @ possible @ weights1)
        if self._chance_mass <= 0:
            raise ValueError("no possible deal: every combo pair shares a card")

        self._root = BettingRoundState.initial(
            config.pot_bb,
            config.effective_stack_bb,
            config.first_to_act,
            config.prior_history,
            config.bet_menu,
        )
        self._nodes: dict[tuple[str, ...], _PublicNode] = {}
        self.iterations = 0

    @property
    def root(self) -> BettingRoundState:
        return self._root

    def _node(self, state: BettingRoundState) -> _PublicNode:
        node = self._nodes.get(state.history)
        if node is None:
            node = _PublicNode(state.legal_actions(), state.to_act, len(self.combos[state.to_act]))
            self._nodes[state.history] = node
        return node

    def _opponent_reach(self, player: int, vector: np.ndarray) -> _OpponentReach:
        return _OpponentReach(vector, self._payoff[player])

    def _terminal_value(self, state: BettingRoundState, player: int, opp: _OpponentReach) -> np.ndarray:
        """Counterfactual value of each of `player`'s combos at a terminal:
        sum over every opponent combo it could be facing (weighted by that
        combo's reach) of player's payoff. Same payoff formula as
        BettingRoundState.terminal_utility -- including its fold pitfall:
        the winner's share is the WHOLE pot, dead money from earlier
        streets included, not just what the folder put in this street."""
        total_pot = state.pot_bb + state.contributed[0] + state.contributed[1]
        own = state.contributed[player]
        winning, facing = opp.products()
        if state.history[-1] == "fold":
            # apply() already flipped to_act to the non-folder.
            share = total_pot if state.to_act == player else 0.0
            return (share - own) * facing
        return total_pot * winning - own * facing

    def _traverse(
        self, state: BettingRoundState, player: int, reach_own: np.ndarray, opp: _OpponentReach
    ) -> np.ndarray:
        if state.is_terminal():
            return self._terminal_value(state, player, opp)
        node = self._node(state)
        strategy = node.current_strategy()

        if node.actor == player:
            action_values = np.empty((len(reach_own), len(node.actions)))
            for k, action in enumerate(node.actions):
                # Same `opp` object for every child -- its cached product is
                # shared by all of this decision's terminal outcomes.
                action_values[:, k] = self._traverse(
                    state.apply(action), player, reach_own * strategy[:, k], opp
                )
            value = (strategy * action_values).sum(axis=1)
            # DCFR: discount what's accumulated so far before adding this
            # iteration -- positive regrets by t^a/(t^a+1), negative by
            # t^b/(t^b+1), the average strategy by (t/(t+1))^g -- so early,
            # badly-informed iterations fade instead of anchoring the result.
            t = self.iterations - 1
            positive = t**_DCFR_ALPHA / (t**_DCFR_ALPHA + 1)
            negative = t**_DCFR_BETA / (t**_DCFR_BETA + 1)
            node.regret = (
                np.where(node.regret > 0, node.regret * positive, node.regret * negative)
                + action_values
                - value[:, None]
            )
            node.strategy_sum = (
                node.strategy_sum * (t / (t + 1)) ** _DCFR_GAMMA + reach_own[:, None] * strategy
            )
            return value

        value = np.zeros(len(reach_own))
        for k, action in enumerate(node.actions):
            value += self._traverse(state.apply(action), player, reach_own, opp.scaled(strategy[:, k]))
        return value

    def train(self, iterations: int) -> None:
        for _ in range(iterations):
            self.iterations += 1
            # Alternating updates: player 1's pass already sees player 0's
            # freshly updated strategy.
            for player in (0, 1):
                opp = self._opponent_reach(player, self.weights[1 - player])
                self._traverse(self._root, player, self.weights[player], opp)

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
        its live combos ended up within _COLLAPSE_TOLERANCE of the same
        weight, otherwise one specific-combo key ('AhKh') per combo --
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
                if whole_label and max(values) - min(values) <= _COLLAPSE_TOLERANCE:
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

    def _best_response(self, state: BettingRoundState, player: int, opp: _OpponentReach) -> np.ndarray:
        if state.is_terminal():
            return self._terminal_value(state, player, opp)
        node = self._node(state)
        if node.actor == player:
            return np.max(
                np.stack([self._best_response(state.apply(a), player, opp) for a in node.actions], axis=1),
                axis=1,
            )
        average = node.average_strategy()
        value = np.zeros(len(self.combos[player]))
        for k, action in enumerate(node.actions):
            value += self._best_response(state.apply(action), player, opp.scaled(average[:, k]))
        return value

    def best_response_value(self, player: int) -> float:
        """Expected payoff (bb per deal) of `player`'s best response against
        the opponent's current average strategy."""
        opp = self._opponent_reach(player, self.weights[1 - player])
        per_combo = self._best_response(self._root, player, opp)
        return float(self.weights[player] @ per_combo) / self._chance_mass

    def exploitability(self) -> float:
        """How much (bb per deal, averaged over the two players) a perfect
        opponent could gain against the current average strategies -- 0 at
        an exact equilibrium. Payoffs always sum to the dead pot (pot_bb),
        so that's subtracted out. The principled convergence measure for
        choosing an iteration count, rather than eyeballing frequencies."""
        return (self.best_response_value(0) + self.best_response_value(1) - self._config.pot_bb) / 2
