import { describe, expect, it } from 'vitest';

import {
  QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT,
  QWEN3_VL_HISTORICAL_PRICING_EVIDENCE_SHA256,
  QWEN3_VL_HISTORICAL_FRANKFURT_CHAT_COMPLETIONS_ENDPOINT,
  QWEN3_VL_PRICING_EVIDENCE_V2_SHA256,
  QWEN3_VL_PROVIDER_IDENTITY_V2_SHA256,
  QWEN3_VL_PROVIDER_IDENTITY_V1_SHA256,
  QWEN3_VL_MODEL_AVAILABILITY_EVIDENCE_V2_SHA256,
  QWEN3_VL_MODEL_LIFECYCLE_EVIDENCE_V2_SHA256,
  QWEN3_VL_MODEL_AVAILABILITY_EVIDENCE_V1_SHA256,
  QWEN3_VL_MODEL_LIFECYCLE_EVIDENCE_V1_SHA256,
  QWEN3_VL_REQUEST_SHAPE_V3_SHA256,
  QWEN3_VL_SERVER_WORKSPACE_ID,
  QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2_SHA256,
  QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V3,
  QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V3_SHA256,
  QWEN3_VL_REQUEST_SHAPE_V2_SHA256,
  QWEN3_VL_PRICING_EVIDENCE_V1_SHA256,
  QwenProviderUsageV1Schema,
  QwenCalculatedListCostV2Schema,
  calculateQwen3VlListCostMicros,
  deriveQwenFrankfurtChatCompletionsEndpoint,
  deriveQwenSingaporeChatCompletionsEndpoint,
} from '../src/evaluation/qwen3-vl-candidate-evidence.js';
import {
  createQwenDryRunExecutionAuthorization,
  createQwenDiagnosticAuthorizationPacketV4,
  createQwenDiagnosticAuthorizationPacketV3,
  createQwenManualReleaseBindingV1,
  mintQwenBenchmarkExecutionAuthorization,
  preflightQwenLiveExecutionAuthorization,
} from '../src/server/qwen3-vl-scene-analysis-adapter.js';
import { createQwen3VlNativeFetchTransport } from '../src/server/qwen3-vl-native-fetch-transport.js';
import { QWEN_FOUR_FIXTURE_ACTIVE_MODEL_INPUT_DIGESTS_SHA256 } from '../src/server/qwen-four-fixture-request-catalog.js';

describe('Qwen Singapore provider revision', () => {
  const currentGitSha = '45b3ceaf311008fb5c84cc8f8ea236d7846a20bf';
  const liveNowMs = Date.parse('2026-07-16T19:00:00.000Z');
  const manualReleaseFor = (
    id: string,
    issuedAtMs = liveNowMs - 1_000,
    expiresAtMs = liveNowMs + 600_000,
  ) =>
    createQwenManualReleaseBindingV1({
      releaseId: `qwen.manual.${id}`,
      issuedAtMs,
      expiresAtMs,
    });
  it('pins Singapore and rejects Frankfurt, foreign workspaces, and aliases', () => {
    expect(QWEN3_VL_SERVER_WORKSPACE_ID).toBe('ws-4ei01ync8iyumgp4');
    expect(QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT).toBe(
      'https://ws-4ei01ync8iyumgp4.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
    );
    expect(deriveQwenSingaporeChatCompletionsEndpoint(QWEN3_VL_SERVER_WORKSPACE_ID)).toBe(
      QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT,
    );
    expect(QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT).not.toBe(
      QWEN3_VL_HISTORICAL_FRANKFURT_CHAT_COMPLETIONS_ENDPOINT,
    );
    expect(deriveQwenFrankfurtChatCompletionsEndpoint('ws-4ei01ync8iyumgp4')).not.toBe(
      QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT,
    );
    expect(() => deriveQwenSingaporeChatCompletionsEndpoint('ws-foreign')).toThrow();
    expect(() =>
      deriveQwenSingaporeChatCompletionsEndpoint('ws-4ei01ync8iyumgp4.eu-central-1'),
    ).toThrow();
  });

  it('uses exact Singapore pricing, implicit one-fifth cache, and the 70,144 proof', () => {
    expect(
      QwenProviderUsageV1Schema.safeParse({
        prompt_tokens: 256_000,
        completion_tokens: 4_096,
        total_tokens: 260_096,
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
      calculateQwen3VlListCostMicros({
        prompt_tokens: 256_000,
        completion_tokens: 4_096,
        total_tokens: 260_096,
      }).calculatedListCostMicros,
    ).toBe('70144');
    expect(
      calculateQwen3VlListCostMicros({
        prompt_tokens: 10_000,
        completion_tokens: 1_000,
        total_tokens: 11_000,
        prompt_tokens_details: { cached_tokens: 10_000 },
      }),
    ).toMatchObject({
      inputMicrosPerMillionTokens: 250_000,
      cachedInputMicrosPerMillionTokens: 50_000,
      calculatedListCostMicros: '2000',
    });
    expect(QWEN3_VL_PRICING_EVIDENCE_V2_SHA256).toBe(
      '09badc6f060ba9f30943c2f54f480f58ef9a884da50767cf6ba8072ab0fba56c',
    );
  });

  it('versions caps and keeps historical V2 unchanged', () => {
    expect(QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2_SHA256).toBe(
      '4099960771c16079383d6f520633265c3113a5fd4b121154afeda5935314b81c',
    );
    expect(QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V3.totalCalculatedListCostMaximumMicroUsd).toBe(
      '100000',
    );
    expect(QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V3_SHA256).toBe(
      'fa713b888cdf5ca03e4e4f34654aa910978fde5d163758cc84b25a74cc4772f1',
    );
    expect(QWEN3_VL_PROVIDER_IDENTITY_V2_SHA256).toBe(
      '46edd18a06371a25617a4dd8dd54e1c3d51c1d3616beb2a7ed5965ad8f1d961e',
    );
    expect(QWEN3_VL_REQUEST_SHAPE_V3_SHA256).toBe(
      '6db92da8ad630244d1e45ee63d9fb64de97f57c03ebdd5b851952436549a3252',
    );
  });

  it('dry-run binds Singapore without reading a secret, and historical packets cannot mint', () => {
    const authorization = createQwenDryRunExecutionAuthorization({
      nowMs: 1_784_064_000_000,
      currentGitSha,
    });
    expect(authorization.endpoint).toBe(QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT);
    expect(() =>
      mintQwenBenchmarkExecutionAuthorization({
        authorizationVersion: 2,
        authorizationId: 'qwen.historical.frankfurt.packet',
        mode: 'live-provider',
        purpose: 'one-capped-four-fixture-sequential-zero-retry-benchmark',
        issuedAtMs: 1,
        expiresAtMs: 2,
        serverWorkspaceId: 'ws-vy71dtw49uzef5hz',
        endpoint: QWEN3_VL_HISTORICAL_FRANKFURT_CHAT_COMPLETIONS_ENDPOINT,
        endpointMethod: 'POST',
        apiFamily: 'openai-compatible-chat-completions',
        providerKey: 'alibaba-cloud-model-studio',
        requestedModelId: 'qwen3.6-flash-2026-04-16',
        secretReferenceName: 'DASHSCOPE_API_KEY',
        pendingCorpusCoreSha256: 'fa3ecc650a14611e6274b123b65ee7fcf34fe9443cb1125655b70393195e7f51',
        humanOracleCorpusSha256: 'aa499d5560a97a2bf7df84fd0240f39941a82f485f804a42a608d96cb9acba51',
        pricingEvidenceSha256: '67896b153548b82d6a16ba711ef452d7827b9d530bc9d8498b03f0c2a6ea71c9',
        pricingEvidenceRetrievedDate: '2026-07-15',
        providerProtocolWrapperSha256:
          '87497d39a04ca12210500179b8e6705f03788d06a20bec8bf7cd6de29f6c6025',
        requestShapeSha256: '6a540409b86a7b7e7c677ddc5fb5bd3d9bab7ee35758a1da3679ade49af8fb27',
        benchmarkCapsSha256: '5db7c7525440174bcbedbe6a1ab3e335a7ac9211e350fb8889ede111c0953c48',
        contentPolicyDefinitionSha256:
          '14a27c163a4082a966971028e59b6d1d56ea9cde99038b823c0a18b1ea92d0c4',
        workflowDefinitionSha256:
          'e3784eefd371b1bf343db9e2dfb97697f2fe5889c8374fe777316add8a59230c',
        orderedModelInputDigestsSha256:
          '30f201efb10000507ed77982b9b340a459b0fd1715af5c5203bd53b77673ae68',
        executionAuthorized: true,
      }),
    ).toThrow();
  });

  it('pins active and historical evidence digests and rejects wrong-tier accounting', () => {
    expect(QWEN3_VL_PROVIDER_IDENTITY_V1_SHA256).toBe(
      '60e7fcc590485516bdf93ba91097a73c81c292247c98d0263cc252b2c908c124',
    );
    expect(QWEN3_VL_MODEL_AVAILABILITY_EVIDENCE_V1_SHA256).toBe(
      'a521d3588a96127f2bd98fcca389d56bdccdd2f9f0735803401fc231fe1fa3d2',
    );
    expect(QWEN3_VL_MODEL_LIFECYCLE_EVIDENCE_V1_SHA256).toBe(
      '877272c38f0dc4ebcba2f2d0b88c76463f9b78a3fb66675a52f1a288be78e0ec',
    );
    expect(QWEN3_VL_MODEL_AVAILABILITY_EVIDENCE_V2_SHA256).toBe(
      '35036d470efee041b5f3daa5a9c17f4c84b739a69cb594c6c0f89ed13e3e7b87',
    );
    expect(QWEN3_VL_MODEL_LIFECYCLE_EVIDENCE_V2_SHA256).toBe(
      'ddc258e30902c60855d942405cfed6d8c2ce4fe7975de31f46cfad4bc55f5647',
    );
    expect(QWEN3_VL_PRICING_EVIDENCE_V1_SHA256).toBe(QWEN3_VL_HISTORICAL_PRICING_EVIDENCE_SHA256);
    expect(QWEN3_VL_REQUEST_SHAPE_V2_SHA256).toBe(
      '6a540409b86a7b7e7c677ddc5fb5bd3d9bab7ee35758a1da3679ade49af8fb27',
    );
    expect(QWEN_FOUR_FIXTURE_ACTIVE_MODEL_INPUT_DIGESTS_SHA256).toBe(
      '3f054e4b8ed25273bb71fed3416583b49619334aea67c1b9c34897fd3632e8f7',
    );
    expect(() =>
      QwenCalculatedListCostV2Schema.parse({
        currency: 'USD',
        unit: 'micro-USD',
        calculation: 'official-list-price-not-provider-reported-cost',
        rounding: 'ceiling-after-combining-input-and-output-rationals',
        inputTokenTierMaximumInclusive: 1_000_000,
        inputMicrosPerMillionTokens: 1_000_000,
        outputMicrosPerMillionTokens: 4_000_000,
        cachedInputRateFractionOfStandard: { numerator: 1, denominator: 5 },
        cachedInputMicrosPerMillionTokens: 200_000,
        uncachedPromptTokens: 10,
        cachedPromptTokens: 0,
        completionTokens: 0,
        calculatedListCostMicros: '10',
      }),
    ).toThrow();
  });

  it('requires a fresh caller-supplied release and exact current Git SHA', () => {
    const base = {
      authorizationId: 'qwen.manual.acceptance.0001',
      issuedAtMs: liveNowMs - 1_000,
      expiresAtMs: liveNowMs + 599_000,
      gitSha: currentGitSha,
      responseArtifactRelativePath:
        '.local-data/banner-ai/qwen-response-diagnostic-manual-acceptance-response.json',
      diagnosticReportRelativePath:
        '.local-data/banner-ai/qwen-response-diagnostic-report-manual-acceptance-report.json',
    } as const;
    expect(() => createQwenDiagnosticAuthorizationPacketV4(base as never)).toThrow();
    const release = createQwenManualReleaseBindingV1({
      releaseId: 'qwen.manual.acceptance.release.0001',
      issuedAtMs: base.issuedAtMs - 1_000,
      expiresAtMs: base.expiresAtMs + 1_000,
    });
    const packet = createQwenDiagnosticAuthorizationPacketV4({ ...base, manualRelease: release });
    expect(() => mintQwenBenchmarkExecutionAuthorization(packet)).toThrow();
    expect(
      preflightQwenLiveExecutionAuthorization({
        packet,
        secretPresent: true,
        nowMs: liveNowMs,
        currentGitSha,
      }).authorizationVersion,
    ).toBe(4);
    expect(() =>
      preflightQwenLiveExecutionAuthorization({
        packet,
        secretPresent: true,
        nowMs: liveNowMs,
        currentGitSha: `${currentGitSha.slice(0, -1)}0`,
      }),
    ).toThrow();
    expect(() =>
      createQwenManualReleaseBindingV1({
        releaseId: 'qwen.manual.acceptance.release.overlong',
        issuedAtMs: liveNowMs,
        expiresAtMs: liveNowMs + 900_001,
      }),
    ).toThrow();
    const oldPacket = createQwenDiagnosticAuthorizationPacketV4({
      ...base,
      issuedAtMs: liveNowMs - 60_000,
      expiresAtMs: liveNowMs + 539_000,
      manualRelease: manualReleaseFor('old-packet', liveNowMs - 1_000, liveNowMs + 600_000),
    });
    expect(() =>
      preflightQwenLiveExecutionAuthorization({
        packet: oldPacket,
        secretPresent: true,
        nowMs: liveNowMs,
        currentGitSha,
      }),
    ).toThrow();
    expect(() =>
      preflightQwenLiveExecutionAuthorization({
        packet: { ...packet, manualRelease: { ...release, releaseSha256: '0'.repeat(64) } },
        secretPresent: true,
        nowMs: liveNowMs,
        currentGitSha,
      }),
    ).toThrow();
    const staleRelease = createQwenManualReleaseBindingV1({
      releaseId: 'qwen.manual.acceptance.release.0002',
      issuedAtMs: liveNowMs - 700_000,
      expiresAtMs: liveNowMs - 200_000,
    });
    const stalePacket = createQwenDiagnosticAuthorizationPacketV4({
      ...base,
      manualRelease: staleRelease,
    });
    expect(() =>
      preflightQwenLiveExecutionAuthorization({
        packet: stalePacket,
        secretPresent: true,
        nowMs: liveNowMs,
        currentGitSha,
      }),
    ).toThrow();
  });

  it('rejects every non-Singapore endpoint before injected fetch', async () => {
    let fetchCalls = 0;
    const native = createQwen3VlNativeFetchTransport({
      fetchImplementation: async () => {
        fetchCalls += 1;
        return new Response('{}', { status: 200 });
      },
    });
    const invalidEndpoints = [
      QWEN3_VL_HISTORICAL_FRANKFURT_CHAT_COMPLETIONS_ENDPOINT,
      'https://ws-foreign.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
      'https://ws-4ei01ync8iyumgp4.eu-central-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
      'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      'https://trial.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
      'https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
      'https://coding-intl.dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      'https://arbitrary.example.test/v1/chat/completions',
      'https://user:password@ws-4ei01ync8iyumgp4.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions',
      'https://ws-4ei01ync8iyumgp4.ap-southeast-1.maas.aliyuncs.com:443/compatible-mode/v1/chat/completions',
      `${QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT}?x=1`,
      `${QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT}#fragment`,
    ];
    for (const endpoint of invalidEndpoints) {
      await expect(
        native.dispatch({
          endpoint,
          method: 'POST',
          secret: 'unit-test-secret',
          requestBodyText: '{}',
          signal: new AbortController().signal,
          timeoutMs: 1_000,
          mode: 'live-provider' as const,
          dispatchCapability: undefined as never,
        }),
      ).rejects.toThrow();
    }
    expect(fetchCalls).toBe(0);
  });

  it('rejects a manually mutated live four-fixture V4 packet before dispatch', () => {
    const packet = createQwenDiagnosticAuthorizationPacketV4({
      authorizationId: 'qwen.mode-relation.0001',
      issuedAtMs: liveNowMs - 1_000,
      expiresAtMs: liveNowMs + 599_000,
      gitSha: currentGitSha,
      manualRelease: createQwenManualReleaseBindingV1({
        releaseId: 'qwen.mode-relation.release.0001',
        issuedAtMs: liveNowMs - 2_000,
        expiresAtMs: liveNowMs + 601_000,
      }),
      responseArtifactRelativePath:
        '.local-data/banner-ai/qwen-response-diagnostic-mode-relation-response.json',
      diagnosticReportRelativePath:
        '.local-data/banner-ai/qwen-response-diagnostic-report-mode-relation-report.json',
    });
    const mutated = {
      ...packet,
      purpose: 'one-capped-four-fixture-sequential-zero-retry-benchmark' as const,
      diagnosticCapture: undefined,
    };
    expect(() => mintQwenBenchmarkExecutionAuthorization(mutated)).toThrow();
  });

  it('keeps the historical 50,000 cap non-dispatchable while active 100,000 passes', () => {
    const active = createQwenDiagnosticAuthorizationPacketV4({
      authorizationId: 'qwen.cap.acceptance.0001',
      issuedAtMs: liveNowMs - 1_000,
      expiresAtMs: liveNowMs + 599_000,
      gitSha: currentGitSha,
      manualRelease: createQwenManualReleaseBindingV1({
        releaseId: 'qwen.cap.acceptance.release.0001',
        issuedAtMs: liveNowMs - 2_000,
        expiresAtMs: liveNowMs + 601_000,
      }),
      responseArtifactRelativePath:
        '.local-data/banner-ai/qwen-response-diagnostic-cap-acceptance-response.json',
      diagnosticReportRelativePath:
        '.local-data/banner-ai/qwen-response-diagnostic-report-cap-acceptance-report.json',
    });
    expect(active.diagnosticCapture?.totalCalculatedListCostMaximumMicroUsd).toBe('100000');
    expect(() =>
      mintQwenBenchmarkExecutionAuthorization({
        ...active,
        diagnosticCapture: {
          ...active.diagnosticCapture!,
          totalCalculatedListCostMaximumMicroUsd: '50000',
        },
      }),
    ).toThrow();
    const historical = createQwenDiagnosticAuthorizationPacketV3({
      authorizationId: 'qwen.cap.historical.0001',
      issuedAtMs: 1_784_068_000_000,
      expiresAtMs: 1_784_068_600_000,
      responseArtifactRelativePath:
        '.local-data/banner-ai/qwen-response-diagnostic-cap-historical-response.json',
      diagnosticReportRelativePath:
        '.local-data/banner-ai/qwen-response-diagnostic-report-cap-historical-report.json',
    });
    expect(() => mintQwenBenchmarkExecutionAuthorization(historical)).toThrow();
  });
});
