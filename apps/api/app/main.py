"""API entrypoint.

Stage 1 scope: nothing user-facing yet. This just proves the service boots
and can see the shared Spot schema from packages/schema.
"""

from fastapi import FastAPI

from poker_solver_schema import __version__ as schema_version

from .routes.spots import router as spots_router

app = FastAPI(title="Poker Solver API", version="0.1.0")
app.include_router(spots_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "schema_version": schema_version}
