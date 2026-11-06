"""Checks the Gemini key works for the Coach: one plain message, then one that
should come back as a describe_spot call (docs/coach.md §2.6). Run it locally
and once on Render (Shell tab) after setting the key.

    cd apps/api
    python scripts/coach_smoke.py

Uses the same settings as the app: GEMINI_API_KEY, and GEMINI_MODEL (optional,
a comma-separated list tried in order).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

API = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(API.parents[1] / ".env")

from app import coach  # noqa: E402
from app.ask_coach.prompt import system_instruction  # noqa: E402
from app.ask_coach.tools import DECLARATIONS  # noqa: E402


def main() -> int:
    provider = coach.get_provider()
    if provider is None:
        print("GEMINI_API_KEY isn't set. Add it to the repo-root .env (or Render's Environment).")
        return 2
    print("Models, in order:", ", ".join(provider._models))

    try:
        parts = provider.generate_turn("Reply in one short sentence.", [{"role": "user", "parts": [{"text": "Say hello."}]}])
        print("1. Plain reply:", " ".join(p.get("text", "") for p in parts).strip())

        spot = "I'm on the button with AhQd, BB called my open, flop Qs 5c 2c, he checks. What do I do?"
        parts = provider.generate_turn(system_instruction(None), [{"role": "user", "parts": [{"text": spot}]}], DECLARATIONS)
    except coach.CoachBusy as e:
        if "HTTP 404" in str(e):
            print(
                "No model in the list is available to this key:", e,
                "\nSet GEMINI_MODEL to current Flash models from Google AI Studio (comma-separated).",
            )
        else:
            print("Gemini is busy or rate limited right now:", e)
        return 1
    except coach.CoachUnavailable as e:
        print("Gemini failed:", e, "(a 400/403 usually means a bad key or model name)")
        return 1

    calls = [p["functionCall"] for p in parts if "functionCall" in p]
    if not calls:
        print("2. Expected a tool call, got text:", " ".join(p.get("text", "") for p in parts).strip())
        return 1
    for c in calls:
        print(f"2. Tool call: {c['name']}", json.dumps(c.get("args", {}), indent=2))
    print("OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
