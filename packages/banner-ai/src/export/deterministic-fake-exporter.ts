import { sha256Hex } from '../scene/canonical-scene-json.js';
import {
  assetReferencesEqual,
  collectSceneAssetReferences,
  type AssetVersionRefV1,
  type BannerSceneV1,
} from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import { MAX_RASTER_ENCODED_BYTES } from '../security/raster-container.js';
import { validateNormalizedPng } from '../security/raster-upload.js';
import {
  createExactZipContentPolicy,
  inspectZipBytes,
  MAX_ZIP_ARCHIVE_BYTES,
  type ZipInspectionResult,
} from './zip-inspector.js';
import { ZipFile } from 'yazl';

export interface FakeExportAsset {
  readonly bytes: Uint8Array;
  readonly reference: AssetVersionRefV1;
}

export interface DeterministicFakeZipArtifact {
  readonly byteSize: number;
  readonly bytes: Uint8Array;
  readonly inspection: ZipInspectionResult;
  readonly mediaType: 'application/zip';
  readonly sha256: string;
  readonly validationLabel: 'internal-provider-free-not-gdn';
}

export interface DeterministicFakePngArtifact {
  readonly byteSize: number;
  readonly bytes: Uint8Array;
  readonly mediaType: 'image/png';
  readonly pixelHeight: number;
  readonly pixelWidth: number;
  readonly sha256: string;
  readonly validationLabel: 'internal-provider-free-not-gdn';
}

const fixedZipDate = new Date(1980, 0, 1, 0, 0, 0, 0);
const fixedFileOptions = Object.freeze({
  compress: false,
  compressionLevel: 0,
  forceDosTimestamp: true,
  forceZip64Format: false,
  mode: 0o100644,
  mtime: fixedZipDate,
});

const collectZipOutput = async (zip: ZipFile): Promise<Uint8Array> => {
  const chunks: Buffer[] = [];
  let byteSize = 0;
  for await (const chunk of zip.outputStream) {
    const bytes = Buffer.from(chunk);
    if (bytes.byteLength > MAX_ZIP_ARCHIVE_BYTES - byteSize) {
      throw new RangeError('Deterministic fake ZIP exceeds 50 MiB.');
    }
    chunks.push(bytes);
    byteSize += bytes.byteLength;
  }
  return Buffer.concat(chunks, byteSize);
};

const distinctSceneAssets = (scene: BannerSceneV1): readonly AssetVersionRefV1[] => {
  const byVersion = new Map<string, AssetVersionRefV1>();
  for (const { reference } of collectSceneAssetReferences(scene)) {
    if (!byVersion.has(reference.assetVersionId))
      byVersion.set(reference.assetVersionId, reference);
  }
  return [...byVersion.values()].sort((left, right) =>
    left.assetVersionId < right.assetVersionId
      ? -1
      : left.assetVersionId > right.assetVersionId
        ? 1
        : 0,
  );
};

const validateAssets = (
  scene: BannerSceneV1,
  assets: readonly FakeExportAsset[],
): readonly FakeExportAsset[] => {
  const sorted = [...assets].sort((left, right) =>
    left.reference.assetVersionId < right.reference.assetVersionId
      ? -1
      : left.reference.assetVersionId > right.reference.assetVersionId
        ? 1
        : 0,
  );
  const expected = distinctSceneAssets(scene);
  if (
    sorted.length !== expected.length ||
    !sorted.every(
      (asset, index) =>
        assetReferencesEqual(asset.reference, expected[index]!) &&
        asset.bytes.byteLength === asset.reference.byteSize &&
        sha256Hex(asset.bytes) === asset.reference.sha256,
    )
  ) {
    throw new TypeError(
      'Fake exporter requires exact immutable bytes for every distinct scene asset.',
    );
  }
  return sorted;
};

const packagedSceneAssetIds = (scene: BannerSceneV1): ReadonlySet<string> => {
  const ids = new Set<string>();
  if (scene.canvas.background.kind === 'image') {
    ids.add(scene.canvas.background.asset.assetVersionId);
  }
  for (const layer of scene.layers) {
    if (layer.included) ids.add(layer.asset.assetVersionId);
  }
  return ids;
};

const trustedIndexHtml = (scene: BannerSceneV1): string =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=${String(
    scene.canvas.width,
  )},height=${String(scene.canvas.height)}"><link rel="stylesheet" href="styles.css"></head><body><main id="banner" aria-label="Internal provider-free banner"></main><script src="runtime.js"></script></body></html>`;

const trustedStyles = (scene: BannerSceneV1): string =>
  `html,body{margin:0;width:${String(scene.canvas.width)}px;height:${String(
    scene.canvas.height,
  )}px;overflow:hidden}#banner{position:relative;width:100%;height:100%}`;

const trustedRuntime =
  "'use strict';document.getElementById('banner').textContent='Internal deterministic preview';";

export const createDeterministicFakeZipArtifact = async (input: {
  readonly assets: readonly FakeExportAsset[];
  readonly scene: BannerSceneV1;
}): Promise<DeterministicFakeZipArtifact> => {
  if (input.scene.exportSettings.kind === 'static-png') {
    throw new TypeError('Static PNG scenes require the deterministic PNG fake path.');
  }
  const assets = validateAssets(input.scene, input.assets);
  const packagedIds = packagedSceneAssetIds(input.scene);
  const packagedAssets = assets.filter((asset) => packagedIds.has(asset.reference.assetVersionId));
  const entries: { readonly bytes: Buffer; readonly name: string }[] = [
    { name: 'index.html', bytes: Buffer.from(trustedIndexHtml(input.scene), 'utf8') },
    { name: 'styles.css', bytes: Buffer.from(trustedStyles(input.scene), 'utf8') },
    { name: 'runtime.js', bytes: Buffer.from(trustedRuntime, 'utf8') },
    { name: 'scene.json', bytes: Buffer.from(canonicalizeJson(input.scene), 'utf8') },
    {
      name: 'INTERNAL-NON-GDN.txt',
      bytes: Buffer.from('INTERNAL PROVIDER-FREE TEST EXPORT; NOT GDN VALIDATION.\n', 'utf8'),
    },
    ...packagedAssets.map((asset) => ({
      name: `assets/${asset.reference.assetVersionId}.${
        asset.reference.mediaType === 'image/png' ? 'png' : 'jpg'
      }`,
      bytes: Buffer.from(asset.bytes),
    })),
  ];
  const zip = new ZipFile();
  for (const entry of entries) zip.addBuffer(entry.bytes, entry.name, fixedFileOptions);
  zip.end({ comment: '', forceZip64Format: false });

  const bytes = await collectZipOutput(zip);
  const inspection = await inspectZipBytes(bytes, {
    contentPolicy: createExactZipContentPolicy(entries),
  });
  return {
    byteSize: bytes.byteLength,
    bytes,
    inspection,
    mediaType: 'application/zip',
    sha256: sha256Hex(bytes),
    validationLabel: 'internal-provider-free-not-gdn',
  };
};

export const createDeterministicFakePngArtifact = async (input: {
  readonly normalizedPngBytes: Uint8Array;
  readonly scene: BannerSceneV1;
}): Promise<DeterministicFakePngArtifact> => {
  if (input.scene.exportSettings.kind !== 'static-png') {
    throw new TypeError('HTML scenes require the deterministic ZIP fake path.');
  }
  if (input.normalizedPngBytes.byteLength > MAX_RASTER_ENCODED_BYTES) {
    throw new TypeError('Fake PNG exceeds the normalized raster byte limit.');
  }
  const inspected = await validateNormalizedPng(input.normalizedPngBytes);
  if (
    inspected.mediaType !== 'image/png' ||
    inspected.ancillaryByteSize !== 0 ||
    inspected.width !== input.scene.canvas.width ||
    inspected.height !== input.scene.canvas.height
  ) {
    throw new TypeError('Fake PNG must be a normalized metadata-free image matching the canvas.');
  }
  const bytes = Buffer.from(input.normalizedPngBytes);
  return {
    byteSize: bytes.byteLength,
    bytes,
    mediaType: 'image/png',
    pixelHeight: inspected.height,
    pixelWidth: inspected.width,
    sha256: sha256Hex(bytes),
    validationLabel: 'internal-provider-free-not-gdn',
  };
};
