# Banner AI four-banner corpus review

Status: **`oracle-review-pending`**, inactive, non-admitted, and non-dispatchable.

This V2 record extends the accepted local pending corpus side by side. It does not replace or
rewrite the historical three-fixture record, manifest, cap, authorization evidence, or binaries.
All annotations remain Codex drafts with `evidenceRole: codex-draft-unapproved`,
`reviewStatus: draft-unapproved`, and `humanApprovalAuthority: false`.

No image or image-derived content was transmitted externally. No OpenAI, provider, network, paid,
SDK, secret, execution authorization, release, request-plan, provider-call, or dispatch action
occurred.

## Historical evidence retained

The six V1 package binaries and their digests remain byte-for-byte unchanged. V2 imports and binds
the exact first-three pending-entry projection rather than recreating it.

- historical three-fixture pending-core SHA-256:
  `961331ea74f826d428a0aabcbf44378cd583856a3101a3a59495e97040aa8b3c`;
- historical three-image permission-statement SHA-256:
  `c70506656b23342c7410cc06b8b5a0dbd643699d9b6698d0629869c7e891632a`;
- historical V1 cap SHA-256:
  `409cbc9d8f62a03b87de35b15e9e044f11773c085eca80da74f25e3ba1fe5d00`;
- historical V1 profile SHA-256:
  `0f0b392165604c2ebb166e62e5b04c659dd60e7e941c400e623c8a70f5a9790f`;
- exact frozen V1 entry-projection SHA-256:
  `4a2145f7a8e501c34489f3330e417ce5bc39cd5728591832e97f3fe892d60a86`;
- recomputed V2 historical-scope wrapper SHA-256:
  `d0b886c2f9e041860887093c3c1c25a95a8018d26cca06c072aa68101b19d5dc`.

The new historical-scope wrapper records, but does not repurpose, the three existing entry-level
intake-evidence digests:

1. `792ae7f92fe57870d78b667e1f81b4187c5ce7552f913927bdf184aba7a9d13d`;
2. `262e5a7b51bceb82886739cf7cf1fb9bc343d4432ee755def959cf491a2f2399`;
3. `3d2c7eddf36a6ff6068601eb961b13d2895869c979e4ccd4abd05ad00f4858b1`.

## Fourth-image permission evidence

The exact supplied template is:

> I own or have permission to use [filename], it contains no sensitive/private information, and I
> authorize sending it to OpenAI solely for the capped Fabrica benchmark.

For this milestone, `[filename]` is contextually and exclusively resolved to
`banners-tests/4-no-text.jpeg`. The rendered statement is:

> I own or have permission to use banners-tests/4-no-text.jpeg, it contains no sensitive/private
> information, and I authorize sending it to OpenAI solely for the capped Fabrica benchmark.

Rendered-statement UTF-8 SHA-256:
`08ac203542aa678d0992b1ac997b42c7e9b187a1de65901be876ff043de82600`.

The separate fourth-image evidence binds only the fourth original/normalized source pair. Its
recomputed evidence SHA-256 is
`29a92d505c4432bf59f5520c24bbf79e45f4f0555c1e02feff970d3170c7282f`.
It authorizes local preparation and possible future transmission under all later safety gates; it
does not authorize transmission or execution in this milestone.

## Trusted fourth-image audit

The extension and filename were not trusted. The existing Banner structural parser and pinned
decoder established the following from bytes before intake:

| Finding                        | Result                                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| Actual container / MIME        | genuine byte-valid JPEG / `image/jpeg`                                                        |
| Dimensions / pixel count       | 738×255 / 188,190 pixels                                                                      |
| Original bytes                 | 15,312                                                                                        |
| Original SHA-256               | `af4ee315a16887692aaec4e972615535a086a906b43257eb1c78aa50212d31c3`                            |
| Current Banner raster limits   | pass                                                                                          |
| Stricter benchmark limits      | pass                                                                                          |
| Original ancillary metadata    | 14-byte JFIF payload only; no EXIF/ICC/IPTC/XMP/comment/profile/orientation metadata detected |
| Collision against V1 six files | none                                                                                          |
| Eight-file collision result    | all eight original/normalized digests unique                                                  |

Local visible-pixel review recorded each required finding explicitly:

- semantic text: none observed;
- lettering: none observed;
- watermark: none observed;
- logo lettering: none observed;
- URL: none observed;
- label: none observed;
- signature: none observed;
- person: none observed;
- private content: none observed.

The cyan angular decorations resemble abstract letterforms in places. This is a mandatory human
review flag, not automatic evidence of semantic text. The fixture is therefore a draft zero-text
candidate, not an approved zero-text oracle.

## Exact package copy and canonical normalization

The package original is an exact copy of the authorized intake. Trusted normalization preserved
the oriented pixels and 738×255 dimensions, emitted deterministic non-interlaced RGBA PNG bytes,
and stripped all ancillary chunks.

| Artifact                 | Package path                                                                             | MIME         |   Bytes | SHA-256                                                            | Ancillary |
| ------------------------ | ---------------------------------------------------------------------------------------- | ------------ | ------: | ------------------------------------------------------------------ | --------: |
| Exact package original   | `packages/banner-ai/test/fixtures/real-model-benchmark/original/banner-no-text-v1.jpeg`  | `image/jpeg` |  15,312 | `af4ee315a16887692aaec4e972615535a086a906b43257eb1c78aa50212d31c3` |        14 |
| Canonical normalized PNG | `packages/banner-ai/test/fixtures/real-model-benchmark/normalized/banner-no-text-v1.png` | `image/png`  | 125,894 | `40f8a1c4312ec86cb4e38e16b9a423e85c2a9e3cf5f98a4bc510c23f3d4cf073` |         0 |

## Draft-unapproved zero-text worksheet

Boxes use `(x, y, width, height)` in normalized basis points from 0 to 10,000. Decorations are
grouped rather than instance-segmented, and every label, role, box, grouping, and animation note
requires human correction or approval.

Proposed background: `flat-peach-field-with-framed-cream-panel`.

| Draft layer                   | Proposed role | Proposed box           | Animation usefulness                                                 |
| ----------------------------- | ------------- | ---------------------- | -------------------------------------------------------------------- |
| Flat peach outer background   | background    | `(0,0,10000,10000)`    | Static anchor for restrained decorative motion                       |
| Cream panel and soft shadow   | subject       | `(450,1650,9100,6900)` | Subtle depth offset                                                  |
| Thin cyan/gray rounded frame  | foreground    | `(500,1750,8950,6500)` | Subtle border reveal                                                 |
| Grouped cyan angular shapes   | decoration    | `(400,1650,9150,6700)` | Independent drift/rotation only after instance and letterform review |
| Grouped coral/peach sunbursts | decoration    | `(250,1350,9300,7250)` | Restrained independent rotation or parallax                          |

Explicit visible-text result: **no semantic text observed**.

The draft text-observation set is explicitly empty: `observations: []`. It is nested inside a
`codex-draft-unapproved` record, carries `humanApprovalAuthority: false`, has no human-oracle
version/layer/occurrence fields, and is structurally incompatible with
`ProviderNeutralHumanOracleV1Schema`.

Uncertainty flags:

- layer boxes are approximate;
- decorations are grouped rather than instance-segmented;
- frame, panel, and shadow boundaries require human confirmation;
- cyan angular shapes have letterform-like ambiguity;
- a human must explicitly confirm the zero-text result.

## Disabled four-fixture cap revision

The V2 cap revision is disabled ceilings-only evidence. It supersedes only the pending
three-fixture ceilings; it does not modify or supersede the V1 profile, authorization schema,
execution logic, or execution ledger.

| Ceiling                         | V2 value                  |
| ------------------------------- | ------------------------- |
| Fixtures                        | 4                         |
| Successful runs per fixture     | 2                         |
| Required successful runs        | 8                         |
| Maximum provider calls          | 12                        |
| Maximum cost per call           | 100,000 micro-USD         |
| Maximum total cost              | 1,200,000 micro-USD       |
| Maximum attempted-call duration | 60 seconds                |
| Maximum logical-run duration    | 120 seconds               |
| Maximum total duration          | 800 seconds               |
| Actual retry policy             | zero retry, timeout final |

The numerical ceilings retain 1 retry and 2 failed attempts per fixture, with aggregate ceilings
scaled to 4. They do not grant retry authority. Exact `BigInt` arithmetic proves
`12 × 100000 = 1200000` micro-USD. Cap-revision SHA-256:
`441f97ae556252b601e8e788896e552f2215bf0ffe1d48f9a36d144fe6fa9295`.

## V2 manifest and authorization bindings

The V2 manifest contains exactly four fixed unique entries and binds the ordered eight source
digests. The first three entries are the exact frozen V1 projection. The fourth is the new
zero-text candidate. The combined permission binding retains two distinct statement/evidence
scopes and the disabled V2 cap.

- combined intake-permission binding SHA-256:
  `bc96823dfbfaaa2bc2e910f2e190caa37b9dff7566f4d4298f9e088f5931b1cc`;
- four-fixture pending-core SHA-256:
  `fa3ecc650a14611e6274b123b65ee7fcf34fe9443cb1125655b70393195e7f51`;
- final pending-core/combined-authorization binding SHA-256:
  `bb6e0cd73e3b043bd69d58f3808be53433920ced6ae3d6ead0911aa82fe54acf`.

The binding order is acyclic: cap revision, fourth-image evidence, combined historical/fourth
permission binding, pending core, then final core/combined binding. Every stored digest is checked
against a schema-recomputed canonical projection.

The manifest and local verifier expose `active: false`, `dispatchable: false`,
`admissionAuthority: false`, `requestPlanAuthority: false`, `providerCallAuthority: false`, and
`dispatchAuthority: false`. The production execution registry remains exactly empty. No V2 server
registry or loader is exported from the package root.

## Human decisions still required

1. Classify the fourth source as **user-owned** or **explicitly licensed for OpenAI evaluation**
   and record the supporting evidence reference.
2. Confirm or reject the JFIF-only metadata finding and the local privacy/right findings.
3. Decide explicitly whether any cyan angular decoration is intended as semantic lettering, a
   logo, or a mark. If any semantic text exists, reject the proposed zero-text classification.
4. Approve or correct the background, every semantic layer label/role/box, grouping choice, and
   animation-usefulness note.
5. Create separate human-approved zero-text oracle evidence, including an explicitly approved
   empty occurrence set if appropriate. The Codex draft cannot be promoted automatically.
6. Complete every outstanding human license/privacy/text/layer/oracle decision for the historical
   three fixtures documented in the unchanged three-banner review.
7. In a later, separately authorized provider-free milestone, prepare any dated official provider
   evidence, exact worst-case cost proof, transmission approvals, benchmark authorization, and
   manual release. None exists or is implied here.

Until those decisions are recorded and independently accepted, any image, metadata, digest,
statement, evidence, cap, projection, manifest, or binding drift fails closed and the four-entry
corpus remains local, pending, inactive, and non-dispatchable.
