import sharp from 'sharp';

import { sha256Hex } from '../scene/canonical-scene-json.js';
import {
  MAX_RASTER_ENCODED_BYTES,
  MAX_RASTER_PIXELS,
  RasterSecurityError,
  assertCanonicalNormalizedPng,
  inspectRasterContainer,
  stripPngAncillaryChunks,
  type RasterContainerInfo,
} from './raster-container.js';

export type ByteSource = AsyncIterable<Uint8Array> | Iterable<Uint8Array>;

export interface RasterUploadInput {
  readonly bytes: ByteSource;
  readonly declaredMediaType: string;
  readonly filename: string;
}

export interface NormalizedRasterUpload {
  readonly byteSize: number;
  readonly bytes: Uint8Array;
  readonly displayFilename: string;
  readonly height: number;
  readonly mediaType: 'image/png';
  readonly sha256: string;
  readonly sourceMediaType: 'image/jpeg' | 'image/png';
  readonly width: number;
}

export interface RasterCodecResult {
  readonly bytes: Uint8Array;
  readonly height: number;
  readonly orientationTransform: 'identity' | 'swap-axes';
  readonly orientedPixelSha256: string;
  readonly sourceHeight: number;
  readonly sourceMediaType: 'image/jpeg' | 'image/png';
  readonly sourceOrientation: RasterOrientation;
  readonly sourceWidth: number;
  readonly width: number;
}

export interface RasterCodec {
  normalize(bytes: Uint8Array, evidence: RasterSourceEvidence): Promise<RasterCodecResult>;
}

export type RasterOrientation = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface RasterSourceEvidence {
  readonly height: number;
  readonly mediaType: 'image/jpeg' | 'image/png';
  readonly orientation: RasterOrientation;
  readonly orientationTransform: 'identity' | 'swap-axes';
  readonly orientedHeight: number;
  readonly orientedPixelSha256: string;
  readonly orientedRgba: Uint8Array;
  readonly orientedWidth: number;
  readonly width: number;
}

const unsafeFilenamePattern = /[\p{Cc}\u202A-\u202E\u2066-\u2069/\\]/u;
const acceptedExtensions: Readonly<Record<string, 'image/jpeg' | 'image/png'>> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
};

const validateFilename = (filename: string): 'image/jpeg' | 'image/png' => {
  const codePoints = [...filename].length;
  if (
    codePoints < 1 ||
    codePoints > 120 ||
    Buffer.byteLength(filename, 'utf8') > 255 ||
    filename.normalize('NFC') !== filename ||
    filename === '.' ||
    filename === '..' ||
    unsafeFilenamePattern.test(filename)
  ) {
    throw new RasterSecurityError('FILENAME_INVALID', 'Display filename is not safe plain text.');
  }

  const extension = filename.slice(filename.lastIndexOf('.') + 1).toLowerCase();
  const mediaType = acceptedExtensions[extension];
  if (mediaType === undefined) {
    throw new RasterSecurityError(
      'UNSUPPORTED_RASTER_TYPE',
      'Filename extension must be JPG, JPEG, or PNG.',
    );
  }
  return mediaType;
};

const collectBoundedBytes = async (source: ByteSource): Promise<Uint8Array> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of source) {
    if (!(chunk instanceof Uint8Array)) {
      throw new RasterSecurityError(
        'RASTER_CONTAINER_INVALID',
        'Byte source yielded a non-byte chunk.',
      );
    }
    if (chunk.byteLength > MAX_RASTER_ENCODED_BYTES - total) {
      throw new RasterSecurityError('INPUT_FILE_TOO_LARGE', 'Encoded input exceeds 20 MiB.');
    }
    chunks.push(Buffer.from(chunk));
    total += chunk.byteLength;
  }
  if (total === 0) {
    throw new RasterSecurityError('RASTER_CONTAINER_INVALID', 'Encoded input is empty.');
  }
  return Buffer.concat(chunks, total);
};

const decodeNormalizedPng = async (
  bytes: Uint8Array,
): Promise<{ readonly container: RasterContainerInfo; readonly pixelSha256: string }> => {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_RASTER_ENCODED_BYTES) {
    throw new RasterSecurityError(
      bytes.byteLength < 1 ? 'RASTER_CONTAINER_INVALID' : 'SANITIZED_FILE_TOO_LARGE',
      'Normalized PNG byte size is outside its accepted bound.',
    );
  }
  const decoded = await sharp(bytes, {
    failOn: 'warning',
    limitInputChannels: 4,
    limitInputPixels: MAX_RASTER_PIXELS,
    sequentialRead: true,
    unlimited: false,
  })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const container = assertCanonicalNormalizedPng(bytes);
  if (
    decoded.info.width !== container.width ||
    decoded.info.height !== container.height ||
    decoded.info.channels !== 4 ||
    decoded.data.byteLength !== container.width * container.height * 4
  ) {
    throw new RasterSecurityError(
      'RASTER_CONTAINER_INVALID',
      'Normalized PNG did not fully decode to its declared RGBA dimensions.',
    );
  }
  return { container, pixelSha256: sha256Hex(decoded.data) };
};

export const validateNormalizedPng = async (bytes: Uint8Array): Promise<RasterContainerInfo> =>
  (await decodeNormalizedPng(bytes)).container;

const orientationTransform = (
  orientation: RasterOrientation,
): RasterSourceEvidence['orientationTransform'] => (orientation >= 5 ? 'swap-axes' : 'identity');

const asRasterOrientation = (value: number | undefined): RasterOrientation => {
  const orientation = value ?? 1;
  if (!Number.isInteger(orientation) || orientation < 1 || orientation > 8) {
    throw new RasterSecurityError(
      'RASTER_DECODER_MISMATCH',
      'Decoded EXIF orientation is invalid.',
    );
  }
  return orientation as RasterOrientation;
};

const createSharpSourceEvidence = async (bytes: Uint8Array): Promise<RasterSourceEvidence> => {
  try {
    const options = {
      autoOrient: true,
      failOn: 'warning' as const,
      ignoreIcc: false,
      limitInputChannels: 4,
      limitInputPixels: MAX_RASTER_PIXELS,
      pages: 1,
      sequentialRead: true,
      unlimited: false,
    };
    const metadata = await sharp(bytes, options).metadata();
    const mediaType =
      metadata.format === 'jpeg'
        ? 'image/jpeg'
        : metadata.format === 'png'
          ? 'image/png'
          : undefined;
    if (mediaType === undefined || metadata.width === undefined || metadata.height === undefined) {
      throw new RasterSecurityError(
        'RASTER_DECODER_MISMATCH',
        'Pinned decoder did not attest the structural raster format and dimensions.',
      );
    }
    const orientation = asRasterOrientation(metadata.orientation);
    const transform = orientationTransform(orientation);
    const decoded = await sharp(bytes, options)
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const orientedWidth = transform === 'swap-axes' ? metadata.height : metadata.width;
    const orientedHeight = transform === 'swap-axes' ? metadata.width : metadata.height;
    if (
      decoded.info.width !== orientedWidth ||
      decoded.info.height !== orientedHeight ||
      decoded.info.channels !== 4 ||
      decoded.data.byteLength !== orientedWidth * orientedHeight * 4
    ) {
      throw new RasterSecurityError(
        'RASTER_DECODER_MISMATCH',
        'Pinned decoder orientation or RGBA allocation evidence is inconsistent.',
      );
    }
    return {
      height: metadata.height,
      mediaType,
      orientation,
      orientationTransform: transform,
      orientedHeight,
      orientedPixelSha256: sha256Hex(decoded.data),
      orientedRgba: decoded.data,
      orientedWidth,
      width: metadata.width,
    };
  } catch (error) {
    if (error instanceof RasterSecurityError) throw error;
    throw new RasterSecurityError(
      'RASTER_CONTAINER_INVALID',
      'Pinned raster decode or source evidence failed.',
    );
  }
};

export const sharpRasterCodec: RasterCodec = {
  async normalize(_bytes, evidence) {
    try {
      const result = await sharp(evidence.orientedRgba, {
        raw: {
          channels: 4,
          height: evidence.orientedHeight,
          width: evidence.orientedWidth,
        },
      })
        .png({
          adaptiveFiltering: false,
          compressionLevel: 9,
          effort: 10,
          palette: false,
          progressive: false,
        })
        .toBuffer({ resolveWithObject: true });

      const stripped = stripPngAncillaryChunks(result.data);
      return {
        bytes: stripped,
        height: result.info.height,
        orientationTransform: evidence.orientationTransform,
        orientedPixelSha256: evidence.orientedPixelSha256,
        sourceHeight: evidence.height,
        sourceMediaType: evidence.mediaType,
        sourceOrientation: evidence.orientation,
        sourceWidth: evidence.width,
        width: result.info.width,
      };
    } catch (error) {
      if (error instanceof RasterSecurityError) throw error;
      throw new RasterSecurityError(
        'RASTER_CONTAINER_INVALID',
        'Raster decode or normalization failed.',
      );
    }
  },
};

export const normalizeRasterUploadWithCodec = async (
  input: RasterUploadInput,
  codec: RasterCodec,
): Promise<NormalizedRasterUpload> => {
  const extensionMediaType = validateFilename(input.filename);
  if (input.declaredMediaType !== 'image/jpeg' && input.declaredMediaType !== 'image/png') {
    throw new RasterSecurityError(
      'UNSUPPORTED_RASTER_TYPE',
      'Declared MIME must be image/jpeg or image/png.',
    );
  }
  if (extensionMediaType !== input.declaredMediaType) {
    throw new RasterSecurityError(
      'RASTER_MAGIC_MISMATCH',
      'Filename extension and declared MIME do not agree.',
    );
  }

  const encoded = await collectBoundedBytes(input.bytes);
  const inputInfo = inspectRasterContainer(encoded, input.declaredMediaType);
  const evidence = await createSharpSourceEvidence(encoded);
  if (
    evidence.mediaType !== inputInfo.mediaType ||
    evidence.width !== inputInfo.width ||
    evidence.height !== inputInfo.height
  ) {
    throw new RasterSecurityError(
      'RASTER_DECODER_MISMATCH',
      'Pinned decoder source evidence differs from structural container evidence.',
    );
  }
  const normalized = await codec.normalize(encoded, evidence);
  if (
    normalized.sourceMediaType !== evidence.mediaType ||
    normalized.sourceWidth !== evidence.width ||
    normalized.sourceHeight !== evidence.height ||
    normalized.sourceOrientation !== evidence.orientation ||
    normalized.orientationTransform !== evidence.orientationTransform ||
    normalized.orientedPixelSha256 !== evidence.orientedPixelSha256
  ) {
    throw new RasterSecurityError(
      'RASTER_DECODER_MISMATCH',
      'Raster codec source or orientation evidence differs from the pinned decoder.',
    );
  }
  if (normalized.bytes.byteLength > MAX_RASTER_ENCODED_BYTES) {
    throw new RasterSecurityError(
      'SANITIZED_FILE_TOO_LARGE',
      'Sanitized PNG exceeds the 20 MiB encoded limit.',
    );
  }

  const outputInfo = assertCanonicalNormalizedPng(normalized.bytes);
  const decodedOutput = await decodeNormalizedPng(normalized.bytes);
  if (
    outputInfo.ancillaryByteSize !== 0 ||
    outputInfo.width !== normalized.width ||
    outputInfo.height !== normalized.height ||
    outputInfo.width !== evidence.orientedWidth ||
    outputInfo.height !== evidence.orientedHeight ||
    decodedOutput.pixelSha256 !== evidence.orientedPixelSha256
  ) {
    throw new RasterSecurityError(
      'RASTER_DECODER_MISMATCH',
      'Normalized PNG dimensions or decoded pixels differ from pinned source evidence.',
    );
  }

  return {
    byteSize: normalized.bytes.byteLength,
    bytes: Buffer.from(normalized.bytes),
    displayFilename: input.filename,
    height: outputInfo.height,
    mediaType: 'image/png',
    sha256: sha256Hex(normalized.bytes),
    sourceMediaType: inputInfo.mediaType,
    width: outputInfo.width,
  };
};

export const normalizeRasterUpload = (input: RasterUploadInput): Promise<NormalizedRasterUpload> =>
  normalizeRasterUploadWithCodec(input, sharpRasterCodec);

export const byteSourceFrom = (bytes: Uint8Array, chunkSize = bytes.byteLength): ByteSource => {
  if (!Number.isSafeInteger(chunkSize) || chunkSize < 1) {
    throw new TypeError('chunkSize must be a positive safe integer.');
  }
  return {
    *[Symbol.iterator]() {
      for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
        yield bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength));
      }
    },
  };
};
