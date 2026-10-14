"""SSRF guard of the cloud scraper (24 §9), plugged into `ScraplingJobEngine`.

Before every request attempt (robots.txt included) the target must be:

- `http` / `https`, on the default port (80 or 443), without credentials;
- a host that is not `localhost`, `*.local`, `*.internal` or `*.localhost`;
- resolvable, and **every** address it resolves to must be public unicast — no
  loopback, private (RFC 1918 / ULA), link-local, CGNAT (100.64/10), multicast,
  unspecified, reserved, the cloud metadata addresses, nor an IPv4-mapped / NAT64
  form of any of those.

Redirect hops are refused by curl when they point at a private address
(`follow_redirects="safe"`, forced by the engine policy) and the final URL is checked
again after the response, with the body size (≤ 5 MB).

Residual risk (documented in the README): curl resolves the host itself, so a DNS
answer that changes between this check and curl's connect (rebinding) is not caught at
the socket level; the post-response check re-resolves the final host.

`allowed_hosts` is a test-only allow-list of exact `host:port` pairs (local fixture
servers). Production code never sets it, and no environment variable can.
"""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable, Iterable
from typing import Any, Final
from urllib.parse import urlsplit

from pilih_jobs.discovery.errors import DiscoveryError

MAX_BODY_BYTES: Final = 5 * 1024 * 1024
DEFAULT_PORTS: Final = {"http": 80, "https": 443}
_BLOCKED_SUFFIXES: Final = (".localhost", ".local", ".internal", ".home.arpa", ".lan")
_BLOCKED_HOSTS: Final = frozenset({"localhost", "metadata", "metadata.google.internal"})
_METADATA: Final = frozenset(
    {
        ipaddress.ip_address("169.254.169.254"),
        ipaddress.ip_address("169.254.170.2"),
        ipaddress.ip_address("100.100.100.200"),
        ipaddress.ip_address("fd00:ec2::254"),
    }
)
_NAT64: Final = ipaddress.ip_network("64:ff9b::/96")
_CGNAT: Final = ipaddress.ip_network("100.64.0.0/10")

IpAddress = ipaddress.IPv4Address | ipaddress.IPv6Address
Resolver = Callable[[str, int], Iterable[str]]


def _system_resolver(host: str, port: int) -> list[str]:
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    out: list[str] = []
    for info in infos:
        address: Any = info[4][0]
        out.append(str(address))
    return out


def is_public_ip(address: IpAddress) -> bool:
    """Public unicast only (also unwraps IPv4-mapped and NAT64 addresses)."""
    if address in _METADATA:
        return False
    if isinstance(address, ipaddress.IPv6Address):
        mapped = address.ipv4_mapped
        if mapped is not None:
            return is_public_ip(mapped)
        if address in _NAT64:
            return is_public_ip(ipaddress.IPv4Address(int(address) & 0xFFFFFFFF))
        sixtofour = address.sixtofour
        if sixtofour is not None:
            return is_public_ip(sixtofour)
    elif address in _CGNAT:
        return False
    return (
        address.is_global
        and not address.is_multicast
        and not address.is_reserved
        and not address.is_loopback
        and not address.is_link_local
        and not address.is_unspecified
        and not address.is_private
    )


def _blocked(url: str, reason: str) -> DiscoveryError:
    return DiscoveryError(
        "policy_blocked", f"refused {reason}: {url[:200]}", url=url, retryable=False
    )


def check_url_shape(url: str) -> tuple[str, int]:
    """Scheme, port, credentials and host-name checks (no DNS). Returns (host, port)."""
    parts = urlsplit(url)
    scheme = parts.scheme.lower()
    if scheme not in DEFAULT_PORTS:
        raise _blocked(url, "a non-http(s) URL")
    if parts.username is not None or parts.password is not None:
        raise _blocked(url, "a URL with credentials")
    host = (parts.hostname or "").rstrip(".").lower()
    if not host:
        raise _blocked(url, "a URL without a host")
    try:
        port = parts.port or DEFAULT_PORTS[scheme]
    except ValueError as exc:
        raise _blocked(url, "a URL with an invalid port") from exc
    return host, port


class NetGuard:
    """`pilih_jobs.discovery.engine.NetworkGuard` for server-side fetching."""

    def __init__(
        self,
        *,
        allowed_hosts: frozenset[str] = frozenset(),
        resolver: Resolver | None = None,
        max_body_bytes: int = MAX_BODY_BYTES,
    ) -> None:
        self._allowed = allowed_hosts
        self._resolve: Resolver = resolver or _system_resolver
        self.max_body_bytes = max_body_bytes

    def _allowed_pair(self, host: str, port: int) -> bool:
        return f"{host}:{port}" in self._allowed

    def check_url(self, url: str) -> None:
        host, port = check_url_shape(url)
        if self._allowed_pair(host, port):
            return
        if port not in (80, 443):
            raise _blocked(url, f"port {port} (only 80 and 443)")
        if host in _BLOCKED_HOSTS or host.endswith(_BLOCKED_SUFFIXES):
            raise _blocked(url, "an internal host name")
        literal: IpAddress | None
        try:
            literal = ipaddress.ip_address(host.strip("[]"))
        except ValueError:
            literal = None
        if literal is not None:
            if not is_public_ip(literal):
                raise _blocked(url, "a non-public address")
            return
        try:
            addresses = list(self._resolve(host, port))
        except (OSError, UnicodeError) as exc:
            raise DiscoveryError("network", f"DNS resolution failed for {host}", url=url) from exc
        if not addresses:
            raise DiscoveryError("network", f"{host} has no addresses", url=url)
        for raw in addresses:
            try:
                address = ipaddress.ip_address(raw.split("%", 1)[0])
            except ValueError as exc:
                raise _blocked(url, "an unparsable resolved address") from exc
            if not is_public_ip(address):
                raise _blocked(url, f"a host resolving to a non-public address ({host})")

    def check_response(self, url: str, final_url: str, body_size: int) -> None:
        if body_size > self.max_body_bytes:
            raise DiscoveryError(
                "unsupported_content",
                f"response larger than {self.max_body_bytes // (1024 * 1024)} MB",
                url=final_url,
                retryable=False,
            )
        if final_url and final_url != url:
            self.check_url(final_url)
