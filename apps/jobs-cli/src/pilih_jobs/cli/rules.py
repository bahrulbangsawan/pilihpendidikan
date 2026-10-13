"""`rules list|show|enable|disable` (16 §3.3, 19 §8.3).

Rules are edited on the web. The CLI reads them and may enable or disable a rule
(`PATCH /api/v1/rules/{id} {base_revision, enabled}`; several ids at once, per-id results),
except **enabling an `auto` rule**: that
needs the activation approval flow on the web (`rule_activation`, 19 §8.3) and is refused here
(exit 9).
"""

from __future__ import annotations

from typing import Annotated, Any, cast

import typer
from rich.console import Console

from pilih_jobs.api.client import ApiClient
from pilih_jobs.cli import bulk
from pilih_jobs.cli.board import emit_result, fetch_or_cache, online_or_queue
from pilih_jobs.cli.context import state
from pilih_jobs.cli.output import items_table, key_value_table
from pilih_jobs.contracts import ids
from pilih_jobs.errors import NotFoundError, PolicyRefusedError, UsageError
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.cache import EntityCache

group = typer.Typer(
    name="rules",
    help="Automation rules (read in the CLI, edit on the web; enable/disable allowed).",
    no_args_is_help=True,
)


def _check(rule_id: str) -> None:
    if not ids.is_id("rul", rule_id):
        raise UsageError(f"{rule_id!r} is not a rule id (rul_…).")


async def _list(api: ApiClient, rt: Runtime) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    cursor: str | None = None
    for _ in range(50):
        page = cast(
            dict[str, Any], await api.get("/api/v1/rules", {"limit": 200, "cursor": cursor})
        )
        items += cast(list[dict[str, Any]], page.get("items") or [])
        cursor = cast(str | None, page.get("next_cursor"))
        if not cursor:
            break
    cache = EntityCache(rt.db, rt.issuer)
    for rule in items:
        cache.put("rule", rule)
    return items


def _row(rule: dict[str, Any]) -> dict[str, Any]:
    limits = cast(dict[str, Any], rule.get("limits") or {})
    criteria = cast(dict[str, Any], rule.get("criteria") or {})
    return {
        "id": rule.get("id"),
        "name": rule.get("name"),
        "mode": rule.get("mode"),
        "enabled": rule.get("enabled"),
        "min_score": criteria.get("min_score"),
        "max_per_day": limits.get("max_per_day"),
        "activated": rule.get("activated_approval_id") is not None,
    }


@group.command("list")
def list_cmd(
    ctx: typer.Context,
    ids_only: Annotated[
        bool, typer.Option("--ids", help="Print only the rul_… ids, one per line (for piping).")
    ] = False,
) -> None:
    """List automation rules."""
    st = state(ctx)
    rt = st.runtime()
    items, banner = st.run(
        fetch_or_cache(
            rt, lambda api: _list(api, rt), lambda: EntityCache(rt.db, rt.issuer).list("rule")
        )
    )
    if ids_only:
        if banner:
            st.out.notice(banner)
        bulk.print_ids(st, (r.get("id") for r in items))
        return
    data: dict[str, Any] = {"items": items}
    if banner:
        data["offline"] = banner

    def human(console: Console, value: Any) -> None:
        rows = [_row(r) for r in cast(list[dict[str, Any]], cast(dict[str, Any], value)["items"])]
        console.print(items_table(rows) if rows else "(no rules)")

    emit_result(st, data, human)


async def _get(api: ApiClient, rt: Runtime, rule_id: str) -> dict[str, Any]:
    data = cast(dict[str, Any], await api.get(f"/api/v1/rules/{rule_id}"))
    EntityCache(rt.db, rt.issuer).put("rule", cast(dict[str, Any], data["rule"]))
    return data


@group.command("show")
def show_cmd(ctx: typer.Context, rule_id: Annotated[str, typer.Argument(help="rul_… id")]) -> None:
    """Show one rule (criteria, limits, allowed domains)."""
    st = state(ctx)
    _check(rule_id)
    rt = st.runtime()

    def cached() -> dict[str, Any] | None:
        rule = EntityCache(rt.db, rt.issuer).get("rule", rule_id)
        return {"rule": rule} if rule is not None else None

    data, banner = st.run(fetch_or_cache(rt, lambda api: _get(api, rt, rule_id), cached))
    if banner:
        data = {**data, "offline": banner}

    def human(console: Console, value: Any) -> None:
        rule = cast(dict[str, Any], cast(dict[str, Any], value)["rule"])
        console.print(key_value_table(_row(rule)))
        console.print(
            key_value_table(cast(dict[str, Any], rule.get("criteria") or {}), title="criteria")
        )
        console.print(
            key_value_table(cast(dict[str, Any], rule.get("limits") or {}), title="limits")
        )
        console.print(
            f"allowed domains: {', '.join(rule.get('allowed_domains') or []) or '-'}", markup=False
        )

    emit_result(st, data, human)


async def _toggle_one(rt: Runtime, rule_id: str, enabled: bool) -> dict[str, Any]:
    async with rt.api_client() as api:
        current = cast(dict[str, Any], (await _get(api, rt, rule_id))["rule"])
        if enabled and current.get("mode") == "auto":
            raise PolicyRefusedError(
                "Enabling an auto rule needs the activation approval on the web (19 §8.3).",
                code="mode_not_allowed",
                hint="open the Automation page on jobs.pilihpendidikan.com",
            )
        if bool(current.get("enabled")) == enabled:
            return {"rule": current, "changed": False}
        data = cast(
            dict[str, Any],
            await online_or_queue(
                rt,
                "PATCH",
                f"/api/v1/rules/{rule_id}",
                {"base_revision": current["revision"], "enabled": enabled},
                ordering_key=f"rule:{rule_id}",
                api=api,
            ),
        )
    rule = data.get("rule")
    if not isinstance(rule, dict):
        raise NotFoundError(f"No rule {rule_id}.")
    EntityCache(rt.db, rt.issuer).put("rule", cast(dict[str, Any], rule))
    return {**data, "changed": True}


def _toggle(ctx: typer.Context, rule_ids: list[str], enabled: bool) -> None:
    st = state(ctx)
    values = bulk.check_ids("rul", rule_ids, label="rule id (rul_…)")
    rt = st.runtime()
    if len(values) == 1:
        rule_id = values[0]
        data = st.run(_toggle_one(rt, rule_id, enabled))
        st.out.result(
            data,
            human=lambda c, v: c.print(
                f"{rule_id} {'enabled' if enabled else 'disabled'}.", markup=False
            ),
        )
        return

    async def one(rule_id: str) -> bulk.Outcome:
        data = await _toggle_one(rt, rule_id, enabled)
        rule = cast(dict[str, Any], data["rule"])
        return bulk.ok(rule_id, enabled=rule.get("enabled"), changed=data["changed"])

    bulk.emit(
        st, st.run(bulk.run_each(values, one)), columns=["id", "status", "enabled", "changed"]
    )


@group.command("enable")
def enable_cmd(
    ctx: typer.Context,
    rule_ids: Annotated[list[str], typer.Argument(help="rul_… ids", metavar="RUL_ID...")],
) -> None:
    """Enable rules (not `auto` rules: those are activated on the web)."""
    _toggle(ctx, rule_ids, True)


@group.command("disable")
def disable_cmd(
    ctx: typer.Context,
    rule_ids: Annotated[list[str], typer.Argument(help="rul_… ids", metavar="RUL_ID...")],
) -> None:
    """Disable rules."""
    _toggle(ctx, rule_ids, False)


def register(app: typer.Typer) -> None:
    app.add_typer(group, name="rules")
