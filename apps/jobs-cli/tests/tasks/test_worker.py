"""TWK-DISCOVER-TASK, TWK-RENDER and the worker loop: `discover` tasks run
`run_discovery` with the claim context, `render_cv` tasks run `render_cv_page` with the
render ticket from the claim context (PLAN C8), the worker claims, runs and stops."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any

import pytest

from pilih_jobs.api.client import ApiClient
from pilih_jobs.auth.store import AccountMeta
from pilih_jobs.discovery import DiscoveryOptions, DiscoveryRunResult, DiscoveryRuntime
from pilih_jobs.errors import UpgradeRequiredError
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.cache import EntityCache
from pilih_jobs.tasks.poll import PollPolicy
from pilih_jobs.tasks.runner import RunnerEnv, TaskRunner
from pilih_jobs.tasks.scheduler import is_due, last_run, parse_schedule
from pilih_jobs.tasks.worker import Worker, WorkerOptions
from tests.support.fake_api import FakeApi, record_example
from tests.tasks.fakes import CloudFake
from tests.tasks.fixtures import Recorder, claim_grant, executors, flush

RUN_ID = "run_01JA6V8M3W8Z1T6Q4Y2B7K9C00"
FILE_ID = "fil_01JA6V8M3W8Z1T6Q4Y2B7K9C09"


class FakeDiscovery:
    def __init__(
        self, status: str = "completed", errors: list[dict[str, Any]] | None = None
    ) -> None:
        self.calls: list[DiscoveryOptions] = []
        self.runtimes: list[DiscoveryRuntime] = []
        self.status = status
        self.errors = errors or []
        self.on_start: Callable[[], Any] | None = None

    async def __call__(
        self, options: DiscoveryOptions, ctx: DiscoveryRuntime
    ) -> DiscoveryRunResult:
        self.calls.append(options)
        self.runtimes.append(ctx)
        ctx.emit({"type": "source_started", "message": "greenhouse:acme"})
        if self.on_start is not None:
            await self.on_start()
        for _ in range(50):
            if ctx.cancel.is_set():
                return DiscoveryRunResult(RUN_ID, "cancelled")
            await asyncio.sleep(0)
        return DiscoveryRunResult(RUN_ID, self.status, {"seen": 3}, self.errors)


class FakeRender:
    def __init__(self, result: dict[str, Any] | Exception) -> None:
        self.result = result
        self.urls: list[str] = []

    async def __call__(self, url: str, timeout_s: float) -> dict[str, Any]:
        self.urls.append(url)
        assert timeout_s == 60.0
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


async def test_TWK_DISCOVER_TASK_runs_discovery_with_the_context_sources(
    runtime: Runtime,
    api: ApiClient,
    account: AccountMeta,
    cloud: CloudFake,
    make_env: Callable[..., RunnerEnv],
) -> None:
    context = cloud.discover_context(2)
    task = cloud.queue_task("discover", payload={"check_tracked": True}, context=context)
    grant = await claim_grant(api, account, ["discover"])
    discovery = FakeDiscovery()
    outcome = await TaskRunner(make_env(), executors(run_discovery=discovery)).execute(grant)
    assert outcome.outcome == "succeeded"
    assert outcome.run_id == RUN_ID
    options = discovery.calls[0]
    assert options.sources == [s["id"] for s in context["sources"]]
    assert options.check_tracked is True
    assert options.task_id == task["id"]
    assert options.source_records == context["sources"]
    assert options.dry_run is False
    ctx = discovery.runtimes[0]
    assert ctx.api is not None
    assert ctx.outbox.issuer == runtime.issuer
    assert ctx.runtime is runtime
    await flush(runtime, api)
    result = cloud.results[-1]
    assert result["task_id"] == task["id"]
    assert result["outcome"] == "succeeded"
    assert result["run_id"] == RUN_ID
    progress = [e for e in cloud.lease_events if e["type"] == "progress"]
    assert progress
    assert progress[0]["progress"]["stage"] == "discovering"


async def test_TWK_DISCOVER_TASK_urls_payload_and_cancellation(
    runtime: Runtime,
    api: ApiClient,
    account: AccountMeta,
    cloud: CloudFake,
    make_env: Callable[..., RunnerEnv],
) -> None:
    task = cloud.queue_task(
        "discover",
        payload={"urls": ["https://acme.com/careers"]},
        context={"kind": "discover", "sources": []},
    )
    grant = await claim_grant(api, account, ["discover"])
    runner = TaskRunner(make_env(), executors(run_discovery=(discovery := FakeDiscovery())))

    async def cancel_from_web() -> None:
        cloud.cancel(task["id"])
        assert runner.channel is not None
        await runner.channel.heartbeat_once()

    discovery.on_start = cancel_from_web
    outcome = await runner.execute(grant)
    assert discovery.calls[0].url == "https://acme.com/careers"
    assert outcome.outcome == "cancelled"
    assert outcome.reason == "cancel_requested"
    await flush(runtime, api)
    assert cloud.results[-1]["outcome"] == "cancelled"


async def test_TWK_DISCOVER_TASK_failures_map_to_task_error_classes(
    runtime: Runtime,
    api: ApiClient,
    account: AccountMeta,
    cloud: CloudFake,
    make_env: Callable[..., RunnerEnv],
) -> None:
    cloud.queue_task("discover", context=cloud.discover_context())
    grant = await claim_grant(api, account, ["discover"])
    discovery = FakeDiscovery("failed", [{"class": "rate_limited", "message": "429"}])
    outcome = await TaskRunner(make_env(), executors(run_discovery=discovery)).execute(grant)
    assert outcome.outcome == "failed"
    assert outcome.error_class == "upstream_unavailable"
    await flush(runtime, api)
    assert cloud.results[-1]["retryable"] is True


async def test_TWK_RENDER_uses_the_render_ticket_from_the_claim_context(
    runtime: Runtime,
    api: ApiClient,
    account: AccountMeta,
    cloud: CloudFake,
    make_env: Callable[..., RunnerEnv],
) -> None:
    variant = cloud.add_cv_variant(None, status="generating", with_file=False)
    context = cloud.render_context(variant["id"])
    cloud.queue_task("render_cv", cv_variant_id=variant["id"], context=context)
    grant = await claim_grant(api, account, ["render_cv"])
    render = FakeRender({"status": "done", "file_id": FILE_ID, "sha256": "0" * 64})
    outcome = await TaskRunner(make_env(), executors(render_cv_page=render)).execute(grant)
    assert render.urls == [context["render"]["url"]]
    assert cloud.render_tickets == []  # no second ticket: the claim's was fresh
    assert outcome.outcome == "succeeded"
    assert outcome.file_id == FILE_ID
    await flush(runtime, api)
    assert cloud.results[-1]["file_id"] == FILE_ID
    assert cloud.results[-1]["outcome"] == "succeeded"


async def test_TWK_RENDER_refreshes_an_expired_ticket(
    runtime: Runtime,
    api: ApiClient,
    account: AccountMeta,
    cloud: CloudFake,
    make_env: Callable[..., RunnerEnv],
) -> None:
    variant = cloud.add_cv_variant(None, status="generating", with_file=False)
    cloud.queue_task(
        "render_cv",
        cv_variant_id=variant["id"],
        context=cloud.render_context(variant["id"], expires_in=5),
    )
    grant = await claim_grant(api, account, ["render_cv"])
    render = FakeRender({"status": "done", "file_id": FILE_ID, "sha256": "0" * 64})
    await TaskRunner(make_env(), executors(render_cv_page=render)).execute(grant)
    assert len(cloud.render_tickets) == 1
    assert cloud.render_tickets[0] in render.urls[0]


@pytest.mark.parametrize(
    "result",
    [{"status": "error", "message": "font missing"}, TimeoutError()],
    ids=["page-error", "timeout"],
)
async def test_TWK_RENDER_errors_report_render_failed(
    runtime: Runtime,
    api: ApiClient,
    account: AccountMeta,
    cloud: CloudFake,
    make_env: Callable[..., RunnerEnv],
    result: dict[str, Any] | Exception,
) -> None:
    variant = cloud.add_cv_variant(None, status="generating", with_file=False)
    cloud.queue_task(
        "render_cv", cv_variant_id=variant["id"], context=cloud.render_context(variant["id"])
    )
    grant = await claim_grant(api, account, ["render_cv"])
    outcome = await TaskRunner(make_env(), executors(render_cv_page=FakeRender(result))).execute(
        grant
    )
    assert outcome.outcome == "failed"
    assert outcome.error_class == "render_failed"
    await flush(runtime, api)
    assert cloud.results[-1]["error_class"] == "render_failed"
    assert cloud.results[-1]["retryable"] is False


async def test_TWK_RENDER_worker_runs_render_and_discover_in_parallel_slots(
    runtime: Runtime, account: AccountMeta, cloud: CloudFake
) -> None:
    variant = cloud.add_cv_variant(None, status="generating", with_file=False)
    cloud.queue_task(
        "render_cv", cv_variant_id=variant["id"], context=cloud.render_context(variant["id"])
    )
    cloud.queue_task("discover", context=cloud.discover_context())
    recorder = Recorder()
    worker = Worker(
        runtime,
        WorkerOptions(
            capabilities=["discover", "render_cv"], ipc=False, scheduler=False, max_tasks=2
        ),
        emit=recorder,
        executors=executors(
            run_discovery=FakeDiscovery(),
            render_cv_page=FakeRender({"status": "done", "file_id": FILE_ID, "sha256": "0" * 64}),
        ),
        policy=PollPolicy(rng=lambda: 0.5),
        sleep_scale=0.001,
    )
    assert await asyncio.wait_for(worker.run(), 20) == 0
    assert worker.completed == 2
    assert {o["kind"] for o in worker.outcomes} == {"render_cv", "discover"}
    assert {o["outcome"] for o in worker.outcomes} == {"succeeded"}
    assert "worker_started" in recorder.kinds()
    assert "worker_stopped" in recorder.kinds()
    beat = cloud.device_beats[0]
    assert beat["cli_version"]
    assert beat["browser"]["mode"] == "managed"
    assert sorted(beat["capabilities"]) == ["discover", "render_cv"]
    assert {r["outcome"] for r in cloud.results} == {"succeeded"}  # flushed by the SyncLoop


async def test_TWK_POLL_worker_stops_claiming_when_an_upgrade_is_required(
    runtime: Runtime, account: AccountMeta, cloud: CloudFake, fake_api: FakeApi
) -> None:
    cloud.queue_task("discover", context=cloud.discover_context())
    fake_api.min_cli_version = "99.0.0"
    worker = Worker(
        runtime,
        WorkerOptions(capabilities=["discover"], ipc=False, scheduler=False),
        executors=executors(run_discovery=FakeDiscovery()),
        sleep_scale=0.001,
    )
    with pytest.raises(UpgradeRequiredError):
        await asyncio.wait_for(worker.run(), 20)
    assert worker.completed == 0
    assert worker.upgrade_required


async def test_TWK_DISCOVER_TASK_scheduler_runs_due_sources_locally(
    runtime: Runtime, account: AccountMeta, cloud: CloudFake
) -> None:
    cache = EntityCache(runtime.db, runtime.issuer)
    due = record_example("job_sources")
    due.update(id="src_01JA6V8M3W8Z1T6Q4Y2B7K9C01", enabled=True, schedule="hourly")
    off = record_example("job_sources")
    off.update(id="src_01JA6V8M3W8Z1T6Q4Y2B7K9C02", enabled=False, schedule="hourly")
    cache.put("source", due)
    cache.put("source", off)
    discovery = FakeDiscovery()
    worker = Worker(
        runtime,
        WorkerOptions(capabilities=["discover"]),
        executors=executors(run_discovery=discovery),
    )
    worker.capabilities = worker.detect_capabilities()
    api = runtime.authenticated_client()
    try:
        worker.env = RunnerEnv(
            db=runtime.db,
            issuer=runtime.issuer,
            paths=runtime.paths,
            config=runtime.config,
            api=api,
            device_id=str(account.device_id),
        )
        assert await worker.scheduler_once() == [due["id"]]
        assert worker.discover.task is not None
        await worker.discover.task
        assert discovery.calls[0].sources == [due["id"]]
        assert last_run(runtime.db, due["id"]) is not None
        assert await worker.scheduler_once() == []  # not due again within the hour
    finally:
        await api.aclose()


def test_TWK_DISCOVER_TASK_schedule_hints() -> None:
    daily = parse_schedule("daily@08:00")
    assert daily is not None
    assert (daily.hour, daily.minute) == (8, 0)
    assert parse_schedule("weekly@mon@07:30") is not None
    every = parse_schedule("every@6h")
    assert every is not None
    assert every.every_ms == 6 * 3_600_000
    assert parse_schedule("every@1m").every_ms == 15 * 60_000  # type: ignore[union-attr]
    assert parse_schedule("cron */5") is None
    assert is_due(every, None, 0)
    assert not is_due(every, 1_000, 1_000 + 3_600_000)
    assert is_due(every, 1_000, 1_000 + 6 * 3_600_000)
