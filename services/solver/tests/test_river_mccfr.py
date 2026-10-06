"""The MCCFR analogue of test_kuhn_spike.py's known-equilibrium check.

Scenario: river board Ks Qh 9d 4c 2s (no ace or 3 on board, and only two
spades so a flush is never reachable -- hole-card suits never matter to any
comparison here). Villain (OOP) already checked; their whole range is a
single bluffcatcher, KJo (pairs the board's king). Hero (IP) is purely
polarized: AA (the nut overpair, always beats KJo) or 33 (bottom pair,
always loses to KJo) -- no in-between hands, and neither rank is on the
board, so both labels are fully unblocked (6 combos each, value combos ==
bluff combos).

pot_bb=100, effective_stack_bb=33 -- exactly the 33%-pot size, which
collapses Hero's options to {check, all_in} and Villain's response to
{fold, call} (see test_river_game.py's menu-collapse tests). That turns
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
"""

from poker_solver.cards import parse_card
from poker_solver.combos import label_to_combos
from poker_solver.river_mccfr import RiverMccfrTrainer, RiverSpotConfig, _info_set_key

BOARD = tuple(parse_card(c) for c in ["Ks", "Qh", "9d", "4c", "2s"])
POT_BB = 100.0
SHOVE_BB = 33.0

CALL_FREQUENCY = POT_BB / (POT_BB + SHOVE_BB)  # ~0.7519
BLUFF_FREQUENCY = SHOVE_BB / (POT_BB + SHOVE_BB)  # ~0.2481

ITERATIONS = 20_000  # ~6-7s: the tree itself is tiny (2-3 decision nodes),
# evaluate_best (two 7-card evaluations per iteration) is what dominates
# runtime, not tree size -- see evaluator.py's docstring.
TOLERANCE = 0.05  # wider than Kuhn's 0.03: range sampling + collision
# rejection add sampling noise on top of Kuhn's pure path sampling.


def _make_trainer(seed: int) -> RiverMccfrTrainer:
    config = RiverSpotConfig(
        board=BOARD,
        pot_bb=POT_BB,
        effective_stack_bb=SHOVE_BB,
        range0={"KJo": 1.0},
        range1={"AA": 1.0, "33": 1.0},
        first_to_act=1,
        prior_history=("check",),
    )
    return RiverMccfrTrainer(config, seed=seed)


def _average_prob(
    trainer: RiverMccfrTrainer, player: int, label: str, history: tuple[str, ...], action: str
) -> float:
    """Averages P(action) across every unblocked combo of `label` at info
    sets sharing `history`. The combos are strategically interchangeable
    here (no rank in AA/33/KJo touches the board beyond KJo's own king,
    and there's no flush to make suits matter), so this is a convenience
    over reading one combo's node rather than a real aggregation."""
    blocked = frozenset(BOARD)
    combos = [c for c in label_to_combos(label) if c[0] not in blocked and c[1] not in blocked]
    probs = []
    for combo in combos:
        node = trainer.node_map.get(_info_set_key(player, combo, history))
        if node is not None:
            probs.append(node.average_strategy()[action])
    assert probs, f"no info sets reached for {label} at history={history}"
    return sum(probs) / len(probs)


def test_value_hand_always_shoves() -> None:
    # AA can never lose the ensuing showdown and checking back forecloses
    # all value -- shoving should be dominant, not a mixed frequency.
    trainer = _make_trainer(seed=1)
    trainer.train(ITERATIONS)
    p_shove = _average_prob(trainer, player=1, label="AA", history=("check",), action="all_in")
    assert p_shove > 0.95


def test_bluff_and_bluffcatcher_frequencies_match_theory() -> None:
    trainer = _make_trainer(seed=1)
    trainer.train(ITERATIONS)

    p_bluff_shove = _average_prob(
        trainer, player=1, label="33", history=("check",), action="all_in"
    )
    assert abs(p_bluff_shove - BLUFF_FREQUENCY) < TOLERANCE

    p_call = _average_prob(
        trainer, player=0, label="KJo", history=("check", "all_in"), action="call"
    )
    assert abs(p_call - CALL_FREQUENCY) < TOLERANCE
