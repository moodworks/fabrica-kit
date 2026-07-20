#!/usr/bin/env python3
"""Offline validation of a registry-returned Linux/AMD64 image-manifest identity."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Mapping, Sequence

OCI_IMAGE_MANIFEST = "application/vnd.oci.image.manifest.v1+json"
DOCKER_IMAGE_MANIFEST = (
    "application/vnd.docker.distribution.manifest.v2+json"
)
OCI_IMAGE_INDEX = "application/vnd.oci.image.index.v1+json"
DOCKER_MANIFEST_LIST = (
    "application/vnd.docker.distribution.manifest.list.v2+json"
)
OCI_IMAGE_CONFIG = "application/vnd.oci.image.config.v1+json"
DOCKER_IMAGE_CONFIG = (
    "application/vnd.docker.container.image.v1+json"
)
IMAGE_MANIFEST_MEDIA_TYPES = {
    OCI_IMAGE_MANIFEST,
    DOCKER_IMAGE_MANIFEST,
}
IMAGE_INDEX_MEDIA_TYPES = {
    OCI_IMAGE_INDEX,
    DOCKER_MANIFEST_LIST,
}
IMAGE_CONFIG_MEDIA_TYPES = {
    OCI_IMAGE_CONFIG,
    DOCKER_IMAGE_CONFIG,
}
IMAGE_LAYER_MEDIA_TYPES = {
    "application/vnd.oci.image.layer.v1.tar",
    "application/vnd.oci.image.layer.v1.tar+gzip",
    "application/vnd.oci.image.layer.v1.tar+zstd",
    "application/vnd.oci.image.layer.nondistributable.v1.tar",
    "application/vnd.oci.image.layer.nondistributable.v1.tar+gzip",
    "application/vnd.oci.image.layer.nondistributable.v1.tar+zstd",
    "application/vnd.docker.image.rootfs.diff.tar",
    "application/vnd.docker.image.rootfs.diff.tar.gzip",
    "application/vnd.docker.image.rootfs.foreign.diff.tar",
    "application/vnd.docker.image.rootfs.foreign.diff.tar.gzip",
}
DIGEST_PATTERN = re.compile(r"sha256:[0-9a-f]{64}")
COMMIT_PATTERN = re.compile(r"[0-9a-f]{40}")
ZERO_DIGEST = "sha256:" + "0" * 64
MAX_DOCUMENT_BYTES = 4_000_000
EXPECTED_RUNTIME_ENVIRONMENT = {
    "HF_HUB_OFFLINE": "1",
    "PIP_CONFIG_FILE": "/dev/null",
    "PIP_DISABLE_PIP_VERSION_CHECK": "1",
    "PIP_NO_INDEX": "1",
    "PYTHONDONTWRITEBYTECODE": "1",
    "PYTHONPATH": (
        "/opt/fabrica/sam2-overlay:/opt/fabrica/runtime-deps:"
        "/opt/fabrica/worker:/opt/fabrica/sam2-source"
    ),
    "PYTHONUNBUFFERED": "1",
    "TRANSFORMERS_OFFLINE": "1",
}
EXPECTED_IMAGE_LABELS = {
    "io.fabrica.build-contract.version": (
        "fabrica-sam-ghcr-linux-amd64-v1"
    ),
    "io.fabrica.image-use": (
        "pinned-digest-deployment-only-v1"
    ),
    "io.fabrica.sam.artifact-manifest-sha256": (
        "085ddd290b17b6931ea026c274610d9f6c49bad49a5fd372e846a2060b9ac5c4"
    ),
    "io.fabrica.sam.checkpoint-sha256": (
        "a2345aede8715ab1d5d31b4a509fb160c5a4af1970f199d9054ccfb746c004c5"
    ),
    "io.fabrica.sam.config": (
        "configs/sam2.1/sam2.1_hiera_b+.yaml"
    ),
    "io.fabrica.sam.config-sha256": (
        "e73f9e9547b305040552ee943ebd3a34cee5727a76fc2ab88b87f7b28b430754"
    ),
    "io.fabrica.sam.direct-adapter-profile-sha256": (
        "1e6795c970fcfa9443b850f27149e237daf63ffa668cd5094189936453467e28"
    ),
    "io.fabrica.sam.hosting-profile-sha256": (
        "872054e82fc13e771fa65381e2db1f19dfb2dd609584574e8c532ed8eb82fa18"
    ),
    "io.fabrica.sam.model-id": "sam2.1_hiera_base_plus",
    "io.fabrica.sam.repository-commit": (
        "05d9e57fb3945b10c861046c1e6749e2bfc258e3"
    ),
    "io.fabrica.sam.runtime-adapter-profile-sha256": (
        "f03c378caa5b9ba7979d67ffe958dfd9ca65cc823a10d728faed8c612937b7bf"
    ),
    "io.fabrica.sam.worker-image-digest-env": (
        "SAM_WORKER_IMAGE_DIGEST"
    ),
    "io.fabrica.sam.worker-image-object": (
        "linux-amd64-image-manifest-v1"
    ),
    "io.fabrica.source-revision-contract": (
        "required-git-sha40-v1"
    ),
    "org.opencontainers.image.source": (
        "https://github.com/moodworks/fabrica-kit"
    ),
}
EXPECTED_RUNTIME_MATERIALIZED_HISTORY_SUFFIX = (
    "fabrica-build-gate: source-revision",
    "fabrica-build-gate: runtime-cpython-major-minor",
    "fabrica-build-gate: torch-metadata-missing",
    "fabrica-build-gate: torchvision-metadata-missing",
    "groupadd --gid 10001 fabrica",
    "fabrica-build-gate: runtime-user-identity",
    "copy /opt/fabrica/closed/worker /opt/fabrica/worker",
    (
        "copy /opt/fabrica/closed/sam2-overlay "
        "/opt/fabrica/sam2-overlay"
    ),
    (
        "copy /opt/fabrica/closed/sam2-source "
        "/opt/fabrica/sam2-source"
    ),
    "copy /opt/fabrica/closed/sam /opt/fabrica/sam",
    (
        "copy /opt/fabrica/closed/requirements.lock "
        "/opt/fabrica/sam/requirements.lock"
    ),
    (
        "copy /opt/fabrica/closed/wheelhouse-manifest.json "
        "/opt/fabrica/sam/wheelhouse-manifest.json"
    ),
    "python -m sam_worker.artifacts verify-dependencies",
    "python -m sam_worker.artifacts verify-runtime",
    "fabrica-build-gate: selected-config-parse",
    "workdir /opt/fabrica/worker",
)


class ImageManifestError(ValueError):
    """A fixed-boundary image identity validation failure."""


def validate_digest(value: Any, label: str) -> str:
    if (
        not isinstance(value, str)
        or DIGEST_PATTERN.fullmatch(value) is None
        or value == ZERO_DIGEST
    ):
        raise ImageManifestError(
            "%s must be a resolved lowercase sha256 digest" % label
        )
    return value


def _closed_pairs(pairs: Sequence[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ImageManifestError("JSON contains a duplicate object key")
        result[key] = value
    return result


def parse_document(data: bytes, label: str) -> Mapping[str, Any]:
    if not data or len(data) > MAX_DOCUMENT_BYTES:
        raise ImageManifestError("%s has an invalid byte size" % label)
    try:
        text = data.decode("utf-8", errors="strict")
        value = json.loads(
            text,
            object_pairs_hook=_closed_pairs,
            parse_constant=lambda _value: (_ for _ in ()).throw(
                ImageManifestError("%s contains a non-finite number" % label)
            ),
        )
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ImageManifestError("%s is not strict UTF-8 JSON" % label) from error
    if not isinstance(value, dict):
        raise ImageManifestError("%s must be a JSON object" % label)
    return value


def verify_document_digest(
    data: bytes, expected_digest: Any, label: str
) -> str:
    digest = validate_digest(expected_digest, label + " digest")
    observed = "sha256:" + hashlib.sha256(data).hexdigest()
    if observed != digest:
        raise ImageManifestError(
            "%s bytes do not match the registry digest" % label
        )
    return digest


def parse_registry_headers(
    data: bytes, expected_digest: str
) -> str:
    try:
        text = data.decode("ascii", errors="strict")
    except UnicodeDecodeError as error:
        raise ImageManifestError("registry headers are not ASCII") from error
    blocks = [
        block
        for block in re.split(r"\r?\n\r?\n", text.strip())
        if block.startswith("HTTP/")
    ]
    if not blocks:
        raise ImageManifestError("registry response headers are missing")
    lines = blocks[-1].splitlines()
    status = lines[0].split()
    if len(status) < 2 or status[1] != "200":
        raise ImageManifestError("registry manifest response was not HTTP 200")
    fields: dict[str, list[str]] = {}
    for line in lines[1:]:
        if not line or ":" not in line:
            raise ImageManifestError("registry response header framing is invalid")
        name, value = line.split(":", 1)
        fields.setdefault(name.strip().lower(), []).append(value.strip())
    content_types = fields.get("content-type", [])
    returned_digests = fields.get("docker-content-digest", [])
    if len(content_types) != 1 or len(returned_digests) != 1:
        raise ImageManifestError(
            "registry manifest identity headers must occur exactly once"
        )
    if (
        validate_digest(
            returned_digests[0], "Docker-Content-Digest"
        )
        != expected_digest
    ):
        raise ImageManifestError(
            "registry header digest differs from the requested digest"
        )
    return content_types[0]


def _descriptor(
    value: Any,
    *,
    media_types: set[str],
    label: str,
) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise ImageManifestError("%s must be an object" % label)
    if value.get("mediaType") not in media_types:
        raise ImageManifestError("%s media type is unsupported" % label)
    validate_digest(value.get("digest"), label + " digest")
    size = value.get("size")
    if isinstance(size, bool) or not isinstance(size, int) or size < 1:
        raise ImageManifestError("%s size is invalid" % label)
    return value


def resolve_root(
    document_bytes: bytes,
    header_bytes: bytes,
    expected_digest: Any,
) -> Mapping[str, str]:
    root_digest = verify_document_digest(
        document_bytes, expected_digest, "build root"
    )
    document = parse_document(document_bytes, "build root")
    media_type = document.get("mediaType")
    returned_media_type = parse_registry_headers(
        header_bytes, root_digest
    )
    if returned_media_type != media_type:
        raise ImageManifestError(
            "registry content type differs from root document media type"
        )
    if document.get("schemaVersion") != 2:
        raise ImageManifestError("build root schema version is unsupported")
    if media_type in IMAGE_MANIFEST_MEDIA_TYPES:
        return {
            "rootDigest": root_digest,
            "rootMediaType": media_type,
            "rootObjectType": "image-manifest",
            "platformManifestDigest": root_digest,
            "platformManifestSize": str(len(document_bytes)),
        }
    if media_type not in IMAGE_INDEX_MEDIA_TYPES:
        raise ImageManifestError(
            "build root is neither an image manifest nor image index"
        )
    manifests = document.get("manifests")
    if not isinstance(manifests, list) or not manifests:
        raise ImageManifestError("image index has no descriptors")
    matches: list[Mapping[str, Any]] = []
    for index, value in enumerate(manifests):
        descriptor = _descriptor(
            value,
            media_types=IMAGE_MANIFEST_MEDIA_TYPES,
            label="index descriptor %d" % index,
        )
        platform = descriptor.get("platform")
        if not isinstance(platform, dict):
            continue
        if (
            platform.get("os") == "linux"
            and platform.get("architecture") == "amd64"
            and platform.get("variant") in (None, "")
        ):
            matches.append(descriptor)
    if len(matches) != 1:
        raise ImageManifestError(
            "image index must contain exactly one Linux/AMD64 image manifest"
        )
    return {
        "rootDigest": root_digest,
        "rootMediaType": media_type,
        "rootObjectType": "image-index",
        "platformManifestDigest": validate_digest(
            matches[0].get("digest"), "platform manifest"
        ),
        "platformManifestSize": str(matches[0]["size"]),
    }


def inspect_platform_manifest(
    document_bytes: bytes,
    header_bytes: bytes,
    expected_digest: Any,
    expected_size: int,
) -> Mapping[str, str]:
    if (
        isinstance(expected_size, bool)
        or not isinstance(expected_size, int)
        or expected_size < 1
        or len(document_bytes) != expected_size
    ):
        raise ImageManifestError(
            "platform manifest size differs from its descriptor"
        )
    manifest_digest = verify_document_digest(
        document_bytes, expected_digest, "platform manifest"
    )
    document = parse_document(document_bytes, "platform manifest")
    media_type = document.get("mediaType")
    if media_type not in IMAGE_MANIFEST_MEDIA_TYPES:
        raise ImageManifestError(
            "platform object is not an image manifest"
        )
    if (
        parse_registry_headers(header_bytes, manifest_digest)
        != media_type
    ):
        raise ImageManifestError(
            "registry content type differs from manifest media type"
        )
    if (
        document.get("schemaVersion") != 2
        or "subject" in document
        or "artifactType" in document
    ):
        raise ImageManifestError(
            "platform image manifest structure is unsupported"
        )
    config = _descriptor(
        document.get("config"),
        media_types=IMAGE_CONFIG_MEDIA_TYPES,
        label="image config descriptor",
    )
    config_digest = validate_digest(
        config.get("digest"), "image config"
    )
    if config_digest == manifest_digest:
        raise ImageManifestError(
            "image manifest digest must differ from its config digest"
        )
    layers = document.get("layers")
    if not isinstance(layers, list) or not layers:
        raise ImageManifestError("platform image manifest has no layers")
    for index, layer in enumerate(layers):
        _descriptor(
            layer,
            media_types=IMAGE_LAYER_MEDIA_TYPES,
            label="image layer %d" % index,
        )
    return {
        "platformManifestDigest": manifest_digest,
        "platformManifestMediaType": media_type,
        "configDigest": config_digest,
        "configMediaType": str(config["mediaType"]),
        "configSize": str(config["size"]),
        "layerCount": str(len(layers)),
    }


def verify_linux_amd64_config(
    config_bytes: bytes,
    config_digest: Any,
    platform_manifest_digest: Any,
    expected_size: int,
    source_commit: str,
    expected_layer_count: int,
) -> None:
    if (
        isinstance(expected_size, bool)
        or not isinstance(expected_size, int)
        or expected_size < 1
        or len(config_bytes) != expected_size
    ):
        raise ImageManifestError(
            "image config size differs from its descriptor"
        )
    if (
        COMMIT_PATTERN.fullmatch(source_commit) is None
        or source_commit == "0" * 40
        or isinstance(expected_layer_count, bool)
        or not isinstance(expected_layer_count, int)
        or expected_layer_count < 1
    ):
        raise ImageManifestError("source or layer identity is invalid")
    validated_config_digest = verify_document_digest(
        config_bytes, config_digest, "image config"
    )
    manifest_digest = validate_digest(
        platform_manifest_digest, "platform manifest"
    )
    if validated_config_digest == manifest_digest:
        raise ImageManifestError(
            "config digest was substituted for the image-manifest digest"
        )
    config = parse_document(config_bytes, "image config")
    if (
        config.get("os") != "linux"
        or config.get("architecture") != "amd64"
        or config.get("variant") not in (None, "")
    ):
        raise ImageManifestError(
            "image config does not prove Linux/AMD64"
        )
    image_config = config.get("config")
    labels = (
        image_config.get("Labels")
        if isinstance(image_config, dict)
        else None
    )
    expected_labels = {
        **EXPECTED_IMAGE_LABELS,
        "org.opencontainers.image.revision": source_commit,
    }
    if not isinstance(labels, dict) or any(
        labels.get(name) != value
        for name, value in expected_labels.items()
    ):
        raise ImageManifestError(
            "image config does not bind the exact source revision"
        )
    if (
        image_config.get("User") != "10001:10001"
        or image_config.get("WorkingDir")
        != "/opt/fabrica/worker"
        or image_config.get("Cmd")
        != ["python", "-m", "sam_worker.server"]
        or image_config.get("ExposedPorts")
        != {"80/tcp": {}}
        or image_config.get("Healthcheck")
        != {"Test": ["NONE"]}
    ):
        raise ImageManifestError(
            "image config runtime directives are not reviewed"
        )
    environment = image_config.get("Env")
    if not isinstance(environment, list):
        raise ImageManifestError(
            "image config environment is unsupported"
        )
    observed_environment: dict[str, str] = {}
    forbidden_environment_markers = (
        "auth",
        "credential",
        "password",
        "private_key",
        "secret",
        "token",
    )
    for assignment in environment:
        if (
            not isinstance(assignment, str)
            or "=" not in assignment
            or "\x00" in assignment
        ):
            raise ImageManifestError(
                "image config environment is unsupported"
            )
        name, value = assignment.split("=", 1)
        if (
            not re.fullmatch(r"[A-Z_][A-Z0-9_]*", name)
            or name in observed_environment
            or any(
                marker in name.lower()
                for marker in forbidden_environment_markers
            )
        ):
            raise ImageManifestError(
                "image config environment contains a forbidden input"
            )
        observed_environment[name] = value
    if any(
        observed_environment.get(name) != value
        for name, value in EXPECTED_RUNTIME_ENVIRONMENT.items()
    ):
        raise ImageManifestError(
            "image config environment is not the reviewed runtime"
        )
    rootfs = config.get("rootfs")
    if (
        not isinstance(rootfs, dict)
        or set(rootfs) != {"type", "diff_ids"}
        or rootfs.get("type") != "layers"
        or not isinstance(rootfs.get("diff_ids"), list)
        or len(rootfs["diff_ids"]) != expected_layer_count
    ):
        raise ImageManifestError(
            "image config rootfs does not match manifest layers"
        )
    for diff_id in rootfs["diff_ids"]:
        validate_digest(diff_id, "rootfs diff ID")

    history = config.get("history")
    if not isinstance(history, list) or not history:
        raise ImageManifestError("image config history is missing")
    materialized_created_by: list[str] = []
    forbidden_history_markers = (
        "--mount=type=secret",
        "--mount=type=ssh",
        "/run/secrets",
        "authorization:",
        "github_token",
        "ghcr_token",
        ".git-credentials",
        "id_rsa",
        "password=",
    )
    for entry in history:
        if (
            not isinstance(entry, dict)
            or not set(entry).issubset(
                {
                    "author",
                    "comment",
                    "created",
                    "created_by",
                    "empty_layer",
                }
            )
            or (
                "empty_layer" in entry
                and not isinstance(entry["empty_layer"], bool)
            )
        ):
            raise ImageManifestError(
                "image config history structure is unsupported"
            )
        for field in ("author", "comment", "created", "created_by"):
            value = entry.get(field)
            if value is not None and (
                not isinstance(value, str)
                or len(value) > 32_768
                or "\x00" in value
            ):
                raise ImageManifestError(
                    "image config history structure is unsupported"
                )
        searchable = " ".join(
            value
            for field in ("author", "comment", "created_by")
            if isinstance((value := entry.get(field)), str)
        ).lower()
        if any(marker in searchable for marker in forbidden_history_markers):
            raise ImageManifestError(
                "image config history contains a forbidden build input"
            )
        if entry.get("empty_layer") is not True:
            materialized_created_by.append(
                str(entry.get("created_by", "")).lower()
            )
    if len(materialized_created_by) != expected_layer_count:
        raise ImageManifestError(
            "image config history does not match manifest layers"
        )
    suffix_length = len(
        EXPECTED_RUNTIME_MATERIALIZED_HISTORY_SUFFIX
    )
    if (
        len(materialized_created_by) < suffix_length
        or any(
            marker not in created_by
            for marker, created_by in zip(
                EXPECTED_RUNTIME_MATERIALIZED_HISTORY_SUFFIX,
                materialized_created_by[-suffix_length:],
            )
        )
    ):
        raise ImageManifestError(
            "image config materialized history does not match "
            "the reviewed runtime graph"
        )


def validate_root_platform_relationship(
    root_digest: Any,
    root_object_type: str,
    platform_manifest_digest: Any,
) -> tuple[str, str]:
    root = validate_digest(root_digest, "build root")
    manifest = validate_digest(
        platform_manifest_digest, "platform manifest"
    )
    if (
        root_object_type == "image-manifest"
        and root != manifest
    ) or (
        root_object_type == "image-index"
        and root == manifest
    ) or root_object_type not in ("image-manifest", "image-index"):
        raise ImageManifestError(
            "build root and platform manifest relationship is invalid"
        )
    return root, manifest


def _read(path: str) -> bytes:
    return Path(path).read_bytes()


def _write_json(path: str, value: Mapping[str, str]) -> None:
    Path(path).write_text(
        json.dumps(
            value,
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def _append_github_output(path: str | None, values: Mapping[str, str]) -> None:
    if path is None:
        return
    with Path(path).open("a", encoding="utf-8", newline="\n") as output:
        for key, value in values.items():
            if not re.fullmatch(r"[a-z0-9_]+", key) or "\n" in value:
                raise ImageManifestError("GitHub output is not scalar")
            output.write("%s=%s\n" % (key, value))


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)

    root = commands.add_parser("resolve-root")
    root.add_argument("--document", required=True)
    root.add_argument("--headers", required=True)
    root.add_argument("--digest", required=True)
    root.add_argument("--output", required=True)
    root.add_argument("--github-output")

    manifest = commands.add_parser("inspect-platform")
    manifest.add_argument("--document", required=True)
    manifest.add_argument("--headers", required=True)
    manifest.add_argument("--digest", required=True)
    manifest.add_argument("--expected-size", required=True, type=int)
    manifest.add_argument("--output", required=True)
    manifest.add_argument("--github-output")

    config = commands.add_parser("verify-config")
    config.add_argument("--document", required=True)
    config.add_argument("--digest", required=True)
    config.add_argument("--manifest-digest", required=True)
    config.add_argument("--expected-size", required=True, type=int)
    config.add_argument("--expected-layer-count", required=True, type=int)
    config.add_argument("--root-digest", required=True)
    config.add_argument("--root-object-type", required=True)
    config.add_argument("--manifest-media-type", required=True)
    config.add_argument("--repository", required=True)
    config.add_argument("--source-commit", required=True)
    config.add_argument("--output", required=True)
    config.add_argument("--github-output")
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    if arguments.command == "resolve-root":
        result = resolve_root(
            _read(arguments.document),
            _read(arguments.headers),
            arguments.digest,
        )
        _write_json(arguments.output, result)
        _append_github_output(
            arguments.github_output,
            {
                "root_digest": result["rootDigest"],
                "root_media_type": result["rootMediaType"],
                "root_object_type": result["rootObjectType"],
                "platform_manifest_digest": result[
                    "platformManifestDigest"
                ],
                "platform_manifest_size": result[
                    "platformManifestSize"
                ],
            },
        )
        return 0
    if arguments.command == "inspect-platform":
        result = inspect_platform_manifest(
            _read(arguments.document),
            _read(arguments.headers),
            arguments.digest,
            arguments.expected_size,
        )
        _write_json(arguments.output, result)
        _append_github_output(
            arguments.github_output,
            {
                "platform_manifest_digest": result[
                    "platformManifestDigest"
                ],
                "platform_manifest_media_type": result[
                    "platformManifestMediaType"
                ],
                "config_digest": result["configDigest"],
                "config_size": result["configSize"],
                "layer_count": result["layerCount"],
            },
        )
        return 0

    if (
        arguments.repository
        != "ghcr.io/moodworks/fabrica-sam-worker"
        or COMMIT_PATTERN.fullmatch(arguments.source_commit) is None
        or arguments.source_commit == "0" * 40
        or arguments.root_object_type
        not in ("image-manifest", "image-index")
        or arguments.manifest_media_type
        not in IMAGE_MANIFEST_MEDIA_TYPES
    ):
        raise ImageManifestError("final image identity input is invalid")
    verify_linux_amd64_config(
        _read(arguments.document),
        arguments.digest,
        arguments.manifest_digest,
        arguments.expected_size,
        arguments.source_commit,
        arguments.expected_layer_count,
    )
    root_digest, manifest_digest = validate_root_platform_relationship(
        arguments.root_digest,
        arguments.root_object_type,
        arguments.manifest_digest,
    )
    result = {
        "repository": arguments.repository,
        "sourceCommit": arguments.source_commit,
        "sourceTag": "%s:%s"
        % (arguments.repository, arguments.source_commit),
        "imageReference": "%s@%s"
        % (arguments.repository, manifest_digest),
        "platform": "linux/amd64",
        "platformManifestDigest": manifest_digest,
        "platformManifestMediaType": arguments.manifest_media_type,
        "configDigest": validate_digest(
            arguments.digest, "image config"
        ),
        "buildRootDigest": root_digest,
        "buildRootObjectType": arguments.root_object_type,
        "buildKitProvenance": "disabled",
        "buildKitSbom": "disabled",
        "attestationClaim": "environment-bound-not-hardware-backed",
    }
    _write_json(arguments.output, result)
    _append_github_output(
        arguments.github_output,
        {
            "image_reference": result["imageReference"],
            "platform_manifest_digest": manifest_digest,
            "platform_manifest_media_type": arguments.manifest_media_type,
            "source_commit": arguments.source_commit,
        },
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ImageManifestError, OSError) as error:
        raise SystemExit("sam-worker-image-identity-invalid: %s" % error) from None
