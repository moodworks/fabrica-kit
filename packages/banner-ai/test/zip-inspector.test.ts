import { Readable } from 'node:stream';
import { deflateRawSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';
import { ZipFile } from 'yazl';

import {
  MAX_ZIP_ARCHIVE_BYTES,
  MAX_ZIP_ENTRY_BYTES,
  MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES,
  createExactZipContentPolicy,
  inspectZipBytes,
  type ZipContentPolicy,
  type ZipSecurityCode,
} from '../src/index.js';

interface TestZipEntry {
  readonly bytes: Uint8Array;
  readonly mode?: number;
  readonly name: string;
  readonly stream?: boolean;
}

const zipDate = new Date(1980, 0, 1, 0, 0, 0, 0);

const createZip = async (
  entries: readonly TestZipEntry[],
  options?: { readonly compress?: boolean },
): Promise<Buffer> => {
  const zip = new ZipFile();
  for (const entry of entries) {
    const fileOptions = {
      compress: options?.compress ?? true,
      compressionLevel: options?.compress === false ? 0 : 9,
      forceDosTimestamp: true,
      forceZip64Format: false,
      mode: entry.mode ?? 0o100644,
      mtime: zipDate,
    };
    if (entry.stream === true) {
      zip.addReadStream(Readable.from([entry.bytes]), entry.name, {
        ...fileOptions,
        size: entry.bytes.byteLength,
      });
    } else {
      zip.addBuffer(Buffer.from(entry.bytes), entry.name, fileOptions);
    }
  }
  zip.end({ comment: '', forceZip64Format: false });
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

const updateCrc32 = (crc: number, bytes: Uint8Array): number => {
  let next = crc;
  for (const value of bytes) {
    next ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      next = (next >>> 1) ^ (next & 1 ? 0xedb88320 : 0);
    }
  }
  return next;
};

const crc32 = (bytes: Uint8Array): number => (updateCrc32(0xffffffff, bytes) ^ 0xffffffff) >>> 0;

const createRawSingleEntryZip = (input: {
  readonly centralExtra?: Uint8Array;
  readonly compressedBytes: Uint8Array;
  readonly declaredUncompressedSize: number;
  readonly localExtra?: Uint8Array;
  readonly method: 0 | 8;
  readonly name?: string;
  readonly uncompressedBytes: Uint8Array;
}): Buffer => {
  const name = Buffer.from(input.name ?? 'entry.bin', 'utf8');
  const compressed = Buffer.from(input.compressedBytes);
  const localExtra = Buffer.from(input.localExtra ?? []);
  const centralExtra = Buffer.from(input.centralExtra ?? localExtra);
  const checksum = crc32(input.uncompressedBytes);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0800, 6);
  local.writeUInt16LE(input.method, 8);
  local.writeUInt16LE(0, 10);
  local.writeUInt16LE(33, 12);
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(compressed.byteLength, 18);
  local.writeUInt32LE(input.declaredUncompressedSize, 22);
  local.writeUInt16LE(name.byteLength, 26);
  local.writeUInt16LE(localExtra.byteLength, 28);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(0x033f, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0800, 8);
  central.writeUInt16LE(input.method, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(33, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(compressed.byteLength, 20);
  central.writeUInt32LE(input.declaredUncompressedSize, 24);
  central.writeUInt16LE(name.byteLength, 28);
  central.writeUInt16LE(centralExtra.byteLength, 30);
  central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  central.writeUInt32LE(0, 42);

  const localRecord = Buffer.concat([local, name, localExtra, compressed]);
  const centralRecord = Buffer.concat([central, name, centralExtra]);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralRecord.byteLength, 12);
  eocd.writeUInt32LE(localRecord.byteLength, 16);
  return Buffer.concat([localRecord, centralRecord, eocd]);
};

const signatureOffsets = (bytes: Buffer, signature: number): number[] => {
  const signatureBytes = Buffer.alloc(4);
  signatureBytes.writeUInt32LE(signature);
  const offsets: number[] = [];
  let cursor = 0;
  while (cursor <= bytes.byteLength - 4) {
    const offset = bytes.indexOf(signatureBytes, cursor);
    if (offset < 0) break;
    offsets.push(offset);
    cursor = offset + 4;
  }
  return offsets;
};

const replaceEntryName = (archive: Buffer, index: number, replacement: Uint8Array): Buffer => {
  const result = Buffer.from(archive);
  const local = signatureOffsets(result, 0x04034b50)[index];
  const central = signatureOffsets(result, 0x02014b50)[index];
  if (local === undefined || central === undefined)
    throw new TypeError('ZIP fixture entry missing.');
  const localLength = result.readUInt16LE(local + 26);
  const centralLength = result.readUInt16LE(central + 28);
  if (replacement.byteLength !== localLength || replacement.byteLength !== centralLength) {
    throw new TypeError('Replacement ZIP name must retain byte length.');
  }
  Buffer.from(replacement).copy(result, local + 30);
  Buffer.from(replacement).copy(result, central + 46);
  return result;
};

const expectZipCode = async (operation: Promise<unknown>, code: ZipSecurityCode) => {
  await expect(operation).rejects.toMatchObject({ name: 'ZipSecurityError', code });
};

const countingPolicy = (): {
  readonly policy: ZipContentPolicy;
  readonly validations: () => number;
} => {
  let count = 0;
  return {
    policy: {
      finalize() {},
      validateEntry() {
        count += 1;
      },
    },
    validations: () => count,
  };
};

describe('bounded ZIP inspection', () => {
  it('accepts stored empty/content entries, a data descriptor, and inert JSON exit metadata', async () => {
    const archive = await createZip(
      [
        { name: 'empty.bin', bytes: Buffer.alloc(0) },
        { name: 'content.bin', bytes: Buffer.from('synthetic content'), stream: true },
        { name: 'scene.json', bytes: Buffer.from('{"exit":"https://example.com/campaign"}') },
      ],
      { compress: false },
    );

    const inspected = await inspectZipBytes(archive);

    expect(inspected.entries.map((entry) => entry.name)).toEqual([
      'empty.bin',
      'content.bin',
      'scene.json',
    ]);
    expect(inspected.totalCompressedBytes).toBe(inspected.totalUncompressedBytes);
  });

  it.each([
    ['../x', 'ZIP_PATH_INVALID'],
    ['/abs', 'ZIP_PATH_INVALID'],
    ['C:xx', 'ZIP_PATH_INVALID'],
    ['a\\xx', 'ZIP_PATH_INVALID'],
  ] as const)('rejects raw unsafe path %s', async (replacement, code) => {
    const safe = await createZip([{ name: 'safe', bytes: Buffer.from('x') }]);
    await expectZipCode(inspectZipBytes(replaceEntryName(safe, 0, Buffer.from(replacement))), code);
  });

  it('rejects invalid UTF-8, non-NFC names, empty components, NUL, and duplicates', async () => {
    const safe = await createZip([{ name: 'safe', bytes: Buffer.from('x') }]);
    await expectZipCode(
      inspectZipBytes(replaceEntryName(safe, 0, Uint8Array.from([0xff, 0x61, 0x62, 0x63]))),
      'ZIP_UTF8_INVALID',
    );
    await expectZipCode(
      inspectZipBytes(await createZip([{ name: 'e\u0301.txt', bytes: Buffer.from('x') }])),
      'ZIP_PATH_INVALID',
    );
    await expectZipCode(
      inspectZipBytes(await createZip([{ name: 'a//b', bytes: Buffer.from('x') }])),
      'ZIP_PATH_INVALID',
    );
    await expectZipCode(
      inspectZipBytes(replaceEntryName(safe, 0, Uint8Array.from([0x61, 0, 0x62, 0x63]))),
      'ZIP_PATH_INVALID',
    );
    const duplicateBase = await createZip([
      { name: 'one1', bytes: Buffer.from('x') },
      { name: 'two2', bytes: Buffer.from('y') },
    ]);
    await expectZipCode(
      inspectZipBytes(replaceEntryName(duplicateBase, 1, Buffer.from('one1'))),
      'ZIP_PATH_INVALID',
    );
  });

  it('enforces raw name-byte and path-component boundaries', async () => {
    const exactName = `${'a'.repeat(236)}.bin`;
    await expect(
      inspectZipBytes(await createZip([{ name: exactName, bytes: Buffer.from('x') }])),
    ).resolves.toMatchObject({ entries: [expect.objectContaining({ name: exactName })] });
    await expectZipCode(
      inspectZipBytes(
        await createZip([{ name: `${'a'.repeat(237)}.bin`, bytes: Buffer.from('x') }]),
      ),
      'ZIP_PATH_INVALID',
    );
    const sixteenComponents = Array.from({ length: 16 }, () => 'a').join('/');
    await expect(
      inspectZipBytes(await createZip([{ name: sixteenComponents, bytes: Buffer.from('x') }])),
    ).resolves.toBeDefined();
    const seventeenComponents = Array.from({ length: 17 }, () => 'a').join('/');
    await expectZipCode(
      inspectZipBytes(await createZip([{ name: seventeenComponents, bytes: Buffer.from('x') }])),
      'ZIP_PATH_INVALID',
    );
  });

  it.each([
    ['index.html', '<img src="https://example.com/a.png">'],
    ['style.css', '@import "//example.com/a.css";'],
    ['runtime.js', "fetch('ht'+'tps://example.com/data')"],
    ['module.mjs', 'globalThis["fetch"]("//example.com")'],
    ['image.svg', '<image href="//example.com/a.png">'],
    ['refresh.htm', '<meta http-equiv="refresh" content="0;https://example.com">'],
  ])('requires an exporter-owned policy for executable content %s', async (name, content) => {
    await expectZipCode(
      inspectZipBytes(await createZip([{ name, bytes: Buffer.from(content, 'utf8') }])),
      'ZIP_CONTENT_POLICY_REQUIRED',
    );
  });

  it('accepts only byte-exact exporter-owned executable content and is safe to reuse', async () => {
    const expected = [
      { name: 'index.html', bytes: Buffer.from('<main>trusted</main>') },
      { name: 'runtime.js', bytes: Buffer.from("'use strict';") },
    ];
    const policy = createExactZipContentPolicy(expected);
    const exact = await createZip(expected);
    await expect(inspectZipBytes(exact, { contentPolicy: policy })).resolves.toBeDefined();

    const altered = await createZip([
      expected[0]!,
      { name: 'runtime.js', bytes: Buffer.from("'use strict';fetch('//example.com')") },
    ]);
    await expectZipCode(
      inspectZipBytes(altered, { contentPolicy: policy }),
      'ZIP_CONTENT_MISMATCH',
    );
    await expectZipCode(
      inspectZipBytes(await createZip([expected[0]!]), { contentPolicy: policy }),
      'ZIP_CONTENT_MISMATCH',
    );
    await expectZipCode(
      inspectZipBytes(
        await createZip([...expected, { name: 'extra.js', bytes: Buffer.from('void 0') }]),
        { contentPolicy: policy },
      ),
      'ZIP_CONTENT_MISMATCH',
    );
  });

  it('requires strict UTF-8 JSON but permits inert JSON metadata', async () => {
    await expectZipCode(
      inspectZipBytes(
        await createZip([{ name: 'bad.json', bytes: Uint8Array.from([0xff, 0xfe]) }]),
      ),
      'ZIP_JSON_INVALID',
    );
    await expectZipCode(
      inspectZipBytes(await createZip([{ name: 'bad.json', bytes: Buffer.from('{]') }])),
      'ZIP_JSON_INVALID',
    );
    await expect(
      inspectZipBytes(
        await createZip([
          { name: 'scene.json', bytes: Buffer.from('{"url":"https://example.com"}') },
        ]),
      ),
    ).resolves.toBeDefined();
  });

  it('rejects CRC disagreement, encryption, unsupported methods, and local mismatch', async () => {
    const base = await createZip([{ name: 'safe.bin', bytes: Buffer.from('synthetic bytes') }]);
    const local = signatureOffsets(base, 0x04034b50)[0]!;
    const central = signatureOffsets(base, 0x02014b50)[0]!;

    const crc = Buffer.from(base);
    crc.writeUInt32LE(0, local + 14);
    crc.writeUInt32LE(0, central + 16);
    await expectZipCode(inspectZipBytes(crc), 'ZIP_CRC_MISMATCH');

    const encrypted = Buffer.from(base);
    encrypted.writeUInt16LE(encrypted.readUInt16LE(local + 6) | 1, local + 6);
    encrypted.writeUInt16LE(encrypted.readUInt16LE(central + 8) | 1, central + 8);
    await expectZipCode(inspectZipBytes(encrypted), 'ZIP_ENCRYPTED');

    const method = Buffer.from(base);
    method.writeUInt16LE(99, local + 8);
    method.writeUInt16LE(99, central + 10);
    await expectZipCode(inspectZipBytes(method), 'ZIP_INVALID');

    const localMismatch = Buffer.from(base);
    localMismatch.writeUInt16LE(0, local + 8);
    await expectZipCode(inspectZipBytes(localMismatch), 'ZIP_INVALID');
  });

  it('rejects directories, symlinks, devices, sockets, and other special entries', async () => {
    for (const mode of [0o120777, 0o010644, 0o020644, 0o040755, 0o060644, 0o140644]) {
      await expectZipCode(
        inspectZipBytes(await createZip([{ name: 'special.bin', bytes: Buffer.from('x'), mode }])),
        'ZIP_ENTRY_SPECIAL',
      );
    }
  });

  it('rejects ZIP64, multidisk, trailing bytes, bad descriptors, and central padding/count lies', async () => {
    const base = await createZip([
      { name: 'stream.bin', bytes: Buffer.from('streamed bytes'), stream: true },
    ]);
    const eocd = signatureOffsets(base, 0x06054b50).at(-1)!;

    const zip64 = Buffer.from(base);
    zip64.writeUInt16LE(0xffff, eocd + 8);
    zip64.writeUInt16LE(0xffff, eocd + 10);
    await expectZipCode(inspectZipBytes(zip64), 'ZIP64_NOT_ALLOWED');

    const multidisk = Buffer.from(base);
    multidisk.writeUInt16LE(1, eocd + 4);
    await expectZipCode(inspectZipBytes(multidisk), 'ZIP_INVALID');
    await expectZipCode(
      inspectZipBytes(Buffer.concat([base, Buffer.from('trailing')])),
      'ZIP_INVALID',
    );

    const descriptor = signatureOffsets(base, 0x08074b50)[0];
    if (descriptor === undefined) throw new TypeError('Expected data descriptor signature.');
    const corruptDescriptor = Buffer.from(base);
    corruptDescriptor.writeUInt32LE(0, descriptor + 4);
    await expectZipCode(inspectZipBytes(corruptDescriptor), 'ZIP_INVALID');

    const padded = Buffer.concat([
      base.subarray(0, eocd),
      Buffer.from('JUNK'),
      base.subarray(eocd),
    ]);
    const movedEocd = eocd + 4;
    padded.writeUInt32LE(padded.readUInt32LE(movedEocd + 12) + 4, movedEocd + 12);
    await expectZipCode(inspectZipBytes(padded), 'ZIP_INVALID');

    const falseCount = Buffer.from(base);
    falseCount.writeUInt16LE(2, eocd + 8);
    falseCount.writeUInt16LE(2, eocd + 10);
    await expectZipCode(inspectZipBytes(falseCount), 'ZIP_INVALID');
  });

  it('rejects Unicode-path alternate metadata in central and local extras', async () => {
    const bytes = Buffer.from('x');
    const unicodePathExtra = Buffer.from([0x75, 0x70, 0, 0]);
    await expectZipCode(
      inspectZipBytes(
        createRawSingleEntryZip({
          compressedBytes: bytes,
          declaredUncompressedSize: 1,
          method: 0,
          uncompressedBytes: bytes,
          centralExtra: unicodePathExtra,
        }),
      ),
      'ZIP_ALTERNATE_NAME',
    );

    const benignExtra = Buffer.from([0xfe, 0xca, 0, 0]);
    await expectZipCode(
      inspectZipBytes(
        createRawSingleEntryZip({
          compressedBytes: bytes,
          declaredUncompressedSize: 1,
          method: 0,
          uncompressedBytes: bytes,
          centralExtra: benignExtra,
          localExtra: unicodePathExtra,
        }),
      ),
      'ZIP_ALTERNATE_NAME',
    );
  });

  it('rejects local/central name and accepted-extra disagreement', async () => {
    const archive = await createZip([{ name: 'same.bin', bytes: Buffer.from('x') }]);
    const local = signatureOffsets(archive, 0x04034b50)[0]!;
    Buffer.from('evil.bin').copy(archive, local + 30);
    await expectZipCode(inspectZipBytes(archive), 'ZIP_INVALID');

    const bytes = Buffer.from('x');
    await expectZipCode(
      inspectZipBytes(
        createRawSingleEntryZip({
          compressedBytes: bytes,
          declaredUncompressedSize: 1,
          method: 0,
          uncompressedBytes: bytes,
          centralExtra: Buffer.from([0xfe, 0xca, 0, 0]),
          localExtra: Buffer.from([0xef, 0xbe, 0, 0]),
        }),
      ),
      'ZIP_INVALID',
    );
  });

  it('accepts declared and actual ratio 100, but rejects +epsilon before streaming', async () => {
    const uncompressed = Buffer.alloc(1_200);
    const compressed = deflateRawSync(uncompressed, { level: 9 });
    expect(compressed.byteLength).toBe(12);
    const exact = createRawSingleEntryZip({
      compressedBytes: compressed,
      declaredUncompressedSize: 1_200,
      method: 8,
      uncompressedBytes: uncompressed,
    });
    await expect(inspectZipBytes(exact)).resolves.toMatchObject({
      totalCompressedBytes: 12,
      totalUncompressedBytes: 1_200,
    });

    const policyCounter = countingPolicy();
    const epsilon = createRawSingleEntryZip({
      compressedBytes: compressed,
      declaredUncompressedSize: 1_201,
      method: 8,
      uncompressedBytes: uncompressed,
    });
    await expectZipCode(
      inspectZipBytes(epsilon, { contentPolicy: policyCounter.policy }),
      'ZIP_RATIO_EXCEEDED',
    );
    expect(policyCounter.validations()).toBe(0);
  });

  it('rejects deflate trailing data within the declared compressed range', async () => {
    const uncompressed = Buffer.alloc(1_200);
    const compressed = deflateRawSync(uncompressed, { level: 9 });
    const archive = createRawSingleEntryZip({
      compressedBytes: Buffer.concat([compressed, Buffer.from([0])]),
      declaredUncompressedSize: uncompressed.byteLength,
      method: 8,
      uncompressedBytes: uncompressed,
    });
    await expectZipCode(inspectZipBytes(archive), 'ZIP_DEFLATE_TRAILING_DATA');
  });

  it('enforces archive, entry-count, per-entry, compressed-total, and uncompressed-total bounds', async () => {
    await expectZipCode(
      inspectZipBytes(Buffer.alloc(MAX_ZIP_ARCHIVE_BYTES + 1)),
      'ZIP_ARCHIVE_LIMIT_EXCEEDED',
    );
    const many = await createZip(
      Array.from({ length: 257 }, (_, index) => ({
        name: `entry-${String(index).padStart(3, '0')}.bin`,
        bytes: Buffer.from('x'),
      })),
    );
    await expectZipCode(inspectZipBytes(many), 'ZIP_ENTRY_LIMIT_EXCEEDED');

    const declaredLarge = await createZip([{ name: 'large.bin', bytes: Buffer.from('x') }]);
    const local = signatureOffsets(declaredLarge, 0x04034b50)[0]!;
    const central = signatureOffsets(declaredLarge, 0x02014b50)[0]!;
    declaredLarge.writeUInt32LE(MAX_ZIP_ENTRY_BYTES + 1, local + 22);
    declaredLarge.writeUInt32LE(MAX_ZIP_ENTRY_BYTES + 1, central + 24);
    await expectZipCode(inspectZipBytes(declaredLarge), 'ZIP_ENTRY_LIMIT_EXCEEDED');

    const stored = await createZip(
      [
        { name: 'first.bin', bytes: Buffer.alloc(40, 1) },
        { name: 'second.bin', bytes: Buffer.alloc(40, 2) },
        { name: 'third.bin', bytes: Buffer.alloc(20, 3) },
      ],
      { compress: false },
    );
    await expect(inspectZipBytes(stored, { maxTotalCompressedBytes: 100 })).resolves.toMatchObject({
      totalCompressedBytes: 100,
    });
    const compressedCounter = countingPolicy();
    await expectZipCode(
      inspectZipBytes(stored, {
        contentPolicy: compressedCounter.policy,
        maxTotalCompressedBytes: 99,
      }),
      'ZIP_COMPRESSED_TOTAL_EXCEEDED',
    );
    expect(compressedCounter.validations()).toBe(0);

    expect(MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES).toBe(104_857_600);
    const uncompressedCounter = countingPolicy();
    await expectZipCode(
      inspectZipBytes(stored, {
        contentPolicy: uncompressedCounter.policy,
        maxTotalUncompressedBytes: 99,
      }),
      'ZIP_TOTAL_LIMIT_EXCEEDED',
    );
    expect(uncompressedCounter.validations()).toBe(0);
    await expect(
      inspectZipBytes(stored, { maxTotalUncompressedBytes: MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES + 1 }),
    ).rejects.toThrow(/only tighten/);
  });

  it('prevalidates non-overlapping exact local ranges before content streams', async () => {
    const archive = await createZip([
      { name: 'first.bin', bytes: Buffer.from('first') },
      { name: 'second.bin', bytes: Buffer.from('second') },
    ]);
    const central = signatureOffsets(archive, 0x02014b50);
    archive.writeUInt32LE(0, central[1]! + 42);
    const counter = countingPolicy();

    await expectZipCode(inspectZipBytes(archive, { contentPolicy: counter.policy }), 'ZIP_INVALID');
    expect(counter.validations()).toBe(0);
  });
});
