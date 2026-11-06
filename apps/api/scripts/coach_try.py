"""Try the Coach for real from a terminal, before there's a UI: each message is
one turn (real Gemini, real tools, stored in the LOCAL database), and the
cards it stores are printed.

    cd apps/api
    python scripts/coach_try.py "I'm on the button with AhQd, BB called, flop Qs 5c 2c, he checks"
    python scripts/coach_try.py "BTN with AQo vs BB, flop Q52 two clubs, checked to me" "What if he bets?"

Several messages are one conversation, sent in order (follow-ups see the
history). It skips sign-in and the HTTP layer: it makes a throwaway user and
calls the same turn code POST /coach/conversations/{id}/messages queues.

Safety: it only ever uses the local docker-compose Postgres, never the
DATABASE_URL in .env (which may be Supabase). Start it with
`docker compose -f infra/docker-compose.yml up -d db`.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from uuid import uuid4

API = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(API))

LOCAL_DB = "postgresql+psycopg://poker_solver:poker_solver_dev@localhost:5432/poker_solver"
url = os.environ.get("DATABASE_URL", "")
if url and "localhost" not in url and "127.0.0.1" not in url:
    sys.exit("DATABASE_URL points somewhere other than localhost. This script only uses the local database.")
os.environ["DATABASE_URL"] = url or LOCAL_DB  # before app.db reads .env

from dotenv import load_dotenv  # noqa: E402

load_dotenv(API.parents[1] / ".env")  # GEMINI_API_KEY; never overrides DATABASE_URL above

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app import coach  # noqa: E402
from app.ask_coach import runner, store  # noqa: E402
from app.db import CoachConversationRow, CoachMessageRow, SessionLocal  # noqa: E402


def show(m: CoachMessageRow) -> None:
    p = m.payload
    if m.kind == "user_text":
        print(f"\nYOU: {p['text']}")
    elif m.kind == "coach_text":
        for para in p["paras"]:
            print(f"COACH: {para}")
    elif m.kind == "spot_card":
        print(f"  [SPOT CARD] hand {p.get('hero_hand') or '?'}, board {' '.join(p['spot']['board']) or '-'}")
        print("    " + " | ".join(f"{f['k']}: {f['v']}" for f in p["facts"]))
        if p["assumptions"]:
            print("    assumed: " + ", ".join(p["assumptions"]))
    elif m.kind == "general_advice":
        print("  [GENERAL ADVICE, not from the solver]")
        for para in p["paras"]:
            print(f"    {para}")
    elif m.kind == "suggestions":
        print("  [SUGGESTIONS] " + " / ".join(p["items"]))
    elif m.kind == "error":
        print(f"  [ERROR {p['kind']}] {p['text']}")
    else:
        print(f"  [{m.kind}] {json.dumps(p)[:200]}")


def main(messages: list[str]) -> int:
    if not messages:
        print(__doc__)
        return 2
    if coach.get_provider() is None:
        print("GEMINI_API_KEY isn't set in the repo-root .env.")
        return 2
    if not os.environ.get("GEMINI_MODEL"):
        print("Note: GEMINI_MODEL isn't set, so the default model is used; it may 404 on a new key.")

    command.upgrade(Config(str(API / "alembic.ini")), "head")  # the local DB, as tests do
    user = uuid4()
    with SessionLocal() as db:
        now = store.now()
        conversation = CoachConversationRow(
            id=uuid4(), created_by=user, title=None, status=store.IDLE, created_at=now, updated_at=now
        )
        db.add(conversation)
        db.commit()
        cid = conversation.id

    shown = 0
    for text in messages:
        with SessionLocal() as db:
            row = store.locked_conversation(db, cid)
            store.append_message(db, row, "user_text", {"text": text})
            if row.title is None:
                row.title = store.title_from_text(text)
            row.status = store.WORKING
            db.commit()
        runner.run_turn(cid)  # what the background worker runs, here inline
        with SessionLocal() as db:
            rows = db.scalars(
                select(CoachMessageRow).where(CoachMessageRow.conversation_id == cid).order_by(CoachMessageRow.seq)
            ).all()
            for m in rows[shown:]:
                show(m)
            shown = len(rows)

    with SessionLocal() as db:
        row = db.get(CoachConversationRow, cid)
        print(f"\nConversation title: {row.title!r}  status: {row.status}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
