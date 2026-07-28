import { sha256Hex } from '../scene/canonical-scene-json.js';
import {
  assetReferencesEqual,
  collectSceneAssetReferences,
  type AssetVersionRefV1,
  type BannerSceneV1,
} from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import {
  BannerExportRequestSchema,
  validateBannerExportResult,
  type BannerExporterPort,
} from '../ports/banner-capability-ports.js';
import {
  ExportReproductionManifestV1Schema,
  ExporterManifestRefV1Schema,
} from '../scene/export-reproduction-manifest-v1.schema.js';
import { PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_V1 } from '../workflows/workflow-definition.js';
import { MAX_RASTER_ENCODED_BYTES } from '../security/raster-container.js';
import { validateNormalizedPng } from '../security/raster-upload.js';
import {
  createBannerSceneV1ExportDocumentParts,
  createBannerSceneV1RenderPlan,
} from '../render/banner-scene-v1-renderer.js';
import {
  createExactZipContentPolicy,
  inspectZipBytes,
  MAX_ZIP_ARCHIVE_BYTES,
  type ZipInspectionResult,
} from './zip-inspector.js';
import { ZipFile } from 'yazl';
import { PROVIDER_FREE_EXPORTER_REF_V1 } from './provider-free-export-identities-v1.js';

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

const providerFreeExporterBuildDefinitionV1 = Object.freeze({
  buildDefinitionVersion: 1 as const,
  exporterKind: 'deterministic-provider-free-html5' as const,
  exporterVersion: 1 as const,
  renderer: 'banner-scene-v1-render-plan-runtime-v1' as const,
  zip: Object.freeze({
    compression: 'stored' as const,
    timestamp: '1980-01-01T00:00:00' as const,
    mode: '100644' as const,
    entryOrder: Object.freeze([
      'index.html',
      'styles.css',
      'runtime.js',
      'scene.json',
      'INTERNAL-NON-GDN.txt',
      'assets-by-version-id',
    ] as const),
  }),
});

const computedProviderFreeExporterBuildSha256 = sha256Hex(
  Buffer.from(canonicalizeJson(providerFreeExporterBuildDefinitionV1), 'utf8'),
);
if (computedProviderFreeExporterBuildSha256 !== PROVIDER_FREE_EXPORTER_REF_V1.buildSha256) {
  throw new TypeError('The provider-free exporter build identity drifted.');
}
export const PROVIDER_FREE_EXPORTER_V1 = ExporterManifestRefV1Schema.parse(
  PROVIDER_FREE_EXPORTER_REF_V1,
);

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

export interface DeterministicFakeZipEntryV1 {
  readonly bytes: Uint8Array;
  readonly name: string;
}

export const createDeterministicFakeZipEntriesV1 = (input: {
  readonly assets: readonly FakeExportAsset[];
  readonly scene: BannerSceneV1;
}): readonly DeterministicFakeZipEntryV1[] => {
  if (input.scene.exportSettings.kind === 'static-png') {
    throw new TypeError('Static PNG scenes require the deterministic PNG fake path.');
  }
  const assets = validateAssets(input.scene, input.assets);
  const packagedIds = packagedSceneAssetIds(input.scene);
  const packagedAssets = assets.filter((asset) => packagedIds.has(asset.reference.assetVersionId));
  const plan = createBannerSceneV1RenderPlan(input.scene);
  const document = createBannerSceneV1ExportDocumentParts({ plan, assets });
  return [
    { name: 'index.html', bytes: Buffer.from(document.indexHtml, 'utf8') },
    { name: 'styles.css', bytes: Buffer.from(document.stylesCss, 'utf8') },
    { name: 'runtime.js', bytes: Buffer.from(document.runtimeJavaScript, 'utf8') },
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
};

export const createDeterministicFakeZipArtifact = async (input: {
  readonly assets: readonly FakeExportAsset[];
  readonly scene: BannerSceneV1;
}): Promise<DeterministicFakeZipArtifact> => {
  const entries = createDeterministicFakeZipEntriesV1(input);
  const zip = new ZipFile();
  for (const entry of entries)
    zip.addBuffer(Buffer.from(entry.bytes), entry.name, fixedFileOptions);
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

const providerFreeExportWorkflowRefV1 = {
  workflowVersionId: PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_V1.workflowVersionId,
  workflowVersion: PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_V1.workflowVersion,
  definitionSha256: PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_V1.definitionSha256,
};

export const createProviderFreeBannerExporterV1 = (): BannerExporterPort => ({
  async export(input) {
    const request = BannerExportRequestSchema.parse(input);
    if (
      canonicalizeJson(request.exporter) !== canonicalizeJson(PROVIDER_FREE_EXPORTER_V1) ||
      canonicalizeJson(request.exportWorkflow) !== canonicalizeJson(providerFreeExportWorkflowRefV1)
    ) {
      throw new TypeError('Provider-free export identity does not match the fixed implementation.');
    }
    request.cancellation.throwIfCancelled();
    const generated = await createDeterministicFakeZipArtifact({
      scene: request.scene,
      assets: request.assets,
    });
    request.cancellation.throwIfCancelled();
    const artifact = {
      mediaType: generated.mediaType,
      bytes: generated.bytes,
      byteSize: generated.byteSize,
      sha256: generated.sha256,
      validationLabel: generated.validationLabel,
    } as const;
    const assetVersions = distinctSceneAssets(request.scene);
    const manifest = ExportReproductionManifestV1Schema.parse({
      manifestVersion: 1,
      sceneVersionId: request.sceneVersionId,
      sceneRevision: request.sceneRevision,
      sceneEncoding: 'banner-scene-json-v1',
      sceneSha256: sha256Hex(Buffer.from(canonicalizeJson(request.scene), 'utf8')),
      assetVersions,
      sceneWorkflow: request.sceneWorkflow,
      exportWorkflow: request.exportWorkflow,
      exporter: request.exporter,
      validator:
        request.scene.exportSettings.kind === 'gdn-html5'
          ? { kind: 'profile', profile: request.scene.exportSettings.validatorProfile }
          : { kind: 'none' },
      output: {
        mediaType: artifact.mediaType,
        byteSize: artifact.byteSize,
        sha256: artifact.sha256,
      },
    });
    return validateBannerExportResult({ request, result: { artifact, manifest } });
  },
});
