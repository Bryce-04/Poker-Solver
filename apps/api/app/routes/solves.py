"""Saved solves: POST/GET/DELETE /solves. A solve is the Spot a user submitted
plus the solver's result for it, kept so they can look back at it later. Every
route requires a signed-in user (see ../auth.py) and only ever touches that
user's own rows -- another user's id is indistinguishable from a missing one.
"""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from poker_solver_schema import Spot

from ..auth import current_user_id
from ..db import SavedSolveRow, get_db

router = APIRouter(prefix="/solves", tags=["solves"])


class SaveSolveRequest(BaseModel):
    spot: Spot
    # The /spots/solve response, stored as sent. Only the one field the
    # viewer can't work without is checked; the rest is app/solve.py's to evolve.
    result: dict[str, Any]
    label: str | None = Field(default=None, max_length=200)


def _to_json(row: SavedSolveRow) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "created_at": row.created_at.isoformat(),
        "label": row.label,
        "spot": row.spot,
        "result": row.result,
    }


@router.post("")
def save_solve(
    body: SaveSolveRequest,
    db: Session = Depends(get_db),
    user_id: UUID = Depends(current_user_id),
) -> dict[str, Any]:
    if not isinstance(body.result.get("strategy"), dict):
        raise HTTPException(status_code=422, detail="result must include a strategy object")
    row = SavedSolveRow(
        id=uuid4(),
        created_at=datetime.now(UTC),
        created_by=user_id,
        label=body.label,
        spot=body.spot.model_dump(mode="json"),
        result=body.result,
    )
    db.add(row)
    db.commit()
    return _to_json(row)


@router.get("")
def list_solves(
    db: Session = Depends(get_db),
    user_id: UUID = Depends(current_user_id),
) -> list[dict[str, Any]]:
    rows = (
        db.query(SavedSolveRow)
        .filter(SavedSolveRow.created_by == user_id)
        .order_by(SavedSolveRow.created_at.desc())
        .all()
    )
    return [_to_json(row) for row in rows]


@router.delete("/{solve_id}", status_code=204)
def delete_solve(
    solve_id: UUID,
    db: Session = Depends(get_db),
    user_id: UUID = Depends(current_user_id),
) -> None:
    row = (
        db.query(SavedSolveRow)
        .filter(SavedSolveRow.id == solve_id, SavedSolveRow.created_by == user_id)
        .one_or_none()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="No such saved solve.")
    db.delete(row)
    db.commit()
