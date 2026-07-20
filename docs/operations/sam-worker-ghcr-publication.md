# SAM worker GHCR publication and digest-pinned deployment

This procedure is for a later, separately authorized external stage. Local
implementation and repair stages only prepare and test repository code. They do not
publish a package, create a credential, change RunPod, contact a worker, or run
inference.

## Identity and trust boundary

The deployment identity is the Linux/AMD64 platform image-manifest digest:

```text
ghcr.io/moodworks/fabrica-sam-worker@sha256:<64-lowercase-hex>
```

It is not the source commit, tag, image config digest, multi-platform index digest,
base-image digest, local Docker ID, or a digest inferred from a filename. The trust
chain is:

```text
verified GHCR Linux/AMD64 image-manifest digest
→ RunPod image reference pinned to repository@digest
→ independently configured SAM_WORKER_IMAGE_DIGEST
→ authorization-bound caller expectation sent in the strict worker request
→ worker comparison before engine invocation
→ trusted digest in the strict live response execution identity
→ caller equality check before returning or materializing results
```

`SAM_WORKER_IMAGE_DIGEST` is immutable non-secret configuration. It is not a
hardware-backed, provider-signed, or measured-boot attestation. Its value is trusted
because the operator must configure it independently to the same registry-proven
manifest used in RunPod's pinned image reference.

## Publication contract

The manual `Publish pinned SAM worker to private GHCR` workflow accepts one explicit
40-character lowercase source commit. It checks out that commit without persisted Git
credentials and confirms `HEAD` exactly. Except for the harmless source-free bootstrap
described below, its only actual SAM worker publication is tagged:

```text
ghcr.io/moodworks/fabrica-sam-worker:<exact-source-commit>
```

The build uses repository-root context, `services/sam-worker/Dockerfile`, and only
`linux/amd64`. `FABRICA_GIT_SHA` is mandatory and the image config label must bind the
same exact commit. The workflow grants only `contents: read` and `packages: write`,
authenticates to GHCR with its ephemeral `GITHUB_TOKEN`, and publishes to no other
registry. It never creates or updates `latest`.

Before any SAM worker build, the workflow performs an authenticated GitHub Packages
GET against the user-owned `moodworks/fabrica-sam-worker` container package. A
successful response must prove the exact package name and type, `private` visibility,
the `moodworks` user owner, and linkage to `moodworks/fabrica-kit`. Because the GET
uses this workflow repository's `GITHUB_TOKEN`, a successful private, exactly linked
response is also the available Actions-access proof; the package response does not
expose a separate Actions-access list. Public, internal, malformed, mislinked,
forbidden, or other failed responses stop before any worker build. The workflow never
changes package visibility and never deletes a package. See GitHub's official
[Packages REST reference](https://docs.github.com/en/rest/packages/packages) and
[GitHub Actions package publication guidance](https://docs.github.com/en/packages/managing-github-packages-using-github-actions-workflows/publishing-and-installing-a-package-with-github-actions).

An authenticated `404` does not prove absence; it means absent or inaccessible. That
state permits only one harmless namespace-bootstrap attempt. The workflow constructs
a temporary build context under `RUNNER_TEMP` containing exactly a `FROM scratch`
Dockerfile and the required public repository-linkage label. It builds with no network,
provenance, or SBOM and pushes only a unique
`bootstrap-<run-id>-<run-attempt>` version. The bootstrap contains no SAM worker
source, model, checkpoint, configuration, fixtures, credentials, or private metadata.
Afterward, the same authenticated exact-private linkage check is mandatory. A failed
bootstrap push or any absent, inaccessible, public, internal, ambiguous, or mislinked
post-bootstrap result stops before the SAM worker build. This is particularly
important because a package created from a public workflow repository can inherit
public visibility.

BuildKit provenance and SBOM attestations are explicitly disabled. This avoids
creating an attestation-bearing index as an accidental deployment identity, but the
workflow does not assume that this setting makes BuildKit's returned digest a
platform-manifest digest. After push it fetches the registry object by digest and
checks the raw-byte SHA-256, `Docker-Content-Digest`, response media type, and document
media type. If the root is an OCI index or Docker manifest list, the validator selects
exactly one Linux/AMD64 child and then separately fetches and proves that child image
manifest. It verifies the manifest's config descriptor, config raw-byte digest and
size, Linux/AMD64 fields, source/revision labels, layer descriptor types, and the
manifest/config digest distinction. It repeats the authenticated exact-private package
check after registry verification and before emitting success metadata. Any ambiguity
or mismatch fails closed.

The workflow emits only the source commit, source tag, root object classification,
Linux/AMD64 platform image-manifest digest and media type, config digest, immutable
image reference, and explicit provenance/SBOM policy. Tokens and response bodies are
not emitted as identity metadata. The repository-owned publication CLI parses the
scoped registry-token envelope and keeps the token only in process memory; it neither
prints nor writes that token.

## Later authorized operator sequence

1. After an authorized commit exists, manually dispatch the publication workflow with
   that exact full commit. Review the workflow run and require success from the
   privacy gate and post-push platform-manifest validator. If the run publishes only
   the harmless bootstrap and then rejects non-private metadata, stop. Do not assume
   the package can be converted back to private, and do not treat this procedure as
   authorization to change visibility, delete, or recreate it. Resolve package
   ownership and privacy under a separate package-administration review before any
   rerun.
2. Confirm the new `ghcr.io/moodworks/fabrica-sam-worker` package is private. Record
   the workflow's verified `platformManifestDigest` and immutable `imageReference`.
   Do not use the exact-commit tag as deployment identity.
3. Only after the package exists, create a least-privilege GitHub classic personal
   access token for the RunPod pull identity with only `read:packages`. Do not grant
   repository write, package write/delete, workflow, administration, or unrelated
   scopes. Store it only in the provider's private-registry credential facility.
   GitHub's official
   [Container registry authentication documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry#authenticating-with-a-personal-access-token-classic)
   defines the classic PAT and `read:packages` pull scope.
4. Configure RunPod private-registry authentication for `ghcr.io` with the dedicated
   read identity. Do not place the token in an image reference, endpoint environment
   report, source file, log, or deployment note. In that later authorized stage, use
   RunPod's official
   [private container registry management reference](https://docs.runpod.io/runpodctl/reference/runpodctl-registry)
   to save the pull credential, then follow the official
   [template-management reference](https://docs.runpod.io/sdks/graphql/manage-pod-templates)
   to attach the saved credential by `containerRegistryAuthId` to the reviewed
   Serverless template/configuration. Do not embed registry credentials in the
   endpoint image URL. These are deferred operator actions; local implementation and
   repair stages do not run `runpodctl`, issue a GraphQL mutation, or create or attach
   a credential.
5. In one separately reviewed deployment, configure the worker image as:

   ```text
   ghcr.io/moodworks/fabrica-sam-worker@sha256:<verified-linux-amd64-manifest-digest>
   ```

6. Configure `SAM_WORKER_IMAGE_DIGEST` to that exact same
   `sha256:<64-lowercase-hex>` platform-manifest digest. Preserve the reviewed SAM
   model, checkpoint, configuration, request/response limits, direct Load Balancer
   architecture, one dispatch, zero client retries, zero polls, and no queue wrapper.
7. Preserve minimum workers `0` and maximum workers `1`. A deployment or later health
   or inference exercise requires its own explicit authorization; publication alone
   grants none.

The existing endpoint `sawwuq4u7oiftj` version 11 remains historical evidence and must
not be mutated by this publication procedure.
