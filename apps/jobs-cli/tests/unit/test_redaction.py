"""T11-REDACT: the logging redaction filter (16 §10, 11 §8, 17 §13).

Property tests (Hypothesis): no token, email or phone number survives redaction, in
messages, structured data, exceptions or third-party (httpx) records.
"""

from __future__ import annotations

import json
import logging
import secrets
import string
from pathlib import Path

from hypothesis import given, settings
from hypothesis import strategies as st

from pilih_jobs.logging import (
    REDACTED,
    StepLog,
    bind,
    field_value_log,
    get_logger,
    log_event,
    redact,
    redact_text,
    setup_logging,
    token_hash,
)
from pilih_jobs.paths import resolve_paths

TOKEN_ALPHABET = string.ascii_letters + string.digits + "-_"
tokens = st.text(alphabet=TOKEN_ALPHABET, min_size=43, max_size=64).filter(
    lambda t: (
        sum((any(c.isdigit() for c in t), any(c.isupper() for c in t), any(c.islower() for c in t)))
        >= 2
    )
)
local_parts = st.text(
    alphabet=string.ascii_lowercase + string.digits + "._", min_size=2, max_size=12
).filter(lambda s: s[0].isalnum() and not s.endswith("."))
domains = st.text(alphabet=string.ascii_lowercase, min_size=2, max_size=10)
emails = st.builds(
    lambda local, d, t: f"{local}@{d}.{t}",
    local_parts,
    domains,
    st.sampled_from(["com", "co.id", "org", "io"]),
)
phones = st.one_of(
    st.builds(lambda cc, n: f"+{cc}{n}", st.integers(1, 99), st.integers(10**8, 10**11 - 1)),
    st.builds(
        lambda a, b, c: f"0{a}-{b}-{c}",
        st.integers(812, 899),
        st.integers(1000, 9999),
        st.integers(1000, 9999),
    ),
    st.builds(lambda a, b: f"+62 812 {a} {b}", st.integers(1000, 9999), st.integers(1000, 9999)),
)
filler = st.text(alphabet=string.ascii_letters + " ,.:;!?()", max_size=30)


@settings(max_examples=150, deadline=None)
@given(token=tokens, before=filler, after=filler)
def test_T11_REDACT_bearer_tokens_never_survive(token: str, before: str, after: str) -> None:
    for text in (
        f"{before} Authorization: Bearer {token} {after}",
        f"{before} bearer {token}",
        f'{{"access_token": "{token}", "x": 1}}',
        f"https://api.test/oauth/callback?code={token}&state=abc",
        f"{before}{token}{after}",
    ):
        assert token not in redact_text(text)


@settings(max_examples=150, deadline=None)
@given(email=emails, before=filler, after=filler)
def test_T11_REDACT_emails_are_masked(email: str, before: str, after: str) -> None:
    out = redact_text(f"{before} {email} {after}")
    assert email not in out
    assert "***@" in out


@settings(max_examples=150, deadline=None)
@given(phone=phones, before=filler)
def test_T11_REDACT_phone_numbers_are_masked(phone: str, before: str) -> None:
    out = redact_text(f"{before} call {phone} today")
    assert phone not in out


@settings(max_examples=100, deadline=None)
@given(token=tokens, email=emails)
def test_T11_REDACT_structured_data_by_key_and_value(token: str, email: str) -> None:
    data = {
        "refresh_token": token,
        "Authorization": f"Bearer {token}",
        "code_verifier": token,
        "password": "hunter2",
        "cookies": [{"name": "sid", "value": token}],
        "nested": {"note": f"contact {email}", "items": [token]},
        "status_code": 401,
        "error_code": "invalid_grant",
        "state": "pending",
    }
    out = json.dumps(redact(data))
    assert token not in out
    assert email not in out
    assert "hunter2" not in out
    redacted = redact(data)
    assert redacted["status_code"] == 401
    assert redacted["error_code"] == "invalid_grant"
    assert redacted["state"] == "pending"
    assert redacted["password"] == REDACTED
    assert redacted["refresh_token"] == f"[redacted:sha256:{token_hash(token)}]"


def test_T11_REDACT_machine_codes_hashes_and_paths_are_kept() -> None:
    digest = "a" * 64
    text = (
        f'{{"code":"revision_conflict"}} fp1:{digest} '
        "/Users/someone/Library/Application/Support/x 2026-10-12 1791770000000"
    )
    out = redact_text(text)
    assert '"code":"revision_conflict"' in out
    assert digest in out
    assert "/Users/someone/Library" in out
    assert "2026-10-12" in out
    assert "1791770000000" in out


def test_T11_REDACT_oauth_state_and_lease_ids_are_hashed() -> None:
    state = secrets.token_urlsafe(32)
    out = redact({"state": state, "lease_id": "lse_01JA6V8M3W8Z1T6Q4Y2B7K9C00"})
    assert out["state"] == f"[redacted:sha256:{token_hash(state)}]"
    assert out["lease_id"].startswith("[redacted:sha256:")


def test_T11_REDACT_field_values_are_logged_as_source_and_length() -> None:
    assert field_value_log("f12", "fact:contact.phone", "+6281234567890") == {
        "field_ref": "f12",
        "value_source": "fact:contact.phone",
        "len": 14,
    }


def test_T11_REDACT_filter_covers_messages_data_exceptions_and_httpx(home: Path) -> None:
    paths = resolve_paths()
    setup_logging(paths, level="debug")
    token = secrets.token_urlsafe(32)
    log = get_logger("test")
    log_event(
        log, "login", f"exchanged code {token}", refresh_token=token, email="alice@example.com"
    )
    log.info("bearer %s for %s", f"Bearer {token}", "bob@example.org")
    try:
        raise RuntimeError(f"failed with Authorization: Bearer {token}")
    except RuntimeError:
        log.exception("boom")
    logging.getLogger("httpx").warning(
        "HTTP Request: POST https://api.test/oauth/token?code=%s", token
    )
    with bind(run_id="run_01JA6V8M3W8Z1T6Q4Y2B7K9C00", lease_id="lse_01JA6V8M3W8Z1T6Q4Y2B7K9C00"):
        log_event(log, "step", "inside run")
    for handler in logging.getLogger("pilih_jobs").handlers:
        handler.flush()
    content = paths.log_file.read_text()
    assert token not in content
    assert "alice@example.com" not in content
    assert "bob@example.org" not in content
    lines = [json.loads(line) for line in content.splitlines()]
    assert {"ts", "level", "event", "msg", "device_id"} <= set(lines[0])
    step = next(line for line in lines if line["event"] == "step")
    assert step["run_id"] == "run_01JA6V8M3W8Z1T6Q4Y2B7K9C00"
    assert step["lease_id_hash"] == token_hash("lse_01JA6V8M3W8Z1T6Q4Y2B7K9C00")
    assert "lse_01JA6V8M3W8Z1T6Q4Y2B7K9C00" not in content


def test_T11_REDACT_step_log_writes_redacted_jsonl(tmp_path: Path) -> None:
    token = secrets.token_urlsafe(40)
    log = StepLog(tmp_path / "runs" / "att_x" / "steps.jsonl")
    entry = log.write(
        "fill", value=field_value_log("f1", "fact:contact.email", "a@b.co"), note=f"t={token}"
    )
    assert token not in json.dumps(entry)
    assert token not in log.path.read_text()


def test_T11_REDACT_httpcore_header_tuples_and_cookie_headers() -> None:
    text = (
        "receive_response_headers.complete return_value=(b'HTTP/1.1', 200, b'OK', "
        "[(b'Content-Type', b'application/json'), "
        "(b'Set-Cookie', b'__Host-session=s3cr3tv4lue; Path=/')])"
    )
    out = redact_text(text)
    assert "s3cr3tv4lue" not in out
    assert "(b'Content-Type', b'application/json')" in out
    assert "s3cr3t" not in redact_text("Cookie: __Host-session=s3cr3t; other=1")
