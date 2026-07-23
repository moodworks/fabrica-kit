import {
  SAM_LIMITS,
  SAM_MASK_CONTRACT_VERSION,
  SAM_MASK_ENCODING,
  SamMaskRequestSchema,
  type SamExecutionIdentity,
} from '../sam/sam-mask-contracts.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V2,
  readPendingCorpusPackageFileV2,
  type PendingCorpusFileReferenceV2,
} from './real-model-benchmark-pending-corpus-source-registry-v2.js';
import {
  SAM_FIRST_INFERENCE_CLIENT_TIMEOUT_MS,
  SAM_FIRST_INFERENCE_COST_MAXIMUM_MICRO_USD,
  SAM_FIRST_INFERENCE_ENDPOINT_ID,
  SAM_FIRST_INFERENCE_ENDPOINT_VERSION,
  SAM_FIRST_INFERENCE_EXECUTION_IDENTITY,
  SAM_FIRST_INFERENCE_FIXTURE,
  SAM_FIRST_INFERENCE_LOCAL_IDENTITY_EVIDENCE,
  SAM_FIRST_INFERENCE_REQUEST_IDENTIFIERS,
  SAM_FIRST_INFERENCE_REQUEST_LIMITS,
  SAM_FIRST_INFERENCE_WORKER_IMAGE,
  SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
  inspectSamRunPodDirectV3PreparedRequest,
  prepareSamRunPodDirectV3Request,
  type SamRunPodDirectV3PreparedRequest,
} from './sam-runpod-direct-v3-request-preparation.js';
import {
  SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3_SHA256,
  SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V3_SHA256,
  SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
} from './sam-runpod-direct-v3-profiles.js';

export const SAM_CORPUS_EVALUATION_CATALOG_VERSION = 1 as const;
export const SAM_CORPUS_ENDPOINT_ID = SAM_FIRST_INFERENCE_ENDPOINT_ID;
export const SAM_CORPUS_ENDPOINT_VERSION = SAM_FIRST_INFERENCE_ENDPOINT_VERSION;
export const SAM_CORPUS_WORKER_IMAGE = SAM_FIRST_INFERENCE_WORKER_IMAGE;
export const SAM_CORPUS_WORKER_IMAGE_DIGEST = SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST;
export const SAM_CORPUS_EXECUTION_IDENTITY = SAM_FIRST_INFERENCE_EXECUTION_IDENTITY;
export const SAM_CORPUS_REQUEST_LIMITS = SAM_FIRST_INFERENCE_REQUEST_LIMITS;
export const SAM_CORPUS_CLIENT_TIMEOUT_MS = SAM_FIRST_INFERENCE_CLIENT_TIMEOUT_MS;
export const SAM_CORPUS_COST_MAXIMUM_MICRO_USD = SAM_FIRST_INFERENCE_COST_MAXIMUM_MICRO_USD;
export const SAM_CORPUS_HUMAN_ORACLE_SHA256 =
  'aa499d5560a97a2bf7df84fd0240f39941a82f485f804a42a608d96cb9acba51' as const;
export const SAM_CORPUS_LOCAL_IDENTITY_EVIDENCE = SAM_FIRST_INFERENCE_LOCAL_IDENTITY_EVIDENCE;
export const SAM_CORPUS_LOCAL_IDENTITY_EVIDENCE_SHA256 =
  'f0a30e25b81f3c1f1f53d5ae59f6f216433681738ba03730ee80f08818cc80ae' as const;
export const SAM_CORPUS_PROFILE_IDENTITIES = Object.freeze({
  hostingSha256: SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
  adapterV3Sha256: SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3_SHA256,
  authorizationV3Sha256: SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V3_SHA256,
});

export const SAM_AUTOMATIC_CAPACITY_CEILING_BYTES = SAM_LIMITS.rawMaskWorkingBytes;
export const SAM_AUTOMATIC_BATCH_FIXED_RESERVE_BYTES = 40_388_608 as const;
export const SAM_AUTOMATIC_ENCODER_BYTES_PER_MASK_PIXEL_TOTAL = 112 as const;
export const SAM_AUTOMATIC_LOW_RESOLUTION_SIDE = 256 as const;
export const SAM_AUTOMATIC_MULTIMASK_OUTPUTS = 3 as const;
export const SAM_AUTOMATIC_MAXIMUM_POINTS_PER_BATCH = 64 as const;

export type SamCorpusFixtureKeyV1 = 'product' | 'text-heavy' | 'no-text';
export type SamCorpusFixtureIdV1 =
  'banner-product-v1' | 'banner-text-heavy-v1' | 'banner-no-text-v1';

interface SamCorpusPinnedSourceV1 {
  readonly mediaType: 'image/jpeg' | 'image/png';
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}

export interface SamCorpusFixtureCatalogEntryV1 {
  readonly catalogVersion: typeof SAM_CORPUS_EVALUATION_CATALOG_VERSION;
  readonly fixtureKey: SamCorpusFixtureKeyV1;
  readonly fixtureId: SamCorpusFixtureIdV1;
  readonly normalizedReference: PendingCorpusFileReferenceV2;
  readonly original: SamCorpusPinnedSourceV1;
  readonly normalized: SamCorpusPinnedSourceV1 & { readonly mediaType: 'image/png' };
  readonly humanOracle: {
    readonly corpusSha256: typeof SAM_CORPUS_HUMAN_ORACLE_SHA256;
    readonly oracleSha256: string;
    readonly approvedEntrySha256: string;
    readonly requiredLayerIds: readonly string[];
  };
  readonly identifiers: {
    readonly requestId: string;
    readonly workspaceId: string;
    readonly jobId: string;
    readonly attemptId: string;
  };
  readonly canonicalRequest: {
    readonly byteLength: number;
    readonly sha256: string;
  };
  readonly capacity: {
    readonly automaticOnePointPeakBytes: number;
    readonly ceilingBytes: typeof SAM_AUTOMATIC_CAPACITY_CEILING_BYTES;
    readonly pointsPerBatch: number;
    readonly eligible: boolean;
  };
}

const pinnedSource = <TMediaType extends 'image/jpeg' | 'image/png'>(input: {
  readonly mediaType: TMediaType;
  readonly byteLength: number;
  readonly width: number;
  readonly height: number;
  readonly sha256: string;
}): Readonly<typeof input> => Object.freeze(input);

export const deriveSamAutomaticBatchPeakBytesV1 = (
  width: number,
  height: number,
  pointsPerBatch: number,
): number => {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    !Number.isSafeInteger(pointsPerBatch) ||
    width < 1 ||
    height < 1 ||
    pointsPerBatch < 0 ||
    pointsPerBatch > SAM_AUTOMATIC_MAXIMUM_POINTS_PER_BATCH
  ) {
    throw new TypeError('SAM automatic capacity dimensions or point count are invalid.');
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels)) {
    throw new TypeError('SAM automatic capacity pixel count is unsafe.');
  }
  const lowResolutionBytesPerMask =
    SAM_AUTOMATIC_LOW_RESOLUTION_SIDE * SAM_AUTOMATIC_LOW_RESOLUTION_SIDE * 4;
  const bytesPerMask =
    pixels * SAM_AUTOMATIC_ENCODER_BYTES_PER_MASK_PIXEL_TOTAL + lowResolutionBytesPerMask;
  return (
    SAM_AUTOMATIC_BATCH_FIXED_RESERVE_BYTES +
    pointsPerBatch * SAM_AUTOMATIC_MULTIMASK_OUTPUTS * bytesPerMask
  );
};

const deriveCapacity = (width: number, height: number) => {
  const onePointPeak = deriveSamAutomaticBatchPeakBytesV1(width, height, 1);
  const eligible = onePointPeak <= SAM_AUTOMATIC_CAPACITY_CEILING_BYTES;
  const fixedPeak = deriveSamAutomaticBatchPeakBytesV1(width, height, 0);
  const bytesPerPoint = onePointPeak - fixedPeak;
  return Object.freeze({
    automaticOnePointPeakBytes: onePointPeak,
    ceilingBytes: SAM_AUTOMATIC_CAPACITY_CEILING_BYTES,
    pointsPerBatch: eligible
      ? Math.min(
          SAM_AUTOMATIC_MAXIMUM_POINTS_PER_BATCH,
          Math.floor((SAM_AUTOMATIC_CAPACITY_CEILING_BYTES - fixedPeak) / bytesPerPoint),
        )
      : 0,
    eligible,
  });
};

const fixture = (input: Omit<SamCorpusFixtureCatalogEntryV1, 'catalogVersion'>) =>
  Object.freeze({
    catalogVersion: SAM_CORPUS_EVALUATION_CATALOG_VERSION,
    ...input,
  }) satisfies SamCorpusFixtureCatalogEntryV1;

const product = fixture({
  fixtureKey: 'product',
  fixtureId: 'banner-product-v1',
  normalizedReference: 'product-normalized',
  original: pinnedSource({
    mediaType: 'image/jpeg',
    byteLength: 217_384,
    width: 2_015,
    height: 900,
    sha256: 'ce1be4eacbd65763d1d2b2835f9ad49c50cd9b3f56edc4a6a289822965bf09c5',
  }),
  normalized: pinnedSource({
    mediaType: 'image/png',
    byteLength: 1_984_404,
    width: 2_015,
    height: 900,
    sha256: 'a38db6f627ee275eabf7643c99a83aac5e1ac77bbfe1b1abcc24112c6a04e69a',
  }),
  humanOracle: Object.freeze({
    corpusSha256: SAM_CORPUS_HUMAN_ORACLE_SHA256,
    oracleSha256: 'bf9d42ed77e5aa3e8dedf3b593d65802bacdb38314b2df8e31632272d0e5e019',
    approvedEntrySha256: '35691f952c9ed92b0462127720c05f3755cecf3987c852bf20a6dd27fe16ffaf',
    requiredLayerIds: Object.freeze([
      'product.layer.background',
      'product.layer.candle',
      'product.layer.headline',
    ]),
  }),
  identifiers: Object.freeze({
    requestId: '36962dfd-8e1e-4cfb-982a-7f46e573a4bb',
    workspaceId: '832ad37d-3914-49e7-96a2-5b1897d2a573',
    jobId: '30e049bb-e46e-40a6-b75a-bfe8eed084f9',
    attemptId: 'c7739f3a-31cc-4e62-a7a9-648a20639093',
  }),
  canonicalRequest: Object.freeze({
    byteLength: 2_646_546,
    sha256: '61da2a2f6695365265c534ab06d30b4fedc3bf80e1c6a17ce8a86b4674315d20',
  }),
  capacity: deriveCapacity(2_015, 900),
});

const textHeavy = fixture({
  fixtureKey: 'text-heavy',
  fixtureId: 'banner-text-heavy-v1',
  normalizedReference: 'text-heavy-normalized',
  original: pinnedSource({
    mediaType: 'image/jpeg',
    byteLength: 25_417,
    width: 416,
    height: 522,
    sha256: '886afa4806fd252175d08a56eb5cae4989f3ac59c6a0c6e0a59f8a6d61195d77',
  }),
  normalized: pinnedSource({
    mediaType: 'image/png',
    byteLength: 166_461,
    width: 416,
    height: 522,
    sha256: '181e4c3762b79b5dfcbdb21c6c873ede8b32bf85dfe98fdecc13d59fb8cbcb62',
  }),
  humanOracle: Object.freeze({
    corpusSha256: SAM_CORPUS_HUMAN_ORACLE_SHA256,
    oracleSha256: '80a2407ade80036bb82eb1c7cb486b418eb6c8b369668844a978caf4d88a9fa1',
    approvedEntrySha256: '8d65fc7575e83666bfa406258c82a0c228457ec6859ba694c8601fed502b22f7',
    requiredLayerIds: Object.freeze([
      'text-heavy.layer.background',
      'text-heavy.layer.stand',
      'text-heavy.layer.header',
      'text-heavy.layer.options',
      'text-heavy.layer.lower-accent',
    ]),
  }),
  identifiers: Object.freeze({
    requestId: 'bd77b025-7020-4315-a903-5c4a33f264c3',
    workspaceId: '29df7bb0-38f5-4530-aeec-370ffcf2fe35',
    jobId: '45abc4d6-38e3-4eb5-943c-25902f4ab3b9',
    attemptId: '5aa44680-cb45-4d9a-9be4-e910fbeecddf',
  }),
  canonicalRequest: Object.freeze({
    byteLength: 222_620,
    sha256: 'a14354bb67685293a8aa3c2523db36506b2050d53f0dea90c4070bcdd015ee26',
  }),
  capacity: deriveCapacity(416, 522),
});

const noText = fixture({
  fixtureKey: 'no-text',
  fixtureId: 'banner-no-text-v1',
  normalizedReference: 'no-text-normalized',
  original: pinnedSource({
    mediaType: 'image/jpeg',
    byteLength: 15_312,
    width: 738,
    height: 255,
    sha256: 'af4ee315a16887692aaec4e972615535a086a906b43257eb1c78aa50212d31c3',
  }),
  normalized: pinnedSource({
    mediaType: 'image/png',
    byteLength: 125_894,
    width: 738,
    height: 255,
    sha256: '40f8a1c4312ec86cb4e38e16b9a423e85c2a9e3cf5f98a4bc510c23f3d4cf073',
  }),
  humanOracle: Object.freeze({
    corpusSha256: SAM_CORPUS_HUMAN_ORACLE_SHA256,
    oracleSha256: '14152119e3a999bba8f5ffe48aec6138c9f678ded6cd7071945b76b5792a8c38',
    approvedEntrySha256: '5069ba7fab787bb0eac55259c0e3c1f9402b657e568440671a7eb1c6929fdf21',
    requiredLayerIds: Object.freeze([
      'no-text.layer.background-composite',
      'no-text.layer.cyan-decorations',
      'no-text.layer.coral-sunbursts',
    ]),
  }),
  identifiers: Object.freeze({
    requestId: '572418c9-8adf-4733-ab05-64f9f0e8bca3',
    workspaceId: '4b206662-91fd-4393-844a-69aadb728d6d',
    jobId: 'f4e1e5b2-4c71-42f3-8ab8-e02cf8f27bb3',
    attemptId: '3dac7a47-f6b4-4541-a2c5-413edd7a9bfb',
  }),
  canonicalRequest: Object.freeze({
    byteLength: 168_532,
    sha256: '53c78a074f8b92a36051fd6474ad4256af841218195fbee1fdfcfa29dcee7644',
  }),
  capacity: deriveCapacity(738, 255),
});

export const SAM_CORPUS_EVALUATION_FIXTURES_V1 = Object.freeze({
  product,
  'text-heavy': textHeavy,
  'no-text': noText,
});

export const SAM_CORPUS_CAPACITY_MATRIX_V1 = Object.freeze({
  person: Object.freeze({
    width: SAM_FIRST_INFERENCE_FIXTURE.width,
    height: SAM_FIRST_INFERENCE_FIXTURE.height,
    automaticOnePointPeakBytes: deriveSamAutomaticBatchPeakBytesV1(
      SAM_FIRST_INFERENCE_FIXTURE.width,
      SAM_FIRST_INFERENCE_FIXTURE.height,
      1,
    ),
    eligible: true as const,
  }),
  product: Object.freeze({
    width: product.normalized.width,
    height: product.normalized.height,
    automaticOnePointPeakBytes: product.capacity.automaticOnePointPeakBytes,
    eligible: false as const,
  }),
  'text-heavy': Object.freeze({
    width: textHeavy.normalized.width,
    height: textHeavy.normalized.height,
    automaticOnePointPeakBytes: textHeavy.capacity.automaticOnePointPeakBytes,
    eligible: true as const,
  }),
  'no-text': Object.freeze({
    width: noText.normalized.width,
    height: noText.normalized.height,
    automaticOnePointPeakBytes: noText.capacity.automaticOnePointPeakBytes,
    eligible: true as const,
  }),
});

const exactJson = (left: unknown, right: unknown): boolean =>
  canonicalizeJson(left) === canonicalizeJson(right);

const assertCatalogEvidence = (): void => {
  if (
    sha256Hex(Buffer.from(canonicalizeJson(SAM_CORPUS_LOCAL_IDENTITY_EVIDENCE), 'utf8')) !==
      SAM_CORPUS_LOCAL_IDENTITY_EVIDENCE_SHA256 ||
    SAM_CORPUS_LOCAL_IDENTITY_EVIDENCE.workerHostingVersion !== 'sam-worker-fastapi-direct-v2' ||
    SAM_CORPUS_LOCAL_IDENTITY_EVIDENCE.directHostingProfileSha256 !==
      SAM_CORPUS_PROFILE_IDENTITIES.hostingSha256 ||
    SAM_CORPUS_LOCAL_IDENTITY_EVIDENCE.directAdapterV3ProfileSha256 !==
      SAM_CORPUS_PROFILE_IDENTITIES.adapterV3Sha256 ||
    SAM_CORPUS_LOCAL_IDENTITY_EVIDENCE.authorizationV3ProfileSha256 !==
      SAM_CORPUS_PROFILE_IDENTITIES.authorizationV3Sha256
  ) {
    throw new TypeError('SAM corpus local execution or profile identity drifted.');
  }
  for (const entry of Object.values(SAM_CORPUS_EVALUATION_FIXTURES_V1)) {
    const sources = REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V2.filter(
      (source) => source.fixtureId === entry.fixtureId,
    );
    if (sources.length !== 1 || sources[0]?.normalized.reference !== entry.normalizedReference) {
      throw new TypeError(`SAM corpus fixed source registry drifted for ${entry.fixtureId}.`);
    }
  }
  const expectedMatrix = [106_223_296, 650_511_040, 114_138_112, 104_406_880];
  const actualMatrix = Object.values(SAM_CORPUS_CAPACITY_MATRIX_V1).map(
    (entry) => entry.automaticOnePointPeakBytes,
  );
  if (!exactJson(actualMatrix, expectedMatrix)) {
    throw new TypeError('SAM corpus automatic capacity matrix drifted.');
  }
  const allIdentifiers = [
    ...Object.values(SAM_FIRST_INFERENCE_REQUEST_IDENTIFIERS),
    ...Object.values(SAM_CORPUS_EVALUATION_FIXTURES_V1).flatMap((entry) =>
      Object.values(entry.identifiers),
    ),
  ];
  if (allIdentifiers.length !== 16 || new Set(allIdentifiers).size !== 16) {
    throw new TypeError('SAM person and corpus request identifier quartets are not unique.');
  }
};

assertCatalogEvidence();

export type SamCorpusPreparedRequestV1 = SamRunPodDirectV3PreparedRequest;

interface PreparedCorpusStateV1 {
  readonly catalogEntry: SamCorpusFixtureCatalogEntryV1;
  readonly directPrepared: SamRunPodDirectV3PreparedRequest;
  readonly expectedExecutionIdentity: SamExecutionIdentity;
}

const preparedCorpusStates = new WeakMap<object, PreparedCorpusStateV1>();

const constructCanonicalRequest = async (
  catalogEntry: SamCorpusFixtureCatalogEntryV1,
): Promise<SamRunPodDirectV3PreparedRequest> => {
  const sourceBytes = await readPendingCorpusPackageFileV2(catalogEntry.normalizedReference);
  if (
    sourceBytes.byteLength !== catalogEntry.normalized.byteLength ||
    sha256Hex(sourceBytes) !== catalogEntry.normalized.sha256
  ) {
    throw new TypeError(`SAM corpus normalized source drifted for ${catalogEntry.fixtureId}.`);
  }
  const request = SamMaskRequestSchema.parse({
    contractVersion: SAM_MASK_CONTRACT_VERSION,
    ...catalogEntry.identifiers,
    source: {
      mediaType: 'image/png',
      byteSize: catalogEntry.normalized.byteLength,
      width: catalogEntry.normalized.width,
      height: catalogEntry.normalized.height,
      sha256: catalogEntry.normalized.sha256,
      pngBase64: Buffer.from(sourceBytes).toString('base64'),
    },
    segmentation: { mode: 'automatic-candidates', prompt: { kind: 'none' } },
    limits: SAM_CORPUS_REQUEST_LIMITS,
    output: { maskEncoding: SAM_MASK_ENCODING },
  });
  const prepared = prepareSamRunPodDirectV3Request({
    endpointId: SAM_CORPUS_ENDPOINT_ID,
    requestInput: request,
    workerImageDigest: SAM_CORPUS_WORKER_IMAGE_DIGEST,
  });
  if (
    prepared.canonicalBodyByteLength !== catalogEntry.canonicalRequest.byteLength ||
    prepared.canonicalBodySha256 !== catalogEntry.canonicalRequest.sha256
  ) {
    throw new TypeError(`SAM corpus canonical request drifted for ${catalogEntry.fixtureId}.`);
  }
  return prepared;
};

const assertCapacityEligible = (entry: SamCorpusFixtureCatalogEntryV1): void => {
  if (
    entry.capacity.automaticOnePointPeakBytes > entry.capacity.ceilingBytes ||
    !entry.capacity.eligible ||
    entry.capacity.pointsPerBatch < 1
  ) {
    throw new TypeError(
      `SAM corpus capacity refused ${entry.fixtureId}: ${entry.capacity.automaticOnePointPeakBytes} > ${entry.capacity.ceilingBytes}.`,
    );
  }
};

const prepareEligibleFixture = async (
  entry: SamCorpusFixtureCatalogEntryV1,
): Promise<SamCorpusPreparedRequestV1> => {
  assertCapacityEligible(entry);
  const prepared = await constructCanonicalRequest(entry);
  preparedCorpusStates.set(
    prepared,
    Object.freeze({
      catalogEntry: entry,
      directPrepared: prepared,
      expectedExecutionIdentity: SAM_CORPUS_EXECUTION_IDENTITY,
    }),
  );
  return prepared;
};

/** The native product fixture is intentionally refused before reading or preparing source bytes. */
export const prepareSamProductCorpusRequestV1 = async (
  rejectedCallerInput?: never,
): Promise<never> => {
  if (rejectedCallerInput !== undefined) {
    throw new TypeError('Fixed SAM corpus preparation accepts no caller input.');
  }
  assertCapacityEligible(product);
  throw new TypeError('Unreachable product capacity state.');
};

export const prepareSamTextHeavyCorpusRequestV1 = async (
  rejectedCallerInput?: never,
): Promise<SamCorpusPreparedRequestV1> => {
  if (rejectedCallerInput !== undefined) {
    throw new TypeError('Fixed SAM corpus preparation accepts no caller input.');
  }
  return prepareEligibleFixture(textHeavy);
};

export const prepareSamNoTextCorpusRequestV1 = async (
  rejectedCallerInput?: never,
): Promise<SamCorpusPreparedRequestV1> => {
  if (rejectedCallerInput !== undefined) {
    throw new TypeError('Fixed SAM corpus preparation accepts no caller input.');
  }
  return prepareEligibleFixture(noText);
};

export const inspectSamCorpusPreparedRequestV1 = (
  prepared: SamCorpusPreparedRequestV1,
): PreparedCorpusStateV1 => {
  const state = preparedCorpusStates.get(prepared);
  if (state === undefined) {
    throw new TypeError('SAM corpus prepared request is foreign or reconstructed.');
  }
  const direct = inspectSamRunPodDirectV3PreparedRequest(state.directPrepared);
  const entry = state.catalogEntry;
  if (
    prepared.canonicalBodyByteLength !== entry.canonicalRequest.byteLength ||
    prepared.canonicalBodySha256 !== entry.canonicalRequest.sha256 ||
    direct.request.source.sha256 !== entry.normalized.sha256 ||
    direct.request.source.byteSize !== entry.normalized.byteLength ||
    direct.request.source.width !== entry.normalized.width ||
    direct.request.source.height !== entry.normalized.height ||
    direct.endpointId !== SAM_CORPUS_ENDPOINT_ID ||
    direct.workerImageDigest !== SAM_CORPUS_WORKER_IMAGE_DIGEST ||
    direct.request.segmentation.mode !== 'automatic-candidates' ||
    !exactJson(direct.request.limits, SAM_CORPUS_REQUEST_LIMITS) ||
    !exactJson(state.expectedExecutionIdentity, SAM_CORPUS_EXECUTION_IDENTITY)
  ) {
    throw new TypeError('SAM corpus prepared request identity drifted.');
  }
  return state;
};

/** Recomputes all three canonical identities from committed bytes without granting execution. */
export const verifySamCorpusCanonicalRequestIdentitiesV1 = async (
  rejectedCallerInput?: never,
): Promise<
  readonly {
    readonly fixtureKey: SamCorpusFixtureKeyV1;
    readonly byteLength: number;
    readonly sha256: string;
    readonly dispatchAuthority: false;
  }[]
> => {
  if (rejectedCallerInput !== undefined) {
    throw new TypeError('SAM corpus identity verification accepts no caller input.');
  }
  const results = [];
  for (const entry of [product, textHeavy, noText] as const) {
    const prepared = await constructCanonicalRequest(entry);
    results.push(
      Object.freeze({
        fixtureKey: entry.fixtureKey,
        byteLength: prepared.canonicalBodyByteLength,
        sha256: prepared.canonicalBodySha256,
        dispatchAuthority: false as const,
      }),
    );
  }
  return Object.freeze(results);
};
