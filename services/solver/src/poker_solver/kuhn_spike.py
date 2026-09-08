"""Stage 1 throwaway solver spike.

This is the thing referenced in docs/plan.md Stage 1: prove the CFR family
of algorithms actually converges to a known-correct equilibrium, and get a
feel for runtime, *before* any UI gets built around the assumption that
real-time solving works.

It deliberately does NOT solve real poker. It solves Kuhn poker — a 3-card,
single-bet-size, single-street toy game with a known closed-form
equilibrium (game value = -1/18 to the first player to act) — using vanilla
CFR (regret matching), not Monte Carlo sampling.

That's a real scope difference from Stage 5, not just a smaller example:

  - Kuhn poker's game tree has 12 nodes, so it can be walked exhaustively
    every iteration. Stage 5's single-street, fixed-bet-size scope has a
    tree big enough that exhaustive CFR is too slow — that's what makes it
    *Monte Carlo* CFR (sampling one path per iteration instead of walking
    the whole tree).
  - There's no board, no ranges, no bet sizing menu here — just two hidden
    cards and a bet-or-check decision. Stage 5's Spot model (see
    packages/schema) is what actually needs solving.

What this spike is for: confirming that plain regret matching converges
here (it should, in well under a second, in a few thousand iterations)
before committing to CFR as the algorithm family for Stage 5. If this
didn't converge cleanly, that would be a signal to reconsider before
building anything real on top of it.

Run directly for a demo:

    python -m poker_solver.kuhn_spike
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass, field

PASS, BET = "p", "b"
ACTIONS = (PASS, BET)
CARDS = (0, 1, 2)  # Jack, Queen, King


@dataclass
class _InfoSetNode:
    info_set: str
    regret_sum: dict[str, float] = field(default_factory=lambda: {a: 0.0 for a in ACTIONS})
    strategy_sum: dict[str, float] = field(default_factory=lambda: {a: 0.0 for a in ACTIONS})

    def current_strategy(self, realization_weight: float) -> dict[str, float]:
        """Regret matching: play actions proportional to positive regret."""
        strategy = {a: max(self.regret_sum[a], 0.0) for a in ACTIONS}
        total = sum(strategy.values())
        for a in ACTIONS:
            strategy[a] = strategy[a] / total if total > 0 else 1.0 / len(ACTIONS)
            self.strategy_sum[a] += realization_weight * strategy[a]
        return strategy

    def average_strategy(self) -> dict[str, float]:
        total = sum(self.strategy_sum.values())
        if total <= 0:
            return {a: 1.0 / len(ACTIONS) for a in ACTIONS}
        return {a: self.strategy_sum[a] / total for a in ACTIONS}


class KuhnCfrTrainer:
    """Vanilla CFR over Kuhn poker's full game tree."""

    def __init__(self, seed: int = 0) -> None:
        self._nodes: dict[str, _InfoSetNode] = {}
        self._rng = random.Random(seed)

    @property
    def node_map(self) -> dict[str, _InfoSetNode]:
        return self._nodes

    def train(self, iterations: int) -> float:
        """Runs CFR for `iterations` full-tree passes over random deals.

        Returns the average game value to player 0 (the first to act) —
        known to converge to -1/18 for correctly implemented Kuhn CFR.
        """
        cards = list(CARDS)
        total_util = 0.0
        for _ in range(iterations):
            self._rng.shuffle(cards)
            total_util += self._cfr(cards, "", 1.0, 1.0)
        return total_util / iterations

    def _cfr(self, cards: list[int], history: str, p0: float, p1: float) -> float:
        plays = len(history)
        player = plays % 2
        opponent = 1 - player

        if plays > 1:
            terminal_value = self._terminal_utility(cards, history, player, opponent)
            if terminal_value is not None:
                return terminal_value

        info_set_key = f"{cards[player]}{history}"
        node = self._nodes.setdefault(info_set_key, _InfoSetNode(info_set_key))

        strategy = node.current_strategy(p0 if player == 0 else p1)
        action_utility: dict[str, float] = {}
        node_utility = 0.0

        for a in ACTIONS:
            next_history = history + a
            if player == 0:
                action_utility[a] = -self._cfr(cards, next_history, p0 * strategy[a], p1)
            else:
                action_utility[a] = -self._cfr(cards, next_history, p0, p1 * strategy[a])
            node_utility += strategy[a] * action_utility[a]

        opponent_reach = p1 if player == 0 else p0
        for a in ACTIONS:
            regret = action_utility[a] - node_utility
            node.regret_sum[a] += opponent_reach * regret

        return node_utility

    @staticmethod
    def _terminal_utility(
        cards: list[int], history: str, player: int, opponent: int
    ) -> float | None:
        player_card_higher = cards[player] > cards[opponent]

        if history in ("pp",):
            return 1.0 if player_card_higher else -1.0
        if history in ("bp", "pbp"):
            return 1.0  # opponent folded
        if history in ("bb", "pbb"):
            return 2.0 if player_card_higher else -2.0
        return None


def run_demo(iterations: int = 25_000, seed: int = 0) -> None:
    trainer = KuhnCfrTrainer(seed=seed)
    start = time.perf_counter()
    game_value = trainer.train(iterations)
    elapsed = time.perf_counter() - start

    print(f"Kuhn CFR spike: {iterations:,} iterations in {elapsed:.3f}s")
    print(f"Average game value to player 0: {game_value:+.4f}  (known equilibrium: -0.0556)")
    print()
    print("Converged strategies (card, history -> P(pass), P(bet)):")
    for key in sorted(trainer.node_map):
        avg = trainer.node_map[key].average_strategy()
        print(f"  {key:<6} pass={avg[PASS]:.3f}  bet={avg[BET]:.3f}")


if __name__ == "__main__":
    run_demo()
