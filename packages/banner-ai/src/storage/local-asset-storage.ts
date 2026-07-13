import { createHash, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  realpath,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import path from 'node:path';

import {
  StorageSecurityError,
  assertExactStorageObject,
  parseStorageObjectKey,
  type AssetStoragePort,
  type ExactStorageObject,
  type StagedStorageObject,
  type StorageByteSource,
  type StoragePromotionResult,
} from '../ports/asset-storage.js';

export interface LocalAssetStorageOptions {
  readonly afterLinkBeforeVerification?: () => Promise<void> | void;
  readonly nextTempId?: () => string;
  readonly rootDirectory: string;
}

interface ActiveStage {
  readonly descriptor: StagedStorageObject;
  readonly temporaryPath: string;
}

const tempIdPattern = /^[0-9a-f]{16,64}$/;

const isWithin = (candidate: string, root: string): boolean => {
  const relative = path.relative(root, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
};

const safeUnlink = async (filename: string): Promise<void> => {
  try {
    await unlink(filename);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
};

const writeAll = async (handle: FileHandle, bytes: Uint8Array): Promise<void> => {
  let offset = 0;
  while (offset < bytes.byteLength) {
    const result = await handle.write(bytes, offset, bytes.byteLength - offset, null);
    if (result.bytesWritten < 1) {
      throw new StorageSecurityError('STORAGE_INVALID_OBJECT', 'Storage write made no progress.');
    }
    offset += result.bytesWritten;
  }
};

export class LocalAssetStorage implements AssetStoragePort {
  readonly #activeStages = new Map<string, ActiveStage>();
  readonly #afterLinkBeforeVerification: () => Promise<void> | void;
  readonly #nextTempId: () => string;
  #rootDirectory: string;

  private constructor(options: LocalAssetStorageOptions) {
    this.#afterLinkBeforeVerification = options.afterLinkBeforeVerification ?? (() => undefined);
    this.#rootDirectory = path.resolve(options.rootDirectory);
    this.#nextTempId = options.nextTempId ?? (() => randomBytes(16).toString('hex'));
  }

  static async create(options: LocalAssetStorageOptions): Promise<LocalAssetStorage> {
    const storage = new LocalAssetStorage(options);
    await storage.#initializeRoot();
    return storage;
  }

  async #initializeRoot(): Promise<void> {
    if (this.#rootDirectory.split(path.sep).includes('public')) {
      throw new StorageSecurityError(
        'STORAGE_INVALID_OBJECT',
        'Private storage root must not be inside a public directory.',
      );
    }
    await mkdir(this.#rootDirectory, { mode: 0o700, recursive: true });
    const rootStat = await lstat(this.#rootDirectory);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
      throw new StorageSecurityError('STORAGE_INVALID_OBJECT', 'Storage root is not a real directory.');
    }
    this.#rootDirectory = await realpath(this.#rootDirectory);
    if (this.#rootDirectory.split(path.sep).includes('public')) {
      throw new StorageSecurityError(
        'STORAGE_INVALID_OBJECT',
        'Private storage root resolves inside a public directory.',
      );
    }
    await chmod(this.#rootDirectory, 0o700);
  }

  #objectPath(expected: ExactStorageObject): string {
    const key = parseStorageObjectKey(expected.key);
    const target = path.resolve(this.#rootDirectory, ...key.split('/'));
    if (!isWithin(target, this.#rootDirectory)) {
      throw new StorageSecurityError('STORAGE_INVALID_KEY', 'Storage key escapes the private root.');
    }
    return target;
  }

  async #ensureObjectDirectory(expected: ExactStorageObject): Promise<string> {
    const key = parseStorageObjectKey(expected.key);
    const segments = key.split('/').slice(0, -1);
    let cursor = this.#rootDirectory;
    for (const segment of segments) {
      cursor = path.join(cursor, segment);
      try {
        await mkdir(cursor, { mode: 0o700 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
      const entry = await lstat(cursor);
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new StorageSecurityError(
          'STORAGE_INVALID_OBJECT',
          'Storage key ancestor is not a real directory.',
        );
      }
      const resolved = await realpath(cursor);
      if (!isWithin(resolved, this.#rootDirectory)) {
        throw new StorageSecurityError('STORAGE_INVALID_OBJECT', 'Storage ancestor escapes root.');
      }
      await chmod(cursor, 0o700);
    }
    return cursor;
  }

  async #verifyObjectDirectory(expected: ExactStorageObject): Promise<string> {
    const key = parseStorageObjectKey(expected.key);
    const segments = key.split('/').slice(0, -1);
    let cursor = this.#rootDirectory;
    const rootEntry = await lstat(cursor);
    if (!rootEntry.isDirectory() || rootEntry.isSymbolicLink() || (rootEntry.mode & 0o777) !== 0o700) {
      throw new StorageSecurityError('STORAGE_INVALID_OBJECT', 'Storage root permissions are unsafe.');
    }
    for (const segment of segments) {
      cursor = path.join(cursor, segment);
      let entry;
      try {
        entry = await lstat(cursor);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new StorageSecurityError('STORAGE_INVALID_OBJECT', 'Storage ancestor is missing.');
        }
        throw error;
      }
      if (
        !entry.isDirectory() ||
        entry.isSymbolicLink() ||
        (entry.mode & 0o777) !== 0o700
      ) {
        throw new StorageSecurityError(
          'STORAGE_INVALID_OBJECT',
          'Storage key ancestor is not a real directory.',
        );
      }
      if (!isWithin(await realpath(cursor), this.#rootDirectory)) {
        throw new StorageSecurityError('STORAGE_INVALID_OBJECT', 'Storage ancestor escapes root.');
      }
    }
    return cursor;
  }

  async stageExact(
    expected: ExactStorageObject,
    bytes: StorageByteSource,
  ): Promise<StagedStorageObject> {
    assertExactStorageObject(expected);
    const directory = await this.#ensureObjectDirectory(expected);
    const tempId = this.#nextTempId();
    if (!tempIdPattern.test(tempId)) {
      throw new StorageSecurityError('STORAGE_STAGE_INVALID', 'Temporary ID is invalid.');
    }
    const token = `${String(this.#activeStages.size)}-${tempId}`;
    const temporaryPath = path.join(directory, `.tmp-${tempId}`);
    let handle: FileHandle | undefined;
    let created = false;

    try {
      handle = await open(
        temporaryPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      created = true;
      const hash = createHash('sha256');
      let byteSize = 0;
      for await (const chunk of bytes) {
        if (!(chunk instanceof Uint8Array)) {
          throw new StorageSecurityError(
            'STORAGE_INVALID_OBJECT',
            'Storage source yielded a non-byte chunk.',
          );
        }
        if (chunk.byteLength > expected.byteSize - byteSize) {
          throw new StorageSecurityError('STORAGE_SIZE_MISMATCH', 'Storage source exceeds exact size.');
        }
        await writeAll(handle, chunk);
        hash.update(chunk);
        byteSize += chunk.byteLength;
      }
      if (byteSize !== expected.byteSize) {
        throw new StorageSecurityError('STORAGE_SIZE_MISMATCH', 'Storage source size is incomplete.');
      }
      if (hash.digest('hex') !== expected.sha256) {
        throw new StorageSecurityError('STORAGE_DIGEST_MISMATCH', 'Storage source digest differs.');
      }
      await handle.sync();
      await handle.chmod(0o600);
      await handle.close();
      handle = undefined;

      const descriptor: StagedStorageObject = { ...expected, token };
      this.#activeStages.set(token, { descriptor, temporaryPath });
      return descriptor;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      if (created) await safeUnlink(temporaryPath);
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        throw new StorageSecurityError(
          'STORAGE_STAGE_INVALID',
          'Temporary storage name collided with an existing stage.',
        );
      }
      throw error;
    }
  }

  async discard(staged: StagedStorageObject): Promise<void> {
    const active = this.#activeStages.get(staged.token);
    if (active === undefined || !this.#stageDescriptorMatches(active.descriptor, staged)) {
      throw new StorageSecurityError('STORAGE_STAGE_INVALID', 'Storage stage token is not active.');
    }
    this.#activeStages.delete(staged.token);
    await safeUnlink(active.temporaryPath);
  }

  #stageDescriptorMatches(
    authoritative: StagedStorageObject,
    candidate: StagedStorageObject,
  ): boolean {
    return (
      authoritative.token === candidate.token &&
      authoritative.key === candidate.key &&
      authoritative.byteSize === candidate.byteSize &&
      authoritative.sha256 === candidate.sha256
    );
  }

  async #removeNewLinkIfSameInode(temporaryPath: string, target: string): Promise<void> {
    try {
      const [temporary, linkedTarget] = await Promise.all([lstat(temporaryPath), lstat(target)]);
      if (
        temporary.isFile() &&
        !temporary.isSymbolicLink() &&
        linkedTarget.isFile() &&
        !linkedTarget.isSymbolicLink() &&
        temporary.dev === linkedTarget.dev &&
        temporary.ino === linkedTarget.ino
      ) {
        await safeUnlink(target);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  async promote(staged: StagedStorageObject): Promise<StoragePromotionResult> {
    const active = this.#activeStages.get(staged.token);
    if (active === undefined || !this.#stageDescriptorMatches(active.descriptor, staged)) {
      throw new StorageSecurityError('STORAGE_STAGE_INVALID', 'Storage stage token is not active.');
    }
    const authoritative = active.descriptor;
    const target = this.#objectPath(authoritative);
    let newlyLinked = false;

    try {
      await this.#verifyObjectDirectory(authoritative);
      try {
        await link(active.temporaryPath, target);
        newlyLinked = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        try {
          await this.readExact(authoritative);
          return 'already-present';
        } catch {
          throw new StorageSecurityError(
            'STORAGE_CONFLICT',
            'Immutable storage key already contains different or unsafe content.',
          );
        }
      }

      await this.#afterLinkBeforeVerification();
      await this.readExact(authoritative);
      return 'promoted';
    } catch (error) {
      if (newlyLinked) {
        await this.#removeNewLinkIfSameInode(active.temporaryPath, target);
      }
      throw error;
    } finally {
      this.#activeStages.delete(authoritative.token);
      await safeUnlink(active.temporaryPath);
    }
  }

  async readExact(expected: ExactStorageObject): Promise<Uint8Array> {
    assertExactStorageObject(expected);
    const target = this.#objectPath(expected);
    await this.#verifyObjectDirectory(expected);

    let targetStat;
    try {
      targetStat = await lstat(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new StorageSecurityError('STORAGE_INVALID_OBJECT', 'Stored object does not exist.');
      }
      throw error;
    }
    if (
      !targetStat.isFile() ||
      targetStat.isSymbolicLink() ||
      (targetStat.mode & 0o777) !== 0o600
    ) {
      throw new StorageSecurityError('STORAGE_INVALID_OBJECT', 'Stored object is not a regular file.');
    }
    if (!isWithin(await realpath(target), this.#rootDirectory)) {
      throw new StorageSecurityError('STORAGE_INVALID_OBJECT', 'Stored object escapes private root.');
    }

    const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size !== expected.byteSize) {
        throw new StorageSecurityError('STORAGE_SIZE_MISMATCH', 'Stored object size differs.');
      }
      const bytes = Buffer.allocUnsafe(expected.byteSize);
      let offset = 0;
      while (offset < bytes.byteLength) {
        const result = await handle.read(bytes, offset, bytes.byteLength - offset, offset);
        if (result.bytesRead < 1) {
          throw new StorageSecurityError('STORAGE_SIZE_MISMATCH', 'Stored object ended early.');
        }
        offset += result.bytesRead;
      }
      const after = await handle.stat();
      if (after.size !== before.size || after.ino !== before.ino || after.dev !== before.dev) {
        throw new StorageSecurityError('STORAGE_INVALID_OBJECT', 'Stored object changed during read.');
      }
      if (createHash('sha256').update(bytes).digest('hex') !== expected.sha256) {
        throw new StorageSecurityError('STORAGE_DIGEST_MISMATCH', 'Stored object digest differs.');
      }
      return bytes;
    } finally {
      await handle.close();
    }
  }
}
