"""Chance-sampled Monte Carlo CFR for one postflop street (flop, turn, or
river), given two ranges and a board. Same regret-matching shape as
kuhn_spike.py's KuhnCfrTrainer -- see that file's docstring for the CFR
background -- adapted for: a per-node dynamic action set (Kuhn's is a fixed
two-action constant), chance-sampled hole cards drawn from weighted ranges
instead of an exhaustive tree walk, utilities returned as an explicit
(u0, u1) pair instead of negated, and (new) a sampled board runout when
the street isn't the river yet.

Why not negate like Kuhn does: Kuhn is strictly zero-sum at every node
(antes only). Here, pot_bb is dead money from earlier streets that neither
player "contributed" this street, so u0 + u1 == pot_bb (a nonzero constant)
at every terminal -- negation would silently break. Returning both
utilities explicitly and using them directly is also the more standard
pattern for real (non-toy) poker CFR.

Flop/turn vs. river: betting_round.py's state machine has no idea how many
board cards there are -- it's pure pot/action bookkeeping. The only new
thing a shorter board needs is dealing the rest of it before a showdown
can be evaluated, which is exactly what chance-sampling already does for
hole cards: sample the whole iteration's chance outcome (hole cards AND
any missing board cards) once at the top of the loop, then walk the
(now chance-fixed) betting tree. That's why `train` samples the runout
right alongside the hole cards, before any CFR recursion starts.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass, field

from .betting_round import BettingRoundState
from .cards import card_str, parse_card
from .combos import (
    WeightedRangeSampler,
    deal_runout,
    expand_range_to_combos,
    label_to_combos,
    sample_deal,
)
from .evaluator import evaluate_best

BOARD_SIZE_AT_RIVER = 5


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
class PostflopSpotConfig:
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


def _info_set_key(player: int, hand: tuple[int, int], history: tuple[str, ...]) -> str:
    combo = "".join(sorted(card_str(c) for c in hand))
    return f"{player}|{combo}|{'/'.join(history)}"


class PostflopMccfrTrainer:
    def __init__(self, config: PostflopSpotConfig, seed: int = 0) -> None:
        self._config = config
        self._rng = random.Random(seed)
        self._nodes: dict[str, _InfoSetNode] = {}
        self._runout_needed = BOARD_SIZE_AT_RIVER - len(config.board)
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
            if self._runout_needed:
                blocked = frozenset(self._config.board) | set(hand0) | set(hand1)
                runout = deal_runout(blocked, self._runout_needed, self._rng)
                board = self._config.board + runout
            else:
                board = self._config.board
            # Evaluated once per iteration (full chance outcome -- hole
            # cards AND any sampled runout -- is fixed before any betting
            # is walked) and reused at every terminal this iteration's
            # tree walk reaches, not once per terminal.
            strength0 = evaluate_best(hand0 + board)
            strength1 = evaluate_best(hand1 + board)
            state = BettingRoundState.initial(
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
        state: BettingRoundState,
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


def aggregate_label_strategies(
    trainer: PostflopMccfrTrainer,
    board: tuple[int, ...],
    player: int,
    range_weights: dict[str, float],
    history: tuple[str, ...],
) -> dict[str, dict[str, float]]:
    """Aggregates combo-level average strategies back up to 169-type
    labels, averaged uniformly across each label's unblocked combos --
    the natural way to produce a real per-action-frequency output, now
    that the engine isn't bound by HandRange's one-weight-per-label
    ceiling (see models.py's HandRange docstring and reference_charts.py's
    "known limitation" note on defend charts).

    A label with zero weight in `range_weights`, or whose combos are all
    blocked by `board`, or that never got sampled often enough to reach
    this info set, is simply omitted -- not faked with a guess.
    """
    blocked = frozenset(board)
    result: dict[str, dict[str, float]] = {}
    for label, weight in range_weights.items():
        if weight <= 0:
            continue
        combos = [c for c in label_to_combos(label) if c[0] not in blocked and c[1] not in blocked]
        if not combos:
            continue
        strategies = [
            node.average_strategy()
            for combo in combos
            if (node := trainer.node_map.get(_info_set_key(player, combo, history))) is not None
        ]
        if not strategies:
            continue
        actions = strategies[0].keys()
        result[label] = {a: sum(s[a] for s in strategies) / len(strategies) for a in actions}
    return result


def run_demo(iterations: int = 20_000, seed: int = 1) -> None:
    """Same polarized-range-vs-bluffcatcher scenario test_postflop_mccfr.py
    checks against closed-form numbers -- see that file's module docstring
    for the full derivation. Board Ks Qh 9d 4c 2s (the river -- no runout
    needed), pot_bb=100, effective_stack_bb=25 (exactly the bet_small/
    25%-pot size, so Hero's options collapse to check/all_in and
    Villain's to fold/call). Run directly:

        python -m poker_solver.postflop_mccfr
    """
    board = tuple(parse_card(c) for c in ["Ks", "Qh", "9d", "4c", "2s"])
    config = PostflopSpotConfig(
        board=board,
        pot_bb=100.0,
        effective_stack_bb=25.0,
        range0={"KJo": 1.0},
        range1={"AA": 1.0, "33": 1.0},
        first_to_act=1,
        prior_history=("check",),
    )
    trainer = PostflopMccfrTrainer(config, seed=seed)

    start = time.perf_counter()
    trainer.train(iterations)
    elapsed = time.perf_counter() - start
    print(f"Postflop MCCFR: {iterations:,} iterations in {elapsed:.3f}s")

    def average(player: int, label: str, history: tuple[str, ...]) -> dict[str, float]:
        return aggregate_label_strategies(trainer, board, player, {label: 1.0}, history)[label]

    print()
    print("Hero (AA/33) opening decision, average strategy:")
    print(f"  AA: {average(1, 'AA', ('check',))}")
    print(f"  33: {average(1, '33', ('check',))}  (theory: shove = 25/125 = 0.2)")
    print()
    print("Villain (KJo) facing a shove, average strategy:")
    print(f"  KJo: {average(0, 'KJo', ('check', 'all_in'))}  (theory: call = 100/125 = 0.8)")


if __name__ == "__main__":
    run_demo()
