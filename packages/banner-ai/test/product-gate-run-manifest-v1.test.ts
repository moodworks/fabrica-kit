import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PRODUCT_GATE_DEVELOPMENT_CORPUS_V1 } from '../src/evaluation/product-gate-corpus-v1.js';
import {
  PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1,
  PRODUCT_GATE_PROTECTED_IDENTITIES_V1,
  ProductGateArtifactInventoryEntryV1Schema,
  ProductGateAttemptChainV1Schema,
  ProductGateAttemptRecordV1Schema,
  ProductGateFinalManifestV1Schema,
  ProductGateRunRecordV1Schema,
  canonicalProductGateJsonBytesV1,
  cleanupPartialProductGateRunV1,
  createProductGateAttemptCostV1,
  createProductGateAttemptIdV1,
  createProductGateAttemptRecordV1,
  createProductGateAdjudicationIdV1,
  createProductGateLogicalOperationIdV1,
  createProductGateReviewRecordIdV1,
  createProductGateRunDirectoryV1,
  createProductGateRunIdV1,
  createProductGateSafeFailureV1,
  productGateRunDirectoryV1,
  publishProductGateFinalManifestV1,
  writeProductGateEvidenceFileV1,
  type ProductGateArtifactInventoryEntryV1,
  type ProductGateDeterministicFakeReportV1,
} from '../src/evaluation/product-gate-run-manifest-v1.js';
import { canonicalizeJson, sha256Hex } from '../src/scene/canonical-scene-json.js';
import { runProductGateDeterministicFakeV1 } from '../src/server/product-gate-deterministic-fake-runner-v1.js';
import {
  loadVerifiedProductGateDevelopmentCorpusV1,
  type VerifiedProductGateDevelopmentCorpusV1,
} from '../src/server/product-gate-development-corpus-loader-v1.js';

const temporaryRoots = new Set<string>();
const sha = (digit: string): string => digit.repeat(64);
const recordedProviderProvenance = {
  kind: 'recorded-provider-projection' as const,
  provider: { key: 'future-provider', identitySha256: sha('a') },
  model: { key: 'future-model', identitySha256: sha('b') },
  checkpoint: { status: 'recorded' as const, identitySha256: sha('c') },
  image: { status: 'recorded' as const, identitySha256: sha('d') },
  external: true as const,
};
const templateSeed = sha('c');
let templateRoot: string;
let verifiedCorpus: VerifiedProductGateDevelopmentCorpusV1;
let templateResult: Awaited<ReturnType<typeof runProductGateDeterministicFakeV1>>;

beforeAll(async () => {
  verifiedCorpus = await loadVerifiedProductGateDevelopmentCorpusV1({
    manifest: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
    sourceRoot: { kind: 'committed-package-root' },
  });
  templateRoot = await mkdtemp(join(tmpdir(), 'fabrica-product-gate-manifest-template-'));
  templateResult = await runProductGateDeterministicFakeV1({
    verifiedCorpus,
    outputRoot: { kind: 'bounded-test-root', absolutePath: templateRoot },
    deterministicSeed: templateSeed,
    failureInjection: null,
  });
});

afterEach(async () => {
  await Promise.all([...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots.clear();
});

afterAll(async () => {
  await rm(templateRoot, { recursive: true, force: true });
});

const temporaryRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), 'fabrica-product-gate-artifacts-'));
  temporaryRoots.add(root);
  return root;
};

const runIdentityInput = () =>
  ({
    recordVersion: 1,
    runnerIdentity: 'provider-free-deterministic-fake-runner-v1',
    sanitizedInputSha256: sha('1'),
    corpusManifestSha256: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.manifestSha256,
    corpusVersion: 1,
    corpusSplit: 'development',
    deterministicSeed: sha('3'),
    protectedIdentities: PRODUCT_GATE_PROTECTED_IDENTITIES_V1,
    provenance: PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1,
    providerTransmissionAuthority: false,
    realEvaluationAuthority: false,
    productGateEvidence: false,
  }) as const;

const stableRunId = () => createProductGateRunIdV1(runIdentityInput());

const validRunRecord = (runId = stableRunId()) =>
  ProductGateRunRecordV1Schema.parse({ runId, ...runIdentityInput() });

const reportRecord = (runId: ReturnType<typeof stableRunId>, cases: readonly unknown[]) => ({
  reportVersion: 1 as const,
  runId,
  runnerIdentity: 'provider-free-deterministic-fake-runner-v1' as const,
  corpusSplit: 'development' as const,
  corpusManifestSha256: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.manifestSha256,
  cases,
  productGateMetric: {
    metricVersion: 1 as const,
    metricId: 'product-gate-e2e' as const,
    evidenceScope: 'authority-bound' as const,
    stage: null,
    decision: 'not-measurable' as const,
    numerator: null,
    denominator: null,
    observations: [] as const,
    threshold: 'at-least-14-of-18-with-all-seven-requirements' as const,
    reason: 'development-corpus-not-product-gate-evidence' as const,
  },
  productGateOutcome: 'not-measurable' as const,
  holdoutAdmitted: false as const,
  authoritativeGdnEvidenceAvailable: false as const,
  providerTransmissionAuthority: false as const,
  realEvaluationAuthority: false as const,
  networkOperations: 0 as const,
  providerModelCalls: 0 as const,
  samRunpodGpuCalls: 0 as const,
  credentialAccesses: 0 as const,
  paidOperations: 0 as const,
});

const partialReportRecord = (runId = stableRunId()) =>
  reportRecord(runId, [
    { caseId: 'one' },
    { caseId: 'two' },
    { caseId: 'three' },
    { caseId: 'four' },
  ]);

const writeCompleteRunEvidence = async (input: {
  readonly runDirectory: string;
  readonly runRecord?: unknown;
  readonly transformReport?: (report: ProductGateDeterministicFakeReportV1) => unknown;
}) => {
  const entries = [];
  const finalReport = input.transformReport?.(templateResult.report) ?? templateResult.report;
  for (const templateEntry of templateResult.finalManifest.entries) {
    let bytes = await readFile(join(templateResult.runDirectory, templateEntry.relativePath));
    if (templateEntry.relativePath === 'run.json' && input.runRecord !== undefined) {
      bytes = Buffer.from(canonicalProductGateJsonBytesV1(input.runRecord));
    } else if (templateEntry.relativePath === 'report.json') {
      bytes = Buffer.from(canonicalProductGateJsonBytesV1(finalReport));
    }
    entries.push(
      await writeProductGateEvidenceFileV1({
        runDirectory: input.runDirectory,
        relativePath: templateEntry.relativePath,
        kind: templateEntry.kind,
        mediaType: templateEntry.mediaType,
        bytes,
      }),
    );
  }
  const runEntry = entries.find((entry) => entry.relativePath === 'run.json');
  const reportEntry = entries.find((entry) => entry.relativePath === 'report.json');
  if (runEntry === undefined || reportEntry === undefined) {
    throw new TypeError('Deterministic fake template omitted required core evidence.');
  }
  return {
    entries,
    runEntry,
    reportEntry,
    report: finalReport,
  };
};

const inventoryEntryForTamperedBytes = (
  entry: ProductGateArtifactInventoryEntryV1,
  bytes: Uint8Array,
) => {
  const core = {
    relativePath: entry.relativePath,
    kind: entry.kind,
    mediaType: entry.mediaType,
    byteSize: bytes.byteLength,
    sha256: sha256Hex(bytes),
  };
  return ProductGateArtifactInventoryEntryV1Schema.parse({
    artifactId: `pge_artifact_v1_${sha256Hex(Buffer.from(canonicalizeJson(core), 'utf8'))}`,
    ...core,
  });
};

const successfulAttempt = (input?: {
  readonly parentAttemptId?: ReturnType<typeof createProductGateAttemptIdV1>;
  readonly logicalOperationId?: ReturnType<typeof createProductGateLogicalOperationIdV1>;
}) => {
  const runId = stableRunId();
  const logicalOperationId =
    input?.logicalOperationId ??
    createProductGateLogicalOperationIdV1({
      runId,
      caseId: 'banner-person-v1',
      stage: 'vision',
      operationVersion: 1,
    });
  const parentAttemptId = input?.parentAttemptId ?? null;
  const attemptOrdinal = parentAttemptId === null ? 1 : 2;
  return createProductGateAttemptRecordV1({
    recordVersion: 1,
    runId,
    caseId: 'banner-person-v1',
    attemptOrdinal,
    stage: 'vision',
    logicalOperationId,
    parentAttemptId,
    retry: parentAttemptId === null ? null : { parentAttemptId, logicalOperationId },
    status: 'succeeded',
    runtimeMs: 100,
    sanitizedRequestSha256: sha('4'),
    corpusManifestSha256: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.manifestSha256,
    corpusVersion: 1,
    corpusSplit: 'development',
    protectedIdentities: PRODUCT_GATE_PROTECTED_IDENTITIES_V1,
    cost: createProductGateAttemptCostV1({
      usageStatus: 'succeeded',
      actualCostMicros: '7',
      estimatedCostMicros: '9',
      reservedCostMicros: '10',
    }),
    provenance: PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1,
    structuredResultSha256: sha('3'),
    artifacts: [],
    reviewRecordIds: [],
    adjudicationId: null,
    correctionClassification: 'none',
    failure: null,
    outputFinalized: true,
  });
};

const retryableFailedAttempt = () => {
  const successful = successfulAttempt();
  const { attemptId, ...core } = successful;
  void attemptId;
  return createProductGateAttemptRecordV1({
    ...core,
    status: 'failed',
    cost: createProductGateAttemptCostV1({
      usageStatus: 'failed',
      actualCostMicros: null,
      estimatedCostMicros: '9',
      reservedCostMicros: '10',
    }),
    structuredResultSha256: null,
    failure: createProductGateSafeFailureV1({
      stage: 'vision',
      code: 'injected-stage-failure',
      retryable: true,
    }),
    outputFinalized: false,
  });
};

const terminalNonSuccessfulAttempt = (status: 'failed' | 'indeterminate', retryable = false) => {
  const successful = successfulAttempt();
  const { attemptId, ...core } = successful;
  void attemptId;
  return createProductGateAttemptRecordV1({
    ...core,
    status,
    cost: createProductGateAttemptCostV1({
      usageStatus: status,
      actualCostMicros: null,
      estimatedCostMicros: null,
      reservedCostMicros: '10',
    }),
    structuredResultSha256: null,
    failure: createProductGateSafeFailureV1({
      stage: 'vision',
      code: status === 'failed' ? 'injected-stage-failure' : 'indeterminate-attempt',
      retryable,
    }),
    outputFinalized: false,
  });
};

describe('run, retry, cost, and provenance records', () => {
  it('uses stable content-derived run, operation, attempt, and safe-error identities', () => {
    expect(stableRunId()).toBe(stableRunId());
    expect(stableRunId()).not.toBe(createProductGateRunIdV1({ seed: sha('2'), corpus: sha('2') }));
    const attempt = successfulAttempt();
    expect(attempt.attemptId).toBe(
      createProductGateAttemptIdV1({
        recordVersion: 1,
        runId: attempt.runId,
        caseId: attempt.caseId,
        attemptOrdinal: attempt.attemptOrdinal,
        stage: attempt.stage,
        logicalOperationId: attempt.logicalOperationId,
        parentAttemptId: null,
        retry: null,
      }),
    );
    expect(
      createProductGateSafeFailureV1({
        stage: 'vision',
        code: 'injected-stage-failure',
        retryable: true,
      }),
    ).toMatchObject({ providerBodyRecorded: false, credentialsRecorded: false });
    expect(
      ProductGateAttemptRecordV1Schema.safeParse({ ...attempt, providerPayload: {} }).success,
    ).toBe(false);
    const providerBoundRunInput = {
      ...runIdentityInput(),
      provenance: recordedProviderProvenance,
    };
    expect(
      ProductGateRunRecordV1Schema.safeParse({
        runId: createProductGateRunIdV1(providerBoundRunInput),
        ...providerBoundRunInput,
      }).success,
    ).toBe(false);
  });

  it('binds retries to the exact parent attempt and logical operation', () => {
    const initial = retryableFailedAttempt();
    const retry = successfulAttempt({
      parentAttemptId: initial.attemptId,
      logicalOperationId: initial.logicalOperationId,
    });
    expect(retry.retry).toEqual({
      parentAttemptId: initial.attemptId,
      logicalOperationId: initial.logicalOperationId,
    });
    expect(
      ProductGateAttemptRecordV1Schema.safeParse({
        ...retry,
        retry: {
          ...retry.retry!,
          logicalOperationId: createProductGateLogicalOperationIdV1({ wrong: true }),
        },
      }).success,
    ).toBe(false);
    expect(
      ProductGateAttemptRecordV1Schema.safeParse({
        ...retry,
        parentAttemptId: null,
      }).success,
    ).toBe(false);
    expect(ProductGateAttemptChainV1Schema.parse([initial, retry])).toHaveLength(2);
    expect(ProductGateAttemptChainV1Schema.safeParse([retry, initial]).success).toBe(false);
    expect(ProductGateAttemptChainV1Schema.safeParse([successfulAttempt(), retry]).success).toBe(
      false,
    );
    expect(
      ProductGateAttemptChainV1Schema.parse([terminalNonSuccessfulAttempt('failed')]),
    ).toHaveLength(1);
    expect(
      ProductGateAttemptChainV1Schema.parse([terminalNonSuccessfulAttempt('indeterminate')]),
    ).toHaveLength(1);
    const indeterminate = terminalNonSuccessfulAttempt('indeterminate', true);
    const recoveredIndeterminate = successfulAttempt({
      parentAttemptId: indeterminate.attemptId,
      logicalOperationId: indeterminate.logicalOperationId,
    });
    expect(
      ProductGateAttemptChainV1Schema.parse([indeterminate, recoveredIndeterminate]),
    ).toHaveLength(2);
    const crossStageBase = successfulAttempt();
    const { attemptId: ignoredCrossStageId, ...crossStageCore } = crossStageBase;
    void ignoredCrossStageId;
    const incompatibleStageCore = {
      ...crossStageCore,
      stage: 'background',
      logicalOperationId: initial.logicalOperationId,
    } as const;
    const incompatibleStageReuse = {
      attemptId: createProductGateAttemptIdV1({
        recordVersion: incompatibleStageCore.recordVersion,
        runId: incompatibleStageCore.runId,
        caseId: incompatibleStageCore.caseId,
        attemptOrdinal: incompatibleStageCore.attemptOrdinal,
        stage: incompatibleStageCore.stage,
        logicalOperationId: incompatibleStageCore.logicalOperationId,
        parentAttemptId: incompatibleStageCore.parentAttemptId,
        retry: incompatibleStageCore.retry,
      }),
      ...incompatibleStageCore,
    };
    expect(
      ProductGateAttemptChainV1Schema.safeParse([initial, incompatibleStageReuse]).success,
    ).toBe(false);
  });

  it('binds terminal attempt status to the exact usage status', () => {
    const bases = {
      succeeded: successfulAttempt(),
      failed: terminalNonSuccessfulAttempt('failed'),
      indeterminate: terminalNonSuccessfulAttempt('indeterminate'),
    } as const;
    for (const [status, attempt] of Object.entries(bases)) {
      expect(attempt.cost.usageStatus).toBe(status);
      if (status !== 'succeeded') {
        expect(
          ProductGateAttemptRecordV1Schema.safeParse({
            ...attempt,
            structuredResultSha256: sha('f'),
          }).success,
        ).toBe(false);
      }
      for (const usageStatus of ['started', 'succeeded', 'failed', 'indeterminate'] as const) {
        const candidate = {
          ...attempt,
          cost: createProductGateAttemptCostV1({
            usageStatus,
            actualCostMicros: null,
            estimatedCostMicros: null,
            reservedCostMicros: '10',
          }),
        };
        expect(ProductGateAttemptRecordV1Schema.safeParse(candidate).success).toBe(
          usageStatus === status,
        );
      }
    }
  });

  it('conservatively prefers actual, then estimate, then full reservation for every status', () => {
    expect(
      createProductGateAttemptCostV1({
        usageStatus: 'failed',
        actualCostMicros: '7',
        estimatedCostMicros: '8',
        reservedCostMicros: '9',
      }),
    ).toMatchObject({ accountingBasis: 'actual', accountedCostMicros: '7' });
    expect(
      createProductGateAttemptCostV1({
        usageStatus: 'indeterminate',
        actualCostMicros: null,
        estimatedCostMicros: '8',
        reservedCostMicros: '9',
      }),
    ).toMatchObject({ accountingBasis: 'estimate', accountedCostMicros: '8' });
    expect(
      createProductGateAttemptCostV1({
        usageStatus: 'failed',
        actualCostMicros: null,
        estimatedCostMicros: null,
        reservedCostMicros: '9',
      }),
    ).toMatchObject({ accountingBasis: 'reservation', accountedCostMicros: '9' });
  });
});

describe('private artifact inventory and manifest-last publication', () => {
  it('writes 0700 directories, 0600 files, sorted canonical inventory, and the manifest last', async () => {
    const partialRunId = stableRunId();
    const partialRoot = await temporaryRoot();
    const partialDirectory = await createProductGateRunDirectoryV1({
      rootDirectory: partialRoot,
      runId: partialRunId,
    });
    const partialReportEntry = await writeProductGateEvidenceFileV1({
      runDirectory: partialDirectory,
      relativePath: 'report.json',
      kind: 'report',
      mediaType: 'application/json',
      bytes: canonicalProductGateJsonBytesV1(partialReportRecord(partialRunId)),
    });
    const partialRunEntry = await writeProductGateEvidenceFileV1({
      runDirectory: partialDirectory,
      relativePath: 'run.json',
      kind: 'run-record',
      mediaType: 'application/json',
      bytes: canonicalProductGateJsonBytesV1(validRunRecord(partialRunId)),
    });
    await expect(
      publishProductGateFinalManifestV1({
        runDirectory: partialDirectory,
        runId: partialRunId,
        entries: [partialRunEntry, partialReportEntry],
      }),
    ).rejects.toThrow();
    await expect(lstat(join(partialDirectory, 'manifest.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });

    const root = await temporaryRoot();
    const runId = templateResult.report.runId;
    const runDirectory = await createProductGateRunDirectoryV1({ rootDirectory: root, runId });
    expect((await stat(runDirectory)).mode & 0o777).toBe(0o700);
    const complete = await writeCompleteRunEvidence({ runDirectory });
    await expect(lstat(join(runDirectory, 'manifest.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    expect((await stat(join(runDirectory, 'run.json'))).mode & 0o777).toBe(0o600);
    await expect(
      publishProductGateFinalManifestV1({
        runDirectory,
        runId,
        entries: [complete.runEntry],
      }),
    ).rejects.toThrow(/complete exact/u);

    const published = await publishProductGateFinalManifestV1({
      runDirectory,
      runId,
      entries: complete.entries,
    });
    expect(published.manifest.entries.map((entry) => entry.relativePath)).toContain('run.json');
    expect(published.manifest.entries.map((entry) => entry.relativePath)).toContain('report.json');
    expect(ProductGateFinalManifestV1Schema.parse(published.manifest).publishedLast).toBe(true);
    expect(
      ProductGateFinalManifestV1Schema.safeParse({
        ...published.manifest,
        entries: published.manifest.entries.filter((entry) => entry.relativePath !== 'run.json'),
      }).success,
    ).toBe(false);
    expect(
      ProductGateFinalManifestV1Schema.safeParse({
        ...published.manifest,
        entries: published.manifest.entries.filter((entry) => entry.relativePath !== 'report.json'),
      }).success,
    ).toBe(false);
    expect((await stat(join(runDirectory, 'manifest.json'))).mode & 0o777).toBe(0o600);
    expect(await readFile(join(runDirectory, 'manifest.json'))).toEqual(
      Buffer.from(published.bytes),
    );
    await expect(
      publishProductGateFinalManifestV1({
        runDirectory,
        runId,
        entries: complete.entries,
      }),
    ).rejects.toThrow();
    const attempt = successfulAttempt();
    await expect(
      writeProductGateEvidenceFileV1({
        runDirectory,
        relativePath: `cases/banner-person-v1/attempts/${attempt.attemptId}/sanitized-request.json`,
        kind: 'sanitized-request',
        mediaType: 'application/json',
        bytes: canonicalProductGateJsonBytesV1({ late: true }),
      }),
    ).rejects.toThrow(/Finalized/u);
  });

  it('binds canonical run and report records to the final manifest run identity', async () => {
    const runId = templateResult.report.runId;
    const exactRunRecord = JSON.parse(
      await readFile(join(templateResult.runDirectory, 'run.json'), 'utf8'),
    ) as Record<string, unknown>;
    const otherIdentityInput = { ...runIdentityInput(), deterministicSeed: sha('a') };
    const otherRunId = createProductGateRunIdV1(otherIdentityInput);
    const otherRunRecord = ProductGateRunRecordV1Schema.parse({
      runId: otherRunId,
      ...otherIdentityInput,
    });
    const scenarios = [
      {
        runRecord: otherRunRecord,
      },
      {
        transformReport: (report: ProductGateDeterministicFakeReportV1) => ({
          ...report,
          runId: otherRunId,
        }),
      },
      {
        transformReport: (report: ProductGateDeterministicFakeReportV1) => ({
          ...report,
          corpusManifestSha256: sha('b'),
        }),
      },
      {
        transformReport: (report: ProductGateDeterministicFakeReportV1) => ({
          ...report,
          cases: report.cases.map((caseEvidence) => ({
            ...caseEvidence,
            attempts: caseEvidence.attempts.map((attempt) => ({
              ...attempt,
              corpusManifestSha256: sha('b'),
            })),
          })),
        }),
      },
      {
        transformReport: (report: ProductGateDeterministicFakeReportV1) => ({
          ...report,
          cases: report.cases.map((caseEvidence, index) =>
            index === 0
              ? {
                  ...caseEvidence,
                  visionScorecard: { scorecardVersion: 1 },
                }
              : caseEvidence,
          ),
        }),
      },
      {
        transformReport: (report: ProductGateDeterministicFakeReportV1) => ({
          ...report,
          cases: report.cases.map((caseEvidence, index) =>
            index === 0
              ? {
                  ...caseEvidence,
                  backgroundScorecard: {
                    ...caseEvidence.backgroundScorecard,
                    strategy: 'deterministic-solid-fallback',
                    oracleAuthorizationProjectionPresent: true,
                    reconstructionDimensions: {
                      kind: 'not-applicable',
                      reason: 'oracle-authorized-deterministic-solid-fallback',
                      permissionSha256: sha('e'),
                    },
                  },
                }
              : caseEvidence,
          ),
        }),
      },
      {
        transformReport: (report: ProductGateDeterministicFakeReportV1) => ({
          ...report,
          cases: report.cases.map((caseEvidence, index) =>
            index === 0
              ? {
                  ...caseEvidence,
                  attempts: caseEvidence.attempts.map((attempt, attemptIndex) =>
                    attemptIndex === 0
                      ? { ...attempt, provenance: recordedProviderProvenance }
                      : attempt,
                  ),
                }
              : caseEvidence,
          ),
        }),
      },
      {
        transformReport: (report: ProductGateDeterministicFakeReportV1) => ({
          ...report,
          cases: report.cases.map((caseEvidence, index) =>
            index === 0
              ? {
                  ...caseEvidence,
                  attempts: caseEvidence.attempts.map((attempt, attemptIndex) =>
                    attemptIndex === 0
                      ? {
                          ...attempt,
                          reviewRecordIds: [
                            createProductGateReviewRecordIdV1({ foreignReview: true }),
                          ],
                        }
                      : attempt,
                  ),
                }
              : caseEvidence,
          ),
        }),
      },
      {
        transformReport: (report: ProductGateDeterministicFakeReportV1) => ({
          ...report,
          cases: report.cases.map((caseEvidence, index) =>
            index === 0
              ? {
                  ...caseEvidence,
                  attempts: caseEvidence.attempts.map((attempt, attemptIndex) =>
                    attemptIndex === 0
                      ? {
                          ...attempt,
                          reviewRecordIds: caseEvidence.rawReviews.map(
                            (review) => review.reviewRecordId,
                          ),
                          adjudicationId: createProductGateAdjudicationIdV1({
                            foreignAdjudication: true,
                          }),
                        }
                      : attempt,
                  ),
                }
              : caseEvidence,
          ),
        }),
      },
      {
        runRecord: { ...exactRunRecord, unexpected: true },
      },
      {
        transformReport: (report: ProductGateDeterministicFakeReportV1) =>
          Object.fromEntries(Object.entries(report).filter(([key]) => key !== 'runId')),
      },
    ];
    for (const scenario of scenarios) {
      const root = await temporaryRoot();
      const runDirectory = await createProductGateRunDirectoryV1({ rootDirectory: root, runId });
      const complete = await writeCompleteRunEvidence({ runDirectory, ...scenario });
      await expect(
        publishProductGateFinalManifestV1({
          runDirectory,
          runId,
          entries: complete.entries,
        }),
      ).rejects.toThrow();
      await expect(lstat(join(runDirectory, 'manifest.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }
  }, 60_000);

  it('serializes artifact mutation against finalization and concurrent publishers', async () => {
    const runId = templateResult.report.runId;
    const root = await temporaryRoot();
    const runDirectory = await createProductGateRunDirectoryV1({ rootDirectory: root, runId });
    const complete = await writeCompleteRunEvidence({ runDirectory });
    const templateAttempt = templateResult.report.cases[0]!.attempts[0]!;
    const lateAttemptId = createProductGateAttemptIdV1({
      recordVersion: 1,
      runId,
      caseId: templateAttempt.caseId,
      attemptOrdinal: 2,
      stage: templateAttempt.stage,
      logicalOperationId: templateAttempt.logicalOperationId,
      parentAttemptId: templateAttempt.attemptId,
      retry: {
        parentAttemptId: templateAttempt.attemptId,
        logicalOperationId: templateAttempt.logicalOperationId,
      },
    });
    const latePath = `cases/${templateAttempt.caseId}/attempts/${lateAttemptId}/sanitized-request.json`;
    const [lateWrite, publication] = await Promise.allSettled([
      writeProductGateEvidenceFileV1({
        runDirectory,
        relativePath: latePath,
        kind: 'sanitized-request',
        mediaType: 'application/json',
        bytes: canonicalProductGateJsonBytesV1({ late: true }),
      }),
      publishProductGateFinalManifestV1({
        runDirectory,
        runId,
        entries: complete.entries,
      }),
    ]);
    expect([lateWrite, publication].filter((result) => result.status === 'fulfilled')).toHaveLength(
      1,
    );
    if (publication.status === 'fulfilled') {
      expect(lateWrite.status).toBe('rejected');
      await expect(lstat(join(runDirectory, latePath))).rejects.toMatchObject({ code: 'ENOENT' });
    } else {
      expect(lateWrite.status).toBe('fulfilled');
      if (lateWrite.status !== 'fulfilled') {
        throw new TypeError('Concurrent artifact mutation had no successful writer.');
      }
      await expect(lstat(join(runDirectory, 'manifest.json'))).rejects.toMatchObject({
        code: 'ENOENT',
      });
    }
    expect(
      (await readdir(join(root, 'runs'))).filter((name) => name.includes('mutation-lock')),
    ).toEqual([]);

    const secondRoot = await temporaryRoot();
    const secondRunDirectory = await createProductGateRunDirectoryV1({
      rootDirectory: secondRoot,
      runId,
    });
    const secondComplete = await writeCompleteRunEvidence({
      runDirectory: secondRunDirectory,
    });
    const concurrentPublications = await Promise.allSettled([
      publishProductGateFinalManifestV1({
        runDirectory: secondRunDirectory,
        runId,
        entries: secondComplete.entries,
      }),
      publishProductGateFinalManifestV1({
        runDirectory: secondRunDirectory,
        runId,
        entries: secondComplete.entries,
      }),
    ]);
    expect(concurrentPublications.filter((result) => result.status === 'fulfilled')).toHaveLength(
      1,
    );
    expect(concurrentPublications.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const winner = concurrentPublications.find((result) => result.status === 'fulfilled');
    if (winner?.status !== 'fulfilled')
      throw new TypeError('Concurrent publication had no winner.');
    expect(await readFile(join(secondRunDirectory, 'manifest.json'))).toEqual(
      Buffer.from(winner.value.bytes),
    );
    expect(
      (await readdir(join(secondRoot, 'runs'))).filter((name) => name.includes('mutation-lock')),
    ).toEqual([]);
  });

  it('prevents overwrite, traversal, digest forgery, and symlinked artifact parents', async () => {
    const root = await temporaryRoot();
    const runId = stableRunId();
    const runDirectory = await createProductGateRunDirectoryV1({ rootDirectory: root, runId });
    let overlyDeepJson: unknown = 'leaf';
    for (let depth = 0; depth < 34; depth += 1) overlyDeepJson = { nested: overlyDeepJson };
    const oversizedObject = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [`field${String(index)}`, index]),
    );
    for (const sensitiveJson of [
      { authorization: 'Bearer deliberately-forbidden-test-value' },
      { nested: { providerBody: 'raw provider response' } },
      { secret: 'opaque-value' },
      { credentials: 'opaque-value' },
      { token: 'opaque-value' },
      { note: `sk-proj-${'x'.repeat(24)}` },
      { sourcePath: '/Users/private/evidence.json' },
      { message: 'failed at /Users/private/evidence.json' },
      { message: String.raw`failed at \\server\share\private` },
      { rationale: 'x'.repeat(16_385) },
      Array.from({ length: 2_049 }, (_, index) => index),
      oversizedObject,
      overlyDeepJson,
    ]) {
      await expect(
        writeProductGateEvidenceFileV1({
          runDirectory,
          relativePath: 'run.json',
          kind: 'run-record',
          mediaType: 'application/json',
          bytes: canonicalProductGateJsonBytesV1(sensitiveJson),
        }),
      ).rejects.toThrow(/bounded|sanitized|sensitive|forbidden/u);
      await expect(lstat(join(runDirectory, 'run.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    const sensitiveStructuredAttempt = successfulAttempt();
    const sensitiveStructuredPath = `cases/banner-person-v1/attempts/${sensitiveStructuredAttempt.attemptId}/structured-result.json`;
    await expect(
      writeProductGateEvidenceFileV1({
        runDirectory,
        relativePath: sensitiveStructuredPath,
        kind: 'structured-result',
        mediaType: 'application/json',
        bytes: canonicalProductGateJsonBytesV1({
          recordVersion: 1,
          attempt: sensitiveStructuredAttempt,
          result: { secret: 'opaque-value' },
        }),
      }),
    ).rejects.toThrow(/sanitized|forbidden/u);
    await expect(lstat(join(runDirectory, sensitiveStructuredPath))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(
      writeProductGateEvidenceFileV1({
        runDirectory,
        relativePath: 'run.json',
        kind: 'report',
        mediaType: 'application/json',
        bytes: canonicalProductGateJsonBytesV1(validRunRecord(runId)),
      }),
    ).rejects.toThrow(/path, kind, and media type/u);
    await expect(lstat(join(runDirectory, 'run.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    const input = {
      runDirectory,
      relativePath: 'run.json',
      kind: 'run-record',
      mediaType: 'application/json',
      bytes: canonicalProductGateJsonBytesV1({ run: true }),
    } as const;
    const entry = await writeProductGateEvidenceFileV1(input);
    await expect(writeProductGateEvidenceFileV1(input)).rejects.toThrow();
    await expect(
      writeProductGateEvidenceFileV1({ ...input, relativePath: '../escape.json' }),
    ).rejects.toThrow();
    expect(
      ProductGateArtifactInventoryEntryV1Schema.safeParse({ ...entry, sha256: sha('f') }).success,
    ).toBe(false);
    const noncanonicalId = createProductGateRunIdV1({ noncanonical: true });
    const noncanonicalRun = await createProductGateRunDirectoryV1({
      rootDirectory: root,
      runId: noncanonicalId,
    });
    await expect(
      writeProductGateEvidenceFileV1({
        runDirectory: noncanonicalRun,
        relativePath: 'run.json',
        kind: 'run-record',
        mediaType: 'application/json',
        bytes: Buffer.from('{ "run": true }', 'utf8'),
      }),
    ).rejects.toThrow(/canonical/u);

    const symlinkRoot = await temporaryRoot();
    const symlinkRunId = createProductGateRunIdV1({ symlink: true });
    const symlinkRun = await createProductGateRunDirectoryV1({
      rootDirectory: symlinkRoot,
      runId: symlinkRunId,
    });
    const outside = join(symlinkRoot, 'outside');
    await mkdir(outside);
    await symlink(outside, join(symlinkRun, 'cases'));
    const operation = createProductGateLogicalOperationIdV1({ symlink: true });
    const attemptId = createProductGateAttemptIdV1({
      recordVersion: 1,
      runId: symlinkRunId,
      caseId: 'banner-person-v1',
      attemptOrdinal: 1,
      stage: 'intake',
      logicalOperationId: operation,
      parentAttemptId: null,
      retry: null,
    });
    await expect(
      writeProductGateEvidenceFileV1({
        runDirectory: symlinkRun,
        relativePath: `cases/banner-person-v1/attempts/${attemptId}/sanitized-request.json`,
        kind: 'sanitized-request',
        mediaType: 'application/json',
        bytes: canonicalProductGateJsonBytesV1({ safe: true }),
      }),
    ).rejects.toThrow(/symlink|regular directory/u);
  });

  it('rejects a symlinked run-directory root before reading evidence', async () => {
    const root = await temporaryRoot();
    const runId = createProductGateRunIdV1({ symlinkedRunRoot: true });
    const runDirectory = await createProductGateRunDirectoryV1({ rootDirectory: root, runId });
    const entry = await writeProductGateEvidenceFileV1({
      runDirectory,
      relativePath: 'run.json',
      kind: 'run-record',
      mediaType: 'application/json',
      bytes: canonicalProductGateJsonBytesV1({ safe: true }),
    });
    const relocatedRunDirectory = join(root, 'relocated-run-evidence');
    await rename(runDirectory, relocatedRunDirectory);
    await symlink(relocatedRunDirectory, runDirectory);
    await expect(
      publishProductGateFinalManifestV1({ runDirectory, runId, entries: [entry] }),
    ).rejects.toThrow(/non-symlink run directory/u);
  });

  it('rejects sensitive structured evidence again during final inventory reread', async () => {
    const root = await temporaryRoot();
    const runId = templateResult.report.runId;
    const runDirectory = await createProductGateRunDirectoryV1({ rootDirectory: root, runId });
    const complete = await writeCompleteRunEvidence({ runDirectory });
    const structuredEntry = complete.entries.find((entry) => entry.kind === 'structured-result');
    if (structuredEntry === undefined) throw new TypeError('Template structured evidence missing.');
    const sensitiveBytes = canonicalProductGateJsonBytesV1({
      recordVersion: 1,
      result: { secret: 'opaque-value' },
    });
    await writeFile(join(runDirectory, structuredEntry.relativePath), sensitiveBytes);
    const tamperedEntry = inventoryEntryForTamperedBytes(structuredEntry, sensitiveBytes);
    await expect(
      publishProductGateFinalManifestV1({
        runDirectory,
        runId,
        entries: complete.entries.map((entry) =>
          entry.artifactId === structuredEntry.artifactId ? tamperedEntry : entry,
        ),
      }),
    ).rejects.toThrow(/sensitive|forbidden|sanitized/u);
    await expect(lstat(join(runDirectory, 'manifest.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects a non-private run root before reading evidence', async () => {
    const root = await temporaryRoot();
    const runId = createProductGateRunIdV1({ nonPrivateRunRoot: true });
    const runDirectory = await createProductGateRunDirectoryV1({ rootDirectory: root, runId });
    const entry = await writeProductGateEvidenceFileV1({
      runDirectory,
      relativePath: 'run.json',
      kind: 'run-record',
      mediaType: 'application/json',
      bytes: canonicalProductGateJsonBytesV1({ safe: true }),
    });
    await chmod(runDirectory, 0o755);
    await expect(
      publishProductGateFinalManifestV1({ runDirectory, runId, entries: [entry] }),
    ).rejects.toThrow(/private 0700/u);
  });

  it('cleans only partial exact run directories and never finalized evidence', async () => {
    const root = await temporaryRoot();
    const runId = stableRunId();
    const runDirectory = await createProductGateRunDirectoryV1({ rootDirectory: root, runId });
    await writeProductGateEvidenceFileV1({
      runDirectory,
      relativePath: 'run.json',
      kind: 'run-record',
      mediaType: 'application/json',
      bytes: canonicalProductGateJsonBytesV1({ partial: true }),
    });
    await cleanupPartialProductGateRunV1({ rootDirectory: root, runId });
    await expect(lstat(runDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readdir(join(root, 'runs'))).toEqual([]);

    const finalizedId = templateResult.report.runId;
    const finalizedDirectory = await createProductGateRunDirectoryV1({
      rootDirectory: root,
      runId: finalizedId,
    });
    const complete = await writeCompleteRunEvidence({ runDirectory: finalizedDirectory });
    await publishProductGateFinalManifestV1({
      runDirectory: finalizedDirectory,
      runId: finalizedId,
      entries: complete.entries,
    });
    await expect(
      cleanupPartialProductGateRunV1({ rootDirectory: root, runId: finalizedId }),
    ).rejects.toThrow(/Finalized/u);
    expect(productGateRunDirectoryV1(root, finalizedId)).toBe(finalizedDirectory);
  });

  it('rejects cleanup through a symlinked runs parent without touching the outside target', async () => {
    const root = await temporaryRoot();
    const outsideRoot = await temporaryRoot();
    const outsideRuns = join(outsideRoot, 'redirected-runs');
    await mkdir(outsideRuns, { mode: 0o700 });
    const runId = createProductGateRunIdV1({ cleanupSymlink: true });
    const outsideRun = join(outsideRuns, runId);
    await mkdir(outsideRun, { mode: 0o700 });
    await symlink(outsideRuns, join(root, 'runs'));
    await expect(cleanupPartialProductGateRunV1({ rootDirectory: root, runId })).rejects.toThrow(
      /symlink/u,
    );
    expect((await lstat(outsideRun)).isDirectory()).toBe(true);
  });
});
