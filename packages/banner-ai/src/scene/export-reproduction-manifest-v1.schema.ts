import { z, type RefinementCtx } from 'zod';

import {
  AssetVersionRefV1Schema,
  OpaqueIdSchema,
  PositiveInt32Schema,
  Sha256HexSchema,
  ValidatorProfileRefV1Schema,
  assetReferencesEqual,
  collectSceneAssetReferences,
  type AssetVersionRefV1,
  type BannerSceneV1,
} from './banner-scene-v1.schema.js';
import { canonicalizeJson, sha256BannerScene } from './canonical-scene-json.js';
import {
  issue,
  validationFailure,
  validationSuccess,
  zodIssuesToValidationIssues,
  type ValidationIssue,
  type ValidationResult,
} from './validation.js';

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

export const parseExportReproductionManifestV1 = (
  input: unknown,
): ValidationResult<ExportReproductionManifestV1> => {
  const parsed = ExportReproductionManifestV1Schema.safeParse(input);
  return parsed.success
    ? validationSuccess(parsed.data)
    : validationFailure(zodIssuesToValidationIssues(parsed.error.issues, input, 'manifest'));
};

export interface ExportManifestExpectationsV1 {
  readonly scene: BannerSceneV1;
  readonly sceneVersionId: ExportReproductionManifestV1['sceneVersionId'];
  readonly sceneRevision: number;
  readonly sceneWorkflow: WorkflowManifestRefV1;
  readonly exportWorkflow: WorkflowManifestRefV1;
  readonly exporter: ExporterManifestRefV1;
  readonly output: ExportOutputManifestV1;
}

const manifestValuesEqual = (left: unknown, right: unknown): boolean =>
  canonicalizeJson(left) === canonicalizeJson(right);

const distinctSceneAssets = (scene: BannerSceneV1): readonly AssetVersionRefV1[] => {
  const byVersion = new Map<string, AssetVersionRefV1>();
  for (const { reference } of collectSceneAssetReferences(scene)) {
    if (!byVersion.has(reference.assetVersionId)) {
      byVersion.set(reference.assetVersionId, reference);
    }
  }
  return [...byVersion.values()].sort((left, right) =>
    left.assetVersionId < right.assetVersionId
      ? -1
      : left.assetVersionId > right.assetVersionId
        ? 1
        : 0,
  );
};

const assetListsEqual = (
  left: readonly AssetVersionRefV1[],
  right: readonly AssetVersionRefV1[],
): boolean =>
  left.length === right.length &&
  left.every((reference, index) => assetReferencesEqual(reference, right[index]!));

export const validateExportReproductionManifestV1 = (
  input: unknown,
  expected: ExportManifestExpectationsV1,
): ValidationResult<ExportReproductionManifestV1> => {
  const parsed = parseExportReproductionManifestV1(input);
  if (!parsed.success) {
    return parsed;
  }

  const manifest = parsed.data;
  const issues: ValidationIssue[] = [];
  const expectedSceneSha256 = sha256BannerScene(expected.scene);

  if (manifest.sceneVersionId !== expected.sceneVersionId) {
    issues.push(
      issue(
        'MANIFEST_SCENE_MISMATCH',
        ['sceneVersionId'],
        'Manifest scene version ID does not match the immutable scene.',
      ),
    );
  }
  if (manifest.sceneRevision !== expected.sceneRevision) {
    issues.push(
      issue(
        'MANIFEST_SCENE_MISMATCH',
        ['sceneRevision'],
        'Manifest scene revision does not match the immutable scene.',
      ),
    );
  }
  if (manifest.sceneSha256 !== expectedSceneSha256) {
    issues.push(
      issue(
        'MANIFEST_SCENE_MISMATCH',
        ['sceneSha256'],
        'Manifest scene digest does not match the canonical immutable scene bytes.',
      ),
    );
  }

  if (!assetListsEqual(manifest.assetVersions, distinctSceneAssets(expected.scene))) {
    issues.push(
      issue(
        'MANIFEST_ASSET_MISMATCH',
        ['assetVersions'],
        'Manifest assetVersions must exactly match every distinct scene asset reference.',
      ),
    );
  }

  if (!manifestValuesEqual(manifest.sceneWorkflow, expected.sceneWorkflow)) {
    issues.push(
      issue(
        'MANIFEST_WORKFLOW_MISMATCH',
        ['sceneWorkflow'],
        'Manifest scene workflow must exactly match its immutable workflow version.',
      ),
    );
  }
  if (!manifestValuesEqual(manifest.exportWorkflow, expected.exportWorkflow)) {
    issues.push(
      issue(
        'MANIFEST_WORKFLOW_MISMATCH',
        ['exportWorkflow'],
        'Manifest export workflow must exactly match its immutable workflow version.',
      ),
    );
  }

  if (!manifestValuesEqual(manifest.exporter, expected.exporter)) {
    issues.push(
      issue(
        'MANIFEST_INVALID',
        ['exporter'],
        'Manifest exporter must exactly match the immutable exporter identity.',
      ),
    );
  }

  const sceneValidator =
    expected.scene.exportSettings.kind === 'gdn-html5'
      ? { kind: 'profile' as const, profile: expected.scene.exportSettings.validatorProfile }
      : { kind: 'none' as const };
  if (!manifestValuesEqual(manifest.validator, sceneValidator)) {
    issues.push(
      issue(
        'MANIFEST_VALIDATOR_MISMATCH',
        ['validator'],
        'Manifest validator must exactly match the scene export profile.',
      ),
    );
  }

  const expectedMediaType =
    expected.scene.exportSettings.kind === 'static-png' ? 'image/png' : 'application/zip';
  if (
    manifest.output.mediaType !== expectedMediaType ||
    !manifestValuesEqual(manifest.output, expected.output) ||
    (manifest.output.mediaType === 'image/png' &&
      (manifest.output.pixelWidth !== expected.scene.canvas.width ||
        manifest.output.pixelHeight !== expected.scene.canvas.height))
  ) {
    issues.push(
      issue(
        'MANIFEST_OUTPUT_MISMATCH',
        ['output'],
        'Manifest output must exactly match the artifact and selected scene export profile.',
      ),
    );
  }

  return issues.length === 0 ? validationSuccess(manifest) : validationFailure(issues);
};
