"""Board and application commands (06 §11 parity, 16 §3.3, 10 §6): `board`, `list`, `show`,
`track`, `move`, `applied`, `confirm`, `edit`, `note`, `checklist`, `interview`, `offer`,
`follow-up`, `archive`, `rm`, `score`, `stats`.

Offline behaviour (20 §10): reads fall back to the entity cache with a banner
("offline — data as of …"); mutations are queued in the outbox with the same idempotency key
and exit 7 with `{"queued": n}`. Conditional writes carry `base_revision` (from the cache when
known); a `409 revision_conflict` is shown and asked again in an interactive session, and is
exit 6 otherwise (20 §6.2).

This module also hosts the helpers shared by the other command groups of leaf 4.4
(`online_or_queue`, `require_scope`, `fetch_or_cache`, time parsing).
"""

from __future__ import annotations

import asyncio
import copy
import json
import re
import time
from collections.abc import Awaitable, Callable, Sequence
from datetime import UTC, datetime
from typing import Annotated, Any, Final, TypeVar, cast

import typer
from rich.console import Console
from rich.table import Table

from pilih_jobs.api.client import ApiClient
from pilih_jobs.api.errors import ApiConflictError, NetworkError
from pilih_jobs.cli.context import CliState, state
from pilih_jobs.cli.output import items_table, key_value_table
from pilih_jobs.contracts import ids
from pilih_jobs.contracts.stage import STAGES, can_transition
from pilih_jobs.errors import (
    ConflictError,
    InputRequiredError,
    NotAuthenticatedError,
    NotFoundError,
    PermissionDeniedError,
    PilihError,
    UnavailableError,
    UsageError,
)
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.cache import EntityCache
from pilih_jobs.sync.engine import SyncEngine
from pilih_jobs.sync.outbox import PRIORITY_DEFAULT, Outbox, OutboxKind

T = TypeVar("T")

PRIORITIES: Final = {"high": 1, "normal": 0, "low": -1, "1": 1, "0": 0, "-1": -1}
MODES: Final = ("manual", "assisted", "approval", "auto")
INTERVIEW_KINDS: Final = (
    "phone_screen",
    "technical",
    "take_home",
    "onsite",
    "behavioral",
    "final",
    "other",
)
SUBMISSION_METHODS: Final = ("browser", "email", "ats_api", "manual")
SECTIONS_MAX_ITEMS: Final = 200
SECTIONS_MAX_BYTES: Final = 65_536
_DURATION = re.compile(r"^(\d{1,4})([hdw])$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?)?$")


# ============================================================================ shared helpers
def require_scope(st: CliState, rt: Runtime, scope: str, *, purpose: str) -> None:
    """Step-up scopes (17 §5.1, D-29): offer `login --scope` interactively, else exit 4."""
    account = rt.account()
    if account is None:
        if rt.personal_token:
            return  # a personal token: the server decides
        raise NotAuthenticatedError()
    if scope in account.scopes:
        return
    if st.interactive and st.confirm(
        f"{purpose} needs the extra permission {scope!r}. Open the browser to grant it now?",
        default=True,
    ):
        from pilih_jobs.auth.flow import LoginOptions, login

        options = LoginOptions(scopes=[scope], device_name=account.device_name)
        options.announce = lambda message: st.out.console(err=True).print(message, markup=False)
        st.run(login(rt, options))
        refreshed = rt.account()
        if refreshed is not None and scope in refreshed.scopes:
            return
    raise PermissionDeniedError(
        f"{purpose} needs the step-up scope {scope}.",
        code="insufficient_scope",
        details={"scope": scope},
        hint=f"pilih-jobs login --scope {scope}",
    )


def require_device(rt: Runtime) -> str:
    account = rt.account()
    if account is None:
        raise NotAuthenticatedError(
            "This command needs an OAuth device login (personal tokens are read-only)."
        )
    if not account.device_id:
        raise PermissionDeniedError("This login has no device.", code="device_required")
    return account.device_id


async def online_or_queue(
    rt: Runtime,
    method: str,
    path: str,
    body: Any = None,
    *,
    ordering_key: str,
    kind: OutboxKind = "conditional",
    idempotency_key: str | None = None,
    priority: int = PRIORITY_DEFAULT,
    api: ApiClient | None = None,
) -> Any:
    """Send now; on a network failure queue the same request (same key) and exit 7."""
    key = idempotency_key or ids.new_ulid()
    try:
        if api is not None:
            return (await api.request(method, path, json_body=body, idempotency_key=key)).data
        async with rt.api_client() as client:
            return (await client.request(method, path, json_body=body, idempotency_key=key)).data
    except NetworkError as exc:
        outbox = Outbox(rt.db, rt.issuer)
        with rt.db.transaction():
            outbox.enqueue(
                method,
                path,
                body,
                ordering_key=ordering_key,
                kind=kind,
                priority=priority,
                idempotency_key=key,
            )
        depth = outbox.depth()
        raise UnavailableError(
            f"Offline: the change was queued and will be sent by `pilih-jobs sync` "
            f"({depth} queued).",
            code="queued",
            details={"queued": depth, "idempotency_key": key, "path": path},
        ) from exc


def offline_banner(rt: Runtime, reason: str) -> str:
    row = rt.db.query_one("SELECT last_pull_at FROM sync_state WHERE issuer = ?", (rt.issuer,))
    at = row["last_pull_at"] if row is not None else None
    when = (
        datetime.fromtimestamp(int(at) / 1000).astimezone().strftime("%Y-%m-%d %H:%M")
        if at
        else "never"
    )
    return f"offline — data as of {when} ({reason})"


async def fetch_or_cache(
    rt: Runtime,
    fetch: Callable[[ApiClient], Awaitable[T]],
    fallback: Callable[[], T | None],
) -> tuple[T, str | None]:
    """Online read; on a network failure the cached view plus an offline banner."""
    try:
        async with rt.api_client() as api:
            return await fetch(api), None
    except NetworkError as exc:
        cached = fallback()
        if cached is None:
            raise UnavailableError(f"Offline and nothing cached: {exc.message}") from exc
        return cached, offline_banner(rt, exc.message)


async def pull_quietly(rt: Runtime, api: ApiClient) -> None:
    """Refresh the cache before reading revisions from it (20 §4.1); errors are ignored."""
    try:
        await SyncEngine(rt.db, rt.issuer, api).pull()
    except PilihError:
        return


def parse_when(text: str, *, now_ms: int | None = None) -> int | None:
    """`7d` / `2w` / `12h` (from now), `YYYY-MM-DD[THH:MM]` (local), `none`/`clear` → None."""
    value = text.strip().lower()
    if value in ("none", "clear", "off", ""):
        return None
    now = now_ms if now_ms is not None else ids.now_ms()
    if match := _DURATION.match(value):
        amount = int(match.group(1))
        unit = {"h": 3_600_000, "d": 86_400_000, "w": 7 * 86_400_000}[match.group(2)]
        return now + amount * unit
    if _DATE.match(value):
        parsed = datetime.fromisoformat(value.replace(" ", "T"))
        if parsed.tzinfo is None:
            parsed = parsed.astimezone()
        if len(value) == 10:
            parsed = parsed.replace(hour=9, minute=0)
        return int(parsed.timestamp() * 1000)
    raise UsageError(f"{text!r} is not a duration (7d, 2w, 12h) or a date (YYYY-MM-DD).")


def fmt_ms(value: Any) -> str:
    if not isinstance(value, int):
        return "-"
    return datetime.fromtimestamp(value / 1000, tz=UTC).astimezone().strftime("%Y-%m-%d %H:%M")


def check_app_id(value: str) -> str:
    if not ids.is_id("app", value):
        raise UsageError(f"{value!r} is not an application id (app_…).")
    return value


async def get_application(api: ApiClient, rt: Runtime, app_id: str) -> dict[str, Any]:
    detail = cast(dict[str, Any], await api.get(f"/api/v1/applications/{app_id}"))
    EntityCache(rt.db, rt.issuer).put("application", cast(dict[str, Any], detail["application"]))
    return detail


async def base_revision(api: ApiClient, rt: Runtime, app_id: str) -> dict[str, Any]:
    """The application record to base a conditional write on (cache first, 16 §3.3)."""
    await pull_quietly(rt, api)
    cached = EntityCache(rt.db, rt.issuer).get("application", app_id)
    if cached is not None and isinstance(cached.get("revision"), int):
        return cached
    return cast(dict[str, Any], (await get_application(api, rt, app_id))["application"])


async def conditional_application_write(
    st: CliState,
    rt: Runtime,
    app_id: str,
    build: Callable[[dict[str, Any]], tuple[str, str, dict[str, Any]]],
    *,
    describe: str,
) -> dict[str, Any]:
    """Send `build(current)` with `base_revision`; on 409 show the change and ask again."""
    async with rt.api_client() as api:
        try:
            current = await base_revision(api, rt, app_id)
        except NetworkError:
            cached = EntityCache(rt.db, rt.issuer).get("application", app_id)
            if cached is None:
                raise
            current = cached
        for _ in range(3):
            method, path, body = build(current)
            try:
                data = await online_or_queue(
                    rt, method, path, body, ordering_key=f"app:{app_id}", api=api
                )
            except ApiConflictError as exc:
                fresh = exc.current
                if exc.error != "revision_conflict" or fresh is None:
                    raise
                EntityCache(rt.db, rt.issuer).put("application", fresh)
                question = (
                    f"{app_id} changed on {fresh.get('last_change_source', 'another device')} "
                    f"(now {fresh.get('stage')}, revision {fresh.get('revision')}). "
                    f"Still {describe}?"
                )
                if not st.interactive:
                    raise ConflictError(
                        question.replace("Still", "Not applied:").rstrip("?") + ".",
                        code="revision_conflict",
                        details={"current": fresh},
                    ) from exc
                if not st.confirm(question, default=False):
                    raise ConflictError("Cancelled; nothing was changed.") from exc
                current = fresh
                continue
            result = cast(dict[str, Any], data or {})
            app = result.get("application")
            if isinstance(app, dict):
                EntityCache(rt.db, rt.issuer).put("application", cast(dict[str, Any], app))
            return result
    raise ConflictError(f"{app_id} keeps changing; try again later.")


async def resolve_app(rt: Runtime, ref: str) -> str:
    """`app_…`, or a legacy job id (06 §12): cache first, then the application list."""
    if ids.is_id("app", ref):
        return ref
    for app in EntityCache(rt.db, rt.issuer).list("application"):
        if app.get("legacy_job_id") == ref:
            return str(app["id"])
    async with rt.api_client() as api:
        cursor: str | None = None
        for _ in range(50):
            page = cast(
                dict[str, Any],
                await api.get(
                    "/api/v1/applications",
                    {"limit": 200, "cursor": cursor, "include_archived": "1"},
                ),
            )
            for card in cast(list[dict[str, Any]], page.get("items") or []):
                if card.get("legacy_job_id") == ref:
                    return str(card["id"])
            cursor = cast(str | None, page.get("next_cursor"))
            if not cursor:
                break
    raise NotFoundError(f"No application {ref!r} (expected app_… or a legacy job id).")


def stream_event(st: CliState, kind: str, fields: dict[str, Any]) -> None:
    """An NDJSON progress event (16 §5); field names never clash with `type`/`ts`."""
    renamed = {
        ("task_kind" if key == "kind" else key): value
        for key, value in fields.items()
        if key not in ("type", "ts")
    }
    st.out.event(kind, **renamed)


def emit_result(
    st: CliState, data: Any, human: Callable[[Console, Any], None] | None = None
) -> None:
    banner = cast(dict[str, Any], data).get("offline") if isinstance(data, dict) else None
    if banner:
        st.out.notice(str(banner))
    st.out.result(data, human=human)


# ============================================================================ cached views
def _cached_card(rt: Runtime, app: dict[str, Any]) -> dict[str, Any]:
    cache = EntityCache(rt.db, rt.issuer)
    posting: dict[str, Any] = {}
    user_job = cache.get("user_job", str(app.get("user_job_id")))
    if user_job is not None:
        posting = cache.get("posting", str(user_job.get("posting_id"))) or {}
    return {
        "id": app.get("id"),
        "revision": app.get("revision"),
        "stage": app.get("stage"),
        "submission_status": app.get("submission_status"),
        "mode": app.get("mode"),
        "priority": app.get("priority"),
        "archived": app.get("archived"),
        "follow_up_at": app.get("follow_up_at"),
        "board_rank": app.get("board_rank"),
        "legacy_job_id": app.get("legacy_job_id"),
        "posting": {
            "title": posting.get("title"),
            "company_name": posting.get("company_name"),
            "apply_url": posting.get("apply_url"),
        },
        "score": None,
    }


def _cached_cards(
    rt: Runtime, *, stage: str | None = None, archived: bool = False
) -> list[dict[str, Any]]:
    apps = EntityCache(rt.db, rt.issuer).list(
        "application",
        lambda a: (
            (stage is None or a.get("stage") == stage) and (archived or not a.get("archived"))
        ),
    )
    apps.sort(
        key=lambda a: (
            STAGES.index(a["stage"]) if a.get("stage") in STAGES else 99,
            str(a.get("board_rank")),
        )
    )
    return [_cached_card(rt, a) for a in apps]


def _card_row(card: dict[str, Any]) -> dict[str, Any]:
    posting = cast(dict[str, Any], card.get("posting") or {})
    score = cast(dict[str, Any] | None, card.get("score"))
    live = cast(dict[str, Any] | None, card.get("live_task"))
    return {
        "id": card.get("id"),
        "stage": card.get("stage"),
        "title": posting.get("title"),
        "company": posting.get("company_name"),
        "score": score.get("score") if score else None,
        "submission": card.get("submission_status"),
        "mode": card.get("mode"),
        "follow_up": fmt_ms(card.get("follow_up_at")) if card.get("follow_up_at") else None,
        "task": live.get("state") if live else None,
    }


# ============================================================================ board / list
async def _board(api: ApiClient, include_archived: bool) -> dict[str, Any]:
    params = {"include_archived": "1"} if include_archived else None
    return cast(dict[str, Any], await api.get("/api/v1/board", params))


def board_cmd(
    ctx: typer.Context,
    stage: Annotated[
        str | None, typer.Option("--stage", help="Only this stage (column).", metavar="S")
    ] = None,
    include_archived: Annotated[
        bool, typer.Option("--archived", help="Include archived cards.")
    ] = False,
) -> None:
    """Kanban board grouped by stage (GET /api/v1/board; 06 §11)."""
    st = state(ctx)
    if stage is not None and stage not in STAGES:
        raise UsageError(f"--stage must be one of {', '.join(STAGES)}.")
    rt = st.runtime()

    def cached() -> dict[str, Any] | None:
        cards = _cached_cards(rt, archived=include_archived)
        columns = [{"stage": s, "items": [c for c in cards if c["stage"] == s]} for s in STAGES]
        return {"columns": columns, "counts": None}

    raw, banner = st.run(fetch_or_cache(rt, lambda api: _board(api, include_archived), cached))
    columns = [
        {
            "stage": col["stage"],
            "items": col.get("cards", col.get("items", [])),
            "total": col.get("total", len(col.get("cards", col.get("items", [])))),
            "has_more": col.get("has_more", False),
        }
        for col in cast(list[dict[str, Any]], raw["columns"])
        if stage is None or col["stage"] == stage
    ]
    data: dict[str, Any] = {"columns": columns, "counts": raw.get("counts")}
    if banner:
        data["offline"] = banner

    def human(console: Console, value: Any) -> None:
        for column in cast(list[dict[str, Any]], cast(dict[str, Any], value)["columns"]):
            items = cast(list[dict[str, Any]], column["items"])
            console.print(f"{column['stage']} ({column['total']})", markup=False, style="bold")
            if items:
                rows = [_card_row(c) for c in items]
                console.print(
                    items_table(rows, ["id", "title", "company", "score", "submission", "task"])
                )

    emit_result(st, data, human)


def list_cmd(
    ctx: typer.Context,
    stage: Annotated[str | None, typer.Option("--stage", help="Filter by stage.")] = None,
    q: Annotated[str | None, typer.Option("--q", help="Search title / company.")] = None,
    limit: Annotated[int, typer.Option("--limit", min=1, max=200, help="At most N items.")] = 50,
    include_archived: Annotated[
        bool, typer.Option("--archived", help="Include archived applications.")
    ] = False,
) -> None:
    """List applications (GET /api/v1/applications)."""
    st = state(ctx)
    if stage is not None and stage not in STAGES:
        raise UsageError(f"--stage must be one of {', '.join(STAGES)}.")
    rt = st.runtime()

    async def fetch(api: ApiClient) -> list[dict[str, Any]]:
        params: dict[str, Any] = {"stage": stage, "q": q, "limit": limit}
        if include_archived:
            params["include_archived"] = "1"
        page = cast(dict[str, Any], await api.get("/api/v1/applications", params))
        return cast(list[dict[str, Any]], page.get("items") or [])

    def cached() -> list[dict[str, Any]] | None:
        cards = _cached_cards(rt, stage=stage, archived=include_archived)
        if q:
            needle = q.lower()
            cards = [
                c
                for c in cards
                if needle in str(c["posting"].get("title") or "").lower()
                or needle in str(c["posting"].get("company_name") or "").lower()
            ]
        return cards[:limit]

    items, banner = st.run(fetch_or_cache(rt, fetch, cached))
    data: dict[str, Any] = {"items": items}
    if banner:
        data["offline"] = banner

    def human(console: Console, value: Any) -> None:
        rows = [_card_row(c) for c in cast(dict[str, Any], value)["items"]]
        console.print(items_table(rows) if rows else "(no applications)")

    emit_result(st, data, human)


# ============================================================================ show
async def _audit(api: ApiClient, app_id: str, detail: dict[str, Any]) -> dict[str, Any]:
    events: list[dict[str, Any]] = []
    cursor: str | None = None
    for _ in range(200):
        page = cast(
            dict[str, Any],
            await api.get(
                f"/api/v1/applications/{app_id}/events", {"limit": 200, "cursor": cursor}
            ),
        )
        events.extend(cast(list[dict[str, Any]], page.get("items") or []))
        cursor = cast(str | None, page.get("next_cursor"))
        if not cursor:
            break
    tasks = [
        cast(dict[str, Any], await api.get(f"/api/v1/tasks/{task['id']}"))
        for task in cast(list[dict[str, Any]], detail.get("tasks") or [])
    ]
    return {**detail, "events": events, "task_details": tasks}


def show_cmd(
    ctx: typer.Context,
    ref: Annotated[str, typer.Argument(help="app_… id or a legacy job id")],
    audit: Annotated[
        bool,
        typer.Option("--audit", help="Full event and attempt audit trail (21 §14)."),
    ] = False,
) -> None:
    """Application detail with timeline."""
    st = state(ctx)
    rt = st.runtime()

    async def fetch(api: ApiClient) -> dict[str, Any]:
        app_id = await resolve_app(rt, ref)
        detail = await get_application(api, rt, app_id)
        return await _audit(api, app_id, detail) if audit else detail

    def cached() -> dict[str, Any] | None:
        app = EntityCache(rt.db, rt.issuer).get("application", ref)
        if app is None:
            return None
        card = _cached_card(rt, app)
        return {"application": app, "posting": card["posting"]}

    detail, banner = st.run(fetch_or_cache(rt, fetch, cached))
    if banner:
        detail = {**detail, "offline": banner}

    def human(console: Console, value: Any) -> None:
        info = cast(dict[str, Any], value)
        app = cast(dict[str, Any], info["application"])
        posting = cast(dict[str, Any], info.get("posting") or {})
        console.print(
            key_value_table(
                {
                    "application": app["id"],
                    "job": f"{posting.get('title')} — {posting.get('company_name')}",
                    "stage": app.get("stage"),
                    "submission": app.get("submission_status"),
                    "mode": app.get("mode"),
                    "priority": app.get("priority"),
                    "follow-up": fmt_ms(app.get("follow_up_at")),
                    "apply url": posting.get("apply_url"),
                    "revision": app.get("revision"),
                }
            )
        )
        for key in ("interviews", "offers", "approvals", "tasks", "emails"):
            rows = cast(list[dict[str, Any]], info.get(key) or [])
            if rows:
                console.print(f"{key} ({len(rows)})", markup=False, style="bold")
        events = cast(list[dict[str, Any]], info.get("events") or [])
        if events:
            table = Table("when", "type", "actor", "from", "to", box=None, header_style="bold")
            for event in events:
                table.add_row(
                    fmt_ms(event.get("recorded_at")),
                    str(event.get("type")),
                    str(event.get("actor_kind")),
                    str(event.get("from_value") or ""),
                    str(event.get("to_value") or ""),
                )
            console.print(table)

    emit_result(st, detail, human)


# ============================================================================ track
def track_cmd(
    ctx: typer.Context,
    ref: Annotated[
        str, typer.Argument(help="ujb_… id or a job URL (creates a custom_url posting)")
    ],
    mode: Annotated[
        str | None, typer.Option("--mode", help="manual|assisted|approval|auto")
    ] = None,
    stage: Annotated[
        str | None, typer.Option("--stage", help="Initial stage (default saved).")
    ] = None,
) -> None:
    """Track a job: creates an application (a URL creates the posting first)."""
    st = state(ctx)
    if mode is not None and mode not in MODES:
        raise UsageError(f"--mode must be one of {', '.join(MODES)}.")
    if stage is not None and stage not in STAGES:
        raise UsageError(f"--stage must be one of {', '.join(STAGES)}.")
    rt = st.runtime()
    data = st.run(track_one(rt, ref, mode=mode, stage=stage))
    st.out.result(
        data,
        human=lambda c, v: c.print(
            f"Tracking {v['application']['id']} ({v['application']['stage']}).", markup=False
        ),
    )


async def track_one(
    rt: Runtime, ref: str, *, mode: str | None, stage: str | None, api: ApiClient | None = None
) -> dict[str, Any]:
    if api is None:
        async with rt.api_client() as client:
            return await track_one(rt, ref, mode=mode, stage=stage, api=client)
    user_job_id = ref
    if ref.startswith(("http://", "https://")):
        created = cast(dict[str, Any], await api.post("/api/v1/user-jobs", {"url": ref}))
        user_job_id = str(cast(dict[str, Any], created["user_job"])["id"])
    elif not ids.is_id("ujb", ref):
        raise UsageError(f"{ref!r} is neither a ujb_… id nor an http(s) URL.")
    body: dict[str, Any] = {"user_job_id": user_job_id}
    if stage:
        body["stage"] = stage
    if mode:
        body["mode"] = mode
    data = cast(
        dict[str, Any],
        await online_or_queue(
            rt,
            "POST",
            "/api/v1/applications",
            body,
            ordering_key=f"ujb:{user_job_id}",
            kind="append",
            api=api,
        ),
    )
    EntityCache(rt.db, rt.issuer).put("application", cast(dict[str, Any], data["application"]))
    return data


# ============================================================================ move
def move_cmd(
    ctx: typer.Context,
    app_id: Annotated[str, typer.Argument(help="app_… id")],
    stage: Annotated[str, typer.Argument(help="Target stage")],
    before: Annotated[
        str | None, typer.Option("--before", help="Place before this app_… in the column.")
    ] = None,
    after: Annotated[
        str | None, typer.Option("--after", help="Place after this app_… in the column.")
    ] = None,
) -> None:
    """Change stage / reorder (POST …/move with base_revision from the cache)."""
    st = state(ctx)
    check_app_id(app_id)
    if stage not in STAGES:
        raise UsageError(f"stage must be one of {', '.join(STAGES)}.")
    for neighbour in (before, after):
        if neighbour is not None:
            check_app_id(neighbour)
    rt = st.runtime()

    def build(current: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
        here = str(current.get("stage"))
        if here != stage and not can_transition(here, stage, "user"):
            raise PilihError(
                f"{here} → {stage} is not an allowed transition (03 §5.1).",
                code="invalid_transition",
            )
        body: dict[str, Any] = {"base_revision": current["revision"], "stage": stage}
        if before:
            body["before_id"] = before
        if after:
            body["after_id"] = after
        return "POST", f"/api/v1/applications/{app_id}/move", body

    data = st.run(
        conditional_application_write(st, rt, app_id, build, describe=f"move it to {stage}")
    )
    st.out.result(
        data,
        human=lambda c, v: c.print(
            f"{app_id} → {v['application']['stage']} (revision {v['application']['revision']}).",
            markup=False,
        ),
    )


# ============================================================================ submission
def applied_cmd(
    ctx: typer.Context,
    app_id: Annotated[str, typer.Argument(help="app_… id")],
    method: Annotated[
        str, typer.Option("--method", help="browser|email|ats_api|manual")
    ] = "manual",
    date: Annotated[
        str | None, typer.Option("--date", help="When you applied (YYYY-MM-DD; default now).")
    ] = None,
) -> None:
    """Mark applied manually (your attestation; POST …/submission mark_applied)."""
    st = state(ctx)
    check_app_id(app_id)
    if method not in SUBMISSION_METHODS:
        raise UsageError(f"--method must be one of {', '.join(SUBMISSION_METHODS)}.")
    applied_at = parse_when(date) if date else None
    rt = st.runtime()

    def build(current: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
        body: dict[str, Any] = {
            "base_revision": current["revision"],
            "action": "mark_applied",
            "method": method,
        }
        if applied_at is not None:
            body["applied_at"] = applied_at
        return "POST", f"/api/v1/applications/{app_id}/submission", body

    data = st.run(conditional_application_write(st, rt, app_id, build, describe="mark it applied"))
    st.out.result(data)


def confirm_cmd(
    ctx: typer.Context,
    app_id: Annotated[str, typer.Argument(help="app_… id")],
    yes: Annotated[bool, typer.Option("--yes", help="It was submitted (confirm).")] = False,
    no: Annotated[bool, typer.Option("--no", help="It was not submitted (deny).")] = False,
) -> None:
    """Confirm or deny an unverified / unknown submission (POST …/submission)."""
    st = state(ctx)
    check_app_id(app_id)
    if yes and no:
        raise UsageError("--yes and --no are mutually exclusive.")
    if not (yes or no):
        if not st.interactive:
            raise InputRequiredError(
                "Pass --yes (submitted) or --no (not submitted).",
                details={"needed": {"decision": ["--yes", "--no"]}},
            )
        yes = typer.confirm(f"Was {app_id} actually submitted?", default=False)
        no = not yes
    action = "confirm" if yes else "deny"
    rt = st.runtime()

    def build(current: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
        return (
            "POST",
            f"/api/v1/applications/{app_id}/submission",
            {"base_revision": current["revision"], "action": action},
        )

    data = st.run(conditional_application_write(st, rt, app_id, build, describe=action))
    st.out.result(data)


# ============================================================================ edit, archive
def edit_cmd(
    ctx: typer.Context,
    app_id: Annotated[str, typer.Argument(help="app_… id")],
    priority: Annotated[str | None, typer.Option("--priority", help="high|normal|low")] = None,
    follow_up: Annotated[
        str | None,
        typer.Option("--follow-up", help="7d, 2w, YYYY-MM-DD or none.", metavar="WHEN"),
    ] = None,
    mode: Annotated[
        str | None, typer.Option("--mode", help="manual|assisted|approval|auto")
    ] = None,
) -> None:
    """Edit fields (PATCH /api/v1/applications/{id})."""
    st = state(ctx)
    check_app_id(app_id)
    changes: dict[str, Any] = {}
    if priority is not None:
        if priority.lower() not in PRIORITIES:
            raise UsageError("--priority must be high, normal or low.")
        changes["priority"] = PRIORITIES[priority.lower()]
    if follow_up is not None:
        changes["follow_up_at"] = parse_when(follow_up)
    if mode is not None:
        if mode not in MODES:
            raise UsageError(f"--mode must be one of {', '.join(MODES)}.")
        changes["mode"] = mode
    if not changes:
        raise UsageError("Nothing to change: pass --priority, --follow-up or --mode.")
    rt = st.runtime()
    data = st.run(_patch(st, rt, app_id, changes, "edit it"))
    st.out.result(data)


async def _patch(
    st: CliState, rt: Runtime, app_id: str, changes: dict[str, Any], describe: str
) -> dict[str, Any]:
    def build(current: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
        return (
            "PATCH",
            f"/api/v1/applications/{app_id}",
            {"base_revision": current["revision"], **changes},
        )

    return await conditional_application_write(st, rt, app_id, build, describe=describe)


def follow_up_cmd(
    ctx: typer.Context,
    app_id: Annotated[str, typer.Argument(help="app_… id")],
    when: Annotated[str, typer.Argument(help="7d | 2w | YYYY-MM-DD | done | clear")],
) -> None:
    """Set follow_up_at (`done` clears it and notes the completed follow-up, 06 §7)."""
    st = state(ctx)
    check_app_id(app_id)
    rt = st.runtime()
    if when.strip().lower() == "done":

        async def done() -> dict[str, Any]:
            result = await _patch(st, rt, app_id, {"follow_up_at": None}, "clear the follow-up")
            await _note(rt, app_id, "Follow-up done", kind="follow_up_done")
            return result

        st.out.result(st.run(done()))
        return
    at = parse_when(when)
    st.out.result(st.run(_patch(st, rt, app_id, {"follow_up_at": at}, "set the follow-up")))


def archive_cmd(
    ctx: typer.Context,
    app_id: Annotated[str, typer.Argument(help="app_… id")],
    undo: Annotated[bool, typer.Option("--undo", help="Unarchive.")] = False,
) -> None:
    """Archive (hide from the board without changing the stage)."""
    st = state(ctx)
    check_app_id(app_id)
    rt = st.runtime()
    data = st.run(_patch(st, rt, app_id, {"archived": not undo}, "archive it"))
    st.out.result(
        {"archived": not undo, **data},
        human=lambda c, v: c.print(
            f"{app_id} {'unarchived' if undo else 'archived'}.", markup=False
        ),
    )


def rm_cmd(
    ctx: typer.Context,
    app_id: Annotated[str, typer.Argument(help="app_… id")],
    purge: Annotated[
        bool,
        typer.Option("--purge", help="Hard delete (events, interviews, offers, files, tasks)."),
    ] = False,
) -> None:
    """Archive, or with --purge hard-delete an application (asks for confirmation)."""
    st = state(ctx)
    check_app_id(app_id)
    question = (
        f"Permanently delete {app_id} with its events, interviews, offers, CV variants, files "
        "and tasks? This cannot be undone."
        if purge
        else f"Archive {app_id}?"
    )
    if not st.confirm(question, default=False):
        st.out.result({"deleted": False, "archived": False})
        return
    rt = st.runtime()

    async def delete() -> dict[str, Any]:
        async with rt.api_client() as api:
            current = await base_revision(api, rt, app_id)
            params = {"base_revision": current["revision"]}
            if purge:
                params["purge"] = 1
            response = await api.request("DELETE", f"/api/v1/applications/{app_id}", params=params)
        data = cast(dict[str, Any], response.data or {})
        cache = EntityCache(rt.db, rt.issuer)
        if data.get("purged"):
            with rt.db.transaction() as conn:
                conn.execute(
                    "UPDATE entity_cache SET deleted = 1 WHERE issuer = ? AND entity = "
                    "'application' AND entity_id = ?",
                    (rt.issuer, app_id),
                )
        elif isinstance(data.get("application"), dict):
            cache.put("application", cast(dict[str, Any], data["application"]))
        return data

    data = st.run(delete())
    st.out.result({"deleted": bool(data.get("purged")), **data})


# ============================================================================ notes / checklists
async def _note(rt: Runtime, app_id: str, text: str, *, kind: str | None = None) -> dict[str, Any]:
    key = f"note:{ids.new_ulid()}"
    payload: dict[str, Any] = {"text": text}
    if kind:
        payload["kind"] = kind
    body = {
        "type": "note_added",
        "payload": payload,
        "idempotency_key": key,
        "occurred_at": rt.clock.now_ms(),
    }
    return cast(
        dict[str, Any],
        await online_or_queue(
            rt,
            "POST",
            f"/api/v1/applications/{app_id}/events",
            body,
            ordering_key=f"app:{app_id}",
            kind="append",
            idempotency_key=key,
        ),
    )


def note_cmd(
    ctx: typer.Context,
    app_id: Annotated[str, typer.Argument(help="app_… id")],
    text: Annotated[str, typer.Argument(help="Note text (Markdown-lite).")],
) -> None:
    """Add a note event (append-only)."""
    st = state(ctx)
    check_app_id(app_id)
    if not 1 <= len(text.strip()) <= 10_000:
        raise UsageError("A note is 1–10,000 characters.")
    rt = st.runtime()
    data = st.run(_note(rt, app_id, text.strip()))
    event = cast(dict[str, Any], data.get("event") or {})
    st.out.result({"event_id": event.get("id"), **data})


checklist_group = typer.Typer(
    name="checklist",
    help="Checklists on an application (legacy sections / items, 06 §5).",
    no_args_is_help=True,
)


def _sections_of(current: dict[str, Any]) -> list[dict[str, Any]]:
    return copy.deepcopy(cast(list[dict[str, Any]], current.get("sections") or []))


def _check_size(sections: list[dict[str, Any]]) -> None:
    items = sum(len(cast(list[Any], s.get("items") or [])) for s in sections)
    size = len(json.dumps(sections, separators=(",", ":")).encode())
    if items > SECTIONS_MAX_ITEMS or size > SECTIONS_MAX_BYTES:
        raise UsageError("Checklists are limited to 200 items and 64 KB (06 §5).")


def _short_id(prefix: str) -> str:
    return f"{prefix}-{ids.new_ulid()[-10:].lower()}"


def _checklist_write(
    st: CliState,
    app_id: str,
    change: Callable[[list[dict[str, Any]]], None],
    describe: str,
) -> dict[str, Any]:
    rt = st.runtime()

    def build(current: dict[str, Any]) -> tuple[str, str, dict[str, Any]]:
        sections = _sections_of(current)
        change(sections)
        _check_size(sections)
        return (
            "PATCH",
            f"/api/v1/applications/{app_id}",
            {"base_revision": current["revision"], "sections": sections},
        )

    data = st.run(conditional_application_write(st, rt, app_id, build, describe=describe))
    app = cast(dict[str, Any], data.get("application") or {})
    return {"sections": app.get("sections", []), "application_id": app_id}


@checklist_group.command("list")
def checklist_list(
    ctx: typer.Context, app_id: Annotated[str, typer.Argument(help="app_… id")]
) -> None:
    """Show the checklists of an application."""
    st = state(ctx)
    check_app_id(app_id)
    rt = st.runtime()

    async def fetch(api: ApiClient) -> dict[str, Any]:
        return cast(dict[str, Any], (await get_application(api, rt, app_id))["application"])

    app, banner = st.run(
        fetch_or_cache(rt, fetch, lambda: EntityCache(rt.db, rt.issuer).get("application", app_id))
    )
    data: dict[str, Any] = {"application_id": app_id, "sections": app.get("sections", [])}
    if banner:
        data["offline"] = banner

    def human(console: Console, value: Any) -> None:
        for section in cast(list[dict[str, Any]], cast(dict[str, Any], value)["sections"]):
            console.print(f"{section['name']} ({section['id']})", markup=False, style="bold")
            for item in cast(list[dict[str, Any]], section.get("items") or []):
                mark = "x" if item.get("done") else " "
                console.print(f"  [{mark}] {item['title']}  ({item['id']})", markup=False)

    emit_result(st, data, human)


@checklist_group.command("add")
def checklist_add(
    ctx: typer.Context,
    app_id: Annotated[str, typer.Argument(help="app_… id")],
    title: Annotated[str, typer.Argument(help="Item title")],
    section: Annotated[
        str, typer.Option("--section", help="Section name (created when missing).")
    ] = "Checklist",
    url: Annotated[str | None, typer.Option("--url", help="Optional link.")] = None,
    notes: Annotated[str | None, typer.Option("--notes", help="Optional notes.")] = None,
) -> None:
    """Add a checklist item."""
    st = state(ctx)
    check_app_id(app_id)
    item = {
        "id": _short_id("item"),
        "title": title.strip(),
        "notes": notes or "",
        "url": url or "",
        "done": False,
    }

    def change(sections: list[dict[str, Any]]) -> None:
        target: dict[str, Any] | None = next(
            (s for s in sections if s.get("name") == section), None
        )
        if target is None:
            target = {"id": _short_id("sec"), "name": section, "items": []}
            sections.append(target)
        cast(list[dict[str, Any]], target["items"]).append(item)

    st.out.result({"item": item, **_checklist_write(st, app_id, change, "add the item")})


@checklist_group.command("done")
def checklist_done(
    ctx: typer.Context,
    app_id: Annotated[str, typer.Argument(help="app_… id")],
    item_id: Annotated[str, typer.Argument(help="Item id")],
    undo: Annotated[bool, typer.Option("--undo", help="Mark as not done.")] = False,
) -> None:
    """Tick (or untick) a checklist item."""
    st = state(ctx)
    check_app_id(app_id)

    def change(sections: list[dict[str, Any]]) -> None:
        for sec in sections:
            for item in cast(list[dict[str, Any]], sec.get("items") or []):
                if item.get("id") == item_id:
                    item["done"] = not undo
                    return
        raise NotFoundError(f"No checklist item {item_id}.")

    st.out.result(_checklist_write(st, app_id, change, "update the item"))


@checklist_group.command("rm")
def checklist_rm(
    ctx: typer.Context,
    app_id: Annotated[str, typer.Argument(help="app_… id")],
    ref: Annotated[str, typer.Argument(help="Item id or section id")],
) -> None:
    """Remove a checklist item (or a whole section)."""
    st = state(ctx)
    check_app_id(app_id)

    def change(sections: list[dict[str, Any]]) -> None:
        for index, sec in enumerate(sections):
            if sec.get("id") == ref:
                del sections[index]
                return
            items = cast(list[dict[str, Any]], sec.get("items") or [])
            for position, item in enumerate(items):
                if item.get("id") == ref:
                    del items[position]
                    return
        raise NotFoundError(f"No checklist item or section {ref}.")

    st.out.result(_checklist_write(st, app_id, change, "remove it"))


# ============================================================================ interviews / offers
interview_group = typer.Typer(name="interview", help="Interviews (06 §6.1).", no_args_is_help=True)
offer_group = typer.Typer(name="offer", help="Offers (06 §6.2).", no_args_is_help=True)


@interview_group.command("add")
def interview_add(
    ctx: typer.Context,
    app_id: Annotated[str, typer.Argument(help="app_… id")],
    at: Annotated[
        str | None, typer.Option("--at", help="When (YYYY-MM-DD HH:MM, local time).")
    ] = None,
    kind: Annotated[str, typer.Option("--kind", help=", ".join(INTERVIEW_KINDS))] = "other",
    duration: Annotated[
        int | None, typer.Option("--duration", min=1, max=1440, help="Minutes.")
    ] = None,
    location: Annotated[
        str | None, typer.Option("--location", help="Place or meeting URL.")
    ] = None,
    round_no: Annotated[int | None, typer.Option("--round", min=1, help="Round number.")] = None,
    timezone: Annotated[
        str | None, typer.Option("--timezone", help="IANA zone for display.")
    ] = None,
    no_move: Annotated[
        bool, typer.Option("--no-move", help="Do not move applied → interviewing.")
    ] = False,
) -> None:
    """Record an interview."""
    st = state(ctx)
    check_app_id(app_id)
    if kind not in INTERVIEW_KINDS:
        raise UsageError(f"--kind must be one of {', '.join(INTERVIEW_KINDS)}.")
    body: dict[str, Any] = {"kind": kind}
    if at:
        body["scheduled_at"] = parse_when(at)
    if duration:
        body["duration_min"] = duration
    if location:
        body["location"] = location[:500]
    if round_no:
        body["round"] = round_no
    if timezone:
        body["timezone"] = timezone
    if no_move:
        body["move_application"] = False
    rt = st.runtime()
    data = st.run(
        online_or_queue(
            rt,
            "POST",
            f"/api/v1/applications/{app_id}/interviews",
            body,
            ordering_key=f"app:{app_id}",
            kind="append",
        )
    )
    st.out.result(data)


@offer_group.command("add")
def offer_add(
    ctx: typer.Context,
    app_id: Annotated[str, typer.Argument(help="app_… id")],
    base: Annotated[float | None, typer.Option("--base", min=0, help="Base salary.")] = None,
    currency: Annotated[
        str | None, typer.Option("--currency", help="ISO 4217 code, e.g. IDR.")
    ] = None,
    deadline: Annotated[
        str | None, typer.Option("--deadline", help="Answer deadline (YYYY-MM-DD).")
    ] = None,
    period: Annotated[str, typer.Option("--period", help="year|month|week|day|hour")] = "year",
    no_move: Annotated[
        bool, typer.Option("--no-move", help="Do not move the application to offer.")
    ] = False,
) -> None:
    """Record an offer."""
    st = state(ctx)
    check_app_id(app_id)
    if currency is not None and not re.fullmatch(r"[A-Za-z]{3}", currency):
        raise UsageError("--currency must be a 3-letter ISO code.")
    if period not in ("year", "month", "week", "day", "hour"):
        raise UsageError("--period must be year, month, week, day or hour.")
    compensation: dict[str, Any] = {"period": period}
    if base is not None:
        compensation["base"] = base
    if currency:
        compensation["currency"] = currency.upper()
    body: dict[str, Any] = {"received_at": ids.now_ms(), "compensation": compensation}
    if deadline:
        body["deadline_at"] = parse_when(deadline)
    if no_move:
        body["move_application"] = False
    rt = st.runtime()
    data = st.run(
        online_or_queue(
            rt,
            "POST",
            f"/api/v1/applications/{app_id}/offers",
            body,
            ordering_key=f"app:{app_id}",
            kind="append",
        )
    )
    st.out.result(data)


# ============================================================================ score / stats
async def _inbox_new_ids(api: ApiClient, limit: int) -> list[str]:
    out: list[str] = []
    cursor: str | None = None
    while len(out) < limit:
        page = cast(
            dict[str, Any],
            await api.get("/api/v1/inbox", {"state": "new", "limit": 200, "cursor": cursor}),
        )
        out += [
            str(cast(dict[str, Any], i["user_job"])["id"])
            for i in cast(list[dict[str, Any]], page.get("items") or [])
        ]
        cursor = cast(str | None, page.get("next_cursor"))
        if not cursor:
            break
    return out[:limit]


async def request_scores(
    rt: Runtime, ujb_ids: Sequence[str], pst_ids: Sequence[str], *, wait: bool
) -> dict[str, Any]:
    queued: list[str] = []
    cached: list[str] = []
    async with rt.api_client() as api:
        for field_name, values in (("user_job_ids", list(ujb_ids)), ("posting_ids", list(pst_ids))):
            for start in range(0, len(values), 500):
                chunk = values[start : start + 500]
                data = cast(
                    dict[str, Any],
                    await online_or_queue(
                        rt,
                        "POST",
                        "/api/v1/scores:request",
                        {field_name: chunk},
                        ordering_key="scores",
                        kind="append",
                        api=api,
                    ),
                )
                queued += cast(list[str], data.get("queued") or [])
                cached += cast(list[str], data.get("cached") or [])
        scores: dict[str, Any] = {}
        if wait and queued:
            deadline = time.monotonic() + 30
            pending = set(queued)
            while pending and time.monotonic() < deadline:
                for posting_id in list(pending):
                    result = cast(dict[str, Any], await api.get(f"/api/v1/scores/{posting_id}"))
                    score = cast(dict[str, Any] | None, result.get("score"))
                    if score is not None and score.get("status") in ("ready", "failed"):
                        scores[posting_id] = score
                        pending.discard(posting_id)
                if pending:
                    await asyncio.sleep(2)
    out: dict[str, Any] = {"queued": queued, "cached": cached}
    if wait:
        out["scores"] = scores
    return out


def score_cmd(
    ctx: typer.Context,
    refs: Annotated[list[str] | None, typer.Argument(help="ujb_… or pst_… ids")] = None,
    all_new: Annotated[
        bool, typer.Option("--all-new", help="Every new inbox item (≤ 500).")
    ] = False,
    wait: Annotated[bool, typer.Option("--wait", help="Wait up to 30 s for the scores.")] = False,
) -> None:
    """Request scoring (POST /api/v1/scores:request; 07)."""
    st = state(ctx)
    values = list(refs or [])
    if not values and not all_new:
        raise UsageError("Pass ujb_…/pst_… ids or --all-new.")
    ujb = [v for v in values if ids.is_id("ujb", v)]
    pst = [v for v in values if ids.is_id("pst", v)]
    bad = [v for v in values if v not in ujb and v not in pst]
    if bad:
        raise UsageError(f"Not a ujb_…/pst_… id: {', '.join(bad)}")
    rt = st.runtime()

    async def run() -> dict[str, Any]:
        if all_new:
            async with rt.api_client() as api:
                ujb.extend(await _inbox_new_ids(api, 500))
        return await request_scores(
            rt, list(dict.fromkeys(ujb)), list(dict.fromkeys(pst)), wait=wait
        )

    data = st.run(run())
    st.out.result(
        data,
        human=lambda c, v: c.print(
            f"{len(v['queued'])} queued, {len(v['cached'])} already scored.", markup=False
        ),
    )


def stats_cmd(
    ctx: typer.Context,
    date_from: Annotated[str | None, typer.Option("--from", help="First day (YYYY-MM-DD).")] = None,
    date_to: Annotated[str | None, typer.Option("--to", help="Last day (YYYY-MM-DD).")] = None,
    by: Annotated[
        str | None,
        typer.Option(
            "--by",
            help="Breakdown: source|company|mode|method|cv_variant|score_band|workplace_type",
        ),
    ] = None,
    tz: Annotated[str | None, typer.Option("--tz", help="IANA timezone.")] = None,
) -> None:
    """Funnel and rates (GET /api/v1/analytics/summary; 10 §6)."""
    st = state(ctx)
    for value in (date_from, date_to):
        if value is not None and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
            raise UsageError("--from/--to are days (YYYY-MM-DD).")
    rt = st.runtime()

    async def run() -> dict[str, Any]:
        params = {"from": date_from, "to": date_to, "tz": tz}
        async with rt.api_client() as api:
            summary = cast(dict[str, Any], await api.get("/api/v1/analytics/summary", params))
            out: dict[str, Any] = {"summary": summary}
            if by:
                out["breakdown"] = await api.get(
                    "/api/v1/analytics/breakdown", {**params, "by": by}
                )
        return out

    data = st.run(run())

    def human(console: Console, value: Any) -> None:
        summary = cast(dict[str, Any], cast(dict[str, Any], value)["summary"])
        funnel = cast(dict[str, Any], summary.get("funnel") or {})
        console.print(
            f"{summary.get('from')} → {summary.get('to')} ({summary.get('tz')}), "
            f"cohort {summary.get('cohort_size')}",
            markup=False,
        )
        console.print(key_value_table(funnel, title="funnel"))
        rates = summary.get("rates")
        if isinstance(rates, dict):
            console.print(key_value_table(cast(dict[str, Any], rates), title="rates"))
        breakdown = cast(dict[str, Any] | None, cast(dict[str, Any], value).get("breakdown"))
        if breakdown:
            rows = cast(list[dict[str, Any]], breakdown.get("rows") or [])
            console.print(items_table(rows) if rows else "(no rows)")

    st.out.result(data, human=human)


# ============================================================================ register
def register(app: typer.Typer) -> None:
    app.command("board")(board_cmd)
    app.command("list")(list_cmd)
    app.command("show")(show_cmd)
    app.command("track")(track_cmd)
    app.command("move")(move_cmd)
    app.command("applied")(applied_cmd)
    app.command("confirm")(confirm_cmd)
    app.command("edit")(edit_cmd)
    app.command("note")(note_cmd)
    app.add_typer(checklist_group, name="checklist")
    app.add_typer(interview_group, name="interview")
    app.add_typer(offer_group, name="offer")
    app.command("follow-up")(follow_up_cmd)
    app.command("archive")(archive_cmd)
    app.command("rm")(rm_cmd)
    app.command("score")(score_cmd)
    app.command("stats")(stats_cmd)


__all__ = [
    "base_revision",
    "check_app_id",
    "conditional_application_write",
    "emit_result",
    "fetch_or_cache",
    "fmt_ms",
    "online_or_queue",
    "parse_when",
    "register",
    "require_device",
    "require_scope",
    "stream_event",
    "track_one",
]
