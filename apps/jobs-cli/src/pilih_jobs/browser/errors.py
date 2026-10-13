"""Browser-layer errors (18). Each carries the task `error_class` it maps to (21 §8).

Playwright exceptions never leave `pilih_jobs.browser`: the session, observer and executor
translate them into these classes so the agent loop (which may not import Playwright,
16 §2.1) can decide on retry, pause or stop.
"""

from __future__ import annotations

from typing import Any, ClassVar

from pilih_jobs.errors import ExitCode, PilihError


class BrowserError(PilihError):
    """Base class: `error_class` is the task error class (21 §8)."""

    error_class: ClassVar[str] = "browser_error"
    retryable: ClassVar[bool] = False

    def __init__(self, message: str, *, details: dict[str, Any] | None = None, **kw: Any) -> None:
        kw.setdefault("code", self.error_class)
        super().__init__(message, details=details, **kw)


# ------------------------------------------------------------------ profiles (18 §4)
class ProfileLockedError(BrowserError):
    error_class = "profile_locked"
    exit_code = ExitCode.CONFLICT


class DefaultProfileRefusedError(BrowserError):
    error_class = "default_profile_refused"
    exit_code = ExitCode.POLICY_REFUSED


class ProfileNewerThanBrowserError(BrowserError):
    error_class = "profile_newer_than_browser"


class ProfileNotFoundError(BrowserError):
    error_class = "profile_not_found"
    exit_code = ExitCode.NOT_FOUND


class ProfilePurposeError(BrowserError):
    """Discovery and application profiles are never shared (18 §3.4)."""

    error_class = "profile_purpose_mismatch"
    exit_code = ExitCode.POLICY_REFUSED


# ------------------------------------------------------------------ modes (18 §3)
class CdpNonLoopbackError(BrowserError):
    error_class = "cdp_non_loopback"
    exit_code = ExitCode.POLICY_REFUSED


class CdpUnavailableError(BrowserError):
    error_class = "cdp_unavailable"
    exit_code = ExitCode.UNAVAILABLE


class CdpVersionError(BrowserError):
    error_class = "cdp_browser_too_old"


class ModeNotAllowedError(BrowserError):
    """`auto` refuses Mode B (18 §3.2)."""

    error_class = "mode_not_allowed"
    exit_code = ExitCode.POLICY_REFUSED


class BrowserNotInstalledError(BrowserError):
    error_class = "browser_not_installed"


class HeadedUnavailableError(BrowserError):
    """A headed window is required (18 §5) but this machine has no display."""

    error_class = "headed_browser_unavailable"


# ------------------------------------------------------------------ runtime (18 §9)
class BrowserCrashedError(BrowserError):
    error_class = "browser_crashed"
    retryable = True


class PageClosedError(BrowserError):
    """The user closed our tab or window (18 §9)."""

    error_class = "cancelled"


class NavigationTimeoutError(BrowserError):
    error_class = "navigation_timeout"
    retryable = True


class NetworkOfflineError(BrowserError):
    error_class = "network_offline"
    retryable = True


class NavigationBlockedError(BrowserError):
    """The navigation guard refused a URL (scheme or excluded platform)."""

    error_class = "domain_not_allowed"
    exit_code = ExitCode.POLICY_REFUSED


class LeaseLostError(BrowserError):
    """The lease was lost: stop acting in the browser immediately (21 §5.3)."""

    error_class = "lease_lost"


# ------------------------------------------------------------------ executor (18 §6.3)
class ActionRejectedError(BrowserError):
    """An action outside the closed set, or a failed precondition: nothing was done."""

    error_class = "action_rejected"

    def __init__(self, message: str, *, reason: str, **kw: Any) -> None:
        details = dict(kw.pop("details", None) or {})
        details["reason"] = reason
        super().__init__(message, details=details, **kw)
        self.reason = reason


class CredentialFieldError(ActionRejectedError):
    """Password / PIN / OTP fields are never typed by the agent (18 §4.3)."""

    error_class = "credential_field"


class StaleRefError(ActionRejectedError):
    """The ref vanished and its signature is missing or ambiguous (18 §6.2)."""

    error_class = "stale_ref"


class ActionsDisabledError(ActionRejectedError):
    """The page is off the allowlist: observe only (18 §7.4)."""

    error_class = "domain_not_allowed"


class SubmitNotAuthorizedError(ActionRejectedError):
    """A submit click without a fresh `submit_intent` authorization (19 §8.2)."""

    error_class = "submit_not_authorized"


class PostconditionError(BrowserError):
    """The action ran but its postcondition did not hold (18 §6.3)."""

    error_class = "postcondition_failed"

    def __init__(self, message: str, *, check: str, **kw: Any) -> None:
        details = dict(kw.pop("details", None) or {})
        details["check"] = check
        super().__init__(message, details=details, **kw)
        self.check = check


class ActionTimeoutError(BrowserError):
    error_class = "selector_not_found"
    retryable = True


# ------------------------------------------------------------------ staging (18 §7.1)
class ArtifactIntegrityError(BrowserError):
    error_class = "artifact_integrity"


class UploadPathError(BrowserError):
    """An upload path outside the staging directory, or a symlink (11 §4.6)."""

    error_class = "policy_violation"
    exit_code = ExitCode.POLICY_REFUSED
