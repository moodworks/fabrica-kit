import { createHash } from 'node:crypto';

import sharp from 'sharp';

import { SamMaskCandidateSchema, type SamMaskCandidate } from './sam-mask-contracts.js';
import {
  decodeBinaryMaskRle,
  decodeCanonicalBase64,
  deriveMaskPixelBounds,
  deriveSamCandidateId,
  maskContentSha256,
  pixelBoundsToBasisPoints,
} from './sam-mask-rle.js';
import { parseAndVerifySamMaskRequest } from './sam-mask-validation.js';

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const pngOptions = Object.freeze({
  compressionLevel: 9,
  adaptiveFiltering: false,
  palette: false,
  force: true,
} as const);

export interface SamCutoutReproductionMetadata {
  readonly reproductionVersion: 1;
  readonly sourceSha256: string;
  readonly candidateId: string;
  readonly maskSha256: string;
  readonly maskEncoding: 'fabrica-binary-rle-v1';
  readonly sourceDimensions: { readonly width: number; readonly height: number };
  readonly crop: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
  readonly transparentPixelPolicy: 'alpha-zero-implies-rgb-zero';
  readonly cutoutPngSha256: string;
  readonly binaryMaskPngSha256: string;
  readonly filenames: {
    readonly cutout: string;
    readonly binaryMask: string;
    readonly metadata: string;
  };
}

export interface SamCutoutMaterialization {
  readonly cutoutPng: Uint8Array;
  readonly binaryMaskPng: Uint8Array;
  readonly metadata: SamCutoutReproductionMetadata;
}

export const materializeSamMaskCutout = async (input: {
  readonly trustedRequest: unknown;
  readonly candidate: SamMaskCandidate;
}): Promise<SamCutoutMaterialization> => {
  const { request, sourceBytes } = parseAndVerifySamMaskRequest(input.trustedRequest);
  const sourceDigestBefore = sha256(sourceBytes);
  const candidate = SamMaskCandidateSchema.parse(input.candidate);
  const rle = decodeCanonicalBase64(candidate.mask.dataBase64, 1_000_000);
  if (candidate.mask.byteSize !== rle.byteLength) throw new TypeError('Mask byte length drifted.');
  const decoded = decodeBinaryMaskRle(rle, request.source.width, request.source.height);
  const maskSha256 = maskContentSha256(decoded.pixels, decoded.width, decoded.height);
  if (
    maskSha256 !== candidate.mask.sha256 ||
    candidate.candidateId !==
      deriveSamCandidateId({
        sourceSha256: request.source.sha256,
        width: decoded.width,
        height: decoded.height,
        maskSha256,
      })
  ) {
    throw new TypeError('Candidate identity differs from decoded mask geometry.');
  }
  const bounds = deriveMaskPixelBounds(decoded.pixels, decoded.width, decoded.height);
  if (
    candidate.pixelArea !== bounds.area ||
    candidate.areaRatioBps !==
      Math.floor((bounds.area * 10_000) / (decoded.width * decoded.height)) ||
    JSON.stringify(candidate.bounds) !==
      JSON.stringify(pixelBoundsToBasisPoints(bounds, decoded.width, decoded.height))
  ) {
    throw new TypeError('Candidate area or bounds differ from decoded mask geometry.');
  }
  const source = await sharp(sourceBytes, { failOn: 'error', limitInputPixels: 16_777_216 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (
    source.info.width !== request.source.width ||
    source.info.height !== request.source.height ||
    source.info.channels !== 4
  ) {
    throw new TypeError('Decoded normalized source differs from its trusted dimensions.');
  }

  const cropWidth = bounds.rightExclusive - bounds.left;
  const cropHeight = bounds.bottomExclusive - bounds.top;
  const cutout = Buffer.alloc(cropWidth * cropHeight * 4);
  const binaryMask = Buffer.alloc(request.source.width * request.source.height);
  for (let y = 0; y < request.source.height; y += 1) {
    for (let x = 0; x < request.source.width; x += 1) {
      const sourcePixel = y * request.source.width + x;
      if (decoded.pixels[sourcePixel] !== 1) continue;
      binaryMask[sourcePixel] = 255;
      if (
        x < bounds.left ||
        x >= bounds.rightExclusive ||
        y < bounds.top ||
        y >= bounds.bottomExclusive
      ) {
        throw new TypeError('Derived crop does not contain its mask.');
      }
      const sourceOffset = sourcePixel * 4;
      const targetOffset = ((y - bounds.top) * cropWidth + x - bounds.left) * 4;
      const alpha = source.data[sourceOffset + 3]!;
      if (alpha !== 0) {
        cutout[targetOffset] = source.data[sourceOffset]!;
        cutout[targetOffset + 1] = source.data[sourceOffset + 1]!;
        cutout[targetOffset + 2] = source.data[sourceOffset + 2]!;
        cutout[targetOffset + 3] = alpha;
      }
    }
  }

  const [cutoutPng, binaryMaskPng] = await Promise.all([
    sharp(cutout, { raw: { width: cropWidth, height: cropHeight, channels: 4 } })
      .png(pngOptions)
      .toBuffer(),
    sharp(binaryMask, {
      raw: { width: request.source.width, height: request.source.height, channels: 1 },
    })
      .toColourspace('b-w')
      .png(pngOptions)
      .toBuffer(),
  ]);
  if (sha256(sourceBytes) !== sourceDigestBefore || sourceDigestBefore !== request.source.sha256) {
    throw new TypeError('Source bytes changed during cutout materialization.');
  }
  const stem = `${request.source.sha256.slice(0, 16)}__${candidate.candidateId}__${maskSha256.slice(0, 16)}`;
  const filenames = {
    cutout: `${stem}.cutout.png`,
    binaryMask: `${stem}.mask.png`,
    metadata: `${stem}.reproduction.json`,
  };
  const metadata: SamCutoutReproductionMetadata = {
    reproductionVersion: 1,
    sourceSha256: request.source.sha256,
    candidateId: candidate.candidateId,
    maskSha256,
    maskEncoding: 'fabrica-binary-rle-v1',
    sourceDimensions: { width: request.source.width, height: request.source.height },
    crop: {
      left: bounds.left,
      top: bounds.top,
      width: cropWidth,
      height: cropHeight,
    },
    transparentPixelPolicy: 'alpha-zero-implies-rgb-zero',
    cutoutPngSha256: sha256(cutoutPng),
    binaryMaskPngSha256: sha256(binaryMaskPng),
    filenames,
  };
  return {
    cutoutPng: Uint8Array.from(cutoutPng),
    binaryMaskPng: Uint8Array.from(binaryMaskPng),
    metadata,
  };
};
