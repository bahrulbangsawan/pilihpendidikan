"""ChallengeDetector: human-required situations, detected on every observation (18 §8).

A hit triggers `pause_for_human` with the matching PauseReason. It **never** triggers an
attempt to solve, wait out or evade the challenge (R5, D-16): the detector only reads.

Columns: Situation / Heuristics / Reason.

- CAPTCHA / bot check: heuristics iframe/script origin in the challenge hosts; challenge titles;
  turnstile / recaptcha / hcaptcha elements; 403/429 + body text; reason `captcha_or_challenge`
- Login wall: heuristics visible password field, `/login` `/signin` `/sso` `/oauth` paths, or a
  login button with no application fields; reason `login_required`
- Account creation: heuristics password + confirm-password, or "create account" wording with no
  job-specific fields; reason `account_creation_required`
- 2FA / OTP: heuristics OTP-like labels; "we sent a code"; reason `mfa_required`
- Credential field: heuristics a password / OTP field next to the application form; reason
  `credential_field`
- Payment: heuristics card fields or "payment / fee" wording; reason `payment_requested`
"""

from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Final, cast
from urllib.parse import urlsplit

from pilih_jobs.contracts.psl import ascii_host
from pilih_jobs.policy.sensitivity import (
    credential_name_match,
    is_card_field,
    is_mfa_text,
    is_payment_text,
)

#: 18 §8: challenge provider hosts (and their subdomains).
CHALLENGE_HOSTS: Final = (
    "google.com/recaptcha",
    "www.google.com/recaptcha",
    "recaptcha.net",
    "www.recaptcha.net",
    "hcaptcha.com",
    "challenges.cloudflare.com",
    "client-api.arkoselabs.com",
    "arkoselabs.com",
    "geo.captcha-delivery.com",
    "captcha-delivery.com",
    "perimeterx.net",
    "px-cdn.net",
)
CHALLENGE_TITLE_RE: Final = re.compile(
    r"just a moment|attention required|verify you are human|are you a robot|"
    r"security check|checking your browser|access denied|pardon our interruption",
    re.IGNORECASE,
)
_CHALLENGE_BODY_RE: Final = re.compile(
    r"verify you are human|are you a robot|captcha|unusual traffic|checking your browser|"
    r"enable javascript and cookies|cf-chl|ray id",
    re.IGNORECASE,
)
_LOGIN_PATH_RE: Final = re.compile(
    r"(^|/)(login|log-in|signin|sign-in|sso|oauth|oauth2|auth/login|account/login|users/sign_in)"
    r"(/|$|\.)",
    re.IGNORECASE,
)
_CONFIRM_PASSWORD_RE: Final = re.compile(
    r"confirm|repeat|re-?enter|again|ulangi|konfirmasi|verify", re.IGNORECASE
)
_CREATE_ACCOUNT_RE: Final = re.compile(
    r"create (an |your )?account|sign up|register (an |for an )?account|buat akun|daftar akun",
    re.IGNORECASE,
)
_JOB_FIELD_RE: Final = re.compile(
    r"resume|cv\b|cover letter|linkedin|portfolio|phone|first name|last name|full name|"
    r"why do you|experience|salary|notice period|start date|nama|telepon",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ChallengeHit:
    reason: str  # a canonical PauseReason (03 §7.2)
    kind: str  # detail: "turnstile", "recaptcha_iframe", "login_path", …
    detail: str = ""


def _host_path(url: str) -> tuple[str, str]:
    try:
        parts = urlsplit(url)
    except ValueError:
        return "", ""
    return ascii_host(parts.hostname or "") or "", parts.path or ""


def challenge_origin(url: str) -> str | None:
    """The matching challenge provider entry for an iframe / script URL, if any."""
    host, path = _host_path(url)
    if not host:
        return None
    for entry in CHALLENGE_HOSTS:
        entry_host, _, entry_path = entry.partition("/")
        host_ok = host == entry_host or host.endswith(f".{entry_host}")
        if host_ok and (not entry_path or path.lstrip("/").startswith(entry_path)):
            return entry
    return None


def _field_names(field: Mapping[str, Any]) -> list[str]:
    return [
        str(field.get(key) or "")
        for key in ("label", "name", "id_attr", "description", "autocomplete")
    ]


class ChallengeDetector:
    """Pure detector over the observer's raw data (no browser access)."""

    def detect(
        self,
        *,
        url: str,
        title: str,
        http_status: int | None,
        fields: Sequence[Mapping[str, Any]],
        controls: Sequence[Mapping[str, Any]],
        signals: Mapping[str, Any],
        frame_urls: Iterable[str] = (),
        page_text: str = "",
    ) -> ChallengeHit | None:
        hit = self._captcha(url, title, http_status, signals, frame_urls, page_text)
        if hit is not None:
            return hit
        return (
            self._mfa(fields, page_text)
            or self._account_creation(fields, controls, page_text)
            or self._login(url, fields, controls, signals)
            or self._credential(fields)
            or self._payment(fields, page_text)
        )

    # ---------------------------------------------------------------- captcha
    def _captcha(
        self,
        url: str,
        title: str,
        http_status: int | None,
        signals: Mapping[str, Any],
        frame_urls: Iterable[str],
        page_text: str,
    ) -> ChallengeHit | None:
        for frame in cast(list[object], signals.get("iframes") or []):
            src = (
                str(cast(Mapping[str, Any], frame).get("src") or "")
                if isinstance(frame, Mapping)
                else ""
            )
            origin = challenge_origin(src) if src else None
            if origin:
                return ChallengeHit("captcha_or_challenge", "challenge_iframe", origin)
        for src in [*cast(list[object], signals.get("scripts") or []), *frame_urls]:
            origin = challenge_origin(str(src))
            if origin:
                return ChallengeHit("captcha_or_challenge", "challenge_script", origin)
        for marker in ("turnstile", "recaptcha", "hcaptcha"):
            if signals.get(marker):
                return ChallengeHit("captcha_or_challenge", marker)
        if CHALLENGE_TITLE_RE.search(title or ""):
            return ChallengeHit("captcha_or_challenge", "challenge_title", title[:80])
        if http_status in (403, 429) and _CHALLENGE_BODY_RE.search(page_text or ""):
            return ChallengeHit("captcha_or_challenge", "challenge_status", str(http_status))
        return None

    # ---------------------------------------------------------------- mfa
    def _mfa(self, fields: Sequence[Mapping[str, Any]], page_text: str) -> ChallengeHit | None:
        for field in fields:
            if str(field.get("input_type") or "") == "password":
                continue
            names = _field_names(field)
            autocomplete = str(field.get("autocomplete") or "")
            if "one-time-code" in autocomplete.lower() or any(
                re.search(r"one.?time|otp|verification code|kode verifikasi|2fa", n, re.I)
                for n in names
            ):
                return ChallengeHit("mfa_required", "otp_field", str(field.get("label") or "")[:80])
        if is_mfa_text(page_text):
            return ChallengeHit("mfa_required", "otp_text")
        return None

    # ---------------------------------------------------------------- accounts
    @staticmethod
    def _password_fields(fields: Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
        return [f for f in fields if str(f.get("input_type") or "") == "password"]

    @staticmethod
    def _job_fields(fields: Sequence[Mapping[str, Any]]) -> list[Mapping[str, Any]]:
        out: list[Mapping[str, Any]] = []
        for field in fields:
            if str(field.get("input_type") or "") == "password":
                continue
            kind = str(field.get("kind") or "")
            text = " ".join(_field_names(field))
            if kind == "file" or _JOB_FIELD_RE.search(text):
                out.append(field)
        return out

    def _account_creation(
        self,
        fields: Sequence[Mapping[str, Any]],
        controls: Sequence[Mapping[str, Any]],
        page_text: str,
    ) -> ChallengeHit | None:
        passwords = self._password_fields(fields)
        if len(passwords) >= 2 and any(
            _CONFIRM_PASSWORD_RE.search(" ".join(_field_names(f))) for f in passwords
        ):
            return ChallengeHit("account_creation_required", "confirm_password")
        has_sign_up = any(c.get("role_hint") == "sign_up" for c in controls)
        if (
            passwords
            and (has_sign_up or _CREATE_ACCOUNT_RE.search(page_text or ""))
            and not self._job_fields(fields)
        ):
            return ChallengeHit("account_creation_required", "create_account")
        return None

    def _login(
        self,
        url: str,
        fields: Sequence[Mapping[str, Any]],
        controls: Sequence[Mapping[str, Any]],
        signals: Mapping[str, Any],
    ) -> ChallengeHit | None:
        job_fields = self._job_fields(fields)
        visible_passwords = int(signals.get("password_visible") or 0)
        if visible_passwords and not job_fields:
            return ChallengeHit("login_required", "password_field")
        _host, path = _host_path(url)
        if _LOGIN_PATH_RE.search(path or "") and not job_fields:
            return ChallengeHit("login_required", "login_path", path[:80])
        login_controls = [
            c for c in controls if c.get("role_hint") == "login" and c.get("in_viewport")
        ]
        actionable = [
            c for c in controls if c.get("role_hint") in ("next", "submit", "apply_entry")
        ]
        if login_controls and not job_fields and not actionable and not fields:
            return ChallengeHit("login_required", "login_button")
        return None

    def _credential(self, fields: Sequence[Mapping[str, Any]]) -> ChallengeHit | None:
        for field in fields:
            input_type = str(field.get("input_type") or "")
            if input_type == "password" or credential_name_match(" ".join(_field_names(field))):
                return ChallengeHit(
                    "credential_field", "credential_field", str(field.get("label") or "")[:80]
                )
        return None

    def _payment(self, fields: Sequence[Mapping[str, Any]], page_text: str) -> ChallengeHit | None:
        for field in fields:
            if is_card_field(
                autocomplete=str(field.get("autocomplete") or ""), names=_field_names(field)
            ):
                return ChallengeHit("payment_requested", "card_field")
        labels = " ".join(str(f.get("label") or "") for f in fields)
        if is_payment_text(labels):
            return ChallengeHit("payment_requested", "payment_label")
        if is_payment_text(page_text) and re.search(
            r"\b(pay|fee|biaya|bayar)\b.{0,40}(\$|usd|idr|rp|€|£|\d)", page_text or "", re.I
        ):
            return ChallengeHit("payment_requested", "payment_text")
        return None
