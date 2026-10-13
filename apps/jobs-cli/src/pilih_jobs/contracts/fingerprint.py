"""Posting fingerprints (`fp1`, 03 §4.2), content hashes and dedupe groups.

A line-by-line port of `packages/jobs-contracts/src/fingerprint.ts`; both must
reproduce `packages/jobs-contracts/test-vectors/fingerprint.json` and
`canonical-url.json` byte for byte (the server recomputes fingerprints and marks a
mismatch `invalid`, 20 §7).
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Final
from urllib.parse import unquote_to_bytes

from pilih_jobs.contracts.psl import ascii_host, registrable_domain
from pilih_jobs.contracts.url import ParsedUrl, js_trim, parse_url

FINGERPRINT_PREFIX: Final = "fp1:"

#: Source kinds whose postings carry a stable job id (03 §4.2).
STABLE_SOURCE_KINDS: Final = (
    "greenhouse",
    "lever",
    "ashby",
    "smartrecruiters",
    "workable",
    "workday",
)

#: Query parameters dropped as tracking, besides any `utm_*` (03 §4.2).
TRACKING_PARAMS: Final = frozenset({"gh_src", "lever-source", "ref", "source", "fbclid", "gclid"})

# Unicode White_Space, exactly as WHITESPACE_RUN in fingerprint.ts.
_WHITESPACE_RUN = re.compile("[\t\n\v\f\r \u0085   -     　]+")
_SPACE_RUN = re.compile(" {2,}")
_KEPT: Final = frozenset("+#./-")
_HEX: Final = frozenset("0123456789abcdefABCDEF")


def _strip_char(ch: str) -> bool:
    if ch in _KEPT:
        return False
    category = unicodedata.category(ch)
    return category[0] in "PS" or category in ("Cc", "Cf")


def normalize_text(value: str | None) -> str:
    """NFKC → lowercase → collapse White_Space → trim → strip P*/S*/Cc/Cf except `+#./-`."""
    if not value:
        return ""
    text = unicodedata.normalize("NFKC", value).lower()
    text = _WHITESPACE_RUN.sub(" ", text).strip(" ")
    text = "".join(ch for ch in text if not _strip_char(ch))
    return _SPACE_RUN.sub(" ", text).strip(" ")


def _decode_component(raw: str) -> str:
    """`decodeURIComponent(raw.replace(/\\+/g, " "))`, returning raw where JS would throw."""
    text = raw.replace("+", " ")
    i = 0
    while i < len(text):
        if text[i] == "%":
            if i + 2 >= len(text) or text[i + 1] not in _HEX or text[i + 2] not in _HEX:
                return raw
            i += 3
        else:
            i += 1
    try:
        return unquote_to_bytes(text).decode("utf-8")
    except UnicodeDecodeError:
        return raw


def _is_tracking_param(raw_name: str) -> bool:
    name = _decode_component(raw_name).lower()
    return name.startswith("utm_") or name in TRACKING_PARAMS


def _canonical_query(search: str) -> str:
    raw = search[1:] if search.startswith("?") else search
    kept: list[tuple[str, str]] = []
    for segment in raw.split("&"):
        if segment == "":
            continue
        eq = segment.find("=")
        name = segment if eq == -1 else segment[:eq]
        if not _is_tracking_param(name):
            kept.append((name, segment))
    # The serialized query is ASCII, so Python's str order is the code-unit order.
    kept.sort()
    return "&".join(segment for _, segment in kept)


def _parse_http_url(value: str | None) -> ParsedUrl | None:
    if not value:
        return None
    parsed = parse_url(js_trim(value))
    if parsed is None or parsed.scheme not in ("http", "https") or parsed.hostname == "":
        return None
    return parsed


def canonical_url(value: str | None) -> str | None:
    """`scheme://host[:port]path[?sorted non-tracking query]` for http(s), else None."""
    url = _parse_http_url(value)
    if url is None:
        return None
    port = f":{url.port}" if url.port else ""
    query = _canonical_query(url.search)
    return f"{url.scheme}://{url.hostname}{port}{url.pathname}{'?' + query if query else ''}"


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class FingerprintInput:
    source_kind: str
    title: str
    source_org: str | None = None
    source_job_ref: str | None = None
    company_domain: str | None = None
    location_primary: str | None = None
    apply_url: str | None = None
    canonical_url: str | None = None


def posting_domain(
    *,
    company_domain: str | None = None,
    apply_url: str | None = None,
    canonical_url: str | None = None,
) -> str:
    """Registrable domain of company_domain → apply_url → canonical_url (host if none)."""
    host = ascii_host(company_domain)
    if host is None:
        parsed = _parse_http_url(apply_url) or _parse_http_url(canonical_url)
        host = parsed.hostname if parsed is not None else None
    if not host:
        return ""
    clean = host.removesuffix(".")
    return registrable_domain(clean) or clean


def fingerprint_key(posting: FingerprintInput) -> str:
    org = normalize_text(posting.source_org)
    ref = js_trim(posting.source_job_ref or "")
    if posting.source_kind in STABLE_SOURCE_KINDS and org != "" and ref != "":
        return f"src|{posting.source_kind}|{org}|{ref}"
    url = canonical_url(posting.apply_url) or canonical_url(posting.canonical_url) or ""
    domain = posting_domain(
        company_domain=posting.company_domain,
        apply_url=posting.apply_url,
        canonical_url=posting.canonical_url,
    )
    return "|".join(
        [
            "gen",
            domain,
            normalize_text(posting.title),
            normalize_text(posting.location_primary),
            url,
        ]
    )


def fingerprint(posting: FingerprintInput) -> str:
    """`fp1:` + sha256_hex(utf8(key))."""
    return FINGERPRINT_PREFIX + sha256_hex(fingerprint_key(posting))


def legacy_fingerprint_key(user_id: str, legacy_id: str) -> str:
    return f"legacy|{user_id}|{legacy_id}"


def legacy_fingerprint(user_id: str, legacy_id: str) -> str:
    return FINGERPRINT_PREFIX + sha256_hex(legacy_fingerprint_key(user_id, legacy_id))


def content_hash(title: str, description_text: str) -> str:
    """`sha256_hex(normalize(title) + "\\n" + normalize(description_text))`."""
    return sha256_hex(f"{normalize_text(title)}\n{normalize_text(description_text)}")


def dedupe_group_key(
    *, title: str, company_domain: str | None = None, location_primary: str | None = None
) -> str | None:
    host = ascii_host(company_domain)
    if host is None:
        return None
    domain = registrable_domain(host) or host
    return f"{domain}|{normalize_text(title)}|{normalize_text(location_primary)}"


def dedupe_group(
    *, title: str, company_domain: str | None = None, location_primary: str | None = None
) -> str | None:
    """Cross-source duplicate key (15 §11); None without a company domain."""
    key = dedupe_group_key(
        title=title, company_domain=company_domain, location_primary=location_primary
    )
    return None if key is None else sha256_hex(key)


def primary_location(locations: Sequence[dict[str, object]] | None) -> str:
    """`locations[0].raw` or "" (the primary location of 03 §4.2)."""
    if not locations:
        return ""
    raw = locations[0].get("raw")
    return raw if isinstance(raw, str) else ""
