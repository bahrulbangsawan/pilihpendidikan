"""Handling of untrusted page text before it reaches a model or a log (19 §5.2, §7, §11).

- `strip_markers` removes the prompt delimiters (`<<UNTRUSTED_PAGE>>`, `<<SYSTEM CONTEXT>>`,
  `<<END_UNTRUSTED_PAGE>>`, …) from page content, so a page cannot close the untrusted
  block and speak as the system (19 §7 defence 1);
- `quote_control_text` is the fixed template for next-action choice descriptions: quoted,
  ≤ 60 characters, no newlines, no markers (19 §5.2);
- `redact_excerpt` masks emails, phone numbers and the applicant's own values in text
  excerpts (18 §10.6, 19 §3.1 `visible_text_excerpt`).
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from typing import Final

from pilih_jobs.contracts.wire import clip_utf16
from pilih_jobs.logging import redact_text

_MARKER_RE: Final = re.compile(
    r"<<\s*/?\s*(?:END[_ ])?(?:UNTRUSTED[_ ]PAGE|SYSTEM[_ ]CONTEXT|SYSTEM|TRUSTED|INSTRUCTIONS?)"
    r"[^<>]{0,40}>>",
    re.IGNORECASE,
)
_ANGLE_RUN_RE: Final = re.compile(r"<<|>>")
_CONTROL_CHARS_RE: Final = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f​-‏‪-‮⁦-⁩]")
REDACTED: Final = "[redacted]"


def strip_markers(text: str | None) -> str:
    """Remove prompt delimiters and invisible control characters from page text."""
    if not text:
        return ""
    out = _MARKER_RE.sub(" ", text)
    out = _ANGLE_RUN_RE.sub(" ", out)
    return _CONTROL_CHARS_RE.sub("", out)


def clip(text: str | None, limit: int) -> str:
    """Markers stripped, whitespace collapsed, at most `limit` UTF-16 units (the contract's
    `.max(n)` counts like JavaScript)."""
    return clip_utf16(" ".join(strip_markers(text).split()), limit)


def quote_control_text(text: str | None, limit: int = 60) -> str:
    """`"Continue"` — quoted, ≤ 60 characters, newlines and markers stripped (19 §5.2)."""
    value = clip(text, limit).replace('"', "'")
    return f'"{value}"'


_EMAIL_RE: Final = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}")
_PHONE_RUN_RE: Final = re.compile(r"\+?\(?\d[\d\s().-]{6,22}\d")


def _phone(match: re.Match[str]) -> str:
    run = match.group(0)
    return REDACTED if sum(ch.isdigit() for ch in run) >= 9 else run


def redact_excerpt(text: str | None, own_values: Iterable[str] = (), limit: int = 2048) -> str:
    """Replace emails, phones and the applicant's own values (name, …) with `[redacted]`."""
    if not text:
        return ""
    out = strip_markers(text)
    for value in sorted({v.strip() for v in own_values if v and len(v.strip()) >= 3}, key=len)[
        ::-1
    ]:
        out = re.sub(re.escape(value), REDACTED, out, flags=re.IGNORECASE)
    out = _EMAIL_RE.sub(REDACTED, out)
    out = _PHONE_RUN_RE.sub(_phone, out)
    out = redact_text(out)
    out = re.sub(r"[ \t]+", " ", out)
    out = re.sub(r"\n{3,}", "\n\n", out).strip()
    return out[:limit]
