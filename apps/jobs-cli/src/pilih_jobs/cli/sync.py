"""`sync`: flush the outbox, then pull changes (16 §3.3, 20 §5.3 dead-letter tools)."""

from __future__ import annotations

from typing import Annotated, Any, cast

import typer
from rich.console import Console

from pilih_jobs.api.errors import NetworkError
from pilih_jobs.cli.context import CliState, state
from pilih_jobs.cli.output import items_table, key_value_table
from pilih_jobs.errors import (
    ConflictError,
    NotAuthenticatedError,
    NotFoundError,
    UnavailableError,
    UpgradeRequiredError,
    UsageError,
)
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.engine import SyncEngine, sync_status
from pilih_jobs.sync.flusher import conflict_revision
from pilih_jobs.sync.outbox import Outbox, OutboxEntry


def _entry_ref(value: str) -> int | str:
    return int(value) if value.isdigit() else value


async def _run_sync(rt: Runtime, *, push: bool, pull: bool, force: bool) -> dict[str, Any]:
    # The same flush hooks as the worker and `apply` (20 §6.3 A, 20 §7): a task result that
    # dies with 409 lease_lost becomes late evidence, and postings:batch outcomes update the
    # seen-postings cache. Imported here: `--help` stays fast.
    from pilih_jobs.tasks.hooks import convert_dead_results, task_hooks

    hooks = task_hooks(rt.db, rt.issuer)
    if push:
        # Results that died while a process without these hooks flushed (older versions).
        convert_dead_results(rt.db, rt.issuer)
    async with rt.api_client() as api:
        engine = SyncEngine(
            rt.db,
            rt.issuer,
            api,
            state_lock=rt.state_lock,
            hooks=hooks,
            upload_root=rt.paths.data_dir,
        )
        try:
            report = await engine.sync(push=push, pull=pull, force=force)
        except NetworkError as exc:
            depth = engine.outbox.depth()
            raise UnavailableError(
                f"{exc.message}. {depth} change(s) stay queued.",
                details={"queued": depth},
            ) from exc
    data = report.as_dict()
    if report.push.paused == "auth":
        raise NotAuthenticatedError(
            f"Sync stopped: {report.push.pause_message} Queued changes are kept.",
            details=data,
        )
    if report.push.paused == "upgrade":
        raise UpgradeRequiredError(
            report.push.pause_message or "Upgrade required.", details=data, hint="pilih-jobs update"
        )
    return data


async def _rebased_body(rt: Runtime, entry: OutboxEntry) -> Any:
    body = entry.json()
    if not isinstance(body, dict) or "base_revision" not in body:
        raise UsageError("Only conditional changes (with base_revision) can be retried.")
    revision = conflict_revision(entry)
    if revision is None:
        resource = entry.path.rsplit("/", 1)[0] if entry.path.endswith("/move") else entry.path
        async with rt.api_client() as api:
            current = cast(dict[str, Any], await api.get(resource))
        revision = current.get("revision")
        for value in current.values():
            if isinstance(value, dict) and "revision" in value:
                revision = cast(dict[str, Any], value)["revision"]
                break
    if not isinstance(revision, int):
        raise ConflictError("The current revision could not be determined; retry later.")
    return {**cast(dict[str, Any], body), "base_revision": revision}


def _find(outbox: Outbox, ref: str) -> OutboxEntry:
    entry = outbox.get(_entry_ref(ref))
    if entry is None:
        raise NotFoundError(f"No outbox entry {ref}.")
    return entry


def _status_human(console: Console, value: Any) -> None:
    data = cast(dict[str, Any], value)
    counts = cast(dict[str, int], data["outbox"])
    console.print(
        key_value_table(
            {
                "pending": counts["pending"],
                "in flight": counts["inflight"],
                "conflicts": counts["conflict"],
                "dead": counts["dead"],
                "done": counts["done"],
                "pending > 24 h": data["stale_24h"],
                "cursor": data["cursor"],
                "last pull": data["last_pull_at"] or "never",
                "last push": data["last_push_at"] or "never",
            }
        )
    )
    problems = cast(list[dict[str, Any]], data["problems"])
    if problems:
        console.print(
            items_table(problems, ["id", "state", "method", "path", "last_status", "last_error"])
        )
        console.print(
            "Inspect with `sync --show ID`, retry with `sync --retry ID`, drop with "
            "`sync --discard ID`.",
            markup=False,
        )


def _sync(
    ctx: typer.Context,
    force: Annotated[
        bool, typer.Option("--force", help="Full snapshot resync of the local cache.")
    ] = False,
    status_only: Annotated[
        bool, typer.Option("--status", help="Report outbox and cursor state only (works offline).")
    ] = False,
    push_only: Annotated[bool, typer.Option("--push-only", help="Only flush the outbox.")] = False,
    pull_only: Annotated[bool, typer.Option("--pull-only", help="Only pull changes.")] = False,
    show: Annotated[
        str | None, typer.Option("--show", help="Show one outbox entry (id or key).", metavar="ID")
    ] = None,
    retry: Annotated[
        str | None,
        typer.Option(
            "--retry",
            help="Re-send a dead/conflicting conditional change with a fresh key.",
            metavar="ID",
        ),
    ] = None,
    discard: Annotated[
        str | None, typer.Option("--discard", help="Drop a dead/conflicting entry.", metavar="ID")
    ] = None,
) -> None:
    """Flush queued changes to the cloud, then pull changes into the local cache."""
    st: CliState = state(ctx)
    if push_only and pull_only:
        raise UsageError("--push-only and --pull-only are mutually exclusive.")
    rt = st.runtime()
    outbox = Outbox(rt.db, rt.issuer)
    if show is not None:
        entry = _find(outbox, show)
        st.out.result({**entry.summary(), "body": entry.json()})
        return
    if discard is not None:
        entry = _find(outbox, discard)
        if st.confirm(f"Discard outbox entry {entry.id} ({entry.method} {entry.path})?"):
            outbox.discard(entry.id)
        st.out.result({"discarded": entry.id})
        return
    if retry is not None:
        entry = _find(outbox, retry)
        if entry.state not in ("dead", "conflict"):
            raise UsageError(
                f"Entry {entry.id} is {entry.state}; only dead or conflict entries can be retried."
            )
        body = st.run(_rebased_body(rt, entry))
        if not st.confirm(
            f"Re-send {entry.method} {entry.path} based on revision {body['base_revision']}?"
        ):
            st.out.result({"retried": False})
            return
        fresh = outbox.rebase(entry.id, body)
        st.out.result({"retried": True, "entry": fresh.summary()})
        return
    if status_only:
        st.out.result(sync_status(rt.db, rt.issuer), human=_status_human)
        return
    data = st.run(_run_sync(rt, push=not pull_only, pull=not push_only, force=force))

    def human(console: Console, value: Any) -> None:
        info = cast(dict[str, Any], value)
        console.print(
            f"Pushed {info['pushed']}, pulled {info['pulled']}"
            + (" (full snapshot)" if info.get("snapshot") else "")
            + f"; {info['outbox_depth']} queued, {info['conflicts']} conflicts, "
            + f"{info['dead']} dead.",
            markup=False,
        )

    st.out.result(data, human=human)


def register(app: typer.Typer) -> None:
    app.command("sync")(_sync)
