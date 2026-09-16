"""SQLAlchemy engine/session, reading DATABASE_URL from the environment.

load_dotenv() picks up the repo-root .env for local `uvicorn --reload` runs
(docker-compose and Render both set the real env var directly, so this is a
no-op there). It never overrides an already-set env var.
"""

import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

load_dotenv()

engine = create_engine(os.environ["DATABASE_URL"], pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
