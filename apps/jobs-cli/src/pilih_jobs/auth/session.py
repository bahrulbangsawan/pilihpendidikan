"""Access tokens and refresh (17 §7).

`TokenManager` is the `TokenProvider` of the API client for OAuth device logins:

- the access token is kept in memory, cached in the secret store
  (`<host>:<user>:access` = `{token, expires_at, scopes}`) and discarded within 60 s of
  expiry;
- refreshes (`grant_type=refresh_token`) are serialized across processes by the
  `<data>/auth.lock` file lock and within the process by an asyncio lock. After taking
  the lock the manager re-reads the store: when another process already rotated the
  tokens it adopts them without a network call (the lock is what prevents false reuse
  detection, 17 §7.3);
- the rotated refresh token is persisted **before** anything else;
- `invalid_grant` (expired, revoked, reuse detected) signs the account out: secrets are
  deleted, the outbox is kept, and `NotAuthenticatedError` (exit 3) is raised;
  `on_signed_out` lets the runtime mark the account signed out (20 §5.3: outbox entries
  stay `pending`, re-sent after the next login only as the same user; the cache stays);
- only a **deleted account** is forgotten (11 §10 step 6): when the `401 invalid_token`
  that triggered the refresh carries `details.revoked_reason = "account_deleted"` and the
  refresh is refused with `invalid_grant`, every secret goes and `on_revoked` wipes the
  account's local data and metadata. A refresh made because the cached token expired
  locally has no 401 to read, so its refusal shows that token once to `GET /api/v1/me`
  and reads the same detail. Every other revocation (device revoked, sign-out elsewhere,
  refresh reuse), plain expiry, client errors and network failures wipe nothing.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any, Final, cast

from pilih_jobs.api.client import ApiClient
from pilih_jobs.api.errors import ApiAuthError, ApiError, NetworkError, OAuthError
from pilih_jobs.auth import CLIENT_ID
from pilih_jobs.auth.store import (
    AccountMeta,
    SecretStore,
    access_account,
    device_key_account,
    refresh_account,
)
from pilih_jobs.errors import NotAuthenticatedError
from pilih_jobs.logging import get_logger, log_event, token_hash
from pilih_jobs.storage.locks import FileLock

EXPIRY_MARGIN_MS: Final = 60_000
AUTH_LOCK_TIMEOUT_S: Final = 60.0
#: Refresh refusals that end the sign-in (only `invalid_grant` says the grant is dead).
REFUSED_GRANT_ERRORS: Final = ("invalid_grant", "invalid_client", "unauthorized_client")
#: Where a locally expired access token is shown to learn why the refresh was refused.
REVOCATION_PROBE_PATH: Final = "/api/v1/me"
#: `details.revoked_reason` of a deleted account's 401 — the only one that wipes.
ACCOUNT_DELETED: Final = "account_deleted"

_log = get_logger("auth.session")


def _now_ms() -> int:
    return time.time_ns() // 1_000_000


@dataclass(frozen=True)
class Rejection:
    """Why the server refused a bearer (`401 invalid_token`)."""

    reason: str | None
    revoked_reason: str | None


@dataclass(frozen=True)
class AccessToken:
    token: str
    expires_at: int
    scopes: tuple[str, ...]

    def valid(self, now_ms: int) -> bool:
        return self.expires_at - EXPIRY_MARGIN_MS > now_ms

    def to_json(self) -> str:
        return json.dumps(
            {"token": self.token, "expires_at": self.expires_at, "scopes": list(self.scopes)},
            separators=(",", ":"),
        )

    @classmethod
    def from_json(cls, raw: str | None) -> AccessToken | None:
        if not raw:
            return None
        try:
            data = cast(dict[str, Any], json.loads(raw))
            return cls(
                token=str(data["token"]),
                expires_at=int(data["expires_at"]),
                scopes=tuple(str(s) for s in cast(list[object], data.get("scopes") or [])),
            )
        except (ValueError, KeyError, TypeError):
            return None


def token_from_response(payload: dict[str, Any], now_ms: int) -> AccessToken:
    token = payload.get("access_token")
    if not isinstance(token, str) or not token:
        raise OAuthError("invalid_response", "The token endpoint returned no access_token.")
    expires_in = payload.get("expires_in")
    lifetime = int(expires_in) if isinstance(expires_in, int | float) else 3600
    scope = payload.get("scope")
    scopes = tuple(scope.split()) if isinstance(scope, str) else ()
    return AccessToken(token=token, expires_at=now_ms + lifetime * 1000, scopes=scopes)


class TokenManager:
    def __init__(
        self,
        *,
        client: ApiClient,
        account: AccountMeta,
        store: SecretStore,
        token_endpoint: str,
        auth_lock: FileLock,
        now_ms: Callable[[], int] = _now_ms,
        on_signed_out: Callable[[str], None] | None = None,
        on_revoked: Callable[[str], None] | None = None,
    ) -> None:
        self.client = client
        self.account = account
        self.store = store
        self.token_endpoint = token_endpoint
        self.auth_lock = auth_lock
        self._now = now_ms
        self._on_signed_out = on_signed_out
        self._on_revoked = on_revoked
        self._memory: AccessToken | None = None
        self._lock = asyncio.Lock()
        self.network_refreshes = 0

    @property
    def _access_key(self) -> str:
        return access_account(self.account.issuer, self.account.user_id)

    @property
    def _refresh_key(self) -> str:
        return refresh_account(self.account.issuer, self.account.user_id)

    @property
    def _device_key(self) -> str:
        return device_key_account(self.account.issuer, self.account.user_id)

    def _cached(self) -> AccessToken | None:
        return AccessToken.from_json(self.store.get(self._access_key))

    @property
    def scopes(self) -> tuple[str, ...]:
        if self._memory is not None:
            return self._memory.scopes
        return tuple(self.account.scopes)

    async def access_token(self) -> str:
        now = self._now()
        if self._memory is not None and self._memory.valid(now):
            return self._memory.token
        cached = self._cached()
        if cached is not None and cached.valid(now):
            self._memory = cached
            return cached.token
        return await self._refresh(stale=None, rejected=None)

    async def refresh_access_token(
        self, stale: str, *, reason: str | None = None, revoked_reason: str | None = None
    ) -> str:
        """After `401 invalid_token` (`reason`, `details.revoked_reason`): one refresh."""
        return await self._refresh(stale=stale, rejected=Rejection(reason, revoked_reason))

    def adopt(self, token: AccessToken) -> None:
        """Install a token obtained by `login` (also written to the store's cache)."""
        self._memory = token
        self.store.set(self._access_key, token.to_json())

    async def _refresh(self, stale: str | None, rejected: Rejection | None) -> str:
        """`rejected` describes the 401 when the server refused `stale`, else None."""
        async with self._lock:
            now = self._now()
            if self._memory is not None and self._memory.token != stale and self._memory.valid(now):
                return self._memory.token  # another coroutine refreshed meanwhile
            async with self.auth_lock.hold_async(timeout=AUTH_LOCK_TIMEOUT_S):
                cached = self._cached()
                if cached is not None and cached.token != stale and cached.valid(self._now()):
                    self._memory = cached  # another process refreshed while we waited
                    return cached.token
                return await self._network_refresh(rejected)

    async def _network_refresh(self, rejected: Rejection | None) -> str:
        refresh_token = self.store.get(self._refresh_key)
        if not refresh_token:
            self.sign_out("missing_refresh_token")
            raise NotAuthenticatedError("Not signed in. Run `pilih-jobs login`.")
        self.network_refreshes += 1
        try:
            payload = await self.client.oauth_form(
                self.token_endpoint,
                {
                    "grant_type": "refresh_token",
                    "refresh_token": refresh_token,
                    "client_id": CLIENT_ID,
                },
            )
        except OAuthError as exc:
            if exc.error in REFUSED_GRANT_ERRORS:
                deleted = exc.error == "invalid_grant" and await self._account_deleted(rejected)
                if deleted:
                    self._forget(exc.error)
                self.sign_out(exc.error)
                raise NotAuthenticatedError(
                    "Signed out: the refresh token is no longer valid (expired, revoked, or "
                    "reuse was detected). Run `pilih-jobs login`.",
                    details={"error": exc.error},
                ) from exc
            raise
        rotated = payload.get("refresh_token")
        if isinstance(rotated, str) and rotated:
            self.store.set(self._refresh_key, rotated)  # persist RT2 first (17 §7.3)
        token = token_from_response(payload, self._now())
        self.store.set(self._access_key, token.to_json())
        self._memory = token
        log_event(
            _log,
            "token_refreshed",
            "access token refreshed",
            token=token_hash(token.token),
            expires_at=token.expires_at,
        )
        return token.token

    async def _account_deleted(self, rejected: Rejection | None) -> bool:
        """Does the server say this credential's account was deleted (11 §10)?"""
        if rejected is not None:
            return rejected.revoked_reason == ACCOUNT_DELETED
        token = self._memory or self._cached()
        if token is None:
            return False
        try:
            await self.client.request(
                "GET",
                REVOCATION_PROBE_PATH,
                auth=False,
                headers={"Authorization": f"Bearer {token.token}"},
            )
        except ApiAuthError as exc:
            return exc.details.get("revoked_reason") == ACCOUNT_DELETED
        except (ApiError, NetworkError):
            return False
        return False

    def _forget(self, reason: str) -> None:
        """The account was deleted: drop the device key too, then its local data."""
        self.store.delete(self._device_key)
        log_event(
            _log,
            "account_deleted",
            "the account was deleted; its local data is removed",
            reason=reason,
        )
        if self._on_revoked is not None:
            self._on_revoked(reason)

    def sign_out(self, reason: str) -> None:
        """Delete the secrets of this account; `on_signed_out` marks it signed out (20 §5.3)."""
        self._memory = None
        for key in (self._access_key, self._refresh_key):
            self.store.delete(key)
        log_event(_log, "signed_out", "credentials removed", reason=reason)
        if self._on_signed_out is not None:
            self._on_signed_out(reason)
