"""Per-attempt budgets: 60 executed actions, 25 AI calls, 15 minutes wall clock (19 §8.1).

Exceeding a budget pauses `resource_exhausted` in assisted/approval mode and stops
`budget_exceeded` in auto mode (PolicyEngine). Time is monotonic.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Final, Literal

MAX_ACTIONS: Final = 60
MAX_AI_CALLS: Final = 25
MAX_WALL_S: Final = 15 * 60

BudgetKind = Literal["actions", "ai_calls", "wall_clock"]


class BudgetExceededError(Exception):
    def __init__(self, kind: BudgetKind) -> None:
        super().__init__(f"attempt budget exceeded: {kind}")
        self.kind: BudgetKind = kind


@dataclass
class Budget:
    max_actions: int = MAX_ACTIONS
    max_ai_calls: int = MAX_AI_CALLS
    max_wall_s: float = MAX_WALL_S
    clock: Callable[[], float] = field(default=time.monotonic)
    actions: int = 0
    ai_calls: int = 0
    started: float = field(default=-1.0)

    def __post_init__(self) -> None:
        if self.started < 0:
            self.started = self.clock()

    @property
    def elapsed_s(self) -> float:
        return self.clock() - self.started

    def exceeded(self) -> BudgetKind | None:
        if self.actions >= self.max_actions:
            return "actions"
        if self.elapsed_s >= self.max_wall_s:
            return "wall_clock"
        return None

    def check(self) -> None:
        kind = self.exceeded()
        if kind is not None:
            raise BudgetExceededError(kind)

    def charge_action(self) -> None:
        self.check()
        self.actions += 1

    def charge_ai(self) -> None:
        if self.ai_calls >= self.max_ai_calls:
            raise BudgetExceededError("ai_calls")
        if self.elapsed_s >= self.max_wall_s:
            raise BudgetExceededError("wall_clock")
        self.ai_calls += 1
