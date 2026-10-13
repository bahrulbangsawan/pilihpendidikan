"""Discovery error taxonomy (15 §8) and the policy exception (15 §13, D-16, D-17).

Every failure inside discovery is a `DiscoveryError(error_class, …)`; raw Scrapling,
curl_cffi or Playwright exceptions never leave the engine package. `PolicyViolation`
is raised before any network call when a forbidden feature or an excluded source is
requested; it maps to exit code 9 (16 §3.2).
"""

from __future__ import annotations

from typing import Any, Final, Literal, get_args

from pilih_jobs.errors import PolicyRefusedError

ErrorClass = Literal[
    "network",
    "timeout",
    "http_5xx",
    "rate_limited",
    "access_denied",
    "challenge_detected",
    "robots_disallowed",
    "not_found",
    "source_closed",
    "source_unavailable",
    "parse_error",
    "schema_invalid",
    "selector_drift",
    "unsupported_content",
    "policy_blocked",
    "cancelled",
]
ERROR_CLASSES: Final[tuple[str, ...]] = get_args(ErrorClass)

#: Classes the wrapper retries with backoff (15 §7.2, §8).
RETRYABLE: Final = frozenset({"network", "timeout", "http_5xx", "rate_limited"})

#: Classes that stop the whole source for this run once they leave the engine (15 §8):
#: `rate_limited` only escapes after the bounded retries or a Retry-After over 15 min.
SOURCE_FATAL: Final = frozenset(
    {
        "access_denied",
        "rate_limited",
        "challenge_detected",
        "source_closed",
        "source_unavailable",
        "schema_invalid",
        "unsupported_content",
        "policy_blocked",
        "cancelled",
    }
)

#: Stops that make a source run incomplete for expiry purposes (15 §9).
INCOMPLETE_STOPS: Final = frozenset({"access_denied", "rate_limited", "challenge_detected"})


class DiscoveryError(Exception):
    """A classified discovery failure (15 §8)."""

    def __init__(
        self,
        error_class: ErrorClass,
        detail: str = "",
        *,
        retryable: bool | None = None,
        http_status: int | None = None,
        url: str | None = None,
        retry_after_s: float | None = None,
        marker: str | None = None,
    ) -> None:
        super().__init__(detail or error_class)
        self.error_class: ErrorClass = error_class
        self.detail = detail or error_class
        self.retryable = error_class in RETRYABLE if retryable is None else retryable
        self.http_status = http_status
        self.url = url
        self.retry_after_s = retry_after_s
        self.marker = marker

    def as_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"error_class": self.error_class, "message": self.detail[:500]}
        if self.http_status is not None:
            out["http_status"] = self.http_status
        if self.url:
            out["url"] = self.url[:2048]
        return out

    def __repr__(self) -> str:
        return (
            f"DiscoveryError({self.error_class!r}, {self.detail!r}, http_status={self.http_status})"
        )


class PolicyViolation(PolicyRefusedError):  # noqa: N818 - the spec's name (15 §13)
    """A forbidden feature or an excluded source was requested (D-16, D-17)."""

    default_code = "policy_violation"


class ExcludedSourceError(PolicyViolation):
    """LinkedIn / Indeed (D-17): refused by the registry before any request."""

    default_code = "unsupported_source"


def is_error_class(value: str) -> bool:
    return value in ERROR_CLASSES
