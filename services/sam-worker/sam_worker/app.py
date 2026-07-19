"""Strict FastAPI surface for RunPod load-balancing workers."""

from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Dict, Iterable, List, Tuple

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHttpException

from .hosting import DIRECT_HOSTING_PROFILE, DIRECT_HOSTING_PROFILE_SHA256
from .protocol import MAX_REQUEST_JSON_BYTES, ContractError, parse_request
from .runtime import (
    MODEL_LOADED_READY,
    MODEL_NOT_STAGED,
    MODEL_STAGED_NOT_LOADED,
    STARTUP_BLOCKED,
    SamWorkerRuntime,
    create_production_runtime,
)

HEALTH_PATH = "/ping"
INFERENCE_PATH = "/v1/masks"
_HTTP_PATHS = {HEALTH_PATH.encode("ascii"), INFERENCE_PATH.encode("ascii")}
_ERROR_MESSAGES = {
    "BODY_TOO_LARGE": "Request body exceeds the worker limit.",
    "INFERENCE_FAILED": "Inference failed closed.",
    "METHOD_NOT_ALLOWED": "Method is not allowed.",
    "NOT_FOUND": "Resource was not found.",
    "REQUEST_INVALID": "Request failed closed validation.",
    "UNSUPPORTED_MEDIA_TYPE": "Only an unencoded application/json body is accepted.",
    "WORKER_NOT_READY": "Worker is not ready for inference.",
    "WORKER_OVERLOADED": "Worker has no inference capacity.",
}


def _json_response(status_code: int, code: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": _ERROR_MESSAGES[code]}},
        headers={"cache-control": "no-store"},
    )


def _health_response(runtime: SamWorkerRuntime) -> Response:
    state = runtime.readiness_state()
    status_code = 200 if state == MODEL_LOADED_READY else 503
    if state not in (
        MODEL_NOT_STAGED,
        MODEL_STAGED_NOT_LOADED,
        MODEL_LOADED_READY,
        STARTUP_BLOCKED,
    ):
        state = STARTUP_BLOCKED
        status_code = 503
    return JSONResponse(
        status_code=status_code,
        content={
            "contractVersion": DIRECT_HOSTING_PROFILE["profileVersion"],
            "processAlive": True,
            "contractLoaded": True,
            "state": state,
            "inferenceReady": state == MODEL_LOADED_READY,
            "hostingProfileSha256": DIRECT_HOSTING_PROFILE_SHA256,
        },
        headers={"cache-control": "no-store"},
    )


def _header_values(request: Request, name: bytes) -> List[bytes]:
    return [value for key, value in request.scope["headers"] if key.lower() == name]


def _declared_body_length(request: Request) -> int | None:
    values = _header_values(request, b"content-length")
    if not values:
        return None
    if len(values) != 1:
        raise ContractError("content length header is duplicated")
    try:
        text = values[0].decode("ascii")
    except UnicodeDecodeError as error:
        raise ContractError("content length header is invalid") from error
    if not text or not text.isdigit() or (len(text) > 1 and text[0] == "0"):
        raise ContractError("content length header is invalid")
    return int(text)


async def _read_bounded_body(request: Request) -> bytes:
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_REQUEST_JSON_BYTES:
            raise OverflowError("request body exceeds bounded reader")
        body.extend(chunk)
    if not body:
        raise ContractError("request body is empty")
    return bytes(body)


def _closed_json_object(pairs: Iterable[Tuple[str, Any]]) -> Dict[str, Any]:
    result: Dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ContractError("JSON object contains a duplicate key")
        result[key] = value
    return result


def _reject_nonfinite_json(_value: str) -> None:
    raise ContractError("JSON number is not finite")


def _decode_json(body: bytes) -> Any:
    try:
        text = body.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise ContractError("request body is not valid UTF-8") from error
    if text.startswith("\ufeff"):
        raise ContractError("request body contains a byte order mark")
    try:
        return json.loads(
            text,
            object_pairs_hook=_closed_json_object,
            parse_constant=_reject_nonfinite_json,
        )
    except (json.JSONDecodeError, TypeError, ValueError) as error:
        raise ContractError("request body is not strict JSON") from error


def create_app(runtime: SamWorkerRuntime) -> FastAPI:
    loader_tasks: set[asyncio.Task[None]] = set()
    inference_tasks: set[asyncio.Task[Any]] = set()

    @asynccontextmanager
    async def lifespan(_application: FastAPI) -> AsyncIterator[None]:
        if runtime.readiness_state() == MODEL_STAGED_NOT_LOADED:
            loader = asyncio.create_task(asyncio.to_thread(runtime.load_model_once))
            loader_tasks.add(loader)
            loader.add_done_callback(loader_tasks.discard)
        try:
            yield
        finally:
            if loader_tasks:
                await asyncio.gather(*tuple(loader_tasks), return_exceptions=True)
            if inference_tasks:
                await asyncio.gather(*tuple(inference_tasks), return_exceptions=True)

    application = FastAPI(
        debug=False,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
        redirect_slashes=False,
        lifespan=lifespan,
    )

    @application.middleware("http")
    async def strict_http_boundary(request: Request, call_next: Any) -> Response:
        raw_path = request.scope.get("raw_path", b"")
        if raw_path not in _HTTP_PATHS or request.scope.get("query_string", b""):
            return _json_response(404, "NOT_FOUND")
        response = await call_next(request)
        response.headers["cache-control"] = "no-store"
        if "retry-after" in response.headers:
            del response.headers["retry-after"]
        return response

    @application.exception_handler(StarletteHttpException)
    async def http_exception_handler(
        _request: Request, exception: StarletteHttpException
    ) -> JSONResponse:
        if exception.status_code == 405:
            return _json_response(405, "METHOD_NOT_ALLOWED")
        return _json_response(404, "NOT_FOUND")

    @application.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        _request: Request, _exception: RequestValidationError
    ) -> JSONResponse:
        return _json_response(400, "REQUEST_INVALID")

    @application.exception_handler(Exception)
    async def unhandled_exception_handler(
        _request: Request, _exception: Exception
    ) -> JSONResponse:
        return _json_response(500, "INFERENCE_FAILED")

    @application.get(HEALTH_PATH)
    async def ping() -> Response:
        return _health_response(runtime)

    @application.post(INFERENCE_PATH)
    async def masks(request: Request) -> Response:
        if runtime.readiness_state() != MODEL_LOADED_READY:
            return _json_response(503, "WORKER_NOT_READY")
        if (
            _header_values(request, b"content-type") != [b"application/json"]
            or _header_values(request, b"content-encoding")
        ):
            return _json_response(415, "UNSUPPORTED_MEDIA_TYPE")
        try:
            declared_length = _declared_body_length(request)
        except ContractError:
            return _json_response(400, "REQUEST_INVALID")
        if declared_length is not None and declared_length > MAX_REQUEST_JSON_BYTES:
            return _json_response(413, "BODY_TOO_LARGE")
        if not runtime.try_admit():
            return _json_response(429, "WORKER_OVERLOADED")

        inference_started = False
        try:
            try:
                body = await _read_bounded_body(request)
            except OverflowError:
                return _json_response(413, "BODY_TOO_LARGE")
            except Exception:
                return _json_response(400, "REQUEST_INVALID")
            try:
                value = _decode_json(body)
                validated = parse_request(value)
            except ContractError:
                return _json_response(400, "REQUEST_INVALID")
            if await request.is_disconnected():
                return _json_response(400, "REQUEST_INVALID")

            inference = asyncio.create_task(
                asyncio.to_thread(runtime.infer_and_release, validated)
            )
            inference_tasks.add(inference)
            inference.add_done_callback(inference_tasks.discard)
            inference_started = True
            try:
                result = await asyncio.shield(inference)
            except asyncio.CancelledError:
                raise
            except Exception:
                return _json_response(500, "INFERENCE_FAILED")
            return JSONResponse(
                status_code=200,
                content=result,
                headers={"cache-control": "no-store"},
            )
        finally:
            if not inference_started:
                runtime.release_admission()

    return application


app = create_app(create_production_runtime())
