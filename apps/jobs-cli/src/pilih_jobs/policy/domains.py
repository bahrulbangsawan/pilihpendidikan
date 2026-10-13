"""The per-task domain allowlist and the navigation guard decision (18 §7.4, 19 §7).

The allowlist is derived from D1 data only — the posting's apply domain, the adapter's
known ATS hosts (15 §14) and the rule's `allowed_domains` — never from a model. A domain
the user accepts during an `off_domain_navigation` pause is added for this task only.
D-17 excluded platforms (LinkedIn, Indeed) are never allowed, whatever the lists say.

`check_navigation(url)`:

- `javascript:`, `file:`, `data:`, `chrome:`, `chrome-extension:`, `devtools:`,
  `view-source:` and other non-web schemes → blocked outright;
- `http(s)` on an allowlisted host → allowed, actions enabled;
- `http(s)` elsewhere → the navigation may complete **only to observe**: actions are
  disabled and the loop sees page kind `external_redirect` (assisted/approval pause
  `off_domain_navigation`, auto stops `domain_not_allowed`).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any, Final, Literal, cast
from urllib.parse import urlsplit

from pilih_jobs.contracts.adapters import (
    adapter_manifests,
    excluded_source_for_host,
    host_matches,
)
from pilih_jobs.contracts.psl import ascii_host, registrable_domain

#: Schemes a top-level navigation may use. `about:blank` is the empty start page only.
WEB_SCHEMES: Final = frozenset({"http", "https"})
BLOCKED_SCHEMES: Final = frozenset(
    {
        "javascript",
        "file",
        "data",
        "blob",
        "chrome",
        "chrome-extension",
        "chrome-untrusted",
        "devtools",
        "view-source",
        "edge",
        "brave",
        "filesystem",
        "ws",
        "wss",
        "ftp",
    }
)

NavReason = Literal["blocked_scheme", "excluded_platform", "off_allowlist", "invalid_url"]


@dataclass(frozen=True)
class NavDecision:
    """Whether a navigation may complete and whether the agent may act afterwards."""

    allowed: bool
    actions_enabled: bool
    reason: NavReason | None = None
    host: str | None = None
    domain: str | None = None


def url_host(url: str) -> str | None:
    """The ASCII host of an http(s) URL, or None."""
    try:
        parts = urlsplit(url.strip())
    except ValueError:
        return None
    if parts.scheme.lower() not in WEB_SCHEMES:
        return None
    return ascii_host(parts.hostname or "")


def url_scheme(url: str) -> str:
    head, sep, _ = url.strip().partition(":")
    return head.lower() if sep else ""


def domain_of(url_or_host: str) -> str | None:
    """Registrable domain of a URL or host (`jobs.acme.co.uk` → `acme.co.uk`)."""
    host = url_host(url_or_host) if "://" in url_or_host else ascii_host(url_or_host)
    if host is None:
        return None
    return registrable_domain(host) or host


def _clean_pattern(value: str) -> str | None:
    text = value.strip().lower().rstrip(".")
    if not text:
        return None
    if "://" in text:
        return url_host(text)
    if text.startswith("*."):
        text = text[2:]
    return ascii_host(text)


class DomainAllowlist:
    """Registrable domains and ATS host patterns this task may act on."""

    def __init__(self, patterns: Iterable[str] = ()) -> None:
        self._patterns: list[str] = []
        self._task_added: list[str] = []
        for value in patterns:
            self._add(value, self._patterns)

    # ------------------------------------------------------------------ building
    @classmethod
    def for_task(
        cls,
        *,
        apply_url: str | None,
        allowed_domains: Iterable[str] = (),
        adapter_id: str | None = None,
        ats_hosts: Iterable[str] = (),
        rule_domains: Iterable[str] = (),
    ) -> DomainAllowlist:
        """Posting apply domain + adapter ATS hosts + rule domains (18 §7.4)."""
        patterns: list[str] = []
        if apply_url:
            domain = domain_of(apply_url)
            if domain:
                patterns.append(domain)
        patterns.extend(allowed_domains)
        patterns.extend(ats_hosts)
        if adapter_id:
            manifest = adapter_manifests().get(adapter_id)
            if manifest is not None:
                patterns.extend(str(host) for host in manifest.automation.ats_hosts)
        patterns.extend(rule_domains)
        return cls(patterns)

    @classmethod
    def from_claim_context(cls, context: Mapping[str, Any]) -> DomainAllowlist:
        """Allowlist of an `apply` claim context (`ApplyTaskContext`, 21 §5.1)."""
        posting = cast(Mapping[str, Any], context.get("posting") or {})
        adapter = cast(Mapping[str, Any] | None, context.get("adapter"))
        adapter_id = str(adapter.get("id")) if adapter and adapter.get("id") else None
        return cls.for_task(
            apply_url=cast(str | None, posting.get("apply_url") or posting.get("url")),
            allowed_domains=[str(d) for d in cast(list[Any], context.get("allowed_domains") or [])],
            adapter_id=adapter_id,
        )

    def _add(self, value: str, target: list[str]) -> str | None:
        pattern = _clean_pattern(value)
        if pattern is None or excluded_source_for_host(pattern) is not None:
            return None
        if pattern not in target:
            target.append(pattern)
        return pattern

    def add_for_task(self, domain: str) -> str | None:
        """The user said "Allow <domain> for this application?" → yes (this task only)."""
        return self._add(domain, self._task_added)

    @property
    def patterns(self) -> list[str]:
        return [*self._patterns, *self._task_added]

    # ------------------------------------------------------------------ checks
    def allows_host(self, host: str | None) -> bool:
        normalized = ascii_host(host or "")
        if not normalized:
            return False
        if excluded_source_for_host(normalized) is not None:
            return False
        return any(host_matches(normalized, pattern) for pattern in self.patterns)

    def allows_url(self, url: str) -> bool:
        return self.allows_host(url_host(url))

    def allows_origin(self, origin: str) -> bool:
        return self.allows_url(origin if origin.endswith("/") else f"{origin}/")

    def check_navigation(self, url: str) -> NavDecision:
        """The navigation guard decision for a main-frame navigation or a popup."""
        text = url.strip()
        if text in ("about:blank", "about:srcdoc"):
            return NavDecision(allowed=True, actions_enabled=False)
        scheme = url_scheme(text)
        if scheme in BLOCKED_SCHEMES or (scheme and scheme not in WEB_SCHEMES):
            return NavDecision(allowed=False, actions_enabled=False, reason="blocked_scheme")
        host = url_host(text)
        if host is None:
            return NavDecision(allowed=False, actions_enabled=False, reason="invalid_url")
        domain = registrable_domain(host) or host
        if excluded_source_for_host(host) is not None:
            return NavDecision(
                allowed=True,
                actions_enabled=False,
                reason="excluded_platform",
                host=host,
                domain=domain,
            )
        if self.allows_host(host):
            return NavDecision(allowed=True, actions_enabled=True, host=host, domain=domain)
        return NavDecision(
            allowed=True, actions_enabled=False, reason="off_allowlist", host=host, domain=domain
        )
