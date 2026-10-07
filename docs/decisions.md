# Decision log

Short, dated records of choices that aren't obvious from the code. Newest
first. Status is **proposed** until the team ratifies (a 👍 in the channel
or a review approval is enough); flip to **accepted** then.

---

## 2026-10-07 — The solver is now range-vs-range Discounted CFR with exact equity; the Monte-Carlo trainer was producing noise

**Status:** accepted — shipped 2026-10-07.

**Context.** A real solve on a physical device (BB vs BTN, 4bb pot, 96bb
stacks, flop) reported BB jamming ~85% of the time — absurd. Reproduced
locally with the same reference-chart ranges (BB's 85-label defend range,
BTN's 82-label open range — ~500 concrete combos each) and measured, not
guessed: at the production setting (`DEFAULT_ITERATIONS = 4000`),
`postflop_mccfr.py` reported AA jamming 70%, J9s 84%, K6s 8%. Raising
iterations moved those toward sane values (K6s: 8.1% → 1.4% → 0.3% at
4k/40k/200k) but still hadn't converged at 200k (7.5 min locally). A
narrow, fully-converged control (overpair + air vs. a villain who never
folds → correctly ~99% check) proved the betting/payoff math was right:
the cause was the trainer sampling *one* hole-card combo per player per
iteration, so each of ~500 combos was only visited on the rare
iterations chance picked it — at 4,000 iterations, a handful of visits
each, far too few for regret matching to settle. No iteration count both
fixed that and stayed fast.

**Decision.** Replace Monte-Carlo hole-card sampling with the standard
range-vs-range approach every serious open-source solver uses (checked:
TexasSolver, opensolver, the DCFR paper):
- `services/solver/src/poker_solver/equity.py` (new) precomputes an exact
  hero-combo × villain-combo equity matrix per board — every runout
  enumerated (990 on the flop, 44 on the turn), never sampled. Sampling
  was tried and rejected on measured error (~4% worst-hand equity error
  vs the whole opposing range even at 500 runouts — shared runouts don't
  average out). Shared-card pairs are NaN, never 0.
- `evaluator.py` gained `evaluate_seven` (single-pass 7-card) and
  `evaluate_seven_batch` (numpy, a whole range at once, packed-int
  scores) — cross-checked for exact equality against the brute-force
  `evaluate_best` on every category's edge cases plus 18,000+ random
  hands. Took the exact flop matrix from impractical to ~2s.
- `range_cfr.py` (new) trains every combo of both ranges at every node on
  every iteration, weighted by reach probability, with terminal values
  from the equity matrix. **Discounted CFR** (alpha 1.5, beta 0, gamma 2)
  rather than the CFR+ the plan specified: measured head to head on the
  bug scenario, DCFR reached 1.1% of the pot in exploitability at 100
  iterations (CFR+: 2.4%) and 0.35% at 200 (CFR+: 1.2%).
- `apps/api/app/solve.py` trains until exploitability is under 0.5% of
  the pot (`TARGET_EXPLOITABILITY_PCT`), checked every 25 iterations,
  capped at 250 (`MAX_ITERATIONS`) — replacing `DEFAULT_ITERATIONS`.
  Iteration-based, not wall-clock, so results reproduce across machines.
  The response now carries `exploitability_pct`, shown on `SolvePage`.

**Results, same scenario.** AA jam 70% → 0.6%, J9s 84% → 0%, K6s 8% → 0%;
AA now plays a sensible mixed strategy (check 31%, bet small/medium/large
16/28/24%). Closed-form river theory (33 bluff-shoves 20%, KJo calls
80%) is hit to within 0.2% at 100 iterations; the old trainer needed
20,000 and a ±5% test tolerance. Local time to 0.5% of the pot with
those wide ranges: deep flop ~12s, two-tone flop ~8s, turn ~4s, river
~2s (old trainer: ~9s on every street, for noise).

**Also found and fixed along the way:** `BettingRoundState.initial`
recorded a seeded `prior_history` without applying it, so since the
generalized-seeding change (entry below) a solve started after a seeded
*bet* had wrong pot math — calling it cost nothing. It now replays the
history (`test_betting_round.py`'s seeded-bet regression tests).

**Consequences.** `postflop_mccfr.py` (and `kuhn_spike.py`) are no
longer used by `apps/api` — kept intact as a known-good reference for
now, real deletion candidates. Render's CPU is still much slower than a
laptop, so a wide-range deep flop can still take a while on the phone;
that's now a hosting limit on a correct answer, not an algorithm
producing a wrong one. If it's still too slow after deploying, profile
first: terminal matrix-vector products are ~half of training time
(memory-bound), and batching an opponent node's terminal children into
one matrix product is the next optimization; Rust (per `CLAUDE.md`'s
escape hatch) only after that, on profiling evidence.

---

## 2026-10-07 — BUG (fixed): a slow solve on the phone eventually blacked out the whole screen

**Status:** fixed 2026-10-07 — root cause confirmed, see "Resolved" below.

**Symptom, as reported.** On a physical Android device, running a solve
via the new click-through builder: the solve "was taking a while" (the
already-known phone/Render slowness below), and **eventually the whole
screen turned black and never showed the solve result** — not a
graceful error message, an actual blank/black render with nothing to
interact with. Separately but possibly related: solves on the phone are
still taking 1+ minutes, "not even a remotely quick solve."

**On the speed complaint — not new, still unresolved.** This is the
same issue tracked in this file's 2026-10-07 `DEFAULT_ITERATIONS`
entry and the session that produced it: Render hosting measured ~14x
slower than local dev hardware for a solve, and the user explicitly
declined the one free algorithmic lever (lowering `MAX_AGGRESSIVE_ACTIONS`)
because it conflicts with wanting the solver to eventually cover more
than single-raised pots. Nothing about today's click-through-builder
work changes solve cost — confirming it's still slow on the phone isn't
a regression, just a reminder this is still genuinely unsolved.

**On the black screen — root cause not confirmed, but one concrete,
verified gap found while documenting this.** `apps/web/src/lib/api.ts`'s
`solveSpot` on **this branch (`handhistory-to-solve`) has no explicit
`connectTimeout`/`readTimeout`** on its `CapacitorHttp.request` call —
confirmed by reading the file directly. The fix for exactly that gap
already exists, written and tested, on a **separate, unmerged branch**:
`fix-solve-client-timeout` (commit `c0217e9`, "solveSpot: set an
explicit client-side timeout long enough for a real solve" —
`connectTimeout: 20_000`, `readTimeout: 150_000`), reported in an
earlier session as giving a premature "Couldn't reach the API" without
it. That branch was never merged before `handhistory-to-solve` was cut,
so today's branch regressed back to having no explicit timeout at all.
**This should be merged in regardless** — it's a real, already-diagnosed
gap — but it may not fully explain *this* symptom: that earlier bug
was a fast, clean failure (a prompt "network-error" message) from a
timeout that fired too *early*, not a long hang ending in a blank
screen with no error shown at all. Worth checking tomorrow whether
merging it changes anything about the black-screen case specifically,
rather than assuming it's the same bug.

**Other hypotheses for the black screen itself, untested, worth
checking before writing a fix:**
- **No React error boundary exists anywhere in this app** (confirmed by
  inspection — grep for "componentDidCatch"/"ErrorBoundary" turns up
  nothing). If anything throws while rendering the solved result (e.g.
  `StrategyGrid`, or the new `bucketed_actions` list in `SolvePage.tsx`,
  hitting an unexpected shape in a very-late response), React unmounts
  the tree with no fallback UI — which would plausibly look exactly like
  "the whole screen turned black" against this app's dark theme, and
  would explain "never showed me the solve" (data came back, something
  broke rendering it) rather than a transport failure. Check `adb
  logcat` captured at the time of a repro for a JS exception/stack
  trace — that would confirm or rule this out directly.
- The phone's screen locking/timing out during a 60s+ wait, and Android
  suspending or killing the WebView's renderer process in the
  background — also consistent with "turned black," and also checkable
  via `adb logcat` (look for a renderer-process-gone / WebView crash
  line) or by deliberately keeping the screen awake during a repro to
  see if the symptom still occurs.

**Consequences.** Next session: merge `fix-solve-client-timeout` into
`handhistory-to-solve` (or `main`) regardless, since it's a confirmed
real gap either way. Then reproduce the black screen specifically with
`adb logcat` running, to tell these apart rather than guessing — an
uncaught render exception and a killed renderer process need completely
different fixes (an error boundary vs. something about how the long
wait is handled), and treating one as the other would waste a session.

**Resolved 2026-10-07:** the no-error-boundary hypothesis, with an exact
trigger. Timed the deployed API directly with the same wide ranges: the
solve *did* complete (~64s, HTTP 200) — but the live backend's response
had no `bucketed_actions` field, because that `solve.py` change was only
on the local, undeployed branch. The phone's build of `SolvePage.tsx`
unconditionally read `outcome.data.bucketed_actions.length` → TypeError
mid-render → with no error boundary, React unmounted to a blank (dark)
screen. Fixed three ways: `lib/api.ts`'s `solveSpot` normalizes a missing
`bucketed_actions` to `[]` at the one place responses are parsed (a
regression test in `api.test.ts` reproduces the old backend's exact
shape); a new `components/ErrorBoundary` wraps every route in `App.tsx`,
so any future unexpected response shape degrades to a visible "Something
went wrong / Try again" instead of a black screen; and the
`fix-solve-client-timeout` branch's explicit `connectTimeout`/
`readTimeout` was re-applied to `solveSpot` (with a test asserting
both). Confirmed on the device afterward — the next solve rendered a
result. The general lesson, recorded in `LiveSolveResponse`'s comments:
Render deploys separately from the web build, so the frontend has to
tolerate a backend that's behind it.

---

## 2026-10-07 — SolvePage's click-through hand builder: real actions/sizes, not the fixed menu; blinds assumed at 1/0.5

**Status:** accepted — shipped 2026-10-07.

**Context.** The user's own words: "I think we need to add functionality
ui wise that splits the different streets, also the pot size being auto
to 100 makes no sense along with the stack behind being 33 we need to
change those values and allow the bet size from the raiser and the call
to be auto added along with the blinds assuming they are 1/2 for now...
I think we should be able to click through the hand to get where we want
then solve when we so desire." The previous `SolvePage` had one flat
form: a single "already checked" checkbox plus typed-in `pot_bb=100`/
`effective_stack_bb=33` defaults with no connection to any real action.
Directly unblocked by the same day's other entry (seeding a solve from
any non-terminal action prefix, not just a check) — the builder needs
that generalized contract to be useful for anything beyond a single
check.

**Decision 1 — real actions, not the engine's fixed menu, during
setup.** `lib/handBuilder.ts`'s `BuilderAction` records real bb sizes
("raises to X" total-this-street semantics, matching
`parseHandHistory.ts`'s existing SET-not-ADD convention) rather than
`bet_small`/`bet_medium`/`bet_large`/`all_in`. Only the *target* street
(wherever "Solve" would act) gets submitted to `/spots/solve` at all —
`apps/api/app/solve.py` already only reads `current_street`'s entries,
so earlier streets' actions exist purely for this screen's own pot/stack
bookkeeping and never leave the browser. The backend's own bucketing
(the other 2026-10-07 entry) is what approximates a real size onto the
fixed menu at solve time, disclosed via the response — the builder
doesn't duplicate that logic.

**Decision 2 — preflop is heads-up-simplified, not 6-max-accurate.**
Modeled as exactly the two chosen positions, OOP posting 1bb (acts last
preflop, first postflop) and IP posting 0.5bb (acts first preflop, last
postflop) — the same heads-up relationship real two-handed poker has,
reused rather than inventing a separate "who's SB" picker. This sidesteps
genuinely modeling 6-max preflop action order for an arbitrary 2-of-6
position pair, which the user's own "assume blinds are 1/2 for now"
framing explicitly invited as a simplification. One real rule
preserved: the small blind completing (calling) does not close
preflop action — the big blind still gets an option (check, closing, or
raise) — `computeStreetState`'s `isCompletingBlindCall` case, covered by
`handBuilder.test.ts`.

**Decision 3 — gate progression on closing, not on card count alone.**
Picking board cards (unchanged `CardPicker`/text toggle) only *requests*
how far to walk; `summarizeHand` actually stops at the first earlier
street that folded or never closed, and that's what the UI keys "which
street is live" off of (`components/StreetActions/StreetActions.tsx`
renders the stopped-at street live, closed-and-passed streets as plain
history, and shows one blocked message for the very next street rather
than hiding everything). A fold on any street ends the hand outright —
no later section renders, and "Solve" stays disabled.

**Consequences.** Two setup modes now coexist on `SolvePage`: "Click
through the hand" (new, now the default) and "From a hand history"
(unchanged, the pre-existing paste shortcut) — kept as genuinely
separate state rather than merged into one model, since a pasted hand
history already tells you pot/stack/board directly and re-deriving that
through a click-by-click replay would be pure overhead. No legality
engine beyond turn-order and street-closing rules enforced client-side
(e.g. no min-raise checking) — the backend's own `_replay_street_actions`
remains the final authority on whether a submitted action is actually
legal, same as it would be for a pasted hand history.

---

## 2026-10-07 — Bet-size menu resize, and letting a solve start from any point (not just a check)

**Status:** accepted — shipped 2026-10-07, both decisions below.

**Context.** Real device testing of `SolvePage` surfaced two concrete
complaints. First, the locked bet-size menu (check / 33%/66%/100% pot /
all-in — see the 2026-09-30 entry below) reads as arbitrary and was
explicitly rejected ("that stupid thing it is at"). Second, `solve.py`'s
seed contract — `current_street.actions` must be empty or exactly one
check from `positions_in_hand[0]` — only lets a solve start on an
untouched street, which blocks the real target: a click-through hand
builder where you walk through actual betting (including bets/raises)
and can solve from wherever you stop. Both are needed together: the
builder needs an arbitrary seed point to be useful, and bucketing a real
bet size onto 33/66/100 was already an awkward three-way split — a
cleaner, more legible menu matters more once real bets start getting
bucketed onto it instead of just a single opening check.

**Decision 1 — new menu.** `services/solver/src/poker_solver/
betting_round.py`'s `BET_SIZE_MENU` changes from `(0.33,"b33"),
(0.66,"b66"),(1.0,"b100")` to `(0.25,"bet_small"),(0.75,"bet_medium"),
(1.25,"bet_large")` (plus the existing `"all_in"`). Descriptive labels,
not percentage codes, since they're user-facing now (the hand builder,
`StrategyGrid`'s legend). `legal_actions`/`apply` already read the menu
generically (`for frac, label in BET_SIZE_MENU`) — the engine itself
needs exactly one constant changed. Ripples: `test_betting_round.py`'s
and `test_postflop_mccfr.py`'s menu-collapse tests are tuned to the old
numbers (e.g. `effective_stack_bb=33` chosen because 33%-pot exactly
equalled the stack — redo with `effective_stack_bb=25` for the same
trick against `bet_small`, and recompute the closed-form β*/c* for the
new shove size); `StrategyGrid.tsx`'s `ACTION_ORDER`/`ACTION_COLOR_VAR`/
`ACTION_LABEL` maps (keyed `b33`/`b66`/`b100` today); every doc naming
"33%/66%/100% pot" as the locked menu (`CLAUDE.md`, root `README.md`,
`docs/plan.md`, `services/solver/README.md`, `solve.py`'s own
docstring).

**Decision 2 — generalize the seed contract.** Replace the "empty or one
check" special case in `apps/api/app/solve.py`'s `build_solve_config`
with: replay the *entire* `current_street.actions` list through
`BettingRoundState` (already a pure state machine), mapping each
recorded `BettingAction` to one of the engine's own labels — check/call/
fold map directly, a bet/raise/all-in gets bucketed to the menu entry
numerically closest to `size_bb` (or `size_pct_pot × pot-before`) as a
fraction of the pot right before that action, or forced to `"all_in"` if
it's within float tolerance of the acting player's remaining stack.
Reject (422, same `InvalidSolveRequest` path) if an action is out of
turn, isn't legal at that point, or if the replayed sequence is already
terminal (fold, or the street's action is closed — nothing left to
solve). This *subsumes* the old empty/one-check cases as the smallest
possible prefixes, so no separate special-casing survives. The response
gains a note on which actions got bucketed and to what (e.g. "BTN's bet
→ bet_large, closest to 125% pot") — the approximation is disclosed, not
silent, matching this project's established convention (same spirit as
`StrategyGrid`'s neutral-cell-for-missing-data choice, the 2026-10-07
entry below).

**Consequences.** This was backend-only and independently testable (same
no-UI-needed approach `solve.py` was originally verified with) —
deliberately scoped apart from the click-through builder UI itself,
which is a real UI project in its own right and is now the active,
separate pass. That UI will additionally need: preflop support for
multiple raises (3-bet/4-bet), not just one raise/one call, and
`pot_bb`/`effective_stack_bb` computed from actual entered actions plus
flat 1/2 blinds instead of typed in (today's `SolvePage` defaults —
`pot_bb=100`, `effective_stack_bb=33` as bare `useState` initial values
with no derivation — are being removed as part of that follow-up, not
this one).

**Resolved 2026-10-07:** shipped. `BET_SIZE_MENU` resized (one line in
`betting_round.py`), `solve.py` gained `_replay_street_actions`/
`_bucket_bet_action` and a `bucketed_actions` list in the response
(threaded into `apps/web/src/lib/api.ts`'s `LiveSolveResponse`),
`StrategyGrid.tsx`'s label maps renamed, both solver test files'
closed-form numbers recomputed (shove=25 instead of 33, since 25%-pot
now collapses the menu the same way 33%-pot used to), and 5 new cases
added to `apps/api/tests/test_solve_route.py` (seeded bet, out-of-turn,
already-terminal, a 2-action bet+raise prefix, missing size). Verified:
`pytest services/solver` (55 passed), the web suite (146 passed), lint,
and build all green; `solve.py`'s own logic was additionally exercised
directly (calling `build_solve_config` with no FastAPI/DB involved)
since this environment had no reachable Postgres to run `pytest
apps/api`'s session-scoped migration fixture — that route-level run is
still owed for real confirmation.

---

## 2026-10-07 — Hand-history fast-forward instead of real multi-street solving

**Status:** accepted

**Context.** Confirmed with the user: real multi-street solving (one tree
connecting flop→turn→river decisions, not one isolated street) is out of
scope. It's a combinatorial-blowup problem, not just a slower version of
what exists — a single wide-range *street* already creates ~42,000 info
sets and strains the current engine (see the 2026-10-07
`DEFAULT_ITERATIONS` entry); a full 3-street tree means solving a
turn-sized problem for every non-fold way the flop could end, then a
river-sized problem for every non-fold way the turn could end.
Real solvers handle this with card abstraction (bucketing similar hands
to shrink the tree) — genuine research-level engineering, not a
reasonable scope addition here. But the underlying need was real: getting
to "the river decision in this hand" shouldn't require manually
re-solving every earlier street by hand.

**Decision.** `lib/parseHandHistory.ts` gains a second entry point,
`parseHandHistoryToPostflopSetup`, alongside the original Stage 4
`parseHandHistory` (unchanged, still backs `ImportPage`). It fast-forwards
through every street present in a pasted hand history and hands
`SolvePage` the board/pot/effective-stack/OOP-IP/already-checked state at
wherever the paste stops — reading what already happened, not
solving/computing it, which is a fundamentally cheaper problem than
multi-street solving and doesn't touch the engine at all. Deliberately
does not return ranges (a hand history doesn't reveal villain's actual
holdings) — those still come from the existing reference-range buttons or
manual painting. Honest-refusal on anything that doesn't fit cleanly
(doesn't reach the flop, more than 2 players still live, the target
street already has betting past a single opening check), same convention
the original parser already uses.

**Consequences.** This is explicitly additive, not a step toward or away
from real multi-street solving — if that gets built later, nothing here
needs to be reworked; it shares no code with the betting-engine side
(`services/solver`) at all. Scope boundaries worth knowing: antes are
folded into the pot total like any other contribution rather than
modeled specially; side-pot math from unequal-stack all-ins isn't
modeled precisely (the existing single-symmetric-effective-stack
simplification is used regardless); run-it-twice and straddles aren't
recognized.

---

## 2026-10-07 — Solve results are a 13×13 color chart, not a table; per-hand precision flagged as unverified at current sample sizes

**Status:** accepted

**Context.** The original results display was a scrolling HTML table
(one row per hand, one column per action) -- unreadable at a glance, and
nothing like how real solvers present a range. Separately, a specific
number surfaced during testing (a wide-range BB spot showing a bottom-
range hand jamming ~25% on a dry ace-high board) read as implausible.

**Decision 1 -- chart, not table.** New `components/StrategyGrid/`
(`apps/web/README.md`'s `## SolvePage` section has the full design):
a 13x13 grid reusing `RangeGrid.css`'s classes directly, each cell a
left-to-right gradient of that hand's action mix, built from a new
palette of theme-aware CSS custom properties (`--strategy-*`, `index.css`)
rather than hardcoded hex. Modeled on a GTO-trainer-style reference image
the project owner shared, adapted to this app's own palette rather than
copied directly.

**Decision 2 -- name the precision gap instead of papering over it.**
Investigated the implausible-looking number rather than just reassuring
that it's fine: the CFR algorithm itself is validated (closed-form
regression tests in `services/solver`), but a wide range creates tens of
thousands of distinct info-sets (see the 2026-10-07 `DEFAULT_ITERATIONS`
entry) against only a few thousand total iterations -- individual fringe
combos can be reporting a frequency built on a handful of samples, not a
converged value. `StrategyGrid` renders a hand missing from the response
(never sampled enough for `aggregate_label_strategies` to report it) as a
visibly flat neutral cell rather than a color, so the gap is visible
rather than hidden, and `apps/web/README.md` now states this limitation
directly instead of implying every displayed number is trustworthy.

**Consequences.** No code fix for the precision issue itself yet --
that needs either more iterations (slower), a smarter sampling scheme, or
labeling low-sample-count cells distinctly from well-sampled ones (not
done: the response doesn't currently carry a per-hand sample count to
render that distinction). Worth a follow-up if wide-range solves are a
primary use case rather than an edge case.

**Resolved 2026-10-07:** the implausible number was real noise, and the
precision gap is now closed at the root rather than labeled — see the
"range-vs-range Discounted CFR" entry at the top. Every combo is trained
on every iteration (no sampling, so no thin cells), and the response
carries a real global precision measure (`exploitability_pct`) instead
of a per-hand sample count.

---

## 2026-10-07 — DEFAULT_ITERATIONS halved to 4,000; real timing logged instead of guessed at

**Status:** superseded 2026-10-07 — `DEFAULT_ITERATIONS` no longer exists;
`solve.py` now trains to an exploitability target with the range-vs-range
trainer (see the entry at the top). Halving iterations here made solves
faster but, as measured later, the 4,000-iteration results were mostly
noise for wide ranges.

**Context.** A real solve on a physical device was reported as taking
over a minute. Measured (not guessed) locally first: 8,000 iterations on
a realistic wide range pair (BTN's 82-hand opening chart vs BB's 85-hand
defend chart, 100bb) took 10.3s and produced ~42,000 distinct info sets.
Chance-sampling keeps the betting-tree walk's cost constant regardless of
range width (exactly one combo per player is sampled either way), but a
wider range does mean more distinct `(combo, history)` dictionary entries
to allocate and update each iteration -- real CPython overhead at this
scale, not something the original `DEFAULT_ITERATIONS` comment accounted
for (see the superseded reasoning in the 2026-10-06 `/spots/solve` entry).

**Decision.** `DEFAULT_ITERATIONS: 8_000 -> 4_000` (`apps/api/app/
solve.py`) -- confirmed via the same local measurement that this roughly
halves wall-clock time (10.3s -> 5.0s on the wide pair) while every hand
in a realistic range still gets a strategy back. `solve_spot` now logs
elapsed time, iteration count, and info-set count server-side (not
returned to the client -- diagnostic, not UI data) so a future "it's
slow" report has real numbers to start from instead of needing to
reproduce the measurement from scratch.

**Consequences.** Per-hand precision is somewhat lower (fewer visits per
combo). If a production deploy is still slow well beyond what halving
implies, that points at the host's CPU allocation rather than the
algorithm -- worth checking Render's plan/instance size before tuning
iterations further or optimizing the engine itself.

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

**Revisited 2026-10-07:** real traffic arrived (a solve on a physical
device, reported as taking over a minute) -- see that date's entry for
the actual measurement and the resulting `DEFAULT_ITERATIONS` change.
The "chance-sampling means range width doesn't change per-iteration
cost" assumption this entry's `DEFAULT_ITERATIONS` reasoning leaned on
turned out to be only half true: the betting-tree walk's cost is
constant, but a wider range creates more distinct info-set dictionary
entries, which is real overhead at scale. Sync-vs-async remains
unrevisited -- still worth watching if the host-CPU hypothesis in the
2026-10-07 entry doesn't fully explain the reported latency.

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
