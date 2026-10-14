"""Deterministic signals on postings and pages (24 §4, D-40): no AI involved.

- employment detail (adds `freelance`), application method, posting-level login needs;
- skills from tags and the shared skills dictionary (`skills-dictionary.json`);
- suspicious-posting heuristics (upfront fees, messaging-app-only contact, payment in
  crypto / gift cards / wire transfers, implausible pay);
- page-level login / paywall detection (`auth_required`).
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterable
from functools import cache
from importlib import resources
from typing import Any, Final, cast
from urllib.parse import urlsplit

from pilih_jobs.contracts.fingerprint import normalize_text
from pilih_jobs.contracts.psl import ascii_host, registrable_domain
from pilih_jobs.discovery.normalize import employment_of

MAX_SKILLS: Final = 30

_FREELANCE: Final = re.compile(
    r"\b(freelanc\w*|gig|per[\s-]project|project[\s-]based|pekerja\s+lepas|lepas)\b", re.IGNORECASE
)
_EMAIL: Final = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_EMAIL_APPLY: Final = re.compile(
    r"\b(send|email|e-mail|kirim)\w*\b[^.\n]{0,60}\b(cv|resume|resum[eé]|lamaran|application)\b",
    re.IGNORECASE,
)
_LOGIN_TO_APPLY: Final = re.compile(
    r"\b(log\s?in|sign\s?in|sign\s?up|register|create an account|become a member|masuk|daftar)\b"
    r"[^.\n]{0,30}\b(to apply|to view|untuk melamar|untuk melihat)\b",
    re.IGNORECASE,
)

_SUSPICIOUS: Final[tuple[tuple[str, re.Pattern[str]], ...]] = (
    (
        "upfront_fee",
        re.compile(
            r"\b(registration|processing|training|application|onboarding|starter[\s-]kit)\s+fee\b"
            r"|\bpay\s+(?:a\s+|the\s+)?(?:small\s+)?fee\b|\bupfront\s+(?:payment|fee|deposit)\b"
            r"|\bdeposit\s+(?:is\s+)?required\b|\bbiaya\s+(?:pendaftaran|administrasi|pelatihan)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "payment_request",
        # A request that the CANDIDATE sends money (scam pattern), not a mention of
        # payments or crypto as the employer's business (Tether, gift-card firms).
        re.compile(
            r"\b(?:send|deposit|transfer|purchase|buy|top\s?up|kirim)\b"
            r"[^.\n]{0,40}\b(?:gift\s*cards?|bitcoin|btc|usdt|crypto(?:currency)?"
            r"|via\s+western\s+union|via\s+moneygram)\b"
            r"|\bwire\s+(?:the\s+)?(?:money|funds|payment)\b"
            r"|\b(?:deposit|cash)\s+(?:the\s+|a\s+)?(?:check|cheque)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "messaging_contact",
        re.compile(
            r"\b(?:contact|message|chat|text|hubungi|reach)\b[^.\n]{0,40}"
            r"\b(?:whats\s?app|telegram|wa\.me|t\.me|signal\s+app)\b",
            re.IGNORECASE,
        ),
    ),
    (
        "implausible_pay",
        re.compile(
            r"\b(?:earn|make|dapatkan)\b[^.\n]{0,20}(?:\$|usd\s?|rp\.?\s?)\s?\d[\d,.]*\s?k?\s*"
            r"(?:\+\s*)?(?:per|/|a)\s*(?:day|hour|hari|jam)\b[^.\n]{0,60}"
            r"\b(?:no experience|without experience|tanpa pengalaman|from home)\b",
            re.IGNORECASE,
        ),
    ),
)

_LOGIN_PATH: Final = re.compile(
    r"/(?:login|log-in|signin|sign-in|sign_in|users/sign_in|account/login|accounts/login"
    r"|auth/login|register|signup|sign-up|join|membership|subscribe|pricing)(?:[/?#.]|$)",
    re.IGNORECASE,
)
_PAYWALL: Final = re.compile(
    r"\b(?:sign\s?in|log\s?in|sign\s?up|join|subscribe|upgrade|become a member"
    r"|create (?:a free |an )?account)\b[^.\n]{0,40}\bto (?:view|see|unlock|access|browse)\b"
    r"[^.\n]{0,30}\b(?:jobs?|listings?|vacanc\w*|details|the full)"
    r"|\bmembers?[\s-]only\b|\bmasuk untuk melihat\b|\bdaftar untuk melihat\b",
    re.IGNORECASE,
)


def employment_detail(raw: str | None, text: str = "") -> str | None:
    """`employment_detail`: the employment type plus `freelance` (24 §2.3)."""
    haystack = " ".join(p for p in (raw, text[:400]) if p)
    if raw and _FREELANCE.search(raw):
        return "freelance"
    mapped = employment_of(raw)
    # A contract (or unstated) engagement the posting calls freelance is `freelance`.
    if mapped in ("contract", "unknown") and haystack and _FREELANCE.search(haystack):
        return "freelance"
    return None if mapped == "unknown" else mapped


def _host_domain(url: str | None) -> str | None:
    host = ascii_host(urlsplit(url).hostname if url else None)
    if not host:
        return None
    return registrable_domain(host.rstrip(".")) or host


#: Marketplaces whose applications need an account there (a link to them, or an
#: aggregator path such as `/jobs/upwork/…`, means `platform_account`).
ACCOUNT_PLATFORMS: Final = frozenset(
    {
        "upwork",
        "fiverr",
        "freelancer",
        "peopleperhour",
        "guru",
        "toptal",
        "seek",
        "glints",
        "jobstreet",
        "kalibrr",
        "linkedin",
        "indeed",
    }
)


def needs_platform_account(url: str | None) -> bool:
    if not url:
        return False
    parts = urlsplit(url)
    domain = _host_domain(url) or ""
    if domain.split(".", 1)[0] in ACCOUNT_PLATFORMS:
        return True
    segments = [seg.lower() for seg in parts.path.split("/") if seg][:3]
    return any(seg in ACCOUNT_PLATFORMS for seg in segments)


def application_method(apply_url: str | None, description: str, board_domain: str) -> str:
    if apply_url and apply_url.lower().startswith("mailto:"):
        return "email"
    if needs_platform_account(apply_url):
        return "platform_account"
    if _EMAIL_APPLY.search(description) and _EMAIL.search(description):
        return "email"
    domain = _host_domain(apply_url)
    if domain and domain != board_domain:
        return "external_url"
    return "unknown"


def login_to_apply(description: str) -> bool:
    return bool(_LOGIN_TO_APPLY.search(description))


_SENTENCE: Final = re.compile(r"(?<=[.!?\n])\s+")
#: Anti-fraud disclaimers ("we will never ask for payment or gift cards") are not fraud.
_NEGATION: Final = re.compile(
    r"\b(never|not|n't|no one|nobody|beware|scam|fraud\w*|phishing|tidak pernah|tidak akan|"
    r"waspada|penipuan)\b",
    re.IGNORECASE,
)


def suspicious_reasons(*texts: str | None) -> list[str]:
    haystack = "\n".join(t for t in texts if t)
    sentences = [s for s in _SENTENCE.split(haystack[:50_000]) if s.strip()]
    found: list[str] = []
    for reason, pattern in _SUSPICIOUS:
        for sentence in sentences:
            if pattern.search(sentence) and not _NEGATION.search(sentence):
                found.append(reason)
                break
    return found


# ---------------------------------------------------------------- skills
@cache
def _dictionary() -> tuple[dict[str, str], dict[str, str]]:
    """(any term → label, scannable term → label); terms in normalizeText form."""
    text = (
        resources.files("pilih_jobs.contracts")
        .joinpath("data", "skills-dictionary.json")
        .read_text("utf-8")
    )
    data = cast(dict[str, Any], json.loads(text))
    every: dict[str, str] = {}
    scan: dict[str, str] = {}
    for raw in cast(list[dict[str, Any]], data.get("skills") or []):
        label = str(raw.get("label") or raw.get("id") or "")
        terms = [str(raw.get("id") or ""), normalize_text(label)]
        terms += [str(s) for s in cast(list[Any], raw.get("synonyms") or [])]
        for term in terms:
            if not term:
                continue
            every.setdefault(term, label)
            # Short synonyms ("ts", "go", "py") only count as explicit tags.
            if len(term) >= 4 or term in ("java", "rust", "ruby", "php", "sql", "aws", "gcp"):
                scan.setdefault(term, label)
    return every, scan


def skills_of(tags: Iterable[str], title: str, description: str) -> list[str]:
    every, scan = _dictionary()
    out: list[str] = []

    def add(label: str) -> None:
        if label and label not in out and len(out) < MAX_SKILLS:
            out.append(label)

    for tag in tags:
        label = every.get(normalize_text(tag))
        if label:
            add(label)
    haystack = f" {normalize_text(title)} {normalize_text(description[:20_000])} "
    for term, label in scan.items():
        if f" {term} " in haystack:
            add(label)
    return out


# ---------------------------------------------------------------- page-level walls
def login_redirect(requested_url: str, final_url: str) -> bool:
    """The board sent us to a login / sign-up / pricing page instead of listings."""
    if not final_url or final_url == requested_url:
        return False
    requested_path = urlsplit(requested_url).path
    final_path = urlsplit(final_url).path
    return bool(_LOGIN_PATH.search(final_path)) and not _LOGIN_PATH.search(requested_path)


def paywall_text(text: str) -> bool:
    return bool(_PAYWALL.search(text[:20_000]))
