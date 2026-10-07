"""equity.py's matrix, checked against independent per-pair brute force
(evaluate_best directly, exactly as test_runout_equity.py already does
for its single flush-draw-vs-overpair scenario) rather than against
itself."""

import itertools
import math

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
