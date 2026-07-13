import { sha256Hex } from '../src/index.js';
import {
  LocalAssetStorage,
  assertExactStorageObject,
  createArtifactObjectKey,
  createAssetObjectKey,
  parseStorageObjectKey,
  type ExactStorageObject,
} from '../src/index.js';
import {
  mkdtemp,
  mkdir,
  chmod,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const assetId = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';
const outputId = '55555555-5555-4555-8555-555555555555';

const ownedRoots: string[] = [];

const createOwnedRoot = async (): Promise<string> => {
  const root = await mkdtemp(path.join(tmpdir(), 'fabrica-storage-test-'));
  ownedRoots.push(root);
  return root;
};

const createStorage = async (root: string): Promise<LocalAssetStorage> => {
  let sequence = 0;
  return LocalAssetStorage.create({
    rootDirectory: path.join(root, 'private-assets'),
    nextTempId: () => `${String((sequence += 1)).padStart(16, '0')}`,
  });
};

const descriptorFor = (bytes: Uint8Array, version = 1): ExactStorageObject => ({
  key: createAssetObjectKey({ assetId, assetVersion: version, workspaceId }),
  byteSize: bytes.byteLength,
  sha256: sha256Hex(bytes),
});

afterEach(async () => {
  await Promise.all(ownedRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('generated private storage keys', () => {
  it('constructs only the exact asset and artifact key forms', () => {
    expect(createAssetObjectKey({ assetId, assetVersion: 12, workspaceId })).toBe(
      `w/${workspaceId}/a/${assetId}/v/12/content`,
    );
    expect(createArtifactObjectKey({ jobId, outputId, projectId, workspaceId })).toBe(
      `w/${workspaceId}/p/${projectId}/j/${jobId}/o/${outputId}/content`,
    );
  });

  it('enforces asset and artifact byte ceilings by parsed key kind', () => {
    const assetKey = createAssetObjectKey({ assetId, assetVersion: 1, workspaceId });
    const artifactKey = createArtifactObjectKey({ jobId, outputId, projectId, workspaceId });
    expect(() =>
      assertExactStorageObject({ key: assetKey, byteSize: 20_971_520, sha256: '0'.repeat(64) }),
    ).not.toThrow();
    expect(() =>
      assertExactStorageObject({ key: assetKey, byteSize: 20_971_521, sha256: '0'.repeat(64) }),
    ).toThrowError(expect.objectContaining({ code: 'STORAGE_SIZE_MISMATCH' }));
    expect(() =>
      assertExactStorageObject({ key: artifactKey, byteSize: 52_428_800, sha256: '0'.repeat(64) }),
    ).not.toThrow();
    expect(() =>
      assertExactStorageObject({ key: artifactKey, byteSize: 52_428_801, sha256: '0'.repeat(64) }),
    ).toThrowError(expect.objectContaining({ code: 'STORAGE_SIZE_MISMATCH' }));
  });

  it.each([
    '/absolute/content',
    '../escape',
    `w/${workspaceId}/a/${assetId}/v/0/content`,
    `w/${workspaceId}/a/${assetId}/v/1/../../content`,
    `w\\${workspaceId}\\content`,
    `w/${workspaceId}/p/${projectId}/j/${jobId}/o/${outputId}/extra`,
  ])('rejects non-generated key %s', (key) => {
    expect(() => parseStorageObjectKey(key)).toThrowError(
      expect.objectContaining({ code: 'STORAGE_INVALID_KEY' }),
    );
  });
});

describe('LocalAssetStorage', () => {
  it('stages, atomically promotes, reads, and applies private modes', async () => {
    const owned = await createOwnedRoot();
    const storage = await createStorage(owned);
    const bytes = Buffer.from('synthetic immutable bytes', 'utf8');
    const expected = descriptorFor(bytes);
    const staged = await storage.stageExact(expected, [bytes.subarray(0, 4), bytes.subarray(4)]);

    await expect(storage.promote(staged)).resolves.toBe('promoted');
    await expect(storage.readExact(expected)).resolves.toEqual(bytes);

    const root = path.join(owned, 'private-assets');
    const target = path.join(root, ...expected.key.split('/'));
    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(target)).mode & 0o777).toBe(0o600);
  });

  it('treats an identical existing object as idempotent without overwriting it', async () => {
    const owned = await createOwnedRoot();
    const storage = await createStorage(owned);
    const bytes = Buffer.from('same immutable bytes', 'utf8');
    const expected = descriptorFor(bytes);
    const first = await storage.stageExact(expected, [bytes]);
    await storage.promote(first);
    const second = await storage.stageExact(expected, [bytes]);

    await expect(storage.promote(second)).resolves.toBe('already-present');
    await expect(storage.readExact(expected)).resolves.toEqual(bytes);
  });

  it('rejects a same-key different-digest promotion and preserves original bytes', async () => {
    const owned = await createOwnedRoot();
    const storage = await createStorage(owned);
    const original = Buffer.from('original immutable bytes', 'utf8');
    const conflicting = Buffer.from('conflict immutable bytes', 'utf8');
    expect(conflicting.byteLength).toBe(original.byteLength);
    const expected = descriptorFor(original);
    await storage.promote(await storage.stageExact(expected, [original]));
    const conflictExpected: ExactStorageObject = {
      ...expected,
      sha256: sha256Hex(conflicting),
    };
    const staged = await storage.stageExact(conflictExpected, [conflicting]);

    await expect(storage.promote(staged)).rejects.toMatchObject({ code: 'STORAGE_CONFLICT' });
    await expect(storage.readExact(expected)).resolves.toEqual(original);
  });

  it('allows one concurrent promotion winner and one verified identical loser', async () => {
    const owned = await createOwnedRoot();
    const storage = await createStorage(owned);
    const bytes = Buffer.from('concurrent immutable bytes', 'utf8');
    const expected = descriptorFor(bytes);
    const first = await storage.stageExact(expected, [bytes]);
    const second = await storage.stageExact(expected, [bytes]);

    const results = await Promise.all([storage.promote(first), storage.promote(second)]);

    expect(results.sort()).toEqual(['already-present', 'promoted']);
    await expect(storage.readExact(expected)).resolves.toEqual(bytes);
  });

  it('cleans temporary files on size, digest, discard, and losing-promotion paths', async () => {
    const owned = await createOwnedRoot();
    const storage = await createStorage(owned);
    const bytes = Buffer.from('cleanup bytes', 'utf8');
    const expected = descriptorFor(bytes);

    await expect(storage.stageExact(expected, [bytes.subarray(0, -1)])).rejects.toMatchObject({
      code: 'STORAGE_SIZE_MISMATCH',
    });
    await expect(
      storage.stageExact({ ...expected, sha256: '0'.repeat(64) }, [bytes]),
    ).rejects.toMatchObject({ code: 'STORAGE_DIGEST_MISMATCH' });
    const staged = await storage.stageExact(expected, [bytes]);
    await storage.discard(staged);

    const names = await readdir(path.join(owned, 'private-assets'), { recursive: true });
    expect(names.filter((name) => path.basename(String(name)).startsWith('.tmp-'))).toEqual([]);
  });

  it('does not delete an active stage when an injected temporary ID collides', async () => {
    const owned = await createOwnedRoot();
    const storage = await LocalAssetStorage.create({
      rootDirectory: path.join(owned, 'private-assets'),
      nextTempId: () => 'aaaaaaaaaaaaaaaa',
    });
    const bytes = Buffer.from('collision-safe bytes', 'utf8');
    const expected = descriptorFor(bytes);
    const first = await storage.stageExact(expected, [bytes]);

    await expect(storage.stageExact(expected, [bytes])).rejects.toMatchObject({
      code: 'STORAGE_STAGE_INVALID',
    });
    await expect(storage.promote(first)).resolves.toBe('promoted');
    await expect(storage.readExact(expected)).resolves.toEqual(bytes);
  });

  it('rejects forged staged metadata and retains the authenticated active stage', async () => {
    const owned = await createOwnedRoot();
    const storage = await createStorage(owned);
    const bytes = Buffer.from('authenticated stage bytes', 'utf8');
    const expected = descriptorFor(bytes);
    const staged = await storage.stageExact(expected, [bytes]);
    const forgeries = [
      { ...staged, byteSize: staged.byteSize + 1 },
      { ...staged, sha256: 'f'.repeat(64) },
      { ...staged, key: createAssetObjectKey({ assetId, assetVersion: 2, workspaceId }) },
    ];

    for (const forged of forgeries) {
      await expect(storage.promote(forged)).rejects.toMatchObject({
        code: 'STORAGE_STAGE_INVALID',
      });
      await expect(storage.discard(forged)).rejects.toMatchObject({
        code: 'STORAGE_STAGE_INVALID',
      });
    }
    await expect(storage.promote(staged)).resolves.toBe('promoted');
    await expect(storage.readExact(expected)).resolves.toEqual(bytes);
  });

  it('removes a newly linked final when deterministic read-back verification fails', async () => {
    const owned = await createOwnedRoot();
    const root = path.join(owned, 'private-assets');
    const storage = await LocalAssetStorage.create({
      rootDirectory: root,
      nextTempId: () => 'bbbbbbbbbbbbbbbb',
      afterLinkBeforeVerification: async () => chmod(root, 0o755),
    });
    const bytes = Buffer.from('post-link rollback bytes', 'utf8');
    const expected = descriptorFor(bytes);
    const staged = await storage.stageExact(expected, [bytes]);
    const target = path.join(root, ...expected.key.split('/'));

    await expect(storage.promote(staged)).rejects.toMatchObject({
      code: 'STORAGE_INVALID_OBJECT',
    });
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    const names = await readdir(root, { recursive: true });
    expect(names.filter((name) => path.basename(String(name)).startsWith('.tmp-'))).toEqual([]);
  });

  it('never rolls back a post-link replacement with a different inode', async () => {
    const owned = await createOwnedRoot();
    const root = path.join(owned, 'private-assets');
    const bytes = Buffer.from('post-link original bytes', 'utf8');
    const replacement = Buffer.from('post-link attacker bytes', 'utf8');
    expect(replacement.byteLength).toBe(bytes.byteLength);
    const expected = descriptorFor(bytes);
    const target = path.join(root, ...expected.key.split('/'));
    const storage = await LocalAssetStorage.create({
      rootDirectory: root,
      nextTempId: () => 'cccccccccccccccc',
      afterLinkBeforeVerification: async () => {
        await unlink(target);
        await writeFile(target, replacement, { mode: 0o600 });
      },
    });
    const staged = await storage.stageExact(expected, [bytes]);

    await expect(storage.promote(staged)).rejects.toMatchObject({
      code: 'STORAGE_DIGEST_MISMATCH',
    });
    expect(await readFile(target)).toEqual(replacement);
    const names = await readdir(root, { recursive: true });
    expect(names.filter((name) => path.basename(String(name)).startsWith('.tmp-'))).toEqual([]);
  });

  it('cleans temporary bytes when the source iterator throws', async () => {
    const owned = await createOwnedRoot();
    const storage = await createStorage(owned);
    const bytes = Buffer.from('iterator failure bytes', 'utf8');
    const expected = descriptorFor(bytes);
    const source = {
      async *[Symbol.asyncIterator]() {
        yield bytes.subarray(0, 4);
        throw new Error('synthetic iterator failure');
      },
    };

    await expect(storage.stageExact(expected, source)).rejects.toThrow(/synthetic iterator/);
    const names = await readdir(path.join(owned, 'private-assets'), { recursive: true });
    expect(names.filter((name) => path.basename(String(name)).startsWith('.tmp-'))).toEqual([]);
  });

  it('fails closed and cleans its stage when an ancestor mode changes before promotion', async () => {
    const owned = await createOwnedRoot();
    const storage = await createStorage(owned);
    const bytes = Buffer.from('ancestor tamper bytes', 'utf8');
    const expected = descriptorFor(bytes);
    const staged = await storage.stageExact(expected, [bytes]);
    const root = path.join(owned, 'private-assets');
    await chmod(path.join(root, 'w'), 0o755);

    await expect(storage.promote(staged)).rejects.toMatchObject({
      code: 'STORAGE_INVALID_OBJECT',
    });
    const target = path.join(root, ...expected.key.split('/'));
    await expect(stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    const names = await readdir(root, { recursive: true });
    expect(names.filter((name) => path.basename(String(name)).startsWith('.tmp-'))).toEqual([]);
  });

  it('rejects symlink ancestors, symlink targets, nonregular targets, and public roots', async () => {
    const owned = await createOwnedRoot();
    const outside = path.join(owned, 'outside');
    await mkdir(outside);
    const root = path.join(owned, 'private-assets');
    const storage = await createStorage(owned);
    await symlink(outside, path.join(root, 'w'));
    const bytes = Buffer.from('unsafe target bytes', 'utf8');
    const expected = descriptorFor(bytes);
    await expect(storage.stageExact(expected, [bytes])).rejects.toMatchObject({
      code: 'STORAGE_INVALID_OBJECT',
    });

    const publicRoot = path.join(owned, 'public', 'storage');
    await expect(LocalAssetStorage.create({ rootDirectory: publicRoot })).rejects.toMatchObject({
      code: 'STORAGE_INVALID_OBJECT',
    });

    const secondOwned = await createOwnedRoot();
    const secondStorage = await createStorage(secondOwned);
    const secondExpected = descriptorFor(bytes, 2);
    const staged = await secondStorage.stageExact(secondExpected, [bytes]);
    await secondStorage.discard(staged);
    const target = path.join(secondOwned, 'private-assets', ...secondExpected.key.split('/'));
    await writeFile(path.join(secondOwned, 'outside-file'), bytes);
    await symlink(path.join(secondOwned, 'outside-file'), target);
    await expect(secondStorage.readExact(secondExpected)).rejects.toMatchObject({
      code: 'STORAGE_INVALID_OBJECT',
    });
    await unlink(target);
    await mkdir(target);
    await expect(secondStorage.readExact(secondExpected)).rejects.toMatchObject({
      code: 'STORAGE_INVALID_OBJECT',
    });
  });

  it('detects post-promotion size and digest tampering', async () => {
    const owned = await createOwnedRoot();
    const storage = await createStorage(owned);
    const bytes = Buffer.from('tamper detection', 'utf8');
    const expected = descriptorFor(bytes);
    await storage.promote(await storage.stageExact(expected, [bytes]));
    const target = path.join(owned, 'private-assets', ...expected.key.split('/'));

    await writeFile(target, Buffer.alloc(bytes.byteLength, 0x78));
    await expect(storage.readExact(expected)).rejects.toMatchObject({
      code: 'STORAGE_DIGEST_MISMATCH',
    });
    await writeFile(target, Buffer.concat([bytes, Buffer.from('x')]));
    await expect(storage.readExact(expected)).rejects.toMatchObject({
      code: 'STORAGE_SIZE_MISMATCH',
    });
    await writeFile(target, bytes);
    await chmod(target, 0o644);
    await expect(storage.readExact(expected)).rejects.toMatchObject({
      code: 'STORAGE_INVALID_OBJECT',
    });
    expect(await readFile(target)).toEqual(bytes);
  });
});
