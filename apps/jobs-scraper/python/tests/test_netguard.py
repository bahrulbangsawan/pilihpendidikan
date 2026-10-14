"""SSRF guard (24 §9): public unicast only, default ports, no credentials."""

from __future__ import annotations

import ipaddress
from pathlib import Path

import pytest
from pilih_jobs.discovery.errors import DiscoveryError

from pilih_scraper.fetching import EngineFactory
from pilih_scraper.netguard import NetGuard, is_public_ip
from tests.support import Site, VirtualClock, run, scrape_body


def _guard(*addresses: str) -> NetGuard:
    return NetGuard(resolver=lambda _host, _port: list(addresses))


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.1.2.3",
        "172.16.0.9",
        "192.168.1.1",
        "169.254.169.254",
        "100.64.0.1",
        "0.0.0.0",
        "224.0.0.1",
        "::1",
        "fc00::1",
        "fe80::1",
        "fd00:ec2::254",
        "::ffff:127.0.0.1",
        "::ffff:10.0.0.1",
        "64:ff9b::a00:1",
        "2002:7f00:1::",
    ],
)
def test_non_public_addresses(address: str) -> None:
    assert not is_public_ip(ipaddress.ip_address(address))


@pytest.mark.parametrize("address", ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"])
def test_public_addresses(address: str) -> None:
    assert is_public_ip(ipaddress.ip_address(address))


@pytest.mark.parametrize(
    ("url", "fragment"),
    [
        ("ftp://jobs.example/feed", "non-http"),
        ("https://user:pw@jobs.example/feed", "credentials"),
        ("https://jobs.example:8443/feed", "port 8443"),
        ("http://localhost/feed", "internal host"),
        ("http://metadata.google.internal/computeMetadata/v1/", "internal host"),
        ("http://printer.local/", "internal host"),
        ("http://169.254.169.254/latest/meta-data/", "non-public"),
        ("http://[::1]/", "non-public"),
    ],
)
def test_refused_urls(url: str, fragment: str) -> None:
    with pytest.raises(DiscoveryError) as caught:
        _guard("93.184.216.34").check_url(url)
    assert caught.value.error_class == "policy_blocked"
    assert not caught.value.retryable
    assert fragment in caught.value.detail


def test_host_resolving_to_a_private_address() -> None:
    guard = _guard("93.184.216.34", "10.0.0.5")  # any private answer refuses the host
    with pytest.raises(DiscoveryError) as caught:
        guard.check_url("https://rebind.example/jobs")
    assert caught.value.error_class == "policy_blocked"


def test_public_host_passes_and_dns_failure_is_network() -> None:
    _guard("93.184.216.34").check_url("https://jobs.example/feed")

    def failing(_host: str, _port: int) -> list[str]:
        raise OSError("no such host")

    with pytest.raises(DiscoveryError) as caught:
        NetGuard(resolver=failing).check_url("https://nx.example/feed")
    assert caught.value.error_class == "network"


def test_response_checks_size_and_final_url() -> None:
    guard = _guard("93.184.216.34")
    guard.check_response("https://a.example/", "https://a.example/", 10)
    with pytest.raises(DiscoveryError) as too_big:
        guard.check_response("https://a.example/", "https://a.example/", 6 * 1024 * 1024)
    assert too_big.value.error_class == "unsupported_content"
    with pytest.raises(DiscoveryError):
        guard.check_response("https://a.example/", "http://localhost/admin", 10)


async def test_fixture_server_is_refused_without_the_test_allowlist(
    tmp_path: Path, site: Site
) -> None:
    factory = EngineFactory(data_dir=tmp_path / "d", guard=NetGuard(), clock=VirtualClock())
    site.xml("/feed", "<rss/>")
    body = scrape_body("rss", {"url": site.url("/feed"), "title_pattern": "title"})
    response = await run(factory, body)
    assert response["error"]["error_class"] == "policy_blocked"
    assert site.hits("/feed") == 0
    assert site.hits("/robots.txt") == 0


async def test_redirect_to_a_private_address_is_refused(site: Site, factory: EngineFactory) -> None:
    site.raw("/feed", "", 302, Location="http://127.0.0.1:9/internal")
    body = scrape_body("rss", {"url": site.url("/feed"), "title_pattern": "title"})
    response = await run(factory, body)
    assert response["error"]["error_class"] == "policy_blocked"
