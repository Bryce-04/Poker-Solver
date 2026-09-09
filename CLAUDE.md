# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A web-based poker solver focused on ease of use versus tools like PioSolver
or GTO Wizard. Full roadmap, what's been revised from the original plan and
why, and the architecture rationale live in [docs/plan.md](docs/plan.md) —
read that before making structural decisions. **Current status: Stage 1
(foundations) is complete. Stage 2 (manual hand builder) is nearly done —
a spot builder and 13×13 range grid in `apps/web`, wired to a
reference-chart lookup (`POST /spots/reference-strategy`) in `apps/api`
(coverage in [docs/reference-chart-coverage.md](docs/reference-chart-coverage.md)).
The range-grid interactions (weighted brush, drag-paint, keyboard) and a
design-token visual pass (light + dark) are done. Still open: multi-page
routing and a mobile packaging path. The editable range grid isn't mounted
in a screen yet — SpotBuilder uses it read-only; Stage 3 is its first
editing consumer.**

## Commands

This is a pnpm workspace (`apps/*`, `packages/*`) plus two standalone
Python projects (`apps/api`, `services/solver`) that aren't part of the
pnpm workspace but do depend on `packages/schema` via `pip install -e`.

### Web (`apps/web`)
```
pnpm install                 # from repo root, installs all JS workspace deps
pnpm dev:web                 # dev server
pnpm --filter web build      # production build (tsc -b && vite build)
pnpm --filter web lint       # oxlint
```

### Schema (`packages/schema`) — the shared source of truth
Python (Pydantic, in `src/poker_solver_schema/models.py`) is authoritative;
TypeScript types in `generated/` are produced from it, never hand-edited.
After changing `models.py`:
```
cd packages/schema
pnpm generate                # runs export_json_schema.py, then json2ts
```
`generated/*.schema.json` (the intermediate JSON Schema) is gitignored;
`generated/*.d.ts` and `generated/index.ts` (the actual TS output) are
committed. If a model's exported names change, update the re-exports in
`generated/index.ts` by hand to match.

### API (`apps/api`) and solver (`services/solver`)
```
python -m venv .venv && source .venv/Scripts/activate   # or .venv/bin/activate on macOS/Linux
pip install -e packages/schema -e apps/api -e "services/solver[dev]"

cd apps/api && uvicorn app.main:app --reload             # GET /health
cd services/solver && python -m poker_solver.kuhn_spike  # runs the CFR spike demo
pytest services/solver                                    # from repo root, or `pytest` from within services/solver
pytest services/solver/tests/test_kuhn_spike.py::test_cfr_converges_to_known_game_value   # single test
```

### Local Postgres
```
docker compose -f infra/docker-compose.yml up -d db
```

### Windows gotcha
On Windows, a bare `python` on PATH can resolve to the Microsoft Store's
app-execution-alias stub instead of a real interpreter (fails with
"Python was not found..."), even when `py` works fine. This bites
anything that shells out to `python` — including `pnpm generate` in
`packages/schema`, which calls `python` internally. Fix: create/activate
the venv above (puts a real `python` first on PATH), or use `py -m venv`
if bootstrapping the venv itself hits the same issue.

## Architecture

Four services, one shared schema, request flow: `web -> api -> {solver, postgres, auth}`.

- **`packages/schema`** is the single source of truth for the `Spot` model
  (positions, effective stack in bb, board, action history, ranges) and
  `User`. Every entry path — button builder (Stage 2), text parser (Stage
  3), hand history import (Stage 4) — must converge on the same `Spot`
  shape from here; don't let any of those define their own parallel
  representation. `apps/api` and `services/solver` both `pip install -e`
  this package rather than depending on copies.
- **`apps/api`** (FastAPI) owns spot CRUD, auth glue, and orchestrating
  calls to the solver — it's the only thing that talks to Postgres and to
  `services/solver` directly. The frontend never calls the solver service
  directly.
- **`services/solver`** is intentionally its own package/service, not a
  module inside `apps/api` — Stage 5's real MCCFR engine is meant to be a
  long-running compute service (not request-scoped serverless), and
  keeping it separable now avoids an awkward split later.
  `kuhn_spike.py` is a **throwaway** CFR proof-of-concept on Kuhn poker
  (a toy game with a known closed-form equilibrium, game value -1/18),
  used to validate that CFR-family regret matching converges correctly
  before Stage 5's real solver depends on that assumption. Delete it once
  Stage 5 has its own convergence tests covering the same question. Note:
  Kuhn poker has a *family* of equilibria (parameterized by alpha in
  [0, 1/3]) — opening-action frequencies aren't a fixed point to assert
  on in tests; what's invariant is that the best hand always continues
  facing a bet (see `test_kuhn_spike.py`).
- **`apps/web`** (React + TypeScript + Vite) is the only consumer of the
  generated TS types in `packages/schema/generated`.
- Effective stack is modeled as a single symmetric number
  (`Spot.effective_stack_bb`) rather than per-seat, matching the
  heads-up scope locked in for Stage 5. Widening to per-seat stacks is a
  Stage 5+ change, not something to retrofit into the schema speculatively.
- `Spot.created_by` and the `User` model exist now (Stage 1) even though
  no auth/login UI ships until Stage 6 — this was a deliberate fix versus
  the original plan, to avoid retrofitting ownership onto existing rows
  later. Don't remove `created_by` as "unused."
