"""TFIX-AI-BODIES: every `/api/v1/ai/*` body the agent sends is one the api accepts.

Regression for the full-stack finding (leaf-5.1 #3): `AiClient` serialised requests with
`exclude_none=False`, so `field-plan` carried `"fact_keys": null` and `verify-submission`
`"signals": {"user_confirmed": null, …}`. The Zod contracts declare those members
`.optional()`, not `.nullable()`, so the api answered `400 invalid_request` and every
apply paused `ai_unavailable`. The generated Pydantic models accept both shapes, so the
bodies are checked against the contract JSON Schema (`tests/support/contract_schema.py`)
with the api's semantics: absent ≠ null, string lengths in UTF-16 units.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from pilih_jobs.agent.ai import AiClient
from pilih_jobs.agent.budget import Budget
from pilih_jobs.agent.candidates import Candidate
from pilih_jobs.agent.steplog import AttemptLog
from pilih_jobs.api.errors import ApiError
from pilih_jobs.auth.store import AccountMeta
from pilih_jobs.browser.evidence import EvidenceCapture
from pilih_jobs.contracts._generated.agent import FieldPlanRequest, VerifySubmissionRequest
from pilih_jobs.contracts._generated.api import AnalyticsBreakdownQuery
from pilih_jobs.contracts.ids import new_id
from pilih_jobs.contracts.wire import clip_utf16, to_wire, utf16_length
from pilih_jobs.runtime import Runtime
from tests.agent.factories import control, field, observation
from tests.fixtures.ats_server.fake_channel import FakeChannel
from tests.support.contract_schema import AI_REQUEST_SCHEMAS, ai_request_violations
from tests.support.fake_api import FakeApi, FakeResponse, example

# Astral-plane characters are 2 UTF-16 units each: a clip by code points overflows.
EMOJI = "\U0001f680"


def _client(tmp_path: Path, channel: FakeChannel) -> AiClient:
    task_id, lease_id = new_id("tsk"), new_id("lse")
    return AiClient(
        channel,  # type: ignore[arg-type]
        task_id=task_id,
        lease_id=lease_id,
        budget=Budget(),
        log=AttemptLog(tmp_path, attempt_id=new_id("att"), task_id=task_id, lease_id=lease_id),
    )


def _candidates() -> list[dict[str, Any]]:
    """One candidate of every type, built by the executor's own `to_contract`."""
    return [
        Candidate(id="c1", type="fill_field", ref="f1", plan_item="p1").to_contract(),
        Candidate(id="c2", type="select_option", ref="f2", plan_item="p2").to_contract(),
        Candidate(id="c3", type="set_checkbox", ref="f3", plan_item="p3").to_contract(),
        Candidate(id="c4", type="upload_file", ref="f4", file_id=new_id("fil")).to_contract(),
        Candidate(id="c5", type="click_ref", ref="f5", role_hint="next").to_contract(),
        Candidate(
            id="c6", type="click_ref", ref="f6", role_hint="submit", text="Submit"
        ).to_contract(),
        Candidate(id="c7", type="scroll", ref=None, direction="down").to_contract(),
        Candidate(
            id="c8", type="wait_for", condition="network_idle", timeout_ms=5000
        ).to_contract(),
    ]


async def _send_all(client: AiClient, obs_contract: dict[str, Any]) -> None:
    """The four calls exactly as `agent.loop` makes them (fact_keys=None, raw signals)."""
    await client.classify(obs_contract, step=0)
    await client.field_plan(
        obs_contract,
        step=0,
        fact_keys=None,
        file_slots={"cv_file": True, "cover_letter_file": False},
        attempt=1,
    )
    await client.next_action(
        observation_id=obs_contract["observation_id"],
        step=0,
        page_kind="application_form",
        state={"required_remaining": 1, "errors": 0, "form_hash": obs_contract["form_hash"]},
        candidates=_candidates(),
    )
    capture = EvidenceCapture(url_match=True, form_gone=True, http_status=None)
    await client.verify(
        step=1,
        observation_id=None,
        final_url="https://jobs.acme-ats.test/confirmation",
        page_title="Thank you",
        text_excerpt="Thank you for applying",
        screenshot_jpeg_b64=None,
        signals=capture.signals(),
    )


def _assert_accepted(channel: FakeChannel) -> None:
    assert sorted({endpoint for endpoint, _ in channel.ai_calls}) == sorted(AI_REQUEST_SCHEMAS)
    for endpoint, body in channel.ai_calls:
        assert ai_request_violations(endpoint, body) == [], endpoint
    assert channel.contract_violations == []


async def test_TFIX_AI_BODIES_every_ai_request_is_accepted_by_the_contract(
    tmp_path: Path,
) -> None:
    channel = FakeChannel()
    client = _client(tmp_path, channel)
    obs = observation(
        [
            field("Email", "email", required=True),
            field("Country", "select", options=["Indonesia", "Malaysia"]),
            field("Resume", "file", required=True, accept=".pdf"),
        ],
        [control("Next", "next")],
        errors=[{"ref": None, "text": "Please fix the errors below"}],
    )
    await _send_all(client, obs.to_contract())
    _assert_accepted(channel)

    bodies = dict(channel.ai_calls)
    plan = bodies["field-plan"]
    assert "fact_keys" not in plan  # optional and unset: absent, never null
    assert plan["attempt"] == 1
    # Required nullable members of the observation stay present as null.
    first = plan["observation"]["fields"][0]
    assert first["validation_message"] is None
    assert first["accept"] is None
    assert plan["observation"]["errors"][0]["ref"] is None
    assert plan["observation"]["screenshot_jpeg_b64"] is None
    signals = bodies["verify-submission"]["signals"]
    assert signals["url_match"] is True
    assert signals["method"] == "browser"
    for key in ("user_confirmed", "provider_accepted", "message_id", "source", "inferred"):
        assert key not in signals
    verify = bodies["verify-submission"]
    assert verify["observation_id"] is None  # nullable and required: kept
    assert verify["screenshot_jpeg_b64"] is None


async def test_TFIX_AI_BODIES_long_unicode_text_fits_the_contract_lengths(
    tmp_path: Path,
) -> None:
    """Zod counts UTF-16 units: astral characters must not push a clipped text past a limit."""
    channel = FakeChannel()
    client = _client(tmp_path, channel)
    long_label = EMOJI * 400
    obs = observation(
        [
            field(
                long_label,
                "text",
                required=True,
                description=EMOJI * 400,
                validation_message=EMOJI * 400,
                section=EMOJI * 200,
            )
        ],
        [control(EMOJI * 200, "next")],
        errors=[{"ref": None, "text": EMOJI * 400}],
    )
    obs.title = EMOJI * 300
    obs.aria_snapshot = EMOJI * 20_000
    obs.text_excerpt = EMOJI * 6_000
    contract = obs.to_contract()
    await client.classify(contract, step=0)
    await client.field_plan(
        contract, step=0, fact_keys=None, file_slots={"cv_file": False, "cover_letter_file": False}
    )
    await client.next_action(
        observation_id=contract["observation_id"],
        step=0,
        page_kind="application_form",
        state={"required_remaining": 1, "errors": 1, "form_hash": contract["form_hash"]},
        candidates=[
            Candidate(
                id="c1", type="click_ref", ref="f9", role_hint="next", text=EMOJI * 200
            ).to_contract()
        ],
    )
    await client.verify(
        step=1,
        observation_id=contract["observation_id"],
        final_url="https://jobs.acme-ats.test/done",
        page_title=EMOJI * 300,
        text_excerpt=EMOJI * 3_000,
        screenshot_jpeg_b64=None,
        signals={"dom_marker": True, "form_gone": True, "http_status": 200, "method": "browser"},
    )
    _assert_accepted(channel)


@pytest.mark.parametrize("endpoint", sorted(AI_REQUEST_SCHEMAS))
def test_TFIX_AI_BODIES_schema_check_refuses_null_for_optional_members(endpoint: str) -> None:
    """The checker itself: null where the contract only allows absence is a violation."""
    bodies: dict[str, dict[str, Any]] = {
        "page-classify": {"lease_ref": None, "observation": None},
        "next-action": {"lease_ref": None, "candidates": [{"id": "c1", "type": "click_ref"}]},
        "field-plan": {"fact_keys": None, "attempt": None},
        "verify-submission": {"signals": {"user_confirmed": None, "inferred": None}},
    }
    violations = ai_request_violations(endpoint, bodies[endpoint])
    assert violations
    if endpoint == "field-plan":
        assert any(v.startswith("FieldPlanRequest.fact_keys: expected array") for v in violations)
    if endpoint == "verify-submission":
        assert any("signals.user_confirmed: expected boolean, got null" in v for v in violations)


def test_TFIX_AI_BODIES_to_wire_omits_unset_optionals_and_keeps_required_nulls() -> None:
    lease_ref = {"task_id": new_id("tsk"), "lease_id": new_id("lse")}
    obs = observation([field("Email", "email")]).to_contract()
    plan = FieldPlanRequest.model_validate(
        {
            "lease_ref": lease_ref,
            "observation": obs,
            "fact_keys": None,
            "file_slots": {"cv_file": False, "cover_letter_file": False},
        }
    )
    body = to_wire(plan)
    assert "fact_keys" not in body
    assert "attempt" not in body
    assert body["observation"]["fields"][0]["validation_message"] is None
    assert body["observation"]["challenge"] == {"detected": False, "kind": None}
    assert ai_request_violations("field-plan", body) == []
    # A set optional member is sent, an empty list included.
    with_keys = FieldPlanRequest.model_validate({**plan.model_dump(), "fact_keys": []})
    assert to_wire(with_keys)["fact_keys"] == []

    verify = VerifySubmissionRequest.model_validate(
        {
            "lease_ref": lease_ref,
            "observation_id": None,
            "final_url": "https://jobs.acme-ats.test/done",
            "page_title": "",
            "text_excerpt": "",
            "screenshot_jpeg_b64": None,
            "signals": {"url_match": False, "http_status": None, "x_custom": None},
        }
    )
    wire = to_wire(verify)
    # Open object (`z.looseObject`): unknown members pass through untouched.
    assert wire["signals"] == {"url_match": False, "x_custom": None}
    assert wire["observation_id"] is None
    assert ai_request_violations("verify-submission", wire) == []
    # Aliased members use the wire name.
    query = AnalyticsBreakdownQuery.model_validate({"from": "2026-10-01", "by": "source"})
    assert to_wire(query) == {"from": "2026-10-01", "by": "source"}


def test_TFIX_AI_BODIES_clip_utf16_never_splits_a_surrogate_pair() -> None:
    assert clip_utf16("abc", 3) == "abc"
    assert clip_utf16("abcd", 3) == "abc"
    assert clip_utf16(f"a{EMOJI}", 2) == "a"
    assert clip_utf16(f"a{EMOJI}", 3) == f"a{EMOJI}"
    assert utf16_length(clip_utf16(EMOJI * 10, 7)) == 6
    assert clip_utf16("", 0) == ""


async def test_TFIX_AI_BODIES_fake_api_refuses_null_optionals_like_the_api(
    runtime: Runtime, fake_api: FakeApi, signed_in: AccountMeta
) -> None:
    """Every `/api/v1` JSON body the suite sends through FakeApi gets the same check."""
    fake_api.route("POST", "/api/v1/ai/field-plan")(
        lambda _req: FakeResponse(200, example("POST /api/v1/ai/field-plan"))
    )
    request = FieldPlanRequest.model_validate(
        {
            "lease_ref": {"task_id": new_id("tsk"), "lease_id": new_id("lse")},
            "observation": observation([field("Email", "email")]).to_contract(),
            "fact_keys": None,
            "file_slots": {"cv_file": True, "cover_letter_file": False},
        }
    )
    async with runtime.api_client() as api:
        with pytest.raises(ApiError) as refused:
            await api.post(
                "/api/v1/ai/field-plan", request.model_dump(mode="json", exclude_none=False)
            )
        assert refused.value.status == 400
        assert refused.value.code == "invalid_request"
        plan = await api.post("/api/v1/ai/field-plan", to_wire(request))
    assert "items" in plan
    ((route, violations),) = fake_api.request_violations
    assert route == "POST /api/v1/ai/field-plan"
    assert any("fact_keys: expected array, got null" in v for v in violations)
