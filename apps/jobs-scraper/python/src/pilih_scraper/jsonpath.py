"""Dotted JSON paths of strategy configs (`company`, `salary.min`, `jobs.0.title`)."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any, cast


def get_path(value: Any, path: str | None) -> Any:
    """The value at `path` ("" is the value itself); None when any step is missing."""
    if path is None:
        return None
    if path == "":
        return value
    current: Any = value
    for step in path.split("."):
        if isinstance(current, Mapping):
            current = cast(Mapping[str, Any], current).get(step)
        elif (
            isinstance(current, Sequence)
            and not isinstance(current, str | bytes)
            and step.isdigit()
        ):
            items = cast(Sequence[Any], current)
            index = int(step)
            current = items[index] if index < len(items) else None
        else:
            return None
        if current is None:
            return None
    return current


def as_text(value: Any) -> str | None:
    """A scalar as trimmed text (numbers included); None for empty / containers."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int | float):
        return str(value)
    if isinstance(value, str):
        text = value.strip()
        return text or None
    return None


def as_strings(value: Any) -> list[str]:
    """A list of strings from a list, a comma string, or a Python-repr list string."""
    if value is None:
        return []
    if isinstance(value, list):
        out: list[str] = []
        for item in cast(list[Any], value):
            text = as_text(item)
            if text is None and isinstance(item, Mapping):
                text = as_text(cast(Mapping[str, Any], item).get("name"))
            if text:
                out.append(text)
        return out
    text = as_text(value)
    if not text:
        return []
    stripped = text.strip("[]")
    return [part.strip().strip("'\"").strip() for part in stripped.split(",") if part.strip(" '\"")]
