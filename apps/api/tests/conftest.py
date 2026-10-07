"""Shared test setup: the database schema, via Alembic -- same as a deploy."""

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config


@pytest.fixture(scope="session", autouse=True)
def migrated_database():
    command.upgrade(Config(str(Path(__file__).parents[1] / "alembic.ini")), "head")
