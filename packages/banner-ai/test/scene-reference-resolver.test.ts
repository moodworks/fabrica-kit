import { describe, expect, it, vi } from 'vitest';

import {
  AssetVersionRefV1Schema,
  ProjectIdSchema,
  ValidatorProfileRefV1Schema,
  WorkspaceIdSchema,
  parseBannerSceneV1,
  validateSceneReferences,
  type AssetVersionRefV1,
  type ReferenceResolution,
  type SceneReferenceResolver,
  type ValidatorProfileRefV1,
} from '../src/index.js';
import { cloneRecord, loadAngelRecord, loadAngelScene, recordAt, setAt } from './fixture.js';

const scope = {
  workspaceId: WorkspaceIdSchema.parse('workspace_local_01'),
  projectId: ProjectIdSchema.parse('project_local_01'),
};

const exactResolver = (scene = loadAngelScene()): SceneReferenceResolver => {
  const assets = new Map<string, AssetVersionRefV1>();
  assets.set(scene.sourceAsset.assetVersionId, scene.sourceAsset);
  if (scene.canvas.background.kind === 'image') {
    assets.set(scene.canvas.background.asset.assetVersionId, scene.canvas.background.asset);
  }
  for (const layer of scene.layers) {
    assets.set(layer.asset.assetVersionId, layer.asset);
  }

  return {
    resolveAssetVersion: vi.fn(async (_scope, reference) => {
      const value = assets.get(reference.assetVersionId);
      return value === undefined
        ? ({ status: 'not-found' } as const)
        : ({ status: 'found', value } as const);
    }),
    resolveValidatorProfile: vi.fn(
      async (_scope, reference): Promise<ReferenceResolution<ValidatorProfileRefV1>> => ({
        status: 'found',
        value: reference,
      }),
    ),
  };
};

const asGdnScene = () => {
  const input = cloneRecord(loadAngelRecord());
  setAt(input, ['exportSettings'], {
    kind: 'gdn-html5',
    profileVersion: 1,
    interaction: { kind: 'none' },
    validatorProfile: {
      validatorProfileId: 'validator_profile_01',
      validatorProfileVersion: 3,
      rulesSha256: '6666666666666666666666666666666666666666666666666666666666666666',
    },
  });
  const parsed = parseBannerSceneV1(input);
  if (!parsed.success) throw new TypeError(JSON.stringify(parsed.issues));
  return parsed.data;
};

describe('injected scene reference resolver', () => {
  it('resolves each distinct asset version exactly once', async () => {
    const input = cloneRecord(loadAngelRecord());
    setAt(input, ['layers', 1, 'asset'], structuredClone(recordAt(input, ['layers', 0, 'asset'])));
    const parsed = parseBannerSceneV1(input);
    if (!parsed.success) throw new TypeError(JSON.stringify(parsed.issues));
    const resolver = exactResolver(parsed.data);

    const result = await validateSceneReferences(parsed.data, scope, resolver);

    expect(result.success).toBe(true);
    expect(resolver.resolveAssetVersion).toHaveBeenCalledTimes(4);
    expect(resolver.resolveValidatorProfile).not.toHaveBeenCalled();
  });

  it('reports inaccessible references without disclosing ownership', async () => {
    const scene = loadAngelScene();
    const resolver = exactResolver(scene);
    resolver.resolveAssetVersion = vi.fn(
      async (): Promise<ReferenceResolution<AssetVersionRefV1>> => ({ status: 'not-found' }),
    );

    const result = await validateSceneReferences(scene, scope, resolver);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toContainEqual({
        code: 'REFERENCE_NOT_FOUND',
        path: '/sourceAsset',
        message: 'Asset version is not accessible in the active workspace and project.',
      });
    }
  });

  it('rejects immutable asset metadata mismatches', async () => {
    const scene = loadAngelScene();
    const resolver = exactResolver(scene);
    const mismatched = AssetVersionRefV1Schema.parse({
      ...scene.sourceAsset,
      byteSize: scene.sourceAsset.byteSize + 1,
    });
    resolver.resolveAssetVersion = vi.fn(
      async (_scope, reference): Promise<ReferenceResolution<AssetVersionRefV1>> =>
        reference.assetVersionId === scene.sourceAsset.assetVersionId
          ? { status: 'found', value: mismatched }
          : { status: 'found', value: reference },
    );

    const result = await validateSceneReferences(scene, scope, resolver);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map((entry) => entry.code)).toContain('ASSET_REFERENCE_MISMATCH');
    }
  });

  it('requires an exact GDN validator profile', async () => {
    const scene = asGdnScene();
    if (scene.exportSettings.kind !== 'gdn-html5') throw new TypeError('Expected GDN scene.');
    const resolver = exactResolver(scene);
    const mismatched = ValidatorProfileRefV1Schema.parse({
      ...scene.exportSettings.validatorProfile,
      rulesSha256: '7777777777777777777777777777777777777777777777777777777777777777',
    });
    resolver.resolveValidatorProfile = vi.fn(
      async (): Promise<ReferenceResolution<ValidatorProfileRefV1>> => ({
        status: 'found',
        value: mismatched,
      }),
    );

    const result = await validateSceneReferences(scene, scope, resolver);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toContainEqual({
        code: 'VALIDATOR_PROFILE_MISMATCH',
        path: '/exportSettings/validatorProfile',
        message: 'Resolved validator profile does not exactly match the immutable scene reference.',
      });
    }
  });

  it('uses REFERENCE_NOT_FOUND for an inaccessible GDN profile', async () => {
    const scene = asGdnScene();
    const resolver = exactResolver(scene);
    resolver.resolveValidatorProfile = vi.fn(
      async (): Promise<ReferenceResolution<ValidatorProfileRefV1>> => ({
        status: 'not-found',
      }),
    );

    const result = await validateSceneReferences(scene, scope, resolver);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map((entry) => entry.code)).toContain('REFERENCE_NOT_FOUND');
    }
  });
});
