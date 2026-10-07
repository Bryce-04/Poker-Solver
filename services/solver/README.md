# services/solver

The actual solving engine (Stage 5): range-vs-range Discounted CFR over the
locked-in scope (single postflop street, heads-up, fixed bet-size menu —
see [`../../docs/plan.md`](../../docs/plan.md)).

**Status:** any single postflop street — flop, turn, or river — heads-up,
two ranges, the locked bet-size menu (check / **bet_small 25% /
bet_medium 75% / bet_large 125% pot** / all-in), solved by `range_cfr.py`:
every combo in both ranges trained on every iteration (no hole-card
sampling), equity from an exact precomputed matrix (`equity.py`, every
runout enumerated), Discounted CFR updates, trained until exploitability
is under a target % of the pot. This replaced `postflop_mccfr.py`'s
chance-sampled Monte Carlo trainer on 2026-10-07 after it was measured
producing noise for realistic wide ranges (AA "jamming" 70% into a 4bb
pot at 96bb deep) — see `docs/decisions.md`'s entry for the numbers.
After this street's betting, a non-fold hand runs out the rest of the
board with no further betting and goes to showdown — multi-street
solving (betting across flop *and* turn *and* river in one tree) is a
bigger, separate future direction (`docs/plan.md`).

`apps/api/app/solve.py` calls into this (`RangeCfrTrainer.train_until`),
can seed a solve from any non-terminal action prefix on the current
street (replayed through `BettingRoundState`, with any bet/raise bucketed
onto the menu and disclosed in the response), and returns the
exploitability reached.

```
pip install -e ".[dev]"
pytest                                   # everything, including closed-form + regression tests
pytest tests/test_range_cfr.py           # the live trainer's own tests
python -m poker_solver.kuhn_spike       # the Stage 1 toy spike (see below)
python -m poker_solver.postflop_mccfr   # the superseded Monte Carlo trainer's demo
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
  evaluator.py        Hand ranking, three ways: evaluate_best (brute force
                      over 5-card subsets -- the trusted reference),
                      evaluate_seven (single-pass 7-card, same result), and
                      evaluate_seven_batch (numpy, a whole range against one
                      board, packed-int scores via pack_strength). The fast
                      two are cross-checked for exact equality against
                      evaluate_best in test_evaluator.py -- never trust them
                      on their own after changing them.
  combos.py           169-label (HandRange's shape) -> concrete 2-card
                      combos, blocked-card removal, weighted sampling, and
                      deal_runout (sampling the rest of the board when
                      starting on the flop or turn).
  equity.py           Exact hero-combo x villain-combo equity matrix for a
                      board: every runout enumerated (990 flop, 44 turn),
                      shared-card pairs NaN (never 0). ~2s for two ~500-combo
                      ranges on a flop, 0.1s turn, 0.01s river.
  betting_round.py    The action abstraction for one street as a pure
                      state machine: legal actions, transitions, terminal
                      detection, payoff arithmetic. No cards, no CFR, no
                      evaluator -- genuinely card-agnostic. initial()
                      replays a seeded prior_history so seeded bets put
                      chips in (an earlier version didn't).
  range_cfr.py        RangeCfrTrainer -- the live trainer. Per public
                      betting node, a regret/strategy row for every combo
                      of the acting player; reach-probability vectors
                      instead of sampled hands; terminal values as
                      matrix-vector products against equity.py's matrix;
                      Discounted CFR updates; exploitability() and
                      train_until() for convergence; label_strategies() to
                      roll combos back up to 169-type labels.
  postflop_mccfr.py   SUPERSEDED (2026-10-07) -- the old chance-sampled
                      Monte Carlo trainer. No longer used by apps/api;
                      kept intact as a known-good reference, a real
                      deletion candidate along with kuhn_spike.py.
```

## How the live trainer (range_cfr.py) is validated

Three independent checks, in `tests/test_range_cfr.py`, `tests/test_equity.py`
and `tests/test_evaluator.py` — none of them "did it run":

- **Closed-form theory.** The same polarized-range-vs-bluffcatcher river the
  old trainer was checked against: 33 must bluff-shove 20% and KJo call 80%.
  The tolerance is 1% (the old test needed 5% to absorb sampling noise; this
  trainer has none) and it's met in a few hundred iterations.
- **Brute force.** Every equity-matrix cell on river, turn, and flop matches
  pair-by-pair exact enumeration to float precision, including pairs whose
  denominators differ because one hand blocks the other's outs; terminal
  values match a hand-summed brute force; card removal is checked directly
  (each AA combo leaves exactly 8 of villain's 16 AK combos possible).
- **The bug it replaced.** `test_regression_wide_ranges_deep_stacks_dont_jam_absurdly`
  replays the exact scenario that exposed the Monte Carlo trainer (real BB
  defend vs BTN open ranges in `tests/fixtures/`, 4bb pot, 96bb deep) and
  asserts nothing jams absurdly and exploitability is under 5% of the pot
  after 100 iterations.

`exploitability()` (best-response value against the average strategy, minus
the dead pot) is the convergence measure — use it, not eyeballed
frequencies, when choosing iteration counts or comparing update rules (that's
how DCFR beat CFR+ here; see `docs/decisions.md`).

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
