# The Solving Stack — build plan

A revised, buildable roadmap for the poker solver: what changed from the
original seven-stage pitch, the two decisions locked in before scaffolding,
and what ships in each stage. (Full designed version: ask in the team
channel for the artifact link if you want the formatted read.)

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
bet-size menu (check, 33%/66%/100% pot, all-in). Small enough that Monte
Carlo CFR converges in seconds on ordinary hardware — genuinely correct
for what it covers, rather than an unverifiable multi-street abstraction.
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
2. **More streets** (flop→turn→river) — the big one. Tree size grows
   combinatorially; needs card abstraction (bucketing similar hands) to
   stay solvable in reasonable time, not just more compute.
3. **3+ players** — CFR's convergence guarantees weaken outside heads-up;
   realistically last.
4. **Arbitrary bet sizing** — architecturally simple, but hurts solve
   caching since "identical spot" gets rarer.

Not committed to a stage number yet — tracked here as a known direction.
