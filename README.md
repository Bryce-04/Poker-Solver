# Poker Solver

An approachable poker study tool: build or import a spot, get a real
strategic recommendation, tag how opponents play, save what you study, and
drill it in practice mode. See [`docs/plan.md`](docs/plan.md) for the full
roadmap, what's been revised from the original plan, and why.

**Status:** Stages 1 and 2 complete. The range grid (weighted-brush /
drag-paint / keyboard selection with weight shading) is mounted editable
everywhere a matched chart shows up, not just viewable. Three ways into a
spot now converge on the same shapes: the button builder, Stage 3's
plain-language entry, and Stage 4's hand-history paste import (one
format, rule-based, not freeform — same philosophy as Stage 3). The app
has a design-token visual pass (light + dark) and is routed into four
screens (Builder / Saved / Type in / Import). Saved spots is wired
end-to-end to `apps/api`'s `POST`/`GET /spots` (Postgres via Supabase).
Stage 6 auth has a frontend start — Supabase sign-in, session state, an
`Authorization` header on save/list calls, save buttons gated on being
signed in — but saved spots stay an unscoped shared list until the
backend lane verifies that header and filters per user. `apps/api` is
deployed (Render); an Android build (Capacitor) has a real icon/splash and
runs end-to-end against the live API on a physical device. Stage 5 has
grown past its initial river-only start too: `services/solver` now
solves any single postflop street (flop, turn, or river — heads-up, two
ranges, the locked bet-size menu) via Monte Carlo CFR, checked against
closed-form poker theory — not yet reachable from `apps/api` or the app
itself, and modeling betting across *multiple* streets in one solve is
still a separate, bigger future direction. See `services/solver/README.md`.

## Layout

```
apps/
  web/       React + TypeScript + Vite frontend
  api/       FastAPI: spot CRUD, auth glue, orchestrates the solver
services/
  solver/    Python MCCFR engine + equity calculator (Stage 5)
packages/
  schema/    Spot data model — Python source of truth, generated TS types
infra/       docker-compose for local dev, deploy configs
docs/        plan.md and anything else worth keeping in the repo
```

## Getting started

Requires Node 20+, [pnpm](https://pnpm.io) (`corepack enable` or
`npm i -g pnpm`), Python 3.11+, and Docker (for local Postgres).

```bash
cp .env.example .env          # fill in DATABASE_URL / Supabase keys
pnpm install                  # installs apps/web + packages/schema JS deps
docker compose -f infra/docker-compose.yml up -d db

# api
cd apps/api && pip install -e ../../packages/schema -e . && uvicorn app.main:app --reload

# web (separate terminal)
pnpm dev:web

# solver (separate terminal)
cd services/solver && pip install -e ".[dev]" && python -m poker_solver.postflop_mccfr
```

`GET http://localhost:8000/health` should return
`{"status": "ok", "schema_version": "0.1.0"}` once the api is running.

## Team

Repo: `Bryce-04/Poker-Solver` (private). Shared Postgres + auth runs on
Supabase under a teammate's account — ask in the team channel for the
project URL and keys to fill in `.env`.
