"""The joint turn + river solve (RangeSpotConfig.river).

The strongest tests here are two EXACT equivalences against the already-validated
single-street trainer, in float64 (so only the algorithm can differ):

  1. With no river betting, enumerating every river card must equal the plain turn
     solve, whose equity matrix averages the same runouts. That checks the chance
     nodes, the card masks, the chance weights, per-card equity and the money
     accounting across streets.
  2. With the turn already closed, each river card is an independent subgame, so
     the joint trainer's strategies on a card must equal a standalone river solve
     of that card. That checks the river subtrees, their strategies, and that cards
     don't leak into each other.

The rest checks structure (what the tree looks like), the card sample, the size
estimate against the tree actually built, and that a joint solve converges.
"""

import numpy as np
import pytest

from poker_solver import range_cfr
from poker_solver.betting_round import BetMenu
from poker_solver.cards import card_str, parse_card
from poker_solver.equity import compute_equity_matrix
from poker_solver.range_cfr import (
    DEFAULT_RIVER_MENU,
    RangeCfrTrainer,
    RangeSpotConfig,
    RiverSpec,
    estimate_joint_size,
    select_river_cards,
)

BOARD = tuple(parse_card(c) for c in ("Qs", "Jh", "7h", "3h"))
RANGE_OOP = {"AA": 1.0, "KQs": 1.0, "KJs": 0.5, "T9s": 1.0, "55": 1.0, "A5s": 1.0, "QJo": 1.0, "98s": 0.7}
RANGE_IP = {"KK": 1.0, "AQs": 1.0, "AKo": 1.0, "98s": 1.0, "66": 1.0, "QTs": 1.0, "A4s": 0.6}
TURN_MENU = BetMenu(sizes=(0.5,), max_aggressive_actions=2)
RIVER_MENU = BetMenu(sizes=(0.75,), max_aggressive_actions=1)


def _config(**overrides) -> RangeSpotConfig:
    base = dict(
        board=BOARD, pot_bb=12.5, effective_stack_bb=95.0,
        range0=RANGE_OOP, range1=RANGE_IP, bet_menu=TURN_MENU,
    )
    return RangeSpotConfig(**{**base, **overrides})


@pytest.fixture
def float64_river_matrices(monkeypatch):
    monkeypatch.setattr(range_cfr, "_RIVER_MATRIX_DTYPE", np.float64)


def _single_street_in_float64(config: RangeSpotConfig) -> RangeCfrTrainer:
    """The ordinary trainer with its equity matrices built and used in float64."""
    trainer = RangeCfrTrainer(config)
    equity = compute_equity_matrix(trainer.combos[0], trainer.combos[1], config.board)
    possible = (~np.isnan(equity)).astype(np.float64)
    win = np.where(np.isnan(equity), 0.0, equity)
    trainer._payoff = (np.vstack([win, possible]), np.vstack([(possible - win).T, possible.T]))
    trainer._win = (
        trainer._payoff[0][: len(trainer.combos[0])],
        trainer._payoff[1][: len(trainer.combos[1])],
    )
    return trainer


# --- 1. no river betting == the turn solve ------------------------------------------


def test_with_no_river_betting_a_joint_solve_equals_the_turn_solve(float64_river_matrices):
    single = _single_street_in_float64(_config())
    joint = RangeCfrTrainer(_config(river=RiverSpec(bet_menu=None, cards=None)))
    assert len(joint.river_cards) == 48
    single.train(40)
    joint.train(40)

    assert set(joint._nodes) == set(single._nodes)  # no river decisions: same decision tree
    for history, node in single._nodes.items():
        np.testing.assert_allclose(joint._nodes[history].regret, node.regret, rtol=1e-6, atol=1e-6)
        np.testing.assert_allclose(joint._nodes[history].average_strategy(), node.average_strategy(), atol=1e-7)
    assert joint.exploitability() == pytest.approx(single.exploitability(), rel=1e-9, abs=1e-9)
    for player in (0, 1):
        assert joint.best_response_value(player) == pytest.approx(
            single.best_response_value(player), rel=1e-9, abs=1e-9
        )


# --- 2. each river card == a standalone river solve ---------------------------------


@pytest.mark.parametrize("card_text", ["Ah", "2c", "Qd", "Th"])
def test_each_river_card_matches_a_standalone_river_solve(float64_river_matrices, card_text):
    # The turn is already closed (check, check), so the root is the river card.
    joint = RangeCfrTrainer(
        _config(first_to_act=0, prior_history=("check", "check"), river=RiverSpec(bet_menu=DEFAULT_RIVER_MENU))
    )
    joint.train(40)

    card = parse_card(card_text)
    standalone = RangeCfrTrainer(
        _config(board=BOARD + (card,), bet_menu=DEFAULT_RIVER_MENU)
    )
    standalone._payoff = tuple(m.astype(np.float64) for m in standalone._payoff)
    standalone._win = (
        standalone._payoff[0][: len(standalone.combos[0])],
        standalone._payoff[1][: len(standalone.combos[1])],
    )
    standalone.train(40)

    assert standalone._nodes  # the river tree has decisions to compare
    for history, node in standalone._nodes.items():
        key = ("check", "check", f"river:{card_str(card)}") + history
        theirs = joint._nodes[key]
        assert theirs.actions == node.actions
        # The joint trainer keeps rows for combos holding the card (their reach is
        # zero there); line up the combos both have.
        row_of = {tuple(sorted(c)): i for i, c in enumerate(joint.combos[node.actor])}
        rows = [row_of[tuple(sorted(c))] for c in standalone.combos[node.actor]]
        np.testing.assert_allclose(
            theirs.average_strategy()[rows], node.average_strategy(), atol=1e-7,
            err_msg=f"river strategy on {card_text} at {history!r}",
        )


# --- structure -------------------------------------------------------------------------


def test_every_terminal_pot_is_the_start_pot_plus_what_both_players_put_in():
    # Money is counted across streets: whatever line led there, a terminal's pot is
    # the dead money at the start plus both players' total contributions. If a river
    # terminal forgot the turn's chips (or counted them twice) this breaks.
    trainer = RangeCfrTrainer(_config(river=RiverSpec(bet_menu=RIVER_MENU, cards=4)))
    start = trainer.root.pot_bb + trainer.root.contributed[0] + trainer.root.contributed[1]
    pots = np.array(trainer._terminal_pot)
    contributed = np.array(trainer._terminal_contrib)
    np.testing.assert_allclose(pots, start + contributed.sum(axis=1))
    # And river terminals really do carry the turn's chips: more than any river-only line could.
    river_terminals = np.flatnonzero(trainer._terminal_card >= 0)
    turn_closes_with_a_bet = contributed[river_terminals].min(axis=1) > 0
    assert turn_closes_with_a_bet.any()


def test_a_turn_all_in_leaves_no_river_betting():
    # Nothing behind after a called shove: each river card goes straight to a showdown.
    config = _config(effective_stack_bb=6.0, river=RiverSpec(bet_menu=RIVER_MENU, cards=3))
    trainer = RangeCfrTrainer(config)
    assert trainer._nodes[("all_in",)].actions == ("fold", "call")
    after_the_call = [h for h in trainer._nodes if h[:2] == ("all_in", "call")]
    assert after_the_call == []  # no river decisions behind a called shove...
    # ...while a line that leaves chips behind does get river betting.
    assert any(h[:2] == ("check", "check") and any(p.startswith("river:") for p in h) for h in trainer._nodes)


def test_river_nodes_are_findable_by_card_and_turn_line():
    trainer = RangeCfrTrainer(_config(river=RiverSpec(bet_menu=RIVER_MENU, cards=3)))
    card = trainer.river_cards[0]
    actions, strategy = trainer.river_strategy(card, ("check", "check"))
    assert actions[0] == "check"
    assert strategy.shape == (len(trainer.combos[0]), len(actions))
    not_enumerated = next(c for c in range(52) if c not in BOARD and c not in trainer.river_cards)
    with pytest.raises(KeyError):
        trainer.river_strategy(not_enumerated, ("check", "check"))


def test_a_river_needs_a_turn_board():
    flop = tuple(parse_card(c) for c in ("Ks", "7h", "2d"))
    with pytest.raises(ValueError, match="TURN"):
        _config(board=flop, river=RiverSpec())


def test_combo_equities_are_not_available_for_a_joint_solve():
    trainer = RangeCfrTrainer(_config(river=RiverSpec(bet_menu=None, cards=3)))
    with pytest.raises(NotImplementedError):
        trainer.combo_equities(0)


# --- the river-card sample -------------------------------------------------------------


def test_river_card_sample_covers_ranks_and_suits_and_is_deterministic():
    cards = select_river_cards(BOARD, 12)
    assert len(cards) == len(set(cards)) == 12
    assert not set(cards) & set(BOARD)
    assert len({c // 4 for c in cards}) >= 9  # ranks spread out
    assert {c % 4 for c in cards} == {0, 1, 2, 3}  # every suit is seen (the flush can come in)
    assert cards == select_river_cards(BOARD, 12)
    # Asking for as many as exist (or more) is every live card.
    assert len(select_river_cards(BOARD, 48)) == len(select_river_cards(BOARD, 99)) == 48
    with pytest.raises(ValueError):
        select_river_cards(BOARD, 0)


def test_the_chance_weight_accounts_for_a_sample():
    exact = RangeCfrTrainer(_config(river=RiverSpec(bet_menu=None, cards=None)))
    assert exact._chance_factor == pytest.approx(1 / 44)  # 44 cards left once both hands are out
    sampled = RangeCfrTrainer(_config(river=RiverSpec(bet_menu=None, cards=12)))
    assert sampled._chance_factor == pytest.approx(48 / (44 * 12))  # each stands in for 4


# --- the size estimate -----------------------------------------------------------------


@pytest.mark.parametrize("river_menu, cards", [(None, 48), (RIVER_MENU, 12), (DEFAULT_RIVER_MENU, 6)])
def test_the_size_estimate_matches_the_tree_that_gets_built(river_menu, cards):
    config = _config(river=RiverSpec(bet_menu=river_menu, cards=cards))
    size = estimate_joint_size(config)
    trainer = RangeCfrTrainer(config)
    assert size.decisions == len(trainer._decisions)
    assert size.actions == sum(len(store.column_node) for store in trainer._stores)
    assert size.terminals == len(trainer._terminal_pot)
    assert size.chance_nodes == len(trainer._chances)
    assert size.cards == len(trainer.river_cards) == min(cards, 48)


def test_the_estimate_grows_with_everything_that_makes_the_game_bigger():
    base = estimate_joint_size(_config(river=RiverSpec(bet_menu=RIVER_MENU, cards=6)))
    more_cards = estimate_joint_size(_config(river=RiverSpec(bet_menu=RIVER_MENU, cards=12)))
    bigger_river = estimate_joint_size(
        _config(river=RiverSpec(bet_menu=BetMenu(sizes=(0.75,), max_aggressive_actions=2), cards=6))
    )
    bigger_turn = estimate_joint_size(
        _config(bet_menu=BetMenu(sizes=(0.5, 1.0), max_aggressive_actions=3), river=RiverSpec(bet_menu=RIVER_MENU, cards=6))
    )
    assert more_cards.bytes > base.bytes and more_cards.decisions > base.decisions
    assert bigger_river.bytes > base.bytes
    assert bigger_turn.bytes > base.bytes


# --- it solves -------------------------------------------------------------------------


def test_a_joint_solve_converges_and_has_a_strategy_at_every_decision():
    trainer = RangeCfrTrainer(_config(river=RiverSpec(bet_menu=RIVER_MENU, cards=4)))
    reached = trainer.train_until(1.0, max_iterations=600)
    assert reached < 1.0  # under 1% of the pot
    for node in trainer._nodes.values():
        rows = node.average_strategy()
        np.testing.assert_allclose(rows.sum(axis=1), 1.0, atol=1e-9)
    # The turn's root strategy is an ordinary per-label table.
    strategy = trainer.label_strategies()
    assert strategy and all(abs(sum(mix.values()) - 1) < 1e-6 for mix in strategy.values())


def test_exploitability_falls_as_a_joint_solve_trains():
    trainer = RangeCfrTrainer(_config(river=RiverSpec(bet_menu=RIVER_MENU, cards=4)))
    trainer.train(10)
    early = trainer.exploitability()
    trainer.train(190)
    assert trainer.exploitability() < early / 3


# --- exploitability when the game is only approximately constant-sum -----------------------


@pytest.mark.parametrize(
    "river",
    [None, RiverSpec(bet_menu=RIVER_MENU, cards=None), RiverSpec(bet_menu=None, cards=None)],
    ids=["single street", "joint, every card", "joint, no river betting"],
)
def test_the_nash_gap_equals_best_responses_minus_the_pot_when_the_game_is_constant_sum(river):
    # Any game that deals every card keeps the players' payoffs summing to the dead pot,
    # so the two measures must agree -- which is what validates the "evaluate" pass.
    config = _config(river=river)
    trainer = RangeCfrTrainer(config)
    trainer.train(30)
    classic = (trainer.best_response_value(0) + trainer.best_response_value(1) - config.pot_bb) / 2
    gap = sum(trainer.best_response_value(p) - trainer.value_under_average(p) for p in (0, 1)) / 2
    assert gap == pytest.approx(classic, rel=1e-6, abs=1e-9)
    assert trainer.exploitability() == pytest.approx(classic, rel=1e-6, abs=1e-9)  # exact game: the classic formula


def test_a_sampled_solve_converges_under_the_nash_gap_and_never_goes_negative():
    # With a sample of the cards the game is only approximately constant-sum, and "best
    # responses minus the pot" plateaued near 1% and even went negative. The gap doesn't.
    trainer = RangeCfrTrainer(_config(river=RiverSpec(bet_menu=RIVER_MENU, cards=4)))
    assert trainer._sampled
    seen = []
    for target in (30, 120, 400):
        trainer.train(target - trainer.iterations)
        seen.append(trainer.exploitability())
    assert min(seen) >= -1e-9
    assert seen[-1] < seen[0] / 5  # keeps falling instead of plateauing
    assert 100 * seen[-1] / 12.5 < 0.5  # under half a percent of the pot


def test_both_ways_of_weighting_the_river_card_agree_when_every_card_is_enumerated(monkeypatch):
    # Per-hand normalization and a global per-card weight are the same number, 1/44, when
    # every card is dealt; they only differ (usefully) under a sample.
    results = {}
    for mode in ("own", "global"):
        monkeypatch.setattr(range_cfr, "_CHANCE_NORMALIZATION", mode)
        trainer = RangeCfrTrainer(_config(river=RiverSpec(bet_menu=None, cards=None)))
        trainer.train(25)
        results[mode] = trainer.average_strategy()[1]
    np.testing.assert_allclose(results["own"], results["global"], atol=1e-4)
