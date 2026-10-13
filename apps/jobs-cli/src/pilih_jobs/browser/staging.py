"""Upload staging (18 §7.1, 11 §4.6).

1. Files are downloaded **before the browser starts** into `<run_dir>/staging/` (0700),
   streamed to a temporary file, hashed and compared with `files.sha256`; a mismatch is
   `artifact_integrity` and the attempt stops. The directory is deleted when the attempt
   ends (kept only with `--keep-artifacts`).
2. The staged name is user-presentable — `<Full_Name>_CV_<Company>.pdf`, sanitized to
   `[A-Za-z0-9._-]`, ≤ 80 characters — because ATSs show it to recruiters.
3. Uploads come only from the staging directory: the executor asks for a `file_id` (the
   model never supplies a path), the path is resolved with `os.path.realpath`, must be a
   child of the staging directory, must not be a symlink, and its SHA-256 is re-checked
   right before `set_input_files`.
"""

from __future__ import annotations

import contextlib
import hashlib
import os
import re
import shutil
import stat
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Final, Literal

from pilih_jobs.browser.errors import ArtifactIntegrityError, UploadPathError
from pilih_jobs.paths import ensure_private_dir

Slot = Literal["cv_file", "cover_letter_file"]
MAX_NAME: Final = 80
_UNSAFE: Final = re.compile(r"[^A-Za-z0-9._-]+")

Downloader = Callable[[str, Path, str], Awaitable[Path]]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sanitize(part: str) -> str:
    text = _UNSAFE.sub("_", part.strip()).strip("._-")
    return re.sub(r"_+", "_", text)


def presentable_name(
    *, full_name: str | None, company: str | None, slot: Slot, extension: str = ".pdf"
) -> str:
    """`<Full_Name>_CV_<Company>.pdf` sanitized to `[A-Za-z0-9._-]`, ≤ 80 characters."""
    label = "CV" if slot == "cv_file" else "Cover_Letter"
    parts = [p for p in (_sanitize(full_name or ""), label, _sanitize(company or "")) if p]
    ext = extension if extension.startswith(".") else f".{extension}"
    ext = _sanitize(ext) or ".pdf"
    if not ext.startswith("."):
        ext = f".{ext}"
    stem = "_".join(parts)[: MAX_NAME - len(ext)].rstrip("._-") or label
    return f"{stem}{ext}"


def resolve_upload_path(staging_dir: Path, candidate: Path) -> Path:
    """Refuse anything that is not a regular file strictly inside the staging dir."""
    if any(part == ".." for part in candidate.parts):
        raise UploadPathError("Upload paths may not contain '..'.", details={"reason": "traversal"})
    root = os.path.realpath(staging_dir)
    if candidate.is_symlink():
        raise UploadPathError("Symlinks are never uploaded.", details={"reason": "symlink"})
    real = os.path.realpath(candidate)
    try:
        common = os.path.commonpath([real, root])
    except ValueError as exc:  # different drives on Windows
        raise UploadPathError(
            "The file is outside the staging directory.", details={"reason": "outside"}
        ) from exc
    if common != root or real == root:
        raise UploadPathError(
            "The file is outside the staging directory.", details={"reason": "outside"}
        )
    try:
        info = os.lstat(real)
    except OSError as exc:
        raise UploadPathError("The staged file is missing.", details={"reason": "missing"}) from exc
    if not stat.S_ISREG(info.st_mode):
        raise UploadPathError("Only regular files are uploaded.", details={"reason": "not_file"})
    return Path(real)


@dataclass
class StagedFile:
    file_id: str
    sha256: str
    path: Path
    name: str
    slot: Slot


class UploadStager:
    def __init__(self, run_dir: Path, *, keep: bool = False) -> None:
        self.run_dir = run_dir
        self.keep = keep
        self.files: dict[str, StagedFile] = {}

    @property
    def staging_dir(self) -> Path:
        return self.run_dir / "staging"

    def prepare(self) -> Path:
        ensure_private_dir(self.run_dir)
        return ensure_private_dir(self.staging_dir)

    async def stage(
        self,
        *,
        file_id: str,
        sha256: str,
        slot: Slot,
        company: str | None,
        full_name: str | None,
        download: Downloader,
    ) -> StagedFile:
        self.prepare()
        safe_id = _sanitize(file_id) or "file"
        temp = self.staging_dir / f".download-{safe_id}.part"
        with contextlib.suppress(FileNotFoundError):
            temp.unlink()
        returned = await download(file_id, temp, sha256)
        source = Path(returned)
        try:
            source = resolve_upload_path(self.staging_dir, source)
        except UploadPathError as exc:
            raise ArtifactIntegrityError(
                "The downloaded file did not land in the staging directory."
            ) from exc
        actual = sha256_file(source)
        if actual.lower() != sha256.lower():
            with contextlib.suppress(FileNotFoundError):
                source.unlink()
            raise ArtifactIntegrityError(
                "The downloaded file does not match its SHA-256.",
                details={"file_id": file_id, "slot": slot},
            )
        name = self._unique(presentable_name(full_name=full_name, company=company, slot=slot))
        final = self.staging_dir / name
        source.replace(final)
        if os.name == "posix":
            final.chmod(0o600)
        staged = StagedFile(file_id=file_id, sha256=actual, path=final, name=name, slot=slot)
        self.files[file_id] = staged
        return staged

    def _unique(self, name: str) -> str:
        taken = {f.name for f in self.files.values()}
        if name not in taken and not (self.staging_dir / name).exists():
            return name
        stem, dot, ext = name.rpartition(".")
        for n in range(2, 100):
            candidate = f"{stem}_{n}.{ext}" if dot else f"{name}_{n}"
            if candidate not in taken and not (self.staging_dir / candidate).exists():
                return candidate
        raise ArtifactIntegrityError("Could not name the staged file.")

    def rename_for(self, file_id: str, *, full_name: str | None, company: str | None) -> StagedFile:
        """Give a staged file its presentable name once the applicant's name is known."""
        staged = self.verified(file_id)
        name = presentable_name(full_name=full_name, company=company, slot=staged.slot)
        if name == staged.name:
            return staged
        name = self._unique(name)
        target = self.staging_dir / name
        staged.path.replace(target)
        staged.path, staged.name = target, name
        return staged

    def verified(self, file_id: str) -> StagedFile:
        """The staged file for `file_id`, re-checked: inside staging, no symlink, same hash."""
        staged = self.files.get(file_id)
        if staged is None:
            raise UploadPathError(
                "That file is not part of this task's bundle.", details={"reason": "unknown_file"}
            )
        path = resolve_upload_path(self.staging_dir, staged.path)
        if sha256_file(path).lower() != staged.sha256.lower():
            raise ArtifactIntegrityError(
                "The staged file changed on disk.", details={"file_id": file_id}
            )
        return staged

    def cleanup(self) -> None:
        if self.keep:
            return
        shutil.rmtree(self.staging_dir, ignore_errors=True)
