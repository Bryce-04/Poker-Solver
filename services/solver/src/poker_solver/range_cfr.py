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

from dataclasses import dataclass

import numpy as np

from .betting_round import BettingRoundState
from .combos import Combo, label_to_combos
from .equity import compute_equity_matrix

# Brown & Sandholm's recommended DCFR parameters.
_DCFR_ALPHA = 1.5
_DCFR_BETA = 0.0
_DCFR_GAMMA = 2.0


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

    def __post_init__(self) -> None:
        if len(self.board) not in (3, 4, 5):
            raise ValueError(
                f"board must be 3 (flop), 4 (turn), or 5 (river) cards, got {len(self.board)}"
            )


def _expand(range_weights: dict[str, float], blocked: frozenset[int]) -> tuple[list[Combo], np.ndarray, list[str]]:
    """Like combos.expand_range_to_combos, but also keeps each combo's
    169-type label so strategies can be rolled back up per label."""
    combos: list[Combo] = []
    weights: list[float] = []
    labels: list[str] = []
    for label, weight in range_weights.items():
        if weight <= 0:
            continue
        for combo in label_to_combos(label):
            if combo[0] in blocked or combo[1] in blocked:
                continue
            combos.append(combo)
            weights.append(weight)
            labels.append(label)
    if not combos:
        raise ValueError("range has no combos left after removing blocked cards")
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
            config.pot_bb, config.effective_stack_bb, config.first_to_act, config.prior_history
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
        self, target_pct_of_pot: float, max_iterations: int, check_every: int = 25
    ) -> float:
        """Train until exploitability falls below `target_pct_of_pot` (% of
        the pot at the start of this street, seeded bets included), checking
        every `check_every` iterations, or until `max_iterations`. Returns
        the exploitability actually reached, as % of that pot.

        Deliberately iteration-based, not wall-clock-based: the same
        request always stops at the same iteration on any machine, so
        results stay reproducible (and cacheable) between a fast laptop
        and the slow deployed host. A check costs about one extra
        iteration (two best-response passes)."""
        pot = self._root.pot_bb + self._root.contributed[0] + self._root.contributed[1]
        pct = float("inf")
        while self.iterations < max_iterations:
            self.train(min(check_every, max_iterations - self.iterations))
            pct = 100 * self.exploitability() / pot
            if pct < target_pct_of_pot:
                break
        return pct

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
