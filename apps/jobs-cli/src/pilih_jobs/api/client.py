"""The typed async client for `apps/api` (05 §1, 16 §12, 17 §7).

- `httpx.AsyncClient`, HTTP/2 off, explicit timeouts (connect 10 s, read 30 s; 20 §5.3).
- Every request carries `User-Agent: pilih-jobs/<semver> (<os>; <arch>) python/… playwright/…
  scrapling/…` and `X-Pilih-Client: cli/<semver>` (05 §1.7).
- Every POST/PUT/PATCH/DELETE carries an `Idempotency-Key` (05 §1.4): the caller's (the
  outbox passes the entry's stable key) or a fresh ULID.
- `401 invalid_token` → exactly one refresh through the `TokenProvider` (which serializes
  refreshes under `auth.lock`), then the same request is retried with the same key. The
  401's `reason` and `details.revoked_reason` go with it: a refused refresh after
  `revoked_reason: account_deleted` wipes the account's local data (11 §10 step 6).
- `426 cli_upgrade_required` → `ApiUpgradeRequiredError` (exit 10) and a kv flag the worker
  reads to stop claiming; `/api/v1/meta` is checked once per process (cached 6 h).
- The error envelope becomes a typed exception (`api.errors`) with the 16 §3.2 exit code.
- Request logging goes through httpx event hooks: method, URL with the query string
  stripped on `/oauth/*`, status and duration — never headers or bodies.
"""

from __future__ import annotations

import contextlib
import json
import time
from collections.abc import AsyncGenerator, Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any, Final, Protocol, cast
from urllib.parse import urlsplit, urlunsplit

import httpx

from pilih_jobs.api.errors import (
    ApiAuthError,
    ApiError,
    ApiUpgradeRequiredError,
    NetworkError,
    OAuthError,
    error_from_response,
)
from pilih_jobs.clock import ClockSync
from pilih_jobs.contracts import ids
from pilih_jobs.errors import NotAuthenticatedError, UpgradeRequiredError
from pilih_jobs.logging import get_logger, log_event
from pilih_jobs.storage.db import StateDB
from pilih_jobs.version import __version__, client_header, is_below, user_agent

DEFAULT_TIMEOUT: Final = httpx.Timeout(connect=10.0, read=30.0, write=30.0, pool=10.0)
MUTATING: Final = frozenset({"POST", "PUT", "PATCH", "DELETE"})
META_PATH: Final = "/api/v1/meta"
META_CACHE_KEY: Final = "meta"
META_CACHE_MS: Final = 6 * 3600 * 1000
UPGRADE_FLAG_KEY: Final = "upgrade_required"

_log = get_logger("api")


class TokenProvider(Protocol):
    """Supplies bearer tokens; `auth.session.TokenManager` is the OAuth implementation."""

    async def access_token(self) -> str: ...

    async def refresh_access_token(
        self, stale: str, *, reason: str | None = None, revoked_reason: str | None = None
    ) -> str:
        """Return a fresh token (one refresh per stale token) or raise NotAuthenticatedError.

        `reason` and `revoked_reason` are the `reason` and `details.revoked_reason` of the
        `401 invalid_token` that rejected `stale` (None when the response had none).
        """
        ...


class StaticToken:
    """A fixed bearer (personal token from `PILIH_JOBS_TOKEN` / `--token-stdin`, 17 §12.1)."""

    def __init__(self, token: str) -> None:
        self._token = token

    async def access_token(self) -> str:
        return self._token

    async def refresh_access_token(
        self, stale: str, *, reason: str | None = None, revoked_reason: str | None = None
    ) -> str:
        raise NotAuthenticatedError(
            "The personal token was rejected. Create a new one at /connect or run "
            "`pilih-jobs login`."
        )


@dataclass
class ApiResponse:
    status: int
    data: Any
    headers: httpx.Headers
    replayed: bool = False

    @property
    def request_id(self) -> str | None:
        data: Any = self.data
        if isinstance(data, dict):
            value = cast(dict[str, Any], data).get("request_id")
            if isinstance(value, str):
                return value
        return self.headers.get("x-request-id")


@dataclass
class MetaInfo:
    api_version: str
    min_cli_version: str
    recommended_cli_version: str
    features: list[str] = field(default_factory=lambda: [])

    @property
    def upgrade_required(self) -> bool:
        return is_below(__version__, self.min_cli_version)

    @property
    def upgrade_recommended(self) -> bool:
        return is_below(__version__, self.recommended_cli_version)


def _log_url(url: httpx.URL) -> str:
    """URL for logs: the query string is dropped on `/oauth/*` (17 §13) and redacted elsewhere."""
    parts = urlsplit(str(url))
    if parts.path.startswith("/oauth/") or parts.path.startswith("/.well-known/"):
        return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))


async def _on_request(request: httpx.Request) -> None:
    request.extensions["pilih_started"] = time.monotonic()


async def _on_response(response: httpx.Response) -> None:
    started = response.request.extensions.get("pilih_started")
    elapsed = int((time.monotonic() - started) * 1000) if isinstance(started, float) else None
    log_event(
        _log,
        "http",
        f"{response.request.method} {_log_url(response.request.url)} -> {response.status_code}",
        level=10,  # DEBUG
        method=response.request.method,
        url=_log_url(response.request.url),
        status=response.status_code,
        duration_ms=elapsed,
    )


class ApiClient:
    """One client per process (or per worker loop); close it with `aclose()`."""

    def __init__(
        self,
        base_url: str,
        *,
        tokens: TokenProvider | None = None,
        clock: ClockSync | None = None,
        db: StateDB | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: httpx.Timeout = DEFAULT_TIMEOUT,
        version_gate: bool = True,
        on_notice: Callable[[str], None] | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.tokens = tokens
        self.clock = clock
        self.db = db
        self.version_gate = version_gate
        self.on_notice = on_notice
        self.meta: MetaInfo | None = None
        self._gate_checked = False
        self._http = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=timeout,
            http2=False,
            follow_redirects=False,
            transport=transport,
            headers={"User-Agent": user_agent(), "X-Pilih-Client": client_header()},
            event_hooks={"request": [_on_request], "response": [_on_response]},
        )

    @property
    def issuer(self) -> str:
        return self.base_url

    @property
    def http(self) -> httpx.AsyncClient:
        return self._http

    async def aclose(self) -> None:
        await self._http.aclose()

    async def __aenter__(self) -> ApiClient:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.aclose()

    # ------------------------------------------------------------------ version gate
    async def get_meta(self, *, force: bool = False) -> MetaInfo | None:
        """`GET /api/v1/meta` (cached 6 h in kv); None when the server is unreachable."""
        cached: Any = None
        if self.db is not None and not force:
            cached = self.db.cached(META_CACHE_KEY, META_CACHE_MS)
        payload: Any = cached
        if payload is None:
            try:
                response = await self._send("GET", META_PATH, auth=False)
            except (NetworkError, ApiError):
                return None
            payload = response.data
            if self.clock is not None:
                self.clock.observe_http_date(response.headers.get("date"))
            if self.db is not None and isinstance(payload, dict):
                self.db.kv_put_cached(META_CACHE_KEY, payload)
        if not isinstance(payload, dict):
            return None
        body = cast(dict[str, Any], payload)
        self.meta = MetaInfo(
            api_version=str(body.get("api_version", "v1")),
            min_cli_version=str(body.get("min_cli_version", "0.0.0")),
            recommended_cli_version=str(body.get("recommended_cli_version", "0.0.0")),
            features=[str(f) for f in cast(list[object], body.get("features") or [])],
        )
        return self.meta

    async def ensure_compatible(self) -> None:
        """16 §12: below `min_cli_version` every gated command exits 10."""
        if self._gate_checked or not self.version_gate:
            return
        self._gate_checked = True
        meta = await self.get_meta()
        if meta is None:
            return  # offline: the server's 426 remains the backstop
        if meta.upgrade_required:
            self._flag_upgrade(meta.min_cli_version)
            raise UpgradeRequiredError(
                f"pilih-jobs {__version__} is below the minimum supported version "
                f"{meta.min_cli_version}.",
                details={"current": __version__, "min_cli_version": meta.min_cli_version},
                hint="pilih-jobs update",
            )
        if meta.upgrade_recommended and self.on_notice is not None:
            self.on_notice(
                f"pilih-jobs {meta.recommended_cli_version} is available "
                f"(you have {__version__}). Run `pilih-jobs update`."
            )

    def _flag_upgrade(self, minimum: str | None) -> None:
        if self.db is not None:
            self.db.kv_set_json(
                UPGRADE_FLAG_KEY,
                {"current": __version__, "min_cli_version": minimum, "at": ids.now_ms()},
            )

    def upgrade_required(self) -> bool:
        """True after a 426 or a failed version gate (the worker stops claiming)."""
        if self.db is None:
            return False
        flag = self.db.kv_get_json(UPGRADE_FLAG_KEY)
        return isinstance(flag, dict) and cast(dict[str, Any], flag).get("current") == __version__

    # ------------------------------------------------------------------ requests
    async def _bearer(self) -> str | None:
        if self.tokens is None:
            raise NotAuthenticatedError()
        return await self.tokens.access_token()

    async def _send(
        self,
        method: str,
        path: str,
        *,
        json_body: Any = None,
        params: Mapping[str, Any] | None = None,
        idempotency_key: str | None = None,
        auth: bool = True,
        headers: Mapping[str, str] | None = None,
        files: Any = None,
        data: Mapping[str, Any] | None = None,
        content: bytes | None = None,
    ) -> ApiResponse:
        method = method.upper()
        request_headers: dict[str, str] = dict(headers or {})
        if method in MUTATING:
            request_headers["Idempotency-Key"] = idempotency_key or ids.new_ulid()
        token = await self._bearer() if auth else None
        for attempt in range(2):
            if token is not None:
                request_headers["Authorization"] = f"Bearer {token}"
            try:
                response = await self._http.request(
                    method,
                    path,
                    json=json_body if files is None and data is None and content is None else None,
                    params=_clean_params(params),
                    headers=request_headers,
                    files=files,
                    data=data,
                    content=content,
                )
            except httpx.TransportError as exc:
                raise NetworkError(
                    f"Cannot reach {self.base_url}: {type(exc).__name__}",
                    details={"path": path.split("?", 1)[0]},
                ) from exc
            if response.status_code == 401 and auth and attempt == 0 and self.tokens is not None:
                stale = token or ""
                reason, revoked_reason = _rejection(response)
                token = await self.tokens.refresh_access_token(
                    stale, reason=reason, revoked_reason=revoked_reason
                )
                continue
            return self._finish(response)
        raise AssertionError("unreachable")  # pragma: no cover

    def _finish(self, response: httpx.Response) -> ApiResponse:
        payload: Any = None
        if response.content:
            content_type = response.headers.get("content-type", "")
            if "json" in content_type:
                try:
                    payload = response.json()
                except json.JSONDecodeError:
                    payload = None
            else:
                payload = response.content
        if response.is_success:
            return ApiResponse(
                status=response.status_code,
                data=payload,
                headers=response.headers,
                replayed=response.headers.get("idempotent-replayed") == "true",
            )
        error = error_from_response(response.status_code, payload, dict(response.headers))
        if isinstance(error, ApiUpgradeRequiredError):
            minimum = error.details.get("min_cli_version")
            self._flag_upgrade(minimum if isinstance(minimum, str) else None)
        raise error

    async def request(
        self,
        method: str,
        path: str,
        *,
        json_body: Any = None,
        params: Mapping[str, Any] | None = None,
        idempotency_key: str | None = None,
        auth: bool = True,
        headers: Mapping[str, str] | None = None,
        files: Any = None,
        data: Mapping[str, Any] | None = None,
        content: bytes | None = None,
    ) -> ApiResponse:
        """Send one request; raises `ApiError` subclasses / `NetworkError` on failure."""
        if auth and not path.startswith("/oauth/"):
            await self.ensure_compatible()
        return await self._send(
            method,
            path,
            json_body=json_body,
            params=params,
            idempotency_key=idempotency_key,
            auth=auth,
            headers=headers,
            files=files,
            data=data,
            content=content,
        )

    async def get(self, path: str, params: Mapping[str, Any] | None = None) -> Any:
        return (await self.request("GET", path, params=params)).data

    async def post(self, path: str, body: Any = None, *, idempotency_key: str | None = None) -> Any:
        return (
            await self.request("POST", path, json_body=body, idempotency_key=idempotency_key)
        ).data

    async def patch(self, path: str, body: Any, *, idempotency_key: str | None = None) -> Any:
        return (
            await self.request("PATCH", path, json_body=body, idempotency_key=idempotency_key)
        ).data

    async def delete(self, path: str, *, idempotency_key: str | None = None) -> Any:
        return (await self.request("DELETE", path, idempotency_key=idempotency_key)).data

    @contextlib.asynccontextmanager
    async def stream(
        self, method: str, path: str, *, headers: Mapping[str, str] | None = None, auth: bool = True
    ) -> AsyncGenerator[httpx.Response]:
        """Stream a (download) response; refreshes once on 401 before any byte is read."""
        if auth:
            await self.ensure_compatible()
        request_headers = dict(headers or {})
        token = await self._bearer() if auth else None
        for attempt in range(2):
            if token is not None:
                request_headers["Authorization"] = f"Bearer {token}"
            request = self._http.build_request(method, path, headers=request_headers)
            try:
                response = await self._http.send(request, stream=True)
            except httpx.TransportError as exc:
                raise NetworkError(f"Cannot reach {self.base_url}: {type(exc).__name__}") from exc
            try:
                if response.status_code == 401 and auth and attempt == 0 and self.tokens:
                    await response.aread()
                    reason, revoked_reason = _rejection(response)
                    await response.aclose()
                    token = await self.tokens.refresh_access_token(
                        token or "", reason=reason, revoked_reason=revoked_reason
                    )
                    continue
                if not response.is_success:
                    await response.aread()
                    self._finish(response)
                yield response
                return
            finally:
                await response.aclose()

    # ------------------------------------------------------------------ OAuth endpoints
    async def oauth_form(self, url: str, form: Mapping[str, str]) -> dict[str, Any]:
        """POST an `application/x-www-form-urlencoded` body to an OAuth endpoint (no bearer)."""
        try:
            response = await self._http.post(
                url,
                data=dict(form),
                headers={"Accept": "application/json", "Cache-Control": "no-store"},
            )
        except httpx.TransportError as exc:
            raise NetworkError(f"Cannot reach {self.base_url}: {type(exc).__name__}") from exc
        payload: Any = None
        if response.content:
            try:
                payload = response.json()
            except json.JSONDecodeError:
                payload = None
        body = cast(dict[str, Any], payload) if isinstance(payload, dict) else {}
        if response.is_success:
            return body
        if response.status_code == 426:
            raise error_from_response(426, body, dict(response.headers))
        if response.status_code >= 500 or response.status_code == 429:
            raise error_from_response(response.status_code, body, dict(response.headers))
        raise OAuthError(
            str(body.get("error") or f"http_{response.status_code}"),
            cast(str | None, body.get("error_description")),
            status=response.status_code,
        )

    async def get_absolute(self, url: str) -> dict[str, Any]:
        """GET a JSON document (OAuth metadata) without auth or version gate."""
        try:
            response = await self._http.get(url, headers={"Accept": "application/json"})
        except httpx.TransportError as exc:
            raise NetworkError(f"Cannot reach {self.base_url}: {type(exc).__name__}") from exc
        if not response.is_success:
            raise error_from_response(response.status_code, None, dict(response.headers))
        try:
            payload = response.json()
        except json.JSONDecodeError as exc:
            raise ApiError(
                status=response.status_code,
                error="invalid_response",
                message=f"{url} did not return JSON",
            ) from exc
        if not isinstance(payload, dict):
            raise ApiError(status=response.status_code, error="invalid_response", message=url)
        return cast(dict[str, Any], payload)


def _rejection(response: httpx.Response) -> tuple[str | None, str | None]:
    """`reason` and `details.revoked_reason` of a `401 invalid_token` envelope (05 §1.3)."""
    try:
        payload: Any = response.json()
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None, None
    if not isinstance(payload, dict):
        return None, None
    body = cast(dict[str, Any], payload)
    reason = body.get("reason")
    details = body.get("details")
    revoked: Any = (
        cast(dict[str, Any], details).get("revoked_reason") if isinstance(details, dict) else None
    )
    return (
        reason if isinstance(reason, str) else None,
        revoked if isinstance(revoked, str) else None,
    )


def _clean_params(params: Mapping[str, Any] | None) -> dict[str, str] | None:
    if not params:
        return None
    out: dict[str, str] = {}
    for key, value in params.items():
        if value is None:
            continue
        if isinstance(value, bool):
            out[key] = "true" if value else "false"
        elif isinstance(value, list | tuple):
            items = cast(Sequence[Any], value)
            out[key] = ",".join(str(v) for v in items)
        else:
            out[key] = str(value)
    return out


def is_auth_failure(exc: BaseException) -> bool:
    return isinstance(exc, ApiAuthError | NotAuthenticatedError)


AsyncCall = Callable[[], Awaitable[Any]]
