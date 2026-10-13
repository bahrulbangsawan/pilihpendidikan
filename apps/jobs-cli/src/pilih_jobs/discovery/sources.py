"""Source resolution for a discovery run (15 §3 DiscoveryManager, 16 §3.3 flags).

- `--source src_…` — a configured `job_sources` row (API, else the local cache);
- `--source adapter:org` — an ad-hoc source (`greenhouse:acme`, `lever:acme@eu`,
  `ashby:acme`, `smartrecruiters:Acme`, `workable:acme`, `career_page:https://…`,
  `custom_url:https://…`); Workday and generic_listing need a configured source
  (opt-in and crawl patterns);
- `--url` — `custom_url` (`--private` → private posting);
- `--all` — every enabled configured source.

LinkedIn / Indeed (by adapter id or URL host) are refused here, before any request
(D-17). A Workday tenant disabled after a denial is refused when named and skipped by
`--all`.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Final, Literal, cast

from pilih_jobs.adapters import get_adapter, refuse_excluded
from pilih_jobs.adapters.base import SourceAdapter
from pilih_jobs.api.client import ApiClient
from pilih_jobs.api.errors import ApiError, NetworkError
from pilih_jobs.contracts.adapters import excluded_source_for_host
from pilih_jobs.discovery.cursor import CursorState
from pilih_jobs.discovery.errors import ExcludedSourceError, PolicyViolation
from pilih_jobs.discovery.types import SourceRef
from pilih_jobs.errors import UsageError
from pilih_jobs.storage.db import StateDB
from pilih_jobs.sync.cache import EntityCache

SOURCE_ID: Final = re.compile(r"^src_[0-7][0-9A-HJKMNP-TV-Z]{25}$")
URL_ADAPTERS: Final = frozenset({"career_page", "custom_url", "generic_listing"})
DISABLED_KV: Final = "discovery:disabled:"
CURSOR_KV: Final = "discovery:cursor:"
_LABEL_SUFFIX = re.compile(r"\s*\([^)]*\)\s*$")


@dataclass
class ResolvedSource:
    adapter: SourceAdapter
    config: dict[str, Any]
    label: str
    ref: SourceRef
    source_id: str | None = None
    revision: int | None = None
    visibility: Literal["public", "private"] = "public"
    cursor: CursorState = field(default_factory=CursorState)
    adhoc: bool = False
    company_hint: str | None = None

    @property
    def key(self) -> str:
        return self.ref.key


def _company_hint(label: str, org: str, adhoc: bool) -> str:
    if not adhoc:
        cleaned = _LABEL_SUFFIX.sub("", label).strip()
        if cleaned:
            return cleaned
    base = org.split("/", 1)[0].split(".")[0] if org else ""
    words = re.split(r"[-_\s]+", base)
    return " ".join(w[:1].upper() + w[1:] for w in words if w) or org


def adhoc_config(adapter_id: str, org: str, *, private: bool) -> dict[str, Any]:
    value = org.strip()
    if not value:
        raise UsageError(f"--source {adapter_id}: needs an organisation (e.g. {adapter_id}:acme)")
    if adapter_id == "greenhouse":
        return {"board_token": value}
    if adapter_id == "lever":
        site, _, region = value.partition("@")
        config: dict[str, Any] = {"site": site}
        if region:
            config["region"] = region
        return config
    if adapter_id == "ashby":
        return {"job_board_name": value}
    if adapter_id == "smartrecruiters":
        return {"company_identifier": value}
    if adapter_id == "workable":
        return {"subdomain": value}
    if adapter_id == "career_page":
        return {"url": value}
    if adapter_id == "custom_url":
        return {"url": value, "private": private} if private else {"url": value}
    if adapter_id == "workday":
        raise PolicyViolation(
            "Workday is opt-in per tenant: add the tenant as a source in the web app "
            "(Sources → Workday) after reading the note, then run `discover --source src_…`."
        )
    raise UsageError(
        f"{adapter_id} needs a configured source (crawl patterns); add it in the web app."
    )


def check_url_allowed(url: str) -> None:
    excluded = excluded_source_for_host(url)
    if excluded is not None:
        raise ExcludedSourceError(
            f"{excluded.display_name} is excluded from discovery (D-17): {excluded.reason}",
            details={"source": str(excluded.id), "url": url},
            hint="Track the job manually by title and company instead.",
        )


def parse_source_arg(value: str) -> tuple[str, str] | str:
    """`src_…` → the id; `adapter:org` → (adapter, org)."""
    text = value.strip()
    if SOURCE_ID.match(text):
        return text
    adapter_id, sep, org = text.partition(":")
    if not sep or not adapter_id:
        raise UsageError(f"--source expects src_<id> or adapter:org, got {value!r}")
    adapter_id = adapter_id.strip().lower()
    refuse_excluded(adapter_id)
    if adapter_id in URL_ADAPTERS:
        check_url_allowed(org)
    return adapter_id, org


def stored_cursor(
    db: StateDB | None, source_id: str, server: dict[str, Any] | None, server_updated_at: int | None
) -> CursorState:
    """The newer of the server `cursor_state` and the local copy of a pending complete."""
    local = db.kv_get_json(f"{CURSOR_KV}{source_id}") if db is not None else None
    if isinstance(local, dict):
        typed = cast(dict[str, Any], local)
        stamp = typed.get("saved_at")
        state = typed.get("state")
        if (
            isinstance(stamp, int)
            and isinstance(state, dict)
            and (server_updated_at is None or stamp >= server_updated_at)
        ):
            return CursorState(cast(dict[str, Any], state))
    return CursorState(server)


async def load_configured_sources(
    api: ApiClient | None, db: StateDB | None, issuer: str
) -> list[dict[str, Any]]:
    """The user's job sources: from the API (cached), or the local cache when offline."""
    cache = EntityCache(db, issuer) if db is not None else None
    if api is not None:
        try:
            items: list[dict[str, Any]] = []
            cursor: str | None = None
            for _ in range(50):
                params: dict[str, Any] = {"limit": 200}
                if cursor:
                    params["cursor"] = cursor
                page = cast(dict[str, Any], await api.get("/api/v1/sources", params=params))
                items.extend(cast(list[dict[str, Any]], page.get("items") or []))
                cursor = cast(str | None, page.get("next_cursor"))
                if not cursor:
                    break
        except (NetworkError, ApiError):
            if cache is None:
                raise
        else:
            if cache is not None:
                for item in items:
                    cache.put("source", item)
            return items
    return cache.list("source") if cache is not None else []


def from_record(
    record: dict[str, Any], db: StateDB | None, *, allow_browser: bool
) -> ResolvedSource:
    adapter_id = str(record.get("adapter"))
    refuse_excluded(adapter_id)
    adapter = get_adapter(adapter_id)
    source_id = str(record["id"])
    if db is not None:
        reason = db.kv_get(f"{DISABLED_KV}{source_id}")
        if reason:
            raise PolicyViolation(
                f"Source {source_id} was disabled after a {reason} response (15 §14.3).",
                details={"source_id": source_id, "disabled_reason": reason},
            )
    config = adapter.validate_config(cast(dict[str, Any], record.get("config") or {}))
    for key in ("url", "start_url"):
        if isinstance(config.get(key), str):
            check_url_allowed(str(config[key]))
    label = str(record.get("label") or f"{adapter_id}:{adapter.source_org(config)}")
    private = config.get("private") is True
    ref = adapter.source_ref(
        config,
        source_id=source_id,
        key=f"{adapter_id}:{adapter.source_org(config)}",
        allow_browser=allow_browser and config.get("allow_browser") is True,
    )
    revision = record.get("revision")
    updated = record.get("updated_at")
    return ResolvedSource(
        adapter=adapter,
        config=config,
        label=label[:200],
        ref=ref,
        source_id=source_id,
        revision=revision if isinstance(revision, int) else None,
        visibility="private" if private else "public",
        cursor=stored_cursor(
            db,
            source_id,
            cast(dict[str, Any] | None, record.get("cursor_state")),
            updated if isinstance(updated, int) else None,
        ),
        adhoc=False,
        company_hint=_company_hint(label, adapter.source_org(config), adhoc=False),
    )


def adhoc_source(
    adapter_id: str,
    org: str,
    db: StateDB | None,
    issuer: str,
    *,
    private: bool,
    allow_browser: bool,
) -> ResolvedSource:
    adapter = get_adapter(adapter_id)
    config = adapter.validate_config(adhoc_config(adapter_id, org, private=private))
    source_org = adapter.source_org(config)
    key = f"{adapter_id}:{source_org}"
    ref = adapter.source_ref(
        config, key=key, allow_browser=allow_browser and config.get("allow_browser") is True
    )
    local = db.kv_get_json(f"{CURSOR_KV}{issuer}:{key}") if db is not None else None
    state = cast(dict[str, Any], local).get("state") if isinstance(local, dict) else None
    return ResolvedSource(
        adapter=adapter,
        config=config,
        label=key[:200],
        ref=ref,
        visibility="private" if private else "public",
        cursor=CursorState(cast(dict[str, Any], state) if isinstance(state, dict) else None),
        adhoc=True,
        company_hint=_company_hint(key, source_org, adhoc=True),
    )
