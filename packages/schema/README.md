# packages/schema

The Spot data model, and everything that hangs off it — one source of truth
shared by the API, the solver, and the frontend.

**Python (`src/poker_solver_schema/models.py`) is the source of truth.**
TypeScript types are *generated* from it, never hand-written, so the two
sides can't silently drift.

## Regenerating the TypeScript types

```
pnpm install
pip install -e ".[codegen]"
pnpm generate
```

This runs `scripts/export_json_schema.py` (Pydantic models → JSON Schema in
`generated/*.schema.json`), then `json2ts` (JSON Schema → `generated/*.ts`).
Commit the regenerated files alongside any change to `models.py`.

## What's in here (Stage 1)

- `Position`, `Street`, `ActionType` — the fixed vocabularies every entry
  path (button builder, text parser, hand history import) has to agree on.
- `BettingAction` — one action in a hand's history.
- `HandRange` — a hand-combo → weight mapping; what the 13×13 grid produces.
- `Spot` — the full situation: positions, effective stack, board, actions,
  ranges. This is what Stages 2-4 all build, and what Stage 5 solves.
- `User` — minimal account shape, added now so Stage 6 doesn't retrofit
  ownership onto existing Spot rows later.

See [`../../docs/plan.md`](../../docs/plan.md) for why `effective_stack_bb`
is a single number for now, and where that's expected to change.
