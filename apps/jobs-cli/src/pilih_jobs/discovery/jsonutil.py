"""Typed accessors for untyped JSON payloads (ATS API responses, JSON-LD)."""

from __future__ import annotations

from typing import Any, cast


def obj(value: Any) -> dict[str, Any]:
    """`value` when it is a JSON object, else an empty dict."""
    return cast(dict[str, Any], value) if isinstance(value, dict) else {}


def arr(value: Any) -> list[Any]:
    """`value` when it is a JSON array, else an empty list."""
    return cast(list[Any], value) if isinstance(value, list) else []


def objs(value: Any) -> list[dict[str, Any]]:
    """The JSON objects of an array (other entries are ignored)."""
    return [cast(dict[str, Any], v) for v in arr(value) if isinstance(v, dict)]


def text(value: Any) -> str | None:
    """A non-empty string, else None."""
    return value if isinstance(value, str) and value else None


def strs(value: Any) -> list[str]:
    return [v for v in arr(value) if isinstance(v, str) and v]


def number(value: Any) -> float | None:
    if isinstance(value, int | float) and not isinstance(value, bool):
        return float(value)
    return None
