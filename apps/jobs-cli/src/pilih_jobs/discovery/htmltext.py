"""HTML → text and requirement bullets (15 §10.1), on the stdlib HTML parser.

- Block elements become newlines, `<li>` becomes `- `, `<br>` a newline; `script`,
  `style`, `noscript`, `template`, `svg` and `head` are dropped; whitespace inside a line
  is collapsed and empty lines removed.
- Requirements are the bullets under a heading matching
  `requirements|qualifications|what you'll need|kualifikasi|persyaratan` (≤ 50 items,
  ≤ 500 characters each). A heading is an `<h1>`–`<h6>`, a block whose text is all bold,
  or a short line ending in `:`.
"""

from __future__ import annotations

import html
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Final

BLOCK_TAGS: Final = frozenset(
    {
        "address",
        "article",
        "aside",
        "blockquote",
        "dd",
        "div",
        "dl",
        "dt",
        "fieldset",
        "figcaption",
        "figure",
        "footer",
        "form",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "header",
        "hr",
        "li",
        "main",
        "nav",
        "ol",
        "p",
        "pre",
        "section",
        "table",
        "tbody",
        "td",
        "th",
        "thead",
        "tr",
        "ul",
    }
)
SKIP_TAGS: Final = frozenset(
    {"script", "style", "noscript", "template", "svg", "head", "iframe", "object", "title"}
)
HEADING_TAGS: Final = frozenset({"h1", "h2", "h3", "h4", "h5", "h6"})
BOLD_TAGS: Final = frozenset({"strong", "b"})
REQUIREMENTS_HEADING: Final = re.compile(
    r"requirements|qualifications|what you['’]ll need|kualifikasi|persyaratan", re.IGNORECASE
)
MAX_REQUIREMENTS: Final = 50
MAX_REQUIREMENT_CHARS: Final = 500
_BULLET_LINE = re.compile(r"^\s*(?:[-•*·▪●◦]|\d{1,2}[.)])\s+(.*\S)\s*$")
_SPACES = re.compile(r"[ \t\r\f\v  -​  　]+")
_LOOKS_ESCAPED = re.compile(r"&lt;\s*/?\s*[a-zA-Z]")


@dataclass
class Block:
    tag: str
    text: str
    bold: bool


class _Collector(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.lines: list[str] = []
        self.blocks: list[Block] = []
        self._current: list[str] = []
        self._bold_chars = 0
        self._chars = 0
        self._block_tag = "p"
        self._skip = 0
        self._bold = 0
        self._list_item_pending = False

    def _flush(self) -> None:
        text = " ".join("".join(self._current).split())
        if text:
            prefix = "- " if self._list_item_pending else ""
            self.lines.append(prefix + text)
            self.blocks.append(
                Block(
                    "li" if self._list_item_pending else self._block_tag,
                    text,
                    self._chars > 0 and self._bold_chars >= self._chars,
                )
            )
            self._list_item_pending = False
        self._current = []
        self._chars = 0
        self._bold_chars = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in SKIP_TAGS:
            self._skip += 1
            return
        if self._skip:
            return
        if tag == "br":
            self._flush()
            return
        if tag in BOLD_TAGS:
            self._bold += 1
        if tag in BLOCK_TAGS:
            self._flush()
            self._block_tag = tag
            if tag == "li":
                self._list_item_pending = True

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "br" and not self._skip:
            self._flush()

    def handle_endtag(self, tag: str) -> None:
        if tag in SKIP_TAGS:
            self._skip = max(0, self._skip - 1)
            return
        if self._skip:
            return
        if tag in BOLD_TAGS:
            self._bold = max(0, self._bold - 1)
        if tag in BLOCK_TAGS:
            self._flush()
            if tag == "li":
                self._list_item_pending = False
            self._block_tag = "p"

    def handle_data(self, data: str) -> None:
        if self._skip:
            return
        self._current.append(data)
        visible = len(data.strip())
        self._chars += visible
        if self._bold:
            self._bold_chars += visible

    def close(self) -> None:
        super().close()
        self._flush()


def unescape_if_escaped(value: str) -> str:
    """Greenhouse `content=true` returns entity-escaped HTML (`&lt;p&gt;…`)."""
    if "<" not in value and _LOOKS_ESCAPED.search(value):
        return html.unescape(value)
    return value


def _collect(markup: str) -> _Collector:
    collector = _Collector()
    collector.feed(markup)
    collector.close()
    return collector


def html_to_text(markup: str | None) -> str:
    if not markup:
        return ""
    lines = _collect(markup).lines
    return "\n".join(
        line for line in (" ".join(_SPACES.sub(" ", ln).split()) for ln in lines) if line
    )


def plain_text(value: str | None) -> str:
    """Normalize plain text the same way (collapse spaces, drop empty lines)."""
    if not value:
        return ""
    lines = (" ".join(_SPACES.sub(" ", line).split()) for line in value.splitlines())
    return "\n".join(line for line in lines if line)


def _is_heading(block: Block) -> bool:
    if block.tag in HEADING_TAGS or block.tag == "dt":
        return True
    if block.tag == "li":
        return False
    if block.bold and len(block.text) <= 120:
        return True
    return len(block.text) <= 80 and block.text.endswith(":")


def _clip(items: list[str]) -> list[str]:
    out: list[str] = []
    for item in items:
        text = item.strip()
        if not text:
            continue
        out.append(text[:MAX_REQUIREMENT_CHARS])
        if len(out) >= MAX_REQUIREMENTS:
            break
    return out


def requirements_from_html(markup: str | None) -> list[str]:
    if not markup:
        return []
    blocks = _collect(markup).blocks
    items: list[str] = []
    capturing = False
    for block in blocks:
        if _is_heading(block):
            capturing = bool(REQUIREMENTS_HEADING.search(block.text))
            continue
        if capturing and block.tag == "li":
            items.append(block.text)
        elif capturing and block.tag != "li" and items:
            capturing = False
    return _clip(items)


def requirements_from_text(text: str | None) -> list[str]:
    if not text:
        return []
    items: list[str] = []
    capturing = False
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        bullet = _BULLET_LINE.match(line)
        if (
            bullet is None
            and len(line) <= 80
            and (line.endswith(":") or REQUIREMENTS_HEADING.fullmatch(line.rstrip(":").strip()))
        ):
            capturing = bool(REQUIREMENTS_HEADING.search(line))
            continue
        if capturing and bullet is not None:
            items.append(bullet.group(1))
        elif capturing and items:
            capturing = False
    return _clip(items)
