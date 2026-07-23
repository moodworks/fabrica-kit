# SAM direct Load Balancer worker

Current-state pointer (2026-07-23): earlier version-11 and health-only sections below remain
historical. The reviewed version-12 immutable deployment, completed person evidence, and
provider-free corpus-capacity boundary are summarized in
[`../../docs/evaluation/banner-ai-sam-corpus-evaluation-handoff.md`](../../docs/evaluation/banner-ai-sam-corpus-evaluation-handoff.md).

This service is the provider-neutral FastAPI worker for the reviewed
`sam2.1_hiera_base_plus` deployment. The image defaults to a direct RunPod Load
Balancer server on port 80. The MCP-authoritative existing staging endpoint overrides
the container port, `PORT`, and `PORT_HEALTH` to `8000`:

- readiness: `GET /ping`
- inference: `POST /v1/masks`
- no queue wrapper, `/run`, or `/runsync`
- one process, one model instance, and one admitted inference request
- no startup-time or request-time download

The separately authorized manual GHCR path publishes a public image at
`ghcr.io/moodworks/fabrica-sam-worker`. Local implementation does not publish,
deploy, or change the existing endpoint. Before Docker authentication or build, the
workflow proves the exact tracked Docker context, Dockerfile copy/stage/mount graph,
reviewed acquisition URLs and hashes, and dependency/license closure with
`image_content_boundary.py`. It then performs exactly one worker build/push and
requires public package ownership/linkage, authenticated OCI proof, anonymous
Registry V2 challenge/token retrieval, exact-digest proof, and bearer HTTP 404 for
`latest`. The initial request and anonymous token request contain no GitHub credential
or authorization; the scoped anonymous token remains in memory only and must re-prove
the exact manifest even when the initial public request returns HTTP 200. OCI config
proof binds the reviewed runtime directives/environment, rootfs/layer counts, and the final
15-entry materialized Dockerfile graph; it is structural proof, not layer-tar byte
inspection. A future deployment must use the registry-proven Linux/AMD64 platform
image-manifest reference
`ghcr.io/moodworks/fabrica-sam-worker@sha256:<digest>` and independently set
`SAM_WORKER_IMAGE_DIGEST` to that same digest. Missing, malformed, uppercase, zero, or
mismatched values fail before model loading or inference. Because the package policy
is public, no GHCR PAT or RunPod private-registry credential is required. Public
availability grants no deployment, worker contact, health-check, or inference
authority. See
`docs/operations/sam-worker-ghcr-publication.md`.

This milestone established a reproducible GitHub build source. A later, separately
authorized first GitHub build attempt reached the immutable-base package-metadata gate
and stopped there. A subsequent authorized RunPod build
`ddad2cf2-5b79-490a-8646-669ae6649d05` on `runpod-sam-build-002` passed the repaired
base checks, but both its initial acquisition attempt and automatic retry failed
identically at the first archive's pre-stream length-header gate. Neither failed build
produced a final image or worker, and no endpoint, GPU, model-health, fixture, or
inference operation followed from those attempts. The current authorized health-only
release updates the existing Load Balancer endpoint from linked branch
`runpod-sam-build-002`, using container port `8000`, `PORT=8000`, and
`PORT_HEALTH=8000`; it creates no new endpoint and authorizes no inference request.

## Fixed GitHub build source

The MCP-authoritative configured RunPod build source is:

| Setting        | Value                            |
| -------------- | -------------------------------- |
| Repository     | `moodworks/fabrica-kit`          |
| Linked branch  | `runpod-sam-build-002`           |
| Dockerfile     | `services/sam-worker/Dockerfile` |
| Build context  | repository root                  |
| Platform       | `linux/amd64`                    |
| Container port | `8000`                           |
| `PORT`         | `8000`                           |
| `PORT_HEALTH`  | `8000`                           |

Provider assumptions are limited to RunPod's official
[GitHub integration](https://docs.runpod.io/serverless/workers/github-integration)
and [Load Balancing](https://docs.runpod.io/serverless/load-balancing/overview)
documentation.

RunPod consumes these build inputs only from a reviewed commit pushed to configured
branch `runpod-sam-build-002`. Publishing an authorized GitHub release for that commit
triggers an update of the linked existing endpoint on container port `8000` with
`PORT=8000` and `PORT_HEALTH=8000`; local worktree and untracked state are never build
inputs. Branch `main` remains the canonical future promotion source, not the branch
linked to this health-only release. This authorized release creates no endpoint or
inference authority. The build does not depend on `.local-data`, Git LFS, untracked
wheel files, absolute developer paths, local caches, Docker secrets, or files outside
the repository-root context.

`services/sam-worker/Dockerfile.dockerignore` is the Dockerfile-specific, allowlist
context contract. Every `COPY` source is a repository file selected by that allowlist.

## Later health-only operational evidence

Later authorized operational evidence is distinct from those failed builds. The
user-supplied registry/container lifecycle excerpt records that commit `63f3ad7`
produced registry tag
`registry.runpod.net/moodworks-fabrica-kit-runpod-sam-build-002-services-sam-worker-dockerfile:63f3ad7b4`.
Two health-triggered containers were created and started, then stopped and removed; a
third container creation subsequently appeared. Root-observed authorized authenticated
`GET /ping` probes timed out after exactly 180006 ms and 30006 ms with zero response
bytes and HTTP `000`. A separately approved diagnostic established that DNS resolution
and TLS negotiation worked.

No `POST /v1/masks` or inference request occurred. The supplied lifecycle excerpt
contained no application stderr, process exit reason, or immutable image digest, so it
does not establish successful model load or an exact container termination cause. The
registry tag is not represented as an immutable digest. The authorized health-only
release does not change that historical conclusion and claims neither successful model
load nor a final image digest in advance. It reuses the existing endpoint and grants no
`POST /v1/masks` or other inference authority. That endpoint remains linked to
`runpod-sam-build-002` and overrides the image default with container port `8000`,
`PORT=8000`, and `PORT_HEALTH=8000`.

## Reviewed artifact identities

`artifact-manifest.json` is the executable source of truth. Its self-digest is:

`085ddd290b17b6931ea026c274610d9f6c49bad49a5fd372e846a2060b9ac5c4`

| Artifact                | Exact identity                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| SAM repository commit   | `05d9e57fb3945b10c861046c1e6749e2bfc258e3`                                                                              |
| Official archive URL    | `https://codeload.github.com/facebookresearch/sam2/tar.gz/05d9e57fb3945b10c861046c1e6749e2bfc258e3`                     |
| Archive bytes           | `55,631,013`                                                                                                            |
| Archive SHA-256         | `92c9e7ca3102fb8ef5953b0e80063a9ae77eb3d80fc54c498c1c6e2f71903dd6`                                                      |
| Config path             | `sam2/configs/sam2.1/sam2.1_hiera_b+.yaml`                                                                              |
| Config bytes            | `3,650`                                                                                                                 |
| Config SHA-256          | `e73f9e9547b305040552ee943ebd3a34cee5727a76fc2ab88b87f7b28b430754`                                                      |
| Official checkpoint URL | `https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt`                                    |
| Checkpoint bytes        | `323,606,802`                                                                                                           |
| Checkpoint SHA-256      | `a2345aede8715ab1d5d31b4a509fb160c5a4af1970f199d9054ccfb746c004c5`                                                      |
| Base image              | `pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime@sha256:c8268a92a69bd500f8be0e665b2630ee006dadaf7bfbc24249141b15ff622755` |

The archive verifier accepts only the reviewed archive topology, safely extracts the
33-file runtime SAM tree, preserves the four reviewed internal symlinks, and selects
the exact config and two runtime licenses. It rejects traversal, case or Unicode
collisions, foreign top-level roots, escaping links, unsupported entry types, and
unexpected required paths. The checkpoint is size/hash checked and structurally
inspected without reading its pickle payload.

## Closed dependency lock

The canonical target is CPython 3.11 on Linux AMD64. The tracked dependency inputs
are:

| Input                      | Bytes | SHA-256                                                            |
| -------------------------- | ----: | ------------------------------------------------------------------ |
| `requirements.lock`        | 1,535 | `a52ec65c9bb270eef33a71dbf8971731dbf99135ecdffad6f392e39b6c42d525` |
| `wheelhouse-manifest.json` | 5,741 | `390054e8574bda53e710cefcbeb44a5dcdaba35f79cf4cfa029bf079deadd39b` |
| `dependency-licenses.json` | 5,036 | `2ff748f49c22662c25058397606f419bd5cc213d6797e3be7f6a8e4f9e52a95e` |

The exact runtime wheel closure is:

| Package             | Version    |
| ------------------- | ---------- |
| `annotated-types`   | `0.7.0`    |
| `anyio`             | `4.14.2`   |
| `click`             | `8.4.2`    |
| `fastapi`           | `0.115.12` |
| `h11`               | `0.16.0`   |
| `idna`              | `3.18`     |
| `numpy`             | `1.26.4`   |
| `pillow`            | `11.0.0`   |
| `pydantic`          | `2.13.4`   |
| `pydantic-core`     | `2.46.4`   |
| `pyyaml`            | `6.0.2`    |
| `starlette`         | `0.46.2`   |
| `tqdm`              | `4.67.1`   |
| `typing-extensions` | `4.16.0`   |
| `typing-inspection` | `0.4.2`    |
| `uvicorn`           | `0.34.2`   |

Every entry has one exact wheel filename, byte size, official
`files.pythonhosted.org` URL, and SHA-256. The lock forbids directives, direct URLs,
VCS references, editables, extras, markers, source distributions, base-owned packages,
and unbounded entries. The license inventory records one reviewed package-level
distribution license identity and the active wheel-metadata dependency edges for all
16 packages. Bundled NumPy and Pillow notices remain retained in their wheel/install
license files; they are not normalized into a component-level SBOM.

The retained OCI config's bare `PYTORCH_VERSION=2.5.1` value is distinct from the
installed distribution metadata. The immutable PyTorch base owns exactly
`torch==2.5.1+cu124` and `torchvision==0.20.1+cu124`, with compatibility bound to
`torch==2.5.1+cu124`. The final build checks those full metadata versions without
importing either package. Neither package, nor CUDA/cuDNN/NVIDIA wheels, may appear in
the lock or wheelhouse. No second torch build is installed.

## Two-stage Docker behavior

The `acquisition` stage is the only stage with network access. Before creating a
network opener, it verifies the manifest-bound bytes of the requirements lock,
wheelhouse manifest, and dependency-license inventory and proves their exact
lock-to-wheel-filename/version/hash-to-license closure. It then:

1. downloads the one reviewed SAM archive, checkpoint, and 16 reviewed wheel URLs;
2. rejects proxies, redirects, alternate hosts, query strings, fragments, credentials,
   ports, changed response URLs, non-200 status, and nonidentity content encodings;
3. explicitly requests identity encoding and treats `Content-Length` and
   `Transfer-Encoding` as advisory, including when absent, malformed, or stale;
4. enforces an expected-size-plus-one streaming ceiling and accepts only the exact
   actual byte count and SHA-256 while creating new, non-followed files;
5. emits only fixed artifact-kind failure codes without URLs, paths, header values,
   expected/observed values, hashes, or raw transport causes;
6. audits archive/checkpoint structure and every wheel ZIP, tag, distribution
   identity, protected namespace, and active `Requires-Dist` edge;
7. extracts only the reviewed runtime source/config/licenses; and
8. emits one closed build-input directory.

The `runtime` stage starts again from the exact immutable base digest. It copies only
that closed directory, mounts the verified wheelhouse read-only from the acquisition
stage, and installs with:

```text
--no-cache-dir --no-compile --no-index --only-binary=:all: --no-deps
--find-links=file:///opt/fabrica/wheelhouse --require-hashes
```

Every final-stage `RUN` is `--network=none`. The mounted wheelhouse and build-only
acquisition program are not copied into the image. `PYTHONDONTWRITEBYTECODE=1`,
`--no-cache-dir`, and `--no-compile` prevent build-created Python caches. The unused
pip-created console-script directory is removed; Uvicorn starts as a Python module.
The reviewed NumPy wheel contains one wheel-shipped `__pycache__` bytecode member, so
the same offline `RUN` deterministically removes every `.pyc` and empty
`__pycache__`, then asserts no such path remains. After complete runtime-artifact
verification, a separate offline build gate imports the pinned PyYAML parser and
`parse_reviewed_config`, reads only `IMAGE_CONFIG_PATH`, and parses the exact staged
config. It neither imports torch/SAM nor constructs a model, and any failure emits only
`fabrica-build-gate: selected-config-parse`. Runtime files are root-owned and read-only;
the server runs as UID/GID 10001, declares `EXPOSE 80/tcp`, and starts directly with
`python -m sam_worker.server`. That declaration and the server's default `PORT=80` are
image defaults; the existing endpoint's container port, `PORT`, and `PORT_HEALTH`
settings all override them to `8000`.

The provider-free preparation proves no acquisition tools, wheelhouse, downloaded
caches, Git metadata, or credentials are introduced by this Dockerfile into the final
stage. The immutable upstream base owns `/opt/conda`, Python, torch, pip, and related
base contents. Literal absence of base-owned build tools or caches cannot be claimed
until a later authorized RunPod image inventory is reviewed; that inventory remains a
non-promotion gate. Do not remove `/opt/conda`, because it owns the reviewed Python and
torch runtime.

`verify-installed` proves the exact installed distribution-name/version closure and
rejects protected namespace shadowing. It is not a claim of a complete base-image or
filesystem SBOM; that broader inventory is deferred to the later image review.

The checkpoint's required final path is:

`/opt/fabrica/sam/checkpoints/sam2.1_hiera_base_plus.pt`

## Selected-config construction

The upstream 33-file SAM runtime tree remains byte-identical. A four-file,
hash-bound overlay bypasses only the upstream Hydra package initializer and supplies a
fail-closed `iopath.common.file_io.g_pathmgr` for an import that the selected config
does not use. Any `g_pathmgr.open` call refuses immediately with a fixed redacted
error.

`model_loader.py` accepts only the exact reviewed 3,650-byte YAML and its exact 14
target occurrences (12 unique targets). It rejects aliases, anchors, directives,
tags, merges, duplicate keys, interpolation, `weights_path`, Hydra control keys,
unknown targets, and constructor-origin drift. PyYAML 6.0.2 reads the reviewed plain
`model.memory_encoder.fuser.layer.layer_scale_init_value: 1e-6` scalar as a string.
Before canonical hashing, the loader converts only that exact path and literal to the
float `1e-6`. The type must be the built-in `str`, not a subclass; a
missing path or any other type or value fails closed.
The normalized semantic graph SHA-256 is
`268e8972d9b8a502a1eec2a9ca6f42c65ffd2819c1108b6b8ed3da682fe5ac17`.
The loader directly constructs the reviewed graph and applies the three upstream
`build_sam2` postprocessing defaults.

The runtime adapter profile self-digest is:

`f03c378caa5b9ba7979d67ffe958dfd9ca65cc823a10d728faed8c612937b7bf`

This is a selected-config adapter only. It makes no general Hydra or iopath
compatibility claim. Semantic torch/SAM compatibility is deliberately
`deferred-no-torch-or-sam-execution` until a separately authorized build and GPU
health exercise.

## Readiness

Startup first captures and validates the required `SAM_WORKER_IMAGE_DIGEST`, then
verifies all staged artifact, dependency, overlay, loader, config, source, and
checkpoint identities before importing torch or SAM. It then constructs and loads
exactly one model instance. Readiness becomes green only after load succeeds. The
authorization-bound request digest must equal this captured configuration before the
engine is invoked. A live response injects the trusted digest into
`executionIdentity.workerImageDigest`; deterministic fake identities do not claim an
OCI image identity.

| State                     | `GET /ping` | Body                 | `inferenceReady` |
| ------------------------- | ----------: | -------------------- | ---------------- |
| `model-not-staged`        |         503 | strict redacted JSON | `false`          |
| `model-staged-not-loaded` |         204 | empty                | `false`          |
| `startup-blocked`         |         503 | strict redacted JSON | `false`          |
| `model-loaded-ready`      |         200 | strict redacted JSON | `true`           |

Startup failures transition to `startup-blocked`. Responses expose only fixed state
and contract fields; raw exceptions and filesystem paths are not returned. The exact
staged-but-not-loaded state returns a bodyless `204`; that response carries neither
`Content-Type` nor `Content-Length`. The official provider mapping is `204` =
initializing, `200` = healthy, and every other status = unhealthy and removed from
routing. All health responses use `Cache-Control: no-store` and omit `Retry-After`.
Inference remains refused with `503` unless the cached state is exactly
`model-loaded-ready`.

The `uvicorn.error` logger receives one fixed initial classification code and, when a
background load attempt runs, one fixed terminal ready or blocked code. The four
literal codes contain only the closed state; startup exceptions, paths, and observed
values are never interpolated and no exception trace is attached.

The active profile digests are:

- hosting:
  `872054e82fc13e771fa65381e2db1f19dfb2dd609584574e8c532ed8eb82fa18`
- direct transport adapter:
  `1e6795c970fcfa9443b850f27149e237daf63ffa668cd5094189936453467e28`
- direct authorization:
  `194272140ae7e717a69f122f6a3e7b1083c80a5f3022f12ffd73ca0016183492`
- runtime selected-config adapter:
  `f03c378caa5b9ba7979d67ffe958dfd9ca65cc823a10d728faed8c612937b7bf`

## OCI metadata and source revision

The image labels bind the non-secret source repository, supplied Git revision, SAM
commit/model/config/checkpoint, artifact manifest, three active profiles, build
contract, and:

`io.fabrica.image-use=pinned-digest-deployment-only-v1`

The only build argument is the mandatory `FABRICA_GIT_SHA`. It accepts exactly a
lowercase, nonzero 40-hex Git SHA; there is no default or sentinel. The manual workflow
passes the exact checked-out commit and the post-push validator requires the same
revision in the image config label. The Dockerfile and build inputs define or copy no
API key, credential, token, or Docker secret. None may enter a build argument, layer,
or label.

The deployable identity is never the commit tag or image config digest. It is only the
registry-verified Linux/AMD64 platform image-manifest digest. BuildKit provenance and
SBOM generation are disabled for this workflow, and raw registry validation still
classifies any root index before resolving and proving its platform manifest.

## Provider-free verification

These commands do not run Docker, torch, SAM, or RunPod:

```bash
./services/sam-worker/image_content_boundary.py

PYTHONPATH=services/sam-worker python3 -m unittest discover \
  -s services/sam-worker/tests -p 'test_*.py'

PYTHONPATH=services/sam-worker python3 -m sam_worker.artifacts verify-manifest \
  --manifest services/sam-worker/artifact-manifest.json

PYTHONPATH=services/sam-worker python3 -m sam_worker.artifacts verify-dependencies \
  --manifest services/sam-worker/artifact-manifest.json \
  --requirements-lock services/sam-worker/requirements.lock \
  --wheelhouse-manifest services/sam-worker/wheelhouse-manifest.json \
  --dependency-licenses services/sam-worker/dependency-licenses.json \
  --wheelhouse /path/to/exact-closed-wheelhouse
```

The complete fake-engine suite covers the direct request/response contract,
readiness, redaction, overload, checkpoint-loading policy, deterministic fake masks,
artifact and archive safety, lock/wheel/license closure, acquisition ordering, build
context, the exact image-content boundary, OCI root/platform/config/rootfs/history
proof, public and anonymous GHCR response handling, offline final installation, and
forbidden provider/secret operations.

## Authorized health-only RunPod configuration

RunPod consumes the reviewed source only after its commit is pushed to linked staging
branch `runpod-sam-build-002`; publishing this authorized GitHub release triggers the
existing endpoint update on container port `8000` with `PORT=8000` and
`PORT_HEALTH=8000`. Retain that endpoint rather than creating another one, with exactly:

| RunPod setting                   | Value                            |
| -------------------------------- | -------------------------------- |
| Endpoint type                    | Load Balancer                    |
| Repository                       | `moodworks/fabrica-kit`          |
| Linked branch                    | `runpod-sam-build-002`           |
| Dockerfile                       | `services/sam-worker/Dockerfile` |
| Container port                   | `8000`                           |
| `PORT`                           | `8000`                           |
| `PORT_HEALTH`                    | `8000`                           |
| Health path                      | `/ping`                          |
| Inference path                   | `/v1/masks`                      |
| Active/minimum workers           | `0`                              |
| Maximum workers                  | `1`                              |
| GPUs per worker                  | `1`                              |
| GPU group                        | A4000 / A4500 / RTX 4000, 16 GB  |
| Maximum hourly price             | `$0.75`                          |
| Total health-only deployment cap | `$2.00`                          |

Use no queue endpoint and no automatic or client retry. Upload no fixture and do not
send `POST /v1/masks`. This release and its bounded observation remain health-only.
