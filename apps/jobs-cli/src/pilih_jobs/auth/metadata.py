"""RFC 8414 authorization-server metadata (17 §10.1; cached 24 h in kv)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Final, cast

from pilih_jobs.api.client import ApiClient
from pilih_jobs.errors import PilihError
from pilih_jobs.storage.db import StateDB

METADATA_PATH: Final = "/.well-known/oauth-authorization-server"
CACHE_MS: Final = 24 * 3600 * 1000


class MetadataError(PilihError):
    default_code = "invalid_oauth_metadata"


@dataclass(frozen=True)
class AuthServerMetadata:
    issuer: str
    authorization_endpoint: str
    token_endpoint: str
    revocation_endpoint: str | None
    code_challenge_methods_supported: tuple[str, ...]
    iss_parameter_supported: bool
    scopes_supported: tuple[str, ...] = field(default_factory=tuple)
    grant_types_supported: tuple[str, ...] = field(default_factory=tuple)

    @classmethod
    def parse(cls, issuer: str, raw: dict[str, Any]) -> AuthServerMetadata:
        published = str(raw.get("issuer") or "").rstrip("/")
        if published != issuer.rstrip("/"):
            # RFC 8414 §3.3: the issuer must be identical to the one we asked.
            raise MetadataError(
                f"Authorization server metadata names issuer {published!r}, expected {issuer!r}."
            )
        for key in ("authorization_endpoint", "token_endpoint"):
            if not isinstance(raw.get(key), str):
                raise MetadataError(f"Authorization server metadata lacks {key}.")
        methods = tuple(
            str(m) for m in cast(list[object], raw.get("code_challenge_methods_supported") or [])
        )
        if "S256" not in methods:
            raise MetadataError("The authorization server does not support PKCE S256.")
        return cls(
            issuer=published,
            authorization_endpoint=str(raw["authorization_endpoint"]),
            token_endpoint=str(raw["token_endpoint"]),
            revocation_endpoint=cast(str | None, raw.get("revocation_endpoint")),
            code_challenge_methods_supported=methods,
            iss_parameter_supported=bool(raw.get("authorization_response_iss_parameter_supported")),
            scopes_supported=tuple(
                str(s) for s in cast(list[object], raw.get("scopes_supported") or [])
            ),
            grant_types_supported=tuple(
                str(g) for g in cast(list[object], raw.get("grant_types_supported") or [])
            ),
        )


async def fetch_metadata(
    client: ApiClient, *, db: StateDB | None = None, force: bool = False
) -> AuthServerMetadata:
    issuer = client.issuer
    key = f"oauth_metadata:{issuer}"
    raw: Any = None if (db is None or force) else db.cached(key, CACHE_MS)
    if not isinstance(raw, dict):
        raw = await client.get_absolute(issuer + METADATA_PATH)
        if db is not None:
            db.kv_put_cached(key, raw)
    return AuthServerMetadata.parse(issuer, cast(dict[str, Any], raw))
