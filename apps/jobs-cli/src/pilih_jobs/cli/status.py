"""`status`: auth, device, worker, outbox, browser, last sync, pending approvals (16 §3.3)."""

from __future__ import annotations

from typing import Any, cast

import typer
from rich.console import Console

from pilih_jobs.api.errors import ApiError, NetworkError
from pilih_jobs.cli.context import state
from pilih_jobs.cli.output import key_value_table
from pilih_jobs.environment import installed_browsers
from pilih_jobs.errors import NotAuthenticatedError
from pilih_jobs.runtime import Runtime
from pilih_jobs.storage.locks import FileLock
from pilih_jobs.sync.cache import EntityCache
from pilih_jobs.sync.engine import SyncEngine
from pilih_jobs.sync.identity import AccountMismatchError
from pilih_jobs.sync.outbox import Outbox


async def _pull(rt: Runtime) -> str | None:
    """Pull before reading cloud state (20 §4.1); returns an offline reason or None."""
    try:
        async with rt.api_client() as api:
            await SyncEngine(rt.db, rt.issuer, api).pull()
    except NetworkError as exc:
        return f"offline: {exc.message}"
    except NotAuthenticatedError as exc:
        return f"not signed in: {exc.message}"
    except (ApiError, AccountMismatchError) as exc:
        return f"sync unavailable: {exc.message}"
    return None


def collect_status(rt: Runtime, *, offline_reason: str | None) -> dict[str, Any]:
    account = rt.account()
    outbox = Outbox(rt.db, rt.issuer)
    counts = outbox.counts()
    sync_row = rt.db.query_one("SELECT * FROM sync_state WHERE issuer = ?", (rt.issuer,))
    last_sync = None
    if sync_row is not None:
        stamps = [sync_row["last_pull_at"], sync_row["last_push_at"]]
        last_sync = max((int(s) for s in stamps if s is not None), default=None)
    worker_lock = FileLock(rt.paths.worker_lock)
    approvals = EntityCache(rt.db, rt.issuer).count(
        "approval", lambda a: a.get("state") == "pending"
    )
    return {
        "auth": {
            "signed_in": account is not None,
            "issuer": rt.issuer,
            "email": account.email if account else None,
            "user_id": account.user_id if account else None,
            "scopes": account.scopes if account else [],
            "credential_store": account.credential_store
            if account
            else rt.config.credentials.store,
            "personal_token": account is None and rt.personal_token is not None,
        },
        "device": {"id": account.device_id, "name": account.device_name} if account else None,
        "worker": {"running": worker_lock.is_locked_elsewhere()},
        "outbox": {
            "depth": counts["pending"] + counts["inflight"] + counts["conflict"],
            "pending": counts["pending"],
            "conflict": counts["conflict"],
            "dead": counts["dead"],
            "stale_24h": outbox.stale_count(),
        },
        "browser": {
            "mode": rt.config.browser.mode,
            "channel": rt.config.browser.channel,
            "default_profile": rt.config.browser.default_profile,
            "installed": [f"{b.name}-{b.revision}" for b in installed_browsers()],
        },
        "last_sync_at": last_sync,
        "approvals_pending": approvals,
        "offline": offline_reason,
    }


def _human(console: Console, value: Any) -> None:
    data = cast(dict[str, Any], value)
    auth = cast(dict[str, Any], data["auth"])
    device = cast(dict[str, Any] | None, data["device"]) or {}
    outbox = cast(dict[str, Any], data["outbox"])
    browser = cast(dict[str, Any], data["browser"])
    if data.get("offline"):
        console.print(f"{data['offline']} — data as of the last sync", markup=False, style="yellow")
    console.print(
        key_value_table(
            {
                "account": auth["email"] or "not signed in",
                "api": auth["issuer"],
                "device": device.get("name") or "-",
                "worker": "running" if data["worker"]["running"] else "stopped",
                "outbox": f"{outbox['depth']} pending, {outbox['conflict']} conflicts, "
                f"{outbox['dead']} dead",
                "browser": f"{browser['mode']} ({browser['channel']}); "
                f"{', '.join(browser['installed']) or 'no browser installed'}",
                "last sync": data["last_sync_at"] or "never",
                "approvals": f"{data['approvals_pending']} pending",
            }
        )
    )
    if outbox["stale_24h"]:
        console.print(
            f"{outbox['stale_24h']} write(s) pending for more than 24 h — check your connection "
            "or `pilih-jobs sync --status`.",
            markup=False,
            style="yellow",
        )


def _status(ctx: typer.Context) -> None:
    """One-screen overview: auth, device, worker, outbox, browser, last sync, approvals."""
    st = state(ctx)
    rt = st.runtime()
    reason = st.run(_pull(rt)) if (rt.account() or rt.personal_token) else "not signed in"
    st.out.result(collect_status(rt, offline_reason=reason), human=_human)


def register(app: typer.Typer) -> None:
    app.command("status")(_status)
