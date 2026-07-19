"""Artifact-only probe; it never loads a second SAM model."""

import sys

from .artifacts import (
    IMAGE_ADAPTER_PROFILE_PATH,
    IMAGE_CHECKPOINT_PATH,
    IMAGE_DEPENDENCY_LICENSES_PATH,
    IMAGE_LICENSE_ROOT,
    IMAGE_MANIFEST_PATH,
    IMAGE_MODEL_LOADER_PATH,
    IMAGE_OVERLAY_ROOT,
    IMAGE_REQUIREMENTS_LOCK_PATH,
    IMAGE_RUNTIME_DEPENDENCIES_ROOT,
    IMAGE_SOURCE_ROOT,
    IMAGE_WHEELHOUSE_MANIFEST_PATH,
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
        adapter_profile_path=IMAGE_ADAPTER_PROFILE_PATH,
        overlay_root=IMAGE_OVERLAY_ROOT,
        model_loader_path=IMAGE_MODEL_LOADER_PATH,
        requirements_lock_path=IMAGE_REQUIREMENTS_LOCK_PATH,
        wheelhouse_inventory_path=IMAGE_WHEELHOUSE_MANIFEST_PATH,
        dependency_licenses_path=IMAGE_DEPENDENCY_LICENSES_PATH,
        runtime_dependencies_root=IMAGE_RUNTIME_DEPENDENCIES_ROOT,
    )
    print("sam-worker-artifacts-ok")


if __name__ == "__main__":
    main()
