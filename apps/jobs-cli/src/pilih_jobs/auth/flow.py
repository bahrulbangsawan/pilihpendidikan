"""`pilih-jobs login` / `logout` (17 §6, §8, §10).

Login (17 §10.1): RFC 8414 metadata → PKCE + state → loopback listener on `127.0.0.1` →
system browser (`webbrowser.open`, never the automation browser) → callback checks →
token exchange → `GET /api/v1/me` → device registration (`POST /api/v1/devices`, or reuse
through `device_hint`) → secrets in the store, metadata in `credentials.json`, the
`account` row in `state.db`. If device registration fails the fresh refresh token is
revoked so no orphan grant remains. A different user than before quarantines the outbox
(16 §14).

Step-up (`--scope automation:manage`) re-runs consent with the union of the current and
the new scopes and the same device (`device_hint`).
"""

from __future__ import annotations

import webbrowser
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any, cast
from urllib.parse import urlencode, urlsplit

from pilih_jobs.api.client import ApiClient, StaticToken
from pilih_jobs.api.errors import ApiError, NetworkError, OAuthError
from pilih_jobs.auth import ALL_SCOPES, BASE_SCOPES, CLIENT_ID
from pilih_jobs.auth.loopback import LoopbackListener, Sleeper
from pilih_jobs.auth.metadata import AuthServerMetadata, fetch_metadata
from pilih_jobs.auth.pkce import code_challenge, generate_state, generate_verifier
from pilih_jobs.auth.session import AccessToken, TokenManager, token_from_response
from pilih_jobs.auth.store import (
    AccountMeta,
    SecretStore,
    access_account,
    device_key_account,
    refresh_account,
)
from pilih_jobs.contracts import ids
from pilih_jobs.environment import MAX_DEVICE_NAME, default_device_name, device_capabilities
from pilih_jobs.errors import NotAuthenticatedError, PilihError, UsageError
from pilih_jobs.logging import get_logger, log_event, set_device_id
from pilih_jobs.runtime import Runtime
from pilih_jobs.sync.identity import reset_account_data
from pilih_jobs.sync.outbox import Outbox
from pilih_jobs.version import __version__, arch, device_platform

_log = get_logger("auth.flow")

OpenBrowser = Callable[[str], bool]


class LoginError(PilihError):
    default_code = "login_failed"


@dataclass
class LoginOptions:
    device_name: str | None = None
    no_browser: bool = False
    port: int | None = None
    scopes: list[str] = field(default_factory=lambda: [])
    credential_store: str | None = None
    timeout_s: float = 300.0
    open_browser: OpenBrowser = field(default=lambda url: webbrowser.open(url))
    announce: Callable[[str], None] = lambda _message: None
    sleep: Sleeper | None = None
    capabilities: list[str] | None = None


@dataclass
class LoginResult:
    issuer: str
    user_id: str
    email: str
    device_id: str
    device_name: str
    scopes: list[str]
    device_reused: bool
    quarantined: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {
            "user_id": self.user_id,
            "email": self.email,
            "device_id": self.device_id,
            "device_name": self.device_name,
            "scopes": self.scopes,
            "device_reused": self.device_reused,
            "quarantined_outbox_entries": self.quarantined,
        }


def requested_scopes(extra: list[str], current: list[str] | None = None) -> list[str]:
    """Base set ∪ currently granted ∪ the step-up scopes asked for (17 §5.1)."""
    wanted: list[str] = list(BASE_SCOPES)
    for scope in [*(current or []), *extra]:
        for part in scope.replace(",", " ").split():
            if part not in ALL_SCOPES:
                raise UsageError(
                    f"Unknown scope {part!r}.", details={"known_scopes": list(ALL_SCOPES)}
                )
            if part not in wanted:
                wanted.append(part)
    return wanted


def authorize_url(
    metadata: AuthServerMetadata,
    *,
    redirect_uri: str,
    challenge: str,
    state: str,
    scopes: list[str],
    device_name: str,
    device_hint: str | None,
) -> str:
    query: dict[str, str] = {
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": redirect_uri,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": state,
        "scope": " ".join(scopes),
        "device_name": device_name,
    }
    if device_hint:
        query["device_hint"] = device_hint
    separator = "&" if "?" in metadata.authorization_endpoint else "?"
    return metadata.authorization_endpoint + separator + urlencode(query)


async def _revoke(client: ApiClient, metadata: AuthServerMetadata, token: str, hint: str) -> bool:
    if not metadata.revocation_endpoint:
        return False
    try:
        await client.oauth_form(
            metadata.revocation_endpoint,
            {"token": token, "token_type_hint": hint, "client_id": CLIENT_ID},
        )
    except (OAuthError, NetworkError, ApiError):
        return False
    return True


async def login(rt: Runtime, options: LoginOptions) -> LoginResult:
    store_name = options.credential_store or rt.config.credentials.store
    store = rt.secret_store(store_name)  # refuses null/plaintext backends before anything
    previous = rt.account()
    device_name = (options.device_name or default_device_name()).strip()
    if not device_name or len(device_name) > MAX_DEVICE_NAME:
        raise UsageError(f"--device-name must be 1–{MAX_DEVICE_NAME} characters.")
    scopes = requested_scopes(
        options.scopes, previous.scopes if (previous and options.scopes) else None
    )
    async with rt.api_client(auth=False, version_gate=False) as client:
        metadata = await fetch_metadata(client, db=rt.db)
        verifier = generate_verifier()
        state = generate_state()
        listener = LoopbackListener(
            expected_state=state,
            issuer=metadata.issuer,
            require_iss=metadata.iss_parameter_supported,
            port=options.port or 0,
            timeout_s=options.timeout_s,
            **({"sleep": options.sleep} if options.sleep is not None else {}),
        )
        await listener.start()
        redirect_uri = listener.redirect_uri
        try:
            device_hint = (previous.device_id if previous else None) or rt.credentials.last_device(
                rt.issuer
            )
            url = authorize_url(
                metadata,
                redirect_uri=redirect_uri,
                challenge=code_challenge(verifier),
                state=state,
                scopes=scopes,
                device_name=device_name,
                device_hint=device_hint,
            )
            opened = False if options.no_browser else bool(options.open_browser(url))
            if opened:
                options.announce(f"Opening your browser… If nothing opens, visit:\n{url}")
            else:
                options.announce(
                    "Open this URL in a browser on this machine (or through an SSH tunnel to "
                    f"127.0.0.1:{urlsplit(redirect_uri).port}):\n{url}"
                )
            callback = await listener.wait()
        finally:
            await listener.close()
        try:
            payload = await client.oauth_form(
                metadata.token_endpoint,
                {
                    "grant_type": "authorization_code",
                    "code": callback.code,
                    "code_verifier": verifier,
                    "redirect_uri": redirect_uri,
                    "client_id": CLIENT_ID,
                },
            )
        except OAuthError as exc:
            raise LoginError(
                f"The token exchange failed ({exc.error}). The code is single-use; run "
                "`pilih-jobs login` again.",
                details={"error": exc.error},
            ) from exc
        token = token_from_response(payload, ids.now_ms())
        refresh_token = payload.get("refresh_token")
        if not isinstance(refresh_token, str) or not refresh_token:
            raise LoginError(
                "The server did not issue a refresh token (offline_access was not granted)."
            )
        granted = list(token.scopes) or scopes
        result = await _finish_login(
            rt,
            client=client,
            metadata=metadata,
            store=store,
            token=token,
            refresh_token=refresh_token,
            granted=granted,
            device_name=device_name,
            capabilities=options.capabilities,
            store_name=store_name,
        )
    log_event(
        _log,
        "login",
        "signed in",
        user_id=result.user_id,
        device_id=result.device_id,
        scopes=result.scopes,
    )
    return result


async def _finish_login(
    rt: Runtime,
    *,
    client: ApiClient,
    metadata: AuthServerMetadata,
    store: SecretStore,
    token: AccessToken,
    refresh_token: str,
    granted: list[str],
    device_name: str,
    capabilities: list[str] | None,
    store_name: str,
) -> LoginResult:
    bearer = rt.new_client(tokens=StaticToken(token.token))
    try:
        try:
            me = cast(dict[str, Any], await bearer.get("/api/v1/me"))
            user_id = str(me["user_id"])
            email = str(me.get("email", ""))
            device = cast(dict[str, Any] | None, me.get("device"))
            reused = isinstance(device, dict) and isinstance(device.get("id"), str)
            if reused and device is not None:
                device_id, final_name = str(device["id"]), str(device.get("name") or device_name)
            else:
                registered = cast(
                    dict[str, Any],
                    await bearer.post(
                        "/api/v1/devices",
                        {
                            "name": device_name,
                            "platform": device_platform(),
                            "arch": arch(),
                            "cli_version": __version__,
                            "capabilities": capabilities
                            if capabilities is not None
                            else device_capabilities(rt.config.browser.channel),
                        },
                    ),
                )
                view = cast(dict[str, Any], registered["device"])
                device_id, final_name = str(view["id"]), str(view.get("name") or device_name)
        except (ApiError, NetworkError, KeyError, TypeError) as exc:
            revoked = await _revoke(client, metadata, refresh_token, "refresh_token")
            raise LoginError(
                "Device registration failed; the new sign-in was revoked"
                + ("" if revoked else " (revocation could not be confirmed)")
                + f": {exc}",
                details={"revoked": revoked},
            ) from exc
    finally:
        await bearer.aclose()

    quarantined = 0
    previous_owner = rt.db.account(rt.issuer)
    if previous_owner is not None and str(previous_owner["user_id"]) != user_id:
        quarantined = Outbox(rt.db, rt.issuer).quarantine(str(previous_owner["user_id"]))
        reset_account_data(rt.db, rt.issuer)  # never show the previous user's cached data
    old = rt.account()
    if old is not None and old.user_id != user_id:
        for key in (
            refresh_account(rt.issuer, old.user_id),
            access_account(rt.issuer, old.user_id),
        ):
            store.delete(key)

    meta = AccountMeta(
        issuer=rt.issuer,
        user_id=user_id,
        email=email,
        device_id=device_id,
        device_name=final_name,
        scopes=granted,
        credential_store=store_name,
    )
    store.set(refresh_account(rt.issuer, user_id), refresh_token)
    store.set(access_account(rt.issuer, user_id), token.to_json())
    rt.credentials.put(meta)
    rt.db.upsert_account(rt.issuer, user_id, device_id)
    set_device_id(device_id)
    return LoginResult(
        issuer=rt.issuer,
        user_id=user_id,
        email=email,
        device_id=device_id,
        device_name=final_name,
        scopes=granted,
        device_reused=reused,
        quarantined=quarantined,
    )


# ------------------------------------------------------------------ logout
@dataclass
class LogoutResult:
    revoked: bool
    released_leases: int = 0
    outbox_remaining: int = 0
    outbox_discarded: int = 0
    device_revoked: bool = False
    steps: list[str] = field(default_factory=lambda: [])

    def as_dict(self) -> dict[str, Any]:
        return {
            "revoked": self.revoked,
            "released_leases": self.released_leases,
            "outbox_remaining": self.outbox_remaining,
            "outbox_discarded": self.outbox_discarded,
            "device_revoked": self.device_revoked,
        }


PRE_SUBMIT_STATES = ("claimed", "running", "paused", "awaiting_approval")


async def release_pre_submit_leases(rt: Runtime, client: ApiClient) -> int:
    """Release leases held by this device that are before `submit_intent` (21 §6)."""
    rows = rt.db.query(
        "SELECT task_id, lease_id FROM local_tasks WHERE lease_id IS NOT NULL AND local_state IN "
        "('claimed','running','paused','awaiting_approval')"
    )
    released = 0
    for row in rows:
        try:
            await client.post(
                f"/api/v1/tasks/{row['task_id']}/lease/{row['lease_id']}/release",
                {"reason": "user_quit"},
                idempotency_key=f"release:{row['lease_id']}",
            )
        except (ApiError, NetworkError):
            continue
        rt.db.execute(
            "UPDATE local_tasks SET local_state = 'done', updated_at = ? WHERE task_id = ?",
            (ids.now_ms(), row["task_id"]),
        )
        released += 1
    return released


async def logout(
    rt: Runtime,
    *,
    discard_outbox: bool = False,
    forget_device: bool = False,
    confirm: Callable[[str], bool] = lambda _q: True,
    flush: Callable[[ApiClient], Any] | None = None,
) -> LogoutResult:
    account = rt.account()
    if account is None:
        raise NotAuthenticatedError("Not signed in to " + rt.issuer + ".")
    store = rt.secret_store(account.credential_store)
    result = LogoutResult(revoked=False)
    outbox = Outbox(rt.db, rt.issuer)
    async with rt.api_client(version_gate=False, allow_personal_token=False) as client:
        manager = cast(TokenManager, client.tokens)
        try:
            result.released_leases = await release_pre_submit_leases(rt, client)
            result.steps.append("leases released")
            if discard_outbox:
                result.outbox_discarded = outbox.discard_open()
            elif outbox.depth() and flush is not None:
                await flush(client)
        except (NotAuthenticatedError, ApiError, NetworkError) as exc:
            result.steps.append(f"skipped online steps: {exc}")
        result.outbox_remaining = outbox.depth()
        if result.outbox_remaining and not discard_outbox:
            keep = confirm(
                f"{result.outbox_remaining} change(s) are not synced yet. They stay queued and are "
                "sent after you sign in again as the same user. Sign out anyway?"
            )
            if not keep:
                raise PilihError("Logout cancelled; nothing was changed.", code="cancelled")
        if forget_device and account.device_id and "devices:manage" in account.scopes:
            try:
                await client.post(f"/api/v1/devices/{account.device_id}/revoke")
                result.device_revoked = True
            except (ApiError, NetworkError, NotAuthenticatedError):
                result.device_revoked = False
        refresh = store.get(refresh_account(rt.issuer, account.user_id))
        if refresh:
            metadata: AuthServerMetadata | None
            try:
                metadata = await fetch_metadata(client, db=rt.db)
            except (ApiError, NetworkError, PilihError):
                metadata = None
            if metadata is not None and metadata.revocation_endpoint:
                form = {
                    "token": refresh,
                    "token_type_hint": "refresh_token",
                    "client_id": CLIENT_ID,
                }
                if forget_device:
                    form["forget_device"] = "true"
                try:
                    await client.oauth_form(metadata.revocation_endpoint, form)
                    result.revoked = True
                except (OAuthError, ApiError, NetworkError):
                    result.revoked = False
        manager.sign_out("logout")
    for key in (
        refresh_account(rt.issuer, account.user_id),
        access_account(rt.issuer, account.user_id),
        device_key_account(rt.issuer, account.user_id),
    ):
        store.delete(key)
    rt.credentials.remove(rt.issuer, forget_device=forget_device)
    set_device_id(None)
    log_event(_log, "logout", "signed out", revoked=result.revoked)
    return result
