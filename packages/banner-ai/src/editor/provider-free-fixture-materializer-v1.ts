import sharp from 'sharp';

import { ProjectIdSchema, WorkspaceIdSchema } from '../context/actor-workspace-context.js';
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
  PROVIDER_FREE_PERSON_SUBJECT_LAYER_ID_V1,
  PROVIDER_FREE_BACKGROUND_PART_ID_V1,
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
export interface ProviderFreeSourceReferenceV1 {
  readonly name: string;
  readonly asset: AssetVersionRefV1;
  readonly thumbnail: ProviderFreePresentationThumbnailV1;
}

export interface ProviderFreeFixtureMaterializationV1 {
  readonly fixtureId: typeof PROVIDER_FREE_FIXTURE_ID_V1;
  readonly candidateId: string;
  readonly project: ProviderFreeBannerProjectV1;
  readonly scene: BannerSceneV1;
  readonly assets: readonly FakeExportAsset[];
  readonly presentationParts: readonly ProviderFreePresentationPartV1[];
  readonly sourceReference: ProviderFreeSourceReferenceV1;
}

const EXPECTED_SOURCE = Object.freeze({
  sha256: '6e3175cdd260fde33a3885945eb6f8831da3905afbc723f684035f411dc6d699',
  byteSize: 241013,
  width: 876,
  height: 221,
});
const EXPECTED_SUBJECT = Object.freeze({
  sha256: '464f1bb286ac4a599e3b49a25b1f427d2b73acaac6c2cd1829902d0d5a870c33',
  byteSize: 53742,
  width: 157,
  height: 215,
});

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

const candidateFrameToPixels = (input: {
  readonly bounds: {
    readonly xBps: number;
    readonly yBps: number;
  };
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly cutoutWidth: number;
  readonly cutoutHeight: number;
}): ProviderFreePresentationBoundsV1 => {
  const scale = Math.min(CANVAS_WIDTH / input.sourceWidth, CANVAS_HEIGHT / input.sourceHeight);
  const offsetX = (CANVAS_WIDTH - input.sourceWidth * scale) / 2;
  const offsetY = (CANVAS_HEIGHT - input.sourceHeight * scale) / 2;
  return {
    x: Math.round(offsetX + (input.bounds.xBps * input.sourceWidth * scale) / 10_000),
    y: Math.round(offsetY + (input.bounds.yBps * input.sourceHeight * scale) / 10_000),
    width: Math.round(input.cutoutWidth * scale),
    height: Math.round(input.cutoutHeight * scale),
  };
};

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
  subject: {
    layerId: PROVIDER_FREE_PERSON_SUBJECT_LAYER_ID_V1,
    assetId: 'asset_banner_person_v1',
    assetVersionId: 'asset_version_banner_person_v1',
    filename: 'banner-person-v1.cutout.png',
  },
});

type ForegroundPartKey = keyof typeof layerIdentity;

export type ProviderFreePersonSubjectPngV1 = Readonly<{ subject: Uint8Array }>;
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

const materializeSolidBackgroundThumbnail = async (): Promise<NormalizedRasterUpload> => {
  const encoded = await sharp({
    create: {
      width: 120,
      height: 80,
      channels: 4,
      background: { r: 243, g: 231, b: 211, alpha: 1 },
    },
  })
    .png(generatedPngOptions)
    .toBuffer();
  return normalizeGeneratedPng(encoded, 'background-thumbnail.png');
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

const materializeProviderFreeFixtureProjectCoreV1 = async (input: {
  readonly source: Uint8Array;
  readonly subject: Uint8Array;
  readonly subjectIdentity?: Readonly<{
    assetId: string;
    assetVersionId: string;
    layerId: string;
    filename: string;
    bounds: { xBps: number; yBps: number; widthBps: number; heightBps: number };
    name: string;
  }>;
  readonly candidateId?: string;
  readonly sourceFilename?: string;
  readonly sourceIdentity?: { readonly assetId: string; readonly assetVersionId: string };
  readonly subjects?: readonly {
    readonly subject: Uint8Array;
    readonly candidateId: string;
    readonly bounds: { xBps: number; yBps: number; widthBps: number; heightBps: number };
  }[];
}): Promise<ProviderFreeFixtureMaterializationV1> => {
  const normalizedSource = await normalizeRasterUpload({
    bytes: byteSourceFrom(input.source),
    declaredMediaType: 'image/png',
    filename: input.sourceFilename ?? 'banner-person-v1.png',
  });
  const expectedSource = {
    assetId: 'asset_banner_person_source_v1',
    assetVersionId: 'asset_version_banner_person_source_v1',
    sha256: EXPECTED_SOURCE.sha256,
    mediaType: 'image/png' as const,
    byteSize: EXPECTED_SOURCE.byteSize,
    pixelWidth: EXPECTED_SOURCE.width,
    pixelHeight: EXPECTED_SOURCE.height,
  };
  if (
    !input.sourceIdentity &&
    (normalizedSource.sha256 !== EXPECTED_SOURCE.sha256 ||
      normalizedSource.byteSize !== EXPECTED_SOURCE.byteSize ||
      normalizedSource.width !== EXPECTED_SOURCE.width ||
      normalizedSource.height !== EXPECTED_SOURCE.height)
  ) {
    throw new TypeError('The approved provider-free fixture source identity drifted.');
  }

  const backgroundThumbnail = await materializeSolidBackgroundThumbnail();
  const sourceThumbnail = await materializeThumbnail(
    normalizedSource.bytes,
    'source-reference.png',
  );

  const backgroundEvidence = {
    partKey: 'background',
    role: 'background' as const,
    label: 'Solid background',
    bounds: { xBps: 0, yBps: 0, widthBps: 10000, heightBps: 10000 },
  };

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

  const proposals = input.subjects?.length
    ? input.subjects.map((entry) => ({
        partKey: `subject_${entry.candidateId.slice(-24)}`,
        label: 'Uploaded cutout',
        role: 'subject' as const,
        bounds: entry.bounds,
        encoded: entry.subject,
        candidateId: entry.candidateId,
      }))
    : [
        {
          partKey: 'subject',
          label: input.sourceIdentity ? 'Uploaded cutout' : 'banner-person-v1 subject',
          role: 'subject' as const,
          bounds: { xBps: 6506, yBps: 271, widthBps: 1794, heightBps: 9729 },
          encoded: input.subject,
          candidateId: input.candidateId ?? 'legacy',
        },
      ];
  for (const [index, proposal] of proposals.entries()) {
    if (!input.subjects?.length && !(proposal.partKey in layerIdentity))
      throw new TypeError('The approved fixture foreground evidence drifted.');
    const digest = sha256Hex(Buffer.from(proposal.candidateId, 'utf8')).slice(0, 24);
    const identity = input.subjects?.length
      ? {
          assetId: `asset_uploaded_cutout_${digest}`,
          assetVersionId: `asset_version_uploaded_cutout_${digest}`,
          layerId: `layer_uploaded_cutout_${digest}`,
          filename: `uploaded-${digest}.cutout.png`,
          bounds: proposal.bounds,
          name: proposal.candidateId.startsWith('saml_v1_')
            ? `Uploaded layer ${index + 1}`
            : `Uploaded cutout ${index + 1}`,
        }
      : (input.subjectIdentity ?? layerIdentity[proposal.partKey as ForegroundPartKey]);
    const encoded = proposal.encoded;
    const normalizedUpload = await normalizeGeneratedPng(encoded, identity.filename);
    const normalized = input.subjects?.length
      ? {
          ...normalizedUpload,
          bytes: encoded,
          byteSize: encoded.byteLength,
          sha256: sha256Hex(encoded),
        }
      : normalizedUpload;
    const bounds = candidateFrameToPixels({
      bounds: 'bounds' in identity ? identity.bounds : proposal.bounds,
      sourceWidth: normalizedSource.width,
      sourceHeight: normalizedSource.height,
      cutoutWidth: normalized.width,
      cutoutHeight: normalized.height,
    });
    const reference = assetReference({
      assetId: identity.assetId,
      assetVersionId: identity.assetVersionId,
      normalized,
    });
    layerAssets.push({ reference, bytes: Uint8Array.from(normalized.bytes) });
    sceneLayers.push({
      id: identity.layerId as unknown as BannerSceneV1['layers'][number]['id'],
      name:
        input.subjectIdentity?.name ??
        ('name' in identity ? identity.name : undefined) ??
        proposal.label,
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
      targetId: identity.layerId as unknown as ProviderFreeSelectedPartIdV1,
      name:
        input.subjectIdentity?.name ??
        ('name' in identity ? identity.name : undefined) ??
        proposal.label,
      role: 'subject',
      bounds,
      thumbnail: thumbnailFrom(thumbnail),
    });
  }

  const sourceReference = AssetVersionRefV1Schema.parse(
    input.sourceIdentity
      ? {
          assetId: input.sourceIdentity.assetId,
          assetVersionId: input.sourceIdentity.assetVersionId,
          sha256: normalizedSource.sha256,
          mediaType: 'image/png',
          byteSize: normalizedSource.byteSize,
          pixelWidth: normalizedSource.width,
          pixelHeight: normalizedSource.height,
        }
      : expectedSource,
  );
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
    candidateId:
      input.candidateId ??
      'samc_v1_478780b81c47a3b064a5398bbf275ddd137a4e21d746b5aeb0623a7a546f99cf',
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
    sourceReference: Object.freeze({
      name: 'Source banner',
      asset: sourceReference,
      thumbnail: thumbnailFrom(sourceThumbnail),
    }),
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

export const materializeProviderFreePersonSubjectProjectV1 = async (
  input: Record<string, unknown>,
): Promise<ProviderFreeFixtureMaterializationV1> => {
  const keys = Object.keys(input).toSorted();
  if (keys.join('|') !== 'source|subject') {
    throw new TypeError('Person replay source and subject PNG keys are fixed and exact.');
  }
  for (const key of keys) {
    const bytes = input[key];
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      throw new TypeError('Person replay PNG bytes are invalid.');
    }
  }
  const source = (await normalizeGeneratedPng(input.source as Uint8Array, 'source.png')).bytes;
  const subject = (await normalizeGeneratedPng(input.subject as Uint8Array, 'subject.png')).bytes;
  if (
    sha256Hex(source) !== EXPECTED_SOURCE.sha256 ||
    source.byteLength !== EXPECTED_SOURCE.byteSize
  )
    throw new TypeError('Person replay source identity drifted.');
  if (
    sha256Hex(subject) !== EXPECTED_SUBJECT.sha256 ||
    subject.byteLength !== EXPECTED_SUBJECT.byteSize
  )
    throw new TypeError('Person replay subject identity drifted.');
  return materializeProviderFreeFixtureProjectCoreV1({ source, subject });
};

export const materializeProviderFreePersonSamCandidateProjectV1 = async (input: {
  readonly source: Uint8Array;
  readonly subject: Uint8Array;
  readonly candidate: {
    readonly candidateId: string;
    readonly bounds: { xBps: number; yBps: number; widthBps: number; heightBps: number };
  };
}): Promise<ProviderFreeFixtureMaterializationV1> => {
  const normalizedSource = await normalizeGeneratedPng(input.source, 'source.png');
  const normalizedSubject = await normalizeGeneratedPng(input.subject, 'candidate.png');
  const shortId = input.candidate.candidateId.slice(-8);
  return materializeProviderFreeFixtureProjectCoreV1({
    source: normalizedSource.bytes,
    subject: normalizedSubject.bytes,
    subjectIdentity: {
      assetId: `asset_banner_person_${shortId}`,
      assetVersionId: `asset_version_banner_person_${shortId}`,
      layerId: PROVIDER_FREE_PERSON_SUBJECT_LAYER_ID_V1,
      filename: `banner-person-v1-${shortId}.cutout.png`,
      bounds: input.candidate.bounds,
      name: 'banner-person-v1 subject',
    },
    candidateId: input.candidate.candidateId,
  });
};

/** Server-only uploaded operation materializer. The operation wrapper owns authorization and
 * lifecycle; this function only creates the existing canvas/scene shape from exact bytes. */
export const materializeUploadedBannerOperationProjectV1 = async (input: {
  readonly source: Uint8Array;
  readonly subject: Uint8Array;
  readonly candidateId: string;
  readonly bounds: {
    readonly xBps: number;
    readonly yBps: number;
    readonly widthBps: number;
    readonly heightBps: number;
  };
  readonly subjects?: readonly {
    readonly subject: Uint8Array;
    readonly candidateId: string;
    readonly bounds: { xBps: number; yBps: number; widthBps: number; heightBps: number };
  }[];
}): Promise<ProviderFreeFixtureMaterializationV1> => {
  if (input.subjects !== undefined) {
    if (input.subjects.length < 1 || input.subjects.length > 8)
      throw new TypeError('Uploaded selections must contain one to eight subjects.');
    const ids = input.subjects.map((subject) => subject.candidateId);
    if (
      new Set(ids).size !== ids.length ||
      ids.some((id) => !/^(?:samc|saml)_v1_[0-9a-f]{64}$/u.test(id))
    )
      throw new TypeError('Uploaded selection subjects are invalid or duplicated.');
  }
  if (input.subjects !== undefined && input.subjects.length > 0) {
    const first = input.subjects[0]!;
    return materializeProviderFreeFixtureProjectCoreV1({
      source: input.source,
      subject: first.subject,
      sourceFilename: 'uploaded-source.png',
      sourceIdentity: {
        assetId: `asset_uploaded_source_${sha256Hex(input.source).slice(0, 24)}`,
        assetVersionId: `asset_version_uploaded_source_${sha256Hex(input.source).slice(0, 24)}`,
      },
      subjects: input.subjects,
      candidateId: input.candidateId,
    });
  }
  const source = (await normalizeGeneratedPng(input.source, 'uploaded-source.png')).bytes;
  const subject = (await normalizeGeneratedPng(input.subject, 'uploaded-cutout.png')).bytes;
  const digest = sha256Hex(source).slice(0, 24);
  const shortId = input.candidateId.slice(-8);
  return materializeProviderFreeFixtureProjectCoreV1({
    source,
    subject,
    sourceFilename: 'uploaded-source.png',
    sourceIdentity: {
      assetId: `asset_uploaded_source_${digest}`,
      assetVersionId: `asset_version_uploaded_source_${digest}`,
    },
    subjectIdentity: {
      assetId: `asset_uploaded_cutout_${shortId}`,
      assetVersionId: `asset_version_uploaded_cutout_${shortId}`,
      layerId: PROVIDER_FREE_PERSON_SUBJECT_LAYER_ID_V1,
      filename: `uploaded-${shortId}.cutout.png`,
      bounds: input.bounds,
      name: 'Uploaded cutout',
    },
    candidateId: input.candidateId,
  });
};
