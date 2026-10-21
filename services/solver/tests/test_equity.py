"""equity.py's matrix, checked against independent per-pair brute force
(evaluate_best directly, exactly as test_runout_equity.py already does
for its single flush-draw-vs-overpair scenario) rather than against
itself."""

import itertools
import math

import numpy as np
import pytest

from poker_solver.cards import FULL_DECK, parse_card
from poker_solver.equity import compute_equity_matrix
from poker_solver.evaluator import evaluate_best


def _cards(*texts: str) -> tuple[int, ...]:
    return tuple(parse_card(t) for t in texts)


def _brute_force_equity(hero, villain, board) -> float:
    """Same exact-enumeration reference test_runout_equity.py uses."""
    blocked = frozenset(board) | set(hero) | set(villain)
    remaining = [c for c in FULL_DECK if c not in blocked]
    wins = ties = total = 0
    for runout in itertools.combinations(remaining, 5 - len(board)):
        full = board + runout
        h, v = evaluate_best(hero + full), evaluate_best(villain + full)
        total += 1
        if h > v:
            wins += 1
        elif h == v:
            ties += 1
    return (wins + ties / 2) / total


def test_river_cells_are_exact_win_tie_loss() -> None:
    board = _cards("Ks", "Qh", "9d", "4c", "2s")
    aa = _cards("Ah", "Ad")  # overpair, beats KJ
    kj = _cards("Kh", "Jc")  # top pair
    three = _cards("3h", "3d")  # loses to KJ
    m = compute_equity_matrix([aa, three], [kj], board)
    assert m[0, 0] == 1.0
    assert m[1, 0] == 0.0


def test_river_tie_is_half() -> None:
    board = _cards("Ks", "Kh", "Kd", "Kc", "As")  # quads + ace on board -- everyone plays the board
    m = compute_equity_matrix([_cards("2h", "3h")], [_cards("4d", "5d")], board)
    assert m[0, 0] == 0.5


def test_sharing_a_card_is_masked_not_zero() -> None:
    board = _cards("Ks", "Qh", "9d", "4c", "2s")
    hero = _cards("Ah", "Ad")
    villain_shares = _cards("Ah", "Kc")  # shares the Ah
    villain_clean = _cards("Jc", "Tc")
    m = compute_equity_matrix([hero], [villain_shares, villain_clean], board)
    assert math.isnan(m[0, 0])
    assert not math.isnan(m[0, 1])


def test_turn_matches_brute_force_exactly() -> None:
    # Turn has few enough runouts that equity.py enumerates them exactly
    # -- so this should match brute force to float precision, not a
    # sampling tolerance. Also exercises per-runout blocking: a river
    # card that one of these hands holds must be excluded for that pair.
    board = _cards("2c", "7d", "Jh", "3s")
    hero = _cards("Ah", "Kh")
    villain = _cards("Qd", "Qc")
    m = compute_equity_matrix([hero], [villain], board)
    assert abs(m[0, 0] - _brute_force_equity(hero, villain, board)) < 1e-12


def test_turn_matrix_matches_brute_force_for_every_pair() -> None:
    # Several hands per side, including ones that block each other's
    # outs, so per-pair denominators genuinely differ.
    board = _cards("2c", "7d", "Jh", "3s")
    heroes = [_cards("Ah", "Kh"), _cards("Th", "9h"), _cards("Js", "Jc")]
    villains = [_cards("Qd", "Qc"), _cards("Ad", "Jd"), _cards("Kh", "Kc")]
    m = compute_equity_matrix(heroes, villains, board)
    for i, h in enumerate(heroes):
        for j, v in enumerate(villains):
            if set(h) & set(v):
                assert math.isnan(m[i, j])
            else:
                assert abs(m[i, j] - _brute_force_equity(h, v, board)) < 1e-12


def test_flop_matches_brute_force_exactly() -> None:
    # test_runout_equity.py's flush-draw-vs-overpair scenario (~29%) --
    # the flop path enumerates all 990 runouts, so this is exact too.
    board = _cards("2c", "7d", "Jh")
    hero = _cards("Ah", "Kh")
    villain = _cards("Qd", "Qc")
    m = compute_equity_matrix([hero], [villain], board)
    assert abs(m[0, 0] - _brute_force_equity(hero, villain, board)) < 1e-12


def test_flop_matrix_matches_brute_force_for_every_pair() -> None:
    # Hands that block each other's outs, so per-pair denominators differ.
    board = _cards("2c", "7d", "Jh")
    heroes = [_cards("Ah", "Kh"), _cards("8h", "9h"), _cards("Js", "Jc")]
    villains = [_cards("Qd", "Qc"), _cards("Ad", "Jd"), _cards("Kh", "Kc")]
    m = compute_equity_matrix(heroes, villains, board)
    for i, h in enumerate(heroes):
        for j, v in enumerate(villains):
            if set(h) & set(v):
                assert math.isnan(m[i, j])
            else:
                assert abs(m[i, j] - _brute_force_equity(h, v, board)) < 1e-12


# --- the optimized matrix against the original algorithm --------------------------


def _reference_equity_matrix(combos0, combos1, board):
    """The equity matrix exactly as it was computed before the 2026-10-21 speed
    work: one runout at a time, a mask applied to every comparison. Kept here as
    the oracle the vectorized version must equal."""
    import itertools

    from poker_solver.cards import FULL_DECK
    from poker_solver.equity import card_membership, collision_mask
    from poker_solver.evaluator import evaluate_seven_batch

    holes0 = np.array(combos0, dtype=np.int64).reshape(-1, 2)
    holes1 = np.array(combos1, dtype=np.int64).reshape(-1, 2)
    member0, member1 = card_membership(combos0), card_membership(combos1)
    pair_ok = ~collision_mask(combos0, combos1)
    available = [c for c in FULL_DECK if c not in frozenset(board)]
    shape = (len(combos0), len(combos1))
    win, tie, count = (np.zeros(shape, dtype=np.int32) for _ in range(3))
    for runout in itertools.combinations(available, 5 - len(board)):
        full_board = board + runout
        idx = list(runout)
        live0 = member0[:, idx].sum(axis=1) == 0 if idx else np.ones(len(combos0), bool)
        live1 = member1[:, idx].sum(axis=1) == 0 if idx else np.ones(len(combos1), bool)
        scores0 = evaluate_seven_batch(holes0, full_board)
        scores1 = evaluate_seven_batch(holes1, full_board)
        valid = live0[:, None] & live1[None, :] & pair_ok
        count += valid
        win += (scores0[:, None] > scores1[None, :]) & valid
        tie += (scores0[:, None] == scores1[None, :]) & valid
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(count > 0, (win + tie / 2) / count, np.nan)


def _random_combos(rng, board, size):
    from poker_solver.combos import expand_range_to_combos

    labels = {}
    ranks = "AKQJT98765432"
    for _ in range(size):
        a, b = rng.choice(13, size=2)
        label = ranks[a] + ranks[b] if a == b else ranks[min(a, b)] + ranks[max(a, b)] + rng.choice(["s", "o"])
        labels[label] = 1.0
    return [combo for combo, _ in expand_range_to_combos(labels, frozenset(board))]


@pytest.mark.parametrize("board_text", ["Ks 7h 2d", "Qs Jh 7h 3h", "Ks 7h 2d 9c 4s", "9h 6h 2h"])
def test_the_vectorized_matrix_equals_the_original_algorithm_exactly(board_text):
    from poker_solver.cards import parse_card

    rng = np.random.default_rng(11)
    board = tuple(parse_card(c) for c in board_text.split())
    combos0 = _random_combos(rng, board, 14)
    combos1 = _random_combos(rng, board, 14)
    fast = compute_equity_matrix(combos0, combos1, board)
    slow = _reference_equity_matrix(combos0, combos1, board)
    assert fast.shape == slow.shape
    # Exactly equal, NaNs (shared-card pairs) in the same places.
    np.testing.assert_array_equal(np.isnan(fast), np.isnan(slow))
    np.testing.assert_array_equal(fast[~np.isnan(fast)], slow[~np.isnan(slow)])


# --- the cache ----------------------------------------------------------------------


def test_the_same_inputs_return_the_cached_matrix_and_it_cannot_be_modified():
    from poker_solver import equity

    board = tuple(parse_card(c) for c in "Ks 7h 2d".split())
    combos0 = [(parse_card("As"), parse_card("Ah")), (parse_card("Qc"), parse_card("Qd"))]
    combos1 = [(parse_card("Jc"), parse_card("Jd")), (parse_card("9h"), parse_card("8h"))]
    first = equity.compute_equity_matrix(combos0, combos1, board)
    again = equity.compute_equity_matrix(list(combos0), list(combos1), board)
    assert again is first  # same inputs, even as different list objects
    with pytest.raises(ValueError):
        first[0, 0] = 0.5
    # A different board is a different matrix.
    other = equity.compute_equity_matrix(combos0, combos1, tuple(parse_card(c) for c in "Ks 7h 3d".split()))
    assert other is not first


def test_the_cache_is_bounded_by_bytes(monkeypatch):
    from poker_solver import equity

    monkeypatch.setattr(equity, "_CACHE_MAX_BYTES", 4000)  # ~ a few tiny matrices
    monkeypatch.setattr(equity, "_cache", equity.OrderedDict())
    combos0 = [(parse_card("As"), parse_card("Ah"))]
    combos1 = [(parse_card("Jc"), parse_card("Jd"))]
    for third in ("2d", "3d", "4d", "5d", "6d", "8d"):
        equity.compute_equity_matrix(combos0, combos1, tuple(parse_card(c) for c in ("Ks", "7h", third)))
    assert sum(m.nbytes for m in equity._cache.values()) <= 4000 or len(equity._cache) == 1
