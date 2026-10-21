# Progress and struggles (2026-10-18 to 2026-10-21)

A plain list of what's been built since the range-narrowing work began, what's still open, and what
has been hard. Written for demo prep. Everything here is measured or tested unless marked
*estimate*; details and numbers live in `docs/decisions.md`.

## What's live (merged to `main`, deployed on Render)

**Narrowing ranges by what players did (PR #26).** After a street is played, the app can work out
which hands would actually have played that way and carry only those into the next street's solve,
instead of a full preflop range on the river.
- Solver: `RangeCfrTrainer.posterior_ranges` and `POST /spots/narrow`.
- Solve page: a "Narrow by earlier action" button (flop, then turn), with Undo. It refuses a line the
  equilibrium takes under 10% of the time (the range would be mostly noise) and drops hands under 2% of
  the top hand's weight, telling you how many.
- A caught problem: BTN jamming wide on a flush turn came from narrowing by a line taken 3.4% of the
  time. Fixed with the guard above, and the results chart now fades hands by how much of the range they
  are and weights its headline the same way.

**Suit-level ranges.** A range can now say "only the heart combo of AKs", not just "AKs".
- A "Suits" mode on the range grid opens a 4x4 suit editor for a hand; board-blocked suits are greyed.
- Solve results include per-suit strategies where suits play differently (flush draws, blockers), shown
  when you tap a hand in the result.
- Fixed along the way: tapped cells turned purple on a touchscreen (a global hover colour that sticks),
  and the suit view showed suits that weren't in the range.

**3-bet and 4-bet ranges.** Nine opener/defender position pairs at 100bb (open+call, 3-bet pot, 4-bet pot),
built by principle and labelled approximate. `POST /spots/preflop-ranges`, and a "Load both ranges from
the preflop action" button, so a 3-bet pot starts with the right range for each player.

**Custom bet sizes (PR #31, API only).** A solve can take its own bet sizes and raise cap instead of the
fixed 25/75/125% menu. The default is unchanged.

**Solver speed (PR #32).** 2.4x to 4.3x faster end to end with the same answers (wide flop 10.9s to about
3.3s on the laptop). Enforced by a frozen copy of the old solver that the new one must match exactly in
float64. Measured on Render afterwards: the same wide flop solves in **13.0s warm** (first request after
idle: 51.8s including the cold start).

## In review / in progress

**Joint turn + river solve (branch `joint-solve`).** Solves the turn and river as one game, so the turn
strategy knows what the river will be like. Validated by exact equivalence to the single-street solver in
float64, and then against a mature open-source solver (below). Not merged; no UI.

**Checked against postflop-solver (Rust).** On the same turn game, OOP's game value agrees to 0.01 chip
(412.66 vs 412.65) and root frequencies to 0.46 points, so the answers are right. Ours is about 20x slower
single-thread and about 100x slower than their multithreaded run. See the plan below.

**Planned, not started:** make the solver faster by compiling its hot loop (`docs/compiled-solver-plan.md`).
Deliberately deferred until after the demo.

## Teammates' work (for context; not mine)
Cole: the Poker Drill and the iOS app. Peyton: the desktop redesign. Both are being demoed separately.

## What's on the phone right now
The latest `main`: the guided Solve flow, narrowing, the Suits editor, suit view in results, loading ranges
from the preflop action (3-bet pots), and the Drill. **Not visible on the phone:** custom bet sizes and the
joint solve (no UI for either yet). The speed-up is live on the server, so solves return faster.

## The struggles (honest list)

1. **Narrowing by an unlikely line is unreliable.** The equilibrium plays some lines a few percent of the
   time, and the "range" for such a line is mostly leftover noise. The guards stop the worst cases, but the
   real fix is solving streets together (the joint solve is the first step), and that doesn't yet feed
   narrowing.
2. **The solver is slow compared to a compiled one.** About 20x single-thread and 100x multithreaded, with
   about 20x the memory. It's a numpy ceiling, not something tuning fixes. This is what limits how big a game
   fits on Render, and it blocks a full flop + turn + river solve.
3. **A full-hand solve is out of reach for now.** The joint solve is turn + river only. Adding the flop puts
   a chance node inside a chance node and needs card sampling at both streets, which needs the faster solver
   first.
4. **Sampling river cards is an approximation.** With 12 of 48 cards the turn frequencies are within about
   1.2 points of exact. It also broke our convergence measure (a sampled game isn't constant-sum), which cost
   a day to find and fix.
5. **Limits of what's verified.** Correctness against a real solver is proven for one turn spot. The joint
   solve hasn't run on Render. Ranges for 3-bet/4-bet pots are principled approximations, not solver output.
   The Drill deck was solved with the older trainer and ranges.
6. **No UI for the newest features.** Bet menus and the joint solve exist in the API only; the UI is
   Peyton's and is being demoed, so I left it alone. Saved spots can carry a bet menu but the Solve page
   doesn't round-trip it.
7. **Equilibria aren't unique.** At near-tied actions two correct solvers, or two float32 runs of ours, pick
   different mixes. Comparing strategies hand by hand is a test of luck; comparing the game value is not. That
   shaped how the tests are written, but it makes "does this match" hard to show on a slide.
8. **Working environment friction.** No local Postgres (database tests only run in CI), `gh` isn't installed
   (PRs are opened from links), the phone's USB debugging authorization keeps dropping, and a Windows Python
   stub breaks commands unless the virtual environment is active.
9. **Stacked, large pull requests.** Three branches built on each other (bet sizes, speed, joint solve) had to
   merge in order, and the diffs were big. Smaller, independent PRs would have been easier to review.

## Numbers worth quoting
| | |
|---|---|
| Wide flop solve, laptop, before / after speed work | 10.9s / about 3.3s |
| Same solve on Render (warm) | 13.0s |
| Joint turn+river, 12 river cards, laptop | about 7s (to 0.5% of pot) |
| Game value vs postflop-solver, same game | 412.66 vs 412.65 chips |
| Speed vs postflop-solver, same game | about 20x slower single-thread, about 100x vs 12 threads |
| Tests | 201 solver, about 115 API (DB-free), 343 web |
