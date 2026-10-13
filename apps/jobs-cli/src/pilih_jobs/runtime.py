"""`Runtime`: one object that wires paths, config, `state.db`, the clock, credentials,
the API client and the sync engine for a command or the worker.

Every command group (and the worker, discovery and agent code of the other leaves) gets
its collaborators from here instead of constructing them, so precedence rules, the
credential store choice, the corrected clock and the version gate are applied the same
way everywhere::

    rt = Runtime.create(api_url=None, config_file=None)
    async with rt.api_client() as api:
        me = await api.get("/api/v1/me")
    rt.close()
"""

from __future__ import annotations

import contextlib
import os
from collections.abc import AsyncGenerator, Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, cast

import httpx

from pilih_jobs.api.client import ApiClient, StaticToken, TokenProvider
from pilih_jobs.auth.metadata import CACHE_MS as METADATA_CACHE_MS
from pilih_jobs.auth.session import TokenManager
from pilih_jobs.auth.store import AccountMeta, CredentialsFile, SecretStore, select_store
from pilih_jobs.clock import ClockSync
from pilih_jobs.config import Config, LoadedConfig, load_config
from pilih_jobs.errors import NotAuthenticatedError
from pilih_jobs.logging import get_logger, log_event, set_device_id
from pilih_jobs.paths import Paths, resolve_paths
from pilih_jobs.storage.db import StateDB
from pilih_jobs.storage.locks import FileLock
from pilih_jobs.sync.identity import wipe_account_data

TOKEN_ENV = "PILIH_JOBS_TOKEN"  # noqa: S105 - env var name

_log = get_logger("runtime")


@dataclass
class Runtime:
    paths: Paths
    loaded: LoadedConfig
    interactive: bool = False
    personal_token: str | None = None
    prompt_passphrase: Callable[[], str | None] | None = None
    keyring_backend: Any | None = None
    notice: Callable[[str], None] | None = None
    #: Test hook: route every API client through this transport (an in-process fake).
    transport: httpx.AsyncBaseTransport | None = None
    _db: StateDB | None = field(default=None, repr=False)
    _clock: ClockSync | None = field(default=None, repr=False)
    _store: SecretStore | None = field(default=None, repr=False)

    # ------------------------------------------------------------------ construction
    @classmethod
    def create(
        cls,
        *,
        api_url: str | None = None,
        config_file: str | None = None,
        flags: Mapping[str, Any] | None = None,
        env: Mapping[str, str] | None = None,
        interactive: bool = False,
        personal_token: str | None = None,
        prompt_passphrase: Callable[[], str | None] | None = None,
        notice: Callable[[str], None] | None = None,
    ) -> Runtime:
        environ = os.environ if env is None else env
        paths = resolve_paths(config_file)
        merged: dict[str, Any] = dict(flags or {})
        if api_url is not None:
            merged["api.url"] = api_url
        loaded = load_config(paths, flags=merged, env=environ)
        token = personal_token or environ.get(TOKEN_ENV) or None
        return cls(
            paths=paths,
            loaded=loaded,
            interactive=interactive,
            personal_token=token,
            prompt_passphrase=prompt_passphrase,
            notice=notice,
        )

    @property
    def config(self) -> Config:
        return self.loaded.config

    @property
    def issuer(self) -> str:
        return self.config.api.url

    @property
    def db(self) -> StateDB:
        if self._db is None:
            self.paths.ensure()
            self._db = StateDB(self.paths.state_db)
        return self._db

    @property
    def clock(self) -> ClockSync:
        if self._clock is None:
            self._clock = ClockSync(db=self.db, issuer=self.issuer).install()
        return self._clock

    @property
    def credentials(self) -> CredentialsFile:
        return CredentialsFile(self.paths.credentials_meta)

    def account(self) -> AccountMeta | None:
        return self.credentials.get(self.issuer)

    def secret_store(self, store: str | None = None) -> SecretStore:
        name = store or self.config.credentials.store
        if self._store is not None and self._store.name == name:
            return self._store
        self._store = select_store(
            name,
            self.paths,
            prompt_passphrase=self.prompt_passphrase,
            keyring_backend=self.keyring_backend,
        )
        return self._store

    @property
    def auth_lock(self) -> FileLock:
        return FileLock(self.paths.auth_lock)

    @property
    def state_lock(self) -> FileLock:
        return FileLock(self.paths.state_lock)

    def token_endpoint(self) -> str:
        """From the cached RFC 8414 metadata; `<issuer>/oauth/token` otherwise."""
        raw = self.db.cached(f"oauth_metadata:{self.issuer}", METADATA_CACHE_MS * 30)
        if isinstance(raw, dict):
            endpoint = cast(dict[str, Any], raw).get("token_endpoint")
            if isinstance(endpoint, str):
                return endpoint
        return f"{self.issuer}/oauth/token"

    # ------------------------------------------------------------------ API access
    def new_client(
        self, *, tokens: TokenProvider | None = None, version_gate: bool = True
    ) -> ApiClient:
        return ApiClient(
            self.issuer,
            tokens=tokens,
            clock=self.clock,
            db=self.db,
            transport=self.transport,
            version_gate=version_gate,
            on_notice=self.notice,
        )

    def token_manager(self, client: ApiClient) -> TokenManager:
        account = self.account()
        if account is None:
            raise NotAuthenticatedError()
        set_device_id(account.device_id)
        return TokenManager(
            client=client,
            account=account,
            store=self.secret_store(account.credential_store),
            token_endpoint=self.token_endpoint(),
            auth_lock=self.auth_lock,
            on_signed_out=lambda reason: self.mark_signed_out(account, reason=reason),
            on_revoked=lambda reason: self.forget_deleted_account(account, reason=reason),
        )

    def mark_signed_out(self, account: AccountMeta, *, reason: str) -> None:
        """The refresh was refused (20 §5.3): the account is signed out, nothing is wiped.

        `TokenManager` has deleted its secrets; the `credentials.json` entry goes too, so
        `status` says signed out. The outbox stays `pending` (re-sent after the next login
        as the same user — `login` as another user quarantines it), the cache and the
        account binding in `state.db` stay, and the device hint is kept.
        """
        current = self.credentials.get(account.issuer)
        if current is not None and current.user_id == account.user_id:
            self.credentials.remove(account.issuer)
        set_device_id(None)
        log_event(_log, "signed_out_by_server", "the sign-in ended", reason=reason)

    def forget_deleted_account(self, account: AccountMeta, *, reason: str) -> None:
        """The account was deleted (401 `revoked_reason: account_deleted`, 11 §10 step 6).

        `TokenManager` deletes its secrets; here its `state.db` data (cache, seen postings,
        outbox, cursor, binding), staged uploads and `credentials.json` entry (device hint
        included) go, so `status` reports signed out with nothing cached.
        """
        counts = wipe_account_data(
            self.db, account.issuer, account.user_id, upload_root=self.paths.data_dir
        )
        current = self.credentials.get(account.issuer)
        if current is not None and current.user_id == account.user_id:
            self.credentials.remove(account.issuer, forget_device=True)
        set_device_id(None)
        log_event(
            _log,
            "account_data_wiped",
            "local data of a revoked account removed",
            reason=reason,
            kept_other_user=counts is None,
            **(counts or {}),
        )

    def authenticated_client(
        self, *, version_gate: bool = True, allow_personal_token: bool = True
    ) -> ApiClient:
        """A client with the OAuth device login (or `PILIH_JOBS_TOKEN` for read-only work)."""
        if self.account() is None and self.personal_token and allow_personal_token:
            return self.new_client(
                tokens=StaticToken(self.personal_token), version_gate=version_gate
            )
        client = self.new_client(version_gate=version_gate)
        client.tokens = self.token_manager(client)
        return client

    @contextlib.asynccontextmanager
    async def api_client(
        self, *, auth: bool = True, version_gate: bool = True, allow_personal_token: bool = True
    ) -> AsyncGenerator[ApiClient]:
        client = (
            self.authenticated_client(
                version_gate=version_gate, allow_personal_token=allow_personal_token
            )
            if auth
            else self.new_client(version_gate=version_gate)
        )
        try:
            yield client
        finally:
            await client.aclose()

    def close(self) -> None:
        if self._db is not None:
            self._db.close()
            self._db = None
