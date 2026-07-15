import { z } from 'zod';

import { digestValidatedCapabilityRequest } from '../jobs/request-digests.js';
import {
  parseCapabilityCallContext,
  type CapabilityCallContext,
} from '../ports/banner-capability-ports.js';
import { assertCanonicalNormalizedPng } from '../security/raster-container.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
  INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
  createModelProducedActualTextObservationSetV1,
  validateSceneAnalysisModelDispatchContentPolicyV1,
  validateSceneAnalysisRequestContextV1,
  type SceneAnalysisModelRequestV1,
} from '../evaluation/ai-contracts.js';
import {
  QWEN3_VL_API_FAMILY,
  QWEN3_VL_ENDPOINT_METHOD,
  QWEN3_VL_FLASH_MODEL_CONTRACT_V1,
  QWEN3_VL_MAX_OUTPUT_TOKENS,
  QWEN3_VL_OFFICIAL_EVIDENCE_RETRIEVED_DATE,
  QWEN3_VL_PRICING_EVIDENCE_SHA256,
  QWEN3_VL_PROVIDER_KEY,
  QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V1,
  QWEN3_VL_REQUESTED_MODEL_ID,
  QWEN3_VL_REQUEST_SHAPE_SHA256,
  QWEN3_VL_SECRET_REFERENCE_NAME,
  QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256,
  QWEN_FOUR_FIXTURE_HUMAN_ORACLE_CORPUS_SHA256,
  QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256,
  QwenProviderUsageV1Schema,
  QwenServerWorkspaceIdSchema,
  assertQwen3VlOfficialEvidenceFresh,
  calculateQwen3VlListCostMicros,
  deriveQwenFrankfurtChatCompletionsEndpoint,
  type QwenProviderUsageV1,
} from '../evaluation/qwen3-vl-candidate-evidence.js';
import {
  parseProposedSceneAnalysisOcrJsonV1,
  type ProposedSceneAnalysisOcrOutputV1,
} from '../evaluation/openai-scene-analysis-output.js';
import { SCENE_ANALYSIS_PROMPT_V1 } from '../evaluation/prompt-catalog.js';
import { validateCompositionAnalysisResultV1 } from '../workflows/composition-contracts.js';
import {
  QWEN_FOUR_FIXTURE_CANONICAL_REQUEST_CATALOG_V1,
  QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_SHA256,
  requireCanonicalQwenBenchmarkRequestV1,
} from './qwen-four-fixture-request-catalog.js';

const QwenBenchmarkAuthorizationPacketV1Schema = z
  .strictObject({
    authorizationVersion: z.literal(1),
    authorizationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/u),
    mode: z.enum(['deterministic-fake', 'live-provider']),
    purpose: z.literal('one-capped-four-fixture-sequential-zero-retry-benchmark'),
    issuedAtMs: z.int().min(0),
    expiresAtMs: z.int().min(1),
    serverWorkspaceId: QwenServerWorkspaceIdSchema,
    endpoint: z.string().url(),
    endpointMethod: z.literal(QWEN3_VL_ENDPOINT_METHOD),
    apiFamily: z.literal(QWEN3_VL_API_FAMILY),
    providerKey: z.literal(QWEN3_VL_PROVIDER_KEY),
    requestedModelId: z.literal(QWEN3_VL_REQUESTED_MODEL_ID),
    secretReferenceName: z.literal(QWEN3_VL_SECRET_REFERENCE_NAME),
    pendingCorpusCoreSha256: z.literal(QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256),
    humanOracleCorpusSha256: z.literal(QWEN_FOUR_FIXTURE_HUMAN_ORACLE_CORPUS_SHA256),
    pricingEvidenceSha256: z.literal(QWEN3_VL_PRICING_EVIDENCE_SHA256),
    pricingEvidenceRetrievedDate: z.literal(QWEN3_VL_OFFICIAL_EVIDENCE_RETRIEVED_DATE),
    requestShapeSha256: z.literal(QWEN3_VL_REQUEST_SHAPE_SHA256),
    benchmarkCapsSha256: z.literal(QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256),
    contentPolicyDefinitionSha256: z.literal(
      BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
    ),
    workflowDefinitionSha256: z.literal(INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1.definitionSha256),
    orderedModelInputDigestsSha256: z.literal(QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_SHA256),
    executionAuthorized: z.literal(true),
  })
  .superRefine((authorization, context) => {
    if (
      authorization.issuedAtMs >= authorization.expiresAtMs ||
      authorization.endpoint !==
        deriveQwenFrankfurtChatCompletionsEndpoint(authorization.serverWorkspaceId)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Qwen authorization timing or derived endpoint is stale or foreign.',
      });
    }
  })
  .readonly();

export type QwenBenchmarkAuthorizationPacketV1 = z.infer<
  typeof QwenBenchmarkAuthorizationPacketV1Schema
>;

export interface QwenBenchmarkExecutionAuthorization {
  readonly authorizationVersion: 1;
  readonly authorizationId: string;
  readonly mode: 'deterministic-fake' | 'live-provider';
  readonly providerKey: typeof QWEN3_VL_PROVIDER_KEY;
  readonly requestedModelId: typeof QWEN3_VL_REQUESTED_MODEL_ID;
  readonly endpoint: string;
  readonly dispatchAuthority: true;
}

interface PrivateAuthorizationState {
  readonly packet: QwenBenchmarkAuthorizationPacketV1;
  readonly claimedInvocationKeys: Set<string>;
  readonly claimedFixtureIds: Set<string>;
}

const validAuthorizations = new WeakSet<object>();
const privateAuthorizationState = new WeakMap<object, PrivateAuthorizationState>();

export const mintQwenBenchmarkExecutionAuthorization = (
  input: unknown,
): QwenBenchmarkExecutionAuthorization => {
  const packet = QwenBenchmarkAuthorizationPacketV1Schema.parse(input);
  const authorization = Object.freeze({
    authorizationVersion: 1 as const,
    authorizationId: packet.authorizationId,
    mode: packet.mode,
    providerKey: QWEN3_VL_PROVIDER_KEY,
    requestedModelId: QWEN3_VL_REQUESTED_MODEL_ID,
    endpoint: packet.endpoint,
    dispatchAuthority: true as const,
  });
  validAuthorizations.add(authorization);
  privateAuthorizationState.set(authorization, {
    packet,
    claimedInvocationKeys: new Set<string>(),
    claimedFixtureIds: new Set<string>(),
  });
  return authorization;
};

export const createQwenDryRunExecutionAuthorization = (input: {
  readonly nowMs: number;
  readonly serverWorkspaceId?: string;
}): QwenBenchmarkExecutionAuthorization => {
  const nowMs = z.int().min(0).parse(input.nowMs);
  const serverWorkspaceId = QwenServerWorkspaceIdSchema.parse(
    input.serverWorkspaceId ?? 'dry-run-workspace',
  );
  return mintQwenBenchmarkExecutionAuthorization({
    authorizationVersion: 1,
    authorizationId: 'qwen.deterministic.fake.authorization.v1',
    mode: 'deterministic-fake',
    purpose: 'one-capped-four-fixture-sequential-zero-retry-benchmark',
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + 600_000,
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
    requestShapeSha256: QWEN3_VL_REQUEST_SHAPE_SHA256,
    benchmarkCapsSha256: QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256,
    contentPolicyDefinitionSha256: BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
    workflowDefinitionSha256: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1.definitionSha256,
    orderedModelInputDigestsSha256: QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_SHA256,
    executionAuthorized: true,
  });
};

export const preflightQwenLiveExecutionAuthorization = (input: {
  readonly packet: unknown;
  readonly secretPresent: unknown;
  readonly nowMs: number;
}): QwenBenchmarkExecutionAuthorization => {
  const nowMs = z.int().min(0).parse(input.nowMs);
  z.literal(true).parse(input.secretPresent);
  assertQwen3VlOfficialEvidenceFresh(nowMs);
  const packet = QwenBenchmarkAuthorizationPacketV1Schema.parse(input.packet);
  if (packet.mode !== 'live-provider' || nowMs < packet.issuedAtMs || nowMs >= packet.expiresAtMs) {
    throw new QwenSceneAnalysisError('authorization-stale');
  }
  return mintQwenBenchmarkExecutionAuthorization(packet);
};

const requireAuthorizationState = (input: unknown, nowMs: number): PrivateAuthorizationState => {
  if (typeof input !== 'object' || input === null || !validAuthorizations.has(input)) {
    throw new QwenSceneAnalysisError('authorization-missing');
  }
  const state = privateAuthorizationState.get(input);
  if (state === undefined) throw new QwenSceneAnalysisError('authorization-missing');
  if (nowMs < state.packet.issuedAtMs || nowMs >= state.packet.expiresAtMs) {
    throw new QwenSceneAnalysisError('authorization-stale');
  }
  return state;
};

export type QwenSceneAnalysisFailureReason =
  | 'authorization-missing'
  | 'authorization-stale'
  | 'cancellation'
  | 'duplicate-invocation'
  | 'http-error'
  | 'identity-mismatch'
  | 'malformed-json'
  | 'missing-usage'
  | 'provider-error'
  | 'schema-invalid'
  | 'timeout'
  | 'transport-failure'
  | 'unexpected-finish'
  | 'unexpected-model';

export type QwenAttemptAccounting =
  | {
      readonly status: 'not-dispatched';
      readonly latencyMs: null;
      readonly usage: null;
      readonly calculatedListCost: null;
    }
  | {
      readonly status: 'indeterminate';
      readonly latencyMs: number;
      readonly usage: null;
      readonly calculatedListCost: null;
    }
  | {
      readonly status: 'complete';
      readonly latencyMs: number;
      readonly usage: QwenProviderUsageV1;
      readonly calculatedListCost: ReturnType<typeof calculateQwen3VlListCostMicros>;
    };

type CompleteQwenAttemptAccounting = Extract<
  QwenAttemptAccounting,
  { readonly status: 'complete' }
>;

const NOT_DISPATCHED_ACCOUNTING: QwenAttemptAccounting = Object.freeze({
  status: 'not-dispatched',
  latencyMs: null,
  usage: null,
  calculatedListCost: null,
});

const safeMessageByReason: Readonly<Record<QwenSceneAnalysisFailureReason, string>> = Object.freeze(
  {
    'authorization-missing': 'Qwen execution authorization is missing or forged.',
    'authorization-stale': 'Qwen execution authorization is not fresh.',
    cancellation: 'Qwen scene analysis was cancelled.',
    'duplicate-invocation': 'Qwen invocation was already claimed.',
    'http-error': 'Qwen provider returned an unsuccessful HTTP status.',
    'identity-mismatch': 'Qwen result identity differs from the bound request.',
    'malformed-json': 'Qwen returned malformed JSON.',
    'missing-usage': 'Qwen response omitted required provider usage.',
    'provider-error': 'Qwen provider returned an error payload.',
    'schema-invalid': 'Qwen response failed strict runtime validation.',
    timeout: 'Qwen scene analysis timed out.',
    'transport-failure': 'Qwen transport failed without a validated provider response.',
    'unexpected-finish': 'Qwen response did not finish with the pinned complete-output reason.',
    'unexpected-model': 'Qwen response model identity differs from the pinned snapshot.',
  },
);

export class QwenSceneAnalysisError extends Error {
  readonly reason: QwenSceneAnalysisFailureReason;
  readonly accounting: QwenAttemptAccounting;

  constructor(
    reason: QwenSceneAnalysisFailureReason,
    accounting: QwenAttemptAccounting = NOT_DISPATCHED_ACCOUNTING,
  ) {
    super(safeMessageByReason[reason]);
    this.name = 'QwenSceneAnalysisError';
    this.reason = reason;
    this.accounting = accounting;
  }
}

export interface QwenTransportRequest {
  readonly endpoint: string;
  readonly method: typeof QWEN3_VL_ENDPOINT_METHOD;
  readonly secret: string | null;
  readonly requestBodyText: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
}

export interface QwenTransportResponse {
  readonly status: number;
  readonly bodyText: string;
}

export interface QwenTransportPort {
  readonly transportKind: 'deterministic-fake' | 'native-fetch';
  dispatch(request: QwenTransportRequest): Promise<QwenTransportResponse>;
}

export interface QwenAdapterClockPort {
  nowEpochMs(): number;
  nowMonotonicMs(): number;
}

const defaultClock: QwenAdapterClockPort = Object.freeze({
  nowEpochMs: () => Date.now(),
  nowMonotonicMs: () => performance.now(),
});

const QwenProviderErrorPayloadSchema = z
  .strictObject({
    error: z
      .strictObject({
        message: z.string().min(1).max(4_096),
        type: z.string().min(1).max(256),
        param: z.string().max(256).nullable().optional(),
        code: z.union([z.string().min(1).max(256), z.int()]),
      })
      .readonly(),
    request_id: z.string().min(1).max(256).optional(),
  })
  .readonly();

const QwenSuccessEnvelopeSchema = z
  .strictObject({
    id: z.string().min(1).max(256),
    object: z.literal('chat.completion'),
    created: z.int().min(0),
    model: z.string().min(1).max(256),
    choices: z
      .tuple([
        z
          .strictObject({
            index: z.literal(0),
            message: z
              .strictObject({
                role: z.literal('assistant'),
                content: z.string().min(1).max(2_000_000),
                refusal: z.null().optional(),
                audio: z.null().optional(),
                function_call: z.null().optional(),
                tool_calls: z.null().optional(),
              })
              .readonly(),
            finish_reason: z
              .enum(['stop', 'length', 'tool_calls', 'content_filter', 'function_call'])
              .nullable(),
            logprobs: z.null().optional(),
          })
          .readonly(),
      ])
      .readonly(),
    usage: QwenProviderUsageV1Schema,
    system_fingerprint: z.string().max(256).nullable().optional(),
    service_tier: z.null().optional(),
  })
  .readonly();

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const indeterminateAccounting = (latencyMs: number): QwenAttemptAccounting =>
  Object.freeze({
    status: 'indeterminate' as const,
    latencyMs,
    usage: null,
    calculatedListCost: null,
  });

const completeAccounting = (
  latencyMs: number,
  usage: QwenProviderUsageV1,
): CompleteQwenAttemptAccounting =>
  Object.freeze({
    status: 'complete' as const,
    latencyMs,
    usage,
    calculatedListCost: calculateQwen3VlListCostMicros(usage),
  });

const parseProviderEnvelope = (response: QwenTransportResponse, latencyMs: number) => {
  if (response.status < 200 || response.status >= 300) {
    try {
      const parsedError = JSON.parse(response.bodyText) as unknown;
      if (QwenProviderErrorPayloadSchema.safeParse(parsedError).success) {
        throw new QwenSceneAnalysisError('provider-error', indeterminateAccounting(latencyMs));
      }
    } catch (error) {
      if (error instanceof QwenSceneAnalysisError) throw error;
    }
    throw new QwenSceneAnalysisError('http-error', indeterminateAccounting(latencyMs));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.bodyText) as unknown;
  } catch {
    throw new QwenSceneAnalysisError('malformed-json', indeterminateAccounting(latencyMs));
  }
  if (QwenProviderErrorPayloadSchema.safeParse(parsed).success) {
    throw new QwenSceneAnalysisError('provider-error', indeterminateAccounting(latencyMs));
  }
  if (!isRecord(parsed) || !Object.hasOwn(parsed, 'usage')) {
    throw new QwenSceneAnalysisError('missing-usage', indeterminateAccounting(latencyMs));
  }
  const parsedUsage = QwenProviderUsageV1Schema.safeParse(parsed.usage);
  if (!parsedUsage.success) {
    throw new QwenSceneAnalysisError('schema-invalid', indeterminateAccounting(latencyMs));
  }
  const accounting = completeAccounting(latencyMs, parsedUsage.data);
  const envelope = QwenSuccessEnvelopeSchema.safeParse(parsed);
  if (!envelope.success) throw new QwenSceneAnalysisError('schema-invalid', accounting);
  if (envelope.data.model !== QWEN3_VL_REQUESTED_MODEL_ID) {
    throw new QwenSceneAnalysisError('unexpected-model', accounting);
  }
  if (envelope.data.choices[0].finish_reason !== 'stop') {
    throw new QwenSceneAnalysisError('unexpected-finish', accounting);
  }
  return envelope.data;
};

const validateTrustedNormalizedBytes = (
  request: SceneAnalysisModelRequestV1,
  normalizedImageBytes: Uint8Array,
): void => {
  const raster = assertCanonicalNormalizedPng(normalizedImageBytes);
  if (
    request.input.sourceAsset.mediaType !== 'image/png' ||
    request.input.sourceAsset.byteSize !== normalizedImageBytes.byteLength ||
    request.input.sourceAsset.pixelWidth !== raster.width ||
    request.input.sourceAsset.pixelHeight !== raster.height ||
    request.input.sourceAsset.sha256 !== sha256Hex(normalizedImageBytes)
  ) {
    throw new QwenSceneAnalysisError('identity-mismatch');
  }
};

const buildPrivateRequestBody = (
  normalizedImageBytes: Uint8Array,
): Readonly<Record<string, unknown>> =>
  Object.freeze({
    model: QWEN3_VL_REQUESTED_MODEL_ID,
    messages: Object.freeze([
      Object.freeze({
        role: 'system' as const,
        content: QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V1.content,
      }),
      Object.freeze({
        role: 'user' as const,
        content: Object.freeze([
          Object.freeze({
            type: 'image_url' as const,
            image_url: Object.freeze({
              url: `data:image/png;base64,${Buffer.from(normalizedImageBytes).toString('base64')}`,
            }),
          }),
        ]),
      }),
    ]),
    response_format: Object.freeze({ type: 'json_object' as const }),
    enable_thinking: false as const,
    enable_search: false as const,
    enable_code_interpreter: false as const,
    tools: Object.freeze([]),
    tool_choice: 'none' as const,
    parallel_tool_calls: false as const,
    stream: false as const,
    n: 1 as const,
    temperature: 0 as const,
    seed: 0 as const,
    max_tokens: QWEN3_VL_MAX_OUTPUT_TOKENS,
  });

const materializeValidatedProposal = (input: {
  readonly request: SceneAnalysisModelRequestV1;
  readonly providerOutput: ProposedSceneAnalysisOcrOutputV1;
}) => {
  const composition = validateCompositionAnalysisResultV1({
    request: {
      sourceAsset: input.request.input.sourceAsset,
      maxParts: input.request.input.options.maxParts,
      includeBackground: input.request.input.options.includeBackground,
    },
    result: input.providerOutput.composition,
  });
  if (
    composition.kind !== 'composition_proposal' ||
    composition.parts.length < 3 ||
    composition.parts.length > 5
  ) {
    throw new QwenSceneAnalysisError('schema-invalid');
  }
  const isNoTextFixture =
    input.request.input.fixture.repositoryPath.endsWith('/banner-no-text-v1.png');
  if (
    (isNoTextFixture &&
      (input.providerOutput.ocrCompletion.kind !== 'no-visible-text-observed' ||
        input.providerOutput.textObservations.length !== 0)) ||
    (!isNoTextFixture &&
      (input.providerOutput.ocrCompletion.kind !== 'visible-text-observations-complete' ||
        input.providerOutput.textObservations.length === 0))
  ) {
    throw new QwenSceneAnalysisError('identity-mismatch');
  }
  const textObservations = createModelProducedActualTextObservationSetV1({
    request: input.request,
    observations: input.providerOutput.textObservations,
  });
  return Object.freeze({
    composition,
    layerEvidence: input.providerOutput.layerEvidence,
    ocrCompletion: input.providerOutput.ocrCompletion,
    textObservations,
    reviewFlags: input.providerOutput.reviewFlags,
    humanReview: input.providerOutput.humanReview,
    decisionAuthority: 'proposal-requires-user-review' as const,
  });
};

const cancellationError = (): QwenSceneAnalysisError => new QwenSceneAnalysisError('cancellation');

export const createQwen3VlSceneAnalysisAdapter = (input: {
  readonly transport: QwenTransportPort;
  readonly clock?: QwenAdapterClockPort;
}) => {
  const transport = input.transport;
  const clock = input.clock ?? defaultClock;
  return Object.freeze({
    adapterVersion: 1 as const,
    providerKey: QWEN3_VL_PROVIDER_KEY,
    requestedModelId: QWEN3_VL_REQUESTED_MODEL_ID,
    endpointControl: 'server-derived-only' as const,
    remoteImageUrlsAccepted: false as const,
    async analyze(analyzeInput: {
      readonly request: unknown;
      readonly normalizedImageBytes: Uint8Array;
      readonly context: CapabilityCallContext;
      readonly authorization?: QwenBenchmarkExecutionAuthorization;
      readonly secret: string | null;
    }) {
      const nowMs = z.int().min(0).parse(clock.nowEpochMs());
      assertQwen3VlOfficialEvidenceFresh(nowMs);
      const authorizationState = requireAuthorizationState(analyzeInput.authorization, nowMs);
      if (
        (transport.transportKind === 'native-fetch' &&
          authorizationState.packet.mode !== 'live-provider') ||
        (transport.transportKind === 'deterministic-fake' &&
          authorizationState.packet.mode !== 'deterministic-fake')
      ) {
        throw new QwenSceneAnalysisError('authorization-missing');
      }
      if (
        transport.transportKind === 'native-fetch' &&
        (typeof analyzeInput.secret !== 'string' || analyzeInput.secret.length < 1)
      ) {
        throw new QwenSceneAnalysisError('authorization-missing');
      }
      if (transport.transportKind === 'deterministic-fake' && analyzeInput.secret !== null) {
        throw new QwenSceneAnalysisError('authorization-missing');
      }

      const context = parseCapabilityCallContext(analyzeInput.context);
      if (context.externalIdempotencyKey !== null) {
        throw new QwenSceneAnalysisError('identity-mismatch');
      }
      if (context.cancellation.cancelled) throw cancellationError();
      try {
        context.cancellation.throwIfCancelled();
      } catch {
        throw cancellationError();
      }

      const validatedRequest = validateSceneAnalysisRequestContextV1({
        request: validateSceneAnalysisModelDispatchContentPolicyV1(analyzeInput.request),
        expectedModel: QWEN3_VL_FLASH_MODEL_CONTRACT_V1,
        expectedWorkflow: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
      });
      let canonicalRequest;
      try {
        canonicalRequest = requireCanonicalQwenBenchmarkRequestV1(validatedRequest);
      } catch {
        throw new QwenSceneAnalysisError('identity-mismatch');
      }
      const request = canonicalRequest.request;
      if (
        request.input.prompt.contentSha256 !== SCENE_ANALYSIS_PROMPT_V1.contentSha256 ||
        request.contentPolicy.definition.definitionSha256 !==
          BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256 ||
        canonicalizeJson(request.input.options) !==
          canonicalizeJson({ maxParts: 5, includeBackground: true, preserveVisibleText: true })
      ) {
        throw new QwenSceneAnalysisError('identity-mismatch');
      }
      const fixtureId = canonicalRequest.fixtureId;
      validateTrustedNormalizedBytes(request, analyzeInput.normalizedImageBytes);

      const invocationKey = sha256Hex(
        Buffer.from(
          canonicalizeJson({
            authorizationId: authorizationState.packet.authorizationId,
            requestSha256: digestValidatedCapabilityRequest(request),
            inputDigest: request.requestIdentity.inputDigest,
          }),
          'utf8',
        ),
      );
      if (
        authorizationState.claimedInvocationKeys.has(invocationKey) ||
        authorizationState.claimedFixtureIds.has(fixtureId) ||
        authorizationState.claimedFixtureIds.size >=
          QWEN_FOUR_FIXTURE_CANONICAL_REQUEST_CATALOG_V1.length
      ) {
        throw new QwenSceneAnalysisError('duplicate-invocation');
      }
      authorizationState.claimedInvocationKeys.add(invocationKey);
      authorizationState.claimedFixtureIds.add(fixtureId);

      const timeoutMs = Math.min(60_000, context.deadlineAtMs - nowMs);
      if (timeoutMs <= 0) throw new QwenSceneAnalysisError('timeout');
      const requestBodyText = JSON.stringify(
        buildPrivateRequestBody(analyzeInput.normalizedImageBytes),
      );
      const controller = new AbortController();
      let termination: 'cancellation' | 'timeout' | null = null;
      const timeout = setTimeout(() => {
        termination = 'timeout';
        controller.abort();
      }, timeoutMs);
      timeout.unref?.();
      const cancellationPoll = setInterval(() => {
        if (context.cancellation.cancelled) {
          termination = 'cancellation';
          controller.abort();
        }
      }, 25);
      cancellationPoll.unref?.();
      const startedAt = clock.nowMonotonicMs();
      const elapsedLatencyMs = (): number =>
        Math.max(0, Math.ceil(clock.nowMonotonicMs() - startedAt));
      let transportResponse: QwenTransportResponse;
      try {
        transportResponse = await transport.dispatch({
          endpoint: authorizationState.packet.endpoint,
          method: QWEN3_VL_ENDPOINT_METHOD,
          secret: analyzeInput.secret,
          requestBodyText,
          timeoutMs,
          signal: controller.signal,
        });
      } catch (error) {
        const accounting = indeterminateAccounting(elapsedLatencyMs());
        if (error instanceof Error && error.name === 'CancellationError') {
          throw new QwenSceneAnalysisError('cancellation', accounting);
        }
        if (termination === 'cancellation' || context.cancellation.cancelled) {
          throw new QwenSceneAnalysisError('cancellation', accounting);
        }
        if (
          termination === 'timeout' ||
          (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError'))
        ) {
          throw new QwenSceneAnalysisError('timeout', accounting);
        }
        throw new QwenSceneAnalysisError('transport-failure', accounting);
      } finally {
        clearTimeout(timeout);
        clearInterval(cancellationPoll);
      }
      const latencyMs = elapsedLatencyMs();
      if (context.cancellation.cancelled) {
        throw new QwenSceneAnalysisError('cancellation', indeterminateAccounting(latencyMs));
      }
      const envelope = parseProviderEnvelope(transportResponse, latencyMs);
      const accounting = completeAccounting(latencyMs, envelope.usage);
      let providerOutput: ProposedSceneAnalysisOcrOutputV1;
      try {
        providerOutput = parseProposedSceneAnalysisOcrJsonV1(envelope.choices[0].message.content);
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new QwenSceneAnalysisError('schema-invalid', accounting);
        }
        throw new QwenSceneAnalysisError('malformed-json', accounting);
      }
      let proposal;
      try {
        proposal = materializeValidatedProposal({ request, providerOutput });
      } catch (error) {
        if (error instanceof QwenSceneAnalysisError) {
          throw new QwenSceneAnalysisError(error.reason, accounting);
        }
        throw new QwenSceneAnalysisError('identity-mismatch', accounting);
      }
      return Object.freeze({
        resultVersion: 1 as const,
        providerKey: QWEN3_VL_PROVIDER_KEY,
        apiFamily: QWEN3_VL_API_FAMILY,
        requestedModelId: QWEN3_VL_REQUESTED_MODEL_ID,
        observedModelId: envelope.model,
        requestIdentity: request.requestIdentity,
        providerResponseId: envelope.id,
        finishReason: envelope.choices[0].finish_reason,
        usage: envelope.usage,
        calculatedListCost: accounting.calculatedListCost,
        latencyMs,
        proposal,
      });
    },
  });
};
