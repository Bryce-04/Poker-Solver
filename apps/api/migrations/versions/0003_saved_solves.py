"""Add saved_solves: a Spot plus the solver result it produced, per user.

Separate from `spots` on purpose -- the shared Spot schema has no field for a
solve result, and a saved solve is a different thing from a saved spot (it
carries the computed strategy, which is expensive to recreate).

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "saved_solves",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", UUID(as_uuid=True), nullable=False),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("spot", JSONB, nullable=False),
        sa.Column("result", JSONB, nullable=False),
    )
    op.create_index("ix_saved_solves_created_by", "saved_solves", ["created_by"])


def downgrade() -> None:
    op.drop_index("ix_saved_solves_created_by", table_name="saved_solves")
    op.drop_table("saved_solves")
