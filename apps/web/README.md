# apps/web

The React + TypeScript + Vite frontend. Stage 2's manual hand builder lives
here: the button/dropdown **spot builder** and the **13×13 range grid**. See
[`../../docs/plan.md`](../../docs/plan.md) for the roadmap and where this fits.

**Status:** routed into five screens — Builder, Saved, Type in, Import,
Solve (`react-router-dom`, `BrowserRouter` in `App.tsx`; see
`docs/decisions.md`). The spot builder and range grid are wired end to
end to `apps/api`'s reference-chart lookup; the range grid's
weighted-brush / drag-paint / keyboard selection and weight shading are
done, and the app has a design-token visual pass (light + dark). Two
more entry paths converge on the same `lib/spot.ts` shapes: Stage 3's
rule-based text parser (`lib/parseSpotText.ts`) and Stage 4's hand-history
paste import (`lib/parseHandHistory.ts`, one format). The range grid is
mounted **editable** everywhere a matched chart is shown (Builder,
Type-in, Import) — adjust weights before "Save this spot" persists them,
not a read-only display. Saved spots (the Saved screen, and the save
button on the three entry screens) is wired to `apps/api`'s
`POST`/`GET /spots`. Stage 6 auth (see `## Auth` below) works for saved
spots: Supabase sign-in, session state, a "sign in to save spots" gate
on all three save buttons, and `apps/api` verifying the token and
returning only the signed-in user's own spots. **Solve** (`pages/
SolvePage.tsx`) is Stage 5's new screen: a real MCCFR solve via `apps/api`'s
`POST /spots/solve` — both players' ranges, a board (click cards via
`components/CardPicker/CardPicker.tsx`, or type them via `lib/cards.ts` —
see `docs/decisions.md`), and a per-action-frequency result table, not a
single-weight range.

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
    ImportPage.tsx               "/import" — Stage 4's hand-history paste entry
    SolvePage.tsx                "/solve" — Stage 5's live MCCFR solve
    SavedSpotsPage.tsx          "/saved" — lists spots saved via apps/api
  components/
    SpotBuilder/              the spot builder form, reused by BuilderPage
    RangeGrid/                the 13×13 starting-hand grid
    CardPicker/               click-to-toggle board-card grid (SolvePage)
  lib/
    api.ts                    fetch wrapper: fetchReferenceStrategy, saveSpot,
                              listSpots, solveSpot
    spot.ts                   buildOpenSpot/buildVsRaiseSpot — the shared Spot-assembly
                              helpers every entry path converges on
    parseSpotText.ts           Stage 3's rule-based parser (two phrasings, plus synonyms)
    parseHandHistory.ts        Stage 4's rule-based hand-history parser (one format)
    cards.ts                   parseBoardText / boardFromCards — Stage 5's board
                              validation (SolvePage), typed or picked
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
`fetch` — see the Android section below) with four functions, none of
which ever throw: every outcome comes back as a tagged result and callers
switch on `.kind` instead of try/catch.

| Function | Backs | `kind`s |
|---|---|---|
| `fetchReferenceStrategy(spot)` | `POST /spots/reference-strategy` | `match` (2xx, `.data` is a `ReferenceStrategyResponse`) / `no-match` (404) / `invalid` (422, `.issues`) / `network-error` / `error` (`.status`) |
| `saveSpot(spot)` | `POST /spots` | `saved` (2xx, `.spot` echoes the server-assigned `id`/`created_at`/`created_by`) / `invalid` / `network-error` / `error` (401 when not signed in) |
| `listSpots()` | `GET /spots` | `ok` (`.spots: Spot[]`, the caller's own only) / `network-error` / `error` (401 when not signed in) |
| `solveSpot(spot)` | `POST /spots/solve` | `solved` (2xx, `.data` is a `LiveSolveResponse`) / `invalid` (422 with an array `detail` — schema-level) / `rejected` (422 with a string `detail` — `apps/api/app/solve.py`'s own `InvalidSolveRequest`) / `network-error` / `error` |

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

## Auth

`lib/supabase.ts` creates a Supabase client from `VITE_SUPABASE_URL`/
`VITE_SUPABASE_ANON_KEY` (see `apps/web/.env.example` — real values come
from the team's Supabase project, copied into a git-ignored
`.env.local`, never committed). `lib/auth.tsx`'s `AuthProvider`/
`useAuth()` track session state (`loading` / `signed-out` / `signed-in`),
mounted in `App.tsx` around `BrowserRouter`; `getAccessToken()` is a
plain async export `lib/api.ts` calls directly, since that module isn't
a component and can't use the hook. `components/AuthStatus/AuthStatus.tsx`
is the header's email/password sign-in (and sign-up, same form, toggled)
plus "Signed in as X / Sign out" UI — no magic link, to avoid a redirect
URL in the Supabase dashboard and native deep-link handling this
Capacitor app doesn't have.

`saveSpot`/`listSpots` (`lib/api.ts`) attach
`Authorization: Bearer <token>` when a session exists, omitted (not
blocked client-side) otherwise. `apps/api` verifies it and returns 401
without it (`docs/decisions.md`'s 2026-09-30 and 2026-10-06 entries).
Separately,
the save button on all three entry screens (Builder, Type in, Import)
shows "Sign in to save spots" and skips the API call entirely when
signed out, via each page's own `useAuth()` check. `SavedSpotsPage`
shows only a signed-out notice when signed out (it doesn't call `GET
/spots`, which requires sign-in), and fetches the signed-in user's own
spots — refetching when the account changes.

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

**Not here:** a board card picker. `pages/SolvePage.tsx` (Stage 5) is the
screen that needed one — see `## SolvePage` below for the
`CardPicker`/typed-text pair it ended up with.

## SolvePage

`pages/SolvePage.tsx` is Stage 5's screen: a real MCCFR solve
(`apps/api`'s `POST /spots/solve`) instead of a static reference chart.
It's the first screen needing *two* ranges and a board, so it departs
from the other entry paths in a few ways:

- **Two positions, two `RangeGrid`s.** `apps/web/src/lib/spot.ts`'s
  helpers only ever fill in hero's position/range; this screen defines
  its own convention instead (matching `apps/api/app/solve.py`'s
  contract): the first position picker is out-of-position/first-to-act
  this street, the second is in position, and each gets its own
  editable `RangeGrid` — submit is disabled until both have at least
  one hand selected.
- **A board, two input modes.** A radio toggle switches between
  `components/CardPicker/CardPicker.tsx` (click up to 5 cards on a
  4-suit × 13-rank grid — the default) and `lib/cards.ts`'s
  `parseBoardText` (type space-separated cards, `"Ks Qh 9d"`, for
  pasting/power users). Both converge on the same `ParseBoardResult`
  (`parseBoardText`/`boardFromCards`), so everything past that point —
  `canSubmit`, the street shown, the submitted `Spot` — has one code
  path regardless of which mode filled it in; 3/4/5 cards selects
  flop/turn/river automatically, there's no separate street picker.
  Switching modes doesn't clear the other mode's input. See
  `docs/decisions.md`'s 2026-10-06 entries for why the text field
  shipped first and the picker came as an addition, not a replacement.
- **An "already checked" toggle**, not a full action-history editor —
  maps directly onto `solve.py`'s "empty or exactly one seeded check"
  contract. Anything past that (mid-street betting already recorded)
  isn't solvable yet, so there's no UI for it.
- **Results are a table, not a chart.** Each hand in the deciding
  player's range is a row; each legal action at that decision is a
  column. Unlike every `ReferenceStrategyResult`/`HandRange` elsewhere in
  the app (one weight per hand), this is a genuine distribution over
  multiple actions per hand — `LiveSolveResponse.strategy` in `lib/api.ts`.
- **A solve takes a few seconds** (it's running thousands of real MCCFR
  iterations server-side, not a lookup) — the loading state says so
  explicitly rather than looking stuck.

Reuses `SpotBuilder.css`'s `spot-builder__*` classes for every generic
piece (fields, status blocks, buttons), same as `TypeInPage`/`ImportPage`;
`SolvePage.css` only adds the results-table styling, which nothing else
needed before this.

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

The grid always fills its container width exactly (`width: 100%`, no
`min-width`) rather than scrolling horizontally on a phone — a scroll
wrapper was tried first, but a touch drag meant to scroll also fired the
paint handlers underneath it, toggling cells along the way. Shrinking is
the tradeoff: cells get smaller on a narrow phone than the ~32px usually
recommended for touch targets, but the whole chart stays visible and
nothing fights the drag-to-paint gesture. Cell label font-size is a
`clamp()` so it scales down with the cells instead of overflowing.

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
