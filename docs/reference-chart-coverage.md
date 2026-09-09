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

3-bet-pot charts (facing a 4-bet), limped pots, multiway, stack buckets
other than 100/40bb, and full-ring seats. Tracked in the
`reference_charts.py` module docstring and `find_matching_chart`'s TODO.
