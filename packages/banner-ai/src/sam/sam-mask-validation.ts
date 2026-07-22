import { createHash } from 'node:crypto';

import { inspectPngContainer, parsePngChunks } from '../security/raster-container.js';
import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import {
  SAM_LIMITS,
  SAM_MASK_ENCODING,
  SamMaskRequestSchema,
  SamMaskResponseSchema,
  type SamMaskRequest,
  type SamMaskResponse,
} from './sam-mask-contracts.js';
import {
  canonicalResponseSha256,
  compareSamCandidates,
  decodeBinaryMaskRle,
  decodeCanonicalBase64,
  deriveMaskPixelBounds,
  deriveSamCandidateId,
  maskContentSha256,
  packMaskBits,
  pixelBoundsToBasisPoints,
} from './sam-mask-rle.js';

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const utf8Bytes = (value: string): number => Buffer.byteLength(value, 'utf8');
const strictlyValidatedResponses = new WeakMap<
  object,
  {
    readonly request: SamMaskRequest;
    readonly expectedExecutionKind: 'deterministic-fake' | 'meta-sam2.1';
  }
>();
const POPCOUNT = Uint8Array.from({ length: 256 }, (_, value) => {
  let bits = value;
  let count = 0;
  while (bits > 0) {
    count += bits & 1;
    bits >>>= 1;
  }
  return count;
});

const assertStrictRgbaPng = (bytes: Uint8Array, width: number, height: number): void => {
  const info = inspectPngContainer(bytes);
  const chunks = parsePngChunks(bytes);
  if (
    info.width !== width ||
    info.height !== height ||
    chunks.some((chunk) => !['IHDR', 'IDAT', 'IEND'].includes(chunk.type))
  ) {
    throw new TypeError('SAM source PNG dimensions or closed chunk profile differ.');
  }
  const ihdr = chunks[0]!;
  if (
    bytes[ihdr.start + 16] !== 8 ||
    bytes[ihdr.start + 17] !== 6 ||
    bytes[ihdr.start + 18] !== 0 ||
    bytes[ihdr.start + 19] !== 0 ||
    bytes[ihdr.start + 20] !== 0
  ) {
    throw new TypeError('SAM source must be an 8-bit, RGBA, non-interlaced normalized PNG.');
  }
};

export const parseAndVerifySamMaskRequest = (
  input: unknown,
): { readonly request: SamMaskRequest; readonly sourceBytes: Uint8Array } => {
  const request = SamMaskRequestSchema.parse(input);
  const canonicalJson = canonicalizeJson(request);
  if (utf8Bytes(canonicalJson) > SAM_LIMITS.requestJsonBytes) {
    throw new TypeError('SAM request exceeds its canonical JSON byte budget.');
  }
  const sourceBytes = decodeCanonicalBase64(request.source.pngBase64, SAM_LIMITS.sourcePngBytes);
  if (
    sourceBytes.byteLength !== request.source.byteSize ||
    digest(sourceBytes) !== request.source.sha256
  ) {
    throw new TypeError('SAM source byte length or digest differs from its declaration.');
  }
  assertStrictRgbaPng(sourceBytes, request.source.width, request.source.height);
  return { request, sourceBytes };
};

export const parseAndVerifySamMaskResponse = (input: {
  readonly response: unknown;
  readonly request: SamMaskRequest;
  readonly expectedExecutionKind: 'deterministic-fake' | 'meta-sam2.1';
}): SamMaskResponse => {
  const response = SamMaskResponseSchema.parse(input.response);
  const responseBytes = utf8Bytes(canonicalizeJson(response));
  if (responseBytes > SAM_LIMITS.responseJsonBytes) {
    throw new TypeError('SAM response exceeds its canonical JSON byte budget.');
  }
  if (
    response.requestId !== input.request.requestId ||
    response.workspaceId !== input.request.workspaceId ||
    response.jobId !== input.request.jobId ||
    response.attemptId !== input.request.attemptId ||
    response.sourceSha256 !== input.request.source.sha256 ||
    response.executionIdentity.kind !== input.expectedExecutionKind
  ) {
    throw new TypeError('SAM response identity differs from its request or transport.');
  }
  const { responseSha256, ...unsigned } = response;
  if (canonicalResponseSha256(unsigned) !== responseSha256) {
    throw new TypeError('SAM response digest differs from its canonical content.');
  }
  let totalRleBytes = 0;
  const packedMasks: Uint8Array[] = [];
  const decodedBounds: ReturnType<typeof deriveMaskPixelBounds>[] = [];
  const maskDigests = new Set<string>();
  for (const candidate of response.candidates) {
    if (
      candidate.mask.encoding !== SAM_MASK_ENCODING ||
      candidate.mask.width !== input.request.source.width ||
      candidate.mask.height !== input.request.source.height
    ) {
      throw new TypeError('SAM candidate mask dimensions or encoding differ from the source.');
    }
    const rle = decodeCanonicalBase64(candidate.mask.dataBase64, SAM_LIMITS.candidateRleBytes);
    totalRleBytes += rle.byteLength;
    if (candidate.mask.byteSize !== rle.byteLength || totalRleBytes > SAM_LIMITS.totalRleBytes) {
      throw new TypeError('SAM candidate RLE byte accounting exceeds its contract.');
    }
    const decoded = decodeBinaryMaskRle(
      rle,
      input.request.source.width,
      input.request.source.height,
    );
    const maskSha256 = maskContentSha256(decoded.pixels, decoded.width, decoded.height);
    const bounds = deriveMaskPixelBounds(decoded.pixels, decoded.width, decoded.height);
    if (
      maskSha256 !== candidate.mask.sha256 ||
      candidate.candidateId !==
        deriveSamCandidateId({
          sourceSha256: input.request.source.sha256,
          width: decoded.width,
          height: decoded.height,
          maskSha256,
        }) ||
      candidate.pixelArea !== bounds.area ||
      candidate.areaRatioBps !==
        Math.floor((bounds.area * 10_000) / (decoded.width * decoded.height)) ||
      JSON.stringify(candidate.bounds) !==
        JSON.stringify(pixelBoundsToBasisPoints(bounds, decoded.width, decoded.height))
    ) {
      throw new TypeError('SAM candidate digest, identity, area, or bounds differ from its mask.');
    }
    if (
      bounds.area < input.request.limits.minMaskAreaPixels ||
      bounds.area === decoded.width * decoded.height
    ) {
      throw new TypeError('SAM response returned a tiny or exact full-canvas candidate.');
    }
    if (maskDigests.has(maskSha256)) throw new TypeError('SAM response repeats an exact mask.');
    maskDigests.add(maskSha256);
    packedMasks.push(packMaskBits(decoded.pixels));
    decodedBounds.push(bounds);
  }
  if (response.candidates.length > input.request.limits.maxCandidates) {
    throw new TypeError('SAM response exceeds the request candidate limit.');
  }
  const summary = response.filterSummary;
  if (
    summary.rawCandidateCount !==
    summary.exactDuplicateFiltered +
      summary.tinyFiltered +
      summary.fullCanvasFiltered +
      summary.rleTooLargeFiltered +
      summary.rleBudgetFiltered +
      summary.candidateLimitFiltered +
      summary.returnedCandidateCount
  ) {
    throw new TypeError('SAM response filter accounting is not exact.');
  }
  const expectedFlags = decodedBounds.map((bounds) => {
    const flags = new Set<(typeof response.candidates)[number]['reviewFlags'][number]>();
    if (
      bounds.left === 0 ||
      bounds.top === 0 ||
      bounds.rightExclusive === input.request.source.width ||
      bounds.bottomExclusive === input.request.source.height
    ) {
      flags.add('touches-source-edge');
    }
    return flags;
  });
  for (let leftIndex = 0; leftIndex < packedMasks.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < packedMasks.length; rightIndex += 1) {
      const leftBounds = decodedBounds[leftIndex]!;
      const rightBounds = decodedBounds[rightIndex]!;
      if (
        leftBounds.rightExclusive <= rightBounds.left ||
        rightBounds.rightExclusive <= leftBounds.left ||
        leftBounds.bottomExclusive <= rightBounds.top ||
        rightBounds.bottomExclusive <= leftBounds.top
      ) {
        continue;
      }
      const left = packedMasks[leftIndex]!;
      const right = packedMasks[rightIndex]!;
      let intersection = 0;
      for (let index = 0; index < left.length; index += 1) {
        intersection += POPCOUNT[left[index]! & right[index]!]!;
      }
      const leftArea = response.candidates[leftIndex]!.pixelArea;
      const rightArea = response.candidates[rightIndex]!.pixelArea;
      const union = leftArea + rightArea - intersection;
      if (Math.floor((intersection * 10_000) / Math.min(leftArea, rightArea)) >= 9_800) {
        expectedFlags[leftIndex]!.add('near-contained');
        expectedFlags[rightIndex]!.add('near-contained');
      }
      if (Math.floor((intersection * 10_000) / union) >= 5_000) {
        expectedFlags[leftIndex]!.add('overlapping');
        expectedFlags[rightIndex]!.add('overlapping');
      }
    }
  }
  for (const [index, candidate] of response.candidates.entries()) {
    const expected = ['near-contained', 'overlapping', 'touches-source-edge'].filter((flag) =>
      expectedFlags[index]!.has(flag as (typeof candidate.reviewFlags)[number]),
    );
    if (JSON.stringify(candidate.reviewFlags) !== JSON.stringify(expected)) {
      throw new TypeError('SAM candidate review flags differ from decoded mask relationships.');
    }
  }
  const sorted = [...response.candidates].sort(compareSamCandidates);
  if (
    sorted.some(
      (candidate, index) => candidate.candidateId !== response.candidates[index]?.candidateId,
    )
  ) {
    throw new TypeError('SAM candidates are not in canonical deterministic order.');
  }
  strictlyValidatedResponses.set(
    response,
    Object.freeze({
      request: input.request,
      expectedExecutionKind: input.expectedExecutionKind,
    }),
  );
  return response;
};

/**
 * Proves that this exact immutable response object crossed the complete strict response boundary
 * for this exact request. Structurally equivalent, reconstructed, or merely parsed objects do not
 * acquire this process-local capability.
 */
export const assertSamMaskResponseWasStrictlyValidated = (input: {
  readonly response: SamMaskResponse;
  readonly request: SamMaskRequest;
  readonly expectedExecutionKind: 'deterministic-fake' | 'meta-sam2.1';
}): SamMaskResponse => {
  const state = strictlyValidatedResponses.get(input.response);
  if (
    state === undefined ||
    state.request !== input.request ||
    state.expectedExecutionKind !== input.expectedExecutionKind
  ) {
    throw new TypeError(
      'SAM response is raw, reconstructed, request-mismatched, or not strictly validated.',
    );
  }
  return input.response;
};
