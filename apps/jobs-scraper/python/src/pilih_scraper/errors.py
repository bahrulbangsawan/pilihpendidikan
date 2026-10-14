"""Discovery errors → `CloudRunError` with an actionable message (24 §6, §8).

The class comes from the engine's taxonomy (15 §8) plus the cloud-only classes:
`auth_required` (401, login redirects, login-only pages, paywalls),
`engine_unavailable` (an internal scraper failure) and `invalid_config`.
"""

from __future__ import annotations

import math
from typing import Any
from urllib.parse import urlsplit

from pilih_jobs.discovery.errors import DiscoveryError


class ScrapeStop(Exception):  # noqa: N818 - a stop outcome, not a crash
    """A source-level stop raised by the strategies (cloud-only classes)."""

    def __init__(
        self,
        error_class: str,
        message: str,
        *,
        url: str | None = None,
        http_status: int | None = None,
    ) -> None:
        super().__init__(message)
        self.error_class = error_class
        self.message = message
        self.url = url
        self.http_status = http_status


def _host(url: str | None) -> str:
    return (urlsplit(url).hostname or "the site") if url else "the site"


def _message(exc: DiscoveryError) -> str:
    host = _host(exc.url)
    status = f" (HTTP {exc.http_status})" if exc.http_status else ""
    match exc.error_class:
        case "access_denied":
            return (
                f"Access denied by {host}{status}. The site refuses our honest client; denials "
                "are never retried or worked around. Look for an official feed or API, or "
                "disable the source."
            )
        case "challenge_detected":
            marker = f" ({exc.marker})" if exc.marker else ""
            return (
                f"{host} answered with a bot-protection challenge{marker}{status}. Challenges "
                "are never solved (D-16); the source stays blocked until an operator retries."
            )
        case "robots_disallowed":
            path = urlsplit(exc.url).path if exc.url else "this path"
            return f"robots.txt of {host} disallows {path} for the pilih-jobs user agent."
        case "rate_limited":
            wait = f" Retry after {math.ceil(exc.retry_after_s)} s." if exc.retry_after_s else ""
            return f"Rate limited by {host}{status}.{wait}"
        case "http_5xx" | "source_unavailable":
            return f"{host} is failing{status}; the run will be retried with backoff."
        case "network":
            return f"Network error reaching {host}: {exc.detail[:200]}"
        case "timeout":
            return f"{host} did not answer within 20 s."
        case "source_closed":
            return f"The listing page of {host} no longer exists{status}; check the URL."
        case "not_found":
            return f"Not found on {host}{status}."
        case "schema_invalid":
            return f"Unexpected response structure from {host}: {exc.detail[:250]}"
        case "policy_blocked":
            return f"Refused by policy: {exc.detail[:300]}"
        case "unsupported_content":
            return f"Unsupported response from {host}: {exc.detail[:250]}"
        case _:
            return exc.detail[:500]


def from_discovery(exc: DiscoveryError) -> dict[str, Any]:
    error_class: str = exc.error_class
    message = _message(exc)
    if error_class == "access_denied" and exc.http_status == 401:
        error_class = "auth_required"
        message = (
            f"{_host(exc.url)} requires signing in (HTTP 401). Listings behind a login are "
            "never fetched; the source needs an authorized integration."
        )
    return error_dict(
        error_class,
        message,
        url=exc.url,
        http_status=exc.http_status,
        retry_after_s=exc.retry_after_s,
    )


def from_stop(stop: ScrapeStop) -> dict[str, Any]:
    return error_dict(stop.error_class, stop.message, url=stop.url, http_status=stop.http_status)


def error_dict(
    error_class: str,
    message: str,
    *,
    url: str | None = None,
    http_status: int | None = None,
    retry_after_s: float | None = None,
) -> dict[str, Any]:
    return {
        "error_class": error_class,
        "message": message[:500],
        "http_status": http_status,
        "url": url[:2048] if url else None,
        "retry_after_s": math.ceil(retry_after_s) if retry_after_s is not None else None,
    }
