import pytest

from poker_solver.betting_round import (
    BET_SIZE_MENU,
    DEFAULT_BET_MENU,
    MAX_AGGRESSIVE_ACTIONS,
    BetMenu,
    BettingRoundState,
)


def test_shallow_stack_collapses_menu_to_check_or_all_in() -> None:
    # pot=100, stack=25 -- the 25%-pot (bet_small) bet exactly equals the
    # whole stack, and bet_medium/bet_large obviously exceed it, so every
    # sized option collapses into a single deduped "all_in".
    state = BettingRoundState.initial(pot_bb=100, stack_bb=25, first_to_act=1, prior_history=("check",))
    assert state.legal_actions() == ("check", "all_in")


def test_deeper_stack_keeps_smaller_sizes_distinct() -> None:
    # pot=100, stack=80 -- bet_small=25 and bet_medium=75 both fit,
    # bet_large=125 exceeds the stack and collapses into "all_in".
    state = BettingRoundState.initial(pot_bb=100, stack_bb=80)
    assert state.legal_actions() == ("check", "bet_small", "bet_medium", "all_in")


def test_facing_a_bet_offers_fold_call_and_raise_sizes() -> None:
    state = BettingRoundState.initial(pot_bb=100, stack_bb=200).apply("bet_small")
    actions = state.legal_actions()
    assert actions[:2] == ("fold", "call")
    assert "bet_small" in actions and "all_in" in actions


def test_calling_a_shove_leaves_no_room_to_raise() -> None:
    state = BettingRoundState.initial(pot_bb=100, stack_bb=33, first_to_act=1, prior_history=("check",))
    state = state.apply("all_in")
    assert state.legal_actions() == ("fold", "call")


def test_raise_cap_leaves_only_fold_call_all_in() -> None:
    state = BettingRoundState.initial(pot_bb=100, stack_bb=10_000)
    action_sequence = ["bet_small"] + ["bet_large"] * (MAX_AGGRESSIVE_ACTIONS - 1)
    for action in action_sequence:
        state = state.apply(action)
    assert state.num_aggressive_actions == MAX_AGGRESSIVE_ACTIONS
    assert state.legal_actions() == ("fold", "call", "all_in")


def test_check_check_is_terminal() -> None:
    state = BettingRoundState.initial(pot_bb=100, stack_bb=100).apply("check").apply("check")
    assert state.is_terminal()
    assert state.legal_actions() == ()


def test_single_check_is_not_terminal() -> None:
    state = BettingRoundState.initial(pot_bb=100, stack_bb=100).apply("check")
    assert not state.is_terminal()


def test_fold_is_terminal() -> None:
    state = BettingRoundState.initial(pot_bb=100, stack_bb=100).apply("bet_small").apply("fold")
    assert state.is_terminal()


def test_call_is_terminal() -> None:
    state = BettingRoundState.initial(pot_bb=100, stack_bb=100).apply("bet_small").apply("call")
    assert state.is_terminal()


def test_fold_payoff_includes_the_dead_pot() -> None:
    """The critical case: a fold's winner must collect the WHOLE pot
    (including pot_bb, dead money from earlier streets), not just what the
    folder put in this street -- see the docstring on terminal_utility."""
    state = BettingRoundState.initial(pot_bb=100, stack_bb=33, first_to_act=1, prior_history=("check",))
    state = state.apply("all_in").apply("fold")  # player 1 shoves, player 0 folds
    u0, u1 = state.terminal_utility(strength0=None, strength1=None)
    # Player 1 (the non-folder) nets the entire dead pot (100) plus
    # whatever player 0 (the folder) put in this street (0, they only
    # folded) -- NOT just the folder's contribution alone (that bug would
    # give u1 = 0 here instead of 100).
    assert u1 == 100.0
    assert u0 == 0.0


def test_showdown_payoff_splits_by_strength() -> None:
    state = BettingRoundState.initial(pot_bb=100, stack_bb=33, first_to_act=1, prior_history=("check",))
    state = state.apply("all_in").apply("call")
    u0, u1 = state.terminal_utility(strength0=(1, ()), strength1=(2, ()))
    # Both contributed their full 33bb stack; total pot = 100+33+33=166.
    # Player 1's stronger hand wins it all: net = 166 - 33 = 133 for
    # player 1, and -33 for player 0.
    assert u1 == 133.0
    assert u0 == -33.0


def test_showdown_tie_splits_the_pot() -> None:
    state = BettingRoundState.initial(pot_bb=100, stack_bb=33, first_to_act=1, prior_history=("check",))
    state = state.apply("all_in").apply("call")
    u0, u1 = state.terminal_utility(strength0=(1, ()), strength1=(1, ()))
    assert u0 == u1 == 50.0


def test_seeded_bet_actually_puts_chips_in() -> None:
    # Regression: initial() used to record prior_history's labels without
    # applying them, so a seeded bet left contributed at (0, 0) -- calling
    # it cost nothing and folding to it won only the dead pot.
    state = BettingRoundState.initial(pot_bb=100, stack_bb=200, first_to_act=1, prior_history=("bet_small",))
    assert state.contributed == (25.0, 0.0)
    assert state.to_act == 1
    assert state.legal_actions()[:2] == ("fold", "call")

    called = state.apply("call")
    assert called.contributed == (25.0, 25.0)

    folded = state.apply("fold")
    u0, u1 = folded.terminal_utility(strength0=None, strength1=None)
    assert (u0, u1) == (100.0, 0.0)  # the bettor wins the dead pot; their own 25 comes back


def test_seeded_bet_counts_toward_the_raise_cap() -> None:
    state = BettingRoundState.initial(pot_bb=100, stack_bb=10_000, first_to_act=1, prior_history=("bet_small",))
    assert state.num_aggressive_actions == 1


def test_seeded_check_is_unchanged() -> None:
    state = BettingRoundState.initial(pot_bb=100, stack_bb=100, first_to_act=1, prior_history=("check",))
    assert state.contributed == (0.0, 0.0)
    assert state.to_act == 1
    assert state.history == ("check",)


# --- custom bet menus ---------------------------------------------------------


def test_the_default_menu_is_the_legacy_one_and_names_are_unchanged() -> None:
    assert DEFAULT_BET_MENU.is_default
    assert DEFAULT_BET_MENU.labelled_sizes == BET_SIZE_MENU
    assert BetMenu() == DEFAULT_BET_MENU
    # Spelling the default sizes out is still the default (legacy names kept).
    assert BetMenu(sizes=(0.25, 0.75, 1.25)).is_default
    assert BetMenu(sizes=(0.25, 0.75, 1.25)).labelled_sizes[0][1] == "bet_small"


def test_a_custom_menu_names_each_size_by_its_percentage() -> None:
    menu = BetMenu(sizes=(0.33, 0.5, 2.0))
    assert not menu.is_default
    assert [name for _, name in menu.labelled_sizes] == ["bet_33", "bet_50", "bet_200"]
    assert menu.size_of("bet_50") == 0.5
    assert menu.aggressive_labels == {"bet_33", "bet_50", "bet_200", "all_in"}


@pytest.mark.parametrize(
    "kwargs",
    [
        {"sizes": ()},  # nothing to bet
        {"sizes": (0.1, 0.2, 0.3, 0.4, 0.5, 0.6)},  # more than MAX_BET_SIZES
        {"sizes": (0.01,)},  # below the minimum fraction
        {"sizes": (6.0,)},  # above the maximum fraction
        {"sizes": (0.75, 0.25)},  # not ascending
        {"sizes": (0.5, 0.504)},  # the same percentage twice
        {"sizes": (0.5,), "max_aggressive_actions": 0},
        {"sizes": (0.5,), "max_aggressive_actions": 6},
    ],
)
def test_a_bad_menu_is_refused(kwargs) -> None:
    with pytest.raises(ValueError):
        BetMenu(**kwargs)


def test_a_custom_menu_sets_the_legal_actions_and_the_chips_in() -> None:
    menu = BetMenu(sizes=(0.5, 2.0))
    state = BettingRoundState.initial(pot_bb=100, stack_bb=1000, menu=menu)
    assert state.legal_actions() == ("check", "bet_50", "bet_200", "all_in")
    assert state.apply("bet_50").contributed == (50, 0)
    assert state.apply("bet_200").contributed == (200, 0)
    # A raise is sized on the pot after calling: pot 150 + to_call 50 -> 50 + 0.5*200 = 150.
    facing = state.apply("bet_50")
    assert facing.legal_actions() == ("fold", "call", "bet_50", "bet_200", "all_in")
    assert facing.apply("bet_50").contributed == (50, 150)
    # The menu travels with the state through every transition.
    assert facing.apply("bet_50").menu == menu


def test_a_size_that_does_not_fit_collapses_into_all_in_like_the_default() -> None:
    menu = BetMenu(sizes=(0.5, 2.0))
    state = BettingRoundState.initial(pot_bb=100, stack_bb=120, menu=menu)
    assert state.legal_actions() == ("check", "bet_50", "all_in")  # the 200 is more than the stack


def test_the_raise_cap_is_the_menus_not_a_global() -> None:
    one = BetMenu(sizes=(0.5,), max_aggressive_actions=1)
    state = BettingRoundState.initial(pot_bb=100, stack_bb=10_000, menu=one).apply("bet_50")
    assert state.legal_actions() == ("fold", "call", "all_in")  # no sized raise after the bet

    two = BetMenu(sizes=(0.5,), max_aggressive_actions=2)
    state = BettingRoundState.initial(pot_bb=100, stack_bb=10_000, menu=two).apply("bet_50")
    assert "bet_50" in state.legal_actions()
    assert state.apply("bet_50").legal_actions() == ("fold", "call", "all_in")


def test_the_menu_is_replayed_with_a_seeded_history() -> None:
    menu = BetMenu(sizes=(0.5,))
    state = BettingRoundState.initial(
        pot_bb=100, stack_bb=1000, first_to_act=0, prior_history=("bet_50",), menu=menu
    )
    # first_to_act is who acts AFTER the seeded bet, so the bettor was player 1.
    assert state.to_act == 0 and state.contributed == (0, 50)
    assert state.legal_actions()[:2] == ("fold", "call")
