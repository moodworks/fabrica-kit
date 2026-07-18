# Fabrica SAM 2.1 worker

This directory is an isolated Python inference worker. It is not the Fabrica application
backend, has no browser or web-route entry point, and never accepts provider endpoints,
checkpoint paths, model IDs, URLs, or credentials in its request.

The deployable entry point is:

```text
python -m sam_worker.server
```

This starts one Uvicorn process on `0.0.0.0:${PORT:-80}`. It is a custom FastAPI service
for a future RunPod Load Balancer endpoint, not a queue handler. The only exact routes
are `GET /ping` and `POST /v1/masks`; requests and responses are bare closed
`sam-mask-v1` JSON objects. There is no `/run`, `/runsync`, queue envelope, polling,
retry, cancel route, or request backlog.

Tests inject a fake engine and therefore do not import torch, NumPy, or SAM 2, require a
GPU, retrieve a model, or make a provider call. With FastAPI, HTTPX, and Uvicorn from
`requirements.test.in` available in the test interpreter, run the complete suite:

```bash
PYTHONPYCACHEPREFIX=/tmp/fabrica-sam-pycache \
PYTHONPATH=services/sam-worker \
python3 -m unittest discover -s services/sam-worker/tests -v
```

Without those three test-only packages, the same command still runs the protocol,
engine-fake, artifact, source, and Docker static tests but intentionally skips the five
guarded HTTP-surface tests. A disposable provider-free test environment can be prepared
outside the repository with:

```bash
python3 -m venv /tmp/fabrica-sam-worker-test
/tmp/fabrica-sam-worker-test/bin/python -m pip install \
  --requirement services/sam-worker/requirements.test.in
PYTHONPYCACHEPREFIX=/tmp/fabrica-sam-pycache \
PYTHONPATH=services/sam-worker \
/tmp/fabrica-sam-worker-test/bin/python \
  -m unittest discover -s services/sam-worker/tests -v
```

Installing those small test dependencies is a separate environment preparation step;
it does not download a checkpoint or execute SAM.

## Direct worker runtime

`PORT` must be an integer from 1 through 65535 and defaults to `80`. If set,
`PORT_HEALTH` must equal `PORT`, and `HEALTH_CHECK_PATH` must be `/ping`. The future
endpoint therefore uses application and health port 80 and health path `/ping`.

Readiness is cached per process:

| State                     | `/ping` | Body                 |
| ------------------------- | ------: | -------------------- |
| `model-not-staged`        |     503 | strict redacted JSON |
| `model-staged-not-loaded` |     204 | empty                |
| `model-loaded-ready`      |     200 | strict redacted JSON |
| `startup-blocked`         |     503 | strict redacted JSON |

RunPod Load Balancing interprets 200 as healthy, 204 as initializing, and every other
status as unhealthy. When the manifest, config, and checkpoint are all staged, the
FastAPI lifespan starts one background model load. One process owns one warm model and
one nonblocking inference permit. `/v1/masks` claims that permit before buffering the
body, runs one blocking inference in a thread, and returns `429` to concurrent work
instead of queueing it. A permit is held until inference and response construction
finish, even if a client disconnects after inference begins.

All routes reject queries and trailing-path variants. Inference requires exactly one
unencoded `Content-Type: application/json`, accepts at most 16,100,000 request bytes,
and returns at most 12,000,000 response bytes. These application limits are stricter
than RunPod's documented 30 MB request and response limit. Worker errors and health
bodies are redacted, access logging is disabled, and image bytes, masks, credentials,
and authorization headers must never be logged.

The accepted direct-hosting evidence is the official RunPod
[load-balancing overview](https://docs.runpod.io/serverless/load-balancing/overview),
[worker guide](https://docs.runpod.io/serverless/load-balancing/build-a-worker),
[endpoint overview](https://docs.runpod.io/serverless/endpoints/overview), and
[GitHub integration guide](https://docs.runpod.io/serverless/workers/github-integration),
retrieved at exactly `2026-07-18T13:15:50Z`. Native construction and execution fail
closed at or after `2026-08-18T13:15:50Z`, or require earlier re-review if a source
changes. The deterministic fake remains available after evidence expiry.

## Controlled image inputs

The Dockerfile deliberately has no buildable defaults. A controlled future build must
stage all files under `.local-data/banner-ai/sam-worker-build/`, including:

- an immutable reviewed Meta repository snapshot at commit
  `05d9e57fb3945b10c861046c1e6749e2bfc258e3`;
- the reviewed config and checkpoint plus exact SHA-256 values;
- Apache-2.0 and applicable BSD-3-Clause notices;
- a local wheelhouse and a `pip --require-hashes` lock;
- source, wheelhouse, dependency-lock, config, and model manifests.

The exact staged layout is:

```text
.local-data/banner-ai/sam-worker-build/
  LICENSE
  NOTICE
  model-manifest.json
  requirements.lock
  requirements.lock.sha256
  sam2-source.tar.gz
  sam2-source.tar.gz.sha256
  sam2.1_hiera_base_plus.pt
  wheelhouse/
  wheelhouse.sha256
```

Every `.sha256` file is a reviewed `sha256sum --check` manifest over the corresponding
staged inputs. `sam2-source.tar.gz` must be the canonical official archive for the pinned
commit, named internally `sam2-05d9e57fb3945b10c861046c1e6749e2bfc258e3`; its one
reviewed archive digest binds the complete source tree, and the Dockerfile rejects extra
top-level archive members. It never installs from an ad hoc directory or a partial
file-digest list.

[`build-input-manifest.example.json`](./build-input-manifest.example.json) is a review
ledger only; it is not copied into the image or accepted by the runtime.
[`model-manifest.example.json`](./model-manifest.example.json) is the exact eight-key
runtime template consumed by `validate_model_artifacts`. Copy it to the ignored staged
path as `model-manifest.json` only after replacing both placeholder digest strings with
independently reviewed, nonzero lowercase SHA-256 values. Do not add ledger fields to
that runtime object. After those values and the base-image digest are independently
reviewed, the future controlled build command is:

```bash
docker build --network=none \
  --file services/sam-worker/Dockerfile \
  --build-arg PYTORCH_BASE_IMAGE='pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime@sha256:<reviewed-digest>' \
  --tag fabrica-sam-worker:controlled-local .
```

This is an instruction for a later authorization, not a command run in this milestone.
`Dockerfile.dockerignore` is default-deny and re-includes only the worker runtime source,
the Dockerfile, and `.local-data/banner-ai/sam-worker-build/**`; repository Git data,
environment files, demonstrations, evidence, and every other local-data subtree stay
outside the build context.

The checkpoint digest is intentionally unresolved in this milestone. Building or running
the production engine before that value is independently reviewed must fail. The image
base must be supplied as the reviewed
`pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime@sha256:<digest>` reference. The resulting
image must be deployed by its registry digest, never by `latest`.

## Future Load Balancer deployment

Only a new explicit authorization may perform these future steps:

1. Renew the official Meta and RunPod evidence before
   `2026-08-18T13:15:50Z`, or earlier if an official source changes.
2. Resolve the authoritative checkpoint digest; acquire the exact pinned Meta source,
   config, checkpoint, license/notices, hash-locked dependencies, and wheelhouse through
   the controlled process above.
3. Resolve the full PyTorch base-image digest, run the network-disabled controlled
   build, and validate exact `/ping` and `/v1/masks` behavior locally.
4. Push once to the approved registry and record the immutable image digest. Do not use
   RunPod's GitHub integration: it builds and deploys from the connected repository,
   while this design requires a separately reviewed image.
5. Create an endpoint with type **Load Balancer**, not Queue. Pin that image digest,
   choose and record the exact GPU type and price, use one GPU per worker,
   minimum/active workers 0, maximum workers 1, application/health port 80, health path
   `/ping`, and inference path `/v1/masks`. Record the exact image, GPU, model,
   cold-start/idle, timeout, and cost decisions. There is no provider queue or automatic
   retry.
6. Validate authenticated health without inference, then create a new unexpired,
   single-use `single-fixture-sam-runpod-direct-v2` authorization. Bind it to
   `https://<endpoint-id>.api.runpod.ai/v1/masks`, the immutable image, exact live model
   identity and checkpoint digest, exact fixture and limits, all reviewed profile
   digests, a wall timeout at most 330,000 ms, one client dispatch, one application
   inference maximum, zero retry/poll, and an exact cost cap. It must state
   `providerBillingGuarantee=false` and grant no production admission, web route, or
   Qwen geometry authority.
7. Using the server-only `RUNPOD_API_KEY` reference and Bearer transport, submit that one
   automatic-candidates fixture exactly once and stop. A timeout, cancellation,
   connection loss, truncated response, or 5xx outcome is indeterminate and is never
   retried by the adapter.

The exact architecture, RunPod evidence, profile digests, contracts, fake demonstration,
and one-fixture authorization boundary are documented in
[`docs/architecture/banner-ai-sam2-mask-worker.md`](../../docs/architecture/banner-ai-sam2-mask-worker.md).

No checkpoint retrieval, dependency resolution, Docker build, registry push, endpoint
creation, key inspection, health probe, provider call, or deployment is part of this
milestone.
