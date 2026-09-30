# services/solver

The actual solving engine (Stage 5): MCCFR over the locked-in scope (single
postflop street, heads-up, fixed bet-size menu — see
[`../../docs/plan.md`](../../docs/plan.md)).

**Status:** a real river-only solve exists now — heads-up, a fixed 5-card
board, two ranges, the locked bet-size menu (check / 33%/66%/100% pot /
all-in), solved via chance-sampled Monte Carlo CFR. Flop/turn aren't here
yet: going to showdown from an earlier street needs a runout (dealing the
rest of the board) on top of range sampling, which this doesn't do. No
`apps/api` route calls into this yet, and there's no solve caching — both
are separate follow-up work, not part of this package.

```
pip install -e ".[dev]"
python -m poker_solver.kuhn_spike     # the Stage 1 toy spike (see below)
python -m poker_solver.river_mccfr    # the real thing: prints converged strategies
pytest                                 # everything, including the closed-form regression test
```

## Layout

```
src/poker_solver/
  kuhn_spike.py     Stage 1 throwaway: vanilla CFR on 3-card Kuhn poker,
                     confirming regret matching converges before any real
                     solving code got written. Delete once river_mccfr.py's
                     own convergence test fully supersedes what this checks.
  cards.py           Card = int 0-51; parse/format against the schema's
                     two-char notation; FULL_DECK.
  evaluator.py        Pure-Python 5/7-card hand ranking, brute-forced over
                     the 21 5-card subsets of 7 -- correct and simple,
                     cheap enough since each hand's evaluated once per
                     MCCFR iteration and reused at every terminal reached.
  combos.py          169-label (HandRange's shape) -> concrete 2-card
                     combos, blocked-card removal, weighted sampling.
  river_game.py       The river-only action abstraction as a pure state
                     machine: legal actions, transitions, terminal
                     detection, payoff arithmetic. No CFR, no evaluator.
  river_mccfr.py      RiverMccfrTrainer -- chance-sampled MCCFR tying the
                     above together, same regret-matching shape as
                     kuhn_spike.py's KuhnCfrTrainer.
```

## Why river-only first

Stage 5's scope is "one postflop street" generically. Starting on the river
needs no runout -- the board's already complete, so showdown is an
immediate, exact hand comparison. Starting on the flop or turn needs that
*plus* Monte Carlo sampling of the rest of the board each iteration (on top
of the range sampling this already does) before a showdown value exists at
all. River-only is the smallest correct increment that proves the whole
pipeline -- range sampling, the evaluator, the action abstraction,
regret-matching -- actually produces a correct equilibrium, checked against
closed-form poker theory (`tests/test_river_mccfr.py`), before that
runout-sampling complexity gets added on top.

## The one payoff-arithmetic pitfall worth knowing about

`river_game.py`'s `RiverState.terminal_utility` uses one general formula
for every terminal, fold included: the winner's share is the **whole**
pot (`pot_bb` -- dead money from earlier streets -- plus both players'
contributions this street), not just what the loser put in. A fold-specific
shortcut that forgets to include `pot_bb` in the non-folder's winnings
still runs and still "converges" -- just to a silently wrong equilibrium,
where bluffing looks strictly dominated. `test_river_game.py`'s fold-payoff
test and `test_river_mccfr.py`'s closed-form check both exist specifically
to catch that class of mistake; see the docstring on `terminal_utility`.

Delete `kuhn_spike.py` once `river_mccfr.py`'s own convergence test is
trusted to cover the same "does CFR actually converge here" question on
its own.
