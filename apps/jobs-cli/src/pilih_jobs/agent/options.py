"""Per-attempt knobs of the agent that are not part of the claim (PLAN C6 extension).

`AttemptContext.options` is optional: `None` means "defaults from the local config"
(`browser.*`, `privacy.keep_evidence_screenshots`). The CLI layer (leaf 4.4 `apply` /
`worker`) passes hooks for the terminal: the pause prompt of 18 §8 and the inline
approval prompt of 21 §6.3. Tests shrink the timeouts and point Chromium at the fixture
ATS server with `host_resolver_rules`.

Nothing here can widen what the agent may do: there is no option to skip the submit gate,
type unvalidated values, allow more domains or disable the challenge detector.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

#: What the pause prompt answered (18 §8): continue, skip the open questions, or stop.
PauseAnswer = Literal["resume", "skip", "stop"]


@dataclass(frozen=True)
class PausePrompt:
    """What the terminal shows during a pause (18 §8 step 2)."""

    reason: str
    message: str
    company: str
    domain: str
    headed: bool


@dataclass
class AttemptOptions:
    # ------------------------------------------------------------------ browser (18 §3)
    #: `managed` | `connected` | `persistent`; None = `browser.mode` from the config.
    browser_mode: Literal["managed", "connected", "persistent"] | None = None
    #: Profile name; None = task payload `browser_profile` → configured default (18 §3.3).
    profile: str | None = None
    #: `chromium` | `chrome` | `msedge`; None = `browser.channel`.
    channel: str | None = None
    #: Mode B endpoint (loopback only); None = `browser.cdp_endpoint`.
    cdp_endpoint: str | None = None
    #: Data directory root (profiles, runs); None = the platformdirs / PILIH_JOBS_HOME layout.
    data_dir: Path | None = None

    # ------------------------------------------------------------------ terminal hooks
    #: Shows the pause panel and waits for Enter / `skip` / `stop` (18 §8). Runs while the
    #: agent also watches `resume_requested`, `cancel_requested` and `lost`.
    prompt_pause: Callable[[PausePrompt], Awaitable[PauseAnswer]] | None = None
    #: Called with a freshly created approval record when the user may decide it in this
    #: terminal (`apply --approve`, 21 §6.3). It shows the summary and posts the decision;
    #: the agent only polls the approval state and never decides by itself.
    decide_in_cli: Callable[[dict[str, Any]], Awaitable[None]] | None = None
    #: Progress callback for NDJSON / Rich output (16 §5): `(event, fields)`.
    on_event: Callable[[str, dict[str, Any]], None] | None = None
    #: Asked once for an off-allowlist domain in assisted/approval mode (18 §7.4):
    #: "Allow <domain> for this application?" → True adds it for this task only.
    allow_domain: Callable[[str], Awaitable[bool]] | None = None

    # ------------------------------------------------------------------ limits
    pause_timeout_s: float = 30 * 60  # 18 §8.4 (configurable up to 4 h)
    headless_pause_timeout_s: float = 10 * 60  # 21 §6.2: no human present
    approval_poll_s: float = 5.0  # 21 §6.3
    approval_timeout_s: float = 24 * 3600  # 03 §8
    submit_intent_retries: int = 3  # 19 §8.2 step 4
    submit_intent_backoff_s: float = 2.0
    evidence_timeout_s: float = 60.0  # 18 §10
    network_offline_poll_s: float = 10.0  # 18 §9
    network_offline_max_s: float = 5 * 60
    navigation_retry_delay_s: float = 5.0  # 18 §9
    click_effect_timeout_s: float = 10.0  # 18 §6.3 / §7.2
    idle_timeout_s: float = 60.0  # 18 §6.3 per-page idle
    keep_artifacts: bool = False  # 18 §7.1 `--keep-artifacts`
    #: None = `privacy.keep_evidence_screenshots` and the claim's `evidence_screenshots`.
    evidence_screenshots: bool | None = None
    allow_cookie_accept: bool = False  # 18 §7.7 `rule.allow_cookie_accept`

    # ------------------------------------------------------------------ test harness only
    #: Chromium `--host-resolver-rules` for the fixture ATS server (13 §4.1). The only
    #: extra launch argument the controller accepts; never a stealth flag (D-16).
    host_resolver_rules: str | None = None
    #: Run headless even where 18 §5 asks for a headed window (CI / fixture tests only;
    #: the CLI commands never set it).
    force_headless: bool = False
