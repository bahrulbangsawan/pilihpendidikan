"""`tasks list|cancel|retry` — automation tasks in the cloud queue (05 §8, 21 §8, 16 §3.3).

- `list` reads `GET /api/v1/tasks` (`jobs:read`).
- `cancel` sends `POST /api/v1/tasks/{id}/cancel`: a queued (or unleased awaiting-approval)
  task ends `cancelled` at once; a leased one gets `cancel_requested`, delivered to its device
  by heartbeat; already cancelled is a no-op; a task past `submit_intent` cannot be cancelled
  (`409 too_late`).
- `retry` sends `POST /api/v1/tasks/{id}/retry`, allowed from `failed` and from
  `outcome_unknown`; the latter only with `--confirm-not-submitted` (the user states that
  nothing was submitted, 21 §8), which the server records. It creates a new task (`retry_of`).

Both need the step-up scope `automation:manage` (D-29) and take several ids (per-id results).
"""

from __future__ import annotations

from typing import Annotated, Any, Final, cast

import typer
from rich.console import Console

from pilih_jobs.api.client import ApiClient
from pilih_jobs.api.errors import ApiPolicyError
from pilih_jobs.cli import bulk
from pilih_jobs.cli.board import emit_result, fetch_or_cache, fmt_ms, require_scope
from pilih_jobs.cli.context import state
from pilih_jobs.cli.output import items_table, key_value_table
from pilih_jobs.contracts import ids
from pilih_jobs.errors import UsageError
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.cache import EntityCache

group = typer.Typer(
    name="tasks",
    help="Automation tasks: list, cancel, retry (05 §8; cancel/retry need automation:manage).",
    no_args_is_help=True,
)

TASK_STATES: Final = (
    "queued",
    "claimed",
    "running",
    "paused",
    "awaiting_approval",
    "submitted",
    "succeeded",
    "failed",
    "cancelled",
    "outcome_unknown",
    "expired",
)
TASK_KINDS: Final = ("apply", "discover", "render_cv")
PAGE_MAX: Final = 200


def _row(task: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": task.get("id"),
        "kind": task.get("kind"),
        "state": task.get("state"),
        "application_id": task.get("application_id"),
        "attempts": f"{task.get('attempt_count')}/{task.get('max_attempts')}",
        "reason": task.get("pause_reason") or task.get("error_class"),
        "updated": fmt_ms(task.get("updated_at")),
    }


async def _list(
    api: ApiClient,
    rt: Runtime,
    *,
    task_state: str | None,
    kind: str | None,
    application_id: str | None,
    limit: int,
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    cursor: str | None = None
    while len(items) < limit:
        page = cast(
            dict[str, Any],
            await api.get(
                "/api/v1/tasks",
                {
                    "state": task_state,
                    "kind": kind,
                    "application_id": application_id,
                    "limit": min(PAGE_MAX, limit - len(items)),
                    "cursor": cursor,
                },
            ),
        )
        items += cast(list[dict[str, Any]], page.get("items") or [])
        cursor = cast(str | None, page.get("next_cursor"))
        if not cursor:
            break
    cache = EntityCache(rt.db, rt.issuer)
    for task in items:
        cache.put("task", task)
    return items[:limit]


@group.command("list")
def list_cmd(
    ctx: typer.Context,
    task_state: Annotated[
        str | None,
        typer.Option("--state", help="queued|running|paused|failed|outcome_unknown|…"),
    ] = None,
    kind: Annotated[str | None, typer.Option("--kind", help="apply|discover|render_cv")] = None,
    application_id: Annotated[
        str | None, typer.Option("--app", help="Only tasks of this app_… id.", metavar="APP_ID")
    ] = None,
    limit: Annotated[int, typer.Option("--limit", min=1, max=1000, help="At most N tasks.")] = 50,
    ids_only: Annotated[
        bool, typer.Option("--ids", help="Print only the tsk_… ids, one per line (for piping).")
    ] = False,
) -> None:
    """List automation tasks, newest first."""
    st = state(ctx)
    if task_state is not None and task_state not in TASK_STATES:
        raise UsageError(f"--state must be one of {', '.join(TASK_STATES)}.")
    if kind is not None and kind not in TASK_KINDS:
        raise UsageError(f"--kind must be one of {', '.join(TASK_KINDS)}.")
    if application_id is not None and not ids.is_id("app", application_id):
        raise UsageError(f"{application_id!r} is not an application id (app_…).")
    rt = st.runtime()

    def cached() -> list[dict[str, Any]] | None:
        rows = EntityCache(rt.db, rt.issuer).list(
            "task",
            lambda t: (
                (task_state is None or t.get("state") == task_state)
                and (kind is None or t.get("kind") == kind)
                and (application_id is None or t.get("application_id") == application_id)
            ),
        )
        rows.sort(key=lambda t: -int(t.get("updated_at") or 0))
        return rows[:limit]

    items, banner = st.run(
        fetch_or_cache(
            rt,
            lambda api: _list(
                api,
                rt,
                task_state=task_state,
                kind=kind,
                application_id=application_id,
                limit=limit,
            ),
            cached,
        )
    )
    if ids_only:
        if banner:
            st.out.notice(banner)
        bulk.print_ids(st, (t.get("id") for t in items))
        return
    data: dict[str, Any] = {"items": items}
    if banner:
        data["offline"] = banner

    def human(console: Console, value: Any) -> None:
        rows = [_row(t) for t in cast(list[dict[str, Any]], cast(dict[str, Any], value)["items"])]
        console.print(items_table(rows) if rows else "(no tasks)")

    emit_result(st, data, human)


def _check(values: list[str]) -> list[str]:
    return bulk.check_ids("tsk", values, label="task id (tsk_…)")


def _task_fields(task: dict[str, Any]) -> dict[str, Any]:
    return {
        "kind": task.get("kind"),
        "state": task.get("state"),
        "cancel_requested": task.get("cancel_requested"),
    }


def _single(st: Any, data: dict[str, Any], describe: str) -> None:
    def human(console: Console, value: Any) -> None:
        task = cast(dict[str, Any], cast(dict[str, Any], value)["task"])
        console.print(f"{describe}:", markup=False)
        console.print(key_value_table(_row(task)))

    st.out.result(data, human=human)


@group.command("cancel")
def cancel_cmd(
    ctx: typer.Context,
    task_ids: Annotated[list[str], typer.Argument(help="tsk_… ids", metavar="TSK_ID...")],
) -> None:
    """Cancel tasks: queued ones end now, running ones stop at their device's next heartbeat."""
    st = state(ctx)
    values = _check(task_ids)
    rt = st.runtime()
    require_scope(st, rt, "automation:manage", purpose="Cancelling a task")

    async def cancel(api: ApiClient, task_id: str) -> dict[str, Any]:
        data = cast(
            dict[str, Any],
            await api.post(f"/api/v1/tasks/{task_id}/cancel", idempotency_key=ids.new_ulid()),
        )
        EntityCache(rt.db, rt.issuer).put("task", cast(dict[str, Any], data["task"]))
        return data

    async def run() -> list[bulk.Outcome] | dict[str, Any]:
        async with rt.api_client() as api:
            if len(values) == 1:
                return await cancel(api, values[0])

            async def one(task_id: str) -> bulk.Outcome:
                task = cast(dict[str, Any], (await cancel(api, task_id))["task"])
                return bulk.ok(task_id, **_task_fields(task))

            return await bulk.run_each(values, one)

    result = st.run(run())
    if isinstance(result, dict):
        task = cast(dict[str, Any], result["task"])
        verb = "Cancelled" if task.get("state") == "cancelled" else "Cancel requested"
        _single(st, result, f"{verb} {task.get('id')}")
        return
    bulk.emit(st, result, columns=["id", "status", "kind", "state", "cancel_requested"])


@group.command("retry")
def retry_cmd(
    ctx: typer.Context,
    task_ids: Annotated[list[str], typer.Argument(help="tsk_… ids", metavar="TSK_ID...")],
    confirm_not_submitted: Annotated[
        bool,
        typer.Option(
            "--confirm-not-submitted",
            help="For outcome_unknown tasks: you checked that nothing was submitted.",
        ),
    ] = False,
) -> None:
    """Retry failed tasks (a new task with retry_of); outcome_unknown needs your statement."""
    st = state(ctx)
    values = _check(task_ids)
    rt = st.runtime()
    require_scope(st, rt, "automation:manage", purpose="Retrying a task")
    body: dict[str, Any] = {"confirm_not_submitted": True} if confirm_not_submitted else {}

    async def retry(api: ApiClient, task_id: str) -> dict[str, Any]:
        try:
            data = cast(
                dict[str, Any],
                await api.post(
                    f"/api/v1/tasks/{task_id}/retry", body, idempotency_key=ids.new_ulid()
                ),
            )
        except ApiPolicyError as exc:
            if exc.details.get("reason") == "confirm_not_submitted_required":
                exc.hint = (
                    "check the employer's site or your email; if nothing was submitted, run "
                    f"pilih-jobs tasks retry {task_id} --confirm-not-submitted"
                )
            raise
        EntityCache(rt.db, rt.issuer).put("task", cast(dict[str, Any], data["task"]))
        return data

    async def run() -> list[bulk.Outcome] | dict[str, Any]:
        async with rt.api_client() as api:
            if len(values) == 1:
                return await retry(api, values[0])

            async def one(task_id: str) -> bulk.Outcome:
                task = cast(dict[str, Any], (await retry(api, task_id))["task"])
                return bulk.ok(
                    task_id,
                    new_task_id=task.get("id"),
                    kind=task.get("kind"),
                    state=task.get("state"),
                )

            return await bulk.run_each(values, one)

    result = st.run(run())
    if isinstance(result, dict):
        task = cast(dict[str, Any], result["task"])
        _single(st, result, f"Retrying as {task.get('id')}")
        return
    bulk.emit(st, result, columns=["id", "status", "new_task_id", "state"])


def register(app: typer.Typer) -> None:
    app.add_typer(group, name="tasks")
