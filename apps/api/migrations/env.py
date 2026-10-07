"""Alembic environment. Run from apps/api: `alembic upgrade head`.

Reuses app.db's engine rather than a URL in alembic.ini, so migrations hit
exactly the database the API would (DATABASE_URL, falling back to the
repo-root .env). Online mode only -- there's no offline SQL-script workflow.
"""

from logging.config import fileConfig

from alembic import context

from app.db import Base, engine

if context.config.config_file_name is not None:
    fileConfig(context.config.config_file_name)

with engine.connect() as connection:
    context.configure(connection=connection, target_metadata=Base.metadata)
    with context.begin_transaction():
        context.run_migrations()
