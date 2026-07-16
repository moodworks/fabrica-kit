import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
  INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
} from '../src/evaluation/ai-contracts.js';
import {
  QWEN3_VL_API_FAMILY,
  QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT,
  QWEN3_VL_ENDPOINT_METHOD,
  QWEN3_VL_HISTORICAL_FRANKFURT_CHAT_COMPLETIONS_ENDPOINT,
  QWEN3_VL_OFFICIAL_EVIDENCE_RETRIEVED_DATE,
  QWEN3_VL_PRICING_EVIDENCE_SHA256,
  QWEN3_VL_PROVIDER_KEY,
  QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V1_SHA256,
  QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2,
  QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_REQUIRED_CONSTRAINTS,
  QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_SHA256,
  QWEN3_VL_REQUESTED_MODEL_ID,
  QWEN3_VL_REQUEST_SHAPE_SHA256,
  QWEN3_VL_REQUEST_SHAPE_V1_SHA256,
  QWEN3_VL_REQUEST_SHAPE_V2,
  QWEN3_VL_SECRET_REFERENCE_NAME,
  QWEN3_VL_SERVER_WORKSPACE_ID,
  QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256,
  QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1,
  QWEN_FOUR_FIXTURE_HUMAN_ORACLE_CORPUS_SHA256,
  QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256,
  QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V1,
  QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V1_SHA256,
  QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2,
  QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2_SHA256,
  calculateQwen3VlListCostMicros,
  deriveQwenFrankfurtChatCompletionsEndpoint,
} from '../src/evaluation/qwen3-vl-candidate-evidence.js';
import {
  QwenBenchmarkFixtureIdSchema,
  createDeterministicOracleMatchingQwenOutputV1,
} from '../src/evaluation/qwen-four-fixture-quality.js';
import { createDeterministicQwenTransport } from '../src/server/qwen3-vl-deterministic-fake-transport.js';
import { canonicalizeJson, sha256Hex } from '../src/scene/canonical-scene-json.js';
import {
  QWEN_FOUR_FIXTURE_ACTIVE_MODEL_INPUT_DIGESTS_SHA256,
  QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_SHA256,
} from '../src/server/qwen-four-fixture-request-catalog.js';
import {
  createQwenDryRunExecutionAuthorization as createQwenDryRunExecutionAuthorizationImpl,
  preflightQwenLiveExecutionAuthorization,
  type QwenAdapterClockPort,
} from '../src/server/qwen3-vl-scene-analysis-adapter.js';
import {
  QWEN_FOUR_FIXTURE_REPORT_PATH,
  QWEN_SINGAPORE_V4_REPORT_PATH,
  QwenFourFixtureBenchmarkReportV4Schema,
  runQwenFourFixtureBenchmark,
  serializeQwenFourFixtureBenchmarkReport,
} from '../src/server/qwen-four-fixture-benchmark.js';

const fixedNowMs = Date.parse('2026-07-16T19:00:00.000Z');
const createQwenDryRunExecutionAuthorization = (input: {
  readonly nowMs: number;
  readonly serverWorkspaceId?: string;
}) =>
  createQwenDryRunExecutionAuthorizationImpl({
    ...input,
    currentGitSha: '45b3ceaf311008fb5c84cc8f8ea236d7846a20bf',
  });

const cancellation = Object.freeze({
  cancelled: false,
  throwIfCancelled(): void {},
});

const deterministicClock = (): QwenAdapterClockPort => {
  let monotonicMs = 0;
  return Object.freeze({
    nowEpochMs: () => fixedNowMs,
    nowMonotonicMs: () => {
      const value = monotonicMs;
      monotonicMs += 5;
      return value;
    },
  });
};

const successSteps = () =>
  QwenBenchmarkFixtureIdSchema.options.map((fixtureId) => ({
    kind: 'success' as const,
    output: createDeterministicOracleMatchingQwenOutputV1(fixtureId),
  }));

const runDryBenchmark = async () => {
  const transport = createDeterministicQwenTransport(successSteps());
  const authorization = createQwenDryRunExecutionAuthorization({ nowMs: fixedNowMs });
  const report = await runQwenFourFixtureBenchmark({
    mode: 'deterministic-fake',
    transport,
    authorization,
    secret: null,
    cancellation,
    clock: deterministicClock(),
  });
  return { report, transport };
};

const liveAuthorizationPacket = () => {
  const serverWorkspaceId = QWEN3_VL_SERVER_WORKSPACE_ID;
  return {
    authorizationVersion: 2 as const,
    authorizationId: 'qwen.live.execution.authorization.2026-07-15',
    mode: 'live-provider' as const,
    purpose: 'one-capped-four-fixture-sequential-zero-retry-benchmark' as const,
    issuedAtMs: fixedNowMs - 1_000,
    expiresAtMs: fixedNowMs + 60_000,
    serverWorkspaceId,
    endpoint: deriveQwenFrankfurtChatCompletionsEndpoint(serverWorkspaceId),
    endpointMethod: QWEN3_VL_ENDPOINT_METHOD,
    apiFamily: QWEN3_VL_API_FAMILY,
    providerKey: QWEN3_VL_PROVIDER_KEY,
    requestedModelId: QWEN3_VL_REQUESTED_MODEL_ID,
    secretReferenceName: QWEN3_VL_SECRET_REFERENCE_NAME,
    pendingCorpusCoreSha256: QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256,
    humanOracleCorpusSha256: QWEN_FOUR_FIXTURE_HUMAN_ORACLE_CORPUS_SHA256,
    pricingEvidenceSha256: QWEN3_VL_PRICING_EVIDENCE_SHA256,
    pricingEvidenceRetrievedDate: QWEN3_VL_OFFICIAL_EVIDENCE_RETRIEVED_DATE,
    providerProtocolWrapperSha256: QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_SHA256,
    requestShapeSha256: QWEN3_VL_REQUEST_SHAPE_SHA256,
    benchmarkCapsSha256: QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256,
    contentPolicyDefinitionSha256: BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
    workflowDefinitionSha256: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1.definitionSha256,
    orderedModelInputDigestsSha256: QWEN_FOUR_FIXTURE_ACTIVE_MODEL_INPUT_DIGESTS_SHA256,
    executionAuthorized: true as const,
  };
};

describe('Qwen four-fixture benchmark runner', () => {
  it('runs all four exact fixtures sequentially with one call each and deterministic passing output', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch');
    const first = await runDryBenchmark();
    const second = await runDryBenchmark();

    expect(first.transport.getCallCount()).toBe(4);
    expect(first.report).toMatchObject({
      reportVersion: 4,
      mode: 'deterministic-fake',
      providerNetworkUsed: false,
      providerCallCount: 4,
      successfulRunCount: 4,
      retryCount: 0,
      totalCalculatedListCost: {
        accountingStatus: 'complete',
        knownAttemptCostMicros: '2200',
        indeterminateAttemptCount: 0,
      },
      requestedModelId: 'qwen3.6-flash-2026-04-16',
      providerProtocolWrapperSha256: QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_SHA256,
      requestShapeSha256: QWEN3_VL_REQUEST_SHAPE_SHA256,
      orderedModelInputDigestsSha256: QWEN_FOUR_FIXTURE_ACTIVE_MODEL_INPUT_DIGESTS_SHA256,
      endpoint:
        'https://ws-4ei01ync8iyumgp4.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
      stoppedEarly: false,
      terminalFailureReason: 'none',
      overallPass: true,
      productionAdmissionAuthority: false,
      webRouteActivated: false,
      humanOracleModified: false,
    });
    expect(first.report.fixtureResults.map((result) => result.fixtureId)).toEqual(
      QwenBenchmarkFixtureIdSchema.options,
    );
    expect(first.report.fixtureResults.every((result) => result.status === 'pass')).toBe(true);
    expect(first.report.fixtureResults.every((result) => result.providerCallCount === 1)).toBe(
      true,
    );
    expect(QwenFourFixtureBenchmarkReportV4Schema.parse(first.report)).toBeDefined();
    expect(() =>
      QwenFourFixtureBenchmarkReportV4Schema.parse({
        ...first.report,
        mode: 'live-provider',
        providerNetworkUsed: true,
      }),
    ).toThrow();
    expect(first.report.fixtureResults.every((result) => result.retryCount === 0)).toBe(true);
    expect(
      first.report.fixtureResults.every((result) => result.accountingStatus === 'complete'),
    ).toBe(true);
    const correctedPersonOutput = createDeterministicOracleMatchingQwenOutputV1('banner-person-v1');
    expect(correctedPersonOutput.composition.kind).toBe('composition_proposal');
    if (correctedPersonOutput.composition.kind !== 'composition_proposal') {
      throw new TypeError('Expected the deterministic person composition proposal.');
    }
    expect(correctedPersonOutput.composition.parts).toHaveLength(5);
    expect(correctedPersonOutput.layerEvidence).toHaveLength(5);
    expect(correctedPersonOutput.layerEvidence.map((evidence) => evidence.partKey)).toEqual(
      correctedPersonOutput.composition.parts.map((part) => part.partKey),
    );
    const personResult = first.report.fixtureResults[0]!;
    expect(personResult.quality).not.toBeNull();
    expect(personResult.quality).toMatchObject({
      layerQuality: { actualLayerCount: 5, pass: true },
      pass: true,
    });
    expect(serializeQwenFourFixtureBenchmarkReport(first.report)).toBe(
      serializeQwenFourFixtureBenchmarkReport(second.report),
    );
    expect(globalFetch).not.toHaveBeenCalled();
    globalFetch.mockRestore();
  });

  it.each([
    ['schema-invalid', 'schema-invalid'],
    ['timeout', 'timeout'],
    ['provider-error', 'provider-error'],
  ] as const)('stops immediately after terminal %s failure with no retry', async (kind, reason) => {
    const transport = createDeterministicQwenTransport([{ kind }, ...successSteps()]);
    const authorization = createQwenDryRunExecutionAuthorization({ nowMs: fixedNowMs });
    const report = await runQwenFourFixtureBenchmark({
      mode: 'deterministic-fake',
      transport,
      authorization,
      secret: null,
      cancellation,
      clock: deterministicClock(),
    });

    expect(transport.getCallCount()).toBe(1);
    expect(report).toMatchObject({
      providerCallCount: 1,
      successfulRunCount: 0,
      retryCount: 0,
      stoppedEarly: true,
      terminalFailureReason: reason,
      overallPass: false,
    });
    expect(report.fixtureResults).toHaveLength(1);
    expect(report.fixtureResults[0]).toMatchObject({
      fixtureId: 'banner-person-v1',
      status: 'fail',
      classifiedFailureReason: reason,
      retryCount: 0,
      ...(kind === 'schema-invalid'
        ? {
            accountingStatus: 'complete',
            usage: { prompt_tokens: 1_000, completion_tokens: 200, total_tokens: 1_200 },
            calculatedListCost: { calculatedListCostMicros: '550' },
          }
        : {
            accountingStatus: 'indeterminate',
            usage: null,
            calculatedListCost: null,
          }),
    });
    expect(report.totalCalculatedListCost).toMatchObject(
      kind === 'schema-invalid'
        ? {
            accountingStatus: 'complete',
            knownAttemptCostMicros: '550',
            indeterminateAttemptCount: 0,
          }
        : {
            accountingStatus: 'indeterminate',
            knownAttemptCostMicros: '0',
            indeterminateAttemptCount: 1,
          },
    );
  });

  it('recomputes every remaining time cap immediately before dispatch and refuses an exhausted call', async () => {
    const monotonicValues = [0, 0, 0, 60_000, 60_000, 60_000] as const;
    let monotonicIndex = 0;
    const clock: QwenAdapterClockPort = Object.freeze({
      nowEpochMs: () => fixedNowMs,
      nowMonotonicMs: () =>
        monotonicValues[Math.min(monotonicIndex++, monotonicValues.length - 1)]!,
    });
    const transport = createDeterministicQwenTransport(successSteps());
    const report = await runQwenFourFixtureBenchmark({
      mode: 'deterministic-fake',
      transport,
      authorization: createQwenDryRunExecutionAuthorization({ nowMs: fixedNowMs }),
      secret: null,
      cancellation,
      clock,
    });

    expect(transport.getCallCount()).toBe(0);
    expect(report).toMatchObject({
      providerCallCount: 0,
      successfulRunCount: 0,
      stoppedEarly: true,
      terminalFailureReason: 'call-time-limit-exceeded',
      overallPass: false,
    });
    expect(report.fixtureResults).toEqual([
      expect.objectContaining({
        fixtureId: 'banner-person-v1',
        providerCallCount: 0,
        accountingStatus: 'not-dispatched',
        latencyMs: null,
        usage: null,
        calculatedListCost: null,
        classifiedFailureReason: 'call-time-limit-exceeded',
      }),
    ]);
  });

  it('aborts a signal-waiting fixture on cancellation and starts no later fixture', async () => {
    let cancelled = false;
    const mutableCancellation = {
      get cancelled() {
        return cancelled;
      },
      throwIfCancelled(): void {
        if (cancelled) throw new Error('cancelled');
      },
    };
    const transport = createDeterministicQwenTransport([{ kind: 'wait-for-abort' }]);
    const reportPromise = runQwenFourFixtureBenchmark({
      mode: 'deterministic-fake',
      transport,
      authorization: createQwenDryRunExecutionAuthorization({ nowMs: fixedNowMs }),
      secret: null,
      cancellation: mutableCancellation,
      clock: Object.freeze({
        nowEpochMs: () => fixedNowMs,
        nowMonotonicMs: () => performance.now(),
      }),
    });
    const cancelPoll = setInterval(() => {
      if (transport.getCallCount() === 1) cancelled = true;
    }, 1);
    const report = await reportPromise;
    clearInterval(cancelPoll);

    expect(transport.getCallCount()).toBe(1);
    expect(transport.getAbortCount()).toBe(1);
    expect(report).toMatchObject({
      providerCallCount: 1,
      successfulRunCount: 0,
      stoppedEarly: true,
      terminalFailureReason: 'cancellation',
      totalCalculatedListCost: {
        accountingStatus: 'indeterminate',
        knownAttemptCostMicros: '0',
        indeterminateAttemptCount: 1,
      },
    });
    expect(report.fixtureResults).toHaveLength(1);
  });

  it('records a quality failure without silently admitting the model', async () => {
    const outputs = QwenBenchmarkFixtureIdSchema.options.map((fixtureId) =>
      createDeterministicOracleMatchingQwenOutputV1(fixtureId),
    );
    const firstValid = outputs[0]!;
    if (firstValid.composition.kind !== 'composition_proposal') {
      throw new Error('Invalid test output.');
    }
    const first = {
      ...firstValid,
      composition: {
        ...firstValid.composition,
        parts: firstValid.composition.parts.map((part, index) =>
          index === 0 ? { ...part, role: 'other' as const } : part,
        ),
      },
    };
    const transport = createDeterministicQwenTransport([
      { kind: 'success', output: first },
      ...outputs.slice(1).map((output) => ({ kind: 'success' as const, output })),
    ]);
    const report = await runQwenFourFixtureBenchmark({
      mode: 'deterministic-fake',
      transport,
      authorization: createQwenDryRunExecutionAuthorization({ nowMs: fixedNowMs }),
      secret: null,
      cancellation,
      clock: deterministicClock(),
    });

    expect(report.providerCallCount).toBe(4);
    expect(report.successfulRunCount).toBe(4);
    expect(report.stoppedEarly).toBe(false);
    expect(report.overallPass).toBe(false);
    expect(report.fixtureResults[0]).toMatchObject({
      status: 'fail',
      classifiedFailureReason: 'layer-quality-failed',
    });
    expect(report.productionAdmissionAuthority).toBe(false);
  });

  it('freezes every requested benchmark cap and exact integer cost ceiling', () => {
    expect(QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1).toEqual({
      capsVersion: 1,
      fixtureCount: 4,
      successfulRunsPerFixtureMaximum: 1,
      successfulRunsMaximum: 4,
      providerCallsMaximum: 4,
      retryCount: 0,
      perCallTimeoutMs: 60_000,
      perFixtureTimeoutMs: 120_000,
      totalWallTimeMs: 600_000,
      totalCalculatedListCostMaximumMicroUsd: '500000',
    });
    expect(BigInt(QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_V1.totalCalculatedListCostMaximumMicroUsd)).toBe(
      500_000n,
    );
  });

  it('pins both versioned diagnostic cap revisions and their canonical digests', () => {
    expect(QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V1_SHA256).toBe(
      '6f0df176ddae07d69e244d5ff9cb696f92f4a53d0a8f8150909dbd8c11451fa0',
    );
    expect(QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2_SHA256).toBe(
      '4099960771c16079383d6f520633265c3113a5fd4b121154afeda5935314b81c',
    );
    expect(QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V1).toMatchObject({
      diagnosticCapsVersion: 1,
      perCallTimeoutMs: 60_000,
      totalWallTimeMs: 120_000,
      totalCalculatedListCostMaximumMicroUsd: '50000',
      productionAdmissionAuthority: false,
      webRouteActivated: false,
    });
    expect(QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2).toMatchObject({
      diagnosticCapsVersion: 2,
      perCallTimeoutMs: 120_000,
      totalWallTimeMs: 150_000,
      totalCalculatedListCostMaximumMicroUsd: '50000',
      productionAdmissionAuthority: false,
      webRouteActivated: false,
    });
    expect(sha256Hex(Buffer.from(canonicalizeJson(QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V1)))).toBe(
      QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V1_SHA256,
    );
    expect(sha256Hex(Buffer.from(canonicalizeJson(QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2)))).toBe(
      QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2_SHA256,
    );
    expect(
      calculateQwen3VlListCostMicros({
        prompt_tokens: 256_000,
        completion_tokens: 4_096,
        total_tokens: 260_096,
      }).calculatedListCostMicros,
    ).toBe('70144');
  });

  it('fails live authorization preflight on absent authority, stale time, or identity/cap drift', () => {
    expect(() =>
      preflightQwenLiveExecutionAuthorization({
        packet: liveAuthorizationPacket(),
        secretPresent: false,
        nowMs: fixedNowMs,
      }),
    ).toThrow();

    const stale = liveAuthorizationPacket();
    stale.expiresAtMs = fixedNowMs;
    expect(() =>
      preflightQwenLiveExecutionAuthorization({
        packet: stale,
        secretPresent: true,
        nowMs: fixedNowMs,
      }),
    ).toThrow();

    for (const mutation of [
      { requestedModelId: 'qwen3-vl-flash-2026-01-22' },
      { requestedModelId: 'qwen3.6-flash' },
      {
        serverWorkspaceId: 'workspace-eu-001',
        endpoint: deriveQwenFrankfurtChatCompletionsEndpoint('workspace-eu-001'),
      },
      { endpoint: 'https://example.invalid/chat/completions' },
      { pendingCorpusCoreSha256: 'f'.repeat(64) },
      { humanOracleCorpusSha256: 'f'.repeat(64) },
      { pricingEvidenceSha256: 'f'.repeat(64) },
      { providerProtocolWrapperSha256: 'f'.repeat(64) },
      { requestShapeSha256: 'f'.repeat(64) },
      { benchmarkCapsSha256: 'f'.repeat(64) },
      { contentPolicyDefinitionSha256: 'f'.repeat(64) },
      { workflowDefinitionSha256: 'f'.repeat(64) },
      { orderedModelInputDigestsSha256: 'f'.repeat(64) },
    ]) {
      expect(() =>
        preflightQwenLiveExecutionAuthorization({
          packet: { ...liveAuthorizationPacket(), ...mutation },
          secretPresent: true,
          nowMs: fixedNowMs,
        }),
      ).toThrow();
    }
  });

  it('fails every stale V1 authorization binding closed during preflight', () => {
    for (const mutation of [
      { authorizationVersion: 1 },
      { providerProtocolWrapperSha256: QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V1_SHA256 },
      { requestShapeSha256: QWEN3_VL_REQUEST_SHAPE_V1_SHA256 },
      { orderedModelInputDigestsSha256: QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_SHA256 },
    ]) {
      expect(() =>
        preflightQwenLiveExecutionAuthorization({
          packet: { ...liveAuthorizationPacket(), ...mutation },
          secretPresent: true,
          nowMs: fixedNowMs,
        }),
      ).toThrow();
    }
  });

  it('binds every required wrapper constraint into both active wrapper and request-shape hashes', () => {
    for (const constraint of QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_REQUIRED_CONSTRAINTS) {
      expect(QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2.content).toContain(constraint);
      const mutatedWrapperContent = QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2.content.replace(
        constraint,
        `${constraint} mutated`,
      );
      const mutatedWrapperSha256 = sha256Hex(Buffer.from(mutatedWrapperContent, 'utf8'));
      const mutatedRequestShapeSha256 = sha256Hex(
        Buffer.from(
          canonicalizeJson({
            ...QWEN3_VL_REQUEST_SHAPE_V2,
            providerProtocolWrapperSha256: mutatedWrapperSha256,
          }),
          'utf8',
        ),
      );
      expect(mutatedWrapperSha256).not.toBe(QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_SHA256);
      expect(mutatedRequestShapeSha256).not.toBe(QWEN3_VL_REQUEST_SHAPE_SHA256);
      expect(() =>
        preflightQwenLiveExecutionAuthorization({
          packet: {
            ...liveAuthorizationPacket(),
            requestShapeSha256: mutatedRequestShapeSha256,
          },
          secretPresent: true,
          nowMs: fixedNowMs,
        }),
      ).toThrow();
    }
  });

  it('keeps the report local/redacted and orders every live preflight before native transport import', async () => {
    const { report } = await runDryBenchmark();
    const reportText = serializeQwenFourFixtureBenchmarkReport(report);
    expect(QWEN_FOUR_FIXTURE_REPORT_PATH).toBe(
      '.local-data/banner-ai/qwen3-vl-four-fixture-benchmark.json',
    );
    expect(QWEN_SINGAPORE_V4_REPORT_PATH).toBe(
      '.local-data/banner-ai/qwen3-vl-four-fixture-benchmark-singapore-v4.json',
    );
    expect(QWEN_SINGAPORE_V4_REPORT_PATH).not.toBe(QWEN_FOUR_FIXTURE_REPORT_PATH);
    expect(() =>
      QwenFourFixtureBenchmarkReportV4Schema.parse({ ...report, endpoint: null }),
    ).toThrow();
    expect(() =>
      QwenFourFixtureBenchmarkReportV4Schema.parse({
        ...report,
        endpoint: QWEN3_VL_HISTORICAL_FRANKFURT_CHAT_COMPLETIONS_ENDPOINT,
      }),
    ).toThrow();
    expect(reportText).not.toMatch(/data:image|Bearer |DASHSCOPE_API_KEY|scene-analysis stage/iu);
    expect(reportText).not.toContain('rawResponse');
    expect(reportText).not.toContain('actualObservations');
    expect(reportText).not.toContain('extraObservations');
    expect(reportText.endsWith('\n')).toBe(true);
    expect(() =>
      serializeQwenFourFixtureBenchmarkReport({ ...report, rawResponse: 'must-not-serialize' }),
    ).toThrow();
    expect(() =>
      serializeQwenFourFixtureBenchmarkReport({
        ...report,
        endpoint:
          'https://foreign-workspace.eu-central-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
      }),
    ).toThrow();

    const packageRoot = fileURLToPath(new URL('..', import.meta.url));
    const cliSource = readFileSync(
      join(packageRoot, 'src/server/qwen-four-fixture-benchmark-cli.ts'),
      'utf8',
    );
    const secretCheck = cliSource.indexOf('process.env.DASHSCOPE_API_KEY');
    const cleanTreeCheck = cliSource.indexOf('assertCleanWorkingTree();');
    const authorizationCheck = cliSource.indexOf('preflightQwenLiveExecutionAuthorization({');
    const nativeImport = cliSource.indexOf("'./qwen3-vl-native-fetch-transport.js'");
    expect(secretCheck).toBeGreaterThan(0);
    expect(cleanTreeCheck).toBeGreaterThan(secretCheck);
    expect(authorizationCheck).toBeGreaterThan(cleanTreeCheck);
    expect(nativeImport).toBeGreaterThan(authorizationCheck);
    expect(cliSource).not.toMatch(/(?:readFile|writeFile|dotenv)[^\n]*\.env/iu);
    const dryRunSource = cliSource.slice(
      cliSource.indexOf('const runDry ='),
      cliSource.indexOf('const authorizationPathFromArguments'),
    );
    expect(dryRunSource).toContain('QWEN_SINGAPORE_V4_REPORT_PATH');
    expect(dryRunSource).not.toContain('QWEN_FOUR_FIXTURE_REPORT_PATH');
    expect(dryRunSource).not.toContain('process.env');
    expect(QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT).not.toBe(
      deriveQwenFrankfurtChatCompletionsEndpoint(QWEN3_VL_SERVER_WORKSPACE_ID),
    );
  });
});
