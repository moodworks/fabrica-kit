import {
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
import {
  ExportReproductionManifestV1Schema,
  type ExportOutputManifestV1,
  type ExportReproductionManifestV1,
  type ExporterManifestRefV1,
  type WorkflowManifestRefV1,
} from './export-reproduction-manifest-v1.contract.js';

export * from './export-reproduction-manifest-v1.contract.js';

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
