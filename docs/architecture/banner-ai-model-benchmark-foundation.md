# Banner AI model benchmark foundation

Banner AI is a bounded pipeline, not one general AI agent. Each stage has a narrow input,
versioned prompt, strict output contract, measurable cost and latency, and a deterministic
validation boundary. This makes model quality comparable, prevents one model response from
silently changing workflow identity, and keeps pixel processing and animation behavior under
product-controlled deterministic code.

The intended later pipeline is:

1. A vision model proposes scene structure and text-bearing regions.
2. OCR reads visible copy so exact text preservation can be evaluated independently of visual
   layer quality.
3. SAM-style segmentation produces masks for accepted layer proposals.
4. An inpainting model fills regions exposed when foreground layers are separated.
5. A constrained animation-planning stage proposes motion against canonical layer identities.
6. Deterministic Banner code validates and renders the approved animation plan.

No production vision, OCR, segmentation, inpainting, or animation-planning model has been
selected. Provider choice, quality thresholds, latency budgets, retry policy, and benchmark
prices remain benchmark decisions. Pricing inputs are explicitly versioned benchmark
configuration, never live provider prices treated as production truth.

This milestone adds three canonical prompts (`scene-analysis-v1`, `background-fill-v1`, and
`animation-plan-v1`), provider-neutral request/result identities, a single allowlisted reference
to the existing Angel PNG fixture, exact micro-USD cost arithmetic, a deterministic fake adapter,
and a pure evaluation runner. The benchmark input digest covers only the validated model request
projection: fixture, source, model, prompt, options, and workflow. Expected rubrics, review status,
and returned output are deliberately outside that request digest. AI-input, operation-request, and
provider-call request digests remain separate nominal types and are never interchangeable fields.

## Fixture integrity

Repository benchmark fixtures are executable inputs, not descriptive metadata. The trusted loader
accepts the fully validated, request-digest-bound scene-analysis request and exactly one matching
fixture reference. Resolution is a closed package-owned allowlist: it accepts no caller path,
remote URL, arbitrary resolver, external file, object store, or database record. The current entry
resolves fresh in-memory bytes from the package-owned Angel source and runs them through the same
`normalizeRasterUpload` path as Banner uploads.

After normalization, the loader independently compares the declared input media type and the
normalized byte count, PNG media type, dimensions, and SHA-256 with the metadata pinned in the
request source asset. Every comparison must match exactly. Missing, duplicate, malformed, stale,
foreign, or additional references fail closed, as does a self-consistent request that names a
fixture outside the allowlist. Verified bytes are copied before return so a consumer cannot mutate
the allowlisted source or another load result. The old web-helper reference is intentionally stale;
the web test helper now consumes the package-owned source without transforming it.

## Product bounds before dispatch

Every future model dispatch must pass the provider-neutral schemas before an adapter can be called.
Scene sources, masks, fill outputs, and animation canvases reuse Banner's current raster limits:
20 MiB encoded input, 4,096 pixels per side, 16,777,216 decoded pixels, and 67,108,864 decoded RGBA
bytes. The stricter raster product limits apply even where a more general persisted asset reference
allows a larger image. Background-fill output width and height must also be no greater than the
validated source width and height. Animation-plan duration is an integer number of milliseconds
greater than zero and no greater than 30,000. Zero, negative, non-integer, unsafe, overflow, unknown-
unit, and structurally malformed values are rejected rather than coerced.

## Digest-bound dispatch content policy

Every modeled request carries a required content-policy sibling beside its request identity and
validated input. The input is validated and digested first; only then is the policy constructed,
so the policy stays outside the input digest while binding that exact digest through the complete
request identity. The binding also covers the exact source SHA-256, canonical prompt reference,
full model contract, and workflow reference. Scene-analysis, background-fill, and animation-plan
requests all apply the same contextual validation, and an adapter must repeat that validation at
its pre-dispatch boundary before it can construct a result.

The closed `banner-ai-model-dispatch-content-policy-v1` definition is frozen by literal rules and
the canonical-definition SHA-256
`14a27c163a4082a966971028e59b6d1d56ea9cde99038b823c0a18b1ea92d0c4`. All image
content—including source images, masks, and every other image input—plus OCR-derived text and
user-provided text are untrusted data and never instructions. The canonical prompt
catalog/template is the sole instruction source, and non-catalog instructions are forbidden.
Missing or unknown fields, altered declarations or definition hashes, and stale, foreign, or
substituted source/request/input/prompt/model/workflow bindings fail closed. There is no free-form
background-fill instruction channel.

## OCR and text observations

Text preservation is evaluated only from strict text observations, never from semantic layer roles
or labels. An observation contains normalized NFC text with canonical whitespace, a normalized
basis-point bounding box, basis-point confidence, and an explicit marker that the value is observed
untrusted user-image content with no instruction authority. It cannot represent inferred,
rewritten, translated, or invented copy.

Expected benchmark-oracle evidence and model-produced actual evidence use separate strict,
nominally and structurally incompatible provenance envelopes. Both bind the exact source digest,
complete AI request identity and input digest, full model contract, canonical prompt, and workflow.
Expected evidence additionally binds the benchmark case ID/version/input digest and repository
fixture. Actual evidence has fixed `model-produced-actual` and model OCR-producer roles and requires
the bound model contract to declare OCR capability. Neither envelope can be submitted at the other
boundary; missing, unknown, altered, stale, or foreign provenance fails closed. The provider-free
fake builds its explicit empty actual envelope from the validated request and never reuses the
benchmark's expected oracle.

The current Angel case intentionally carries separate explicit empty expected-oracle and
model-produced-actual observation sets. Their emptiness means only that this frozen benchmark
expects and produces no observed text; it does not prove that a general OCR system is complete.
Observations are evaluation evidence, not executable prompt content, semantic truth, or pixel-
perfect typography evidence. A separate benchmark revision is required to add or change expected
observations.

Text preservation uses a deterministic semantic multiset, not observation-array order. Each
observation is projected to canonical JSON containing its observation version, complete normalized
text object (including trust and instruction-authority literals), bounding box, and confidence;
only the producer-local observation ID and the surrounding provenance envelope are excluded. The
canonical encodings are sorted without mutating either input. Duplicate multiplicity is preserved,
so reordered equivalents compare equal while missing or extra duplicates, changed text, changed
boxes, and changed confidence compare unequal. The same projection is used for primary-versus-
replay text reproducibility after each provenance envelope has passed contextual validation. This
rule does not claim reading order, font fidelity, or rendered pixel equivalence.

Attempt, retry, and failure counts use Banner's existing three-attempt limit. A successful outcome
has one fewer failed attempt than total attempts; timeout and malformed-output outcomes have no
successful final attempt. Actual retry and failed-attempt cost usage must equal those counts. Every
cost component declares micro-USD units and uses exact bigint arithmetic; each subtotal must equal
rate times usage and every total must equal the exact component sum. Estimated and actual costs
remain distinct observations even when both are zero.

Real providers can be introduced later as adapters that implement these contracts. An adapter
must translate the canonical request, preserve request/model/prompt/workflow identity in its
metadata, and return data that passes contextual validation before evaluation or workflow use.
Provider SDK types and unrestricted provider clients do not enter the Banner domain contracts.

A real-provider benchmark may be proposed only after this provider-free milestone is independently
accepted and its format, lint, Banner typecheck, focused benchmark tests, full unit suite, and
forbidden-import scan all pass from the same final tree. That proposal is the next decision point,
not authorization to call a provider: it must be a separate bounded milestone that selects a
candidate adapter and pinned model version, fixes quality thresholds and approved benchmark-only
pricing/retry policy, defines secret and network isolation, and receives explicit approval before
any SDK is added or any paid/network call is made.

No real provider integration, network request, external service, API key, or paid call occurred in
this milestone. The benchmark adapter is provider-free and uses no clock, randomness, database,
or network access.
