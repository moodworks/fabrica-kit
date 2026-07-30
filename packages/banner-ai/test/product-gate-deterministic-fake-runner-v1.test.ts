import { lstat, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  PRODUCT_GATE_BLOCKED_HOLDOUT_V1,
  PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
} from '../src/evaluation/product-gate-corpus-v1.js';
import {
  ProductGateDeterministicFakeReportV1Schema,
  PRODUCT_GATE_FAKE_RUNNER_STAGES_V1,
  rejectProductGateBlockedHoldoutFakeExecutionV1,
  runProductGateDeterministicFakeV1,
} from '../src/server/product-gate-deterministic-fake-runner-v1.js';
import {
  createProductGateAttemptIdV1,
  createProductGateLogicalOperationIdV1,
} from '../src/evaluation/product-gate-run-manifest-v1.js';
import {
  loadVerifiedProductGateDevelopmentCorpusV1,
  type VerifiedProductGateDevelopmentCorpusV1,
} from '../src/server/product-gate-development-corpus-loader-v1.js';

const temporaryRoots = new Set<string>();
const seed = '7'.repeat(64);
const recordedProviderProvenance = {
  kind: 'recorded-provider-projection' as const,
  provider: { key: 'future-provider', identitySha256: 'a'.repeat(64) },
  model: { key: 'future-model', identitySha256: 'b'.repeat(64) },
  checkpoint: { status: 'recorded' as const, identitySha256: 'c'.repeat(64) },
  image: { status: 'recorded' as const, identitySha256: 'd'.repeat(64) },
  external: true as const,
};
let verifiedCorpus: VerifiedProductGateDevelopmentCorpusV1;

const temporaryRoot = async (label: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), `fabrica-product-gate-${label}-`));
  temporaryRoots.add(root);
  return root;
};

const boundedOutputRoot = (absolutePath: string) => ({
  kind: 'bounded-test-root' as const,
  absolutePath,
});

beforeAll(async () => {
  verifiedCorpus = await loadVerifiedProductGateDevelopmentCorpusV1({
    manifest: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
    sourceRoot: { kind: 'committed-package-root' },
  });
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await Promise.all([...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots.clear();
});

describe('provider-free deterministic fake product-gate runner', () => {
  it('exercises every stage over all four development fixtures without product-gate authority', async () => {
    const root = await temporaryRoot('complete');
    const fetchSpy = vi.fn(() => {
      throw new Error('network forbidden');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const result = await runProductGateDeterministicFakeV1({
      verifiedCorpus,
      outputRoot: boundedOutputRoot(root),
      deterministicSeed: seed,
      failureInjection: null,
    });
    expect(result.report.cases).toHaveLength(4);
    for (const caseResult of result.report.cases) {
      expect(caseResult.acceptedStages).toEqual(PRODUCT_GATE_FAKE_RUNNER_STAGES_V1);
      expect(caseResult.attempts).toHaveLength(11);
      expect(caseResult.endToEndScorecard.outcome).toBe('not-measurable');
      expect(caseResult.rawReviews.every((review) => review.providerModelBlind)).toBe(true);
      expect(caseResult.adjudication.rawReviewsOverwritten).toBe(false);
    }
    const firstCase = result.report.cases[0]!;
    for (const stage of ['segmentation', 'background'] as const) {
      const attempt = firstCase.attempts.find(
        (candidate) => candidate.stage === stage && candidate.status === 'succeeded',
      )!;
      const structured = JSON.parse(
        await readFile(
          join(
            result.runDirectory,
            `cases/${firstCase.caseId}/attempts/${attempt.attemptId}/structured-result.json`,
          ),
          'utf8',
        ),
      ) as { result: { invocation: { boundary: string } } };
      expect(structured.result.invocation.boundary).toContain('evaluation-only-provider-neutral');
    }
    const cutoutAttempt = firstCase.attempts.find(
      (candidate) => candidate.stage === 'cutout' && candidate.status === 'succeeded',
    )!;
    const cutoutStructured = JSON.parse(
      await readFile(
        join(
          result.runDirectory,
          `cases/${firstCase.caseId}/attempts/${cutoutAttempt.attemptId}/structured-result.json`,
        ),
        'utf8',
      ),
    ) as {
      attempt: { runId: string; attemptId: string; logicalOperationId: string; stage: string };
      result: { runId: string; attemptId: string; logicalOperationId: string; boundary: string };
    };
    expect(cutoutStructured.attempt.stage).toBe('cutout');
    expect(cutoutStructured.result).toMatchObject({
      boundary: 'evaluation-only-provider-neutral-cutout',
      runId: cutoutStructured.attempt.runId,
      attemptId: cutoutStructured.attempt.attemptId,
      logicalOperationId: cutoutStructured.attempt.logicalOperationId,
    });
    expect(result.report).toMatchObject({
      corpusSplit: 'development',
      productGateOutcome: 'not-measurable',
      holdoutAdmitted: false,
      authoritativeGdnEvidenceAvailable: false,
      providerTransmissionAuthority: false,
      realEvaluationAuthority: false,
      networkOperations: 0,
      providerModelCalls: 0,
      samRunpodGpuCalls: 0,
      credentialAccesses: 0,
      paidOperations: 0,
    });
    const secondCase = result.report.cases[1]!;
    expect(
      ProductGateDeterministicFakeReportV1Schema.safeParse({
        ...result.report,
        cases: [
          {
            ...firstCase,
            backgroundScorecard: {
              ...firstCase.backgroundScorecard,
              strategy: 'deterministic-solid-fallback',
              oracleAuthorizationProjectionPresent: true,
              reconstructionDimensions: {
                kind: 'not-applicable',
                reason: 'oracle-authorized-deterministic-solid-fallback',
                permissionSha256: 'e'.repeat(64),
              },
            },
          },
          ...result.report.cases.slice(1),
        ],
      }).success,
    ).toBe(false);
    expect(
      ProductGateDeterministicFakeReportV1Schema.safeParse({
        ...result.report,
        cases: [
          {
            ...firstCase,
            attempts: firstCase.attempts.map((attempt, index) =>
              index === 0 ? { ...attempt, provenance: recordedProviderProvenance } : attempt,
            ),
          },
          ...result.report.cases.slice(1),
        ],
      }).success,
    ).toBe(false);
    expect(
      ProductGateDeterministicFakeReportV1Schema.safeParse({
        ...result.report,
        cases: [
          { ...firstCase, backgroundScorecard: secondCase.backgroundScorecard },
          ...result.report.cases.slice(1),
        ],
      }).success,
    ).toBe(false);
    expect(
      ProductGateDeterministicFakeReportV1Schema.safeParse({
        ...result.report,
        cases: [
          { ...firstCase, rawReviews: secondCase.rawReviews },
          ...result.report.cases.slice(1),
        ],
      }).success,
    ).toBe(false);
    expect(
      ProductGateDeterministicFakeReportV1Schema.safeParse({
        ...result.report,
        cases: [
          { ...firstCase, adjudication: secondCase.adjudication },
          ...result.report.cases.slice(1),
        ],
      }).success,
    ).toBe(false);
    const visionAttempt = firstCase.attempts.find((attempt) => attempt.stage === 'vision')!;
    const { attemptId: ignoredAttemptId, ...visionAttemptCore } = visionAttempt;
    void ignoredAttemptId;
    const extraVisionAttemptCore = {
      ...visionAttemptCore,
      logicalOperationId: createProductGateLogicalOperationIdV1({
        runId: visionAttempt.runId,
        caseId: visionAttempt.caseId,
        stage: 'vision',
        duplicateStageTest: true,
      }),
    };
    const extraVisionAttempt = {
      attemptId: createProductGateAttemptIdV1({
        recordVersion: extraVisionAttemptCore.recordVersion,
        runId: extraVisionAttemptCore.runId,
        caseId: extraVisionAttemptCore.caseId,
        attemptOrdinal: extraVisionAttemptCore.attemptOrdinal,
        stage: extraVisionAttemptCore.stage,
        logicalOperationId: extraVisionAttemptCore.logicalOperationId,
        parentAttemptId: extraVisionAttemptCore.parentAttemptId,
        retry: extraVisionAttemptCore.retry,
      }),
      ...extraVisionAttemptCore,
    };
    expect(
      ProductGateDeterministicFakeReportV1Schema.safeParse({
        ...result.report,
        cases: [
          {
            ...firstCase,
            attempts: firstCase.attempts.map((attempt) =>
              attempt.stage === 'intake' ? extraVisionAttempt : attempt,
            ),
          },
          ...result.report.cases.slice(1),
        ],
      }).success,
    ).toBe(false);
    expect(result.finalManifest.publishedLast).toBe(true);
    expect((await stat(join(result.runDirectory, 'manifest.json'))).mode & 0o777).toBe(0o600);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  }, 120_000);

  it('injects and recovers one exact-parent failure at every evaluation stage', async () => {
    const root = await temporaryRoot('failure-matrix');
    for (const stage of PRODUCT_GATE_FAKE_RUNNER_STAGES_V1) {
      const result = await runProductGateDeterministicFakeV1({
        verifiedCorpus,
        outputRoot: boundedOutputRoot(root),
        deterministicSeed: seed,
        failureInjection: {
          caseId: 'banner-person-v1',
          stage,
          disposition: 'recover',
        },
      });
      const target = result.report.cases[0]!;
      const stageAttempts = target.attempts.filter((attempt) => attempt.stage === stage);
      expect(stageAttempts).toHaveLength(2);
      const [failed, recovered] = stageAttempts;
      expect(failed).toMatchObject({ status: 'failed', outputFinalized: false });
      expect(recovered).toMatchObject({
        status: 'succeeded',
        parentAttemptId: failed!.attemptId,
        retry: {
          parentAttemptId: failed!.attemptId,
          logicalOperationId: failed!.logicalOperationId,
        },
      });
      expect(recovered!.logicalOperationId).toBe(failed!.logicalOperationId);
      expect(target.injectedFailureRecovered).toBe(true);
      expect(target.acceptedStages).toEqual(PRODUCT_GATE_FAKE_RUNNER_STAGES_V1);
    }
  }, 180_000);

  it('produces byte/digest-identical replay evidence from identical recorded inputs', async () => {
    const firstRoot = await temporaryRoot('replay-a');
    const secondRoot = await temporaryRoot('replay-b');
    const input = {
      verifiedCorpus,
      deterministicSeed: seed,
      failureInjection: {
        caseId: 'banner-product-v1' as const,
        stage: 'segmentation' as const,
        disposition: 'recover' as const,
      },
    };
    const first = await runProductGateDeterministicFakeV1({
      ...input,
      outputRoot: boundedOutputRoot(firstRoot),
    });
    const second = await runProductGateDeterministicFakeV1({
      ...input,
      outputRoot: boundedOutputRoot(secondRoot),
    });
    expect(second.report).toEqual(first.report);
    expect(second.finalManifest).toEqual(first.finalManifest);
    expect(Buffer.from(second.finalManifestBytes)).toEqual(Buffer.from(first.finalManifestBytes));
    expect(second.replayEvidenceSha256).toBe(first.replayEvidenceSha256);
    for (const entry of first.finalManifest.entries) {
      expect(await readFile(join(second.runDirectory, entry.relativePath))).toEqual(
        await readFile(join(first.runDirectory, entry.relativePath)),
      );
    }
  }, 120_000);

  it('prevents duplicate output/cost finalization and preserves existing finalized evidence', async () => {
    const root = await temporaryRoot('duplicate');
    const input = {
      verifiedCorpus,
      outputRoot: boundedOutputRoot(root),
      deterministicSeed: seed,
      failureInjection: null,
    };
    const first = await runProductGateDeterministicFakeV1(input);
    const originalManifest = await readFile(join(first.runDirectory, 'manifest.json'));
    await expect(runProductGateDeterministicFakeV1(input)).rejects.toThrow(/already exists/u);
    expect(await readFile(join(first.runDirectory, 'manifest.json'))).toEqual(originalManifest);
  }, 120_000);

  it('cleans an aborted partial run without publishing a final manifest', async () => {
    const root = await temporaryRoot('abort');
    await expect(
      runProductGateDeterministicFakeV1({
        verifiedCorpus,
        outputRoot: boundedOutputRoot(root),
        deterministicSeed: seed,
        failureInjection: {
          caseId: 'banner-person-v1',
          stage: 'background',
          disposition: 'abort-and-clean-partial',
        },
      }),
    ).rejects.toThrow(/Injected abort/u);
    const runsRoot = join(root, 'runs');
    const entries = await readdir(runsRoot);
    expect(entries).toEqual([]);
    await expect(lstat(join(runsRoot, 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  }, 120_000);

  it('rejects the blocked holdout before reserving any run output', async () => {
    const root = await temporaryRoot('blocked');
    expect(() =>
      rejectProductGateBlockedHoldoutFakeExecutionV1({
        manifest: PRODUCT_GATE_BLOCKED_HOLDOUT_V1,
      }),
    ).toThrow(/not admitted/u);
    await expect(lstat(join(root, 'runs'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(() =>
      rejectProductGateBlockedHoldoutFakeExecutionV1({
        manifest: PRODUCT_GATE_BLOCKED_HOLDOUT_V1,
        outputRoot: root,
      }),
    ).toThrow();
  });

  it('rejects forged verified-corpus projections and arbitrary broad output roots before writes', async () => {
    const root = await temporaryRoot('tamper');
    const firstEntry = verifiedCorpus.entries[0]!;
    const unknownKeyProjections = [
      { ...verifiedCorpus, unexpected: true },
      {
        ...verifiedCorpus,
        entries: [{ ...firstEntry, unexpected: true }, ...verifiedCorpus.entries.slice(1)],
      },
      {
        ...verifiedCorpus,
        entries: [
          { ...firstEntry, original: { ...firstEntry.original, unexpected: true } },
          ...verifiedCorpus.entries.slice(1),
        ],
      },
      {
        ...verifiedCorpus,
        entries: [
          { ...firstEntry, normalized: { ...firstEntry.normalized, unexpected: true } },
          ...verifiedCorpus.entries.slice(1),
        ],
      },
      {
        ...verifiedCorpus,
        entries: [
          { ...firstEntry, oracle: { ...firstEntry.oracle, unexpected: true } },
          ...verifiedCorpus.entries.slice(1),
        ],
      },
    ];
    for (const forged of unknownKeyProjections) {
      await expect(
        runProductGateDeterministicFakeV1({
          verifiedCorpus: forged,
          outputRoot: boundedOutputRoot(root),
          deterministicSeed: seed,
          failureInjection: null,
        }),
      ).rejects.toThrow();
      await expect(lstat(join(root, 'runs'))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    const tampered = {
      ...verifiedCorpus,
      entries: verifiedCorpus.entries.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              oracle: {
                ...entry.oracle,
                requiredLayers: entry.oracle.requiredLayers.map((layer, layerIndex) =>
                  layerIndex === 0 ? { ...layer, approvedLabel: 'Tampered label' } : layer,
                ),
              },
            }
          : entry,
      ),
    };
    await expect(
      runProductGateDeterministicFakeV1({
        verifiedCorpus: tampered,
        outputRoot: boundedOutputRoot(root),
        deterministicSeed: seed,
        failureInjection: null,
      }),
    ).rejects.toThrow(/source or oracle identity drifted/u);
    await expect(lstat(join(root, 'runs'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(
      runProductGateDeterministicFakeV1({
        verifiedCorpus,
        outputRoot: boundedOutputRoot(tmpdir()),
        deterministicSeed: seed,
        failureInjection: null,
      }),
    ).rejects.toThrow(/closed temporary-root contract|private 0700/u);
  });
});
