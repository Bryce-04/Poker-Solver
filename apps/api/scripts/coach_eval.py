"""How well Gemini turns plain-English spots into describe_spot calls (docs/coach.md §11).

Sends each case in coach_eval/cases.jsonl to the real model, with the Coach's
system prompt and tools, and compares the first describe_spot call with the
expected fields. Run it before and after every prompt change. Target: at least
90% exact matches before anyone outside the team uses the Coach.

    cd apps/api
    python scripts/coach_eval.py                 # needs GEMINI_API_KEY (repo-root .env)
    python scripts/coach_eval.py --only typos    # one case, by id
    python scripts/coach_eval.py --check-cases   # no key: check the expected answers are valid spots

Free tiers allow only a few requests a minute, so cases are spaced out
(--delay, default 7s). A case's `expect`:
    hero, villain, hand, stack, line, aggressor: compared when present
    board + board_match: "exact" (default), "ranks" (suits weren't given; flop
        order ignored), or "pattern" (which cards share a suit must match: "two
        clubs", "rainbow")
    actions: [[street, actor, action], ...] in order; amounts aren't compared
    no_describe: true means the model must NOT call describe_spot (a live hand,
        a concept question, a three-way pot, a missing fact to ask about)
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

API = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(API.parents[1] / ".env")

from app import coach  # noqa: E402
from app.ask_coach import spot_builder as sb  # noqa: E402
from app.ask_coach.prompt import system_instruction  # noqa: E402
from app.ask_coach.tools import DECLARATIONS  # noqa: E402

CASES = API / "coach_eval" / "cases.jsonl"


def load_cases(only: str | None) -> list[dict]:
    cases = [json.loads(line) for line in CASES.read_text(encoding="utf-8").splitlines() if line.strip()]
    return [c for c in cases if only is None or c["id"] == only]


def _flop_sorted(cards: list[str]) -> list[str]:
    return sorted(cards[:3], key=lambda c: "23456789TJQKA".index(c[0])) + cards[3:]


def _suit_pattern(cards: list[str]) -> list[list[bool]]:
    return [[a[1] == b[1] for b in cards] for a in cards]


def board_matches(got: list[str], want: list[str], mode: str) -> bool:
    got = [sb.normalize_card(c) or c for c in got]
    if mode == "exact":
        return _flop_sorted(got) == _flop_sorted(want)
    if len(got) != len(want):
        return False
    g, w = _flop_sorted(got), _flop_sorted(want)
    if [c[0] for c in g] != [c[0] for c in w]:
        return False
    return mode == "ranks" or _suit_pattern(g) == _suit_pattern(w)


def compare(expect: dict, args: dict | None) -> list[str]:
    """The fields that don't match; empty means an exact match."""
    if expect.get("no_describe"):
        return [] if args is None else ["called describe_spot"]
    if args is None:
        return ["no describe_spot call"]
    wrong = []
    pre = args.get("preflop") or {}
    checks = {
        "hero": str(args.get("hero_position", "")).upper(),
        "villain": str(args.get("villain_position", "")).upper(),
        "line": pre.get("line"),
        "aggressor": pre.get("aggressor"),
        "stack": args.get("effective_stack_bb"),
    }
    for key, got in checks.items():
        if key in expect and got != expect[key]:
            wrong.append(f"{key}={got!r}")
    if "hand" in expect:
        got_hand, _ = sb.normalize_hand(args.get("hero_hand") or "")
        if got_hand != expect["hand"]:
            wrong.append(f"hand={args.get('hero_hand')!r}")
    if "board" in expect and not board_matches(args.get("board") or [], expect["board"], expect.get("board_match", "exact")):
        wrong.append(f"board={args.get('board')}")
    if "actions" in expect:
        got = [[a.get("street"), a.get("actor"), a.get("action")] for a in args.get("postflop_actions") or []]
        if got != expect["actions"]:
            wrong.append(f"actions={got}")
    return wrong


def first_describe_call(provider, text: str) -> tuple[dict | None, str]:
    contents = [{"role": "user", "parts": [{"text": text}]}]
    parts = provider.generate_turn(system_instruction(None), contents, DECLARATIONS)
    for p in parts:
        call = p.get("functionCall")
        if call and call.get("name") == "describe_spot":
            return call.get("args") or {}, "describe_spot"
    names = [p["functionCall"]["name"] for p in parts if "functionCall" in p]
    return None, ", ".join(names) or "text"


def check_cases(cases: list[dict]) -> int:
    """Every expected answer must itself be a valid spot, or the eval is wrong."""
    bad = checked = 0
    for c in cases:
        e = c["expect"]
        if e.get("no_describe"):
            continue
        checked += 1
        args = {
            "hero_position": e["hero"],
            "villain_position": e.get("villain"),
            "hero_hand": e.get("hand"),
            "effective_stack_bb": e.get("stack"),
            "board": e.get("board", []),
            "preflop": {"line": e["line"], "aggressor": e.get("aggressor")},
            "postflop_actions": [
                {"street": s, "actor": who, "action": act, **({"amount_bb": 2 + 3 * i} if act in ("bet", "raise") else {})}
                for i, (s, who, act) in enumerate(e.get("actions", []))
            ],
        }
        d = sb.describe(args)
        if not d.ok:
            bad += 1
            print(f"  {c['id']}: {d.problems}")
    print(f"{checked - bad} of {checked} expected spots are valid ({len(cases) - checked} cases expect no spot)")
    return 1 if bad else 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--only", help="run one case by id")
    ap.add_argument("--delay", type=float, default=7.0, help="seconds between cases (free-tier rate limits)")
    ap.add_argument("--check-cases", action="store_true", help="validate the cases file; no model calls")
    a = ap.parse_args()
    cases = load_cases(a.only)
    if a.check_cases:
        return check_cases(cases)

    provider = coach.get_provider()
    if provider is None:
        print("GEMINI_API_KEY isn't set (repo-root .env). Nothing to evaluate.")
        return 2

    exact, rows = 0, []
    for i, c in enumerate(cases):
        if i:
            time.sleep(a.delay)
        try:
            args, called = first_describe_call(provider, c["text"])
            wrong = compare(c["expect"], args)
        except coach.CoachUnavailable as e:
            called, wrong = "error", [f"model error: {e}"]
        exact += not wrong
        rows.append((c["id"], "ok" if not wrong else "MISS", called, "; ".join(wrong)))
        print(f"{rows[-1][1]:4}  {c['id']:28} {called:16} {rows[-1][3]}", flush=True)

    pct = 100 * exact / len(cases) if cases else 0
    print(f"\n{exact} of {len(cases)} exact ({pct:.0f}%). Target: 90%.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
