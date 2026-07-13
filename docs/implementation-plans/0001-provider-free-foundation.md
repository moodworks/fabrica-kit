# Implementation plan 0001: Provider-free Banner AI foundation

- Status: Approved design; implementation not authorized by this document
- Planning milestone: Phase 0A
- Prospective implementation milestone: Phase 1A
- Date: 2026-07-12
- Depends on: [ADR 0001](../decisions/0001-banner-ai-validation-architecture.md) and [BannerSceneV1](../product/banner-scene-v1.md)

## Outcome

Phase 1A will establish the smallest executable, provider-free foundation needed before the Banner AI vertical slice. It will implement neutral workspace ownership, immutable asset versions, the `BannerSceneV1` runtime contract, versioned workflows, resumable jobs, usage/cost controls, local storage, fake Banner capabilities, and cost-free verification.

This is a prospective implementation plan. Phase 0A creates only documentation. It does not authorize creating the application, resolving or installing packages, generating or applying a migration, running a database, creating fixtures, invoking a provider, using network services, initializing Git, or deploying.

## Phase 1A scope

When separately approved and after its external gates are cleared, Phase 1A will implement:

- a minimal Next.js App Router host and composition root;
- strict TypeScript and a pinned pnpm/Corepack workspace;
- the exact `BannerSceneV1` runtime schema and canonical serializer;
- a server-resolved development actor and one local workspace;
- PostgreSQL/Drizzle persistence for the entities and constraints below;
- local immutable asset storage outside the public web root;
- decoded JPG/PNG validation and deterministic metadata-stripping normalization;
- an in-process, lease-based job runner with fake clock support;
- fake/replayed Banner composition analysis and layer extraction;
- provider-usage records with zero-cost fake calls and hard-disabled external calls;
- bounded exporter and validator ports with deterministic fakes, not a claim of GDN compliance;
- sanitized fixtures and unit/integration tests requiring no provider key or paid service.

No empty package is created. The web host, Banner AI module, and database module are introduced only because Phase 1A gives each real code and tests.

## Explicit non-goals

Phase 1A does not include:

- the Phase 2 upload/editor UI, layer list, animated preview, or production export implementation;
- a real vision, segmentation, inpainting, image-generation, GPU, queue, or storage provider;
- an authoritative GDN rule implementation or any claim that an output is GDN-valid;
- SVG, GIF, arbitrary keyframes/timelines, arbitrary HTML/CSS/JavaScript, natural-language animation generation, video, multi-size campaigns, or collaboration;
- a generic `runAgent(prompt)` or unrestricted prompt execution API;
- production authentication, users, memberships, roles, account recovery, or customer onboarding;
- plans, billing, subscriptions, webhooks, entitlements, customer credits, top-ups, teams, or seats;
- Makerkit, Supabase, Stripe, a SaaS starter, or a SaaS-shell migration;
- hosted infrastructure, deployment, production secrets, private/customer data, Git initialization, commit, push, or pull request.

## Authoritative ownership model

### Actor/workspace context

Every application command receives the `ActorWorkspaceContext` defined by ADR 0001 as a separate, trusted argument. In Phase 1A, a development-only resolver reads the actor and workspace UUIDs from server-only local configuration and validates their format. It opens a transaction, binds the configured UUID as a parameter to `SELECT set_config('app.workspace_id', $1::uuid::text, true)`, then resolves that workspace inside the same transaction before constructing the branded context. Client data cannot supply or override either identifier; SQL text interpolation is prohibited.

`workspace` is the ownership root and therefore has no `workspace_id`. Every child business row except the globally shared `WorkflowVersion` carries a non-null `workspace_id`. Every repository method requires a workspace ID and uses a workspace-qualified predicate. A lookup in the wrong workspace returns not found. Background work persists the initiating workspace and actor on the job; a worker never trusts workspace data from an unverified message.

Database defense in depth forces PostgreSQL row-level security (RLS) on the ownership root and every workspace-owned child table. The root policy is:

```sql
id = nullif(current_setting('app.workspace_id', true), '')::uuid
```

Every child policy is:

```sql
workspace_id = nullif(current_setting('app.workspace_id', true), '')::uuid
```

`set_config(..., true)` is transaction-local. A missing, empty, or malformed setting either matches no row or raises a cast error; both fail closed and abort the operation. Policies use both `USING` and `WITH CHECK`. The runtime database role does not own tables and has neither `BYPASSRLS` nor migration privileges. The migration role is separate. Phase 1A's single-workspace in-process dispatcher claims work only after the same parameterized setup using the server-configured UUID. Cross-workspace dispatch is deferred until there is a real multi-workspace execution need.

RLS does not replace workspace-qualified repository predicates or composite foreign keys. Tests must independently prove all three layers.

### Relational conventions

- IDs are application-generated UUIDs stored as PostgreSQL `uuid` and exposed as distinct branded types. No database extension is required to generate them.
- Times are UTC PostgreSQL `timestamptz`. Services obtain time from an injected clock and pass it explicitly so tests are deterministic.
- All columns are `NOT NULL` unless marked **nullable** below.
- The `workspace` root has `PRIMARY KEY (id)`. Every workspace-owned child table has `PRIMARY KEY (id)` and `UNIQUE (workspace_id, id)`. Tables needing same-project references also add the stated three-column unique key.
- Workspace-preserving relationships use composite foreign keys containing `workspace_id`; a row cannot reference an object in another workspace even if an application check fails.
- Closed states/kinds use `text` plus named `CHECK` constraints so changes are explicit additive migrations.
- SHA-256 values use `char(64)` plus lowercase-hex checks. Canonical JSON documents use `jsonb` plus their version/digest columns and are runtime-validated before insertion.
- Money uses PostgreSQL `bigint` and TypeScript `bigint` integer millionths of one currency unit. Database aggregates, domain arithmetic, comparisons, and additions remain exact; floating-point conversion is prohibited.
- Mutable rows update `updated_at` in the same transaction. Immutable rows have no repository update method except the explicitly described lifecycle finalization.

## Exact persistence model

### `workspace`

| Column | Type and bounds | Mutability and meaning |
| --- | --- | --- |
| `id` | `uuid` | Immutable primary ownership boundary |
| `name` | `varchar(120)`, 1–120 NFC code points after trimming, no control/bidi override characters | Mutable development display label |
| `created_at` | `timestamptz` | Immutable |
| `updated_at` | `timestamptz`, `>= created_at` | Mutable with `name` |

There is no user, membership, role, plan, subscription, entitlement, or credit relationship. The configured development workspace UUID is server-side configuration, not a public slug.

`workspace` has forced RLS using `id = active workspace setting`. Its resolution is the first protected query after the parameterized transaction-local setting; a missing or malformed setting cannot enumerate roots.

### `project`

| Column | Type and bounds | Mutability and meaning |
| --- | --- | --- |
| `id` | `uuid` | Immutable |
| `workspace_id` | `uuid` | Immutable FK to `workspace(id)` |
| `kind` | `text`, exactly `banner` | Immutable |
| `name` | `varchar(120)`, same safe plain-text rule as workspace name | Mutable |
| `canvas_width` | `smallint`, `1..4_096` | Immutable for the one-size v1 project |
| `canvas_height` | `smallint`, `1..4_096` | Immutable; width × height `<= 16_777_216` |
| `created_at` | `timestamptz` | Immutable |
| `updated_at` | `timestamptz`, `>= created_at` | Mutable with name/archive state |
| `archived_at` | `timestamptz` **nullable** | Mutable only from null to an archive time or back to null |

`UNIQUE (workspace_id, id)` supports all child FKs. Project names are not unique. Changing canvas size creates a new project in v1 rather than silently reinterpreting scene coordinates.

### `asset`

| Column | Type and bounds | Mutability and meaning |
| --- | --- | --- |
| `id` | `uuid` | Immutable logical asset identity |
| `workspace_id` | `uuid` | Immutable ownership |
| `project_id` | `uuid` | Immutable composite FK `(workspace_id, project_id)` to project |
| `purpose` | `text`: `source`, `background`, or `layer` | Immutable raster role |
| `display_name` | `varchar(120)`, safe NFC plain text | Mutable; never a storage path |
| `created_at` | `timestamptz` | Immutable |
| `updated_at` | `timestamptz`, `>= created_at` | Mutable with display/archive state |
| `archived_at` | `timestamptz` **nullable** | Mutable archive marker; not physical deletion |

An asset has one or more immutable raster versions. There is no mutable `current_version_id`; callers select an explicit version or the maximum version number in a workspace-scoped query. `UNIQUE (workspace_id, project_id, id)` supports project-preserving asset-version references. ZIP exports are not assets; they are immutable `generation_output` artifacts.

### `asset_version`

| Column | Type and bounds | Mutability and meaning |
| --- | --- | --- |
| `id` | `uuid` | Immutable version identity |
| `workspace_id` | `uuid` | Immutable ownership |
| `project_id` | `uuid` | Immutable project ownership; composite FK to project |
| `asset_id` | `uuid` | Immutable composite FK `(workspace_id, project_id, asset_id)` to asset |
| `version_number` | `integer`, `1..2_147_483_647` | Immutable, monotonically allocated per asset |
| `object_key` | `varchar(240)`, generated ASCII logical key | Immutable; adapter-relative, never user supplied |
| `sha256` | `char(64)` lowercase hex | Immutable digest of exact normalized bytes |
| `media_type` | `text`: `image/jpeg` or `image/png` | Immutable decoded/normalized type |
| `byte_size` | `integer`, `1..20_971_520` | Immutable encoded bytes |
| `pixel_width` | `smallint`, `1..8_192` | Immutable decoded width |
| `pixel_height` | `smallint`, `1..8_192` | Immutable decoded height; area `<=40_000_000` |
| `created_by_actor_id` | `uuid` | Immutable attribution; not an auth-provider FK |
| `created_at` | `timestamptz` | Immutable |

Required keys and indexes:

- `UNIQUE (workspace_id, id)`;
- `UNIQUE (workspace_id, project_id, id)`;
- `UNIQUE (workspace_id, project_id, asset_id, version_number)`;
- `UNIQUE (object_key)`;
- non-unique index `(workspace_id, project_id, sha256)` for detection/reuse without forcing two logical assets to deduplicate.

`object_key` is `w/<workspace UUID>/a/<asset UUID>/v/<version>/content`, built only from validated server IDs and the allocated integer. The storage adapter maps it under a configured private root or future bucket. It never contains an original filename.

### `workflow_version`

| Column | Type and bounds | Mutability and meaning |
| --- | --- | --- |
| `id` | `uuid` | Immutable global workflow identity |
| `workflow_key` | `varchar(80)`: initially `banner.analyze`, `banner.extract`, `banner.scene-edit`, or `banner.export` | Immutable product-shaped workflow name |
| `version_number` | `integer`, `1..2_147_483_647` | Immutable version |
| `definition_json` | `jsonb`, strict schema selected by workflow key | Immutable steps, weights, retry/cost policy; never a generic prompt payload |
| `definition_sha256` | `char(64)` lowercase hex | Immutable canonical definition digest |
| `created_at` | `timestamptz` | Immutable |

Keys are `UNIQUE (workflow_key, version_number)` and `UNIQUE (workflow_key, definition_sha256)`. A workflow version is never edited or deleted; configuration selects another explicit version. It is shared system data and therefore has no workspace/customer fields or RLS policy.

### `banner_scene_version`

| Column | Type and bounds | Mutability and meaning |
| --- | --- | --- |
| `id` | `uuid` | Immutable |
| `workspace_id` | `uuid` | Immutable ownership |
| `project_id` | `uuid` | Immutable composite FK to a Banner project |
| `revision_number` | `integer`, `1..2_147_483_647` | Immutable, monotonically allocated per project |
| `schema_version` | `smallint`, exactly `1` in Phase 1A | Immutable literal matching scene JSON |
| `scene_json` | `jsonb`, valid strict `BannerSceneV1` | Immutable canonical semantic value |
| `scene_sha256` | `char(64)` lowercase hex | Immutable digest of canonical scene bytes |
| `parent_scene_version_id` | `uuid` **nullable** | Immutable; null only for revision 1, otherwise same-project parent |
| `workflow_version_id` | `uuid` | Immutable FK identifying the analysis/edit workflow that created this revision |
| `created_by_actor_id` | `uuid` | Immutable internal actor attribution |
| `created_at` | `timestamptz` | Immutable |

Keys are:

- `UNIQUE (workspace_id, id)`;
- `UNIQUE (workspace_id, project_id, id)` for same-project parent FKs;
- `UNIQUE (workspace_id, project_id, revision_number)`;
- a non-unique index `(workspace_id, project_id, scene_sha256)` for idempotent lookup and diagnostics.

The parent FK contains `(workspace_id, project_id, parent_scene_version_id)`. Application validation requires revision 1 to have no parent and every later revision to reference a lower revision. Identical scene bytes may have different provenance, so digest is intentionally not unique.

### `generation_job`

| Column | Type and bounds | Mutability and meaning |
| --- | --- | --- |
| `id` | `uuid` | Immutable job identity across retries |
| `workspace_id` | `uuid` | Immutable ownership |
| `project_id` | `uuid` | Immutable composite FK to project |
| `initiated_by_actor_id` | `uuid` | Immutable internal attribution |
| `request_id` | `varchar(128)`, ADR request-ID syntax | Immutable trace identifier |
| `operation` | `text`: `banner.analyze`, `banner.extract`, or `banner.export` | Immutable bounded operation |
| `workflow_version_id` | `uuid` | Immutable FK to workflow version matching operation |
| `idempotency_key` | `varchar(128)`, 8–128 ASCII `/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/` | Immutable caller operation key |
| `request_json` | `jsonb`, strict operation-specific command v1 | Immutable replay input without actor/context or key |
| `request_sha256` | `char(64)` | Immutable canonical request digest |
| `state` | `text`: `queued`, `running`, `retry_wait`, `succeeded`, `failed`, `cancelled`, or `budget_stopped` | Mutable only by valid transition |
| `progress_bps` | `smallint`, `0..10_000` | Mutable, monotonic basis points |
| `attempt_count` | `smallint`, `0..3` | Mutable; number of created attempts |
| `max_attempts` | `smallint`, exactly `3` | Immutable Phase 1A policy |
| `provider_call_count` | `smallint`, `0..64` | Mutable; incremented atomically only when a new usage reservation is created |
| `max_provider_calls` | `smallint`, exactly `64` | Immutable hard call ceiling |
| `attempt_timeout_ms` | `integer`, exactly `120_000` | Immutable per-attempt limit |
| `job_timeout_ms` | `integer`, exactly `600_000` | Immutable wall-clock limit |
| `budget_limit_micros` | `bigint`, `0..9_000_000_000_000_000` | Immutable maximum provider cost |
| `currency` | `char(3)`, uppercase `/^[A-Z]{3}$/` | Immutable cost currency |
| `next_attempt_at` | `timestamptz` **nullable** | Non-null only in `retry_wait` |
| `cancel_requested_at` | `timestamptz` **nullable** | First accepted cancel request; never cleared |
| `started_at` | `timestamptz` **nullable** | Set once when attempt 1 starts |
| `deadline_at` | `timestamptz` **nullable** | Set with started time to `started_at + 600_000ms` |
| `finished_at` | `timestamptz` **nullable** | Non-null exactly for terminal states |
| `terminal_error_category` | `varchar(40)` **nullable** | Required for failed/cancelled/budget-stopped, null for success |
| `terminal_error_code` | `varchar(80)` **nullable** | Stable safe code paired with category |
| `terminal_error_message` | `varchar(500)` **nullable** | Safe diagnostic with no provider secret/raw response |
| `created_at` | `timestamptz` | Immutable |
| `updated_at` | `timestamptz` | Updated with lifecycle fields |

`UNIQUE (workspace_id, id)`, `UNIQUE (workspace_id, project_id, id)`, and `UNIQUE (workspace_id, operation, idempotency_key)` are required. The project and all input asset-version references inside `request_json` are resolved and ownership-checked before creation.

Phase 1A jobs use `budget_limit_micros = 0` and fake calls estimated/actual at zero. A later approved benchmark may persist a nonzero limit; no configuration default may silently raise it.

### `generation_attempt`

| Column | Type and bounds | Mutability and meaning |
| --- | --- | --- |
| `id` | `uuid` | Immutable attempt identity |
| `workspace_id` | `uuid` | Immutable ownership |
| `job_id` | `uuid` | Immutable composite FK to job |
| `attempt_number` | `smallint`, `1..3` | Immutable |
| `state` | `text`: `running`, `succeeded`, `failed`, `cancelled`, `budget_stopped`, `timed_out`, or `abandoned` | Mutable once from running to terminal |
| `worker_id` | `varchar(100)`, 1–100 ASCII `/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/` | Immutable diagnostic identity, not a vendor queue type |
| `lease_token` | `uuid` | Immutable token required for heartbeat/finalization CAS |
| `lease_expires_at` | `timestamptz` | Mutable with valid heartbeat |
| `heartbeat_at` | `timestamptz` | Mutable, monotonic |
| `started_at` | `timestamptz` | Immutable |
| `finished_at` | `timestamptz` **nullable** | Null only while running |
| `error_category` | `varchar(40)` **nullable** | Null on success; required for other terminal states |
| `error_code` | `varchar(80)` **nullable** | Stable safe code |
| `error_message` | `varchar(500)` **nullable** | Safe bounded diagnostic |

Keys include:

- `UNIQUE (workspace_id, id)`;
- `UNIQUE (workspace_id, job_id, id)`;
- `UNIQUE (workspace_id, job_id, attempt_number)`;
- a partial unique index on `(workspace_id, job_id)` where state is `running`.

An attempt row is created in the same transaction that changes a job from `queued` or eligible `retry_wait` to `running` and increments `attempt_count`. A terminal attempt is immutable. A job retry always creates a new attempt; it never resets or reuses the failed attempt.

### `generation_output`

| Column | Type and bounds | Mutability and meaning |
| --- | --- | --- |
| `id` | `uuid` | Immutable |
| `workspace_id` | `uuid` | Immutable ownership |
| `project_id` | `uuid` | Immutable project ownership |
| `job_id` | `uuid` | Immutable composite FK `(workspace_id, project_id, job_id)` to job |
| `attempt_id` | `uuid` | Immutable composite FK `(workspace_id, job_id, attempt_id)` |
| `output_key` | `varchar(80)`, 1–80 lowercase ASCII `/^[a-z0-9][a-z0-9._-]{0,79}$/` | Immutable logical workflow-step key |
| `kind` | `text`: `analysis_proposal`, `asset_version`, `banner_scene_version`, or `export_artifact` | Immutable closed variant |
| `disposition` | `text`: `checkpoint` or `final` | Immutable workflow-declared role |
| `payload_json` | `jsonb` **nullable** | Present only for strict analysis proposal |
| `asset_version_id` | `uuid` **nullable** | Present only for asset-version kind; project-qualified composite FK |
| `banner_scene_version_id` | `uuid` **nullable** | Present for scene-version kind and export artifact; project-qualified composite FK |
| `reproduction_manifest_json` | `jsonb` **nullable** | Present only for export artifact; strict manifest v1 |
| `artifact_object_key` | `varchar(240)` **nullable** | Server-generated private logical key; present only for export artifact |
| `artifact_media_type` | `text`: `application/zip` or `image/png` **nullable** | Present only for export artifact |
| `artifact_byte_size` | `integer`, `1..52_428_800` **nullable** | Exact immutable artifact bytes |
| `artifact_pixel_width` | `smallint`, `1..4_096` **nullable** | Required for PNG, null for ZIP |
| `artifact_pixel_height` | `smallint`, `1..4_096` **nullable** | Required for PNG, null for ZIP |
| `content_sha256` | `char(64)` | Canonical payload, referenced asset, scene, or output digest |
| `created_at` | `timestamptz` | Immutable |

Variant checks require exactly:

- `analysis_proposal`: payload present; both references, manifest, and all artifact columns null;
- `asset_version`: asset reference present; payload, scene reference, manifest, and all artifact columns null;
- `banner_scene_version`: scene reference present; payload, asset reference, manifest, and all artifact columns null;
- `export_artifact`: disposition is `final`; scene-version reference, reproduction manifest, object key, media type, byte size, and content digest are present; payload and asset-version reference are null. The manifest `sceneVersionId`, revision, and digest must match the referenced scene row. For `application/zip`, both pixel dimensions are null. For `image/png`, both are present and exactly match that scene/project canvas.

Required keys and FKs are:

- `UNIQUE (workspace_id, id)` and `UNIQUE (workspace_id, project_id, id)`;
- `UNIQUE (workspace_id, project_id, job_id, output_key)` to prevent duplicate checkpoint/final promotion across attempts;
- composite FK `(workspace_id, project_id, job_id)` to job;
- composite FK `(workspace_id, job_id, attempt_id)` to the creating attempt;
- composite FK `(workspace_id, project_id, asset_version_id)` to asset version when present;
- composite FK `(workspace_id, project_id, banner_scene_version_id)` to scene version when present;
- partial `UNIQUE (artifact_object_key)` where the key is non-null.

An artifact key is exactly `w/<workspace UUID>/p/<project UUID>/j/<job UUID>/o/<output UUID>/content`, built from server IDs and resolved under the same private storage root as assets. It is never user supplied, public, or placed in an `AssetVersion`. Artifact writes use exclusive/no-follow temporary creation, streaming byte limits, SHA-256 verification, atomic rename, and immutable read-back digest/size checks. The manifest scene identity equals the output's project-qualified scene FK; `sceneWorkflow` equals that scene row's resolved workflow ID/version/definition digest; `exportWorkflow` equals the owning export job's resolved workflow ID/version/definition digest; and manifest output media type, size, digest, and PNG dimensions equal the artifact columns exactly.

### `provider_usage`

| Column | Type and bounds | Mutability and meaning |
| --- | --- | --- |
| `id` | `uuid` | Immutable call record |
| `workspace_id` | `uuid` | Immutable ownership |
| `job_id` | `uuid` | Immutable composite FK to job |
| `attempt_id` | `uuid` | Immutable composite FK to the same job's attempt |
| `call_key` | `varchar(80)`, output-key syntax | Immutable idempotent step-call key within an attempt |
| `capability` | `text`: `vision_analysis`, `image_segmentation`, `image_inpainting`, or `fixture_replay` | Immutable bounded capability |
| `provider_key` | `varchar(100)`, 1–100 ASCII `/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/` | Immutable neutral identifier such as `fixture` |
| `model_key` | `varchar(160)`, 1–160 ASCII `/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/` | Immutable provider/model or fixture revision label |
| `workflow_version_id` | `uuid` | Immutable FK to the executing workflow |
| `external` | `boolean` | Immutable; always false in Phase 1A |
| `request_sha256` | `char(64)` | Immutable digest of validated adapter request, not raw private data |
| `response_sha256` | `char(64)` **nullable** | Set on a validated response |
| `status` | `text`: `started`, `succeeded`, `failed`, or `indeterminate` | Finalized once after start |
| `usage_metrics_json` | `jsonb` | Exact six non-negative integer keys described below |
| `estimated_cost_micros` | `bigint`, `0..9_000_000_000_000_000` | Immutable pre-call reservation |
| `actual_cost_micros` | `bigint` in same bounds **nullable** | Provider-reported/final known cost, when available |
| `currency` | `char(3)`, uppercase | Must equal job currency |
| `started_at` | `timestamptz` | Written before dispatch |
| `finished_at` | `timestamptz` **nullable** | Null only while status is started |
| `error_category` | `varchar(40)` **nullable** | Required for failed/indeterminate |
| `error_code` | `varchar(80)` **nullable** | Safe stable code |

`usage_metrics_json` is a closed object with required integer keys `calls`, `inputTokens`, `outputTokens`, `inputPixels`, `outputImages`, and `computeMs`. Each value is `0..9_000_000_000_000_000`; unsupported metrics are zero. Phase 1A fixture replay records one call and zero cost.

Keys are `UNIQUE (workspace_id, id)` and `UNIQUE (workspace_id, attempt_id, call_key)`. At most 64 rows may exist per job, enforced by the job counter and reservation lock. The row permits lifecycle finalization only: status, response digest, usage metrics, actual cost, finish time, and error may change once from their started values. It is never a customer charge or credit-ledger row.

## Referential and transactional invariants

- `workspace`, `project`, `asset`, `asset_version`, `banner_scene_version`, `generation_job`, `generation_attempt`, `generation_output`, and `provider_usage` are force-RLS protected. `workspace` is the root selected by `id`; the others are children selected by `workspace_id`.
- Composite FKs prevent cross-workspace and, where relevant, cross-job/cross-project references.
- An `AssetVersion` and `BannerSceneVersion` are append-only. Replacement creates the next version/revision under a row lock or equivalent unique-conflict retry.
- Scene insertion runtime-validates JSON, resolves every reference under the transaction's workspace context, canonicalizes it, verifies its digest, and inserts the scene plus any generation output atomically.
- Workflow versions referenced by jobs/scenes cannot be updated or deleted.
- A successful job's required final outputs, attempt success, job success, and progress 10,000 commit atomically. Previously committed checkpoints remain separate immutable rows. A job cannot be `succeeded` without every workflow-required final output.
- Provider usage is never deleted or rewritten to hide a failed/indeterminate call.

## Idempotency contract

The job idempotency scope is exactly `(workspace_id, operation, idempotency_key)`.

The idempotency key is supplied by the trusted command caller, validated against its syntax, and stored unchanged. The canonical request digest includes `commandVersion`, project ID, operation, workflow-version ID, each input asset-version ID and digest, and all operation parameters. It excludes the actor context, request trace ID, idempotency key, timestamps, and transport fields.

Creation behavior is exact:

1. Validate the command and all workspace-owned references before a job or usage row exists.
2. Canonicalize the request and compute `request_sha256`.
3. Insert the queued job under the unique idempotency constraint.
4. If no row exists, return the new job.
5. If the same scoped key already exists with the same request digest, return that existing job and its current/terminal result. Do not create another job, attempt, output, usage row, or cost reservation.
6. If the same scoped key exists with a different digest, return `IDEMPOTENCY_KEY_REUSED` as a conflict. Do not mutate the old job or create anything new.
7. Concurrent insert losers fetch the winning row and perform the same digest comparison.

Keys do not expire in Phase 1A. A terminal failure, cancellation, or budget stop is still returned for a duplicate same-payload request. An intentional new operation needs a new key.

## Job and attempt state machine

### Job transitions

| From | To | Exact trigger and transaction | Active-attempt result |
| --- | --- | --- | --- |
| creation | `queued` | Validated idempotent job inserted with progress 0 and attempt count 0 | No attempt |
| `queued` | `running` | Lease transaction creates the next attempt, sets first-start/deadline if absent, increments count, and sets progress at least 1 | New attempt is `running` |
| `queued` | `cancelled` | Cancellation commits before a lease | No attempt is created |
| `running` | `succeeded` | Current lease atomically inserts required final outputs, sets progress 10,000, and finalizes job | Current attempt becomes `succeeded` |
| `running` | `retry_wait` | Retryable provider/internal failure, timeout, or lease loss with attempts/deadline remaining | Current attempt becomes respectively `failed`, `timed_out`, or `abandoned` |
| `running` | `failed` | Non-retryable error, exhausted attempts, or deadline prevents retry | Current attempt becomes `failed`, `timed_out`, or `abandoned` according to cause |
| `running` | `cancelled` | A persisted cancel request predates completion; no new checkpoint/final output is committed | Current attempt becomes `cancelled` |
| `running` | `budget_stopped` | Cost/call reservation cannot proceed | Current attempt becomes `budget_stopped` |
| `retry_wait` | `running` | `next_attempt_at` arrives and deadline/cancellation/budget checks pass | New attempt is `running`; prior attempt remains terminal |
| `retry_wait` | `cancelled` | Cancel request is accepted before the next lease | No active attempt; prior attempt is unchanged |
| `retry_wait` | `failed` | Job deadline arrives before the eligible retry | No active attempt; prior attempt is unchanged |
| `retry_wait` | `budget_stopped` | Required reservation cannot fit before retry starts | No active attempt; prior attempt is unchanged |

`succeeded`, `failed`, `cancelled`, and `budget_stopped` are terminal and have no outgoing transitions. State updates use a row lock or compare-and-set on expected state plus current attempt lease token.

### Attempts, leasing, retry, and resumption

- Attempt 1 starts immediately when a queued job is leased. Retry attempts 2 and 3 wait exactly 1,000 ms and 5,000 ms respectively after the previous attempt finishes.
- A job has at most three attempts. There is no retry loop inside an attempt.
- Each attempt timeout is 120,000 ms. Each individual capability call receives the smaller of 60,000 ms, remaining attempt time, and remaining job time.
- Job wall-clock timeout is 600,000 ms from first attempt start, including retry waits.
- A lease lasts 30,000 ms and is renewed every 10,000 ms. Failure to heartbeat before expiry marks the attempt `abandoned` with `WORKER_LOST`; the job retries only if the normal attempt/deadline rules allow it.
- A timed-out attempt becomes `timed_out`. Timeout is retryable only when the operation's workflow marks its current step replay-safe, attempts remain, and the job deadline permits the next wait.
- Completed replay-safe steps may persist immutable checkpoint outputs under unique `output_key` values as specified below. A new attempt validates and reuses them rather than repeating completed work.
- A provider call left `started` after lease loss becomes `indeterminate`. Its estimate remains budget-reserved. It is repeated only in a new attempt when the capability is declared replay-safe and the adapter supplies an external idempotency key derived from job ID, step key, and logical call number; otherwise the job fails `PROVIDER_RESULT_INDETERMINATE`.

### Checkpoint and final-output semantics

Each `WorkflowVersion` declares every output key, kind, disposition (`checkpoint` or `final`), producing step, and replay-safety. A checkpoint may commit during an attempt only in a transaction that verifies the current lease token, job/attempt `running`, matching workspace/project/job, matching workflow version and definition digest, matching job request digest, and no committed cancellation request. The row and any referenced bytes are immutable once committed.

If a later step, attempt, or the job fails, a committed checkpoint remains for audit and may be reused by a later attempt of the same job. Before reuse, the executor verifies its output key/kind/disposition, job request digest, workflow ID/version/definition digest, referenced row or artifact identity, strict payload schema, and content digest. Any mismatch fails the job with `CHECKPOINT_IDENTITY_MISMATCH`; it is never overwritten or silently ignored.

Final user-visible outputs do not commit early. The successful terminal transaction verifies/stores every required final output, changes the current attempt to `succeeded`, changes the job to `succeeded`, and sets progress to 10,000 atomically. Already durable checkpoints are read inputs to that transaction, not recreated within it.

Bytes for the incomplete current step and staged final outputs are temporary. Failure, cancellation, timeout, lease loss, or a losing commit race deletes those temporary bytes immediately. Previously committed checkpoints remain immutable even when the job later becomes failed, cancelled, or budget-stopped; they are internal audit/recovery data and are not presented as final output.

### Cancellation race

Cancellation is cooperative for a running attempt. The command stores `cancel_requested_at` once and signals the local cancellation token. Queued/retry-wait jobs become cancelled immediately. A running worker must check cancellation before every capability call and before output promotion.

The terminal race is resolved by commit order:

- If `cancel_requested_at` commits before the worker's terminal transaction locks the job, cancellation wins; the attempt becomes cancelled, no further checkpoint or final output commits, and prior checkpoints remain unchanged.
- If success/failure commits first, the later cancel command returns the existing terminal state and does not rewrite it.
- A remote provider may continue after local cancellation. Its usage is still finalized or marked indeterminate; its current-call bytes and staged final bytes are deleted, while checkpoints committed before cancellation remain for audit.

### Progress

- Progress uses integer basis points and never decreases, including across retries.
- Queued starts at 0. Running is `1..9_999`. Only successful atomic output promotion sets 10,000.
- Failed, cancelled, and budget-stopped jobs retain their last progress below 10,000.
- Workflow step weights are immutable in `WorkflowVersion.definition_json` and sum to 10,000.
- The initial fake `banner.analyze` definition assigns cumulative completion at source load 1,000, fixture analysis 7,000, output validation 8,500, and atomic persistence 10,000. A retry reports the maximum prior progress rather than resetting it.

## Error taxonomy and retry policy

| Category | Examples | Retry rule |
| --- | --- | --- |
| `validation` | malformed command, unsupported image, invalid scene | Reject before job when possible; never retry |
| `not_found` | inaccessible project/asset/profile | Never retry; reveal no cross-workspace existence |
| `conflict` | idempotency-key reuse, stale revision | Never retry automatically |
| `policy_rejected` | prohibited input or capability | Never retry |
| `provider_transient` | explicit rate limit, temporary unavailability | Retry only for allowlisted codes and replay-safe step |
| `provider_permanent` | invalid provider request/model rejection | Never retry |
| `timeout` | capability or attempt deadline | Retry only under the bounded replay/deadline rule |
| `worker_lost` | expired lease/heartbeat | Retry under attempts/deadline rule |
| `budget_stop` | required estimate exceeds remaining limit | Terminal `budget_stopped`; never auto-raise budget |
| `cancelled` | authoritative cancel request | Terminal cancelled |
| `internal` | invariant/adapter defect | Non-retryable by default; only an explicitly classified `INTERNAL_TRANSIENT` is retryable |

Every error has a stable uppercase code, safe bounded message, category, retryable boolean, and cause available only in structured server logs. Raw upload bytes, provider responses, URLs with credentials, stack traces, and secrets never enter user-facing or persisted error messages.

## Provider usage, cost, and budget stops

Cost control is part of the call transaction, not a later reporting task:

1. A capability adapter returns a non-negative TypeScript `bigint` estimate in integer micros and an uppercase currency before dispatch.
2. The usage service rejects a currency unequal to the job currency with non-retryable `COST_CURRENCY_MISMATCH` before reservation or dispatch. It then locks the job, verifies it is running with the current attempt/lease, and checks cancellation.
3. It computes committed cost exactly as `sum(actual_cost_micros when known, otherwise estimated_cost_micros)` over all job usage rows, including failed and indeterminate calls. PostgreSQL performs exact `bigint`/`numeric` aggregation; the returned canonical decimal string is bounds-checked and converted directly to TypeScript `bigint`, never `number`.
4. If the next call would exceed 64 calls or `committed + nextEstimate > budget_limit_micros`, no usage row or external call is created. The attempt and job become `budget_stopped` with `PROVIDER_CALL_LIMIT_EXCEEDED` or `BUDGET_LIMIT_EXCEEDED`. Equality with the money limit is allowed.
5. Otherwise, the same locked transaction increments `provider_call_count` and commits a `provider_usage` row with status `started`, estimate, request digest, and unique attempt/call key before adapter dispatch.
6. The adapter is invoked only after that commit. Duplicate call-key creation returns the existing record and does not increment or invoke twice.
7. Success finalizes response digest, metrics, actual cost when reported, and `succeeded`. A classified adapter failure finalizes `failed`. Loss of a trustworthy result finalizes `indeterminate`.
8. Actual cost is recorded even when it exceeds the estimate or job limit; accounting is never clipped. No subsequent call may start when its estimate would exceed the remaining budget.

All micros crossing JSON, configuration, or database-driver boundaries use canonical unsigned decimal strings (`0` or `/^[1-9][0-9]*$/`), are parsed directly to `bigint`, and are range-checked before arithmetic. Invalid syntax, negative values, fractional values, currency mismatch, and overflow fail closed before a reservation. With at most 64 rows of at most `9_000_000_000_000_000` micros, the maximum aggregate is `576_000_000_000_000_000`, below PostgreSQL signed-`bigint` maximum; every addition is nevertheless checked against the declared bounds.

Phase 1A sets an independent `externalCallsAllowed = false` composition policy in addition to a zero budget. Fake fixture calls create usage rows with `external=false`, provider `fixture`, model/fixture revision, `calls=1`, and estimated/actual cost zero. Enabling a real adapter requires code/configuration reviewed in the later benchmark milestone; an environment variable alone cannot bypass the hard-disabled composition.

Provider cost has no conversion to customer credits. There is no customer balance, charge, entitlement, subscription, or double-charge path in this model.

## Named bounded ports

These interfaces are owned by the application/core side; outer adapters implement them. Signatures use branded IDs, validated values, immutable references, `Uint8Array`/bounded byte sources, injected clock/deadline/cancellation values, and structured errors only.

| Port | Bounded responsibility | Must not expose |
| --- | --- | --- |
| `ActorWorkspaceContextResolver` | Resolve the configured development actor/workspace and request ID at the server boundary; verify workspace before constructing context | Client workspace fields, Next session/request types, auth SDK values |
| `WorkspaceRepository` | Workspace-scoped existence and development-label operations under RLS | Unscoped `findById`, membership/auth concepts |
| `ProjectRepository` | Workspace-qualified Banner project creation/read/archive and immutable canvas | Route inputs or ORM rows |
| `AssetRepository` | Allocate logical assets/versions, resolve immutable metadata/digests, enforce project ownership | Bucket URLs, mutable latest bytes |
| `AssetStoragePort` | Atomically put/get exact bytes by generated logical object key and digest; private local fake first | User paths, signed/public URLs, vendor SDK types |
| `ExportArtifactStoragePort` | Atomically stage/promote/read immutable ZIP or PNG export bytes by GenerationOutput artifact key, size, and digest | Raster `AssetVersion`, public URLs, user paths, vendor SDK types |
| `BannerSceneRepository` | Strict parse, reference resolve, revision allocation, canonical digest, immutable scene persistence | Raw unchecked JSON or framework state |
| `WorkflowVersionRepository` | Resolve an explicit immutable product workflow and validate definition digest | Generic prompts, provider SDK configuration |
| `BannerCompositionAnalysisPort` | Convert one validated source asset reference into a strict 1–5-part composition proposal or structured `no_useful_layers` result | Free-form agent runner or raw provider response |
| `BannerLayerExtractionPort` | Extract one identified proposal part into bounded normalized PNG bytes | Arbitrary image commands or provider types |
| `GenerationJobRepository` | Atomic idempotent creation, state CAS, cancellation, progress, lease and output promotion | Queue-vendor messages or unscoped job reads |
| `WorkflowExecutorPort` | Execute the explicit versioned Banner steps, deadlines, cancellation, resume, and output keys | Autonomous loops or arbitrary tools/prompts |
| `ProviderUsageRepository` | Pre-call reservation and once-only finalization with integer cost/metrics | Customer credits or floating money |
| `CostBudgetPort` | Evaluate exact committed-plus-estimate rule under job lock | Automatic budget increases or billing entitlements |
| `BannerExporterPort` | Deterministically export a persisted scene/assets for one closed export profile and emit a reproduction manifest | User HTML/CSS/JS, remote dependencies, framework response types |
| `GdnValidationPort` | Validate package bytes against one resolved profile/rules digest and return rule-coded findings | Network validation, mutable “latest” rules, unsupported compliance claims |

The composition root wires local/fake adapters. Domain and application modules import none of Next.js, React, Drizzle, PostgreSQL clients, Supabase, Makerkit, Stripe, provider SDKs, storage SDKs, or queue SDKs.

## Upload and normalized-asset security boundary

Phase 1A's validator is transport-independent and accepts exactly one bounded byte stream plus declared filename and MIME metadata. No URL ingestion exists.

### Initial hard limits

- Accepted filename extensions are `.jpg`, `.jpeg`, and `.png`, case-insensitive.
- Declared MIME is required and exactly `image/jpeg` or `image/png`; extension, magic bytes, decoder result, and declared MIME must agree.
- Encoded input is at most `20_971_520` bytes. Streaming intake stops and rejects as soon as the next chunk would exceed the limit; `Content-Length` is not trusted.
- Decoded width and height are each `1..4_096`; decoded area is at most `16_777_216` pixels and RGBA allocation at most `67_108_864` bytes.
- A decoder must consume a complete valid image and reject truncation, invalid chunk/marker structure, contradictory dimensions, decompression bombs, or trailing executable/polyglot content it cannot account for.
- PNG containing an `acTL` chunk is APNG and is rejected regardless of frame count. Static interlaced PNG and progressive JPEG are accepted only after complete decode within limits.
- Total ancillary/metadata payload before stripping is at most `1_048_576` bytes. Larger EXIF, XMP, IPTC, ICC, PNG text, comment, or unknown ancillary data is rejected.
- Filename display metadata is NFC plain text, 1–120 Unicode code points and at most 255 UTF-8 bytes. It rejects NUL/control/bidi override characters, `/`, `\\`, a value equal to `.` or `..`, and any path component. It is escaped on display and never used as an object key.
- Exactly one decoded source is accepted per command. Archives and nested files are never opened.

### Decode and normalization sequence

1. Apply streaming byte and metadata-length limits into a private temporary file or bounded memory buffer.
2. Sniff magic and parse using a memory-safe, maintained decoder selected and version-pinned at the dependency gate.
3. Fully decode before persistence; apply valid EXIF orientation, convert pixels to sRGB, and discard EXIF, GPS, XMP, IPTC, comments, text chunks, embedded thumbnails, profiles, and original path metadata.
4. Deterministically re-encode the sanitized pixels as a static PNG with no ancillary metadata. Enforce the 20 MiB encoded limit again; reject `SANITIZED_FILE_TOO_LARGE` rather than storing oversized output.
5. Compute SHA-256 over the sanitized bytes, allocate the immutable version, and atomically write to its server-generated object key.
6. Remove the temporary/raw upload immediately on success or failure. Raw input is never an `AssetVersion` in Phase 1A.

Therefore a JPG is accepted as input but the persisted normalized source may be `image/png`. The persisted asset reference describes the normalized bytes, not the browser declaration. This avoids retaining private EXIF/GPS data and gives downstream fakes one decoded format.

The local storage root is outside `public/`, mode `0700`; content files are `0600`. Writes use a same-directory temporary file, exclusive/no-follow semantics, digest verification, atomic rename, and cleanup. Reads reject absolute paths, traversal, symlinks, non-regular files, key/root escape after canonical resolution, size changes, and digest mismatch.

## Preview and generated-package isolation boundary

Phase 1A defines and unit-tests the policy; the first browser preview is implemented in Phase 2 and must follow it.

- HTML previews run in an iframe with only `sandbox="allow-scripts"`. `allow-same-origin`, forms, popups, top navigation, downloads, modals, pointer lock, and storage access are absent.
- Preview content has a unique opaque origin and never executes in the application document. The application never inserts generated markup with main-origin `innerHTML`.
- The preview CSP is at least: `default-src 'none'; img-src blob: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`.
- Package assets are verified local bytes exposed only as bounded blob/data URLs. There are no remote images, fonts, imports, stylesheets, scripts, fetch/XHR/WebSocket calls, frames, plugins, or service workers.
- The single-exit destination is inert in preview; click navigation is intercepted and reported as an `exit` event without a URL. The parent derives the already validated destination from the scene it loaded and never trusts a child-supplied destination.
- The iframe-to-parent message union is exactly:

```ts
type PreviewChannelNonce = string; // 32 lowercase hex characters: /^[0-9a-f]{32}$/
type PreviewMessageV1 =
  | { type: "ready"; nonce: PreviewChannelNonce }
  | { type: "progress"; nonce: PreviewChannelNonce; progressBps: number }
  | { type: "error"; nonce: PreviewChannelNonce; code: string; message: string }
  | { type: "exit"; nonce: PreviewChannelNonce };
```

- Every object is strict and JSON-serializable. `progressBps` is an integer `0..10_000`; `code` is 1–80 ASCII matching `/^[A-Z][A-Z0-9_]{0,79}$/`; `message` is 1–500 NFC Unicode code points with no control/bidi override characters. The serialized object is at most 65,536 UTF-8 bytes. `ready` and `exit` have exactly two keys, `progress` exactly three, and `error` exactly four.
- The parent verifies `event.source === iframe.contentWindow`, the exact fresh cryptographically random 128-bit nonce, keys/types/bounds, and never evaluates message strings. Opaque-origin `event.origin` alone is not trusted. Unknown, malformed, oversized, wrong-source, or wrong-nonce messages are ignored and safely logged by code only.
- Static images are decoded and dimension/MIME checked before display through an object URL, which is revoked on replacement/unmount.
- Exported ZIPs are never unpacked into the application public directory. Inspection accepts at most 256 entries; archive/compressed bytes at most `52_428_800`; total declared and actually streamed uncompressed bytes at most `104_857_600`; and each entry at most `52_428_800` uncompressed bytes. Each name must decode as strict UTF-8, already be NFC, occupy at most 240 UTF-8 bytes, contain 1–16 nonempty `/`-separated components, and contain no absolute prefix, drive prefix, NUL, `.`/`..` component, or backslash. Normalized names must be unique.
- ZIP64, encryption, symlink, device, socket, FIFO, and other special entries are rejected. For each entry with compressed size greater than zero, `uncompressed_size / compressed_size` must be at most `100`; compressed size zero is accepted only when uncompressed size is also zero and is treated as ratio zero. Limits are enforced against actual streamed compressed and uncompressed bytes, not trusted headers; crossing a limit aborts and deletes temporary output. Remote dependencies remain prohibited.

These controls apply even to deterministic generated output. They are not weakened if a future provider supplies part of an artifact.

## Prospective Phase 1A file and package map

Names may be adjusted only to existing conventions discovered at implementation start; responsibilities and dependency direction are frozen. Every listed directory is created with real implementation or tests, never as a placeholder.

```text
package.json
pnpm-workspace.yaml
pnpm-lock.yaml                         # only after authorized resolution
tsconfig.base.json
eslint.config.*
prettier.config.*

apps/web/
  package.json
  src/app/                             # minimal runnable host, no product UI breadth
  src/server/composition.ts
  src/server/context/development-context-resolver.ts
  src/server/adapters/local-asset-storage.ts
  src/server/adapters/in-process-job-runner.ts

packages/banner-ai/
  package.json
  src/context/actor-workspace-context.ts
  src/scene/banner-scene-v1.schema.ts
  src/scene/canonical-scene-json.ts
  src/jobs/job-state.ts
  src/jobs/errors.ts
  src/ports/*.ts
  src/workflows/provider-free-analysis.ts
  src/security/raster-upload.ts
  src/security/preview-policy.ts
  test/fixtures/scenes/*.json
  test/fixtures/images/*
  test/fixtures/analysis/*.json
  test/**/*.test.ts

packages/db/
  package.json
  drizzle.config.ts
  src/schema/*.ts
  src/repositories/*.ts
  drizzle/0001_provider_free_foundation.sql
  test/**/*.integration.test.ts
```

There is no `billing`, `auth`, `ai-core`, `jobs`, `storage`, `domain`, `ui`, or test-support package in Phase 1A. Shared modules are extracted later only when a real second consumer justifies them. Fakes remain beside the tests or adapter composition they support.

The one prospective migration creates the exact tables, checks, composite FKs, indexes, RLS policies, and runtime/migration role separation described here. It contains no production users, memberships, subscriptions, entitlements, customer credits, teams, or seats. The SQL is generated only after the schema implementation exists, reviewed as text, and applied only to an explicitly approved disposable local database.

## Fixtures and fake adapters

All fixtures are synthetic, sanitized, and committed only after inspection:

- the canonical angel `BannerSceneV1` and targeted invalid mutations from its invalid-case matrix;
- tiny valid normalized JPG/PNG inputs created for the project with no real person, brand, EXIF, or hidden payload;
- APNG, truncation, dimension-bomb header, excessive-metadata, MIME/extension mismatch, traversal-name, and digest-mismatch rejection fixtures;
- a strict fake composition proposal with background, body, left wing, and right wing;
- deterministic transparent PNG extraction bytes with fixed SHA-256 values;
- fake transient, permanent, timeout, cancellation, worker-loss, indeterminate, and budget estimates;
- deterministic fake ZIP/PNG export artifacts, exact reproduction manifests with scene/export workflow provenance, and validator findings clearly labeled internal/non-GDN;
- safe and rejecting ZIP fixtures covering every entry/byte/path/ratio/ZIP64/encryption/special-entry bound.

Fake clocks, UUID sequences, cancellation signals, and storage roots are injected. Tests assert exact objects and digests rather than updating broad snapshots. No fixture contains a provider key, production URL, private/customer data, copyrighted campaign asset, or unsanitized provider response.

## Test and verification plan for Phase 1A

### Unit tests

- Parse the canonical scene and every invalid-case class; prove strict unknown-key and no-coercion behavior.
- Verify canonical JSON/digests, normalized-PNG canonical source, repeated asset-reference equality, immutable version selection, both manifest workflow references, artifact equality, and pure upcaster harness behavior.
- Exhaustively test every job transition and its exact attempt-state mapping; reject every other pair.
- Test progress monotonicity, step weights, exact retry delays, attempt/job/call timeouts, lease expiry, heartbeat, and three-attempt ceiling with a fake clock.
- Trace same-key/same-digest, same-key/different-digest, concurrent winner/loser, and duplicate terminal requests.
- Trace cancel-before-lease, cancel-during-call, cancellation/checkpoint/final race in both commit orders, prior-checkpoint retention, staged-byte cleanup, and duplicate cancellation.
- Trace transient provider recovery, permanent provider failure, timeout retry, worker-loss resumption, and indeterminate non-replay-safe failure.
- Verify usage row exists before fake dispatch, is finalized for success/failure/indeterminate, rejects duplicate call keys, enforces 64 calls, uses exact `bigint` micros/decimal serialization, rejects currency mismatch/overflow, and remains separate from credits.
- Test budget equality, over-limit/call-limit pre-dispatch stop and `budget_stopped` attempt mapping, actual-over-estimate recording, and subsequent stop.
- Test every upload limit, APNG rejection, metadata stripping, orientation, sRGB normalization, deterministic PNG digest, filename/path rejection, storage traversal/symlink/digest defenses, and raw-temp cleanup.
- Validate every preview message variant including URL-free exit, sandbox/CSP/nonce/source checks, all ZIP numeric/path/ratio/format limits, streaming enforcement, and remote-dependency rejection.
- Prove core source imports no framework, auth, billing, database, provider, queue, or storage-vendor package.

### Persistence integration tests

- Apply the forward migration to an approved disposable local PostgreSQL database from empty state.
- Verify all checks, unique keys, project-qualified asset/output FKs, artifact variants, disposition constraints, and immutable repository behavior.
- With runtime credentials, prove the parameterized transaction-local setting resolves the root workspace; missing/malformed settings deny root and child access; workspace A cannot read/write/reference workspace B; migration credentials are absent from application configuration.
- Verify scene revision allocation, same-project parent/output references, both exact manifest workflow refs, immutable checkpoint commits, and atomic final-output/job success.
- Race idempotent creation, attempt leasing, checkpoint commit/reuse, cancellation, final output promotion, artifact-key allocation, and version allocation in separate connections.
- Verify RLS remains active for table-owner edge cases by using the non-owner runtime role and `FORCE ROW LEVEL SECURITY`.
- Confirm provider usage and terminal jobs cannot be silently removed or rewritten through repositories.

### Local verification commands

Exact script names will be defined in the root manifest. The required sequence is:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test
```

After the authorized install, these commands run with provider/network environment variables absent and external calls hard-disabled. No Playwright suite is added until Phase 2 has a real browser flow. Phase 0A makes no executable-test claim.

### CI policy

There is currently no Git repository or CI system. A CI workflow is therefore not created by Phase 0A and is gated on explicit Git/CI authorization. When authorized, CI will use the pinned Node/pnpm policy and frozen lockfile, run the same checks against a disposable PostgreSQL service, expose no provider/payment secrets, and keep test execution provider-free. Checkout/action downloads, dependency-cache access, package installation, and database service images are network actions and must be approved as such.

## Phase 1A acceptance criteria

Phase 1A is complete only when all of the following are evidenced:

1. Authorized dependency resolution records and pins exact compatible Node, pnpm, direct dependency, and lockfile versions without claiming the host's tools as project policy.
2. Runtime `BannerSceneV1` parsing implements the product contract exactly, and its canonical example plus invalid matrix pass provider-free tests.
3. Only packages with real code/tests exist; dependency checks demonstrate the inward architecture and forbidden imports are absent from core.
4. Development context is created solely from server configuration. Services and repositories cannot accept client workspace authority.
5. The reviewed additive migration expresses every entity, bound, unique key, project-qualified FK, artifact/disposition variant check, and root/child forced-RLS policy in this plan.
6. Parameterized context setup resolves the protected workspace root; missing/malformed context and cross-workspace read, write, reference, job, usage, scene, and output operations fail closed under the runtime role.
7. Asset bytes are fully decoded, normalized, metadata-stripped, immutable, content-address-verified, privately stored, and covered by malicious/limit fixtures.
8. Workflow, scene, and raster asset versions are immutable; every manifest resolves exact scene/export workflows; ZIP/PNG artifacts live only on immutable final GenerationOutput rows and match manifest/object bytes.
9. The success path traces `queued -> running/attempt 1 -> required final outputs + attempt succeeded + job succeeded` atomically, with progress 10,000 and one zero-cost usage record committed before fake dispatch.
10. The retry path traces transient attempt 1 `failed`, exact 1,000 ms wait, attempt 2 checkpoint verification/reuse, no duplicate output/call, and success; timeout and lease-loss map to `timed_out`/`abandoned`.
11. Queued and running cancellation paths obey commit order, map active attempt to `cancelled`, retain earlier checkpoints, delete current/staged bytes, make no later attempt, and expose no final losing output.
12. Same-key/same-payload concurrent calls return one job; same-key/different-payload returns `IDEMPOTENCY_KEY_REUSED` with no new attempt, usage, or cost.
13. Permanent provider failure is terminal and a retryable provider failure never exceeds three attempts or the ten-minute deadline.
14. Budget/call stops occur before dispatch, map an active attempt to `budget_stopped`, never raise limits, enforce currency and 64-call bounds, and keep exact `bigint` actual/estimated costs independent of customer credits.
15. Lease loss and timeout preserve verified committed checkpoints, delete incomplete bytes, and either resume through a new bounded attempt or fail explicitly when replay is unsafe.
16. Preview tests enforce opaque sandboxing, the exact four-message union with URL-free exit, every numeric ZIP limit/path/ratio rule, streaming enforcement, and zero remote dependencies.
17. Default verification completes with no API key, provider/network call, GPU, hosted service, payment, private data, snapshot update, or paid cost.
18. No SaaS starter, production auth, billing, subscriptions, entitlements, customer credits, teams, seats, or deferred Banner feature is present.
19. Required format, lint, type, unit, and approved local database integration checks pass; failures are reported rather than waived.
20. The completion report lists exact files, migration evidence, commands/results, remaining risks, and every still-closed external gate.

## Retention and deletion policy

Phase 1A uses synthetic local development data only and performs no automated deletion of persisted workspaces, projects, immutable asset versions, scenes, jobs, attempts, outputs, workflows, or provider usage. Idempotency keys therefore do not expire. Archive fields hide mutable containers without deleting their history.

Raw upload temporary files are the exception: they are removed immediately after normalization succeeds or fails. Incomplete-step and staged-final temporary files are removed immediately after failure, cancellation, lease loss, or a losing commit race. Previously committed checkpoint rows/bytes remain immutable for audit and same-job recovery. Cleanup is restricted to the known temporary root and never follows symlinks.

Physical deletion, retention expiry, database pruning, storage lifecycle rules, and customer erasure are deferred. Before any real evaluator/customer data is accepted, a privacy/retention decision must define time periods, legal/product obligations, export/audit needs, deletion propagation, backups, provider deletion, and recovery. Any destructive migration or physical purge requires an explicit irreversible-operation approval and tested rollback/restore plan.

## Additive migration policy

- Never edit an applied migration. Every schema change receives a new forward migration and review.
- Add nullable columns or tables first, backfill through a bounded resumable operation, validate, and only then tighten constraints in a later migration.
- New scene/workflow/export/validator semantics use explicit versions and pure upcasters; JSON is never silently reinterpreted in place.
- Destructive column/table drops, type narrowing, bulk rewrites, identifier changes, and asset deletion are not part of Phase 1A.
- Migration SQL is inspected for locks, scans, defaults, RLS behavior, and rollback/recovery before application.
- A migration is applied first to a disposable local database from empty state and, when relevant later, to a sanitized production-shaped copy. Hosted or production application is never inferred from plan approval.

## Future GDN evidence gate

No current GDN constraints are asserted in Phase 0A. Before implementing or labeling a validator profile as authoritative, Sol and Terra must perform an explicitly authorized network review of primary Google Ads documentation applicable to the intended market/account and record:

- direct authoritative source URLs, access date, and scope;
- permitted dimensions, package/file limits, entry-point and asset rules;
- animation, loop/duration, click/exit, external-dependency, and prohibited-content requirements;
- ambiguous or account-specific rules requiring an approved test upload;
- a versioned internal rule list, fixtures, and `rulesSha256` tied to the source evidence;
- update monitoring and the behavior when the authoritative source changes.

Only exports passing that frozen profile may be called GDN-valid. A network lookup, Google account upload, external validator, or campaign submission is a separate authorization/privacy/deployment gate; Phase 1A's fake validator must be labeled non-GDN.

## Future quantitative product-gate decision

The brief's “meaningful percentage” is not silently converted into a success claim. Before Phase 3 invokes a real provider or evaluates product readiness, an approved benchmark record must freeze numeric thresholds for:

- sanitized corpus size, difficulty strata, and exclusion rules;
- useful-layer rate and independent human scoring rubric;
- median and high-percentile runtime;
- maximum estimated cost per successful banner in one named currency;
- failure rate by workflow step and overall recovery rate;
- export validator first-pass/final-pass rates;
- manual-correction rate and what counts as correction;
- maximum calls, images, wall-clock time, and integer-micro budget for the benchmark;
- automatic stop conditions and the rule for inconclusive results.

Those values require product/economic evidence and user approval; they are not Phase 1A-critical and are not fabricated here. Passing them authorizes planning the SaaS-shell decision only, not purchasing a template, deploying, billing, or onboarding users.

## Authorization gates

Approval of Phase 0A does not clear any item below:

| Gate | Explicit authorization required before |
| --- | --- |
| Network/dependency | Registry lookup, package metadata/security lookup, download, `pnpm install`, Corepack download, or lockfile creation based on network results |
| Git/CI | Git initialization, remote creation, commit, push, pull request, CI workflow activation, action/image download, or external cache use |
| Database/migration | Creating a database/role, generating or applying migration SQL, starting/downloading a database container, or touching hosted/production data |
| Paid/provider | Any AI/GPU/provider call, external validator, paid benchmark, account upload, or nonzero budget |
| Privacy | Sending any asset to a third party, using private/customer data, retaining real evaluator data, or enabling telemetry/error reporting containing user data |
| Deployment/network service | Hosted database/storage/queue/monitoring, DNS, preview hosting, email, deployment, or public endpoint |
| GDN research | Network retrieval of authoritative rules or submission to a Google account/service |
| SaaS shell | Purchasing, cloning, adopting, or merging a starter; auth/billing/credit/team implementation |
| Irreversible operation | Destructive migration, bulk rewrite, physical asset/database deletion, retention purge, or secret/key rotation affecting external state |

At every gate, the request must state scope, cost/budget, data exposure, rollback, and verification. Silence or approval of an adjacent milestone is not authorization.

## Phase 1A completion handoff

After a separately approved implementation, Luna reports exact created/changed files and commands; Terra performs a read-only acceptance review against this frozen plan; Sol reconciles findings and closes the milestone. Any change to ownership, persistence semantics, scene behavior, cost/privacy boundary, or external gate requires plan/ADR review before implementation rather than an undocumented deviation.
