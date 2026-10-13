"""Response → error class mapping (15 §8), including challenge detection.

`classify_response()` turns a final HTTP response into `None` (usable) or a
`DiscoveryError`. A protection interstitial (Cloudflare challenge/Turnstile, DataDome,
PerimeterX, Akamai, Imperva, CAPTCHA walls) is `challenge_detected`: the source stops and
nothing is solved or bypassed (D-16). The heuristics look at known challenge script
hosts, `cf-chl` markers, response headers and page titles; a CAPTCHA *widget* alone (an
apply form with reCAPTCHA on a job page) only counts on an error status or a near-empty
page, so ordinary job pages are not mistaken for walls.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Final

from pilih_jobs.discovery.errors import DiscoveryError
from pilih_jobs.discovery.retry import parse_retry_after
from pilih_jobs.discovery.types import FetchPurpose

#: Markers that only appear on interstitial / challenge pages.
_STRONG_MARKERS: Final = (
    ("/cdn-cgi/challenge-platform/", "cloudflare_challenge"),
    ("cf-chl-", "cloudflare_challenge"),
    ("cf_chl_", "cloudflare_challenge"),
    ("challenges.cloudflare.com", "cloudflare_turnstile"),
    ("captcha-delivery.com", "datadome"),
    ("geo.captcha-delivery", "datadome"),
    ("px-captcha", "perimeterx"),
    ("_pxcaptcha", "perimeterx"),
    ("perimeterx.net", "perimeterx"),
    ("sec-if-cpt-container", "akamai"),
    ("sec-cpt-if", "akamai"),
    ("_incapsula_resource", "imperva"),
    ("incapsula incident", "imperva"),
)
#: CAPTCHA widgets: a wall only on an error status or a near-empty page.
_WIDGET_MARKERS: Final = (
    ("g-recaptcha", "recaptcha"),
    ("www.google.com/recaptcha", "recaptcha"),
    ("hcaptcha.com", "hcaptcha"),
    ("h-captcha", "hcaptcha"),
    ("cf-turnstile", "cloudflare_turnstile"),
)
#: Whole-title patterns of interstitials (anchored, so "Security Analyst" never matches).
_TITLE_PATTERNS: Final = (
    re.compile(r"^just a moment\W*$", re.IGNORECASE),
    re.compile(r"^attention required!?(?:\s*[|-]\s*cloudflare)?$", re.IGNORECASE),
    re.compile(r"^verify(?:ing)? (?:that )?you are (?:a )?human\W*$", re.IGNORECASE),
    re.compile(r"^are you a (?:robot|human)\W*$", re.IGNORECASE),
    re.compile(r"^access to this page has been denied\W*$", re.IGNORECASE),
    re.compile(r"^pardon our interruption\W*$", re.IGNORECASE),
    re.compile(r"^(?:ddos-guard|human verification|bot verification)\W*$", re.IGNORECASE),
)
_TITLE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_TAGS = re.compile(r"<[^>]+>")
_SCRIPT_STYLE = re.compile(r"<(script|style)\b.*?</\1\s*>", re.IGNORECASE | re.DOTALL)
_NEAR_EMPTY_TEXT = 1500
_SCAN_BYTES = 256 * 1024


def _header(headers: Mapping[str, str], name: str) -> str | None:
    wanted = name.lower()
    for key, value in headers.items():
        if key.lower() == wanted:
            return value
    return None


def _visible_text_length(html: str) -> int:
    stripped = _TAGS.sub(" ", _SCRIPT_STYLE.sub(" ", html))
    return len(" ".join(stripped.split()))


def detect_challenge(status: int, headers: Mapping[str, str], body: str) -> str | None:
    """The protection marker when this response is a challenge / bot wall, else None."""
    mitigated = (_header(headers, "cf-mitigated") or "").lower()
    if mitigated == "challenge":
        return "cloudflare_challenge"
    if not body:
        return None
    sample = body[:_SCAN_BYTES]
    lowered = sample.lower()
    for needle, marker in _STRONG_MARKERS:
        if needle in lowered:
            return marker
    title_match = _TITLE.search(sample)
    title = " ".join(title_match.group(1).split()) if title_match else ""
    if title and len(title) <= 120 and any(p.search(title) for p in _TITLE_PATTERNS):
        return "challenge_title"
    error_status = status >= 400
    for needle, marker in _WIDGET_MARKERS:
        if needle in lowered and (error_status or _visible_text_length(sample) < _NEAR_EMPTY_TEXT):
            return marker
    return None


def _looks_like_html(headers: Mapping[str, str], body: str) -> bool:
    content_type = (_header(headers, "content-type") or "").lower()
    if "html" in content_type:
        return True
    head = body[:512].lstrip().lower()
    return head.startswith(("<!doctype html", "<html"))


def classify_response(
    status: int,
    headers: Mapping[str, str],
    body: str,
    *,
    url: str,
    purpose: FetchPurpose,
    first_listing_page: bool = False,
    now_s: float = 0.0,
) -> DiscoveryError | None:
    """None for a usable response (2xx / 304), else the classified error (15 §8)."""
    if status == 304 or 200 <= status < 300:
        if purpose != "robots" and _looks_like_html(headers, body):
            marker = detect_challenge(status, headers, body)
            if marker is not None:
                return DiscoveryError(
                    "challenge_detected",
                    f"protection challenge on {url}",
                    http_status=status,
                    url=url,
                    marker=marker,
                )
        return None
    marker = detect_challenge(status, headers, body) if _looks_like_html(headers, body) else None
    if marker is None and (_header(headers, "cf-mitigated") or "").lower() == "challenge":
        marker = "cloudflare_challenge"
    if marker is not None:
        return DiscoveryError(
            "challenge_detected",
            f"protection challenge on {url}",
            http_status=status,
            url=url,
            marker=marker,
        )
    retry_after = parse_retry_after(_header(headers, "retry-after"), now_s=now_s)
    if status in (401, 403, 407, 451):
        return DiscoveryError(
            "access_denied", f"Access denied by {url}", http_status=status, url=url
        )
    if status == 429 or (status == 503 and retry_after is not None):
        return DiscoveryError(
            "rate_limited",
            f"rate limited by {url}",
            http_status=status,
            url=url,
            retry_after_s=retry_after,
        )
    if status >= 500:
        return DiscoveryError("http_5xx", f"server error {status}", http_status=status, url=url)
    if status in (404, 410):
        if first_listing_page:
            return DiscoveryError(
                "source_closed", "the board no longer exists", http_status=status, url=url
            )
        return DiscoveryError("not_found", "not found", http_status=status, url=url)
    return DiscoveryError(
        "unsupported_content", f"unexpected HTTP {status}", http_status=status, url=url
    )


# curl error codes (https://curl.se/libcurl/c/libcurl-errors.html)
_CURL_TIMEOUT: Final = frozenset({28})
_CURL_TOO_MANY_REDIRECTS: Final = 47


def classify_transport_error(code: int | None, message: str, *, url: str) -> DiscoveryError:
    """A transport failure (DNS, connect, TLS, timeout) → network / timeout / policy."""
    lowered = message.lower()
    if "ssrf" in lowered or "internal ip" in lowered:
        return DiscoveryError(
            "policy_blocked",
            "redirect to a private address refused (follow_redirects=safe)",
            url=url,
            retryable=False,
        )
    if (
        (code is not None and code in _CURL_TIMEOUT)
        or "timed out" in lowered
        or "timeout" in lowered
    ):
        return DiscoveryError("timeout", "request timed out", url=url)
    if code == _CURL_TOO_MANY_REDIRECTS:
        return DiscoveryError("unsupported_content", "too many redirects", url=url)
    return DiscoveryError("network", f"network error: {message[:200]}", url=url)
