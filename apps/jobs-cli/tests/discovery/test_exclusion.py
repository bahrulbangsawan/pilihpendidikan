"""T15-EXCLUSION / S-29: LinkedIn and Indeed are refused before any request (D-17)."""

from __future__ import annotations

import pytest

from pilih_jobs.adapters import get_adapter
from pilih_jobs.discovery.engine import ScraplingJobEngine
from pilih_jobs.discovery.errors import DiscoveryError, ExcludedSourceError
from pilih_jobs.discovery.sources import parse_source_arg
from pilih_jobs.discovery.types import FetchMode, FetchRequest, SourceRef

EXCLUDED_URLS = [
    "https://www.linkedin.com/jobs/view/3812345678",
    "https://linkedin.com/company/acme/jobs",
    "https://lnkd.in/abc",
    "https://id.indeed.com/viewjob?jk=123",
    "https://www.indeed.co.uk/jobs?q=nurse",
    "https://uk.indeed.com/cmp/acme",
]


@pytest.mark.parametrize("adapter_id", ["linkedin", "indeed", "LinkedIn"])
def test_T15_EXCLUSION_registry_refuses(adapter_id: str) -> None:
    with pytest.raises(ExcludedSourceError) as caught:
        get_adapter(adapter_id)
    assert caught.value.code == "unsupported_source"
    assert caught.value.exit == 9


@pytest.mark.parametrize("url", EXCLUDED_URLS)
def test_T15_EXCLUSION_custom_url_host_check(url: str) -> None:
    with pytest.raises(ExcludedSourceError):
        get_adapter("custom_url").validate_config({"url": url})
    with pytest.raises(ExcludedSourceError):
        parse_source_arg(f"career_page:{url}")


def test_T15_EXCLUSION_source_arguments() -> None:
    for arg in ("linkedin:acme", "indeed:acme"):
        with pytest.raises(ExcludedSourceError):
            parse_source_arg(arg)
    assert parse_source_arg("greenhouse:acme") == ("greenhouse", "acme")


async def test_T15_EXCLUSION_engine_never_fetches_excluded_hosts(
    engine: ScraplingJobEngine,
) -> None:
    source = SourceRef(key="x", adapter_id="custom_url", org="linkedin.com")
    for url in EXCLUDED_URLS:
        with pytest.raises(DiscoveryError) as caught:
            await engine.fetch(FetchRequest(url, FetchMode.STATIC_HTML), source=source)
        assert caught.value.error_class == "policy_blocked"
    assert engine.requests == []
