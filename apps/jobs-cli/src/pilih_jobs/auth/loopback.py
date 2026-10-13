"""The one-shot loopback redirect listener (RFC 8252 §7.3, 17 §10.1, §13).

- Binds `127.0.0.1` only (never `0.0.0.0`), on an OS-assigned port unless `--port`.
- Accepts `GET /callback?code&state&iss`; any other path gets 404 and is ignored.
- `state` is compared in constant time; a mismatch answers 400 and **aborts** the login
  (logged as `state_mismatch`, no values). A wrong or missing `iss` (RFC 9207) answers
  400 and is ignored, as is any second request.
- The success page is static: no scripts and no external assets (no referrer leak).
- The whole wait times out after 300 s (`LoginTimeoutError`, exit 2).
"""

from __future__ import annotations

import asyncio
import contextlib
import hmac
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Final
from urllib.parse import parse_qs, urlsplit

from pilih_jobs.errors import ExitCode, PilihError
from pilih_jobs.logging import get_logger, log_event

LOOPBACK_HOST: Final = "127.0.0.1"
CALLBACK_PATH: Final = "/callback"
DEFAULT_TIMEOUT_S: Final = 300.0
_MAX_REQUEST_BYTES: Final = 16 * 1024
_READ_TIMEOUT_S: Final = 10.0

_log = get_logger("auth.loopback")

_PAGE_STYLE: Final = (
    "body{font-family:system-ui,-apple-system,'Segoe UI',sans-serif;background:#f6f5f1;"
    "color:#1c1c1a;margin:0;display:grid;place-items:center;min-height:100vh}"
    "main{max-width:30rem;padding:2rem;border:1px solid #d8d5cb;background:#fffefb}"
    "h1{font-size:1.25rem;margin:0 0 .5rem}p{margin:0;line-height:1.5}"
)


def callback_page(title: str, message: str) -> str:
    """A static HTML page: no scripts, no external URLs, inline style only."""
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>{title}</title><style>{_PAGE_STYLE}</style></head>"
        f"<body><main><h1>{title}</h1><p>{message}</p></main></body></html>"
    )


SUCCESS_PAGE: Final = callback_page(
    "Signed in to pilih-jobs", "You can close this tab and return to your terminal."
)
DENIED_PAGE: Final = callback_page(
    "Authorization denied", "pilih-jobs was not signed in. You can close this tab."
)
ERROR_PAGE: Final = callback_page(
    "Sign-in failed", "This request was not accepted. Return to your terminal for details."
)
NOT_FOUND_PAGE: Final = callback_page("Not found", "Nothing here.")

_SECURITY_HEADERS: Final = (
    "Content-Type: text/html; charset=utf-8\r\n"
    "Cache-Control: no-store\r\n"
    "Pragma: no-cache\r\n"
    "Referrer-Policy: no-referrer\r\n"
    "X-Content-Type-Options: nosniff\r\n"
    "X-Frame-Options: DENY\r\n"
    "Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; "
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'\r\n"
    "Connection: close\r\n"
)
_REASONS: Final = {200: "OK", 400: "Bad Request", 404: "Not Found", 405: "Method Not Allowed"}


class LoginTimeoutError(PilihError):
    exit_code = ExitCode.USAGE
    default_code = "login_timeout"


class StateMismatchError(PilihError):
    default_code = "state_mismatch"


class AuthorizationDeniedError(PilihError):
    default_code = "access_denied"


class AuthorizationFailedError(PilihError):
    default_code = "authorization_failed"


@dataclass(frozen=True)
class CallbackResult:
    code: str
    iss: str | None


Sleeper = Callable[[float], Awaitable[None]]


class LoopbackListener:
    """One-shot redirect listener.

    `async with LoopbackListener(...) as listener:` then `listener.redirect_uri` and
    `await listener.wait()`.
    """

    def __init__(
        self,
        *,
        expected_state: str,
        issuer: str,
        require_iss: bool = True,
        port: int = 0,
        timeout_s: float = DEFAULT_TIMEOUT_S,
        sleep: Sleeper = asyncio.sleep,
    ) -> None:
        self.expected_state = expected_state
        self.issuer = issuer.rstrip("/")
        self.require_iss = require_iss
        self.requested_port = port
        self.timeout_s = timeout_s
        self._sleep = sleep
        self._server: asyncio.Server | None = None
        self._result: asyncio.Future[CallbackResult] | None = None
        self.handled_requests = 0

    # ------------------------------------------------------------------ lifecycle
    async def start(self) -> LoopbackListener:
        loop = asyncio.get_running_loop()
        self._result = loop.create_future()
        self._server = await asyncio.start_server(
            self._handle, host=LOOPBACK_HOST, port=self.requested_port, reuse_address=False
        )
        return self

    async def close(self) -> None:
        server, self._server = self._server, None
        if server is not None:
            server.close()
            with contextlib.suppress(Exception):
                await server.wait_closed()

    async def __aenter__(self) -> LoopbackListener:
        return await self.start()

    async def __aexit__(self, *exc: object) -> None:
        await self.close()

    @property
    def sockname(self) -> tuple[str, int]:
        if self._server is None or not self._server.sockets:
            raise RuntimeError("listener not started")
        host, port = self._server.sockets[0].getsockname()[:2]
        return str(host), int(port)

    @property
    def port(self) -> int:
        return self.sockname[1]

    @property
    def redirect_uri(self) -> str:
        return f"http://{LOOPBACK_HOST}:{self.port}{CALLBACK_PATH}"

    async def wait(self) -> CallbackResult:
        """The authorization code, or raise (timeout, state mismatch, denial)."""
        if self._result is None:
            raise RuntimeError("listener not started")
        deadline = asyncio.ensure_future(self._sleep(self.timeout_s))
        try:
            done, _ = await asyncio.wait(
                {self._result, deadline}, return_when=asyncio.FIRST_COMPLETED
            )
            if self._result in done:
                return self._result.result()
            raise LoginTimeoutError(
                "Login timed out: no browser redirect within "
                f"{int(self.timeout_s)} s. Nothing was stored.",
                hint="pilih-jobs login",
            )
        finally:
            deadline.cancel()
            await self.close()

    # ------------------------------------------------------------------ requests
    def _settle(
        self, *, result: CallbackResult | None = None, error: Exception | None = None
    ) -> None:
        if self._result is None or self._result.done():
            return
        if error is not None:
            self._result.set_exception(error)
        elif result is not None:
            self._result.set_result(result)

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            status, page = await self._respond(reader)
        except (TimeoutError, asyncio.IncompleteReadError, asyncio.LimitOverrunError, ValueError):
            status, page = 400, ERROR_PAGE
        body = page.encode("utf-8")
        head = (
            f"HTTP/1.1 {status} {_REASONS.get(status, 'Error')}\r\n{_SECURITY_HEADERS}"
            f"Content-Length: {len(body)}\r\n\r\n"
        )
        with contextlib.suppress(ConnectionError, OSError):
            writer.write(head.encode("ascii") + body)
            await writer.drain()
        writer.close()
        with contextlib.suppress(ConnectionError, OSError):
            await writer.wait_closed()
        if self._result is not None and self._result.done() and self._server is not None:
            self._server.close()  # one-shot: stop accepting once settled

    async def _respond(self, reader: asyncio.StreamReader) -> tuple[int, str]:
        raw = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), _READ_TIMEOUT_S)
        if len(raw) > _MAX_REQUEST_BYTES:
            return 400, ERROR_PAGE
        request_line = raw.split(b"\r\n", 1)[0].decode("latin-1")
        parts = request_line.split(" ")
        if len(parts) != 3:
            return 400, ERROR_PAGE
        method, target = parts[0], parts[1]
        self.handled_requests += 1
        url = urlsplit(target)
        if url.path != CALLBACK_PATH:
            log_event(_log, "loopback_unexpected_path", "ignored a request to another path")
            return 404, NOT_FOUND_PAGE
        if method != "GET":
            return 405, ERROR_PAGE
        if self._result is None or self._result.done():
            log_event(_log, "loopback_second_request", "ignored a second callback request")
            return 400, ERROR_PAGE
        query = parse_qs(url.query, keep_blank_values=True)

        def first(name: str) -> str | None:
            values = query.get(name)
            return values[0] if values else None

        state = first("state") or ""
        if not hmac.compare_digest(state.encode("utf-8"), self.expected_state.encode("utf-8")):
            log_event(_log, "state_mismatch", "callback state did not match; login aborted")
            self._settle(
                error=StateMismatchError(
                    "Login aborted: the browser returned an unexpected state (possible CSRF).",
                    hint="pilih-jobs login",
                )
            )
            return 400, ERROR_PAGE
        iss = first("iss")
        if iss is not None and iss.rstrip("/") != self.issuer:
            log_event(_log, "iss_mismatch", "callback iss did not match the issuer; ignored")
            return 400, ERROR_PAGE
        if iss is None and self.require_iss:
            log_event(_log, "iss_missing", "callback without iss; ignored (RFC 9207)")
            return 400, ERROR_PAGE
        error = first("error")
        if error is not None:
            if error == "access_denied":
                self._settle(error=AuthorizationDeniedError("Authorization was denied."))
                return 200, DENIED_PAGE
            self._settle(
                error=AuthorizationFailedError(
                    f"The authorization server returned an error: {error}.",
                    details={"error": error},
                )
            )
            return 400, ERROR_PAGE
        code = first("code")
        if not code:
            return 400, ERROR_PAGE
        self._settle(result=CallbackResult(code=code, iss=iss))
        return 200, SUCCESS_PAGE
