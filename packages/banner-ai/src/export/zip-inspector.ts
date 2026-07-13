import { createHash } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { inflateRawSync } from 'node:zlib';

import { fromBufferPromise, type Entry, type ZipFile } from 'yauzl';

export const MAX_ZIP_ARCHIVE_BYTES = 52_428_800;
export const MAX_ZIP_ENTRIES = 256;
export const MAX_ZIP_ENTRY_BYTES = 52_428_800;
export const MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES = 104_857_600;
export const MAX_ZIP_RATIO = 100;

export type ZipSecurityCode =
  | 'ZIP64_NOT_ALLOWED'
  | 'ZIP_ALTERNATE_NAME'
  | 'ZIP_ARCHIVE_LIMIT_EXCEEDED'
  | 'ZIP_COMPRESSED_TOTAL_EXCEEDED'
  | 'ZIP_CONTENT_MISMATCH'
  | 'ZIP_CONTENT_POLICY_REQUIRED'
  | 'ZIP_CRC_MISMATCH'
  | 'ZIP_DEFLATE_TRAILING_DATA'
  | 'ZIP_ENCRYPTED'
  | 'ZIP_ENTRY_LIMIT_EXCEEDED'
  | 'ZIP_ENTRY_SPECIAL'
  | 'ZIP_INVALID'
  | 'ZIP_JSON_INVALID'
  | 'ZIP_PATH_INVALID'
  | 'ZIP_RATIO_EXCEEDED'
  | 'ZIP_SIZE_MISMATCH'
  | 'ZIP_TOTAL_LIMIT_EXCEEDED'
  | 'ZIP_UTF8_INVALID';

export class ZipSecurityError extends Error {
  readonly code: ZipSecurityCode;

  constructor(code: ZipSecurityCode, message: string) {
    super(message);
    this.name = 'ZipSecurityError';
    this.code = code;
  }
}

export interface InspectedZipEntry {
  readonly compressedSize: number;
  readonly name: string;
  readonly sha256: string;
  readonly uncompressedSize: number;
}

export interface ZipInspectionResult {
  readonly archiveByteSize: number;
  readonly entries: readonly InspectedZipEntry[];
  readonly totalCompressedBytes: number;
  readonly totalUncompressedBytes: number;
}

export interface ZipContentPolicyEntry extends InspectedZipEntry {
  readonly bytes: Uint8Array;
}

export interface ZipContentPolicy {
  finalize(entries: readonly InspectedZipEntry[]): void;
  validateEntry(entry: ZipContentPolicyEntry): void;
}

export interface ZipInspectionOptions {
  readonly contentPolicy?: ZipContentPolicy;
  /** May only tighten the frozen production compressed total. */
  readonly maxTotalCompressedBytes?: number;
  /** May only tighten the frozen production uncompressed total. */
  readonly maxTotalUncompressedBytes?: number;
}

interface EocdRecord {
  readonly centralDirectoryOffset: number;
  readonly centralDirectorySize: number;
  readonly entryCount: number;
  readonly offset: number;
}

interface RawCentralEntry {
  readonly compressedSize: number;
  readonly compressionMethod: number;
  readonly crc32: number;
  readonly diskNumberStart: number;
  readonly externalFileAttributes: number;
  readonly extraField: Buffer;
  readonly generalPurposeBitFlag: number;
  readonly lastModFileDate: number;
  readonly lastModFileTime: number;
  readonly nameBytes: Buffer;
  readonly relativeOffsetOfLocalHeader: number;
  readonly uncompressedSize: number;
  readonly versionMadeBy: number;
  readonly versionNeededToExtract: number;
}

interface PrevalidatedEntry {
  readonly dataEnd: number;
  readonly dataStart: number;
  readonly entry: Entry;
  readonly name: string;
  readonly rangeEnd: number;
  readonly rangeStart: number;
}

const fatalUtf8Decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
const ambiguousNameExtraFieldIds = new Set([0x6375, 0x7075]);
const executableExtensions = new Set(['css', 'htm', 'html', 'js', 'mjs', 'svg']);

const fail = (code: ZipSecurityCode, message: string): never => {
  throw new ZipSecurityError(code, message);
};

const parseEocd = (bytes: Buffer): EocdRecord => {
  const minimumOffset = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= minimumOffset; offset -= 1) {
    if (bytes.readUInt32LE(offset) !== 0x06054b50) continue;
    const commentLength = bytes.readUInt16LE(offset + 20);
    if (offset + 22 + commentLength !== bytes.length) continue;
    const diskNumber = bytes.readUInt16LE(offset + 4);
    const centralDiskNumber = bytes.readUInt16LE(offset + 6);
    const entriesOnDisk = bytes.readUInt16LE(offset + 8);
    const entryCount = bytes.readUInt16LE(offset + 10);
    const centralDirectorySize = bytes.readUInt32LE(offset + 12);
    const centralDirectoryOffset = bytes.readUInt32LE(offset + 16);
    if (diskNumber !== 0 || centralDiskNumber !== 0 || entriesOnDisk !== entryCount) {
      fail('ZIP_INVALID', 'Multi-disk ZIP archives are not accepted.');
    }
    if (
      entryCount === 0xffff ||
      centralDirectorySize === 0xffffffff ||
      centralDirectoryOffset === 0xffffffff ||
      (offset >= 20 && bytes.readUInt32LE(offset - 20) === 0x07064b50)
    ) {
      fail('ZIP64_NOT_ALLOWED', 'ZIP64 archives are not accepted.');
    }
    if (entryCount < 1 || entryCount > MAX_ZIP_ENTRIES) {
      fail('ZIP_ENTRY_LIMIT_EXCEEDED', 'ZIP entry count is outside 1..256.');
    }
    if (centralDirectoryOffset + centralDirectorySize !== offset) {
      fail('ZIP_INVALID', 'ZIP central directory is not contiguous with EOCD.');
    }
    return { centralDirectoryOffset, centralDirectorySize, entryCount, offset };
  }
  return fail('ZIP_INVALID', 'ZIP EOCD is missing, malformed, or not at exact EOF.');
};

const parseAndValidateExtraFields = (extraField: Buffer, location: string): void => {
  let cursor = 0;
  while (cursor < extraField.length) {
    if (cursor + 4 > extraField.length) {
      fail('ZIP_INVALID', `ZIP ${location} extra field header is truncated.`);
    }
    const id = extraField.readUInt16LE(cursor);
    const length = extraField.readUInt16LE(cursor + 2);
    cursor += 4;
    if (cursor + length > extraField.length) {
      fail('ZIP_INVALID', `ZIP ${location} extra field overruns its record.`);
    }
    if (id === 0x0001) fail('ZIP64_NOT_ALLOWED', 'ZIP64 extra metadata is not accepted.');
    if (ambiguousNameExtraFieldIds.has(id)) {
      fail('ZIP_ALTERNATE_NAME', 'Unicode path/comment alternate metadata is not accepted.');
    }
    cursor += length;
  }
};

const parseRawCentralDirectory = (
  archive: Buffer,
  eocd: EocdRecord,
): readonly RawCentralEntry[] => {
  const entries: RawCentralEntry[] = [];
  let cursor = eocd.centralDirectoryOffset;
  for (let index = 0; index < eocd.entryCount; index += 1) {
    if (cursor + 46 > eocd.offset || archive.readUInt32LE(cursor) !== 0x02014b50) {
      fail('ZIP_INVALID', 'ZIP central directory contains a missing or truncated file header.');
    }
    const fileNameLength = archive.readUInt16LE(cursor + 28);
    const extraFieldLength = archive.readUInt16LE(cursor + 30);
    const fileCommentLength = archive.readUInt16LE(cursor + 32);
    const end = cursor + 46 + fileNameLength + extraFieldLength + fileCommentLength;
    if (end > eocd.offset) {
      fail('ZIP_INVALID', 'ZIP central variable-length fields exceed the central directory.');
    }
    const nameBytes = archive.subarray(cursor + 46, cursor + 46 + fileNameLength);
    const extraField = archive.subarray(
      cursor + 46 + fileNameLength,
      cursor + 46 + fileNameLength + extraFieldLength,
    );
    parseAndValidateExtraFields(extraField, 'central');
    entries.push({
      compressedSize: archive.readUInt32LE(cursor + 20),
      compressionMethod: archive.readUInt16LE(cursor + 10),
      crc32: archive.readUInt32LE(cursor + 16),
      diskNumberStart: archive.readUInt16LE(cursor + 34),
      externalFileAttributes: archive.readUInt32LE(cursor + 38),
      extraField: Buffer.from(extraField),
      generalPurposeBitFlag: archive.readUInt16LE(cursor + 8),
      lastModFileDate: archive.readUInt16LE(cursor + 14),
      lastModFileTime: archive.readUInt16LE(cursor + 12),
      nameBytes: Buffer.from(nameBytes),
      relativeOffsetOfLocalHeader: archive.readUInt32LE(cursor + 42),
      uncompressedSize: archive.readUInt32LE(cursor + 24),
      versionMadeBy: archive.readUInt16LE(cursor + 4),
      versionNeededToExtract: archive.readUInt16LE(cursor + 6),
    });
    cursor = end;
  }
  if (
    cursor !== eocd.offset ||
    cursor - eocd.centralDirectoryOffset !== eocd.centralDirectorySize
  ) {
    fail('ZIP_INVALID', 'ZIP central directory contains padding or unclaimed bytes.');
  }
  return entries;
};

const validateName = (rawName: Buffer, names: Set<string>): string => {
  if (rawName.byteLength < 1 || rawName.byteLength > 240) {
    fail('ZIP_PATH_INVALID', 'ZIP entry name exceeds its UTF-8 byte bound.');
  }
  let name: string;
  try {
    name = fatalUtf8Decoder.decode(rawName);
  } catch {
    throw new ZipSecurityError('ZIP_UTF8_INVALID', 'ZIP entry name is not strict UTF-8.');
  }
  if (!Buffer.from(name, 'utf8').equals(rawName)) {
    fail('ZIP_UTF8_INVALID', 'ZIP entry name is not canonical UTF-8.');
  }
  if (
    name.normalize('NFC') !== name ||
    name.includes('\0') ||
    name.includes('\\') ||
    name.startsWith('/') ||
    /^[A-Za-z]:/.test(name)
  ) {
    fail('ZIP_PATH_INVALID', 'ZIP entry path is unsafe.');
  }
  const components = name.split('/');
  if (
    components.length < 1 ||
    components.length > 16 ||
    components.some((component) => component === '' || component === '.' || component === '..')
  ) {
    fail('ZIP_PATH_INVALID', 'ZIP entry path components are unsafe.');
  }
  if (names.has(name)) fail('ZIP_PATH_INVALID', 'ZIP entry names must be unique.');
  names.add(name);
  return name;
};

const assertRawEntryHeader = (raw: RawCentralEntry): void => {
  if (raw.diskNumberStart !== 0) fail('ZIP_INVALID', 'Multi-disk ZIP entries are not accepted.');
  if ((raw.generalPurposeBitFlag & 0x2041) !== 0) {
    fail('ZIP_ENCRYPTED', 'Encrypted or masked ZIP entries are not accepted.');
  }
  if ((raw.generalPurposeBitFlag & ~(0x0800 | 0x0008)) !== 0) {
    fail('ZIP_INVALID', 'ZIP entry uses unsupported general-purpose flags.');
  }
  if (raw.compressionMethod !== 0 && raw.compressionMethod !== 8) {
    fail('ZIP_INVALID', 'ZIP entry compression method is unsupported.');
  }
  if (raw.versionNeededToExtract >= 45) {
    fail('ZIP64_NOT_ALLOWED', 'ZIP64 entry versions are not accepted.');
  }
  if (raw.uncompressedSize > MAX_ZIP_ENTRY_BYTES) {
    fail('ZIP_ENTRY_LIMIT_EXCEEDED', 'ZIP entry size exceeds its bound.');
  }
  if (
    (raw.compressedSize === 0 && raw.uncompressedSize !== 0) ||
    (raw.compressedSize > 0 && raw.uncompressedSize / raw.compressedSize > MAX_ZIP_RATIO)
  ) {
    fail('ZIP_RATIO_EXCEEDED', 'ZIP declared compression ratio exceeds 100.');
  }
  if (raw.compressionMethod === 0 && raw.compressedSize !== raw.uncompressedSize) {
    fail('ZIP_SIZE_MISMATCH', 'Stored ZIP entry sizes differ.');
  }
  const hostSystem = raw.versionMadeBy >>> 8;
  const unixType = (raw.externalFileAttributes >>> 16) & 0o170000;
  const dosDirectory = (raw.externalFileAttributes & 0x10) !== 0;
  if (dosDirectory || (hostSystem === 3 && unixType !== 0 && unixType !== 0o100000)) {
    fail('ZIP_ENTRY_SPECIAL', 'ZIP contains a directory, symlink, or other special entry.');
  }
};

const descriptorEnd = (
  archive: Buffer,
  raw: RawCentralEntry,
  dataEnd: number,
  centralDirectoryOffset: number,
): number => {
  if ((raw.generalPurposeBitFlag & 0x0008) === 0) return dataEnd;
  let cursor = dataEnd;
  if (cursor + 4 <= centralDirectoryOffset && archive.readUInt32LE(cursor) === 0x08074b50) {
    cursor += 4;
  }
  if (cursor + 12 > centralDirectoryOffset)
    fail('ZIP_INVALID', 'ZIP data descriptor is truncated.');
  if (
    archive.readUInt32LE(cursor) !== raw.crc32 ||
    archive.readUInt32LE(cursor + 4) !== raw.compressedSize ||
    archive.readUInt32LE(cursor + 8) !== raw.uncompressedSize
  ) {
    fail('ZIP_INVALID', 'ZIP data descriptor differs from central metadata.');
  }
  return cursor + 12;
};

const rawMatchesYauzl = (raw: RawCentralEntry, entry: Entry): boolean =>
  raw.compressedSize === entry.compressedSize &&
  raw.compressionMethod === entry.compressionMethod &&
  raw.crc32 === entry.crc32 &&
  raw.externalFileAttributes === entry.externalFileAttributes &&
  raw.generalPurposeBitFlag === entry.generalPurposeBitFlag &&
  raw.lastModFileDate === entry.lastModFileDate &&
  raw.lastModFileTime === entry.lastModFileTime &&
  raw.nameBytes.equals(entry.fileNameRaw) &&
  raw.relativeOffsetOfLocalHeader === entry.relativeOffsetOfLocalHeader &&
  raw.uncompressedSize === entry.uncompressedSize &&
  raw.versionMadeBy === entry.versionMadeBy &&
  raw.versionNeededToExtract === entry.versionNeededToExtract &&
  raw.extraField.equals(entry.extraFieldRaw);

const prevalidateEntries = (
  archive: Buffer,
  eocd: EocdRecord,
  rawEntries: readonly RawCentralEntry[],
  yauzlEntries: readonly Entry[],
  maxTotalCompressedBytes: number,
  maxTotalUncompressedBytes: number,
): readonly PrevalidatedEntry[] => {
  if (rawEntries.length !== yauzlEntries.length) {
    fail('ZIP_INVALID', 'Raw and library central entry counts disagree.');
  }
  const names = new Set<string>();
  const prevalidated: PrevalidatedEntry[] = [];
  let declaredCompressedTotal = 0;
  let declaredUncompressedTotal = 0;
  for (const [index, raw] of rawEntries.entries()) {
    const entry = yauzlEntries[index]!;
    assertRawEntryHeader(raw);
    if (!rawMatchesYauzl(raw, entry)) {
      fail('ZIP_INVALID', 'Raw and library central metadata disagree.');
    }
    const name = validateName(raw.nameBytes, names);
    const localOffset = raw.relativeOffsetOfLocalHeader;
    if (
      localOffset + 30 > eocd.centralDirectoryOffset ||
      archive.readUInt32LE(localOffset) !== 0x04034b50
    ) {
      fail('ZIP_INVALID', 'ZIP local header is missing or truncated.');
    }
    const localNameLength = archive.readUInt16LE(localOffset + 26);
    const localExtraLength = archive.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart > eocd.centralDirectoryOffset) {
      fail('ZIP_INVALID', 'ZIP local variable fields exceed the local-file region.');
    }
    const localName = archive.subarray(localOffset + 30, localOffset + 30 + localNameLength);
    const localExtra = archive.subarray(localOffset + 30 + localNameLength, dataStart);
    parseAndValidateExtraFields(localExtra, 'local');
    if (
      archive.readUInt16LE(localOffset + 4) !== raw.versionNeededToExtract ||
      archive.readUInt16LE(localOffset + 6) !== raw.generalPurposeBitFlag ||
      archive.readUInt16LE(localOffset + 8) !== raw.compressionMethod ||
      archive.readUInt16LE(localOffset + 10) !== raw.lastModFileTime ||
      archive.readUInt16LE(localOffset + 12) !== raw.lastModFileDate ||
      !localName.equals(raw.nameBytes) ||
      !localExtra.equals(raw.extraField)
    ) {
      fail('ZIP_INVALID', 'ZIP local and central headers, names, or extras disagree.');
    }
    const localCrc32 = archive.readUInt32LE(localOffset + 14);
    const localCompressedSize = archive.readUInt32LE(localOffset + 18);
    const localUncompressedSize = archive.readUInt32LE(localOffset + 22);
    if ((raw.generalPurposeBitFlag & 0x0008) === 0) {
      if (
        localCrc32 !== raw.crc32 ||
        localCompressedSize !== raw.compressedSize ||
        localUncompressedSize !== raw.uncompressedSize
      ) {
        fail('ZIP_INVALID', 'ZIP local sizes or CRC differ from central metadata.');
      }
    } else if (
      (localCrc32 !== 0 && localCrc32 !== raw.crc32) ||
      (localCompressedSize !== 0 && localCompressedSize !== raw.compressedSize) ||
      (localUncompressedSize !== 0 && localUncompressedSize !== raw.uncompressedSize)
    ) {
      fail('ZIP_INVALID', 'ZIP descriptor-mode local metadata differs from central metadata.');
    }
    const dataEnd = dataStart + raw.compressedSize;
    if (dataEnd > eocd.centralDirectoryOffset) {
      fail('ZIP_INVALID', 'ZIP compressed data escapes the local-file region.');
    }
    const rangeEnd = descriptorEnd(archive, raw, dataEnd, eocd.centralDirectoryOffset);
    declaredCompressedTotal += raw.compressedSize;
    if (declaredCompressedTotal > maxTotalCompressedBytes) {
      fail('ZIP_COMPRESSED_TOTAL_EXCEEDED', 'ZIP declared compressed total exceeds its bound.');
    }
    declaredUncompressedTotal += raw.uncompressedSize;
    if (declaredUncompressedTotal > maxTotalUncompressedBytes) {
      fail('ZIP_TOTAL_LIMIT_EXCEEDED', 'ZIP declared uncompressed total exceeds its bound.');
    }
    prevalidated.push({
      dataEnd,
      dataStart,
      entry,
      name,
      rangeEnd,
      rangeStart: localOffset,
    });
  }

  const ranges = [...prevalidated].sort((left, right) => left.rangeStart - right.rangeStart);
  let cursor = 0;
  for (const range of ranges) {
    if (range.rangeStart !== cursor || range.rangeEnd <= range.rangeStart) {
      fail('ZIP_INVALID', 'ZIP local ranges overlap, repeat, or conceal unclaimed bytes.');
    }
    cursor = range.rangeEnd;
  }
  if (cursor !== eocd.centralDirectoryOffset) {
    fail('ZIP_INVALID', 'ZIP local-file region contains padding or unclaimed bytes.');
  }
  return prevalidated;
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

const defaultContentPolicy: ZipContentPolicy = {
  validateEntry(entry) {
    const extension = entry.name.slice(entry.name.lastIndexOf('.') + 1).toLowerCase();
    if (executableExtensions.has(extension)) {
      fail(
        'ZIP_CONTENT_POLICY_REQUIRED',
        'Executable/textual package content requires an explicit exporter-owned policy.',
      );
    }
    if (extension === 'json') {
      try {
        JSON.parse(fatalUtf8Decoder.decode(entry.bytes));
      } catch {
        fail('ZIP_JSON_INVALID', 'Generic JSON entry is not strict UTF-8 JSON.');
      }
    }
  },
  finalize() {},
};

export const createExactZipContentPolicy = (
  expectedEntries: readonly { readonly bytes: Uint8Array; readonly name: string }[],
): ZipContentPolicy => {
  const expected = new Map<string, Buffer>();
  for (const entry of expectedEntries) {
    if (expected.has(entry.name))
      throw new TypeError('Exact ZIP content policy names must be unique.');
    expected.set(entry.name, Buffer.from(entry.bytes));
  }
  return {
    validateEntry(entry) {
      const bytes = expected.get(entry.name);
      if (bytes === undefined || !bytes.equals(entry.bytes)) {
        fail(
          'ZIP_CONTENT_MISMATCH',
          'ZIP entry differs from the exporter-owned exact content policy.',
        );
      }
    },
    finalize(entries) {
      if (entries.length !== expected.size || entries.some((entry) => !expected.has(entry.name))) {
        fail('ZIP_CONTENT_MISMATCH', 'ZIP is missing exporter-owned exact content.');
      }
    },
  };
};

const verifyDeflateConsumesAll = (archive: Buffer, entry: PrevalidatedEntry): void => {
  if (entry.entry.compressionMethod !== 8) return;
  try {
    const result = inflateRawSync(archive.subarray(entry.dataStart, entry.dataEnd), {
      info: true,
      maxOutputLength: MAX_ZIP_ENTRY_BYTES + 1,
    }) as unknown as { readonly engine: { readonly bytesWritten: number } };
    if (result.engine.bytesWritten !== entry.entry.compressedSize) {
      fail(
        'ZIP_DEFLATE_TRAILING_DATA',
        'Deflate stream does not consume its declared compressed range.',
      );
    }
  } catch (error) {
    if (error instanceof ZipSecurityError) throw error;
    fail('ZIP_INVALID', 'Deflate stream failed bounded complete-consumption verification.');
  }
};

const inspectEntry = async (
  zip: ZipFile,
  prevalidated: PrevalidatedEntry,
  remainingUncompressed: number,
  remainingCompressed: number,
  contentPolicy: ZipContentPolicy,
): Promise<InspectedZipEntry> => {
  // yauzl 3.4.0's low-level Promise wrapper delegates to the wrong method;
  // the supported raw entry stream still performs the exact prevalidated range read.
  const rawStream = await zip.openReadStreamPromise(prevalidated.entry, {
    decodeFileData: false,
    end: prevalidated.entry.compressedSize,
    start: 0,
  });
  let actualCompressed = 0;
  for await (const chunk of rawStream) {
    if (chunk.byteLength > prevalidated.entry.compressedSize - actualCompressed) {
      fail('ZIP_SIZE_MISMATCH', 'ZIP raw compressed stream exceeds its declared size.');
    }
    if (chunk.byteLength > remainingCompressed - actualCompressed) {
      fail('ZIP_COMPRESSED_TOTAL_EXCEEDED', 'ZIP actual compressed streams exceed their bound.');
    }
    actualCompressed += chunk.byteLength;
  }
  if (actualCompressed !== prevalidated.entry.compressedSize) {
    fail('ZIP_SIZE_MISMATCH', 'ZIP actual compressed byte count differs.');
  }

  const decoded = await zip.openReadStreamPromise(prevalidated.entry);
  const chunks: Buffer[] = [];
  const hash = createHash('sha256');
  let crc = 0xffffffff;
  let actualUncompressed = 0;
  for await (const chunk of decoded) {
    const bytes = Buffer.from(chunk);
    if (bytes.byteLength > MAX_ZIP_ENTRY_BYTES - actualUncompressed) {
      fail('ZIP_ENTRY_LIMIT_EXCEEDED', 'ZIP decoded stream crossed its entry byte limit.');
    }
    if (bytes.byteLength > remainingUncompressed - actualUncompressed) {
      fail('ZIP_TOTAL_LIMIT_EXCEEDED', 'ZIP decoded streams crossed the total byte limit.');
    }
    actualUncompressed += bytes.byteLength;
    crc = updateCrc32(crc, bytes);
    hash.update(bytes);
    chunks.push(bytes);
  }
  if (actualUncompressed !== prevalidated.entry.uncompressedSize) {
    fail('ZIP_SIZE_MISMATCH', 'ZIP actual uncompressed byte count differs.');
  }
  if ((crc ^ 0xffffffff) >>> 0 !== prevalidated.entry.crc32) {
    fail('ZIP_CRC_MISMATCH', 'ZIP decoded CRC differs from central metadata.');
  }
  if (
    (actualCompressed === 0 && actualUncompressed !== 0) ||
    (actualCompressed > 0 && actualUncompressed / actualCompressed > MAX_ZIP_RATIO)
  ) {
    fail('ZIP_RATIO_EXCEEDED', 'ZIP actual compression ratio exceeds 100.');
  }
  const inspected = {
    compressedSize: actualCompressed,
    name: prevalidated.name,
    sha256: hash.digest('hex'),
    uncompressedSize: actualUncompressed,
  };
  contentPolicy.validateEntry({ ...inspected, bytes: Buffer.concat(chunks) });
  return inspected;
};

const boundedTightening = (value: number | undefined, maximum: number, name: string): number => {
  const selected = value ?? maximum;
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > maximum) {
    throw new TypeError(`${name} may only tighten the frozen production limit.`);
  }
  return selected;
};

export const inspectZipBytes = async (
  input: Uint8Array,
  options: ZipInspectionOptions = {},
): Promise<ZipInspectionResult> => {
  if (input.byteLength < 22 || input.byteLength > MAX_ZIP_ARCHIVE_BYTES) {
    fail('ZIP_ARCHIVE_LIMIT_EXCEEDED', 'ZIP archive size is outside its bound.');
  }
  const maxTotalCompressedBytes = boundedTightening(
    options.maxTotalCompressedBytes,
    MAX_ZIP_ARCHIVE_BYTES,
    'ZIP compressed total override',
  );
  const maxTotalUncompressedBytes = boundedTightening(
    options.maxTotalUncompressedBytes,
    MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES,
    'ZIP uncompressed total override',
  );
  const archive = Buffer.from(input);
  const eocd = parseEocd(archive);
  const rawEntries = parseRawCentralDirectory(archive, eocd);
  let zip: ZipFile | undefined;
  try {
    zip = await fromBufferPromise(archive, {
      autoClose: false,
      decodeStrings: false,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    });
    const yauzlEntries: Entry[] = [];
    for await (const entry of zip.eachEntry()) yauzlEntries.push(entry);
    const prevalidated = prevalidateEntries(
      archive,
      eocd,
      rawEntries,
      yauzlEntries,
      maxTotalCompressedBytes,
      maxTotalUncompressedBytes,
    );

    const contentPolicy = options.contentPolicy ?? defaultContentPolicy;
    const entries: InspectedZipEntry[] = [];
    let totalCompressedBytes = 0;
    let totalUncompressedBytes = 0;
    for (const entry of prevalidated) {
      verifyDeflateConsumesAll(archive, entry);
      const inspected = await inspectEntry(
        zip,
        entry,
        maxTotalUncompressedBytes - totalUncompressedBytes,
        maxTotalCompressedBytes - totalCompressedBytes,
        contentPolicy,
      );
      entries.push(inspected);
      totalCompressedBytes += inspected.compressedSize;
      totalUncompressedBytes += inspected.uncompressedSize;
    }
    contentPolicy.finalize(entries);
    return {
      archiveByteSize: archive.byteLength,
      entries,
      totalCompressedBytes,
      totalUncompressedBytes,
    };
  } catch (error) {
    if (error instanceof ZipSecurityError) throw error;
    throw new ZipSecurityError('ZIP_INVALID', 'ZIP parsing or streaming validation failed.');
  } finally {
    zip?.close();
  }
};
