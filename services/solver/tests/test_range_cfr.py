"""range_cfr.py, checked three ways: closed-form poker theory (the same
polarized-range-vs-bluffcatcher river test_postflop_mccfr.py uses -- but
with no sampling noise left to tolerate, so the tolerance is 1%, not 5%),
direct checks of card removal, and a regression test for the bug that
motivated replacing postflop_mccfr.py at all (docs/decisions.md,
2026-10-07): wide realistic ranges, a 4bb pot, 96bb stacks."""

import json
from pathlib import Path

import numpy as np
import pytest

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


# --- posterior ranges (chaining a street's result into the next) -----------


def test_posterior_ranges_match_closed_form_after_shove_and_call() -> None:
    # Same spot as the closed-form test (the seeded check is the root, so
    # the line starts at villain's decision): AA always shoves, 33 shoves
    # 20%, KJo calls 80%. After all_in -> call, IP's range is AA at full
    # weight and 33 at ~0.2, and OOP's KJo at its call frequency.
    trainer = _river_trainer()
    trainer.train(300)
    oop, ip = trainer.posterior_ranges(("all_in", "call"))
    assert abs(ip["AA"] - 1.0) < 0.01
    assert abs(ip["33"] - 0.2) < 0.01
    assert abs(oop["KJo"] - 0.8) < 0.01


def test_posterior_of_an_empty_line_is_the_prior() -> None:
    trainer = _river_trainer()
    trainer.train(50)
    oop, ip = trainer.posterior_ranges(())
    assert oop == {"KJo": 1.0} and ip == {"AA": 1.0, "33": 1.0}


def test_posterior_rejects_an_illegal_line() -> None:
    trainer = _river_trainer()
    trainer.train(5)
    with pytest.raises(ValueError):
        trainer.posterior_ranges(("fold",))  # nothing to fold to after a check


# --- combo-level ranges ----------------------------------------------------


def test_combo_key_overrides_its_label_weight() -> None:
    from poker_solver.combos import expand_range

    # AKs minus the heart combo, plus a lone off-suit combo at half weight.
    expanded = expand_range({"AKs": 1.0, "AhKh": 0.0, "AsKd": 0.5})
    assert len(expanded) == 4  # 3 suited + the one off-suit combo
    assert sorted(label for _, _, label in expanded) == ["AKo", "AKs", "AKs", "AKs"]
    assert sorted(w for _, w, _ in expanded) == [0.5, 1.0, 1.0, 1.0]
    # Order in the dict must not matter.
    assert sorted(expand_range({"AhKh": 0.0, "AKs": 1.0})) == sorted(
        expand_range({"AKs": 1.0, "AhKh": 0.0})
    )


def test_combo_key_rejects_garbage() -> None:
    from poker_solver.combos import expand_range

    for bad in ("AhAh", "AhKz", "AhKhX", "Ah"):
        with pytest.raises(ValueError):
            expand_range({bad: 1.0})


def test_solver_accepts_a_specific_combo_range() -> None:
    # Only the nut-flush-draw combo in villain's range: the strategy comes
    # back labeled by its 169 type, with exactly one combo behind it.
    trainer = RangeCfrTrainer(
        RangeSpotConfig(
            board=_board("7h", "2h", "9c"),
            pot_bb=10.0,
            effective_stack_bb=40.0,
            range0={"AhKh": 1.0},
            range1={"QQ": 1.0},
        )
    )
    assert len(trainer.combos[0]) == 1
    trainer.train(5)
    assert set(trainer.label_strategies()) == {"AKs"}


def test_posterior_keeps_combos_apart_when_blockers_make_them_differ() -> None:
    # Flop with two hearts: Ah-Kh has the nut flush draw, the other AKs
    # combos don't, so a solved strategy treats them differently and the
    # posterior after a bet must not average them into one 'AKs' weight.
    trainer = RangeCfrTrainer(
        RangeSpotConfig(
            board=_board("7h", "2h", "9c"),
            pot_bb=10.0,
            effective_stack_bb=40.0,
            range0={"AKs": 1.0, "QQ": 1.0, "55": 1.0},
            range1={"AA": 1.0, "KQs": 1.0, "JTs": 1.0},
        )
    )
    trainer.train(60)
    oop, _ = trainer.posterior_ranges(("bet_medium",))
    assert "AKs" not in oop
    assert {"AhKh", "AsKs"} <= set(oop)
    assert abs(oop["AhKh"] - oop["AsKs"]) > 1e-3


def test_posterior_does_not_resurrect_an_excluded_combo() -> None:
    trainer = RangeCfrTrainer(
        RangeSpotConfig(
            board=RIVER,
            pot_bb=100.0,
            effective_stack_bb=25.0,
            range0={"KJo": 1.0, "KJs": 1.0, "KhJh": 0.0},
            range1={"AA": 1.0, "33": 1.0},
            first_to_act=1,
            prior_history=("check",),
        )
    )
    trainer.train(5)
    oop, _ = trainer.posterior_ranges(())
    assert "KhJh" not in oop  # absent (excluded), not 0.0
    # KJs lost KhJh (excluded) and KsJs (the board's Ks), so a label key
    # would bring KhJh back -- the two live combos are listed instead.
    assert "KJs" not in oop
    assert sorted(k for k in oop if k[0] == "K" and k[2] == "J" and k[1] == k[3]) == ["KcJc", "KdJd"]


def test_line_probability_matches_closed_form_and_flags_unplayed_lines() -> None:
    trainer = _river_trainer()
    trainer.train(300)
    oop, ip = trainer.line_probability(("all_in", "call"))
    # IP shoves AA always and 33 20% of the time -> (1 + 0.2) / 2 of its range;
    # OOP's lone KJo calls 80%.
    assert abs(ip - 0.6) < 0.01
    assert abs(oop - 0.8) < 0.01
    assert trainer.line_probability(()) == (1.0, 1.0)


def test_combo_strategies_split_flush_draw_combos_from_the_rest() -> None:
    # IP acts after a check on a two-heart flop. KhQh has a flush draw the
    # other KQs combos lack, so they play differently and all four are
    # reported; hand types whose combos play alike are left out entirely.
    trainer = RangeCfrTrainer(
        RangeSpotConfig(
            board=_board("7h", "2h", "9c"),
            pot_bb=10.0,
            effective_stack_bb=40.0,
            range0={"QQ": 1.0, "JTs": 1.0, "88": 1.0, "A5s": 1.0, "K3o": 1.0},
            range1={"AKs": 1.0, "KQs": 1.0, "AA": 1.0, "77": 1.0, "JJ": 1.0, "T9s": 1.0},
            first_to_act=1,
            prior_history=("check",),
        )
    )
    trainer.train(150)
    combos = trainer.combo_strategies()
    assert {"KhQh", "KsQs", "KdQd", "KcQc"} <= set(combos)
    assert all(abs(sum(p.values()) - 1) < 1e-6 for p in combos.values())
    assert combos["KhQh"] != combos["KsQs"]
    # A reported hand type is reported whole, never one combo of it.
    from poker_solver.combos import combo_label, key_to_combos

    by_label: dict[str, int] = {}
    for key in combos:
        label = combo_label(key_to_combos(key)[0])
        by_label[label] = by_label.get(label, 0) + 1
    assert by_label["KQs"] == 4
