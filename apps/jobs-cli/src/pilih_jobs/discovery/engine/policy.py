"""The forbidden-feature guard, layers 2 and 3 (15 §13, D-16, D-36).

Layer 1 is the AST test (`tests/discovery/test_policy.py`). This module is the single
place that names the forbidden features, as data:

- **Import-time guard.** `install_guard()` puts a `sys.meta_path` finder first; it raises
  `PolicyViolation` on any import of `patchright` or of Scrapling's stealth / CLI / MCP
  modules for the rest of the process. It is installed when `discovery.engine` is
  imported, before Scrapling is.
- **Controlled Scrapling import.** Scrapling 0.4.15 reaches the stealth stack from two
  modules we need: `engines/toolbelt/convertor.py` imports `patchright._impl._errors` for
  an exception class, and `spiders/session.py` resolves the stealth session classes
  through the lazy `scrapling.fetchers.__getattr__`. `scrapling_import_window()` serves
  inert placeholders for exactly those names while the engine imports Scrapling, then
  removes them: the real stealth driver never loads, every placeholder class raises
  `PolicyViolation` when instantiated, and a later import is refused by the finder.
- **Runtime option filter.** Scrapling kwargs are built only through `check_kwargs()`
  with an allow-list per call site and forced values (honest identity: no impersonation,
  no stealth headers, no fake Google referer, no proxies, wrapper-owned retries).
"""

from __future__ import annotations

import contextlib
import importlib.abc
import importlib.machinery
import sys
import types
from collections.abc import Generator, Mapping, Sequence
from typing import Any, Final, Literal

from pilih_jobs.discovery.errors import PolicyViolation
from pilih_jobs.version import __version__

# ---------------------------------------------------------------- the forbidden names
#: Modules whose import is refused (prefix match on dotted names).
BLOCKED_MODULES: Final = (
    "patchright",
    "scrapling.fetchers.stealth_chrome",
    "scrapling.engines._browsers._stealth",
    "scrapling.cli",
    "scrapling.core.ai",
)
#: Identifiers the AST policy test rejects anywhere in `src/` outside this module.
FORBIDDEN_NAMES: Final = frozenset(
    {
        "StealthyFetcher",
        "StealthySession",
        "AsyncStealthySession",
        "ProxyRotator",
        "solve_cloudflare",
        "hide_canvas",
        "block_webrtc",
        "patchright",
    }
)
#: Module paths the AST policy test rejects in imports and import strings.
FORBIDDEN_MODULE_PATHS: Final = frozenset(
    {
        "patchright",
        "scrapling.cli",
        "scrapling.mcp",
        "scrapling.core.ai",
        "scrapling.fetchers.stealth_chrome",
        "scrapling.engines._browsers._stealth",
    }
)
#: Stealth classes Scrapling's spiders resolve by name (placeholders during the window).
BLOCKED_STEALTH_CLASSES: Final = ("StealthyFetcher", "StealthySession", "AsyncStealthySession")
#: The one patchright name Scrapling's convertor imports (an exception class).
BLOCKED_ERRORS_MODULE: Final = "patchright._impl._errors"
BLOCKED_STEALTH_MODULE: Final = "scrapling.fetchers.stealth_chrome"
#: Scrapling kwargs that are never allowed, whatever the call site.
FORBIDDEN_KWARGS: Final = frozenset(
    {
        "solve_cloudflare",
        "hide_canvas",
        "block_webrtc",
        "allow_webgl",
        "proxy",
        "proxies",
        "proxy_auth",
        "proxy_rotator",
        "cdp_url",
        "real_chrome",
        "init_script",
        "page_action",
        "page_setup",
        "extra_flags",
        "additional_args",
        "executable_path",
        "dns_over_https",
        "cookies",
        "capture_xhr",
        "http3",
    }
)


def _blocked(fullname: str) -> bool:
    return any(fullname == name or fullname.startswith(f"{name}.") for name in BLOCKED_MODULES)


class _PolicyFinder(importlib.abc.MetaPathFinder):
    """Refuses forbidden imports (first entry of `sys.meta_path`)."""

    marker = "pilih_jobs.discovery.engine.policy"

    def find_spec(
        self,
        fullname: str,
        path: Sequence[str] | None,
        target: types.ModuleType | None = None,
    ) -> importlib.machinery.ModuleSpec | None:
        if _blocked(fullname):
            raise PolicyViolation(
                f"Import of {fullname!r} is forbidden in pilih-jobs (D-16: no stealth, "
                "fingerprint spoofing, proxy rotation or Scrapling CLI/MCP).",
                details={"module": fullname},
            )
        return None


def _finder_installed() -> bool:
    return any(getattr(f, "marker", None) == _PolicyFinder.marker for f in sys.meta_path)


def _is_placeholder(module: object) -> bool:
    return bool(getattr(module, "__pilih_placeholder__", False))


def loaded_forbidden_modules() -> list[str]:
    """Real (non-placeholder) forbidden modules already imported in this process."""
    return sorted(
        name
        for name, module in list(sys.modules.items())
        if _blocked(name) and not _is_placeholder(module)
    )


def install_guard() -> None:
    """Install the import guard (idempotent). Fails closed when a stealth module is loaded."""
    if not _finder_installed():
        sys.meta_path.insert(0, _PolicyFinder())
    loaded = loaded_forbidden_modules()
    if loaded:
        raise PolicyViolation(
            "Forbidden modules are already loaded in this process: " + ", ".join(loaded),
            details={"modules": loaded},
        )


def guard_installed() -> bool:
    return _finder_installed()


# ---------------------------------------------------------------- placeholders
def _refusing_class(name: str) -> type:
    def _refuse(*_args: Any, **_kwargs: Any) -> Any:
        raise PolicyViolation(f"{name} is forbidden in pilih-jobs (D-16).")

    return type(name, (), {"__new__": _refuse, "__module__": BLOCKED_STEALTH_MODULE})


class _RefusedFeature(Exception):  # noqa: N818 - stands in for a third-party class name
    """Stand-in for the stealth driver's error class; nothing ever raises it."""


def _placeholder_module(name: str, *, package: bool) -> types.ModuleType:
    module = types.ModuleType(name, "pilih-jobs policy placeholder (never the real module)")
    module.__spec__ = importlib.machinery.ModuleSpec(name, None, is_package=package)
    if package:
        module.__path__ = []
    module.__pilih_placeholder__ = True  # type: ignore[attr-defined]
    return module


def _placeholders() -> dict[str, types.ModuleType]:
    errors_parts = BLOCKED_ERRORS_MODULE.split(".")
    modules: dict[str, types.ModuleType] = {}
    for depth in range(1, len(errors_parts) + 1):
        name = ".".join(errors_parts[:depth])
        modules[name] = _placeholder_module(name, package=depth < len(errors_parts))
    errors_module = modules[BLOCKED_ERRORS_MODULE]
    errors_module.Error = _RefusedFeature  # type: ignore[attr-defined]
    errors_module.TimeoutError = _RefusedFeature  # type: ignore[attr-defined]
    stealth = _placeholder_module(BLOCKED_STEALTH_MODULE, package=False)
    for class_name in BLOCKED_STEALTH_CLASSES:
        setattr(stealth, class_name, _refusing_class(class_name))
    modules[BLOCKED_STEALTH_MODULE] = stealth
    return modules


@contextlib.contextmanager
def scrapling_import_window() -> Generator[None]:
    """Import Scrapling with inert placeholders for the stealth names it references."""
    install_guard()
    placeholders = _placeholders()
    previous = {name: sys.modules.get(name) for name in placeholders}
    for name, module in placeholders.items():
        if previous[name] is None:
            sys.modules[name] = module
    try:
        yield
    finally:
        for name, module in placeholders.items():
            if sys.modules.get(name) is module:
                del sys.modules[name]
        leaked = loaded_forbidden_modules()
        if leaked:
            raise PolicyViolation(
                "Scrapling imported a forbidden module: " + ", ".join(leaked),
                details={"modules": leaked},
            )


# ---------------------------------------------------------------- runtime option filter
CallSite = Literal["http_session", "http_request", "browser_session", "browser_fetch"]

#: Allowed keys per call site, with the forced value where one is required.
_REQUIRED: Final[Mapping[CallSite, Mapping[str, object]]] = {
    "http_session": {
        "impersonate": None,
        "stealthy_headers": False,
        "follow_redirects": "safe",
        "retries": 0,
        "verify": True,
    },
    "http_request": {"impersonate": None, "stealthy_headers": False},
    "browser_session": {
        "google_search": False,
        "block_ads": False,
        "retries": 1,  # 0.4.15 validates retries ≥ 1: one attempt, no retry
    },
    "browser_fetch": {"google_search": False},
}
_OPTIONAL: Final[Mapping[CallSite, frozenset[str]]] = {
    "http_session": frozenset({"timeout", "headers", "max_redirects", "selector_config"}),
    "http_request": frozenset({"timeout", "headers", "json", "selector_config"}),
    "browser_session": frozenset(
        {
            "headless",
            "disable_resources",
            "useragent",
            "user_data_dir",
            "max_pages",
            "timeout",
            "network_idle",
            "locale",
            "selector_config",
        }
    ),
    "browser_fetch": frozenset(
        {"timeout", "wait_selector", "network_idle", "disable_resources", "selector_config"}
    ),
}
_SAFE_HEADERS: Final = frozenset(
    {
        "accept",
        "accept-language",
        "content-type",
        "if-none-match",
        "if-modified-since",
        "referer",
        "user-agent",
    }
)
BROWSER_MAX_PAGES: Final = 2


def honest_user_agent() -> str:
    """`pilih-jobs/<ver> (+https://pilihpendidikan.com/bot)` — the only UA (15 §7.1)."""
    return f"pilih-jobs/{__version__} (+https://pilihpendidikan.com/bot)"


def _check_headers(headers: object) -> None:
    if headers is None:
        return
    if not isinstance(headers, Mapping):
        raise PolicyViolation("headers must be a mapping")
    for raw_key, raw_value in headers.items():  # pyright: ignore[reportUnknownVariableType]
        key = str(raw_key).lower()  # pyright: ignore[reportUnknownArgumentType]
        value = str(raw_value)  # pyright: ignore[reportUnknownArgumentType]
        if key not in _SAFE_HEADERS:
            raise PolicyViolation(f"header {raw_key!r} is not allowed in discovery requests")
        if key == "user-agent" and value != honest_user_agent():
            raise PolicyViolation("the User-Agent is fixed to the honest pilih-jobs UA")
        if key == "referer" and "google." in value.lower():
            raise PolicyViolation("fake referers are forbidden (D-16)")


def check_kwargs(site: CallSite, kwargs: Mapping[str, Any]) -> dict[str, Any]:
    """Validate Scrapling kwargs against the allow-list; returns a copy or raises."""
    required = _REQUIRED[site]
    optional = _OPTIONAL[site]
    for key, value in kwargs.items():
        if key in FORBIDDEN_KWARGS:
            raise PolicyViolation(f"Scrapling option {key!r} is forbidden (D-16)")
        if key in required:
            if value != required[key] or type(value) is not type(required[key]):
                raise PolicyViolation(
                    f"Scrapling option {key}={value!r} is not allowed (must be {required[key]!r})"
                )
        elif key not in optional:
            raise PolicyViolation(f"Scrapling option {key!r} is not on the allow-list")
    missing = [key for key in required if key not in kwargs]
    if missing:
        raise PolicyViolation(f"Scrapling call without the forced options {missing}")
    if "headers" in kwargs:
        _check_headers(kwargs["headers"])
    if site == "browser_session":
        if kwargs.get("useragent") != honest_user_agent():
            raise PolicyViolation("browser sessions must use the honest pilih-jobs UA")
        pages = kwargs.get("max_pages", 1)
        if not isinstance(pages, int) or pages > BROWSER_MAX_PAGES:
            raise PolicyViolation("at most two browser pages per run")
    return dict(kwargs)
