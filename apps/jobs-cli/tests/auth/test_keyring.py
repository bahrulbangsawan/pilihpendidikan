"""T17-11 / TCLI-KEYRING: credential stores (16 §11, 17 §12)."""

from __future__ import annotations

import json
import os
import re
import stat
from collections.abc import Callable
from pathlib import Path

import pytest
from keyring.backends import fail, null

from pilih_jobs.auth.store import (
    CredentialsFile,
    EncryptedFileStore,
    KeyringStore,
    access_account,
    api_host,
    backend_problem,
    device_key_account,
    refresh_account,
    select_store,
)
from pilih_jobs.errors import CredentialStoreError
from pilih_jobs.paths import resolve_paths
from pilih_jobs.runtime import Runtime
from tests.support.fake_api import FakeApi, fake_browser
from tests.support.helpers import CliResult
from tests.support.keyring_backends import MemoryKeyring

FAST_N = 2**10  # tests only; production is fixed at 2**17


class PlaintextKeyring(MemoryKeyring):
    """Mimics keyrings.alt.file.PlaintextKeyring by name."""


def test_TCLI_KEYRING_account_layout() -> None:
    issuer = "https://api.pilihpendidikan.com"
    assert api_host(issuer) == "api.pilihpendidikan.com"
    assert api_host("http://localhost:8788") == "localhost:8788"
    assert refresh_account(issuer, "usr_1") == "api.pilihpendidikan.com:usr_1:refresh"
    assert access_account(issuer, "usr_1") == "api.pilihpendidikan.com:usr_1:access"
    assert device_key_account(issuer, "usr_1") == "api.pilihpendidikan.com:usr_1:device-key"


def test_T17_11_fake_backend_round_trip() -> None:
    backend = MemoryKeyring()
    store = KeyringStore(backend)
    store.set("h:usr_1:refresh", "rt-value")
    assert store.get("h:usr_1:refresh") == "rt-value"
    assert backend.store[("pilih-jobs", "h:usr_1:refresh")] == "rt-value"
    store.delete("h:usr_1:refresh")
    store.delete("h:usr_1:refresh")  # idempotent
    assert store.get("h:usr_1:refresh") is None


@pytest.mark.parametrize(
    "backend",
    [null.Keyring(), fail.Keyring(), PlaintextKeyring()],
    ids=["null", "fail", "plaintext"],
)
def test_T17_11_insecure_backends_are_refused(backend: object) -> None:
    assert backend_problem(backend) is not None
    with pytest.raises(CredentialStoreError, match="Refusing to store credentials"):
        KeyringStore(backend)


def test_T17_11_null_backend_makes_login_refuse(
    cli: Callable[..., CliResult], fake_api: FakeApi, monkeypatch: pytest.MonkeyPatch
) -> None:
    original = Runtime.create

    def create(**kwargs: object) -> Runtime:
        rt = original(**kwargs)  # type: ignore[arg-type]
        rt.keyring_backend = null.Keyring()
        return rt

    monkeypatch.setattr(Runtime, "create", create)
    result = cli("--json", "login", "--no-browser")
    assert result.code == 1
    assert result.json["error"]["code"] == "credential_store_unavailable"
    assert "encrypted-file" in result.json["error"]["message"]
    assert fake_api.requests == []  # refused before any network call


def test_T17_11_encrypted_file_requires_a_passphrase(tmp_path: Path) -> None:
    store = EncryptedFileStore(
        tmp_path / "credentials.enc", passphrase=lambda: None, scrypt_n=FAST_N
    )
    with pytest.raises(CredentialStoreError, match="passphrase") as info:
        store.set("a", "secret")
    assert info.value.code == "passphrase_required"
    assert not (tmp_path / "credentials.enc").exists()


def test_T17_11_encrypted_file_round_trip_and_wrong_passphrase(tmp_path: Path) -> None:
    path = tmp_path / "credentials.enc"
    store = EncryptedFileStore(path, passphrase=lambda: "correct horse", scrypt_n=FAST_N)
    store.set("h:usr_1:refresh", "rt-secret-value")
    store.set("h:usr_1:access", '{"token":"at-secret"}')
    assert store.get("h:usr_1:refresh") == "rt-secret-value"
    raw = path.read_bytes()
    assert b"rt-secret-value" not in raw
    assert b"at-secret" not in raw
    envelope = json.loads(raw)
    assert envelope["cipher"] == "AES-256-GCM"
    assert envelope["kdf"]["name"] == "scrypt"
    if os.name == "posix":
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
    wrong = EncryptedFileStore(path, passphrase=lambda: "wrong", scrypt_n=FAST_N)
    with pytest.raises(CredentialStoreError) as info:
        wrong.get("h:usr_1:refresh")
    assert info.value.code == "wrong_passphrase"
    store.delete("h:usr_1:refresh")
    store.delete("h:usr_1:access")
    assert not path.exists()


def test_T17_11_encrypted_file_production_kdf_parameters(
    tmp_path: Path, home: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("PILIH_JOBS_KEYRING_PASSPHRASE", "env passphrase")
    store = select_store("encrypted-file", resolve_paths())
    assert isinstance(store, EncryptedFileStore)
    store.set("k", "v")
    kdf = json.loads(store.path.read_text())["kdf"]
    assert (kdf["n"], kdf["r"], kdf["p"]) == (2**17, 8, 1)
    assert store.get("k") == "v"


def test_TCLI_KEYRING_credentials_file_has_no_secrets(tmp_path: Path) -> None:
    from pilih_jobs.auth.store import AccountMeta

    path = tmp_path / "config" / "credentials.json"
    creds = CredentialsFile(path)
    creds.put(
        AccountMeta("https://api.test", "usr_1", "a@b.co", "dev_1", "Mac (macOS)", ["jobs:read"])
    )
    assert creds.get("https://api.test").device_id == "dev_1"
    assert creds.last_device("https://api.test") == "dev_1"
    creds.remove("https://api.test")
    assert creds.get("https://api.test") is None
    assert creds.last_device("https://api.test") == "dev_1"  # kept for device_hint on re-login
    creds.remove("https://api.test", forget_device=True)
    assert creds.last_device("https://api.test") is None
    if os.name == "posix":
        assert stat.S_IMODE(path.stat().st_mode) == 0o600


TOKEN_PATTERN = re.compile(rb"[A-Za-z0-9_-]{40,}")


async def test_T17_11_nothing_plaintext_on_disk_after_login(
    runtime: Runtime, fake_api: FakeApi, user_id: str, keyring_backend: MemoryKeyring
) -> None:
    from pilih_jobs.auth.flow import LoginOptions, login

    browser = fake_browser(fake_api, user_id)
    await login(runtime, LoginOptions(open_browser=browser, capabilities=[]))
    secrets = {v for (_, k), v in keyring_backend.store.items() if k.endswith(":refresh")}
    secrets |= {
        json.loads(v)["token"]
        for (_, k), v in keyring_backend.store.items()
        if k.endswith(":access")
    }
    assert len(secrets) == 2
    runtime.db.conn.execute("PRAGMA wal_checkpoint(FULL)")
    for root in (
        runtime.paths.config_dir,
        runtime.paths.data_dir,
        runtime.paths.cache_dir,
        runtime.paths.log_dir,
    ):
        for path in root.rglob("*"):
            if path.is_file():
                content = path.read_bytes()
                for secret in secrets:
                    assert secret.encode() not in content, f"token found in {path}"
