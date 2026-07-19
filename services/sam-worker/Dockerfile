FROM --platform=linux/amd64 pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime@sha256:c8268a92a69bd500f8be0e665b2630ee006dadaf7bfbc24249141b15ff622755 AS artifact-audit

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_CONFIG_FILE=/dev/null \
    PIP_NO_INDEX=1 \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    PYTHONPATH=/opt/fabrica/worker

RUN python -c "import sys; assert sys.version_info[:2] == (3, 11), sys.version" \
    && mkdir -p /opt/fabrica/worker /opt/fabrica/sam/checkpoints /opt/fabrica/staged

COPY services/sam-worker/sam_worker /opt/fabrica/worker/sam_worker
COPY services/sam-worker/artifact-manifest.json /opt/fabrica/sam/artifact-manifest.json

# Every broad or executable artifact below is an ignored, controlled-build input.
# The verifier audits it before extraction, installation, or model-library import.
COPY .local-data/banner-ai/sam-worker-build/requirements.lock /opt/fabrica/staged/requirements.lock
COPY .local-data/banner-ai/sam-worker-build/wheelhouse-inventory.json /opt/fabrica/staged/wheelhouse-inventory.json
COPY .local-data/banner-ai/sam-worker-build/wheelhouse /opt/fabrica/staged/wheelhouse
COPY .local-data/banner-ai/sam-worker-build/sam2-source.tar.gz /opt/fabrica/staged/sam2-source.tar.gz
COPY .local-data/banner-ai/sam-worker-build/sam2.1_hiera_b+.yaml /opt/fabrica/staged/sam2.1_hiera_b+.yaml
COPY .local-data/banner-ai/sam-worker-build/sam2.1_hiera_base_plus.pt /opt/fabrica/staged/sam2.1_hiera_base_plus.pt
COPY .local-data/banner-ai/sam-worker-build/LICENSE /opt/fabrica/staged/LICENSE
COPY .local-data/banner-ai/sam-worker-build/LICENSE_cctorch /opt/fabrica/staged/LICENSE_cctorch
COPY .local-data/banner-ai/sam-worker-build/pytorch-base-manifest.json /opt/fabrica/staged/pytorch-base-manifest.json
COPY .local-data/banner-ai/sam-worker-build/pytorch-base-config.json /opt/fabrica/staged/pytorch-base-config.json

RUN cd /opt/fabrica/staged \
    && python -m sam_worker.artifacts audit-build \
        --manifest /opt/fabrica/sam/artifact-manifest.json \
        --archive /opt/fabrica/staged/sam2-source.tar.gz \
        --config /opt/fabrica/staged/sam2.1_hiera_b+.yaml \
        --checkpoint /opt/fabrica/staged/sam2.1_hiera_base_plus.pt \
        --license /opt/fabrica/staged/LICENSE \
        --license /opt/fabrica/staged/LICENSE_cctorch \
        --base-manifest /opt/fabrica/staged/pytorch-base-manifest.json \
        --base-config /opt/fabrica/staged/pytorch-base-config.json \
        --requirements-lock /opt/fabrica/staged/requirements.lock \
        --wheelhouse-inventory /opt/fabrica/staged/wheelhouse-inventory.json \
        --wheelhouse /opt/fabrica/staged/wheelhouse \
        --base-image pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime@sha256:c8268a92a69bd500f8be0e665b2630ee006dadaf7bfbc24249141b15ff622755 \
        --platform linux/amd64 \
    && python -m pip install \
        --no-cache-dir \
        --no-index \
        --only-binary=:all: \
        --no-deps \
        --find-links=file:///opt/fabrica/staged/wheelhouse \
        --require-hashes \
        --target=/opt/fabrica/runtime-deps \
        -r /opt/fabrica/staged/requirements.lock \
    && python -m sam_worker.artifacts extract-runtime \
        --manifest /opt/fabrica/sam/artifact-manifest.json \
        --archive /opt/fabrica/staged/sam2-source.tar.gz \
        --source-root /opt/fabrica/sam2-source \
        --licenses-root /opt/fabrica/sam/licenses \
    && install -m 0444 \
        /opt/fabrica/staged/sam2.1_hiera_base_plus.pt \
        /opt/fabrica/sam/checkpoints/sam2.1_hiera_base_plus.pt \
    && python -m sam_worker.artifacts verify-runtime \
        --manifest /opt/fabrica/sam/artifact-manifest.json \
        --source-root /opt/fabrica/sam2-source \
        --checkpoint /opt/fabrica/sam/checkpoints/sam2.1_hiera_base_plus.pt \
        --licenses-root /opt/fabrica/sam/licenses

FROM --platform=linux/amd64 pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime@sha256:c8268a92a69bd500f8be0e665b2630ee006dadaf7bfbc24249141b15ff622755 AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_CONFIG_FILE=/dev/null \
    PIP_NO_INDEX=1 \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    PYTHONPATH=/opt/fabrica/runtime-deps:/opt/fabrica/worker:/opt/fabrica/sam2-source

RUN python -c "import sys; assert sys.version_info[:2] == (3, 11), sys.version" \
    && groupadd --gid 10001 fabrica \
    && useradd --uid 10001 --gid fabrica --create-home --shell /usr/sbin/nologin fabrica

COPY --from=artifact-audit /opt/fabrica/runtime-deps /opt/fabrica/runtime-deps
COPY --from=artifact-audit /opt/fabrica/worker /opt/fabrica/worker
COPY --from=artifact-audit /opt/fabrica/sam2-source /opt/fabrica/sam2-source
COPY --from=artifact-audit /opt/fabrica/sam /opt/fabrica/sam

RUN python -m sam_worker.health \
    && chown -R root:root /opt/fabrica \
    && chmod -R a-w /opt/fabrica

USER 10001:10001
WORKDIR /opt/fabrica/worker
HEALTHCHECK NONE
CMD ["python", "-m", "sam_worker.server"]
