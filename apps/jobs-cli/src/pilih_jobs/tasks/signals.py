"""SIGINT / SIGTERM semantics for long-running commands (16 §6).

- 1st Ctrl+C → `graceful`: before `submit_intent` the executor stops at the next step
  boundary (paused, resumable with `apply --resume`, or released when the user abandons /
  the worker shuts down); after `submit_intent` nothing stops: verification finishes and the
  result is queued.
- 2nd Ctrl+C → `abort`: asyncio tasks are cancelled at once; if an intent was acknowledged
  without a result, a local `outcome_unknown` result is written to the outbox first.
- SIGTERM (service stop) = 1st Ctrl+C with a 30 s hard deadline (then abort); on Windows
  `CTRL_BREAK_EVENT` (SIGBREAK) is mapped the same way.
"""

from __future__ import annotations

import asyncio
import contextlib
import signal
import sys
from collections.abc import Callable
from types import FrameType, TracebackType
from typing import Any

from pilih_jobs.tasks.constants import SIGTERM_DEADLINE_S
from pilih_jobs.tasks.runner import Interrupts


class SignalHandlers:
    """Installs the two-stage handlers on the running loop for the duration of a block."""

    def __init__(
        self,
        interrupts: Interrupts,
        *,
        shutdown_on_term: bool = False,
        on_signal: Callable[[str, int], None] | None = None,
    ) -> None:
        self.interrupts = interrupts
        self.shutdown_on_term = shutdown_on_term
        self.on_signal = on_signal
        self.count = 0
        self._loop: asyncio.AbstractEventLoop | None = None
        self._installed: list[int] = []
        self._previous: dict[int, Any] = {}

    # ------------------------------------------------------------------ handlers
    def handle_interrupt(self) -> None:
        self.count += 1
        if self.on_signal is not None:
            self.on_signal("SIGINT", self.count)
        if self.count == 1:
            self.interrupts.graceful.set()
        else:
            self.interrupts.abort.set()

    def handle_terminate(self) -> None:
        self.count += 1
        if self.on_signal is not None:
            self.on_signal("SIGTERM", self.count)
        if self.shutdown_on_term:
            self.interrupts.shutdown = True
        if self.count == 1:
            self.interrupts.deadline_s = SIGTERM_DEADLINE_S
            self.interrupts.graceful.set()
        else:
            self.interrupts.abort.set()

    # ------------------------------------------------------------------ install
    def install(self) -> SignalHandlers:
        loop = asyncio.get_running_loop()
        self._loop = loop
        terminate = [signal.SIGTERM]
        if sys.platform == "win32":  # pragma: no cover - Windows CI
            terminate.append(signal.SIGBREAK)  # type: ignore[attr-defined]
            pairs = [(signal.SIGINT, self.handle_interrupt)]
            pairs += [(s, self.handle_terminate) for s in terminate]
            for sig, handler in pairs:
                self._previous[sig] = signal.getsignal(sig)
                signal.signal(sig, self._threadsafe(handler))
                self._installed.append(sig)
            return self
        loop.add_signal_handler(signal.SIGINT, self.handle_interrupt)
        self._installed.append(signal.SIGINT)
        for sig in terminate:
            loop.add_signal_handler(sig, self.handle_terminate)
            self._installed.append(sig)
        return self

    def _threadsafe(self, handler: Callable[[], None]) -> Callable[[int, FrameType | None], None]:
        def relay(_signum: int, _frame: FrameType | None) -> None:
            if self._loop is not None:
                self._loop.call_soon_threadsafe(handler)

        return relay

    def uninstall(self) -> None:
        loop = self._loop
        for sig in self._installed:
            if sys.platform == "win32":  # pragma: no cover
                signal.signal(sig, self._previous.get(sig, signal.SIG_DFL))
            elif loop is not None:
                with contextlib.suppress(ValueError, RuntimeError):
                    loop.remove_signal_handler(sig)
        self._installed.clear()
        if sys.platform != "win32":
            with contextlib.suppress(ValueError):
                signal.signal(signal.SIGINT, signal.default_int_handler)

    def __enter__(self) -> SignalHandlers:
        return self.install()

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        self.uninstall()
