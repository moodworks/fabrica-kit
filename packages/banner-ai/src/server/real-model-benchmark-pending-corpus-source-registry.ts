import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export type PendingCorpusFileReferenceV1 =
  | 'person-original'
  | 'person-normalized'
  | 'product-original'
  | 'product-normalized'
  | 'text-heavy-original'
  | 'text-heavy-normalized';

export interface PendingCorpusStaticSourceV1 {
  readonly sourceVersion: 1;
  readonly fixtureId: 'banner-person-v1' | 'banner-product-v1' | 'banner-text-heavy-v1';
  readonly original: {
    readonly reference: PendingCorpusFileReferenceV1;
    readonly filename: string;
    readonly detectedMediaType: 'image/jpeg' | 'image/png';
  };
  readonly normalized: {
    readonly reference: PendingCorpusFileReferenceV1;
    readonly filename: string;
    readonly detectedMediaType: 'image/png';
  };
}

export const REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V1 = Object.freeze([
  Object.freeze({
    sourceVersion: 1 as const,
    fixtureId: 'banner-person-v1' as const,
    original: Object.freeze({
      reference: 'person-original' as const,
      filename: 'banner-person-v1.png',
      detectedMediaType: 'image/png' as const,
    }),
    normalized: Object.freeze({
      reference: 'person-normalized' as const,
      filename: 'banner-person-v1.png',
      detectedMediaType: 'image/png' as const,
    }),
  }),
  Object.freeze({
    sourceVersion: 1 as const,
    fixtureId: 'banner-product-v1' as const,
    original: Object.freeze({
      reference: 'product-original' as const,
      filename: 'banner-product-v1.jpg',
      detectedMediaType: 'image/jpeg' as const,
    }),
    normalized: Object.freeze({
      reference: 'product-normalized' as const,
      filename: 'banner-product-v1.png',
      detectedMediaType: 'image/png' as const,
    }),
  }),
  Object.freeze({
    sourceVersion: 1 as const,
    fixtureId: 'banner-text-heavy-v1' as const,
    original: Object.freeze({
      reference: 'text-heavy-original' as const,
      filename: 'banner-text-heavy-v1.jpg',
      detectedMediaType: 'image/jpeg' as const,
    }),
    normalized: Object.freeze({
      reference: 'text-heavy-normalized' as const,
      filename: 'banner-text-heavy-v1.png',
      detectedMediaType: 'image/png' as const,
    }),
  }),
] satisfies readonly PendingCorpusStaticSourceV1[]);

const fixtureRoot = fileURLToPath(
  new URL('../../test/fixtures/real-model-benchmark/', import.meta.url),
);

const relativePathByReference: Readonly<Record<PendingCorpusFileReferenceV1, string>> =
  Object.freeze({
    'person-original': 'original/banner-person-v1.png',
    'person-normalized': 'normalized/banner-person-v1.png',
    'product-original': 'original/banner-product-v1.jpg',
    'product-normalized': 'normalized/banner-product-v1.png',
    'text-heavy-original': 'original/banner-text-heavy-v1.jpg',
    'text-heavy-normalized': 'normalized/banner-text-heavy-v1.png',
  });

const MAX_PENDING_CORPUS_FILE_BYTES = 5_242_880;

const assertBoundedRelativePath = (root: string, child: string): string => {
  if (isAbsolute(child) || child.split(/[\\/]/u).some((part) => part === '' || part === '..')) {
    throw new TypeError('Pending corpus source reference escaped its fixed fixture root.');
  }
  const candidate = resolve(root, child);
  const lexicalRelative = relative(resolve(root), candidate);
  if (
    lexicalRelative === '' ||
    lexicalRelative === '..' ||
    lexicalRelative.startsWith(`..${sep}`) ||
    isAbsolute(lexicalRelative)
  ) {
    throw new TypeError('Pending corpus source reference escaped its fixed fixture root.');
  }
  return candidate;
};

const assertNoSymlinkComponents = async (root: string, child: string): Promise<void> => {
  const rootStats = await lstat(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new TypeError('Pending corpus fixture root must be a non-symlink directory.');
  }
  const parts = child.split('/');
  let cursor = root;
  for (const [index, part] of parts.entries()) {
    cursor = join(cursor, part);
    const stats = await lstat(cursor);
    if (stats.isSymbolicLink()) {
      throw new TypeError('Pending corpus fixture paths cannot contain symlinks.');
    }
    const final = index === parts.length - 1;
    if ((!final && !stats.isDirectory()) || (final && !stats.isFile())) {
      throw new TypeError('Pending corpus fixture path contains a special or wrong-kind file.');
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
    throw new TypeError('Pending corpus fixture real path escaped its fixed package root.');
  }
};

/** Server-internal fixed-reference reader. No caller path, URL, or bytes cross this boundary. */
export const readPendingCorpusPackageFileV1 = async (
  reference: PendingCorpusFileReferenceV1,
): Promise<Uint8Array> => {
  if (!Object.hasOwn(relativePathByReference, reference)) {
    throw new TypeError('Pending corpus file reference is not in the fixed package registry.');
  }
  const child = relativePathByReference[reference];
  if (child === undefined) {
    throw new TypeError('Pending corpus file reference is not in the fixed package registry.');
  }
  const candidate = assertBoundedRelativePath(fixtureRoot, child);
  await assertNoSymlinkComponents(fixtureRoot, child);
  await assertRealPathContained(fixtureRoot, candidate);

  const handle = await open(candidate, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > MAX_PENDING_CORPUS_FILE_BYTES) {
      throw new TypeError('Pending corpus source is not one bounded regular file.');
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
      throw new TypeError('Pending corpus source changed while its bytes were being read.');
    }
    return Uint8Array.from(bytes);
  } finally {
    await handle.close();
  }
};
