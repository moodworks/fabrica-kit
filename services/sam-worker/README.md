# Fabrica SAM 2.1 worker

This directory is an isolated Python inference worker, not the Fabrica application
backend. It has no browser or application web-route entry point and never accepts a
provider endpoint, checkpoint path, model/config choice, URL, or credential in a mask
request.

The future container entry point is:

```text
python -m sam_worker.server
```

It starts one Uvicorn process for a future RunPod Load Balancer worker. The only exact
routes are `GET /ping` and `POST /v1/masks`; requests and responses are bare closed
`sam-mask-v1` JSON objects. There is no queue envelope, `/run`, `/runsync`, polling,
retry, cancellation, or request backlog.

## Provider-free tests

The unit suite injects fake engines. It does not import torch or SAM, require a GPU,
download a model, build a container, or make a provider call:

```bash
PYTHONPYCACHEPREFIX=/tmp/fabrica-sam-pycache \
PYTHONPATH=services/sam-worker \
python3 -m unittest discover -s services/sam-worker/tests -v
```

If the small dependencies from `requirements.test.in` are unavailable, five guarded
FastAPI/HTTPX surface tests skip while protocol, fake-engine, artifact, Git-boundary,
source, and Docker static tests still run. An existing disposable environment may be
used without changing the repository:

```bash
PYTHONPYCACHEPREFIX=/tmp/fabrica-sam-pycache \
PYTHONPATH=services/sam-worker \
/tmp/fabrica-sam-worker-test/bin/python \
  -m unittest discover -s services/sam-worker/tests -v
```

Creating or populating that environment is a separate dependency-acquisition action.

## Reviewed artifact identity

[`artifact-manifest.json`](./artifact-manifest.json) is the one strict, self-digesting
artifact contract. Its reviewed self-digest is
`84d7743701a0f9aa9d76716e771155fc6de6a0b6c5bc84746f55a8725f6a5529`.
Evidence was finalized at `2026-07-18T19:31:18Z` and fails closed at
`2026-08-18T19:31:18Z`, or earlier if an official source changes.
`artifactExecutionOccurred=false` and `modelInferenceOccurred=false`.

The official identities and Fabrica-observed byte identities are:

| Artifact                | Exact reviewed identity                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Meta repository         | `https://github.com/facebookresearch/sam2` at commit `05d9e57fb3945b10c861046c1e6749e2bfc258e3`                                                                                                                                                                                                                                            |
| Official commit archive | 55,631,013 bytes; SHA-256 `92c9e7ca3102fb8ef5953b0e80063a9ae77eb3d80fc54c498c1c6e2f71903dd6`                                                                                                                                                                                                                                               |
| Runtime `sam2/**` tree  | 33 regular files, 4 allowlisted symlinks, 312,959 regular-file bytes; path/content SHA-256 `66821e0f05bd53a04cee682c0e0b131f47fcea3b427522b1ff0ecc69c8be862a`                                                                                                                                                                              |
| Selected raw config     | 3,650 bytes; SHA-256 `e73f9e9547b305040552ee943ebd3a34cee5727a76fc2ab88b87f7b28b430754`; identical to `sam2/configs/sam2.1/sam2.1_hiera_b+.yaml` in the archive                                                                                                                                                                            |
| Upstream loader         | `sam2/build_sam.py`; 4,934 bytes; SHA-256 `6df1b93a16c3eaf49334f74e831db91c67a0cf413b946d102333081722f20520`                                                                                                                                                                                                                               |
| Model/config            | `sam2.1_hiera_base_plus`; runtime config `configs/sam2.1/sam2.1_hiera_b+.yaml`                                                                                                                                                                                                                                                             |
| Official checkpoint URL | `https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt`                                                                                                                                                                                                                                                       |
| Checkpoint              | 323,606,802 bytes; SHA-256 `a2345aede8715ab1d5d31b4a509fb160c5a4af1970f199d9054ccfb746c004c5`                                                                                                                                                                                                                                              |
| Runtime licenses        | `LICENSE`: 11,357 bytes, SHA-256 `c71d239df91726fc519c6eb72d318ec65820627232b2f796219e87dcf35d0ab4`; `LICENSE_cctorch`: 1,566 bytes, SHA-256 `687d4f65ffe399358b170e22572564a16689e496f85a79dc5385fccf6bbc9558`                                                                                                                            |
| Archive-only licenses   | `sav_dataset/LICENSE`: 1,514 bytes, SHA-256 `28b6f4b85d4f6867c99bcba442d3e0bffc4e6f1a6e04e210a4bb9c9a3b56306a`; `LICENSE_DAVIS`: 1,550 bytes, SHA-256 `a727bc2b6f26a1f1c76d0511502da6ba208212708c04a65230159331906354f1`; `LICENSE_VOS_BENCHMARK`: 1,048 bytes, SHA-256 `104f011f1cd91268d54a9fab1ff769ef01081410cd622e0f723c03d146d02482` |
| Base image              | `pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime@sha256:c8268a92a69bd500f8be0e665b2630ee006dadaf7bfbc24249141b15ff622755`, exactly `linux/amd64`                                                                                                                                                                                             |
| Base manifest/config    | manifest: 1,366 bytes and the same `c826…2755` SHA-256; config: 4,665 bytes, SHA-256 `946241f40f56c5ac17b12be451a9ff6bf7163acaac37d1f15bbc7404f4394e57`                                                                                                                                                                                    |

The repository/archive/config/checkpoint URLs and commit are official-source
identities. Their listed SHA-256 values are not publisher checksums. For the archive,
config, and checkpoint the exact provenance is:
`Fabrica-observed SHA-256 from two byte-identical official-source downloads`.
During this milestone, an authorized acquisition downloaded two copies of each exact
official archive, config, and checkpoint. It hashed each copy with both
`shasum -a 256` and `openssl dgst -sha256`, checked exact sizes and byte equality,
retained one canonical body under the ignored acquisition directory below, and
discarded duplicate bodies only after comparison. No acquired body is Git-tracked,
no artifact/model code was imported, installed, or executed, and no checkpoint pickle
or tensor was deserialized.

Matching size and SHA-256 proves byte identity with those observations. It does not
prove that a checkpoint is safe, correct, non-malicious, compatible, or semantically
the selected model. The checkpoint review was structural only: a ZIP with one exact
root, 619 stored regular members, exact administrative members, tensors
`data/0` through `data/614`, 323,483,230 stored payload bytes, and an 81,446-byte
`data.pkl`. CRC verification does not deserialize `data.pkl` or inspect tensors.

The archive verifier similarly treats the tar as hostile. It binds the exact
55,631,013-byte archive before opening it; requires 652 members (561 regular, 87
directories, 4 exact symlinks), one exact top-level commit directory, a
10,500,000-byte per-member ceiling, collision-free canonical paths, only regular
files/directories/allowlisted symlinks, exactly five case-sensitive `LICENSE*` family
members, and no case-sensitive `NOTICE*` family member. Extraction writes only the
verified `sam2/**` runtime tree and two runtime licenses, into empty real directories,
using exclusive/no-follow file creation. It never runs upstream `setup.py`, build
hooks, or archive code.

### Canonical ignored acquisition evidence

The current retained acquisition evidence is separate from the future Docker staging
layout. These are the exact ignored repository-relative paths:

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
Docker inputs. The five `verified-members` files are exact audited members extracted
from the retained canonical archive. OCI manifest/config bodies and paired headers
were retained without pulling a base layer. The entire directory remains ignored and
the Git-boundary test rejects any tracked copy.

## Exact image locations and startup

The manifest binds these absolute image paths:

```text
/opt/fabrica/sam/artifact-manifest.json
/opt/fabrica/sam2-source
/opt/fabrica/sam2-source/sam2/configs/sam2.1/sam2.1_hiera_b+.yaml
/opt/fabrica/sam/checkpoints/sam2.1_hiera_base_plus.pt
/opt/fabrica/sam/licenses
/opt/fabrica/sam/licenses/LICENSE
/opt/fabrica/sam/licenses/LICENSE_cctorch
```

The light preflight validates the reviewed manifest, evidence window, exact presence,
regular-file/directory types, byte sizes, and license inventory without importing
torch or hashing the 323 MB checkpoint. Only then may `/ping` report `204`. The
FastAPI lifespan performs full source/config/checkpoint/license hashes and structural
checks in one background attempt before any torch, NumPy, or SAM import.

After full verification, the engine calls
`build_sam2("configs/sam2.1/sam2.1_hiera_b+.yaml", ckpt_path=None, ...)`, then exactly
`torch.load(checkpoint, map_location="cpu", weights_only=True)`. The loaded top level
must be exactly `{model}`, the state must be nonempty with string keys, and explicit
missing or unexpected keys block startup. This avoids the reviewed upstream loader's
observed unsafe default load. `weights_only=True` narrows deserialization risk; it is
not a proof of checkpoint safety.

Readiness is cached:

| State                     | `/ping` | Meaning                                                   |
| ------------------------- | ------: | --------------------------------------------------------- |
| `model-not-staged`        |     503 | none of the five staged identities exists                 |
| `model-staged-not-loaded` |     204 | light preflight passed; full verification/load is running |
| `model-loaded-ready`      |     200 | one verified warm model is ready                          |
| `startup-blocked`         |     503 | partial staging, verification drift, or load failure      |

One process owns one nonblocking inference permit. A second request receives `429`
before its body is buffered. Errors and health bodies are redacted; access logging is
disabled.

## Base and Python identity

The exact retained OCI config records `PYTORCH_VERSION=2.5.1` in final `Env`;
`CUDA_VERSION=12.4.1` and `TARGETPLATFORM` in build history; Ubuntu 22.04 in OCI
labels; and `amd64`/`linux` in its platform fields. CUDA is not represented as a final
environment observation. cuDNN 9 is explicitly tag-derived from `cudnn9`, not a
runtime observation. Runtime version assertions were deferred because no image or
layer was pulled or executed.

CPython 3.11.x is a required compatibility and future build assertion. The retained
OCI metadata does not expose any Python patch, so the manifest records `patch=null`;
it does not claim that OCI metadata or an unacquired Dockerfile proved Python. Both
Docker stages assert the 3.11 major/minor requirement. A separately authorized build
must record the exact patch as build evidence. Health must not eagerly import torch
merely to rediscover PyTorch already bound by retained OCI evidence. PyTorch 2.5.1 is
OCI-config-observed and base-owned. The `torchvision` distribution and import
namespace remain base-owned and forbidden from `runtime-deps`, the future lock, and
the wheelhouse, but retained OCI evidence does not prove installed torchvision
0.20.1. A future build must assert and record that exact runtime version before final
image acceptance.

## Dependency gate and exact ignored layout

Runtime dependency artifacts were not acquired or reviewed. The manifest therefore
records:

```text
buildStatus=unresolved-deployment-time-blocking
acquisitionOccurred=false
requirementsLock.byteSize=null
requirementsLock.sha256=null
wheelhouseInventory.byteSize=null
wheelhouseInventory.sha256=null
```

This is intentional. `audit-build` rejects the current reviewed manifest before
examining artifact paths, and the Dockerfile chains that audit before `pip`. The
Dockerfile is therefore deliberately non-buildable and cannot pass replacement lock,
sidecar, wheel, direct-URL, or source-distribution inputs to root `pip`.
`requirements.in` records package intentions only; it is not an acquired lock.

The ready-state verifier is implemented and tested with synthetic wheels, but the
tracked manifest cannot enter that state without a separately reviewed revision. The
resolved revision must bind the exact byte size and SHA-256 of a closed
`requirements.lock` and closed canonical `wheelhouse-inventory.json`. The inventory
binds every exact wheel filename, byte size, and SHA-256 and rejects missing, extra,
nonregular, symlink, unsafe, or collision-prone entries. Each wheel must be a
CRC-valid ZIP with one matching `METADATA`, `WHEEL`, and `RECORD`, CPython
3.11 tags and either pure-`any`, `linux_x86_64`, or `manylinux*_x86_64` platform
identity. `musllinux` is rejected for the Ubuntu/glibc base. Every `.dist-info`
top-level entry must use the one exact filename-bound root, and protected
`sam_worker`, `sam2`, `torch`, `torchvision`, `nvidia`, or `triton` top-level
namespaces are rejected for directory entries as well as files. Lock and wheelhouse
form an exact one-wheel-per-package bijection.

The lock grammar is exactly sorted unique
`canonical-name==version --hash=sha256:<64-lowercase-hex>` lines with a final newline.
It rejects direct URLs, VCS references, editables, local paths, includes,
index/extra-index/find-links directives, markers, source distributions, extras, and
base-owned packages. Only inventory-bound `.whl` files may exist, and only then may
offline pip with `PIP_CONFIG_FILE=/dev/null`, `--only-binary=:all:`, `--no-deps`,
`--no-index`, and `--require-hashes` become reachable.

The future canonical ignored staging layout is:

```text
.local-data/banner-ai/sam-worker-build/
  sam2-source.tar.gz
  sam2.1_hiera_b+.yaml
  sam2.1_hiera_base_plus.pt
  LICENSE
  LICENSE_cctorch
  pytorch-base-manifest.json
  pytorch-base-config.json
  requirements.lock
  wheelhouse-inventory.json
  wheelhouse/
    <exact inventory-bound files>.whl
```

`Dockerfile.dockerignore` is default-deny. It exposes only the Dockerfile, reviewed
manifest, flat worker `*.py` files, those exact named inputs, and
`wheelhouse/*.whl`. Unexpected local files, nested worker caches, Git data,
environment files, secrets, sidecars, sdists, demonstrations, and every other
`.local-data` subtree cannot enter the context.

Downloaded archives, checkpoints, base metadata, locks, wheels, and all
`.local-data` paths stay out of Git. They are large or executable supply-chain inputs,
not source. Provider-free tests use bounded `git ls-files -z` inspection to enforce
that boundary and ensure no downloaded binary reaches Banner AI package exports or web
source.

## Future artifact reproduction

Only a separately authorized, isolated acquisition environment may reproduce the
observations:

1. Re-review official sources before `2026-08-18T19:31:18Z` or any earlier source
   change.
2. Create a new empty acquisition directory exclusively, either below the ignored
   `.local-data` boundary or in isolated temporary storage. Create every destination
   file with no-overwrite/exclusive semantics; never reuse or overwrite retained
   evidence. Download each exact official archive/config/checkpoint URL twice into
   distinct files. Do not import, install, or execute artifact code or deserialize the
   checkpoint pickle/tensors.
3. For both copies run `shasum -a 256 <file>` and
   `openssl dgst -sha256 <file>`. Require all four hashes, exact byte sizes, and a
   byte-for-byte comparison such as `cmp -s` to agree with the manifest. Retain one
   approved canonical body and paired header evidence; remove the duplicate body only
   after every comparison succeeds.
4. Audit the canonical archive, checkpoint ZIP, raw config/archive equality, five-license
   family, zero-`NOTICE*` family, and immutable base manifest/config descriptor using
   the stdlib verifier. Do not deserialize the checkpoint or acquire base layers.
5. Acquire and review the dependency lock/wheelhouse under the policy above, then
   fill the ready-state size/hash fields and re-sign/review the manifest.
6. Copy only reviewed canonical bodies and verified runtime licenses into the separate
   future staging layout. Retain the reviewed acquisition evidence; remove only
   compared duplicate bodies and unreviewed logs containing private paths.

Future CI should retrieve into ephemeral storage, verify exact size and SHA-256 before
any parser or installer, run the same archive/checkpoint/config/license/base checks,
enforce the lock/wheel inventory, and prove the runtime image contains only verified
`sam2/**`, runtime licenses, checkpoint, reviewed manifest, worker source, and reviewed
dependencies.

## Exact future build and RunPod sequence

After the dependency manifest revision is reviewed:

1. Perform the authorized acquisition/reproduction flow and stage only the exact
   ignored layout. Run the host-side audit before Docker:

   ```bash
   PYTHONPATH=services/sam-worker \
   python3 -m sam_worker.artifacts audit-build \
     --manifest services/sam-worker/artifact-manifest.json \
     --archive .local-data/banner-ai/sam-worker-build/sam2-source.tar.gz \
     --config .local-data/banner-ai/sam-worker-build/sam2.1_hiera_b+.yaml \
     --checkpoint .local-data/banner-ai/sam-worker-build/sam2.1_hiera_base_plus.pt \
     --license .local-data/banner-ai/sam-worker-build/LICENSE \
     --license .local-data/banner-ai/sam-worker-build/LICENSE_cctorch \
     --base-manifest .local-data/banner-ai/sam-worker-build/pytorch-base-manifest.json \
     --base-config .local-data/banner-ai/sam-worker-build/pytorch-base-config.json \
     --requirements-lock .local-data/banner-ai/sam-worker-build/requirements.lock \
     --wheelhouse-inventory .local-data/banner-ai/sam-worker-build/wheelhouse-inventory.json \
     --wheelhouse .local-data/banner-ai/sam-worker-build/wheelhouse \
     --base-image pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime@sha256:c8268a92a69bd500f8be0e665b2630ee006dadaf7bfbc24249141b15ff622755 \
     --platform linux/amd64
   ```

   With the current unresolved manifest this command must fail before dependency
   parsing or installation.

2. Only after that host audit succeeds, run the pinned multi-stage build with network
   disabled:

   ```bash
   docker build --network=none \
     --file services/sam-worker/Dockerfile \
     --tag fabrica-sam-worker:controlled-local .
   ```

   Do not add build args or use `latest`; the exact `linux/amd64` base digest is
   literal in both stages.

3. Validate the non-root, read-only runtime, full health verification, exact `/ping`
   transitions, `/v1/masks` refusal/readiness, import/network scans, and runtime file
   inventory. Record the exact CPython patch, assert and record installed torchvision
   0.20.1, and record the final image digest.
4. Push once to an approved registry by immutable digest. Do not use RunPod GitHub
   integration.
5. Create one RunPod **Load Balancer** endpoint, not Queue, pinned to that image digest:
   one GPU per worker, minimum/active workers 0, maximum 1, port 80, health `/ping`,
   inference `/v1/masks`, reviewed GPU/price/timeout/cold-start/cost settings.
6. With active workers set to zero, do not assume the public endpoint will expose the
   worker's internal `204` while it cold-starts. Before inference authorization,
   either confirm readiness in the RunPod console and then make one authenticated
   public `GET /ping` that must return `200`, or obtain a separate bounded GET-only
   health authorization with a fixed finite count of at least three attempts, 5–10
   seconds apart, stopping on `200`. The latter follows the official health-retry
   recommendation and grants no POST, inference claim, or inference retry. If health
   does not reach `200`, stop without inference.
7. After health is confirmed, create a new unexpired, single-use
   `single-fixture-sam-runpod-direct-v2` authorization bound to the exact endpoint,
   image, model/config/checkpoint, fixture, limits, cost cap, one dispatch, one
   application inference, zero retry, and zero poll.
8. With the server-only `RUNPOD_API_KEY` reference, submit the one
   `automatic-candidates` fixture exactly once and stop. Indeterminate outcomes are
   never retried.

This sequence does not activate a web route, package export, production admission, or
Qwen geometry. Qwen remains proposal-only and may later reference immutable candidate
IDs without changing mask pixels.

The official RunPod evidence was retrieved at `2026-07-18T13:15:50Z` and fails closed
at `2026-08-18T13:15:50Z` or an earlier source change. See
[`docs/architecture/banner-ai-sam2-mask-worker.md`](../../docs/architecture/banner-ai-sam2-mask-worker.md)
for contracts and transport details.

No Docker build, base pull, dependency acquisition, image push, endpoint creation,
secret inspection, provider health call, torch/SAM execution, or external inference
occurred in this milestone.
