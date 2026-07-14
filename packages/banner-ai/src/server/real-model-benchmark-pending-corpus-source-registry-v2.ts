import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V1,
  readPendingCorpusPackageFileV1,
  type PendingCorpusFileReferenceV1,
} from './real-model-benchmark-pending-corpus-source-registry.js';

export type PendingCorpusFileReferenceV2 =
  PendingCorpusFileReferenceV1 | 'no-text-original' | 'no-text-normalized';

export interface PendingCorpusStaticSourceV2 {
  readonly sourceVersion: 1 | 2;
  readonly fixtureId:
    'banner-person-v1' | 'banner-product-v1' | 'banner-text-heavy-v1' | 'banner-no-text-v1';
  readonly original: {
    readonly reference: PendingCorpusFileReferenceV2;
    readonly filename: string;
    readonly detectedMediaType: 'image/jpeg' | 'image/png';
  };
  readonly normalized: {
    readonly reference: PendingCorpusFileReferenceV2;
    readonly filename: string;
    readonly detectedMediaType: 'image/png';
  };
}

export const REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V2 = Object.freeze([
  ...REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V1,
  Object.freeze({
    sourceVersion: 2 as const,
    fixtureId: 'banner-no-text-v1' as const,
    original: Object.freeze({
      reference: 'no-text-original' as const,
      filename: 'banner-no-text-v1.jpeg',
      detectedMediaType: 'image/jpeg' as const,
    }),
    normalized: Object.freeze({
      reference: 'no-text-normalized' as const,
      filename: 'banner-no-text-v1.png',
      detectedMediaType: 'image/png' as const,
    }),
  }),
] satisfies readonly PendingCorpusStaticSourceV2[]);

const fixtureRoot = fileURLToPath(
  new URL('../../test/fixtures/real-model-benchmark/', import.meta.url),
);

const fourthRelativePathByReference = Object.freeze({
  'no-text-original': 'original/banner-no-text-v1.jpeg',
  'no-text-normalized': 'normalized/banner-no-text-v1.png',
} as const);

const MAX_PENDING_CORPUS_FILE_BYTES = 5_242_880;

const assertBoundedRelativePath = (root: string, child: string): string => {
  if (isAbsolute(child) || child.split(/[\\/]/u).some((part) => part === '' || part === '..')) {
    throw new TypeError('Pending V2 corpus source reference escaped its fixed fixture root.');
  }
  const candidate = resolve(root, child);
  const lexicalRelative = relative(resolve(root), candidate);
  if (
    lexicalRelative === '' ||
    lexicalRelative === '..' ||
    lexicalRelative.startsWith(`..${sep}`) ||
    isAbsolute(lexicalRelative)
  ) {
    throw new TypeError('Pending V2 corpus source reference escaped its fixed fixture root.');
  }
  return candidate;
};

const assertNoSymlinkComponents = async (root: string, child: string): Promise<void> => {
  const rootStats = await lstat(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new TypeError('Pending V2 corpus fixture root must be a non-symlink directory.');
  }
  const parts = child.split('/');
  let cursor = root;
  for (const [index, part] of parts.entries()) {
    cursor = join(cursor, part);
    const stats = await lstat(cursor);
    if (stats.isSymbolicLink()) {
      throw new TypeError('Pending V2 corpus fixture paths cannot contain symlinks.');
    }
    const final = index === parts.length - 1;
    if ((!final && !stats.isDirectory()) || (final && !stats.isFile())) {
      throw new TypeError('Pending V2 corpus fixture path has a special or wrong-kind file.');
    }
  }
};

const assertRealPathContained = async (root: string, candidate: string): Promise<void> => {
  const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
  const realRelative = relative(realRoot, realCandidate);
  if (
    realRelative === '' ||
    realRelative === '..' ||
    realRelative.startsWith(`..${sep}`) ||
    isAbsolute(realRelative) ||
    dirname(realCandidate) === realCandidate
  ) {
    throw new TypeError('Pending V2 corpus fixture real path escaped its fixed package root.');
  }
};

const readFourthPendingCorpusPackageFileV2 = async (
  reference: 'no-text-original' | 'no-text-normalized',
): Promise<Uint8Array> => {
  if (!Object.hasOwn(fourthRelativePathByReference, reference)) {
    throw new TypeError('Pending V2 corpus file reference is not fixed in the package registry.');
  }
  const child = fourthRelativePathByReference[reference];
  const candidate = assertBoundedRelativePath(fixtureRoot, child);
  await assertNoSymlinkComponents(fixtureRoot, child);
  await assertRealPathContained(fixtureRoot, candidate);

  const handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > MAX_PENDING_CORPUS_FILE_BYTES) {
      throw new TypeError('Pending V2 corpus source is not one bounded regular file.');
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
      throw new TypeError('Pending V2 corpus source changed while its bytes were being read.');
    }
    return Uint8Array.from(bytes);
  } finally {
    await handle.close();
  }
};

/** Server-internal fixed-reference reader. No caller path, URL, or bytes cross this boundary. */
export const readPendingCorpusPackageFileV2 = async (
  reference: PendingCorpusFileReferenceV2,
): Promise<Uint8Array> => {
  if (reference === 'no-text-original' || reference === 'no-text-normalized') {
    return readFourthPendingCorpusPackageFileV2(reference);
  }
  return readPendingCorpusPackageFileV1(reference);
};
