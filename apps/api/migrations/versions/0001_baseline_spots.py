"""Baseline: the spots table as Base.metadata.create_all made it, before
Alembic existed.

Skips creation if the table is already there, so the already-deployed
Supabase database (made by create_all) gets adopted rather than erroring --
no manual `alembic stamp` step on first deploy.

Revision ID: 0001
Revises:
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    if sa.inspect(op.get_bind()).has_table("spots"):
        return
    op.create_table(
        "spots",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("data", JSONB, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("spots")
