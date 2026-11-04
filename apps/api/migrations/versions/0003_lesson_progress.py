"""Add lesson_progress: a signed-in user's result on each Train-tab lesson, so
progress follows them across devices instead of living in one browser.

Revision ID: 0003
Revises: 0002
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "lesson_progress",
        sa.Column("user_id", UUID(as_uuid=True), primary_key=True),
        sa.Column("lesson_id", sa.String(64), primary_key=True),
        sa.Column("done", sa.Boolean, nullable=False),
        sa.Column("correct", sa.Integer, nullable=False),
        sa.Column("total", sa.Integer, nullable=False),
        sa.Column("updated_at", sa.BigInteger, nullable=False),
    )


def downgrade() -> None:
    op.drop_table("lesson_progress")
