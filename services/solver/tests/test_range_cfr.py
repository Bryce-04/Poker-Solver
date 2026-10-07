"""range_cfr.py, checked three ways: closed-form poker theory (the same
polarized-range-vs-bluffcatcher river test_postflop_mccfr.py uses -- but
with no sampling noise left to tolerate, so the tolerance is 1%, not 5%),
direct checks of card removal, and a regression test for the bug that
motivated replacing postflop_mccfr.py at all (docs/decisions.md,
2026-10-07): wide realistic ranges, a 4bb pot, 96bb stacks."""

import json
from pathlib import Path

import numpy as np

from poker_solver.cards import parse_card
from poker_solver.range_cfr import RangeCfrTrainer, RangeSpotConfig

FIXTURES = Path(__file__).parent / "fixtures"


def _board(*texts: str) -> tuple[int, ...]:
    return tuple(parse_card(t) for t in texts)


# --- closed-form theory --------------------------------------------------
# See test_postflop_mccfr.py's module docstring for the derivation: with
# pot=100 and a forced 25bb shove, the bluff (33) shoves 25/125 = 20% and
# the bluffcatcher (KJo) calls 100/125 = 80%.

RIVER = _board("Ks", "Qh", "9d", "4c", "2s")


def _river_trainer() -> RangeCfrTrainer:
    return RangeCfrTrainer(
        RangeSpotConfig(
            board=RIVER,
            pot_bb=100.0,
            effective_stack_bb=25.0,
            range0={"KJo": 1.0},
            range1={"AA": 1.0, "33": 1.0},
            first_to_act=1,
            prior_history=("check",),
        )
    )


def test_matches_closed_form_bluff_and_call_frequencies() -> None:
    trainer = _river_trainer()
    trainer.train(300)
    hero = trainer.label_strategies()
    villain = trainer.label_strategies(("check", "all_in"))
    assert hero["AA"]["all_in"] > 0.99
    assert abs(hero["33"]["all_in"] - 0.2) < 0.01
    assert abs(villain["KJo"]["call"] - 0.8) < 0.01


def test_exploitability_shrinks_toward_zero() -> None:
    trainer = _river_trainer()
    trainer.train(20)
    early = trainer.exploitability()
    trainer.train(480)
    late = trainer.exploitability()
    assert late < early
    assert late < 0.05  # bb, on a 100bb pot


def test_every_label_in_range_gets_a_strategy() -> None:
    # The old trainer silently dropped labels that never got sampled; this
    # one trains every combo every iteration, so nothing goes missing.
    trainer = _river_trainer()
    trainer.train(10)
    assert set(trainer.label_strategies()) == {"AA", "33"}


# --- card removal ---------------------------------------------------------


def test_card_removal_shrinks_the_opponent_range_correctly() -> None:
    # Each AA combo holds two of the four aces, so of villain's 16 AK
    # combos, the 8 containing one of those aces are impossible.
    trainer = RangeCfrTrainer(
        RangeSpotConfig(
            board=_board("7h", "2d", "9c", "4s", "3h"),
            pot_bb=10.0,
            effective_stack_bb=50.0,
            range0={"AA": 1.0},
            range1={"AKs": 1.0, "AKo": 1.0},
        )
    )
    _, facing = trainer._opponent_reach(0, trainer.weights[1]).products()
    assert np.allclose(facing, 8.0)


def test_terminal_values_match_brute_force() -> None:
    # Showdown value of each hero combo vs the whole villain range, from
    # the trainer's matrices, against summing pair by pair by hand.
    from poker_solver.betting_round import BettingRoundState
    from poker_solver.evaluator import evaluate_best

    board = _board("Ks", "Qh", "9d", "4c", "2s")
    trainer = RangeCfrTrainer(
        RangeSpotConfig(
            board=board,
            pot_bb=10.0,
            effective_stack_bb=50.0,
            range0={"AKo": 1.0, "QJs": 1.0},
            range1={"KQo": 1.0, "99": 1.0},
        )
    )
    state = BettingRoundState.initial(10.0, 50.0).apply("check").apply("check")
    reach = trainer.weights[1]
    values = trainer._terminal_value(state, 0, trainer._opponent_reach(0, reach))
    for i, hero in enumerate(trainer.combos[0]):
        expected = 0.0
        for j, villain in enumerate(trainer.combos[1]):
            if set(hero) & set(villain):
                continue
            h, v = evaluate_best(hero + board), evaluate_best(villain + board)
            share = 1.0 if h > v else 0.5 if h == v else 0.0
            expected += reach[j] * (share * 10.0)
        # float32 payoff matrices (deliberately, for speed) -- so agreement
        # is to float32 precision, not float64's.
        assert abs(values[i] - expected) < 1e-4


# --- seeded actions -------------------------------------------------------


def test_solving_facing_a_seeded_bet_uses_the_bet_in_pot_math() -> None:
    trainer = RangeCfrTrainer(
        RangeSpotConfig(
            board=RIVER,
            pot_bb=100.0,
            effective_stack_bb=200.0,
            range0={"AA": 1.0, "33": 1.0},
            range1={"KJo": 1.0},
            first_to_act=1,
            prior_history=("bet_medium",),
        )
    )
    assert trainer.root.contributed == (75.0, 0.0)
    trainer.train(50)
    actions, _ = trainer.average_strategy()
    assert actions[:2] == ("fold", "call")


# --- the bug this replaced ------------------------------------------------


def test_regression_wide_ranges_deep_stacks_dont_jam_absurdly() -> None:
    # The exact scenario that exposed the old trainer: BB's defend range
    # vs BTN's open range, 4bb pot, 96bb behind, BB first to act on a dry
    # flop. At its production setting the old trainer reported AA jamming
    # 70%, J9s 84%, K6s 8% -- noise, not strategy. Converged, almost
    # nothing should shove 24x pot.
    bb = json.loads((FIXTURES / "bb_defend_vs_btn_100bb.json").read_text())
    btn = json.loads((FIXTURES / "btn_open_100bb.json").read_text())
    trainer = RangeCfrTrainer(
        RangeSpotConfig(board=_board("7h", "2d", "9c"), pot_bb=4.0, effective_stack_bb=96.0, range0=bb, range1=btn)
    )
    trainer.train(100)
    strategies = trainer.label_strategies()
    assert strategies["K6s"]["all_in"] < 0.02
    assert max(s["all_in"] for s in strategies.values()) < 0.2
    assert np.mean([s["all_in"] for s in strategies.values()]) < 0.05
    assert trainer.exploitability() / 4.0 < 0.05  # under 5% of the pot


def test_train_until_stops_once_precise_enough() -> None:
    trainer = _river_trainer()
    reached = trainer.train_until(target_pct_of_pot=0.5, max_iterations=2_000, check_every=25)
    assert reached < 0.5
    assert trainer.iterations < 2_000  # stopped early, didn't run to the cap
    assert trainer.iterations % 25 == 0


def test_train_until_respects_the_cap() -> None:
    trainer = _river_trainer()
    trainer.train_until(target_pct_of_pot=0.0, max_iterations=60, check_every=25)
    assert trainer.iterations == 60  # 25 + 25 + a final partial 10


def test_train_until_stops_at_a_deadline_and_reports_honestly() -> None:
    import time

    trainer = _river_trainer()
    reached = trainer.train_until(
        target_pct_of_pot=0.0, max_iterations=10_000, deadline=time.perf_counter()
    )
    assert trainer.iterations == 1  # one iteration, then the (already past) deadline
    assert reached > 0  # a real, un-converged number -- not a pretend success
