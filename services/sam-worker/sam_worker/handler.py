"""RunPod standard handler with an injectable engine for provider-free tests."""

from __future__ import annotations

import threading
from typing import Any, Mapping, Optional

from .engine import ProductionSamEngine
from .protocol import ContractError, build_response, parse_request

_engine_lock = threading.Lock()
_engine: Optional[ProductionSamEngine] = None


def production_engine() -> ProductionSamEngine:
    global _engine
    if _engine is None:
        with _engine_lock:
            if _engine is None:
                candidate = ProductionSamEngine()
                candidate.load()
                _engine = candidate
    return _engine


def handle_job(event: Any, engine: Optional[Any] = None) -> Mapping[str, Any]:
    if not isinstance(event, dict) or set(event) != {"id", "input"}:
        raise ContractError("RunPod event must contain exactly id and input")
    provider_job_id = event["id"]
    if not isinstance(provider_job_id, str) or not 1 <= len(provider_job_id) <= 256:
        raise ContractError("RunPod provider job id is invalid")
    validated = parse_request(event["input"])
    return build_response(validated, engine if engine is not None else production_engine())


def main() -> None:
    # No model or checkpoint download is permitted here. load() verifies local artifacts first.
    production_engine()
    import runpod

    runpod.serverless.start({"handler": handle_job})


if __name__ == "__main__":
    main()
