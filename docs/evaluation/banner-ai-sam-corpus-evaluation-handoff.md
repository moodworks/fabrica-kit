# Banner AI SAM corpus-evaluation handoff

Date: 2026-07-23  
State: provider-free text-heavy production-V3 implementation; external execution inactive

This is the current-state handoff for the additive SAM corpus-evaluation path. Earlier version-11,
health-only, build, and publication records remain historical evidence; they are not rewritten by
this document. This handoff grants no deployment, health, provider, credential, authorization,
production-admission, web-route, corpus-batch, or paid-call authority.

## Current reviewed deployment identity

The successful control-plane preflight identified the existing endpoint as:

| Binding                   | Reviewed value                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Endpoint                  | `sawwuq4u7oiftj`                                                                                               |
| Endpoint version          | `12`                                                                                                           |
| Worker image              | `ghcr.io/moodworks/fabrica-sam-worker@sha256:5f6058eb5f626ada2ce9ad3e9f105cd12b601f614df83265ab8479c8403ae7a8` |
| Minimum / maximum workers | `0 / 1`                                                                                                        |
| GPUs per worker           | `1`                                                                                                            |
| Published port            | `8000/http`                                                                                                    |

The model remains Meta SAM 2.1 base-plus at repository commit
`05d9e57fb3945b10c861046c1e6749e2bfc258e3`, config
`configs/sam2.1/sam2.1_hiera_b+.yaml`, and checkpoint SHA-256
`a2345aede8715ab1d5d31b4a509fb160c5a4af1970f199d9054ccfb746c004c5`.

## Completed person evidence

Two separately authorized person evaluations completed. Each authorization covered only its one
request. The first validated response SHA-256 was
`8a34785c8fd969b777860ad4da6279b39d167ffbeeb598124ccebc1faa8e9d6b`.

The second call completed as HTTP 200 / `validated-real-sam-output` with one dispatch/fetch, one
materialization, eight candidates, 27 sanitized files, and approximately 197.7 seconds runtime.
Its preserved evidence is outside the repository at:

```text
/Users/m/Documents/Fabrica/evaluation-evidence/sam/person-real-call-02-0fcc33436e67
```

The source in `/private/tmp/fabrica-sam-visual-real-call-02-0fcc33436e67` was left intact. The
verified evidence bindings are:

| Evidence                   | SHA-256                                                            |
| -------------------------- | ------------------------------------------------------------------ |
| Validated response         | `371b51fe00b0d80a32ad53a0de3ad864d089ea3dbb1e7cb3f2667ce170b29646` |
| Sanitized response         | `68c85095d9d0524dae4edb1f40f049cf1a6143a6be59a5446350530b2a2b3999` |
| Manifest                   | `b921f3390307857a166bcd4ba6c36a3d19d6c7f55ccd96e61e07d589af8638ee` |
| Inventory set              | `f44a29c2f53eaac2607e5cdfa34b6acbc10e1412af4e36260d7f1ebd44afae11` |
| Adjacent sanitized summary | `6c8f22eb18d7c61c25e9e3b375cc8872850d2c22024ebf12319cc131ea7422b0` |

The first and second validated-response hashes differ. This is **output drift, not
deployment-identity drift**. Both executions were bound to the reviewed version-12 immutable
deployment identity.

## Provider-free corpus path

The person V1 path remains unchanged. The parallel V1 catalog/V2 materialization path closes over
the remaining committed fixtures and accepts no caller source, dimensions, fixture identity,
endpoint identity, model identity, limits, or authorization bindings. Text-heavy and no-text have
independent canonical requests and process-local single-use provider-free authorizations. Product
is refused by the native automatic-mode capacity gate before authorization, transport construction,
or output inspection.

| Fixture                | One-point peak bytes |     Ceiling | Native automatic eligibility |
| ---------------------- | -------------------: | ----------: | ---------------------------- |
| Person                 |          `106223296` | `268435456` | eligible                     |
| Product (`2015 × 900`) |          `650511040` | `268435456` | refused                      |
| Text-heavy             |          `114138112` | `268435456` | eligible                     |
| No-text                |          `104406880` | `268435456` | eligible                     |

Product must not be silently resized, moved to another segmentation mode, or admitted under a
larger ceiling. It needs a separate worker-capacity/image/deployment milestone. **Text-heavy is the
next eligible paid fixture**, but no paid call is authorized by this handoff.

V2 output is always candidate-dependent:

```text
candidateCount = 0..8
sanitizedFileCount = 3 + (3 × candidateCount)
valid sanitizedFileCount = 3..27
```

The three fixed files are `source.png`, sanitized `response.json`, and `manifest.json`; each
candidate adds one mask, one cutout, and one overlay. The verifier reproduces all byte lengths,
SHA-256 values, PNG dimensions, mask geometry, cutout pixels, overlays, response/manifest
relationships, and inventory digests. Publication uses a fresh absent directory, an adjacent
staging directory, an exclusive final-directory claim, and no-overwrite hard links. All
non-manifest artifacts publish first; the canonical manifest publishes last as the atomic validity
marker.

The visual-review contract requires explicit inspection of every mask, cutout, and overlay;
candidate-to-layer rationale; missing-layer, duplicate, and merge observations; and six separate
integer scores from zero through four, always higher-is-better. It emits no averaged model-quality
score. SAM provides segmentation geometry only. Semantic ranking/naming, OCR, background
reconstruction, and matte repair remain separate capabilities.

## Text-heavy production V3 preparation

The additive text-heavy-only production V3 stack is bound to repository state
`524a708ed95972e39a994ad711e4202238094fc2`. It preserves the person V1 and corpus V1/V2 paths and
does not add web, production-admission, general-admission, product, no-text, or corpus-batch wiring.
All production registries remain empty and all broad activation flags remain false.

The V3 preparation closes over `banner-text-heavy-v1` and independently rechecks, immediately
before any transport construction, the canonical request (222,620 bytes; SHA-256
`a14354bb67685293a8aa3c2523db36506b2050d53f0dea90c4070bcdd015ee26`), endpoint version 12,
immutable worker image and digest, model/checkpoint/configuration profiles, source/oracle bindings,
automatic-mode capacity (`114138112 <= 268435456` bytes), 330,000 ms timeout, 250,000 micro-USD
incremental ceiling, and all exact-once/zero-retry limits.

One opaque prepared object can mint one 330,000 ms text-heavy authorization only after a durable
canonical-call claim has been exclusively created, file-synced, directory-synced, and reread with
exact byte and SHA-256 verification. The claim key is independent of output selection and binds the
repository, deployment, immutable image digest, fixture UUID quartet, and canonical request digest.
The future production claim root must be the private, current-user-owned directory
`/private/tmp/fabrica-sam-text-heavy-production-v3-claims`. A future output must be one fresh,
absent, non-symlink direct child of `/private/tmp` with the reviewed V3 basename; no production
output path was selected or created in this milestone. Claims, authorizations, execution
capabilities, factories, and output paths are one-way consumed and are never released for retry,
including indeterminate outcomes.

The production transport factory accepts only a server-owned key value and the fixed secret
reference, defers canonical native transport construction until every local guard and capability
consumption has completed, and offers no caller-injected fetch implementation. The provider-free
tests use separately branded, closed outcome descriptors. The native-composition test uses an
internal dummy authorization value and internal fake fetch, returns only sanitized in-memory
request evidence, is labeled `FAKE TEST OUTPUT — NOT SAM OUTPUT`, performs no materialization, and
cannot enter the production executor. No environment variable, credential, provider, deployment,
or external network access occurred; the new V3 tests make no network requests (the unchanged
worker regression suite uses only its local fixture servers).

Known 4xx failures, invalid responses, exact-timeout and lost-response indeterminate outcomes, and
local publication races are sanitized without propagating raw bodies, headers, credentials, or
underlying error causes. Every outcome permanently consumes the one dispatch claim and remains
non-retryable. Successful provider-free materialization retains the dynamic `3 + 3N` rule and
produces one single-use, provider-neutral visual-review capability.

## Next gates

Repository integration requires a separate review, commit, push, and pull-request authorization.
The next external gate is a fresh read-only version-12 immutable-identity preflight plus explicit
selection of one valid, absent production output child. Only after that preflight is GO may the
owner separately authorize exactly one text-heavy native POST with its frozen canonical request.
Such an authorization grants nothing to product or no-text and retains one dispatch/fetch, one
materialization, zero retry/poll/health/`/ping`/queue requests, the reviewed timeout and cost
ceiling, and `providerBillingGuarantee: false`. This handoff does not mint that authorization or
authorize the paid call.
