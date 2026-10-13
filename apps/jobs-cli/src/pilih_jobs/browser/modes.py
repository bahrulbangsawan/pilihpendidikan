"""Headless vs headed policy and the headless→headed switch rules (18 §5).

| Task kind / mode   | Default                                            |
|--------------------|----------------------------------------------------|
| discover (dynamic) | headless (`--headed` for debugging)                |
| render_cv          | headless, ephemeral                                |
| apply + assisted   | **headed** (the user watches and submits)          |
| apply + approval   | headed; headless when the runner chose it          |
|                    | (`--headless` / `apply.headless_approval`)         |
| apply + auto       | headless only if the adapter has `headless_ok`     |
| human needed       | must be headed → the switch below                  |

The switch (a page cannot move between headless and headed browsers): re-enter the same
profile headed at the checkpoint URL and replay the field plan when the form is still on
its first page (not bound to server-side wizard state), otherwise end `paused` with
`needs_headed_restart` — and **never** after `submit_intent` (D-19).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

TaskKind = Literal["apply", "discover", "render_cv"]
ApplyMode = Literal["assisted", "approval", "auto"]


@dataclass(frozen=True)
class HeadlessDecision:
    headless: bool
    reason: str


def decide_headless(
    *,
    task_kind: TaskKind,
    mode: ApplyMode | None = None,
    requested_headed: bool = False,
    adapter_headless_ok: bool = False,
) -> HeadlessDecision:
    """The 18 §5 table."""
    if task_kind == "render_cv":
        return HeadlessDecision(headless=True, reason="render_cv is always headless")
    if task_kind == "discover":
        return HeadlessDecision(
            headless=not requested_headed,
            reason="discovery runs headless unless --headed",
        )
    if mode == "assisted":
        return HeadlessDecision(headless=False, reason="assisted mode is always headed")
    if mode == "approval":
        return HeadlessDecision(
            headless=not requested_headed,
            reason="approval mode is headed unless the runner chose headless",
        )
    if mode == "auto":
        if adapter_headless_ok and not requested_headed:
            return HeadlessDecision(headless=True, reason="adapter allows headless auto")
        return HeadlessDecision(headless=False, reason="adapter has no headless_ok")
    return HeadlessDecision(headless=False, reason="unknown mode: headed")


SwitchAction = Literal["relaunch_headed", "pause_needs_headed_restart", "hold_pause", "never"]


@dataclass(frozen=True)
class SwitchDecision:
    action: SwitchAction
    reason: str


def headed_switch(
    *,
    headless: bool,
    submit_intent_recorded: bool,
    display_available: bool,
    human_reachable: bool,
    form_steps_advanced: int,
    url_allowlisted: bool,
) -> SwitchDecision:
    """What to do when a human is needed while the browser runs headless (18 §5)."""
    if not headless:
        return SwitchDecision("never", "already headed")
    if submit_intent_recorded:
        return SwitchDecision("never", "never after submit_intent (D-19)")
    if not display_available or not human_reachable:
        return SwitchDecision("hold_pause", "no display or nobody at this terminal")
    if form_steps_advanced == 0 and url_allowlisted:
        return SwitchDecision("relaunch_headed", "first form page: re-enter and replay the plan")
    return SwitchDecision(
        "pause_needs_headed_restart", "multi-step state lives on the server: restart headed"
    )
