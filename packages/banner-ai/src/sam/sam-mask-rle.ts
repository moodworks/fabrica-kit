import { createHash } from 'node:crypto';

import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  SAM_LIMITS,
  SAM_MASK_ENCODING,
  type SamMaskCandidate,
  type SamMaskResponse,
} from './sam-mask-contracts.js';

const MAGIC = Buffer.from('FBRL', 'ascii');
const MASK_DIGEST_DOMAIN = Buffer.from('sam-mask-content-v1\0', 'ascii');
const CANDIDATE_ID_DOMAIN = Buffer.from('sam-mask-candidate-id-v1\0', 'ascii');

const u32be = (value: number): Buffer => {
  const result = Buffer.alloc(4);
  result.writeUInt32BE(value);
  return result;
};

export const encodeCanonicalBase64 = (bytes: Uint8Array): string =>
  Buffer.from(bytes).toString('base64');

export const decodeCanonicalBase64 = (input: string, maximumBytes: number): Uint8Array => {
  if (
    input.length === 0 ||
    input.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(input)
  ) {
    throw new TypeError('Base64 must be canonical padded RFC 4648 data.');
  }
  const bytes = Buffer.from(input, 'base64');
  if (bytes.byteLength > maximumBytes || bytes.toString('base64') !== input) {
    throw new TypeError('Base64 data is non-canonical or exceeds its decoded limit.');
  }
  return Uint8Array.from(bytes);
};

const appendLeb128 = (output: number[], value: number): void => {
  let remaining = value;
  do {
    let byte = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    if (remaining > 0) byte |= 0x80;
    output.push(byte);
  } while (remaining > 0);
};

export const encodeBinaryMaskRle = (
  mask: Uint8Array,
  width: number,
  height: number,
): Uint8Array => {
  const pixelCount = width * height;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    pixelCount > SAM_LIMITS.imagePixels ||
    mask.byteLength !== pixelCount ||
    mask.some((value) => value !== 0 && value !== 1)
  ) {
    throw new TypeError('Binary mask dimensions or values are invalid.');
  }
  const runs: number[] = [];
  let current = mask[0]!;
  let count = 1;
  for (let index = 1; index < mask.length; index += 1) {
    if (mask[index] === current) count += 1;
    else {
      runs.push(count);
      current = mask[index]!;
      count = 1;
    }
  }
  runs.push(count);
  const output = [...MAGIC, 1, ...u32be(width), ...u32be(height), mask[0]!, ...u32be(runs.length)];
  for (const run of runs) appendLeb128(output, run);
  return Uint8Array.from(output);
};

const readCanonicalLeb128 = (
  bytes: Uint8Array,
  start: number,
  pixelCount: number,
): { readonly value: number; readonly next: number } => {
  let value = 0;
  let multiplier = 1;
  const encoded: number[] = [];
  for (let index = start; index < bytes.length && encoded.length < 4; index += 1) {
    const byte = bytes[index]!;
    encoded.push(byte);
    value += (byte & 0x7f) * multiplier;
    if (!Number.isSafeInteger(value) || value > pixelCount) {
      throw new TypeError('RLE run length overflows the mask pixel count.');
    }
    if ((byte & 0x80) === 0) {
      if (value < 1) throw new TypeError('RLE runs must be positive.');
      const canonical: number[] = [];
      appendLeb128(canonical, value);
      if (
        canonical.length !== encoded.length ||
        canonical.some((entry, i) => entry !== encoded[i])
      ) {
        throw new TypeError('RLE run length is not minimally encoded.');
      }
      return { value, next: index + 1 };
    }
    multiplier *= 128;
  }
  throw new TypeError('RLE run length is truncated or exceeds four bytes.');
};

export const decodeBinaryMaskRle = (
  bytes: Uint8Array,
  expectedWidth?: number,
  expectedHeight?: number,
): { readonly width: number; readonly height: number; readonly pixels: Uint8Array } => {
  if (
    bytes.byteLength < 19 ||
    bytes.byteLength > SAM_LIMITS.candidateRleBytes ||
    !MAGIC.every((value, index) => bytes[index] === value) ||
    bytes[4] !== 1
  ) {
    throw new TypeError('Binary RLE header is invalid.');
  }
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = buffer.readUInt32BE(5);
  const height = buffer.readUInt32BE(9);
  const firstValue = bytes[13]!;
  const runCount = buffer.readUInt32BE(14);
  const pixelCount = width * height;
  if (
    width < 1 ||
    height < 1 ||
    width > SAM_LIMITS.sidePixels ||
    height > SAM_LIMITS.sidePixels ||
    pixelCount > SAM_LIMITS.imagePixels ||
    firstValue > 1 ||
    runCount < 1 ||
    runCount > pixelCount ||
    (expectedWidth !== undefined && width !== expectedWidth) ||
    (expectedHeight !== undefined && height !== expectedHeight)
  ) {
    throw new TypeError('Binary RLE dimensions or header counts are invalid.');
  }
  const pixels = new Uint8Array(pixelCount);
  let cursor = 18;
  let outputCursor = 0;
  let value = firstValue;
  for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
    const run = readCanonicalLeb128(bytes, cursor, pixelCount);
    cursor = run.next;
    if (outputCursor + run.value > pixelCount) {
      throw new TypeError('Binary RLE runs exceed the mask dimensions.');
    }
    if (value === 1) pixels.fill(1, outputCursor, outputCursor + run.value);
    outputCursor += run.value;
    value = value === 0 ? 1 : 0;
  }
  if (cursor !== bytes.length || outputCursor !== pixelCount) {
    throw new TypeError('Binary RLE has trailing data or the wrong pixel sum.');
  }
  return { width, height, pixels };
};

export const packMaskBits = (mask: Uint8Array): Uint8Array => {
  const packed = new Uint8Array(Math.ceil(mask.length / 8));
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] === 1) packed[Math.floor(index / 8)]! |= 1 << (7 - (index % 8));
    else if (mask[index] !== 0) throw new TypeError('Mask bits must be zero or one.');
  }
  return packed;
};

export const maskContentSha256 = (mask: Uint8Array, width: number, height: number): string =>
  createHash('sha256')
    .update(MASK_DIGEST_DOMAIN)
    .update(u32be(width))
    .update(u32be(height))
    .update(packMaskBits(mask))
    .digest('hex');

export const deriveSamCandidateId = (input: {
  readonly sourceSha256: string;
  readonly width: number;
  readonly height: number;
  readonly maskSha256: string;
}): string => {
  if (!/^[0-9a-f]{64}$/u.test(input.sourceSha256) || !/^[0-9a-f]{64}$/u.test(input.maskSha256)) {
    throw new TypeError('Candidate identity requires lowercase SHA-256 values.');
  }
  const digest = createHash('sha256')
    .update(CANDIDATE_ID_DOMAIN)
    .update(Buffer.from(input.sourceSha256, 'hex'))
    .update(u32be(input.width))
    .update(u32be(input.height))
    .update(Buffer.from(input.maskSha256, 'hex'))
    .digest('hex');
  return `samc_v1_${digest}`;
};

export const deriveMaskPixelBounds = (
  mask: Uint8Array,
  width: number,
  height: number,
): {
  readonly left: number;
  readonly top: number;
  readonly rightExclusive: number;
  readonly bottomExclusive: number;
  readonly area: number;
} => {
  let left = width;
  let top = height;
  let rightExclusive = 0;
  let bottomExclusive = 0;
  let area = 0;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] !== 1) continue;
    const x = index % width;
    const y = Math.floor(index / width);
    left = Math.min(left, x);
    top = Math.min(top, y);
    rightExclusive = Math.max(rightExclusive, x + 1);
    bottomExclusive = Math.max(bottomExclusive, y + 1);
    area += 1;
  }
  if (area === 0) throw new TypeError('Empty masks are invalid.');
  return { left, top, rightExclusive, bottomExclusive, area };
};

export const pixelBoundsToBasisPoints = (
  bounds: ReturnType<typeof deriveMaskPixelBounds>,
  width: number,
  height: number,
): SamMaskCandidate['bounds'] => {
  const xBps = Math.floor((bounds.left * 10_000) / width);
  const yBps = Math.floor((bounds.top * 10_000) / height);
  const rightBps = Math.ceil((bounds.rightExclusive * 10_000) / width);
  const bottomBps = Math.ceil((bounds.bottomExclusive * 10_000) / height);
  return { xBps, yBps, widthBps: rightBps - xBps, heightBps: bottomBps - yBps };
};

export const pointBasisToPixel = (basisPoints: number, dimension: number): number =>
  Math.min(dimension - 1, Math.floor((basisPoints * dimension) / 10_000));

export const boxBasisToPixel = (
  box: {
    readonly xBps: number;
    readonly yBps: number;
    readonly widthBps: number;
    readonly heightBps: number;
  },
  width: number,
  height: number,
): {
  readonly left: number;
  readonly top: number;
  readonly rightInclusive: number;
  readonly bottomInclusive: number;
} => {
  const left = Math.floor((box.xBps * width) / 10_000);
  const top = Math.floor((box.yBps * height) / 10_000);
  const rightExclusive = Math.max(
    left + 1,
    Math.min(width, Math.ceil(((box.xBps + box.widthBps) * width) / 10_000)),
  );
  const bottomExclusive = Math.max(
    top + 1,
    Math.min(height, Math.ceil(((box.yBps + box.heightBps) * height) / 10_000)),
  );
  return {
    left,
    top,
    rightInclusive: rightExclusive - 1,
    bottomInclusive: bottomExclusive - 1,
  };
};

export const quantizeScoreBasisPoints = (score: number): number => {
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new TypeError('SAM score must be finite and between zero and one.');
  }
  return Math.floor(score * 10_000 + 0.5);
};

export const canonicalResponseSha256 = (
  response: Omit<SamMaskResponse, 'responseSha256'>,
): string => sha256Hex(Buffer.from(canonicalizeJson(response), 'utf8'));

export const compareSamCandidates = (left: SamMaskCandidate, right: SamMaskCandidate): number =>
  right.predictedIouBps - left.predictedIouBps ||
  right.stabilityScoreBps - left.stabilityScoreBps ||
  right.pixelArea - left.pixelArea ||
  left.bounds.yBps - right.bounds.yBps ||
  left.bounds.xBps - right.bounds.xBps ||
  left.bounds.widthBps - right.bounds.widthBps ||
  left.bounds.heightBps - right.bounds.heightBps ||
  (left.mask.sha256 < right.mask.sha256 ? -1 : left.mask.sha256 > right.mask.sha256 ? 1 : 0);

export const createCandidateFromMask = (input: {
  readonly mask: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly sourceSha256: string;
  readonly predictedIou: number;
  readonly stabilityScore: number;
  readonly reviewFlags?: SamMaskCandidate['reviewFlags'];
}): SamMaskCandidate => {
  const bounds = deriveMaskPixelBounds(input.mask, input.width, input.height);
  const rle = encodeBinaryMaskRle(input.mask, input.width, input.height);
  const maskSha256 = maskContentSha256(input.mask, input.width, input.height);
  return {
    candidateId: deriveSamCandidateId({
      sourceSha256: input.sourceSha256,
      width: input.width,
      height: input.height,
      maskSha256,
    }),
    bounds: pixelBoundsToBasisPoints(bounds, input.width, input.height),
    pixelArea: bounds.area,
    areaRatioBps: Math.floor((bounds.area * 10_000) / (input.width * input.height)),
    predictedIouBps: quantizeScoreBasisPoints(input.predictedIou),
    stabilityScoreBps: quantizeScoreBasisPoints(input.stabilityScore),
    mask: {
      encoding: SAM_MASK_ENCODING,
      width: input.width,
      height: input.height,
      byteSize: rle.byteLength,
      dataBase64: encodeCanonicalBase64(rle),
      sha256: maskSha256,
    },
    reviewFlags: input.reviewFlags ?? [],
  };
};
