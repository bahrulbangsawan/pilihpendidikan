"""`inbox list|show|track|dismiss` — discovery results waiting for a decision (15, 05 §4).

`track` creates applications (`POST /api/v1/applications` per id when `--mode`/`--stage` are
given, else the bulk `track` action); `dismiss` uses `POST /api/v1/inbox:bulk` (≤ 200 ids per
request, coalesced in the outbox when offline). Both report per-id results.
"""

from __future__ import annotations

from typing import Annotated, Any, Final, cast

import typer
from rich.console import Console

from pilih_jobs.api.client import ApiClient
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
from pilih_jobs.contracts import ids
from pilih_jobs.contracts.stage import STAGES
from pilih_jobs.errors import PilihError, UsageError
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.cache import EntityCache

group = typer.Typer(
    name="inbox", help="Discovery results waiting for a decision (15, 05 §4).", no_args_is_help=True
)

INBOX_STATES: Final = ("new", "seen", "dismissed", "tracked")
BULK_MAX: Final = 200
CONFIRM_ABOVE: Final = 50


def _check_ids(values: list[str]) -> list[str]:
    bad = [v for v in values if not ids.is_id("ujb", v)]
    if bad:
        raise UsageError(f"Not a ujb_… id: {', '.join(bad)}")
    return list(dict.fromkeys(values))


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
) -> None:
    """List inbox items from the cloud."""
    st = state(ctx)
    if inbox_state not in INBOX_STATES:
        raise UsageError(f"--state must be one of {', '.join(INBOX_STATES)}.")
    rt = st.runtime()

    async def fetch(api: ApiClient) -> list[dict[str, Any]]:
        page = cast(
            dict[str, Any],
            await api.get(
                "/api/v1/inbox",
                {
                    "state": inbox_state,
                    "min_score": min_score,
                    "source": source,
                    "limit": limit,
                    "q": q,
                },
            ),
        )
        return [_row(i) for i in cast(list[dict[str, Any]], page.get("items") or [])]

    def cached() -> list[dict[str, Any]] | None:
        cache = EntityCache(rt.db, rt.issuer)
        rows: list[dict[str, Any]] = []
        for user_job in cache.list("user_job", lambda u: u.get("inbox_state") == inbox_state):
            posting = cache.get("posting", str(user_job.get("posting_id"))) or {}
            rows.append(_row({"user_job": user_job, "posting": posting}))
        return rows[:limit]

    items, banner = st.run(fetch_or_cache(rt, fetch, cached))
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


async def _bulk(rt: Runtime, action: str, user_job_ids: list[str]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for start in range(0, len(user_job_ids), BULK_MAX):
        chunk = user_job_ids[start : start + BULK_MAX]
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
        results += cast(list[dict[str, Any]], data.get("results") or [])
    return results


@group.command("track")
def track_cmd(
    ctx: typer.Context,
    user_job_ids: Annotated[list[str], typer.Argument(help="ujb_… ids")],
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

    async def run() -> list[dict[str, Any]]:
        if mode is None and stage is None:
            return await _bulk(rt, "track", values)
        results: list[dict[str, Any]] = []
        async with rt.api_client() as api:
            for user_job_id in values:
                try:
                    data = await track_one(rt, user_job_id, mode=mode, stage=stage, api=api)
                except PilihError as exc:
                    if exc.exit == 7:
                        raise
                    results.append(
                        {"user_job_id": user_job_id, "status": "error", "error": exc.code}
                    )
                    continue
                app = cast(dict[str, Any], data["application"])
                results.append(
                    {"user_job_id": user_job_id, "status": "ok", "application_id": app["id"]}
                )
        return results

    results = st.run(run())
    st.out.result({"results": results})


@group.command("dismiss")
def dismiss_cmd(
    ctx: typer.Context,
    user_job_ids: Annotated[list[str], typer.Argument(help="ujb_… ids")],
) -> None:
    """Dismiss inbox items; per-id results (asks above 50 items unless --yes)."""
    st = state(ctx)
    values = _check_ids(user_job_ids)
    if len(values) > CONFIRM_ABOVE and not st.confirm(
        f"Dismiss {len(values)} items?", default=False
    ):
        st.out.result({"results": [], "cancelled": True})
        return
    rt = st.runtime()
    results = st.run(_bulk(rt, "dismiss", values))
    st.out.result({"results": results})


def register(app: typer.Typer) -> None:
    app.add_typer(group, name="inbox")
