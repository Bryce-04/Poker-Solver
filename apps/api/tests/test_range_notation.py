from app.range_notation import expand_range


def test_pair_plus_range():
    hands = expand_range(["77+"])
    assert set(hands) == {"77", "88", "99", "TT", "JJ", "QQ", "KK", "AA"}


def test_single_pair_no_plus():
    assert set(expand_range(["TT"])) == {"TT"}


def test_suited_plus_range():
    hands = expand_range(["A9s+"])
    assert set(hands) == {"A9s", "ATs", "AJs", "AQs", "AKs"}


def test_offsuit_plus_range():
    hands = expand_range(["K9o+"])
    assert set(hands) == {"K9o", "KTo", "KJo", "KQo"}


def test_single_suited_hand():
    assert set(expand_range(["AKs"])) == {"AKs"}


def test_every_hand_weighted_full():
    hands = expand_range(["22+", "A2s+"])
    assert all(weight == 1.0 for weight in hands.values())


def test_overlapping_tokens_dont_inflate_the_range():
    # "AA" is already covered by "77+" -- overlap should be a no-op, not
    # double-count or otherwise change the result.
    with_overlap = expand_range(["77+", "AA"])
    without_overlap = expand_range(["77+"])
    assert set(with_overlap) == set(without_overlap)
