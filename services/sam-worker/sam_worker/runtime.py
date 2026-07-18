"""Cached readiness and non-queueing single-inference runtime for the HTTP worker."""

from __future__ import annotations

import threading
from typing import Any

from .engine import (
    CHECKPOINT_PATH,
    CONFIG_PATH,
    MANIFEST_PATH,
    ProductionSamEngine,
)
from .protocol import ValidatedRequest, build_response

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


class SamWorkerRuntime:
    """Own one engine, one cached readiness state, and one admission permit."""

    def __init__(self, engine: Any, initial_state: str) -> None:
        if initial_state not in READINESS_STATES:
            raise ValueError("SAM worker initial readiness state is invalid.")
        self.engine = engine
        self._state = initial_state
        self._state_lock = threading.Lock()
        self._startup_started = False
        self._inference_permit = threading.Lock()

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
            return
        with self._state_lock:
            self._state = MODEL_LOADED_READY

    def try_admit(self) -> bool:
        return self._inference_permit.acquire(blocking=False)

    def release_admission(self) -> None:
        self._inference_permit.release()

    def infer_and_release(self, validated: ValidatedRequest) -> Any:
        """Release only after the blocking engine call and response construction finish."""

        try:
            return build_response(validated, self.engine)
        finally:
            self.release_admission()


def create_production_runtime() -> SamWorkerRuntime:
    staged = (
        MANIFEST_PATH.is_file(),
        CONFIG_PATH.is_file(),
        CHECKPOINT_PATH.is_file(),
    )
    if all(staged):
        state = MODEL_STAGED_NOT_LOADED
    elif any(staged):
        state = STARTUP_BLOCKED
    else:
        state = MODEL_NOT_STAGED
    return SamWorkerRuntime(
        ProductionSamEngine(),
        state,
    )
