"""The bundled adapter manifest (15 §14.1, D-20).

`data/adapters.json` is a copy of `packages/jobs-contracts/adapters.json`. The CLI refuses
adapters whose `min_cli_version` exceeds its own version, and the excluded sources
(LinkedIn, Indeed; D-17) are refused by host before any request.
"""

from __future__ import annotations

from functools import cache
from importlib import resources

from pilih_jobs.contracts._generated.adapters import (
    AdapterManifest,
    AdaptersFile,
    ExcludedSource,
)
from pilih_jobs.contracts.psl import ascii_host, registrable_domain
from pilih_jobs.version import __version__, is_below

__all__ = [
    "AdapterManifest",
    "ExcludedSource",
    "adapter_for_ats_host",
    "adapter_manifests",
    "excluded_source_for_host",
    "excluded_sources",
    "host_matches",
    "load_adapters_file",
    "usable_adapter",
]


@cache
def load_adapters_file() -> AdaptersFile:
    text = (
        resources.files("pilih_jobs.contracts").joinpath("data", "adapters.json").read_text("utf-8")
    )
    return AdaptersFile.model_validate_json(text)


def adapter_manifests() -> dict[str, AdapterManifest]:
    return {
        str(entry.id): entry
        for entry in load_adapters_file().adapters
        if isinstance(entry, AdapterManifest)
    }


def excluded_sources() -> list[ExcludedSource]:
    return [e for e in load_adapters_file().adapters if isinstance(e, ExcludedSource)]


def usable_adapter(adapter_id: str, cli_version: str = __version__) -> AdapterManifest | None:
    """The manifest when it exists, is not excluded and this CLI is new enough for it."""
    manifest = adapter_manifests().get(adapter_id)
    if manifest is None:
        return None
    if is_below(cli_version, str(manifest.min_cli_version)):
        return None
    return manifest


def host_matches(host: str, pattern: str) -> bool:
    """`host` equals `pattern` or is a subdomain of it; `name.*` matches any registrable
    domain whose first label is `name` (`indeed.*` → indeed.com, id.indeed.co.id)."""
    normalized = ascii_host(host)
    if normalized is None:
        return False
    if pattern.endswith(".*"):
        domain = registrable_domain(normalized)
        return domain is not None and domain.split(".")[0] == pattern[:-2]
    return normalized == pattern or normalized.endswith(f".{pattern}")


def excluded_source_for_host(url_or_host: str) -> ExcludedSource | None:
    """The D-17 exclusion covering a URL or host (`id.indeed.com` → indeed), if any."""
    host = ascii_host(url_or_host)
    if host is None:
        return None
    for source in excluded_sources():
        if any(host_matches(host, str(entry.root)) for entry in source.hosts):
            return source
    return None


def adapter_for_ats_host(url_or_host: str) -> str | None:
    """The ATS adapter id whose `automation.ats_hosts` include the host, if any."""
    host = ascii_host(url_or_host)
    if host is None:
        return None
    for adapter_id, manifest in adapter_manifests().items():
        if any(host_matches(host, pattern) for pattern in manifest.automation.ats_hosts):
            return adapter_id
    return None
