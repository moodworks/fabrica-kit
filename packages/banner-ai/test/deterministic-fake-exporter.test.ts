import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  ExportOutputManifestV1Schema,
  ExporterManifestRefV1Schema,
  LocalAssetStorage,
  SceneVersionIdSchema,
  WorkflowManifestRefV1Schema,
  byteSourceFrom,
  collectSceneAssetReferences,
  createArtifactObjectKey,
  createDeterministicFakePngArtifact,
  createDeterministicFakeZipArtifact,
  normalizeRasterUpload,
  parseBannerSceneV1,
  sha256BannerScene,
  validateExportReproductionManifestV1,
  type BannerSceneV1,
  type FakeExportAsset,
} from '../src/index.js';
import { cloneRecord, loadAngelRecord, setAt } from './fixture.js';

const pinnedFakeZipSha256 = '8a05cbb9c03e888b6d7afa3baf04b2860c5515c361e78967831ce2ba4d57a4a8';

const signatureOffsets = (bytes: Buffer, signature: number): readonly number[] => {
  const encoded = Buffer.alloc(4);
  encoded.writeUInt32LE(signature);
  const result: number[] = [];
  let cursor = 0;
  while (cursor < bytes.length) {
    const offset = bytes.indexOf(encoded, cursor);
    if (offset < 0) break;
    result.push(offset);
    cursor = offset + 4;
  }
  return result;
};

const normalizedCanvasPng = async () => {
  const input = await sharp({
    create: {
      width: 300,
      height: 250,
      channels: 4,
      background: { r: 20, g: 40, b: 80, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  return normalizeRasterUpload({
    bytes: byteSourceFrom(input),
    declaredMediaType: 'image/png',
    filename: 'synthetic-canvas.png',
  });
};

const fakeSceneAndAssets = async (
  exportSettings?: Record<string, unknown>,
): Promise<{
  assets: readonly FakeExportAsset[];
  normalizedBytes: Uint8Array;
  scene: BannerSceneV1;
}> => {
  const normalized = await normalizedCanvasPng();
  const input = cloneRecord(loadAngelRecord());
  const references = [
    ['sourceAsset'],
    ['canvas', 'background', 'asset'],
    ['layers', 0, 'asset'],
    ['layers', 1, 'asset'],
    ['layers', 2, 'asset'],
  ] as const;
  for (const path of references) {
    setAt(input, [...path, 'sha256'], normalized.sha256);
    setAt(input, [...path, 'byteSize'], normalized.byteSize);
    setAt(input, [...path, 'pixelWidth'], normalized.width);
    setAt(input, [...path, 'pixelHeight'], normalized.height);
    setAt(input, [...path, 'mediaType'], 'image/png');
  }
  if (exportSettings !== undefined) setAt(input, ['exportSettings'], exportSettings);
  const parsed = parseBannerSceneV1(input);
  if (!parsed.success) throw new TypeError(JSON.stringify(parsed.issues));
  const byVersion = new Map(
    collectSceneAssetReferences(parsed.data).map(({ reference }) => [
      reference.assetVersionId,
      { reference, bytes: normalized.bytes },
    ]),
  );
  return { assets: [...byVersion.values()], normalizedBytes: normalized.bytes, scene: parsed.data };
};

describe('deterministic provider-free fake exporter', () => {
  it('produces byte-identical inspected ZIPs with fixed entry grammar and no remote dependencies', async () => {
    const input = await fakeSceneAndAssets();

    const first = await createDeterministicFakeZipArtifact(input);
    const second = await createDeterministicFakeZipArtifact(input);

    expect(first.bytes).toEqual(second.bytes);
    expect(first.sha256).toBe(second.sha256);
    expect(first.sha256).toBe(pinnedFakeZipSha256);
    expect(createHash('sha256').update(first.bytes).digest('hex')).toBe(pinnedFakeZipSha256);
    expect(first.validationLabel).toBe('internal-provider-free-not-gdn');
    expect(first.inspection.entries.map((entry) => entry.name)).toEqual([
      'index.html',
      'styles.css',
      'runtime.js',
      'scene.json',
      'INTERNAL-NON-GDN.txt',
      'assets/av_background_0001.png',
      'assets/av_body_0001.png',
      'assets/av_left_wing_0001.png',
      'assets/av_right_wing_0001.png',
    ]);

    const bytes = Buffer.from(first.bytes);
    const localHeaders = signatureOffsets(bytes, 0x04034b50);
    const centralHeaders = signatureOffsets(bytes, 0x02014b50);
    expect(localHeaders).toHaveLength(9);
    expect(centralHeaders).toHaveLength(9);
    for (const offset of localHeaders) {
      expect(bytes.readUInt16LE(offset + 8)).toBe(0);
      expect(bytes.readUInt16LE(offset + 10)).toBe(0);
      expect(bytes.readUInt16LE(offset + 12)).toBe(33);
      expect(bytes.readUInt16LE(offset + 28)).toBe(0);
    }
    for (const offset of centralHeaders) {
      expect(bytes.readUInt16LE(offset + 10)).toBe(0);
      expect(bytes.readUInt16LE(offset + 30)).toBe(0);
      expect(bytes.readUInt16LE(offset + 32)).toBe(0);
      expect(bytes.readUInt32LE(offset + 38) >>> 16).toBe(0o100644);
    }
    const eocd = signatureOffsets(bytes, 0x06054b50).at(-1)!;
    expect(bytes.readUInt16LE(eocd + 20)).toBe(0);
  });

  it('stores, reads, and manifests only the exact inspected artifact bytes', async () => {
    const input = await fakeSceneAndAssets();
    const artifact = await createDeterministicFakeZipArtifact(input);
    expect(artifact.sha256).toBe(pinnedFakeZipSha256);

    const root = await mkdtemp(path.join(tmpdir(), 'banner-ai-export-round-trip-'));
    let readBack: Uint8Array;
    try {
      const storage = await LocalAssetStorage.create({ rootDirectory: root });
      const expected = {
        key: createArtifactObjectKey({
          workspaceId: '10000000-0000-4000-8000-000000000001',
          projectId: '20000000-0000-4000-8000-000000000002',
          jobId: '30000000-0000-4000-8000-000000000003',
          outputId: '40000000-0000-4000-8000-000000000004',
        }),
        byteSize: artifact.byteSize,
        sha256: artifact.sha256,
      };
      const staged = await storage.stageExact(expected, [artifact.bytes]);
      await expect(storage.promote(staged)).resolves.toBe('promoted');
      readBack = await storage.readExact(expected);
    } finally {
      await rm(root, { recursive: true, force: true });
    }

    const readBackSha256 = createHash('sha256').update(readBack).digest('hex');
    expect(readBack).toEqual(artifact.bytes);
    expect(readBackSha256).toBe(pinnedFakeZipSha256);

    const sceneWorkflow = WorkflowManifestRefV1Schema.parse({
      workflowVersionId: 'workflow_scene_01',
      workflowVersion: 1,
      definitionSha256: '8'.repeat(64),
    });
    const exportWorkflow = WorkflowManifestRefV1Schema.parse({
      workflowVersionId: 'workflow_export_01',
      workflowVersion: 1,
      definitionSha256: '9'.repeat(64),
    });
    const exporter = ExporterManifestRefV1Schema.parse({
      exporterId: 'exporter_fake_01',
      exporterVersion: 1,
      buildSha256: 'a'.repeat(64),
    });
    const output = ExportOutputManifestV1Schema.parse({
      mediaType: 'application/zip',
      byteSize: readBack.byteLength,
      sha256: readBackSha256,
    });
    const sceneVersionId = SceneVersionIdSchema.parse('scene_version_01');
    const assetVersions = collectSceneAssetReferences(input.scene)
      .map(({ reference }) => reference)
      .filter(
        (reference, index, values) =>
          values.findIndex((value) => value.assetVersionId === reference.assetVersionId) === index,
      )
      .sort((left, right) =>
        left.assetVersionId < right.assetVersionId
          ? -1
          : left.assetVersionId > right.assetVersionId
            ? 1
            : 0,
      );
    const manifest = {
      manifestVersion: 1,
      sceneVersionId,
      sceneRevision: 1,
      sceneEncoding: 'banner-scene-json-v1',
      sceneSha256: sha256BannerScene(input.scene),
      assetVersions,
      sceneWorkflow,
      exportWorkflow,
      exporter,
      validator: { kind: 'none' },
      output,
    };

    expect(
      validateExportReproductionManifestV1(manifest, {
        scene: input.scene,
        sceneVersionId,
        sceneRevision: 1,
        sceneWorkflow,
        exportWorkflow,
        exporter,
        output,
      }).success,
    ).toBe(true);
  });

  it('packages only the image background and included layers while retaining all scene references', async () => {
    const input = await fakeSceneAndAssets();
    const excludedLayer = input.scene.layers[1]!;
    const scene: BannerSceneV1 = {
      ...input.scene,
      layers: input.scene.layers.map((layer) =>
        layer.id === excludedLayer.id ? { ...layer, included: false } : layer,
      ),
    };

    const artifact = await createDeterministicFakeZipArtifact({ scene, assets: input.assets });

    expect(artifact.inspection.entries.map((entry) => entry.name)).not.toContain(
      `assets/${excludedLayer.asset.assetVersionId}.png`,
    );
    expect(
      collectSceneAssetReferences(scene).some(
        ({ reference }) => reference.assetVersionId === excludedLayer.asset.assetVersionId,
      ),
    ).toBe(true);
    expect(artifact.inspection.entries.map((entry) => entry.name)).not.toContain(
      `assets/${scene.sourceAsset.assetVersionId}.png`,
    );
  });

  it('returns deterministic inspected PNG bytes only for matching static scenes', async () => {
    const input = await fakeSceneAndAssets({
      kind: 'static-png',
      profileVersion: 1,
      frameTimeMs: 18_000,
    });

    const first = await createDeterministicFakePngArtifact({
      scene: input.scene,
      normalizedPngBytes: input.normalizedBytes,
    });
    const second = await createDeterministicFakePngArtifact({
      scene: input.scene,
      normalizedPngBytes: input.normalizedBytes,
    });

    expect(first).toEqual(second);
    expect(first.pixelWidth).toBe(300);
    expect(first.pixelHeight).toBe(250);
    expect(first.validationLabel).toBe('internal-provider-free-not-gdn');
  });

  it('rejects missing or mismatched immutable asset bytes', async () => {
    const input = await fakeSceneAndAssets();

    await expect(
      createDeterministicFakeZipArtifact({ scene: input.scene, assets: input.assets.slice(1) }),
    ).rejects.toThrow(/exact immutable bytes/);
    const mismatched = input.assets.map((asset, index) =>
      index === 0 ? { ...asset, bytes: Buffer.from('wrong') } : asset,
    );
    await expect(
      createDeterministicFakeZipArtifact({ scene: input.scene, assets: mismatched }),
    ).rejects.toThrow(/exact immutable bytes/);
  });
});
