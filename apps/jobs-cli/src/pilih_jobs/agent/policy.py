"""PolicyEngine: the autonomy table of 19 §8.1 per mode, and the auto preconditions (§8.3).

Columns: Situation / assisted / approval / auto.

- fill validated fact/answer values: assisted act; approval act; auto act
- needs_human, optional field: assisted pause; approval approval `answer`; auto skip
- needs_human, required field: assisted pause; approval approval `answer`; auto stop
  `missing_information`
- protected-class question: assisted pause; approval approval `answer`; auto stop
- generated text: assisted pause (shown); approval in the submit approval; auto stop if
  required, else skip
- challenge / login / account / OTP: assisted pause; approval pause; auto stop (back to
  approval)
- credential field / payment: assisted pause; approval pause; auto stop
- external redirect: assisted pause `off_domain…`; approval pause `off_domain…`; auto stop
  `domain_not_allowed`
- low confidence: assisted pause; approval pause; auto stop
- validation error, first: assisted retry once; approval retry once; auto retry once
- validation error, repeated: assisted pause; approval pause; auto stop
- navigation timeout / transient network: assisted retry once; approval retry once; auto retry
  once
- browser crash before submit_intent: assisted relaunch once; approval relaunch once; auto
  relaunch once
- anything after submit_intent, no proof: assisted outcome_unknown; approval outcome_unknown;
  auto outcome_unknown
- final submit: assisted the user clicks; approval agent, after approval; auto agent, if §8.3
  holds
- budget exceeded: assisted pause `resource…`; approval pause `resource…`; auto stop
  `budget_exceeded`
- AI unavailable: assisted pause `ai_unavail…`; approval pause `ai_unavail…`; auto pause
  `ai_unavailable`
- injection suspected: assisted flag in approval; approval flag in approval; auto stop
  `injection_suspected`
- unclear page / stuck loop: assisted pause; approval pause; auto stop
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Final, Literal

Mode = Literal["assisted", "approval", "auto"]
DecisionKind = Literal[
    "act",
    "pause",
    "approval",
    "skip",
    "stop",
    "retry",
    "relaunch",
    "outcome_unknown",
    "user_clicks",
    "agent_clicks",
    "flag",
]
Situation = Literal[
    "fill_validated",
    "needs_human_optional",
    "needs_human_required",
    "protected_question",
    "generated_text_required",
    "generated_text_optional",
    "challenge",
    "credential_field",
    "payment_requested",
    "external_redirect",
    "low_confidence",
    "validation_first",
    "validation_repeated",
    "navigation_timeout",
    "browser_crash_before_intent",
    "after_intent_no_evidence",
    "final_submit",
    "budget_exceeded",
    "ai_unavailable",
    "injection_suspected",
    "unclear_page",
    "stuck_loop",
]
#: Challenge pause reasons (18 §8) the `challenge` situation accepts.
CHALLENGE_REASONS: Final = frozenset(
    {"captcha_or_challenge", "login_required", "account_creation_required", "mfa_required"}
)


@dataclass(frozen=True)
class Decision:
    kind: DecisionKind
    pause_reason: str | None = None
    error_class: str | None = None
    retryable: bool = False
    #: auto stops that hand the task back to approval mode (19 §8.1).
    back_to_approval: bool = False


def _same(decision: Decision) -> dict[Mode, Decision]:
    return {"assisted": decision, "approval": decision, "auto": decision}


_TABLE: Final[dict[Situation, dict[Mode, Decision]]] = {
    "fill_validated": _same(Decision("act")),
    "needs_human_optional": {
        "assisted": Decision("pause", "missing_information"),
        "approval": Decision("approval", "missing_information"),
        "auto": Decision("skip"),
    },
    "needs_human_required": {
        "assisted": Decision("pause", "missing_information"),
        "approval": Decision("approval", "missing_information"),
        "auto": Decision("stop", error_class="missing_information", back_to_approval=True),
    },
    "protected_question": {
        "assisted": Decision("pause", "protected_question"),
        "approval": Decision("approval", "protected_question"),
        "auto": Decision("stop", error_class="protected_question", back_to_approval=True),
    },
    "generated_text_required": {
        "assisted": Decision("pause", "missing_information"),
        "approval": Decision("act"),
        "auto": Decision("stop", error_class="missing_information", back_to_approval=True),
    },
    "generated_text_optional": {
        "assisted": Decision("pause", "missing_information"),
        "approval": Decision("act"),
        "auto": Decision("skip"),
    },
    "challenge": {
        "assisted": Decision("pause"),
        "approval": Decision("pause"),
        "auto": Decision("stop", back_to_approval=True),
    },
    "credential_field": {
        "assisted": Decision("pause", "credential_field"),
        "approval": Decision("pause", "credential_field"),
        "auto": Decision("stop", error_class="policy_violation", back_to_approval=True),
    },
    "payment_requested": {
        "assisted": Decision("pause", "payment_requested"),
        "approval": Decision("pause", "payment_requested"),
        "auto": Decision("stop", error_class="policy_violation"),
    },
    "external_redirect": {
        "assisted": Decision("pause", "off_domain_navigation"),
        "approval": Decision("pause", "off_domain_navigation"),
        "auto": Decision("stop", error_class="domain_not_allowed"),
    },
    "low_confidence": {
        "assisted": Decision("pause", "low_confidence"),
        "approval": Decision("pause", "low_confidence"),
        "auto": Decision("stop", error_class="unsupported_form", back_to_approval=True),
    },
    "validation_first": _same(Decision("retry")),
    "validation_repeated": {
        "assisted": Decision("pause", "validation_unresolved"),
        "approval": Decision("pause", "validation_unresolved"),
        "auto": Decision("stop", error_class="validation_errors_unresolved"),
    },
    "navigation_timeout": _same(
        Decision("retry", error_class="navigation_timeout", retryable=True)
    ),
    "browser_crash_before_intent": _same(
        Decision("relaunch", error_class="browser_crashed", retryable=True)
    ),
    "after_intent_no_evidence": _same(Decision("outcome_unknown")),
    "final_submit": {
        "assisted": Decision("user_clicks"),
        "approval": Decision("agent_clicks"),
        "auto": Decision("agent_clicks"),
    },
    "budget_exceeded": {
        "assisted": Decision("pause", "resource_exhausted"),
        "approval": Decision("pause", "resource_exhausted"),
        "auto": Decision("stop", error_class="budget_exceeded"),
    },
    "ai_unavailable": _same(Decision("pause", "ai_unavailable", retryable=True)),
    "injection_suspected": {
        "assisted": Decision("flag"),
        "approval": Decision("flag"),
        "auto": Decision("stop", error_class="injection_suspected", back_to_approval=True),
    },
    "unclear_page": {
        "assisted": Decision("pause", "unclear_page"),
        "approval": Decision("pause", "unclear_page"),
        "auto": Decision("stop", error_class="unsupported_form", back_to_approval=True),
    },
    "stuck_loop": {
        "assisted": Decision("pause", "stuck_loop"),
        "approval": Decision("pause", "stuck_loop"),
        "auto": Decision("stop", error_class="unsupported_form"),
    },
}


class PolicyEngine:
    def __init__(self, mode: Mode) -> None:
        self.mode: Mode = mode

    @staticmethod
    def table() -> dict[Situation, dict[Mode, Decision]]:
        return {k: dict(v) for k, v in _TABLE.items()}

    def decide(self, situation: Situation, *, reason: str | None = None) -> Decision:
        decision = _TABLE[situation][self.mode]
        if situation == "challenge":
            if reason not in CHALLENGE_REASONS:
                raise ValueError(f"not a challenge pause reason: {reason!r}")
            if decision.kind == "pause":
                return Decision("pause", reason)
            return Decision("stop", error_class=reason, back_to_approval=True)
        return decision

    def situation_for_pause(self, reason: str) -> Situation:
        """Map a detector / validator pause reason to its table row."""
        if reason in CHALLENGE_REASONS:
            return "challenge"
        mapping: dict[str, Situation] = {
            "credential_field": "credential_field",
            "payment_requested": "payment_requested",
            "off_domain_navigation": "external_redirect",
            "low_confidence": "low_confidence",
            "validation_unresolved": "validation_repeated",
            "resource_exhausted": "budget_exceeded",
            "ai_unavailable": "ai_unavailable",
            "injection_suspected": "injection_suspected",
            "unclear_page": "unclear_page",
            "stuck_loop": "stuck_loop",
            "protected_question": "protected_question",
            "missing_information": "needs_human_required",
        }
        return mapping.get(reason, "unclear_page")

    def decide_pause(self, reason: str) -> Decision:
        situation = self.situation_for_pause(reason)
        if situation == "challenge":
            return self.decide("challenge", reason=reason)
        decision = self.decide(situation)
        if decision.kind == "pause" and decision.pause_reason is None:
            return Decision("pause", reason)
        if decision.kind in ("approval", "flag"):
            return Decision("pause", reason)
        return decision


# ------------------------------------------------------------------ auto (19 §8.3)
AUTO_VALUE_SOURCES: Final = frozenset({"fact", "answer", "option", "cv_file", "cover_letter_file"})


@dataclass
class AutoFacts:
    """Per-application facts the auto submit precondition needs (19 §8.3)."""

    rule_id: str | None
    adapter_auto_ok: bool
    value_sources: Iterable[str]
    generated_text: bool
    protected_answer: bool
    paused_this_attempt: bool
    injection_suspected: bool
    page_kind_confidence: float | None
    form_recognized: bool
    domain_allowlisted: bool


def auto_precondition_failures(facts: AutoFacts) -> list[str]:
    failures: list[str] = []
    if not facts.rule_id:
        failures.append("no_active_rule")
    if not facts.adapter_auto_ok:
        failures.append("adapter_not_auto_ok")
    if any(source not in AUTO_VALUE_SOURCES for source in facts.value_sources):
        failures.append("value_source_not_allowed")
    if facts.generated_text:
        failures.append("generated_text")
    if facts.protected_answer:
        failures.append("protected_answer")
    if facts.paused_this_attempt:
        failures.append("paused_this_attempt")
    if facts.injection_suspected:
        failures.append("injection_suspected")
    if facts.page_kind_confidence is None or facts.page_kind_confidence < 0.85:
        failures.append("page_kind_confidence")
    if not facts.form_recognized:
        failures.append("form_not_recognized")
    if not facts.domain_allowlisted:
        failures.append("domain_not_allowlisted")
    return failures
