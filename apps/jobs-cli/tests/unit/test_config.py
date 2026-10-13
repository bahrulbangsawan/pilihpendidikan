"""TCLI-CONFIG: TOML config, precedence flags > env > file > defaults (16 §9)."""

from __future__ import annotations

import tomllib
from pathlib import Path

import pytest

from pilih_jobs import config as cfg
from pilih_jobs.errors import ConfigError
from pilih_jobs.paths import resolve_paths


def test_TCLI_CONFIG_defaults(home: Path) -> None:
    loaded = cfg.load_config(resolve_paths(), env={})
    assert loaded.config.api.url == "https://api.pilihpendidikan.com"
    assert loaded.config.browser.headless_for == ["discover", "render_cv"]
    assert loaded.config.worker.kinds == ["apply", "discover", "render_cv"]
    assert loaded.config.privacy.telemetry is False
    assert loaded.config.credentials.store == "keyring"
    assert set(loaded.sources.values()) == {"default"}


def test_TCLI_CONFIG_precedence_flags_env_file_defaults(home: Path) -> None:
    paths = resolve_paths()
    cfg.set_value(paths, "api.url", "http://localhost:8788")
    cfg.set_value(paths, "discovery.max_pages", "10")
    cfg.set_value(paths, "browser.mode", "connected")
    env = {"PILIH_JOBS_DISCOVERY_MAX_PAGES": "20", "PILIH_JOBS_BROWSER_MODE": "persistent"}
    loaded = cfg.load_config(paths, flags={"browser.mode": "managed"}, env=env)
    assert loaded.get("api.url") == "http://localhost:8788"
    assert loaded.sources["api.url"] == "file"
    assert loaded.get("discovery.max_pages") == 20
    assert loaded.sources["discovery.max_pages"] == "env"
    assert loaded.get("browser.mode") == "managed"
    assert loaded.sources["browser.mode"] == "flag"
    assert loaded.sources["logging.level"] == "default"


def test_TCLI_CONFIG_api_url_env_and_loopback_rule(home: Path) -> None:
    paths = resolve_paths()
    loaded = cfg.load_config(paths, env={"PILIH_JOBS_API_URL": "http://127.0.0.1:8788/"})
    assert loaded.get("api.url") == "http://127.0.0.1:8788"
    with pytest.raises(ConfigError, match="loopback"):
        cfg.load_config(paths, env={"PILIH_JOBS_API_URL": "http://api.example.com"})


def test_TCLI_CONFIG_set_validates_and_refuses_unknown_keys(home: Path) -> None:
    paths = resolve_paths()
    with pytest.raises(ConfigError, match="Unknown config key"):
        cfg.set_value(paths, "browser.nope", "1")
    with pytest.raises(ConfigError, match="Invalid configuration"):
        cfg.set_value(paths, "browser.mode", "stealth")
    with pytest.raises(ConfigError, match="true or false"):
        cfg.set_value(paths, "privacy.telemetry", "maybe")
    assert not paths.config_file.exists()


def test_TCLI_CONFIG_values_round_trip_through_toml(home: Path) -> None:
    paths = resolve_paths()
    assert cfg.set_value(paths, "worker.kinds", "apply,render_cv") == ["apply", "render_cv"]
    assert cfg.set_value(paths, "browser.headless_for", '["discover"]') == ["discover"]
    assert cfg.set_value(paths, "privacy.telemetry", "yes") is True
    assert cfg.set_value(paths, "credentials.store", "encrypted-file") == "encrypted-file"
    data = tomllib.loads(paths.config_file.read_text())
    assert data["worker"]["kinds"] == ["apply", "render_cv"]
    assert data["privacy"]["telemetry"] is True
    loaded = cfg.load_config(paths, env={})
    assert loaded.config.credentials.store == "encrypted-file"
    assert cfg.unset_value(paths, "privacy.telemetry") is True
    assert cfg.load_config(paths, env={}).config.privacy.telemetry is False


def test_TCLI_CONFIG_file_with_unknown_key_is_refused(home: Path) -> None:
    paths = resolve_paths()
    paths.config_file.parent.mkdir(parents=True)
    paths.config_file.write_text('[browser]\nmode = "managed"\nsecret_flag = true\n')
    with pytest.raises(ConfigError, match="Unknown config key"):
        cfg.load_config(paths, env={})


def test_TCLI_CONFIG_cdp_endpoint_must_be_loopback(home: Path) -> None:
    paths = resolve_paths()
    cfg.set_value(paths, "browser.cdp_endpoint", "http://127.0.0.1:9222")
    with pytest.raises(ConfigError):
        cfg.set_value(paths, "browser.cdp_endpoint", "http://10.0.0.5:9222")


def test_TCLI_CONFIG_reserved_env_vars_are_not_config(home: Path) -> None:
    env = {
        "PILIH_JOBS_TOKEN": "secret",
        "PILIH_JOBS_KEYRING_PASSPHRASE": "x",
        "PILIH_JOBS_UNKNOWN_THING": "1",
    }
    loaded = cfg.load_config(resolve_paths(), env=env)
    assert set(loaded.sources.values()) == {"default"}


def test_TCLI_CONFIG_explicit_config_path(home: Path, tmp_path: Path) -> None:
    target = tmp_path / "custom.toml"
    target.write_text('[logging]\nlevel = "debug"\n')
    paths = resolve_paths(target)
    assert paths.config_file == target.resolve()
    assert cfg.load_config(paths, env={}).config.logging.level == "debug"
