# Plan: compile the solver's hot loop (planned, not started)

Deferred until after the demo. This is the plan for "option 1" in `docs/decisions.md`
(2026-10-21, "Checked against postflop-solver"): keep the Python solver and its tests, and compile
the part that is slow.

## Why

Measured on the same game against postflop-solver (Rust): our answers match (OOP game value 412.66 vs
412.65 chips), and the iteration counts match, but each iteration costs 134-146 ms against their 1.7 ms
(12 threads) or 8.3 ms (1 thread), and we use about 20x the memory (156 MB vs 7.3 MB). So the gap is
entirely cost per iteration: a numpy ceiling, not an algorithm problem.

What it unlocks, in order of value:
1. Bigger games fit and finish on Render: more bet sizes, deeper raise caps, more river cards in a joint solve.
2. A flop + turn + river solve (card sampling at two streets) becomes thinkable; today it is not.
3. Cheap batch solving (regenerating the Drill deck, pre-solving saved spots).

## Where the time goes today (wide flop, about 19 ms per iteration, two passes)

From the per-phase timing in the speed work. Rough shares: top-down reach vectors about 16%, the terminal
matrix multiply plus blocker counting about 25%, assembling terminal values about 18%, bottom-up values
about 17%, the DCFR update and regret matching about 22%. Python call overhead is already gone (about
2,600 calls per 60 iterations); what's left is many separate numpy passes over (actions x hands) float64
arrays, each reading and writing memory once. A fused compiled loop does the same arithmetic in one pass.

## What to compile (and what to leave alone)

Leave the terminal matrix multiply to BLAS (it is already a matrix multiply). Compile, as small separate
kernels with the current numpy code kept as the fallback and the oracle:
1. Reach vectors, top-down: gather a parent row, multiply by a strategy row or a river-card mask, store.
2. Blocker mass: the per-card sums and inclusion-exclusion that give "opponent weight I can face".
3. Values, bottom-up: per-node sum, max, or strategy-weighted sum over children.
4. The DCFR update: regret discount and add, strategy-sum update, and regret matching, fused per node.

The tree and the level schedule (`_Schedule`) stay exactly as they are; only the loops inside `_pass` change.

## Approach: spike numba first, with a go/no-go

| | numba | Rust extension (PyO3 + maturin) |
|---|---|---|
| Effort | lowest: Python syntax, JIT | higher: a new language and build in the repo |
| Speed | good (compiled loops, optional threads); likely 5-15x here | best; the reference solver is this |
| Deploy on Render | adds a large dependency; first call compiles (mitigate with a disk cache and a warm-up at start) | needs a Rust toolchain in the Docker build; ships a wheel |
| Windows dev | simple | works but needed a linker workaround here (Zig) |

**Spike (1-2 days):** port only the DCFR update kernel with numba and run `benchmarks/bench_trainer.py`.
- Go: at least 5x on that kernel's share and no change in the equivalence tests. Continue with numba.
- No-go: under about 3x, or compile time or image size is unworkable on Render. Switch to the Rust extension.

## How it stays correct

The tests already written for the speed work are the safety net and must pass unchanged:
- `tests/test_range_cfr_matches_reference.py`: float64 equivalence to the frozen original on eight spots
  (strategies about 1e-9), plus the float32 checks.
- `tests/test_joint_solve.py`: the exact equivalences for the joint solve.
- `benchmarks/external/`: the game value must still match postflop-solver's (412.65 chips on the checked spot).

Add kernel-level tests that compare each compiled kernel with its numpy version on random inputs.

## Acceptance

- All existing tests pass; the float64 equivalence tolerances do not loosen.
- `bench_trainer.py` wide flop at or under about 4 ms per iteration (today about 19 ms), joint 12-card solve at
  or under about 10 ms (today about 47 ms). These are targets, not measured results.
- The harness in `benchmarks/external/` shows a single-thread gap of 5x or less (today about 20x).
- Render: cold-start compile time under about 5 seconds (or none, with a cached build), and the image still deploys.

## Order of work (estimates, not measured)

1. Spike and decide (1-2 days).
2. Port the four kernels with the fallback and the tests (3-5 days).
3. Threads across nodes within a level, and an optional float32 state to halve memory (2-3 days). float32 will
   end the exact float64 comparison for that mode, so keep float64 as the default and test float32 on
   exploitability.
4. Deploy: cache or ahead-of-time build, Render check, update `CLAUDE.md` and the benchmarks' recorded numbers.

## Not part of this plan

- Using postflop-solver itself behind the API. It is AGPL-3.0 (a network service built on it must offer its
  source) and unmaintained since October 2023. That is a licensing decision for the team and is separate.
- UI for bet menus or the joint solve (Peyton's area, separate).
