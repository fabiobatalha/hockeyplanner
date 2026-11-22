FROM ghcr.io/astral-sh/uv:0.13.9 AS uv
FROM docker.io/library/python:3.15-slim

WORKDIR /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    UV_NO_CACHE=1 \
    UV_PYTHON_DOWNLOADS=never

COPY --from=uv /uv /usr/local/bin/uv
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY README.md ./
COPY src/ ./src/
COPY web/ ./web/
RUN uv sync --locked --no-dev \
    && install -d -o 10001 -g 10001 /app/data

USER 10001:10001
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD ["python", "-c", "from urllib.request import urlopen; urlopen('http://127.0.0.1:8000/api/account', timeout=3).close()"]
CMD ["gunicorn", "--bind=0.0.0.0:8000", "--workers=1", "--threads=4", "hockeyplanner:create_app()"]
