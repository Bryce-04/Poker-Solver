# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A web-based poker solver focused on ease of use versus tools like PioSolver
or GTO Wizard. Full roadmap, what's been revised from the original plan and
why, and the architecture rationale live in [docs/plan.md](docs/plan.md) —
read that before making structural decisions. **Current status: Stage 1
and 2 are complete. Stage 3 (text entry, `parseSpotText.ts`) and Stage 4
(hand-history import, `parseHandHistory.ts` — one format, a full 6-handed
6-max table) both recognize only the same two shapes the button builder
does — rule-based, not freeform text, per plan.md's "rule-based parser
first, not LLM-first." The 13×13 range grid (weighted-brush/drag-paint/
keyboard selection with weight shading) is mounted editable everywhere a
matched chart is shown (Builder, Type in, Import) — adjust before saving,
not just view. The whole app has a design-token visual pass (light +
dark, `index.css`) and is routed into four screens (Builder / Saved /
Type in / Import). Saved spots is wired end-to-end: `apps/api` persists
Spots as JSONB (`app/db.py`'s `SpotRow`, no migration tool yet -- the
schema can still move) behind `POST`/`GET /spots`, matching the contract
`apps/web/src/lib/api.ts` was built against (see `docs/decisions.md`).
Stage 6 auth has a frontend start: Supabase email/password sign-in,
session state, and an `Authorization` header on save/list calls
(`apps/web/src/lib/auth.tsx`, `lib/supabase.ts`, the header's
`AuthStatus` component); the save button on all three entry screens
gates on being signed in. Not done yet: `apps/api` verifying that header
and scoping `GET /spots` per user — until that lands, saved spots stay a
shared list regardless of who's signed in. `apps/api` is deployed on
Render, `DATABASE_URL` points at Supabase; an Android build (Capacitor,
`apps/web/android/`) has a real app icon/splash and runs end-to-end
against the live API on a physical device. **`services/solver` now has
a real river-only MCCFR engine** (heads-up, a fixed 5-card board, two
ranges, the locked bet-size menu — `river_mccfr.py`, backed by a
from-scratch hand evaluator and a range-to-combo sampler, checked
against closed-form poker theory in `tests/test_river_mccfr.py`), not
yet wired to `apps/api` or the frontend, and flop/turn aren't solvable
yet (no runout logic).**

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

cd apps/api && uvicorn app.main:app --reload              # GET /health
cd services/solver && python -m poker_solver.kuhn_spike   # Stage 1 toy CFR spike demo
cd services/solver && python -m poker_solver.river_mccfr  # the real river-only solver demo
pytest services/solver                                    # from repo root, or `pytest` from within services/solver
pytest services/solver/tests/test_river_mccfr.py           # the real solver's closed-form regression test
```
`apps/api` requires a reachable `DATABASE_URL` even to run `pytest
apps/api` — `/health` does a real `SELECT 1`, and `app.main` (imported by
every test module) creates the engine at import time. Either run the
local Postgres below, or point `.env`'s `DATABASE_URL` at Supabase (see
`.env.example`). `db.py` loads `.env` itself via `python-dotenv` for bare
`uvicorn --reload` runs; docker-compose and Render set the real env var
directly, so that's a no-op there.

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
  representation. `apps/web/src/lib/spot.ts` is where that convergence
  actually lives on the frontend: `buildOpenSpot`/`buildVsRaiseSpot` are
  shared by `SpotBuilder` and `parseSpotText.ts` — a new entry path adds a
  call into `lib/spot.ts`, not its own inline `Spot` construction. `apps/api`
  and `services/solver` both `pip install -e` this package rather than
  depending on copies.
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
  before Stage 5's real solver depended on that assumption. Note: Kuhn
  poker has a *family* of equilibria (parameterized by alpha in [0, 1/3])
  — opening-action frequencies aren't a fixed point to assert on in
  tests; what's invariant is that the best hand always continues facing
  a bet (see `test_kuhn_spike.py`). The real solver now exists:
  `river_mccfr.py` (chance-sampled MCCFR, heads-up, a fixed river board,
  the locked bet-size menu — same regret-matching shape as
  `kuhn_spike.py`'s `KuhnCfrTrainer`), backed by `evaluator.py` (a
  from-scratch hand evaluator), `combos.py` (`HandRange`'s 169-type
  labels → concrete, board-aware card combos), and `river_game.py` (the
  betting action abstraction, as a pure state machine). Its own
  closed-form convergence test (`test_river_mccfr.py`) now covers the
  "does CFR converge correctly" question `kuhn_spike.py` was there to
  answer first — `kuhn_spike.py` is a reasonable deletion candidate at
  this point, kept for now rather than deleted reflexively. See
  `services/solver/README.md` for the module layout and the one
  payoff-arithmetic subtlety worth knowing about before touching
  `river_game.py`'s `terminal_utility`. Not wired to `apps/api` or the
  frontend yet; flop/turn aren't solvable yet (need Monte Carlo runout
  sampling on top of the range sampling this already does).
- **`apps/web`** (React + TypeScript + Vite) is the only consumer of the
  generated TS types in `packages/schema/generated`. Routed via
  `react-router-dom`, with `BrowserRouter` nested inside `App.tsx` (not
  `main.tsx`) so `App.test.tsx`'s `render(<App />)` needs no extra wrapper.
  Screens live in `apps/web/src/pages/`; `apps/web/src/lib/api.ts` is the
  single fetch chokepoint (never throws — callers switch on a result's
  `kind` instead of try/catch), currently backing the reference-strategy
  lookup plus `saveSpot`/`listSpots`, the latter two built against an
  assumed `apps/api` contract ahead of that endpoint shipping — see
  `docs/decisions.md`.
- Effective stack is modeled as a single symmetric number
  (`Spot.effective_stack_bb`) rather than per-seat, matching the
  heads-up scope locked in for Stage 5. Widening to per-seat stacks is a
  Stage 5+ change, not something to retrofit into the schema speculatively.
- `Spot.created_by` and the `User` model exist now (Stage 1) even though
  no auth/login UI ships until Stage 6 — this was a deliberate fix versus
  the original plan, to avoid retrofitting ownership onto existing rows
  later. Don't remove `created_by` as "unused."
