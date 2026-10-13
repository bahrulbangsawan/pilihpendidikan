"""ActionExecutor: the closed action set with pre- and postconditions (18 §6.3).

Columns: Action / Preconditions / Postcondition.

- fill_field: preconditions fillable kind; not password/OTP; visible; enabled; not readonly;
  postcondition value equals (tel/date normalized); no new `aria-invalid`
- select_option: preconditions select with that option, combobox with an exact option name,
  radio/checkbox group member; postcondition selected value / label equals
- set_checkbox: preconditions checkbox / switch / radio (radio: checked only); postcondition
  `is_checked()` equals
- upload_file: preconditions file kind; staged; SHA-256 re-checked; accept ok; postcondition
  input file name or ATS echo
- click_ref: preconditions allowlisted role hint; `submit` needs the submit gate's unused
  authorization for this ref + form; postcondition navigation, DOM mutation or validation
  messages within 10 s
- scroll: preconditions —; postcondition —
- wait_for: preconditions condition ∈ network_idle/ref_visible/url_change, timeout ≤ 15 s;
  postcondition condition met, else `timeout`
- pause / stop: preconditions — (handled by the agent loop); postcondition —

Before every action the executor checks the stop signal (lease lost → stop acting at once,
21 §5.3), the session health and the navigation guard (off-allowlist pages are observe
only). Playwright errors become `pilih_jobs.browser.errors` classes.
"""

from __future__ import annotations

import asyncio
import contextlib
import re
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import PurePath
from typing import Any, Final

from playwright.async_api import Error as PlaywrightError
from playwright.async_api import Frame, Locator
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from pilih_jobs.browser.actions import (
    ACTION_TYPES,
    CHECKABLE_KINDS,
    CLICKABLE_HINTS,
    FILLABLE_KINDS,
    MAX_VALUE_LEN,
    MAX_WAIT_MS,
    ClickRef,
    FillField,
    PauseForHuman,
    Scroll,
    SelectOption,
    SetCheckbox,
    Stop,
    UploadFile,
    WaitFor,
    action_name,
)
from pilih_jobs.browser.errors import (
    ActionRejectedError,
    ActionsDisabledError,
    ActionTimeoutError,
    BrowserCrashedError,
    CredentialFieldError,
    PageClosedError,
    PostconditionError,
    StaleRefError,
    SubmitNotAuthorizedError,
)
from pilih_jobs.browser.observer import FieldState, Observation, PageObserver
from pilih_jobs.browser.session import PageSession
from pilih_jobs.browser.staging import UploadStager
from pilih_jobs.policy.domains import url_scheme
from pilih_jobs.policy.sensitivity import is_credential_field

#: The observer's own mutation counter (installed by extract_form.v1.js). A constant
#: script: nothing the page or a model says ever reaches `evaluate`.
_MUTATIONS_JS: Final = "() => window.__pjMutations || 0"
_CONTROL_RE: Final = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_DIGITS_RE: Final = re.compile(r"\D+")


@dataclass
class ActionResult:
    ok: bool
    action: str
    ref: str | None
    postcondition: str
    duration_ms: int
    url_before: str
    url_after: str
    navigated: bool = False
    detail: str | None = None


def _norm(value: str) -> str:
    return " ".join(value.replace("\r\n", "\n").split())


def values_match(kind: str, expected: str, actual: str) -> bool:
    """Postcondition equality, normalized for tel / date formatting only."""
    if kind == "tel":
        exp, act = _DIGITS_RE.sub("", expected), _DIGITS_RE.sub("", actual)
        return bool(exp) and (exp == act or exp.endswith(act) or act.endswith(exp))
    if kind in ("date", "month"):
        return _DIGITS_RE.sub("", expected) == _DIGITS_RE.sub("", actual)
    if kind == "textarea" or kind == "contenteditable":
        return _norm(expected) == _norm(actual)
    return expected == actual or expected.strip() == actual.strip()


def accept_allows(accept: str | None, filename: str) -> bool:
    """`accept` lists the staged file's extension or MIME type (or is empty / any)."""
    if not accept or not accept.strip():
        return True
    ext = PurePath(filename).suffix.lower()
    mime = {
        ".pdf": "application/pdf",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }.get(ext, "")
    for token in (t.strip().lower() for t in accept.split(",")):
        if not token:
            continue
        if token in ("*", "*/*") or token == ext or (mime and token == mime):
            return True
        if mime and token.endswith("/*") and mime.startswith(token[:-1]):
            return True
    return False


class ActionExecutor:
    def __init__(
        self,
        session: PageSession,
        observer: PageObserver,
        stager: UploadStager | None,
        *,
        stop_check: Callable[[], None],
        prefer_file_chooser: bool = True,
        click_effect_timeout_s: float = 10.0,
    ) -> None:
        self.session = session
        self.observer = observer
        self.stager = stager
        self.stop_check = stop_check
        self.prefer_file_chooser = prefer_file_chooser
        self.click_effect_timeout_s = click_effect_timeout_s
        self.executed = 0

    # ------------------------------------------------------------------ entry
    async def execute(self, action: object, observation: Observation) -> ActionResult:
        if not isinstance(action, ACTION_TYPES):
            raise ActionRejectedError(
                f"{type(action).__name__} is not an executor action.", reason="unknown_action"
            )
        self.stop_check()
        self.session.raise_if_broken()
        name = action_name(action)
        started = time.monotonic()
        url_before = self.session.url
        if isinstance(action, PauseForHuman | Stop):
            if isinstance(action, PauseForHuman):
                await self.session.bring_to_front()
            return ActionResult(True, name, None, "handled_by_agent", 0, url_before, url_before)
        if not self.session.actions_enabled:
            raise ActionsDisabledError(
                "This page is not on the task's domain allowlist; actions are disabled.",
                reason="off_allowlist",
            )
        try:
            result = await self._dispatch(action, observation)
        except PlaywrightTimeoutError as exc:
            raise ActionTimeoutError(f"{name} timed out.") from exc
        except PlaywrightError as exc:
            raise self._translate(exc, name) from exc
        result.duration_ms = int((time.monotonic() - started) * 1000)
        self.executed += 1
        return result

    async def _dispatch(self, action: object, observation: Observation) -> ActionResult:
        if isinstance(action, FillField):
            return await self.fill_field(action, observation)
        if isinstance(action, SelectOption):
            return await self.select_option(action, observation)
        if isinstance(action, SetCheckbox):
            return await self.set_checkbox(action, observation)
        if isinstance(action, UploadFile):
            return await self.upload_file(action, observation)
        if isinstance(action, ClickRef):
            return await self.click_ref(action, observation)
        if isinstance(action, Scroll):
            return await self.scroll(action, observation)
        if isinstance(action, WaitFor):
            return await self.wait_for(action, observation)
        raise ActionRejectedError("Unknown action.", reason="unknown_action")

    def _translate(self, exc: PlaywrightError, name: str) -> Exception:
        text = str(exc)
        if self.session.closed_by_user:
            return PageClosedError("The application tab was closed.")
        if "strict mode violation" in text:
            return StaleRefError("The element is ambiguous on the page.", reason="ambiguous_ref")
        if "Target page, context or browser has been closed" in text or "crashed" in text:
            return BrowserCrashedError("The browser closed during an action.")
        return ActionRejectedError(
            f"{name} failed: {text.splitlines()[0][:200]}", reason="playwright"
        )

    def _field(self, ref: str, observation: Observation) -> FieldState:
        field = observation.field(ref)
        if field is None:
            raise StaleRefError(f"No field {ref} in the current observation.", reason="unknown_ref")
        return field

    def _frame(self, field_frame: int) -> Frame:
        frame = self.observer.registry.frame_for(field_frame)
        if frame is None:
            raise StaleRefError("The frame of this element is gone.", reason="frame_gone")
        return frame

    async def _guard(self) -> None:
        """Re-check the stop signal between precondition checks and the Playwright call."""
        self.stop_check()
        self.session.raise_if_broken()

    # ------------------------------------------------------------------ fill_field
    async def _assert_not_credential(self, field: FieldState, locator: Locator) -> None:
        live_type = (await locator.get_attribute("type") or "").lower()
        live_auto = await locator.get_attribute("autocomplete")
        live_label = await locator.get_attribute("aria-label")
        if is_credential_field(
            input_type=live_type or field.input_type,
            autocomplete=live_auto or field.autocomplete,
            names=[field.label, field.name, field.id_attr, field.description, live_label],
        ):
            raise CredentialFieldError(
                "The agent never types into password, PIN or one-time-code fields.",
                reason="credential_field",
            )

    async def fill_field(self, action: FillField, observation: Observation) -> ActionResult:
        field = self._field(action.ref, observation)
        if field.kind not in FILLABLE_KINDS:
            raise ActionRejectedError(f"fill_field on a {field.kind} field.", reason="wrong_kind")
        if is_credential_field(
            input_type=field.input_type,
            autocomplete=field.autocomplete,
            names=[field.label, field.name, field.id_attr, field.description],
        ):
            raise CredentialFieldError(
                "The agent never types into password, PIN or one-time-code fields.",
                reason="credential_field",
            )
        value = action.value
        if len(value) > MAX_VALUE_LEN or (
            _CONTROL_RE.search(value) and field.kind not in ("textarea", "contenteditable")
        ):
            raise ActionRejectedError("The value is not typeable.", reason="bad_value")
        ref, locator = await self.observer.resolve(action.ref)
        await self._assert_not_credential(field, locator)
        if not await locator.is_visible():
            raise ActionRejectedError("The field is not visible.", reason="not_visible")
        if not await locator.is_enabled():
            raise ActionRejectedError("The field is disabled.", reason="disabled")
        if not await locator.is_editable():
            raise ActionRejectedError("The field is read-only.", reason="readonly")
        was_invalid = (await locator.get_attribute("aria-invalid")) == "true"
        url_before = self.session.url
        await self._guard()
        masked = field.masked or (
            field.kind in ("date", "month") and field.input_type not in ("date", "month")
        )
        if masked:
            await locator.fill("")
            await locator.press_sequentially(value, delay=20)
        else:
            await locator.fill(value)
        actual = (
            await locator.inner_text()
            if field.kind == "contenteditable"
            else await locator.input_value()
        )
        if not values_match(field.kind, value, actual):
            raise PostconditionError("The field did not keep the value.", check="value_match")
        if not was_invalid and (await locator.get_attribute("aria-invalid")) == "true":
            raise PostconditionError("The field reported a validation error.", check="aria_invalid")
        return ActionResult(True, "fill_field", ref, "value_match", 0, url_before, self.session.url)

    # ------------------------------------------------------------------ select_option
    async def _group_members(self, field: FieldState, ref: str) -> list[Locator]:
        frame = self._frame(field.frame_number)
        return await frame.locator(f'[data-pj-group="{ref}"]').all()

    @staticmethod
    async def _member_value(member: Locator) -> str:
        for attr in ("value", "data-value"):
            value = await member.get_attribute(attr)
            if value is not None:
                return value
        member_id = await member.get_attribute("id")
        if member_id:
            return member_id
        return " ".join((await member.inner_text()).split())

    async def select_option(self, action: SelectOption, observation: Observation) -> ActionResult:
        field = self._field(action.ref, observation)
        target = action.option_value
        url_before = self.session.url
        if field.kind == "select":
            if target not in field.option_values():
                raise ActionRejectedError("That option does not exist.", reason="no_such_option")
            ref, locator = await self.observer.resolve(action.ref)
            if not await locator.is_enabled():
                raise ActionRejectedError("The select is disabled.", reason="disabled")
            await self._guard()
            await locator.select_option(value=target)
            if await locator.input_value() != target:
                raise PostconditionError("The option was not selected.", check="selected_value")
            return ActionResult(
                True, "select_option", ref, "selected_value", 0, url_before, self.session.url
            )
        if field.kind in ("radio_group", "checkbox_group"):
            if target not in field.option_values():
                raise ActionRejectedError("That option does not exist.", reason="no_such_option")
            ref, _locator = await self.observer.resolve(action.ref)
            members = await self._group_members(field, ref)
            for member in members:
                if await self._member_value(member) != target:
                    continue
                await self._guard()
                if (await member.get_attribute("type")) in ("radio", "checkbox"):
                    await member.check()
                else:
                    await member.click()
                if not await member.is_checked():
                    raise PostconditionError("The option was not checked.", check="is_checked")
                return ActionResult(
                    True, "select_option", ref, "is_checked", 0, url_before, self.session.url
                )
            raise ActionRejectedError("That option is not on the page.", reason="no_such_option")
        if field.kind == "combobox":
            allowed = field.option_values()
            if field.options and target not in allowed:
                raise ActionRejectedError("That option does not exist.", reason="no_such_option")
            label = field.option_label(target) or target
            ref, locator = await self.observer.resolve(action.ref)
            frame = self._frame(field.frame_number)
            await self._guard()
            await locator.click()
            if field.tag == "input":  # a text input with a listbox: type the label
                await locator.fill(label)
            option = frame.get_by_role("option", name=label, exact=True)
            await option.first.wait_for(state="visible", timeout=5_000)
            if await option.count() != 1:
                raise ActionRejectedError(
                    "The option name is ambiguous.", reason="ambiguous_option"
                )
            await self._guard()
            await option.click()
            actual = (
                await locator.input_value() if field.tag == "input" else await locator.inner_text()
            )
            if label.strip().lower() not in actual.strip().lower() and target not in actual:
                raise PostconditionError(
                    "The combobox did not keep the option.", check="selected_label"
                )
            return ActionResult(
                True, "select_option", ref, "selected_label", 0, url_before, self.session.url
            )
        raise ActionRejectedError(f"select_option on a {field.kind} field.", reason="wrong_kind")

    # ------------------------------------------------------------------ set_checkbox
    async def set_checkbox(self, action: SetCheckbox, observation: Observation) -> ActionResult:
        field = self._field(action.ref, observation)
        url_before = self.session.url
        if field.kind == "checkbox_group" and action.option_value is not None:
            return await self.select_option(
                SelectOption(action.ref, action.option_value), observation
            )
        kind = "radio" if field.input_type == "radio" else field.kind
        if kind not in CHECKABLE_KINDS:
            raise ActionRejectedError(f"set_checkbox on a {field.kind} field.", reason="wrong_kind")
        if kind == "radio" and not action.checked:
            raise ActionRejectedError("A radio can only be checked.", reason="radio_uncheck")
        ref, locator = await self.observer.resolve(action.ref)
        if not await locator.is_enabled():
            raise ActionRejectedError("The checkbox is disabled.", reason="disabled")
        await self._guard()
        await locator.set_checked(action.checked)
        if await locator.is_checked() != action.checked:
            raise PostconditionError("The checkbox state did not change.", check="is_checked")
        return ActionResult(
            True, "set_checkbox", ref, "is_checked", 0, url_before, self.session.url
        )

    # ------------------------------------------------------------------ upload_file
    async def upload_file(self, action: UploadFile, observation: Observation) -> ActionResult:
        field = self._field(action.ref, observation)
        if field.kind != "file":
            raise ActionRejectedError("upload_file on a non-file field.", reason="wrong_kind")
        if self.stager is None:
            raise ActionRejectedError("No staged files for this task.", reason="not_staged")
        staged = await asyncio.to_thread(self.stager.verified, action.file_id)
        if not accept_allows(field.accept, staged.name):
            raise ActionRejectedError(
                "The field does not accept this file type.", reason="unsupported_file_type"
            )
        ref, locator = await self.observer.resolve(action.ref)
        url_before = self.session.url
        path = str(staged.path)
        use_chooser = self.prefer_file_chooser and field.hidden_input and field.trigger_ref
        await self._guard()
        if use_chooser and field.trigger_ref:
            _trigger_ref, trigger = await self.observer.resolve(field.trigger_ref)
            page = self.session.page
            async with page.expect_file_chooser(timeout=10_000) as chooser_info:
                await trigger.click()
            chooser = await chooser_info.value
            await chooser.set_files(path)
            postcondition = "file_chooser"
        else:
            await locator.set_input_files(path)
            postcondition = "set_input_files"
        if not await self._upload_echoed(locator, field, staged.name):
            raise PostconditionError("The upload was not accepted.", check="file_name")
        return ActionResult(
            True, "upload_file", ref, postcondition, 0, url_before, self.session.url
        )

    async def _upload_echoed(self, locator: Locator, field: FieldState, name: str) -> bool:
        with contextlib.suppress(PlaywrightError):
            value = await locator.input_value()
            if PurePath(value.replace("\\", "/")).name == name:
                return True
        frame = self._frame(field.frame_number)
        deadline = time.monotonic() + 5.0
        while time.monotonic() < deadline:
            with contextlib.suppress(PlaywrightError):
                if await frame.get_by_text(name, exact=False).count() > 0:
                    return True
            await asyncio.sleep(0.2)
        return False

    # ------------------------------------------------------------------ click_ref
    async def _mutations(self) -> int:
        with contextlib.suppress(PlaywrightError):
            value: Any = await self.session.page.evaluate(_MUTATIONS_JS)
            return int(value or 0)
        return -1

    async def click_ref(self, action: ClickRef, observation: Observation) -> ActionResult:
        control = observation.control(action.ref)
        if control is None:
            raise StaleRefError(
                f"No control {action.ref} in the observation.", reason="unknown_ref"
            )
        if action.role_hint not in CLICKABLE_HINTS or control.role_hint not in CLICKABLE_HINTS:
            raise ActionRejectedError(
                f"Controls with role {control.role_hint} are never clicked.",
                reason="role_not_allowed",
            )
        if action.role_hint != control.role_hint and action.role_hint != "submit":
            raise ActionRejectedError(
                "The role hint does not match the control.", reason="role_mismatch"
            )
        if not control.enabled:
            raise ActionRejectedError("The control is disabled.", reason="disabled")
        targets = [control.form_action, control.href if control.kind == "link" else None]
        for target in targets:
            web = bool(target) and url_scheme(target or "") in ("http", "https")
            if web and not self.session.allowlist.allows_url(target or ""):
                # A form posting (or a link leading) off the allowlist would send the
                # applicant's data elsewhere (19 §7): never click it.
                raise ActionRejectedError(
                    "The control leads off the task's domain allowlist.",
                    reason="target_off_allowlist",
                )
        is_submit = action.role_hint == "submit" or control.role_hint == "submit"
        auth = action.authorization
        if is_submit:
            if (
                auth is None
                or auth.used
                or auth.submit_intent_at <= 0
                or auth.ref != action.ref
                or auth.signature != control.signature
                or auth.form_hash != observation.form_hash
            ):
                raise SubmitNotAuthorizedError(
                    "Submit is clicked only after an acknowledged submit_intent.",
                    reason="no_submit_intent",
                )
        elif auth is not None:
            raise ActionRejectedError(
                "Authorization on a non-submit click.", reason="role_mismatch"
            )
        ref, locator = await self.observer.resolve(action.ref)
        page = self.session.page
        url_before = self.session.url
        mutations_before = await self._mutations()
        responses_before = len(self.session.network)
        await locator.click(trial=True)
        await self._guard()
        if is_submit and auth is not None:
            auth.used = True  # burnt before the click: no second click, ever (19 §8.2)
        self.session.planned_navigation = True
        try:
            await locator.click(no_wait_after=is_submit)
        finally:
            self.session.planned_navigation = False
        effect = await self._wait_effect(page, url_before, mutations_before, responses_before)
        return ActionResult(
            True,
            "click_ref",
            ref,
            effect,
            0,
            url_before,
            self.session.url,
            navigated=self.session.url != url_before,
        )

    async def _wait_effect(
        self, page: Any, url_before: str, mutations_before: int, responses_before: int
    ) -> str:
        deadline = time.monotonic() + self.click_effect_timeout_s
        while time.monotonic() < deadline:
            if self.session.page is not page:
                return "popup_adopted"
            if self.session.closed_by_user or self.session.crashed:
                return "page_closed"
            if self.session.url != url_before:
                await self.session.settle()
                return "navigation"
            if len(self.session.network) != responses_before:
                await self.session.settle()
                return "network_response"
            current = await self._mutations()
            if current != mutations_before and current >= 0:
                await asyncio.sleep(0.15)
                return "dom_mutation"
            await asyncio.sleep(0.1)
        return "no_effect"

    # ------------------------------------------------------------------ scroll / wait
    async def scroll(self, action: Scroll, observation: Observation) -> ActionResult:
        url_before = self.session.url
        if action.ref is not None:
            ref, locator = await self.observer.resolve(action.ref)
            await self._guard()
            await locator.scroll_into_view_if_needed()
            return ActionResult(True, "scroll", ref, "none", 0, url_before, self.session.url)
        await self._guard()
        delta = 700 if action.direction == "down" else -700
        await self.session.page.mouse.wheel(0, delta)
        return ActionResult(True, "scroll", None, "none", 0, url_before, self.session.url)

    async def wait_for(self, action: WaitFor, observation: Observation) -> ActionResult:
        if action.timeout_ms <= 0 or action.timeout_ms > MAX_WAIT_MS:
            raise ActionRejectedError("wait_for timeout must be ≤ 15 s.", reason="bad_timeout")
        url_before = self.session.url
        page = self.session.page
        await self._guard()
        try:
            if action.condition == "network_idle":
                await page.wait_for_load_state("networkidle", timeout=action.timeout_ms)
            elif action.condition == "url_change":
                await page.wait_for_url(lambda url: url != url_before, timeout=action.timeout_ms)
            elif action.condition == "ref_visible" and action.ref is not None:
                _ref, locator = await self.observer.resolve(action.ref)
                await locator.wait_for(state="visible", timeout=action.timeout_ms)
            else:
                raise ActionRejectedError("Unknown wait condition.", reason="bad_condition")
        except PlaywrightTimeoutError:
            return ActionResult(
                False, "wait_for", action.ref, "timeout", 0, url_before, self.session.url
            )
        return ActionResult(
            True, "wait_for", action.ref, "condition_met", 0, url_before, self.session.url
        )
