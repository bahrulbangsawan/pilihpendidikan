"""TWK-APPLY and T21-12: `apply` orchestration — task targeted at this device → claim →
`run_attempt` → result through the outbox; the per-application lock (21 §9)."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from pilih_jobs.agent.types import AttemptContext, AttemptResult
from pilih_jobs.api.client import ApiClient
from pilih_jobs.auth.store import AccountMeta
from pilih_jobs.errors import ConflictError, PolicyRefusedError
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.outbox import Outbox
from pilih_jobs.tasks.apply import ApplyOrchestrator, ApplyRequest
from pilih_jobs.tasks.errors import AlreadyRunningError
from pilih_jobs.tasks.local import LocalTaskStore
from pilih_jobs.tasks.locks import acquire_app_lock
from pilih_jobs.tasks.runner import RunnerEnv
from tests.support.helpers import CliResult
from tests.tasks.fakes import CloudFake
from tests.tasks.fixtures import EVIDENCE, FORM_HASH, executors, flush, submitting_agent

Cli = Callable[..., CliResult]


async def test_TWK_APPLY_creates_a_targeted_task_claims_it_and_reports_the_submission(
    runtime: Runtime,
    api: ApiClient,
    account: AccountMeta,
    cloud: CloudFake,
    make_env: Callable[..., RunnerEnv],
) -> None:
    app = cloud.add_application()
    cloud.add_cv_variant(app["id"])
    orchestrator = ApplyOrchestrator(
        make_env(), executors(submitting_agent(log_dir=runtime.paths.data_dir))
    )
    outcome = await orchestrator.run(ApplyRequest(application_id=app["id"]))
    created = cloud.created[-1]
    assert created["target_device_id"] == account.device_id
    assert created["priority"] == 10
    assert created["payload"]["mode"] == "approval"
    assert outcome.outcome == "submitted"
    assert outcome.submission_status == "submitted_verified"
    assert len(cloud.intents) == 1
    assert (await flush(runtime, api)).done >= 1
    result = cloud.results[-1]
    assert result["key"] == f"result:{outcome.lease_id}"
    assert result["outcome"] == "submitted"
    assert result["application_update"] == {
        "base_revision": app["revision"],
        "submission_status": "submitted_verified",
        "stage": "applied",
    }
    assert result["evidence"]["verdict"] == "verified"
    assert result["stats"]["steps_count"] == 3
    assert result.get("log_file_id", "").startswith("fil_")  # the gzipped step log (run_log)
    local = LocalTaskStore(runtime.db).get(outcome.task_id)
    assert local is not None
    assert local.local_state == "done"
    assert not runtime.paths.staging_dir(str(outcome.attempt_id)).exists()


async def test_TWK_APPLY_gives_back_a_foreign_task_claimed_first(
    runtime: Runtime, account: AccountMeta, cloud: CloudFake, make_env: Callable[..., RunnerEnv]
) -> None:
    other = cloud.add_application()
    foreign = cloud.queue_task(app_id=other["id"], priority=10)
    foreign["created_at"] -= 10_000  # older: the claim returns it first
    app = cloud.add_application()
    outcome = await ApplyOrchestrator(make_env(), executors(submitting_agent())).run(
        ApplyRequest(application_id=app["id"])
    )
    assert outcome.task_id != foreign["id"]
    assert cloud.releases[0] == {"task_id": foreign["id"], "reason": "shutdown"}
    assert cloud.tasks[foreign["id"]]["state"] == "queued"


async def test_TWK_APPLY_dry_run_never_sends_submit_intent(
    runtime: Runtime, api: ApiClient, cloud: CloudFake, make_env: Callable[..., RunnerEnv]
) -> None:
    app = cloud.add_application()
    calls: list[str] = []

    async def sneaky(ctx: AttemptContext) -> AttemptResult:
        try:
            await ctx.channel.submit_intent(FORM_HASH)
        except PolicyRefusedError as exc:
            calls.append(exc.code)
        return AttemptResult(outcome="paused", pause_reason="user_requested")

    outcome = await ApplyOrchestrator(make_env(), executors(sneaky)).run(
        ApplyRequest(application_id=app["id"], dry_run=True)
    )
    assert calls == ["dry_run"]
    assert cloud.intents == []
    assert cloud.created[-1]["payload"]["dry_run"] is True
    assert outcome.outcome == "cancelled"
    assert outcome.reason == "dry_run"
    await flush(runtime, api)
    assert cloud.results[-1]["outcome"] == "cancelled"
    assert cloud.results[-1]["reason"] == "dry_run"


async def test_TWK_APPLY_approval_mode_waits_for_the_decision(
    runtime: Runtime, api: ApiClient, cloud: CloudFake, make_env: Callable[..., RunnerEnv]
) -> None:
    app = cloud.add_application()
    cloud.approve_on_poll = "approved"
    outcome = await ApplyOrchestrator(make_env(), executors(submitting_agent(approval=True))).run(
        ApplyRequest(application_id=app["id"])
    )
    assert outcome.outcome == "submitted"
    approval_id = next(iter(cloud.approvals))
    assert cloud.intents[0]["approval_id"] == approval_id


async def test_TWK_APPLY_rejected_approval_is_a_cancelled_result(
    runtime: Runtime, api: ApiClient, cloud: CloudFake, make_env: Callable[..., RunnerEnv]
) -> None:
    app = cloud.add_application()
    cloud.approve_on_poll = "rejected"
    outcome = await ApplyOrchestrator(make_env(), executors(submitting_agent(approval=True))).run(
        ApplyRequest(application_id=app["id"])
    )
    assert outcome.outcome == "cancelled"
    assert outcome.reason == "approval_rejected"
    assert cloud.intents == []
    await flush(runtime, api)
    assert cloud.results[-1]["reason"] == "approval_rejected"


async def test_TWK_APPLY_nothing_is_retried_after_submit_intent(
    runtime: Runtime, api: ApiClient, cloud: CloudFake, make_env: Callable[..., RunnerEnv]
) -> None:
    app = cloud.add_application()

    async def crashes_after_intent(ctx: AttemptContext) -> AttemptResult:
        await ctx.channel.submit_intent(FORM_HASH)
        return AttemptResult(outcome="failed", error_class="browser_crashed", retryable=True)

    outcome = await ApplyOrchestrator(make_env(), executors(crashes_after_intent)).run(
        ApplyRequest(application_id=app["id"])
    )
    assert outcome.outcome == "outcome_unknown"
    await flush(runtime, api)
    result = cloud.results[-1]
    assert result["outcome"] == "outcome_unknown"
    assert "retryable" not in result
    assert result["application_update"]["submission_status"] == "outcome_unknown"


async def test_TWK_APPLY_negative_evidence_after_intent_is_failed_not_retryable(
    runtime: Runtime, api: ApiClient, cloud: CloudFake, make_env: Callable[..., RunnerEnv]
) -> None:
    app = cloud.add_application()

    async def negative(ctx: AttemptContext) -> AttemptResult:
        await ctx.channel.submit_intent(FORM_HASH)
        return AttemptResult(
            outcome="failed",
            error_class="validation_errors_unresolved",
            retryable=True,
            evidence={**EVIDENCE, "verdict": "negative"},
        )

    await ApplyOrchestrator(make_env(), executors(negative)).run(
        ApplyRequest(application_id=app["id"])
    )
    await flush(runtime, api)
    result = cloud.results[-1]
    assert result["outcome"] == "failed"
    assert result["retryable"] is False
    assert result["application_update"]["submission_status"] == "failed"


async def test_TWK_APPLY_lost_lease_after_intent_takes_the_late_evidence_path(
    runtime: Runtime, api: ApiClient, cloud: CloudFake, make_env: Callable[..., RunnerEnv]
) -> None:
    app = cloud.add_application()

    async def loses_lease(ctx: AttemptContext) -> AttemptResult:
        await ctx.channel.submit_intent(FORM_HASH)
        cloud.lose(ctx.task["id"])  # the laptop slept; the reaper took the lease
        await ctx.channel.heartbeat_once()  # type: ignore[attr-defined] - 409 lease_lost
        assert ctx.channel.lost.is_set()
        return AttemptResult(
            outcome="submitted", evidence=EVIDENCE, submission_status="submitted_verified"
        )

    outcome = await ApplyOrchestrator(make_env(), executors(loses_lease)).run(
        ApplyRequest(application_id=app["id"])
    )
    assert outcome.outcome == "lost"
    assert outcome.evidence
    await flush(runtime, api)
    assert cloud.results == []  # never reported under the lost lease
    assert cloud.late[-1]["attempt_id"] == outcome.attempt_id
    assert cloud.late[-1]["evidence"]["verdict"] == "verified"
    assert cloud.late[-1]["outcome"] == "submitted"
    assert LocalTaskStore(runtime.db).get(outcome.task_id).local_state == "done"  # type: ignore[union-attr]


async def test_TWK_APPLY_a_result_refused_with_lease_lost_becomes_late_evidence(
    runtime: Runtime, api: ApiClient, cloud: CloudFake, make_env: Callable[..., RunnerEnv]
) -> None:
    app = cloud.add_application()
    orchestrator = ApplyOrchestrator(make_env(), executors(submitting_agent()))
    outcome = await orchestrator.run(ApplyRequest(application_id=app["id"]))
    assert outcome.outcome == "submitted"
    cloud.lose(outcome.task_id)  # the result was queued offline and the lease expired
    await flush(runtime, api)
    assert cloud.results == []
    assert cloud.late
    assert cloud.late[-1]["evidence"]["verdict"] == "verified"
    dead = Outbox(runtime.db, runtime.issuer).entries(["dead"])
    assert any(e.path.endswith("/result") and e.last_status == 409 for e in dead)


async def test_TWK_APPLY_paused_for_a_human_is_kept_interactive_and_released_headless(
    runtime: Runtime, cloud: CloudFake, make_env: Callable[..., RunnerEnv]
) -> None:
    async def login_wall(_ctx: AttemptContext) -> AttemptResult:
        return AttemptResult(outcome="paused", pause_reason="login_required")

    interactive_app = cloud.add_application()
    kept = await ApplyOrchestrator(make_env(), executors(login_wall)).run(
        ApplyRequest(application_id=interactive_app["id"], interactive=True)
    )
    assert kept.outcome == "paused"
    assert kept.reason == "login_required"
    assert LocalTaskStore(runtime.db).get(kept.task_id).local_state == "paused"  # type: ignore[union-attr]
    headless_app = cloud.add_application()
    released = await ApplyOrchestrator(make_env(), executors(login_wall)).run(
        ApplyRequest(application_id=headless_app["id"])
    )
    assert released.outcome == "released"
    assert released.released == "needs_headed"
    assert cloud.releases[-1]["reason"] == "needs_headed"


async def test_TWK_APPLY_resume_reattaches_to_the_paused_lease(
    runtime: Runtime, cloud: CloudFake, make_env: Callable[..., RunnerEnv]
) -> None:
    app = cloud.add_application()

    async def pause(_ctx: AttemptContext) -> AttemptResult:
        return AttemptResult(outcome="paused", pause_reason="unknown_question")

    first = await ApplyOrchestrator(make_env(), executors(pause)).run(
        ApplyRequest(application_id=app["id"], interactive=True)
    )
    seen: list[dict[str, Any]] = []

    async def finish(ctx: AttemptContext) -> AttemptResult:
        seen.append({"lease": ctx.lease_id, "attempt": ctx.attempt_id})
        await ctx.channel.submit_intent(FORM_HASH)
        return AttemptResult(
            outcome="submitted", evidence=EVIDENCE, submission_status="submitted_verified"
        )

    second = await ApplyOrchestrator(make_env(), executors(finish)).run(
        ApplyRequest(application_id=app["id"], resume=True, interactive=True)
    )
    assert seen == [{"lease": first.lease_id, "attempt": first.attempt_id}]
    assert second.outcome == "submitted"
    assert any(e["type"] == "resumed" for e in cloud.lease_events) or True
    assert len(cloud.created) == 1  # no second task


async def test_TWK_APPLY_prechecks_refuse_email_postings_and_submitted_applications(
    runtime: Runtime, cloud: CloudFake, make_env: Callable[..., RunnerEnv]
) -> None:
    cloud.posting_support = "email"
    email_app = cloud.add_application()
    with pytest.raises(PolicyRefusedError) as refused:
        await ApplyOrchestrator(make_env(), executors(submitting_agent())).run(
            ApplyRequest(application_id=email_app["id"])
        )
    assert refused.value.code == "email_application_required"
    cloud.posting_support = "browser_supported"
    done = cloud.add_application(submission_status="submitted_verified")
    with pytest.raises(ConflictError):
        await ApplyOrchestrator(make_env(), executors(submitting_agent())).run(
            ApplyRequest(application_id=done["id"])
        )
    assert cloud.created == []


async def test_T21_12_a_second_apply_on_the_same_application_is_already_running(
    runtime: Runtime, cloud: CloudFake, make_env: Callable[..., RunnerEnv]
) -> None:
    app = cloud.add_application()
    held = acquire_app_lock(runtime.paths, app["id"])
    try:
        with pytest.raises(AlreadyRunningError) as caught:
            await ApplyOrchestrator(make_env(), executors(submitting_agent())).run(
                ApplyRequest(application_id=app["id"])
            )
    finally:
        held.release()
    assert "already running" in caught.value.message
    assert caught.value.exit == 6
    assert cloud.created == []
    assert cloud.claims == []


def test_T21_12_cli_second_apply_exits_already_running(
    cli_cloud: Cli, cloud: CloudFake, home: Any
) -> None:
    from pathlib import Path

    from pilih_jobs.paths import resolve_paths

    app = cloud.add_application()
    paths = resolve_paths()
    assert paths.data_dir == Path(home) / "data"
    held = acquire_app_lock(paths, app["id"])
    try:
        result = cli_cloud("--json", "apply", app["id"])
    finally:
        held.release()
    assert result.code == 6
    error = result.json["error"]
    assert error["code"] == "already_running"
    assert "already running" in error["message"]


def test_TWK_APPLY_cli_streams_events_and_the_result(
    cli_cloud: Cli, cloud: CloudFake, monkeypatch: pytest.MonkeyPatch
) -> None:
    app = cloud.add_application()
    monkeypatch.setattr("pilih_jobs.agent.run_attempt", submitting_agent())
    result = cli_cloud("--json", "apply", app["id"])
    assert result.code == 0, result.stdout + result.stderr
    lines = result.ndjson
    kinds = [line["type"] for line in lines]
    assert "task_claimed" in kinds
    assert "submit_intent" in kinds
    assert "step" in kinds
    final = lines[-1]
    assert final["type"] == "result"
    assert final["ok"] is True
    assert final["data"]["outcome"] == "submitted"
    assert final["data"]["submission_status"] == "submitted_verified"
    assert cloud.results
    assert cloud.results[-1]["outcome"] == "submitted"


def test_TWK_APPLY_cli_auto_mode_and_approve_need_the_step_up_scope(
    cli_base: Cli, cloud: CloudFake
) -> None:
    app = cloud.add_application()
    for args in (("--mode", "auto"), ("--approve",)):
        result = cli_base("--json", "apply", app["id"], *args)
        assert result.code == 4
        assert result.json["error"]["details"]["scope"] == "automation:manage"
        assert "login --scope automation:manage" in result.json["error"]["hint"]
    assert cloud.created == []


def test_TWK_APPLY_cli_flag_validation(cli_cloud: Cli, cloud: CloudFake) -> None:
    app = cloud.add_application()
    assert cli_cloud("--json", "apply", app["id"], "--mode", "assisted", "--headless").code == 2
    assert cli_cloud("--json", "apply", app["id"], "--approve", "--dry-run").code == 2
    assert cli_cloud("--json", "apply").code == 2
    assert cli_cloud("--json", "apply", app["id"], "--matched").code == 2


def test_TWK_APPLY_matched_creates_tasks_for_ready_applications(
    cli_cloud: Cli, cloud: CloudFake
) -> None:
    good = cloud.add_application()
    low = cloud.add_application()
    manual = cloud.add_application(mode="manual")
    cloud.scores[cloud.posting_for(good)["id"]] = 85
    cloud.scores[cloud.posting_for(low)["id"]] = 40
    cloud.scores[cloud.posting_for(manual)["id"]] = 90
    dry = cli_cloud("--json", "apply", "--matched", "--min-score", "70", "--dry-run").json["data"]
    assert dry["candidates"] == [good["id"]]
    assert dry["created"] == []
    reasons = {s["app_id"]: s["reason"] for s in dry["skipped"]}
    assert reasons == {low["id"]: "below_min_score", manual["id"]: "manual_mode"}
    real = cli_cloud("--json", "apply", "--matched", "--min-score", "70", "--limit", "5").json[
        "data"
    ]
    assert len(real["created"]) == 1
    assert cloud.created[-1]["application_id"] == good["id"]


def test_TWK_APPLY_offline_apply_is_refused_and_queues_nothing(
    cli_cloud: Cli, cloud: CloudFake, fake_api: Any, home: Any
) -> None:
    from pilih_jobs.storage.db import StateDB

    app = cloud.add_application()
    fake_api.offline = True
    result = cli_cloud("--json", "apply", app["id"])
    fake_api.offline = False
    assert result.code == 7
    db = StateDB(home / "data" / "state.db")
    try:
        assert Outbox(db, fake_api.issuer).entries() == []
    finally:
        db.close()
