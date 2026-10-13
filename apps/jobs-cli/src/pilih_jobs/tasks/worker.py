"""The local task worker (16 §7, 21): one asyncio loop, one worker per device.

```text
asyncio main loop (single thread)
├── HeartbeatLoop   lease heartbeats per active task (ApiLeaseChannel) + device heartbeat / 60 s
├── PollLoop        claim when a slot is free; adaptive interval with ±20 % jitter (PollPolicy)
├── SyncLoop        flush the outbox every 10 s or on enqueue; pull changes every 60 s
├── TaskRunner      one browser task (apply / render_cv) at a time + one discover in parallel
└── Scheduler       local `schedule` hints of sources → discovery runs
```

- `worker.lock` keeps one worker per device; the owner record names the IPC endpoint so an
  interactive `apply` hands its task to the worker instead of driving a second browser.
- Backpressure: no claim while the outbox holds more than 500 unsynced writes or the last
  3 syncs failed (the heartbeat still reports `local_state`).
- Crash recovery runs before the first claim (`recovery.recover`).
- `426` / a heartbeat `min_cli_version` above this CLI: stop claiming, finish, exit 10.
- First Ctrl+C / SIGTERM: stop claiming; running tasks stop before `submit_intent` and are
  released (`shutdown`); after the intent they finish verification. Second Ctrl+C aborts.
"""

from __future__ import annotations

import asyncio
import contextlib
import dataclasses
import json
import os
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any, Final, cast

from pilih_jobs.agent.options import AttemptOptions
from pilih_jobs.api.client import ApiClient
from pilih_jobs.api.errors import (
    ApiError,
    ApiPermissionError,
    ApiUnavailableError,
    NetworkError,
)
from pilih_jobs.contracts import ids
from pilih_jobs.environment import device_capabilities, has_display
from pilih_jobs.errors import (
    ExitCode,
    NotAuthenticatedError,
    PermissionDeniedError,
    PilihError,
    UpgradeRequiredError,
)
from pilih_jobs.logging import get_logger, log_event
from pilih_jobs.runtime import Runtime
from pilih_jobs.storage.locks import FileLock
from pilih_jobs.sync.cache import EntityCache
from pilih_jobs.sync.outbox import Outbox
from pilih_jobs.tasks.apply import ApplyOrchestrator, ApplyRequest
from pilih_jobs.tasks.constants import (
    BACKPRESSURE_OUTBOX_DEPTH,
    BACKPRESSURE_SYNC_FAILURES,
    DEVICE_HEARTBEAT_S,
)
from pilih_jobs.tasks.device import heartbeat_body, send_device_heartbeat
from pilih_jobs.tasks.errors import AlreadyRunningError
from pilih_jobs.tasks.ipc import IpcServer
from pilih_jobs.tasks.lease import Emit, LeaseGrant
from pilih_jobs.tasks.locks import acquire_app_lock, acquire_worker_lock
from pilih_jobs.tasks.poll import PollPolicy, claim
from pilih_jobs.tasks.recovery import recover, release_lease
from pilih_jobs.tasks.runner import (
    ExecutionOptions,
    ExecutionOutcome,
    Executors,
    Interrupts,
    RunnerEnv,
    TaskRunner,
)
from pilih_jobs.tasks.scheduler import due_sources, mark_run
from pilih_jobs.tasks.syncloop import SyncLoop
from pilih_jobs.version import __version__

_log = get_logger("tasks.worker")

BROWSER_KINDS: Final = ("apply", "render_cv")
SCHEDULER_INTERVAL_S: Final = 60.0


def _silent(_kind: str, _fields: dict[str, Any]) -> None:
    return None


@dataclass
class WorkerOptions:
    kinds: list[str] = field(default_factory=lambda: ["apply", "discover", "render_cv"])
    headed: bool | None = None
    ipc: bool = True
    scheduler: bool = True
    #: Stop after this many executed tasks (tests, `--once`).
    max_tasks: int | None = None
    #: Capabilities override (tests); default: detected on this machine (21 §3).
    capabilities: list[str] | None = None
    #: Agent knobs for every apply attempt (`AttemptOptions`; the unattended worker has no
    #: terminal hooks). None = the agent's defaults from the local config.
    attempt: AttemptOptions | None = None


@dataclass
class Slot:
    name: str
    task: asyncio.Task[Any] | None = None
    grant: LeaseGrant | None = None

    @property
    def busy(self) -> bool:
        return self.task is not None and not self.task.done()


class Worker:
    def __init__(
        self,
        rt: Runtime,
        options: WorkerOptions | None = None,
        *,
        emit: Emit | None = None,
        executors: Executors | None = None,
        api: ApiClient | None = None,
        heartbeat_api: ApiClient | None = None,
        policy: PollPolicy | None = None,
        sleep_scale: float = 1.0,
    ) -> None:
        self.rt = rt
        self.options = options or WorkerOptions()
        self._emit_out: Emit = emit or _silent
        self.executors = executors or Executors()
        self._api = api
        self._heartbeat_api = heartbeat_api
        self.policy = policy or PollPolicy()
        self.sleep_scale = sleep_scale
        self.stop_event = asyncio.Event()
        self.interrupts = Interrupts()
        self.browser = Slot("browser")
        self.discover = Slot("discover")
        self.runners: dict[str, TaskRunner] = {}
        self.completed = 0
        self.outcomes: list[dict[str, Any]] = []
        self.last_poll_at: int | None = None
        self.last_claim_at: int | None = None
        self.next_poll_ms: int | None = None
        self.upgrade_required = False
        self.fatal: PilihError | None = None
        self.started_at = ids.now_ms()
        self.device_id: str | None = None
        self.capabilities: list[str] = []
        self.env: RunnerEnv | None = None
        self.sync: SyncLoop | None = None
        self.ipc: IpcServer | None = None
        self._wake = asyncio.Event()
        self._listeners: list[Emit] = []

    # ------------------------------------------------------------------ events
    def emit(self, kind: str, fields: dict[str, Any]) -> None:
        self._emit_out(kind, fields)
        for listener in list(self._listeners):
            listener(kind, fields)

    def request_stop(self) -> None:
        self.interrupts.shutdown = True
        self.interrupts.graceful.set()
        self.stop_event.set()
        self._wake.set()

    # ------------------------------------------------------------------ capabilities
    def detect_capabilities(self) -> list[str]:
        caps = self.options.capabilities
        if caps is None:
            caps = device_capabilities(self.rt.config.browser.channel)
        kinds = set(self.options.kinds) & set(self.rt.config.worker.kinds)
        out = [c for c in caps if c in kinds]
        if "headed_browser" in caps and "apply" in out and self.options.headed is not False:
            out.append("headed_browser")
        return out

    def claim_capabilities(self) -> list[str]:
        caps = list(self.capabilities)
        if self.browser.busy:
            caps = [c for c in caps if c not in (*BROWSER_KINDS, "headed_browser")]
        if self.discover.busy:
            caps = [c for c in caps if c != "discover"]
        return caps if any(c in ("apply", "discover", "render_cv") for c in caps) else []

    def backpressure(self) -> str | None:
        depth = Outbox(self.rt.db, self.rt.issuer).depth()
        if depth > BACKPRESSURE_OUTBOX_DEPTH:
            return f"outbox depth {depth} > {BACKPRESSURE_OUTBOX_DEPTH}"
        if self.sync is not None and self.sync.consecutive_failures >= BACKPRESSURE_SYNC_FAILURES:
            return f"{self.sync.consecutive_failures} failed syncs in a row"
        return None

    def can_claim(self) -> bool:
        if self.stop_event.is_set() or self.upgrade_required or self.fatal is not None:
            return False
        if self.options.max_tasks is not None and self.completed + self._running() >= (
            self.options.max_tasks
        ):
            return False
        return self.backpressure() is None

    def _running(self) -> int:
        return int(self.browser.busy) + int(self.discover.busy)

    # ------------------------------------------------------------------ status
    def status(self) -> dict[str, Any]:
        leases = [
            {
                "task_id": slot.grant.task_id,
                "kind": slot.grant.kind,
                "lease_id": slot.grant.lease_id,
                "application_id": slot.grant.application_id,
            }
            for slot in (self.browser, self.discover)
            if slot.busy and slot.grant is not None
        ]
        return {
            "running": True,
            "pid": os.getpid(),
            "started_at": self.started_at,
            "device_id": self.device_id,
            "kinds": self.options.kinds,
            "capabilities": self.capabilities,
            "leases": leases,
            "last_poll_at": self.last_poll_at,
            "last_claim_at": self.last_claim_at,
            "poll_interval_ms": self.next_poll_ms,
            "backpressure": self.backpressure(),
            "upgrade_required": self.upgrade_required,
            "completed": self.completed,
            "recent_outcomes": self.outcomes[-10:],
            "outbox_depth": Outbox(self.rt.db, self.rt.issuer).depth(),
            "sync_failures": self.sync.consecutive_failures if self.sync else 0,
        }

    # ------------------------------------------------------------------ run
    async def run(self, interrupts: Interrupts | None = None) -> int:
        if interrupts is not None:
            self.interrupts = interrupts
        account = self.rt.account()
        if account is None:
            raise NotAuthenticatedError()
        if not account.device_id:
            raise PermissionDeniedError(
                "This login has no device; run `pilih-jobs login` again.", code="device_required"
            )
        self.device_id = account.device_id
        owner = {"pid": os.getpid(), "started_at": self.started_at, "version": __version__}
        lock = acquire_worker_lock(self.rt.paths, owner)
        api = self._api or self.rt.authenticated_client(allow_personal_token=False)
        hb_api = self._heartbeat_api or self.rt.authenticated_client(allow_personal_token=False)
        try:
            return await self._run(api, hb_api, lock_owner=owner, lock=lock)
        finally:
            if self.ipc is not None:
                self.ipc.close()
            if self._api is None:
                await api.aclose()
            if self._heartbeat_api is None:
                await hb_api.aclose()
            lock.release()

    async def _run(
        self, api: ApiClient, hb_api: ApiClient, *, lock_owner: dict[str, Any], lock: FileLock
    ) -> int:
        rt = self.rt
        self.capabilities = self.detect_capabilities()
        self.sync = SyncLoop(rt.db, rt.issuer, api, paths=rt.paths, state_lock=rt.state_lock)
        self.env = RunnerEnv(
            db=rt.db,
            issuer=rt.issuer,
            paths=rt.paths,
            config=rt.config,
            api=api,
            heartbeat_api=hb_api,
            device_id=cast(str, self.device_id),
            clock=rt.clock,
            runtime=rt,
            kick=self.sync.kick,
            emit=self.emit,
            on_poll_interval=self.policy.observe_server,
            has_display=has_display() and self.options.headed is not False,
        )
        if self.options.ipc:
            self.ipc = IpcServer(rt.paths, self.handle_ipc)
            self.ipc.start()
            lock.write_owner(json.dumps({**lock_owner, "ipc": self.ipc.describe()}))
        self.emit(
            "worker_started",
            {"device_id": self.device_id, "capabilities": self.capabilities, "pid": os.getpid()},
        )
        report = await recover(rt.db, rt.issuer, api, paths=rt.paths)
        if any(report.as_dict().values()):
            self.emit("recovered", report.as_dict())
        loops = [
            asyncio.create_task(self.sync.run(self.stop_event), name="sync-loop"),
            asyncio.create_task(self._device_loop(hb_api), name="device-heartbeat"),
            asyncio.create_task(self._poll_loop(api), name="poll-loop"),
        ]
        if self.options.scheduler:
            loops.append(asyncio.create_task(self._scheduler_loop(), name="scheduler"))
        stop_waiter = asyncio.ensure_future(self.stop_event.wait())
        graceful_waiter = asyncio.ensure_future(self.interrupts.graceful.wait())
        await asyncio.wait({stop_waiter, graceful_waiter}, return_when=asyncio.FIRST_COMPLETED)
        stop_waiter.cancel()
        graceful_waiter.cancel()
        self.interrupts.shutdown = True
        self.stop_event.set()
        self._wake.set()
        self.emit("worker_stopping", {"running": self._running()})
        await self._drain()
        for job in loops:
            if job.get_name() != "sync-loop":
                job.cancel()
        for job in loops:
            with contextlib.suppress(asyncio.CancelledError):
                await job
        self.emit("worker_stopped", {"completed": self.completed})
        if self.fatal is not None:
            raise self.fatal
        if self.upgrade_required:
            raise UpgradeRequiredError(
                "This pilih-jobs version is below the server minimum; the worker stopped.",
                hint="pilih-jobs update",
            )
        return int(ExitCode.INTERRUPTED) if self.interrupts.abort.is_set() else 0

    async def _drain(self) -> None:
        jobs = [s.task for s in (self.browser, self.discover) if s.task is not None]
        if jobs:
            await asyncio.gather(*jobs, return_exceptions=True)

    # ------------------------------------------------------------------ loops
    async def _sleep(self, seconds: float) -> None:
        self._wake.clear()
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(self._wake.wait(), timeout=max(0.0, seconds * self.sleep_scale))

    async def _poll_loop(self, api: ApiClient) -> None:
        while not self.stop_event.is_set():
            if self.upgrade_required and self._running() == 0:
                self.request_stop()
                return
            if self.can_claim():
                try:
                    await self.poll_once(api)
                except PilihError as exc:  # never let one poll end the loop
                    log_event(_log, "poll_failed", "poll failed", level=30, error=str(exc))
            elif (
                self.options.max_tasks is not None
                and self.completed >= self.options.max_tasks
                and self._running() == 0
            ):
                self.request_stop()
                return
            delay = self.policy.next_delay_ms()
            self.next_poll_ms = delay
            await self._sleep(delay / 1000)

    async def poll_once(self, api: ApiClient) -> LeaseGrant | None:
        caps = self.claim_capabilities()
        if not caps or self.device_id is None:
            return None
        self.last_poll_at = ids.now_ms()
        try:
            outcome = await claim(api, self.device_id, caps, now_ms=self.rt.clock.now_ms)
        except UpgradeRequiredError:
            self.upgrade_required = True
            self.emit("warning", {"message": "Upgrade required: the worker stops claiming."})
            if self._running() == 0:
                self.request_stop()
            return None
        except ApiPermissionError as exc:
            self.emit("warning", {"message": f"Not claiming: {exc.message}", "code": exc.error})
            if exc.error == "device_revoked":
                self.fatal = exc
                self.request_stop()
            return None
        except ApiUnavailableError as exc:
            self.policy.observe_retry_after(exc.retry_after)
            return None
        except (NetworkError, ApiError) as exc:
            log_event(_log, "claim_failed", "claim failed", level=30, error=str(exc))
            return None
        except NotAuthenticatedError as exc:
            self.fatal = exc
            self.request_stop()
            return None
        self.policy.observe_server(outcome.poll_interval_ms)
        self.policy.observe_retry_after(outcome.retry_after)
        grant = outcome.grant
        if grant is None:
            return None
        self.policy.work_claimed()
        self.last_claim_at = ids.now_ms()
        slot = self.discover if grant.kind == "discover" else self.browser
        if slot.busy:
            await release_lease(api, grant.task_id, grant.lease_id, "shutdown")
            return None
        slot.grant = grant
        slot.task = asyncio.create_task(self._execute(slot, grant), name=f"run-{grant.task_id}")
        return grant

    async def _execute(self, slot: Slot, grant: LeaseGrant) -> ExecutionOutcome | None:
        env = cast(RunnerEnv, self.env)
        lock = None
        try:
            if grant.kind == "apply" and grant.application_id:
                try:
                    lock = acquire_app_lock(self.rt.paths, grant.application_id)
                except AlreadyRunningError:
                    await release_lease(env.api, grant.task_id, grant.lease_id, "shutdown")
                    self.emit("warning", {"message": f"{grant.application_id} is busy locally."})
                    return None
            runner = TaskRunner(env, self.executors)
            self.runners[grant.task_id] = runner
            outcome = await runner.execute(
                grant,
                ExecutionOptions(
                    interactive=False,
                    headed=self.options.headed,
                    on_interrupt="release",
                    dry_run=bool(
                        cast(dict[str, Any], grant.task.get("payload") or {}).get("dry_run")
                    ),
                    attempt=self.options.attempt,
                ),
                self.interrupts,
            )
        except Exception as exc:  # noqa: BLE001 - one task never takes the worker down
            log_event(_log, "task_crashed", "task execution crashed", level=40, error=repr(exc))
            self.emit("warning", {"message": f"Task {grant.task_id} crashed: {exc!r}"})
            return None
        else:
            self.outcomes.append(outcome.as_dict())
            return outcome
        finally:
            if lock is not None:
                lock.release()
            self.runners.pop(grant.task_id, None)
            self.completed += 1
            slot.grant = None
            self._wake.set()

    async def _device_loop(self, api: ApiClient) -> None:
        while not self.stop_event.is_set():
            await self.device_heartbeat_once(api)
            await self._sleep(DEVICE_HEARTBEAT_S)

    async def device_heartbeat_once(self, api: ApiClient) -> None:
        if self.device_id is None:
            return
        body = heartbeat_body(
            self.rt.db,
            self.rt.issuer,
            self.rt.config,
            capabilities=self.capabilities,
            browser_busy=self.browser.busy,
            last_sync_at=self.sync.last_success_at if self.sync else None,
        )
        try:
            beat = await send_device_heartbeat(api, self.device_id, body)
        except UpgradeRequiredError:
            self.upgrade_required = True
            return
        except (ApiError, NetworkError) as exc:
            log_event(_log, "device_heartbeat_failed", "device heartbeat failed", error=str(exc))
            return
        except NotAuthenticatedError as exc:
            self.fatal = exc
            self.request_stop()
            return
        self.rt.clock.observe(beat.server_time)
        self.policy.observe_server(beat.poll_interval_ms)
        if beat.upgrade_required:
            self.upgrade_required = True
        for runner in self.runners.values():
            channel = runner.channel
            if channel is not None and channel.lease_id in beat.cancel_lease_ids:
                channel.server_cancel = True
                channel.cancel_requested.set()

    async def _scheduler_loop(self) -> None:
        while not self.stop_event.is_set():
            await self.scheduler_once()
            await self._sleep(SCHEDULER_INTERVAL_S)

    async def scheduler_once(self) -> list[str]:
        """Run due scheduled sources locally when the discover slot is free."""
        if "discover" not in self.capabilities or self.discover.busy or self.stop_event.is_set():
            return []
        sources = EntityCache(self.rt.db, self.rt.issuer).list("source")
        due = due_sources(self.rt.db, sources, ids.now_ms())
        if not due:
            return []
        self.discover.task = asyncio.create_task(self._scheduled_discovery(due))
        return due

    async def _scheduled_discovery(self, source_ids: list[str]) -> None:
        from pilih_jobs.discovery import DiscoveryOptions, DiscoveryRuntime

        env = cast(RunnerEnv, self.env)
        cancel = asyncio.Event()
        watcher = asyncio.create_task(self._link(cancel))
        now = ids.now_ms()
        try:
            for source_id in source_ids:
                mark_run(self.rt.db, source_id, now)
            self.emit("scheduled_discovery", {"sources": source_ids})
            result = await self.executors.run_discovery(
                DiscoveryOptions(sources=source_ids),
                DiscoveryRuntime(
                    outbox=env.outbox,
                    api=env.api,
                    emit=lambda event: self.emit(str(event.get("type") or "log"), event),
                    cancel=cancel,
                    runtime=self.rt,
                ),
            )
            self.emit("discovery_finished", {"run_id": result.run_id, "status": result.status})
        except Exception as exc:  # noqa: BLE001 - a failed scheduled run never stops the worker
            log_event(_log, "scheduled_discovery_failed", "scheduled run failed", error=repr(exc))
        finally:
            watcher.cancel()
            env.kick()

    async def _link(self, cancel: asyncio.Event) -> None:
        await self.interrupts.graceful.wait()
        cancel.set()

    # ------------------------------------------------------------------ IPC
    async def handle_ipc(self, request: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
        op = request.get("op")
        if op == "ping":
            yield {"type": "result", "ok": True, "data": {"pid": os.getpid()}}
        elif op == "status":
            yield {"type": "result", "ok": True, "data": self.status()}
        elif op == "stop":
            self.request_stop()
            yield {"type": "result", "ok": True, "data": {"stopping": True}}
        elif op == "apply":
            async for frame in self._ipc_apply(request):
                yield frame
        else:
            yield {
                "type": "result",
                "ok": False,
                "error": {"code": "usage_error", "message": f"unknown op {op!r}"},
            }

    async def _ipc_apply(self, request: dict[str, Any]) -> AsyncIterator[dict[str, Any]]:
        try:
            apply_request = ApplyRequest.from_ipc(request)
        except PilihError as exc:
            yield {"type": "result", "ok": False, "error": exc.envelope_error()}
            return
        if self.browser.busy or self.stop_event.is_set():
            yield {
                "type": "result",
                "ok": False,
                "error": {
                    "code": "worker_busy",
                    "message": "The worker is busy with another browser task; try again later.",
                },
            }
            return
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()

        def forward(kind: str, fields: dict[str, Any]) -> None:
            self.emit(kind, fields)
            queue.put_nowait({"type": "event", "event": kind, "fields": fields})

        env = dataclasses.replace(cast(RunnerEnv, self.env), emit=forward)
        orchestrator = ApplyOrchestrator(env, self.executors, attempt=self.options.attempt)
        job = asyncio.create_task(orchestrator.run(apply_request, self.interrupts))
        self.browser.task = job
        try:
            while not job.done() or not queue.empty():
                getter = asyncio.ensure_future(queue.get())
                done, _ = await asyncio.wait({getter, job}, return_when=asyncio.FIRST_COMPLETED)
                if getter in done:
                    yield getter.result()
                else:
                    getter.cancel()
            try:
                outcome = job.result()
            except PilihError as exc:
                yield {"type": "result", "ok": False, "error": exc.envelope_error()}
                return
            yield {"type": "result", "ok": True, "data": outcome.as_dict()}
        finally:
            self._wake.set()
