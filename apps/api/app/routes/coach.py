"""POST /coach: the Train tab's AI coach (see ../coach.py). Sign-in required, so
the shared free-tier quota is spent only by real accounts."""

import json
from collections.abc import Iterator
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from .. import coach
from ..auth import current_user_id

router = APIRouter(prefix="/coach", tags=["coach"])


@router.post("")
def ask_coach(req: coach.CoachRequest, user: UUID = Depends(current_user_id)) -> coach.CoachResponse:
    return coach.answer(req, user, coach.get_provider())


@router.post("/chat")
def chat(req: coach.ChatRequest, user: UUID = Depends(current_user_id)) -> StreamingResponse:
    """The coach as a streamed chat: Server-Sent Events, `data: {"delta": "..."}` per piece of
    text, then `data: {"done": true}`. See coach.chat_events for the fallback and error events.
    Refusals that can happen before any answer (sign-in, bad input) are ordinary HTTP errors."""
    provider = coach.get_provider()

    def events() -> Iterator[str]:
        for event in coach.chat_events(req, user, provider):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
