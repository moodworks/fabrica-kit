import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
  ProductGateDevelopmentCorpusManifestV1Schema,
  requireExactProductGateDevelopmentCorpusV1,
  type ProductGateDevelopmentCorpusEntryV1,
} from '../evaluation/product-gate-corpus-v1.js';
import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import { inspectRasterContainer } from '../security/raster-container.js';
import {
  byteSourceFrom,
  normalizeRasterUpload,
  validateNormalizedPng,
} from '../security/raster-upload.js';

const committedFixtureRoot = fileURLToPath(
  new URL('../../test/fixtures/real-model-benchmark/', import.meta.url),
);
const packagePrefix = 'packages/banner-ai/test/fixtures/real-model-benchmark/';
const maximumFileBytes = 5_242_880;

const ProductGateDevelopmentCorpusLoaderInputV1Schema = z
  .strictObject({
    manifest: ProductGateDevelopmentCorpusManifestV1Schema,
    sourceRoot: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('committed-package-root') }).readonly(),
      z
        .strictObject({
          kind: z.literal('bounded-test-root'),
          absolutePath: z.string().min(1).max(4_096),
        })
        .readonly(),
    ]),
  })
  .readonly();

const relativeChildForPackagePath = (packageRelativePath: string): string => {
  if (!packageRelativePath.startsWith(packagePrefix)) {
    throw new TypeError('Development fixture path is outside its fixed package prefix.');
  }
  const child = packageRelativePath.slice(packagePrefix.length);
  if (
    child.length === 0 ||
    isAbsolute(child) ||
    child.includes('\\') ||
    child.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new TypeError('Development fixture path contains traversal or invalid components.');
  }
  return child;
};

const candidateWithinRoot = (root: string, child: string): string => {
  const candidate = resolve(root, child);
  const lexical = relative(resolve(root), candidate);
  if (lexical === '' || lexical === '..' || lexical.startsWith(`..${sep}`) || isAbsolute(lexical)) {
    throw new TypeError('Development fixture escaped its bounded root.');
  }
  return candidate;
};

const assertSafePath = async (root: string, child: string, candidate: string): Promise<void> => {
  const rootStats = await lstat(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new TypeError('Development fixture root must be a non-symlink directory.');
  }
  let cursor = resolve(root);
  const parts = child.split('/');
  for (const [index, part] of parts.entries()) {
    cursor = resolve(cursor, part);
    const metadata = await lstat(cursor);
    const final = index === parts.length - 1;
    if (
      metadata.isSymbolicLink() ||
      (!final && !metadata.isDirectory()) ||
      (final && !metadata.isFile())
    ) {
      throw new TypeError('Development fixture path contains a symlink or special entry.');
    }
  }
  const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
  const realChild = relative(realRoot, realCandidate);
  if (
    realChild === '' ||
    realChild === '..' ||
    realChild.startsWith(`..${sep}`) ||
    isAbsolute(realChild) ||
    dirname(realCandidate) === realCandidate
  ) {
    throw new TypeError('Development fixture real path escaped its bounded root.');
  }
};

const readBoundedRegularFile = async (root: string, packageRelativePath: string) => {
  const child = relativeChildForPackagePath(packageRelativePath);
  const candidate = candidateWithinRoot(root, child);
  await assertSafePath(root, child, candidate);
  const handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > maximumFileBytes) {
      throw new TypeError('Development fixture must be one bounded regular file.');
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (
      !after.isFile() ||
      bytes.byteLength !== before.size ||
      after.size !== before.size ||
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.mtimeMs !== before.mtimeMs
    ) {
      throw new TypeError('Development fixture changed during its bounded read.');
    }
    return Uint8Array.from(bytes);
  } finally {
    await handle.close();
  }
};

const hasPngSignature = (bytes: Uint8Array): boolean =>
  bytes.byteLength >= 8 &&
  [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value);

const detectMediaType = (bytes: Uint8Array): 'image/jpeg' | 'image/png' => {
  if (hasPngSignature(bytes)) return 'image/png';
  if (bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  throw new TypeError('Development fixture has an unsupported byte signature.');
};

const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  left.byteLength === right.byteLength && Buffer.from(left).equals(Buffer.from(right));

export interface VerifiedProductGateDevelopmentCorpusEntryV1 {
  readonly caseId: ProductGateDevelopmentCorpusEntryV1['caseId'];
  readonly primaryStratum: ProductGateDevelopmentCorpusEntryV1['primaryStratum'];
  readonly original: ProductGateDevelopmentCorpusEntryV1['original'] & {
    readonly bytes: Uint8Array;
  };
  readonly normalized: ProductGateDevelopmentCorpusEntryV1['normalized'] & {
    readonly bytes: Uint8Array;
  };
  readonly oracle: ProductGateDevelopmentCorpusEntryV1['oracle'];
}

export interface VerifiedProductGateDevelopmentCorpusV1 {
  readonly verificationVersion: 1;
  readonly manifestSha256: z.infer<typeof Sha256HexSchema>;
  readonly split: 'development';
  readonly entries: readonly VerifiedProductGateDevelopmentCorpusEntryV1[];
  readonly fixtureCount: 4;
  readonly holdoutAdmitted: false;
  readonly productGateDenominatorAvailable: false;
  readonly providerTransmissionAuthority: false;
  readonly realEvaluationAuthority: false;
  readonly productGateEvidence: false;
}

const verifyEntry = async (
  root: string,
  entry: ProductGateDevelopmentCorpusEntryV1,
): Promise<VerifiedProductGateDevelopmentCorpusEntryV1> => {
  const [originalBytes, normalizedBytes] = await Promise.all([
    readBoundedRegularFile(root, entry.original.packageRelativePath),
    readBoundedRegularFile(root, entry.normalized.packageRelativePath),
  ]);
  const originalType = detectMediaType(originalBytes);
  const normalizedType = detectMediaType(normalizedBytes);
  const originalInfo = inspectRasterContainer(originalBytes, originalType);
  const normalizedInfo = await validateNormalizedPng(normalizedBytes);
  if (
    originalType !== entry.original.mediaType ||
    originalBytes.byteLength !== entry.original.byteSize ||
    sha256Hex(originalBytes) !== entry.original.sha256 ||
    originalInfo.width !== entry.original.pixelWidth ||
    originalInfo.height !== entry.original.pixelHeight ||
    normalizedType !== 'image/png' ||
    normalizedBytes.byteLength !== entry.normalized.byteSize ||
    sha256Hex(normalizedBytes) !== entry.normalized.sha256 ||
    normalizedInfo.width !== entry.normalized.pixelWidth ||
    normalizedInfo.height !== entry.normalized.pixelHeight ||
    normalizedInfo.ancillaryByteSize !== 0
  ) {
    throw new TypeError(`Development fixture bytes or metadata drifted for ${entry.caseId}.`);
  }
  const freshNormalized = await normalizeRasterUpload({
    bytes: byteSourceFrom(originalBytes),
    declaredMediaType: originalType,
    filename: entry.original.packageRelativePath.slice(
      entry.original.packageRelativePath.lastIndexOf('/') + 1,
    ),
  });
  if (
    freshNormalized.sourceMediaType !== originalType ||
    freshNormalized.sourceWidth !== entry.original.pixelWidth ||
    freshNormalized.sourceHeight !== entry.original.pixelHeight ||
    freshNormalized.sha256 !== entry.normalized.sha256 ||
    freshNormalized.byteSize !== entry.normalized.byteSize ||
    freshNormalized.width !== entry.normalized.pixelWidth ||
    freshNormalized.height !== entry.normalized.pixelHeight ||
    !sameBytes(freshNormalized.bytes, normalizedBytes)
  ) {
    throw new TypeError(`Canonical normalization drifted for ${entry.caseId}.`);
  }
  const normalizedRoundTrip = await normalizeRasterUpload({
    bytes: byteSourceFrom(normalizedBytes),
    declaredMediaType: 'image/png',
    filename: entry.normalized.packageRelativePath.slice(
      entry.normalized.packageRelativePath.lastIndexOf('/') + 1,
    ),
  });
  if (
    normalizedRoundTrip.sha256 !== entry.normalized.sha256 ||
    !sameBytes(normalizedRoundTrip.bytes, normalizedBytes)
  ) {
    throw new TypeError(`Stored normalized bytes are non-canonical for ${entry.caseId}.`);
  }
  return Object.freeze({
    caseId: entry.caseId,
    primaryStratum: entry.primaryStratum,
    original: Object.freeze({ ...entry.original, bytes: originalBytes }),
    normalized: Object.freeze({ ...entry.normalized, bytes: normalizedBytes }),
    oracle: entry.oracle,
  });
};

/**
 * Verifies the exact committed development corpus and returns local bytes for deterministic fakes.
 * It grants no holdout, provider-transmission, real-evaluation, or product-gate authority.
 */
export const loadVerifiedProductGateDevelopmentCorpusV1 = async (
  input: unknown,
): Promise<VerifiedProductGateDevelopmentCorpusV1> => {
  const parsed = ProductGateDevelopmentCorpusLoaderInputV1Schema.parse(input);
  const manifest = requireExactProductGateDevelopmentCorpusV1(parsed.manifest);
  const root =
    parsed.sourceRoot.kind === 'committed-package-root'
      ? committedFixtureRoot
      : parsed.sourceRoot.absolutePath;
  if (parsed.sourceRoot.kind === 'bounded-test-root' && !isAbsolute(root)) {
    throw new TypeError('Bounded test fixture root must be absolute.');
  }
  const entries = await Promise.all(manifest.entries.map((entry) => verifyEntry(root, entry)));
  if (
    entries.length !== 4 ||
    canonicalizeJson(
      entries.map((entry) => ({
        caseId: entry.caseId,
        originalSha256: entry.original.sha256,
        normalizedSha256: entry.normalized.sha256,
        oracleSha256: entry.oracle.oracleSha256,
      })),
    ) !==
      canonicalizeJson(
        PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.entries.map((entry) => ({
          caseId: entry.caseId,
          originalSha256: entry.original.sha256,
          normalizedSha256: entry.normalized.sha256,
          oracleSha256: entry.oracle.oracleSha256,
        })),
      )
  ) {
    throw new TypeError('Verified development source or oracle projection drifted.');
  }
  return Object.freeze({
    verificationVersion: 1 as const,
    manifestSha256: Sha256HexSchema.parse(manifest.manifestSha256),
    split: 'development' as const,
    entries: Object.freeze(entries),
    fixtureCount: 4 as const,
    holdoutAdmitted: false as const,
    productGateDenominatorAvailable: false as const,
    providerTransmissionAuthority: false as const,
    realEvaluationAuthority: false as const,
    productGateEvidence: false as const,
  });
};
