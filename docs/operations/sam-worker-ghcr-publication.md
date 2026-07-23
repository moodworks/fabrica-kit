# SAM worker public GHCR publication and digest-pinned deployment

This procedure is for a later, separately authorized external stage. Local
implementation and review do not publish a package, change RunPod, contact a worker,
or run inference. Public image availability is distribution only; it does not
authorize `/ping`, `/v1/masks`, a worker wake-up, deployment, or inference.

Current-state pointer (2026-07-23): the version-11 references below remain historical. The reviewed
version-12 immutable identity and completed person evidence are recorded in
[`../evaluation/banner-ai-sam-corpus-evaluation-handoff.md`](../evaluation/banner-ai-sam-corpus-evaluation-handoff.md).

The deployment identity is the registry-proven Linux/AMD64 OCI or Docker schema-2
image-manifest digest:

```text
ghcr.io/moodworks/fabrica-sam-worker@sha256:<64-lowercase-hex>
```

It is not a tag, Git commit, config digest, multi-platform index digest, base-image
digest, local Docker ID, or digest inferred from a filename. The trust chain is:

```text
verified public GHCR Linux/AMD64 image-manifest digest
→ RunPod image reference pinned to repository@digest
→ independently configured SAM_WORKER_IMAGE_DIGEST
→ authorization-bound caller expectation
→ worker comparison before engine invocation
→ trusted digest in the strict response
→ caller equality check before accepting or materializing results
```

This is environment-bound identity, not hardware-backed attestation.

## Pre-build image-content boundary

Before Docker authentication, build, or push, the manual workflow runs the
repository-owned executable `services/sam-worker/image_content_boundary.py`. It fails
closed unless all of these are proven from the exact checkout:

- every Docker context/control input is a tracked stage-zero regular file with its
  reviewed mode and SHA-256;
- `Dockerfile.dockerignore` begins with a deny-all rule and exposes exactly 21 reviewed
  files—no Git metadata, environment files, credentials, authentication material,
  tests, fixtures, reports, images, provider responses, caches, editor files, or build
  artifacts;
- the Dockerfile has exactly the two reviewed pinned Linux/AMD64 stages, one mandatory
  `FABRICA_GIT_SHA` argument, reviewed environment, exact local and cross-stage
  `COPY` edges, and no `ADD`, broad copy, secret mount, or SSH mount;
- only the acquisition stage has one reviewed network-enabled command; all other
  build commands are network-disabled, and the only cross-stage mount is the reviewed
  read-only wheelhouse;
- the artifact manifest, SAM archive/checkpoint identities, adapter profile,
  requirements lock, wheel inventory, dependency-license inventory, exact acquisition
  URLs, byte sizes, hashes, and license/dependency closure all match; and
- the acquisition program has the reviewed host allowlist and produces the exact
  closed output graph copied by the runtime stage.

This is a closed static input/graph/hash/license proof. It does not claim byte-level
inspection of generated layer tar archives. Post-push verification adds registry
manifest/config/rootfs/history structural proof, but it also does not claim to have
opened every layer tar.

## Publication contract

`Publish pinned SAM worker to public GHCR` is manual `workflow_dispatch` only. It
accepts one explicit nonzero 40-character lowercase source commit, checks out that
commit without persisted Git credentials, and verifies exact clean `HEAD`.

The workflow performs exactly one build and one push:

```text
ghcr.io/moodworks/fabrica-sam-worker:<exact-source-commit>
```

The exact-commit tag is a publication locator, never a deployment identity. No
bootstrap image or tag is created, and `latest` is never created or updated. The build
uses repository-root context, `services/sam-worker/Dockerfile`, and only
`linux/amd64`. BuildKit provenance and SBOM outputs are explicitly disabled so
attestation objects cannot silently become the intended platform-manifest identity.
The workflow grants only `contents: read` and `packages: write`, authenticates to
GHCR with its ephemeral `GITHUB_TOKEN`, and publishes to no other registry.

After push, the verifier performs these gates before emitting any success output:

1. Authenticated GitHub package metadata must return the exact
   `moodworks/fabrica-sam-worker` container package, visibility `public`, owner login
   `moodworks`, owner type `User`, a valid exact owner ID, and exact linkage to the
   `moodworks/fabrica-kit` repository and the same owner identity.
2. An authenticated, pull-scoped GHCR token is parsed in memory. The raw build-root
   object is fetched by the BuildKit-returned digest and validated by bytes,
   `Docker-Content-Digest`, response/document media type, and OCI structure.
3. A root index or manifest list is only a routing object. The verifier selects
   exactly one Linux/AMD64 child image-manifest descriptor, fetches that child, and
   proves its bytes, digest, media type, size, config descriptor, nonempty layer
   descriptors, and distinction from the config digest.
4. The config bytes/digest/size must prove Linux/AMD64, the exact source/revision
   and build-contract labels, exact final user/workdir/command/exposed-port,
   Docker's disabled-healthcheck config `{"Test":["NONE"]}`, offline environment, a
   rootfs diff-ID count equal to the manifest layer count, and a
   sanitized history whose materialized-entry count also equals that layer count. Its
   final 15 materialized entries must match the reviewed final-stage order: six
   pre-copy runtime gates, six closed cross-stage copies, dependency installation
   verification, complete runtime verification, and selected-config parsing.
   Secret/SSH mount or credential-bearing history is rejected.
5. The first public exact-manifest request carries no `Authorization` header. A direct
   HTTP 200 is accepted only after the complete raw identity proof. For GHCR's normal
   Registry V2 HTTP 401 path, exactly one `Bearer` challenge must name the already
   validated `https://ghcr.io/token` realm, service `ghcr.io`, and exact
   `repository:moodworks/fabrica-sam-worker:pull` scope, with no unknown, duplicate, or
   malformed parameter.
6. The verifier requests that anonymous pull token without a GitHub credential or
   `Authorization` header, strictly parses it in memory, and never prints or persists
   it. In both challenge and direct-HTTP-200 cases, the exact manifest is requested
   again with only that anonymous bearer token and must independently repeat the
   complete raw digest/header/media/size/config/layer proof. A direct response must
   also pass that complete proof before the bearer re-proof.
7. Using that same anonymous bearer token, an exact request for the `latest` manifest
   must return HTTP 404. Any other status fails closed.

Only then does the workflow emit the immutable image reference, platform-manifest
digest and media type, config digest, root classification, source commit, public
package binding, and anonymous-access proofs. Tokens and provider response bodies are
not emitted or persisted.

## Later authorized operator sequence

1. Ensure the `moodworks/fabrica-kit` commit under review contains the expected public
   image policy. Manually dispatch the publication workflow with that exact full
   commit. Do not rerun a failed publication as an implicit retry; each dispatch is a
   separate operator action, and workflow concurrency remains keyed to the source
   commit.
2. Require success from the pre-build image-content gate and every post-push gate.
   Confirm package metadata says `public`, the credential-free Registry V2 challenge
   and anonymous bearer retrieval of the exact digest succeed, and bearer-authenticated
   `latest` returns 404. If visibility, ownership, linkage, challenge, token, or
   anonymous retrieval differs, stop; do not deploy or weaken the verifier.
3. Record only the verified `platformManifestDigest` and immutable
   `imageReference`. Do not use the exact-commit tag, build-root index, or config
   digest as deployment identity.
4. Because this package is public, do not create a GHCR PAT and do not configure
   RunPod private-registry authentication. A registry pull credential would add an
   unnecessary secret and is outside this policy.
5. In one separately reviewed RunPod deployment, configure the worker image exactly:

   ```text
   ghcr.io/moodworks/fabrica-sam-worker@sha256:<verified-linux-amd64-manifest-digest>
   ```

6. Configure `SAM_WORKER_IMAGE_DIGEST` to the exact same
   `sha256:<64-lowercase-hex>` platform-manifest digest. Preserve the reviewed SAM
   model, checkpoint, configuration, limits, direct Load Balancer architecture, one
   dispatch, zero client retries, zero polls, and no queue wrapper.
7. Preserve minimum workers `0` and maximum workers `1`. Deployment, health checks,
   worker wake-up, and inference each require separate explicit authorization.

The existing endpoint `sawwuq4u7oiftj` version 11 remains historical evidence and
must not be mutated by this publication procedure.
