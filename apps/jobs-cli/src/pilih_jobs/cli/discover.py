"""`discover` (15, 16 §3.3): run discovery on job sources.

Streams progress events (NDJSON with `--json`, a Rich progress view on a TTY, plain lines
otherwise) and ends with `{run_id, status, stats}`. The first Ctrl+C (or SIGTERM) stops
scheduling, lets in-flight requests finish (≤ 10 s), queues what was found and flushes
the outbox, then exits 130; a second Ctrl+C aborts. Discovery works offline: results stay
in the outbox until `sync` (20 §10). Scrapling is imported only inside the command.
"""

from __future__ import annotations

import asyncio
import contextlib
import signal
import sys
from collections.abc import AsyncGenerator
from typing import TYPE_CHECKING, Annotated, Any, cast

import typer
from rich.console import Console
from rich.progress import Progress, SpinnerColumn, TaskID, TextColumn

from pilih_jobs.cli.context import CliState, state
from pilih_jobs.cli.output import items_table, key_value_table
from pilih_jobs.errors import Interrupted, PilihError
from pilih_jobs.runtime import Runtime

if TYPE_CHECKING:
    from pilih_jobs.api.client import ApiClient
    from pilih_jobs.discovery import DiscoveryOptions, DiscoveryRunResult

_SUMMARY_EVENTS = frozenset(
    {"source_started", "source_stopped", "source_finished", "sync", "run_finished", "warning"}
)


class _Progress:
    """Routes discovery events to NDJSON, a Rich progress view, or plain stderr lines."""

    def __init__(self, st: CliState) -> None:
        self.out = st.out
        self.verbose = st.verbose
        self._progress: Progress | None = None
        self._tasks: dict[str, TaskID] = {}
        self._counts: dict[str, int] = {}
        if not self.out.json_mode and not self.out.quiet and _stderr_tty():
            self._progress = Progress(
                SpinnerColumn(),
                TextColumn("{task.description}"),
                TextColumn("{task.fields[status]}"),
                console=self.out.console(err=True),
                transient=False,
            )

    def __enter__(self) -> _Progress:
        if self._progress is not None:
            self._progress.start()
        return self

    def __exit__(self, *_exc: object) -> None:
        if self._progress is not None:
            self._progress.stop()

    def handle(self, event: dict[str, Any]) -> None:
        fields = {k: v for k, v in event.items() if k not in ("type", "ts")}
        kind = str(event.get("type") or "log")
        if self.out.json_mode:
            self.out.event(kind, **fields)
            return
        if self._progress is not None:
            self._rich(self._progress, kind, fields)
            return
        if kind in _SUMMARY_EVENTS or self.verbose:
            self.out.event(kind, **fields)

    def _task(self, progress: Progress, source: str) -> TaskID:
        task = self._tasks.get(source)
        if task is None:
            task = progress.add_task(source, total=None, status="starting")
            self._tasks[source] = task
            self._counts[source] = 0
        return task

    def _rich(self, progress: Progress, kind: str, fields: dict[str, Any]) -> None:
        source = str(fields.get("source") or "run")
        if kind in ("sync", "run_finished"):
            if kind == "sync":
                progress.console.print(
                    f"sync: {fields.get('sent', 0)} sent, {fields.get('pending', 0)} pending",
                    markup=False,
                )
            return
        if kind == "warning":
            progress.console.print(
                f"warning: {source}: {fields.get('message') or fields}", markup=False
            )
            return
        task = self._task(progress, source)
        if kind == "page_fetched":
            progress.update(task, status=f"page {fields.get('page')} ({fields.get('items')} items)")
        elif kind == "item":
            self._counts[source] = self._counts.get(source, 0) + 1
            progress.update(task, status=f"{self._counts[source]} postings")
        elif kind == "source_stopped":
            reason = f"{fields.get('error_class')} {fields.get('http_status') or ''}".strip()
            progress.update(task, status=f"stopped: {reason}")
            progress.stop_task(task)
        elif kind == "source_finished":
            stats = cast(dict[str, Any], fields.get("stats") or {})
            progress.update(
                task,
                status=(
                    f"done: {stats.get('found', stats.get('checked', 0))} found, "
                    f"{stats.get('new', 0)} new, {stats.get('unchanged', 0)} unchanged"
                ),
            )
            progress.stop_task(task)


def _stderr_tty() -> bool:
    try:
        return sys.stderr.isatty()
    except (AttributeError, ValueError):
        return False


@contextlib.asynccontextmanager
async def _signals(st: CliState, cancel: asyncio.Event) -> AsyncGenerator[None]:
    """First Ctrl+C / SIGTERM → graceful (cancel); second Ctrl+C → abort (16 §6)."""
    loop = asyncio.get_running_loop()
    main = asyncio.current_task()
    presses = 0

    def on_interrupt() -> None:
        nonlocal presses
        presses += 1
        if presses == 1:
            cancel.set()
            st.out.notice("Stopping: finishing in-flight requests (Ctrl+C again to abort)…")
        elif main is not None:
            main.cancel()

    def on_terminate() -> None:
        cancel.set()
        if main is not None:
            loop.call_later(30.0, main.cancel)

    installed: list[signal.Signals] = []
    for sig, handler in ((signal.SIGINT, on_interrupt), (signal.SIGTERM, on_terminate)):
        try:
            loop.add_signal_handler(sig, handler)
            installed.append(sig)
        except (NotImplementedError, RuntimeError, ValueError):
            continue
    try:
        yield
    finally:
        for sig in installed:
            with contextlib.suppress(Exception):
                loop.remove_signal_handler(sig)


async def _execute(st: CliState, rt: Runtime, options: DiscoveryOptions) -> DiscoveryRunResult:
    from pilih_jobs.discovery import DiscoveryRuntime, run_discovery
    from pilih_jobs.sync.outbox import Outbox

    cancel = asyncio.Event()
    outbox = Outbox(rt.db, rt.issuer)
    with _Progress(st) as progress:
        async with _signals(st, cancel), _api(rt) as api:
            ctx = DiscoveryRuntime(
                outbox=outbox, api=api, emit=progress.handle, cancel=cancel, runtime=rt
            )
            result = await run_discovery(options, ctx=ctx)
    if cancel.is_set():
        raise Interrupted(
            "Discovery interrupted; the postings found so far were queued for sync.",
            details=_data(result),
        )
    return result


@contextlib.asynccontextmanager
async def _api(rt: Runtime) -> AsyncGenerator[ApiClient | None]:
    if rt.account() is None:
        yield None
        return
    async with rt.api_client() as api:
        yield api


def _data(result: DiscoveryRunResult) -> dict[str, Any]:
    data: dict[str, Any] = {"run_id": result.run_id, "status": result.status, "stats": result.stats}
    if result.errors:
        data["errors"] = result.errors
    return data


def _render(console: Console, value: Any) -> None:
    data = cast(dict[str, Any], value)
    stats = cast(dict[str, Any], data.get("stats") or {})
    summary: dict[str, Any] = {"run": data.get("run_id") or "-", "status": data.get("status")}
    for key in ("postings_found", "new", "updated", "unchanged", "duplicates", "invalid", "pages"):
        if key in stats:
            summary[key] = stats[key]
    sync = stats.get("sync")
    if isinstance(sync, dict):
        typed = cast(dict[str, Any], sync)
        summary["synced"] = f"{typed.get('sent', 0)} sent, {typed.get('pending', 0)} pending"
    if stats.get("dry_run"):
        summary["dry run"] = "nothing was queued for sync"
    console.print(key_value_table(summary))
    sources = cast(list[dict[str, Any]], stats.get("sources") or [])
    if sources:
        console.print(
            items_table(
                sources,
                [
                    "source",
                    "complete",
                    "stopped",
                    "found",
                    "new",
                    "updated",
                    "unchanged",
                    "invalid",
                ],
            )
        )
    reset = stats.get("adaptive_reset")
    if isinstance(reset, dict):
        typed_reset = cast(dict[str, Any], reset)
        deleted, target = typed_reset.get("deleted"), typed_reset.get("source")
        console.print(f"adaptive selectors reset: {deleted} for {target}")


def discover_command(
    ctx: typer.Context,
    source: Annotated[
        list[str] | None,
        typer.Option(
            "--source",
            help="A configured source (src_…) or adapter:org, e.g. greenhouse:acme (repeatable).",
            metavar="SRC",
        ),
    ] = None,
    all_sources: Annotated[
        bool, typer.Option("--all", help="Every enabled source of your account.")
    ] = False,
    url: Annotated[
        str | None, typer.Option("--url", help="One job URL (custom_url).", metavar="URL")
    ] = None,
    keywords: Annotated[
        str | None,
        typer.Option(
            "--keywords", help="Keep postings containing all these words.", metavar="TEXT"
        ),
    ] = None,
    location: Annotated[
        str | None,
        typer.Option(
            "--location", help="Keep postings in this location (or 'remote').", metavar="TEXT"
        ),
    ] = None,
    private: Annotated[
        bool, typer.Option("--private", help="Store the postings as private (only you).")
    ] = False,
    check_tracked: Annotated[
        bool,
        typer.Option("--check-tracked", help="Re-check tracked postings for closures (15 §12)."),
    ] = False,
    max_pages: Annotated[
        int | None,
        typer.Option(
            "--max-pages", min=1, max=50, help="Listing pages per source (≤ 50).", metavar="N"
        ),
    ] = None,
    dry_run: Annotated[
        bool, typer.Option("--dry-run", help="Discover and print only; nothing is synced.")
    ] = False,
    reset_adaptive: Annotated[
        str | None,
        typer.Option(
            "--reset-adaptive",
            help="Forget the learned adaptive selectors of a source (src_… or adapter:org).",
            metavar="SRC",
        ),
    ] = None,
) -> None:
    """Discover jobs on your sources (public ATS APIs and careers pages; robots.txt obeyed)."""
    from pilih_jobs.discovery import DiscoveryOptions

    st = state(ctx)
    options = DiscoveryOptions(
        sources=list(source or []),
        all_sources=all_sources,
        url=url,
        keywords=keywords,
        location=location,
        private=private,
        check_tracked=check_tracked,
        max_pages=max_pages,
        dry_run=dry_run,
        reset_adaptive=reset_adaptive,
    )
    rt = st.runtime()
    result = st.run(_execute(st, rt, options))
    data = _data(result)
    if result.status == "failed":
        raise PilihError(
            "Discovery failed: no source produced postings (see errors).",
            code="discovery_failed",
            details=data,
        )
    st.out.result(data, human=_render)


def register(app: typer.Typer) -> None:
    app.command("discover")(discover_command)
