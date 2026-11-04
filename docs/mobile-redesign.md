# Mobile redesign — spec

Status: agreed with the team on 2026-11-03; built and merged the same day (PR #33),
all six phases. What was decided along the way is in `docs/decisions.md`. Still
open: the real-device checks in "After each phase", and the optional extras
(swipe-down to close a sheet, haptics, hiding the tab bar while typing).
Scope: everything under 1024px wide (phones, tablets, and the Capacitor Android
app; iOS later) for every screen **except the Drill**. Desktop (≥1024px) stays
exactly as the desktop redesign left it.
Read this file, CLAUDE.md and `docs/desktop-redesign.md` before starting.
Implement in the phases at the bottom, one PR per phase.

---

## 0. The mockup: look at it first

`docs/mobile-redesign/mockup/` holds the agreed design as clickable,
standalone HTML. Open `index.html` in a 390px-wide window, or in Chrome
device mode.

| Screen | Page | Screenshots | Spec |
|---|---|---|---|
| Solve 1 · The hand | `solve-1-hand.html` | `solve-1-hand.png`, `solve-1-hand-raise-sheet.png` | §4.1 |
| Solve 2 · The board | `solve-2-board.html` | `solve-2-board.png` (card sheet open) | §4.2 |
| Solve 3 · The ranges | `solve-3-ranges.html` | `solve-3-ranges.png`, `solve-3-ranges-hand-sheet.png` | §4.3 |
| Solve 4 · Ready / solving | `solve-4-ready.html` | `solve-4-ready.png`, `solve-4-solving.png` | §4.4 |
| Solve · Result | `solve-result.html` | `solve-result.png` (hand sheet open) | §4.5 |
| Ranges tab | `ranges.html` | `ranges.png` | §5 |
| Library tab | `library.html` | `library.png`, `library-detail-sheet.png` | §6 |
| Signed out + account sheet | `account.html` | `account.png` | §3.3 |

How to use it:
- **Look at the screenshot** before building a screen, and compare your build
  against it afterwards. Screenshot your build at 390×844, using Chrome device
  mode or Playwright.
- **Read the page source for exact values** (colors, spacing, sizes, radii,
  copy). Where the spec and the mockup disagree on a visual detail, follow the
  mockup. Where they disagree on behavior or data, follow the spec.
- **Don't copy the mockup's code.** The tiny renderer at the bottom of each page
  only exists so it runs standalone. Build real React components that reuse the
  existing hooks and components (§8), and turn the hex values into tokens in
  `index.css`.
- **All the data is placeholder.** The strategy chart comes from a rule of thumb.
- The mockup draws no status bar on purpose. See §2.

## 1. Ground rules

1. **Desktop must not change.** Everything here lives in the phone branches that
   already exist (`useIsDesktop()` is false), or behind `@media (max-width: 1023px)`.
   Run a desktop screenshot check after every phase.
2. **Don't touch the Drill.** It keeps its full-screen route with no shell. The
   tab bar's "Drill" item simply navigates to `/drill`, and the Drill's X button
   returns to the last tab.
3. **Same look as desktop:** the dark neutral tokens, violet accent, white card
   faces, and the `--strategy-*` colors. Light mode keeps working through tokens.
4. **Touch targets are at least 44px everywhere.** Primary buttons are 48px tall.
   Base text is 15px. Never go below 12px, except the grid labels (9px, which is
   unavoidable at 13 columns).
5. **The audience is new to solvers.** Use plain words ("acts first", "how often
   do you play it here?") and lead with a sentence.
6. `lib/api.ts` stays the only place that fetches, and `useSolveSetup` stays the
   single source of Solve state. The phone UI is a new view over the same hook,
   not a second state machine.

## 2. Phase 0: the status-bar bug (ship now, separately)

**Bug:** on Android, content scrolls underneath the status bar (the clock overlaps
"Poker Solver" and the range buttons in the team's screenshots). `index.html`
sets `viewport-fit=cover`, and `body` pads by `env(safe-area-inset-*)`. That
padding scrolls away with the page, so nothing stays covering the status bar area.

**Fix:**
- Make the phone header **`position: sticky; top: 0`** with a solid background and
  `padding-top: env(safe-area-inset-top)`, and remove the top inset from `body`
  (keep the left, right and bottom insets).
- Check on a real device that `env(safe-area-inset-top)` is non-zero in the
  Android WebView. If it's 0 while the app still draws under the status bar,
  either add `@capacitor/status-bar` and call `StatusBar.setOverlaysWebView({
  overlay: false })` with a matching background color at startup, or use the
  safe-area CSS variables provided by Capacitor's system-bars support. Pick
  whichever works on the team's test phone, and record it in `docs/decisions.md`.
- Acceptance: scroll every phone screen to the bottom on the Android build, and
  the status bar never overlaps content.

## 3. Shell (phones and tablets)

Replace `MobileHeader` in `App.tsx` (the logo, tagline, link row and inline
`AuthStatus` form) with:

### 3.1 Top bar
- 56px tall plus the top safe-area inset. Sticky, background `#17171e` (add a
  token), with a bottom border.
- Left: the page title (18px, weight 700). Pages may swap the title for a **back
  arrow plus title**, as the Solve result does ("BB's flop strategy").
- Right: optional page actions as 44px icon buttons (Solve has "Start over";
  the result has "Save spot"), then the **account button**: the user's initial in
  a 30px circle when signed in, a person outline icon when signed out. It opens
  the account sheet (§3.3).
- **Remove the tagline and the inline sign-in form.**

### 3.2 Bottom tab bar
- 64px tall plus `env(safe-area-inset-bottom)`. Fixed to the bottom. Four equal
  items, each a 22px stroke icon over an 11px label: **Solve, Ranges, Library,
  Drill**. Reuse `NAV_ITEMS` and the desktop sidebar's icons. The active item is
  `#c4b5fd`.
- Pages that have a bottom **action bar** (the Solve steps, Ranges) put it
  directly above the tab bar, never on top of it.
- Each tab remembers its own state and route, so leaving Solve mid-setup and
  coming back finds the setup where you left it. Lift Solve state up, or persist
  it in session storage.

### 3.3 Account sheet
A bottom sheet (§3.5) with a "Sign in" | "Create account" segmented control,
email and password fields (50px tall, with proper `autocomplete` attributes), a
primary button, and the line "You can use Solve, Ranges and the Drill without an
account." When signed in, the sheet shows the email, then "Sign out" as a ghost
button. It reuses `lib/auth.tsx`. Open it from the account button, from the
signed-out Library screen, and whenever a signed-out user taps Save.

### 3.4 Tablets (768–1023px)
Use the phone layout, with the content column centered at `max-width: 560px`. The
top bar and tab bar backgrounds still run the full width.

### 3.5 Shared phone components
Build these once, under `components/mobile/`:
- **`BottomSheet`**: a scrim (`rgba(0,0,0,.6)`, tap to close), a sheet with 20px top
  radius, a 40×4 handle, and a close button. `role="dialog"`, focus trapped while
  open, Esc closes it. Android back closes the sheet before doing anything else.
  Swipe-down to close is nice to have.
- **`ChipGroup`**: a grid of 44px chips with `aria-pressed`, used for seats,
  stacks, brush weights and ranks.
- **`ActionBar`**: the pinned bottom bar, with a secondary Back (96px wide) and a
  flexible primary button. A disabled primary says *why*, for example "Finish
  preflop first" or "Pick at least 3 cards".
- **`StepProgress`**: four segments (Hand, Board, Ranges, Solve). Done and current
  segments are violet, later ones gray. Tapping an earlier step jumps back to it.
- `SegmentedControl` already exists, so reuse it.

## 4. Solve: a four-step flow (`SolvePhone` in `SolvePage.tsx`)

Replace the long single page with four step screens plus a result screen,
all driven by the existing `useSolveSetup` hook.

**Routing and back behavior:** the step lives in the URL (`/solve?step=hand|board|ranges|ready`
and `/solve?step=result`). Each step change **pushes a history entry**. That makes
the Android back gesture and button (Capacitor's default back behavior walks the
WebView history) and the browser back button go back one step. Closing an open
sheet takes priority over going back. Opening a spot from the Library, or "Solve a flop
from here" from Ranges, lands on the right step with everything pre-filled.

### 4.1 The hand
- Heading: "Who's in the hand?"
- "Player 1" and "Player 2" as 6-column seat chip groups. A player can't pick the
  seat the other already has. Under them: "{X} acts first after the flop. {Y}
  acts last." (from `assignPostflopSeats`).
- "Starting stack": chips for 40 / 60 / 100 / 150 / 200bb. Add a "Custom" chip if
  you need other stacks; it opens a numeric sheet.
- "Before the flop": a card listing the actions so far, with the running pot on the right.
  The player to act gets a tinted row ("BB to act · facing 2.5bb") with a 2×2 grid
  of large buttons: **Fold, Call {x}bb, {3-bet/4-bet}…, All-in**. This is the
  `handBuilder` / `StreetActions` logic in a new layout.
- **Raise sheet**: three presets (3×, 3.5× and 4× the current bet, each showing
  the bb amount and the multiplier) plus All-in, then a −/＋ stepper around the
  big amount (0.5bb steps), then Cancel and a primary "{3-bet} to {x}bb".
- "Undo last action" (ghost) and "Or paste a hand history instead" (link). The
  second one opens a sheet with the textarea, reusing `parseHandHistoryToPostflopSetup`,
  which fills all four steps and jumps to Ready.
- If someone folds, show "Someone folded, so there's nothing left to solve. Undo
  to change it."
- Action bar: Back (disabled here) plus "Next: the board", which is disabled with
  "Finish preflop first" until preflop is closed.
- Postflop streets before the solved one (flop actions when solving the turn, and
  so on) appear in this same card as extra sections once their board cards
  exist. Keep the existing rule: an earlier street must close before the next one
  unlocks.

### 4.2 The board
- Heading: "What's on the board?", with the hint "3 cards solves the flop, 4 the
  turn, 5 the river."
- Five 62×88 card slots labelled Flop / Flop / Flop / Turn / River. Filled slots
  are white card faces. Empty ones are dashed with "+". The slot being picked
  gets a violet border. Slots after the first empty one are dimmed and can't be
  tapped.
- **Card sheet**: titled "Pick the 3rd flop card". Step 1 is the rank: 13 chips in a
  7-column grid, with a rank disabled once all four suits are used. Step 2 is the suit:
  four white buttons, each a large symbol over its name, disabled until a rank is
  picked or when that card is already used. Picking a suit fills the slot and
  moves to the next empty flop slot. The sheet closes once the flop is complete.
  "Remove this card" appears when editing a filled slot.
- A summary card shows "Solving the flop/turn/river", "Pot · Stacks · who acts first".
- "Or type it" input with `lib/cards.ts` validation, kept in sync with the slots.
- Action bar: Back plus "Next: the ranges", disabled with "Pick at least 3 cards".

### 4.3 The ranges
- Heading: "Which hands could they have?", with "Loaded from the preflop action.
  Tap a hand to change it, or switch to Paint to drag." Load ranges
  automatically when this step is reached, the same as desktop's auto-load.
- A player switch: a two-item segmented control, each item showing "BB · acts first"
  and "39.4% of hands".
- A mode switch: **"Tap to edit" | "Paint"**, plus a reload icon button ("Reload from the
  preflop action"). "Narrow by earlier action" goes in an overflow menu, or a
  button under the grid, when it applies.
- The **grid** stretches 8px past the page padding on each side (`margin: 0 -8px`),
  with a 2px gap, 3px cell radius and 9px labels.
  - *Tap mode* (the default): tapping a cell opens the **hand sheet**: the hand
    in large type, "offsuit · 12 combos", the question "How often does BB have
    this hand here?", a 5-chip weight row (0 / 25 / 50 / 75 / 100%, with the
    current value pressed), an explanation of what in-between weights mean, and Done.
    Changes apply immediately.
  - *Paint mode*: a brush row appears (100 / 75 / 50 / 25% / Erase) with the hint
    "Drag across the chart to paint. The page won't scroll while Paint is on."
    The grid gets a 2px violet border. Implement this with pointer events and
    `touch-action: none` on the grid **only in paint mode**, so scrolling works
    normally in tap mode. Extend `RangeGrid` with a `mode` prop rather than forking it.
- Under the grid: "**522** combos · 39.4%" and a small Always / Sometimes legend.
- Action bar: Back plus "Next: review & solve".

### 4.4 Ready / solving
- **Ready**: heading "Ready to solve", with "BB acts first on the flop, so the
  solver works out BB's best mix of plays." Then a summary card with rows for Hand,
  Board (card faces), Pot · Stacks and Ranges, where each row has an "Edit" link
  to its step. Then "Usually takes 10–90 seconds. This is a real solve, not a lookup.
  You can switch tabs while it runs." Action bar: Back plus "Solve {player}'s
  {street}".
- **Solving**: a progress bar, "Solving BB's flop…", and "It keeps refining until
  the strategy is within 0.5% of the pot of perfect play. You can switch tabs;
  we'll keep going." The action bar has only Cancel. The API gives no progress
  updates, so animate an indeterminate bar, or estimate progress from elapsed time
  capped at 90%. Don't fake precision. **The solve must keep running if the user
  switches tabs** (keep the request in the lifted Solve state), and the Solve tab
  icon shows a small dot until the user sees the result.
- **Done**: a check icon, "Solved in {n} seconds", the accuracy line (§4.5), and
  the primary "See the result".
- Error states (invalid, busy, network, etc.) use the same copy as desktop
  (`solveText.ts`), in a card with a "Try again" button.

### 4.5 Result
- The top bar has a back arrow ("Back to setup", which goes to Ready), the title
  "{player}'s {street} strategy", and a "Save spot" icon button.
- A strip with small board cards, "BB vs BTN · pot 5.5bb", and an accuracy pill:
  green "Very accurate", or the desktop thresholds' "Accurate" / amber "Rough".
- A summary card: the headline sentence (19px), one supporting line, a 28px
  stacked action bar, and a two-column legend with percentages. All of it comes
  from the same functions desktop uses (`StrategyResult`, `strategySummary`).
- The strategy grid, full width, styled like §4.3. Tapping a cell opens the
  **hand sheet**: the hand, the category line, "{n} combos in BB's range", one bar per
  action with its %, the advice box, and a collapsed "Why?". This is the same content
  as desktop's selected-hand panel, so reuse that component in a sheet. Show the
  per-suit view inside the sheet when there is suit data.
- "Keep exploring": a horizontally scrolling row of 44px pills ("If BB checks,
  what does BTN do?", "If BB bets small", "Deal a turn"), with the same behavior
  as desktop.

## 5. Ranges tab (`RangesPage`, phone branch)

Replace the old Builder / TypeIn / Import phone pages with one phone layout
built on `useReferenceChart` (shared with desktop):
- A Pick | Type it | Hand history segmented control (still synced to `?mode=`).
- **Pick**: "Your seat" with 6 chips; "Before you" as a segmented control
  ("Nobody raised" | "Facing a raise", disabling whatever is impossible); "Who raised?"
  chips when facing a raise; and a "Stack" segmented control (40bb | 100bb).
- **Type it**: the input plus example chips, as on desktop. **Hand history**: the
  textarea plus "Read hand".
- **No "Get reference strategy" button.** The chart updates as soon as the spot
  changes, the same as desktop.
- The chart heading (the spot in words, the subline, and "Standard chart: a starting point,
  not a live solve."), then a Tap/Paint switch plus a reset button, the grid, and
  "40.0% of all hands · 530 combos · edited".
- Action bar: "Save" (secondary; opens a sheet with a name field, and the account sheet
  if signed out) plus "Solve a flop from here" (primary; goes to Solve step 1
  pre-filled, the same as desktop).
- Then delete `BuilderPage`, `TypeInPage` and `ImportPage` (and the `SpotBuilder`
  component if nothing else uses it), and move their tests over. **Keep
  `SpotBuilder.css`**: many desktop pages import it for shared classes.

## 6. Library tab (`LibraryPage`, phone branch)

Replace `SavedSpotsPage` on phones:
- A search input and an All / Preflop / Postflop segmented control.
- A list of **cards** (whole card tappable): the name (15px, weight 650), a type
  pill (green Preflop or amber Postflop) plus "BTN · 100bb · Oct 7", and a chevron.
- Tapping a card opens the **detail sheet**: type pill, name, description, then
  either a mini range (150px wide) with "% of hands / combos", or the board cards
  plus "Saved setup only. Open it and tap Solve to see the strategy again."
  Below that, the primary "Open in Ranges" / "Open in Solve" button, then Duplicate / Rename /
  Delete (Delete is danger-styled and asks for confirmation). This uses the API
  endpoints the desktop phase added. **Opening saved spots now works on phones too**
  (it was desktop-only).
- **Signed out**: a bookmark icon in a circle, "Your saved spots live here", "Sign in
  to save charts and solves and open them on any device.", and a "Sign in" button that
  opens the account sheet.
- Empty (signed in, nothing saved yet): "No saved spots yet. Save a chart from Ranges
  or a setup from Solve."

## 7. Platform details

- **Safe areas:** the top bar uses the top inset and the tab bar the bottom inset
  (see §2). Sheets add the bottom inset to their padding.
- **Back:** history-based, as described in §4. Check on the Android build that back
  from the Solve tab's first step leaves the app (or goes to the previous tab)
  rather than doing nothing.
- **Keyboard:** when an input is focused, the action bar and tab bar must not cover
  it. Hide the tab bar while the on-screen keyboard is open, if needed.
- **Haptics:** a light tap on chip, weight and action-button presses through the
  existing `lib/haptics.ts`, behind the same opt-in setting the Drill uses. Optional.
- **iOS** (later): the same safe-area approach. Nothing in this spec is Android-only.

## 8. Reuse map

| Need | Reuse |
|---|---|
| All Solve state, solving, narrowing, preflop ranges | `pages/solve/useSolveSetup.ts` |
| Action logic, pots, legal actions | `lib/handBuilder.ts` |
| Board validation | `lib/cards.ts` |
| Result numbers, headline, advice, categories | `pages/solve/StrategyResult.tsx`, `lib/strategySummary.ts`, `pages/solve/solveText.ts` |
| Reference chart fetch / save | `lib/useReferenceChart.ts` |
| Grids | `RangeGrid` (add `mode: "tap" \| "paint"` and an `onCellTap` prop), `StrategyGrid` |
| Library data + actions | `lib/api.ts` (`listSpots`, `renameSpot`, `deleteSpot`, …), `lib/solvePrefill.ts` |
| Auth | `lib/auth.tsx` |

## 9. Phases (one PR each, in order)

0. **Status-bar fix** (§2). Small; ship it right away.
1. **Shell:** top bar, bottom tab bar, account sheet, `BottomSheet` / `ChipGroup` /
   `ActionBar` components, tablet max width, and per-tab state persistence.
2. **Solve flow:** steps 1–4 with URL-based steps and history, raise sheet, card
   sheet, tap/paint grid editing, and the solving/done states (solving keeps running across tabs).
3. **Solve result:** summary card, grid, hand sheet, Keep exploring, Save.
4. **Ranges tab:** the new phone layout, auto-update, save sheet, and deleting the old
   pages.
5. **Library tab:** the list, detail sheet, open/duplicate/rename/delete, and the
   signed-out and empty states.

After each phase: `pnpm --filter web build`, `lint` and `test`. Screenshot the
phone screens at 390×844 and compare them with `docs/mobile-redesign/mockup/screenshots/`.
Screenshot desktop at 1440px to confirm nothing changed there. Check on the real
Android build that nothing overlaps the status bar or gesture bar, that back works,
and that the keyboard doesn't cover inputs. Update CLAUDE.md and add a dated
entry to `docs/decisions.md`.
