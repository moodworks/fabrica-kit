# Phase 3A: provider-neutral product-gate evaluation foundation V1

Status: frozen implementation record\
Date: 2026-07-28\
Publication status: local, uncommitted, and non-authoritative

## 1. Starting identity and mandatory gate

Implementation starts from the locally verified, network-independent repository state below:

- branch: `main`
- `HEAD`, local `main`, and local `origin/main`: `ebeb60e7802269609ad29e8b74d0e198a635e83a`
- tree: `c5d0626d5fe5e1f653449de4c987bbb5ea1a1915`
- merge parent 1: `cdcd5dae91f6767e7c8934c89b483735c70d415d`
- merge parent 2: `6945146446eea65f11ef57d4369102e218aa105d`
- upstream divergence: `+0/-0`
- index and tracked worktree: clean
- non-ignored untracked files: zero
- generated product-gate evaluation output: absent
- approved Phase 2A plan: `docs/implementation-plans/0002-provider-free-editor-preview-export.md`
- approved Phase 2A plan SHA-256: `ce2e56c8f10b0a1ba641b097b7340714b835df0ef0475eb281c51f1b4d3e4a59`

The implementation branch is `banner-ai-product-gate-evaluation-foundation-3a`, created directly from that exact `main` without fetching.

The protected historical branch is observed without checkout or mutation:

- branch: `sam-text-heavy-provider-recorder-repair-v3`
- commit: `af4b8784b5a527ba47f2ed263337936ce04631c6`
- parent: `1cb255a470cdc0d96dbebce83209d796d02accc0`
- upstream: none
- remote containment: none
- merged into starting `main`: false

The external preservation directory named in the Phase 3A authorization is quarantined evidence. It is outside every command and path scope for this implementation and must receive zero reads, listings, comparisons, executions, copies, writes, or deletion operations.

## 2. Objective and claims boundary

Phase 3A adds deterministic, provider-free contracts and evaluation machinery for measuring future Banner AI product-gate evidence. It operates only on deterministic fakes and the four already committed development fixtures.

Phase 3A does not establish or imply that the Banner AI product gate passed, real-model decomposition is useful, an 18-case holdout is admitted, exports are authoritatively GDN-valid, or any provider, model, endpoint, worker, SAM, GPU, paid operation, or transmission is authorized.

## 3. Closed scope

The implementation is additive and limited to these paths:

1. `packages/banner-ai/src/evaluation/product-gate-corpus-v1.ts`
2. `packages/banner-ai/src/evaluation/product-gate-segmentation-v1.ts`
3. `packages/banner-ai/src/evaluation/product-gate-background-v1.ts`
4. `packages/banner-ai/src/evaluation/product-gate-scorecards-v1.ts`
5. `packages/banner-ai/src/evaluation/product-gate-run-manifest-v1.ts`
6. `packages/banner-ai/src/evaluation/product-gate-metrics-v1.ts`
7. `packages/banner-ai/src/server/product-gate-development-corpus-loader-v1.ts`
8. `packages/banner-ai/src/server/product-gate-deterministic-fake-runner-v1.ts`
9. `packages/banner-ai/test/product-gate-corpus-v1.test.ts`
10. `packages/banner-ai/test/product-gate-scorecards-v1.test.ts`
11. `packages/banner-ai/test/product-gate-run-manifest-v1.test.ts`
12. `packages/banner-ai/test/product-gate-metrics-v1.test.ts`
13. `packages/banner-ai/test/product-gate-deterministic-fake-runner-v1.test.ts`
14. this implementation record
15. `docs/evaluation/banner-ai-product-gate-evaluation-v1.md`

No existing production source, package export, script, test configuration, ignore rule, dependency, lockfile, UI, database, migration, authentication, billing, SaaS, or deployment file will change. Evaluation APIs remain reachable only by internal direct imports and are not exposed through the package root.

## 4. Forbidden behavior

The implementation contains no production adapter, provider transport, network client, credential lookup, environment-secret lookup, endpoint, authorization phrase, paid-call path, SAM/RunPod/GPU call, holdout admission function, real-evaluation activation, GDN authority, database write, UI route, publication automation, or fallback from the development set to a product-gate denominator.

No dependency may be installed or updated. `pnpm-lock.yaml` must remain byte-identical. No commit, stage, push, PR, merge, deployment, Phase 3B work, GDN research, provider preflight, or real evaluation is permitted.

## 5. Reused and protected contracts

The implementation reuses without semantic change:

- `CompositionAnalysisResultV1` and its request-relative validation
- `BannerCompositionAnalysisPort`
- the existing scene-analysis request, model, prompt, content-policy, and workflow identities
- `canonicalizeJson`, `sha256Hex`, and existing SHA-256 schemas
- `ExtractedLayerResultV1` only as the final canonical-PNG validation boundary for materialized cutouts
- `SAM_CORPUS_VISUAL_SCORE_ANCHORS_V1`, preserving all six 0–4 dimensions and polarity
- existing canonical micro-USD parsing, cost reservation, and usage-status vocabulary
- existing closed animation presets
- `BannerSceneV1`
- provider-free preview and export reproduction contracts

The following remain byte- and semantic-stable and are checked for drift: `BannerSceneV1`, `WorkflowDefinitionV1`, existing job semantics, GDN V1 contracts, `validator_provider_free_internal_v1`, and `internal-provider-free-not-gdn`.

Evaluation uses a separate closed stage enum: intake, vision, segmentation, cutout, background, scene, preset, preview, export, authoritative validation, and recovery. The fixture-oriented workflow-step enum is not widened.

## 6. Corpus and authority states

### Development corpus

The development manifest references exactly the four committed `real-model-benchmark` fixture pairs in their established order. Each entry binds:

- fixture ID and development scenario/stratum
- package-relative original source path, media type, dimensions, byte size, and SHA-256
- package-relative canonical normalized PNG path, dimensions, byte size, and SHA-256
- approved provider-free human-oracle identity and SHA-256
- the existing pending-corpus and human-oracle corpus identities from which the projection was derived

The manifest is explicitly `development-only`, biased/non-holdout, non-product-gate evidence, non-commercial-generalizability evidence, and grants no provider transmission or real-evaluation authority. Its canonical digest binds the complete projection.

The server loader accepts only the exact pinned development manifest. It uses a fixed package root, or a test-only explicit fixture root with the same exact relative structure, and rejects unknown or reordered entries, identity drift, missing files, absolute or traversal paths, symlinks in any path component, non-regular files, realpath escape, concurrent file mutation, invalid byte-detected media types, byte/digest/dimension drift, invalid canonical normalized PNGs, and fresh-normalization mismatch.

### Blocked holdout

The holdout manifest is a strict singleton representation with expected case count 18, admitted count 0, entries absent, `holdoutAdmitted: false`, `providerTransmissionAuthority: false`, `realEvaluationAuthority: false`, denominator unavailable, authoritative GDN evidence absent, and product-gate outcome `not-measurable`. It has no admission or execution constructor. Any attempt to execute it throws before case work.

No function is allowed to substitute development fixtures for the blocked holdout or calculate a product-gate pass from the development set.

## 7. Segmentation, cutout, and provenance contracts

The segmentation boundary is evaluation-only and provider-neutral. Strict contracts cover invocation, semantic proposal projections, candidates, masks, materialized cutouts, results, and a closed provenance projection.

Every association binds canonical source SHA-256, composition proposal SHA-256, semantic element ID, candidate ID, mask ID, materialized cutout ID, run ID, attempt ID, and logical operation ID. Provider/model and checkpoint/image identities are represented only by closed `not-applicable` or `recorded` discriminated projections. Provider-specific arbitrary fields are impossible.

Canonical content-derived identities are recomputed and checked. Validation rejects duplicate identities or associations, ambiguous proposal ownership, orphan candidates/masks/cutouts, missing critical identities, candidate reuse across incompatible proposals, association mismatch, and cutout metadata not matching the exact canonical PNG result. `ExtractedLayerResultV1` is invoked only to validate that final PNG boundary.

## 8. Background contracts

Background strategy is closed to deterministic solid fallback, reconstruction, later optional inpainting, unsupported, failed, and not attempted. Invocation/results bind source, proposal, run, attempt, logical operation, and provenance.

A deterministic solid fallback result must carry an oracle authorization whose fixture, oracle SHA-256, and exact solid color bind the case. No such authorization can be derived from the blocked holdout. Reconstruction and later inpainting have separate dispositions; unsupported, failed, and not-attempted results cannot be called usable.

## 9. Scorecards

All scorecards are strict, separate, and provider/model-blind:

- Vision/composition: expected count range, role/name usefulness, critical-element coverage, allowed grouping, directly visible evidence, and bounding-box agreement.
- Segmentation/cutout: the existing 0–4 anchors for semantic usefulness, completeness, edge/matte quality, background contamination/cleanliness, granularity integrity, and repair readiness.
- Background: strategy identity, removed-object leakage, continuity, contamination, and usability. Reconstruction-only dimensions can be `N/A` only through a closed oracle-authorized solid-fallback reason.
- Composite usefulness: every critical element covered, oracle-valid count/grouping, every counted foreground component at least 3 in all six dimensions, an approved usable background, at least one meaningful animation-ready foreground, correction burden inside budget, and no unresolved duplicate or fragment.
- End-to-end: scene materialization, preset/target appropriateness, preview, export, authoritative validation, and failure recovery. The seven product requirements are represented explicitly. Authoritative validation and complete product-gate outcome remain `not-measurable` while GDN authority/evidence is absent.

## 10. Corrections and adjudication

The closed correction order is:

0. none
1. rename only
2. required include/exclude default correction
3. reordering
4. combining fragments
5. minor mask correction
6. major mask correction
7. background replacement
8. complete decomposition failure

Ordinary creative include/exclude selection is recorded separately and never counted as a correction.

Foreground mask correction uses exact integer arithmetic over:

`changedPixels = count(alphaBefore[p] != alphaCorrected[p])`

Minor classification requires both `changedPixels/sourceCanvasPixels <= 0.02` and `changedPixels/oracleTargetPixels <= 0.10`, at most one local connected edit region, and no recovered missing critical semantic element. Zero or invalid denominators fail closed to major correction. Boundary tests cover below, equal, and above both ratios.

A potentially useful result may require rename/toggle/reorder, at most one fragment combination, and at most one minor mask correction. It may not require a major mask correction, unapproved background replacement, or complete decomposition recovery.

Adjudication contracts preserve two immutable raw, independent, provider/model-blind reviews in deterministic seeded presentation order. Adjudication is required for any categorical disagreement or any shared numeric score with an absolute difference of at least two. A distinct third reviewer records the final classification and rationale. Raw reviews cannot be overwritten, reviewers must be distinct, and model confidence is never accepted as oracle truth. Phase 3A creates deterministic fake review records only and performs no actual human scoring.

## 11. Run, attempt, artifact, retry, and provenance records

Strict manifests record sanitized input identity, corpus version and split, protected workflow/prompt identities, provider/model and checkpoint/image projections, runtime, actual/estimated/reserved cost, structured-result identity, bounded artifact inventory, safe failure identity and stage, exact retry parent/logical operation, reviewer score records, and correction classification.

Runtime layout is fixed beneath `.local-data/banner-ai/product-gate-evaluation/v1/runs/<run-id>/`. Directories are mode `0700`; files are mode `0600`. Paths are relative, normalized, allowlisted, traversal-free, and symlink-free. JSON is canonical. Manifest entries are deterministically sorted. Stable IDs are content-derived and exclude wall-clock values. Finalized files use exclusive creation and cannot be overwritten. A partial run never receives a final manifest. The final manifest is written last after all inventory entries are re-read and verified. Failed and indeterminate attempts retain conservative cost. Raw secrets, authorization headers, private absolute paths, and unbounded provider errors/bodies are schema-forbidden.

Tests use bounded temporary directories and remove only their exact roots. Repository runtime output must be absent at handoff.

## 12. Metrics and closed decisions

Every metric returns one of `pass`, `fail`, `inconclusive`, or `not-measurable`, with explicit numerator/denominator/evidence fields and no `NaN` path.

- Useful-layer success: useful cases / N; pass at least 15/18 and at least one success in each two-case primary stratum.
- Product-gate E2E: cases meeting all seven requirements / N; pass at least 14/18, but `not-measurable` without authoritative GDN evidence.
- Successful latency: nearest-rank p50 at most 240,000 ms and p95 at most 420,000 ms.
- All-case terminal latency: maximum at most 600,000 ms.
- Cost per success: sum actual costs when known, otherwise estimates, otherwise full reservations, including failed and indeterminate attempts; divide by E2E successes; pass at most 350,000 micro-USD. Zero successes is inconclusive.
- First-attempt step failure: first-attempt failures / cases reaching the step.
- Final step failure: terminal failures after authorized retries / cases reaching the step; pass at most 10% per step.
- Authoritative export: first pass at least 17/18 and final 18/18; `not-measurable` until the separate GDN gate.
- Manual-correction rate: correction classes 1–7 / decompositions produced; pass at most 30%.
- Major intervention: classes 6–8 corresponding to major mask, background replacement, and complete failure / N; pass at most 10%.
- Injected recovery: pass only at 100%.
- Observed real recovery: pass at least 90% only when there are at least ten eligible events; otherwise inconclusive.
- Replay reproducibility: pass only at 100%.
- Component-repeat reproducibility: same classification and critical coverage in at least 5/6 predesignated non-inpainting cases.

Exact cross-multiplication is used for rational thresholds. Nearest-rank percentile index is `ceil(p * n) - 1` on ascending values. Missing evidence, blocked authority, invalid denominator, incomplete run, absent validation, and zero-success division return the specified closed non-pass result.

These are proposed implementation thresholds only, never evidence that quality targets were achieved.

## 13. Deterministic fake/replay runner

The internal fake runner accepts only the verified development corpus and has no provider/network/credential dependency. It exercises all eleven evaluation stages with deterministic observations and bounded artifacts. Each stage can receive one deterministic injected failure.

An initial failed attempt is finalized conservatively. A retry must name that exact parent attempt and reuse the same logical operation ID. Accepted case evidence from earlier stages remains immutable. Exclusive finalization prevents duplicate cost and output publication. Recovery produces a fresh child attempt. Replaying the same recorded input writes byte-identical structured evidence and yields identical digests; stable evidence omits wall-clock values.

The fake run/report always identifies the split as development and the product-gate decision as `not-measurable`. Executing the blocked holdout throws before a run directory is reserved. No production execution adapter or activation surface is created.

## 14. Verification matrix

Focused tests cover strict unknown-key rejection; canonical digests; development/holdout authority separation; original, normalized, and oracle bindings; missing sources, traversal, symlinks, normalization and digest drift; segmentation associations and provenance; duplicates, fragments, ambiguity, orphans, and incompatible reuse; separate scorecards and closed `N/A`; correction boundaries and zero denominators; blinded deterministic review order and adjudication triggers; every metric threshold and missing-evidence state; conservative failed/indeterminate cost; retry parent and logical-operation binding; replay byte/digest equality; injected failure at every stage; permissions and artifact inventory; exclusive no-overwrite; manifest-last publication; partial-run cleanup; and zero provider/network/credential access.

Required commands are:

```sh
pnpm exec vitest run --project unit packages/banner-ai/test/product-gate-corpus-v1.test.ts packages/banner-ai/test/product-gate-scorecards-v1.test.ts packages/banner-ai/test/product-gate-run-manifest-v1.test.ts packages/banner-ai/test/product-gate-metrics-v1.test.ts packages/banner-ai/test/product-gate-deterministic-fake-runner-v1.test.ts
pnpm --filter @fabrica/banner-ai typecheck
pnpm --filter @fabrica/banner-ai build
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
pnpm build
git diff --check
```

The final audit also proves lockfile byte identity, generated-output absence, exact changed-path scope, ignored runtime ownership, secret/waiver/generated-artifact absence, protected-contract drift absence, provider/RunPod/SAM scope absence, DB/schema/migration absence, and UI/auth/billing/SaaS/deployment absence. Any generated `.next` or `next-env.d.ts` paths are checked against ignore ownership and removed only by their exact names.

## 15. Independent review and stop gates

Terra must inspect the frozen plan/digest, complete diff, all contract/identity/authority/score/metric/retry/artifact behavior, verification evidence, historical SAM preservation, and quarantine non-access proof without editing. Only substantiated findings inside this exact path and semantic boundary may be corrected, followed by affected and full re-verification. Terra must issue explicit final `GO` before handoff.

If completion requires a new dependency, a path outside the closed list, a package-root export, provider or paid access, real corpus assets, 18-case admission, GDN authority, UI/DB work, or protected-contract drift, implementation stops `NO-GO` rather than widening this record.

After Terra `GO`, all work remains unstaged and uncommitted on the local Phase 3A branch. Phase 3B, holdout admission, provider selection/authorization, paid execution, and authoritative GDN validation are separate later gates. The exact next gate is approval and admission of the blinded 18-case holdout with explicit transmission/evaluation authority; it still must not itself imply provider execution or GDN authority.
