#!/bin/sh
# Fails loudly when uv (https://docs.astral.sh/uv/) is missing. The Python CLI
# (apps/jobs-cli) is built, linted and tested with uv; its package.json scripts
# call this guard first so `turbo test|lint|typecheck|build` explain what to do.
if command -v uv >/dev/null 2>&1; then
  exit 0
fi
cat >&2 <<'MSG'
error: `uv` is required for apps/jobs-cli (the pilih-jobs Python CLI) but was not found on PATH.

Install it, then re-run the command:
  macOS / Linux:  curl -LsSf https://astral.sh/uv/install.sh | sh
  Homebrew:       brew install uv
  Windows:        powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"

Then: cd apps/jobs-cli && uv sync
MSG
exit 1
