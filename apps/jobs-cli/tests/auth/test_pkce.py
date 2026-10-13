"""T17-09: PKCE verifier/challenge and state (RFC 7636, 17 §4.1)."""

from __future__ import annotations

import base64
import hashlib
import re

import pytest

from pilih_jobs.auth.pkce import VERIFIER_RE, code_challenge, generate_state, generate_verifier

UNRESERVED = re.compile(r"^[A-Za-z0-9\-._~]+$")


def test_T17_09_verifier_is_64_unreserved_characters() -> None:
    seen = set()
    for _ in range(200):
        verifier = generate_verifier()
        assert len(verifier) == 64
        assert UNRESERVED.match(verifier)
        seen.add(verifier)
    assert len(seen) == 200


def test_T17_09_rfc7636_appendix_b_test_vector() -> None:
    verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    assert code_challenge(verifier) == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"


def test_T17_09_challenge_is_unpadded_base64url_sha256() -> None:
    verifier = generate_verifier()
    challenge = code_challenge(verifier)
    assert len(challenge) == 43
    assert "=" not in challenge
    expected = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    )
    assert challenge == expected


@pytest.mark.parametrize("bad", ["short", "x" * 129, "has space" * 6, "ünïcode" * 8])
def test_T17_09_invalid_verifiers_are_rejected(bad: str) -> None:
    assert not VERIFIER_RE.match(bad)
    with pytest.raises(ValueError, match="verifier"):
        code_challenge(bad)


def test_T17_09_state_is_256_bit_base64url() -> None:
    state = generate_state()
    assert len(state) == 43
    assert UNRESERVED.match(state)
    assert generate_state() != state
