# Phase 3B: provider-free product-gate evaluation milestone V2

Status: frozen implementation record; local candidate only

Date: 2026-07-30

Publication status: uncommitted, non-authoritative, and not reviewed for publication

## 1. Starting identity and authority

This additive milestone starts from the locally verified repository state below without fetching:

- repository: `moodworks/fabrica-kit`
- baseline branch: `main`
- baseline `HEAD`, local `main`, and local `origin/main`:
  `2fb199161ac8b3d6497275d1beab084dabbecef1`
- first parent: `ebeb60e7802269609ad29e8b74d0e198a635e83a`
- second parent: `e5c36c61254c149530189910a936c5b2171c5bde`
- tree: `ef95ec2fbcae6698d648de4451ac5cfd7325d5fc`
- implementation branch: `banner-ai-product-gate-evaluation-provider-free-3b`

The session may create strict contracts, deterministic metadata fakes, pure scoring and budget
decisions, focused tests, and this record. It grants no authority to access a holdout, research or
choose a provider, transmit an image, inspect a credential, make a paid request, use RunPod, SAM,
or a GPU, perform GDN research or validation, run a real evaluation, publish, deploy, commit, push,
or open or modify a pull request.

Phase 3A V1 contracts and behavior remain frozen. Phase 3B is implemented only through new V2
direct-import modules. No package-root or browser export is added.

## 2. Contract identities and source boundary

The provider-free V2 boundary consists of:

- `product-gate-corpus-v2.ts`: corpus strata, metadata-only case admission, duplicate disposition,
  oracle binding, structural validation, and synthetic contract fakes
- `product-gate-scorecards-v2.ts`: vision, segmentation, and background pass evaluation; required
  output disposition; frozen targets; aggregate verdict precedence
- `product-gate-human-review-v2.ts`: identity-bound blind review and deterministic adjudication
- `product-gate-run-manifest-v2.ts`: cost truth, separate budgets, zero retry, inert run authority,
  canonical provider-free run manifests, and deterministic fake enforcement

The closed contract identities are:

- `banner-ai-product-gate-holdout-structure-v2`
- `banner-ai-product-gate-holdout-corpus-content-v2`
- `banner-ai-product-gate-case-admission-v2`
- `banner-ai-product-gate-frozen-thresholds-v2`
- `banner-ai-product-gate-budget-policy-v2`
- `banner-ai-product-gate-provider-free-authority-v2`
- `banner-ai-product-gate-provider-free-run-manifest-v2`
- runner identity `provider-free-deterministic-contract-fake-v2`

Identity-bearing records use canonical JSON and SHA-256 projections. The admission binding covers
the complete classification, source identity, normalization identity, oracle, provenance, rights,
privacy, duplicate, attestation, and transmission records. Schemas are strict and reject unknown
fields. Synthetic records are explicitly structural-validation-only, contain no source bytes or
paths, and grant no holdout, provider, transmission, execution, paid-call, or GDN authority.

## 3. Frozen corpus matrix

The future final holdout denominator is exactly 18 cases. The four existing development fixtures
remain a separate biased development corpus and are forbidden from V2 holdout entries.

The primary matrix is the Cartesian product of three mutually exclusive content families and three
difficulty levels. Each of the nine primary strata contains exactly two cases:

| Content family                                  | Easy | Moderate | Hard | Total |
| ----------------------------------------------- | ---: | -------: | ---: | ----: |
| Subject/product-led with light-to-moderate copy |    2 |        2 |    2 |     6 |
| Text-heavy                                      |    2 |        2 |    2 |     6 |
| Layered graphic with no text                    |    2 |        2 |    2 |     6 |

The family contract is a discriminated union: subject/product-led entries carry exactly one
person-led or product-led subtype and light-to-moderate copy; text-heavy entries carry the
text-heavy profile; layered-graphic entries require no visible text. Contradictory family fields
cannot coexist.

The totals are fixed:

- 18 cases and 9 two-case primary strata
- 6 text-heavy and 12 non-text-heavy cases
- 6 easy, 6 moderate, and 6 hard cases
- subject/product-led: exactly 3 person-led and 3 product-led cases
- every stratum: 1 exact-solid-eligible and 1 reconstruction-required case
- overall: 9 exact-solid-eligible and 9 reconstruction-required cases

Difficulty is bound to these anchors:

- easy: opaque, high contrast, clean separation, little overlap, and no fine or translucent edge
- moderate: partial overlap, shadows, thin components, moderate texture, or edge ambiguity
- hard: hair or fur, translucency, reflections, fine strokes, touching or occluded elements, or
  high foreground/background similarity

A rejected case must be replaced before structural validation can succeed; the denominator never
shrinks below 18.

## 4. Admission, rights, privacy, and duplicate disposition

Every case contract records source provenance and acquisition evidence; original source,
normalization, and oracle identities; ownership, public-domain/CC0, or qualifying-license basis;
permission for commercial evaluation, derivative cutouts or reconstruction, and provider
transmission; metadata and privacy review; likeness, trademark, logo, watermark, label, and visible
text clearance or not-present disposition; and confirmation that no credential, secret,
undisclosed client material, prohibited sensitive data, or tracking material remains.

Admission carries a dated attestation with reviewer role, evidence digest, approval status,
conflict declaration, and optional expiry. Provider transmission approval is a separate dated,
evidence-bound provider/model/endpoint-specific record. Recording either record cannot itself open
the holdout or authorize transmission.

Duplicate handling is closed:

- exact byte duplicates are rejected
- identical normalized pixels are rejected
- material near-duplicates within the holdout or against the development corpus are rejected
- crops, resizes, re-encodings, recolors, copy-only variants, and same-template creatives may be
  flagged as near-duplicate candidates
- a perceptual flag is only a candidate signal and never final admission truth
- every flagged candidate set requires a case-, reviewer-, and candidate-set-bound human
  disposition
- a human near-duplicate disposition rejects the case and requires replacement

Committed development-corpus original and normalized artifact identities are compared from frozen
V1 metadata, without reading or hashing fixture files. The V1 corpus has no normalized-pixel
identity, so cross-encoding pixel truth remains bound future admission evidence rather than being
fabricated. No perceptual-comparison dependency, asset loader, file path, image decoder, hash
operation over real assets, or admission executor is introduced.

## 5. Oracle and background-mode binding

Every oracle binds the relevant corpus identity, opaque case identity, original and normalized
source identities, normalized-pixel identity, oracle identity, and proposal identity. The corpus
identity derives from a non-recursive canonical projection of all case classifications, source and
normalization records, and structural oracle content.

An exact-solid-eligible oracle authorizes exactly one RGBA tuple. A deterministic solid fallback
passes only when the result repeats every binding and the exact RGBA value. Reconstruction-only
dimensions are then explicitly `N/A`, usability must be at least 3, and the result kind remains
`deterministic-solid-fallback`.

A reconstruction-required case cannot carry or use solid authorization. It passes background
scoring only when removed-object leakage, continuity, contamination, and usability are each at
least 3. No dimension is averaged. A transparent foreground cutout records foreground isolation
only and always fails the background requirement.

## 6. Vision and segmentation scoring

A valid vision result passes only when all of the following are true:

- every critical element is covered
- layer count and grouping are oracle-valid
- every required oracle layer is matched exactly once
- every matched layer has the correct semantic role
- every semantic role/name usefulness score is at least 3
- every required layer carries box evidence with IoU at least 5,000 basis points
- there are no extra layers
- there is no unresolved duplicate or fragment

Required box evidence is schema-required. Omitting it is an invalid-schema hard attempt failure,
not an inconclusive escape hatch.

Segmentation preserves the V1 six-dimensional 0-through-4 score contract and frozen anchors.
Every dimension must be at least 3; there is no average field. A duplicate, unresolved fragment,
or zero makes the result unusable. A score of 1 or 2 is repairable but cannot pass until a corrected
final result is rescored and every dimension passes. A useful corrected result may contain at most
one fragment combination and one qualifying minor mask correction. Severity 6, 7, or 8 is outside
the useful-result budget. Applied corrections require a `corrected-final` rescore, and every
retained minor mask correction binds a qualifying frozen V1 pixel-threshold assessment.

## 7. Missing output and aggregate verdict

Every admitted case remains in the denominator. A missing, failed, invalid, unsupported, or
unattempted mandatory output fails that requirement. Invalid schemas are hard attempt failures.
Incomplete evidence that can change a mandatory result is inconclusive.

`not-measurable` is reserved for missing authority, including an unadmitted holdout or missing
authoritative GDN evidence. Zero successes and invalid or incomplete denominators cannot produce a
pass. Failed and indeterminate attempts retain conservative accounted cost.

The aggregate verdict uses no weighted average and applies this exact order:

1. missing holdout or authoritative GDN authority: `not-measurable`
2. any mandatory target-bearing metric failure: `fail`
3. incomplete evidence capable of changing a mandatory result: `inconclusive`
4. every mandatory target-bearing metric passes: `pass`

First-attempt failure remains descriptive only. Observed real recovery remains a separate
`inconclusive` result with fewer than ten eligible natural events and cannot support a positive
real-recovery claim.

## 8. Frozen aggregate targets

The V2 target identity repeats, without changing, every Phase 3A threshold:

- useful-layer success: at least 15/18 and at least one success in every primary stratum
- product-gate E2E: at least 14/18
- successful latency: p50 at most 240,000 ms and p95 at most 420,000 ms
- terminal latency: maximum at most 600,000 ms
- gross/list cost per E2E success: at most 350,000 micro-USD
- final step failure: at most 10%; first-attempt failure remains descriptive
- authoritative export: first pass at least 17/18 and final pass exactly 18/18
- manual correction classes 1-7: at most 30% of produced decompositions
- major intervention classes 6-8: at most 10% of all 18 cases
- injected recovery: 100%
- observed real recovery: at least 90% with at least 10 eligible natural events
- replay reproducibility: 100%
- component repeat: matching classification and critical coverage on at least 5/6 predesignated
  cases

Integer cross-multiplication and V1 nearest-rank percentile semantics remain unchanged.

## 9. Human review and adjudication

Each case has two distinct independent primary reviewers. Both receive the identical content-bound
presentation, are provider/model-blind, and cannot access the other primary's scores before both
reviews are complete. Original primary records remain immutable and embedded unchanged.

A third review is required for any categorical disagreement or any shared numeric difference of at
least two. The third reviewer is distinct from both primaries, provider/model-blind, sees the same
presentation, does not access primary scores, and completes the review before primary scores are
revealed.

Resolution is deterministic per field:

- equal primary values remain unchanged
- a one-point numeric difference resolves to the lower primary score
- a triggered numeric difference resolves to the median of all three scores
- a categorical disagreement resolves to the third reviewer's category

A maintainer may occupy only one role for a case. A maintainer primary must be blind and must not
have selected the case, tuned against it, or created its oracle. A maintainer third reviewer cannot
be either primary. A non-maintainer third reviewer is preferred; a maintainer exception records a
sanitized reason. Every reviewer records a conflict declaration.

Shareable records use opaque case identities and sanitized rationales. Their strict safety
projection forbids source bytes, private paths, raw provider bodies, credential values, provider or
model identities, and private visual material. A separate explicitly non-shareable validation
package binds each review or adjudication back to the exact admitted corpus case; admitted IDs do
not enter shareable records.

## 10. Provider selection, cost, budgets, and retry

Provider candidates must later be eliminated using deterministic development and historical
evidence. Exactly one stack must be frozen before a future authorized holdout opening. Holdout
results may never compare or tune providers. This milestone chooses no provider, model, endpoint,
checkpoint, image, or stack and contains no transport or dispatch adapter.

Two budget concepts remain independent:

- outer execution kill switch: 13,100,000 gross/list micro-USD
- scored cost target: 350,000 gross/list micro-USD per E2E success

The outer ceiling does not relax the scored target. Fake enforcement blocks a next reservation
only when projected gross/list execution cost exceeds 13,100,000 micro-USD; it never dispatches.

Each attempt identity binds a manifest-derived run identity, case, stage, logical operation,
ordinal zero, and retry count zero. Cost decisions require a complete content-bound
expected-attempt inventory and a canonical terminal cost ledger with exactly one entry per expected
operation. Every scored E2E success record canonically binds all seven passing requirements and its
succeeded authoritative-validation attempt; an empty ledger or terminal status alone cannot claim
success.

Actual cost is accepted only with sanitized evidence bound unambiguously to the exact attempt and
a sanitized evidence-artifact digest.
Otherwise a calculated estimate is used; if neither exists, the full reservation is accounted.
Gross/list cost remains separate from credits and net account charges. Failed and indeterminate
attempts count toward scored cost, reservations, and the outer ceiling.

Retry count defaults to and is capped at zero. Every nonzero retry or retry-parent projection is
rejected. A later retry policy requires a separate versioned gate proving both idempotency and
billing semantics; V1 fake-recovery retry behavior is preserved unchanged and is not reused here.

## 11. RunPod, SAM, and GDN boundaries

The provider-free run authority is deliberately inert: provider stack not frozen, holdout unopened,
and provider research, holdout access, transmission, execution, paid call, network, credential,
RunPod, SAM, GPU, and authoritative GDN authorities all false. The manifest contains no holdout
case data and exposes no executable constructor.

No historical SAM file, identity, branch, deployment control, authorization behavior, or artifact
is changed. The existing text-heavy authorization is not generalized.

The internal validation identities remain exactly:

- `validator_provider_free_internal_v1`
- `internal-provider-free-not-gdn`

Internal provider-free validation cannot satisfy authoritative GDN evidence. GDN research, account
validation, upload, and authoritative execution remain a later separate gate.

## 12. Verification and handoff boundary

Focused V2 tests cover the exact corpus matrix, admission completeness, duplicate rejection,
structural scoring boundaries, missing and invalid output, aggregate precedence, reviewer
independence and adjudication, cost precedence, independent budgets, zero retry, inert authority,
unknown-field rejection, and canonical replay stability. The unchanged V1 focused suite and the
complete repository unit/integration, typecheck, build, lint, format, and diff checks remain
required before handoff.

No dependency installation or network access is allowed for verification. Only already-installed
local tooling may run. Any generated build output must be identified and removed by its exact safe
path before handoff.

The successful implementation state, if independently verified, remains unstaged and uncommitted
on the Phase 3B branch. The next gate is a separate independent Phase 3B review session. That review
does not itself authorize provider research, holdout opening, transmission, real evaluation,
RunPod, GDN, publication, commit, push, PR, merge, deployment, or release.
