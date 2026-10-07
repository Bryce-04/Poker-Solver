---
name: schema-change
description: Use when adding, removing, or changing a field on the Spot, User, or HandRange models in packages/schema (or any Pydantic model there). Walks through updating the Python source, regenerating TypeScript types, and touching every consumer so the frontend and backend can't silently drift from the schema.
---

# Changing the shared schema

`packages/schema` is the single source of truth for the `Spot` model (see
`docs/plan.md`) — Python (Pydantic) is authoritative, TypeScript is
generated from it. Follow these steps in order for any change:

1. **Edit the Python source.** `packages/schema/src/poker_solver_schema/models.py`
   is the only place the shape should be defined. If you're adding a new
   model (not just a field), also export it from
   `packages/schema/src/poker_solver_schema/__init__.py` (both the
   `from .models import (...)` block and `__all__`).

2. **Regenerate the TypeScript types.**
   ```
   cd packages/schema
   pnpm generate
   ```
   This runs `scripts/export_json_schema.py` then `json2ts`. On Windows, if
   this fails with "Python was not found", see the Windows gotcha in
   `CLAUDE.md` — activate the venv first so a real `python` is on PATH.

3. **Update `generated/index.ts` by hand if exported names changed.** The
   codegen produces one `.d.ts` per model but doesn't maintain the barrel
   file — if you renamed a model or added a new one, add/adjust its
   `export type { ... } from "./<Model>.schema"` line there. (A
   `.claude/settings.json` hook blocks editing anything else under
   `packages/schema/generated/` — that's expected, only `index.ts` is
   meant to be touched by hand.)

4. **Update every consumer.** At minimum, check:
   - `apps/api` — anywhere it constructs, validates, or serializes the
     changed model. Saved spots are stored whole as JSONB (`SpotRow.data`
     in `app/db.py`), so a `Spot` field change needs **no** Alembic
     migration — but `GET /spots` re-validates every stored row through
     the current `Spot` model, so a new *required* field (or a narrowed
     type) breaks listing spots saved before the change. Give new fields
     a default. Only a new real `SpotRow` column needs a migration (see
     CLAUDE.md's Alembic notes).
   - `apps/web` — anywhere it imports the changed type from
     `@poker-solver/schema`.
   - `services/solver` — if the field affects what gets solved (rare
     before Stage 5).

5. **Run the tests.** `pytest services/solver` at minimum; add/update a
   test in `apps/api` if the change affects request/response shapes. Run
   `pytest apps/api` against the local docker-compose Postgres with
   `DATABASE_URL` set explicitly — never Supabase, since those tests
   `TRUNCATE spots` (see CLAUDE.md).

6. **Commit `models.py` and the regenerated `generated/*.d.ts` /
   `generated/index.ts` together** — never commit one without the other.
