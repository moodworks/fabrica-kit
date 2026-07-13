export type StorageByteSource = AsyncIterable<Uint8Array> | Iterable<Uint8Array>;

declare const storageObjectKeyBrand: unique symbol;
export type StorageObjectKey = string & { readonly [storageObjectKeyBrand]: true };

export interface ExactStorageObject {
  readonly byteSize: number;
  readonly key: StorageObjectKey;
  readonly sha256: string;
}

export interface StagedStorageObject extends ExactStorageObject {
  readonly token: string;
}

export type StoragePromotionResult = 'already-present' | 'promoted';

export interface AssetStoragePort {
  discard(staged: StagedStorageObject): Promise<void>;
  promote(staged: StagedStorageObject): Promise<StoragePromotionResult>;
  readExact(expected: ExactStorageObject): Promise<Uint8Array>;
  stageExact(expected: ExactStorageObject, bytes: StorageByteSource): Promise<StagedStorageObject>;
}

export type StorageSecurityCode =
  | 'STORAGE_CONFLICT'
  | 'STORAGE_DIGEST_MISMATCH'
  | 'STORAGE_INVALID_KEY'
  | 'STORAGE_INVALID_OBJECT'
  | 'STORAGE_SIZE_MISMATCH'
  | 'STORAGE_STAGE_INVALID';

export class StorageSecurityError extends Error {
  readonly code: StorageSecurityCode;

  constructor(code: StorageSecurityCode, message: string) {
    super(message);
    this.name = 'StorageSecurityError';
    this.code = code;
  }
}

const canonicalUuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const assetKeyPattern = /^w\/([0-9a-f-]{36})\/a\/([0-9a-f-]{36})\/v\/([1-9][0-9]{0,9})\/content$/;
const artifactKeyPattern =
  /^w\/([0-9a-f-]{36})\/p\/([0-9a-f-]{36})\/j\/([0-9a-f-]{36})\/o\/([0-9a-f-]{36})\/content$/;

const assertUuid = (value: string, name: string): void => {
  if (!canonicalUuidPattern.test(value)) {
    throw new StorageSecurityError('STORAGE_INVALID_KEY', `${name} must be a canonical UUID.`);
  }
};

export const createAssetObjectKey = (input: {
  readonly assetId: string;
  readonly assetVersion: number;
  readonly workspaceId: string;
}): StorageObjectKey => {
  assertUuid(input.workspaceId, 'workspaceId');
  assertUuid(input.assetId, 'assetId');
  if (
    !Number.isSafeInteger(input.assetVersion) ||
    input.assetVersion < 1 ||
    input.assetVersion > 2_147_483_647
  ) {
    throw new StorageSecurityError(
      'STORAGE_INVALID_KEY',
      'assetVersion must be a positive 32-bit integer.',
    );
  }
  return `w/${input.workspaceId}/a/${input.assetId}/v/${String(input.assetVersion)}/content` as StorageObjectKey;
};

export const createArtifactObjectKey = (input: {
  readonly jobId: string;
  readonly outputId: string;
  readonly projectId: string;
  readonly workspaceId: string;
}): StorageObjectKey => {
  assertUuid(input.workspaceId, 'workspaceId');
  assertUuid(input.projectId, 'projectId');
  assertUuid(input.jobId, 'jobId');
  assertUuid(input.outputId, 'outputId');
  return `w/${input.workspaceId}/p/${input.projectId}/j/${input.jobId}/o/${input.outputId}/content` as StorageObjectKey;
};

export const parseStorageObjectKey = (input: unknown): StorageObjectKey => {
  if (typeof input !== 'string' || input.startsWith('/') || input.includes('\\')) {
    throw new StorageSecurityError('STORAGE_INVALID_KEY', 'Storage object key is invalid.');
  }
  const match = assetKeyPattern.exec(input) ?? artifactKeyPattern.exec(input);
  if (match === null) {
    throw new StorageSecurityError(
      'STORAGE_INVALID_KEY',
      'Storage object key has no accepted form.',
    );
  }
  for (const value of match.slice(1)) {
    if (value !== undefined && !/^\d+$/.test(value)) assertUuid(value, 'key identifier');
  }
  const segments = input.split('/');
  if (segments[2] === 'a') {
    const version = Number(segments[5]);
    if (!Number.isSafeInteger(version) || version < 1 || version > 2_147_483_647) {
      throw new StorageSecurityError('STORAGE_INVALID_KEY', 'Asset version in key is invalid.');
    }
  }
  return input as StorageObjectKey;
};

export const assertExactStorageObject = (input: ExactStorageObject): void => {
  const key = parseStorageObjectKey(input.key);
  const maximumByteSize = key.split('/')[2] === 'a' ? 20_971_520 : 52_428_800;
  if (
    !Number.isSafeInteger(input.byteSize) ||
    input.byteSize < 1 ||
    input.byteSize > maximumByteSize
  ) {
    throw new StorageSecurityError('STORAGE_SIZE_MISMATCH', 'Stored object size is invalid.');
  }
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) {
    throw new StorageSecurityError('STORAGE_DIGEST_MISMATCH', 'Stored object digest is invalid.');
  }
};
