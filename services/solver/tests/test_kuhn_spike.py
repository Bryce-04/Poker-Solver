from poker_solver.kuhn_spike import KuhnCfrTrainer

KNOWN_GAME_VALUE = -1 / 18


def test_cfr_converges_to_known_game_value() -> None:
    trainer = KuhnCfrTrainer(seed=1)
    game_value = trainer.train(iterations=20_000)
    assert abs(game_value - KNOWN_GAME_VALUE) < 0.03


def test_king_always_continues_facing_a_bet() -> None:
    # Kuhn poker's equilibrium is a family parameterized by alpha in
    # [0, 1/3] (opening action with Jack/King both mix, and shift together),
    # so opening-action probabilities aren't a fixed point to assert on.
    # What *is* fixed across the whole family: holding the best card and
    # facing a bet, calling strictly dominates folding.
    trainer = KuhnCfrTrainer(seed=1)
    trainer.train(iterations=20_000)
    king_facing_open_bet = trainer.node_map["2b"].average_strategy()
    king_facing_check_bet = trainer.node_map["2pb"].average_strategy()
    assert king_facing_open_bet["b"] > 0.9
    assert king_facing_check_bet["b"] > 0.9
