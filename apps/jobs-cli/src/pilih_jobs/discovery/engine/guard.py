"""Optional network guard of `ScraplingJobEngine` (server-side callers only, 24 §9).

The CLI never sets one: a user's machine fetches what its user configured. A server-side
caller (the cloud scraper, `apps/jobs-scraper`) passes a guard that refuses private,
loopback, link-local and metadata addresses before every request attempt (robots.txt
included) and re-checks the final URL after redirects. A guard refuses by raising a
`DiscoveryError` (normally `policy_blocked`), which is never retried.
"""

from __future__ import annotations

from typing import Protocol


class NetworkGuard(Protocol):
    def check_url(self, url: str) -> None:
        """Raise `DiscoveryError` to refuse `url` before any network I/O."""
        ...

    def check_response(self, url: str, final_url: str, body_size: int) -> None:
        """Raise `DiscoveryError` to discard a response (final URL after redirects, size)."""
        ...
