"""Normalization into the `postings:batch` item shape (15 §10.1).

Adapters map their source format into a `PostingDraft`; `normalize()` applies the shared
rules: titles stripped and clipped, locations split and resolved against the ISO 3166 /
US-state / Indonesian-province tables, workplace and employment vocabularies mapped,
salaries parsed (API objects directly, text by a currency + range regex; ambiguous text
keeps only `raw`), descriptions converted HTML → text and clipped at 64 KB, requirement
bullets extracted, URLs made canonical (03 §4.2), dates converted to epoch milliseconds
(relative "3 days ago" text is flagged `posted_at_relative`).
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any, Final, Literal, cast
from urllib.parse import urljoin, urlsplit

from pilih_jobs.contracts.fingerprint import canonical_url
from pilih_jobs.contracts.psl import ascii_host, registrable_domain
from pilih_jobs.discovery import geo
from pilih_jobs.discovery.htmltext import (
    html_to_text,
    plain_text,
    requirements_from_html,
    requirements_from_text,
    unescape_if_escaped,
)

TITLE_MAX: Final = 300
DESCRIPTION_MAX_BYTES: Final = 64 * 1024
LOCATION_RAW_MAX: Final = 300
LOCATION_PART_MAX: Final = 120
MAX_LOCATIONS: Final = 50
DEPARTMENT_MAX: Final = 200
SENIORITY_MAX: Final = 60
SALARY_RAW_MAX: Final = 2000
DAY_MS: Final = 86_400_000

WorkplaceType = Literal["onsite", "hybrid", "remote", "unknown"]
EmploymentType = Literal[
    "full_time", "part_time", "contract", "temporary", "internship", "volunteer", "unknown"
]
SalaryPeriod = Literal["year", "month", "week", "day", "hour"]

#: Hosts of the ATS boards/APIs: never a *company* domain (15 §10.1 company_domain).
ATS_HOST_SUFFIXES: Final = (
    "greenhouse.io",
    "lever.co",
    "ashbyhq.com",
    "smartrecruiters.com",
    "workable.com",
    "myworkdayjobs.com",
    "myworkdaysite.com",
    "workday.com",
    "bamboohr.com",
    "recruitee.com",
    "jobvite.com",
    "icims.com",
    "breezy.hr",
    "teamtailor.com",
    "personio.de",
    "personio.com",
)


@dataclass
class PostingDraft:
    """Adapter output before the shared rules (all fields optional)."""

    title: str | None = None
    company_name: str | None = None
    company_url: str | None = None
    locations: list[str] = field(default_factory=lambda: [])
    structured_locations: list[dict[str, Any]] = field(default_factory=lambda: [])
    workplace_type: str | None = None
    remote: bool | None = None
    employment_type: str | None = None
    salary: dict[str, Any] | None = None
    salary_text: str | None = None
    description_html: str | None = None
    description_text: str | None = None
    requirements: list[str] | None = None
    apply_url: str | None = None
    canonical_url: str | None = None
    posted_at: str | int | float | None = None
    department: str | None = None
    seniority: str | None = None
    valid_through: str | None = None


@dataclass
class NormalizedFields:
    title: str
    company_name: str
    company_domain: str | None
    locations: list[dict[str, Any]]
    workplace_type: WorkplaceType
    employment_type: EmploymentType
    salary: dict[str, Any] | None
    description_text: str
    description_truncated: bool
    requirements: list[str]
    apply_url: str | None
    apply_domain: str | None
    canonical_url: str | None
    posted_at: int | None
    department: str | None
    seniority: str | None
    flags: list[str] = field(default_factory=lambda: [])


# ---------------------------------------------------------------- text helpers
_WS = re.compile(r"\s+")


def clean(value: Any, limit: int | None = None) -> str:
    text = _WS.sub(" ", str(value) if value is not None else "").strip()
    return text[:limit] if limit is not None else text


def normalize_title(value: str | None) -> str:
    if not value:
        return ""
    text = html_to_text(unescape_if_escaped(value)) if "<" in value or "&" in value else value
    return clean(text.replace("\n", " "), TITLE_MAX)


def clip_utf8(text: str, max_bytes: int) -> tuple[str, bool]:
    data = text.encode("utf-8")
    if len(data) <= max_bytes:
        return text, False
    return data[:max_bytes].decode("utf-8", errors="ignore").rstrip(), True


def description_of(draft: PostingDraft) -> tuple[str, bool]:
    if draft.description_html:
        text = html_to_text(unescape_if_escaped(draft.description_html))
    else:
        text = plain_text(draft.description_text)
    return clip_utf8(text, DESCRIPTION_MAX_BYTES)


def requirements_of(draft: PostingDraft) -> list[str]:
    if draft.requirements:
        out = [clean(r, 500) for r in draft.requirements if clean(r)]
        return out[:50]
    if draft.description_html:
        found = requirements_from_html(unescape_if_escaped(draft.description_html))
        if found:
            return found
    return requirements_from_text(draft.description_text)


# ---------------------------------------------------------------- URLs and domains
def is_ats_host(host: str | None) -> bool:
    if not host:
        return False
    lowered = host.lower().rstrip(".")
    return any(lowered == s or lowered.endswith(f".{s}") for s in ATS_HOST_SUFFIXES)


def absolute_url(value: str | None, base: str | None = None) -> str | None:
    if not value:
        return None
    text = value.strip()
    if base:
        text = urljoin(base, text)
    parts = urlsplit(text)
    if parts.scheme.lower() not in ("http", "https") or not parts.hostname:
        return None
    return text


def domain_of(url_or_host: str | None) -> str | None:
    host = ascii_host(url_or_host)
    if not host:
        return None
    clean_host = host.rstrip(".")
    return registrable_domain(clean_host) or clean_host


def company_domain_of(
    draft: PostingDraft, apply_url: str | None, page_url: str | None
) -> str | None:
    """Registrable domain of the company site or careers host — never an ATS host."""
    for candidate in (draft.company_url, page_url, apply_url):
        host = ascii_host(candidate)
        if not host or is_ats_host(host) or re.fullmatch(r"[\d.]+|\[[0-9a-f:]+\]", host):
            continue
        domain = registrable_domain(host.rstrip("."))
        if domain:
            return domain
    return None


# ---------------------------------------------------------------- locations
_LOCATION_SPLIT = re.compile(r"\s+/\s+|;|\||\s+or\s+", re.IGNORECASE)
_PAREN = re.compile(r"\(([^)]*)\)")
_DASH = re.compile(r"\s+[-–—]\s+")


def split_locations(raw: str) -> list[str]:
    return [part.strip() for part in _LOCATION_SPLIT.split(raw) if part and part.strip()]


def parse_location(raw: str) -> tuple[dict[str, Any], bool]:
    """`{raw, city?, region?, country_code?}` and whether the text says remote."""
    text = clean(raw, LOCATION_RAW_MAX)
    remote = bool(geo.REMOTE_WORDS.search(text))
    inner = [p.strip() for p in _PAREN.findall(text) if p.strip()]
    base = _PAREN.sub(" ", text)
    base = geo.REMOTE_WORDS.sub(" ", base)
    comps = [c.strip(" -–—:") for c in re.split(r",|\s+[-–—]\s+", base)]
    comps = [c for c in comps if c and not re.fullmatch(r"[\W_]+", c)]
    for part in inner:
        comps.extend(c.strip() for c in part.split(",") if c.strip())
    entry: dict[str, Any] = {"raw": text}
    country: str | None = None
    region: str | None = None
    if comps:
        last = comps[-1]
        provinces = [geo.id_province(c) for c in comps]
        if (
            re.fullmatch(r"[A-Z]{2}", last)
            and last in geo.US_STATES
            and len(comps) >= 2
            and not (last == "ID" and any(provinces[:-1]))
        ):
            region, country = geo.US_STATES[last], "US"
            comps = comps[:-1]
        elif (code := geo.country_code(last)) is not None and not (
            len(last) == 2 and len(comps) == 1 and last.upper() in geo.US_STATES
        ):
            country = code
            comps = comps[:-1]
        elif (state := geo.us_state(last)) is not None and len(last) > 2:
            region, country = state, "US"
            comps = comps[:-1]
    if comps and region is None:
        candidate = comps[-1] if len(comps) >= 2 else None
        province = geo.id_province(comps[-1])
        if candidate is not None and (state := geo.us_state(candidate)) is not None:
            region = state
            country = country or "US"
            comps = comps[:-1]
        elif province is not None:
            region = province
            country = country or "ID"
            if len(comps) >= 2:
                comps = comps[:-1]
            elif comps[0].lower() not in ("jakarta", "yogyakarta"):
                comps = []
        elif candidate is not None:
            region = candidate
            comps = comps[:-1]
    if comps:
        entry["city"] = clean(comps[0], LOCATION_PART_MAX)
    if region:
        entry["region"] = clean(region, LOCATION_PART_MAX)
    if country:
        entry["country_code"] = country
    return entry, remote


def _structured_location(value: Mapping[str, Any]) -> dict[str, Any] | None:
    raw = clean(value.get("raw"), LOCATION_RAW_MAX)
    if not raw:
        return None
    entry: dict[str, Any] = {"raw": raw}
    for key in ("city", "region"):
        part = clean(value.get(key), LOCATION_PART_MAX)
        if part:
            entry[key] = part
    code = value.get("country_code")
    resolved = geo.country_code(str(code)) if code else None
    if resolved is None and value.get("country"):
        resolved = geo.country_code(str(value.get("country")))
    if resolved:
        entry["country_code"] = resolved
    return entry


def locations_of(draft: PostingDraft) -> tuple[list[dict[str, Any]], bool]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    remote = False
    for structured in draft.structured_locations:
        entry = _structured_location(structured)
        if entry is not None and entry["raw"].lower() not in seen:
            seen.add(entry["raw"].lower())
            out.append(entry)
            remote = remote or bool(geo.REMOTE_WORDS.search(entry["raw"]))
    for raw in draft.locations:
        for piece in split_locations(clean(raw)):
            entry, is_remote = parse_location(piece)
            remote = remote or is_remote
            if entry["raw"].lower() in seen:
                continue
            seen.add(entry["raw"].lower())
            out.append(entry)
    return out[:MAX_LOCATIONS], remote


# ---------------------------------------------------------------- vocabularies
_WORKPLACE: Final[dict[str, WorkplaceType]] = {
    "remote": "remote",
    "fully remote": "remote",
    "telecommute": "remote",
    "hybrid": "hybrid",
    "onsite": "onsite",
    "on site": "onsite",
    "on-site": "onsite",
    "in office": "onsite",
    "in-office": "onsite",
    "office": "onsite",
    "on_site": "onsite",
    "wfo": "onsite",
}
_HYBRID = re.compile(r"\bhybrid\b", re.IGNORECASE)
_ONSITE = re.compile(r"\b(on[- ]?site|in[- ]office|wfo)\b", re.IGNORECASE)


def workplace_of(draft: PostingDraft, locations_remote: bool) -> WorkplaceType:
    if draft.workplace_type:
        key = clean(draft.workplace_type).lower().replace("_", " ")
        mapped = _WORKPLACE.get(key) or _WORKPLACE.get(key.replace(" ", ""))
        if mapped is not None:
            return mapped
    if draft.remote is True:
        return "remote"
    haystack = " ".join([draft.title or "", *draft.locations])
    if _HYBRID.search(haystack):
        return "hybrid"
    if locations_remote or geo.REMOTE_WORDS.search(haystack):
        return "remote"
    if _ONSITE.search(haystack):
        return "onsite"
    return "unknown"


_EMPLOYMENT_PATTERNS: Final[tuple[tuple[re.Pattern[str], EmploymentType], ...]] = (
    (re.compile(r"intern|magang|apprentice|trainee", re.IGNORECASE), "internship"),
    (re.compile(r"part[\s_-]?time|paruh\s+waktu", re.IGNORECASE), "part_time"),
    (re.compile(r"volunt", re.IGNORECASE), "volunteer"),
    (re.compile(r"temp(?:orary)?\b|seasonal|fixed[\s_-]?term", re.IGNORECASE), "temporary"),
    (
        re.compile(r"contract|freelance|kontrak|consultant|contingent|pkwt", re.IGNORECASE),
        "contract",
    ),
    (
        re.compile(r"full[\s_-]?time|permanent|regular|penuh\s+waktu|tetap|pkwtt", re.IGNORECASE),
        "full_time",
    ),
)


def employment_of(value: str | None) -> EmploymentType:
    if not value:
        return "unknown"
    text = clean(value)
    for pattern, mapped in _EMPLOYMENT_PATTERNS:
        if pattern.search(text):
            return mapped
    return "unknown"


# ---------------------------------------------------------------- salary
_CURRENCY_CODES: Final = frozenset(
    [
        "USD",
        "EUR",
        "GBP",
        "IDR",
        "SGD",
        "MYR",
        "AUD",
        "CAD",
        "JPY",
        "INR",
        "PHP",
        "THB",
        "VND",
        "CNY",
        "HKD",
        "NZD",
        "CHF",
        "SEK",
        "NOK",
        "DKK",
        "PLN",
        "BRL",
        "MXN",
        "KRW",
        "TWD",
        "AED",
        "SAR",
        "ZAR",
        "CZK",
        "HUF",
        "RON",
        "ILS",
        "TRY",
        "NGN",
        "KES",
        "EGP",
        "PKR",
        "BDT",
        "LKR",
    ]
)
_SYMBOLS: Final[dict[str, str]] = {
    "us$": "USD",
    "a$": "AUD",
    "au$": "AUD",
    "c$": "CAD",
    "ca$": "CAD",
    "s$": "SGD",
    "sg$": "SGD",
    "nz$": "NZD",
    "hk$": "HKD",
    "$": "USD",
    "€": "EUR",
    "£": "GBP",
    "¥": "JPY",
    "₹": "INR",
    "rp": "IDR",
    "rp.": "IDR",
    "rm": "MYR",
    "₱": "PHP",
    "฿": "THB",
    "₫": "VND",
    "₩": "KRW",
}
_CUR = (
    r"(?:US\$|A\$|AU\$|C\$|CA\$|S\$|SG\$|NZ\$|HK\$|\$|€|£|¥|₹|₱|฿|₫|₩|Rp\.?|RM|"
    + "|".join(sorted(_CURRENCY_CODES))
    + r")"
)
_NUM = r"\d{1,3}(?:[.,\s]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d+)?"
_MUL = r"(?:k|K|m|M|mn|jt|juta|rb|ribu)\b"
_RANGE = re.compile(
    rf"(?P<c1>{_CUR})?\s?(?P<a>{_NUM})\s?(?P<m1>{_MUL})?\s*(?:-|–|—|to|sampai|s/d|hingga|until)"
    rf"\s*(?P<c2>{_CUR})?\s?(?P<b>{_NUM})\s?(?P<m2>{_MUL})?\s?(?P<c3>{_CUR})?",
    re.IGNORECASE,
)
_SINGLE = re.compile(
    rf"(?P<c1>{_CUR})\s?(?P<a>{_NUM})\s?(?P<m1>{_MUL})?|(?P<a2>{_NUM})\s?(?P<m2>{_MUL})?\s?(?P<c2>{_CUR})\b",
    re.IGNORECASE,
)
_PERIODS: Final[tuple[tuple[re.Pattern[str], SalaryPeriod], ...]] = (
    (re.compile(r"\b(?:per|a|an|/)\s*(?:hour|hr)\b|hourly|per\s+jam|/\s*jam", re.I), "hour"),
    (re.compile(r"\b(?:per|a|/)\s*day\b|daily|per\s+hari|/\s*hari", re.I), "day"),
    (re.compile(r"\b(?:per|a|/)\s*week\b|weekly|per\s+minggu|/\s*minggu", re.I), "week"),
    (
        re.compile(
            r"\b(?:per|a|/)\s*(?:month|mo|mth)\b|monthly|per\s+bulan|/\s*bulan|bulanan", re.I
        ),
        "month",
    ),
    (
        re.compile(
            r"\b(?:per|a|/)\s*(?:year|yr|annum)\b|annual|annually|yearly|p\.?a\.?\b|per\s+tahun|"
            r"/\s*tahun|tahunan",
            re.I,
        ),
        "year",
    ),
)
_UP_TO = re.compile(r"\b(up to|max(?:imum)?|hingga|sampai|maks)\b", re.IGNORECASE)
_FROM = re.compile(r"\b(from|min(?:imum)?|starting at|mulai|dari)\b", re.IGNORECASE)
_MULTIPLIERS: Final = {
    "k": 1_000.0,
    "rb": 1_000.0,
    "ribu": 1_000.0,
    "m": 1_000_000.0,
    "mn": 1_000_000.0,
    "jt": 1_000_000.0,
    "juta": 1_000_000.0,
}


def _currency(token: str | None) -> str | None:
    if not token:
        return None
    lowered = token.strip().lower()
    if lowered in _SYMBOLS:
        return _SYMBOLS[lowered]
    upper = token.strip().upper()
    return upper if upper in _CURRENCY_CODES else None


def parse_number(token: str) -> float | None:
    text = token.replace(" ", "").replace(" ", "")
    if not text:
        return None
    if "," in text and "." in text:
        decimal = "," if text.rfind(",") > text.rfind(".") else "."
        thousands = "." if decimal == "," else ","
        text = text.replace(thousands, "").replace(decimal, ".")
    elif "." in text:
        if re.fullmatch(r"\d{1,3}(?:\.\d{3})+", text):
            text = text.replace(".", "")
    elif "," in text:
        text = (
            text.replace(",", "")
            if re.fullmatch(r"\d{1,3}(?:,\d{3})+", text)
            else text.replace(",", ".")
        )
    try:
        return float(text)
    except ValueError:
        return None


def _amount(token: str | None, multiplier: str | None) -> float | None:
    if token is None:
        return None
    value = parse_number(token)
    if value is None:
        return None
    if multiplier:
        value *= _MULTIPLIERS.get(multiplier.lower(), 1.0)
    return value


def period_of(text: str) -> SalaryPeriod | None:
    for pattern, period in _PERIODS:
        if pattern.search(text):
            return period
    return None


def parse_salary_text(text: str | None) -> dict[str, Any] | None:
    """`{min, max, currency, period, raw}`; ambiguous text keeps only `raw` (15 §10.1)."""
    raw = clean(text, SALARY_RAW_MAX)
    if not raw:
        return None
    period = period_of(raw)
    match = _RANGE.search(raw)
    if match is not None:
        currency = (
            _currency(match.group("c1"))
            or _currency(match.group("c2"))
            or _currency(match.group("c3"))
        )
        shared_mul = match.group("m2") if match.group("m1") is None else match.group("m1")
        low = _amount(match.group("a"), match.group("m1") or shared_mul)
        high = _amount(match.group("b"), match.group("m2") or match.group("m1"))
        if currency and low is not None and high is not None and 0 < low <= high:
            out: dict[str, Any] = {"min": low, "max": high, "currency": currency, "raw": raw}
            if period:
                out["period"] = period
            return out
        return {"raw": raw}
    single = _SINGLE.search(raw)
    if single is not None:
        currency = _currency(single.group("c1")) or _currency(single.group("c2"))
        value = _amount(
            single.group("a") or single.group("a2"), single.group("m1") or single.group("m2")
        )
        if currency and value is not None and value > 0:
            out = {"currency": currency, "raw": raw}
            if _UP_TO.search(raw):
                out["max"] = value
            elif _FROM.search(raw):
                out["min"] = value
            else:
                out["min"] = value
                out["max"] = value
            if period:
                out["period"] = period
            return out
    return {"raw": raw}


_PERIOD_WORDS: Final[dict[str, SalaryPeriod]] = {
    "year": "year",
    "yearly": "year",
    "annual": "year",
    "annually": "year",
    "1 year": "year",
    "per-year-salary": "year",
    "per year": "year",
    "month": "month",
    "monthly": "month",
    "1 month": "month",
    "per-month-salary": "month",
    "per month": "month",
    "week": "week",
    "weekly": "week",
    "1 week": "week",
    "per-week-salary": "week",
    "day": "day",
    "daily": "day",
    "1 day": "day",
    "per-day-wage": "day",
    "hour": "hour",
    "hourly": "hour",
    "1 hour": "hour",
    "per-hour-wage": "hour",
}


def structured_salary(value: Mapping[str, Any]) -> dict[str, Any] | None:
    """An API compensation object `{min?, max?, currency?, period/interval?, raw?}`."""
    out: dict[str, Any] = {}
    for key in ("min", "max"):
        number = value.get(key)
        if isinstance(number, int | float) and not isinstance(number, bool) and number >= 0:
            out[key] = float(number)
    currency = value.get("currency")
    if isinstance(currency, str) and re.fullmatch(r"[A-Za-z]{3}", currency.strip()):
        out["currency"] = currency.strip().upper()
    period_raw = value.get("period") or value.get("interval")
    if isinstance(period_raw, str):
        period = _PERIOD_WORDS.get(period_raw.strip().lower())
        if period is not None:
            out["period"] = period
    raw = value.get("raw")
    if isinstance(raw, str) and raw.strip():
        out["raw"] = clean(raw, SALARY_RAW_MAX)
    if "min" in out and "max" in out and out["min"] > out["max"]:
        out.pop("min")
        out.pop("max")
    if not out or set(out) == {"period"}:
        return None
    return out


# ---------------------------------------------------------------- dates
_RELATIVE = re.compile(
    r"(?:(?P<n>\d+)\+?|(?P<one>an?|one|se))\s*(?P<unit>minute|min|hour|hr|day|week|month|year|"
    r"menit|jam|hari|minggu|bulan|tahun)s?\b",
    re.IGNORECASE,
)
_UNIT_MS: Final = {
    "minute": 60_000,
    "min": 60_000,
    "menit": 60_000,
    "hour": 3_600_000,
    "hr": 3_600_000,
    "jam": 3_600_000,
    "day": DAY_MS,
    "hari": DAY_MS,
    "week": 7 * DAY_MS,
    "minggu": 7 * DAY_MS,
    "month": 30 * DAY_MS,
    "bulan": 30 * DAY_MS,
    "year": 365 * DAY_MS,
    "tahun": 365 * DAY_MS,
}


def parse_iso_ms(value: str) -> int | None:
    text = value.strip()
    if not text:
        return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        text += "T00:00:00+00:00"
    try:
        moment = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)
    return int(moment.timestamp() * 1000)


def parse_posted_at(value: str | float | None, *, observed_at: int) -> tuple[int | None, bool]:
    """Epoch ms and whether it came from relative text (`posted_at_relative`)."""
    if value is None or isinstance(value, bool):
        return None, False
    if isinstance(value, int | float):
        number = float(value)
        if number <= 0:
            return None, False
        return int(number if number > 1e11 else number * 1000), False
    text = value.strip()
    if not text:
        return None, False
    absolute = parse_iso_ms(text)
    if absolute is not None:
        return absolute, False
    lowered = text.lower()
    if re.search(r"\b(today|just now|hari ini|baru saja)\b", lowered):
        return observed_at, True
    if re.search(r"\b(yesterday|kemarin)\b", lowered):
        return observed_at - DAY_MS, True
    match = _RELATIVE.search(lowered)
    if match is not None:
        count = int(match.group("n")) if match.group("n") else 1
        return observed_at - count * _UNIT_MS[match.group("unit").lower()], True
    return None, False


# ---------------------------------------------------------------- the normalizer
def normalize(
    draft: PostingDraft,
    *,
    observed_at: int,
    company_fallback: str | None = None,
    page_url: str | None = None,
) -> NormalizedFields:
    flags: list[str] = []
    title = normalize_title(draft.title)
    company = clean(draft.company_name, 300) or clean(company_fallback, 300)
    locations, remote = locations_of(draft)
    workplace = workplace_of(draft, remote)
    employment = employment_of(draft.employment_type)
    salary = structured_salary(draft.salary) if draft.salary else None
    if salary is None and draft.salary_text:
        salary = parse_salary_text(draft.salary_text)
    description, truncated = description_of(draft)
    apply_raw = absolute_url(draft.apply_url, page_url)
    canonical_raw = absolute_url(draft.canonical_url, page_url)
    apply = canonical_url(apply_raw) if apply_raw else None
    canonical = canonical_url(canonical_raw) if canonical_raw else None
    posted_at, relative = parse_posted_at(draft.posted_at, observed_at=observed_at)
    if relative:
        flags.append("posted_at_relative")
    department = clean(draft.department, DEPARTMENT_MAX) or None
    seniority = clean(draft.seniority, SENIORITY_MAX) or None
    return NormalizedFields(
        title=title,
        company_name=company,
        company_domain=company_domain_of(draft, apply, page_url or canonical),
        locations=locations,
        workplace_type=workplace,
        employment_type=employment,
        salary=salary,
        description_text=description,
        description_truncated=truncated,
        requirements=requirements_of(draft),
        apply_url=apply,
        apply_domain=domain_of(apply) if apply else None,
        canonical_url=canonical,
        posted_at=posted_at,
        department=department,
        seniority=seniority,
        flags=flags,
    )


def first_str(values: Iterable[Any]) -> str | None:
    for value in values:
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return cast(list[Any], value)
    if isinstance(value, tuple):
        return list(cast(Sequence[Any], value))
    return [value]
