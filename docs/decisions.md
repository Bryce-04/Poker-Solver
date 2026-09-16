# Decision log

Short, dated records of choices that aren't obvious from the code. Newest
first. Status is **proposed** until the team ratifies (a 👍 in the channel
or a review approval is enough); flip to **accepted** then.

---

## 2026-09-15 — Saved spots built against a guessed apps/api contract

**Status:** accepted — confirmed 2026-09-16, `apps/api`'s `POST`/`GET
/spots` (see `app/routes/spots.py`) match this contract exactly: `POST`
echoes the full saved `Spot` with server-assigned `id`/`created_at`, `GET`
returns a bare array. `api.ts` needs no changes.

**Context.** The frontend's saved-spots screen (`SavedSpotsPage`, and
`SpotBuilder`'s "Save this spot" button) was built before `apps/api`
shipped `POST`/`GET /spots`, to avoid idling on that lane. `api.ts`'s
`saveSpot`/`listSpots` assume `POST /spots` echoes back the full saved
`Spot` (server-assigned `id`/`created_at`) and `GET /spots` returns a bare
JSON array.

**Decision.** Ship the frontend against that assumed contract now. Treat a
404 as a normal, already-styled "not live yet" outcome, not an error to
special-case later. Confirm the real response shapes once `apps/api` ships
the routes and adjust `SaveSpotResult`/`ListSpotsResult` if they differ.

**Consequences.** Demo-ready without waiting on backend coordination. If
the real contract differs (e.g. `GET /spots` returns a wrapper object
instead of a bare array, or `POST` doesn't echo the saved row), only
`api.ts`'s two functions need to change — `SavedSpotsPage` and the save
button consume the typed result, not the raw response shape.

---

## 2026-09-15 — BrowserRouter lives inside App.tsx, not main.tsx

**Status:** proposed

**Context.** Adding routing (Builder / Saved / Type in) needed a router
provider somewhere. `App.test.tsx`'s existing smoke tests render bare
`<App />` with no wrapper, and changing that contract would mean touching
every test that renders `App`.

**Decision.** Nest `<BrowserRouter>` inside `App.tsx` itself rather than
wrapping `<App />` in `main.tsx`. `App.tsx` becomes the full router shell
(header, nav, routes); `render(<App />)` in tests needs no extra wrapper.

**Consequences.** `main.tsx` stays a one-line mount. A second
router-dependent entry point (not a concern at this app's current scope)
would need `BrowserRouter` lifted back out to a shared ancestor.

---

## 2026-09-09 — Board card picker is out of Stage 2

**Status:** proposed

**Context.** The spot builder scaffold has a TODO for a board (flop/turn/
river) card picker. Stage 2's only output is preflop reference charts, and
`find_matching_chart` returns nothing for any non-preflop street. Nothing
in Stage 2 consumes a board.

**Decision.** Do not build the board picker in Stage 2. Remove the TODO
from `SpotBuilder.tsx` or re-file it against Stage 5 (postflop solving),
which is the first thing that needs a board.

**Consequences.** `Spot.board` stays at its schema default (empty list).
The builder is preflop-only for Stage 2, which matches the reference-chart
scope exactly.

---

## 2026-09-09 — Defend charts stay a combined call-or-3bet range

**Status:** proposed

**Context.** `HandRange` maps each hand to a single weight, so a "defend
vs an open" chart can't express "call 60% / 3bet 15%" as two numbers. The
plan defers a real call/3bet split to Stage 5's live solve.

**Decision.** Stage 2 defend charts represent the whole **continuing**
range (call or 3bet, combined). No schema change. The frontend labels
these results *"Continuing range (call or 3-bet) — reference chart, not a
solve."*

**Consequences.** Users see which hands keep playing versus an open, but
not the action split. Revisit at Stage 5, when the solver produces real
per-action frequencies. See `docs/reference-chart-coverage.md`.
