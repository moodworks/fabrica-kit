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
import {
  BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
  INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
} from '../src/evaluation/ai-contracts.js';
import {
  QWEN3_VL_API_FAMILY,
  QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT,
  QWEN3_VL_ENDPOINT_METHOD,
  QWEN3_VL_OFFICIAL_EVIDENCE_RETRIEVED_DATE,
  QWEN3_VL_PRICING_EVIDENCE_SHA256,
  QWEN3_VL_PROVIDER_KEY,
  QWEN3_VL_REQUESTED_MODEL_ID,
  QWEN3_VL_REQUEST_SHAPE_SHA256,
  QWEN3_VL_SECRET_REFERENCE_NAME,
  QWEN3_VL_SERVER_WORKSPACE_ID,
  QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256,
  QWEN_FOUR_FIXTURE_HUMAN_ORACLE_CORPUS_SHA256,
  QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256,
} from '../src/evaluation/qwen3-vl-candidate-evidence.js';
import { createDeterministicOracleMatchingQwenOutputV1 } from '../src/evaluation/qwen-four-fixture-quality.js';
import { EpochMillisecondsSchema } from '../src/jobs/timing.js';
import {
  QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_SHA256,
  createCanonicalQwenBenchmarkRequestV1,
} from '../src/server/qwen-four-fixture-request-catalog.js';
import {
  QwenSceneAnalysisError,
  createQwen3VlSceneAnalysisAdapter,
  createQwenDryRunExecutionAuthorization,
  finalizeQwenDiagnosticReportForAuthorizationV1,
  mintQwenBenchmarkExecutionAuthorization,
  releaseQwenDiagnosticArtifactsForAuthorizationV1,
  reserveQwenDiagnosticArtifactsForAuthorizationV1,
  type QwenAdapterClockPort,
  type QwenTransportPort,
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
  replayQwenDiagnosticArtifactStatusV1,
  runQwenFourFixtureBenchmark,
  serializeQwenFourFixtureBenchmarkReport,
} from '../src/server/qwen-four-fixture-benchmark.js';
import {
  REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V2,
  readPendingCorpusPackageFileV2,
} from '../src/server/real-model-benchmark-pending-corpus-source-registry-v2.js';

const fixedNowMs = Date.parse('2026-07-15T12:00:00.000Z');
const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
const localRelativePaths = new Set<string>();

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

const livePacket = (token: string) => ({
  authorizationVersion: 1 as const,
  authorizationId: `qwen.live.diagnostic.${token}`,
  mode: 'live-provider' as const,
  purpose: 'one-capped-four-fixture-sequential-zero-retry-benchmark' as const,
  issuedAtMs: fixedNowMs - 1_000,
  expiresAtMs: fixedNowMs + 600_000,
  serverWorkspaceId: QWEN3_VL_SERVER_WORKSPACE_ID,
  endpoint: QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT,
  endpointMethod: QWEN3_VL_ENDPOINT_METHOD,
  apiFamily: QWEN3_VL_API_FAMILY,
  providerKey: QWEN3_VL_PROVIDER_KEY,
  requestedModelId: QWEN3_VL_REQUESTED_MODEL_ID,
  secretReferenceName: QWEN3_VL_SECRET_REFERENCE_NAME,
  pendingCorpusCoreSha256: QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256,
  humanOracleCorpusSha256: QWEN_FOUR_FIXTURE_HUMAN_ORACLE_CORPUS_SHA256,
  pricingEvidenceSha256: QWEN3_VL_PRICING_EVIDENCE_SHA256,
  pricingEvidenceRetrievedDate: QWEN3_VL_OFFICIAL_EVIDENCE_RETRIEVED_DATE,
  requestShapeSha256: QWEN3_VL_REQUEST_SHAPE_SHA256,
  benchmarkCapsSha256: QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256,
  contentPolicyDefinitionSha256: BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
  workflowDefinitionSha256: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1.definitionSha256,
  orderedModelInputDigestsSha256: QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_SHA256,
  diagnosticCapture: {
    diagnosticVersion: 1 as const,
    mode: 'single-fixture-response-capture' as const,
    fixtureId: 'banner-person-v1' as const,
    providerCallsMaximum: 1 as const,
    retryCount: 0 as const,
    ...diagnosticPaths(token),
    productionAdmissionAuthority: false as const,
  },
  executionAuthorized: true as const,
});

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

describe('Qwen response diagnostics and offline replay', () => {
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
      const { diagnosticCapture: _diagnosticCapture, ...packetWithoutDiagnostic } = packet;
      void _diagnosticCapture;
      const authorization = mintQwenBenchmarkExecutionAuthorization(packetWithoutDiagnostic);
      const transport = liveLikeTransport(testCase.response);
      let captured: QwenSceneAnalysisError | null = null;
      try {
        await createQwen3VlSceneAnalysisAdapter({ transport, clock: fixedClock() }).analyze({
          ...(await firstFixtureInput()),
          authorization,
          secret: 'unit-test-secret-not-a-provider-key',
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
    expect(serializeQwenFourFixtureBenchmarkReport(report)).not.toMatch(
      /data:image|assistant.*content|Bearer|unit-test-secret/iu,
    );

    const legacyShape = structuredClone(report) as Record<string, unknown>;
    delete legacyShape.diagnosticOneFixtureMode;
    delete legacyShape.diagnosticReportRelativePath;
    const fixtureResults = legacyShape.fixtureResults as Record<string, unknown>[];
    delete fixtureResults[0]!.diagnosticArtifact;
    delete fixtureResults[0]!.diagnosticReplayStatus;
    expect(QwenFourFixtureBenchmarkReportV1Schema.parse(legacyShape)).toBeDefined();
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
