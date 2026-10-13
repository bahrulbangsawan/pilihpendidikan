"""`<data>/runs/<att_id>/checkpoint.json` (18 §9).

Written after every executed action with an atomic temp-file + rename. It holds the step
index, the URL (without its fragment), the signatures of the fields we filled, the SHA-256
of uploaded files, `submit_intent_at` and the form hash — **never field values**. It is
used for reporting and resume decisions only.
"""

from __future__ import annotations

import contextlib
import json
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Final, cast

from pilih_jobs.paths import ensure_private_dir

CHECKPOINT_FILE: Final = "checkpoint.json"


@dataclass
class Checkpoint:
    attempt_id: str
    task_id: str
    step: int = 0
    url: str = ""
    form_hash: str | None = None
    applied_signatures: list[str] = field(default_factory=lambda: [])
    uploaded_sha256: list[str] = field(default_factory=lambda: [])
    submit_intent_at: int | None = None
    form_steps_advanced: int = 0
    paused_reason: str | None = None
    updated_at: int = 0

    def to_json(self) -> dict[str, Any]:
        data = asdict(self)
        data["url"] = self.url.split("#", 1)[0]
        return data


def write_checkpoint(run_dir: Path, checkpoint: Checkpoint) -> Path:
    ensure_private_dir(run_dir)
    checkpoint.updated_at = int(time.time() * 1000)
    path = run_dir / CHECKPOINT_FILE
    tmp = run_dir / f".{CHECKPOINT_FILE}.tmp"
    payload = json.dumps(checkpoint.to_json(), ensure_ascii=False, sort_keys=True)
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        os.write(fd, payload.encode("utf-8"))
        os.fsync(fd)
    finally:
        os.close(fd)
    tmp.replace(path)
    return path


def read_checkpoint(run_dir: Path) -> dict[str, Any] | None:
    with contextlib.suppress(OSError, ValueError):
        data = json.loads((run_dir / CHECKPOINT_FILE).read_text("utf-8"))
        if isinstance(data, dict):
            return cast(dict[str, Any], data)
    return None
