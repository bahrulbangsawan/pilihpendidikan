"""Per-invocation CLI state: global flags (16 §3.1), interactivity (16 §4), prompts.

Command modules read it with `state(ctx)`:

    @group.command("list")
    def list_cmd(ctx: typer.Context) -> None:
        st = state(ctx)
        rt = st.runtime()                     # paths, config, state.db, clock, credentials
        data = st.run(fetch(rt))              # run a coroutine on one event loop
        st.out.result(data, human=render)     # envelope / NDJSON / Rich

Rules: prompts only when `st.interactive`; a needed decision in a non-interactive session
raises `InputRequiredError` (exit 8) listing what was needed; `--yes` covers ordinary
confirmations but **never** a submission approval (`st.confirm(..., submission=True)`).
"""

from __future__ import annotations

import asyncio
import contextlib
import getpass
import os
import sys
from collections.abc import Coroutine
from dataclasses import dataclass, field
from typing import Any, TypeVar

import typer

from pilih_jobs.cli.output import Output
from pilih_jobs.errors import InputRequiredError, Interrupted
from pilih_jobs.logging import setup_logging
from pilih_jobs.runtime import Runtime

T = TypeVar("T")


@dataclass
class CliState:
    json: bool = False
    no_input: bool = False
    yes: bool = False
    verbose: int = 0
    quiet: bool = False
    profile: str | None = None
    api_url: str | None = None
    config_path: str | None = None
    color: bool | None = None
    token_stdin: bool = False
    command_path: str = ""
    help_requested: bool = False
    out: Output = field(default_factory=Output)
    _runtime: Runtime | None = None
    _token: str | None = None

    @property
    def interactive(self) -> bool:
        """TTY on stdin and stdout, and no --json / --no-input / CI (16 §4)."""
        if self.json or self.no_input or os.environ.get("CI"):
            return False
        try:
            return sys.stdin.isatty() and sys.stdout.isatty()
        except (AttributeError, ValueError):
            return False

    def _read_token_stdin(self) -> str | None:
        if not self.token_stdin:
            return None
        if self._token is None:
            self._token = sys.stdin.readline().strip() or None
        return self._token

    def prompt_passphrase(self) -> str | None:
        if not self.interactive:
            return None
        return getpass.getpass("Passphrase for the encrypted credential file: ") or None

    def runtime(self) -> Runtime:
        if self._runtime is None:
            rt = Runtime.create(
                api_url=self.api_url,
                config_file=self.config_path,
                flags={"browser.default_profile": self.profile} if self.profile else None,
                interactive=self.interactive,
                personal_token=self._read_token_stdin(),
                prompt_passphrase=self.prompt_passphrase,
                notice=self.out.notice,
            )
            setup_logging(
                rt.paths,
                level=rt.config.logging.level,
                verbose=self.verbose,
                quiet=self.quiet or self.json,
            )
            self._runtime = rt
        return self._runtime

    def close(self) -> None:
        if self._runtime is not None:
            self._runtime.close()
            self._runtime = None

    # ------------------------------------------------------------------ async
    def run(self, coro: Coroutine[Any, Any, T]) -> T:
        """Run a coroutine on a fresh event loop; Ctrl+C → exit 130 (16 §6)."""
        try:
            return asyncio.run(coro)
        except KeyboardInterrupt as exc:
            raise Interrupted("Interrupted; local state was saved.") from exc

    # ------------------------------------------------------------------ prompts
    def confirm(
        self,
        question: str,
        *,
        default: bool = False,
        submission: bool = False,
        needed: dict[str, Any] | None = None,
    ) -> bool:
        if self.yes and not submission:
            return True
        if not self.interactive:
            raise InputRequiredError(
                f"Confirmation required: {question}",
                details={"needed": needed or {"confirmation": question}},
                hint=None if submission else "pass --yes to confirm non-interactively",
            )
        return typer.confirm(question, default=default)

    def prompt(self, question: str, *, needed: str) -> str:
        if not self.interactive:
            raise InputRequiredError(f"Input required: {question}", details={"needed": needed})
        return str(typer.prompt(question))


def state(ctx: typer.Context) -> CliState:
    """The `CliState` of this invocation (created by the root callback)."""
    root = ctx.find_root()
    obj = root.obj
    if isinstance(obj, CliState):
        return obj
    created = CliState()
    root.obj = created
    return created


@contextlib.contextmanager
def closing_state(st: CliState) -> Any:
    try:
        yield st
    finally:
        st.close()
