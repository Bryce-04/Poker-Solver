from poker_solver_schema import ActionType, BettingAction, Position, Spot, Street

from app.reference_charts import find_matching_chart


def _spot(**overrides) -> Spot:
    defaults = {"positions_in_hand": [Position.UTG], "effective_stack_bb": 100}
    return Spot(**{**defaults, **overrides})


def _facing_open_from(position: Position) -> list[BettingAction]:
    return [
        BettingAction(
            position=position, street=Street.PREFLOP, action=ActionType.RAISE, size_bb=2.5
        )
    ]


def test_matches_each_opener_position_at_100bb():
    expected = {
        Position.UTG: "utg_open_100bb",
        Position.HJ: "hj_open_100bb",
        Position.CO: "co_open_100bb",
        Position.BTN: "btn_open_100bb",
        Position.SB: "sb_open_100bb",
    }
    for position, chart_key in expected.items():
        chart = find_matching_chart(_spot(positions_in_hand=[position], effective_stack_bb=100))
        assert chart is not None
        assert chart.key == chart_key


def test_matches_each_opener_position_at_40bb():
    expected = {
        Position.UTG: "utg_open_40bb",
        Position.HJ: "hj_open_40bb",
        Position.CO: "co_open_40bb",
        Position.BTN: "btn_open_40bb",
        Position.SB: "sb_open_40bb",
    }
    for position, chart_key in expected.items():
        chart = find_matching_chart(_spot(positions_in_hand=[position], effective_stack_bb=40))
        assert chart is not None
        assert chart.key == chart_key


def test_matches_every_known_defend_pair_at_both_buckets():
    pairs = {
        (Position.UTG, Position.BB): "bb_defend_vs_utg_open",
        (Position.HJ, Position.BTN): "btn_defend_vs_hj_open",
        (Position.HJ, Position.BB): "bb_defend_vs_hj_open",
        (Position.CO, Position.BTN): "btn_defend_vs_co_open",
        (Position.CO, Position.SB): "sb_defend_vs_co_open",
        (Position.CO, Position.BB): "bb_defend_vs_co_open",
        (Position.BTN, Position.SB): "sb_defend_vs_btn_open",
        (Position.BTN, Position.BB): "bb_defend_vs_btn_open",
        (Position.SB, Position.BB): "bb_defend_vs_sb_open",
    }
    for bucket, stack in (("100bb", 100), ("40bb", 40)):
        for (opener, defender), chart_key_prefix in pairs.items():
            spot = _spot(
                positions_in_hand=[defender],
                effective_stack_bb=stack,
                actions=_facing_open_from(opener),
            )
            chart = find_matching_chart(spot)
            assert chart is not None, f"{opener} -> {defender} at {bucket} should have matched"
            assert chart.key == f"{chart_key_prefix}_{bucket}"


def test_bb_can_defend_against_every_6max_opener_at_both_buckets():
    # BB is the one seat that closes the action against any opener, so it
    # should have a defend chart versus all five 6-max opening positions.
    for bucket, stack in (("100bb", 100), ("40bb", 40)):
        for opener in (Position.UTG, Position.HJ, Position.CO, Position.BTN, Position.SB):
            chart = find_matching_chart(
                _spot(
                    positions_in_hand=[Position.BB],
                    effective_stack_bb=stack,
                    actions=_facing_open_from(opener),
                )
            )
            assert chart is not None, f"BB should defend vs {opener} open at {bucket}"
            assert chart.key == f"bb_defend_vs_{opener.value.lower()}_open_{bucket}"


def test_40bb_and_100bb_charts_are_actually_different():
    # Sanity check that the two buckets aren't accidentally sharing content
    # (e.g. a copy-paste that didn't get trimmed).
    open_100 = find_matching_chart(_spot(effective_stack_bb=100))
    open_40 = find_matching_chart(_spot(effective_stack_bb=40))
    assert open_100.ranges != open_40.ranges


def test_no_chart_for_a_defend_pair_with_no_entry_yet():
    # UTG facing a BTN open (a 3bet-or-fold-ish spot, not in the table yet)
    # shouldn't fall back to some other chart -- it should be no match.
    spot = _spot(positions_in_hand=[Position.UTG], actions=_facing_open_from(Position.BTN))
    assert find_matching_chart(spot) is None


def test_no_chart_for_bb_with_no_action_yet():
    # BB can't be "first in" -- there's no reference chart for this, and
    # there shouldn't be a false match against the defend chart either.
    assert find_matching_chart(_spot(positions_in_hand=[Position.BB])) is None


def test_no_chart_for_position_facing_a_call_instead_of_a_raise():
    spot = _spot(
        positions_in_hand=[Position.BB],
        actions=[
            BettingAction(
                position=Position.BTN, street=Street.PREFLOP, action=ActionType.CALL
            )
        ],
    )
    assert find_matching_chart(spot) is None


def test_no_chart_between_stack_buckets():
    # 65bb falls between the 40bb (30-50) and 100bb (80-120) buckets --
    # should match nothing rather than snapping to the nearest one.
    assert find_matching_chart(_spot(effective_stack_bb=65)) is None


def test_no_chart_far_outside_any_bucket():
    assert find_matching_chart(_spot(effective_stack_bb=10)) is None
    assert find_matching_chart(_spot(effective_stack_bb=250)) is None


def test_no_chart_postflop():
    assert find_matching_chart(_spot(current_street=Street.FLOP)) is None


def test_no_chart_for_full_ring_only_seats():
    # UTG1 and LJ are full-ring positions -- deliberately out of Stage 2's
    # 6-max scope (see reference_charts.py module docstring). They must not
    # match, nor fall back to a neighbouring seat's chart.
    for seat in (Position.UTG1, Position.LJ):
        assert find_matching_chart(_spot(positions_in_hand=[seat], effective_stack_bb=100)) is None
        assert find_matching_chart(_spot(positions_in_hand=[seat], effective_stack_bb=40)) is None
