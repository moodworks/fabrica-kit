import { createHash } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { z } from 'zod';

import {
  SAM_MASK_CONTRACT_VERSION,
  SAM_MASK_ENCODING,
  type SamMaskCandidate,
  type SamMaskResponse,
} from '../sam/sam-mask-contracts.js';
import { materializeSamMaskCutout } from '../sam/sam-cutout-materializer.js';
import {
  canonicalResponseSha256,
  compareSamCandidates,
  decodeBinaryMaskRle,
  decodeCanonicalBase64,
  deriveMaskPixelBounds,
  deriveSamCandidateId,
  maskContentSha256,
  pixelBoundsToBasisPoints,
} from '../sam/sam-mask-rle.js';
import {
  assertSamMaskResponseWasStrictlyValidated,
  parseAndVerifySamMaskRequest,
} from '../sam/sam-mask-validation.js';
import {
  inspectPngContainer,
  parsePngChunks,
  stripPngAncillaryChunks,
} from '../security/raster-container.js';
import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import { SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY } from './sam-runpod-direct-v3-deterministic-fake-transport.js';
import {
  SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3_SHA256,
  SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V3_SHA256,
  SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
} from './sam-runpod-direct-v3-profiles.js';
import {
  SAM_FIRST_INFERENCE_CANONICAL_REQUEST_SHA256,
  SAM_FIRST_INFERENCE_ENDPOINT_ID,
  SAM_FIRST_INFERENCE_ENDPOINT_VERSION,
  SAM_FIRST_INFERENCE_EXECUTION_IDENTITY,
  SAM_FIRST_INFERENCE_FIXTURE,
  SAM_FIRST_INFERENCE_REQUEST_LIMITS,
  SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
  assertSamFirstInferenceV3PreparedRequest,
  type SamRunPodDirectV3PreparedRequest,
} from './sam-runpod-direct-v3-request-preparation.js';

export const SAM_VISUAL_EVALUATION_MANIFEST_SCHEMA =
  'fabrica-sam-visual-evaluation-manifest' as const;
export const SAM_VISUAL_EVALUATION_MANIFEST_VERSION = 1 as const;
export const SAM_VISUAL_EVALUATION_FAKE_LABEL = 'FAKE TEST OUTPUT — NOT SAM OUTPUT' as const;
export const SAM_VISUAL_EVALUATION_REAL_LABEL = 'REAL SAM OUTPUT' as const;
export const SAM_VISUAL_EVALUATION_CANONICAL_REQUEST_BYTE_LENGTH = 322_024 as const;

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const FILE_NAME_PATTERN = /^[a-z0-9][a-z0-9.-]*$/u;
const PNG_OPTIONS = Object.freeze({
  compressionLevel: 9,
  adaptiveFiltering: false,
  palette: false,
  force: true,
} as const);
const repositoryRoot = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'),
);

const Sha256Schema = z.string().regex(SHA256_PATTERN);
const DimensionsSchema = z
  .strictObject({ width: z.int().min(1).max(4_096), height: z.int().min(1).max(4_096) })
  .readonly();
const ImageArtifactSchema = z
  .strictObject({
    filename: z.string().regex(FILE_NAME_PATTERN),
    byteLength: z.int().min(1),
    dimensions: DimensionsSchema,
    sha256: Sha256Schema,
  })
  .readonly();
const FileArtifactSchema = z
  .strictObject({
    filename: z.string().regex(FILE_NAME_PATTERN),
    byteLength: z.int().min(1),
    sha256: Sha256Schema,
  })
  .readonly();
const BasisBoundsSchema = z
  .strictObject({
    xBps: z.int().min(0).max(10_000),
    yBps: z.int().min(0).max(10_000),
    widthBps: z.int().min(1).max(10_000),
    heightBps: z.int().min(1).max(10_000),
  })
  .readonly();
const PixelBoundsSchema = z
  .strictObject({
    left: z.int().min(0),
    top: z.int().min(0),
    rightExclusive: z.int().min(1),
    bottomExclusive: z.int().min(1),
  })
  .readonly();
const TargetExecutionIdentitySchema = z
  .strictObject({
    kind: z.literal('meta-sam2.1'),
    repositoryCommit: z.literal(SAM_FIRST_INFERENCE_EXECUTION_IDENTITY.repositoryCommit),
    modelId: z.literal(SAM_FIRST_INFERENCE_EXECUTION_IDENTITY.modelId),
    configIdentity: z.literal(SAM_FIRST_INFERENCE_EXECUTION_IDENTITY.configIdentity),
    checkpointSha256: z.literal(SAM_FIRST_INFERENCE_EXECUTION_IDENTITY.checkpointSha256),
    workerImageDigest: z.literal(SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST),
  })
  .readonly();
const FakeExecutionIdentitySchema = z
  .strictObject({
    kind: z.literal('deterministic-fake'),
    engineId: z.literal(SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY.engineId),
    definitionSha256: z.literal(SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY.definitionSha256),
    notice: z.literal('NOT_SAM_OUTPUT'),
  })
  .readonly();
const ActualLiveExecutionIdentitySchema = TargetExecutionIdentitySchema;

const ManifestCandidateSchema = z
  .strictObject({
    order: z.int().min(1).max(SAM_FIRST_INFERENCE_REQUEST_LIMITS.maxCandidates),
    candidateId: z.string().regex(/^samc_v1_[0-9a-f]{64}$/u),
    score: z
      .strictObject({
        predictedIouBps: z.int().min(0).max(10_000),
        stabilityScoreBps: z.int().min(0).max(10_000),
      })
      .readonly(),
    pixelArea: z.int().min(SAM_FIRST_INFERENCE_REQUEST_LIMITS.minMaskAreaPixels),
    boundsBasisPoints: BasisBoundsSchema,
    boundsPixels: PixelBoundsSchema,
    maskContentSha256: Sha256Schema,
    reviewFlags: z
      .array(z.enum(['near-contained', 'overlapping', 'touches-source-edge']))
      .max(3)
      .readonly(),
    artifacts: z
      .strictObject({
        mask: ImageArtifactSchema,
        cutout: ImageArtifactSchema,
        overlay: ImageArtifactSchema,
      })
      .readonly(),
  })
  .readonly();

export const SamVisualEvaluationManifestV1Schema = z
  .strictObject({
    schema: z.literal(SAM_VISUAL_EVALUATION_MANIFEST_SCHEMA),
    version: z.literal(SAM_VISUAL_EVALUATION_MANIFEST_VERSION),
    outputClassification: z.enum(['fake-test-output', 'real-sam-output']),
    label: z.enum([SAM_VISUAL_EVALUATION_FAKE_LABEL, SAM_VISUAL_EVALUATION_REAL_LABEL]),
    fixture: z
      .strictObject({
        fixtureId: z.literal(SAM_FIRST_INFERENCE_FIXTURE.fixtureId),
        byteLength: z.literal(SAM_FIRST_INFERENCE_FIXTURE.byteSize),
        dimensions: z
          .strictObject({
            width: z.literal(SAM_FIRST_INFERENCE_FIXTURE.width),
            height: z.literal(SAM_FIRST_INFERENCE_FIXTURE.height),
          })
          .readonly(),
        sha256: z.literal(SAM_FIRST_INFERENCE_FIXTURE.sha256),
      })
      .readonly(),
    canonicalRequest: z
      .strictObject({
        byteLength: z.literal(SAM_VISUAL_EVALUATION_CANONICAL_REQUEST_BYTE_LENGTH),
        sha256: z.literal(SAM_FIRST_INFERENCE_CANONICAL_REQUEST_SHA256),
      })
      .readonly(),
    validatedResponseSha256: Sha256Schema,
    sanitizedResponseSha256: Sha256Schema,
    identities: z
      .strictObject({
        endpointId: z.literal(SAM_FIRST_INFERENCE_ENDPOINT_ID),
        endpointVersion: z.literal(SAM_FIRST_INFERENCE_ENDPOINT_VERSION),
        contractVersion: z.literal(SAM_MASK_CONTRACT_VERSION),
        maskEncoding: z.literal(SAM_MASK_ENCODING),
        targetExecution: TargetExecutionIdentitySchema,
        actualExecution: z.union([FakeExecutionIdentitySchema, ActualLiveExecutionIdentitySchema]),
        profiles: z
          .strictObject({
            hostingSha256: z.literal(SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256),
            adapterV3Sha256: z.literal(SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3_SHA256),
            authorizationV3Sha256: z.literal(SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V3_SHA256),
          })
          .readonly(),
      })
      .readonly(),
    candidateCount: z.int().min(0).max(SAM_FIRST_INFERENCE_REQUEST_LIMITS.maxCandidates),
    source: ImageArtifactSchema,
    candidates: z
      .array(ManifestCandidateSchema)
      .max(SAM_FIRST_INFERENCE_REQUEST_LIMITS.maxCandidates)
      .readonly(),
    report: FileArtifactSchema,
  })
  .superRefine((manifest, context) => {
    const fake = manifest.outputClassification === 'fake-test-output';
    if (
      manifest.label !==
        (fake ? SAM_VISUAL_EVALUATION_FAKE_LABEL : SAM_VISUAL_EVALUATION_REAL_LABEL) ||
      manifest.identities.actualExecution.kind !== (fake ? 'deterministic-fake' : 'meta-sam2.1') ||
      manifest.candidateCount !== manifest.candidates.length ||
      manifest.source.filename !== 'source.png' ||
      manifest.report.filename !== 'index.html'
    ) {
      context.addIssue({ code: 'custom', message: 'Visual manifest identity or count drifted.' });
    }
    for (const [index, candidate] of manifest.candidates.entries()) {
      const number = String(index + 1).padStart(2, '0');
      if (
        candidate.order !== index + 1 ||
        candidate.artifacts.mask.filename !== `candidate-${number}-mask.png` ||
        candidate.artifacts.cutout.filename !== `candidate-${number}-cutout.png` ||
        candidate.artifacts.overlay.filename !== `candidate-${number}-overlay.png`
      ) {
        context.addIssue({ code: 'custom', message: 'Visual candidate filenames drifted.' });
      }
    }
  })
  .readonly();

export type SamVisualEvaluationManifestV1 = z.infer<typeof SamVisualEvaluationManifestV1Schema>;
export type SamVisualEvaluationOutputClassification =
  SamVisualEvaluationManifestV1['outputClassification'];

interface DecodedCandidate {
  readonly candidate: SamMaskCandidate;
  readonly pixels: Uint8Array;
  readonly bounds: ReturnType<typeof deriveMaskPixelBounds>;
}

interface ValidatedVisualState {
  readonly prepared: SamRunPodDirectV3PreparedRequest;
  readonly response: SamMaskResponse;
  readonly sourceBytes: Uint8Array;
  readonly outputClassification: SamVisualEvaluationOutputClassification;
  readonly decodedCandidates: readonly DecodedCandidate[];
}

export interface SamVisualEvaluationValidatedResponseV1 {
  readonly purpose: 'strictly-validated-sam-visual-evaluation-v1';
  readonly outputClassification: SamVisualEvaluationOutputClassification;
  readonly candidateCount: number;
}

const validatedVisualStates = new WeakMap<object, ValidatedVisualState>();
const boundResponses = new WeakSet<object>();
const consumedVisualCapabilities = new WeakSet<object>();

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const exactJson = (left: unknown, right: unknown): boolean =>
  canonicalizeJson(left) === canonicalizeJson(right);

const sanitizedLiveIdentity = (): z.infer<typeof TargetExecutionIdentitySchema> => ({
  kind: 'meta-sam2.1',
  repositoryCommit: SAM_FIRST_INFERENCE_EXECUTION_IDENTITY.repositoryCommit,
  modelId: SAM_FIRST_INFERENCE_EXECUTION_IDENTITY.modelId,
  configIdentity: SAM_FIRST_INFERENCE_EXECUTION_IDENTITY.configIdentity,
  checkpointSha256: SAM_FIRST_INFERENCE_EXECUTION_IDENTITY.checkpointSha256,
  workerImageDigest: SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
});

export const validateSamVisualEvaluationResponseV1 = (input: {
  readonly prepared: SamRunPodDirectV3PreparedRequest;
  readonly response: SamMaskResponse;
  readonly outputClassification: SamVisualEvaluationOutputClassification;
}): SamVisualEvaluationValidatedResponseV1 => {
  const prepared = assertSamFirstInferenceV3PreparedRequest(input.prepared);
  const expectedExecutionKind =
    input.outputClassification === 'fake-test-output' ? 'deterministic-fake' : 'meta-sam2.1';
  const response = assertSamMaskResponseWasStrictlyValidated({
    response: input.response,
    request: prepared.request,
    expectedExecutionKind,
  });
  if (boundResponses.has(response)) {
    throw new TypeError('This strictly validated SAM response is already bound for output.');
  }
  if (
    prepared.canonicalBodyByteLength !== SAM_VISUAL_EVALUATION_CANONICAL_REQUEST_BYTE_LENGTH ||
    prepared.canonicalBodySha256 !== SAM_FIRST_INFERENCE_CANONICAL_REQUEST_SHA256 ||
    response.requestId !== prepared.request.requestId ||
    response.workspaceId !== prepared.request.workspaceId ||
    response.jobId !== prepared.request.jobId ||
    response.attemptId !== prepared.request.attemptId ||
    response.sourceSha256 !== SAM_FIRST_INFERENCE_FIXTURE.sha256 ||
    response.candidateCount !== response.candidates.length ||
    response.candidateCount !== response.filterSummary.returnedCandidateCount ||
    response.candidateCount > SAM_FIRST_INFERENCE_REQUEST_LIMITS.maxCandidates
  ) {
    throw new TypeError('SAM visual request, fixture, response, or candidate identity drifted.');
  }
  const { responseSha256, ...unsignedResponse } = response;
  if (canonicalResponseSha256(unsignedResponse) !== responseSha256) {
    throw new TypeError('SAM visual response digest drifted after strict validation.');
  }
  if (
    (expectedExecutionKind === 'deterministic-fake' &&
      !exactJson(response.executionIdentity, SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY)) ||
    (expectedExecutionKind === 'meta-sam2.1' &&
      !exactJson(response.executionIdentity, SAM_FIRST_INFERENCE_EXECUTION_IDENTITY))
  ) {
    throw new TypeError('SAM visual execution model or worker identity drifted.');
  }

  const decodedCandidates = response.candidates.map((candidate): DecodedCandidate => {
    const rle = decodeCanonicalBase64(candidate.mask.dataBase64, 1_000_000);
    if (rle.byteLength !== candidate.mask.byteSize) {
      throw new TypeError('SAM visual candidate encoded byte accounting drifted.');
    }
    const decoded = decodeBinaryMaskRle(
      rle,
      SAM_FIRST_INFERENCE_FIXTURE.width,
      SAM_FIRST_INFERENCE_FIXTURE.height,
    );
    if (decoded.pixels.some((pixel) => pixel !== 0 && pixel !== 1)) {
      throw new TypeError('SAM visual candidate contains a non-binary pixel.');
    }
    const bounds = deriveMaskPixelBounds(decoded.pixels, decoded.width, decoded.height);
    const maskSha256 = maskContentSha256(decoded.pixels, decoded.width, decoded.height);
    if (
      bounds.area !== candidate.pixelArea ||
      bounds.area < SAM_FIRST_INFERENCE_REQUEST_LIMITS.minMaskAreaPixels ||
      maskSha256 !== candidate.mask.sha256 ||
      candidate.candidateId !==
        deriveSamCandidateId({
          sourceSha256: SAM_FIRST_INFERENCE_FIXTURE.sha256,
          width: decoded.width,
          height: decoded.height,
          maskSha256,
        }) ||
      !exactJson(candidate.bounds, pixelBoundsToBasisPoints(bounds, decoded.width, decoded.height))
    ) {
      throw new TypeError('SAM visual candidate area, bounds, or mask identity drifted.');
    }
    return Object.freeze({
      candidate,
      pixels: Uint8Array.from(decoded.pixels),
      bounds: Object.freeze(bounds),
    });
  });
  const sorted = [...response.candidates].sort(compareSamCandidates);
  if (sorted.some((candidate, index) => candidate !== response.candidates[index])) {
    throw new TypeError('SAM visual candidate order is not authoritative and canonical.');
  }
  const { sourceBytes } = parseAndVerifySamMaskRequest(prepared.request);
  if (
    sourceBytes.byteLength !== SAM_FIRST_INFERENCE_FIXTURE.byteSize ||
    sha256(sourceBytes) !== SAM_FIRST_INFERENCE_FIXTURE.sha256
  ) {
    throw new TypeError('SAM visual source fixture identity drifted.');
  }
  const capability = Object.freeze({
    purpose: 'strictly-validated-sam-visual-evaluation-v1' as const,
    outputClassification: input.outputClassification,
    candidateCount: response.candidateCount,
  });
  validatedVisualStates.set(
    capability,
    Object.freeze({
      prepared: input.prepared,
      response,
      sourceBytes: Uint8Array.from(sourceBytes),
      outputClassification: input.outputClassification,
      decodedCandidates: Object.freeze(decodedCandidates),
    }),
  );
  boundResponses.add(response);
  return capability;
};

interface PendingArtifact {
  readonly filename: string;
  readonly bytes: Uint8Array;
}

interface SafeOutputTarget {
  readonly outputDirectory: string;
  readonly parentDirectory: string;
  readonly stagingDirectory: string;
  readonly existed: boolean;
}

interface TestOnlyWriteFaultState {
  readonly phase:
    'staging-write' | 'existing-output-publish' | 'existing-output-manifest-collision';
  readonly afterCount: number;
}

export interface SamVisualEvaluationTestOnlyWriteFaultV1 {
  readonly purpose: 'test-only-sam-visual-evaluation-write-fault-v1';
}

const testOnlyWriteFaultStates = new WeakMap<object, TestOnlyWriteFaultState>();

export const createTestOnlySamVisualEvaluationWriteFaultV1 = (input: {
  readonly phase: TestOnlyWriteFaultState['phase'];
  readonly afterCount: number;
}): SamVisualEvaluationTestOnlyWriteFaultV1 => {
  if (!Number.isSafeInteger(input.afterCount) || input.afterCount < 1) {
    throw new TypeError('SAM visual test fault count must be a positive safe integer.');
  }
  const fault = Object.freeze({
    purpose: 'test-only-sam-visual-evaluation-write-fault-v1' as const,
  });
  testOnlyWriteFaultStates.set(fault, Object.freeze({ ...input }));
  return fault;
};

export const escapeSamVisualEvaluationHtml = (input: string): string =>
  input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const assertPngBoundary = (
  bytes: Uint8Array,
  expectedWidth: number,
  expectedHeight: number,
): void => {
  const info = inspectPngContainer(bytes);
  const chunks = parsePngChunks(bytes);
  if (
    info.width !== expectedWidth ||
    info.height !== expectedHeight ||
    chunks.length < 3 ||
    chunks.some((chunk) => !['IHDR', 'IDAT', 'IEND'].includes(chunk.type))
  ) {
    throw new TypeError('SAM visual PNG dimensions or closed chunk profile drifted.');
  }
};

const imageArtifact = (
  filename: string,
  bytes: Uint8Array,
  width: number,
  height: number,
): z.infer<typeof ImageArtifactSchema> => {
  assertPngBoundary(bytes, width, height);
  return ImageArtifactSchema.parse({
    filename,
    byteLength: bytes.byteLength,
    dimensions: { width, height },
    sha256: sha256(bytes),
  });
};

const decodeTrustedSourceRgba = async (
  sourceBytes: Uint8Array,
): Promise<{ readonly data: Uint8Array; readonly width: number; readonly height: number }> => {
  const decoded = await sharp(sourceBytes, {
    failOn: 'error',
    limitInputPixels: SAM_FIRST_INFERENCE_FIXTURE.width * SAM_FIRST_INFERENCE_FIXTURE.height,
  })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    decoded.info.width !== SAM_FIRST_INFERENCE_FIXTURE.width ||
    decoded.info.height !== SAM_FIRST_INFERENCE_FIXTURE.height ||
    decoded.info.channels !== 4
  ) {
    throw new TypeError('SAM visual normalized source pixels drifted.');
  }
  return {
    data: Uint8Array.from(decoded.data),
    width: decoded.info.width,
    height: decoded.info.height,
  };
};

const renderDeterministicOverlay = async (input: {
  readonly sourceRgba: Uint8Array;
  readonly mask: Uint8Array;
  readonly bounds: ReturnType<typeof deriveMaskPixelBounds>;
  readonly width: number;
  readonly height: number;
}): Promise<Uint8Array> => {
  if (
    input.sourceRgba.byteLength !== input.width * input.height * 4 ||
    input.mask.byteLength !== input.width * input.height
  ) {
    throw new TypeError('SAM visual overlay input dimensions drifted.');
  }
  const overlay = Buffer.alloc(input.width * input.height * 4);
  for (let pixel = 0; pixel < input.mask.length; pixel += 1) {
    const sourceOffset = pixel * 4;
    const alpha = input.sourceRgba[sourceOffset + 3]!;
    const inverseAlpha = 255 - alpha;
    const red = Math.floor(
      (input.sourceRgba[sourceOffset]! * alpha + 255 * inverseAlpha + 127) / 255,
    );
    const green = Math.floor(
      (input.sourceRgba[sourceOffset + 1]! * alpha + 255 * inverseAlpha + 127) / 255,
    );
    const blue = Math.floor(
      (input.sourceRgba[sourceOffset + 2]! * alpha + 255 * inverseAlpha + 127) / 255,
    );
    if (input.mask[pixel] === 1) {
      overlay[sourceOffset] = Math.floor((red + 255) / 2);
      overlay[sourceOffset + 1] = Math.floor(green / 2);
      overlay[sourceOffset + 2] = Math.floor((blue + 160) / 2);
    } else if (input.mask[pixel] === 0) {
      overlay[sourceOffset] = red;
      overlay[sourceOffset + 1] = green;
      overlay[sourceOffset + 2] = blue;
    } else {
      throw new TypeError('SAM visual overlay received a non-binary mask.');
    }
    overlay[sourceOffset + 3] = 255;
  }
  const borderThickness = 2;
  for (let y = input.bounds.top; y < input.bounds.bottomExclusive; y += 1) {
    for (let x = input.bounds.left; x < input.bounds.rightExclusive; x += 1) {
      const onBorder =
        x - input.bounds.left < borderThickness ||
        input.bounds.rightExclusive - 1 - x < borderThickness ||
        y - input.bounds.top < borderThickness ||
        input.bounds.bottomExclusive - 1 - y < borderThickness;
      if (!onBorder) continue;
      const offset = (y * input.width + x) * 4;
      overlay[offset] = 255;
      overlay[offset + 1] = 220;
      overlay[offset + 2] = 0;
      overlay[offset + 3] = 255;
    }
  }
  const encoded = await sharp(overlay, {
    raw: { width: input.width, height: input.height, channels: 4 },
  })
    .png(PNG_OPTIONS)
    .toBuffer();
  const png = stripPngAncillaryChunks(encoded);
  assertPngBoundary(png, input.width, input.height);
  return Uint8Array.from(png);
};

const targetExecutionIdentity = (): z.infer<typeof TargetExecutionIdentitySchema> =>
  TargetExecutionIdentitySchema.parse(sanitizedLiveIdentity());

const actualExecutionIdentity = (
  response: SamMaskResponse,
): z.infer<typeof FakeExecutionIdentitySchema> | z.infer<typeof TargetExecutionIdentitySchema> =>
  response.executionIdentity.kind === 'deterministic-fake'
    ? FakeExecutionIdentitySchema.parse(response.executionIdentity)
    : TargetExecutionIdentitySchema.parse({
        kind: response.executionIdentity.kind,
        repositoryCommit: response.executionIdentity.repositoryCommit,
        modelId: response.executionIdentity.modelId,
        configIdentity: response.executionIdentity.configIdentity,
        checkpointSha256: response.executionIdentity.checkpointSha256,
        workerImageDigest: response.executionIdentity.workerImageDigest,
      });

const sanitizedResponsePayload = (input: {
  readonly manifestCandidates: readonly z.infer<typeof ManifestCandidateSchema>[];
  readonly validatedResponseSha256: string;
  readonly actualExecution: ReturnType<typeof actualExecutionIdentity>;
}): unknown => ({
  contractVersion: SAM_MASK_CONTRACT_VERSION,
  sourceSha256: SAM_FIRST_INFERENCE_FIXTURE.sha256,
  validatedResponseSha256: input.validatedResponseSha256,
  executionIdentity: input.actualExecution,
  candidateCount: input.manifestCandidates.length,
  candidates: input.manifestCandidates.map((candidate) => ({
    order: candidate.order,
    candidateId: candidate.candidateId,
    score: candidate.score,
    pixelArea: candidate.pixelArea,
    boundsBasisPoints: candidate.boundsBasisPoints,
    boundsPixels: candidate.boundsPixels,
    maskContentSha256: candidate.maskContentSha256,
    reviewFlags: candidate.reviewFlags,
  })),
});

const abbreviatedHash = (hash: string): string => hash.slice(0, 12);

const renderReportHtml = (input: {
  readonly classification: SamVisualEvaluationOutputClassification;
  readonly candidates: readonly z.infer<typeof ManifestCandidateSchema>[];
  readonly source: z.infer<typeof ImageArtifactSchema>;
}): string => {
  const label =
    input.classification === 'fake-test-output'
      ? SAM_VISUAL_EVALUATION_FAKE_LABEL
      : SAM_VISUAL_EVALUATION_REAL_LABEL;
  const sourceOverview = `<section><h2>Normalized source</h2><figure><img src="${escapeSamVisualEvaluationHtml(input.source.filename)}" alt="${escapeSamVisualEvaluationHtml(`${label}: normalized source`)}"><figcaption>Normalized source · sha256 ${abbreviatedHash(input.source.sha256)}</figcaption></figure></section>`;
  const rows = input.candidates
    .map((candidate) => {
      const bounds = escapeSamVisualEvaluationHtml(canonicalizeJson(candidate.boundsBasisPoints));
      const score = `${(candidate.score.predictedIouBps / 100).toFixed(2)}% predicted IoU; ${(candidate.score.stabilityScoreBps / 100).toFixed(2)}% stability`;
      const figure = (
        artifact: z.infer<typeof ImageArtifactSchema>,
        title: string,
        cssClass = '',
      ): string =>
        `<figure class="${cssClass}"><img src="${escapeSamVisualEvaluationHtml(artifact.filename)}" alt="${escapeSamVisualEvaluationHtml(`${label}: candidate ${candidate.order} ${title}`)}"><figcaption>${escapeSamVisualEvaluationHtml(title)} · sha256 ${abbreviatedHash(artifact.sha256)}</figcaption></figure>`;
      return `<section><h2>Candidate ${candidate.order.toString().padStart(2, '0')}</h2><p><code>${escapeSamVisualEvaluationHtml(candidate.candidateId)}</code></p><p>${escapeSamVisualEvaluationHtml(score)} · area ${candidate.pixelArea} px · bounds ${bounds}</p><div class="comparison">${figure(input.source, 'Normalized source')}${figure(candidate.artifacts.mask, 'Binary mask')}${figure(candidate.artifacts.cutout, 'Transparent cutout', 'checker')}${figure(candidate.artifacts.overlay, 'Highlighted overlay')}</div></section>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeSamVisualEvaluationHtml(label)}</title><style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;padding:2rem;font:15px/1.5 system-ui,sans-serif;background:#101218;color:#f3f4f8}main{max-width:1500px;margin:auto}header{border:3px solid #ff4da6;padding:1rem 1.25rem;background:#281326}h1{margin:.1rem 0;color:#ff83c3}section{margin:1.5rem 0;padding:1rem;background:#181b24;border:1px solid #343949}code{overflow-wrap:anywhere}.comparison{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem}figure{margin:0;padding:.75rem;background:#222733;min-width:0}img{display:block;width:100%;height:240px;object-fit:contain}.checker{background-color:#fff;background-image:linear-gradient(45deg,#ccc 25%,transparent 25%),linear-gradient(-45deg,#ccc 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#ccc 75%),linear-gradient(-45deg,transparent 75%,#ccc 75%);background-size:20px 20px;background-position:0 0,0 10px,10px -10px,-10px 0}figcaption{margin-top:.5rem;font-size:.82rem;overflow-wrap:anywhere}@media(max-width:900px){.comparison{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:520px){.comparison{grid-template-columns:1fr}body{padding:.75rem}}
</style></head><body><main><header><h1>${escapeSamVisualEvaluationHtml(label)}</h1><p>${input.classification === 'fake-test-output' ? 'Provider-free deterministic test masks. No SAM model, native transport, provider, or network ran.' : 'Strictly validated output from the separately authorized SAM visual-quality call.'}</p><p>Target model: <code>${escapeSamVisualEvaluationHtml(SAM_FIRST_INFERENCE_EXECUTION_IDENTITY.modelId)}</code> · worker: <code>${escapeSamVisualEvaluationHtml(SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST)}</code></p></header>${sourceOverview}${rows}</main></body></html>
`;
};

const buildArtifacts = async (
  state: ValidatedVisualState,
): Promise<{
  readonly manifest: SamVisualEvaluationManifestV1;
  readonly artifacts: readonly PendingArtifact[];
}> => {
  const sourceBefore = sha256(state.sourceBytes);
  const sourceRgba = await decodeTrustedSourceRgba(state.sourceBytes);
  const sourceArtifact = imageArtifact(
    'source.png',
    state.sourceBytes,
    sourceRgba.width,
    sourceRgba.height,
  );
  const pending: PendingArtifact[] = [
    Object.freeze({ filename: sourceArtifact.filename, bytes: state.sourceBytes }),
  ];
  const manifestCandidates: z.infer<typeof ManifestCandidateSchema>[] = [];
  for (const [index, decoded] of state.decodedCandidates.entries()) {
    const number = String(index + 1).padStart(2, '0');
    const materialized = await materializeSamMaskCutout({
      trustedRequest: state.prepared.request,
      candidate: decoded.candidate,
    });
    if (
      materialized.metadata.candidateId !== decoded.candidate.candidateId ||
      materialized.metadata.maskSha256 !== decoded.candidate.mask.sha256 ||
      materialized.metadata.crop.left !== decoded.bounds.left ||
      materialized.metadata.crop.top !== decoded.bounds.top ||
      materialized.metadata.crop.width !== decoded.bounds.rightExclusive - decoded.bounds.left ||
      materialized.metadata.crop.height !== decoded.bounds.bottomExclusive - decoded.bounds.top
    ) {
      throw new TypeError('Canonical SAM cutout materialization geometry drifted.');
    }
    const maskFilename = `candidate-${number}-mask.png`;
    const cutoutFilename = `candidate-${number}-cutout.png`;
    const overlayFilename = `candidate-${number}-overlay.png`;
    const binaryMaskPng = stripPngAncillaryChunks(materialized.binaryMaskPng);
    const cutoutPng = stripPngAncillaryChunks(materialized.cutoutPng);
    const overlay = await renderDeterministicOverlay({
      sourceRgba: sourceRgba.data,
      mask: decoded.pixels,
      bounds: decoded.bounds,
      width: sourceRgba.width,
      height: sourceRgba.height,
    });
    const maskArtifact = imageArtifact(
      maskFilename,
      binaryMaskPng,
      sourceRgba.width,
      sourceRgba.height,
    );
    const cutoutArtifact = imageArtifact(
      cutoutFilename,
      cutoutPng,
      materialized.metadata.crop.width,
      materialized.metadata.crop.height,
    );
    const overlayArtifact = imageArtifact(
      overlayFilename,
      overlay,
      sourceRgba.width,
      sourceRgba.height,
    );
    pending.push(
      Object.freeze({ filename: maskFilename, bytes: binaryMaskPng }),
      Object.freeze({ filename: cutoutFilename, bytes: cutoutPng }),
      Object.freeze({ filename: overlayFilename, bytes: overlay }),
    );
    manifestCandidates.push(
      ManifestCandidateSchema.parse({
        order: index + 1,
        candidateId: decoded.candidate.candidateId,
        score: {
          predictedIouBps: decoded.candidate.predictedIouBps,
          stabilityScoreBps: decoded.candidate.stabilityScoreBps,
        },
        pixelArea: decoded.candidate.pixelArea,
        boundsBasisPoints: decoded.candidate.bounds,
        boundsPixels: {
          left: decoded.bounds.left,
          top: decoded.bounds.top,
          rightExclusive: decoded.bounds.rightExclusive,
          bottomExclusive: decoded.bounds.bottomExclusive,
        },
        maskContentSha256: decoded.candidate.mask.sha256,
        reviewFlags: decoded.candidate.reviewFlags,
        artifacts: {
          mask: maskArtifact,
          cutout: cutoutArtifact,
          overlay: overlayArtifact,
        },
      }),
    );
  }
  if (sha256(state.sourceBytes) !== sourceBefore) {
    throw new TypeError('SAM visual source bytes changed during artifact generation.');
  }
  const reportText = renderReportHtml({
    classification: state.outputClassification,
    candidates: manifestCandidates,
    source: sourceArtifact,
  });
  if (/<script\b|\b(?:https?:)?\/\/|\burl\s*\(/iu.test(reportText)) {
    throw new TypeError('SAM visual report contains a script or external reference.');
  }
  const reportBytes = Buffer.from(reportText, 'utf8');
  const actualExecution = actualExecutionIdentity(state.response);
  const sanitizedPayload = sanitizedResponsePayload({
    manifestCandidates,
    validatedResponseSha256: state.response.responseSha256,
    actualExecution,
  });
  const manifest = SamVisualEvaluationManifestV1Schema.parse({
    schema: SAM_VISUAL_EVALUATION_MANIFEST_SCHEMA,
    version: SAM_VISUAL_EVALUATION_MANIFEST_VERSION,
    outputClassification: state.outputClassification,
    label:
      state.outputClassification === 'fake-test-output'
        ? SAM_VISUAL_EVALUATION_FAKE_LABEL
        : SAM_VISUAL_EVALUATION_REAL_LABEL,
    fixture: {
      fixtureId: SAM_FIRST_INFERENCE_FIXTURE.fixtureId,
      byteLength: SAM_FIRST_INFERENCE_FIXTURE.byteSize,
      dimensions: {
        width: SAM_FIRST_INFERENCE_FIXTURE.width,
        height: SAM_FIRST_INFERENCE_FIXTURE.height,
      },
      sha256: SAM_FIRST_INFERENCE_FIXTURE.sha256,
    },
    canonicalRequest: {
      byteLength: SAM_VISUAL_EVALUATION_CANONICAL_REQUEST_BYTE_LENGTH,
      sha256: SAM_FIRST_INFERENCE_CANONICAL_REQUEST_SHA256,
    },
    validatedResponseSha256: state.response.responseSha256,
    sanitizedResponseSha256: sha256(Buffer.from(canonicalizeJson(sanitizedPayload), 'utf8')),
    identities: {
      endpointId: SAM_FIRST_INFERENCE_ENDPOINT_ID,
      endpointVersion: SAM_FIRST_INFERENCE_ENDPOINT_VERSION,
      contractVersion: SAM_MASK_CONTRACT_VERSION,
      maskEncoding: SAM_MASK_ENCODING,
      targetExecution: targetExecutionIdentity(),
      actualExecution,
      profiles: {
        hostingSha256: SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
        adapterV3Sha256: SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3_SHA256,
        authorizationV3Sha256: SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V3_SHA256,
      },
    },
    candidateCount: manifestCandidates.length,
    source: sourceArtifact,
    candidates: manifestCandidates,
    report: {
      filename: 'index.html',
      byteLength: reportBytes.byteLength,
      sha256: sha256(reportBytes),
    },
  });
  const manifestBytes = Buffer.from(`${canonicalizeJson(manifest)}\n`, 'utf8');
  const serializedText = Buffer.concat([reportBytes, manifestBytes]).toString('utf8');
  if (
    /(?:pngBase64|dataBase64|authorizationId|secretReferenceName|RUNPOD_API_KEY|Bearer\s|rawRequest|rawResponse)/u.test(
      serializedText,
    )
  ) {
    throw new TypeError('SAM visual sanitized output contains forbidden transport material.');
  }
  pending.push(
    Object.freeze({ filename: 'index.html', bytes: reportBytes }),
    Object.freeze({ filename: 'manifest.json', bytes: manifestBytes }),
  );
  return { manifest, artifacts: Object.freeze(pending) };
};

const isMissingPathError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const assertOutsideRepository = (path: string): void => {
  const fromRepository = relative(repositoryRoot, path);
  if (
    fromRepository === '' ||
    (fromRepository !== '..' &&
      !fromRepository.startsWith(`..${sep}`) &&
      !isAbsolute(fromRepository))
  ) {
    throw new TypeError('SAM visual output must remain outside the repository.');
  }
};

const inspectSafeOutputTarget = async (
  outputDirectory: string,
  classification: SamVisualEvaluationOutputClassification,
): Promise<SafeOutputTarget> => {
  if (
    typeof outputDirectory !== 'string' ||
    outputDirectory.includes('\0') ||
    outputDirectory.includes('\\') ||
    !isAbsolute(outputDirectory) ||
    normalize(outputDirectory) !== outputDirectory ||
    resolve(outputDirectory) !== outputDirectory
  ) {
    throw new TypeError('SAM visual output path must be exact, absolute, and unambiguous.');
  }
  const components = outputDirectory.slice(1).split(sep);
  if (
    components.length === 0 ||
    components.some((component) => component === '' || component === '.' || component === '..')
  ) {
    throw new TypeError('SAM visual output path contains traversal or an ambiguous component.');
  }
  const outputName = basename(outputDirectory);
  if (classification === 'fake-test-output' && !outputName.toLowerCase().includes('fake')) {
    throw new TypeError('A fake SAM visual output path must be clearly labeled as fake.');
  }
  const parentDirectory = dirname(outputDirectory);
  const parentStat = await lstat(parentDirectory);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new TypeError('SAM visual output parent must be a real directory.');
  }
  const physicalParent = await realpath(parentDirectory);
  if (physicalParent !== parentDirectory) {
    throw new TypeError('SAM visual output path cannot traverse a symbolic-link parent.');
  }
  const physicalOutput = join(physicalParent, outputName);
  assertOutsideRepository(physicalOutput);
  let existed = false;
  try {
    const outputStat = await lstat(physicalOutput);
    if (!outputStat.isDirectory() || outputStat.isSymbolicLink()) {
      throw new TypeError('SAM visual output must be absent or a real empty directory.');
    }
    if ((await realpath(physicalOutput)) !== physicalOutput) {
      throw new TypeError('SAM visual output directory cannot be symbolic or ambiguous.');
    }
    if ((await readdir(physicalOutput)).length !== 0) {
      throw new TypeError('SAM visual output directory must be empty and cannot be overwritten.');
    }
    existed = true;
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
  const stagingDirectory = `${physicalOutput}.fabrica-sam-visual-staging`;
  try {
    await lstat(stagingDirectory);
    throw new TypeError('SAM visual staging directory already exists.');
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }
  return Object.freeze({
    outputDirectory: physicalOutput,
    parentDirectory: physicalParent,
    stagingDirectory,
    existed,
  });
};

/** Read-only paid-call preflight; the writer repeats this check after the response. */
export const assertSamVisualEvaluationOutputDirectoryV1 = async (input: {
  readonly outputDirectory: string;
  readonly outputClassification: SamVisualEvaluationOutputClassification;
}): Promise<void> => {
  await inspectSafeOutputTarget(input.outputDirectory, input.outputClassification);
};

export interface SamVisualEvaluationMaterializationResultV1 {
  readonly manifest: SamVisualEvaluationManifestV1;
  readonly manifestSha256: string;
  readonly inventory: readonly string[];
  readonly outputDirectory: string;
}

const assertStagedBytes = async (
  directory: string,
  artifacts: readonly PendingArtifact[],
): Promise<void> => {
  const expected = artifacts.map((artifact) => artifact.filename).toSorted();
  if (!exactJson((await readdir(directory)).toSorted(), expected)) {
    throw new TypeError('SAM visual staged artifact inventory drifted.');
  }
  for (const artifact of artifacts) {
    const bytes = await readFile(join(directory, artifact.filename));
    if (!Buffer.from(bytes).equals(Buffer.from(artifact.bytes))) {
      throw new TypeError('SAM visual staged artifact bytes drifted.');
    }
  }
};

export const materializeSamVisualEvaluationV1 = async (input: {
  readonly validated: SamVisualEvaluationValidatedResponseV1;
  readonly outputDirectory: string;
  readonly testOnlyWriteFault?: SamVisualEvaluationTestOnlyWriteFaultV1;
}): Promise<SamVisualEvaluationMaterializationResultV1> => {
  const state = validatedVisualStates.get(input.validated);
  if (state === undefined || consumedVisualCapabilities.has(input.validated)) {
    throw new TypeError('SAM visual validation capability is foreign or already consumed.');
  }
  consumedVisualCapabilities.add(input.validated);
  let fault: TestOnlyWriteFaultState | undefined;
  if (input.testOnlyWriteFault !== undefined) {
    fault = testOnlyWriteFaultStates.get(input.testOnlyWriteFault);
    if (fault === undefined) {
      throw new TypeError('SAM visual test-only write fault is foreign or reconstructed.');
    }
  }
  const target = await inspectSafeOutputTarget(input.outputDirectory, state.outputClassification);
  const built = await buildArtifacts(state);
  if (built.artifacts.at(-1)?.filename !== 'manifest.json') {
    throw new TypeError('SAM visual manifest must be the final published artifact.');
  }
  let stagingCreated = false;
  let finalDirectoryCreated = false;
  const publishedIntoExisting: string[] = [];
  try {
    await mkdir(target.stagingDirectory, { mode: 0o700 });
    stagingCreated = true;
    let stagedCount = 0;
    for (const artifact of built.artifacts) {
      await writeFile(join(target.stagingDirectory, artifact.filename), artifact.bytes, {
        flag: 'wx',
        mode: 0o600,
      });
      stagedCount += 1;
      if (fault?.phase === 'staging-write' && stagedCount === fault.afterCount) {
        throw new TypeError('Injected deterministic SAM visual staging failure.');
      }
    }
    await assertStagedBytes(target.stagingDirectory, built.artifacts);
    const verified = await verifySamVisualEvaluationArtifactSetV1(target.stagingDirectory);
    if (!exactJson(verified.manifest, built.manifest)) {
      throw new TypeError('SAM visual staged manifest differs from generated content.');
    }
    const result = Object.freeze({
      manifest: verified.manifest,
      manifestSha256: verified.manifestSha256,
      inventory: verified.inventory,
      outputDirectory: target.outputDirectory,
    });
    if (target.existed) {
      const outputStat = await lstat(target.outputDirectory);
      if (
        !outputStat.isDirectory() ||
        outputStat.isSymbolicLink() ||
        (await readdir(target.outputDirectory)).length !== 0
      ) {
        throw new TypeError('SAM visual output changed after preflight.');
      }
      let publishedCount = 0;
      for (const artifact of built.artifacts.slice(0, -1)) {
        const destination = join(target.outputDirectory, artifact.filename);
        await link(join(target.stagingDirectory, artifact.filename), destination);
        publishedIntoExisting.push(destination);
        publishedCount += 1;
        if (fault?.phase === 'existing-output-publish' && publishedCount === fault.afterCount) {
          throw new TypeError('Injected deterministic SAM visual publish failure.');
        }
      }
      await rm(target.stagingDirectory, { recursive: true });
      stagingCreated = false;
      const manifestArtifact = built.artifacts.at(-1)!;
      const manifestDestination = join(target.outputDirectory, manifestArtifact.filename);
      if (fault?.phase === 'existing-output-manifest-collision') {
        await writeFile(manifestDestination, 'simulated-concurrent-manifest\n', {
          flag: 'wx',
          mode: 0o600,
        });
      }
      const manifestHandle = await open(manifestDestination, 'wx', 0o600);
      publishedIntoExisting.push(manifestDestination);
      try {
        await manifestHandle.writeFile(manifestArtifact.bytes);
      } finally {
        await manifestHandle.close();
      }
    } else {
      try {
        await lstat(target.outputDirectory);
        throw new TypeError('SAM visual output appeared after preflight.');
      } catch (error) {
        if (!isMissingPathError(error)) throw error;
      }
      await rename(target.stagingDirectory, target.outputDirectory);
      stagingCreated = false;
      finalDirectoryCreated = true;
    }
    return result;
  } catch (error) {
    for (const path of publishedIntoExisting.toReversed()) {
      try {
        await unlink(path);
      } catch {
        // Cleanup is restricted to files linked by this attempt.
      }
    }
    if (stagingCreated) {
      try {
        await rm(target.stagingDirectory, { recursive: true });
      } catch {
        // Cleanup is restricted to the staging directory created by this attempt.
      }
    }
    if (finalDirectoryCreated) {
      try {
        await rm(target.outputDirectory, { recursive: true });
      } catch {
        // Cleanup is restricted to the final directory created by this attempt.
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
    throw new TypeError('SAM visual completed output path is ambiguous.');
  }
  const parentDirectory = dirname(outputDirectory);
  const parentStat = await lstat(parentDirectory);
  if (
    !parentStat.isDirectory() ||
    parentStat.isSymbolicLink() ||
    (await realpath(parentDirectory)) !== parentDirectory
  ) {
    throw new TypeError('SAM visual completed output parent is symbolic or ambiguous.');
  }
  const physicalOutput = join(parentDirectory, basename(outputDirectory));
  assertOutsideRepository(physicalOutput);
  const outputStat = await lstat(physicalOutput);
  if (
    !outputStat.isDirectory() ||
    outputStat.isSymbolicLink() ||
    (await realpath(physicalOutput)) !== physicalOutput
  ) {
    throw new TypeError('SAM visual completed output must be a real directory.');
  }
  return physicalOutput;
};

const readRegularArtifact = async (directory: string, filename: string): Promise<Buffer> => {
  if (!FILE_NAME_PATTERN.test(filename)) {
    throw new TypeError('SAM visual artifact filename is unsafe.');
  }
  const path = join(directory, filename);
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new TypeError('SAM visual artifact must be a regular non-symlinked file.');
  }
  return readFile(path);
};

const assertArtifactMetadata = (
  bytes: Uint8Array,
  artifact: z.infer<typeof ImageArtifactSchema> | z.infer<typeof FileArtifactSchema>,
): void => {
  if (bytes.byteLength !== artifact.byteLength || sha256(bytes) !== artifact.sha256) {
    throw new TypeError('SAM visual artifact length or digest differs from its manifest.');
  }
  if ('dimensions' in artifact) {
    assertPngBoundary(bytes, artifact.dimensions.width, artifact.dimensions.height);
  }
};

const compareManifestCandidates = (
  left: z.infer<typeof ManifestCandidateSchema>,
  right: z.infer<typeof ManifestCandidateSchema>,
): number =>
  right.score.predictedIouBps - left.score.predictedIouBps ||
  right.score.stabilityScoreBps - left.score.stabilityScoreBps ||
  right.pixelArea - left.pixelArea ||
  left.boundsBasisPoints.yBps - right.boundsBasisPoints.yBps ||
  left.boundsBasisPoints.xBps - right.boundsBasisPoints.xBps ||
  left.boundsBasisPoints.widthBps - right.boundsBasisPoints.widthBps ||
  left.boundsBasisPoints.heightBps - right.boundsBasisPoints.heightBps ||
  (left.maskContentSha256 < right.maskContentSha256
    ? -1
    : left.maskContentSha256 > right.maskContentSha256
      ? 1
      : 0);

export interface SamVisualEvaluationVerificationResultV1 {
  readonly manifest: SamVisualEvaluationManifestV1;
  readonly manifestSha256: string;
  readonly inventory: readonly string[];
}

export const verifySamVisualEvaluationArtifactSetV1 = async (
  outputDirectoryInput: string,
): Promise<SamVisualEvaluationVerificationResultV1> => {
  const outputDirectory = await inspectCompletedOutputDirectory(outputDirectoryInput);
  const manifestBytes = await readRegularArtifact(outputDirectory, 'manifest.json');
  let manifestInput: unknown;
  try {
    manifestInput = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(manifestBytes));
  } catch {
    throw new TypeError('SAM visual manifest is not strict UTF-8 JSON.');
  }
  const manifest = SamVisualEvaluationManifestV1Schema.parse(manifestInput);
  if (
    !Buffer.from(manifestBytes).equals(Buffer.from(`${canonicalizeJson(manifest)}\n`, 'utf8')) ||
    (manifest.outputClassification === 'fake-test-output' &&
      !basename(outputDirectory).toLowerCase().includes('fake'))
  ) {
    throw new TypeError('SAM visual manifest serialization or output label drifted.');
  }
  const expectedInventory = [
    manifest.source.filename,
    ...manifest.candidates.flatMap((candidate) => [
      candidate.artifacts.mask.filename,
      candidate.artifacts.cutout.filename,
      candidate.artifacts.overlay.filename,
    ]),
    manifest.report.filename,
    'manifest.json',
  ].toSorted();
  const inventory = (await readdir(outputDirectory)).toSorted();
  if (!exactJson(inventory, expectedInventory)) {
    throw new TypeError('SAM visual artifact inventory differs from its strict manifest.');
  }

  const sourceBytes = await readRegularArtifact(outputDirectory, manifest.source.filename);
  assertArtifactMetadata(sourceBytes, manifest.source);
  if (
    sourceBytes.byteLength !== SAM_FIRST_INFERENCE_FIXTURE.byteSize ||
    sha256(sourceBytes) !== SAM_FIRST_INFERENCE_FIXTURE.sha256
  ) {
    throw new TypeError('SAM visual source artifact differs from the immutable fixture.');
  }
  const sourceRgba = await decodeTrustedSourceRgba(sourceBytes);
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
      mask.info.width !== SAM_FIRST_INFERENCE_FIXTURE.width ||
      mask.info.height !== SAM_FIRST_INFERENCE_FIXTURE.height ||
      mask.info.channels !== 1 ||
      mask.data.some((pixel) => pixel !== 0 && pixel !== 255)
    ) {
      throw new TypeError('SAM visual binary mask pixels or dimensions drifted.');
    }
    const maskPixels = Uint8Array.from(mask.data, (pixel) => (pixel === 255 ? 1 : 0));
    const bounds = deriveMaskPixelBounds(
      maskPixels,
      SAM_FIRST_INFERENCE_FIXTURE.width,
      SAM_FIRST_INFERENCE_FIXTURE.height,
    );
    const maskDigest = maskContentSha256(
      maskPixels,
      SAM_FIRST_INFERENCE_FIXTURE.width,
      SAM_FIRST_INFERENCE_FIXTURE.height,
    );
    if (
      bounds.area !== candidate.pixelArea ||
      maskDigest !== candidate.maskContentSha256 ||
      candidate.candidateId !==
        deriveSamCandidateId({
          sourceSha256: SAM_FIRST_INFERENCE_FIXTURE.sha256,
          width: SAM_FIRST_INFERENCE_FIXTURE.width,
          height: SAM_FIRST_INFERENCE_FIXTURE.height,
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
        pixelBoundsToBasisPoints(
          bounds,
          SAM_FIRST_INFERENCE_FIXTURE.width,
          SAM_FIRST_INFERENCE_FIXTURE.height,
        ),
      )
    ) {
      throw new TypeError('SAM visual mask content differs from candidate geometry.');
    }
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
      throw new TypeError('SAM visual cutout dimensions drifted.');
    }
    for (let y = 0; y < cropHeight; y += 1) {
      for (let x = 0; x < cropWidth; x += 1) {
        const sourcePixel = (bounds.top + y) * sourceRgba.width + bounds.left + x;
        const sourceOffset = sourcePixel * 4;
        const cutoutOffset = (y * cropWidth + x) * 4;
        const selected = maskPixels[sourcePixel] === 1 && sourceRgba.data[sourceOffset + 3] !== 0;
        for (let channel = 0; channel < 4; channel += 1) {
          const expected = selected ? sourceRgba.data[sourceOffset + channel]! : 0;
          if (cutout.data[cutoutOffset + channel] !== expected) {
            throw new TypeError('SAM visual cutout RGB or alpha semantics drifted.');
          }
        }
      }
    }
    const expectedOverlay = await renderDeterministicOverlay({
      sourceRgba: sourceRgba.data,
      mask: maskPixels,
      bounds,
      width: sourceRgba.width,
      height: sourceRgba.height,
    });
    if (!Buffer.from(expectedOverlay).equals(overlayBytes)) {
      throw new TypeError('SAM visual overlay is not deterministically reproducible.');
    }
  }
  const sortedCandidates = [...manifest.candidates].sort(compareManifestCandidates);
  if (sortedCandidates.some((candidate, index) => candidate !== manifest.candidates[index])) {
    throw new TypeError('SAM visual manifest candidate ordering drifted.');
  }
  const expectedSanitizedResponseSha256 = sha256(
    Buffer.from(
      canonicalizeJson(
        sanitizedResponsePayload({
          manifestCandidates: manifest.candidates,
          validatedResponseSha256: manifest.validatedResponseSha256,
          actualExecution: manifest.identities.actualExecution,
        }),
      ),
      'utf8',
    ),
  );
  if (manifest.sanitizedResponseSha256 !== expectedSanitizedResponseSha256) {
    throw new TypeError('SAM visual sanitized response digest drifted.');
  }
  const reportBytes = await readRegularArtifact(outputDirectory, manifest.report.filename);
  assertArtifactMetadata(reportBytes, manifest.report);
  const reportText = new TextDecoder('utf-8', { fatal: true }).decode(reportBytes);
  const expectedReportText = renderReportHtml({
    classification: manifest.outputClassification,
    candidates: manifest.candidates,
    source: manifest.source,
  });
  const expectedLabel =
    manifest.outputClassification === 'fake-test-output'
      ? SAM_VISUAL_EVALUATION_FAKE_LABEL
      : SAM_VISUAL_EVALUATION_REAL_LABEL;
  if (
    reportText !== expectedReportText ||
    !reportText.includes(expectedLabel) ||
    (manifest.outputClassification === 'fake-test-output' &&
      reportText.includes(SAM_VISUAL_EVALUATION_REAL_LABEL)) ||
    /<script\b|\b(?:https?:)?\/\/|\burl\s*\(|(?:pngBase64|dataBase64|authorizationId|RUNPOD_API_KEY|Bearer\s)/iu.test(
      reportText,
    )
  ) {
    throw new TypeError('SAM visual report labeling or local-only boundary drifted.');
  }
  return Object.freeze({
    manifest,
    manifestSha256: sha256(manifestBytes),
    inventory: Object.freeze(inventory),
  });
};
