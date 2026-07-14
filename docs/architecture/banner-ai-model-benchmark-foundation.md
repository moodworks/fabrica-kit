# Banner AI model benchmark foundation

Banner AI remains a bounded pipeline, not a general agent. Model stages propose strict,
versioned data; deterministic Banner code validates it; a user decides what is accepted. Scene
analysis/OCR, segmentation, cutout generation, background fill, animation, rendering, export, and
web activation are separate authorities. This milestone designs only the first scene-analysis/OCR
candidate and grants authority to none of the later stages.

## First proposed candidate (inactive)

The first proposed candidate is OpenAI Responses API model alias `gpt-5.6-terra`, using only
`POST https://api.openai.com/v1/responses`. It is one local image-input scene-analysis plus OCR
request. The proposed request body has:

- the canonical `scene-analysis-v1` prompt as the sole instruction, with pinned content SHA-256
  `5cc311b7b353e06c61bcdf840b40dff9d35de0aea12851ffa18a654177917227`;
- one trusted normalized PNG as a `data:image/png;base64,...` value, never a provider-fetched URL;
- explicit image detail `original`;
- strict JSON Schema output, `max_output_tokens: 4096`, `tools: []`, `tool_choice: "none"`,
  `background: false`, and `store: false`;
- no browsing, retrieval, code execution, previous response, conversation, provider background
  work, model-directed follow-up, or autonomous call.

This exact body is a user-directed, hash-bound **proposed and unverified API shape**. No official
documentation or endpoint was accessed in this milestone. Current field semantics, model
availability, and provider terms remain future evidence gates.

`gpt-5.6-terra` is recorded as a proposed provider alias, not an immutable model snapshot. The
repository has no stable provider-version evidence. A future authorization must bind dated current
official availability/API evidence plus an exact expected provider model version and fingerprint.
Execution-observed provider/model-version/fingerprint evidence must be present and exactly equal;
absence or mismatch fails closed.

The numeric `modelVersion: 1` inside the existing Banner `AiModelContractV1` is only the internal
contract revision. It is not a provider snapshot or proof of OpenAI model immutability.

## Pricing evidence and independent reservation proof

The candidate contains the user-supplied pricing assertion captured 2026-07-13 and described
exactly as `user-supplied OpenAI public pricing page evidence`:

- standard input: USD 2.50 per million tokens (`2500000` micro-USD per million);
- standard output: USD 15.00 per million tokens (`15000000` micro-USD per million).

The canonical assertion is SHA-256-bound, has `productionPriceTruth: false`, and requires future
reconfirmation. These token rates do **not** prove that a request stays below the existing
`100000` micro-USD per-call ceiling. A future authorization separately needs an exact
provider/model/endpoint/request-shape-specific worst-case proof covering the 4096 output-token cap,
the `original`-detail image token formula, prompt/schema/input tokens, hidden or reasoning/billed
output, rounding, and every other billed unit. That proof is absent, so execution is blocked.

The established ceilings are unchanged: exactly 3 fixtures, 6 successful runs, at most 9 calls,
`100000` micro-USD per call, `900000` micro-USD total, 60 seconds per attempted call, 120 seconds
per logical run, and 600 seconds total.

## Trusted corpus admission

The production static source registry is empty. The embedded 12-by-8 Angel fixture is ineligible.
The loader never downloads, fabricates, accepts, or resolves a banner from a URL, remote store,
browser upload, caller path, provider response, or caller-supplied bytes.

The server-internal production loader accepts only a strict manifest and its exact future
authorization context. Static package-owned registry entries own original local bytes, filename,
declared type, and fixture reference. Before reading source bytes the loader requires exactly three
registry entries and validates all identities and duplicates. It then copies each original,
verifies original size and SHA-256, decodes and re-normalizes it once through
`normalizeRasterUpload`, and verifies source type/dimensions plus normalized PNG bytes, type, size,
dimensions, and SHA-256. Only after all three pass atomically does it mint one runtime capability.

Manifest entry evidence cryptographically binds the fixture/reference and original/normalized
digests to license evidence, privacy review evidence, human oracle evidence, and exact provider
transmission approval evidence. Transmission approval binds the normalized digest, `openai`,
`gpt-5.6-terra`, the sole Responses endpoint, profile/purpose, authorization ID/revision/evidence,
and authorization/review freshness windows. Canonical UTC `reviewedAt`/`expiresAt` values use the
server rule `reviewedAt <= authoritative server time < expiresAt`. Future, expired, missing,
malformed, duplicated, drifted, or unapproved evidence fails closed.

Verified bytes live only in a module-private `WeakMap`; capability membership lives in a private
`WeakSet`; internal retrieval returns another copy. Structural clones and lookalikes fail. The
loader exposes no production source-injection hook and is not exported from the package root.

### Exact three-image intake

The user must supply repository-local originals meeting all of these requirements:

1. Mixed subject + copy: 3–5 oracle layers and at least 2 exact text occurrences.
2. Text-heavy: 3–5 oracle layers and at least 3 exact text occurrences.
3. Layered no-text: 3–5 oracle layers and exactly 0 text occurrences.

Each must be user-owned or explicitly licensed for OpenAI evaluation; JPG/PNG; at most 5 MiB;
64–2048 pixels on each side; and at most 4,194,304 pixels. Intake records repository-local original
bytes, filename, original digest/type/size/dimensions, normalized PNG digest/size/dimensions,
license evidence, pixel and metadata/privacy review, oracle evidence, and explicit exact OpenAI
transmission approval with reviewed/expiry instants and evidence digests. Review must confirm no
secrets, PII/personal data, credentials, private client work, or embedded/visible tracking URLs.

## Strict output and quality boundary

Provider JSON is a strict object containing only:

- unchanged `CompositionAnalysisResultV1` composition data (maximum five parts);
- directly-visible evidence and bounded/canonical review flags exactly keyed to proposed parts;
- a mandatory discriminated OCR-completion disposition plus `TextObservationV1[]`; explicit
  no-visible-text is allowed only for the admitted no-text oracle and requires an empty array;
- a literal human-review/proposal-only/no-automatic-decision object.

Provider-supplied request, provider, model, authorization, policy, or provenance fields are rejected.
After JSON and schema validation, server code validates the composition against the trusted request
and constructs `ModelProducedActualTextObservationSetV1` provenance itself. Provider provenance is
never trusted.

The first run requires six of six valid structured successes. Only visible objects and text may be
reported. A successful proposal has 3–5 useful parts under the existing schema. Invalid JSON or
schema, missing OCR evidence, timeout, cap breach, or identity mismatch is terminal and fails
closed. Every output remains a proposal requiring user review and cannot authorize cutout,
segmentation, export, or any other product action.

## Server-only non-dispatching boundary

Every admission/model/API/cost/oracle/transmission freshness window and its earliest expiry remain
in private capability state and are rechecked against authoritative server time immediately when a
request plan is built; mint-time freshness alone is insufficient.

The server-only secret reference name is `OPENAI_API_KEY`; no secret value, environment read,
authorization header, SDK, API client, or network primitive exists. The internal builder requires
the runtime whole-corpus capability, exact fixed profile, strict request, exact future
authorization, the structural manual-control design revision, and every request/input/source/model/
prompt/policy/workflow/corpus/pricing/cost-proof binding. It runs the full inert preparation gate
from private trusted bytes before building: exact ledger, call/retry ordinal, reservation, timeout,
logical-call key, failure exposure, and all cost/time/call caps must fit. A private per-capability
claim rejects duplicate plan minting for the same exact bounded call.

Canonical request text, data URI, bytes, and linkable bindings remain private behind `WeakMap`/
`WeakSet` membership. The exposed plan contains only safe metadata and literal
`dispatchAuthority: false`; clones fail. The OpenAI adapter stub can describe and refuse a plan. It
has no dispatch method and cannot access a network.

Telemetry emits fixed profile/model/pricing evidence IDs and accepts only a strict input allowlist:
run ordinal, enumerated status/error, bounded counts, latency, and exact micro-USD. It rejects and never
emits image bytes/data URIs, filenames, OCR text, prompt body, secret values/headers, raw bodies,
raw errors, or full linkable corpus/source/request identifiers and hashes. Correlation is minted by
an internal runtime-only counter; callers cannot supply a correlation or linkable digest.

## Retry and authorization

The committed default is zero retry: no idempotency header/mechanism, timeout terminal, and every
`retryOrdinal > 0` rejected. Existing retry numbers are ceilings, not authority. A future
authorization may instead select one timeout replay only if it binds exact dated provider evidence,
the exact header/mechanism, and an at-most-once execution-and-billing contract for the identical
logical call. The repository makes no OpenAI idempotency claim today.

A future authorization must include revision, ID, canonical issue/expiry instants, revision
evidence, exact rendered statement and digests; candidate/API/endpoint/request-shape hash;
provider-version/fingerprint evidence; dated pricing assertion hash and separate worst-case proof;
six exact fixture/run source/request/input bindings; prompt/policy/workflow/corpus/evidence hashes;
all caps and quality rules; privacy/terms/training/retention/region/DPA confirmations; retry-union
choice; `OPENAI_API_KEY` reference name only; and the exact manual kill-switch release revision.
The committed manual-control objects are explicitly non-authoritative structural design inputs; a
future executor additionally requires a server-only opaque authoritative-control capability read
immediately before a call. Authorization is still not dispatch authority.

No network, OpenAI, paid, external, database, persistence, auth, billing, browser activation, or
real-model action occurred in this milestone.
