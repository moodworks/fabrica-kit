import { z, type RefinementCtx } from 'zod';

import {
  issue,
  validationFailure,
  validationSuccess,
  zodIssuesToValidationIssues,
  type ValidationIssueCode,
  type ValidationResult,
} from './validation.js';

const opaqueIdPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const rgbaPattern = /^#[0-9A-F]{8}$/;
const unsafeNamePattern = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;
const printableAsciiPattern = /^[\x21-\x7e]+$/;

const addStableIssue = (
  context: RefinementCtx,
  code: ValidationIssueCode,
  path: readonly PropertyKey[],
  message: string,
): void => {
  context.addIssue({
    code: 'custom',
    message,
    path: [...path],
    params: { validationCode: code },
  });
};

const boundedNumber = (minimum: number, maximum: number) => z.number().min(minimum).max(maximum);

const boundedInteger = (minimum: number, maximum: number) => z.int().min(minimum).max(maximum);

export const OpaqueIdSchema = z.string().regex(opaqueIdPattern).brand<'OpaqueId'>();
export const AssetIdSchema = z.string().regex(opaqueIdPattern).brand<'AssetId'>();
export const AssetVersionIdSchema = z.string().regex(opaqueIdPattern).brand<'AssetVersionId'>();
export const LayerIdSchema = z.string().regex(opaqueIdPattern).brand<'LayerId'>();
export const TrackIdSchema = z.string().regex(opaqueIdPattern).brand<'TrackId'>();
export const ValidatorProfileIdSchema = z
  .string()
  .regex(opaqueIdPattern)
  .brand<'ValidatorProfileId'>();
export const Sha256HexSchema = z.string().regex(sha256Pattern).brand<'Sha256Hex'>();
export const RgbaHexSchema = z.string().regex(rgbaPattern).brand<'RgbaHex'>();
export const PositiveInt32Schema = boundedInteger(1, 2_147_483_647);
export const UnitIntervalSchema = boundedNumber(0, 1);

export type AssetId = z.infer<typeof AssetIdSchema>;
export type AssetVersionId = z.infer<typeof AssetVersionIdSchema>;
export type LayerId = z.infer<typeof LayerIdSchema>;
export type TrackId = z.infer<typeof TrackIdSchema>;
export type ValidatorProfileId = z.infer<typeof ValidatorProfileIdSchema>;
export type Sha256Hex = z.infer<typeof Sha256HexSchema>;

const LayerNameSchema = z.string().superRefine((value, context) => {
  const codePointLength = [...value].length;
  if (
    codePointLength < 1 ||
    codePointLength > 80 ||
    value.normalize('NFC') !== value ||
    value.trim() !== value ||
    unsafeNamePattern.test(value)
  ) {
    addStableIssue(
      context,
      'LAYER_NAME_INVALID',
      [],
      'Layer name must be 1–80 NFC code points without surrounding whitespace or unsafe controls.',
    );
  }
});

export const SafeHttpUrlSchema = z.string().superRefine((value, context) => {
  let valid = value.length >= 1 && value.length <= 2_048 && printableAsciiPattern.test(value);

  try {
    const parsed = new URL(value);
    valid &&=
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.hostname.length > 0 &&
      parsed.username === '' &&
      parsed.password === '' &&
      (parsed.port === '' || (/^[0-9]+$/.test(parsed.port) && Number(parsed.port) >= 1)) &&
      parsed.href === value;
  } catch {
    valid = false;
  }

  if (!valid) {
    addStableIssue(
      context,
      'EXIT_URL_INVALID',
      [],
      'Exit URL must be a canonical absolute HTTP(S) URL without credentials.',
    );
  }
});

export const AssetVersionRefV1Schema = z
  .strictObject({
    assetId: AssetIdSchema,
    assetVersionId: AssetVersionIdSchema,
    sha256: Sha256HexSchema,
    mediaType: z.enum(['image/jpeg', 'image/png']),
    byteSize: boundedInteger(1, 20_971_520),
    pixelWidth: boundedInteger(1, 8_192),
    pixelHeight: boundedInteger(1, 8_192),
  })
  .superRefine((value, context) => {
    if (value.pixelWidth * value.pixelHeight > 40_000_000) {
      addStableIssue(
        context,
        'ASSET_LIMIT_EXCEEDED',
        [],
        'Asset decoded pixel area exceeds 40,000,000 pixels.',
      );
    }
  });

export type AssetVersionRefV1 = z.infer<typeof AssetVersionRefV1Schema>;

const TransparentBackgroundV1Schema = z.strictObject({
  kind: z.literal('transparent'),
});

const SolidBackgroundV1Schema = z.strictObject({
  kind: z.literal('solid'),
  color: RgbaHexSchema,
});

const ImageBackgroundV1Schema = z.strictObject({
  kind: z.literal('image'),
  asset: AssetVersionRefV1Schema,
  fit: z.enum(['cover', 'contain']),
  positionX: UnitIntervalSchema,
  positionY: UnitIntervalSchema,
  opacity: UnitIntervalSchema,
});

export const BackgroundDefinitionV1Schema = z.discriminatedUnion('kind', [
  TransparentBackgroundV1Schema,
  SolidBackgroundV1Schema,
  ImageBackgroundV1Schema,
]);

export const BannerCanvasV1Schema = z.strictObject({
  width: boundedInteger(1, 4_096),
  height: boundedInteger(1, 4_096),
  background: BackgroundDefinitionV1Schema,
});

const LayerFrameV1Schema = z.strictObject({
  x: boundedNumber(-16_384, 16_384),
  y: boundedNumber(-16_384, 16_384),
  width: z.number().gt(0).max(16_384),
  height: z.number().gt(0).max(16_384),
});

const LayerTransformV1Schema = z.strictObject({
  anchorX: UnitIntervalSchema,
  anchorY: UnitIntervalSchema,
  translateX: boundedNumber(-8_192, 8_192),
  translateY: boundedNumber(-8_192, 8_192),
  scaleX: boundedNumber(0.01, 8),
  scaleY: boundedNumber(0.01, 8),
  rotationDegrees: boundedNumber(-360, 360),
});

export const BannerLayerV1Schema = z.strictObject({
  id: LayerIdSchema,
  name: LayerNameSchema,
  order: boundedInteger(0, 63),
  included: z.boolean(),
  visible: z.boolean(),
  opacity: UnitIntervalSchema,
  asset: AssetVersionRefV1Schema,
  frame: LayerFrameV1Schema,
  transform: LayerTransformV1Schema,
});

const FadePresetV1Schema = z
  .strictObject({
    kind: z.literal('fade'),
    presetVersion: z.literal(1),
    fromFactor: UnitIntervalSchema,
    toFactor: UnitIntervalSchema,
  })
  .superRefine((value, context) => {
    if (value.fromFactor === value.toFactor) {
      addStableIssue(context, 'PRESET_NO_EFFECT', [], 'Fade endpoints must differ.');
    }
  });

const SlidePresetV1Schema = z
  .strictObject({
    kind: z.literal('slide'),
    presetVersion: z.literal(1),
    offsetX: boundedNumber(-4_096, 4_096),
    offsetY: boundedNumber(-4_096, 4_096),
  })
  .superRefine((value, context) => {
    if (value.offsetX === 0 && value.offsetY === 0) {
      addStableIssue(context, 'PRESET_NO_EFFECT', [], 'Slide requires a nonzero offset.');
    }
  });

const FloatPresetV1Schema = z
  .strictObject({
    kind: z.literal('float'),
    presetVersion: z.literal(1),
    axis: z.enum(['x', 'y']),
    distancePx: boundedNumber(-512, 512),
  })
  .superRefine((value, context) => {
    if (value.distancePx === 0) {
      addStableIssue(context, 'PRESET_NO_EFFECT', [], 'Float distance must be nonzero.');
    }
  });

const PulsePresetV1Schema = z
  .strictObject({
    kind: z.literal('pulse'),
    presetVersion: z.literal(1),
    fromScale: boundedNumber(0.5, 2),
    toScale: boundedNumber(0.5, 2),
  })
  .superRefine((value, context) => {
    if (value.fromScale === value.toScale) {
      addStableIssue(context, 'PRESET_NO_EFFECT', [], 'Pulse endpoints must differ.');
    }
  });

const FlutterPresetV1Schema = z
  .strictObject({
    kind: z.literal('flutter'),
    presetVersion: z.literal(1),
    fromDegrees: boundedNumber(-45, 45),
    toDegrees: boundedNumber(-45, 45),
  })
  .superRefine((value, context) => {
    if (value.fromDegrees === value.toDegrees) {
      addStableIssue(context, 'PRESET_NO_EFFECT', [], 'Flutter endpoints must differ.');
    }
  });

export const AnimationPresetV1Schema = z.discriminatedUnion('kind', [
  FadePresetV1Schema,
  SlidePresetV1Schema,
  FloatPresetV1Schema,
  PulsePresetV1Schema,
  FlutterPresetV1Schema,
]);

export const AnimationTimingV1Schema = z.strictObject({
  startMs: boundedInteger(0, 29_900),
  durationMs: boundedInteger(100, 10_000),
  iterations: boundedInteger(1, 20),
  iterationMode: z.enum(['restart', 'alternate']),
  easing: z.enum(['linear', 'ease-in', 'ease-out', 'ease-in-out']),
});

export const AnimationTrackV1Schema = z.strictObject({
  id: TrackIdSchema,
  targetLayerId: LayerIdSchema,
  preset: AnimationPresetV1Schema,
  timing: AnimationTimingV1Schema,
});

const NoInteractionV1Schema = z.strictObject({ kind: z.literal('none') });
const SingleExitInteractionV1Schema = z.strictObject({
  kind: z.literal('single-exit'),
  destinationUrl: SafeHttpUrlSchema,
});

export const BannerInteractionV1Schema = z.discriminatedUnion('kind', [
  NoInteractionV1Schema,
  SingleExitInteractionV1Schema,
]);

export const ValidatorProfileRefV1Schema = z.strictObject({
  validatorProfileId: ValidatorProfileIdSchema,
  validatorProfileVersion: PositiveInt32Schema,
  rulesSha256: Sha256HexSchema,
});

export type ValidatorProfileRefV1 = z.infer<typeof ValidatorProfileRefV1Schema>;

const RegularHtmlExportSettingsV1Schema = z.strictObject({
  kind: z.literal('regular-html'),
  profileVersion: z.literal(1),
  interaction: BannerInteractionV1Schema,
});

const GdnHtml5ExportSettingsV1Schema = z.strictObject({
  kind: z.literal('gdn-html5'),
  profileVersion: z.literal(1),
  interaction: BannerInteractionV1Schema,
  validatorProfile: ValidatorProfileRefV1Schema,
});

const StaticPngExportSettingsV1Schema = z.strictObject({
  kind: z.literal('static-png'),
  profileVersion: z.literal(1),
  frameTimeMs: boundedInteger(0, 30_000),
});

export const BannerExportSettingsV1Schema = z.discriminatedUnion('kind', [
  RegularHtmlExportSettingsV1Schema,
  GdnHtml5ExportSettingsV1Schema,
  StaticPngExportSettingsV1Schema,
]);

const trackChannel = (track: z.infer<typeof AnimationTrackV1Schema>): string => {
  switch (track.preset.kind) {
    case 'fade':
      return 'opacity';
    case 'float':
    case 'slide':
      return 'translation';
    case 'pulse':
      return 'scale';
    case 'flutter':
      return 'rotation';
  }
};

const trackEnd = (track: z.infer<typeof AnimationTrackV1Schema>): number =>
  track.timing.startMs + track.timing.durationMs * track.timing.iterations;

const compareAscii = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const compareTracks = (
  left: z.infer<typeof AnimationTrackV1Schema>,
  right: z.infer<typeof AnimationTrackV1Schema>,
): number =>
  left.timing.startMs - right.timing.startMs ||
  compareAscii(left.targetLayerId, right.targetLayerId) ||
  compareAscii(left.id, right.id);

const assetReferencesEqual = (left: AssetVersionRefV1, right: AssetVersionRefV1): boolean =>
  left.assetId === right.assetId &&
  left.assetVersionId === right.assetVersionId &&
  left.sha256 === right.sha256 &&
  left.mediaType === right.mediaType &&
  left.byteSize === right.byteSize &&
  left.pixelWidth === right.pixelWidth &&
  left.pixelHeight === right.pixelHeight;

const BannerSceneV1StructuralSchema = z.strictObject({
  schemaVersion: z.literal(1),
  canvas: BannerCanvasV1Schema,
  sourceAsset: AssetVersionRefV1Schema,
  layers: z.array(BannerLayerV1Schema).min(1).max(64).readonly(),
  timeline: z.array(AnimationTrackV1Schema).max(128).readonly(),
  exportSettings: BannerExportSettingsV1Schema,
});

export const BannerSceneV1Schema = BannerSceneV1StructuralSchema.superRefine((scene, context) => {
  if (scene.canvas.width * scene.canvas.height > 16_777_216) {
    addStableIssue(
      context,
      'CANVAS_AREA_EXCEEDED',
      ['canvas'],
      'Canvas area exceeds 16,777,216 pixels.',
    );
  }

  const assetOccurrences = collectSceneAssetReferences(scene);
  const firstAssetByVersion = new Map<string, AssetVersionRefV1>();
  for (const occurrence of assetOccurrences) {
    const prior = firstAssetByVersion.get(occurrence.reference.assetVersionId);
    if (prior !== undefined && !assetReferencesEqual(prior, occurrence.reference)) {
      addStableIssue(
        context,
        'ASSET_REFERENCE_CONFLICT',
        occurrence.path,
        'Repeated asset-version reference has conflicting immutable metadata.',
      );
    } else if (prior === undefined) {
      firstAssetByVersion.set(occurrence.reference.assetVersionId, occurrence.reference);
    }
  }

  const layerIds = new Set<string>();
  for (const [index, layer] of scene.layers.entries()) {
    if (layerIds.has(layer.id)) {
      addStableIssue(
        context,
        'LAYER_ID_DUPLICATE',
        ['layers', index, 'id'],
        'Layer ID must be unique within the scene.',
      );
    }
    layerIds.add(layer.id);

    if (layer.asset.mediaType !== 'image/png') {
      addStableIssue(
        context,
        'ASSET_MEDIA_TYPE_INVALID',
        ['layers', index, 'asset', 'mediaType'],
        'Layer asset must be image/png.',
      );
    }

    const { frame } = layer;
    if (
      frame.x >= scene.canvas.width ||
      frame.y >= scene.canvas.height ||
      frame.x + frame.width <= 0 ||
      frame.y + frame.height <= 0
    ) {
      addStableIssue(
        context,
        'LAYER_FRAME_INVALID',
        ['layers', index, 'frame'],
        'Untransformed layer frame must intersect the canvas.',
      );
    }
  }

  const orders = scene.layers.map((layer) => layer.order);
  const validOrderSet =
    new Set(orders).size === scene.layers.length &&
    orders.every((order) => order >= 0 && order < scene.layers.length);
  if (!validOrderSet) {
    addStableIssue(
      context,
      'LAYER_ORDER_INVALID',
      ['layers'],
      'Layer orders must be the unique contiguous set 0..N-1.',
    );
  } else if (orders.some((order, index) => order !== index)) {
    addStableIssue(
      context,
      'LAYER_ARRAY_UNSORTED',
      ['layers'],
      'Layer array must be stored in ascending order.',
    );
  }

  const trackIds = new Set<string>();
  const perLayerCount = new Map<string, number>();
  for (const [index, track] of scene.timeline.entries()) {
    if (trackIds.has(track.id)) {
      addStableIssue(
        context,
        'TRACK_ID_DUPLICATE',
        ['timeline', index, 'id'],
        'Track ID must be unique within the scene.',
      );
    }
    trackIds.add(track.id);

    if (!layerIds.has(track.targetLayerId)) {
      addStableIssue(
        context,
        'TRACK_TARGET_NOT_FOUND',
        ['timeline', index, 'targetLayerId'],
        'Track target must resolve to a layer in this scene.',
      );
    }

    const count = (perLayerCount.get(track.targetLayerId) ?? 0) + 1;
    perLayerCount.set(track.targetLayerId, count);
    if (count > 4) {
      addStableIssue(
        context,
        'TRACK_COUNT_INVALID',
        ['timeline', index],
        'A layer may be targeted by at most four tracks.',
      );
    }

    if (trackEnd(track) > 30_000) {
      addStableIssue(
        context,
        'TRACK_DURATION_EXCEEDED',
        ['timeline', index, 'timing'],
        'Track exclusive end must not exceed 30,000 ms.',
      );
    }

    if (index > 0 && compareTracks(scene.timeline[index - 1]!, track) > 0) {
      addStableIssue(
        context,
        'TRACK_ARRAY_UNSORTED',
        ['timeline'],
        'Timeline must be sorted by startMs, targetLayerId, then id.',
      );
    }
  }

  const tracksByChannel = new Map<string, { index: number; start: number; end: number }[]>();
  for (const [index, track] of scene.timeline.entries()) {
    const key = `${track.targetLayerId}:${trackChannel(track)}`;
    const values = tracksByChannel.get(key) ?? [];
    values.push({ index, start: track.timing.startMs, end: trackEnd(track) });
    tracksByChannel.set(key, values);
  }
  for (const values of tracksByChannel.values()) {
    values.sort((left, right) => left.start - right.start || left.end - right.end);
    for (let index = 1; index < values.length; index += 1) {
      const previous = values[index - 1]!;
      const current = values[index]!;
      if (current.start < previous.end) {
        addStableIssue(
          context,
          'TRACK_CHANNEL_CONFLICT',
          ['timeline', current.index],
          'Tracks on the same layer/channel must not overlap.',
        );
      }
    }
  }

  const timelineDuration = scene.timeline.reduce(
    (duration, track) => Math.max(duration, trackEnd(track)),
    0,
  );
  if (
    scene.exportSettings.kind === 'static-png' &&
    (scene.exportSettings.frameTimeMs > timelineDuration ||
      (timelineDuration === 0 && scene.exportSettings.frameTimeMs !== 0))
  ) {
    addStableIssue(
      context,
      'STATIC_FRAME_INVALID',
      ['exportSettings', 'frameTimeMs'],
      'Static PNG frame must be within the scene timeline and zero for an empty timeline.',
    );
  }
});

export type BannerSceneV1 = z.infer<typeof BannerSceneV1Schema>;
export type BannerLayerV1 = z.infer<typeof BannerLayerV1Schema>;
export type AnimationTrackV1 = z.infer<typeof AnimationTrackV1Schema>;

export interface SceneAssetReferenceOccurrence {
  readonly path: readonly (number | string)[];
  readonly reference: AssetVersionRefV1;
}

export function collectSceneAssetReferences(
  scene: BannerSceneV1,
): readonly SceneAssetReferenceOccurrence[] {
  const references: SceneAssetReferenceOccurrence[] = [
    { path: ['sourceAsset'], reference: scene.sourceAsset },
  ];
  if (scene.canvas.background.kind === 'image') {
    references.push({
      path: ['canvas', 'background', 'asset'],
      reference: scene.canvas.background.asset,
    });
  }
  for (const [index, layer] of scene.layers.entries()) {
    references.push({ path: ['layers', index, 'asset'], reference: layer.asset });
  }
  return references;
}

export const parseBannerSceneV1 = (input: unknown): ValidationResult<BannerSceneV1> => {
  const parsed = BannerSceneV1Schema.safeParse(input);
  return parsed.success
    ? validationSuccess(parsed.data)
    : validationFailure(zodIssuesToValidationIssues(parsed.error.issues, input, 'scene'));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const parseBannerScene = (input: unknown): ValidationResult<BannerSceneV1> => {
  if (!isRecord(input) || input['schemaVersion'] !== 1) {
    return validationFailure([
      issue(
        'SCENE_VERSION_UNSUPPORTED',
        ['schemaVersion'],
        'Banner scene schemaVersion must be the literal integer 1.',
      ),
    ]);
  }
  return parseBannerSceneV1(input);
};

export { assetReferencesEqual };
