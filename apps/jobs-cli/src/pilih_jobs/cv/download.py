"""Verified file downloads, staging names and cleanup (08 §8, 18 §7.1).

`download_verified()` streams `GET /api/v1/files/{id}/content` into a temporary file next
to the destination, hashes it while writing, and accepts it only when the SHA-256 equals
the expected `files.sha256` **and** the response `ETag` (the API sends `"<sha256>"`). On a
mismatch the partial file is deleted and `ArtifactIntegrityError` is raised (`error_class =
artifact_integrity`). Verified bytes are also kept in a content-addressed cache
(`<cache>/files/<sha256>`) so `cv download` works offline for files seen before (20 §10).
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Final

from pilih_jobs.api.client import ApiClient
from pilih_jobs.paths import Paths, ensure_private_dir
from pilih_jobs.tasks.errors import ArtifactIntegrityError

_HEX64 = re.compile(r"^[0-9a-f]{64}$")
_UNSAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")
MAX_PRESENTABLE: Final = 80
CHUNK: Final = 65_536


@dataclass(frozen=True)
class DownloadResult:
    path: Path
    sha256: str
    size_bytes: int
    etag: str | None = None
    from_cache: bool = False

    def as_dict(self) -> dict[str, object]:
        return {
            "path": str(self.path),
            "sha256": self.sha256,
            "size_bytes": self.size_bytes,
            "from_cache": self.from_cache,
        }


def etag_digest(etag: str | None) -> str | None:
    """The SHA-256 carried by an ETag (`"<hex>"`, `W/"<hex>"`, `"sha256:<hex>"`), if any."""
    if not etag:
        return None
    value = etag.strip()
    if value.startswith("W/"):
        value = value[2:]
    value = value.strip('"').lower()
    value = value.removeprefix("sha256:")
    return value if _HEX64.match(value) else None


def _discard(*paths: Path) -> None:
    for path in paths:
        with contextlib.suppress(OSError):
            path.unlink()


def _commit(tmp: Path, dest: Path) -> None:
    tmp.replace(dest)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def cache_path(paths: Paths, sha256: str) -> Path:
    return paths.cache_dir / "files" / sha256.lower()


def _store_in_cache(paths: Paths | None, source: Path, sha256: str) -> None:
    if paths is None:
        return
    target = cache_path(paths, sha256)
    with contextlib.suppress(OSError):
        ensure_private_dir(target.parent)
        if not target.exists():
            tmp = target.with_name(f".{target.name}.tmp")
            shutil.copyfile(source, tmp)
            tmp.replace(target)


def from_cache(paths: Paths, sha256: str, dest: Path) -> DownloadResult | None:
    """Copy a cached verified file to `dest` when its bytes still hash to `sha256`."""
    cached = cache_path(paths, sha256)
    if not cached.is_file() or cached.is_symlink():
        return None
    if sha256_file(cached) != sha256.lower():
        with contextlib.suppress(OSError):
            cached.unlink()
        return None
    ensure_private_dir(dest.parent)
    tmp = dest.with_name(f".{dest.name}.part")
    shutil.copyfile(cached, tmp)
    tmp.replace(dest)
    return DownloadResult(dest, sha256.lower(), dest.stat().st_size, None, from_cache=True)


async def download_verified(
    api: ApiClient,
    file_id: str,
    dest: Path,
    expected_sha256: str | None,
    *,
    paths: Paths | None = None,
) -> DownloadResult:
    """Stream a file to `dest` and verify SHA-256 + ETag; delete and raise on mismatch."""
    ensure_private_dir(dest.parent)
    tmp = dest.with_name(f".{dest.name}.part")
    digest = hashlib.sha256()
    size = 0
    etag: str | None = None
    try:
        async with api.stream("GET", f"/api/v1/files/{file_id}/content") as response:
            etag = response.headers.get("etag")
            fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "wb") as handle:
                async for chunk in response.aiter_bytes(CHUNK):
                    handle.write(chunk)
                    digest.update(chunk)
                    size += len(chunk)
    except BaseException:
        _discard(tmp)
        raise
    actual = digest.hexdigest()
    problems: list[str] = []
    if expected_sha256 is not None and actual != expected_sha256.lower():
        problems.append("sha256 does not match files.sha256")
    if etag is not None:
        tagged = etag_digest(etag)
        if tagged is None:
            problems.append("ETag carries no SHA-256")
        elif tagged != actual:
            problems.append("sha256 does not match the ETag")
    if problems:
        _discard(tmp, dest)
        raise ArtifactIntegrityError(
            f"Integrity check failed for {file_id}: {'; '.join(problems)}. The copy was deleted.",
            details={
                "file_id": file_id,
                "expected_sha256": expected_sha256,
                "actual_sha256": actual,
                "etag": etag,
                "error_class": "artifact_integrity",
            },
        )
    _commit(tmp, dest)
    _store_in_cache(paths, dest, actual)
    return DownloadResult(dest, actual, size, etag)


# ---------------------------------------------------------------------- staging
def safe_component(text: str) -> str:
    """`[A-Za-z0-9._-]` only (18 §7.1); runs of other characters become one `_`."""
    return _UNSAFE_NAME.sub("_", text.strip()).strip("._-")


def presentable_cv_name(full_name: str | None, company: str | None, *, ext: str = ".pdf") -> str:
    """`<Full_Name>_CV_<Company>.pdf`, sanitized, at most 80 characters (18 §7.1, 08 §8)."""
    parts = [safe_component(full_name or ""), "CV", safe_component(company or "")]
    stem = "_".join(p for p in parts if p) or "CV"
    room = MAX_PRESENTABLE - len(ext)
    return f"{stem[:room].rstrip('._-')}{ext}"


def staging_dir(paths: Paths, run_or_attempt_id: str) -> Path:
    """`<data>/runs/<id>/staging/` (0700), created on demand."""
    return ensure_private_dir(paths.staging_dir(run_or_attempt_id))


def cleanup_staging(paths: Paths, run_or_attempt_id: str) -> bool:
    """Delete the staging directory of an attempt (08 §8 step 5); True when removed."""
    target = paths.staging_dir(run_or_attempt_id)
    if not target.exists():
        return False
    shutil.rmtree(target, ignore_errors=True)
    return not target.exists()


def rename_presentable(path: Path, name: str) -> Path:
    """Rename a staged file to the employer-facing name (bytes unchanged)."""
    target = path.with_name(name)
    if target == path:
        return path
    if target.exists():
        target.unlink()
    path.replace(target)
    return target
