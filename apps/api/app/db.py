"""SQLAlchemy engine/session, reading DATABASE_URL from the environment.

load_dotenv() picks up the repo-root .env for local `uvicorn --reload` runs
(docker-compose and Render both set the real env var directly, so this is a
no-op there). It never overrides an already-set env var.
"""

import os

from dotenv import load_dotenv
from sqlalchemy import BigInteger, Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, create_engine
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, sessionmaker

load_dotenv()

engine = create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class Base(DeclarativeBase):
    pass


class SpotRow(Base):
    """A saved Spot, stored whole as JSONB rather than normalized -- the
    Spot schema (packages/schema) is still evolving, and `data` is what
    gets round-tripped back into a Spot on read. `id`/`created_at` are
    real columns purely for the primary key and list ordering, and
    `created_by` so GET /spots can filter per user without reaching into the
    JSONB. It's nullable because rows saved before Stage 6 auth have no
    owner -- they're kept, just never listed for anyone.

    The table itself is managed by Alembic (apps/api/migrations), not
    create_all -- create_all never adds a column to a table that already
    exists, which is exactly what the deployed database needed here.
    """

    __tablename__ = "spots"

    id = Column(UUID(as_uuid=True), primary_key=True)
    created_at = Column(DateTime(timezone=True), nullable=False)
    created_by = Column(UUID(as_uuid=True), nullable=True, index=True)
    data = Column(JSONB, nullable=False)


class LessonProgressRow(Base):
    """One user's result on one Train-tab lesson: finished or not, and the
    score of their latest attempt. The lessons themselves live in the web app
    (apps/web/src/lib/lessons.ts), so `lesson_id` is just a slug the server
    stores without knowing what it means. `updated_at` is the client's clock in
    milliseconds, kept so that two devices' offline attempts merge by "newest
    wins" instead of by whichever reached the server last (routes/progress.py
    rejects times in the future so one bad clock can't pin a row)."""

    __tablename__ = "lesson_progress"

    user_id = Column(UUID(as_uuid=True), primary_key=True)
    lesson_id = Column(String(64), primary_key=True)
    done = Column(Boolean, nullable=False)
    correct = Column(Integer, nullable=False)
    total = Column(Integer, nullable=False)
    updated_at = Column(BigInteger, nullable=False)


class CoachConversationRow(Base):
    """One Coach conversation (docs/coach.md §3.1), owned like a spot: every
    query filters on `created_by`, and someone else's conversation is a 404.

    `status` is `idle`, `working` (a turn is running), `waiting_for_solver`, or
    `error`. A conversation stuck in `working` after a server restart is reset
    to `error` the next time it's read (app/ask_coach/store.py).
    """

    __tablename__ = "coach_conversations"

    id = Column(UUID(as_uuid=True), primary_key=True)
    created_by = Column(UUID(as_uuid=True), nullable=False, index=True)
    title = Column(Text, nullable=True)
    status = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
    updated_at = Column(DateTime(timezone=True), nullable=False)


class CoachMessageRow(Base):
    """One item in a conversation: the user's text, the Coach's text, or a
    card. `seq` numbers them 1, 2, 3... per conversation (the frontend polls
    for `seq > after`); `kind` says which component renders `payload`
    (docs/coach.md §3.1 lists every kind). Deleting the conversation deletes
    its messages (ON DELETE CASCADE in the database)."""

    __tablename__ = "coach_messages"
    __table_args__ = (
        UniqueConstraint("conversation_id", "seq", name="uq_coach_messages_conversation_seq"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True)
    conversation_id = Column(
        UUID(as_uuid=True),
        ForeignKey("coach_conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    seq = Column(Integer, nullable=False)
    kind = Column(Text, nullable=False)
    payload = Column(JSONB, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
