"""Route table and model lookup over the generated contracts.

`_generated/index.json` is exported from `API_ROUTE_SCHEMAS` by `scripts/gen_contracts.py`:
every `/api/v1` route of 05 with its scope, idempotency rule and the schema names of its
query/request/response. Models are imported lazily from `_generated.<group>`.
"""

from __future__ import annotations

import importlib
import json
import re
from dataclasses import dataclass
from functools import cache
from importlib import resources
from typing import Any, Literal, cast

from pydantic import BaseModel

Idempotency = Literal["required", "optional", "none"]


@dataclass(frozen=True)
class RouteSpec:
    key: str
    method: str
    path: str
    operation: str
    section: str
    scope: str
    also_requires: tuple[str, ...]
    alt_scope: str | None
    idempotency: Idempotency
    device: bool
    status: int
    query: str | None
    request: str | None
    response: str | None
    request_encoding: str
    response_encoding: str
    pattern: re.Pattern[str]

    def matches(self, method: str, path: str) -> bool:
        return method.upper() == self.method and self.pattern.match(path) is not None


def _compile(template: str) -> re.Pattern[str]:
    parts = re.split(r"(\{[a-z_]+\})", template)
    regex = "".join(
        "[^/]+" if part.startswith("{") and part.endswith("}") else re.escape(part)
        for part in parts
    )
    return re.compile(f"^{regex}$")


@cache
def _index() -> dict[str, Any]:
    text = (
        resources.files("pilih_jobs.contracts")
        .joinpath("_generated", "index.json")
        .read_text("utf-8")
    )
    return cast(dict[str, Any], json.loads(text))


@cache
def routes() -> dict[str, RouteSpec]:
    out: dict[str, RouteSpec] = {}
    raw_routes = cast(dict[str, dict[str, Any]], _index()["routes"])
    for key, raw in raw_routes.items():
        out[key] = RouteSpec(
            key=key,
            method=str(raw["method"]),
            path=str(raw["path"]),
            operation=str(raw["operation"]),
            section=str(raw["section"]),
            scope=str(raw["scope"]),
            also_requires=tuple(cast(list[str], raw["also_requires"])),
            alt_scope=cast(str | None, raw["alt_scope"]),
            idempotency=cast(Idempotency, raw["idempotency"]),
            device=bool(raw["device"]),
            status=int(raw["status"]),
            query=cast(str | None, raw["query"]),
            request=cast(str | None, raw["request"]),
            response=cast(str | None, raw["response"]),
            request_encoding=str(raw["request_encoding"]),
            response_encoding=str(raw["response_encoding"]),
            pattern=_compile(str(raw["path"])),
        )
    return out


def route_for(method: str, path: str) -> RouteSpec | None:
    """The route matching a concrete request (`POST /api/v1/devices/dev_…/revoke`)."""
    bare = path.split("?", 1)[0]
    for spec in routes().values():
        if spec.matches(method, bare):
            return spec
    return None


def tables() -> dict[str, str]:
    return cast(dict[str, str], _index()["tables"])


def schema_group(name: str) -> str:
    groups = cast(dict[str, str], _index()["schemas"])
    if name in groups:
        return groups[name]
    raise KeyError(f"unknown contract schema {name!r}")


def model(name: str) -> type[BaseModel]:
    """The generated Pydantic class of a registered schema name (`GetMeResponse`)."""
    module = importlib.import_module(
        f"pilih_jobs.contracts._generated.{schema_group(name).replace('-', '_')}"
    )
    found = getattr(module, name, None)
    if not (isinstance(found, type) and issubclass(found, BaseModel)):
        raise KeyError(f"no generated model for {name!r}")
    return found


def record_model(table: str) -> type[BaseModel]:
    return model(tables()[table])
