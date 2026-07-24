import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';

import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import {
  SAM_CORPUS_ENDPOINT_ID,
  SAM_CORPUS_ENDPOINT_VERSION,
  SAM_CORPUS_EVALUATION_FIXTURES_V1,
  SAM_CORPUS_WORKER_IMAGE_DIGEST,
} from './sam-corpus-evaluation-catalog-v1.js';

export const SAM_TEXT_HEAVY_PRODUCTION_V3_REPOSITORY_SHA =
  '524a708ed95972e39a994ad711e4202238094fc2' as const;
export const SAM_TEXT_HEAVY_PRODUCTION_V3_OUTPUT_ROOT = '/private/tmp' as const;
export const SAM_TEXT_HEAVY_PRODUCTION_V3_CLAIM_ROOT =
  '/private/tmp/fabrica-sam-text-heavy-production-v3-claims' as const;

const textHeavy = SAM_CORPUS_EVALUATION_FIXTURES_V1['text-heavy'];
const STAGING_SUFFIX = '.fabrica-sam-corpus-staging';
const PRODUCTION_BASENAME = /^fabrica-sam-text-heavy-real-call-v3-[0-9]{2}-524a708ed959$/u;
const TEST_ROOT_BASENAME = /^fabrica-sam-text-heavy-production-v3-test-root-[A-Za-z0-9_-]+$/u;
const TEST_OUTPUT_BASENAME = /^fabrica-sam-text-heavy-production-v3-fake-[0-9a-f]{12}$/u;

export const SAM_TEXT_HEAVY_PRODUCTION_V3_CANONICAL_CALL_IDENTITY = Object.freeze({
  repositorySha: SAM_TEXT_HEAVY_PRODUCTION_V3_REPOSITORY_SHA,
  endpointId: SAM_CORPUS_ENDPOINT_ID,
  endpointVersion: SAM_CORPUS_ENDPOINT_VERSION,
  workerImageDigest: SAM_CORPUS_WORKER_IMAGE_DIGEST,
  fixtureId: textHeavy.fixtureId,
  requestId: textHeavy.identifiers.requestId,
  workspaceId: textHeavy.identifiers.workspaceId,
  jobId: textHeavy.identifiers.jobId,
  attemptId: textHeavy.identifiers.attemptId,
  canonicalRequestByteLength: textHeavy.canonicalRequest.byteLength,
  canonicalRequestSha256: textHeavy.canonicalRequest.sha256,
});

export const SAM_TEXT_HEAVY_PRODUCTION_V3_CANONICAL_CALL_CLAIM_SHA256 = createHash('sha256')
  .update(canonicalizeJson(SAM_TEXT_HEAVY_PRODUCTION_V3_CANONICAL_CALL_IDENTITY))
  .digest('hex');

export type SamTextHeavyProductionV3RootKind =
  'production-private-tmp' | 'test-only-temporary-root';

export interface SamTextHeavyProductionV3TestRoot {
  readonly purpose: 'test-only-sam-text-heavy-production-v3-root';
}

export interface SamTextHeavyProductionV3OutputTarget {
  readonly purpose: 'reserved-sam-text-heavy-production-v3-output-target';
}

export interface SamTextHeavyProductionV3DurableReservation {
  readonly purpose: 'durably-reserved-sam-text-heavy-production-v3-call';
}

interface RootState {
  readonly kind: SamTextHeavyProductionV3RootKind;
  readonly outputRoot: string;
  readonly claimRoot: string;
}

interface OutputTargetState extends RootState {
  readonly outputDirectory: string;
  reservationAttempted: boolean;
  retired: boolean;
}

interface DurableReservationState {
  readonly target: SamTextHeavyProductionV3OutputTarget;
  readonly targetState: OutputTargetState;
  readonly claimPath: string;
  readonly claimRecordText: string;
  readonly claimRecordSha256: string;
}

export interface SamTextHeavyProductionV3OutputTargetSnapshot {
  readonly kind: SamTextHeavyProductionV3RootKind;
  readonly outputRoot: string;
  readonly claimRoot: string;
  readonly outputDirectory: string;
  readonly reservationAttempted: boolean;
  readonly retired: boolean;
}

export interface SamTextHeavyProductionV3DurableReservationSnapshot {
  readonly target: SamTextHeavyProductionV3OutputTarget;
  readonly rootKind: SamTextHeavyProductionV3RootKind;
  readonly outputDirectory: string;
  readonly claimPath: string;
  readonly claimRecordSha256: string;
}

const testRoots = new WeakMap<object, RootState>();
const outputTargets = new WeakMap<object, OutputTargetState>();
const durableReservations = new WeakMap<object, DurableReservationState>();
const reservedOutputPaths = new Set<string>();
const retiredOutputPaths = new Set<string>();

const sanitizeFilesystemBoundary = async <T>(
  label: string,
  operation: () => Promise<T>,
): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof TypeError) throw error;
    throw new TypeError(`${label} failed closed.`);
  }
};

const isMissing = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';

const isAlreadyPresent = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST';

const assertExactAbsolutePath = (path: string, label: string): void => {
  if (
    typeof path !== 'string' ||
    path.includes('\0') ||
    path.includes('\\') ||
    !isAbsolute(path) ||
    normalize(path) !== path ||
    resolve(path) !== path ||
    path
      .slice(1)
      .split(sep)
      .some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new TypeError(`${label} must be exact, absolute, and unambiguous.`);
  }
};

const assertRealDirectory = async (path: string, label: string): Promise<void> => {
  assertExactAbsolutePath(path, label);
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (await realpath(path)) !== path) {
    throw new TypeError(`${label} must be one real non-symlink directory.`);
  }
};

const assertPrivateOwnedDirectory = async (path: string, label: string): Promise<void> => {
  await assertRealDirectory(path, label);
  const stat = await lstat(path);
  const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  if ((stat.mode & 0o077) !== 0 || (currentUid !== undefined && stat.uid !== currentUid)) {
    throw new TypeError(`${label} must be private and owned by the current process user.`);
  }
};

const assertAbsent = async (path: string): Promise<void> => {
  try {
    await lstat(path);
    throw new TypeError('SAM text-heavy output, staging, or reservation path already exists.');
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
};

const ensureClaimRoot = async (state: RootState): Promise<void> => {
  if (dirname(state.claimRoot) !== state.outputRoot) {
    throw new TypeError('SAM text-heavy claim root escaped its approved output root.');
  }
  try {
    await mkdir(state.claimRoot, { mode: 0o700 });
  } catch (error) {
    if (!isAlreadyPresent(error)) throw error;
  }
  await assertPrivateOwnedDirectory(state.claimRoot, 'SAM text-heavy durable claim root');
};

const verifyClaimFile = async (
  claimPath: string,
  expected: Buffer,
  expectedSha256: string,
): Promise<void> => {
  const handle = await open(claimPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    const currentUid = typeof process.getuid === 'function' ? process.getuid() : undefined;
    const actual = await handle.readFile();
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      (stat.mode & 0o077) !== 0 ||
      (currentUid !== undefined && stat.uid !== currentUid) ||
      !actual.equals(expected) ||
      createHash('sha256').update(actual).digest('hex') !== expectedSha256
    ) {
      throw new TypeError('SAM text-heavy durable claim verification failed closed.');
    }
  } finally {
    await handle.close();
  }
};

const prepareOutputTarget = async (
  root: RootState,
  outputDirectory: string,
): Promise<SamTextHeavyProductionV3OutputTarget> => {
  await assertRealDirectory(root.outputRoot, 'SAM text-heavy approved output root');
  assertExactAbsolutePath(outputDirectory, 'SAM text-heavy output path');
  const name = basename(outputDirectory);
  const expectedName =
    root.kind === 'production-private-tmp' ? PRODUCTION_BASENAME : TEST_OUTPUT_BASENAME;
  if (
    dirname(outputDirectory) !== root.outputRoot ||
    join(root.outputRoot, name) !== outputDirectory ||
    !expectedName.test(name)
  ) {
    throw new TypeError('SAM text-heavy output must be one approved direct-child basename.');
  }
  if (reservedOutputPaths.has(outputDirectory) || retiredOutputPaths.has(outputDirectory)) {
    throw new TypeError('SAM text-heavy output path is already reserved or retired.');
  }
  await assertAbsent(outputDirectory);
  await assertAbsent(`${outputDirectory}${STAGING_SUFFIX}`);
  reservedOutputPaths.add(outputDirectory);
  const target = Object.freeze({
    purpose: 'reserved-sam-text-heavy-production-v3-output-target' as const,
  });
  outputTargets.set(target, {
    ...root,
    outputDirectory,
    reservationAttempted: false,
    retired: false,
  });
  return target;
};

/** Production stays unselected until a caller supplies one exact approved future child. */
export const prepareSamTextHeavyProductionV3OutputTarget = async (
  outputDirectory: string,
): Promise<SamTextHeavyProductionV3OutputTarget> =>
  sanitizeFilesystemBoundary('SAM text-heavy production output preflight', () =>
    prepareOutputTarget(
      {
        kind: 'production-private-tmp',
        outputRoot: SAM_TEXT_HEAVY_PRODUCTION_V3_OUTPUT_ROOT,
        claimRoot: SAM_TEXT_HEAVY_PRODUCTION_V3_CLAIM_ROOT,
      },
      outputDirectory,
    ),
  );

export const createTestOnlySamTextHeavyProductionV3Root = async (input: {
  readonly rootDirectory: string;
}): Promise<SamTextHeavyProductionV3TestRoot> => {
  if (
    typeof input !== 'object' ||
    input === null ||
    JSON.stringify(Object.keys(input)) !== JSON.stringify(['rootDirectory'])
  ) {
    throw new TypeError('SAM text-heavy test root input is not closed.');
  }
  return sanitizeFilesystemBoundary('SAM text-heavy test root preparation', async () => {
    const temporaryRoot = await realpath(tmpdir());
    await assertRealDirectory(input.rootDirectory, 'SAM text-heavy test output root');
    if (
      dirname(input.rootDirectory) !== temporaryRoot ||
      !TEST_ROOT_BASENAME.test(basename(input.rootDirectory))
    ) {
      throw new TypeError('SAM text-heavy test root is not one branded temporary directory.');
    }
    const state: RootState = Object.freeze({
      kind: 'test-only-temporary-root',
      outputRoot: input.rootDirectory,
      claimRoot: join(input.rootDirectory, 'fabrica-sam-text-heavy-production-v3-claims'),
    });
    await ensureClaimRoot(state);
    const root = Object.freeze({
      purpose: 'test-only-sam-text-heavy-production-v3-root' as const,
    });
    testRoots.set(root, state);
    return root;
  });
};

export const prepareTestOnlySamTextHeavyProductionV3OutputTarget = async (input: {
  readonly root: SamTextHeavyProductionV3TestRoot;
  readonly nonce?: string;
}): Promise<SamTextHeavyProductionV3OutputTarget> => {
  if (
    typeof input !== 'object' ||
    input === null ||
    Object.keys(input).some((key) => key !== 'root' && key !== 'nonce')
  ) {
    throw new TypeError('SAM text-heavy test output input is not closed.');
  }
  const root = testRoots.get(input.root);
  if (root === undefined) throw new TypeError('SAM text-heavy test root is foreign.');
  const nonce = input.nonce ?? randomUUID().replaceAll('-', '').slice(0, 12);
  if (!/^[0-9a-f]{12}$/u.test(nonce)) {
    throw new TypeError('SAM text-heavy test output nonce is malformed.');
  }
  return sanitizeFilesystemBoundary('SAM text-heavy test output preflight', () =>
    prepareOutputTarget(
      root,
      join(root.outputRoot, `fabrica-sam-text-heavy-production-v3-fake-${nonce}`),
    ),
  );
};

export const inspectSamTextHeavyProductionV3OutputTarget = (
  target: SamTextHeavyProductionV3OutputTarget,
): SamTextHeavyProductionV3OutputTargetSnapshot => {
  const state = outputTargets.get(target);
  if (state === undefined || state.retired) {
    throw new TypeError('SAM text-heavy output target is foreign or retired.');
  }
  return Object.freeze({
    kind: state.kind,
    outputRoot: state.outputRoot,
    claimRoot: state.claimRoot,
    outputDirectory: state.outputDirectory,
    reservationAttempted: state.reservationAttempted,
    retired: state.retired,
  });
};

export const reserveSamTextHeavyProductionV3CanonicalCall = async (
  target: SamTextHeavyProductionV3OutputTarget,
): Promise<SamTextHeavyProductionV3DurableReservation> => {
  const state = outputTargets.get(target);
  if (state === undefined || state.retired || state.reservationAttempted) {
    throw new TypeError('SAM text-heavy canonical call reservation was already attempted.');
  }
  // Irreversible process state changes before the first filesystem callback/side effect.
  state.reservationAttempted = true;
  return sanitizeFilesystemBoundary(
    'SAM text-heavy durable canonical-call reservation',
    async () => {
      await ensureClaimRoot(state);
      // Repeat the absence checks immediately before the durable claim. A caller cannot race an
      // output or V2 staging path into existence between target preparation and reservation.
      await assertRealDirectory(state.outputRoot, 'SAM text-heavy approved output root');
      await assertAbsent(state.outputDirectory);
      await assertAbsent(`${state.outputDirectory}${STAGING_SUFFIX}`);
      const claimPath = join(
        state.claimRoot,
        `${SAM_TEXT_HEAVY_PRODUCTION_V3_CANONICAL_CALL_CLAIM_SHA256}.json`,
      );
      const record = Object.freeze({
        schema: 'fabrica-sam-text-heavy-production-v3-durable-claim',
        version: 1,
        status: 'claimed-before-authorization-and-dispatch',
        canonicalCallIdentity: SAM_TEXT_HEAVY_PRODUCTION_V3_CANONICAL_CALL_IDENTITY,
        canonicalCallClaimSha256: SAM_TEXT_HEAVY_PRODUCTION_V3_CANONICAL_CALL_CLAIM_SHA256,
        outputRootKind: state.kind,
        outputDirectory: state.outputDirectory,
      });
      const claimRecordText = `${canonicalizeJson(record)}\n`;
      const bytes = Buffer.from(claimRecordText, 'utf8');
      const recordSha256 = createHash('sha256').update(bytes).digest('hex');
      let claimHandle;
      try {
        claimHandle = await open(
          claimPath,
          constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
          0o600,
        );
        await claimHandle.writeFile(bytes);
        await claimHandle.sync();
      } finally {
        await claimHandle?.close();
      }
      const rootHandle = await open(
        state.claimRoot,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      try {
        await rootHandle.sync();
      } finally {
        await rootHandle.close();
      }
      await verifyClaimFile(claimPath, bytes, recordSha256);
      const reservation = Object.freeze({
        purpose: 'durably-reserved-sam-text-heavy-production-v3-call' as const,
      });
      durableReservations.set(
        reservation,
        Object.freeze({
          target,
          targetState: state,
          claimPath,
          claimRecordText,
          claimRecordSha256: recordSha256,
        }),
      );
      return reservation;
    },
  );
};

export const inspectSamTextHeavyProductionV3DurableReservation = (
  reservation: SamTextHeavyProductionV3DurableReservation,
): SamTextHeavyProductionV3DurableReservationSnapshot => {
  const state = durableReservations.get(reservation);
  if (state === undefined || state.targetState.retired) {
    throw new TypeError('SAM text-heavy durable reservation is foreign or retired.');
  }
  return Object.freeze({
    target: state.target,
    rootKind: state.targetState.kind,
    outputDirectory: state.targetState.outputDirectory,
    claimPath: state.claimPath,
    claimRecordSha256: state.claimRecordSha256,
  });
};

export const retireSamTextHeavyProductionV3Output = (
  reservation: SamTextHeavyProductionV3DurableReservation,
): void => {
  const state = durableReservations.get(reservation);
  if (state === undefined || state.targetState.retired) {
    throw new TypeError('SAM text-heavy durable reservation is foreign or already retired.');
  }
  state.targetState.retired = true;
  retiredOutputPaths.add(state.targetState.outputDirectory);
};

export const verifyRetiredSamTextHeavyProductionV3DurableClaim = async (
  reservation: SamTextHeavyProductionV3DurableReservation,
): Promise<void> => {
  const state = durableReservations.get(reservation);
  if (state === undefined || !state.targetState.retired) {
    throw new TypeError('SAM text-heavy execution claim is foreign or not yet consumed.');
  }
  await sanitizeFilesystemBoundary(
    'SAM text-heavy consumed durable-claim verification',
    async () => {
      await assertPrivateOwnedDirectory(
        state.targetState.claimRoot,
        'SAM text-heavy durable claim root',
      );
      const expected = Buffer.from(state.claimRecordText, 'utf8');
      await verifyClaimFile(state.claimPath, expected, state.claimRecordSha256);
    },
  );
};
