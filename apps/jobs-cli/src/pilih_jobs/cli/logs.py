"""`logs` — show or tail the local JSONL logs (16 §10).

Sources: `<logs>/pilih-jobs.log` (+ rotated `.1`…`.5`, oldest first) and, with `--run
<att_…|run_…>`, that run's `steps.jsonl`. Filters: `--run` (matches `run_id`/`attempt_id`),
`--task <tsk_…>`, `--level` (minimum). `--json` passes the redacted JSON lines through
(NDJSON); the human view prints one line per record. `--follow` keeps reading until Ctrl+C.
Everything printed was already redacted when written; it is redacted again on output.
"""

from __future__ import annotations

import json
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Annotated, Any, Final, cast

import typer

from pilih_jobs.cli.context import CliState, state
from pilih_jobs.errors import NotFoundError, UsageError
from pilih_jobs.logging import redact_secrets
from pilih_jobs.paths import Paths

LEVELS: Final = {"debug": 10, "info": 20, "warning": 30, "warn": 30, "error": 40}
FOLLOW_POLL_S: Final = 0.5


def log_files(paths: Paths, run: str | None) -> list[Path]:
    if run is not None:
        steps = paths.runs_dir / run / "steps.jsonl"
        files = [steps] if steps.is_file() else []
    else:
        files = []
    base = paths.log_file
    rotated = [base.with_name(f"{base.name}.{n}") for n in range(5, 0, -1)]
    files += [p for p in rotated if p.is_file()]
    if base.is_file():
        files.append(base)
    return files


def _parse(line: str) -> dict[str, Any] | None:
    try:
        value = json.loads(line)
    except json.JSONDecodeError:
        return None
    return cast(dict[str, Any], value) if isinstance(value, dict) else None


def matches(record: dict[str, Any], *, run: str | None, task: str | None, level: int) -> bool:
    if LEVELS.get(str(record.get("level", "info")).lower(), 20) < level:
        return False
    if run is not None and run not in (record.get("run_id"), record.get("attempt_id")):
        return False
    return not (task is not None and record.get("task_id") != task)


def read_records(
    files: list[Path], *, run: str | None, task: str | None, level: int
) -> Iterator[dict[str, Any]]:
    for path in files:
        steps_file = path.name == "steps.jsonl"
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            for line in handle:
                record = _parse(line)
                if record is None:
                    continue
                if steps_file:
                    record.setdefault("level", "info")
                    record.setdefault("run_id", run)
                if matches(record, run=run, task=task, level=level):
                    yield record


def _print(st: CliState, record: dict[str, Any]) -> None:
    clean = cast(dict[str, Any], redact_secrets(record))
    if st.out.json_mode:
        st.out.stdout.write(json.dumps(clean, ensure_ascii=False, default=str) + "\n")
        st.out.stdout.flush()
        return
    if st.out.quiet:
        return
    ts = clean.get("ts")
    when = (
        time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(ts / 1000))
        if isinstance(ts, int | float)
        else str(ts or "")
    )
    ids_part = " ".join(
        f"{key}={clean[key]}" for key in ("task_id", "attempt_id", "run_id") if clean.get(key)
    )
    data = clean.get("data")
    tail = f" {json.dumps(data, ensure_ascii=False, default=str)}" if data else ""
    st.out.stdout.write(
        f"{when} {clean.get('level', '')!s:7} {clean.get('event', '')}: "
        f"{clean.get('msg', '')} {ids_part}{tail}".rstrip()
        + "\n"
    )
    st.out.stdout.flush()


def _follow(
    st: CliState,
    path: Path,
    *,
    run: str | None,
    task: str | None,
    level: int,
    max_polls: int | None = None,
) -> None:
    position = path.stat().st_size if path.exists() else 0
    polls = 0
    while max_polls is None or polls < max_polls:
        polls += 1
        if path.exists():
            size = path.stat().st_size
            if size < position:  # rotated
                position = 0
            if size > position:
                with path.open("r", encoding="utf-8", errors="replace") as handle:
                    handle.seek(position)
                    for line in handle:
                        record = _parse(line)
                        if record is not None and matches(record, run=run, task=task, level=level):
                            _print(st, record)
                    position = handle.tell()
        time.sleep(FOLLOW_POLL_S)


def logs_cmd(
    ctx: typer.Context,
    follow: Annotated[
        bool, typer.Option("--follow", "-f", help="Keep printing new lines.")
    ] = False,
    run: Annotated[
        str | None, typer.Option("--run", help="Only this run / attempt (run_… or att_…).")
    ] = None,
    task: Annotated[str | None, typer.Option("--task", help="Only this task (tsk_…).")] = None,
    level: Annotated[
        str, typer.Option("--level", help="Minimum level: debug|info|warning|error.")
    ] = "debug",
    lines: Annotated[
        int, typer.Option("--lines", "-n", min=1, max=100_000, help="Last N records.")
    ] = 200,
) -> None:
    """Show or tail local logs (NDJSON passthrough with --json)."""
    st = state(ctx)
    minimum = LEVELS.get(level.lower())
    if minimum is None:
        raise UsageError("--level must be debug, info, warning or error.")
    rt = st.runtime()
    files = log_files(rt.paths, run)
    records = list(read_records(files, run=run, task=task, level=minimum))[-lines:]
    if run is not None and not records and not (rt.paths.runs_dir / run / "steps.jsonl").is_file():
        raise NotFoundError(f"No logs for {run}.")
    for record in records:
        _print(st, record)
    st.out.emitted_result = True
    if follow:
        try:
            _follow(st, rt.paths.log_file, run=run, task=task, level=minimum)
        except KeyboardInterrupt:
            return


def register(app: typer.Typer) -> None:
    app.command("logs")(logs_cmd)
