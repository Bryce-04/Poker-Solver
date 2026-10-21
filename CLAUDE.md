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
dark, `index.css`) and is routed into four destinations (Solve / Ranges /
Library / Drill; see "Desktop redesign" below). Saved spots is wired end-to-end: `apps/api` persists
Spots as JSONB (`app/db.py`'s `SpotRow`) behind `POST`/`GET /spots`,
matching the contract `apps/web/src/lib/api.ts` was built against (see
`docs/decisions.md`). Stage 6 auth works for saved spots. Frontend:
Supabase email/password sign-in, session state, and an `Authorization`
header on save/list calls (`apps/web/src/lib/auth.tsx`, `lib/supabase.ts`,
the header's `AuthStatus` component); the save button on all three entry
screens gates on being signed in. Backend: `apps/api`
verifies that header as a Supabase JWT (`app/auth.py`'s `current_user_id`
dependency, checked against the project's public JWKS keys -- only
`SUPABASE_URL` needed, no secret), `POST`/`GET /spots` and
`PATCH`/`DELETE /spots/{id}` (rename / delete) require it, and every one
only ever touches the caller's own spots (`SpotRow.created_by`). A spot
that's missing, someone else's, or ownerless is the same 404 to
PATCH/DELETE. Rows saved before auth have no owner and are deliberately
left in place, listed for no one. The `spots` table is managed by Alembic
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
raises (3-bet/4-bet, not just one raise/one call, with each seat
posting its own 0.5/1bb blind and the other seats' blinds as dead money), and `pot_bb`/`effective_stack_bb` computed
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

**Range chaining, backend only (2026-10-18)**: `RangeCfrTrainer.posterior_ranges`
and `POST /spots/narrow` compute each player's range after a closed street's
recorded actions (Bayesian update from the street's equilibrium strategy) so a
later street can start from them (the Solve page's "Narrow ranges by the flop/turn action" button, `lib/chaining.ts`). Ranges (`HandRange`) now accept
specific-combo keys (`AhKh`) alongside 169-type labels, and narrowed ranges
come back combo-level where suits matter (flush draws, blockers), plus a
`line_probability` per player to flag lines the equilibrium never plays; solve results carry `combo_strategy` (per-suit strategies where suits differ) shown in `StrategyGrid`'s suit view. See
`docs/decisions.md`.

**3-bet / 4-bet ranges (2026-10-18)**: `apps/api/app/preflop_ranges.py` +
`POST /spots/preflop-ranges` give both players' ranges for a single-raised,
3-bet or 4-bet pot at ~100bb (nine position pairs, approximate, constructed by
principle); the Solve page's "Load both ranges from the preflop action"
button uses it. See `docs/reference-chart-coverage.md` and `docs/decisions.md`.

**Solver speed (2026-10-21)**: `range_cfr.py` was rebuilt for speed with the
same answers (2.4x to 4.3x faster end to end; wide flop 10.9s to ~3.3s). The tree is
built once and each pass is planned level by level (`_Schedule`); all of a pass's
terminals are one matrix multiply; every node's training state lives in contiguous
per-player arrays; the equity matrix and hand evaluator are vectorized over runouts;
DCFR is 1.5 / 0.5 / 3. **Equivalence is enforced**: `tests/reference_range_cfr.py` is a
frozen copy of the old trainer and `test_range_cfr_matches_reference.py` holds the real
one to it (exactly, in float64) — if you change the update rule on purpose, change the
reference copy in the same commit and say why. Tools: `services/solver/benchmarks/`
(`bench_trainer.py` for timings, `--reference` for the old one; `sweep_dcfr.py` for
tuning). The equity matrix is cached (64 MB LRU): clear `equity._cache` when timing.
See `docs/decisions.md`.

**Custom bet sizes (2026-10-21)**: `Spot.bet_menu` (schema `BetMenu`: `sizes` as
fractions of the pot, plus `max_aggressive_actions`) replaces the fixed
25/75/125% menu for a solve. The state machine carries it
(`betting_round.BetMenu`, `RangeSpotConfig.bet_menu`); `null` is the default and
changes nothing (the Drill and `hand_notes` still read the default constants).
A custom menu names actions by percentage (`bet_33`); `/spots/solve` and
`/spots/narrow` honor it and `/spots/solve` reports `bet_menu`. Cost is measured
in `docs/decisions.md` (`apps/api/scripts/compare_bet_menus.py`): time grows with
sizes and roughly doubles per extra raise. No UI sets it yet.

**Solve state and phone save (2026-10-21)**: Solve stays mounted once visited
(`App.tsx`'s `SolveKeepAlive`), so switching tabs no longer wipes a half-built spot; a
route-state seed (Ranges' "solve from here", Library "Open") still starts a fresh one. The
phone layout has a Save spot button like desktop's. See `docs/decisions.md`.

**Poker Drill (2026-10-19)**: all of it is on `main`. That's the first
"Swipe Drill" (PR #27), then tap-only actions, the settings cog, table
colors, the pot on the table, bb amounts, and the "why" analysis with its
tap-to-open row (PR #28), plus the iPhone build and haptics (PR #29). See
`docs/decisions.md`:
`/drill` (`apps/web/src/pages/DrillPage.tsx`) is a mobile-first practice
game, rendered full screen *outside* the app shell (`App.tsx`: `/drill` is its
own route; every other path is `Shell`) with its own purple look, an X back to
the app, a settings cog (top right), a start screen, and a summary. A hand is a
felt-table scene — a big "You BB / out of position" seat badge, chips for what's
owed, the pot in the middle of the table, the board and your hand — and you
**tap** an action: Fold/Check/Call, then every legal bet or raise size as its
own button, labelled in bb with the % pot small (or the reverse; see settings).
There is no swiping. Each answer is graded against the
solver's mixed strategy for that exact hand (`lib/drill.ts`: best at >= 40% or
the solver's top action, acceptable at 10-40%, miss below) and the full mix is
shown. The deck is **pre-solved app data, not live solves**:
`apps/api/scripts/make_drill_deck.py` solves BB vs BTN single-raised-pot flops
with `RangeCfrTrainer` and writes `apps/web/src/data/drill-deck.json` (72 spots;
rerun the script after changing the solver, ranges, or bet menu — the deck does
not update itself). It needs no API, so it works offline. Scope is flop only,
one matchup, 100bb; haptics are an opt-in setting (off by default): real
taps via `@capacitor/haptics` in the native app, the Vibration API on Android
web, nothing on iOS Safari (`lib/haptics.ts`). The web build is installable to a
phone home screen (`public/manifest.webmanifest`, apple-touch icons). The
design plan lives on the `plan-swipe-drill` branch's `docs/plan.md`; the
decision record is `docs/decisions.md`'s 2026-10-19 entry. Bet sizes are
deliberately still 25/75/125 (33/66/100 was considered, deferred to the team).
After each answer the feedback screen also has a tap-to-open (inline `<details>`,
collapsed by default) explanation of **why the solver's favorite play is good**: `apps/api/app/drill_analysis.py` (run offline by the
deck script, shipped as each spot's `analysis` in the deck JSON) classifies the
hand (top pair, flush draw, ace high...) and the board, and computes equity
against the opponent's real range, where the hand ranks in its range, how often
the whole range takes each action, and the pot-odds price when facing a bet;
rules then turn those numbers into 3-4 plain bullets (value bet, semi-bluff,
pot control, ...), and it says outright when the solver is near-indifferent. The
numbers are computed; the reasoning sentence is the standard rationale applied by
rules, not derived from the solver, and the UI says so. Tests:
`apps/api/tests/test_drill_analysis.py` (pure, no database).
The settings sheet (cog) has a "Table color" picker (Purple / Midnight / Ocean /
Emerald, `lib/drillTheme.ts`) and a "Show bet sizes as" choice (bb-first or
%-first, `lib/drillSettings.ts`), both remembered in localStorage. Table color is
drill-only and themes only the scene via CSS variables under
`.game[data-theme=...]`; verdict colors, solver-bar colors and the white card
faces are fixed on purpose. Bet amounts in bb come from `lib/drill.ts`'s
`actionAmountBb`, which mirrors `betting_round.py`'s sizing arithmetic (a raise
is shown as "raise to") — keep the two in step if the bet menu changes.

The new solver is merged (PR #21) and deployed, hardened for Render's
free tier in PR #22 (single-threaded BLAS, one solve at a time with a 503
"busy", a 100s server time budget returning `converged: false`). Measured
on Render after: wide-range river 16s, worst-case deep wide flop 90s —
both fully converged, under the phone's 150s timeout. If that's still too
slow, a host with a full CPU (e.g. Cloud Run) would be ~10x faster — see
`docs/decisions.md`'s "Hardening /spots/solve" entry. `pytest apps/api`
has been run against the local docker-compose Postgres (2026-10-20, 129
passed, including the solve route), so that's no longer an open gap.

**Desktop redesign (all six phases done, 2026-10-20)**: `docs/desktop-redesign.md`
is the agreed spec (six phases; built as one commit per phase on the
`desktop-phase-1` branch, one PR at the end), with the design as clickable
HTML in `docs/desktop-redesign/mockup/` (screenshots alongside). Read it
before touching desktop layout. Hard rule: **nothing changes visually
below 1024px wide** (phones, Capacitor builds), and the Drill isn't
touched at all; the one agreed exception is the route merge in its §3.
**Phase 1 (foundation) is done**: the new tokens in `index.css`
(`--sidebar-bg`, `--divider`, `--surface-hover`, `--surface-3`,
`--success-text`, `--warning`/`--warning-subtle`, `--card-face`/`--card-ink`/
`--card-red`, light and dark), and `src/desktop.css` — every rule in it
inside `@media (min-width: 1024px)`: `.btn-primary` / `.btn-secondary` /
`.btn-ghost` / `.btn-danger`, `.section-label`, `.tabular-nums`. On desktop
a bare `<button>` inside the shell is no longer accent-filled; give every
new button a role class (one `btn-primary` per screen at most). The role
classes are inert under 1024px. `components/SegmentedControl` carries its
own CSS for both widths (under 1024px it copies SolvePage's existing
toggle; the mockup's pill above). User-facing "Stage N MVP" copy is gone,
and the uvicorn "is `apps/api` running?" hint only shows in dev builds
(`import.meta.env.DEV`), everywhere.
**Phase 2 (shell + routes) is done**: four nav destinations from
`lib/navigation.ts` — `/solve`, `/ranges`, `/library`, `/drill` — with the
old routes redirecting (`/` → `/solve`, `/saved` → `/library`, `/type-in` →
`/ranges?mode=type`, `/import` → `/ranges?mode=paste`). This applies on
phones too, the agreed §3 exception: the phone nav shows four links.
`pages/RangesPage.tsx` is **interim**: a Pick / Type it / Hand history
switch (`?mode=`) over the unchanged Builder / Type in / Import pages,
until Phase 3 merges them. At >= 1024px, `App.tsx`'s shell swaps the top
header for `components/Sidebar` (nav with subtitles, a beginner's-guide
card with no link yet since the spec leaves its target TBD, and
`AuthStatus variant="sidebar"`: avatar + email + ghost Sign out, or a
Sign in button that opens the form) and adds a page-header bar per route.
Which layout renders is `lib/useIsDesktop.ts`, not CSS. jsdom has no
`matchMedia`, so tests see the phone shell unless they stub it
(`App.test.tsx`'s "at desktop width"). `<main>` sits at the same tree
position in both layouts, so crossing the breakpoint doesn't remount the
page. Pages without their own desktop layout yet (Solve, Library) still
render in their phone-width column (`.app-shell__main--narrow`); pages
marked `workspace` in `PAGE_HEADERS` fill the content area edge to edge.
**Phase 3 (Ranges) is done, desktop only**: `pages/RangesWorkspace.tsx` is
the merged rail-and-chart page (Pick / Type it / Hand history in the rail,
the chart, stats and save card on the right). There's no "get chart"
button: Pick and Type it fetch on every change (250ms debounce), and
"Read hand" loads a pasted hand. **Phones deliberately keep the old Builder
/ Type in / Import pages** under the mode switch, unchanged. This departs
from the spec's "delete them", because of the no-visual-change-under-1024px
rule; see `docs/decisions.md`. `pages/RangesPage.tsx` picks the layout. All
of them share `lib/useReferenceChart.ts`: fetch (only the latest request's
response is applied), the editable copy of the chart's range, `edited`, and
save. "Solve a flop from here" navigates to `/solve` with route state that
`App.tsx`'s `SolveRoute` turns into `SolvePage`'s optional `prefill` prop
(`lib/solvePrefill.ts`: both seats, one range, the stack). `RangeGrid` has
two optional props: `reset` (a toolbar button) and `showSummary`. On
desktop it gets the mockup's toolbar ("Paint with" pill, ghost Suits /
Reset / Clear), bigger cells, and weight drawn as a bottom-up fill. That
applies to Solve's grids on desktop too; phones are unchanged.
Not done in Phase 3: the save card's "Save as" name field. It needs Phase
5's `Spot.name`, and showing it before then would silently drop the name.
**Phase 4 (Solve) is done, desktop only**: all of Solve's state, derived
values and actions live in `pages/solve/useSolveSetup.ts`, called once in
`SolvePage`. The phone layout (`SolvePhone` in `SolvePage.tsx`) has the
original markup byte for byte, and phones are pixel-identical. At >= 1024px
`SolveWorkspace.tsx` renders from the same hook, so crossing the breakpoint
keeps the setup. Setup view:
- `ActionTimeline` (a restyle of StreetActions over `lib/handBuilder`)
- `BoardSlots` (five slots, `CardPicker` in a popover, "Or type it")
- a "Ready to solve" checklist
- a canvas with Ranges / Strategy tabs: one big `RangeGrid` with player
  tabs, and "Both players" cards using `components/MiniRange`

Ranges auto-load once preflop closes (`useSolveSetup`'s `autoLoadRanges`:
the preflop line, else typical ranges). Result view: a spot summary, an
accuracy card (`exploitability_pct` / `converged`, time measured
client-side), and Keep exploring (`solveText.ts`'s `exploreOptions`, only
legal moves; it appends an action and calls `solve(nextStreets)`, or opens
the next card's slot). Then `StrategyResult.tsx`: headline sentence,
stacked frequency bar, enlarged `StrategyGrid` (now with optional
controlled `selected` / `onSelect`, `showDetail`, `showLegend`), and a
selected-hand panel with advice rules and the suit view. Page header
actions are "Start over" and "Save spot". Save stores the setup, not the
result; see `docs/decisions.md` for how a saved hand is encoded.
`components/PageHeader` is shared, and a page sets `ownHeader` in
`PAGE_HEADERS` to render it with its own actions. Wording helpers (preflop
line, roles, accuracy tiers, advice) are pure functions in
`pages/solve/solveText.ts`, tested on their own. Not in Phase 4: hand
category labels and "Why?" (Phase 6).
**Phase 5 (Library + API) is done**:
- `Spot.name` (optional, max 120) is in `packages/schema`, with the TS
  regenerated. It lives in the JSONB `data` like every other `Spot` field,
  so there's no new column or migration. This departs from the spec, which
  asked for a column; see `docs/decisions.md`.
- `apps/api` has `PATCH /spots/{id}` (`{name}`) and `DELETE /spots/{id}`,
  owner-only, tested in `tests/test_spots_persistence.py`. `lib/api.ts`
  has `renameSpot` / `deleteSpot`.
- Desktop `/library` is `pages/library/LibraryWorkspace.tsx`: search, an
  All / Preflop / Postflop filter, a table, and a preview panel with Open /
  Duplicate / Rename / Delete (delete asks to confirm). Phones keep
  `SavedSpotsPage` unchanged; `pages/LibraryPage.tsx` picks the layout.
- Unnamed spots fall back to `lib/spotText.ts`'s `summarize()` (moved
  there from SavedSpotsPage).
- "Open" passes the spot as route state: preflop charts to Ranges
  (`RangesWorkspace`'s `initialSpot`, which shows the *saved* range via
  `useReferenceChart`'s `load(spot, startRange)` and keeps its name),
  setups with a board to Solve (`lib/solvePrefill.ts`'s `seedFromSpot`
  undoes `setupAsSpot`; `useSolveSetup(prefill, savedSpot)`).
- Ranges' save card now has the "Save as" name field. Solve names a save
  "{OOP} vs {IP} on {board}", or keeps an opened spot's name.

**Phase 6 (hand categories and "Why?") is done**:
- `POST /spots/solve` also returns `hand_categories` (169-type label to
  "Top pair, strong kicker") and `hand_reasons` (label to the Drill's
  rule-of-thumb bullets). They come from `apps/api/app/hand_notes.py`,
  which reuses `drill_analysis.py`'s classifier and `explain()`, so web
  and Drill share one source.
- The equity numbers come from `RangeCfrTrainer.combo_equities` (new),
  which reads the trainer's own payoff matrix, so nothing is recomputed.
  The notes take about 16ms on wide flop ranges.
- **Flop only**: `describe_hand` classifies against three board cards, so
  turn and river solves return `{}` and the panel leaves the category and
  the "Why?" out. Spots facing a raise or a jam get categories but no
  "Why?", since the price isn't known from the bet menu.
- A label's category is what most of its live combos are. The notes never
  fail a finished solve (an exception is logged and they're dropped).
- `solveSpot` normalizes both fields to `{}` for an older backend. The hand
  panel shows the category under the hand and a collapsed "Why?" with the
  honesty note ("the percentages come from the solve; the explanation is a
  rule of thumb").

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
pnpm --filter web test       # vitest
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
cd apps/api && python scripts/make_drill_deck.py             # regenerate the Poker Drill deck (~1 min)
pytest services/solver                                       # from repo root, or `pytest` from within services/solver
pytest services/solver/tests/test_range_cfr.py                # the live solver's theory + regression tests
pytest services/solver/tests/test_range_cfr_matches_reference.py  # the trainer vs its frozen pre-speed-up copy
python services/solver/benchmarks/bench_trainer.py            # timings; --reference for the old trainer
PYTHONPATH=apps/api python services/solver/benchmarks/sweep_dcfr.py   # DCFR parameter sweep
python apps/api/scripts/compare_bet_menus.py                  # what a custom bet menu costs
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
Tests that never touch the database can run without Postgres: `DATABASE_URL=
postgresql+psycopg://x:x@localhost:5432/x pytest --noconftest apps/api/tests/test_solve_route.py
apps/api/tests/test_preflop_ranges.py ...` (the engine connects lazily and `--noconftest`
skips the fixture that runs Alembic) — handy when there's no local Postgres; CI still runs
the whole suite against a real one.
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
  Nav destinations and desktop page titles live in `lib/navigation.ts`.
  Screens live in `apps/web/src/pages/`; `apps/web/src/lib/api.ts` is the
  single fetch chokepoint (never throws — callers switch on a result's
  `kind` instead of try/catch), backing the reference-strategy lookup,
  the solver routes, and `saveSpot` / `listSpots` / `renameSpot` /
  `deleteSpot` (all four send the Supabase access token as
  `Authorization: Bearer`, which `apps/api` requires). `saveSpot` / `listSpots`
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
