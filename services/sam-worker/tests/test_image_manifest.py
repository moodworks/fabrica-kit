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
    EXPECTED_RUNTIME_ENVIRONMENT,
    EXPECTED_RUNTIME_MATERIALIZED_HISTORY_SUFFIX,
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
PUBLICATION_CLI = ROOT / "services/sam-worker/ghcr_publication.py"
CONTENT_BOUNDARY_CLI = (
    ROOT / "services/sam-worker/image_content_boundary.py"
)
SOURCE_COMMIT = "e817abacac6eab447c42b0969ec83cadd4d1e7f9"
RUNTIME_LAYER_COUNT = len(
    EXPECTED_RUNTIME_MATERIALIZED_HISTORY_SUFFIX
)


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
                "Cmd": ["python", "-m", "sam_worker.server"],
                "Env": [
                    "%s=%s" % item
                    for item in sorted(
                        EXPECTED_RUNTIME_ENVIRONMENT.items()
                    )
                ],
                "ExposedPorts": {"80/tcp": {}},
                "Healthcheck": {"Test": ["NONE"]},
                "Labels": {
                    "io.fabrica.build-contract.version": (
                        "fabrica-sam-ghcr-linux-amd64-v1"
                    ),
                    "io.fabrica.image-use": (
                        "pinned-digest-deployment-only-v1"
                    ),
                    "io.fabrica.sam.worker-image-digest-env": (
                        "SAM_WORKER_IMAGE_DIGEST"
                    ),
                    "io.fabrica.sam.worker-image-object": (
                        "linux-amd64-image-manifest-v1"
                    ),
                    "org.opencontainers.image.revision": SOURCE_COMMIT,
                    "org.opencontainers.image.source": (
                        "https://github.com/moodworks/fabrica-kit"
                    ),
                },
                "User": "10001:10001",
                "WorkingDir": "/opt/fabrica/worker",
            },
            "history": [
                {"created_by": marker}
                for marker in (
                    EXPECTED_RUNTIME_MATERIALIZED_HISTORY_SUFFIX
                )
            ],
            "os": "linux",
            "rootfs": {
                "diff_ids": [
                    "sha256:" + ("%064x" % index)
                    for index in range(
                        1,
                        RUNTIME_LAYER_COUNT + 1,
                    )
                ],
                "type": "layers",
            },
        }
    )
    layers = [
        ("fixture-layer-%d" % index).encode("ascii")
        for index in range(
            len(EXPECTED_RUNTIME_MATERIALIZED_HISTORY_SUFFIX)
        )
    ]
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
                for layer in layers
            ],
            "mediaType": manifest_media_type,
            "schemaVersion": 2,
        }
    )
    return manifest, config, layers[0]


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
        layer_count = len(
            EXPECTED_RUNTIME_MATERIALIZED_HISTORY_SUFFIX
        )
        self.assertEqual(
            inspected["layerCount"],
            str(layer_count),
        )
        verify_linux_amd64_config(
            config,
            inspected["configDigest"],
            inspected["platformManifestDigest"],
            len(config),
            SOURCE_COMMIT,
            layer_count,
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
            len(EXPECTED_RUNTIME_MATERIALIZED_HISTORY_SUFFIX),
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
                len(EXPECTED_RUNTIME_MATERIALIZED_HISTORY_SUFFIX),
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
                len(EXPECTED_RUNTIME_MATERIALIZED_HISTORY_SUFFIX),
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
                len(EXPECTED_RUNTIME_MATERIALIZED_HISTORY_SUFFIX),
            )

    def test_config_rootfs_and_history_must_match_manifest_layers(
        self,
    ) -> None:
        manifest, config, _layer = fixture()
        values = json.loads(config)
        cases = {
            "missing-rootfs": {
                key: value
                for key, value in values.items()
                if key != "rootfs"
            },
            "wrong-diff-count": {
                **values,
                "rootfs": {"diff_ids": [], "type": "layers"},
            },
            "missing-history": {
                key: value
                for key, value in values.items()
                if key != "history"
            },
            "materialized-history-mismatch": {
                **values,
                "history": [
                    {
                        "created_by": "LABEL reviewed",
                        "empty_layer": True,
                    }
                ],
            },
        }
        for case, value in cases.items():
            with self.subTest(case=case):
                changed = encoded(value)
                with self.assertRaises(ImageManifestError):
                    verify_linux_amd64_config(
                        changed,
                        digest(changed),
                        digest(manifest),
                        len(changed),
                        SOURCE_COMMIT,
                        RUNTIME_LAYER_COUNT,
                    )

    def test_config_history_rejects_secret_or_ssh_build_mounts(
        self,
    ) -> None:
        manifest, config, _layer = fixture()
        for created_by in (
            "RUN --mount=type=secret,id=token true",
            "RUN --mount=type=ssh true",
            "RUN cp /run/secrets/token /tmp/token",
        ):
            with self.subTest(created_by=created_by):
                value = json.loads(config)
                value["history"] = [{"created_by": created_by}]
                changed = encoded(value)
                with self.assertRaisesRegex(
                    ImageManifestError,
                    "forbidden build input",
                ):
                    verify_linux_amd64_config(
                        changed,
                        digest(changed),
                        digest(manifest),
                        len(changed),
                        SOURCE_COMMIT,
                        RUNTIME_LAYER_COUNT,
                    )

    def test_config_runtime_directives_and_environment_are_bound(
        self,
    ) -> None:
        manifest, config, _layer = fixture()
        cases: dict[str, Any] = {}
        wrong_command = json.loads(config)
        wrong_command["config"]["Cmd"] = ["sh"]
        cases["command"] = wrong_command
        wrong_user = json.loads(config)
        wrong_user["config"]["User"] = "0:0"
        cases["user"] = wrong_user
        enabled_healthcheck = json.loads(config)
        enabled_healthcheck["config"]["Healthcheck"] = {
            "Test": ["CMD", "true"]
        }
        cases["healthcheck"] = enabled_healthcheck
        missing_offline = json.loads(config)
        missing_offline["config"]["Env"] = [
            value
            for value in missing_offline["config"]["Env"]
            if not value.startswith("PIP_NO_INDEX=")
        ]
        cases["offline-environment"] = missing_offline
        credential_environment = json.loads(config)
        credential_environment["config"]["Env"].append(
            "GITHUB_TOKEN=synthetic"
        )
        cases["credential-environment"] = credential_environment
        for case, value in cases.items():
            with self.subTest(case=case):
                changed = encoded(value)
                with self.assertRaises(ImageManifestError):
                    verify_linux_amd64_config(
                        changed,
                        digest(changed),
                        digest(manifest),
                        len(changed),
                        SOURCE_COMMIT,
                        RUNTIME_LAYER_COUNT,
                    )

    def test_materialized_history_suffix_binds_reviewed_runtime_graph(
        self,
    ) -> None:
        manifest, config, _layer = fixture()
        value = json.loads(config)
        value["history"][-1]["created_by"] = (
            "unreviewed runtime materialization"
        )
        changed = encoded(value)
        with self.assertRaisesRegex(
            ImageManifestError,
            "reviewed runtime graph",
        ):
            verify_linux_amd64_config(
                changed,
                digest(changed),
                digest(manifest),
                len(changed),
                SOURCE_COMMIT,
                RUNTIME_LAYER_COUNT,
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
        build_offset = source.index(
            "--file services/sam-worker/Dockerfile"
        )
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

    def test_workflow_has_one_publication_and_no_bootstrap_or_latest_tag(
        self,
    ) -> None:
        source = WORKFLOW.read_text("utf-8")
        cli_source = PUBLICATION_CLI.read_text("utf-8")
        for required in (
            "ghcr.io/moodworks/fabrica-sam-worker",
            "--platform linux/amd64",
            "--file services/sam-worker/Dockerfile",
            "--provenance=false",
            "--sbom=false",
            "--metadata-file",
            "image_content_boundary.py",
            "ghcr_publication.py",
            "verify-image",
        ):
            self.assertIn(required, source)
        for required in (
            "containerimage.digest",
            "docker-content-digest",
            "resolve_root",
            "inspect_platform_manifest",
            "verify_linux_amd64_config",
            "validate_root_platform_relationship",
            "SAM_WORKER_IMAGE_DIGEST",
            "visibility\") != \"public\"",
            "_verify_anonymous_public_identity",
            "_parse_anonymous_bearer_challenge",
            "www-authenticate",
            "ANONYMOUS_PULL_SCOPE",
            "/manifests/latest",
        ):
            self.assertIn(required, cli_source)
        self.assertNotRegex(
            source,
            r"(?i)(?:tag|image|reference)[^\n]*:latest",
        )
        self.assertEqual(
            source.count("docker buildx build"),
            1,
        )
        self.assertEqual(source.count("--push"), 1)
        self.assertEqual(
            source.count(
                "--file services/sam-worker/Dockerfile"
            ),
            1,
        )
        self.assertEqual(
            source.count(
                '--tag "${IMAGE_REPOSITORY}:${SOURCE_COMMIT}"'
            ),
            1,
        )
        self.assertNotIn("docker.io/", source)
        self.assertNotIn("quay.io/", source)
        for forbidden in (
            "bootstrap",
            "package-preflight",
            "package-confirm",
            "private",
            "sam-worker-registry-token",
            "print(token)",
            "::add-mask::",
            "python -c",
            "curl ",
        ):
            self.assertNotIn(forbidden, source)
        for forbidden in (
            'method="PATCH"',
            'method="DELETE"',
            "print(registry_token)",
            "write_text(registry_token",
        ):
            self.assertNotIn(forbidden, cli_source)

    def test_content_boundary_precedes_authentication_and_build(
        self,
    ) -> None:
        source = WORKFLOW.read_text("utf-8")
        boundary = source.index(
            "- name: Verify closed SAM image-content boundary"
        )
        authentication = source.index(
            "- name: Authenticate only to GHCR"
        )
        worker_build = source.index(
            "- name: Build and publish one Linux AMD64 SAM worker image"
        )
        verification = source.index(
            "- name: Verify public Linux AMD64 image identity"
        )
        self.assertLess(boundary, authentication)
        self.assertLess(authentication, worker_build)
        self.assertLess(worker_build, verification)

    def test_host_verifiers_are_not_worker_image_artifacts(self) -> None:
        dockerfile = (
            ROOT / "services/sam-worker/Dockerfile"
        ).read_text("utf-8")
        dockerignore = (
            ROOT / "services/sam-worker/Dockerfile.dockerignore"
        ).read_text("utf-8")
        self.assertNotIn("ghcr_publication.py", dockerfile)
        self.assertNotIn(
            "!services/sam-worker/ghcr_publication.py",
            dockerignore,
        )
        self.assertNotIn("image_content_boundary.py", dockerfile)
        self.assertNotIn(
            "!services/sam-worker/image_content_boundary.py",
            dockerignore,
        )
        for path in (PUBLICATION_CLI, CONTENT_BOUNDARY_CLI):
            with self.subTest(path=path.name):
                self.assertEqual(
                    path.stat().st_mode & 0o111,
                    0o111,
                )
                self.assertTrue(
                    path.read_bytes().startswith(
                        b"#!/usr/bin/env python3\n"
                    )
                )

    def test_publication_verifier_has_no_write_methods_or_token_files(
        self,
    ) -> None:
        source = PUBLICATION_CLI.read_text("utf-8")
        for forbidden in (
            'method="PATCH"',
            'method="POST"',
            'method="PUT"',
            'method="DELETE"',
            "print(registry_token)",
            "write_text(registry_token",
            "package-preflight",
            "package-confirm",
            "bootstrap_required",
        ):
            self.assertNotIn(forbidden, source)
        self.assertIn(
            "Authorization\": \"Bearer \" + registry_token",
            source,
        )
        unauthenticated_start = source.index(
            "def _unauthenticated_registry_get("
        )
        unauthenticated_end = source.index(
            "\ndef _anonymous_bearer_registry_get(",
            unauthenticated_start,
        )
        self.assertNotIn(
            "Authorization",
            source[
                unauthenticated_start:unauthenticated_end
            ],
        )
        token_start = source.index(
            "def _anonymous_registry_token("
        )
        token_end = source.index(
            "\ndef _authenticated_registry_get(",
            token_start,
        )
        self.assertNotIn(
            "Authorization",
            source[token_start:token_end],
        )
        bearer_start = source.index(
            "def _anonymous_bearer_registry_get("
        )
        bearer_end = source.index(
            "\ndef _parse_anonymous_bearer_challenge(",
            bearer_start,
        )
        self.assertIn(
            "Authorization",
            source[bearer_start:bearer_end],
        )


if __name__ == "__main__":
    unittest.main()
