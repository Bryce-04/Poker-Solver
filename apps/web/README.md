# apps/web

The React + TypeScript + Vite frontend. See
[`../../docs/plan.md`](../../docs/plan.md) for the roadmap and where this fits.

**Status:** four destinations — **Solve**, **Ranges**, **Library**, **Drill**
(`react-router-dom`, `BrowserRouter` in `App.tsx`; nav items in
`lib/navigation.ts`). The old routes redirect: `/` → `/solve` (on phones, the
last tab used), `/saved` → `/library`, `/type-in` and `/import` →
`/ranges?mode=type|paste`. Every screen has two layouts, one for phones and
tablets and one for desktop (see `## Two layouts`), over the same state and
logic.

- **Solve** runs a real solve through `apps/api`'s `POST /spots/solve`: both
  players' ranges, a board, and the hand so far (clicked through with real
  bet sizes, or read from a pasted hand history), with the result as a
  color-coded strategy chart. See `## Solve`.
- **Ranges** shows the standard preflop chart for a spot described three ways
  (pick it, type it, or paste a hand history), editable, savable, and one tap
  from solving a flop. See `## Ranges`.
- **Library** lists the signed-in user's saved spots, with open / rename /
  duplicate / delete. Saving and listing need Supabase sign-in (see `## Auth`).
- **Drill** is a full-screen practice game over a pre-solved deck. See
  `## Poker Drill`.

All three ways of describing a preflop spot converge on `lib/spot.ts`'s
`Spot` builders: the Pick controls, Stage 3's rule-based text parser
(`lib/parseSpotText.ts`) and Stage 4's hand-history import
(`lib/parseHandHistory.ts`, one format).

## Two layouts

Which one renders is `lib/useIsDesktop.ts` (a `min-width: 1024px` media
query), not CSS. jsdom has no `matchMedia`, so tests see the phone layout
unless they stub it, as the desktop test files do. Each page keeps its state
in one place (a hook or the URL), so resizing across the breakpoint keeps a
half-built hand.

**Desktop (>= 1024px)**, built from `docs/desktop-redesign.md`:
- **Shell:** `components/Sidebar` (nav, a guide card, `AuthStatus
  variant="sidebar"`) and `components/PageHeader` across the top of each page.
- **Solve:** `pages/solve/SolveWorkspace.tsx`, setup and result views.
- **Ranges:** `pages/RangesWorkspace.tsx`, a rail plus the chart.
- **Library:** `pages/library/LibraryWorkspace.tsx`, a table plus a preview.
- Every desktop-only rule sits inside `@media (min-width: 1024px)`.
  `src/desktop.css` holds the button roles (`.btn-primary` / `-secondary` /
  `-ghost` / `-danger`, one primary per screen). Give every new desktop
  button a role class: a bare `<button>` in the shell is no longer
  accent-filled there.

**Phones and tablets (< 1024px)**, built from `docs/mobile-redesign.md`:
- **Shell** (`components/mobile/`): a sticky `TopBar` (page title, the page's
  actions via `<TopBarActions>`, an optional back arrow via `<TopBarTitle>`,
  and the account button), a fixed `TabBar`, and the `AccountSheet`. The page
  sits in a column at most 560px wide. The top bar covers the status bar and
  the tab bar the gesture bar; read safe-area insets as `--safe-top` etc.
  (`index.css`), which prefer Capacitor's injected values over `env()`.
- **Tabs remember where you were**: each returns to the URL it was left on,
  and Solve stays mounted (hidden) while another tab or the Drill shows, so a
  half-built setup or a running solve survives (`SolveKeepAlive` in
  `App.tsx`).
- **Solve:** `pages/solve/phone/`, four steps plus a result screen.
- **Ranges:** `pages/ranges/RangesPhone.tsx`.
- **Library:** `pages/library/LibraryPhone.tsx`, cards plus a detail sheet.
- **Shared phone components:** `BottomSheet` (focus trap, Esc, and Android /
  browser Back closes it first), `ChipGroup`, `ActionBar` (the pinned bottom
  bar, whose disabled button says why), `StepProgress`, `RangeEditor`.
  `lib/mobileShell.ts` holds what pages share with the shell
  (`useOpenAccountSheet()`, the Solve tab's dot, the top-bar slots).

**Shared by both layouts:** `pages/solve/useSolveSetup.ts` (all of Solve's
state and actions), `lib/useReferenceChart.ts` (fetch a chart, edit its range,
save it), `lib/rangesSpot.ts` (Ranges' spot logic and auto-load),
`pages/library/useLibrary.ts` (the Library's data and actions), and
`pages/solve/solveText.ts` (wording).

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
  App.tsx                     router shell: phone top bar + tab bar, or desktop sidebar,
                              + <Routes>; SolveKeepAlive; old-route redirects
                              (BrowserRouter lives here, not main.tsx — see docs/decisions.md)
  index.css                   design tokens (--*), light/dark via
                              prefers-color-scheme, base element styling, safe-area insets
  desktop.css                 desktop-only (>= 1024px) button roles, section labels
  App.css                     shell layout (phone column; desktop shell + page header)
  pages/
    SolvePage.tsx              "/solve" — calls useSolveSetup once, then the phone flow
                              or SolveWorkspace
    solve/                    useSolveSetup.ts (state), solveText.ts (wording),
                              SolveProblem, useAutoLoadRanges; desktop: SolveWorkspace,
                              ActionTimeline, BoardSlots, StrategyResult
    solve/phone/              phone Solve: SolvePhone (routes ?step=), HandStep,
                              BoardStep, RangesStep, ReadyStep, ResultStep,
                              phoneSteps.ts (pure logic)
    RangesPage.tsx             "/ranges" — picks RangesWorkspace or ranges/RangesPhone
    RangesWorkspace.tsx        desktop Ranges: rail + chart
    ranges/                   phone Ranges (RangesPhone), ChartProblem (shared messages)
    LibraryPage.tsx            "/library" — picks LibraryWorkspace or LibraryPhone
    library/                  useLibrary (shared), LibraryWorkspace (desktop),
                              LibraryPhone (phone)
    DrillPage.tsx              "/drill" — the Poker Drill; full screen, rendered
                              outside the shell (see ## Poker Drill)
  components/
    mobile/                   phone shell and pieces: TopBar, TabBar, AccountSheet,
                              BottomSheet, ChipGroup, ActionBar, StepProgress,
                              RangeEditor, TopBarActions, TopBarTitle; mobile.css
    Sidebar/                  desktop nav sidebar (nav, guide card, account row)
    PageHeader/               desktop page title bar with page actions
    AuthStatus/               desktop sign-in (the sidebar's account row and form)
    NavIcon/                  the four nav icons (sidebar and tab bar)
    SegmentedControl/         one row of mutually exclusive choices (its own CSS, both widths)
    MiniRange/                a label-less 13×13 range thumbnail
    RangeGrid/                the 13×13 starting-hand grid
    CardPicker/               click-to-toggle board-card grid (desktop Solve's board slots)
    StrategyGrid/             13×13 color-coded solve-result chart
    StreetActions/            one street's action log + controls (older; desktop uses
                              ActionTimeline)
    PlayingCard/              a face-up card ("Ah"); the drill forces white faces
    SpotBuilder/              SpotBuilder.css only: shared spot-builder__* classes
                              (status blocks, fields) used across the app
    ErrorBoundary/            wraps every route (App.tsx): a render crash shows a
                              recoverable message, not a blank screen
  lib/
    api.ts                    fetch wrapper: fetchReferenceStrategy, saveSpot,
                              listSpots, renameSpot, deleteSpot, solveSpot, ...
    auth.tsx, supabase.ts     Supabase session state (useAuth) and client
    useSignInForm.ts          email/password sign-in and sign-up (AuthStatus, AccountSheet)
    useIsDesktop.ts           the 1024px breakpoint, for layout switches CSS can't do
    mobileShell.ts            what phone pages share with the shell (contexts, hooks)
    navigation.ts             the four nav destinations + desktop page titles
    useReferenceChart.ts      fetch a chart, edit its range, save it (every chart page)
    rangesSpot.ts             Ranges' Pick logic, chart titles, debounced auto-load
    solvePrefill.ts           route state into Solve: Ranges' "solve from here", or a
                              Library spot (seedFromSpot rebuilds a saved setup)
    spotText.ts               a saved spot in words (summarize, displayName, board text)
    spot.ts                   buildOpenSpot/buildVsRaiseSpot — the shared Spot-assembly
                              helpers every entry path converges on
    parseSpotText.ts           Stage 3's rule-based parser (two phrasings, plus synonyms)
    parseHandHistory.ts        Stage 4's rule-based hand-history parser (one format),
                              plus parseHandHistoryToPostflopSetup (Solve's
                              "from a hand history" setup mode)
    handBuilder.ts             Solve's click-through setup: walks
                              preflop -> flop -> turn -> river from real
                              actions, deriving pot_bb/effective_stack_bb
                              instead of them being typed in
    cards.ts                   parseBoardText / boardFromCards — board validation
    chaining.ts                narrowing ranges by an earlier street's action
    rangeCombos.ts             hand labels <-> specific combos, weights, combo counts
    strategySummary.ts         a strategy's overall mix and action colors/labels
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
a component and can't use the hook. Email/password sign-in and sign-up live
in `lib/useSignInForm.ts`, shared by the two places you sign in: on desktop
`components/AuthStatus` in the sidebar (an initial avatar, the email and a
ghost Sign out, or a "Sign in" button that opens the form), and on phones
`components/mobile/AccountSheet`, opened from the top bar's account button.
There's no magic link, to avoid a redirect URL in the Supabase dashboard and
native deep-link handling this Capacitor app doesn't have.

`saveSpot`/`listSpots`/`renameSpot`/`deleteSpot` (`lib/api.ts`) attach
`Authorization: Bearer <token>` when a session exists, omitted (not
blocked client-side) otherwise. `apps/api` verifies it and returns 401
without it (`docs/decisions.md`'s 2026-09-30 and 2026-10-06 entries).
Separately, every Save skips the API call entirely when signed out: on
desktop it shows a sign-in prompt, and on phones it opens the account sheet
(`useOpenAccountSheet()`, null on desktop). Both Library layouts show only a
signed-out screen when signed out (neither calls `GET /spots`, which requires
sign-in), and fetch the signed-in user's own spots, refetching when the
account changes (`pages/library/useLibrary.ts`).

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

## Ranges

`/ranges` shows the standard preflop chart for a spot, described one of three
ways (`?mode=`; none means Pick):

- **Pick:** your seat, whether someone raised before you, who raised, and the
  stack (about 40bb or 100bb). Impossible combinations are derived away
  (`lib/rangesSpot.ts`'s `pickSpot`): BB is never first in, UTG never faces an
  earlier raise, and the raiser acts before you.
- **Type it:** Stage 3's rule-based parser (`lib/parseSpotText.ts`), with
  example phrases.
- **Hand history:** Stage 4's import (`lib/parseHandHistory.ts`), stopping at
  your first decision.

All three converge on `lib/spot.ts`'s builders. There's no "get chart" button:
the chart loads whenever the described spot changes (debounced 250ms; only the
latest response is applied, `lib/useReferenceChart.ts`). The chart's range is
editable before saving, can be reset to the chart, and "Solve a flop from
here" takes it into Solve (`lib/solvePrefill.ts`). A chart opened from the
Library shows its saved range and keeps its name.

On phones (`pages/ranges/RangesPhone.tsx`) Pick's choices and the typed phrase
live in the URL (`seat`, `before`, `raiser`, `stack`, `text`), so the tab comes
back as it was left; Save opens a name sheet. On desktop
(`pages/RangesWorkspace.tsx`) it's a rail plus the chart with a stats and save
card.

A well-formed spot with no chart yet (e.g. HJ defending, or a stack between
the ~40bb / ~100bb buckets) is a normal `no-match`, and the message
(`pages/ranges/ChartProblem.tsx`) lists the current coverage. The matcher is
owned by `apps/api/app/reference_charts.py`; the client doesn't re-implement it.

## Solve

`pages/SolvePage.tsx` is Stage 5's screen: a real solve (`apps/api`'s
`POST /spots/solve`) instead of a static reference chart. All of its state is
`pages/solve/useSolveSetup.ts`, called once in `SolvePage`; the two layouts
are views over it:

- **Phones** (`pages/solve/phone/`): four steps, Hand → Board → Ranges →
  Solve, then a result screen. The step is in the URL
  (`/solve?step=hand|board|ranges|ready|result`, one history entry each, so
  Android back walks back through them). Big buttons for each action, a raise
  sheet, a rank-then-suit card sheet, tap-or-paint range editing, a Solving
  screen with Cancel, and a result with a hand sheet and Keep exploring.
- **Desktop** (`pages/solve/SolveWorkspace.tsx`): an action timeline, board
  slots, a "Ready to solve" checklist, Ranges / Strategy tabs, and a result
  view with an accuracy card and Keep exploring.

Ranges load on their own once preflop closes (`useAutoLoadRanges`): from the
preflop line when it's charted (`POST /spots/preflop-ranges`), otherwise each
seat's typical range. On flop solves, each hand also gets a category and a
"Why?". The design points that hold for both layouts:

- **Two ways to reach a decision point**:
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
    with the original Stage 4 `parseHandHistory` (which backs Ranges'
    Hand history mode) but does a different job. Kept as a genuinely
    separate mode rather than merged into the click-through builder's
    state — a pasted hand history already tells you pot/stack/board
    directly.

  Neither mode sets a range: a hand history doesn't reveal villain's
  cards, and the click-through builder's job is pot/stack bookkeeping.
  Ranges come from the auto-load above, or are edited by hand.
- **Two positions, two ranges.** The first seat is out of position (acts
  first postflop), the second in position, matching
  `apps/api/app/solve.py`'s contract; both ranges need hands before a
  solve.
- **A board, picked or typed.** Both converge on `lib/cards.ts`'s
  `ParseBoardResult`, so everything past that point has one code path; 3, 4
  or 5 cards selects flop, turn or river, with no separate street picker.
- **Results are a 13×13 chart** (`components/StrategyGrid/StrategyGrid.tsx`),
  not a table — each cell is a left-to-right gradient of that hand's
  action mix (fold cool-colored, check/call gold, bet sizes a deepening
  red ramp, all-in darkest). Tap or click a cell for that hand's panel
  (`StrategyResult.tsx`'s `HandPanel`: its mix as bars, advice, "Why?" and
  the suit view), beside the chart on desktop and in a sheet on phones.
  Reuses `RangeGrid.css`'s grid/cell classes directly with the fill set
  per-cell via an inline gradient instead of the weight-based `color-mix`. Unlike every
  `ReferenceStrategyResult`/`HandRange` elsewhere in the app (one weight
  per hand), this is a genuine distribution over multiple actions per
  hand — `LiveSolveResponse.strategy` in `lib/api.ts`. A hand missing from
  the response (not in range, or never sampled enough to report) renders
  as a flat neutral cell, not a color — see the caveat on per-hand
  precision below.
- **A solve takes a few seconds, more for a wide-range flop** — it trains
  server-side until the result is within 0.5% of the pot of a true
  equilibrium, not a lookup. The loading state says so explicitly rather
  than looking stuck (the API reports no progress, so no percentage is
  shown), Cancel stops waiting (the server still finishes; the result is
  dropped), and the result shows the precision actually reached (`LiveSolveResponse.exploitability_pct`, optional on the client
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

Status blocks (errors, notices) reuse `SpotBuilder.css`'s `spot-builder__*`
classes, as other screens do.

## Poker Drill

`pages/DrillPage.tsx` at `/drill`. A practice game, not a page of the app:
`App.tsx` routes `/drill` to it directly, outside `Shell`, so there's no
header or nav — an X (top-left) back to `/` (on phones that's the last tab
used; the phone shell stays mounted under the Drill) and a settings cog
(top-right). It
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

Read-only mode renders the same shaded grid as static cells with none of the
interaction wired up.

**Phone modes** (`mode="tap" | "paint"`, used through
`components/mobile/RangeEditor`): the grid hides its own toolbar, and the
page draws the controls. In `"tap"` a tap calls `onCellTap` (to open a
hand-weight sheet), edits nothing itself, and the page scrolls normally over
the grid. In `"paint"` dragging writes `brush` (0 erases) and only then does
the grid take the drag (`touch-action: none`). Leave `mode` unset everywhere
else; desktop never sets it.

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
`--card-ink` / `--card-red`; the mobile redesign added `--bar-bg`,
`--nav-active`, `--chip-border`, `--chip-border-hover`, `--chip-selected` and
`--scrim` (all light and dark). Desktop-only rules sit inside
`@media (min-width: 1024px)`. Phone pages build from
`components/mobile/mobile.css`: buttons (`.m-btn` with `--primary` /
`--secondary` / `--ghost`, `.icon-button`) and page blocks (`.m-step`,
`.m-section`, `.m-label`, `.m-note`, `.m-field`, `.m-card`, `.m-link`,
`.m-pills`). Phone chips are `.m-chip`, never `.chip`: `DrillPage.css` has a
global `.chip` of its own. See `## Two layouts`.
