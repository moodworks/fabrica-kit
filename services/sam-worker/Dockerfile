FROM --platform=linux/amd64 pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime@sha256:c8268a92a69bd500f8be0e665b2630ee006dadaf7bfbc24249141b15ff622755 AS acquisition

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_CONFIG_FILE=/dev/null \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    PYTHONPATH=/opt/fabrica/worker

RUN --network=none python -c "import sys; exec(\"if sys.version_info[:2] != (3, 11):\\n    raise SystemExit('fabrica-build-gate: acquisition-cpython-major-minor')\")"

RUN --network=none mkdir -p \
    /opt/fabrica/build \
    /opt/fabrica/worker \
    /opt/fabrica/sam \
    /opt/fabrica/sam2-overlay

COPY services/sam-worker/sam_worker /opt/fabrica/worker/sam_worker
COPY services/sam-worker/runtime-overlay /opt/fabrica/sam2-overlay
COPY services/sam-worker/artifact-manifest.json /opt/fabrica/sam/artifact-manifest.json
COPY services/sam-worker/adapter-profile.json /opt/fabrica/sam/adapter-profile.json
COPY services/sam-worker/dependency-licenses.json /opt/fabrica/sam/dependency-licenses.json
COPY services/sam-worker/requirements.lock /opt/fabrica/build/requirements.lock
COPY services/sam-worker/wheelhouse-manifest.json /opt/fabrica/build/wheelhouse-manifest.json
COPY services/sam-worker/acquire_build.py /opt/fabrica/build/acquire.py

RUN --network=default python /opt/fabrica/build/acquire.py \
        --closed /opt/fabrica/closed \
        --scratch /tmp/fabrica-acquisition \
        --requirements-lock /opt/fabrica/build/requirements.lock \
        --wheelhouse-manifest /opt/fabrica/build/wheelhouse-manifest.json \
        --worker-root /opt/fabrica/worker/sam_worker

FROM --platform=linux/amd64 pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime@sha256:c8268a92a69bd500f8be0e665b2630ee006dadaf7bfbc24249141b15ff622755 AS runtime

ARG FABRICA_GIT_SHA

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_CONFIG_FILE=/dev/null \
    PIP_NO_INDEX=1 \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    PYTHONPATH=/opt/fabrica/sam2-overlay:/opt/fabrica/runtime-deps:/opt/fabrica/worker:/opt/fabrica/sam2-source

RUN --network=none python -c "import re,sys; value=sys.argv[1]; valid=re.fullmatch(r'[0-9a-f]{40}', value) is not None and value != '0' * 40; exec(\"if not valid:\\n    raise SystemExit('fabrica-build-gate: source-revision')\")" "${FABRICA_GIT_SHA}"

RUN --network=none python -c "import sys; exec(\"if sys.version_info[:2] != (3, 11):\\n    raise SystemExit('fabrica-build-gate: runtime-cpython-major-minor')\")"

RUN --network=none python -c "import importlib.metadata as metadata; exec(\"try:\\n    observed = metadata.version('torch')\\nexcept metadata.PackageNotFoundError:\\n    raise SystemExit('fabrica-build-gate: torch-metadata-missing') from None\\nif observed != '2.5.1+cu124':\\n    raise SystemExit('fabrica-build-gate: torch-metadata-mismatch')\")"

RUN --network=none python -c "import importlib.metadata as metadata; exec(\"try:\\n    observed = metadata.version('torchvision')\\nexcept metadata.PackageNotFoundError:\\n    raise SystemExit('fabrica-build-gate: torchvision-metadata-missing') from None\\nif observed != '0.20.1+cu124':\\n    raise SystemExit('fabrica-build-gate: torchvision-metadata-mismatch')\")"

RUN --network=none groupadd --gid 10001 fabrica \
    && useradd --uid 10001 --gid fabrica --create-home --shell /usr/sbin/nologin fabrica

RUN --network=none python -c "import grp,pwd; exec(\"try:\\n    user = pwd.getpwnam('fabrica')\\n    group = grp.getgrnam('fabrica')\\nexcept KeyError:\\n    raise SystemExit('fabrica-build-gate: runtime-user-missing') from None\\nif (user.pw_uid, user.pw_gid, group.gr_gid) != (10001, 10001, 10001):\\n    raise SystemExit('fabrica-build-gate: runtime-user-identity')\")"

LABEL org.opencontainers.image.source="https://github.com/moodworks/fabrica-kit" \
      org.opencontainers.image.revision="${FABRICA_GIT_SHA}" \
      io.fabrica.source-revision-contract="required-git-sha40-v1" \
      io.fabrica.image-use="pinned-digest-deployment-only-v1" \
      io.fabrica.build-contract.version="fabrica-sam-ghcr-linux-amd64-v1" \
      io.fabrica.sam.worker-image-digest-env="SAM_WORKER_IMAGE_DIGEST" \
      io.fabrica.sam.worker-image-object="linux-amd64-image-manifest-v1" \
      io.fabrica.sam.repository-commit="05d9e57fb3945b10c861046c1e6749e2bfc258e3" \
      io.fabrica.sam.model-id="sam2.1_hiera_base_plus" \
      io.fabrica.sam.config="configs/sam2.1/sam2.1_hiera_b+.yaml" \
      io.fabrica.sam.config-sha256="e73f9e9547b305040552ee943ebd3a34cee5727a76fc2ab88b87f7b28b430754" \
      io.fabrica.sam.checkpoint-sha256="a2345aede8715ab1d5d31b4a509fb160c5a4af1970f199d9054ccfb746c004c5" \
      io.fabrica.sam.artifact-manifest-sha256="085ddd290b17b6931ea026c274610d9f6c49bad49a5fd372e846a2060b9ac5c4" \
      io.fabrica.sam.hosting-profile-sha256="872054e82fc13e771fa65381e2db1f19dfb2dd609584574e8c532ed8eb82fa18" \
      io.fabrica.sam.direct-adapter-profile-sha256="1e6795c970fcfa9443b850f27149e237daf63ffa668cd5094189936453467e28" \
      io.fabrica.sam.runtime-adapter-profile-sha256="f03c378caa5b9ba7979d67ffe958dfd9ca65cc823a10d728faed8c612937b7bf"

COPY --from=acquisition /opt/fabrica/closed/worker /opt/fabrica/worker
COPY --from=acquisition /opt/fabrica/closed/sam2-overlay /opt/fabrica/sam2-overlay
COPY --from=acquisition /opt/fabrica/closed/sam2-source /opt/fabrica/sam2-source
COPY --from=acquisition /opt/fabrica/closed/sam /opt/fabrica/sam
COPY --from=acquisition /opt/fabrica/closed/requirements.lock /opt/fabrica/sam/requirements.lock
COPY --from=acquisition /opt/fabrica/closed/wheelhouse-manifest.json /opt/fabrica/sam/wheelhouse-manifest.json

RUN --mount=from=acquisition,source=/opt/fabrica/closed/wheelhouse,target=/opt/fabrica/wheelhouse,ro \
    --network=none \
    python -m sam_worker.artifacts verify-dependencies \
        --manifest /opt/fabrica/sam/artifact-manifest.json \
        --requirements-lock /opt/fabrica/sam/requirements.lock \
        --wheelhouse-manifest /opt/fabrica/sam/wheelhouse-manifest.json \
        --dependency-licenses /opt/fabrica/sam/dependency-licenses.json \
        --wheelhouse /opt/fabrica/wheelhouse \
    && python -m pip install \
        --no-cache-dir \
        --no-compile \
        --no-index \
        --only-binary=:all: \
        --no-deps \
        --find-links=file:///opt/fabrica/wheelhouse \
        --require-hashes \
        --target=/opt/fabrica/runtime-deps \
        -r /opt/fabrica/sam/requirements.lock \
    && rm -rf /opt/fabrica/runtime-deps/bin \
    && test ! -e /opt/fabrica/runtime-deps/bin \
    && find /opt/fabrica/runtime-deps -type f -name '*.pyc' -delete \
    && find /opt/fabrica/runtime-deps -type d -name __pycache__ -empty -delete \
    && python -c "from pathlib import Path; root=Path('/opt/fabrica/runtime-deps'); assert not any(path.suffix == '.pyc' or path.name == '__pycache__' for path in root.rglob('*'))" \
    && python -m sam_worker.artifacts verify-installed \
        --manifest /opt/fabrica/sam/artifact-manifest.json \
        --requirements-lock /opt/fabrica/sam/requirements.lock \
        --runtime-deps /opt/fabrica/runtime-deps

RUN --network=none python -m sam_worker.artifacts verify-runtime \
        --manifest /opt/fabrica/sam/artifact-manifest.json \
        --source-root /opt/fabrica/sam2-source \
        --checkpoint /opt/fabrica/sam/checkpoints/sam2.1_hiera_base_plus.pt \
        --licenses-root /opt/fabrica/sam/licenses \
        --requirements-lock /opt/fabrica/sam/requirements.lock \
        --wheelhouse-manifest /opt/fabrica/sam/wheelhouse-manifest.json \
        --dependency-licenses /opt/fabrica/sam/dependency-licenses.json \
        --runtime-deps /opt/fabrica/runtime-deps \
    && chown -R root:root /opt/fabrica \
    && chmod -R a-w /opt/fabrica

RUN --network=none python -c "exec(\"try:\\n    import importlib.metadata as metadata\\n    import yaml\\n    from sam_worker.artifacts import IMAGE_CONFIG_PATH\\n    from sam_worker.model_loader import parse_reviewed_config\\n    if metadata.version('pyyaml') != '6.0.2':\\n        raise RuntimeError('pinned YAML identity drifted')\\n    parse_reviewed_config(IMAGE_CONFIG_PATH.read_bytes(), yaml)\\nexcept Exception:\\n    raise SystemExit('fabrica-build-gate: selected-config-parse') from None\")"

EXPOSE 80/tcp
USER 10001:10001
WORKDIR /opt/fabrica/worker
HEALTHCHECK NONE
CMD ["python", "-m", "sam_worker.server"]
