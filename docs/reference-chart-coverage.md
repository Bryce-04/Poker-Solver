# Reference-chart coverage (Stage 2)

What `POST /spots/reference-strategy` can and can't match today. Source of
truth is [`apps/api/app/reference_charts.py`](../apps/api/app/reference_charts.py);
this doc is the human-readable summary and the frontend contract for the
"no chart for this spot yet" UX.

**These are approximate reference ranges built from widely-taught 6-max
opening theory — not a solve.** Every response is labelled
`source: "reference_chart"`; Stage 5 replaces them with a live MCCFR
strategy.

## Scope

- **6-max only.** Opening seats: **UTG, HJ, CO, BTN, SB**.
- **UTG1 and LJ are out of Stage 2** (full-ring seats). The matcher returns
  no match, and the builder's seat lists are 6-max so they can't be picked
  (`SIX_MAX_POSITIONS` in `apps/web/src/lib/positions.ts`). The hero seat
  also drops BB in an unopened pot (BB is never first to act).
- **Preflop only.** Any `current_street` other than `preflop` → no match.
- **Two stack buckets**, by `effective_stack_bb`:
  - `100bb` bucket: **80–120bb**
  - `40bb` bucket: **30–50bb**
  - Anything outside those ranges (e.g. 65bb, 25bb, 200bb) → **no match by
    design**. It does not snap to the nearest bucket. Surface this as
    "no chart at this stack depth yet", distinct from a network error.

## Opening ranges (unopened pot, hero is first in)

| Seat | 100bb | 40bb |
|------|:-----:|:----:|
| UTG  | ✅ | ✅ |
| HJ   | ✅ | ✅ |
| CO   | ✅ | ✅ |
| BTN  | ✅ | ✅ |
| SB   | ✅ | ✅ |
| UTG1, LJ | ❌ out of scope | ❌ out of scope |
| BB   | ❌ (can't open) | ❌ |

## Defend ranges (hero faces exactly one uncontested open-raise)

Hero's `actions` must be exactly one preflop `raise` from the opener, and
nothing else. Each cell is a **combined call-or-3bet continuing range** —
`HandRange` holds one weight per hand, so call vs 3bet isn't split until
Stage 5. Frontend label: *"Continuing range (call or 3-bet) — reference
chart, not a solve."*

| Hero defends | vs UTG | vs HJ | vs CO | vs BTN | vs SB |
|--------------|:------:|:-----:|:-----:|:------:|:-----:|
| **BTN**      | ❌ | ✅ | ✅ | — | — |
| **SB**       | ❌ | ❌ | ✅ | ✅ | — |
| **BB**       | ✅ | ✅ | ✅ | ✅ | ✅ |

Same coverage at both stack buckets (100bb and 40bb). `—` = opener is not
in front of that defender (position order). `❌` = a valid spot with no
chart yet.

## Frontend contract

The endpoint returns **404** for every "no match" case above, with a
`detail` string. The builder should distinguish:

1. **404** — spot is well-formed but uncovered → "No reference chart for
   this spot yet" (+ ideally *why*: out-of-scope seat, stack depth between
   buckets, or defend pair not built).
2. **422** — spot failed schema validation → "Invalid spot".
3. **network / 5xx** — "Couldn't reach the API".

On a **200**, `chart_description` already carries a plain-English label
(e.g. *"HJ opening range, ~100bb effective, 6-max, unopened pot"* /
*"BB continuing range (call or 3bet) facing a BTN open, ~100bb
effective"*) — safe to show verbatim.

## Deliberately still out of Stage 2

limped pots, 5-bet pots, 3-bet/4-bet charts below 100bb, multiway, stack buckets
other than 100/40bb, and full-ring seats. Tracked in the
`reference_charts.py` module docstring and `find_matching_chart`'s TODO.

## 3-bet and 4-bet pots (`POST /spots/preflop-ranges`)

Added 2026-10-18. A separate route from `reference-strategy`: it takes a
preflop *line* (`positions_in_hand` = the two seats, `actions` = the preflop
betting, closed by a call) and returns **both** players' ranges for the
postflop spot it leads to. Data and logic live in
[`apps/api/app/preflop_ranges.py`](../apps/api/app/preflop_ranges.py); the
Solve page's "Load both ranges from the preflop action" button uses it.

| Line | Opener gets | Defender gets |
|------|-------------|---------------|
| open, call | open range | **flat** range (the defend chart minus the 3-bet) |
| open, 3-bet, call | **call-vs-3-bet** range | **3-bet** range |
| open, 3-bet, 4-bet, call | **4-bet** range | **call-vs-4-bet** range |

- **Pairs covered:** the same nine (opener, defender) pairs as the defend
  charts: UTG–BB, HJ–BTN, HJ–BB, CO–BTN, CO–SB, CO–BB, BTN–SB, BTN–BB, SB–BB.
- **100bb only** (80–120bb). 40bb has no 3-bet/4-bet charts yet.
- **Not covered → 404** with a reason: limped pots, 5-bet pots, a seat pair
  with no chart, any other stack depth. A line that doesn't make sense (not
  closed by a call, a fold, a seat raising its own raise) → 422.
- **Approximate, constructed by principle** like every other chart here
  (value 3-bets from the top, bluffs from suited aces and connectors,
  tighter against earlier seats), not solver output; one weight (1.0) per hand.
  Rough frequencies: 3-bets 3-12% of hands, 4-bets 2-3%, an opener continues
  against a 3-bet with 42-62% of its open range.
- **Invariants** enforced in `apps/api/tests/test_preflop_ranges.py`: a 3-bet
  range sits inside the defend chart; call-vs-3-bet and 4-bet sit inside the
  open range and don't overlap; call-vs-4-bet sits inside the 3-bet range;
  flat + 3-bet = the defend chart exactly. Edit a range and these tell you if
  a player ended up with hands they couldn't have reached that node with.
- Hands that **5-bet jam** are simply absent from call-vs-4-bet.
