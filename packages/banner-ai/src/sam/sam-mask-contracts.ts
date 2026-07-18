import { z } from 'zod';

export const SAM_MASK_CONTRACT_VERSION = 'sam-mask-v1' as const;
export const SAM_MASK_ENCODING = 'fabrica-binary-rle-v1' as const;

export const SAM_LIMITS = Object.freeze({
  sourcePngBytes: 12_000_000,
  sourceBase64Characters: 16_000_000,
  requestJsonBytes: 16_100_000,
  wrappedRequestJsonBytes: 16_100_128,
  sidePixels: 4_096,
  imagePixels: 16_777_216,
  rgbaBytes: 67_108_864,
  promptPoints: 32,
  rawCandidates: 512,
  rawMaskWorkingBytes: 268_435_456,
  returnedCandidates: 64,
  candidateRleBytes: 1_000_000,
  totalRleBytes: 8_000_000,
  responseJsonBytes: 12_000_000,
  providerEnvelopeBytes: 12_500_000,
});

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const UuidSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
const BasisPointSchema = z.int().min(0).max(10_000);
const PositiveBasisPointSchema = z.int().min(1).max(10_000);

export const SamSourceSchema = z
  .strictObject({
    mediaType: z.literal('image/png'),
    byteSize: z.int().min(1).max(SAM_LIMITS.sourcePngBytes),
    width: z.int().min(1).max(SAM_LIMITS.sidePixels),
    height: z.int().min(1).max(SAM_LIMITS.sidePixels),
    sha256: Sha256Schema,
    pngBase64: z.string().min(1).max(SAM_LIMITS.sourceBase64Characters),
  })
  .superRefine((source, context) => {
    if (
      source.width * source.height > SAM_LIMITS.imagePixels ||
      source.width * source.height * 4 > SAM_LIMITS.rgbaBytes
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Source decoded allocation exceeds SAM limits.',
      });
    }
  })
  .readonly();

export const SamTrustedPromptAuthoritySchema = z.enum([
  'server-validated-detector',
  'user-interaction',
]);

export const SamPointSchema = z
  .strictObject({
    xBps: BasisPointSchema,
    yBps: BasisPointSchema,
    polarity: z.enum(['positive', 'negative']),
  })
  .readonly();

const SamAutomaticSegmentationSchema = z
  .strictObject({
    mode: z.literal('automatic-candidates'),
    prompt: z.strictObject({ kind: z.literal('none') }).readonly(),
  })
  .readonly();

const SamPointSegmentationSchema = z
  .strictObject({
    mode: z.literal('point-prompt'),
    prompt: z
      .strictObject({
        kind: z.literal('points'),
        authority: SamTrustedPromptAuthoritySchema,
        points: z.array(SamPointSchema).min(1).max(SAM_LIMITS.promptPoints),
      })
      .superRefine((prompt, context) => {
        if (!prompt.points.some((point) => point.polarity === 'positive')) {
          context.addIssue({
            code: 'custom',
            message: 'Point prompting requires at least one positive point.',
          });
        }
      })
      .readonly(),
  })
  .readonly();

const SamBoxSchema = z
  .strictObject({
    xBps: BasisPointSchema,
    yBps: BasisPointSchema,
    widthBps: PositiveBasisPointSchema,
    heightBps: PositiveBasisPointSchema,
  })
  .superRefine((box, context) => {
    if (box.xBps + box.widthBps > 10_000 || box.yBps + box.heightBps > 10_000) {
      context.addIssue({ code: 'custom', message: 'Box prompt exceeds the source basis.' });
    }
  })
  .readonly();

const SamBoxSegmentationSchema = z
  .strictObject({
    mode: z.literal('box-prompt'),
    prompt: z
      .strictObject({
        kind: z.literal('box'),
        authority: SamTrustedPromptAuthoritySchema,
        box: SamBoxSchema,
      })
      .readonly(),
  })
  .readonly();

export const SamSegmentationSchema = z.discriminatedUnion('mode', [
  SamAutomaticSegmentationSchema,
  SamPointSegmentationSchema,
  SamBoxSegmentationSchema,
]);

export const SamMaskRequestSchema = z
  .strictObject({
    contractVersion: z.literal(SAM_MASK_CONTRACT_VERSION),
    requestId: UuidSchema,
    workspaceId: UuidSchema,
    jobId: UuidSchema,
    attemptId: UuidSchema,
    source: SamSourceSchema,
    segmentation: SamSegmentationSchema,
    limits: z
      .strictObject({
        minMaskAreaPixels: z.int().min(1).max(SAM_LIMITS.imagePixels),
        maxCandidates: z.int().min(1).max(SAM_LIMITS.returnedCandidates),
      })
      .readonly(),
    output: z
      .strictObject({
        maskEncoding: z.literal(SAM_MASK_ENCODING),
      })
      .readonly(),
  })
  .superRefine((request, context) => {
    if (request.limits.minMaskAreaPixels > request.source.width * request.source.height) {
      context.addIssue({ code: 'custom', message: 'Minimum mask area exceeds source area.' });
    }
  })
  .readonly();

export const SamLiveExecutionIdentitySchema = z
  .strictObject({
    kind: z.literal('meta-sam2.1'),
    repositoryUrl: z.literal('https://github.com/facebookresearch/sam2'),
    repositoryCommit: z.literal('05d9e57fb3945b10c861046c1e6749e2bfc258e3'),
    modelId: z.literal('sam2.1_hiera_base_plus'),
    configIdentity: z.literal('configs/sam2.1/sam2.1_hiera_b+.yaml'),
    checkpointUrl: z.literal(
      'https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt',
    ),
    checkpointSha256: Sha256Schema,
  })
  .superRefine((identity, context) => {
    if (identity.checkpointSha256 === '0'.repeat(64)) {
      context.addIssue({
        code: 'custom',
        message: 'Reviewed SAM checkpoint SHA-256 remains unresolved.',
      });
    }
  })
  .readonly();

export const SamFakeExecutionIdentitySchema = z
  .strictObject({
    kind: z.literal('deterministic-fake'),
    engineId: z.string().regex(/^[a-z0-9][a-z0-9.-]{2,127}$/u),
    definitionSha256: Sha256Schema,
    notice: z.literal('NOT_SAM_OUTPUT'),
  })
  .readonly();

export const SamExecutionIdentitySchema = z.discriminatedUnion('kind', [
  SamLiveExecutionIdentitySchema,
  SamFakeExecutionIdentitySchema,
]);

export const SamReviewFlagSchema = z.enum(['near-contained', 'overlapping', 'touches-source-edge']);
export const SAM_REVIEW_FLAG_ORDER = Object.freeze([
  'near-contained',
  'overlapping',
  'touches-source-edge',
] as const);

export const SamMaskCandidateSchema = z
  .strictObject({
    candidateId: z.string().regex(/^samc_v1_[0-9a-f]{64}$/u),
    bounds: z
      .strictObject({
        xBps: BasisPointSchema,
        yBps: BasisPointSchema,
        widthBps: PositiveBasisPointSchema,
        heightBps: PositiveBasisPointSchema,
      })
      .readonly(),
    pixelArea: z.int().min(1).max(SAM_LIMITS.imagePixels),
    areaRatioBps: z.int().min(0).max(10_000),
    predictedIouBps: z.int().min(0).max(10_000),
    stabilityScoreBps: z.int().min(0).max(10_000),
    mask: z
      .strictObject({
        encoding: z.literal(SAM_MASK_ENCODING),
        width: z.int().min(1).max(SAM_LIMITS.sidePixels),
        height: z.int().min(1).max(SAM_LIMITS.sidePixels),
        byteSize: z.int().min(1).max(SAM_LIMITS.candidateRleBytes),
        dataBase64: z.string().min(1).max(1_333_336),
        sha256: Sha256Schema,
      })
      .readonly(),
    reviewFlags: z.array(SamReviewFlagSchema).max(SAM_REVIEW_FLAG_ORDER.length).readonly(),
  })
  .superRefine((candidate, context) => {
    if (
      candidate.bounds.xBps + candidate.bounds.widthBps > 10_000 ||
      candidate.bounds.yBps + candidate.bounds.heightBps > 10_000
    ) {
      context.addIssue({ code: 'custom', message: 'Candidate bounds exceed the source basis.' });
    }
  })
  .readonly();

export const SamFilterSummarySchema = z
  .strictObject({
    rawCandidateCount: z.int().min(0).max(SAM_LIMITS.rawCandidates),
    exactDuplicateFiltered: z.int().min(0).max(SAM_LIMITS.rawCandidates),
    tinyFiltered: z.int().min(0).max(SAM_LIMITS.rawCandidates),
    fullCanvasFiltered: z.int().min(0).max(SAM_LIMITS.rawCandidates),
    rleTooLargeFiltered: z.int().min(0).max(SAM_LIMITS.rawCandidates),
    rleBudgetFiltered: z.int().min(0).max(SAM_LIMITS.rawCandidates),
    candidateLimitFiltered: z.int().min(0).max(SAM_LIMITS.rawCandidates),
    returnedCandidateCount: z.int().min(0).max(SAM_LIMITS.returnedCandidates),
  })
  .readonly();

export const SamMaskResponseSchema = z
  .strictObject({
    contractVersion: z.literal(SAM_MASK_CONTRACT_VERSION),
    requestId: UuidSchema,
    workspaceId: UuidSchema,
    jobId: UuidSchema,
    attemptId: UuidSchema,
    sourceSha256: Sha256Schema,
    executionIdentity: SamExecutionIdentitySchema,
    timing: z
      .strictObject({
        inferenceMs: z.int().min(0).max(86_400_000),
        totalMs: z.int().min(0).max(86_400_000),
      })
      .readonly(),
    filterSummary: SamFilterSummarySchema,
    candidateCount: z.int().min(0).max(SAM_LIMITS.returnedCandidates),
    candidates: z.array(SamMaskCandidateSchema).max(SAM_LIMITS.returnedCandidates).readonly(),
    responseSha256: Sha256Schema,
  })
  .superRefine((response, context) => {
    if (
      response.candidateCount !== response.candidates.length ||
      response.filterSummary.returnedCandidateCount !== response.candidates.length
    ) {
      context.addIssue({ code: 'custom', message: 'SAM response candidate counts disagree.' });
    }
    if (response.timing.inferenceMs > response.timing.totalMs) {
      context.addIssue({ code: 'custom', message: 'SAM timing is internally inconsistent.' });
    }
    const flagsInOrder = response.candidates.every(
      (candidate) =>
        JSON.stringify(candidate.reviewFlags) ===
        JSON.stringify(
          [...new Set(candidate.reviewFlags)].toSorted(
            (left, right) =>
              SAM_REVIEW_FLAG_ORDER.indexOf(left) - SAM_REVIEW_FLAG_ORDER.indexOf(right),
          ),
        ),
    );
    if (!flagsInOrder) {
      context.addIssue({ code: 'custom', message: 'Review flags are not unique and canonical.' });
    }
  })
  .readonly();

export type SamMaskRequest = z.infer<typeof SamMaskRequestSchema>;
export type SamMaskResponse = z.infer<typeof SamMaskResponseSchema>;
export type SamMaskCandidate = z.infer<typeof SamMaskCandidateSchema>;
export type SamExecutionIdentity = z.infer<typeof SamExecutionIdentitySchema>;
