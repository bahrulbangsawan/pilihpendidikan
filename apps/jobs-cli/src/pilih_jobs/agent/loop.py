"""AgentLoop: one application attempt in the browser under a lease (19 §2, 18, 21 §5–§6).

```text
precheck → stage files → BrowserController.start → open apply_url
LOOP:  observe → lease / cancel / budget / crash guards
       → off-allowlist?  pause off_domain_navigation | stop (auto)
       → ChallengeDetector hit? pause (no AI call) | stop (auto)
       → page-classify (AI, cached per page structure)
       → application_form | review_page: field-plan (AI) → client PlanValidator →
            needs_human → pause | answer approval | stop (auto)
       → candidates (deterministic first; else next-action AI, < 0.70 → pause)
       → submit? → SUBMIT GATE (approval / auto preconditions → submit_intent 200 → click once)
       → ActionExecutor.execute → postcondition → checkpoint + step log
after submit: EvidenceRecorder → verify-submission (AI) → 19 §9.1 verdict → result
```

Safety invariants enforced here and in the browser layer:

- the agent stops acting the moment `channel.lost` is set or a 401/409 lease error is
  raised, closes the page without submitting and never reports under the lease;
- Submit is clicked only after `channel.submit_intent` returned (D-28), exactly once;
- every typed value is a validated plan value or a value the user gave in an approval;
- CAPTCHAs, logins, MFA and payments pause for a human — never solved or bypassed;
- page text never adds an action: the model only picks among enumerated candidates.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final, Literal, cast

from pilih_jobs.agent.ai import AiClient, AiOfflineError, AiUnavailableError
from pilih_jobs.agent.budget import Budget, BudgetExceededError
from pilih_jobs.agent.candidates import (
    Candidate,
    CandidateEnumerator,
    EnumerationContext,
    choose_deterministic,
)
from pilih_jobs.agent.channel import classify_channel_error
from pilih_jobs.agent.injection import observation_injection
from pilih_jobs.agent.options import AttemptOptions, PauseAnswer, PausePrompt
from pilih_jobs.agent.policy import AutoFacts, PolicyEngine, auto_precondition_failures
from pilih_jobs.agent.steplog import AttemptLog, loggable_value
from pilih_jobs.agent.submit import (
    SubmitIntentRefusedError,
    SubmitIntentUnavailableError,
    answer_payload,
    authorize,
    build_submit_payload,
    gate_problems,
    payload_hash,
    request_submit_intent,
    wait_for_approval,
)
from pilih_jobs.agent.types import AttemptContext, AttemptMode, AttemptResult
from pilih_jobs.agent.validate import (
    PlannedItem,
    PlanValidator,
    StagedSlot,
    ValidatedPlan,
    ValidationContext,
)
from pilih_jobs.agent.verify import VERDICT_RESULTS, Verdict, compute_verdict
from pilih_jobs.browser.actions import (
    Action,
    ClickRef,
    FillField,
    Scroll,
    SelectOption,
    SetCheckbox,
    UploadFile,
    WaitFor,
    action_name,
)
from pilih_jobs.browser.checkpoint import Checkpoint, write_checkpoint
from pilih_jobs.browser.controller import BrowserController
from pilih_jobs.browser.errors import (
    ActionRejectedError,
    ActionsDisabledError,
    ActionTimeoutError,
    ArtifactIntegrityError,
    BrowserCrashedError,
    BrowserError,
    CredentialFieldError,
    HeadedUnavailableError,
    LeaseLostError,
    NavigationBlockedError,
    NavigationTimeoutError,
    NetworkOfflineError,
    PageClosedError,
    PostconditionError,
    ProfileLockedError,
    StaleRefError,
    UploadPathError,
)
from pilih_jobs.browser.evidence import EvidenceRecorder, masked_screenshot, to_b64
from pilih_jobs.browser.executor import ActionExecutor, ActionResult
from pilih_jobs.browser.modes import decide_headless, headed_switch
from pilih_jobs.browser.observer import Observation, PageObserver, sha256_hex
from pilih_jobs.browser.profiles import select_apply_profile
from pilih_jobs.browser.session import PageSession
from pilih_jobs.browser.staging import StagedFile, UploadStager
from pilih_jobs.config import Config, load_config
from pilih_jobs.contracts.adapters import excluded_source_for_host
from pilih_jobs.contracts.ids import is_id, now_ms
from pilih_jobs.environment import has_display
from pilih_jobs.errors import ConfigError
from pilih_jobs.logging import bind, get_logger, log_event
from pilih_jobs.paths import resolve_paths
from pilih_jobs.policy.domains import DomainAllowlist, domain_of, url_host

log = get_logger("agent.loop")

CHOICE_CONFIDENCE: Final = 0.70
INJECTION_THRESHOLD: Final = 0.5
AUTO_PAGE_CONFIDENCE: Final = 0.85
STUCK_REPEATS: Final = 3
MAX_PREVIOUS_CLICKS: Final = 2
MAX_STALE_IN_A_ROW: Final = 3
MAX_APPROVAL_ROUNDS: Final = 3
MAX_PAGE_ITERATIONS: Final = 400
#: A killed browser closes its pages before its disconnect event arrives (18 §9): how long a
#: closed tab waits for that event before it counts as closed by the user.
BROWSER_DEATH_GRACE_S: Final = 1.5
FORM_KINDS: Final = frozenset({"application_form", "review_page"})
_HUMAN_PRIORITY: Final = (
    "credential_field",
    "protected_question",
    "missing_information",
    "generated_text",
    "unsupported_file_type",
    "low_confidence",
)


class AttemptEndError(Exception):
    """Ends the attempt with `result` (raised from anywhere inside the loop)."""

    def __init__(self, result: AttemptResult) -> None:
        super().__init__(result.outcome)
        self.result = result


class RestartFormError(Exception):
    """Relaunch / reopen the form from `apply_url` (crash recovery, headed switch)."""


@dataclass
class Classification:
    page_kind: str
    confidence: float
    injection: float | None
    deterministic: bool = False


@dataclass
class LoopState:
    step: int = 0
    submit_intent_at: int | None = None
    approval_id: str | None = None
    paused_any: bool = False
    injection_flag: bool = False
    form_steps_advanced: int = 0
    crash_relaunches: int = 0
    previous_clicks: int = 0
    negative_verdicts: int = 0
    approval_rounds: int = 0
    stale_in_a_row: int = 0
    nav_retries: int = 0
    last_change: float = field(default_factory=time.monotonic)
    last_form_hash: str | None = None
    seen_pages: dict[tuple[str, str], int] = field(default_factory=lambda: {})
    chosen: dict[tuple[str, str], int] = field(default_factory=lambda: {})
    validation_errors: dict[str, int] = field(default_factory=lambda: {})
    page_errors: int = 0
    classifications: dict[str, Classification] = field(default_factory=lambda: {})
    plans: dict[str, ValidatedPlan] = field(default_factory=lambda: {})
    replanned: set[str] = field(default_factory=lambda: set())
    applied: dict[str, str] = field(default_factory=lambda: {})
    user_signatures: set[str] = field(default_factory=lambda: set())
    uploaded: list[StagedFile] = field(default_factory=lambda: [])
    evidence: dict[str, Any] | None = None
    last_click: str | None = None


def _str(mapping: Any, key: str) -> str | None:
    if isinstance(mapping, dict):
        value = cast(dict[str, Any], mapping).get(key)
        return value if isinstance(value, str) and value else None
    return None


def _dict(mapping: Any, key: str) -> dict[str, Any]:
    if isinstance(mapping, dict):
        value = cast(dict[str, Any], mapping).get(key)
        if isinstance(value, dict):
            return cast(dict[str, Any], value)
    return {}


class AgentLoop:
    def __init__(self, ctx: AttemptContext) -> None:
        self.ctx = ctx
        self.options = ctx.options or AttemptOptions()
        self.channel = ctx.channel
        self.mode: AttemptMode = ctx.mode
        self.policy = PolicyEngine(ctx.mode)
        self.state = LoopState()
        self.budget = Budget()
        self.task_id = str(ctx.task.get("id") or "")
        self.log = AttemptLog(
            ctx.run_dir, attempt_id=ctx.attempt_id, task_id=self.task_id, lease_id=ctx.lease_id
        )
        self.checkpoint = Checkpoint(attempt_id=ctx.attempt_id, task_id=self.task_id)
        self.ai = AiClient(
            ctx.channel,
            task_id=self.task_id,
            lease_id=ctx.lease_id,
            budget=self.budget,
            log=self.log,
        )
        self.validator = PlanValidator()
        self.enumerator = CandidateEnumerator()
        context = ctx.context
        self.posting = _dict(context, "posting")
        self.application = _dict(context, "application")
        self.adapter = _dict(context, "adapter")
        self.approval_policy = _dict(context, "approval_policy")
        self.rule = _dict(context, "rule")
        self.apply_url = _str(self.posting, "apply_url") or ""
        self.company = _str(self.posting, "company_name") or ""
        self.allowlist = DomainAllowlist.from_claim_context(context)
        self.config = self._load_config()
        self.controller: BrowserController | None = None
        self.session: PageSession | None = None
        self.observer: PageObserver | None = None
        self.executor: ActionExecutor | None = None
        self.stager = UploadStager(ctx.run_dir, keep=self.options.keep_artifacts)
        self.slots: dict[str, StagedFile | None] = {"cv_file": None, "cover_letter_file": None}
        self.own_values: list[str] = []
        self._event_seq = 0
        self._background: set[asyncio.Task[Any]] = set()
        self.headless = True

    # ================================================================== setup
    def _load_config(self) -> Config:
        try:
            return load_config(resolve_paths()).config
        except (ConfigError, OSError):
            return Config()

    @property
    def data_dir(self) -> Path:
        return self.options.data_dir or resolve_paths().data_dir

    def _result(
        self,
        outcome: Literal["submitted", "failed", "cancelled", "outcome_unknown", "paused"],
        *,
        error_class: str | None = None,
        retryable: bool = False,
        pause_reason: str | None = None,
        submission_status: str | None = None,
        details: dict[str, Any] | None = None,
    ) -> AttemptResult:
        return AttemptResult(
            outcome=outcome,
            error_class=error_class,
            retryable=retryable,
            evidence=self.state.evidence,
            submission_status=submission_status,
            submit_intent_at=self.state.submit_intent_at,
            pause_reason=pause_reason,
            details=details,
        )

    def _end(self, outcome: Any, **kw: Any) -> AttemptEndError:
        return AttemptEndError(self._result(outcome, **kw))

    def _emit(self, event: str, **fields: Any) -> None:
        hook = self.options.on_event
        if hook is not None:
            with contextlib.suppress(Exception):
                hook(event, fields)

    async def _lease_event(self, kind: str, **fields: Any) -> None:
        """Queue a lease event (started/progress/paused/resumed/log) through the channel."""
        self._event_seq += 1
        item: dict[str, Any] = {
            "type": kind,
            "idempotency_key": f"{self.ctx.attempt_id}:ev:{self._event_seq}"[:128],
            "occurred_at": now_ms(),
            **fields,
        }
        try:
            await self.channel.events([item])
        except Exception as exc:
            if classify_channel_error(exc) == "lease_lost":
                raise LeaseLostError("The lease was lost.") from exc
            log_event(log, "lease_event_failed", kind=kind, error=type(exc).__name__)

    async def _progress(self, stage: str, message: str) -> None:
        self._emit("progress", stage=stage, step=self.state.step, message=message)
        await self._lease_event(
            "progress", progress={"stage": stage, "step": self.state.step, "message": message[:300]}
        )

    def _stop_check(self) -> None:
        """Called by the executor before every action (21 §5.3)."""
        if self.channel.lost.is_set():
            raise LeaseLostError("The lease was lost: stop acting.")

    def _write_checkpoint(self) -> None:
        cp = self.checkpoint
        cp.step = self.state.step
        cp.url = self.session.url if self.session else ""
        cp.applied_signatures = sorted(self.state.applied)
        cp.uploaded_sha256 = [f.sha256 for f in self.state.uploaded]
        cp.submit_intent_at = self.state.submit_intent_at
        cp.form_steps_advanced = self.state.form_steps_advanced
        with contextlib.suppress(OSError):
            write_checkpoint(self.ctx.run_dir, cp)

    # ================================================================== entry
    async def run(self) -> AttemptResult:
        started = time.monotonic()
        with bind(attempt_id=self.ctx.attempt_id, task_id=self.task_id, lease_id=self.ctx.lease_id):
            self.log.event(
                "attempt_started",
                mode=self.mode,
                dry_run=self.ctx.dry_run,
                adapter=self.adapter.get("id"),
                domain=domain_of(self.apply_url) if self.apply_url else None,
            )
            try:
                result = await self._run()
            except AttemptEndError as end:
                result = end.result
            except LeaseLostError:
                result = self._lease_lost_result()
            except BudgetExceededError:
                result = self._budget_result()
            except Exception as exc:  # noqa: BLE001 - last resort: never leave the browser running
                log_event(log, "attempt_crashed", error=type(exc).__name__, msg=str(exc)[:200])
                if self.state.submit_intent_at is not None:
                    result = self._result(
                        "outcome_unknown",
                        error_class="internal_error",
                        submission_status="outcome_unknown",
                    )
                else:
                    result = self._result("failed", error_class="internal_error", retryable=False)
            finally:
                await self._shutdown()
            if self.channel.lost.is_set() and result.error_class != "lease_lost":
                result = self._lease_lost_result()
            result.steps = self.executor.executed if self.executor else 0
            result.ai_calls = self.budget.ai_calls
            result.log_path = self.log.path
            if result.evidence is None:
                result.evidence = self.state.evidence
            if result.submit_intent_at is None:
                result.submit_intent_at = self.state.submit_intent_at
            self.log.event(
                "attempt_finished",
                outcome=result.outcome,
                error_class=result.error_class,
                pause_reason=result.pause_reason,
                steps=result.steps,
                ai_calls=result.ai_calls,
                duration_ms=int((time.monotonic() - started) * 1000),
            )
            return result

    def _lease_lost_result(self) -> AttemptResult:
        if self.state.submit_intent_at is not None:
            return self._result(
                "outcome_unknown",
                error_class="lease_lost",
                submission_status="outcome_unknown",
                details={"lease_lost": True},
            )
        return self._result(
            "failed", error_class="lease_lost", retryable=True, details={"lease_lost": True}
        )

    def _budget_result(self) -> AttemptResult:
        decision = self.policy.decide("budget_exceeded")
        if self.state.submit_intent_at is not None:
            return self._result(
                "outcome_unknown",
                error_class="budget_exceeded",
                submission_status="outcome_unknown",
            )
        if decision.kind == "stop":
            return self._result("failed", error_class="budget_exceeded")
        return self._result("paused", pause_reason="resource_exhausted")

    async def _shutdown(self) -> None:
        for task in list(self._background):
            task.cancel()
        if self.controller is not None:
            with contextlib.suppress(Exception):
                await self.controller.stop("attempt_end")
        self.stager.cleanup()
        self._write_checkpoint()

    async def _run(self) -> AttemptResult:
        self._precheck()
        await self._lease_event("started")
        await self._progress("preparing_cv", "Preparing files")
        await self._stage_files()
        await self._start_browser()
        await self._open()
        iterations = 0
        while True:
            iterations += 1
            if iterations > MAX_PAGE_ITERATIONS:
                raise self._end("failed", error_class="stuck_loop")
            try:
                await self._step()
            except RestartFormError:
                await self._open()

    # ================================================================== precheck
    def _precheck(self) -> None:
        """19 §10 (the client-repeatable part) + D-17 + Mode B refusal for auto."""
        if self.ctx.context.get("kind") not in (None, "apply"):
            raise self._end(
                "failed", error_class="precheck_failed", details={"reason": "not_apply"}
            )
        if not self.apply_url or url_host(self.apply_url) is None:
            raise self._end(
                "failed", error_class="precheck_failed", details={"reason": "apply_url"}
            )
        if excluded_source_for_host(self.apply_url) is not None:
            raise self._end("failed", error_class="prohibited_platform")
        if not self.allowlist.allows_url(self.apply_url):
            raise self._end("failed", error_class="domain_not_allowed")
        if self.posting.get("status") == "closed":
            raise self._end("failed", error_class="posting_closed")
        stage = self.application.get("stage")
        if stage is not None and stage not in ("saved", "preparing", "ready"):
            raise self._end(
                "failed", error_class="precheck_failed", details={"reason": f"stage:{stage}"}
            )
        if self.application.get("submission_status") in (
            "submitted_verified",
            "submitted_unverified",
        ):
            raise self._end(
                "failed", error_class="precheck_failed", details={"reason": "already_submitted"}
            )
        mode = self.options.browser_mode or self.config.browser.mode
        if self.mode == "auto" and mode == "connected":
            raise self._end("failed", error_class="mode_not_allowed")
        if self.mode == "auto" and not self.ctx.dry_run and not self.rule.get("id"):
            raise self._end(
                "failed",
                error_class="auto_precondition_failed",
                details={"auto_failures": ["no_active_rule"]},
            )

    # ================================================================== files
    async def _stage_files(self) -> None:
        context = self.ctx.context
        jobs: list[tuple[str, dict[str, Any]]] = []
        cv = _dict(_dict(context, "cv"), "file")
        if cv.get("file_id") and cv.get("sha256"):
            jobs.append(("cv_file", cv))
        cover = _dict(context, "cover_letter")
        if cover.get("file_id") and cover.get("sha256"):
            jobs.append(("cover_letter_file", cover))
        for slot, ref in jobs:
            try:
                staged = await self.stager.stage(
                    file_id=str(ref["file_id"]),
                    sha256=str(ref["sha256"]),
                    slot=cast(Any, slot),
                    company=self.company,
                    full_name=None,
                    download=self.channel.download_file,
                )
            except (ArtifactIntegrityError, UploadPathError) as exc:
                raise self._end("failed", error_class="artifact_integrity") from exc
            except Exception as exc:
                if classify_channel_error(exc) == "lease_lost":
                    raise LeaseLostError("The lease was lost.") from exc
                raise self._end("failed", error_class="files_unavailable", retryable=True) from exc
            self.slots[slot] = staged

    # ================================================================== browser
    def _browser_mode(self) -> Literal["managed", "connected", "persistent"]:
        return self.options.browser_mode or self.config.browser.mode

    async def _start_browser(self, *, headless: bool | None = None) -> None:
        mode = self._browser_mode()
        decision = decide_headless(
            task_kind="apply",
            mode=self.mode,
            requested_headed=self.ctx.headed,
            adapter_headless_ok=bool(self.adapter.get("headless_ok")),
        )
        want_headless = decision.headless if headless is None else headless
        if self.options.force_headless:
            want_headless = True
        if not want_headless and mode != "connected" and not has_display():
            raise self._end("paused", pause_reason="needs_headed_restart")
        self.headless = want_headless
        profile = self.options.profile or select_apply_profile(
            task_payload=_dict(self.ctx.task, "payload"),
            rule=self.rule,
            default=self.config.browser.default_profile,
        )
        channel = self.options.channel or self.config.browser.channel
        controller = BrowserController(
            data_dir=self.data_dir,
            task_id=self.task_id,
            host_resolver_rules=self.options.host_resolver_rules,
        )
        self.controller = controller
        await self._progress("opening", "Opening the application page")
        try:
            await controller.start(
                mode,
                profile,
                channel,
                want_headless,
                self.options.cdp_endpoint or self.config.browser.cdp_endpoint or None,
            )
        except ProfileLockedError as exc:
            raise self._end(
                "failed", error_class="profile_locked", details={"message": exc.message}
            ) from exc
        except HeadedUnavailableError as exc:
            raise self._end("paused", pause_reason="needs_headed_restart") from exc
        except BrowserError as exc:
            raise self._end(
                "failed",
                error_class=exc.error_class,
                retryable=exc.retryable,
                details={"message": exc.message},
            ) from exc
        await self._new_session()

    async def _new_session(self) -> None:
        controller = self.controller
        assert controller is not None  # noqa: S101 - set by _start_browser
        session = await controller.new_session(self.task_id, self.allowlist, self.apply_url)
        self.session = session
        self.observer = PageObserver(
            session,
            attempt_id=self.ctx.attempt_id,
            confirmation_selectors=[
                str(s) for s in cast(list[Any], self.adapter.get("confirmation_selectors") or [])
            ],
            own_values=self.own_values,
        )
        self.executor = ActionExecutor(
            session,
            self.observer,
            self.stager,
            stop_check=self._stop_check,
            prefer_file_chooser=self._browser_mode() != "connected",
            click_effect_timeout_s=self.options.click_effect_timeout_s,
        )

    async def _open(self) -> None:
        """Open apply_url (retry once after 5 s on timeout; pause while offline)."""
        session = self._session()
        self.state.classifications.clear()
        self.state.plans.clear()
        self.state.form_steps_advanced = 0
        offline_since: float | None = None
        retried = False
        while True:
            self._stop_check()
            try:
                await session.open_apply_url()
            except NavigationBlockedError as exc:
                raise self._end("failed", error_class="domain_not_allowed") from exc
            except NetworkOfflineError:
                offline_since = offline_since or time.monotonic()
                if time.monotonic() - offline_since >= self.options.network_offline_max_s:
                    raise self._end("paused", pause_reason="network_offline") from None
                await self._lease_event(
                    "paused", pause_reason="network_offline", message="The network is offline."
                )
                await asyncio.sleep(self.options.network_offline_poll_s)
            except NavigationTimeoutError as exc:
                if retried:
                    raise self._end(
                        "failed", error_class="navigation_timeout", retryable=True
                    ) from exc
                retried = True
                await asyncio.sleep(self.options.navigation_retry_delay_s)
            except (BrowserCrashedError, PageClosedError) as exc:
                await self._on_broken(exc)
                session = self._session()
            else:
                self.state.last_change = time.monotonic()
                return

    def _session(self) -> PageSession:
        if self.session is None:
            raise BrowserCrashedError("No browser session.")
        return self.session

    def _observer(self) -> PageObserver:
        if self.observer is None:
            raise BrowserCrashedError("No browser session.")
        return self.observer

    def _executor(self) -> ActionExecutor:
        if self.executor is None:
            raise BrowserCrashedError("No browser session.")
        return self.executor

    async def _browser_died(self) -> bool:
        """True when the browser itself went away (crash / kill), not just the tab."""
        deadline = time.monotonic() + BROWSER_DEATH_GRACE_S
        while True:
            controller, session = self.controller, self.session
            if (controller is not None and controller.disconnected) or (
                session is not None and session.crashed
            ):
                return True
            if time.monotonic() >= deadline:
                return False
            await asyncio.sleep(0.05)

    async def _on_broken(self, exc: BaseException) -> None:
        """18 §9: crash → relaunch once before submit_intent; user close → cancel."""
        if isinstance(exc, PageClosedError) and await self._browser_died():
            exc = BrowserCrashedError("The browser died; its tab closed first.")
        if isinstance(exc, PageClosedError):
            if self.state.submit_intent_at is not None:
                raise self._end(
                    "outcome_unknown",
                    error_class="page_closed",
                    submission_status="outcome_unknown",
                    details={"message": "Did you submit it?"},
                ) from exc
            raise self._end(
                "cancelled", error_class="cancelled", details={"reason": "tab_closed"}
            ) from exc
        if self.state.submit_intent_at is not None:
            raise self._end(
                "outcome_unknown",
                error_class="browser_crashed",
                submission_status="outcome_unknown",
            ) from exc
        decision = self.policy.decide("browser_crash_before_intent")
        if (
            self.state.crash_relaunches >= 1
            or decision.kind != "relaunch"
            or self.controller is None
        ):
            raise self._end("failed", error_class="browser_crashed", retryable=True) from exc
        self.state.crash_relaunches += 1
        log_event(log, "browser_relaunch", reason=type(exc).__name__)
        try:
            await self.controller.relaunch()
        except BrowserError as relaunch_exc:
            raise self._end(
                "failed", error_class="browser_crashed", retryable=True
            ) from relaunch_exc
        await self._new_session()

    # ================================================================== step
    async def _guards(self) -> None:
        self._stop_check()
        if self.channel.cancel_requested.is_set() and self.state.submit_intent_at is None:
            raise self._end(
                "cancelled", error_class="cancelled", details={"reason": "cancel_requested"}
            )
        if self.budget.ai_calls >= self.budget.max_ai_calls or self.budget.exceeded():
            raise BudgetExceededError(self.budget.exceeded() or "ai_calls")
        if time.monotonic() - self.state.last_change > self.options.idle_timeout_s:
            raise self._end("failed", error_class="page_idle_timeout", retryable=True)
        if self.controller is not None and self.state.step % 10 == 9:
            health = await self.controller.health()
            if health.memory_exceeded:
                raise self._end("paused", pause_reason="resource_exhausted")

    async def _observe(self) -> Observation:
        observer = self._observer()
        try:
            obs = await observer.observe(step=self.state.step)
        except (BrowserCrashedError, PageClosedError) as exc:
            await self._on_broken(exc)
            raise RestartFormError from exc
        if obs.form_hash != self.state.last_form_hash:
            self.state.last_form_hash = obs.form_hash
            self.state.last_change = time.monotonic()
        self.log.event("observation", step=self.state.step, **obs.log_summary())
        return obs

    async def _step(self) -> None:
        await self._guards()
        session = self._session()
        try:
            session.raise_if_broken()
        except (BrowserCrashedError, PageClosedError) as exc:
            await self._on_broken(exc)
            raise RestartFormError from exc
        obs = await self._observe()
        self.state.step += 1
        if session.pending_dialog is not None:
            message = session.pending_dialog
            session.pending_dialog = None
            await self._pause("unclear_page", f"The page asked: {message[:200]}", obs)
            return
        if not obs.allowlisted:
            await self._off_domain(obs)
            return
        if obs.challenge is not None:
            await self._pause(
                obs.challenge.reason, self._challenge_message(obs.challenge.reason), obs
            )
            return
        if observation_injection(obs) and not self.state.injection_flag:
            self.state.injection_flag = True
            log_event(log, "injection_heuristic")
            if self.policy.decide("injection_suspected").kind == "stop":
                raise self._end(
                    "failed", error_class="injection_suspected", details={"back_to_approval": True}
                )
        classification = await self._classify(obs)
        if classification is None:
            return
        kind = classification.page_kind
        if kind == "confirmation":
            await self._confirmation_without_submit(obs)
            return
        plan: ValidatedPlan | None = None
        if kind in FORM_KINDS:
            plan = await self._plan(obs)
            if plan is None:
                return
            if await self._resolve_needs_human(obs, plan):
                return
            if await self._handle_errors(obs, plan):
                return
        await self._act(obs, classification, plan)

    # ================================================================== classification
    def _deterministic_confirmation(self, obs: Observation) -> bool:
        patterns = [
            str(p) for p in cast(list[Any], self.adapter.get("confirmation_url_patterns") or [])
        ]
        recorder = EvidenceRecorder(
            self._session(),
            self._observer(),
            confirmation_url_patterns=patterns,
            own_values=[],
            submitted_signatures=set(),
            submit_signature=None,
        )
        no_fields = not obs.application_fields()
        return recorder.url_matches(obs.url) or (
            no_fields
            and (any(obs.confirm_hits.values()) or "thank you for applying" in obs.raw_text.lower())
        )

    async def _classify(self, obs: Observation) -> Classification | None:
        key = f"{obs.url.split('#', 1)[0]}|{obs.structure_hash}"
        cached = self.state.classifications.get(key)
        if cached is not None:
            return cached
        if self._deterministic_confirmation(obs):
            result = Classification("confirmation", 1.0, None, deterministic=True)
            self.state.classifications[key] = result
            return result
        await self._progress("inspecting", "Reading the page")
        contract = obs.to_contract()
        shot = await masked_screenshot(self._session())
        contract["screenshot_jpeg_b64"] = to_b64(shot)
        try:
            response = await self.ai.classify(contract, step=self.state.step)
        except AiUnavailableError:
            await self._pause("ai_unavailable", "AI decisions are unavailable right now.", obs)
            return None
        except AiOfflineError:
            await self._pause("network_offline", "The network is offline.", obs)
            return None
        if response.refused:
            await self._pause("unclear_page", "The page could not be classified.", obs)
            return None
        injection = response.injection_suspected.root if response.injection_suspected else None
        if injection is not None and injection >= INJECTION_THRESHOLD:
            self.state.injection_flag = True
            if self.policy.decide("injection_suspected").kind == "stop":
                raise self._end(
                    "failed", error_class="injection_suspected", details={"back_to_approval": True}
                )
        result = Classification(response.page_kind, response.confidence, injection)
        if response.confidence < CHOICE_CONFIDENCE:
            await self._pause("low_confidence", "The page is ambiguous.", obs)
            return None
        handled = await self._page_kind_policy(obs, result)
        if handled:
            return None
        self.state.classifications[key] = result
        return result

    async def _page_kind_policy(self, obs: Observation, cls: Classification) -> bool:
        """19 §4.2 result handling; True when the step is over."""
        kind = cls.page_kind
        if kind in ("captcha_or_challenge", "login_required", "account_creation_required"):
            await self._pause(kind, self._challenge_message(kind), obs)
            return True
        if kind == "error_page":
            error_class = "posting_unavailable" if obs.http_status in (404, 410) else "page_error"
            raise self._end("failed", error_class=error_class)
        if kind == "email_instructions":
            email = self._extract_email(obs)
            raise self._end(
                "failed",
                error_class="email_application_required",
                details={"email": email, "application_support": "email"},
            )
        if kind in ("external_redirect", "unrelated"):
            decision = self.policy.decide("external_redirect")
            if decision.kind == "stop":
                raise self._end("failed", error_class=decision.error_class or "domain_not_allowed")
            await self._pause(
                "off_domain_navigation", "This page is not part of the application.", obs
            )
            return True
        if kind == "other":
            await self._pause("unclear_page", "The page needs your judgment.", obs)
            return True
        return False

    @staticmethod
    def _extract_email(obs: Observation) -> str | None:
        match = re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}", obs.raw_text)
        return match.group(0) if match else None

    @staticmethod
    def _challenge_message(reason: str) -> str:
        return {
            "captcha_or_challenge": "A human-verification check needs you",
            "login_required": "Sign-in required",
            "account_creation_required": "An account must be created",
            "mfa_required": "A verification code is needed",
            "credential_field": "The page asks for a password or code",
            "payment_requested": "The page asks for a payment",
        }.get(reason, "Your input is needed")

    # ================================================================== field plan
    def _validation_context(self) -> ValidationContext:
        slots = {
            name: StagedSlot(file_id=staged.file_id, name=staged.name) if staged else None
            for name, staged in self.slots.items()
        }
        return ValidationContext(
            mode=self.mode,
            generated_text_allowed=bool(self.approval_policy.get("generated_text_allowed")),
            slots=slots,
            applied=self.state.applied,
        )

    async def _plan(self, obs: Observation, *, attempt: int = 1) -> ValidatedPlan | None:
        cached = self.state.plans.get(obs.structure_hash)
        if cached is not None and attempt == 1:
            self._refresh_plan(cached, obs)
            return cached
        await self._progress("filling", "Planning the answers")
        try:
            plan = await self.ai.field_plan(
                obs.to_contract(),
                step=self.state.step,
                fact_keys=None,
                file_slots={k: v is not None for k, v in self.slots.items()},
                attempt=attempt,
            )
        except AiUnavailableError:
            await self._pause("ai_unavailable", "AI decisions are unavailable right now.", obs)
            return None
        except AiOfflineError:
            await self._pause("network_offline", "The network is offline.", obs)
            return None
        validated = self.validator.validate(
            plan.model_dump(mode="json"), obs, self._validation_context()
        )
        if cached is not None:
            self._merge_replan(cached, validated)
            validated = cached
        self._remember_own_values(validated)
        self.state.plans[obs.structure_hash] = validated
        self.log.event("plan_validated", step=self.state.step, **validated.counts())
        return validated

    def _refresh_plan(self, plan: ValidatedPlan, obs: Observation) -> None:
        """Fields the human changed during a pause are theirs (user_touched → skip)."""
        for item in plan.items:
            f = obs.field(item.ref)
            if f is not None and f.user_touched and item.status in ("pending", "needs_human"):
                item.status, item.note = "skipped", "user_touched"

    def _merge_replan(self, old: ValidatedPlan, new: ValidatedPlan) -> None:
        """A re-plan (attempt 2) replaces only the items of fields with errors."""
        for item in new.items:
            previous = old.by_ref(item.ref)
            if previous is None:
                old.items.append(item)
                continue
            if previous.status != "failed":
                continue
            same = (item.option_value or item.value) == (previous.option_value or previous.value)
            if item.status == "pending" and not same:
                old.items[old.items.index(previous)] = item
            else:
                previous.status, previous.human_reason = "needs_human", "missing_information"
                previous.note = "validation"

    def _remember_own_values(self, plan: ValidatedPlan) -> None:
        """The applicant's name / email / phone (in memory only): redacted from excerpts,
        and the name gives the staged files their presentable names (18 §7.1)."""
        values: dict[str, str] = {}
        for item in plan.items:
            if item.fact_key and item.fact_key.startswith("contact.") and item.value:
                values[item.fact_key] = item.value
        for key in (
            "contact.full_name",
            "contact.first_name",
            "contact.last_name",
            "contact.email",
            "contact.phone",
        ):
            value = values.get(key)
            if value and value not in self.own_values:
                self.own_values.append(value)
        full_name = values.get("contact.full_name") or " ".join(
            v for v in (values.get("contact.first_name"), values.get("contact.last_name")) if v
        )
        if not full_name:
            return
        uploaded = {u.file_id for u in self.state.uploaded}
        for slot, staged in list(self.slots.items()):
            if staged is not None and staged.file_id not in uploaded:
                with contextlib.suppress(BrowserError, OSError):
                    self.slots[slot] = self.stager.rename_for(
                        staged.file_id, full_name=full_name, company=self.company
                    )

    # ================================================================== needs human
    async def _resolve_needs_human(self, obs: Observation, plan: ValidatedPlan) -> bool:
        """19 §6.5 / §8.1: True when the step is over (paused, approved, skipped …)."""
        open_items = [i for i in plan.needs_human if obs.field(i.ref) is not None]
        if not open_items:
            return False
        stops: list[str] = []
        pauses: list[PlannedItem] = []
        approvals: list[PlannedItem] = []
        for item in open_items:
            situation = self._situation(item)
            decision = self.policy.decide(situation)
            if decision.kind == "stop":
                stops.append(decision.error_class or "missing_information")
            elif decision.kind == "skip":
                item.status, item.note = "skipped", "optional_auto"
            elif decision.kind == "act":
                item.status = "pending"
            elif decision.kind == "approval":
                approvals.append(item)
            else:
                pauses.append(item)
        if stops:
            error_class = "protected_question" if "protected_question" in stops else stops[0]
            raise self._end(
                "failed",
                error_class=error_class,
                details={"back_to_approval": True, "fields": len(stops)},
            )
        if pauses:
            reason = self._pause_reason_for(pauses)
            await self._pause(reason, f"{len(pauses)} question(s) need you on this page", obs)
            for item in pauses:
                last = self._observer().last
                f = last.field(item.ref) if last is not None else None
                if f is not None and (f.user_touched or f.has_value):
                    item.status, item.note = "skipped", "answered_by_user"
            return True
        if approvals:
            await self._answer_approval(obs, approvals)
            return True
        return False

    def _situation(self, item: PlannedItem) -> Any:
        reason = item.human_reason or "missing_information"
        if reason == "credential_field":
            return "credential_field"
        if reason == "protected_question":
            return "protected_question"
        if reason == "generated_text":
            return "generated_text_required" if item.required else "generated_text_optional"
        return "needs_human_required" if item.required else "needs_human_optional"

    @staticmethod
    def _pause_reason_for(items: list[PlannedItem]) -> str:
        reasons = {i.human_reason or "missing_information" for i in items}
        for reason in _HUMAN_PRIORITY:
            if reason in reasons:
                if reason in ("generated_text", "unsupported_file_type", "low_confidence"):
                    return "missing_information" if reason != "low_confidence" else "low_confidence"
                return reason
        return "missing_information"

    async def _answer_approval(self, obs: Observation, items: list[PlannedItem]) -> None:
        payload = answer_payload(
            items, obs, self.ctx.attempt_id if is_id("att", self.ctx.attempt_id) else ""
        )
        if not payload.get("attempt_id"):
            payload.pop("attempt_id", None)
        if not payload["questions"]:
            await self._pause("missing_information", "Questions need you on this page", obs)
            return
        digest = payload_hash(payload)
        await self._progress("awaiting_approval", "Waiting for your answers")
        try:
            record = await self.channel.create_approval("answer", payload, digest)
        except Exception as exc:
            kind = classify_channel_error(exc)
            if kind == "lease_lost":
                raise LeaseLostError("The lease was lost.") from exc
            await self._pause("missing_information", "Questions need you on this page", obs)
            return
        approval_id = str(record.get("id") or "")
        self.state.paused_any = True
        self.log.event(
            "approval_requested",
            step=self.state.step,
            kind="answer",
            approval_id=approval_id,
            questions=len(items),
        )
        self._maybe_decide_in_cli(record)
        outcome = await wait_for_approval(
            self.channel,
            approval_id,
            poll_s=self.options.approval_poll_s,
            timeout_s=self.options.approval_timeout_s,
            on_tick=self._stop_check,
        )
        self.log.event("approval_decided", step=self.state.step, kind="answer", state=outcome.state)
        if outcome.state == "cancelled":
            raise self._end(
                "cancelled", error_class="cancelled", details={"reason": "cancel_requested"}
            )
        if outcome.state in ("rejected", "expired"):
            error_class = f"approval_{outcome.state}"
            raise self._end("cancelled", error_class=error_class, details={"reason": error_class})
        self._apply_answers(obs, items, outcome.record)

    def _apply_answers(
        self, obs: Observation, items: list[PlannedItem], record: dict[str, Any]
    ) -> None:
        response = _dict(record, "response")
        answers: dict[str, str] = {}
        for answer in cast(list[Any], response.get("answers") or []):
            entry = cast(dict[str, Any], answer) if isinstance(answer, dict) else {}
            ref, value = entry.get("ref"), entry.get("value")
            if isinstance(ref, str) and isinstance(value, str):
                answers[ref] = value
        for item in items:
            f = obs.field(item.ref)
            value = answers.get(item.ref)
            if (value is None or value == "(your saved answer)") and item.suggestion is not None:
                value = item.suggestion
                item.value_source = (
                    item.value_source
                    if item.value_source in ("fact", "answer", "option")
                    else "answer"
                )
            else:
                item.value_source = "user"
                self.state.user_signatures.add(item.signature)
            if (
                f is None
                or value is None
                or not value.strip()
                or item.human_reason == "credential_field"
            ):
                item.status = "needs_human" if item.required else "skipped"
                continue
            self._set_answer(item, f, value)

    @staticmethod
    def _set_answer(item: PlannedItem, f: Any, value: str) -> None:
        from pilih_jobs.agent.validate import _option_match  # pyright: ignore[reportPrivateUsage]

        kind = f.kind
        item.status, item.human_reason = "pending", None
        if kind in ("select", "radio_group", "checkbox_group", "combobox") and f.options:
            matched = _option_match(f, value)
            if matched is None:
                item.status = "needs_human" if item.required else "skipped"
                return
            item.action, item.option_value = "select", matched
            return
        if kind == "checkbox":
            yes = value.strip().lower() in ("yes", "true", "1", "y", "ya", "checked", "on")
            item.action = "check" if yes else "uncheck"
            return
        if kind == "file":
            item.status = "needs_human" if item.required else "skipped"
            return
        item.action, item.value, item.option_value = "fill", value[:4000], None

    def _maybe_decide_in_cli(self, record: dict[str, Any]) -> None:
        hook = self.options.decide_in_cli
        if hook is None or not (self.ctx.approve_in_cli or self.ctx.interactive):
            return
        task = asyncio.ensure_future(hook(record))
        self._background.add(task)
        task.add_done_callback(self._background.discard)

    # ================================================================== errors
    async def _handle_errors(self, obs: Observation, plan: ValidatedPlan) -> bool:
        """18 §7.3: retry an errored field once (re-plan), then pause / stop."""
        if not obs.errors or plan.pending([f.ref for f in obs.fields]):
            return False
        refs = {str(e.get("ref")) for e in obs.errors if e.get("ref")}
        repeated = False
        replan = False
        for ref in refs:
            f = obs.field(ref)
            if f is None:
                continue
            count = self.state.validation_errors.get(f.signature, 0) + 1
            self.state.validation_errors[f.signature] = count
            item = plan.by_ref(ref)
            if count >= 2 or item is None or (item.status in ("skipped",) and f.user_touched):
                repeated = repeated or count >= 2
                if item is None and count < 2:
                    repeated = True
                continue
            item.status = "failed"
            replan = True
        if not refs:
            self.state.page_errors += 1
            if self.state.page_errors < 2:
                return False
            repeated = True
        if repeated:
            decision = self.policy.decide("validation_repeated")
            if decision.kind == "stop":
                raise self._end(
                    "failed", error_class=decision.error_class or "validation_errors_unresolved"
                )
            await self._pause("validation_unresolved", "The form rejected some answers.", obs)
            return True
        if replan and obs.structure_hash not in self.state.replanned:
            self.state.replanned.add(obs.structure_hash)
            await self._plan(obs, attempt=2)
            return True
        return False

    # ================================================================== off-domain
    async def _off_domain(self, obs: Observation) -> None:
        host = url_host(obs.url)
        domain = domain_of(obs.url) or (host or "?")
        if host is not None and excluded_source_for_host(host) is not None:
            raise self._end("failed", error_class="prohibited_platform")
        decision = self.policy.decide("external_redirect")
        if decision.kind == "stop":
            raise self._end("failed", error_class="domain_not_allowed", details={"domain": domain})
        if self.options.allow_domain is not None and host is not None:
            allowed = await self.options.allow_domain(domain)
            if allowed and self.allowlist.add_for_task(domain):
                self.state.classifications.clear()
                return
        if host is None:
            await self._pause("off_domain_navigation", "The page left the application site.", obs)
            return
        resumed = await self._pause(
            "off_domain_navigation", f"Allow {domain} for this application?", obs
        )
        if resumed:
            self.allowlist.add_for_task(domain)

    # ================================================================== pause
    async def _pause(self, reason: str, message: str, obs: Observation | None) -> bool:
        """18 §8 pause mechanics; returns True when the user resumed."""
        decision = self.policy.decide_pause(reason)
        if self.state.submit_intent_at is not None:
            if self.state.negative_verdicts > 0:
                # The form rejected the submission (negative evidence) and needs a human.
                raise self._end(
                    "failed", error_class="validation_errors_unresolved", submission_status="failed"
                )
            raise self._end(
                "outcome_unknown", error_class=reason, submission_status="outcome_unknown"
            )
        if decision.kind == "stop":
            raise self._end(
                "failed",
                error_class=decision.error_class or reason,
                details={"back_to_approval": decision.back_to_approval, "reason": reason},
            )
        if reason == "resource_exhausted":
            raise self._end("paused", pause_reason=reason)
        await self._maybe_switch_headed(reason)
        self.state.paused_any = True
        self.checkpoint.paused_reason = reason
        self._write_checkpoint()
        observer = self._observer()
        before = observer.snapshot_values(obs) if obs is not None else {}
        await self._lease_event("paused", pause_reason=reason, message=message[:300])
        self.log.event("pause_started", step=self.state.step, reason=reason)
        self._emit("paused", reason=reason, message=message)
        await self._session().bring_to_front()
        timeout = self.options.pause_timeout_s
        if self.headless and self.options.prompt_pause is None:
            timeout = min(timeout, self.options.headless_pause_timeout_s)
        answer = await self._wait_human(reason, message, timeout)
        self.log.event("pause_resolved", step=self.state.step, reason=reason, answer=answer)
        if answer == "timeout":
            if reason == "payment_requested":
                raise self._end("failed", error_class="payment_requested")
            raise self._end("paused", pause_reason=reason, details={"message": message[:300]})
        if answer in ("stop", "cancel"):
            raise self._end(
                "cancelled", error_class="cancelled", details={"reason": "user_requested"}
            )
        await self._lease_event("resumed")
        self.checkpoint.paused_reason = None
        self.state.classifications.clear()
        self.state.last_change = time.monotonic()
        with contextlib.suppress(BrowserError):
            after = await observer.observe(step=self.state.step, with_snapshot=False)
            touched = observer.mark_user_touched(before, after)
            self.state.user_signatures.update(touched)
            for plan in self.state.plans.values():
                self._refresh_plan(plan, after)
            if answer == "skip":
                for plan in self.state.plans.values():
                    for item in plan.items:
                        if item.status == "needs_human" and not item.required:
                            item.status, item.note = "skipped", "user_skipped"
        return True

    async def _wait_human(self, reason: str, message: str, timeout: float) -> str:
        channel = self.channel
        channel.resume_requested.clear()
        waiters: dict[asyncio.Task[Any], str] = {
            asyncio.ensure_future(channel.resume_requested.wait()): "resume",
            asyncio.ensure_future(channel.cancel_requested.wait()): "cancel",
            asyncio.ensure_future(channel.lost.wait()): "lost",
            asyncio.ensure_future(self._watch_page()): "closed",
        }
        if self.options.prompt_pause is not None:
            prompt = PausePrompt(
                reason=reason,
                message=message,
                company=self.company,
                domain=domain_of(self.apply_url) or "",
                headed=not self.headless,
            )
            waiters[asyncio.ensure_future(self.options.prompt_pause(prompt))] = "prompt"
        try:
            done, _pending = await asyncio.wait(
                set(waiters), timeout=timeout, return_when=asyncio.FIRST_COMPLETED
            )
        finally:
            for task in waiters:
                if not task.done():
                    task.cancel()
        if not done:
            return "timeout"
        task = next(iter(done))
        kind = waiters[task]
        if kind == "lost":
            raise LeaseLostError("The lease was lost during a pause.")
        if kind == "closed":
            session = self.session
            broken: BrowserError = (
                BrowserCrashedError("The browser crashed during a pause.")
                if session is not None and session.crashed and not session.closed_by_user
                else PageClosedError("The application tab was closed.")
            )
            await self._on_broken(broken)  # cancels, or relaunches once before submit_intent
            raise RestartFormError
        if kind == "prompt":
            answer = cast(PauseAnswer, task.result()) if not task.cancelled() else "resume"
            return answer if answer in ("resume", "skip", "stop") else "resume"
        if kind == "resume":
            channel.resume_requested.clear()
        return kind

    async def _watch_page(self) -> None:
        while True:
            session = self.session
            if session is not None and (session.closed_by_user or session.crashed):
                return
            await asyncio.sleep(0.25)

    async def _maybe_switch_headed(self, reason: str) -> None:
        """18 §5 headless→headed switch when a human is needed."""
        if not self.headless or self._browser_mode() == "connected" or self.options.force_headless:
            return
        human_reachable = self.ctx.interactive or self.options.prompt_pause is not None
        decision = headed_switch(
            headless=self.headless,
            submit_intent_recorded=self.state.submit_intent_at is not None,
            display_available=has_display(),
            human_reachable=human_reachable,
            form_steps_advanced=self.state.form_steps_advanced,
            url_allowlisted=self._session().actions_enabled,
        )
        if decision.action == "pause_needs_headed_restart":
            raise self._end(
                "paused", pause_reason="needs_headed_restart", details={"reason": reason}
            )
        if decision.action != "relaunch_headed" or self.controller is None:
            return
        # Close the headless context, reopen the same profile headed, re-enter apply_url
        # and replay the plan from a fresh field-plan call (the CLI caches no facts).
        log_event(log, "headed_switch", reason=reason)
        await self.controller.relaunch(headless=False)
        self.headless = False
        await self._new_session()
        raise RestartFormError

    # ================================================================== act
    async def _act(self, obs: Observation, cls: Classification, plan: ValidatedPlan | None) -> None:
        review = cls.page_kind == "review_page"
        ctx = EnumerationContext(
            page_kind=cls.page_kind,
            plan=plan,
            allow_cookie_accept=self.options.allow_cookie_accept,
            previous_allowed=self._previous_allowed(obs),
            review_page=review,
        )
        candidates = self.enumerator.enumerate(obs, ctx)
        choice = choose_deterministic(candidates, obs, ctx)
        if choice is None:
            choice = await self._ai_choice(obs, cls, candidates)
            if choice is None:
                return
        if choice.type == "pause_for_human":
            await self._pause(choice.reason or "unclear_page", choice.message or "", obs)
            return
        if choice.type == "stop":
            raise self._end("failed", error_class=choice.error_class or "unsupported_form")
        if self._repeated(obs, choice):
            await self._pause("stuck_loop", "The page is not moving forward.", obs)
            return
        if choice.type == "click_ref" and choice.role_hint == "submit":
            await self._submit_gate(obs, choice, cls)
            return
        await self._execute(choice, obs, plan)

    def _previous_allowed(self, obs: Observation) -> bool:
        return (
            self.state.previous_clicks < MAX_PREVIOUS_CLICKS
            and self.state.form_steps_advanced > 0
            and bool(obs.errors)
            and not any(e.get("ref") for e in obs.errors)
        )

    def _repeated(self, obs: Observation, choice: Candidate) -> bool:
        if choice.type not in ("click_ref", "scroll", "wait_for"):
            return False
        key = (
            obs.form_hash,
            choice.signature or f"{choice.type}:{choice.direction or choice.condition}",
        )
        self.state.chosen[key] = self.state.chosen.get(key, 0) + 1
        return self.state.chosen[key] >= STUCK_REPEATS

    async def _ai_choice(
        self, obs: Observation, cls: Classification, candidates: list[Candidate]
    ) -> Candidate | None:
        offered = [c for c in candidates if c.type != "pause_for_human"][:38]
        if not offered:
            await self._pause("unclear_page", "No safe action leads forward on this page.", obs)
            return None
        required_remaining = sum(
            1 for f in obs.fields if f.required and not f.has_value and f.input_type != "password"
        )
        try:
            response = await self.ai.next_action(
                observation_id=obs.observation_id,
                step=self.state.step,
                page_kind=cls.page_kind,
                state={
                    "required_remaining": required_remaining,
                    "errors": len(obs.errors),
                    "form_hash": obs.form_hash,
                },
                candidates=[c.to_contract() for c in offered],
            )
        except AiUnavailableError:
            await self._pause("ai_unavailable", "AI decisions are unavailable right now.", obs)
            return None
        except AiOfflineError:
            await self._pause("network_offline", "The network is offline.", obs)
            return None
        confidence = response.confidence.root if response.confidence is not None else None
        if response.refused:
            await self._pause("unclear_page", "The next step is unclear.", obs)
            return None
        if response.choice == "pause":
            await self._pause("unclear_page", "The page needs your judgment.", obs)
            return None
        if confidence is None or confidence < CHOICE_CONFIDENCE:
            await self._pause("low_confidence", "The next step is uncertain.", obs)
            return None
        if response.choice == "stop":
            decision = self.policy.decide("unclear_page")
            if decision.kind == "stop":
                raise self._end("failed", error_class="unsupported_form")
            await self._pause("unclear_page", "This page cannot lead to the application.", obs)
            return None
        chosen = next((c for c in offered if c.id == response.choice), None)
        if chosen is None:
            # Not one of the supplied values (19 §5.3 rule 1): never act on it.
            await self._pause("unclear_page", "The AI answer was not one of the options.", obs)
            return None
        if (
            chosen.type == "click_ref"
            and cls.page_kind == "review_page"
            and chosen.role_hint == "next"
        ):
            chosen.role_hint = "submit"
        return chosen

    def _action_for(
        self, choice: Candidate, plan: ValidatedPlan | None
    ) -> tuple[Action, PlannedItem | None]:
        if choice.type == "click_ref":
            return ClickRef(ref=str(choice.ref), role_hint=cast(Any, choice.role_hint)), None
        if choice.type == "scroll":
            return Scroll(ref=choice.ref, direction=choice.direction or "down"), None
        if choice.type == "wait_for":
            return WaitFor(
                condition=choice.condition or "network_idle", timeout_ms=choice.timeout_ms or 5_000
            ), None
        item = plan.by_ref(str(choice.ref)) if plan is not None else None
        if item is None or not item.executable:
            raise ActionRejectedError("The plan item is gone.", reason="no_plan_item")
        if item.action == "upload":
            return UploadFile(ref=item.ref, file_id=str(item.file_id)), item
        if item.action == "fill":
            return FillField(
                ref=item.ref, value=str(item.value), value_source=item.value_source
            ), item
        if item.action == "select":
            return SelectOption(ref=item.ref, option_value=str(item.option_value)), item
        if item.action in ("check", "uncheck"):
            if item.kind in ("checkbox_group", "radio_group"):
                return SelectOption(ref=item.ref, option_value=str(item.option_value)), item
            return SetCheckbox(ref=item.ref, checked=item.action == "check"), item
        raise ActionRejectedError("Unknown plan action.", reason="no_plan_item")

    async def _execute(
        self, choice: Candidate, obs: Observation, plan: ValidatedPlan | None
    ) -> None:
        executor = self._executor()
        action, item = self._action_for(choice, plan)
        self.budget.charge_action()
        self._emit("action", type=action_name(action), ref=getattr(action, "ref", None))
        try:
            result = await executor.execute(action, obs)
        except LeaseLostError:
            raise
        except CredentialFieldError:
            if item is not None:
                item.status, item.human_reason = "needs_human", "credential_field"
            await self._pause("credential_field", "The page asks for a password or code.", obs)
            return
        except ActionsDisabledError:
            await self._off_domain(obs)
            return
        except StaleRefError as exc:
            self._log_failed(action, item, obs, exc.reason)
            self.state.stale_in_a_row += 1
            if self.state.stale_in_a_row >= MAX_STALE_IN_A_ROW:
                await self._pause("unclear_page", "The page keeps changing.", obs)
            return
        except PostconditionError as exc:
            self._log_failed(action, item, obs, exc.check)
            if item is not None:
                item.status, item.attempts = "failed", item.attempts + 1
                count = self.state.validation_errors.get(item.signature, 0) + 1
                self.state.validation_errors[item.signature] = count
                if count >= 2:
                    decision = self.policy.decide("validation_repeated")
                    if decision.kind == "stop":
                        raise self._end(
                            "failed", error_class="validation_errors_unresolved"
                        ) from exc
                    await self._pause(
                        "validation_unresolved", "A field keeps rejecting its value.", obs
                    )
                elif obs.structure_hash not in self.state.replanned:
                    self.state.replanned.add(obs.structure_hash)
                    await self._plan(obs, attempt=2)
            return
        except (UploadPathError, ArtifactIntegrityError) as exc:
            self._log_failed(action, item, obs, exc.error_class)
            raise self._end("failed", error_class=exc.error_class) from exc
        except ActionTimeoutError:
            self._log_failed(action, item, obs, "timeout")
            if item is not None:
                item.attempts += 1
                if item.attempts >= 2:
                    item.status, item.human_reason = "needs_human", "missing_information"
            return
        except ActionRejectedError as exc:
            self._log_failed(action, item, obs, exc.reason)
            if exc.reason == "target_off_allowlist":
                decision = self.policy.decide("external_redirect")
                if decision.kind == "stop":
                    raise self._end("failed", error_class="domain_not_allowed") from exc
                await self._pause(
                    "off_domain_navigation", "A button leads off the application site.", obs
                )
                return
            if item is not None:
                item.status = "needs_human" if item.required else "skipped"
                item.human_reason = (
                    "unsupported_file_type"
                    if exc.reason == "unsupported_file_type"
                    else "missing_information"
                )
            return
        except (BrowserCrashedError, PageClosedError) as exc:
            await self._on_broken(exc)
            raise RestartFormError from exc
        self.state.stale_in_a_row = 0
        await self._after_action(action, item, result, obs)

    async def _after_action(
        self, action: Action, item: PlannedItem | None, result: ActionResult, obs: Observation
    ) -> None:
        if item is not None:
            item.status = "done"
            self.state.applied[item.signature] = sha256_hex(
                str(item.option_value or item.value or "")
            )
            if isinstance(action, UploadFile):
                staged = self.stager.files.get(action.file_id)
                if staged is not None and staged not in self.state.uploaded:
                    self.state.uploaded.append(staged)
        if isinstance(action, ClickRef):
            if action.role_hint == "previous":
                self.state.previous_clicks += 1
            if action.role_hint == "next" and result.postcondition != "no_effect":
                self.state.form_steps_advanced += 1
                self.checkpoint.form_steps_advanced = self.state.form_steps_advanced
            key = (self._session().url, obs.form_hash)
            self.state.seen_pages[key] = self.state.seen_pages.get(key, 0) + 1
            if result.postcondition == "no_effect" and self.state.seen_pages[key] >= STUCK_REPEATS:
                await self._pause("stuck_loop", "The page is not moving forward.", obs)
        if result.postcondition != "no_effect":
            self.state.last_change = time.monotonic()
        self._log_action(action, item, result, obs)
        self._write_checkpoint()

    def _field_log(self, item: PlannedItem | None, obs: Observation) -> dict[str, Any] | None:
        if item is None:
            return None
        f = obs.field(item.ref)
        value = item.option_value if item.option_value is not None else item.value
        return {
            "label": item.label[:120],
            "kind": item.kind,
            "value_source": item.value_source,
            "fact_key": item.fact_key,
            "value": loggable_value(
                value,
                value_source=item.value_source,
                sensitivity=item.sensitivity,
                is_option=f is not None and bool(f.options),
            ),
        }

    def _log_action(
        self, action: Action, item: PlannedItem | None, result: ActionResult, obs: Observation
    ) -> None:
        self.log.action(
            "action_executed",
            step=self.state.step,
            action={
                "type": action_name(action),
                "ref": getattr(action, "ref", None),
                "field_sig": item.signature if item else None,
                "plan_item": item.plan_item if item else None,
            },
            field=self._field_log(item, obs),
            result={
                "ok": result.ok,
                "postcondition": result.postcondition,
                "duration_ms": result.duration_ms,
            },
            page={"url": self._session().url, "form_hash": obs.form_hash},
        )

    def _log_failed(
        self, action: Action, item: PlannedItem | None, obs: Observation, reason: str
    ) -> None:
        self.log.action(
            "action_failed",
            step=self.state.step,
            action={
                "type": action_name(action),
                "ref": getattr(action, "ref", None),
                "plan_item": item.plan_item if item else None,
            },
            field=self._field_log(item, obs),
            result={"ok": False, "reason": reason},
            page={"url": self._session().url, "form_hash": obs.form_hash},
        )

    # ================================================================== submit gate
    async def _submit_gate(self, obs: Observation, choice: Candidate, cls: Classification) -> None:
        """19 §8.2. The single place where Submit can be clicked."""
        if self.mode == "assisted":
            await self._assisted_submit(obs)
            return
        await self._progress("reviewing", "Reviewing before submitting")
        fresh = await self._observe()
        control = fresh.control(str(choice.ref)) or next(
            (c for c in fresh.controls if c.signature == choice.signature), None
        )
        plan = self.state.plans.get(fresh.structure_hash) or self.state.plans.get(
            obs.structure_hash
        )
        items = plan.items if plan is not None else []
        problems = gate_problems(
            fresh, page_kind=cls.page_kind, plan_items=items, lease_lost=self.channel.lost.is_set()
        )
        submit_controls = [c for c in fresh.controls if c.role_hint == "submit" and c.enabled]
        if len(submit_controls) > 1:
            problems.append("ambiguous_submit")
        if control is None:
            problems.append("submit_control_gone")
        elif (
            control.form_action
            and url_host(control.form_action)
            and not self.allowlist.allows_url(control.form_action)
        ):
            problems.append("target_off_allowlist")
        if problems:
            log_event(log, "submit_gate_blocked", problems=problems[:10])
            if "lease_lost" in problems:
                raise LeaseLostError("The lease was lost.")
            if "ambiguous_submit" in problems:
                if self.policy.decide("unclear_page").kind == "stop":
                    raise self._end("failed", error_class="unsupported_form")
                await self._pause(
                    "unclear_page", "More than one button would submit the form.", fresh
                )
                return
            if "target_off_allowlist" in problems:
                if self.policy.decide("external_redirect").kind == "stop":
                    raise self._end("failed", error_class="domain_not_allowed")
                await self._pause(
                    "off_domain_navigation",
                    "The form would be sent off the application site.",
                    fresh,
                )
                return
            if any(p.startswith(("required_empty", "needs_human")) for p in problems):
                decision = self.policy.decide("needs_human_required")
                if decision.kind == "stop":
                    raise self._end(
                        "failed",
                        error_class="missing_information",
                        details={"back_to_approval": True},
                    )
                await self._pause(
                    "missing_information", "Required questions are still open.", fresh
                )
                return
            if "errors" in problems:
                await self._handle_errors(fresh, plan or ValidatedPlan(items=[]))
                return
            await self._pause("unclear_page", "The form is not ready to submit.", fresh)
            return
        assert control is not None  # noqa: S101 - checked above
        if self.ctx.dry_run:
            raise self._end("cancelled", error_class="dry_run", details={"reason": "dry_run"})
        items_by_sig = {i.signature: i for i in items}
        attachments = list(self.state.uploaded)
        submit = build_submit_payload(
            fresh,
            items_by_signature=items_by_sig,
            user_signatures=self.state.user_signatures,
            attachments=attachments,
            posting_id=str(self.posting.get("id") or ""),
            attempt_id=self.ctx.attempt_id if is_id("att", self.ctx.attempt_id) else "",
            injection_suspected=self.state.injection_flag,
        )
        approval_id: str | None = None
        rule_id: str | None = None
        use_approval = self.mode == "approval"
        if self.mode == "auto":
            failures = auto_precondition_failures(
                AutoFacts(
                    rule_id=cast(str | None, self.rule.get("id")),
                    adapter_auto_ok=bool(self.adapter.get("auto_ok")),
                    value_sources=[i.value_source for i in items if i.status == "done"],
                    generated_text=any(i.ai_written for i in items),
                    protected_answer=any(
                        i.sensitivity == "protected" and i.status == "done" for i in items
                    ),
                    paused_this_attempt=self.state.paused_any,
                    injection_suspected=self.state.injection_flag,
                    page_kind_confidence=cls.confidence,
                    form_recognized=bool(self.adapter.get("id"))
                    and self.allowlist.allows_url(fresh.url),
                    domain_allowlisted=fresh.allowlisted,
                )
            )
            if failures:
                if not (self.ctx.headed and self.ctx.interactive):
                    raise self._end(
                        "failed",
                        error_class="auto_precondition_failed",
                        details={"auto_failures": failures, "back_to_approval": True},
                    )
                use_approval = True
            else:
                rule_id = cast(str | None, self.rule.get("id"))
        if use_approval:
            approved = await self._submit_approval(submit.payload, submit.payload_hash)
            if approved is None:
                return  # the form changed: back to the loop for a new approval
            approval_id = approved
            again = await self._observe()
            recheck = build_submit_payload(
                again,
                items_by_signature=items_by_sig,
                user_signatures=self.state.user_signatures,
                attachments=attachments,
                posting_id=str(self.posting.get("id") or ""),
                attempt_id=self.ctx.attempt_id if is_id("att", self.ctx.attempt_id) else "",
                injection_suspected=self.state.injection_flag,
            )
            if recheck.payload_hash != submit.payload_hash:
                log_event(log, "approval_form_changed")
                self.state.approval_id = None
                self.state.approval_rounds += 1
                return  # S-22: hash mismatch → a new approval on the next pass
            fresh = again
            control = fresh.control(control.ref) or next(
                (c for c in fresh.controls if c.signature == control.signature), None
            )
            if control is None:
                await self._pause("unclear_page", "The submit button disappeared.", fresh)
                return
        await self._intent_and_click(
            fresh, control, approval_id=approval_id, rule_id=rule_id, cls=cls
        )

    async def _submit_approval(self, payload: dict[str, Any], digest: str) -> str | None:
        """Create (or reuse) the `submit` approval and wait; None = ask again later."""
        if self.state.approval_rounds >= MAX_APPROVAL_ROUNDS:
            await self._pause("stuck_loop", "The form keeps changing after approval.", None)
            return None
        resume = _dict(self.ctx.context, "resume_from_approval")
        if resume.get("payload_hash") == digest and resume.get("approval_id"):
            return str(resume["approval_id"])
        await self._progress("awaiting_approval", "Waiting for your approval to submit")
        try:
            record = await self.channel.create_approval("submit", payload, digest)
        except Exception as exc:
            if classify_channel_error(exc) == "lease_lost":
                raise LeaseLostError("The lease was lost.") from exc
            await self._pause("network_offline", "The approval could not be requested.", None)
            return None
        approval_id = str(record.get("id") or "")
        self.state.approval_id = approval_id
        self.log.event(
            "approval_requested", step=self.state.step, kind="submit", approval_id=approval_id
        )
        self._maybe_decide_in_cli(record)
        outcome = await wait_for_approval(
            self.channel,
            approval_id,
            poll_s=self.options.approval_poll_s,
            timeout_s=self.options.approval_timeout_s,
            on_tick=self._stop_check,
        )
        self.log.event("approval_decided", step=self.state.step, kind="submit", state=outcome.state)
        if outcome.state == "cancelled":
            raise self._end(
                "cancelled", error_class="cancelled", details={"reason": "cancel_requested"}
            )
        if outcome.state in ("rejected", "expired"):
            error_class = f"approval_{outcome.state}"
            raise self._end("cancelled", error_class=error_class, details={"reason": error_class})
        bound = outcome.record.get("payload_hash")
        if isinstance(bound, str) and bound != digest:
            self.state.approval_rounds += 1
            return None
        return approval_id

    async def _intent_and_click(
        self,
        obs: Observation,
        control: Any,
        *,
        approval_id: str | None,
        rule_id: str | None,
        cls: Classification,
    ) -> None:
        await self._progress("submitting", "Submitting the application")
        try:
            intent_at = await request_submit_intent(
                self.channel,
                form_hash=obs.form_hash,
                approval_id=approval_id,
                rule_id=rule_id,
                retries=self.options.submit_intent_retries,
                backoff_s=self.options.submit_intent_backoff_s,
            )
        except SubmitIntentUnavailableError:
            # 19 §8.2 step 4: never click without a 200; pause network_offline.
            self.log.event("submit_intent", step=self.state.step, ok=False, error="unavailable")
            await self._pause(
                "network_offline", "Submission could not be recorded; nothing was sent.", obs
            )
            return
        except SubmitIntentRefusedError as exc:
            self.log.event("submit_intent", step=self.state.step, ok=False, error=exc.reason)
            if exc.reason == "approval_mismatch":
                self.state.approval_rounds += 1
                return
            if exc.reason in ("cancel_requested", "automation_paused"):
                raise self._end(
                    "cancelled", error_class="cancelled", details={"reason": exc.reason}
                ) from exc
            raise self._end(
                "failed", error_class=exc.error_class, details={"reason": exc.reason}
            ) from exc
        self.state.submit_intent_at = intent_at
        self.checkpoint.form_hash = obs.form_hash
        self._write_checkpoint()
        self.log.event("submit_intent", step=self.state.step, ok=True, form_hash=obs.form_hash)
        self._stop_check()
        auth = authorize(
            control=control,
            form_hash=obs.form_hash,
            submit_intent_at=intent_at,
            approval_id=approval_id,
            rule_id=rule_id,
        )
        submitted_signatures = {f.signature for f in obs.application_fields()}
        since = time.monotonic()
        self.budget.actions += 1
        try:
            result = await self._executor().execute(
                ClickRef(ref=control.ref, role_hint="submit", authorization=auth), obs
            )
            self._log_action(ClickRef(ref=control.ref, role_hint="submit"), None, result, obs)
        except LeaseLostError:
            raise
        except (BrowserCrashedError, PageClosedError) as exc:
            raise self._end(
                "outcome_unknown",
                error_class=exc.error_class,
                submission_status="outcome_unknown",
            ) from exc
        except BrowserError as exc:
            if not auth.used:
                # The click never happened (precondition): nothing was submitted.
                raise self._end(
                    "failed", error_class="submit_click_failed", details={"reason": exc.code}
                ) from exc
            log_event(log, "submit_click_error", error=exc.error_class)
        self._write_checkpoint()
        await self._verify(since, submitted_signatures, control.signature, via=None)

    async def _assisted_submit(self, obs: Observation) -> None:
        """Assisted: the user clicks Submit; the agent watches and verifies (19 §8.1)."""
        if self.ctx.dry_run:
            raise self._end("cancelled", error_class="dry_run", details={"reason": "dry_run"})
        await self._progress(
            "reviewing", "Review the application and click Submit in the browser window"
        )
        session = self._session()
        await session.bring_to_front()
        self._emit("awaiting_user_submit", message="Click Submit in the browser window when ready.")
        submitted = {f.signature for f in obs.application_fields()}
        url_before = session.url
        errors_before = len(obs.errors)
        since = time.monotonic()
        deadline = since + self.options.pause_timeout_s
        observer = self._observer()
        while time.monotonic() < deadline:
            self._stop_check()
            if self.channel.cancel_requested.is_set():
                raise self._end(
                    "cancelled", error_class="cancelled", details={"reason": "cancel_requested"}
                )
            if session.closed_by_user or session.crashed:
                raise self._end(
                    "cancelled", error_class="cancelled", details={"reason": "tab_closed"}
                )
            if session.url != url_before:
                break
            # Background POSTs (analytics beacons) are not a submission: wait until the
            # form is gone or answers with new errors (the user clicked Submit).
            with contextlib.suppress(BrowserError):
                now = await observer.observe(step=self.state.step, with_snapshot=False)
                present = {f.signature for f in now.application_fields()} & submitted
                if (submitted and not present) or len(now.errors) > errors_before:
                    break
            await asyncio.sleep(0.5)
        else:
            raise self._end(
                "paused",
                pause_reason="user_requested",
                details={"message": "Waiting for you to submit."},
            )
        await self._verify(since, submitted, None, via="assisted_user_click")

    async def _confirmation_without_submit(self, obs: Observation) -> None:
        """A confirmation page we did not submit to: the human did (pause / assisted)."""
        if self.mode == "assisted" or self.state.paused_any:
            await self._verify(time.monotonic() - 1, set(), None, via="assisted_user_click")
            return
        await self._pause("unclear_page", "The page says the application was already sent.", obs)

    async def _verify(
        self, since: float, submitted: set[str], submit_signature: str | None, *, via: str | None
    ) -> None:
        """18 §10 evidence + 19 §9.1 verdict → the attempt result (or one more round)."""
        await self._progress("verifying", "Checking the confirmation")
        patterns = [
            str(p) for p in cast(list[Any], self.adapter.get("confirmation_url_patterns") or [])
        ]
        recorder = EvidenceRecorder(
            self._session(),
            self._observer(),
            confirmation_url_patterns=patterns,
            own_values=self.own_values,
            submitted_signatures=submitted,
            submit_signature=submit_signature,
            timeout_s=self.options.evidence_timeout_s,
        )
        capture = await recorder.collect(since=since, step=self.state.step)
        signals = capture.signals()
        ai: dict[str, Any] | None = None
        if not capture.negative_marker:
            try:
                response = await self.ai.verify(
                    step=self.state.step,
                    observation_id=capture.last_observation.observation_id
                    if capture.last_observation
                    else None,
                    final_url=capture.final_url or self._session().url or self.apply_url,
                    page_title=capture.page_title,
                    text_excerpt=capture.text_excerpt,
                    screenshot_jpeg_b64=capture.screenshot_b64(),
                    signals=signals,
                )
                ai = {
                    "application_received": response.application_received.root
                    if response.application_received
                    else None,
                    "still_form_or_error": response.still_form_or_error.root
                    if response.still_form_or_error
                    else None,
                }
            except (AiUnavailableError, AiOfflineError, BudgetExceededError):
                ai = None
        verdict: Verdict = compute_verdict(signals, ai)
        if ai is not None:
            signals.update(ai)
        if via is not None:
            signals["source"] = via
        screenshot_file_id = await self._upload_screenshot(capture.screenshot)
        mapped = VERDICT_RESULTS[verdict]
        self.state.evidence = {
            "kind": "browser_confirmation",
            "verdict": mapped.evidence_verdict,
            "signals": signals,
            "final_url": (capture.final_url or None),
            "page_title": capture.page_title or None,
            "text_excerpt": capture.text_excerpt or None,
            "screenshot_file_id": screenshot_file_id,
            "form_hash": self.checkpoint.form_hash,
            "captured_at": now_ms(),
        }
        self.log.event(
            "evidence",
            step=self.state.step,
            verdict=verdict,
            signals={k: v for k, v in signals.items() if isinstance(v, bool)},
        )
        details: dict[str, Any] = {"verdict": verdict}
        if via is not None:
            details["via"] = via
        if verdict == "negative":
            fixable = [
                e
                for e in capture.errors
                if e.get("ref") and self._error_field_retryable(str(e.get("ref")), capture)
            ]
            if self.state.negative_verdicts == 0 and fixable and via is None:
                self.state.negative_verdicts += 1
                self._reset_after_negative()
                return
            raise self._end(
                "failed",
                error_class="validation_errors_unresolved",
                submission_status=mapped.submission_status if self.state.submit_intent_at else None,
                details=details,
            )
        if verdict == "outcome_unknown":
            raise self._end(
                "outcome_unknown",
                error_class="verification_inconclusive",
                submission_status="outcome_unknown",
                details=details,
            )
        raise self._end("submitted", submission_status=mapped.submission_status, details=details)

    def _error_field_retryable(self, ref: str, capture: Any) -> bool:
        obs: Observation | None = capture.last_observation
        if obs is None:
            return False
        f = obs.field(ref)
        return f is not None and self.state.validation_errors.get(f.signature, 0) == 0

    def _reset_after_negative(self) -> None:
        """19 §9.2: back to the loop once — fix the errors, one more submit gate."""
        self.state.classifications.clear()
        self.state.approval_id = None
        # submit_intent_at stays recorded: nothing will re-run this task automatically;
        # a second gate needs a fresh submit_intent (the server allows one more).
        self.state.last_change = time.monotonic()

    async def _upload_screenshot(self, data: bytes | None) -> str | None:
        enabled = self.options.evidence_screenshots
        if enabled is None:
            enabled = self.config.privacy.keep_evidence_screenshots and (
                self.approval_policy.get("evidence_screenshots", "on_submit") != "off"
            )
        if not enabled or data is None:
            return None
        path = self.ctx.run_dir / "evidence.jpg"
        try:
            await asyncio.to_thread(self._write_private, path, data)
            record = await self.channel.upload_file(
                "evidence_screenshot",
                path,
                {"application_id": self.application.get("id"), "task_id": self.task_id},
            )
        except Exception as exc:  # noqa: BLE001 - evidence upload is best effort
            if classify_channel_error(exc) == "lease_lost":
                return None
            log_event(log, "evidence_upload_failed", error=type(exc).__name__)
            return None
        file_id = record.get("id")
        return file_id if isinstance(file_id, str) else None

    @staticmethod
    def _write_private(path: Path, data: bytes) -> None:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            os.write(fd, data)
        finally:
            os.close(fd)


__all__ = ["AgentLoop", "AttemptEndError"]
