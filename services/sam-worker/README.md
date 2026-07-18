# Fabrica SAM 2.1 worker

This directory is an isolated Python inference worker. It is not the Fabrica application
backend, has no browser or web-route entry point, and never accepts provider endpoints,
checkpoint paths, model IDs, URLs, or credentials in its request.

The deployable entry point is:

```text
python -m sam_worker.handler
```

`handler.py` loads one verified production engine before starting the RunPod standard
handler. Tests inject a fake engine and therefore do not import RunPod, torch, NumPy, or
SAM 2, require a GPU, or retrieve any model:

```bash
PYTHONPYCACHEPREFIX=/tmp/fabrica-sam-pycache \
PYTHONPATH=services/sam-worker \
python3 -m unittest discover -s services/sam-worker/tests -v
```

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

No build, checkpoint retrieval, provider call, image publication, endpoint creation, or
deployment is part of this milestone.
