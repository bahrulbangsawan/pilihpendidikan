"""Email application templates (09 §5.1): a port of `renderEmailTemplate` of
`packages/jobs-contracts/src/email.ts`.

The template texts are byte copies of `packages/jobs-contracts/email-templates/{en,id}.txt`
(the source of truth); `tests/email` fails when they drift. Syntax: `{path}` or
`{path|"fallback"}`; the first line `Subject: …` / `Subjek: …` is the subject.
"""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any, Final, Literal

Locale = Literal["en", "id"]

TEMPLATES: Final[dict[str, str]] = {
    "en": (
        "Subject: Application for {posting.title} — {facts.contact.full_name}\n"
        "\n"
        'Dear {recipient_name|"Hiring Team"},\n'
        "\n"
        "I am writing to apply for the {posting.title} position at "
        "{posting.company_name}{posting.source_ref_clause}.\n"
        "Please find my CV attached.\n"
        "\n"
        "{optional_paragraph}\n"
        "\n"
        "Kind regards,\n"
        "{facts.contact.full_name}\n"
        "{facts.contact.phone}\n"
        '{facts.links.linkedin|""}\n'
    ),
    "id": (
        "Subjek: Lamaran {posting.title} — {facts.contact.full_name}\n"
        "\n"
        'Yth. {recipient_name|"Tim Rekrutmen"} {posting.company_name},\n'
        "\n"
        "Dengan hormat, saya bermaksud melamar posisi {posting.title} di "
        "{posting.company_name}{posting.source_ref_clause}.\n"
        "Bersama email ini saya lampirkan CV saya.\n"
        "\n"
        "{optional_paragraph}\n"
        "\n"
        "Atas perhatian Bapak/Ibu, saya ucapkan terima kasih.\n"
        "\n"
        "Hormat saya,\n"
        "{facts.contact.full_name}\n"
        "{facts.contact.phone}\n"
        '{facts.links.linkedin|""}\n'
    ),
}

_PLACEHOLDER = re.compile(r'\{([a-z_]+(?:\.[a-z0-9_]+)*)(?:\|"([^"]*)")?\}')
_SUBJECT_LINE = re.compile(r"^(?:Subject|Subjek): (.*)$")
_WHITESPACE = re.compile(r"\s+")
_TRAILING_LINE_SPACE = re.compile(r"[ \t]+$", re.MULTILINE)
_EXTRA_BLANK_LINES = re.compile(r"\n{3,}")
_TRAILING_SEPARATOR = re.compile(r"\s+[—–-]\s*$")


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    body_text: str
    locale: str


def _is_control(ch: str) -> bool:
    return unicodedata.category(ch) == "Cc"


def inline_value(value: Any) -> str:
    """One-line values: controls removed, whitespace collapsed, trimmed (numbers as text)."""
    if isinstance(value, bool):
        return ""
    if isinstance(value, int | float):
        return str(value)
    if not isinstance(value, str):
        return ""
    cleaned = "".join(" " if _is_control(ch) else ch for ch in value)
    return _WHITESPACE.sub(" ", cleaned).strip()


def paragraph_value(value: str | None) -> str:
    text = (value or "").replace("\r\n", "\n").replace("\r", "\n")
    return "".join(ch for ch in text if ch == "\n" or not _is_control(ch)).strip()


def _resolve(
    path: str,
    *,
    facts: Mapping[str, Any],
    posting: Mapping[str, Any],
    recipient_name: str | None,
    optional_paragraph: str | None,
) -> str:
    if path == "posting.title":
        return inline_value(posting.get("title"))
    if path == "posting.company_name":
        return inline_value(posting.get("company_name"))
    if path == "posting.source_ref_clause":
        ref = inline_value(posting.get("source_job_ref"))
        return "" if ref == "" else f" (ref. {ref})"
    if path == "recipient_name":
        return inline_value(recipient_name)
    if path == "optional_paragraph":
        return paragraph_value(optional_paragraph)
    if path.startswith("facts."):
        return inline_value(facts.get(path[len("facts.") :]))
    return ""


def render_email_template(
    *,
    locale: str,
    facts: Mapping[str, Any],
    posting: Mapping[str, Any],
    recipient_name: str | None = None,
    optional_paragraph: str | None = None,
) -> RenderedEmail:
    """Same rules as the TypeScript renderer: blank placeholder lines are dropped, at most
    one blank line in a row, no trailing spaces, a dangling " —" is cut from the subject."""
    if locale not in TEMPLATES:
        raise ValueError(f"unknown email locale {locale!r}")
    template = TEMPLATES[locale].replace("\r\n", "\n")
    header, *body_lines = template.split("\n")
    match = _SUBJECT_LINE.match(header)
    if match is None:
        raise ValueError(f"email template {locale} lacks a subject line")

    def render_line(line: str) -> str:
        def substitute(found: re.Match[str]) -> str:
            value = _resolve(
                found.group(1),
                facts=facts,
                posting=posting,
                recipient_name=recipient_name,
                optional_paragraph=optional_paragraph,
            )
            return value if value != "" else (found.group(2) or "")

        return _PLACEHOLDER.sub(substitute, line)

    subject = _TRAILING_SEPARATOR.sub("", inline_value(render_line(match.group(1))))
    rendered: list[str] = []
    for line in body_lines:
        out = render_line(line)
        if _PLACEHOLDER.search(line) and out.strip() == "":
            continue
        rendered.append(out)
    body = "\n".join(rendered)
    body = _TRAILING_LINE_SPACE.sub("", body)
    body = _EXTRA_BLANK_LINES.sub("\n\n", body).strip()
    return RenderedEmail(subject=subject, body_text=body, locale=locale)


def facts_map(facts: list[dict[str, Any]]) -> dict[str, Any]:
    """`GET /profile/facts` items → `{key: value}` for the renderer."""
    return {str(f["key"]): f.get("value") for f in facts if isinstance(f.get("key"), str)}
