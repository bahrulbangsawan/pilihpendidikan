"""Validate wire bodies against the contract JSON Schema with the api's semantics.

`packages/jobs-contracts/schema/*.json` is generated from the Zod contracts the api
validates with (D-20), so checking a body against it answers "would `apps/api` accept
this?" more faithfully than the generated Pydantic models, which cannot tell an absent
optional member from a `null` one (`X | None = None`). Here, as in Zod:

- an absent optional member is fine, but `null` is accepted only where the schema says
  so (`type: [..., "null"]` or an `anyOf` branch `{"type": "null"}`, i.e. `.nullable()`);
- string lengths count UTF-16 code units (JavaScript `String.length`), not code points.

The schema files are read from the repository (like the golden vectors), never copied.
Only the keywords the generator emits are implemented; an unknown keyword fails loudly
so a generator change cannot make the check silently weaker.
"""

from __future__ import annotations

import functools
import json
import math
import re
from pathlib import Path
from typing import Any, Final, cast
from urllib.parse import urlsplit

SCHEMA_DIR: Final = Path(__file__).resolve().parents[4] / "packages" / "jobs-contracts" / "schema"

_EMAIL_RE: Final = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
_IGNORED: Final = frozenset({"$schema", "description", "title", "default", "examples"})
_HANDLED: Final = frozenset(
    {
        "$ref",
        "type",
        "const",
        "enum",
        "properties",
        "required",
        "additionalProperties",
        "propertyNames",
        "items",
        "anyOf",
        "oneOf",
        "allOf",
        "minLength",
        "maxLength",
        "pattern",
        "format",
        "minimum",
        "maximum",
        "exclusiveMinimum",
        "exclusiveMaximum",
        "minItems",
        "maxItems",
    }
)


@functools.cache
def load_schema(group: str) -> dict[str, Any]:
    return cast(dict[str, Any], json.loads((SCHEMA_DIR / f"{group}.json").read_text("utf-8")))


def utf16_length(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def _json_type(value: Any) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    return type(value).__name__  # not JSON at all (bytes, tuple, a model, …)


def _type_matches(expected: str, value: Any) -> bool:
    actual = _json_type(value)
    if expected == "number":
        return actual in ("integer", "number") and math.isfinite(value)
    if expected == "integer" and actual == "number":
        return float(value).is_integer()
    return actual == expected


class _Checker:
    def __init__(self, root: dict[str, Any]) -> None:
        self.root = root

    def resolve(self, ref: str) -> dict[str, Any]:
        if not ref.startswith("#/$defs/"):
            raise AssertionError(f"unsupported $ref {ref!r}")
        return cast(dict[str, Any], self.root["$defs"][ref.removeprefix("#/$defs/")])

    def check(self, schema: dict[str, Any] | bool, value: Any, path: str) -> list[str]:
        if schema is True or schema == {}:
            return []
        if schema is False:
            return [f"{path}: no value is allowed here"]
        node = cast(dict[str, Any], schema)
        unknown = set(node) - _HANDLED - _IGNORED
        if unknown:
            raise AssertionError(f"{path}: unsupported JSON Schema keywords {sorted(unknown)}")
        errors: list[str] = []
        if "$ref" in node:
            errors += self.check(self.resolve(str(node["$ref"])), value, path)
        if "type" in node:
            raw_types = node["type"]
            types = (
                [str(t) for t in cast(list[Any], raw_types)]
                if isinstance(raw_types, list)
                else [str(raw_types)]
            )
            if not any(_type_matches(t, value) for t in types):
                expected = " | ".join(types)
                return [*errors, f"{path}: expected {expected}, got {_json_type(value)}"]
        if "const" in node and value != node["const"]:
            errors.append(f"{path}: expected {node['const']!r}, got {value!r}")
        if "enum" in node and value not in cast(list[Any], node["enum"]):
            errors.append(f"{path}: {value!r} is not one of {node['enum']!r}")
        for keyword in ("anyOf", "oneOf"):
            if keyword in node:
                branches = cast(list[dict[str, Any]], node[keyword])
                results = [self.check(branch, value, path) for branch in branches]
                passing = sum(1 for r in results if not r)
                if passing == 0:
                    best = min(results, key=len)
                    errors.append(f"{path}: matches no {keyword} branch ({'; '.join(best)})")
                elif keyword == "oneOf" and passing > 1:
                    errors.append(f"{path}: matches {passing} oneOf branches")
        for branch in cast(list[dict[str, Any]], node.get("allOf", [])):
            errors += self.check(branch, value, path)
        if isinstance(value, str):
            errors += self._string(node, value, path)
        elif isinstance(value, int | float) and not isinstance(value, bool):
            errors += self._number(node, value, path)
        elif isinstance(value, list):
            errors += self._array(node, cast(list[Any], value), path)
        elif isinstance(value, dict):
            errors += self._object(node, cast(dict[str, Any], value), path)
        return errors

    @staticmethod
    def _string(node: dict[str, Any], value: str, path: str) -> list[str]:
        errors: list[str] = []
        length = utf16_length(value)
        if "minLength" in node and length < int(node["minLength"]):
            errors.append(f"{path}: shorter than {node['minLength']}")
        if "maxLength" in node and length > int(node["maxLength"]):
            errors.append(f"{path}: {length} UTF-16 units, longer than {node['maxLength']}")
        if "pattern" in node and re.search(str(node["pattern"]), value) is None:
            errors.append(f"{path}: {value!r} does not match {node['pattern']!r}")
        fmt = node.get("format")
        if fmt == "uri":
            parts = urlsplit(value)
            if not parts.scheme or not (parts.netloc or parts.path):
                errors.append(f"{path}: {value!r} is not a URL")
        elif fmt == "email":
            if _EMAIL_RE.fullmatch(value) is None:
                errors.append(f"{path}: {value!r} is not an email address")
        elif fmt not in (None, "starts_with"):  # `starts_with` also emits a `pattern`
            raise AssertionError(f"{path}: unsupported format {fmt!r}")
        return errors

    @staticmethod
    def _number(node: dict[str, Any], value: float, path: str) -> list[str]:
        errors: list[str] = []
        if "minimum" in node and value < node["minimum"]:
            errors.append(f"{path}: {value} < minimum {node['minimum']}")
        if "maximum" in node and value > node["maximum"]:
            errors.append(f"{path}: {value} > maximum {node['maximum']}")
        if "exclusiveMinimum" in node and value <= node["exclusiveMinimum"]:
            errors.append(f"{path}: {value} <= exclusiveMinimum {node['exclusiveMinimum']}")
        if "exclusiveMaximum" in node and value >= node["exclusiveMaximum"]:
            errors.append(f"{path}: {value} >= exclusiveMaximum {node['exclusiveMaximum']}")
        return errors

    def _array(self, node: dict[str, Any], value: list[Any], path: str) -> list[str]:
        errors: list[str] = []
        if "minItems" in node and len(value) < int(node["minItems"]):
            errors.append(f"{path}: fewer than {node['minItems']} items")
        if "maxItems" in node and len(value) > int(node["maxItems"]):
            errors.append(f"{path}: more than {node['maxItems']} items")
        items = node.get("items")
        if items is not None:
            for index, item in enumerate(value):
                errors += self.check(cast(dict[str, Any], items), item, f"{path}[{index}]")
        return errors

    def _object(self, node: dict[str, Any], value: dict[str, Any], path: str) -> list[str]:
        errors: list[str] = []
        properties = cast(dict[str, Any], node.get("properties", {}))
        errors.extend(
            f"{path}.{key}: required member is missing"
            for key in cast(list[str], node.get("required", []))
            if key not in value
        )
        extra_schema = node.get("additionalProperties")
        names = node.get("propertyNames")
        for key, item in value.items():
            where = f"{path}.{key}"
            if names is not None:
                errors += self.check(cast(dict[str, Any], names), key, f"{where} (name)")
            if key in properties:
                errors += self.check(cast(dict[str, Any], properties[key]), item, where)
            elif extra_schema is not None:
                errors += self.check(cast(dict[str, Any] | bool, extra_schema), item, where)
        return errors


def contract_violations(group: str, name: str, value: Any) -> list[str]:
    """Every reason the api would refuse `value` as `$defs[name]` of `schema/<group>.json`."""
    root = load_schema(group)
    definitions = cast(dict[str, Any], root["$defs"])
    if name not in definitions:
        raise AssertionError(f"schema/{group}.json has no $defs/{name}")
    return _Checker(root).check(cast(dict[str, Any], definitions[name]), value, name)


#: `/api/v1/ai/<endpoint>` → request schema in `schema/agent.json`.
AI_REQUEST_SCHEMAS: Final[dict[str, str]] = {
    "page-classify": "PageClassifyRequest",
    "next-action": "NextActionRequest",
    "field-plan": "FieldPlanRequest",
    "verify-submission": "VerifySubmissionRequest",
}


def ai_request_violations(endpoint: str, body: Any) -> list[str]:
    return contract_violations("agent", AI_REQUEST_SCHEMAS[endpoint], body)
