export const MAX_RASTER_ENCODED_BYTES = 20_971_520;
export const MAX_RASTER_SIDE = 4_096;
export const MAX_RASTER_PIXELS = 16_777_216;
export const MAX_RASTER_RGBA_BYTES = 67_108_864;
export const MAX_RASTER_METADATA_BYTES = 1_048_576;

export type RasterSecurityCode =
  | 'APNG_NOT_ALLOWED'
  | 'FILENAME_INVALID'
  | 'INPUT_FILE_TOO_LARGE'
  | 'METADATA_LIMIT_EXCEEDED'
  | 'RASTER_CONTAINER_INVALID'
  | 'RASTER_DECODER_MISMATCH'
  | 'RASTER_DIMENSION_INVALID'
  | 'RASTER_MAGIC_MISMATCH'
  | 'RASTER_TRAILING_DATA'
  | 'SANITIZED_FILE_TOO_LARGE'
  | 'UNSUPPORTED_RASTER_TYPE';

export class RasterSecurityError extends Error {
  readonly code: RasterSecurityCode;

  constructor(code: RasterSecurityCode, message: string) {
    super(message);
    this.name = 'RasterSecurityError';
    this.code = code;
  }
}

export interface RasterContainerInfo {
  readonly ancillaryByteSize: number;
  readonly height: number;
  readonly mediaType: 'image/jpeg' | 'image/png';
  readonly width: number;
}

export interface PngChunk {
  readonly end: number;
  readonly length: number;
  readonly start: number;
  readonly type: string;
}

const pngSignature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const pngTypePattern = /^[A-Za-z]{4}$/;

const fail = (code: RasterSecurityCode, message: string): never => {
  throw new RasterSecurityError(code, message);
};

const enforceDimensions = (width: number, height: number): void => {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > MAX_RASTER_SIDE ||
    height > MAX_RASTER_SIDE ||
    width * height > MAX_RASTER_PIXELS ||
    width * height * 4 > MAX_RASTER_RGBA_BYTES
  ) {
    fail('RASTER_DIMENSION_INVALID', 'Raster dimensions or decoded RGBA allocation exceed limits.');
  }
};

const crc32 = (bytes: Uint8Array, start: number, end: number): number => {
  let crc = 0xffffffff;
  for (let index = start; index < end; index += 1) {
    crc ^= bytes[index]!;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const hasPngSignature = (bytes: Uint8Array): boolean =>
  bytes.length >= pngSignature.length &&
  pngSignature.every((value, index) => bytes[index] === value);

export const parsePngChunks = (bytes: Uint8Array): readonly PngChunk[] => {
  if (!hasPngSignature(bytes)) {
    fail('RASTER_MAGIC_MISMATCH', 'PNG signature does not match the declared media type.');
  }

  const chunks: PngChunk[] = [];
  let cursor = pngSignature.length;
  let sawIend = false;

  while (cursor < bytes.length) {
    if (sawIend) {
      fail('RASTER_TRAILING_DATA', 'PNG contains bytes after its IEND chunk.');
    }
    if (cursor + 12 > bytes.length) {
      fail('RASTER_CONTAINER_INVALID', 'PNG chunk header or checksum is truncated.');
    }

    const start = cursor;
    const length = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).readUInt32BE(
      cursor,
    );
    const typeStart = cursor + 4;
    const type = Buffer.from(bytes.buffer, bytes.byteOffset + typeStart, 4).toString('ascii');
    if (!pngTypePattern.test(type) || (type.charCodeAt(2) & 0x20) !== 0) {
      fail('RASTER_CONTAINER_INVALID', 'PNG chunk type is invalid.');
    }

    const dataStart = cursor + 8;
    const dataEnd = dataStart + length;
    const end = dataEnd + 4;
    if (!Number.isSafeInteger(end) || end > bytes.length) {
      fail('RASTER_CONTAINER_INVALID', 'PNG chunk length exceeds the bounded input.');
    }

    const expectedCrc = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).readUInt32BE(
      dataEnd,
    );
    if (crc32(bytes, typeStart, dataEnd) !== expectedCrc) {
      fail('RASTER_CONTAINER_INVALID', `PNG ${type} checksum is invalid.`);
    }

    chunks.push({ start, end, length, type });
    cursor = end;
    sawIend = type === 'IEND';
  }

  if (!sawIend || cursor !== bytes.length) {
    fail('RASTER_CONTAINER_INVALID', 'PNG must end with one complete IEND chunk.');
  }
  return chunks;
};

export const inspectPngContainer = (bytes: Uint8Array): RasterContainerInfo => {
  const chunks = parsePngChunks(bytes);
  if (chunks[0]?.type !== 'IHDR' || chunks[0].length !== 13) {
    fail('RASTER_CONTAINER_INVALID', 'PNG must begin with one 13-byte IHDR chunk.');
  }

  let ancillaryByteSize = 0;
  let idatCount = 0;
  let ihdrCount = 0;
  let iendCount = 0;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let sawPlte = false;
  let idatEnded = false;

  for (const [index, chunk] of chunks.entries()) {
    if (['acTL', 'fcTL', 'fdAT'].includes(chunk.type)) {
      fail('APNG_NOT_ALLOWED', 'Animated PNG is not accepted.');
    }
    const isCritical = (chunk.type.charCodeAt(0) & 0x20) === 0;
    if (isCritical && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(chunk.type)) {
      fail('RASTER_CONTAINER_INVALID', 'PNG contains an unknown critical chunk.');
    }
    if ((chunk.type.charCodeAt(0) & 0x20) !== 0) {
      ancillaryByteSize += chunk.length;
      if (ancillaryByteSize > MAX_RASTER_METADATA_BYTES) {
        fail('METADATA_LIMIT_EXCEEDED', 'PNG ancillary payload exceeds 1 MiB.');
      }
    }
    if (chunk.type === 'IHDR') {
      ihdrCount += 1;
      const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      width = buffer.readUInt32BE(chunk.start + 8);
      height = buffer.readUInt32BE(chunk.start + 12);
      bitDepth = bytes[chunk.start + 16]!;
      colorType = bytes[chunk.start + 17]!;
      const validBitDepth =
        (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth)) ||
        (colorType === 2 && [8, 16].includes(bitDepth)) ||
        (colorType === 3 && [1, 2, 4, 8].includes(bitDepth)) ||
        ((colorType === 4 || colorType === 6) && [8, 16].includes(bitDepth));
      if (
        index !== 0 ||
        !validBitDepth ||
        bytes[chunk.start + 18] !== 0 ||
        bytes[chunk.start + 19] !== 0 ||
        ![0, 1].includes(bytes[chunk.start + 20]!)
      ) {
        fail('RASTER_CONTAINER_INVALID', 'PNG IHDR profile is invalid.');
      }
    } else if (chunk.type === 'PLTE') {
      if (
        sawPlte ||
        idatCount > 0 ||
        colorType === 0 ||
        colorType === 4 ||
        chunk.length < 3 ||
        chunk.length > 768 ||
        chunk.length % 3 !== 0 ||
        (colorType === 3 && chunk.length / 3 > 2 ** bitDepth)
      ) {
        fail('RASTER_CONTAINER_INVALID', 'PNG palette chunk is invalid or out of order.');
      }
      sawPlte = true;
    } else if (chunk.type === 'IDAT') {
      if (idatEnded) {
        fail('RASTER_CONTAINER_INVALID', 'PNG IDAT chunks must be contiguous.');
      }
      idatCount += 1;
    } else if (chunk.type === 'IEND') {
      iendCount += 1;
      if (chunk.length !== 0) {
        fail('RASTER_CONTAINER_INVALID', 'PNG IEND chunk must be empty.');
      }
    }
    if (idatCount > 0 && chunk.type !== 'IDAT') idatEnded = true;
  }

  if (
    ihdrCount !== 1 ||
    idatCount < 1 ||
    iendCount !== 1 ||
    chunks.at(-1)?.type !== 'IEND' ||
    (colorType === 3 && !sawPlte)
  ) {
    fail('RASTER_CONTAINER_INVALID', 'PNG requires one IHDR, image data, and one final IEND.');
  }
  enforceDimensions(width, height);
  return { ancillaryByteSize, height, mediaType: 'image/png', width };
};

const isSofMarker = (marker: number): boolean =>
  [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);

const isStandaloneJpegMarker = (marker: number): boolean =>
  marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7);

export const inspectJpegContainer = (bytes: Uint8Array): RasterContainerInfo => {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    fail('RASTER_MAGIC_MISMATCH', 'JPEG signature does not match the declared media type.');
  }

  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let cursor = 2;
  let ancillaryByteSize = 0;
  let height = 0;
  let width = 0;
  let sawEoi = false;
  let sawScan = false;
  let inEntropyData = false;

  while (cursor < bytes.length) {
    if (inEntropyData) {
      if (bytes[cursor] !== 0xff) {
        cursor += 1;
        continue;
      }
      const markerStart = cursor;
      while (cursor < bytes.length && bytes[cursor] === 0xff) cursor += 1;
      if (cursor >= bytes.length) {
        fail('RASTER_CONTAINER_INVALID', 'JPEG entropy data is truncated.');
      }
      const marker = bytes[cursor]!;
      if (marker === 0x00 || (marker >= 0xd0 && marker <= 0xd7)) {
        cursor += 1;
        continue;
      }
      cursor = markerStart;
      inEntropyData = false;
      continue;
    }

    if (bytes[cursor] !== 0xff) {
      fail('RASTER_CONTAINER_INVALID', 'JPEG marker framing is invalid.');
    }
    while (cursor < bytes.length && bytes[cursor] === 0xff) cursor += 1;
    if (cursor >= bytes.length) {
      fail('RASTER_CONTAINER_INVALID', 'JPEG marker is truncated.');
    }
    const marker = bytes[cursor]!;
    cursor += 1;

    if (marker === 0xd9) {
      sawEoi = true;
      if (cursor !== bytes.length) {
        fail('RASTER_TRAILING_DATA', 'JPEG contains bytes after its EOI marker.');
      }
      break;
    }
    if (marker === 0xd8 || marker === 0x00) {
      fail('RASTER_CONTAINER_INVALID', 'JPEG contains an invalid embedded marker.');
    }
    if (isStandaloneJpegMarker(marker)) continue;
    if (cursor + 2 > bytes.length) {
      fail('RASTER_CONTAINER_INVALID', 'JPEG segment length is truncated.');
    }

    const segmentLength = buffer.readUInt16BE(cursor);
    if (segmentLength < 2) {
      fail('RASTER_CONTAINER_INVALID', 'JPEG segment length is invalid.');
    }
    const payloadStart = cursor + 2;
    const segmentEnd = cursor + segmentLength;
    if (segmentEnd > bytes.length) {
      fail('RASTER_CONTAINER_INVALID', 'JPEG segment exceeds the bounded input.');
    }

    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      ancillaryByteSize += segmentLength - 2;
      if (ancillaryByteSize > MAX_RASTER_METADATA_BYTES) {
        fail('METADATA_LIMIT_EXCEEDED', 'JPEG metadata payload exceeds 1 MiB.');
      }
    }

    if (isSofMarker(marker)) {
      if (segmentLength < 8) {
        fail('RASTER_CONTAINER_INVALID', 'JPEG frame header is truncated.');
      }
      const nextHeight = buffer.readUInt16BE(payloadStart + 1);
      const nextWidth = buffer.readUInt16BE(payloadStart + 3);
      if ((width !== 0 || height !== 0) && (width !== nextWidth || height !== nextHeight)) {
        fail('RASTER_CONTAINER_INVALID', 'JPEG frame headers contain contradictory dimensions.');
      }
      width = nextWidth;
      height = nextHeight;
      enforceDimensions(width, height);
    }

    cursor = segmentEnd;
    if (marker === 0xda) {
      sawScan = true;
      inEntropyData = true;
    }
  }

  if (!sawEoi || !sawScan || width === 0 || height === 0) {
    fail('RASTER_CONTAINER_INVALID', 'JPEG requires a frame, scan data, and a final EOI marker.');
  }
  enforceDimensions(width, height);
  return { ancillaryByteSize, height, mediaType: 'image/jpeg', width };
};

export const inspectRasterContainer = (
  bytes: Uint8Array,
  mediaType: 'image/jpeg' | 'image/png',
): RasterContainerInfo =>
  mediaType === 'image/png' ? inspectPngContainer(bytes) : inspectJpegContainer(bytes);

export const stripPngAncillaryChunks = (bytes: Uint8Array): Uint8Array => {
  const chunks = parsePngChunks(bytes);
  for (const chunk of chunks) {
    const isCritical = (chunk.type.charCodeAt(0) & 0x20) === 0;
    if (isCritical && !['IHDR', 'IDAT', 'IEND'].includes(chunk.type)) {
      fail('RASTER_CONTAINER_INVALID', 'Normalized PNG contains an unsupported critical chunk.');
    }
  }
  const retained = chunks.filter((chunk) => ['IHDR', 'IDAT', 'IEND'].includes(chunk.type));
  if (retained[0]?.type !== 'IHDR' || retained.at(-1)?.type !== 'IEND') {
    fail('RASTER_CONTAINER_INVALID', 'Normalized PNG structural chunks are invalid.');
  }
  return Buffer.concat([
    Buffer.from(pngSignature),
    ...retained.map((chunk) => Buffer.from(bytes.subarray(chunk.start, chunk.end))),
  ]);
};

export const assertCanonicalNormalizedPng = (bytes: Uint8Array): RasterContainerInfo => {
  const chunks = parsePngChunks(bytes);
  if (chunks.some((chunk) => !['IHDR', 'IDAT', 'IEND'].includes(chunk.type))) {
    fail('RASTER_CONTAINER_INVALID', 'Normalized PNG contains a non-canonical chunk.');
  }
  const ihdr = chunks[0];
  if (
    ihdr?.type !== 'IHDR' ||
    ihdr.length !== 13 ||
    bytes[ihdr.start + 16] !== 8 ||
    bytes[ihdr.start + 17] !== 6 ||
    bytes[ihdr.start + 18] !== 0 ||
    bytes[ihdr.start + 19] !== 0 ||
    bytes[ihdr.start + 20] !== 0
  ) {
    fail(
      'RASTER_CONTAINER_INVALID',
      'Normalized PNG must be non-interlaced 8-bit RGBA with standard compression and filtering.',
    );
  }
  return inspectPngContainer(bytes);
};
