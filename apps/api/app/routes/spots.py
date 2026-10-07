"""Stage 2 endpoint: match a submitted Spot against the reference-chart
table (see ../reference_charts.py) and return it. Also POST/GET /spots for
saving and listing spots -- both require a signed-in user (see ../auth.py)
and only ever see that user's own spots. See docs/decisions.md for the
response-shape and Authorization-header contracts apps/web's api.ts was
built against.
"""

from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from poker_solver_schema import Spot

from ..auth import current_user_id
from ..db import SpotRow, get_db
from ..reference_charts import find_matching_chart
from ..solve import InvalidSolveRequest, solve_spot

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


@router.post("/solve")
def solve(spot: Spot) -> dict:
    """Stage 5: a real MCCFR solve, for a single postflop street -- see
    ../solve.py for the request contract (two ranges, a flop/turn/river
    board, at most a seeded opening check already on this street)."""
    try:
        return solve_spot(spot)
    except InvalidSolveRequest as e:
        raise HTTPException(status_code=422, detail=str(e)) from e


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
