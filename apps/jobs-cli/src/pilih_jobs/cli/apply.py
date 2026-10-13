"""`apply` — run the browser agent for one application locally (16 §3.3, §6, 21, D-29).

`pilih-jobs apply <app_id>` creates an apply task targeted at this device (base scope
`automation:execute`), claims it and executes it with the agent (`agent.run_attempt`), streaming
progress events. When a worker is running on this device the task is handed to it over local
IPC (one browser profile never has two drivers) and its events are relayed here.

- `--mode assisted|approval|auto` (`auto` needs an active matching rule and the step-up
  `automation:manage`); `assisted` is always headed;
- `--approve` decides the final `submit` approval in the CLI for this run (step-up
  `automation:manage`); it still shows the summary and needs a TTY confirmation unless `--yes`
  was also given **and** the mode is `approval` (`--yes` alone never approves);
- `--dry-run` fills the form and stops before submitting (no `submit_intent`, ever);
- `--resume` resumes this device's paused attempt (never one past `submit_intent`);
- `--matched` creates apply tasks for tracked `ready` applications matching the criteria.

Ctrl+C (16 §6): the first stops at the next step boundary before `submit_intent` (the task is
kept paused for `--resume`, or released if you choose "abandon"); after `submit_intent` it is
ignored until verification finishes. The second aborts; an acknowledged intent without a
result is recorded locally as `outcome_unknown` first.
"""

from __future__ import annotations

import asyncio
import contextlib
import re
import sys
import threading
from typing import TYPE_CHECKING, Annotated, Any, Final, cast

import typer

from pilih_jobs.api.client import ApiClient
from pilih_jobs.cli.board import require_device, require_scope, stream_event
from pilih_jobs.cli.context import CliState, state
from pilih_jobs.contracts import ids
from pilih_jobs.errors import (
    ConflictError,
    Interrupted,
    PausedError,
    PilihError,
    UnavailableError,
    UsageError,
)
from pilih_jobs.runtime import Runtime

if TYPE_CHECKING:
    from pilih_jobs.agent.options import AttemptOptions, PauseAnswer, PausePrompt

MODES: Final = ("assisted", "approval", "auto")
FINAL_FLUSH_S: Final = 20.0
YES: Final = frozenset({"y", "yes"})


# ---------------------------------------------------------------------- terminal input
def _resolve_line(future: asyncio.Future[str], line: str) -> None:
    if not future.done():
        future.set_result(line)


class TerminalInput:
    """The one stdin reader of an interactive `apply` (pause, domain and approval prompts).

    Prompts run while the event loop keeps the lease alive (heartbeats, watchdog; 21 §5), so
    lines are read on a daemon thread. A prompt answered elsewhere (resumed or decided on the
    web) leaves its pending read for the next prompt instead of starting a second reader; a
    line typed while no prompt was waiting is discarded, never taken as the next answer.
    """

    def __init__(self) -> None:
        self._pending: asyncio.Future[str] | None = None

    def _start(self) -> asyncio.Future[str]:
        loop = asyncio.get_running_loop()
        future: asyncio.Future[str] = loop.create_future()

        def read() -> None:
            try:
                line = sys.stdin.readline()
            except (OSError, ValueError):
                line = ""
            with contextlib.suppress(RuntimeError):  # the loop closed meanwhile
                loop.call_soon_threadsafe(_resolve_line, future, line)

        threading.Thread(target=read, name="pilih-jobs-stdin", daemon=True).start()
        return future

    async def readline(self) -> str:
        if self._pending is None or self._pending.done():
            self._pending = self._start()
        line = await asyncio.shield(self._pending)
        self._pending = None
        return line.strip()

    async def ask_yes_no(self, st: CliState, question: str, *, default: bool = False) -> bool:
        st.out.console(err=True).print(
            f"{question} [{'Y/n' if default else 'y/N'}] ", end="", markup=False
        )
        answer = (await self.readline()).lower()
        return default if not answer else answer in YES


def terminal_hooks(
    st: CliState, approver: CliApprover, api: ApiClient, terminal: TerminalInput
) -> AttemptOptions:
    """`AttemptOptions` hooks for an interactive run (18 §7.4, §8; 21 §6.2, §6.3)."""
    from pilih_jobs.agent.options import AttemptOptions

    console = st.out.console(err=True)

    async def prompt_pause(prompt: PausePrompt) -> PauseAnswer:
        where = f" on {prompt.domain}" if prompt.domain else ""
        console.print(f"Paused{where} ({prompt.reason}): {prompt.message}", markup=False)
        console.print(
            ("Complete it in the browser window, then press" if prompt.headed else "Press")
            + " Enter to continue (or type `skip` for optional questions, `stop` to stop).",
            markup=False,
        )
        answer = (await terminal.readline()).lower()
        if answer in ("skip", "s"):
            return "skip"
        if answer in ("stop", "q", "quit"):
            return "stop"
        return "resume"

    async def decide_in_cli(record: dict[str, Any]) -> None:
        approval_id = record.get("id")
        if not isinstance(approval_id, str):
            return
        try:
            await approver.handle(api, approval_id)
        except PilihError as exc:  # decided on the web meanwhile, or offline: the agent polls on
            st.out.event("warning", message=f"The approval was not decided here: {exc.message}")

    async def allow_domain(domain: str) -> bool:
        console.print(
            f"The application moved to {domain}, which is not on its allowlist.", markup=False
        )
        return await terminal.ask_yes_no(st, f"Allow {domain} for this application?")

    return AttemptOptions(
        prompt_pause=prompt_pause, decide_in_cli=decide_in_cli, allow_domain=allow_domain
    )


# ---------------------------------------------------------------------- approval in the CLI
class CliApprover:
    """Decides `submit` approvals for `--approve` when the agent does not prompt itself
    (delegated runs, non-interactive `--approve --yes` in approval mode)."""

    def __init__(
        self,
        st: CliState,
        rt: Runtime,
        *,
        mode: str | None,
        enabled: bool,
        terminal: TerminalInput | None = None,
    ) -> None:
        self.st = st
        self.rt = rt
        self.mode = mode
        self.enabled = enabled
        self.terminal = terminal
        self.decided: set[str] = set()

    async def _confirm(self) -> bool:
        question = "Submit this application with exactly the content above?"
        if self.terminal is not None:
            return await self.terminal.ask_yes_no(self.st, question)
        return self.st.confirm(question, default=False, submission=True)

    def auto_ok(self) -> bool:
        return self.st.yes and (self.mode in (None, "approval"))

    async def handle(self, api: ApiClient, approval_id: str) -> str | None:
        from pilih_jobs.cli.approvals import (
            decide,
            find_approval,
            render_payload,
            verify_payload_hash,
        )

        if not self.enabled or approval_id in self.decided:
            return None
        self.decided.add(approval_id)
        approval = await find_approval(api, self.rt, approval_id)
        if approval.get("kind") != "submit" or approval.get("state") != "pending":
            return None
        if verify_payload_hash(approval) is False:
            self.st.out.event("warning", message="payload_hash mismatch; not approving.")
            return None
        if not self.st.out.json_mode and not self.st.out.quiet:
            render_payload(self.st.out.console(err=True), approval)
        if self.st.interactive:
            if not await self._confirm():
                await decide(api, approval, "reject")
                return "rejected"
        elif not self.auto_ok():
            self.st.out.event(
                "warning",
                message="--approve needs a TTY confirmation (or --yes in approval mode); "
                f"decide on the web or with `pilih-jobs approvals decide {approval_id}`.",
            )
            return None
        await decide(api, approval, "approve")
        self.st.out.event("approval_decided", approval_id=approval_id, state="approved")
        return "approved"


# ---------------------------------------------------------------------- results
def finish(st: CliState, data: dict[str, Any], *, synced: bool, app_id: str) -> None:
    """Map an execution outcome to the result envelope and the 16 §3.2 exit code."""
    outcome = data.get("outcome")
    if outcome in ("submitted", "succeeded") or (
        outcome == "cancelled" and data.get("reason") == "dry_run"
    ):
        if not synced:
            raise UnavailableError(
                "The result is queued and will be sent by `pilih-jobs sync`.",
                code="queued",
                details=data,
            )
        st.out.result(
            data,
            human=lambda c, v: c.print(
                f"{app_id}: {v['outcome']}"
                + (f" ({v['submission_status']})" if v.get("submission_status") else ""),
                markup=False,
            ),
        )
        return
    if outcome in ("paused", "released", "interrupted") and data.get("interrupted"):
        raise Interrupted(
            "Interrupted; local state was saved."
            + (
                f" Resume with `pilih-jobs apply {app_id} --resume`." if outcome == "paused" else ""
            ),
            details=data,
        )
    if outcome in ("paused", "released"):
        raise PausedError(
            f"Paused: {data.get('reason') or 'human input required'}.",
            details=data,
            hint=f"pilih-jobs apply {app_id} --resume",
        )
    if outcome == "lost":
        raise ConflictError(
            "The lease was lost; the task stopped.", code="lease_lost", details=data
        )
    if outcome == "outcome_unknown":
        raise PilihError(
            "The submission outcome is unknown; check your email / the ATS.",
            code="outcome_unknown",
            details=data,
            hint=f"pilih-jobs confirm {app_id} --yes  (or --no)",
        )
    if outcome == "interrupted":
        raise Interrupted("Interrupted.", details=data)
    raise PilihError(
        f"{app_id}: {outcome} ({data.get('error_class') or data.get('reason') or 'error'}).",
        code=str(data.get("error_class") or data.get("reason") or outcome or "error"),
        details=data,
    )


# ---------------------------------------------------------------------- in-process
async def run_local(
    st: CliState, rt: Runtime, request: Any, approver: CliApprover
) -> tuple[dict[str, Any], bool]:
    from pilih_jobs.environment import has_display
    from pilih_jobs.sync.outbox import Outbox
    from pilih_jobs.tasks.apply import ApplyOrchestrator
    from pilih_jobs.tasks.recovery import recover
    from pilih_jobs.tasks.runner import Interrupts, RunnerEnv
    from pilih_jobs.tasks.signals import SignalHandlers
    from pilih_jobs.tasks.syncloop import SyncLoop

    interrupts = Interrupts()
    stop = asyncio.Event()
    pending: set[asyncio.Task[Any]] = set()
    terminal = approver.terminal
    async with (
        rt.api_client(allow_personal_token=False) as api,
        rt.api_client(allow_personal_token=False) as heartbeat_api,
    ):
        sync = SyncLoop(rt.db, rt.issuer, api, paths=rt.paths, state_lock=rt.state_lock)
        hooks = terminal_hooks(st, approver, api, terminal) if terminal is not None else None

        def emit(kind: str, fields: dict[str, Any]) -> None:
            stream_event(st, kind, fields)
            approval_id = fields.get("approval_id")
            if (
                kind == "approval_requested"
                and isinstance(approval_id, str)
                and not (request.interactive and request.approve)
            ):
                job = asyncio.get_running_loop().create_task(approver.handle(api, approval_id))
                pending.add(job)
                job.add_done_callback(pending.discard)

        env = RunnerEnv(
            db=rt.db,
            issuer=rt.issuer,
            paths=rt.paths,
            config=rt.config,
            api=api,
            heartbeat_api=heartbeat_api,
            device_id=require_device(rt),
            clock=rt.clock,
            runtime=rt,
            kick=sync.kick,
            emit=emit,
            has_display=has_display(),
        )
        await recover(
            rt.db, rt.issuer, api, only_application=request.application_id, paths=rt.paths
        )
        sync_task = asyncio.create_task(sync.run(stop))
        try:
            with SignalHandlers(interrupts):
                outcome = await ApplyOrchestrator(env, attempt=hooks).run(request, interrupts)
        finally:
            stop.set()
            for job in pending:
                job.cancel()
            with contextlib.suppress(TimeoutError, asyncio.CancelledError):
                await asyncio.wait_for(sync_task, FINAL_FLUSH_S)
        data = outcome.as_dict()
        synced = True
        if outcome.result_key:
            entry = Outbox(rt.db, rt.issuer).get(outcome.result_key)
            synced = entry is None or entry.state == "done"
        keep_question = (
            "Keep the attempt paused for `apply --resume`? (no = abandon: give the task back)"
        )
        if (
            outcome.outcome == "paused"
            and outcome.interrupted
            and st.interactive
            and not (
                await terminal.ask_yes_no(st, keep_question, default=True)
                if terminal is not None
                else st.confirm(keep_question, default=True)
            )
        ):
            from pilih_jobs.tasks.recovery import release_lease

            released = await release_lease(api, outcome.task_id, outcome.lease_id, "user_quit")
            if released == "released":
                from pilih_jobs.tasks.local import LocalTaskStore

                LocalTaskStore(rt.db).update(
                    outcome.task_id, local_state="done", released="user_quit"
                )
                data.update(outcome="released", released="user_quit")
        return data, synced


# ---------------------------------------------------------------------- delegated
def run_delegated(
    st: CliState, rt: Runtime, request: Any, approver: CliApprover
) -> tuple[dict[str, Any], bool]:
    from pilih_jobs.tasks.ipc import ipc_request

    result: dict[str, Any] | None = None
    for frame in ipc_request(rt.paths, request.as_ipc()):
        if frame.get("type") == "event":
            kind = str(frame.get("event") or "log")
            fields = cast(dict[str, Any], frame.get("fields") or {})
            stream_event(st, kind, fields)
            approval_id = fields.get("approval_id")
            if kind == "approval_requested" and isinstance(approval_id, str):

                async def decide_now(approval: str = approval_id) -> str | None:
                    async with rt.api_client() as api:
                        return await approver.handle(api, approval)

                st.run(decide_now())
            continue
        if frame.get("ok"):
            result = cast(dict[str, Any], frame.get("data") or {})
        else:
            error = cast(dict[str, Any], frame.get("error") or {})
            raise PilihError(
                str(error.get("message") or "The worker failed."),
                code=str(error.get("code") or "worker_error"),
                details=cast(dict[str, Any], error.get("details") or {}),
            )
    if result is None:
        raise UnavailableError("The worker sent no result.")
    return result, True


# ---------------------------------------------------------------------- --matched
_COMPANY = re.compile(r"\s+")


def _norm(text: Any) -> str:
    return _COMPANY.sub(" ", str(text or "")).strip().lower()


def rule_matches(card: dict[str, Any], criteria: dict[str, Any]) -> str | None:
    """None when the card matches the rule criteria, else the reason (19 §8.3)."""
    posting = cast(dict[str, Any], card.get("posting") or {})
    title = _norm(posting.get("title"))
    company = _norm(posting.get("company_name"))
    companies = [_norm(c) for c in cast(list[Any], criteria.get("companies") or [])]
    excluded = [_norm(c) for c in cast(list[Any], criteria.get("exclude_companies") or [])]
    if company and company in excluded:
        return "excluded_company"
    if companies and company not in companies:
        return "company_not_in_rule"
    patterns = cast(list[str], criteria.get("title_patterns") or [])
    keywords = [_norm(k) for k in cast(list[Any], criteria.get("keywords") or [])]
    if patterns and not any(_safe_search(p, title) for p in patterns):
        return "title_not_in_rule"
    if keywords and not any(k in title for k in keywords):
        return "keywords_not_in_rule"
    return None


def _safe_search(pattern: str, text: str) -> bool:
    try:
        return re.search(pattern, text, re.IGNORECASE) is not None
    except re.error:
        return pattern.lower() in text


async def run_matched(
    st: CliState,
    rt: Runtime,
    *,
    min_score: int | None,
    limit: int,
    rule_id: str | None,
    dry_run: bool,
    mode: str | None,
) -> dict[str, Any]:
    device_id = require_device(rt)
    account = rt.account()
    scopes = set(account.scopes if account is not None else [])
    created: list[str] = []
    skipped: list[dict[str, Any]] = []
    candidates: list[str] = []
    async with rt.api_client(allow_personal_token=False) as api:
        rule: dict[str, Any] | None = None
        if rule_id:
            rule = cast(
                dict[str, Any],
                cast(dict[str, Any], await api.get(f"/api/v1/rules/{rule_id}"))["rule"],
            )
            if not rule.get("enabled"):
                raise ConflictError(f"{rule_id} is disabled.", code="rule_disabled")
        criteria = cast(dict[str, Any], (rule or {}).get("criteria") or {})
        threshold = (
            min_score if min_score is not None else cast(int | None, criteria.get("min_score"))
        )
        cards: list[dict[str, Any]] = []
        cursor: str | None = None
        for _ in range(20):
            page = cast(
                dict[str, Any],
                await api.get(
                    "/api/v1/applications", {"stage": "ready", "limit": 200, "cursor": cursor}
                ),
            )
            cards += cast(list[dict[str, Any]], page.get("items") or [])
            cursor = cast(str | None, page.get("next_cursor"))
            if not cursor:
                break
        for card in cards:
            app_id = str(card["id"])
            score = cast(dict[str, Any] | None, card.get("score"))
            value = score.get("score") if score else None
            task_mode = mode or (rule or {}).get("mode") or card.get("mode")
            reason: str | None = None
            if card.get("live_task"):
                reason = "task_live"
            elif card.get("submission_status") in ("submitted_verified", "submitted_unverified"):
                reason = "already_submitted"
            elif cast(dict[str, Any], card.get("posting") or {}).get("status") == "closed":
                reason = "posting_closed"
            elif task_mode not in MODES:
                reason = "manual_mode"
            elif threshold is not None and (value is None or int(value) < threshold):
                reason = "below_min_score" if value is not None else "not_scored"
            elif rule is not None:
                reason = rule_matches(card, criteria)
            if reason is None and task_mode == "auto" and "automation:manage" not in scopes:
                reason = "needs_automation_manage"
            if reason is None and len(candidates) >= limit:
                reason = "limit"
            if reason is not None:
                skipped.append({"app_id": app_id, "reason": reason})
                continue
            candidates.append(app_id)
            if dry_run:
                continue
            key = f"cli-matched:{device_id}:{app_id}:{ids.new_ulid()}"
            payload: dict[str, Any] = {"mode": task_mode}
            if rule_id:
                payload["rule_id"] = rule_id
            try:
                data = cast(
                    dict[str, Any],
                    await api.post(
                        "/api/v1/tasks",
                        {
                            "kind": "apply",
                            "application_id": app_id,
                            "payload": payload,
                            "target_device_id": device_id,
                            "idempotency_key": key,
                        },
                        idempotency_key=key,
                    ),
                )
            except PilihError as exc:
                skipped.append({"app_id": app_id, "reason": exc.code})
                continue
            created.append(str(cast(dict[str, Any], data["task"])["id"]))
    out: dict[str, Any] = {"created": created, "skipped": skipped}
    if dry_run:
        out["candidates"] = candidates
    return out


# ---------------------------------------------------------------------- command
def apply_cmd(
    ctx: typer.Context,
    app_id: Annotated[str | None, typer.Argument(help="app_… id (omit with --matched)")] = None,
    mode: Annotated[
        str | None, typer.Option("--mode", help="assisted|approval|auto (auto needs a rule).")
    ] = None,
    dry_run: Annotated[
        bool,
        typer.Option("--dry-run", help="Fill and stop before submit (nothing is submitted)."),
    ] = False,
    approve: Annotated[
        bool,
        typer.Option(
            "--approve",
            help="Decide the final submit approval here for this run (automation:manage).",
        ),
    ] = False,
    headed: Annotated[
        bool | None,
        typer.Option("--headed/--headless", help="Show the browser (assisted is always headed)."),
    ] = None,
    resume: Annotated[
        bool, typer.Option("--resume", help="Resume this device's paused attempt.")
    ] = False,
    keep_artifacts: Annotated[
        bool, typer.Option("--keep-artifacts", help="Keep the staging directory afterwards.")
    ] = False,
    matched: Annotated[
        bool,
        typer.Option("--matched", help="Create apply tasks for tracked ready applications."),
    ] = False,
    min_score: Annotated[
        int | None,
        typer.Option("--min-score", min=0, max=100, help="With --matched: minimum score."),
    ] = None,
    limit: Annotated[
        int, typer.Option("--limit", min=1, max=100, help="With --matched: at most N tasks.")
    ] = 10,
    rule: Annotated[
        str | None, typer.Option("--rule", help="With --matched: use this rule (rul_…).")
    ] = None,
) -> None:
    """Run the browser agent for one application locally (task → claim → agent)."""
    st = state(ctx)
    if mode is not None and mode not in MODES:
        raise UsageError(f"--mode must be one of {', '.join(MODES)}.")
    rt = st.runtime()
    if matched:
        if app_id is not None:
            raise UsageError("--matched takes no app_id.")
        if rule is not None and not ids.is_id("rul", rule):
            raise UsageError(f"{rule!r} is not a rule id (rul_…).")
        if mode == "auto":
            require_scope(st, rt, "automation:manage", purpose="Auto mode")
        data = st.run(
            run_matched(
                st, rt, min_score=min_score, limit=limit, rule_id=rule, dry_run=dry_run, mode=mode
            )
        )
        st.out.result(
            data,
            human=lambda c, v: c.print(
                f"{len(v['created'])} task(s) created, {len(v['skipped'])} skipped.", markup=False
            ),
        )
        return
    if app_id is None or not ids.is_id("app", app_id):
        raise UsageError("apply needs an application id (app_…) or --matched.")
    if mode == "assisted" and headed is False:
        raise UsageError("assisted mode is always headed.")
    if approve and dry_run:
        raise UsageError("--approve and --dry-run are mutually exclusive.")
    if approve and mode in ("assisted", "auto"):
        raise UsageError("--approve applies to approval mode.")
    require_device(rt)
    if mode == "auto":
        require_scope(st, rt, "automation:manage", purpose="Auto mode")
    if approve:
        require_scope(st, rt, "automation:manage", purpose="Approving the submission in the CLI")
    from pilih_jobs.tasks.apply import ApplyRequest
    from pilih_jobs.tasks.locks import worker_running

    request = ApplyRequest(
        application_id=app_id,
        mode=mode,
        dry_run=dry_run,
        approve=approve,
        headed=headed,
        resume=resume,
        keep_artifacts=keep_artifacts,
        interactive=st.interactive,
    )
    worker = worker_running(rt.paths)
    approver = CliApprover(
        st,
        rt,
        mode=mode,
        enabled=approve,
        # In-process interactive runs answer pauses, domains and approvals here (16 §4).
        terminal=TerminalInput() if st.interactive and worker is None else None,
    )
    if worker is not None:
        from pilih_jobs.tasks.ipc import IpcError

        st.out.event("log", message=f"Handing the task to the running worker (pid {worker.pid}).")
        try:
            data, synced = run_delegated(st, rt, request, approver)
        except IpcError as exc:
            raise UnavailableError(
                f"A worker is running but cannot be reached ({exc.message}); refusing to drive "
                "a second browser.",
                hint="pilih-jobs worker stop",
            ) from exc
    else:
        data, synced = st.run(run_local(st, rt, request, approver))
    finish(st, data, synced=synced, app_id=app_id)


def register(app: typer.Typer) -> None:
    app.command("apply")(apply_cmd)
