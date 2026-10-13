"""PKCE S256 (RFC 7636) and the OAuth `state` (17 §4.1, §13)."""

from __future__ import annotations

import base64
import hashlib
import re
import secrets
from typing import Final

#: RFC 7636 §4.1 unreserved characters, 43–128 long.
VERIFIER_RE: Final = re.compile(r"^[A-Za-z0-9\-._~]{43,128}$")
VERIFIER_LENGTH: Final = 64


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def generate_verifier() -> str:
    """64 characters from `secrets.token_urlsafe(48)` (base64url ⊂ RFC 7636 unreserved)."""
    verifier = secrets.token_urlsafe(48)
    if len(verifier) != VERIFIER_LENGTH or not VERIFIER_RE.match(verifier):
        raise RuntimeError("unexpected PKCE verifier shape")  # pragma: no cover
    return verifier


def code_challenge(verifier: str) -> str:
    """`BASE64URL(SHA256(ASCII(verifier)))` — 43 characters."""
    if not VERIFIER_RE.match(verifier):
        raise ValueError("invalid PKCE verifier")
    return b64url(hashlib.sha256(verifier.encode("ascii")).digest())


def generate_state() -> str:
    """256-bit state, `secrets.token_urlsafe(32)` (43 characters)."""
    return secrets.token_urlsafe(32)
