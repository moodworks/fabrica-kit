from __future__ import annotations

import hashlib
import json
import re
import unittest
from pathlib import Path
from typing import Any

from image_manifest import (
    DOCKER_IMAGE_CONFIG,
    DOCKER_IMAGE_MANIFEST,
    IMAGE_MANIFEST_MEDIA_TYPES,
    OCI_IMAGE_CONFIG,
    OCI_IMAGE_INDEX,
    OCI_IMAGE_MANIFEST,
    ImageManifestError,
    inspect_platform_manifest,
    resolve_root,
    validate_digest,
    validate_root_platform_relationship,
    verify_linux_amd64_config,
)

ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = (
    ROOT / ".github/workflows/publish-sam-worker-ghcr.yml"
)
SOURCE_COMMIT = "e817abacac6eab447c42b0969ec83cadd4d1e7f9"


def encoded(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def digest(data: bytes) -> str:
    return "sha256:" + hashlib.sha256(data).hexdigest()


def headers(media_type: str, value_digest: str) -> bytes:
    return (
        "HTTP/2 200\r\n"
        "content-type: %s\r\n"
        "docker-content-digest: %s\r\n"
        "\r\n" % (media_type, value_digest)
    ).encode("ascii")


def fixture(
    *,
    manifest_media_type: str = OCI_IMAGE_MANIFEST,
    config_media_type: str = OCI_IMAGE_CONFIG,
) -> tuple[bytes, bytes, bytes]:
    config = encoded(
        {
            "architecture": "amd64",
            "config": {
                "Labels": {
                    "org.opencontainers.image.revision": SOURCE_COMMIT,
                    "org.opencontainers.image.source": (
                        "https://github.com/moodworks/fabrica-kit"
                    ),
                }
            },
            "os": "linux",
            "rootfs": {"diff_ids": [], "type": "layers"},
        }
    )
    layer = b"fixture-layer"
    manifest = encoded(
        {
            "config": {
                "digest": digest(config),
                "mediaType": config_media_type,
                "size": len(config),
            },
            "layers": [
                {
                    "digest": digest(layer),
                    "mediaType": (
                        "application/vnd.oci.image.layer.v1.tar+gzip"
                        if manifest_media_type == OCI_IMAGE_MANIFEST
                        else "application/vnd.docker.image.rootfs.diff.tar.gzip"
                    ),
                    "size": len(layer),
                }
            ],
            "mediaType": manifest_media_type,
            "schemaVersion": 2,
        }
    )
    return manifest, config, layer


class ImageManifestTests(unittest.TestCase):
    def test_single_platform_manifest_is_registry_and_config_proven(self) -> None:
        manifest, config, _layer = fixture()
        manifest_digest = digest(manifest)
        root = resolve_root(
            manifest,
            headers(OCI_IMAGE_MANIFEST, manifest_digest),
            manifest_digest,
        )
        self.assertEqual(root["rootObjectType"], "image-manifest")
        self.assertEqual(
            root["platformManifestDigest"], manifest_digest
        )
        inspected = inspect_platform_manifest(
            manifest,
            headers(OCI_IMAGE_MANIFEST, manifest_digest),
            manifest_digest,
            len(manifest),
        )
        self.assertEqual(
            inspected["platformManifestMediaType"],
            OCI_IMAGE_MANIFEST,
        )
        self.assertEqual(inspected["configDigest"], digest(config))
        verify_linux_amd64_config(
            config,
            inspected["configDigest"],
            inspected["platformManifestDigest"],
            len(config),
            SOURCE_COMMIT,
        )

    def test_docker_schema_two_image_manifest_is_accepted_as_platform_manifest(
        self,
    ) -> None:
        manifest, config, _layer = fixture(
            manifest_media_type=DOCKER_IMAGE_MANIFEST,
            config_media_type=DOCKER_IMAGE_CONFIG,
        )
        manifest_digest = digest(manifest)
        inspected = inspect_platform_manifest(
            manifest,
            headers(DOCKER_IMAGE_MANIFEST, manifest_digest),
            manifest_digest,
            len(manifest),
        )
        self.assertEqual(
            inspected["platformManifestMediaType"],
            DOCKER_IMAGE_MANIFEST,
        )
        verify_linux_amd64_config(
            config,
            inspected["configDigest"],
            inspected["platformManifestDigest"],
            len(config),
            SOURCE_COMMIT,
        )

    def test_index_digest_is_never_accepted_without_child_manifest_proof(
        self,
    ) -> None:
        manifest, _config, _layer = fixture()
        manifest_digest = digest(manifest)
        index = encoded(
            {
                "manifests": [
                    {
                        "digest": manifest_digest,
                        "mediaType": OCI_IMAGE_MANIFEST,
                        "platform": {
                            "architecture": "amd64",
                            "os": "linux",
                        },
                        "size": len(manifest),
                    },
                    {
                        "annotations": {
                            "vnd.docker.reference.type": (
                                "attestation-manifest"
                            )
                        },
                        "digest": "sha256:" + "a" * 64,
                        "mediaType": OCI_IMAGE_MANIFEST,
                        "platform": {
                            "architecture": "unknown",
                            "os": "unknown",
                        },
                        "size": 100,
                    },
                ],
                "mediaType": OCI_IMAGE_INDEX,
                "schemaVersion": 2,
            }
        )
        index_digest = digest(index)
        resolved = resolve_root(
            index,
            headers(OCI_IMAGE_INDEX, index_digest),
            index_digest,
        )
        self.assertEqual(resolved["rootObjectType"], "image-index")
        self.assertEqual(
            resolved["platformManifestDigest"], manifest_digest
        )
        with self.assertRaisesRegex(
            ImageManifestError,
            "not an image manifest",
        ):
            inspect_platform_manifest(
                index,
                headers(OCI_IMAGE_INDEX, index_digest),
                index_digest,
                len(index),
            )

    def test_index_requires_exactly_one_linux_amd64_descriptor(self) -> None:
        manifest, _config, _layer = fixture()
        manifest_digest = digest(manifest)
        for case, platforms in (
            (
                "missing",
                [{"architecture": "arm64", "os": "linux"}],
            ),
            (
                "duplicate",
                [
                    {"architecture": "amd64", "os": "linux"},
                    {"architecture": "amd64", "os": "linux"},
                ],
            ),
        ):
            with self.subTest(case=case):
                index = encoded(
                    {
                        "manifests": [
                            {
                                "digest": manifest_digest,
                                "mediaType": OCI_IMAGE_MANIFEST,
                                "platform": platform,
                                "size": len(manifest),
                            }
                            for platform in platforms
                        ],
                        "mediaType": OCI_IMAGE_INDEX,
                        "schemaVersion": 2,
                    }
                )
                index_digest = digest(index)
                with self.assertRaisesRegex(
                    ImageManifestError,
                    "exactly one Linux/AMD64 image manifest",
                ):
                    resolve_root(
                        index,
                        headers(OCI_IMAGE_INDEX, index_digest),
                        index_digest,
                    )

    def test_config_digest_cannot_be_substituted_for_manifest_digest(
        self,
    ) -> None:
        manifest, config, _layer = fixture()
        with self.assertRaisesRegex(
            ImageManifestError,
            "bytes do not match",
        ):
            inspect_platform_manifest(
                manifest,
                headers(OCI_IMAGE_MANIFEST, digest(config)),
                digest(config),
                len(manifest),
            )
        with self.assertRaisesRegex(
            ImageManifestError,
            "substituted",
        ):
            verify_linux_amd64_config(
                config,
                digest(config),
                digest(config),
                len(config),
                SOURCE_COMMIT,
            )

    def test_digest_and_media_type_validation_fail_closed(self) -> None:
        manifest, config, _layer = fixture()
        manifest_digest = digest(manifest)
        for invalid in (
            manifest_digest.upper(),
            "sha256:" + "0" * 64,
            "sha256:" + "a" * 63,
            hashlib.sha256(manifest).hexdigest(),
        ):
            with self.subTest(invalid=invalid):
                with self.assertRaises(ImageManifestError):
                    validate_digest(invalid, "fixture")
        with self.assertRaisesRegex(
            ImageManifestError,
            "content type differs",
        ):
            resolve_root(
                manifest,
                headers(OCI_IMAGE_INDEX, manifest_digest),
                manifest_digest,
            )
        foreign_config = encoded(
            {
                **json.loads(config),
                "architecture": "arm64",
            }
        )
        with self.assertRaisesRegex(
            ImageManifestError,
            "does not prove Linux/AMD64",
        ):
            verify_linux_amd64_config(
                foreign_config,
                digest(foreign_config),
                manifest_digest,
                len(foreign_config),
                SOURCE_COMMIT,
            )

    def test_config_source_revision_must_match_exact_commit(self) -> None:
        manifest, config, _layer = fixture()
        with self.assertRaisesRegex(
            ImageManifestError,
            "exact source revision",
        ):
            verify_linux_amd64_config(
                config,
                digest(config),
                digest(manifest),
                len(config),
                "a" * 40,
            )

    def test_manifest_media_type_allowlist_excludes_indexes_and_configs(
        self,
    ) -> None:
        self.assertEqual(
            IMAGE_MANIFEST_MEDIA_TYPES,
            {OCI_IMAGE_MANIFEST, DOCKER_IMAGE_MANIFEST},
        )
        self.assertNotIn(OCI_IMAGE_INDEX, IMAGE_MANIFEST_MEDIA_TYPES)
        self.assertNotIn(OCI_IMAGE_CONFIG, IMAGE_MANIFEST_MEDIA_TYPES)

    def test_root_digest_cannot_be_substituted_for_platform_manifest(
        self,
    ) -> None:
        root = "sha256:" + "a" * 64
        child = "sha256:" + "b" * 64
        self.assertEqual(
            validate_root_platform_relationship(
                root, "image-manifest", root
            ),
            (root, root),
        )
        self.assertEqual(
            validate_root_platform_relationship(
                root, "image-index", child
            ),
            (root, child),
        )
        with self.assertRaises(ImageManifestError):
            validate_root_platform_relationship(
                root, "image-manifest", child
            )
        with self.assertRaises(ImageManifestError):
            validate_root_platform_relationship(
                root, "image-index", root
            )


class PublicationWorkflowTests(unittest.TestCase):
    def test_workflow_is_manual_immutable_and_least_privilege(self) -> None:
        source = WORKFLOW.read_text("utf-8")
        self.assertRegex(source, r"(?m)^on:\n  workflow_dispatch:")
        for forbidden in (
            "\n  push:",
            "\n  pull_request:",
            "\n  release:",
            "\n  schedule:",
            "permissions: write-all",
            "persist-credentials: true",
        ):
            self.assertNotIn(forbidden, source)
        self.assertIn(
            "permissions:\n  contents: read\n  packages: write",
            source,
        )
        self.assertIn("persist-credentials: false", source)
        self.assertIn("ref: ${{ inputs.source_commit }}", source)
        checkout_offset = source.index(
            "uses: actions/checkout@"
        )
        input_validation_offset = source.index(
            "- name: Validate immutable source input"
        )
        self.assertLess(input_validation_offset, checkout_offset)
        self.assertEqual(source.count("git rev-parse HEAD"), 2)
        self.assertEqual(
            source.count(
                "git status --porcelain=v1 --untracked-files=all"
            ),
            2,
        )
        self.assertEqual(source.count("git clean -ndx"), 2)
        prebuild_proof = source.rindex("git clean -ndx")
        build_offset = source.index("docker buildx build")
        self.assertLess(prebuild_proof, build_offset)
        self.assertIn("version: v0.25.0", source)
        action_references = re.findall(
            r"(?m)^\s*- uses: ([^\s]+)$", source
        )
        self.assertEqual(
            action_references,
            [
                (
                    "actions/checkout@"
                    "11bd71901bbe5b1630ceea73d27597364c9af683"
                ),
                (
                    "docker/setup-buildx-action@"
                    "e468171a9de216ec08956ac3ada2f0791b6bd435"
                ),
            ],
        )

    def test_workflow_build_and_registry_identity_are_fail_closed(self) -> None:
        source = WORKFLOW.read_text("utf-8")
        for required in (
            "ghcr.io/moodworks/fabrica-sam-worker",
            "--platform linux/amd64",
            "--file services/sam-worker/Dockerfile",
            "--provenance=false",
            "--sbom=false",
            "--metadata-file",
            "containerimage.digest",
            "Docker-Content-Digest",
            "resolve-root",
            "inspect-platform",
            "verify-config",
            "SAM_WORKER_IMAGE_DIGEST",
        ):
            self.assertIn(required, source)
        self.assertNotRegex(
            source,
            r"(?i)(?:tag|image|reference)[^\n]*:latest",
        )
        self.assertEqual(
            source.count("docker buildx build"),
            1,
        )
        self.assertNotIn("docker.io/", source)
        self.assertNotIn("quay.io/", source)


if __name__ == "__main__":
    unittest.main()
