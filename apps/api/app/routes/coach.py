"""POST /coach: the Train tab's AI coach (see ../coach.py). Sign-in required, so
the shared free-tier quota is spent only by real accounts."""

from uuid import UUID

from fastapi import APIRouter, Depends

from .. import coach
from ..auth import current_user_id

router = APIRouter(prefix="/coach", tags=["coach"])


@router.post("")
def ask_coach(req: coach.CoachRequest, user: UUID = Depends(current_user_id)) -> coach.CoachResponse:
    return coach.answer(req, user, coach.get_provider())
