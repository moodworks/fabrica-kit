# Banner AI Qwen3-VL production adapter and benchmark readiness

Status: implemented, server-only, inactive by default, and not live-benchmark authorized.

Qwen3-VL Flash is the first cost candidate because the pinned EU snapshot combines visual input,
OCR, JSON mode, and non-thinking operation with low documented list rates. The exact candidate is
`qwen3-vl-flash-2026-01-22`. It is scheduled for deprecation on 2026-10-10, so a later benchmark
must recheck availability and pricing rather than silently moving to another model.

## Official evidence

The following official documentation was retrieved on 2026-07-15:

- [Frankfurt workspace base URL](https://www.alibabacloud.com/help/en/model-studio/base-url)
- [OpenAI-compatible Chat request, response, Base64 image, tool, search, thinking, seed, and usage fields](https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions)
- [Visual input limits and Qwen3-VL positioning](https://www.alibabacloud.com/help/en/model-studio/vision)
- [JSON mode and supported Qwen3-VL Flash family](https://www.alibabacloud.com/help/en/model-studio/qwen-structured-output)
- [Automatic context-cache behavior, usage accounting, and hit pricing](https://www.alibabacloud.com/help/en/model-studio/context-cache)
- [EU model pricing](https://www.alibabacloud.com/help/en/model-studio/model-pricing)
- [Snapshot availability](https://www.alibabacloud.com/help/en/model-studio/newly-released-models)
- [Model deprecation schedule](https://www.alibabacloud.com/help/en/model-studio/model-depreciation)

The only endpoint is derived server-side from a validated server workspace ID:

```text
POST https://{validatedServerWorkspaceId}.eu-central-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions
```

No caller can provide an endpoint. The only secret reference is `DASHSCOPE_API_KEY`; there is no
key value, example value, `.env` file, browser environment variable, route, or UI control in the
repository.

### Pricing pin

The pricing tier is selected by total input tokens for one request. That tier's rates apply to all
input and output tokens in the request.

Here `K` is decimal (`1K = 1,000` tokens), matching the official pricing table rather than binary
token boundaries.

| Input-token tier   | Standard input USD / million | Cached-hit input USD / million | Output USD / million |
| ------------------ | ---------------------------: | -----------------------------: | -------------------: |
| 0 to 32,000        |                        $0.05 |                          $0.01 |                $0.40 |
| 32,001 to 128,000  |                       $0.075 |                         $0.015 |                $0.60 |
| 128,001 to 256,000 |                        $0.12 |                         $0.024 |                $0.96 |

Alibaba's documented Chat response reports tokens, not a monetary charge. Its implicit context
cache is automatic for supported Qwen visual models and cannot be disabled. Hit tokens are
reported in `prompt_tokens_details.cached_tokens` and cost 20% of the selected tier's standard
input rate. Fabrica therefore retains exact provider usage, prices uncached prompt tokens at 100%,
cached prompt tokens at 20%, and output tokens at the selected output rate with integer micro-USD
arithmetic. The combined rational is rounded up once to a whole micro-USD. Cached tokens may not
exceed prompt tokens. This request sends no explicit `cache_control`, so nonzero explicit-cache
creation counts are rejected as foreign rather than guessed into the bill.

Evidence is fail-closed after 2026-08-15T00:00:00Z or the model deprecation boundary, whichever is
earlier. A later live benchmark must refresh and independently review the dated evidence.

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

Qwen3-VL's semantic boxes will later be converted from the validated normalized coordinate space
to source pixels and supplied as prompts to SAM 2.1. The future bounded pipeline is:

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
