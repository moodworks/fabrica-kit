import { z } from 'zod';

import {
  QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT,
  QWEN3_VL_OFFICIAL_EVIDENCE_RETRIEVED_DATE,
  QWEN3_VL_PRICING_EVIDENCE_SHA256,
  QWEN3_VL_PROVIDER_KEY,
  QWEN3_VL_REQUESTED_MODEL_ID,
  QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_SHA256,
  QWEN3_VL_REQUEST_SHAPE_V1_SHA256,
  QWEN3_VL_REQUEST_SHAPE_V2_SHA256,
  QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256,
  QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1,
  QWEN_FOUR_FIXTURE_HUMAN_ORACLE_CORPUS_SHA256,
  QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256,
  QwenCalculatedListCostV1Schema,
  QwenProviderUsageV1Schema,
  calculateQwen3VlListCostMicros,
} from '../evaluation/qwen3-vl-candidate-evidence.js';
import {
  QwenBenchmarkFixtureIdSchema,
  evaluateQwenFourFixtureQualityV1,
  getQwenFourFixtureEvaluationBindingsV1,
} from '../evaluation/qwen-four-fixture-quality.js';
import {
  PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256,
  REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2,
} from '../evaluation/real-model-benchmark-pending-corpus-v2.js';
import { CanonicalMicrosStringSchema, formatMicros, parseMicros } from '../jobs/cost-budget.js';
import { EpochMillisecondsSchema } from '../jobs/timing.js';
import type { CancellationSignalPort } from '../ports/banner-capability-ports.js';
import { assertCanonicalNormalizedPng } from '../security/raster-container.js';
import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import { loadVerifiedPendingRealModelBenchmarkCorpusV2 } from './real-model-benchmark-pending-corpus-loader-v2.js';
import {
  REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V2,
  readPendingCorpusPackageFileV2,
} from './real-model-benchmark-pending-corpus-source-registry-v2.js';
import {
  QWEN_FOUR_FIXTURE_CANONICAL_REQUEST_CATALOG_V1,
  QWEN_FOUR_FIXTURE_ACTIVE_MODEL_INPUT_DIGESTS_SHA256,
  QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_SHA256,
  createCanonicalQwenBenchmarkRequestV1,
} from './qwen-four-fixture-request-catalog.js';
import {
  QwenSceneAnalysisError,
  createQwen3VlSceneAnalysisAdapter,
  type QwenAdapterClockPort,
  type QwenAttemptAccounting,
  type QwenBenchmarkExecutionAuthorization,
  type QwenTransportPort,
  type QwenTransportRequest,
} from './qwen3-vl-scene-analysis-adapter.js';
import { QwenValidationDiagnosticV1Schema } from './qwen3-vl-response-boundary.js';
import {
  QwenDiagnosticArtifactMetadataV1Schema,
  QwenDiagnosticReportRelativePathV1Schema,
  replaySanitizedQwenResponseV1,
} from './qwen3-vl-response-diagnostics.js';

export const QWEN_FOUR_FIXTURE_REPORT_PATH =
  '.local-data/banner-ai/qwen3-vl-four-fixture-benchmark.json' as const;

export const QwenBenchmarkClassifiedFailureReasonSchema = z.enum([
  'authorization-missing',
  'authorization-stale',
  'benchmark-cap-exceeded',
  'call-time-limit-exceeded',
  'cancellation',
  'duplicate-invocation',
  'fixture-time-limit-exceeded',
  'http-error',
  'identity-mismatch',
  'layer-quality-failed',
  'malformed-json',
  'missing-usage',
  'none',
  'ocr-quality-failed',
  'provider-error',
  'schema-invalid',
  'timeout',
  'total-time-limit-exceeded',
  'transport-failure',
  'unexpected-finish',
  'unexpected-model',
]);

export type QwenBenchmarkClassifiedFailureReason = z.infer<
  typeof QwenBenchmarkClassifiedFailureReasonSchema
>;

const QwenFixtureQualitySummaryV1Schema = z
  .strictObject({
    evaluationVersion: z.literal(1),
    layerQuality: z
      .strictObject({
        evaluationVersion: z.literal(1),
        matchingRule: z.literal('same-semantic-role-and-bounding-box-iou-at-least-5000-bps'),
        boundingBoxIouThresholdBps: z.literal(5_000),
        expectedRequiredLayerCount: z.int().min(0).max(5),
        actualLayerCount: z.int().min(3).max(5),
        matchedRequiredLayerCount: z.int().min(0).max(5),
        allRequiredLayersMatched: z.boolean(),
        noExtraLayers: z.boolean(),
        pass: z.boolean(),
      })
      .readonly(),
    ocrQuality: z
      .strictObject({
        evaluationVersion: z.literal(2),
        boundingBoxIouThresholdBps: z.literal(7_000),
        expectedMainTextOccurrenceCount: z.int().min(0).max(100),
        actualObservationCount: z.int().min(0).max(100),
        matchedMainTextObservationCount: z.int().min(0).max(100),
        bboxMatchedMainTextObservationCount: z.int().min(0).max(100),
        extraObservationCount: z.int().min(0).max(100),
        mainTextRecallPass: z.boolean(),
        mainTextBoundingBoxesPass: z.boolean(),
        approvedMainTextPass: z.boolean(),
        precisionStatus: z.enum(['unavailable-unscored', 'available-scored']),
        precisionPass: z.boolean().nullable(),
        semanticFalsePositiveCount: z.int().min(0).max(100).nullable(),
        fullExactOcrEligible: z.boolean(),
        fullExactOcrPass: z.boolean(),
        modelConfidenceUsedAsOracle: z.literal(false),
      })
      .readonly(),
    ocrPass: z.boolean(),
    pass: z.boolean(),
  })
  .readonly();

const QwenFixtureBenchmarkResultV1Schema = z
  .strictObject({
    fixtureId: QwenBenchmarkFixtureIdSchema,
    normalizedSourceSha256: Sha256HexSchema,
    oracleSha256: Sha256HexSchema,
    providerCallCount: z.union([z.literal(0), z.literal(1)]),
    retryCount: z.literal(0),
    accountingStatus: z.enum(['not-dispatched', 'indeterminate', 'complete']),
    latencyMs: z.int().min(0).max(600_000).nullable(),
    fixtureWallTimeMs: z.int().min(0).max(1_200_000),
    usage: QwenProviderUsageV1Schema.nullable(),
    calculatedListCost: QwenCalculatedListCostV1Schema.nullable(),
    quality: QwenFixtureQualitySummaryV1Schema.nullable(),
    diagnostic: QwenValidationDiagnosticV1Schema.nullable().optional(),
    diagnosticArtifact: QwenDiagnosticArtifactMetadataV1Schema.optional(),
    diagnosticReplayStatus: z.enum(['reproduced', 'mismatch']).optional(),
    status: z.enum(['pass', 'fail']),
    classifiedFailureReason: QwenBenchmarkClassifiedFailureReasonSchema,
  })
  .superRefine((result, context) => {
    const accountingIsConsistent =
      (result.accountingStatus === 'not-dispatched' &&
        result.providerCallCount === 0 &&
        result.latencyMs === null &&
        result.usage === null &&
        result.calculatedListCost === null) ||
      (result.accountingStatus === 'indeterminate' &&
        result.providerCallCount === 1 &&
        result.latencyMs !== null &&
        result.usage === null &&
        result.calculatedListCost === null) ||
      (result.accountingStatus === 'complete' &&
        result.providerCallCount === 1 &&
        result.latencyMs !== null &&
        result.usage !== null &&
        result.calculatedListCost !== null &&
        canonicalizeJson(result.calculatedListCost) ===
          canonicalizeJson(calculateQwen3VlListCostMicros(result.usage)));
    const statusIsConsistent =
      (result.status === 'pass' &&
        result.classifiedFailureReason === 'none' &&
        result.quality?.pass === true &&
        result.accountingStatus === 'complete') ||
      (result.status === 'fail' && result.classifiedFailureReason !== 'none');
    const diagnosticIsConsistent =
      (result.diagnosticArtifact === undefined && result.diagnosticReplayStatus === undefined) ||
      (result.diagnosticArtifact !== undefined && result.diagnosticReplayStatus !== undefined);
    if (!accountingIsConsistent || !statusIsConsistent || !diagnosticIsConsistent) {
      context.addIssue({
        code: 'custom',
        message:
          'Qwen fixture result accounting, status, or failure classification is inconsistent.',
      });
    }
  })
  .readonly();

const QwenBenchmarkCapsV1Schema = z
  .strictObject({
    capsVersion: z.literal(1),
    fixtureCount: z.literal(4),
    successfulRunsPerFixtureMaximum: z.literal(1),
    successfulRunsMaximum: z.literal(4),
    providerCallsMaximum: z.literal(4),
    retryCount: z.literal(0),
    perCallTimeoutMs: z.literal(60_000),
    perFixtureTimeoutMs: z.literal(120_000),
    totalWallTimeMs: z.literal(600_000),
    totalCalculatedListCostMaximumMicroUsd: z.literal('500000'),
  })
  .readonly();

const QwenBenchmarkTotalCostV1Schema = z
  .strictObject({
    currency: z.literal('USD'),
    unit: z.literal('micro-USD'),
    calculation: z.literal('official-list-price-not-provider-reported-cost'),
    accountingStatus: z.enum(['complete', 'indeterminate']),
    knownAttemptCostMicros: CanonicalMicrosStringSchema,
    indeterminateAttemptCount: z.int().min(0).max(4),
  })
  .superRefine((cost, context) => {
    if ((cost.accountingStatus === 'complete') !== (cost.indeterminateAttemptCount === 0)) {
      context.addIssue({
        code: 'custom',
        message: 'Qwen benchmark total cost completeness status is inconsistent.',
      });
    }
  })
  .readonly();

const qwenFourFixtureBenchmarkReportCommonShape = {
  reportKind: z.literal('qwen-four-fixture-scene-analysis-benchmark'),
  mode: z.enum(['deterministic-fake', 'live-provider']),
  providerNetworkUsed: z.boolean(),
  providerKey: z.literal(QWEN3_VL_PROVIDER_KEY),
  requestedModelId: z.literal(QWEN3_VL_REQUESTED_MODEL_ID),
  endpoint: z.literal(QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT).nullable(),
  officialEvidenceRetrievedDate: z.literal(QWEN3_VL_OFFICIAL_EVIDENCE_RETRIEVED_DATE),
  pricingEvidenceSha256: z.literal(QWEN3_VL_PRICING_EVIDENCE_SHA256),
  pendingCorpusCoreSha256: z.literal(QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256),
  humanOracleCorpusSha256: z.literal(QWEN_FOUR_FIXTURE_HUMAN_ORACLE_CORPUS_SHA256),
  benchmarkCapsSha256: z.literal(QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256),
  caps: QwenBenchmarkCapsV1Schema,
  providerCallCount: z.int().min(0).max(4),
  successfulRunCount: z.int().min(0).max(4),
  retryCount: z.literal(0),
  totalWallTimeMs: z.int().min(0).max(1_200_000),
  totalCalculatedListCost: QwenBenchmarkTotalCostV1Schema,
  fixtureResults: z.array(QwenFixtureBenchmarkResultV1Schema).max(4).readonly(),
  stoppedEarly: z.boolean(),
  terminalFailureReason: QwenBenchmarkClassifiedFailureReasonSchema,
  overallPass: z.boolean(),
  productionAdmissionAuthority: z.literal(false),
  webRouteActivated: z.literal(false),
  humanOracleModified: z.literal(false),
  diagnosticOneFixtureMode: z.literal(true).optional(),
  diagnosticReportRelativePath: QwenDiagnosticReportRelativePathV1Schema.optional(),
} as const;

const QwenFourFixtureBenchmarkReportV1CoreSchema = z.strictObject({
  reportVersion: z.literal(1),
  ...qwenFourFixtureBenchmarkReportCommonShape,
  requestShapeSha256: z.literal(QWEN3_VL_REQUEST_SHAPE_V1_SHA256),
  orderedModelInputDigestsSha256: z.literal(QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_SHA256),
});

const QwenFourFixtureBenchmarkReportV2CoreSchema = z.strictObject({
  reportVersion: z.literal(2),
  ...qwenFourFixtureBenchmarkReportCommonShape,
  providerProtocolWrapperSha256: z.literal(QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_SHA256),
  requestShapeSha256: z.literal(QWEN3_VL_REQUEST_SHAPE_V2_SHA256),
  orderedModelInputDigestsSha256: z.literal(QWEN_FOUR_FIXTURE_ACTIVE_MODEL_INPUT_DIGESTS_SHA256),
});

type QwenFourFixtureBenchmarkReportCore =
  | z.infer<typeof QwenFourFixtureBenchmarkReportV1CoreSchema>
  | z.infer<typeof QwenFourFixtureBenchmarkReportV2CoreSchema>;

const refineQwenFourFixtureBenchmarkReport = (
  report: QwenFourFixtureBenchmarkReportCore,
  context: z.RefinementCtx,
): void => {
  const knownCost = report.fixtureResults.reduce(
    (total, fixture) =>
      total +
      (fixture.calculatedListCost === null
        ? 0n
        : parseMicros(fixture.calculatedListCost.calculatedListCostMicros)),
    0n,
  );
  const fixtureOrderIsCanonical = report.fixtureResults.every(
    (fixture, index) =>
      fixture.fixtureId === QWEN_FOUR_FIXTURE_CANONICAL_REQUEST_CATALOG_V1[index]?.fixtureId,
  );
  const diagnosticModeIsConsistent =
    report.diagnosticOneFixtureMode === true
      ? report.mode === 'live-provider' &&
        report.fixtureResults.length === 1 &&
        report.providerCallCount <= 1 &&
        report.overallPass === false &&
        report.diagnosticReportRelativePath !== undefined
      : report.diagnosticReportRelativePath === undefined;
  if (
    report.providerCallCount !==
      report.fixtureResults.reduce((total, fixture) => total + fixture.providerCallCount, 0) ||
    report.successfulRunCount !==
      report.fixtureResults.filter((fixture) => fixture.quality !== null).length ||
    report.totalCalculatedListCost.knownAttemptCostMicros !== formatMicros(knownCost) ||
    report.totalCalculatedListCost.indeterminateAttemptCount !==
      report.fixtureResults.filter((fixture) => fixture.accountingStatus === 'indeterminate')
        .length ||
    !fixtureOrderIsCanonical ||
    (report.mode === 'deterministic-fake' && report.providerNetworkUsed) ||
    (report.mode === 'live-provider' &&
      report.providerNetworkUsed !== report.providerCallCount > 0) ||
    report.overallPass !==
      (!report.stoppedEarly &&
        report.fixtureResults.length === QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1.fixtureCount &&
        report.fixtureResults.every((fixture) => fixture.status === 'pass')) ||
    (report.stoppedEarly && report.terminalFailureReason === 'none') ||
    (!report.stoppedEarly && report.terminalFailureReason !== 'none') ||
    !diagnosticModeIsConsistent
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Qwen benchmark report totals, order, network status, or outcome are inconsistent.',
    });
  }
};

export const QwenFourFixtureBenchmarkReportV1Schema =
  QwenFourFixtureBenchmarkReportV1CoreSchema.superRefine(
    refineQwenFourFixtureBenchmarkReport,
  ).readonly();

export const QwenFourFixtureBenchmarkReportV2Schema =
  QwenFourFixtureBenchmarkReportV2CoreSchema.superRefine(
    refineQwenFourFixtureBenchmarkReport,
  ).readonly();

export type QwenFourFixtureBenchmarkReportV1 = z.infer<
  typeof QwenFourFixtureBenchmarkReportV1Schema
>;
export type QwenFourFixtureBenchmarkReportV2 = z.infer<
  typeof QwenFourFixtureBenchmarkReportV2Schema
>;

const defaultClock: QwenAdapterClockPort = Object.freeze({
  nowEpochMs: () => Date.now(),
  nowMonotonicMs: () => performance.now(),
});

const maximumSingleCallListCost = calculateQwen3VlListCostMicros({
  prompt_tokens: 256_000,
  completion_tokens: 4_096,
  total_tokens: 260_096,
});

const validateBytesBeforeRequest = (input: {
  readonly bytes: Uint8Array;
  readonly expected: {
    readonly detectedMediaType: string;
    readonly sha256: string;
    readonly byteSize: number;
    readonly pixelWidth: number;
    readonly pixelHeight: number;
  };
}): void => {
  const raster = assertCanonicalNormalizedPng(input.bytes);
  if (
    input.expected.detectedMediaType !== 'image/png' ||
    input.bytes.byteLength !== input.expected.byteSize ||
    sha256Hex(input.bytes) !== input.expected.sha256 ||
    raster.width !== input.expected.pixelWidth ||
    raster.height !== input.expected.pixelHeight
  ) {
    throw new TypeError(
      'Qwen benchmark fixture bytes or digest drifted before request construction.',
    );
  }
};

const classifyQualityFailure = (quality: ReturnType<typeof evaluateQwenFourFixtureQualityV1>) =>
  !quality.layerQuality.pass
    ? ('layer-quality-failed' as const)
    : !quality.ocrPass
      ? ('ocr-quality-failed' as const)
      : ('none' as const);

const summarizeQuality = (quality: ReturnType<typeof evaluateQwenFourFixtureQualityV1>) =>
  QwenFixtureQualitySummaryV1Schema.parse({
    evaluationVersion: quality.evaluationVersion,
    layerQuality: quality.layerQuality,
    ocrQuality: {
      evaluationVersion: quality.ocrQuality.evaluationVersion,
      boundingBoxIouThresholdBps: quality.ocrQuality.boundingBoxIouThresholdBps,
      expectedMainTextOccurrenceCount: quality.ocrQuality.expectedMainTextOccurrenceCount,
      actualObservationCount: quality.ocrQuality.actualObservationCount,
      matchedMainTextObservationCount: quality.ocrQuality.matchedMainTextObservationCount,
      bboxMatchedMainTextObservationCount: quality.ocrQuality.bboxMatchedMainTextObservationCount,
      extraObservationCount: quality.ocrQuality.extraObservationCount,
      mainTextRecallPass: quality.ocrQuality.mainTextRecallPass,
      mainTextBoundingBoxesPass: quality.ocrQuality.mainTextBoundingBoxesPass,
      approvedMainTextPass: quality.ocrQuality.approvedMainTextPass,
      precisionStatus: quality.ocrQuality.precisionStatus,
      precisionPass: quality.ocrQuality.precisionPass,
      semanticFalsePositiveCount: quality.ocrQuality.semanticFalsePositiveCount,
      fullExactOcrEligible: quality.ocrQuality.fullExactOcrEligible,
      fullExactOcrPass: quality.ocrQuality.fullExactOcrPass,
      modelConfidenceUsedAsOracle: quality.ocrQuality.modelConfidenceUsedAsOracle,
    },
    ocrPass: quality.ocrPass,
    pass: quality.pass,
  });

const notDispatchedAccounting = (): QwenAttemptAccounting =>
  Object.freeze({
    status: 'not-dispatched' as const,
    latencyMs: null,
    usage: null,
    calculatedListCost: null,
  });

const indeterminateAccounting = (latencyMs: number): QwenAttemptAccounting =>
  Object.freeze({
    status: 'indeterminate' as const,
    latencyMs,
    usage: null,
    calculatedListCost: null,
  });

const deadlineFailureReason = (remaining: {
  readonly callMs: number;
  readonly fixtureMs: number;
  readonly totalMs: number;
}): QwenBenchmarkClassifiedFailureReason | null => {
  if (remaining.totalMs < 1) return 'total-time-limit-exceeded';
  if (remaining.fixtureMs < 1) return 'fixture-time-limit-exceeded';
  if (remaining.callMs < 1) return 'call-time-limit-exceeded';
  return null;
};

export const serializeQwenFourFixtureBenchmarkReport = (report: unknown): string =>
  `${canonicalizeJson(QwenFourFixtureBenchmarkReportV2Schema.parse(report))}\n`;

export const replayQwenDiagnosticArtifactStatusV1 = async (
  artifactInput: unknown,
): Promise<'reproduced' | 'mismatch'> => {
  try {
    const artifact = QwenDiagnosticArtifactMetadataV1Schema.parse(artifactInput);
    const replay = await replaySanitizedQwenResponseV1({ responseFile: artifact.relativePath });
    return replay.replayReproduced && replay.sourceRawFileSha256 === artifact.rawFileSha256
      ? 'reproduced'
      : 'mismatch';
  } catch {
    return 'mismatch';
  }
};

export const runQwenFourFixtureBenchmark = async (input: {
  readonly mode: 'deterministic-fake' | 'live-provider';
  readonly transport: QwenTransportPort;
  readonly authorization?: QwenBenchmarkExecutionAuthorization;
  readonly secret: string | null;
  readonly cancellation: CancellationSignalPort;
  readonly clock?: QwenAdapterClockPort;
}): Promise<QwenFourFixtureBenchmarkReportV2> => {
  const clock = input.clock ?? defaultClock;
  const benchmarkStartedAt = clock.nowMonotonicMs();
  const diagnosticCapture = input.authorization?.diagnosticCapture ?? null;
  if (
    (input.mode === 'live-provider' && input.transport.transportKind !== 'native-fetch') ||
    (input.mode === 'deterministic-fake' && input.transport.transportKind !== 'deterministic-fake')
  ) {
    throw new TypeError('Qwen benchmark mode and injected transport differ.');
  }
  if (diagnosticCapture !== null && input.mode !== 'live-provider') {
    throw new TypeError('Qwen diagnostic capture is live-provider-only.');
  }
  if (
    PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256 !==
    QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256
  ) {
    throw new TypeError('Qwen benchmark pending corpus digest drifted.');
  }
  const verifiedCorpus = await loadVerifiedPendingRealModelBenchmarkCorpusV2({
    manifest: REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2,
  });
  const evaluationBindings = getQwenFourFixtureEvaluationBindingsV1();
  if (
    verifiedCorpus.pendingCoreSha256 !== QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256 ||
    verifiedCorpus.fixtureCount !== QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1.fixtureCount ||
    evaluationBindings.length !== QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1.fixtureCount ||
    QWEN_FOUR_FIXTURE_CANONICAL_REQUEST_CATALOG_V1.length !==
      QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1.fixtureCount
  ) {
    throw new TypeError('Qwen benchmark corpus, oracle, request catalog, or cap identity drifted.');
  }

  let providerCallCount = 0;
  const boundedTransport: QwenTransportPort = Object.freeze({
    transportKind: input.transport.transportKind,
    async dispatch(request: QwenTransportRequest) {
      if (
        providerCallCount >=
        (diagnosticCapture?.providerCallsMaximum ??
          QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1.providerCallsMaximum)
      ) {
        throw new QwenSceneAnalysisError('duplicate-invocation');
      }
      providerCallCount += 1;
      return input.transport.dispatch(request);
    },
  });
  const adapter = createQwen3VlSceneAnalysisAdapter({ transport: boundedTransport, clock });
  const fixtureResults: QwenFourFixtureBenchmarkReportV2['fixtureResults'][number][] = [];
  let successfulRunCount = 0;
  let knownCalculatedListCostMicros = 0n;
  let indeterminateAttemptCount = 0;
  let stoppedEarly = false;
  let terminalFailureReason: QwenBenchmarkClassifiedFailureReason = 'none';

  for (const [index, binding] of evaluationBindings.entries()) {
    const fixtureStartedAt = clock.nowMonotonicMs();
    const elapsedBeforeFixture = Math.max(0, Math.ceil(fixtureStartedAt - benchmarkStartedAt));
    const callsBeforeFixture = providerCallCount;
    const pushFailure = async (inputFailure: {
      readonly reason: QwenBenchmarkClassifiedFailureReason;
      readonly accounting: QwenAttemptAccounting;
      readonly quality?: ReturnType<typeof summarizeQuality> | null;
      readonly diagnostic?: QwenSceneAnalysisError['diagnostic'];
      readonly diagnosticArtifact?: QwenSceneAnalysisError['diagnosticArtifact'];
    }): Promise<void> => {
      const callsForFixture = providerCallCount - callsBeforeFixture;
      const accounting =
        callsForFixture === 0
          ? notDispatchedAccounting()
          : inputFailure.accounting.status === 'not-dispatched'
            ? indeterminateAccounting(
                Math.max(0, Math.ceil(clock.nowMonotonicMs() - fixtureStartedAt)),
              )
            : inputFailure.accounting;
      if (accounting.status === 'complete') {
        knownCalculatedListCostMicros += parseMicros(
          accounting.calculatedListCost.calculatedListCostMicros,
        );
      } else if (accounting.status === 'indeterminate') {
        indeterminateAttemptCount += 1;
      }
      const diagnosticReplayStatus =
        inputFailure.diagnosticArtifact === undefined || inputFailure.diagnosticArtifact === null
          ? undefined
          : await replayQwenDiagnosticArtifactStatusV1(inputFailure.diagnosticArtifact);
      fixtureResults.push(
        QwenFixtureBenchmarkResultV1Schema.parse({
          fixtureId: binding.fixtureId,
          normalizedSourceSha256: binding.normalizedSource.sha256,
          oracleSha256: binding.oracleSha256,
          providerCallCount: callsForFixture,
          retryCount: 0,
          accountingStatus: accounting.status,
          latencyMs: accounting.latencyMs,
          fixtureWallTimeMs: Math.max(0, Math.ceil(clock.nowMonotonicMs() - fixtureStartedAt)),
          usage: accounting.usage,
          calculatedListCost: accounting.calculatedListCost,
          quality: inputFailure.quality ?? null,
          ...(inputFailure.diagnostic === undefined ? {} : { diagnostic: inputFailure.diagnostic }),
          ...(inputFailure.diagnosticArtifact === undefined ||
          inputFailure.diagnosticArtifact === null
            ? {}
            : {
                diagnosticArtifact: inputFailure.diagnosticArtifact,
                diagnosticReplayStatus,
              }),
          status: 'fail',
          classifiedFailureReason: inputFailure.reason,
        }),
      );
      stoppedEarly = true;
      terminalFailureReason = inputFailure.reason;
    };

    if (elapsedBeforeFixture >= QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1.totalWallTimeMs) {
      await pushFailure({
        reason: 'total-time-limit-exceeded',
        accounting: notDispatchedAccounting(),
      });
      break;
    }
    if (
      providerCallCount >= QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1.providerCallsMaximum ||
      successfulRunCount >= QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1.successfulRunsMaximum ||
      knownCalculatedListCostMicros +
        parseMicros(maximumSingleCallListCost.calculatedListCostMicros) >
        parseMicros(QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1.totalCalculatedListCostMaximumMicroUsd)
    ) {
      await pushFailure({
        reason: 'benchmark-cap-exceeded',
        accounting: notDispatchedAccounting(),
      });
      break;
    }
    const source = REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V2[index];
    const verified = verifiedCorpus.entries[index];
    const catalogEntry = QWEN_FOUR_FIXTURE_CANONICAL_REQUEST_CATALOG_V1[index];
    if (
      source === undefined ||
      verified === undefined ||
      catalogEntry === undefined ||
      source.fixtureId !== binding.fixtureId ||
      verified.fixtureId !== binding.fixtureId ||
      catalogEntry.fixtureId !== binding.fixtureId ||
      source.normalized.filename !== catalogEntry.filename ||
      verified.normalized.sha256 !== binding.normalizedSource.sha256 ||
      catalogEntry.normalizedSource.sha256 !== binding.normalizedSource.sha256 ||
      catalogEntry.oracleSha256 !== binding.oracleSha256
    ) {
      throw new TypeError('Qwen benchmark fixture order or verified source binding drifted.');
    }
    const normalizedImageBytes = await readPendingCorpusPackageFileV2(source.normalized.reference);
    validateBytesBeforeRequest({ bytes: normalizedImageBytes, expected: binding.normalizedSource });

    const callBudgetStartedAt = clock.nowMonotonicMs();
    const request = createCanonicalQwenBenchmarkRequestV1(binding.fixtureId);
    const immediatelyBeforeDispatch = clock.nowMonotonicMs();
    const remaining = Object.freeze({
      callMs:
        QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1.perCallTimeoutMs -
        (immediatelyBeforeDispatch - callBudgetStartedAt),
      fixtureMs:
        QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1.perFixtureTimeoutMs -
        (immediatelyBeforeDispatch - fixtureStartedAt),
      totalMs:
        QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1.totalWallTimeMs -
        (immediatelyBeforeDispatch - benchmarkStartedAt),
    });
    const deadlineFailure = deadlineFailureReason(remaining);
    const dispatchTimeoutMs = Math.floor(
      Math.min(remaining.callMs, remaining.fixtureMs, remaining.totalMs),
    );
    if (deadlineFailure !== null || dispatchTimeoutMs < 1) {
      await pushFailure({
        reason:
          deadlineFailure ??
          (remaining.callMs <= remaining.fixtureMs && remaining.callMs <= remaining.totalMs
            ? 'call-time-limit-exceeded'
            : remaining.fixtureMs <= remaining.totalMs
              ? 'fixture-time-limit-exceeded'
              : 'total-time-limit-exceeded'),
        accounting: notDispatchedAccounting(),
      });
      break;
    }

    let attemptAccounting = notDispatchedAccounting();
    let qualitySummary: ReturnType<typeof summarizeQuality> | null = null;
    try {
      const result = await adapter.analyze({
        request,
        normalizedImageBytes,
        context: {
          deadlineAtMs: EpochMillisecondsSchema.parse(clock.nowEpochMs() + dispatchTimeoutMs),
          externalIdempotencyKey: null,
          cancellation: input.cancellation,
        },
        ...(input.authorization === undefined ? {} : { authorization: input.authorization }),
        secret: input.secret,
      });
      successfulRunCount += 1;
      attemptAccounting = Object.freeze({
        status: 'complete' as const,
        latencyMs: result.latencyMs,
        usage: result.usage,
        calculatedListCost: result.calculatedListCost,
      });
      const prospectiveCost =
        knownCalculatedListCostMicros +
        parseMicros(result.calculatedListCost.calculatedListCostMicros);
      if (
        prospectiveCost >
        parseMicros(QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1.totalCalculatedListCostMaximumMicroUsd)
      ) {
        await pushFailure({ reason: 'benchmark-cap-exceeded', accounting: attemptAccounting });
        break;
      }
      const quality = evaluateQwenFourFixtureQualityV1({
        fixtureId: binding.fixtureId,
        normalizedSourceSha256: binding.normalizedSource.sha256,
        oracleSha256: binding.oracleSha256,
        actualParts: result.proposal.composition.parts,
        actualObservations: result.proposal.textObservations.observations,
      });
      qualitySummary = summarizeQuality(quality);
      const afterEvaluation = clock.nowMonotonicMs();
      const fixtureElapsedMs = Math.max(0, Math.ceil(afterEvaluation - fixtureStartedAt));
      const totalElapsedMs = Math.max(0, Math.ceil(afterEvaluation - benchmarkStartedAt));
      if (fixtureElapsedMs > QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1.perFixtureTimeoutMs) {
        await pushFailure({
          reason: 'fixture-time-limit-exceeded',
          accounting: attemptAccounting,
          quality: qualitySummary,
        });
        break;
      }
      if (totalElapsedMs > QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1.totalWallTimeMs) {
        await pushFailure({
          reason: 'total-time-limit-exceeded',
          accounting: attemptAccounting,
          quality: qualitySummary,
        });
        break;
      }
      const classifiedFailureReason = classifyQualityFailure(quality);
      knownCalculatedListCostMicros = prospectiveCost;
      const diagnosticReplayStatus =
        result.diagnosticArtifact === null
          ? undefined
          : await replayQwenDiagnosticArtifactStatusV1(result.diagnosticArtifact);
      fixtureResults.push(
        QwenFixtureBenchmarkResultV1Schema.parse({
          fixtureId: binding.fixtureId,
          normalizedSourceSha256: binding.normalizedSource.sha256,
          oracleSha256: binding.oracleSha256,
          providerCallCount: 1,
          retryCount: 0,
          accountingStatus: 'complete',
          latencyMs: result.latencyMs,
          fixtureWallTimeMs: fixtureElapsedMs,
          usage: result.usage,
          calculatedListCost: result.calculatedListCost,
          quality: qualitySummary,
          ...(result.diagnosticArtifact === null
            ? {}
            : { diagnosticArtifact: result.diagnosticArtifact, diagnosticReplayStatus }),
          status: quality.pass ? 'pass' : 'fail',
          classifiedFailureReason,
        }),
      );
    } catch (error) {
      const classifiedFailureReason: QwenBenchmarkClassifiedFailureReason =
        error instanceof QwenSceneAnalysisError ? error.reason : 'identity-mismatch';
      const accounting =
        error instanceof QwenSceneAnalysisError ? error.accounting : attemptAccounting;
      await pushFailure({
        reason: classifiedFailureReason,
        accounting,
        quality: qualitySummary,
        ...(error instanceof QwenSceneAnalysisError
          ? {
              diagnostic: error.diagnostic,
              diagnosticArtifact: error.diagnosticArtifact,
            }
          : {}),
      });
      break;
    }
    if (diagnosticCapture !== null) break;
  }

  const totalWallTimeMs = Math.max(0, Math.ceil(clock.nowMonotonicMs() - benchmarkStartedAt));
  if (totalWallTimeMs > QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1.totalWallTimeMs && !stoppedEarly) {
    stoppedEarly = true;
    terminalFailureReason = 'total-time-limit-exceeded';
  }
  const overallPass =
    !stoppedEarly &&
    fixtureResults.length === QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1.fixtureCount &&
    fixtureResults.every((result) => result.status === 'pass');
  return QwenFourFixtureBenchmarkReportV2Schema.parse({
    reportVersion: 2,
    reportKind: 'qwen-four-fixture-scene-analysis-benchmark',
    mode: input.mode,
    providerNetworkUsed: input.mode === 'live-provider' && providerCallCount > 0,
    providerKey: QWEN3_VL_PROVIDER_KEY,
    requestedModelId: QWEN3_VL_REQUESTED_MODEL_ID,
    endpoint: input.authorization?.endpoint ?? null,
    officialEvidenceRetrievedDate: QWEN3_VL_OFFICIAL_EVIDENCE_RETRIEVED_DATE,
    pricingEvidenceSha256: QWEN3_VL_PRICING_EVIDENCE_SHA256,
    providerProtocolWrapperSha256: QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_SHA256,
    requestShapeSha256: QWEN3_VL_REQUEST_SHAPE_V2_SHA256,
    pendingCorpusCoreSha256: QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256,
    humanOracleCorpusSha256: QWEN_FOUR_FIXTURE_HUMAN_ORACLE_CORPUS_SHA256,
    orderedModelInputDigestsSha256: QWEN_FOUR_FIXTURE_ACTIVE_MODEL_INPUT_DIGESTS_SHA256,
    benchmarkCapsSha256: QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256,
    caps: QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1,
    providerCallCount,
    successfulRunCount,
    retryCount: 0,
    totalWallTimeMs,
    totalCalculatedListCost: {
      currency: 'USD',
      unit: 'micro-USD',
      calculation: 'official-list-price-not-provider-reported-cost',
      accountingStatus: indeterminateAttemptCount === 0 ? 'complete' : 'indeterminate',
      knownAttemptCostMicros: formatMicros(knownCalculatedListCostMicros),
      indeterminateAttemptCount,
    },
    fixtureResults,
    stoppedEarly,
    terminalFailureReason,
    overallPass,
    productionAdmissionAuthority: false,
    webRouteActivated: false,
    humanOracleModified: false,
    ...(diagnosticCapture === null
      ? {}
      : {
          diagnosticOneFixtureMode: true,
          diagnosticReportRelativePath: diagnosticCapture.diagnosticReportRelativePath,
        }),
  });
};
