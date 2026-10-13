"""T16-SIGNALS: SIGINT / SIGTERM semantics (16 §6) with real signals delivered to this
process (POSIX): before `submit_intent` the attempt pauses (or is released by the worker);
after it nothing stops until verification ends; the second Ctrl+C writes a local
`outcome_unknown` result to the outbox **before** cancelling."""

from __future__ import annotations

import asyncio
import os
import signal
import sys
from collections.abc import Callable
from typing import Any

import pytest

from pilih_jobs.agent.types import AttemptContext, AttemptResult
from pilih_jobs.auth.store import AccountMeta
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.outbox import Outbox
from pilih_jobs.tasks.apply import ApplyOrchestrator, ApplyRequest
from pilih_jobs.tasks.local import LocalTaskStore
from pilih_jobs.tasks.runner import ExecutionOptions, Interrupts, RunnerEnv, TaskRunner
from pilih_jobs.tasks.signals import SignalHandlers
from tests.support.helpers import CliResult
from tests.tasks.fakes import CloudFake
from tests.tasks.fixtures import EVIDENCE, FORM_HASH, Recorder, claim_grant, executors

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="POSIX signals")


def _sigint() -> None:
    os.kill(os.getpid(), signal.SIGINT)


def _bodies(runtime: Runtime) -> list[dict[str, Any]]:
    return [
        {"path": e.path, "kind": e.kind, "key": e.idempotency_key, "body": e.json()}
        for e in Outbox(runtime.db, runtime.issuer).entries()
    ]


async def _run(
    env: RunnerEnv, run_attempt: Callable[[AttemptContext], Any], app_id: str, **kwargs: Any
) -> tuple[Any, Interrupts]:
    interrupts = Interrupts()
    with SignalHandlers(interrupts):
        outcome = await ApplyOrchestrator(env, executors(run_attempt)).run(
            ApplyRequest(application_id=app_id, **kwargs), interrupts
        )
    return outcome, interrupts


async def test_T16_SIGNALS_first_sigint_before_intent_pauses_at_the_next_step(
    runtime: Runtime, cloud: CloudFake, make_env: Callable[..., RunnerEnv]
) -> None:
    app = cloud.add_application()
    steps: list[int] = []

    async def slow(ctx: AttemptContext) -> AttemptResult:
        for step in range(500):
            if ctx.channel.cancel_requested.is_set():
                return AttemptResult(outcome="cancelled", error_class="cancelled", steps=step)
            steps.append(step)
            if step == 2:
                _sigint()
            await asyncio.sleep(0.01)
        return AttemptResult(outcome="failed")

    outcome, interrupts = await _run(make_env(), slow, app["id"], interactive=True)
    assert interrupts.graceful.is_set()
    assert not interrupts.abort.is_set()
    assert outcome.outcome == "paused"
    assert outcome.interrupted
    assert outcome.reason == "user_requested"
    assert len(steps) < 20
    assert cloud.intents == []
    paused = [
        event
        for entry in _bodies(runtime)
        if entry["path"].endswith("/events")
        for event in entry["body"]["events"]
        if event["type"] == "paused"
    ]
    assert paused
    assert paused[0]["pause_reason"] == "user_requested"
    assert {e["kind"] for e in _bodies(runtime)} == {"lease_report"}
    assert not any(e["path"].endswith("/result") for e in _bodies(runtime))
    assert LocalTaskStore(runtime.db).get(outcome.task_id).local_state == "paused"  # type: ignore[union-attr]


async def test_T16_SIGNALS_first_sigint_after_intent_waits_for_verification(
    runtime: Runtime, cloud: CloudFake, make_env: Callable[..., RunnerEnv], recorder: Recorder
) -> None:
    app = cloud.add_application()
    cancel_seen: list[bool] = []

    async def verifying(ctx: AttemptContext) -> AttemptResult:
        await ctx.channel.submit_intent(FORM_HASH)
        _sigint()
        for _ in range(10):
            await asyncio.sleep(0.01)
            cancel_seen.append(ctx.channel.cancel_requested.is_set())
        return AttemptResult(
            outcome="submitted", evidence=EVIDENCE, submission_status="submitted_verified"
        )

    outcome, interrupts = await _run(make_env(), verifying, app["id"])
    assert interrupts.graceful.is_set()
    assert cancel_seen
    assert not any(cancel_seen)
    assert outcome.outcome == "submitted"
    results = [e for e in _bodies(runtime) if e["path"].endswith("/result")]
    assert results[0]["body"]["outcome"] == "submitted"
    assert results[0]["kind"] == "lease_report"
    warnings = [f.get("message", "") for k, f in recorder.events if k == "warning"]
    assert any("submission may be in progress" in w for w in warnings)


async def test_T16_SIGNALS_second_sigint_after_intent_writes_outcome_unknown_first(
    runtime: Runtime, cloud: CloudFake, make_env: Callable[..., RunnerEnv]
) -> None:
    app = cloud.add_application()
    queued_before_cancel: list[bool] = []

    async def hangs(ctx: AttemptContext) -> AttemptResult:
        await ctx.channel.submit_intent(FORM_HASH)
        _sigint()
        await asyncio.sleep(0.05)
        _sigint()
        try:
            await asyncio.sleep(30)
        except asyncio.CancelledError:
            entry = Outbox(runtime.db, runtime.issuer).get(f"result:{ctx.lease_id}")
            queued_before_cancel.append(entry is not None)
            raise
        return AttemptResult(outcome="failed")

    outcome, interrupts = await asyncio.wait_for(_run(make_env(), hangs, app["id"]), 10)
    assert interrupts.abort.is_set()
    assert queued_before_cancel == [True]
    assert outcome.outcome == "outcome_unknown"
    assert outcome.interrupted
    result = next(e for e in _bodies(runtime) if e["path"].endswith("/result"))
    assert result["body"]["outcome"] == "outcome_unknown"
    assert result["body"]["application_update"]["submission_status"] == "outcome_unknown"
    assert LocalTaskStore(runtime.db).get(outcome.task_id).local_state == "sync_pending"  # type: ignore[union-attr]


async def test_T16_SIGNALS_second_sigint_before_intent_aborts_without_a_result(
    runtime: Runtime, cloud: CloudFake, make_env: Callable[..., RunnerEnv]
) -> None:
    app = cloud.add_application()

    async def stubborn(_ctx: AttemptContext) -> AttemptResult:
        _sigint()
        await asyncio.sleep(0.05)
        _sigint()
        await asyncio.sleep(30)
        return AttemptResult(outcome="failed")

    outcome, _ = await asyncio.wait_for(_run(make_env(), stubborn, app["id"]), 10)
    assert outcome.outcome == "interrupted"
    assert outcome.interrupted
    assert not any(e["path"].endswith("/result") for e in _bodies(runtime))
    assert cloud.intents == []  # the lease simply expires (21 §7)


async def test_T16_SIGNALS_sigterm_before_intent_releases_the_lease_for_the_worker(
    runtime: Runtime,
    api: Any,
    account: AccountMeta,
    cloud: CloudFake,
    make_env: Callable[..., RunnerEnv],
) -> None:
    app = cloud.add_application()
    cloud.queue_task(app_id=app["id"])
    grant = await claim_grant(api, account)

    async def slow(ctx: AttemptContext) -> AttemptResult:
        os.kill(os.getpid(), signal.SIGTERM)
        for _ in range(200):
            if ctx.channel.cancel_requested.is_set():
                return AttemptResult(outcome="cancelled", error_class="cancelled")
            await asyncio.sleep(0.01)
        return AttemptResult(outcome="failed")

    interrupts = Interrupts()
    with SignalHandlers(interrupts, shutdown_on_term=True):
        outcome = await TaskRunner(make_env(), executors(slow)).execute(
            grant, ExecutionOptions(on_interrupt="release"), interrupts
        )
    assert interrupts.deadline_s == 30
    assert interrupts.shutdown
    assert outcome.outcome == "released"
    assert outcome.released == "shutdown"
    assert cloud.releases[-1] == {"task_id": grant.task_id, "reason": "shutdown"}


async def test_T16_SIGNALS_sigterm_deadline_aborts_a_hung_verification(
    runtime: Runtime,
    cloud: CloudFake,
    make_env: Callable[..., RunnerEnv],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("pilih_jobs.tasks.signals.SIGTERM_DEADLINE_S", 0.2)
    app = cloud.add_application()

    async def hung(ctx: AttemptContext) -> AttemptResult:
        await ctx.channel.submit_intent(FORM_HASH)
        os.kill(os.getpid(), signal.SIGTERM)
        await asyncio.sleep(30)
        return AttemptResult(outcome="failed")

    outcome, interrupts = await asyncio.wait_for(_run(make_env(), hung, app["id"]), 10)
    assert interrupts.deadline_s == 0.2
    assert outcome.outcome == "outcome_unknown"
    assert any(e["path"].endswith("/result") for e in _bodies(runtime))


def test_T16_SIGNALS_cli_apply_ctrl_c_exits_130_and_keeps_the_attempt_resumable(
    cli_cloud: Callable[..., CliResult], cloud: CloudFake, monkeypatch: pytest.MonkeyPatch
) -> None:
    app = cloud.add_application()

    async def slow(ctx: AttemptContext) -> AttemptResult:
        _sigint()
        for _ in range(300):
            if ctx.channel.cancel_requested.is_set():
                return AttemptResult(outcome="cancelled", error_class="cancelled")
            await asyncio.sleep(0.01)
        return AttemptResult(outcome="failed")

    monkeypatch.setattr("pilih_jobs.agent.run_attempt", slow)
    result = cli_cloud("--json", "apply", app["id"])
    assert result.code == 130
    final = result.ndjson[-1]
    assert final["type"] == "result"
    assert final["ok"] is False
    assert final["error"]["code"] == "interrupted"
    assert "--resume" in final["error"]["message"]
    assert signal.getsignal(signal.SIGINT) is signal.default_int_handler
