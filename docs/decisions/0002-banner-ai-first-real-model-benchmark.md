# ADR 0002: Banner AI first real-model benchmark authorization gate

- Status: Proposed and hard-disabled
- Date: 2026-07-13
- Decision owners: Sol (scope), Terra (independent acceptance), Luna (implementation)
- Profile: `banner-scene-analysis-ocr-first-call-v1`

## Decision

Define, but do not activate, the first real-model benchmark category: scene analysis and exact
OCR/text observations from a single image-input model using strict structured JSON. Each attempted
run makes exactly one attempted provider call. A separately authorized future timeout replay would
be a second counted attempt for the same logical run, never a follow-up chosen by the model.

The repository does not establish a real provider, exact model identifier, immutable model or
snapshot pin, exact HTTPS endpoint, provider/model/endpoint-specific worst-case request-cost
evidence, or an at-most-once timeout replay and billing contract. Candidate selection is therefore
a blocking user decision. No placeholder candidate or endpoint is committed in the profile.
Visibly test-only `.invalid` identities exercise provider-free validation only. This milestone did
not live-verify price, model availability, provider terms, or provider policy.

This category is first because useful scene-layer proposals and preserved visible copy are the
earliest product evidence needed to judge Banner decomposition. One bounded vision request tests
both without introducing another provider or an autonomous workflow. Segmentation, inpainting,
animation, rendering, and export are deliberately deferred and receive no benchmark budget.

The profile requires:

- image input; strict structured JSON; scene-analysis parts; exact normalized OCR observations;
  normalized bounding boxes; and deterministic source, request, workflow, and provider-call
  identities;
- canonical `scene-analysis-v1` prompt version 1 and content SHA-256
  `5cc311b7b353e06c61bcdf840b40dff9d35de0aea12851ffa18a654177917227`;
- content-policy definition SHA-256
  `14a27c163a4082a966971028e59b6d1d56ea9cde99038b823c0a18b1ea92d0c4`;
- the initial immutable Banner analyze workflow, `CompositionAnalysisResultV1`,
  `ModelProducedActualTextObservationSetV1`, and at most five proposed parts;
- exact response identity equality with the selected provider, model identifier, and immutable
  version; and
- no tools, browsing, retrieval, URL fetching, code execution, model-directed follow-ups, or
  autonomous calls.

The committed profile is unselected, has an empty endpoint allowlist, disabled network, an engaged
manual control, no authorization, and no dispatcher. Environment or secret presence alone never
authorizes execution.

## Candidate, replay, and endpoint decisions still required

A future selected candidate must reuse an external project AI-model identity with `ocr`,
`scene_analysis`, and `structured_output` capabilities and bind one canonical credential-free
HTTPS `POST` endpoint. The user must supply and confirm two provider/model/version/endpoint-specific
evidence digests:

1. evidence that the selected bounded request cannot exceed the configured worst-case reservation
   ceiling; and
2. provider documentation or contract evidence for an exact HTTPS idempotency header name and the
   assertion that an initial request and identical post-timeout replay with the same logical key
   result in at-most-once provider execution and billing for that logical run.

No such replay contract is currently verified or committed. Without it, timeout is terminal and a
future selected profile must be revised to zero retries before authorization. With it, the logical
call key is a deterministic SHA-256 projection of the authorization digest, admitted-manifest
digest, fixture ID, run ordinal, and validated provider-request digest. Retry ordinal is excluded:
the initial attempt and its timeout replay use the identical key, while another run has another key.
The outcome classifier is explicitly non-authoritative and never grants retry authority. A first
timeout is counted, preserves its exact cost, engages manual control, and can only become a pending
bound-review state. After a fresh authoritative release, the preparation gate must revalidate the
candidate, authorization, request digest, key, mechanism, and every remaining cap; even its result
has `retryAuthority: false` and `dispatchAuthority: false`. The new release revision must be
strictly greater than the revision recorded when the timeout re-engaged control.

The endpoint policy rejects literal IP hosts and localhost/local/internal-style names. The future
executor must resolve only public approved addresses, pin them for the call, and reject private,
reserved, link-local, and loopback addresses, DNS rebinding, proxy overrides, redirects, alternate
origins, paths, or methods. Queries, fragments, and embedded credentials are forbidden.

## Proposed benchmark gates

Every budget below is configuration marked exactly **“requires explicit user authorization before
execution.”** These values are benchmark caps, not price or performance claims.

- Corpus and success: exactly three admitted fixtures; two successful runs per fixture; six of six
  strict-output runs.
- Calls and failures: at most nine provider calls, three retries total, one timeout retry across
  both runs for each fixture, two failed attempts per fixture, and three failed attempts globally.
  A call is rejected when a fixture already has two failures or the ledger already has three, so a
  further failure can never exceed either exposure. The nine-call arithmetic is a conservative
  ceiling; execution may stop earlier.
- Cost: `100000` micro-USD provider/model/endpoint-specific worst-case reservation per attempted
  call and `900000` micro-USD total. The existing exact cost contract carries one `100000`
  model-inference reservation unit and zero segmentation, inpainting, storage, retry, or
  failed-attempt surcharge units, with `productionPriceTruth: false`. This is not a flat provider
  tariff or production pricing truth. The user-confirmed evidence must show that the selected
  bounded request cannot exceed the reservation.
- Ledger: `worstCaseReservedSpendMicros` must equal `totalProviderCalls * 100000` using bigint
  arithmetic. Actual cost is recorded when known; otherwise the entire reservation is accounted,
  including failed or indeterminate attempts. A running ledger cannot carry an overrun, and a
  future pre-call gate reserves the complete next-call ceiling.
- Time: at most `60000` ms per attempted provider call, `120000` ms per logical run across its
  initial attempt and sole possible timeout replay, and `600000` ms total wall-clock time. The
  ledger records attempted-call count and elapsed provider-call time separately for each fixture
  and logical run. “Successful run” continues to mean one strict successful output, not an attempt.
- Image: original ingress is JPEG or PNG; transmitted normalization is PNG; byte size is
  `1..5242880`, each side is `64..2048`, and decoded area is at most `4194304` pixels.
- Scene quality: each successful proposal has three to five human-useful parts. Across six runs,
  required-layer recall and useful-proposal precision must each be at least 8000 basis points.
- OCR quality: duplicate-aware exact normalized-text multiset precision and recall must each be
  10000 basis points. Deterministic one-to-one exact-text matches require bounding-box IoU of at
  least 7000 basis points, calculated with integer arithmetic. Model confidence is never oracle
  truth. A no-text fixture passes only with zero model-produced text observations.

Before a call, the future boundary must prove the next full reservation and attempted-call timeout
fit the logical-run and total remaining caps. Equality is allowed; exceeding a cap is not.
Malformed output, permanent provider rejection, policy rejection, rate limiting, transient
transport failure, indeterminate result, and worker loss are closed terminal outcome classes;
unknown outcomes fail closed. Every non-success is counted and preserves the exact canonical full
actual cost when known or full reservation otherwise. The ledger has distinct validated running
and terminal-inconclusive states. A terminal state has `retryAuthority: false`, engaged manual
control, the exact last-call identity and outcome class, and refuses all later preparation. Its
aggregate accounting must equal the canonical prior-accounted amount plus the full terminal-call
amount; the prior amount cannot exceed the reservation for all earlier calls. Only the target
fixture may carry one newly unrecovered failure, and its terminal run is exactly the next run after
its strict successes. An actual post-call overrun preserves the complete terminal-call amount
without clipping, requires that call itself to exceed `100000` micro-USD, and can exist only in the
explicit terminal-overrun state. A running ledger rejects that overrun.

## Corpus admission

The committed manifest is empty and blocked; it downloads and fabricates nothing. The existing
12-by-8, 77-byte Angel fixture is explicitly ineligible. Execution requires the user to supply
exactly three JPG/PNG creatives:

1. mixed subject and copy, with three to five required oracle layers and at least two exact text
   occurrences;
2. text-heavy, with three to five required oracle layers and at least three exact text occurrences;
3. layered with no text, with three to five required oracle layers and zero text occurrences.

Each entry must be user-owned or explicitly licensed for third-party provider evaluation. It must
record original content type, digest, and byte size; normalized PNG digest, size, and dimensions;
owner/license evidence; completed pixel and metadata review; confirmed absence of secrets,
personal data, credentials, private client work, and embedded or visible tracking URLs; and a
separate explicit human provider-transmission approval object and evidence digest. There is no URL
source field.

Provider-neutral human oracle evidence has a separate `human-expected-oracle` role, digest,
reference, required layers, and expected text occurrences. Model-produced evidence is structurally
incompatible and cannot be admitted as an oracle. OCR scoring additionally validates the complete
model-produced evidence envelope against the authoritative request and admitted source/fixture
binding before comparison.

The existing trusted repository loader still allowlists only the Angel fixture. A manifest
reference alone cannot make bytes loadable or admitted. A later reviewed implementation must use a
package-owned admitted-corpus allowlist and fully normalize, decode, digest, and dimension-check
the bytes; this milestone does not relax the current provider-free loader.

## Secrets, manual control, privacy, and telemetry

The only permitted secret name is `BANNER_AI_REAL_MODEL_BENCHMARK_API_KEY`; no value belongs in
source, profile, authorization, logs, browser code, or client input. Secret access is server-side
only, and browser provider calls are forbidden.

Request logging must not contain image bytes, filenames, OCR text, secrets, raw provider request or
response bodies, raw errors, full linkable corpus/source/request identifiers or hashes, or endpoint
queries. Redacted telemetry is limited to profile/model/reservation IDs, run ordinal, status class,
counts, latency, exact micro-USD, and a genuinely opaque correlation value.

The separately modeled manual control defaults to committed state `engaged`. A release binds its
revision to the exact authorization ID and digest, profile ID and digest, and admitted-manifest
digest. Re-engaged and stale releases fail closed. A future executor must read the fresh
authoritative server-side control immediately before every provider call; caller-supplied JSON is
never control authority. No release or authoritative control store is implemented here.

Before execution, the user must confirm license and third-party transmission rights; current
provider terms and exact model availability; provider/model/version/endpoint reservation evidence;
the at-most-once timeout replay execution and billing contract; training use; retention and
deletion; human review, subprocessors, and abuse monitoring; processing region, cross-border
transfer, DPA, and legal basis; and every corpus transmission approval. These are assumptions to be
confirmed, not facts established by this ADR.

## Exact authorization rendering

No authorization object or rendered authorization statement is committed. A future authorization
must bind the selected candidate, immutable model version, sole endpoint, selected-profile and
admitted-manifest digests, worst-case reservation configuration and evidence, replay contract and
mechanism evidence, prompt/policy/workflow bindings, every image/quality/call/cost/time cap, all
confirmations, and the bounded execution release.

Rendering is deterministic UTF-8 text. `<canonical-payload-json>` is the repository's canonical
JSON encoding of every authorization field except `renderedUserStatement`:

```text
I explicitly authorize this one bounded Banner AI real-model benchmark payload=<canonical-payload-json>. I authorize no other provider, model, version, endpoint, corpus, prompt, policy, workflow, call, retry, spend, time, data use, or purpose.
```

The exact text and authorization digest are re-derived. A missing or changed field, confirmation,
digest, cap, or character fails closed. This authorization is necessary but is not a network
capability; a separate fresh manual-control release is also required.

## Current boundary and next milestone

The preparation gate validates exact profile, authorization, corpus, source, request, provider-call,
logical-call, ordinal, running-ledger, per-run latency, manual-control, cost, and attempted-call
timeout bindings. Its returned intent explicitly has `retryAuthority: false` and
`dispatchAuthority: false`; the outcome classifier also cannot grant either authority. Plain
caller bytes and metadata are not authoritative.
Any future executor must introduce both a trusted admitted-corpus source loader and unforgeable
server-side source and provider-call capabilities.

There is no dispatcher, provider SDK, network client, secret reader, control store, or web
activation route. The current provider-free adapter remains network-disabled and accepts only its
existing materialized local fixtures. This profile cannot activate through the web app or adapter.

The exact next recommended milestone is **candidate-and-corpus evidence completion plus trusted
corpus loader and unforgeable server-side execution-boundary design**. That milestone must remain
provider-free and cannot execute a real-model benchmark without a later, separately reviewed exact
authorization and control release. This ADR and its configuration make no external call and grant
no dispatch authority.
