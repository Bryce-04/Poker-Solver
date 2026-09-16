"""SQLAlchemy engine/session, reading DATABASE_URL from the environment.

load_dotenv() picks up the repo-root .env for local `uvicorn --reload` runs
(docker-compose and Render both set the real env var directly, so this is a
no-op there). It never overrides an already-set env var.
"""

import os

from dotenv import load_dotenv
from sqlalchemy import Column, DateTime, create_engine
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
    real columns purely for the primary key and list ordering.
    """

    __tablename__ = "spots"

    id = Column(UUID(as_uuid=True), primary_key=True)
    created_at = Column(DateTime(timezone=True), nullable=False)
    data = Column(JSONB, nullable=False)


Base.metadata.create_all(engine)
