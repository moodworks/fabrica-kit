# ADR 0002: Banner AI first real-model benchmark authorization gate

- Status: Proposed, evidence-blocked, corpus-blocked, and hard-disabled
- Date: 2026-07-14
- Decision owners: Sol (scope), Terra (independent acceptance), Luna (implementation)
- Profile: `banner-scene-analysis-ocr-first-call-v1`

## Decision

Record one explicit first benchmark candidate without activating it:

- provider: `openai`;
- API family: Responses API;
- sole endpoint/method: `POST https://api.openai.com/v1/responses`;
- requested model alias: `gpt-5.6-terra`;
- task: one trusted local image-input scene-analysis + OCR request;
- detail: explicit `original`;
- output: strict structured JSON only;
- instructions: canonical `scene-analysis-v1`, version 1, SHA-256
  `5cc311b7b353e06c61bcdf840b40dff9d35de0aea12851ffa18a654177917227`;
- output limit: `max_output_tokens: 4096`;
- tools/background/storage: `tools: []`, `tool_choice: "none"`, `background: false`,
  `store: false`;
- absent: browsing, retrieval, code execution, provider URL fetching, previous response,
  conversation, provider-side autonomous/background work, and follow-up calls.

Segmentation/SAM, cutouts, background fill/inpainting, animation, rendering, export, web
activation, persistence, auth, billing, and deployment are excluded.

The requested model ID is a proposed and unverified provider alias. It is **not** claimed to be an
immutable snapshot. The Responses request contract is also a hash-bound proposed/unverified shape.
No official or network verification occurred. Model availability, exact API field semantics,
provider terms, and an observed model-version/fingerprint identity remain future gates.
The existing Banner model contract's numeric `modelVersion: 1` is only its internal contract
revision and is not provider-version or snapshot evidence.

## Pricing and cost gate

The repository records the user-supplied pricing evidence captured 2026-07-13, source descriptor
`user-supplied OpenAI public pricing page evidence`: standard input USD 2.50/M tokens
(`2500000` micro-USD/M) and standard output USD 15.00/M tokens (`15000000` micro-USD/M). The
canonical assertion has a computed SHA-256, `productionPriceTruth: false`, and requires future
reconfirmation.

Token rates do not establish a USD 0.10 request maximum. Execution remains blocked until a future
authorization binds a separate provider/model/endpoint/request-shape proof covering the exact 4096
output-token cap, `original` image-token formula, prompt/schema/input tokens, hidden/reasoning and
all billed output, rounding, and other billed units. The proof must establish at most `100000`
micro-USD for the exact bounded request.

Existing caps remain authoritative ceilings: exactly 3 admitted fixtures; 2 successful runs each;
6 successful runs; at most 9 calls; `100000` micro-USD/call; `900000` total; 60 seconds/attempted
call; 120 seconds/logical run; and 600 seconds total.

## Retry decision

No OpenAI idempotency contract is asserted. The committed mode is zero retry: no idempotency
header/mechanism, timeout terminal, and `retryOrdinal > 0` rejected. Numerical retry caps remain
ceilings only.

A future exact authorization may choose a one-time timeout replay only when it binds dated current
provider/model/endpoint evidence, the exact header/mechanism, identical logical-call behavior, and
an at-most-once execution-and-billing contract. Without all of that evidence, the zero-retry branch
is mandatory.

## Corpus decision

The production source registry and manifest entries are empty; execution is corpus-blocked. The
12-by-8 Angel fixture is ineligible. No banner was downloaded or fabricated.

Required intake is exactly:

1. Mixed subject + copy, 3–5 required oracle layers, at least 2 exact text occurrences.
2. Text-heavy, 3–5 required oracle layers, at least 3 exact text occurrences.
3. Layered no-text, 3–5 required oracle layers, exactly 0 text occurrences.

Each must be user-owned or explicitly licensed for OpenAI evaluation; a repository-local JPG/PNG
no larger than 5 MiB; 64–2048 pixels per side; and no more than 4,194,304 pixels. Intake requires
original digest/type/size/dimensions, normalized PNG digest/size/dimensions, license evidence,
pixel+metadata/privacy review, absence of secrets/PII/credentials/private client work/tracking
URLs, human oracle evidence, and exact OpenAI transmission approval. Approval binds normalized
digest, provider, model alias, endpoint, profile/purpose, authorization revision/freshness, and
canonical UTC `reviewedAt`/`expiresAt` plus evidence digests.

The server-internal loader accepts manifest and authorization context only. A package-owned static
registry owns filenames, types, references, and bytes. It validates all three identities before
reading bytes, copies and verifies originals, re-normalizes each through trusted raster rules,
re-verifies source/normalized type/size/dimensions/digests, and mints one whole-corpus capability
only after atomic success. Bytes and membership remain private in `WeakMap`/`WeakSet` state; clones
fail. URLs, paths supplied at runtime, remote storage, browser uploads, provider responses, and
caller bytes are never sources.

## Output and quality decision

Provider JSON contains only the unchanged `CompositionAnalysisResultV1`, directly-visible
per-layer evidence/confidence and bounded canonical review flags, a mandatory discriminated OCR
completion disposition plus `TextObservationV1[]`, and a literal human-review/proposal-only/no-
automatic-decision object. A no-visible-text disposition is valid only for the admitted no-text
oracle and requires an empty observation array.
Strict objects reject provider-supplied provenance, request, model, policy, and authorization data.
Server code validates the result against the trusted request and constructs
`ModelProducedActualTextObservationSetV1` provenance itself.

Six of six outputs must be valid. Only visible objects/text are reportable; successful layer
proposals contain 3–5 useful parts, maximum 5; OCR uses exact normalized text and normalized boxes.
Invalid JSON/schema, missing OCR evidence, timeout, cap breach, or identity mismatch fails closed.
Every output remains a user-review proposal and cannot automatically authorize cutout, export, or
another product action.

## Server-only request boundary

The only secret reference name is `OPENAI_API_KEY`; no value, `.env`, environment read,
authorization header, SDK, client, or network primitive exists. Browser/client activation,
configuration, and provider calling are forbidden.

The internal request builder requires an unforgeable whole-corpus capability, exact profile,
validated request, exact future authorization, structural manual release revision, and all
candidate/request/input/source/prompt/policy/workflow/corpus/pricing/cost-proof bindings. It builds
the proposed local-data request only after rerunning the full inert preparation gate with private
trusted bytes: ledger, call/retry ordinal, cost reservation, timeout, logical-call key, failure
exposure, and every cap are exact. Private capability state rejects a duplicate plan for the same
bounded call. All admission/model/API/cost/oracle/transmission freshness windows and the earliest
expiry are rechecked at plan construction, not only corpus minting. Exposed plans contain safe metadata only,
`dispatchAuthority: false`, and `networkDispatch: "not-implemented"`. Structural clones fail. The
stub exposes describe/refuse behavior and no dispatch method.

Telemetry is strict and redacted: profile/model/pricing evidence IDs, run ordinal, enumerated
status/error, counts, latency, exact cost, and opaque correlation only. Image bytes/data URIs,
filenames, OCR text, prompt, secrets/headers, raw bodies/errors, and full linkable hashes/IDs are
forbidden. Correlation IDs are minted by a private runtime-only counter and cannot be caller-
supplied.

## Future exact authorization object

A future authorization must bind all of the following and validate every derived digest/text:

- version/revision, authorization ID, canonical issue/expiry instants, revision-evidence SHA-256;
- canonical payload SHA-256, exact rendered user statement, rendered-statement SHA-256;
- exact profile/candidate/API family/endpoint/request-shape hash and 4096 output-token cap;
- dated current official model-availability and API-field-semantics evidence;
- exact expected provider model version/fingerprint evidence, later matched to execution-observed
  evidence or failed closed;
- dated pricing assertion SHA-256 plus the separate exact worst-case request-cost proof;
- prompt, content-policy, workflow, corpus manifest/evidence, source, request, and input digests;
- six exact fixture/run request bindings, every cap, and the frozen quality contract;
- license/privacy/transmission, terms, training, retention/deletion, human review/subprocessors/
  abuse monitoring, region/cross-border/DPA/legal-basis confirmations;
- the selected strict retry-union branch;
- `OPENAI_API_KEY` reference name only; and
- exact required manual kill-switch release revision and release evidence.

Authorization and structural release data remain necessary but are not network capabilities. The
structural manual-control object is explicitly non-authoritative; a future executor must require a
server-only opaque authoritative-control capability read immediately before any call. No
authorization, authoritative control capability, or release is committed.

## Consequences and next milestone

The exact next recommended milestone is **user-owned three-banner corpus intake plus the dated
OpenAI official-evidence and exact authorization packet, still provider-free and with no model
call**. Only after independent review of that packet may a separately authorized paid/network
benchmark execution milestone be proposed.

No network, OpenAI, paid, external, SDK, database, persistence, UI, secret, commit, push, or
deployment action occurred in this milestone.
