"""Add coach_conversations and coach_messages: the Coach's saved conversations
(docs/coach.md §3.1).

Numbered 0003 against main. The account-progress branch also adds a 0003
(lesson_progress); whichever of the two merges second renumbers its migration
to 0004 and points down_revision at the other.

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
        "coach_conversations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_by", UUID(as_uuid=True), nullable=False),
        sa.Column("title", sa.Text, nullable=True),
        sa.Column("status", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_coach_conversations_created_by", "coach_conversations", ["created_by"])
    op.create_table(
        "coach_messages",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "conversation_id",
            UUID(as_uuid=True),
            sa.ForeignKey("coach_conversations.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("seq", sa.Integer, nullable=False),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("payload", JSONB, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("conversation_id", "seq", name="uq_coach_messages_conversation_seq"),
    )


def downgrade() -> None:
    op.drop_table("coach_messages")
    op.drop_index("ix_coach_conversations_created_by", table_name="coach_conversations")
    op.drop_table("coach_conversations")
