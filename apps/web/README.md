# apps/web

The React + TypeScript + Vite frontend. Stage 2's manual hand builder lives
here: the button/dropdown **spot builder** and the **13×13 range grid**. See
[`../../docs/plan.md`](../../docs/plan.md) for the roadmap and where this fits.

**Status:** routed into three screens — Builder, Saved, Type in
(`react-router-dom`, `BrowserRouter` in `App.tsx`; see
`docs/decisions.md`). The spot builder and range grid are wired end to
end to `apps/api`'s reference-chart lookup; the range grid's
weighted-brush / drag-paint / keyboard selection and weight shading are
done, and the app has a design-token visual pass (light + dark). Stage 3
has a small, rule-based start (`lib/parseSpotText.ts`, two phrasings
only) on the Type-in screen. Saved spots (the Saved screen, and the "Save
this spot" button on Builder/Type-in) is wired to `apps/api`'s
`POST`/`GET /spots`. The editable range grid still isn't mounted
anywhere — both screens that show a matched chart render `RangeGrid`
read-only.

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
  App.tsx                     router shell: header + nav + <Routes> (BrowserRouter
                              lives here, not main.tsx — see docs/decisions.md)
  index.css                   design tokens (--*), light/dark via
                              prefers-color-scheme, base element styling
  App.css                     shell + nav styling
  pages/
    BuilderPage.tsx            "/" — wraps SpotBuilder (Stage 2's button/dropdown builder)
    TypeInPage.tsx              "/type-in" — Stage 3's plain-language entry
    SavedSpotsPage.tsx          "/saved" — lists spots saved via apps/api
  components/
    SpotBuilder/              the spot builder form, reused by BuilderPage
    RangeGrid/                the 13×13 starting-hand grid
  lib/
    api.ts                    fetch wrapper: fetchReferenceStrategy, saveSpot, listSpots
    spot.ts                   buildOpenSpot/buildVsRaiseSpot — the shared Spot-assembly
                              helpers every entry path converges on
    parseSpotText.ts           Stage 3's rule-based parser (two phrasings only)
    positions.ts               POSITIONS (+ SIX_MAX_POSITIONS / OPENABLE_POSITIONS)
                              — runtime spellings of the schema's
                              compile-time-only string unions
    hands.ts                   the 169 hand labels in chart order (RangeGrid)
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

`lib/api.ts` is the single fetch chokepoint, built on `CapacitorHttp` (not
`fetch` — see the Android section below) with three functions, none of
which ever throw: every outcome comes back as a tagged result and callers
switch on `.kind` instead of try/catch.

| Function | Backs | `kind`s |
|---|---|---|
| `fetchReferenceStrategy(spot)` | `POST /spots/reference-strategy` | `match` (2xx, `.data` is a `ReferenceStrategyResponse`) / `no-match` (404) / `invalid` (422, `.issues`) / `network-error` / `error` (`.status`) |
| `saveSpot(spot)` | `POST /spots` | `saved` (2xx, `.spot` echoes the server-assigned `id`/`created_at`) / `invalid` / `network-error` / `error` |
| `listSpots()` | `GET /spots` | `ok` (`.spots: Spot[]`) / `network-error` / `error` |

`ReferenceStrategyResponse` mirrors `apps/api/app/routes/spots.py`'s response
dict and is the one shared seam — coordinate with whoever owns `apps/api`
before changing its shape. `saveSpot`/`listSpots` were built against an
*assumed* contract ahead of the backend lane shipping those routes; now
confirmed to match exactly (see `docs/decisions.md`) — no changes needed.

Base URL: `VITE_API_BASE_URL`, defaulting to `http://localhost:8000` (the
local `apps/api` port) in dev, and to the deployed Render URL for
production builds (`apps/web/.env.production` — loaded automatically by
`vite build`, which is also what the Android build's `cap sync` runs
against). Override it (e.g. `VITE_API_BASE_URL=http://localhost:9 pnpm dev:web`
to force `network-error`) via the shell or a `.env.local` file that Vite
picks up.

## Android (Capacitor)

`apps/web/android/` is a committed native Android project (`npx cap add
android`), kept in sync with `apps/web/src` via `pnpm --filter web build &&
npx cap sync android` — that's the loop after any source change, before a
Gradle rebuild. `capacitor.config.ts` sets the app id/name and `webDir`.
Source icon/splash assets live in `apps/web/assets/`; regenerate the native
resources with `npx capacitor-assets generate --android` after changing
them, don't hand-edit the generated `android/app/src/main/res/mipmap-*` /
`drawable-*` files. `lib/api.ts` uses `CapacitorHttp` specifically so
requests route through native networking on-device, sidestepping the
WebView's CORS enforcement rather than needing `apps/api`'s CORS allowlist
to cover the Capacitor origin.

## SpotBuilder

`components/SpotBuilder/SpotBuilder.tsx` (mounted by `pages/BuilderPage.tsx`)
assembles a `Spot` client-side via `lib/spot.ts`'s `buildOpenSpot`/
`buildVsRaiseSpot` — shared with `pages/TypeInPage.tsx`'s parser so both
entry paths converge on the same `Spot` construction rather than each
inlining their own. On a match, a "Save this spot" button calls
`saveSpot()` and shows an inline saved/error status; `pages/TypeInPage.tsx`
has the identical affordance. Fields:

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
`--danger`/`--success` (the latter aliased to the range grid's "in range"
green, not a new hex, so a save-succeeded state and a full-weight cell
read as the same "good" color), radii and shadows — defined for light and
redefined under
`@media (prefers-color-scheme: dark)`, plus base styling for buttons,
selects, inputs and focus rings. Lean on the tokens rather than hardcoding
colours; a few older aliases (`--text-h`, `--code-bg`, `--accent-bg`) are
kept pointing at their replacements.
