# AI SaaS — Project Bootstrap and Multi-Agent Brief

> Use this document as the initial project brief for Sol, Terra, Luna, or another coding-agent team. Treat it as the source of truth until the repository contains more specific architecture decisions, implementation plans, and ADRs.

## 1. Mission

Build a scalable AI-driven SaaS for freelancers that turns images, URLs, text, and design references into useful production assets.

The long-term platform contains five products:

1. Banner AI
2. Frontend AI
3. Website Audit AI
4. Content AI
5. SEO AI

The MVP must validate one product first: **Banner AI**.

The immediate goal is not to build all five products or a complete multi-tenant business platform. The immediate goal is to prove that Banner AI can transform a static banner into useful editable layers, apply controlled animation, and export a valid production asset at a commercially viable cost.

### Current program boundary

The current program is **Banner AI product validation**, hosted in the smallest application surface needed to exercise and test it.

Until the Banner AI product gate is passed, do not adopt or merge a SaaS starter kit and do not build the production SaaS shell. Specifically defer:

- Production authentication and account recovery.
- Subscription plans and payment processing.
- Stripe, PayPal, Paddle, or another billing integration.
- Customer billing portals and subscription webhooks.
- Production credit allocation and top-ups.
- Team invitations, roles, seats, and organization switching.
- Marketing-site, blog, documentation-CMS, and super-admin boilerplate.

The product-validation application may use a development identity, a hidden local workspace, fake entitlements, and fake credits when those are necessary to exercise product boundaries. These are development scaffolds, not the final SaaS implementation.

## 2. Product principles

- Build one shared platform with product-specific workflows; do not create five disconnected applications.
- Treat AI as a controlled part of a workflow, not as an unrestricted autonomous agent.
- Prefer structured, versioned inputs and outputs over unstructured conversational state.
- Preserve user control: AI proposes and produces assets, while users can inspect, select, exclude, retry, and edit.
- Record the provider, model, prompt/workflow version, runtime, estimated cost, status, and errors for every AI operation.
- Keep model and infrastructure providers replaceable.
- Run expensive or slow work asynchronously with progress, cancellation, retries, and idempotency.
- Build the smallest complete vertical slice before adding breadth.
- Keep the architecture capable of supporting teams later, without exposing team complexity in the freelancer MVP.
- Do not claim an output is production-ready unless it passes deterministic validation.

## 3. Initial customer and commercial model

### MVP customer

- One user type: **Freelancer**.
- One login controls one private account/workspace.
- The UI does not need to expose the term `workspace` yet.
- Projects, assets, generations, subscriptions, and credits belong to the workspace rather than directly to a user.

### Future compatibility

The data model should permit multiple memberships per workspace later so Studio and Agency plans can add seats, invitations, and roles without migrating ownership of existing projects.

### Initial plans

- Free
- Freelancer Monthly
- Freelancer Yearly

Do not finalize credit quantities or pricing before measuring real model/GPU costs. Credits must ultimately correspond to cost bands or defined operations.

## 4. Product definitions

### 4.1 Banner AI — MVP product

Banner AI converts a visual source into an editable animated banner and exports it in production formats.

#### Desired long-term workflow

1. User uploads a high-quality JPG, PNG, or SVG banner.
2. The system analyzes its visual composition.
3. The system proposes meaningful assets/layers.
4. Foreground assets are extracted as transparent images.
5. The background is reconstructed using content-aware fill or a user-selected solid background.
6. The user can inspect, select, exclude, combine, replace, or rename assets.
7. The system proposes animation presets based on the scene.
8. The user can apply a general prompt, prompt selected assets, or use presets.
9. The user previews and adjusts the result.
10. The system exports and validates the selected format.

Example source: an angel with wings.

Expected proposed layers:

- Background
- Angel/body
- Left wing
- Right wing

The layer representation must support later operations such as selecting the left wing and requesting a slow flutter animation.

#### MVP scope

- Input: JPG and PNG.
- One banner size per project/export.
- Analyze composition and propose up to 3–5 useful layers.
- Produce transparent PNG assets and a reconstructed or solid-color background.
- Show an editable layer list with visibility and inclusion controls.
- Offer a small set of controlled animation presets.
- Render an in-browser preview.
- Export:
  - validated Google Display Network HTML5 ZIP;
  - regular HTML/CSS/JS banner;
  - static PNG;
  - GIF if feasible without delaying the core slice.
- Record processing time, failure state, provider/model, workflow version, and estimated cost.

#### Explicitly deferred Banner AI features

- Arbitrary timeline editor.
- Fully general natural-language animation generation.
- Per-layer conversational history.
- Multi-size campaign generation.
- SVG ingestion and perfect vector preservation.
- Automatic repair for every possible creative.
- Video export.
- Real-time collaboration.

#### Core Banner AI artifact

Banner AI must create a versioned, serializable scene model rather than directly generating a one-off ZIP.

Conceptual shape:

```ts
interface BannerSceneV1 {
  schemaVersion: 1;
  canvas: {
    width: number;
    height: number;
    background: BackgroundDefinition;
  };
  sourceAssetId: string;
  layers: BannerLayerV1[];
  timeline: AnimationTrackV1[];
  exportSettings: BannerExportSettingsV1;
}
```

The exact schema must be designed and validated before implementation. Every generated export must be reproducible from a persisted scene version and referenced assets.

### 4.2 Frontend AI

Converts screenshots, public URLs, and design references into clean frontend implementations.

Long-term outputs may include:

- React/Next.js components
- HTML/CSS/JavaScript
- Gutenberg blocks packaged as a plugin

Start later with one constrained output stack and a rendered visual-comparison loop. Do not promise “production-ready” solely from a model response; validate rendering, responsiveness, semantics, accessibility, and build output.

### 4.3 Website Audit AI

Scans a public website and produces evidence-backed, prioritized findings covering:

- Performance
- Accessibility
- SEO
- Tracking
- Security posture observable from the public surface
- UX

Deterministic scanners produce evidence. AI summarizes, groups, prioritizes, and explains it. Findings must retain the originating check, affected URL, evidence, severity, and confidence.

### 4.4 Content AI

Transforms a source URL, pasted text, or design resource into channel-specific marketing content. It should reuse shared URL ingestion, document extraction, brand context, and asset storage.

### 4.5 SEO AI

Analyzes a public URL and creates:

- SEO titles and descriptions
- Open Graph and social metadata
- Schema recommendations or validated schema output
- Social sharing images/posters
- CMS-ready output

It should share URL ingestion and page analysis with Website Audit AI and Content AI.

## 5. Architecture direction

### Recommended stack

- TypeScript throughout.
- Next.js with the App Router.
- React.
- PostgreSQL.
- Drizzle ORM unless repository constraints justify another choice.
- Tailwind CSS and shadcn/ui for the application UI.
- Stripe is a likely future subscription provider, selected only at the SaaS-shell decision gate.
- S3-compatible object storage, with Cloudflare R2 or equivalent as a likely production target.
- A durable background-job system suitable for long AI/GPU tasks.
- Resend or an equivalent transactional email provider when email becomes necessary.
- Sentry-compatible error monitoring and structured application logs.

Do not lock core domain logic to Vercel, Supabase, OpenAI, RunPod, Replicate, or another single provider. Provider-specific code belongs behind adapters.

### Deferred SaaS-shell decision

Do not choose a SaaS starter kit during the current Banner AI product-validation work.

The future SaaS shell may use:

- Makerkit Pro.
- The official MIT-licensed [Next.js SaaS Starter](https://github.com/nextjs/saas-starter).
- A custom shell around the validated product platform.
- Another candidate justified by evidence available at the decision gate.

Makerkit Lite may be used for evaluation and architectural reference, but do not adopt it on the assumption that moving to Makerkit Pro will be an automatic in-place upgrade. Treat Lite-to-Pro as a potential migration until the exact versions and compatibility are proven.

The SaaS decision occurs only after Banner AI satisfies the product gate defined below and before production authentication, billing, or real beta-user ownership data is established.

At that gate, Sol and Terra must compare candidates against the actual product rather than generic feature lists. Evaluate:

- Migration impact on existing Banner AI schemas, migrations, assets, jobs, fixtures, and tests.
- Authentication and account ownership.
- Hidden single-user workspace support and future team expansion.
- Stripe subscriptions, customer portal, webhooks, credits, and entitlements.
- Object-storage and background-job compatibility.
- Security model and tenant isolation.
- Ability to keep Banner AI domain logic independent from the SaaS vendor.
- Licensing, ongoing updates, support, and total migration effort.

Record the decision in an ADR: chosen shell, rejected alternatives, exact upstream version/revision, migration plan, and rollback strategy. Never merge a starter wholesale into an established repository without this review.

### Portability requirements until the decision gate

- Banner AI domain services must not depend directly on Supabase Auth, Better Auth, Makerkit account APIs, Stripe customer objects, or framework route handlers.
- Pass a neutral actor/workspace context into product services.
- Keep storage, jobs, AI providers, metering, and exports behind internal interfaces.
- Persist versioned product schemas that can survive a change in the surrounding application shell.
- Keep production billing concepts out of Banner AI tables; record provider usage and estimated cost independently.
- A local workspace identifier may exist now to establish ownership boundaries, but its source must be replaceable.

### Suggested repository boundaries

```text
apps/
  web/                    # Next.js application

packages/
  db/                     # schema, migrations, repositories
  domain/                 # product-independent entities and rules
  ai-core/                # provider interfaces, workflow execution, metering
  storage/                # object-storage interface and adapters
  jobs/                   # queue contracts, workers, retry/idempotency rules
  billing/                # future SaaS-shell concern; do not create during product validation
  banner-ai/              # Banner AI schemas, pipeline, exporters, validators
  ui/                     # shared UI primitives

docs/
  architecture/
  decisions/
  implementation-plans/
  product/
```

This is a direction, not a command to create empty packages prematurely. Introduce boundaries when the first real vertical slice needs them.

### Current product entities

- Workspace
- Project
- Asset
- Generation job
- Generation attempt
- Generation output
- Workflow version

The current workspace is a neutral ownership boundary backed by a development identity. Do not implement production users, memberships, plans, subscriptions, entitlements, or customer credit ledgers until the SaaS-shell phase.

Future SaaS entities are expected to include User, Membership, Plan, Subscription, Entitlement, and an immutable customer credit/usage ledger, but their final shape belongs to the deferred SaaS decision.

### Ownership rule

Business assets belong to a workspace:

```text
workspace
  ├── projects
  ├── assets
  ├── generation jobs
  └── provider usage/cost records
```

Avoid attaching reusable business data only to `user_id`.

## 6. AI execution model

Do not implement one generic `runAgent(prompt)` abstraction for every product.

Use product-specific, versioned workflows composed from shared capabilities:

```text
request
  → validate input and entitlement
  → persist source assets
  → create idempotent job
  → execute versioned workflow steps
  → validate structured outputs
  → persist artifacts and metrics
  → allow human review/editing
  → export through deterministic code
```

### Shared AI capabilities

- Text generation and structured extraction
- Vision analysis
- Image segmentation/masking
- Image generation/inpainting
- Code generation
- Embeddings or retrieval only when a concrete workflow requires them

### Provider boundary

Each capability must have an internal contract and one or more adapters. Product code depends on the contract, not the vendor SDK.

### Reliability requirements

- Validate model outputs against strict schemas.
- Make jobs idempotent.
- Persist step state so a failed workflow can resume or retry safely.
- Set timeouts and bounded retries.
- Distinguish user errors, transient provider errors, policy rejections, budget stops, and internal defects.
- Never charge credits twice for the same idempotent operation.
- Record actual or estimated provider cost separately from customer credits.
- Prevent unbounded loops and autonomous spending.
- Require explicit authorization before using paid external infrastructure during development or benchmarks.

## 7. Security and data rules

- Treat uploaded files, scraped pages, SVG, generated HTML, and generated JavaScript as untrusted input.
- Validate MIME type, extension, decoded file type, dimensions, and size.
- Sanitize SVG and HTML before previewing.
- Isolate generated banner/frontend previews from the main application origin where practical.
- Apply SSRF protections to URL ingestion: block private/reserved networks, redirect escapes, unsafe schemes, and excessive downloads.
- Use signed object-storage URLs and least-privilege credentials.
- Enforce workspace ownership server-side on every read and mutation.
- When billing is later introduced, verify payment webhook signatures and make processing idempotent.
- Do not send user assets to a third party without recording which provider processes them and reflecting this in product/privacy documentation.
- Never commit secrets, production data, unsanitized private fixtures, or provider credentials.

## 8. Delivery roadmap

### Phase 0 — Repository discovery and decisions

- Inspect the repository and existing documentation before changing anything.
- Identify current stack, constraints, incomplete work, tests, CI, and deployment assumptions.
- Confirm whether this is greenfield or an existing product repository.
- Produce a concise architecture decision record for the MVP stack.
- Produce an implementation plan for the first Banner AI vertical slice.
- List unknowns, risks, and any decisions that genuinely block implementation.
- Explicitly confirm that SaaS-template selection, production auth, and billing remain deferred.

### Phase 1 — Provider-free application and workflow skeleton

- Establish the TypeScript application structure.
- Add only a development identity/local workspace sufficient for the product slice.
- Create the workspace/project/asset/job ownership model.
- Add local or fake storage and a fake AI transport.
- Implement job states, progress, retries, idempotency, metrics, and structured errors.
- Create fixture-driven tests with zero provider keys, zero network, and zero cost.

### Phase 2 — Banner AI provider-free vertical slice

- Upload a JPG/PNG.
- Create and persist a Banner project.
- Run a fake/replayed analysis and layer extraction workflow.
- Display proposed layers.
- Toggle inclusion/visibility.
- Apply preset animation metadata.
- Preview a banner from the scene model.
- Generate a deterministic HTML5 package.
- Validate dimensions, files, entry point, click/exit behavior, package size rules, and prohibited dependencies as applicable.
- Export a static preview.

### Phase 3 — Real Banner AI model evaluation

- Define a committed, sanitized evaluation set representing realistic banner difficulty.
- Evaluate candidate segmentation, vision, and inpainting providers separately.
- Measure quality, latency, cost, failure rate, and reproducibility.
- Do not couple the app to a provider before evaluation evidence exists.
- Put hard budget limits around any paid benchmark.
- Select the minimum provider combination that makes the MVP useful.

### Phase 4 — Banner AI integration and editor MVP

- Connect selected providers behind existing interfaces.
- Add user-visible progress and recovery.
- Add layer thumbnails, naming, ordering, inclusion, and visibility.
- Support background reconstruction or solid-color fallback.
- Add controlled animation presets.
- Render and inspect exports in isolated previews.
- Add end-to-end tests for the complete workflow.

### Phase 5 — SaaS-shell decision and Freelancer launch layer

- Confirm that the Banner AI product gate has passed.
- Compare Makerkit Pro, the official Next.js SaaS Starter, the existing shell, and any justified candidate.
- Write and approve the SaaS-shell ADR before integration.
- Integrate or migrate the validated Banner AI product without rewriting its domain contracts.
- Add production authentication and account recovery.
- Automatically create one private workspace per freelancer.
- Add Free and Freelancer monthly/yearly entitlements.
- Add Stripe Checkout, Customer Portal, and webhook synchronization.
- Add the immutable credit/usage ledger.
- Add plan enforcement, quotas, budget controls, and basic internal administration.
- Add transactional email only for required flows.
- Complete privacy, terms, retention, and provider-disclosure requirements.

### Phase 6 — Banner AI beta hardening

- Test against a broad real-world banner corpus.
- Track manual correction rate and export success rate.
- Improve masks, background repair, preset selection, and validation.
- Add GIF only if it is reliable and commercially useful.
- Establish support diagnostics and safe job replay.

### Phase 7 — Website Audit AI

- Build safe public-URL ingestion.
- Integrate deterministic audit tools.
- Store evidence-backed findings in a versioned schema.
- Use AI for prioritization, explanation, deduplication, and report writing.
- Export a useful report and retain provenance for every claim.

### Phase 8 — Shared URL intelligence, SEO AI, and Content AI

- Build one reusable page/document extraction pipeline.
- Create a versioned page/brand brief.
- Implement SEO outputs and deterministic validation.
- Implement channel-specific Content AI outputs.
- Reuse projects, assets, jobs, credits, and exports.

### Phase 9 — Frontend AI

- Begin with one constrained code target.
- Generate a component plan and implementation.
- Build and render output in a sandbox.
- Compare rendered output with the reference.
- Repair through bounded iterations.
- Validate build, semantics, responsiveness, and accessibility.
- Add other exports, including Gutenberg, only after the first target is reliable.

### Phase 10 — Teams and scale

- Add multi-user workspaces only when demand exists.
- Add invitations, roles, seat limits, and per-seat billing.
- Add pooled workspace credits and usage visibility.
- Scale workers and storage based on measured workloads, not speculative traffic.

## 9. Banner AI product gate

The product is ready for the SaaS-shell decision when a development or approved evaluator identity can:

1. Upload a supported static banner.
2. Receive useful proposed layers for a meaningful percentage of the evaluation set.
3. Inspect and include/exclude those layers.
4. Apply at least one appropriate animation preset.
5. Preview the animation.
6. Export a package that passes the project’s GDN validator.
7. Recover from expected failures without losing the project.

The team must also know:

- Median and high-percentile runtime.
- Estimated cost per successful banner.
- Failure rate by workflow step.
- Export validation pass rate.
- Percentage of outputs requiring manual correction.

Do not define success only as “the model returned an answer.”

Passing this gate authorizes planning the SaaS shell; it does not itself authorize purchasing a template, invoking paid services, migrating the application, or onboarding real users.

## 10. Engineering standards

- Use strict TypeScript and avoid `any` except at explicitly validated boundaries.
- Keep domain logic outside React components and route handlers.
- Validate external input and model output at runtime.
- Prefer small interfaces and explicit composition over premature generic frameworks.
- Add migrations for schema changes.
- Add unit tests for domain rules and schema transformations.
- Add integration tests for storage, jobs, provider adapters, and billing only when billing enters scope.
- Add end-to-end tests for critical user flows and exports.
- Use fake transports and sanitized fixtures for default test runs.
- Tests must not require network access, API keys, GPU access, or payment.
- Run formatting, linting, type checking, unit tests, integration tests, and relevant end-to-end tests before declaring a milestone complete.
- Keep generated code and exported HTML/CSS/JS compliant with the project’s relevant validators.
- Document important architectural choices as ADRs.
- Preserve backward compatibility for persisted, versioned workflow data or provide explicit migrations/upcasters.

## 11. Agent operating instructions

When executing this project:

1. Inspect first. Read repository instructions, existing plans, schemas, tests, and current git state before proposing changes.
2. Do not replace working architecture merely because another stack is fashionable.
3. Work in milestones. Each milestone needs scope, acceptance criteria, tests, and a clear completion report.
4. Keep the default development path provider-free and cost-free.
5. Stop at paid gates. Do not invoke paid AI/GPU services, create paid infrastructure, deploy, purchase, commit, push, or open a pull request unless explicitly authorized.
6. Never expose or commit secrets.
7. Preserve unrelated user changes in a dirty worktree.
8. Prefer reversible changes and additive schemas.
9. Do not silently weaken validation, tests, security, or acceptance criteria to make a milestone pass.
10. If a requirement is uncertain but non-blocking, make the smallest reversible assumption and document it.
11. If a decision materially changes cost, privacy, product behavior, or architecture, present the options and request direction.
12. Report exactly what was changed, what was tested, what remains, and where the next paid or external gate occurs.

## 12. Multi-agent orchestration

Use the following role split for every implementation milestone.

### Sol — lead planner and coordinator

Sol owns understanding, planning, delegation, decisions, and the final milestone report.

Sol must:

- Inspect the repository, repository instructions, documentation, plans, git state, and relevant tests.
- Translate the product brief into one bounded milestone with explicit acceptance criteria.
- Identify dependencies, risks, schema changes, external gates, and likely files before implementation.
- Delegate bounded tasks with enough context for each agent to work independently.
- Resolve contradictions between the plan, repository state, Terra's findings, and Luna's implementation.
- Keep the milestone within scope.
- Verify that Terra's review concerns are either fixed or explicitly documented before completion.
- Produce the final completion report.

Sol must not:

- Write production code while Luna is assigned as implementer.
- Expand the milestone merely because adjacent work appears convenient.
- Allow paid calls, deployment, commits, pushes, or irreversible operations without explicit authorization.
- Declare completion based only on Luna's report; inspect the resulting diff and test evidence.

### Terra — read-only reviewer and overwatch

Terra owns independent review before, during, and after implementation. Terra must remain read-only unless Sol explicitly reassigns the role in a future milestone.

Terra must:

- Review Sol's milestone plan for missing requirements, unsafe assumptions, architectural drift, security problems, and weak acceptance criteria.
- Inspect relevant existing code and tests independently.
- Monitor implementation checkpoints and review diffs produced by Luna.
- Look specifically for tenancy/ownership errors, unsafe file or URL handling, non-idempotent jobs, double charging, provider lock-in, unbounded paid operations, missing runtime validation, and insufficient tests.
- Run or request relevant verification when useful, without modifying source files.
- Classify findings as blocking, important, or optional.
- Give concise, actionable feedback tied to files, behavior, or acceptance criteria.
- Perform a final acceptance review against the approved milestone rather than against newly invented scope.

Terra must not:

- Edit source code, migrations, tests, fixtures, documentation, or configuration.
- Compete with Luna by implementing an alternative solution.
- Turn optional improvements into completion blockers unless they violate an explicit requirement or create material risk.

### Luna — implementation owner

Luna is the sole writer for the active milestone and owns code, migrations, fixtures, tests, and scoped documentation changes.

Luna must:

- Read the approved milestone plan and relevant repository instructions before editing.
- Inspect the existing implementation before introducing new abstractions.
- Implement only the approved scope.
- Preserve unrelated work and avoid destructive git operations.
- Follow the project's formatting, linting, typing, schema, migration, testing, and security conventions.
- Add or update tests alongside behavior.
- Address Terra's blocking and important findings or explain concrete disagreement to Sol.
- Run the required verification and report exact commands and results.
- Stop at paid, network, deployment, commit, push, or other authorization gates.
- Return a concise implementation report containing changed files, behavior, tests, remaining risks, and any unresolved findings.

Luna must not:

- Redesign the approved architecture without reporting the blocker to Sol.
- Hide failing tests, weaken validation, delete coverage, or silently defer acceptance criteria.
- Invoke paid providers or use real customer/private data in fixtures.

### Milestone execution protocol

Use this sequence:

1. **Sol investigates:** inspect repository state and produce a draft milestone plan.
2. **Terra preflight:** independently review the draft plan and return blocking, important, and optional findings.
3. **Sol approves:** revise and freeze the milestone scope, acceptance criteria, test plan, ownership, and external gates.
4. **Fan out:** give the same approved milestone contract to Terra and Luna.
5. **Luna implements:** Luna is the only writer.
6. **Terra overwatches:** Terra reviews meaningful checkpoints and diffs without editing.
7. **Luna verifies:** run all milestone-required checks and address valid review findings.
8. **Terra accepts:** perform a final read-only review against the frozen acceptance criteria.
9. **Sol closes:** inspect the work and evidence, resolve remaining disagreements, and issue the final milestone report.

### Communication contract

Every delegated task must state:

- Role and whether filesystem writes are allowed.
- Exact scope and non-goals.
- Relevant files, schemas, plans, or prior decisions.
- Acceptance criteria.
- Required verification.
- Paid/network/deployment/git gates.
- Expected return format.

Agents should communicate findings as soon as they materially affect active work. Luna should not wait until the end to disclose a blocked design, and Terra should not wait until final review to disclose a known blocking defect.

### Shared-workspace safety

- Luna is the only writer during an implementation milestone.
- Terra may inspect files and run non-mutating checks but must not format, autofix, update snapshots, regenerate artifacts, or run commands that mutate tracked files.
- Sol coordinates all scope changes and resolves agent conflicts.
- No agent may reset, discard, overwrite, or claim unrelated user changes.
- If another process changes an overlapping file, Luna must stop and report the conflict to Sol.

## 13. Required first response from Sol

Do not begin by implementing all products.

First:

1. Inspect the repository and summarize its current state.
2. Compare the existing architecture with this brief.
3. Identify contradictions, missing prerequisites, and reusable work.
4. Identify the last completed milestone and propose the smallest next incomplete milestone toward the Banner AI product gate; do not assume the provider-free vertical slice is still unbuilt.
5. State the files/schemas/services likely to change.
6. Define acceptance criteria and the test plan.
7. Identify any paid, network, deployment, or irreversible gates.
8. Ask only questions that materially block the plan.

After approval, use the orchestration protocol above. Sol plans and coordinates, Terra reviews in read-only mode, and Luna implements and verifies.

## 14. Current priority

The current priority order is:

```text
shared provider-free foundation
→ Banner AI vertical slice
→ real model benchmark
→ Banner AI editor and validated export
→ Banner AI product gate
→ SaaS-shell decision
→ freelancer auth, billing and credits
→ beta hardening
→ Website Audit AI
→ SEO AI + Content AI
→ Frontend AI
→ teams and seats
```

Maintain this order unless evidence from user testing or technical evaluation justifies changing it.
