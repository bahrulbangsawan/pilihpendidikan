"""The AI application agent (19). Interface fixed by PLAN C6; implemented by leaf 4.3.

`run_attempt(ctx)` drives one application attempt in the browser under a lease and
returns its `AttemptResult`. It imports Playwright only through `browser` (16 §2.1); the
loop itself lives in `agent.loop`.
"""

from __future__ import annotations

from pilih_jobs.agent.options import AttemptOptions, PauseAnswer, PausePrompt
from pilih_jobs.agent.types import AttemptContext, AttemptResult, LeaseChannel

__all__ = [
    "AttemptContext",
    "AttemptOptions",
    "AttemptResult",
    "LeaseChannel",
    "PauseAnswer",
    "PausePrompt",
    "run_attempt",
]


async def run_attempt(ctx: AttemptContext) -> AttemptResult:
    """Run one apply attempt (19 §2): never raises for attempt-level failures."""
    from pilih_jobs.agent.loop import AgentLoop

    return await AgentLoop(ctx).run()
