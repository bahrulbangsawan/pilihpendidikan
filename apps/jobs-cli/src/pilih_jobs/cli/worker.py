"""`worker start|stop|status|enable|disable|pause-all|resume-all` (16 §3.3, §7, 21).

`automation` is a hidden alias of this group (mounted by `cli/app.py`).

- `start` runs the worker in the foreground (NDJSON events with `--json`); `--detach`
  installs and starts a user-level service instead (launchd agent / systemd --user unit /
  Task Scheduler task) that runs `pilih-jobs worker start`;
- `stop` asks the running worker to stop over local IPC (graceful: leases released before
  `submit_intent`), falling back to SIGTERM; a background service is stopped too;
- `status` reports the PID, current leases, last poll and poll interval (IPC), plus local
  task bookkeeping and the service state;
- `enable` / `disable` toggle this device's `accepts_tasks` (`automation:execute` suffices);
- `pause-all` / `resume-all` toggle the account-wide `automation_paused` kill switch
  (resuming asks for confirmation).
"""

from __future__ import annotations

import os
import signal
import time
from typing import Annotated, Any, Final, cast

import typer
from rich.console import Console

from pilih_jobs.api.errors import ApiConflictError
from pilih_jobs.cli.board import require_device, stream_event
from pilih_jobs.cli.context import CliState, state
from pilih_jobs.cli.output import items_table, key_value_table
from pilih_jobs.errors import ExitCode, Interrupted, PilihError, UsageError
from pilih_jobs.runtime import Runtime

group = typer.Typer(
    name="worker",
    help="The local task worker (21); `automation` is a hidden alias.",
    no_args_is_help=True,
)

KINDS: Final = ("apply", "discover", "render_cv")
STOP_WAIT_S: Final = 45.0


def _kinds(value: str | None) -> list[str]:
    if value is None:
        return list(KINDS)
    kinds = [k.strip() for k in value.split(",") if k.strip()]
    bad = [k for k in kinds if k not in KINDS]
    if bad or not kinds:
        raise UsageError(f"--kinds takes a comma-separated subset of {', '.join(KINDS)}.")
    return kinds


@group.command("start")
def start_cmd(
    ctx: typer.Context,
    detach: Annotated[
        bool,
        typer.Option(
            "--detach",
            help="Install and start a background service (launchd / systemd --user / "
            "Task Scheduler) instead of running in the foreground.",
        ),
    ] = False,
    kinds: Annotated[
        str | None,
        typer.Option("--kinds", help="Task kinds to claim: apply,discover,render_cv."),
    ] = None,
    headed: Annotated[
        bool, typer.Option("--headed", help="Show the browser for apply tasks.")
    ] = False,
) -> None:
    """Run the task worker (foreground; --detach installs a user-level service)."""
    st = state(ctx)
    selected = _kinds(kinds)
    rt = st.runtime()
    require_device(rt)
    if detach:
        from pilih_jobs.tasks.service import ServiceManager, passthrough_env, worker_argv

        manager = ServiceManager(rt.paths)
        argv = worker_argv(selected if kinds else None, headed=headed)
        data = manager.install(argv, passthrough_env())
        st.out.result(
            data,
            human=lambda c, v: c.print(
                f"Worker service installed ({v['service']}): {v['path']}", markup=False
            ),
        )
        return
    code = st.run(_run_foreground(st, rt, selected, headed))
    if code == int(ExitCode.INTERRUPTED):
        raise Interrupted("Worker interrupted; leases were released or left to expire.")


async def _run_foreground(st: CliState, rt: Runtime, kinds: list[str], headed: bool) -> int:
    from pilih_jobs.tasks.runner import Interrupts
    from pilih_jobs.tasks.signals import SignalHandlers
    from pilih_jobs.tasks.worker import Worker, WorkerOptions

    interrupts = Interrupts()

    def emit(kind: str, fields: dict[str, Any]) -> None:
        stream_event(st, kind, fields)

    worker = Worker(rt, WorkerOptions(kinds=kinds, headed=True if headed else None), emit=emit)
    with SignalHandlers(interrupts, shutdown_on_term=True):
        code = await worker.run(interrupts)
    st.out.result(
        {"completed": worker.completed, "outcomes": worker.outcomes[-10:]},
        human=lambda c, v: c.print(f"Worker stopped after {v['completed']} task(s).", markup=False),
    )
    return code


@group.command("stop")
def stop_cmd(ctx: typer.Context) -> None:
    """Stop the background worker (releases leases gracefully)."""
    st = state(ctx)
    rt = st.runtime()
    from pilih_jobs.tasks.ipc import IpcError, ipc_call
    from pilih_jobs.tasks.locks import worker_running
    from pilih_jobs.tasks.service import ServiceManager

    data: dict[str, Any] = {"stopped": False, "via": None}
    manager = ServiceManager(rt.paths)
    if manager.installed() and manager.stop():
        data.update(stopped=True, via=manager.kind)
    info = worker_running(rt.paths)
    if info is not None:
        try:
            ipc_call(rt.paths, {"op": "stop"}, timeout_s=10)
            data.update(stopped=True, via=data["via"] or "ipc")
        except (IpcError, PilihError):
            if info.pid:
                os.kill(info.pid, signal.SIGTERM)
                data.update(stopped=True, via=data["via"] or "signal", pid=info.pid)
        deadline = time.monotonic() + STOP_WAIT_S
        while worker_running(rt.paths) is not None and time.monotonic() < deadline:
            time.sleep(0.2)
        data["running"] = worker_running(rt.paths) is not None
    st.out.result(
        data,
        human=lambda c, v: c.print(
            "Worker stopped." if v["stopped"] else "No worker was running.", markup=False
        ),
    )


def collect_status(rt: Runtime) -> dict[str, Any]:
    from pilih_jobs.tasks.ipc import IpcError, ipc_call
    from pilih_jobs.tasks.local import LocalTaskStore, recent_runs
    from pilih_jobs.tasks.locks import worker_running
    from pilih_jobs.tasks.service import ServiceManager

    info = worker_running(rt.paths)
    data: dict[str, Any] = {"running": info is not None}
    if info is not None:
        data["pid"] = info.pid
        try:
            data.update(ipc_call(rt.paths, {"op": "status"}, timeout_s=5))
        except (IpcError, PilihError) as exc:
            data["ipc_error"] = exc.message
    store = LocalTaskStore(rt.db)
    data["local_tasks"] = [t.as_dict() for t in store.open()]
    data["recent_runs"] = recent_runs(rt.db, limit=10)
    manager = ServiceManager(rt.paths)
    data["service"] = {
        "kind": manager.kind,
        "installed": manager.installed(),
        "path": str(manager.file_path),
    }
    return data


@group.command("status")
def status_cmd(ctx: typer.Context) -> None:
    """Worker PID, current lease/task, last poll, poll interval."""
    st = state(ctx)
    rt = st.runtime()
    data = collect_status(rt)

    def human(console: Console, value: Any) -> None:
        info = cast(dict[str, Any], value)
        console.print(
            key_value_table(
                {
                    "worker": f"running (pid {info.get('pid')})" if info["running"] else "stopped",
                    "leases": len(cast(list[Any], info.get("leases") or [])),
                    "last poll": info.get("last_poll_at"),
                    "poll interval ms": info.get("poll_interval_ms"),
                    "backpressure": info.get("backpressure"),
                    "service": "installed" if info["service"]["installed"] else "not installed",
                }
            )
        )
        leases = cast(list[dict[str, Any]], info.get("leases") or [])
        if leases:
            console.print(items_table(leases, ["task_id", "kind", "application_id"]))

    st.out.result(data, human=human)


def _accepts(ctx: typer.Context, accepts: bool) -> None:
    st = state(ctx)
    rt = st.runtime()
    device_id = require_device(rt)
    from pilih_jobs.tasks.device import set_accepts_tasks

    async def run() -> dict[str, Any]:
        async with rt.api_client(allow_personal_token=False) as api:
            return await set_accepts_tasks(api, rt.db, rt.issuer, device_id, accepts)

    device = st.run(run())
    st.out.result(
        {"device_id": device_id, "accepts_tasks": device.get("accepts_tasks")},
        human=lambda c, v: c.print(
            f"This device {'accepts' if v['accepts_tasks'] else 'no longer accepts'} tasks.",
            markup=False,
        ),
    )


@group.command("enable")
def enable_cmd(ctx: typer.Context) -> None:
    """Let this device accept tasks (devices.accepts_tasks = true)."""
    _accepts(ctx, True)


@group.command("disable")
def disable_cmd(ctx: typer.Context) -> None:
    """Stop this device from accepting tasks (devices.accepts_tasks = false)."""
    _accepts(ctx, False)


async def _set_paused(rt: Runtime, paused: bool) -> dict[str, Any]:
    async with rt.api_client() as api:
        settings = cast(
            dict[str, Any], cast(dict[str, Any], await api.get("/api/v1/settings"))["settings"]
        )
        for attempt in range(2):
            try:
                data = cast(
                    dict[str, Any],
                    await api.patch(
                        "/api/v1/settings",
                        {"base_revision": settings["revision"], "automation_paused": paused},
                    ),
                )
            except ApiConflictError as exc:
                if attempt == 0 and exc.current is not None:
                    settings = exc.current
                    continue
                raise
            return cast(dict[str, Any], data["settings"])
    raise AssertionError("unreachable")  # pragma: no cover


@group.command("pause-all")
def pause_all_cmd(ctx: typer.Context) -> None:
    """Account-wide kill switch: pause all automation (always allowed)."""
    st = state(ctx)
    rt = st.runtime()
    settings = st.run(_set_paused(rt, True))
    st.out.result(
        {"automation_paused": settings.get("automation_paused")},
        human=lambda c, v: c.print("All automation is paused.", markup=False),
    )


@group.command("resume-all")
def resume_all_cmd(ctx: typer.Context) -> None:
    """Resume all automation (asks for confirmation; --yes accepts)."""
    st = state(ctx)
    if not st.confirm("Resume all automation for your account?", default=False):
        st.out.result({"automation_paused": True, "changed": False})
        return
    rt = st.runtime()
    settings = st.run(_set_paused(rt, False))
    st.out.result(
        {"automation_paused": settings.get("automation_paused")},
        human=lambda c, v: c.print("Automation resumed.", markup=False),
    )


def register(app: typer.Typer) -> None:
    app.add_typer(group, name="worker")
