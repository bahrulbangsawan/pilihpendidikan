"""`devices list / rename / revoke` (05 §3; needs the step-up scope `devices:manage`).

`revoke` takes several ids (one confirmation, per-id results; this device goes last).
"""

from __future__ import annotations

from typing import Annotated, Any, cast

import typer
from rich.console import Console

from pilih_jobs.cli.bulk import Outcome, check_ids, emit, ok, print_ids, run_each, summary
from pilih_jobs.cli.context import state
from pilih_jobs.cli.output import items_table
from pilih_jobs.contracts.ids import is_id
from pilih_jobs.errors import NotFoundError, UsageError
from pilih_jobs.runtime import Runtime

group = typer.Typer(
    name="devices",
    help="Manage the devices signed in to your account (step-up scope devices:manage).",
    no_args_is_help=True,
)

_COLUMNS = [
    "id",
    "name",
    "platform",
    "cli_version",
    "online",
    "active",
    "accepts_tasks",
    "revoked_at",
]


async def _list(rt: Runtime) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    cursor: str | None = None
    async with rt.api_client() as api:
        while True:
            page = cast(
                dict[str, Any], await api.get("/api/v1/devices", {"limit": 200, "cursor": cursor})
            )
            items.extend(cast(list[dict[str, Any]], page.get("items") or []))
            cursor = cast(str | None, page.get("next_cursor"))
            if not cursor:
                return items


def _check_id(device_id: str) -> None:
    if not is_id("dev", device_id):
        raise UsageError(f"{device_id!r} is not a device id (dev_…).")


@group.command("list")
def list_cmd(
    ctx: typer.Context,
    ids_only: Annotated[
        bool, typer.Option("--ids", help="Print only the dev_… ids, one per line (for piping).")
    ] = False,
) -> None:
    """List devices with online/active status."""
    st = state(ctx)
    rt = st.runtime()
    items = st.run(_list(rt))
    if ids_only:
        print_ids(st, (d.get("id") for d in items))
        return
    account = rt.account()
    current = account.device_id if account is not None else None
    for item in items:
        item["this_device"] = item.get("id") == current

    def human(console: Console, data: Any) -> None:
        rows = cast(list[dict[str, Any]], cast(dict[str, Any], data)["items"])
        console.print(items_table(rows, [*_COLUMNS, "this_device"]) if rows else "(no devices)")

    st.out.result({"items": items}, human=human)


async def _rename(rt: Runtime, device_id: str, name: str) -> dict[str, Any]:
    devices = await _list(rt)
    device = next((d for d in devices if d.get("id") == device_id), None)
    if device is None:
        raise NotFoundError(f"Device {device_id} not found.")
    async with rt.api_client() as api:
        body = {"base_revision": device["revision"], "name": name}
        response = cast(dict[str, Any], await api.patch(f"/api/v1/devices/{device_id}", body))
    return cast(dict[str, Any], response["device"])


@group.command("rename")
def rename_cmd(
    ctx: typer.Context,
    device_id: Annotated[str, typer.Argument(help="dev_… id")],
    name: Annotated[str, typer.Argument(help="New name (≤ 60 characters)")],
) -> None:
    """Rename a device."""
    st = state(ctx)
    _check_id(device_id)
    if not 1 <= len(name.strip()) <= 60:
        raise UsageError("The device name must be 1–60 characters.")
    rt = st.runtime()
    device = st.run(_rename(rt, device_id, name.strip()))
    account = rt.account()
    if account is not None and account.device_id == device_id:
        account.device_name = str(device.get("name") or name)
        rt.credentials.put(account)
    st.out.result({"device": device})


async def _revoke(rt: Runtime, device_id: str) -> dict[str, Any]:
    async with rt.api_client() as api:
        return cast(dict[str, Any], await api.post(f"/api/v1/devices/{device_id}/revoke"))


@group.command("revoke")
def revoke_cmd(
    ctx: typer.Context,
    device_ids: Annotated[list[str], typer.Argument(help="dev_… ids", metavar="DEV_ID...")],
) -> None:
    """Revoke devices: signs them out and stops their running tasks (one confirmation).

    This device may be in the set (you are warned); it is revoked last so the others still go
    through with this login.
    """
    st = state(ctx)
    values = check_ids("dev", device_ids, label="device id (dev_…)")
    rt = st.runtime()
    account = rt.account()
    current = account.device_id if account is not None else None
    this_device = current in values
    if len(values) == 1:
        question = (
            f"Revoke {values[0]}"
            + (" (THIS device — you will be signed out)" if this_device else "")
            + "? Running tasks stop; tasks past submit_intent are marked for review."
        )
    else:
        question = (
            f"Revoke {len(values)} devices ({', '.join(values)})"
            + (f" including THIS device {current} — you will be signed out" if this_device else "")
            + "? Running tasks stop; tasks past submit_intent are marked for review."
        )
    if not st.confirm(question):
        if len(values) == 1:
            st.out.result({"revoked": False})
        else:
            st.out.result({"results": [], "summary": summary([]), "cancelled": True})
        return
    if len(values) == 1:
        result = st.run(_revoke(rt, values[0]))
        st.out.result({"revoked": True, **result})
        return
    order = [v for v in values if v != current] + ([current] if this_device and current else [])

    async def one(device_id: str) -> Outcome:
        result = await _revoke(rt, device_id)
        tasks = cast(dict[str, Any], result.get("tasks") or {})
        return ok(device_id, revoked=True, this_device=device_id == current, tasks=tasks)

    done = {o.id: o for o in st.run(run_each(order, one))}
    emit(st, [done[v] for v in values], columns=["id", "status", "revoked", "this_device"])


def register(app: typer.Typer) -> None:
    app.add_typer(group, name="devices")
