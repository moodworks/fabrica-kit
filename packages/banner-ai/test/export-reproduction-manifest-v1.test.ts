import { describe, expect, it } from 'vitest';

import {
  ExportOutputManifestV1Schema,
  ExporterManifestRefV1Schema,
  SceneVersionIdSchema,
  WorkflowManifestRefV1Schema,
  collectSceneAssetReferences,
  parseBannerSceneV1,
  parseExportReproductionManifestV1,
  sha256BannerScene,
  validateExportReproductionManifestV1,
  type BannerSceneV1,
  type ExportManifestExpectationsV1,
  type ExportOutputManifestV1,
} from '../src/index.js';
import { cloneRecord, loadAngelRecord, loadAngelScene, setAt } from './fixture.js';

const digest = (character: string): string => character.repeat(64);

const sceneWorkflow = WorkflowManifestRefV1Schema.parse({
  workflowVersionId: 'workflow_scene_01',
  workflowVersion: 2,
  definitionSha256: digest('8'),
});
const exportWorkflow = WorkflowManifestRefV1Schema.parse({
  workflowVersionId: 'workflow_export_01',
  workflowVersion: 5,
  definitionSha256: digest('9'),
});
const exporter = ExporterManifestRefV1Schema.parse({
  exporterId: 'exporter_local_01',
  exporterVersion: 7,
  buildSha256: digest('a'),
});
const sceneVersionId = SceneVersionIdSchema.parse('scene_version_01');

const hardcodedCanonicalAngelAssetVersions = [
  {
    assetId: 'asset_background_01',
    assetVersionId: 'av_background_0001',
    sha256: '2222222222222222222222222222222222222222222222222222222222222222',
    mediaType: 'image/png',
    byteSize: 91_240,
    pixelWidth: 300,
    pixelHeight: 250,
  },
  {
    assetId: 'asset_body_01',
    assetVersionId: 'av_body_0001',
    sha256: '3333333333333333333333333333333333333333333333333333333333333333',
    mediaType: 'image/png',
    byteSize: 73_520,
    pixelWidth: 100,
    pixelHeight: 190,
  },
  {
    assetId: 'asset_left_wing_01',
    assetVersionId: 'av_left_wing_0001',
    sha256: '4444444444444444444444444444444444444444444444444444444444444444',
    mediaType: 'image/png',
    byteSize: 52_480,
    pixelWidth: 100,
    pixelHeight: 130,
  },
  {
    assetId: 'asset_right_wing_01',
    assetVersionId: 'av_right_wing_0001',
    sha256: '5555555555555555555555555555555555555555555555555555555555555555',
    mediaType: 'image/png',
    byteSize: 51_960,
    pixelWidth: 100,
    pixelHeight: 130,
  },
  {
    assetId: 'asset_source_01',
    assetVersionId: 'av_source_0001',
    sha256: '1111111111111111111111111111111111111111111111111111111111111111',
    mediaType: 'image/png',
    byteSize: 148_200,
    pixelWidth: 300,
    pixelHeight: 250,
  },
] as const;

const sortedAssets = (scene: BannerSceneV1) => {
  const byVersion = new Map(
    collectSceneAssetReferences(scene).map(({ reference }) => [
      reference.assetVersionId,
      reference,
    ]),
  );
  return [...byVersion.values()].sort((left, right) =>
    left.assetVersionId < right.assetVersionId
      ? -1
      : left.assetVersionId > right.assetVersionId
        ? 1
        : 0,
  );
};

const buildCase = (
  scene: BannerSceneV1,
  output: ExportOutputManifestV1,
): {
  expected: ExportManifestExpectationsV1;
  manifest: Record<string, unknown>;
} => ({
  expected: {
    scene,
    sceneVersionId,
    sceneRevision: 3,
    sceneWorkflow: structuredClone(sceneWorkflow),
    exportWorkflow: structuredClone(exportWorkflow),
    exporter: structuredClone(exporter),
    output: structuredClone(output),
  },
  manifest: {
    manifestVersion: 1,
    sceneVersionId,
    sceneRevision: 3,
    sceneEncoding: 'banner-scene-json-v1',
    sceneSha256: sha256BannerScene(scene),
    assetVersions: sortedAssets(scene),
    sceneWorkflow: structuredClone(sceneWorkflow),
    exportWorkflow: structuredClone(exportWorkflow),
    exporter: structuredClone(exporter),
    validator:
      scene.exportSettings.kind === 'gdn-html5'
        ? { kind: 'profile', profile: structuredClone(scene.exportSettings.validatorProfile) }
        : { kind: 'none' },
    output: structuredClone(output),
  },
});

const parseScene = (input: Record<string, unknown>): BannerSceneV1 => {
  const parsed = parseBannerSceneV1(input);
  if (!parsed.success) throw new TypeError(JSON.stringify(parsed.issues));
  return parsed.data;
};

const zipOutput = ExportOutputManifestV1Schema.parse({
  mediaType: 'application/zip',
  byteSize: 4_096,
  sha256: digest('b'),
});

describe('ExportReproductionManifestV1', () => {
  it('validates an exact regular HTML ZIP manifest', () => {
    const scene = loadAngelScene();
    const { expected, manifest } = buildCase(scene, zipOutput);
    manifest['assetVersions'] = structuredClone(hardcodedCanonicalAngelAssetVersions);

    expect(validateExportReproductionManifestV1(manifest, expected)).toEqual({
      success: true,
      data: manifest,
    });
  });

  it('validates an exact GDN ZIP manifest with its immutable validator profile', () => {
    const input = cloneRecord(loadAngelRecord());
    setAt(input, ['exportSettings'], {
      kind: 'gdn-html5',
      profileVersion: 1,
      interaction: { kind: 'single-exit', destinationUrl: 'https://example.com/campaign' },
      validatorProfile: {
        validatorProfileId: 'validator_profile_01',
        validatorProfileVersion: 4,
        rulesSha256: digest('c'),
      },
    });
    const scene = parseScene(input);
    const { expected, manifest } = buildCase(scene, zipOutput);

    expect(validateExportReproductionManifestV1(manifest, expected).success).toBe(true);
  });

  it('validates an exact static PNG manifest with canvas dimensions', () => {
    const input = cloneRecord(loadAngelRecord());
    setAt(input, ['exportSettings'], {
      kind: 'static-png',
      profileVersion: 1,
      frameTimeMs: 18_000,
    });
    const scene = parseScene(input);
    const pngOutput = ExportOutputManifestV1Schema.parse({
      mediaType: 'image/png',
      byteSize: 8_192,
      sha256: digest('d'),
      pixelWidth: 300,
      pixelHeight: 250,
    });
    const { expected, manifest } = buildCase(scene, pngOutput);

    expect(validateExportReproductionManifestV1(manifest, expected).success).toBe(true);
  });

  it('rejects unknown, missing, duplicate, and unsorted manifest fields', () => {
    const scene = loadAngelScene();
    const { manifest } = buildCase(scene, zipOutput);
    const unknown = structuredClone(manifest);
    unknown['provider'] = 'remote';
    const missing = structuredClone(manifest);
    delete missing['sceneWorkflow'];
    const duplicate = structuredClone(manifest);
    const duplicateAssets = duplicate['assetVersions'];
    if (!Array.isArray(duplicateAssets)) throw new TypeError('Expected assetVersions.');
    duplicateAssets.splice(1, 0, structuredClone(duplicateAssets[0]));
    const unsorted = structuredClone(manifest);
    const unsortedAssets = unsorted['assetVersions'];
    if (!Array.isArray(unsortedAssets)) throw new TypeError('Expected assetVersions.');
    [unsortedAssets[0], unsortedAssets[1]] = [unsortedAssets[1], unsortedAssets[0]];

    const codes = [unknown, missing, duplicate, unsorted].map((value) => {
      const parsed = parseExportReproductionManifestV1(value);
      if (parsed.success) return [];
      return parsed.issues.map((entry) => entry.code);
    });

    expect(codes[0]).toContain('MANIFEST_UNKNOWN_KEY');
    expect(codes[1]).toContain('MANIFEST_REQUIRED');
    expect(codes[2]).toContain('MANIFEST_ASSET_ORDER_INVALID');
    expect(codes[3]).toContain('MANIFEST_ASSET_ORDER_INVALID');
  });

  it.each([
    {
      name: 'scene identity',
      code: 'MANIFEST_SCENE_MISMATCH',
      mutate: (manifest: Record<string, unknown>) => {
        manifest['sceneSha256'] = digest('0');
      },
    },
    {
      name: 'asset list',
      code: 'MANIFEST_ASSET_MISMATCH',
      mutate: (manifest: Record<string, unknown>) => {
        const assets = manifest['assetVersions'];
        if (!Array.isArray(assets)) throw new TypeError('Expected assetVersions.');
        assets.pop();
      },
    },
    {
      name: 'scene workflow',
      code: 'MANIFEST_WORKFLOW_MISMATCH',
      mutate: (manifest: Record<string, unknown>) => {
        setAt(manifest, ['sceneWorkflow', 'workflowVersion'], 3);
      },
    },
    {
      name: 'exporter identity',
      code: 'MANIFEST_INVALID',
      mutate: (manifest: Record<string, unknown>) => {
        setAt(manifest, ['exporter', 'exporterVersion'], 8);
      },
    },
    {
      name: 'validator selection',
      code: 'MANIFEST_VALIDATOR_MISMATCH',
      mutate: (manifest: Record<string, unknown>) => {
        manifest['validator'] = {
          kind: 'profile',
          profile: {
            validatorProfileId: 'validator_profile_01',
            validatorProfileVersion: 1,
            rulesSha256: digest('e'),
          },
        };
      },
    },
    {
      name: 'output artifact',
      code: 'MANIFEST_OUTPUT_MISMATCH',
      mutate: (manifest: Record<string, unknown>) => {
        setAt(manifest, ['output', 'byteSize'], 4_097);
      },
    },
  ])('rejects a $name mismatch with $code', ({ code, mutate }) => {
    const scene = loadAngelScene();
    const { expected, manifest } = buildCase(scene, zipOutput);
    mutate(manifest);

    const result = validateExportReproductionManifestV1(manifest, expected);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map((entry) => entry.code)).toContain(code);
    }
  });

  it('rejects a PNG with dimensions different from its scene canvas', () => {
    const input = cloneRecord(loadAngelRecord());
    setAt(input, ['exportSettings'], {
      kind: 'static-png',
      profileVersion: 1,
      frameTimeMs: 0,
    });
    setAt(input, ['timeline'], []);
    const scene = parseScene(input);
    const output = ExportOutputManifestV1Schema.parse({
      mediaType: 'image/png',
      byteSize: 1,
      sha256: digest('f'),
      pixelWidth: 301,
      pixelHeight: 250,
    });
    const { expected, manifest } = buildCase(scene, output);

    const result = validateExportReproductionManifestV1(manifest, expected);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.map((entry) => entry.code)).toContain('MANIFEST_OUTPUT_MISMATCH');
    }
  });
});
