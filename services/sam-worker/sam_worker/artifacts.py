"""Strict, stdlib-only verification for reviewed SAM worker artifacts."""

from __future__ import annotations

import argparse
import email.policy
import hashlib
import json
import os
import posixpath
import re
import stat
import struct
import tarfile
import unicodedata
import zipfile
from datetime import datetime, timezone
from email.parser import BytesParser
from pathlib import Path, PurePosixPath
from typing import Any, Dict, Iterable, List, Mapping, Sequence, Tuple

REVIEWED_ARTIFACT_MANIFEST_SHA256 = (
    "84d7743701a0f9aa9d76716e771155fc6de6a0b6c5bc84746f55a8725f6a5529"
)
MANIFEST_MAXIMUM_BYTES = 64_000
TREE_DIGEST_DOMAIN = b"fabrica-path-content-tree-v1\x00"
OBSERVED_DOWNLOAD_PROVENANCE = (
    "Fabrica-observed SHA-256 from two byte-identical official-source downloads"
)
IMAGE_MANIFEST_PATH = Path("/opt/fabrica/sam/artifact-manifest.json")
IMAGE_SOURCE_ROOT = Path("/opt/fabrica/sam2-source")
IMAGE_CONFIG_PATH = (
    IMAGE_SOURCE_ROOT / "sam2/configs/sam2.1/sam2.1_hiera_b+.yaml"
)
IMAGE_CHECKPOINT_PATH = (
    Path("/opt/fabrica/sam/checkpoints") / "sam2.1_hiera_base_plus.pt"
)
IMAGE_LICENSE_ROOT = Path("/opt/fabrica/sam/licenses")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
RFC3339_UTC_PATTERN = re.compile(
    r"^(?P<date>[0-9]{4}-[0-9]{2}-[0-9]{2})T"
    r"(?P<time>[0-9]{2}:[0-9]{2}:[0-9]{2})Z$"
)
DEPENDENCY_LOCK_LINE_PATTERN = re.compile(
    r"^(?P<name>[a-z0-9]+(?:-[a-z0-9]+)*)=="
    r"(?P<version>(?:[0-9]+!)?[0-9]+(?:[.][0-9]+)*"
    r"(?:(?:a|b|rc)[0-9]+)?"
    r"(?:[.]?(?:post|dev)[0-9]+)?"
    r"(?:[+][a-z0-9]+(?:[._][a-z0-9]+)*)?) "
    r"--hash=sha256:(?P<sha256>[0-9a-f]{64})$"
)
WHEEL_FILENAME_PATTERN = re.compile(
    r"^(?P<distribution>[A-Za-z0-9_]+)-"
    r"(?P<version>[A-Za-z0-9_.+!]+)-"
    r"(?:(?P<build>[0-9][A-Za-z0-9_.]*)-)?"
    r"(?P<python>[A-Za-z0-9_.]+)-"
    r"(?P<abi>[A-Za-z0-9_.]+)-"
    r"(?P<platform>[A-Za-z0-9_.]+)[.]whl$"
)
BASE_OWNED_DISTRIBUTIONS = {
    "sam-worker",
    "sam2",
    "torch",
    "torchvision",
    "triton",
}
FORBIDDEN_IMPORT_NAMESPACES = {
    "sam_worker",
    "sam2",
    "torch",
    "torchvision",
    "nvidia",
    "triton",
}


class ArtifactError(RuntimeError):
    """Fail-closed artifact validation error without private path detail."""


def canonical_json(value: Any) -> str:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
        allow_nan=False,
    )


def manifest_self_digest(value: Mapping[str, Any]) -> str:
    core = dict(value)
    if "manifestSha256" not in core:
        raise ArtifactError("Artifact manifest omits its self-digest.")
    del core["manifestSha256"]
    return hashlib.sha256(canonical_json(core).encode("utf-8")).hexdigest()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as source:
            while True:
                block = source.read(1024 * 1024)
                if not block:
                    return digest.hexdigest()
                digest.update(block)
    except OSError as error:
        raise ArtifactError("Reviewed artifact is unreadable.") from error


def _closed_object(
    value: Any, required: Iterable[str], path: str
) -> Mapping[str, Any]:
    keys = set(required)
    if not isinstance(value, dict) or set(value) != keys:
        raise ArtifactError("%s is not a strict closed object." % path)
    return value


def _closed_pairs(pairs: Sequence[Tuple[str, Any]]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ArtifactError("Artifact manifest contains a duplicate JSON key.")
        result[key] = value
    return result


def _reject_json_constant(_value: str) -> None:
    raise ArtifactError("Artifact manifest contains a non-finite JSON number.")


def strict_json_bytes(data: bytes) -> Any:
    if not data or len(data) > MANIFEST_MAXIMUM_BYTES:
        raise ArtifactError("Artifact manifest byte length is invalid.")
    try:
        text = data.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise ArtifactError("Artifact manifest is not valid UTF-8.") from error
    if text.startswith("\ufeff"):
        raise ArtifactError("Artifact manifest contains a byte-order mark.")
    try:
        return json.loads(
            text,
            object_pairs_hook=_closed_pairs,
            parse_constant=_reject_json_constant,
        )
    except ArtifactError:
        raise
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        raise ArtifactError("Artifact manifest is not strict JSON.") from error


def _string(value: Any, path: str) -> str:
    if not isinstance(value, str) or not value:
        raise ArtifactError("%s must be a nonempty string." % path)
    return value


def _integer(value: Any, minimum: int, maximum: int, path: str) -> int:
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or value < minimum
        or value > maximum
    ):
        raise ArtifactError("%s must be a bounded integer." % path)
    return value


def _boolean(value: Any, path: str) -> bool:
    if not isinstance(value, bool):
        raise ArtifactError("%s must be a boolean." % path)
    return value


def _sha256(value: Any, path: str) -> str:
    if not isinstance(value, str) or SHA256_PATTERN.fullmatch(value) is None:
        raise ArtifactError("%s must be a lowercase SHA-256." % path)
    if value == "0" * 64:
        raise ArtifactError("%s must be resolved." % path)
    return value


def _timestamp(value: Any, path: str) -> datetime:
    text = _string(value, path)
    match = RFC3339_UTC_PATTERN.fullmatch(text)
    if match is None:
        raise ArtifactError("%s must be whole-second UTC RFC 3339." % path)
    try:
        return datetime.fromisoformat(
            "%sT%s+00:00" % (match.group("date"), match.group("time"))
        )
    except ValueError as error:
        raise ArtifactError("%s is not a real UTC timestamp." % path) from error


def _list(value: Any, length: int, path: str) -> Sequence[Any]:
    if not isinstance(value, list) or len(value) != length:
        raise ArtifactError("%s must be an exact-length array." % path)
    return value


def _safe_repository_path(value: Any, path: str) -> str:
    text = _string(value, path)
    pure = PurePosixPath(text)
    if (
        text.startswith("/")
        or "\\" in text
        or "\x00" in text
        or any(part in ("", ".", "..") for part in pure.parts)
        or str(pure) != text
    ):
        raise ArtifactError("%s is not a safe canonical repository path." % path)
    return text


def _validate_collision_free(paths: Iterable[str], path: str) -> None:
    exact: set[str] = set()
    casefolded: Dict[str, str] = {}
    normalized: Dict[str, str] = {}
    for value in paths:
        if value in exact:
            raise ArtifactError("%s contains a duplicate path." % path)
        exact.add(value)
        folded = value.casefold()
        previous_case = casefolded.get(folded)
        if previous_case is not None and previous_case != value:
            raise ArtifactError("%s contains a case-colliding path." % path)
        casefolded[folded] = value
        nfc = unicodedata.normalize("NFC", value)
        previous_nfc = normalized.get(nfc)
        if previous_nfc is not None and previous_nfc != value:
            raise ArtifactError("%s contains an NFC-colliding path." % path)
        normalized[nfc] = value


def _validate_license(
    value: Any, runtime: bool, index: int
) -> Mapping[str, Any]:
    base_keys = {
        "repositoryPath",
        "byteSize",
        "sha256",
    }
    if runtime:
        base_keys.update({"imageName", "imagePath", "spdx"})
    if runtime and index == 1:
        base_keys.add("requiredBecause")
    license_value = _closed_object(
        value, base_keys, "artifactManifest.licenses entry"
    )
    _safe_repository_path(
        license_value["repositoryPath"],
        "artifactManifest.licenses.repositoryPath",
    )
    _integer(
        license_value["byteSize"],
        1,
        1_000_000,
        "artifactManifest.licenses.byteSize",
    )
    _sha256(license_value["sha256"], "artifactManifest.licenses.sha256")
    if runtime:
        image_name = _safe_repository_path(
            license_value["imageName"],
            "artifactManifest.licenses.imageName",
        )
        if "/" in image_name:
            raise ArtifactError("Runtime license image name must be a basename.")
        if license_value["imagePath"] != str(
            IMAGE_LICENSE_ROOT / image_name
        ):
            raise ArtifactError(
                "Runtime license image path cross-binding drifted."
            )
        _string(license_value["spdx"], "artifactManifest.licenses.spdx")
    if "requiredBecause" in license_value:
        _string(
            license_value["requiredBecause"],
            "artifactManifest.licenses.requiredBecause",
        )
    return license_value


def validate_reviewed_manifest(
    value: Any,
    *,
    expected_self_digest: str | None = REVIEWED_ARTIFACT_MANIFEST_SHA256,
    now: datetime | None = None,
) -> Mapping[str, Any]:
    manifest = _closed_object(
        value,
        {
            "manifestVersion",
            "manifestKind",
            "evidence",
            "imageLocations",
            "repository",
            "config",
            "upstreamLoader",
            "model",
            "checkpoint",
            "licenses",
            "dependencies",
            "baseImage",
            "manifestSha256",
        },
        "artifactManifest",
    )
    if (
        _integer(
            manifest["manifestVersion"],
            1,
            1,
            "artifactManifest.manifestVersion",
        )
        != 1
    ):
        raise ArtifactError("Artifact manifest version is unsupported.")
    if manifest["manifestKind"] != "fabrica-sam-worker-reviewed-artifacts-v1":
        raise ArtifactError("Artifact manifest kind is unsupported.")
    self_digest = _sha256(
        manifest["manifestSha256"], "artifactManifest.manifestSha256"
    )
    if manifest_self_digest(manifest) != self_digest:
        raise ArtifactError("Artifact manifest self-digest drifted.")
    if expected_self_digest is not None and self_digest != expected_self_digest:
        raise ArtifactError("Artifact manifest is not the reviewed identity.")

    evidence = _closed_object(
        manifest["evidence"],
        {
            "finalizedAt",
            "expiresAt",
            "expiryPolicy",
            "artifactExecutionOccurred",
            "modelInferenceOccurred",
        },
        "artifactManifest.evidence",
    )
    finalized_at = _timestamp(
        evidence["finalizedAt"], "artifactManifest.evidence.finalizedAt"
    )
    expires_at = _timestamp(
        evidence["expiresAt"], "artifactManifest.evidence.expiresAt"
    )
    if (
        evidence["expiryPolicy"]
        != "fail-closed-at-expiry-or-earlier-source-change"
        or finalized_at >= expires_at
        or _boolean(
            evidence["artifactExecutionOccurred"],
            "artifactManifest.evidence.artifactExecutionOccurred",
        )
        is not False
        or _boolean(
            evidence["modelInferenceOccurred"],
            "artifactManifest.evidence.modelInferenceOccurred",
        )
        is not False
    ):
        raise ArtifactError("Artifact evidence policy or interval drifted.")
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None or current.utcoffset() is None:
        raise ArtifactError("Artifact evidence clock must be timezone-aware.")
    current = current.astimezone(timezone.utc)
    if current < finalized_at or current >= expires_at:
        raise ArtifactError("Artifact evidence is not currently valid.")

    locations = _closed_object(
        manifest["imageLocations"],
        {
            "manifest",
            "runtimeSourceRoot",
            "config",
            "checkpoint",
            "licenseRoot",
        },
        "artifactManifest.imageLocations",
    )
    expected_locations = {
        "manifest": str(IMAGE_MANIFEST_PATH),
        "runtimeSourceRoot": str(IMAGE_SOURCE_ROOT),
        "config": str(IMAGE_CONFIG_PATH),
        "checkpoint": str(IMAGE_CHECKPOINT_PATH),
        "licenseRoot": str(IMAGE_LICENSE_ROOT),
    }
    if locations != expected_locations:
        raise ArtifactError("Runtime image artifact locations drifted.")

    repository = _closed_object(
        manifest["repository"],
        {"url", "commit", "archive", "runtimeSourceTree"},
        "artifactManifest.repository",
    )
    repository_url = _string(
        repository["url"], "artifactManifest.repository.url"
    )
    commit = _string(
        repository["commit"], "artifactManifest.repository.commit"
    )
    if re.fullmatch(r"[0-9a-f]{40}", commit) is None:
        raise ArtifactError("Repository commit must be a full lowercase Git SHA.")

    archive = _closed_object(
        repository["archive"],
        {
            "url",
            "byteSize",
            "sha256",
            "sha256Provenance",
            "topLevel",
            "entryCount",
            "regularFileCount",
            "directoryCount",
            "symlinkCount",
            "regularFileBytes",
            "regularFileByteLimit",
            "largestRegularFile",
        },
        "artifactManifest.repository.archive",
    )
    archive_url = _string(
        archive["url"], "artifactManifest.repository.archive.url"
    )
    if (
        repository_url != "https://github.com/facebookresearch/sam2"
        or archive_url
        != "https://codeload.github.com/facebookresearch/sam2/tar.gz/%s"
        % commit
        or archive["topLevel"] != "sam2-%s" % commit
        or archive["sha256Provenance"] != OBSERVED_DOWNLOAD_PROVENANCE
    ):
        raise ArtifactError("Repository archive cross-binding drifted.")
    _integer(
        archive["byteSize"],
        1,
        1_000_000_000,
        "artifactManifest.repository.archive.byteSize",
    )
    _sha256(
        archive["sha256"], "artifactManifest.repository.archive.sha256"
    )
    for field in (
        "entryCount",
        "regularFileCount",
        "directoryCount",
        "symlinkCount",
    ):
        _integer(
            archive[field],
            0,
            100_000,
            "artifactManifest.repository.archive.%s" % field,
        )
    if (
        archive["entryCount"]
        != archive["regularFileCount"]
        + archive["directoryCount"]
        + archive["symlinkCount"]
    ):
        raise ArtifactError("Repository archive member accounting drifted.")
    _integer(
        archive["regularFileBytes"],
        1,
        1_000_000_000,
        "artifactManifest.repository.archive.regularFileBytes",
    )
    per_member_limit = _integer(
        archive["regularFileByteLimit"],
        1,
        archive["regularFileBytes"],
        "artifactManifest.repository.archive.regularFileByteLimit",
    )
    largest = _closed_object(
        archive["largestRegularFile"],
        {"path", "byteSize"},
        "artifactManifest.repository.archive.largestRegularFile",
    )
    _safe_repository_path(
        largest["path"],
        "artifactManifest.repository.archive.largestRegularFile.path",
    )
    largest_size = _integer(
        largest["byteSize"],
        1,
        per_member_limit,
        "artifactManifest.repository.archive.largestRegularFile.byteSize",
    )
    if per_member_limit <= largest_size:
        raise ArtifactError("Repository archive per-member ceiling is not conservative.")
    if {
        "url": archive["url"],
        "byteSize": archive["byteSize"],
        "sha256": archive["sha256"],
        "sha256Provenance": archive["sha256Provenance"],
        "topLevel": archive["topLevel"],
        "entryCount": archive["entryCount"],
        "regularFileCount": archive["regularFileCount"],
        "directoryCount": archive["directoryCount"],
        "symlinkCount": archive["symlinkCount"],
        "regularFileBytes": archive["regularFileBytes"],
        "regularFileByteLimit": archive["regularFileByteLimit"],
        "largestRegularFile": archive["largestRegularFile"],
    } != {
        "url": "https://codeload.github.com/facebookresearch/sam2/tar.gz/"
        "05d9e57fb3945b10c861046c1e6749e2bfc258e3",
        "byteSize": 55_631_013,
        "sha256": "92c9e7ca3102fb8ef5953b0e80063a9ae77eb3d80fc54c498c1c6e2f71903dd6",
        "sha256Provenance": OBSERVED_DOWNLOAD_PROVENANCE,
        "topLevel": "sam2-05d9e57fb3945b10c861046c1e6749e2bfc258e3",
        "entryCount": 652,
        "regularFileCount": 561,
        "directoryCount": 87,
        "symlinkCount": 4,
        "regularFileBytes": 64_496_345,
        "regularFileByteLimit": 10_500_000,
        "largestRegularFile": {
            "path": "notebooks/video_predictor_example.ipynb",
            "byteSize": 10_091_428,
        },
    }:
        raise ArtifactError("Reviewed repository archive identity drifted.")

    runtime_tree = _closed_object(
        repository["runtimeSourceTree"],
        {
            "root",
            "regularFileCount",
            "symlinkCount",
            "regularFileBytes",
            "digestAlgorithm",
            "sha256",
            "allowedSymlinks",
        },
        "artifactManifest.repository.runtimeSourceTree",
    )
    source_root = _safe_repository_path(
        runtime_tree["root"],
        "artifactManifest.repository.runtimeSourceTree.root",
    )
    if source_root != "sam2":
        raise ArtifactError("Runtime source-tree root drifted.")
    _integer(
        runtime_tree["regularFileCount"],
        1,
        archive["regularFileCount"],
        "artifactManifest.repository.runtimeSourceTree.regularFileCount",
    )
    _integer(
        runtime_tree["symlinkCount"],
        0,
        archive["symlinkCount"],
        "artifactManifest.repository.runtimeSourceTree.symlinkCount",
    )
    _integer(
        runtime_tree["regularFileBytes"],
        1,
        archive["regularFileBytes"],
        "artifactManifest.repository.runtimeSourceTree.regularFileBytes",
    )
    if runtime_tree["digestAlgorithm"] != "fabrica-path-content-tree-v1":
        raise ArtifactError("Runtime source-tree digest algorithm drifted.")
    _sha256(
        runtime_tree["sha256"],
        "artifactManifest.repository.runtimeSourceTree.sha256",
    )
    symlinks = _list(
        runtime_tree["allowedSymlinks"],
        runtime_tree["symlinkCount"],
        "artifactManifest.repository.runtimeSourceTree.allowedSymlinks",
    )
    symlink_paths: List[str] = []
    for item in symlinks:
        link = _closed_object(
            item,
            {"path", "target"},
            "artifactManifest.repository.runtimeSourceTree.allowedSymlinks entry",
        )
        link_path = _safe_repository_path(
            link["path"],
            "artifactManifest.repository.runtimeSourceTree.allowedSymlinks.path",
        )
        target = _safe_repository_path(
            link["target"],
            "artifactManifest.repository.runtimeSourceTree.allowedSymlinks.target",
        )
        if not link_path.startswith(source_root + "/") or target.startswith(
            source_root + "/"
        ):
            raise ArtifactError("Runtime source-tree symlink identity drifted.")
        resolved = posixpath.normpath(
            posixpath.join(posixpath.dirname(link_path), target)
        )
        if not resolved.startswith(source_root + "/"):
            raise ArtifactError("Runtime source-tree symlink escapes its root.")
        symlink_paths.append(link_path)
    _validate_collision_free(symlink_paths, "Runtime source-tree symlinks")
    expected_symlinks = [
        {
            "path": "sam2/sam2_hiera_b+.yaml",
            "target": "configs/sam2/sam2_hiera_b+.yaml",
        },
        {
            "path": "sam2/sam2_hiera_l.yaml",
            "target": "configs/sam2/sam2_hiera_l.yaml",
        },
        {
            "path": "sam2/sam2_hiera_s.yaml",
            "target": "configs/sam2/sam2_hiera_s.yaml",
        },
        {
            "path": "sam2/sam2_hiera_t.yaml",
            "target": "configs/sam2/sam2_hiera_t.yaml",
        },
    ]
    if (
        runtime_tree["regularFileCount"] != 33
        or runtime_tree["symlinkCount"] != 4
        or runtime_tree["regularFileBytes"] != 312_959
        or runtime_tree["sha256"]
        != "66821e0f05bd53a04cee682c0e0b131f47fcea3b427522b1ff0ecc69c8be862a"
        or runtime_tree["allowedSymlinks"] != expected_symlinks
    ):
        raise ArtifactError("Reviewed runtime source-tree identity drifted.")

    config = _closed_object(
        manifest["config"],
        {
            "repositoryPath",
            "runtimeIdentity",
            "rawUrl",
            "byteSize",
            "sha256",
            "sha256Provenance",
            "rawMatchesArchiveMember",
        },
        "artifactManifest.config",
    )
    config_path = _safe_repository_path(
        config["repositoryPath"], "artifactManifest.config.repositoryPath"
    )
    runtime_identity = _safe_repository_path(
        config["runtimeIdentity"], "artifactManifest.config.runtimeIdentity"
    )
    if (
        config_path != source_root + "/" + runtime_identity
        or locations["config"]
        != locations["runtimeSourceRoot"] + "/" + config_path
        or config["rawUrl"]
        != "https://raw.githubusercontent.com/facebookresearch/sam2/%s/%s"
        % (commit, config_path)
        or config["sha256Provenance"] != OBSERVED_DOWNLOAD_PROVENANCE
        or _boolean(
            config["rawMatchesArchiveMember"],
            "artifactManifest.config.rawMatchesArchiveMember",
        )
        is not True
    ):
        raise ArtifactError("Runtime config cross-binding drifted.")
    _integer(
        config["byteSize"], 1, per_member_limit, "artifactManifest.config.byteSize"
    )
    _sha256(config["sha256"], "artifactManifest.config.sha256")
    if {
        "repositoryPath": config["repositoryPath"],
        "runtimeIdentity": config["runtimeIdentity"],
        "rawUrl": config["rawUrl"],
        "byteSize": config["byteSize"],
        "sha256": config["sha256"],
        "sha256Provenance": config["sha256Provenance"],
        "rawMatchesArchiveMember": config["rawMatchesArchiveMember"],
    } != {
        "repositoryPath": "sam2/configs/sam2.1/sam2.1_hiera_b+.yaml",
        "runtimeIdentity": "configs/sam2.1/sam2.1_hiera_b+.yaml",
        "rawUrl": "https://raw.githubusercontent.com/facebookresearch/sam2/"
        "05d9e57fb3945b10c861046c1e6749e2bfc258e3/"
        "sam2/configs/sam2.1/sam2.1_hiera_b+.yaml",
        "byteSize": 3_650,
        "sha256": "e73f9e9547b305040552ee943ebd3a34cee5727a76fc2ab88b87f7b28b430754",
        "sha256Provenance": OBSERVED_DOWNLOAD_PROVENANCE,
        "rawMatchesArchiveMember": True,
    }:
        raise ArtifactError("Reviewed config identity drifted.")

    loader = _closed_object(
        manifest["upstreamLoader"],
        {
            "repositoryPath",
            "byteSize",
            "sha256",
            "observedCheckpointLoad",
            "productionPolicy",
        },
        "artifactManifest.upstreamLoader",
    )
    loader_path = _safe_repository_path(
        loader["repositoryPath"],
        "artifactManifest.upstreamLoader.repositoryPath",
    )
    if (
        not loader_path.startswith(source_root + "/")
        or loader["observedCheckpointLoad"]
        != "torch.load-without-weights_only"
        or loader["productionPolicy"]
        != "verify-all-artifacts-then-weights_only-true"
    ):
        raise ArtifactError("Upstream checkpoint-loader policy drifted.")
    _integer(
        loader["byteSize"],
        1,
        per_member_limit,
        "artifactManifest.upstreamLoader.byteSize",
    )
    _sha256(loader["sha256"], "artifactManifest.upstreamLoader.sha256")
    if (
        loader["repositoryPath"] != "sam2/build_sam.py"
        or loader["byteSize"] != 4_934
        or loader["sha256"]
        != "6df1b93a16c3eaf49334f74e831db91c67a0cf413b946d102333081722f20520"
    ):
        raise ArtifactError("Reviewed upstream loader identity drifted.")

    model = _closed_object(
        manifest["model"], {"modelId"}, "artifactManifest.model"
    )
    if model["modelId"] != "sam2.1_hiera_base_plus":
        raise ArtifactError("Selected model identity drifted.")

    checkpoint = _closed_object(
        manifest["checkpoint"],
        {
            "url",
            "byteSize",
            "sha256",
            "sha256Provenance",
            "structuralObservation",
        },
        "artifactManifest.checkpoint",
    )
    _string(checkpoint["url"], "artifactManifest.checkpoint.url")
    _integer(
        checkpoint["byteSize"],
        1,
        1_000_000_000,
        "artifactManifest.checkpoint.byteSize",
    )
    _sha256(checkpoint["sha256"], "artifactManifest.checkpoint.sha256")
    if (
        checkpoint["sha256Provenance"] != OBSERVED_DOWNLOAD_PROVENANCE
    ):
        raise ArtifactError("Checkpoint digest provenance wording drifted.")
    structure = _closed_object(
        checkpoint["structuralObservation"],
        {
            "scope",
            "root",
            "entryCount",
            "storedPayloadBytes",
            "dataPklByteSize",
            "semanticOrTensorSafetyClaim",
        },
        "artifactManifest.checkpoint.structuralObservation",
    )
    if (
        structure["scope"] != "zip-structure-only"
        or _boolean(
            structure["semanticOrTensorSafetyClaim"],
            "artifactManifest.checkpoint.structuralObservation."
            "semanticOrTensorSafetyClaim",
        )
        is not False
    ):
        raise ArtifactError("Checkpoint structural evidence scope drifted.")
    _safe_repository_path(
        structure["root"],
        "artifactManifest.checkpoint.structuralObservation.root",
    )
    for field in ("entryCount", "storedPayloadBytes", "dataPklByteSize"):
        _integer(
            structure[field],
            1,
            1_000_000_000,
            "artifactManifest.checkpoint.structuralObservation.%s" % field,
        )
    if {
        "url": checkpoint["url"],
        "byteSize": checkpoint["byteSize"],
        "sha256": checkpoint["sha256"],
        "sha256Provenance": checkpoint["sha256Provenance"],
        "structuralObservation": checkpoint["structuralObservation"],
    } != {
        "url": "https://dl.fbaipublicfiles.com/segment_anything_2/092824/"
        "sam2.1_hiera_base_plus.pt",
        "byteSize": 323_606_802,
        "sha256": "a2345aede8715ab1d5d31b4a509fb160c5a4af1970f199d9054ccfb746c004c5",
        "sha256Provenance": OBSERVED_DOWNLOAD_PROVENANCE,
        "structuralObservation": {
            "scope": "zip-structure-only",
            "root": "sam2_hiera_b+_new",
            "entryCount": 619,
            "storedPayloadBytes": 323_483_230,
            "dataPklByteSize": 81_446,
            "semanticOrTensorSafetyClaim": False,
        },
    }:
        raise ArtifactError("Reviewed checkpoint identity drifted.")

    licenses = _closed_object(
        manifest["licenses"],
        {"runtime", "archiveOnly", "noticeMemberCount"},
        "artifactManifest.licenses",
    )
    runtime_licenses = _list(
        licenses["runtime"], 2, "artifactManifest.licenses.runtime"
    )
    archive_licenses = _list(
        licenses["archiveOnly"], 3, "artifactManifest.licenses.archiveOnly"
    )
    validated_runtime = [
        _validate_license(item, True, index)
        for index, item in enumerate(runtime_licenses)
    ]
    validated_archive = [
        _validate_license(item, False, index)
        for index, item in enumerate(archive_licenses)
    ]
    if (
        validated_runtime
        != [
            {
                "repositoryPath": "LICENSE",
                "imageName": "LICENSE",
                "imagePath": "/opt/fabrica/sam/licenses/LICENSE",
                "spdx": "Apache-2.0",
                "byteSize": 11_357,
                "sha256": "c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4",
            },
            {
                "repositoryPath": "LICENSE_cctorch",
                "imageName": "LICENSE_cctorch",
                "imagePath": "/opt/fabrica/sam/licenses/LICENSE_cctorch",
                "spdx": "BSD-3-Clause",
                "byteSize": 1_566,
                "sha256": "687d4f65ffe399358b170e22572564a16689e496f85a79dc5385fccf6bbc9558",
                "requiredBecause": "sam2/csrc-included",
            },
        ]
        or validated_archive
        != [
            {
                "repositoryPath": "sav_dataset/LICENSE",
                "byteSize": 1_514,
                "sha256": "28b6f4b85d4f6867c99bcba442d3e0bffc4e6f1a6e04e210a4bb9c9a3b56306a",
            },
            {
                "repositoryPath": "sav_dataset/LICENSE_DAVIS",
                "byteSize": 1_550,
                "sha256": "a727bc2b6f26a1f1c76d0511502da6ba208212708c04a65230159331906354f1",
            },
            {
                "repositoryPath": "sav_dataset/LICENSE_VOS_BENCHMARK",
                "byteSize": 1_048,
                "sha256": "104f011f1cd91268d54a9fab1ff769ef01081410cd622e0f723c03d146d02482",
            },
        ]
        or _integer(
            licenses["noticeMemberCount"],
            0,
            100,
            "artifactManifest.licenses.noticeMemberCount",
        )
        != 0
    ):
        raise ArtifactError("Reviewed license cross-binding drifted.")
    _validate_collision_free(
        [
            item["repositoryPath"]
            for item in validated_runtime + validated_archive
        ],
        "Reviewed license paths",
    )

    dependencies = _closed_object(
        manifest["dependencies"],
        {
            "acquisitionOccurred",
            "buildStatus",
            "requirementsLock",
            "wheelhouseInventory",
            "policy",
        },
        "artifactManifest.dependencies",
    )
    requirements_lock = _closed_object(
        dependencies["requirementsLock"],
        {"status", "byteSize", "sha256"},
        "artifactManifest.dependencies.requirementsLock",
    )
    wheelhouse_inventory = _closed_object(
        dependencies["wheelhouseInventory"],
        {"status", "byteSize", "sha256"},
        "artifactManifest.dependencies.wheelhouseInventory",
    )
    dependency_policy = _closed_object(
        dependencies["policy"],
        {
            "lockFormat",
            "wheelhouseFormat",
            "wheelFilesOnly",
            "rejectDirectUrls",
            "rejectVcs",
            "rejectEditables",
            "rejectIndexAndFindLinksDirectives",
            "rejectSourceDistributions",
            "rejectExtras",
            "offlineRequireHashes",
        },
        "artifactManifest.dependencies.policy",
    )
    expected_dependency_policy = {
        "lockFormat": "pip-require-hashes-no-directives-v1",
        "wheelhouseFormat": "fabrica-wheel-only-inventory-v1",
        "wheelFilesOnly": True,
        "rejectDirectUrls": True,
        "rejectVcs": True,
        "rejectEditables": True,
        "rejectIndexAndFindLinksDirectives": True,
        "rejectSourceDistributions": True,
        "rejectExtras": True,
        "offlineRequireHashes": True,
    }
    acquisition_occurred = _boolean(
        dependencies["acquisitionOccurred"],
        "artifactManifest.dependencies.acquisitionOccurred",
    )
    if dependency_policy != expected_dependency_policy or any(
        _boolean(
            dependency_policy[field],
            "artifactManifest.dependencies.policy.%s" % field,
        )
        is not True
        for field in (
            "wheelFilesOnly",
            "rejectDirectUrls",
            "rejectVcs",
            "rejectEditables",
            "rejectIndexAndFindLinksDirectives",
            "rejectSourceDistributions",
            "rejectExtras",
            "offlineRequireHashes",
        )
    ):
        raise ArtifactError(
            "Reviewed dependency acquisition/build gate drifted."
        )
    if dependencies["buildStatus"] == "unresolved-deployment-time-blocking":
        if (
            acquisition_occurred is not False
            or requirements_lock
            != {"status": "unresolved", "byteSize": None, "sha256": None}
            or wheelhouse_inventory
            != {"status": "unresolved", "byteSize": None, "sha256": None}
        ):
            raise ArtifactError(
                "Reviewed unresolved dependency gate drifted."
            )
    elif dependencies["buildStatus"] == "reviewed-wheel-only-ready":
        if acquisition_occurred is not True:
            raise ArtifactError(
                "Reviewed ready dependency acquisition state drifted."
            )
        for identity, path in (
            (
                requirements_lock,
                "artifactManifest.dependencies.requirementsLock",
            ),
            (
                wheelhouse_inventory,
                "artifactManifest.dependencies.wheelhouseInventory",
            ),
        ):
            if identity["status"] != "reviewed":
                raise ArtifactError(
                    "Reviewed dependency identity status drifted."
                )
            _integer(
                identity["byteSize"],
                1,
                MANIFEST_MAXIMUM_BYTES,
                path + ".byteSize",
            )
            _sha256(identity["sha256"], path + ".sha256")
    else:
        raise ArtifactError(
            "Reviewed dependency build status is unsupported."
        )

    base = _closed_object(
        manifest["baseImage"],
        {
            "registry",
            "repository",
            "tag",
            "immutableReference",
            "platform",
            "manifestByteSize",
            "manifestSha256",
            "configByteSize",
            "configSha256",
            "pythonIdentity",
            "pytorchConfigObservation",
            "cudaConfigObservation",
            "cudnnTagIdentity",
            "osConfigObservation",
            "runtimeAssertionStatus",
        },
        "artifactManifest.baseImage",
    )
    registry = _string(base["registry"], "artifactManifest.baseImage.registry")
    base_repository = _string(
        base["repository"], "artifactManifest.baseImage.repository"
    )
    tag = _string(base["tag"], "artifactManifest.baseImage.tag")
    base_manifest_sha = _sha256(
        base["manifestSha256"], "artifactManifest.baseImage.manifestSha256"
    )
    if (
        registry != "docker.io"
        or base_repository != "pytorch/pytorch"
        or base["immutableReference"]
        != "%s:%s@sha256:%s" % (base_repository, tag, base_manifest_sha)
        or base["platform"] != "linux/amd64"
        or base["pytorchConfigObservation"] != "2.5.1"
        or base["cudaConfigObservation"] != "12.4.1"
        or base["cudnnTagIdentity"] != 9
        or base["osConfigObservation"] != "Ubuntu 22.04"
        or base["runtimeAssertionStatus"]
        != "deferred-no-image-layer-pull-or-execution"
    ):
        raise ArtifactError("Reviewed base-image cross-binding drifted.")
    python_identity = _closed_object(
        base["pythonIdentity"],
        {
            "requiredCompatibility",
            "patch",
            "evidenceStatus",
            "patchStatus",
            "futureBuildAssertion",
        },
        "artifactManifest.baseImage.pythonIdentity",
    )
    if (
        python_identity["requiredCompatibility"] != "CPython 3.11.x"
        or python_identity["patch"] is not None
        or python_identity["evidenceStatus"]
        != "future-build-assertion-required"
        or python_identity["patchStatus"]
        != "retained-oci-metadata-does-not-expose-exact-patch"
        or python_identity["futureBuildAssertion"]
        != "assert-and-record-exact-patch-during-separately-authorized-build"
    ):
        raise ArtifactError("Reviewed Python identity/status drifted.")
    _integer(
        base["manifestByteSize"],
        1,
        1_000_000,
        "artifactManifest.baseImage.manifestByteSize",
    )
    _integer(
        base["configByteSize"],
        1,
        1_000_000,
        "artifactManifest.baseImage.configByteSize",
    )
    _sha256(base["configSha256"], "artifactManifest.baseImage.configSha256")
    if base != {
        "registry": "docker.io",
        "repository": "pytorch/pytorch",
        "tag": "2.5.1-cuda12.4-cudnn9-runtime",
        "immutableReference": "pytorch/pytorch:"
        "2.5.1-cuda12.4-cudnn9-runtime@sha256:"
        "c8268a92a69bd500f8be0e665b2630ee006dadaf7bfbc24249141b15ff622755",
        "platform": "linux/amd64",
        "manifestByteSize": 1_366,
        "manifestSha256": "c8268a92a69bd500f8be0e665b2630ee006dadaf7bfbc24249141b15ff622755",
        "configByteSize": 4_665,
        "configSha256": "946241f40f56c5ac17b12be451a9ff6bf7163acaac37d1f15bbc7404f4394e57",
        "pythonIdentity": {
            "requiredCompatibility": "CPython 3.11.x",
            "patch": None,
            "evidenceStatus": "future-build-assertion-required",
            "patchStatus": "retained-oci-metadata-does-not-expose-exact-"
            "patch",
            "futureBuildAssertion": "assert-and-record-exact-patch-during-"
            "separately-authorized-build",
        },
        "pytorchConfigObservation": "2.5.1",
        "cudaConfigObservation": "12.4.1",
        "cudnnTagIdentity": 9,
        "osConfigObservation": "Ubuntu 22.04",
        "runtimeAssertionStatus": "deferred-no-image-layer-pull-or-execution",
    }:
        raise ArtifactError("Reviewed base-image identity drifted.")
    return manifest


def load_reviewed_manifest(
    path: Path,
    *,
    now: datetime | None = None,
) -> Mapping[str, Any]:
    try:
        metadata = path.lstat()
        if (
            not stat.S_ISREG(metadata.st_mode)
            or path.is_symlink()
            or metadata.st_size < 1
            or metadata.st_size > MANIFEST_MAXIMUM_BYTES
        ):
            raise ArtifactError(
                "Reviewed artifact manifest is not a regular file."
            )
        data = path.read_bytes()
        if len(data) != metadata.st_size:
            raise ArtifactError(
                "Reviewed artifact manifest changed during read."
            )
    except ArtifactError:
        raise
    except OSError as error:
        raise ArtifactError("Reviewed artifact manifest is absent.") from error
    return validate_reviewed_manifest(strict_json_bytes(data), now=now)


def verify_file_identity(
    path: Path,
    expected_byte_size: int,
    expected_sha256: str,
    label: str,
) -> None:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise ArtifactError("%s is absent." % label) from error
    if not stat.S_ISREG(metadata.st_mode) or path.is_symlink():
        raise ArtifactError("%s is not a regular non-symlink file." % label)
    if metadata.st_size != expected_byte_size:
        raise ArtifactError("%s byte size drifted." % label)
    if file_sha256(path) != expected_sha256:
        raise ArtifactError("%s digest drifted." % label)


def _allowed_symlink_map(runtime_spec: Mapping[str, Any]) -> Dict[str, str]:
    return {
        item["path"]: item["target"]
        for item in runtime_spec["allowedSymlinks"]
    }


def _resolved_link_path(path: str, target: str, root: str) -> str:
    if target.startswith("/") or "\\" in target or "\x00" in target:
        raise ArtifactError("Source symlink target is unsafe.")
    target_parts = PurePosixPath(target).parts
    if any(part in ("", ".", "..") for part in target_parts):
        raise ArtifactError("Source symlink target is not canonical.")
    resolved = posixpath.normpath(
        posixpath.join(posixpath.dirname(path), target)
    )
    if not resolved.startswith(root + "/"):
        raise ArtifactError("Source symlink escapes the runtime subtree.")
    return resolved


def path_content_tree_digest(
    entries: Sequence[Tuple[str, str, bytes | str]]
) -> str:
    digest = hashlib.sha256()
    digest.update(TREE_DIGEST_DOMAIN)
    _validate_collision_free(
        (path for _kind, path, _payload in entries),
        "Path-content tree",
    )
    encoded_paths: List[Tuple[bytes, str, bytes | str]] = []
    for kind, path, payload in entries:
        encoded_paths.append((path.encode("utf-8"), kind, payload))
    encoded_paths.sort(key=lambda item: item[0])
    for path_bytes, kind, payload in encoded_paths:
        if kind == "F":
            if not isinstance(payload, bytes):
                raise ArtifactError("Regular tree record payload is invalid.")
            digest.update(b"F")
            digest.update(struct.pack(">I", len(path_bytes)))
            digest.update(path_bytes)
            digest.update(struct.pack(">Q", len(payload)))
            digest.update(hashlib.sha256(payload).digest())
        elif kind == "L":
            if not isinstance(payload, str):
                raise ArtifactError("Symlink tree record payload is invalid.")
            target = payload.encode("utf-8")
            digest.update(b"L")
            digest.update(struct.pack(">I", len(path_bytes)))
            digest.update(path_bytes)
            digest.update(struct.pack(">I", len(target)))
            digest.update(target)
        else:
            raise ArtifactError("Tree record kind is unsupported.")
    return digest.hexdigest()


def _archive_relative_path(name: str, top_level: str) -> str:
    if name == top_level:
        return ""
    prefix = top_level + "/"
    if not name.startswith(prefix):
        raise ArtifactError("Archive member escapes the exact top-level root.")
    relative = name[len(prefix) :]
    _safe_repository_path(relative, "archive member path")
    return relative


def audit_archive_safety(
    archive_path: Path,
    *,
    top_level: str,
    allowed_symlinks: Mapping[str, str],
    regular_file_byte_limit: int,
) -> Mapping[str, Any]:
    try:
        with tarfile.open(archive_path, mode="r:gz") as archive:
            members = archive.getmembers()
    except (OSError, tarfile.TarError) as error:
        raise ArtifactError("Repository archive is not a valid gzip tar.") from error
    relative_paths: List[str] = []
    regular_paths: set[str] = set()
    symlinks: Dict[str, str] = {}
    counts = {"regularFileCount": 0, "directoryCount": 0, "symlinkCount": 0}
    regular_bytes = 0
    largest_path = ""
    largest_size = -1
    root_seen = False
    license_family_paths: List[str] = []
    notice_family_paths: List[str] = []
    for member in members:
        relative = _archive_relative_path(member.name, top_level)
        if relative == "":
            if root_seen or not member.isdir():
                raise ArtifactError("Archive top-level member is invalid.")
            root_seen = True
        else:
            relative_paths.append(relative)
            basename = PurePosixPath(relative).name
            if basename.startswith("LICENSE"):
                license_family_paths.append(relative)
            if basename.startswith("NOTICE"):
                notice_family_paths.append(relative)
        if member.isfile():
            if relative == "" or member.size < 0 or member.size > regular_file_byte_limit:
                raise ArtifactError("Archive regular member size is unsafe.")
            counts["regularFileCount"] += 1
            regular_bytes += member.size
            regular_paths.add(relative)
            if member.size > largest_size:
                largest_size = member.size
                largest_path = relative
        elif member.isdir():
            if member.size != 0:
                raise ArtifactError("Archive directory member has a payload.")
            counts["directoryCount"] += 1
        elif member.issym():
            if relative == "" or member.size != 0:
                raise ArtifactError("Archive symlink member is invalid.")
            counts["symlinkCount"] += 1
            symlinks[relative] = member.linkname
        else:
            raise ArtifactError("Archive contains a forbidden member type.")
    if not root_seen:
        raise ArtifactError("Archive omits its exact top-level directory.")
    _validate_collision_free(relative_paths, "Repository archive")
    if symlinks != dict(allowed_symlinks):
        raise ArtifactError("Archive symlink allowlist drifted.")
    for path, target in symlinks.items():
        resolved = _resolved_link_path(path, target, "sam2")
        if resolved not in regular_paths:
            raise ArtifactError("Archive symlink target is not a regular member.")
    return {
        "entryCount": len(members),
        **counts,
        "regularFileBytes": regular_bytes,
        "largestRegularFile": {
            "path": largest_path,
            "byteSize": largest_size,
        },
        "licenseFamilyPaths": sorted(
            license_family_paths, key=lambda item: item.encode("utf-8")
        ),
        "noticeFamilyPaths": sorted(
            notice_family_paths, key=lambda item: item.encode("utf-8")
        ),
    }


def _selected_archive_bytes(
    archive_path: Path, top_level: str, paths: Iterable[str]
) -> Mapping[str, bytes]:
    requested = set(paths)
    found: Dict[str, bytes] = {}
    try:
        with tarfile.open(archive_path, mode="r:gz") as archive:
            for member in archive.getmembers():
                relative = _archive_relative_path(member.name, top_level)
                if relative not in requested:
                    continue
                if not member.isfile():
                    raise ArtifactError("Selected archive artifact is not regular.")
                source = archive.extractfile(member)
                if source is None:
                    raise ArtifactError("Selected archive artifact is unreadable.")
                data = source.read(member.size + 1)
                if len(data) != member.size:
                    raise ArtifactError("Selected archive artifact size drifted.")
                found[relative] = data
    except ArtifactError:
        raise
    except (OSError, tarfile.TarError) as error:
        raise ArtifactError("Repository archive artifact read failed.") from error
    if set(found) != requested:
        raise ArtifactError("Repository archive omits a selected artifact.")
    return found


def verify_source_archive(
    archive_path: Path, manifest: Mapping[str, Any]
) -> Mapping[str, Any]:
    repository = manifest["repository"]
    archive_spec = repository["archive"]
    runtime_spec = repository["runtimeSourceTree"]
    verify_file_identity(
        archive_path,
        archive_spec["byteSize"],
        archive_spec["sha256"],
        "Reviewed repository archive",
    )
    summary = audit_archive_safety(
        archive_path,
        top_level=archive_spec["topLevel"],
        allowed_symlinks=_allowed_symlink_map(runtime_spec),
        regular_file_byte_limit=archive_spec["regularFileByteLimit"],
    )
    for field in (
        "entryCount",
        "regularFileCount",
        "directoryCount",
        "symlinkCount",
        "regularFileBytes",
        "largestRegularFile",
    ):
        if summary[field] != archive_spec[field]:
            raise ArtifactError("Repository archive inventory drifted.")
    expected_license_paths = [
        item["repositoryPath"]
        for item in (
            *manifest["licenses"]["runtime"],
            *manifest["licenses"]["archiveOnly"],
        )
    ]
    if (
        summary["licenseFamilyPaths"] != sorted(
            expected_license_paths, key=lambda item: item.encode("utf-8")
        )
        or summary["noticeFamilyPaths"]
        or manifest["licenses"]["noticeMemberCount"] != 0
    ):
        raise ArtifactError("Repository archive license/NOTICE inventory drifted.")

    runtime_root = runtime_spec["root"]
    selected_paths = {
        manifest["config"]["repositoryPath"],
        manifest["upstreamLoader"]["repositoryPath"],
        *(
            item["repositoryPath"]
            for item in manifest["licenses"]["runtime"]
        ),
        *(
            item["repositoryPath"]
            for item in manifest["licenses"]["archiveOnly"]
        ),
    }
    try:
        with tarfile.open(archive_path, mode="r:gz") as archive:
            members = archive.getmembers()
            runtime_regular = [
                _archive_relative_path(member.name, archive_spec["topLevel"])
                for member in members
                if member.isfile()
                and _archive_relative_path(
                    member.name, archive_spec["topLevel"]
                ).startswith(runtime_root + "/")
            ]
    except (OSError, tarfile.TarError) as error:
        raise ArtifactError("Repository runtime subtree audit failed.") from error
    selected_paths.update(runtime_regular)
    selected = _selected_archive_bytes(
        archive_path, archive_spec["topLevel"], selected_paths
    )
    tree_entries: List[Tuple[str, str, bytes | str]] = [
        ("F", path, selected[path]) for path in runtime_regular
    ]
    tree_entries.extend(
        ("L", path, target)
        for path, target in _allowed_symlink_map(runtime_spec).items()
    )
    if (
        len(runtime_regular) != runtime_spec["regularFileCount"]
        or sum(len(selected[path]) for path in runtime_regular)
        != runtime_spec["regularFileBytes"]
        or path_content_tree_digest(tree_entries) != runtime_spec["sha256"]
    ):
        raise ArtifactError("Repository runtime source-tree identity drifted.")

    targeted = [
        manifest["config"],
        manifest["upstreamLoader"],
        *manifest["licenses"]["runtime"],
        *manifest["licenses"]["archiveOnly"],
    ]
    for identity in targeted:
        data = selected[identity["repositoryPath"]]
        if (
            len(data) != identity["byteSize"]
            or hashlib.sha256(data).hexdigest() != identity["sha256"]
        ):
            raise ArtifactError("Reviewed archive member identity drifted.")
    return summary


def audit_checkpoint_structure(
    checkpoint_path: Path, structure: Mapping[str, Any]
) -> None:
    try:
        with zipfile.ZipFile(checkpoint_path, mode="r") as checkpoint:
            infos = checkpoint.infolist()
            bad_member = checkpoint.testzip()
    except (OSError, RuntimeError, zipfile.BadZipFile) as error:
        raise ArtifactError("Checkpoint is not the reviewed ZIP structure.") from error
    if bad_member is not None:
        raise ArtifactError("Checkpoint ZIP CRC integrity failed.")
    names: List[str] = []
    stored_payload_bytes = 0
    root = structure["root"]
    data_pkl_size: int | None = None
    for info in infos:
        name = info.filename
        _safe_repository_path(name, "checkpoint ZIP member path")
        unix_mode = (info.external_attr >> 16) & 0xFFFF
        file_type = stat.S_IFMT(unix_mode)
        if (
            info.is_dir()
            or not name.startswith(root + "/")
            or info.flag_bits & 0x1
            or info.compress_type != zipfile.ZIP_STORED
            or file_type not in (0, stat.S_IFREG)
        ):
            raise ArtifactError("Checkpoint ZIP member structure is unsafe.")
        names.append(name)
        stored_payload_bytes += info.file_size
        if name == root + "/data.pkl":
            data_pkl_size = info.file_size
    _validate_collision_free(names, "Checkpoint ZIP")
    expected_names = {
        root + "/data.pkl",
        root + "/byteorder",
        root + "/version",
        root + "/.data/serialization_id",
        *(root + "/data/%d" % index for index in range(615)),
    }
    if (
        len(infos) != structure["entryCount"]
        or set(names) != expected_names
        or stored_payload_bytes != structure["storedPayloadBytes"]
        or data_pkl_size != structure["dataPklByteSize"]
    ):
        raise ArtifactError("Checkpoint ZIP structural observation drifted.")


def verify_checkpoint_artifact(
    checkpoint_path: Path, manifest: Mapping[str, Any]
) -> None:
    checkpoint = manifest["checkpoint"]
    verify_file_identity(
        checkpoint_path,
        checkpoint["byteSize"],
        checkpoint["sha256"],
        "Reviewed checkpoint",
    )
    audit_checkpoint_structure(
        checkpoint_path, checkpoint["structuralObservation"]
    )


def verify_base_image_selection(
    manifest: Mapping[str, Any], immutable_reference: str, platform: str
) -> None:
    base = manifest["baseImage"]
    if (
        immutable_reference != base["immutableReference"]
        or platform != base["platform"]
    ):
        raise ArtifactError("Base image reference or platform is not reviewed.")


def verify_base_metadata_files(
    manifest: Mapping[str, Any],
    manifest_json_path: Path,
    config_json_path: Path,
) -> None:
    base = manifest["baseImage"]
    verify_file_identity(
        manifest_json_path,
        base["manifestByteSize"],
        base["manifestSha256"],
        "Reviewed base-image manifest JSON",
    )
    verify_file_identity(
        config_json_path,
        base["configByteSize"],
        base["configSha256"],
        "Reviewed base-image config JSON",
    )
    try:
        image_manifest = strict_json_bytes(manifest_json_path.read_bytes())
        image_config = strict_json_bytes(config_json_path.read_bytes())
    except OSError as error:
        raise ArtifactError("Base-image metadata is unreadable.") from error
    image_manifest = _closed_object(
        image_manifest,
        {"schemaVersion", "mediaType", "config", "layers"},
        "baseImageManifest",
    )
    if (
        _integer(
            image_manifest["schemaVersion"],
            2,
            2,
            "baseImageManifest.schemaVersion",
        )
        != 2
        or not isinstance(image_manifest["layers"], list)
        or not image_manifest["layers"]
    ):
        raise ArtifactError("Base-image manifest shape drifted.")
    _string(image_manifest["mediaType"], "baseImageManifest.mediaType")
    descriptor = _closed_object(
        image_manifest["config"],
        {"mediaType", "size", "digest"},
        "baseImageManifest.config",
    )
    if (
        _string(
            descriptor["mediaType"], "baseImageManifest.config.mediaType"
        )
        == ""
        or _integer(
            descriptor["size"],
            1,
            1_000_000,
            "baseImageManifest.config.size",
        )
        != base["configByteSize"]
        or descriptor["digest"] != "sha256:" + base["configSha256"]
    ):
        raise ArtifactError("Base-image config descriptor drifted.")
    for layer in image_manifest["layers"]:
        layer_descriptor = _closed_object(
            layer,
            {"mediaType", "size", "digest"},
            "baseImageManifest.layers entry",
        )
        _string(
            layer_descriptor["mediaType"],
            "baseImageManifest.layers.mediaType",
        )
        _integer(
            layer_descriptor["size"],
            1,
            100_000_000_000,
            "baseImageManifest.layers.size",
        )
        digest = _string(
            layer_descriptor["digest"], "baseImageManifest.layers.digest"
        )
        if (
            not digest.startswith("sha256:")
            or SHA256_PATTERN.fullmatch(digest[7:]) is None
        ):
            raise ArtifactError("Base-image layer descriptor digest is invalid.")
    if not isinstance(image_config, dict):
        raise ArtifactError("Base-image config JSON is not an object.")
    if (
        image_config.get("architecture") != "amd64"
        or image_config.get("os") != "linux"
        or base["platform"] != "linux/amd64"
    ):
        raise ArtifactError("Base-image config platform drifted.")
    runtime_config = image_config.get("config")
    history = image_config.get("history")
    if (
        not isinstance(runtime_config, dict)
        or not isinstance(runtime_config.get("Env"), list)
        or not isinstance(runtime_config.get("Labels"), dict)
        or not isinstance(history, list)
        or not history
    ):
        raise ArtifactError("Base-image retained config evidence drifted.")
    environment: Dict[str, str] = {}
    for value in runtime_config["Env"]:
        if (
            not isinstance(value, str)
            or "=" not in value
            or not value.split("=", 1)[0]
        ):
            raise ArtifactError(
                "Base-image environment evidence is invalid."
            )
        name, environment_value = value.split("=", 1)
        if name in environment:
            raise ArtifactError(
                "Base-image environment evidence is duplicated."
            )
        environment[name] = environment_value
    labels = runtime_config["Labels"]
    history_commands: List[str] = []
    for item in history:
        if not isinstance(item, dict):
            raise ArtifactError("Base-image history evidence is invalid.")
        command = item.get("created_by")
        if command is not None:
            if not isinstance(command, str):
                raise ArtifactError(
                    "Base-image history command is invalid."
                )
            history_commands.append(command)
    history_evidence = "\n".join(history_commands)
    if (
        environment.get("PYTORCH_VERSION") != "2.5.1"
        or labels.get("org.opencontainers.image.ref.name") != "ubuntu"
        or labels.get("org.opencontainers.image.version") != "22.04"
        or "TARGETPLATFORM" not in history_evidence
        or "CUDA_VERSION=12.4.1" not in history_evidence
    ):
        raise ArtifactError(
            "Base-image retained version/config evidence drifted."
        )


def _canonical_distribution_name(value: str) -> str:
    return re.sub(r"[-_.]+", "-", value).lower()


def _read_verified_dependency_file(
    path: Path, identity: Mapping[str, Any], label: str
) -> bytes:
    verify_file_identity(
        path,
        identity["byteSize"],
        identity["sha256"],
        label,
    )
    try:
        data = path.read_bytes()
    except OSError as error:
        raise ArtifactError("%s is unreadable." % label) from error
    if len(data) != identity["byteSize"]:
        raise ArtifactError("%s changed during read." % label)
    return data


def parse_dependency_lock(data: bytes) -> Mapping[str, Tuple[str, str]]:
    try:
        text = data.decode("ascii", errors="strict")
    except UnicodeDecodeError as error:
        raise ArtifactError("Dependency lock is not strict ASCII.") from error
    if not text.endswith("\n") or not text or "\x00" in text:
        raise ArtifactError("Dependency lock framing is invalid.")
    lines = text[:-1].split("\n")
    if not lines or len(lines) > 256 or any(not line for line in lines):
        raise ArtifactError("Dependency lock line count is invalid.")
    result: Dict[str, Tuple[str, str]] = {}
    ordered_names: List[str] = []
    for line in lines:
        match = DEPENDENCY_LOCK_LINE_PATTERN.fullmatch(line)
        if match is None:
            raise ArtifactError("Dependency lock line grammar is invalid.")
        name = match.group("name")
        if (
            _canonical_distribution_name(name) != name
            or name in BASE_OWNED_DISTRIBUTIONS
            or name.startswith("nvidia-")
        ):
            raise ArtifactError(
                "Dependency lock contains a forbidden distribution."
            )
        if name in result:
            raise ArtifactError(
                "Dependency lock contains a duplicate distribution."
            )
        result[name] = (match.group("version"), match.group("sha256"))
        ordered_names.append(name)
    if ordered_names != sorted(
        ordered_names, key=lambda item: item.encode("ascii")
    ):
        raise ArtifactError("Dependency lock ordering is not canonical.")
    return result


def parse_wheelhouse_inventory(data: bytes) -> Sequence[Mapping[str, Any]]:
    inventory = strict_json_bytes(data)
    inventory = _closed_object(
        inventory,
        {"inventoryVersion", "inventoryKind", "wheels"},
        "wheelhouseInventory",
    )
    if (
        _integer(
            inventory["inventoryVersion"],
            1,
            1,
            "wheelhouseInventory.inventoryVersion",
        )
        != 1
        or inventory["inventoryKind"]
        != "fabrica-wheel-only-inventory-v1"
        or not isinstance(inventory["wheels"], list)
        or not inventory["wheels"]
        or len(inventory["wheels"]) > 256
    ):
        raise ArtifactError("Wheelhouse inventory identity is invalid.")
    expected_encoding = (canonical_json(inventory) + "\n").encode("utf-8")
    if data != expected_encoding:
        raise ArtifactError("Wheelhouse inventory encoding is not canonical.")
    filenames: List[str] = []
    entries: List[Mapping[str, Any]] = []
    for value in inventory["wheels"]:
        entry = _closed_object(
            value,
            {"filename", "byteSize", "sha256"},
            "wheelhouseInventory.wheels entry",
        )
        filename = _string(
            entry["filename"], "wheelhouseInventory.wheels.filename"
        )
        if (
            len(filename.encode("ascii", errors="ignore"))
            != len(filename)
            or len(filename) > 240
            or "/" in filename
            or "\\" in filename
            or "\x00" in filename
            or PurePosixPath(filename).name != filename
            or WHEEL_FILENAME_PATTERN.fullmatch(filename) is None
        ):
            raise ArtifactError("Wheelhouse filename is invalid.")
        _integer(
            entry["byteSize"],
            1,
            2_000_000_000,
            "wheelhouseInventory.wheels.byteSize",
        )
        _sha256(
            entry["sha256"], "wheelhouseInventory.wheels.sha256"
        )
        filenames.append(filename)
        entries.append(entry)
    _validate_collision_free(filenames, "Wheelhouse inventory")
    if filenames != sorted(
        filenames, key=lambda item: item.encode("ascii")
    ):
        raise ArtifactError("Wheelhouse inventory ordering is not canonical.")
    return entries


def _single_metadata_header(message: Any, name: str) -> str:
    values = message.get_all(name, [])
    if len(values) != 1 or not isinstance(values[0], str) or not values[0]:
        raise ArtifactError("Wheel metadata required header drifted.")
    return values[0]


def audit_wheel(
    wheel_path: Path,
    *,
    expected_filename: str,
) -> Tuple[str, str]:
    filename_match = WHEEL_FILENAME_PATTERN.fullmatch(expected_filename)
    if filename_match is None:
        raise ArtifactError("Wheel filename grammar drifted.")
    expected_dist_info = (
        filename_match.group("distribution")
        + "-"
        + filename_match.group("version")
        + ".dist-info"
    )
    try:
        with zipfile.ZipFile(wheel_path, mode="r") as wheel:
            infos = wheel.infolist()
            bad_member = wheel.testzip()
            if bad_member is not None:
                raise ArtifactError("Wheel ZIP CRC integrity failed.")
            if not infos or len(infos) > 100_000:
                raise ArtifactError("Wheel ZIP member count is invalid.")
            names: List[str] = []
            regular_names: set[str] = set()
            dist_info_roots: set[str] = set()
            total_bytes = 0
            for info in infos:
                name = info.filename
                path = name[:-1] if info.is_dir() else name
                _safe_repository_path(path, "wheel ZIP member path")
                unix_mode = (info.external_attr >> 16) & 0xFFFF
                file_type = stat.S_IFMT(unix_mode)
                if (
                    info.flag_bits & 0x1
                    or info.compress_type
                    not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                    or (
                        info.is_dir()
                        and (
                            file_type not in (0, stat.S_IFDIR)
                            or info.file_size != 0
                        )
                    )
                    or (
                        not info.is_dir()
                        and file_type not in (0, stat.S_IFREG)
                    )
                    or info.file_size < 0
                    or info.file_size > 1_000_000_000
                ):
                    raise ArtifactError("Wheel ZIP member structure is unsafe.")
                names.append(path)
                top_level = path.split("/", 1)[0]
                if top_level.endswith(".dist-info"):
                    dist_info_roots.add(top_level)
                elif top_level.endswith(".data"):
                    raise ArtifactError(
                        "Wheel contains a forbidden install path."
                    )
                else:
                    namespace = (
                        top_level[:-3]
                        if top_level.endswith(".py")
                        else top_level
                    )
                    if (
                        unicodedata.normalize("NFC", namespace).casefold()
                        in FORBIDDEN_IMPORT_NAMESPACES
                    ):
                        raise ArtifactError(
                            "Wheel collides with a protected namespace."
                        )
                if not info.is_dir():
                    regular_names.add(path)
                    total_bytes += info.file_size
                    if total_bytes > 2_000_000_000:
                        raise ArtifactError("Wheel ZIP payload is too large.")
                    if path.endswith(".pth"):
                        raise ArtifactError(
                            "Wheel contains a forbidden install path."
                        )
            _validate_collision_free(names, "Wheel ZIP")
            if dist_info_roots != {expected_dist_info}:
                raise ArtifactError(
                    "Wheel contains a foreign dist-info root."
                )
            metadata_names = [
                name
                for name in regular_names
                if name.endswith(".dist-info/METADATA")
            ]
            wheel_names = [
                name
                for name in regular_names
                if name.endswith(".dist-info/WHEEL")
            ]
            record_names = [
                name
                for name in regular_names
                if name.endswith(".dist-info/RECORD")
            ]
            if (
                len(metadata_names) != 1
                or len(wheel_names) != 1
                or len(record_names) != 1
            ):
                raise ArtifactError(
                    "Wheel dist-info inventory is invalid."
                )
            dist_info_root = metadata_names[0].split("/", 1)[0]
            if (
                wheel_names[0].split("/", 1)[0] != dist_info_root
                or record_names[0].split("/", 1)[0] != dist_info_root
            ):
                raise ArtifactError("Wheel dist-info roots drifted.")
            metadata_info = wheel.getinfo(metadata_names[0])
            wheel_info = wheel.getinfo(wheel_names[0])
            if metadata_info.file_size > 1_000_000 or wheel_info.file_size > 64_000:
                raise ArtifactError("Wheel metadata is too large.")
            metadata_message = BytesParser(
                policy=email.policy.compat32
            ).parsebytes(wheel.read(metadata_info))
            wheel_message = BytesParser(
                policy=email.policy.compat32
            ).parsebytes(wheel.read(wheel_info))
    except ArtifactError:
        raise
    except (
        KeyError,
        OSError,
        RuntimeError,
        UnicodeError,
        zipfile.BadZipFile,
    ) as error:
        raise ArtifactError("Wheel ZIP verification failed.") from error
    metadata_name = _single_metadata_header(metadata_message, "Name")
    metadata_version = _single_metadata_header(
        metadata_message, "Version"
    )
    if _single_metadata_header(wheel_message, "Wheel-Version") != "1.0":
        raise ArtifactError("Wheel format version is unsupported.")
    canonical_name = _canonical_distribution_name(metadata_name)
    expected_distribution = _canonical_distribution_name(
        filename_match.group("distribution")
    )
    expected_version = filename_match.group("version")
    python_tags = set(filename_match.group("python").split("."))
    abi_tags = set(filename_match.group("abi").split("."))
    platform_tags = set(filename_match.group("platform").split("."))
    pure_platform = (
        platform_tags == {"any"} and abi_tags == {"none"}
    )
    glibc_linux_platform = bool(platform_tags) and all(
        tag == "linux_x86_64"
        or (
            tag.startswith("manylinux")
            and tag.endswith("_x86_64")
        )
        for tag in platform_tags
    )
    if (
        not python_tags.issubset({"py3", "py311", "cp311"})
        or not abi_tags.issubset({"none", "abi3", "cp311"})
        or not (pure_platform or glibc_linux_platform)
    ):
        raise ArtifactError(
            "Wheel tags are incompatible with reviewed linux/amd64 CPython 3.11."
        )
    if (
        canonical_name != expected_distribution
        or metadata_version != expected_version
        or dist_info_root != expected_dist_info
        or canonical_name in BASE_OWNED_DISTRIBUTIONS
        or canonical_name.startswith("nvidia-")
    ):
        raise ArtifactError("Wheel distribution identity drifted.")
    return canonical_name, metadata_version


def verify_dependency_build_ready(
    manifest: Mapping[str, Any],
    *,
    requirements_lock_path: Path,
    wheelhouse_inventory_path: Path,
    wheelhouse_root: Path,
) -> None:
    dependencies = manifest["dependencies"]
    if (
        dependencies["buildStatus"] != "reviewed-wheel-only-ready"
        or dependencies["acquisitionOccurred"] is not True
    ):
        raise ArtifactError(
            "Dependency lock and wheelhouse remain deployment-time blocking."
        )
    lock_data = _read_verified_dependency_file(
        requirements_lock_path,
        dependencies["requirementsLock"],
        "Reviewed dependency lock",
    )
    inventory_data = _read_verified_dependency_file(
        wheelhouse_inventory_path,
        dependencies["wheelhouseInventory"],
        "Reviewed wheelhouse inventory",
    )
    locked = parse_dependency_lock(lock_data)
    inventory = parse_wheelhouse_inventory(inventory_data)
    try:
        metadata = wheelhouse_root.lstat()
        with os.scandir(wheelhouse_root) as directory_entries:
            entries = list(directory_entries)
    except OSError as error:
        raise ArtifactError("Reviewed wheelhouse is absent.") from error
    if not stat.S_ISDIR(metadata.st_mode) or wheelhouse_root.is_symlink():
        raise ArtifactError("Reviewed wheelhouse is not a regular directory.")
    expected_filenames = {entry["filename"] for entry in inventory}
    actual_filenames = {entry.name for entry in entries}
    if (
        len(entries) != len(actual_filenames)
        or actual_filenames != expected_filenames
    ):
        raise ArtifactError("Reviewed wheelhouse inventory drifted.")
    observed: Dict[str, Tuple[str, str]] = {}
    for identity in inventory:
        wheel_path = wheelhouse_root / identity["filename"]
        verify_file_identity(
            wheel_path,
            identity["byteSize"],
            identity["sha256"],
            "Reviewed wheel",
        )
        name, version = audit_wheel(
            wheel_path, expected_filename=identity["filename"]
        )
        if name in observed:
            raise ArtifactError(
                "Wheelhouse contains duplicate distribution wheels."
            )
        observed[name] = (version, identity["sha256"])
    if observed != dict(locked):
        raise ArtifactError(
            "Dependency lock and wheelhouse package closure drifted."
        )


def verify_build_input_artifacts(
    *,
    manifest: Mapping[str, Any],
    archive_path: Path,
    raw_config_path: Path,
    checkpoint_path: Path,
    license_paths: Sequence[Path],
    base_manifest_json_path: Path,
    base_config_json_path: Path,
    requirements_lock_path: Path,
    wheelhouse_inventory_path: Path,
    wheelhouse_root: Path,
    immutable_base_reference: str,
    platform: str,
) -> None:
    verify_dependency_build_ready(
        manifest,
        requirements_lock_path=requirements_lock_path,
        wheelhouse_inventory_path=wheelhouse_inventory_path,
        wheelhouse_root=wheelhouse_root,
    )
    verify_base_image_selection(
        manifest, immutable_base_reference, platform
    )
    verify_base_metadata_files(
        manifest, base_manifest_json_path, base_config_json_path
    )
    verify_source_archive(archive_path, manifest)
    verify_checkpoint_artifact(checkpoint_path, manifest)
    config = manifest["config"]
    verify_file_identity(
        raw_config_path,
        config["byteSize"],
        config["sha256"],
        "Separately staged raw config",
    )
    runtime_licenses = manifest["licenses"]["runtime"]
    if len(license_paths) != len(runtime_licenses):
        raise ArtifactError("Separately staged license count drifted.")
    for path, identity in zip(license_paths, runtime_licenses):
        verify_file_identity(
            path,
            identity["byteSize"],
            identity["sha256"],
            "Separately staged runtime license",
        )
    selected = _selected_archive_bytes(
        archive_path,
        manifest["repository"]["archive"]["topLevel"],
        [
            config["repositoryPath"],
            *(item["repositoryPath"] for item in runtime_licenses),
        ],
    )
    try:
        staged = [
            raw_config_path.read_bytes(),
            *(path.read_bytes() for path in license_paths),
        ]
    except OSError as error:
        raise ArtifactError("Separately staged artifact is unreadable.") from error
    expected = [
        selected[config["repositoryPath"]],
        *(
            selected[item["repositoryPath"]]
            for item in runtime_licenses
        ),
    ]
    if staged != expected:
        raise ArtifactError(
            "Separately staged artifact differs from its archive member."
        )


def scan_runtime_source_tree(
    source_root: Path, allowed_symlinks: Mapping[str, str]
) -> Mapping[str, Any]:
    try:
        root_metadata = source_root.lstat()
    except OSError as error:
        raise ArtifactError("Runtime source root is absent.") from error
    if not stat.S_ISDIR(root_metadata.st_mode) or source_root.is_symlink():
        raise ArtifactError("Runtime source root is not a regular directory.")

    records: List[Tuple[str, str, bytes | str]] = []
    directories: set[str] = set()
    all_paths: List[str] = []

    def visit(directory: Path, relative_directory: str) -> None:
        try:
            children = list(os.scandir(directory))
        except OSError as error:
            raise ArtifactError("Runtime source tree is unreadable.") from error
        for child in children:
            relative = (
                child.name
                if not relative_directory
                else relative_directory + "/" + child.name
            )
            _safe_repository_path(relative, "runtime source path")
            all_paths.append(relative)
            try:
                metadata = child.stat(follow_symlinks=False)
            except OSError as error:
                raise ArtifactError("Runtime source entry is unreadable.") from error
            child_path = Path(child.path)
            if stat.S_ISDIR(metadata.st_mode):
                directories.add(relative)
                visit(child_path, relative)
            elif stat.S_ISREG(metadata.st_mode):
                try:
                    data = child_path.read_bytes()
                except OSError as error:
                    raise ArtifactError("Runtime source file is unreadable.") from error
                if len(data) != metadata.st_size:
                    raise ArtifactError("Runtime source file size changed during read.")
                records.append(("F", relative, data))
            elif stat.S_ISLNK(metadata.st_mode):
                try:
                    target = os.readlink(child_path)
                except OSError as error:
                    raise ArtifactError("Runtime source symlink is unreadable.") from error
                records.append(("L", relative, target))
            else:
                raise ArtifactError("Runtime source contains a forbidden entry type.")

    visit(source_root, "")
    _validate_collision_free(all_paths, "Runtime source tree")
    if not all_paths or set(path.split("/", 1)[0] for path in all_paths) != {
        "sam2"
    }:
        raise ArtifactError("Runtime source tree contains a foreign top-level entry.")
    symlinks = {
        path: payload
        for kind, path, payload in records
        if kind == "L" and isinstance(payload, str)
    }
    if symlinks != dict(allowed_symlinks):
        raise ArtifactError("Runtime source symlink allowlist drifted.")
    regular_paths = {path for kind, path, _payload in records if kind == "F"}
    for path, target in symlinks.items():
        resolved = _resolved_link_path(path, target, "sam2")
        if resolved not in regular_paths:
            raise ArtifactError("Runtime source symlink target is not regular.")

    required_directories = {"sam2"}
    for _kind, path, _payload in records:
        parent = posixpath.dirname(path)
        while parent:
            required_directories.add(parent)
            parent = posixpath.dirname(parent)
    if directories != required_directories:
        raise ArtifactError("Runtime source directory inventory contains an extra entry.")
    regular_records = [
        payload
        for kind, _path, payload in records
        if kind == "F" and isinstance(payload, bytes)
    ]
    return {
        "regularFileCount": len(regular_records),
        "symlinkCount": len(symlinks),
        "regularFileBytes": sum(len(payload) for payload in regular_records),
        "sha256": path_content_tree_digest(records),
    }


def verify_runtime_source_tree(
    source_root: Path, manifest: Mapping[str, Any]
) -> None:
    runtime_spec = manifest["repository"]["runtimeSourceTree"]
    summary = scan_runtime_source_tree(
        source_root, _allowed_symlink_map(runtime_spec)
    )
    for field in (
        "regularFileCount",
        "symlinkCount",
        "regularFileBytes",
        "sha256",
    ):
        if summary[field] != runtime_spec[field]:
            raise ArtifactError("Runtime source-tree identity drifted.")
    for identity, label in (
        (manifest["config"], "Runtime config"),
        (manifest["upstreamLoader"], "Runtime upstream loader"),
    ):
        verify_file_identity(
            source_root / identity["repositoryPath"],
            identity["byteSize"],
            identity["sha256"],
            label,
        )


def verify_license_directory(
    licenses_root: Path, licenses: Sequence[Mapping[str, Any]]
) -> None:
    try:
        metadata = licenses_root.lstat()
        names = {entry.name for entry in os.scandir(licenses_root)}
    except OSError as error:
        raise ArtifactError("Runtime license directory is absent.") from error
    if not stat.S_ISDIR(metadata.st_mode) or licenses_root.is_symlink():
        raise ArtifactError("Runtime license root is not a regular directory.")
    expected_names = {item["imageName"] for item in licenses}
    if names != expected_names:
        raise ArtifactError("Runtime license inventory drifted.")
    for identity in licenses:
        verify_file_identity(
            licenses_root / identity["imageName"],
            identity["byteSize"],
            identity["sha256"],
            "Runtime license",
        )


def _verify_regular_file_size(path: Path, expected_size: int, label: str) -> None:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise ArtifactError("%s is absent." % label) from error
    if (
        not stat.S_ISREG(metadata.st_mode)
        or path.is_symlink()
        or metadata.st_size != expected_size
    ):
        raise ArtifactError("%s type or byte size drifted." % label)


def preflight_runtime_artifacts(
    *,
    manifest_path: Path,
    source_root: Path,
    checkpoint_path: Path,
    licenses_root: Path,
    now: datetime | None = None,
) -> Mapping[str, Any]:
    manifest = load_reviewed_manifest(manifest_path, now=now)
    try:
        source_metadata = source_root.lstat()
        license_metadata = licenses_root.lstat()
        license_names = {entry.name for entry in os.scandir(licenses_root)}
    except OSError as error:
        raise ArtifactError("Runtime artifact directory is absent.") from error
    if (
        not stat.S_ISDIR(source_metadata.st_mode)
        or source_root.is_symlink()
        or not stat.S_ISDIR(license_metadata.st_mode)
        or licenses_root.is_symlink()
    ):
        raise ArtifactError("Runtime artifact directory type drifted.")
    config = manifest["config"]
    loader = manifest["upstreamLoader"]
    _verify_regular_file_size(
        source_root / config["repositoryPath"],
        config["byteSize"],
        "Runtime config",
    )
    _verify_regular_file_size(
        source_root / loader["repositoryPath"],
        loader["byteSize"],
        "Runtime upstream loader",
    )
    _verify_regular_file_size(
        checkpoint_path,
        manifest["checkpoint"]["byteSize"],
        "Runtime checkpoint",
    )
    licenses = manifest["licenses"]["runtime"]
    if license_names != {item["imageName"] for item in licenses}:
        raise ArtifactError("Runtime license inventory drifted.")
    for identity in licenses:
        _verify_regular_file_size(
            licenses_root / identity["imageName"],
            identity["byteSize"],
            "Runtime license",
        )
    return manifest


def verify_runtime_artifacts(
    *,
    manifest_path: Path,
    source_root: Path,
    checkpoint_path: Path,
    licenses_root: Path,
    now: datetime | None = None,
) -> Mapping[str, Any]:
    manifest = load_reviewed_manifest(manifest_path, now=now)
    verify_runtime_source_tree(source_root, manifest)
    verify_checkpoint_artifact(checkpoint_path, manifest)
    verify_license_directory(licenses_root, manifest["licenses"]["runtime"])
    return manifest


def _empty_or_create_directory(path: Path) -> None:
    try:
        try:
            metadata = path.lstat()
        except FileNotFoundError:
            path.mkdir(parents=True, exist_ok=False)
            metadata = path.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or path.is_symlink():
            raise ArtifactError(
                "Runtime extraction destination is not a regular directory."
            )
        with os.scandir(path) as entries:
            if next(entries, None) is not None:
                raise ArtifactError(
                    "Runtime extraction destination is not empty."
                )
    except ArtifactError:
        raise
    except OSError as error:
        raise ArtifactError("Runtime extraction destination is unavailable.") from error


def extract_reviewed_runtime_source(
    *,
    archive_path: Path,
    source_root: Path,
    licenses_root: Path,
    manifest: Mapping[str, Any],
) -> None:
    verify_source_archive(archive_path, manifest)
    _empty_or_create_directory(source_root)
    _empty_or_create_directory(licenses_root)
    archive_spec = manifest["repository"]["archive"]
    runtime_spec = manifest["repository"]["runtimeSourceTree"]
    runtime_prefix = runtime_spec["root"] + "/"
    license_by_path = {
        item["repositoryPath"]: item for item in manifest["licenses"]["runtime"]
    }
    regular_outputs: List[Tuple[str, bytes]] = []
    try:
        with tarfile.open(archive_path, mode="r:gz") as archive:
            for member in archive.getmembers():
                relative = _archive_relative_path(
                    member.name, archive_spec["topLevel"]
                )
                if not member.isfile():
                    continue
                if relative.startswith(runtime_prefix):
                    destination = relative
                elif relative in license_by_path:
                    destination = license_by_path[relative]["imageName"]
                else:
                    continue
                source = archive.extractfile(member)
                if source is None:
                    raise ArtifactError("Reviewed extraction member is unreadable.")
                data = source.read(member.size + 1)
                if len(data) != member.size:
                    raise ArtifactError("Reviewed extraction member size drifted.")
                regular_outputs.append((destination, data))
    except ArtifactError:
        raise
    except (OSError, tarfile.TarError) as error:
        raise ArtifactError("Reviewed source extraction failed.") from error

    for destination, data in regular_outputs:
        root = (
            source_root
            if destination.startswith(runtime_prefix)
            else licenses_root
        )
        relative = (
            destination
            if root == source_root
            else PurePosixPath(destination).name
        )
        target = root.joinpath(*PurePosixPath(relative).parts)
        try:
            target.parent.mkdir(parents=True, exist_ok=True)
            descriptor = os.open(
                target,
                os.O_WRONLY
                | os.O_CREAT
                | os.O_EXCL
                | getattr(os, "O_NOFOLLOW", 0),
                0o644,
            )
            with os.fdopen(descriptor, "wb") as output:
                output.write(data)
        except OSError as error:
            raise ArtifactError("Reviewed source extraction write failed.") from error
    for path, target in _allowed_symlink_map(runtime_spec).items():
        link_path = source_root.joinpath(*PurePosixPath(path).parts)
        try:
            os.symlink(target, link_path)
        except OSError as error:
            raise ArtifactError("Reviewed source symlink creation failed.") from error
    verify_runtime_source_tree(source_root, manifest)
    verify_license_directory(licenses_root, manifest["licenses"]["runtime"])


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(add_help=True)
    subcommands = parser.add_subparsers(dest="command", required=True)

    manifest = subcommands.add_parser("verify-manifest")
    manifest.add_argument("--manifest", type=Path, required=True)

    audit = subcommands.add_parser("audit-build")
    audit.add_argument("--manifest", type=Path, required=True)
    audit.add_argument("--archive", type=Path, required=True)
    audit.add_argument("--config", type=Path, required=True)
    audit.add_argument("--checkpoint", type=Path, required=True)
    audit.add_argument(
        "--license", type=Path, action="append", required=True
    )
    audit.add_argument("--base-manifest", type=Path, required=True)
    audit.add_argument("--base-config", type=Path, required=True)
    audit.add_argument("--requirements-lock", type=Path, required=True)
    audit.add_argument("--wheelhouse-inventory", type=Path, required=True)
    audit.add_argument("--wheelhouse", type=Path, required=True)
    audit.add_argument("--base-image", required=True)
    audit.add_argument("--platform", required=True)

    extract = subcommands.add_parser("extract-runtime")
    extract.add_argument("--manifest", type=Path, required=True)
    extract.add_argument("--archive", type=Path, required=True)
    extract.add_argument("--source-root", type=Path, required=True)
    extract.add_argument("--licenses-root", type=Path, required=True)

    runtime = subcommands.add_parser("verify-runtime")
    runtime.add_argument("--manifest", type=Path, required=True)
    runtime.add_argument("--source-root", type=Path, required=True)
    runtime.add_argument("--checkpoint", type=Path, required=True)
    runtime.add_argument("--licenses-root", type=Path, required=True)
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    arguments = _parser().parse_args(argv)
    manifest = load_reviewed_manifest(arguments.manifest)
    if arguments.command == "audit-build":
        verify_build_input_artifacts(
            manifest=manifest,
            archive_path=arguments.archive,
            raw_config_path=arguments.config,
            checkpoint_path=arguments.checkpoint,
            license_paths=arguments.license,
            base_manifest_json_path=arguments.base_manifest,
            base_config_json_path=arguments.base_config,
            requirements_lock_path=arguments.requirements_lock,
            wheelhouse_inventory_path=arguments.wheelhouse_inventory,
            wheelhouse_root=arguments.wheelhouse,
            immutable_base_reference=arguments.base_image,
            platform=arguments.platform,
        )
    elif arguments.command == "extract-runtime":
        extract_reviewed_runtime_source(
            archive_path=arguments.archive,
            source_root=arguments.source_root,
            licenses_root=arguments.licenses_root,
            manifest=manifest,
        )
    elif arguments.command == "verify-runtime":
        verify_runtime_source_tree(arguments.source_root, manifest)
        verify_checkpoint_artifact(arguments.checkpoint, manifest)
        verify_license_directory(
            arguments.licenses_root, manifest["licenses"]["runtime"]
        )
    print("sam-worker-artifacts-ok")


if __name__ == "__main__":
    main()
