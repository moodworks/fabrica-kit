import { createHash } from 'node:crypto';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  MAX_RASTER_ENCODED_BYTES,
  MAX_RASTER_METADATA_BYTES,
  RasterSecurityError,
  byteSourceFrom,
  inspectJpegContainer,
  inspectPngContainer,
  normalizeRasterUpload,
  normalizeRasterUploadWithCodec,
  parsePngChunks,
  validateNormalizedPng,
  type RasterCodec,
  type RasterSourceEvidence,
} from '../src/index.js';

// All raster inputs below are synthetic solid pixels generated locally for this repository.
const syntheticRgba = async (width = 3, height = 2): Promise<Buffer> =>
  sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 40, g: 80, b: 120, alpha: 0.75 },
    },
  })
    .raw()
    .toBuffer();

const syntheticPng = async (options?: { interlaced?: boolean; metadata?: boolean }) => {
  let pipeline = sharp(await syntheticRgba(), { raw: { width: 3, height: 2, channels: 4 } });
  if (options?.metadata === true) pipeline = pipeline.withMetadata({ orientation: 1 });
  return pipeline.png({ progressive: options?.interlaced ?? false }).toBuffer();
};

const syntheticJpeg = async (options?: { orientation?: number; progressive?: boolean }) => {
  let pipeline = sharp(await syntheticRgba(2, 3), {
    raw: { width: 2, height: 3, channels: 4 },
  });
  if (options?.orientation !== undefined) {
    pipeline = pipeline.withMetadata({ orientation: options.orientation });
  }
  return pipeline.jpeg({ progressive: options?.progressive ?? false }).toBuffer();
};

const crc32 = (bytes: Uint8Array): number => {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: string, data: Uint8Array): Buffer => {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.byteLength);
  chunk.writeUInt32BE(data.byteLength, 0);
  typeBytes.copy(chunk, 4);
  Buffer.from(data).copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, Buffer.from(data)])), 8 + data.byteLength);
  return chunk;
};

const insertBeforeFirstIdat = (png: Uint8Array, chunk: Uint8Array): Buffer => {
  const idat = parsePngChunks(png).find((entry) => entry.type === 'IDAT');
  if (idat === undefined) throw new TypeError('Synthetic PNG lacks IDAT.');
  return Buffer.concat([
    Buffer.from(png.subarray(0, idat.start)),
    Buffer.from(chunk),
    Buffer.from(png.subarray(idat.start)),
  ]);
};

const rewriteIhdrByte = (png: Uint8Array, relativeOffset: number, value: number): Buffer => {
  const result = Buffer.from(png);
  const ihdr = parsePngChunks(result)[0]!;
  result[ihdr.start + 8 + relativeOffset] = value;
  result.writeUInt32BE(
    crc32(result.subarray(ihdr.start + 4, ihdr.start + 8 + ihdr.length)),
    ihdr.start + 8 + ihdr.length,
  );
  return result;
};

const withJpegMetadataBytes = (jpeg: Uint8Array, totalPayloadBytes: number): Buffer => {
  const segments: Buffer[] = [];
  let remaining = totalPayloadBytes;
  let index = 0;
  while (remaining > 0) {
    const payloadSize = Math.min(65_533, remaining);
    const segment = Buffer.alloc(payloadSize + 4);
    segment[0] = 0xff;
    segment[1] = index % 2 === 0 ? 0xef : 0xfe;
    segment.writeUInt16BE(payloadSize + 2, 2);
    segments.push(segment);
    remaining -= payloadSize;
    index += 1;
  }
  return Buffer.concat([jpeg.subarray(0, 2), ...segments, jpeg.subarray(2)]);
};

const expectRasterCode = async (operation: Promise<unknown>, code: RasterSecurityError['code']) => {
  await expect(operation).rejects.toMatchObject({ name: 'RasterSecurityError', code });
};

describe('raster upload normalization', () => {
  it('uses the pinned Sharp capability under the denied-build policy', () => {
    expect(sharp.versions.sharp).toBe('0.35.3');
    expect(sharp.versions.vips).toMatch(/^8\.18\./u);
  });

  it('normalizes repeated PNG input to byte-identical metadata-free RGBA PNG and digest', async () => {
    const input = await syntheticPng({ metadata: true });

    const first = await normalizeRasterUpload({
      bytes: byteSourceFrom(input, 3),
      declaredMediaType: 'image/png',
      filename: 'synthetic.png',
    });
    const second = await normalizeRasterUpload({
      bytes: byteSourceFrom(input, 5),
      declaredMediaType: 'image/png',
      filename: 'synthetic.png',
    });

    expect(first.bytes).toEqual(second.bytes);
    expect(first.sha256).toBe(second.sha256);
    expect({ byteSize: first.byteSize, sha256: first.sha256 }).toEqual({
      byteSize: 74,
      sha256: '43f051232a2b2bdf54b83fdaec62b017c449b75a4f16b22772c5897c23dacd27',
    });
    expect(createHash('sha256').update(first.bytes).digest('hex')).toBe(
      '43f051232a2b2bdf54b83fdaec62b017c449b75a4f16b22772c5897c23dacd27',
    );
    const pixels = await sharp(first.bytes).raw().toBuffer();
    expect([...pixels.subarray(0, 4)]).toEqual([40, 80, 120, 191]);
    expect(first.mediaType).toBe('image/png');
    expect(first.sourceMediaType).toBe('image/png');
    expect(parsePngChunks(first.bytes).map((chunk) => chunk.type)).toEqual([
      'IHDR',
      'IDAT',
      'IEND',
    ]);
    expect(inspectPngContainer(first.bytes).ancillaryByteSize).toBe(0);
  });

  it('accepts progressive JPEG, applies EXIF orientation, and persists PNG', async () => {
    const input = await syntheticJpeg({ orientation: 6, progressive: true });

    const normalized = await normalizeRasterUpload({
      bytes: byteSourceFrom(input, 7),
      declaredMediaType: 'image/jpeg',
      filename: 'synthetic.JPEG',
    });

    expect(normalized.sourceMediaType).toBe('image/jpeg');
    expect(normalized.mediaType).toBe('image/png');
    expect({ width: normalized.width, height: normalized.height }).toEqual({ width: 3, height: 2 });
    expect(inspectPngContainer(normalized.bytes).ancillaryByteSize).toBe(0);
  });

  it('accepts interlaced PNG then emits the frozen non-interlaced profile', async () => {
    const input = await syntheticPng({ interlaced: true });
    const ihdr = parsePngChunks(input)[0]!;
    expect(input[ihdr.start + 20]).toBe(1);

    const normalized = await normalizeRasterUpload({
      bytes: byteSourceFrom(input),
      declaredMediaType: 'image/png',
      filename: 'interlaced.png',
    });
    const outputIhdr = parsePngChunks(normalized.bytes)[0]!;
    expect(normalized.bytes[outputIhdr.start + 20]).toBe(0);
  });

  it('honors an embedded ICC profile during sRGB conversion and strips it from output', async () => {
    const input = await sharp(await syntheticRgba(), {
      raw: { width: 3, height: 2, channels: 4 },
    })
      .withIccProfile('p3')
      .png()
      .toBuffer();
    expect(parsePngChunks(input).map((chunk) => chunk.type)).toContain('iCCP');

    const normalized = await normalizeRasterUpload({
      bytes: byteSourceFrom(input),
      declaredMediaType: 'image/png',
      filename: 'profiled.png',
    });

    expect(parsePngChunks(normalized.bytes).map((chunk) => chunk.type)).toEqual([
      'IHDR',
      'IDAT',
      'IEND',
    ]);
    const convertedPixels = await sharp(normalized.bytes).raw().toBuffer();
    expect({
      byteSize: normalized.byteSize,
      pixel: [...convertedPixels.subarray(0, 4)],
      sha256: normalized.sha256,
    }).toEqual({
      byteSize: 74,
      pixel: [40, 80, 120, 191],
      sha256: '43f051232a2b2bdf54b83fdaec62b017c449b75a4f16b22772c5897c23dacd27',
    });
  });

  it('enforces the exact ancillary metadata boundary and rejects boundary plus one', async () => {
    const input = await syntheticPng();
    const existingAncillaryBytes = inspectPngContainer(input).ancillaryByteSize;
    const atLimit = insertBeforeFirstIdat(
      input,
      pngChunk('vpAg', Buffer.alloc(MAX_RASTER_METADATA_BYTES - existingAncillaryBytes)),
    );
    const overLimit = insertBeforeFirstIdat(
      input,
      pngChunk('vpAg', Buffer.alloc(MAX_RASTER_METADATA_BYTES - existingAncillaryBytes + 1)),
    );

    expect(inspectPngContainer(atLimit).ancillaryByteSize).toBe(MAX_RASTER_METADATA_BYTES);
    expect(() => inspectPngContainer(overLimit)).toThrowError(
      expect.objectContaining({ code: 'METADATA_LIMIT_EXCEEDED' }),
    );
  });

  it('rejects APNG, truncation, trailing data, oversized dimensions, and corrupt pixels', async () => {
    const input = await syntheticPng();
    const apng = insertBeforeFirstIdat(input, pngChunk('acTL', Buffer.alloc(8)));
    const truncated = input.subarray(0, input.byteLength - 1);
    const trailing = Buffer.concat([input, Buffer.from('PK\x03\x04', 'binary')]);
    const oversized = Buffer.from(input);
    const ihdr = parsePngChunks(oversized)[0]!;
    oversized.writeUInt32BE(4_097, ihdr.start + 8);
    oversized.writeUInt32BE(
      crc32(oversized.subarray(ihdr.start + 4, ihdr.start + 8 + ihdr.length)),
      ihdr.start + 8 + ihdr.length,
    );
    const corruptPixels = Buffer.from(input);
    const idat = parsePngChunks(corruptPixels).find((chunk) => chunk.type === 'IDAT')!;
    corruptPixels[idat.start + 8] = corruptPixels[idat.start + 8]! ^ 0xff;
    corruptPixels.writeUInt32BE(
      crc32(corruptPixels.subarray(idat.start + 4, idat.start + 8 + idat.length)),
      idat.start + 8 + idat.length,
    );

    await expectRasterCode(
      normalizeRasterUpload({
        bytes: byteSourceFrom(apng),
        declaredMediaType: 'image/png',
        filename: 'a.png',
      }),
      'APNG_NOT_ALLOWED',
    );
    await expectRasterCode(
      normalizeRasterUpload({
        bytes: byteSourceFrom(truncated),
        declaredMediaType: 'image/png',
        filename: 'a.png',
      }),
      'RASTER_CONTAINER_INVALID',
    );
    await expectRasterCode(
      normalizeRasterUpload({
        bytes: byteSourceFrom(trailing),
        declaredMediaType: 'image/png',
        filename: 'a.png',
      }),
      'RASTER_TRAILING_DATA',
    );
    await expectRasterCode(
      normalizeRasterUpload({
        bytes: byteSourceFrom(oversized),
        declaredMediaType: 'image/png',
        filename: 'a.png',
      }),
      'RASTER_DIMENSION_INVALID',
    );
    await expectRasterCode(
      normalizeRasterUpload({
        bytes: byteSourceFrom(corruptPixels),
        declaredMediaType: 'image/png',
        filename: 'a.png',
      }),
      'RASTER_CONTAINER_INVALID',
    );
  });

  it('rejects malformed IHDR profiles, reserved chunk bits, unknown critical chunks, and animation chunks', async () => {
    const input = await syntheticPng();
    for (const malformed of [
      rewriteIhdrByte(input, 8, 3),
      rewriteIhdrByte(input, 10, 1),
      rewriteIhdrByte(input, 11, 1),
      rewriteIhdrByte(input, 12, 2),
      insertBeforeFirstIdat(input, pngChunk('vpag', Buffer.alloc(0))),
      insertBeforeFirstIdat(input, pngChunk('ABCD', Buffer.alloc(0))),
    ]) {
      expect(() => inspectPngContainer(malformed)).toThrowError(
        expect.objectContaining({ code: 'RASTER_CONTAINER_INVALID' }),
      );
    }
    for (const type of ['acTL', 'fcTL', 'fdAT']) {
      expect(() =>
        inspectPngContainer(insertBeforeFirstIdat(input, pngChunk(type, Buffer.alloc(8)))),
      ).toThrowError(expect.objectContaining({ code: 'APNG_NOT_ALLOWED' }));
    }
  });

  it('rejects a palette after image data and non-contiguous IDAT chunks', async () => {
    const input = await syntheticPng();
    const chunks = parsePngChunks(input);
    const iend = chunks.at(-1)!;
    const paletteAfterData = Buffer.concat([
      input.subarray(0, iend.start),
      pngChunk('PLTE', Uint8Array.from([0, 0, 0])),
      input.subarray(iend.start),
    ]);
    expect(() => inspectPngContainer(paletteAfterData)).toThrowError(
      expect.objectContaining({ code: 'RASTER_CONTAINER_INVALID' }),
    );

    const idat = chunks.find((chunk) => chunk.type === 'IDAT')!;
    const data = input.subarray(idat.start + 8, idat.start + 8 + idat.length);
    const midpoint = Math.max(1, Math.floor(data.length / 2));
    const separatedIdat = Buffer.concat([
      input.subarray(0, idat.start),
      pngChunk('IDAT', data.subarray(0, midpoint)),
      pngChunk('vpAg', Buffer.alloc(0)),
      pngChunk('IDAT', data.subarray(midpoint)),
      input.subarray(idat.end),
    ]);
    expect(() => inspectPngContainer(separatedIdat)).toThrowError(
      expect.objectContaining({ code: 'RASTER_CONTAINER_INVALID' }),
    );
  });

  it('rejects JPEG trailing polyglot bytes and truncation before Sharp', async () => {
    const jpeg = await syntheticJpeg({ progressive: true });
    const trailing = Buffer.concat([jpeg, Buffer.from('PK\x05\x06', 'binary')]);
    const oversized = Buffer.from(jpeg);
    const sof = oversized.findIndex(
      (value, index) => value === 0xff && [0xc0, 0xc1, 0xc2].includes(oversized[index + 1] ?? 0),
    );
    if (sof < 0) throw new TypeError('Synthetic JPEG lacks SOF.');
    oversized.writeUInt16BE(4_097, sof + 7);

    await expectRasterCode(
      normalizeRasterUpload({
        bytes: byteSourceFrom(trailing),
        declaredMediaType: 'image/jpeg',
        filename: 'a.jpg',
      }),
      'RASTER_TRAILING_DATA',
    );
    await expectRasterCode(
      normalizeRasterUpload({
        bytes: byteSourceFrom(jpeg.subarray(0, -2)),
        declaredMediaType: 'image/jpeg',
        filename: 'a.jpg',
      }),
      'RASTER_CONTAINER_INVALID',
    );
    await expectRasterCode(
      normalizeRasterUpload({
        bytes: byteSourceFrom(oversized),
        declaredMediaType: 'image/jpeg',
        filename: 'a.jpg',
      }),
      'RASTER_DIMENSION_INVALID',
    );
  });

  it('enforces combined JPEG APP/COM metadata at the exact boundary and plus one', async () => {
    const jpeg = await syntheticJpeg({ progressive: true });
    const atLimit = withJpegMetadataBytes(jpeg, MAX_RASTER_METADATA_BYTES);
    const overLimit = withJpegMetadataBytes(jpeg, MAX_RASTER_METADATA_BYTES + 1);

    expect(inspectJpegContainer(atLimit).ancillaryByteSize).toBe(MAX_RASTER_METADATA_BYTES);
    expect(() => inspectJpegContainer(overLimit)).toThrowError(
      expect.objectContaining({ code: 'METADATA_LIMIT_EXCEEDED' }),
    );
  });

  it.each([
    ['wrong.gif', 'image/png', 'UNSUPPORTED_RASTER_TYPE'],
    ['wrong.jpg', 'image/png', 'RASTER_MAGIC_MISMATCH'],
    ['../wrong.png', 'image/png', 'FILENAME_INVALID'],
    ['wrong\\name.png', 'image/png', 'FILENAME_INVALID'],
    ['Cafe\u0301.png', 'image/png', 'FILENAME_INVALID'],
    ['bad\u202E.png', 'image/png', 'FILENAME_INVALID'],
    ['.png/evil.png', 'image/png', 'FILENAME_INVALID'],
    ['.', 'image/png', 'FILENAME_INVALID'],
    ['..', 'image/png', 'FILENAME_INVALID'],
    ['wrong.png', 'image/jpg', 'UNSUPPORTED_RASTER_TYPE'],
  ])('rejects filename/MIME case %#', async (filename, mediaType, code) => {
    const png = await syntheticPng();
    await expectRasterCode(
      normalizeRasterUpload({ bytes: byteSourceFrom(png), declaredMediaType: mediaType, filename }),
      code as RasterSecurityError['code'],
    );
  });

  it('rejects extension/MIME/magic disagreement', async () => {
    const jpeg = await syntheticJpeg();
    await expectRasterCode(
      normalizeRasterUpload({
        bytes: byteSourceFrom(jpeg),
        declaredMediaType: 'image/png',
        filename: 'wrong.png',
      }),
      'RASTER_MAGIC_MISMATCH',
    );
    await expectRasterCode(
      normalizeRasterUpload({
        bytes: byteSourceFrom(Buffer.from('PK\x03\x04archive', 'binary')),
        declaredMediaType: 'image/png',
        filename: 'wrong.png',
      }),
      'RASTER_MAGIC_MISMATCH',
    );
  });

  it('enforces filename code-point and UTF-8 byte limits at their boundaries', async () => {
    const png = await syntheticPng();
    const exact120CodePoints = `${'a'.repeat(116)}.png`;
    await expect(
      normalizeRasterUpload({
        bytes: byteSourceFrom(png),
        declaredMediaType: 'image/png',
        filename: exact120CodePoints,
      }),
    ).resolves.toMatchObject({ displayFilename: exact120CodePoints });

    await expectRasterCode(
      normalizeRasterUpload({
        bytes: byteSourceFrom(png),
        declaredMediaType: 'image/png',
        filename: `${'a'.repeat(117)}.png`,
      }),
      'FILENAME_INVALID',
    );
    await expectRasterCode(
      normalizeRasterUpload({
        bytes: byteSourceFrom(png),
        declaredMediaType: 'image/png',
        filename: `${'😀'.repeat(116)}.png`,
      }),
      'FILENAME_INVALID',
    );
  });

  it('stops bounded intake before accepting a byte beyond 20 MiB', async () => {
    const input = await syntheticPng();
    const source = {
      async *[Symbol.asyncIterator]() {
        yield input;
        yield new Uint8Array(MAX_RASTER_ENCODED_BYTES - input.byteLength + 1);
      },
    };
    await expectRasterCode(
      normalizeRasterUpload({
        bytes: source,
        declaredMediaType: 'image/png',
        filename: 'large.png',
      }),
      'INPUT_FILE_TOO_LARGE',
    );
  });

  it('rechecks sanitized output size independently of input size', async () => {
    const input = await syntheticPng();
    const oversizedCodec: RasterCodec = {
      async normalize(_bytes, evidence) {
        return {
          bytes: new Uint8Array(MAX_RASTER_ENCODED_BYTES + 1),
          height: evidence.orientedHeight,
          orientationTransform: evidence.orientationTransform,
          orientedPixelSha256: evidence.orientedPixelSha256,
          sourceHeight: evidence.height,
          sourceMediaType: evidence.mediaType,
          sourceOrientation: evidence.orientation,
          sourceWidth: evidence.width,
          width: evidence.orientedWidth,
        };
      },
    };
    await expectRasterCode(
      normalizeRasterUploadWithCodec(
        { bytes: byteSourceFrom(input), declaredMediaType: 'image/png', filename: 'safe.png' },
        oversizedCodec,
      ),
      'SANITIZED_FILE_TOO_LARGE',
    );
  });

  it('rejects public normalized-PNG validation outside encoded byte bounds', async () => {
    await expectRasterCode(validateNormalizedPng(new Uint8Array()), 'RASTER_CONTAINER_INVALID');
    await expectRasterCode(
      validateNormalizedPng(new Uint8Array(MAX_RASTER_ENCODED_BYTES + 1)),
      'SANITIZED_FILE_TOO_LARGE',
    );
  });

  it('rejects codec substitution, false output reports, format mismatch, and illegal dimensions', async () => {
    const input = await syntheticPng();
    const canonical = await normalizeRasterUpload({
      bytes: byteSourceFrom(input),
      declaredMediaType: 'image/png',
      filename: 'canonical.png',
    });
    const unrelatedInput = await sharp({
      create: {
        width: 3,
        height: 2,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const unrelated = await normalizeRasterUpload({
      bytes: byteSourceFrom(unrelatedInput),
      declaredMediaType: 'image/png',
      filename: 'unrelated.png',
    });
    const smallerInput = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 0, g: 255, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const smaller = await normalizeRasterUpload({
      bytes: byteSourceFrom(smallerInput),
      declaredMediaType: 'image/png',
      filename: 'smaller.png',
    });

    const resultFor = (
      evidence: RasterSourceEvidence,
      bytes: Uint8Array,
      overrides: Partial<Awaited<ReturnType<RasterCodec['normalize']>>> = {},
    ) => ({
      bytes,
      height: evidence.orientedHeight,
      orientationTransform: evidence.orientationTransform,
      orientedPixelSha256: evidence.orientedPixelSha256,
      sourceHeight: evidence.height,
      sourceMediaType: evidence.mediaType,
      sourceOrientation: evidence.orientation,
      sourceWidth: evidence.width,
      width: evidence.orientedWidth,
      ...overrides,
    });
    const cases: readonly RasterCodec[] = [
      {
        async normalize(_bytes, evidence) {
          return resultFor(evidence, unrelated.bytes);
        },
      },
      {
        async normalize(_bytes, evidence) {
          return resultFor(evidence, canonical.bytes, { width: 2, height: 2 });
        },
      },
      {
        async normalize(_bytes, evidence) {
          return resultFor(evidence, canonical.bytes, { sourceMediaType: 'image/jpeg' });
        },
      },
      {
        async normalize(_bytes, evidence) {
          return resultFor(evidence, smaller.bytes);
        },
      },
    ];

    for (const codec of cases) {
      await expectRasterCode(
        normalizeRasterUploadWithCodec(
          { bytes: byteSourceFrom(input), declaredMediaType: 'image/png', filename: 'input.png' },
          codec,
        ),
        'RASTER_DECODER_MISMATCH',
      );
    }
  });
});
