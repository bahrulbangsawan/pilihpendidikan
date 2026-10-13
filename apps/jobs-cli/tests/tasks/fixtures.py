"""Fixtures shared by the leaf-4.4 test packages (tasks, cv, email, commands).

Each package's `conftest.py` re-exports them (`from tests.tasks.fixtures import *`).
"""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from pilih_jobs.agent.types import AttemptContext, AttemptResult
from pilih_jobs.api.client import ApiClient
from pilih_jobs.auth import ALL_SCOPES, BASE_SCOPES
from pilih_jobs.auth.store import AccountMeta
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.flusher import FlushReport, OutboxFlusher
from pilih_jobs.sync.outbox import Outbox
from pilih_jobs.tasks.hooks import task_hooks
from pilih_jobs.tasks.lease import ApiLeaseChannel, LeaseGrant
from pilih_jobs.tasks.local import LocalTaskStore
from pilih_jobs.tasks.runner import Executors, RunnerEnv
from tests.support.fake_api import FakeApi
from tests.support.helpers import sign_in
from tests.tasks.fakes import CloudFake, install_binary


@dataclass
class Recorder:
    events: list[tuple[str, dict[str, Any]]] = field(default_factory=lambda: [])

    def __call__(self, kind: str, fields: dict[str, Any]) -> None:
        self.events.append((kind, dict(fields)))

    def kinds(self) -> list[str]:
        return [k for k, _ in self.events]


class FakeClock:
    """A controllable monotonic clock (ms) for lease deadline tests (21 §16 test 10)."""

    def __init__(self, start: int = 1_000_000) -> None:
        self.now = start

    def __call__(self) -> int:
        return self.now

    def advance(self, ms: int) -> None:
        self.now += ms


@pytest.fixture
def cloud(fake_api: FakeApi, user_id: str) -> CloudFake:
    fake = CloudFake(fake_api, user_id)
    install_binary(fake_api, fake)
    return fake


@pytest.fixture
def account(runtime: Runtime, fake_api: FakeApi, user_id: str, cloud: CloudFake) -> AccountMeta:
    meta = sign_in(runtime, fake_api, user_id, list(ALL_SCOPES))
    runtime.transport = fake_api.transport
    return meta


@pytest.fixture
def base_account(
    runtime: Runtime, fake_api: FakeApi, user_id: str, cloud: CloudFake
) -> AccountMeta:
    meta = sign_in(runtime, fake_api, user_id, list(BASE_SCOPES))
    runtime.transport = fake_api.transport
    return meta


@pytest.fixture
def cli_cloud(
    cli: Callable[..., Any], cloud: CloudFake, fake_api: FakeApi, user_id: str
) -> Callable[..., Any]:
    """The in-process CLI, signed in with every scope, against the cloud fake."""
    rt = Runtime.create()
    try:
        sign_in(rt, fake_api, user_id, list(ALL_SCOPES))
    finally:
        rt.close()
    return cli


@pytest.fixture
def cli_base(
    cli: Callable[..., Any], cloud: CloudFake, fake_api: FakeApi, user_id: str
) -> Callable[..., Any]:
    """The in-process CLI signed in with the base scopes only (no step-up)."""
    rt = Runtime.create()
    try:
        sign_in(rt, fake_api, user_id, list(BASE_SCOPES))
    finally:
        rt.close()
    return cli


@pytest.fixture
async def api(runtime: Runtime, account: AccountMeta) -> AsyncIterator[ApiClient]:
    client = runtime.authenticated_client(allow_personal_token=False)
    yield client
    await client.aclose()


@pytest.fixture
def recorder() -> Recorder:
    return Recorder()


@pytest.fixture
def make_env(
    runtime: Runtime, account: AccountMeta, api: ApiClient, recorder: Recorder
) -> Callable[..., RunnerEnv]:
    def make(**overrides: Any) -> RunnerEnv:
        values: dict[str, Any] = {
            "db": runtime.db,
            "issuer": runtime.issuer,
            "paths": runtime.paths,
            "config": runtime.config,
            "api": api,
            "device_id": account.device_id,
            "clock": runtime.clock,
            "runtime": runtime,
            "emit": recorder,
            "has_display": True,
        }
        values.update(overrides)
        return RunnerEnv(**values)

    return make


async def flush(runtime: Runtime, api: ApiClient) -> FlushReport:
    """Deliver the outbox through the task hooks (what the worker's SyncLoop does)."""
    flusher = OutboxFlusher(
        Outbox(runtime.db, runtime.issuer),
        api,
        hooks=task_hooks(runtime.db, runtime.issuer),
        upload_root=runtime.paths.data_dir,
    )
    return await flusher.flush()


async def claim_grant(
    api: ApiClient, account: AccountMeta, caps: list[str] | None = None
) -> LeaseGrant:
    from pilih_jobs.tasks.poll import claim

    outcome = await claim(api, str(account.device_id), caps or ["apply", "headed_browser"])
    assert outcome.grant is not None
    return outcome.grant


def make_channel(
    runtime: Runtime,
    api: ApiClient,
    grant: LeaseGrant,
    **kwargs: Any,
) -> ApiLeaseChannel:
    store = LocalTaskStore(runtime.db)
    store.upsert(
        grant.task_id,
        kind=grant.kind,
        local_state="claimed",
        lease_id=grant.lease_id,
        attempt_id=grant.attempt_id,
        checkpoint={"application_id": grant.application_id},
    )
    return ApiLeaseChannel(
        api=api,
        outbox=Outbox(runtime.db, runtime.issuer),
        store=store,
        grant=grant,
        clock=runtime.clock,
        paths=runtime.paths,
        **kwargs,
    )


EVIDENCE = {
    "kind": "browser_confirmation",
    "verdict": "verified",
    "signals": {
        "url_match": True,
        "dom_marker": True,
        "negative_marker": False,
        "xhr_2xx": True,
        "form_gone": True,
        "application_received": 0.97,
        "still_form_or_error": 0.02,
    },
    "final_url": "https://job-boards.greenhouse.io/acme/jobs/1/confirmation",
    "captured_at": 1_791_770_000_000,
}
FORM_HASH = "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a"


def submitting_agent(
    *,
    approval: bool = False,
    steps: int = 3,
    log_dir: Path | None = None,
    verdict: str = "verified",
) -> Callable[[AttemptContext], Any]:
    """A well-behaved fake agent: progress → (approval) → submit_intent → submitted."""

    async def run(ctx: AttemptContext) -> AttemptResult:
        channel = ctx.channel
        for step in range(steps):
            if channel.lost.is_set() or channel.cancel_requested.is_set():
                return AttemptResult(outcome="cancelled", error_class="cancelled", steps=step)
            await channel.events(
                [
                    {
                        "type": "progress",
                        "progress": {"stage": "filling", "step": step, "message": f"step {step}"},
                    }
                ]
            )
        approval_id = None
        if approval:
            created = await channel.create_approval(
                "submit",
                {
                    "type": "browser_submit",
                    "form_hash": FORM_HASH,
                    "url": "https://job-boards.greenhouse.io/acme/jobs/1/apply",
                    "posting_id": ctx.context["posting"]["id"],
                    "fields": [],
                    "attachments": [],
                },
                FORM_HASH,
            )
            approval_id = created["id"]
            decided = await channel.poll_approval(approval_id)
            if decided["state"] != "approved":
                return AttemptResult(
                    outcome="cancelled", error_class="approval_rejected", steps=steps
                )
        if ctx.dry_run:
            return AttemptResult(outcome="paused", pause_reason="user_requested", steps=steps)
        await channel.submit_intent(FORM_HASH, approval_id=approval_id)
        log_path = None
        if log_dir is not None:
            log_path = log_dir / "steps.jsonl"
            log_path.write_text('{"event":"attempt_finished"}\n')
        return AttemptResult(
            outcome="submitted",
            evidence={**EVIDENCE, "verdict": verdict},
            submission_status="submitted_verified",
            steps=steps,
            ai_calls=1,
            log_path=log_path,
        )

    return run


def executors(
    run_attempt: Callable[[AttemptContext], Any] | None = None, **kwargs: Any
) -> Executors:
    values: dict[str, Any] = dict(kwargs)
    if run_attempt is not None:
        values["run_attempt"] = run_attempt
    return Executors(**values)


__all__ = [
    "EVIDENCE",
    "FORM_HASH",
    "FakeClock",
    "Recorder",
    "account",
    "api",
    "base_account",
    "claim_grant",
    "cli_base",
    "cli_cloud",
    "cloud",
    "executors",
    "flush",
    "make_channel",
    "make_env",
    "recorder",
    "submitting_agent",
]
