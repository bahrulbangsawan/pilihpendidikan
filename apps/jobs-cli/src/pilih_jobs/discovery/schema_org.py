"""schema.org JSON-LD helpers shared by the engine page view and the adapters."""

from __future__ import annotations

from typing import Any, cast


def has_type(obj: dict[str, Any], wanted: str) -> bool:
    """`@type` equals `wanted` (also in a list, or as `schema:X` / a schema.org URL)."""
    raw = obj.get("@type")
    names: list[Any] = cast(list[Any], raw) if isinstance(raw, list) else [raw]
    target = wanted.lower()
    for name in names:
        if isinstance(name, str) and name.rsplit("/", 1)[-1].rsplit(":", 1)[-1].lower() == target:
            return True
    return False


def flatten_json_ld(value: Any) -> list[dict[str, Any]]:
    """Every object of a JSON-LD document: arrays, `@graph` and `ItemList` entries."""
    out: list[dict[str, Any]] = []

    def visit(node: Any, depth: int) -> None:
        if depth > 6:
            return
        if isinstance(node, list):
            for item in cast(list[Any], node):
                visit(item, depth + 1)
            return
        if not isinstance(node, dict):
            return
        obj = cast(dict[str, Any], node)
        out.append(obj)
        graph = obj.get("@graph")
        if graph is not None:
            visit(graph, depth + 1)
        if has_type(obj, "ItemList"):
            for element in cast(list[Any], obj.get("itemListElement") or []):
                if isinstance(element, dict):
                    entry = cast(dict[str, Any], element)
                    visit(entry.get("item", entry), depth + 1)

    visit(value, 0)
    return out
