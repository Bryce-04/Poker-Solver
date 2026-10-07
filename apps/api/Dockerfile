# Built with repo root as context (see infra/docker-compose.yml) so it can
# see packages/schema and services/solver, which apps/api depends on (both
# as local path dependencies -- neither is on PyPI, so pip can only find
# them if they're copied in and installed alongside apps/api).
FROM python:3.12-slim
# numpy's BLAS starts one thread per CPU it can *see* -- inside a container
# that's typically every core on the host, while the container may only be
# allowed a fraction of one (Render free tier: 0.1 CPU). The extra threads
# just contend and get throttled, which can make numpy-heavy code (the
# solver's matrix products) dramatically slower. One thread each.
ENV OPENBLAS_NUM_THREADS=1 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1
WORKDIR /app
COPY packages/schema ./packages/schema
COPY services/solver ./services/solver
COPY apps/api ./apps/api
WORKDIR /app/apps/api
RUN pip install --no-cache-dir -e ../../packages/schema -e ../../services/solver -e .
# Migrate first, then serve -- so every deploy brings the database schema
# up to date before any request can hit it. See apps/api/migrations.
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
