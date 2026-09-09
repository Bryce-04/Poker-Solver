# Decision log

Short, dated records of choices that aren't obvious from the code. Newest
first. Status is **proposed** until the team ratifies (a 👍 in the channel
or a review approval is enough); flip to **accepted** then.

---

## 2026-09-09 — Board card picker is out of Stage 2

**Status:** proposed

**Context.** The spot builder scaffold has a TODO for a board (flop/turn/
river) card picker. Stage 2's only output is preflop reference charts, and
`find_matching_chart` returns nothing for any non-preflop street. Nothing
in Stage 2 consumes a board.

**Decision.** Do not build the board picker in Stage 2. Remove the TODO
from `SpotBuilder.tsx` or re-file it against Stage 5 (postflop solving),
which is the first thing that needs a board.

**Consequences.** `Spot.board` stays at its schema default (empty list).
The builder is preflop-only for Stage 2, which matches the reference-chart
scope exactly.

---

## 2026-09-09 — Defend charts stay a combined call-or-3bet range

**Status:** proposed

**Context.** `HandRange` maps each hand to a single weight, so a "defend
vs an open" chart can't express "call 60% / 3bet 15%" as two numbers. The
plan defers a real call/3bet split to Stage 5's live solve.

**Decision.** Stage 2 defend charts represent the whole **continuing**
range (call or 3bet, combined). No schema change. The frontend labels
these results *"Continuing range (call or 3-bet) — reference chart, not a
solve."*

**Consequences.** Users see which hands keep playing versus an open, but
not the action split. Revisit at Stage 5, when the solver produces real
per-action frequencies. See `docs/reference-chart-coverage.md`.
