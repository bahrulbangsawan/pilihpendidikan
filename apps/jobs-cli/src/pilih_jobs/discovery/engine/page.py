"""`ScraplingPage`: the `HtmlPage` view over a Scrapling `Selector` (engine-internal).

Adapters get this object through `FetchResult.page` but only see the `HtmlPage`
protocol; the Selector itself never leaves the engine package.
"""

from __future__ import annotations

import json
import re
from typing import Any, Final
from urllib.parse import urljoin, urlsplit

from pilih_jobs.discovery.schema_org import flatten_json_ld, has_type
from pilih_jobs.logging import get_logger

__all__ = ["ScraplingPage", "clean_text", "flatten_json_ld", "has_type"]

_log = get_logger("discovery.page")
_JSONLD_COMMENT = re.compile(
    r"^\s*(?:<!--|//\s*<!\[CDATA\[|<!\[CDATA\[)|(?:-->|//\s*\]\]>|\]\]>)\s*$"
)
_WHITESPACE = re.compile(r"\s+")
MAX_JSONLD_BLOCKS: Final = 50


def clean_text(value: str | None) -> str:
    return _WHITESPACE.sub(" ", value or "").strip()


class ScraplingPage:
    def __init__(self, selector: Any, url: str, native: Any = None) -> None:
        self._sel: Any = selector
        self._url = url
        #: The Scrapling `Response` the page was parsed from (spiders need it).
        self.native: Any = native

    @property
    def url(self) -> str:
        return self._url

    @property
    def selector(self) -> Any:
        return self._sel

    # ------------------------------------------------------------------ queries
    def _css(self, css: str, scope: Any = None) -> list[Any]:
        target: Any = self._sel if scope is None else scope
        try:
            return list(target.css(css))
        except Exception as exc:  # noqa: BLE001 - a bad configured selector is a miss
            _log.debug("css query failed: %s (%s)", css, type(exc).__name__)
            return []

    @staticmethod
    def node_text(node: Any) -> str:
        try:
            return clean_text(str(node.get_all_text(separator=" ", strip=True)))
        except Exception:  # noqa: BLE001 - text nodes have no get_all_text
            return clean_text(str(node))

    def json_ld(self) -> list[dict[str, Any]]:
        objects: list[dict[str, Any]] = []
        for script in self._css('script[type="application/ld+json"]')[:MAX_JSONLD_BLOCKS]:
            raw = str(script.text or "")
            text = _JSONLD_COMMENT.sub("", raw).strip()
            if not text:
                continue
            try:
                objects.extend(flatten_json_ld(json.loads(text)))
            except json.JSONDecodeError:
                _log.debug("invalid JSON-LD block on %s", self._url)
        return objects

    def meta_content(self, *names: str) -> str | None:
        for name in names:
            for attr in ("property", "name", "itemprop"):
                nodes = self._css(f'meta[{attr}="{name}"]')
                for node in nodes:
                    value = clean_text(str(node.attrib.get("content") or ""))
                    if value:
                        return value
        return None

    def _absolute(self, href: str) -> str | None:
        href = href.strip()
        if not href or href.startswith(("#", "javascript:", "mailto:", "tel:", "data:")):
            return None
        absolute = urljoin(self._url, href)
        if urlsplit(absolute).scheme not in ("http", "https"):
            return None
        return absolute

    def links(self, css: str | None = None) -> list[str]:
        scopes = self._css(css) if css else [self._sel]
        out: list[str] = []
        for scope in scopes:
            anchors = [scope] if str(getattr(scope, "tag", "")) == "a" else self._css("a", scope)
            for anchor in anchors:
                absolute = self._absolute(str(anchor.attrib.get("href") or ""))
                if absolute is not None and absolute not in out:
                    out.append(absolute)
        return out

    def first_text(self, css: str) -> str | None:
        for node in self._css(css):
            text = self.node_text(node)
            if text:
                return text
        return None

    def texts(self, css: str) -> list[str]:
        return [t for t in (self.node_text(n) for n in self._css(css)) if t]

    def first_attr(self, css: str, attr: str) -> str | None:
        for node in self._css(css):
            value = clean_text(str(node.attrib.get(attr) or ""))
            if value:
                return value
        return None

    def first_html(self, css: str) -> str | None:
        for node in self._css(css):
            return str(node.html_content)
        return None

    def visible_text(self) -> str:
        bodies = self._css("body")
        target: Any = bodies[0] if bodies else self._sel
        return self.node_text(target)

    def title(self) -> str | None:
        return self.first_text("title")

    def rel_next(self) -> str | None:
        for css in ('link[rel="next"]', 'a[rel~="next"]'):
            href = self.first_attr(css, "href")
            if href:
                return self._absolute(href)
        return None
