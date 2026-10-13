"""Deterministic lexicons the agent applies to (untrusted) field labels (18 §4.3, §8; 19 §6).

- `is_credential_field` — 18 §4.3: the executor never types into `input[type=password]`
  or a field whose accessible name matches
  `/password|passcode|pin\\b|one.?time|otp|verification code/i` (→ `credential_field`).
- `protected_category` — the protected-class lexicon of 19 §6.2 / 03 §9 (a hit forces
  `sensitivity = protected`: never auto-filled, 11 T-14). It mirrors
  `apps/api/src/jobs/ai/lexicon.ts` so server and client agree.
- `is_personal_question` — 03 §9 `personal` (salary, relocation, start date).
- `is_payment_text` — 18 §8 payment requests (the agent never pays).
- `file_slot_of`, `accepts_pdf`, `is_question_field`, `is_free_text_motivation` — the
  file-slot and generated-text rules of 19 §6.3–§6.4.

Labels are page content: these functions only read them.
"""

from __future__ import annotations

import math
import re
from collections.abc import Sequence
from typing import Final, Literal

from pilih_jobs.contracts.fingerprint import normalize_text

# ------------------------------------------------------------------ credentials (18 §4.3)
#: Accessible-name pattern of credential fields, verbatim from 18 §4.3.
CREDENTIAL_NAME_RE: Final = re.compile(
    r"password|passcode|pin\b|one.?time|otp|verification code", re.IGNORECASE
)
#: Extra non-English names of the same thing (kata sandi, contraseña, mot de passe, …).
_CREDENTIAL_EXTRA_RE: Final = re.compile(
    r"kata ?sandi|sandi\b|contrase[ñn]a|mot de passe|passwort|senha|wachtwoord|has[łl]o|"
    r"parola|パスワード|密码|密碼|비밀번호|kode verifikasi|kode otp|security code|"
    r"auth(entication)? code",
    re.IGNORECASE,
)
#: `autocomplete` tokens that mark credential inputs.
CREDENTIAL_AUTOCOMPLETE: Final = frozenset({"current-password", "new-password", "one-time-code"})
#: `<input type>` values the agent never types into.
CREDENTIAL_INPUT_TYPES: Final = frozenset({"password"})


def credential_name_match(text: str | None) -> bool:
    """True when an accessible name / label looks like a password, PIN or OTP field."""
    if not text:
        return False
    return bool(CREDENTIAL_NAME_RE.search(text) or _CREDENTIAL_EXTRA_RE.search(text))


def is_credential_field(
    *,
    input_type: str | None = None,
    autocomplete: str | None = None,
    names: Sequence[str | None] = (),
) -> bool:
    """`input[type=password]`, a credential autocomplete token or a credential-like name."""
    if (input_type or "").strip().lower() in CREDENTIAL_INPUT_TYPES:
        return True
    tokens = set((autocomplete or "").lower().split())
    if tokens & CREDENTIAL_AUTOCOMPLETE:
        return True
    return any(credential_name_match(name) for name in names)


# ------------------------------------------------------------------ OTP / MFA text (18 §8)
_MFA_TEXT_RE: Final = re.compile(
    r"we (have )?(sent|emailed|texted) (you )?(a|an|the|your) (\d-digit )?(code|verification|link)|"
    r"enter the (\d-digit )?code|two[- ]factor|2fa|multi[- ]factor|authenticator app|"
    r"kami (telah )?mengirim(kan)? kode|masukkan kode",
    re.IGNORECASE,
)


def is_mfa_text(text: str | None) -> bool:
    return bool(text and _MFA_TEXT_RE.search(text))


# ------------------------------------------------------------------ payment (18 §8)
_PAYMENT_RE: Final = re.compile(
    r"\b(card number|credit card|debit card|cvv|cvc|expiry date|expiration date|"
    r"payment|pay now|application fee|processing fee|registration fee|fee of|"
    r"pembayaran|biaya pendaftaran|nomor kartu|bayar sekarang)\b",
    re.IGNORECASE,
)
_CARD_AUTOCOMPLETE: Final = frozenset({"cc-number", "cc-csc", "cc-exp", "cc-name", "cc-type"})


def is_payment_text(text: str | None) -> bool:
    return bool(text and _PAYMENT_RE.search(text))


def is_card_field(*, autocomplete: str | None, names: Sequence[str | None]) -> bool:
    tokens = set((autocomplete or "").lower().split())
    if tokens & _CARD_AUTOCOMPLETE:
        return True
    return any(
        bool(
            name
            and re.search(r"card ?number|credit ?card|cvv|cvc|nomor kartu", name, re.IGNORECASE)
        )
        for name in names
    )


# ------------------------------------------------------------------ protected (19 §6.2)
ProtectedCategory = Literal[
    "gender",
    "race_ethnicity",
    "disability",
    "veteran",
    "sexual_orientation",
    "criminal_history",
    "age",
    "religion",
    "health",
    "union",
    "citizenship_visa",
]

_PROTECTED_LEXICON: Final[tuple[tuple[ProtectedCategory, re.Pattern[str]], ...]] = (
    (
        "gender",
        re.compile(r"\b(gender|sex|pronouns?|male|female|non-binary|jenis kelamin|kelamin)\b"),
    ),
    (
        "race_ethnicity",
        re.compile(r"\b(race|racial|ethnicity|ethnic|hispanic|latino|latinx|suku|ras|etnis)\b"),
    ),
    (
        "disability",
        re.compile(
            r"\b(disability|disabilities|disabled|impairment|accommodation|difabel|"
            r"disabilitas|penyandang)\b"
        ),
    ),
    (
        "veteran",
        re.compile(r"\b(veteran|veterans|military service|armed forces|protected veteran)\b"),
    ),
    (
        "sexual_orientation",
        re.compile(
            r"\b(sexual orientation|lgbtq?|lgbtqia|heterosexual|homosexual|bisexual|gay|"
            r"lesbian|orientasi seksual)\b"
        ),
    ),
    (
        "criminal_history",
        re.compile(
            r"\b(criminal|conviction|convicted|felony|felonies|misdemeanou?r|arrest|arrested|"
            r"offen[cs]e record|catatan kriminal|skck|pidana)\b"
        ),
    ),
    (
        "age",
        re.compile(
            r"\b(date of birth|birth ?date|birthday|dob|how old|age|tanggal lahir|tgl lahir|"
            r"usia|umur)\b"
        ),
    ),
    ("religion", re.compile(r"\b(religion|religious|faith|church|mosque|agama|keyakinan)\b")),
    (
        "health",
        re.compile(
            r"\b(health|medical|medication|pregnan\w*|illness|diagnos\w*|kesehatan|"
            r"riwayat penyakit|vaccinat\w*)\b"
        ),
    ),
    ("union", re.compile(r"\b(union membership|labou?r union|trade union|serikat pekerja)\b")),
    (
        "citizenship_visa",
        re.compile(
            r"\b(citizen|citizenship|nationality|visa|sponsor|sponsorship|"
            r"work authori[sz]ation|authori[sz]ed to work|right to work|work permit|immigration|"
            r"green card|kewarganegaraan|warga negara|izin kerja)\b"
        ),
    ),
)

#: "Are you 18 or older?" is an eligibility check, not an age question (19 §6.4).
_AGE_ELIGIBILITY_RE: Final = re.compile(
    r"\b(18|eighteen|delapan belas)\b.*\b(older|over|at least|of age|years|tahun|lebih)\b|"
    r"\b(at least|over)\b.*\b18\b"
)


def protected_category(text: str | None) -> ProtectedCategory | None:
    """The protected class a label / description asks about, or None (19 §6.2)."""
    normalized = normalize_text(text)
    if not normalized:
        return None
    for category, pattern in _PROTECTED_LEXICON:
        if pattern.search(normalized):
            if category == "age" and _AGE_ELIGIBILITY_RE.search(normalized):
                continue
            return category
    return None


_PERSONAL_RE: Final = re.compile(
    r"\b(salary|compensation|pay expectations?|expected pay|current pay|wage|remuneration|"
    r"gaji|upah|relocat\w*|relokasi|pindah|start date|earliest start|available to start|"
    r"availability date|mulai bekerja|tanggal mulai)\b"
)


def is_personal_question(text: str | None) -> bool:
    """03 §9 `personal`: salary, relocation, start date."""
    return bool(_PERSONAL_RE.search(normalize_text(text)))


# ------------------------------------------------------------------ files and free text
_RESUME_RE: Final = re.compile(r"\b(resume|résumé|cv|curriculum vitae|daftar riwayat hidup)\b")
_COVER_RE: Final = re.compile(r"\b(cover letter|motivation letter|surat lamaran|surat motivasi)\b")
_PDF_ACCEPT_RE: Final = re.compile(r"(^|[,\s])(\.pdf|application/pdf|\*/\*|\*)($|[,\s])", re.I)

FileSlot = Literal["cv_file", "cover_letter_file"]


def file_slot_of(label: str | None, description: str | None = None) -> FileSlot | None:
    """Which file slot a file field asks for (19 §6.3)."""
    text = normalize_text(f"{label or ''} {description or ''}")
    if _COVER_RE.search(text):
        return "cover_letter_file"
    return "cv_file" if _RESUME_RE.search(text) else None


def accepts_pdf(accept: str | None) -> bool:
    """A file input takes a PDF: no `accept`, or one that lists PDF / any (19 §6.3)."""
    if not accept or not accept.strip():
        return True
    return bool(_PDF_ACCEPT_RE.search(accept.strip()))


_YES_NO_RE: Final = re.compile(
    r"^(yes|no|ya|tidak|true|false|y|n|iya|bukan|prefer not to say|decline to self-identify|"
    r"i don ?'?t wish to answer)$"
)
_RANGE_RE: Final = re.compile(
    r"^(\d+\s*(-|–|to|sampai)\s*\d+|\d+\+?|less than \d+|more than \d+|< ?\d+|> ?\d+)(\s*\w+)?$"
)
_CONTACT_SECTION_RE: Final = re.compile(
    r"\b(contact|personal (info|information|details)|education|kontak|data diri|pendidikan)\b"
)


def is_question_field(
    *, label: str, kind: str, option_labels: Sequence[str], section: str | None
) -> bool:
    """19 §6.2: label ends with "?", yes/no or range options, or a free-text box elsewhere."""
    if label.strip().endswith("?"):
        return True
    options = [normalize_text(option) for option in option_labels]
    options = [option for option in options if option]
    if len(options) >= 2 and (
        all(_YES_NO_RE.match(option) for option in options)
        or sum(1 for option in options if _RANGE_RE.match(option)) >= math.ceil(len(options) / 2)
    ):
        return True
    return kind == "textarea" and not _CONTACT_SECTION_RE.search(normalize_text(section))


_MOTIVATION_RE: Final = re.compile(
    r"\b(cover letter|motivation|why (do )?you want|why are you interested|"
    r"why (this|our) (company|role)|tell us about yourself|additional information|"
    r"anything else|surat lamaran|motivasi|informasi tambahan)\b"
)


def is_free_text_motivation(
    *, label: str, description: str, kind: str, section: str | None
) -> bool:
    """Free-text fields where generated text may ever be proposed (19 §6.4)."""
    return kind in ("textarea", "contenteditable", "text") and bool(
        _MOTIVATION_RE.search(normalize_text(f"{label} {description} {section or ''}"))
    )
