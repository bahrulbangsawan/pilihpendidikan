"""`version`, `doctor`, `update`, `uninstall` (16 §3.3, 22 §4, §5, §8.3, §11).

These commands never trip the version gate (16 §12): they must work on an outdated CLI.
"""

from __future__ import annotations

import importlib.util
import json
import shutil
import subprocess
import sys
import time
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Annotated, Any, Final, Literal, cast
from urllib.parse import urlsplit

import httpx
import typer
from rich.console import Console

from pilih_jobs.api.errors import ApiError, NetworkError
from pilih_jobs.auth.flow import logout
from pilih_jobs.auth.store import backend_problem
from pilih_jobs.cli.context import CliState, state
from pilih_jobs.cli.output import items_table, key_value_table
from pilih_jobs.config import is_loopback_host
from pilih_jobs.contracts import CONTRACTS_VERSION
from pilih_jobs.environment import (
    UNINSTALL_COMMANDS,
    UPGRADE_COMMANDS,
    detect_installer,
    free_bytes,
    installed_browsers,
    is_64bit,
    playwright_browsers_path,
)
from pilih_jobs.errors import PilihError
from pilih_jobs.logging import redact
from pilih_jobs.runtime import Runtime
from pilih_jobs.storage.locks import FileLock
from pilih_jobs.version import (
    __version__,
    arch,
    channel,
    compare_versions,
    dependency_version,
    device_platform,
    python_version,
)

PYPI_URL: Final = "https://pypi.org/pypi/pilih-jobs/json"
PYPI_CACHE_MS: Final = 24 * 3600 * 1000
GB: Final = 1024**3
MB: Final = 1024**2
CLOCK_SKEW_LIMIT_MS: Final = 120_000


# ---------------------------------------------------------------------------- version
def version_info() -> dict[str, Any]:
    return {
        "pilih_jobs": __version__,
        "channel": channel(),
        "contracts": CONTRACTS_VERSION,
        "python": python_version(),
        "playwright": dependency_version("playwright"),
        "scrapling": dependency_version("scrapling"),
        "browsers": [f"{b.name}-{b.revision}" for b in installed_browsers()],
        "platform": device_platform(),
        "arch": arch(),
        "installer": detect_installer(),
    }


def _version(ctx: typer.Context) -> None:
    """Versions of pilih-jobs, Python, Playwright, Scrapling and the installed browsers."""
    st = state(ctx)
    info = version_info()

    def human(console: Console, data: Any) -> None:
        values = cast(dict[str, Any], data)
        console.print(f"pilih-jobs {values['pilih_jobs']} ({values['channel']})", markup=False)
        console.print(
            key_value_table({k: v for k, v in values.items() if k not in ("pilih_jobs", "channel")})
        )

    st.out.result(info, human=human)


# ---------------------------------------------------------------------------- doctor
Severity = Literal["error", "warning"]


@dataclass
class Check:
    name: str
    ok: bool
    detail: str
    fix: str | None = None
    severity: Severity = "error"


def expected_chromium_revision() -> str | None:
    """The Chromium revision the installed Playwright expects (`driver/package/browsers.json`)."""
    spec = importlib.util.find_spec("playwright")
    if spec is None or spec.origin is None:
        return None
    manifest = Path(spec.origin).parent / "driver" / "package" / "browsers.json"
    try:
        data = cast(dict[str, Any], json.loads(manifest.read_text("utf-8")))
    except (OSError, json.JSONDecodeError):
        return None
    for browser in cast(list[dict[str, Any]], data.get("browsers") or []):
        if browser.get("name") == "chromium":
            return str(browser.get("revision"))
    return None


_LAUNCH_PROBE: Final = (
    "import sys\n"
    "from playwright.sync_api import sync_playwright\n"
    "with sync_playwright() as p:\n"
    "    b = p.chromium.launch(headless=True)\n"
    "    page = b.new_page(); page.goto('about:blank'); b.close()\n"
    "sys.stdout.write('ok')\n"
)


def _check_python() -> Check:
    supported = (3, 11) <= sys.version_info[:2] <= (3, 13)
    ok = supported and is_64bit()
    return Check(
        "python",
        ok,
        f"Python {python_version()} ({'64' if is_64bit() else '32'}-bit)",
        None if ok else "Install with `uv tool install --python 3.12 pilih-jobs`.",
    )


def _check_disk(rt: Runtime) -> Check:
    browsers = free_bytes(playwright_browsers_path())
    data = free_bytes(rt.paths.data_dir)
    ok = (browsers is None or browsers >= int(1.5 * GB)) and (data is None or data >= 500 * MB)
    detail = (
        f"{(browsers or 0) / GB:.1f} GB free for browsers, {(data or 0) / GB:.1f} GB free for data"
    )
    return Check(
        "disk", ok, detail, None if ok else "Free at least 1.5 GB (browsers) and 500 MB (data)."
    )


def _check_browser(rt: Runtime) -> list[Check]:
    checks: list[Check] = []
    if rt.config.browser.channel != "chromium":
        from pilih_jobs.environment import branded_browser_available

        ok = branded_browser_available(rt.config.browser.channel)
        return [
            Check(
                "browser",
                ok,
                f"channel {rt.config.browser.channel} {'found' if ok else 'not found'}",
                None
                if ok
                else f"Install {rt.config.browser.channel} or `pilih-jobs browser install`.",
                "warning",
            )
        ]
    expected = expected_chromium_revision()
    present = {b.revision for b in installed_browsers() if b.name == "chromium"}
    if not present:
        return [
            Check(
                "browser",
                False,
                "Chromium is not installed",
                "pilih-jobs browser install",
                "warning",
            )
        ]
    revision_ok = expected is None or expected in present
    checks.append(
        Check(
            "browser",
            revision_ok,
            f"chromium {', '.join(sorted(present))} (Playwright expects {expected or 'unknown'})",
            None if revision_ok else "pilih-jobs browser install",
            "warning",
        )
    )
    if revision_ok:
        started = time.monotonic()
        try:
            probe = subprocess.run(
                [sys.executable, "-c", _LAUNCH_PROBE],
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            elapsed = time.monotonic() - started
            ok = probe.returncode == 0 and probe.stdout.endswith("ok") and elapsed < 10
            detail = f"headless launch {'ok' if ok else 'failed'} in {elapsed:.1f} s"
        except subprocess.TimeoutExpired:
            ok, detail = False, "headless launch timed out"
        checks.append(
            Check(
                "browser_launch",
                ok,
                detail,
                None if ok else "pilih-jobs browser install",
                "warning",
            )
        )
        if sys.platform.startswith("linux"):
            checks.append(_check_linux_deps())
    return checks


def _check_linux_deps() -> Check:
    chromium = next((b for b in installed_browsers() if b.name == "chromium"), None)
    binary = chromium.path / "chrome-linux" / "chrome" if chromium else None
    ldd = shutil.which("ldd")
    if binary is None or not binary.exists() or ldd is None:
        return Check("system_deps", True, "not checked", None, "warning")
    result = subprocess.run([ldd, str(binary)], capture_output=True, text=True, check=False)
    missing = [line.split()[0] for line in result.stdout.splitlines() if "not found" in line]
    return Check(
        "system_deps",
        not missing,
        "all libraries found" if not missing else f"missing: {', '.join(missing)}",
        None if not missing else "pilih-jobs browser install (runs playwright install --with-deps)",
        "warning",
    )


def _check_keyring(rt: Runtime) -> Check:
    if rt.config.credentials.store == "encrypted-file":
        return Check("keyring", True, "encrypted-file credential store configured")
    try:
        import keyring

        backend = keyring.get_keyring()
        problem = backend_problem(backend)
    except Exception as exc:  # noqa: BLE001 - report any backend failure
        problem = str(exc)
        backend = None
    name = f"{type(backend).__module__}.{type(backend).__name__}" if backend is not None else "none"
    return Check(
        "keyring",
        problem is None,
        f"backend {name}" if problem is None else problem,
        None
        if problem is None
        else "Run in a desktop session, start gnome-keyring via dbus-run-session, or "
        "`pilih-jobs config set credentials.store encrypted-file`.",
    )


async def _check_remote(rt: Runtime) -> list[Check]:
    checks: list[Check] = []
    async with rt.api_client(auth=False, version_gate=False) as api:
        try:
            response = await api.request("GET", "/api/v1/meta", auth=False)
        except (NetworkError, ApiError) as exc:
            return [
                Check(
                    "api",
                    False,
                    f"{rt.issuer} unreachable: {exc.message}",
                    "Check your network.",
                    "warning",
                )
            ]
        meta = cast(dict[str, Any], response.data or {})
        minimum = str(meta.get("min_cli_version", "0.0.0"))
        compatible = compare_versions(__version__, minimum) >= 0
        checks.append(
            Check(
                "api",
                compatible,
                f"{rt.issuer} reachable; min CLI {minimum}, recommended "
                f"{meta.get('recommended_cli_version', '?')}",
                None if compatible else "pilih-jobs update",
            )
        )
        sample = rt.clock.observe_http_date(response.headers.get("date"))
        if sample is not None:
            skew = abs(sample.offset_ms)
            checks.append(
                Check(
                    "clock",
                    skew < CLOCK_SKEW_LIMIT_MS,
                    f"local clock differs from the server by {skew / 1000:.1f} s",
                    None if skew < CLOCK_SKEW_LIMIT_MS else "Enable automatic time sync (NTP).",
                )
            )
    if rt.account() is None:
        checks.append(Check("auth", False, "not signed in", "pilih-jobs login", "warning"))
        return checks
    try:
        async with rt.api_client(version_gate=False) as api:
            me = cast(dict[str, Any], await api.get("/api/v1/me"))
        device = cast(dict[str, Any] | None, me.get("device"))
        checks.append(
            Check(
                "auth",
                device is not None,
                f"signed in as {me.get('email')}; device "
                + (str(device.get("name")) if device else "not registered"),
                None if device else "pilih-jobs login",
                "warning",
            )
        )
    except (PilihError, NetworkError) as exc:
        checks.append(Check("auth", False, exc.message, "pilih-jobs login", "warning"))
    return checks


async def _check_cdp(rt: Runtime) -> Check | None:
    endpoint = rt.config.browser.cdp_endpoint
    if rt.config.browser.mode != "connected" or not endpoint:
        return None
    host = urlsplit(endpoint).hostname or ""
    if not is_loopback_host(host):
        return Check("cdp", False, "CDP endpoint is not loopback", "Use http://127.0.0.1:<port>.")
    base = endpoint.replace("ws://", "http://").split("/devtools", 1)[0]
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{base}/json/version")
        ok = response.is_success
        detail = (
            str(cast(dict[str, Any], response.json()).get("Browser"))
            if ok
            else f"HTTP {response.status_code}"
        )
    except (httpx.HTTPError, ValueError) as exc:
        ok, detail = False, type(exc).__name__
    return Check(
        "cdp",
        ok,
        detail,
        None if ok else "pilih-jobs browser connect --cdp http://127.0.0.1:9222",
        "warning",
    )


def _check_policy() -> Check:
    loaded = [name for name in ("scrapling", "playwright", "patchright") if name in sys.modules]
    return Check(
        "policy",
        not loaded,
        "import guard: no automation driver loaded in the CLI process"
        if not loaded
        else f"unexpected modules loaded: {', '.join(loaded)}",
    )


def run_doctor(st: CliState, rt: Runtime) -> list[Check]:
    checks: list[Check] = [
        _check_python(),
        Check("installer", True, detect_installer(), None, "warning"),
        _check_disk(rt),
        *_check_browser(rt),
        _check_keyring(rt),
        _check_policy(),
    ]
    checks.extend(st.run(_check_remote(rt)))
    cdp = st.run(_check_cdp(rt))
    if cdp is not None:
        checks.append(cdp)
    return checks


def _bundle(rt: Runtime, checks: list[Check], out_dir: Path) -> tuple[Path, list[str]]:
    """Support bundle (22 §8.3): never state.db, profiles, staging, tokens or screenshots."""
    stamp = time.strftime("%Y%m%d-%H%M%S")
    target = out_dir / f"pilih-jobs-support-{stamp}.zip"
    log_tail: list[str] = []
    if rt.paths.log_file.exists():
        log_tail = rt.paths.log_file.read_text("utf-8", errors="replace").splitlines()[-1000:]
    outbox_rows = rt.db.query(
        "SELECT state, kind, path, last_status, last_error FROM outbox ORDER BY id DESC LIMIT 500"
    )
    outbox = [
        {
            "state": r["state"],
            "kind": r["kind"],
            "path": r["path"],
            "last_status": r["last_status"],
            "error": (str(r["last_error"]).split(":", 1)[0] if r["last_error"] else None),
        }
        for r in outbox_rows
    ]
    documents: dict[str, Any] = {
        "doctor.json": [asdict(c) for c in checks],
        "versions.json": version_info(),
        "config.json": rt.config.model_dump(),
        "outbox.json": outbox,
        "local_tasks.json": [
            dict(r)
            for r in rt.db.query("SELECT task_id, kind, local_state, updated_at FROM local_tasks")
        ],
        "browsers.json": {
            "installed": [f"{b.name}-{b.revision}" for b in installed_browsers()],
            "profiles": sorted(
                p.name for p in rt.paths.browser_profiles_dir.glob("*") if p.is_dir()
            ),
        },
    }
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, document in documents.items():
            archive.writestr(name, json.dumps(redact(document), indent=2, default=str))
        archive.writestr(
            "logs/pilih-jobs.log", "\n".join(str(redact(line)) for line in log_tail) + "\n"
        )
    files = [*documents, "logs/pilih-jobs.log"]
    return target, files


def _doctor(
    ctx: typer.Context,
    bundle: Annotated[
        bool,
        typer.Option(
            "--bundle", help="Write a redacted support bundle (zip) to the current directory."
        ),
    ] = False,
) -> None:
    """Environment checks with the exact fix for each failure."""
    st = state(ctx)
    rt = st.runtime()
    checks = run_doctor(st, rt)
    data: dict[str, Any] = {"checks": [asdict(c) for c in checks]}
    if bundle:
        names = [
            "doctor.json",
            "versions.json",
            "config.json",
            "logs/pilih-jobs.log",
            "outbox.json",
            "local_tasks.json",
            "browsers.json",
        ]
        if st.interactive and not st.confirm(
            "Write a support bundle with: "
            + ", ".join(names)
            + "? (no tokens, state.db, profiles or screenshots)",
            default=True,
        ):
            data["bundle"] = None
        else:
            path, written = _bundle(rt, checks, Path.cwd())
            data["bundle"] = {"path": str(path), "files": written}

    def human(console: Console, value: Any) -> None:
        rows = cast(list[dict[str, Any]], cast(dict[str, Any], value)["checks"])
        table_rows = [
            {
                "check": r["name"],
                "status": "ok" if r["ok"] else ("FAIL" if r["severity"] == "error" else "warn"),
                "detail": r["detail"],
                "fix": r["fix"] or "",
            }
            for r in rows
        ]
        console.print(items_table(table_rows, ["check", "status", "detail", "fix"]))
        bundle_info = cast(dict[str, Any], value).get("bundle")
        if bundle_info:
            console.print(f"Support bundle: {bundle_info['path']}", markup=False)

    st.out.result(data, human=human)
    failed = [c for c in checks if not c.ok and c.severity == "error"]
    if failed:
        raise typer.Exit(1)


# ---------------------------------------------------------------------------- update
async def latest_pypi_version(rt: Runtime, *, force: bool = False) -> str | None:
    cached = None if force else rt.db.cached("pypi_latest", PYPI_CACHE_MS)
    if isinstance(cached, str):
        return cached
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(10.0)) as client:
            response = await client.get(PYPI_URL, headers={"Accept": "application/json"})
        if not response.is_success:
            return None
        info = cast(dict[str, Any], cast(dict[str, Any], response.json()).get("info") or {})
        latest = info.get("version")
    except (httpx.HTTPError, ValueError):
        return None
    if isinstance(latest, str):
        rt.db.kv_put_cached("pypi_latest", latest)
        return latest
    return None


async def update_status(rt: Runtime) -> dict[str, Any]:
    latest = await latest_pypi_version(rt)
    meta = None
    async with rt.api_client(auth=False, version_gate=False) as api:
        meta = await api.get_meta(force=True)
    required = meta is not None and meta.upgrade_required
    newer = latest is not None and compare_versions(latest, __version__) > 0
    action = "upgrade_required" if required else ("upgrade_available" if newer else "up_to_date")
    return {
        "current": __version__,
        "latest": latest,
        "min_cli_version": meta.min_cli_version if meta else None,
        "recommended_cli_version": meta.recommended_cli_version if meta else None,
        "installer": detect_installer(),
        "action": action,
    }


def _update(
    ctx: typer.Context,
    check: Annotated[
        bool, typer.Option("--check", help="Only compare with PyPI and the server minimum.")
    ] = False,
) -> None:
    """Self-update through the installer that installed pilih-jobs (uv, pipx, Homebrew, Scoop)."""
    st = state(ctx)
    rt = st.runtime()
    info = st.run(update_status(rt))
    installer = detect_installer()
    command = UPGRADE_COMMANDS[installer]
    info["command"] = " ".join(command)
    if check or info["action"] == "up_to_date":
        st.out.result(info)
        return
    if installer == "pip":
        info["action"] = "manual"
        st.out.result(info)
        return
    if FileLock(rt.paths.worker_lock).is_locked_elsewhere() and not st.confirm(
        "The worker is running; update anyway? (stop it first with `pilih-jobs worker stop`)"
    ):
        st.out.result({**info, "action": "cancelled"})
        return
    executable = shutil.which(command[0])
    if executable is None:
        raise PilihError(f"{command[0]} is not on PATH; run `{info['command']}` manually.")
    completed = subprocess.run([executable, *command[1:]], check=False)
    info["action"] = "upgraded" if completed.returncode == 0 else "failed"
    info["next"] = "pilih-jobs browser install (if the new version needs another Chromium)"
    st.out.result(info)
    if completed.returncode != 0:
        raise typer.Exit(1)


# ---------------------------------------------------------------------------- uninstall
def _dir_size(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(p.stat().st_size for p in path.rglob("*") if p.is_file() and not p.is_symlink())


def _uninstall(
    ctx: typer.Context,
    purge_data: Annotated[
        bool,
        typer.Option(
            "--purge-data",
            help="Also delete local data (profiles, state.db, runs), caches and logs.",
        ),
    ] = False,
) -> None:
    """Stop the worker, sign out, and print the installer-specific removal command."""
    st = state(ctx)
    rt = st.runtime()
    steps: list[dict[str, Any]] = []
    if FileLock(rt.paths.worker_lock).is_locked_elsewhere():
        stop = subprocess.run(
            [sys.executable, "-m", "pilih_jobs", "--json", "worker", "stop"],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )
        steps.append({"step": "worker stop", "ok": stop.returncode == 0})
    else:
        steps.append({"step": "worker stop", "ok": True, "detail": "not running"})
    if rt.account() is not None:
        try:
            result = st.run(
                logout(rt, forget_device=True, confirm=lambda q: st.confirm(q, default=True))
            )
            steps.append({"step": "logout", "ok": True, "revoked": result.revoked})
        except PilihError as exc:
            steps.append({"step": "logout", "ok": False, "detail": exc.message})
    else:
        steps.append({"step": "logout", "ok": True, "detail": "not signed in"})
    steps.append({"step": "delete keyring entries", "ok": True})
    if purge_data:
        targets = [rt.paths.data_dir, rt.paths.cache_dir, rt.paths.log_dir]
        if rt.paths.config_dir != rt.paths.data_dir:
            targets.append(rt.paths.config_dir)
        sizes = ", ".join(f"{t} ({_dir_size(t) / MB:.1f} MB)" for t in targets if t.exists())
        if st.confirm(f"Delete {sizes or 'local data'}? This cannot be undone."):
            rt.close()
            for target in targets:
                shutil.rmtree(target, ignore_errors=True)
            steps.append(
                {"step": "delete local data", "ok": True, "paths": [str(t) for t in targets]}
            )
        else:
            steps.append({"step": "delete local data", "ok": False, "detail": "cancelled"})
    installer = detect_installer()
    steps.append(
        {
            "step": "remove the package",
            "command": UNINSTALL_COMMANDS[installer],
            "browsers": "python -m playwright uninstall --all (inside the tool environment)",
        }
    )

    def human(console: Console, value: Any) -> None:
        for step in cast(list[dict[str, Any]], cast(dict[str, Any], value)["steps"]):
            if "command" in step:
                console.print(f"Finally run: {step['command']}", markup=False)
                console.print(f"Browsers: {step['browsers']}", markup=False, style="dim")
            else:
                mark = "done" if step.get("ok") else "skipped"
                console.print(
                    f"{step['step']}: {mark} {step.get('detail', '')}".rstrip(), markup=False
                )

    st.out.result({"steps": steps}, human=human)


def register(app: typer.Typer) -> None:
    app.command("version")(_version)
    app.command("doctor")(_doctor)
    app.command("update")(_update)
    app.command("uninstall")(_uninstall)
