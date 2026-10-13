"""`inbox list|show|track|dismiss` — discovery results waiting for a decision (15, 05 §4).

`track` creates applications (`POST /api/v1/applications` per id when `--mode`/`--stage` are
given, else the bulk `track` action); `dismiss`, `seen` and `restore` use
`POST /api/v1/inbox:bulk` (≤ 200 ids per request, queued in the outbox when offline). All of
them dedupe the ids and report per-id results with a summary (`cli.bulk`).
"""

from __future__ import annotations

from typing import Annotated, Any, Final, cast

import typer
from rich.console import Console

from pilih_jobs.api.client import ApiClient
from pilih_jobs.cli import bulk
from pilih_jobs.cli.board import (
    MODES,
    emit_result,
    fetch_or_cache,
    fmt_ms,
    online_or_queue,
    track_one,
)
from pilih_jobs.cli.context import state
from pilih_jobs.cli.output import items_table, key_value_table
from pilih_jobs.contracts.stage import STAGES
from pilih_jobs.errors import ExitCode, UnavailableError, UsageError
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.cache import EntityCache
from pilih_jobs.sync.outbox import Outbox

group = typer.Typer(
    name="inbox", help="Discovery results waiting for a decision (15, 05 §4).", no_args_is_help=True
)

INBOX_STATES: Final = ("new", "seen", "dismissed", "tracked")
BULK_MAX: Final = 200
CONFIRM_ABOVE: Final = 50


def _check_ids(values: list[str]) -> list[str]:
    return bulk.check_ids("ujb", values)


def _row(item: dict[str, Any]) -> dict[str, Any]:
    user_job = cast(dict[str, Any], item.get("user_job") or {})
    posting = cast(dict[str, Any], item.get("posting") or {})
    score = cast(dict[str, Any] | None, item.get("score"))
    provenance = cast(dict[str, Any], item.get("provenance") or {})
    return {
        "user_job_id": user_job.get("id"),
        "title": posting.get("title"),
        "company": posting.get("company_name"),
        "score": score.get("score") if score else None,
        "source": provenance.get("source_label") or provenance.get("source_kind"),
        "first_seen_at": posting.get("first_seen_at"),
        "inbox_state": user_job.get("inbox_state"),
    }


@group.command("list")
def list_cmd(
    ctx: typer.Context,
    inbox_state: Annotated[str, typer.Option("--state", help="new|seen|dismissed|tracked")] = "new",
    min_score: Annotated[
        int | None, typer.Option("--min-score", min=0, max=100, help="Minimum match score.")
    ] = None,
    source: Annotated[
        str | None, typer.Option("--source", help="src_… id or an adapter / source kind.")
    ] = None,
    limit: Annotated[int, typer.Option("--limit", min=1, max=200, help="At most N items.")] = 50,
    q: Annotated[str | None, typer.Option("--q", help="Search title / company.")] = None,
    every: Annotated[
        bool, typer.Option("--all", help="Every matching item (pages through; ignores --limit).")
    ] = False,
    ids_only: Annotated[
        bool, typer.Option("--ids", help="Print only the ujb_… ids, one per line (for piping).")
    ] = False,
) -> None:
    """List inbox items from the cloud.

    `--ids` feeds the bulk commands:
    `pilih-jobs inbox dismiss $(pilih-jobs inbox list --ids --all)`.
    """
    st = state(ctx)
    if inbox_state not in INBOX_STATES:
        raise UsageError(f"--state must be one of {', '.join(INBOX_STATES)}.")
    rt = st.runtime()

    async def fetch(api: ApiClient) -> list[dict[str, Any]]:
        found = await bulk.collect_pages(
            api,
            "/api/v1/inbox",
            {"state": inbox_state, "min_score": min_score, "source": source, "q": q},
            limit=None if every else limit,
        )
        return [_row(i) for i in found]

    def cached() -> list[dict[str, Any]] | None:
        cache = EntityCache(rt.db, rt.issuer)
        rows: list[dict[str, Any]] = []
        for user_job in cache.list("user_job", lambda u: u.get("inbox_state") == inbox_state):
            posting = cache.get("posting", str(user_job.get("posting_id"))) or {}
            rows.append(_row({"user_job": user_job, "posting": posting}))
        return rows if every else rows[:limit]

    items, banner = st.run(fetch_or_cache(rt, fetch, cached))
    if ids_only:
        if banner:
            st.out.notice(banner)
        bulk.print_ids(st, (i.get("user_job_id") for i in items))
        return
    data: dict[str, Any] = {"items": items}
    if banner:
        data["offline"] = banner

    def human(console: Console, value: Any) -> None:
        rows = [
            {**r, "first_seen_at": fmt_ms(r.get("first_seen_at"))}
            for r in cast(list[dict[str, Any]], cast(dict[str, Any], value)["items"])
        ]
        console.print(items_table(rows) if rows else "(inbox empty)")

    emit_result(st, data, human)


@group.command("show")
def show_cmd(
    ctx: typer.Context,
    user_job_id: Annotated[str, typer.Argument(help="ujb_… id")],
    description: Annotated[
        bool, typer.Option("--description", help="Include the full job description.")
    ] = False,
) -> None:
    """Posting detail with the score breakdown."""
    st = state(ctx)
    _check_ids([user_job_id])
    rt = st.runtime()

    async def fetch(api: ApiClient) -> dict[str, Any]:
        return cast(dict[str, Any], await api.get(f"/api/v1/user-jobs/{user_job_id}"))

    def cached() -> dict[str, Any] | None:
        cache = EntityCache(rt.db, rt.issuer)
        user_job = cache.get("user_job", user_job_id)
        if user_job is None:
            return None
        posting = cache.get("posting", str(user_job.get("posting_id"))) or {}
        return {"user_job": user_job, "posting": posting, "score": None, "application": None}

    detail, banner = st.run(fetch_or_cache(rt, fetch, cached))
    data = dict(detail)
    if not description:
        posting = dict(cast(dict[str, Any], data.get("posting") or {}))
        text = str(posting.get("description_text") or "")
        if len(text) > 400:
            posting["description_text"] = text[:400] + "…"
        data["posting"] = posting
    if banner:
        data["offline"] = banner

    def human(console: Console, value: Any) -> None:
        info = cast(dict[str, Any], value)
        posting = cast(dict[str, Any], info.get("posting") or {})
        score = cast(dict[str, Any] | None, info.get("score"))
        console.print(
            key_value_table(
                {
                    "job": f"{posting.get('title')} — {posting.get('company_name')}",
                    "location": ", ".join(
                        str(loc.get("raw"))
                        for loc in cast(list[dict[str, Any]], posting.get("locations") or [])
                    ),
                    "apply": posting.get("apply_url"),
                    "status": posting.get("status"),
                    "score": score.get("score") if score else None,
                    "why": score.get("explanation") if score else None,
                    "inbox": cast(dict[str, Any], info.get("user_job") or {}).get("inbox_state"),
                }
            )
        )
        if description or posting.get("description_text"):
            console.print(str(posting.get("description_text") or ""), markup=False)

    emit_result(st, data, human)


_STATUS: Final = {"ok": "ok", "conflict": "conflict", "not_found": "not_found"}
_EXIT: Final = {"conflict": ExitCode.CONFLICT, "not_found": ExitCode.NOT_FOUND}


def _outcome(result: dict[str, Any]) -> bulk.Outcome:
    """A server per-id result (`ok|conflict|not_found|invalid`) as a bulk outcome."""
    user_job_id = str(result.get("user_job_id"))
    raw = str(result.get("status"))
    status = _STATUS.get(raw, "failed")
    fields: dict[str, Any] = {"user_job_id": user_job_id}
    for key in ("inbox_state", "application_id", "score_status"):
        if result.get(key) is not None:
            fields[key] = result[key]
    if status == "ok":
        return bulk.Outcome(user_job_id, "ok", fields)
    message = result.get("error")
    return bulk.Outcome(
        user_job_id,
        status,
        fields,
        error=raw,
        message=str(message) if message else None,
        exit=int(_EXIT.get(status, ExitCode.FAILURE)),
    )


async def _bulk(rt: Runtime, action: str, user_job_ids: list[str]) -> list[bulk.Outcome]:
    """`POST /api/v1/inbox:bulk` in chunks of ≤ 200 ids.

    Offline, the failed chunk and every chunk after it are queued in the outbox (same order),
    then the command exits 7 with the results of the chunks already sent.
    """
    chunks = [user_job_ids[i : i + BULK_MAX] for i in range(0, len(user_job_ids), BULK_MAX)]
    outcomes: list[bulk.Outcome] = []
    for index, chunk in enumerate(chunks):
        try:
            data = cast(
                dict[str, Any],
                await online_or_queue(
                    rt,
                    "POST",
                    "/api/v1/inbox:bulk",
                    {"user_job_ids": chunk, "action": action},
                    ordering_key="inbox",
                    kind="append",
                ),
            )
        except UnavailableError as exc:
            if exc.code != "queued":
                raise
            outbox = Outbox(rt.db, rt.issuer)
            with rt.db.transaction():
                for rest in chunks[index + 1 :]:
                    outbox.enqueue(
                        "POST",
                        "/api/v1/inbox:bulk",
                        {"user_job_ids": rest, "action": action},
                        ordering_key="inbox",
                        kind="append",
                    )
            exc.details["queued"] = outbox.depth()
            if outcomes:
                exc.details["results"] = [o.as_dict() for o in outcomes]
            raise
        outcomes += [_outcome(r) for r in cast(list[dict[str, Any]], data.get("results") or [])]
    return outcomes


INBOX_RESULT_COLUMNS: Final = ("id", "status", "inbox_state", "application_id")


@group.command("track")
def track_cmd(
    ctx: typer.Context,
    user_job_ids: Annotated[list[str], typer.Argument(help="ujb_… ids", metavar="UJB_ID...")],
    mode: Annotated[
        str | None, typer.Option("--mode", help="manual|assisted|approval|auto")
    ] = None,
    stage: Annotated[
        str | None, typer.Option("--stage", help="Initial stage (default saved).")
    ] = None,
) -> None:
    """Track inbox items (creates applications); per-id results."""
    st = state(ctx)
    values = _check_ids(user_job_ids)
    if mode is not None and mode not in MODES:
        raise UsageError(f"--mode must be one of {', '.join(MODES)}.")
    if stage is not None and stage not in STAGES:
        raise UsageError(f"--stage must be one of {', '.join(STAGES)}.")
    rt = st.runtime()

    async def run() -> list[bulk.Outcome]:
        if mode is None and stage is None:
            return await _bulk(rt, "track", values)
        async with rt.api_client() as api:

            async def one(user_job_id: str) -> bulk.Outcome:
                data = await track_one(rt, user_job_id, mode=mode, stage=stage, api=api)
                app = cast(dict[str, Any], data["application"])
                return bulk.ok(user_job_id, user_job_id=user_job_id, application_id=app["id"])

            outcomes = await bulk.run_each(values, one)
        for outcome in outcomes:
            outcome.fields.setdefault("user_job_id", outcome.id)
        return outcomes

    bulk.emit(st, st.run(run()), columns=INBOX_RESULT_COLUMNS)


def _bulk_cmd(ctx: typer.Context, action: str, verb: str, user_job_ids: list[str]) -> None:
    st = state(ctx)
    values = _check_ids(user_job_ids)
    if len(values) > CONFIRM_ABOVE and not st.confirm(
        f"{verb} {len(values)} items?", default=False
    ):
        st.out.result({"results": [], "summary": bulk.summary([]), "cancelled": True})
        return
    rt = st.runtime()
    bulk.emit(st, st.run(_bulk(rt, action, values)), columns=INBOX_RESULT_COLUMNS)


@group.command("dismiss")
def dismiss_cmd(
    ctx: typer.Context,
    user_job_ids: Annotated[list[str], typer.Argument(help="ujb_… ids", metavar="UJB_ID...")],
) -> None:
    """Dismiss inbox items; per-id results (asks above 50 items unless --yes)."""
    _bulk_cmd(ctx, "dismiss", "Dismiss", user_job_ids)


@group.command("seen")
def seen_cmd(
    ctx: typer.Context,
    user_job_ids: Annotated[list[str], typer.Argument(help="ujb_… ids", metavar="UJB_ID...")],
) -> None:
    """Mark inbox items seen; per-id results (asks above 50 items unless --yes)."""
    _bulk_cmd(ctx, "seen", "Mark as seen", user_job_ids)


@group.command("restore")
def restore_cmd(
    ctx: typer.Context,
    user_job_ids: Annotated[list[str], typer.Argument(help="ujb_… ids", metavar="UJB_ID...")],
) -> None:
    """Bring dismissed items back to the inbox (as seen); other items are left as they are."""
    _bulk_cmd(ctx, "restore", "Restore", user_job_ids)


def register(app: typer.Typer) -> None:
    app.add_typer(group, name="inbox")
