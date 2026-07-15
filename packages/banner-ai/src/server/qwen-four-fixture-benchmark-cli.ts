import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDeterministicOracleMatchingQwenOutputV1 } from '../evaluation/qwen-four-fixture-quality.js';
import { createDeterministicQwenTransport } from './qwen3-vl-deterministic-fake-transport.js';
import {
  createQwenDryRunExecutionAuthorization,
  finalizeQwenDiagnosticReportForAuthorizationV1,
  preflightQwenLiveExecutionAuthorization,
  releaseQwenDiagnosticArtifactsForAuthorizationV1,
  reserveQwenDiagnosticArtifactsForAuthorizationV1,
  type QwenAdapterClockPort,
} from './qwen3-vl-scene-analysis-adapter.js';
import {
  QWEN_FOUR_FIXTURE_REPORT_PATH,
  runQwenFourFixtureBenchmark,
  serializeQwenFourFixtureBenchmarkReport,
} from './qwen-four-fixture-benchmark.js';

const fixtureIds = [
  'banner-person-v1',
  'banner-product-v1',
  'banner-text-heavy-v1',
  'banner-no-text-v1',
] as const;

const cancellationState = {
  cancelled: false,
  throwIfCancelled(): void {
    if (this.cancelled) throw new Error('Benchmark cancellation requested.');
  },
};

process.once('SIGINT', () => {
  cancellationState.cancelled = true;
});

const writeReport = async (input: {
  readonly report: unknown;
  readonly relativePath: string;
  readonly exclusive: boolean;
}): Promise<void> => {
  const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
  const outputPath = resolve(repositoryRoot, input.relativePath);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, serializeQwenFourFixtureBenchmarkReport(input.report), {
    encoding: 'utf8',
    mode: 0o600,
    flag: input.exclusive ? 'wx' : 'w',
  });
};

const runDry = async (): Promise<void> => {
  const fixedEpochMs = Date.parse('2026-07-15T12:00:00.000Z');
  let monotonicMs = 0;
  const clock: QwenAdapterClockPort = Object.freeze({
    nowEpochMs: () => fixedEpochMs,
    nowMonotonicMs: () => {
      const value = monotonicMs;
      monotonicMs += 5;
      return value;
    },
  });
  const transport = createDeterministicQwenTransport(
    fixtureIds.map((fixtureId) => ({
      kind: 'success' as const,
      output: createDeterministicOracleMatchingQwenOutputV1(fixtureId),
    })),
  );
  const authorization = createQwenDryRunExecutionAuthorization({ nowMs: fixedEpochMs });
  const report = await runQwenFourFixtureBenchmark({
    mode: 'deterministic-fake',
    transport,
    authorization,
    secret: null,
    cancellation: cancellationState,
    clock,
  });
  await writeReport({
    report,
    relativePath: QWEN_FOUR_FIXTURE_REPORT_PATH,
    exclusive: false,
  });
  process.stdout.write(`${QWEN_FOUR_FIXTURE_REPORT_PATH}\n`);
  if (!report.overallPass) process.exitCode = 1;
};

const authorizationPathFromArguments = (): string => {
  const markerIndex = process.argv.indexOf('--authorization-file');
  const candidate = markerIndex >= 0 ? process.argv[markerIndex + 1] : undefined;
  if (candidate === undefined || candidate.length < 1) {
    throw new TypeError('Live Qwen benchmark requires --authorization-file.');
  }
  return resolve(candidate);
};

const assertCleanWorkingTree = (): void => {
  const status = execFileSync('git', ['status', '--porcelain'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (status !== '') throw new TypeError('Live Qwen benchmark requires a clean working tree.');
};

const runLive = async (): Promise<void> => {
  const secret = process.env.DASHSCOPE_API_KEY;
  if (secret === undefined || secret.length < 1) {
    throw new TypeError('Live Qwen benchmark secret is absent.');
  }
  assertCleanWorkingTree();
  const authorizationBytes = await readFile(authorizationPathFromArguments());
  if (authorizationBytes.byteLength < 2 || authorizationBytes.byteLength > 65_536) {
    throw new TypeError('Live Qwen execution authorization file is outside its size bound.');
  }
  const packet = JSON.parse(authorizationBytes.toString('utf8')) as unknown;
  const authorization = preflightQwenLiveExecutionAuthorization({
    packet,
    secretPresent: true,
    nowMs: Date.now(),
  });
  const diagnosticEnabled = authorization.diagnosticCapture !== null;
  if (diagnosticEnabled) await reserveQwenDiagnosticArtifactsForAuthorizationV1(authorization);
  try {
    const { createQwen3VlNativeFetchTransport } =
      await import('./qwen3-vl-native-fetch-transport.js');
    const report = await runQwenFourFixtureBenchmark({
      mode: 'live-provider',
      transport: createQwen3VlNativeFetchTransport(),
      authorization,
      secret,
      cancellation: cancellationState,
    });
    const reportPath =
      authorization.diagnosticCapture?.diagnosticReportRelativePath ??
      QWEN_FOUR_FIXTURE_REPORT_PATH;
    if (diagnosticEnabled) {
      await finalizeQwenDiagnosticReportForAuthorizationV1({
        authorization,
        bytes: Buffer.from(serializeQwenFourFixtureBenchmarkReport(report), 'utf8'),
      });
    } else {
      await writeReport({ report, relativePath: reportPath, exclusive: false });
    }
    process.stdout.write(`${reportPath}\n`);
    if (!report.overallPass) process.exitCode = 1;
  } finally {
    if (diagnosticEnabled) {
      await releaseQwenDiagnosticArtifactsForAuthorizationV1(authorization);
    }
  }
};

const main = async (): Promise<void> => {
  if (process.argv.includes('--dry-run') && !process.argv.includes('--live')) {
    await runDry();
    return;
  }
  if (process.argv.includes('--live') && !process.argv.includes('--dry-run')) {
    await runLive();
    return;
  }
  throw new TypeError('Choose exactly one of --dry-run or --live.');
};

void main().catch(() => {
  process.stderr.write('Qwen benchmark failed closed before completion.\n');
  process.exitCode = 1;
});
