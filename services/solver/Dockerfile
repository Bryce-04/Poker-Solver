# Built with repo root as context (see infra/docker-compose.yml).
FROM python:3.12-slim
WORKDIR /app
COPY services/solver ./services/solver
WORKDIR /app/services/solver
RUN pip install --no-cache-dir -e .
CMD ["python", "-m", "poker_solver.kuhn_spike"]
