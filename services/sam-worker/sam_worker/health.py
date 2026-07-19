"""Artifact-only probe; it never loads a second SAM model."""

import sys

from .artifacts import (
    IMAGE_CHECKPOINT_PATH,
    IMAGE_LICENSE_ROOT,
    IMAGE_MANIFEST_PATH,
    IMAGE_SOURCE_ROOT,
    preflight_runtime_artifacts,
    verify_runtime_artifacts,
)


def main() -> None:
    verifier = (
        preflight_runtime_artifacts
        if "--light" in sys.argv
        else verify_runtime_artifacts
    )
    verifier(
        manifest_path=IMAGE_MANIFEST_PATH,
        source_root=IMAGE_SOURCE_ROOT,
        checkpoint_path=IMAGE_CHECKPOINT_PATH,
        licenses_root=IMAGE_LICENSE_ROOT,
    )
    print("sam-worker-artifacts-ok")


if __name__ == "__main__":
    main()
