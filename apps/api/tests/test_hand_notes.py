"""hand_notes: categories and "why" bullets for a live solve's result panel.
Pure -- no database."""

from poker_solver.cards import parse_card
from poker_solver.range_cfr import RangeCfrTrainer, RangeSpotConfig

from app.drill_analysis import HandProfile
from app.hand_notes import category_label, hand_notes

FLOP = tuple(parse_card(c) for c in ("Qs", "5c", "2c"))


def test_category_label_reads_like_the_mockup():
    assert category_label(HandProfile("top pair", "pair_top", notes=("a strong kicker",))) == "Top pair, strong kicker"
    assert category_label(HandProfile("a set", "monster")) == "Set"
    assert category_label(HandProfile("an overpair", "pair_top")) == "Overpair"
    assert category_label(HandProfile("a flush draw", "nothing", draws=("flush draw",))) == "Flush draw"
    assert category_label(HandProfile("second pair", "pair_mid", draws=("flush draw",))) == "Second pair + flush draw"
    # Backdoor draws are too weak to headline.
    assert category_label(HandProfile("ace high", "nothing", draws=("backdoor flush draw",))) == "Ace high"


def _solved_flop(prior_history=()):
    trainer = RangeCfrTrainer(
        RangeSpotConfig(
            board=FLOP,
            pot_bb=5.5,
            effective_stack_bb=97.5,
            range0={"AQo": 1.0, "55": 1.0, "KJo": 1.0, "AKs": 1.0},
            range1={"AA": 1.0, "KK": 1.0, "JTs": 1.0},
            first_to_act=1 if prior_history else 0,
            prior_history=prior_history,
        )
    )
    trainer.train_until(1.0, 300)
    return trainer


def test_categories_and_reasons_for_the_deciding_player_on_a_flop():
    trainer = _solved_flop()
    strategy = trainer.label_strategies()
    categories, reasons = hand_notes(trainer, FLOP, 5.5, 0, "BB", "BTN", strategy, ())
    assert categories["AQo"] == "Top pair, strong kicker"
    assert categories["55"] == "Set"
    assert categories["KJo"] == "King high"
    # AKs: two of its four combos are clubs (a flush draw), so most aren't.
    assert categories["AKs"] == "Ace high"
    assert set(reasons) == {"AQo", "55", "KJo", "AKs"}
    for bullets in reasons.values():
        assert 3 <= len(bullets) <= 4
        assert all(isinstance(b, str) and b for b in bullets)
    assert reasons["55"][0].startswith("You have a set")
    assert "BTN's range" in reasons["55"][0]


def test_facing_a_menu_bet_quotes_the_price():
    trainer = _solved_flop(prior_history=("bet_medium",))
    strategy = trainer.label_strategies()
    categories, reasons = hand_notes(trainer, FLOP, 5.5, 1, "BTN", "BB", strategy, ("bet_medium",))
    assert categories["AA"] == "Overpair"
    assert "75% of the pot" in reasons["AA"][1]


def test_nothing_off_the_flop():
    turn = FLOP + (parse_card("9h"),)
    trainer = RangeCfrTrainer(
        RangeSpotConfig(board=turn, pot_bb=5.5, effective_stack_bb=97.5, range0={"AQo": 1.0}, range1={"KK": 1.0})
    )
    trainer.train_until(1.0, 50)
    assert hand_notes(trainer, turn, 5.5, 0, "BB", "BTN", trainer.label_strategies(), ()) == ({}, {})
