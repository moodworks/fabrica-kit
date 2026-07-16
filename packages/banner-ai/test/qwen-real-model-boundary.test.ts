import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import * as publicBannerAi from '../src/index.js';
import {
  BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
  INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
  createSceneAnalysisModelRequestV1,
} from '../src/evaluation/ai-contracts.js';
import {
  QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT,
  QWEN3_VL_MODEL_AVAILABILITY_EVIDENCE_V1,
  QWEN3_VL_MODEL_LIFECYCLE_EVIDENCE_V1,
  QWEN3_VL_OFFICIAL_EVIDENCE_RETRIEVED_DATE,
  QWEN3_VL_PRICING_EVIDENCE_V1,
  QWEN3_VL_PRICING_EVIDENCE_SHA256,
  QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_SHA256,
  QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V1_SHA256,
  QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2,
  QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_REQUIRED_CONSTRAINTS,
  QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_SHA256,
  QWEN3_VL_REQUESTED_MODEL_ID,
  QWEN3_VL_REQUEST_SHAPE_V1,
  QWEN3_VL_REQUEST_SHAPE_SHA256,
  QWEN3_VL_REQUEST_SHAPE_V1_SHA256,
  QWEN3_VL_REQUEST_SHAPE_V2_SHA256,
  QWEN3_VL_SERVER_WORKSPACE_ID,
  QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256,
  QWEN_FOUR_FIXTURE_HUMAN_ORACLE_CORPUS_SHA256,
  QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256,
  QwenPricingUsageV1Schema,
  QwenProviderUsageV1Schema,
  calculateQwen3VlListCostMicros,
  deriveQwenFrankfurtChatCompletionsEndpoint,
  type QwenProviderUsageV1,
} from '../src/evaluation/qwen3-vl-candidate-evidence.js';
import { SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_SHA256 } from '../src/evaluation/openai-scene-analysis-output.js';
import { SCENE_ANALYSIS_PROMPT_V1 } from '../src/evaluation/prompt-catalog.js';
import {
  createDeterministicOracleMatchingQwenOutputV1,
  getQwenFourFixtureEvaluationBindingsV1,
} from '../src/evaluation/qwen-four-fixture-quality.js';
import { EpochMillisecondsSchema } from '../src/jobs/timing.js';
import { canonicalizeJson, sha256Hex } from '../src/scene/canonical-scene-json.js';
import { createDeterministicQwenTransport } from '../src/server/qwen3-vl-deterministic-fake-transport.js';
import {
  QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_SHA256,
  QWEN_FOUR_FIXTURE_ACTIVE_MODEL_INPUT_DIGESTS_SHA256,
  QWEN_FOUR_FIXTURE_HISTORICAL_V1_BINDING_SHA256,
  QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_V1,
  QWEN_FOUR_FIXTURE_CANONICAL_REQUEST_CATALOG_V1,
  createCanonicalQwenBenchmarkRequestV1,
} from '../src/server/qwen-four-fixture-request-catalog.js';
import { createQwen3VlNativeFetchTransport } from '../src/server/qwen3-vl-native-fetch-transport.js';
import {
  QwenSceneAnalysisError,
  createQwen3VlSceneAnalysisAdapter,
  createQwenDryRunExecutionAuthorization,
  type QwenAdapterClockPort,
} from '../src/server/qwen3-vl-scene-analysis-adapter.js';
import {
  REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V2,
  readPendingCorpusPackageFileV2,
} from '../src/server/real-model-benchmark-pending-corpus-source-registry-v2.js';

const fixedNowMs = Date.parse('2026-07-15T12:00:00.000Z');
const bindings = getQwenFourFixtureEvaluationBindingsV1();

const liveCancellation = Object.freeze({
  cancelled: false,
  throwIfCancelled(): void {},
});

const clockWithLatency = (latencyMs = 7, epochMs = fixedNowMs): QwenAdapterClockPort => {
  let monotonicCalls = 0;
  return Object.freeze({
    nowEpochMs: () => epochMs,
    nowMonotonicMs: () => {
      monotonicCalls += 1;
      return monotonicCalls === 1 ? 100 : 100 + latencyMs;
    },
  });
};

const firstFixture = async () => {
  const binding = bindings[0]!;
  const source = REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V2[0]!;
  const bytes = await readPendingCorpusPackageFileV2(source.normalized.reference);
  const request = createCanonicalQwenBenchmarkRequestV1(binding.fixtureId);
  return { binding, bytes, request };
};

const analyzeInput = async (input?: {
  readonly authorization?: ReturnType<typeof createQwenDryRunExecutionAuthorization>;
}) => {
  const fixture = await firstFixture();
  return {
    request: fixture.request,
    normalizedImageBytes: fixture.bytes,
    context: {
      deadlineAtMs: EpochMillisecondsSchema.parse(fixedNowMs + 60_000),
      externalIdempotencyKey: null,
      cancellation: liveCancellation,
    },
    ...(input?.authorization === undefined ? {} : { authorization: input.authorization }),
    secret: null,
  };
};

const expectReason = async (
  promise: Promise<unknown>,
  reason: QwenSceneAnalysisError['reason'],
): Promise<void> => {
  await expect(promise).rejects.toMatchObject({ name: 'QwenSceneAnalysisError', reason });
};

const captureQwenError = async (promise: Promise<unknown>): Promise<QwenSceneAnalysisError> => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof QwenSceneAnalysisError) return error;
    throw error;
  }
  throw new Error('Expected the Qwen boundary to reject.');
};

const collectTypeScriptSources = (directory: string): readonly string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectTypeScriptSources(path);
    return /\.tsx?$/u.test(entry.name) ? [path] : [];
  });

describe('Qwen3-VL production adapter boundary', () => {
  it('pins the official model, Frankfurt endpoint derivation, request wrapper, and exact tier math', () => {
    expect(QWEN3_VL_REQUESTED_MODEL_ID).toBe('qwen3.6-flash-2026-04-16');
    expect(QWEN3_VL_SERVER_WORKSPACE_ID).toBe('ws-vy71dtw49uzef5hz');
    expect(QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT).toBe(
      'https://ws-vy71dtw49uzef5hz.eu-central-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
    );
    expect(deriveQwenFrankfurtChatCompletionsEndpoint(QWEN3_VL_SERVER_WORKSPACE_ID)).toBe(
      QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT,
    );
    expect(QWEN3_VL_OFFICIAL_EVIDENCE_RETRIEVED_DATE).toBe('2026-07-15');
    expect(QWEN3_VL_MODEL_AVAILABILITY_EVIDENCE_V1).toMatchObject({
      requestedModelId: 'qwen3.6-flash-2026-04-16',
      releaseScope: 'International',
      frankfurtDeploymentScope: 'Global',
      region: 'Germany-Frankfurt',
      releasedDate: '2026-04-16',
      inputModalities: ['text', 'image', 'video'],
      contextWindowTokens: 1_000_000,
      apiFamily: 'openai-compatible-chat-completions',
      chatCompletionsSupported: true,
      base64ImageInput: 'image-url-data-url',
      jsonObjectStructuredOutput: 'supported-json-object-schema-not-provider-enforced',
      nonThinkingModeControl: 'enable_thinking-false',
      sourceUrls: {
        frankfurtPricingAndAvailability:
          'https://www.alibabacloud.com/help/en/model-studio/model-pricing',
        visualModelCatalog: 'https://www.alibabacloud.com/help/en/model-studio/vision-model',
      },
    });
    expect(QWEN3_VL_MODEL_LIFECYCLE_EVIDENCE_V1).toMatchObject({
      requestedModelId: 'qwen3.6-flash-2026-04-16',
      currentDeprecationScheduleStatus: 'not-listed',
      snapshotSunsetNoticeMinimumDays: 30,
    });
    expect(QWEN3_VL_PRICING_EVIDENCE_V1).toMatchObject({
      requestedModelId: 'qwen3.6-flash-2026-04-16',
      documentedAlias: 'qwen3.6-flash',
      documentedAliasCurrentlyEquivalentToRequestedSnapshot: true,
      region: 'Germany-Frankfurt',
      pricingScope: 'Global',
    });
    expect(QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_SHA256).toMatch(/^[0-9a-f]{64}$/u);
    expect(QWEN3_VL_REQUEST_SHAPE_SHA256).toMatch(/^[0-9a-f]{64}$/u);
    expect(QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_SHA256).toBe(
      QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_SHA256,
    );
    expect(QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_SHA256).toBe(
      '87497d39a04ca12210500179b8e6705f03788d06a20bec8bf7cd6de29f6c6025',
    );
    expect(QWEN3_VL_REQUEST_SHAPE_SHA256).toBe(QWEN3_VL_REQUEST_SHAPE_V2_SHA256);
    expect(QWEN3_VL_REQUEST_SHAPE_V2_SHA256).toBe(
      '6a540409b86a7b7e7c677ddc5fb5bd3d9bab7ee35758a1da3679ade49af8fb27',
    );
    expect(SCENE_ANALYSIS_PROMPT_V1.contentSha256).toBe(
      '5cc311b7b353e06c61bcdf840b40dff9d35de0aea12851ffa18a654177917227',
    );
    expect(QWEN_FOUR_FIXTURE_ACTIVE_MODEL_INPUT_DIGESTS_SHA256).toBe(
      '1f2f53250b1032e12676041439e40f06532d8a69fb68d2cd00f5e388eaac5e2c',
    );
    expect(SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_SHA256).toBe(
      '2bdfd91875bc097b6bac93eadad924cdfb89b9fe9dc4f8293f494c721179dc9d',
    );
    expect(QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256).toBe(
      '5db7c7525440174bcbedbe6a1ab3e335a7ac9211e350fb8889ede111c0953c48',
    );
    expect(QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V1_SHA256).toBe(
      '339186794127e07e8be27959c07400e04e4b14f528d56da259613ce8942d2ab5',
    );
    expect(QWEN3_VL_REQUEST_SHAPE_V1_SHA256).toBe(
      '06963aab79297adf81adb33f1c3c97b070ab5f30feb7ce6982d4e751afdf1fbf',
    );
    expect(sha256Hex(Buffer.from(canonicalizeJson(QWEN3_VL_REQUEST_SHAPE_V1), 'utf8'))).toBe(
      QWEN3_VL_REQUEST_SHAPE_V1_SHA256,
    );
    for (const requiredText of QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_REQUIRED_CONSTRAINTS) {
      expect(QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2.content).toContain(requiredText);
    }
    expect(QWEN3_VL_PRICING_EVIDENCE_SHA256).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      calculateQwen3VlListCostMicros({
        prompt_tokens: 256_000,
        completion_tokens: 100,
        total_tokens: 256_100,
      }),
    ).toMatchObject({
      inputTokenTierMaximumInclusive: 256_000,
      inputMicrosPerMillionTokens: 165_000,
      outputMicrosPerMillionTokens: 990_000,
      calculatedListCostMicros: '42339',
      calculation: 'official-list-price-not-provider-reported-cost',
    });
    expect(
      calculateQwen3VlListCostMicros({
        prompt_tokens: 256_000,
        completion_tokens: 0,
        total_tokens: 256_000,
        prompt_tokens_details: { cached_tokens: 256_000 },
      }),
    ).toMatchObject({
      inputTokenTierMaximumInclusive: 256_000,
      cachedInputMicrosPerMillionTokens: 33_000,
      calculatedListCostMicros: '8448',
    });
    expect(
      calculateQwen3VlListCostMicros({
        prompt_tokens: 256_001,
        completion_tokens: 100,
        total_tokens: 256_101,
      }),
    ).toMatchObject({
      inputTokenTierMaximumInclusive: 1_000_000,
      inputMicrosPerMillionTokens: 660_000,
      outputMicrosPerMillionTokens: 3_961_000,
      calculatedListCostMicros: '169357',
    });
    expect(
      calculateQwen3VlListCostMicros({
        prompt_tokens: 1_000_000,
        completion_tokens: 100,
        total_tokens: 1_000_100,
      }),
    ).toMatchObject({
      inputTokenTierMaximumInclusive: 1_000_000,
      calculatedListCostMicros: '660397',
    });
    expect(() =>
      calculateQwen3VlListCostMicros({
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      }),
    ).toThrow();
    expect(() =>
      calculateQwen3VlListCostMicros({
        prompt_tokens: 1_000_001,
        completion_tokens: 0,
        total_tokens: 1_000_001,
      }),
    ).toThrow();
    expect(
      calculateQwen3VlListCostMicros({
        prompt_tokens: 256_001,
        completion_tokens: 0,
        total_tokens: 256_001,
        prompt_tokens_details: { cached_tokens: 256_001 },
      }),
    ).toMatchObject({
      inputTokenTierMaximumInclusive: 1_000_000,
      cachedInputMicrosPerMillionTokens: 132_000,
      uncachedPromptTokens: 0,
      cachedPromptTokens: 256_001,
      calculatedListCostMicros: '33793',
    });
    expect(
      calculateQwen3VlListCostMicros({
        prompt_tokens: 1,
        completion_tokens: 0,
        total_tokens: 1,
        prompt_tokens_details: { cached_tokens: 1 },
      }),
    ).toMatchObject({
      cachedInputRateFractionOfStandard: { numerator: 1, denominator: 5 },
      calculatedListCostMicros: '1',
    });
    expect(() =>
      calculateQwen3VlListCostMicros({
        prompt_tokens: 10,
        completion_tokens: 0,
        total_tokens: 10,
        prompt_tokens_details: { cached_tokens: 11 },
      }),
    ).toThrow();
    expect(
      QwenPricingUsageV1Schema.safeParse({
        prompt_tokens: 1_000_000,
        completion_tokens: 4_096,
        total_tokens: 1_004_096,
        prompt_tokens_details: {
          cached_tokens: 1_000_000,
          text_tokens: 1_000_000,
          image_tokens: 0,
          video_tokens: 0,
          cache_creation: {
            ephemeral_5m_input_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_type: 'ephemeral',
          },
        },
        completion_tokens_details: {
          reasoning_tokens: 4_096,
          text_tokens: 4_096,
        },
      }).success,
    ).toBe(true);
    expect(
      QwenProviderUsageV1Schema.safeParse({
        prompt_tokens: 256_001,
        completion_tokens: 0,
        total_tokens: 256_001,
      }).success,
    ).toBe(false);
    expect(
      QwenProviderUsageV1Schema.safeParse({
        prompt_tokens: 256_000,
        completion_tokens: 0,
        total_tokens: 256_000,
        prompt_tokens_details: { text_tokens: 260_097 },
      }).success,
    ).toBe(false);
  });

  it('accepts one trusted local PNG and returns strict proposal, usage, latency, and list cost', async () => {
    const output = createDeterministicOracleMatchingQwenOutputV1('banner-person-v1');
    const transport = createDeterministicQwenTransport([{ kind: 'success', output }]);
    const authorization = createQwenDryRunExecutionAuthorization({ nowMs: fixedNowMs });
    const adapter = createQwen3VlSceneAnalysisAdapter({
      transport,
      clock: clockWithLatency(7),
    });
    const result = await adapter.analyze(await analyzeInput({ authorization }));

    expect(transport.getCallCount()).toBe(1);
    expect(result).toMatchObject({
      providerKey: 'alibaba-cloud-model-studio',
      requestedModelId: 'qwen3.6-flash-2026-04-16',
      observedModelId: 'qwen3.6-flash-2026-04-16',
      finishReason: 'stop',
      usage: { prompt_tokens: 1_000, completion_tokens: 200, total_tokens: 1_200 },
      calculatedListCost: { calculatedListCostMicros: '363' },
      latencyMs: 7,
    });
    expect(result.proposal.composition).toMatchObject({
      kind: 'composition_proposal',
      sourceAssetSha256: bindings[0]!.normalizedSource.sha256,
    });
    const safeResultText = JSON.stringify(result);
    expect(safeResultText).not.toContain('data:image');
    expect(safeResultText).not.toContain('You are the scene-analysis stage');
    expect(safeResultText).not.toContain('authorization');
    expect(safeResultText).not.toContain('Bearer');
  });

  it('preserves every documented nullable usage-detail field without accepting extensions', async () => {
    const output = createDeterministicOracleMatchingQwenOutputV1('banner-person-v1');
    const usage = {
      prompt_tokens: 1_000,
      completion_tokens: 200,
      total_tokens: 1_200,
      prompt_tokens_details: {
        audio_tokens: null,
        cached_tokens: 20,
        text_tokens: 500,
        image_tokens: 480,
        video_tokens: 0,
        cache_creation: {
          ephemeral_5m_input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_type: 'ephemeral',
        },
      },
      completion_tokens_details: {
        audio_tokens: null,
        reasoning_tokens: null,
        text_tokens: 200,
      },
    } as const;
    const transport = createDeterministicQwenTransport([{ kind: 'success', output, usage }]);
    const adapter = createQwen3VlSceneAnalysisAdapter({
      transport,
      clock: clockWithLatency(),
    });
    const result = await adapter.analyze(
      await analyzeInput({
        authorization: createQwenDryRunExecutionAuthorization({ nowMs: fixedNowMs }),
      }),
    );
    expect(result.usage).toEqual(usage);

    const invalidUsageDetails = [
      {
        ...usage,
        prompt_tokens_details: { ...usage.prompt_tokens_details, cached_tokens: null },
      },
      {
        ...usage,
        prompt_tokens_details: { ...usage.prompt_tokens_details, future_tokens: 1 },
      },
      {
        ...usage,
        prompt_tokens_details: {
          ...usage.prompt_tokens_details,
          cache_creation: { ...usage.prompt_tokens_details.cache_creation, future_field: 1 },
        },
      },
      {
        ...usage,
        prompt_tokens_details: {
          ...usage.prompt_tokens_details,
          cache_creation: {
            ...usage.prompt_tokens_details.cache_creation,
            cache_creation_input_tokens: 1,
          },
        },
      },
    ] as unknown as readonly QwenProviderUsageV1[];
    for (const invalidUsage of invalidUsageDetails) {
      const rejectingTransport = createDeterministicQwenTransport([
        { kind: 'success', output, usage: invalidUsage },
      ]);
      const rejectingAdapter = createQwen3VlSceneAnalysisAdapter({
        transport: rejectingTransport,
        clock: clockWithLatency(),
      });
      const error = await captureQwenError(
        rejectingAdapter.analyze(
          await analyzeInput({
            authorization: createQwenDryRunExecutionAuthorization({ nowMs: fixedNowMs }),
          }),
        ),
      );
      expect(error).toMatchObject({
        reason: 'schema-invalid',
        accounting: {
          status: 'indeterminate',
          usage: null,
          calculatedListCost: null,
        },
      });
    }
  });

  it('rejects duplicate invocation without a second transport call', async () => {
    const output = createDeterministicOracleMatchingQwenOutputV1('banner-person-v1');
    const transport = createDeterministicQwenTransport([
      { kind: 'success', output },
      { kind: 'success', output },
    ]);
    const authorization = createQwenDryRunExecutionAuthorization({ nowMs: fixedNowMs });
    const adapter = createQwen3VlSceneAnalysisAdapter({ transport, clock: clockWithLatency() });
    const request = await analyzeInput({ authorization });
    await adapter.analyze(request);
    await expectReason(adapter.analyze(request), 'duplicate-invocation');
    expect(transport.getCallCount()).toBe(1);
  });

  it('aborts the injected transport signal on the real timeout path and never dispatches again', async () => {
    const transport = createDeterministicQwenTransport([{ kind: 'wait-for-abort' }]);
    const authorization = createQwenDryRunExecutionAuthorization({ nowMs: fixedNowMs });
    const clock = Object.freeze({
      nowEpochMs: () => fixedNowMs,
      nowMonotonicMs: () => performance.now(),
    });
    const adapter = createQwen3VlSceneAnalysisAdapter({ transport, clock });
    const input = await analyzeInput({ authorization });
    const error = await captureQwenError(
      adapter.analyze({
        ...input,
        context: {
          ...input.context,
          deadlineAtMs: EpochMillisecondsSchema.parse(fixedNowMs + 20),
        },
      }),
    );
    expect(error).toMatchObject({
      reason: 'timeout',
      accounting: { status: 'indeterminate', usage: null, calculatedListCost: null },
    });
    expect(transport.getAbortCount()).toBe(1);
    expect(transport.getCallCount()).toBe(1);
    await expectReason(adapter.analyze(input), 'duplicate-invocation');
    expect(transport.getCallCount()).toBe(1);
  });

  it('aborts the injected transport signal on live cancellation and never dispatches again', async () => {
    let cancelled = false;
    const cancellation = {
      get cancelled() {
        return cancelled;
      },
      throwIfCancelled(): void {
        if (cancelled) throw new Error('cancelled');
      },
    };
    const transport = createDeterministicQwenTransport([{ kind: 'wait-for-abort' }]);
    const authorization = createQwenDryRunExecutionAuthorization({ nowMs: fixedNowMs });
    const clock = Object.freeze({
      nowEpochMs: () => fixedNowMs,
      nowMonotonicMs: () => performance.now(),
    });
    const adapter = createQwen3VlSceneAnalysisAdapter({ transport, clock });
    const input = await analyzeInput({ authorization });
    const pending = adapter.analyze({
      ...input,
      context: { ...input.context, cancellation },
    });
    const cancelTimer = setTimeout(() => {
      cancelled = true;
    }, 5);
    const error = await captureQwenError(pending);
    clearTimeout(cancelTimer);
    expect(error).toMatchObject({
      reason: 'cancellation',
      accounting: { status: 'indeterminate', usage: null, calculatedListCost: null },
    });
    expect(transport.getAbortCount()).toBe(1);
    expect(transport.getCallCount()).toBe(1);
    await expectReason(
      adapter.analyze({ ...input, context: { ...input.context, cancellation } }),
      'cancellation',
    );
    expect(transport.getCallCount()).toBe(1);
  });

  it.each([
    ['malformed-json', 'malformed-json'],
    ['schema-invalid', 'schema-invalid'],
    ['timeout', 'timeout'],
    ['cancellation', 'cancellation'],
    ['missing-usage', 'missing-usage'],
    ['unexpected-model', 'unexpected-model'],
    ['unexpected-finish', 'unexpected-finish'],
    ['unknown-response-field', 'schema-invalid'],
  ] as const)('fails closed for deterministic %s transport behavior', async (kind, reason) => {
    const transport = createDeterministicQwenTransport([{ kind }]);
    const authorization = createQwenDryRunExecutionAuthorization({ nowMs: fixedNowMs });
    const adapter = createQwen3VlSceneAnalysisAdapter({ transport, clock: clockWithLatency() });
    await expectReason(adapter.analyze(await analyzeInput({ authorization })), reason);
    expect(transport.getCallCount()).toBe(1);
  });

  it.each(['qwen3-vl-flash-2026-01-22', 'qwen3.6-flash'] as const)(
    'rejects the non-pinned observed model identity %s',
    async (model) => {
      const transport = createDeterministicQwenTransport([{ kind: 'unexpected-model', model }]);
      const adapter = createQwen3VlSceneAnalysisAdapter({
        transport,
        clock: clockWithLatency(),
      });
      await expectReason(
        adapter.analyze(
          await analyzeInput({
            authorization: createQwenDryRunExecutionAuthorization({ nowMs: fixedNowMs }),
          }),
        ),
        'unexpected-model',
      );
      expect(transport.getCallCount()).toBe(1);
    },
  );

  it('classifies non-JSON non-2xx as HTTP failure and only strict error JSON as provider failure', async () => {
    for (const [kind, reason] of [
      ['http-error', 'http-error'],
      ['provider-error', 'provider-error'],
    ] as const) {
      const transport = createDeterministicQwenTransport([{ kind }]);
      const adapter = createQwen3VlSceneAnalysisAdapter({
        transport,
        clock: clockWithLatency(),
      });
      const error = await captureQwenError(
        adapter.analyze(
          await analyzeInput({
            authorization: createQwenDryRunExecutionAuthorization({ nowMs: fixedNowMs }),
          }),
        ),
      );
      expect(error.reason).toBe(reason);
      expect(error.accounting).toMatchObject({
        status: 'indeterminate',
        usage: null,
        calculatedListCost: null,
      });
      expect(transport.getCallCount()).toBe(1);
    }
  });

  it('retains latency, validated usage, and exact cost on every post-envelope failure', async () => {
    for (const kind of ['schema-invalid', 'unexpected-model', 'unknown-response-field'] as const) {
      const transport = createDeterministicQwenTransport([{ kind }]);
      const adapter = createQwen3VlSceneAnalysisAdapter({
        transport,
        clock: clockWithLatency(7),
      });
      const error = await captureQwenError(
        adapter.analyze(
          await analyzeInput({
            authorization: createQwenDryRunExecutionAuthorization({ nowMs: fixedNowMs }),
          }),
        ),
      );
      expect(error.accounting).toMatchObject({
        status: 'complete',
        latencyMs: 7,
        usage: { prompt_tokens: 1_000, completion_tokens: 200, total_tokens: 1_200 },
        calculatedListCost: { calculatedListCostMicros: '363' },
      });
    }
  });

  it('rejects a source-identity-mismatched output after strict JSON validation', async () => {
    const validOutput = createDeterministicOracleMatchingQwenOutputV1('banner-person-v1');
    if (validOutput.composition.kind !== 'composition_proposal') {
      throw new Error('Invalid test output.');
    }
    const output = {
      ...validOutput,
      composition: {
        ...validOutput.composition,
        sourceAssetSha256: 'f'.repeat(64) as typeof validOutput.composition.sourceAssetSha256,
      },
    };
    const transport = createDeterministicQwenTransport([{ kind: 'success', output }]);
    const authorization = createQwenDryRunExecutionAuthorization({ nowMs: fixedNowMs });
    const adapter = createQwen3VlSceneAnalysisAdapter({ transport, clock: clockWithLatency() });
    await expectReason(adapter.analyze(await analyzeInput({ authorization })), 'identity-mismatch');
  });

  it('rejects request ID, fixture path, and export-name drift before transport dispatch', async () => {
    const fixture = await firstFixture();
    const output = createDeterministicOracleMatchingQwenOutputV1('banner-person-v1');
    const driftedRequests = [
      createSceneAnalysisModelRequestV1({
        requestId: 'qwen.banner-person-v1.run.2',
        modelInput: fixture.request.input,
      }),
      createSceneAnalysisModelRequestV1({
        requestId: fixture.request.requestIdentity.requestId,
        modelInput: {
          ...fixture.request.input,
          fixture: {
            ...fixture.request.input.fixture,
            repositoryPath:
              'packages/banner-ai/test/fixtures/real-model-benchmark/normalized/alternate/banner-person-v1.png',
          },
        },
      }),
      createSceneAnalysisModelRequestV1({
        requestId: fixture.request.requestIdentity.requestId,
        modelInput: {
          ...fixture.request.input,
          fixture: {
            ...fixture.request.input.fixture,
            exportName: 'qwen_banner_person_v1_drifted',
          },
        },
      }),
    ];

    for (const request of driftedRequests) {
      const transport = createDeterministicQwenTransport([{ kind: 'success', output }]);
      const adapter = createQwen3VlSceneAnalysisAdapter({
        transport,
        clock: clockWithLatency(),
      });
      await expectReason(
        adapter.analyze({
          request,
          normalizedImageBytes: fixture.bytes,
          context: {
            deadlineAtMs: EpochMillisecondsSchema.parse(fixedNowMs + 60_000),
            externalIdempotencyKey: null,
            cancellation: liveCancellation,
          },
          authorization: createQwenDryRunExecutionAuthorization({ nowMs: fixedNowMs }),
          secret: null,
        }),
        'identity-mismatch',
      );
      expect(transport.getCallCount()).toBe(0);
    }
  });

  it('rejects absent, cloned, and stale authorization before transport dispatch', async () => {
    const output = createDeterministicOracleMatchingQwenOutputV1('banner-person-v1');

    for (const authorization of [
      undefined,
      structuredClone(createQwenDryRunExecutionAuthorization({ nowMs: fixedNowMs })),
    ]) {
      const transport = createDeterministicQwenTransport([{ kind: 'success', output }]);
      const adapter = createQwen3VlSceneAnalysisAdapter({ transport, clock: clockWithLatency() });
      await expectReason(
        adapter.analyze(
          await analyzeInput(
            authorization === undefined
              ? undefined
              : {
                  authorization: authorization as ReturnType<
                    typeof createQwenDryRunExecutionAuthorization
                  >,
                },
          ),
        ),
        'authorization-missing',
      );
      expect(transport.getCallCount()).toBe(0);
    }

    const staleTransport = createDeterministicQwenTransport([{ kind: 'success', output }]);
    const staleAuthorization = createQwenDryRunExecutionAuthorization({ nowMs: fixedNowMs });
    const staleAdapter = createQwen3VlSceneAnalysisAdapter({
      transport: staleTransport,
      clock: clockWithLatency(7, fixedNowMs + 600_000),
    });
    await expectReason(
      staleAdapter.analyze(await analyzeInput({ authorization: staleAuthorization })),
      'authorization-stale',
    );
    expect(staleTransport.getCallCount()).toBe(0);
  });

  it('rejects a foreign workspace before minting dry-run authority', () => {
    expect(() =>
      createQwenDryRunExecutionAuthorization({
        nowMs: fixedNowMs,
        serverWorkspaceId: 'workspace-eu-001',
      }),
    ).toThrow();
  });

  it('keeps native fetch inert without opaque live authorization and keeps Qwen off public/web surfaces', async () => {
    const fetchImplementation = vi.fn();
    const nativeTransport = createQwen3VlNativeFetchTransport({
      fetchImplementation: fetchImplementation as unknown as typeof globalThis.fetch,
    });
    const adapter = createQwen3VlSceneAnalysisAdapter({
      transport: nativeTransport,
      clock: clockWithLatency(),
    });
    await expectReason(adapter.analyze(await analyzeInput()), 'authorization-missing');
    expect(fetchImplementation).not.toHaveBeenCalled();

    for (const symbol of [
      'createQwen3VlNativeFetchTransport',
      'createQwen3VlSceneAnalysisAdapter',
      'mintQwenBenchmarkExecutionAuthorization',
      'runQwenFourFixtureBenchmark',
      'DASHSCOPE_API_KEY',
    ]) {
      expect(publicBannerAi).not.toHaveProperty(symbol);
    }
    const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
    const webSourceRoot = join(repositoryRoot, 'apps/web/src');
    for (const sourcePath of collectTypeScriptSources(webSourceRoot)) {
      const source = readFileSync(sourcePath, 'utf8');
      expect(source, sourcePath).not.toMatch(
        /qwen3(?:-vl|[._-]6)|qwen-four-fixture|dashscope_api_key|aliyuncs\.com|executionAuthorized/iu,
      );
    }
  });

  it('pins authorization to corpus, oracle, policy, workflow, requests, pricing, and caps', () => {
    expect({
      pending: QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256,
      oracle: QWEN_FOUR_FIXTURE_HUMAN_ORACLE_CORPUS_SHA256,
      policy: BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
      workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1.definitionSha256,
      orderedInputs: QWEN_FOUR_FIXTURE_ACTIVE_MODEL_INPUT_DIGESTS_SHA256,
      request: QWEN3_VL_REQUEST_SHAPE_SHA256,
      pricing: QWEN3_VL_PRICING_EVIDENCE_SHA256,
      caps: QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256,
    }).toEqual({
      pending: 'fa3ecc650a14611e6274b123b65ee7fcf34fe9443cb1125655b70393195e7f51',
      oracle: 'aa499d5560a97a2bf7df84fd0240f39941a82f485f804a42a608d96cb9acba51',
      policy: BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
      workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1.definitionSha256,
      orderedInputs: '1f2f53250b1032e12676041439e40f06532d8a69fb68d2cd00f5e388eaac5e2c',
      request: '6a540409b86a7b7e7c677ddc5fb5bd3d9bab7ee35758a1da3679ade49af8fb27',
      pricing: '67896b153548b82d6a16ba711ef452d7827b9d530bc9d8498b03f0c2a6ea71c9',
      caps: QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256,
    });
    expect(QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_SHA256).toBe(
      '4dc9f1265bf0494784026836f42506f0b8f42e045862376318e905b437629041',
    );
    expect(QWEN_FOUR_FIXTURE_HISTORICAL_V1_BINDING_SHA256).toBe(
      'd6b0957ca617139b382b0585570ecf27c5a00a050a45c2b729c2f251bf7bd252',
    );
    expect(QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_V1).toEqual([
      {
        algorithm: 'sha256',
        sha256: '37587bbb606959667e5bf7aa411d5537b6e508212e4385945307d95d6b623a4b',
      },
      {
        algorithm: 'sha256',
        sha256: '3a27f576e1a62f9a4192b53f6aa0192a1d68bb4663dd39a9510a3b652d88e6f0',
      },
      {
        algorithm: 'sha256',
        sha256: 'cee2b1998a993e5fca997274609180ebbd8c0dd24875ebeb4b82faf16e72f1f4',
      },
      {
        algorithm: 'sha256',
        sha256: '7f4adffd88f5b8ad7e2b814b8841634a029464c5c059a2cb36cfbbc7f59cd006',
      },
    ]);
    expect(QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_V1).toEqual(
      QWEN_FOUR_FIXTURE_CANONICAL_REQUEST_CATALOG_V1.map((entry) => entry.inputDigest),
    );
    expect(QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_V1).toHaveLength(4);
  });
});
