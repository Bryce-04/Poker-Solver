# Built with repo root as context (see infra/docker-compose.yml) so it can
# see packages/schema, which apps/api depends on.
FROM python:3.12-slim
WORKDIR /app
COPY packages/schema ./packages/schema
COPY apps/api ./apps/api
WORKDIR /app/apps/api
RUN pip install --no-cache-dir -e ../../packages/schema -e .
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
