# BannerSceneV1 semantic contract

- Status: Accepted for Phase 0A
- Contract version: `1`
- Date: 2026-07-12
- Scope: Persisted Banner AI scene semantics and export-reproduction inputs

## Purpose and boundary

`BannerSceneV1` is the durable, provider-neutral description of one editable banner at one canvas size. It is JSON data. It contains no executable code, framework request/session value, authentication or billing object, storage URL, queue message, or AI-provider response.

This document is normative. “Must” and “reject” describe runtime-validation requirements. All objects are closed, all arrays are bounded, and every cross-reference is validated before a scene can be persisted or exported.

The v1 scene supports only raster image layers, controlled animation presets, and three deterministic export targets. It does not support arbitrary CSS, HTML, JavaScript, keyframes, callbacks, expressions, prompts, remote fonts, remote assets, SVG, video, an arbitrary timeline, or natural-language animation generation.

## JSON and primitive rules

The persisted representation is UTF-8 JSON with these global rules:

- Every field shown for the selected object or union variant is required and non-null.
- No field is optional. `null` and `undefined` are invalid everywhere.
- Unknown object keys are invalid; validators do not strip them.
- Values are not coerced. Numeric strings, truthy values, and case variants are invalid.
- Numbers are finite JSON numbers. `NaN`, positive or negative infinity, and values outside the stated inclusive bounds are invalid. Negative zero is normalized to `0` before canonical serialization.
- Fields described as integers must satisfy `Number.isSafeInteger` as well as their narrower bound.
- String lengths are counted in Unicode code points unless the field is explicitly ASCII.
- Arrays preserve order and reject sparse entries.

The following branded primitives are used below:

```ts
type OpaqueId = string & { readonly __brand: "OpaqueId" };
// ASCII; 8..64 characters; /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/

type Sha256Hex = string & { readonly __brand: "Sha256Hex" };
// Exactly 64 lowercase hexadecimal characters; /^[0-9a-f]{64}$/

type UnitInterval = number;
// Finite; 0 <= value <= 1.

type PositiveInt32 = number;
// Integer; 1 <= value <= 2_147_483_647.

type Milliseconds = number;
// Integer milliseconds; narrower bounds are stated at each field.

type RgbaHex = string;
// Exactly #RRGGBBAA using uppercase hexadecimal; /^#[0-9A-F]{8}$/
```

Each semantic identifier type (`AssetId`, `AssetVersionId`, `LayerId`, `TrackId`, `ValidatorProfileId`, and the manifest identifiers) has the `OpaqueId` representation but is a distinct TypeScript brand. One identifier kind cannot be substituted for another without parsing.

## Exact closed schema

### Top-level scene

```ts
interface BannerSceneV1 {
  schemaVersion: 1;
  canvas: BannerCanvasV1;
  sourceAsset: AssetVersionRefV1;
  layers: readonly BannerLayerV1[];
  timeline: readonly AnimationTrackV1[];
  exportSettings: BannerExportSettingsV1;
}
```

The top-level object has exactly these five keys.

### Immutable asset-version reference

```ts
type RasterMediaTypeV1 = "image/jpeg" | "image/png";

interface AssetVersionRefV1 {
  assetId: AssetId;
  assetVersionId: AssetVersionId;
  sha256: Sha256Hex;
  mediaType: RasterMediaTypeV1;
  byteSize: number;
  pixelWidth: number;
  pixelHeight: number;
}
```

Asset-reference bounds and invariants:

- `byteSize` is an integer from `1` through `20_971_520` bytes (20 MiB).
- `pixelWidth` and `pixelHeight` are integers from `1` through `8_192` pixels.
- `pixelWidth * pixelHeight` must not exceed `40_000_000` pixels.
- `sha256` is the digest of the exact immutable encoded bytes identified by `assetVersionId`.
- Resolution is workspace-scoped outside the scene. The authoritative `AssetVersion` must belong to the current scene's project workspace and must match every embedded field exactly.
- If an `assetVersionId` occurs more than once in a scene, every occurrence must be byte-for-byte equal after canonical serialization. Conflicting metadata is invalid.
- The scene contains no path, bucket, signed URL, or remote URL. Storage resolution is an adapter responsibility.
- `sourceAsset.mediaType` may be `image/jpeg` or `image/png`.
- Phase 1A normalizes accepted JPG and PNG uploads to metadata-free PNG before persistence, so its newly ingested source references are `image/png`; the broader v1 contract still permits a previously validated immutable JPEG reference.
- Every layer asset must be `image/png`. A v1 extracted layer is a decoded and validated PNG; the semantic contract does not claim that every pixel has alpha.
- An image background may be `image/jpeg` or `image/png`.

### Canvas and closed background union

```ts
interface BannerCanvasV1 {
  width: number;
  height: number;
  background: BackgroundDefinitionV1;
}

type BackgroundDefinitionV1 =
  | {
      kind: "transparent";
    }
  | {
      kind: "solid";
      color: RgbaHex;
    }
  | {
      kind: "image";
      asset: AssetVersionRefV1;
      fit: "cover" | "contain";
      positionX: UnitInterval;
      positionY: UnitInterval;
      opacity: UnitInterval;
    };
```

Canvas bounds and rendering semantics:

- `width` and `height` are integer logical CSS pixels from `1` through `4_096`.
- `width * height` must not exceed `16_777_216` pixels.
- The coordinate origin is the canvas top-left. Positive x moves right and positive y moves down.
- `transparent` produces an alpha-zero canvas before layers are composited.
- `solid` fills the canvas with the exact non-premultiplied sRGB `#RRGGBBAA` value.
- `image` preserves the source aspect ratio. `cover` fills and centrally crops according to `positionX`/`positionY`; `contain` fits the whole image and leaves uncovered pixels transparent. `0` aligns the source's left/top edge, `0.5` centers it, and `1` aligns its right/bottom edge. `opacity` multiplies image alpha.
- The background is not a `BannerLayerV1`, has no `LayerId`, and cannot be an animation target in v1.
- Canvas acceptance does not imply eligibility for a particular advertising network. A versioned validator profile may impose a smaller size set.

### Layers, geometry, transform, order, and controls

```ts
interface BannerLayerV1 {
  id: LayerId;
  name: string;
  order: number;
  included: boolean;
  visible: boolean;
  opacity: UnitInterval;
  asset: AssetVersionRefV1;
  frame: LayerFrameV1;
  transform: LayerTransformV1;
}

interface LayerFrameV1 {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LayerTransformV1 {
  anchorX: UnitInterval;
  anchorY: UnitInterval;
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  rotationDegrees: number;
}
```

Layer collection and identity rules:

- `layers` contains from `1` through `64` entries. This is scene/editor capacity, not an analysis-proposal target.
- Layer IDs are unique within the scene.
- `order` is an integer from `0` through `63`. For `N` layers, orders are unique and are exactly the contiguous set `0..N-1`.
- The array is stored in ascending `order`; a validator rejects rather than silently sorting it. Order `0` is painted first and is visually behind higher orders.
- A name contains `1` through `80` Unicode code points, is NFC-normalized, has no leading or trailing Unicode whitespace, contains no Unicode control character, and contains none of U+202A–U+202E or U+2066–U+2069. Names need not be unique; identity is the layer ID. Names are always escaped and treated as plain text by a UI or exporter.
- `asset.mediaType` is exactly `image/png`.

`included`, `visible`, and `opacity` have intentionally different meanings:

- `included: false` removes the layer from the rendered/exported composition. Its bytes are not packaged solely for that layer, and all of its animation tracks are ignored by rendering. The layer and valid tracks remain in the persisted scene so an editor can reverse the decision in a new scene version.
- `included: true, visible: false` retains the layer and its immutable asset in the export graph but suppresses all of its pixels for the entire render. Preset tracks cannot turn visibility on in v1.
- `included: true, visible: true` renders the layer. `opacity` multiplies its source alpha before an animation's fade factor.
- `opacity: 0` is valid and transparent but does not alter inclusion or visibility.

Geometry and transform bounds:

- `frame.x` and `frame.y` are finite logical pixels from `-16_384` through `16_384`.
- `frame.width` and `frame.height` are greater than `0` and no greater than `16_384` logical pixels.
- Before transform, the frame must intersect the canvas: `x < canvas.width`, `y < canvas.height`, `x + width > 0`, and `y + height > 0`.
- The asset is mapped to the frame without preserving its encoded aspect ratio. The frame is the explicit scene geometry.
- `translateX` and `translateY` are logical pixels from `-8_192` through `8_192`.
- `scaleX` and `scaleY` are from `0.01` through `8`, inclusive. Negative scale and a zero scale are invalid in v1.
- `rotationDegrees` is from `-360` through `360`, inclusive. Positive rotation is clockwise in the y-down coordinate system.
- `anchorX` and `anchorY` select the transform anchor within the untransformed frame; `(0,0)` is top-left and `(1,1)` is bottom-right.

For an asset-space point `(u, v)`, first map it linearly into the untransformed frame as point `p`. Let `a = (x + anchorX * width, y + anchorY * height)`. The base rendered point is:

```text
p' = a + (translateX, translateY) + R(rotationDegrees) * S(scaleX, scaleY) * (p - a)
```

Scale is applied first, then clockwise rotation about the anchor, then translation. Exporter-version identity fixes pixel sampling, color conversion, and rounding; those implementation details do not change the scene geometry.

### Controlled animation tracks

```ts
interface AnimationTrackV1 {
  id: TrackId;
  targetLayerId: LayerId;
  preset: AnimationPresetV1;
  timing: AnimationTimingV1;
}

interface AnimationTimingV1 {
  startMs: Milliseconds;
  durationMs: Milliseconds;
  iterations: number;
  iterationMode: "restart" | "alternate";
  easing: "linear" | "ease-in" | "ease-out" | "ease-in-out";
}

type AnimationPresetV1 =
  | {
      kind: "fade";
      presetVersion: 1;
      fromFactor: UnitInterval;
      toFactor: UnitInterval;
    }
  | {
      kind: "slide";
      presetVersion: 1;
      offsetX: number;
      offsetY: number;
    }
  | {
      kind: "float";
      presetVersion: 1;
      axis: "x" | "y";
      distancePx: number;
    }
  | {
      kind: "pulse";
      presetVersion: 1;
      fromScale: number;
      toScale: number;
    }
  | {
      kind: "flutter";
      presetVersion: 1;
      fromDegrees: number;
      toDegrees: number;
    };
```

Timeline bounds and reference rules:

- `timeline` contains from `0` through `128` tracks; each layer is targeted by at most four tracks.
- Track IDs are unique. Every `targetLayerId` resolves to exactly one layer in the same scene. A track targeting an excluded or hidden layer remains structurally valid but has no visible effect under the rules above.
- The array is stored by ascending `(timing.startMs, targetLayerId, id)` tuple, comparing identifiers by ASCII code unit. A validator rejects rather than silently reorders it.
- `startMs` is an integer from `0` through `29_900`.
- `durationMs` is an integer from `100` through `10_000`.
- `iterations` is an integer from `1` through `20`.
- A track's exclusive end is `startMs + durationMs * iterations`, which must not exceed `30_000` milliseconds.
- The scene timeline duration is the maximum track end, or `0` when there are no tracks.

Preset parameter bounds and channels:

| Preset | Bounds | Channel | Forward-iteration effect |
| --- | --- | --- | --- |
| `fade` | Both factors `0..1`; values must differ | opacity | Interpolate opacity multiplier from `fromFactor` to `toFactor` |
| `slide` | Each offset `-4_096..4_096` px; at least one is nonzero | translation | Interpolate additive translation from `(offsetX, offsetY)` to `(0, 0)` |
| `float` | `distancePx` is `-512..512` px excluding `0` | translation | Interpolate additive translation from `0` to the signed distance on `axis` |
| `pulse` | Each scale `0.5..2`; values must differ | scale | Interpolate a uniform multiplicative scale from `fromScale` to `toScale` |
| `flutter` | Each angle `-45..45` degrees; values must differ | rotation | Interpolate an additive clockwise angle from `fromDegrees` to `toDegrees` |

Tracks on the same layer and channel must not have overlapping half-open active intervals `[startMs, endMs)`. Adjacent intervals are valid. Tracks on different channels may overlap. This prevents ambiguous animation composition without limiting a layer to one preset over its whole lifetime.

Animation evaluation is deterministic:

1. Before a track starts and at or after its exclusive end, that track contributes its channel's neutral value: opacity factor `1`, translation `(0,0)`, scale factor `1`, or rotation `0`.
2. During an iteration, normalized progress runs from `0` toward `1`. `restart` runs every iteration forward. `alternate` runs zero-based even iterations forward and odd iterations backward.
3. The closed easing name is applied to normalized progress. The curves are `linear`, cubic-bezier `(0.42,0,1,1)` for `ease-in`, `(0,0,0.58,1)` for `ease-out`, and `(0.42,0,0.58,1)` for `ease-in-out`.
4. Linear interpolation of the selected preset parameters produces a channel delta or factor.
5. Animation translation is added to the base translation. Animation scale multiplies each base scale. Animation rotation is added to base rotation. A fade factor multiplies base layer opacity. The transform formula otherwise remains the one defined above.

No track contains raw keyframes, CSS property names, easing numbers, scripts, expressions, prompt text, or provider instructions.

### Safe, closed export settings

```ts
interface SingleExitInteractionV1 {
  kind: "single-exit";
  destinationUrl: SafeHttpUrl;
}

type BannerInteractionV1 =
  | { kind: "none" }
  | SingleExitInteractionV1;

interface ValidatorProfileRefV1 {
  validatorProfileId: ValidatorProfileId;
  validatorProfileVersion: PositiveInt32;
  rulesSha256: Sha256Hex;
}

type BannerExportSettingsV1 =
  | {
      kind: "regular-html";
      profileVersion: 1;
      interaction: BannerInteractionV1;
    }
  | {
      kind: "gdn-html5";
      profileVersion: 1;
      interaction: BannerInteractionV1;
      validatorProfile: ValidatorProfileRefV1;
    }
  | {
      kind: "static-png";
      profileVersion: 1;
      frameTimeMs: Milliseconds;
    };
```

`SafeHttpUrl` is the canonical serialization of a WHATWG URL with all of these properties:

- ASCII length from `1` through `2_048` characters after parsing and serialization;
- scheme exactly `https:` or `http:`;
- a non-empty hostname;
- empty username and password;
- no ASCII control or whitespace character;
- an absent port or a numeric port from `1` through `65_535`;
- the input string exactly equals the parser's serialized `href`.

`javascript:`, `data:`, `blob:`, `file:`, protocol-relative, relative, credential-bearing, and non-canonical URLs are rejected. The destination is inert metadata during preview and validation; neither process fetches it.

Export invariants:

- `regular-html` and `gdn-html5` are generated solely by a versioned deterministic exporter. The scene cannot supply source code, template paths, dependency URLs, click-handler code, or package file names.
- A `gdn-html5` export must resolve the exact validator profile and rules digest in `validatorProfile`. Missing or mismatched profiles fail closed. This contract does not invent current Google Display Network rules; a separately verified project profile supplies them.
- A `static-png.frameTimeMs` is an integer from `0` through the scene timeline duration. It must be `0` when the timeline is empty. The renderer samples the state at that millisecond before applying the exclusive-end reset rule; the value `timelineDuration` therefore samples the neutral post-animation state.
- GIF is absent from v1 and remains deferred.
- Export bundles are self-contained. They contain no remote assets, fonts, stylesheets, scripts, imports, or runtime network requests. A single-exit URL is user-activated navigation, not a render dependency.

## Proposal limit versus scene capacity

The analysis workflow and the scene schema have different cardinalities:

- One initial analysis may return at most five useful proposed visual parts in total. A proposed reconstructed background counts as one part even though it maps to `canvas.background` rather than `layers`.
- A successful proposal contains at least one part. When no useful part exists, the workflow returns a structured `no_useful_layers` result and does not create a misleading successful scene.
- The product aim of approximately three to five useful parts for suitable inputs is a workflow-quality goal, not a `BannerSceneV1` minimum.
- After user selection, combination, replacement, or later editing, a scene may contain from one through 64 foreground layers. The validator does not cap a valid edited scene at five.

For example, a proposed reconstructed background, body, left wing, and right wing are four proposed parts and produce one canvas background plus three scene layers.

## Strict parsing and cross-field validation

Validation has two fail-closed stages:

1. A pure structural parser validates exact keys, union discriminators, primitive types, bounds, collection order, uniqueness, arithmetic invariants, and all in-document layer/track references.
2. A workspace-scoped resolver validates every asset version and validator profile against persistence, including ownership, media metadata, immutable digest, and version/rules digest.

No partially valid scene is persisted. A validation issue has a stable code, a JSON Pointer path, and a safe diagnostic message. Multiple independent issues may be returned together, but invalid values are never silently repaired, clamped, sorted, renamed, deduplicated, or stripped.

Cross-field checks include all of the following:

- canvas and asset pixel-area limits;
- background and layer media restrictions;
- repeated asset-reference equality;
- contiguous layer order and stored array order;
- frame/canvas intersection;
- unique IDs and resolving target references;
- timeline stored order, per-layer count, interval end, and same-channel overlap;
- static-frame/timeline relationship;
- GDN validator-profile resolution and rules-digest equality;
- workspace/project ownership of every persistent reference.

A resolver reports an inaccessible cross-workspace identifier as `REFERENCE_NOT_FOUND`, not as an ownership disclosure.

## Canonical valid example

The following is JSON-compatible and valid when the fixture resolver returns the exact immutable references shown. It represents the angel example as a reconstructed background plus body and two wings. The source is the normalized metadata-free PNG persisted by the Phase 1A ingestion boundary, not the browser's original JPG/PNG bytes.

```json
{
  "schemaVersion": 1,
  "canvas": {
    "width": 300,
    "height": 250,
    "background": {
      "kind": "image",
      "asset": {
        "assetId": "asset_background_01",
        "assetVersionId": "av_background_0001",
        "sha256": "2222222222222222222222222222222222222222222222222222222222222222",
        "mediaType": "image/png",
        "byteSize": 91240,
        "pixelWidth": 300,
        "pixelHeight": 250
      },
      "fit": "cover",
      "positionX": 0.5,
      "positionY": 0.5,
      "opacity": 1
    }
  },
  "sourceAsset": {
    "assetId": "asset_source_01",
    "assetVersionId": "av_source_0001",
    "sha256": "1111111111111111111111111111111111111111111111111111111111111111",
    "mediaType": "image/png",
    "byteSize": 148200,
    "pixelWidth": 300,
    "pixelHeight": 250
  },
  "layers": [
    {
      "id": "layer_body_01",
      "name": "Angel body",
      "order": 0,
      "included": true,
      "visible": true,
      "opacity": 1,
      "asset": {
        "assetId": "asset_body_01",
        "assetVersionId": "av_body_0001",
        "sha256": "3333333333333333333333333333333333333333333333333333333333333333",
        "mediaType": "image/png",
        "byteSize": 73520,
        "pixelWidth": 100,
        "pixelHeight": 190
      },
      "frame": {
        "x": 100,
        "y": 45,
        "width": 100,
        "height": 190
      },
      "transform": {
        "anchorX": 0.5,
        "anchorY": 0.5,
        "translateX": 0,
        "translateY": 0,
        "scaleX": 1,
        "scaleY": 1,
        "rotationDegrees": 0
      }
    },
    {
      "id": "layer_left_wing_01",
      "name": "Left wing",
      "order": 1,
      "included": true,
      "visible": true,
      "opacity": 0.96,
      "asset": {
        "assetId": "asset_left_wing_01",
        "assetVersionId": "av_left_wing_0001",
        "sha256": "4444444444444444444444444444444444444444444444444444444444444444",
        "mediaType": "image/png",
        "byteSize": 52480,
        "pixelWidth": 100,
        "pixelHeight": 130
      },
      "frame": {
        "x": 30,
        "y": 50,
        "width": 100,
        "height": 130
      },
      "transform": {
        "anchorX": 0.9,
        "anchorY": 0.45,
        "translateX": 0,
        "translateY": 0,
        "scaleX": 1,
        "scaleY": 1,
        "rotationDegrees": 0
      }
    },
    {
      "id": "layer_right_wing_01",
      "name": "Right wing",
      "order": 2,
      "included": true,
      "visible": true,
      "opacity": 0.96,
      "asset": {
        "assetId": "asset_right_wing_01",
        "assetVersionId": "av_right_wing_0001",
        "sha256": "5555555555555555555555555555555555555555555555555555555555555555",
        "mediaType": "image/png",
        "byteSize": 51960,
        "pixelWidth": 100,
        "pixelHeight": 130
      },
      "frame": {
        "x": 170,
        "y": 50,
        "width": 100,
        "height": 130
      },
      "transform": {
        "anchorX": 0.1,
        "anchorY": 0.45,
        "translateX": 0,
        "translateY": 0,
        "scaleX": 1,
        "scaleY": 1,
        "rotationDegrees": 0
      }
    }
  ],
  "timeline": [
    {
      "id": "track_body_float_01",
      "targetLayerId": "layer_body_01",
      "preset": {
        "kind": "float",
        "presetVersion": 1,
        "axis": "y",
        "distancePx": -6
      },
      "timing": {
        "startMs": 0,
        "durationMs": 5000,
        "iterations": 3,
        "iterationMode": "alternate",
        "easing": "ease-in-out"
      }
    },
    {
      "id": "track_left_flutter_01",
      "targetLayerId": "layer_left_wing_01",
      "preset": {
        "kind": "flutter",
        "presetVersion": 1,
        "fromDegrees": -4,
        "toDegrees": 7
      },
      "timing": {
        "startMs": 0,
        "durationMs": 6000,
        "iterations": 3,
        "iterationMode": "alternate",
        "easing": "ease-in-out"
      }
    },
    {
      "id": "track_right_flutter_01",
      "targetLayerId": "layer_right_wing_01",
      "preset": {
        "kind": "flutter",
        "presetVersion": 1,
        "fromDegrees": 4,
        "toDegrees": -7
      },
      "timing": {
        "startMs": 0,
        "durationMs": 6000,
        "iterations": 3,
        "iterationMode": "alternate",
        "easing": "ease-in-out"
      }
    }
  ],
  "exportSettings": {
    "kind": "regular-html",
    "profileVersion": 1,
    "interaction": {
      "kind": "single-exit",
      "destinationUrl": "https://example.com/campaign"
    }
  }
}
```

Reference resolution for the example:

- All five `assetVersionId` values are unique and resolve in the same workspace/project to the exact media type, byte size, dimensions, and digest embedded above.
- The three track targets resolve respectively to `layer_body_01`, `layer_left_wing_01`, and `layer_right_wing_01`.
- Layer orders are the contiguous sorted sequence `0, 1, 2`; track tuples are sorted; every frame intersects the 300-by-250 canvas.
- Track ends are 15,000 ms for the body and 18,000 ms for each wing, below the 30,000 ms ceiling. Different layers mean their rotation/translation intervals do not conflict.
- The destination URL is already in canonical absolute form and is not fetched by preview or export.

## Reproducibility linkage

`BannerSceneV1` describes the scene but does not pretend that scene JSON alone identifies implementation code. Persistence stores each accepted document as an immutable `BannerSceneVersion` with a revision number, the canonical scene bytes, and their digest. Every completed export stores this closed manifest with its `GenerationOutput`:

```ts
interface WorkflowManifestRefV1 {
  workflowVersionId: OpaqueId;
  workflowVersion: PositiveInt32;
  definitionSha256: Sha256Hex;
}

interface ExportReproductionManifestV1 {
  manifestVersion: 1;
  sceneVersionId: OpaqueId;
  sceneRevision: PositiveInt32;
  sceneEncoding: "banner-scene-json-v1";
  sceneSha256: Sha256Hex;
  assetVersions: readonly AssetVersionRefV1[];
  sceneWorkflow: WorkflowManifestRefV1;
  exportWorkflow: WorkflowManifestRefV1;
  exporter: {
    exporterId: OpaqueId;
    exporterVersion: PositiveInt32;
    buildSha256: Sha256Hex;
  };
  validator:
    | { kind: "none" }
    | { kind: "profile"; profile: ValidatorProfileRefV1 };
  output:
    | {
        mediaType: "application/zip";
        byteSize: number;
        sha256: Sha256Hex;
      }
    | {
        mediaType: "image/png";
        byteSize: number;
        sha256: Sha256Hex;
        pixelWidth: number;
        pixelHeight: number;
      };
}
```

Manifest rules:

- All fields are required and non-null according to the selected union branch; objects are strict.
- `assetVersions` contains every distinct asset-version reference in the scene, including the source even when it is not packaged. It is sorted by `assetVersionId`, contains no duplicates, and matches the scene exactly.
- `sceneWorkflow` exactly matches the immutable `WorkflowVersion` referenced by `BannerSceneVersion.workflow_version_id`, including ID, version number, and definition digest. Every scene revision has one; deterministic manual edits use a versioned edit workflow rather than an unversioned label.
- `exportWorkflow` exactly matches the immutable `WorkflowVersion` referenced by the export `GenerationJob.workflow_version_id`; that job's operation is `banner.export`. Both workflow references are resolved and digest-checked independently. They may identify the same row only when that row truthfully performed both roles.
- `sceneSha256` hashes canonical scene bytes. Canonical encoding recursively orders object keys lexicographically by their ASCII names, preserves array order, normalizes negative zero to zero, uses ECMAScript `JSON.stringify` with no replacer or spacing, encodes the result as UTF-8, and applies SHA-256. All v1 keys are ASCII and all user strings are NFC-normalized before this step.
- `sceneWorkflow.definitionSha256`, `exportWorkflow.definitionSha256`, `exporter.buildSha256`, and validator `rulesSha256` identify immutable executable/definition content, not merely mutable names.
- A GDN export requires `validator.kind: "profile"` and an exact match with `exportSettings.validatorProfile`. Other v1 exports use `validator.kind: "none"` unless a future schema version defines another required profile.
- `regular-html` and `gdn-html5` outputs use `application/zip`; `static-png` uses `image/png`.
- Output `byteSize` is an integer from `1` through `52_428_800` bytes (50 MiB) and may be further restricted by the selected validator profile.
- A PNG output's `pixelWidth` and `pixelHeight` are integers exactly equal to the scene canvas. ZIP output objects do not have pixel-dimension keys.
- `sceneVersionId` exactly equals the project-qualified `banner_scene_version_id` on the owning export-artifact `GenerationOutput`; its revision and digest match that immutable row.
- Manifest output media type, byte size, digest, and PNG dimensions exactly match the immutable export-artifact columns on that `GenerationOutput`. Raster `AssetVersionRefV1` remains image-only and never represents a ZIP.
- The manifest is finalized only after output bytes exist. Reproduction re-runs the identified exporter against the immutable scene/assets and compares the resulting output digest; it never mutates the prior manifest.

## Version evolution and upcasters

- `schemaVersion` is the literal integer `1`, not a string or inferred default.
- Persisted bytes are first dispatched by their explicit version. Missing versions and unknown future versions fail closed.
- Any change that alters keys, variants, bounds, defaults, units, rendering semantics, reference rules, or export meaning creates a new schema version. Because v1 objects reject unknown keys, even an added persisted field requires a new version.
- The original `BannerSceneV1` and its digest remain immutable. A newer application may use a pure `upcastBannerSceneV1ToV2` function to construct a new in-memory value or persist a new scene revision; it never rewrites v1 in place.
- Each upcaster is deterministic, total for every valid source-version scene, runtime-validates its output, and has committed valid/edge fixture tests. It may not use current time, randomness, network access, mutable configuration, a provider, or storage side effects.
- Upcaster chains advance one version at a time. There is no implicit downcast. An exporter either declares support for the persisted version or receives an explicitly upcast revision whose new digest and provenance are recorded.
- Tightening validation without a new version may reject newly submitted invalid data, but it must not reinterpret a scene that was valid under a persisted prior contract. A required repair is an explicit new revision with provenance.

## Invalid-case matrix

The stable codes below are the minimum primary issue expected for each independent mutation of an otherwise valid scene.

| Invalid mutation | Expected code | Path/example | Required action |
| --- | --- | --- | --- |
| Add any top-level or nested key such as `customCss` | `SCENE_UNKNOWN_KEY` | `/customCss` | Reject; never strip or execute it |
| Omit a required key or set it to `null` | `SCENE_REQUIRED` | `/canvas/background` | Reject; no default or null coercion |
| Use `"1"`, `2`, or omit the schema version | `SCENE_VERSION_UNSUPPORTED` | `/schemaVersion` | Reject before version-specific parsing |
| Use a fractional, zero, or greater-than-4,096 canvas dimension | `CANVAS_DIMENSION_INVALID` | `/canvas/width` | Reject |
| Make canvas area exceed 16,777,216 pixels | `CANVAS_AREA_EXCEEDED` | `/canvas` | Reject even if each side is individually valid |
| Use background kind `gradient` or include image fields on `solid` | `BACKGROUND_VARIANT_INVALID` | `/canvas/background` | Reject the non-closed or mixed variant |
| Use lowercase/short color `#fff` | `COLOR_INVALID` | `/canvas/background/color` | Reject; require uppercase `#RRGGBBAA` |
| Use an uppercase, short, or non-hex digest | `DIGEST_INVALID` | `/sourceAsset/sha256` | Reject |
| Use GIF, SVG, or a media type inconsistent with the role | `ASSET_MEDIA_TYPE_INVALID` | `/layers/0/asset/mediaType` | Reject; layer must be PNG |
| Exceed byte, side, or pixel-area bounds | `ASSET_LIMIT_EXCEEDED` | `/sourceAsset` | Reject before persistence/export |
| Resolve an asset version whose digest or metadata differs | `ASSET_REFERENCE_MISMATCH` | `/layers/0/asset` | Reject; do not repair from mutable metadata |
| Reuse one asset-version ID with conflicting embedded fields | `ASSET_REFERENCE_CONFLICT` | second occurrence | Reject both as an inconsistent scene |
| Resolve an asset or profile outside the active workspace | `REFERENCE_NOT_FOUND` | reference path | Reject without revealing cross-workspace existence |
| Supply zero or more than 64 scene layers | `LAYER_COUNT_INVALID` | `/layers` | Reject; analysis limits are not substituted here |
| Duplicate a layer ID | `LAYER_ID_DUPLICATE` | `/layers/1/id` | Reject; names cannot provide identity |
| Duplicate, skip, or exceed an order value | `LAYER_ORDER_INVALID` | `/layers` | Reject; do not renumber |
| Store valid orders in descending array order | `LAYER_ARRAY_UNSORTED` | `/layers` | Reject; do not silently sort |
| Use an empty, padded, non-NFC, control-bearing, or overlong name | `LAYER_NAME_INVALID` | `/layers/0/name` | Reject; do not silently normalize persisted input |
| Use a zero/negative frame size or a frame wholly outside canvas | `LAYER_FRAME_INVALID` | `/layers/0/frame` | Reject |
| Use scale `0`, negative scale, or an out-of-range transform | `LAYER_TRANSFORM_INVALID` | `/layers/0/transform/scaleX` | Reject rather than clamp |
| Use opacity outside `0..1` or a numeric string | `LAYER_OPACITY_INVALID` | `/layers/0/opacity` | Reject without coercion |
| Use a non-boolean inclusion/visibility value | `LAYER_CONTROL_INVALID` | `/layers/0/included` | Reject without truthiness coercion |
| Add more than 128 tracks or more than four for one layer | `TRACK_COUNT_INVALID` | `/timeline` | Reject |
| Duplicate a track ID | `TRACK_ID_DUPLICATE` | `/timeline/1/id` | Reject |
| Target a missing layer | `TRACK_TARGET_NOT_FOUND` | `/timeline/0/targetLayerId` | Reject the whole scene, including if target was deleted |
| Store tracks outside required tuple order | `TRACK_ARRAY_UNSORTED` | `/timeline` | Reject; do not reorder |
| Use an unknown preset, preset version, easing, or iteration mode | `TRACK_VARIANT_INVALID` | `/timeline/0` | Reject the closed value |
| Use equal fade/pulse/flutter endpoints, zero float distance, or zero slide offsets | `PRESET_NO_EFFECT` | `/timeline/0/preset` | Reject an inert preset |
| Put a preset parameter outside its numeric bound | `PRESET_PARAMETER_INVALID` | parameter path | Reject rather than clamp |
| Use fractional milliseconds/iterations or exceed a field bound | `TRACK_TIMING_INVALID` | `/timeline/0/timing` | Reject |
| Compute a track end after 30,000 ms | `TRACK_DURATION_EXCEEDED` | `/timeline/0/timing` | Reject even when individual fields are bounded |
| Overlap two same-layer opacity, translation, scale, or rotation intervals | `TRACK_CHANNEL_CONFLICT` | second track | Reject; adjacent half-open intervals remain valid |
| Use an unknown export kind/profile version or fields from another branch | `EXPORT_VARIANT_INVALID` | `/exportSettings` | Reject the mixed or future variant |
| Use a relative, credential-bearing, non-HTTP(S), non-canonical, or overlong exit URL | `EXIT_URL_INVALID` | `/exportSettings/interaction/destinationUrl` | Reject; never sanitize into a different destination |
| Omit, fail to resolve, or mismatch the GDN profile/rules digest | `VALIDATOR_PROFILE_MISMATCH` | `/exportSettings/validatorProfile` | Fail closed; do not claim GDN validity |
| Use a static frame after timeline duration or nonzero with an empty timeline | `STATIC_FRAME_INVALID` | `/exportSettings/frameTimeMs` | Reject |
| Add `html`, `css`, `javascript`, `keyframes`, `prompt`, or a remote asset URL anywhere | `SCENE_UNKNOWN_KEY` | offending path | Reject; executable/remote input is outside v1 |

## Explicit non-goals

This contract does not introduce application routes, UI components, runtime schemas, package dependencies, database tables, migrations, exporters, validators, tests, or generated artifacts. It defines what those later implementations must enforce.

It also does not introduce a SaaS starter, production authentication, billing, subscriptions, entitlements, customer credits, teams, seats, or any provider-specific type. SVG ingestion, arbitrary timelines, general prompt-based animation, per-layer conversation history, multi-size generation, GIF, video, and real-time collaboration remain deferred.
