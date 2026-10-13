"""Shared helpers for CLI tests (signing in against the fake API, running commands)."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from pilih_jobs.auth.session import AccessToken
from pilih_jobs.auth.store import AccountMeta, access_account, refresh_account
from pilih_jobs.contracts import ids
from pilih_jobs.runtime import Runtime
from tests.support.fake_api import FakeApi


def sign_in(
    rt: Runtime,
    fake: FakeApi,
    user_id: str,
    scopes: list[str] | None = None,
    *,
    expires_in_ms: int = 3_600_000,
) -> AccountMeta:
    """Store credentials as `pilih-jobs login` would, without the browser round trip."""
    access, refresh = fake.issue_tokens(user_id, scopes, expires_in_ms=expires_in_ms)
    token = fake.tokens[access]
    device_id = token.device_id(fake)
    store = rt.secret_store()
    meta = AccountMeta(
        issuer=rt.issuer,
        user_id=user_id,
        email=fake.users[user_id].email,
        device_id=device_id,
        device_name=fake.devices[device_id]["name"] if device_id else None,
        scopes=list(token.scopes),
        credential_store=store.name,
    )
    store.set(refresh_account(rt.issuer, user_id), refresh)
    store.set(
        access_account(rt.issuer, user_id),
        AccessToken(
            access, token.expires_at or ids.now_ms() + expires_in_ms, tuple(token.scopes)
        ).to_json(),
    )
    rt.credentials.put(meta)
    rt.db.upsert_account(rt.issuer, user_id, device_id)
    return meta


_ANSI = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


@dataclass
class CliResult:
    code: int
    stdout: str
    stderr: str

    def __post_init__(self) -> None:
        self.stdout = _ANSI.sub("", self.stdout)
        self.stderr = _ANSI.sub("", self.stderr)

    @property
    def json(self) -> Any:
        lines = [line for line in self.stdout.splitlines() if line.strip()]
        return json.loads(lines[-1])

    @property
    def ndjson(self) -> list[Any]:
        return [json.loads(line) for line in self.stdout.splitlines() if line.strip()]
