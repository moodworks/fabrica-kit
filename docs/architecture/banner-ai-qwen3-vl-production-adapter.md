# Banner AI Qwen production adapter and benchmark readiness

Status: implemented, server-only, inactive by default, and not live-benchmark authorized.

Qwen3.6 Flash is the first cost candidate because the pinned Global-scope Frankfurt snapshot
combines visual input, OCR, JSON mode, and non-thinking operation with low documented list rates.
The exact candidate is `qwen3.6-flash-2026-04-16`; the documented `qwen3.6-flash` alias is currently
equivalent to that snapshot but is not accepted by Fabrica's identity boundary. The snapshot is
available to the configured Germany/Frankfurt workspace and is not listed in Alibaba's current
deprecation schedule. Alibaba's snapshot policy promises notice at least 30 days before sunset.

## Official evidence

The following official documentation was retrieved on 2026-07-15:

- [Frankfurt workspace base URL](https://www.alibabacloud.com/help/en/model-studio/base-url)
- [OpenAI-compatible Chat request, response, Base64 image, tool, search, thinking, seed, and usage fields](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions)
- [Qwen3.6 Flash visual model catalog, availability, modalities, context, and structured-output support](https://www.alibabacloud.com/help/en/model-studio/vision-model)
- [JSON-object mode and supported Qwen3.6 Flash family](https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output)
- [Automatic context-cache behavior, usage accounting, and hit pricing](https://www.alibabacloud.com/help/en/model-studio/context-cache)
- [Global-scope Frankfurt model pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing)
- [Snapshot availability](https://www.alibabacloud.com/help/en/model-studio/newly-released-models)
- [Model deprecation schedule](https://www.alibabacloud.com/help/en/model-studio/model-depreciation)

The only endpoint is derived server-side from a validated server workspace ID:

```text
workspace ws-vy71dtw49uzef5hz
POST https://ws-vy71dtw49uzef5hz.eu-central-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions
```

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
| 0 < input ≤ 256,000         |                       $0.165 |                         $0.033 |                $0.99 |
| 256,000 < input ≤ 1,000,000 |                        $0.66 |                         $0.132 |               $3.961 |

Alibaba's documented Chat response reports tokens, not a monetary charge. Its implicit context
cache is automatic for documented Qwen3.6 Flash requests in Frankfurt. Hit tokens are
reported in `prompt_tokens_details.cached_tokens` and cost 20% of the selected tier's standard
input rate. Fabrica therefore retains exact provider usage, prices uncached prompt tokens at 100%,
cached prompt tokens at 20%, and output tokens at the selected output rate with integer micro-USD
arithmetic. The combined rational is rounded up once to a whole micro-USD. Cached tokens may not
exceed prompt tokens. This request sends no explicit `cache_control`, so nonzero explicit-cache
creation counts are rejected as foreign rather than guessed into the bill. The standalone official
price calculator covers both published tiers through 1,000,000 input tokens. The fixed benchmark
response envelope retains its narrower 256,000 prompt-token safety ceiling, so the established
pre-dispatch reservation and 500,000 micro-USD benchmark cap remain unchanged.

Evidence is fail-closed after 2026-08-15T00:00:00Z. The new snapshot has no announced sunset in the
current schedule; a later live benchmark must nevertheless refresh and independently review the
dated availability, lifecycle, API, and pricing evidence.

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
word `JSON`, as Alibaba JSON mode requires, and the exact Fabrica JSON Schema projection. Alibaba
does not enforce that schema, so Fabrica still applies its strict provider-neutral runtime schema.

The response boundary requires one `stop`-completed assistant choice, the exact requested model
identity, consistent mandatory usage, valid JSON, no unknown fields, and the exact
scene-analysis/OCR schema. Documented nullable response fields remain strict. Usage preserves
documented prompt detail counts for audio, cache hits, text, image, and video, plus the strict
`cache_creation` object (`ephemeral_5m_input_tokens`, `cache_creation_input_tokens`, and
`cache_type: "ephemeral"`) and completion detail counts for audio, reasoning, and text. The
documented audio and reasoning nulls are preserved; cache, text, image, and video counts must be
integers when present. Undocumented detail fields are rejected.
The adapter then validates source identity, layer limits, OCR completion, composition,
model-produced OCR provenance, and human-review-only disposition against the trusted request. Raw
response bodies, image data, prompt text, secrets, authorization headers, and execution
authorization do not enter reports or logs.

Provider dispatch sits behind an injectable server-only transport. The native `fetch` transport is
the sole network implementation and is never imported by the package root or anywhere under
`apps/web/src`. An opaque, fresh, server-minted execution capability must match mode,
workspace-derived endpoint, model, request shape, pricing, corpus, human oracle, benchmark caps,
content-policy definition, workflow definition, and the ordered aggregate of all four full
canonical model-input digests. A fixed request catalog requires the exact request ID, repository
fixture path, export name, fixture identity, and full input for each position. A fixture is claimed
before dispatch, so neither an identical nor alternate request can send it twice. Cancellation and
timeout abort the transport signal; both are terminal and retries are zero.

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

The deterministic report is written to
`.local-data/banner-ai/qwen3-vl-four-fixture-benchmark.json`. It records fixture identity, latency,
exact token usage, calculated list cost, quality outcome, and classified failure reason. A failed
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

The response artifact is a self-digesting sanitized structural projection that retains only
allowlisted fields and safe leaves needed to reproduce the strict boundary result. Wrong-typed
objects, arrays, and strings become type-preserving placeholders. Valid assistant JSON is projected
through the closed scene shape; malformed assistant JSON becomes a fixed malformed sentinel.
Every provider array is deterministically bounded at its validator maximum plus one, while unknown
fields and validation issues use finite caps and truthful retained/generated overflow counts. Valid
part keys are replaced by consistent valid pseudonyms and invalid keys by consistent invalid
pseudonyms, preserving equality, uniqueness, and format behavior. Labels and normalized OCR text
become safe validator-class pseudonyms or invalid sentinels. Only the exact committed
`banner-person-v1` source SHA may survive: a valid foreign SHA becomes a fixed valid unequal digest,
and an invalid SHA becomes an invalid sentinel. Provider strings, malformed or wrong-typed strings,
unknown values, image or Base64 material, prompt fragments, URLs, raw-key-like strings, bearer or
authorization material, secret names, and execution-authorization fragments are discarded,
structurally pseudonymized, or replaced by closed sentinels. Arbitrary leaves and field names are
never retained, so safety does not depend on a blacklist.

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

Replay reads and validates through one no-follow handle with before/after file-identity checks. It
reports zero provider calls, `networkUsed: false`, whether the exact rejection reason, stage, issue
counts, and digest were reproduced, and explicit false provider-success and production-admission
authority. A parser-valid replay is only `replay-valid`; it is not evidence that Alibaba accepted a
request or that the output passed the committed human oracle. Prompt tuning, schema tuning, and any
second live call remain separate future work.

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
