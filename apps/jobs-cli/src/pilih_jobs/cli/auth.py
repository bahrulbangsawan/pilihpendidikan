"""`login`, `logout`, `whoami` (16 §3.3, 17 §10, §8)."""

from __future__ import annotations

import webbrowser
from typing import Annotated, Any, cast
from urllib.parse import urlsplit

import typer
from rich.console import Console

from pilih_jobs.auth.flow import LoginOptions, login, logout
from pilih_jobs.cli.context import CliState, state
from pilih_jobs.cli.output import key_value_table
from pilih_jobs.errors import NotAuthenticatedError, UsageError
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.engine import SyncEngine


def web_origin(issuer: str) -> str:
    """The `apps/jobs` origin that belongs to an API issuer."""
    parts = urlsplit(issuer)
    host = parts.hostname or ""
    if host in ("localhost", "127.0.0.1", "::1"):
        return f"{parts.scheme}://{host}:4007"
    if host.startswith("api."):
        return f"https://jobs.{host[4:]}"
    return f"https://jobs.{host}"


def _login(
    ctx: typer.Context,
    device_name: Annotated[
        str | None,
        typer.Option(
            "--device-name",
            help="Name shown on the consent page and Devices list (≤ 60 chars).",
            metavar="NAME",
        ),
    ] = None,
    no_browser: Annotated[
        bool,
        typer.Option(
            "--no-browser",
            help="Print the URL instead of opening a browser (the loopback must still be "
            "reachable; use an SSH tunnel with --port on remote hosts).",
        ),
    ] = False,
    port: Annotated[
        int | None,
        typer.Option(
            "--port", min=1024, max=65535, help="Fixed loopback port (for SSH port forwarding)."
        ),
    ] = None,
    scopes: Annotated[
        list[str] | None,
        typer.Option(
            "--scopes",
            "--scope",
            help="Extra (step-up) scopes, e.g. automation:manage or devices:manage (advanced).",
            metavar="SCOPE",
        ),
    ] = None,
    credential_store: Annotated[
        str | None,
        typer.Option(
            "--credential-store",
            help="keyring (default) or encrypted-file (headless Linux; needs a passphrase).",
            metavar="STORE",
        ),
    ] = None,
) -> None:
    """Sign in with OAuth PKCE in your browser and register this device."""
    st = state(ctx)
    if credential_store not in (None, "keyring", "encrypted-file"):
        raise UsageError("--credential-store must be keyring or encrypted-file.")
    rt = st.runtime()
    options = LoginOptions(
        device_name=device_name,
        no_browser=no_browser,
        port=port,
        scopes=list(scopes or []),
        credential_store=credential_store,
    )
    # The URL is needed even with --json / -q: always on stderr, never in stdout JSON.
    options.announce = lambda message: st.out.console(err=True).print(message, markup=False)
    result = st.run(login(rt, options))

    def human(console: Console, data: Any) -> None:
        console.print(
            f"Signed in as {result.email} on device '{result.device_name}'"
            + (" (existing device)" if result.device_reused else ""),
            markup=False,
        )
        console.print(f"Scopes: {' '.join(result.scopes)}", markup=False, style="dim")
        if result.quarantined:
            console.print(
                f"{result.quarantined} unsynced change(s) of the previous account were quarantined "
                "(see `pilih-jobs sync --status`).",
                markup=False,
            )

    st.out.result(result.as_dict(), human=human)


async def _flush_before_logout(rt: Runtime, api: Any) -> None:
    engine = SyncEngine(
        rt.db, rt.issuer, api, state_lock=rt.state_lock, upload_root=rt.paths.data_dir
    )
    await engine.push()


def _logout(
    ctx: typer.Context,
    all_devices: Annotated[
        bool,
        typer.Option(
            "--all-devices", help="Also open the web Devices page to sign out other devices."
        ),
    ] = False,
    discard_outbox: Annotated[
        bool,
        typer.Option("--discard-outbox", help="Drop unsynced changes instead of keeping them."),
    ] = False,
    forget_device: Annotated[
        bool,
        typer.Option(
            "--forget-device", help="Also revoke this device (it will not be reused on re-login)."
        ),
    ] = False,
) -> None:
    """Revoke the refresh token (RFC 7009) and delete the stored credentials."""
    st = state(ctx)
    rt = st.runtime()

    def confirm(question: str) -> bool:
        return st.confirm(question, default=True)

    result = st.run(
        logout(
            rt,
            discard_outbox=discard_outbox,
            forget_device=forget_device,
            confirm=confirm,
            flush=lambda api: _flush_before_logout(rt, api),
        )
    )
    data = result.as_dict()
    if all_devices:
        url = f"{web_origin(rt.issuer)}/cli"
        data["devices_page"] = url
        if st.interactive:
            webbrowser.open(url)

    def human(console: Console, _data: Any) -> None:
        console.print(f"Signed out of {urlsplit(rt.issuer).netloc}.", markup=False)
        if not result.revoked:
            console.print(
                "The server could not confirm the revocation (offline?); local credentials were "
                "deleted anyway.",
                markup=False,
                style="yellow",
            )
        if result.outbox_remaining:
            console.print(
                f"{result.outbox_remaining} unsynced change(s) are kept for your next sign-in.",
                markup=False,
            )
        if all_devices:
            console.print(f"Manage other devices at {data['devices_page']}", markup=False)

    st.out.result(data, human=human)


def _whoami_cached(rt: Runtime) -> dict[str, Any]:
    account = rt.account()
    if account is None:
        raise NotAuthenticatedError()
    return {
        "user_id": account.user_id,
        "email": account.email,
        "device": {"id": account.device_id, "name": account.device_name},
        "scopes": account.scopes,
        "issuer": account.issuer,
        "cached": True,
    }


async def _whoami_remote(rt: Runtime) -> dict[str, Any]:
    async with rt.api_client() as api:
        me = cast(dict[str, Any], await api.get("/api/v1/me"))
    return {
        "user_id": me.get("user_id"),
        "email": me.get("email"),
        "device": me.get("device"),
        "scopes": me.get("scopes", []),
        "credential_kind": me.get("credential_kind"),
        "issuer": rt.issuer,
    }


def _whoami(
    ctx: typer.Context,
    cached: Annotated[
        bool, typer.Option("--cached", help="Show the stored identity without contacting the API.")
    ] = False,
) -> None:
    """Show who you are signed in as (`GET /api/v1/me`)."""
    st: CliState = state(ctx)
    rt = st.runtime()
    data = _whoami_cached(rt) if cached else st.run(_whoami_remote(rt))

    def human(console: Console, value: Any) -> None:
        info = cast(dict[str, Any], value)
        device = cast(dict[str, Any] | None, info.get("device")) or {}
        console.print(
            key_value_table(
                {
                    "email": info.get("email"),
                    "user": info.get("user_id"),
                    "device": f"{device.get('name') or '-'} ({device.get('id') or 'no device'})",
                    "scopes": info.get("scopes"),
                    "api": info.get("issuer"),
                }
            )
        )

    st.out.result(data, human=human)


def register(app: typer.Typer) -> None:
    app.command("login")(_login)
    app.command("logout")(_logout)
    app.command("whoami")(_whoami)
