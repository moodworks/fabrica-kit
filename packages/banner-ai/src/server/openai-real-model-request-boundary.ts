import { z } from 'zod';

import { digestValidatedCapabilityRequest } from '../jobs/request-digests.js';
import { CanonicalMicrosStringSchema } from '../jobs/cost-budget.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  createModelProducedActualTextObservationSetV1,
  validateSceneAnalysisModelDispatchContentPolicyV1,
  type SceneAnalysisModelRequestV1,
} from '../evaluation/ai-contracts.js';
import {
  OPENAI_SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_SHA256,
  createDetachedOpenAiSceneAnalysisOcrJsonSchemaV1,
  parseOpenAiProposedSceneAnalysisOcrJsonV1,
} from '../evaluation/openai-scene-analysis-output.js';
import {
  OPENAI_BENCHMARK_PRICING_EVIDENCE_V1,
  OPENAI_REAL_MODEL_ENDPOINT,
  OPENAI_REAL_MODEL_MAX_OUTPUT_TOKENS,
  OPENAI_REAL_MODEL_REQUESTED_MODEL_ID,
  OPENAI_REAL_MODEL_SECRET_REFERENCE_NAME,
  PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1,
  validateOpenAiExecutionObservedIdentityV1,
} from '../evaluation/openai-real-model-candidate-evidence.js';
import { SCENE_ANALYSIS_PROMPT_V1 } from '../evaluation/prompt-catalog.js';
import { digestRepositoryFixtureInputRefV1 } from '../evaluation/real-model-benchmark-corpus-manifest.js';
import {
  OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1,
  RealModelBenchmarkManualControlV1Schema,
  SelectedRealModelBenchmarkProfileV1Schema,
  digestRealModelBenchmarkAuthorizationV1,
  digestSelectedRealModelBenchmarkProfileV1,
} from '../evaluation/real-model-benchmark-profile.js';
import { prepareRealModelBenchmarkCallIntentV1 } from '../evaluation/real-model-benchmark-execution.js';
import { validateCompositionAnalysisResultV1 } from '../workflows/composition-contracts.js';
import {
  claimTrustedRealModelBenchmarkPlanKeyV1,
  requireTrustedRealModelBenchmarkCorpusStateV1,
  type TrustedRealModelBenchmarkCorpusCapabilityV1,
} from './real-model-benchmark-corpus-loader.js';

export interface NonDispatchingOpenAiRequestPlanV1 {
  readonly planVersion: 1;
  readonly kind: 'validated-non-dispatching-openai-responses-request-plan';
  readonly profileId: 'banner-scene-analysis-ocr-first-call-v1';
  readonly providerKey: 'openai';
  readonly apiFamily: 'responses';
  readonly requestedModelId: 'gpt-5.6-terra';
  readonly endpoint: 'https://api.openai.com/v1/responses';
  readonly method: 'POST';
  readonly secretReferenceName: 'OPENAI_API_KEY';
  readonly runOrdinal: 1 | 2;
  readonly retryOrdinal: 0 | 1;
  readonly dispatchAuthority: false;
  readonly networkDispatch: 'not-implemented';
}

interface PrivateOpenAiRequestPlanStateV1 {
  readonly canonicalRequestBodyText: string;
  readonly requestBody: {
    readonly model: 'gpt-5.6-terra';
    readonly instructions: string;
    readonly input: readonly [
      {
        readonly role: 'user';
        readonly content: readonly [
          {
            readonly type: 'input_image';
            readonly image_url: string;
            readonly detail: 'original';
          },
        ];
      },
    ];
    readonly text: {
      readonly format: {
        readonly type: 'json_schema';
        readonly name: 'banner_scene_analysis_ocr_v1';
        readonly strict: true;
        readonly schema: unknown;
      };
    };
    readonly max_output_tokens: 4096;
    readonly tools: readonly [];
    readonly tool_choice: 'none';
    readonly background: false;
    readonly store: false;
  };
  readonly authorization: ReturnType<
    typeof requireTrustedRealModelBenchmarkCorpusStateV1
  >['authorization'];
  readonly entry: ReturnType<typeof requireTrustedRealModelBenchmarkCorpusStateV1>['entry'];
  readonly request: SceneAnalysisModelRequestV1;
  readonly preparedIntent: ReturnType<typeof prepareRealModelBenchmarkCallIntentV1>;
  readonly exactBindings: unknown;
  readonly corpusCapability: TrustedRealModelBenchmarkCorpusCapabilityV1;
}

const validPlans = new WeakSet<object>();
const privatePlanState = new WeakMap<object, PrivateOpenAiRequestPlanStateV1>();

const exactCanonicalEquality = (left: unknown, right: unknown): boolean =>
  canonicalizeJson(left) === canonicalizeJson(right);

const assertFreshWindow = (label: string, start: string, end: string, nowMs: number): void => {
  if (Date.parse(start) > nowMs || nowMs >= Date.parse(end)) {
    throw new TypeError(`${label} is not fresh at authoritative server time.`);
  }
};

export const buildNonDispatchingOpenAiRequestPlanV1 = (input: {
  readonly profile: unknown;
  readonly corpusCapability: TrustedRealModelBenchmarkCorpusCapabilityV1;
  readonly request: unknown;
  readonly fixtureId: unknown;
  readonly manualControl: unknown;
  readonly executionPreparation: {
    readonly providerCallIdentity: unknown;
    readonly providerRequestSha256: unknown;
    readonly callTarget: unknown;
    readonly ordinals: unknown;
    readonly ledger: unknown;
    readonly estimatedCostMicros: unknown;
    readonly attemptedProviderCallTimeoutMs: unknown;
  };
}): NonDispatchingOpenAiRequestPlanV1 => {
  const profile = SelectedRealModelBenchmarkProfileV1Schema.parse(input.profile);
  if (!exactCanonicalEquality(profile, OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1)) {
    throw new TypeError('Request plan requires the exact committed OpenAI benchmark profile.');
  }
  const trusted = requireTrustedRealModelBenchmarkCorpusStateV1(
    input.corpusCapability,
    input.fixtureId,
  );
  const authorization = trusted.authorization;
  const entry = trusted.entry;
  const request = validateSceneAnalysisModelDispatchContentPolicyV1(input.request);
  const manualControl = RealModelBenchmarkManualControlV1Schema.parse(input.manualControl);
  const nowMs = Date.now();

  if (
    manualControl.state !== 'released-for-one-bounded-benchmark' ||
    manualControl.revision !== authorization.requiredManualControlReleaseRevision ||
    manualControl.authorizationId !== authorization.authorizationId ||
    manualControl.authorizationSha256 !== digestRealModelBenchmarkAuthorizationV1(authorization) ||
    manualControl.profileSha256 !== authorization.profileSha256 ||
    manualControl.admittedCorpusManifestSha256 !== authorization.admittedCorpusManifestSha256 ||
    authorization.profileSha256 !== digestSelectedRealModelBenchmarkProfileV1(profile)
  ) {
    throw new TypeError(
      'Structural manual-control design input, authorization, profile, or corpus revision is stale or foreign.',
    );
  }
  assertFreshWindow('Authorization', authorization.issuedAt, authorization.expiresAt, nowMs);
  assertFreshWindow(
    'Manual control release',
    manualControl.releasedAt,
    manualControl.expiresAt,
    nowMs,
  );

  if (
    !exactCanonicalEquality(request.input.fixture, entry.requestFixtureBinding) ||
    request.input.sourceAsset.sha256 !== entry.normalizedTransmission.sha256 ||
    request.input.sourceAsset.mediaType !== entry.normalizedTransmission.contentType ||
    request.input.sourceAsset.byteSize !== entry.normalizedTransmission.byteSize ||
    request.input.sourceAsset.pixelWidth !== entry.normalizedTransmission.pixelWidth ||
    request.input.sourceAsset.pixelHeight !== entry.normalizedTransmission.pixelHeight ||
    !exactCanonicalEquality(request.input.model, profile.candidateSelection.model) ||
    !exactCanonicalEquality(request.input.prompt, profile.prompt) ||
    !exactCanonicalEquality(request.input.workflow, profile.workflow) ||
    !exactCanonicalEquality(request.input.options, profile.requestOptions) ||
    request.contentPolicy.definition.definitionSha256 !== profile.contentPolicy.definitionSha256
  ) {
    throw new TypeError('Request source, model, prompt, policy, workflow, or options drifted.');
  }

  const preparedIntent = prepareRealModelBenchmarkCallIntentV1({
    profile,
    authorization,
    admittedManifest: trusted.manifest,
    admittedEntry: entry,
    normalizedSource: {
      ...entry.normalizedTransmission,
      bytes: trusted.normalizedBytes,
    },
    request,
    providerCallIdentity: input.executionPreparation.providerCallIdentity,
    providerRequestSha256: input.executionPreparation.providerRequestSha256,
    callTarget: input.executionPreparation.callTarget,
    ordinals: input.executionPreparation.ordinals,
    ledger: input.executionPreparation.ledger,
    manualControl,
    estimatedCostMicros: input.executionPreparation.estimatedCostMicros,
    attemptedProviderCallTimeoutMs: input.executionPreparation.attemptedProviderCallTimeoutMs,
  });
  if (
    preparedIntent.dispatchAuthority !== false ||
    preparedIntent.retryAuthority !== false ||
    preparedIntent.authorizationSha256 !== digestRealModelBenchmarkAuthorizationV1(authorization) ||
    preparedIntent.admittedCorpusManifestSha256 !== authorization.admittedCorpusManifestSha256 ||
    preparedIntent.sourceSha256 !== entry.normalizedTransmission.sha256 ||
    !exactCanonicalEquality(preparedIntent.requestIdentity, request.requestIdentity)
  ) {
    throw new TypeError('Freshly prepared inert call intent lost an exact private binding.');
  }
  const runOrdinal = preparedIntent.ordinals.runOrdinal;
  const retryOrdinal = preparedIntent.ordinals.retryOrdinal;
  const providerRequestSha256 = digestValidatedCapabilityRequest(request);
  const authorizedBinding = authorization.authorizedRunBindings.find(
    (binding) => binding.fixtureId === entry.fixtureId && binding.runOrdinal === runOrdinal,
  );
  if (
    authorizedBinding === undefined ||
    authorizedBinding.sourceSha256 !== entry.normalizedTransmission.sha256 ||
    authorizedBinding.requestFixtureBindingSha256 !==
      digestRepositoryFixtureInputRefV1(entry.requestFixtureBinding) ||
    !exactCanonicalEquality(authorizedBinding.requestIdentity, request.requestIdentity) ||
    !exactCanonicalEquality(authorizedBinding.inputDigest, request.requestIdentity.inputDigest) ||
    authorizedBinding.providerRequestSha256 !== providerRequestSha256
  ) {
    throw new TypeError(
      'Exact authorized source, request, or input-digest binding is absent or drifted.',
    );
  }

  if (authorization.retryPolicy.mode === 'zero-retry') {
    if (retryOrdinal !== 0) {
      throw new RangeError('Zero-retry authorization rejects every retry ordinal above zero.');
    }
  } else {
    if (retryOrdinal > authorization.retryPolicy.maximumRetryCount) {
      throw new RangeError(
        'Retry ordinal exceeds the exact evidenced timeout-replay authorization.',
      );
    }
    assertFreshWindow(
      'Timeout-replay evidence',
      authorization.retryPolicy.evidenceCapturedAt,
      authorization.retryPolicy.evidenceExpiresAt,
      nowMs,
    );
  }

  const privateOutputJsonSchema = createDetachedOpenAiSceneAnalysisOcrJsonSchemaV1();
  const privateOutputSchemaText = canonicalizeJson(privateOutputJsonSchema);
  if (
    sha256Hex(Buffer.from(privateOutputSchemaText, 'utf8')) !==
      OPENAI_SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_SHA256 ||
    OPENAI_SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_SHA256 !==
      PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1.structuredOutput.schemaSha256
  ) {
    throw new TypeError('Strict output JSON Schema projection or request-contract digest drifted.');
  }

  const dataUri = `data:image/png;base64,${Buffer.from(trusted.normalizedBytes).toString('base64')}`;
  const requestBody = Object.freeze({
    model: OPENAI_REAL_MODEL_REQUESTED_MODEL_ID,
    instructions: SCENE_ANALYSIS_PROMPT_V1.content,
    input: Object.freeze([
      Object.freeze({
        role: 'user' as const,
        content: Object.freeze([
          Object.freeze({
            type: 'input_image' as const,
            image_url: dataUri,
            detail: 'original' as const,
          }),
        ] as const),
      }),
    ] as const),
    text: Object.freeze({
      format: Object.freeze({
        type: 'json_schema' as const,
        name: 'banner_scene_analysis_ocr_v1' as const,
        strict: true as const,
        schema: privateOutputJsonSchema,
      }),
    }),
    max_output_tokens: OPENAI_REAL_MODEL_MAX_OUTPUT_TOKENS,
    tools: Object.freeze([] as const),
    tool_choice: 'none' as const,
    background: false as const,
    store: false as const,
  });
  const canonicalRequestBodyText = canonicalizeJson(requestBody);
  const privatePlanKey = sha256Hex(
    Buffer.from(
      canonicalizeJson({
        authorizationSha256: preparedIntent.authorizationSha256,
        logicalCallKey: preparedIntent.logicalRunIdentity.logicalCallKey,
        providerRequestSha256,
        callOrdinal: preparedIntent.ordinals.callOrdinal,
        retryOrdinal,
      }),
      'utf8',
    ),
  );
  claimTrustedRealModelBenchmarkPlanKeyV1(input.corpusCapability, privatePlanKey);

  const plan = Object.freeze({
    planVersion: 1 as const,
    kind: 'validated-non-dispatching-openai-responses-request-plan' as const,
    profileId: profile.profileId,
    providerKey: 'openai' as const,
    apiFamily: 'responses' as const,
    requestedModelId: OPENAI_REAL_MODEL_REQUESTED_MODEL_ID,
    endpoint: OPENAI_REAL_MODEL_ENDPOINT,
    method: 'POST' as const,
    secretReferenceName: OPENAI_REAL_MODEL_SECRET_REFERENCE_NAME,
    runOrdinal,
    retryOrdinal,
    dispatchAuthority: false as const,
    networkDispatch: 'not-implemented' as const,
  });
  validPlans.add(plan);
  privatePlanState.set(
    plan,
    Object.freeze({
      canonicalRequestBodyText,
      requestBody,
      authorization,
      entry,
      request,
      preparedIntent,
      corpusCapability: input.corpusCapability,
      exactBindings: Object.freeze({
        authorizationSha256: digestRealModelBenchmarkAuthorizationV1(authorization),
        authorizationPayloadSha256: authorization.authorizationPayloadSha256,
        corpusManifestSha256: authorization.admittedCorpusManifestSha256,
        sourceSha256: entry.normalizedTransmission.sha256,
        requestIdentity: request.requestIdentity,
        providerRequestSha256,
        prompt: profile.prompt,
        contentPolicy: profile.contentPolicy,
        workflow: profile.workflow,
        pricingEvidenceSha256: OPENAI_BENCHMARK_PRICING_EVIDENCE_V1.evidenceSha256,
        requestShapeSha256: PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1.requestShapeSha256,
        manualControlRevision: manualControl.revision,
        caps: profile.caps,
      }),
    }),
  );
  return plan;
};

const requirePrivatePlan = (
  plan: NonDispatchingOpenAiRequestPlanV1,
): PrivateOpenAiRequestPlanStateV1 => {
  if (!validPlans.has(plan)) {
    throw new TypeError('OpenAI request plan is absent, cloned, or structurally forged.');
  }
  const state = privatePlanState.get(plan);
  if (state === undefined) {
    throw new TypeError('OpenAI request plan private state is unavailable.');
  }
  return state;
};

export const inspectNonDispatchingOpenAiRequestPlanSafetyV1 = (
  plan: NonDispatchingOpenAiRequestPlanV1,
) => {
  const state = requirePrivatePlan(plan);
  const image = state.requestBody.input[0].content[0];
  const bodyKeys = Object.keys(state.requestBody).toSorted();
  return Object.freeze({
    inspectionVersion: 1 as const,
    bodyKeys,
    model: state.requestBody.model,
    imageTransport: image.image_url.startsWith('data:image/png;base64,')
      ? ('data:image/png;base64' as const)
      : ('invalid' as const),
    imageDetail: image.detail,
    instructionSource: 'canonical-scene-analysis-v1' as const,
    strictJsonSchema: state.requestBody.text.format.strict,
    outputSchemaName: state.requestBody.text.format.name,
    maxOutputTokens: state.requestBody.max_output_tokens,
    toolCount: state.requestBody.tools.length,
    toolChoice: state.requestBody.tool_choice,
    background: state.requestBody.background,
    store: state.requestBody.store,
    remoteImageUrlPresent: /^https?:/u.test(image.image_url),
    previousResponseOrConversationFieldPresent: bodyKeys.some((key) =>
      ['conversation', 'previous_response_id'].includes(key),
    ),
    webRetrievalCodeOrFollowUpFieldPresent: bodyKeys.some((key) =>
      [
        'code_interpreter',
        'file_search',
        'follow_up',
        'previous_response_id',
        'retrieval',
        'web_search',
      ].includes(key),
    ),
    dispatchAuthority: false as const,
  });
};

export const materializeOpenAiSceneAnalysisProposalFromPrivatePlanV1 = (input: {
  readonly plan: NonDispatchingOpenAiRequestPlanV1;
  readonly jsonText: unknown;
  readonly executionObservedIdentity: unknown;
}) => {
  const state = requirePrivatePlan(input.plan);
  const refreshed = requireTrustedRealModelBenchmarkCorpusStateV1(
    state.corpusCapability,
    state.entry.fixtureId,
  );
  if (
    digestRealModelBenchmarkAuthorizationV1(refreshed.authorization) !==
      digestRealModelBenchmarkAuthorizationV1(state.authorization) ||
    !exactCanonicalEquality(refreshed.entry, state.entry)
  ) {
    throw new TypeError('Private plan corpus or authorization binding drifted after construction.');
  }
  const executionObservedIdentity = validateOpenAiExecutionObservedIdentityV1({
    authorizedEvidence: state.authorization.authorizedObservedIdentityEvidence,
    executionObservedIdentity: input.executionObservedIdentity,
  });
  if (
    Date.parse(executionObservedIdentity.responseObservedAt) <
      Date.parse(state.authorization.issuedAt) ||
    Date.parse(executionObservedIdentity.responseObservedAt) >=
      Date.parse(state.authorization.expiresAt)
  ) {
    throw new TypeError(
      'Execution-observed identity falls outside the exact authorization window.',
    );
  }
  const providerOutput = parseOpenAiProposedSceneAnalysisOcrJsonV1(input.jsonText);
  const composition = validateCompositionAnalysisResultV1({
    request: {
      sourceAsset: state.request.input.sourceAsset,
      maxParts: state.request.input.options.maxParts,
      includeBackground: state.request.input.options.includeBackground,
    },
    result: providerOutput.composition,
  });
  const expectedTextCount = state.entry.expectedOracle.expectedTextOccurrences.length;
  if (
    (expectedTextCount === 0 &&
      (providerOutput.ocrCompletion.kind !== 'no-visible-text-observed' ||
        providerOutput.textObservations.length !== 0)) ||
    (expectedTextCount > 0 &&
      (providerOutput.ocrCompletion.kind !== 'visible-text-observations-complete' ||
        providerOutput.textObservations.length === 0))
  ) {
    throw new TypeError(
      'OCR completion disposition is missing or contradicts the admitted fixture oracle.',
    );
  }
  if (
    composition.kind !== 'composition_proposal' ||
    composition.parts.length < 3 ||
    composition.parts.length > 5
  ) {
    throw new TypeError('A successful first-run proposal requires three to five useful parts.');
  }
  const textObservations = createModelProducedActualTextObservationSetV1({
    request: state.request,
    observations: providerOutput.textObservations,
  });
  return Object.freeze({
    proposalVersion: 1 as const,
    composition,
    layerEvidence: providerOutput.layerEvidence,
    ocrCompletion: providerOutput.ocrCompletion,
    textObservations,
    reviewFlags: providerOutput.reviewFlags,
    humanReview: providerOutput.humanReview,
    decisionAuthority: 'proposal-requires-user-review' as const,
  });
};

export const createNonNetworkingOpenAiAdapterStubV1 = () =>
  Object.freeze({
    adapterVersion: 1 as const,
    providerKey: 'openai' as const,
    networkAccess: 'not-implemented' as const,
    dispatchAuthority: false as const,
    describe(plan: NonDispatchingOpenAiRequestPlanV1) {
      const inspection = inspectNonDispatchingOpenAiRequestPlanSafetyV1(plan);
      return Object.freeze({
        providerKey: 'openai' as const,
        requestedModelId: plan.requestedModelId,
        endpoint: plan.endpoint,
        imageDetail: inspection.imageDetail,
        strictJsonSchema: inspection.strictJsonSchema,
        dispatchAuthority: false as const,
      });
    },
    refuse(plan: NonDispatchingOpenAiRequestPlanV1): never {
      requirePrivatePlan(plan);
      throw new TypeError('OpenAI adapter stub cannot dispatch or access a network.');
    },
  });

export const RedactedOpenAiBenchmarkTelemetryInputV1Schema = z
  .strictObject({
    runOrdinal: z.union([z.literal(1), z.literal(2)]),
    status: z.enum([
      'planned',
      'success',
      'timeout',
      'invalid-output',
      'identity-mismatch',
      'cap-breach',
      'refused',
    ]),
    counts: z
      .strictObject({
        attemptedCalls: z.int().min(0).max(9),
        successfulRuns: z.int().min(0).max(6),
        failedAttempts: z.int().min(0).max(3),
      })
      .readonly(),
    latencyMs: z.int().min(0).max(600_000),
    exactCostMicros: CanonicalMicrosStringSchema,
    errorCode: z
      .enum([
        'none',
        'timeout',
        'invalid-output',
        'identity-mismatch',
        'cap-breach',
        'provider-rejected',
        'internal-refusal',
      ])
      .default('none'),
  })
  .readonly();

let runtimeTelemetryCorrelationSequence = 0;

const mintRuntimeTelemetryCorrelationId = (): string => {
  runtimeTelemetryCorrelationSequence += 1;
  if (runtimeTelemetryCorrelationSequence > 99_999_999) {
    throw new RangeError('Runtime-only telemetry correlation sequence is exhausted.');
  }
  return `runtime-only-correlation-${String(runtimeTelemetryCorrelationSequence).padStart(8, '0')}`;
};

export const createRedactedOpenAiBenchmarkTelemetryV1 = (input: unknown) => {
  const telemetry = RedactedOpenAiBenchmarkTelemetryInputV1Schema.parse(input);
  return Object.freeze({
    telemetryVersion: 1 as const,
    profileId: 'banner-scene-analysis-ocr-first-call-v1' as const,
    modelIdentityId: 'openai-gpt-5.6-terra-proposed-alias' as const,
    pricingEvidenceId: 'openai-public-pricing-user-evidence-2026-07-13' as const,
    ...telemetry,
    opaqueCorrelationId: mintRuntimeTelemetryCorrelationId(),
  });
};
