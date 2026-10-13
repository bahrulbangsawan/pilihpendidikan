"""`TaskRunner`: executes one claimed task under its lease (21 §5–§8, 16 §6).

For every grant it:

1. records the task in `local_tasks` (`claimed`) and the attempt in the `runs` index;
2. starts the lease heartbeat and the monotonic watchdog (`ApiLeaseChannel`);
3. runs the executor for the task kind — `agent.run_attempt` (apply),
   `discovery.run_discovery` (discover) or `browser.headless.render_cv_page` (render_cv);
4. supervises it: a lost lease stops the executor at once (it gets `LOST_GRACE_S` to return
   the evidence it holds, then it is cancelled); the first Ctrl+C / SIGTERM stops it at the
   next step boundary **before** `submit_intent` and never after it; the second Ctrl+C
   aborts, writing a local `outcome_unknown` result first when an intent was acknowledged;
5. reports: a terminal result through the outbox (`lease_report`, idempotency key
   `result:<lease>`), a release (`needs_headed`, `awaiting_approval`, `user_quit`,
   `shutdown`) before `submit_intent`, or the late-evidence path after a lost lease.

Nothing is ever retried after `submit_intent`: such results carry `retryable: false`, and a
failure without negative evidence becomes `outcome_unknown` (D-19).
"""

from __future__ import annotations

import asyncio
import contextlib
import dataclasses
import gzip
import shutil
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any, Final, Literal, cast
from urllib.parse import urlsplit

from pilih_jobs.agent.options import AttemptOptions
from pilih_jobs.agent.types import AttemptContext, AttemptMode, AttemptResult
from pilih_jobs.api.client import ApiClient
from pilih_jobs.api.errors import ApiError, NetworkError
from pilih_jobs.clock import ClockSync
from pilih_jobs.config import Config
from pilih_jobs.contracts import ids
from pilih_jobs.cv.download import cleanup_staging
from pilih_jobs.errors import NotAuthenticatedError, PilihError
from pilih_jobs.logging import bind, get_logger, log_event
from pilih_jobs.paths import Paths, ensure_private_dir
from pilih_jobs.storage.db import StateDB
from pilih_jobs.sync.outbox import PRIORITY_RESULT, Outbox
from pilih_jobs.tasks.constants import HUMAN_PAUSE_REASONS, LOST_GRACE_S
from pilih_jobs.tasks.hooks import enqueue_late_evidence
from pilih_jobs.tasks.lease import (
    ApiLeaseChannel,
    Emit,
    LeaseGrant,
    lease_path,
    mono_ms,
    upload_file,
)
from pilih_jobs.tasks.local import LocalTaskStore, record_run_end, record_run_start

if TYPE_CHECKING:
    from pilih_jobs.discovery import DiscoveryOptions, DiscoveryRunResult, DiscoveryRuntime
    from pilih_jobs.runtime import Runtime

_log = get_logger("tasks.runner")

#: Discovery error classes (15 §8) → task error classes (21 §8) and retryability.
DISCOVERY_ERROR_MAP: Final[dict[str, tuple[str, bool]]] = {
    "network": ("network_offline", True),
    "timeout": ("navigation_timeout", True),
    "http_5xx": ("upstream_unavailable", True),
    "rate_limited": ("upstream_unavailable", True),
    "source_unavailable": ("upstream_unavailable", True),
    "access_denied": ("captcha_or_challenge", False),
    "challenge_detected": ("captcha_or_challenge", False),
    "robots_disallowed": ("policy_violation", False),
    "policy_blocked": ("policy_violation", False),
    "parse_error": ("page_changed", True),
    "schema_invalid": ("page_changed", True),
    "selector_drift": ("page_changed", True),
    "unsupported_content": ("unsupported_form", False),
    "not_found": ("posting_unavailable", False),
    "source_closed": ("posting_unavailable", False),
    "cancelled": ("cancelled", False),
}

Outcome = Literal[
    "submitted",
    "succeeded",
    "failed",
    "cancelled",
    "outcome_unknown",
    "paused",
    "released",
    "lost",
    "interrupted",
]


# ---------------------------------------------------------------------- executors
async def _default_run_attempt(ctx: AttemptContext) -> AttemptResult:
    from pilih_jobs import agent  # looked up at call time (leaf 4.3 implementation)

    return await agent.run_attempt(ctx)


async def _default_run_discovery(
    options: DiscoveryOptions, ctx: DiscoveryRuntime
) -> DiscoveryRunResult:
    from pilih_jobs import discovery  # leaf 4.2 implementation

    return await discovery.run_discovery(options, ctx=ctx)


async def _default_render(url: str, timeout_s: float) -> dict[str, Any]:
    from pilih_jobs.browser import headless  # leaf 4.3 implementation

    return await headless.render_cv_page(url, timeout_s=timeout_s)


@dataclass
class Executors:
    run_attempt: Callable[[AttemptContext], Awaitable[AttemptResult]] = _default_run_attempt
    run_discovery: Callable[[DiscoveryOptions, DiscoveryRuntime], Awaitable[DiscoveryRunResult]] = (
        _default_run_discovery
    )
    render_cv_page: Callable[[str, float], Awaitable[dict[str, Any]]] = _default_render


@dataclass
class RunnerEnv:
    db: StateDB
    issuer: str
    paths: Paths
    config: Config
    api: ApiClient
    device_id: str
    clock: ClockSync | None = None
    heartbeat_api: ApiClient | None = None
    runtime: Runtime | None = None
    kick: Callable[[], None] = lambda: None
    emit: Emit = lambda _kind, _fields: None
    monotonic: Callable[[], int] = mono_ms
    on_poll_interval: Callable[[int], None] | None = None
    has_display: bool = True

    @property
    def outbox(self) -> Outbox:
        return Outbox(self.db, self.issuer)

    def now_ms(self) -> int:
        return self.clock.now_ms() if self.clock is not None else ids.now_ms()


@dataclass
class ExecutionOptions:
    interactive: bool = False
    approve_in_cli: bool = False
    dry_run: bool = False
    headed: bool | None = None
    keep_artifacts: bool = False
    #: `pause` keeps a locally interrupted lease paused (`apply --resume`); `release` gives it
    #: back (the worker on shutdown).
    on_interrupt: Literal["pause", "release"] = "pause"
    #: Re-attached to an existing lease (`apply --resume`): send `resumed`, not `started`.
    resumed: bool = False
    #: Agent knobs and terminal hooks from the caller (`prompt_pause`, `decide_in_cli`,
    #: `allow_domain`, timeouts; PLAN C6 `AttemptOptions`). The runner completes it with
    #: `keep_artifacts`, `data_dir`, the configured browser and an `on_event` relay.
    attempt: AttemptOptions | None = None


@dataclass
class Interrupts:
    """Signal state shared with the signal handlers (16 §6)."""

    graceful: asyncio.Event = field(default_factory=asyncio.Event)
    abort: asyncio.Event = field(default_factory=asyncio.Event)
    #: SIGTERM: graceful with a hard deadline (then abort).
    deadline_s: float | None = None
    #: The user chose "abandon" (release) instead of "pause" on the first Ctrl+C.
    abandon: bool = False
    #: The worker is shutting down: release instead of pausing.
    shutdown: bool = False


@dataclass
class WorkResult:
    outcome: str
    error_class: str | None = None
    retryable: bool = False
    reason: str | None = None
    evidence: dict[str, Any] | None = None
    submission_status: str | None = None
    steps: int = 0
    ai_calls: int = 0
    log_path: Path | None = None
    pause_reason: str | None = None
    run_id: str | None = None
    file_id: str | None = None
    message: str | None = None
    #: The executor saw the lease fenced (`AttemptResult.details.lease_lost`, 21 §5.3).
    lease_lost: bool = False

    @classmethod
    def from_attempt(cls, result: AttemptResult) -> WorkResult:
        details = result.details or {}
        reason = details.get("reason")
        if not isinstance(reason, str) or not reason:
            reason = (
                result.error_class
                if result.error_class in ("approval_rejected", "approval_expired", "cancelled")
                else None
            )
        message = details.get("message")
        return cls(
            outcome=result.outcome,
            error_class=result.error_class,
            retryable=result.retryable,
            evidence=result.evidence,
            submission_status=result.submission_status,
            steps=result.steps,
            ai_calls=result.ai_calls,
            log_path=result.log_path,
            pause_reason=result.pause_reason,
            reason=reason,
            message=message[:300] if isinstance(message, str) else None,
            lease_lost=details.get("lease_lost") is True or result.error_class == "lease_lost",
        )


@dataclass
class ExecutionOutcome:
    task_id: str
    kind: str
    outcome: Outcome
    lease_id: str
    attempt_id: str | None
    submission_status: str | None = None
    error_class: str | None = None
    reason: str | None = None
    evidence: bool = False
    result_key: str | None = None
    released: str | None = None
    lost_reason: str | None = None
    interrupted: bool = False
    run_id: str | None = None
    file_id: str | None = None
    submit_intent_at: int | None = None
    message: str | None = None

    def as_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "task_id": self.task_id,
            "kind": self.kind,
            "outcome": self.outcome,
            "attempt_id": self.attempt_id,
            "submission_status": self.submission_status,
            "error_class": self.error_class,
            "reason": self.reason,
            "released": self.released,
            "interrupted": self.interrupted,
            "submit_intent_at": self.submit_intent_at,
        }
        if self.run_id:
            out["run_id"] = self.run_id
        if self.file_id:
            out["file_id"] = self.file_id
        if self.lost_reason:
            out["lost_reason"] = self.lost_reason
        if self.message:
            out["message"] = self.message
        return out


def decide_mode(grant: LeaseGrant) -> AttemptMode:
    payload = cast(dict[str, Any], grant.task.get("payload") or {})
    mode = payload.get("mode") or grant.context.get("mode") or "approval"
    if mode == "assisted":
        return "assisted"
    if mode == "auto":
        return "auto"
    return "approval"


def decide_headed(
    mode: str, context: dict[str, Any], config: Config, requested: bool | None
) -> bool:
    """`AttemptContext.headed` under 18 §5.

    - `assisted` is always headed (the user watches and submits);
    - an explicit `--headed/--headless` wins otherwise;
    - `browser.headless_for` listing `apply` asks for headless approval / auto runs (16 §9);
    - `approval` is headed unless `apply.headless_approval = true`;
    - `auto` runs headless when the adapter manifest has `headless_ok` (the agent forces a
      headed window for adapters without it in every case).

    A device without a display cannot open a headed window: the agent then pauses with
    `needs_headed_restart` and the task goes back to a device with `headed_browser` (21 §6.2).
    """
    if mode == "assisted":
        return True
    if requested is not None:
        return requested
    if "apply" in config.browser.headless_for:
        return False
    if mode == "approval":
        return not config.apply.headless_approval
    adapter = cast(dict[str, Any] | None, context.get("adapter"))
    return not (adapter is not None and adapter.get("headless_ok"))


class TaskRunner:
    def __init__(self, env: RunnerEnv, executors: Executors | None = None) -> None:
        self.env = env
        self.executors = executors or Executors()
        self.store = LocalTaskStore(env.db)
        self.channel: ApiLeaseChannel | None = None
        self._local_cancel = False
        self._abort_recorded = False

    # ------------------------------------------------------------------ helpers
    def _emit(self, event: str, /, **fields: Any) -> None:
        self.env.emit(event, fields)

    async def resolve_attempt_id(self, grant: LeaseGrant) -> str | None:
        """The claim response has no attempt id: read it from the task detail (05 §8)."""
        if grant.attempt_id:
            return grant.attempt_id
        try:
            detail = cast(dict[str, Any], await self.env.api.get(f"/api/v1/tasks/{grant.task_id}"))
        except (ApiError, NetworkError, NotAuthenticatedError) as exc:
            log_event(_log, "attempt_lookup_failed", "attempt id unknown", level=30, error=str(exc))
            return None
        for attempt in cast(list[dict[str, Any]], detail.get("attempts") or []):
            if attempt.get("lease_id") == grant.lease_id:
                return str(attempt["id"])
        return None

    # ------------------------------------------------------------------ execute
    async def execute(
        self,
        grant: LeaseGrant,
        options: ExecutionOptions | None = None,
        interrupts: Interrupts | None = None,
    ) -> ExecutionOutcome:
        options = options or ExecutionOptions()
        interrupts = interrupts or Interrupts()
        self._local_cancel = False
        self._abort_recorded = False
        attempt_id = await self.resolve_attempt_id(grant)
        attempt_local = attempt_id is None
        grant.attempt_id = attempt_id or ids.new_id("att")
        run_dir = ensure_private_dir(self.env.paths.run_dir(grant.attempt_id))
        existing = self.store.get(grant.task_id)
        self.store.upsert(
            grant.task_id,
            kind=grant.kind,
            local_state="running" if options.resumed else "claimed",
            lease_id=grant.lease_id,
            attempt_id=grant.attempt_id,
            checkpoint={
                "application_id": grant.application_id,
                "application_revision": cast(
                    dict[str, Any], grant.context.get("application") or {}
                ).get("revision"),
                "mode": decide_mode(grant) if grant.kind == "apply" else None,
                "dry_run": options.dry_run,
                "attempt_id_local": attempt_local,
                "claimed_at": self.env.now_ms(),
                "lease_expires_at": grant.expires_at,
                "run_dir": str(run_dir),
                **(
                    {"submit_intent_at": existing.submit_intent_at}
                    if existing and existing.submit_intent_at
                    else {}
                ),
            },
        )
        record_run_start(
            self.env.db,
            grant.attempt_id,
            "discover" if grant.kind == "discover" else grant.kind,
            log_path=str(run_dir / "steps.jsonl"),
        )
        channel = ApiLeaseChannel(
            api=self.env.api,
            heartbeat_api=self.env.heartbeat_api,
            outbox=self.env.outbox,
            store=self.store,
            grant=grant,
            clock=self.env.clock,
            paths=self.env.paths,
            monotonic=self.env.monotonic,
            kick=self.env.kick,
            emit=self.env.emit,
            on_poll_interval=self.env.on_poll_interval,
            dry_run=options.dry_run,
        )
        if existing is not None and existing.submit_intent_at is not None:
            channel.submit_intent_at = existing.submit_intent_at
        self.channel = channel
        started = self.env.monotonic()
        heartbeat = asyncio.create_task(channel.run_heartbeats(), name="lease-heartbeat")
        watchdog = asyncio.create_task(channel.watchdog(), name="lease-watchdog")
        result: WorkResult | None = None
        ended = "done"
        try:
            with bind(task_id=grant.task_id, attempt_id=grant.attempt_id, lease_id=grant.lease_id):
                self._emit(
                    "task_claimed",
                    task_id=grant.task_id,
                    kind=grant.kind,
                    application_id=grant.application_id,
                    attempt_id=grant.attempt_id,
                )
                with contextlib.suppress(PilihError):
                    await channel.events([{"type": "resumed" if options.resumed else "started"}])
                work = asyncio.create_task(
                    self._dispatch(grant, channel, options, run_dir), name=f"task-{grant.kind}"
                )
                result, ended = await self._supervise(grant, work, channel, interrupts)
                outcome = await self._finalize(
                    grant, channel, options, interrupts, result, ended, started
                )
        finally:
            await channel.close()
            for job in (heartbeat, watchdog):
                job.cancel()
            for job in (heartbeat, watchdog):
                with contextlib.suppress(asyncio.CancelledError):
                    await job
            self.channel = None
        if not options.keep_artifacts:
            cleanup_staging(self.env.paths, grant.attempt_id)
        record_run_end(self.env.db, grant.attempt_id, outcome.outcome)
        self._emit("result", **outcome.as_dict())
        return outcome

    # ------------------------------------------------------------------ supervision
    async def _supervise(
        self,
        grant: LeaseGrant,
        work: asyncio.Task[WorkResult],
        channel: ApiLeaseChannel,
        interrupts: Interrupts,
    ) -> tuple[WorkResult | None, str]:
        graceful_seen = False
        deadline: float | None = None
        loop = asyncio.get_running_loop()
        lost_waiter = asyncio.ensure_future(channel.lost.wait())
        abort_waiter = asyncio.ensure_future(interrupts.abort.wait())
        graceful_waiter = asyncio.ensure_future(interrupts.graceful.wait())
        try:
            while True:
                waiters: set[asyncio.Future[Any]] = {work, lost_waiter, abort_waiter}
                if not graceful_seen:
                    waiters.add(graceful_waiter)
                timeout = None if deadline is None else max(0.0, deadline - loop.time())
                done, _ = await asyncio.wait(
                    waiters, timeout=timeout, return_when=asyncio.FIRST_COMPLETED
                )
                if work in done:
                    return self._work_result(work, channel), "done"
                if abort_waiter in done or (deadline is not None and not done):
                    self.record_abort(grant, channel)
                    await _cancel(work)
                    return None, "aborted"
                if lost_waiter in done:
                    try:
                        finished = await asyncio.wait_for(asyncio.shield(work), LOST_GRACE_S)
                    except TimeoutError:
                        await _cancel(work)
                        return None, "lost"
                    except Exception:  # noqa: BLE001 - the executor failed while stopping
                        return None, "lost"
                    return finished, "lost"
                if graceful_waiter in done and not graceful_seen:
                    graceful_seen = True
                    if interrupts.deadline_s is not None:
                        deadline = loop.time() + interrupts.deadline_s
                    if channel.submit_intent_at is None:
                        self._local_cancel = True
                        channel.cancel_requested.set()
                        self._emit(
                            "warning",
                            message="Stopping at the next step boundary (Ctrl+C again to abort).",
                        )
                    else:
                        self._emit(
                            "warning",
                            message="A submission may be in progress; waiting for confirmation "
                            "(Ctrl+C again to abort).",
                        )
        finally:
            for waiter in (lost_waiter, abort_waiter, graceful_waiter):
                waiter.cancel()

    def _work_result(self, work: asyncio.Task[WorkResult], channel: ApiLeaseChannel) -> WorkResult:
        try:
            return work.result()
        except asyncio.CancelledError:
            return WorkResult("cancelled", error_class="cancelled", reason="cancelled")
        except PilihError as exc:
            if channel.lost.is_set():
                return WorkResult("failed", error_class="lease_expired", message=exc.message)
            code = exc.details.get("error_class")
            return WorkResult(
                "failed",
                error_class=str(code or exc.code)[:64],
                retryable=isinstance(exc, NetworkError),
                message=exc.message,
            )
        except Exception as exc:  # noqa: BLE001 - an executor crash is a reportable outcome
            log_event(_log, "executor_crashed", "executor raised", level=40, error=repr(exc))
            return WorkResult(
                "failed", error_class="browser_crashed", retryable=True, message=repr(exc)[:300]
            )

    def record_abort(self, grant: LeaseGrant, channel: ApiLeaseChannel) -> bool:
        """Second Ctrl+C after `submit_intent`: a local `outcome_unknown` result, written
        synchronously before anything is cancelled (16 §6). True when written."""
        if channel.submit_intent_at is None or self._abort_recorded:
            return False
        local = self.store.get(grant.task_id)
        if local is not None and local.checkpoint.get("result_key"):
            return False
        body: dict[str, Any] = {"outcome": "outcome_unknown", "reason": "interrupted"}
        update = self._application_update(grant, "outcome_unknown")
        if update is not None:
            body["application_update"] = update
        self._enqueue_result(grant, channel, body, outcome="outcome_unknown")
        self._abort_recorded = True
        return True

    # ------------------------------------------------------------------ dispatch
    async def _dispatch(
        self,
        grant: LeaseGrant,
        channel: ApiLeaseChannel,
        options: ExecutionOptions,
        run_dir: Path,
    ) -> WorkResult:
        if grant.kind == "apply":
            return await self._run_apply(grant, channel, options, run_dir)
        if grant.kind == "discover":
            return await self._run_discover(grant, channel)
        if grant.kind == "render_cv":
            return await self._run_render(grant, channel)
        return WorkResult("failed", error_class="precheck_failed", message=f"kind {grant.kind}")

    async def _run_apply(
        self,
        grant: LeaseGrant,
        channel: ApiLeaseChannel,
        options: ExecutionOptions,
        run_dir: Path,
    ) -> WorkResult:
        mode = decide_mode(grant)
        headed = decide_headed(mode, grant.context, self.env.config, options.headed)
        ctx = AttemptContext(
            task=grant.task,
            lease_id=grant.lease_id,
            attempt_id=cast(str, grant.attempt_id),
            context=grant.context,
            channel=channel,
            mode=mode,
            headed=headed,
            interactive=options.interactive,
            run_dir=run_dir,
            dry_run=options.dry_run,
            approve_in_cli=options.approve_in_cli,
            options=self.attempt_options(options),
        )
        result = await self.executors.run_attempt(ctx)
        return WorkResult.from_attempt(result)

    def attempt_options(self, options: ExecutionOptions) -> AttemptOptions:
        """The caller's `AttemptOptions` completed from the run and the local config."""
        base = options.attempt or AttemptOptions()
        browser = self.env.config.browser
        return dataclasses.replace(
            base,
            browser_mode=base.browser_mode or browser.mode,
            channel=base.channel or browser.channel,
            cdp_endpoint=base.cdp_endpoint or browser.cdp_endpoint or None,
            data_dir=base.data_dir or self.env.paths.data_dir,
            keep_artifacts=base.keep_artifacts or options.keep_artifacts,
            on_event=base.on_event or self._relay_agent_event,
        )

    def _relay_agent_event(self, event: str, fields: dict[str, Any]) -> None:
        """Agent notices for the terminal (16 §5). `progress` and `paused` already arrive as
        lease events (`step` / `paused`); individual actions stay in the step log."""
        if event == "awaiting_user_submit":
            self._emit("log", message=str(fields.get("message") or "Click Submit when ready."))

    async def _run_discover(self, grant: LeaseGrant, channel: ApiLeaseChannel) -> WorkResult:
        from pilih_jobs.discovery import DiscoveryOptions, DiscoveryRuntime

        payload = cast(dict[str, Any], grant.task.get("payload") or {})
        records = [
            s for s in cast(list[dict[str, Any]], grant.context.get("sources") or []) if s.get("id")
        ]
        sources = [str(s["id"]) for s in records]
        if not sources:
            sources = [str(s) for s in cast(list[Any], payload.get("source_ids") or [])]
        urls = [str(u) for u in cast(list[Any], payload.get("urls") or [])]
        plans: list[DiscoveryOptions] = []
        if sources:
            plans.append(
                DiscoveryOptions(
                    sources=sources,
                    check_tracked=bool(payload.get("check_tracked")),
                    task_id=grant.task_id,
                    source_records=records,
                )
            )
        plans += [DiscoveryOptions(url=u, task_id=grant.task_id) for u in urls]
        if not plans:
            return WorkResult("failed", error_class="precheck_failed", message="no sources")
        cancel = asyncio.Event()
        relay = _ProgressRelay(channel, stage="discovering", emit=self.env.emit)
        stopper = asyncio.create_task(_link_cancel(channel, cancel))
        last: DiscoveryRunResult | None = None
        try:
            for plan in plans:
                if cancel.is_set():
                    break
                runtime = DiscoveryRuntime(
                    outbox=self.env.outbox,
                    api=self.env.api,
                    emit=relay.emit,
                    cancel=cancel,
                    runtime=self.env.runtime,
                )
                last = await self.executors.run_discovery(plan, runtime)
                record_run_start(self.env.db, last.run_id, "discover")
                record_run_end(self.env.db, last.run_id, last.status)
        finally:
            stopper.cancel()
            await relay.drain()
        if last is None or (cancel.is_set() and last.status == "cancelled"):
            return WorkResult("cancelled", reason="cancel_requested", error_class="cancelled")
        if last.status in ("completed", "partial"):
            return WorkResult("succeeded", run_id=last.run_id)
        if last.status == "cancelled":
            return WorkResult("cancelled", reason="cancel_requested", run_id=last.run_id)
        error_class, retryable = _discovery_error(last.errors)
        return WorkResult(
            "failed", error_class=error_class, retryable=retryable, run_id=last.run_id
        )

    async def _run_render(self, grant: LeaseGrant, channel: ApiLeaseChannel) -> WorkResult:
        cvv_id = str(grant.context.get("cv_variant_id") or grant.task.get("cv_variant_id") or "")
        render = cast(dict[str, Any], grant.context.get("render") or {})
        url = render.get("url")
        expires_in = render.get("expires_in")
        age_s = (self.env.monotonic() - grant.claimed_mono_ms) / 1000
        stale = not isinstance(expires_in, int) or age_s >= max(0, expires_in - 10)
        try:
            if not isinstance(url, str) or stale:
                fresh = cast(
                    dict[str, Any],
                    await self.env.api.post(f"/api/v1/cv-variants/{cvv_id}/render-ticket"),
                )
                url = str(fresh["url"])
        except (ApiError, NetworkError) as exc:
            channel.fence(exc)
            return WorkResult(
                "failed",
                error_class="render_failed" if isinstance(exc, ApiError) else "network_offline",
                retryable=isinstance(exc, NetworkError),
                message=exc.message,
            )
        if urlsplit(url).scheme not in ("https", "http"):
            return WorkResult("failed", error_class="render_failed", message="bad render URL")
        with contextlib.suppress(PilihError):
            await channel.events(
                [
                    {
                        "type": "progress",
                        "progress": {"stage": "rendering", "step": 1, "message": "Rendering CV"},
                    }
                ]
            )
        try:
            rendered = await self.executors.render_cv_page(url, 60.0)
        except TimeoutError:
            return WorkResult("failed", error_class="render_failed", message="render timed out")
        status = rendered.get("status")
        file_id = rendered.get("file_id")
        if status == "done" and isinstance(file_id, str) and file_id.startswith("fil_"):
            return WorkResult("succeeded", file_id=file_id)
        message = str(rendered.get("message") or "render page reported an error")[:300]
        return WorkResult("failed", error_class="render_failed", message=message)

    # ------------------------------------------------------------------ finalize
    def _application_update(self, grant: LeaseGrant, status: str) -> dict[str, Any] | None:
        app = cast(dict[str, Any] | None, grant.context.get("application"))
        revision = app.get("revision") if app else None
        if grant.kind != "apply" or not isinstance(revision, int):
            return None
        update: dict[str, Any] = {"base_revision": revision, "submission_status": status}
        if status in ("submitted_verified", "submitted_unverified"):
            update["stage"] = "applied"
        return update

    def _enqueue_result(
        self,
        grant: LeaseGrant,
        channel: ApiLeaseChannel,
        body: dict[str, Any],
        *,
        outcome: str,
    ) -> str:
        outbox = self.env.outbox
        with self.env.db.transaction():
            entry = outbox.enqueue(
                "POST",
                lease_path(grant.task_id, grant.lease_id, "result"),
                body,
                ordering_key=channel.ordering_key,
                kind="lease_report",
                priority=PRIORITY_RESULT,
                idempotency_key=f"result:{grant.lease_id}",
            )
            self.store.update(
                grant.task_id,
                local_state="sync_pending",
                result_key=entry.idempotency_key,
                outcome=outcome,
            )
        self.env.kick()
        return entry.idempotency_key

    async def _upload_log(self, grant: LeaseGrant, result: WorkResult) -> str | None:
        """Gzip and upload the redacted step log as `run_log` (19 §11); best effort."""
        path = result.log_path
        if path is None or not path.is_file():
            return None
        gz = path.with_name(path.name + ".gz")
        try:
            with path.open("rb") as source, gzip.open(gz, "wb") as target:
                shutil.copyfileobj(source, target)
            uploaded = await asyncio.wait_for(
                upload_file(
                    self.env.api,
                    "run_log",
                    gz,
                    {"attempt_id": grant.attempt_id, "application_id": grant.application_id},
                ),
                timeout=30,
            )
        except (OSError, PilihError, TimeoutError) as exc:
            log_event(_log, "run_log_upload_failed", "step log not uploaded", error=str(exc))
            return None
        finally:
            with contextlib.suppress(OSError):
                gz.unlink()
        file_id = uploaded.get("id")
        return file_id if isinstance(file_id, str) else None

    async def _finalize(
        self,
        grant: LeaseGrant,
        channel: ApiLeaseChannel,
        options: ExecutionOptions,
        interrupts: Interrupts,
        result: WorkResult | None,
        ended: str,
        started_mono: int,
    ) -> ExecutionOutcome:
        intent_at = channel.submit_intent_at
        base = ExecutionOutcome(
            task_id=grant.task_id,
            kind=grant.kind,
            outcome="interrupted",
            lease_id=grant.lease_id,
            attempt_id=grant.attempt_id,
            submit_intent_at=intent_at,
            interrupted=ended == "aborted" or self._local_cancel,
        )
        if result is not None:
            base.run_id = result.run_id
            base.file_id = result.file_id
            base.message = result.message
        # ---- aborted (second Ctrl+C / SIGTERM deadline)
        if ended == "aborted":
            if self._abort_recorded:
                base.outcome = "outcome_unknown"
                base.submission_status = "outcome_unknown"
                base.result_key = f"result:{grant.lease_id}"
            return base
        # ---- lease lost: never report again under it; evidence goes the late path. The
        # executor may see the fence first (a 401 / 409 on one of its own calls, 21 §5.3).
        if result is not None and result.lease_lost and not channel.lost.is_set():
            channel.mark_lost("lease_lost")
        if channel.lost.is_set() or ended == "lost":
            base.outcome = "lost"
            base.lost_reason = channel.lost_reason
            local = self.store.get(grant.task_id)
            real_attempt = local is not None and not local.checkpoint.get("attempt_id_local")
            if (
                intent_at is not None
                and result is not None
                and result.evidence
                and grant.attempt_id
                and real_attempt
            ):
                enqueue_late_evidence(
                    self.env.outbox,
                    self.store,
                    task_id=grant.task_id,
                    attempt_id=grant.attempt_id,
                    evidence=result.evidence,
                    outcome=result.outcome
                    if result.outcome in ("submitted", "failed", "outcome_unknown")
                    else "outcome_unknown",
                )
                base.evidence = True
                self.env.kick()
            else:
                self.store.update(grant.task_id, local_state="orphaned")
            return base
        if result is None:  # pragma: no cover - "done" always carries a result
            raise RuntimeError("executor finished without a result")
        outcome = result.outcome
        base.error_class = result.error_class
        # ---- pre-intent stops: pause, release or a terminal cancel
        if outcome in ("paused", "cancelled") and intent_at is None:
            return await self._finalize_stop(grant, channel, options, interrupts, result, base)
        # ---- post-intent: nothing is retried; failures without negative evidence are unknown
        if intent_at is not None:
            verdict = (result.evidence or {}).get("verdict")
            if outcome in ("paused", "cancelled") or (
                outcome == "failed" and verdict != "negative"
            ):
                outcome = "outcome_unknown"
        body: dict[str, Any] = {"outcome": outcome}
        if result.error_class:
            body["error_class"] = result.error_class[:64]
        if outcome == "failed":
            body["retryable"] = bool(result.retryable) and intent_at is None
        reason = result.reason
        if reason:
            body["reason"] = reason[:60]
        if result.evidence and grant.kind == "apply":
            body["evidence"] = result.evidence
        status: str | None = None
        if grant.kind == "apply":
            if outcome == "submitted":
                status = result.submission_status or "submitted_unverified"
            elif outcome == "outcome_unknown":
                status = "outcome_unknown"
            elif outcome == "failed" and intent_at is not None:
                status = "failed"
            if status is not None:
                update = self._application_update(grant, status)
                if update is not None:
                    body["application_update"] = update
        if grant.kind == "discover" and result.run_id:
            body["run_id"] = result.run_id
        if grant.kind == "render_cv" and result.file_id:
            body["file_id"] = result.file_id
        if grant.kind == "apply":
            log_file_id = await self._upload_log(grant, result)
            if log_file_id:
                body["log_file_id"] = log_file_id
        body["stats"] = {
            "steps_count": max(0, result.steps),
            "ai_calls": max(0, result.ai_calls),
            "duration_ms": max(0, self.env.monotonic() - started_mono),
        }
        base.result_key = self._enqueue_result(grant, channel, body, outcome=outcome)
        base.outcome = cast(Outcome, outcome)
        base.submission_status = status
        base.reason = reason
        base.evidence = bool(result.evidence)
        return base

    async def _finalize_stop(
        self,
        grant: LeaseGrant,
        channel: ApiLeaseChannel,
        options: ExecutionOptions,
        interrupts: Interrupts,
        result: WorkResult,
        base: ExecutionOutcome,
    ) -> ExecutionOutcome:
        server_cancel = channel.server_cancel
        if options.dry_run and not server_cancel and not self._local_cancel:
            # A dry run ends the task: nothing was submitted and nothing may re-run it.
            body = {"outcome": "cancelled", "reason": "dry_run"}
            base.result_key = self._enqueue_result(grant, channel, body, outcome="cancelled")
            base.outcome = "cancelled"
            base.reason = "dry_run"
            return base
        if self._local_cancel and not server_cancel:
            if options.on_interrupt == "pause" and not (interrupts.abandon or interrupts.shutdown):
                with contextlib.suppress(PilihError):
                    await channel.events(
                        [
                            {
                                "type": "paused",
                                "pause_reason": "user_requested",
                                "message": "Interrupted on the device; resume with "
                                "`pilih-jobs apply --resume`.",
                            }
                        ]
                    )
                channel.set_local_state("paused", pause_reason="user_requested")
                base.outcome = "paused"
                base.reason = "user_requested"
                return base
            reason = "user_quit" if interrupts.abandon else "shutdown"
            released = await channel.release(reason)
            base.outcome = "released" if released else "paused"
            base.released = reason if released else None
            return base
        if result.outcome == "paused":
            reason = self._release_reason(channel, options, result)
            if reason is None:
                channel.set_local_state("paused", pause_reason=result.pause_reason)
                base.outcome = "paused"
                base.reason = result.pause_reason
                return base
            released = await channel.release(reason)
            base.outcome = "released" if released else "paused"
            base.released = reason if released else None
            base.reason = result.pause_reason
            return base
        # A cancel requested on the server, or an approval rejected / expired (21 §6.3).
        reason = result.reason or (
            "cancel_requested" if server_cancel else result.error_class or "cancelled"
        )
        body: dict[str, Any] = {"outcome": "cancelled", "reason": reason[:60]}
        if result.error_class:
            body["error_class"] = result.error_class[:64]
        base.result_key = self._enqueue_result(grant, channel, body, outcome="cancelled")
        base.outcome = "cancelled"
        base.reason = reason
        return base

    def _release_reason(
        self, channel: ApiLeaseChannel, options: ExecutionOptions, result: WorkResult
    ) -> str | None:
        """Which release a paused attempt needs; None keeps it paused (interactive)."""
        if channel.local_state == "awaiting_approval":
            return "awaiting_approval"
        if options.interactive and options.on_interrupt == "pause":
            return None
        if result.pause_reason in HUMAN_PAUSE_REASONS:
            return "needs_headed"
        return "shutdown"


# ---------------------------------------------------------------------- helpers
async def _cancel(task: asyncio.Task[Any]) -> None:
    task.cancel()
    with contextlib.suppress(asyncio.CancelledError, Exception):
        await task


async def _link_cancel(channel: ApiLeaseChannel, cancel: asyncio.Event) -> None:
    """Discovery's `cancel` follows the lease: server cancel, local stop or lost lease."""
    waiters = [
        asyncio.ensure_future(channel.cancel_requested.wait()),
        asyncio.ensure_future(channel.lost.wait()),
    ]
    try:
        await asyncio.wait(waiters, return_when=asyncio.FIRST_COMPLETED)
        cancel.set()
    finally:
        for waiter in waiters:
            waiter.cancel()


def _discovery_error(errors: list[dict[str, Any]]) -> tuple[str, bool]:
    classes = [str(e.get("class") or e.get("error_class") or "") for e in errors]
    for name in classes:
        if name in DISCOVERY_ERROR_MAP:
            return DISCOVERY_ERROR_MAP[name]
    return "upstream_unavailable", True


class _ProgressRelay:
    """Forwards discovery events to the terminal and (throttled) to the lease as progress."""

    MIN_INTERVAL_MS: Final = 2_000

    def __init__(self, channel: ApiLeaseChannel, *, stage: str, emit: Emit) -> None:
        self.channel = channel
        self.stage = stage
        self._emit = emit
        self._step = 0
        self._last_sent = -self.MIN_INTERVAL_MS
        self._pending: set[asyncio.Task[None]] = set()

    def emit(self, event: dict[str, Any]) -> None:
        kind = str(event.get("type") or "log")
        self._emit(kind, {k: v for k, v in event.items() if k != "type"})
        self._step += 1
        now = mono_ms()
        if now - self._last_sent < self.MIN_INTERVAL_MS or self.channel.lost.is_set():
            return
        self._last_sent = now
        message = str(event.get("message") or kind)[:300]
        progress = {"stage": self.stage, "step": self._step, "message": message}
        task = asyncio.get_running_loop().create_task(self._send(progress))
        self._pending.add(task)
        task.add_done_callback(self._pending.discard)

    async def _send(self, progress: dict[str, Any]) -> None:
        with contextlib.suppress(PilihError):
            await self.channel.events([{"type": "progress", "progress": progress}])

    async def drain(self) -> None:
        if self._pending:
            await asyncio.gather(*self._pending, return_exceptions=True)
