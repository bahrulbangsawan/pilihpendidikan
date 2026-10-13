"""PlanValidator: client-side re-validation of the field plan (19 §6.4, 11 T-13/T-14).

The server already validated the plan against the user's facts and answers; the client
re-checks everything it can see so that a compromised or confused server answer still
cannot make it type something that is not the user's data:

| Rule                                                     | Failure →                     |
|----------------------------------------------------------|-------------------------------|
| plan item references a ref not in the observation        | dropped (`schema_mismatch`)   |
| signature differs from the observed field                | dropped (`schema_mismatch`)   |
| `user_touched` field                                     | skip (the human wins)         |
| field already holds the planned value                    | skip                          |
| field holds a different value we did not set             | skip + note (never overwrite) |
|                                                          | unless the field is invalid   |
| `sensitivity = protected` (model **or** lexicon)          | never auto-filled → human     |
|                                                          | (a stored answer is proposed) |
| credential (password / PIN / OTP) field                  | never filled → human          |
| `confidence < 0.75`                                      | human                         |
| `fact`: `fact_key` and value present (and, when known,   | human                         |
| equal to the fact after kind normalization only)         |                               |
| `answer`: `answer_id` and value present (when known:     | human                         |
| `auto_use ≠ never`, value equals the answer)             |                               |
| `option`: value ∈ the field's enabled options and        | human                         |
| entailed by a `fact_key` or `answer_id`                  |                               |
| `cv_file` / `cover_letter_file`: file field, slot staged, | human                         |
| type-compatible                                          |                               |
| `generated_text`: opted in, motivation field, ≤ 2,000,   | human (assisted), approval    |
| never in `auto`                                          | payload marked AI-written     |
| action ↔ field kind consistency, value limits            | dropped / human               |

`needs_human` items with a non-null value are *suggestions* for the `answer` approval
(protected values masked); they are never executed without the user's decision.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Final, Literal, cast

from pilih_jobs.browser.actions import FILLABLE_KINDS, MAX_VALUE_LEN
from pilih_jobs.browser.executor import accept_allows
from pilih_jobs.browser.observer import FieldState, Observation
from pilih_jobs.policy.sensitivity import (
    file_slot_of,
    is_credential_field,
    is_free_text_motivation,
    is_personal_question,
    protected_category,
)

FIELD_CONFIDENCE: Final = 0.75
GENERATED_TEXT_MAX: Final = 2_000
_CONTROL_RE: Final = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_DIGITS: Final = re.compile(r"\D+")

ItemStatus = Literal["pending", "done", "skipped", "needs_human", "failed"]
HumanReason = Literal[
    "missing_information",
    "protected_question",
    "credential_field",
    "low_confidence",
    "generated_text",
    "unsupported_file_type",
]
_ACTION_KINDS: Final[dict[str, frozenset[str]]] = {
    "fill": FILLABLE_KINDS,
    "select": frozenset({"select", "combobox", "radio_group", "checkbox_group"}),
    "check": frozenset({"checkbox", "checkbox_group", "radio_group"}),
    "uncheck": frozenset({"checkbox"}),
    "upload": frozenset({"file"}),
}


@dataclass
class StagedSlot:
    file_id: str
    name: str


@dataclass
class ValidationContext:
    mode: Literal["assisted", "approval", "auto"]
    generated_text_allowed: bool = False
    slots: dict[str, StagedSlot | None] = field(default_factory=lambda: {})
    #: Known fact values (fact_key → value), when the caller has them (tests, approvals).
    trusted_facts: Mapping[str, str] | None = None
    #: Known answers (answer_id → {answer, auto_use, sensitivity}).
    trusted_answers: Mapping[str, Mapping[str, Any]] | None = None
    #: Values this attempt typed (signature → value hash) — "set by us".
    applied: Mapping[str, str] = field(default_factory=lambda: {})


@dataclass
class PlannedItem:
    plan_item: str
    ref: str
    signature: str
    label: str
    kind: str
    required: bool
    action: str
    value_source: str
    value: str | None
    option_value: str | None
    file_id: str | None
    fact_key: str | None
    answer_id: str | None
    question_key: str | None
    sensitivity: str
    confidence: float
    ai_written: bool = False
    status: ItemStatus = "pending"
    human_reason: HumanReason | None = None
    note: str | None = None
    suggestion: str | None = None
    attempts: int = 0

    @property
    def executable(self) -> bool:
        return self.status == "pending" and self.action in (
            "fill",
            "select",
            "check",
            "uncheck",
            "upload",
        )


@dataclass
class ValidatedPlan:
    items: list[PlannedItem]
    dropped: list[dict[str, str]] = field(default_factory=lambda: [])
    notes: list[dict[str, str]] = field(default_factory=lambda: [])

    def by_ref(self, ref: str) -> PlannedItem | None:
        return next((i for i in self.items if i.ref == ref), None)

    def by_plan_item(self, plan_item: str) -> PlannedItem | None:
        return next((i for i in self.items if i.plan_item == plan_item), None)

    @property
    def needs_human(self) -> list[PlannedItem]:
        return [i for i in self.items if i.status == "needs_human"]

    def pending(self, order: list[str]) -> list[PlannedItem]:
        """Executable items in DOM order (`order` = refs of the observation's fields)."""
        rank = {ref: n for n, ref in enumerate(order)}
        items = [i for i in self.items if i.executable]
        return sorted(items, key=lambda i: rank.get(i.ref, len(rank)))

    def counts(self) -> dict[str, Any]:
        sources: dict[str, int] = {}
        for item in self.items:
            if item.executable:
                sources[item.value_source] = sources.get(item.value_source, 0) + 1
        return {
            "sources": sources,
            "needs_human": len(self.needs_human),
            "skipped": sum(1 for i in self.items if i.status == "skipped"),
            "dropped": len(self.dropped),
        }


def normalize_for_kind(kind: str, value: str) -> str:
    """Kind-only normalization (phone, date, URL scheme) — never changes content."""
    text = value.strip()
    if kind == "tel":
        return ("+" if text.startswith("+") else "") + _DIGITS.sub("", text)
    if kind in ("date", "month"):
        return _DIGITS.sub("", text)
    if kind == "url":
        return re.sub(r"^https?://", "", text, flags=re.I).rstrip("/").lower()
    if kind == "email":
        return text.lower()
    return " ".join(text.split())


def _option_match(f: FieldState, value: str) -> str | None:
    """The enabled option value matching `value` by value or label (exact, then folded)."""
    enabled = [o for o in f.options if not o.get("disabled")]
    for option in enabled:
        if str(option.get("value")) == value:
            return str(option.get("value"))
    folded = " ".join(value.split()).casefold()
    for option in enabled:
        if " ".join(str(option.get("label") or "").split()).casefold() == folded:
            return str(option.get("value"))
    return None


def _field_text(f: FieldState) -> str:
    return f"{f.label} {f.description} {f.section or ''}"


class PlanValidator:
    def validate(
        self, plan: Mapping[str, Any], observation: Observation, ctx: ValidationContext
    ) -> ValidatedPlan:
        out = ValidatedPlan(items=[])
        seen_refs: set[str] = set()
        raw_items: object = plan.get("items")
        for raw in cast(list[object], raw_items) if isinstance(raw_items, list) else []:
            if not isinstance(raw, Mapping):
                out.dropped.append({"plan_item": "?", "reason": "schema_mismatch"})
                continue
            item = self._item(cast(Mapping[str, Any], raw), observation, ctx, out, seen_refs)
            if item is not None:
                out.items.append(item)
                seen_refs.add(item.ref)
        self._uncovered(observation, ctx, out, seen_refs)
        return out

    # ------------------------------------------------------------------ one item
    def _item(
        self,
        raw: Mapping[str, Any],
        obs: Observation,
        ctx: ValidationContext,
        out: ValidatedPlan,
        seen: set[str],
    ) -> PlannedItem | None:
        plan_item = str(raw.get("plan_item") or "")
        ref = str(raw.get("ref") or "")
        f = obs.field(ref)
        if f is None or ref in seen:
            out.dropped.append({"plan_item": plan_item, "reason": "schema_mismatch"})
            return None
        if str(raw.get("signature") or "") != f.signature:
            out.dropped.append({"plan_item": plan_item, "reason": "schema_mismatch"})
            return None
        action = str(raw.get("action") or "skip")
        source = str(raw.get("value_source") or "none")
        value = raw.get("value")
        value = str(value) if isinstance(value, str) else None
        option_value = raw.get("option_value")
        option_value = str(option_value) if isinstance(option_value, str) else None
        confidence_raw = raw.get("confidence")
        confidence = float(confidence_raw) if isinstance(confidence_raw, int | float) else 0.0
        model_sensitivity = str(raw.get("sensitivity") or "none")
        item = PlannedItem(
            plan_item=plan_item,
            ref=ref,
            signature=f.signature,
            label=f.label,
            kind=f.kind,
            required=f.required,
            action=action,
            value_source=source,
            value=value,
            option_value=option_value,
            file_id=None,
            fact_key=_str_or_none(raw.get("fact_key")),
            answer_id=_str_or_none(raw.get("answer_id")),
            question_key=_str_or_none(raw.get("question_key")),
            sensitivity=self._sensitivity(f, model_sensitivity),
            confidence=confidence,
        )
        self._check(item, raw, f, ctx, out)
        return item

    @staticmethod
    def _sensitivity(f: FieldState, model: str) -> str:
        if model == "protected" or protected_category(_field_text(f)):
            return "protected"
        if model == "personal" or is_personal_question(_field_text(f)):
            return "personal"
        return "none"

    def _human(self, item: PlannedItem, reason: HumanReason, note: str | None = None) -> None:
        item.status = "needs_human"
        item.human_reason = reason
        if item.value is not None and item.suggestion is None:
            item.suggestion = item.option_value or item.value
        item.note = note

    def _check(
        self,
        item: PlannedItem,
        raw: Mapping[str, Any],
        f: FieldState,
        ctx: ValidationContext,
        out: ValidatedPlan,
    ) -> None:
        if f.user_touched:
            item.status, item.note = "skipped", "user_touched"
            return
        if is_credential_field(
            input_type=f.input_type,
            autocomplete=f.autocomplete,
            names=[f.label, f.name, f.id_attr, f.description],
        ):
            item.value = item.option_value = None
            self._human(item, "credential_field")
            return
        if item.sensitivity == "protected":
            # Never auto-filled (03 §9): a stored answer is only *proposed* in an approval.
            self._human(item, "protected_question")
            return
        if raw.get("needs_human") is True:
            self._human(item, "missing_information")
            return
        if item.action == "skip" or item.value_source == "none":
            if f.required and not f.has_value:
                self._human(item, "missing_information")
            else:
                item.status = "skipped"
            return
        allowed_kinds = _ACTION_KINDS.get(item.action)
        if allowed_kinds is None or f.kind not in allowed_kinds:
            out.dropped.append({"plan_item": item.plan_item, "reason": "action_kind_mismatch"})
            self._human(item, "missing_information", "action_kind_mismatch")
            return
        if item.confidence < FIELD_CONFIDENCE:
            self._human(item, "low_confidence")
            return
        if not self._source_ok(item, f, ctx):
            if item.status != "needs_human":
                self._human(item, "missing_information", "unsupported_value")
            return
        self._existing_value(item, f, ctx, out)

    def _source_ok(self, item: PlannedItem, f: FieldState, ctx: ValidationContext) -> bool:
        source = item.value_source
        if source in ("cv_file", "cover_letter_file"):
            return self._file_ok(item, f, ctx)
        if f.kind == "file":
            return False
        if source == "generated_text":
            return self._generated_ok(item, f, ctx)
        if source == "fact":
            if not item.fact_key or not item.value:
                return False
            known = ctx.trusted_facts.get(item.fact_key) if ctx.trusted_facts else None
            if ctx.trusted_facts is not None and (
                known is None
                or normalize_for_kind(f.kind, known) != normalize_for_kind(f.kind, item.value)
            ):
                return False
        elif source == "answer":
            if not item.answer_id or not (item.value or item.option_value):
                return False
            if ctx.trusted_answers is not None:
                answer = ctx.trusted_answers.get(item.answer_id)
                if answer is None or answer.get("auto_use") == "never":
                    return False
                stored = str(answer.get("answer") or "")
                candidate = item.option_value or item.value or ""
                if normalize_for_kind(f.kind, stored) != normalize_for_kind(f.kind, candidate) and (
                    _option_match(f, stored) != _option_match(f, candidate)
                    or _option_match(f, stored) is None
                ):
                    return False
                if item.sensitivity == "personal" and answer.get("auto_use") != "always":
                    self._human(item, "missing_information", "personal_needs_approval")
                    return False
        elif source == "option":
            if not item.option_value or not (item.fact_key or item.answer_id):
                return False
        else:
            return False
        return self._value_fits(item, f)

    def _value_fits(self, item: PlannedItem, f: FieldState) -> bool:
        candidate = item.option_value if item.option_value is not None else item.value
        if candidate is None or len(candidate) > MAX_VALUE_LEN:
            return False
        if _CONTROL_RE.search(candidate) and f.kind not in ("textarea", "contenteditable"):
            return False
        if item.action == "select":
            if f.kind == "combobox" and f.options_dynamic:
                item.option_value = candidate
                return True
            matched = _option_match(f, candidate)
            if matched is None:
                return False
            item.option_value = matched
            return True
        if item.action in ("check", "uncheck") and f.kind in ("checkbox_group", "radio_group"):
            matched = _option_match(f, item.option_value or item.value or "")
            if matched is None:
                return False
            item.option_value = matched
            return True
        if item.action == "fill":
            item.value = candidate
        return True

    def _file_ok(self, item: PlannedItem, f: FieldState, ctx: ValidationContext) -> bool:
        if f.kind != "file" or item.action != "upload":
            return False
        slot = ctx.slots.get(item.value_source)
        if slot is None:
            if not f.required:
                item.status, item.note = "skipped", "no_file_for_slot"
                return True
            return False
        if not accept_allows(f.accept, slot.name):
            self._human(item, "unsupported_file_type")
            return False
        expected = file_slot_of(f.label, f.description)
        if expected is not None and expected != item.value_source:
            return False
        item.file_id = slot.file_id
        item.value = slot.name
        return True

    def _generated_ok(self, item: PlannedItem, f: FieldState, ctx: ValidationContext) -> bool:
        motivation = is_free_text_motivation(
            label=f.label, description=f.description, kind=f.kind, section=f.section
        )
        if (
            not ctx.generated_text_allowed
            or not motivation
            or not item.value
            or len(item.value) > GENERATED_TEXT_MAX
        ):
            return False
        if ctx.mode != "approval":
            # assisted: shown in a pause for the user to type; auto: forbidden (19 §6.4).
            self._human(item, "generated_text")
            return False
        item.ai_written = True
        return True

    def _existing_value(
        self, item: PlannedItem, f: FieldState, ctx: ValidationContext, out: ValidatedPlan
    ) -> None:
        if item.status != "pending":
            return
        if item.action == "upload":
            if f.has_value and item.value in f.file_names:
                item.status = "done"
            return
        if not f.has_value:
            return
        if item.action in ("check", "uncheck") and f.kind == "checkbox":
            if bool(f.checked) == (item.action == "check"):
                item.status = "done"
            elif f.signature not in ctx.applied and not f.invalid:
                item.status, item.note = "skipped", "prefilled_differs"
                out.notes.append({"plan_item": item.plan_item, "note": "prefilled_differs"})
            return
        planned = item.option_value if item.option_value is not None else item.value or ""
        current = f.value
        same = (
            planned in current.split("\n")
            if f.kind in ("select", "checkbox_group", "radio_group")
            else normalize_for_kind(f.kind, current) == normalize_for_kind(f.kind, planned)
        )
        if same:
            item.status = "done"
            return
        if f.signature not in ctx.applied and not f.invalid:
            # Never overwrite a prefilled ATS value we did not set (19 §6.4).
            item.status, item.note = "skipped", "prefilled_differs"
            out.notes.append({"plan_item": item.plan_item, "note": "prefilled_differs"})

    # ------------------------------------------------------------------ coverage
    def _uncovered(
        self, obs: Observation, ctx: ValidationContext, out: ValidatedPlan, seen: set[str]
    ) -> None:
        """Empty fields the plan did not cover: required ones, and every protected question
        (03 §9: the agent never picks a value on the user's behalf), become needs_human."""
        n = 0
        for f in obs.fields:
            if f.ref in seen or f.has_value or f.user_touched or f.disabled:
                continue
            protected = protected_category(_field_text(f)) is not None
            if not f.required and not protected:
                continue
            n += 1
            credential = is_credential_field(
                input_type=f.input_type,
                autocomplete=f.autocomplete,
                names=[f.label, f.name, f.id_attr, f.description],
            )
            reason: HumanReason = (
                "credential_field"
                if credential
                else "protected_question"
                if protected
                else "missing_information"
            )
            out.items.append(
                PlannedItem(
                    plan_item=f"u{n}",
                    ref=f.ref,
                    signature=f.signature,
                    label=f.label,
                    kind=f.kind,
                    required=f.required,
                    action="skip",
                    value_source="none",
                    value=None,
                    option_value=None,
                    file_id=None,
                    fact_key=None,
                    answer_id=None,
                    question_key=None,
                    sensitivity="protected" if protected else "none",
                    confidence=0.0,
                    status="needs_human",
                    human_reason=reason,
                    note="not_in_plan",
                )
            )


def _str_or_none(value: object) -> str | None:
    return value if isinstance(value, str) and value else None
