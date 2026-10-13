"""An in-process fake of `apps/api` built from the shared contracts (for every CLI leaf).

`FakeApi` is a Starlette app that implements the OAuth endpoints the CLI uses (RFC 8414
metadata, PKCE authorization-code and refresh grants with rotation/grace/reuse
detection, RFC 7009 revocation) and the `/api/v1` kernel of PLAN C4:

    auth → version gate (426) → scope → device → idempotency → request validation
         → handler → response validation

Requests and responses of every route are validated with the **generated Pydantic
models** (`pilih_jobs.contracts.index.model(...)`); JSON request bodies are also checked
against the contract JSON Schema with the api's Zod semantics (`tests/support/
contract_schema.py`: an optional member may be absent but not `null`, lengths in UTF-16
units), which the Pydantic models cannot express. Responses are built from the
contract examples (`packages/jobs-contracts/examples/*.json`), so a fake handler cannot
drift from the contract silently: a contract violation becomes a 500 and is recorded in
`fake.contract_errors` (the `fake_api` fixture asserts it is empty at teardown).

Use it in-process through `fake.transport` (an `httpx.AsyncBaseTransport` with fault
injection), or on a real loopback port with `with fake.serve() as base_url:` (uvicorn in
a thread) for subprocess tests. Leaves add routes with `fake.route(method, template)`::

    @fake.route("POST", "/api/v1/discovery/runs")
    def create_run(req: FakeRequest) -> FakeResponse:
        return FakeResponse(201, {...})
"""

from __future__ import annotations

import asyncio
import base64
import contextlib
import copy
import hashlib
import json
import re
import secrets
import socket
import threading
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from email.utils import formatdate
from pathlib import Path
from typing import Any, Literal
from urllib.parse import parse_qs, urlencode, urlsplit

import httpx
from pydantic import ValidationError
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from pilih_jobs.contracts import ids
from pilih_jobs.contracts.index import RouteSpec, model, route_for, schema_group
from pilih_jobs.contracts.stage import can_change_submission_status
from pilih_jobs.version import parse_semver
from tests.support.contract_schema import contract_violations

REPO_ROOT = Path(__file__).resolve().parents[4]
CONTRACTS_DIR = REPO_ROOT / "packages" / "jobs-contracts"
_API_EXAMPLES: dict[str, Any] = json.loads(
    (CONTRACTS_DIR / "examples" / "api.json").read_text("utf-8")
)
_RECORD_EXAMPLES: dict[str, Any] = json.loads(
    (CONTRACTS_DIR / "examples" / "records.json").read_text("utf-8")
)

CLIENT_ID = "pilih-jobs-cli"
ACCESS_TTL_MS = 3_600_000
REFRESH_IDLE_MS = 30 * 24 * 3_600_000
REFRESH_ABSOLUTE_MS = 90 * 24 * 3_600_000
GRACE_MS = 60_000
_CLI_HEADER = re.compile(r"^cli/(\S+)$")
_PARAM = re.compile(r"\{([a-z_]+)\}")


def example(route_key: str, part: str = "response") -> Any:
    """A deep copy of the contract example of a route (`"GET /api/v1/me"`)."""
    return copy.deepcopy(_API_EXAMPLES[route_key][part])


def record_example(table: str) -> dict[str, Any]:
    return copy.deepcopy(_RECORD_EXAMPLES[table])


def b64url_sha256(text: str) -> str:
    digest = hashlib.sha256(text.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


# ---------------------------------------------------------------------------- model
@dataclass
class FakeUser:
    id: str
    email: str


@dataclass
class FakeGrant:
    id: str
    user_id: str
    scopes: list[str]
    device_id: str | None = None
    revoked: str | None = None
    created_at: int = 0


@dataclass
class FakeToken:
    token: str
    user_id: str
    scopes: list[str]
    grant_id: str | None
    expires_at: int | None
    kind: Literal["oauth", "personal_read", "personal_write"] = "oauth"
    revoked: bool = False

    def device_id(self, fake: FakeApi) -> str | None:
        grant = fake.grants.get(self.grant_id or "")
        return grant.device_id if grant else None


@dataclass
class FakeRefresh:
    token: str
    grant_id: str
    created_at: int
    expires_at: int
    parent: str | None = None
    child: str | None = None
    used_at: int | None = None
    revoked: bool = False


@dataclass
class FakeCode:
    code: str
    user_id: str
    redirect_uri: str
    challenge: str
    scopes: list[str]
    device_hint: str | None
    expires_at: int


@dataclass
class FakeRequest:
    method: str
    path: str
    params: dict[str, str]
    query: dict[str, str]
    body: Any
    headers: dict[str, str]
    token: FakeToken | None
    spec: RouteSpec | None
    idempotency_key: str | None

    @property
    def user_id(self) -> str:
        if self.token is None:
            raise RuntimeError("anonymous request")
        return self.token.user_id


@dataclass
class FakeResponse:
    status: int
    body: Any = None
    headers: dict[str, str] = field(default_factory=lambda: {})


class FakeHttpError(Exception):
    def __init__(self, status: int, error: str, message: str = "", **extra: Any) -> None:
        super().__init__(message or error)
        self.status = status
        self.error = error
        self.message = message or error
        self.extra = extra


@dataclass
class Injected:
    method: str
    pattern: re.Pattern[str]
    status: int
    error: str
    remaining: int
    retry_after: float | None = None
    message: str = "injected failure"
    details: dict[str, Any] | None = None


Handler = Callable[[FakeRequest], FakeResponse]
FaultMode = Literal["down", "drop_response", "duplicate"]
FaultPlan = Callable[[httpx.Request], FaultMode | None]


# ---------------------------------------------------------------------------- transport
class FakeTransport(httpx.AsyncBaseTransport):
    """ASGI transport with fault injection: `down`, `drop_response`, `duplicate`."""

    def __init__(self, fake: FakeApi) -> None:
        self.fake = fake
        self._asgi = httpx.ASGITransport(app=fake.app)

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        mode = self.fake.fault_plan(request) if self.fake.fault_plan else None
        if self.fake.offline or mode == "down":
            raise httpx.ConnectError("fake network down", request=request)
        body = request.read()
        response = await self._asgi.handle_async_request(request)
        if mode == "duplicate":
            await response.aread()
            replay = httpx.Request(
                request.method, request.url, headers=request.headers, content=body
            )
            response = await self._asgi.handle_async_request(replay)
        if mode == "drop_response":
            await response.aread()
            raise httpx.ReadTimeout("fake response lost", request=request)
        return response


# ---------------------------------------------------------------------------- the fake
class FakeApi:
    def __init__(
        self,
        *,
        issuer: str = "https://api.test",
        min_cli_version: str = "0.0.0",
        recommended_cli_version: str = "0.0.0",
        now_ms: Callable[[], int] | None = None,
    ) -> None:
        self.issuer = issuer.rstrip("/")
        self.min_cli_version = min_cli_version
        self.recommended_cli_version = recommended_cli_version
        self._now = now_ms or (lambda: time.time_ns() // 1_000_000)
        self.lock = threading.RLock()
        self.users: dict[str, FakeUser] = {}
        self.grants: dict[str, FakeGrant] = {}
        self.tokens: dict[str, FakeToken] = {}
        self.refresh_tokens: dict[str, FakeRefresh] = {}
        self.codes: dict[str, FakeCode] = {}
        self.devices: dict[str, dict[str, Any]] = {}
        self.entities: dict[tuple[str, str], dict[str, Any]] = {}
        self.entity_owner: dict[tuple[str, str], str] = {}
        self.events: list[dict[str, Any]] = []
        self.tasks: dict[str, dict[str, Any]] = {}
        self.change_log: list[dict[str, Any]] = []
        self.retained_from_seq = 1
        self.idempotency: dict[tuple[str, str], tuple[str, int, Any]] = {}
        self.accepted: list[dict[str, Any]] = []
        self.requests: list[tuple[str, str]] = []
        self.request_headers: list[dict[str, str]] = []
        self.telemetry: list[dict[str, Any]] = []
        self.crash_reports: list[dict[str, Any]] = []
        self.revocations: list[dict[str, str]] = []
        self.contract_errors: list[str] = []
        self.injected: list[Injected] = []
        self.refresh_calls = 0
        self.offline = False
        #: JSON bodies the api's Zod schemas would refuse (answered 400 invalid_request).
        self.request_violations: list[tuple[str, list[str]]] = []
        #: Tombstoned users (11 §10): their credentials get `revoked_reason: account_deleted`.
        self.deleted_users: set[str] = set()
        self.fault_plan: FaultPlan | None = None
        self.handlers: list[tuple[str, re.Pattern[str], Handler]] = []
        self._install_core_routes()
        self.app = Starlette(
            routes=[
                Route(
                    "/{path:path}",
                    self._dispatch,
                    methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
                )
            ]
        )
        self.transport = FakeTransport(self)

    # ------------------------------------------------------------------ setup helpers
    def now(self) -> int:
        return self._now()

    def add_user(self, email: str = "rahma@example.com") -> str:
        with self.lock:
            user_id = ids.new_id("usr")
            self.users[user_id] = FakeUser(user_id, email)
            return user_id

    def issue_tokens(
        self,
        user_id: str,
        scopes: list[str] | None = None,
        *,
        device: bool = True,
        expires_in_ms: int = ACCESS_TTL_MS,
    ) -> tuple[str, str]:
        """Mint an access + refresh token directly (bypassing the browser consent)."""
        with self.lock:
            grant = FakeGrant(
                ids.new_id("grt"), user_id, list(scopes or _BASE_SCOPES), created_at=self.now()
            )
            self.grants[grant.id] = grant
            if device:
                grant.device_id = self._create_device(user_id, "Test device (macOS)")["id"]
            access = self._mint_access(grant, ttl_ms=expires_in_ms)
            refresh = self._mint_refresh(grant)
            return access.token, refresh.token

    def personal_token(self, user_id: str, *, write: bool = False) -> str:
        with self.lock:
            token = secrets.token_urlsafe(32)
            scopes = (
                [
                    "jobs:read",
                    "jobs:write",
                    "discovery:write",
                    "cv:read",
                    "cv:write",
                    "files:read",
                    "files:write",
                    "devices:manage",
                ]
                if write
                else ["jobs:read", "cv:read", "files:read"]
            )
            self.tokens[token] = FakeToken(
                token, user_id, scopes, None, None, "personal_write" if write else "personal_read"
            )
            return token

    def route(self, method: str, template: str) -> Callable[[Handler], Handler]:
        """Register (or override) a handler for `METHOD /path/{param}`."""

        def decorator(handler: Handler) -> Handler:
            parts = _PARAM.split(template)
            regex = "".join(
                f"(?P<{part}>[^/]+)" if index % 2 else re.escape(part)
                for index, part in enumerate(parts)
            )
            pattern = re.compile(f"^{regex}$")
            self.handlers.insert(0, (method.upper(), pattern, handler))
            return handler

        return decorator

    def fail_next(
        self,
        method: str,
        path_regex: str,
        status: int,
        error: str,
        *,
        count: int = 1,
        retry_after: float | None = None,
        message: str = "injected failure",
        details: dict[str, Any] | None = None,
    ) -> None:
        self.injected.append(
            Injected(
                method.upper(),
                re.compile(path_regex),
                status,
                error,
                count,
                retry_after,
                message,
                details,
            )
        )

    @contextlib.contextmanager
    def serve(self) -> Iterator[str]:
        """Run on `127.0.0.1:<free port>` in a thread; yields the base URL (= issuer)."""
        import uvicorn

        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        previous = self.issuer
        self.issuer = f"http://127.0.0.1:{port}"
        config = uvicorn.Config(
            self.app, host="127.0.0.1", port=port, log_level="error", lifespan="off"
        )
        server = uvicorn.Server(config)
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        deadline = time.monotonic() + 10
        while not server.started and time.monotonic() < deadline:
            time.sleep(0.02)
        try:
            yield self.issuer
        finally:
            server.should_exit = True
            thread.join(timeout=10)
            self.issuer = previous

    # ------------------------------------------------------------------ consent (the browser)
    def consent(
        self,
        authorize_url: str,
        *,
        user_id: str,
        deny: bool = False,
        iss: str | None = None,
        state: str | None = None,
    ) -> str:
        """Simulate the approve page: returns the redirect to the CLI's loopback callback."""
        query = {k: v[0] for k, v in parse_qs(urlsplit(authorize_url).query).items()}
        assert query["response_type"] == "code"
        assert query["client_id"] == CLIENT_ID
        assert query["code_challenge_method"] == "S256"
        redirect = query["redirect_uri"]
        parsed = urlsplit(redirect)
        assert parsed.hostname == "127.0.0.1", redirect
        assert parsed.path == "/callback", redirect
        params: dict[str, str] = {
            "state": state if state is not None else query["state"],
            "iss": iss or self.issuer,
        }
        if deny:
            params["error"] = "access_denied"
            return f"{redirect}?{urlencode(params)}"
        with self.lock:
            requested = query.get("scope", "").split()
            code = secrets.token_urlsafe(32)
            self.codes[code] = FakeCode(
                code=code,
                user_id=user_id,
                redirect_uri=redirect,
                challenge=query["code_challenge"],
                scopes=[s for s in requested if s in _ALLOWED_SCOPES],
                device_hint=query.get("device_hint"),
                expires_at=self.now() + 300_000,
            )
        params["code"] = code
        return f"{redirect}?{urlencode(params)}"

    # ------------------------------------------------------------------ entities
    def put_entity(
        self, entity: str, data: dict[str, Any], user_id: str, *, op: str = "upsert"
    ) -> int:
        with self.lock:
            key = (entity, str(data["id"]))
            self.entities[key] = copy.deepcopy(data)
            self.entity_owner[key] = user_id
            seq = len(self.change_log) + 1
            self.change_log.append(
                {
                    "seq": seq,
                    "user_id": user_id,
                    "entity": entity,
                    "entity_id": key[1],
                    "revision": int(data.get("revision", 0)),
                    "op": op,
                }
            )
            return seq

    def delete_entity(self, entity: str, entity_id: str, user_id: str) -> int:
        with self.lock:
            data = self.entities.get((entity, entity_id), {"id": entity_id, "revision": 0})
            data = {**data, "revision": int(data.get("revision", 0)) + 1}
            seq = self.put_entity(entity, data, user_id, op="delete")
            self.entities.pop((entity, entity_id), None)
            return seq

    def new_application(
        self, user_id: str, *, stage: str = "ready", revision: int = 1
    ) -> dict[str, Any]:
        row = record_example("applications")
        now = self.now()
        row.update(
            id=ids.new_id("app"),
            user_id=user_id,
            user_job_id=ids.new_id("ujb"),
            stage=stage,
            revision=revision,
            submission_status="not_started",
            submitted_at=None,
            submission_method=None,
            created_at=now,
            updated_at=now,
            stage_changed_at=now,
            last_change_source="web",
        )
        self.put_entity("application", row, user_id)
        return copy.deepcopy(row)

    def application(self, app_id: str) -> dict[str, Any]:
        return copy.deepcopy(self.entities[("application", app_id)])

    def web_move(self, app_id: str, stage: str) -> dict[str, Any]:
        """A user stage change made in the web app (actor `user`)."""
        with self.lock:
            app = self.entities[("application", app_id)]
            return self._change_stage(app, stage, actor="user", source="web", key=None)

    def new_task(self, user_id: str, app_id: str, *, device_id: str | None) -> dict[str, Any]:
        with self.lock:
            task = record_example("automation_tasks")
            lease = ids.new_id("lse")
            task.update(
                id=ids.new_id("tsk"),
                user_id=user_id,
                application_id=app_id,
                kind="apply",
                state="running",
                lease_id=lease,
                lease_device_id=device_id,
                lease_expires_at=self.now() + 120_000,
                created_at=self.now(),
                updated_at=self.now(),
                submit_intent_at=None,
            )
            self.tasks[task["id"]] = task
            return copy.deepcopy(task)

    # ------------------------------------------------------------------ token internals
    def _mint_access(self, grant: FakeGrant, *, ttl_ms: int = ACCESS_TTL_MS) -> FakeToken:
        token = FakeToken(
            secrets.token_urlsafe(32),
            grant.user_id,
            list(grant.scopes),
            grant.id,
            self.now() + ttl_ms,
        )
        self.tokens[token.token] = token
        return token

    def _mint_refresh(self, grant: FakeGrant, parent: FakeRefresh | None = None) -> FakeRefresh:
        now = self.now()
        refresh = FakeRefresh(
            token=secrets.token_urlsafe(32),
            grant_id=grant.id,
            created_at=now,
            expires_at=min(grant.created_at + REFRESH_ABSOLUTE_MS, now + REFRESH_IDLE_MS),
            parent=parent.token if parent else None,
        )
        if parent is not None:
            parent.child = refresh.token
        self.refresh_tokens[refresh.token] = refresh
        return refresh

    def revoke_grant(self, grant_id: str, reason: str = "user") -> None:
        with self.lock:
            grant = self.grants.get(grant_id)
            if grant is None:
                return
            grant.revoked = reason
            for refresh in self.refresh_tokens.values():
                if refresh.grant_id == grant_id:
                    refresh.revoked = True
            for token in self.tokens.values():
                if token.grant_id == grant_id:
                    token.revoked = True

    def delete_account(self, user_id: str) -> None:
        """11 §10 step 1: tombstone the user and revoke every grant and token of it."""
        with self.lock:
            self.deleted_users.add(user_id)
            for grant in list(self.grants.values()):
                if grant.user_id == user_id:
                    self.revoke_grant(grant.id, "account_deleted")

    def expire_access_tokens(self) -> None:
        with self.lock:
            for token in self.tokens.values():
                if token.expires_at is not None:
                    token.expires_at = self.now() - 1

    def _create_device(
        self, user_id: str, name: str, body: dict[str, Any] | None = None
    ) -> dict[str, Any]:
        view = example("POST /api/v1/devices")["device"]
        view.update(
            id=ids.new_id("dev"),
            user_id=user_id,
            name=name,
            created_at=self.now(),
            last_seen_at=self.now(),
            revoked_at=None,
            revision=1,
            online=True,
            active=False,
            accepts_tasks=True,
        )
        if body:
            view.update(
                {
                    k: body[k]
                    for k in ("platform", "arch", "cli_version", "capabilities")
                    if k in body
                }
            )
        self.devices[view["id"]] = view
        return view

    # ------------------------------------------------------------------ dispatch
    async def _dispatch(self, request: Request) -> Response:
        raw = await request.body()
        headers = {k.lower(): v for k, v in request.headers.items()}
        path = request.url.path
        method = request.method.upper()
        query = dict(request.query_params.items())
        multipart: dict[str, Any] | None = None
        if headers.get("content-type", "").startswith("multipart/form-data"):
            form = await request.form()
            multipart = {}
            for name, value in form.multi_items():
                if isinstance(value, str):
                    multipart[name] = json.loads(value) if name == "meta" else value
                else:
                    data = await value.read()
                    multipart[name] = {
                        "filename": value.filename,
                        "content_type": value.content_type,
                        "size_bytes": len(data),
                        "sha256": hashlib.sha256(data).hexdigest(),
                    }
        with self.lock:
            self.requests.append((method, path))
            self.request_headers.append(headers)
            try:
                response = self._handle(method, path, query, headers, raw, multipart)
            except FakeHttpError as exc:
                response = self._error(exc)
        out_headers = {"date": formatdate(self.now() / 1000, usegmt=True), **response.headers}
        if response.status == 204 or response.body is None:
            return Response(status_code=response.status, headers=out_headers)
        return JSONResponse(response.body, status_code=response.status, headers=out_headers)

    def _error(self, exc: FakeHttpError) -> FakeResponse:
        if exc.extra.get("oauth"):
            return FakeResponse(exc.status, {"error": exc.error, "error_description": exc.message})
        body: dict[str, Any] = {
            "error": exc.error,
            "message": exc.message,
            "request_id": ids.new_ulid(),
        }
        headers: dict[str, str] = {}
        for key in ("details", "reason", "scope"):
            if exc.extra.get(key) is not None:
                body[key] = exc.extra[key]
        if exc.status == 401:
            headers["www-authenticate"] = 'Bearer error="invalid_token"'
        if exc.error == "insufficient_scope":
            headers["www-authenticate"] = (
                f'Bearer error="insufficient_scope", scope="{exc.extra.get("scope")}"'
            )
        if exc.extra.get("retry_after") is not None:
            headers["retry-after"] = str(exc.extra["retry_after"])
        self._validate("ErrorEnvelope", body, f"{exc.status} error")
        return FakeResponse(exc.status, body, headers)

    def _validate(self, name: str, value: Any, where: str) -> None:
        try:
            model(name).model_validate(value)
        except ValidationError as exc:
            self.contract_errors.append(f"{where}: {name}: {exc.errors()[:3]}")
            raise FakeHttpError(
                500, "upstream_unavailable", f"fake contract violation: {where}"
            ) from exc

    def _injected(self, method: str, path: str) -> None:
        for entry in list(self.injected):
            if entry.method == method and entry.pattern.search(path):
                entry.remaining -= 1
                if entry.remaining <= 0:
                    self.injected.remove(entry)
                raise FakeHttpError(
                    entry.status,
                    entry.error,
                    entry.message,
                    retry_after=entry.retry_after,
                    details=entry.details,
                    oauth=path.startswith("/oauth/") or None,
                )

    def _authenticate(self, headers: dict[str, str]) -> FakeToken:
        auth = headers.get("authorization", "")
        if not auth.lower().startswith("bearer "):
            raise FakeHttpError(401, "invalid_token", "missing bearer", reason="no_bearer")
        token = self.tokens.get(auth[7:].strip())
        if token is None:
            raise FakeHttpError(401, "invalid_token", "unknown token", reason="unknown_token")
        if token.user_id in self.deleted_users:  # active or revoked: the api says why
            raise FakeHttpError(
                401,
                "invalid_token",
                "revoked token",
                reason="revoked_token",
                details={"revoked_reason": "account_deleted"},
            )
        grant = self.grants.get(token.grant_id or "")
        device = self.devices.get(grant.device_id or "") if grant else None
        if token.revoked or (grant and grant.revoked) or (device and device.get("revoked_at")):
            raise FakeHttpError(401, "invalid_token", "revoked token", reason="revoked_token")
        if token.expires_at is not None and token.expires_at <= self.now():
            raise FakeHttpError(401, "invalid_token", "expired token", reason="expired_token")
        return token

    def _handle(
        self,
        method: str,
        path: str,
        query: dict[str, str],
        headers: dict[str, str],
        raw: bytes,
        multipart: dict[str, Any] | None = None,
    ) -> FakeResponse:
        self._injected(method, path)
        if path == "/.well-known/oauth-authorization-server" and method == "GET":
            return FakeResponse(200, self.metadata())
        if path == "/oauth/token" and method == "POST":
            return self._token({k: v[0] for k, v in parse_qs(raw.decode()).items()})
        if path == "/oauth/revoke" and method == "POST":
            return self._revoke({k: v[0] for k, v in parse_qs(raw.decode()).items()})
        if not path.startswith("/api/v1/"):
            raise FakeHttpError(404, "not_found", f"no route {path}")
        spec = route_for(method, path)
        body: Any = multipart if multipart is not None else (json.loads(raw) if raw else None)
        if multipart is not None:  # boundaries differ per attempt: hash the parsed parts
            raw = json.dumps(multipart, sort_keys=True).encode()
        if spec is not None and path != "/api/v1/meta":
            self._version_gate(headers)
        token: FakeToken | None = None
        if spec is None or spec.scope != "none":
            token = self._authenticate(headers)
        if spec is not None and token is not None:
            self._authorize(spec, token)
        key = headers.get("idempotency-key")
        if spec is not None and spec.idempotency == "required" and not key:
            raise FakeHttpError(400, "invalid_request", "Idempotency-Key required")
        request_hash = hashlib.sha256(f"{method} {path}\n".encode() + (raw or b"")).hexdigest()
        if key and token is not None and method != "GET":
            stored = self.idempotency.get((token.user_id, key))
            if stored is not None:
                if stored[0] != request_hash:
                    raise FakeHttpError(409, "idempotency_mismatch", "key reused with another body")
                return FakeResponse(
                    stored[1], copy.deepcopy(stored[2]), {"idempotent-replayed": "true"}
                )
        if spec is not None and spec.request is not None and spec.request_encoding == "json":
            try:
                model(spec.request).model_validate(body)
            except ValidationError as exc:
                raise FakeHttpError(
                    400,
                    "invalid_request",
                    "schema validation failed",
                    details={"issues": json.loads(exc.json())[:10]},
                ) from exc
            violations = contract_violations(schema_group(spec.request), spec.request, body)
            if violations:
                self.request_violations.append((spec.key, violations))
                raise FakeHttpError(
                    400,
                    "invalid_request",
                    "schema validation failed",
                    details={"issues": [{"message": v} for v in violations[:10]]},
                )
        handler, params = self._find_handler(method, path)
        request = FakeRequest(method, path, params, query, body, headers, token, spec, key)
        response = handler(request)
        validate = spec is not None and spec.response is not None and response.body is not None
        if 200 <= response.status < 300 and validate:
            assert spec is not None
            assert spec.response is not None
            self._validate(spec.response, response.body, spec.key)
        if key and token is not None and method != "GET" and 200 <= response.status < 300:
            self.idempotency[(token.user_id, key)] = (
                request_hash,
                response.status,
                copy.deepcopy(response.body),
            )
        return response

    def _version_gate(self, headers: dict[str, str]) -> None:
        match = _CLI_HEADER.match(headers.get("x-pilih-client", ""))
        if match is None:
            return
        version, minimum = parse_semver(match.group(1)), parse_semver(self.min_cli_version)
        if version is not None and minimum is not None and version[:3] < minimum[:3]:
            raise FakeHttpError(
                426,
                "cli_upgrade_required",
                f"pilih-jobs {self.min_cli_version} or newer is required",
                details={"min_cli_version": self.min_cli_version},
            )

    def _authorize(self, spec: RouteSpec, token: FakeToken) -> None:
        if spec.scope not in ("any", "none"):
            allowed = spec.scope in token.scopes or (
                spec.alt_scope is not None and spec.alt_scope in token.scopes
            )
            missing = [s for s in spec.also_requires if s not in token.scopes]
            if not allowed or missing:
                needed = spec.scope if not allowed else missing[0]
                raise FakeHttpError(403, "insufficient_scope", f"requires {needed}", scope=needed)
        if spec.device and token.device_id(self) is None:
            raise FakeHttpError(403, "device_required", "this route needs a device-bound token")

    def _find_handler(self, method: str, path: str) -> tuple[Handler, dict[str, str]]:
        for handler_method, pattern, handler in self.handlers:
            match = pattern.match(path)
            if handler_method == method and match:
                return handler, match.groupdict()
        raise FakeHttpError(404, "not_found", f"fake: no handler for {method} {path}")

    # ------------------------------------------------------------------ OAuth
    def metadata(self) -> dict[str, Any]:
        return {
            "issuer": self.issuer,
            "authorization_endpoint": f"{self.issuer}/oauth/authorize",
            "token_endpoint": f"{self.issuer}/oauth/token",
            "revocation_endpoint": f"{self.issuer}/oauth/revoke",
            "registration_endpoint": f"{self.issuer}/oauth/register",
            "response_types_supported": ["code"],
            "grant_types_supported": ["authorization_code", "refresh_token"],
            "code_challenge_methods_supported": ["S256"],
            "token_endpoint_auth_methods_supported": ["none"],
            "revocation_endpoint_auth_methods_supported": [
                "none",
                "client_secret_basic",
                "client_secret_post",
            ],
            "scopes_supported": [*_ALLOWED_SCOPES, "mcp"],
            "authorization_response_iss_parameter_supported": True,
        }

    def _token_response(self, access: FakeToken, refresh: FakeRefresh | None) -> FakeResponse:
        body: dict[str, Any] = {
            "access_token": access.token,
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": " ".join(access.scopes),
        }
        if refresh is not None:
            body["refresh_token"] = refresh.token
        return FakeResponse(200, body, {"cache-control": "no-store", "pragma": "no-cache"})

    def _token(self, form: dict[str, str]) -> FakeResponse:
        def fail(error: str = "invalid_grant", message: str = "invalid grant") -> FakeHttpError:
            return FakeHttpError(400, error, message, oauth=True)

        if form.get("client_id") != CLIENT_ID:
            raise fail("invalid_client", "unknown client")
        grant_type = form.get("grant_type")
        if grant_type == "authorization_code":
            code = self.codes.pop(form.get("code", ""), None)
            if code is None or code.expires_at <= self.now():
                raise fail()
            verifier = form.get("code_verifier", "")
            if (
                not re.fullmatch(r"[A-Za-z0-9\-._~]{43,128}", verifier)
                or b64url_sha256(verifier) != code.challenge
            ):
                raise fail(message="PKCE verification failed")
            if form.get("redirect_uri") != code.redirect_uri:
                raise fail(message="redirect_uri mismatch")
            grant = FakeGrant(ids.new_id("grt"), code.user_id, code.scopes, created_at=self.now())
            hint = self.devices.get(code.device_hint or "")
            if hint is not None and hint["user_id"] == code.user_id and not hint.get("revoked_at"):
                for other in list(self.grants.values()):
                    if other.device_id == hint["id"] and not other.revoked:
                        self.revoke_grant(other.id, "user")
                grant.device_id = hint["id"]
            self.grants[grant.id] = grant
            access = self._mint_access(grant)
            refresh = self._mint_refresh(grant) if "offline_access" in grant.scopes else None
            return self._token_response(access, refresh)
        if grant_type == "refresh_token":
            self.refresh_calls += 1
            row = self.refresh_tokens.get(form.get("refresh_token", ""))
            if row is None or row.revoked or row.expires_at <= self.now():
                raise fail()
            grant = self.grants[row.grant_id]
            if grant.revoked:
                raise fail()
            if row.used_at is None:
                row.used_at = self.now()
                child = self._mint_refresh(grant, parent=row)
                return self._token_response(self._mint_access(grant), child)
            child_row = self.refresh_tokens.get(row.child or "")
            if (
                child_row is not None
                and child_row.used_at is None
                and self.now() - row.used_at <= GRACE_MS
            ):
                return self._token_response(self._mint_access(grant), child_row)
            self.revoke_grant(grant.id, "refresh_reuse")
            raise fail(message="refresh token reuse detected")
        raise fail("unsupported_grant_type", "unsupported grant type")

    def _revoke(self, form: dict[str, str]) -> FakeResponse:
        self.revocations.append(dict(form))
        token = form.get("token", "")
        refresh = self.refresh_tokens.get(token)
        if refresh is not None and form.get("client_id") == CLIENT_ID:
            grant = self.grants.get(refresh.grant_id)
            self.revoke_grant(refresh.grant_id, "user")
            if form.get("forget_device") == "true" and grant is not None and grant.device_id:
                self.devices[grant.device_id]["revoked_at"] = self.now()
        elif token in self.tokens and form.get("client_id") == CLIENT_ID:
            self.tokens[token].revoked = True
        return FakeResponse(200, {})

    # ------------------------------------------------------------------ core routes
    def _install_core_routes(self) -> None:
        @self.route("GET", "/api/v1/meta")
        def meta(_req: FakeRequest) -> FakeResponse:
            return FakeResponse(
                200,
                {
                    "api_version": "v1",
                    "min_cli_version": self.min_cli_version,
                    "recommended_cli_version": self.recommended_cli_version,
                    "features": ["automation", "ai"],
                },
            )

        @self.route("GET", "/api/v1/me")
        def me(req: FakeRequest) -> FakeResponse:
            assert req.token is not None
            user = self.users[req.token.user_id]
            body: dict[str, Any] = {
                "user_id": user.id,
                "email": user.email,
                "is_admin": False,
                "scopes": req.token.scopes,
                "credential_kind": "oauth_cli" if req.token.kind == "oauth" else req.token.kind,
            }
            device_id = req.token.device_id(self)
            if device_id:
                body["device"] = {"id": device_id, "name": self.devices[device_id]["name"]}
            return FakeResponse(200, body)

        @self.route("POST", "/api/v1/devices")
        def register(req: FakeRequest) -> FakeResponse:
            assert req.token is not None
            grant = self.grants.get(req.token.grant_id or "")
            if grant is None:
                raise FakeHttpError(403, "device_required", "not a CLI grant")
            if grant.device_id is not None:
                raise FakeHttpError(409, "duplicate", "the grant already has a device")
            view = self._create_device(req.user_id, req.body["name"], req.body)
            grant.device_id = view["id"]
            return FakeResponse(201, {"device": copy.deepcopy(view)})

        @self.route("GET", "/api/v1/devices")
        def list_devices(req: FakeRequest) -> FakeResponse:
            items = [copy.deepcopy(d) for d in self.devices.values() if d["user_id"] == req.user_id]
            return FakeResponse(200, {"items": items, "next_cursor": None})

        @self.route("PATCH", "/api/v1/devices/{dev_id}")
        def update_device(req: FakeRequest) -> FakeResponse:
            device = self._owned_device(req)
            if req.body["base_revision"] != device["revision"]:
                raise FakeHttpError(
                    409, "revision_conflict", "stale", details={"current": copy.deepcopy(device)}
                )
            for key in ("name", "accepts_tasks"):
                if key in req.body:
                    device[key] = req.body[key]
            device["revision"] += 1
            return FakeResponse(200, {"device": copy.deepcopy(device)})

        @self.route("POST", "/api/v1/devices/{dev_id}/revoke")
        def revoke_device(req: FakeRequest) -> FakeResponse:
            device = self._owned_device(req)
            device["revoked_at"] = self.now()
            device["revision"] += 1
            for grant in self.grants.values():
                if grant.device_id == device["id"]:
                    self.revoke_grant(grant.id, "device_revoked")
            tasks = {"outcome_unknown": 0, "requeued": 0, "awaiting_approval": 0, "cancelled": 0}
            return FakeResponse(200, {"device": copy.deepcopy(device), "tasks": tasks})

        @self.route("POST", "/api/v1/devices/{dev_id}/heartbeat")
        def device_heartbeat(req: FakeRequest) -> FakeResponse:
            self._owned_device(req)
            return FakeResponse(
                200,
                {
                    "server_time": self.now(),
                    "poll_interval_ms": 30_000,
                    "cancel_lease_ids": [],
                    "min_cli_version": self.min_cli_version,
                },
            )

        @self.route("GET", "/api/v1/changes")
        def changes(req: FakeRequest) -> FakeResponse:
            cursor = int(req.query.get("cursor", "0") or 0)
            limit = int(req.query.get("limit", "500") or 500)
            if cursor + 1 < self.retained_from_seq:
                raise FakeHttpError(410, "cursor_expired", "cursor older than retention")
            mine = [c for c in self.change_log if c["user_id"] == req.user_id and c["seq"] > cursor]
            page, has_more = mine[:limit], len(mine) > limit
            latest: dict[tuple[str, str], dict[str, Any]] = {}
            for change in page:
                latest[(change["entity"], change["entity_id"])] = change
            out = []
            for (entity, entity_id), change in latest.items():
                item: dict[str, Any] = {
                    "seq": change["seq"],
                    "entity": entity,
                    "entity_id": entity_id,
                    "revision": change["revision"],
                    "op": change["op"],
                }
                current = self.entities.get((entity, entity_id))
                if change["op"] == "upsert" and current is not None:
                    item["data"] = copy.deepcopy(current)
                    item["revision"] = int(current.get("revision", change["revision"]))
                out.append(item)
            out.sort(key=lambda c: c["seq"])
            next_cursor = page[-1]["seq"] if page else cursor
            return FakeResponse(
                200, {"changes": out, "next_cursor": next_cursor, "has_more": has_more}
            )

        @self.route("GET", "/api/v1/snapshot")
        def snapshot(req: FakeRequest) -> FakeResponse:
            body: dict[str, Any] = {"cursor": len(self.change_log), "taken_at": self.now()}
            collections = {
                "application": "applications",
                "approval": "approvals",
                "rule": "rules",
                "source": "sources",
            }
            wanted = set(filter(None, req.query.get("entities", "").split(","))) or set(
                collections.values()
            )
            for entity, collection in collections.items():
                if collection in wanted:
                    body[collection] = [
                        copy.deepcopy(v)
                        for (e, _), v in self.entities.items()
                        if e == entity and self.entity_owner.get((e, v["id"])) == req.user_id
                    ]
            return FakeResponse(200, body)

        @self.route("PATCH", "/api/v1/applications/{app_id}")
        def update_application(req: FakeRequest) -> FakeResponse:
            app = self._owned_application(req)
            self._check_revision(app, req.body["base_revision"])
            if "stage" in req.body and req.body["stage"] != app["stage"]:
                self._change_stage(
                    app, req.body["stage"], actor="user", source="cli", key=req.idempotency_key
                )
            else:
                for field_name in ("priority", "archived", "follow_up_at", "mode", "board_rank"):
                    if field_name in req.body:
                        app[field_name] = req.body[field_name]
                self._bump(app, req.user_id, key=req.idempotency_key, op="update")
            return FakeResponse(200, {"application": copy.deepcopy(app)})

        @self.route("POST", "/api/v1/applications/{app_id}/move")
        def move_application(req: FakeRequest) -> FakeResponse:
            app = self._owned_application(req)
            self._check_revision(app, req.body["base_revision"])
            self._change_stage(
                app, req.body["stage"], actor="user", source="cli", key=req.idempotency_key
            )
            return FakeResponse(200, {"application": copy.deepcopy(app)})

        @self.route("POST", "/api/v1/applications/{app_id}/events")
        def add_event(req: FakeRequest) -> FakeResponse:
            app = self._owned_application(req)
            body_key = req.body["idempotency_key"]
            existing = next((e for e in self.events if e.get("idempotency_key") == body_key), None)
            if existing is None:
                existing = self._event(
                    app,
                    req.body["type"],
                    None,
                    None,
                    actor="user",
                    payload=req.body["payload"],
                    key=body_key,
                )
                self.accepted.append(
                    {
                        "key": req.idempotency_key,
                        "op": "note",
                        "app": app["id"],
                        "event_key": body_key,
                    }
                )
            return FakeResponse(201, {"event": copy.deepcopy(existing)})

        @self.route("POST", "/api/v1/tasks/{tsk_id}/lease/{lease_id}/result")
        def task_result(req: FakeRequest) -> FakeResponse:
            task = self.tasks.get(req.params["tsk_id"])
            if task is None or task["user_id"] != req.user_id:
                raise FakeHttpError(404, "not_found", "no task")
            if (
                task["lease_id"] != req.params["lease_id"]
                or task["state"] not in ("claimed", "running", "paused", "awaiting_approval")
                or (task["lease_expires_at"] or 0) <= self.now()
            ):
                raise FakeHttpError(409, "lease_lost", "the lease is not held")
            return FakeResponse(200, self._apply_result(task, req))

        @self.route("POST", "/api/v1/tasks/{tsk_id}/lease/{lease_id}/release")
        def release(req: FakeRequest) -> FakeResponse:
            task = self.tasks.get(req.params["tsk_id"])
            if task is None or task["lease_id"] != req.params["lease_id"]:
                raise FakeHttpError(409, "lease_lost", "the lease is not held")
            task.update(state="queued", lease_id=None, lease_device_id=None, lease_expires_at=None)
            return FakeResponse(200, {"task": copy.deepcopy(task)})

        @self.route("POST", "/api/v1/files")
        def upload(req: FakeRequest) -> FakeResponse:
            meta, part = req.body["meta"], req.body["file"]
            if meta.get("sha256") and meta["sha256"] != part["sha256"]:
                raise FakeHttpError(400, "invalid_request", "sha256 mismatch")
            view = example("POST /api/v1/files")["file"]
            view.update(
                id=ids.new_id("fil"),
                user_id=req.user_id,
                kind=meta["kind"],
                content_type=part["content_type"],
                size_bytes=part["size_bytes"],
                sha256=part["sha256"],
                original_name=meta.get("original_name") or part["filename"],
                created_at=self.now(),
            )
            self.accepted.append({"key": req.idempotency_key, "op": "upload", "file": view["id"]})
            return FakeResponse(201, {"file": view})

        @self.route("POST", "/api/v1/telemetry")
        def telemetry(req: FakeRequest) -> FakeResponse:
            self.telemetry.append(req.body)
            return FakeResponse(202, {"accepted": True})

        @self.route("POST", "/api/v1/telemetry/crash")
        def crash(req: FakeRequest) -> FakeResponse:
            self.crash_reports.append(req.body)
            return FakeResponse(202, {"accepted": True})

        @self.route("POST", "/api/v1/inbox:bulk")
        def inbox_bulk(req: FakeRequest) -> FakeResponse:
            results = [
                {
                    "user_job_id": ujb,
                    "status": "ok",
                    "inbox_state": "dismissed" if req.body["action"] == "dismiss" else "seen",
                }
                for ujb in req.body["user_job_ids"]
            ]
            self.accepted.append(
                {
                    "key": req.idempotency_key,
                    "op": "inbox_bulk",
                    "ids": list(req.body["user_job_ids"]),
                }
            )
            return FakeResponse(200, {"results": results})

    # ------------------------------------------------------------------ domain helpers
    def _owned_device(self, req: FakeRequest) -> dict[str, Any]:
        device = self.devices.get(req.params["dev_id"])
        if device is None or device["user_id"] != req.user_id:
            raise FakeHttpError(404, "not_found", "no device")
        return device

    def _owned_application(self, req: FakeRequest) -> dict[str, Any]:
        app = self.entities.get(("application", req.params["app_id"]))
        if app is None or self.entity_owner.get(("application", app["id"])) != req.user_id:
            raise FakeHttpError(404, "not_found", "no application")
        return app

    def _check_revision(self, app: dict[str, Any], base_revision: int) -> None:
        if base_revision != app["revision"]:
            raise FakeHttpError(
                409,
                "revision_conflict",
                f"Application changed since revision {base_revision}",
                details={"current": copy.deepcopy(app)},
            )

    def _bump(self, app: dict[str, Any], user_id: str, *, key: str | None, op: str) -> None:
        app["revision"] += 1
        app["updated_at"] = self.now()
        self.put_entity("application", app, user_id)
        if key is not None:
            self.accepted.append({"key": key, "op": op, "app": app["id"]})

    def _event(
        self,
        app: dict[str, Any],
        kind: str,
        from_value: str | None,
        to_value: str | None,
        *,
        actor: str,
        payload: dict[str, Any] | None = None,
        key: str | None = None,
        applied: bool = True,
        task_id: str | None = None,
    ) -> dict[str, Any]:
        event = example("POST /api/v1/applications/{app_id}/events")["event"]
        event.update(
            id=ids.new_id("evt"),
            user_id=self.entity_owner[("application", app["id"])],
            application_id=app["id"],
            type=kind,
            from_value=from_value,
            to_value=to_value,
            payload=payload or {},
            actor_kind=actor,
            applied_to_state=applied,
            occurred_at=self.now(),
            recorded_at=self.now(),
            idempotency_key=key,
            task_id=task_id,
            attempt_id=None,
            actor_device_id=None,
        )
        self.events.append(event)
        return event

    def _change_stage(
        self, app: dict[str, Any], stage: str, *, actor: str, source: str, key: str | None
    ) -> dict[str, Any]:
        previous = app["stage"]
        app["stage"] = stage
        app["stage_changed_at"] = self.now()
        app["last_change_source"] = source
        self._event(app, "stage_changed", previous, stage, actor=actor)
        self._bump(app, self.entity_owner[("application", app["id"])], key=key, op=f"stage:{stage}")
        return copy.deepcopy(app)

    def _apply_result(self, task: dict[str, Any], req: FakeRequest) -> dict[str, Any]:
        """20 §6.2: automation stage changes lose to later user decisions; facts are kept."""
        app = self.entities[("application", task["application_id"])]
        update = req.body.get("application_update") or {}
        conflict = False
        stage = update.get("stage")
        if stage:
            user_change_after = any(
                e["application_id"] == app["id"]
                and e["type"] == "stage_changed"
                and e["actor_kind"] in ("user", "mcp")
                and e["recorded_at"] >= task["created_at"]
                for e in self.events
            )
            if app["stage"] in ("ready", "preparing", "saved") and not user_change_after:
                previous = app["stage"]
                app["stage"] = stage
                self._event(
                    app, "stage_changed", previous, stage, actor="automation", task_id=task["id"]
                )
            else:
                conflict = True
                self._event(
                    app,
                    "stage_changed",
                    app["stage"],
                    stage,
                    actor="automation",
                    applied=False,
                    task_id=task["id"],
                )
                self._event(
                    app, "conflict_recorded", None, None, actor="system", task_id=task["id"]
                )
        status = update.get("submission_status")
        if status and can_change_submission_status(app["submission_status"], status, "automation"):
            app["submission_status"] = status
        self._bump(app, req.user_id, key=req.idempotency_key, op="result")
        task["state"] = "submitted" if req.body["outcome"] == "submitted" else req.body["outcome"]
        response = example("POST /api/v1/tasks/{tsk_id}/lease/{lease_id}/result")
        response["task"].update(
            {k: task[k] for k in ("id", "user_id", "application_id", "state", "lease_id")}
        )
        response["application"] = copy.deepcopy(app)
        response["conflict_recorded"] = conflict
        if not req.body.get("evidence"):
            response["evidence"] = None
        return response


_BASE_SCOPES = [
    "jobs:read",
    "jobs:write",
    "discovery:write",
    "automation:execute",
    "cv:read",
    "files:read",
    "files:write",
    "ai:invoke",
    "offline_access",
]
_ALLOWED_SCOPES = [*_BASE_SCOPES, "automation:manage", "cv:write", "devices:manage"]


async def browser_visit(url: str) -> httpx.Response:
    """What the system browser does with the redirect: GET the loopback callback."""
    async with httpx.AsyncClient(timeout=10) as client:
        return await client.get(url)


def fake_browser(fake: FakeApi, user_id: str, **consent: Any) -> Callable[[str], bool]:
    """An `open_browser` replacement: approve consent and follow the redirect (async)."""
    tasks: list[asyncio.Task[httpx.Response]] = []

    def open_browser(url: str) -> bool:
        redirect = fake.consent(url, user_id=user_id, **consent)
        tasks.append(asyncio.get_running_loop().create_task(browser_visit(redirect)))
        return True

    open_browser.tasks = tasks  # type: ignore[attr-defined]
    return open_browser
