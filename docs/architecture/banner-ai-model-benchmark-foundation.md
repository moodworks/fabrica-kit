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
`animation-plan-v1`), provider-neutral request/result identities, a single logical reference to
the existing normalized Angel PNG fixture, exact USD-micros cost arithmetic, a deterministic fake
adapter, and a pure evaluation runner. The benchmark input digest covers only the validated model
request projection: fixture, source, model, prompt, options, and workflow. Expected rubrics,
review status, and returned output are deliberately outside that request digest.

Real providers can be introduced later as adapters that implement these contracts. An adapter
must translate the canonical request, preserve request/model/prompt/workflow identity in its
metadata, and return data that passes contextual validation before evaluation or workflow use.
Provider SDK types and unrestricted provider clients do not enter the Banner domain contracts.

No real provider integration, network request, external service, API key, or paid call occurred in
this milestone. The benchmark adapter is provider-free and uses no clock, randomness, database,
or network access.
