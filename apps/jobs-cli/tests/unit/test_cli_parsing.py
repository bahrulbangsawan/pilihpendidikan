"""T16-UNIT: command parsing, global flags, output renderers and envelopes (16 §3–§5)."""

from __future__ import annotations

import io
import json
import re
from collections.abc import Callable
from pathlib import Path

import pytest
import typer

from pilih_jobs.cli.app import app, hoist_global_options
from pilih_jobs.cli.output import Output, items_table, key_value_table
from pilih_jobs.errors import InputRequiredError, NotAuthenticatedError
from pilih_jobs.version import __version__
from tests.support.helpers import CliResult

ROOT = typer.main.get_command(app)


@pytest.mark.parametrize(
    ("argv", "expected", "path"),
    [
        (["sync", "--json"], ["--json", "sync"], "sync"),
        (
            ["config", "set", "api.url", "x", "--no-input"],
            ["--no-input", "config", "set", "api.url", "x"],
            "config set",
        ),
        (
            ["whoami", "--api-url", "http://127.0.0.1:1"],
            ["--api-url", "http://127.0.0.1:1", "whoami"],
            "whoami",
        ),
        (
            ["status", "-vv", "--config=/tmp/c.toml"],
            ["-vv", "--config=/tmp/c.toml", "status"],
            "status",
        ),
        (["--json", "status"], ["--json", "status"], "status"),
        (["config", "get", "--", "--json"], ["config", "get", "--", "--json"], "config get"),
        (
            ["devices", "rename", "dev_x", "new name", "-y"],
            ["-y", "devices", "rename", "dev_x", "new name"],
            "devices rename",
        ),
    ],
)
def test_T16_UNIT_global_flags_after_the_subcommand_are_hoisted(
    argv: list[str], expected: list[str], path: str
) -> None:
    assert hoist_global_options(argv, ROOT) == (expected, path)


def test_T16_UNIT_subcommand_options_with_global_names_stay_local() -> None:
    sub = typer.Typer()

    @sub.command("confirm")
    def confirm(yes: bool = typer.Option(False, "--yes")) -> None:
        """Local --yes."""

    @sub.command("launch")
    def launch(profile: str = typer.Option("x", "--profile")) -> None:
        """Local --profile."""

    root = typer.Typer()
    root.add_typer(sub, name="grp")
    command = typer.main.get_command(root)
    assert hoist_global_options(["grp", "confirm", "--yes", "--json"], command)[0] == [
        "--json",
        "grp",
        "confirm",
        "--yes",
    ]
    assert hoist_global_options(["grp", "launch", "--profile", "p1"], command)[0] == [
        "grp",
        "launch",
        "--profile",
        "p1",
    ]


def test_T16_UNIT_root_help_lists_every_global_flag(cli: Callable[..., CliResult]) -> None:
    result = cli("--help")
    assert result.code == 0
    for flag in (
        "--json",
        "--no-input",
        "--yes",
        "--verbose",
        "--profile",
        "--api-url",
        "--config",
        "--color",
    ):
        assert flag in result.stdout


def test_T16_UNIT_hidden_automation_alias_of_worker(cli: Callable[..., CliResult]) -> None:
    assert "automation" not in re.findall(r"│ (\w[\w-]*)\s", cli("--help").stdout)
    alias = cli("automation", "--help")
    assert alias.code == 0
    assert "status" in alias.stdout
    names = [info.name for info in app.registered_groups]
    assert names.count("worker") == 1
    assert "automation" in names


def test_T16_UNIT_usage_errors_exit_2_with_a_json_envelope(cli: Callable[..., CliResult]) -> None:
    result = cli("--json", "sync", "--no-such-flag")
    assert result.code == 2
    assert result.json["ok"] is False
    assert result.json["error"]["code"] == "usage_error"
    assert cli("config", "frobnicate").code == 2


def test_T16_UNIT_json_envelope_for_short_commands(cli: Callable[..., CliResult]) -> None:
    result = cli("--json", "version")
    assert result.code == 0
    envelope = result.json
    assert envelope["ok"] is True
    assert envelope["data"]["pilih_jobs"] == __version__
    assert "error" not in envelope


def test_T16_UNIT_output_envelopes_events_and_errors() -> None:
    stdout, stderr = io.StringIO(), io.StringIO()
    out = Output(json_mode=True, stdout=stdout, stderr=stderr)
    out.notice("pilih-jobs 9.9.9 is available")
    out.result({"x": 1})
    assert json.loads(stdout.getvalue()) == {
        "ok": True,
        "data": {"x": 1},
        "meta": {"notices": ["pilih-jobs 9.9.9 is available"]},
    }
    assert stderr.getvalue() == ""

    stdout = io.StringIO()
    stream = Output(json_mode=True, stdout=stdout, stderr=io.StringIO())
    stream.event("source_started", source="greenhouse:acme")
    stream.event("item", count=3)
    stream.error(InputRequiredError("approve first", details={"needed": {"approval_id": "apr_1"}}))
    lines = [json.loads(line) for line in stdout.getvalue().splitlines()]
    assert [line["type"] for line in lines] == ["source_started", "item", "result"]
    assert all(isinstance(line["ts"], int) for line in lines)
    assert lines[-1]["ok"] is False
    assert lines[-1]["error"]["code"] == "input_required"


def test_T16_UNIT_human_output_and_quiet_mode() -> None:
    stdout, stderr = io.StringIO(), io.StringIO()
    out = Output(stdout=stdout, stderr=stderr, color=False)
    out.result({"items": [{"id": "app_1", "stage": "ready"}], "next_cursor": None})
    assert "app_1" in stdout.getvalue()
    assert "ready" in stdout.getvalue()
    out.error(NotAuthenticatedError())
    assert "Error: Not signed in" in stderr.getvalue()
    assert "Hint: pilih-jobs login" in stderr.getvalue()
    quiet_out = io.StringIO()
    Output(quiet=True, stdout=quiet_out, stderr=io.StringIO()).result({"x": 1})
    assert quiet_out.getvalue() == ""


def test_T16_UNIT_output_never_prints_secrets() -> None:
    stdout = io.StringIO()
    token = "ZmFrZS10b2tlbi12YWx1ZS0xMjM0NTY3ODkwYWJjZGVmZ2hpams"
    Output(json_mode=True, stdout=stdout, stderr=io.StringIO()).result(
        {"refresh_token": token, "note": f"Bearer {token}"}
    )
    assert token not in stdout.getvalue()


def test_T16_UNIT_tables_render() -> None:
    assert key_value_table({"a": 1, "b": [1, 2], "c": None}).row_count == 3
    assert items_table([{"id": 1}, {"id": 2}], ["id"]).row_count == 2


def test_T16_UNIT_non_interactive_confirmation_needs_yes(
    cli: Callable[..., CliResult], home: Path
) -> None:
    result = cli("--json", "config", "purge")
    assert result.code == 8
    assert result.json["error"]["code"] == "input_required"
    assert cli("--json", "--yes", "config", "purge").code == 0


def test_T16_UNIT_unexpected_exceptions_write_a_crash_report(
    cli: Callable[..., CliResult], home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import pilih_jobs.cli.system as system

    def boom() -> dict[str, object]:
        raise RuntimeError("kaput at /Users/someone/secret/path with token Bearer abcdefghijklmnop")

    monkeypatch.setattr(system, "version_info", boom)
    result = cli("--json", "version")
    assert result.code == 1
    assert result.json["error"]["code"] == "internal_error"
    reports = list((home / "logs").glob("crash-*.json"))
    assert len(reports) == 1
    report = json.loads(reports[0].read_text())
    assert report["exception_type"] == "RuntimeError"
    assert "/Users/someone" not in report["message"]
    assert "abcdefghijklmnop" not in report["message"]
    assert all(not frame["file"].startswith("/") for frame in report["frames"])
