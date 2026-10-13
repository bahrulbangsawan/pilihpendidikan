"""Hand-built observations for the non-browser agent tests."""

from __future__ import annotations

from typing import Any

from pilih_jobs.browser.observer import (
    ControlState,
    FieldState,
    Observation,
    compute_form_hash,
    compute_structure_hash,
    control_signature,
    field_signature,
)

_counter = [0]


def field(
    label: str,
    kind: str = "text",
    *,
    required: bool = False,
    value: str = "",
    options: list[str] | None = None,
    **kw: Any,
) -> FieldState:
    _counter[0] += 1
    ref = kw.pop("ref", f"f{_counter[0]}")
    opts = [
        {"value": o, "label": o, "selected": o == value, "disabled": False} for o in (options or [])
    ]
    data: dict[str, Any] = {
        "ref": ref,
        "kind": kind,
        "tag": "input",
        "label": label,
        "label_sources": ["label_for"],
        "description": "",
        "required": required,
        "options": opts,
        "options_dynamic": False,
        "accept": None,
        "multiple": False,
        "value": value,
        "checked": None,
        "has_value": bool(value),
        "disabled": False,
        "readonly": False,
        "invalid": False,
        "validation_message": None,
        "section": None,
        "name": label.lower().replace(" ", "_"),
        "id_attr": None,
        "input_type": None,
        "autocomplete": None,
        "action_path": "/apply",
        "in_viewport": True,
        "hidden_input": False,
        "trigger_ref": None,
        "masked": False,
        "file_names": [],
        "frame_number": 0,
        "signature": "",
    }
    data.update(kw)
    state = FieldState(**data)
    state.signature = field_signature(kind, label, state.name, "/apply")
    return state


def control(
    text: str, role_hint: str, *, kind: str = "button", enabled: bool = True, **kw: Any
) -> ControlState:
    _counter[0] += 1
    data: dict[str, Any] = {
        "ref": f"f{_counter[0]}",
        "kind": kind,
        "text": text,
        "role_hint": role_hint,
        "enabled": enabled,
        "in_viewport": True,
        "href": None,
        "in_form": True,
        "form_has_fields": True,
        "in_cookie_banner": False,
        "upload_for": None,
        "frame_number": 0,
        "signature": control_signature(kind, text, None),
    }
    data.update(kw)
    return ControlState(**data)


def observation(
    fields: list[FieldState] | None = None,
    controls: list[ControlState] | None = None,
    *,
    errors: list[dict[str, Any]] | None = None,
    url: str = "https://jobs.acme-ats.test/apply",
    allowlisted: bool = True,
) -> Observation:
    fields = fields or []
    return Observation(
        observation_id="obs_01JC0000000000000000000001",
        attempt_id="att_01JC0000000000000000000001",
        step=0,
        url=url,
        origin="https://jobs.acme-ats.test",
        registrable_domain="acme-ats.test",
        allowlisted=allowlisted,
        title="Apply",
        http_status=200,
        aria_snapshot="",
        snapshot_sha256="0" * 64,
        snapshot_size=0,
        text_excerpt="",
        raw_text="",
        fields=fields,
        controls=controls or [],
        errors=errors or [],
        opaque_regions=[],
        challenge=None,
        form_hash=compute_form_hash(fields),
        structure_hash=compute_structure_hash(url, fields),
        confirm_hits={},
        frame_urls=[],
    )


def plan_item(f: FieldState, **kw: Any) -> dict[str, Any]:
    item: dict[str, Any] = {
        "plan_item": "p1",
        "ref": f.ref,
        "signature": f.signature,
        "action": "fill",
        "value_source": "fact",
        "fact_key": "contact.email",
        "answer_id": None,
        "option_value": None,
        "value": "rahma@example.com",
        "confidence": 0.95,
        "sensitivity": "none",
        "needs_human": False,
        "question_key": None,
        "reason": "test",
    }
    item.update(kw)
    return item
