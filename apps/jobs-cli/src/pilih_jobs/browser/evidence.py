"""EvidenceRecorder: submission confirmation capture (18 §10).

After the submit click it collects for up to 60 s, stopping early once a deterministic
signal fires:

1. URL — the final URL matches one of the adapter's `confirmation_url_patterns`;
2. DOM markers — the adapter's `confirmation_selectors`, or the generic confirmation
   lexicon in 13 languages, while the submitted form's fields have disappeared;
3. negative markers — the form is still there with `errors[]`, or the submit button is
   enabled again next to error text;
4. network — a 2xx answer to a POST/XHR on an allowlisted host (status + path only;
   bodies are never stored);
5. screenshot — `jpeg`, quality 70, viewport only, every input/textarea/select masked;
6. text excerpt — ≤ 2 KB of the main landmark with emails, phones and the applicant's own
   values replaced by `[redacted]`.

These feed the verification algorithm (19 §9.1) in `agent.verify`.
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import re
import time
from dataclasses import dataclass, field
from typing import Any, Final

from playwright.async_api import Error as PlaywrightError
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from pilih_jobs.browser.errors import BrowserError
from pilih_jobs.browser.lexicon import is_confirmation_text
from pilih_jobs.browser.observer import Observation, PageObserver
from pilih_jobs.browser.session import PageSession
from pilih_jobs.policy.untrusted import clip, redact_excerpt

SCREENSHOT_MAX_BYTES: Final = 1_500_000  # 18 §11: ≤ 1.5 MB to the AI
EXCERPT_LIMIT: Final = 2_048
_MASK_SELECTOR: Final = "input, textarea, select, [contenteditable=''], [contenteditable=true]"


def compile_patterns(patterns: list[str]) -> list[re.Pattern[str]]:
    out: list[re.Pattern[str]] = []
    for source in patterns:
        with contextlib.suppress(re.error):
            out.append(re.compile(source))
    return out


@dataclass
class EvidenceCapture:
    url_match: bool = False
    dom_marker: bool = False
    negative_marker: bool = False
    xhr_2xx: bool = False
    form_gone: bool = False
    http_status: int | None = None
    final_url: str = ""
    page_title: str = ""
    text_excerpt: str = ""
    screenshot: bytes | None = None
    errors: list[dict[str, Any]] = field(default_factory=lambda: [])
    last_observation: Observation | None = None
    page_lost: bool = False

    @property
    def deterministic_positive(self) -> bool:
        return self.url_match or (self.dom_marker and self.form_gone)

    def signals(self) -> dict[str, Any]:
        """`EvidenceSignals` (contract) — booleans and the status only."""
        return {
            "url_match": self.url_match,
            "dom_marker": self.dom_marker,
            "negative_marker": self.negative_marker,
            "xhr_2xx": self.xhr_2xx,
            "form_gone": self.form_gone,
            "http_status": self.http_status,
            "method": "browser",
        }

    def screenshot_b64(self) -> str | None:
        if self.screenshot is None or len(self.screenshot) > SCREENSHOT_MAX_BYTES:
            return None
        return base64.b64encode(self.screenshot).decode("ascii")


class EvidenceRecorder:
    def __init__(
        self,
        session: PageSession,
        observer: PageObserver,
        *,
        confirmation_url_patterns: list[str],
        own_values: list[str],
        submitted_signatures: set[str],
        submit_signature: str | None,
        timeout_s: float = 60.0,
        poll_s: float = 0.5,
        negative_settle_s: float = 2.0,
    ) -> None:
        self.session = session
        self.observer = observer
        self.patterns = compile_patterns(confirmation_url_patterns)
        self.own_values = own_values
        self.submitted_signatures = submitted_signatures
        self.submit_signature = submit_signature
        self.timeout_s = timeout_s
        self.poll_s = poll_s
        self.negative_settle_s = negative_settle_s

    def url_matches(self, url: str) -> bool:
        return any(pattern.search(url) for pattern in self.patterns)

    def _evaluate(self, capture: EvidenceCapture, obs: Observation, since: float) -> None:
        capture.last_observation = obs
        capture.final_url = obs.url
        capture.page_title = clip(obs.title, 200)
        capture.http_status = obs.http_status
        capture.url_match = capture.url_match or self.url_matches(obs.url)
        present = {f.signature for f in obs.fields} & self.submitted_signatures
        capture.form_gone = not present
        marker = any(obs.confirm_hits.values()) or is_confirmation_text(obs.raw_text)
        capture.dom_marker = marker
        submit_again = any(
            c.role_hint == "submit" and c.enabled and c.signature == self.submit_signature
            for c in obs.controls
        )
        capture.negative_marker = (bool(present) and bool(obs.errors)) or (
            submit_again and bool(obs.errors)
        )
        capture.errors = list(obs.errors)
        capture.xhr_2xx = capture.xhr_2xx or any(
            200 <= record.status < 300 and self.session.allowlist.allows_host(record.host)
            for record in self.session.post_responses_since(since)
        )
        capture.text_excerpt = redact_excerpt(obs.raw_text, self.own_values, limit=EXCERPT_LIMIT)

    async def collect(self, *, since: float, step: int) -> EvidenceCapture:
        capture = EvidenceCapture()
        deadline = time.monotonic() + self.timeout_s
        negative_since: float | None = None
        while True:
            try:
                obs = await self.observer.observe(step=step, with_snapshot=False)
            except BrowserError:
                capture.page_lost = True
                break
            self._evaluate(capture, obs, since)
            if capture.deterministic_positive:
                break
            if capture.negative_marker:
                negative_since = negative_since or time.monotonic()
                if time.monotonic() - negative_since >= self.negative_settle_s:
                    break
            else:
                negative_since = None
            if time.monotonic() >= deadline:
                break
            await asyncio.sleep(self.poll_s)
        if not capture.page_lost:
            capture.screenshot = await self.screenshot()
        return capture

    async def screenshot(self) -> bytes | None:
        """Viewport JPEG with every input masked (18 §10.5)."""
        return await masked_screenshot(self.session)


async def masked_screenshot(session: PageSession) -> bytes | None:
    """`jpeg` q70 of the viewport, inputs/textareas/selects masked; ≤ 1.5 MB or None."""
    page = session.page
    for quality in (70, 40):
        with contextlib.suppress(PlaywrightError, PlaywrightTimeoutError):
            data = await page.screenshot(
                full_page=False,
                type="jpeg",
                quality=quality,
                mask=[page.locator(_MASK_SELECTOR)],
                timeout=10_000,
            )
            if len(data) <= SCREENSHOT_MAX_BYTES:
                return data
    return None


def to_b64(data: bytes | None) -> str | None:
    if data is None or len(data) > SCREENSHOT_MAX_BYTES:
        return None
    return base64.b64encode(data).decode("ascii")
