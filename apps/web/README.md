# apps/web

The React + TypeScript + Vite frontend. Stage 2's manual hand builder lives
here: the button/dropdown **spot builder** and the **13×13 range grid**. See
[`../../docs/plan.md`](../../docs/plan.md) for the roadmap and where this fits.

**Status:** the spot builder and range grid are wired end to end to
`apps/api`'s reference-chart lookup. The range grid's weighted-brush /
drag-paint / keyboard selection and weight shading are done, and the app
has a design-token visual pass (light + dark). Still open (tracked in
`docs/plan.md`): multi-page routing, and a mobile packaging path. The
editable range grid isn't mounted in a screen yet — SpotBuilder uses it
read-only; Stage 3 is its first editing consumer.

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
                              prefers-color-scheme, base element styling
  App.css                     shell styling
  components/
    SpotBuilder/              the spot builder form (this is Stage 2's
                              button/dropdown builder)
    RangeGrid/                the 13×13 starting-hand grid
  lib/
    api.ts                    fetch wrapper for POST /spots/reference-strategy
    positions.ts              POSITIONS (+ SIX_MAX_POSITIONS / OPENABLE_POSITIONS)
                              — runtime spellings of the schema's
                              compile-time-only string unions
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

- **Position** and **effective stack (bb)** inputs. The seat list is 6-max
  (no UTG1/LJ — full-ring, no chart), and drops BB when the situation is an
  unopened pot (BB is never first to act); switching back to "unopened"
  with BB selected snaps the seat to BTN so the form never submits a spot
  the schema rejects.
- A two-option **situation picker** — an unopened pot (opening range), or
  hero facing a single preflop raise from one seat (defending range). These
  are the only shapes Stage 2's reference charts answer; the freeform
  action-list editor was cut for this in `0226f78`. Raise size doesn't
  affect the match, so the UI doesn't ask for it.

Picking a well-formed spot with no chart yet (e.g. HJ defending, or a stack
between the ~40bb / ~100bb buckets) is a normal `no-match`, and that status
block enumerates the current coverage. The matcher is owned by
`apps/api/app/reference_charts.py` — the client does not re-implement it.

Each `ReferenceStrategyResult` `kind` renders its own status block; on `match`
the returned range is shown read-only through `RangeGrid`.

**Not here:** a board card picker (deferred to Stage 5 — nothing preflop
needs it).

## RangeGrid

`components/RangeGrid/RangeGrid.tsx` is a controlled component — it owns no
range state, only transient UI state (active brush, keyboard focus). `value`
is a `HandRange` (`hand -> weight in [0, 1]`), `onChange` gets the next one.

Editable mode (`readOnly` unset):

- **Brush weight** selector (100 / 75 / 50 / 25%) + Clear. Painting writes
  the active weight; cells carry a `--w` custom property and shade via
  `color-mix` between two theme tokens, so partial frequencies read at a
  glance in light and dark.
- **Click** toggles a cell (0 ↔ brush). **Drag** paints a swath — the
  direction locks on pointerdown (empty → fill, filled → erase) and
  `pointermove` + `elementFromPoint` tracks it across cells; the grid sets
  `touch-action: none` so a drag doesn't scroll the page.
- **Keyboard**: roving tabindex, arrows move focus, Space/Enter toggles,
  Home/End jump to the row ends.
- A weighted combo summary (`N combos · X% of hands`), shown in both modes.

Read-only mode (Stage 2's reference-chart display) renders the same shaded
grid as static cells with none of the interaction wired up.

## Styling

Feature components use BEM (`spot-builder__*`, `range-grid__*`). `index.css`
owns the design tokens — surfaces (`--surface`, `--border`), text
(`--text-strong`, `--text-muted`), a violet `--accent`, semantic
`--danger`, radii and shadows — defined for light and redefined under
`@media (prefers-color-scheme: dark)`, plus base styling for buttons,
selects, inputs and focus rings. Lean on the tokens rather than hardcoding
colours; a few older aliases (`--text-h`, `--code-bg`, `--accent-bg`) are
kept pointing at their replacements.
