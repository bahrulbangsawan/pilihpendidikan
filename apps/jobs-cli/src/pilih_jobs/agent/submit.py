"""The submit gate (19 §8.2, 21 §6.3–§6.5, D-19, D-28).

```text
1. Re-observe. Require: no errors[], every required field has a value, every upload
   verified, no pending needs_human, page_kind ∈ {application_form, review_page}, domain
   allowlisted, lease valid.
2. payload = {form_hash, fields:[{label, value_display, value_source, sensitivity,
   ai_written}], attachments:[{file_id, sha256, name}], url, posting_id};
   payload_hash = sha256(canonical_json(payload)); protected values are shown as
   "(your saved answer)".
3. approval: create a `submit` approval → wait (24 h); approved with the same hash →
   continue; rejected / expired → cancelled; form changed → a new approval.
   auto: the §8.3 preconditions, else the approval flow when the user is reachable.
4. POST submit-intent {form_hash, approval_id | rule_id} — synchronous; require 200
   BEFORE clicking. Failure → do NOT click; retry ≤ 3×, then pause `network_offline`.
5. Click submit (no second click, ever) → verification.
```

This module builds the payload, checks the requirements and talks to the channel; the
click itself is the executor's, and only with the `SubmitAuthorization` issued here.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final, Literal, cast

from pydantic import ValidationError

from pilih_jobs.agent.channel import classify_channel_error
from pilih_jobs.agent.types import LeaseChannel
from pilih_jobs.agent.validate import PlannedItem
from pilih_jobs.browser.actions import SubmitAuthorization
from pilih_jobs.browser.errors import LeaseLostError
from pilih_jobs.browser.observer import ControlState, FieldState, Observation
from pilih_jobs.browser.staging import StagedFile
from pilih_jobs.contracts._generated.records import BrowserSubmitApprovalPayload
from pilih_jobs.policy.sensitivity import protected_category
from pilih_jobs.policy.untrusted import clip

PROTECTED_DISPLAY: Final = "(your saved answer)"
GATE_PAGE_KINDS: Final = frozenset({"application_form", "review_page"})


def canonical_json(value: Any) -> str:
    """Object keys sorted at every level (mirrors `canonicalJson` in apps/api)."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def payload_hash(payload: Mapping[str, Any]) -> str:
    return hashlib.sha256(canonical_json(payload).encode("utf-8")).hexdigest()


# ------------------------------------------------------------------ requirements
def gate_problems(
    obs: Observation,
    *,
    page_kind: str,
    plan_items: Sequence[PlannedItem],
    lease_lost: bool,
) -> list[str]:
    """Step 1 of the gate; an empty list means the form may be submitted."""
    problems: list[str] = []
    if lease_lost:
        problems.append("lease_lost")
    if page_kind not in GATE_PAGE_KINDS:
        problems.append(f"page_kind:{page_kind}")
    if not obs.allowlisted:
        problems.append("domain_not_allowlisted")
    if obs.errors:
        problems.append("errors")
    problems.extend(
        f"required_empty:{f.ref}"
        for f in obs.fields
        if f.required and not f.has_value and not f.disabled and f.input_type != "password"
    )
    for item in plan_items:
        if item.status == "needs_human":
            problems.append(f"needs_human:{item.plan_item}")
        if item.action == "upload" and item.status == "pending":
            problems.append(f"upload_pending:{item.plan_item}")
        if item.action == "upload" and item.status == "failed":
            problems.append(f"upload_failed:{item.plan_item}")
    return problems


# ------------------------------------------------------------------ payload
def _display(f: FieldState) -> str:
    if f.kind == "file":
        return ", ".join(f.file_names)[:4000]
    if f.kind == "checkbox":
        return "Yes" if f.checked else "No"
    if f.kind in ("select", "radio_group", "checkbox_group", "combobox") and f.options:
        labels = [f.option_label(v) or v for v in f.value.split("\n") if v]
        return ", ".join(labels)[:4000]
    return f.value[:4000]


@dataclass
class SubmitPayload:
    payload: dict[str, Any]
    payload_hash: str
    form_hash: str


def build_submit_payload(
    obs: Observation,
    *,
    items_by_signature: Mapping[str, PlannedItem],
    user_signatures: set[str],
    attachments: Sequence[StagedFile],
    posting_id: str,
    attempt_id: str,
    injection_suspected: bool,
) -> SubmitPayload:
    """Step 2: the summary the user approves; protected values are masked."""
    fields: list[dict[str, Any]] = []
    for f in obs.fields:
        if not f.has_value or f.input_type == "password":
            continue
        item = items_by_signature.get(f.signature)
        ours = item is not None and item.status == "done" and f.signature not in user_signatures
        source = item.value_source if ours and item is not None else "user"
        if source == "none":
            source = "user"
        sensitivity = "none"
        if item is not None:
            sensitivity = item.sensitivity
        if protected_category(f"{f.label} {f.description} {f.section or ''}"):
            sensitivity = "protected"
        display = PROTECTED_DISPLAY if sensitivity == "protected" else _display(f)
        fields.append(
            {
                "label": clip(f.label or f.name or f.ref, 300),
                "value_display": display,
                "value_source": source,
                "sensitivity": sensitivity,
                "ai_written": bool(item.ai_written) if item is not None and ours else False,
            }
        )
    payload: dict[str, Any] = {
        "type": "browser_submit",
        "form_hash": obs.form_hash,
        "url": obs.url[:2048],
        "posting_id": posting_id,
        "attempt_id": attempt_id,
        "fields": fields[:300],
        "attachments": [
            {"file_id": a.file_id, "sha256": a.sha256, "name": a.name[:255]} for a in attachments
        ],
        "injection_suspected": injection_suspected,
    }
    try:
        BrowserSubmitApprovalPayload.model_validate(payload)
    except ValidationError as exc:
        raise ValueError(f"submit approval payload does not match the contract: {exc}") from exc
    return SubmitPayload(
        payload=payload, payload_hash=payload_hash(payload), form_hash=obs.form_hash
    )


def answer_payload(
    items: Sequence[PlannedItem], obs: Observation, attempt_id: str
) -> dict[str, Any]:
    """The `answer` approval of 19 §6.5: questions quoted, options, suggestions."""
    questions: list[dict[str, Any]] = []
    for item in items[:50]:
        f = obs.field(item.ref)
        if f is None:
            continue
        suggestion: dict[str, Any] | None = None
        if item.suggestion is not None and item.value_source in ("fact", "answer", "option"):
            suggestion = {
                "value": PROTECTED_DISPLAY if item.sensitivity == "protected" else item.suggestion,
                "value_source": item.value_source,
                "fact_key": item.fact_key,
                "answer_id": item.answer_id,
            }
        questions.append(
            {
                "ref": f.ref,
                "question": clip(f.label or f.name or f.ref, 300),
                "field_kind": f.kind,
                "required": f.required,
                "options": [
                    {
                        "value": clip(str(o.get("value") or ""), 200),
                        "label": clip(str(o.get("label") or ""), 200),
                    }
                    for o in f.options
                    if not o.get("disabled")
                ][:200],
                "question_key": item.question_key,
                "sensitivity": item.sensitivity
                if item.sensitivity in ("none", "personal", "protected")
                else "none",
                "suggestion": suggestion,
            }
        )
    return {"type": "answer", "attempt_id": attempt_id, "questions": questions}


# ------------------------------------------------------------------ approvals
ApprovalState = Literal["approved", "rejected", "expired", "cancelled"]


@dataclass
class ApprovalOutcome:
    state: ApprovalState
    record: dict[str, Any]


async def wait_for_approval(
    channel: LeaseChannel,
    approval_id: str,
    *,
    poll_s: float,
    timeout_s: float,
    on_tick: Callable[[], None] | None = None,
) -> ApprovalOutcome:
    """Poll every `poll_s` until decided (21 §6.3); lease loss stops at once."""
    deadline = time.monotonic() + timeout_s
    record: dict[str, Any] = {}
    while True:
        if channel.lost.is_set():
            raise LeaseLostError("The lease was lost while waiting for approval.")
        if channel.cancel_requested.is_set():
            return ApprovalOutcome("cancelled", record)
        if on_tick is not None:
            on_tick()
        try:
            record = await channel.poll_approval(approval_id)
        except Exception as exc:
            if classify_channel_error(exc) == "lease_lost":
                raise LeaseLostError("The lease was lost while waiting for approval.") from exc
        else:
            state = str(record.get("state") or "pending")
            if state in ("approved", "rejected", "expired"):
                return ApprovalOutcome(state, record)  # type: ignore[arg-type]
        if time.monotonic() >= deadline:
            return ApprovalOutcome("expired", record)
        await asyncio.sleep(poll_s)


# ------------------------------------------------------------------ submit intent
class SubmitIntentRefusedError(Exception):
    """The server refused submit-intent (policy / duplicate): never click."""

    def __init__(self, reason: str, error_class: str) -> None:
        super().__init__(reason)
        self.reason = reason
        self.error_class = error_class


class SubmitIntentUnavailableError(Exception):
    """No 200 after the retries: never click; the loop pauses `network_offline`."""


def _refusal(exc: BaseException) -> SubmitIntentRefusedError:
    details: Any = getattr(exc, "details", None)
    reason = ""
    if isinstance(details, dict):
        value: Any = cast(dict[str, Any], details).get("reason")
        reason = value if isinstance(value, str) else ""
    code: Any = getattr(exc, "error", None) or getattr(exc, "code", None) or "policy_violation"
    return SubmitIntentRefusedError(reason or str(code), str(code))


async def request_submit_intent(
    channel: LeaseChannel,
    *,
    form_hash: str,
    approval_id: str | None,
    rule_id: str | None,
    retries: int,
    backoff_s: float,
) -> int:
    """Synchronous submit-intent; returns `submit_intent_at` only after a 200 (D-28)."""
    attempts = max(1, retries)
    for attempt in range(attempts):
        if channel.lost.is_set():
            raise LeaseLostError("The lease was lost before submit_intent.")
        try:
            response = await channel.submit_intent(
                form_hash, approval_id=approval_id, rule_id=rule_id
            )
        except Exception as exc:
            kind = classify_channel_error(exc)
            if kind == "lease_lost":
                raise LeaseLostError("The lease was lost at submit_intent.") from exc
            if kind in ("refused", "ai_unavailable"):
                raise _refusal(exc) from exc
            if attempt + 1 < attempts:
                await asyncio.sleep(backoff_s * (2**attempt))
            continue
        at: object = response.get("submit_intent_at")
        if isinstance(at, int) and not isinstance(at, bool):
            return at
        raise SubmitIntentRefusedError("malformed_response", "policy_violation")
    raise SubmitIntentUnavailableError("submit_intent was not acknowledged")


def authorize(
    *,
    control: ControlState,
    form_hash: str,
    submit_intent_at: int,
    approval_id: str | None,
    rule_id: str | None,
) -> SubmitAuthorization:
    return SubmitAuthorization(
        form_hash=form_hash,
        ref=control.ref,
        signature=control.signature,
        submit_intent_at=submit_intent_at,
        approval_id=approval_id,
        rule_id=rule_id,
    )
