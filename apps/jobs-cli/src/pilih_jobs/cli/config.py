"""`config get/set/list/path/unset/purge` (16 §3.3, §9)."""

from __future__ import annotations

import shutil
from pathlib import Path
from typing import Annotated, Any, cast

import typer
from rich.console import Console

from pilih_jobs import config as cfg
from pilih_jobs.cli.context import state
from pilih_jobs.cli.output import items_table, key_value_table
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.cache import EntityCache

group = typer.Typer(
    name="config",
    help="Local configuration (TOML; flags > PILIH_JOBS_* env > file > defaults).",
    no_args_is_help=True,
)


@group.command("get")
def get_cmd(
    ctx: typer.Context, key: Annotated[str, typer.Argument(help="section.key, e.g. api.url")]
) -> None:
    """Print the effective value of one key."""
    st = state(ctx)
    loaded = st.runtime().loaded
    cfg.split_key(key)
    value = loaded.get(key)
    st.out.result(
        {"key": key, "value": value, "source": loaded.sources[key]},
        human=lambda console, data: console.print(
            _plain(cast(dict[str, Any], data)["value"]), markup=False
        ),
    )


@group.command("set")
def set_cmd(
    ctx: typer.Context,
    key: Annotated[str, typer.Argument(help="section.key")],
    value: Annotated[str, typer.Argument(help="New value (lists: comma-separated or JSON).")],
) -> None:
    """Validate and store a value in the config file (unknown keys are refused)."""
    st = state(ctx)
    paths = st.runtime().paths
    stored = cfg.set_value(paths, key, value)
    st.out.result({"key": key, "value": stored, "path": str(paths.config_file)})


@group.command("unset")
def unset_cmd(ctx: typer.Context, key: Annotated[str, typer.Argument(help="section.key")]) -> None:
    """Remove a key from the config file (the default applies again)."""
    st = state(ctx)
    paths = st.runtime().paths
    st.out.result({"key": key, "removed": cfg.unset_value(paths, key)})


def _plain(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return ",".join(str(v) for v in cast(list[Any], value))
    return str(value)


@group.command("list")
def list_cmd(ctx: typer.Context) -> None:
    """Every key with its effective value and source (default, file, env, flag)."""
    st = state(ctx)
    loaded = st.runtime().loaded
    items = [
        {"key": key, "value": loaded.get(key), "source": loaded.sources[key]}
        for key in cfg.all_keys()
    ]
    st.out.result(
        {"items": items, "path": str(loaded.path)},
        human=lambda console, data: console.print(
            items_table(cast(list[dict[str, Any]], cast(dict[str, Any], data)["items"]))
        ),
    )


@group.command("path")
def path_cmd(ctx: typer.Context) -> None:
    """Where the config file and the local data live."""
    st = state(ctx)
    paths = st.runtime().paths
    st.out.result(
        {
            "config_file": str(paths.config_file),
            "config_dir": str(paths.config_dir),
            "data_dir": str(paths.data_dir),
            "cache_dir": str(paths.cache_dir),
            "log_dir": str(paths.log_dir),
            "state_db": str(paths.state_db),
        },
        human=lambda console, data: console.print(key_value_table(cast(dict[str, Any], data))),
    )


def _remove(path: Path, deleted: list[str]) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink(missing_ok=True)
        deleted.append(str(path))
    elif path.is_dir():
        shutil.rmtree(path, ignore_errors=True)
        deleted.append(str(path))


def purge_local(rt: Runtime, *, profiles: bool) -> dict[str, Any]:
    """Delete caches, logs, staging files (and profiles); never cloud data or the outbox."""
    paths = rt.paths
    deleted: list[str] = []
    skipped: list[str] = []
    for directory in (paths.cache_dir, paths.log_dir):
        if directory.is_dir():
            for child in sorted(directory.iterdir()):
                _remove(child, deleted)
    if paths.runs_dir.is_dir():
        for run in sorted(paths.runs_dir.iterdir()):
            staging = run / "staging"
            if staging.exists():
                _remove(staging, deleted)
    if profiles and paths.browser_profiles_dir.is_dir():
        for profile in sorted(paths.browser_profiles_dir.iterdir()):
            if (profile / "SingletonLock").exists() or (profile / "lockfile").exists():
                skipped.append(f"{profile.name} (in use by a browser)")
                continue
            _remove(profile, deleted)
    cache_rows = EntityCache(rt.db, rt.issuer).clear()
    rt.db.execute("UPDATE sync_state SET cursor = 0 WHERE issuer = ?", (rt.issuer,))
    for row in rt.db.query("SELECT key FROM kv"):
        key = str(row["key"])
        if key in ("meta", "pypi_latest") or key.startswith("oauth_metadata:"):
            rt.db.kv_delete(key)
    return {"deleted": deleted, "skipped": skipped, "cache_rows": cache_rows}


@group.command("purge")
def purge_cmd(
    ctx: typer.Context,
    profiles: Annotated[
        bool,
        typer.Option(
            "--profiles", help="Also delete local browser profiles (logins on ATS sites)."
        ),
    ] = False,
) -> None:
    """Delete local caches, logs and staging files; never touches cloud data."""
    st = state(ctx)
    rt = st.runtime()
    what = "caches, logs, staging files" + (" and browser profiles" if profiles else "")
    if not st.confirm(f"Delete local {what}? Cloud data and queued changes are kept."):
        st.out.result({"deleted": [], "cancelled": True})
        return
    result = purge_local(rt, profiles=profiles)

    def human(console: Console, data: Any) -> None:
        info = cast(dict[str, Any], data)
        console.print(f"Deleted {len(info['deleted'])} item(s).", markup=False)
        for item in cast(list[str], info["skipped"]):
            console.print(f"Skipped {item}", markup=False, style="yellow")

    st.out.result(result, human=human)


def register(app: typer.Typer) -> None:
    app.add_typer(group, name="config")
