# Banner AI SAM 2.1 mask worker

Status: provider-free foundation; production execution inactive
Contract: `sam-mask-v1`
Evidence retrieved: 2026-07-18
Evidence expires: 2026-08-18T00:00:00Z (fail closed)

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

No real model ran, no checkpoint was downloaded, no image was built or published, no
RunPod endpoint was created, and no external inference call was made in this milestone.

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
| Checkpoint SHA-256                 | **Unknown: deployment-time blocking value**                                          |
| Primary license                    | Apache-2.0                                                                           |
| Optional bundled `cc_torch` notice | BSD-3-Clause, if included in the staged source                                       |

The commit is a pinned official repository commit, not a tagged release. No
authoritative checkpoint digest was published in the reviewed official evidence. This
document does not invent one. Retrieval, independent digest review, and a second
authorization are prerequisites for any build.

Evidence must be rechecked against official Meta sources after the expiry above. Stale,
missing, or conflicting evidence blocks build and execution.

The RunPod protocol evidence is the official
[handler-functions documentation](https://docs.runpod.io/serverless/workers/handler-functions),
[endpoint operation reference](https://docs.runpod.io/serverless/endpoints/operation-reference),
[request-policy documentation](https://docs.runpod.io/serverless/endpoints/send-requests),
and
[endpoint-configuration documentation](https://docs.runpod.io/serverless/endpoints/endpoint-configurations).
They support the standard `{id,input}` handler, `/runsync`, bounded payload/wait behavior,
execution policy, and provider status envelope used here. The endpoint documentation
also states that queue-based endpoints provide automatic retries. These sources were
retrieved on 2026-07-18 and share the 2026-08-18T00:00:00Z fail-closed expiry above.

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
TypeScript closed request + execution authorization
        |
        +--> deterministic fake transport (zero network; fake identity only)
        |
        `--> server-only RunPod /runsync transport (inactive)
                 |
                 v
        Python strict PNG/request boundary
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

### Python worker

The standard RunPod handler accepts exactly `{id,input}`. The provider `id` is transport
metadata and never substitutes for Fabrica request/job/attempt identity. The handler
decodes no URLs and returns only strict JSON data.

Before inference, the worker validates:

- a closed request and every closed nested object;
- canonical lowercase UUID identities and `sam-mask-v1`;
- canonical padded RFC 4648 Base64;
- byte count and exact source SHA-256;
- PNG signature, chunk CRCs and ordering, no trailing or unknown chunks;
- exactly 8-bit RGBA, non-interlaced PNG with declared dimensions;
- bounded streaming decompression and all PNG filters 0 through 4;
- side, pixel, decoded allocation, prompt, request, and output limits.

Production startup verifies the staged repository/config/checkpoint manifest and hashes
before importing torch or SAM. The exact model loads once per warm worker. Requests are
serialized through one process lock and execute under inference mode, with CUDA selected
when available and CPU as the supported fallback. Only request-specific predictor and
CPU/GPU cache objects are cleared in `finally`; the warm model remains. No code or model
download occurs at container startup or request time, and inference source has no
network client.

The controlled build uses a canonical pinned repository archive and its independently
reviewed archive SHA-256, not a mutable source directory or incomplete path list.
`build-input-manifest.example.json` is only the build review ledger.
`model-manifest.example.json` is the distinct exact eight-key runtime template:
`manifestVersion`, `repositoryUrl`, `repositoryCommit`, `modelId`, `configIdentity`,
`configSha256`, `checkpointUrl`, and `checkpointSha256`. The runtime rejects missing or
extra keys, placeholders, zero digests, and artifact digest drift.

### TypeScript server adapter

The server configuration contains one endpoint ID. The adapter derives
`https://api.runpod.ai/v2/<endpoint-id>/runsync?wait=300000`; request/browser data never
contains an endpoint. The adapter sends normalized PNG bytes inline, not a remote URL.

`RUNPOD_API_KEY` is a server-only reference. Its value is supplied only to the private
native transport and is never inspected by milestone tests. The native transport uses a
bounded streaming response reader, no redirects, no credentials, an abort signal, and
strict envelopes. A completed envelope requires `delayTime`, `executionTime`, `id`,
`output`, and `COMPLETED`, plus an optional bounded safe `workerId`. Non-completed
envelopes accept only `IN_QUEUE`, `IN_PROGRESS`, `RUNNING`, `FAILED`, `CANCELLED`, or
`TIMED_OUT` and their explicitly bounded optional timing, worker, and error fields. IDs
are 1–256 characters; provider timings are nonnegative integers no greater than
604,800,000. Unknown keys, fractional/oversized timings, and unsafe worker IDs fail
closed. Worker ID is never copied to telemetry.

Timeout or cancellation after dispatch, and provider states `TIMED_OUT`, `IN_QUEUE`,
`IN_PROGRESS`, or `RUNNING`, become terminal non-retryable
`INDETERMINATE`; this does not claim remote cancellation. Confirmed `FAILED` or
`CANCELLED` is a provider failure.

Once the native transport is invoked, any transport rejection—including fetch or
bounded response-stream failure—is also terminal non-retryable `INDETERMINATE`.
Malformed data returned by a completed transport remains `RESPONSE_INVALID`.

The process claims a job/attempt immediately before dispatch and rejects duplicate
dispatch. That guarantee is deliberately process-local. Production activation also
requires the existing durable job/attempt/provider-dispatch claim and provider-usage
accounting.

Live construction and dispatch require all of:

- one configured endpoint ID;
- the server-owned `RUNPOD_API_KEY` reference and nonempty server-supplied value;
- exact reviewed model/config/checkpoint identity with a non-placeholder digest;
- a single-use, unexpired explicit execution authorization matching source byte count,
  dimensions, digest, endpoint, limits, authorization ID, and automatic mode;
- an independently supplied, nonzero `sha256:<64-lowercase-hex>` image digest that must
  equal the authorization image digest before a dispatch claim;
- independently configured `clientWallTimeoutMs`,
  `providerExecutionTimeoutMs` (5 seconds through 7 days), and `providerTtlMs`
  (10 seconds through 7 days), all exactly bound by the authorization. The client wall
  timeout controls only this process's abort timer. The provider values are sent outside
  worker input as `{input,policy:{executionTimeout,ttl}}`. The authorization also binds
  the exact `minMaskAreaPixels`, `maxCandidates`, and `fabrica-binary-rle-v1` output
  identity; mutations fail before a dispatch claim.

This adapter makes one HTTP submission and has `clientRetryCount=0`. That is not a
strict one-inference or one-charge guarantee: RunPod documents automatic retries for its
queue-based endpoints, and `executionTimeout`/`ttl` do not disable them. A reviewed
official provider setting or guarantee that disables automatic job retries is therefore
a deployment blocker for the requested one-fixture/one-inference cost boundary. Until
that condition exists, `providerCallsMaximum=1` means one client dispatch only.

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

Hard limits are:

| Limit                           |                              Value |
| ------------------------------- | ---------------------------------: |
| Source PNG                      |                   12,000,000 bytes |
| Source Base64                   |              16,000,000 characters |
| Canonical request JSON          |                   16,100,000 bytes |
| Wrapped native body             |                   16,100,128 bytes |
| Side / pixels / RGBA allocation |    4,096 / 16,777,216 / 67,108,864 |
| Raw engine candidates           |        512 (513 fails the request) |
| Automatic batch accounted peak  |                  268,435,456 bytes |
| Retained automatic RLE runs     | 8,000,000 (32,000,000 count bytes) |
| Automatic metadata reserve      |                    8,388,608 bytes |
| Aggregate raw mask working set  |                  268,435,456 bytes |
| Returned candidates             |          request bound, maximum 64 |
| One binary RLE                  |                    1,000,000 bytes |
| Total returned binary RLE       |                    8,000,000 bytes |
| Worker response JSON            |                   12,000,000 bytes |
| Native provider envelope        |                   12,500,000 bytes |

The strict response repeats request/workspace/job/attempt/source identity, exact execution
identity, integer timings, exact filter accounting, count, ordered candidates, and a
response digest. The fake execution union contains only fake engine identity,
definition digest, and `NOT_SAM_OUTPUT`; it cannot claim Meta model/config/checkpoint
identity. The live union contains only the exact reviewed Meta identity and is
unconstructable while the checkpoint digest is unresolved.

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

`report.html`, `manifest.json`, overlays, cutouts, mask PNGs, and reproduction manifests
prominently say **DETERMINISTIC FAKE MASKS — NOT SAM OUTPUT**. The transport reports zero
network calls. These masks are not represented as SAM output.

## Future controlled deployment

Deployment remains blocked until every item below is reviewed:

1. Recheck official evidence before expiry. Retrieve the canonical official repository
   archive for the exact commit and the selected checkpoint in a separately authorized
   controlled environment.
2. Independently compute and record the complete repository archive, config, checkpoint, dependency
   lock, and wheel hashes. Resolve the checkpoint SHA-256 blocker; preserve Apache-2.0
   and applicable BSD-3-Clause notices. Stage only the verified canonical archive; the
   offline Docker build verifies its digest and exact single top-level commit directory
   before installation, so an unlisted source path cannot enter through a partial
   manifest.
3. Produce a `pip --require-hashes` lock and local wheelhouse for the exact pins in
   `requirements.in`. Stage all controlled inputs under the ignored build directory
   described by the worker README.
4. Independently review the digest for
   `pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime`, then build with its full
   `tag@sha256:digest`. Run unit, contract-vector, import/network, source, and container
   scans. Do not use a floating base.
5. Publish once to the approved registry; record and review the resulting image digest.
   Deploy RunPod from that image digest, never `latest`. Create one endpoint with no
   credentials in the image and configure the server-side API-key reference. Before
   execution authorization, obtain reviewed official evidence and endpoint configuration
   that disables provider-managed automatic job retries. If RunPod cannot provide that
   guarantee for this queue-based endpoint, stop: exact one-inference/cost authorization
   remains blocked.
6. Bind a new, single-use authorization to endpoint ID, immutable image digest, exact
   repository/model/config/checkpoint identity and digest, and only this fixture:
   738×255, 125,894 bytes,
   `40f8a1c4312ec86cb4e38e16b9a423e85c2a9e3cf5f98a4bc510c23f3d4cf073`.
   Authorize `automatic-candidates` only, the exact minimum mask area, maximum candidate
   count and Fabrica binary RLE output, one client provider call, zero client retries,
   an independent nonzero image digest, reviewed client wall timeout, provider execution
   timeout, provider TTL and cost cap, no production admission, no web route, and no
   Qwen geometry. Review the packet and secret isolation separately.
7. Only after that explicit authorization, dispatch one fixture once. Capture redacted
   telemetry and strict response evidence, inspect candidate masks, and stop. Any
   timeout/cancellation is indeterminate and receives no adapter retry. The reviewed
   provider no-automatic-retry condition in step 5 is what must make this a true
   one-inference evidence run.

That one-fixture run is evidence gathering only. It cannot activate production, change
the canonical scene schema, or grant Qwen geometric authority.
