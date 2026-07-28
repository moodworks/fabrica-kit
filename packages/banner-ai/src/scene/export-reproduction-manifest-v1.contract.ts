import { z, type RefinementCtx } from 'zod';

import {
  AssetVersionRefV1Schema,
  OpaqueIdSchema,
  PositiveInt32Schema,
  Sha256HexSchema,
  ValidatorProfileRefV1Schema,
} from './banner-scene-v1.schema.js';

const addManifestIssue = (
  context: RefinementCtx,
  code: 'MANIFEST_ASSET_ORDER_INVALID',
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

export const SceneVersionIdSchema = OpaqueIdSchema.brand<'SceneVersionId'>();
export const WorkflowVersionIdSchema = OpaqueIdSchema.brand<'WorkflowVersionId'>();
export const ExporterIdSchema = OpaqueIdSchema.brand<'ExporterId'>();

export const WorkflowManifestRefV1Schema = z.strictObject({
  workflowVersionId: WorkflowVersionIdSchema,
  workflowVersion: PositiveInt32Schema,
  definitionSha256: Sha256HexSchema,
});

export const ExporterManifestRefV1Schema = z.strictObject({
  exporterId: ExporterIdSchema,
  exporterVersion: PositiveInt32Schema,
  buildSha256: Sha256HexSchema,
});

const NoValidatorManifestV1Schema = z.strictObject({ kind: z.literal('none') });
const ProfileValidatorManifestV1Schema = z.strictObject({
  kind: z.literal('profile'),
  profile: ValidatorProfileRefV1Schema,
});

export const ValidatorManifestV1Schema = z.discriminatedUnion('kind', [
  NoValidatorManifestV1Schema,
  ProfileValidatorManifestV1Schema,
]);

const ZipOutputManifestV1Schema = z.strictObject({
  mediaType: z.literal('application/zip'),
  byteSize: z.int().min(1).max(52_428_800),
  sha256: Sha256HexSchema,
});

const PngOutputManifestV1Schema = z.strictObject({
  mediaType: z.literal('image/png'),
  byteSize: z.int().min(1).max(52_428_800),
  sha256: Sha256HexSchema,
  pixelWidth: z.int().min(1).max(4_096),
  pixelHeight: z.int().min(1).max(4_096),
});

export const ExportOutputManifestV1Schema = z.discriminatedUnion('mediaType', [
  ZipOutputManifestV1Schema,
  PngOutputManifestV1Schema,
]);

const ExportReproductionManifestV1StructuralSchema = z.strictObject({
  manifestVersion: z.literal(1),
  sceneVersionId: SceneVersionIdSchema,
  sceneRevision: PositiveInt32Schema,
  sceneEncoding: z.literal('banner-scene-json-v1'),
  sceneSha256: Sha256HexSchema,
  assetVersions: z.array(AssetVersionRefV1Schema).min(1).max(66).readonly(),
  sceneWorkflow: WorkflowManifestRefV1Schema,
  exportWorkflow: WorkflowManifestRefV1Schema,
  exporter: ExporterManifestRefV1Schema,
  validator: ValidatorManifestV1Schema,
  output: ExportOutputManifestV1Schema,
});

export const ExportReproductionManifestV1Schema =
  ExportReproductionManifestV1StructuralSchema.superRefine((manifest, context) => {
    for (let index = 1; index < manifest.assetVersions.length; index += 1) {
      const previous = manifest.assetVersions[index - 1]!;
      const current = manifest.assetVersions[index]!;
      if (previous.assetVersionId >= current.assetVersionId) {
        addManifestIssue(
          context,
          'MANIFEST_ASSET_ORDER_INVALID',
          ['assetVersions', index],
          'Manifest asset versions must be unique and strictly ASCII-sorted by assetVersionId.',
        );
      }
    }
  });

export type WorkflowManifestRefV1 = z.infer<typeof WorkflowManifestRefV1Schema>;
export type ExporterManifestRefV1 = z.infer<typeof ExporterManifestRefV1Schema>;
export type ValidatorManifestV1 = z.infer<typeof ValidatorManifestV1Schema>;
export type ExportOutputManifestV1 = z.infer<typeof ExportOutputManifestV1Schema>;
export type ExportReproductionManifestV1 = z.infer<typeof ExportReproductionManifestV1Schema>;
