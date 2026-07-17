# Banner AI Qwen production adapter and benchmark readiness

Status: implemented, server-only, inactive by default, and not live-benchmark authorized.

Qwen3.6 Flash is the first cost candidate because the pinned Singapore International snapshot
combines visual input, OCR, JSON mode, and non-thinking operation with documented list rates.
The exact candidate is `qwen3.6-flash-2026-04-16`; the documented `qwen3.6-flash` alias is currently
equivalent to that snapshot but is not accepted by Fabrica's identity boundary. The snapshot is
available to the configured Singapore workspace and is not listed in Alibaba's current
deprecation schedule. Alibaba's snapshot policy promises notice at least 30 days before sunset.

## Official evidence

The following official documentation was retrieved at `2026-07-16T18:29:37Z` and expires fail-closed
at `2026-08-16T00:00:00.000Z`:

- [Workspace-dedicated base URL](https://www.alibabacloud.com/help/en/model-studio/base-url)
- [Regions](https://www.alibabacloud.com/help/en/model-studio/regions/)
- [API keys](https://www.alibabacloud.com/help/en/model-studio/get-api-key)
- [OpenAI-compatible Chat request, response, Base64 image, tool, search, thinking, seed, and usage fields](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions)
- [Qwen3.6 Flash visual model catalog, availability, modalities, context, and structured-output support](https://www.alibabacloud.com/help/en/model-studio/vision-model)
- [JSON-object mode and supported Qwen3.6 Flash family](https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output)
- [Automatic context-cache behavior, usage accounting, and hit pricing](https://www.alibabacloud.com/help/en/model-studio/context-cache)
- [Singapore International model pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing)
- [New-user free quota](https://www.alibabacloud.com/help/en/model-studio/new-free-quota)
- [Snapshot availability](https://www.alibabacloud.com/help/en/model-studio/newly-released-models)
- [Model deprecation schedule](https://www.alibabacloud.com/help/en/model-studio/model-depreciation)

The active endpoint is derived server-side from the pinned Singapore workspace ID:

```text
workspace ws-4ei01ync8iyumgp4
POST https://ws-4ei01ync8iyumgp4.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions
```

Frankfurt workspace `ws-vy71dtw49uzef5hz` and its endpoint remain versioned historical evidence;
they are parseable but rejected by minting, preflight, native transport, and fake transport.

The endpoint is still computed from the validated server workspace ID, and both values must equal
those exact pins. A foreign workspace is rejected even when paired with its correctly derived
Frankfurt endpoint. No caller can select an endpoint. The only secret reference is
`DASHSCOPE_API_KEY`; there is no key value, example value, `.env` file, browser environment
variable, route, or UI control in the repository.

### Pricing pin

The pricing tier is selected by total input tokens for one request. That tier's rates apply to all
input and output tokens in the request.

Here `K` is decimal (`1K = 1,000` tokens), matching the official pricing table rather than binary
token boundaries.

| Input-token tier            | Standard input USD / million | Cached-hit input USD / million | Output USD / million |
| --------------------------- | ---------------------------: | -----------------------------: | -------------------: |
| 0 < input ≤ 256,000         |                       $0.250 |                         $0.050 |                $1.50 |
| 256,000 < input ≤ 1,000,000 |                        $1.00 |                         $0.200 |                $4.00 |

Alibaba's documented Chat response reports tokens, not a monetary charge. Its implicit context
cache is automatic for documented Qwen3.6 Flash requests in Singapore. Hit tokens are
reported in `prompt_tokens_details.cached_tokens` and cost 20% of the selected tier's standard
input rate. Fabrica therefore retains exact provider usage, prices uncached prompt tokens at 100%,
cached prompt tokens at 20%, and output tokens at the selected output rate with integer micro-USD
arithmetic. The combined rational is rounded up once to a whole micro-USD. Cached tokens may not
exceed prompt tokens. This request sends no explicit `cache_control`, so nonzero explicit-cache
creation counts are rejected as foreign rather than guessed into the bill. The standalone official
price calculator covers both published tiers through 1,000,000 input tokens. The fixed benchmark
response envelope retains its narrower 256,000 prompt-token safety ceiling. The active diagnostic
cap is one call, zero retries, 120,000ms per call, 150,000ms total, and 100,000 micro-USD; the
exact uncached worst case at 256,000 + 4,096 tokens is `64,000 + 6,144 = 70,144` micro-USD.
The four-fixture cap remains 500,000 micro-USD (`4 × 70,144 = 280,576`). The 1,000,000-token
new-user quota is valid for 90 days after activation, Singapore International real-time inference,
and shared at Alibaba-account/RAM level; list-cost accounting remains independent of quota use.

The exact snapshot has no announced sunset in the current schedule, while the moving
`qwen3.6-flash` alias is scheduled for 2026-10-10; aliases remain rejected. Snapshot sunset notice
is at least 30 days. The new evidence is fail-closed after 2026-08-16T00:00:00Z; a later live
benchmark must nevertheless refresh and independently review the dated availability, lifecycle,
API, and pricing evidence.

## Request and response boundary

The adapter accepts only bytes from the fixed package normalized-PNG registry. It verifies the PNG
container, dimensions, byte count, SHA-256, fixture identity, entire scene-analysis input digest,
canonical prompt, content-policy definition, workflow, and Qwen model contract before request
construction.

The provider body is private. It contains one local PNG as a Base64 `data:image/png` URL, never a
remote image URL; the unchanged canonical `scene-analysis-v1` prompt inside a hash-bound provider
protocol wrapper; `response_format: {type: "json_object"}`; `enable_thinking: false`;
`enable_search: false`; `enable_code_interpreter: false`; empty tools with
`tool_choice: "none"`; `parallel_tool_calls: false`; one non-streaming choice; temperature zero;
seed zero; no explicit `cache_control`; and a 4096-token output ceiling. The wrapper includes the
word `JSON`, as Alibaba JSON mode requires, and the exact Qwen semantic JSON Schema. Alibaba does
not enforce that schema, so Fabrica applies its strict semantic runtime schema and then the trusted
canonical materializer.

The response boundary requires one `stop`-completed assistant choice, the exact requested model
identity, consistent mandatory usage, valid JSON, no unknown fields, and the exact
Qwen semantic scene-analysis/OCR schema. Documented nullable response fields remain strict. Usage preserves
documented prompt detail counts for audio, cache hits, text, image, and video, plus the strict
`cache_creation` object (`ephemeral_5m_input_tokens`, `cache_creation_input_tokens`, and
`cache_type: "ephemeral"`) and completion detail counts for audio, reasoning, and text. The
documented audio and reasoning nulls are preserved; cache, text, image, and video counts must be
integers when present. Provider response usage is bounded to 256,000 prompt tokens and 260,096 total
tokens (256,000 plus the 4,096 output ceiling); 256,001 is rejected before accounting. The
provider-free pricing calculator alone accepts the separately evidenced second tier through
1,000,000 input tokens. Undocumented detail fields are rejected.
The adapter then validates source identity, layer limits, OCR completion, composition,
model-produced OCR provenance, and human-review-only disposition against the trusted request. Raw
response bodies, image data, prompt text, secrets, authorization headers, and execution
authorization do not enter reports or logs.

Assistant-message metadata is a closed envelope-only boundary: `role` must be `assistant` and
`content` must be nonempty scene JSON; only `role`, `content`, `reasoning_content`, `refusal`,
`tool_calls`, `function_call`, and `audio` are recognized message keys. `reasoning_content` may be
absent, `null`, or the empty string; `refusal`, `function_call`, and `audio` may be absent or
`null`; `tool_calls` may be absent, `null`, or empty. Populated metadata and every other message
key are rejected, and no metadata is merged into scene JSON or granted instruction authority.

### Provider-free scene-output contract revision 3

The unchanged `SCENE_ANALYSIS_PROMPT_V1` remains pinned to
`5cc311b7b353e06c61bcdf840b40dff9d35de0aea12851ffa18a654177917227`. The provider-neutral
`ProposedSceneAnalysisOcrOutputV1Schema` is also frozen byte-for-byte at SHA-256
`2bdfd91875bc097b6bac93eadad924cdfb89b9fe9dc4f8293f494c721179dc9d`. It is the only scene
shape accepted by quality evaluation, but it is no longer the shape Alibaba is asked to author.

The active Qwen semantic schema V1 has exactly five root fields, in this order:
`composition`, `layerEvidence`, `ocrCompletion`, `textObservations`, and `reviewFlags`. Every
object is strict. Alibaba may provide only visual semantics. Request identity, source identity,
versions, units, normalization, trust, instruction authority, provenance, policy, authorization,
and decision authority are rejected if they appear anywhere in provider JSON.

Every canonical field belongs to exactly one of the five authority categories below. Category 1 is
the entire provider-authored surface. Categories 2–5 are server-owned and are rejected if Alibaba
emits them.

| Authority category                       | Canonical scene fields                                                                                                                                                                                                                                                                                                                                                                           | Trusted output outside the canonical scene                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1. Model-observed semantic data          | `composition.kind`; proposal `composition.parts[*].{partKey,label,role,bounds.{xBps,yBps,widthBps,heightBps}}` or no-useful `composition.reason`; `layerEvidence[*].{partKey,observationBasis,confidence.valueBps,reviewFlags[*]}`; `ocrCompletion.kind`; `textObservations[*].{observationId,text.value,boundingBox.{xBps,yBps,widthBps,heightBps},confidence.valueBps}`; root `reviewFlags[*]` | The same validated text-observation values appear in the provenance-bound observation set, but the model receives no authority beyond these semantic claims.                                                                                                                                                                                                                                                                                                                         |
| 2. Server-owned request identity         | None                                                                                                                                                                                                                                                                                                                                                                                             | Trusted provenance `requestIdentity` including its input digest, plus the exact `model` and `prompt` request references.                                                                                                                                                                                                                                                                                                                                                             |
| 3. Server-owned source identity          | `composition.sourceAssetSha256`                                                                                                                                                                                                                                                                                                                                                                  | Trusted provenance `sourceAssetSha256`, copied only from the validated request. Exact normalized dimensions, byte count, media/container identity, and fixture identity remain trusted server request context and never become provider fields.                                                                                                                                                                                                                                      |
| 4. Server-owned policy/workflow metadata | `visibleContentConstraint`; `textObservations[*].text.{contentTrust,instructionAuthority}`; `humanReview.{required,proposalOnly,automaticCutoutExportOrOtherDecisionAuthority}`                                                                                                                                                                                                                  | The exact trusted `workflow` request reference; validated request options `maxParts`, `includeBackground`, and `preserveVisibleText`; the content-policy definition; trusted provenance `provenanceVersion`, `evidenceRole`, and `producer.kind`; the exact server-returned `observationBasisAuthority`, `observationIdAuthority`, and server `decisionAuthority` constants; workflow and authorization policy; and explicit false production, web, export, and admission authority. |
| 5. Deterministically derived server data | `outputVersion`; `composition.proposalVersion`; every layer-evidence confidence `unit`; `ocrCompletion.observationCount`; `textObservations[*].observationVersion`; `textObservations[*].text.{kind,normalization}`; every text bounding-box `unit`; every text confidence `unit`                                                                                                                | Response-boundary version/digest, materializer version/digest, and observation-set version.                                                                                                                                                                                                                                                                                                                                                                                          |

The successful composition branch requires 3–5 unique parts and exactly one ordered evidence entry
per part. Observation IDs are unique, nonnumeric, closed-format local references. OCR kind and list
emptiness must agree. The closed no-useful-layers branch is representable for an explicit semantic
rejection, but the active materializer rejects it before quality because this benchmark requires a
successful composition proposal.

Trusted materializer V1 requires the exact canonical request and adds only deterministic,
request-bound fields: output and proposal versions, the visible-content constraint, the committed
source digest, every unit, OCR observation count, text kind/normalization/trust/instruction
authority, and the human-review-only disposition. It then parses the assembled object through the
unchanged canonical schema, performs request-relative composition and OCR checks, and constructs
trusted model-produced OCR provenance. Provider evidence remains an untrusted semantic claim and
provider observation IDs remain untrusted validated local references. Only this materialized
canonical object reaches quality scoring.

Wrapper V3 embeds the exact semantic JSON Schema and adds explicit prohibitions for all server-owned
identity, trust, authority, policy, prompt, model, authorization, digest, summary, explanation,
warning, and unknown fields. It requires JSON only, the exact five ordered root keys, 3–5 parts,
one-to-one ordered evidence, OCR consistency, and a pre-emission self-check. Deterministic fake
transport and dry run now emit this same semantic shape; they do not bypass the materializer by
fabricating a canonical provider response.

The active and frozen revision boundaries are:

| Contract                  | Frozen historical revisions                                                                                                                                                                                                   | Active revision and binding                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Provider wrapper          | V1 `339186794127e07e8be27959c07400e04e4b14f528d56da259613ce8942d2ab5`; V2 `87497d39a04ca12210500179b8e6705f03788d06a20bec8bf7cd6de29f6c6025`                                                                                  | V3 `85125a2547002fa381da4c0c9042ec21add1df1ee26bd080cb92c6c6f1ad1058`                        |
| Request shape             | V1 `06963aab79297adf81adb33f1c3c97b070ab5f30feb7ce6982d4e751afdf1fbf`; V2 `6a540409b86a7b7e7c677ddc5fb5bd3d9bab7ee35758a1da3679ade49af8fb27`; Singapore V3 `6db92da8ad630244d1e45ee63d9fb64de97f57c03ebdd5b851952436549a3252` | V4 `1f864a8efccdaaa59539bc745963c98284913979703fb1e38966b59e4d56d580`                        |
| Provider aggregate        | V2 `1f2f53250b1032e12676041439e40f06532d8a69fb68d2cd00f5e388eaac5e2c`; Singapore V3 `3f054e4b8ed25273bb71fed3416583b49619334aea67c1b9c34897fd3632e8f7`                                                                        | V4 `b1f515a9e29bce8a6acbb6a5c371f235402023428989b682a6af0b27a85666cc`                        |
| Provider semantic schema  | none                                                                                                                                                                                                                          | V1 `cbf8d753572046e03d25fc14ac6e62ace5eccf6a8ab975684bd307e08d452dcc`                        |
| Canonical scene schema    | V1, unchanged                                                                                                                                                                                                                 | V1 `2bdfd91875bc097b6bac93eadad924cdfb89b9fe9dc4f8293f494c721179dc9d`                        |
| Response boundary         | V1, frozen for V1 replay                                                                                                                                                                                                      | V2 `584f7b62cb9a34e9d05e39aed67bf339a3df2e484c278626db65b8ddcbe4054a`                        |
| Trusted materializer      | none                                                                                                                                                                                                                          | V1 `e85ff59a190163d5fcf7800b818960c49a9f1965d4ada6bb23f4b9fb65436c63`                        |
| Adapter and result        | V1                                                                                                                                                                                                                            | V2, directly bound by request V4, aggregate V4, authorization V5, and report V5              |
| Diagnostic capture/replay | V1, frozen                                                                                                                                                                                                                    | V2; semantic projector V1 `613c6d94a3b70a7ca9d494a667917ed185bb0c14fb53b6e7a87c4eea97f5a186` |
| Manual release            | V1 already used by historical V4                                                                                                                                                                                              | V1 unchanged self-digesting release                                                          |
| Live authorization        | V1–V4 parse-only or stale                                                                                                                                                                                                     | V5 only                                                                                      |
| Benchmark report          | V1–V4 strict historical parsers                                                                                                                                                                                               | V5 only                                                                                      |

The four provider-neutral canonical model-input digests and their neutral V1 aggregate
`4dc9f1265bf0494784026836f42506f0b8f42e045862376318e905b437629041` are unchanged.
Active Singapore provider aggregate V4 binds the complete ordered inputs plus wrapper V3, request
V4, adapter/result V2, semantic schema V1, canonical schema V1, response boundary V2, materializer
V1, diagnostic semantic projector V1, and the direct availability and lifecycle evidence. Active
provider evidence remains independently versioned:

- provider identity V2:
  `46edd18a06371a25617a4dd8dd54e1c3d51c1d3616beb2a7ed5965ad8f1d961e`;
- availability V2:
  `35036d470efee041b5f3daa5a9c17f4c84b739a69cb594c6c0f89ed13e3e7b87`;
- lifecycle V2:
  `ddc258e30902c60855d942405cfed6d8c2ce4fe7975de31f46cfad4bc55f5647`;
- Singapore pricing V2:
  `09badc6f060ba9f30943c2f54f480f58ef9a884da50767cf6ba8072ab0fba56c`;
- diagnostic cap V3:
  `fa713b888cdf5ca03e4e4f34654aa910978fde5d163758cc84b25a74cc4772f1`.

Authorization V5 and report V5 bind every active revision and digest above, including explicit
semantic/canonical schema version numbers, direct availability/lifecycle digests, aggregate version
4 and its digest, adapter/result V2, diagnostic capture V2, diagnostic semantic projector version 1
and its digest, the exact Git SHA, and the fresh self-digesting manual release. The nested V5
diagnostic-capture binding repeats the projector version/digest. V4 remains strict historical
Singapore evidence but is stale and cannot mint or dispatch. No authorization or report grants
provider success, production admission, web activation, or oracle modification.
Deterministic-fake V5 reports contain no diagnostic fields and require `providerNetworkUsed:
false`; live V5 reports require the one-fixture diagnostic shape, one call maximum, zero retries,
overall non-admission, and diagnostic cap V3.

Freshness is checked at preflight and at the final dispatch boundary. The synchronous native Git
guard first rechecks a clean working tree and the exact authorized Git SHA. The adapter then takes
a fresh epoch reading and, before capability minting or transport dispatch, revalidates official
evidence, authorization and manual-release age/expiry, and the positive remaining request deadline
used to recompute the capped timeout. Timers are constructed only after these checks.
Authorization and release issue times cannot be in the future; equality at evidence expiry,
authorization/release expiry, either 60,000ms issuance-age boundary, or the request deadline fails
closed with zero dispatch. A packet, evidence set, deadline, or tree that changes after preflight
sends no provider request.

Historical V1 boundary, diagnostic schema, capture, and explicit replay remain a closed replay
island. They retain diagnostic version 1 and its original stage vocabulary and are never
reinterpreted through the semantic boundary. Active capture/replay V2 uses diagnostic version 2,
semantic-schema and materialization stages, and the exhaustive semantic projector above. That exact
projector is defined once in cycle-free evaluation evidence; request V4, provider aggregate V4,
outer and nested authorization V5, report V5, capture artifact V2, and replay result V2 all bind its
version and digest. Generic replay performs one safe file read, discriminates the artifact version,
and delegates to the matching frozen path; explicit V1 replay rejects V2 artifacts. Preserved
ignored artifacts are read-only evidence and are never rewritten.

The accepted diagnostic response therefore remains historical non-admission evidence: its
envelope/model/usage/assistant metadata/JSON syntax passed, while V1 scene validation failed for
five invalid `observationId` values, six composition parts, and six `layerEvidence` entries. It did
not become a provider or quality success, and this revision does not reinterpret or rewrite it.

Provider dispatch sits behind an injectable server-only transport. The native `fetch` transport is
the sole network implementation. A transitive static/dynamic import and re-export graph test proves
that the package root and `apps/web/src` cannot reach the native transport, adapter, active
response boundary/materializer, diagnostics, or benchmark modules. Immediately before dispatch,
the adapter mints a module-private, single-use
capability in a `WeakMap`/`WeakSet`. It is bound to the opaque validated authorization, transport
kind and mode, exact endpoint/method/body, timeout, abort signal, and boolean secret-presence policy;
native and deterministic transports synchronously consume it, so copied, forged, mismatched, or
reused request objects cannot dispatch. The authorization state also binds the workspace-derived
endpoint, model, request shape, pricing, corpus, human oracle, benchmark caps, content-policy
definition, workflow definition, and ordered aggregate of all four full canonical model-input
digests. A fixed request catalog requires the exact request ID, repository fixture path, export
name, fixture identity, and full input for each position. A fixture is claimed before dispatch, so
neither an identical nor alternate request can send it twice. Cancellation and timeout abort the
transport signal; both are terminal and retries are zero.

## Four-fixture runner

The runner verifies the exact four normalized package fixtures and approved human-oracle digests,
then handles them sequentially. It builds a request only after that fixture's bytes pass digest and
container checks. It makes at most one call per fixture and stops on cap, identity, schema,
timeout, cancellation, HTTP, transport, or provider failure. Layer roles and approximate boxes are
scored at IoU 0.50; OCR text and boxes use the existing approved-oracle scorer and its IoU 0.70
rule. Quality failure is recorded but never admits the provider.

Frozen caps:

- 4 fixtures, at most 4 successful runs, and at most 4 provider calls;
- zero retries;
- 60 seconds per call, 120 seconds per fixture, and 600 seconds total;
- 500,000 micro-USD maximum calculated benchmark list cost.

Immediately before each dispatch the runner recomputes the positive time remaining under all three
time caps and gives the adapter only their minimum. If any remaining budget is exhausted, it
records a non-dispatched classified failure and sends nothing.

The strict historical Frankfurt V1 report path
`.local-data/banner-ai/qwen3-vl-four-fixture-benchmark.json` is preservation-only and is never used
for active Singapore execution. The provider-free Singapore V5 dry run writes only
`.local-data/banner-ai/qwen3-vl-four-fixture-benchmark-singapore-v5.json`; an active live fallback
uses the same versioned path unless its caller-supplied diagnostic binding provides a unique report
path. It records fixture identity, latency, exact token usage, calculated list cost, quality outcome,
and classified failure reason. A failed
attempt with a validated success envelope retains its latency, usage, and exact calculated cost in
fixture and aggregate totals. A dispatched attempt whose usage cannot be validated is explicitly
`indeterminate`; the report states the number of indeterminate attempts and the exact total of only
the known attempt costs, so zero is never presented as a complete cost for an unpriced call. The
strict report schema rejects unknown fields and omits raw OCR observations. It grants no production
admission and changes neither the oracle nor a web surface.

### Accepted first live-call result and response diagnostics

The separately authorized first live execution stopped after the `banner-person-v1` call because
the provider response failed the strict response boundary. The preserved evidence does not identify
which internal schema stage rejected it. The run made one provider call with zero retries,
recorded 1,703 input tokens and 2,184 output tokens (3,887 total), calculated 2,444 micro-USD of
list cost, and produced no quality score. Its exit status was 1 and its classified result was
`schema-invalid`. The accepted authorization and benchmark report remain preserved as the two
original mode-0600 local artifacts; this diagnostics work does not rewrite either artifact and does
not reinterpret that response as a provider or quality success.

The later accepted Singapore historical diagnostic is preserved separately and does not replace
that first-call record. Alibaba returned five composition parts, five ordered layer-evidence
entries, five text observations, and OCR completion count five. The provider latency was 16,698ms;
usage was 1,964 input plus 2,050 completion tokens, and exact Singapore list cost was 3,566
micro-USD. Frozen boundary V1 still rejected four conditions represented by three issue records:
two unnamed unknown root fields, one invalid source-digest format, and one visible-content literal
mismatch. The deterministic issue digest is
`a2aac3f2192e550629a48799e29976fc03e30d614bad6090c2bd2fe41cebf6af`; the raw response-artifact
digest is `70cb3250339e25c6ba19a842bf82ec56135361f9b9620aeef9d38ae7683b4590`; and the report digest is
`217aa43cea0afebc82230d66558f73b1c469d6274a85a0928672a51ede28b35a`. Explicit frozen V1 replay
reproduced the rejection provider-free. The result remains `schema-invalid`, has no quality score,
and grants no provider-success, production, web, or admission authority. Both ignored mode-0600
artifacts remain byte-preserved historical evidence.

Response validation now emits a closed, versioned diagnostic with a validation stage, JSON-pointer
paths, closed issue classifications, expected and received value types when known, sorted unknown
field-name pseudonyms, actual/retained/truncated counts, and a canonical SHA-256 issue digest. Every
unknown name, including otherwise benign-looking header or key names, becomes an idempotent one-way
pseudonym; arbitrary unknown names are never retained. Root is the empty RFC 6901 pointer, and
ordering uses locale-independent code-unit comparison. It never includes rejected values,
validator messages, raw response bodies, image bytes, prompts, authorization headers, or secret
values. The adapter and offline replay use the same response-boundary implementation, so a captured
rejection cannot be diagnosed by a more permissive parser.

Failure accounting keeps the accepted response order. Only a strictly valid provider-error envelope
is `provider-error` with indeterminate usage. A malformed `error` on a non-2xx response remains
`http-error`; on a 2xx response, missing or invalid usage is classified first, while valid usage
makes the malformed envelope `schema-invalid` with complete usage and exact calculated cost. The
diagnostic stage may still identify `provider-error-envelope` without changing those reasons.

Diagnostic capture is disabled by default. A future, separately reviewed live authorization may opt
into only `single-fixture-response-capture`, bound to `banner-person-v1`, one call maximum, zero
retries, production admission false, and two distinct new local response/report paths. Both files
are atomically reserved before native transport import or dispatch with exclusive, no-follow,
mode-0600 handles. Canonical containment, non-symlink components, regular-file identity, mode,
device, and inode are rechecked through final sync and close; the canonical root, `.local-data`, and
`banner-ai` parent paths and directory device/inode identities are stored at reservation and the
whole chain is re-lstatted and re-realpathed before and after reservation verification and each
same-handle response/report finalization. Response and report writers retain those handles and never
reopen the paths. A collision, escape, symlink, parent rename/replacement, containment drift, file
swap, mode drift, or unsafe parent therefore fails closed.

Diagnostic caps are separately versioned from the unchanged four-fixture benchmark caps. Historical
diagnostic V1 is parseable evidence only (60,000 ms call / 120,000 ms total), digest
`6f0df176ddae07d69e244d5ff9cb696f92f4a53d0a8f8150909dbd8c11451fa0`; historical diagnostic V2
requires its own canonical cap digest
`4099960771c16079383d6f520633265c3113a5fd4b121154afeda5935314b81c` and exact 120,000 ms call / 150,000 ms total limits, one call,
zero retries, and a 50,000 micro-USD ceiling. Active Singapore diagnostic V3 uses authorization
V5 and report V5 with a 100,000 micro-USD ceiling; old V2/V3/V4 diagnostic authority cannot
dispatch.
Diagnostic deadlines use strict equality as timeout, abort the request, and leave missing usage
indeterminate. The historical Frankfurt proof remains `ceil(42240 + 4055.04) = 46296` micro-USD;
the active Singapore proof is `ceil(64000 + 6144) = 70144` micro-USD. The concise
non-authorizing timeout evidence is recorded below.

### c0004 historical evidence

- Git SHA `464ae5ac6efcf9aba02f298fc2c50179df7b87a0`
- `banner-person-v1`
- calls `1`
- retries `0`
- terminal timeout
- no response artifact
- indeterminate accounting
- report digest `43f4910cecaec179447ae851d7eb03638d84616307986a6cbfc4455dea7ba4b5`
- production `false`

The active V2 response artifact is a self-digesting sanitized structural projection that retains
only allowlisted fields and safe leaves needed to reproduce the strict semantic-boundary result.
Wrong-typed objects, arrays, and strings become type-preserving placeholders. Valid assistant JSON
is projected through the closed five-root semantic shape; malformed assistant JSON becomes a fixed
malformed sentinel.
Every provider array is deterministically bounded at its validator maximum plus one, while unknown
fields and validation issues use finite caps and truthful retained/generated overflow counts. Valid
part keys are replaced by consistent valid pseudonyms and invalid keys by consistent invalid
pseudonyms, preserving equality, uniqueness, and format behavior. Labels and normalized OCR text
become safe validator-class pseudonyms or invalid sentinels. Server-owned source identity is absent
from the V2 semantic projector. Provider strings, malformed or wrong-typed strings, unknown values,
image or Base64 material, prompt fragments, URLs, raw-key-like strings, bearer or authorization
material, secret names, and execution-authorization fragments are discarded, structurally
pseudonymized, or replaced by closed sentinels. Arbitrary leaves and field names are never retained,
so safety does not depend on a blacklist.

Before the one-fixture report is completed, the captured artifact is replayed provider-free. The
report records `reproduced` only when the actual reason, stage, counts, and issue digest match, and
the replayed file SHA-256 still equals the SHA-256 captured in the artifact metadata. It records
`mismatch` otherwise; a different self-valid file cannot satisfy the report binding, and the report
never writes a speculative false value merely because replay was not run. The diagnostic report
remains non-admitting even if the replayed response is parser-valid.

An authorized diagnostic run would use the unchanged live command with a fresh one-person
diagnostic authorization; it is intentionally not executed by this milestone:

```bash
pnpm --filter @fabrica/banner-ai benchmark:qwen:live -- --authorization-file /absolute/path/to/fresh-one-person-diagnostic-authorization.json
```

The resulting sanitized response artifact can be replayed locally without a provider secret,
native transport, image transmission, or network access. An absolute path is accepted only when it
resolves to an allowed diagnostic location inside this repository (the strict mode-0600 local
diagnostic namespace or a package-owned diagnostic test fixture):

```bash
pnpm --filter @fabrica/banner-ai benchmark:qwen:replay -- --response-file /absolute/path/to/qwen-response-diagnostic-unique.json
```

Replay reads and validates through one no-follow handle with before/after file-identity checks. The
generic command discriminates frozen V1 from active V2 and never silently upgrades a V1 artifact.
It reports zero provider calls, `networkUsed: false`, whether the exact rejection reason, stage,
issue counts, and digest were reproduced, and explicit false provider-success and
production-admission authority. A parser-valid replay is only `replay-valid`; it is not evidence
that Alibaba accepted a request or that the output passed the committed human oracle. Prompt
tuning, schema tuning, and any second live call remain separate future work.

### Provider-free dry run

```bash
pnpm --filter @fabrica/banner-ai benchmark:qwen:dry-run
```

This uses only the deterministic fake transport and the four local files. It performs no network,
provider, paid, or image-transmission action.

### Separately authorized future live run

Provision `DASHSCOPE_API_KEY` out of band in the server process, place a fresh reviewed execution
authorization outside the repository, and run:

```bash
pnpm --filter @fabrica/banner-ai benchmark:qwen:live -- --authorization-file /absolute/path/to/fresh-server-owned-authorization.json
```

Before native transport import or dispatch, the command fails closed for an absent secret or
authorization, stale authorization/evidence, model or derived-endpoint mismatch, corpus or oracle
drift, pricing or request-shape drift, content-policy or workflow drift, ordered model-input digest
drift, cap drift, or dirty Git working tree. `SIGINT` sets the shared cancellation signal; an
in-flight request is aborted, the result is terminal, no retry is attempted, and no later fixture
starts. This milestone did not run that command.

## Later transports and pipeline

The adapter's provider-neutral request/output and injectable transport contract can later target a
self-hosted Qwen deployment through [vLLM's OpenAI-compatible server](https://qwen.readthedocs.io/en/stable/deployment/vllm.html)
without changing Fabrica's strict scene-analysis schema. That transport would require its own
endpoint, identity, authorization, and pricing/compute evidence.

The pinned Qwen model's semantic boxes will later be converted from the validated normalized
coordinate space to source pixels and supplied as prompts to SAM 2.1. The future bounded pipeline
is:

```text
normalized image
→ Qwen semantic layers and boxes
→ PaddleOCR text evidence
→ SAM 2.1 masks
→ transparent PNG assets
→ preview and animation
```

SAM, PaddleOCR, cutout generation, preview, animation, deployment, UI activation, and the live
benchmark remain separate future milestones.

The existing `qwen3-vl` source filenames, exported abstraction names, and local report path are
retained to keep this correction narrow. Renaming those internal abstractions is optional future
cleanup and is not required for the exact Qwen3.6 model identity.
