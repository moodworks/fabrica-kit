# Banner AI product-gate evaluation protocol V1

Status: Phase 3A provider-free foundation\
Authority: development-only; no real evaluation or provider transmission\
Product-gate outcome: not measurable

## Purpose

This protocol defines how a later Banner AI product-gate evaluation can be recorded and decided. Phase 3A supplies strict contracts, deterministic fake evidence, closed metrics, and safe artifact handling. It does not run or authorize a real evaluation and does not claim product usefulness, provider quality, holdout admission, or authoritative GDN validity.

## Corpus states

The V1 development manifest projects the four committed repository fixtures in their established order and binds each fixture's original bytes, canonical normalized PNG, and approved provider-free oracle digest. This set is biased development material only. It is not a holdout, product-gate denominator, commercial-generalizability sample, or provider-transmission grant.

The product-gate holdout is represented by one blocked manifest:

- expected cases: 18
- admitted cases: 0
- holdout admitted: false
- provider transmission authority: false
- real evaluation authority: false
- authoritative GDN evidence: absent
- denominator: unavailable
- outcome: `not-measurable`

There is no fallback from the blocked holdout to the development set. The development fake runner always reports `not-measurable` for the product gate, even if all fake component checks succeed.

The development loader accepts only the exact manifest. It rejects unknown/reordered entries, digest or normalization drift, missing files, traversal, absolute child paths, symlinks, special files, realpath escape, file mutation during read, invalid media signatures, and oracle/source mismatches.

## Evaluation stages

Evaluation uses a vocabulary separate from product workflow steps:

1. intake
2. vision
3. segmentation
4. cutout
5. background
6. scene
7. preset
8. preview
9. export
10. authoritative validation
11. recovery

The stage list creates no job, workflow, provider, or production execution authority.

## Vision and composition

Vision output remains the existing `CompositionAnalysisResultV1`, validated against its exact source request. The evaluation projection adds a content-derived proposal identity and content-derived semantic-element identities without changing the protected composition contract.

The vision scorecard records:

- oracle layer-count range and actual count
- semantic role/name usefulness
- critical-element coverage
- oracle-allowed grouping
- directly visible evidence only
- bounding-box agreement

Model confidence is never oracle truth.

## Segmentation and cutouts

The boundary is provider-neutral and evaluation-only. Every accepted result forms exact, unique chains:

```text
source → composition proposal → semantic element → candidate → mask → canonical PNG cutout
```

Every chain also binds the run, attempt, and logical operation. Provider/model and checkpoint/image identities can appear only in a closed provenance projection. Arbitrary provider fields are rejected.

Duplicate identities or associations, fragments, declared duplicates, ambiguous proposal ownership, orphan masks/cutouts, foreign sources, and candidate reuse under an incompatible proposal fail closed. Final cutout bytes are checked through the existing `ExtractedLayerResultV1` canonical-PNG validator.

Segmentation scoring reuses the existing frozen 0–4 SAM visual anchors:

- semantic usefulness
- completeness
- edge/matte quality
- background cleanliness (inverse contamination)
- granularity integrity
- repair readiness

All six counted foreground scores must be at least 3 for composite usefulness.

## Background

Closed strategies are deterministic solid fallback, reconstruction, optional later inpainting, unsupported, failed, and not attempted. Phase 3A's fake runner uses deterministic reconstruction and never calls an inpainting or other provider.

A solid fallback is usable only with a content-bound, explicit case-oracle permission for the exact color. A holdout permission also requires an admitted-holdout manifest identity. The blocked holdout cannot supply that identity.

The V1 permission shape is only a future evidence projection. The current-corpus validator rejects every background invocation and scorecard against the blocked holdout. Development reconstruction must bind the exact manifest entry, case, original source, and normalized source. Neither current manifest supplies affirmative solid-fallback authority, so Phase 3A cannot execute a solid fallback or accept its reconstruction scores as authorized `N/A`. A later admitted corpus requires a new authority-bearing validation gate.

Removed-object leakage, continuity, and contamination can be `N/A` only for an oracle-authorized deterministic solid fallback. Other strategies must carry scored dimensions or a non-measurable/failed disposition.

Phase 3A records the vision and background dimensions but deliberately defines no numeric product-pass threshold for them. Structurally unusable observations can fail; otherwise these component outcomes remain inconclusive until an approved policy is bound. The foreground `>= 3` rule below is the only component-score threshold used by composite usefulness.

## Composite usefulness

A case is useful only if all of the following hold:

- every critical element is covered
- count and grouping are oracle-valid
- every counted foreground has all six component scores at least 3
- the background strategy is approved and usable
- at least one foreground is meaningfully animation-ready
- corrections remain inside the permitted budget
- no duplicate or fragment problem remains unresolved

## Correction taxonomy

Severity is closed and ordered:

| Severity | Class                                       |
| -------: | ------------------------------------------- |
|        0 | None                                        |
|        1 | Rename only                                 |
|        2 | Required include/exclude default correction |
|        3 | Reordering                                  |
|        4 | Combining fragments                         |
|        5 | Minor mask correction                       |
|        6 | Major mask correction                       |
|        7 | Background replacement                      |
|        8 | Complete decomposition failure              |

Ordinary creative include/exclude choice is separately marked and is not a correction.

For mask correction:

```text
changedPixels = count(alphaBefore[p] != alphaCorrected[p])
```

Minor classification requires exact integer comparisons proving both:

```text
changedPixels / sourceCanvasPixels <= 0.02
changedPixels / oracleTargetPixels <= 0.10
```

It also requires at most one connected edit region and cannot recover a missing critical semantic element. A zero denominator, second region, recovered critical element, or either exceeded ratio produces a major classification. A useful result can include at most one fragment combination and one minor mask correction; severity 6–8 is outside the useful budget.

## Independent review and adjudication

Actual human scoring is outside Phase 3A. Its contracts require:

- two distinct independent reviewers
- provider/model blindness
- deterministic seeded presentation order
- immutable, content-derived raw review records
- no model-confidence oracle use
- adjudication for any categorical disagreement
- adjudication for any shared numeric difference of at least 2
- a distinct third reviewer, final classification, and rationale
- preservation of both original reviews

The fake runner creates records explicitly labeled by deterministic fake reviewer identities only to exercise this machinery.

## End-to-end scorecard and GDN boundary

The seven product requirements are composite usefulness, scene materialization, preset/target appropriateness, preview, export, authoritative validation, and failure recovery.

Existing provider-free preview/export behavior and the internal validator remain valid internal evidence. The identities `validator_provider_free_internal_v1` and `internal-provider-free-not-gdn` cannot satisfy authoritative validation. Until a separate GDN gate supplies authoritative evidence, the complete end-to-end score and authoritative-export metric remain `not-measurable`.

V1 contains only the absent-GDN evidence variant. It has no constructor or schema branch that can self-assert authoritative GDN evidence; a later gate must introduce separately reviewed authority-bearing evidence.

## Proposed metric targets

These are decision thresholds, not achieved-quality claims:

| Metric                     | Formula and target                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Useful layers              | useful cases / N; at least 15/18 and at least one success per two-case primary stratum                                                           |
| Product-gate E2E           | all-seven-requirement cases / N; at least 14/18; unavailable without authoritative GDN evidence                                                  |
| Successful latency         | nearest-rank p50 ≤ 240 s and p95 ≤ 420 s                                                                                                         |
| Terminal latency           | all-case maximum ≤ 600 s                                                                                                                         |
| Cost per success           | all actual costs, else estimates, else full reservations, including failed/indeterminate attempts, divided by E2E successes; ≤ 350,000 micro-USD |
| First-attempt step failure | first failures / cases reaching step; descriptive                                                                                                |
| Final step failure         | terminal failures / cases reaching step; ≤ 10% per step                                                                                          |
| Authoritative export       | first pass ≥ 17/18 and final 18/18; unavailable before GDN gate                                                                                  |
| Manual correction          | classes 1–7 / decompositions produced; class 8 is not a produced decomposition and cannot enter this denominator; ≤ 30%                          |
| Major intervention         | classes 6–8 / N; ≤ 10%                                                                                                                           |
| Injected recovery          | 100%                                                                                                                                             |
| Observed real recovery     | ≥ 90% with at least 10 eligible events; otherwise inconclusive                                                                                   |
| Replay reproducibility     | 100%                                                                                                                                             |
| Component repeat           | same classification and critical coverage in at least 5/6 predesignated non-inpainting cases                                                     |

Ratios use integer cross-multiplication. Nearest-rank uses the ascending value at `ceil(p × n) - 1`. Missing/incomplete evidence, invalid or zero denominators, zero successes, blocked authority, and missing validation return a closed `inconclusive` or `not-measurable` decision; they do not produce a pass, `NaN`, crash, or omitted result.

Threshold helpers return results explicitly labeled `formula-only` and require unique identity-bearing observations with the applicable fixed denominator. Claim-bearing V1 evaluators accept only the exact current development or blocked-holdout manifest and therefore return `not-measurable`; caller booleans cannot manufacture holdout or GDN authority.

## Costs, attempts, and retries

Each attempt records a sanitized input identity, corpus split/version, protected workflow and prompt identities, closed provenance, deterministic runtime, structured-result identity, artifact identities, safe failure, reviewer/correction references, and conservative cost.

Cost precedence is actual, then estimate, then full reservation. Terminal attempt status must equal terminal usage status. Failed and indeterminate attempts remain included and may remain terminal without a successful output. A retry identity must name the exact immediately preceding retryable failed or indeterminate attempt and reuse the exact logical operation. One logical operation cannot be reused at another stage. A retry cannot overwrite accepted earlier-stage evidence or finalize the same output/cost twice.

## Runtime artifacts

Runtime evidence is ignored under:

```text
.local-data/banner-ai/product-gate-evaluation/v1/runs/<run-id>/
```

The layout follows the Phase 3A implementation record. JSON is canonical, manifest inventory is path-sorted, identities are content-derived, directories are `0700`, and files are `0600`. Paths reject traversal and symlinks. Finalized evidence uses exclusive creation. A private per-run filesystem mutation lock serializes artifact writes, cleanup, and publication. Publication re-enumerates the exact on-disk inventory, requires `run.json` and `report.json` in both the consumer schema and on disk, parses their closed identity and completeness projections, and binds both records and the run-directory name to the manifest run and corpus identities. Each ordered development case must contain exactly one successful output for every evaluation stage; its sanitized request, structured result and digest, referenced attempt artifacts, raw reviews, and adjudication must exist under the exact case/attempt ownership paths. Every inventoried path must be covered by that evidence projection. Only then is a fully written and synced private temporary manifest atomically linked without replacement. Partial runs never receive `manifest.json`, post-finalization writes are rejected, and cleanup revalidates the entire parent chain before exact removal. Raw secrets, headers, private absolute paths, and unbounded provider bodies/errors have no schema field.

## Deterministic fake and replay

The runner consumes only the verified four-fixture development corpus. It has no provider, network, environment-secret, SAM, RunPod, GPU, billing, database, or production adapter dependency. It exercises every evaluation stage, supports one deterministic injected failure at any stage, and binds recovery to the exact failed operation.

Output selection is closed to the internally derived ignored runtime root or an already-existing `0700` direct temporary child with the dedicated test prefix. Arbitrary absolute, repository, filesystem, home, symlinked, or broad roots are rejected and are never chmod-modified.

The same sanitized input, corpus identities, seed, and injected-failure setting produce the same run, attempt, artifact, inventory, report, and manifest identities. Replays in separate bounded roots are byte/digest-identical. The output always remains development-only and `not-measurable` for the product gate.

## Later closed gates

Phase 3A does not open later gates. The next gate is separate approval and admission of the blinded 18-case holdout with explicit evaluation and transmission authority. Provider selection/authorization, paid execution, observed recovery, and authoritative GDN validation each remain later independent gates.
