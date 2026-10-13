"""Exit codes (16 §3.2, a stable contract) and the exception hierarchy that maps to them.

Every module raises a `PilihError` subclass; the CLI turns it into the JSON error
envelope `{"ok": false, "error": {code, message, details}}` or a Rich message, and
exits with `exit_code`. Messages are user-facing and never contain secrets.
"""

from __future__ import annotations

from enum import IntEnum
from typing import Any, ClassVar


class ExitCode(IntEnum):
    OK = 0
    FAILURE = 1
    USAGE = 2
    NOT_AUTHENTICATED = 3
    PERMISSION_DENIED = 4
    NOT_FOUND = 5
    CONFLICT = 6
    UNAVAILABLE = 7
    PAUSED = 8
    POLICY_REFUSED = 9
    UPGRADE_REQUIRED = 10
    INTERRUPTED = 130


class PilihError(Exception):
    """Base error: a user-facing message, a machine `code` and an exit code."""

    exit_code: ClassVar[ExitCode] = ExitCode.FAILURE
    default_code: ClassVar[str] = "error"

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        details: dict[str, Any] | None = None,
        hint: str | None = None,
        exit_code: ExitCode | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code or self.default_code
        self.details: dict[str, Any] = dict(details or {})
        self.hint = hint
        self._exit_code = exit_code

    @property
    def exit(self) -> ExitCode:
        return self._exit_code if self._exit_code is not None else self.exit_code

    def envelope_error(self) -> dict[str, Any]:
        error: dict[str, Any] = {"code": self.code, "message": self.message}
        if self.details:
            error["details"] = self.details
        if self.hint:
            error["hint"] = self.hint
        return error


class UsageError(PilihError):
    exit_code = ExitCode.USAGE
    default_code = "usage_error"


class ConfigError(UsageError):
    default_code = "invalid_config"


class NotAuthenticatedError(PilihError):
    exit_code = ExitCode.NOT_AUTHENTICATED
    default_code = "not_authenticated"

    def __init__(self, message: str = "Not signed in. Run `pilih-jobs login`.", **kw: Any) -> None:
        kw.setdefault("hint", "pilih-jobs login")
        super().__init__(message, **kw)


class PermissionDeniedError(PilihError):
    exit_code = ExitCode.PERMISSION_DENIED
    default_code = "permission_denied"


class NotFoundError(PilihError):
    exit_code = ExitCode.NOT_FOUND
    default_code = "not_found"


class ConflictError(PilihError):
    exit_code = ExitCode.CONFLICT
    default_code = "conflict"


class UnavailableError(PilihError):
    """Network down / server unavailable; work stays in the outbox (16 §14)."""

    exit_code = ExitCode.UNAVAILABLE
    default_code = "unavailable"


class InputRequiredError(PilihError):
    """A decision is needed but the session is non-interactive (16 §4)."""

    exit_code = ExitCode.PAUSED
    default_code = "input_required"


class PausedError(PilihError):
    exit_code = ExitCode.PAUSED
    default_code = "paused"


class PolicyRefusedError(PilihError):
    exit_code = ExitCode.POLICY_REFUSED
    default_code = "policy_refused"


class UpgradeRequiredError(PilihError):
    exit_code = ExitCode.UPGRADE_REQUIRED
    default_code = "cli_upgrade_required"


class CredentialStoreError(PilihError):
    """No secure credential backend (16 §11): login refuses instead of storing in plaintext."""

    default_code = "credential_store_unavailable"


class Interrupted(PilihError):  # noqa: N818 - matches the exit-code name
    exit_code = ExitCode.INTERRUPTED
    default_code = "interrupted"
