import {
  assetReferencesEqual,
  collectSceneAssetReferences,
  type AssetVersionRefV1,
  type BannerSceneV1,
  type ValidatorProfileRefV1,
} from '../scene/banner-scene-v1.schema.js';
import {
  issue,
  validationFailure,
  validationSuccess,
  type ValidationIssue,
  type ValidationResult,
} from '../scene/validation.js';
import type { ProjectId, WorkspaceId } from '../context/actor-workspace-context.js';

export interface SceneReferenceScope {
  readonly workspaceId: WorkspaceId;
  readonly projectId: ProjectId;
}

export type ReferenceResolution<T> =
  { readonly status: 'found'; readonly value: T } | { readonly status: 'not-found' };

export interface SceneReferenceResolver {
  resolveAssetVersion(
    scope: SceneReferenceScope,
    reference: AssetVersionRefV1,
  ): Promise<ReferenceResolution<AssetVersionRefV1>>;
  resolveValidatorProfile(
    scope: SceneReferenceScope,
    reference: ValidatorProfileRefV1,
  ): Promise<ReferenceResolution<ValidatorProfileRefV1>>;
}

const validatorProfilesEqual = (
  left: ValidatorProfileRefV1,
  right: ValidatorProfileRefV1,
): boolean =>
  left.validatorProfileId === right.validatorProfileId &&
  left.validatorProfileVersion === right.validatorProfileVersion &&
  left.rulesSha256 === right.rulesSha256;

export const validateSceneReferences = async (
  scene: BannerSceneV1,
  scope: SceneReferenceScope,
  resolver: SceneReferenceResolver,
): Promise<ValidationResult<BannerSceneV1>> => {
  const issues: ValidationIssue[] = [];
  const resolutions = new Map<string, ReferenceResolution<AssetVersionRefV1>>();

  for (const occurrence of collectSceneAssetReferences(scene)) {
    let resolution = resolutions.get(occurrence.reference.assetVersionId);
    if (resolution === undefined) {
      resolution = await resolver.resolveAssetVersion(scope, occurrence.reference);
      resolutions.set(occurrence.reference.assetVersionId, resolution);
    }

    if (resolution.status === 'not-found') {
      issues.push(
        issue(
          'REFERENCE_NOT_FOUND',
          occurrence.path,
          'Asset version is not accessible in the active workspace and project.',
        ),
      );
    } else if (!assetReferencesEqual(occurrence.reference, resolution.value)) {
      issues.push(
        issue(
          'ASSET_REFERENCE_MISMATCH',
          occurrence.path,
          'Resolved asset metadata does not exactly match the immutable scene reference.',
        ),
      );
    }
  }

  if (scene.exportSettings.kind === 'gdn-html5') {
    const path = ['exportSettings', 'validatorProfile'] as const;
    const resolution = await resolver.resolveValidatorProfile(
      scope,
      scene.exportSettings.validatorProfile,
    );
    if (resolution.status === 'not-found') {
      issues.push(
        issue(
          'REFERENCE_NOT_FOUND',
          path,
          'Validator profile is not accessible in the active workspace.',
        ),
      );
    } else if (!validatorProfilesEqual(scene.exportSettings.validatorProfile, resolution.value)) {
      issues.push(
        issue(
          'VALIDATOR_PROFILE_MISMATCH',
          path,
          'Resolved validator profile does not exactly match the immutable scene reference.',
        ),
      );
    }
  }

  return issues.length === 0 ? validationSuccess(scene) : validationFailure(issues);
};
