import {
  SAM_LIMITS,
  SAM_REVIEW_FLAG_ORDER,
  type SamMaskCandidate,
  type SamMaskRequest,
} from './sam-mask-contracts.js';
import {
  compareSamCandidates,
  createCandidateFromMask,
  deriveMaskPixelBounds,
  packMaskBits,
} from './sam-mask-rle.js';

export interface SamRawMaskCandidate {
  readonly mask: Uint8Array;
  readonly predictedIou: number;
  readonly stabilityScore: number;
}

export interface SamPostprocessResult {
  readonly candidates: readonly SamMaskCandidate[];
  readonly filterSummary: {
    readonly rawCandidateCount: number;
    readonly exactDuplicateFiltered: number;
    readonly tinyFiltered: number;
    readonly fullCanvasFiltered: number;
    readonly rleTooLargeFiltered: number;
    readonly rleBudgetFiltered: number;
    readonly candidateLimitFiltered: number;
    readonly returnedCandidateCount: number;
  };
}

const pairCounts = (
  left: Uint8Array,
  right: Uint8Array,
  leftArea: number,
  rightArea: number,
): {
  readonly intersection: number;
  readonly union: number;
  readonly leftArea: number;
  readonly rightArea: number;
} => {
  let intersection = 0;
  for (let index = 0; index < left.length; index += 1) {
    intersection += POPCOUNT[left[index]! & right[index]!]!;
  }
  return { intersection, union: leftArea + rightArea - intersection, leftArea, rightArea };
};

const POPCOUNT = Uint8Array.from({ length: 256 }, (_, value) => {
  let bits = value;
  let count = 0;
  while (bits > 0) {
    count += bits & 1;
    bits >>>= 1;
  }
  return count;
});

export const postprocessSamMasks = (
  request: SamMaskRequest,
  rawInput: readonly SamRawMaskCandidate[],
): SamPostprocessResult => {
  if (rawInput.length > SAM_LIMITS.rawCandidates) {
    throw new TypeError('ENGINE_OUTPUT_LIMIT: raw candidate count exceeds 512.');
  }
  const pixelCount = request.source.width * request.source.height;
  if (rawInput.length * pixelCount > SAM_LIMITS.rawMaskWorkingBytes) {
    throw new TypeError('ENGINE_OUTPUT_LIMIT: aggregate raw mask working bytes exceed 256 MiB.');
  }
  const prepared = rawInput.map((raw) => {
    if (raw.mask.byteLength !== pixelCount) throw new TypeError('Engine mask dimensions drifted.');
    const candidate = createCandidateFromMask({
      ...raw,
      width: request.source.width,
      height: request.source.height,
      sourceSha256: request.source.sha256,
    });
    return {
      raw,
      candidate,
      bounds: deriveMaskPixelBounds(raw.mask, request.source.width, request.source.height),
      packedMask: packMaskBits(raw.mask),
    };
  });
  prepared.sort((left, right) => compareSamCandidates(left.candidate, right.candidate));

  let tinyFiltered = 0;
  let fullCanvasFiltered = 0;
  let exactDuplicateFiltered = 0;
  const unique: typeof prepared = [];
  const seen = new Set<string>();
  for (const entry of prepared) {
    if (entry.candidate.pixelArea < request.limits.minMaskAreaPixels) {
      tinyFiltered += 1;
      continue;
    }
    if (entry.candidate.pixelArea === pixelCount) {
      fullCanvasFiltered += 1;
      continue;
    }
    if (seen.has(entry.candidate.mask.sha256)) {
      exactDuplicateFiltered += 1;
      continue;
    }
    seen.add(entry.candidate.mask.sha256);
    unique.push(entry);
  }

  let rleTooLargeFiltered = 0;
  let rleBudgetFiltered = 0;
  let candidateLimitFiltered = 0;
  let rleBytes = 0;
  const selected: typeof unique = [];
  for (const entry of unique) {
    const candidate = entry.candidate;
    if (candidate.mask.byteSize > SAM_LIMITS.candidateRleBytes) {
      rleTooLargeFiltered += 1;
      continue;
    }
    if (rleBytes + candidate.mask.byteSize > SAM_LIMITS.totalRleBytes) {
      rleBudgetFiltered += 1;
      continue;
    }
    if (selected.length >= request.limits.maxCandidates) {
      candidateLimitFiltered += 1;
      continue;
    }
    selected.push(entry);
    rleBytes += candidate.mask.byteSize;
  }

  const flagSets = selected.map(() => new Set<SamMaskCandidate['reviewFlags'][number]>());
  for (let leftIndex = 0; leftIndex < selected.length; leftIndex += 1) {
    const left = selected[leftIndex]!;
    const bounds = left.bounds;
    if (
      bounds.left === 0 ||
      bounds.top === 0 ||
      bounds.rightExclusive === request.source.width ||
      bounds.bottomExclusive === request.source.height
    ) {
      flagSets[leftIndex]!.add('touches-source-edge');
    }
    for (let rightIndex = leftIndex + 1; rightIndex < selected.length; rightIndex += 1) {
      const right = selected[rightIndex]!;
      const rightBounds = right.bounds;
      if (
        bounds.rightExclusive <= rightBounds.left ||
        rightBounds.rightExclusive <= bounds.left ||
        bounds.bottomExclusive <= rightBounds.top ||
        rightBounds.bottomExclusive <= bounds.top
      ) {
        continue;
      }
      const counts = pairCounts(
        left.packedMask,
        right.packedMask,
        left.candidate.pixelArea,
        right.candidate.pixelArea,
      );
      const containmentBps = Math.floor(
        (counts.intersection * 10_000) / Math.min(counts.leftArea, counts.rightArea),
      );
      const overlapBps = Math.floor((counts.intersection * 10_000) / counts.union);
      if (containmentBps >= 9_800) {
        flagSets[leftIndex]!.add('near-contained');
        flagSets[rightIndex]!.add('near-contained');
      }
      if (overlapBps >= 5_000) {
        flagSets[leftIndex]!.add('overlapping');
        flagSets[rightIndex]!.add('overlapping');
      }
    }
  }

  const candidates = selected.map((entry, index) => ({
    ...entry.candidate,
    reviewFlags: SAM_REVIEW_FLAG_ORDER.filter((flag) => flagSets[index]!.has(flag)),
  }));
  candidates.sort(compareSamCandidates);
  return {
    candidates,
    filterSummary: {
      rawCandidateCount: rawInput.length,
      exactDuplicateFiltered,
      tinyFiltered,
      fullCanvasFiltered,
      rleTooLargeFiltered,
      rleBudgetFiltered,
      candidateLimitFiltered,
      returnedCandidateCount: candidates.length,
    },
  };
};
