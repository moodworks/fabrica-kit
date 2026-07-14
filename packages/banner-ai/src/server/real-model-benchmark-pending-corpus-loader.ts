import { z } from 'zod';

import {
  PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_SHA256,
  PendingRealModelBenchmarkCorpusV1Schema,
  REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1,
  type PendingRealModelBenchmarkCorpusEntryV1,
} from '../evaluation/real-model-benchmark-pending-corpus.js';
import {
  byteSourceFrom,
  normalizeRasterUpload,
  validateNormalizedPng,
} from '../security/raster-upload.js';
import { inspectRasterContainer } from '../security/raster-container.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V1,
  readPendingCorpusPackageFileV1,
  type PendingCorpusStaticSourceV1,
} from './real-model-benchmark-pending-corpus-source-registry.js';

export interface VerifiedPendingRealModelBenchmarkCorpusMetadataV1 {
  readonly verificationVersion: 1;
  readonly status: 'oracle-review-pending';
  readonly pendingCoreSha256: typeof PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_SHA256;
  readonly fixtureCount: 3;
  readonly entries: readonly {
    readonly fixtureId: PendingRealModelBenchmarkCorpusEntryV1['fixtureId'];
    readonly original: {
      readonly detectedMediaType: 'image/jpeg' | 'image/png';
      readonly byteSize: number;
      readonly pixelWidth: number;
      readonly pixelHeight: number;
      readonly sha256: string;
    };
    readonly normalized: {
      readonly detectedMediaType: 'image/png';
      readonly byteSize: number;
      readonly pixelWidth: number;
      readonly pixelHeight: number;
      readonly sha256: string;
    };
  }[];
  readonly active: false;
  readonly admissionAuthority: false;
  readonly requestPlanAuthority: false;
  readonly dispatchAuthority: false;
}

const PendingLoaderInputV1Schema = z.strictObject({ manifest: z.unknown() }).readonly();

const hasPngSignature = (bytes: Uint8Array): boolean =>
  bytes.byteLength >= 8 &&
  [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);

const detectRasterMediaType = (bytes: Uint8Array): 'image/jpeg' | 'image/png' => {
  if (hasPngSignature(bytes)) return 'image/png';
  if (bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  throw new TypeError('Pending corpus fixture has an unsupported or ambiguous byte signature.');
};

const exactCanonicalEquality = (left: unknown, right: unknown): boolean =>
  canonicalizeJson(left) === canonicalizeJson(right);

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && Buffer.from(left).equals(Buffer.from(right));

const validateRegistryMetadata = (
  registry: readonly PendingCorpusStaticSourceV1[],
  entries: readonly PendingRealModelBenchmarkCorpusEntryV1[],
): void => {
  if (registry.length !== 3 || entries.length !== 3) {
    throw new TypeError('Pending corpus requires exactly three fixed package source pairs.');
  }
  const fixtureIds = registry.map((source) => source.fixtureId);
  const references = registry.flatMap((source) => [
    source.original.reference,
    source.normalized.reference,
  ]);
  if (new Set(fixtureIds).size !== 3 || new Set(references).size !== 6) {
    throw new TypeError('Pending corpus package registry contains duplicate identities.');
  }
  for (const [index, source] of registry.entries()) {
    const entry = entries[index];
    if (
      entry === undefined ||
      source.sourceVersion !== 1 ||
      source.fixtureId !== entry.fixtureId ||
      source.original.filename !== entry.packageOriginal.filename ||
      source.original.detectedMediaType !== entry.packageOriginal.detectedMediaType ||
      source.normalized.filename !== entry.canonicalNormalized.filename ||
      source.normalized.detectedMediaType !== entry.canonicalNormalized.detectedMediaType
    ) {
      throw new TypeError(
        'Pending corpus package registry differs from the exact pinned manifest.',
      );
    }
  }
};

const verifyEntry = async (
  entry: PendingRealModelBenchmarkCorpusEntryV1,
  source: PendingCorpusStaticSourceV1,
) => {
  const [originalBytes, storedNormalizedBytes] = await Promise.all([
    readPendingCorpusPackageFileV1(source.original.reference),
    readPendingCorpusPackageFileV1(source.normalized.reference),
  ]);
  const originalMediaType = detectRasterMediaType(originalBytes);
  const normalizedMediaType = detectRasterMediaType(storedNormalizedBytes);
  if (
    originalMediaType !== source.original.detectedMediaType ||
    originalMediaType !== entry.packageOriginal.detectedMediaType ||
    normalizedMediaType !== 'image/png' ||
    normalizedMediaType !== source.normalized.detectedMediaType
  ) {
    throw new TypeError(`Byte-detected raster type drifted for ${entry.fixtureId}.`);
  }

  const originalInfo = inspectRasterContainer(originalBytes, originalMediaType);
  if (
    originalBytes.byteLength !== entry.packageOriginal.byteSize ||
    sha256Hex(originalBytes) !== entry.packageOriginal.sha256 ||
    originalInfo.mediaType !== entry.packageOriginal.detectedMediaType ||
    originalInfo.width !== entry.packageOriginal.pixelWidth ||
    originalInfo.height !== entry.packageOriginal.pixelHeight ||
    originalInfo.ancillaryByteSize !==
      entry.sourceAudit.localMetadataPrivacy.originalAncillaryByteSize
  ) {
    throw new TypeError(
      `Original package fixture metadata or bytes drifted for ${entry.fixtureId}.`,
    );
  }

  const storedNormalizedInfo = await validateNormalizedPng(storedNormalizedBytes);
  if (
    storedNormalizedBytes.byteLength !== entry.canonicalNormalized.byteSize ||
    sha256Hex(storedNormalizedBytes) !== entry.canonicalNormalized.sha256 ||
    storedNormalizedInfo.mediaType !== 'image/png' ||
    storedNormalizedInfo.width !== entry.canonicalNormalized.pixelWidth ||
    storedNormalizedInfo.height !== entry.canonicalNormalized.pixelHeight ||
    storedNormalizedInfo.ancillaryByteSize !== 0
  ) {
    throw new TypeError(
      `Stored canonical normalized fixture metadata or bytes drifted for ${entry.fixtureId}.`,
    );
  }

  const freshNormalized = await normalizeRasterUpload({
    bytes: byteSourceFrom(originalBytes),
    declaredMediaType: source.original.detectedMediaType,
    filename: source.original.filename,
  });
  if (
    freshNormalized.sourceMediaType !== entry.packageOriginal.detectedMediaType ||
    freshNormalized.sourceWidth !== entry.packageOriginal.pixelWidth ||
    freshNormalized.sourceHeight !== entry.packageOriginal.pixelHeight ||
    freshNormalized.mediaType !== entry.canonicalNormalized.detectedMediaType ||
    freshNormalized.byteSize !== entry.canonicalNormalized.byteSize ||
    freshNormalized.width !== entry.canonicalNormalized.pixelWidth ||
    freshNormalized.height !== entry.canonicalNormalized.pixelHeight ||
    freshNormalized.sha256 !== entry.canonicalNormalized.sha256 ||
    !sameBytes(freshNormalized.bytes, storedNormalizedBytes)
  ) {
    throw new TypeError(
      `Fresh trusted normalization differs byte-for-byte for ${entry.fixtureId}.`,
    );
  }

  const normalizedRoundTrip = await normalizeRasterUpload({
    bytes: byteSourceFrom(storedNormalizedBytes),
    declaredMediaType: source.normalized.detectedMediaType,
    filename: source.normalized.filename,
  });
  if (
    normalizedRoundTrip.sourceMediaType !== 'image/png' ||
    normalizedRoundTrip.sha256 !== entry.canonicalNormalized.sha256 ||
    !sameBytes(normalizedRoundTrip.bytes, storedNormalizedBytes)
  ) {
    throw new TypeError(
      `Stored normalized filename, type, or deterministic canonical bytes drifted for ${entry.fixtureId}.`,
    );
  }

  return Object.freeze({
    fixtureId: entry.fixtureId,
    original: Object.freeze({
      detectedMediaType: originalMediaType,
      byteSize: originalBytes.byteLength,
      pixelWidth: originalInfo.width,
      pixelHeight: originalInfo.height,
      sha256: sha256Hex(originalBytes),
    }),
    normalized: Object.freeze({
      detectedMediaType: 'image/png' as const,
      byteSize: storedNormalizedBytes.byteLength,
      pixelWidth: storedNormalizedInfo.width,
      pixelHeight: storedNormalizedInfo.height,
      sha256: sha256Hex(storedNormalizedBytes),
    }),
  });
};

/**
 * Verifies only the exact pending manifest and fixed module-relative package files. It mints no
 * corpus capability and returns no byte, path, URL, authorization, request, or plan authority.
 */
export const loadVerifiedPendingRealModelBenchmarkCorpusV1 = async (
  input: unknown,
): Promise<VerifiedPendingRealModelBenchmarkCorpusMetadataV1> => {
  const loaderInput = PendingLoaderInputV1Schema.parse(input);
  const manifest = PendingRealModelBenchmarkCorpusV1Schema.parse(loaderInput.manifest);
  if (
    manifest.pendingCoreSha256 !== PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_SHA256 ||
    !exactCanonicalEquality(manifest, REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1)
  ) {
    throw new TypeError('Only the exact pinned pending corpus manifest can be verified.');
  }

  validateRegistryMetadata(
    REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V1,
    manifest.entries,
  );
  const verifiedEntries = await Promise.all(
    manifest.entries.map((entry, index) => {
      const source = REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V1[index];
      if (source === undefined) throw new TypeError('Pending package source is missing.');
      return verifyEntry(entry, source);
    }),
  );
  const allVerifiedDigests = verifiedEntries.flatMap((entry) => [
    entry.original.sha256,
    entry.normalized.sha256,
  ]);
  if (verifiedEntries.length !== 3 || new Set(allVerifiedDigests).size !== 6) {
    throw new TypeError('Verified pending source digests must be unique across all six files.');
  }

  return Object.freeze({
    verificationVersion: 1 as const,
    status: 'oracle-review-pending' as const,
    pendingCoreSha256: PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_SHA256,
    fixtureCount: 3 as const,
    entries: Object.freeze(verifiedEntries),
    active: false as const,
    admissionAuthority: false as const,
    requestPlanAuthority: false as const,
    dispatchAuthority: false as const,
  });
};
