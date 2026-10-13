"""Errors of the task protocol (21 §5.3 fencing, §6.5 submit intent, 08 §8 integrity)."""

from __future__ import annotations

from pilih_jobs.errors import (
    ConflictError,
    PilihError,
    PolicyRefusedError,
    UnavailableError,
)


class LeaseLostError(ConflictError):
    """The lease is gone (409 `lease_lost`, 401 revoked, or the 110 s local deadline).

    The executor must stop acting at once and never report again under this lease.
    """

    default_code = "lease_lost"


class LeaseStalledError(UnavailableError):
    """No successful heartbeat for 90 s: browser work pauses and nothing is submitted."""

    default_code = "lease_stalled"


class DryRunRefusedError(PolicyRefusedError):
    """`apply --dry-run` never sends `submit_intent` (16 §3.3)."""

    default_code = "dry_run"


class ArtifactIntegrityError(PilihError):
    """A downloaded file did not match its SHA-256 / ETag; the copy was deleted (08 §8)."""

    default_code = "artifact_integrity"


class AlreadyRunningError(ConflictError):
    """Another local process drives this application or holds the worker lock (21 §9)."""

    default_code = "already_running"
