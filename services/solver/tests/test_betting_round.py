from poker_solver.betting_round import MAX_AGGRESSIVE_ACTIONS, BettingRoundState


def test_shallow_stack_collapses_menu_to_check_or_all_in() -> None:
    # pot=100, stack=33 -- the 33%-pot bet exactly equals the whole stack,
    # and 66%/100% obviously exceed it, so every sized option collapses
    # into a single deduped "all_in".
    state = BettingRoundState.initial(pot_bb=100, stack_bb=33, first_to_act=1, prior_history=("check",))
    assert state.legal_actions() == ("check", "all_in")


def test_deeper_stack_keeps_smaller_sizes_distinct() -> None:
    # pot=100, stack=80 -- b33=33 and b66=66 both fit, b100=100 exceeds
    # the stack and collapses into "all_in".
    state = BettingRoundState.initial(pot_bb=100, stack_bb=80)
    assert state.legal_actions() == ("check", "b33", "b66", "all_in")


def test_facing_a_bet_offers_fold_call_and_raise_sizes() -> None:
    state = BettingRoundState.initial(pot_bb=100, stack_bb=200).apply("b33")
    actions = state.legal_actions()
    assert actions[:2] == ("fold", "call")
    assert "b33" in actions and "all_in" in actions


def test_calling_a_shove_leaves_no_room_to_raise() -> None:
    state = BettingRoundState.initial(pot_bb=100, stack_bb=33, first_to_act=1, prior_history=("check",))
    state = state.apply("all_in")
    assert state.legal_actions() == ("fold", "call")


def test_raise_cap_leaves_only_fold_call_all_in() -> None:
    state = BettingRoundState.initial(pot_bb=100, stack_bb=10_000)
    action_sequence = ["b33"] + ["b100"] * (MAX_AGGRESSIVE_ACTIONS - 1)
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
    state = BettingRoundState.initial(pot_bb=100, stack_bb=100).apply("b33").apply("fold")
    assert state.is_terminal()


def test_call_is_terminal() -> None:
    state = BettingRoundState.initial(pot_bb=100, stack_bb=100).apply("b33").apply("call")
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
