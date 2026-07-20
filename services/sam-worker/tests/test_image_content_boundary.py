from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from image_content_boundary import (
    ACQUISITION_PROGRAM,
    DEPENDENCY_LICENSES,
    DOCKERFILE,
    DOCKERIGNORE,
    EXPECTED_CONTEXT_IDENTITIES,
    EXPECTED_CONTROL_IDENTITIES,
    BoundaryError,
    verify_image_content,
)

ROOT = Path(__file__).resolve().parents[3]
CLI = ROOT / "services/sam-worker/image_content_boundary.py"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class ImageContentBoundaryTests(unittest.TestCase):
    def expected_modes(self) -> dict[str, str]:
        return {
            path: "100644"
            for path in {
                *EXPECTED_CONTEXT_IDENTITIES,
                *EXPECTED_CONTROL_IDENTITIES,
            }
        }

    def copy_boundary_inputs(self, root: Path) -> None:
        for relative in {
            *EXPECTED_CONTEXT_IDENTITIES,
            *EXPECTED_CONTROL_IDENTITIES,
        }:
            source = ROOT / relative
            destination = root / relative
            destination.parent.mkdir(
                parents=True,
                exist_ok=True,
            )
            shutil.copy2(source, destination)

    def test_actual_reviewed_boundary_and_executable_pass_offline(
        self,
    ) -> None:
        verify_image_content(
            ROOT,
            tracked_modes=self.expected_modes(),
        )
        environment = dict(os.environ)
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        result = subprocess.run(
            [sys.executable, str(CLI)],
            cwd=ROOT,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(
            result.stdout,
            (
                "sam-worker-image-content-boundary-ok "
                "context-files=21 reviewed-downloads=18\n"
            ),
        )
        self.assertEqual(result.stderr, "")
        self.assertEqual(CLI.stat().st_mode & 0o111, 0o111)

    def test_context_is_exact_and_excludes_sensitive_or_unrelated_paths(
        self,
    ) -> None:
        self.assertEqual(len(EXPECTED_CONTEXT_IDENTITIES), 21)
        lowered = "\n".join(
            sorted(EXPECTED_CONTEXT_IDENTITIES)
        ).lower()
        for forbidden in (
            "/.git",
            ".env",
            "credential",
            "provider",
            "/tests/",
            "/fixtures/",
            "/reports/",
            "/images/",
            "__pycache__",
            ".pytest_cache",
            "node_modules",
            "ghcr_publication.py",
            "image_content_boundary.py",
        ):
            self.assertNotIn(forbidden, lowered)

    def test_broad_copy_add_and_secret_or_ssh_mounts_fail_closed(
        self,
    ) -> None:
        mutations = (
            "COPY . /opt/fabrica/leak\n",
            "ADD services/sam-worker /opt/fabrica/leak\n",
            "RUN --mount=type=secret,id=token --network=none true\n",
            "RUN --mount=type=ssh --network=none true\n",
        )
        for mutation in mutations:
            with self.subTest(mutation=mutation.split()[0:2]):
                with tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    self.copy_boundary_inputs(root)
                    dockerfile = root / DOCKERFILE
                    dockerfile.write_text(
                        dockerfile.read_text("utf-8") + mutation,
                        encoding="utf-8",
                    )
                    with patch.dict(
                        EXPECTED_CONTEXT_IDENTITIES,
                        {DOCKERFILE: sha256(dockerfile)},
                    ):
                        with self.assertRaises(BoundaryError):
                            verify_image_content(
                                root,
                                tracked_modes=self.expected_modes(),
                            )

    def test_dockerignore_rejects_unrelated_and_sensitive_inclusions(
        self,
    ) -> None:
        additions = (
            "!services/sam-worker/tests/\n",
            "!.git/\n",
            "!.env\n",
            "!reports/\n",
            "!provider-responses/\n",
            "!images/\n",
        )
        for addition in additions:
            with self.subTest(addition=addition.strip()):
                with tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    self.copy_boundary_inputs(root)
                    dockerignore = root / DOCKERIGNORE
                    dockerignore.write_text(
                        dockerignore.read_text("utf-8") + addition,
                        encoding="utf-8",
                    )
                    with patch.dict(
                        EXPECTED_CONTROL_IDENTITIES,
                        {DOCKERIGNORE: sha256(dockerignore)},
                    ):
                        with self.assertRaisesRegex(
                            BoundaryError,
                            "dockerignore",
                        ):
                            verify_image_content(
                                root,
                                tracked_modes=self.expected_modes(),
                            )

    def test_unreviewed_download_path_is_rejected_after_hash_gate(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self.copy_boundary_inputs(root)
            acquisition = root / ACQUISITION_PROGRAM
            acquisition.write_text(
                (
                    acquisition.read_text("utf-8")
                    + "\nrequests.get('https://example.invalid/model')\n"
                ),
                encoding="utf-8",
            )
            with patch.dict(
                EXPECTED_CONTEXT_IDENTITIES,
                {ACQUISITION_PROGRAM: sha256(acquisition)},
            ):
                with self.assertRaisesRegex(
                    BoundaryError,
                    "acquisition-download-path",
                ):
                    verify_image_content(
                        root,
                        tracked_modes=self.expected_modes(),
                    )

    def test_manifest_url_hash_and_license_drift_fail_closed(
        self,
    ) -> None:
        mutations = (
            (
                DEPENDENCY_LICENSES,
                lambda data: data + b"\n",
            ),
            (
                "services/sam-worker/artifact-manifest.json",
                self.changed_archive_url,
            ),
        )
        for relative, mutate in mutations:
            with self.subTest(relative=relative):
                with tempfile.TemporaryDirectory() as temporary:
                    root = Path(temporary)
                    self.copy_boundary_inputs(root)
                    path = root / relative
                    path.write_bytes(mutate(path.read_bytes()))
                    with patch.dict(
                        EXPECTED_CONTEXT_IDENTITIES,
                        {relative: sha256(path)},
                    ):
                        with self.assertRaisesRegex(
                            BoundaryError,
                            "artifact-contract",
                        ):
                            verify_image_content(
                                root,
                                tracked_modes=self.expected_modes(),
                            )

    @staticmethod
    def changed_archive_url(data: bytes) -> bytes:
        value = json.loads(data)
        value["repository"]["archive"]["url"] = (
            "https://example.invalid/unreviewed.tar.gz"
        )
        return json.dumps(
            value,
            ensure_ascii=True,
            indent=2,
            sort_keys=True,
        ).encode("utf-8") + b"\n"

    def test_untracked_symlink_or_nonregular_mode_is_rejected(self) -> None:
        modes = self.expected_modes()
        modes[DOCKERFILE] = "120000"
        with self.assertRaisesRegex(
            BoundaryError,
            "tracked-input-identity",
        ):
            verify_image_content(ROOT, tracked_modes=modes)

        modes = self.expected_modes()
        modes.pop(DOCKERFILE)
        with self.assertRaisesRegex(
            BoundaryError,
            "tracked-input-set",
        ):
            verify_image_content(ROOT, tracked_modes=modes)


if __name__ == "__main__":
    unittest.main()
