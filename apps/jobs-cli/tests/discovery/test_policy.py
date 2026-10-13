"""The forbidden-feature guard (15 §13, D-16, D-36; 11 §13 "Stealth import guard").

Layer 1 — static: every module under `src/pilih_jobs/` is parsed; imports, attribute
access, names, keyword arguments and string literals that name a forbidden feature
(StealthyFetcher, StealthySession, AsyncStealthySession, ProxyRotator, solve_cloudflare,
hide_canvas, block_webrtc, patchright, scrapling.cli, scrapling.mcp, the stealth modules)
fail the test, as does any `import scrapling` outside `pilih_jobs/discovery/engine/`.
String literals count when they reach getattr/setattr/import_module/__import__/find_spec
or a kwargs dict; inside `discovery/engine/` every literal counts. The one exemption is
the guard itself (`discovery/engine/policy.py`), and only for the string constants of
its `FORBIDDEN_*` / `BLOCKED_*` tables. (A plain membership check such as
`"patchright" in sys.modules` elsewhere is not a use.)
Layer 2 — the `sys.meta_path` finder. Layer 3 — the kwargs allow-list.
"""

from __future__ import annotations

import ast
import importlib
import subprocess
import sys
import types
from dataclasses import dataclass
from pathlib import Path

import pytest

from pilih_jobs.discovery.engine import policy
from pilih_jobs.discovery.errors import PolicyViolation
from tests.discovery.support import FIXTURES

SRC = Path(__file__).resolve().parents[2] / "src" / "pilih_jobs"
ENGINE_DIR = SRC / "discovery" / "engine"
GUARD = ENGINE_DIR / "policy.py"
NAMES = frozenset(policy.FORBIDDEN_NAMES)
MODULES = frozenset(policy.FORBIDDEN_MODULE_PATHS)


@dataclass(frozen=True)
class Finding:
    path: str
    line: int
    what: str


def _forbidden_module(name: str) -> bool:
    return any(name == m or name.startswith(f"{m}.") for m in MODULES)


def _forbidden_string(value: str) -> bool:
    return value in NAMES or _forbidden_module(value)


#: Calls that turn a string into an import or an attribute access ("in any spelling").
DYNAMIC_ACCESS = frozenset(
    {
        "getattr",
        "setattr",
        "hasattr",
        "delattr",
        "import_module",
        "__import__",
        "find_spec",
        "find_module",
    }
)


def _call_name(node: ast.Call) -> str:
    func = node.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return ""


def _exempt_constants(tree: ast.Module) -> set[int]:
    """ids of string constants inside the guard's FORBIDDEN_* / BLOCKED_* tables."""
    exempt: set[int] = set()
    for node in tree.body:
        targets: list[ast.expr] = []
        if isinstance(node, ast.Assign):
            targets = node.targets
        elif isinstance(node, ast.AnnAssign):
            targets = [node.target]
        names = [t.id for t in targets if isinstance(t, ast.Name)]
        if any(n.startswith(("FORBIDDEN_", "BLOCKED_")) for n in names):
            value = node.value
            for child in ast.walk(value) if value is not None else []:
                if isinstance(child, ast.Constant):
                    exempt.add(id(child))
    return exempt


def scan(path: Path, *, display: str, in_engine: bool, is_guard: bool = False) -> list[Finding]:
    tree = ast.parse(path.read_text("utf-8"), filename=str(path))
    exempt = _exempt_constants(tree) if is_guard else set()
    findings: list[Finding] = []

    def add(node: ast.AST, what: str) -> None:
        findings.append(Finding(display, getattr(node, "lineno", 0), what))

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if _forbidden_module(alias.name):
                    add(node, f"import {alias.name}")
                if alias.name.split(".")[0] == "scrapling" and not in_engine:
                    add(node, f"scrapling import outside the engine: {alias.name}")
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            if _forbidden_module(module):
                add(node, f"from {module} import …")
            if module.split(".")[0] == "scrapling" and not in_engine:
                add(node, f"scrapling import outside the engine: {module}")
            for alias in node.names:
                if alias.name in NAMES or _forbidden_module(f"{module}.{alias.name}"):
                    add(node, f"from {module} import {alias.name}")
        elif isinstance(node, ast.Attribute) and node.attr in NAMES:
            add(node, f"attribute .{node.attr}")
        elif isinstance(node, ast.Name) and node.id in NAMES:
            add(node, f"name {node.id}")
        elif isinstance(node, ast.keyword) and node.arg in NAMES:
            add(node, f"keyword {node.arg}=")
        elif isinstance(node, ast.Call) and _call_name(node) in DYNAMIC_ACCESS:
            for arg in node.args:
                if (
                    isinstance(arg, ast.Constant)
                    and isinstance(arg.value, str)
                    and _forbidden_string(arg.value)
                ):
                    add(arg, f"string {arg.value!r}")
        elif isinstance(node, ast.Dict):
            for key in node.keys:
                if (
                    isinstance(key, ast.Constant)
                    and isinstance(key.value, str)
                    and key.value in NAMES
                    and id(key) not in exempt
                ):
                    add(key, f"string {key.value!r}")
        elif (
            isinstance(node, ast.Constant)
            and isinstance(node.value, str)
            and id(node) not in exempt
        ):
            if _forbidden_string(node.value) and in_engine:
                add(node, f"string {node.value!r}")
        elif (
            isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef | ast.ClassDef)
            and node.name in NAMES
        ):
            add(node, f"definition {node.name}")
    return findings


def scan_src() -> list[Finding]:
    findings: list[Finding] = []
    for path in sorted(SRC.rglob("*.py")):
        rel = path.relative_to(SRC.parent).as_posix()
        findings.extend(
            scan(path, display=rel, in_engine=ENGINE_DIR in path.parents, is_guard=path == GUARD)
        )
    return findings


# ---------------------------------------------------------------- layer 1
def test_T15_POLICY_ast_scan_of_src_is_clean() -> None:
    assert scan_src() == []


def test_T15_POLICY_ast_scan_catches_the_planted_module() -> None:
    """Positive control: the scanner must fail on a module using every forbidden feature."""
    planted = FIXTURES / "policy" / "planted_stealth.py"
    whats = {f.what for f in scan(planted, display="planted", in_engine=False)}
    expected_fragments = [
        "import patchright",
        "from scrapling.fetchers import StealthyFetcher",
        "from scrapling.fetchers.stealth_chrome import",
        "ProxyRotator",
        "import scrapling.cli",
        "string 'StealthySession'",
        "string 'scrapling.mcp'",
        "keyword solve_cloudflare=",
        "keyword hide_canvas=",
        "keyword block_webrtc=",
        "scrapling import outside the engine",
    ]
    for fragment in expected_fragments:
        assert any(fragment in w for w in whats), (fragment, sorted(whats))


def test_T15_POLICY_scrapling_imported_only_in_the_engine() -> None:
    importers = set()
    for path in SRC.rglob("*.py"):
        tree = ast.parse(path.read_text("utf-8"))
        for node in ast.walk(tree):
            module = None
            if isinstance(node, ast.ImportFrom):
                module = node.module
            elif isinstance(node, ast.Import):
                module = node.names[0].name
            if module and module.split(".")[0] == "scrapling":
                importers.add(path.relative_to(SRC).as_posix())
    assert importers
    assert all(p.startswith("discovery/engine/") for p in importers), importers


def test_T15_POLICY_guard_exemption_is_limited_to_its_tables(tmp_path: Path) -> None:
    rogue = tmp_path / "policy.py"
    rogue.write_text('BLOCKED_X = ("patchright",)\nleak = "patchright"\n')
    whats = [f.what for f in scan(rogue, display="rogue", in_engine=True, is_guard=True)]
    assert whats == ["string 'patchright'"]


def test_T15_POLICY_cli_does_not_import_scrapling() -> None:
    code = (
        "import sys, pilih_jobs.cli.app; print([m for m in sys.modules "
        "if m.split('.')[0] in ('scrapling','patchright','playwright')])"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, check=True)
    assert out.stdout.strip() == "[]"


# ---------------------------------------------------------------- layer 2
def test_T11_STEALTH_import_guard_refuses_patchright() -> None:
    policy.install_guard()
    assert policy.guard_installed()
    with pytest.raises(PolicyViolation):
        importlib.import_module("patchright")
    with pytest.raises(PolicyViolation):
        importlib.import_module("patchright.async_api")


def test_T11_STEALTH_import_guard_refuses_stealth_fetchers() -> None:
    from pilih_jobs.discovery.engine import _scrapling

    _scrapling.load()
    fetchers = importlib.import_module("scrapling.fetchers")
    for name in ("StealthyFetcher", "StealthySession", "AsyncStealthySession"):
        with pytest.raises(PolicyViolation):
            getattr(fetchers, name)
    for module in (
        "scrapling.fetchers.stealth_chrome",
        "scrapling.engines._browsers._stealth",
        "scrapling.cli",
    ):
        with pytest.raises(PolicyViolation):
            importlib.import_module(module)
    assert not [m for m in sys.modules if m.startswith("patchright")]


def test_T11_STEALTH_placeholders_cannot_be_instantiated() -> None:
    from pilih_jobs.discovery.engine import _scrapling

    _scrapling.load()
    session_module = sys.modules["scrapling.spiders.session"]
    placeholder = session_module.AsyncStealthySession
    with pytest.raises(PolicyViolation):
        placeholder()


def test_T11_STEALTH_guard_fails_closed_when_stealth_code_is_loaded(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setitem(
        sys.modules, "patchright.async_api", types.ModuleType("patchright.async_api")
    )
    with pytest.raises(PolicyViolation):
        policy.install_guard()


def test_T11_STEALTH_proxy_rotation_refused() -> None:
    base = {
        "impersonate": None,
        "stealthy_headers": False,
        "follow_redirects": "safe",
        "retries": 0,
        "verify": True,
    }
    for key in ("proxy_rotator", "proxy", "proxies"):
        with pytest.raises(PolicyViolation):
            policy.check_kwargs("http_session", {**base, key: object()})


# ---------------------------------------------------------------- layer 3
HTTP_OK = {
    "impersonate": None,
    "stealthy_headers": False,
    "follow_redirects": "safe",
    "retries": 0,
    "verify": True,
    "headers": {"User-Agent": policy.honest_user_agent()},
}
BROWSER_OK = {
    "google_search": False,
    "block_ads": False,
    "retries": 1,
    "useragent": policy.honest_user_agent(),
    "headless": True,
    "max_pages": 1,
}


def test_T15_POLICY_honest_kwargs_accepted() -> None:
    assert policy.check_kwargs("http_session", HTTP_OK) == HTTP_OK
    assert policy.check_kwargs("browser_session", BROWSER_OK) == BROWSER_OK
    assert policy.honest_user_agent() == "pilih-jobs/0.1.0 (+https://pilihpendidikan.com/bot)"


@pytest.mark.parametrize(
    ("site", "change"),
    [
        ("http_session", {"impersonate": "chrome"}),
        ("http_session", {"stealthy_headers": True}),
        ("http_session", {"retries": 3}),
        ("http_session", {"follow_redirects": True}),
        ("http_session", {"headers": {"User-Agent": "Mozilla/5.0"}}),
        ("http_session", {"headers": {"Referer": "https://www.google.com/"}}),
        ("http_session", {"headers": {"Cookie": "a=1"}}),
        ("http_session", {"unknown_option": 1}),
        ("browser_session", {"google_search": True}),
        ("browser_session", {"solve_cloudflare": True}),
        ("browser_session", {"hide_canvas": True}),
        ("browser_session", {"real_chrome": True}),
        ("browser_session", {"cdp_url": "ws://127.0.0.1:9222"}),
        ("browser_session", {"useragent": "Mozilla/5.0"}),
        ("browser_session", {"max_pages": 5}),
    ],
)
def test_T15_POLICY_kwargs_allow_list_refuses(site: str, change: dict[str, object]) -> None:
    base = HTTP_OK if site == "http_session" else BROWSER_OK
    with pytest.raises(PolicyViolation):
        policy.check_kwargs(site, {**base, **change})  # type: ignore[arg-type]


def test_T15_POLICY_forced_options_cannot_be_omitted() -> None:
    with pytest.raises(PolicyViolation):
        policy.check_kwargs("http_session", {"timeout": 30})
    with pytest.raises(PolicyViolation):
        policy.check_kwargs("browser_fetch", {"timeout": 1000})


def test_T15_POLICY_spider_settings_obey_robots_and_never_cache() -> None:
    from pilih_jobs.discovery.engine import _scrapling
    from pilih_jobs.discovery.engine.crawler import _spider_class

    spider = _spider_class(_scrapling.load().sitemap_spider)
    assert spider.robots_txt_obey is True
    assert spider.development_mode is False
    assert spider.concurrent_requests_per_domain == 1
    assert spider.download_delay >= 2.0
    assert spider.autothrottle_enabled is True
    assert spider.autothrottle_max_delay == 60.0
    assert spider.max_blocked_retries == 0


def test_T15_POLICY_adaptive_store_lives_in_the_data_dir(tmp_path: Path) -> None:
    from tests.discovery.support import VirtualClock, make_engine

    engine = make_engine(tmp_path, VirtualClock())
    kwargs = engine.adaptive.selector_kwargs("https://acme.com/careers")
    assert (
        Path(kwargs["storage_args"]["storage_file"])
        == tmp_path / "data" / "scrapling" / "adaptive.db"
    )
