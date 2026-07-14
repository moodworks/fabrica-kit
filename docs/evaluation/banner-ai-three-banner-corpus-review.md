# Banner AI three-banner corpus review

Status: **`oracle-review-pending`**, inactive, non-admitted, non-dispatchable.

This is a local corpus-preparation record. The annotations below are Codex drafts with
`evidenceRole: codex-draft-unapproved`, `reviewStatus: draft-unapproved`, and
`humanApprovalAuthority: false`. They are not human oracle evidence.

No image or image-derived content was transmitted externally. No OpenAI, provider, network, paid,
SDK, secret, authorization, release, request-plan, or dispatch action occurred.

## Intake authorization and hard state

The exact user statement bound separately to every entry is:

> I own or have permission to use all three images in banners-tests, they contain no sensitive/private information, and I authorize sending them to OpenAI solely for the capped Fabrica benchmark.

UTF-8 SHA-256:
`c70506656b23342c7410cc06b8b5a0dbd643699d9b6698d0629869c7e891632a`.

This records an `owner-or-permitted` assertion and a future OpenAI-only benchmark scope. A human
must still classify each image as either user-owned or explicitly licensed, confirm privacy and
rights findings, and approve an oracle. It is not a live benchmark authorization. The manual
control remains engaged at control
`banner-ai-real-model-benchmark-kill-switch-v1`, revision `1`, SHA-256
`caf0929d12747f33473c536ef5e9e87b9ed610f8ef99943bdc9f03bb61518c9a`.

Bound ceilings remain 3 fixtures, 2 successful runs per fixture, 6 successful runs, at most 9
calls, 100,000 micro-USD per call, 900,000 micro-USD total, 60 seconds per attempted call, 120
seconds per logical run, and 600 seconds total. Numerical ceilings also retain at most 1 retry per
fixture, 3 retries total, 2 failed attempts per fixture, and 3 failed attempts total; the committed
default remains zero retry. These are ceilings only and grant no call or retry authority.

## Source audit

Type and dimensions were established from bytes with the trusted Banner raster parser and pinned
normalizer, not from file extensions or declared MIME values. All six original/normalized hashes
are unique.

| Fixture ID             | Local intake       | Detected type | Dimensions | Original bytes | Original SHA-256                                                   | Limits / duplicate result                                          | Local metadata and privacy findings                                                                                                                                                                            |
| ---------------------- | ------------------ | ------------- | ---------: | -------------: | ------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `banner-person-v1`     | `1-person.png`     | `image/png`   |    876×221 |        229,241 | `d9a5a64f4fb4353a11d2fac605049b8cf1565ee8a056cf792f0181d1798189d3` | Passes current Banner and stricter benchmark intake limits; unique | 878 ancillary bytes; ICC/Apple profile data, EXIF `Screenshot` user comment, and Adobe XMP detected. Visible adult likeness, placeholder URL, logo, and faint repeated watermark text require human decisions. |
| `banner-product-v1`    | `2-product.jpg`    | `image/jpeg`  |   2015×900 |        217,384 | `ce1be4eacbd65763d1d2b2835f9ad49c50cd9b3f56edc4a6a289822965bf09c5` | Passes current Banner and stricter benchmark intake limits; unique | 888 ancillary bytes; Photoshop XMP, unique document/instance identifiers, EXIF, and Adobe metadata detected. Visible headline and candle brand/label text make this ineligible for the no-text slot.           |
| `banner-text-heavy-v1` | `3-text-heavy.jpg` | `image/jpeg`  |    416×522 |         25,417 | `886afa4806fd252175d08a56eb5cae4989f3ac59c6a0c6e0a59f8a6d61195d77` | Passes current Banner and stricter benchmark intake limits; unique | 14-byte JFIF payload only was locally detected. Visible HALF PRICE BANNERS branding and faint watermark text require rights/transcription review.                                                              |

The package originals are exact copies. The local root intake remains unchanged and is ignored by
Git. Existing trusted normalization preserved oriented pixels and dimensions and emitted canonical
PNG files with zero ancillary metadata.

| Fixture ID             | Package original                                                                          | Canonical normalized PNG                                                                    | Normalized bytes | Normalized SHA-256                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------: | ------------------------------------------------------------------ |
| `banner-person-v1`     | `packages/banner-ai/test/fixtures/real-model-benchmark/original/banner-person-v1.png`     | `packages/banner-ai/test/fixtures/real-model-benchmark/normalized/banner-person-v1.png`     |          241,013 | `6e3175cdd260fde33a3885945eb6f8831da3905afbc723f684035f411dc6d699` |
| `banner-product-v1`    | `packages/banner-ai/test/fixtures/real-model-benchmark/original/banner-product-v1.jpg`    | `packages/banner-ai/test/fixtures/real-model-benchmark/normalized/banner-product-v1.png`    |        1,984,404 | `a38db6f627ee275eabf7643c99a83aac5e1ac77bbfe1b1abcc24112c6a04e69a` |
| `banner-text-heavy-v1` | `packages/banner-ai/test/fixtures/real-model-benchmark/original/banner-text-heavy-v1.jpg` | `packages/banner-ai/test/fixtures/real-model-benchmark/normalized/banner-text-heavy-v1.png` |          166,461 | `181e4c3762b79b5dfcbdb21c6c873ede8b32bf85dfe98fdecc13d59fb8cbcb62` |

The pinned pending-manifest whole-core SHA-256 is
`961331ea74f826d428a0aabcbf44378cd583856a3101a3a59495e97040aa8b3c`.

## Draft-unapproved visual worksheets

Boxes use `(x, y, width, height)` in normalized basis points from 0 to 10,000. Every box is a
Codex visual estimate requiring human correction or approval.

### `banner-person-v1`

Background draft: `geometric-graphic-background`.

Proposed layers:

- geometric red/orange/cream background `(0,0,10000,10000)`;
- left headline/body-copy block `(300,700,3100,8700)`;
- Learn More button and website line `(3900,5900,1900,3200)`;
- recognizable adult in business attire `(6400,0,2200,10000)`;
- Your Logo placeholder mark `(8850,7650,1050,1950)`.

Proposed exact visible text:

| Draft transcription                                                              | Proposed box                                                                       |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `BUILD`                                                                          | `(400,900,1200,1350)`                                                              |
| `YOUR`                                                                           | `(400,2450,1250,1250)`                                                             |
| `BUSINESS`                                                                       | `(400,4100,1950,1600)`                                                             |
| `Lorem ipsum dolor sit` / `amet, consectetur adipiscing` / `elit sed non risus.` | `(400,6950,2600,2400)`                                                             |
| `Learn More`                                                                     | `(4150,6250,1150,950)`                                                             |
| `www.yourwebsite.com`                                                            | `(3900,8250,1800,750)`                                                             |
| `YOUR` / `LOGO`                                                                  | `(8950,7950,850,1500)`                                                             |
| Faint repeated diagonal watermark text                                           | **Incomplete—human transcription and occurrence boxes required; no text guessed.** |

Review flags: adult likeness/model-release decision; visible URL/tracking decision; faint
watermark transcription/license decision; all layer and text boxes approximate.

### `banner-product-v1`

Background draft: `photographic-shallow-depth-of-field-background`.

Proposed layers:

- blurred light interior and marble surface `(0,0,10000,10000)`;
- blurred plants and patterned panel `(200,500,5800,4700)`;
- foreground candle jar and label `(3000,3900,2200,5900)`;
- right-side headline `(6100,2200,3000,1400)`.

Proposed exact visible text:

| Draft transcription             | Proposed box           |
| ------------------------------- | ---------------------- |
| `blurry background`             | `(6150,2550,2750,650)` |
| `TONKA + OUD`                   | `(3500,6650,1100,500)` |
| `candles, candles, candles co.` | `(3500,7150,1100,300)` |
| `soy wax candle`                | `(4050,8100,600,300)`  |
| `NET WT. 8 OZ`                  | `(4050,8500,600,300)`  |

Review flags: confirm brand/label text and rights; all boxes approximate; **this fixture contains
visible text and is ineligible for the frozen `no-text-layered` scenario.**

### `banner-text-heavy-v1`

Background draft: `photographic-product-mockup-on-neutral-background`.

Proposed layers:

- neutral gray product-mockup background/floor `(0,0,10000,10000)`;
- retractable banner stand hardware `(1900,300,6100,9600)`;
- brand mark, red header art, and title `(2150,800,5650,3400)`;
- numbered banner-option list `(2200,4300,5550,4500)`;
- red lower accent and stand base `(2000,8250,5900,1700)`.

Proposed exact visible text:

| Draft transcription                            | Proposed box                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------- |
| `HALF PRICE` / `BANNERS`                       | `(5600,850,1450,950)`                                                 |
| `BANNER` / `OPTIONS`                           | `(2650,2000,4500,1250)`                                               |
| `1`                                            | `(2600,4650,500,450)`                                                 |
| `Large Format Double-` / `Sided Banners`       | `(3450,4600,4200,700)`                                                |
| `2`                                            | `(2600,5600,500,450)`                                                 |
| `Large Format Vinyl` / `Banners`               | `(3450,5550,4200,700)`                                                |
| `3`                                            | `(2600,6550,500,450)`                                                 |
| `Large Format Double-` / `Sided Fence Banners` | `(3450,6500,4300,750)`                                                |
| `4`                                            | `(2600,7500,500,450)`                                                 |
| `Large Format Mesh` / `Banners`                | `(3450,7450,4200,700)`                                                |
| Faint watermark text                           | **Incomplete—human transcription and box required; no text guessed.** |

Review flags: confirm all brand/title/list text, punctuation, line breaks, and boxes; determine the
faint watermark and its rights; all boxes approximate.

## Exact user decisions required next

1. For each fixture, classify the rights basis as **user-owned** or **explicitly licensed for
   OpenAI evaluation**, and provide the supporting evidence reference.
2. Confirm or reject the local metadata/privacy findings. For the person banner, decide likeness
   and model-release permission, whether the visible placeholder URL is acceptable or tracking
   content, and whether the watermark permits use. For the product and text-heavy banners, decide
   brand, label, and watermark rights.
3. Approve or correct every proposed semantic layer label, role, and normalized box.
4. Approve or correct every exact visible-text transcription, line break, and normalized box.
   Supply the faint watermark transcriptions and occurrence boxes where they can be determined, or
   explicitly mark them unresolved and reject the fixture.
5. Approve or correct each background classification and scenario classification.
6. Supply a genuine licensed layered banner with exactly zero visible text. All three current
   images visibly contain text, so this corpus cannot satisfy the frozen three-scenario contract.
7. In a later provider-free milestone only, prepare fresh human admission/oracle evidence and the
   dated OpenAI official-evidence, exact cost proof, transmission approvals, authorization packet,
   and manual release. None exists or is implied here.

Until all applicable decisions are recorded and independently reviewed, drift or substitution of
the images, manifest, authorization statement, rights/privacy findings, provider scope, caps,
profile/candidate/prompt/policy/pricing/workflow pins, or engaged manual-control revision fails
closed and the corpus remains `oracle-review-pending`.
