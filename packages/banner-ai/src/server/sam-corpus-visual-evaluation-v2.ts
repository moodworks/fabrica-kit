import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { link, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { z } from 'zod';

import {
  SAM_CORPUS_CAPABILITY_SEPARATION_V1,
  SAM_CORPUS_VISUAL_REVIEW_VERSION,
  SamCorpusVisualJudgmentV1Schema,
  SamCorpusVisualReviewV1Schema,
  type SamCorpusVisualReviewV1,
} from '../evaluation/sam-corpus-visual-quality-v1.js';
import {
  SAM_MASK_CONTRACT_VERSION,
  SAM_MASK_ENCODING,
  SamExecutionIdentitySchema,
  SamMaskRequestSchema,
  type SamExecutionIdentity,
  type SamMaskCandidate,
  type SamMaskResponse,
} from '../sam/sam-mask-contracts.js';
import { materializeSamMaskCutout } from '../sam/sam-cutout-materializer.js';
import { postprocessSamMasks, type SamRawMaskCandidate } from '../sam/sam-mask-postprocess.js';
import {
  canonicalResponseSha256,
  compareSamCandidates,
  decodeBinaryMaskRle,
  decodeCanonicalBase64,
  deriveMaskPixelBounds,
  deriveSamCandidateId,
  encodeBinaryMaskRle,
  encodeCanonicalBase64,
  maskContentSha256,
  pixelBoundsToBasisPoints,
} from '../sam/sam-mask-rle.js';
import {
  assertSamMaskResponseWasStrictlyValidated,
  parseAndVerifySamMaskRequest,
  parseAndVerifySamMaskResponse,
} from '../sam/sam-mask-validation.js';
import { inspectPngContainer } from '../security/raster-container.js';
import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import {
  SAM_CORPUS_ENDPOINT_ID,
  SAM_CORPUS_ENDPOINT_VERSION,
  SAM_CORPUS_EVALUATION_FIXTURES_V1,
  SAM_CORPUS_EXECUTION_IDENTITY,
  SAM_CORPUS_PROFILE_IDENTITIES,
  SAM_CORPUS_REQUEST_LIMITS,
  SAM_CORPUS_WORKER_IMAGE_DIGEST,
  inspectSamCorpusPreparedRequestV1,
  type SamCorpusFixtureCatalogEntryV1,
  type SamCorpusFixtureIdV1,
  type SamCorpusFixtureKeyV1,
  type SamCorpusPreparedRequestV1,
} from './sam-corpus-evaluation-catalog-v1.js';
import { SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY } from './sam-runpod-direct-v3-deterministic-fake-transport.js';

export const SAM_CORPUS_VISUAL_MANIFEST_SCHEMA =
  'fabrica-sam-corpus-visual-evaluation-manifest' as const;
export const SAM_CORPUS_VISUAL_MANIFEST_VERSION = 2 as const;
export const SAM_CORPUS_FAKE_OUTPUT_LABEL = 'FAKE TEST OUTPUT — NOT SAM OUTPUT' as const;
export const SAM_CORPUS_REAL_OUTPUT_LABEL = 'REAL SAM OUTPUT' as const;

export type SamCorpusOutputClassificationV2 = 'fake-test-output' | 'real-sam-output';

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const FILE_NAME_PATTERN = /^[a-z0-9][a-z0-9.-]*$/u;
const Sha256Schema = z.string().regex(SHA256_PATTERN);
const DimensionsSchema = z
  .strictObject({ width: z.int().min(1).max(4_096), height: z.int().min(1).max(4_096) })
  .readonly();
const FileArtifactSchema = z
  .strictObject({
    filename: z.string().regex(FILE_NAME_PATTERN),
    byteLength: z.int().min(1),
    sha256: Sha256Schema,
  })
  .readonly();
const ImageArtifactSchema = FileArtifactSchema.unwrap()
  .extend({ dimensions: DimensionsSchema })
  .readonly();
const BoundsPixelsSchema = z
  .strictObject({
    left: z.int().min(0),
    top: z.int().min(0),
    rightExclusive: z.int().min(1),
    bottomExclusive: z.int().min(1),
  })
  .readonly();

const SanitizedCandidateSchema = z
  .strictObject({
    order: z.int().min(1).max(8),
    candidateId: z.string().regex(/^samc_v1_[0-9a-f]{64}$/u),
    boundsBasisPoints: z
      .strictObject({
        xBps: z.int().min(0).max(10_000),
        yBps: z.int().min(0).max(10_000),
        widthBps: z.int().min(1).max(10_000),
        heightBps: z.int().min(1).max(10_000),
      })
      .readonly(),
    boundsPixels: BoundsPixelsSchema,
    pixelArea: z.int().min(1),
    areaRatioBps: z.int().min(0).max(10_000),
    predictedIouBps: z.int().min(0).max(10_000),
    stabilityScoreBps: z.int().min(0).max(10_000),
    mask: z
      .strictObject({
        encoding: z.literal(SAM_MASK_ENCODING),
        width: z.int().min(1).max(4_096),
        height: z.int().min(1).max(4_096),
        encodedByteLength: z.int().min(1),
        contentSha256: Sha256Schema,
      })
      .readonly(),
    reviewFlags: z
      .array(z.enum(['near-contained', 'overlapping', 'touches-source-edge']))
      .max(3)
      .readonly(),
  })
  .readonly();

export const SamCorpusSanitizedResponseV2Schema = z
  .strictObject({
    schema: z.literal('fabrica-sam-corpus-sanitized-response'),
    version: z.literal(2),
    fixtureId: z.enum(['banner-product-v1', 'banner-text-heavy-v1', 'banner-no-text-v1']),
    requestId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    jobId: z.string().uuid(),
    attemptId: z.string().uuid(),
    sourceSha256: Sha256Schema,
    validatedResponseSha256: Sha256Schema,
    executionIdentity: SamExecutionIdentitySchema,
    timing: z.strictObject({ inferenceMs: z.int().min(0), totalMs: z.int().min(0) }).readonly(),
    filterSummary: z
      .strictObject({
        rawCandidateCount: z.int().min(0),
        exactDuplicateFiltered: z.int().min(0),
        tinyFiltered: z.int().min(0),
        fullCanvasFiltered: z.int().min(0),
        rleTooLargeFiltered: z.int().min(0),
        rleBudgetFiltered: z.int().min(0),
        candidateLimitFiltered: z.int().min(0),
        returnedCandidateCount: z.int().min(0).max(8),
      })
      .readonly(),
    candidateCount: z.int().min(0).max(8),
    candidates: z.array(SanitizedCandidateSchema).max(8).readonly(),
    containsMaskPayloadBytes: z.literal(false),
  })
  .superRefine((response, context) => {
    if (
      response.candidateCount !== response.candidates.length ||
      response.filterSummary.returnedCandidateCount !== response.candidateCount ||
      response.candidates.some((candidate, index) => candidate.order !== index + 1)
    ) {
      context.addIssue({ code: 'custom', message: 'Sanitized response candidate counts drifted.' });
    }
  })
  .readonly();

export type SamCorpusSanitizedResponseV2 = z.infer<typeof SamCorpusSanitizedResponseV2Schema>;

const ManifestCandidateSchema = SanitizedCandidateSchema.unwrap()
  .extend({
    artifacts: z
      .strictObject({
        mask: ImageArtifactSchema,
        cutout: ImageArtifactSchema,
        overlay: ImageArtifactSchema,
      })
      .readonly(),
  })
  .readonly();

export const SamCorpusVisualManifestV2Schema = z
  .strictObject({
    schema: z.literal(SAM_CORPUS_VISUAL_MANIFEST_SCHEMA),
    version: z.literal(SAM_CORPUS_VISUAL_MANIFEST_VERSION),
    outputClassification: z.enum(['fake-test-output', 'real-sam-output']),
    label: z.enum([SAM_CORPUS_FAKE_OUTPUT_LABEL, SAM_CORPUS_REAL_OUTPUT_LABEL]),
    fixture: z
      .strictObject({
        fixtureKey: z.enum(['product', 'text-heavy', 'no-text']),
        fixtureId: z.enum(['banner-product-v1', 'banner-text-heavy-v1', 'banner-no-text-v1']),
        byteLength: z.int().min(1),
        dimensions: DimensionsSchema,
        sha256: Sha256Schema,
        humanOracleSha256: Sha256Schema,
        approvedOracleEntrySha256: Sha256Schema,
      })
      .readonly(),
    canonicalRequest: z
      .strictObject({ byteLength: z.int().min(1), sha256: Sha256Schema })
      .readonly(),
    identities: z
      .strictObject({
        endpointId: z.literal(SAM_CORPUS_ENDPOINT_ID),
        endpointVersion: z.literal(SAM_CORPUS_ENDPOINT_VERSION),
        workerImageDigest: z.literal(SAM_CORPUS_WORKER_IMAGE_DIGEST),
        contractVersion: z.literal(SAM_MASK_CONTRACT_VERSION),
        maskEncoding: z.literal(SAM_MASK_ENCODING),
        targetExecution: SamExecutionIdentitySchema,
        actualExecution: SamExecutionIdentitySchema,
        profiles: z
          .strictObject({
            hostingSha256: z.literal(SAM_CORPUS_PROFILE_IDENTITIES.hostingSha256),
            adapterV3Sha256: z.literal(SAM_CORPUS_PROFILE_IDENTITIES.adapterV3Sha256),
            authorizationV3Sha256: z.literal(SAM_CORPUS_PROFILE_IDENTITIES.authorizationV3Sha256),
          })
          .readonly(),
      })
      .readonly(),
    validatedResponseSha256: Sha256Schema,
    sanitizedResponse: FileArtifactSchema,
    source: ImageArtifactSchema,
    candidateCount: z.int().min(0).max(8),
    candidates: z.array(ManifestCandidateSchema).max(8).readonly(),
    inventory: z
      .strictObject({
        expectedFileCount: z.int().min(3).max(27),
        nonManifestSha256: Sha256Schema,
      })
      .readonly(),
  })
  .superRefine((manifest, context) => {
    const fake = manifest.outputClassification === 'fake-test-output';
    if (
      manifest.label !== (fake ? SAM_CORPUS_FAKE_OUTPUT_LABEL : SAM_CORPUS_REAL_OUTPUT_LABEL) ||
      manifest.source.filename !== 'source.png' ||
      manifest.sanitizedResponse.filename !== 'response.json' ||
      manifest.candidateCount !== manifest.candidates.length ||
      manifest.inventory.expectedFileCount !== 3 + 3 * manifest.candidateCount
    ) {
      context.addIssue({ code: 'custom', message: 'SAM corpus manifest count or label drifted.' });
    }
    for (const [index, candidate] of manifest.candidates.entries()) {
      const number = String(index + 1).padStart(2, '0');
      if (
        candidate.order !== index + 1 ||
        candidate.artifacts.mask.filename !== `candidate-${number}-mask.png` ||
        candidate.artifacts.cutout.filename !== `candidate-${number}-cutout.png` ||
        candidate.artifacts.overlay.filename !== `candidate-${number}-overlay.png`
      ) {
        context.addIssue({ code: 'custom', message: 'SAM corpus candidate filenames drifted.' });
      }
    }
  })
  .readonly();

export type SamCorpusVisualManifestV2 = z.infer<typeof SamCorpusVisualManifestV2Schema>;

interface DecodedCandidateV2 {
  readonly candidate: SamMaskCandidate;
  readonly pixels: Uint8Array;
  readonly bounds: ReturnType<typeof deriveMaskPixelBounds>;
}

interface ValidatedStateV2 {
  readonly prepared: SamCorpusPreparedRequestV1;
  readonly catalogEntry: SamCorpusFixtureCatalogEntryV1;
  readonly response: SamMaskResponse;
  readonly sourceBytes: Uint8Array;
  readonly outputClassification: SamCorpusOutputClassificationV2;
  readonly decodedCandidates: readonly DecodedCandidateV2[];
}

export interface SamCorpusValidatedVisualResponseV2 {
  readonly purpose: 'strictly-validated-sam-corpus-visual-response-v2';
  readonly fixtureKey: SamCorpusFixtureKeyV1;
  readonly candidateCount: number;
}

const validatedStates = new WeakMap<object, ValidatedStateV2>();
const boundResponses = new WeakSet<object>();
const consumedValidatedResponses = new WeakSet<object>();
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const exactJson = (left: unknown, right: unknown): boolean =>
  canonicalizeJson(left) === canonicalizeJson(right);

const catalogEntryForId = (fixtureId: SamCorpusFixtureIdV1): SamCorpusFixtureCatalogEntryV1 => {
  const entry = Object.values(SAM_CORPUS_EVALUATION_FIXTURES_V1).find(
    (candidate) => candidate.fixtureId === fixtureId,
  );
  if (entry === undefined) throw new TypeError('SAM corpus fixture identity is not closed.');
  return entry;
};

export const validateSamCorpusVisualResponseV2 = (input: {
  readonly prepared: SamCorpusPreparedRequestV1;
  readonly response: SamMaskResponse;
  readonly outputClassification: SamCorpusOutputClassificationV2;
}): SamCorpusValidatedVisualResponseV2 => {
  const preparedState = inspectSamCorpusPreparedRequestV1(input.prepared);
  const expectedExecutionKind =
    input.outputClassification === 'fake-test-output' ? 'deterministic-fake' : 'meta-sam2.1';
  const response = assertSamMaskResponseWasStrictlyValidated({
    response: input.response,
    request: preparedState.directPrepared.request,
    expectedExecutionKind,
  });
  const entry = preparedState.catalogEntry;
  if (
    boundResponses.has(response) ||
    response.requestId !== entry.identifiers.requestId ||
    response.workspaceId !== entry.identifiers.workspaceId ||
    response.jobId !== entry.identifiers.jobId ||
    response.attemptId !== entry.identifiers.attemptId ||
    response.sourceSha256 !== entry.normalized.sha256 ||
    response.candidateCount !== response.candidates.length ||
    response.candidateCount > SAM_CORPUS_REQUEST_LIMITS.maxCandidates ||
    canonicalResponseSha256(
      Object.fromEntries(
        Object.entries(response).filter(([key]) => key !== 'responseSha256'),
      ) as Omit<SamMaskResponse, 'responseSha256'>,
    ) !== response.responseSha256 ||
    !exactJson(
      response.executionIdentity,
      expectedExecutionKind === 'deterministic-fake'
        ? SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY
        : SAM_CORPUS_EXECUTION_IDENTITY,
    )
  ) {
    throw new TypeError('SAM corpus response, request, or execution identity drifted.');
  }
  const decodedCandidates = response.candidates.map((candidate): DecodedCandidateV2 => {
    const encoded = decodeCanonicalBase64(candidate.mask.dataBase64, 1_000_000);
    const decoded = decodeBinaryMaskRle(encoded, entry.normalized.width, entry.normalized.height);
    const bounds = deriveMaskPixelBounds(decoded.pixels, decoded.width, decoded.height);
    const digest = maskContentSha256(decoded.pixels, decoded.width, decoded.height);
    if (
      encoded.byteLength !== candidate.mask.byteSize ||
      bounds.area !== candidate.pixelArea ||
      digest !== candidate.mask.sha256 ||
      candidate.candidateId !==
        deriveSamCandidateId({
          sourceSha256: entry.normalized.sha256,
          width: decoded.width,
          height: decoded.height,
          maskSha256: digest,
        }) ||
      !exactJson(candidate.bounds, pixelBoundsToBasisPoints(bounds, decoded.width, decoded.height))
    ) {
      throw new TypeError('SAM corpus candidate mask identity or geometry drifted.');
    }
    return Object.freeze({
      candidate,
      pixels: Uint8Array.from(decoded.pixels),
      bounds: Object.freeze(bounds),
    });
  });
  if (
    [...response.candidates]
      .sort(compareSamCandidates)
      .some((candidate, index) => candidate !== response.candidates[index])
  ) {
    throw new TypeError('SAM corpus candidates are not canonically ordered.');
  }
  const { sourceBytes } = parseAndVerifySamMaskRequest(preparedState.directPrepared.request);
  if (
    sourceBytes.byteLength !== entry.normalized.byteLength ||
    sha256(sourceBytes) !== entry.normalized.sha256
  ) {
    throw new TypeError('SAM corpus prepared source bytes drifted.');
  }
  const capability = Object.freeze({
    purpose: 'strictly-validated-sam-corpus-visual-response-v2' as const,
    fixtureKey: entry.fixtureKey,
    candidateCount: response.candidateCount,
  });
  validatedStates.set(
    capability,
    Object.freeze({
      prepared: input.prepared,
      catalogEntry: entry,
      response,
      sourceBytes: Uint8Array.from(sourceBytes),
      outputClassification: input.outputClassification,
      decodedCandidates: Object.freeze(decodedCandidates),
    }),
  );
  boundResponses.add(response);
  return capability;
};

interface PendingArtifactV2 {
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly dimensions?: { readonly width: number; readonly height: number };
}

const artifactMetadata = (artifact: PendingArtifactV2) =>
  Object.freeze({
    filename: artifact.filename,
    byteLength: artifact.bytes.byteLength,
    sha256: sha256(artifact.bytes),
    ...(artifact.dimensions === undefined ? {} : { dimensions: artifact.dimensions }),
  });

const inventoryDigest = (artifacts: readonly PendingArtifactV2[]): string =>
  sha256(
    Buffer.from(
      canonicalizeJson(
        artifacts
          .map((artifact) => artifactMetadata(artifact))
          .toSorted((left, right) =>
            left.filename < right.filename ? -1 : left.filename > right.filename ? 1 : 0,
          ),
      ),
      'utf8',
    ),
  );

const sanitizedCandidate = (
  decoded: DecodedCandidateV2,
  order: number,
): z.infer<typeof SanitizedCandidateSchema> => ({
  order,
  candidateId: decoded.candidate.candidateId,
  boundsBasisPoints: decoded.candidate.bounds,
  boundsPixels: {
    left: decoded.bounds.left,
    top: decoded.bounds.top,
    rightExclusive: decoded.bounds.rightExclusive,
    bottomExclusive: decoded.bounds.bottomExclusive,
  },
  pixelArea: decoded.candidate.pixelArea,
  areaRatioBps: decoded.candidate.areaRatioBps,
  predictedIouBps: decoded.candidate.predictedIouBps,
  stabilityScoreBps: decoded.candidate.stabilityScoreBps,
  mask: {
    encoding: decoded.candidate.mask.encoding,
    width: decoded.candidate.mask.width,
    height: decoded.candidate.mask.height,
    encodedByteLength: decoded.candidate.mask.byteSize,
    contentSha256: decoded.candidate.mask.sha256,
  },
  reviewFlags: decoded.candidate.reviewFlags,
});

const PNG_OPTIONS = Object.freeze({
  compressionLevel: 9,
  adaptiveFiltering: false,
  palette: false,
  force: true,
} as const);

const renderOverlay = async (input: {
  readonly sourceBytes: Uint8Array;
  readonly mask: Uint8Array;
  readonly width: number;
  readonly height: number;
}): Promise<Uint8Array> => {
  if (
    input.mask.byteLength !== input.width * input.height ||
    input.mask.some((pixel) => pixel !== 0 && pixel !== 1)
  ) {
    throw new TypeError('SAM corpus overlay requires one exact binary source-sized mask.');
  }
  const source = await sharp(input.sourceBytes, { failOn: 'error', limitInputPixels: 16_777_216 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    source.info.width !== input.width ||
    source.info.height !== input.height ||
    source.info.channels !== 4
  ) {
    throw new TypeError('SAM corpus overlay source dimensions drifted.');
  }
  const output = Buffer.from(source.data);
  for (let index = 0; index < input.mask.length; index += 1) {
    if (input.mask[index] !== 1) continue;
    const offset = index * 4;
    output[offset] = Math.floor((output[offset]! + 255) / 2);
    output[offset + 1] = Math.floor(output[offset + 1]! / 2);
    output[offset + 2] = Math.floor((output[offset + 2]! + 255) / 2);
    output[offset + 3] = 255;
  }
  return Uint8Array.from(
    await sharp(output, { raw: { width: input.width, height: input.height, channels: 4 } })
      .png(PNG_OPTIONS)
      .toBuffer(),
  );
};

const buildArtifacts = async (state: ValidatedStateV2) => {
  const entry = state.catalogEntry;
  const sourceArtifact: PendingArtifactV2 = Object.freeze({
    filename: 'source.png',
    bytes: Uint8Array.from(state.sourceBytes),
    dimensions: Object.freeze({ width: entry.normalized.width, height: entry.normalized.height }),
  });
  const sanitizedCandidates = state.decodedCandidates.map((candidate, index) =>
    sanitizedCandidate(candidate, index + 1),
  );
  const sanitizedResponse = SamCorpusSanitizedResponseV2Schema.parse({
    schema: 'fabrica-sam-corpus-sanitized-response',
    version: 2,
    fixtureId: entry.fixtureId,
    requestId: state.response.requestId,
    workspaceId: state.response.workspaceId,
    jobId: state.response.jobId,
    attemptId: state.response.attemptId,
    sourceSha256: state.response.sourceSha256,
    validatedResponseSha256: state.response.responseSha256,
    executionIdentity: state.response.executionIdentity,
    timing: state.response.timing,
    filterSummary: state.response.filterSummary,
    candidateCount: state.response.candidateCount,
    candidates: sanitizedCandidates,
    containsMaskPayloadBytes: false,
  });
  const responseArtifact: PendingArtifactV2 = Object.freeze({
    filename: 'response.json',
    bytes: Buffer.from(`${canonicalizeJson(sanitizedResponse)}\n`, 'utf8'),
  });
  const candidateArtifacts: PendingArtifactV2[] = [];
  const manifestCandidates = [];
  for (const [index, decoded] of state.decodedCandidates.entries()) {
    const number = String(index + 1).padStart(2, '0');
    const materialized = await materializeSamMaskCutout({
      trustedRequest: inspectSamCorpusPreparedRequestV1(state.prepared).directPrepared.request,
      candidate: decoded.candidate,
    });
    if (
      materialized.metadata.sourceSha256 !== entry.normalized.sha256 ||
      materialized.metadata.candidateId !== decoded.candidate.candidateId ||
      materialized.metadata.maskSha256 !== decoded.candidate.mask.sha256
    ) {
      throw new TypeError('SAM corpus cutout materialization relationship drifted.');
    }
    const cropWidth = decoded.bounds.rightExclusive - decoded.bounds.left;
    const cropHeight = decoded.bounds.bottomExclusive - decoded.bounds.top;
    const mask: PendingArtifactV2 = Object.freeze({
      filename: `candidate-${number}-mask.png`,
      bytes: Uint8Array.from(materialized.binaryMaskPng),
      dimensions: Object.freeze({ width: entry.normalized.width, height: entry.normalized.height }),
    });
    const cutout: PendingArtifactV2 = Object.freeze({
      filename: `candidate-${number}-cutout.png`,
      bytes: Uint8Array.from(materialized.cutoutPng),
      dimensions: Object.freeze({ width: cropWidth, height: cropHeight }),
    });
    const overlay: PendingArtifactV2 = Object.freeze({
      filename: `candidate-${number}-overlay.png`,
      bytes: await renderOverlay({
        sourceBytes: state.sourceBytes,
        mask: decoded.pixels,
        width: entry.normalized.width,
        height: entry.normalized.height,
      }),
      dimensions: Object.freeze({ width: entry.normalized.width, height: entry.normalized.height }),
    });
    candidateArtifacts.push(mask, cutout, overlay);
    manifestCandidates.push(
      Object.freeze({
        ...sanitizedCandidates[index]!,
        artifacts: Object.freeze({
          mask: artifactMetadata(mask),
          cutout: artifactMetadata(cutout),
          overlay: artifactMetadata(overlay),
        }),
      }),
    );
  }
  const nonManifestArtifacts = Object.freeze([
    sourceArtifact,
    responseArtifact,
    ...candidateArtifacts,
  ]);
  const manifest = SamCorpusVisualManifestV2Schema.parse({
    schema: SAM_CORPUS_VISUAL_MANIFEST_SCHEMA,
    version: SAM_CORPUS_VISUAL_MANIFEST_VERSION,
    outputClassification: state.outputClassification,
    label:
      state.outputClassification === 'fake-test-output'
        ? SAM_CORPUS_FAKE_OUTPUT_LABEL
        : SAM_CORPUS_REAL_OUTPUT_LABEL,
    fixture: {
      fixtureKey: entry.fixtureKey,
      fixtureId: entry.fixtureId,
      byteLength: entry.normalized.byteLength,
      dimensions: { width: entry.normalized.width, height: entry.normalized.height },
      sha256: entry.normalized.sha256,
      humanOracleSha256: entry.humanOracle.oracleSha256,
      approvedOracleEntrySha256: entry.humanOracle.approvedEntrySha256,
    },
    canonicalRequest: entry.canonicalRequest,
    identities: {
      endpointId: SAM_CORPUS_ENDPOINT_ID,
      endpointVersion: SAM_CORPUS_ENDPOINT_VERSION,
      workerImageDigest: SAM_CORPUS_WORKER_IMAGE_DIGEST,
      contractVersion: SAM_MASK_CONTRACT_VERSION,
      maskEncoding: SAM_MASK_ENCODING,
      targetExecution: SAM_CORPUS_EXECUTION_IDENTITY,
      actualExecution: state.response.executionIdentity,
      profiles: SAM_CORPUS_PROFILE_IDENTITIES,
    },
    validatedResponseSha256: state.response.responseSha256,
    sanitizedResponse: artifactMetadata(responseArtifact),
    source: artifactMetadata(sourceArtifact),
    candidateCount: state.response.candidateCount,
    candidates: manifestCandidates,
    inventory: {
      expectedFileCount: 3 + 3 * state.response.candidateCount,
      nonManifestSha256: inventoryDigest(nonManifestArtifacts),
    },
  });
  const manifestArtifact: PendingArtifactV2 = Object.freeze({
    filename: 'manifest.json',
    bytes: Buffer.from(`${canonicalizeJson(manifest)}\n`, 'utf8'),
  });
  return Object.freeze({
    manifest,
    artifacts: Object.freeze([...nonManifestArtifacts, manifestArtifact]),
  });
};

const repositoryRoot = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'),
);

const isMissingPathError = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

const assertOutsideRepository = (path: string): void => {
  const fromRepository = relative(repositoryRoot, path);
  if (
    fromRepository === '' ||
    (fromRepository !== '..' &&
      !fromRepository.startsWith(`..${sep}`) &&
      !isAbsolute(fromRepository))
  ) {
    throw new TypeError('SAM corpus output must remain outside the repository.');
  }
};

interface SafeOutputTargetV2 {
  readonly outputDirectory: string;
  readonly stagingDirectory: string;
}

const inspectAbsentOutputTarget = async (
  outputDirectory: string,
  classification: SamCorpusOutputClassificationV2,
): Promise<SafeOutputTargetV2> => {
  if (
    typeof outputDirectory !== 'string' ||
    outputDirectory.includes('\0') ||
    outputDirectory.includes('\\') ||
    !isAbsolute(outputDirectory) ||
    normalize(outputDirectory) !== outputDirectory ||
    resolve(outputDirectory) !== outputDirectory ||
    outputDirectory
      .slice(1)
      .split(sep)
      .some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new TypeError('SAM corpus output path must be exact, absolute, and unambiguous.');
  }
  if (
    classification === 'fake-test-output' &&
    !basename(outputDirectory).toLowerCase().includes('fake')
  ) {
    throw new TypeError('Provider-free SAM corpus output must be visibly labeled fake.');
  }
  const parentDirectory = dirname(outputDirectory);
  const parentStat = await lstat(parentDirectory);
  if (
    !parentStat.isDirectory() ||
    parentStat.isSymbolicLink() ||
    (await realpath(parentDirectory)) !== parentDirectory
  ) {
    throw new TypeError('SAM corpus output parent is symbolic or ambiguous.');
  }
  const physicalOutput = join(parentDirectory, basename(outputDirectory));
  assertOutsideRepository(physicalOutput);
  for (const path of [physicalOutput, `${physicalOutput}.fabrica-sam-corpus-staging`]) {
    try {
      await lstat(path);
      throw new TypeError('SAM corpus output and staging paths must both be absent.');
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
  }
  return Object.freeze({
    outputDirectory: physicalOutput,
    stagingDirectory: `${physicalOutput}.fabrica-sam-corpus-staging`,
  });
};

export const assertSamCorpusOutputDirectoryAbsentV2 = async (input: {
  readonly outputDirectory: string;
  readonly outputClassification: SamCorpusOutputClassificationV2;
}): Promise<void> => {
  await inspectAbsentOutputTarget(input.outputDirectory, input.outputClassification);
};

export interface SamCorpusMaterializationResultV2 {
  readonly manifest: SamCorpusVisualManifestV2;
  readonly manifestSha256: string;
  readonly sanitizedResponseSha256: string;
  readonly inventorySha256: string;
  readonly inventory: readonly string[];
  readonly outputDirectory: string;
}

interface VerifiedMaterializationStateV2 {
  readonly catalogEntry: SamCorpusFixtureCatalogEntryV1;
}

const verifiedMaterializationStates = new WeakMap<
  SamCorpusMaterializationResultV2,
  VerifiedMaterializationStateV2
>();
const reviewBoundMaterializations = new WeakSet<SamCorpusMaterializationResultV2>();

export interface SamCorpusVisualReviewEvidenceV1 {
  readonly purpose: 'verified-sam-corpus-visual-review-evidence-v1';
}

interface SamCorpusVisualReviewEvidenceStateV1 {
  readonly fixtureId: SamCorpusFixtureIdV1;
  readonly bindings: {
    readonly sourceSha256: string;
    readonly humanOracleSha256: string;
    readonly canonicalRequestSha256: string;
    readonly validatedResponseSha256: string;
    readonly sanitizedResponseSha256: string;
    readonly manifestSha256: string;
    readonly inventorySha256: string;
  };
  readonly expectedLayerIds: readonly string[];
  readonly candidateIds: readonly string[];
}

const reviewEvidenceStates = new WeakMap<object, SamCorpusVisualReviewEvidenceStateV1>();
const consumedReviewEvidence = new WeakSet<object>();

export const bindSamCorpusVisualReviewEvidenceV1 = (
  materialized: SamCorpusMaterializationResultV2,
): SamCorpusVisualReviewEvidenceV1 => {
  const verified = verifiedMaterializationStates.get(materialized);
  if (verified === undefined || reviewBoundMaterializations.has(materialized)) {
    throw new TypeError(
      'SAM corpus review evidence requires one unbound verified artifact result.',
    );
  }
  reviewBoundMaterializations.add(materialized);
  const entry = verified.catalogEntry;
  const evidence = Object.freeze({
    purpose: 'verified-sam-corpus-visual-review-evidence-v1' as const,
  });
  reviewEvidenceStates.set(
    evidence,
    Object.freeze({
      fixtureId: entry.fixtureId,
      bindings: Object.freeze({
        sourceSha256: entry.normalized.sha256,
        humanOracleSha256: entry.humanOracle.oracleSha256,
        canonicalRequestSha256: entry.canonicalRequest.sha256,
        validatedResponseSha256: materialized.manifest.validatedResponseSha256,
        sanitizedResponseSha256: materialized.sanitizedResponseSha256,
        manifestSha256: materialized.manifestSha256,
        inventorySha256: materialized.inventorySha256,
      }),
      expectedLayerIds: Object.freeze([...entry.humanOracle.requiredLayerIds]),
      candidateIds: Object.freeze(
        materialized.manifest.candidates.map((candidate) => candidate.candidateId),
      ),
    }),
  );
  return evidence;
};

const consumeSamCorpusVisualReviewEvidenceV1 = (
  evidence: SamCorpusVisualReviewEvidenceV1,
): SamCorpusVisualReviewEvidenceStateV1 => {
  const state = reviewEvidenceStates.get(evidence);
  if (state === undefined || consumedReviewEvidence.has(evidence)) {
    throw new TypeError('SAM corpus visual review evidence is foreign or already consumed.');
  }
  consumedReviewEvidence.add(evidence);
  return state;
};

/** Creates evidence only from one verifier-minted, single-use review capability. */
export const createSamCorpusVisualReviewV1 = (
  evidence: SamCorpusVisualReviewEvidenceV1,
  input: unknown,
): SamCorpusVisualReviewV1 => {
  const bound = consumeSamCorpusVisualReviewEvidenceV1(evidence);
  const judgment = SamCorpusVisualJudgmentV1Schema.parse(input);
  return SamCorpusVisualReviewV1Schema.parse({
    reviewVersion: SAM_CORPUS_VISUAL_REVIEW_VERSION,
    evidenceRole: 'provider-neutral-sam-corpus-candidate-review-v1',
    fixtureId: bound.fixtureId,
    bindings: bound.bindings,
    expectedLayerIds: bound.expectedLayerIds,
    candidateCount: bound.candidateIds.length,
    candidates: judgment.candidates.map((candidate, index) => ({
      candidateOrder: index + 1,
      candidateId: bound.candidateIds[index],
      ...candidate,
    })),
    missingLayerObservations: judgment.missingLayerObservations,
    duplicateObservations: judgment.duplicateObservations,
    mergeObservations: judgment.mergeObservations,
    fixtureUsability: judgment.fixtureUsability,
    fixtureRationale: judgment.fixtureRationale,
    scorePolarity: 'zero-worst-four-best-no-average',
    capabilitySeparation: SAM_CORPUS_CAPABILITY_SEPARATION_V1,
    providerNeutral: true,
    providerCallAuthority: false,
  });
};

export const materializeSamCorpusVisualEvaluationV2 = async (input: {
  readonly validated: SamCorpusValidatedVisualResponseV2;
  readonly outputDirectory: string;
}): Promise<SamCorpusMaterializationResultV2> => {
  const state = validatedStates.get(input.validated);
  if (state === undefined || consumedValidatedResponses.has(input.validated)) {
    throw new TypeError('SAM corpus validation capability is foreign or already consumed.');
  }
  consumedValidatedResponses.add(input.validated);
  const target = await inspectAbsentOutputTarget(input.outputDirectory, state.outputClassification);
  const built = await buildArtifacts(state);
  let stagingCreated = false;
  try {
    await mkdir(target.stagingDirectory, { mode: 0o700 });
    stagingCreated = true;
    for (const artifact of built.artifacts) {
      await writeFile(join(target.stagingDirectory, artifact.filename), artifact.bytes, {
        flag: 'wx',
        mode: 0o600,
      });
    }
    const staged = await verifySamCorpusVisualArtifactSetV2(target.stagingDirectory);
    if (!exactJson(staged.manifest, built.manifest)) {
      throw new TypeError('SAM corpus staged manifest differs from generated content.');
    }
    const manifestArtifact = built.artifacts.find(
      (artifact) => artifact.filename === 'manifest.json',
    );
    const nonManifestArtifacts = built.artifacts.filter(
      (artifact) => artifact.filename !== 'manifest.json',
    );
    if (
      manifestArtifact === undefined ||
      nonManifestArtifacts.length + 1 !== built.artifacts.length
    ) {
      throw new TypeError('SAM corpus publication plan has no unique manifest validity marker.');
    }

    // The exclusive directory claim closes the preflight lstat gap. Hard links are
    // individually no-overwrite; the manifest is linked last as the validity marker.
    await mkdir(target.outputDirectory, { mode: 0o700 });
    for (const artifact of nonManifestArtifacts) {
      await link(
        join(target.stagingDirectory, artifact.filename),
        join(target.outputDirectory, artifact.filename),
      );
    }
    await link(
      join(target.stagingDirectory, manifestArtifact.filename),
      join(target.outputDirectory, manifestArtifact.filename),
    );
    const published = await verifySamCorpusVisualArtifactSetV2(target.outputDirectory);
    await rm(target.stagingDirectory, { recursive: true });
    stagingCreated = false;
    return published;
  } catch (error) {
    if (stagingCreated) {
      try {
        await rm(target.stagingDirectory, { recursive: true });
      } catch {
        // Cleanup is restricted to the staging directory created by this attempt.
      }
    }
    throw error;
  }
};

const inspectCompletedOutputDirectory = async (outputDirectory: string): Promise<string> => {
  if (
    typeof outputDirectory !== 'string' ||
    outputDirectory.includes('\0') ||
    outputDirectory.includes('\\') ||
    !isAbsolute(outputDirectory) ||
    normalize(outputDirectory) !== outputDirectory ||
    resolve(outputDirectory) !== outputDirectory ||
    outputDirectory
      .slice(1)
      .split(sep)
      .some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new TypeError('SAM corpus completed output path is ambiguous.');
  }
  const parentDirectory = dirname(outputDirectory);
  const parentStat = await lstat(parentDirectory);
  if (
    !parentStat.isDirectory() ||
    parentStat.isSymbolicLink() ||
    (await realpath(parentDirectory)) !== parentDirectory
  ) {
    throw new TypeError('SAM corpus completed output parent is symbolic or ambiguous.');
  }
  const physicalOutput = join(parentDirectory, basename(outputDirectory));
  assertOutsideRepository(physicalOutput);
  const outputStat = await lstat(physicalOutput);
  if (
    !outputStat.isDirectory() ||
    outputStat.isSymbolicLink() ||
    (await realpath(physicalOutput)) !== physicalOutput
  ) {
    throw new TypeError('SAM corpus completed output must be a real directory.');
  }
  return physicalOutput;
};

const readRegularArtifact = async (directory: string, filename: string): Promise<Buffer> => {
  if (!FILE_NAME_PATTERN.test(filename)) {
    throw new TypeError('SAM corpus artifact filename is unsafe.');
  }
  const path = join(directory, filename);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new TypeError('SAM corpus artifact must be a regular non-symlink file.');
  }
  return readFile(path);
};

type FileArtifactV2 = z.infer<typeof FileArtifactSchema>;
type ImageArtifactV2 = z.infer<typeof ImageArtifactSchema>;

const assertArtifactMetadata = (
  bytes: Uint8Array,
  artifact: FileArtifactV2 | ImageArtifactV2,
): void => {
  if (bytes.byteLength !== artifact.byteLength || sha256(bytes) !== artifact.sha256) {
    throw new TypeError('SAM corpus artifact length or SHA-256 differs from its manifest.');
  }
  if ('dimensions' in artifact) {
    const info = inspectPngContainer(bytes);
    if (info.width !== artifact.dimensions.width || info.height !== artifact.dimensions.height) {
      throw new TypeError('SAM corpus PNG dimensions differ from its manifest.');
    }
  }
};

const candidateWithoutArtifacts = (candidate: z.infer<typeof ManifestCandidateSchema>) => {
  const { artifacts: _artifacts, ...sanitized } = candidate;
  void _artifacts;
  return sanitized;
};

export const verifySamCorpusVisualArtifactSetV2 = async (
  outputDirectoryInput: string,
): Promise<SamCorpusMaterializationResultV2> => {
  const outputDirectory = await inspectCompletedOutputDirectory(outputDirectoryInput);
  const manifestBytes = await readRegularArtifact(outputDirectory, 'manifest.json');
  let manifestInput: unknown;
  try {
    manifestInput = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  } catch {
    throw new TypeError('SAM corpus manifest is not strict UTF-8 JSON.');
  }
  const manifest = SamCorpusVisualManifestV2Schema.parse(manifestInput);
  if (!Buffer.from(manifestBytes).equals(Buffer.from(`${canonicalizeJson(manifest)}\n`, 'utf8'))) {
    throw new TypeError('SAM corpus manifest serialization is not canonical.');
  }
  const entry = catalogEntryForId(manifest.fixture.fixtureId);
  const expectedActualIdentity: SamExecutionIdentity =
    manifest.outputClassification === 'fake-test-output'
      ? SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY
      : SAM_CORPUS_EXECUTION_IDENTITY;
  if (
    manifest.fixture.fixtureKey !== entry.fixtureKey ||
    manifest.fixture.byteLength !== entry.normalized.byteLength ||
    !exactJson(manifest.fixture.dimensions, {
      width: entry.normalized.width,
      height: entry.normalized.height,
    }) ||
    manifest.fixture.sha256 !== entry.normalized.sha256 ||
    manifest.fixture.humanOracleSha256 !== entry.humanOracle.oracleSha256 ||
    manifest.fixture.approvedOracleEntrySha256 !== entry.humanOracle.approvedEntrySha256 ||
    !exactJson(manifest.canonicalRequest, entry.canonicalRequest) ||
    !exactJson(manifest.identities.targetExecution, SAM_CORPUS_EXECUTION_IDENTITY) ||
    !exactJson(manifest.identities.actualExecution, expectedActualIdentity) ||
    !exactJson(manifest.identities.profiles, SAM_CORPUS_PROFILE_IDENTITIES) ||
    (manifest.outputClassification === 'fake-test-output' &&
      !basename(outputDirectory).toLowerCase().includes('fake'))
  ) {
    throw new TypeError('SAM corpus manifest fixture or execution binding drifted.');
  }
  const expectedInventory = [
    manifest.source.filename,
    manifest.sanitizedResponse.filename,
    ...manifest.candidates.flatMap((candidate) => [
      candidate.artifacts.mask.filename,
      candidate.artifacts.cutout.filename,
      candidate.artifacts.overlay.filename,
    ]),
    'manifest.json',
  ].toSorted();
  const inventory = (await readdir(outputDirectory)).toSorted();
  if (
    !exactJson(inventory, expectedInventory) ||
    inventory.length !== 3 + 3 * manifest.candidateCount ||
    inventory.length !== manifest.inventory.expectedFileCount
  ) {
    throw new TypeError('SAM corpus artifact inventory differs from the dynamic 3 + 3N rule.');
  }

  const sourceBytes = await readRegularArtifact(outputDirectory, manifest.source.filename);
  assertArtifactMetadata(sourceBytes, manifest.source);
  if (
    sourceBytes.byteLength !== entry.normalized.byteLength ||
    sha256(sourceBytes) !== entry.normalized.sha256
  ) {
    throw new TypeError('SAM corpus source artifact differs from the immutable fixture.');
  }
  const sourceRgba = await sharp(sourceBytes, { failOn: 'error', limitInputPixels: 16_777_216 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    sourceRgba.info.width !== entry.normalized.width ||
    sourceRgba.info.height !== entry.normalized.height ||
    sourceRgba.info.channels !== 4
  ) {
    throw new TypeError('SAM corpus source decode differs from its immutable dimensions.');
  }

  const responseBytes = await readRegularArtifact(
    outputDirectory,
    manifest.sanitizedResponse.filename,
  );
  assertArtifactMetadata(responseBytes, manifest.sanitizedResponse);
  const responseText = new TextDecoder('utf-8', { fatal: true }).decode(responseBytes);
  let responseInput: unknown;
  try {
    responseInput = JSON.parse(responseText);
  } catch {
    throw new TypeError('SAM corpus sanitized response is not strict JSON.');
  }
  const sanitizedResponse = SamCorpusSanitizedResponseV2Schema.parse(responseInput);
  if (
    sanitizedResponse.requestId !== entry.identifiers.requestId ||
    sanitizedResponse.workspaceId !== entry.identifiers.workspaceId ||
    sanitizedResponse.jobId !== entry.identifiers.jobId ||
    sanitizedResponse.attemptId !== entry.identifiers.attemptId
  ) {
    throw new TypeError(
      'SAM corpus sanitized response differs from its frozen request identifiers.',
    );
  }
  if (
    responseText !== `${canonicalizeJson(sanitizedResponse)}\n` ||
    /(?:pngBase64|dataBase64|authorizationId|RUNPOD_API_KEY|Bearer\s)/u.test(responseText) ||
    sanitizedResponse.fixtureId !== entry.fixtureId ||
    sanitizedResponse.sourceSha256 !== entry.normalized.sha256 ||
    sanitizedResponse.validatedResponseSha256 !== manifest.validatedResponseSha256 ||
    sanitizedResponse.candidateCount !== manifest.candidateCount ||
    !exactJson(sanitizedResponse.executionIdentity, expectedActualIdentity) ||
    !exactJson(sanitizedResponse.candidates, manifest.candidates.map(candidateWithoutArtifacts))
  ) {
    throw new TypeError('SAM corpus sanitized response binding or redaction drifted.');
  }

  const reconstructedRequest = SamMaskRequestSchema.parse({
    contractVersion: SAM_MASK_CONTRACT_VERSION,
    ...entry.identifiers,
    source: {
      mediaType: 'image/png',
      byteSize: entry.normalized.byteLength,
      width: entry.normalized.width,
      height: entry.normalized.height,
      sha256: entry.normalized.sha256,
      pngBase64: sourceBytes.toString('base64'),
    },
    segmentation: { mode: 'automatic-candidates', prompt: { kind: 'none' } },
    limits: SAM_CORPUS_REQUEST_LIMITS,
    output: { maskEncoding: SAM_MASK_ENCODING },
  });

  const nonManifestArtifacts: PendingArtifactV2[] = [
    Object.freeze({
      filename: manifest.source.filename,
      bytes: Uint8Array.from(sourceBytes),
      dimensions: manifest.source.dimensions,
    }),
    Object.freeze({
      filename: manifest.sanitizedResponse.filename,
      bytes: Uint8Array.from(responseBytes),
    }),
  ];
  const reconstructedCandidates: SamMaskCandidate[] = [];
  const reconstructedRawCandidates: SamRawMaskCandidate[] = [];
  for (const candidate of manifest.candidates) {
    const maskBytes = await readRegularArtifact(outputDirectory, candidate.artifacts.mask.filename);
    const cutoutBytes = await readRegularArtifact(
      outputDirectory,
      candidate.artifacts.cutout.filename,
    );
    const overlayBytes = await readRegularArtifact(
      outputDirectory,
      candidate.artifacts.overlay.filename,
    );
    assertArtifactMetadata(maskBytes, candidate.artifacts.mask);
    assertArtifactMetadata(cutoutBytes, candidate.artifacts.cutout);
    assertArtifactMetadata(overlayBytes, candidate.artifacts.overlay);
    const mask = await sharp(maskBytes, { failOn: 'error' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (
      mask.info.width !== entry.normalized.width ||
      mask.info.height !== entry.normalized.height ||
      mask.info.channels !== 1 ||
      mask.data.some((pixel) => pixel !== 0 && pixel !== 255)
    ) {
      throw new TypeError('SAM corpus mask pixels or dimensions drifted.');
    }
    const maskPixels = Uint8Array.from(mask.data, (pixel) => (pixel === 255 ? 1 : 0));
    const bounds = deriveMaskPixelBounds(
      maskPixels,
      entry.normalized.width,
      entry.normalized.height,
    );
    const maskDigest = maskContentSha256(
      maskPixels,
      entry.normalized.width,
      entry.normalized.height,
    );
    const canonicalRle = encodeBinaryMaskRle(
      maskPixels,
      entry.normalized.width,
      entry.normalized.height,
    );
    const expectedAreaRatioBps = Math.floor(
      (bounds.area * 10_000) / (entry.normalized.width * entry.normalized.height),
    );
    if (
      candidate.mask.width !== entry.normalized.width ||
      candidate.mask.height !== entry.normalized.height ||
      candidate.mask.encodedByteLength !== canonicalRle.byteLength ||
      candidate.areaRatioBps !== expectedAreaRatioBps
    ) {
      throw new TypeError(
        'SAM corpus candidate dimensions, canonical RLE length, or area ratio drifted.',
      );
    }
    if (
      bounds.area !== candidate.pixelArea ||
      maskDigest !== candidate.mask.contentSha256 ||
      candidate.candidateId !==
        deriveSamCandidateId({
          sourceSha256: entry.normalized.sha256,
          width: entry.normalized.width,
          height: entry.normalized.height,
          maskSha256: maskDigest,
        }) ||
      !exactJson(candidate.boundsPixels, {
        left: bounds.left,
        top: bounds.top,
        rightExclusive: bounds.rightExclusive,
        bottomExclusive: bounds.bottomExclusive,
      }) ||
      !exactJson(
        candidate.boundsBasisPoints,
        pixelBoundsToBasisPoints(bounds, entry.normalized.width, entry.normalized.height),
      )
    ) {
      throw new TypeError('SAM corpus mask content differs from candidate geometry.');
    }
    reconstructedCandidates.push(
      Object.freeze({
        candidateId: candidate.candidateId,
        bounds: candidate.boundsBasisPoints,
        pixelArea: candidate.pixelArea,
        areaRatioBps: candidate.areaRatioBps,
        predictedIouBps: candidate.predictedIouBps,
        stabilityScoreBps: candidate.stabilityScoreBps,
        mask: Object.freeze({
          encoding: candidate.mask.encoding,
          width: entry.normalized.width,
          height: entry.normalized.height,
          byteSize: canonicalRle.byteLength,
          dataBase64: encodeCanonicalBase64(canonicalRle),
          sha256: maskDigest,
        }),
        reviewFlags: candidate.reviewFlags,
      }),
    );
    reconstructedRawCandidates.push(
      Object.freeze({
        mask: maskPixels,
        predictedIou: candidate.predictedIouBps / 10_000,
        stabilityScore: candidate.stabilityScoreBps / 10_000,
      }),
    );
    const cutout = await sharp(cutoutBytes, { failOn: 'error' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const cropWidth = bounds.rightExclusive - bounds.left;
    const cropHeight = bounds.bottomExclusive - bounds.top;
    if (
      cutout.info.width !== cropWidth ||
      cutout.info.height !== cropHeight ||
      cutout.info.channels !== 4
    ) {
      throw new TypeError('SAM corpus cutout dimensions drifted.');
    }
    for (let y = 0; y < cropHeight; y += 1) {
      for (let x = 0; x < cropWidth; x += 1) {
        const sourcePixel = (bounds.top + y) * entry.normalized.width + bounds.left + x;
        const sourceOffset = sourcePixel * 4;
        const cutoutOffset = (y * cropWidth + x) * 4;
        const selected = maskPixels[sourcePixel] === 1 && sourceRgba.data[sourceOffset + 3] !== 0;
        for (let channel = 0; channel < 4; channel += 1) {
          const expected = selected ? sourceRgba.data[sourceOffset + channel]! : 0;
          if (cutout.data[cutoutOffset + channel] !== expected) {
            throw new TypeError('SAM corpus cutout RGB or alpha relationship drifted.');
          }
        }
      }
    }
    const expectedOverlay = await renderOverlay({
      sourceBytes,
      mask: maskPixels,
      width: entry.normalized.width,
      height: entry.normalized.height,
    });
    if (!Buffer.from(expectedOverlay).equals(overlayBytes)) {
      throw new TypeError('SAM corpus overlay is not deterministically reproducible.');
    }
    nonManifestArtifacts.push(
      Object.freeze({
        filename: candidate.artifacts.mask.filename,
        bytes: Uint8Array.from(maskBytes),
        dimensions: candidate.artifacts.mask.dimensions,
      }),
      Object.freeze({
        filename: candidate.artifacts.cutout.filename,
        bytes: Uint8Array.from(cutoutBytes),
        dimensions: candidate.artifacts.cutout.dimensions,
      }),
      Object.freeze({
        filename: candidate.artifacts.overlay.filename,
        bytes: Uint8Array.from(overlayBytes),
        dimensions: candidate.artifacts.overlay.dimensions,
      }),
    );
  }
  if (
    [...reconstructedCandidates]
      .sort(compareSamCandidates)
      .some((candidate, index) => candidate !== reconstructedCandidates[index])
  ) {
    throw new TypeError('SAM corpus reconstructed candidates are not canonically ordered.');
  }
  const postprocessed = postprocessSamMasks(reconstructedRequest, reconstructedRawCandidates);
  if (
    postprocessed.candidates.length !== reconstructedCandidates.length ||
    postprocessed.candidates.some(
      (candidate, index) =>
        !exactJson(candidate.reviewFlags, reconstructedCandidates[index]?.reviewFlags),
    )
  ) {
    throw new TypeError('SAM corpus candidate review flags are not exactly reproducible.');
  }
  if (
    postprocessed.candidates.some(
      (candidate, index) => !exactJson(candidate, reconstructedCandidates[index]),
    )
  ) {
    throw new TypeError('SAM corpus candidate metadata is not canonically reproducible.');
  }
  const reconstructedUnsignedResponse: Omit<SamMaskResponse, 'responseSha256'> = {
    contractVersion: SAM_MASK_CONTRACT_VERSION,
    requestId: sanitizedResponse.requestId,
    workspaceId: sanitizedResponse.workspaceId,
    jobId: sanitizedResponse.jobId,
    attemptId: sanitizedResponse.attemptId,
    sourceSha256: sanitizedResponse.sourceSha256,
    executionIdentity: sanitizedResponse.executionIdentity,
    timing: sanitizedResponse.timing,
    filterSummary: sanitizedResponse.filterSummary,
    candidateCount: reconstructedCandidates.length,
    candidates: reconstructedCandidates,
  };
  if (
    canonicalResponseSha256(reconstructedUnsignedResponse) !==
    sanitizedResponse.validatedResponseSha256
  ) {
    throw new TypeError(
      'SAM corpus validated response SHA-256 is not reproducible from artifacts.',
    );
  }
  parseAndVerifySamMaskResponse({
    response: {
      ...reconstructedUnsignedResponse,
      responseSha256: sanitizedResponse.validatedResponseSha256,
    },
    request: reconstructedRequest,
    expectedExecutionKind:
      manifest.outputClassification === 'fake-test-output' ? 'deterministic-fake' : 'meta-sam2.1',
  });
  if (inventoryDigest(nonManifestArtifacts) !== manifest.inventory.nonManifestSha256) {
    throw new TypeError('SAM corpus manifest-bound non-manifest inventory digest drifted.');
  }
  const allArtifacts = [
    ...nonManifestArtifacts,
    Object.freeze({ filename: 'manifest.json', bytes: Uint8Array.from(manifestBytes) }),
  ];
  const result = Object.freeze({
    manifest,
    manifestSha256: sha256(manifestBytes),
    sanitizedResponseSha256: sha256(responseBytes),
    inventorySha256: inventoryDigest(allArtifacts),
    inventory: Object.freeze(inventory),
    outputDirectory,
  });
  verifiedMaterializationStates.set(result, Object.freeze({ catalogEntry: entry }));
  return result;
};
