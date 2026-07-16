import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';
import ts from 'typescript';

import * as publicBannerAi from '../src/index.js';
import {} from '../src/evaluation/ai-contracts.js';
import {
  QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT,
  QWEN3_VL_ENDPOINT_METHOD,
  QWEN3_VL_REQUESTED_MODEL_ID,
  QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256,
  QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2_SHA256,
} from '../src/evaluation/qwen3-vl-candidate-evidence.js';
import { createDeterministicOracleMatchingQwenOutputV1 } from '../src/evaluation/qwen-four-fixture-quality.js';
import { createDeterministicQwenTransport } from '../src/server/qwen3-vl-deterministic-fake-transport.js';
import { EpochMillisecondsSchema } from '../src/jobs/timing.js';
import { createCanonicalQwenBenchmarkRequestV1 } from '../src/server/qwen-four-fixture-request-catalog.js';
import {
  QwenSceneAnalysisError,
  QwenBenchmarkAuthorizationPacketV2Schema,
  createQwen3VlSceneAnalysisAdapter,
  createQwenDiagnosticAuthorizationPacketV3,
  createQwenDiagnosticAuthorizationPacketV4,
  createQwenDryRunExecutionAuthorization as createQwenDryRunExecutionAuthorizationImpl,
  createQwenManualReleaseBindingV1,
  finalizeQwenDiagnosticReportForAuthorizationV1,
  mintQwenBenchmarkExecutionAuthorization as mintQwenBenchmarkExecutionAuthorizationImpl,
  preflightQwenLiveExecutionAuthorization,
  releaseQwenDiagnosticArtifactsForAuthorizationV1,
  reserveQwenDiagnosticArtifactsForAuthorizationV1,
  type QwenAdapterClockPort,
  type QwenAdapterTimerPort,
  type QwenTransportPort,
  type QwenTransportRequest,
  type QwenTransportResponse,
} from '../src/server/qwen3-vl-scene-analysis-adapter.js';
import {
  QwenResponseBoundaryFailure,
  createSyntheticQwenValidationDiagnosticV1,
  pseudonymizeQwenDiagnosticFieldNameV1,
  validateQwenProviderResponseBoundaryV1,
} from '../src/server/qwen3-vl-response-boundary.js';
import {
  QwenDiagnosticCaptureError,
  abortQwenDiagnosticArtifactReservationsV1,
  captureSanitizedQwenResponseV1,
  createQwenDiagnosticParentChainGuardV1,
  replaySanitizedQwenResponseV1,
  reserveQwenDiagnosticArtifactFilesV1,
  verifyQwenDiagnosticParentChainGuardV1,
} from '../src/server/qwen3-vl-response-diagnostics.js';
import {
  QwenFourFixtureBenchmarkReportV1Schema,
  QwenFourFixtureBenchmarkReportV2Schema,
  QwenFourFixtureBenchmarkReportV4Schema,
  replayQwenDiagnosticArtifactStatusV1,
  runQwenFourFixtureBenchmark,
  serializeQwenFourFixtureBenchmarkReport,
} from '../src/server/qwen-four-fixture-benchmark.js';
import { createQwen3VlNativeFetchTransport } from '../src/server/qwen3-vl-native-fetch-transport.js';
import {
  REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V2,
  readPendingCorpusPackageFileV2,
} from '../src/server/real-model-benchmark-pending-corpus-source-registry-v2.js';

const fixedNowMs = Date.parse('2026-07-16T19:00:00.000Z');
const currentGitSha = '45b3ceaf311008fb5c84cc8f8ea236d7846a20bf';
const createQwenDryRunExecutionAuthorization = (input: {
  readonly nowMs: number;
  readonly serverWorkspaceId?: string;
}) => createQwenDryRunExecutionAuthorizationImpl({ ...input, currentGitSha });
const mintQwenBenchmarkExecutionAuthorization = (input: unknown) => {
  if (
    typeof input === 'object' &&
    input !== null &&
    (input as { readonly mode?: unknown }).mode === 'live-provider'
  ) {
    return preflightQwenLiveExecutionAuthorization({
      packet: input,
      secretPresent: true,
      nowMs: fixedNowMs,
      currentGitSha,
    });
  }
  return mintQwenBenchmarkExecutionAuthorizationImpl(input);
};
const manualReleaseFor = (
  token: string,
  issuedAtMs = fixedNowMs - 1_000,
  expiresAtMs = fixedNowMs + 600_000,
) =>
  createQwenManualReleaseBindingV1({
    releaseId: `qwen.manual.${token}`,
    issuedAtMs,
    expiresAtMs,
  });
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const localRelativePaths = new Set<string>();
const historicalLocalEvidence = Object.freeze([
  {
    relativePath: '.local-data/banner-ai/qwen-live-execution-authorization.json',
    sha256: '32a15344da976fbd4c21712103b409edecf41f5b81fe327dc02f5e37380a4153',
  },
  {
    relativePath:
      '.local-data/banner-ai/qwen-response-diagnostic-report-banner-person-v1-20260716-resumed-call-0002.json',
    sha256: '8282acee2c3159f15007a601c72f787f72e410873f88d6f42f7bfa941968e4a5',
  },
  {
    relativePath: '.local-data/banner-ai/qwen-live-diagnostic-execution-authorization.json',
    sha256: '48714c64c67e2d1cf0d8018cb5a491507f66636a6923c452b44a04e772428900',
  },
  {
    relativePath:
      '.local-data/banner-ai/qwen-response-diagnostic-banner-person-v1-20260716-envelope-correction-call-0003.json',
    sha256: '0cb1534ff14d471cff0bb5ebf74e9e0080c27cf1e2dd7d99bf8432774db64d2a',
  },
  {
    relativePath:
      '.local-data/banner-ai/qwen-live-diagnostic-manual-release-20260716-envelope-correction-call-0003.json',
    sha256: '6236239af377bf007e3834fbd0c081034b9acfd24b3fc078485d7b24026fcb43',
  },
  {
    relativePath:
      '.local-data/banner-ai/qwen-response-diagnostic-report-banner-person-v1-20260716-envelope-correction-call-0003.json',
    sha256: '89cd9b30653c0d91db46a0c5e2dd4f5dcd80eb20c63e7cada13177812bbb14c9',
  },
  {
    relativePath: '.local-data/banner-ai/qwen3-vl-four-fixture-benchmark.json',
    sha256: '26c88f5316f0fadbc496ecc937df8d621f5bbbd1d513aae173765beec72adda3',
  },
  {
    relativePath:
      '.local-data/banner-ai/qwen-response-diagnostic-banner-person-v1-20260716-resumed-call-0002.json',
    sha256: 'ad85a335a9dc2836546eef712b17dd7f6dcc9a18048a04e515180e00ba1959d2',
  },
  {
    relativePath:
      '.local-data/banner-ai/qwen-live-diagnostic-execution-authorization-20260716-envelope-correction-call-0003.json',
    sha256: 'd6323f9f1ec588668617e40c78152294e530029d9e66320bf9edf6f0f8906276',
  },
] as const);
const historicalLocalEvidencePresentCount = historicalLocalEvidence.filter((evidence) =>
  existsSync(join(repositoryRoot, evidence.relativePath)),
).length;
const historicalBenchmarkReportIsV1 = (() => {
  const reportPath = join(
    repositoryRoot,
    '.local-data/banner-ai/qwen3-vl-four-fixture-benchmark.json',
  );
  if (!existsSync(reportPath)) return false;
  try {
    return JSON.parse(readFileSync(reportPath, 'utf8')).reportVersion === 1;
  } catch {
    return false;
  }
})();
const historicalLocalEvidencePresent =
  historicalLocalEvidencePresentCount === historicalLocalEvidence.length &&
  historicalBenchmarkReportIsV1;

afterEach(async () => {
  await Promise.all(
    [...localRelativePaths].map((relativePath) =>
      rm(join(repositoryRoot, relativePath), { force: true, recursive: true }),
    ),
  );
  localRelativePaths.clear();
  vi.restoreAllMocks();
});

const validOutput = () => createDeterministicOracleMatchingQwenOutputV1('banner-person-v1');

const validEnvelope = (): Record<string, unknown> => ({
  id: 'chatcmpl-qwen-diagnostic-test',
  object: 'chat.completion',
  created: 1_784_064_000,
  model: QWEN3_VL_REQUESTED_MODEL_ID,
  choices: [
    {
      index: 0,
      message: {
        role: 'assistant',
        content: JSON.stringify(validOutput()),
        refusal: null,
        audio: null,
        function_call: null,
        tool_calls: null,
      },
      finish_reason: 'stop',
      logprobs: null,
    },
  ],
  usage: {
    prompt_tokens: 1_703,
    completion_tokens: 2_184,
    total_tokens: 3_887,
    prompt_tokens_details: { text_tokens: 1_512, image_tokens: 191 },
    completion_tokens_details: { text_tokens: 2_184 },
  },
  system_fingerprint: 'deterministic-diagnostic-no-provider',
  service_tier: null,
});

const responseFor = (body: unknown, status = 200): QwenTransportResponse => ({
  status,
  bodyText: typeof body === 'string' ? body : JSON.stringify(body),
});

const personRequest = () => createCanonicalQwenBenchmarkRequestV1('banner-person-v1');

const captureBoundaryFailure = (response: QwenTransportResponse): QwenResponseBoundaryFailure => {
  try {
    validateQwenProviderResponseBoundaryV1({ response, request: personRequest() });
  } catch (error) {
    if (error instanceof QwenResponseBoundaryFailure) return error;
    throw error;
  }
  throw new Error('Expected the strict Qwen response boundary to reject.');
};

const boundaryFailureOrNull = (
  response: QwenTransportResponse,
): QwenResponseBoundaryFailure | null => {
  try {
    validateQwenProviderResponseBoundaryV1({ response, request: personRequest() });
    return null;
  } catch (error) {
    if (error instanceof QwenResponseBoundaryFailure) return error;
    throw error;
  }
};

const mutateAssistantOutput = (
  envelope: Record<string, unknown>,
  mutation: (output: Record<string, unknown>) => void,
): void => {
  const choices = envelope.choices as Record<string, unknown>[];
  const message = choices[0]!.message as Record<string, unknown>;
  const output = JSON.parse(String(message.content)) as Record<string, unknown>;
  mutation(output);
  message.content = JSON.stringify(output);
};

const diagnosticPaths = (token: string) => {
  const responseArtifactRelativePath =
    `.local-data/banner-ai/qwen-response-diagnostic-${token}.json` as const;
  const diagnosticReportRelativePath =
    `.local-data/banner-ai/qwen-response-diagnostic-report-${token}.json` as const;
  localRelativePaths.add(responseArtifactRelativePath);
  localRelativePaths.add(diagnosticReportRelativePath);
  return { responseArtifactRelativePath, diagnosticReportRelativePath };
};

const livePacket = (token: string) => {
  const packet = createQwenDiagnosticAuthorizationPacketV4({
    authorizationId: `qwen.live.diagnostic.${token}`,
    issuedAtMs: fixedNowMs - 1_000,
    expiresAtMs: fixedNowMs + 599_000,
    gitSha: currentGitSha,
    manualRelease: manualReleaseFor(token),
    ...diagnosticPaths(token),
  });
  return { ...packet, diagnosticCapture: packet.diagnosticCapture! };
};

const fixedClock = (): QwenAdapterClockPort => {
  let monotonicMs = 0;
  return Object.freeze({
    nowEpochMs: () => fixedNowMs,
    nowMonotonicMs: () => {
      monotonicMs += 7;
      return monotonicMs;
    },
  });
};

const manualTimerPort = (): QwenAdapterTimerPort & { fireTimeout(): void } => {
  let timeoutHandler: (() => void) | null = null;
  return {
    setTimeout(handler) {
      timeoutHandler = handler;
      return {} as ReturnType<typeof setTimeout>;
    },
    clearTimeout() {
      timeoutHandler = null;
    },
    setInterval() {
      return {} as ReturnType<typeof setInterval>;
    },
    clearInterval() {},
    fireTimeout() {
      timeoutHandler?.();
    },
  };
};

const firstFixtureInput = async () => {
  const source = REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V2[0]!;
  return {
    request: personRequest(),
    normalizedImageBytes: await readPendingCorpusPackageFileV2(source.normalized.reference),
    context: {
      deadlineAtMs: EpochMillisecondsSchema.parse(fixedNowMs + 60_000),
      externalIdempotencyKey: null,
      cancellation: { cancelled: false, throwIfCancelled(): void {} },
    },
  };
};

const liveLikeTransport = (
  response: QwenTransportResponse,
): QwenTransportPort & { readonly dispatchMock: ReturnType<typeof vi.fn> } => {
  const dispatchMock = vi.fn(async () => response);
  return Object.freeze({
    transportKind: 'native-fetch' as const,
    dispatch: dispatchMock,
    dispatchMock,
  });
};
const fakeLikeTransport = (
  response: QwenTransportResponse,
): QwenTransportPort & { readonly dispatchMock: ReturnType<typeof vi.fn> } => {
  const dispatchMock = vi.fn(async () => response);
  return Object.freeze({
    transportKind: 'deterministic-fake' as const,
    dispatch: dispatchMock,
    dispatchMock,
  });
};

describe('Qwen response diagnostics and offline replay', () => {
  it('allows zero or all historical local files but rejects partial evidence presence', () => {
    expect([0, historicalLocalEvidence.length]).toContain(historicalLocalEvidencePresentCount);
  });

  it.runIf(historicalLocalEvidencePresent)(
    'hash-pins the nine historical local files and replays the latest response provider-free',
    async () => {
      for (const evidence of historicalLocalEvidence) {
        const bytes = await readFile(join(repositoryRoot, evidence.relativePath));
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(evidence.sha256);
      }
      for (const reportRelativePath of [
        '.local-data/banner-ai/qwen-response-diagnostic-report-banner-person-v1-20260716-envelope-correction-call-0003.json',
        '.local-data/banner-ai/qwen3-vl-four-fixture-benchmark.json',
      ]) {
        const historicalReport = QwenFourFixtureBenchmarkReportV1Schema.parse(
          JSON.parse(await readFile(join(repositoryRoot, reportRelativePath), 'utf8')),
        );
        expect(historicalReport).toMatchObject({
          reportVersion: 1,
          productionAdmissionAuthority: false,
          overallPass: false,
        });
        expect(historicalReport).not.toHaveProperty('providerProtocolWrapperSha256');
        expect(historicalReport).not.toHaveProperty('providerSuccessAuthority');
        expect(() =>
          QwenFourFixtureBenchmarkReportV1Schema.parse({
            ...historicalReport,
            providerSuccessAuthority: true,
          }),
        ).toThrow();
      }
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const replay = await replaySanitizedQwenResponseV1({
        responseFile:
          '.local-data/banner-ai/qwen-response-diagnostic-banner-person-v1-20260716-envelope-correction-call-0003.json',
      });
      expect(replay).toMatchObject({
        sourceRawFileSha256: '0cb1534ff14d471cff0bb5ebf74e9e0080c27cf1e2dd7d99bf8432774db64d2a',
        validationStatus: 'replay-rejected',
        failureReason: 'schema-invalid',
        diagnostic: {
          issueDigestSha256: 'da4a2caade6c45bdbcef3d478577886225bc57a61e31a81fa19089222b5acb83',
        },
        providerCallCount: 0,
        networkUsed: false,
        replayReproduced: true,
        providerSuccessAuthority: false,
        productionAdmissionAuthority: false,
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it('accepts the corrected person response with five parts and exactly matching five-part evidence', () => {
    const result = validateQwenProviderResponseBoundaryV1({
      response: responseFor(validEnvelope()),
      request: personRequest(),
    });
    expect(result.proposal.composition.kind).toBe('composition_proposal');
    if (result.proposal.composition.kind !== 'composition_proposal') {
      throw new TypeError('Expected the deterministic person composition proposal.');
    }
    expect(result.proposal.composition.parts).toHaveLength(5);
    expect(result.proposal.layerEvidence).toHaveLength(5);
    expect(result.proposal.layerEvidence.map((entry) => entry.partKey)).toEqual(
      result.proposal.composition.parts.map((part) => part.partKey),
    );
  });

  it.each([
    { name: 'seven characters', observationId: 'text001', accepted: false },
    { name: 'eight valid characters', observationId: 'text0001', accepted: true },
    { name: 'spaces', observationId: 'text 001', accepted: false },
    { name: 'forbidden punctuation', observationId: 'text.001', accepted: false },
    { name: 'numeric-only', observationId: '12345678', accepted: false },
  ] as const)('enforces the Qwen observation ID contract for $name', (testCase) => {
    const envelope = structuredClone(validEnvelope());
    mutateAssistantOutput(envelope, (output) => {
      const observations = output.textObservations as Record<string, unknown>[];
      observations[0]!.observationId = testCase.observationId;
    });
    const failure = boundaryFailureOrNull(responseFor(envelope));
    if (testCase.accepted) {
      expect(failure).toBeNull();
      return;
    }
    expect(failure).toMatchObject({
      reason: 'schema-invalid',
      diagnostic: { stage: 'ocr-observation-schema' },
    });
  });

  it('rejects duplicate observation IDs within one response', () => {
    const envelope = structuredClone(validEnvelope());
    mutateAssistantOutput(envelope, (output) => {
      const observations = output.textObservations as Record<string, unknown>[];
      observations[1]!.observationId = observations[0]!.observationId;
    });
    expect(captureBoundaryFailure(responseFor(envelope))).toMatchObject({
      reason: 'schema-invalid',
      diagnostic: { stage: 'ocr-observation-schema' },
    });
  });

  it('captures and exactly replays a pseudonymized numeric-only observation ID', async () => {
    const rawNumericObservationId = '9876543212345678';
    const secondRawNumericObservationId = '1234567898765432';
    const envelope = structuredClone(validEnvelope());
    mutateAssistantOutput(envelope, (output) => {
      const observations = output.textObservations as Record<string, unknown>[];
      observations[0]!.observationId = rawNumericObservationId;
      observations[1]!.observationId = secondRawNumericObservationId;
      observations[2]!.observationId = rawNumericObservationId;
    });
    const response = responseFor(envelope);
    const failure = captureBoundaryFailure(response);
    expect(failure).toMatchObject({
      reason: 'schema-invalid',
      diagnostic: { stage: 'ocr-observation-schema' },
    });
    const paths = diagnosticPaths('numeric-only-observation-0001');
    const reservations = await reserveQwenDiagnosticArtifactFilesV1(paths);
    await captureSanitizedQwenResponseV1({
      reservations,
      capturedAtMs: fixedNowMs,
      fixtureId: 'banner-person-v1',
      response,
      failure,
    });
    const artifactText = await readFile(
      join(repositoryRoot, paths.responseArtifactRelativePath),
      'utf8',
    );
    expect(artifactText).not.toContain(rawNumericObservationId);
    expect(artifactText).not.toContain(secondRawNumericObservationId);
    const artifact = JSON.parse(artifactText) as Record<string, unknown>;
    const payload = artifact.payload as Record<string, unknown>;
    const projectedResponse = payload.response as Record<string, unknown>;
    const projectedBody = projectedResponse.body as Record<string, unknown>;
    const projectedEnvelope = JSON.parse(String(projectedBody.canonicalBodyProjection)) as Record<
      string,
      unknown
    >;
    const projectedChoices = projectedEnvelope.choices as Record<string, unknown>[];
    const projectedMessage = projectedChoices[0]!.message as Record<string, unknown>;
    const projectedOutput = JSON.parse(String(projectedMessage.content)) as Record<string, unknown>;
    const projectedObservations = projectedOutput.textObservations as Record<string, unknown>[];
    const projectedIds = projectedObservations
      .slice(0, 3)
      .map((observation) => String(observation.observationId));
    expect(projectedIds[0]).toMatch(/^[0-9]{32}$/u);
    expect(projectedIds[1]).toMatch(/^[0-9]{32}$/u);
    expect(projectedIds[0]).not.toBe(projectedIds[1]);
    expect(projectedIds[2]).toBe(projectedIds[0]);
    const replay = await replaySanitizedQwenResponseV1({
      responseFile: paths.responseArtifactRelativePath,
    });
    expect(replay).toMatchObject({
      validationStatus: 'replay-rejected',
      failureReason: failure.reason,
      diagnostic: {
        stage: failure.diagnostic.stage,
        issueDigestSha256: failure.diagnostic.issueDigestSha256,
      },
      replayReproduced: true,
      providerCallCount: 0,
      networkUsed: false,
      providerSuccessAuthority: false,
      productionAdmissionAuthority: false,
    });
    await abortQwenDiagnosticArtifactReservationsV1(reservations);
  });

  it.each([
    {
      name: 'six composition parts',
      mutate(output: Record<string, unknown>): void {
        const composition = output.composition as Record<string, unknown>;
        const parts = composition.parts as Record<string, unknown>[];
        const sixth = structuredClone(parts[0]!);
        sixth.partKey = 'layer_1_6';
        composition.parts = [...parts, sixth];
      },
    },
    {
      name: 'six evidence entries',
      mutate(output: Record<string, unknown>): void {
        const evidence = output.layerEvidence as Record<string, unknown>[];
        const sixth = structuredClone(evidence[0]!);
        sixth.partKey = 'layer_1_6';
        output.layerEvidence = [...evidence, sixth];
      },
    },
    {
      name: 'missing evidence',
      mutate(output: Record<string, unknown>): void {
        const evidence = output.layerEvidence as Record<string, unknown>[];
        output.layerEvidence = evidence.slice(0, -1);
      },
    },
    {
      name: 'duplicate evidence for one part without exceeding five entries',
      mutate(output: Record<string, unknown>): void {
        const evidence = output.layerEvidence as Record<string, unknown>[];
        evidence[1]!.partKey = evidence[0]!.partKey;
      },
    },
    {
      name: 'foreign part evidence reference',
      mutate(output: Record<string, unknown>): void {
        const evidence = output.layerEvidence as Record<string, unknown>[];
        evidence[2]!.partKey = 'foreign_1';
      },
    },
    {
      name: 'reordered evidence',
      mutate(output: Record<string, unknown>): void {
        const evidence = output.layerEvidence as Record<string, unknown>[];
        [evidence[0], evidence[1]] = [evidence[1]!, evidence[0]!];
      },
    },
  ] as const)('rejects $name at the layer schema boundary', (testCase) => {
    const envelope = structuredClone(validEnvelope());
    mutateAssistantOutput(envelope, testCase.mutate);
    expect(captureBoundaryFailure(responseFor(envelope))).toMatchObject({
      reason: 'schema-invalid',
      diagnostic: { stage: 'layer-schema' },
    });
  });

  it('rejects an unknown assistant scene field', () => {
    const envelope = structuredClone(validEnvelope());
    mutateAssistantOutput(envelope, (output) => {
      output.unknownSceneField = true;
    });
    expect(captureBoundaryFailure(responseFor(envelope))).toMatchObject({
      reason: 'schema-invalid',
      diagnostic: { stage: 'unknown-field-rejection' },
    });
  });

  it.each([
    {
      name: 'HTTP envelope',
      expectedReason: 'http-error',
      expectedStage: 'http-envelope',
      create: () => responseFor('<html>failure</html>', 503),
    },
    {
      name: 'provider error envelope',
      expectedReason: 'provider-error',
      expectedStage: 'provider-error-envelope',
      create: () =>
        responseFor(
          {
            error: {
              message: 'sanitized provider failure',
              type: 'invalid_request_error',
              param: null,
              code: 'InvalidParameter',
            },
          },
          400,
        ),
    },
    {
      name: 'usage accounting',
      expectedReason: 'schema-invalid',
      expectedStage: 'usage-accounting',
      create: () => {
        const envelope = structuredClone(validEnvelope());
        (envelope.usage as Record<string, unknown>).total_tokens = 3_888;
        return responseFor(envelope);
      },
    },
    {
      name: 'model identity',
      expectedReason: 'unexpected-model',
      expectedStage: 'model-identity',
      create: () => responseFor({ ...validEnvelope(), model: 'qwen3.6-flash' }),
    },
    {
      name: 'choice count',
      expectedReason: 'schema-invalid',
      expectedStage: 'choice-count',
      create: () => responseFor({ ...validEnvelope(), choices: [] }),
    },
    {
      name: 'finish reason',
      expectedReason: 'unexpected-finish',
      expectedStage: 'finish-reason',
      create: () => {
        const envelope = structuredClone(validEnvelope());
        (envelope.choices as Record<string, unknown>[])[0]!.finish_reason = 'length';
        return responseFor(envelope);
      },
    },
    {
      name: 'assistant role and content',
      expectedReason: 'schema-invalid',
      expectedStage: 'assistant-role-content',
      create: () => {
        const envelope = structuredClone(validEnvelope());
        delete (
          (envelope.choices as Record<string, unknown>[])[0]!.message as Record<string, unknown>
        ).content;
        return responseFor(envelope);
      },
    },
    {
      name: 'assistant JSON syntax',
      expectedReason: 'malformed-json',
      expectedStage: 'assistant-json-syntax',
      create: () => {
        const envelope = structuredClone(validEnvelope());
        (
          (envelope.choices as Record<string, unknown>[])[0]!.message as Record<string, unknown>
        ).content = '{';
        return responseFor(envelope);
      },
    },
    {
      name: 'top-level scene schema',
      expectedReason: 'schema-invalid',
      expectedStage: 'scene-top-level-schema',
      create: () => {
        const envelope = structuredClone(validEnvelope());
        mutateAssistantOutput(envelope, (output) => {
          output.outputVersion = 2;
        });
        return responseFor(envelope);
      },
    },
    {
      name: 'source identity',
      expectedReason: 'identity-mismatch',
      expectedStage: 'source-identity',
      create: () => {
        const envelope = structuredClone(validEnvelope());
        mutateAssistantOutput(envelope, (output) => {
          (output.composition as Record<string, unknown>).sourceAssetSha256 = 'f'.repeat(64);
        });
        return responseFor(envelope);
      },
    },
    {
      name: 'layer schema',
      expectedReason: 'schema-invalid',
      expectedStage: 'layer-schema',
      create: () => {
        const envelope = structuredClone(validEnvelope());
        mutateAssistantOutput(envelope, (output) => {
          (output.composition as Record<string, unknown>).parts = [];
          output.layerEvidence = [];
        });
        return responseFor(envelope);
      },
    },
    {
      name: 'OCR observation schema',
      expectedReason: 'schema-invalid',
      expectedStage: 'ocr-observation-schema',
      create: () => {
        const envelope = structuredClone(validEnvelope());
        mutateAssistantOutput(envelope, (output) => {
          (output.ocrCompletion as Record<string, unknown>).observationCount = 99;
        });
        return responseFor(envelope);
      },
    },
    {
      name: 'bounding-box schema',
      expectedReason: 'schema-invalid',
      expectedStage: 'bbox-schema',
      create: () => {
        const envelope = structuredClone(validEnvelope());
        mutateAssistantOutput(envelope, (output) => {
          const composition = output.composition as Record<string, unknown>;
          const parts = composition.parts as Record<string, unknown>[];
          (parts[0]!.bounds as Record<string, unknown>).widthBps = 0;
        });
        return responseFor(envelope);
      },
    },
    {
      name: 'unknown-field rejection',
      expectedReason: 'schema-invalid',
      expectedStage: 'unknown-field-rejection',
      create: () => responseFor({ ...validEnvelope(), foreign_field: 'discard-this-value' }),
    },
    {
      name: 'request-relative identity',
      expectedReason: 'identity-mismatch',
      expectedStage: 'request-relative-identity',
      create: () => {
        const envelope = structuredClone(validEnvelope());
        mutateAssistantOutput(envelope, (output) => {
          output.ocrCompletion = { kind: 'no-visible-text-observed', observationCount: 0 };
          output.textObservations = [];
        });
        return responseFor(envelope);
      },
    },
  ] as const)('classifies $name without rejected values or validator messages', (testCase) => {
    const failure = captureBoundaryFailure(testCase.create());
    expect(failure.reason).toBe(testCase.expectedReason);
    expect(failure.diagnostic.stage).toBe(testCase.expectedStage);
    expect(failure.diagnostic.totalIssueCount).toBeGreaterThan(0);
    expect(failure.diagnostic.issueDigestSha256).toMatch(/^[0-9a-f]{64}$/u);
    const diagnosticText = JSON.stringify(failure.diagnostic);
    expect(diagnosticText).not.toContain('discard-this-value');
    expect(diagnosticText).not.toMatch(/"message"\s*:|base64|Bearer|DASHSCOPE/iu);
  });

  it.each([
    { key: 'reasoning_content', value: '' },
    { key: 'reasoning_content', value: null },
    { key: 'refusal', value: null },
    { key: 'tool_calls', value: [] },
    { key: 'tool_calls', value: null },
    { key: 'function_call', value: null },
    { key: 'audio', value: null },
  ] as const)('accepts inert assistant message metadata: $key', ({ key, value }) => {
    const envelope = structuredClone(validEnvelope());
    const message = (envelope.choices as Record<string, unknown>[])[0]!.message as Record<
      string,
      unknown
    >;
    message[key] = value;
    expect(boundaryFailureOrNull(responseFor(envelope))).toBeNull();
  });

  it('accepts an assistant message containing exactly role and content', () => {
    const envelope = structuredClone(validEnvelope());
    const message = (envelope.choices as Record<string, unknown>[])[0]!.message as Record<
      string,
      unknown
    >;
    delete message.reasoning_content;
    delete message.refusal;
    delete message.tool_calls;
    delete message.function_call;
    delete message.audio;
    const result = validateQwenProviderResponseBoundaryV1({
      response: responseFor(envelope),
      request: personRequest(),
    });
    expect(result.proposal).toMatchObject({ decisionAuthority: 'proposal-requires-user-review' });
    expect(Object.keys(result.envelope.choices[0]!.message)).toEqual(['role', 'content']);
    expect(result.proposal).not.toHaveProperty('reasoning_content');
    expect(result.proposal).not.toHaveProperty('refusal');
    expect(result.proposal).not.toHaveProperty('tool_calls');
    expect(result.proposal).not.toHaveProperty('function_call');
    expect(result.proposal).not.toHaveProperty('audio');
  });

  it('keeps permitted inert metadata envelope-only and still validates scene content strictly', () => {
    const envelope = structuredClone(validEnvelope());
    const message = (envelope.choices as Record<string, unknown>[])[0]!.message as Record<
      string,
      unknown
    >;
    message.reasoning_content = '';
    message.refusal = null;
    message.tool_calls = [];
    message.function_call = null;
    message.audio = null;
    const accepted = validateQwenProviderResponseBoundaryV1({
      response: responseFor(envelope),
      request: personRequest(),
    });
    expect(accepted.proposal).toMatchObject({ decisionAuthority: 'proposal-requires-user-review' });
    for (const key of ['reasoning_content', 'refusal', 'tool_calls', 'function_call', 'audio']) {
      expect(accepted.proposal).not.toHaveProperty(key);
    }

    const malformed = structuredClone(envelope);
    (malformed.choices as Record<string, unknown>[])[0]!.message = {
      ...message,
      content: '{',
    };
    expect(captureBoundaryFailure(responseFor(malformed)).diagnostic).toMatchObject({
      stage: 'assistant-json-syntax',
    });

    const invalidScene = structuredClone(envelope);
    mutateAssistantOutput(invalidScene, (output) => {
      output.outputVersion = 2;
    });
    expect(captureBoundaryFailure(responseFor(invalidScene)).diagnostic).toMatchObject({
      stage: 'scene-top-level-schema',
    });
  });

  it('rejects metadata-shaped scene properties as strict scene unknown fields', () => {
    const envelope = structuredClone(validEnvelope());
    mutateAssistantOutput(envelope, (output) => {
      output.reasoning_content = 'scene-property-not-envelope-metadata';
    });
    const failure = captureBoundaryFailure(responseFor(envelope));
    expect(failure.diagnostic).toMatchObject({ stage: 'unknown-field-rejection' });
    expect(failure.diagnostic.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '',
          classification: 'unknown-field',
          validatorIssueCode: 'unknown-fields',
        }),
      ]),
    );
    expect(JSON.stringify(failure.diagnostic)).not.toContain(
      'scene-property-not-envelope-metadata',
    );
  });

  it('classifies active metadata before malformed assistant content', () => {
    const envelope = structuredClone(validEnvelope());
    const message = (envelope.choices as Record<string, unknown>[])[0]!.message as Record<
      string,
      unknown
    >;
    message.tool_calls = [{ id: 'raw-active-call' }];
    message.content = '{';
    const failure = captureBoundaryFailure(responseFor(envelope));
    expect(failure.diagnostic).toMatchObject({ stage: 'assistant-role-content' });
    expect(failure.diagnostic.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/choices/0/message/tool_calls',
          classification: 'message-metadata',
        }),
      ]),
    );
    expect(failure.diagnostic.stage).not.toBe('assistant-json-syntax');
    expect(JSON.stringify(failure.diagnostic)).not.toMatch(/raw-active-call/iu);
  });

  it.each([
    { key: 'reasoning_content', value: 'hidden reasoning' },
    { key: 'refusal', value: 'refused' },
    { key: 'tool_calls', value: [{ id: 'call-1' }] },
    { key: 'function_call', value: {} },
    { key: 'audio', value: {} },
  ] as const)(
    'rejects active assistant metadata as a documented category: $key',
    ({ key, value }) => {
      const envelope = structuredClone(validEnvelope());
      const message = (envelope.choices as Record<string, unknown>[])[0]!.message as Record<
        string,
        unknown
      >;
      message[key] = value;
      const failure = captureBoundaryFailure(responseFor(envelope));
      expect(failure.diagnostic.stage).toBe('assistant-role-content');
      expect(failure.diagnostic.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: `/choices/0/message/${key}`,
            classification: 'message-metadata',
          }),
        ]),
      );
      expect(JSON.stringify(failure.diagnostic)).not.toContain('hidden reasoning');
    },
  );

  it('keeps arbitrary assistant message keys distinct from documented metadata rejection', () => {
    const envelope = structuredClone(validEnvelope());
    const message = (envelope.choices as Record<string, unknown>[])[0]!.message as Record<
      string,
      unknown
    >;
    message.unapproved_message_key = 'discard-this-value';
    const failure = captureBoundaryFailure(responseFor(envelope));
    expect(failure.diagnostic.stage).toBe('unknown-field-rejection');
    expect(failure.diagnostic.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/choices/0/message',
          classification: 'unknown-field',
          validatorIssueCode: 'unknown-fields',
          actualUnknownFieldNameCount: 1,
          retainedUnknownFieldNameCount: 1,
          truncatedUnknownFieldNameCount: 0,
        }),
      ]),
    );
    expect(JSON.stringify(failure.diagnostic)).not.toContain('unapproved_message_key');
  });

  it('replays arbitrary assistant message unknown-field evidence unchanged', async () => {
    const envelope = structuredClone(validEnvelope());
    const message = (envelope.choices as Record<string, unknown>[])[0]!.message as Record<
      string,
      unknown
    >;
    message.unapproved_message_key = 'raw-unknown-message-value';
    const response = responseFor(envelope);
    const failure = captureBoundaryFailure(response);
    const paths = diagnosticPaths('metadata-replay-unknown-0001');
    const reservations = await reserveQwenDiagnosticArtifactFilesV1(paths);
    await captureSanitizedQwenResponseV1({
      reservations,
      capturedAtMs: fixedNowMs,
      fixtureId: 'banner-person-v1',
      response,
      failure,
    });
    const replay = await replaySanitizedQwenResponseV1({
      responseFile: paths.responseArtifactRelativePath,
    });
    expect(replay).toMatchObject({
      providerCallCount: 0,
      networkUsed: false,
      replayReproduced: true,
      validationStatus: 'replay-rejected',
      failureReason: 'schema-invalid',
      diagnostic: {
        stage: failure.diagnostic.stage,
        issueDigestSha256: failure.diagnostic.issueDigestSha256,
      },
    });
    await abortQwenDiagnosticArtifactReservationsV1(reservations);
  });

  it('replays inert and rejected message metadata without provider access', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const cases = [
      { token: 'metadata-replay-exact-0001', key: null, value: null, rejected: false },
      {
        token: 'metadata-replay-reasoning-0001',
        key: 'reasoning_content',
        value: '',
        rejected: false,
      },
      {
        token: 'metadata-replay-reasoning-null-0001',
        key: 'reasoning_content',
        value: null,
        rejected: false,
      },
      { token: 'metadata-replay-refusal-0001', key: 'refusal', value: null, rejected: false },
      { token: 'metadata-replay-tools-empty-0001', key: 'tool_calls', value: [], rejected: false },
      { token: 'metadata-replay-tools-null-0001', key: 'tool_calls', value: null, rejected: false },
      {
        token: 'metadata-replay-function-null-0001',
        key: 'function_call',
        value: null,
        rejected: false,
      },
      { token: 'metadata-replay-audio-null-0001', key: 'audio', value: null, rejected: false },
      {
        token: 'metadata-replay-reasoning-active-0001',
        key: 'reasoning_content',
        value: 'raw reasoning',
        rejected: true,
      },
      {
        token: 'metadata-replay-refusal-active-0001',
        key: 'refusal',
        value: 'raw refusal',
        rejected: true,
      },
      {
        token: 'metadata-replay-tools-active-0001',
        key: 'tool_calls',
        value: [{ id: 'raw tool call' }],
        rejected: true,
      },
      {
        token: 'metadata-replay-function-active-0001',
        key: 'function_call',
        value: { name: 'raw function' },
        rejected: true,
      },
      {
        token: 'metadata-replay-audio-active-0001',
        key: 'audio',
        value: { data: 'raw audio' },
        rejected: true,
      },
    ] as const;
    for (const testCase of cases) {
      const envelope = structuredClone(validEnvelope());
      const message = (envelope.choices as Record<string, unknown>[])[0]!.message as Record<
        string,
        unknown
      >;
      if (testCase.key === null) {
        delete message.reasoning_content;
        delete message.refusal;
        delete message.tool_calls;
        delete message.function_call;
        delete message.audio;
      } else {
        message[testCase.key] = testCase.value;
      }
      const response = responseFor(envelope);
      const failure = boundaryFailureOrNull(response);
      expect(Boolean(failure)).toBe(testCase.rejected);
      const paths = diagnosticPaths(testCase.token);
      const reservations = await reserveQwenDiagnosticArtifactFilesV1(paths);
      await captureSanitizedQwenResponseV1({
        reservations,
        capturedAtMs: fixedNowMs,
        fixtureId: 'banner-person-v1',
        response,
        failure,
      });
      const artifactText = await readFile(
        join(repositoryRoot, paths.responseArtifactRelativePath),
        'utf8',
      );
      if (testCase.rejected) {
        for (const rawMetadataString of [
          'raw reasoning',
          'raw refusal',
          'raw tool call',
          'raw function',
          'raw audio',
        ]) {
          expect(artifactText).not.toContain(rawMetadataString);
        }
      }
      const replay = await replaySanitizedQwenResponseV1({
        responseFile: paths.responseArtifactRelativePath,
      });
      expect(replay).toMatchObject({
        providerCallCount: 0,
        networkUsed: false,
        replayReproduced: true,
        productionAdmissionAuthority: false,
      });
      expect(replay.providerCallCount).toBe(0);
      if (failure === null) {
        expect(replay.validationStatus).toBe('replay-valid');
        expect(replay.diagnostic).toBeNull();
      } else {
        expect(replay).toMatchObject({
          validationStatus: 'replay-rejected',
          failureReason: failure.reason,
          diagnostic: {
            stage: failure.diagnostic.stage,
            issueDigestSha256: failure.diagnostic.issueDigestSha256,
          },
        });
      }
      await abortQwenDiagnosticArtifactReservationsV1(reservations);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sorts multiple issues and unknown names into one stable digest', () => {
    const create = (reverse: boolean) => {
      const envelope = structuredClone(validEnvelope());
      mutateAssistantOutput(envelope, (output) => {
        output.outputVersion = 2;
        if (reverse) {
          output.zeta = 'secret-zeta';
          output.alpha = 'secret-alpha';
        } else {
          output.alpha = 'secret-alpha';
          output.zeta = 'secret-zeta';
        }
      });
      return captureBoundaryFailure(responseFor(envelope));
    };
    const first = create(false).diagnostic;
    const second = create(true).diagnostic;
    expect(first).toEqual(second);
    expect(first.totalIssueCount).toBe(2);
    expect(first.issues.map((issue) => issue.path)).toEqual(['', '/outputVersion']);
    expect(first.issues[0]).toMatchObject({
      validatorIssueCode: 'unknown-fields',
      unknownFieldNames: ['alpha', 'zeta'].map(pseudonymizeQwenDiagnosticFieldNameV1).toSorted(),
    });
    expect(JSON.stringify(first)).not.toMatch(/alpha|zeta|secret-alpha|secret-zeta/iu);
  });

  it('uses deterministic RFC 6901 pointers and code-unit ordering', () => {
    const root = createSyntheticQwenValidationDiagnosticV1({
      stage: 'http-envelope',
      path: [],
      validatorIssueCode: 'custom',
      classification: 'constraint',
    });
    const escaped = createSyntheticQwenValidationDiagnosticV1({
      stage: 'scene-top-level-schema',
      path: ['a/b~c'],
      validatorIssueCode: 'custom',
      classification: 'constraint',
    });
    expect(root.issues[0]!.path).toBe('');
    expect(escaped.issues[0]!.path).toBe('/a~1b~0c');

    const envelope = structuredClone(validEnvelope());
    mutateAssistantOutput(envelope, (output) => {
      for (const key of [
        'a',
        '_',
        'A',
        '.',
        '-',
        ...Array.from({ length: 60 }, (_, i) => `x${i}`),
      ]) {
        output[key] = 'discarded';
      }
    });
    const issue = captureBoundaryFailure(responseFor(envelope)).diagnostic.issues.find(
      (candidate) => candidate.validatorIssueCode === 'unknown-fields',
    );
    expect(issue).toMatchObject({
      path: '',
      actualUnknownFieldNameCount: 65,
      retainedUnknownFieldNameCount: 64,
      truncatedUnknownFieldNameCount: 1,
    });
    const expectedNames = [
      'a',
      '_',
      'A',
      '.',
      '-',
      ...Array.from({ length: 60 }, (_, i) => `x${i}`),
    ]
      .map(pseudonymizeQwenDiagnosticFieldNameV1)
      .toSorted();
    expect(issue?.unknownFieldNames).toEqual(expectedNames.slice(0, 64));
    expect(issue?.unknownFieldNames).toEqual(
      issue?.unknownFieldNames?.toSorted((left, right) =>
        left < right ? -1 : left > right ? 1 : 0,
      ),
    );
    expect(issue?.unknownFieldNames?.every((name) => /^qdf-[0-9a-f]{64}$/u.test(name))).toBe(true);
  });

  it('maps missing, primitive, literal, union, format, range, and size issues explicitly', () => {
    const missingModel = structuredClone(validEnvelope());
    delete missingModel.model;
    expect(captureBoundaryFailure(responseFor(missingModel)).diagnostic).toMatchObject({
      stage: 'model-identity',
      issues: [
        expect.objectContaining({
          path: '/model',
          validatorIssueCode: 'missing-required',
          classification: 'missing-required',
          expectedType: 'string',
          receivedType: 'undefined',
        }),
      ],
    });

    const wrongModelType = { ...validEnvelope(), model: 42 };
    expect(captureBoundaryFailure(responseFor(wrongModelType)).diagnostic).toMatchObject({
      stage: 'model-identity',
      issues: [
        expect.objectContaining({ classification: 'type-mismatch', receivedType: 'number' }),
      ],
    });

    const literalEnvelope = structuredClone(validEnvelope());
    mutateAssistantOutput(literalEnvelope, (output) => {
      output.outputVersion = 2;
    });
    expect(captureBoundaryFailure(responseFor(literalEnvelope)).diagnostic.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/outputVersion',
          classification: 'literal-mismatch',
          expectedType: 'literal',
        }),
      ]),
    );

    const unionEnvelope = structuredClone(validEnvelope());
    mutateAssistantOutput(unionEnvelope, (output) => {
      (output.composition as Record<string, unknown>).kind = 'foreign-kind';
    });
    expect(captureBoundaryFailure(responseFor(unionEnvelope)).diagnostic.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/composition/kind',
          validatorIssueCode: 'invalid-union',
          classification: 'union-mismatch',
          expectedType: 'union',
          receivedType: 'string',
        }),
      ]),
    );

    const formatEnvelope = structuredClone(validEnvelope());
    mutateAssistantOutput(formatEnvelope, (output) => {
      (output.composition as Record<string, unknown>).sourceAssetSha256 = 'bad-sha';
    });
    expect(captureBoundaryFailure(responseFor(formatEnvelope)).diagnostic.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: '/composition/sourceAssetSha256',
          validatorIssueCode: 'invalid-format',
          classification: 'format-constraint',
        }),
      ]),
    );

    const rangeEnvelope = structuredClone(validEnvelope());
    mutateAssistantOutput(rangeEnvelope, (output) => {
      const parts = (output.composition as Record<string, unknown>).parts as Record<
        string,
        unknown
      >[];
      (parts[0]!.bounds as Record<string, unknown>).xBps = -1;
    });
    expect(captureBoundaryFailure(responseFor(rangeEnvelope)).diagnostic.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          validatorIssueCode: 'too-small',
          classification: 'range-constraint',
        }),
      ]),
    );

    const sizeEnvelope = structuredClone(validEnvelope());
    mutateAssistantOutput(sizeEnvelope, (output) => {
      const evidence = output.layerEvidence as unknown[];
      output.layerEvidence = [...evidence, structuredClone(evidence[0])];
    });
    expect(captureBoundaryFailure(responseFor(sizeEnvelope)).diagnostic.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          validatorIssueCode: 'too-big',
          classification: 'size-constraint',
        }),
      ]),
    );
  });

  it('preserves accepted provider-error reason and usage-accounting order', () => {
    const malformedError = { error: { message: 42, type: null, code: {} } };

    const non2xxMalformed = captureBoundaryFailure(responseFor(malformedError, 400));
    expect(non2xxMalformed).toMatchObject({
      reason: 'http-error',
      usage: null,
      diagnostic: { stage: 'provider-error-envelope' },
    });
    expect(non2xxMalformed.diagnostic.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ classification: 'type-mismatch' })]),
    );

    const successMalformedMissingUsage = captureBoundaryFailure(responseFor(malformedError));
    expect(successMalformedMissingUsage).toMatchObject({
      reason: 'missing-usage',
      usage: null,
      diagnostic: { stage: 'usage-accounting' },
    });

    const validUsage = validEnvelope().usage;
    const successMalformedCompleteUsage = captureBoundaryFailure(
      responseFor({ ...malformedError, usage: validUsage }),
    );
    expect(successMalformedCompleteUsage).toMatchObject({
      reason: 'schema-invalid',
      usage: validUsage,
      diagnostic: { stage: 'provider-error-envelope' },
    });

    const strictProviderError = captureBoundaryFailure(
      responseFor({
        error: {
          message: 'fixed provider failure',
          type: 'invalid_request_error',
          param: null,
          code: 'InvalidParameter',
        },
      }),
    );
    expect(strictProviderError).toMatchObject({
      reason: 'provider-error',
      usage: null,
      diagnostic: { stage: 'provider-error-envelope' },
    });
  });

  it('preserves indeterminate versus complete adapter accounting for provider-error shapes', async () => {
    const validUsage = validEnvelope().usage;
    const malformedError = { error: { message: 42, type: null, code: {} } };
    const cases = [
      {
        token: 'accounting-http-malformed-0001',
        response: responseFor(malformedError, 400),
        reason: 'http-error',
        stage: 'provider-error-envelope',
        accountingStatus: 'indeterminate',
      },
      {
        token: 'accounting-success-missing-0001',
        response: responseFor(malformedError),
        reason: 'missing-usage',
        stage: 'usage-accounting',
        accountingStatus: 'indeterminate',
      },
      {
        token: 'accounting-success-complete-0001',
        response: responseFor({ ...malformedError, usage: validUsage }),
        reason: 'schema-invalid',
        stage: 'provider-error-envelope',
        accountingStatus: 'complete',
      },
      {
        token: 'accounting-strict-provider-0001',
        response: responseFor({
          error: {
            message: 'fixed provider failure',
            type: 'invalid_request_error',
            param: null,
            code: 'InvalidParameter',
          },
        }),
        reason: 'provider-error',
        stage: 'provider-error-envelope',
        accountingStatus: 'indeterminate',
      },
    ] as const;
    for (const testCase of cases) {
      const packet = livePacket(testCase.token);
      const { diagnosticCapture: _diagnosticCapture, ...packetWithoutDiagnosticBase } = packet;
      void _diagnosticCapture;
      const packetWithoutDiagnostic = {
        ...packetWithoutDiagnosticBase,
        mode: 'deterministic-fake' as const,
        purpose: 'one-capped-four-fixture-sequential-zero-retry-benchmark' as const,
      };
      const authorization = mintQwenBenchmarkExecutionAuthorization(packetWithoutDiagnostic);
      const transport = fakeLikeTransport(testCase.response);
      let captured: QwenSceneAnalysisError | null = null;
      try {
        await createQwen3VlSceneAnalysisAdapter({ transport, clock: fixedClock() }).analyze({
          ...(await firstFixtureInput()),
          authorization,
          secret: null,
        });
      } catch (error) {
        if (error instanceof QwenSceneAnalysisError) captured = error;
        else throw error;
      }
      expect(captured).toMatchObject({
        reason: testCase.reason,
        diagnostic: { stage: testCase.stage },
        accounting: {
          status: testCase.accountingStatus,
          usage: testCase.accountingStatus === 'complete' ? validUsage : null,
          calculatedListCost: testCase.accountingStatus === 'complete' ? expect.any(Object) : null,
        },
      });
      expect(transport.dispatchMock).toHaveBeenCalledTimes(1);
    }
  });

  it('records received primitive/container types only when known', () => {
    const envelope = structuredClone(validEnvelope());
    (
      (envelope.choices as Record<string, unknown>[])[0]!.message as Record<string, unknown>
    ).content = 42;
    const failure = captureBoundaryFailure(responseFor(envelope));
    expect(failure.diagnostic).toMatchObject({
      stage: 'assistant-role-content',
      issues: [
        expect.objectContaining({
          path: '/choices/0/message/content',
          validatorIssueCode: 'invalid-type',
          classification: 'type-mismatch',
          expectedType: 'string',
          receivedType: 'number',
        }),
      ],
    });
  });

  it('requires an exact live opaque binding and scopes it to one person dispatch', async () => {
    const packet = livePacket('binding-scope-0001');
    const authorization = mintQwenBenchmarkExecutionAuthorization(packet);
    expect(authorization.diagnosticCapture).toMatchObject({
      fixtureId: 'banner-person-v1',
      providerCallsMaximum: 1,
      retryCount: 0,
      productionAdmissionAuthority: false,
    });
    expect(createQwenDryRunExecutionAuthorization({ nowMs: fixedNowMs }).diagnosticCapture).toBe(
      null,
    );
    expect(() =>
      mintQwenBenchmarkExecutionAuthorization({ ...packet, mode: 'deterministic-fake' }),
    ).toThrow();
    expect(() =>
      mintQwenBenchmarkExecutionAuthorization({
        ...packet,
        diagnosticCapture: { ...packet.diagnosticCapture, fixtureId: 'banner-product-v1' },
      }),
    ).toThrow();

    const transport = liveLikeTransport(responseFor(validEnvelope()));
    const adapter = createQwen3VlSceneAnalysisAdapter({ transport, clock: fixedClock() });
    const source = REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V2[1]!;
    const normalizedImageBytes = await readPendingCorpusPackageFileV2(source.normalized.reference);
    await expect(
      adapter.analyze({
        request: createCanonicalQwenBenchmarkRequestV1('banner-product-v1'),
        normalizedImageBytes,
        context: {
          deadlineAtMs: EpochMillisecondsSchema.parse(fixedNowMs + 60_000),
          externalIdempotencyKey: null,
          cancellation: { cancelled: false, throwIfCancelled(): void {} },
        },
        authorization,
        secret: 'unit-test-secret-not-a-provider-key',
      }),
    ).rejects.toMatchObject({ reason: 'authorization-missing' });
    expect(transport.dispatchMock).not.toHaveBeenCalled();
  });

  it('rechecks live V4 freshness at dispatch time and rejects the issuance-age boundary before transport', async () => {
    for (const [ageMs, shouldDispatch] of [
      [59_999, true],
      [60_000, false],
      [60_001, false],
    ] as const) {
      const token = `dispatch-freshness-${ageMs}`;
      const packet = createQwenDiagnosticAuthorizationPacketV4({
        authorizationId: `qwen.live.${token}`,
        issuedAtMs: fixedNowMs,
        expiresAtMs: fixedNowMs + 599_000,
        gitSha: currentGitSha,
        manualRelease: createQwenManualReleaseBindingV1({
          releaseId: `qwen.release.${token}`,
          issuedAtMs: fixedNowMs,
          expiresAtMs: fixedNowMs + 600_000,
        }),
        ...diagnosticPaths(token),
      });
      const authorization = preflightQwenLiveExecutionAuthorization({
        packet,
        secretPresent: true,
        nowMs: fixedNowMs,
        currentGitSha,
      });
      await reserveQwenDiagnosticArtifactsForAuthorizationV1(authorization);
      let epochCalls = 0;
      const transport = liveLikeTransport(responseFor(validEnvelope()));
      const clock: QwenAdapterClockPort = Object.freeze({
        nowEpochMs: () => (epochCalls++ === 0 ? fixedNowMs : fixedNowMs + ageMs),
        nowMonotonicMs: () => 0,
      });
      try {
        const input = await firstFixtureInput();
        await createQwen3VlSceneAnalysisAdapter({ transport, clock }).analyze({
          ...input,
          context: {
            ...input.context,
            deadlineAtMs: EpochMillisecondsSchema.parse(fixedNowMs + 200_000),
          },
          authorization,
          secret: 'unit-test-secret-not-a-provider-key',
        });
      } catch {
        // The allowed case may fail later at response/scene validation; dispatch is the assertion.
      } finally {
        await releaseQwenDiagnosticArtifactsForAuthorizationV1(authorization);
      }
      expect(transport.dispatchMock).toHaveBeenCalledTimes(shouldDispatch ? 1 : 0);
    }
  });

  it('consumes a concrete deterministic capability once and rejects replay', async () => {
    const packet = livePacket('capability-replay-0001');
    const { diagnosticCapture: _diagnosticCapture, ...fakePacketBase } = packet;
    void _diagnosticCapture;
    const authorization = mintQwenBenchmarkExecutionAuthorization({
      ...fakePacketBase,
      mode: 'deterministic-fake' as const,
      purpose: 'one-capped-four-fixture-sequential-zero-retry-benchmark' as const,
    });
    const concreteTransport = createDeterministicQwenTransport([
      {
        kind: 'success',
        output: createDeterministicOracleMatchingQwenOutputV1('banner-person-v1'),
      },
    ]);
    let capturedRequest: QwenTransportRequest | undefined;
    const transport: QwenTransportPort = Object.freeze({
      transportKind: 'deterministic-fake' as const,
      dispatch: async (request: QwenTransportRequest) => {
        capturedRequest = request;
        return concreteTransport.dispatch(request);
      },
    });
    await createQwen3VlSceneAnalysisAdapter({ transport, clock: fixedClock() }).analyze({
      ...(await firstFixtureInput()),
      authorization,
      secret: null,
    });
    expect(capturedRequest).toBeDefined();
    await expect(concreteTransport.dispatch(capturedRequest!)).rejects.toThrow();
    expect(concreteTransport.getCallCount()).toBe(1);
  });

  it('builds a strict diagnostic V3 packet from only bounded identity, time, and paths', () => {
    const packet = createQwenDiagnosticAuthorizationPacketV3({
      authorizationId: 'qwen.diag.builder.0001',
      issuedAtMs: fixedNowMs,
      expiresAtMs: fixedNowMs + 599_000,
      ...diagnosticPaths('builder-0001'),
    });
    expect(packet).toMatchObject({
      authorizationVersion: 3,
      purpose: 'one-capped-single-fixture-diagnostic-response-capture',
      mode: 'live-provider',
      benchmarkCapsSha256: QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256,
      diagnosticCapture: {
        diagnosticVersion: 2,
        perCallTimeoutMs: 120_000,
        totalWallTimeMs: 150_000,
        totalCalculatedListCostMaximumMicroUsd: '50000',
        productionAdmissionAuthority: false,
        webRouteActivated: false,
      },
    });
    expect(() =>
      createQwenDiagnosticAuthorizationPacketV4({
        authorizationId: 'qwen.diag.builder.0002',
        gitSha: currentGitSha,
        manualRelease: manualReleaseFor('builder-0002'),
        issuedAtMs: fixedNowMs + 1,
        expiresAtMs: fixedNowMs,
        ...diagnosticPaths('builder-0002'),
      }),
    ).toThrow();
  });

  it('accepts native 120000ms transport requests, rejects larger values, and keeps ordinary calls <=60000ms', async () => {
    const fetchImplementation = vi.fn(async () => new Response('{}', { status: 200 }));
    const native = createQwen3VlNativeFetchTransport({ fetchImplementation });
    const request = {
      endpoint: QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT,
      method: QWEN3_VL_ENDPOINT_METHOD,
      secret: 'unit-test-secret-not-a-provider-key',
      requestBodyText: '{}',
      signal: new AbortController().signal,
      mode: 'live-provider' as const,
      dispatchCapability: undefined as never,
    } as const;
    await expect(native.dispatch({ ...request, timeoutMs: 120_000 })).rejects.toThrow();
    await expect(native.dispatch({ ...request, timeoutMs: 120_001 })).rejects.toThrow();
    expect(fetchImplementation).toHaveBeenCalledTimes(0);

    const ordinaryPacket = livePacket('ordinary-timeout-0001');
    const { diagnosticCapture: _diagnostic, ...ordinaryBase } = ordinaryPacket;
    void _diagnostic;
    const ordinaryAuthorization = mintQwenBenchmarkExecutionAuthorization({
      ...ordinaryBase,
      mode: 'deterministic-fake' as const,
      authorizationVersion: 4 as const,
      purpose: 'one-capped-four-fixture-sequential-zero-retry-benchmark' as const,
    });
    const ordinaryTransport = fakeLikeTransport(responseFor(validEnvelope()));
    await createQwen3VlSceneAnalysisAdapter({
      transport: ordinaryTransport,
      clock: fixedClock(),
    }).analyze({
      ...(await firstFixtureInput()),
      authorization: ordinaryAuthorization,
      secret: null,
    });
    expect(ordinaryTransport.dispatchMock.mock.calls[0]?.[0].timeoutMs).toBeLessThanOrEqual(60_000);
  });

  it('preflights active V3 120000/150000 caps and rejects historical diagnostic authority', () => {
    const active = createQwenDiagnosticAuthorizationPacketV4({
      authorizationId: 'qwen.diag.preflight.0001',
      gitSha: currentGitSha,
      manualRelease: manualReleaseFor('preflight-v3-0001'),
      issuedAtMs: fixedNowMs - 1_000,
      expiresAtMs: fixedNowMs + 599_000,
      ...diagnosticPaths('preflight-v3-0001'),
    });
    const authorization = preflightQwenLiveExecutionAuthorization({
      packet: active,
      secretPresent: true,
      nowMs: fixedNowMs,
      currentGitSha: '45b3ceaf311008fb5c84cc8f8ea236d7846a20bf',
    });
    expect(authorization.diagnosticCapture).toMatchObject({
      perCallTimeoutMs: 120_000,
      totalWallTimeMs: 150_000,
    });

    const historical = structuredClone(
      createQwenDiagnosticAuthorizationPacketV3({
        authorizationId: 'qwen.diag.historical.0001',
        issuedAtMs: fixedNowMs - 1_000,
        expiresAtMs: fixedNowMs + 600_000,
        ...diagnosticPaths('preflight-v2-old-0001'),
      }),
    ) as Record<string, unknown>;
    historical.authorizationVersion = 2;
    historical.purpose = 'one-capped-four-fixture-sequential-zero-retry-benchmark';
    const historicalDiagnostic = historical.diagnosticCapture as Record<string, unknown>;
    historicalDiagnostic.diagnosticVersion = 1;
    delete historicalDiagnostic.perCallTimeoutMs;
    delete historicalDiagnostic.totalWallTimeMs;
    delete historicalDiagnostic.totalCalculatedListCostMaximumMicroUsd;
    delete historicalDiagnostic.diagnosticCapsSha256;
    delete historicalDiagnostic.webRouteActivated;
    expect(() =>
      preflightQwenLiveExecutionAuthorization({
        packet: historical,
        secretPresent: true,
        nowMs: fixedNowMs,
      }),
    ).toThrow();
  });

  it('rejects every non-active diagnostic cap mutation before authorization activation', () => {
    const packet = createQwenDiagnosticAuthorizationPacketV4({
      authorizationId: 'qwen.diag.cap-boundary.0001',
      gitSha: currentGitSha,
      manualRelease: manualReleaseFor('cap-boundary-0001'),
      issuedAtMs: fixedNowMs,
      expiresAtMs: fixedNowMs + 599_000,
      ...diagnosticPaths('cap-boundary-0001'),
    });
    for (const mutation of [
      { perCallTimeoutMs: 119_999 },
      { perCallTimeoutMs: 120_001 },
      { totalWallTimeMs: 149_999 },
      { totalWallTimeMs: 150_001 },
      { providerCallsMaximum: 2 },
      { retryCount: 1 },
      { totalCalculatedListCostMaximumMicroUsd: '49999' },
      { totalCalculatedListCostMaximumMicroUsd: '50001' },
    ]) {
      expect(() =>
        createQwenDiagnosticAuthorizationPacketV4({
          authorizationId: 'qwen.diag.cap-boundary.0002',
          gitSha: currentGitSha,
          manualRelease: manualReleaseFor(`cap-boundary-${Object.keys(mutation)[0]}`),
          issuedAtMs: fixedNowMs,
          expiresAtMs: fixedNowMs + 599_000,
          ...diagnosticPaths(`cap-boundary-${Object.keys(mutation)[0]}`),
        }),
      ).not.toThrow();
      const mutated = structuredClone(packet) as Record<string, unknown>;
      Object.assign(mutated.diagnosticCapture as Record<string, unknown>, mutation);
      expect(() => mintQwenBenchmarkExecutionAuthorization(mutated)).toThrow();
    }
  });

  it('uses strict raw elapsed diagnostic timeout boundaries and leaves late responses inert', async () => {
    for (const [elapsedMs, expectedReason] of [
      [119_999, null],
      [120_000, 'timeout'],
      [120_001, 'timeout'],
    ] as const) {
      const packet = livePacket(`timeout-boundary-${elapsedMs}`);
      const authorization = mintQwenBenchmarkExecutionAuthorization(packet);
      await reserveQwenDiagnosticArtifactsForAuthorizationV1(authorization);
      let monotonicCalls = 0;
      const clock: QwenAdapterClockPort = Object.freeze({
        nowEpochMs: () => fixedNowMs,
        nowMonotonicMs: () => (monotonicCalls++ === 0 ? 0 : elapsedMs),
      });
      const controllerSignals: AbortSignal[] = [];
      const transport: QwenTransportPort = Object.freeze({
        transportKind: 'native-fetch' as const,
        dispatch: vi.fn(async (request) => {
          controllerSignals.push(request.signal);
          return responseFor(validEnvelope());
        }),
      });
      const input = await firstFixtureInput();
      let captured: QwenSceneAnalysisError | null = null;
      try {
        await createQwen3VlSceneAnalysisAdapter({ transport, clock }).analyze({
          ...input,
          context: {
            ...input.context,
            deadlineAtMs: EpochMillisecondsSchema.parse(fixedNowMs + 120_000),
          },
          authorization,
          secret: 'unit-test-secret-not-a-provider-key',
        });
      } catch (error) {
        if (error instanceof QwenSceneAnalysisError) captured = error;
        else throw error;
      }
      if (expectedReason === null) {
        expect(captured).toBeNull();
      } else {
        expect(captured).toMatchObject({
          reason: expectedReason,
          accounting: { status: 'indeterminate', usage: null, calculatedListCost: null },
        });
        expect(controllerSignals[0]?.aborted).toBe(true);
        expect(captured?.diagnosticArtifact).toBeNull();
      }
      await releaseQwenDiagnosticArtifactsForAuthorizationV1(authorization);
    }
  });

  it('fires the injected timeout before an abort-ignoring late response and finalizes nothing', async () => {
    const packet = livePacket('manual-timeout-late-0001');
    const authorization = mintQwenBenchmarkExecutionAuthorization(packet);
    await reserveQwenDiagnosticArtifactsForAuthorizationV1(authorization);
    const timers = manualTimerPort();
    let dispatchStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      dispatchStarted = resolve;
    });
    let resolveLate!: (response: QwenTransportResponse) => void;
    const transport: QwenTransportPort = Object.freeze({
      transportKind: 'native-fetch' as const,
      dispatch: vi.fn(async (request) => {
        dispatchStarted();
        return new Promise<QwenTransportResponse>((resolve) => {
          resolveLate = () => resolve(responseFor(validEnvelope()));
          void request.signal;
        });
      }),
    });
    const input = await firstFixtureInput();
    const analysis = createQwen3VlSceneAnalysisAdapter({
      transport,
      clock: Object.freeze({ nowEpochMs: () => fixedNowMs, nowMonotonicMs: () => 0 }),
      timers,
    }).analyze({
      ...input,
      context: {
        ...input.context,
        deadlineAtMs: EpochMillisecondsSchema.parse(fixedNowMs + 120_000),
      },
      authorization,
      secret: 'unit-test-secret-not-a-provider-key',
    });
    await started;
    timers.fireTimeout();
    expect((transport.dispatch as ReturnType<typeof vi.fn>).mock.calls[0]![0].signal.aborted).toBe(
      true,
    );
    resolveLate(responseFor(validEnvelope()));
    await expect(analysis).rejects.toMatchObject({
      reason: 'timeout',
      accounting: { status: 'indeterminate', usage: null, calculatedListCost: null },
      diagnosticArtifact: null,
    });
    expect((transport.dispatch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
    await releaseQwenDiagnosticArtifactsForAuthorizationV1(authorization);
  });

  it('rejects a second V3 diagnostic invocation without dispatch or retry', async () => {
    const packet = livePacket('second-invocation-0001');
    const authorization = mintQwenBenchmarkExecutionAuthorization(packet);
    await reserveQwenDiagnosticArtifactsForAuthorizationV1(authorization);
    const transport = liveLikeTransport(responseFor(validEnvelope()));
    const adapter = createQwen3VlSceneAnalysisAdapter({ transport, clock: fixedClock() });
    const input = await firstFixtureInput();
    const requestInput = {
      ...input,
      context: {
        ...input.context,
        deadlineAtMs: EpochMillisecondsSchema.parse(fixedNowMs + 120_000),
      },
      authorization,
      secret: 'unit-test-secret-not-a-provider-key',
    };
    await adapter.analyze(requestInput);
    await expect(adapter.analyze(requestInput)).rejects.toMatchObject({
      reason: 'duplicate-invocation',
    });
    expect(transport.dispatchMock).toHaveBeenCalledTimes(1);
    expect(authorization.diagnosticCapture?.retryCount).toBe(0);
    await releaseQwenDiagnosticArtifactsForAuthorizationV1(authorization);
  });

  it('fails diagnostic runner closed at total equality and does not start a second call', async () => {
    const packet = livePacket('runner-total-equality-0001');
    const authorization = mintQwenBenchmarkExecutionAuthorization(packet);
    await reserveQwenDiagnosticArtifactsForAuthorizationV1(authorization);
    let monotonicCalls = 0;
    const clock: QwenAdapterClockPort = Object.freeze({
      nowEpochMs: () => fixedNowMs,
      nowMonotonicMs: () => (monotonicCalls++ === 0 ? 0 : 150_000),
    });
    const transport = liveLikeTransport(responseFor(validEnvelope()));
    const report = await runQwenFourFixtureBenchmark({
      mode: 'live-provider',
      transport,
      authorization,
      secret: 'unit-test-secret-not-a-provider-key',
      cancellation: { cancelled: false, throwIfCancelled(): void {} },
      clock,
    });
    expect(report).toMatchObject({
      providerCallCount: 0,
      retryCount: 0,
      stoppedEarly: true,
      terminalFailureReason: 'total-time-limit-exceeded',
    });
    expect(transport.dispatchMock).not.toHaveBeenCalled();
    await releaseQwenDiagnosticArtifactsForAuthorizationV1(authorization);
  });

  it('does not let diagnostic setup time inherit the old per-fixture cap', async () => {
    const packet = livePacket('runner-setup-budget-0001');
    const authorization = mintQwenBenchmarkExecutionAuthorization(packet);
    await reserveQwenDiagnosticArtifactsForAuthorizationV1(authorization);
    const monotonicSequence = [0, 0, 10, 10] as const;
    let monotonicCalls = 0;
    const clock: QwenAdapterClockPort = Object.freeze({
      nowEpochMs: () => fixedNowMs,
      nowMonotonicMs: () =>
        monotonicSequence[Math.min(monotonicCalls++, monotonicSequence.length - 1)]!,
    });
    const transport = liveLikeTransport(responseFor(validEnvelope()));
    await runQwenFourFixtureBenchmark({
      mode: 'live-provider',
      transport,
      authorization,
      secret: 'unit-test-secret-not-a-provider-key',
      cancellation: { cancelled: false, throwIfCancelled(): void {} },
      clock,
    });
    expect(transport.dispatchMock.mock.calls[0]?.[0].timeoutMs).toBe(120_000);
    await releaseQwenDiagnosticArtifactsForAuthorizationV1(authorization);
  });

  it('samples the fresh dispatch epoch after setup when deriving the V3 timeout', async () => {
    const packet = livePacket('fresh-dispatch-epoch-0001');
    const authorization = mintQwenBenchmarkExecutionAuthorization(packet);
    await reserveQwenDiagnosticArtifactsForAuthorizationV1(authorization);
    let epochCalls = 0;
    const clock: QwenAdapterClockPort = Object.freeze({
      nowEpochMs: () => (epochCalls++ === 0 ? fixedNowMs : fixedNowMs + 250),
      nowMonotonicMs: () => 0,
    });
    const transport = liveLikeTransport(responseFor(validEnvelope()));
    const input = await firstFixtureInput();
    await createQwen3VlSceneAnalysisAdapter({ transport, clock }).analyze({
      ...input,
      context: {
        ...input.context,
        deadlineAtMs: EpochMillisecondsSchema.parse(fixedNowMs + 120_000),
      },
      authorization,
      secret: 'unit-test-secret-not-a-provider-key',
    });
    expect(transport.dispatchMock.mock.calls[0]?.[0].timeoutMs).toBe(119_750);
    await releaseQwenDiagnosticArtifactsForAuthorizationV1(authorization);
  });

  it('keeps historical V2 diagnostic packets parseable but non-dispatchable', () => {
    const active = createQwenDiagnosticAuthorizationPacketV3({
      authorizationId: 'qwen.diag.historical-v2-0001',
      issuedAtMs: fixedNowMs - 1_000,
      expiresAtMs: fixedNowMs + 599_000,
      ...diagnosticPaths('historical-v2-0001'),
    });
    const historicalDiagnostic = {
      ...active.diagnosticCapture,
      diagnosticVersion: 1 as const,
    };
    delete (historicalDiagnostic as Record<string, unknown>).perCallTimeoutMs;
    delete (historicalDiagnostic as Record<string, unknown>).totalWallTimeMs;
    delete (historicalDiagnostic as Record<string, unknown>).totalCalculatedListCostMaximumMicroUsd;
    delete (historicalDiagnostic as Record<string, unknown>).diagnosticCapsSha256;
    delete (historicalDiagnostic as Record<string, unknown>).webRouteActivated;
    const historical = {
      ...active,
      authorizationVersion: 2 as const,
      purpose: 'one-capped-four-fixture-sequential-zero-retry-benchmark' as const,
      diagnosticCapture: historicalDiagnostic,
    };
    expect(QwenBenchmarkAuthorizationPacketV2Schema.parse(historical)).toBeDefined();
    expect(() => mintQwenBenchmarkExecutionAuthorization(historical)).toThrow(
      QwenSceneAnalysisError,
    );
  });

  it('captures an exclusively written 0600 projection and exactly replays its rejection offline', async () => {
    const packet = livePacket('capture-replay-0001');
    const envelope = { ...validEnvelope(), foreign_field: { private_value: 'must-disappear' } };
    const response = responseFor(envelope);
    const transport = liveLikeTransport(response);
    const adapter = createQwen3VlSceneAnalysisAdapter({ transport, clock: fixedClock() });
    const authorization = mintQwenBenchmarkExecutionAuthorization(packet);
    await reserveQwenDiagnosticArtifactsForAuthorizationV1(authorization);
    let capturedError: QwenSceneAnalysisError | null = null;
    try {
      await adapter.analyze({
        ...(await firstFixtureInput()),
        authorization,
        secret: 'unit-test-secret-not-a-provider-key',
      });
    } catch (error) {
      if (error instanceof QwenSceneAnalysisError) capturedError = error;
      else throw error;
    }
    expect(capturedError).toMatchObject({
      reason: 'schema-invalid',
      diagnostic: { stage: 'unknown-field-rejection' },
      diagnosticArtifact: {
        relativePath: packet.diagnosticCapture.responseArtifactRelativePath,
        mode: '0600',
      },
    });
    const artifactPath = join(
      repositoryRoot,
      packet.diagnosticCapture.responseArtifactRelativePath,
    );
    const artifactText = await readFile(artifactPath, 'utf8');
    expect(artifactText).not.toMatch(
      /must-disappear|unit-test-secret|data:image|Bearer|authorizationVersion|scene-analysis stage/iu,
    );
    expect((await lstat(artifactPath)).mode & 0o777).toBe(0o600);

    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const replay = await replaySanitizedQwenResponseV1({
      responseFile: packet.diagnosticCapture.responseArtifactRelativePath,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(replay).toMatchObject({
      providerCallCount: 0,
      networkUsed: false,
      validationStatus: 'replay-rejected',
      failureReason: 'schema-invalid',
      diagnostic: {
        stage: capturedError?.diagnostic?.stage,
        issueDigestSha256: capturedError?.diagnostic?.issueDigestSha256,
      },
      replayReproduced: true,
      productionAdmissionAuthority: false,
      providerSuccessAuthority: false,
      humanOracleModified: false,
    });

    const originalBytes = await readFile(artifactPath);
    await expect(
      reserveQwenDiagnosticArtifactFilesV1({
        responseArtifactRelativePath: packet.diagnosticCapture.responseArtifactRelativePath,
        diagnosticReportRelativePath: packet.diagnosticCapture.diagnosticReportRelativePath,
      }),
    ).rejects.toBeInstanceOf(QwenDiagnosticCaptureError);
    expect(await readFile(artifactPath)).toEqual(originalBytes);
    await releaseQwenDiagnosticArtifactsForAuthorizationV1(authorization);
  });

  it('pseudonymizes or discards forbidden material in every provider string with exact replay', async () => {
    const cases = [
      {
        token: 'forbidden-content-0001',
        forbiddenText: 'data:image/png;base64,FORBIDDEN',
        response: () => {
          const envelope = structuredClone(validEnvelope());
          (
            (envelope.choices as Record<string, unknown>[])[0]!.message as Record<string, unknown>
          ).content = 'data:image/png;base64,FORBIDDEN';
          return responseFor(envelope);
        },
      },
      {
        token: 'forbidden-id-0001',
        forbiddenText: 'sk-RAWKEYMATERIAL1234567890',
        response: () => responseFor({ ...validEnvelope(), id: 'sk-RAWKEYMATERIAL1234567890' }),
      },
      {
        token: 'forbidden-model-0001',
        forbiddenText: 'DASHSCOPE_API_KEY',
        response: () => responseFor({ ...validEnvelope(), model: 'DASHSCOPE_API_KEY' }),
      },
      {
        token: 'forbidden-refusal-0001',
        forbiddenText: 'Bearer raw-provider-credential',
        response: () => {
          const envelope = structuredClone(validEnvelope());
          (
            (envelope.choices as Record<string, unknown>[])[0]!.message as Record<string, unknown>
          ).refusal = 'Bearer raw-provider-credential';
          return responseFor(envelope);
        },
      },
      {
        token: 'forbidden-fingerprint-0001',
        forbiddenText: 'https://image.example/source.png',
        response: () =>
          responseFor({
            ...validEnvelope(),
            system_fingerprint: 'https://image.example/source.png',
          }),
      },
      {
        token: 'forbidden-wrong-type-0001',
        forbiddenText: 'authorization: secret',
        response: () => responseFor({ ...validEnvelope(), created: 'authorization: secret' }),
      },
      {
        token: 'forbidden-error-0001',
        forbiddenText: 'executionAuthorized provider protocol wrapper',
        response: () =>
          responseFor(
            {
              error: {
                message: 'executionAuthorized provider protocol wrapper',
                type: 'invalid_request_error',
                code: 'InvalidParameter',
              },
            },
            400,
          ),
      },
    ] as const;
    for (const testCase of cases) {
      const paths = diagnosticPaths(testCase.token);
      const response = testCase.response();
      const reservations = await reserveQwenDiagnosticArtifactFilesV1(paths);
      await captureSanitizedQwenResponseV1({
        reservations,
        capturedAtMs: fixedNowMs,
        fixtureId: 'banner-person-v1',
        response,
        failure: boundaryFailureOrNull(response),
      });
      const artifactText = await readFile(
        join(repositoryRoot, paths.responseArtifactRelativePath),
        'utf8',
      );
      expect(artifactText).not.toContain(testCase.forbiddenText);
      expect(artifactText).not.toMatch(/data:image|base64|Bearer|DASHSCOPE_API_KEY/iu);
      expect(
        (await replaySanitizedQwenResponseV1({ responseFile: paths.responseArtifactRelativePath }))
          .replayReproduced,
      ).toBe(true);
      await abortQwenDiagnosticArtifactReservationsV1(reservations);
    }
  });

  it('pseudonymizes a credential-like unknown field name and never retains its value', async () => {
    const paths = diagnosticPaths('redacted-field-name-0001');
    const response = responseFor({
      ...validEnvelope(),
      authorizationVersion: 'must-never-persist',
    });
    const reservations = await reserveQwenDiagnosticArtifactFilesV1(paths);
    await captureSanitizedQwenResponseV1({
      reservations,
      capturedAtMs: fixedNowMs,
      fixtureId: 'banner-person-v1',
      response,
      failure: captureBoundaryFailure(response),
    });
    const artifactText = await readFile(
      join(repositoryRoot, paths.responseArtifactRelativePath),
      'utf8',
    );
    expect(artifactText).not.toMatch(/authorizationVersion|must-never-persist/iu);
    expect(
      (await replaySanitizedQwenResponseV1({ responseFile: paths.responseArtifactRelativePath }))
        .replayReproduced,
    ).toBe(true);
    await abortQwenDiagnosticArtifactReservationsV1(reservations);
  });

  it('pseudonymizes valid-shape part keys, labels, and OCR text while preserving replay semantics', async () => {
    const paths = diagnosticPaths('structural-string-pseudonyms-0001');
    const rawPartKey = 'general-agent_actions';
    const rawLabel = 'Inspect the supplied banner image';
    const rawOcrText = 'Preserve visible text exactly';
    const envelope = structuredClone(validEnvelope());
    mutateAssistantOutput(envelope, (output) => {
      const composition = output.composition as Record<string, unknown>;
      const parts = composition.parts as Record<string, unknown>[];
      const evidence = output.layerEvidence as Record<string, unknown>[];
      const observations = output.textObservations as Record<string, unknown>[];
      parts[0]!.partKey = rawPartKey;
      parts[0]!.label = rawLabel;
      evidence[0]!.partKey = rawPartKey;
      ((observations[0]!.text as Record<string, unknown>).value as unknown) = rawOcrText;
    });
    const response = responseFor(envelope);
    expect(boundaryFailureOrNull(response)).toBeNull();
    const reservations = await reserveQwenDiagnosticArtifactFilesV1(paths);
    await captureSanitizedQwenResponseV1({
      reservations,
      capturedAtMs: fixedNowMs,
      fixtureId: 'banner-person-v1',
      response,
      failure: null,
    });
    const artifact = JSON.parse(
      await readFile(join(repositoryRoot, paths.responseArtifactRelativePath), 'utf8'),
    ) as {
      readonly payload: {
        readonly response: {
          readonly body: { readonly canonicalBodyProjection: string };
        };
      };
    };
    const projectedEnvelope = JSON.parse(
      artifact.payload.response.body.canonicalBodyProjection,
    ) as Record<string, unknown>;
    const projectedChoice = (projectedEnvelope.choices as Record<string, unknown>[])[0]!;
    const projectedMessage = projectedChoice.message as Record<string, unknown>;
    const projectedOutput = JSON.parse(String(projectedMessage.content)) as Record<string, unknown>;
    const projectedComposition = projectedOutput.composition as Record<string, unknown>;
    const projectedParts = projectedComposition.parts as Record<string, unknown>[];
    const projectedEvidence = projectedOutput.layerEvidence as Record<string, unknown>[];
    const projectedObservations = projectedOutput.textObservations as Record<string, unknown>[];
    expect(projectedParts[0]!.partKey).toMatch(/^part_[0-9a-f]{64}$/u);
    expect(projectedEvidence[0]!.partKey).toBe(projectedParts[0]!.partKey);
    expect(projectedParts[0]!.label).toMatch(/^Label [0-9a-f]{24}$/u);
    expect((projectedObservations[0]!.text as Record<string, unknown>).value).toMatch(
      /^Observed [0-9a-f]{24}$/u,
    );
    const artifactText = JSON.stringify(artifact);
    expect(artifactText).not.toMatch(
      /general-agent_actions|Inspect the supplied banner image|Preserve visible text exactly/u,
    );
    expect(
      (await replaySanitizedQwenResponseV1({ responseFile: paths.responseArtifactRelativePath }))
        .replayReproduced,
    ).toBe(true);
    await abortQwenDiagnosticArtifactReservationsV1(reservations);
  });

  it('preserves invalid validator classes with structural sentinels and exact replay', async () => {
    const paths = diagnosticPaths('invalid-string-sentinels-0001');
    const envelope = structuredClone(validEnvelope());
    mutateAssistantOutput(envelope, (output) => {
      const composition = output.composition as Record<string, unknown>;
      const parts = composition.parts as Record<string, unknown>[];
      const evidence = output.layerEvidence as Record<string, unknown>[];
      const observations = output.textObservations as Record<string, unknown>[];
      parts[0]!.partKey = 'INVALID raw part key';
      parts[0]!.label = ' invalid raw label ';
      evidence[0]!.partKey = 'INVALID raw part key';
      (observations[0]!.text as Record<string, unknown>).value = ' invalid  raw OCR ';
    });
    const response = responseFor(envelope);
    const failure = captureBoundaryFailure(response);
    expect(failure.diagnostic.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: '/composition/parts/0/partKey' }),
        expect.objectContaining({ path: '/composition/parts/0/label' }),
        expect.objectContaining({ path: '/textObservations/0/text/value' }),
      ]),
    );
    const reservations = await reserveQwenDiagnosticArtifactFilesV1(paths);
    await captureSanitizedQwenResponseV1({
      reservations,
      capturedAtMs: fixedNowMs,
      fixtureId: 'banner-person-v1',
      response,
      failure,
    });
    const artifactText = await readFile(
      join(repositoryRoot, paths.responseArtifactRelativePath),
      'utf8',
    );
    expect(artifactText).not.toMatch(/INVALID raw part key|invalid raw label|invalid  raw OCR/u);
    const replay = await replaySanitizedQwenResponseV1({
      responseFile: paths.responseArtifactRelativePath,
    });
    expect(replay).toMatchObject({
      replayReproduced: true,
      diagnostic: { issueDigestSha256: failure.diagnostic.issueDigestSha256 },
    });
    await abortQwenDiagnosticArtifactReservationsV1(reservations);
  });

  it('pseudonymizes all unknown names and arbitrary prompt-like values without a blacklist', async () => {
    const paths = diagnosticPaths('all-unknown-name-pseudonyms-0001');
    const rawNames = ['api_key', 'x-api-key', 'header', 'headers', 'stable_semantic_layer_roles'];
    const rawValues = [
      'Inspect the supplied banner image',
      'Preserve visible text exactly',
      'Use normalized basis-point bounds',
      'Do not perform segmentation or general-agent actions',
      'Return only structured data matching the supplied contract',
    ];
    const envelope = structuredClone(validEnvelope());
    for (const [index, name] of rawNames.entries()) envelope[name] = rawValues[index];
    const response = responseFor(envelope);
    const failure = captureBoundaryFailure(response);
    expect(failure.diagnostic.issues[0]?.unknownFieldNames).toEqual(
      rawNames.map(pseudonymizeQwenDiagnosticFieldNameV1).toSorted(),
    );
    const reservations = await reserveQwenDiagnosticArtifactFilesV1(paths);
    await captureSanitizedQwenResponseV1({
      reservations,
      capturedAtMs: fixedNowMs,
      fixtureId: 'banner-person-v1',
      response,
      failure,
    });
    const artifactText = await readFile(
      join(repositoryRoot, paths.responseArtifactRelativePath),
      'utf8',
    );
    for (const raw of [...rawNames, ...rawValues]) expect(artifactText).not.toContain(raw);
    expect(
      (await replaySanitizedQwenResponseV1({ responseFile: paths.responseArtifactRelativePath }))
        .replayReproduced,
    ).toBe(true);
    await abortQwenDiagnosticArtifactReservationsV1(reservations);
  });

  it('replaces a valid foreign 64-hex source value with a fixed unequal digest and replays exactly', async () => {
    const paths = diagnosticPaths('foreign-source-sha-pseudonym-0001');
    const rawForeignSha = '0'.repeat(64);
    const envelope = structuredClone(validEnvelope());
    mutateAssistantOutput(envelope, (output) => {
      (output.composition as Record<string, unknown>).sourceAssetSha256 = rawForeignSha;
    });
    const response = responseFor(envelope);
    const failure = captureBoundaryFailure(response);
    expect(failure).toMatchObject({
      reason: 'identity-mismatch',
      diagnostic: { stage: 'source-identity' },
    });
    const reservations = await reserveQwenDiagnosticArtifactFilesV1(paths);
    await captureSanitizedQwenResponseV1({
      reservations,
      capturedAtMs: fixedNowMs,
      fixtureId: 'banner-person-v1',
      response,
      failure,
    });
    const artifactText = await readFile(
      join(repositoryRoot, paths.responseArtifactRelativePath),
      'utf8',
    );
    expect(artifactText).not.toContain(rawForeignSha);
    expect(
      (await replaySanitizedQwenResponseV1({ responseFile: paths.responseArtifactRelativePath }))
        .replayReproduced,
    ).toBe(true);
    await abortQwenDiagnosticArtifactReservationsV1(reservations);
  });

  it('replays parser-valid projections only as replay-valid with no provider-success authority', async () => {
    const paths = diagnosticPaths('valid-replay-0001');
    const response = responseFor(validEnvelope());
    const reservations = await reserveQwenDiagnosticArtifactFilesV1(paths);
    await captureSanitizedQwenResponseV1({
      reservations,
      capturedAtMs: fixedNowMs,
      fixtureId: 'banner-person-v1',
      response,
      failure: null,
    });
    const replay = await replaySanitizedQwenResponseV1({
      responseFile: paths.responseArtifactRelativePath,
    });
    expect(replay).toMatchObject({
      validationStatus: 'replay-valid',
      failureReason: null,
      diagnostic: null,
      replayReproduced: true,
      providerCallCount: 0,
      networkUsed: false,
      productionAdmissionAuthority: false,
      providerSuccessAuthority: false,
    });
    await abortQwenDiagnosticArtifactReservationsV1(reservations);
  });

  it('bounds 257 projected unknown fields with explicit counts and exact replay', async () => {
    const paths = diagnosticPaths('unknown-overflow-0257');
    const envelope = structuredClone(validEnvelope());
    for (let index = 0; index < 257; index += 1) {
      envelope[`foreign_${String(index).padStart(3, '0')}`] = `discard-${index}`;
    }
    const response = responseFor(envelope);
    const failure = captureBoundaryFailure(response);
    expect(failure.diagnostic.issues[0]).toMatchObject({
      actualUnknownFieldNameCount: 257,
      retainedUnknownFieldNameCount: 64,
      truncatedUnknownFieldNameCount: 193,
    });
    const reservations = await reserveQwenDiagnosticArtifactFilesV1(paths);
    await captureSanitizedQwenResponseV1({
      reservations,
      capturedAtMs: fixedNowMs,
      fixtureId: 'banner-person-v1',
      response,
      failure,
    });
    const artifact = JSON.parse(
      await readFile(join(repositoryRoot, paths.responseArtifactRelativePath), 'utf8'),
    ) as {
      readonly payload: {
        readonly response: {
          readonly body: {
            readonly unknownFields: readonly unknown[];
            readonly actualUnknownFieldCount: number;
            readonly retainedUnknownFieldCount: number;
            readonly truncatedUnknownFieldCount: number;
            readonly unknownFieldOverflow: readonly {
              readonly retainedFields: readonly unknown[];
              readonly actualFieldCount: number;
              readonly retainedFieldCount: number;
              readonly generatedFieldCount: number;
            }[];
          };
        };
      };
    };
    expect(artifact.payload.response.body).toMatchObject({
      actualUnknownFieldCount: 257,
      retainedUnknownFieldCount: 257,
      truncatedUnknownFieldCount: 0,
    });
    expect(artifact.payload.response.body.unknownFields).toHaveLength(256);
    expect(artifact.payload.response.body.unknownFieldOverflow).toEqual([
      expect.objectContaining({
        actualFieldCount: 1,
        retainedFieldCount: 1,
        generatedFieldCount: 0,
        retainedFields: [expect.any(Object)],
      }),
    ]);
    const replay = await replaySanitizedQwenResponseV1({
      responseFile: paths.responseArtifactRelativePath,
    });
    expect(replay.replayReproduced).toBe(true);
    expect(replay.diagnostic?.issueDigestSha256).toBe(failure.diagnostic.issueDigestSha256);
    await abortQwenDiagnosticArtifactReservationsV1(reservations);
  });

  it('uses truthful retained and generated counts after overflow retention', async () => {
    const paths = diagnosticPaths('unknown-overflow-0321');
    const envelope = structuredClone(validEnvelope());
    for (let index = 0; index < 321; index += 1) {
      envelope[`foreign_${String(index).padStart(3, '0')}`] = null;
    }
    const response = responseFor(envelope);
    const failure = captureBoundaryFailure(response);
    const reservations = await reserveQwenDiagnosticArtifactFilesV1(paths);
    await captureSanitizedQwenResponseV1({
      reservations,
      capturedAtMs: fixedNowMs,
      fixtureId: 'banner-person-v1',
      response,
      failure,
    });
    const artifact = JSON.parse(
      await readFile(join(repositoryRoot, paths.responseArtifactRelativePath), 'utf8'),
    ) as {
      readonly payload: {
        readonly response: {
          readonly body: {
            readonly actualUnknownFieldCount: number;
            readonly retainedUnknownFieldCount: number;
            readonly truncatedUnknownFieldCount: number;
            readonly unknownFieldOverflow: readonly {
              readonly retainedFieldCount: number;
              readonly generatedFieldCount: number;
            }[];
          };
        };
      };
    };
    expect(artifact.payload.response.body).toMatchObject({
      actualUnknownFieldCount: 321,
      retainedUnknownFieldCount: 320,
      truncatedUnknownFieldCount: 1,
      unknownFieldOverflow: [
        expect.objectContaining({ retainedFieldCount: 64, generatedFieldCount: 1 }),
      ],
    });
    const replay = await replaySanitizedQwenResponseV1({
      responseFile: paths.responseArtifactRelativePath,
    });
    expect(replay).toMatchObject({
      replayReproduced: true,
      diagnostic: { issueDigestSha256: failure.diagnostic.issueDigestSha256 },
    });
    expect(
      replay.diagnostic?.issues[0]?.unknownFieldNames?.every((name) => name.startsWith('qdf-')),
    ).toBe(true);
    await abortQwenDiagnosticArtifactReservationsV1(reservations);
  });

  it('bounds oversized provider arrays at validator maximum plus one and exactly replays', async () => {
    const paths = diagnosticPaths('oversized-provider-array-0001');
    const envelope = { ...validEnvelope(), choices: Array.from({ length: 10_000 }, () => null) };
    const response = responseFor(envelope);
    const failure = captureBoundaryFailure(response);
    expect(failure).toMatchObject({
      reason: 'schema-invalid',
      diagnostic: { stage: 'choice-count' },
    });
    const reservations = await reserveQwenDiagnosticArtifactFilesV1(paths);
    await captureSanitizedQwenResponseV1({
      reservations,
      capturedAtMs: fixedNowMs,
      fixtureId: 'banner-person-v1',
      response,
      failure,
    });
    const artifact = JSON.parse(
      await readFile(join(repositoryRoot, paths.responseArtifactRelativePath), 'utf8'),
    ) as {
      readonly payload: {
        readonly response: {
          readonly body: { readonly canonicalBodyProjection: string };
        };
      };
    };
    const projectedEnvelope = JSON.parse(
      artifact.payload.response.body.canonicalBodyProjection,
    ) as { readonly choices: readonly unknown[] };
    expect(projectedEnvelope.choices).toHaveLength(2);
    expect(
      (await replaySanitizedQwenResponseV1({ responseFile: paths.responseArtifactRelativePath }))
        .replayReproduced,
    ).toBe(true);
    await abortQwenDiagnosticArtifactReservationsV1(reservations);
  });

  it('fails projection overflow and internal schema failures closed as QwenDiagnosticCaptureError', async () => {
    const paths = diagnosticPaths('projection-overflow-8193');
    const envelope = structuredClone(validEnvelope());
    for (let index = 0; index < 8_193; index += 1) {
      envelope[`overflow_${String(index).padStart(5, '0')}`] = null;
    }
    const response = responseFor(envelope);
    const failure = captureBoundaryFailure(response);
    const reservations = await reserveQwenDiagnosticArtifactFilesV1(paths);
    await expect(
      captureSanitizedQwenResponseV1({
        reservations,
        capturedAtMs: fixedNowMs,
        fixtureId: 'banner-person-v1',
        response,
        failure,
      }),
    ).rejects.toBeInstanceOf(QwenDiagnosticCaptureError);
    await abortQwenDiagnosticArtifactReservationsV1(reservations);

    const schemaPaths = diagnosticPaths('projection-schema-failure-0001');
    const schemaReservations = await reserveQwenDiagnosticArtifactFilesV1(schemaPaths);
    await expect(
      captureSanitizedQwenResponseV1({
        reservations: schemaReservations,
        capturedAtMs: -1,
        fixtureId: 'banner-person-v1',
        response: responseFor(validEnvelope()),
        failure: null,
      }),
    ).rejects.toBeInstanceOf(QwenDiagnosticCaptureError);
    await abortQwenDiagnosticArtifactReservationsV1(schemaReservations);
  });

  it('bounds more than 256 validation issues and exactly replays their digest', async () => {
    const paths = diagnosticPaths('issue-overflow-0257');
    const envelope = structuredClone(validEnvelope());
    mutateAssistantOutput(envelope, (output) => {
      output.textObservations = Array.from({ length: 101 }, () => ({}));
      output.ocrCompletion = {
        kind: 'visible-text-observations-complete',
        observationCount: 101,
      };
    });
    const response = responseFor(envelope);
    const failure = captureBoundaryFailure(response);
    expect(failure.diagnostic.totalIssueCount).toBeGreaterThan(256);
    expect(failure.diagnostic).toMatchObject({
      retainedIssueCount: 256,
      truncatedIssueCount: failure.diagnostic.totalIssueCount - 256,
    });
    expect(failure.diagnostic.issues).toHaveLength(256);
    const reservations = await reserveQwenDiagnosticArtifactFilesV1(paths);
    await captureSanitizedQwenResponseV1({
      reservations,
      capturedAtMs: fixedNowMs,
      fixtureId: 'banner-person-v1',
      response,
      failure,
    });
    const replay = await replaySanitizedQwenResponseV1({
      responseFile: paths.responseArtifactRelativePath,
    });
    expect(replay.replayReproduced).toBe(true);
    expect(replay.diagnostic).toMatchObject({
      totalIssueCount: failure.diagnostic.totalIssueCount,
      retainedIssueCount: 256,
      issueDigestSha256: failure.diagnostic.issueDigestSha256,
    });
    await abortQwenDiagnosticArtifactReservationsV1(reservations);
  });

  it('replaces malformed assistant JSON with a safe sentinel and replays the same rejection', async () => {
    const paths = diagnosticPaths('malformed-sentinel-0001');
    const envelope = structuredClone(validEnvelope());
    const message = (envelope.choices as Record<string, unknown>[])[0]!.message as Record<
      string,
      unknown
    >;
    message.content = 'private-malformed-fragment {';
    const response = responseFor(envelope);
    const failure = captureBoundaryFailure(response);
    const reservations = await reserveQwenDiagnosticArtifactFilesV1(paths);
    await captureSanitizedQwenResponseV1({
      reservations,
      capturedAtMs: fixedNowMs,
      fixtureId: 'banner-person-v1',
      response,
      failure,
    });
    const artifactText = await readFile(
      join(repositoryRoot, paths.responseArtifactRelativePath),
      'utf8',
    );
    expect(artifactText).not.toContain('private-malformed-fragment');
    expect(
      (await replaySanitizedQwenResponseV1({ responseFile: paths.responseArtifactRelativePath }))
        .replayReproduced,
    ).toBe(true);
    await abortQwenDiagnosticArtifactReservationsV1(reservations);
  });

  it('rejects replay escapes, symlinks, special files, and oversized artifacts', async () => {
    const paths = diagnosticPaths('path-safety-source-0001');
    const reservations = await reserveQwenDiagnosticArtifactFilesV1(paths);
    await captureSanitizedQwenResponseV1({
      reservations,
      capturedAtMs: fixedNowMs,
      fixtureId: 'banner-person-v1',
      response: responseFor(validEnvelope()),
      failure: null,
    });
    await expect(
      replaySanitizedQwenResponseV1({ responseFile: '../outside.json' }),
    ).rejects.toThrow();
    await expect(
      replaySanitizedQwenResponseV1({
        responseFile: '.local-data/banner-ai/qwen-live-execution-authorization.json',
      }),
    ).rejects.toThrow();

    const symlinkRelative =
      '.local-data/banner-ai/qwen-response-diagnostic-path-safety-symlink-0001.json';
    localRelativePaths.add(symlinkRelative);
    await symlink(
      join(repositoryRoot, paths.responseArtifactRelativePath),
      join(repositoryRoot, symlinkRelative),
    );
    await expect(
      replaySanitizedQwenResponseV1({ responseFile: symlinkRelative }),
    ).rejects.toThrow();

    const directoryRelative =
      '.local-data/banner-ai/qwen-response-diagnostic-path-safety-directory-0001.json';
    localRelativePaths.add(directoryRelative);
    await mkdir(join(repositoryRoot, directoryRelative));
    await expect(
      replaySanitizedQwenResponseV1({ responseFile: directoryRelative }),
    ).rejects.toThrow();

    const oversizeRelative =
      '.local-data/banner-ai/qwen-response-diagnostic-path-safety-oversize-0001.json';
    localRelativePaths.add(oversizeRelative);
    await writeFile(join(repositoryRoot, oversizeRelative), Buffer.alloc(2_500_001));
    await expect(
      replaySanitizedQwenResponseV1({ responseFile: oversizeRelative }),
    ).rejects.toThrow();
    await abortQwenDiagnosticArtifactReservationsV1(reservations);
  });

  it('rejects wrong-mode and digest-tampered local replay artifacts', async () => {
    const modePaths = diagnosticPaths('wrong-mode-replay-0001');
    const modeReservations = await reserveQwenDiagnosticArtifactFilesV1(modePaths);
    await captureSanitizedQwenResponseV1({
      reservations: modeReservations,
      capturedAtMs: fixedNowMs,
      fixtureId: 'banner-person-v1',
      response: responseFor(validEnvelope()),
      failure: null,
    });
    const modePath = join(repositoryRoot, modePaths.responseArtifactRelativePath);
    await chmod(modePath, 0o644);
    await expect(
      replaySanitizedQwenResponseV1({ responseFile: modePaths.responseArtifactRelativePath }),
    ).rejects.toThrow();
    await abortQwenDiagnosticArtifactReservationsV1(modeReservations);

    const digestPaths = diagnosticPaths('digest-tamper-replay-0001');
    const digestReservations = await reserveQwenDiagnosticArtifactFilesV1(digestPaths);
    await captureSanitizedQwenResponseV1({
      reservations: digestReservations,
      capturedAtMs: fixedNowMs,
      fixtureId: 'banner-person-v1',
      response: responseFor(validEnvelope()),
      failure: null,
    });
    const digestPath = join(repositoryRoot, digestPaths.responseArtifactRelativePath);
    const artifact = JSON.parse(await readFile(digestPath, 'utf8')) as Record<string, unknown>;
    artifact.canonicalPayloadSha256 = '0'.repeat(64);
    await writeFile(digestPath, `${JSON.stringify(artifact)}\n`, { mode: 0o600 });
    await expect(
      replaySanitizedQwenResponseV1({ responseFile: digestPaths.responseArtifactRelativePath }),
    ).rejects.toThrow();
    await abortQwenDiagnosticArtifactReservationsV1(digestReservations);
  });

  it('marks replay mismatch when a different self-valid artifact replaces the captured file', async () => {
    const capturedPaths = diagnosticPaths('report-binding-captured-0001');
    const replacementPaths = diagnosticPaths('report-binding-replacement-0001');
    const capturedReservations = await reserveQwenDiagnosticArtifactFilesV1(capturedPaths);
    const capturedMetadata = await captureSanitizedQwenResponseV1({
      reservations: capturedReservations,
      capturedAtMs: fixedNowMs,
      fixtureId: 'banner-person-v1',
      response: responseFor(validEnvelope()),
      failure: null,
    });
    const replacementResponse = responseFor({
      ...validEnvelope(),
      replacement_unknown_field: null,
    });
    const replacementReservations = await reserveQwenDiagnosticArtifactFilesV1(replacementPaths);
    await captureSanitizedQwenResponseV1({
      reservations: replacementReservations,
      capturedAtMs: fixedNowMs + 1,
      fixtureId: 'banner-person-v1',
      response: replacementResponse,
      failure: captureBoundaryFailure(replacementResponse),
    });
    const capturedPath = join(repositoryRoot, capturedPaths.responseArtifactRelativePath);
    const replacementBytes = await readFile(
      join(repositoryRoot, replacementPaths.responseArtifactRelativePath),
    );
    await writeFile(capturedPath, replacementBytes, { mode: 0o600 });
    await chmod(capturedPath, 0o600);
    const directReplay = await replaySanitizedQwenResponseV1({
      responseFile: capturedPaths.responseArtifactRelativePath,
    });
    expect(directReplay.replayReproduced).toBe(true);
    expect(directReplay.sourceRawFileSha256).not.toBe(capturedMetadata.rawFileSha256);
    await expect(replayQwenDiagnosticArtifactStatusV1(capturedMetadata)).resolves.toBe('mismatch');
    await abortQwenDiagnosticArtifactReservationsV1(capturedReservations);
    await abortQwenDiagnosticArtifactReservationsV1(replacementReservations);
  });

  it('replays a package-owned diagnostic fixture at normal tracked-file mode', async () => {
    const replay = await replaySanitizedQwenResponseV1({
      responseFile: join(
        repositoryRoot,
        'packages/banner-ai/test/fixtures/qwen-response-diagnostics/missing-usage-v1.json',
      ),
    });
    expect(replay).toMatchObject({
      fixtureId: 'banner-person-v1',
      providerCallCount: 0,
      networkUsed: false,
      validationStatus: 'replay-rejected',
      failureReason: 'missing-usage',
      diagnostic: { stage: 'usage-accounting' },
      replayReproduced: true,
      productionAdmissionAuthority: false,
      providerSuccessAuthority: false,
      humanOracleModified: false,
    });
  });

  it('keeps complete type, link, identity, size, path, and local-mode guards after replay reads', async () => {
    const diagnosticsPath = join(
      repositoryRoot,
      'packages/banner-ai/src/server/qwen3-vl-response-diagnostics.ts',
    );
    const sourceText = await readFile(diagnosticsPath, 'utf8');
    const sourceFile = ts.createSourceFile(
      diagnosticsPath,
      sourceText,
      ts.ScriptTarget.ESNext,
      true,
      ts.ScriptKind.TS,
    );
    let postReadGuard: ts.IfStatement | undefined;
    const visit = (node: ts.Node): void => {
      if (
        ts.isIfStatement(node) &&
        node.expression.getText(sourceFile).includes('canonicalAfterRead')
      ) {
        postReadGuard = node;
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    const condition = postReadGuard?.expression.getText(sourceFile) ?? '';
    for (const requiredGuard of [
      '!after.isFile()',
      '!pathAfter.isFile()',
      'pathAfter.isSymbolicLink()',
      'after.nlink !== 1',
      'pathAfter.nlink !== 1',
      'stableFileIdentity(before, after)',
      'stableFileIdentity(before, pathAfter)',
      'canonicalAfterRead',
      'after.size !== before.size',
      'pathAfter.size !== before.size',
      '(after.mode & 0o777) !== 0o600',
      '(pathAfter.mode & 0o777) !== 0o600',
    ]) {
      expect(condition).toContain(requiredGuard);
    }
  });

  it('rejects parent rename and symlink replacement using the production parent-chain verifier', async () => {
    for (const swappedComponent of ['banner-ai', '.local-data'] as const) {
      const isolatedRoot = await mkdtemp(join(tmpdir(), `qwen-parent-${swappedComponent}-`));
      try {
        await mkdir(join(isolatedRoot, '.local-data/banner-ai'), { recursive: true });
        const guard = await createQwenDiagnosticParentChainGuardV1(isolatedRoot);
        await expect(verifyQwenDiagnosticParentChainGuardV1(guard)).resolves.toBeUndefined();
        const originalPath =
          swappedComponent === 'banner-ai'
            ? join(isolatedRoot, '.local-data/banner-ai')
            : join(isolatedRoot, '.local-data');
        const movedPath = `${originalPath}-moved`;
        await rename(originalPath, movedPath);
        await symlink(movedPath, originalPath);
        await expect(verifyQwenDiagnosticParentChainGuardV1(guard)).rejects.toBeInstanceOf(
          QwenDiagnosticCaptureError,
        );
      } finally {
        await rm(isolatedRoot, { force: true, recursive: true });
      }
    }
  });

  it('fails path collisions and reservation swaps before any transport call', async () => {
    const collisionPacket = livePacket('preflight-collision-0001');
    await writeFile(
      join(repositoryRoot, collisionPacket.diagnosticCapture.responseArtifactRelativePath),
      '{}\n',
      { mode: 0o600 },
    );
    const collisionAuthorization = mintQwenBenchmarkExecutionAuthorization(collisionPacket);
    await expect(
      reserveQwenDiagnosticArtifactsForAuthorizationV1(collisionAuthorization),
    ).rejects.toBeInstanceOf(QwenDiagnosticCaptureError);
    const collisionTransport = liveLikeTransport(responseFor(validEnvelope()));
    await expect(
      createQwen3VlSceneAnalysisAdapter({
        transport: collisionTransport,
        clock: fixedClock(),
      }).analyze({
        ...(await firstFixtureInput()),
        authorization: collisionAuthorization,
        secret: 'unit-test-secret-not-a-provider-key',
      }),
    ).rejects.toMatchObject({ reason: 'authorization-missing' });
    expect(collisionTransport.dispatchMock).not.toHaveBeenCalled();

    const swapPacket = livePacket('preflight-swap-0001');
    const swapAuthorization = mintQwenBenchmarkExecutionAuthorization(swapPacket);
    await reserveQwenDiagnosticArtifactsForAuthorizationV1(swapAuthorization);
    const reservedPath = join(
      repositoryRoot,
      swapPacket.diagnosticCapture.responseArtifactRelativePath,
    );
    const movedRelativePath = `${swapPacket.diagnosticCapture.responseArtifactRelativePath}.moved`;
    localRelativePaths.add(movedRelativePath);
    await rename(reservedPath, join(repositoryRoot, movedRelativePath));
    await writeFile(reservedPath, '{}\n', { mode: 0o600 });
    const swapTransport = liveLikeTransport(responseFor(validEnvelope()));
    await expect(
      createQwen3VlSceneAnalysisAdapter({ transport: swapTransport, clock: fixedClock() }).analyze({
        ...(await firstFixtureInput()),
        authorization: swapAuthorization,
        secret: 'unit-test-secret-not-a-provider-key',
      }),
    ).rejects.toMatchObject({ reason: 'authorization-missing' });
    expect(swapTransport.dispatchMock).not.toHaveBeenCalled();
    await releaseQwenDiagnosticArtifactsForAuthorizationV1(swapAuthorization);

    const reportSwapPacket = livePacket('preflight-report-swap-0001');
    const reportSwapAuthorization = mintQwenBenchmarkExecutionAuthorization(reportSwapPacket);
    await reserveQwenDiagnosticArtifactsForAuthorizationV1(reportSwapAuthorization);
    const reservedReportPath = join(
      repositoryRoot,
      reportSwapPacket.diagnosticCapture.diagnosticReportRelativePath,
    );
    const movedReportRelativePath = `${reportSwapPacket.diagnosticCapture.diagnosticReportRelativePath}.moved`;
    localRelativePaths.add(movedReportRelativePath);
    await rename(reservedReportPath, join(repositoryRoot, movedReportRelativePath));
    await writeFile(reservedReportPath, '{}\n', { mode: 0o600 });
    const reportSwapTransport = liveLikeTransport(responseFor(validEnvelope()));
    await expect(
      createQwen3VlSceneAnalysisAdapter({
        transport: reportSwapTransport,
        clock: fixedClock(),
      }).analyze({
        ...(await firstFixtureInput()),
        authorization: reportSwapAuthorization,
        secret: 'unit-test-secret-not-a-provider-key',
      }),
    ).rejects.toMatchObject({ reason: 'authorization-missing' });
    expect(reportSwapTransport.dispatchMock).not.toHaveBeenCalled();
    await releaseQwenDiagnosticArtifactsForAuthorizationV1(reportSwapAuthorization);
  });

  it('stops diagnostic benchmark mode after person while preserving accounting, caps, and non-admission', async () => {
    const packet = livePacket('one-fixture-report-0001');
    const authorization = mintQwenBenchmarkExecutionAuthorization(packet);
    await reserveQwenDiagnosticArtifactsForAuthorizationV1(authorization);
    const transport = liveLikeTransport(responseFor(validEnvelope()));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const report = await runQwenFourFixtureBenchmark({
      mode: 'live-provider',
      transport,
      authorization,
      secret: 'unit-test-secret-not-a-provider-key',
      cancellation: { cancelled: false, throwIfCancelled(): void {} },
      clock: fixedClock(),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(transport.dispatchMock).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({
      providerCallCount: 1,
      successfulRunCount: 1,
      retryCount: 0,
      stoppedEarly: false,
      terminalFailureReason: 'none',
      overallPass: false,
      productionAdmissionAuthority: false,
      webRouteActivated: false,
      humanOracleModified: false,
      diagnosticOneFixtureMode: true,
      diagnosticReportRelativePath: packet.diagnosticCapture.diagnosticReportRelativePath,
      fixtureResults: [
        expect.objectContaining({
          fixtureId: 'banner-person-v1',
          providerCallCount: 1,
          retryCount: 0,
          accountingStatus: 'complete',
          diagnosticArtifact: expect.objectContaining({ mode: '0600' }),
          diagnosticReplayStatus: 'reproduced',
        }),
      ],
    });
    expect(report.caps).toMatchObject({ providerCallsMaximum: 4, retryCount: 0 });
    expect(QwenFourFixtureBenchmarkReportV4Schema.parse(report)).toBeDefined();
    expect(serializeQwenFourFixtureBenchmarkReport(report)).not.toMatch(
      /data:image|assistant.*content|Bearer|unit-test-secret/iu,
    );

    expect(QwenFourFixtureBenchmarkReportV4Schema.parse(report)).toBeDefined();
    const historicalShape = structuredClone(report) as Record<string, unknown>;
    expect(() => QwenFourFixtureBenchmarkReportV1Schema.parse(historicalShape)).toThrow();
    expect(() => QwenFourFixtureBenchmarkReportV2Schema.parse(historicalShape)).toThrow();
    const historicalV2Shape = structuredClone(report) as Record<string, unknown>;
    historicalV2Shape.reportVersion = 2;
    delete historicalV2Shape.diagnosticCapsSha256;
    delete historicalV2Shape.diagnosticCaps;
    expect(() => QwenFourFixtureBenchmarkReportV2Schema.parse(historicalV2Shape)).toThrow();
    const v2WithNewCaps = structuredClone(historicalV2Shape) as Record<string, unknown>;
    v2WithNewCaps.diagnosticCapsSha256 = QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2_SHA256;
    expect(() => QwenFourFixtureBenchmarkReportV2Schema.parse(v2WithNewCaps)).toThrow();
    historicalShape.reportVersion = 1;
    historicalShape.requestShapeSha256 =
      '06963aab79297adf81adb33f1c3c97b070ab5f30feb7ce6982d4e751afdf1fbf';
    historicalShape.orderedModelInputDigestsSha256 =
      '4dc9f1265bf0494784026836f42506f0b8f42e045862376318e905b437629041';
    delete historicalShape.providerProtocolWrapperSha256;
    delete historicalShape.diagnosticOneFixtureMode;
    delete historicalShape.diagnosticReportRelativePath;
    delete historicalShape.diagnosticCapsSha256;
    delete historicalShape.diagnosticCaps;
    const fixtureResults = historicalShape.fixtureResults as Record<string, unknown>[];
    delete fixtureResults[0]!.diagnosticArtifact;
    delete fixtureResults[0]!.diagnosticReplayStatus;
    expect(() => QwenFourFixtureBenchmarkReportV1Schema.parse(historicalShape)).toThrow();
    await releaseQwenDiagnosticArtifactsForAuthorizationV1(authorization);
  });

  it('records an actual schema-invalid diagnostic report only after provider-free replay', async () => {
    const packet = livePacket('rejected-report-0001');
    const authorization = mintQwenBenchmarkExecutionAuthorization(packet);
    await reserveQwenDiagnosticArtifactsForAuthorizationV1(authorization);
    const transport = liveLikeTransport(
      responseFor({ ...validEnvelope(), foreign_response_field: 'discarded' }),
    );
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const report = await runQwenFourFixtureBenchmark({
      mode: 'live-provider',
      transport,
      authorization,
      secret: 'unit-test-secret-not-a-provider-key',
      cancellation: { cancelled: false, throwIfCancelled(): void {} },
      clock: fixedClock(),
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(transport.dispatchMock).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({
      providerCallCount: 1,
      successfulRunCount: 0,
      retryCount: 0,
      stoppedEarly: true,
      terminalFailureReason: 'schema-invalid',
      overallPass: false,
      productionAdmissionAuthority: false,
      humanOracleModified: false,
      fixtureResults: [
        expect.objectContaining({
          fixtureId: 'banner-person-v1',
          accountingStatus: 'complete',
          status: 'fail',
          classifiedFailureReason: 'schema-invalid',
          diagnostic: expect.objectContaining({
            stage: 'unknown-field-rejection',
            issueDigestSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
          }),
          diagnosticArtifact: expect.objectContaining({ mode: '0600' }),
          diagnosticReplayStatus: 'reproduced',
        }),
      ],
    });
    const reportText = serializeQwenFourFixtureBenchmarkReport(report);
    expect(reportText).not.toMatch(/assistant.*content|discarded|data:image|base64|Bearer/iu);
    await finalizeQwenDiagnosticReportForAuthorizationV1({
      authorization,
      bytes: Buffer.from(reportText, 'utf8'),
    });
    const reportPath = join(repositoryRoot, packet.diagnosticCapture.diagnosticReportRelativePath);
    expect((await lstat(reportPath)).mode & 0o777).toBe(0o600);
    expect(await readFile(reportPath, 'utf8')).toBe(reportText);
    await releaseQwenDiagnosticArtifactsForAuthorizationV1(authorization);
  });

  it('keeps replay server-only, provider-free, key-free, and absent from package/web surfaces', async () => {
    const packageRoot = join(repositoryRoot, 'packages/banner-ai');
    const packageJson = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')) as {
      readonly scripts: Readonly<Record<string, string>>;
    };
    expect(packageJson.scripts['benchmark:qwen:replay']).toContain('qwen-response-replay-cli');
    const visited = new Set<string>();
    const visitModule = async (absolutePath: string): Promise<void> => {
      if (visited.has(absolutePath)) return;
      visited.add(absolutePath);
      const sourceText = await readFile(absolutePath, 'utf8');
      const sourceFile = ts.createSourceFile(
        absolutePath,
        sourceText,
        ts.ScriptTarget.ESNext,
        true,
        ts.ScriptKind.TS,
      );
      const relativeSpecifiers: string[] = [];
      const visitNode = (node: ts.Node): void => {
        if (
          ts.isImportDeclaration(node) &&
          ts.isStringLiteral(node.moduleSpecifier) &&
          node.moduleSpecifier.text.startsWith('.')
        ) {
          relativeSpecifiers.push(node.moduleSpecifier.text);
        }
        if (
          ts.isCallExpression(node) &&
          node.expression.kind === ts.SyntaxKind.ImportKeyword &&
          node.arguments.length === 1 &&
          ts.isStringLiteral(node.arguments[0]!)
        ) {
          relativeSpecifiers.push(node.arguments[0]!.text);
        }
        if (
          ts.isPropertyAccessExpression(node) &&
          ((node.expression.getText(sourceFile) === 'globalThis' && node.name.text === 'fetch') ||
            (node.expression.getText(sourceFile) === 'process' && node.name.text === 'env'))
        ) {
          throw new Error(`Forbidden replay dependency capability in ${absolutePath}.`);
        }
        ts.forEachChild(node, visitNode);
      };
      visitNode(sourceFile);
      for (const specifier of relativeSpecifiers) {
        expect(specifier).not.toContain('native-fetch-transport');
        const nestedPath = join(dirname(absolutePath), specifier.replace(/\.js$/u, '.ts'));
        await visitModule(nestedPath);
      }
    };
    await visitModule(join(packageRoot, 'src/server/qwen-response-replay-cli.ts'));
    expect(publicBannerAi).not.toHaveProperty('replaySanitizedQwenResponseV1');

    const webRoot = join(repositoryRoot, 'apps/web/src');
    const webSources = async (directory: string): Promise<readonly string[]> => {
      const entries = await import('node:fs/promises').then(({ readdir }) =>
        readdir(directory, { withFileTypes: true }),
      );
      const nested = await Promise.all(
        entries.map((entry) => {
          const path = join(directory, entry.name);
          return entry.isDirectory()
            ? webSources(path)
            : Promise.resolve(
                entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [path] : [],
              );
        }),
      );
      return nested.flat();
    };
    for (const path of await webSources(webRoot)) {
      expect(await readFile(path, 'utf8'), path).not.toMatch(
        /qwen-response-diagnostic|qwen-response-replay|benchmark:qwen:replay/iu,
      );
    }
  });
});
