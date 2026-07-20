"""Cached readiness and non-queueing single-inference runtime for the HTTP worker."""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any

from .artifacts import ArtifactError, preflight_runtime_artifacts
from .engine import (
    ADAPTER_PROFILE_PATH,
    CHECKPOINT_PATH,
    DEPENDENCY_LICENSES_PATH,
    LICENSE_ROOT,
    MANIFEST_PATH,
    MODEL_LOADER_PATH,
    OVERLAY_ROOT,
    ProductionSamEngine,
    REQUIREMENTS_LOCK_PATH,
    RUNTIME_DEPENDENCIES_ROOT,
    SOURCE_ROOT,
    WHEELHOUSE_MANIFEST_PATH,
)
from .protocol import (
    ContractError,
    ValidatedRequest,
    build_response,
    worker_image_digest,
)

MODEL_NOT_STAGED = "model-not-staged"
MODEL_STAGED_NOT_LOADED = "model-staged-not-loaded"
MODEL_LOADED_READY = "model-loaded-ready"
STARTUP_BLOCKED = "startup-blocked"
READINESS_STATES = {
    MODEL_NOT_STAGED,
    MODEL_STAGED_NOT_LOADED,
    MODEL_LOADED_READY,
    STARTUP_BLOCKED,
}
STARTUP_STATE_LOG_MESSAGES = {
    MODEL_NOT_STAGED: "fabrica-sam-startup-state: model-not-staged",
    MODEL_STAGED_NOT_LOADED: (
        "fabrica-sam-startup-state: model-staged-not-loaded"
    ),
    MODEL_LOADED_READY: "fabrica-sam-startup-state: model-loaded-ready",
    STARTUP_BLOCKED: "fabrica-sam-startup-state: startup-blocked",
}
_STARTUP_LOGGER = logging.getLogger("uvicorn.error")
WORKER_IMAGE_DIGEST_ENVIRONMENT = "SAM_WORKER_IMAGE_DIGEST"


def _log_startup_state(state: str) -> None:
    _STARTUP_LOGGER.info(STARTUP_STATE_LOG_MESSAGES[state])


class SamWorkerRuntime:
    """Own one engine, one cached readiness state, and one admission permit."""

    def __init__(
        self,
        engine: Any,
        initial_state: str,
        trusted_worker_image_digest: str,
    ) -> None:
        if initial_state not in READINESS_STATES:
            raise ValueError("SAM worker initial readiness state is invalid.")
        try:
            self.__worker_image_digest = worker_image_digest(
                trusted_worker_image_digest,
                "trusted worker image digest",
            )
        except ContractError as error:
            raise ValueError(
                "SAM worker image digest configuration is invalid."
            ) from error
        self.engine = engine
        self._state = initial_state
        self._state_lock = threading.Lock()
        self._startup_started = False
        self._inference_permit = threading.Lock()

    @property
    def worker_image_digest(self) -> str:
        """Return the immutable worker image identity captured at startup."""

        return self.__worker_image_digest

    def readiness_state(self) -> str:
        with self._state_lock:
            return self._state

    def load_model_once(self) -> None:
        """Run at most one background load and retain a terminal result for this process."""

        with self._state_lock:
            if self._startup_started or self._state != MODEL_STAGED_NOT_LOADED:
                return
            self._startup_started = True
        try:
            self.engine.load()
            self.engine.execution_identity()
        except Exception:
            with self._state_lock:
                self._state = STARTUP_BLOCKED
            _log_startup_state(STARTUP_BLOCKED)
            return
        with self._state_lock:
            self._state = MODEL_LOADED_READY
        _log_startup_state(MODEL_LOADED_READY)

    def try_admit(self) -> bool:
        return self._inference_permit.acquire(blocking=False)

    def release_admission(self) -> None:
        self._inference_permit.release()

    def infer_and_release(self, validated: ValidatedRequest) -> Any:
        """Release only after the blocking engine call and response construction finish."""

        try:
            return build_response(
                validated,
                self.engine,
                self.worker_image_digest,
            )
        finally:
            self.release_admission()

    def request_identity_matches(self, validated: ValidatedRequest) -> bool:
        return (
            validated.request["workerImageDigest"]
            == self.worker_image_digest
        )


def configured_worker_image_digest() -> str:
    raw_digest = os.environ.get(WORKER_IMAGE_DIGEST_ENVIRONMENT)
    try:
        return worker_image_digest(
            raw_digest,
            WORKER_IMAGE_DIGEST_ENVIRONMENT,
        )
    except ContractError as error:
        raise RuntimeError(
            "SAM worker image digest configuration is invalid."
        ) from error


def create_production_runtime() -> SamWorkerRuntime:
    configured_digest = configured_worker_image_digest()
    runtime_license_paths = (
        LICENSE_ROOT / "LICENSE",
        LICENSE_ROOT / "LICENSE_cctorch",
    )
    staged_paths = (
        MANIFEST_PATH,
        SOURCE_ROOT,
        CHECKPOINT_PATH,
        ADAPTER_PROFILE_PATH,
        OVERLAY_ROOT,
        MODEL_LOADER_PATH,
        REQUIREMENTS_LOCK_PATH,
        WHEELHOUSE_MANIFEST_PATH,
        DEPENDENCY_LICENSES_PATH,
        RUNTIME_DEPENDENCIES_ROOT,
        *runtime_license_paths,
    )
    staged = tuple(_artifact_path_exists(path) for path in staged_paths)
    if not any(staged):
        state = MODEL_NOT_STAGED
    elif not all(staged):
        state = STARTUP_BLOCKED
    else:
        try:
            preflight_runtime_artifacts(
                manifest_path=MANIFEST_PATH,
                source_root=SOURCE_ROOT,
                checkpoint_path=CHECKPOINT_PATH,
                licenses_root=LICENSE_ROOT,
                adapter_profile_path=ADAPTER_PROFILE_PATH,
                overlay_root=OVERLAY_ROOT,
                model_loader_path=MODEL_LOADER_PATH,
                requirements_lock_path=REQUIREMENTS_LOCK_PATH,
                wheelhouse_inventory_path=WHEELHOUSE_MANIFEST_PATH,
                dependency_licenses_path=DEPENDENCY_LICENSES_PATH,
                runtime_dependencies_root=RUNTIME_DEPENDENCIES_ROOT,
            )
        except ArtifactError:
            state = STARTUP_BLOCKED
        else:
            state = MODEL_STAGED_NOT_LOADED
    runtime = SamWorkerRuntime(
        ProductionSamEngine(),
        state,
        configured_digest,
    )
    _log_startup_state(state)
    return runtime


def _artifact_path_exists(path: Path) -> bool:
    try:
        path.lstat()
    except OSError:
        return False
    return True
