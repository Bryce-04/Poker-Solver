"""API entrypoint.

Stage 1 scope: nothing user-facing yet. This just proves the service boots
and can see the shared Spot schema from packages/schema.
"""

import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from poker_solver_schema import __version__ as schema_version

from .routes.spots import router as spots_router

app = FastAPI(title="Poker Solver API", version="0.1.0")

# Browsers enforce CORS; curl/httpx don't -- without this, apps/web's fetch
# calls fail silently in-browser even though the API is reachable and
# healthy by every other check.
#
# https://localhost is Capacitor's default Android WebView origin regardless
# of where the web build is hosted, so it's safe to hardcode. The deployed
# web app's real origin isn't settled yet -- ALLOWED_ORIGINS lets it be added
# as a Render env var once it is, without a code change.
_extra_origins = [o for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o]

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://localhost", *_extra_origins],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(spots_router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "schema_version": schema_version}
