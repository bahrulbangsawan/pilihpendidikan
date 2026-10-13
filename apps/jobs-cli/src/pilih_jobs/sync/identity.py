"""Account binding of local sync data (16 §14, 20 §12 F5).

`state.db` data of an issuer (outbox, entity cache, cursor, seen postings) belongs to the
user recorded in its `account` row. Pushing or pulling with a credential of another user
would replay writes under the wrong identity or mix two users' data in one cache, so the
sync engine verifies the binding first; `login` as a different user quarantines the
outbox and clears the cached cloud data (`reset_account_data`).

When the account is deleted (`401 revoked_token` with `details.revoked_reason =
"account_deleted"` and a refused refresh, `auth.session`), nothing of it may stay
readable on the machine (11 §10 step 6): `wipe_account_data` deletes the issuer's cache,
seen postings, cursor, binding and outbox — the outbox is deleted, not quarantined,
together with the staged upload files its entries point to. Any other revocation only
signs out (20 §5.3): the outbox waits for the next login as the same user.
"""

from __future__ import annotations

import contextlib
import json
from pathlib import Path
from typing import Any, cast

from pilih_jobs.api.client import ApiClient
from pilih_jobs.errors import PermissionDeniedError
from pilih_jobs.storage.db import StateDB


class AccountMismatchError(PermissionDeniedError):
    default_code = "account_mismatch"


async def credential_user_id(api: ApiClient) -> str:
    """The user behind the client's credential (OAuth account metadata, else `/me`)."""
    account = getattr(api.tokens, "account", None)
    user_id = getattr(account, "user_id", None)
    if isinstance(user_id, str) and user_id:
        return user_id
    me = cast(dict[str, Any], await api.get("/api/v1/me"))
    return str(me["user_id"])


def bind_account(db: StateDB, issuer: str, user_id: str) -> None:
    """Record the owner of this issuer's local data, or refuse a different user."""
    row = db.account(issuer)
    if row is None:
        db.upsert_account(issuer, user_id, None)
        return
    owner = str(row["user_id"])
    if owner != user_id:
        raise AccountMismatchError(
            f"The local sync data of {issuer} belongs to another account ({owner}). "
            "Sign in as that account, or run `pilih-jobs login` to switch accounts "
            "(unsynced changes of the other account are then quarantined).",
            details={"owner_user_id": owner, "user_id": user_id},
            hint="pilih-jobs login",
        )


def _manifest_path(body: object) -> str | None:
    """`multipart.file.path` of an upload manifest (`sync.outbox.upload_manifest`)."""
    node: object = body
    for key in ("multipart", "file", "path"):
        if not isinstance(node, dict):
            return None
        node = cast(dict[str, object], node).get(key)
    return node if isinstance(node, str) else None


def _staged_upload_paths(db: StateDB, issuer: str) -> list[Path]:
    """Files named by the issuer's `kind='upload'` outbox entries (step logs, screenshots)."""
    out: list[Path] = []
    for row in db.query("SELECT body FROM outbox WHERE issuer = ? AND kind = 'upload'", (issuer,)):
        raw = row["body"]
        try:
            body = json.loads(raw) if raw else None
        except (ValueError, UnicodeDecodeError):
            continue
        path = _manifest_path(body)
        if path:
            out.append(Path(path))
    return out


def _remove_staged(paths: list[Path], upload_root: Path | None) -> int:
    """Delete staged files that lie inside the upload root (regular files, no symlinks)."""
    if upload_root is None:
        return 0
    root = upload_root.resolve()
    removed = 0
    for path in paths:
        if path.is_symlink():
            continue
        resolved = path.resolve()
        if resolved.is_relative_to(root) and resolved.is_file():
            with contextlib.suppress(FileNotFoundError):
                resolved.unlink()
                removed += 1
    return removed


def wipe_account_data(
    db: StateDB, issuer: str, user_id: str, *, upload_root: Path | None = None
) -> dict[str, int] | None:
    """Delete everything `state.db` holds for a deleted account of `issuer` (11 §10 step 6).

    Returns the deleted counts, or None when the local data is bound to another user
    (that user's data is never touched by this account's deletion).
    """
    from pilih_jobs.discovery.seen import LAST_RUN_PREFIX

    owner = db.account(issuer)
    if owner is not None and str(owner["user_id"]) != user_id:
        return None
    staged = _staged_upload_paths(db, issuer)
    kv_prefix = f"{LAST_RUN_PREFIX}{issuer}:"
    with db.transaction() as conn:
        counts = {
            "entity_cache": conn.execute(
                "DELETE FROM entity_cache WHERE issuer = ?", (issuer,)
            ).rowcount,
            "seen_postings": conn.execute(
                "DELETE FROM seen_postings WHERE issuer = ?", (issuer,)
            ).rowcount,
            "outbox": conn.execute("DELETE FROM outbox WHERE issuer = ?", (issuer,)).rowcount,
        }
        conn.execute("DELETE FROM sync_state WHERE issuer = ?", (issuer,))
        conn.execute("DELETE FROM account WHERE issuer = ?", (issuer,))
        conn.execute("DELETE FROM kv WHERE substr(key, 1, length(?)) = ?", (kv_prefix, kv_prefix))
    counts["staged_files"] = _remove_staged(staged, upload_root)
    return counts


def reset_account_data(db: StateDB, issuer: str) -> dict[str, int]:
    """Drop the cached cloud data of an issuer (cache, cursor, seen postings)."""
    with db.transaction() as conn:
        cache = conn.execute("DELETE FROM entity_cache WHERE issuer = ?", (issuer,)).rowcount
        conn.execute("DELETE FROM sync_state WHERE issuer = ?", (issuer,))
        seen = conn.execute("DELETE FROM seen_postings WHERE issuer = ?", (issuer,)).rowcount
    return {"entity_cache": cache, "seen_postings": seen}
