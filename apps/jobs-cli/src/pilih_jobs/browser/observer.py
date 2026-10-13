"""PageObserver and ElementRegistry (18 §6.2).

An observation has three parts:

1. page meta — URL, origin, title, main-response status, frames, dialogs;
2. the accessibility snapshot `page.aria_snapshot(mode="ai", depth=12)`, truncated to
   24 KB with the main landmark first — **context for the model only**, never used to
   target elements (Python has no `getByRef`);
3. the static extraction script `js/extract_form.v1.js`, evaluated in the main frame and
   every same-origin frame (and cross-origin frames on the allowlist); other cross-origin
   frames become `opaque_regions`.

Signatures: `sha256(kind | normalized label | name | form action path)[:16]` — stable
across re-renders and reloads; used for checkpoints, ref re-resolution and approvals.
Form hash: `sha256` over the sorted `(signature, kind, required, options_hash,
value_hash)` of every field (03 §8). Raw field values stay in memory only.

`ElementRegistry` maps `ref → {frame, signature, kind, role_hint}`; every action targets
`frame.locator('[data-pj-ref="<ref>"]')`. A vanished ref is re-resolved by signature; a
missing or ambiguous signature raises `stale_ref` and the loop re-observes.
"""

from __future__ import annotations

import asyncio
import contextlib
import hashlib
import json
from dataclasses import dataclass, field
from functools import cache
from importlib import resources
from typing import Any, Final, cast

from playwright.async_api import Error as PlaywrightError
from playwright.async_api import Frame, Locator, Page
from playwright.async_api import TimeoutError as PlaywrightTimeoutError

from pilih_jobs.browser.challenge import ChallengeDetector, ChallengeHit
from pilih_jobs.browser.errors import BrowserCrashedError, StaleRefError
from pilih_jobs.browser.lexicon import classify_control
from pilih_jobs.browser.session import PageSession
from pilih_jobs.contracts.fingerprint import normalize_text
from pilih_jobs.contracts.ids import new_id
from pilih_jobs.contracts.psl import ascii_host, registrable_domain
from pilih_jobs.contracts.wire import clip_utf16
from pilih_jobs.policy.untrusted import clip, redact_excerpt, strip_markers

EXTRACT_SCRIPT_NAME: Final = "extract_form.v1.js"
ARIA_LIMIT: Final = 24_576
TEXT_EXCERPT_LIMIT: Final = 8_192
MAX_FIELDS: Final = 300
MAX_CONTROLS: Final = 80
MAX_OPTIONS: Final = 200
FRAME_EVAL_TIMEOUT_S: Final = 10.0


@cache
def extract_script() -> str:
    """The static, versioned extraction script (18 §6.2)."""
    return (
        resources.files("pilih_jobs.browser")
        .joinpath("js", EXTRACT_SCRIPT_NAME)
        .read_text(encoding="utf-8")
    )


def sha256_hex(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8", "surrogatepass")).hexdigest()


def field_signature(kind: str, label: str, name: str | None, action_path: str | None) -> str:
    raw = "|".join((kind, normalize_text(label), name or "", action_path or ""))
    return sha256_hex(raw)[:16]


def control_signature(kind: str, text: str, action_path: str | None) -> str:
    return sha256_hex("|".join(("control", kind, normalize_text(text), action_path or "")))[:16]


@dataclass
class FieldState:
    """One extracted field; `value` is the raw in-memory value (never logged)."""

    ref: str
    kind: str
    tag: str
    label: str
    label_sources: list[str]
    description: str
    required: bool
    options: list[dict[str, Any]]
    options_dynamic: bool
    accept: str | None
    multiple: bool
    value: str
    checked: bool | None
    has_value: bool
    disabled: bool
    readonly: bool
    invalid: bool
    validation_message: str | None
    section: str | None
    name: str | None
    id_attr: str | None
    input_type: str | None
    autocomplete: str | None
    action_path: str
    in_viewport: bool
    hidden_input: bool
    trigger_ref: str | None
    masked: bool
    file_names: list[str]
    frame_number: int
    signature: str
    user_touched: bool = False

    @property
    def options_hash(self) -> str:
        return sha256_hex(
            json.dumps(
                [[o.get("value"), o.get("label"), bool(o.get("disabled"))] for o in self.options],
                ensure_ascii=False,
            )
        )

    @property
    def value_hash(self) -> str:
        return sha256_hex(f"{self.value}\x1f{self.checked}\x1f{'|'.join(self.file_names)}")

    def option_values(self, *, enabled_only: bool = True) -> list[str]:
        return [
            str(o.get("value") or "")
            for o in self.options
            if not (enabled_only and o.get("disabled"))
        ]

    def option_label(self, value: str) -> str | None:
        for option in self.options:
            if str(option.get("value")) == value:
                return str(option.get("label") or value)
        return None

    def to_contract(self) -> dict[str, Any]:
        return {
            "ref": self.ref,
            "signature": self.signature,
            "kind": self.kind,
            "label": clip(self.label, 300),
            "label_sources": self.label_sources[:8],
            "description": clip(self.description, 300),
            "required": self.required,
            "options": [
                {
                    "value": clip(str(o.get("value") or ""), 200),
                    "label": clip(str(o.get("label") or ""), 200),
                    "selected": bool(o.get("selected")),
                    "disabled": bool(o.get("disabled")),
                }
                for o in self.options[:MAX_OPTIONS]
            ],
            "options_dynamic": self.options_dynamic,
            "accept": clip(self.accept, 200) if self.accept else None,
            "multiple": self.multiple,
            "has_value": self.has_value,
            "user_touched": self.user_touched,
            "invalid": self.invalid,
            "validation_message": clip(self.validation_message, 300)
            if self.validation_message
            else None,
            "section": clip(self.section, 120) if self.section else None,
        }


@dataclass
class ControlState:
    ref: str
    kind: str
    text: str
    role_hint: str
    enabled: bool
    in_viewport: bool
    href: str | None
    in_form: bool
    form_has_fields: bool
    in_cookie_banner: bool
    upload_for: str | None
    frame_number: int
    signature: str
    form_action: str | None = None

    def to_contract(self) -> dict[str, Any]:
        return {
            "ref": self.ref,
            "kind": self.kind,
            "text": clip(self.text, 120),
            "role_hint": self.role_hint,
            "enabled": self.enabled,
            "in_viewport": self.in_viewport,
        }


@dataclass
class Observation:
    """One PageObservation (19 §3.1) plus the in-memory state the executor needs."""

    observation_id: str
    attempt_id: str
    step: int
    url: str
    origin: str
    registrable_domain: str
    allowlisted: bool
    title: str
    http_status: int | None
    aria_snapshot: str
    snapshot_sha256: str
    snapshot_size: int
    text_excerpt: str
    raw_text: str
    fields: list[FieldState]
    controls: list[ControlState]
    errors: list[dict[str, Any]]
    opaque_regions: list[dict[str, str]]
    challenge: ChallengeHit | None
    form_hash: str
    structure_hash: str
    confirm_hits: dict[str, bool]
    frame_urls: list[str]
    signals: dict[str, Any] = field(default_factory=lambda: {})
    screenshot_jpeg_b64: str | None = None

    def field(self, ref: str) -> FieldState | None:
        return next((f for f in self.fields if f.ref == ref), None)

    def control(self, ref: str) -> ControlState | None:
        return next((c for c in self.controls if c.ref == ref), None)

    def fields_by_signature(self, signature: str) -> list[FieldState]:
        return [f for f in self.fields if f.signature == signature]

    def application_fields(self) -> list[FieldState]:
        return [f for f in self.fields if f.input_type != "password"]

    def to_contract(self) -> dict[str, Any]:
        return {
            "observation_id": self.observation_id,
            "attempt_id": self.attempt_id,
            "step": self.step,
            "url": self.url,
            "origin": self.origin,
            "registrable_domain": self.registrable_domain,
            "allowlisted": self.allowlisted,
            "title": clip(self.title, 200),
            "http_status": self.http_status,
            "aria_snapshot": clip_utf16(self.aria_snapshot, ARIA_LIMIT),
            "visible_text_excerpt": clip_utf16(self.text_excerpt, TEXT_EXCERPT_LIMIT),
            "fields": [f.to_contract() for f in self.fields[:MAX_FIELDS]],
            "controls": [c.to_contract() for c in self.controls[:MAX_CONTROLS]],
            "errors": [
                {"ref": e.get("ref"), "text": clip(str(e.get("text") or ""), 300)}
                for e in self.errors[:30]
            ],
            "opaque_regions": [
                {"origin": r["origin"], "title": clip(r.get("title"), 120)}
                for r in self.opaque_regions[:10]
            ],
            "challenge": {
                "detected": self.challenge is not None,
                "kind": self.challenge.reason if self.challenge else None,
            },
            "form_hash": self.form_hash,
            "screenshot_jpeg_b64": self.screenshot_jpeg_b64,
        }

    def log_summary(self) -> dict[str, Any]:
        """19 §11.1 `observation` event: counts only, never the snapshot or values."""
        return {
            "url": self.url,
            "title": clip(self.title, 120),
            "fields": len(self.fields),
            "controls": len(self.controls),
            "errors": len(self.errors),
            "http_status": self.http_status,
            "allowlisted": self.allowlisted,
            "challenge": self.challenge.reason if self.challenge else None,
            "form_hash": self.form_hash,
            "snapshot": {"sha256": self.snapshot_sha256, "size": self.snapshot_size},
        }


def compute_form_hash(fields: list[FieldState]) -> str:
    rows = sorted([f.signature, f.kind, f.required, f.options_hash, f.value_hash] for f in fields)
    return sha256_hex(json.dumps(rows, ensure_ascii=False, separators=(",", ":")))


def compute_structure_hash(url: str, fields: list[FieldState]) -> str:
    path = url.split("://", 1)[-1].split("?", 1)[0].split("#", 1)[0]
    rows = sorted([f.signature, f.kind, f.required, f.options_hash] for f in fields)
    return sha256_hex(json.dumps([path, rows], ensure_ascii=False, separators=(",", ":")))


def truncate_snapshot(parts: list[str], limit: int = ARIA_LIMIT) -> str:
    """Main landmark / form snapshots first, then the rest, cut at a line boundary."""
    out: list[str] = []
    size = 0
    seen: set[str] = set()
    for part in parts:
        for line in strip_markers(part).splitlines():
            if part is not parts[0] and line in seen:
                continue
            if size + len(line) + 1 > limit:
                return "\n".join(out)
            out.append(line)
            seen.add(line)
            size += len(line) + 1
    return "\n".join(out)


@dataclass
class RegistryEntry:
    ref: str
    frame: Frame
    frame_number: int
    signature: str
    kind: str
    role_hint: str | None
    is_field: bool
    group: bool


class ElementRegistry:
    """ref → frame + signature for the current observation (18 §6.2)."""

    def __init__(self) -> None:
        self.entries: dict[str, RegistryEntry] = {}
        self._frames: dict[int, Frame] = {}

    def reset(self, frames: dict[int, Frame]) -> None:
        self.entries = {}
        self._frames = dict(frames)

    def add(self, entry: RegistryEntry) -> None:
        self.entries[entry.ref] = entry

    def get(self, ref: str) -> RegistryEntry | None:
        return self.entries.get(ref)

    def frame_for(self, number: int) -> Frame | None:
        return self._frames.get(number)

    @staticmethod
    def selector(ref: str) -> str:
        return f'[data-pj-ref="{ref}"]'

    def locator(self, ref: str) -> Locator:
        entry = self.entries.get(ref)
        if entry is None:
            raise StaleRefError(f"Unknown ref {ref}.", reason="unknown_ref")
        return entry.frame.locator(self.selector(ref))


class PageObserver:
    """Builds `Observation`s for one PageSession."""

    def __init__(
        self,
        session: PageSession,
        *,
        attempt_id: str,
        confirmation_selectors: list[str] | None = None,
        detector: ChallengeDetector | None = None,
        own_values: list[str] | None = None,
    ) -> None:
        self.session = session
        self.attempt_id = attempt_id
        self.confirmation_selectors = list(confirmation_selectors or [])
        self.detector = detector or ChallengeDetector()
        self.registry = ElementRegistry()
        self.user_touched: set[str] = set()
        self.own_values: list[str] = list(own_values or [])
        self.last: Observation | None = None

    # ------------------------------------------------------------------ extraction
    async def _extract(self, frame: Frame, prefix: str) -> dict[str, Any] | None:
        session = self.session
        args = {
            "prefix": prefix,
            "start": session.ref_counter,
            "issued": sorted(r for r in session.issued_refs if r.startswith(prefix) or not prefix),
            "maxFields": MAX_FIELDS,
            "maxOptions": MAX_OPTIONS,
            "maxControls": 120,
            "textLimit": 16_384,
            "confirmSelectors": self.confirmation_selectors,
        }
        try:
            result = await asyncio.wait_for(
                frame.evaluate(extract_script(), args), timeout=FRAME_EVAL_TIMEOUT_S
            )
        except (PlaywrightError, TimeoutError):
            return None
        if not isinstance(result, dict):
            return None
        data = cast(dict[str, Any], result)
        session.ref_counter = max(session.ref_counter, int(data.get("next") or 0))
        return data

    async def _aria(self, page: Page) -> str:
        parts: list[str] = []
        with contextlib.suppress(PlaywrightError, PlaywrightTimeoutError):
            main = page.locator("main, [role=main]").first
            if await main.count() > 0:
                parts.append(await main.aria_snapshot(mode="ai", depth=12, timeout=5_000))
        with contextlib.suppress(PlaywrightError, PlaywrightTimeoutError):
            forms = (await page.locator("form").all())[:3]
            parts.extend([await f.aria_snapshot(mode="ai", depth=12, timeout=5_000) for f in forms])
        with contextlib.suppress(PlaywrightError, PlaywrightTimeoutError):
            parts.append(await page.aria_snapshot(mode="ai", depth=12, timeout=5_000))
        return truncate_snapshot(parts) if parts else ""

    @staticmethod
    def _frame_origin(url: str) -> str:
        head, sep, rest = url.partition("://")
        if not sep or head not in ("http", "https"):
            return ""
        return f"{head}://{rest.split('/', 1)[0].split('?', 1)[0]}"

    def _field_state(self, raw: dict[str, Any], frame_number: int) -> FieldState:
        kind = str(raw.get("kind") or "text")
        label = strip_markers(str(raw.get("label") or ""))
        name = cast(str | None, raw.get("name"))
        action_path = str(raw.get("action_path") or "")
        signature = field_signature(kind, label, name, action_path)
        options = [cast(dict[str, Any], o) for o in cast(list[Any], raw.get("options") or [])]
        for option in options:
            option["label"] = strip_markers(str(option.get("label") or ""))
        return FieldState(
            ref=str(raw["ref"]),
            kind=kind,
            tag=str(raw.get("tag") or ""),
            label=label,
            label_sources=[str(s) for s in cast(list[Any], raw.get("label_sources") or [])],
            description=strip_markers(str(raw.get("description") or "")),
            required=bool(raw.get("required")),
            options=options,
            options_dynamic=bool(raw.get("options_dynamic")),
            accept=cast(str | None, raw.get("accept")),
            multiple=bool(raw.get("multiple")),
            value=str(raw.get("value") or ""),
            checked=cast(bool | None, raw.get("checked")),
            has_value=bool(raw.get("has_value")),
            disabled=bool(raw.get("disabled")),
            readonly=bool(raw.get("readonly")),
            invalid=bool(raw.get("invalid")),
            validation_message=cast(str | None, raw.get("validation_message")),
            section=strip_markers(str(raw.get("section") or "")) or None,
            name=name,
            id_attr=cast(str | None, raw.get("id_attr")),
            input_type=cast(str | None, raw.get("input_type")),
            autocomplete=cast(str | None, raw.get("autocomplete")),
            action_path=action_path,
            in_viewport=bool(raw.get("in_viewport")),
            hidden_input=bool(raw.get("hidden_input")),
            trigger_ref=cast(str | None, raw.get("trigger_ref")),
            masked=bool(raw.get("masked")),
            file_names=[str(n) for n in cast(list[Any], raw.get("file_names") or [])],
            frame_number=frame_number,
            signature=signature,
            user_touched=signature in self.user_touched,
        )

    def _control_state(self, raw: dict[str, Any], frame_number: int) -> ControlState:
        text = strip_markers(str(raw.get("text") or ""))
        kind = str(raw.get("kind") or "button")
        if kind not in ("button", "link", "submit"):
            kind = "button"
        return ControlState(
            ref=str(raw["ref"]),
            kind=kind,
            text=text,
            role_hint=classify_control(raw),
            enabled=bool(raw.get("enabled", True)),
            in_viewport=bool(raw.get("in_viewport")),
            href=cast(str | None, raw.get("href")),
            in_form=bool(raw.get("in_form")),
            form_has_fields=bool(raw.get("form_has_fields")),
            in_cookie_banner=bool(raw.get("in_cookie_banner")),
            upload_for=cast(str | None, raw.get("upload_for")),
            frame_number=frame_number,
            signature=control_signature(kind, text, None),
            form_action=cast(str | None, raw.get("form_action")),
        )

    # ------------------------------------------------------------------ observe
    async def observe(self, *, step: int, with_snapshot: bool = True) -> Observation:
        session = self.session
        session.raise_if_broken()
        page = session.page
        try:
            frames = list(page.frames)
            main_frame = page.main_frame
        except PlaywrightError as exc:
            raise BrowserCrashedError("The page is gone.") from exc
        main_url = session.url
        main_origin = self._frame_origin(main_url)
        fields: list[FieldState] = []
        controls: list[ControlState] = []
        errors: list[dict[str, Any]] = []
        opaque: list[dict[str, str]] = []
        frame_urls: list[str] = []
        merged_signals: dict[str, Any] = {"iframes": [], "scripts": []}
        confirm_hits: dict[str, bool] = {}
        frame_map: dict[int, Frame] = {0: main_frame}
        texts: list[str] = []
        title = ""
        main_data: dict[str, Any] | None = await self._extract(main_frame, "")
        if main_data is None:
            session.raise_if_broken()
            main_data = {"fields": [], "controls": [], "errors": [], "signals": {}, "opaque": []}
        title = strip_markers(str(main_data.get("title") or ""))
        datas: list[tuple[int, dict[str, Any]]] = [(0, main_data)]
        for frame in frames:
            if frame is main_frame:
                continue
            try:
                url = frame.url
            except PlaywrightError:
                continue
            frame_urls.append(url)
            origin = self._frame_origin(url)
            same_origin = bool(origin) and origin == main_origin
            if url in ("about:blank", "about:srcdoc", ""):
                same_origin = True
            if same_origin or (origin and session.allowlist.allows_origin(origin)):
                number = session.frame_number(frame)
                data = await self._extract(frame, f"fr{number}:")
                if data is not None:
                    frame_map[number] = frame
                    datas.append((number, data))
                continue
            opaque.append({"origin": origin or "null", "title": self._iframe_title(main_data, url)})
        for number, data in datas:
            fields.extend(
                self._field_state(cast(dict[str, Any], raw), number)
                for raw in cast(list[Any], data.get("fields") or [])
            )
            controls.extend(
                self._control_state(cast(dict[str, Any], raw), number)
                for raw in cast(list[Any], data.get("controls") or [])
            )
            errors.extend(cast(list[dict[str, Any]], data.get("errors") or []))
            for item in cast(list[Any], data.get("opaque") or []):
                tag = str(cast(dict[str, Any], item).get("tag") or "shadow")
                opaque.append(
                    {"origin": main_origin or "null", "title": f"closed shadow root <{tag}>"}
                )
            signals = cast(dict[str, Any], data.get("signals") or {})
            merged_signals["iframes"].extend(signals.get("iframes") or [])
            merged_signals["scripts"].extend(signals.get("scripts") or [])
            for key in ("turnstile", "recaptcha", "hcaptcha"):
                merged_signals[key] = bool(merged_signals.get(key)) or bool(signals.get(key))
            merged_signals["password_visible"] = int(
                merged_signals.get("password_visible") or 0
            ) + int(signals.get("password_visible") or 0)
            for selector, hit in cast(dict[str, Any], signals.get("confirm") or {}).items():
                confirm_hits[selector] = confirm_hits.get(selector, False) or bool(hit)
            texts.append(str(signals.get("main_text") or ""))
        for f in fields:
            session.issued_refs.add(f.ref)
        for c in controls:
            session.issued_refs.add(c.ref)
        controls = self._limit_controls(controls)
        for error in errors:
            error["text"] = strip_markers(str(error.get("text") or ""))
        raw_text = strip_markers("\n".join(t for t in texts if t))
        decision = session.check_current()
        host = ascii_host(main_url.split("://", 1)[-1].split("/", 1)[0].split(":")[0]) or ""
        domain = registrable_domain(host) or host
        challenge = self.detector.detect(
            url=main_url,
            title=title,
            http_status=session.main_status,
            fields=[self._detector_view(f) for f in fields],
            controls=[{"role_hint": c.role_hint, "in_viewport": c.in_viewport} for c in controls],
            signals=merged_signals,
            frame_urls=frame_urls,
            page_text=raw_text,
        )
        aria = ""
        if with_snapshot:
            aria = await self._aria(page)
        self._register(fields, controls, frame_map)
        observation = Observation(
            observation_id=new_id("obs"),
            attempt_id=self.attempt_id,
            step=step,
            url=main_url,
            origin=main_origin,
            registrable_domain=domain,
            allowlisted=decision.actions_enabled,
            title=title,
            http_status=session.main_status,
            aria_snapshot=aria,
            snapshot_sha256=sha256_hex(aria),
            snapshot_size=len(aria),
            text_excerpt=redact_excerpt(raw_text, self.own_values, limit=TEXT_EXCERPT_LIMIT),
            raw_text=raw_text,
            fields=fields[:MAX_FIELDS],
            controls=controls,
            errors=errors[:30],
            opaque_regions=opaque[:10],
            challenge=challenge,
            form_hash=compute_form_hash(fields),
            structure_hash=compute_structure_hash(main_url, fields),
            confirm_hits=confirm_hits,
            frame_urls=frame_urls,
            signals=merged_signals,
        )
        self.last = observation
        return observation

    @staticmethod
    def _iframe_title(main_data: dict[str, Any], url: str) -> str:
        signals = cast(dict[str, Any], main_data.get("signals") or {})
        for frame in cast(list[Any], signals.get("iframes") or []):
            item = cast(dict[str, Any], frame)
            if str(item.get("src") or "") == url:
                return clip(str(item.get("title") or item.get("name") or ""), 120)
        return ""

    @staticmethod
    def _detector_view(f: FieldState) -> dict[str, Any]:
        return {
            "kind": f.kind,
            "label": f.label,
            "name": f.name,
            "id_attr": f.id_attr,
            "description": f.description,
            "autocomplete": f.autocomplete,
            "input_type": f.input_type,
        }

    @staticmethod
    def _limit_controls(controls: list[ControlState]) -> list[ControlState]:
        if len(controls) <= MAX_CONTROLS:
            return controls
        keep = [c for c in controls if c.role_hint not in ("navigation", "other")]
        rest = [c for c in controls if c.role_hint in ("navigation", "other")]
        return (keep + rest)[:MAX_CONTROLS]

    def _register(
        self, fields: list[FieldState], controls: list[ControlState], frames: dict[int, Frame]
    ) -> None:
        self.registry.reset(frames)
        for f in fields:
            frame = frames.get(f.frame_number)
            if frame is None:
                continue
            self.registry.add(
                RegistryEntry(
                    ref=f.ref,
                    frame=frame,
                    frame_number=f.frame_number,
                    signature=f.signature,
                    kind=f.kind,
                    role_hint=None,
                    is_field=True,
                    group=f.kind in ("radio_group", "checkbox_group"),
                )
            )
        for c in controls:
            frame = frames.get(c.frame_number)
            if frame is None:
                continue
            self.registry.add(
                RegistryEntry(
                    ref=c.ref,
                    frame=frame,
                    frame_number=c.frame_number,
                    signature=c.signature,
                    kind=c.kind,
                    role_hint=c.role_hint,
                    is_field=False,
                    group=False,
                )
            )

    # ------------------------------------------------------------------ re-resolution
    async def resolve(self, ref: str) -> tuple[str, Locator]:
        """The live locator of `ref`; re-resolved by signature when the ref vanished."""
        entry = self.registry.get(ref)
        if entry is None:
            raise StaleRefError(f"Unknown ref {ref}.", reason="unknown_ref")
        locator = entry.frame.locator(ElementRegistry.selector(ref))
        try:
            count = await locator.count()
        except PlaywrightError as exc:
            raise StaleRefError("The frame of this element is gone.", reason="frame_gone") from exc
        if count == 1:
            return ref, locator
        if count > 1:
            raise StaleRefError(f"Ref {ref} is ambiguous on the page.", reason="ambiguous_ref")
        prefix = "" if entry.frame_number == 0 else f"fr{entry.frame_number}:"
        data = await self._extract(entry.frame, prefix)
        if data is None:
            raise StaleRefError(f"Ref {ref} vanished.", reason="vanished")
        if entry.is_field:
            matches = [
                self._field_state(cast(dict[str, Any], raw), entry.frame_number)
                for raw in cast(list[Any], data.get("fields") or [])
            ]
            hits = [m for m in matches if m.signature == entry.signature]
        else:
            controls = [
                self._control_state(cast(dict[str, Any], raw), entry.frame_number)
                for raw in cast(list[Any], data.get("controls") or [])
            ]
            hits = [
                c
                for c in controls
                if c.signature == entry.signature and c.role_hint == entry.role_hint
            ]
        if len(hits) != 1:
            raise StaleRefError(
                f"Ref {ref} vanished and its signature is {'ambiguous' if hits else 'missing'}.",
                reason="signature_ambiguous" if hits else "signature_missing",
            )
        new_ref = hits[0].ref
        self.session.issued_refs.add(new_ref)
        moved = RegistryEntry(
            ref=new_ref,
            frame=entry.frame,
            frame_number=entry.frame_number,
            signature=entry.signature,
            kind=entry.kind,
            role_hint=entry.role_hint,
            is_field=entry.is_field,
            group=entry.group,
        )
        self.registry.add(moved)
        return new_ref, entry.frame.locator(ElementRegistry.selector(new_ref))

    # ------------------------------------------------------------------ pauses
    def snapshot_values(self, observation: Observation) -> dict[str, str]:
        """signature → value hash, taken before a human pause (18 §8 step 3)."""
        return {f.signature: f.value_hash for f in observation.fields}

    def mark_user_touched(self, before: dict[str, str], after: Observation) -> list[str]:
        """Fields whose value changed during the pause become `user_touched`."""
        touched: list[str] = []
        for f in after.fields:
            previous = before.get(f.signature)
            if (previous is not None and previous != f.value_hash) or (
                previous is None and f.has_value
            ):
                touched.append(f.signature)
        self.user_touched.update(touched)
        for f in after.fields:
            f.user_touched = f.signature in self.user_touched
        return touched
