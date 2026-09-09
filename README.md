# Poker Solver

An approachable poker study tool: build or import a spot, get a real
strategic recommendation, tag how opponents play, save what you study, and
drill it in practice mode. See [`docs/plan.md`](docs/plan.md) for the full
roadmap, what's been revised from the original plan, and why.

**Status:** Stage 2 — manual hand builder, in progress. Stage 1 (Spot
schema, user model, throwaway CFR spike) is complete. The spot builder and
13×13 range grid are scaffolded in `apps/web` and wired to a reference-chart
lookup in `apps/api`; polished builder controls, range-grid interactions,
and the visual pass are still open.

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

# solver spike (separate terminal)
cd services/solver && pip install -e ".[dev]" && python -m poker_solver.kuhn_spike
```

`GET http://localhost:8000/health` should return
`{"status": "ok", "schema_version": "0.1.0"}` once the api is running.

## Team

Repo: `Bryce-04/Poker-Solver` (private). Shared Postgres + auth runs on
Supabase under a teammate's account — ask in the team channel for the
project URL and keys to fill in `.env`.
