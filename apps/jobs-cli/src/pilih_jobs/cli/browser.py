"""`browser` command group (18, 16 §3.3): install, launch, login, connect, status, profiles.

Heavy modules (`pilih_jobs.browser.*`, which import Playwright) are imported inside the
command functions so `--help` stays fast and `cli` never imports Playwright directly.
Nothing here reads cookies or profile credential stores; profile metadata holds
user-typed domain hints only (18 §3.3).
"""

from __future__ import annotations

import asyncio
import subprocess
import sys
from typing import Annotated, Any, cast

import typer
from rich.console import Console

from pilih_jobs.cli.context import CliState, state
from pilih_jobs.cli.output import items_table, key_value_table
from pilih_jobs.errors import InputRequiredError, PilihError, UsageError

group = typer.Typer(
    name="browser",
    help="Install, connect and inspect the automation browser (18).",
    no_args_is_help=True,
)
profiles_group = typer.Typer(
    name="profiles",
    help="Manage the named browser profiles under the data directory (18 §3.3–§4).",
    no_args_is_help=False,
    invoke_without_command=True,
)


def _store(st: CliState) -> Any:
    from pilih_jobs.browser.profiles import ProfileStore

    return ProfileStore(st.runtime().paths.data_dir)


# ------------------------------------------------------------------ install
@group.command("install")
def install_cmd(
    ctx: typer.Context,
    channel: Annotated[
        str | None,
        typer.Option("--channel", help="Use a branded browser instead: chrome | msedge."),
    ] = None,
    with_deps: Annotated[
        bool, typer.Option("--with-deps", help="Linux: also install system libraries (sudo).")
    ] = False,
) -> None:
    """Install Chromium for Playwright (`python -m playwright install chromium`, 22 §4)."""
    from pilih_jobs.environment import (
        branded_browser_available,
        installed_browsers,
        playwright_browsers_path,
    )

    st = state(ctx)
    if channel not in (None, "chromium", "chrome", "msedge"):
        raise UsageError("--channel must be chrome or msedge.")
    if channel == "msedge":
        # `playwright install msedge` replaces the system Edge: never run it (18 §3.1).
        st.out.result(
            {
                "installed": branded_browser_available("msedge"),
                "path": None,
                "size_mb": None,
                "message": (
                    "Install Microsoft Edge yourself from https://www.microsoft.com/edge, "
                    "then set browser.channel = msedge."
                ),
            }
        )
        return
    target = "chrome" if channel == "chrome" else "chromium"
    if target == "chrome" and branded_browser_available("chrome"):
        st.out.result(
            {
                "installed": True,
                "path": None,
                "size_mb": None,
                "message": "Google Chrome is already installed.",
            }
        )
        return
    argv = [sys.executable, "-m", "playwright", "install", target]
    if with_deps and sys.platform.startswith("linux"):
        argv.append("--with-deps")
    if not st.confirm(f"Run `{' '.join(argv[1:])}`?", default=True):
        st.out.result({"installed": False, "path": None, "size_mb": None})
        return
    completed = subprocess.run(argv, check=False)
    if completed.returncode != 0:
        raise PilihError(
            "The browser install failed.",
            code="browser_install_failed",
            details={"exit": completed.returncode},
        )
    found = [b for b in installed_browsers() if b.name in ("chromium", "chrome")]
    path = found[-1].path if found else playwright_browsers_path()
    size = sum(f.stat().st_size for f in path.rglob("*") if f.is_file()) if path.is_dir() else 0
    st.out.result({"installed": True, "path": str(path), "size_mb": round(size / 1024**2)})


# ------------------------------------------------------------------ launch
async def _hold_open(
    st: CliState, mode: str, profile: str, channel: str | None, url: str | None
) -> dict[str, Any]:
    from pilih_jobs.browser.controller import BrowserController

    controller = BrowserController(data_dir=st.runtime().paths.data_dir)
    await controller.start(cast(Any, mode), profile, channel, False, None)
    try:
        page = (
            controller.context.pages[0]
            if controller.context.pages
            else await controller.context.new_page()
        )
        if url:
            from pilih_jobs.policy.domains import url_host

            if url_host(url) is None:
                raise UsageError("--url must be an http(s) URL.")
            await page.goto(url)
        health = await controller.health()
        st.out.info("The browser is open. Close its window or press Enter here when you are done.")
        closed = asyncio.ensure_future(page.wait_for_event("close", timeout=0))
        enter = asyncio.ensure_future(asyncio.to_thread(sys.stdin.readline))
        await asyncio.wait({closed, enter}, return_when=asyncio.FIRST_COMPLETED)
        for task in (closed, enter):
            task.cancel()
        return health.to_json()
    finally:
        await controller.stop("user_done")


@group.command("launch")
def launch_cmd(
    ctx: typer.Context,
    mode: Annotated[
        str,
        typer.Option("--mode", help="managed (Mode A) or connected (Mode B: print the command)."),
    ] = "managed",
    profile: Annotated[
        str | None, typer.Option("--profile", help="Profile name (default apply-default).")
    ] = None,
    channel: Annotated[
        str | None, typer.Option("--channel", help="chromium | chrome | msedge.")
    ] = None,
    port: Annotated[int, typer.Option("--port", help="Mode B debugging port.")] = 9222,
) -> None:
    """Start a managed browser with a profile, headed, for inspection (Mode A), or print the
    exact Mode B launch command (never run by the CLI)."""
    from pilih_jobs.browser.cdp import SECURITY_WARNING, launch_commands
    from pilih_jobs.browser.profiles import apply_profile_name, current_os_style

    st = state(ctx)
    if mode == "connected":
        browser = "msedge" if channel == "msedge" else "chrome"
        data_dir = st.runtime().paths.browser_profiles_dir / (
            "connected-edge" if browser == "msedge" else "connected-chrome"
        )
        commands = launch_commands(
            browser=cast(Any, browser),
            port=port,
            user_data_dir=data_dir,
            current_platform=current_os_style(),
        )

        def human(console: Console, data: Any) -> None:
            console.print(
                f"Run this yourself, then `pilih-jobs browser connect --cdp http://127.0.0.1:{port}`:"
            )
            console.print(cast(dict[str, Any], data)["command"], markup=False)
            console.print(f"\nWarning: {SECURITY_WARNING}", style="yellow", markup=False)

        st.out.result(
            {
                "mode": "connected",
                "command": commands[current_os_style()],
                "commands": commands,
                "warning": SECURITY_WARNING,
            },
            human=human,
        )
        return
    if mode != "managed":
        raise UsageError("--mode must be managed or connected.")
    if not st.interactive:
        raise InputRequiredError("`browser launch` opens a window for you; run it in a terminal.")
    name = apply_profile_name(profile or st.runtime().config.browser.default_profile)
    health = st.run(
        _hold_open(st, "managed", name, channel or st.runtime().config.browser.channel, None)
    )
    st.out.result({"profile": name, **health})


# ------------------------------------------------------------------ login (Mode C)
@group.command("login")
def login_cmd(
    ctx: typer.Context,
    profile: Annotated[str, typer.Argument(help="Profile to prepare, e.g. work-portals.")],
    url: Annotated[
        str | None, typer.Option("--url", help="Page to open first (default about:blank).")
    ] = None,
    domain: Annotated[
        list[str] | None,
        typer.Option("--domain", help="Domain hint to record (repeatable; typed by you)."),
    ] = None,
) -> None:
    """Open a headed session on a named profile so you can sign in to ATS / email sites
    yourself; closes on Enter. Only your typed domain hints are recorded (18 §3.3)."""
    st = state(ctx)
    store = _store(st)
    dir_name, meta = store.create(profile, domains_hint=domain or [])
    if not st.interactive:
        raise InputRequiredError(
            "`browser login` needs you at the browser window; run it in a terminal.",
            details={"needed": {"profile": dir_name}},
        )
    st.run(_hold_open(st, "persistent", dir_name, meta.channel or None, url))
    st.out.result({"profile": dir_name, "name": meta.name, "domains_hint": meta.domains_hint})


# ------------------------------------------------------------------ connect (Mode B)
async def _connect(endpoint: str, data_dir: Any) -> dict[str, Any]:
    from pilih_jobs.browser.controller import BrowserController

    controller = BrowserController(data_dir=data_dir)
    await controller.start("connected", None, None, False, endpoint)
    try:
        page = await controller.context.new_page()  # a test page of ours, closed right away
        await page.close()
        version = controller.cdp_version.to_json() if controller.cdp_version else {}
        return {
            "endpoint": controller.cdp_endpoint,
            "browser_version": version.get("browser"),
            "protocol_version": version.get("protocol_version"),
        }
    finally:
        await controller.stop("connect_test")


@group.command("connect")
def connect_cmd(
    ctx: typer.Context,
    cdp: Annotated[
        str, typer.Option("--cdp", help="Loopback DevTools endpoint, e.g. http://127.0.0.1:9222.")
    ] = "http://127.0.0.1:9222",
    remember: Annotated[
        bool, typer.Option("--remember", help="Store the endpoint in browser.cdp_endpoint.")
    ] = False,
) -> None:
    """Register a Mode B CDP endpoint (loopback only) and test it (18 §3.2)."""
    from pilih_jobs.browser.cdp import SECURITY_WARNING, validate_cdp_endpoint
    from pilih_jobs.config import set_value

    st = state(ctx)
    endpoint = validate_cdp_endpoint(cdp)
    st.out.notice(SECURITY_WARNING)
    rt = st.runtime()
    data = st.run(_connect(endpoint, rt.paths.data_dir))
    if remember:
        set_value(rt.paths, "browser.cdp_endpoint", endpoint)
    data["remembered"] = remember
    data["warning"] = SECURITY_WARNING
    st.out.result(data)


# ------------------------------------------------------------------ status
@group.command("status")
def status_cmd(ctx: typer.Context) -> None:
    """Installed browsers, configured mode and profile locks."""
    from pilih_jobs.browser.cdp import cdp_port_open
    from pilih_jobs.environment import branded_browser_available, installed_browsers

    st = state(ctx)
    rt = st.runtime()
    cfg = rt.config.browser
    endpoint = cfg.cdp_endpoint or None
    port_open = st.run(cdp_port_open(endpoint)) if endpoint else None
    data = {
        "mode": cfg.mode,
        "default_profile": cfg.default_profile,
        "channel": cfg.channel,
        "cdp_endpoint": endpoint,
        "cdp_port_open": port_open,
        "installed": [{"name": b.name, "revision": b.revision} for b in installed_browsers()],
        "branded": {name: branded_browser_available(name) for name in ("chrome", "msedge")},
        "profiles": _store(st).list(),
    }

    def human(console: Console, value: Any) -> None:
        payload = cast(dict[str, Any], value)
        console.print(
            key_value_table(
                {
                    k: payload[k]
                    for k in ("mode", "default_profile", "channel", "cdp_endpoint", "cdp_port_open")
                }
            )
        )
        rows = cast(list[dict[str, Any]], payload["profiles"])
        console.print(
            items_table(rows, ["profile", "purpose", "exists", "locked"])
            if rows
            else "(no profiles)"
        )

    st.out.result(data, human=human)


# ------------------------------------------------------------------ profiles
def _name(name: str | None, option: str | None) -> str:
    value = option or name
    if not value:
        raise UsageError("Give the profile name (argument or --name).")
    return value


@profiles_group.callback()
def profiles_root(ctx: typer.Context) -> None:
    """Without a subcommand: list profiles."""
    if ctx.invoked_subcommand is None:
        profiles_list(ctx)


@profiles_group.command("list")
def profiles_list(ctx: typer.Context) -> None:
    """List profiles with purpose, lock state and domain hints."""
    st = state(ctx)
    rows = _store(st).list()

    def human(console: Console, value: Any) -> None:
        items = cast(dict[str, Any], value)["profiles"]
        console.print(
            items_table(items, ["profile", "name", "purpose", "exists", "locked", "domains_hint"])
            if items
            else "(no profiles)"
        )

    st.out.result({"profiles": rows}, human=human)


@profiles_group.command("create")
def profiles_create(
    ctx: typer.Context,
    name: Annotated[str | None, typer.Argument(help="Profile name.")] = None,
    name_opt: Annotated[str | None, typer.Option("--name", help="Profile name.")] = None,
    domain: Annotated[
        list[str] | None, typer.Option("--domain", help="Domain hint (repeatable).")
    ] = None,
    channel: Annotated[
        str | None, typer.Option("--channel", help="chromium | chrome | msedge.")
    ] = None,
) -> None:
    """Create a named profile (apply-<name>, or `discovery`)."""
    st = state(ctx)
    dir_name, meta = _store(st).create(
        _name(name, name_opt), domains_hint=domain or [], channel=channel
    )
    st.out.result({"profile": dir_name, **meta.to_json()})


@profiles_group.command("delete")
def profiles_delete(
    ctx: typer.Context,
    name: Annotated[str | None, typer.Argument(help="Profile name.")] = None,
    name_opt: Annotated[str | None, typer.Option("--name", help="Profile name.")] = None,
) -> None:
    """Delete a profile directory and its metadata (refused while in use)."""
    st = state(ctx)
    value = _name(name, name_opt)
    if not st.confirm(f"Delete browser profile {value} and every session in it?"):
        st.out.result({"deleted": False})
        return
    st.out.result({"deleted": _store(st).delete(value), "profile": value})


@profiles_group.command("reset")
def profiles_reset(
    ctx: typer.Context,
    name: Annotated[str | None, typer.Argument(help="Profile name, e.g. discovery.")] = None,
    name_opt: Annotated[str | None, typer.Option("--name", help="Profile name.")] = None,
) -> None:
    """Wipe a profile's browser data, keeping its metadata."""
    st = state(ctx)
    value = _name(name, name_opt)
    if not st.confirm(f"Wipe the browser data of profile {value}?"):
        st.out.result({"reset": False})
        return
    st.out.result({"reset": _store(st).reset(value), "profile": value})


@profiles_group.command("unlock")
def profiles_unlock(
    ctx: typer.Context,
    name: Annotated[str | None, typer.Argument(help="Profile name.")] = None,
    name_opt: Annotated[str | None, typer.Option("--name", help="Profile name.")] = None,
) -> None:
    """Remove a stale Chromium SingletonLock after you confirm — only when no browser
    process uses the profile (18 §4.2 step 3)."""
    from pilih_jobs.browser.profiles import unlock_profile

    st = state(ctx)
    store = _store(st)
    dir_name = store.resolve(_name(name, name_opt))
    path = store.root / dir_name
    if not st.confirm(
        f"Remove the lock files of profile {dir_name}? Close every window using it first."
    ):
        st.out.result({"unlocked": False})
        return
    removed = unlock_profile(path, name=dir_name)
    st.out.result({"unlocked": True, "profile": dir_name, "removed": removed})


group.add_typer(profiles_group, name="profiles")


def register(app: typer.Typer) -> None:
    app.add_typer(group, name="browser")
