# apps/web

The React + TypeScript + Vite frontend. Stage 2's manual hand builder lives
here: the button/dropdown **spot builder** and the **13×13 range grid**. See
[`../../docs/plan.md`](../../docs/plan.md) for the roadmap and where this fits.

**Status:** routed into four destinations — Solve, Ranges, Library, Drill
(`react-router-dom`, `BrowserRouter` in `App.tsx`; nav items in
`lib/navigation.ts`). The old routes redirect: `/` → `/solve`,
`/saved` → `/library`, `/type-in` and `/import` →
`/ranges?mode=type|paste`. See `## Desktop layout` below for what changes
at 1024px and wider. The spot builder and range grid are wired end to
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
see `docs/decisions.md`), and results as a color-coded strategy chart
(`components/StrategyGrid/StrategyGrid.tsx`), not a single-weight range.
Reaching a decision point now has two modes: a real click-through hand
builder (`lib/handBuilder.ts`, `components/StreetActions/
StreetActions.tsx` — the default) or pasting a hand history
(`lib/parseHandHistory.ts`) — see the `## SolvePage` section below for
both, and `docs/decisions.md`'s 2026-10-07 entries for the design.

## Desktop layout

At **1024px and wider** the app has its own layout, built from the agreed
spec and mockup in `docs/desktop-redesign.md`. **Under 1024px nothing
changes visually**, which covers phones and the Capacitor builds. Phones
keep the original screens: the Builder / Type in / Import pages under a
mode switch on Ranges, the stacked Solve steps, and the Saved list.

- **Which layout renders** is `lib/useIsDesktop.ts` (a `min-width: 1024px`
  media query). jsdom has no `matchMedia`, so tests see the phone layout
  unless they stub it, as the desktop test files do.
- **Shell:** `components/Sidebar` on the left with nav, a guide card, and
  `AuthStatus variant="sidebar"`; `components/PageHeader` across the top
  of each page.
- **Ranges:** `pages/RangesWorkspace.tsx`, a rail plus the chart. The chart
  loads as the spot changes, with no submit button.
- **Solve:** `pages/solve/SolveWorkspace.tsx`, setup and result views.
  `pages/solve/useSolveSetup.ts` holds all of Solve's state, shared with
  the phone layout, so resizing keeps a half-built hand.
- **Library:** `pages/library/LibraryWorkspace.tsx`, a table plus a
  preview, with open / rename / duplicate / delete.
- **Shared fetch-and-save:** `lib/useReferenceChart.ts` is the logic every
  chart page uses, on both layouts.
- **Styling:** every desktop-only rule sits inside
  `@media (min-width: 1024px)`. `src/desktop.css` holds the button roles
  (`.btn-primary` / `-secondary` / `-ghost` / `-danger`, one primary per
  screen). Give every new button a role class: on desktop a bare
  `<button>` in the shell is no longer accent-filled.

## Commands

Run from the repo root (this is a pnpm workspace):

```
pnpm install                 # installs all JS workspace deps
pnpm dev:web                 # Vite dev server -> http://localhost:5173
pnpm --filter web build      # production build (tsc -b && vite build)
pnpm --filter web lint       # oxlint
pnpm --filter web test       # vitest
```

## Layout

```
src/
  main.tsx                    entry — mounts <App> in StrictMode
  App.tsx                     router shell: phone header or desktop sidebar + <Routes>,
                              old-route redirects (BrowserRouter lives here, not
                              main.tsx — see docs/decisions.md)
  index.css                   design tokens (--*), light/dark via
                              prefers-color-scheme, base element styling
  desktop.css                 desktop-only (>= 1024px) button roles, section labels
  App.css                     shell + nav styling (phone header; desktop shell + page header)
  pages/
    SolvePage.tsx              "/solve" — calls useSolveSetup once; phone markup
                              (SolvePhone) or SolveWorkspace on desktop
    solve/                    desktop Solve: SolveWorkspace, ActionTimeline, BoardSlots,
                              StrategyResult, solveText.ts (wording), useSolveSetup.ts
    RangesPage.tsx             "/ranges" — RangesWorkspace on desktop; on phones the
                              three pages below under a Pick / Type it / Hand history switch
    RangesWorkspace.tsx        desktop Ranges: rail + chart, auto-loading
    BuilderPage.tsx            phone Ranges "Pick" — wraps SpotBuilder
    TypeInPage.tsx             phone Ranges "Type it" — Stage 3's plain-language entry
    ImportPage.tsx             phone Ranges "Hand history" — Stage 4's paste entry
    LibraryPage.tsx            "/library" — LibraryWorkspace on desktop, SavedSpotsPage on phones
    library/                  desktop Library: table, preview, open/rename/duplicate/delete
    SavedSpotsPage.tsx         phone Library — the original saved-spots list
    DrillPage.tsx              "/drill" — the Poker Drill; full screen, rendered
                              outside the shell (see ## Poker Drill)
  components/
    Sidebar/                  desktop nav sidebar (nav, guide card, account row)
    PageHeader/               desktop page title bar with page actions
    SegmentedControl/         one row of mutually exclusive choices (its own CSS, both widths)
    MiniRange/                a label-less 13×13 range thumbnail
    SpotBuilder/              the spot builder form, reused by BuilderPage
    RangeGrid/                the 13×13 starting-hand grid
    CardPicker/               click-to-toggle board-card grid (SolvePage)
    StrategyGrid/             13×13 color-coded solve-result chart (SolvePage)
    StreetActions/            one street's action log + "add an action"
                              controls (SolvePage's click-through builder)
    PlayingCard/              a face-up card ("Ah"); the drill forces white faces
    ErrorBoundary/            wraps every route (App.tsx): a render crash shows a
                              recoverable message, not a blank screen
  lib/
    api.ts                    fetch wrapper: fetchReferenceStrategy, saveSpot,
                              listSpots, renameSpot, deleteSpot, solveSpot, ...
    useIsDesktop.ts           the 1024px breakpoint, for layout switches CSS can't do
    navigation.ts             the four nav destinations + desktop page titles
    useReferenceChart.ts      fetch a chart, edit its range, save it (every chart page)
    solvePrefill.ts           route state into Solve: Ranges' "solve from here", or a
                              Library spot (seedFromSpot rebuilds a saved setup)
    spotText.ts               a saved spot in words (summarize, displayName, board text)
    spot.ts                   buildOpenSpot/buildVsRaiseSpot — the shared Spot-assembly
                              helpers every entry path converges on
    parseSpotText.ts           Stage 3's rule-based parser (two phrasings, plus synonyms)
    parseHandHistory.ts        Stage 4's rule-based hand-history parser (one format),
                              plus parseHandHistoryToPostflopSetup (SolvePage's
                              "from a hand history" setup mode)
    handBuilder.ts             SolvePage's click-through setup mode: walks
                              preflop -> flop -> turn -> river from real
                              actions, deriving pot_bb/effective_stack_bb
                              instead of them being typed in
    cards.ts                   parseBoardText / boardFromCards — Stage 5's board
                              validation (SolvePage), typed or picked
    drill.ts                   Poker Drill logic, no React: deck types, gradeAction,
                              legal-action split, bb/% amounts (mirrors the
                              solver's bet sizing), labels, shuffle
    drillSettings.ts           the drill's remembered bet-size display (bb or %)
    drillTheme.ts              the drill's table-color choices + remembered pick
    haptics.ts                 opt-in haptics on the drill's verdict (native taps / Vibration API)
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
| `renameSpot(id, name)` | `PATCH /spots/{id}` | `renamed` (`.spot`) / `not-found` (404: gone, or not the caller's) / `invalid` (422, e.g. an empty name) / `network-error` / `error` |
| `deleteSpot(id)` | `DELETE /spots/{id}` | `deleted` (204) / `not-found` / `network-error` / `error` |
| `solveSpot(spot)` | `POST /spots/solve` | `solved` (2xx, `.data` is a `LiveSolveResponse`; its newer optional fields — `combo_strategy`, `hand_categories`, `hand_reasons`, `bucketed_actions` — are normalized to empty for an older backend) / `invalid` (422 with an array `detail` — schema-level) / `rejected` (422 with a string `detail` — `apps/api/app/solve.py`'s own `InvalidSolveRequest`) / `network-error` / `error` |

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
is the phone header's email/password sign-in (and sign-up, same form,
toggled) plus "Signed in as X / Sign out" UI. On desktop the same component
renders in the sidebar (`variant="sidebar"`): an initial avatar, the email
and a ghost Sign out, or a "Sign in" button that opens the form. There's no
magic link, to avoid a redirect URL in the Supabase dashboard and native
deep-link handling this Capacitor app doesn't have.

`saveSpot`/`listSpots` (`lib/api.ts`) attach
`Authorization: Bearer <token>` when a session exists, omitted (not
blocked client-side) otherwise. `apps/api` verifies it and returns 401
without it (`docs/decisions.md`'s 2026-09-30 and 2026-10-06 entries).
Separately,
every save button (the three phone entry screens, desktop Ranges' "Save to
Library", desktop Solve's "Save spot") shows a sign-in prompt and skips the
API call entirely when signed out (`lib/useReferenceChart.ts` and
`SolveWorkspace` check `useAuth()`). `SavedSpotsPage` and the desktop Library
show only a signed-out notice when signed out (neither calls `GET /spots`,
which requires sign-in), and fetch the signed-in user's own spots,
refetching when the account changes.

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

## iOS (Capacitor)

`apps/web/ios/` is the committed Xcode project (`npx cap add ios`, Swift
Package Manager — no CocoaPods). It can be generated and synced on any OS,
but building and signing needs a Mac with Xcode. On the Mac, from the repo
root:

```
pnpm install
pnpm --filter web build                # production build -> talks to the deployed API
cd apps/web && npx cap sync ios && npx cap open ios
```

In Xcode: select the **App** target → **Signing & Capabilities** → pick a
Team (a free personal Apple ID works), plug in the iPhone, choose it as
the run destination, and press Run. With a free Apple ID the install
expires after 7 days (reinstall from Xcode), and the phone must allow it
under Settings → General → VPN & Device Management, plus Developer Mode
(Settings → Privacy & Security). If Xcode can't register the bundle id
`com.pokersolver.app`, change it to something unique in Signing &
Capabilities. TestFlight/App Store distribution needs the paid Apple
Developer Program. Icons/splash come from `apps/web/assets/` via
`npx capacitor-assets generate --ios`.

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
This section describes the **phone layout**, whose behavior is unchanged.
Its state now lives in `pages/solve/useSolveSetup.ts`. The desktop layout
(`pages/solve/SolveWorkspace.tsx`, see `## Desktop layout`) uses the same
state with a different presentation: an action timeline, board slots, a
"Ready to solve" checklist, Ranges / Strategy tabs, auto-loaded ranges,
Keep exploring, and per-hand categories with a "Why?" on flop solves.
It's the first screen needing *two* ranges and a board, so it departs
from the other entry paths in a few ways:

- **Two ways to reach a decision point**, picked via a radio toggle:
  - **Click through the hand (the default).** `lib/handBuilder.ts`
    walks preflop -> flop -> turn -> river as real actions with real bb
    sizes (not the solver's fixed menu — that's a backend-only
    abstraction `solve.py` buckets a size onto at solve time, disclosed
    via the response's `bucketed_actions`, not duplicated here) —
    `components/StreetActions/StreetActions.tsx` renders one street's
    action log plus fold/check/call/bet-or-raise/all-in controls for
    whoever's turn it is. Blinds are assumed at 1bb/0.5bb, heads-up
    style between exactly the two chosen positions (OOP posts 1bb, acts
    last preflop/first postflop; IP posts 0.5bb, acts first
    preflop/last postflop) — a deliberate simplification, not a real
    6-max preflop order for an arbitrary 2-of-6 position pair. Preflop
    supports repeated raises (3-bet, 4-bet, ...), not just one
    raise/one call. An earlier street has to close (not fold) before
    the next one unlocks; `pot_bb`/`effective_stack_bb` entering
    whichever street the board's card count reaches are computed from
    this, never typed in. A fold on any street ends the hand outright
    — no later section renders, and "Solve" stays disabled. See
    `docs/decisions.md`'s 2026-10-07 entry for the full design,
    including the one real poker rule preserved (the small blind's
    completing call doesn't close preflop action).
  - **From a hand history** (`lib/parseHandHistory.ts`'s
    `parseHandHistoryToPostflopSetup`) — the original, unchanged
    shortcut: fast-forwards positions/board/pot/stack straight to
    whatever postflop decision point a pasted hand reaches, reading
    what already happened rather than re-solving every earlier street
    (see `docs/decisions.md`'s entry on why that's cheap and stays out
    of real multi-street solving's scope). Shares header/seat parsing
    with the original Stage 4 `parseHandHistory` (unchanged, still
    backs `ImportPage`) but does a different job. Kept as a genuinely
    separate mode rather than merged into the click-through builder's
    state — a pasted hand history already tells you pot/stack/board
    directly.

  Neither mode touches either range: a hand history doesn't reveal
  villain's actual cards, and the click-through builder's job is pot/
  stack bookkeeping, not range reconstruction — both still come from
  the reference-range buttons below or manual painting.
- **Two positions, two `RangeGrid`s.** `apps/web/src/lib/spot.ts`'s
  helpers only ever fill in hero's position/range; this screen defines
  its own convention instead (matching `apps/api/app/solve.py`'s
  contract): the first position picker is out-of-position/first-to-act
  this street, the second is in position, and each gets its own
  editable `RangeGrid` — submit is disabled until both have at least
  one hand selected. A "Load \<position\>'s opening range" button next to
  each grid calls `fetchReferenceStrategy`/`buildOpenSpot` (the same
  Stage 2 chart data) to seed a real starting range instead of an empty
  grid — an approximate preflop-opening starting point to tweak, not an
  accurate postflop range; positions with no opening chart (BB, UTG1,
  LJ) say so plainly rather than doing nothing.
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
- **The "from a hand history" mode keeps its original "already
  checked" toggle**, not a full action-history editor — it only ever
  seeds a single check, even though `solve.py`'s contract no longer
  requires that (generalized to accept any non-terminal action prefix,
  with any bet/raise bucketed onto the bet-size menu — now **Bet Small
  25% / Bet Medium 75% / Bet Large 125% / All-in**, was 33%/66%/100% —
  see `docs/decisions.md`'s 2026-10-07 entry). The click-through mode
  doesn't have this limitation: it submits whatever real action
  sequence was actually built on the target street.
- **Results are a 13×13 chart** (`components/StrategyGrid/StrategyGrid.tsx`),
  not a table — each cell is a left-to-right gradient of that hand's
  action mix (fold cool-colored, check/call gold, bet sizes a deepening
  red ramp, all-in darkest), tap a cell for its exact breakdown below the
  grid. Reuses `RangeGrid.css`'s grid/cell classes directly (same
  shrink-to-fit-on-mobile sizing) with the fill set per-cell via an inline
  gradient instead of the weight-based `color-mix`. Unlike every
  `ReferenceStrategyResult`/`HandRange` elsewhere in the app (one weight
  per hand), this is a genuine distribution over multiple actions per
  hand — `LiveSolveResponse.strategy` in `lib/api.ts`. A hand missing from
  the response (not in range, or never sampled enough to report) renders
  as a flat neutral cell, not a color — see the caveat on per-hand
  precision below.
- **A solve takes a few seconds, more for a wide-range flop** — it trains
  server-side until the result is within 0.5% of the pot of a true
  equilibrium, not a lookup. The loading state says so explicitly rather
  than looking stuck, and the result shows the precision actually
  reached (`LiveSolveResponse.exploitability_pct`, optional on the client
  because an older deployed backend doesn't send it).

**Precision, now measured rather than caveated:** until 2026-10-07 the
solver Monte-Carlo-sampled hole cards and a wide range's per-hand numbers
were often noise (this section used to warn about exactly that). The
range-vs-range solver that replaced it trains every combo on every
iteration, so no hand is thinly sampled, and the precision line under the
chart is a real global bound — see `docs/decisions.md`'s top entry.

**Resilience to a backend that's behind:** Render deploys separately from
this build, so `lib/api.ts`'s `solveSpot` normalizes newer response
fields (e.g. `bucketed_actions` defaults to `[]`), and
`components/ErrorBoundary` wraps every route in `App.tsx` — an unexpected
response shape shows "Something went wrong / Try again" instead of the
blank screen a missing field once caused on a real phone.

Reuses `SpotBuilder.css`'s `spot-builder__*` classes for every generic
piece (fields, status blocks, buttons), same as `TypeInPage`/`ImportPage`.

## Poker Drill

`pages/DrillPage.tsx` at `/drill`. A practice game, not a page of the app:
`App.tsx` routes `/drill` to it directly, outside `Shell`, so there's no
header or nav — an X (top-left) back to `/` and a settings cog (top-right). It
has three phases: a start screen (best score kept in `localStorage` under
`drill.bestScore`), 15 hands, then a summary of the hands missed.

**A hand** is a purple felt table: a "You BB / Out of position vs BTN" seat
badge above it, chips for what's owed ("BTN bets 1.4bb" in red, or "BB checked
to you") and depth, and on the table the **pot, large, in the middle** (plus the
bet being faced under it), the board, and your hand. You tap an action — Fold /
Check / Call, then each legal bet or raise size as its own button at the bottom
(thumb reach), the amount in bb with the % of pot small, or the reverse (a
setting). A raise is shown as "raise to". There is no swiping: it was built and
dropped (see `docs/decisions.md`). After each answer: a verdict (best /
acceptable / miss), then the solver's full action mix for that hand, your pick
bold and the solver's favorite starred.

**The "why"** (feedback screen, below the mix, **collapsed behind a tap**: a native `<details>` row "Why Bet 4.1bb (75%)?" that drops open in place and starts closed again every hand): `spot.analysis` from the deck —
two figures (equity against the opponent's range, share of the player's range
beaten) and a few bullets about the hand, the board/range or pot-odds price, and
the reason for the solver's favorite play, plus a caveat when the mix is close.
It is generated by `apps/api/app/drill_analysis.py` when the deck is built (not
at runtime), so a deck made before analyses existed simply shows no "Why"
section. The bullets use no bet sizes, so they read the same in bb or % mode;
only the heading ("Why Raise to 7.6bb (75%)?") follows the display setting.

**Settings** (the cog; a bottom sheet, available on every screen of the game):
table color (`lib/drillTheme.ts`, `drill.theme`) and bet-size display
(`lib/drillSettings.ts`, `drill.betDisplay`), both remembered on the device.

**Grading** (`lib/drill.ts`): an action is "best" if the solver plays it at
least 40% of the time *or* it's the solver's top action (so a flat mix doesn't
mark everything wrong), "acceptable" (half credit) at 10-40%, a miss below.

**bb amounts** come from `actionAmountBb` in `lib/drill.ts`, which mirrors
`services/solver`'s `betting_round.py`: a bet is a fraction of the pot, a raise
is the call plus a fraction of the pot after calling, all-in is the stack. The
fractions (25/75/125%) are duplicated there — keep them in step with the
solver's `BET_SIZE_MENU` (the tests check the arithmetic, not the constant).

**The deck is data, not live solves:** `src/data/drill-deck.json`, produced by
`apps/api/scripts/make_drill_deck.py` (BB defend vs BTN open, single-raised
pot, 100bb, 12 flops, 72 spots, each with the solver's mix for the dealt
hand). It needs no API and works offline. Rerun the script after changing the
solver, the ranges, or the bet-size menu — the deck does not update itself.

**Theme:** its own palette, scoped under `.game` in `DrillPage.css`, the same
in light and dark mode on purpose. Purple is the default; Midnight, Ocean and
Emerald are in the settings sheet, and the pick also tints the browser/status
bar. A theme is a set of `--g-*` variables under `.game[data-theme="..."]` and
changes the scene only: the verdict colors (green/amber/red), the solver-bar
colors and the white card faces never change, so what a color means doesn't
depend on the theme. To add a theme, add a block there and an entry in
`DRILL_THEMES` (the swatch colors are repeated in the TS entry). **On a phone:**
`index.html` plus `public/manifest.webmanifest` and the apple-touch icons let you
Add to Home Screen (it opens on `/drill`); to try it on a LAN device, `pnpm exec
vite --host`. Haptics are a settings toggle (off by default); on iPhone they only work in the native build (`@capacitor/haptics`), since iOS Safari has no Vibration API.

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
kept pointing at their replacements. The desktop redesign added
`--sidebar-bg`, `--divider`, `--surface-hover`, `--surface-3`,
`--success-text`, `--warning` / `--warning-subtle` and `--card-face` /
`--card-ink` / `--card-red` (light and dark). Desktop-only rules always
sit inside `@media (min-width: 1024px)`, so phones are untouched; see
`## Desktop layout`.
