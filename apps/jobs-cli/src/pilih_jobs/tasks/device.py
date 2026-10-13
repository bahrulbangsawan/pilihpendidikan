"""Device heartbeat (16 §7: every 60 s; 05 §3) and device-level settings.

`POST /api/v1/devices/{dev}/heartbeat` reports the local task summary, the active leases,
the outbox depth and the browser state, and re-sends the capabilities (21 §3). The
response carries the server time (clock offset, 20 §9), the poll interval, the leases the
device must stop (`cancel_lease_ids`: cancel requested, revoked, pause-all) and the minimum
CLI version.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, cast

from pilih_jobs.api.client import ApiClient
from pilih_jobs.api.errors import ApiConflictError
from pilih_jobs.config import Config
from pilih_jobs.contracts import ids
from pilih_jobs.environment import chromium_available
from pilih_jobs.storage.db import StateDB
from pilih_jobs.sync.cache import EntityCache
from pilih_jobs.sync.outbox import Outbox
from pilih_jobs.tasks.local import LOCAL_STATES, LocalTaskStore
from pilih_jobs.version import __version__, is_below


@dataclass
class DeviceBeat:
    server_time: int
    poll_interval_ms: int
    cancel_lease_ids: list[str] = field(default_factory=lambda: [])
    min_cli_version: str = "0.0.0"

    @property
    def upgrade_required(self) -> bool:
        return is_below(__version__, self.min_cli_version)


def heartbeat_body(
    db: StateDB,
    issuer: str,
    config: Config,
    *,
    capabilities: list[str],
    browser_busy: bool,
    last_sync_at: int | None,
) -> dict[str, Any]:
    store = LocalTaskStore(db)
    counts = store.counts()
    outbox = Outbox(db, issuer)
    totals = outbox.counts()
    if browser_busy:
        browser_status = "busy"
    elif chromium_available(config.browser.channel):
        browser_status = "ready"
    else:
        browser_status = "not_installed"
    body: dict[str, Any] = {
        "cli_version": __version__,
        "local_state_summary": {s: counts[s] for s in LOCAL_STATES if counts.get(s)},
        "active_lease_ids": store.active_lease_ids(),
        "outbox_depth": totals["pending"] + totals["inflight"] + totals["conflict"],
        "outbox_dead": totals["dead"],
        "browser": {"mode": config.browser.mode, "status": browser_status},
        "capabilities": sorted(set(capabilities)),
    }
    if last_sync_at is not None:
        body["last_sync_at"] = last_sync_at
    return body


async def send_device_heartbeat(api: ApiClient, device_id: str, body: dict[str, Any]) -> DeviceBeat:
    data = cast(dict[str, Any], await api.post(f"/api/v1/devices/{device_id}/heartbeat", body))
    return DeviceBeat(
        server_time=int(data.get("server_time") or ids.now_ms()),
        poll_interval_ms=int(data.get("poll_interval_ms") or 30_000),
        cancel_lease_ids=[str(x) for x in cast(list[Any], data.get("cancel_lease_ids") or [])],
        min_cli_version=str(data.get("min_cli_version") or "0.0.0"),
    )


async def set_accepts_tasks(
    api: ApiClient, db: StateDB, issuer: str, device_id: str, accepts: bool
) -> dict[str, Any]:
    """`PATCH /api/v1/devices/{id} {base_revision, accepts_tasks}` (worker enable/disable).

    The device's own row may be changed with `automation:execute`, which cannot list devices:
    the base revision comes from the cache, and a `409` carries the current row, so one
    automatic retry with its revision resolves it (20 §6.2 "client auto").
    """
    cache = EntityCache(db, issuer)
    cached = cache.get("device", device_id)
    revision = int(cached.get("revision", 1)) if cached else 1
    path = f"/api/v1/devices/{device_id}"
    for attempt in range(2):
        try:
            data = cast(
                dict[str, Any],
                await api.patch(path, {"base_revision": revision, "accepts_tasks": accepts}),
            )
        except ApiConflictError as exc:
            current = exc.current
            if attempt == 0 and current is not None and isinstance(current.get("revision"), int):
                revision = int(current["revision"])
                continue
            raise
        device = cast(dict[str, Any], data["device"])
        cache.put("device", device)
        return device
    raise AssertionError("unreachable")  # pragma: no cover
