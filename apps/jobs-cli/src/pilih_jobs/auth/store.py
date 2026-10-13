"""Credential storage (16 §11, 17 §12).

Secrets live in a `SecretStore`, never in `state.db` or plaintext files:

| Account                          | Content                                                |
|----------------------------------|--------------------------------------------------------|
| `<api-host>:<user_id>:refresh`   | OAuth refresh token (rotates on every refresh)         |
| `<api-host>:<user_id>:access`    | JSON `{token, expires_at, scopes}` access-token cache  |
| `<api-host>:<user_id>:device-key`| reserved for the DPoP key (17 §11; not created in v1)  |

Backends:

- `KeyringStore` — `keyring` service `pilih-jobs` (macOS Keychain, Windows Credential
  Locker, Secret Service). The null/fail backends and `keyrings.alt` plaintext backends
  are refused, so `login` fails loudly instead of dropping or exposing credentials.
- `EncryptedFileStore` — opt-in (`config set credentials.store encrypted-file` or
  `login --credential-store encrypted-file`): AES-256-GCM over the whole secret map, key
  from stdlib `hashlib.scrypt` (n=2^17, r=8, p=1). The passphrase is prompted once per
  process or read from `PILIH_JOBS_KEYRING_PASSPHRASE`.

Non-secret metadata (issuer, user id, email, device id/name, scopes) is in
`<config>/credentials.json` (mode 0600), keyed by issuer.
"""

from __future__ import annotations

import base64
import contextlib
import hashlib
import json
import os
import secrets
import threading
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Final, Protocol, cast
from urllib.parse import urlsplit

import keyring
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from keyring import errors as keyring_errors

from pilih_jobs.auth import KEYRING_SERVICE
from pilih_jobs.errors import CredentialStoreError
from pilih_jobs.paths import Paths, ensure_private_dir
from pilih_jobs.storage.locks import FileLock

PASSPHRASE_ENV: Final = "PILIH_JOBS_KEYRING_PASSPHRASE"  # noqa: S105 - env var name
SCRYPT_N: Final = 2**17
SCRYPT_R: Final = 8
SCRYPT_P: Final = 1
_SCRYPT_MAXMEM: Final = 256 * 1024 * 1024
_AAD: Final = b"pilih-jobs/credentials.enc/v1"


class SecretStore(Protocol):
    name: str

    def get(self, account: str) -> str | None: ...

    def set(self, account: str, value: str) -> None: ...

    def delete(self, account: str) -> None: ...


def api_host(issuer: str) -> str:
    """`api.pilihpendidikan.com` / `localhost:8788` — the account prefix of an issuer."""
    parts = urlsplit(issuer)
    return parts.netloc.lower() or issuer


def refresh_account(issuer: str, user_id: str) -> str:
    return f"{api_host(issuer)}:{user_id}:refresh"


def access_account(issuer: str, user_id: str) -> str:
    return f"{api_host(issuer)}:{user_id}:access"


def device_key_account(issuer: str, user_id: str) -> str:
    return f"{api_host(issuer)}:{user_id}:device-key"


# ------------------------------------------------------------------ keyring
def backend_problem(backend: object) -> str | None:
    """Why a keyring backend must not hold tokens, or None when it is acceptable."""
    cls: type[Any] = type(backend)
    module, name = cls.__module__, cls.__name__
    if module.startswith("keyring.backends.chainer"):
        children = cast(list[object], list(getattr(backend, "backends", []) or []))
        usable = [child for child in children if backend_problem(child) is None]
        return None if usable else "no secure keyring backend is available"
    if module.startswith(("keyring.backends.null", "keyring.backends.fail")):
        return "no secure keyring backend is available"
    if module.startswith("keyrings.alt") and "encrypted" not in name.lower():
        return f"the plaintext keyring backend {module}.{name} is never used"
    if "plaintext" in name.lower():
        return f"the plaintext keyring backend {module}.{name} is never used"
    priority = getattr(cls, "priority", 1)
    with contextlib.suppress(TypeError, ValueError):
        if float(priority) <= 0:  # pyright: ignore[reportArgumentType]
            return f"the keyring backend {module}.{name} is not usable here"
    return None


def backend_label(backend: object) -> str:
    cls = backend.__class__
    return f"{cls.__module__}.{cls.__qualname__}"


KEYRING_HELP: Final = (
    "No secure credential store is available, so pilih-jobs will not store tokens. Options:\n"
    "  - run inside a desktop session (macOS Keychain, Windows Credential Locker, "
    "GNOME Keyring/KWallet);\n"
    "  - on headless Linux, start a Secret Service: "
    "`dbus-run-session -- sh -c 'echo -n pass | gnome-keyring-daemon --unlock; "
    "pilih-jobs login'`;\n"
    "  - or opt in to the encrypted file store: "
    "`pilih-jobs login --credential-store encrypted-file`."
)


class KeyringStore:
    name = "keyring"

    def __init__(self, backend: Any | None = None) -> None:
        self._backend: Any = backend if backend is not None else keyring.get_keyring()
        problem = backend_problem(self._backend)
        if problem is not None:
            raise CredentialStoreError(
                f"Refusing to store credentials: {problem}.\n{KEYRING_HELP}",
                details={"backend": backend_label(self._backend)},
            )

    @property
    def backend_name(self) -> str:
        return backend_label(self._backend)

    def get(self, account: str) -> str | None:
        try:
            return cast(str | None, self._backend.get_password(KEYRING_SERVICE, account))
        except keyring_errors.KeyringError as exc:
            raise CredentialStoreError(f"The keyring could not be read: {exc}") from exc

    def set(self, account: str, value: str) -> None:
        try:
            self._backend.set_password(KEYRING_SERVICE, account, value)
        except keyring_errors.KeyringError as exc:
            raise CredentialStoreError(f"The keyring could not be written: {exc}") from exc

    def delete(self, account: str) -> None:
        try:
            self._backend.delete_password(KEYRING_SERVICE, account)
        except keyring_errors.PasswordDeleteError:
            return
        except keyring_errors.KeyringError as exc:
            raise CredentialStoreError(f"The keyring could not be written: {exc}") from exc


# ------------------------------------------------------------------ encrypted file
_key_cache: dict[tuple[str, bytes], bytes] = {}
_key_cache_lock = threading.Lock()


def derive_key(passphrase: str, salt: bytes, *, n: int = SCRYPT_N) -> bytes:
    return hashlib.scrypt(
        passphrase.encode("utf-8"),
        salt=salt,
        n=n,
        r=SCRYPT_R,
        p=SCRYPT_P,
        maxmem=_SCRYPT_MAXMEM,
        dklen=32,
    )


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")


def _unb64(text: object) -> bytes:
    if not isinstance(text, str):
        raise TypeError("expected base64 text")
    return base64.b64decode(text.encode("ascii"), validate=True)


PassphraseSource = Callable[[], str | None]


class EncryptedFileStore:
    """AES-GCM file store; never writes a secret unencrypted."""

    name = "encrypted-file"

    def __init__(
        self,
        path: Path,
        *,
        passphrase: PassphraseSource,
        scrypt_n: int = SCRYPT_N,
    ) -> None:
        self.path = path
        self._passphrase_source = passphrase
        self._n = scrypt_n
        self._lock = threading.Lock()
        # Worker and interactive commands may update the file concurrently.
        self._file_lock = FileLock(path.with_suffix(".enc.lock"))

    def _passphrase(self) -> str:
        value = self._passphrase_source()
        if not value:
            raise CredentialStoreError(
                "The encrypted credential file needs a passphrase: run interactively or set "
                f"{PASSPHRASE_ENV} (this moves the secret to the environment).",
                code="passphrase_required",
            )
        return value

    def _key(self, salt: bytes) -> bytes:
        passphrase = self._passphrase()
        cache_key = (hashlib.sha256(passphrase.encode("utf-8")).hexdigest() + str(self.path), salt)
        with _key_cache_lock:
            cached = _key_cache.get(cache_key)
            if cached is None:
                cached = derive_key(passphrase, salt, n=self._n)
                _key_cache[cache_key] = cached
            return cached

    def _read(self) -> tuple[dict[str, str], bytes | None]:
        if not self.path.exists():
            return {}, None
        try:
            envelope = cast(dict[str, Any], json.loads(self.path.read_text("utf-8")))
            kdf = cast(dict[str, Any], envelope["kdf"])
            if kdf.get("name") != "scrypt" or int(kdf.get("n", 0)) != self._n:
                raise CredentialStoreError("Unsupported credential file parameters.")
            salt = _unb64(kdf["salt"])
            nonce = _unb64(envelope["nonce"])
            ciphertext = _unb64(envelope["ciphertext"])
        except (OSError, ValueError, KeyError, TypeError) as exc:
            raise CredentialStoreError(f"The credential file {self.path} is unreadable.") from exc
        try:
            plaintext = AESGCM(self._key(salt)).decrypt(nonce, ciphertext, _AAD)
        except InvalidTag as exc:
            raise CredentialStoreError(
                "Wrong passphrase for the encrypted credential file (or the file was modified).",
                code="wrong_passphrase",
            ) from exc
        data = cast(dict[str, str], json.loads(plaintext.decode("utf-8")))
        return data, salt

    def _write(self, data: dict[str, str], salt: bytes | None) -> None:
        salt = salt or secrets.token_bytes(16)
        nonce = secrets.token_bytes(12)
        plaintext = json.dumps(data, separators=(",", ":"), sort_keys=True).encode("utf-8")
        ciphertext = AESGCM(self._key(salt)).encrypt(nonce, plaintext, _AAD)
        envelope = {
            "version": 1,
            "kdf": {
                "name": "scrypt",
                "n": self._n,
                "r": SCRYPT_R,
                "p": SCRYPT_P,
                "salt": _b64(salt),
            },
            "cipher": "AES-256-GCM",
            "nonce": _b64(nonce),
            "ciphertext": _b64(ciphertext),
        }
        ensure_private_dir(self.path.parent)
        tmp = self.path.with_suffix(".enc.tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(envelope, handle)
        tmp.replace(self.path)

    def get(self, account: str) -> str | None:
        with self._lock, self._file_lock.hold(timeout=30):
            data, _ = self._read()
            return data.get(account)

    def set(self, account: str, value: str) -> None:
        with self._lock, self._file_lock.hold(timeout=30):
            data, salt = self._read()
            data[account] = value
            self._write(data, salt)

    def delete(self, account: str) -> None:
        with self._lock, self._file_lock.hold(timeout=30):
            data, salt = self._read()
            if account in data:
                del data[account]
                if data:
                    self._write(data, salt)
                else:
                    with contextlib.suppress(FileNotFoundError):
                        self.path.unlink()


def env_passphrase() -> str | None:
    return os.environ.get(PASSPHRASE_ENV) or None


def select_store(
    store: str,
    paths: Paths,
    *,
    prompt_passphrase: PassphraseSource | None = None,
    keyring_backend: Any | None = None,
) -> SecretStore:
    """The configured store; raises CredentialStoreError when it is not usable."""
    if store == "encrypted-file":
        cached: list[str] = []

        def passphrase() -> str | None:
            if cached:
                return cached[0]
            value = env_passphrase() or (prompt_passphrase() if prompt_passphrase else None)
            if value:
                cached.append(value)
            return value

        return EncryptedFileStore(paths.credentials_encrypted, passphrase=passphrase)
    if store != "keyring":
        raise CredentialStoreError(f"Unknown credential store {store!r}.")
    return KeyringStore(keyring_backend)


# ------------------------------------------------------------------ credentials.json
@dataclass
class AccountMeta:
    issuer: str
    user_id: str
    email: str
    device_id: str | None
    device_name: str | None
    scopes: list[str] = field(default_factory=lambda: [])
    active_profile: str | None = None
    credential_store: str = "keyring"


class CredentialsFile:
    """`<config>/credentials.json` — no secrets, only what is needed to find them."""

    def __init__(self, path: Path) -> None:
        self.path = path

    def _load(self) -> dict[str, Any]:
        if not self.path.exists():
            return {"version": 1, "accounts": {}, "devices": {}}
        try:
            data = cast(dict[str, Any], json.loads(self.path.read_text("utf-8")))
        except (OSError, json.JSONDecodeError):
            return {"version": 1, "accounts": {}, "devices": {}}
        data.setdefault("accounts", {})
        data.setdefault("devices", {})
        return data

    def _save(self, data: dict[str, Any]) -> None:
        ensure_private_dir(self.path.parent)
        tmp = self.path.with_suffix(".json.tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2, sort_keys=True)
        tmp.replace(self.path)
        if os.name == "posix":
            self.path.chmod(0o600)

    def get(self, issuer: str) -> AccountMeta | None:
        raw = cast(dict[str, Any], self._load()["accounts"]).get(issuer)
        if not isinstance(raw, dict):
            return None
        entry = cast(dict[str, Any], raw)
        return AccountMeta(
            issuer=str(entry.get("issuer", issuer)),
            user_id=str(entry["user_id"]),
            email=str(entry.get("email", "")),
            device_id=cast(str | None, entry.get("device_id")),
            device_name=cast(str | None, entry.get("device_name")),
            scopes=[str(s) for s in cast(list[object], entry.get("scopes") or [])],
            active_profile=cast(str | None, entry.get("active_profile")),
            credential_store=str(entry.get("credential_store", "keyring")),
        )

    def put(self, meta: AccountMeta) -> None:
        data = self._load()
        data["accounts"][meta.issuer] = asdict(meta)
        if meta.device_id:
            data["devices"][meta.issuer] = {"device_id": meta.device_id, "user_id": meta.user_id}
        self._save(data)

    def remove(self, issuer: str, *, forget_device: bool = False) -> None:
        data = self._load()
        data["accounts"].pop(issuer, None)
        if forget_device:
            data["devices"].pop(issuer, None)
        self._save(data)

    def last_device(self, issuer: str, user_id: str | None = None) -> str | None:
        """The device id this machine last used with `issuer` (for `device_hint`, 17 §6)."""
        raw = cast(dict[str, Any], self._load()["devices"]).get(issuer)
        if not isinstance(raw, dict):
            return None
        entry = cast(dict[str, Any], raw)
        if user_id is not None and entry.get("user_id") not in (None, user_id):
            return None
        device = entry.get("device_id")
        return device if isinstance(device, str) else None
