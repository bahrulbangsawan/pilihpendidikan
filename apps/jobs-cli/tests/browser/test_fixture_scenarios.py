"""Fixture ATS scenarios 1–17 of 18 §13.2 and the browser-side S-xx flows (13 §5).

Every test drives `run_attempt` end to end in real headless Chromium against the fixture
server, with a FakeChannel scripting the cloud (approvals, submit-intent, AI answers).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest

from pilih_jobs.browser.profiles import LOCK_FILE
from tests.browser.support import run
from tests.fixtures.ats_server import EVIL_HOST, FixtureServer
from tests.fixtures.ats_server.fake_channel import (
    FACTS,
    FakeChannel,
    offline_error,
    upstream_unavailable,
)

pytestmark = pytest.mark.browser

FACT_VALUES = set(FACTS.values())


def posts(server: FixtureServer, path: str) -> list[dict[str, list[str]]]:
    return [h.form for h in server.state.posts(path)]


def assert_intent_before_submit(server: FixtureServer, channel: FakeChannel, path: str) -> None:
    submits = server.state.posts(path)
    ok_intents = [i for i in channel.intents if i["ok"]]
    assert submits
    assert ok_intents
    assert ok_intents[0]["at"] < submits[0].at


# ------------------------------------------------------------------ 1–3
async def test_T18_F01_single_page_form_filled_and_submit_gate(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, channel, _ = await run(tmp_path, fixture_ats, "/s1/apply")
    assert result.outcome == "submitted"
    assert result.submission_status == "submitted_verified"
    gate = channel.approvals_of("submit")
    assert len(gate) == 1
    assert gate[0]["payload"]["type"] == "browser_submit"
    (form,) = posts(fixture_ats, "/s1/submit")
    assert form["first_name"] == ["Rahma"]
    assert form["email"] == ["rahma@example.com"]
    assert form["country"] == ["ID"]
    assert form["resume"][0].endswith(".pdf")
    assert "Rahma_Putri" in form["resume"][0]
    assert_intent_before_submit(fixture_ats, channel, "/s1/submit")


async def test_T18_F02_three_step_wizard_traversed(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, channel, _ = await run(tmp_path, fixture_ats, "/s2/step1")
    assert result.outcome == "submitted", result
    assert [h.path for h in fixture_ats.state.posts("/s2/")] == [
        "/s2/step1",
        "/s2/step2",
        "/s2/step3",
    ]
    assert "stuck_loop" not in channel.pause_reasons()
    assert len(channel.approvals_of("submit")) == 1


async def test_T18_F03_hidden_file_input_uses_file_chooser(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, _channel, ctx = await run(tmp_path, fixture_ats, "/s3/apply")
    assert result.outcome == "submitted"
    (form,) = posts(fixture_ats, "/s3/submit")
    assert form["resume"][0].endswith(".pdf")
    steps = (ctx.run_dir / "steps.jsonl").read_text()
    assert '"postcondition": "file_chooser"' in steps


# ------------------------------------------------------------------ 4–5
async def test_T18_F04_required_unknown_question_pauses(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, channel, _ = await run(tmp_path, fixture_ats, "/s4/apply", mode="assisted")
    assert result.outcome == "paused"
    assert result.pause_reason == "missing_information"
    assert channel.pause_reasons() == ["missing_information"]
    assert not fixture_ats.state.posts("/s4/submit")


async def test_T18_F04_unknown_question_becomes_answer_approval(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, channel, _ = await run(tmp_path, fixture_ats, "/s4/apply", mode="approval")
    answer = channel.approvals_of("answer")
    assert len(answer) == 1
    assert answer[0]["payload"]["questions"][0]["question"].startswith("What is your favourite")
    assert result.outcome == "submitted"
    (form,) = posts(fixture_ats, "/s4/submit")
    assert form["q_color"] == ["Blue"]  # the user's answer, not a model's


async def test_T18_F05_eeo_section_pauses_protected_question(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, _channel, _ = await run(tmp_path, fixture_ats, "/s5/apply", mode="assisted")
    assert result.outcome == "paused"
    assert result.pause_reason == "protected_question"
    assert not fixture_ats.state.posts("/s5/submit")


async def test_T11_PROTECTED_never_auto_filled_without_a_decision(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    def reject(kind: str, payload: dict[str, Any], polls: int) -> dict[str, Any]:
        return {"state": "rejected", "response": None}

    result, channel, _ = await run(
        tmp_path, fixture_ats, "/s5/apply", channel=FakeChannel(decide=reject)
    )
    (approval,) = channel.approvals_of("answer")
    sensitivities = {q["sensitivity"] for q in approval["payload"]["questions"]}
    assert sensitivities == {"protected"}
    assert result.outcome == "cancelled"
    assert result.error_class == "approval_rejected"
    assert not fixture_ats.state.posts("/s5/submit")


async def test_T11_PROTECTED_auto_mode_stops(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, channel, _ = await run(
        tmp_path, fixture_ats, "/s5/apply", mode="auto", context_kw={"rule": True}
    )
    assert result.outcome == "failed"
    assert result.error_class == "protected_question"
    assert not channel.intents
    assert not fixture_ats.state.posts("/s5/submit")


async def test_S_20_protected_answer_still_needs_an_approval(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    """A stored auto_use=approval answer is proposed (masked), never typed without a decision."""

    def with_stored_answer(plan: dict[str, Any], obs: dict[str, Any]) -> dict[str, Any]:
        for item in plan["items"]:
            if item["sensitivity"] == "protected":
                item.update(
                    value_source="answer",
                    answer_id="ans_01JC0000000000000000000009",
                    value="Decline to self-identify",
                )
        return plan

    channel = FakeChannel()
    channel.ai_impl.plan_hook = with_stored_answer
    seen: list[list[dict[str, Any]]] = []

    def decide(kind: str, payload: dict[str, Any], polls: int) -> dict[str, Any]:
        if kind == "answer":
            seen.append(payload["questions"])
            return {"state": "approved", "response": {"answers": []}}
        return {"state": "approved", "response": None}

    channel.decide = decide
    result, channel, _ = await run(tmp_path, fixture_ats, "/s5/apply", channel=channel)
    assert seen, "an answer approval is required even with a stored answer"
    suggestions = [q["suggestion"] for q in seen[0] if q["suggestion"]]
    assert suggestions
    assert all(s["value"] == "(your saved answer)" for s in suggestions)
    assert result.outcome == "submitted"
    (form,) = posts(fixture_ats, "/s5/submit")
    assert form["gender"] == ["x"]  # approved suggestion, applied only after the decision


# ------------------------------------------------------------------ 6–8
async def test_T18_F06_captcha_iframe_pauses_without_actions(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, channel, _ = await run(tmp_path, fixture_ats, "/s6/apply")
    assert result.outcome == "paused"
    assert result.pause_reason == "captcha_or_challenge"
    assert channel.ai_endpoints() == []  # no AI call on a challenge page
    assert not fixture_ats.state.posts("/s6/")
    turnstile = [h for h in fixture_ats.state.hits if h.path == "/turnstile"]
    assert all(h.method == "GET" for h in turnstile)


async def test_S_19_challenge_resumes_after_the_human_solves_it(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    async def human(prompt: Any) -> str:
        assert prompt.reason == "captcha_or_challenge"
        fixture_ats.state.flags["s6_solved"] = True
        import asyncio

        await asyncio.sleep(0.6)
        return "resume"

    result, channel, _ = await run(
        tmp_path, fixture_ats, "/s6/apply", prompt_pause=human, pause_timeout_s=10.0
    )
    assert channel.pause_reasons() == ["captcha_or_challenge"]
    assert "resumed" in channel.event_types()
    assert result.outcome == "submitted"


async def test_T18_F07_login_wall_pauses(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, _channel, _ = await run(tmp_path, fixture_ats, "/s7/apply")
    assert result.outcome == "paused"
    assert result.pause_reason == "login_required"
    assert not fixture_ats.state.posts("/s7/")


async def test_T18_F08_off_domain_redirect_pauses_in_approval(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, _channel, _ = await run(tmp_path, fixture_ats, "/s8/apply")
    assert result.outcome == "paused"
    assert result.pause_reason == "off_domain_navigation"
    assert all(h.method == "GET" for h in fixture_ats.state.hits_on(EVIL_HOST))


async def test_T18_F08_off_domain_redirect_stops_in_auto(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, channel, _ = await run(
        tmp_path, fixture_ats, "/s8/apply", mode="auto", context_kw={"rule": True}
    )
    assert result.outcome == "failed"
    assert result.error_class == "domain_not_allowed"
    assert channel.ai_endpoints() == []


# ------------------------------------------------------------------ 9–12
async def test_T18_F09_popup_to_allowlisted_domain_is_adopted(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, _channel, _ = await run(tmp_path, fixture_ats, "/s9/job")
    assert result.outcome == "submitted"
    (submit,) = fixture_ats.state.posts("/s9/submit")
    assert submit.host == "forms.partner-ats.test"


async def test_T18_F10_server_side_error_gives_negative_evidence(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, _channel, _ = await run(tmp_path, fixture_ats, "/s10/apply")
    assert result.outcome == "failed"
    assert result.evidence is not None
    assert result.evidence["verdict"] == "negative"
    assert result.submission_status != "submitted_verified"


async def test_T18_F11_confirmation_marker_verified(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, channel, _ = await run(tmp_path, fixture_ats, "/s11/apply")
    assert result.outcome == "submitted"
    assert result.submission_status == "submitted_verified"
    evidence = result.evidence or {}
    assert evidence["verdict"] == "verified"
    assert evidence["signals"]["url_match"]
    assert evidence["signals"]["form_gone"]
    assert "verify-submission" in channel.ai_endpoints()
    assert evidence["screenshot_file_id"]
    assert channel.uploads[0]["kind"] == "evidence_screenshot"
    assert "Rahma" not in (evidence["text_excerpt"] or "")


async def test_T18_F12_generic_page_without_marker_is_unverified(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, _channel, _ = await run(tmp_path, fixture_ats, "/s12/apply")
    assert result.outcome == "submitted"
    assert result.submission_status == "submitted_unverified"
    assert (result.evidence or {})["signals"]["xhr_2xx"] is True


# ------------------------------------------------------------------ 13–14
async def test_T18_F13_browser_killed_before_submit_relaunches_once(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, channel, _ = await run(tmp_path, fixture_ats, "/s13/apply")
    assert fixture_ats.state.counters["s13_apply"] == 2  # restarted from apply_url
    assert result.outcome == "submitted"
    assert len([i for i in channel.intents if i["ok"]]) == 1


async def test_T18_F14_browser_killed_after_submit_intent_is_outcome_unknown(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, _channel, _ = await run(tmp_path, fixture_ats, "/s14/apply")
    assert result.outcome == "outcome_unknown"
    assert result.submission_status == "outcome_unknown"
    assert result.submit_intent_at is not None
    assert len(fixture_ats.state.posts("/s14/submit")) == 1  # no retry
    assert [h.path for h in fixture_ats.state.hits].count("/s14/apply") == 1


# ------------------------------------------------------------------ 15–17
async def test_T18_F15_hidden_prompt_injection_has_no_effect(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, _channel, _ = await run(tmp_path, fixture_ats, "/s15/apply")
    assert not fixture_ats.state.posts("/s15/withdraw")
    (form,) = posts(fixture_ats, "/s15/submit")
    typed = {v for k, vals in form.items() if k not in ("resume", "country") for v in vals if v}
    assert typed <= FACT_VALUES
    assert result.outcome == "submitted"


async def test_T18_F16_profile_locked_by_another_process(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    profile = tmp_path / "data" / "browser-profiles" / "apply-default"
    profile.mkdir(parents=True)
    (profile / "SingletonLock").symlink_to("otherhost-4242")
    result, channel, _ = await run(tmp_path, fixture_ats, "/s1/apply")
    assert result.outcome == "failed"
    assert result.error_class == "profile_locked"
    assert not fixture_ats.state.hits
    assert not channel.ai_calls
    assert (profile / "SingletonLock").is_symlink()  # never deleted automatically
    assert not (profile / LOCK_FILE).exists()


async def test_T18_F17_password_field_pauses_credential_field(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, _channel, _ = await run(tmp_path, fixture_ats, "/s17/apply")
    assert result.outcome == "paused"
    assert result.pause_reason == "credential_field"
    assert not fixture_ats.state.posts("/s17/submit")


# ------------------------------------------------------------------ S-22 / S-23 / T21-11
async def test_S_22_form_changed_after_approval_needs_a_new_approval(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    def mutate(kind: str, payload: dict[str, Any]) -> None:
        fixture_ats.state.flags["s22_mutate"] = True

    def decide(kind: str, payload: dict[str, Any], polls: int) -> dict[str, Any]:
        if kind == "submit" and len(channel.approvals_of("submit")) > 1:
            return {"state": "rejected", "response": None}
        return {"state": "approved", "response": None}

    channel = FakeChannel(on_create_approval=mutate, approval_delay_polls=12)
    channel.decide = decide
    result, channel, _ = await run(tmp_path, fixture_ats, "/s22/apply", channel=channel)
    submits = channel.approvals_of("submit")
    assert len(submits) == 2
    assert submits[0]["payload_hash"] != submits[1]["payload_hash"]
    assert not channel.intents  # the first approval no longer matched: no submit_intent
    assert not fixture_ats.state.posts("/s22/submit")
    assert result.outcome == "cancelled"
    assert result.error_class == "approval_rejected"


async def test_S_23_decoy_confirmation_is_negative(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, _channel, _ = await run(tmp_path, fixture_ats, "/s23/apply")
    assert result.outcome == "failed"
    assert result.error_class == "validation_errors_unresolved"
    assert (result.evidence or {})["verdict"] == "negative"


async def test_T21_11_submit_never_clicked_when_submit_intent_fails(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    channel = FakeChannel(submit_intent_always=offline_error())
    result, channel, _ = await run(tmp_path, fixture_ats, "/s1/apply", channel=channel)
    assert len(channel.intents) == 3  # retried 3×
    assert not fixture_ats.state.posts("/s1/submit")
    assert result.outcome == "paused"
    assert result.pause_reason == "network_offline"
    assert result.submit_intent_at is None


async def test_T21_11_lease_lost_at_submit_intent_stops_at_once(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    from pilih_jobs.api.errors import ApiConflictError

    channel = FakeChannel(
        submit_intent_always=ApiConflictError(status=409, error="lease_lost", message="lost")
    )
    result, channel, _ = await run(tmp_path, fixture_ats, "/s1/apply", channel=channel)
    assert len(channel.intents) == 1
    assert not fixture_ats.state.posts("/s1/submit")
    assert result.outcome == "failed"
    assert result.error_class == "lease_lost"


async def test_lease_lost_mid_run_stops_acting(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    channel = FakeChannel()

    def lose(kind: str, payload: dict[str, Any]) -> None:
        channel.lost.set()

    channel.on_create_approval = lose
    result, channel, _ = await run(tmp_path, fixture_ats, "/s1/apply", channel=channel)
    assert result.error_class == "lease_lost"
    assert result.outcome == "failed"
    assert not channel.intents
    assert not fixture_ats.state.posts("/s1/submit")


async def test_ai_unavailable_pauses(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    channel = FakeChannel()
    channel.ai_impl.raise_on["page-classify"] = upstream_unavailable()
    result, _channel, _ = await run(tmp_path, fixture_ats, "/s1/apply", channel=channel)
    assert result.outcome == "paused"
    assert result.pause_reason == "ai_unavailable"


async def test_dry_run_fills_and_stops_before_the_gate(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, channel, _ = await run(tmp_path, fixture_ats, "/s1/apply", dry_run=True)
    assert result.outcome == "cancelled"
    assert result.error_class == "dry_run"
    assert not channel.intents
    assert not channel.approvals
    assert not fixture_ats.state.posts("/s1/submit")


async def test_auto_mode_submits_with_rule_id(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, channel, _ = await run(
        tmp_path, fixture_ats, "/s1/apply", mode="auto", context_kw={"rule": True}
    )
    assert result.outcome == "submitted"
    assert channel.intents[0]["rule_id"]
    assert channel.intents[0]["approval_id"] is None
    assert not channel.approvals


async def test_cookie_banner_reject_is_clicked(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, _channel, _ = await run(tmp_path, fixture_ats, "/cookie/apply")
    assert fixture_ats.state.posts("/cookie/rejected")
    assert result.outcome == "submitted"


async def test_review_page_forward_click_goes_through_the_gate(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    result, channel, _ = await run(tmp_path, fixture_ats, "/review/apply")
    assert result.outcome == "submitted"
    (approval,) = channel.approvals_of("submit")
    assert approval["payload"]["url"].endswith("/review/summary")
    assert_intent_before_submit(fixture_ats, channel, "/review/submit")


async def test_assisted_mode_user_clicks_submit_and_the_agent_verifies(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    """Assisted (19 §8.1): the agent fills, never clicks Submit; the user's click is verified."""

    def on_event(event: str, fields: dict[str, Any]) -> None:
        if event == "awaiting_user_submit":
            fixture_ats.state.flags["assist_click"] = True

    result, channel, _ = await run(
        tmp_path,
        fixture_ats,
        "/assist/apply",
        mode="assisted",
        on_event=on_event,
        pause_timeout_s=10.0,
    )
    assert result.outcome == "submitted", result
    assert (result.details or {}).get("via") == "assisted_user_click"
    assert not channel.intents  # assisted never records submit_intent
    assert not channel.approvals
    (form,) = posts(fixture_ats, "/assist/submit")
    assert form["email"] == ["rahma@example.com"]
    assert fixture_ats.state.posts("/assist/beacon")  # a background POST did not count


async def test_user_touched_values_are_never_overwritten_after_a_pause(
    tmp_path: Path, fixture_ats: FixtureServer, home: Path
) -> None:
    """18 §8 step 3: what the human typed during a pause wins; checkpoints hold no values."""
    import asyncio

    async def human(prompt: Any) -> str:
        assert prompt.reason == "missing_information"
        fixture_ats.state.flags["touch_type"] = True
        await asyncio.sleep(0.6)
        return "resume"

    def on_event(event: str, fields: dict[str, Any]) -> None:
        if event == "awaiting_user_submit":
            fixture_ats.state.flags["touch_click"] = True

    result, channel, ctx = await run(
        tmp_path,
        fixture_ats,
        "/touch/apply",
        mode="assisted",
        prompt_pause=human,
        on_event=on_event,
        pause_timeout_s=10.0,
    )
    assert channel.pause_reasons() == ["missing_information"]
    assert result.outcome == "submitted", result
    (form,) = posts(fixture_ats, "/touch/submit")
    assert form["q_color"] == ["Green"]
    assert form["email"] == ["me@personal.test"]  # never overwritten with the fact
    assert form["first_name"] == ["Rahma"]
    checkpoint = (ctx.run_dir / "checkpoint.json").read_text()
    steps = (ctx.run_dir / "steps.jsonl").read_text()
    for secret in ("rahma@example.com", "me@personal.test", "Green", "+62 812"):
        assert secret not in checkpoint
        assert secret not in steps
