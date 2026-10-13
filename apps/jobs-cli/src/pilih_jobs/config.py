"""Local configuration (16 §9): TOML at the platformdirs config path.

Precedence: **flags > environment (`PILIH_JOBS_<SECTION>_<KEY>`) > config file > defaults**.
`PILIH_JOBS_API_URL` sets `api.url`; list values in the environment are comma-separated.
`config set` validates against the Pydantic model and refuses unknown keys. Server-side
preferences (rules, sources, facts) live in the cloud, never here.
"""

from __future__ import annotations

import ipaddress
import json
import os
import tomllib
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, cast
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from pilih_jobs.errors import ConfigError
from pilih_jobs.paths import Paths, ensure_private_dir

DEFAULT_API_URL = "https://api.pilihpendidikan.com"
ENV_PREFIX = "PILIH_JOBS_"
#: Environment variables with a meaning of their own (never config keys).
RESERVED_ENV = frozenset(
    {
        "PILIH_JOBS_TOKEN",
        "PILIH_JOBS_KEYRING_PASSPHRASE",
        "PILIH_JOBS_HOME",
        "PILIH_JOBS_CONFIG",
        "PILIH_JOBS_NO_UPDATE_CHECK",
    }
)

Source = Literal["default", "file", "env", "flag"]


def is_loopback_host(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


def validate_api_url(value: str) -> str:
    """https everywhere; http only for loopback (17 §12). Returns the URL without a slash."""
    parts = urlsplit(value.strip())
    host = parts.hostname or ""
    if parts.scheme not in ("http", "https") or not host:
        raise ValueError("api.url must be an http(s) URL")
    if parts.scheme == "http" and not is_loopback_host(host):
        raise ValueError("api.url may use http only on loopback (127.0.0.1, ::1, localhost)")
    if parts.query or parts.fragment or parts.username or parts.password:
        raise ValueError("api.url must not carry a query, fragment or credentials")
    return value.strip().rstrip("/")


class _Section(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


class ApiConfig(_Section):
    url: str = DEFAULT_API_URL

    @field_validator("url")
    @classmethod
    def _url(cls, value: str) -> str:
        return validate_api_url(value)


class BrowserConfig(_Section):
    mode: Literal["managed", "connected", "persistent"] = "managed"
    default_profile: str = Field(default="default", min_length=1, max_length=64)
    channel: Literal["chromium", "chrome", "msedge"] = "chromium"
    headless_for: list[Literal["discover", "render_cv", "apply"]] = Field(
        default_factory=lambda: cast(
            list[Literal["discover", "render_cv", "apply"]], ["discover", "render_cv"]
        )
    )
    cdp_endpoint: str = ""

    @field_validator("cdp_endpoint")
    @classmethod
    def _cdp(cls, value: str) -> str:
        if value == "":
            return value
        parts = urlsplit(value)
        if parts.scheme not in ("http", "ws") or not is_loopback_host(parts.hostname or ""):
            raise ValueError("browser.cdp_endpoint must be a loopback http:// or ws:// URL (18)")
        return value.rstrip("/")


class ApplyConfig(_Section):
    #: 18 §5: approval-mode apply runs headless only when this is true (default headed);
    #: `--headed/--headless` win, `assisted` is always headed, `auto` follows the adapter.
    headless_approval: bool = False


class WorkerConfig(_Section):
    kinds: list[Literal["apply", "discover", "render_cv"]] = Field(
        default_factory=lambda: cast(
            list[Literal["apply", "discover", "render_cv"]], ["apply", "discover", "render_cv"]
        )
    )
    max_daily_applications: int = Field(default=20, ge=0, le=500)
    auto_update: bool = False


class DiscoveryConfig(_Section):
    max_pages: int = Field(default=50, ge=1, le=1000)
    allow_browser: bool = False


class PrivacyConfig(_Section):
    telemetry: bool = False
    keep_evidence_screenshots: bool = True
    keep_run_dirs_days: int = Field(default=7, ge=0, le=365)


class LoggingConfig(_Section):
    level: Literal["debug", "info", "warning", "error"] = "info"


class CredentialsConfig(_Section):
    store: Literal["keyring", "encrypted-file"] = "keyring"


class Config(_Section):
    api: ApiConfig = Field(default_factory=ApiConfig)
    browser: BrowserConfig = Field(default_factory=BrowserConfig)
    apply: ApplyConfig = Field(default_factory=ApplyConfig)
    worker: WorkerConfig = Field(default_factory=WorkerConfig)
    discovery: DiscoveryConfig = Field(default_factory=DiscoveryConfig)
    privacy: PrivacyConfig = Field(default_factory=PrivacyConfig)
    logging: LoggingConfig = Field(default_factory=LoggingConfig)
    credentials: CredentialsConfig = Field(default_factory=CredentialsConfig)


def _sections() -> dict[str, type[_Section]]:
    out: dict[str, type[_Section]] = {}
    for name, info in Config.model_fields.items():
        annotation = info.annotation
        if isinstance(annotation, type) and issubclass(annotation, _Section):
            out[name] = annotation
    return out


SECTIONS = _sections()


def all_keys() -> list[str]:
    return [f"{section}.{key}" for section, model in SECTIONS.items() for key in model.model_fields]


def split_key(key: str) -> tuple[str, str]:
    section, _, name = key.partition(".")
    if section not in SECTIONS or name not in SECTIONS[section].model_fields:
        raise ConfigError(
            f"Unknown config key {key!r}.",
            details={"known_keys": all_keys()},
            hint="pilih-jobs config list",
        )
    return section, name


def _field_kind(section: str, name: str) -> str:
    default = getattr(SECTIONS[section](), name)
    if isinstance(default, bool):
        return "bool"
    if isinstance(default, int):
        return "int"
    if isinstance(default, list):
        return "list"
    return "str"


def parse_value(key: str, raw: str) -> Any:
    """Parse a CLI/env string for `key` (bools: true/false/1/0/yes/no/on/off)."""
    section, name = split_key(key)
    kind = _field_kind(section, name)
    text = raw.strip()
    if kind == "bool":
        lowered = text.lower()
        if lowered in {"true", "1", "yes", "on"}:
            return True
        if lowered in {"false", "0", "no", "off"}:
            return False
        raise ConfigError(f"{key} expects true or false, got {raw!r}.")
    if kind == "int":
        try:
            return int(text)
        except ValueError as exc:
            raise ConfigError(f"{key} expects an integer, got {raw!r}.") from exc
    if kind == "list":
        if text.startswith("["):
            try:
                value = json.loads(text)
            except json.JSONDecodeError as exc:
                raise ConfigError(f"{key} expects a JSON list or comma-separated values.") from exc
            if not isinstance(value, list):
                raise ConfigError(f"{key} expects a list.")
            return [str(item) for item in cast(list[object], value)]
        return [item.strip() for item in text.split(",") if item.strip()]
    return text


def _set_nested(target: dict[str, Any], key: str, value: Any) -> None:
    section, name = key.split(".", 1)
    target.setdefault(section, {})[name] = value


def _flatten(data: Mapping[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for section, values in data.items():
        if isinstance(values, Mapping):
            for name, value in cast(Mapping[str, Any], values).items():
                out[f"{section}.{name}"] = value
        else:
            out[section] = values
    return out


def read_config_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        with path.open("rb") as handle:
            data = tomllib.load(handle)
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise ConfigError(f"Cannot read config file {path}: {exc}") from exc
    for key in _flatten(data):
        split_key(key)  # refuses unknown keys with the list of known ones
    return data


def env_overrides(env: Mapping[str, str]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for var, raw in env.items():
        if not var.startswith(ENV_PREFIX) or var in RESERVED_ENV:
            continue
        rest = var[len(ENV_PREFIX) :].lower()
        section, _, name = rest.partition("_")
        key = f"{section}.{name}"
        if section in SECTIONS and name in SECTIONS[section].model_fields:
            _set_nested(out, key, parse_value(key, raw))
    return out


def _merge(*layers: Mapping[str, Any]) -> dict[str, Any]:
    merged: dict[str, Any] = {}
    for layer in layers:
        for section, values in layer.items():
            if isinstance(values, Mapping):
                merged.setdefault(section, {}).update(cast(Mapping[str, Any], values))
    return merged


def _validate(data: Mapping[str, Any], origin: str) -> Config:
    try:
        return Config.model_validate(data)
    except ValidationError as exc:
        problems = [
            f"{'.'.join(str(p) for p in error['loc'])}: {error['msg']}" for error in exc.errors()
        ]
        raise ConfigError(
            f"Invalid configuration ({origin}): " + "; ".join(problems),
            details={"errors": problems},
        ) from exc


@dataclass
class LoadedConfig:
    config: Config
    sources: dict[str, Source]
    path: Path
    file_data: dict[str, Any] = field(default_factory=lambda: {})

    def get(self, key: str) -> Any:
        section, name = split_key(key)
        return getattr(getattr(self.config, section), name)


def load_config(
    paths: Paths,
    *,
    flags: Mapping[str, Any] | None = None,
    env: Mapping[str, str] | None = None,
) -> LoadedConfig:
    """Effective configuration with the source of every key."""
    environ = os.environ if env is None else env
    file_data = read_config_file(paths.config_file)
    env_data = env_overrides(environ)
    flag_data: dict[str, Any] = {}
    for key, value in (flags or {}).items():
        if value is not None:
            split_key(key)
            _set_nested(flag_data, key, value)
    config = _validate(_merge(file_data, env_data, flag_data), "file, environment and flags")
    sources: dict[str, Source] = dict.fromkeys(all_keys(), "default")
    for layer, name in ((file_data, "file"), (env_data, "env"), (flag_data, "flag")):
        for key in _flatten(layer):
            sources[key] = cast(Source, name)
    return LoadedConfig(config=config, sources=sources, path=paths.config_file, file_data=file_data)


# ---------------------------------------------------------------- writing
def _toml_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, list):
        return "[" + ", ".join(_toml_value(item) for item in cast(list[Any], value)) + "]"
    return json.dumps(str(value), ensure_ascii=False)  # TOML basic strings == JSON strings


def dumps_toml(data: Mapping[str, Any]) -> str:
    lines = ["# pilih-jobs configuration (16 §9). Edit with `pilih-jobs config set`.", ""]
    for section in SECTIONS:
        values = data.get(section)
        if not isinstance(values, Mapping) or not values:
            continue
        lines.append(f"[{section}]")
        for name, value in cast(Mapping[str, Any], values).items():
            lines.append(f"{name} = {_toml_value(value)}")
        lines.append("")
    return "\n".join(lines).rstrip("\n") + "\n"


def _write_file(path: Path, data: Mapping[str, Any]) -> None:
    ensure_private_dir(path.parent)
    tmp = path.with_suffix(".toml.tmp")
    tmp.write_text(dumps_toml(data), encoding="utf-8")
    if os.name == "posix":
        tmp.chmod(0o600)
    tmp.replace(path)


def set_value(paths: Paths, key: str, raw: str) -> Any:
    """`config set`: validate the whole file with the new value, then write it."""
    value = parse_value(key, raw)
    data = read_config_file(paths.config_file)
    _set_nested(data, key, value)
    config = _validate(data, f"after setting {key}")
    section, name = split_key(key)
    stored = getattr(getattr(config, section), name)
    _set_nested(data, key, stored)
    _write_file(paths.config_file, data)
    return stored


def unset_value(paths: Paths, key: str) -> bool:
    section, name = split_key(key)
    data = read_config_file(paths.config_file)
    values = data.get(section)
    if not isinstance(values, dict) or name not in values:
        return False
    del cast(dict[str, Any], values)[name]
    if not values:
        del data[section]
    _write_file(paths.config_file, data)
    return True
