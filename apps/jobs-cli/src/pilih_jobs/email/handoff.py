"""Email applications on the CLI (09 §4, §6.1, §10): draft, show, approve, send, confirm.

- `draft` renders the built-in template (locale `en`/`id`) from the fact sheet and the
  posting, attaches the application's approved CV PDF (plus `--attach` files) and creates a
  `local_handoff` draft;
- `approve` binds the exact content: `payload_hash = sha256(canonical{to, cc, subject,
  body_text, attachments:[sha256…]})` (09 §4) — shown together with the SHA-256 values;
- `send` downloads every attachment with the 08 §8 checks into `<data>/runs/<eml_id>/`
  (a SHA-256 mismatch aborts the hand-off), writes `application.eml`, opens the mail client
  and asks "Did you send it?" (`handed-off`); non-interactive sessions get instructions;
- `confirm --sent|--not-sent` records the user's answer later.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Final, cast

from pilih_jobs.api.client import ApiClient
from pilih_jobs.api.errors import ApiNotFoundError
from pilih_jobs.cv.download import download_verified
from pilih_jobs.email.eml import Attachment, build_eml, write_eml
from pilih_jobs.email.templates import facts_map, render_email_template
from pilih_jobs.errors import NotFoundError, PilihError, UsageError
from pilih_jobs.paths import Paths, ensure_private_dir
from pilih_jobs.storage.db import StateDB
from pilih_jobs.sync.cache import EntityCache

MAX_ATTACHMENTS: Final = 5
MAX_ATTACHMENT_BYTES: Final = 10_485_760
_UNSAFE = str.maketrans(dict.fromkeys('/\\:*?"<>|', "_"))


def canonical_json(value: Any) -> str:
    """Keys sorted at every level, no whitespace (the API's `canonicalJson`)."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def email_payload_hash(
    *,
    to: str,
    subject: str,
    body_text: str,
    attachment_sha256: list[str],
    cc: list[str] | None = None,
) -> str:
    """09 §4: `sha256(canonical{to, cc, subject, body_text, attachments:[sha256…]})`."""
    document = {
        "to": to,
        "cc": list(cc or []),
        "subject": subject,
        "body_text": body_text,
        "attachments": list(attachment_sha256),
    }
    return hashlib.sha256(canonical_json(document).encode("utf-8")).hexdigest()


def email_index_key(email_id: str) -> str:
    return f"email_app:{email_id}"


def review_key(email_id: str) -> str:
    return f"email_review:{email_id}"


def remember_review(db: StateDB, email_id: str, review: Any) -> None:
    """The server's review of a draft (`review.payload_hash`, leaf 2.9) for `approve`."""
    if isinstance(review, dict) and isinstance(
        cast(dict[str, Any], review).get("payload_hash"), str
    ):
        db.kv_set_json(review_key(email_id), review)


def server_payload_hash(db: StateDB, email_id: str) -> str | None:
    review = db.kv_get_json(review_key(email_id))
    if isinstance(review, dict):
        value = cast(dict[str, Any], review).get("payload_hash")
        return value if isinstance(value, str) else None
    return None


def recipient_confirmation_required(db: StateDB, email_id: str) -> bool:
    """From the server review: the "belongs to the employer" tick is needed (unknown → True)."""
    review = db.kv_get_json(review_key(email_id))
    if not isinstance(review, dict):
        return True
    recipient = cast(dict[str, Any], review).get("recipient")
    if not isinstance(recipient, dict):
        return True
    return bool(cast(dict[str, Any], recipient).get("confirmationRequired", True))


def remember_email(db: StateDB, issuer: str, record: dict[str, Any]) -> None:
    EntityCache(db, issuer).put("email", record)
    db.kv_set(email_index_key(str(record["id"])), str(record["application_id"]))


async def find_email(
    api: ApiClient, db: StateDB, issuer: str, email_id: str
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """The email record and its detail.

    `GET /api/v1/emails/{id}` gives the record, its approval and the server's `payload_hash`
    (what `approve` must echo, remembered for `email approve`); servers without that route
    are served from the application detail found through the local index / cache.
    """
    try:
        detail = cast(dict[str, Any], await api.get(f"/api/v1/emails/{email_id}"))
    except ApiNotFoundError:
        detail = None
    if detail is not None:
        record = cast(dict[str, Any], detail["email"])
        remember_email(db, issuer, record)
        if isinstance(detail.get("payload_hash"), str):
            previous = db.kv_get_json(review_key(email_id))
            review = cast(dict[str, Any], previous) if isinstance(previous, dict) else {}
            remember_review(db, email_id, {**review, "payload_hash": detail["payload_hash"]})
        return record, detail
    cache = EntityCache(db, issuer)
    cached = cache.get("email", email_id)
    application_id = db.kv_get(email_index_key(email_id)) or (
        str(cached["application_id"]) if cached else None
    )
    if application_id is None:
        raise NotFoundError(f"Email {email_id} not found.")
    app_detail = cast(dict[str, Any], await api.get(f"/api/v1/applications/{application_id}"))
    for record in cast(list[dict[str, Any]], app_detail.get("emails") or []):
        if record.get("id") == email_id:
            remember_email(db, issuer, record)
            return record, app_detail
    raise NotFoundError(f"Email {email_id} not found.")


def attachment_ids(record: dict[str, Any]) -> list[str]:
    return [str(f) for f in cast(list[Any], record.get("attachment_file_ids") or [])]


async def file_views(api: ApiClient, file_ids: list[str]) -> list[dict[str, Any]]:
    views: list[dict[str, Any]] = []
    for file_id in file_ids:
        data = cast(dict[str, Any], await api.get(f"/api/v1/files/{file_id}"))
        views.append(cast(dict[str, Any], data["file"]))
    return views


# ---------------------------------------------------------------------- draft
@dataclass
class DraftInput:
    application_id: str
    to: str
    locale: str = "en"
    attach: list[str] = field(default_factory=lambda: [])
    recipient_confirmed: bool = False
    recipient_name: str | None = None


async def default_attachments(api: ApiClient, detail: dict[str, Any]) -> list[str]:
    """The approved CV variant's PDF of the application (09 §5.3)."""
    app = cast(dict[str, Any], detail["application"])
    variants = cast(list[dict[str, Any]], detail.get("cv_variants") or [])
    attached = app.get("cv_variant_id")
    ordered = sorted(
        variants, key=lambda v: (v.get("id") != attached, -int(v.get("created_at") or 0))
    )
    for variant in ordered:
        if variant.get("status") == "approved" and isinstance(variant.get("file_id"), str):
            return [str(variant["file_id"])]
    return []


async def create_draft(
    api: ApiClient, db: StateDB, issuer: str, draft: DraftInput
) -> dict[str, Any]:
    detail = cast(dict[str, Any], await api.get(f"/api/v1/applications/{draft.application_id}"))
    posting = cast(dict[str, Any], detail.get("posting") or {})
    facts_response = cast(dict[str, Any], await api.get("/api/v1/profile/facts"))
    facts = facts_map(cast(list[dict[str, Any]], facts_response.get("facts") or []))
    rendered = render_email_template(
        locale=draft.locale,
        facts=facts,
        posting=posting,
        recipient_name=draft.recipient_name,
    )
    attachments = list(dict.fromkeys([*(await default_attachments(api, detail)), *draft.attach]))
    if len(attachments) > MAX_ATTACHMENTS:
        raise UsageError(f"At most {MAX_ATTACHMENTS} attachments.")
    body: dict[str, Any] = {
        "to": draft.to,
        "subject": rendered.subject,
        "body_text": rendered.body_text,
        "attachment_file_ids": attachments,
        "delivery": "local_handoff",
        "locale": draft.locale,
        "recipient_confirmed": draft.recipient_confirmed,
    }
    data = cast(
        dict[str, Any],
        await api.post(f"/api/v1/applications/{draft.application_id}/emails", body),
    )
    record = cast(dict[str, Any], data["email"])
    remember_email(db, issuer, record)
    remember_review(db, str(record["id"]), data.get("review"))
    return record


# ---------------------------------------------------------------------- approve
async def approval_view(api: ApiClient, record: dict[str, Any]) -> dict[str, Any]:
    """Everything the approval binds: content, attachments with SHA-256 and the hash."""
    views = await file_views(api, attachment_ids(record))
    attachments = [
        {
            "file_id": v["id"],
            "name": v.get("original_name") or v["id"],
            "sha256": v["sha256"],
            "size_bytes": v.get("size_bytes"),
        }
        for v in views
    ]
    payload_hash = email_payload_hash(
        to=str(record["to_address"]),
        subject=str(record["subject"]),
        body_text=str(record["body_text"]),
        attachment_sha256=[str(a["sha256"]) for a in attachments],
    )
    return {
        "email_id": record["id"],
        "to": record["to_address"],
        "subject": record["subject"],
        "body_text": record["body_text"],
        "attachments": attachments,
        "payload_hash": payload_hash,
        "status": record.get("status"),
    }


async def approve_email(
    api: ApiClient, record: dict[str, Any], payload_hash: str, *, recipient_confirmed: bool
) -> dict[str, Any]:
    return cast(
        dict[str, Any],
        await api.post(
            f"/api/v1/emails/{record['id']}/approve",
            {"payload_hash": payload_hash, "recipient_confirmed": recipient_confirmed},
        ),
    )


# ---------------------------------------------------------------------- send
@dataclass
class HandoffBundle:
    email_id: str
    eml_path: Path
    attachments: list[Path]
    to: str
    subject: str

    def as_dict(self) -> dict[str, Any]:
        return {
            "email_id": self.email_id,
            "eml_path": str(self.eml_path),
            "attachments": [str(p) for p in self.attachments],
            "to": self.to,
            "subject": self.subject,
        }


def email_dir(paths: Paths, email_id: str) -> Path:
    """`<data>/runs/<eml_id>/` (09 §5.3)."""
    return ensure_private_dir(paths.run_dir(email_id))


async def build_handoff(
    api: ApiClient,
    paths: Paths,
    record: dict[str, Any],
    *,
    from_address: str,
    from_name: str | None,
) -> HandoffBundle:
    """Download and verify every attachment, then write `application.eml`."""
    if record.get("delivery") != "local_handoff":
        raise PilihError(
            f"{record['id']} is sent by the server, not handed off locally.",
            code="not_local_handoff",
        )
    if record.get("status") not in ("approved", "handed_off"):
        raise PilihError(
            f"{record['id']} is {record.get('status')}; approve it first.",
            code="email_not_approved",
            hint=f"pilih-jobs email approve {record['id']}",
        )
    target_dir = email_dir(paths, str(record["id"]))
    views = await file_views(api, attachment_ids(record))
    total = sum(int(v.get("size_bytes") or 0) for v in views)
    if total > MAX_ATTACHMENT_BYTES:
        raise UsageError("Attachments exceed 10 MB in total (09 §8).")
    staged: list[Path] = []
    parts: list[Attachment] = []
    for view in views:
        name = str(view.get("original_name") or f"{view['id']}.pdf").translate(_UNSAFE)
        # A mismatch deletes the copy and raises ArtifactIntegrityError: no hand-off (T9-05).
        result = await download_verified(
            api, str(view["id"]), target_dir / name, str(view["sha256"]), paths=paths
        )
        staged.append(result.path)
        parts.append(
            Attachment(
                name,
                result.path.read_bytes(),
                str(view.get("content_type") or "application/pdf"),
            )
        )
    content = build_eml(
        from_address=from_address,
        from_name=from_name,
        to_address=str(record["to_address"]),
        subject=str(record["subject"]),
        body_text=str(record["body_text"]),
        attachments=parts,
    )
    eml_path = write_eml(target_dir / "application.eml", content)
    return HandoffBundle(
        email_id=str(record["id"]),
        eml_path=eml_path,
        attachments=staged,
        to=str(record["to_address"]),
        subject=str(record["subject"]),
    )


async def sender_identity(api: ApiClient) -> tuple[str, str | None]:
    """`From` of the hand-off: the applicant's `contact.email` (else the account email)."""
    facts = facts_map(
        cast(
            list[dict[str, Any]],
            cast(dict[str, Any], await api.get("/api/v1/profile/facts")).get("facts") or [],
        )
    )
    address = facts.get("contact.email")
    name = facts.get("contact.full_name")
    if not isinstance(address, str) or "@" not in address:
        me = cast(dict[str, Any], await api.get("/api/v1/me"))
        address = str(me.get("email") or "")
    if "@" not in address:
        raise PilihError("No sender address: add contact.email to your profile facts.")
    return address, name if isinstance(name, str) else None


async def report_handed_off(
    api: ApiClient, email_id: str, *, sent: bool, sent_at: int | None
) -> dict[str, Any]:
    body: dict[str, Any] = {"sent_confirmed": sent}
    if sent and sent_at is not None:
        body["sent_at"] = sent_at
    return cast(dict[str, Any], await api.post(f"/api/v1/emails/{email_id}/handed-off", body))


def manual_instructions(bundle: HandoffBundle) -> list[str]:
    """For clients that open `.eml` read-only, and for non-interactive sessions (09 §6.1)."""
    lines = [
        f"Open {bundle.eml_path} in your mail client (it opens as an unsent draft), or compose:",
        f"  To:      {bundle.to}",
        f"  Subject: {bundle.subject}",
    ]
    lines += [f"  Attach:  {p}" for p in bundle.attachments]
    lines.append(
        f"Then record it: pilih-jobs email confirm {bundle.email_id} --sent (or --not-sent)."
    )
    return lines


Confirm = Callable[[str], bool]
