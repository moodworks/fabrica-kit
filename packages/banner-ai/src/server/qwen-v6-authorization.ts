import { execFileSync } from 'node:child_process';
import {
  closeSync,
  fchmodSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  realpathSync,
  mkdirSync,
  openSync,
  ftruncateSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { constants as fsConstants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import {
  QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT,
  QWEN3_VL_ENDPOINT_METHOD,
  QWEN3_VL_PROVIDER_KEY,
  QWEN3_VL_REGION,
  QWEN3_VL_REQUESTED_MODEL_ID,
  QWEN3_VL_SERVER_WORKSPACE_ID,
} from '../evaluation/qwen3-vl-candidate-evidence.js';
import { QWEN_FOUR_FIXTURE_CANONICAL_REQUEST_CATALOG_V1 } from './qwen-four-fixture-request-catalog.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';

export const QWEN_V6_GRANT_ID = 'qwen.owner-grant.scene-analysis-ocr.v6' as const;
export const QWEN_V6_GRANT_VERSION = 1 as const;
export const QWEN_V6_ISSUED_AT = '2026-08-12T08:31:50.000Z' as const;
export const QWEN_V6_EXPIRES_AT = '2026-08-16T00:00:00.000Z' as const;
export const QWEN_V6_PURPOSE = 'scene-analysis-and-ocr-development-evaluation-only' as const;
export const QWEN_V6_BENCHMARK_PURPOSE =
  'one-capped-four-fixture-sequential-zero-retry-benchmark' as const;
export const QWEN_V6_AUTHORIZATION_ID = 'qwen.v6.owner-grant.single-use-20260812' as const;
const MODULE_REPOSITORY_ROOT = realpathSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../..'),
);

const fixtureEntries = [
  {
    fixtureId: 'banner-person-v1',
    normalizedSha256: '6e3175cdd260fde33a3885945eb6f8831da3905afbc723f684035f411dc6d699',
  },
  {
    fixtureId: 'banner-product-v1',
    normalizedSha256: 'a38db6f627ee275eabf7643c99a83aac5e1ac77bbfe1b1abcc24112c6a04e69a',
  },
  {
    fixtureId: 'banner-text-heavy-v1',
    normalizedSha256: '181e4c3762b79b5dfcbdb21c6c873ede8b32bf85dfe98fdecc13d59fb8cbcb62',
  },
  {
    fixtureId: 'banner-no-text-v1',
    normalizedSha256: '40f8a1c4312ec86cb4e38e16b9a423e85c2a9e3cf5f98a4bc510c23f3d4cf073',
  },
] as const;

if (
  QWEN_FOUR_FIXTURE_CANONICAL_REQUEST_CATALOG_V1.some(
    (entry, index) =>
      entry.fixtureId !== fixtureEntries[index]!.fixtureId ||
      entry.normalizedSource.sha256 !== fixtureEntries[index]!.normalizedSha256,
  )
) {
  throw new TypeError('Qwen V6 normalized fixture evidence drifted.');
}

export const QWEN_V6_OWNER_GRANT_PROJECTION = Object.freeze({
  grantId: QWEN_V6_GRANT_ID,
  grantVersion: QWEN_V6_GRANT_VERSION,
  issuedAt: QWEN_V6_ISSUED_AT,
  expiresAt: QWEN_V6_EXPIRES_AT,
  provider: QWEN3_VL_PROVIDER_KEY,
  workspaceId: QWEN3_VL_SERVER_WORKSPACE_ID,
  region: QWEN3_VL_REGION,
  endpoint: QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT,
  method: QWEN3_VL_ENDPOINT_METHOD,
  model: QWEN3_VL_REQUESTED_MODEL_ID,
  fixtures: Object.freeze(fixtureEntries),
  purpose: QWEN_V6_PURPOSE,
  caps: Object.freeze({ sequentialCalls: 4, perFixture: 1, retries: 0, maxCostMicroUsd: '500000' }),
  priorEvidence: Object.freeze({ historicalOnePersonV5: true }),
  forbiddenAuthority: Object.freeze({
    holdout: false,
    segmentation: false,
    reconstruction: false,
    product: false,
    production: false,
    deployment: false,
  }),
});
export const QWEN_V6_GRANT_DIGEST = sha256Hex(
  Buffer.from(canonicalizeJson(QWEN_V6_OWNER_GRANT_PROJECTION), 'utf8'),
);

const QwenV6FixtureBindingSchemas = [
  z
    .strictObject({
      fixtureId: z.literal('banner-person-v1'),
      normalizedSha256: z.literal(fixtureEntries[0].normalizedSha256),
    })
    .readonly(),
  z
    .strictObject({
      fixtureId: z.literal('banner-product-v1'),
      normalizedSha256: z.literal(fixtureEntries[1].normalizedSha256),
    })
    .readonly(),
  z
    .strictObject({
      fixtureId: z.literal('banner-text-heavy-v1'),
      normalizedSha256: z.literal(fixtureEntries[2].normalizedSha256),
    })
    .readonly(),
  z
    .strictObject({
      fixtureId: z.literal('banner-no-text-v1'),
      normalizedSha256: z.literal(fixtureEntries[3].normalizedSha256),
    })
    .readonly(),
] as const;
const QwenV6CapsSchema = z
  .strictObject({
    sequentialCalls: z.literal(4),
    perFixture: z.literal(1),
    retries: z.literal(0),
    maxCostMicroUsd: z.literal('500000'),
  })
  .readonly();
export const QwenV6GrantSchema = z
  .strictObject({
    grantId: z.literal(QWEN_V6_GRANT_ID),
    grantVersion: z.literal(1),
    issuedAt: z.literal(QWEN_V6_ISSUED_AT),
    expiresAt: z.literal(QWEN_V6_EXPIRES_AT),
    provider: z.literal(QWEN3_VL_PROVIDER_KEY),
    workspaceId: z.literal(QWEN3_VL_SERVER_WORKSPACE_ID),
    region: z.literal(QWEN3_VL_REGION),
    endpoint: z.literal(QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT),
    method: z.literal(QWEN3_VL_ENDPOINT_METHOD),
    model: z.literal(QWEN3_VL_REQUESTED_MODEL_ID),
    fixtures: z.tuple(QwenV6FixtureBindingSchemas),
    purpose: z.literal(QWEN_V6_PURPOSE),
    caps: QwenV6CapsSchema,
    priorEvidence: z.strictObject({ historicalOnePersonV5: z.literal(true) }).readonly(),
    forbiddenAuthority: z
      .strictObject({
        holdout: z.literal(false),
        segmentation: z.literal(false),
        reconstruction: z.literal(false),
        product: z.literal(false),
        production: z.literal(false),
        deployment: z.literal(false),
      })
      .readonly(),
  })
  .readonly();
QwenV6GrantSchema.parse(QWEN_V6_OWNER_GRANT_PROJECTION);
export const QWEN_V6_FIXTURE_BINDING_DIGEST = sha256Hex(
  Buffer.from(canonicalizeJson(QWEN_V6_OWNER_GRANT_PROJECTION.fixtures), 'utf8'),
);

export const assertQwenV6ProductionRepositoryClean = (expectedSha: string): void => {
  const root = MODULE_REPOSITORY_ROOT;
  const env = {
    LANG: 'C',
    LC_ALL: 'C',
    TMPDIR: '/tmp',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_ASKPASS: '/bin/false',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_PAGER: 'cat',
    GIT_PROTOCOL_FROM_USER: '0',
  };
  const args = [
    '-C',
    root,
    '-c',
    'core.fsmonitor=false',
    '-c',
    'core.untrackedCache=false',
    '-c',
    'maintenance.auto=false',
    '-c',
    'gc.auto=0',
    '--no-replace-objects',
  ];
  const options = {
    encoding: 'utf8' as const,
    env,
    cwd: root,
    maxBuffer: 4096,
    timeout: 10_000,
    windowsHide: true,
  };
  const sha = execFileSync('/usr/bin/git', [...args, 'rev-parse', '--verify', 'HEAD'], {
    ...options,
  }).trim();
  const topLevel = realpathSync(
    execFileSync('/usr/bin/git', [...args, 'rev-parse', '--show-toplevel'], options).trim(),
  );
  const status = execFileSync(
    '/usr/bin/git',
    [...args, 'status', '--porcelain=v1', '--untracked-files=all'],
    options,
  );
  const cachedDiff = execFileSync(
    '/usr/bin/git',
    [...args, 'diff', '--cached', '--quiet'],
    options,
  );
  const worktreeDiff = execFileSync('/usr/bin/git', [...args, 'diff', '--quiet'], options);
  if (
    topLevel !== MODULE_REPOSITORY_ROOT ||
    sha !== expectedSha ||
    status.length !== 0 ||
    cachedDiff.length !== 0 ||
    worktreeDiff.length !== 0
  )
    throw new Error('Qwen V6 repository is not the trusted clean revision.');
};

const qwenV6DurableReservationPath = (kind: 'claim' | 'report', root: string) =>
  join(root, '.local-data/banner-ai/qwen-four-fixture-live-v6', `${kind}.json`);
const qwenV6Reservations = new WeakMap<
  object,
  { readonly verify: () => void; readonly finalizeReport: (bytes: Uint8Array) => void }
>();
const reserveQwenV6ExecutionAtRoot = (input: {
  readonly grantDigest?: string;
  readonly gitSha: string;
  readonly manualRelease: string;
  readonly root: string;
}) => {
  if (input.grantDigest !== undefined && input.grantDigest !== QWEN_V6_GRANT_DIGEST)
    throw new Error('Qwen V6 grant digest drifted.');
  const root = resolve(input.root ?? process.cwd());
  const dir = join(root, '.local-data/banner-ai/qwen-four-fixture-live-v6');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const localDataDir = join(root, '.local-data');
  const bannerDataDir = join(root, '.local-data/banner-ai');
  for (const directory of [localDataDir, bannerDataDir]) {
    const directoryStat = lstatSync(directory);
    if (!directoryStat.isDirectory())
      throw new Error('Qwen V6 reservation directory is not trusted.');
  }
  const dedicatedStat = lstatSync(dir);
  if (!dedicatedStat.isDirectory() || (dedicatedStat.mode & 0o777) !== 0o700)
    throw new Error('Qwen V6 reservation directory is not trusted.');
  const identity = {
    authorizationId: QWEN_V6_AUTHORIZATION_ID,
    grantDigest: QWEN_V6_GRANT_DIGEST,
    provider: QWEN3_VL_PROVIDER_KEY,
    endpoint: QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT,
    model: QWEN3_VL_REQUESTED_MODEL_ID,
    fixtureIds: fixtureEntries.map((x) => x.fixtureId),
    caps: QWEN_V6_OWNER_GRANT_PROJECTION.caps,
    gitSha: input.gitSha,
    manualRelease: input.manualRelease,
  };
  const bytes = Buffer.from(canonicalizeJson(identity), 'utf8');
  const claimPath = qwenV6DurableReservationPath('claim', root);
  const reportPath = qwenV6DurableReservationPath('report', root);
  const flags =
    fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY | (fsConstants.O_NOFOLLOW ?? 0);
  const fd = openSync(claimPath, flags, 0o600);
  fchmodSync(fd, 0o600);
  try {
    writeFileSync(fd, bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const reportFd = openSync(reportPath, flags, 0o600);
  fchmodSync(reportFd, 0o600);
  fsyncSync(reportFd);
  const reportIdentity = fstatSync(reportFd);
  const claimIdentity = lstatSync(claimPath);
  let finalized = false;
  const parentFd = openSync(dir, 'r');
  try {
    fsyncSync(parentFd);
  } finally {
    closeSync(parentFd);
  }
  const reservation = Object.freeze({
    claimPath,
    reportPath,
    identityDigest: sha256Hex(bytes),
    verify() {
      const claimStat = lstatSync(claimPath);
      const reportStat = lstatSync(reportPath);
      if (
        !claimStat.isFile() ||
        !reportStat.isFile() ||
        (claimStat.mode & 0o777) !== 0o600 ||
        (reportStat.mode & 0o777) !== 0o600
      )
        throw new Error('Qwen V6 reservation is not trusted.');
      if (claimStat.dev !== claimIdentity.dev || claimStat.ino !== claimIdentity.ino)
        throw new Error('Qwen V6 claim identity drifted.');
      const persistedClaim = readFileSync(claimPath);
      if (Buffer.compare(persistedClaim, bytes) !== 0)
        throw new Error('Qwen V6 claim bytes drifted.');
      const heldReport = fstatSync(reportFd);
      const reportPathIdentity = lstatSync(reportPath);
      if (
        heldReport.dev !== reportIdentity.dev ||
        heldReport.ino !== reportIdentity.ino ||
        heldReport.mode !== reportIdentity.mode ||
        reportPathIdentity.dev !== reportIdentity.dev ||
        reportPathIdentity.ino !== reportIdentity.ino ||
        reportStat.size !== 0 ||
        finalized
      )
        throw new Error('Qwen V6 report handle drifted.');
    },
    async finalizeReport(reportBytes: Uint8Array) {
      if (finalized || reportBytes.byteLength > 262_144)
        throw new Error('Qwen V6 report finalization is invalid.');
      const { QwenFourFixtureBenchmarkReportV6Schema, serializeQwenFourFixtureBenchmarkReport } =
        await import('./qwen-four-fixture-benchmark.js');
      let reportValue: unknown;
      try {
        reportValue = QwenFourFixtureBenchmarkReportV6Schema.parse(
          JSON.parse(Buffer.from(reportBytes).toString('utf8')),
        );
      } catch {
        throw new Error('Qwen V6 report schema is invalid.');
      }
      if (
        Buffer.compare(
          Buffer.from(serializeQwenFourFixtureBenchmarkReport(reportValue), 'utf8'),
          Buffer.from(reportBytes),
        ) !== 0
      )
        throw new Error('Qwen V6 report is not canonical.');
      this.verify();
      ftruncateSync(reportFd, 0);
      writeFileSync(reportFd, reportBytes);
      fsyncSync(reportFd);
      const reportParentFd = openSync(dir, 'r');
      try {
        fsyncSync(reportParentFd);
      } finally {
        closeSync(reportParentFd);
      }
      closeSync(reportFd);
      finalized = true;
      if (Buffer.compare(readFileSync(reportPath), Buffer.from(reportBytes)) !== 0)
        throw new Error('Qwen V6 report bytes drifted.');
    },
  });
  qwenV6Reservations.set(reservation, reservation);
  return reservation;
};

export const verifyQwenV6Reservation = (reservation: unknown): void => {
  const state =
    typeof reservation === 'object' && reservation !== null
      ? qwenV6Reservations.get(reservation)
      : undefined;
  if (!state) throw new Error('Qwen V6 reservation is not branded.');
  state.verify();
};
export const finalizeQwenV6Reservation = async (
  reservation: unknown,
  bytes: Uint8Array,
): Promise<void> => {
  const state =
    typeof reservation === 'object' && reservation !== null
      ? qwenV6Reservations.get(reservation)
      : undefined;
  if (!state) throw new Error('Qwen V6 reservation is not branded.');
  await state.finalizeReport(bytes);
};

/** Production reservation is deliberately rooted at this module's repository process root. */
export const reserveQwenV6Execution = (input: {
  readonly grantDigest?: string;
  readonly gitSha: string;
  readonly manualRelease: string;
}) => {
  assertQwenV6ProductionRepositoryClean(input.gitSha);
  return reserveQwenV6ExecutionAtRoot({ ...input, root: MODULE_REPOSITORY_ROOT });
};

/** Test-only escape hatch; never accepted by the native adapter or CLI. */
const qwenV6TestReservationRoots = new WeakSet<object>();
export type QwenV6TestReservationRoot = object;
export const createQwenV6TestReservationRoot = (root: string): QwenV6TestReservationRoot => {
  const capability = Object.freeze({ root });
  qwenV6TestReservationRoots.add(capability);
  return capability;
};
export const reserveQwenV6ExecutionForTest = (input: {
  readonly grantDigest?: string;
  readonly gitSha: string;
  readonly manualRelease: string;
  readonly testRoot: QwenV6TestReservationRoot;
}) => {
  if (!qwenV6TestReservationRoots.has(input.testRoot))
    throw new Error('Untrusted Qwen V6 test root.');
  const root = (input.testRoot as { readonly root?: unknown }).root;
  if (typeof root !== 'string') throw new Error('Invalid Qwen V6 test root.');
  return reserveQwenV6ExecutionAtRoot({ ...input, root });
};
