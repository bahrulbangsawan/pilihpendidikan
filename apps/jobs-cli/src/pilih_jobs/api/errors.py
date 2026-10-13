"""API error envelope → typed exceptions → exit codes (05 §1.3, 16 §3.2).

Every `/api/v1` failure is `{error, message, details?, request_id, reason?, scope?}`.
`error_from_response()` maps it to an `ApiError` subclass whose exit code follows the
stable contract; OAuth endpoint errors (`{error, error_description}`, RFC 6749) map to
`OAuthError`.
"""

from __future__ import annotations

from typing import Any, ClassVar, cast

from pilih_jobs.errors import (
    ConflictError,
    ExitCode,
    NotAuthenticatedError,
    NotFoundError,
    PermissionDeniedError,
    PilihError,
    PolicyRefusedError,
    UnavailableError,
    UpgradeRequiredError,
)

#: Exit code per API error code (16 §3.2); unknown codes fall back to the HTTP status.
ERROR_EXIT_CODES: dict[str, ExitCode] = {
    "invalid_request": ExitCode.FAILURE,
    "invalid_token": ExitCode.NOT_AUTHENTICATED,
    "insufficient_scope": ExitCode.PERMISSION_DENIED,
    "device_revoked": ExitCode.PERMISSION_DENIED,
    "device_not_accepting_tasks": ExitCode.PERMISSION_DENIED,
    "device_required": ExitCode.PERMISSION_DENIED,
    "not_found": ExitCode.NOT_FOUND,
    "revision_conflict": ExitCode.CONFLICT,
    "lease_lost": ExitCode.CONFLICT,
    "idempotency_mismatch": ExitCode.CONFLICT,
    "duplicate": ExitCode.CONFLICT,
    "too_late": ExitCode.CONFLICT,
    "approval_expired": ExitCode.NOT_FOUND,
    "task_expired": ExitCode.NOT_FOUND,
    "cursor_expired": ExitCode.NOT_FOUND,
    "payload_too_large": ExitCode.FAILURE,
    "invalid_transition": ExitCode.CONFLICT,
    "policy_violation": ExitCode.POLICY_REFUSED,
    "unsupported_source": ExitCode.POLICY_REFUSED,
    "mode_not_allowed": ExitCode.POLICY_REFUSED,
    "cli_upgrade_required": ExitCode.UPGRADE_REQUIRED,
    "rate_limited": ExitCode.UNAVAILABLE,
    "ai_budget_exhausted": ExitCode.POLICY_REFUSED,
    "upstream_unavailable": ExitCode.UNAVAILABLE,
}


def exit_code_for(status: int, error: str | None) -> ExitCode:
    if error is not None and error in ERROR_EXIT_CODES:
        return ERROR_EXIT_CODES[error]
    if status == 401:
        return ExitCode.NOT_AUTHENTICATED
    if status == 403:
        return ExitCode.PERMISSION_DENIED
    if status in (404, 410):
        return ExitCode.NOT_FOUND
    if status == 409:
        return ExitCode.CONFLICT
    if status == 422:
        return ExitCode.POLICY_REFUSED
    if status == 426:
        return ExitCode.UPGRADE_REQUIRED
    if status == 429 or status >= 500:
        return ExitCode.UNAVAILABLE
    return ExitCode.FAILURE


class ApiError(PilihError):
    """A non-2xx `/api/v1` response."""

    retryable: ClassVar[bool] = False

    def __init__(
        self,
        *,
        status: int,
        error: str,
        message: str,
        details: dict[str, Any] | None = None,
        request_id: str | None = None,
        reason: str | None = None,
        scope: str | None = None,
        retry_after: float | None = None,
        hint: str | None = None,
    ) -> None:
        super().__init__(
            message or error,
            code=error,
            details=details,
            hint=hint,
            exit_code=exit_code_for(status, error),
        )
        self.status = status
        self.error = error
        self.request_id = request_id
        self.reason = reason
        self.scope = scope
        self.retry_after = retry_after

    def envelope_error(self) -> dict[str, Any]:
        out = super().envelope_error()
        out["status"] = self.status
        if self.request_id:
            out["request_id"] = self.request_id
        if self.reason:
            out["reason"] = self.reason
        if self.scope:
            out["scope"] = self.scope
        return out


class ApiAuthError(ApiError, NotAuthenticatedError):
    """401 invalid_token (`reason`: no_bearer, unknown_token, expired_token, revoked_token)."""


class ApiPermissionError(ApiError, PermissionDeniedError):
    """403: insufficient_scope (step-up with `pilih-jobs login --scope …`) or device errors."""


class ApiNotFoundError(ApiError, NotFoundError):
    """404 not found / not owned, or 410 expired."""


class ApiConflictError(ApiError, ConflictError):
    """409 concurrency errors."""

    @property
    def current(self) -> dict[str, Any] | None:
        """`details.current` of a revision conflict (the full current resource)."""
        value = self.details.get("current")
        return cast(dict[str, Any], value) if isinstance(value, dict) else None


class ApiPolicyError(ApiError, PolicyRefusedError):
    """422 policy violations, unsupported sources, 429 AI budget."""


class ApiUnavailableError(ApiError, UnavailableError):
    """429 rate limited, 5xx, 503 upstream_unavailable — retryable."""

    retryable = True


class ApiUpgradeRequiredError(ApiError, UpgradeRequiredError):
    """426 cli_upgrade_required."""


class NetworkError(UnavailableError):
    """Transport failure (DNS, connect, TLS, timeout): retryable, work stays queued."""

    default_code = "network_error"
    retryable: ClassVar[bool] = True


class OAuthError(PilihError):
    """RFC 6749 §5.2 error from `/oauth/token` (`invalid_grant`, …) or `/oauth/revoke`."""

    default_code = "oauth_error"

    def __init__(self, error: str, description: str | None = None, *, status: int = 400) -> None:
        super().__init__(description or error, code=error)
        self.error = error
        self.status = status


_CLASS_BY_STATUS: dict[int, type[ApiError]] = {
    401: ApiAuthError,
    403: ApiPermissionError,
    404: ApiNotFoundError,
    410: ApiNotFoundError,
    409: ApiConflictError,
    422: ApiPolicyError,
    426: ApiUpgradeRequiredError,
}


def _retry_after(headers: dict[str, str]) -> float | None:
    raw = headers.get("retry-after")
    if raw is None:
        return None
    try:
        return max(0.0, float(raw))
    except ValueError:
        return None


def error_from_response(status: int, payload: Any, headers: dict[str, str]) -> ApiError:
    body = cast(dict[str, Any], payload) if isinstance(payload, dict) else {}
    error = str(body.get("error") or f"http_{status}")
    message = str(body.get("message") or body.get("error_description") or f"HTTP {status}")
    details = body.get("details")
    if status == 429 and error == "ai_budget_exhausted":
        cls: type[ApiError] = ApiPolicyError
    elif status == 429 or status >= 500:
        cls = ApiUnavailableError
    else:
        cls = _CLASS_BY_STATUS.get(status, ApiError)
    hint: str | None = None
    scope = body.get("scope")
    if error == "insufficient_scope" and isinstance(scope, str):
        hint = f"pilih-jobs login --scope {scope}"
    elif status == 426:
        hint = "pilih-jobs update"
    elif status == 401:
        hint = "pilih-jobs login"
    return cls(
        status=status,
        error=error,
        message=message,
        details=cast(dict[str, Any], details) if isinstance(details, dict) else None,
        request_id=cast(str | None, body.get("request_id")),
        reason=cast(str | None, body.get("reason")),
        scope=scope if isinstance(scope, str) else None,
        retry_after=_retry_after(headers),
        hint=hint,
    )
