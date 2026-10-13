"""ActionExecutor pre/postconditions in real Chromium (18 §6.3), controller modes A/B,
render_cv_page (PLAN C8), popup/dialog/download policies (18 §7.5–§7.6)."""

from __future__ import annotations

import asyncio
import socket
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from playwright.async_api import async_playwright

from pilih_jobs.browser.actions import (
    ClickRef,
    FillField,
    Scroll,
    SelectOption,
    SetCheckbox,
    SubmitAuthorization,
    UploadFile,
    WaitFor,
)
from pilih_jobs.browser.controller import BrowserController
from pilih_jobs.browser.errors import (
    ActionRejectedError,
    ActionsDisabledError,
    CdpNonLoopbackError,
    CredentialFieldError,
    LeaseLostError,
    SubmitNotAuthorizedError,
    UploadPathError,
)
from pilih_jobs.browser.executor import ActionExecutor
from pilih_jobs.browser.headless import render_cv_page
from pilih_jobs.browser.observer import Observation, PageObserver
from pilih_jobs.browser.session import PageSession
from pilih_jobs.browser.staging import UploadStager
from pilih_jobs.contracts.ids import new_id
from pilih_jobs.policy.domains import DomainAllowlist
from tests.fixtures.ats_server import HOST_RESOLVER_RULES, FixtureServer
from tests.fixtures.ats_server.fake_channel import CV_BYTES, sha256_hex

pytestmark = pytest.mark.browser


@dataclass
class Harness:
    session: PageSession
    observer: PageObserver
    executor: ActionExecutor
    stager: UploadStager
    file_id: str
    lost: list[bool]

    async def observe(self) -> Observation:
        return await self.observer.observe(step=0)

    def field(self, obs: Observation, label: str) -> str:
        return next(f.ref for f in obs.fields if f.label == label)

    def control(self, obs: Observation, text: str) -> str:
        return next(c.ref for c in obs.controls if c.text == text)


@pytest.fixture
async def harness(tmp_path: Path, fixture_ats: FixtureServer) -> AsyncIterator[Callable[..., Any]]:
    controller = BrowserController(
        data_dir=tmp_path / "data", host_resolver_rules=HOST_RESOLVER_RULES
    )
    await controller.start("managed", "apply-default", None, True, None)

    async def open_page(path: str, allow: tuple[str, ...] = ("acme-ats.test",)) -> Harness:
        session = await controller.new_session("tsk", DomainAllowlist(allow), fixture_ats.url(path))
        await session.page.goto(fixture_ats.url(path))
        await session.settle()
        observer = PageObserver(session, attempt_id=new_id("att"))
        stager = UploadStager(tmp_path / "run", keep=False)
        file_id = new_id("fil")

        async def download(fid: str, dest: Path, sha: str) -> Path:
            dest.write_bytes(CV_BYTES)
            return dest

        await stager.stage(
            file_id=file_id,
            sha256=sha256_hex(CV_BYTES),
            slot="cv_file",
            company="Acme",
            full_name="Rahma Putri",
            download=download,
        )
        lost = [False]

        def stop_check() -> None:
            if lost[0]:
                raise LeaseLostError("lost")

        executor = ActionExecutor(
            session, observer, stager, stop_check=stop_check, click_effect_timeout_s=2
        )
        return Harness(session, observer, executor, stager, file_id, lost)

    yield open_page
    await controller.stop("test")


# ------------------------------------------------------------------ fill_field
async def test_T18_exec_fill_field_positive(harness: Any) -> None:
    h: Harness = await harness("/s1/apply")
    obs = await h.observe()
    result = await h.executor.execute(FillField(h.field(obs, "First name"), "Rahma", "fact"), obs)
    assert result.ok
    assert result.postcondition == "value_match"
    assert await h.session.page.input_value("#first_name") == "Rahma"


async def test_T18_exec_fill_field_wrong_kind_rejected(harness: Any) -> None:
    h: Harness = await harness("/s1/apply")
    obs = await h.observe()
    with pytest.raises(ActionRejectedError) as info:
        await h.executor.execute(FillField(h.field(obs, "Country"), "ID", "fact"), obs)
    assert info.value.reason == "wrong_kind"


async def test_T18_exec_fill_password_refused(harness: Any) -> None:
    h: Harness = await harness("/s17/apply")
    obs = await h.observe()
    ref = next(f.ref for f in obs.fields if f.input_type == "password")
    with pytest.raises(CredentialFieldError):
        await h.executor.execute(FillField(ref, "hunter2", "fact"), obs)
    assert await h.session.page.input_value("#pw") == ""


async def test_T18_exec_fill_date_normalized(harness: Any) -> None:
    h: Harness = await harness("/extract/date_month")
    obs = await h.observe()
    result = await h.executor.execute(
        FillField(h.field(obs, "Start date"), "2026-11-01", "fact"), obs
    )
    assert result.ok


async def test_T18_exec_fill_contenteditable(harness: Any) -> None:
    h: Harness = await harness("/extract/contenteditable")
    obs = await h.observe()
    result = await h.executor.execute(FillField(h.field(obs, "Cover note"), "Hello", "answer"), obs)
    assert result.ok


# ------------------------------------------------------------------ select / check
async def test_T18_exec_select_option_positive_and_negative(harness: Any) -> None:
    h: Harness = await harness("/s1/apply")
    obs = await h.observe()
    ref = h.field(obs, "Country")
    assert (await h.executor.execute(SelectOption(ref, "ID"), obs)).ok
    assert await h.session.page.input_value("#country") == "ID"
    with pytest.raises(ActionRejectedError) as info:
        await h.executor.execute(SelectOption(ref, "XX"), obs)
    assert info.value.reason == "no_such_option"


async def test_T18_exec_radio_group_and_checkbox(harness: Any) -> None:
    h: Harness = await harness("/extract/radio_group")
    obs = await h.observe()
    assert (
        await h.executor.execute(SelectOption(h.field(obs, "Willing to relocate?"), "y"), obs)
    ).ok
    h2: Harness = await harness("/extract/single_checkbox")
    obs2 = await h2.observe()
    ref = h2.field(obs2, "I agree to the terms")
    assert (await h2.executor.execute(SetCheckbox(ref, True), obs2)).ok
    assert await h2.session.page.is_checked("input[name=terms]")


async def test_T18_exec_set_checkbox_on_text_rejected(harness: Any) -> None:
    h: Harness = await harness("/s1/apply")
    obs = await h.observe()
    with pytest.raises(ActionRejectedError):
        await h.executor.execute(SetCheckbox(h.field(obs, "Email"), True), obs)


async def test_T18_exec_combobox_exact_option(harness: Any) -> None:
    h: Harness = await harness("/extract/combobox_static")
    obs = await h.observe()
    ref = h.field(obs, "Location")
    with pytest.raises(ActionRejectedError):
        await h.executor.execute(SelectOption(ref, "Surabaya"), obs)


# ------------------------------------------------------------------ upload
async def test_T18_exec_upload_visible_input(harness: Any) -> None:
    h: Harness = await harness("/s1/apply")
    obs = await h.observe()
    result = await h.executor.execute(UploadFile(h.field(obs, "Resume/CV"), h.file_id), obs)
    assert result.ok
    assert result.postcondition == "set_input_files"


async def test_T18_exec_upload_hidden_input_via_file_chooser(harness: Any) -> None:
    h: Harness = await harness("/s3/apply")
    obs = await h.observe()
    field = next(f for f in obs.fields if f.kind == "file")
    assert field.hidden_input
    assert field.trigger_ref
    result = await h.executor.execute(UploadFile(field.ref, h.file_id), obs)
    assert result.postcondition == "file_chooser"
    assert (await h.session.page.text_content("#file-echo") or "").endswith(".pdf")


async def test_T18_exec_upload_unknown_file_refused(harness: Any) -> None:
    h: Harness = await harness("/s1/apply")
    obs = await h.observe()
    with pytest.raises(UploadPathError):
        await h.executor.execute(
            UploadFile(h.field(obs, "Resume/CV"), "fil_01JC0000000000000000000099"), obs
        )


# ------------------------------------------------------------------ click_ref
async def test_T18_exec_submit_requires_authorization(
    harness: Any, fixture_ats: FixtureServer
) -> None:
    h: Harness = await harness("/s1/apply")
    obs = await h.observe()
    ref = h.control(obs, "Submit application")
    with pytest.raises(SubmitNotAuthorizedError):
        await h.executor.execute(ClickRef(ref, "submit"), obs)
    control = obs.control(ref)
    assert control is not None
    stale = SubmitAuthorization(
        form_hash="0" * 64, ref=ref, signature=control.signature, submit_intent_at=1
    )
    with pytest.raises(SubmitNotAuthorizedError):
        await h.executor.execute(ClickRef(ref, "submit", stale), obs)
    used = SubmitAuthorization(obs.form_hash, ref, control.signature, 1, used=True)
    with pytest.raises(SubmitNotAuthorizedError):
        await h.executor.execute(ClickRef(ref, "submit", used), obs)
    assert not fixture_ats.state.posts("/s1/submit")


async def test_T18_exec_submit_with_authorization_clicks_once(
    harness: Any, fixture_ats: FixtureServer
) -> None:
    h: Harness = await harness("/s1/apply")
    obs = await h.observe()
    ref = h.control(obs, "Submit application")
    control = obs.control(ref)
    assert control is not None
    auth = SubmitAuthorization(obs.form_hash, ref, control.signature, 1)
    result = await h.executor.execute(ClickRef(ref, "submit", auth), obs)
    assert auth.used
    assert result.ok
    with pytest.raises(SubmitNotAuthorizedError):
        await h.executor.execute(ClickRef(ref, "submit", auth), obs)


async def test_T18_exec_click_other_role_refused(harness: Any, fixture_ats: FixtureServer) -> None:
    h: Harness = await harness("/s15/apply")
    obs = await h.observe()
    ref = h.control(obs, "Withdraw application")
    with pytest.raises(ActionRejectedError) as info:
        await h.executor.execute(ClickRef(ref, "next"), obs)
    assert info.value.reason in ("role_not_allowed", "role_mismatch")
    assert not fixture_ats.state.posts("/s15/withdraw")


async def test_T18_exec_form_posting_off_allowlist_refused(harness: Any) -> None:
    h: Harness = await harness("/inj/form_action_offdomain/apply")
    obs = await h.observe()
    ref = h.control(obs, "Submit application")
    control = obs.control(ref)
    assert control is not None
    auth = SubmitAuthorization(obs.form_hash, ref, control.signature, 1)
    with pytest.raises(ActionRejectedError) as info:
        await h.executor.execute(ClickRef(ref, "submit", auth), obs)
    assert info.value.reason == "target_off_allowlist"


async def test_T18_exec_click_next_postcondition(harness: Any) -> None:
    h: Harness = await harness("/s2/step1")
    obs = await h.observe()
    for label, value in (("First name", "R"), ("Last name", "P"), ("Email", "r@example.com")):
        obs = await h.observe()
        await h.executor.execute(FillField(h.field(obs, label), value, "fact"), obs)
    obs = await h.observe()
    result = await h.executor.execute(ClickRef(h.control(obs, "Next"), "next"), obs)
    assert result.postcondition in ("navigation", "network_response", "dom_mutation")
    assert h.session.url.endswith("/s2/step2")


# ------------------------------------------------------------------ scroll / wait / guards
async def test_T18_exec_scroll_and_wait(harness: Any) -> None:
    h: Harness = await harness("/s1/apply")
    obs = await h.observe()
    assert (await h.executor.execute(Scroll(None, "down"), obs)).ok
    timed_out = await h.executor.execute(WaitFor("url_change", 300), obs)
    assert timed_out.postcondition == "timeout"
    with pytest.raises(ActionRejectedError):
        await h.executor.execute(WaitFor("network_idle", 20_000), obs)


async def test_T18_exec_off_allowlist_page_is_observe_only(harness: Any) -> None:
    h: Harness = await harness("/s1/apply", allow=("partner-ats.test",))
    obs = await h.observe()
    assert not obs.allowlisted
    with pytest.raises(ActionsDisabledError):
        await h.executor.execute(FillField(h.field(obs, "First name"), "Rahma", "fact"), obs)


async def test_T18_exec_lease_lost_stops_before_acting(harness: Any) -> None:
    h: Harness = await harness("/s1/apply")
    obs = await h.observe()
    h.lost[0] = True
    with pytest.raises(LeaseLostError):
        await h.executor.execute(FillField(h.field(obs, "First name"), "Rahma", "fact"), obs)
    assert await h.session.page.input_value("#first_name") == ""


async def test_T18_exec_unknown_action_type_rejected(harness: Any) -> None:
    h: Harness = await harness("/s1/apply")
    obs = await h.observe()

    @dataclass
    class Goto:
        url: str

    with pytest.raises(ActionRejectedError) as info:
        await h.executor.execute(Goto("http://evil-redirect.test/"), obs)
    assert info.value.reason == "unknown_action"


async def test_T18_dialog_confirm_is_dismissed_and_requests_a_pause(harness: Any) -> None:
    h: Harness = await harness("/misc/dialog")
    obs = await h.observe()
    await h.executor.execute(ClickRef(h.control(obs, "Next"), "next"), obs)
    await asyncio.sleep(0.2)
    assert h.session.pending_dialog == "Discard your answers?"
    assert await h.session.page.title() != "discarded"


async def test_T18_download_is_blocked(harness: Any) -> None:
    h: Harness = await harness("/misc/download")
    await h.session.page.click("#dl")
    await asyncio.sleep(0.5)
    assert h.session.events.downloads_blocked >= 1


# ------------------------------------------------------------------ render_cv_page
async def test_render_cv_page_done(fixture_ats: FixtureServer) -> None:
    result = await render_cv_page(
        fixture_ats.url("/render/ok"), timeout_s=10, host_resolver_rules=HOST_RESOLVER_RULES
    )
    assert result == {
        "status": "done",
        "file_id": "fil_01JC0000000000000000000001",
        "sha256": "ab" * 32,
    }


async def test_render_cv_page_error_and_timeout(fixture_ats: FixtureServer) -> None:
    err = await render_cv_page(
        fixture_ats.url("/render/err"), timeout_s=10, host_resolver_rules=HOST_RESOLVER_RULES
    )
    assert err["status"] == "error"
    assert err["message"] == "pdf failed"
    slow = await render_cv_page(
        fixture_ats.url("/render/never"), timeout_s=1, host_resolver_rules=HOST_RESOLVER_RULES
    )
    assert slow["status"] == "error"
    assert "timed out" in slow["message"]
    bad = await render_cv_page("file:///etc/passwd")
    assert bad["status"] == "error"


# ------------------------------------------------------------------ Mode B (CDP)
def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


async def test_T18_mode_b_connects_over_loopback_and_leaves_user_tabs(
    tmp_path: Path, fixture_ats: FixtureServer
) -> None:
    """The user's own browser (debugging on loopback) keeps running and keeps its tabs."""
    port = _free_port()
    async with async_playwright() as owner:
        user = await owner.chromium.launch(
            args=[
                f"--remote-debugging-port={port}",
                "--remote-debugging-address=127.0.0.1",
                f"--host-resolver-rules={HOST_RESOLVER_RULES}",
            ]
        )
        user_context = await user.new_context()
        user_tab = await user_context.new_page()
        await user_tab.goto("data:text/html,<title>mine</title>")
        controller = BrowserController(data_dir=tmp_path / "data")
        await controller.start("connected", None, None, True, f"http://127.0.0.1:{port}")
        assert controller.cdp_version is not None
        assert (controller.cdp_version.major or 0) >= 120
        session = await controller.new_session(
            "tsk", DomainAllowlist(["acme-ats.test"]), fixture_ats.url("/s1/apply")
        )
        await session.open_apply_url()
        assert session.url.endswith("/s1/apply")
        obs = await PageObserver(session, attempt_id=new_id("att")).observe(step=0)
        assert any(f.label == "First name" for f in obs.fields)
        await asyncio.wait_for(controller.stop("test"), 20)
        assert user.is_connected()
        assert not user_tab.is_closed()
        assert await user_tab.title() == "mine"
        await user.close()


async def test_T18_mode_b_refuses_non_loopback(tmp_path: Path) -> None:
    controller = BrowserController(data_dir=tmp_path / "data")
    with pytest.raises(CdpNonLoopbackError):
        await controller.start("connected", None, None, True, "http://192.168.1.20:9222")
