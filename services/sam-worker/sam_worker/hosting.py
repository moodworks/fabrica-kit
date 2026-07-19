"""Hash-bound direct-hosting contract shared with the TypeScript server adapter."""

from __future__ import annotations

import hashlib
from typing import Any, Dict

from .protocol import canonical_json

DIRECT_HOSTING_PROFILE: Dict[str, Any] = {
    "profileVersion": "sam-runpod-direct-hosting-v1",
    "workerHostingVersion": "sam-worker-fastapi-direct-v1",
    "provider": "runpod-serverless-load-balancer",
    "protocolContractVersion": "sam-mask-v1",
    "routes": {
        "health": {"method": "GET", "path": "/ping"},
        "inference": {"method": "POST", "path": "/v1/masks"},
    },
    "health": {
        "cacheControl": "no-store",
        "retryAfter": "forbidden",
        "states": {
            "model-not-staged": {
                "status": 503,
                "body": "strict-redacted-json",
                "inferenceReady": False,
            },
            "model-staged-not-loaded": {
                "status": 204,
                "body": "empty",
                "inferenceReady": False,
            },
            "model-loaded-ready": {
                "status": 200,
                "body": "strict-redacted-json",
                "inferenceReady": True,
            },
            "startup-blocked": {
                "status": 503,
                "body": "strict-redacted-json",
                "inferenceReady": False,
            },
        },
    },
    "requestEnvelope": "bare-sam-mask-v1",
    "responseEnvelope": "bare-sam-mask-v1",
    "endpointHostTemplate": "https://{endpointId}.api.runpod.ai/v1/masks",
    "endpointIdSyntax": "dns-label-lowercase-v1",
    "requestLifecycle": {
        "dispatchCount": 1,
        "clientRetryCount": 0,
        "queueing": "none",
        "polling": "none",
        "requestBacklog": "none",
        "acceptedLaterResponse": False,
        "backgroundRequestProcessing": False,
        "inFlightDisconnect": "engine-may-finish-permit-held-no-gpu-cancel-claim",
        "postDispatchIndeterminate": [
            "client-cancellation",
            "connection-loss",
            "response-truncation",
            "timeout",
            "http-500",
            "http-502",
            "http-503",
            "http-504",
        ],
    },
    "workerConcurrency": {
        "maximumInference": 1,
        "admission": "nonblocking-no-backlog",
        "admissionBeforeBodyBuffering": True,
        "overloadStatus": 429,
        "permitRelease": "after-blocking-inference-finishes",
    },
    "timeouts": {
        "providerProcessingMaximumMs": 330_000,
        "clientSemantics": "single-wall-timeout-indeterminate-after-dispatch",
    },
    "documentationEvidence": {
        "retrievedAt": "2026-07-18T13:15:50Z",
        "expiresAt": "2026-08-18T13:15:50Z",
        "sources": [
            "https://docs.runpod.io/serverless/load-balancing/overview",
            "https://docs.runpod.io/serverless/load-balancing/build-a-worker",
            "https://docs.runpod.io/serverless/endpoints/overview",
            "https://docs.runpod.io/serverless/workers/github-integration",
        ],
    },
}

DIRECT_HOSTING_PROFILE_SHA256 = (
    "2e5d64b6741802f7963fa678d174fca92a367a32672764fae5831c3131702f3a"
)

if (
    hashlib.sha256(canonical_json(DIRECT_HOSTING_PROFILE).encode("utf-8")).hexdigest()
    != DIRECT_HOSTING_PROFILE_SHA256
):
    raise RuntimeError("Direct hosting profile digest drifted.")
