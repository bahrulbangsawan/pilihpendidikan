# syntax=docker/dockerfile:1.7
# pilih-scraper container (job-tracker-spec/24, D-38). Build context: the
# repository root (wrangler `image_build_context: "../.."`), because the
# service installs apps/jobs-cli (the pilih-jobs Scrapling engine) next to it.
#   docker build --platform linux/amd64 -f apps/jobs-scraper/Dockerfile -t pilih-scraper .
# Only explicit files are copied: `wrangler deploy` / `wrangler dev` pipe this
# Dockerfile on stdin (`-f -`), so no Dockerfile-specific .dockerignore applies,
# and BuildKit then transfers just the paths named below (never a local .venv
# or node_modules). Dockerfile.dockerignore does the same for manual builds.

FROM ghcr.io/astral-sh/uv:0.12.1 AS uv

FROM --platform=linux/amd64 python:3.12-slim-bookworm

COPY --from=uv /uv /usr/local/bin/uv

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app
COPY apps/jobs-cli/pyproject.toml apps/jobs-cli/uv.lock apps/jobs-cli/README.md apps/jobs-cli/THIRD_PARTY_NOTICES /app/apps/jobs-cli/
COPY apps/jobs-cli/src /app/apps/jobs-cli/src
COPY apps/jobs-scraper/python/pyproject.toml apps/jobs-scraper/python/uv.lock apps/jobs-scraper/python/README.md /app/apps/jobs-scraper/python/
COPY apps/jobs-scraper/python/src /app/apps/jobs-scraper/python/src

WORKDIR /app/apps/jobs-scraper/python
# Locked, no dev tools, pilih-jobs installed as a regular (non-editable) wheel.
RUN uv sync --frozen --no-dev --no-editable \
    && rm -rf /root/.cache

# Chromium + its system libraries for the opt-in `browser` strategy (15 §5).
# Plain Playwright Chromium only: no patchright / stealth builds (D-16).
RUN /app/.venv/bin/python -m playwright install --with-deps chromium \
    && rm -rf /var/lib/apt/lists/* /root/.cache /tmp/*

RUN useradd --create-home --uid 10001 scraper \
    && mkdir -p /data \
    && chown -R scraper:scraper /data /ms-playwright

USER scraper
ENV PATH=/app/.venv/bin:$PATH \
    PILIH_SCRAPER_DATA_DIR=/data \
    HOME=/home/scraper
VOLUME ["/data"]
EXPOSE 8080
CMD ["pilih-scraper", "serve", "--host", "0.0.0.0", "--port", "8080"]
