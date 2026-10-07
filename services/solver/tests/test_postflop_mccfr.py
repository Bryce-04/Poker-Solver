"""The MCCFR analogue of test_kuhn_spike.py's known-equilibrium check, for
the real solver (postflop_mccfr.py) instead of a toy game.

River scenario -- a full closed-form check, no runout involved:

Board Ks Qh 9d 4c 2s (no ace or 3 on board, and only two spades so a flush
is never reachable -- hole-card suits never matter to any comparison
here). Villain (OOP) already checked; their whole range is a single
bluffcatcher, KJo (pairs the board's king). Hero (IP) is purely polarized:
AA (the nut overpair, always beats KJo) or 33 (bottom pair, always loses
to KJo) -- no in-between hands, and neither rank is on the board, so both
labels are fully unblocked (6 combos each, value combos == bluff combos).

pot_bb=100, effective_stack_bb=33 -- exactly the 33%-pot size, which
collapses Hero's options to {check, all_in} and Villain's response to
{fold, call} (see test_betting_round.py's menu-collapse tests). That turns
this into a textbook polarized-range-vs-bluffcatcher push/fold subgame,
whose Nash equilibrium frequencies are derivable in closed form from the
indifference principle:

  - Villain's calling frequency must make Hero's bluff (33) exactly
    indifferent between shoving and checking back:
    (1 - c)*pot_bb + c*(-shove) = 0  =>  c* = pot_bb / (pot_bb + shove)
  - Hero's bluffing frequency must make Villain's call exactly
    indifferent between calling and folding (value combos == bluff
    combos, so this reduces cleanly):
    beta* = shove / (pot_bb + shove)

With pot_bb=100, shove=33: c* = 100/133 ~= 0.7519, beta* = 33/133 ~= 0.2481.

Flop/turn scenarios below don't attempt the same two-sided closed-form
match -- once a runout is involved, the villain's own hand strength also
varies by runout, which makes the clean "value always wins / bluff always
loses" symmetry much harder to hand-derive in general (see the module
docstring in test_runout_equity.py for where the rigor for the *runout
sampling itself* actually lives). Instead, these pick a value hand that's
locked (immune to the runout) and check one-sided dominance, the same
style Kuhn's own test suite uses for its non-unique equilibrium family
(test_king_always_continues_facing_a_bet).
"""

from poker_solver.cards import parse_card
from poker_solver.combos import label_to_combos
from poker_solver.postflop_mccfr import PostflopMccfrTrainer, PostflopSpotConfig, _info_set_key

RIVER_BOARD = tuple(parse_card(c) for c in ["Ks", "Qh", "9d", "4c", "2s"])
POT_BB = 100.0
SHOVE_BB = 33.0

CALL_FREQUENCY = POT_BB / (POT_BB + SHOVE_BB)  # ~0.7519
BLUFF_FREQUENCY = SHOVE_BB / (POT_BB + SHOVE_BB)  # ~0.2481

ITERATIONS = 20_000  # ~6-7s: the tree itself is tiny (2-3 decision nodes),
# evaluate_best (two 7-card evaluations per iteration) is what dominates
# runtime, not tree size -- see evaluator.py's docstring.
TOLERANCE = 0.05  # wider than Kuhn's 0.03: range sampling + collision
# rejection add sampling noise on top of Kuhn's pure path sampling.


def _average_prob(
    trainer: PostflopMccfrTrainer,
    board: tuple[int, ...],
    player: int,
    label: str,
    history: tuple[str, ...],
    action: str,
) -> float:
    """Averages P(action) across every unblocked combo of `label` at info
    sets sharing `history`."""
    blocked = frozenset(board)
    combos = [c for c in label_to_combos(label) if c[0] not in blocked and c[1] not in blocked]
    probs = []
    for combo in combos:
        node = trainer.node_map.get(_info_set_key(player, combo, history))
        if node is not None:
            probs.append(node.average_strategy()[action])
    assert probs, f"no info sets reached for {label} at history={history}"
    return sum(probs) / len(probs)


def _make_river_trainer(seed: int) -> PostflopMccfrTrainer:
    config = PostflopSpotConfig(
        board=RIVER_BOARD,
        pot_bb=POT_BB,
        effective_stack_bb=SHOVE_BB,
        range0={"KJo": 1.0},
        range1={"AA": 1.0, "33": 1.0},
        first_to_act=1,
        prior_history=("check",),
    )
    return PostflopMccfrTrainer(config, seed=seed)


def test_value_hand_always_shoves() -> None:
    # AA can never lose the ensuing showdown and checking back forecloses
    # all value -- shoving should be dominant, not a mixed frequency.
    trainer = _make_river_trainer(seed=1)
    trainer.train(ITERATIONS)
    p_shove = _average_prob(
        trainer, RIVER_BOARD, player=1, label="AA", history=("check",), action="all_in"
    )
    assert p_shove > 0.95


def test_bluff_and_bluffcatcher_frequencies_match_theory() -> None:
    trainer = _make_river_trainer(seed=1)
    trainer.train(ITERATIONS)

    p_bluff_shove = _average_prob(
        trainer, RIVER_BOARD, player=1, label="33", history=("check",), action="all_in"
    )
    assert abs(p_bluff_shove - BLUFF_FREQUENCY) < TOLERANCE

    p_call = _average_prob(
        trainer, RIVER_BOARD, player=0, label="KJo", history=("check", "all_in"), action="call"
    )
    assert abs(p_call - CALL_FREQUENCY) < TOLERANCE


# --- Flop/turn: a locked value hand, to check the runout doesn't break
# the betting logic -- see the module docstring for why this doesn't
# attempt a two-sided closed-form match the way the river scenario does.

# Board uses all three non-spade 7s, so the only 7 left in the deck is the
# 7 of spades -- every combo of "K7o" is forced to include it, locking
# quad 7s (the board's trip 7s plus hero's one) for every combo of that
# label, regardless of which King accompanies it. Villain's "99" is a
# pair, which is always two *different* suits by construction, capping
# villain at one card of any single suit from their hand -- combined with
# this board offering at most one card per suit (one heart, one diamond,
# one club, zero spades), no flush/straight-flush is reachable for
# villain even after a 1- or 2-card runout. The one residual gap: villain
# could still catch running 9s into quad 9s, which *would* beat hero's
# quad 7s (same category, higher rank) -- a specific ~1-in-1000 runout,
# comfortably below the dominance tolerance used below.
FLOP_BOARD = tuple(parse_card(c) for c in ["7h", "7d", "7c"])
TURN_BOARD = FLOP_BOARD + (parse_card("2s"),)


def _make_locked_trainer(board: tuple[int, ...], seed: int) -> PostflopMccfrTrainer:
    config = PostflopSpotConfig(
        board=board,
        pot_bb=POT_BB,
        effective_stack_bb=SHOVE_BB,
        range0={"99": 1.0},
        range1={"K7o": 1.0},
        first_to_act=1,
        prior_history=("check",),
    )
    return PostflopMccfrTrainer(config, seed=seed)


def test_flop_locked_value_hand_dominates() -> None:
    # 2 runout cards (turn + river) still to come.
    trainer = _make_locked_trainer(FLOP_BOARD, seed=1)
    trainer.train(ITERATIONS)
    p_shove = _average_prob(
        trainer, FLOP_BOARD, player=1, label="K7o", history=("check",), action="all_in"
    )
    assert p_shove > 0.9
    p_fold = _average_prob(
        trainer, FLOP_BOARD, player=0, label="99", history=("check", "all_in"), action="fold"
    )
    assert p_fold > 0.9


def test_turn_locked_value_hand_dominates() -> None:
    # 1 runout card (river only) still to come.
    trainer = _make_locked_trainer(TURN_BOARD, seed=1)
    trainer.train(ITERATIONS)
    p_shove = _average_prob(
        trainer, TURN_BOARD, player=1, label="K7o", history=("check",), action="all_in"
    )
    assert p_shove > 0.9
