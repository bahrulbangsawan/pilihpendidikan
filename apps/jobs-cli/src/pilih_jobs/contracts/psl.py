"""Public Suffix List lookups over the vendored list (03 §4.2).

The list is `data/public_suffix_list.dat`, a byte copy of
`packages/jobs-contracts/psl/public_suffix_list.dat` (refreshed by
`scripts/gen_contracts.py`). Rules are compiled exactly like
`packages/jobs-contracts/scripts/lib/psl.ts`: each rule is read up to the first
whitespace, its `!` / `*.` prefix kept and its domain mapped with the URL Standard's
domain-to-ASCII, so the TypeScript and Python lookups agree byte for byte.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import cache
from importlib import resources
from typing import Final

from pilih_jobs.contracts.url import HostError, domain_to_ascii, js_trim, parse_url

_BEGIN_ICANN: Final = "// ===BEGIN ICANN DOMAINS==="
_END_ICANN: Final = "// ===END ICANN DOMAINS==="
_BEGIN_PRIVATE: Final = "// ===BEGIN PRIVATE DOMAINS==="
_END_PRIVATE: Final = "// ===END PRIVATE DOMAINS==="
_VERSION_LINE = re.compile(r"^// VERSION: (\S+)", re.MULTILINE)
_COMMIT_LINE = re.compile(r"^// COMMIT: (\S+)", re.MULTILINE)
_ASCII_RULE = re.compile(r"^[a-z0-9.-]+$")
_IPV4 = re.compile(r"^\d{1,3}(?:\.\d{1,3}){3}$")
_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*://", re.IGNORECASE)


@dataclass(frozen=True)
class CompiledPsl:
    version: str
    commit: str
    icann: tuple[str, ...]
    private: tuple[str, ...]


@dataclass(frozen=True)
class SuffixRules:
    exact: frozenset[str]
    exceptions: frozenset[str]
    wildcards: frozenset[str]  # `*.X` stored as `X`


def _ascii_rule(rule: str) -> str:
    prefix, domain = "", rule
    if domain.startswith("!"):
        prefix, domain = "!", domain[1:]
    elif domain.startswith("*."):
        prefix, domain = "*.", domain[2:]
    try:
        ascii_domain = domain_to_ascii(domain)
    except HostError as exc:
        raise ValueError(f'PSL rule "{rule}" does not map to ASCII') from exc
    via_url = parse_url(f"http://{domain}")
    if (
        ascii_domain == ""
        or via_url is None
        or via_url.hostname != ascii_domain
        or not _ASCII_RULE.match(ascii_domain)
    ):
        raise ValueError(f'PSL rule "{rule}" does not map to ASCII consistently')
    return prefix + ascii_domain


def compile_psl(dat: str) -> CompiledPsl:
    version = _VERSION_LINE.search(dat)
    commit = _COMMIT_LINE.search(dat)
    if version is None or commit is None:
        raise ValueError("PSL header lacks VERSION / COMMIT")
    icann: list[str] = []
    private: list[str] = []
    section: list[str] | None = None
    for raw_line in dat.split("\n"):
        line = js_trim(raw_line)
        if line == _BEGIN_ICANN:
            section = icann
        elif line == _BEGIN_PRIVATE:
            section = private
        elif line in (_END_ICANN, _END_PRIVATE):
            section = None
        elif section is not None and line != "" and not line.startswith("//"):
            section.append(_ascii_rule(line.split()[0]))
    if len(icann) < 5000 or len(private) < 1000:
        raise ValueError("PSL sections look truncated")
    return CompiledPsl(version.group(1), commit.group(1), tuple(icann), tuple(private))


def _compile_rules(*lists: tuple[str, ...]) -> SuffixRules:
    exact: set[str] = set()
    exceptions: set[str] = set()
    wildcards: set[str] = set()
    for rules in lists:
        for rule in rules:
            if rule.startswith("!"):
                exceptions.add(rule[1:])
            elif rule.startswith("*."):
                wildcards.add(rule[2:])
            elif rule:
                exact.add(rule)
    return SuffixRules(frozenset(exact), frozenset(exceptions), frozenset(wildcards))


@cache
def load_psl() -> CompiledPsl:
    text = (
        resources.files("pilih_jobs.contracts")
        .joinpath("data", "public_suffix_list.dat")
        .read_text(encoding="utf-8")
    )
    return compile_psl(text)


@cache
def _rules(include_private: bool) -> SuffixRules:
    psl = load_psl()
    return _compile_rules(psl.icann, psl.private) if include_private else _compile_rules(psl.icann)


def ascii_host(value: str | None) -> str | None:
    """Lowercase ASCII host of a domain or URL (`acme.com`, `https://x.acme.com/j`)."""
    trimmed = js_trim(value or "")
    if trimmed == "":
        return None
    parsed = parse_url(trimmed if _SCHEME.match(trimmed) else f"http://{trimmed}")
    if parsed is None:
        return None
    host = parsed.hostname.removesuffix(".")
    return host or None


def _is_ip_host(host: str) -> bool:
    return host.startswith("[") or _IPV4.match(host) is not None


def _host_labels(value: str | None) -> list[str] | None:
    host = ascii_host(value)
    if host is None or _is_ip_host(host):
        return None
    labels = host.split(".")
    return None if "" in labels else labels


def _public_suffix_length(labels: list[str], rules: SuffixRules) -> int:
    n = len(labels)
    for i in range(n):
        if ".".join(labels[i:]) in rules.exceptions:
            return n - i - 1
    longest = 1
    for i in range(n):
        exact = ".".join(labels[i:]) in rules.exact
        wildcard = i + 1 < n and ".".join(labels[i + 1 :]) in rules.wildcards
        if exact or wildcard:
            longest = max(longest, n - i)
    return longest


def public_suffix(value: str | None, *, include_private: bool = True) -> str | None:
    """The public suffix of a host, e.g. `co.uk` for `jobs.acme.co.uk`."""
    labels = _host_labels(value)
    if labels is None:
        return None
    length = _public_suffix_length(labels, _rules(include_private))
    return ".".join(labels[max(0, len(labels) - length) :])


def registrable_domain(value: str | None, *, include_private: bool = True) -> str | None:
    """Public suffix + one label (`acme.co.uk`); None for IPs, single labels and suffixes."""
    labels = _host_labels(value)
    if labels is None:
        return None
    length = _public_suffix_length(labels, _rules(include_private))
    if length >= len(labels):
        return None
    return ".".join(labels[len(labels) - length - 1 :])
