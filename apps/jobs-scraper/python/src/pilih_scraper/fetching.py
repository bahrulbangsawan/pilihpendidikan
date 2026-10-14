"""The scraper's only door to the network: `pilih_jobs.discovery.engine` (D-38).

Every request goes through `ScraplingJobEngine` — honest UA, robots.txt gate,
politeness scheduler, wrapper-owned retries, response classification (challenge
detection) and the forbidden-feature policy — with the SSRF `NetGuard` plugged in.
Scrapling itself is never imported here; the engine's page objects are read through
their public `HtmlPage` methods, plus the raw body / script text helpers below.
"""

from __future__ import annotations

import random
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final, cast

from pilih_jobs.discovery.clock import EngineClock
from pilih_jobs.discovery.engine import ScraplingJobEngine
from pilih_jobs.discovery.engine.page import ScraplingPage, clean_text
from pilih_jobs.discovery.retry import RetryPolicy
from pilih_jobs.discovery.types import (
    ExtractionOutcome,
    ExtractionSpec,
    FetchMode,
    FetchPurpose,
    FetchRequest,
    FetchResult,
    FieldSpec,
    SourceRef,
)

from pilih_scraper.netguard import NetGuard

REQUEST_TIMEOUT_S: Final = 20.0
#: Short in-request backoff; longer waits are the queue's job (24 §6).
CLOUD_RETRY: Final = RetryPolicy(base_s=2.0, cap_s=20.0, max_attempts=3, retry_after_cap_s=120.0)
#: A denial is never retried and stops the source (D-16, D-37).
STOP_ON: Final = frozenset({"access_denied", "challenge_detected"})
_ATTR_PSEUDO: Final = re.compile(r"::attr\(\s*([A-Za-z_:][-A-Za-z0-9_:.]*)\s*\)\s*$")
_TEXT_PSEUDO: Final = re.compile(r"::text\s*$")


@dataclass
class EngineFactory:
    """Builds one engine per request (sessions and robots cache closed afterwards)."""

    data_dir: Path
    guard: NetGuard
    clock: EngineClock | None = None
    rng: random.Random | None = None
    headless: bool = True
    built: list[ScraplingJobEngine] = field(default_factory=lambda: [])

    def make(self, *, allow_browser: bool) -> ScraplingJobEngine:
        engine = ScraplingJobEngine(
            data_dir=self.data_dir,
            cache_dir=self.data_dir / "cache",
            clock=self.clock,
            rng=self.rng,
            allow_browser=allow_browser,
            retry=CLOUD_RETRY,
            headless=self.headless,
            network_guard=self.guard,
        )
        self.built.append(engine)
        return engine


def source_ref(
    *, key: str, org: str, min_delay_ms: int, allow_browser: bool, source_id: str | None
) -> SourceRef:
    return SourceRef(
        key=key,
        adapter_id="generic_listing",
        org=org,
        source_id=source_id,
        stop_on=STOP_ON,
        per_domain_concurrency=1,
        min_delay_ms=max(1000, min_delay_ms),
        allow_browser=allow_browser,
    )


def request(
    url: str,
    mode: FetchMode,
    *,
    purpose: FetchPurpose = "listing",
    wait_selector: str | None = None,
    etag: str | None = None,
    last_modified: str | None = None,
) -> FetchRequest:
    return FetchRequest(
        url,
        mode,
        purpose=purpose,
        timeout_s=REQUEST_TIMEOUT_S,
        wait_selector=wait_selector,
        etag=etag,
        last_modified=last_modified,
        headers={"Accept": _ACCEPT[mode]},
    )


_ACCEPT: Final = {
    FetchMode.JSON_API: "application/json",
    FetchMode.STATIC_HTML: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    FetchMode.BROWSER: "text/html,application/xhtml+xml,*/*;q=0.8",
}


# ---------------------------------------------------------------- page reading
def as_page(result: FetchResult) -> ScraplingPage | None:
    page = result.page
    return page if isinstance(page, ScraplingPage) else None


def raw_text(result: FetchResult) -> str:
    """The response body as text (feeds and other non-HTML bodies)."""
    page = as_page(result)
    if page is None:
        return ""
    native: Any = page.native
    body: Any = getattr(native, "body", None) if native is not None else None
    if isinstance(body, bytes):
        encoding = str(getattr(native, "encoding", None) or "utf-8")
        try:
            return body.decode(encoding, errors="replace")
        except LookupError:
            return body.decode("utf-8", errors="replace")
    html: Any = getattr(page.selector, "html_content", None)
    return str(html or "")


def _nodes(page: ScraplingPage, css: str) -> list[Any]:
    try:
        return list(page.selector.css(css))
    except Exception:  # noqa: BLE001 - an invalid configured selector is a miss
        return []


def script_texts(page: ScraplingPage, css: str) -> list[str]:
    """Raw text of matching `<script>` elements (embedded JSON)."""
    out: list[str] = []
    for node in _nodes(page, css):
        text: Any = getattr(node, "text", None)
        if text:
            out.append(str(text))
    return out


def attr_values(page: ScraplingPage, css: str, attr: str) -> list[str]:
    out: list[str] = []
    for node in _nodes(page, css):
        attrib: Any = getattr(node, "attrib", None) or {}
        value = clean_text(str(cast(dict[str, Any], dict(attrib)).get(attr) or ""))
        if value:
            out.append(value)
    return out


def count(page: ScraplingPage, css: str) -> int:
    return len(_nodes(page, css))


def split_pseudo(css: str) -> tuple[str, str | None]:
    """`a.t::attr(href)` → (`a.t`, `href`); `h2::text` → (`h2`, None)."""
    match = _ATTR_PSEUDO.search(css)
    if match is not None:
        return css[: match.start()].strip(), match.group(1)
    text = _TEXT_PSEUDO.search(css)
    if text is not None:
        return css[: text.start()].strip(), None
    return css.strip(), None


def field_spec(name: str, css: str, *, required: bool, adaptive: bool) -> FieldSpec:
    selector, attr = split_pseudo(css)
    if name == "link" and attr is None:
        attr = "href"
    return FieldSpec(name, css=selector, attr=attr, required=required, adaptive=adaptive)


def extract_listing(
    engine: ScraplingJobEngine,
    result: FetchResult,
    *,
    item_css: str,
    fields: list[FieldSpec],
    source: SourceRef,
) -> list[ExtractionOutcome]:
    """Item containers + fields with Scrapling adaptive relocation (15 §6)."""
    spec = ExtractionSpec(
        identifier_prefix="cloud",
        item_css=split_pseudo(item_css)[0],
        fields=tuple(fields),
        prefer_json_ld=False,
    )
    return engine.extract_items(result, spec, source=source)


def confirm(engine: ScraplingJobEngine, outcomes: list[ExtractionOutcome]) -> None:
    """Save adaptive fingerprints of the outcomes that became valid items."""
    engine.confirm_adaptive(outcomes)


def _node_text(node: Any) -> str:
    return ScraplingPage.node_text(node)


def link_entries(
    page: ScraplingPage,
    link_selector: str,
    *,
    name_selector: str | None,
    description_selector: str | None,
    anchor_attr: str | None,
) -> list[dict[str, str | None]]:
    """Directory entries: each link's href, name, description and anchor id."""
    out: list[dict[str, str | None]] = []
    for node in _nodes(page, split_pseudo(link_selector)[0]):
        attrib = cast(dict[str, Any], dict(getattr(node, "attrib", None) or {}))
        href = clean_text(str(attrib.get("href") or ""))
        if not href:
            continue

        def first(css: str | None, scope: Any = node) -> str | None:
            if not css:
                return None
            try:
                found = list(scope.css(split_pseudo(css)[0]))
            except Exception:  # noqa: BLE001 - a bad configured selector is a miss
                return None
            for candidate in found:
                text = _node_text(candidate)
                if text:
                    return text
            return None

        out.append(
            {
                "href": href,
                "name": first(name_selector) or _node_text(node) or None,
                "description": first(description_selector),
                "anchor": clean_text(str(attrib.get(anchor_attr) or "")) or None
                if anchor_attr
                else None,
            }
        )
    return out
