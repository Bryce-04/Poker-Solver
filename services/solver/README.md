# services/solver

The actual solving engine (Stage 5): MCCFR over the locked-in scope (single
postflop street, heads-up, fixed bet-size menu — see
[`../../docs/plan.md`](../../docs/plan.md)).

**Status:** a real solve exists for any single postflop street — flop,
turn, or river, heads-up, two ranges, the locked bet-size menu (check /
33%/66%/100% pot / all-in), solved via chance-sampled Monte Carlo CFR.
Starting on the flop or turn samples a random runout (the rest of the
board) once per iteration before evaluating showdown strength; starting
on the river needs none. `apps/api`'s `POST /spots/solve`
(`apps/api/app/solve.py`) now calls into this — see that file and
`docs/decisions.md`'s 2026-10-06 entry for the request contract. No
frontend consumes it yet, and there's no solve caching — both are
separate follow-up work. Multi-street solving (modeling betting across
flop *and* turn *and* river in one tree) is a bigger, separate future
direction (see `docs/plan.md`'s "widening the solver" section) — this
only ever solves one street's betting at a time.

```
pip install -e ".[dev]"
python -m poker_solver.kuhn_spike       # the Stage 1 toy spike (see below)
python -m poker_solver.postflop_mccfr   # the real thing: prints converged strategies
pytest                                   # everything, including the closed-form regression tests
```

## Layout

```
src/poker_solver/
  kuhn_spike.py      Stage 1 throwaway: vanilla CFR on 3-card Kuhn poker,
                      confirming regret matching converges before any real
                      solving code got written. Delete once postflop_mccfr.py's
                      own convergence tests fully supersede what this checks.
  cards.py            Card = int 0-51; parse/format against the schema's
                      two-char notation; FULL_DECK.
  evaluator.py        Pure-Python 5/7-card hand ranking, brute-forced over
                      the 21 5-card subsets of 7 -- correct and simple,
                      cheap enough since each hand's evaluated once per
                      MCCFR iteration and reused at every terminal reached.
  combos.py           169-label (HandRange's shape) -> concrete 2-card
                      combos, blocked-card removal, weighted sampling, and
                      deal_runout (sampling the rest of the board when
                      starting on the flop or turn).
  betting_round.py    The action abstraction for one street as a pure
                      state machine: legal actions, transitions, terminal
                      detection, payoff arithmetic. No cards, no CFR, no
                      evaluator -- genuinely card-agnostic, which is why
                      this file needed zero changes to support flop/turn.
  postflop_mccfr.py   PostflopMccfrTrainer -- chance-sampled MCCFR tying
                      the above together, same regret-matching shape as
                      kuhn_spike.py's KuhnCfrTrainer. Samples a board
                      runout alongside hole cards when the board handed
                      in isn't already 5 cards. Also exports
                      aggregate_label_strategies, which rolls combo-level
                      strategies back up to 169-type labels -- the one
                      function apps/api/app/solve.py actually calls.
```

## Why river-only first, and how flop/turn got added on top

Stage 5's scope is "one postflop street" generically. Starting on the
river needs no runout -- the board's already complete, so showdown is an
immediate, exact hand comparison. That was the smallest correct
increment that proved the whole pipeline -- range sampling, the
evaluator, the action abstraction, regret-matching -- actually produces a
correct equilibrium, checked against closed-form poker theory
(`tests/test_postflop_mccfr.py`), before adding runout complexity on top.

Flop/turn turned out to need less new code than expected, because
`betting_round.py` never knew about cards in the first place -- it's pure
pot/contribution/action bookkeeping, used identically regardless of
street. The only genuinely new piece is `combos.py`'s `deal_runout`:
chance-sampling already means each MCCFR iteration fixes its *entire*
chance outcome up front (which combo each player holds) before walking
the betting tree, so sampling the missing board cards at that same point,
once per iteration, extends the existing pattern rather than requiring a
new one. `postflop_mccfr.py`'s `train()` is the only place that changed.

## Testing a runout-dependent result is harder than it looks

`tests/test_postflop_mccfr.py`'s flop/turn tests reuse the river test's
trick of picking a hand that's *locked* (quad 7s via a board that uses
three of the four 7s, so every combo of the value label is forced to hold
the last one) specifically so the runout can't change the outcome --
that only proves the betting logic still works with a shorter board, not
that runout sampling itself is correct, since a locked scenario never
actually exercises a runout that matters. `tests/test_runout_equity.py`
is where that correctness check actually lives: a real flush-draw-vs-
overpair flop, where `deal_runout` + `evaluate_best`'s sampled equity is
checked against the *exact* equity from brute-force enumeration (only
990 possible turn+river combinations on a flop -- small enough to
enumerate exactly in a test, not just estimate).

## The one payoff-arithmetic pitfall worth knowing about

`betting_round.py`'s `BettingRoundState.terminal_utility` uses one general
formula for every terminal, fold included: the winner's share is the
**whole** pot (`pot_bb` -- dead money from earlier streets -- plus both
players' contributions this street), not just what the loser put in. A
fold-specific shortcut that forgets to include `pot_bb` in the
non-folder's winnings still runs and still "converges" -- just to a
silently wrong equilibrium, where bluffing looks strictly dominated.
`test_betting_round.py`'s fold-payoff test and `test_postflop_mccfr.py`'s
closed-form check both exist specifically to catch that class of mistake;
see the docstring on `terminal_utility`.

Delete `kuhn_spike.py` once `postflop_mccfr.py`'s own convergence tests
are trusted to cover the same "does CFR actually converge here" question
on their own.
