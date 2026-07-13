import { z } from 'zod';

import {
  ErrorCodeSchema,
  PersistedSceneVersionIdSchema,
  PersistedWorkflowVersionIdSchema,
  SafePersistedMessageSchema,
  CurrencyCodeSchema,
  type CurrencyCode,
} from '../jobs/syntax.js';
import {
  digestValidatedCapabilityRequest,
  type CapabilityRequestSha256,
} from '../jobs/request-digests.js';
import { EpochMillisecondsSchema, type EpochMilliseconds } from '../jobs/timing.js';
import {
  AssetVersionRefV1Schema,
  BannerSceneV1Schema,
  Sha256HexSchema,
  ValidatorProfileRefV1Schema,
  assetReferencesEqual,
  collectSceneAssetReferences,
  type AssetVersionRefV1,
} from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  ExportReproductionManifestV1Schema,
  ExporterManifestRefV1Schema,
  SceneVersionIdSchema,
  WorkflowManifestRefV1Schema,
  validateExportReproductionManifestV1,
} from '../scene/export-reproduction-manifest-v1.schema.js';
import {
  MAX_RASTER_ENCODED_BYTES,
  assertCanonicalNormalizedPng,
} from '../security/raster-container.js';
import { validateNormalizedPng } from '../security/raster-upload.js';
import {
  CompositionPartV1Schema,
  validateCompositionAnalysisResultV1,
  type CompositionAnalysisResultV1,
  type CompositionPartV1,
} from '../workflows/composition-contracts.js';

export interface CancellationSignalPort {
  readonly cancelled: boolean;
  throwIfCancelled(): void;
}

const CancellationSignalPortSchema = z.custom<CancellationSignalPort>(
  (value) =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { cancelled?: unknown }).cancelled === 'boolean' &&
    typeof (value as { throwIfCancelled?: unknown }).throwIfCancelled === 'function',
  { message: 'Cancellation signal must expose a boolean and a callable cancellation check.' },
);

export interface CapabilityCallContext {
  readonly deadlineAtMs: EpochMilliseconds;
  readonly externalIdempotencyKey: string | null;
  readonly cancellation: CancellationSignalPort;
}

export const CompositionAnalysisRequestV1Schema = z
  .strictObject({
    sourceAsset: AssetVersionRefV1Schema,
    maxParts: z.int().min(1).max(5),
    includeBackground: z.boolean(),
  })
  .readonly();

export type CompositionAnalysisRequestV1 = z.infer<typeof CompositionAnalysisRequestV1Schema>;

export const compositionAnalysisRequestSha256 = (input: unknown): CapabilityRequestSha256 =>
  digestValidatedCapabilityRequest(CompositionAnalysisRequestV1Schema.parse(input));

export const validateCompositionAnalysisResponseV1 = (input: {
  readonly request: unknown;
  readonly result: unknown;
}): CompositionAnalysisResultV1 => {
  const request = CompositionAnalysisRequestV1Schema.parse(input.request);
  return validateCompositionAnalysisResultV1({ request, result: input.result });
};

export interface BannerCompositionAnalysisPort {
  estimate(
    request: CompositionAnalysisRequestV1,
  ): Promise<{ readonly micros: bigint; readonly currency: CurrencyCode }>;
  analyze(
    request: CompositionAnalysisRequestV1,
    context: CapabilityCallContext,
  ): Promise<CompositionAnalysisResultV1>;
}

export const LayerExtractionRequestV1Schema = z
  .strictObject({
    sourceAsset: AssetVersionRefV1Schema,
    part: CompositionPartV1Schema,
    trimTransparentPixels: z.boolean(),
  })
  .readonly();

export const ExtractedLayerResultV1Schema = z
  .strictObject({
    bytes: z.instanceof(Uint8Array),
    mediaType: z.literal('image/png'),
    byteSize: z.int().min(1).max(20_971_520),
    pixelWidth: z.int().min(1).max(4_096),
    pixelHeight: z.int().min(1).max(4_096),
    sha256: Sha256HexSchema,
  })
  .superRefine((result, context) => {
    if (
      result.bytes.byteLength > MAX_RASTER_ENCODED_BYTES ||
      result.bytes.byteLength !== result.byteSize
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Extracted layer bytes exceed or differ from their declared byte bound.',
      });
      return;
    }
    let normalized;
    try {
      normalized = assertCanonicalNormalizedPng(result.bytes);
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Extracted layer must be a canonical normalized PNG.',
      });
      return;
    }
    if (
      normalized.width !== result.pixelWidth ||
      normalized.height !== result.pixelHeight ||
      sha256Hex(result.bytes) !== result.sha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Extracted layer bytes must match their exact size and digest.',
      });
    }
  })
  .readonly();

export type LayerExtractionRequestV1 = z.infer<typeof LayerExtractionRequestV1Schema>;
export type ExtractedLayerResultV1 = z.infer<typeof ExtractedLayerResultV1Schema>;

export const layerExtractionRequestSha256 = (input: unknown): CapabilityRequestSha256 =>
  digestValidatedCapabilityRequest(LayerExtractionRequestV1Schema.parse(input));

export const validateExtractedLayerResultV1 = async (
  input: unknown,
): Promise<ExtractedLayerResultV1> => {
  const result = ExtractedLayerResultV1Schema.parse(input);
  const decoded = await validateNormalizedPng(result.bytes);
  if (decoded.width !== result.pixelWidth || decoded.height !== result.pixelHeight) {
    throw new TypeError('Extracted layer decoded dimensions differ from its result contract.');
  }
  return result;
};

export interface BannerLayerExtractionPort {
  estimate(
    request: LayerExtractionRequestV1,
  ): Promise<{ readonly micros: bigint; readonly currency: CurrencyCode }>;
  extract(
    request: LayerExtractionRequestV1,
    context: CapabilityCallContext,
  ): Promise<ExtractedLayerResultV1>;
}

export interface BannerExportInputAsset {
  readonly bytes: Uint8Array;
  readonly reference: AssetVersionRefV1;
}

const BannerExportInputAssetSchema = z
  .strictObject({
    bytes: z.instanceof(Uint8Array),
    reference: AssetVersionRefV1Schema,
  })
  .superRefine((asset, context) => {
    if (
      asset.bytes.byteLength !== asset.reference.byteSize ||
      sha256Hex(asset.bytes) !== asset.reference.sha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Export asset bytes must match their immutable reference size and digest.',
      });
    }
  })
  .readonly();

export const BannerExportArtifactSchema = z.discriminatedUnion('mediaType', [
  z
    .strictObject({
      mediaType: z.literal('application/zip'),
      bytes: z.instanceof(Uint8Array),
      byteSize: z.int().min(1).max(52_428_800),
      sha256: Sha256HexSchema,
      validationLabel: z.literal('internal-provider-free-not-gdn'),
    })
    .superRefine((artifact, context) => {
      if (
        artifact.bytes.byteLength !== artifact.byteSize ||
        sha256Hex(artifact.bytes) !== artifact.sha256
      ) {
        context.addIssue({
          code: 'custom',
          message: 'ZIP artifact bytes must match their exact size and digest.',
        });
      }
    })
    .readonly(),
  z
    .strictObject({
      mediaType: z.literal('image/png'),
      bytes: z.instanceof(Uint8Array),
      byteSize: z.int().min(1).max(52_428_800),
      sha256: Sha256HexSchema,
      pixelWidth: z.int().min(1).max(4_096),
      pixelHeight: z.int().min(1).max(4_096),
      validationLabel: z.literal('internal-provider-free-not-gdn'),
    })
    .superRefine((artifact, context) => {
      if (
        artifact.bytes.byteLength !== artifact.byteSize ||
        sha256Hex(artifact.bytes) !== artifact.sha256
      ) {
        context.addIssue({
          code: 'custom',
          message: 'PNG artifact bytes must match their exact size and digest.',
        });
      }
    })
    .readonly(),
]);

export type BannerExportArtifact = z.infer<typeof BannerExportArtifactSchema>;

const PersistedWorkflowManifestRefV1Schema = WorkflowManifestRefV1Schema.superRefine(
  (workflow, context) => {
    if (!PersistedWorkflowVersionIdSchema.safeParse(workflow.workflowVersionId).success) {
      context.addIssue({
        code: 'custom',
        message: 'Export execution workflows must use persisted UUID identities.',
      });
    }
  },
);

export const BannerExportRequestSchema = z
  .strictObject({
    scene: BannerSceneV1Schema,
    sceneVersionId: PersistedSceneVersionIdSchema,
    sceneRevision: z.int().min(1).max(2_147_483_647),
    sceneWorkflow: PersistedWorkflowManifestRefV1Schema,
    exportWorkflow: PersistedWorkflowManifestRefV1Schema,
    exporter: ExporterManifestRefV1Schema,
    assets: z.array(BannerExportInputAssetSchema).min(1).max(66).readonly(),
    deadlineAtMs: EpochMillisecondsSchema,
    cancellation: CancellationSignalPortSchema,
  })
  .superRefine((request, context) => {
    const expected = new Map<string, AssetVersionRefV1>();
    for (const { reference } of collectSceneAssetReferences(request.scene)) {
      expected.set(reference.assetVersionId, reference);
    }
    const actual = new Map<string, (typeof request.assets)[number]>(
      request.assets.map((asset) => [asset.reference.assetVersionId, asset]),
    );
    if (
      actual.size !== request.assets.length ||
      actual.size !== expected.size ||
      [...expected].some(
        ([assetVersionId, reference]) =>
          !assetReferencesEqual(actual.get(assetVersionId)?.reference ?? reference, reference) ||
          !actual.has(assetVersionId),
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Exporter input must contain exact bytes for every distinct scene asset version.',
      });
    }
  })
  .readonly();

export type BannerExportRequest = z.infer<typeof BannerExportRequestSchema>;

export const BannerExportResultSchema = z
  .strictObject({
    artifact: BannerExportArtifactSchema,
    manifest: ExportReproductionManifestV1Schema,
  })
  .readonly();

export type BannerExportResult = z.infer<typeof BannerExportResultSchema>;

export const validateBannerExportResult = async (input: {
  readonly request: unknown;
  readonly result: unknown;
}): Promise<BannerExportResult> => {
  const request = BannerExportRequestSchema.parse(input.request);
  const result = BannerExportResultSchema.parse(input.result);
  if (
    result.artifact.bytes.byteLength !== result.artifact.byteSize ||
    sha256Hex(result.artifact.bytes) !== result.artifact.sha256
  ) {
    throw new TypeError('Export artifact bytes must match their exact size and digest.');
  }
  if (result.artifact.mediaType === 'image/png') {
    const decoded = await validateNormalizedPng(result.artifact.bytes);
    if (
      decoded.width !== result.artifact.pixelWidth ||
      decoded.height !== result.artifact.pixelHeight
    ) {
      throw new TypeError('Export PNG decoded dimensions must match its artifact identity.');
    }
  }
  const output =
    result.artifact.mediaType === 'image/png'
      ? {
          mediaType: result.artifact.mediaType,
          byteSize: result.artifact.byteSize,
          sha256: result.artifact.sha256,
          pixelWidth: result.artifact.pixelWidth,
          pixelHeight: result.artifact.pixelHeight,
        }
      : {
          mediaType: result.artifact.mediaType,
          byteSize: result.artifact.byteSize,
          sha256: result.artifact.sha256,
        };
  const manifest = validateExportReproductionManifestV1(result.manifest, {
    scene: request.scene,
    sceneVersionId: SceneVersionIdSchema.parse(request.sceneVersionId),
    sceneRevision: request.sceneRevision,
    sceneWorkflow: request.sceneWorkflow,
    exportWorkflow: request.exportWorkflow,
    exporter: request.exporter,
    output,
  });
  if (!manifest.success) {
    throw new TypeError('Export reproduction manifest does not match its authoritative inputs.');
  }
  return result;
};

export interface BannerExporterPort {
  export(input: BannerExportRequest): Promise<BannerExportResult>;
}

export const GdnValidationFindingSchema = z
  .strictObject({
    ruleCode: ErrorCodeSchema,
    severity: z.enum(['error', 'warning']),
    message: SafePersistedMessageSchema,
    entryPath: z
      .string()
      .min(1)
      .max(240)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/)
      .nullable(),
  })
  .readonly();

export const GdnValidationRequestSchema = z
  .strictObject({
    artifact: BannerExportArtifactSchema.refine(
      (artifact) => artifact.mediaType === 'application/zip',
      'GDN validation accepts ZIP artifacts only.',
    ),
    profile: ValidatorProfileRefV1Schema,
  })
  .readonly();

export const GdnValidationResultSchema = z
  .strictObject({
    validationLabel: z.literal('internal-provider-free-not-gdn'),
    artifactSha256: Sha256HexSchema,
    profile: ValidatorProfileRefV1Schema,
    outcome: z.enum(['internal-check-passed', 'internal-check-failed']),
    findings: z.array(GdnValidationFindingSchema).max(256).readonly(),
  })
  .superRefine((result, context) => {
    const hasErrors = result.findings.some((finding) => finding.severity === 'error');
    if ((result.outcome === 'internal-check-failed') !== hasErrors) {
      context.addIssue({
        code: 'custom',
        message: 'Internal validator outcome must match the presence of error findings.',
      });
    }
  })
  .readonly();

export type GdnValidationRequest = z.infer<typeof GdnValidationRequestSchema>;
export type GdnValidationResult = z.infer<typeof GdnValidationResultSchema>;

export const validateInternalGdnValidationResult = (input: {
  readonly request: unknown;
  readonly result: unknown;
}): GdnValidationResult => {
  const request = GdnValidationRequestSchema.parse(input.request);
  const result = GdnValidationResultSchema.parse(input.result);
  if (
    result.artifactSha256 !== request.artifact.sha256 ||
    canonicalizeJson(result.profile) !== canonicalizeJson(request.profile)
  ) {
    throw new TypeError('Validator result must match the exact artifact and immutable profile.');
  }
  return result;
};

export interface GdnValidationPort {
  validate(input: GdnValidationRequest): Promise<GdnValidationResult>;
}

export const parseCapabilityCallContext = (input: unknown): CapabilityCallContext => ({
  ...z
    .strictObject({
      deadlineAtMs: EpochMillisecondsSchema,
      externalIdempotencyKey: Sha256HexSchema.nullable(),
      cancellation: CancellationSignalPortSchema,
    })
    .parse(input),
});

export const parseCapabilityEstimate = (input: {
  readonly micros: bigint;
  readonly currency: unknown;
}): { readonly micros: bigint; readonly currency: CurrencyCode } => {
  if (
    typeof input.micros !== 'bigint' ||
    input.micros < 0n ||
    input.micros > 9_000_000_000_000_000n
  ) {
    throw new RangeError('Capability estimate must be an exact bounded bigint micros value.');
  }
  return Object.freeze({
    micros: input.micros,
    currency: CurrencyCodeSchema.parse(input.currency),
  });
};

export type { AssetVersionRefV1, CompositionPartV1 };
