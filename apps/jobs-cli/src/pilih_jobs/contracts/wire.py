"""Wire serialisation of contract models with the api's semantics (D-20, 05 §1).

The generated Pydantic models cannot tell the two Zod shapes of "may be missing" apart:
`.optional()` and `.nullable().optional()` both become `X | None = None`, while a
`.nullable()` member stays required (`X | None`, no default). The api validates with Zod,
where an optional member may be absent but **not** `null` unless it is also nullable.
`model_dump(exclude_none=False)` therefore sends `"fact_keys": null` (refused: `400
invalid_request`), and `exclude_none=True` would drop the `null` of required nullable
members such as `ObservedField.validation_message` (refused: "required").

`to_wire` keeps both right: a member the model does not require is omitted when it is
`None` (absent is always valid for it), a required member keeps its `null` (it validated,
so the contract declares it nullable). Nested models, lists and dicts are walked the
same way; extra members of open objects (`z.looseObject`) are sent as they are.

`clip_utf16` truncates text to a contract length: Zod's `.max(n)` counts UTF-16 code units
(JavaScript `String.length`), so an astral character (emoji, rare CJK) counts twice.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, cast

from pydantic import BaseModel, RootModel
from pydantic_core import to_jsonable_python


def to_wire(model: BaseModel) -> dict[str, Any]:
    """The JSON body of a validated request model, as the api's Zod schema expects it."""
    body = _wire(model)
    if not isinstance(body, dict):
        raise TypeError(f"{type(model).__name__} does not serialise to a JSON object")
    return cast(dict[str, Any], body)


def _wire(value: object) -> object:
    if isinstance(value, RootModel):
        return _wire(cast(RootModel[Any], value).root)
    if isinstance(value, BaseModel):
        out: dict[str, Any] = {}
        for name, info in type(value).model_fields.items():
            item = getattr(value, name)
            if item is None and not info.is_required():
                continue  # optional and unset: absent on the wire, never null
            out[info.serialization_alias or info.alias or name] = _wire(item)
        for key, item in (value.model_extra or {}).items():
            out[key] = _wire(item)
        return out
    if isinstance(value, Mapping):
        mapping = cast(Mapping[object, object], value)
        return {str(key): _wire(item) for key, item in mapping.items()}
    if isinstance(value, list | tuple):
        return [_wire(item) for item in cast(list[object] | tuple[object, ...], value)]
    return to_jsonable_python(value)


def utf16_length(text: str) -> int:
    """`String.length` in JavaScript: UTF-16 code units."""
    return len(text.encode("utf-16-le")) // 2


def clip_utf16(text: str, limit: int) -> str:
    """The longest prefix of `text` of at most `limit` UTF-16 units (no split pairs)."""
    if len(text) * 2 <= limit or utf16_length(text) <= limit:
        return text
    units = 0
    for index, char in enumerate(text):
        units += 2 if ord(char) > 0xFFFF else 1
        if units > limit:
            return text[:index]
    return text
