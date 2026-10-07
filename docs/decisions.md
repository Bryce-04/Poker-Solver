# Decision log

Short, dated records of choices that aren't obvious from the code. Newest
first. Status is **proposed** until the team ratifies (a 👍 in the channel
or a review approval is enough); flip to **accepted** then.

---

## 2026-10-06 — SolvePage's board input is a validated text field, not a visual picker yet

**Status:** accepted

**Context.** Stage 5's `SolvePage` (`apps/web/src/pages/SolvePage.tsx`) is
the first screen that needs a board at all — the 2026-09-09 "board card
picker is out of Stage 2" entry re-filed this exact question against
Stage 5. Two ways to let someone enter 3-5 cards: a visual rank/suit
click-grid (closer to this app's "ease of use" pitch and to what that
older entry's wording implied), or a validated text field (type
`"Ks Qh 9d"`, parsed against the schema's card notation).

**Decision.** Text field for v1 (`lib/cards.ts`'s `parseBoardText`) —
confirmed with the project owner, who wants a visual picker eventually
but agreed a validated text field is enough to get the Solve screen
working end to end now. Much less to build than a click-grid, and
matches this app's existing precedent of a "type it in" entry path
(Stage 3's `parseSpotText.ts`).

**Consequences.** A visual rank/suit picker remains a real, wanted
follow-up, not a closed question — re-file it as its own entry when it's
actually built rather than treating this one as having answered it.

**Resolved 2026-10-07:** shipped as `components/CardPicker/CardPicker.tsx`
— an *additional* input mode (a radio toggle next to the existing text
field), not a replacement, matching the "wants both eventually" framing
above. Both modes validate down to the same `ParseBoardResult`
(`parseBoardText`/`lib/cards.ts`'s new `boardFromCards`), so `SolvePage`
has one code path past the board input regardless of which mode filled
it in.

---

## 2026-10-06 — POST /spots/solve: a new Spot convention, not a schema change; sync, not a job queue

**Status:** proposed

**Context.** First real wiring from `apps/api` to `services/solver`. Two
things came up while designing it that aren't obvious from the route code
alone.

**Decision 1 -- Spot convention, not a schema change.** Every entry path
shipped so far (`apps/web/src/lib/spot.ts`) only ever populates ONE entry
in `positions_in_hand`/`ranges` (hero's). A solve needs both players'
ranges. `Spot` already allows two entries in both fields -- nothing
there's used it yet -- so rather than changing the schema, this route
just defines the convention explicitly: `positions_in_hand` must have
exactly 2 entries, **index 0 is out-of-position/first-to-act this
street, index 1 is in position**, and `ranges` must have an entry for
both. Mid-street solving is out of scope for now too: `current_street`'s
`actions` must be empty or exactly one check from `positions_in_hand[0]`
-- anything else 422s with a specific message rather than guessing,
partly because reverse-mapping an arbitrary recorded bet size onto the
engine's fixed 33/66/100%-pot menu isn't always a clean mapping anyway.

**Decision 2 -- synchronous route, not a job queue.** A solve takes
several seconds (~3,000 iterations/sec measured earlier). The route runs
it synchronously in a plain `def` handler (FastAPI runs those in its
thread pool, same style as every other route here) rather than an
async job-and-poll pattern. `DEFAULT_ITERATIONS = 8_000` (`apps/api/app/
solve.py`) is a provisional number, not derived from a latency budget.

**Consequences.** No frontend consumes this yet. Revisit the iteration
count and the sync-vs-async call once this has real traffic to time
against -- not something to build speculatively ahead of that. The
per-action-frequency response (`services/solver`'s new
`aggregate_label_strategies`) answers only the ONE decision point implied
by the request, not the whole downstream tree (mirrors how
`/spots/reference-strategy` already only ever answers for one position).

---

## 2026-10-06 — Solver modules renamed river_* -> generalized names when flop/turn landed

**Status:** accepted

**Context.** `river_game.py`/`river_mccfr.py` (and their `River*` classes)
were named for the river-only MVP. Adding flop/turn support turned out to
need almost no changes to the betting-logic module — it was already
card-agnostic, pure pot/action bookkeeping — which meant the "river"
naming no longer described what the code did or didn't know about.

**Decision.** Renamed `river_game.py` -> `betting_round.py`
(`RiverState` -> `BettingRoundState`) and `river_mccfr.py` ->
`postflop_mccfr.py` (`RiverSpotConfig`/`RiverMccfrTrainer` ->
`PostflopSpotConfig`/`PostflopMccfrTrainer`), done immediately rather
than deferred, since nothing outside `services/solver` depended on the
old names yet (no `apps/api` route, no frontend) — the rename was fully
contained and cheap before that stopped being true.

**Consequences.** `PostflopSpotConfig.board` now accepts 3 (flop), 4
(turn), or 5 (river) cards; `PostflopMccfrTrainer.train` samples a board
runout (`combos.py`'s new `deal_runout`) alongside hole cards when the
board isn't already complete. See `services/solver/README.md` for why
this came out as a small addition rather than a rewrite, and for the
testing wrinkle it introduced: a runout-dependent equilibrium is much
harder to hand-verify in closed form than the river case (the opponent's
own hand strength also varies by runout), so the flop/turn regression
tests check one-sided dominance on a *locked* hand instead (same style as
`kuhn_spike.py`'s own non-unique-equilibrium test), and the real rigor
for the runout-sampling mechanism itself lives in a separate exact-vs-
Monte-Carlo equity test (`test_runout_equity.py`).

---

## 2026-10-06 — /spots requires sign-in, scoped per user; the spots table moves to Alembic

**Status:** proposed

**Context.** Stage 6's backend half: `GET /spots` returned every row to
everyone. Making it per-user needed a real `created_by` column on
`SpotRow` -- the first schema change since persistence shipped -- and
`Base.metadata.create_all` never adds a column to a table that already
exists, so it couldn't carry that change to the deployed Supabase database.

**Decision.**
- `POST` and `GET /spots` both require `Authorization: Bearer <Supabase
  access token>`; missing or invalid is a 401. `/spots/reference-strategy`
  and `/health` stay open. Verification (`apps/api/app/auth.py`) checks the
  signature against the project's public JWKS keys (ES256 -- no shared
  secret, only `SUPABASE_URL`), plus expiry, `aud = "authenticated"`, and
  the project's issuer. Supabase being unreachable is a 503, not a 401.
- `created_by` is always the token's user id, never the request body;
  `GET /spots` filters on it.
- The 3 rows saved before auth have no owner. They're left in place, not
  deleted or backfilled -- listed for no one.
- The `spots` table is managed by Alembic (`apps/api/migrations`).
  `0001` is a baseline that skips creation if the table exists, so the
  deployed database is adopted without a manual `alembic stamp`. Deploys
  run `alembic upgrade head` before uvicorn starts.

**Consequences.** Saved spots are actually private now. A signed-out
`SavedSpotsPage` shows only its sign-in notice instead of fetching.
Render needs `SUPABASE_URL` set (see `render.yaml`) or `/spots` requests
fail. Future `spots` schema changes are Alembic revisions, not model edits
alone.

---

## 2026-09-30 — Frontend sends Authorization: Bearer &lt;Supabase JWT&gt; ahead of backend enforcement

**Status:** accepted — confirmed 2026-10-06: `apps/api` reads exactly this
header and verifies it as a Supabase access token (see the 2026-10-06
entry above); a real sign-in → save → list round trip worked unchanged, no
`authHeaders()` change needed.

**Context.** Stage 6 auth UI (Supabase email/password sign-in, `apps/web`
only) ships before the backend lane's JWT verification lands in
`apps/api`. `lib/api.ts`'s `saveSpot`/`listSpots` now attach
`Authorization: Bearer <token>` (from `supabase.auth.getSession()`) to
every request where a session exists, assuming the backend will read a
standard `Bearer` token from that header and validate it as a Supabase
JWT.

**Decision.** Ship the header now regardless of whether `apps/api` checks
it yet -- it doesn't, today. Omit the header silently when there's no
session rather than blocking the request client-side in `api.ts` (a
separate, UI-level "sign in to save spots" gate exists in `SpotBuilder`/
`TypeInPage` for that). Treat a future 401 as the existing
`{ kind: "error", status: 401 }` outcome, not a special case.

**Consequences.** Unblocks the frontend auth lane without waiting on
backend coordination. If the header name/scheme assumption turns out
wrong (e.g. the backend expects a cookie, a different header, or a
different token audience/claims shape), only `lib/api.ts`'s
`authHeaders()` helper needs to change -- callers already consume the
typed `Result` union, not raw headers. Also unresolved until the backend
lane lands: `GET /spots` still returns every row unfiltered, so saved
spots aren't actually private yet regardless of this header (see
`SavedSpotsPage`'s signed-out notice). Flip Status to
`accepted — confirmed <date>, ...` once the backend lane's JWT
verification ships and the contract is confirmed either way.

---

## 2026-09-30 — Stage 5's solver starts river-only, with a hand-written evaluator

**Status:** accepted

**Context.** Stage 5's locked scope (`docs/plan.md`) is "one postflop
street" generically — that covers a spot starting on the flop, turn, or
river. Going to showdown from the flop or turn needs the rest of the board
dealt out (a runout) before a hand can be evaluated at all; the river
needs none, since the board's already complete. Separately, ranking a
hand at showdown needs some evaluator — write one, or take a small
well-tested dependency (e.g. `treys`).

**Decision.** Build river-only first (`services/solver/src/poker_solver/
river_mccfr.py` + `river_game.py`), with no runout logic. Write the hand
evaluator from scratch (`evaluator.py`) rather than pulling in a
third-party one — for a class project, a self-contained, independently
unit-tested piece we wrote and understand end to end beats a dependency
doing a core piece of the solver's correctness for us.

**Consequences.** Flop/turn spots aren't solvable yet — they need Monte
Carlo runout sampling layered on top of the range sampling this already
does, which is real follow-up work, not a small extension. The engine is
verified against a closed-form poker-theory result (a polarized-range-
vs-bluffcatcher river spot), not just "did it run" — see
`services/solver/README.md` for the one payoff-arithmetic subtlety (the
dead pot must be in the winner's share on a fold, not just the folder's
own street contribution) that a naive implementation would get wrong
while still silently "converging" to the wrong equilibrium.

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

**Resolved 2026-10-06:** Stage 5's `SolvePage` is the screen this was
re-filed against — see that date's entry below for what actually shipped
(a validated text field, not yet the visual picker this entry's wording
implied).

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
