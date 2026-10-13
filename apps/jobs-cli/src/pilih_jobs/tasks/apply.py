"""`apply` orchestration (16 §3.3, 21 §4, D-29): task targeted at this device → claim → run.

`ApplyOrchestrator.run()` is used both by the interactive `pilih-jobs apply` (in-process)
and by the worker when an interactive `apply` hands the work over through IPC:

1. take the per-application lock `<data>/locks/app_<id>.lock` (two local drivers never act
   on the same application, 21 §9);
2. pre-check the application (not submitted, not closed, a browser application);
3. `POST /api/v1/tasks {kind: apply, target_device_id: self, priority: 10}` — base scope
   `automation:execute` suffices for assisted/approval tasks targeted at the calling device;
   `--mode auto` and `--approve` need the step-up `automation:manage` (checked by the CLI);
4. claim it (`claim:<dev>:<ULID>` key, capabilities `apply` [+ `headed_browser`]); a foreign
   task claimed instead is given back (`release: shutdown`);
5. execute it with `TaskRunner` (heartbeats, fencing, signals, result reporting).

`--resume` re-attaches to this device's paused lease when it is still alive (one heartbeat
proves it), or claims the re-queued task; never after `submit_intent`.
"""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any, Final, cast

from pilih_jobs.agent.options import AttemptOptions
from pilih_jobs.api.errors import ApiConflictError, ApiError, NetworkError
from pilih_jobs.contracts import ids
from pilih_jobs.errors import (
    ConflictError,
    NotFoundError,
    PolicyRefusedError,
    UnavailableError,
    UsageError,
)
from pilih_jobs.logging import get_logger, log_event
from pilih_jobs.sync.cache import EntityCache
from pilih_jobs.tasks.constants import (
    INTERACTIVE_TASK_PRIORITY,
    PRE_INTENT_STATES,
    TARGETED_CLAIM_ATTEMPTS,
)
from pilih_jobs.tasks.lease import LeaseGrant, lease_path, mono_ms
from pilih_jobs.tasks.local import LocalTaskStore
from pilih_jobs.tasks.locks import acquire_app_lock
from pilih_jobs.tasks.poll import claim
from pilih_jobs.tasks.recovery import release_lease
from pilih_jobs.tasks.runner import (
    ExecutionOptions,
    ExecutionOutcome,
    Executors,
    Interrupts,
    RunnerEnv,
    TaskRunner,
)

_log = get_logger("tasks.apply")

LIVE_TASK_STATES: Final = ("queued", "claimed", "running", "paused", "awaiting_approval")
CLOSED_STAGES: Final = ("accepted", "rejected", "withdrawn")
SUBMITTED: Final = ("submitted_verified", "submitted_unverified")
MODES: Final = ("assisted", "approval", "auto")


@dataclass
class ApplyRequest:
    application_id: str
    mode: str | None = None
    dry_run: bool = False
    approve: bool = False
    headed: bool | None = None
    resume: bool = False
    keep_artifacts: bool = False
    interactive: bool = False

    def as_ipc(self) -> dict[str, Any]:
        return {
            "op": "apply",
            "application_id": self.application_id,
            "mode": self.mode,
            "dry_run": self.dry_run,
            "approve": self.approve,
            "headed": self.headed,
            "resume": self.resume,
            "keep_artifacts": self.keep_artifacts,
        }

    @classmethod
    def from_ipc(cls, data: dict[str, Any]) -> ApplyRequest:
        application_id = data.get("application_id")
        if not isinstance(application_id, str) or not ids.is_id("app", application_id):
            raise UsageError("apply: a valid app_… id is required")
        mode = data.get("mode")
        headed = data.get("headed")
        return cls(
            application_id=application_id,
            mode=mode if isinstance(mode, str) and mode in MODES else None,
            dry_run=bool(data.get("dry_run")),
            approve=bool(data.get("approve")),
            headed=headed if isinstance(headed, bool) else None,
            resume=bool(data.get("resume")),
            keep_artifacts=bool(data.get("keep_artifacts")),
            interactive=False,
        )


def _existing_task_id(error: ApiConflictError) -> str | None:
    details = error.details
    for key in ("task_id", "existing_task_id", "id"):
        value = details.get(key)
        if isinstance(value, str) and value.startswith("tsk_"):
            return value
    for key in ("current", "task", "existing"):
        nested = details.get(key)
        if isinstance(nested, dict):
            value = cast(dict[str, Any], nested).get("id")
            if isinstance(value, str) and value.startswith("tsk_"):
                return value
    return None


class ApplyOrchestrator:
    def __init__(
        self,
        env: RunnerEnv,
        executors: Executors | None = None,
        *,
        capabilities: list[str] | None = None,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
        attempt: AttemptOptions | None = None,
    ) -> None:
        self.env = env
        self.executors = executors or Executors()
        #: Agent hooks / knobs for the attempt (the interactive terminal's prompts).
        self.attempt = attempt
        self.capabilities = capabilities or (
            ["apply", "headed_browser"] if env.has_display else ["apply"]
        )
        self.sleep = sleep
        self.store = LocalTaskStore(env.db)
        self.runner: TaskRunner | None = None
        self.task_id: str | None = None

    # ------------------------------------------------------------------ pre-checks
    async def application_detail(self, application_id: str) -> dict[str, Any]:
        detail = cast(
            dict[str, Any], await self.env.api.get(f"/api/v1/applications/{application_id}")
        )
        cache = EntityCache(self.env.db, self.env.issuer)
        app = cast(dict[str, Any], detail["application"])
        cache.put("application", app)
        return detail

    def precheck(self, detail: dict[str, Any]) -> None:
        app = cast(dict[str, Any], detail["application"])
        posting = cast(dict[str, Any], detail.get("posting") or {})
        if app.get("submission_status") in SUBMITTED:
            raise ConflictError(
                f"{app['id']} is already submitted ({app['submission_status']}).",
                code="already_submitted",
            )
        if app.get("stage") in CLOSED_STAGES:
            raise PolicyRefusedError(
                f"{app['id']} is {app['stage']}; reopen it before applying.",
                code="application_closed",
            )
        support = posting.get("application_support")
        if support == "email":
            raise PolicyRefusedError(
                "This posting takes applications by email.",
                code="email_application_required",
                hint=f"pilih-jobs email draft {app['id']}",
            )
        if support in ("prohibited", "browser_unsupported", "external_redirect"):
            raise PolicyRefusedError(
                f"Browser applications are not supported for this posting ({support}).",
                code="unsupported_form",
            )

    def decide_mode(self, request: ApplyRequest, detail: dict[str, Any]) -> str:
        if request.mode in MODES:
            return cast(str, request.mode)
        app_mode = cast(dict[str, Any], detail["application"]).get("mode")
        return app_mode if app_mode in ("assisted", "approval") else "approval"

    def live_task(self, detail: dict[str, Any]) -> dict[str, Any] | None:
        for task in cast(list[dict[str, Any]], detail.get("tasks") or []):
            if task.get("kind") == "apply" and task.get("state") in LIVE_TASK_STATES:
                return task
        return None

    # ------------------------------------------------------------------ task + claim
    async def create_task(self, request: ApplyRequest, mode: str) -> dict[str, Any]:
        key = f"cli-apply:{self.env.device_id}:{ids.new_ulid()}"
        payload: dict[str, Any] = {"mode": mode}
        if request.dry_run:
            payload["dry_run"] = True
        body = {
            "kind": "apply",
            "application_id": request.application_id,
            "payload": payload,
            "target_device_id": self.env.device_id,
            "priority": INTERACTIVE_TASK_PRIORITY,
            "idempotency_key": key,
        }
        try:
            data = cast(
                dict[str, Any], await self.env.api.post("/api/v1/tasks", body, idempotency_key=key)
            )
        except ApiConflictError as exc:
            existing = _existing_task_id(exc)
            if exc.error != "duplicate" or existing is None:
                raise
            return await self._existing(existing)
        task = cast(dict[str, Any], data["task"])
        log_event(_log, "task_created", "apply task created", task_id=task["id"])
        return task

    async def _existing(self, task_id: str) -> dict[str, Any]:
        detail = cast(dict[str, Any], await self.env.api.get(f"/api/v1/tasks/{task_id}"))
        task = cast(dict[str, Any], detail["task"])
        state = task.get("state")
        target = task.get("target_device_id")
        if state == "queued" and target in (None, self.env.device_id):
            return task
        if task.get("lease_device_id") == self.env.device_id and state in PRE_INTENT_STATES:
            raise ConflictError(
                f"{task_id} is already running on this device.",
                code="already_running",
                hint=f"pilih-jobs apply {task.get('application_id')} --resume",
            )
        device = detail.get("device_name") or task.get("lease_device_id") or "another device"
        raise ConflictError(
            f"An apply task for this application is already live ({state} on {device}).",
            code="already_running",
            details={"task_id": task_id, "state": state},
        )

    async def claim_targeted(self, task_id: str) -> LeaseGrant:
        """Claim until the claim returns `task_id`; foreign tasks are given back."""
        for _ in range(TARGETED_CLAIM_ATTEMPTS):
            outcome = await claim(
                self.env.api, self.env.device_id, self.capabilities, now_ms=self.env.now_ms
            )
            grant = outcome.grant
            if grant is None:
                await self.sleep(min(outcome.retry_after or 1.0, 5.0))
                continue
            if grant.task_id == task_id:
                return grant
            log_event(
                _log,
                "foreign_claim",
                "claimed another task; giving it back",
                task_id=grant.task_id,
            )
            await release_lease(self.env.api, grant.task_id, grant.lease_id, "shutdown")
        raise UnavailableError(
            f"Could not claim {task_id}; is this device accepting tasks?",
            code="claim_failed",
            hint="pilih-jobs worker enable",
        )

    # ------------------------------------------------------------------ resume
    async def _reattach(self, task_id: str, lease_id: str) -> LeaseGrant | None:
        """One heartbeat proves the lease is still ours; the context comes from the task."""
        try:
            beat = cast(
                dict[str, Any],
                await self.env.api.post(
                    lease_path(task_id, lease_id, "heartbeat"),
                    {
                        "progress": {"stage": "opening", "step": 0, "message": "Resuming"},
                        "local_state": "running",
                    },
                    idempotency_key=f"hb:{lease_id}:{ids.new_ulid()}",
                ),
            )
            detail = cast(dict[str, Any], await self.env.api.get(f"/api/v1/tasks/{task_id}"))
        except (ApiError, NetworkError):
            return None
        task = cast(dict[str, Any], detail["task"])
        if task.get("submit_intent_at") is not None:
            raise ConflictError(
                f"{task_id} is past submit_intent and is never resumed (D-19).",
                code="too_late",
            )
        attempt = next(
            (
                a
                for a in cast(list[dict[str, Any]], detail.get("attempts") or [])
                if a.get("lease_id") == lease_id
            ),
            None,
        )
        return LeaseGrant(
            task=task,
            lease_id=lease_id,
            expires_at=int(beat.get("lease_expires_at") or task.get("lease_expires_at") or 0),
            heartbeat_interval_ms=30_000,
            context=cast(dict[str, Any], detail.get("context") or {}),
            attempt_id=cast(str | None, attempt.get("id")) if attempt else None,
            server_time=cast(int | None, beat.get("server_time")),
            claimed_mono_ms=mono_ms(),
        )

    async def resume_grant(self, application_id: str) -> tuple[LeaseGrant, bool]:
        """`(grant, reattached)` for `apply --resume`; NotFoundError when nothing to resume."""
        for local in self.store.for_application(application_id):
            if local.submit_intent_at is not None:
                continue
            if local.local_state in PRE_INTENT_STATES and local.lease_id:
                grant = await self._reattach(local.task_id, local.lease_id)
                if grant is not None:
                    return grant, True
        detail = await self.application_detail(application_id)
        task = self.live_task(detail)
        if task is None:
            raise NotFoundError(
                f"Nothing to resume for {application_id}.",
                hint=f"pilih-jobs apply {application_id}",
            )
        if task.get("submit_intent_at") is not None:
            raise ConflictError("The task is past submit_intent and is never resumed (D-19).")
        lease_id = task.get("lease_id")
        if task.get("lease_device_id") == self.env.device_id and isinstance(lease_id, str):
            grant = await self._reattach(str(task["id"]), lease_id)
            if grant is not None:
                return grant, True
        if task.get("state") == "queued" and task.get("target_device_id") in (
            None,
            self.env.device_id,
        ):
            return await self.claim_targeted(str(task["id"])), False
        raise ConflictError(
            f"The task for {application_id} is {task.get('state')} on another device.",
            code="already_running",
        )

    # ------------------------------------------------------------------ run
    async def prepare(self, request: ApplyRequest) -> tuple[LeaseGrant, bool]:
        if request.resume:
            return await self.resume_grant(request.application_id)
        detail = await self.application_detail(request.application_id)
        self.precheck(detail)
        live = self.live_task(detail)
        if live is not None and live.get("lease_device_id") == self.env.device_id:
            raise ConflictError(
                f"{live['id']} is already live on this device ({live.get('state')}).",
                code="already_running",
                hint=f"pilih-jobs apply {request.application_id} --resume",
            )
        task = await self.create_task(request, self.decide_mode(request, detail))
        self.task_id = str(task["id"])
        return await self.claim_targeted(self.task_id), False

    async def run(
        self, request: ApplyRequest, interrupts: Interrupts | None = None
    ) -> ExecutionOutcome:
        lock = acquire_app_lock(self.env.paths, request.application_id)
        try:
            grant, reattached = await self.prepare(request)
            self.task_id = grant.task_id
            self.runner = TaskRunner(self.env, self.executors)
            return await self.runner.execute(
                grant,
                ExecutionOptions(
                    interactive=request.interactive,
                    approve_in_cli=request.approve and request.interactive,
                    dry_run=request.dry_run
                    or bool(cast(dict[str, Any], grant.task.get("payload") or {}).get("dry_run")),
                    headed=request.headed,
                    keep_artifacts=request.keep_artifacts,
                    on_interrupt="pause",
                    resumed=reattached,
                    attempt=self.attempt,
                ),
                interrupts,
            )
        finally:
            lock.release()
