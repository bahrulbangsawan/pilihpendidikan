"""TCLI-APPLY-TERMINAL: the `AttemptOptions` hooks an interactive `apply` hands the agent
(18 §7.4 domain prompt, 18 §8 / 21 §6.2 pause prompt, 21 §6.3 `--approve` in the CLI).

Prompts are read on one daemon thread so the event loop keeps the lease alive; a prompt
answered elsewhere leaves its pending read for the next prompt.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import Iterator
from typing import IO, Any, cast

import pytest

from pilih_jobs.agent.options import PausePrompt
from pilih_jobs.api.client import ApiClient
from pilih_jobs.cli.apply import CliApprover, TerminalInput, terminal_hooks
from pilih_jobs.cli.context import CliState
from pilih_jobs.errors import ConflictError


@pytest.fixture
def stdin_pipe(monkeypatch: pytest.MonkeyPatch) -> Iterator[IO[str]]:
    """Replace stdin by a pipe; the test writes the user's lines into the returned end."""
    read_fd, write_fd = os.pipe()
    reader = os.fdopen(read_fd, "r")
    writer = os.fdopen(write_fd, "w", buffering=1)
    monkeypatch.setattr("sys.stdin", reader)
    yield writer
    writer.close()  # EOF releases a reader thread still blocked on the pipe
    reader.close()


class StubApprover:
    def __init__(self) -> None:
        self.handled: list[str] = []
        self.fail: Exception | None = None

    async def handle(self, _api: ApiClient, approval_id: str) -> str | None:
        self.handled.append(approval_id)
        if self.fail is not None:
            raise self.fail
        return "approved"


def _prompt(headed: bool = True) -> PausePrompt:
    return PausePrompt(
        reason="login_required",
        message="Sign in to continue",
        company="Acme",
        domain="jobs.acme-ats.test",
        headed=headed,
    )


async def _answer(writer: IO[str], line: str) -> None:
    await asyncio.sleep(0.05)
    writer.write(line + "\n")


async def test_TCLI_APPLY_TERMINAL_pause_domain_and_approval_hooks(
    stdin_pipe: IO[str], capsys: pytest.CaptureFixture[str]
) -> None:
    st = CliState()
    approver = StubApprover()
    hooks = terminal_hooks(st, cast(CliApprover, approver), cast(ApiClient, None), TerminalInput())
    assert hooks.prompt_pause is not None
    assert hooks.allow_domain is not None
    assert hooks.decide_in_cli is not None
    answers: list[Any] = []
    for line in ("", "skip", "stop"):
        feeder = asyncio.create_task(_answer(stdin_pipe, line))
        answers.append(await asyncio.wait_for(hooks.prompt_pause(_prompt()), 5))
        await feeder
    assert answers == ["resume", "skip", "stop"]
    err = capsys.readouterr().err
    assert "Paused on jobs.acme-ats.test (login_required): Sign in to continue" in err
    assert "Complete it in the browser window" in err
    for line, expected in (("y", True), ("", False), ("no", False)):
        feeder = asyncio.create_task(_answer(stdin_pipe, line))
        assert await asyncio.wait_for(hooks.allow_domain("evil-redirect.test"), 5) is expected
        await feeder
    assert "Allow evil-redirect.test for this application? [y/N]" in capsys.readouterr().err
    await hooks.decide_in_cli({"id": "apr_01JA6V8M3W8Z1T6Q4Y2B7K9C00", "kind": "submit"})
    assert approver.handled == ["apr_01JA6V8M3W8Z1T6Q4Y2B7K9C00"]
    # Decided on the web meanwhile: the hook reports it and never raises into the agent.
    approver.fail = ConflictError("The approval is already approved.", code="invalid_transition")
    await hooks.decide_in_cli({"id": "apr_01JA6V8M3W8Z1T6Q4Y2B7K9C01", "kind": "submit"})
    assert "was not decided here: The approval is already approved." in capsys.readouterr().err


async def test_TCLI_APPLY_TERMINAL_a_prompt_answered_elsewhere_keeps_one_reader(
    stdin_pipe: IO[str],
) -> None:
    terminal = TerminalInput()
    first = asyncio.create_task(terminal.readline())
    await asyncio.sleep(0.05)
    pending = terminal._pending  # the one read in flight (a daemon thread on stdin)
    assert pending is not None
    first.cancel()  # resumed on the web: the prompt goes away, its read stays pending
    with pytest.raises(asyncio.CancelledError):
        await first
    assert not pending.done()
    second = asyncio.create_task(terminal.readline())
    await asyncio.sleep(0.05)
    assert terminal._pending is pending  # reused: no second reader on stdin
    stdin_pipe.write("answer\n")
    assert await asyncio.wait_for(second, 5) == "answer"
    # A line typed while no prompt waited is not taken as the next answer.
    stale = asyncio.create_task(terminal.readline())
    await asyncio.sleep(0.05)
    stale.cancel()
    with pytest.raises(asyncio.CancelledError):
        await stale
    stdin_pipe.write("typed too early\n")
    await _until_done(terminal._pending)
    fresh = asyncio.create_task(terminal.readline())
    await asyncio.sleep(0.05)
    stdin_pipe.write("y\n")
    assert await asyncio.wait_for(fresh, 5) == "y"


async def _until_done(future: asyncio.Future[str] | None) -> None:
    assert future is not None
    for _ in range(500):
        if future.done():
            return
        await asyncio.sleep(0.01)
    raise AssertionError("the stdin reader never delivered the line")
