"""TCLI-EXIT: exit codes are a stable contract (16 §3.2) and API errors map onto them."""

from __future__ import annotations

import pytest

from pilih_jobs.api.errors import (
    ApiAuthError,
    ApiConflictError,
    ApiNotFoundError,
    ApiPermissionError,
    ApiPolicyError,
    ApiUnavailableError,
    ApiUpgradeRequiredError,
    error_from_response,
    exit_code_for,
)
from pilih_jobs.errors import (
    ConfigError,
    ExitCode,
    InputRequiredError,
    Interrupted,
    NotAuthenticatedError,
    PolicyRefusedError,
    UnavailableError,
    UpgradeRequiredError,
)


def test_TCLI_EXIT_codes_are_stable() -> None:
    assert {c.name: c.value for c in ExitCode} == {
        "OK": 0,
        "FAILURE": 1,
        "USAGE": 2,
        "NOT_AUTHENTICATED": 3,
        "PERMISSION_DENIED": 4,
        "NOT_FOUND": 5,
        "CONFLICT": 6,
        "UNAVAILABLE": 7,
        "PAUSED": 8,
        "POLICY_REFUSED": 9,
        "UPGRADE_REQUIRED": 10,
        "INTERRUPTED": 130,
    }


@pytest.mark.parametrize(
    ("status", "error", "expected"),
    [
        (400, "invalid_request", ExitCode.FAILURE),
        (401, "invalid_token", ExitCode.NOT_AUTHENTICATED),
        (403, "insufficient_scope", ExitCode.PERMISSION_DENIED),
        (403, "device_revoked", ExitCode.PERMISSION_DENIED),
        (404, "not_found", ExitCode.NOT_FOUND),
        (409, "revision_conflict", ExitCode.CONFLICT),
        (409, "lease_lost", ExitCode.CONFLICT),
        (410, "approval_expired", ExitCode.NOT_FOUND),
        (422, "policy_violation", ExitCode.POLICY_REFUSED),
        (422, "unsupported_source", ExitCode.POLICY_REFUSED),
        (426, "cli_upgrade_required", ExitCode.UPGRADE_REQUIRED),
        (429, "rate_limited", ExitCode.UNAVAILABLE),
        (503, "upstream_unavailable", ExitCode.UNAVAILABLE),
        (502, "http_502", ExitCode.UNAVAILABLE),
    ],
)
def test_TCLI_EXIT_api_error_mapping(status: int, error: str, expected: ExitCode) -> None:
    assert exit_code_for(status, error) == expected
    exc = error_from_response(status, {"error": error, "message": "m", "request_id": "r"}, {})
    assert exc.exit == expected


def test_TCLI_EXIT_error_classes_and_hints() -> None:
    scope = error_from_response(
        403,
        {
            "error": "insufficient_scope",
            "message": "m",
            "request_id": "r",
            "scope": "devices:manage",
        },
        {},
    )
    assert isinstance(scope, ApiPermissionError)
    assert scope.hint == "pilih-jobs login --scope devices:manage"
    assert isinstance(
        error_from_response(401, {"error": "invalid_token", "reason": "expired_token"}, {}),
        ApiAuthError,
    )
    assert isinstance(error_from_response(404, {}, {}), ApiNotFoundError)
    conflict = error_from_response(
        409, {"error": "revision_conflict", "details": {"current": {"revision": 9}}}, {}
    )
    assert isinstance(conflict, ApiConflictError)
    assert conflict.current == {"revision": 9}
    assert isinstance(
        error_from_response(426, {"error": "cli_upgrade_required"}, {}), ApiUpgradeRequiredError
    )
    assert isinstance(error_from_response(422, {"error": "policy_violation"}, {}), ApiPolicyError)
    limited = error_from_response(429, {"error": "rate_limited"}, {"retry-after": "12"})
    assert isinstance(limited, ApiUnavailableError)
    assert limited.retry_after == 12.0
    budget = error_from_response(429, {"error": "ai_budget_exhausted"}, {})
    assert budget.exit == ExitCode.POLICY_REFUSED


def test_TCLI_EXIT_local_errors() -> None:
    assert NotAuthenticatedError().exit == ExitCode.NOT_AUTHENTICATED
    assert ConfigError("x").exit == ExitCode.USAGE
    assert InputRequiredError("x").exit == ExitCode.PAUSED
    assert PolicyRefusedError("x").exit == ExitCode.POLICY_REFUSED
    assert UnavailableError("x").exit == ExitCode.UNAVAILABLE
    assert UpgradeRequiredError("x").exit == ExitCode.UPGRADE_REQUIRED
    assert Interrupted("x").exit == ExitCode.INTERRUPTED
    envelope = InputRequiredError(
        "need", details={"needed": {"approval_id": "apr_1"}}
    ).envelope_error()
    assert envelope == {
        "code": "input_required",
        "message": "need",
        "details": {"needed": {"approval_id": "apr_1"}},
    }
