"""Networked build-only acquisition for the closed SAM runtime input directory."""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import stat
from pathlib import Path
from typing import Any, Literal, Sequence
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
ArtifactKind = Literal["archive", "checkpoint", "wheel"]

_ARTIFACT_HOSTS = {
    "archive": ARCHIVE_HOST,
    "checkpoint": CHECKPOINT_HOST,
    "wheel": WHEEL_HOST,
}
_ACQUISITION_ERROR_CODES = {
    "archive": {
        "url": "fabrica-build-gate: acquisition-archive-url",
        "redirect": "fabrica-build-gate: acquisition-archive-redirect",
        "response": "fabrica-build-gate: acquisition-archive-response",
        "header": "fabrica-build-gate: acquisition-archive-header",
        "stream-length": (
            "fabrica-build-gate: acquisition-archive-stream-length"
        ),
        "digest": "fabrica-build-gate: acquisition-archive-digest",
        "transport": "fabrica-build-gate: acquisition-archive-transport",
        "destination": (
            "fabrica-build-gate: acquisition-archive-destination"
        ),
    },
    "checkpoint": {
        "url": "fabrica-build-gate: acquisition-checkpoint-url",
        "redirect": (
            "fabrica-build-gate: acquisition-checkpoint-redirect"
        ),
        "response": (
            "fabrica-build-gate: acquisition-checkpoint-response"
        ),
        "header": "fabrica-build-gate: acquisition-checkpoint-header",
        "stream-length": (
            "fabrica-build-gate: acquisition-checkpoint-stream-length"
        ),
        "digest": "fabrica-build-gate: acquisition-checkpoint-digest",
        "transport": (
            "fabrica-build-gate: acquisition-checkpoint-transport"
        ),
        "destination": (
            "fabrica-build-gate: acquisition-checkpoint-destination"
        ),
    },
    "wheel": {
        "url": "fabrica-build-gate: acquisition-wheel-url",
        "redirect": "fabrica-build-gate: acquisition-wheel-redirect",
        "response": "fabrica-build-gate: acquisition-wheel-response",
        "header": "fabrica-build-gate: acquisition-wheel-header",
        "stream-length": (
            "fabrica-build-gate: acquisition-wheel-stream-length"
        ),
        "digest": "fabrica-build-gate: acquisition-wheel-digest",
        "transport": "fabrica-build-gate: acquisition-wheel-transport",
        "destination": (
            "fabrica-build-gate: acquisition-wheel-destination"
        ),
    },
}
_ACQUISITION_CONTRACT_ERROR = (
    "fabrica-build-gate: acquisition-artifact-kind"
)
_REQUEST_ARTIFACT_KIND = "_fabrica_artifact_kind"


class _AcquisitionGateError(ArtifactError):
    pass


def _acquisition_error(
    artifact_kind: object,
    failure: str,
) -> _AcquisitionGateError:
    if not isinstance(artifact_kind, str):
        return _AcquisitionGateError(_ACQUISITION_CONTRACT_ERROR)
    codes = _ACQUISITION_ERROR_CODES.get(artifact_kind)
    if codes is None or failure not in codes:
        return _AcquisitionGateError(_ACQUISITION_CONTRACT_ERROR)
    return _AcquisitionGateError(codes[failure])


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
        artifact_kind = getattr(
            _request,
            _REQUEST_ARTIFACT_KIND,
            None,
        )
        raise _acquisition_error(artifact_kind, "redirect") from None


def _safe_empty_directory(path: Path) -> None:
    try:
        path.mkdir(parents=True, exist_ok=False)
    except OSError as error:
        raise ArtifactError("Acquisition directory is unavailable.") from error


def _download(
    *,
    opener: Any,
    artifact_kind: ArtifactKind,
    url: str,
    expected_host: str,
    expected_byte_size: int,
    expected_sha256: str,
    destination: Path,
) -> None:
    if (
        artifact_kind not in _ARTIFACT_HOSTS
        or expected_host != _ARTIFACT_HOSTS[artifact_kind]
    ):
        raise _AcquisitionGateError(_ACQUISITION_CONTRACT_ERROR)
    try:
        parsed = urlsplit(url)
        valid_url = (
            url.isascii()
            and parsed.scheme == "https"
            and parsed.hostname == expected_host
            and parsed.port is None
            and parsed.username is None
            and parsed.password is None
            and not parsed.query
            and not parsed.fragment
        )
    except Exception:
        valid_url = False
    if not valid_url:
        raise _acquisition_error(artifact_kind, "url") from None
    try:
        request = Request(
            url,
            headers={
                "Accept": "application/octet-stream",
                "Accept-Encoding": "identity",
                "User-Agent": "fabrica-sam-build-acquisition-v1",
            },
            method="GET",
        )
        setattr(request, _REQUEST_ARTIFACT_KIND, artifact_kind)
    except Exception:
        raise _acquisition_error(artifact_kind, "url") from None
    descriptor = -1
    try:
        try:
            descriptor = os.open(
                destination,
                os.O_WRONLY
                | os.O_CREAT
                | os.O_EXCL
                | getattr(os, "O_NOFOLLOW", 0),
                0o444,
            )
        except Exception:
            raise _acquisition_error(
                artifact_kind,
                "destination",
            ) from None
        try:
            response_context = opener.open(request, timeout=300)
        except _AcquisitionGateError:
            raise
        except Exception:
            raise _acquisition_error(
                artifact_kind,
                "transport",
            ) from None
        with response_context as response:
            try:
                response_status = response.status
                effective_url = response.geturl()
            except Exception:
                raise _acquisition_error(
                    artifact_kind,
                    "response",
                ) from None
            if response_status != 200 or effective_url != url:
                raise _acquisition_error(
                    artifact_kind,
                    "response",
                ) from None
            try:
                content_encoding = response.headers.get(
                    "Content-Encoding"
                )
            except Exception:
                raise _acquisition_error(
                    artifact_kind,
                    "header",
                ) from None
            if (
                content_encoding is not None
                and (
                    not isinstance(content_encoding, str)
                    or content_encoding.strip().lower()
                    not in ("", "identity")
                )
            ):
                raise _acquisition_error(
                    artifact_kind,
                    "header",
                ) from None

            # Content-Length and Transfer-Encoding are advisory framing
            # metadata. Acceptance depends only on bounded streamed bytes and
            # the reviewed digest below.
            digest = hashlib.sha256()
            observed_size = 0
            try:
                output_context = os.fdopen(
                    descriptor,
                    "wb",
                    closefd=True,
                )
                descriptor = -1
            except Exception:
                raise _acquisition_error(
                    artifact_kind,
                    "destination",
                ) from None
            try:
                with output_context as output:
                    while observed_size <= expected_byte_size:
                        try:
                            block = response.read(
                                min(
                                    DOWNLOAD_CHUNK_BYTES,
                                    expected_byte_size - observed_size + 1,
                                )
                            )
                        except Exception:
                            raise _acquisition_error(
                                artifact_kind,
                                "transport",
                            ) from None
                        if not isinstance(block, bytes):
                            raise _acquisition_error(
                                artifact_kind,
                                "transport",
                            ) from None
                        if not block:
                            break
                        observed_size += len(block)
                        if observed_size > expected_byte_size:
                            raise _acquisition_error(
                                artifact_kind,
                                "stream-length",
                            ) from None
                        digest.update(block)
                        try:
                            written = output.write(block)
                        except Exception:
                            raise _acquisition_error(
                                artifact_kind,
                                "destination",
                            ) from None
                        if written != len(block):
                            raise _acquisition_error(
                                artifact_kind,
                                "destination",
                            ) from None
            except _AcquisitionGateError:
                raise
            except Exception:
                raise _acquisition_error(
                    artifact_kind,
                    "destination",
                ) from None
            if observed_size != expected_byte_size:
                raise _acquisition_error(
                    artifact_kind,
                    "stream-length",
                ) from None
            if digest.hexdigest() != expected_sha256:
                raise _acquisition_error(
                    artifact_kind,
                    "digest",
                ) from None
    except _AcquisitionGateError:
        raise
    except (HTTPError, OSError, TimeoutError, URLError):
        raise _acquisition_error(
            artifact_kind,
            "transport",
        ) from None
    except Exception:
        raise _acquisition_error(
            artifact_kind,
            "transport",
        ) from None
    finally:
        if descriptor >= 0:
            try:
                os.close(descriptor)
            except Exception:
                raise _acquisition_error(
                    artifact_kind,
                    "destination",
                ) from None


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
        artifact_kind="archive",
        url=archive_spec["url"],
        expected_host=ARCHIVE_HOST,
        expected_byte_size=archive_spec["byteSize"],
        expected_sha256=archive_spec["sha256"],
        destination=archive,
    )
    _download(
        opener=opener,
        artifact_kind="checkpoint",
        url=checkpoint_spec["url"],
        expected_host=CHECKPOINT_HOST,
        expected_byte_size=checkpoint_spec["byteSize"],
        expected_sha256=checkpoint_spec["sha256"],
        destination=checkpoint,
    )
    for wheel in wheel_entries:
        _download(
            opener=opener,
            artifact_kind="wheel",
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
