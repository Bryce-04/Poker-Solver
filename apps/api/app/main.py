"""API entrypoint.

Stage 1 scope: nothing user-facing yet. This just proves the service boots
and can see the shared Spot schema from packages/schema.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from poker_solver_schema import __version__ as schema_version

from .routes.spots import router as spots_router

app = FastAPI(title="Poker Solver API", version="0.1.0")

# Browsers enforce CORS; curl/httpx don't -- without this, apps/web's fetch
# calls fail silently in-browser even though the API is reachable and
# healthy by every other check.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(spots_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "schema_version": schema_version}
