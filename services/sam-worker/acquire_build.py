"""Networked build-only acquisition for the closed SAM runtime input directory."""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import stat
from pathlib import Path
from typing import Any, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import (
    HTTPRedirectHandler,
    ProxyHandler,
    Request,
    build_opener,
)

from sam_worker.artifacts import (
    ArtifactError,
    IMAGE_ADAPTER_PROFILE_PATH,
    IMAGE_CHECKPOINT_PATH,
    IMAGE_DEPENDENCY_LICENSES_PATH,
    IMAGE_LICENSE_ROOT,
    IMAGE_MANIFEST_PATH,
    IMAGE_MODEL_LOADER_PATH,
    IMAGE_OVERLAY_ROOT,
    IMAGE_SOURCE_ROOT,
    extract_reviewed_runtime_source,
    load_reviewed_manifest,
    verify_checkpoint_artifact,
    verify_dependency_build_ready,
    verify_dependency_input_set,
    verify_runtime_artifacts,
    verify_source_archive,
)

ARCHIVE_HOST = "codeload.github.com"
CHECKPOINT_HOST = "dl.fbaipublicfiles.com"
WHEEL_HOST = "files.pythonhosted.org"
DOWNLOAD_CHUNK_BYTES = 1024 * 1024


class _RejectRedirects(HTTPRedirectHandler):
    def redirect_request(
        self,
        _request: Any,
        _file_pointer: Any,
        _code: Any,
        _message: Any,
        _headers: Any,
        _new_url: Any,
    ) -> None:
        raise ArtifactError("Reviewed acquisition redirect was refused.")


def _safe_empty_directory(path: Path) -> None:
    try:
        path.mkdir(parents=True, exist_ok=False)
    except OSError as error:
        raise ArtifactError("Acquisition directory is unavailable.") from error


def _download(
    *,
    opener: Any,
    url: str,
    expected_host: str,
    expected_byte_size: int,
    expected_sha256: str,
    destination: Path,
) -> None:
    parsed = urlsplit(url)
    if (
        not url.isascii()
        or parsed.scheme != "https"
        or parsed.hostname != expected_host
        or parsed.port is not None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        raise ArtifactError("Reviewed acquisition URL is invalid.")
    request = Request(
        url,
        headers={
            "Accept": "application/octet-stream",
            "User-Agent": "fabrica-sam-build-acquisition-v1",
        },
        method="GET",
    )
    descriptor = -1
    try:
        descriptor = os.open(
            destination,
            os.O_WRONLY
            | os.O_CREAT
            | os.O_EXCL
            | getattr(os, "O_NOFOLLOW", 0),
            0o444,
        )
        with opener.open(request, timeout=300) as response:
            if response.status != 200 or response.geturl() != url:
                raise ArtifactError("Reviewed acquisition response drifted.")
            raw_length = response.headers.get("Content-Length")
            if (
                raw_length is None
                or not raw_length.isascii()
                or not raw_length.isdigit()
                or int(raw_length) != expected_byte_size
                or response.headers.get("Content-Encoding", "identity")
                not in ("identity", "")
            ):
                raise ArtifactError("Reviewed acquisition length drifted.")
            digest = hashlib.sha256()
            observed_size = 0
            with os.fdopen(descriptor, "wb", closefd=True) as output:
                descriptor = -1
                while observed_size <= expected_byte_size:
                    block = response.read(
                        min(
                            DOWNLOAD_CHUNK_BYTES,
                            expected_byte_size - observed_size + 1,
                        )
                    )
                    if not block:
                        break
                    observed_size += len(block)
                    if observed_size > expected_byte_size:
                        raise ArtifactError(
                            "Reviewed acquisition length drifted."
                        )
                    digest.update(block)
                    output.write(block)
            if (
                observed_size != expected_byte_size
                or digest.hexdigest() != expected_sha256
            ):
                raise ArtifactError("Reviewed acquisition identity drifted.")
    except ArtifactError:
        raise
    except (HTTPError, OSError, TimeoutError, URLError) as error:
        raise ArtifactError("Reviewed acquisition failed closed.") from error
    finally:
        if descriptor >= 0:
            os.close(descriptor)


def _copy_regular(source: Path, destination: Path) -> None:
    try:
        metadata = source.lstat()
        if not stat.S_ISREG(metadata.st_mode) or source.is_symlink():
            raise ArtifactError("Closed build input source is not regular.")
        destination.parent.mkdir(parents=True, exist_ok=True)
        with source.open("rb") as input_file:
            descriptor = os.open(
                destination,
                os.O_WRONLY
                | os.O_CREAT
                | os.O_EXCL
                | getattr(os, "O_NOFOLLOW", 0),
                0o444,
            )
            with os.fdopen(descriptor, "wb") as output_file:
                shutil.copyfileobj(input_file, output_file)
    except ArtifactError:
        raise
    except OSError as error:
        raise ArtifactError("Closed build input copy failed.") from error


def _copy_closed_tree(source: Path, destination: Path) -> None:
    try:
        metadata = source.lstat()
    except OSError as error:
        raise ArtifactError("Closed build input tree is absent.") from error
    if not stat.S_ISDIR(metadata.st_mode) or source.is_symlink():
        raise ArtifactError("Closed build input tree is not regular.")
    _safe_empty_directory(destination)
    for path in sorted(source.rglob("*")):
        relative = path.relative_to(source)
        metadata = path.lstat()
        target = destination / relative
        if stat.S_ISDIR(metadata.st_mode) and not path.is_symlink():
            target.mkdir(exist_ok=False)
        elif stat.S_ISREG(metadata.st_mode) and not path.is_symlink():
            _copy_regular(path, target)
        elif stat.S_ISLNK(metadata.st_mode):
            link_target = os.readlink(path)
            target.symlink_to(link_target)
        else:
            raise ArtifactError("Closed build input tree contains a forbidden entry.")


def _worker_source_inventory(worker_root: Path) -> None:
    expected = {
        "__init__.py",
        "app.py",
        "artifacts.py",
        "engine.py",
        "health.py",
        "hosting.py",
        "model_loader.py",
        "protocol.py",
        "runtime.py",
        "server.py",
    }
    try:
        entries = list(worker_root.iterdir())
    except OSError as error:
        raise ArtifactError("Worker build source is absent.") from error
    if {entry.name for entry in entries} != expected:
        raise ArtifactError("Worker build source inventory drifted.")
    for entry in entries:
        metadata = entry.lstat()
        if not stat.S_ISREG(metadata.st_mode) or entry.is_symlink():
            raise ArtifactError("Worker build source type drifted.")


def acquire(arguments: argparse.Namespace) -> None:
    manifest = load_reviewed_manifest(IMAGE_MANIFEST_PATH)
    _locked, wheel_entries, _license_dependencies = (
        verify_dependency_input_set(
            manifest,
            requirements_lock_path=arguments.requirements_lock,
            wheelhouse_inventory_path=arguments.wheelhouse_manifest,
            dependency_licenses_path=IMAGE_DEPENDENCY_LICENSES_PATH,
        )
    )
    scratch = arguments.scratch
    closed = arguments.closed
    _safe_empty_directory(scratch)
    _safe_empty_directory(closed)
    wheelhouse = scratch / "wheelhouse"
    _safe_empty_directory(wheelhouse)
    archive = scratch / "sam2-source.tar.gz"
    checkpoint = scratch / "sam2.1_hiera_base_plus.pt"
    opener = build_opener(ProxyHandler({}), _RejectRedirects())

    archive_spec = manifest["repository"]["archive"]
    checkpoint_spec = manifest["checkpoint"]
    _download(
        opener=opener,
        url=archive_spec["url"],
        expected_host=ARCHIVE_HOST,
        expected_byte_size=archive_spec["byteSize"],
        expected_sha256=archive_spec["sha256"],
        destination=archive,
    )
    _download(
        opener=opener,
        url=checkpoint_spec["url"],
        expected_host=CHECKPOINT_HOST,
        expected_byte_size=checkpoint_spec["byteSize"],
        expected_sha256=checkpoint_spec["sha256"],
        destination=checkpoint,
    )
    for wheel in wheel_entries:
        _download(
            opener=opener,
            url=wheel["url"],
            expected_host=WHEEL_HOST,
            expected_byte_size=wheel["byteSize"],
            expected_sha256=wheel["sha256"],
            destination=wheelhouse / wheel["filename"],
        )

    verify_source_archive(archive, manifest)
    verify_checkpoint_artifact(checkpoint, manifest)
    verify_dependency_build_ready(
        manifest,
        requirements_lock_path=arguments.requirements_lock,
        wheelhouse_inventory_path=arguments.wheelhouse_manifest,
        dependency_licenses_path=IMAGE_DEPENDENCY_LICENSES_PATH,
        wheelhouse_root=wheelhouse,
    )
    extract_reviewed_runtime_source(
        archive_path=archive,
        source_root=IMAGE_SOURCE_ROOT,
        licenses_root=IMAGE_LICENSE_ROOT,
        manifest=manifest,
    )
    _copy_regular(checkpoint, IMAGE_CHECKPOINT_PATH)
    _worker_source_inventory(arguments.worker_root)
    verify_runtime_artifacts(
        manifest_path=IMAGE_MANIFEST_PATH,
        source_root=IMAGE_SOURCE_ROOT,
        checkpoint_path=IMAGE_CHECKPOINT_PATH,
        licenses_root=IMAGE_LICENSE_ROOT,
        adapter_profile_path=IMAGE_ADAPTER_PROFILE_PATH,
        overlay_root=IMAGE_OVERLAY_ROOT,
        model_loader_path=IMAGE_MODEL_LOADER_PATH,
    )

    _copy_closed_tree(arguments.worker_root, closed / "worker/sam_worker")
    _copy_closed_tree(IMAGE_OVERLAY_ROOT, closed / "sam2-overlay")
    _copy_closed_tree(IMAGE_SOURCE_ROOT, closed / "sam2-source")
    _copy_closed_tree(IMAGE_LICENSE_ROOT, closed / "sam/licenses")
    _copy_closed_tree(wheelhouse, closed / "wheelhouse")
    for source, relative in (
        (IMAGE_MANIFEST_PATH, "sam/artifact-manifest.json"),
        (IMAGE_ADAPTER_PROFILE_PATH, "sam/adapter-profile.json"),
        (IMAGE_DEPENDENCY_LICENSES_PATH, "sam/dependency-licenses.json"),
        (IMAGE_CHECKPOINT_PATH, "sam/checkpoints/sam2.1_hiera_base_plus.pt"),
        (arguments.requirements_lock, "requirements.lock"),
        (arguments.wheelhouse_manifest, "wheelhouse-manifest.json"),
    ):
        _copy_regular(source, closed / relative)
    if {entry.name for entry in closed.iterdir()} != {
        "requirements.lock",
        "sam",
        "sam2-overlay",
        "sam2-source",
        "wheelhouse",
        "wheelhouse-manifest.json",
        "worker",
    }:
        raise ArtifactError("Closed build input inventory drifted.")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    parser.add_argument("--closed", type=Path, required=True)
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--requirements-lock", type=Path, required=True)
    parser.add_argument("--wheelhouse-manifest", type=Path, required=True)
    parser.add_argument("--worker-root", type=Path, required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    arguments = _parser().parse_args(argv)
    acquire(arguments)
    print("sam-worker-closed-build-inputs-ok")


if __name__ == "__main__":
    main()
