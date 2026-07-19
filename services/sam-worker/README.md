# SAM direct Load Balancer worker

This service is the provider-neutral FastAPI worker for the reviewed
`sam2.1_hiera_base_plus` deployment. Its active hosting contract is a direct
RunPod Load Balancer server on port 80:

- readiness: `GET /ping`
- inference: `POST /v1/masks`
- no queue wrapper, `/run`, or `/runsync`
- one process, one model instance, and one admitted inference request
- no startup-time or request-time download

This milestone prepares a reproducible GitHub build source. A later, separately
authorized first GitHub build attempt reached the immutable-base package-metadata gate
and stopped there. It produced no final image and performed no endpoint creation,
checkpoint load, model health check, GPU inference, fixture upload, or inference
request. These uncommitted repairs do not authorize another build.

## Fixed GitHub build source

The eventual RunPod build source is:

| Setting       | Value                            |
| ------------- | -------------------------------- |
| Repository    | `moodworks/fabrica-kit`          |
| Branch        | `main`                           |
| Dockerfile    | `services/sam-worker/Dockerfile` |
| Build context | repository root                  |
| Platform      | `linux/amd64`                    |

Provider assumptions are limited to RunPod's official
[GitHub integration](https://docs.runpod.io/serverless/workers/github-integration)
and [Load Balancing](https://docs.runpod.io/serverless/load-balancing/overview)
documentation.

The Dockerfile and its inputs are currently accepted local changes that remain
uncommitted and unpushed. Consequently, RunPod cannot consume this revision yet. A
later, separately authorized reviewed commit and push to `main` are required before
selecting GitHub build. The build does not depend on `.local-data`, Git LFS, untracked
wheel files, absolute developer paths, local caches, Docker secrets, or files outside
the repository-root context.

`services/sam-worker/Dockerfile.dockerignore` is the Dockerfile-specific, allowlist
context contract. Every `COPY` source is a repository file selected by that allowlist.

## Reviewed artifact identities

`artifact-manifest.json` is the executable source of truth. Its self-digest is:

`baab7246927ea22ac9f769cab60af2fc3c03fe3ef81aa9a660ab56441365647d`

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
   ports, changed response URLs, content encodings, and content-length drift;
3. enforces byte limits and SHA-256 while creating new, non-followed files;
4. audits archive/checkpoint structure and every wheel ZIP, tag, distribution
   identity, protected namespace, and active `Requires-Dist` edge;
5. extracts only the reviewed runtime source/config/licenses; and
6. emits one closed build-input directory.

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
`__pycache__`, then asserts no such path remains. Runtime files are root-owned and
read-only; the server runs as UID/GID 10001, exposes `80/tcp`, and starts directly with
`python -m sam_worker.server`.

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
unknown targets, and constructor-origin drift. It directly constructs the reviewed
graph and applies the three upstream `build_sam2` postprocessing defaults.

The runtime adapter profile self-digest is:

`82a110c9739c2990d663a86f848bc9a0218391c6f21565b16dcda24baf8f1826`

This is a selected-config adapter only. It makes no general Hydra or iopath
compatibility claim. Semantic torch/SAM compatibility is deliberately
`deferred-no-torch-or-sam-execution` until a separately authorized build and GPU
health exercise.

## Readiness

Startup verifies all staged artifact, dependency, overlay, loader, config, source, and
checkpoint identities before importing torch or SAM. It then constructs and loads
exactly one model instance. Readiness becomes green only after load succeeds.

| State                     | `GET /ping` | `inferenceReady` |
| ------------------------- | ----------: | ---------------- |
| `model-not-staged`        |         503 | `false`          |
| `model-staged-not-loaded` |         503 | `false`          |
| `startup-blocked`         |         503 | `false`          |
| `model-loaded-ready`      |         200 | `true`           |

Startup failures transition to `startup-blocked`. Responses expose only fixed state
and contract fields; raw exceptions and filesystem paths are not returned. The
previous staged-but-not-loaded success response is not part of the active hosting
profile.

The active profile digests are:

- hosting:
  `1687de7e1936944b0f8b8a14ed4500a988f92558fe3c1680cfe3acc7bc8b8f3d`
- direct transport adapter:
  `62809b35b0ccf2d28f1bcd086857718a7c909b247adeccdddd587305066449a4`
- runtime selected-config adapter:
  `82a110c9739c2990d663a86f848bc9a0218391c6f21565b16dcda24baf8f1826`

## OCI metadata and source revision

The image labels bind the non-secret source repository, supplied Git revision, SAM
commit/model/config/checkpoint, artifact manifest, three active profiles, build
contract, and:

`io.fabrica.image-use=health-only-non-promotable-v1`

The only build argument is `FABRICA_GIT_SHA`. It accepts either a real lowercase,
nonzero 40-hex Git SHA or the exact sentinel `unavailable`. RunPod's documented
GitHub integration does not provide a reviewed automatic SHA/build-argument contract,
so `unavailable` is the honest default. It is not a SHA and makes no revision claim.
The Dockerfile and build inputs define or copy no API key, credential, token, or
Docker secret. None may enter a build argument, layer, or label, and the exact
health-only console configuration injects none.

Any completed image from this source is health-only and non-promotable even when a real
SHA is supplied. A real SHA improves provenance but does not satisfy the later image
inventory, model-load, GPU-health, or inference promotion gates. The first authorized
build attempt stopped before final image completion, so no final image digest exists.

## Provider-free verification

These commands do not run Docker, torch, SAM, or RunPod:

```bash
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
context, offline final installation, and forbidden provider/secret operations.

## Exact next RunPod configuration

Do not create this endpoint or trigger another build as part of this repair. After a
separately authorized reviewed commit and push, enter exactly:

| RunPod setting                   | Value                            |
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

Use no queue endpoint and no automatic or client retry. Upload no fixture and do not
send `POST /v1/masks`. The first separately authorized exercise is health-only.
