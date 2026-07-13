# ADR 0001: Banner AI validation architecture

- Status: Accepted for Phase 0A
- Date: 2026-07-12
- Decision owners: Sol (architecture), Terra (read-only review), Luna (documentation)
- Scope: Banner AI product validation before the SaaS-shell decision gate

## Context

The repository baseline observed before this decision is bootstrap-only. It contains the project brief, Codex agent configuration, and editor metadata. It does not contain a Git repository, application source, package manifest or lockfile, database schema or migrations, Banner AI implementation, fixtures, tests, continuous-integration configuration, or deployment configuration. Consequently, this decision does not replace or reorganize an existing application.

The current program must validate Banner AI through the smallest application surface that can exercise a provider-free workflow. The durable product artifact is a versioned, serializable scene, not a provider response or a one-off export. Production authentication, billing, customer credits, teams, seats, and the surrounding SaaS shell remain outside the program boundary until the Banner AI product gate is passed.

The architecture must preserve the following properties from the first executable slice:

- Banner AI rules and persisted contracts survive a future change of application shell.
- Workspace scope is authoritative and enforced server-side without depending on an authentication vendor.
- External storage, queue, AI, export, and validation implementations can be replaced behind bounded ports.
- Provider usage and cost are recorded independently from future customer billing or credits.
- Slow or expensive work has explicit job, attempt, retry, cancellation, timeout, idempotency, and budget semantics.
- Untrusted uploads and generated previews do not become trusted application input.
- Default development and verification require no API key, network access, paid service, or production data.

## Decision

### 1. Use a modular, provider-free validation application

The first implementation will be a modular monolith. A Next.js application will host composition, HTTP boundaries, and the initial React user interface. Banner AI contracts and rules will remain framework-independent. Separate deployable services and speculative shared packages will not be introduced during product validation.

The logical dependency direction is strictly inward:

```text
Next.js host and composition root
  -> concrete adapters (database, local storage, fake AI, in-process jobs)
      -> application workflows and bounded ports
          -> Banner AI domain contracts and pure rules
```

An outer layer may import an inner layer. An inner layer must never import an outer layer. In particular:

- Domain contracts and application workflows must not import React, Next.js route/request types, cookies, sessions, Server Actions, or framework response types.
- Domain contracts and application workflows must not import Supabase, Makerkit, Stripe, an authentication SDK, an AI-provider SDK, a queue-vendor SDK, or an object-storage-vendor SDK.
- Domain values must not contain database rows, Drizzle query objects, provider responses, queue messages, bucket names, signed URLs, or vendor customer/account objects.
- Adapters translate external representations into validated internal values and translate internal commands into vendor-specific calls.
- Route handlers and UI components perform transport concerns only; they do not own scene rules, job transitions, workspace authorization, metering, or export rules.
- The composition root is the only place that chooses concrete adapters.

This direction applies even while all modules live in one repository and one process.

### 2. Establish a neutral, authoritative actor/workspace context

Product services receive one server-resolved context with this semantic contract:

```ts
type ActorId = string & { readonly __brand: "ActorId" };
type WorkspaceId = string & { readonly __brand: "WorkspaceId" };
type RequestId = string & { readonly __brand: "RequestId" };

interface ActorWorkspaceContext {
  actorId: ActorId;
  workspaceId: WorkspaceId;
  requestId: RequestId;
}
```

All three fields are required and non-null. Internal actor and workspace identifiers are opaque ASCII strings of 8–64 characters matching `^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$`. A request identifier is an opaque ASCII string of 8–128 characters matching `^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$`. The branded values are created only by validated server-side constructors; raw request JSON cannot construct an authoritative context.

During product validation, a development resolver obtains the actor and workspace from server-only local configuration, verifies that the workspace exists, and creates the context for each request or job command. It must not accept `actorId` or `workspaceId` from a form field, query parameter, upload field, scene document, or client-controlled header. Background execution persists the authoritative workspace and initiating actor with the job and reconstructs the context from those records, never from a queue payload alone.

Every service command receives `ActorWorkspaceContext` separately from user input. Every read and mutation is scoped to `workspaceId`; persistence adapters must use workspace-qualified lookups and ownership-preserving foreign keys. An identifier that exists in a different workspace is reported as not found rather than revealing cross-workspace existence. `actorId` provides attribution in the validation application; it is not a substitute for workspace scoping.

A future authentication or SaaS adapter may map its verified identity/session to the same internal actor and workspace identifiers. It may not pass session objects, memberships, roles, Stripe customers, Makerkit accounts, or Supabase users into Banner AI services. The context therefore stays stable when the development identity is replaced.

### 3. Adopt a minimal later stack with pinned project policy

No packages are installed by this ADR. When Phase 1A is authorized, the initial implementation will use:

- Next.js App Router and React for the outer web host only.
- TypeScript in strict mode for all authored application code. The project configuration will also enable `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`; `any` is prohibited except inside an adapter boundary that immediately validates and narrows it.
- pnpm managed through Corepack, with one committed lockfile and a pinned `packageManager` value.
- PostgreSQL as the durable database and Drizzle for schema/query mapping.
- A TypeScript-first runtime-schema library for strict parsing of external and persisted product data. The initial choice is Zod; the exact supported version will be verified and pinned at the authorized dependency-resolution gate.
- Vitest for unit and provider-free integration tests. Playwright will be added only when a runnable critical browser flow exists; it is not installed for an empty test suite.

Runtime schemas are the executable source of truth for JSON-shaped domain contracts such as `BannerSceneV1`, job commands, adapter results, and export manifests. TypeScript types are inferred from or checked against those schemas. Parsers reject unknown keys and invalid cross-field references rather than silently stripping or coercing them. Database definitions and additive migrations remain the source of truth for relational persistence; database rows are mapped through repositories into validated domain values.

The repository currently has no verified project dependency versions. Phase 1A must stop at a network authorization gate before querying a package registry or installing dependencies. After authorization, it must select mutually compatible supported releases, record exact direct dependency versions, pin the Node and pnpm project policy, create the lockfile, and retain the verification evidence. This ADR intentionally does not present locally installed host tools or remembered package releases as verified project versions.

### 4. Create physical boundaries only when real code requires them

The suggested `apps/` and `packages/` layout describes dependency ownership, not a requirement to create empty directories. Phase 1A will introduce only the web host and modules needed by its first provider-free contract, persistence, and job tests. A package is justified when it contains a real contract or implementation and has a clear consumer. A shared package is extracted when there is a demonstrated cross-product consumer or a boundary that needs independent testing.

The following are explicitly prohibited during validation:

- an empty `billing` package or placeholder production SaaS entities;
- a generic `runAgent(prompt)` facade;
- one package per hypothetical future product or provider;
- microservices, distributed queues, or remote storage introduced without measured need;
- domain contracts that merely re-export an SDK type;
- arbitrary CSS, HTML, JavaScript, prompts, or executable callbacks embedded in the scene or export-settings contract.

The first concrete package/file layout will be listed prospectively in the Phase 1A implementation plan and created only as its code is implemented.

### 5. Keep infrastructure behind bounded, product-shaped ports

Application workflows will depend on narrow internal contracts for these responsibilities:

- resolving the authoritative development actor/workspace context at the host boundary;
- storing and retrieving immutable asset versions by internal reference and digest;
- analyzing a banner into a strictly validated composition proposal;
- extracting a specifically identified proposed layer;
- persisting and leasing jobs and attempts with compare-and-set state transitions;
- executing a versioned Banner workflow with bounded retries, timeouts, cancellation, and resumption;
- reserving a provider call against a budget and recording usage/cost around every invocation;
- exporting a persisted scene through deterministic code;
- validating an export against an identified, versioned project validator profile.

These are separate responsibilities, not methods on a universal AI client. Port inputs and outputs use domain identifiers, immutable asset-version references, bounded byte/value objects, structured errors, and integer time/cost units. They do not expose prompts as an unrestricted execution API.

The default adapters are local or fake: local immutable storage, an in-process job executor with a controllable clock, replayed Banner analysis/extraction fixtures, zero-cost usage records, deterministic exporters, and fixture-driven validators. Real provider adapters cannot be selected merely by setting an environment variable; adding or enabling one requires a separately approved benchmark milestone, recorded provider/model/workflow identity, privacy review, and an explicit integer budget.

Provider cost is measured independently from any future customer-credit concept. Cost values use non-negative integer millionths of a currency unit plus an uppercase three-letter currency code; floating-point money is not allowed. The provider-usage record is opened immediately before an adapter invocation and finalized after success or failure so failed and indeterminate calls remain observable. Future subscriptions, entitlements, and customer credit ledgers must not be inferred from or added to this record.

### 6. Version persisted product behavior

Every persisted scene, workflow definition, export implementation, and validator profile has an explicit version. Immutable asset versions include a content digest; mutable asset metadata does not replace prior bytes. An export reproduction manifest binds the exact scene revision and digest, referenced asset-version identifiers and digests, workflow version, exporter version/build digest, validator profile/rules digest, and output digest.

Persisted schema changes are additive by default. A breaking product-schema change introduces a new literal schema version and a pure, deterministic upcaster; it does not reinterpret or overwrite an existing scene in place. Database schema changes use reviewed forward migrations. Destructive migrations, bulk rewrites, and physical asset deletion require a separately approved irreversible-operation gate and rollback/retention plan.

### 7. Make provider-free verification the default

The normal format, lint, type-check, unit, and integration test path must work with network access disabled and without API keys, GPU access, payment credentials, hosted databases, or remote object storage. Tests use sanitized committed fixtures, fake transports, fake clocks, and local persistence/storage adapters. No test may silently fall back to a real provider.

Real-provider evaluation is a later, explicitly invoked benchmark suite. It must have an approved sanitized corpus, hard call and cost caps, timeouts, stop conditions, provider disclosure, and separate commands from the default test suite.

## Rejected alternatives

### Adopt a SaaS starter before validating Banner AI

Rejected because it would force production identity, tenancy, billing, and framework choices before the product contracts and provider economics are known. Makerkit, the official Next.js SaaS Starter, and other shells remain candidates only at the documented post-product-gate comparison.

### Put Banner AI logic in Next.js routes, Server Actions, or React components

Rejected because route/session types and rendering lifecycles would become implicit domain dependencies and make a future shell migration a rewrite. The host may translate and compose, but not own product rules.

### Use a provider SDK or a universal prompt runner as the core abstraction

Rejected because Banner analysis, extraction, and export have different bounded inputs, outputs, failure modes, costs, and validation requirements. Product-shaped ports preserve strict schemas and provider replacement.

### Use Supabase, Makerkit, or Stripe objects as ownership identifiers

Rejected because ownership must remain stable across the deferred SaaS decision. Internal actor/workspace identifiers and server-side mapping avoid vendor ownership in product tables.

### Treat TypeScript interfaces or database JSON columns as sufficient validation

Rejected because neither validates untrusted runtime data. Strict executable schemas, relational constraints, and cross-field validation are all required.

### Create the full suggested monorepo or distributed infrastructure immediately

Rejected because empty packages and premature services add operational and dependency surface without validating Banner AI. Boundaries begin logically and become physical only with real code and tests.

### Store only mutable asset paths or only the latest scene

Rejected because overwriting bytes, paths, or scene JSON breaks reproducible exports and safe retry. Immutable versions and digests are required.

## Consequences

### Benefits

- The future SaaS shell can replace the development resolver and web composition without changing Banner AI contracts.
- Provider, storage, queue, and validator implementations remain replaceable.
- Workspace ownership has an enforceable server and persistence boundary before multi-user features exist.
- Strict versioning and immutable references make replay, audit, retry, and deterministic export possible.
- Local fakes permit fast, cost-free, reproducible development and tests.
- Demand-driven modules keep the first slice small while preserving clear dependency rules.

### Costs and constraints

- Adapters must perform explicit mapping and runtime validation.
- Scene, workflow, exporter, and validator evolution require version discipline and upcaster tests.
- Job and usage persistence is more explicit than a direct synchronous provider call.
- The initial in-process/local adapters are validation infrastructure, not a claim of production durability or scale.
- Dependency installation cannot begin until the external network/version-pinning gate is approved.

## Explicit deferrals and authorization gates

This decision does not authorize or select:

- a production queue, worker platform, object-storage vendor, AI/GPU provider, email provider, monitoring vendor, or deployment platform;
- a SaaS starter or merge/migration from one;
- production authentication, account recovery, users, memberships, roles, invitations, or organization switching;
- plans, billing, Stripe or another payment provider, subscriptions, webhooks, entitlements, customer credits, top-ups, teams, or seats;
- SVG ingestion, arbitrary animation timelines, unrestricted natural-language animation/code generation, multi-size campaigns, video export, real-time collaboration, or GIF if it delays the core slice;
- network research, dependency download or installation, paid calls, hosted infrastructure, deployment, Git initialization, commit, push, or pull request;
- database creation, migration execution, destructive data changes, physical asset deletion, production credentials, customer data, or third-party asset processing.

Each external, paid, privacy-affecting, deployment, Git, migration, or irreversible action remains a separate approval gate. The future GDN rules source and exact validator profile must be verified and frozen before any export is described as GDN-valid; this ADR does not fabricate current external platform rules.

## Follow-up records

Phase 0A also requires two separate documents: the exact closed `BannerSceneV1` semantic contract and the prospective provider-free Phase 1A implementation plan. Those records refine this ADR without changing its dependency direction or authorizing executable work. If either record conflicts with this ADR, the conflict must be resolved explicitly rather than hidden in implementation.
