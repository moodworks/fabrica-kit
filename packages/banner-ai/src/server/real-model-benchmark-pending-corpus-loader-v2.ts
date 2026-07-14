import { z } from 'zod';

import {
  COMBINED_INTAKE_PERMISSION_BINDING_V2_SHA256,
  PENDING_CORE_COMBINED_AUTHORIZATION_BINDING_V2_SHA256,
  PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256,
  PendingRealModelBenchmarkCorpusV2Schema,
  REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2,
  type PendingRealModelBenchmarkCorpusV2,
} from '../evaluation/real-model-benchmark-pending-corpus-v2.js';
import {
  byteSourceFrom,
  normalizeRasterUpload,
  validateNormalizedPng,
} from '../security/raster-upload.js';
import { inspectRasterContainer } from '../security/raster-container.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V2,
  readPendingCorpusPackageFileV2,
  type PendingCorpusStaticSourceV2,
} from './real-model-benchmark-pending-corpus-source-registry-v2.js';

type PendingCorpusEntryV2 = PendingRealModelBenchmarkCorpusV2['entries'][number];

export interface VerifiedPendingRealModelBenchmarkCorpusMetadataV2 {
  readonly verificationVersion: 2;
  readonly status: 'oracle-review-pending';
  readonly pendingCoreSha256: typeof PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256;
  readonly combinedIntakePermissionBindingSha256: typeof COMBINED_INTAKE_PERMISSION_BINDING_V2_SHA256;
  readonly pendingCoreCombinedAuthorizationBindingSha256: typeof PENDING_CORE_COMBINED_AUTHORIZATION_BINDING_V2_SHA256;
  readonly fixtureCount: 4;
  readonly entries: readonly {
    readonly fixtureId: PendingCorpusEntryV2['fixtureId'];
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
  readonly dispatchable: false;
  readonly admissionAuthority: false;
  readonly requestPlanAuthority: false;
  readonly providerCallAuthority: false;
  readonly dispatchAuthority: false;
}

const PendingLoaderInputV2Schema = z.strictObject({ manifest: z.unknown() }).readonly();

const hasPngSignature = (bytes: Uint8Array): boolean =>
  bytes.byteLength >= 8 &&
  [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);

const detectRasterMediaType = (bytes: Uint8Array): 'image/jpeg' | 'image/png' => {
  if (hasPngSignature(bytes)) return 'image/png';
  if (bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  throw new TypeError('Pending V2 corpus fixture has an unsupported byte signature.');
};

const exactCanonicalEquality = (left: unknown, right: unknown): boolean =>
  canonicalizeJson(left) === canonicalizeJson(right);

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && Buffer.from(left).equals(Buffer.from(right));

const validateRegistryMetadata = (
  registry: readonly PendingCorpusStaticSourceV2[],
  entries: PendingRealModelBenchmarkCorpusV2['entries'],
): void => {
  if (registry.length !== 4 || entries.length !== 4) {
    throw new TypeError('Pending V2 corpus requires exactly four fixed package source pairs.');
  }
  const fixtureIds = registry.map((source) => source.fixtureId);
  const references = registry.flatMap((source) => [
    source.original.reference,
    source.normalized.reference,
  ]);
  if (new Set(fixtureIds).size !== 4 || new Set(references).size !== 8) {
    throw new TypeError('Pending V2 corpus package registry contains duplicate identities.');
  }
  for (const [index, source] of registry.entries()) {
    const entry = entries[index];
    const expectedSourceVersion = index === 3 ? 2 : 1;
    if (
      entry === undefined ||
      source.sourceVersion !== expectedSourceVersion ||
      source.fixtureId !== entry.fixtureId ||
      source.original.filename !== entry.packageOriginal.filename ||
      source.original.detectedMediaType !== entry.packageOriginal.detectedMediaType ||
      source.normalized.filename !== entry.canonicalNormalized.filename ||
      source.normalized.detectedMediaType !== entry.canonicalNormalized.detectedMediaType
    ) {
      throw new TypeError('Pending V2 package registry differs from the exact pinned manifest.');
    }
  }
};

const verifyEntry = async (entry: PendingCorpusEntryV2, source: PendingCorpusStaticSourceV2) => {
  const [originalBytes, storedNormalizedBytes] = await Promise.all([
    readPendingCorpusPackageFileV2(source.original.reference),
    readPendingCorpusPackageFileV2(source.normalized.reference),
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
    throw new TypeError(`Fresh trusted normalization differs for ${entry.fixtureId}.`);
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
      `Stored normalized type or deterministic bytes drifted for ${entry.fixtureId}.`,
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
 * Verifies only the exact V2 pending manifest and fixed package files. It returns inert metadata
 * and mints no corpus capability, authorization, request plan, provider call, or dispatch power.
 */
export const loadVerifiedPendingRealModelBenchmarkCorpusV2 = async (
  input: unknown,
): Promise<VerifiedPendingRealModelBenchmarkCorpusMetadataV2> => {
  const loaderInput = PendingLoaderInputV2Schema.parse(input);
  const manifest = PendingRealModelBenchmarkCorpusV2Schema.parse(loaderInput.manifest);
  if (
    manifest.pendingCoreSha256 !== PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256 ||
    !exactCanonicalEquality(manifest, REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2)
  ) {
    throw new TypeError('Only the exact pinned pending V2 corpus can be verified.');
  }

  validateRegistryMetadata(
    REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V2,
    manifest.entries,
  );
  const verifiedEntries = await Promise.all(
    manifest.entries.map((entry, index) => {
      const source = REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V2[index];
      if (source === undefined) throw new TypeError('Pending V2 package source is missing.');
      return verifyEntry(entry, source);
    }),
  );
  const allDigests = verifiedEntries.flatMap((entry) => [
    entry.original.sha256,
    entry.normalized.sha256,
  ]);
  if (verifiedEntries.length !== 4 || new Set(allDigests).size !== 8) {
    throw new TypeError('Verified pending V2 digests must be unique across all eight files.');
  }

  return Object.freeze({
    verificationVersion: 2 as const,
    status: 'oracle-review-pending' as const,
    pendingCoreSha256: PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256,
    combinedIntakePermissionBindingSha256: COMBINED_INTAKE_PERMISSION_BINDING_V2_SHA256,
    pendingCoreCombinedAuthorizationBindingSha256:
      PENDING_CORE_COMBINED_AUTHORIZATION_BINDING_V2_SHA256,
    fixtureCount: 4 as const,
    entries: Object.freeze(verifiedEntries),
    active: false as const,
    dispatchable: false as const,
    admissionAuthority: false as const,
    requestPlanAuthority: false as const,
    providerCallAuthority: false as const,
    dispatchAuthority: false as const,
  });
};
