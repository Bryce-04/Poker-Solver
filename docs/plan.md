# The Solving Stack — build plan

A revised, buildable roadmap for the poker solver: what changed from the
original seven-stage pitch, the two decisions locked in before scaffolding,
and what ships in each stage. (Full designed version: ask in the team
channel for the artifact link if you want the formatted read.)

**Status (2026-10-06):** Stage 1 and 2 done. Stage 3 (`parseSpotText.ts`)
recognizes the same two situations the button builder does, widened past
its original literal two-phrasing MVP with synonyms (seat names like
"button"/"cutoff", "raises" as well as "opens", "big blinds" spelled out)
— still rule-based, still exactly two shapes, not freeform text. Stage 4
has a small start too: `parseHandHistory.ts` reconstructs a Spot from a
pasted hand history (one format, a full 6-handed 6-max table, the same two
chart-coverable shapes) — the first of the "pluggable adapters" this
stage's note called for. The range grid is finally mounted editable, not
just as a read-only chart display: every entry path (Builder, Type in,
Import) lets you adjust the matched range before saving it. `apps/web` is
routed into five screens (Builder / Saved / Type in / Import / Solve).
Saved spots
is wired end-to-end: `apps/api` persists `Spot`s (Postgres via Supabase)
behind `POST`/`GET /spots` (see `docs/decisions.md`). Stage 6's frontend
half is done too: Supabase email/password sign-in, session state, and an
`Authorization: Bearer <token>` header on save/list calls, with the save
button on all three entry screens gating on being signed in — and the
backend half now verifies that header (Supabase JWT, checked against the
project's public keys) and scopes `POST`/`GET /spots` per user, with the
`spots` table moved under Alembic migrations. `apps/api` is
deployed (Render); the Android build (Capacitor) has a real app icon/splash
and runs end-to-end against the live API on a physical device. **Stage 5
has grown past its initial river-only start**: `services/solver` now
solves any single postflop street — flop, turn, or river — heads-up, two
ranges, the locked bet-size menu, via chance-sampled Monte Carlo CFR
(since replaced -- see below), checked against closed-form poker theory,
not just "did it run"
(`postflop_mccfr.py`, `betting_round.py`, backed by a from-scratch hand
evaluator and a 169-label-to-concrete-combo sampler with a board-runout
sampler for flop/turn — see `services/solver/README.md`). It's wired up
now too: `apps/api`'s `POST /spots/solve` (`app/solve.py`) runs a real
solve synchronously and returns a per-action-frequency strategy for
whichever player's decision the request implies — see
`docs/decisions.md`'s 2026-10-06 entry for the request contract (a new
`Spot` convention — two ranges, not one — rather than a schema change).
`apps/web` has a screen for it now too: the new **Solve** tab
(`pages/SolvePage.tsx`) — two positions, two ranges, a board (click
cards via `components/CardPicker/CardPicker.tsx`, or type them via
`lib/cards.ts` — see `docs/decisions.md`'s 2026-10-06/07 entries), and a
results table showing real per-action frequencies per hand, not a
single chart weight. This only ever solves one street's betting at a
time — modeling a full flop→turn→river betting tree in one solve is a
separate, bigger future direction (see "widening the solver" below), not
something this does. **Since then**, `SolvePage` grew a per-position
"Load reference range" default, a 13×13 color-coded `StrategyGrid`
replacing that results table, a halved `DEFAULT_ITERATIONS` (measured,
not guessed), and a "paste a hand history" shortcut that fast-forwards
to whatever street the paste stops at (see `docs/decisions.md`). **Shipped since then too:** the locked bet-size menu is now 25%/75%/
125% pot + all-in (was 33%/66%/100%), `/spots/solve` seeds from any
non-terminal action prefix, not just an empty street or one check, and
`SolvePage` gained a real click-through hand builder as an alternative
to pasting a hand history — distinct preflop (3-bet/4-bet support, not
just one raise/one call)/flop/turn/river sections, pot/stack
auto-computed from real entered actions plus assumed 1/0.5 blinds
instead of typed in, "Solve" live wherever the walk actually stops (see
`docs/decisions.md`'s 2026-10-07 entries). **And the solver itself was
replaced** the same day: the chance-sampled Monte Carlo trainer was
measured producing noise for realistic wide ranges (AA "jamming" 70%
into a 4bb pot), so `services/solver` now solves with range-vs-range
Discounted CFR over an exact equity matrix (`range_cfr.py`,
`equity.py`), trained until it's within 0.5% of the pot of equilibrium —
see `docs/decisions.md`'s top entry. Remaining: Stage 4 past its
one-format MVP, Stage 5's solve caching + eventually multi-street
solving (and the open range-narrowing question below), and the rest of
Stage 6 (tags, search).

## The pitch

A web-based poker solver built around ease of use, lowering the barrier
that makes tools like PioSolver or GTO Wizard intimidating for casual and
intermediate players. Get a spot into the tool however's natural — click
through it, type it in plain language, or import a hand history — and get
back a real strategic recommendation. Beyond analysis: tag opponent
tendencies, save and search past solves, and drill spots in a practice mode
that scores decisions against the solver's actual strategy.

## What had to change

1. **The solver risk was buried at Stage 5.** Four stages of UI would've
   been built around a reference-chart stand-in before the hardest
   technical problem — real-time CFR solving — got touched at all. *Fix:*
   a disposable solver spike moved into Stage 1, before any UI commits to
   fake data.
2. **No account system anywhere.** Stage 6 needs saved history and tags
   scoped per user, which needs auth, and nothing before Stage 6 mentioned
   it. *Fix:* a minimal user model joins the Stage 1 schema now, even
   though login UI doesn't ship until Stage 6.
3. **"Reference-chart output" needed a legally clean source.** Precomputed
   range charts are the product PioSolver/GTO Wizard sell — scraping them
   is a copyright problem, and hand-typed guesses would teach wrong
   strategy. *Fix:* Stage 2 sources charts from open preflop-equilibrium
   data or a small in-house computed table, clearly labeled as reference,
   not live, output.
4. **"A .txt hand history file" isn't one format.** PokerStars, GGPoker,
   and trackers all export differently. *Fix:* Stage 4 scopes to one or two
   concrete formats first, with pluggable adapters for more later.
5. **No plan for validating the solver is correct.** A confidently wrong
   solver is worse than no solver. *Fix:* a regression suite of
   hand-verified spots every solver change must match within tolerance.
6. **No hosting/compute plan for something this CPU-heavy.** Real-time CFR
   isn't free. *Fix:* cache solved spots, and host the solver on a service
   built for long-running compute, not serverless-only.

## Two decisions, locked in

**Stack:** Python (FastAPI + numpy) for the solver and API — fastest to
iterate on the CFR math, no systems-language ramp-up required. React +
TypeScript for the frontend. One shared schema
(`packages/schema`, Pydantic) generates the TypeScript types so the two
sides can't drift. Escape hatch: the CFR inner loop can move to Rust via
PyO3 later if profiling says it's the bottleneck — not a day-one call.

**Solver scope (Stage 5):** one postflop street, heads-up, a fixed
bet-size menu (check, 25%/75%/125% pot, all-in — resized from
33%/66%/100% on 2026-10-07). Small enough that range-vs-range CFR
converges to a measured precision in seconds on ordinary hardware —
genuinely correct for what it covers, rather than an unverifiable
multi-street abstraction. (Originally planned and first built as Monte
Carlo CFR; that turned out not to converge for realistic wide ranges —
see `docs/decisions.md`.)
Widening this (more sizes, more streets, more players — see below) is a
deliberate future direction, not part of Stage 5.

## The revised roadmap

| Stage | Goal | Changed |
|---|---|---|
| 1. Foundations | Spot schema + user model + throwaway CFR spike, before any UI | Added: user model, solver spike |
| 2. Manual Hand Builder | Button/dropdown builder, 13×13 range grid, reference-chart output | Added: legit chart sourcing, real visual pass now |
| 3. Type-In Hand Entry | Same spot, typed in plain language | Added: rule-based parser first, not LLM-first |
| 4. Hand History Import | Reconstruct a spot from a real export | Added: scoped to 1-2 site formats, pluggable adapters |
| 5. Real Solving Engine | Live MCCFR strategy + equity calc, for the locked-in scope | Added: regression suite, solve caching, explicit reference-vs-live labeling |
| 6. Opponent Tags & Saved History | Real auth, tags, per-user saved/search | Auth now built on Stage 1's model, not introduced fresh |
| 7. Live Practice Mode & Polish | Drilling, scoring, session tracking, deploy/CI pass | Added: staging + monitoring alongside UI polish |

Each stage's full deliverable list lives in the original planning
conversation / artifact — this table is the at-a-glance version kept in
the repo.

## Architecture

```
web (React/TS) -> api (FastAPI) -> solver (Python, MCCFR + equity)
                                 -> postgres (spots, tags, history, users)
                                 -> auth (Supabase, hosted by a teammate)
```

## Future direction: widening the solver

Once Stage 5's narrow scope is validated and cached in production, in
roughly this order of effort:

1. **More bet sizes** — cheap; same MCCFR, bigger action space per node.
2. **Multi-street solving** — one tree spanning flop→turn→river betting
   in a single solve, instead of one street at a time (any single street
   is already solvable — see `services/solver/README.md`). The big one.
   Tree size grows combinatorially; needs card abstraction (bucketing
   similar hands) to stay solvable in reasonable time, not just more
   compute.
3. **3+ players** — CFR's convergence guarantees weaken outside heads-up;
   realistically last.
4. **Arbitrary bet sizing** — architecturally simple, but hurts solve
   caching since "identical spot" gets rarer.

Not committed to a stage number yet — tracked here as a known direction.

### Open question, raised 2026-10-07: without #2, where does a later street's range actually come from?

Not just a nice-to-have — a real correctness/credibility gap in the
product as it stands. Each street is solved against whatever range the
user hands it (manually painted, or a preflop reference chart loaded
as-is), with nothing narrowing that range based on what the *same two
players* actually did on earlier streets in *this* solve. A real
solver's river range is a *consequence* of the equilibrium strategy on
the flop and turn; here it's an assumption the user supplies themselves
— if it includes hands that would never have taken that exact line, the
"solve" is optimized against a fictional opponent, not the real one.

Full multi-street solving (item #2 above) would fix this correctly but
stays out of scope for the stated reason (combinatorial blowup, needs
card abstraction). A cheaper middle ground, not yet evaluated for
feasibility: since each street's solve already produces a real
equilibrium strategy (`aggregate_label_strategies`), use it to compute
a **posterior range** — given the prior range and the solved strategy,
what's the range conditional on the action actually taken (a Bayesian
update, not a joint optimization) — and feed that into the next
street's solve automatically, chaining single-street solves instead of
jointly optimizing across streets. Not game-theoretically exact (no
backward induction — each street's strategy doesn't account for what it
sets up on the next one), but it would replace "the user guesses a
river range" with "the river range is derived from what an equilibrium
opponent on the turn would actually do," which is the actual complaint.
Needs real evaluation before committing to it: how much it actually
improves realism versus a full joint solve, what the UI/API shape for
chaining solves would look like, and whether the per-combo range math
(`services/solver/src/poker_solver/combos.py`) already has what a
posterior-range computation would need or if that's new work too.
