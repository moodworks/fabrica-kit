# Banner AI SAM 2.1 mask worker

Status: provider-free GitHub-build preparation; production execution inactive
Contract: `sam-mask-v1`
RunPod evidence retrieved: 2026-07-18T13:15:50Z
RunPod evidence expires: 2026-08-18T13:15:50Z (fail closed)

## Decision and scope

The main application remains JavaScript/TypeScript. A narrowly scoped Python service
under `services/sam-worker/` owns only segmentation inference. It is not an application
backend and has no route, UI, database, authorization, billing, registry, or production
admission integration.

The accepted model responsibilities are:

- Qwen is proposal-only semantic planning. It may later select or group immutable SAM
  candidate IDs. It cannot provide, repair, rescale, or alter segmentation geometry.
- Specialized OCR owns text transcription and text geometry.
- SAM 2.1 owns pixel masks and geometric cutout candidates.
- A separate future model owns background inpainting.

This first slice generates automatic candidates independently. Point and box modes exist
only for future trusted user interaction or a server-validated detector. The closed
authority enum excludes Qwen. A candidate has no semantic label and is not a scene layer.

No real model ran. An authorized evidence-acquisition step downloaded two copies of
the official archive, config, and checkpoint, compared them independently, retained
one canonical copy and paired retrieval evidence under ignored `.local-data`, and
discarded duplicate bodies only after comparison. It also retained exact OCI
manifest/config metadata without pulling a base layer. This milestone resolved and
downloaded the exact runtime wheels only for package-index identity, hash, metadata,
and license review; no wheel is tracked. The provider-free preparation performed no
local Docker build, base pull, artifact/model execution, endpoint, provider health
call, or external inference. A later, separately authorized first RunPod GitHub build
attempt reached the immutable-base package-metadata gate and failed there. It produced
no final image and performed no model-health activity. Subsequent authorized build
`ddad2cf2-5b79-490a-8646-669ae6649d05` on `runpod-sam-build-002` passed the repaired
base checks, but its initial acquisition attempt and automatic retry failed identically
at the first archive's pre-stream length-header gate. It also produced no final image
or worker, and no endpoint, GPU, model-health, fixture, inference, or other follow-on
provider operation occurred.

## Later health-only operational evidence

Later authorized operational evidence is distinct from both failed builds above. The
user-supplied registry/container lifecycle excerpt records that commit `63f3ad7`
produced registry tag
`registry.runpod.net/moodworks-fabrica-kit-runpod-sam-build-002-services-sam-worker-dockerfile:63f3ad7b4`.
Two health-triggered containers were created and started, then stopped and removed; a
third container creation subsequently appeared. Root-observed authorized authenticated
`GET /ping` probes timed out after exactly 180006 ms and 30006 ms with zero response
bytes and HTTP `000`. A separately approved diagnostic established that DNS resolution
and TLS negotiation worked.

No `POST /v1/masks` or inference request occurred. The supplied lifecycle excerpt
included neither application stderr nor a process exit reason and did not provide an
immutable image digest. It therefore establishes neither successful model load nor an
exact termination cause; the registry tag is not treated as a digest. The readiness
repair documented below remains uncommitted and unpushed and performed no provider
operation.

## Pinned model evidence

The selected implementation is Meta's official
[`facebookresearch/sam2`](https://github.com/facebookresearch/sam2) repository:

| Evidence                           | Pinned value                                                                         |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| Repository                         | `https://github.com/facebookresearch/sam2`                                           |
| Official repository commit         | `05d9e57fb3945b10c861046c1e6749e2bfc258e3`                                           |
| Model                              | `sam2.1_hiera_base_plus`                                                             |
| Runtime config identity            | `configs/sam2.1/sam2.1_hiera_b+.yaml`                                                |
| Checkpoint URL                     | `https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt` |
| Checkpoint byte size               | 323,606,802                                                                          |
| Checkpoint SHA-256                 | `a2345aede8715ab1d5d31b4a509fb160c5a4af1970f199d9054ccfb746c004c5`                   |
| Primary/runtime license            | Apache-2.0 `LICENSE`                                                                 |
| Bundled `cc_torch` runtime license | BSD-3-Clause `LICENSE_cctorch`, required because `sam2/csrc` is retained             |
| Artifact evidence finalized        | `2026-07-18T19:31:18Z`                                                               |
| Artifact evidence expires          | `2026-08-18T19:31:18Z`, or earlier official-source change/conflict                   |

The commit and URLs are official identities. Meta did not publish an authoritative
checkpoint checksum in the reviewed source. The checkpoint, archive, and config
digests below are therefore explicitly local evidence with the exact provenance
`Fabrica-observed SHA-256 from two byte-identical official-source downloads`; they are
not represented as publisher checksums. During this milestone, both copies were hashed
with `shasum -a 256` and `openssl dgst -sha256`, checked for exact size and byte
equality, and kept separate until comparison completed. One canonical body was
retained; the duplicate body was then discarded. Nothing in the ignored acquisition
directory is Git-tracked.

The current canonical acquisition evidence is separate from future Docker staging and
has this exact ignored repository-relative layout:

```text
.local-data/banner-ai/sam2-build-inputs/
  sam2-05d9e57fb3945b10c861046c1e6749e2bfc258e3.archive.tar.gz
  sam2-05d9e57fb3945b10c861046c1e6749e2bfc258e3.download-1.headers
  sam2-05d9e57fb3945b10c861046c1e6749e2bfc258e3.download-2.headers
  sam2.1_hiera_b_plus-05d9e57fb3945b10c861046c1e6749e2bfc258e3.config.yaml
  sam2.1_hiera_b_plus-05d9e57fb3945b10c861046c1e6749e2bfc258e3.download-1.headers
  sam2.1_hiera_b_plus-05d9e57fb3945b10c861046c1e6749e2bfc258e3.download-2.headers
  sam2.1_hiera_base_plus-092824.checkpoint.pt
  sam2.1_hiera_base_plus-092824.download-1.headers
  sam2.1_hiera_base_plus-092824.download-2.headers
  pytorch-2.5.1-cuda12.4-cudnn9-runtime.linux-amd64.manifest.json
  pytorch-2.5.1-cuda12.4-cudnn9-runtime.linux-amd64.config.json
  pytorch-2.5.1-cuda12.4-cudnn9-runtime.manifest-1.headers
  pytorch-2.5.1-cuda12.4-cudnn9-runtime.manifest-2.headers
  pytorch-2.5.1-cuda12.4-cudnn9-runtime.config-3.headers
  pytorch-2.5.1-cuda12.4-cudnn9-runtime.config-4.headers
  verified-members/
    LICENSE.apache-2.0-05d9e57fb3945b10c861046c1e6749e2bfc258e3
    LICENSE_cctorch.bsd-3-clause-05d9e57fb3945b10c861046c1e6749e2bfc258e3
    sav_dataset-LICENSE-05d9e57fb3945b10c861046c1e6749e2bfc258e3
    sav_dataset-LICENSE_DAVIS-05d9e57fb3945b10c861046c1e6749e2bfc258e3
    sav_dataset-LICENSE_VOS_BENCHMARK-05d9e57fb3945b10c861046c1e6749e2bfc258e3
```

The paired `.headers` files are retrieval evidence, not trusted identity sidecars or
Docker inputs. The five `verified-members` files are exact audited archive members.
No artifact/model code was executed, imported, or installed, and no checkpoint pickle
or tensor was deserialized.

A matching SHA-256 and size establishes byte identity with those observations. It does
not establish checkpoint safety, correctness, model semantics, tensor compatibility,
or freedom from malicious data. The checkpoint evidence is ZIP-structure-only and made
no semantic/tensor safety claim. Production still verifies every artifact and uses
`weights_only=True`; neither step turns a hash into a safety proof.

Meta and artifact evidence must be rechecked before controlled acquisition and at or
before expiry. Stale, missing, or conflicting evidence blocks build and execution.

The direct-hosting decision is based only on the official RunPod
[load-balancing overview](https://docs.runpod.io/serverless/load-balancing/overview),
[load-balancing worker guide](https://docs.runpod.io/serverless/load-balancing/build-a-worker),
[endpoint overview](https://docs.runpod.io/serverless/endpoints/overview), and
[GitHub integration guide](https://docs.runpod.io/serverless/workers/github-integration).
They were retrieved at exactly `2026-07-18T13:15:50Z`. The reviewed facts are:

- a Load Balancer endpoint routes HTTP directly to an available worker, bypasses the
  queue, permits a custom FastAPI contract, drops excess work rather than buffering a
  backlog, and has no built-in automatic retry;
- its URL shape is `https://ENDPOINT_ID.api.runpod.ai/YOUR_CUSTOM_PATH`, and official
  authenticated examples send `Authorization: Bearer RUNPOD_API_KEY`;
- the application port defaults to `PORT=80`; `PORT_HEALTH` defaults to the same port
  and the default health path is `/ping`;
- RunPod treats `/ping` status `200` as healthy. The active worker deliberately uses
  bodyless `204` only for exact staged/loading state, redacted `503` for every other
  not-ready state, and `200` only after its one model is fully loaded and
  inference-ready;
- the provider documents a two-minute no-worker request timeout, a 5.5-minute
  per-request processing timeout, and a 30 MB request and response payload limit; the
  Fabrica boundary below is deliberately stricter;
- GitHub integration can select a repository, branch, and Dockerfile and then build,
  store, and deploy the image. The fixed future source is repository
  `moodworks/fabrica-kit`, branch `main`, Dockerfile
  `services/sam-worker/Dockerfile`, with repository-root context. No additional build
  is authorized by this repair, and the reviewed official guide supplies no automatic
  build-argument Git-SHA contract.

Native construction and execution fail closed at or after
`2026-08-18T13:15:50Z`. An earlier material change, removal, or conflict in any reviewed
official page also requires evidence renewal before native use. The deterministic fake
does not depend on live provider evidence and remains available after expiry.

## Reviewed artifact and container boundary

The tracked `services/sam-worker/artifact-manifest.json` is a closed,
self-digesting contract with reviewed SHA-256
`baab7246927ea22ac9f769cab60af2fc3c03fe3ef81aa9a660ab56441365647d`.
It records `artifactExecutionOccurred=false` and `modelInferenceOccurred=false`.

| Artifact                   | Exact observed identity                                                                                                                                                                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Official commit archive    | 55,631,013 bytes; SHA-256 `92c9e7ca3102fb8ef5953b0e80063a9ae77eb3d80fc54c498c1c6e2f71903dd6`                                                                                                                                                                                                                       |
| Archive inventory          | 652 entries: 561 regular, 87 directories, 4 symlinks; 64,496,345 regular-file bytes                                                                                                                                                                                                                                |
| Largest archive member     | `notebooks/video_predictor_example.ipynb`; 10,091,428 bytes; enforced ceiling 10,500,000                                                                                                                                                                                                                           |
| Runtime `sam2/**` tree     | 33 regular, 4 exact symlinks, 312,959 bytes; `fabrica-path-content-tree-v1` SHA-256 `66821e0f05bd53a04cee682c0e0b131f47fcea3b427522b1ff0ecc69c8be862a`                                                                                                                                                             |
| Config                     | 3,650 bytes; SHA-256 `e73f9e9547b305040552ee943ebd3a34cee5727a76fc2ab88b87f7b28b430754`; raw official URL bytes equal the archive member                                                                                                                                                                           |
| Upstream loader            | 4,934 bytes; SHA-256 `6df1b93a16c3eaf49334f74e831db91c67a0cf413b946d102333081722f20520`                                                                                                                                                                                                                            |
| Checkpoint                 | 323,606,802 bytes; SHA-256 `a2345aede8715ab1d5d31b4a509fb160c5a4af1970f199d9054ccfb746c004c5`                                                                                                                                                                                                                      |
| Checkpoint ZIP observation | root `sam2_hiera_b+_new`; 619 stored regular entries; 323,483,230 payload bytes; `data.pkl` 81,446 bytes                                                                                                                                                                                                           |
| Runtime Apache license     | `LICENSE`; 11,357 bytes; SHA-256 `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`                                                                                                                                                                                                                |
| Runtime BSD license        | `LICENSE_cctorch`; 1,566 bytes; SHA-256 `687d4f65ffe399358b170e22572564a16689e496f85a79dc5385fccf6bbc9558`                                                                                                                                                                                                         |
| Archive-only licenses      | `sav_dataset/LICENSE`: 1,514 bytes, `28b6f4b85d4f6867c99bcba442d3e0bffc4e6f1a6e04e210a4bb9c9a3b56306a`; `LICENSE_DAVIS`: 1,550 bytes, `a727bc2b6f26a1f1c76d0511502da6ba208212708c04a65230159331906354f1`; `LICENSE_VOS_BENCHMARK`: 1,048 bytes, `104f011f1cd91268d54a9fab1ff769ef01081410cd622e0f723c03d146d02482` |

The path/content tree digest begins with
`fabrica-path-content-tree-v1\0`, sorts UTF-8 paths bytewise, omits directories,
and domain-separates regular-file path/size/content-hash records from symlink
path/target records. The four exact symlinks are the base-plus, large, small, and tiny
root YAML aliases into `sam2/configs/sam2/`; any other link or target fails.

Archive verification happens after exact whole-file size/SHA verification. It requires
one exact top-level commit directory, canonical collision-free paths, regular files,
zero-payload directories, four allowlisted non-escaping symlinks to regular members,
the exact five case-sensitive `LICENSE*` family paths, and zero case-sensitive
`NOTICE*` family paths. Hard links, devices, FIFOs, absolute/traversal paths, duplicate,
case-colliding, and NFC-colliding paths fail.

Checkpoint review uses only `zipfile` metadata and CRC reads. Every member must be
`ZIP_STORED`, regular, unencrypted, under the one exact root, and one of
`data.pkl`, `byteorder`, `version`, `.data/serialization_id`, or `data/0` through
`data/614`. No pickle or tensor is deserialized during structural audit.

Safe extraction never uses `tar --extract`. It accepts only empty real destination
directories, writes only verified `sam2/**` regular files and the two runtime licenses
with `O_EXCL` and `O_NOFOLLOW`, then creates only the allowlisted links and re-verifies
the complete runtime tree. The final stage receives no archive, broad source snapshot,
base metadata, acquisition scratch, or archive-only license.

The immutable base is exactly
`pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime@sha256:c8268a92a69bd500f8be0e665b2630ee006dadaf7bfbc24249141b15ff622755`
for `linux/amd64`. Its raw manifest is 1,366 bytes with that same digest; its exact
4,665-byte config has SHA-256
`946241f40f56c5ac17b12be451a9ff6bf7163acaac37d1f15bbc7404f4394e57`.
The verifier binds the config descriptor and platform without pulling layers.
The retained OCI config records the bare `PYTORCH_VERSION=2.5.1` value in final `Env`,
`CUDA_VERSION=12.4.1` and `TARGETPLATFORM` in build history, Ubuntu 22.04 in OCI
labels, and `amd64`/`linux` in platform fields. CUDA is not a final environment
observation. cuDNN 9 is only the reviewed `cudnn9` tag identity. That bare OCI
environment value is distinct from installed Python distribution metadata. The first
separately authorized GitHub build reached and failed at the old base-package gate;
the repaired contract binds exact installed identities `torch==2.5.1+cu124` and
`torchvision==0.20.1+cu124`, with compatibility
`torch==2.5.1+cu124`. The build gates query `importlib.metadata` without importing
torch or torchvision.

CPython 3.11 major/minor is the only current interpreter compatibility claim. The
retained OCI metadata does not expose the exact Python patch, and no base layer was
pulled locally or executed, so the manifest stores `patch=null`. It does not bind an
unacquired upstream Dockerfile or claim OCI evidence proved Python. Both Docker stages
assert only the 3.11 major/minor tuple; a later completed-image inventory must record
the exact patch. Health performs artifact verification only and does not eagerly
import torch or load the engine. Neither failed build produced a final image or model
health evidence.

The production automatic generator profile is frozen explicitly:

```text
points_per_side=32
points_per_batch=64 (semantic ceiling; runtime applies a lower source-dependent cap)
pred_iou_thresh=0.8
stability_score_thresh=0.95
stability_score_offset=1.0
mask_threshold=0.0
box_nms_thresh=0.7
crop_n_layers=0
crop_nms_thresh=0.7
crop_overlap_ratio=512/1500
crop_n_points_downscale_factor=1
point_grids=None
min_mask_region_area=0
output_mode=uncompressed_rle
use_m2m=false
multimask_output=true
```

The sampling, crop, score and stability values above are the pinned semantic generator
settings. The worker invokes Meta's pinned private `_process_batch` path, not an
alternative segmentation implementation. For each source it lowers `points_per_batch`
from the semantic ceiling using one conservative 268,435,456-byte pool. Before sizing
the current batch, the pool reserves 32,000,000 bytes for all 8,000,000 possible retained
four-byte compact RLE runs from current/prior batches and 8,388,608 bytes for their
bounded list/dictionary and candidate metadata.

For each emitted mask, the remaining pool charges 112 bytes per source pixel:

| Pinned lifetime or overlap                                      | Bytes/mask-pixel |
| --------------------------------------------------------------- | ---------------: |
| Full-resolution float32 logits                                  |                4 |
| Input/flattened boolean mask storage                            |                1 |
| Preflight difference boolean                                    |                1 |
| Official encoder difference boolean                             |                1 |
| Worst-case two-column int64 `change_indices`                    |               16 |
| Full-batch change-index selector                                |                1 |
| Filtered, offset, concatenated, and differenced int64 tensors   |               32 |
| CUDA-to-CPU int64 tensor                                        |                8 |
| Retained Python integers plus destination-list pointers         |               36 |
| Temporary `tolist()` pointer array overlapping destination list |                8 |
| Four-byte compact array overlapping its Python count list       |                4 |
| **Conservative per-mask/pixel total**                           |          **112** |

Each emitted mask also charges 262,144 bytes for its float32 256×256 low-resolution
output, and every point is charged for three multimask outputs. The accounting
intentionally sums allocations from different pinned encoder lifetimes rather than
assuming timely allocator reuse. If one three-mask point cannot fit after fixed reserves,
the worker rejects automatic mode before inference.

For the 738×255 milestone fixture, three points account for 232,443,424 bytes including
fixed prior-batch reserves and are accepted; four account for 296,461,696 and are
refused. The effective fixture batch is therefore 3, below the semantic ceiling of 64.

Immediately before the pinned `mask_to_rle_pytorch` can allocate Python run lists, a
wrapper counts actual transitions without creating a run list and reserves them against
an 8,000,000-run cumulative request budget. It then calls the pinned encoder. The
surrounding `_process_batch` wrapper validates the exact pinned `MaskData` fields and
run counts, deletes unused `low_res_masks`, converts every count list to a four-byte
unsigned-int array, and caps retained raw candidates at 512 before the crop accumulator
can retain the batch. All temporary method/function overrides and the dynamic batch
value are restored in `finally` while the engine lock is held.

`output_mode=uncompressed_rle` is therefore only an internal compact handoff. Before
decoding any candidate to an H×W byte mask, the worker again validates every compact
record and rejects `candidateCount*sourcePixels` above the 256 MiB aggregate raw-mask
working budget. It then uses the pinned official RLE decoder. No Meta RLE crosses the
worker boundary; the external response remains the strict Fabrica binary RLE below.
The documented 256 MiB figure bounds these explicitly accounted batch allocations; it
does not claim to bound the warm model, embeddings, CUDA allocator overhead, Python
runtime, or undocumented third-party kernel scratch space.

## Architecture

```text
server-owned normalized RGBA PNG
        |
        v
TypeScript closed request + direct-v2 execution authorization
        |
        +--> deterministic fake transport (zero network; fake identity only)
        |
        `--> server-only RunPod Load Balancer transport (inactive)
                 POST https://{endpointId}.api.runpod.ai/v1/masks
                 |
                 v
        Python strict FastAPI/PNG/request boundary
                 |
                 v
        injectable segmentation engine
          fake in tests | pinned warm SAM in production
                 |
                 v
        deterministic filter, RLE and response digest
                 |
                 v
        TypeScript strict response verification
                 |
                 v
        provider-free cutout materializer
```

The public package exports capability contracts only. The RunPod adapter, native
transport, API-key reference, deterministic provider fake, demo runner, and sharp-backed
materializer remain direct server/test imports and are absent from the package's public
browser graph.

The active topology has no queue runtime, queue authorization builder, queue fallback,
provider-selection flag, browser/package export, `/run` or `/runsync` request, polling,
retry loop, or cancellation route. The retired queue foundation exists only in Git
commit `9f28c11ff5e17c84aef3a36d75117547ccc0b34b` and in explicit rejection coverage and
this architectural record. It is not an alternate execution path.

### Python worker

The worker is a one-process FastAPI application launched by
`python -m sam_worker.server`. Uvicorn binds `0.0.0.0`, uses `PORT` with exact default
`80`, and is fixed to one worker process with reload and access logging disabled.
`PORT_HEALTH`, when supplied, must equal `PORT`; `HEALTH_CHECK_PATH`, when supplied,
must be `/ping`.

The only routes are exact `GET /ping` and `POST /v1/masks`. Query strings, trailing-path
variants, redirects, framework documentation, OpenAPI, Redoc, CORS, and administrative
or debug routes are absent. Inference accepts one unencoded `application/json` header
and a bare closed `sam-mask-v1` request. It rejects queue `{id,input}` envelopes, URLs,
duplicate JSON keys, invalid UTF-8 or BOMs, non-finite JSON numbers, unknown fields, and
an over-limit body before contract parsing. It returns one bare closed `sam-mask-v1`
response, never a provider job envelope.

Before inference, the worker validates:

- a closed request and every closed nested object;
- canonical lowercase UUID identities and `sam-mask-v1`;
- canonical padded RFC 4648 Base64;
- byte count and exact source SHA-256;
- PNG signature, chunk CRCs and ordering, no trailing or unknown chunks;
- exactly 8-bit RGBA, non-interlaced PNG with declared dimensions;
- bounded streaming decompression and all PNG filters 0 through 4;
- side, pixel, decoded allocation, prompt, request, and output limits.

Production startup first performs a light, stdlib-only preflight over the reviewed
manifest, runtime source directory, checkpoint, two exact runtime licenses,
selected-config adapter/overlay/loader, exact requirements lock, wheel manifest,
dependency-license inventory, and installed runtime-dependency directory. It checks
the evidence window, strict manifest identity, types, sizes, closed dependency graph,
exact installed distribution versions, and protected namespaces without importing
torch or hashing the checkpoint. The background attempt then verifies the entire
runtime source tree, config, upstream loader, checkpoint size/SHA/ZIP structure,
licenses, overlay, selected loader, dependency inputs, and installed closure before
any torch, NumPy, or SAM import.

Only after full verification does the hash-bound selected-config loader parse the
exact 3,650-byte YAML, require its exact 14 target path occurrences and 12 unique
target strings, directly construct the reviewed graph, move the one model to the
selected device, and put it in evaluation mode. The four-file overlay bypasses only
the upstream Hydra initializer and supplies a fixed-redacted refusal for the otherwise
unused iopath open call; it makes no general Hydra or iopath compatibility claim.
Exactly `torch.load(checkpoint, map_location="cpu", weights_only=True)` then reads the
checkpoint. Its top level must be exactly `{model}`, the state must be nonempty with
string keys, and explicit missing or unexpected state keys fail startup. The exact
model loads once per warm worker. Requests execute in inference mode with CUDA when
available and CPU as the supported fallback. Request-specific predictor and CPU/GPU
objects are cleared in `finally`; the verified warm model remains. No download occurs
at container startup or request time, and inference source has no network client.

Readiness is a cached four-state process contract:

| Cached state              | `/ping` | Body                 | Inference |
| ------------------------- | ------: | -------------------- | --------- |
| `model-not-staged`        |     503 | strict redacted JSON | refused   |
| `model-staged-not-loaded` |     204 | empty                | refused   |
| `model-loaded-ready`      |     200 | strict redacted JSON | eligible  |
| `startup-blocked`         |     503 | strict redacted JSON | refused   |

All health responses use `Cache-Control: no-store` and omit `Retry-After`. Only the
exact staged-not-loaded state returns a bodyless `204`; it carries neither
`Content-Type` nor `Content-Length`. The official provider mapping is `204` =
initializing, `200` = healthy, and every other status = unhealthy and removed from
routing. The staged presence set is the manifest, runtime source root, checkpoint,
adapter profile, overlay, model loader, requirements lock, wheel manifest,
dependency-license inventory, installed runtime-dependency root, Apache license, and
BSD license. Only the full set plus a successful light preflight permits the FastAPI
lifespan to start one background `asyncio.to_thread` model-load task. Partial or
invalid staging is blocked; no identities means not staged. One process owns one warm
model. `/ping` remains responsive with `204` while full hashing/load runs, becomes
`200` only after successful model load and execution-identity verification, and
becomes redacted JSON `503` if startup blocks. `POST /v1/masks` remains redacted `503`
unless the cached state is exactly `model-loaded-ready`.

The `uvicorn.error` logger receives an initial fixed code for the production
classification and one terminal fixed ready or blocked code after the background
attempt. The mapping contains only literal messages for the four closed states; it
does not interpolate an exception, path, state value, or observed detail and does not
attach `exc_info`.

After readiness, `/v1/masks` acquires its one nonblocking admission permit before
buffering the body. A second request receives `429` immediately; there is no application
backlog. The permit is released only after blocking inference and response construction
finish. If the client disconnects after inference begins, the engine may finish while
the permit remains held; neither worker nor adapter claims GPU cancellation.

The two legacy example manifests were removed. The one tracked artifact manifest binds
repository/archive/tree/config/loader/model/checkpoint/license/base identities, exact
absolute image paths, evidence state, and the dependency build gate. Missing or extra
keys, re-signed foreign identities, unresolved required digests, expiry, and runtime
drift fail closed.

### Dependency and Docker build gate

The manifest now records `buildStatus=reviewed-wheel-only-ready` and binds three
canonical CPython 3.11/Linux AMD64 dependency inputs:

| Input                      | Bytes | SHA-256                                                            |
| -------------------------- | ----: | ------------------------------------------------------------------ |
| `requirements.lock`        | 1,535 | `a52ec65c9bb270eef33a71dbf8971731dbf99135ecdffad6f392e39b6c42d525` |
| `wheelhouse-manifest.json` | 5,741 | `390054e8574bda53e710cefcbeb44a5dcdaba35f79cf4cfa029bf079deadd39b` |
| `dependency-licenses.json` | 5,036 | `2ff748f49c22662c25058397606f419bd5cc213d6797e3be7f6a8e4f9e52a95e` |

The exact 16-wheel runtime closure is `annotated-types==0.7.0`,
`anyio==4.14.2`, `click==8.4.2`, `fastapi==0.115.12`, `h11==0.16.0`,
`idna==3.18`, `numpy==1.26.4`, `pillow==11.0.0`, `pydantic==2.13.4`,
`pydantic-core==2.46.4`, `pyyaml==6.0.2`, `starlette==0.46.2`,
`tqdm==4.67.1`, `typing-extensions==4.16.0`,
`typing-inspection==0.4.2`, and `uvicorn==0.34.2`. Every package has one exact
wheel filename, size, SHA-256, official `files.pythonhosted.org` URL,
package-level distribution license identity, and reviewed active `Requires-Dist`
edges. NumPy and Pillow bundled notices remain retained in their wheel/install
license files; the inventory is not a normalized component SBOM.

The deterministic lock grammar remains one sorted unique
`canonical-name==version --hash=sha256:<64-lowercase-hex>` record per line with a final
newline. URLs, VCS, editables, local paths, includes/options, markers, extras,
index/find-links directives, source distributions, and base-owned packages fail.
Wheel verification requires an exact regular non-symlink directory inventory,
collision-free names, CRC-valid ZIPs, matching `METADATA`/`WHEEL`/`RECORD`, compatible
CPython 3.11 Linux AMD64 tags, and exact dependency metadata. Protected top-level
`sam_worker`, `sam2`, `torch`, `torchvision`, `nvidia`, and `triton` namespaces fail.
The immutable base owns asserted `torch==2.5.1+cu124` and compatible
`torchvision==0.20.1+cu124`; neither is reinstalled.

The fixed future GitHub source is repository `moodworks/fabrica-kit`, branch `main`,
Dockerfile `services/sam-worker/Dockerfile`, repository-root context, and
`linux/amd64`. `Dockerfile.dockerignore` is default-deny and re-includes every exact
tracked `COPY` source. The build needs no local artifact staging, absolute developer
path, untracked wheel, Git LFS object, developer cache, Docker secret, or file outside
that context. These accepted changes remain uncommitted and unpushed, so the remote
builder cannot consume them until a separately authorized reviewed commit and push.

The acquisition stage is the only network-enabled `RUN`. Before creating its
proxy-disabled, redirect-refusing opener, it verifies the manifest-bound lock,
wheelhouse manifest, and dependency-license bytes and proves their exact
lock-to-filename/version/hash-to-license closure. It downloads only the reviewed
official archive, checkpoint, and 16 wheel URLs; rejects alternate hosts, redirects,
changed effective URLs, queries, fragments, credentials, ports, non-200 status, and
nonidentity content encoding. `Content-Length` and `Transfer-Encoding` are advisory
framing metadata even when absent, malformed, stale, or exact; neither can accept,
reject, or substitute for body verification. Each identity-encoded response is read
with an expected-size-plus-one ceiling and is accepted only when its actual final byte
count and SHA-256 match the reviewed pins. Short or long streams, wrong digests, and
transport failures use fixed artifact-kind redacted codes. The stage then audits
archive/checkpoint/wheel structure and emits one closed build-input directory.

The final stage starts again from the immutable PyTorch base digest, copies only the
closed inputs, and mounts the verified wheelhouse read-only. Every final-stage `RUN`
uses `--network=none`. Installation is
`--no-cache-dir --no-compile --no-index --only-binary=:all: --no-deps
--find-links=file:///opt/fabrica/wheelhouse --require-hashes`. The unused pip
console-script directory is removed. The reviewed NumPy wheel ships one bytecode cache,
so the same offline `RUN` removes all `.pyc` and empty `__pycache__` paths and asserts
none remain. The wheelhouse, acquisition program, broad archive, scratch, Git metadata,
and download/bytecode caches do not enter the final image. Runtime files are
root-owned/read-only; the server exposes `80/tcp` and runs as UID/GID 10001.

Installed verification proves the exact distribution name/version closure and rejects
protected namespace shadowing; it is not a full base-image/filesystem SBOM. The
immutable base owns `/opt/conda`, Python, torch, pip, and any base-retained tools or
caches. A later authorized image inventory must assess them before promotion;
`/opt/conda` cannot be removed because it owns the runtime.

OCI labels bind the source repository, supplied revision, SAM commit/model/config and
config digest, checkpoint digest, artifact manifest, hosting/direct/runtime profile
digests, and build contract. The only build argument is `FABRICA_GIT_SHA`: a lowercase
nonzero 40-hex SHA or the exact sentinel `unavailable`. The sentinel is not a SHA and
makes no revision claim. No official GitHub integration contract is assumed to inject
one automatically. The Dockerfile/build defines or copies no secret or provider key;
none may enter a build argument, layer, or label. The image label
`io.fabrica.image-use=health-only-non-promotable-v1` is mandatory. This milestone's
image remains non-promotable even if a real SHA is later supplied; the repository
worker source is not independently manifest-hashed as a complete source bundle, and
image inventory/model-load/GPU-health gates remain.

A bounded provider-free `git ls-files -z` test continues to reject tracked
model/checkpoint/archive/wheel suffixes and exact artifact basenames and checks that no
downloaded binary reaches Banner AI package exports or web source.

### TypeScript server adapter

The server configuration contains one lowercase DNS-label endpoint ID. The adapter
derives exactly `https://<endpoint-id>.api.runpod.ai/v1/masks`; request/browser data
cannot supply an endpoint. It sends one canonical bare `sam-mask-v1` JSON body containing
normalized PNG bytes, never a wrapper or remote image URL.

`RUNPOD_API_KEY` is a server-only reference. Its value is captured only inside the
private native transport and is sent only as the `Authorization: Bearer ...` header.
The returned transport exposes neither the value nor an arbitrary dispatch method:
single-use capabilities bind calls to the adapter. The native fetch boundary requires
the exact derived HTTPS host/path, no userinfo, port, query, fragment, redirect,
credentials, referrer, or cache, and one exact `application/json` response. Its fatal
UTF-8 streaming reader is bounded at the 12,000,000-byte application response ceiling.

Before dispatch, cancellation returns `PRE_DISPATCH_CANCELLED`. After the process-local
claim, timeout, caller cancellation, connection loss, response truncation, fetch/stream
failure, and every HTTP status at least 500 are terminal non-retryable
`INDETERMINATE`; remote completion is unknown and no cancellation is claimed. A strict
4xx response, including worker overload `429`, is `PROVIDER_FAILURE`. Unsupported
2xx/3xx status, content type, body, schema, digest, identity, or any queue envelope is
`RESPONSE_INVALID`. There is deliberately one client dispatch, zero client retry, zero
poll, and no cancel route. This no-retry rule applies to `POST /v1/masks`. A separately
authorized, bounded GET-only `/ping` readiness sequence may follow the official
recommendation of at least three attempts 5–10 seconds apart. That health sequence
creates no inference claim, dispatch, or retry authority; a cold-start/no-worker result
on the one authorized POST remains terminal under the failure semantics above.

The process claims a job/attempt immediately before dispatch and rejects duplicate
dispatch. That guarantee is deliberately process-local. Production activation also
requires the existing durable job/attempt/provider-dispatch claim and provider-usage
accounting.

Live construction and dispatch require all of:

- one configured endpoint ID;
- the server-owned `RUNPOD_API_KEY` reference and nonempty server-supplied value;
- exact reviewed model/config/checkpoint identity with a non-placeholder digest;
- a single-use, unexpired `single-fixture-sam-runpod-direct-v2` authorization matching
  source byte count, dimensions, digest, endpoint, limits, authorization ID, and
  automatic mode;
- an independently supplied, nonzero `sha256:<64-lowercase-hex>` image digest that must
  equal the authorization image digest before a dispatch claim;
- a `clientWallTimeoutMs` no greater than the provider-documented 330,000 ms processing
  ceiling, plus an exact positive micro-USD cost cap;
- exact minimum mask area, maximum candidate count, and
  `fabrica-binary-rle-v1` output identity;
- the exact documentation retrieval/expiry tuple and all three reviewed profiles:
  - direct hosting SHA-256
    `2e5d64b6741802f7963fa678d174fca92a367a32672764fae5831c3131702f3a`;
  - direct adapter V2 SHA-256
    `c114b8b0bc3030ef2d7df524c88bd1710c9e6bc264d186c6b9e8ee7845718747`;
  - direct authorization V2 SHA-256
    `c1ab605534b23b8aa6be2433b333696eeed9f13e1f87be76a49e60a26bc7509e`.

The authorization says `clientDispatchMaximum=1`,
`applicationInferenceMaximum=1`, `clientRetryCount=0`, and `pollCount=0`. It explicitly
says `providerBillingGuarantee=false`: direct/no-retry behavior does not prove a billing
outcome. It grants neither production admission nor a web route.

Telemetry is a closed allowlist: request ID, attempt ID, endpoint ID, status, candidate
count, and redacted failure class. It cannot contain image bytes/Base64, API keys,
authorization headers, raw masks, response bodies, or arbitrary exceptions.

## Contracts and limits

The source coordinate system is integer basis points from 0 through 10000, top-left
origin, +X right, +Y down. Point conversion is
`min(dimension-1, floor(bp*dimension/10000))`. A trusted positive-extent box is converted
to a half-open pixel box with floor at its start and ceil at its end; the SAM predictor
receives inclusive maximum pixels. Mask-derived response bounds round outward using the
same basis.

Request modes are:

- `automatic-candidates` with `{kind:"none"}`;
- `point-prompt` with 1–32 positive/negative trusted points and at least one positive;
- `box-prompt` with one trusted, positive-extent source-relative box.

The boundary rejects URL/SVG/JPEG inputs, unknown fields, unknown authority, foreign
digests, invalid PNGs, dimension drift, empty/out-of-range/non-finite prompts, arbitrary
models/configs/checkpoints, endpoint input, or checkpoint paths.

RunPod's reviewed Load Balancer documentation allows 30 MB for each request and response.
The application never relies on that outer maximum. Its stricter hard limits are:

| Limit                           |                              Value |
| ------------------------------- | ---------------------------------: |
| Source PNG                      |                   12,000,000 bytes |
| Source Base64                   |              16,000,000 characters |
| Bare canonical request JSON     |                   16,100,000 bytes |
| Side / pixels / RGBA allocation |    4,096 / 16,777,216 / 67,108,864 |
| Raw engine candidates           |        512 (513 fails the request) |
| Automatic batch accounted peak  |                  268,435,456 bytes |
| Retained automatic RLE runs     | 8,000,000 (32,000,000 count bytes) |
| Automatic metadata reserve      |                    8,388,608 bytes |
| Aggregate raw mask working set  |                  268,435,456 bytes |
| Returned candidates             |          request bound, maximum 64 |
| One binary RLE                  |                    1,000,000 bytes |
| Total returned binary RLE       |                    8,000,000 bytes |
| Bare worker response JSON       |                   12,000,000 bytes |

The strict response repeats request/workspace/job/attempt/source identity, exact execution
identity, integer timings, exact filter accounting, count, ordered candidates, and a
response digest. The fake execution union contains only fake engine identity,
definition digest, and `NOT_SAM_OUTPUT`; it cannot claim Meta model/config/checkpoint
identity. The live union contains only the exact reviewed Meta identity. It remains
unconstructable in this milestone because no built image digest, endpoint, GPU/model
health evidence, or execution authorization exists.

## Mask encoding and deterministic filtering

`fabrica-binary-rle-v1` is a lossless binary format:

```text
"FBRL"                  4 ASCII bytes
version                 uint8, exactly 1
width, height           uint32 big-endian
first value             uint8, 0 or 1
run count               uint32 big-endian
run lengths             positive, minimal unsigned LEB128
```

Pixels are row-major. Runs must sum to exactly `width*height`; zero, overlong,
non-minimal, overflowing, truncated, or trailing data is rejected. Transport Base64 is
canonical padded RFC 4648.

The mask-content digest is SHA-256 over:

```text
"sam-mask-content-v1\0" || width:u32be || height:u32be ||
row-major mask bits packed MSB-first
```

Unused low bits in the final byte are zero. Candidate ID is `samc_v1_` plus SHA-256 over:

```text
"sam-mask-candidate-id-v1\0" || source-sha256:raw32 ||
width:u32be || height:u32be || mask-sha256:raw32
```

Scores must be finite in `[0,1]` and use half-up basis-point quantization
`floor(score*10000+0.5)`. Area ratio is
`floor(pixelArea*10000/sourcePixels)`. Prompt-mask stability uses logits `>1.0` for the
intersection and `>-1.0` for the union, returning zero for an empty union.

Filtering is deterministic:

1. validate no more than 512 raw records and the 256 MiB aggregate working budget
   before automatic compact RLE decoding; validate exact binary dimensions before
   post-processing;
2. sort by predicted IoU descending, stability descending, pixel area descending,
   basis-point box Y/X/width/height ascending, then mask SHA ascending;
3. keep the best exact duplicate; filter masks below the server minimum and exact
   full-canvas masks;
4. skip individual RLE over 1 MB; walk stable order, skipping masks that exceed the
   total 8 MB budget or requested/64 count;
5. retain, never merge or repair, remaining overlaps; flag pair containment at 9800
   basis points and IoU overlap at 5000 basis points; flag source-edge contact;
6. emit review flags in the closed order `near-contained`, `overlapping`,
   `touches-source-edge`.

Score ties therefore remain portable across Python and TypeScript. The shared
`services/sam-worker/protocol-vectors.json` is consumed by both test suites.

The response SHA-256 covers UTF-8 canonical JSON with recursive ASCII key ordering,
array order preserved, and no whitespace, omitting only top-level `responseSha256`.
TypeScript re-decodes every mask and recomputes source, response, mask, candidate,
bounds, area, flag, filter-accounting, and execution identities.

## Transparent cutout materialization

The provider-free TypeScript materializer takes trusted normalized source bytes and one
validated candidate. It revalidates the PNG and candidate, decodes the RLE, and derives
the exact pixel crop from mask pixels rather than trusting reported bounds.

The cutout contains original RGBA only for selected pixels in the derived crop. Every
pixel with alpha zero has RGB set to zero, including a source-transparent selected pixel,
which prevents hidden edge-color leakage. The binary mask PNG is a full source-sized
black/white image. Sharp receives fixed PNG options and no source metadata. The source
buffer and stored normalized source remain immutable.

Filenames derive only from source/candidate/mask digests. Reproduction metadata contains
no timestamp or absolute path and records exact crop, dimensions, encoding, filenames,
and source/mask/output digests.

## Provider-free demonstration

Run:

```bash
pnpm --filter @fabrica/banner-ai demo:sam-fake
```

It reads the unchanged package-owned fixture
`packages/banner-ai/test/fixtures/real-model-benchmark/normalized/banner-no-text-v1.png`
(738×255, 125,894 bytes,
`40f8a1c4312ec86cb4e38e16b9a423e85c2a9e3cf5f98a4bc510c23f3d4cf073`),
creates deterministic code masks, and materializes every output twice to prove byte
identity. The ignored output is:

```text
.local-data/banner-ai/sam-fake-vertical-slice/
```

Only `report.html` and the top-level `manifest.json` prominently carry
**DETERMINISTIC FAKE MASKS — NOT SAM OUTPUT**. That labeled set references the source,
overlay, cutout, binary-mask PNGs, and per-candidate reproduction JSON. The top-level
manifest binds execution identity `kind=deterministic-fake` and
`notice=NOT_SAM_OUTPUT`; the transport reports zero network calls. Individual PNGs and
reproduction JSON do not each embed the banner, and none is represented as SAM output.

## Future controlled deployment

The accepted repair changes remain uncommitted and unpushed. Do not start another
RunPod GitHub build or create an endpoint until a separately authorized reviewed commit
and push to `main` makes every repaired build input available to the remote
repository-root context. The first authorized attempt stopped at the base-package gate
before final image completion. Build
`ddad2cf2-5b79-490a-8646-669ae6649d05` and its automatic retry later stopped at the
first archive's pre-stream length-header gate. Neither produced a final image. The
later `63f3ad7b4` registry tag exists, but the supplied lifecycle evidence contains no
immutable image digest, so none is claimed.

The exact next console configuration after a reviewed commit of this repair remains
health-only:

| Setting                          | Value                            |
| -------------------------------- | -------------------------------- |
| Endpoint type                    | Load Balancer                    |
| Repository                       | `moodworks/fabrica-kit`          |
| Branch                           | `main`                           |
| Dockerfile                       | `services/sam-worker/Dockerfile` |
| Container port                   | `80`                             |
| Health path                      | `/ping`                          |
| Inference path                   | `/v1/masks`                      |
| Active/minimum workers           | `0`                              |
| Maximum workers                  | `1`                              |
| GPUs per worker                  | `1`                              |
| GPU group                        | A4000 / A4500 / RTX 4000, 16 GB  |
| Maximum hourly price             | `$0.75`                          |
| Total health-only deployment cap | `$2.00`                          |

That configuration uses no queue endpoint, automatic/client retry, fixture upload, or
inference POST. It injects no build secret or provider key. The first separately
authorized exercise may inspect the built image inventory and perform bounded
authenticated GET-only health checks. `/ping` must remain non-`200` until the exact
model is loaded and inference-ready: `204` is the bodyless staged/loading signal and
redacted `503` covers every other not-ready state. It may return `200` only afterward.
If health does not reach `200` within the explicit cost/time authorization, stop and
scale back to zero without inference.

The image remains labeled
`io.fabrica.image-use=health-only-non-promotable-v1`. Supplying a real
`FABRICA_GIT_SHA` improves source provenance but does not promote the image. The
literal `unavailable` default is not a SHA and makes no revision claim. Before any
promotion or inference authorization, a later review must record the actual final image
digest, exact base Python patch, installed/base filesystem inventory, base-retained
tools and caches, non-root/read-only inventory, successful one-model load, redacted
logs, GPU health, and all profile/manifest identities.

A later inference exercise remains outside this milestone and still requires a new,
unexpired, single-use authorization bound to the endpoint, immutable image digest,
model/config/checkpoint, exact fixture bytes/dimensions/digest, limits, cost cap, one
dispatch, and zero retry/poll. No health-only configuration grants POST, inference,
production admission, billing, or web-route authority.

No local Docker build or base pull, fixture upload, torch/SAM execution, checkpoint
load, or GPU inference was performed by this repair. The separately authorized first
RunPod GitHub build attempt failed at the base-package gate. Subsequent authorized build
`ddad2cf2-5b79-490a-8646-669ae6649d05` passed those repaired checks, then failed
identically on its automatic retry at the first archive's pre-stream length-header
gate. Neither produced a final image, worker, or model-health result. The later
authorized `63f3ad7` health-only evidence combines the user-supplied container
lifecycle excerpt with root-observed GET probes and a separately approved DNS/TLS
diagnostic. It records two timed-out GETs but no POST, inference, application stderr,
exit reason, immutable image digest, successful model load, or exact termination
cause. This current repair performed no provider operation. Matching reviewed hashes
establish artifact identity only; they do not prove artifact safety, semantic
compatibility, or model correctness.
