# apps/web

The React + TypeScript + Vite frontend. Stage 2's manual hand builder lives
here: the button/dropdown **spot builder** and the **13×13 range grid**. See
[`../../docs/plan.md`](../../docs/plan.md) for the roadmap and where this fits.

**Status:** the spot builder and range grid are wired end to end to
`apps/api`'s reference-chart lookup. Still open (tracked in `docs/plan.md`):
the range grid's weighted / drag / keyboard selection, and the shared visual
pass — this package is functional-baseline styling only for now.

## Commands

Run from the repo root (this is a pnpm workspace):

```
pnpm install                 # installs all JS workspace deps
pnpm dev:web                 # Vite dev server -> http://localhost:5173
pnpm --filter web build      # production build (tsc -b && vite build)
pnpm --filter web lint       # oxlint
```

## Layout

```
src/
  main.tsx                    entry — mounts <App> in StrictMode
  App.tsx                     app shell: header + <SpotBuilder />
  index.css                   design tokens (--*), light/dark via
                              prefers-color-scheme, #root sizing
  App.css                     shell styling
  components/
    SpotBuilder/              the spot builder form (this is Stage 2's
                              button/dropdown builder)
    RangeGrid/                the 13×13 starting-hand grid
  lib/
    api.ts                    fetch wrapper for POST /spots/reference-strategy
    positions.ts              POSITIONS + ACTION_TYPES — the runtime spellings
                              of the schema's compile-time-only string unions
    hands.ts                  the 169 hand labels in chart order (RangeGrid)
```

## Types come from `packages/schema`

`@poker-solver/schema` (a `workspace:*` dependency) is the **only** source of
the `Spot`, `BettingAction`, `Position`, `Street`, `ActionType`, `HandRange`
types. Those exports are **types only** — a string-literal union like
`Position` has no runtime value, so anywhere the UI needs the actual list
(dropdown `<option>`s, defaults) it's spelled out once in `lib/positions.ts`
and nowhere else. Don't hand-write a parallel type; regenerate the package
(`packages/schema` → `pnpm generate`) if the shape needs to change.

## Talking to the API

`lib/api.ts` exposes `fetchReferenceStrategy(spot: Spot)`. It **never throws** —
every outcome of `POST /spots/reference-strategy` comes back as a tagged
`ReferenceStrategyResult`:

| `kind`          | when                                             |
|-----------------|--------------------------------------------------|
| `match`         | 2xx — `.data` is a `ReferenceStrategyResponse`   |
| `no-match`      | 404 — no reference chart covers this spot yet    |
| `invalid`       | 422 — `.issues` are the FastAPI validation errors|
| `network-error` | `fetch()` itself rejected (API down / CORS / offline) |
| `error`         | any other non-2xx — `.status` is the code        |

`ReferenceStrategyResponse` mirrors the API's response dict (see
`apps/api/app/routes/spots.py`) and is the one shared seam — coordinate with
whoever owns `apps/api` before changing its shape.

Base URL: `VITE_API_BASE_URL`, defaulting to `http://localhost:8000` (the
local `apps/api` port), so no env setup is needed for the default local
workflow. Override it (e.g. `VITE_API_BASE_URL=http://localhost:9 pnpm dev:web`
to force `network-error`) via the shell or a `.env` / `.env.local` file that
Vite picks up.

## SpotBuilder

`components/SpotBuilder/SpotBuilder.tsx` assembles a `Spot` client-side from:

- **Position** and **effective stack (bb)** inputs.
- An ordered **action-sequence editor** — add / remove / reorder rows, each a
  `{ position, action, size_bb? }` `BettingAction` (street is fixed to
  `"preflop"` for Stage 2 and rendered as static text). The editor is
  deliberately general; only a few spot shapes resolve to a reference chart
  today (unopened opens from UTG/CO/BTN/SB; BB/BTN/SB defending a single
  BTN or CO raise; ~40bb or ~100bb; preflop). Anything else is a normal
  `no-match`, and that block enumerates the current coverage. The matcher is
  owned by `apps/api/app/reference_charts.py` — the client does not
  re-implement it.

Each `ReferenceStrategyResult` `kind` renders its own status block; on `match`
the returned range is shown read-only through `RangeGrid`.

**Not here:** a board card picker (deferred to Stage 5 — nothing preflop needs
it), and the real visual pass (a separate shared ticket).

## Styling

Feature components use BEM (`spot-builder__*`, `range-grid__*`). `index.css`
defines the color/spacing tokens (`--border`, `--text-h`, `--accent-border`,
`--mono`, …) and flips them under `@media (prefers-color-scheme: dark)`; lean
on those tokens rather than hardcoding colors. Polish beyond "usable" is the
visual-pass ticket's job.
