import sharp from 'sharp';

import { ProjectIdSchema, WorkspaceIdSchema } from '../context/actor-workspace-context.js';
import {
  ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1,
  ANGEL_PROVIDER_FREE_EXPECTED_LAYERS_V1,
} from '../evaluation/benchmark-case.js';
import { createAngelBenchmarkFixtureSourceV1 } from '../evaluation/repository-benchmark-fixture.js';
import type { FakeExportAsset } from '../export/deterministic-fake-exporter.js';
import { PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1 } from '../export/provider-free-internal-validator.js';
import type { SceneReferenceResolver } from '../ports/scene-reference-resolver.js';
import { validateSceneReferences } from '../ports/scene-reference-resolver.js';
import {
  AssetVersionRefV1Schema,
  BannerSceneV1Schema,
  assetReferencesEqual,
  type AssetVersionRefV1,
  type BannerSceneV1,
} from '../scene/banner-scene-v1.schema.js';
import { sha256Hex } from '../scene/canonical-scene-json.js';
import {
  byteSourceFrom,
  normalizeRasterUpload,
  validateNormalizedPng,
  type NormalizedRasterUpload,
} from '../security/raster-upload.js';
import {
  PROVIDER_FREE_ANGEL_BODY_LAYER_ID_V1,
  PROVIDER_FREE_BACKGROUND_PART_ID_V1,
  PROVIDER_FREE_LEFT_WING_LAYER_ID_V1,
  PROVIDER_FREE_RIGHT_WING_LAYER_ID_V1,
  PROVIDER_FREE_SOLID_BACKGROUND_V1,
  type ProviderFreeSelectedPartIdV1,
} from './provider-free-banner-scene-v1.js';
import {
  createInitialProviderFreeBannerProjectV1,
  type ProviderFreeBannerProjectV1,
} from './provider-free-fixture-project-v1.js';
import {
  PROVIDER_FREE_DEVELOPMENT_WORKSPACE_ID_V1,
  PROVIDER_FREE_FIXTURE_ID_V1,
  PROVIDER_FREE_PROJECT_ID_V1,
} from './provider-free-identities-v1.js';

const CANVAS_WIDTH = 300;
const CANVAS_HEIGHT = 200;

const generatedPngOptions = Object.freeze({
  adaptiveFiltering: false,
  compressionLevel: 9,
  effort: 10,
  palette: false,
  progressive: false,
});

export interface ProviderFreePresentationBoundsV1 {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ProviderFreePresentationThumbnailV1 {
  readonly dataUrl: string;
  readonly byteSize: number;
  readonly sha256: string;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
}

export interface ProviderFreePresentationPartV1 {
  readonly partKey: string;
  readonly targetId: ProviderFreeSelectedPartIdV1;
  readonly name: string;
  readonly role: 'background' | 'subject' | 'decoration';
  readonly bounds: ProviderFreePresentationBoundsV1;
  readonly thumbnail: ProviderFreePresentationThumbnailV1;
}

export interface ProviderFreeFixtureMaterializationV1 {
  readonly fixtureId: typeof PROVIDER_FREE_FIXTURE_ID_V1;
  readonly project: ProviderFreeBannerProjectV1;
  readonly scene: BannerSceneV1;
  readonly assets: readonly FakeExportAsset[];
  readonly presentationParts: readonly ProviderFreePresentationPartV1[];
}

const normalizeGeneratedPng = async (
  bytes: Uint8Array,
  filename: string,
): Promise<NormalizedRasterUpload> => {
  const normalized = await normalizeRasterUpload({
    bytes: byteSourceFrom(bytes),
    declaredMediaType: 'image/png',
    filename,
  });
  await validateNormalizedPng(normalized.bytes);
  return normalized;
};

const boundsToPixels = (bounds: {
  readonly xBps: number;
  readonly yBps: number;
  readonly widthBps: number;
  readonly heightBps: number;
}): ProviderFreePresentationBoundsV1 => ({
  x: Math.round((bounds.xBps * CANVAS_WIDTH) / 10_000),
  y: Math.round((bounds.yBps * CANVAS_HEIGHT) / 10_000),
  width: Math.round((bounds.widthBps * CANVAS_WIDTH) / 10_000),
  height: Math.round((bounds.heightBps * CANVAS_HEIGHT) / 10_000),
});

const thumbnailFrom = (
  normalized: NormalizedRasterUpload,
): ProviderFreePresentationThumbnailV1 => ({
  dataUrl: `data:image/png;base64,${Buffer.from(normalized.bytes).toString('base64')}`,
  byteSize: normalized.byteSize,
  sha256: normalized.sha256,
  pixelWidth: normalized.width,
  pixelHeight: normalized.height,
});

const assetReference = (input: {
  readonly assetId: string;
  readonly assetVersionId: string;
  readonly normalized: NormalizedRasterUpload;
}): AssetVersionRefV1 =>
  AssetVersionRefV1Schema.parse({
    assetId: input.assetId,
    assetVersionId: input.assetVersionId,
    sha256: input.normalized.sha256,
    mediaType: 'image/png',
    byteSize: input.normalized.byteSize,
    pixelWidth: input.normalized.width,
    pixelHeight: input.normalized.height,
  });

const layerIdentity = Object.freeze({
  'angel.body': {
    layerId: PROVIDER_FREE_ANGEL_BODY_LAYER_ID_V1,
    assetId: 'asset_angel_body_visual_v1',
    assetVersionId: 'asset_version_angel_body_visual_v1',
    filename: 'angel-body-visual.png',
    tint: { r: 206, g: 91, b: 72 },
  },
  'wing.left': {
    layerId: PROVIDER_FREE_LEFT_WING_LAYER_ID_V1,
    assetId: 'asset_left_wing_visual_v1',
    assetVersionId: 'asset_version_left_wing_visual_v1',
    filename: 'left-wing-visual.png',
    tint: { r: 94, g: 112, b: 202 },
  },
  'wing.right': {
    layerId: PROVIDER_FREE_RIGHT_WING_LAYER_ID_V1,
    assetId: 'asset_right_wing_visual_v1',
    assetVersionId: 'asset_version_right_wing_visual_v1',
    filename: 'right-wing-visual.png',
    tint: { r: 47, g: 156, b: 129 },
  },
});

type ForegroundPartKey = keyof typeof layerIdentity;

export type ProviderFreeAngelForegroundPngsV1 = Readonly<{
  'angel.body': Uint8Array;
  'wing.left': Uint8Array;
  'wing.right': Uint8Array;
}>;

const materializeThumbnail = async (
  bytes: Uint8Array,
  filename: string,
): Promise<NormalizedRasterUpload> => {
  const encoded = await sharp(bytes)
    .resize({
      width: 120,
      height: 80,
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png(generatedPngOptions)
    .toBuffer();
  return normalizeGeneratedPng(encoded, filename);
};

export const createProviderFreeSceneReferenceResolver = (
  materialization: ProviderFreeFixtureMaterializationV1,
): SceneReferenceResolver => {
  const assets = new Map(
    materialization.assets.map((asset) => [asset.reference.assetVersionId, asset.reference]),
  );
  return {
    async resolveAssetVersion(scope, reference) {
      if (
        scope.workspaceId !== PROVIDER_FREE_DEVELOPMENT_WORKSPACE_ID_V1 ||
        scope.projectId !== PROVIDER_FREE_PROJECT_ID_V1
      ) {
        return { status: 'not-found' };
      }
      const value = assets.get(reference.assetVersionId);
      return value === undefined ? { status: 'not-found' } : { status: 'found', value };
    },
    async resolveValidatorProfile(scope, reference) {
      if (
        scope.workspaceId !== PROVIDER_FREE_DEVELOPMENT_WORKSPACE_ID_V1 ||
        scope.projectId !== PROVIDER_FREE_PROJECT_ID_V1 ||
        reference.validatorProfileId !==
          PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1.validatorProfileId
      ) {
        return { status: 'not-found' };
      }
      return { status: 'found', value: PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1 };
    },
  };
};

const materializeProviderFreeFixtureProjectCoreV1 = async (
  foregroundPngs?: ProviderFreeAngelForegroundPngsV1,
): Promise<ProviderFreeFixtureMaterializationV1> => {
  const source = createAngelBenchmarkFixtureSourceV1('png');
  const normalizedSource = await normalizeRasterUpload({
    bytes: byteSourceFrom(source.bytes),
    declaredMediaType: source.declaredMediaType,
    filename: source.filename,
  });
  const expectedSource = ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1.input.sourceAsset;
  if (
    normalizedSource.sha256 !== expectedSource.sha256 ||
    normalizedSource.byteSize !== expectedSource.byteSize ||
    normalizedSource.width !== expectedSource.pixelWidth ||
    normalizedSource.height !== expectedSource.pixelHeight
  ) {
    throw new TypeError('The approved provider-free fixture source identity drifted.');
  }

  const canvasEncoded = await sharp(normalizedSource.bytes)
    .resize(CANVAS_WIDTH, CANVAS_HEIGHT, { fit: 'fill', kernel: sharp.kernel.nearest })
    .png(generatedPngOptions)
    .toBuffer();
  const canvasVisualization = await normalizeGeneratedPng(canvasEncoded, 'angel-canvas-visual.png');
  const backgroundThumbnail = await materializeThumbnail(
    canvasVisualization.bytes,
    'background-thumbnail.png',
  );

  const backgroundEvidence = ANGEL_PROVIDER_FREE_EXPECTED_LAYERS_V1[0]!.proposal;
  if (backgroundEvidence.partKey !== 'background' || backgroundEvidence.role !== 'background') {
    throw new TypeError('The approved fixture background evidence drifted.');
  }

  const layerAssets: FakeExportAsset[] = [];
  const sceneLayers: BannerSceneV1['layers'][number][] = [];
  const presentationParts: ProviderFreePresentationPartV1[] = [
    {
      partKey: backgroundEvidence.partKey,
      targetId: PROVIDER_FREE_BACKGROUND_PART_ID_V1,
      name: backgroundEvidence.label,
      role: backgroundEvidence.role,
      bounds: boundsToPixels(backgroundEvidence.bounds),
      thumbnail: thumbnailFrom(backgroundThumbnail),
    },
  ];

  for (const [index, evidence] of ANGEL_PROVIDER_FREE_EXPECTED_LAYERS_V1.slice(1).entries()) {
    const proposal = evidence.proposal;
    if (!(proposal.partKey in layerIdentity)) {
      throw new TypeError('The approved fixture foreground evidence drifted.');
    }
    const identity = layerIdentity[proposal.partKey as ForegroundPartKey];
    const bounds = boundsToPixels(proposal.bounds);
    const encoded =
      foregroundPngs === undefined
        ? await sharp(canvasVisualization.bytes)
            .extract({ left: bounds.x, top: bounds.y, width: bounds.width, height: bounds.height })
            .tint(identity.tint)
            .png(generatedPngOptions)
            .toBuffer()
        : foregroundPngs[proposal.partKey as ForegroundPartKey];
    const normalized = await normalizeGeneratedPng(encoded, identity.filename);
    const reference = assetReference({
      assetId: identity.assetId,
      assetVersionId: identity.assetVersionId,
      normalized,
    });
    layerAssets.push({ reference, bytes: Uint8Array.from(normalized.bytes) });
    sceneLayers.push({
      id: identity.layerId as BannerSceneV1['layers'][number]['id'],
      name: proposal.label,
      order: index,
      included: true,
      visible: true,
      opacity: 1,
      asset: reference,
      frame: bounds,
      transform: {
        anchorX: 0.5,
        anchorY: 0.5,
        translateX: 0,
        translateY: 0,
        scaleX: 1,
        scaleY: 1,
        rotationDegrees: 0,
      },
    });
    const thumbnail = await materializeThumbnail(normalized.bytes, `${proposal.partKey}.png`);
    presentationParts.push({
      partKey: proposal.partKey,
      targetId: identity.layerId,
      name: proposal.label,
      role: proposal.role as 'subject' | 'decoration',
      bounds,
      thumbnail: thumbnailFrom(thumbnail),
    });
  }

  const sourceReference = AssetVersionRefV1Schema.parse(expectedSource);
  const scene = BannerSceneV1Schema.parse({
    schemaVersion: 1,
    canvas: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      background: PROVIDER_FREE_SOLID_BACKGROUND_V1,
    },
    sourceAsset: sourceReference,
    layers: sceneLayers,
    timeline: [],
    exportSettings: {
      kind: 'gdn-html5',
      profileVersion: 1,
      interaction: {
        kind: 'single-exit',
        destinationUrl: 'https://example.com/campaign',
      },
      validatorProfile: PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1,
    },
  });
  const project = createInitialProviderFreeBannerProjectV1(scene);
  const materialization: ProviderFreeFixtureMaterializationV1 = Object.freeze({
    fixtureId: PROVIDER_FREE_FIXTURE_ID_V1,
    project,
    scene,
    assets: Object.freeze([
      {
        reference: sourceReference,
        bytes: Uint8Array.from(normalizedSource.bytes),
      },
      ...layerAssets,
    ]),
    presentationParts: Object.freeze(presentationParts),
  });
  const referenceValidation = await validateSceneReferences(
    scene,
    {
      workspaceId: WorkspaceIdSchema.parse(PROVIDER_FREE_DEVELOPMENT_WORKSPACE_ID_V1),
      projectId: ProjectIdSchema.parse(PROVIDER_FREE_PROJECT_ID_V1),
    },
    createProviderFreeSceneReferenceResolver(materialization),
  );
  if (!referenceValidation.success) {
    throw new TypeError('The materialized provider-free fixture references are invalid.');
  }
  for (const asset of materialization.assets) {
    if (
      asset.bytes.byteLength !== asset.reference.byteSize ||
      sha256Hex(asset.bytes) !== asset.reference.sha256 ||
      !assetReferencesEqual(asset.reference, AssetVersionRefV1Schema.parse(asset.reference))
    ) {
      throw new TypeError('A materialized provider-free fixture asset identity drifted.');
    }
  }
  return materialization;
};

export const materializeProviderFreeFixtureProjectV1 =
  (): Promise<ProviderFreeFixtureMaterializationV1> =>
    materializeProviderFreeFixtureProjectCoreV1();

export const materializeProviderFreeAngelForegroundProjectV1 = async (
  input: Record<string, unknown>,
): Promise<ProviderFreeFixtureMaterializationV1> => {
  const keys = Object.keys(input).toSorted();
  if (keys.join('|') !== ['angel.body', 'wing.left', 'wing.right'].join('|')) {
    throw new TypeError('Angel foreground PNG keys are fixed and exact.');
  }
  for (const key of keys) {
    const bytes = input[key];
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      throw new TypeError('Angel foreground PNG bytes are invalid.');
    }
  }
  const normalized: Record<string, Uint8Array> = {};
  for (const key of keys as ForegroundPartKey[]) {
    normalized[key] = (await normalizeGeneratedPng(input[key] as Uint8Array, `${key}.png`)).bytes;
  }
  return materializeProviderFreeFixtureProjectCoreV1(
    normalized as ProviderFreeAngelForegroundPngsV1,
  );
};
