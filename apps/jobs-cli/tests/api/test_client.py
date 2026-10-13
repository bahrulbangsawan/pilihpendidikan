"""T16-COMPONENT / TCLI-426: the API client against a real HTTP server (pytest-httpserver)
serving the contract example payloads (05 §1, 16 §12, 17 §7)."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
from pytest_httpserver import HTTPServer
from werkzeug.wrappers import Request, Response

from pilih_jobs.api.client import ApiClient, StaticToken
from pilih_jobs.api.errors import (
    ApiAuthError,
    ApiConflictError,
    ApiUnavailableError,
    ApiUpgradeRequiredError,
    NetworkError,
)
from pilih_jobs.errors import ExitCode, UpgradeRequiredError
from pilih_jobs.logging import setup_logging
from pilih_jobs.paths import resolve_paths
from pilih_jobs.storage.db import StateDB
from pilih_jobs.version import __version__
from tests.support.fake_api import example

ULID_KEY = re.compile(r"^[0-7][0-9A-HJKMNP-TV-Z]{25}$")


class Refresher:
    def __init__(self, fresh: str) -> None:
        self.fresh = fresh
        self.calls: list[str] = []
        self.reasons: list[str | None] = []
        self.revoked_reasons: list[str | None] = []

    async def access_token(self) -> str:
        return "stale-token"

    async def refresh_access_token(
        self, stale: str, *, reason: str | None = None, revoked_reason: str | None = None
    ) -> str:
        self.calls.append(stale)
        self.reasons.append(reason)
        self.revoked_reasons.append(revoked_reason)
        return self.fresh


def _meta(server: HTTPServer, minimum: str = "0.0.1", recommended: str = "0.0.1") -> None:
    body = example("GET /api/v1/meta") | {
        "min_cli_version": minimum,
        "recommended_cli_version": recommended,
    }
    server.expect_request("/api/v1/meta").respond_with_json(body)


@pytest.fixture
def server() -> Iterator[HTTPServer]:
    with HTTPServer(host="127.0.0.1") as http:
        yield http


def _issuer(server: HTTPServer) -> str:
    return server.url_for("").rstrip("/")


async def test_T16_COMPONENT_headers_user_agent_and_idempotency(server: HTTPServer) -> None:
    _meta(server)
    seen: list[Request] = []

    def handler(request: Request) -> Response:
        seen.append(request)
        return Response(
            json.dumps(example("POST /api/v1/devices")), status=201, content_type="application/json"
        )

    server.expect_request("/api/v1/devices", method="POST").respond_with_handler(handler)
    server.expect_request("/api/v1/me").respond_with_json(example("GET /api/v1/me"))
    async with ApiClient(_issuer(server), tokens=StaticToken("tkn")) as api:
        me = await api.get("/api/v1/me")
        created = await api.post("/api/v1/devices", example("POST /api/v1/devices", "request"))
        await api.post(
            "/api/v1/devices",
            example("POST /api/v1/devices", "request"),
            idempotency_key="fixed-key",
        )
    assert me["user_id"].startswith("usr_")
    assert created["device"]["id"].startswith("dev_")
    first, second = seen
    assert first.headers["Authorization"] == "Bearer tkn"
    assert first.headers["X-Pilih-Client"] == f"cli/{__version__}"
    ua = first.headers["User-Agent"]
    assert re.match(
        rf"^pilih-jobs/{re.escape(__version__)} \((macos|linux|windows); [\w-]+\) "
        r"python/\d+\.\d+\.\d+ playwright/\S+ scrapling/\S+",
        ua,
    )
    assert ULID_KEY.match(first.headers["Idempotency-Key"])
    assert second.headers["Idempotency-Key"] == "fixed-key"


async def test_T16_COMPONENT_get_requests_carry_no_idempotency_key(server: HTTPServer) -> None:
    _meta(server)
    seen: list[Request] = []
    server.expect_request("/api/v1/me").respond_with_handler(
        lambda r: (
            seen.append(r),
            Response(json.dumps(example("GET /api/v1/me")), content_type="application/json"),
        )[1]
    )
    async with ApiClient(_issuer(server), tokens=StaticToken("t")) as api:
        await api.get("/api/v1/me")
    assert "Idempotency-Key" not in seen[0].headers


async def test_T16_COMPONENT_401_refreshes_once_and_retries_with_the_same_key(
    server: HTTPServer,
) -> None:
    _meta(server)
    seen: list[Request] = []

    def handler(request: Request) -> Response:
        seen.append(request)
        if request.headers["Authorization"] == "Bearer stale-token":
            body = {
                "error": "invalid_token",
                "message": "expired",
                "request_id": "r",
                "reason": "expired_token",
            }
            return Response(json.dumps(body), status=401, content_type="application/json")
        return Response(
            json.dumps(example("POST /api/v1/applications/{app_id}/move")),
            content_type="application/json",
        )

    server.expect_request(
        re.compile(r"/api/v1/applications/.+/move"), method="POST"
    ).respond_with_handler(handler)
    refresher = Refresher("fresh-token")
    async with ApiClient(_issuer(server), tokens=refresher) as api:
        body = example("POST /api/v1/applications/{app_id}/move", "request")
        result = await api.post(
            "/api/v1/applications/app_01JA6V8M3W8Z1T6Q4Y2B7K9C00/move", body, idempotency_key="k1"
        )
    assert result["application"]["revision"] == 8
    assert refresher.calls == ["stale-token"]
    assert refresher.reasons == ["expired_token"]  # the 401's reason reaches the provider
    assert [r.headers["Authorization"] for r in seen] == [
        "Bearer stale-token",
        "Bearer fresh-token",
    ]
    assert {r.headers["Idempotency-Key"] for r in seen} == {"k1"}


async def test_T16_COMPONENT_second_401_is_not_retried(server: HTTPServer) -> None:
    _meta(server)
    body = {
        "error": "invalid_token",
        "message": "revoked",
        "request_id": "r",
        "reason": "revoked_token",
        "details": {"revoked_reason": "account_deleted"},
    }
    server.expect_request("/api/v1/me").respond_with_json(body, status=401)
    refresher = Refresher("still-bad")
    async with ApiClient(_issuer(server), tokens=refresher) as api:
        with pytest.raises(ApiAuthError) as info:
            await api.get("/api/v1/me")
    assert info.value.reason == "revoked_token"
    assert info.value.exit == ExitCode.NOT_AUTHENTICATED
    assert len(refresher.calls) == 1
    assert refresher.reasons == ["revoked_token"]
    assert refresher.revoked_reasons == ["account_deleted"]


async def test_T16_COMPONENT_error_envelope_becomes_typed_exception(server: HTTPServer) -> None:
    _meta(server)
    current = example("POST /api/v1/applications/{app_id}/move")["application"]
    envelope = {
        "error": "revision_conflict",
        "message": "Application changed since revision 7",
        "details": {"current": current},
        "request_id": "req_1",
    }
    server.expect_request(re.compile(r".*/move"), method="POST").respond_with_json(
        envelope, status=409
    )
    server.expect_request("/api/v1/changes").respond_with_json(
        {"error": "rate_limited", "message": "slow down", "request_id": "r"},
        status=429,
        headers={"Retry-After": "7"},
    )
    async with ApiClient(_issuer(server), tokens=StaticToken("t")) as api:
        with pytest.raises(ApiConflictError) as conflict:
            await api.post(
                "/api/v1/applications/app_x/move", {"base_revision": 7, "stage": "applied"}
            )
        with pytest.raises(ApiUnavailableError) as limited:
            await api.get("/api/v1/changes")
    assert conflict.value.current == current
    assert conflict.value.request_id == "req_1"
    assert conflict.value.exit == ExitCode.CONFLICT
    assert limited.value.retry_after == 7.0
    assert limited.value.retryable


async def test_T16_COMPONENT_network_errors_are_retryable_and_exit_7() -> None:
    async with ApiClient("http://127.0.0.1:9", tokens=StaticToken("t"), version_gate=False) as api:
        with pytest.raises(NetworkError) as info:
            await api.get("/api/v1/me")
    assert info.value.exit == ExitCode.UNAVAILABLE
    assert info.value.retryable


async def test_TCLI_426_any_endpoint_raises_and_flags_the_worker(
    server: HTTPServer, tmp_path: Path
) -> None:
    _meta(server)
    body = {
        "error": "cli_upgrade_required",
        "message": "upgrade",
        "request_id": "r",
        "details": {"min_cli_version": "9.0.0"},
    }
    server.expect_request("/api/v1/me").respond_with_json(body, status=426)
    db = StateDB(tmp_path / "state.db")
    async with ApiClient(_issuer(server), tokens=StaticToken("t"), db=db) as api:
        with pytest.raises(ApiUpgradeRequiredError) as info:
            await api.get("/api/v1/me")
        assert api.upgrade_required()
    assert info.value.exit == ExitCode.UPGRADE_REQUIRED
    assert info.value.hint == "pilih-jobs update"
    assert db.kv_get_json("upgrade_required")["min_cli_version"] == "9.0.0"


async def test_TCLI_426_version_gate_from_meta_before_any_request(
    server: HTTPServer, tmp_path: Path
) -> None:
    _meta(server, minimum="99.0.0", recommended="99.0.0")
    server.expect_request("/api/v1/me").respond_with_json(example("GET /api/v1/me"))
    db = StateDB(tmp_path / "state.db")
    async with ApiClient(_issuer(server), tokens=StaticToken("t"), db=db) as api:
        with pytest.raises(UpgradeRequiredError) as info:
            await api.get("/api/v1/me")
    assert info.value.exit == ExitCode.UPGRADE_REQUIRED
    assert info.value.details["min_cli_version"] == "99.0.0"
    assert not any(req.path == "/api/v1/me" for req, _ in server.log)
    # the exempt commands (version, update, logout, doctor) build clients without the gate
    async with ApiClient(
        _issuer(server), tokens=StaticToken("t"), db=db, version_gate=False
    ) as api:
        assert (await api.get("/api/v1/me"))["email"]


async def test_TCLI_426_meta_is_cached_for_six_hours_and_recommends(
    server: HTTPServer, tmp_path: Path
) -> None:
    _meta(server, minimum="0.0.1", recommended="99.0.0")
    server.expect_request("/api/v1/me").respond_with_json(example("GET /api/v1/me"))
    db = StateDB(tmp_path / "state.db")
    notices: list[str] = []
    for _ in range(2):
        async with ApiClient(
            _issuer(server), tokens=StaticToken("t"), db=db, on_notice=notices.append
        ) as api:
            await api.get("/api/v1/me")
    assert sum(1 for req, _ in server.log if req.path == "/api/v1/meta") == 1
    assert len(notices) == 2
    assert "99.0.0" in notices[0]


async def test_TCLI_426_offline_meta_does_not_block(tmp_path: Path) -> None:
    async with ApiClient(
        "http://127.0.0.1:9", tokens=StaticToken("t"), db=StateDB(tmp_path / "s.db")
    ) as api:
        assert await api.get_meta() is None
        with pytest.raises(NetworkError):
            await api.get("/api/v1/me")


async def test_T16_COMPONENT_oauth_urls_are_logged_without_query(
    server: HTTPServer, home: Path
) -> None:
    paths = resolve_paths()
    setup_logging(paths, level="debug", verbose=2)
    server.expect_request("/oauth/token", method="POST").respond_with_json(
        {"access_token": "x" * 43, "expires_in": 3600}
    )
    server.expect_request("/.well-known/oauth-authorization-server").respond_with_json(
        {"issuer": "x"}
    )
    async with ApiClient(_issuer(server), version_gate=False) as api:
        await api.oauth_form(
            f"{_issuer(server)}/oauth/token?code=SECRETCODE123",
            {"grant_type": "refresh_token", "refresh_token": "RT-SECRET-VALUE-1234567890"},
        )
        await api.get_absolute(f"{_issuer(server)}/.well-known/oauth-authorization-server")
    for handler in logging.getLogger("pilih_jobs").handlers:
        handler.flush()
    content = paths.log_file.read_text()
    assert "/oauth/token" in content
    assert "SECRETCODE123" not in content
    assert "RT-SECRET-VALUE" not in content
    lines: list[dict[str, Any]] = [json.loads(line) for line in content.splitlines()]
    oauth_line = next(
        line for line in lines if line["event"] == "http" and "/oauth/token" in line["msg"]
    )
    assert "?" not in oauth_line["data"]["url"]
    assert all("/oauth/token?" not in line["msg"] for line in lines)
