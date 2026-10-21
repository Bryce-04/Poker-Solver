# Solver work in brief

A short version of what changed in the solver and API, what went wrong along the way,
and where it goes next. The long versions are `docs/progress-and-struggles.md`,
`docs/decisions.md` and `docs/compiled-solver-plan.md`.

## What changed (the important things)

- **Range chaining.** After a street is played, "Narrow ranges" works out each player's
  range from the actions they took (a Bayesian update from the solver's strategy), so the
  next street starts from realistic ranges instead of the full preflop range.
- **Suit-level ranges.** Ranges can now name exact combos (`AhKh`), not just hand types
  like `AKs`. Narrowed ranges keep suits where they matter (flush draws, blockers), and
  the strategy grid has a suit view.
- **3-bet / 4-bet ranges.** Reference ranges for single-raised, 3-bet and 4-bet pots at
  100bb across nine position pairs, with a button on the Solve page to load them.
- **Custom bet sizes.** A solve can use any bet sizes (as fractions of the pot) and a
  raise cap, instead of only the fixed 25 / 75 / 125% menu. API only so far, no UI.
- **A faster solver.** The same answers 2.4x to 4.3x faster (a wide flop went from
  10.9 s to about 3.3 s). An exact copy of the old solver is kept in the tests, so any
  change to the solver is checked against it.
- **Joint turn + river solve.** Solves the turn and river as one game, so the turn
  strategy knows what the river will look like. Checked three ways, including against
  an independent open-source solver (postflop-solver): the game value matched to
  0.01 chip (412.66 vs 412.65).

## Bugs and struggles

- **Wrong sample math in the joint solve.** With a sample of river cards the game is no
  longer zero-sum, so the convergence measure plateaued and even went negative. Fixed by
  measuring the gap to equilibrium directly. Hands holding a sampled card were also
  under-counted; each hand now averages over only the cards it can see.
- **Flaky strategy comparison.** Comparing old and new solver strategies action by action
  failed because near-tied actions flip with tiny rounding differences. Replaced with an
  exact comparison in higher precision, plus game-value checks.
- **Wide ranges looked wrong on the turn.** The solver was jamming too many hands into a
  small pot on a flush turn. Narrowing was producing ranges from lines the equilibrium
  rarely plays; it now trims the tail and reports how likely the line was.
- **Phone tap highlight.** Cells stayed purple after a tap because hover styles applied
  on touch screens. Hover now applies only on devices that have it.
- **We are much slower than a compiled solver.** About 20x slower on one thread and about
  100x slower than postflop-solver's multithreaded run. This is the ceiling of doing the
  hot loop in numpy, not a tuning gap. Render is about 4x slower than the laptop.
- **My mistake.** A docs edit of mine emptied `CLAUDE.md` and I committed it. Caught from
  the diff stat and repaired on the `demo-summary` branch before anyone merged it.
- **Phone testing is fiddly.** The Samsung keeps dropping adb authorization, and there
  is no local Postgres or `gh`, so PRs go through prefilled compare links.

## Known issues (both fixed 2026-10-21, branch `fix-solve-state-and-phone-save`)

- **FIXED: switching tabs wiped the spot you were building.** The Solve page keeps its setup
  (positions, board, actions, ranges, result) in the page itself (`useSolveSetup`), so
  leaving it for another tab discards it. The setup needs to live above the routes, or be
  kept as a draft.
- **FIXED: no Save spot button on the phone layout after a solve.** "Save spot" exists only in the
  desktop Solve layout (`pages/solve/SolveWorkspace.tsx`); `SolvePhone` has no save
  control. It needs one on the result, using the same save and sign-in check.

## What's next

- **After the demo: compile the hot loop** (numba first, a Rust extension if numba isn't
  at least 5x faster). Target is roughly 4 ms per iteration on a wide flop. Plan is in
  `docs/compiled-solver-plan.md`.
- **UI for bet menus and the joint solve.** Both work through the API only today.
- **Full-hand solve.** Flop + turn + river in one tree needs sampling at both streets
  and the faster solver first.
- **Better narrowing.** Use the joint solve instead of a single-street solve, which
  fixes the rarely-played-line weakness.
- **Run a joint solve on Render** (estimated about 30 s for 12 river cards, not yet
  measured) and decide whether a faster host is needed.
- **Custom noding, saved-spot practice, more spots.** Still on the list from the roadmap.
- **Open questions for the team:** whether to use postflop-solver behind the API (it is
  AGPL-3.0 and unmaintained), and refreshing the Drill deck with the new solver and
  ranges (Cole's call).
