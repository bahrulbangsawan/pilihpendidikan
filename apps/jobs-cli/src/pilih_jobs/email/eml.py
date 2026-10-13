"""The `.eml` of a `local_handoff` email application (09 §6.1).

An RFC 5322 message with CRLF line endings: `From` (the applicant's own address,
`contact.email`), `To`, `Subject` (RFC 2047 encoded-words when not ASCII, e.g. Indonesian
text or an em dash), `Date`, `Message-ID`, `MIME-Version`, and `X-Unsent: 1` so Outlook and
Apple Mail open it as an editable draft. The body is `text/plain; charset=utf-8`; each PDF is
an `application/pdf` part in base64 inside `multipart/mixed` (non-ASCII file names use
RFC 2231). Plain text only (09 §7).
"""

from __future__ import annotations

import email.policy
import email.utils
import os
from dataclasses import dataclass
from email.message import EmailMessage
from pathlib import Path

from pilih_jobs.paths import ensure_private_dir


@dataclass(frozen=True)
class Attachment:
    filename: str
    data: bytes
    content_type: str = "application/pdf"


def _domain(address: str) -> str:
    _, _, domain = address.rpartition("@")
    return domain or "localhost"


def build_eml(
    *,
    from_address: str,
    to_address: str,
    subject: str,
    body_text: str,
    attachments: list[Attachment],
    from_name: str | None = None,
    date: float | None = None,
    message_id: str | None = None,
) -> bytes:
    """Serialize the message (bytes with CRLF line endings)."""
    msg = EmailMessage(policy=email.policy.SMTP)
    msg["From"] = email.utils.formataddr((from_name or "", from_address))
    msg["To"] = to_address
    msg["Subject"] = subject
    msg["Date"] = email.utils.formatdate(date, localtime=True)
    msg["Message-ID"] = message_id or email.utils.make_msgid(domain=_domain(from_address))
    msg["X-Unsent"] = "1"
    msg.set_content(body_text, subtype="plain", charset="utf-8", cte="quoted-printable")
    for attachment in attachments:
        maintype, _, subtype = attachment.content_type.partition("/")
        msg.add_attachment(
            attachment.data,
            maintype=maintype or "application",
            subtype=subtype or "octet-stream",
            filename=attachment.filename,
        )
    if not attachments:
        msg.make_mixed()
    return msg.as_bytes()


def write_eml(path: Path, content: bytes) -> Path:
    """Write the `.eml` privately (0600) via a temp file + rename."""
    ensure_private_dir(path.parent)
    tmp = path.with_name(f".{path.name}.tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(content)
    tmp.replace(path)
    return path
