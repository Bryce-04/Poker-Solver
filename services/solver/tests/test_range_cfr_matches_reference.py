"""The optimized trainer (range_cfr.py) against the frozen straightforward one
(reference_range_cfr.py): same spots, same iteration counts.

This is what makes speed work safe. A faster trainer that quietly changes an
answer fails here, on the spots below, long before it reaches a user. The
closed-form tests in test_range_cfr.py say the answers are *right*; this says
an optimization didn't make them *different*.

Three layers, because the production trainer runs its matrix products in
float32 (for speed) and CFR is chaotic at near-ties -- a 1e-7 rounding
difference in a value can flip which of two equal actions a hand mostly
takes, so comparing two float32 runs strategy-by-strategy is a test of luck,
not of the algorithm:

  1. float64 end to end, in both trainers: the algorithms must agree to ~1e-9.
     This is the real equivalence proof (measured: strategies 1e-10, regrets
     1e-8, exploitability 1e-14 across these spots).
  2. The pieces, in float32, as shipped: every terminal's value against the
     reference's own per-terminal products, and the fast trainer's strategies
     handed to the REFERENCE's evaluator (it must see the same exploitability).
  3. The shipped float32 runs must still agree on what matters: exploitability.
"""

import numpy as np
import pytest
import reference_range_cfr as reference

from poker_solver.betting_round import BetMenu
from poker_solver.cards import parse_card
from poker_solver import range_cfr
from poker_solver.range_cfr import RangeCfrTrainer, RangeSpotConfig


def _board(*cards: str) -> tuple[int, ...]:
    return tuple(parse_card(c) for c in cards)


FLOP_RANGE_OOP = {"AA": 1.0, "KQs": 1.0, "KJs": 0.5, "T9s": 1.0, "55": 1.0, "A5s": 1.0, "QJo": 1.0, "98s": 0.7}
FLOP_RANGE_IP = {"KK": 1.0, "AQs": 1.0, "AKo": 1.0, "98s": 1.0, "66": 1.0, "QTs": 1.0, "A4s": 0.6}

# name -> (config kwargs, iterations)
SPOTS = {
    "flop, default menu": (
        dict(board=_board("Ks", "7h", "2d"), pot_bb=10.0, effective_stack_bb=60.0,
             range0=FLOP_RANGE_OOP, range1=FLOP_RANGE_IP),
        40,
    ),
    "flop, two-tone, deep": (
        dict(board=_board("Qs", "Jh", "7h"), pot_bb=18.5, effective_stack_bb=91.0,
             range0=FLOP_RANGE_OOP, range1=FLOP_RANGE_IP),
        30,
    ),
    "turn, flush arrives": (
        dict(board=_board("Qs", "Jh", "7h", "3h"), pot_bb=12.5, effective_stack_bb=95.0,
             range0=FLOP_RANGE_OOP, range1=FLOP_RANGE_IP),
        40,
    ),
    "river, wide": (
        dict(board=_board("Ks", "7h", "2d", "9c", "4s"), pot_bb=20.0, effective_stack_bb=80.0,
             range0=FLOP_RANGE_OOP, range1=FLOP_RANGE_IP),
        50,
    ),
    "river, polarized closed-form spot": (
        dict(board=_board("Ks", "Qh", "9d", "4c", "2s"), pot_bb=100.0, effective_stack_bb=25.0,
             range0={"KJo": 1.0}, range1={"AA": 1.0, "33": 1.0}, first_to_act=1, prior_history=("check",)),
        100,
    ),
    "flop, seeded bet": (
        dict(board=_board("Ks", "7h", "2d"), pot_bb=10.0, effective_stack_bb=60.0,
             range0=FLOP_RANGE_OOP, range1=FLOP_RANGE_IP, first_to_act=0, prior_history=("bet_small",)),
        40,
    ),
    "flop, custom menu": (
        dict(board=_board("Ks", "7h", "2d"), pot_bb=10.0, effective_stack_bb=60.0,
             range0=FLOP_RANGE_OOP, range1=FLOP_RANGE_IP,
             bet_menu=BetMenu(sizes=(0.33, 0.75), max_aggressive_actions=2)),
        40,
    ),
    "flop, specific-combo keys (twin lookup)": (
        # A pair given as a label in one range and as specific combos in the
        # other lists the same two cards in opposite orders; the blocker
        # bookkeeping must still find the identical combo.
        dict(board=_board("Ks", "7h", "2d"), pot_bb=10.0, effective_stack_bb=60.0,
             range0={"QQ": 1.0, "AhKh": 1.0, "T9s": 1.0},
             range1={"QhQs": 1.0, "QdQc": 1.0, "AA": 1.0, "98s": 1.0}),
        40,
    ),
}


@pytest.fixture(autouse=True)
def _same_discount_parameters(monkeypatch):
    """The reference keeps the pre-optimization STRUCTURE; the DCFR discount
    parameters were retuned separately (benchmarks/sweep_dcfr.py), so the
    reference runs with whatever the real trainer uses. Otherwise these tests
    would compare two different update rules, not two implementations of one."""
    for name in ("_DCFR_ALPHA", "_DCFR_BETA", "_DCFR_GAMMA"):
        monkeypatch.setattr(reference, name, getattr(range_cfr, name))


def _pair(kwargs):
    return (
        RangeCfrTrainer(RangeSpotConfig(**kwargs)),
        reference.RangeCfrTrainer(reference.RangeSpotConfig(**kwargs)),
    )


def _same_tree(fast, ref) -> None:
    assert set(fast._nodes) == set(ref._nodes), "the two trainers built different game trees"
    for history, ref_node in ref._nodes.items():
        assert fast._nodes[history].actions == ref_node.actions
        assert fast._nodes[history].actor == ref_node.actor


def _use_float64(fast, ref, monkeypatch) -> None:
    """Make BOTH trainers do all their arithmetic in float64. The reference also
    casts each reach vector to float32 before every product, so that's undone."""

    def products64(self):
        if self._products is None:
            stacked = self._matrix @ self.vector
            half = stacked.shape[0] // 2
            self._products = (stacked[:half].astype(np.float64), stacked[half:].astype(np.float64))
        return self._products

    monkeypatch.setattr(reference._OpponentReach, "products", products64)
    ref._payoff = tuple(m.astype(np.float64) for m in ref._payoff)
    fast._payoff = tuple(m.astype(np.float64) for m in fast._payoff)
    fast._win = (fast._payoff[0][: len(fast.combos[0])], fast._payoff[1][: len(fast.combos[1])])


# --- 1. the algorithm, exactly ---------------------------------------------------


@pytest.mark.parametrize("name", list(SPOTS))
def test_the_algorithm_matches_the_reference_in_float64(name: str, monkeypatch) -> None:
    kwargs, iterations = SPOTS[name]
    fast, ref = _pair(kwargs)
    _use_float64(fast, ref, monkeypatch)
    fast.train(iterations)
    ref.train(iterations)

    _same_tree(fast, ref)
    for history, ref_node in ref._nodes.items():
        fast_node = fast._nodes[history]
        np.testing.assert_allclose(
            fast_node.regret, ref_node.regret, rtol=1e-6, atol=1e-6, err_msg=f"regret at {history!r}"
        )
        np.testing.assert_allclose(
            fast_node.average_strategy(),
            ref_node.average_strategy(),
            atol=1e-6,
            err_msg=f"average strategy at {history!r}",
        )
    assert fast.exploitability() == pytest.approx(ref.exploitability(), rel=1e-9, abs=1e-9)
    for player in (0, 1):
        assert fast.best_response_value(player) == pytest.approx(
            ref.best_response_value(player), rel=1e-9, abs=1e-9
        )


# --- 2. the pieces, as shipped (float32) -------------------------------------------


@pytest.mark.parametrize("name", list(SPOTS))
def test_every_terminals_value_matches_the_references(name: str) -> None:
    kwargs, _ = SPOTS[name]
    fast, ref = _pair(kwargs)
    rng = np.random.default_rng(7)
    for player in (0, 1):
        vectors = rng.random((len(fast.combos[1 - player]), 6))
        win, facing = fast._mass_vs(player, vectors)
        for column in range(vectors.shape[1]):
            ref_win, ref_facing = ref._opponent_reach(player, vectors[:, column]).products()
            # float32 matrices: agreement to float32 precision, relative to the scale.
            np.testing.assert_allclose(win[:, column], ref_win, rtol=1e-5, atol=1e-5 * max(1.0, ref_win.max()))
            np.testing.assert_allclose(
                facing[:, column], ref_facing, rtol=1e-5, atol=1e-5 * max(1.0, ref_facing.max())
            )


@pytest.mark.parametrize("name", list(SPOTS))
def test_the_references_evaluator_agrees_with_ours_on_our_strategies(name: str) -> None:
    kwargs, iterations = SPOTS[name]
    fast, ref = _pair(kwargs)
    fast.train(iterations)
    # Hand the fast trainer's regrets and strategy sums to the reference and let
    # IT measure exploitability. Same strategies, two independent evaluators.
    for history, node in fast._nodes.items():
        copy = reference._PublicNode(node.actions, node.actor, len(fast.combos[node.actor]))
        copy.regret, copy.strategy_sum = node.regret.copy(), node.strategy_sum.copy()
        ref._nodes[history] = copy
    assert ref.exploitability() == pytest.approx(fast.exploitability(), rel=1e-3, abs=1e-4)


# --- 3. the shipped runs agree on what matters --------------------------------------


@pytest.mark.parametrize("name", list(SPOTS))
def test_shipped_float32_runs_reach_the_same_precision(name: str) -> None:
    kwargs, iterations = SPOTS[name]
    fast, ref = _pair(kwargs)
    fast.train(iterations)
    ref.train(iterations)
    _same_tree(fast, ref)
    # Not equal to the bit (rounding steers tied actions differently), but the
    # same quality of answer: both converge, to within a few percent of each other.
    assert fast.exploitability() == pytest.approx(ref.exploitability(), rel=0.15, abs=0.01)


def test_train_until_stops_in_about_the_same_place() -> None:
    kwargs, _ = SPOTS["flop, default menu"]
    fast, ref = _pair(kwargs)
    fast_pct = fast.train_until(1.0, max_iterations=300)
    ref_pct = ref.train_until(1.0, max_iterations=300)
    assert abs(fast.iterations - ref.iterations) <= 25  # at most one check interval apart
    assert fast_pct < 1.0 and ref_pct < 1.0
