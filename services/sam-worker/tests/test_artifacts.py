from __future__ import annotations

import copy
import hashlib
import io
import json
import os
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Mapping, Sequence
from unittest.mock import patch

from sam_worker.artifacts import (
    REVIEWED_ARTIFACT_MANIFEST_SHA256,
    ArtifactError,
    _empty_or_create_directory,
    audit_wheel,
    audit_archive_safety,
    audit_checkpoint_structure,
    canonical_json,
    load_reviewed_manifest,
    manifest_self_digest,
    parse_dependency_lock,
    parse_wheelhouse_inventory,
    path_content_tree_digest,
    preflight_runtime_artifacts,
    scan_runtime_source_tree,
    strict_json_bytes,
    validate_reviewed_manifest,
    verify_base_metadata_files,
    verify_base_image_selection,
    verify_build_input_artifacts,
    verify_dependency_build_ready,
    verify_file_identity,
    verify_license_directory,
)

ROOT = Path(__file__).resolve().parents[3]
MANIFEST_PATH = ROOT / "services/sam-worker/artifact-manifest.json"
VALID_NOW = datetime(2026, 7, 19, tzinfo=timezone.utc)


def manifest() -> dict[str, Any]:
    return json.loads(MANIFEST_PATH.read_text("utf-8"))


def resign(value: dict[str, Any]) -> dict[str, Any]:
    value["manifestSha256"] = manifest_self_digest(value)
    return value


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def add_tar_directory(archive: tarfile.TarFile, name: str) -> None:
    info = tarfile.TarInfo(name)
    info.type = tarfile.DIRTYPE
    info.mode = 0o755
    info.size = 0
    archive.addfile(info)


def add_tar_file(archive: tarfile.TarFile, name: str, data: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.type = tarfile.REGTYPE
    info.mode = 0o644
    info.size = len(data)
    archive.addfile(info, io.BytesIO(data))


def add_tar_symlink(
    archive: tarfile.TarFile, name: str, target: str
) -> None:
    info = tarfile.TarInfo(name)
    info.type = tarfile.SYMTYPE
    info.mode = 0o777
    info.size = 0
    info.linkname = target
    archive.addfile(info)


def make_tar(
    path: Path,
    extra: Sequence[tuple[str, str, bytes | str]] = (),
    *,
    include_default_link: bool = True,
) -> None:
    with tarfile.open(path, "w:gz") as archive:
        add_tar_directory(archive, "root")
        add_tar_directory(archive, "root/sam2")
        add_tar_file(archive, "root/sam2/target.txt", b"target")
        if include_default_link:
            add_tar_symlink(
                archive, "root/sam2/link.txt", "target.txt"
            )
        for kind, name, payload in extra:
            if kind == "directory":
                add_tar_directory(archive, name)
            elif kind == "file":
                assert isinstance(payload, bytes)
                add_tar_file(archive, name, payload)
            elif kind == "symlink":
                assert isinstance(payload, str)
                add_tar_symlink(archive, name, payload)
            elif kind == "hardlink":
                assert isinstance(payload, str)
                info = tarfile.TarInfo(name)
                info.type = tarfile.LNKTYPE
                info.linkname = payload
                info.size = 0
                archive.addfile(info)
            elif kind == "fifo":
                info = tarfile.TarInfo(name)
                info.type = tarfile.FIFOTYPE
                info.size = 0
                archive.addfile(info)
            else:
                raise AssertionError("unknown synthetic tar kind")


def make_checkpoint_zip(
    path: Path,
    *,
    root: str = "root",
    omit: str | None = None,
    extra: str | None = None,
    compressed: str | None = None,
    symlink: str | None = None,
) -> dict[str, Any]:
    members: list[tuple[str, bytes]] = [
        (f"{root}/data.pkl", b"pickle"),
        (f"{root}/byteorder", b"little"),
        (f"{root}/version", b"3"),
        (f"{root}/.data/serialization_id", b"serialization-id"),
        *[
            (
                f"{root}/data/{index}",
                b"crc-unique-payload" if index == 0 else b"",
            )
            for index in range(615)
        ],
    ]
    if omit is not None:
        members = [member for member in members if member[0] != omit]
    if extra is not None:
        members.append((extra, b"foreign"))
    with zipfile.ZipFile(path, "w") as archive:
        for name, payload in members:
            info = zipfile.ZipInfo(name)
            info.compress_type = (
                zipfile.ZIP_DEFLATED
                if name == compressed
                else zipfile.ZIP_STORED
            )
            if name == symlink:
                info.external_attr = (stat.S_IFLNK | 0o777) << 16
            else:
                info.external_attr = (stat.S_IFREG | 0o600) << 16
            archive.writestr(info, payload)
    return {
        "root": root,
        "entryCount": 619,
        "storedPayloadBytes": sum(
            len(payload)
            for name, payload in [
                (f"{root}/data.pkl", b"pickle"),
                (f"{root}/byteorder", b"little"),
                (f"{root}/version", b"3"),
                (f"{root}/.data/serialization_id", b"serialization-id"),
                *[
                    (
                        f"{root}/data/{index}",
                        b"crc-unique-payload" if index == 0 else b"",
                    )
                    for index in range(615)
                ],
            ]
        ),
        "dataPklByteSize": 6,
    }


def make_wheel(
    path: Path,
    *,
    distribution: str = "demo_pkg",
    metadata_name: str = "demo-pkg",
    version: str = "1.2.3",
    namespace: str = "demo_pkg",
) -> None:
    dist_info = f"{distribution}-{version}.dist-info"
    members = {
        f"{namespace}/__init__.py": b"VALUE = 1\n",
        f"{dist_info}/METADATA": (
            "Metadata-Version: 2.1\n"
            f"Name: {metadata_name}\n"
            f"Version: {version}\n\n"
        ).encode("utf-8"),
        f"{dist_info}/WHEEL": (
            "Wheel-Version: 1.0\n"
            "Generator: fabrica-synthetic-test\n"
            "Root-Is-Purelib: true\n"
            "Tag: py3-none-any\n\n"
        ).encode("utf-8"),
        f"{dist_info}/RECORD": b"",
    }
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in members.items():
            info = zipfile.ZipInfo(name)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = (stat.S_IFREG | 0o600) << 16
            archive.writestr(info, data)


class ReviewedManifestTests(unittest.TestCase):
    def test_tracked_manifest_is_strict_self_digesting_and_current(self) -> None:
        reviewed = load_reviewed_manifest(MANIFEST_PATH, now=VALID_NOW)
        self.assertEqual(
            reviewed["manifestSha256"],
            REVIEWED_ARTIFACT_MANIFEST_SHA256,
        )
        self.assertEqual(
            manifest_self_digest(reviewed),
            REVIEWED_ARTIFACT_MANIFEST_SHA256,
        )
        self.assertEqual(
            set(reviewed),
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
        )

    def test_strict_json_rejects_duplicate_keys_nonfinite_bom_and_size(self) -> None:
        for data in (
            b'{"manifestVersion":1,"manifestVersion":1}',
            b'{"value":NaN}',
            b"\xef\xbb\xbf{}",
            b" " * 64_001,
        ):
            with self.subTest(data=data[:30]):
                with self.assertRaises(ArtifactError):
                    strict_json_bytes(data)

    def test_unknown_missing_and_wrong_types_fail_with_valid_self_digest(self) -> None:
        mutations = []
        unknown = manifest()
        unknown["foreign"] = True
        mutations.append(unknown)
        missing = manifest()
        del missing["model"]
        mutations.append(missing)
        wrong_type = manifest()
        wrong_type["repository"]["archive"]["byteSize"] = True
        mutations.append(wrong_type)
        boolean_version = manifest()
        boolean_version["manifestVersion"] = True
        mutations.append(boolean_version)
        uppercase_digest = manifest()
        uppercase_digest["config"]["sha256"] = (
            uppercase_digest["config"]["sha256"].upper()
        )
        mutations.append(uppercase_digest)
        zero_digest = manifest()
        zero_digest["config"]["sha256"] = "0" * 64
        mutations.append(zero_digest)
        for mutated in mutations:
            with self.subTest(keys=set(mutated)):
                resign(mutated)
                with self.assertRaises(ArtifactError):
                    validate_reviewed_manifest(
                        mutated,
                        expected_self_digest=None,
                        now=VALID_NOW,
                    )

    def test_self_digest_and_reviewed_identity_both_fail_closed(self) -> None:
        drifted = manifest()
        drifted["repository"]["archive"]["sha256"] = "1" * 64
        with self.assertRaisesRegex(ArtifactError, "self-digest"):
            validate_reviewed_manifest(drifted, now=VALID_NOW)

        resign(drifted)
        with self.assertRaisesRegex(ArtifactError, "reviewed identity"):
            validate_reviewed_manifest(drifted, now=VALID_NOW)
        with self.assertRaisesRegex(ArtifactError, "archive identity"):
            validate_reviewed_manifest(
                drifted,
                expected_self_digest=None,
                now=VALID_NOW,
            )

    def test_evidence_window_fails_at_exact_expiry(self) -> None:
        expires = datetime(2026, 8, 18, 19, 31, 18, tzinfo=timezone.utc)
        with self.assertRaisesRegex(ArtifactError, "not currently valid"):
            load_reviewed_manifest(MANIFEST_PATH, now=expires)
        with self.assertRaises(ArtifactError):
            load_reviewed_manifest(
                MANIFEST_PATH,
                now=datetime(2026, 7, 18, 19, 31, 17, tzinfo=timezone.utc),
            )

    def test_reviewed_manifest_must_be_a_regular_non_symlink_file(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "target.json"
            target.write_bytes(MANIFEST_PATH.read_bytes())
            link = root / "manifest.json"
            link.symlink_to(target)
            with self.assertRaisesRegex(ArtifactError, "regular file"):
                load_reviewed_manifest(link, now=VALID_NOW)

    def test_exact_observed_identities_and_provenance_are_bound(self) -> None:
        reviewed = load_reviewed_manifest(MANIFEST_PATH, now=VALID_NOW)
        archive = reviewed["repository"]["archive"]
        runtime = reviewed["repository"]["runtimeSourceTree"]
        checkpoint = reviewed["checkpoint"]
        self.assertEqual(archive["byteSize"], 55_631_013)
        self.assertEqual(
            archive["sha256"],
            "92c9e7ca3102fb8ef5953b0e80063a9ae77eb3d80fc54c498c1c6e2f71903dd6",
        )
        self.assertEqual(
            runtime["sha256"],
            "66821e0f05bd53a04cee682c0e0b131f47fcea3b427522b1ff0ecc69c8be862a",
        )
        self.assertNotEqual(
            runtime["sha256"],
            "54b3c7cb542997671b5af0bf8f3f26c1498b68fc28ba7b01b54e11a66ad8db29",
        )
        self.assertNotIn(
            "967e28b440710369bd64bf53c7883d8c1a62b79ea0b3367e9bc2acccb4f8ea89",
            json.dumps(reviewed),
        )
        self.assertEqual(checkpoint["byteSize"], 323_606_802)
        self.assertEqual(
            checkpoint["sha256"],
            "a2345aede8715ab1d5d31b4a509fb160c5a4af1970f199d9054ccfb746c004c5",
        )
        self.assertEqual(
            checkpoint["sha256Provenance"],
            "Fabrica-observed SHA-256 from two byte-identical official-source downloads",
        )
        self.assertFalse(
            checkpoint["structuralObservation"][
                "semanticOrTensorSafetyClaim"
            ]
        )
        self.assertEqual(
            reviewed["repository"]["archive"]["sha256Provenance"],
            checkpoint["sha256Provenance"],
        )
        self.assertEqual(
            reviewed["config"]["sha256Provenance"],
            checkpoint["sha256Provenance"],
        )
        self.assertFalse(reviewed["evidence"]["artifactExecutionOccurred"])
        self.assertFalse(reviewed["evidence"]["modelInferenceOccurred"])
        self.assertEqual(
            reviewed["imageLocations"],
            {
                "manifest": "/opt/fabrica/sam/artifact-manifest.json",
                "runtimeSourceRoot": "/opt/fabrica/sam2-source",
                "config": "/opt/fabrica/sam2-source/sam2/configs/"
                "sam2.1/sam2.1_hiera_b+.yaml",
                "checkpoint": "/opt/fabrica/sam/checkpoints/"
                "sam2.1_hiera_base_plus.pt",
                "licenseRoot": "/opt/fabrica/sam/licenses",
            },
        )
        self.assertEqual(
            [
                license_value["imagePath"]
                for license_value in reviewed["licenses"]["runtime"]
            ],
            [
                "/opt/fabrica/sam/licenses/LICENSE",
                "/opt/fabrica/sam/licenses/LICENSE_cctorch",
            ],
        )
        self.assertEqual(
            reviewed["baseImage"]["pythonIdentity"],
            {
                "requiredCompatibility": "CPython 3.11.x",
                "patch": None,
                "evidenceStatus": "future-build-assertion-required",
                "patchStatus": "retained-oci-metadata-does-not-expose-"
                "exact-patch",
                "futureBuildAssertion": "assert-and-record-exact-patch-"
                "during-separately-authorized-build",
            },
        )
        self.assertEqual(
            reviewed["baseImage"]["cudnnTagIdentity"], 9
        )
        self.assertEqual(
            reviewed["dependencies"]["buildStatus"],
            "unresolved-deployment-time-blocking",
        )
        self.assertFalse(
            reviewed["dependencies"]["acquisitionOccurred"]
        )
        self.assertIsNone(
            reviewed["dependencies"]["requirementsLock"]["sha256"]
        )
        self.assertIsNone(
            reviewed["dependencies"]["wheelhouseInventory"]["sha256"]
        )

    def test_repository_base_and_license_cross_bindings_fail_closed(self) -> None:
        mutations = []
        repository = manifest()
        repository["repository"]["commit"] = "1" * 40
        mutations.append(repository)
        config = manifest()
        config["config"]["runtimeIdentity"] = "configs/foreign.yaml"
        mutations.append(config)
        base_tag = manifest()
        base_tag["baseImage"]["tag"] = "latest"
        mutations.append(base_tag)
        base_platform = manifest()
        base_platform["baseImage"]["platform"] = "linux/arm64"
        mutations.append(base_platform)
        license_reason = manifest()
        license_reason["licenses"]["runtime"][1]["requiredBecause"] = (
            "optional"
        )
        mutations.append(license_reason)
        license_path = manifest()
        license_path["licenses"]["runtime"][0]["imagePath"] = (
            "/opt/fabrica/sam/licenses/foreign"
        )
        mutations.append(license_path)
        provenance = manifest()
        provenance["checkpoint"]["sha256Provenance"] = (
            "official publisher digest"
        )
        mutations.append(provenance)
        location = manifest()
        location["imageLocations"]["checkpoint"] = "/foreign/checkpoint.pt"
        mutations.append(location)
        execution = manifest()
        execution["evidence"]["artifactExecutionOccurred"] = True
        mutations.append(execution)
        archive_digest = manifest()
        archive_digest["repository"]["archive"]["sha256"] = "1" * 64
        mutations.append(archive_digest)
        checkpoint_url = manifest()
        checkpoint_url["checkpoint"]["url"] = "https://example.invalid/model"
        mutations.append(checkpoint_url)
        config_size = manifest()
        config_size["config"]["byteSize"] = 3_651
        mutations.append(config_size)
        base_exact = manifest()
        base_exact["baseImage"]["tag"] = "foreign"
        base_exact["baseImage"]["immutableReference"] = (
            "pytorch/pytorch:foreign@sha256:"
            + base_exact["baseImage"]["manifestSha256"]
        )
        mutations.append(base_exact)
        python_patch = manifest()
        python_patch["baseImage"]["pythonIdentity"]["patch"] = 7
        mutations.append(python_patch)
        dependency_status = manifest()
        dependency_status["dependencies"]["buildStatus"] = (
            "reviewed-wheel-only-ready"
        )
        mutations.append(dependency_status)
        for mutated in mutations:
            resign(mutated)
            with self.subTest(mutated=mutated):
                with self.assertRaises(ArtifactError):
                    validate_reviewed_manifest(
                        mutated,
                        expected_self_digest=None,
                        now=VALID_NOW,
                    )

    def test_exact_base_reference_and_platform_are_required(self) -> None:
        reviewed = load_reviewed_manifest(MANIFEST_PATH, now=VALID_NOW)
        base = reviewed["baseImage"]
        verify_base_image_selection(
            reviewed, base["immutableReference"], "linux/amd64"
        )
        for reference, platform in (
            (base["immutableReference"] + "-foreign", "linux/amd64"),
            (base["immutableReference"], "linux/arm64"),
        ):
            with self.assertRaises(ArtifactError):
                verify_base_image_selection(reviewed, reference, platform)


class FileAndLicenseTests(unittest.TestCase):
    def test_file_size_digest_type_and_symlink_mutations_fail(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            artifact = root / "artifact.bin"
            artifact.write_bytes(b"reviewed")
            verify_file_identity(
                artifact, len(b"reviewed"), sha256(b"reviewed"), "Fixture"
            )
            artifact.write_bytes(b"drifted!")
            with self.assertRaisesRegex(ArtifactError, "digest"):
                verify_file_identity(
                    artifact,
                    len(b"reviewed"),
                    sha256(b"reviewed"),
                    "Fixture",
                )
            artifact.write_bytes(b"x")
            with self.assertRaisesRegex(ArtifactError, "byte size"):
                verify_file_identity(
                    artifact,
                    len(b"reviewed"),
                    sha256(b"reviewed"),
                    "Fixture",
                )
            artifact.unlink()
            target = root / "target"
            target.write_bytes(b"reviewed")
            artifact.symlink_to(target)
            with self.assertRaisesRegex(ArtifactError, "non-symlink"):
                verify_file_identity(
                    artifact,
                    len(b"reviewed"),
                    sha256(b"reviewed"),
                    "Fixture",
                )

    def test_license_directory_requires_exact_regular_files(self) -> None:
        specs = [
            {
                "imageName": "LICENSE",
                "byteSize": 3,
                "sha256": sha256(b"aaa"),
            },
            {
                "imageName": "LICENSE_cctorch",
                "byteSize": 3,
                "sha256": sha256(b"bbb"),
            },
        ]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "LICENSE").write_bytes(b"aaa")
            (root / "LICENSE_cctorch").write_bytes(b"bbb")
            verify_license_directory(root, specs)

            (root / "LICENSE_cctorch").unlink()
            with self.assertRaises(ArtifactError):
                verify_license_directory(root, specs)
            (root / "LICENSE_cctorch").write_bytes(b"bbb")
            (root / "NOTICE").write_bytes(b"foreign")
            with self.assertRaisesRegex(ArtifactError, "inventory"):
                verify_license_directory(root, specs)
            (root / "NOTICE").unlink()
            (root / "LICENSE_cctorch").write_bytes(b"ccc")
            with self.assertRaisesRegex(ArtifactError, "digest"):
                verify_license_directory(root, specs)

    def test_light_preflight_checks_presence_sizes_and_license_inventory_only(
        self,
    ) -> None:
        synthetic = {
            "config": {
                "repositoryPath": "sam2/config.yaml",
                "byteSize": 3,
            },
            "upstreamLoader": {
                "repositoryPath": "sam2/build_sam.py",
                "byteSize": 4,
            },
            "checkpoint": {"byteSize": 5},
            "licenses": {
                "runtime": [
                    {"imageName": "LICENSE", "byteSize": 6},
                    {"imageName": "LICENSE_cctorch", "byteSize": 7},
                ]
            },
        }
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            (source / "sam2").mkdir(parents=True)
            (source / "sam2/config.yaml").write_bytes(b"123")
            (source / "sam2/build_sam.py").write_bytes(b"1234")
            checkpoint = root / "checkpoint.pt"
            checkpoint.write_bytes(b"12345")
            licenses = root / "licenses"
            licenses.mkdir()
            (licenses / "LICENSE").write_bytes(b"123456")
            (licenses / "LICENSE_cctorch").write_bytes(b"1234567")
            with (
                patch(
                    "sam_worker.artifacts.load_reviewed_manifest",
                    return_value=synthetic,
                ),
                patch(
                    "sam_worker.artifacts.file_sha256",
                    side_effect=AssertionError(
                        "light preflight must not hash large artifacts"
                    ),
                ),
            ):
                self.assertIs(
                    preflight_runtime_artifacts(
                        manifest_path=root / "manifest.json",
                        source_root=source,
                        checkpoint_path=checkpoint,
                        licenses_root=licenses,
                    ),
                    synthetic,
                )
                checkpoint.write_bytes(b"drift!")
                with self.assertRaisesRegex(
                    ArtifactError, "type or byte size"
                ):
                    preflight_runtime_artifacts(
                        manifest_path=root / "manifest.json",
                        source_root=source,
                        checkpoint_path=checkpoint,
                        licenses_root=licenses,
                    )


class SourceTreeTests(unittest.TestCase):
    def _source(self, root: Path) -> Mapping[str, str]:
        configs = root / "sam2/configs"
        configs.mkdir(parents=True)
        (configs / "target.yaml").write_bytes(b"source")
        os.symlink(
            "configs/target.yaml",
            root / "sam2/model.yaml",
        )
        return {"sam2/model.yaml": "configs/target.yaml"}

    def test_domain_separated_tree_encoding_matches_independent_formula(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            allowed = self._source(root)
            summary = scan_runtime_source_tree(root, allowed)
            digest = hashlib.sha256()
            digest.update(b"fabrica-path-content-tree-v1\x00")
            file_path = b"sam2/configs/target.yaml"
            digest.update(b"F")
            digest.update(struct.pack(">I", len(file_path)))
            digest.update(file_path)
            digest.update(struct.pack(">Q", len(b"source")))
            digest.update(hashlib.sha256(b"source").digest())
            link_path = b"sam2/model.yaml"
            target = b"configs/target.yaml"
            digest.update(b"L")
            digest.update(struct.pack(">I", len(link_path)))
            digest.update(link_path)
            digest.update(struct.pack(">I", len(target)))
            digest.update(target)
            self.assertEqual(summary["sha256"], digest.hexdigest())
            self.assertEqual(summary["regularFileCount"], 1)
            self.assertEqual(summary["symlinkCount"], 1)
            self.assertEqual(summary["regularFileBytes"], 6)
            self.assertEqual(
                summary["sha256"],
                path_content_tree_digest(
                    [
                        (
                            "L",
                            "sam2/model.yaml",
                            "configs/target.yaml",
                        ),
                        ("F", "sam2/configs/target.yaml", b"source"),
                    ]
                ),
            )

    def test_tree_rejects_extra_entries_target_drift_and_collisions(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            allowed = self._source(root)
            (root / "sam2/extra-empty").mkdir()
            with self.assertRaisesRegex(ArtifactError, "extra entry"):
                scan_runtime_source_tree(root, allowed)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            allowed = self._source(root)
            (root / "sam2/model.yaml").unlink()
            os.symlink("configs/foreign.yaml", root / "sam2/model.yaml")
            with self.assertRaisesRegex(ArtifactError, "allowlist"):
                scan_runtime_source_tree(root, allowed)

        for names, pattern in (
            (("sam2/A", "sam2/a"), "case-colliding"),
            (("sam2/\u00e9", "sam2/e\u0301"), "NFC-colliding"),
        ):
            with self.assertRaisesRegex(ArtifactError, pattern):
                path_content_tree_digest(
                    [
                        ("F", names[0], b"x"),
                        ("F", names[1], b"y"),
                    ]
                )

    def test_tree_rejects_foreign_top_level_and_link_escape(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._source(root)
            (root / "foreign").write_bytes(b"x")
            with self.assertRaisesRegex(ArtifactError, "foreign top-level"):
                scan_runtime_source_tree(
                    root, {"sam2/model.yaml": "configs/target.yaml"}
                )

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "sam2").mkdir()
            (root / "outside").write_bytes(b"x")
            os.symlink("../outside", root / "sam2/model.yaml")
            with self.assertRaises(ArtifactError):
                scan_runtime_source_tree(
                    root, {"sam2/model.yaml": "../outside"}
                )


class ArchiveSafetyTests(unittest.TestCase):
    def test_safe_archive_inventory_and_symlink_target(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "source.tar.gz"
            make_tar(archive)
            summary = audit_archive_safety(
                archive,
                top_level="root",
                allowed_symlinks={"sam2/link.txt": "target.txt"},
                regular_file_byte_limit=100,
            )
            self.assertEqual(
                summary,
                {
                    "entryCount": 4,
                    "regularFileCount": 1,
                    "directoryCount": 2,
                    "symlinkCount": 1,
                    "regularFileBytes": 6,
                    "largestRegularFile": {
                        "path": "sam2/target.txt",
                        "byteSize": 6,
                    },
                    "licenseFamilyPaths": [],
                    "noticeFamilyPaths": [],
                },
            )

    def test_archive_reports_complete_case_sensitive_license_families(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "source.tar.gz"
            make_tar(
                archive,
                [
                    ("file", "root/LICENSE.extra", b"license"),
                    ("file", "root/docs/NOTICE.third-party", b"notice"),
                    ("file", "root/docs/license-lowercase", b"ignored"),
                    ("file", "root/docs/Notice-mixed", b"ignored"),
                ],
            )
            summary = audit_archive_safety(
                archive,
                top_level="root",
                allowed_symlinks={"sam2/link.txt": "target.txt"},
                regular_file_byte_limit=100,
            )
            self.assertEqual(
                summary["licenseFamilyPaths"], ["LICENSE.extra"]
            )
            self.assertEqual(
                summary["noticeFamilyPaths"], ["docs/NOTICE.third-party"]
            )

    def test_archive_rejects_paths_types_sizes_and_symlinks(self) -> None:
        cases = [
            (
                [("file", "root/../escape", b"x")],
                True,
                {"sam2/link.txt": "target.txt"},
                100,
            ),
            (
                [("file", "/absolute", b"x")],
                True,
                {"sam2/link.txt": "target.txt"},
                100,
            ),
            (
                [("hardlink", "root/sam2/hard", "root/sam2/target.txt")],
                True,
                {"sam2/link.txt": "target.txt"},
                100,
            ),
            (
                [("fifo", "root/sam2/fifo", b"")],
                True,
                {"sam2/link.txt": "target.txt"},
                100,
            ),
            (
                [("file", "root/sam2/big", b"x" * 101)],
                True,
                {"sam2/link.txt": "target.txt"},
                100,
            ),
            (
                [("symlink", "root/sam2/escape", "../outside")],
                False,
                {"sam2/escape": "../outside"},
                100,
            ),
            (
                [("symlink", "root/sam2/missing", "missing.txt")],
                False,
                {"sam2/missing": "missing.txt"},
                100,
            ),
            (
                [
                    ("file", "root/sam2/A", b"x"),
                    ("file", "root/sam2/a", b"y"),
                ],
                True,
                {"sam2/link.txt": "target.txt"},
                100,
            ),
            (
                [
                    ("file", "root/sam2/\u00e9", b"x"),
                    ("file", "root/sam2/e\u0301", b"y"),
                ],
                True,
                {"sam2/link.txt": "target.txt"},
                100,
            ),
            (
                [("file", "root/sam2/target.txt", b"duplicate")],
                True,
                {"sam2/link.txt": "target.txt"},
                100,
            ),
        ]
        for index, (extra, include_link, allowed, limit) in enumerate(cases):
            with self.subTest(index=index):
                with tempfile.TemporaryDirectory() as temporary:
                    archive = Path(temporary) / "source.tar.gz"
                    make_tar(
                        archive,
                        extra,
                        include_default_link=include_link,
                    )
                    with self.assertRaises(ArtifactError):
                        audit_archive_safety(
                            archive,
                            top_level="root",
                            allowed_symlinks=allowed,
                            regular_file_byte_limit=limit,
                        )

    def test_archive_rejects_symlink_to_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            archive = Path(temporary) / "source.tar.gz"
            make_tar(
                archive,
                [
                    ("directory", "root/sam2/target-dir", b""),
                    ("symlink", "root/sam2/link-dir", "target-dir"),
                ],
                include_default_link=False,
            )
            with self.assertRaisesRegex(ArtifactError, "not a regular"):
                audit_archive_safety(
                    archive,
                    top_level="root",
                    allowed_symlinks={"sam2/link-dir": "target-dir"},
                    regular_file_byte_limit=100,
                )


class CheckpointStructureTests(unittest.TestCase):
    def test_checkpoint_zip_is_inspected_without_reading_pickle(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            checkpoint = Path(temporary) / "checkpoint.pt"
            structure = make_checkpoint_zip(checkpoint)
            audit_checkpoint_structure(checkpoint, structure)
            with self.assertRaisesRegex(ArtifactError, "drifted"):
                drifted = dict(structure)
                drifted["entryCount"] = 620
                audit_checkpoint_structure(
                    checkpoint,
                    drifted,
                )

    def test_checkpoint_rejects_missing_extra_compressed_and_symlink_members(
        self,
    ) -> None:
        cases = (
            {"omit": "root/byteorder"},
            {"omit": "root/data/614"},
            {"extra": "root/data/615"},
            {"extra": "root/foreign"},
            {"compressed": "root/data/0"},
            {"symlink": "root/data/0"},
        )
        for case in cases:
            with self.subTest(case=case):
                with tempfile.TemporaryDirectory() as temporary:
                    checkpoint = Path(temporary) / "checkpoint.pt"
                    structure = make_checkpoint_zip(checkpoint, **case)
                    with self.assertRaises(ArtifactError):
                        audit_checkpoint_structure(checkpoint, structure)

    def test_checkpoint_rejects_crc_corruption(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            checkpoint = Path(temporary) / "checkpoint.pt"
            structure = make_checkpoint_zip(checkpoint)
            contents = checkpoint.read_bytes()
            marker = b"crc-unique-payload"
            self.assertEqual(contents.count(marker), 1)
            checkpoint.write_bytes(contents.replace(marker, b"x" + marker[1:]))
            with self.assertRaisesRegex(ArtifactError, "CRC"):
                audit_checkpoint_structure(checkpoint, structure)


class DependencyReadyTests(unittest.TestCase):
    def _ready_fixture(
        self,
        root: Path,
        *,
        metadata_name: str = "demo-pkg",
        namespace: str = "demo_pkg",
    ) -> tuple[dict[str, Any], Path, Path, Path]:
        wheelhouse = root / "wheelhouse"
        wheelhouse.mkdir()
        filename = "demo_pkg-1.2.3-py3-none-any.whl"
        wheel = wheelhouse / filename
        make_wheel(
            wheel,
            metadata_name=metadata_name,
            namespace=namespace,
        )
        wheel_digest = sha256(wheel.read_bytes())
        lock_data = (
            "demo-pkg==1.2.3 --hash=sha256:"
            + wheel_digest
            + "\n"
        ).encode("ascii")
        lock_path = root / "requirements.lock"
        lock_path.write_bytes(lock_data)
        inventory_value = {
            "inventoryVersion": 1,
            "inventoryKind": "fabrica-wheel-only-inventory-v1",
            "wheels": [
                {
                    "filename": filename,
                    "byteSize": wheel.stat().st_size,
                    "sha256": wheel_digest,
                }
            ],
        }
        inventory_data = (
            canonical_json(inventory_value) + "\n"
        ).encode("utf-8")
        inventory_path = root / "wheelhouse-inventory.json"
        inventory_path.write_bytes(inventory_data)
        reviewed = copy.deepcopy(manifest())
        reviewed["dependencies"] = {
            **reviewed["dependencies"],
            "acquisitionOccurred": True,
            "buildStatus": "reviewed-wheel-only-ready",
            "requirementsLock": {
                "status": "reviewed",
                "byteSize": len(lock_data),
                "sha256": sha256(lock_data),
            },
            "wheelhouseInventory": {
                "status": "reviewed",
                "byteSize": len(inventory_data),
                "sha256": sha256(inventory_data),
            },
        }
        resign(reviewed)
        return reviewed, lock_path, inventory_path, wheelhouse

    def test_ready_manifest_and_exact_wheel_lock_inventory_pass(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            reviewed, lock_path, inventory_path, wheelhouse = (
                self._ready_fixture(Path(temporary))
            )
            validate_reviewed_manifest(
                reviewed,
                expected_self_digest=None,
                now=VALID_NOW,
            )
            verify_dependency_build_ready(
                reviewed,
                requirements_lock_path=lock_path,
                wheelhouse_inventory_path=inventory_path,
                wheelhouse_root=wheelhouse,
            )

    def test_lock_grammar_rejects_options_urls_extras_markers_and_drift(
        self,
    ) -> None:
        digest = "1" * 64
        invalid_lines = (
            f"demo-pkg @ https://example.invalid/a.whl --hash=sha256:{digest}",
            f"git+https://example.invalid/repo --hash=sha256:{digest}",
            f"-e ./demo --hash=sha256:{digest}",
            "-r other.lock",
            "--index-url https://example.invalid/simple",
            "--extra-index-url https://example.invalid/simple",
            "--find-links ./wheelhouse",
            f"demo-pkg[extra]==1.2.3 --hash=sha256:{digest}",
            f"demo-pkg==1.2.3;python_version>'3' --hash=sha256:{digest}",
            f"demo-pkg-1.2.3.tar.gz --hash=sha256:{digest}",
            f"Demo_Pkg==1.2.3 --hash=sha256:{digest}",
            f"torch==2.5.1 --hash=sha256:{digest}",
            f"nvidia-cublas-cu12==12.4.5 --hash=sha256:{digest}",
        )
        for line in invalid_lines:
            with self.subTest(line=line):
                with self.assertRaises(ArtifactError):
                    parse_dependency_lock((line + "\n").encode("ascii"))
        with self.assertRaisesRegex(ArtifactError, "ordering"):
            parse_dependency_lock(
                (
                    f"z-package==1.0 --hash=sha256:{digest}\n"
                    f"a-package==1.0 --hash=sha256:{digest}\n"
                ).encode("ascii")
            )
        with self.assertRaisesRegex(ArtifactError, "duplicate"):
            parse_dependency_lock(
                (
                    f"a-package==1.0 --hash=sha256:{digest}\n"
                    f"a-package==1.0 --hash=sha256:{digest}\n"
                ).encode("ascii")
            )

    def test_inventory_is_closed_canonical_and_wheel_only(self) -> None:
        value = {
            "inventoryVersion": 1,
            "inventoryKind": "fabrica-wheel-only-inventory-v1",
            "wheels": [
                {
                    "filename": "demo_pkg-1.2.3-py3-none-any.whl",
                    "byteSize": 1,
                    "sha256": "1" * 64,
                }
            ],
        }
        parse_wheelhouse_inventory(
            (canonical_json(value) + "\n").encode("utf-8")
        )
        mutations = []
        unknown = copy.deepcopy(value)
        unknown["foreign"] = True
        mutations.append(unknown)
        sdist = copy.deepcopy(value)
        sdist["wheels"][0]["filename"] = "demo_pkg-1.2.3.tar.gz"
        mutations.append(sdist)
        nested = copy.deepcopy(value)
        nested["wheels"][0]["filename"] = (
            "nested/demo_pkg-1.2.3-py3-none-any.whl"
        )
        mutations.append(nested)
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                with self.assertRaises(ArtifactError):
                    parse_wheelhouse_inventory(
                        (canonical_json(mutation) + "\n").encode("utf-8")
                    )
        with self.assertRaisesRegex(ArtifactError, "canonical"):
            parse_wheelhouse_inventory(
                json.dumps(value, indent=2).encode("utf-8")
            )

    def test_ready_gate_rejects_extra_symlink_mismatch_and_namespaces(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            reviewed, lock_path, inventory_path, wheelhouse = (
                self._ready_fixture(root)
            )
            (wheelhouse / "foreign.whl").write_bytes(b"x")
            with self.assertRaisesRegex(ArtifactError, "inventory"):
                verify_dependency_build_ready(
                    reviewed,
                    requirements_lock_path=lock_path,
                    wheelhouse_inventory_path=inventory_path,
                    wheelhouse_root=wheelhouse,
                )

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            reviewed, lock_path, inventory_path, wheelhouse = (
                self._ready_fixture(root)
            )
            wheel = next(wheelhouse.iterdir())
            target = root / "wheel-target"
            wheel.rename(target)
            wheel.symlink_to(target)
            with self.assertRaisesRegex(ArtifactError, "non-symlink"):
                verify_dependency_build_ready(
                    reviewed,
                    requirements_lock_path=lock_path,
                    wheelhouse_inventory_path=inventory_path,
                    wheelhouse_root=wheelhouse,
                )

        for namespace in (
            "sam_worker",
            "sam2",
            "torch",
            "torchvision",
            "nvidia",
            "triton",
        ):
            with self.subTest(namespace=namespace):
                with tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    reviewed, lock_path, inventory_path, wheelhouse = (
                        self._ready_fixture(root, namespace=namespace)
                    )
                    with self.assertRaisesRegex(
                        ArtifactError, "protected namespace"
                    ):
                        verify_dependency_build_ready(
                            reviewed,
                            requirements_lock_path=lock_path,
                            wheelhouse_inventory_path=inventory_path,
                            wheelhouse_root=wheelhouse,
                        )

    def test_ready_gate_rejects_metadata_and_package_closure_drift(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            reviewed, lock_path, inventory_path, wheelhouse = (
                self._ready_fixture(
                    root, metadata_name="foreign-package"
                )
            )
            with self.assertRaisesRegex(
                ArtifactError, "distribution identity"
            ):
                verify_dependency_build_ready(
                    reviewed,
                    requirements_lock_path=lock_path,
                    wheelhouse_inventory_path=inventory_path,
                    wheelhouse_root=wheelhouse,
                )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            reviewed, lock_path, inventory_path, wheelhouse = (
                self._ready_fixture(root)
            )
            foreign_lock = (
                "foreign-package==1.2.3 --hash=sha256:"
                + "1" * 64
                + "\n"
            ).encode("ascii")
            lock_path.write_bytes(foreign_lock)
            reviewed["dependencies"]["requirementsLock"] = {
                "status": "reviewed",
                "byteSize": len(foreign_lock),
                "sha256": sha256(foreign_lock),
            }
            with self.assertRaisesRegex(
                ArtifactError, "package closure"
            ):
                verify_dependency_build_ready(
                    reviewed,
                    requirements_lock_path=lock_path,
                    wheelhouse_inventory_path=inventory_path,
                    wheelhouse_root=wheelhouse,
                )

    def test_wheel_audit_rejects_foreign_tags_symlinks_and_missing_metadata(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            foreign_tag = (
                root / "demo_pkg-1.2.3-cp310-cp310-win_amd64.whl"
            )
            make_wheel(foreign_tag)
            with self.assertRaisesRegex(ArtifactError, "incompatible"):
                audit_wheel(
                    foreign_tag,
                    expected_filename=foreign_tag.name,
                )

            symlink_wheel = (
                root / "demo_pkg-1.2.3-py3-none-any.whl"
            )
            make_wheel(symlink_wheel)
            with zipfile.ZipFile(
                symlink_wheel, mode="a"
            ) as archive:
                info = zipfile.ZipInfo("foreign-link")
                info.compress_type = zipfile.ZIP_STORED
                info.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(info, b"demo_pkg")
            with self.assertRaisesRegex(ArtifactError, "unsafe"):
                audit_wheel(
                    symlink_wheel,
                    expected_filename=symlink_wheel.name,
                )

            missing_metadata = (
                root / "other_pkg-1.0-py3-none-any.whl"
            )
            with zipfile.ZipFile(missing_metadata, "w") as archive:
                archive.writestr(
                    "other_pkg-1.0.dist-info/WHEEL",
                    b"Wheel-Version: 1.0\n\n",
                )
                archive.writestr(
                    "other_pkg-1.0.dist-info/RECORD",
                    b"",
                )
            with self.assertRaisesRegex(
                ArtifactError, "dist-info inventory"
            ):
                audit_wheel(
                    missing_metadata,
                    expected_filename=missing_metadata.name,
                )

    def test_wheel_audit_allows_glibc_tags_and_rejects_musllinux(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for platform_tag in (
                "linux_x86_64",
                "manylinux2014_x86_64",
                "manylinux_2_17_x86_64",
            ):
                with self.subTest(platform_tag=platform_tag):
                    wheel = root / (
                        "demo_pkg-1.2.3-cp311-cp311-"
                        + platform_tag
                        + ".whl"
                    )
                    make_wheel(wheel)
                    audit_wheel(wheel, expected_filename=wheel.name)
            wheel = (
                root
                / "demo_pkg-1.2.3-cp311-cp311-musllinux_1_2_x86_64.whl"
            )
            make_wheel(wheel)
            with self.assertRaisesRegex(ArtifactError, "incompatible"):
                audit_wheel(wheel, expected_filename=wheel.name)

    def test_wheel_audit_rejects_foreign_dist_info_root(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            wheel = (
                Path(temporary)
                / "demo_pkg-1.2.3-py3-none-any.whl"
            )
            make_wheel(wheel)
            with zipfile.ZipFile(wheel, mode="a") as archive:
                archive.writestr(
                    "foreign_pkg-9.9.dist-info/NOTICE",
                    b"foreign metadata root",
                )
            with self.assertRaisesRegex(
                ArtifactError, "foreign dist-info"
            ):
                audit_wheel(wheel, expected_filename=wheel.name)

    def test_wheel_audit_checks_protected_directory_entries(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            wheel = (
                Path(temporary)
                / "demo_pkg-1.2.3-py3-none-any.whl"
            )
            make_wheel(wheel)
            with zipfile.ZipFile(wheel, mode="a") as archive:
                info = zipfile.ZipInfo("torch/")
                info.compress_type = zipfile.ZIP_STORED
                info.external_attr = (stat.S_IFDIR | 0o755) << 16
                archive.writestr(info, b"")
            with self.assertRaisesRegex(
                ArtifactError, "protected namespace"
            ):
                audit_wheel(wheel, expected_filename=wheel.name)


class BaseMetadataAndBuildAuditTests(unittest.TestCase):
    def _base_fixture(
        self, root: Path
    ) -> tuple[dict[str, Any], Path, Path]:
        image_config = json.dumps(
            {
                "architecture": "amd64",
                "os": "linux",
                "config": {
                    "Env": [
                        "PYTORCH_VERSION=2.5.1",
                    ],
                    "Labels": {
                        "org.opencontainers.image.ref.name": "ubuntu",
                        "org.opencontainers.image.version": "22.04",
                    },
                },
                "history": [
                    {"created_by": "ARG TARGETPLATFORM"},
                    {"created_by": "ARG CUDA_VERSION=12.4.1"},
                ],
            },
            separators=(",", ":"),
        ).encode("utf-8")
        config_digest = sha256(image_config)
        image_manifest = json.dumps(
            {
                "schemaVersion": 2,
                "mediaType": (
                    "application/vnd.docker.distribution.manifest.v2+json"
                ),
                "config": {
                    "mediaType": (
                        "application/vnd.docker.container.image.v1+json"
                    ),
                    "size": len(image_config),
                    "digest": f"sha256:{config_digest}",
                },
                "layers": [
                    {
                        "mediaType": (
                            "application/vnd.docker.image.rootfs.diff.tar.gzip"
                        ),
                        "size": 7,
                        "digest": "sha256:" + "1" * 64,
                    }
                ],
            },
            separators=(",", ":"),
        ).encode("utf-8")
        manifest_path = root / "base-manifest.json"
        config_path = root / "base-config.json"
        manifest_path.write_bytes(image_manifest)
        config_path.write_bytes(image_config)
        reviewed = {
            "baseImage": {
                "manifestByteSize": len(image_manifest),
                "manifestSha256": sha256(image_manifest),
                "configByteSize": len(image_config),
                "configSha256": config_digest,
                "platform": "linux/amd64",
            }
        }
        return reviewed, manifest_path, config_path

    def _rebind_base_config(
        self,
        reviewed: dict[str, Any],
        manifest_path: Path,
        config_path: Path,
        image_config: Mapping[str, Any],
    ) -> None:
        config_data = json.dumps(
            image_config, separators=(",", ":")
        ).encode("utf-8")
        config_path.write_bytes(config_data)
        config_digest = sha256(config_data)
        image_manifest = json.loads(manifest_path.read_text("utf-8"))
        image_manifest["config"]["size"] = len(config_data)
        image_manifest["config"]["digest"] = "sha256:" + config_digest
        manifest_data = json.dumps(
            image_manifest, separators=(",", ":")
        ).encode("utf-8")
        manifest_path.write_bytes(manifest_data)
        reviewed["baseImage"].update(
            {
                "manifestByteSize": len(manifest_data),
                "manifestSha256": sha256(manifest_data),
                "configByteSize": len(config_data),
                "configSha256": config_digest,
            }
        )

    def test_base_metadata_binds_raw_bytes_descriptor_and_platform(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            reviewed, manifest_path, config_path = self._base_fixture(
                Path(temporary)
            )
            verify_base_metadata_files(
                reviewed, manifest_path, config_path
            )

            foreign_platform = json.loads(
                config_path.read_text("utf-8")
            )
            foreign_platform["architecture"] = "arm64"
            self._rebind_base_config(
                reviewed,
                manifest_path,
                config_path,
                foreign_platform,
            )
            with self.assertRaisesRegex(ArtifactError, "platform"):
                verify_base_metadata_files(
                    reviewed, manifest_path, config_path
                )

    def test_base_metadata_rejects_observation_mismatches(self) -> None:
        mutations = (
            lambda value: value["config"]["Env"].__setitem__(
                0, "PYTORCH_VERSION=2.5.2"
            ),
            lambda value: value["history"].__setitem__(
                1, {"created_by": "ARG CUDA_VERSION=12.4.0"}
            ),
            lambda value: value["config"]["Labels"].__setitem__(
                "org.opencontainers.image.version", "24.04"
            ),
            lambda value: value.__setitem__(
                "history", [{"created_by": "ARG CUDA_VERSION=12.4.1"}]
            ),
            lambda value: value.__setitem__(
                "history", [{"created_by": "ARG TARGETPLATFORM"}]
            ),
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                with tempfile.TemporaryDirectory() as temporary:
                    reviewed, manifest_path, config_path = (
                        self._base_fixture(Path(temporary))
                    )
                    image_config = json.loads(
                        config_path.read_text("utf-8")
                    )
                    mutation(image_config)
                    self._rebind_base_config(
                        reviewed,
                        manifest_path,
                        config_path,
                        image_config,
                    )
                    with self.assertRaisesRegex(
                        ArtifactError, "version/config"
                    ):
                        verify_base_metadata_files(
                            reviewed, manifest_path, config_path
                        )

    def test_canonical_ignored_base_metadata_when_present(self) -> None:
        acquisition_root = (
            ROOT / ".local-data/banner-ai/sam2-build-inputs"
        )
        identity = (
            "pytorch-2.5.1-cuda12.4-cudnn9-runtime.linux-amd64"
        )
        manifest_path = acquisition_root / (
            identity + ".manifest.json"
        )
        config_path = acquisition_root / (
            identity + ".config.json"
        )
        presence = (
            os.path.lexists(manifest_path),
            os.path.lexists(config_path),
        )
        if not any(presence):
            self.skipTest(
                "canonical ignored base manifest/config are not retained"
            )
        self.assertEqual(
            presence,
            (True, True),
            "canonical ignored base evidence must be complete",
        )
        verify_base_metadata_files(
            manifest(), manifest_path, config_path
        )

    def test_build_audit_requires_staged_bytes_equal_archive_members(
        self,
    ) -> None:
        reviewed = copy.deepcopy(manifest())
        config_data = b"config"
        license_data = [b"license-a", b"license-b"]
        reviewed["config"]["byteSize"] = len(config_data)
        reviewed["config"]["sha256"] = sha256(config_data)
        for identity, data in zip(
            reviewed["licenses"]["runtime"], license_data
        ):
            identity["byteSize"] = len(data)
            identity["sha256"] = sha256(data)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            config_path = root / "config.yaml"
            config_path.write_bytes(config_data)
            license_paths = [root / "LICENSE", root / "LICENSE_cctorch"]
            for path, data in zip(license_paths, license_data):
                path.write_bytes(data)
            selected = {
                reviewed["config"]["repositoryPath"]: config_data,
            }
            selected.update(
                {
                    identity["repositoryPath"]: data
                    for identity, data in zip(
                        reviewed["licenses"]["runtime"], license_data
                    )
                }
            )
            common = {
                "manifest": reviewed,
                "archive_path": root / "archive.tar.gz",
                "raw_config_path": config_path,
                "checkpoint_path": root / "checkpoint.pt",
                "license_paths": license_paths,
                "base_manifest_json_path": root / "base-manifest.json",
                "base_config_json_path": root / "base-config.json",
                "requirements_lock_path": root / "requirements.lock",
                "wheelhouse_inventory_path": (
                    root / "wheelhouse-inventory.json"
                ),
                "wheelhouse_root": root / "wheelhouse",
                "immutable_base_reference": reviewed["baseImage"][
                    "immutableReference"
                ],
                "platform": "linux/amd64",
            }
            with (
                patch(
                    "sam_worker.artifacts.verify_source_archive"
                ),
                patch(
                    "sam_worker.artifacts.verify_checkpoint_artifact"
                ),
                patch(
                    "sam_worker.artifacts.verify_base_metadata_files"
                ),
                patch(
                    "sam_worker.artifacts.verify_dependency_build_ready"
                ),
                patch(
                    "sam_worker.artifacts._selected_archive_bytes",
                    return_value=selected,
                ),
            ):
                verify_build_input_artifacts(**common)
            foreign = dict(selected)
            foreign[reviewed["config"]["repositoryPath"]] = b"foreign"
            with (
                patch(
                    "sam_worker.artifacts.verify_source_archive"
                ),
                patch(
                    "sam_worker.artifacts.verify_checkpoint_artifact"
                ),
                patch(
                    "sam_worker.artifacts.verify_base_metadata_files"
                ),
                patch(
                    "sam_worker.artifacts.verify_dependency_build_ready"
                ),
                patch(
                    "sam_worker.artifacts._selected_archive_bytes",
                    return_value=foreign,
                ),
            ):
                with self.assertRaisesRegex(
                    ArtifactError, "differs from"
                ):
                    verify_build_input_artifacts(**common)

    def test_unresolved_dependency_gate_blocks_before_artifact_or_pip_inputs(
        self,
    ) -> None:
        reviewed = manifest()
        with self.assertRaisesRegex(
            ArtifactError, "deployment-time blocking"
        ):
            verify_dependency_build_ready(
                reviewed,
                requirements_lock_path=Path("/absent-lock"),
                wheelhouse_inventory_path=Path("/absent-inventory"),
                wheelhouse_root=Path("/absent-wheelhouse"),
            )
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with (
                patch(
                    "sam_worker.artifacts.verify_base_image_selection"
                ) as base,
                patch(
                    "sam_worker.artifacts.verify_source_archive"
                ) as source,
                patch(
                    "sam_worker.artifacts.verify_checkpoint_artifact"
                ) as checkpoint,
            ):
                with self.assertRaisesRegex(
                    ArtifactError, "deployment-time blocking"
                ):
                    verify_build_input_artifacts(
                        manifest=reviewed,
                        archive_path=root / "absent-archive",
                        raw_config_path=root / "absent-config",
                        checkpoint_path=root / "absent-checkpoint",
                        license_paths=[],
                        base_manifest_json_path=root / "absent-manifest",
                        base_config_json_path=root / "absent-base-config",
                        requirements_lock_path=root / "absent-lock",
                        wheelhouse_inventory_path=root / "absent-inventory",
                        wheelhouse_root=root / "absent-wheelhouse",
                        immutable_base_reference="foreign",
                        platform="foreign",
                    )
                base.assert_not_called()
                source.assert_not_called()
                checkpoint.assert_not_called()


class SafeExtractionDestinationTests(unittest.TestCase):
    def test_destination_must_be_empty_real_directory(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            absent = root / "absent"
            _empty_or_create_directory(absent)
            self.assertTrue(absent.is_dir())
            _empty_or_create_directory(absent)

            (absent / "foreign").write_bytes(b"x")
            with self.assertRaisesRegex(ArtifactError, "not empty"):
                _empty_or_create_directory(absent)

            file_path = root / "file"
            file_path.write_bytes(b"x")
            with self.assertRaisesRegex(ArtifactError, "regular directory"):
                _empty_or_create_directory(file_path)

            real_directory = root / "real"
            real_directory.mkdir()
            symlink = root / "symlink"
            symlink.symlink_to(real_directory, target_is_directory=True)
            with self.assertRaisesRegex(ArtifactError, "regular directory"):
                _empty_or_create_directory(symlink)

    def test_extractor_uses_exclusive_nofollow_file_creation(self) -> None:
        source = (
            ROOT / "services/sam-worker/sam_worker/artifacts.py"
        ).read_text("utf-8")
        self.assertIn("os.O_EXCL", source)
        self.assertIn('getattr(os, "O_NOFOLLOW", 0)', source)


class ImportBoundaryTests(unittest.TestCase):
    def test_artifact_verifier_imports_no_torch_or_sam(self) -> None:
        source = (
            ROOT / "services/sam-worker/sam_worker/artifacts.py"
        ).read_text("utf-8")
        self.assertNotIn("import torch", source)
        self.assertNotIn("import sam2", source)
        self.assertNotIn("requests", source)
        self.assertNotIn("urllib", source)
        self.assertNotIn("socket", source)
        self.assertNotIn("torch", sys.modules)
        self.assertNotIn("sam2", sys.modules)

    def test_git_tracks_no_downloaded_model_archive_base_or_local_data(
        self,
    ) -> None:
        result = subprocess.run(
            ["git", "-C", str(ROOT), "ls-files", "-z"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=5,
        )
        self.assertEqual(
            result.returncode,
            0,
            result.stderr[:1_000].decode("utf-8", errors="replace"),
        )
        self.assertLessEqual(len(result.stdout), 1_000_000)
        self.assertLessEqual(len(result.stderr), 10_000)
        decoded = result.stdout.decode("utf-8", errors="strict")
        self.assertTrue(decoded.endswith("\x00"))
        tracked = decoded[:-1].split("\x00")
        self.assertEqual(len(tracked), len(set(tracked)))
        forbidden_suffixes = (
            ".pt",
            ".pth",
            ".ckpt",
            ".safetensors",
            ".onnx",
            ".whl",
            ".tar.gz",
            ".tgz",
        )
        forbidden_basenames = {
            "sam2-source.tar.gz",
            "sam2.1_hiera_base_plus.pt",
            "pytorch-base-manifest.json",
            "pytorch-base-config.json",
        }
        for path in tracked:
            with self.subTest(path=path):
                self.assertNotIn("/.local-data/", "/" + path + "/")
                self.assertFalse(path.startswith(".local-data/"))
                self.assertNotIn(
                    PurePosixPath(path).name, forbidden_basenames
                )
                self.assertFalse(path.lower().endswith(forbidden_suffixes))
                if path.startswith(
                    ("packages/banner-ai/src/", "apps/web/")
                ):
                    self.assertFalse(
                        path.lower().endswith(forbidden_suffixes)
                    )
                    self.assertNotIn("/sam-worker/", path)

        public_exports = (
            ROOT / "packages/banner-ai/src/index.ts"
        ).read_text("utf-8")
        for forbidden in (
            "./server/",
            "sam-worker",
            "sam2-source",
            "sam2.1_hiera_base_plus",
        ):
            self.assertNotIn(forbidden, public_exports)


if __name__ == "__main__":
    unittest.main()
