"""CandidateEnumerator: the closed candidate list of one step (19 §3.2, §5.1).

Candidates are built from the observation and the validated plan only — page text can
never add one. Field candidates carry plan-item ids, never values. `navigation`, `other`,
`login`, `sign_up` controls and arbitrary links are **never** candidates; when the only
way forward is one of them the enumerator emits `pause_for_human(unclear_page)`.

Deterministic first (19 §5.1), in this order:

1. a cookie banner is in the way → click reject (18 §7.7);
2. the validated plan has unexecuted items → the next one in DOM order;
3. `job_description` with exactly one `apply_entry` → click it;
4. all required fields filled, no errors, exactly one enabled `next`/`submit` → take it
   (a `submit` goes through the submit gate);
5. otherwise the AI chooses among the candidates (`next-action`).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final, Literal

from pilih_jobs.agent.validate import PlannedItem, ValidatedPlan
from pilih_jobs.browser.actions import CLICKABLE_HINTS
from pilih_jobs.browser.observer import ControlState, Observation
from pilih_jobs.policy.untrusted import clip, quote_control_text

FORWARD_HINTS: Final = frozenset({"next", "submit"})
NEVER_CANDIDATES: Final = frozenset({"navigation", "other", "login", "sign_up"})
_PLAN_TYPES: Final[dict[str, str]] = {
    "fill": "fill_field",
    "select": "select_option",
    "check": "set_checkbox",
    "uncheck": "set_checkbox",
    "upload": "upload_file",
}

CandidateType = Literal[
    "fill_field",
    "select_option",
    "set_checkbox",
    "upload_file",
    "click_ref",
    "scroll",
    "wait_for",
    "pause_for_human",
    "stop",
]


@dataclass
class Candidate:
    id: str
    type: CandidateType
    ref: str | None = None
    plan_item: str | None = None
    file_id: str | None = None
    role_hint: str | None = None
    text: str | None = None
    direction: Literal["down", "up"] | None = None
    condition: Literal["network_idle", "url_change"] | None = None
    timeout_ms: int | None = None
    reason: str | None = None
    message: str | None = None
    outcome: Literal["failed", "cancelled"] | None = None
    error_class: str | None = None
    signature: str | None = None

    def to_contract(self) -> dict[str, Any]:
        base: dict[str, Any] = {"id": self.id, "type": self.type}
        if self.type in ("fill_field", "select_option", "set_checkbox"):
            base.update(ref=self.ref, plan_item=self.plan_item)
        elif self.type == "upload_file":
            base.update(ref=self.ref, file_id=self.file_id)
        elif self.type == "click_ref":
            base.update(ref=self.ref, role_hint=self.role_hint, text=clip(self.text, 120))
        elif self.type == "scroll":
            base.update(ref=self.ref, direction=self.direction)
        elif self.type == "wait_for":
            base.update(condition=self.condition, timeout_ms=self.timeout_ms)
        elif self.type == "pause_for_human":
            base.update(reason=self.reason, message=clip(self.message, 300))
        else:
            base.update(outcome=self.outcome, error_class=self.error_class)
        return base

    def describe(self) -> str:
        """Fixed-template description (control text quoted, ≤ 60 chars, 19 §5.2)."""
        if self.type == "click_ref":
            return f"Click {quote_control_text(self.text)} ({self.role_hint})"
        if self.type == "scroll":
            return f"Scroll {self.direction}"
        if self.type == "wait_for":
            return f"Wait for {self.condition}"
        if self.type == "pause_for_human":
            return "Ask the applicant to look at this page"
        if self.type == "stop":
            return "Stop"
        return f"{self.type} {self.ref}"


@dataclass
class EnumerationContext:
    page_kind: str
    plan: ValidatedPlan | None
    allow_cookie_accept: bool = False
    previous_allowed: bool = False
    review_page: bool = False


class CandidateEnumerator:
    def enumerate(self, obs: Observation, ctx: EnumerationContext) -> list[Candidate]:
        out: list[Candidate] = []

        def add(candidate: Candidate) -> None:
            candidate.id = f"c{len(out) + 1}"
            out.append(candidate)

        if ctx.plan is not None:
            for item in ctx.plan.pending([f.ref for f in obs.fields]):
                add(self._plan_candidate(item))
        for control in obs.controls:
            if not self._control_ok(control, ctx):
                continue
            hint = control.role_hint
            if ctx.review_page and hint == "next":
                hint = "submit"  # the final forward click of a review page is gated (19 §8.2)
            add(
                Candidate(
                    id="",
                    type="click_ref",
                    ref=control.ref,
                    role_hint=hint,
                    text=control.text,
                    signature=control.signature,
                )
            )
        forward = [
            c for c in out if c.type != "click_ref" or c.role_hint != "cookie_consent_reject"
        ]
        if not forward:
            add(
                Candidate(
                    id="",
                    type="pause_for_human",
                    reason="unclear_page",
                    message="No safe action leads forward on this page.",
                )
            )
            return out
        add(Candidate(id="", type="scroll", ref=None, direction="down"))
        add(Candidate(id="", type="wait_for", condition="network_idle", timeout_ms=5_000))
        return out

    @staticmethod
    def _plan_candidate(item: PlannedItem) -> Candidate:
        kind = _PLAN_TYPES[item.action]
        if kind == "upload_file":
            return Candidate(
                id="",
                type="upload_file",
                ref=item.ref,
                file_id=item.file_id,
                signature=item.signature,
            )
        return Candidate(
            id="",
            type=kind,  # type: ignore[arg-type]
            ref=item.ref,
            plan_item=item.plan_item,
            signature=item.signature,
        )

    @staticmethod
    def _control_ok(control: ControlState, ctx: EnumerationContext) -> bool:
        hint = control.role_hint
        if not control.enabled or hint in NEVER_CANDIDATES or hint not in CLICKABLE_HINTS:
            return False
        if ctx.page_kind == "job_description":
            return hint in ("apply_entry", "cookie_consent_reject")
        if hint == "apply_entry":
            return False
        if hint == "cookie_consent_accept":
            return ctx.allow_cookie_accept
        if hint == "previous":
            return ctx.previous_allowed
        # upload triggers are never clicked: uploads go through upload_file on the field
        return hint != "upload_trigger"


def choose_deterministic(
    candidates: list[Candidate], obs: Observation, ctx: EnumerationContext
) -> Candidate | None:
    """19 §5.1 rules 1–4; None means "ask the AI"."""
    banner = [
        c for c in candidates if c.type == "click_ref" and c.role_hint == "cookie_consent_reject"
    ]
    if banner:
        return banner[0]
    fields = [
        c
        for c in candidates
        if c.type in ("fill_field", "select_option", "set_checkbox", "upload_file")
    ]
    if fields:
        return fields[0]
    pauses = [c for c in candidates if c.type == "pause_for_human"]
    if pauses:
        return pauses[0]
    clicks = [c for c in candidates if c.type == "click_ref"]
    if ctx.page_kind == "job_description":
        entries = [c for c in clicks if c.role_hint == "apply_entry"]
        return entries[0] if len(entries) == 1 else None
    required_open = any(
        f.required and not f.has_value and not f.disabled and f.input_type != "password"
        for f in obs.fields
    )
    forward = [c for c in clicks if c.role_hint in FORWARD_HINTS]
    if not required_open and not obs.errors and len(forward) == 1:
        return forward[0]
    return None
