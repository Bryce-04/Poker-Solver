"""Add spots.created_by (Stage 6 auth) so GET /spots can filter per user.

Nullable: the rows saved before auth existed have no owner. They're left in
place, not backfilled or deleted -- they just never show up in anyone's list.

Revision ID: 0002
Revises: 0001
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("spots", sa.Column("created_by", UUID(as_uuid=True), nullable=True))
    op.create_index("ix_spots_created_by", "spots", ["created_by"])


def downgrade() -> None:
    op.drop_index("ix_spots_created_by", table_name="spots")
    op.drop_column("spots", "created_by")
