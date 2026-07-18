# Required example: --build-arg PYTORCH_BASE_IMAGE=pytorch/pytorch:<reviewed-tag>@sha256:<reviewed-digest>
ARG PYTORCH_BASE_IMAGE
FROM ${PYTORCH_BASE_IMAGE}

ENV SAM_REPOSITORY_COMMIT=05d9e57fb3945b10c861046c1e6749e2bfc258e3 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PYTHONPATH=/opt/fabrica/worker:/opt/fabrica/sam2-source

RUN test -n "${SAM_REPOSITORY_COMMIT}" \
    && python -c "import sys; assert sys.version_info[:2] == (3, 11), sys.version" \
    && groupadd --gid 10001 fabrica \
    && useradd --uid 10001 --gid fabrica --create-home --shell /usr/sbin/nologin fabrica \
    && mkdir -p /opt/fabrica/worker /opt/fabrica/sam/checkpoints /opt/fabrica/sam/configs/sam2.1 \
    && chown -R fabrica:fabrica /opt/fabrica

# These ignored files must be staged by the reviewed controlled-build procedure.
COPY .local-data/banner-ai/sam-worker-build/requirements.lock /tmp/requirements.lock
COPY .local-data/banner-ai/sam-worker-build/requirements.lock.sha256 /tmp/requirements.lock.sha256
COPY .local-data/banner-ai/sam-worker-build/wheelhouse /tmp/wheelhouse
COPY .local-data/banner-ai/sam-worker-build/wheelhouse.sha256 /tmp/wheelhouse.sha256
RUN cd /tmp \
    && sha256sum --check requirements.lock.sha256 \
    && sha256sum --check wheelhouse.sha256 \
    && python -m pip install --no-cache-dir --no-index --find-links=/tmp/wheelhouse --require-hashes -r /tmp/requirements.lock

COPY .local-data/banner-ai/sam-worker-build/sam2-source.tar.gz /tmp/sam2-source.tar.gz
COPY .local-data/banner-ai/sam-worker-build/sam2-source.tar.gz.sha256 /tmp/sam2-source.tar.gz.sha256
RUN cd /tmp \
    && test "$(wc -l < sam2-source.tar.gz.sha256)" = "1" \
    && grep -Eq '^[0-9a-f]{64}  sam2-source[.]tar[.]gz$' sam2-source.tar.gz.sha256 \
    && sha256sum --check sam2-source.tar.gz.sha256 \
    && mkdir -p /tmp/sam2-extract \
    && tar --extract --gzip --file /tmp/sam2-source.tar.gz --directory /tmp/sam2-extract \
    && test "$(find /tmp/sam2-extract -mindepth 1 -maxdepth 1 -type d | wc -l)" = "1" \
    && test "$(find /tmp/sam2-extract -mindepth 1 -maxdepth 1 ! -type d | wc -l)" = "0" \
    && source_root="$(find /tmp/sam2-extract -mindepth 1 -maxdepth 1 -type d -print -quit)" \
    && test "$(basename "${source_root}")" = "sam2-${SAM_REPOSITORY_COMMIT}" \
    && cp -a "${source_root}/." /opt/fabrica/sam2-source/ \
    && cd /opt/fabrica/sam2-source \
    && SAM2_BUILD_CUDA=0 python -m pip install --no-cache-dir --no-index --no-build-isolation --no-deps .

COPY .local-data/banner-ai/sam-worker-build/sam2.1_hiera_base_plus.pt /opt/fabrica/sam/checkpoints/sam2.1_hiera_base_plus.pt
COPY .local-data/banner-ai/sam-worker-build/model-manifest.json /opt/fabrica/sam/model-manifest.json
COPY .local-data/banner-ai/sam-worker-build/LICENSE /opt/fabrica/sam/LICENSE
COPY .local-data/banner-ai/sam-worker-build/NOTICE /opt/fabrica/sam/NOTICE
COPY services/sam-worker/sam_worker /opt/fabrica/worker/sam_worker

RUN python -m sam_worker.health \
    && chown -R root:root /opt/fabrica \
    && chmod -R a-w /opt/fabrica \
    && rm -rf /tmp/wheelhouse /tmp/requirements.lock /tmp/sam2-extract /tmp/sam2-source.tar.gz /tmp/*.sha256

USER 10001:10001
WORKDIR /opt/fabrica/worker
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 CMD ["python", "-m", "sam_worker.health", "--light"]
CMD ["python", "-m", "sam_worker.handler"]
