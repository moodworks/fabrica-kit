# Implementation plan 0002: Provider-free editor, isolated preview, and validated export

- Status: Proposed product plan; implementation is not authorized by this document
- Planning milestone: Phase 2A planning
- Prospective implementation milestone: Phase 2A provider-free vertical-slice completion
- Date: 2026-07-26
- Depends on: [ADR 0001](../decisions/0001-banner-ai-validation-architecture.md),
  [Implementation plan 0001](./0001-provider-free-foundation.md), and
  [BannerSceneV1](../product/banner-scene-v1.md)

## Decision and outcome

The next product milestone is one provider-free Banner editor-and-export slice built around the
existing approved Angel fixture and the accepted `BannerSceneV1` contract. A development user can
open the fixture as a local Banner project, inspect real fixture thumbnails, save inclusion and
visibility edits, apply one controlled animation preset, see the resulting scene in the accepted
opaque-origin preview boundary, export one deterministic HTML5 ZIP, inspect actionable internal
validation findings, reload the page without losing the last accepted scene revision, and retry an
expected preview or export failure without rebuilding the project.

This milestone closes the smallest coherent user-visible gap. It does not improve model quality,
resume the terminated SAM assurance lane, or introduce production infrastructure. The output and
validator remain explicitly labeled `internal-provider-free-not-gdn`; they do not claim current
Google Display Network compliance.

The implementation must reuse the current scene parser/canonicalizer, fixture analysis evidence,
export manifest, bounded ZIP inspector, exporter port, validator port, and preview isolation policy.
It must not build parallel scene, renderer, validator, or export contracts.

## Repository and product baseline

The last completed user-facing product milestone is commit
`4c7c85b99db87f5c4009caf55d708a56615b6cea` (`feat(banner-ai): add interactive
fixture layer panel`), following the provider-free web UI in
`eff334784e9180c0319cf028c7794293d9cd58ec`. Later benchmark and SAM commits added evaluation or
provider machinery, not a completed Banner editor/export workflow.

The implemented flow on `main` is currently:

1. `/banner-ai` accepts one local JPG or PNG and performs browser-side filename, type, size, decode,
   and dimension checks.
2. `POST /api/banner-ai/analyze` revalidates and normalizes the bytes on the server, resolves the
   fixed development actor/workspace context, and invokes the exact zero-cost, network-disabled
   fixture proposal.
3. The UI displays the normalized source identity, four named proposal parts, a selected bounds
   rectangle, and independent in-memory selection/inclusion/visibility controls.
4. The UI truthfully states that the parts are not extracted assets or a `BannerSceneV1` and that a
   refresh discards the selection and review state.

Reusable implementation already present:

- `packages/banner-ai/src/scene/banner-scene-v1.schema.ts` implements the complete accepted scene,
  layer, transform, controlled-preset, timeline, interaction, and export-settings contract.
- `packages/banner-ai/src/scene/canonical-scene-json.ts` and
  `export-reproduction-manifest-v1.schema.ts` provide canonical scene digests and exact export
  provenance.
- `packages/banner-ai/src/evaluation/repository-benchmark-fixture.ts`, `benchmark-case.ts`, and the
  provider-free fixture adapters provide an approved, local, zero-cost source and named bounds.
- `packages/banner-ai/src/export/deterministic-fake-exporter.ts` already produces deterministic,
  inspected ZIP/PNG artifacts, fixed ZIP metadata, and an explicit non-GDN label. Its current HTML
  runtime is only a placeholder and does not render the scene.
- `packages/banner-ai/src/export/zip-inspector.ts` enforces the accepted archive, entry, path,
  compression, executable-content, and remote-dependency boundary.
- `packages/banner-ai/src/ports/banner-capability-ports.ts` already owns the exporter and internal
  validator contracts and exact artifact/profile binding.
- `packages/banner-ai/src/security/preview-policy.ts` freezes the opaque iframe sandbox, CSP, nonce,
  source, message, and size rules. No browser iframe uses it yet.
- `apps/web/src/features/banner-ai/banner-ai-layer-state.ts` and
  `banner-ai-status-panel.tsx` already establish accessible native selection, inclusion, and
  visibility interaction patterns.
- There is no project/scene repository implementation, browser project persistence, scene
  renderer, validator adapter, preview UI, export route, download UI, or browser end-to-end suite.
  `packages/db` contains package configuration only.

## Ten-outcome gap matrix

| #   | Required product outcome                                           | Current status and repository evidence                                                                                                                                                 | Phase 2A closure                                                                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Open or create a Banner project from an approved fixture or replay | **Partial.** `banner-ai-client.tsx` and `local-fixture-analysis.ts` accept/analyze a source, but create no project or scene. The UI's persistence note says refresh discards the work. | Add one fixed development-local Angel fixture project, opened without provider access and represented by a strict local project envelope containing accepted scene revisions.                                                                                                                  |
| 2   | Inspect proposed layers with useful thumbnails and names           | **Partial.** `banner-ai-status-panel.tsx` shows names, roles, and bounds; `banner-ai-source-image.tsx` shows one source overlay. No layer asset or thumbnail exists.                   | Materialize deterministic local visualization assets from the approved fixture, display a bounded thumbnail for the background and each foreground layer, and retain the existing plain-text names. Label these as provider-free fixture visualizations, not segmentation-quality evidence.    |
| 3   | Select, include/exclude, and show/hide layers                      | **Partial.** `banner-ai-layer-state.ts` implements all three controls only as proposal-review intent.                                                                                  | Apply the same native-control semantics to the accepted scene draft. Inclusion and visibility update their exact `BannerSceneV1` fields; background inclusion maps only between the fixed solid and transparent background variants.                                                           |
| 4   | Reorder or rename only when supported and necessary                | **Contract support, no current UI, not needed.** `BannerSceneV1` already validates names and contiguous order, but the current panel exposes neither operation.                        | Preserve the fixture's canonical names and order. Do not add rename or reorder controls in this slice.                                                                                                                                                                                         |
| 5   | Apply at least one controlled animation preset                     | **Foundation only.** The scene schema and Angel semantic fixture cover closed presets, but web state has no timeline event or preset control.                                          | Offer exactly one versioned `Gentle float` preset for a selected foreground layer. It creates at most one deterministic, sorted track and can be cleared or moved to another layer. No arbitrary timing or keyframe input is accepted.                                                         |
| 6   | Preview `BannerSceneV1` in isolation                               | **Foundation only.** `preview-policy.ts` is tested, but web source contains no iframe or scene renderer.                                                                               | Render the server-validated scene and allowlisted fixture assets in an iframe with exactly `sandbox="allow-scripts"`, the frozen CSP, fresh nonce, exact source checks, and no same-origin or network capability.                                                                              |
| 7   | Generate the existing deterministic HTML5/GDN-oriented export      | **Foundation only.** The existing deterministic exporter emits stable inspected ZIPs, but its runtime displays fixed placeholder text and has no product route.                        | Reuse and complete the existing exporter so the fixed trusted runtime renders the validated scene and packaged local assets. Expose one user-triggered, bounded HTML5 ZIP download.                                                                                                            |
| 8   | Run the existing validator and show actionable results             | **Contract only.** The strict validator request/result schemas and ZIP inspector exist; no adapter or UI invokes them.                                                                 | Implement the internal provider-free validator behind the existing port, bind it to one immutable internal profile/rules digest, and show pass/fail plus ordered rule-coded findings. Always state that this is not authoritative GDN validation.                                              |
| 9   | Reopen without losing accepted scene state                         | **Missing.** State is React memory and is deliberately discarded on refresh.                                                                                                           | Persist only the strict local project envelope and canonical scene revisions in browser storage. Revalidate every revision, digest, parent link, fixture identity, and allowlisted asset reference before reopening. Fixture bytes stay server-owned and are not persisted in browser storage. |
| 10  | Recover from an expected workflow or export failure                | **Partial.** Upload and analysis errors are visible and retryable, but there is no accepted scene to preserve and no preview/export recovery.                                          | Preview/export failures retain the accepted scene, draft, selected layer, and last safe validation result. A retry repeats the exact scene digest. Corrupt saved data fails closed with an explicit, user-confirmed reset-to-fixture action.                                                   |

## Bounded milestone scope

### 1. One provider-free fixture project

The slice supports exactly one project kind and one fixture identity. A server-only materializer uses
`createAngelBenchmarkFixtureSourceV1("png")` and the accepted Angel proposal labels/bounds. It may
use the already-pinned `sharp` dependency to deterministically scale/crop the synthetic fixture into
metadata-free foreground visualization PNGs and one background thumbnail. The canvas uses a fixed
solid background, with transparent as the only background-excluded alternative.

The materializer must:

- accept no user path, URL, bytes, prompt, provider response, or asset identifier;
- assign fixed server-owned project, asset, workflow, exporter, and validator identities;
- use a 300-by-200 canvas (the fixture's exact 12:8 aspect ratio), a fixed opaque solid background
  when the background is included, and the transparent background variant when it is excluded;
- use `gdn-html5` export settings bound to the exact internal validator profile and the canonical
  fixture-only single exit `https://example.com/campaign`, while retaining the explicit non-GDN
  product label;
- normalize and revalidate every generated PNG through the existing raster boundary;
- compute and pin the exact resulting asset and base-scene digests in direct tests;
- return a valid `BannerSceneV1` whose layers use the proposal names/bounds and canonical order;
- keep the result clearly labeled as a fixture visualization rather than a cutout-quality claim;
- expose thumbnails only as bounded local data/blob URLs and never embed a path in scene data.

The current arbitrary local upload/fixture-proposal screen remains available and truthful. The
editor is entered through an explicit **Open approved demo project** action; it does not pretend an
arbitrary uploaded banner has been extracted.

### 2. Scene edits and one closed preset

The editor draft is always a successfully parsed `BannerSceneV1`. The only supported mutations are:

- select one background/layer row as UI state;
- toggle foreground `included`;
- toggle foreground `visible` independently of inclusion;
- toggle the fixed background between its exact solid and transparent variants;
- apply or clear one exact `Gentle float` track on one selected foreground layer.

`Gentle float` is version 1 with fixed parameters: `axis: "y"`, `distancePx: -6`, `startMs: 0`,
`durationMs: 1_200`, `iterations: 2`, `iterationMode: "alternate"`, and
`easing: "ease-in-out"`. Its deterministic track ID derives only from the allowlisted layer ID and
preset version. Applying it to another layer replaces the prior demo track; the timeline contains
at most one track and is stored in the accepted tuple order.

Every edit constructs a new value and reruns the scene parser. Invalid output is an internal error;
it is not clamped or silently repaired. Names, order, frames, transforms, opacity, asset references,
export settings, interaction, and all other timeline values are immutable in this milestone.

### 3. Versioned local project persistence

Add one strict outer-layer envelope, `ProviderFreeBannerProjectV1`, for synthetic development data.
It is not a replacement for `BannerSceneV1` or a production database model. It contains only:

- literal envelope version and fixture/project identity;
- safe project display name;
- selected background/layer identity as UI state;
- a bounded append-only list of at most 32 accepted scene revisions;
- for each revision: contiguous revision number, canonical scene, scene SHA-256, parent scene digest
  (null only for revision 1), and exact scene-workflow reference;
- the current accepted revision number.

The initial fixture scene is revision 1 and uses the existing analyze workflow provenance. A saved
manual edit appends a revision using one new fixed, versioned, provider-free scene-edit workflow
reference. The workflow definition permits only the mutations listed above and has a canonical
definition digest. It is synchronous, local, zero-cost, and is not added as a generic generation
operation.

Browser storage is a reversible validation adapter for this one synthetic project. It stores no
image bytes, credentials, provider evidence, exported ZIP, raw HTML, raw JavaScript, or private
data. Writes use one versioned key and canonical JSON, then read back and validate before reporting
success. A failed/quota-limited write leaves the in-memory draft and prior accepted revision intact.
Reload parsing is strict: unknown keys, invalid scenes, digest drift, broken ancestry, excess
revisions, or foreign fixture/asset identities fail closed. The application does not silently
overwrite corrupt state; it offers a clearly described reset that removes only this fixed local
demo key after an explicit user action.

Client project IDs are never workspace authority. Server routes resolve the existing fixed
development actor/workspace context and compare the exact demo project identity before materializing
assets, preview, or export.

### 4. Shared trusted scene renderer and isolated preview

Add one deterministic scene-render plan used by both preview and export. It consumes only a parsed
`BannerSceneV1` plus exact resolved asset bytes. It implements the accepted base frame, anchor,
translate, scale, rotation, opacity, inclusion, visibility, order, background, interaction, timing,
easing, and five closed preset semantics. It rejects unsupported or unresolved material; it never
accepts HTML, CSS, JavaScript, expressions, callbacks, or URLs outside the validated interaction.

The generated runtime is exporter-owned fixed code. Scene/render data is canonical JSON encoded in
a non-executable safe representation; user strings are set through DOM text/attribute APIs, not
concatenated into executable source or inserted into the application document with `innerHTML`.
Asset references resolve only to exact packaged filenames or bounded preview data/blob URLs.

Preview requirements:

- use an iframe with only the exact sandbox and CSP from `PREVIEW_POLICY`;
- omit `allow-same-origin`, navigation, popups, forms, downloads, and all connection capability;
- create a fresh cryptographically random 128-bit nonce for each preview instance;
- accept only the existing four child-to-parent messages after exact `event.source`, nonce, schema,
  and size validation;
- intercept the fixture exit and report only `{type: "exit", nonce}`; the parent may display the
  already validated destination but must not navigate during preview;
- revoke every object URL on replacement/unmount and retain no prior scene bytes;
- cap the one demo animation at 2.4 seconds, never flash, and render a static state under
  `prefers-reduced-motion: reduce`;
- show ready, playing/progress, completed, and safe error states outside the iframe.

Preview nonce/time state is excluded from scene, project, export, manifest, and artifact digests.

### 5. Deterministic export and internal validation

Complete the existing deterministic ZIP path rather than creating a second exporter. The existing
fixed entry order, timestamp, mode, compression, archive limits, asset inclusion behavior,
inspection, and `internal-provider-free-not-gdn` artifact contract remain authoritative. Replace
the placeholder page/runtime content with the shared trusted renderer output and retain
`scene.json`, local assets, and an explicit internal/non-GDN notice.

For the exact same parsed scene, asset bytes, exporter identity, and build digest, two exports must
be byte-identical and have the same pinned SHA-256. Excluded layers are not packaged solely for
their layer; included hidden layers remain packaged but produce no pixels. No source asset is
packaged unless another accepted scene reference requires it. There are no remote images, fonts,
styles, scripts, imports, frames, fetches, sockets, or service workers.

Add one provider-free internal validator adapter behind the existing `GdnValidationPort`. Its fixed
profile and `rulesSha256` describe only repository-owned checks already supportable offline:

- archive/entry/path/compression limits and exact executable-content policy;
- exactly one expected entry point and the fixed required runtime/styles/scene entries;
- exact canvas dimensions and selected scene/export profile binding;
- packaged asset identity and included/excluded graph rules;
- inert preview exit versus canonical exported single-exit behavior;
- absence of prohibited executable entries and remote dependencies;
- manifest/artifact/profile/digest equality.

Findings use the existing closed result schema, stable rule codes, severity, safe message, and
optional validated entry path. Results are ordered by severity, rule code, and path. The UI displays
every finding and an actionable next step such as retrying the same scene or returning to its layer
controls. Neither a passing result nor a ZIP filename may use `GDN valid`, `Google approved`, or an
equivalent claim. Authoritative GDN rules research, account upload, and compliance labeling remain
separate closed gates.

The demo export response may use a strict base64 envelope because the allowlisted fixture artifact
is small, but the route must impose a fixed 2 MiB encoded-response ceiling below the core 50 MiB ZIP
limit. It returns only the exact artifact metadata/bytes, reproduction manifest, and sanitized
validation result. The browser creates one local Blob download and revokes its URL immediately
after use. No server artifact or raw executable response is persisted.

### 6. Failure and recovery behavior

State is explicit and non-destructive:

- opening: `closed`, `loading`, `ready`, `open-failed`;
- draft: `clean`, `dirty`, `saving`, `save-failed`;
- preview: `not-requested`, `loading`, `ready`, `running`, `completed`, `failed`;
- export: `not-requested`, `generating`, `validating`, `passed`, `failed`;
- persistence: `available`, `unavailable`, `corrupt`.

Starting preview/export captures the exact accepted revision and digest. Later draft edits cannot
change an in-flight request's identity. A stale completion is ignored. Double-clicks do not create
parallel exports; one active operation disables its trigger. A failure returns only a stable safe
code/message, retains the project/draft/last accepted scene, and exposes Retry. Retry uses the same
accepted scene digest unless the user explicitly saves a new revision. A successful prior preview
or validator result is labeled with its digest and is never presented as applying to a later draft.

## UI states and interactions

The editor remains within Banner AI and adds no general application shell. The smallest layout is:

1. **Project header** — fixture project name, provider-free badge, accepted revision/digest, dirty or
   saved status, Save changes, and Reset demo project.
2. **Layer list** — one background row and three foreground rows, each with bounded thumbnail,
   escaped plain-text name, selection radio, inclusion checkbox, and foreground visibility
   checkbox. The selected row remains selected when excluded or hidden.
3. **Preset inspector** — exact `Gentle float` description and Apply/Clear action. Background
   selection disables it with an explanation.
4. **Isolated preview** — titled sandboxed iframe, visible readiness/progress/error copy, scene
   digest, and reduced-motion explanation.
5. **Export and validation** — Generate HTML5 ZIP, bounded progress, local download, artifact size
   and digest, explicit non-GDN label, validation outcome, and ordered findings.

The current upload/proposal screen keeps its truthful “future scene” labels. Shared row/control
markup should be extracted or adapted so the editor does not duplicate its native keyboard and
focus behavior. Proposal state and persisted scene state remain different types and cannot be
silently interchanged.

## Accessibility requirements

- Project, layer, preset, preview, and validation regions have programmatic headings.
- Selection remains one named native radio group; inclusion/visibility remain native checkboxes
  with explicit labels and visible focus indicators.
- Thumbnail images are associated with their row name without duplicative announcements; decorative
  pixels use empty alt text while the row exposes the plain-text layer name.
- Inclusion, visibility, and selection are not communicated by color alone. Disabled preset state
  includes text.
- Save, preview, retry, reset, and export are native buttons with stable accessible names and clear
  disabled/busy state. Reset requires confirmation and returns focus predictably.
- Status updates use bounded polite live regions; failures and corrupt persistence use alerts.
  Interactive controls are never nested inside a live region.
- The preview iframe has a project-specific `title`, cannot trap keyboard focus, and never opens the
  exit during preview.
- The only animation completes within 2.4 seconds, contains no flashing, and is static when the user
  requests reduced motion.
- Validator findings are a semantic list with severity text, rule code, message, and entry path when
  present. Pass/fail is not conveyed solely by icon or color.
- The complete workflow is operable with keyboard alone at 200% zoom and at a 320 CSS-pixel viewport
  without loss of controls or horizontal page scrolling.

## Expected implementation paths and dependency direction

Exact filenames may follow nearby naming conventions, but responsibilities and dependency direction
are fixed. Expected scope is limited to the modules below.

```text
packages/banner-ai/src/
  editor/provider-free-fixture-project-v1.ts       # fixed project, scene edits, allowlist
  render/banner-scene-v1-renderer.ts               # shared pure render/evaluation plan
  export/deterministic-fake-exporter.ts             # reuse; replace placeholder runtime
  export/provider-free-internal-validator.ts        # existing validator-port adapter
  workflows/workflow-definition.ts                 # fixed export workflow identity
  index.ts                                           # bounded new public exports

packages/banner-ai/test/
  provider-free-fixture-project-v1.test.ts
  banner-scene-v1-renderer.test.ts
  deterministic-fake-exporter.test.ts               # extend existing tests
  provider-free-internal-validator.test.ts

apps/web/src/app/banner-ai/
  page.tsx                                           # expose the explicit demo-project entry
  editor/page.tsx                                    # one focused provider-free editor route

apps/web/src/app/api/banner-ai/demo-project/
  route.ts                                           # fixed project/view materialization
  preview/route.ts                                   # strict isolated-preview response
  export/route.ts                                    # strict artifact + validation response

apps/web/src/features/banner-ai/
  banner-ai-client.tsx                               # link/transition only; preserve upload flow
  banner-ai-layer-controls.tsx                       # extracted shared accessible controls
  banner-ai-project-contract.ts
  banner-ai-project-state.ts
  banner-ai-project-storage.ts
  banner-ai-project-editor.tsx
  banner-ai-preview.tsx
  banner-ai-export-panel.tsx
  directly associated tests

apps/web/src/server/banner-ai/
  provider-free-demo-project.ts                      # server-owned composition/identity boundary

apps/web/src/app/globals.css                         # scoped editor/preview/finding styles
apps/web/package.json                                # Playwright only after dependency approval
pnpm-lock.yaml                                       # only if that dependency gate is approved
playwright.config.ts
apps/web/e2e/banner-ai-provider-free-editor-export.spec.ts
vitest.config.ts                                     # only if new test-file routing requires it
```

Do not introduce a generic renderer package, project service, storage package, design system, job
queue, database repository, or API client. Domain/render/export rules remain in
`packages/banner-ai`; browser storage, React state, and HTTP translation remain in `apps/web`.

## Explicit exclusions

This milestone does not include:

- any SAM assurance, repair, preflight, credential, claim, transport, inference, worker, registry,
  deployment, or provider operation;
- real model calls, provider benchmarking, segmentation-quality work, inpainting, OCR improvement,
  prompt changes, or model selection;
- arbitrary JavaScript, CSS, HTML, prompts, callbacks, expressions, keyframes, easing values, or
  timelines supplied by a user or model;
- natural-language animation generation, per-layer prompting, or general conversation state;
- drag-and-drop canvas editing, resize/rotate handles, free-form geometry editing, rename, reorder,
  combine, replace, or background reconstruction;
- multi-size generation, GIF, video, SVG ingestion, remote assets, fonts, templates, or dependencies;
- a new `BannerSceneV1` version or changed scene/manifest/validator/preview semantics;
- PostgreSQL, Drizzle schema, database creation, migration generation/application, production
  persistence, data migration, retention work, or production authentication;
- a SaaS starter, new Fabrica product, Stripe, billing, credits, entitlements, plans, teams,
  invitations, roles, seats, marketing pages, documentation CMS, or administration;
- external GDN research, Google account upload, compliance certification, deployment, hosted
  service, telemetry, analytics vendor, commit, push, or pull request.

Existing SAM research/tests and the current upload/proposal UI remain in place. SAM production,
provider-call, web, and general-admission authorities remain false.

## Schema and migration impact

- `BannerSceneV1`, export-manifest v1, preview-message v1, exporter/validator ports, asset references,
  and job/provider contracts do not change.
- One new versioned local project-envelope parser and one fixed scene-edit workflow definition are
  additive. They are synthetic development adapters and are not exported as production persistence
  authority.
- One fixed export workflow, exporter identity/build digest, and internal validator profile/rules
  digest are added and pinned in tests.
- There is no database schema or migration. `packages/db` remains unchanged.
- A later durable project repository must import valid scene revisions from this adapter explicitly;
  it must not reinterpret browser storage as trusted production data.

## Determinism and validator requirements

Determinism is an acceptance property, not a snapshot convention:

- project materialization from the exact fixture produces pinned normalized asset bytes/digests;
- each edit applied to the same accepted scene produces identical canonical scene JSON and digest;
- renderer evaluation at fixed boundary/mid/end times produces exact channel values from the
  accepted preset/easing semantics;
- preview and export use the same render plan, asset mapping, layer ordering, inclusion, visibility,
  and interaction interpretation;
- the ZIP has fixed entry order, timestamps, modes, compression settings, and exact executable
  content for the same input;
- two independent exports of the same revision are byte-identical and manifest-identical;
- validator rules/profile identity is immutable, validation is offline, and findings are stably
  ordered;
- wall-clock timings, preview nonce, Blob URLs, browser object identities, and localStorage write
  time never enter scene, artifact, manifest, exporter, or validator digests;
- tests pin focused byte/digest identities and exact objects; broad snapshots are not updated to hide
  drift.

The validator must fail closed for a malformed ZIP, unexpected/missing entry, altered executable
byte, unknown profile, rules-digest mismatch, scene/artifact mismatch, remote dependency, unsafe
path, asset mismatch, output over the demo response cap, or any thrown adapter error. A validator
failure cannot erase or mutate the accepted scene or prior safe evidence.

## Test plan

### Unit tests

- Materialize the exact fixture twice and assert identical project, asset, thumbnail, base-scene,
  workflow, exporter, and validator identities/digests.
- Reject caller-supplied fixture/project/asset/path/URL/byte fields and mismatched allowlisted
  references.
- Exercise selection, every inclusion/visibility combination, background mapping, applying/moving/
  clearing the one preset, immutable canonical name/order/geometry, exact timeline sorting, and
  invalid reducer output.
- Parse/canonicalize every project revision; reject unknown keys, excess/missing/out-of-order
  revisions, broken parent digest, scene digest drift, foreign asset/workflow identity, and corrupt
  storage. Prove quota/write/readback failure preserves prior accepted state.
- Evaluate all five accepted renderer preset kinds plus base transform/order/inclusion/visibility at
  start, easing midpoint, iteration boundary, alternate iteration, exclusive end, and neutral state.
- Prove renderer generation escapes text/data safely, uses no application-document `innerHTML`,
  accepts no executable user input, and emits no remote dependency.
- Extend deterministic exporter tests for byte equality, new pinned ZIP digest, exact entries,
  executable content, included/excluded/hidden asset behavior, manifest equality, interaction, and
  size failure.
- Test the internal validator's pass result and every mapped failure code, stable ordering, exact
  artifact/profile binding, safe messages, and non-GDN label.
- Test iframe sandbox/CSP/source/nonce/object-URL lifecycle, stale completion rejection, double-click
  suppression, exact retry digest, reduced motion, and accessible render states.

### Route and integration tests

- `GET` the one server-owned demo project with no client actor/workspace authority and exact local
  asset identities.
- Preview one valid revision through the shared renderer and reject extra keys, foreign project,
  stale digest, unsupported scene mutation, malformed nonce, unresolved asset, and oversized
  response without returning raw HTML/error causes in a failure envelope.
- Export and validate one accepted revision, reparse the returned manifest/artifact/validation
  envelope, inspect the ZIP, and confirm zero remote/provider activity.
- Prove Request/response errors are stable and safe, no filesystem path/stack/raw executable content
  appears in error JSON, and no project state changes on route failure.
- Prove two route exports for the same request are byte-identical and a changed accepted revision has
  a distinct scene/artifact digest.

### Browser end-to-end test

Add one provider-free real-browser flow only after the dependency gate is approved:

1. Open `/banner-ai/editor` and open the approved demo project.
2. Verify four named rows and useful bounded thumbnails.
3. Select one wing, hide it, exclude/reinclude it, apply `Gentle float`, and save revision 2 with
   keyboard-only controls.
4. Load the isolated preview, observe the exact ready/progress/completed UI, verify the iframe's
   sandbox/title, and verify preview exit reports without navigation.
5. Generate the ZIP, observe an internal-check pass and non-GDN label, and capture one local
   download.
6. Reload and verify revision 2, selection, layer controls, preset, and scene digest reopen exactly.
7. Intercept one export request with a synthetic safe failure, assert the project/draft/digest remain
   intact, remove the interception, retry, and receive the same deterministic artifact digest.
8. Cover reduced-motion emulation, focus visibility, 200% zoom, and a 320-pixel viewport.

The browser suite runs against the local application only. It receives no provider/payment key and
blocks unexpected external requests. No production-only test hook is added; the expected failure is
injected by the browser test's local route interception.

### Full verification

Implementation completion requires:

```text
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm test
pnpm --filter @fabrica/web build
pnpm exec playwright test apps/web/e2e/banner-ai-provider-free-editor-export.spec.ts
git diff --check
```

Also run focused forbidden-content scans for secrets, provider credentials, RunPod URLs/routes,
remote dependencies in generated packages, unsafe preview attributes, generated artifacts, and
unexpected Person V1/`services/sam-worker/**` changes. The implementation report must give exact
test counts and prove external request count, credential access, provider calls, paid operations,
deployments, migrations, commits, and pushes are all zero.

## Acceptance criteria

Phase 2A is complete only when all of the following are true:

1. The existing upload/proposal flow remains provider-free and truthful, and the editor opens only
   through an explicit approved-fixture project action.
2. One strict project envelope opens a valid `BannerSceneV1` with exact server-owned fixture,
   project, asset, workflow, exporter, and validator identities.
3. The UI displays one background and three foreground names with useful local thumbnails and native
   accessible selection/inclusion/visibility controls.
4. User changes affect the scene's exact inclusion, visibility, and background semantics; name,
   order, geometry, transforms, opacity, asset identities, export settings, and unrelated fields
   cannot drift.
5. Exactly one closed `Gentle float` preset can be applied, moved, or cleared without arbitrary
   timing/keyframe input, and every resulting scene passes `BannerSceneV1` validation.
6. Saving appends a canonical revision with exact digest/parent/workflow provenance; reloading opens
   the latest accepted revision unchanged.
7. Corrupt/unavailable browser storage fails closed, preserves the in-memory/prior accepted scene,
   and offers only an explicit reset of the fixed demo key.
8. Preview uses the shared scene renderer in the exact opaque iframe boundary, applies inclusion,
   visibility, order, transform, opacity, background, preset, and exit semantics, and performs no
   navigation or network request.
9. Preview exposes only validated nonce/source-bound messages, releases object URLs, completes motion
   within 2.4 seconds, and respects reduced motion.
10. The existing deterministic exporter produces a scene-reflecting self-contained HTML5 ZIP whose
    bytes, manifest, identities, and digest are reproducible from the accepted revision.
11. The internal validator executes automatically against the exact ZIP/profile, shows every
    actionable finding, fails closed on malformed input, and never claims authoritative GDN
    compliance.
12. An export/preview failure leaves the accepted revision and draft intact; retry uses the exact
    captured scene digest and succeeds without duplicate in-flight work.
13. No raw user HTML/CSS/JavaScript, path, provider error, stack, secret, remote asset, unsafe URL, or
    unvalidated persisted value reaches preview, ZIP executable content, validation evidence, or a
    user-facing error.
14. The end-to-end test proves open -> edit -> preset -> save -> isolated preview -> export ->
    validation -> reload -> failure -> retry with keyboard and reduced-motion coverage.
15. Default runtime and verification require zero provider credentials, external network, provider
    call, GPU, payment, hosted service, deployment, or production data.
16. `BannerSceneV1`, existing persistence/job/provider contracts, SAM machinery, Person V1,
    `services/sam-worker/**`, and `packages/db` remain unchanged except for additive bounded exports
    explicitly listed by this plan.
17. All focused and full verification commands pass without waivers, snapshot broadening, or
    weakened validation.

## Product-gate metrics enabled

This slice makes the following provider-free measurements observable locally and testable without
adding telemetry:

- fixture project open/reopen success and failure;
- accepted scene revision count and canonical digest;
- inclusion, visibility, and preset edit count as a manual-correction proxy;
- preview ready/completion/failure and retry recovery;
- export generation duration, artifact bytes/digest, first-pass internal validation result, finding
  count, and retry recovery;
- exact provider calls `0`, estimated provider cost `0`, and external requests `0`.

These values exercise product instrumentation boundaries but do not establish real layer-usefulness,
provider cost, production latency, or authoritative GDN pass rates. Those product-gate measures
remain unavailable and must not be inferred from the fixture slice.

## External, paid, deployment, and irreversible gates

| Gate                      | State for Phase 2A                                                                                                                                                                                                                           |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime provider/paid     | Closed. No credential read, provider request, GPU, external validator, or nonzero cost is permitted.                                                                                                                                         |
| SAM/RunPod                | Permanently outside this milestone. Do not contact RunPod or touch SAM production machinery.                                                                                                                                                 |
| Dependency/network        | `@playwright/test` and its exact browser binary are not currently pinned. Registry resolution/download requires separate maintainer authorization before changing `package.json` or the lockfile. All product runtime traffic remains local. |
| Database/migration        | Closed and unnecessary. No database/role/container or migration is created or applied.                                                                                                                                                       |
| GDN research/account      | Closed. No documentation lookup, account upload, external validation, or compliance claim.                                                                                                                                                   |
| Deployment/hosted service | Closed. No preview deployment, hosted storage, monitoring, DNS, or public endpoint.                                                                                                                                                          |
| Production/private data   | Closed. Only the committed synthetic fixture and locally generated deterministic derivatives are used.                                                                                                                                       |
| Irreversible operation    | None. Browser demo storage is removed only through an explicit user reset. No repository or production data deletion.                                                                                                                        |
| Git                       | Planning creates only this uncommitted plan. Implementation, commit, push, PR, and merge each require their own authorization.                                                                                                               |

## Maintainer input still required

No product-behavior decision blocks this plan. The plan chooses the smallest reversible options:
one synthetic fixture, one preset, local browser persistence, the existing internal non-GDN
validator boundary, and no database.

Before the end-to-end portion of implementation, the maintainer must separately authorize exact
Playwright package resolution and browser download, or provide an already pinned repository-owned
browser-test toolchain that satisfies the same real-browser acceptance criteria. That operational
choice must not weaken the end-to-end requirement.

Authoritative GDN validation is intentionally not a decision needed for this milestone; requesting
it would be scope expansion and a separate later evidence gate.

## Exact next implementation gate

The next gate is a new, explicit authorization for Luna to implement **Implementation plan 0002,
Phase 2A provider-free editor/preview/export**, with Terra reviewing the frozen scope before Luna
writes code. That authorization must state whether the Playwright dependency/browser network gate
is also approved. If it is not, Luna may not claim milestone completion and must stop before any
registry or browser download.

Plan approval alone does not authorize implementation, dependency download, commit, push, PR,
deployment, provider access, GDN research, or any SAM operation.
