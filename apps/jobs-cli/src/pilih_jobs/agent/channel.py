"""How the agent reads errors raised by `LeaseChannel` calls (21 §5.3, 19 §8.1, 05 §9).

- **lease lost** — `409 lease_lost` (and any other fencing conflict) or `401` (revoked
  device / token): stop acting in the browser at once and never report under the lease;
- **refused** — other API errors (`422 policy_violation` with a `details.reason`,
  `409 duplicate`): this call was refused, nothing was recorded;
- **AI unavailable** — `503 upstream_unavailable` (incl. `details.reason = ai_disabled`),
  `429 ai_budget_exhausted`, `422 policy_violation` with `details.reason =
  ai_consent_required`: pause `ai_unavailable` (the agent never acts without AI decisions);
- **offline** — transport failures (`NetworkError`) and other 5xx / 429.
"""

from __future__ import annotations

from typing import Any, Final, Literal, cast

from pilih_jobs.api.errors import ApiError, NetworkError
from pilih_jobs.errors import ConflictError, NotAuthenticatedError, UnavailableError

ErrorKind = Literal["lease_lost", "ai_unavailable", "offline", "refused", "other"]

AI_UNAVAILABLE_CODES: Final = frozenset({"upstream_unavailable", "ai_budget_exhausted"})
AI_UNAVAILABLE_REASONS: Final = frozenset({"ai_consent_required", "ai_disabled"})
REFUSAL_409_CODES: Final = frozenset({"duplicate", "too_late", "invalid_transition"})


def _status(exc: BaseException) -> int | None:
    status: Any = getattr(exc, "status", None)
    return status if isinstance(status, int) else None


def _code(exc: BaseException) -> str:
    for attr in ("error", "code"):
        value: Any = getattr(exc, attr, None)
        if isinstance(value, str) and value:
            return value
    return ""


def _reason(exc: BaseException) -> str:
    details: Any = getattr(exc, "details", None)
    if isinstance(details, dict):
        reason: Any = cast(dict[str, Any], details).get("reason")
        if isinstance(reason, str):
            return reason
    value: Any = getattr(exc, "reason", None)
    return value if isinstance(value, str) else ""


def classify_channel_error(exc: BaseException) -> ErrorKind:
    status = _status(exc)
    code = _code(exc)
    if code == "lease_lost" or status == 401 or isinstance(exc, NotAuthenticatedError):
        return "lease_lost"
    if status == 409 or isinstance(exc, ConflictError):
        # 409 `duplicate` / `too_late` are refusals of this call; any other 409 on a
        # lease route is fencing (21 §5.3).
        return "refused" if code in REFUSAL_409_CODES else "lease_lost"
    if code in AI_UNAVAILABLE_CODES or _reason(exc) in AI_UNAVAILABLE_REASONS:
        return "ai_unavailable"
    if isinstance(exc, NetworkError) or (
        isinstance(exc, UnavailableError) and not isinstance(exc, ApiError)
    ):
        return "offline"
    if status is not None and (status >= 500 or status == 429):
        return "offline"
    if isinstance(exc, ApiError):
        return "refused"
    return "other"
