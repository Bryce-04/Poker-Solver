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
Spots as JSONB (`app/db.py`'s `SpotRow`) behind `POST`/`GET /spots`,
matching the contract `apps/web/src/lib/api.ts` was built against (see
`docs/decisions.md`). Stage 6 auth works for saved spots. Frontend:
Supabase email/password sign-in, session state, and an `Authorization`
header on save/list calls (`apps/web/src/lib/auth.tsx`, `lib/supabase.ts`,
the header's `AuthStatus` component); the save button on all three entry
screens gates on being signed in. Backend: `apps/api`
verifies that header as a Supabase JWT (`app/auth.py`'s `current_user_id`
dependency, checked against the project's public JWKS keys -- only
`SUPABASE_URL` needed, no secret), `POST`/`GET /spots` require it, and
`GET /spots` only returns the caller's own spots (`SpotRow.created_by`).
Rows saved before auth have no owner and are deliberately left in place,
listed for no one. The `spots` table is managed by Alembic
(`apps/api/migrations`), not `create_all`. `apps/api` is deployed on
Render, `DATABASE_URL` points at Supabase; an Android build (Capacitor,
`apps/web/android/`) has a real app icon/splash and runs end-to-end
against the live API on a physical device. **`services/solver` now
solves any single postflop street** — flop, turn, or river, heads-up,
two ranges, the locked bet-size menu — with `range_cfr.py`: range-vs-range
Discounted CFR (every combo trained every iteration, no hole-card
sampling), terminal values from an exact precomputed equity matrix
(`equity.py`, every runout enumerated), trained until exploitability is
under 0.5% of the pot. It replaced the Monte Carlo trainer
(`postflop_mccfr.py`, kept but unused) on 2026-10-07 after that was
measured producing noise for realistic wide ranges — see
`docs/decisions.md`'s top entry. Checked against closed-form poker theory
(to within 1%), brute-force equity, and a regression test of the exact
bug scenario (`tests/test_range_cfr.py`). It's
wired up now too: `apps/api`'s `POST /spots/solve` (`app/solve.py`) calls
into it synchronously and returns a real per-action-frequency strategy
for whichever player's decision the request implies — see
`docs/decisions.md`'s 2026-10-06 entry for the request contract (a new
convention on `Spot`, not a schema change: `positions_in_hand` needs two
entries, `ranges` needs both). `apps/web` has a screen for it now too: `pages/SolvePage.tsx` ("Solve")
— two positions, two `RangeGrid`s (each with a "Load reference range"
button, open-chart-then-defend-chart fallback so every position pair
has a one-click default instead of starting blank), a board enterable
as validated text (`lib/cards.ts`) or by clicking cards
(`components/CardPicker/CardPicker.tsx` — both converge on the same
`ParseBoardResult`), a "paste a hand history" shortcut
(`lib/parseHandHistory.ts`'s `parseHandHistoryToPostflopSetup`) that
fast-forwards a pasted hand to whichever street it stops at and fills
in board/pot/stack/positions from what actually happened (reading what
happened, not solving it — not a step toward multi-street solving, see
`docs/decisions.md`), and results shown as a 13×13 color-coded strategy
chart (`components/StrategyGrid/StrategyGrid.tsx`), not a table, with
the solve's measured precision (`exploitability_pct`) shown alongside.
Multi-street solving (modeling betting across flop *and* turn *and*
river in one tree, as opposed to one street at a time) stays a separate,
bigger future direction, not done — and the related open question of
where a later street's range should come from is written up in
`docs/plan.md`.

**Shipped since**: the locked bet-size menu is now **Bet Small (25%) /
Bet Medium (75%) / Bet Large (125%) / All-in** (was 33%/66%/100% pot),
and `/spots/solve` seeds from any non-terminal action prefix on the
current street — not just an empty street or a single check — so a
solve can start right after a bet, a raise, or a short sequence (lossy
size-bucketing onto the menu, disclosed via the response's
`bucketed_actions` rather than hidden; an out-of-turn or already-
terminal sequence 422s). On top of that, `SolvePage` gained a real
click-through hand builder (`lib/handBuilder.ts`,
`components/StreetActions/StreetActions.tsx`) as an alternative to
pasting a hand history: distinct preflop/flop/turn/river sections, real
actions with real bb sizes (not the fixed menu — that's only what the
backend buckets a size onto at solve time), preflop supporting repeated
raises (3-bet/4-bet, not just one raise/one call, under an assumed
1bb/0.5bb blind structure), and `pot_bb`/`effective_stack_bb` computed
from what was actually entered rather than typed in. An earlier street
has to close (not fold) before the next one unlocks; "Solve" targets
whichever street the board's card count reaches, as soon as nothing
upstream is blocking it. The old "paste a hand history" shortcut
(`lib/parseHandHistory.ts`'s `parseHandHistoryToPostflopSetup`) still
exists as a separate, alternative setup mode, not replaced. See
`docs/decisions.md`'s 2026-10-07 entries for both pieces' design.
A phone "black screen" bug from the same day is fixed (a newer frontend
crashed on a response field the older deployed backend didn't send yet,
with no error boundary to catch it): `solveSpot` normalizes responses,
`components/ErrorBoundary` wraps every route, and `solveSpot` has explicit
CapacitorHttp timeouts again — see that decision entry.

**Verified**: `pytest services/solver` (108 passed), the web suite (183
passed), lint, and build green. **Not yet verified**: `pytest apps/api`
against a real Postgres (no reachable DB in the working session — the
route logic was exercised by calling `solve_spot` directly instead), and
the new solver on Render (deploying needs this branch merged to `main`).
All of this is on branch `handhistory-to-solve`, **uncommitted** as of
this note.

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

cd apps/api && uvicorn app.main:app --reload                 # GET /health
cd services/solver && python -m poker_solver.kuhn_spike      # Stage 1 toy CFR spike demo
pytest services/solver                                       # from repo root, or `pytest` from within services/solver
pytest services/solver/tests/test_range_cfr.py                # the live solver's theory + regression tests
```
`apps/api` requires a reachable `DATABASE_URL` even to run `pytest
apps/api` — `/health` does a real `SELECT 1`, and `app.main` (imported by
every test module) creates the engine at import time. **Run the tests
against the local Postgres below, never Supabase**: the persistence tests
`TRUNCATE spots`, and `db.py` loads the repo-root `.env` (which may point
at Supabase) unless `DATABASE_URL` is already set — so set it explicitly:
```
DATABASE_URL=postgresql+psycopg://poker_solver:poker_solver_dev@localhost:5432/poker_solver pytest apps/api
```
The test session runs `alembic upgrade head` itself (`tests/conftest.py`)
and signs its own tokens with a throwaway key, so tests need no Supabase
access. `db.py` loads `.env` itself via `python-dotenv` for bare
`uvicorn --reload` runs; docker-compose and Render set the real env var
directly, so that's a no-op there.

Schema changes to the `spots` table go through Alembic, from `apps/api`:
edit `SpotRow` in `app/db.py`, then `alembic revision --autogenerate -m
"..."`, review the generated file, and `alembic upgrade head`. `alembic
check` confirms models and migrations agree. Deploys (the Dockerfile's
CMD, docker-compose) run `alembic upgrade head` before starting uvicorn.
Running the API locally (`uvicorn`) does not migrate — run `alembic
upgrade head` first. Requests to `/spots` (save/list) need `SUPABASE_URL`
set, for token verification.

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
  a bet (see `test_kuhn_spike.py`). The live solver is `range_cfr.py`'s
  `RangeCfrTrainer`: range-vs-range Discounted CFR for one postflop
  street (flop, turn, or river), heads-up, the locked bet-size menu —
  every combo of both ranges gets a strategy at every public node on
  every iteration, weighted by reach probability, and nothing is
  Monte-Carlo-sampled at all (runouts are enumerated exactly in
  `equity.py`'s precomputed equity matrix). Backed by
  `evaluator.py` (a from-scratch hand evaluator, plus `evaluate_seven`/
  `evaluate_seven_batch` fast paths that must stay exactly equal to the
  brute-force `evaluate_best` — `test_evaluator.py` checks that),
  `combos.py` (`HandRange`'s 169-type labels → concrete, board-aware
  combos), and `betting_round.py` (the betting abstraction as a pure,
  card-agnostic state machine). Convergence is measured, not assumed:
  `exploitability()` / `train_until()` — use them to compare any future
  change to the update rule or iteration policy. `postflop_mccfr.py`
  (the superseded Monte Carlo trainer) and `kuhn_spike.py` are no longer
  used by `apps/api` — real deletion candidates, kept for now rather
  than deleted reflexively. See `services/solver/README.md` for the
  module layout and how the trainer is validated, and the
  payoff-arithmetic subtlety worth knowing about before touching
  `betting_round.py`'s `terminal_utility` (`range_cfr.py`'s
  `_terminal_value` mirrors it). `apps/api`'s `POST /spots/solve`
  (`app/solve.py`) calls `train_until` and `label_strategies` — see
  `docs/decisions.md`'s 2026-10-06 entry for the request contract.
  `apps/web/src/pages/SolvePage.tsx` ("Solve") consumes it; multi-street
  solving (one tree spanning flop+turn+river, rather than one street at
  a time) is a separate, bigger future direction.
- **`apps/web`** (React + TypeScript + Vite) is the only consumer of the
  generated TS types in `packages/schema/generated`. Routed via
  `react-router-dom`, with `BrowserRouter` nested inside `App.tsx` (not
  `main.tsx`) so `App.test.tsx`'s `render(<App />)` needs no extra wrapper.
  Screens live in `apps/web/src/pages/`; `apps/web/src/lib/api.ts` is the
  single fetch chokepoint (never throws — callers switch on a result's
  `kind` instead of try/catch), currently backing the reference-strategy
  lookup plus `saveSpot`/`listSpots` (both send the Supabase access
  token as `Authorization: Bearer`, which `apps/api` requires). Those two
  were built against an assumed `apps/api` contract ahead of the
  endpoints and the token check shipping, since confirmed — see
  `docs/decisions.md`.
- Effective stack is modeled as a single symmetric number
  (`Spot.effective_stack_bb`) rather than per-seat, matching the
  heads-up scope locked in for Stage 5. Widening to per-seat stacks is a
  Stage 5+ change, not something to retrofit into the schema speculatively.
- `Spot.created_by` and the `User` model exist now (Stage 1) even though
  no auth/login UI ships until Stage 6 — this was a deliberate fix versus
  the original plan, to avoid retrofitting ownership onto existing rows
  later. Don't remove `created_by` as "unused" — `apps/api` now sets it
  from the verified token on every save (and mirrors it into the
  `SpotRow.created_by` column that `GET /spots` filters on).
