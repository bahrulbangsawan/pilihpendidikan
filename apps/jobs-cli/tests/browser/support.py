"""Helpers shared by the browser and agent tests: claim contexts, attempts, options."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from pilih_jobs.agent import AttemptContext, AttemptOptions, AttemptResult, run_attempt
from pilih_jobs.contracts.ids import new_id
from tests.fixtures.ats_server import APPLY_HOST, HOST_RESOLVER_RULES, FixtureServer
from tests.fixtures.ats_server.app_handlers import all_handlers
from tests.fixtures.ats_server.fake_channel import COVER_BYTES, CV_BYTES, FakeChannel, sha256_hex

GREENHOUSE_LIKE = {
    "id": "greenhouse",
    "headless_ok": True,
    "auto_ok": True,
    "confirmation_url_patterns": ["/confirmation(?:[/?#]|$)"],
    "confirmation_selectors": ["#application_confirmation"],
}


@pytest.fixture(scope="session")
def ats() -> Iterator[FixtureServer]:
    server = FixtureServer(all_handlers()).start()
    yield server
    server.stop()


@pytest.fixture
def fixture_ats(ats: FixtureServer) -> FixtureServer:
    ats.state.reset()
    return ats


def make_context(
    server: FixtureServer,
    path: str,
    *,
    mode: str = "approval",
    host: str = APPLY_HOST,
    adapter: dict[str, Any] | None = GREENHOUSE_LIKE,
    cover: bool = False,
    rule: bool = False,
    allowed_domains: list[str] | None = None,
    stage: str = "ready",
) -> tuple[dict[str, Any], dict[str, bytes]]:
    cv_id, cover_id = new_id("fil"), new_id("fil")
    files = {cv_id: CV_BYTES, cover_id: COVER_BYTES}
    context: dict[str, Any] = {
        "kind": "apply",
        "application": {
            "id": new_id("app"),
            "stage": stage,
            "submission_status": "not_started",
            "mode": mode,
        },
        "posting": {
            "id": new_id("pst"),
            "apply_url": server.url(path, host),
            "company_name": "Acme Fixture Co",
            "title": "Software Engineer",
            "status": "open",
        },
        "mode": mode,
        "cv": {
            "cv_variant_id": None,
            "status": "approved",
            "file": {"file_id": cv_id, "sha256": sha256_hex(CV_BYTES)},
        },
        "cover_letter": {"file_id": cover_id, "sha256": sha256_hex(COVER_BYTES)} if cover else None,
        "rule": (
            {"id": new_id("rul"), "mode": "auto", "limits": {}, "cv_policy": {}} if rule else None
        ),
        "allowed_domains": allowed_domains
        if allowed_domains is not None
        else ["acme-ats.test", "partner-ats.test"],
        "adapter": adapter,
        "approval_policy": {
            "submit_requires_approval": mode == "approval",
            "generated_text_allowed": False,
            "evidence_screenshots": "on_submit",
        },
        "resume_from_approval": None,
    }
    return context, files


def test_options(tmp_path: Path, **overrides: Any) -> AttemptOptions:
    values: dict[str, Any] = {
        "browser_mode": "managed",
        "profile": "apply-default",
        "data_dir": tmp_path / "data",
        "host_resolver_rules": HOST_RESOLVER_RULES,
        "force_headless": True,
        "pause_timeout_s": 1.0,
        "headless_pause_timeout_s": 1.0,
        "approval_poll_s": 0.05,
        "approval_timeout_s": 5.0,
        "evidence_timeout_s": 4.0,
        "submit_intent_backoff_s": 0.01,
        "click_effect_timeout_s": 3.0,
        "network_offline_poll_s": 0.1,
        "network_offline_max_s": 0.5,
        "navigation_retry_delay_s": 0.1,
        "idle_timeout_s": 30.0,
        "evidence_screenshots": True,
    }
    values.update(overrides)
    return AttemptOptions(**values)


def make_attempt(
    tmp_path: Path,
    channel: FakeChannel,
    context: dict[str, Any],
    *,
    mode: str = "approval",
    dry_run: bool = False,
    headed: bool = False,
    interactive: bool = False,
    **option_overrides: Any,
) -> AttemptContext:
    attempt_id = new_id("att")
    return AttemptContext(
        task={"id": new_id("tsk"), "kind": "apply", "payload": {"mode": mode}},
        lease_id=new_id("lse"),
        attempt_id=attempt_id,
        context=context,
        channel=channel,  # type: ignore[arg-type]
        mode=mode,  # type: ignore[arg-type]
        headed=headed,
        interactive=interactive,
        run_dir=tmp_path / "runs" / attempt_id,
        dry_run=dry_run,
        approve_in_cli=False,
        options=test_options(tmp_path, **option_overrides),
    )


async def run(
    tmp_path: Path,
    server: FixtureServer,
    path: str,
    *,
    mode: str = "approval",
    channel: FakeChannel | None = None,
    context_kw: dict[str, Any] | None = None,
    dry_run: bool = False,
    **option_overrides: Any,
) -> tuple[AttemptResult, FakeChannel, AttemptContext]:
    context, files = make_context(server, path, mode=mode, **(context_kw or {}))
    chan = channel or FakeChannel()
    chan.mode = mode
    chan.files.update(files)
    server.state.kill_profile_dir = tmp_path / "data" / "browser-profiles" / "apply-default"
    ctx = make_attempt(tmp_path, chan, context, mode=mode, dry_run=dry_run, **option_overrides)
    result = await run_attempt(ctx)
    return result, chan, ctx


def submitted_values(server: FixtureServer, prefix: str) -> list[dict[str, list[str]]]:
    return [h.form for h in server.state.posts(prefix)]
