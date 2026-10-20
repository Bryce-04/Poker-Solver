"""Stage 2 endpoint: match a submitted Spot against the reference-chart
table (see ../reference_charts.py) and return it. Also POST/GET /spots for
saving, listing, renaming (PATCH) and deleting spots -- all require a
signed-in user (see ../auth.py) and only ever see that user's own spots. See docs/decisions.md for the
response-shape and Authorization-header contracts apps/web's api.ts was
built against.
"""

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, StringConstraints
from sqlalchemy.orm import Session

from poker_solver_schema import Spot

from ..auth import current_user_id
from ..db import SpotRow, get_db
from ..preflop_ranges import InvalidPreflopLine, UnsupportedPreflopLine, ranges_for_preflop_line
from ..reference_charts import find_matching_chart
from ..solve import InvalidSolveRequest, SolverBusy, narrow_ranges, solve_spot

router = APIRouter(prefix="/spots", tags=["spots"])


@router.post("/reference-strategy")
def reference_strategy(spot: Spot) -> dict:
    chart = find_matching_chart(spot)
    if chart is None:
        raise HTTPException(
            status_code=404,
            detail="No reference chart matches this spot yet -- see "
            "apps/api/app/reference_charts.py and docs/plan.md Stage 2.",
        )
    return {
        # Explicit, not implicit -- the frontend must be able to tell this
        # apart from a Stage 5 live solve without guessing. See docs/plan.md,
        # "What has to change" #3.
        "source": "reference_chart",
        "chart_key": chart.key,
        "chart_description": chart.description,
        "chart_source": chart.source,
        "ranges": chart.ranges,
    }


@router.post("/preflop-ranges")
def preflop_ranges(spot: Spot) -> dict:
    """Both players' ranges for a postflop spot, from the preflop line that
    led to it (open + call, 3-bet, or 4-bet pot) -- see ../preflop_ranges.py.
    positions_in_hand is the two seats, actions the preflop betting. 404 when
    the line is real but uncharted (limped pot, 5-bet, a seat pair or stack
    with no chart), 422 when it doesn't make sense."""
    try:
        return ranges_for_preflop_line(spot)
    except UnsupportedPreflopLine as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except InvalidPreflopLine as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


@router.post("/solve")
def solve(spot: Spot) -> dict:
    """Stage 5: a real range-vs-range solve, for a single postflop street --
    see ../solve.py for the request contract (two ranges, a flop/turn/river
    board, any non-terminal action prefix already on this street)."""
    try:
        return solve_spot(spot)
    except InvalidSolveRequest as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except SolverBusy as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@router.post("/narrow")
def narrow(spot: Spot) -> dict:
    """Range chaining: each player's range after the current street's
    recorded actions, from an equilibrium solve of that street -- feed it
    into the next street's /solve. Same request contract as /solve, but
    the street's actions are the line to narrow on (see ../solve.py)."""
    try:
        return narrow_ranges(spot)
    except InvalidSolveRequest as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except SolverBusy as e:
        raise HTTPException(status_code=503, detail=str(e)) from e


@router.post("")
def save_spot(
    spot: Spot,
    db: Session = Depends(get_db),
    user_id: UUID = Depends(current_user_id),
) -> Spot:
    # id/created_at/created_by are server-assigned, not trusted from the
    # client -- see the "server-assigned id/created_at" note on
    # SaveSpotResult in apps/web/src/lib/api.ts. created_by comes from the
    # verified token, never the request body.
    saved = spot.model_copy(
        update={"id": uuid4(), "created_at": datetime.now(UTC), "created_by": user_id}
    )
    db.add(
        SpotRow(
            id=saved.id,
            created_at=saved.created_at,
            created_by=user_id,
            data=saved.model_dump(mode="json"),
        )
    )
    db.commit()
    return saved


@router.get("")
def list_spots(
    db: Session = Depends(get_db),
    user_id: UUID = Depends(current_user_id),
) -> list[Spot]:
    rows = (
        db.query(SpotRow)
        .filter(SpotRow.created_by == user_id)
        .order_by(SpotRow.created_at.desc())
        .all()
    )
    return [Spot.model_validate(row.data) for row in rows]


class RenameSpot(BaseModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


def _own_spot_row(db: Session, spot_id: UUID, user_id: UUID) -> SpotRow:
    """The caller's own row, or 404 -- the same 404 whether the spot doesn't
    exist, belongs to someone else, or predates auth (no owner), so a caller
    can't probe for other users' spot ids."""
    row = db.get(SpotRow, spot_id)
    if row is None or row.created_by != user_id:
        raise HTTPException(status_code=404, detail="No such spot.")
    return row


@router.patch("/{spot_id}")
def rename_spot(
    spot_id: UUID,
    body: RenameSpot,
    db: Session = Depends(get_db),
    user_id: UUID = Depends(current_user_id),
) -> Spot:
    row = _own_spot_row(db, spot_id, user_id)
    # A new dict, not an in-place edit: SQLAlchemy only sees a JSONB column
    # change when the attribute is reassigned.
    row.data = {**row.data, "name": body.name}
    db.commit()
    return Spot.model_validate(row.data)


@router.delete("/{spot_id}", status_code=204)
def delete_spot(
    spot_id: UUID,
    db: Session = Depends(get_db),
    user_id: UUID = Depends(current_user_id),
) -> Response:
    db.delete(_own_spot_row(db, spot_id, user_id))
    db.commit()
    return Response(status_code=204)
