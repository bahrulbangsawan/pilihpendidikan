"""Fixture ATS server (18 §13.2, 13 §4.1): a local Starlette app on a random loopback port.

It serves synthetic forms that mimic structural patterns of real ATSs (never copied
markup): single-page and multi-step forms, hidden file inputs, EEO sections, CAPTCHA
placeholders, login walls, off-domain redirects, popups, server-side validation errors,
confirmation and decoy pages, and the prompt-injection corpus (`injection.py`).

Chromium reaches the fixture hostnames through `--host-resolver-rules`
(`HOST_RESOLVER_RULES`): `*.test` and `challenges.cloudflare.com` map to 127.0.0.1.
"""

from tests.fixtures.ats_server.server import (
    APPLY_HOST,
    CAPTCHA_HOST,
    EVIL_HOST,
    HOST_RESOLVER_RULES,
    OTHER_HOST,
    PARTNER_HOST,
    FixtureServer,
    FixtureState,
)

__all__ = [
    "APPLY_HOST",
    "CAPTCHA_HOST",
    "EVIL_HOST",
    "HOST_RESOLVER_RULES",
    "OTHER_HOST",
    "PARTNER_HOST",
    "FixtureServer",
    "FixtureState",
]
