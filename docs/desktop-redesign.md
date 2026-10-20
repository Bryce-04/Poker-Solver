# Desktop redesign — spec

Status: agreed with the team on 2026-10-20. All six phases implemented on the
`desktop-phase-1` branch the same day. Where the build departs from this spec
(phones keep the old Ranges/Solve/Saved screens, no `name` column, flop-only
hand categories), the reason is in `docs/decisions.md`.
Scope: the desktop web UI for every screen **except the Drill**, plus the API,
schema and frontend-logic changes the new screens need.
Audience: anyone (or any Claude Code session) implementing it. Read this whole
file and CLAUDE.md before starting. Implement in the phases at the bottom, one
PR per phase.

---

## 0. The mockup: look at it first

`docs/desktop-redesign/mockup/` holds the agreed design as clickable,
standalone HTML. Open `index.html` in a browser at **1440px wide or more**.

| Screen | Page | Screenshot | Spec section |
|---|---|---|---|
| Solve, setting up a spot | `mockup/solve-setup.html` | `mockup/screenshots/solve-setup.png` | §6.1 |
| Solve, after solving | `mockup/solve-result.html` | `mockup/screenshots/solve-result.png` | §6.2 |
| Ranges (merged) | `mockup/ranges.html` | `mockup/screenshots/ranges.png` | §6.3 |
| Library | `mockup/library.html` | `mockup/screenshots/library.png` | §6.4 |

How to use it:
- **Look at the screenshot** of a screen before building it, and compare your
  result against it when you're done (screenshot your build at 1440px wide).
- **Read the page source for exact values.** Colors, spacing, font sizes, radii
  and copy are inline styles plus a `<style>` block at the top. Where this spec and
  the mockup disagree on a visual detail, follow the mockup. Where they disagree on
  behavior or data, follow this spec.
- **Don't copy the mockup's code into the app.** Each page carries a tiny
  template renderer at the bottom just so it works standalone. Rebuild the
  screens as React components using the real `RangeGrid`, `StrategyGrid`,
  `CardPicker`, `StreetActions` and so on, and turn the mockup's hex values into tokens
  in `index.css`.
- **All the data in the mockup is placeholder:** ranges, strategy percentages,
  accuracy, timings and saved spots. The strategy chart there comes from a rule of thumb.
  Real numbers come from the existing API.
- The mockup's text is the intended copy unless this spec says otherwise.

## 1. Why

On desktop the app is the phone layout centered. `.app` in `App.css` caps the
page at `max-width: 44rem`, so about two-thirds of a wide screen is empty and the
Solve page is five or six screens of scrolling. You can never see the ranges, the
board and the result at the same time.

Other problems this fixes:

- **Three tabs for one feature.** Builder, Type in and Import all do the same thing
  (get a preflop reference chart and edit it). They're just three ways to describe the spot.
- **Saved is a dead end.** It lists spots, but you can't open, rename or delete
  them, and every row reads the same ("BTN — 100bb, unopened pot").
- **No button hierarchy.** The global `button` rule in `index.css` makes every
  button solid accent, so "Sign out" is the loudest thing in the header.
- **Developer copy in the product.** "Stage 3 MVP", "Stage 4 MVP", and on
  `SavedSpotsPage`'s network error, "Is `apps/api` running? Start it with
  uvicorn…". That last one is **not** gated on `import.meta.env.DEV`.

## 2. Ground rules

1. **Mobile must not change visually.** Every layout and styling change in this
   spec sits behind `@media (min-width: 1024px)`. Below that width, the current
   layout, top nav, spacing and button styles stay exactly as they are. That
   includes the Capacitor Android build, which uses the same CSS.
   *Exception:* the route/IA changes in §3 apply at every width (see the decision
   in §3).
2. **Don't touch the Drill.** `/drill`, `DrillPage.tsx` and `DrillPage.css` stay as
   they are, and the Drill still opens full screen outside the shell.
3. **Keep using the design tokens.** Add new tokens to `index.css` (both light
   and dark blocks) rather than hard-coding colors. The mockup is dark-only, so
   choose matching light-mode values for any new tokens.
4. **The audience is players new to solvers.** Use plain-English labels ("Acts
   first" / "Acts last", with OOP/IP at most as secondary text), lead results
   with a sentence, and keep explanations. But put long explanations in empty
   states, before a result exists, or behind a "?" / `<details>` once there is one,
   instead of always on screen.
5. Follow the existing conventions in CLAUDE.md: `lib/api.ts` stays the only place
   that fetches, and every entry path converges on `Spot` via `lib/spot.ts`.
   Update CLAUDE.md at the end of each phase.

## 3. Information architecture

New navigation: four entries.

| Nav item | Route | Replaces | Subtitle shown under the label (desktop) |
|---|---|---|---|
| Solve | `/solve` | Solve | Best play after the flop |
| Ranges | `/ranges` | Builder (`/`), Type in (`/type-in`), Import (`/import`) | Which hands to play preflop |
| Library | `/library` | Saved (`/saved`) | Your saved spots |
| Drill | `/drill` | (unchanged) | Practice game · full screen |

- Redirect the old routes so existing links and bookmarks keep working:
  `/` → `/solve`, `/saved` → `/library`, `/type-in` → `/ranges?mode=type`,
  `/import` → `/ranges?mode=paste`. `/ranges` with no `mode` means "pick".
- **Decision to confirm with the team:** merging the routes necessarily changes
  mobile's top nav too (four links instead of six). The recommendation is to
  accept that: the merged Ranges page renders on mobile in a single column that
  looks like today's Builder, with a small Pick / Type it / Hand history switch
  at the top. If the team rejects this, keep the old routes on mobile and show
  the merged page only on desktop, but that's more code to maintain.

## 4. App shell (desktop)

Replace the centered column with a full-width shell at ≥1024px:

- **Left sidebar, 232px**, full height, background slightly lighter than the
  page (`#17171e` in dark), with a right border.
  - Top: the logo mark plus "Poker Solver". **Remove the tagline** ("Manual hand
    builder, preflop reference charts…").
  - Nav: icon, label, and a one-line muted subtitle (table above). Active item
    gets the accent-subtle background (`--accent-subtle`) and strong text. Use
    the existing `NavLink` render-prop for `aria-current="page"`.
  - Bottom: a "New to solvers? A 2-minute guide to reading the charts" card
    (link target TBD; it can point to a static help page later), then the account
    row: an initial avatar, the email truncated with an ellipsis, and "Sign out" as a
    **ghost** button. `AuthStatus` moves here on desktop; signed-out shows a
    "Sign in" primary button in the same spot.
- **Content area** fills the rest. Each page starts with a header bar
  (padding 22px 32px, bottom border) holding an h1 (22px, weight 700), a one-line
  muted description, and page-level actions on the right.
- Most pages are a **two-pane workspace**: a left setup rail (`flex: 1 1 340px`,
  right border, padding 24px) and a main canvas (`flex: 999 1 600px`, padding
  24px 32px). No max-width on the shell. The big grids cap themselves
  (`max-width: 620–680px`).

## 5. Visual system changes (desktop-gated)

- **Button hierarchy:** add `.btn-primary` (accent fill, as today),
  `.btn-secondary` (`--surface-2` fill, `--border-strong` border, strong text)
  and `.btn-ghost` (transparent, `--text`, hover `--surface-2`), plus
  `.btn-danger` (transparent, `--danger` text). On desktop, the bare `button`
  rule stops being accent by default; buttons opt in. Each screen has **one**
  primary action at most.
- **Segmented control** (`.seg` / `.seg-item[aria-pressed=true]`) for every
  small set of mutually exclusive choices: entry mode, brush weight, seat, stack,
  Library filter. One component, reused everywhere.
- **Playing cards everywhere use white card faces** (as in the Drill and
  `PlayingCard`): board slots 52×72px in setup, 40×56px in summaries, with
  red ♥♦ and black ♠♣.
- **Grids get bigger on desktop:** range and strategy cells around 40–46px with a
  3px gap, 12px labels, in a padded `--surface` container. Weighted cells keep
  today's meaning (fill height = weight); the mockup draws it as a bottom-up
  gradient.
- Section labels: 11px, uppercase, `letter-spacing: .08em`, `--text-muted`.
- Numbers use `font-variant-numeric: tabular-nums`.
- Remove the doubled header divider lines.

## 6. Screens

### 6.1 Solve — setup state (`SolvePage.tsx`)

**Rail (left):** three numbered parts, replacing the four stacked `Step`s:

1. **The hand.** A segmented control: "Click through" | "Hand history" (replaces
   the current radio). Click-through shows a 3-column row ("Acts first" select,
   "Acts last" select, "Stack (bb)" input), then a **compact action timeline**
   card: one block per street listing actions with the running pot on the right
   ("BTN raises to 2.5bb · pot 4bb", "BB calls · pot 5.5bb"). The current street's
   block is accent-tinted and says who is to act, the pot and stacks ("Flop · BB
   to act · Pot 5.5bb · Stacks 97.5bb"), with the line "This is the decision
   the solver will work out. Add an action first if you want to solve BTN's reply
   instead." and secondary buttons for the legal actions. This is a restyle of
   `StreetActions` and the `handBuilder` output, not new logic. Hand-history mode
   keeps `parseHandHistoryToPostflopSetup` as it is.
2. **The board.** Five card slots in a row: the dealt cards as white card faces,
   then dashed empty slots labelled "Turn +" / "River +". Clicking a slot opens the
   existing `CardPicker` in a **popover** anchored to the slot, instead of the
   always-visible 52-card grid. Under it: "Or type it" plus the text input (same
   `lib/cards.ts` validation), and the hint "Click a card to change it. 3 cards
   solves the flop, 4 the turn, 5 the river."
3. **Ready to solve.** A card at the bottom of the rail with a checklist (green
   check or empty circle): hand set up, board picked, both ranges loaded. This replaces
   the `missing` bullet list. Then the **primary** button, labelled with what it
   will solve ("Solve BB's flop decision"), and under it "Usually 10–90 seconds.
   This is a real solve, not a lookup."

**Canvas (right):** tabs "Ranges" | "Strategy". Strategy is disabled until a
solve exists ("Strategy · solve first").

- An info strip: "**Ranges are the hands each player could have by now.** We've
  loaded a standard starting point from the preflop action. Click or drag on the
  chart to adjust it." Actions: "Reload from preflop action" (secondary, the
  existing `/spots/preflop-ranges` call) and "Narrow by earlier action" (ghost,
  the existing `/spots/narrow` call, disabled with a tooltip until a closed earlier
  street exists).
- **Auto-load ranges:** when the preflop action is complete and both ranges are
  empty, call the preflop-ranges endpoint automatically. Fall back to the
  existing per-player reference-range load if that endpoint can't serve the pair.
- **One large `RangeGrid`** with player tabs above it (two buttons: "BB's
  range / Acts first · called the open", "BTN's range / Acts last · opened the
  pot"). Toolbar: "Paint with" brush segmented (100/75/50/25%), then ghost
  "Suits", "Reset", "Clear". Below it: "**550** combos · 41.5% of all hands" and a
  legend (Always / Sometimes (fill = how often) / Never), plus a one-line note
  about the active range when one applies (for example "Big hands like AA and KK are
  only partly filled: BB usually re-raises (3-bets) them before the flop…").
- **Side column, "Both players":** one card per player with a mini 13×13
  thumbnail (no labels), % of hands and where the range came from. Clicking a card
  switches the big grid.
- Page header actions: "Start over" (ghost, the current Reset) and "Save spot"
  (secondary; see §7.3).

### 6.2 Solve — result state

**Rail** turns into a summary:

- "The spot" card: board cards, then a 2×2 list (Preflop: "BTN raised, BB called";
  To act: "BB (acts first)"; Pot; Stacks) and an "Edit setup" link that goes back
  to the setup state with everything preserved.
- **Accuracy card**, from `exploitability_pct` and `converged`:
  `< 0.5` → green "Very accurate", `< 1.5` → "Accurate", otherwise or
  `converged === false` → amber "Rough: treat close percentages loosely". Body text:
  "Solved in {N} seconds. A perfect opponent could gain at most {x}% of the pot
  against this strategy." Measure the time client-side. Show `bucketed_actions`
  notes here when present.
- **"Keep exploring"**: secondary buttons with an arrow. Each one appends an
  action and solves again, which the backend already supports through action-prefix
  seeding:
  "What does {IP} do if {OOP} checks?", "What if {OOP} bets small?",
  "Deal a turn card" (opens the turn slot's card picker). Only show the ones that
  are legal from the current node.

**Canvas, Strategy tab:**

- **Headline card:** a large sentence ("BB checks 68% of the time on this flop.") from
  the existing `overallMix`/`formatMix`, and see whether `lib/strategySummary.ts`
  already covers this. Then a one-line plain-English description, then a
  **stacked frequency bar** (34px, one segment per action, using the
  `--strategy-*` colors, labelled inside when wide enough) and a legend with
  percentages.
- **`StrategyGrid`, enlarged** (left, max-width ~620px) with the caption "Each
  square is a starting hand. Its colors show how often BB takes each action with it.
  Faded squares are hands BB rarely has here. Click any square for details." The
  selected cell gets a 3px white outline.
- **Selected-hand panel** (right, ~260px), replacing the current one-line
  `strategy-grid__detail` text: the hand in large type; a **hand category** line
  (see §7.4); "{n} combos in BB's range"; one labelled bar per action with its %;
  an **advice** sentence in a tinted box; and a collapsed `<details>` "Why?".
  Advice rules (frontend only, from the frequencies):
  top ≥ 80% → "Almost always {top}."; top ≥ 50% → "Usually {top}, sometimes
  {second}. Both are fine: the solver mixes on purpose so {opponent} can't
  read your hand."; otherwise → "A close mix. Any of the top plays is fine.
  What matters is not always doing the same thing." The existing suit view
  (`SuitStrategy`) moves into this panel. If the hand isn't in the range, the panel
  says so.

### 6.3 Ranges (new `RangesPage.tsx`, merging Builder / Type in / Import)

**Rail:** "Describe the spot" with a segmented control: Pick | Type it | Hand history
(synced to `?mode=`).

- **Pick:** "Your seat" segmented UTG…BB; "What happened before you" as two
  selectable cards ("Nobody has raised yet: You're first in. Which hands should
  you raise?" / "Someone raised before you: Which hands should continue against
  a single raise?"). Disable the impossible ones (BB can't open; UTG can't face
  an earlier raise). If facing a raise, add "Who raised?" segmented with the earlier
  seats. "Stack size" segmented 40bb / 100bb, with the hint "Charts are available
  for about 40bb and 100bb." This is the `SpotBuilder` logic, re-laid-out.
- **Type it:** the `parseSpotText` input, with the supported phrasings shown as
  clickable example chips (clicking one fills the input and applies it), and a
  green "Understood: {title}" line when it parses. Replaces the "Stage 3 MVP"
  copy.
- **Hand history:** the `parseHandHistory` textarea, "Read hand" (secondary) and
  "Use an example" (ghost). Replaces the "Stage 4 MVP" copy with "PokerStars
  format, 6-max. Paste up to your own decision. We'll work out your seat and
  what happened before you."
- At the bottom of the rail: "The chart on the right updates as soon as you change the
  spot."

**Behavior change:** there's no "Get reference strategy" button. In Pick mode, fetch
the chart automatically whenever the spot changes (debounce about 250ms, and ignore
stale responses). All three modes converge on the same `Spot` via `lib/spot.ts`
and show the same chart panel.

**Canvas:** the title is the spot in words ("BTN opening range", "BB vs a CO raise")
and a muted subline ("Nobody has raised yet · about 100bb · 6-max"), with a
pill on the right: "Standard chart: a starting point, not a live solve". Under it,
the brush toolbar and a large editable `RangeGrid` (max-width ~640px) with
the caption "Pairs run down the middle. Suited hands are above them and offsuit hands below.
Click or drag to add or remove hands." Side column:
- A stats card: "This range", large "40.0%", "of all starting hands · 530
  combos", and "Edited from the standard chart" in accent text once edited.
- A save card: "Save as" name input (defaults to the title, plus " (my version)" if
  edited, plus the stack), primary "Save to Library", and secondary "Solve a flop
  from here →", which opens `/solve` with this player's position and range
  prefilled.
- "Reset to chart" in the toolbar replaces the current button below the grid.

Then delete `BuilderPage.tsx`, `TypeInPage.tsx` and `ImportPage.tsx`, moving their
tests into `RangesPage.test.tsx`.

### 6.4 Library (`SavedSpotsPage.tsx` → `LibraryPage.tsx`)

- Header: "Library" / "Spots you've saved. Only you can see them.", with actions
  "New preflop chart" (secondary → `/ranges`) and "New solve" (primary → `/solve`).
- Toolbar: a search input ("Search by name, seat or board", filtered on the client)
  and a segmented filter All / Preflop / Postflop.
- A **table** in a bordered `--surface` box (with `overflow-x: auto`). Columns:
  Name, Type (a green "Preflop" or amber "Postflop" pill), Players, Stack, Board
  (as text with suit symbols, or "—"), Saved (short date and time), then actions:
  an "Open" link plus icon buttons for Rename and Delete, with `aria-label`s. Clicking a
  name selects the row: tinted background and a 3px accent bar on the left.
- **Preview panel** (right, ~300px): type pill, name, a one-line description, then
  either a mini 13×13 range thumbnail with "% of hands · combos" (preflop), or the
  board cards plus the note "This saves the setup: hand, board and ranges. Solve
  results aren't saved yet. Open it and press Solve to see the strategy again."
  (postflop). Below that, the primary "Open in Ranges" / "Open in Solve" button, then
  Duplicate / Rename / Delete (ghost, with Delete as `.btn-danger`, and a
  confirmation step before deleting).
- Empty state: "No saved spots yet. Save a chart from Ranges or a setup from
  Solve and it'll show up here." Signed-out state: a sign-in prompt.
- Fix the network-error copy: gate the uvicorn hint on `import.meta.env.DEV`, the
  same way `SolvePage` already does.

## 7. Changes beyond the UI

### 7.1 Schema: spot names (`packages/schema`)
- Add `name: str | None = Field(default=None, max_length=120)` to `Spot` in
  `models.py`. Run `pnpm generate` and commit the regenerated TS.
- `apps/api`: add a nullable `name` column to `SpotRow` (`app/db.py`), then
  `alembic revision --autogenerate -m "add spot name"`. Review the migration, then
  `alembic upgrade head`, and check that `alembic check` passes.
- Existing rows have no name. The frontend falls back to today's `summarize()`
  text.

### 7.2 API: rename and delete (`apps/api/app/routes/spots.py`)
- `PATCH /spots/{id}` with body `{ "name": str }` → the updated Spot. 404 if
  the spot doesn't exist **or isn't the caller's** (don't reveal that other
  users' spots exist).
- `DELETE /spots/{id}` → 204. Same ownership rule.
- Both require auth through the existing `current_user_id` dependency. Rows with no
  owner (saved before auth) stay untouchable.
- Tests next to the existing persistence tests: own spot, someone else's spot,
  unowned row, missing id. Run them against **local Postgres**, never Supabase
  (see CLAUDE.md).
- `apps/web/src/lib/api.ts`: add `renameSpot(id, name)` and `deleteSpot(id)`,
  following the never-throws result-`kind` pattern.

### 7.3 Opening and saving spots (frontend)
- **Open:** `GET /spots` already returns full `Spot`s, ranges included. Pass the
  chosen spot to `/ranges` or `/solve` (route state, or `?spot={id}` with a lookup
  from the cached list) and hydrate the page from it. Preflop spots open in
  Ranges; spots with a board open in Solve's setup state.
- **Save from Solve:** add "Save spot" to Solve. It saves the setup (positions,
  stack, pot, board, actions, both ranges, name) through the existing `POST /spots`.
  No solve result is saved. That's a separate, later piece of work (it needs
  storage for the strategy payload), so don't build it now.
- **Duplicate:** client-side. `POST` a copy with a new id and "(copy)" added to the name.

### 7.4 Hand category labels for the Solve result panel
The result panel shows a category like "Top pair, strong kicker" or "Flush
draw". `apps/api/app/drill_analysis.py` already classifies hands and boards for
the Drill deck. Preferred approach: have `POST /spots/solve` return a
`hand_categories: dict[str, str]` (169-type → label) computed with that
classifier, so web and Drill share one source of truth. Add it as an optional
response field, and normalize it in `solveSpot` the same way as the other
optional fields (see the "black screen" entry in `docs/decisions.md`), so an
older deployed backend can't crash the page. If it's missing, the panel just
leaves out the category line.
The "Why?" text can reuse the same rule-based reasoning the Drill uses. It must
say that the reasoning is a rule of thumb and the percentages come from the solve,
matching the Drill's honesty note. If this is too much for the phase, ship
the panel without "Why?" first.

### 7.5 Cleanup
- Remove all user-facing "Stage N MVP" copy.
- Gate every dev-only hint on `import.meta.env.DEV`.
- Update CLAUDE.md (routes, screens, new endpoints, the `name` field) and add a
  dated entry to `docs/decisions.md` for the IA merge and the Library API.

## 8. Phases (one PR each, in order)

1. **Foundation:** desktop media query scaffolding, the button and segmented
   classes, new tokens, copy cleanup (§7.5), and the DEV-gate fix. No layout change yet.
2. **Shell + routes:** the sidebar on desktop, the new routes and redirects (§3),
   and `AuthStatus` moved to the sidebar. The old pages still render inside the new shell.
3. **Ranges:** the merged `RangesPage` (§6.3) with auto-fetch, and the old pages deleted.
4. **Solve:** the two-pane setup and result states (§6.1, §6.2), board slots with
   the popover picker, the accuracy card, Keep exploring, and Save from Solve.
5. **Library + API:** schema `name`, migration, PATCH/DELETE, `api.ts` helpers,
   and `LibraryPage` with open, rename, delete and duplicate (§6.4, §7.1–7.3).
6. **Hand categories:** `hand_categories` on the solve response and the "Why?" panel
   (§7.4).

After each phase: `pnpm --filter web build`, `pnpm --filter web lint`,
`pnpm --filter web test`, and `pytest` for any phase that touches `apps/api`. Also
check that a ~390px-wide viewport looks the same as before the change, except for the
agreed nav change in §3.
