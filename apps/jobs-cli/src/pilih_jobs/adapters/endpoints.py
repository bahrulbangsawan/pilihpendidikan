"""Official endpoints of the ATS adapters, and their test-mode overrides (15 §16).

Adapter contract tests serve recorded fixtures from a local `pytest-httpserver`; the base
URL of an adapter can be replaced **only** when `PILIH_JOBS_ENV=test`, through
`set_test_base_urls()` or the `PILIH_JOBS_TEST_BASE_URLS` JSON object
(`{"greenhouse": "http://127.0.0.1:5123", …}`). Outside test mode overrides are refused.
"""

from __future__ import annotations

import json
import os
from typing import Final, cast

from pilih_jobs.errors import UsageError

ENV_MODE: Final = "PILIH_JOBS_ENV"
ENV_BASE_URLS: Final = "PILIH_JOBS_TEST_BASE_URLS"

DEFAULT_BASE_URLS: Final[dict[str, str]] = {
    "greenhouse": "https://boards-api.greenhouse.io",
    "lever": "https://api.lever.co",
    "lever_eu": "https://api.eu.lever.co",
    "ashby": "https://api.ashbyhq.com",
    "smartrecruiters": "https://api.smartrecruiters.com",
    "workable": "https://apply.workable.com",
    # Workday hosts are per tenant (`https://{tenant}.wd{N}.myworkdayjobs.com`); a test
    # override replaces scheme and host for every tenant.
    "workday": "",
}

_overrides: dict[str, str] = {}


def test_mode() -> bool:
    return os.environ.get(ENV_MODE) == "test"


def set_test_base_urls(urls: dict[str, str] | None) -> None:
    """Replace adapter base URLs (test mode only); `None` clears the overrides."""
    if urls and not test_mode():
        raise UsageError(f"Adapter base URL overrides need {ENV_MODE}=test.")
    _overrides.clear()
    if urls:
        _overrides.update({k: v.rstrip("/") for k, v in urls.items()})


def _env_overrides() -> dict[str, str]:
    raw = os.environ.get(ENV_BASE_URLS)
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    if not isinstance(data, dict):
        return {}
    items = cast(dict[object, object], data).items()
    return {str(k): str(v).rstrip("/") for k, v in items if isinstance(v, str)}


def override_for(key: str) -> str | None:
    if not test_mode():
        return None
    return _overrides.get(key) or _env_overrides().get(key)


def base_url(key: str) -> str:
    """The adapter's API base URL (the official host unless overridden in test mode)."""
    return override_for(key) or DEFAULT_BASE_URLS[key]
