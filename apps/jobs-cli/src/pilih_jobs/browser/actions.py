"""The closed action set of the executor (18 §6.3, 19 §3.2).

Only these nine dataclasses exist. There is **no** `goto(url)` and **no** `evaluate(js)`
action: the only navigations are the executor's own `open_apply_url()` (the URL comes from
D1) and clicks on allowlisted refs (19 §7). The agent builds actions from enumerated
candidates and validated plan items; a model never names a value, a path or a URL.

`SubmitAuthorization` is the token the submit gate issues after the server answered 200
to `submit-intent` (D-28); the executor clicks a `submit` ref only with an unused token
bound to that ref and form hash, and burns it before the click (no second click, ever).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Final, Literal

ClickRole = Literal[
    "next",
    "previous",
    "submit",
    "add_section",
    "remove_section",
    "upload_trigger",
    "apply_entry",
    "cookie_consent_reject",
    "cookie_consent_accept",
]
CLICKABLE_HINTS: Final[frozenset[str]] = frozenset(
    {
        "next",
        "previous",
        "submit",
        "add_section",
        "remove_section",
        "upload_trigger",
        "apply_entry",
        "cookie_consent_reject",
        "cookie_consent_accept",
    }
)
FILLABLE_KINDS: Final[frozenset[str]] = frozenset(
    {"text", "email", "tel", "url", "number", "date", "month", "textarea", "contenteditable"}
)
SELECTABLE_KINDS: Final[frozenset[str]] = frozenset(
    {"select", "combobox", "radio_group", "checkbox_group"}
)
CHECKABLE_KINDS: Final[frozenset[str]] = frozenset({"checkbox", "switch", "radio"})
MAX_WAIT_MS: Final = 15_000
MAX_VALUE_LEN: Final = 4_000


@dataclass
class SubmitAuthorization:
    """Issued by the submit gate after a 200 from `submit-intent`; single use."""

    form_hash: str
    ref: str
    signature: str
    submit_intent_at: int
    approval_id: str | None = None
    rule_id: str | None = None
    used: bool = field(default=False)


@dataclass(frozen=True)
class FillField:
    ref: str
    value: str
    value_source: str


@dataclass(frozen=True)
class SelectOption:
    ref: str
    option_value: str


@dataclass(frozen=True)
class SetCheckbox:
    ref: str
    checked: bool
    option_value: str | None = None


@dataclass(frozen=True)
class UploadFile:
    ref: str
    file_id: str


@dataclass(frozen=True)
class ClickRef:
    ref: str
    role_hint: ClickRole
    authorization: SubmitAuthorization | None = None


@dataclass(frozen=True)
class Scroll:
    ref: str | None
    direction: Literal["down", "up"]


@dataclass(frozen=True)
class WaitFor:
    condition: Literal["network_idle", "ref_visible", "url_change"]
    timeout_ms: int
    ref: str | None = None


@dataclass(frozen=True)
class PauseForHuman:
    reason: str
    message: str


@dataclass(frozen=True)
class Stop:
    outcome: Literal["failed", "cancelled"]
    error_class: str


Action = (
    FillField
    | SelectOption
    | SetCheckbox
    | UploadFile
    | ClickRef
    | Scroll
    | WaitFor
    | PauseForHuman
    | Stop
)
#: The closed set: anything else is rejected before reaching Playwright.
ACTION_TYPES: Final = (
    FillField,
    SelectOption,
    SetCheckbox,
    UploadFile,
    ClickRef,
    Scroll,
    WaitFor,
    PauseForHuman,
    Stop,
)
ACTION_NAMES: Final[dict[type, str]] = {
    FillField: "fill_field",
    SelectOption: "select_option",
    SetCheckbox: "set_checkbox",
    UploadFile: "upload_file",
    ClickRef: "click_ref",
    Scroll: "scroll",
    WaitFor: "wait_for",
    PauseForHuman: "pause_for_human",
    Stop: "stop",
}


def action_name(action: object) -> str:
    return ACTION_NAMES.get(type(action), type(action).__name__)
