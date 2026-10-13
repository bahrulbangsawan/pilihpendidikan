"""Submission verification (19 §9.1) and how a verdict maps to the result (19 §9.2).

```text
deterministic_positive = url_match OR (dom_marker AND form_gone)
deterministic_negative = negative_marker
if deterministic_negative: negative
else:
  ai_positive = application_received ≥ 0.85 AND still_form_or_error < 0.30
  both positive → verified; one positive → unverified
  still_form_or_error ≥ 0.70 → negative
  else unverified if xhr_2xx else outcome_unknown
```

It mirrors `computeVerificationVerdict` in `packages/jobs-contracts/src/agent.ts`.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Final, Literal

Verdict = Literal["verified", "unverified", "negative", "outcome_unknown"]

VERIFY_RECEIVED: Final = 0.85
VERIFY_STILL_FORM_MAX: Final = 0.30
VERIFY_NEGATIVE: Final = 0.70


def _prob(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    return float(value)


def deterministic_positive(signals: Mapping[str, Any]) -> bool:
    return signals.get("url_match") is True or (
        signals.get("dom_marker") is True and signals.get("form_gone") is True
    )


def compute_verdict(signals: Mapping[str, Any], ai: Mapping[str, Any] | None) -> Verdict:
    """The 19 §9.1 algorithm; `ai` is None when the call was not made or failed."""
    if signals.get("negative_marker") is True:
        return "negative"
    positive = deterministic_positive(signals)
    received = _prob(ai.get("application_received")) if ai else None
    still = _prob(ai.get("still_form_or_error")) if ai else None
    ai_positive = (
        received is not None
        and still is not None
        and received >= VERIFY_RECEIVED
        and still < VERIFY_STILL_FORM_MAX
    )
    if positive and ai_positive:
        return "verified"
    if positive or ai_positive:
        return "unverified"
    if still is not None and still >= VERIFY_NEGATIVE:
        return "negative"
    return "unverified" if signals.get("xhr_2xx") is True else "outcome_unknown"


@dataclass(frozen=True)
class VerdictResult:
    outcome: Literal["submitted", "failed", "outcome_unknown"]
    evidence_verdict: Literal["verified", "unverified", "negative"]
    submission_status: str


#: 19 §9.2 — negative goes back to the loop at most once before `failed`.
VERDICT_RESULTS: Final[dict[Verdict, VerdictResult]] = {
    "verified": VerdictResult("submitted", "verified", "submitted_verified"),
    "unverified": VerdictResult("submitted", "unverified", "submitted_unverified"),
    "negative": VerdictResult("failed", "negative", "failed"),
    "outcome_unknown": VerdictResult("outcome_unknown", "unverified", "outcome_unknown"),
}
