"""The `pilih-jobs` (alias `pj`) Typer application (16 §3).

- Global flags (16 §3.1) live on the root callback; `main()` also accepts them after the
  subcommand (`pilih-jobs sync --json`) by moving them to the front, unless that
  subcommand declares an option of the same name (`confirm --yes`, `browser launch
  --profile`).
- Every command module exposes `register(app)`; the groups owned by other leaves (C6) are
  mounted the same way. `automation` is a hidden alias of the `worker` group (16 §3).
- Errors become the JSON envelope / Rich message and the 16 §3.2 exit code; unexpected
  exceptions write a redacted crash report (22 §8.2) and exit 1.
"""

from __future__ import annotations

import contextlib
import re
import sys
import time
from collections.abc import Sequence
from pathlib import Path
from typing import Annotated, Any

import typer
from typer import _click

from pilih_jobs.cli import (
    apply,
    approvals,
    auth,
    board,
    browser,
    config,
    cv,
    devices,
    discover,
    email,
    inbox,
    logs,
    rules,
    status,
    sync,
    system,
    worker,
)
from pilih_jobs.cli.context import CliState, state
from pilih_jobs.cli.output import Output
from pilih_jobs.config import load_config, set_value
from pilih_jobs.errors import ExitCode, Interrupted, PilihError, UsageError
from pilih_jobs.telemetry import Telemetry, send_crash_report, write_crash_report

HELP = (
    "pilih-jobs — the local execution engine of the pilihpendidikan Job Tracker: discovery, "
    "browser automation and sync with jobs.pilihpendidikan.com."
)

app = typer.Typer(
    name="pilih-jobs",
    help=HELP,
    no_args_is_help=True,
    add_completion=False,
    pretty_exceptions_enable=False,
    pretty_exceptions_show_locals=False,
    context_settings={"help_option_names": ["-h", "--help"]},
)


@app.callback()
def root(
    ctx: typer.Context,
    json_output: Annotated[
        bool,
        typer.Option("--json", help="Machine output (JSON envelope / NDJSON); implies --no-input."),
    ] = False,
    no_input: Annotated[
        bool, typer.Option("--no-input", help="Never prompt; missing input is an error (exit 8).")
    ] = False,
    yes: Annotated[
        bool,
        typer.Option("--yes", "-y", help="Accept confirmations (never submission approvals)."),
    ] = False,
    verbose: Annotated[
        int, typer.Option("--verbose", "-v", count=True, help="More log output (repeatable).")
    ] = 0,
    quiet: Annotated[
        bool, typer.Option("--quiet", "-q", help="Only errors; the exit code is the contract.")
    ] = False,
    profile: Annotated[
        str | None, typer.Option("--profile", help="Browser profile name.", metavar="NAME")
    ] = None,
    api_url: Annotated[
        str | None,
        typer.Option(
            "--api-url", help="API base URL (dev; also PILIH_JOBS_API_URL).", metavar="URL"
        ),
    ] = None,
    config_path: Annotated[
        str | None, typer.Option("--config", help="Config file path.", metavar="PATH")
    ] = None,
    color: Annotated[
        bool | None, typer.Option("--color/--no-color", help="Force colours on or off.")
    ] = None,
    token_stdin: Annotated[
        bool,
        typer.Option(
            "--token-stdin", help="Read a personal token from stdin (read-only commands)."
        ),
    ] = False,
) -> None:
    st = state(ctx)
    st.json = json_output
    st.no_input = no_input or json_output
    st.yes = yes
    st.verbose = verbose
    st.quiet = quiet
    st.profile = profile
    st.api_url = api_url
    st.config_path = config_path
    st.color = color
    st.token_stdin = token_stdin
    st.out = Output(json_mode=json_output, quiet=quiet, color=color)


for _module in (
    auth,
    status,
    sync,
    config,
    devices,
    system,
    discover,
    inbox,
    board,
    apply,
    browser,
    cv,
    email,
    worker,
    approvals,
    rules,
    logs,
):
    _module.register(app)


def _add_worker_alias() -> None:
    for info in list(app.registered_groups):
        if info.name == "worker" and info.typer_instance is not None:
            app.add_typer(info.typer_instance, name="automation", hidden=True)
            return


_add_worker_alias()

# ---------------------------------------------------------------------------- argv
_GLOBAL_BOOL = frozenset(
    {
        "--json",
        "--no-input",
        "--yes",
        "-y",
        "--verbose",
        "--quiet",
        "-q",
        "--color",
        "--no-color",
        "--token-stdin",
    }
)
_GLOBAL_VALUE = frozenset({"--profile", "--api-url", "--config"})
_VERBOSE_SHORT = re.compile(r"^-v+$")


def _local_option(cmd: _click.Command, name: str) -> Any:
    for param in cmd.params:
        opts = [*getattr(param, "opts", []), *getattr(param, "secondary_opts", [])]
        if name in opts:
            return param
    return None


def _takes_value(param: Any) -> bool:
    return not (getattr(param, "is_flag", False) or getattr(param, "count", False))


def hoist_global_options(args: Sequence[str], root_cmd: _click.Command) -> tuple[list[str], str]:
    """Move global flags placed after a subcommand to the front; return the command path."""
    front: list[str] = []
    out: list[str] = []
    path: list[str] = []
    cmd = root_cmd
    i = 0
    while i < len(args):
        arg = args[i]
        if arg == "--":
            out.extend(args[i:])
            break
        if arg.startswith("-") and arg != "-":
            name, eq, _ = arg.partition("=")
            local = _local_option(cmd, name)
            is_global = (
                name in _GLOBAL_BOOL or name in _GLOBAL_VALUE or bool(_VERBOSE_SHORT.match(name))
            )
            if cmd is not root_cmd and local is None and is_global:
                front.append(arg)
                if name in _GLOBAL_VALUE and not eq and i + 1 < len(args):
                    front.append(args[i + 1])
                    i += 1
                i += 1
                continue
            out.append(arg)
            if local is not None and _takes_value(local) and not eq and i + 1 < len(args):
                out.append(args[i + 1])
                i += 1
            i += 1
            continue
        commands: dict[str, _click.Command] = getattr(cmd, "commands", {}) or {}
        if arg in commands:
            cmd = commands[arg]
            path.append(arg)
        out.append(arg)
        i += 1
    return front + out, " ".join(path)


def _wants_json(args: Sequence[str]) -> bool:
    return "--json" in args


def run_cli(argv: Sequence[str] | None = None) -> int:
    """Run the CLI and return the exit code (tests call this directly)."""
    args = list(sys.argv[1:] if argv is None else argv)
    command = typer.main.get_command(app)
    args, command_path = hoist_global_options(args, command)
    holder: dict[str, CliState] = {}
    started = time.monotonic()

    def current() -> CliState:
        st = holder.get("state")
        if st is None:
            st = CliState(json=_wants_json(args), out=Output(json_mode=_wants_json(args)))
            holder["state"] = st
        return st

    st = current()
    st.command_path = command_path
    st.help_requested = any(arg in ("--help", "-h") for arg in args)
    code = int(ExitCode.FAILURE)
    try:
        result = command.main(args=args, prog_name="pilih-jobs", standalone_mode=False, obj=st)
        code = result if isinstance(result, int) else 0
    except PilihError as exc:
        st.out.error(exc)
        code = int(exc.exit)
    except _click.exceptions.ClickException as exc:
        if st.out.json_mode:
            st.out.error(UsageError(exc.format_message()))
        else:
            exc.show()
        code = (
            int(ExitCode.USAGE) if isinstance(exc, _click.exceptions.UsageError) else exc.exit_code
        )
    except (KeyboardInterrupt, typer.Abort):
        st.out.error(Interrupted("Interrupted."))
        code = int(ExitCode.INTERRUPTED)
    except Exception as exc:  # noqa: BLE001 - last-resort crash handler (22 §8.2)
        code = int(ExitCode.FAILURE)
        report = None
        try:
            report = write_crash_report(st.runtime().paths, exc)
            where = f" A redacted crash report was written to {report}." if report else ""
        except Exception:  # noqa: BLE001 - never let the crash handler crash
            where = ""
        st.out.error(
            PilihError(
                f"Unexpected error ({type(exc).__name__}).{where}",
                code="internal_error",
                hint="pilih-jobs doctor --bundle",
            )
        )
        if report is not None:
            _offer_crash_report(st, report)
    finally:
        _record_telemetry(st, command_path, started, code)
        if code == 0:
            _maybe_ask_telemetry(st)
        st.close()
    return code


def _offer_crash_report(st: CliState, report: Path) -> None:
    """22 §8.2: with telemetry on, ask (TTY only) before posting the redacted report."""
    with contextlib.suppress(Exception):
        rt = st.runtime()
        if not (rt.config.privacy.telemetry and st.interactive):
            return
        if not typer.confirm("Send crash report?", default=False):
            return
        telemetry = Telemetry(rt.paths, enabled=True)

        async def send() -> bool:
            async with rt.api_client(auth=False, version_gate=False) as api:
                return await send_crash_report(api, report, telemetry)

        st.run(send())


def _maybe_ask_telemetry(st: CliState) -> None:
    """22 §8.1: the first interactive run asks once whether to enable telemetry."""
    if st.help_requested or not st.interactive or not st.command_path:
        return
    with contextlib.suppress(Exception):
        rt = st.runtime()
        telemetry = Telemetry(rt.paths, enabled=rt.config.privacy.telemetry)
        if telemetry.was_prompted():
            return
        telemetry.mark_prompted()
        current = load_config(rt.paths)  # re-read: this command may have just set it
        if current.sources.get("privacy.telemetry") != "default":
            return  # already decided in the config file, environment or flags
        answer = typer.confirm(
            "Help improve pilih-jobs by sending anonymous usage counters (command names, "
            "exit codes; never arguments, URLs or personal data)? You can change this "
            "later with `pilih-jobs config set privacy.telemetry`.",
            default=False,
        )
        set_value(rt.paths, "privacy.telemetry", "true" if answer else "false")


def _record_telemetry(st: CliState, command_path: str, started: float, code: int) -> None:
    """Count the command when the user opted in (22 §8.1); never affects the command."""
    if not command_path or st.help_requested:
        return
    with contextlib.suppress(Exception):
        rt = st.runtime()
        Telemetry(rt.paths, enabled=rt.config.privacy.telemetry).record_command(
            command_path, time.monotonic() - started, code
        )


def main() -> None:
    sys.exit(run_cli())
