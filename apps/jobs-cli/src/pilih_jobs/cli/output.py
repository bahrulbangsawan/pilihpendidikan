"""Output modes and the JSON contract (16 §3.3, §5).

| Mode  | When           | Format                                                              |
|-------|----------------|---------------------------------------------------------------------|
| Human | TTY, no --json | Rich tables/panels on stdout; notices and errors on stderr          |
| JSON  | `--json`       | Short commands: one envelope `{"ok", "data", "error"?, "meta"?}`.   |
|       |                | Long commands: NDJSON events `{"type", "ts", …}` then one           |
|       |                | `{"type": "result", "ok", "data", "error"?}` line                   |
| Quiet | `-q`           | Only errors (stderr); the exit code is the contract                 |

Colours follow `--color/--no-color`, then `NO_COLOR`. Every string printed goes through
the secret redaction of the logs, so a token can never reach the terminal or a pipe.
"""

from __future__ import annotations

import json
import os
import sys
import time
from collections.abc import Callable, Mapping, Sequence
from typing import Any, TextIO, cast

from rich.console import Console
from rich.table import Table

from pilih_jobs.errors import PilihError
from pilih_jobs.logging import redact_secrets

HumanRenderer = Callable[[Console, Any], None]


def _dumps(value: Any) -> str:
    return json.dumps(redact_secrets(value), ensure_ascii=False, separators=(",", ":"), default=str)


class Output:
    def __init__(
        self,
        *,
        json_mode: bool = False,
        quiet: bool = False,
        color: bool | None = None,
        stdout: TextIO | None = None,
        stderr: TextIO | None = None,
    ) -> None:
        self.json_mode = json_mode
        self.quiet = quiet
        self.streaming = False
        self.notices: list[str] = []
        self.meta: dict[str, Any] = {}
        self._stdout = stdout
        self._stderr = stderr
        if color is None:
            no_color = bool(os.environ.get("NO_COLOR")) or os.environ.get("TERM") == "dumb"
            color = None if not no_color else False
        self._color = color
        self.emitted_result = False

    @property
    def stdout(self) -> TextIO:
        return self._stdout or sys.stdout

    @property
    def stderr(self) -> TextIO:
        return self._stderr or sys.stderr

    def console(self, *, err: bool = False) -> Console:
        return Console(
            file=self.stderr if err else self.stdout,
            no_color=self._color is False,
            force_terminal=True if self._color is True else None,
            highlight=False,
            soft_wrap=True,
        )

    # ------------------------------------------------------------------ text
    def _write(self, text: str, *, err: bool = False) -> None:
        stream = self.stderr if err else self.stdout
        stream.write(text if text.endswith("\n") else text + "\n")
        stream.flush()

    def info(self, message: str) -> None:
        """Human progress text (stderr); silent in JSON and quiet modes."""
        if not self.json_mode and not self.quiet:
            self.console(err=True).print(redact_secrets(message), markup=False)

    def notice(self, message: str) -> None:
        """One-line notices (e.g. a newer version); JSON mode reports them in `meta`."""
        cleaned = cast(str, redact_secrets(message))
        if cleaned in self.notices:
            return
        self.notices.append(cleaned)
        if not self.json_mode and not self.quiet:
            self.console(err=True).print(f"note: {cleaned}", markup=False, style="yellow")

    # ------------------------------------------------------------------ results
    def _meta(self) -> dict[str, Any] | None:
        meta = dict(self.meta)
        if self.notices:
            meta["notices"] = list(self.notices)
        return meta or None

    def result(self, data: Any, *, human: HumanRenderer | None = None) -> None:
        """The final successful output of a command."""
        self.emitted_result = True
        if self.json_mode:
            if self.streaming:
                payload: dict[str, Any] = {"type": "result", "ts": _now(), "ok": True, "data": data}
            else:
                payload = {"ok": True, "data": data}
            meta = self._meta()
            if meta:
                payload["meta"] = meta
            self._write(_dumps(payload))
            return
        if self.quiet:
            return
        console = self.console()
        if human is not None:
            human(console, redact_secrets(data))
        else:
            render_value(console, redact_secrets(data))

    def event(self, kind: str, **fields: Any) -> None:
        """A progress event (16 §5): NDJSON in JSON mode, a dim line on stderr otherwise."""
        if self.json_mode:
            self.streaming = True
            self._write(_dumps({"type": kind, "ts": _now(), **fields}))
            return
        if self.quiet:
            return
        message = fields.get("message") or fields.get("msg") or ""
        summary = " ".join(f"{k}={v}" for k, v in fields.items() if k not in ("message", "msg"))
        self.console(err=True).print(
            f"[{kind}] {message} {summary}".strip(), markup=False, style="dim"
        )

    def error(self, error: PilihError) -> None:
        self.emitted_result = True
        if self.json_mode:
            body = error.envelope_error()
            if self.streaming:
                payload: dict[str, Any] = {
                    "type": "result",
                    "ts": _now(),
                    "ok": False,
                    "error": body,
                }
            else:
                payload = {"ok": False, "error": body}
            meta = self._meta()
            if meta:
                payload["meta"] = meta
            self._write(_dumps(payload))
            return
        console = self.console(err=True)
        console.print(f"Error: {redact_secrets(error.message)}", markup=False, style="bold red")
        if error.hint:
            console.print(f"Hint: {redact_secrets(error.hint)}", markup=False)


def _now() -> int:
    return time.time_ns() // 1_000_000


# ------------------------------------------------------------------ rendering
def _scalar(value: Any) -> str:
    if value is None:
        return "-"
    if isinstance(value, bool):
        return "yes" if value else "no"
    if isinstance(value, list | tuple):
        items = cast(Sequence[Any], value)
        if all(not isinstance(v, dict | list) for v in items):
            return ", ".join(_scalar(v) for v in items) or "-"
        return json.dumps(value, ensure_ascii=False, default=str)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False, default=str)
    return str(value)


def key_value_table(rows: Mapping[str, Any], *, title: str | None = None) -> Table:
    table = Table(show_header=False, box=None, title=title, title_justify="left", pad_edge=False)
    table.add_column(style="bold")
    table.add_column()
    for key, value in rows.items():
        table.add_row(key, _scalar(value))
    return table


def items_table(items: Sequence[Mapping[str, Any]], columns: Sequence[str] | None = None) -> Table:
    cols = list(columns or (items[0].keys() if items else []))
    table = Table(*cols, box=None, pad_edge=False, header_style="bold")
    for item in items:
        table.add_row(*(_scalar(item.get(c)) for c in cols))
    return table


def render_value(console: Console, data: Any) -> None:
    if data is None:
        return
    if isinstance(data, dict):
        mapping = cast(dict[str, Any], data)
        items = mapping.get("items")
        if isinstance(items, list) and all(isinstance(i, dict) for i in cast(list[Any], items)):
            rows = cast(list[dict[str, Any]], items)
            console.print(items_table(rows) if rows else "(none)")
            rest = {k: v for k, v in mapping.items() if k != "items"}
            if rest:
                console.print(key_value_table(rest))
            return
        console.print(key_value_table(mapping))
        return
    if isinstance(data, list) and all(isinstance(i, dict) for i in cast(list[Any], data)):
        console.print(items_table(cast(list[dict[str, Any]], data)))
        return
    console.print(_scalar(data), markup=False)
