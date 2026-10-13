"""Structured JSONL logging with mandatory redaction (16 §10, 17 §13, 11 §8).

- `<logs>/pilih-jobs.log`: one JSON object per line with `ts, level, event, run_id?,
  task_id?, attempt_id?, lease_id_hash?, device_id, msg, data`; rotated at 10 MB × 5.
- Redaction runs in a `logging.Filter` attached to every handler (so third-party records
  such as httpx's are covered too), never at call sites:
  - values of secret-looking keys (`token`, `secret`, `password`, `cookie`,
    `authorization`, `verifier`, `code`, `state`, …) become `[redacted:sha256:xxxxxxxx]`
    (tokens, codes) or `[redacted]` (passwords, cookies);
  - in free text: `Bearer …`, sensitive URL query parameters, `Cookie:`/`Set-Cookie:`/
    `Authorization:` header lines, JSON-ish `"token": "…"` pairs, emails
    (`a***@d***.com`), phone numbers and long base64 runs (> 40 chars) are masked.
- `field_value_log()` is how typed form values are logged: `{field_ref, value_source, len}`.
- `StepLog` writes the per-run `steps.jsonl` (`<data>/runs/<id>/`) through the same redaction.
"""

from __future__ import annotations

import contextlib
import contextvars
import hashlib
import json
import logging
import logging.handlers
import os
import re
import sys
import threading
import time
from collections.abc import Generator, Iterable, Mapping
from pathlib import Path
from types import MappingProxyType
from typing import Any, Final, TextIO, cast

from pilih_jobs.paths import Paths, ensure_private_dir

ROOT_LOGGER: Final = "pilih_jobs"
LOG_MAX_BYTES: Final = 10 * 1024 * 1024
LOG_BACKUPS: Final = 5
REDACTED: Final = "[redacted]"

# ------------------------------------------------------------------ redaction
_SECRET_KEY = re.compile(
    r"(token|secret|password|passwd|passphrase|cookie|authorization|verifier|code|"
    r"api[_-]?key|credential|session|signature|ticket|otp)",
    re.IGNORECASE,
)
#: Keys whose values are hashed (correlatable) instead of blanked.
_HASHED_KEY = re.compile(r"(token|authorization|verifier|code|ticket|session|state)", re.IGNORECASE)
#: Non-secret keys that merely contain a secret-looking word.
_SAFE_KEYS: Final = frozenset(
    {
        "status_code",
        "exit_code",
        "error_code",
        "code_challenge_method",
        "country_code",
        "currency_code",
        "postal_code",
        "zip_code",
        "token_type",
        "token_type_hint",
        "token_count",
        "tokens_in",
        "tokens_out",
        "input_tokens",
        "output_tokens",
        "session_kind",
        "local_state",
        "state",
        "credential_kind",
        "credential_store",
    }
)
#: Machine codes (`invalid_grant`, `not_found`) are safe even under a `code` key.
_MACHINE_CODE = re.compile(r"^[a-z][a-z0-9_.:-]{0,63}$")
_OAUTH_STATE = re.compile(r"^[A-Za-z0-9_-]{20,}$")

#: httpcore debug records print header tuples: (b'set-cookie', b'…').
_HEADER_TUPLE = re.compile(
    r"\(b?(['\"])(authorization|proxy-authorization|cookie|set-cookie|x-render-ticket)\1,\s*"
    r"b?(['\"]).*?\3\)",
    re.IGNORECASE,
)
_BEARER = re.compile(r"(?i)\b(bearer|basic|dpop)\s+([A-Za-z0-9._~+/=-]{6,})")
_HEADER_LINE = re.compile(
    r"(?i)\b(set-cookie|cookie|authorization|proxy-authorization|x-render-ticket)\s*[:=]\s*[^\r\n]*"
)
_QUERY_SECRET = re.compile(
    r"(?i)([?&#;](?:code|state|token|access_token|refresh_token|id_token|code_verifier|"
    r"code_challenge|ticket|password|passphrase|secret|key|api_key|signature|sig)=)([^&#\s\"']+)"
)
_JSON_SECRET = re.compile(
    r"(?i)(\"?(?:access_token|refresh_token|id_token|code_verifier|token|password|passphrase|"
    r"secret|client_secret|authorization|cookie|code|ticket)\"?\s*[:=]\s*\"?)([^\"&\s,}]+)"
)
_EMAIL = re.compile(
    r"(?<![\w.+-])([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*)\.([A-Za-z]{2,24})\b"
)
_PHONE = re.compile(r"(?<![\w/.:%#=-])(\+?\(?\d[\d\s().-]{6,22}\d)(?![\w/:%-])")
_LONG_B64 = re.compile(r"[A-Za-z0-9_+/=-]{41,}")
#: 17 §13: URLs of `/oauth/*` are logged without their query string.
_OAUTH_QUERY = re.compile(r"(/oauth/[A-Za-z0-9_./-]*)\?[^\s\"'<>]*")
_HEX64 = re.compile(r"^(?:fp1:)?[0-9a-f]{64}$")
_ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}")


def token_hash(value: str) -> str:
    """`sha256(value)[:8]` — the only form in which a token may appear (16 §10)."""
    return hashlib.sha256(value.encode("utf-8", "surrogatepass")).hexdigest()[:8]


def _hashed(value: str) -> str:
    return f"[redacted:sha256:{token_hash(value)}]"


def mask_email(local: str, domain: str, tld: str) -> str:
    return f"{local[:1]}***@{domain[:1]}***.{tld}"


def _mask_phone(match: re.Match[str]) -> str:
    candidate = match.group(1)
    digits = sum(ch.isdigit() for ch in candidate)
    stripped = candidate.lstrip("(")
    looks_phone = (
        8 <= digits <= 15
        and (candidate.startswith(("+", "(")) or stripped.startswith("0"))
        and not _ISO_DATE.match(candidate)
    )
    if not looks_phone:
        return candidate
    return f"{candidate[:3]}***{candidate[-2:]}"


def _mask_long_b64(match: re.Match[str]) -> str:
    run = match.group(0)
    if _HEX64.match(run) or run.count("/") >= 3:
        return run  # sha256 digests / fingerprints and file paths are not secrets
    classes = sum(
        (
            any(ch.isdigit() for ch in run),
            any(ch.isupper() for ch in run),
            any(ch.islower() for ch in run),
        )
    )
    return _hashed(run) if classes >= 2 else run


def _json_secret(match: re.Match[str]) -> str:
    prefix, value = match.group(1), match.group(2)
    if prefix.lower().lstrip('"').startswith("code") and _MACHINE_CODE.match(value):
        return match.group(0)
    if value.startswith("[redacted"):
        return match.group(0)
    return f"{prefix}{REDACTED}"


def redact_text(text: str, *, personal: bool = True) -> str:
    """Mask secrets (and, unless `personal=False`, emails and phones) in free text."""
    if not text:
        return text
    out = _HEADER_LINE.sub(lambda m: f"{m.group(1)}: {REDACTED}", text)
    out = _HEADER_TUPLE.sub(lambda m: f"(b'{m.group(2)}', b'{REDACTED}')", out)
    out = _OAUTH_QUERY.sub(r"\1", out)
    out = _BEARER.sub(lambda m: f"{m.group(1)} {_hashed(m.group(2))}", out)
    out = _QUERY_SECRET.sub(lambda m: f"{m.group(1)}{REDACTED}", out)
    out = _JSON_SECRET.sub(_json_secret, out)
    if personal:
        out = _EMAIL.sub(lambda m: mask_email(m.group(1), m.group(2), m.group(3)), out)
    out = _LONG_B64.sub(_mask_long_b64, out)
    return _PHONE.sub(_mask_phone, out) if personal else out


def _redact_for_key(key: str, value: Any, personal: bool) -> Any:
    lowered = key.lower()
    if lowered in _SAFE_KEYS:
        if lowered == "state" and isinstance(value, str) and _OAUTH_STATE.match(value):
            return _hashed(value)  # an OAuth `state` parameter, not an entity state
        return redact(value, personal=personal)
    if lowered in {"lease_id", "lease"} and isinstance(value, str):
        return _hashed(value) if personal else value
    if not _SECRET_KEY.search(lowered):
        return redact(value, personal=personal)
    if value is None or isinstance(value, bool | int | float):
        return value
    if isinstance(value, str):
        if lowered.endswith("code") and _MACHINE_CODE.match(value):
            return value
        if value.startswith("[redacted"):
            return value
        return _hashed(value) if _HASHED_KEY.search(lowered) else REDACTED
    return REDACTED


def redact(value: Any, *, personal: bool = True) -> Any:
    """Recursively redact a JSON-like value (dicts by key, strings by pattern).

    `personal=False` keeps emails, phones and lease ids (terminal output shows the user's
    own data) while still removing every secret.
    """
    if isinstance(value, str):
        return redact_text(value, personal=personal)
    if isinstance(value, Mapping):
        mapping = cast(Mapping[object, Any], value)
        return {str(k): _redact_for_key(str(k), v, personal) for k, v in mapping.items()}
    if isinstance(value, list | tuple | set | frozenset):
        return [redact(item, personal=personal) for item in cast(Iterable[Any], value)]
    if value is None or isinstance(value, bool | int | float):
        return value
    return redact_text(str(value), personal=personal)


def redact_secrets(value: Any) -> Any:
    """Secrets only (tokens, codes, passwords, cookies): used for terminal output."""
    return redact(value, personal=False)


def field_value_log(field_ref: str, value_source: str, value: str | None) -> dict[str, Any]:
    """How a typed form value is logged: never the value, only its source and length."""
    return {"field_ref": field_ref, "value_source": value_source, "len": len(value or "")}


# ------------------------------------------------------------------ context
_EMPTY_CONTEXT: Final[Mapping[str, str]] = MappingProxyType({})
_CONTEXT: contextvars.ContextVar[Mapping[str, str]] = contextvars.ContextVar(
    "pilih_jobs_log_context", default=_EMPTY_CONTEXT
)
_CONTEXT_KEYS: Final = ("run_id", "task_id", "attempt_id", "lease_id", "device_id")


@contextlib.contextmanager
def bind(**values: str | None) -> Generator[None]:
    """Attach run/task/attempt/lease/device ids to every record logged inside the block."""
    current = dict(_CONTEXT.get())
    current.update({k: v for k, v in values.items() if v})
    token = _CONTEXT.set(current)
    try:
        yield
    finally:
        _CONTEXT.reset(token)


def set_device_id(device_id: str | None) -> None:
    current = dict(_CONTEXT.get())
    if device_id:
        current["device_id"] = device_id
    else:
        current.pop("device_id", None)
    _CONTEXT.set(current)


class RedactionFilter(logging.Filter):
    """Redacts message, args, `data`, exception and stack text of every record."""

    def filter(self, record: logging.LogRecord) -> bool:
        if getattr(record, "_pilih_redacted", False):
            return True
        try:
            message = record.getMessage()
        except (TypeError, ValueError):
            message = str(record.msg)
        record.msg = redact_text(message)
        record.args = None
        data = getattr(record, "data", None)
        if data is not None:
            record.data = redact(data)
        if record.exc_info and not record.exc_text:
            record.exc_text = logging.Formatter().formatException(record.exc_info)
        if record.exc_text:
            record.exc_text = redact_text(record.exc_text)
        if record.stack_info:
            record.stack_info = redact_text(record.stack_info)
        for key in _CONTEXT_KEYS:
            value = getattr(record, key, None) or _CONTEXT.get().get(key)
            if value:
                setattr(record, key, value)
        record._pilih_redacted = True  # pyright: ignore[reportAttributeAccessIssue]
        return True


class JsonlFormatter(logging.Formatter):
    """One JSON object per line: ts, level, event, run/task/attempt ids, lease hash, msg, data."""

    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "ts": int(record.created * 1000),
            "level": record.levelname.lower(),
            "event": getattr(record, "event", None) or record.name,
            "msg": record.msg if isinstance(record.msg, str) else str(record.msg),
        }
        for key in ("run_id", "task_id", "attempt_id"):
            value = getattr(record, key, None)
            if value:
                entry[key] = value
        lease = getattr(record, "lease_id", None)
        if lease:
            entry["lease_id_hash"] = token_hash(str(lease))
        entry["device_id"] = getattr(record, "device_id", None)
        data = getattr(record, "data", None)
        if data is not None:
            entry["data"] = data
        if record.exc_text:
            entry["exc"] = record.exc_text
        # Defence in depth: the formatter re-applies redaction to the final object.
        return json.dumps(redact(entry), ensure_ascii=False, default=str)


class ConsoleFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        line = f"{record.levelname.lower()}: {record.msg}"
        if record.exc_text:
            line += "\n" + record.exc_text
        return line


class _PrivateRotatingFileHandler(logging.handlers.RotatingFileHandler):
    def _open(self) -> Any:
        stream = super()._open()
        if os.name == "posix":
            with contextlib.suppress(OSError):
                Path(self.baseFilename).chmod(0o600)
        return stream


_setup_lock = threading.Lock()
_handlers: list[logging.Handler] = []

_LEVELS: Final = {
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warning": logging.WARNING,
    "error": logging.ERROR,
}


def setup_logging(
    paths: Paths | None,
    *,
    level: str = "info",
    verbose: int = 0,
    quiet: bool = False,
    console: TextIO | None = None,
) -> None:
    """Install the JSONL file handler and an optional stderr handler (both redacting)."""
    with _setup_lock:
        root = logging.getLogger(ROOT_LOGGER)
        for handler in _handlers:
            root.removeHandler(handler)
            for name in ("httpx", "httpcore"):
                logging.getLogger(name).removeHandler(handler)
            handler.close()
        _handlers.clear()
        file_level = _LEVELS.get(level, logging.INFO)
        if verbose >= 2:
            file_level = logging.DEBUG
        root.setLevel(logging.DEBUG)
        root.propagate = False
        redaction = RedactionFilter()
        if paths is not None:
            try:
                ensure_private_dir(paths.log_dir)
                file_handler = _PrivateRotatingFileHandler(
                    paths.log_file,
                    maxBytes=LOG_MAX_BYTES,
                    backupCount=LOG_BACKUPS,
                    encoding="utf-8",
                )
            except OSError:
                file_handler = None
            if file_handler is not None:
                file_handler.setLevel(file_level)
                file_handler.addFilter(redaction)
                file_handler.setFormatter(JsonlFormatter())
                _handlers.append(file_handler)
        if verbose > 0 and not quiet:
            stream_handler = logging.StreamHandler(console or sys.stderr)
            stream_handler.setLevel(logging.INFO if verbose == 1 else logging.DEBUG)
            stream_handler.addFilter(redaction)
            stream_handler.setFormatter(ConsoleFormatter())
            _handlers.append(stream_handler)
        for handler in _handlers:
            root.addHandler(handler)
        # httpx logs full request URLs at INFO; route them through the same redaction
        # and keep them at WARNING unless -vv was given.
        for name in ("httpx", "httpcore"):
            third_party = logging.getLogger(name)
            third_party.setLevel(logging.DEBUG if verbose >= 2 else logging.WARNING)
            third_party.propagate = False
            for handler in _handlers:
                third_party.addHandler(handler)


def get_logger(name: str) -> logging.Logger:
    if name == ROOT_LOGGER or name.startswith(f"{ROOT_LOGGER}."):
        return logging.getLogger(name)
    return logging.getLogger(f"{ROOT_LOGGER}.{name}")


def log_event(
    logger: logging.Logger,
    event: str,
    msg: str = "",
    *,
    level: int = logging.INFO,
    **data: Any,
) -> None:
    """Log a structured event: `event` names it, keyword arguments become `data`."""
    logger.log(level, msg or event, extra={"event": event, "data": data or None})


# ------------------------------------------------------------------ per-run step logs
class StepLog:
    """Append-only redacted JSONL step log at `<data>/runs/<id>/steps.jsonl` (19 §11)."""

    def __init__(self, path: Path) -> None:
        self.path = path
        ensure_private_dir(path.parent)
        self._lock = threading.Lock()

    def write(self, event: str, **data: Any) -> dict[str, Any]:
        context = _CONTEXT.get()
        entry: dict[str, Any] = {"ts": time.time_ns() // 1_000_000, "event": event}
        for key in ("run_id", "task_id", "attempt_id"):
            if context.get(key):
                entry[key] = context[key]
        if context.get("lease_id"):
            entry["lease_id_hash"] = token_hash(context["lease_id"])
        entry["data"] = data
        line = json.dumps(redact(entry), ensure_ascii=False, default=str)
        with self._lock:
            new = not self.path.exists()
            with self.path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
            if new and os.name == "posix":
                with contextlib.suppress(OSError):
                    self.path.chmod(0o600)
        return cast(dict[str, Any], json.loads(line))
