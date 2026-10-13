"""Render the Homebrew formula and the Scoop manifest for one pilih-jobs release.

job-tracker-spec 22 §2 / §7 step 8. Run from `apps/jobs-cli` after `uv build`:

    uv run python packaging/render.py --dist dist --out dist/packaging

Inputs: the version in `pyproject.toml`; the sdist and the wheel `uv build` wrote to
`--dist` (their SHA-256 pin the formula and the manifest); the runtime dependency closure
of `uv.lock` (`uv export --no-dev`), which becomes one Homebrew `resource` per package for
macOS and Linux with Python 3.12: the sdist where PyPI has one, the platform wheels
otherwise (`WHEEL_PACKAGES`). Writes `<out>/pilih-jobs.rb` and `<out>/pilih-jobs.json`.
Publishes nothing.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import tomllib
from dataclasses import dataclass
from pathlib import Path

from packaging.markers import Marker
from packaging.utils import canonicalize_name, parse_wheel_filename

ROOT = Path(__file__).resolve().parent.parent
HOMEBREW_TEMPLATE = ROOT / "packaging" / "homebrew" / "pilih-jobs.rb"
SCOOP_TEMPLATE = ROOT / "packaging" / "scoop" / "pilih-jobs.json"
PYPI_SDIST = "https://files.pythonhosted.org/packages/source/p/pilih-jobs/{name}"

# Installed from platform wheels: no sdist on PyPI (playwright, patchright), or an
# sdist whose build downloads binaries (curl_cffi fetches curl-impersonate).
EXTRA_WHEEL_PACKAGES = frozenset({"curl-cffi"})
PYTHON = "3.12"
# Homebrew platforms: (on_<os>, on_<arch>, packaging marker environment, wheel tag test).
PLATFORMS = {
    ("macos", "arm"): ("darwin", "arm64", re.compile(r"^macosx_\d+_\d+_(arm64|universal2)$")),
    ("macos", "intel"): ("darwin", "x86_64", re.compile(r"^macosx_\d+_\d+_(x86_64|universal2)$")),
    ("linux", "arm"): ("linux", "aarch64", re.compile(r"^manylinux.*_aarch64$")),
    ("linux", "intel"): ("linux", "x86_64", re.compile(r"^manylinux.*_x86_64$")),
}
PLACEHOLDER = re.compile(r"@[A-Z][A-Z0-9_]*@")
REQUIREMENT = re.compile(
    r"^(?P<name>[A-Za-z0-9._-]+)(\[[^\]]*\])?==(?P<version>[^\s;]+)\s*(;\s*(?P<marker>.+))?$"
)


@dataclass(frozen=True)
class Pin:
    name: str
    version: str
    marker: Marker | None


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def project_version() -> str:
    data = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    return str(data["project"]["version"])


def runtime_pins() -> list[Pin]:
    exported = subprocess.run(
        [
            "uv",
            "export",
            "--frozen",
            "--no-dev",
            "--no-emit-project",
            "--no-hashes",
            "--format",
            "requirements-txt",
            "--quiet",
        ],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    pins: list[Pin] = []
    for raw in exported.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        match = REQUIREMENT.match(line)
        if match is None:
            raise SystemExit(f"render: cannot parse exported requirement {line!r}")
        marker = match["marker"]
        pins.append(
            Pin(
                str(canonicalize_name(match["name"])),
                match["version"],
                Marker(marker) if marker else None,
            )
        )
    return pins


def marker_env(sys_platform: str, machine: str) -> dict[str, str]:
    return {
        "implementation_name": "cpython",
        "platform_machine": machine,
        "platform_python_implementation": "CPython",
        "platform_system": "Darwin" if sys_platform == "darwin" else "Linux",
        "python_full_version": f"{PYTHON}.0",
        "python_version": PYTHON,
        "sys_platform": sys_platform,
        "os_name": "posix",
    }


def locked_packages() -> dict[tuple[str, str], dict[str, object]]:
    lock = tomllib.loads((ROOT / "uv.lock").read_text(encoding="utf-8"))
    return {
        (str(canonicalize_name(p["name"])), str(p["version"])): p
        for p in lock["package"]
        if "version" in p
    }


def pick_wheel(package: dict[str, object], tag: re.Pattern[str]) -> dict[str, str] | None:
    """The most compatible wheel for CPython 3.12 on one platform (lowest manylinux)."""
    candidates: list[tuple[int, dict[str, str]]] = []
    for wheel in package.get("wheels", []):  # type: ignore[union-attr]
        url = str(wheel["url"])  # type: ignore[index]
        _, _, _, tags = parse_wheel_filename(url.rsplit("/", 1)[1])
        for t in tags:
            python_ok = t.interpreter in ("py3", "cp312") or (
                t.abi == "abi3" and t.interpreter.startswith("cp3")
            )
            if python_ok and tag.match(t.platform):
                glibc = re.search(r"manylinux_?(\d+)_(\d+)", t.platform)
                rank = int(glibc[1]) * 100 + int(glibc[2]) if glibc else 0
                if "manylinux1" in t.platform or "manylinux2010" in t.platform:
                    rank = 205 if "manylinux1" in t.platform else 212
                candidates.append((rank, wheel))  # type: ignore[arg-type]
                break
    if not candidates:
        return None
    return min(candidates, key=lambda c: c[0])[1]


def resource(name: str, url: str, digest: str, indent: str) -> str:
    return (
        f'{indent}resource "{name}" do\n'
        f'{indent}  url "{url}"\n'
        f'{indent}  sha256 "{digest}"\n'
        f"{indent}end\n"
    )


def homebrew_resources(pins: list[Pin]) -> tuple[str, list[str]]:
    packages = locked_packages()
    common: list[str] = []
    per_os: dict[str, list[str]] = {"macos": [], "linux": []}
    per_platform: dict[tuple[str, str], list[str]] = {key: [] for key in PLATFORMS}
    wheel_names: list[str] = []
    for pin in sorted(pins, key=lambda p: p.name):
        package = packages.get((pin.name, pin.version))
        if package is None:
            raise SystemExit(f"render: {pin.name}=={pin.version} is not in uv.lock")
        oses = {
            os_name
            for (os_name, _), (platform, machine, _) in PLATFORMS.items()
            if pin.marker is None or pin.marker.evaluate(marker_env(platform, machine))
        }
        if not oses:
            continue
        sdist = package.get("sdist")
        if sdist is not None and pin.name not in EXTRA_WHEEL_PACKAGES:
            url = str(sdist["url"])  # type: ignore[index]
            digest = str(sdist["hash"]).removeprefix("sha256:")  # type: ignore[index]
            if oses == {"macos", "linux"}:
                common.append(resource(pin.name, url, digest, "  "))
            else:
                for os_name in oses:
                    per_os[os_name].append(resource(pin.name, url, digest, "    "))
            continue
        wheel_names.append(pin.name)
        for key, (_, _, tag) in PLATFORMS.items():
            if key[0] not in oses:
                continue
            wheel = pick_wheel(package, tag)
            if wheel is None:
                raise SystemExit(f"render: no {key} wheel for {pin.name}=={pin.version}")
            digest = wheel["hash"].removeprefix("sha256:")
            per_platform[key].append(resource(pin.name, wheel["url"], digest, "      "))
    # Homebrew style: a blank line between sibling blocks.
    blocks = ["\n".join(common).rstrip("\n")]
    for os_name in ("macos", "linux"):
        parts = [r.rstrip("\n") for r in per_os[os_name]]
        for arch in ("arm", "intel"):
            if per_platform[(os_name, arch)]:
                body = "\n\n".join(r.rstrip("\n") for r in per_platform[(os_name, arch)])
                parts.append(f"    on_{arch} do\n{body}\n    end")
        if parts:
            inner = "\n\n".join(parts)
            blocks.append(f"  on_{os_name} do\n{inner}\n  end")
    return "\n\n".join(b for b in blocks if b).lstrip(), sorted(wheel_names)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dist", type=Path, default=ROOT / "dist")
    parser.add_argument("--out", type=Path, default=ROOT / "dist" / "packaging")
    args = parser.parse_args()

    version = project_version()
    stem = f"pilih_jobs-{version}"
    sdist = args.dist / f"{stem}.tar.gz"
    wheel = args.dist / f"{stem}-py3-none-any.whl"
    for path in (sdist, wheel):
        if not path.is_file():
            raise SystemExit(f"render: {path} is missing; run `uv build` first")

    resources, wheel_names = homebrew_resources(runtime_pins())
    template = HOMEBREW_TEMPLATE.read_text(encoding="utf-8")
    header = (
        f"# pilih-jobs {version}: generated by apps/jobs-cli/packaging/render.py from the\n"
        "# template next to it and uv.lock (job-tracker-spec 22 §2). Do not edit by hand.\n"
    )
    formula = (
        (header + template[template.index("class PilihJobs") :])
        .replace("@SDIST_URL@", PYPI_SDIST.format(name=sdist.name))
        .replace("@SDIST_SHA256@", sha256(sdist))
        .replace("@WHEEL_RESOURCES@", " ".join(wheel_names))
        .replace("# @RESOURCES@", resources)
    )
    manifest = json.loads(SCOOP_TEMPLATE.read_text(encoding="utf-8"))
    manifest.pop("##", None)
    rendered = (
        json.dumps(manifest, indent=4, ensure_ascii=False)
        .replace("@VERSION@", version)
        .replace("@WHEEL_SHA256@", sha256(wheel))
    )
    for text, label in ((formula, "formula"), (rendered, "manifest")):
        if PLACEHOLDER.search(text):
            raise SystemExit(f"render: unfilled placeholder in the {label}")

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "pilih-jobs.rb").write_text(formula, encoding="utf-8")
    (args.out / "pilih-jobs.json").write_text(rendered + "\n", encoding="utf-8")
    print(f"render: pilih-jobs {version} → {args.out}/pilih-jobs.rb, pilih-jobs.json")  # noqa: T201


if __name__ == "__main__":
    main()
