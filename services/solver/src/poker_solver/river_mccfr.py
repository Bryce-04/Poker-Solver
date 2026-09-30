"""Chance-sampled Monte Carlo CFR for the river-only game (river_game.py),
given two ranges and a fixed board. Same regret-matching shape as
kuhn_spike.py's KuhnCfrTrainer -- see that file's docstring for the CFR
background -- adapted for: a per-node dynamic action set (Kuhn's is a fixed
two-action constant), chance-sampled hole cards drawn from weighted ranges
instead of an exhaustive tree walk, and utilities returned as an explicit
(u0, u1) pair instead of negated.

Why not negate like Kuhn does: Kuhn is strictly zero-sum at every node
(antes only). Here, pot_bb is dead money from earlier streets that neither
player "contributed" this street, so u0 + u1 == pot_bb (a nonzero constant)
at every terminal -- negation would silently break. Returning both
utilities explicitly and using them directly is also the more standard
pattern for real (non-toy) poker CFR.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass, field

from .cards import card_str, parse_card
from .combos import WeightedRangeSampler, expand_range_to_combos, label_to_combos, sample_deal
from .evaluator import evaluate_best
from .river_game import RiverState


@dataclass
class _InfoSetNode:
    info_set: str
    actions: tuple[str, ...]
    regret_sum: dict[str, float] = field(init=False)
    strategy_sum: dict[str, float] = field(init=False)

    def __post_init__(self) -> None:
        self.regret_sum = dict.fromkeys(self.actions, 0.0)
        self.strategy_sum = dict.fromkeys(self.actions, 0.0)

    def current_strategy(self, realization_weight: float) -> dict[str, float]:
        strategy = {a: max(self.regret_sum[a], 0.0) for a in self.actions}
        total = sum(strategy.values())
        for a in self.actions:
            strategy[a] = strategy[a] / total if total > 0 else 1.0 / len(self.actions)
            self.strategy_sum[a] += realization_weight * strategy[a]
        return strategy

    def average_strategy(self) -> dict[str, float]:
        total = sum(self.strategy_sum.values())
        if total <= 0:
            return {a: 1.0 / len(self.actions) for a in self.actions}
        return {a: self.strategy_sum[a] / total for a in self.actions}


@dataclass
class RiverSpotConfig:
    board: tuple[int, ...]  # exactly 5 cards -- river-only scope
    pot_bb: float
    effective_stack_bb: float
    range0: dict[str, float]
    range1: dict[str, float]
    first_to_act: int = 0
    prior_history: tuple[str, ...] = ()


def _info_set_key(player: int, hand: tuple[int, int], history: tuple[str, ...]) -> str:
    combo = "".join(sorted(card_str(c) for c in hand))
    return f"{player}|{combo}|{'/'.join(history)}"


class RiverMccfrTrainer:
    def __init__(self, config: RiverSpotConfig, seed: int = 0) -> None:
        self._config = config
        self._rng = random.Random(seed)
        self._nodes: dict[str, _InfoSetNode] = {}
        board_blocked = frozenset(config.board)
        self._sampler0 = WeightedRangeSampler(
            expand_range_to_combos(config.range0, blocked=board_blocked)
        )
        self._sampler1 = WeightedRangeSampler(
            expand_range_to_combos(config.range1, blocked=board_blocked)
        )

    @property
    def node_map(self) -> dict[str, _InfoSetNode]:
        return self._nodes

    def train(self, iterations: int) -> tuple[float, float]:
        total0 = total1 = 0.0
        for _ in range(iterations):
            hand0, hand1 = sample_deal(self._sampler0, self._sampler1, self._rng)
            # Evaluated once per iteration and reused at every terminal this
            # iteration's tree walk reaches, not once per terminal.
            strength0 = evaluate_best(hand0 + self._config.board)
            strength1 = evaluate_best(hand1 + self._config.board)
            state = RiverState.initial(
                self._config.pot_bb,
                self._config.effective_stack_bb,
                self._config.first_to_act,
                self._config.prior_history,
            )
            u0, u1 = self._cfr(state, hand0, hand1, strength0, strength1, 1.0, 1.0)
            total0 += u0
            total1 += u1
        return total0 / iterations, total1 / iterations

    def _cfr(
        self,
        state: RiverState,
        hand0: tuple[int, int],
        hand1: tuple[int, int],
        strength0: object,
        strength1: object,
        reach0: float,
        reach1: float,
    ) -> tuple[float, float]:
        if state.is_terminal():
            return state.terminal_utility(strength0, strength1)

        player = state.to_act
        hand = hand0 if player == 0 else hand1
        actions = state.legal_actions()
        key = _info_set_key(player, hand, state.history)
        node = self._nodes.get(key)
        if node is None:
            node = _InfoSetNode(key, actions)
            self._nodes[key] = node

        strategy = node.current_strategy(reach0 if player == 0 else reach1)
        action_u0: dict[str, float] = {}
        action_u1: dict[str, float] = {}
        node_u0 = node_u1 = 0.0

        for action in actions:
            next_state = state.apply(action)
            if player == 0:
                u0, u1 = self._cfr(
                    next_state, hand0, hand1, strength0, strength1,
                    reach0 * strategy[action], reach1,
                )
            else:
                u0, u1 = self._cfr(
                    next_state, hand0, hand1, strength0, strength1,
                    reach0, reach1 * strategy[action],
                )
            action_u0[action], action_u1[action] = u0, u1
            node_u0 += strategy[action] * u0
            node_u1 += strategy[action] * u1

        opponent_reach = reach1 if player == 0 else reach0
        my_action_u = action_u0 if player == 0 else action_u1
        my_node_u = node_u0 if player == 0 else node_u1
        for action in actions:
            node.regret_sum[action] += opponent_reach * (my_action_u[action] - my_node_u)

        return node_u0, node_u1


def run_demo(iterations: int = 20_000, seed: int = 1) -> None:
    """Same polarized-range-vs-bluffcatcher scenario test_river_mccfr.py
    checks against closed-form numbers -- see that file's module docstring
    for the full derivation. Board Ks Qh 9d 4c 2s, pot_bb=100,
    effective_stack_bb=33 (exactly the 33%-pot size, so Hero's options
    collapse to check/all_in and Villain's to fold/call). Run directly:

        python -m poker_solver.river_mccfr
    """
    board = tuple(parse_card(c) for c in ["Ks", "Qh", "9d", "4c", "2s"])
    config = RiverSpotConfig(
        board=board,
        pot_bb=100.0,
        effective_stack_bb=33.0,
        range0={"KJo": 1.0},
        range1={"AA": 1.0, "33": 1.0},
        first_to_act=1,
        prior_history=("check",),
    )
    trainer = RiverMccfrTrainer(config, seed=seed)

    start = time.perf_counter()
    trainer.train(iterations)
    elapsed = time.perf_counter() - start
    print(f"River MCCFR: {iterations:,} iterations in {elapsed:.3f}s")

    def average(player: int, label: str, history: tuple[str, ...]) -> dict[str, float]:
        blocked = frozenset(board)
        combos = [c for c in label_to_combos(label) if c[0] not in blocked and c[1] not in blocked]
        strategies = [
            trainer.node_map[_info_set_key(player, c, history)].average_strategy() for c in combos
        ]
        actions = strategies[0].keys()
        return {a: sum(s[a] for s in strategies) / len(strategies) for a in actions}

    print()
    print("Hero (AA/33) opening decision, average strategy:")
    print(f"  AA: {average(1, 'AA', ('check',))}")
    print(f"  33: {average(1, '33', ('check',))}  (theory: shove ~= 33/133 = 0.2481)")
    print()
    print("Villain (KJo) facing a shove, average strategy:")
    print(f"  KJo: {average(0, 'KJo', ('check', 'all_in'))}  (theory: call ~= 100/133 = 0.7519)")


if __name__ == "__main__":
    run_demo()
