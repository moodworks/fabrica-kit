import {
  SAM_MASK_CONTRACT_VERSION,
  SAM_MASK_ENCODING,
  SamFakeExecutionIdentitySchema,
  SamMaskRequestSchema,
  type SamMaskCandidate,
  type SamMaskRequest,
  type SamMaskResponse,
} from '../sam/sam-mask-contracts.js';
import { postprocessSamMasks, type SamRawMaskCandidate } from '../sam/sam-mask-postprocess.js';
import { canonicalResponseSha256 } from '../sam/sam-mask-rle.js';
import {
  materializeSamMaskCutout,
  type SamCutoutMaterialization,
} from '../sam/sam-cutout-materializer.js';
import { assertCanonicalNormalizedPng } from '../security/raster-container.js';
import { sha256Hex } from '../scene/canonical-scene-json.js';
import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import {
  decodeBinaryMaskRle,
  decodeCanonicalBase64,
  createCandidateFromMask,
  maskContentSha256,
} from '../sam/sam-mask-rle.js';
import { parseAndVerifySamMaskResponse } from '../sam/sam-mask-validation.js';
import { createBoundedLayerPreview } from './sam-box-prompt-layer-extraction.js';

/** The automatic upload path has a deliberately separate endpoint identity. */
export const UPLOADED_BANNER_SAM_ENDPOINT_ID = 'fabrica-uploaded-banner-v1' as const;
export const UPLOADED_BANNER_SAM_LIMITS = Object.freeze({
  minMaskAreaPixels: 64,
  maxCandidates: 8,
  maxPixels: 676_370,
  maxSourcePngBytes: 12_000_000,
});
export const UPLOADED_BANNER_SAM_FAKE_IDENTITY = Object.freeze({
  kind: 'deterministic-fake' as const,
  engineId: 'fabrica-code-mask-engine-v1',
  definitionSha256: '711d087a27ca497fdbbb9bee07603a89ce4bc14f4357c96295467a2bdfe45dd9',
  notice: 'NOT_SAM_OUTPUT' as const,
});

export interface UploadedBannerSamGenerator {
  generate(request: SamMaskRequest): Promise<SamMaskResponse>;
}

export interface UploadedBannerSamCandidate extends SamMaskCandidate {
  readonly preview: Awaited<ReturnType<typeof createBoundedLayerPreview>>;
  readonly materialization: SamCutoutMaterialization;
}

interface UploadedBannerSamOperationBase {
  readonly request: SamMaskRequest;
  readonly candidates: readonly UploadedBannerSamCandidate[];
}

export interface UploadedBannerSamFakeOperationResult extends UploadedBannerSamOperationBase {
  readonly provenance: 'Deterministic test output — NOT SAM OUTPUT';
  readonly response: SamMaskResponse;
}

export interface UploadedBannerSamReplayOperationResult extends UploadedBannerSamOperationBase {
  readonly provenance:
    | 'Verified Meta SAM 2.1 cutout replay — no live call'
    | 'Verified Meta SAM 2.1 user box-prompt replay — no live call';
}
export type UploadedBannerSamOperationResult =
  UploadedBannerSamFakeOperationResult | UploadedBannerSamReplayOperationResult;

export const composeUploadedBannerSamCandidates = async (input: {
  readonly operation: UploadedBannerSamOperationResult;
  readonly candidateIds: readonly string[];
}): Promise<{
  readonly subjectId: string;
  readonly candidates: readonly UploadedBannerSamCandidate[];
}> => {
  const ids = [...new Set(input.candidateIds)];
  if (ids.length < 1 || ids.length > 8 || ids.length !== input.candidateIds.length)
    throw new TypeError('Selected candidates must be one to eight unique IDs.');
  const selected = input.operation.candidates.filter((candidate) =>
    ids.includes(candidate.candidateId),
  );
  if (selected.length !== ids.length)
    throw new TypeError('Selected candidate is not owned by the operation.');
  const canonical = input.operation.candidates.filter((candidate) =>
    ids.includes(candidate.candidateId),
  );
  const identityPayload = canonicalizeJson({
    algorithm: 'uploaded-sam-layer-selection-v1',
    source: {
      sha256: input.operation.request.source.sha256,
      width: input.operation.request.source.width,
      height: input.operation.request.source.height,
    },
    candidates: canonical.map((candidate) => ({
      id: candidate.candidateId,
      mask: candidate.mask.sha256,
      cutout: candidate.materialization.metadata.cutoutPngSha256,
      crop: candidate.materialization.metadata.crop,
    })),
  });
  const identity = sha256Hex(Buffer.from(identityPayload, 'utf8'));
  return {
    subjectId: `sams_v1_${identity}`,
    candidates: Object.freeze(canonical),
  };
};

export const composeUploadedBannerSamCandidateGroups = async (input: {
  readonly operation: UploadedBannerSamOperationResult;
  readonly candidateGroups: readonly (readonly string[])[];
}): Promise<{
  readonly subjectId: string;
  readonly groups: readonly {
    readonly groupId: string;
    readonly memberCandidateIds: readonly string[];
    readonly candidate: UploadedBannerSamCandidate;
  }[];
}> => {
  if (input.candidateGroups.length < 1 || input.candidateGroups.length > 8)
    throw new TypeError('Create one to eight layers.');
  const used = new Set<string>();
  const groups = [] as {
    groupId: string;
    memberCandidateIds: readonly string[];
    candidate: UploadedBannerSamCandidate;
  }[];
  for (const members of input.candidateGroups) {
    if (
      !Array.isArray(members) ||
      members.length < 1 ||
      members.length > 8 ||
      members.some((id) => typeof id !== 'string' || used.has(id))
    )
      throw new TypeError('Layer members must be nonempty and disjoint.');
    members.forEach((id) => used.add(id));
    const canonical = input.operation.candidates.filter((candidate) =>
      members.includes(candidate.candidateId),
    );
    if (canonical.length !== members.length)
      throw new TypeError('Layer member is not owned by operation.');
    const first = decodeBinaryMaskRle(
      decodeCanonicalBase64(canonical[0]!.mask.dataBase64, 1_000_000),
      input.operation.request.source.width,
      input.operation.request.source.height,
    );
    const union = new Uint8Array(first.pixels);
    for (const candidate of canonical.slice(1)) {
      const mask = decodeBinaryMaskRle(
        decodeCanonicalBase64(candidate.mask.dataBase64, 1_000_000),
        first.width,
        first.height,
      );
      for (let i = 0; i < union.length; i += 1) union[i] ||= mask.pixels[i]!;
    }
    const generated = createCandidateFromMask({
      mask: union,
      width: first.width,
      height: first.height,
      sourceSha256: input.operation.request.source.sha256,
      predictedIou: 0,
      stabilityScore: 0,
    });
    const materialization = await materializeSamMaskCutout({
      trustedRequest: input.operation.request,
      candidate: generated,
    });
    const payload = canonicalizeJson({
      algorithm: 'uploaded-sam-layer-v1',
      source: {
        sha256: input.operation.request.source.sha256,
        width: first.width,
        height: first.height,
      },
      members: canonical.map((c) => ({
        id: c.candidateId,
        mask: c.mask.sha256,
        cutout: c.materialization.metadata.cutoutPngSha256,
        crop: c.materialization.metadata.crop,
      })),
      union: maskContentSha256(union, first.width, first.height),
      cutout: materialization.metadata.cutoutPngSha256,
      crop: materialization.metadata.crop,
    });
    const groupId = `saml_v1_${sha256Hex(Buffer.from(payload, 'utf8'))}`;
    groups.push({
      groupId,
      memberCandidateIds: canonical.map((c) => c.candidateId),
      candidate: Object.freeze({
        ...generated,
        materialization,
        preview: await createBoundedLayerPreview(materialization.cutoutPng),
      }),
    });
  }
  const subjectId = `sams_v1_${sha256Hex(Buffer.from(canonicalizeJson({ algorithm: 'uploaded-sam-layer-groups-v1', groups: groups.map((group) => group.groupId) }), 'utf8'))}`;
  return { subjectId, groups: Object.freeze(groups) };
};

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

const defaultMasks = (request: SamMaskRequest): readonly SamRawMaskCandidate[] => {
  const { width, height } = request.source;
  const rectangle = (xStart: number, yStart: number, xEnd: number, yEnd: number): Uint8Array => {
    const mask = new Uint8Array(width * height);
    const left = Math.max(0, Math.min(width - 1, xStart));
    const top = Math.max(0, Math.min(height - 1, yStart));
    const right = Math.max(left + 1, Math.min(width, xEnd));
    const bottom = Math.max(top + 1, Math.min(height, yEnd));
    for (let y = top; y < bottom; y += 1) mask.fill(1, y * width + left, y * width + right);
    return mask;
  };
  return [
    {
      mask: rectangle(
        Math.floor(width / 32),
        Math.floor(height / 10),
        Math.ceil(width / 3),
        Math.ceil((height * 9) / 10),
      ),
      predictedIou: 0.93,
      stabilityScore: 0.97,
    },
    {
      mask: rectangle(
        Math.floor(width / 3),
        Math.floor(height / 6),
        Math.ceil((width * 2) / 3),
        Math.ceil((height * 5) / 6),
      ),
      predictedIou: 0.89,
      stabilityScore: 0.95,
    },
    {
      mask: rectangle(
        Math.floor((width * 2) / 3),
        Math.floor(height / 12),
        Math.ceil((width * 31) / 32),
        Math.ceil((height * 11) / 12),
      ),
      predictedIou: 0.87,
      stabilityScore: 0.96,
    },
  ];
};

export const createDeterministicUploadedBannerSamGenerator = (): UploadedBannerSamGenerator & {
  readonly getCallCount: () => number;
  readonly networkCalls: 0;
} => {
  let callCount = 0;
  return Object.freeze({
    networkCalls: 0 as const,
    getCallCount: () => callCount,
    async generate(request: SamMaskRequest): Promise<SamMaskResponse> {
      callCount += 1;
      const result = postprocessSamMasks(request, defaultMasks(request));
      const unsigned = {
        contractVersion: SAM_MASK_CONTRACT_VERSION,
        requestId: request.requestId,
        workspaceId: request.workspaceId,
        jobId: request.jobId,
        attemptId: request.attemptId,
        sourceSha256: request.source.sha256,
        executionIdentity: UPLOADED_BANNER_SAM_FAKE_IDENTITY,
        timing: { inferenceMs: 0, totalMs: 0 },
        filterSummary: result.filterSummary,
        candidateCount: result.candidates.length,
        candidates: result.candidates,
      } satisfies Omit<SamMaskResponse, 'responseSha256'>;
      return { ...unsigned, responseSha256: canonicalResponseSha256(unsigned) };
    },
  });
};

/**
 * Builds and strictly verifies one automatic-candidates request from server-owned normalized
 * bytes. The source bytes are never accepted from the response or from a client reference.
 */
export const generateUploadedBannerSamCandidates = async (input: {
  readonly normalizedPng: Uint8Array;
  readonly requestId: string;
  readonly workspaceId: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly generator: UploadedBannerSamGenerator;
}): Promise<UploadedBannerSamOperationResult> => {
  if (!(input.normalizedPng instanceof Uint8Array))
    throw new TypeError('Normalized PNG is required.');
  if (input.normalizedPng.byteLength > UPLOADED_BANNER_SAM_LIMITS.maxSourcePngBytes) {
    throw new TypeError('Normalized PNG exceeds the uploaded operation byte bound.');
  }
  const dimensions = assertCanonicalNormalizedPng(input.normalizedPng);
  if (
    dimensions.width > 4096 ||
    dimensions.height > 4096 ||
    dimensions.width * dimensions.height > UPLOADED_BANNER_SAM_LIMITS.maxPixels
  ) {
    throw new TypeError('Normalized PNG exceeds the uploaded operation pixel bound.');
  }
  const sourceSha256 = sha256Hex(input.normalizedPng);
  const request = deepFreeze(
    SamMaskRequestSchema.parse({
      contractVersion: SAM_MASK_CONTRACT_VERSION,
      requestId: input.requestId,
      workspaceId: input.workspaceId,
      jobId: input.jobId,
      attemptId: input.attemptId,
      source: {
        mediaType: 'image/png',
        byteSize: input.normalizedPng.byteLength,
        width: dimensions.width,
        height: dimensions.height,
        sha256: sourceSha256,
        pngBase64: Buffer.from(input.normalizedPng).toString('base64'),
      },
      segmentation: { mode: 'automatic-candidates', prompt: { kind: 'none' } },
      limits: {
        minMaskAreaPixels: UPLOADED_BANNER_SAM_LIMITS.minMaskAreaPixels,
        maxCandidates: UPLOADED_BANNER_SAM_LIMITS.maxCandidates,
      },
      output: { maskEncoding: SAM_MASK_ENCODING },
    }),
  );
  const response = parseAndVerifySamMaskResponse({
    response: await input.generator.generate(request),
    request,
    expectedExecutionKind: 'deterministic-fake',
  });
  const fakeIdentity = SamFakeExecutionIdentitySchema.parse(response.executionIdentity);
  if (
    fakeIdentity.notice !== 'NOT_SAM_OUTPUT' ||
    response.candidateCount < 1 ||
    response.candidateCount > 8
  ) {
    throw new TypeError('Uploaded automatic candidate response provenance or count is invalid.');
  }
  if (response.candidates.length !== response.candidateCount) {
    throw new TypeError('Uploaded automatic candidate count is inconsistent.');
  }
  const candidates: UploadedBannerSamCandidate[] = [];
  for (const candidate of response.candidates) {
    const materialization = await materializeSamMaskCutout({ trustedRequest: request, candidate });
    const preview = await createBoundedLayerPreview(materialization.cutoutPng);
    candidates.push(Object.freeze({ ...candidate, materialization, preview }));
  }
  return Object.freeze({
    request,
    response,
    candidates: Object.freeze(candidates),
    provenance: 'Deterministic test output — NOT SAM OUTPUT' as const,
  });
};
