import { z } from 'zod';

import { parseMicros } from '../jobs/cost-budget.js';
import { CapabilityRequestSha256Schema } from '../jobs/request-digests.js';
import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  AiInputDigestV1Schema,
  AiModelRequestIdentityV1Schema,
  BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
  BannerAiWorkflowRefV1Schema,
  INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
} from './ai-contracts.js';
import { BenchmarkPricingConfigV1Schema } from './cost-estimator.js';
import {
  CanonicalUtcTimestampSchema,
  OPENAI_BENCHMARK_PRICING_EVIDENCE_V1,
  OPENAI_REAL_MODEL_BENCHMARK_CANDIDATE_V1,
  OPENAI_REAL_MODEL_MAX_OUTPUT_TOKENS,
  OPENAI_REAL_MODEL_SECRET_REFERENCE_NAME,
  OpenAiAuthorizedObservedIdentityEvidenceV1Schema,
  OpenAiWorstCaseRequestCostProofV1Schema,
  PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1,
  RealModelBenchmarkRetryPolicyV1Schema,
  SelectedRealModelBenchmarkCandidateV1Schema,
} from './openai-real-model-candidate-evidence.js';
import { SCENE_ANALYSIS_PROMPT_V1 } from './prompt-catalog.js';
import {
  REAL_MODEL_BENCHMARK_PROFILE_ID,
  RealModelBenchmarkCorpusManifestSha256Schema,
  RealModelBenchmarkFixtureIdSchema,
} from './real-model-benchmark-corpus-manifest.js';

export {
  BenchmarkEndpointPolicyV1Schema,
  ExternalIdempotencyMechanismV1Schema,
  OPENAI_BENCHMARK_PRICING_EVIDENCE_V1,
  OPENAI_REAL_MODEL_BENCHMARK_CANDIDATE_V1,
  OPENAI_REAL_MODEL_ENDPOINT,
  OPENAI_REAL_MODEL_ENDPOINT_POLICY_V1,
  OPENAI_REAL_MODEL_MAX_OUTPUT_TOKENS,
  OPENAI_REAL_MODEL_PROVIDER_KEY,
  OPENAI_REAL_MODEL_REQUESTED_MODEL_ID,
  OPENAI_REAL_MODEL_RESPONSES_API_FAMILY,
  OPENAI_REAL_MODEL_SECRET_REFERENCE_NAME,
  PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1,
  RealModelBenchmarkRetryPolicyV1Schema,
  SelectedRealModelBenchmarkCandidateV1Schema,
  ZERO_RETRY_REAL_MODEL_BENCHMARK_POLICY_V1,
  digestOpenAiAuthorizedObservedIdentityEvidenceV1,
  digestOpenAiExecutionObservedIdentityV1,
  digestOpenAiWorstCaseRequestCostProofV1,
  validateOpenAiExecutionObservedIdentityV1,
} from './openai-real-model-candidate-evidence.js';

export const EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED =
  'requires explicit user authorization before execution' as const;

const exactCanonicalEquality = (left: unknown, right: unknown): boolean =>
  canonicalizeJson(left) === canonicalizeJson(right);

const authorizedIntegerCap = <const Value extends number, const Unit extends string>(
  value: Value,
  unit: Unit,
) =>
  z
    .strictObject({
      value: z.literal(value),
      unit: z.literal(unit),
      authorization: z.literal(EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED),
    })
    .readonly();

const authorizedMicrosCap = <const Value extends string>(value: Value) =>
  z
    .strictObject({
      value: z.literal(value),
      currency: z.literal('USD'),
      unit: z.literal('micro-USD'),
      authorization: z.literal(EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED),
    })
    .readonly();

export const RealModelBenchmarkCapsV1Schema = z
  .strictObject({
    admittedFixtureCount: authorizedIntegerCap(3, 'fixtures'),
    requiredSuccessfulRunsPerFixture: authorizedIntegerCap(2, 'runs-per-fixture'),
    requiredSuccessfulRunCount: authorizedIntegerCap(6, 'runs'),
    maxTotalProviderCalls: authorizedIntegerCap(9, 'provider-calls'),
    maxRetriesPerFixtureAcrossBothRuns: authorizedIntegerCap(1, 'retries-per-fixture'),
    maxRetriesTotal: authorizedIntegerCap(3, 'retries'),
    maxFailedAttemptsPerFixture: authorizedIntegerCap(2, 'failed-attempts-per-fixture'),
    maxFailedAttempts: authorizedIntegerCap(3, 'failed-attempts'),
    perCallCostCeiling: authorizedMicrosCap('100000'),
    totalBenchmarkSpendCeiling: authorizedMicrosCap('900000'),
    maxLatencyPerAttemptedProviderCall: authorizedIntegerCap(60_000, 'milliseconds'),
    maxLatencyPerLogicalRun: authorizedIntegerCap(120_000, 'milliseconds'),
    maxTotalWallClock: authorizedIntegerCap(600_000, 'milliseconds'),
    minTransmittedImageBytes: authorizedIntegerCap(1, 'bytes'),
    maxTransmittedImageBytes: authorizedIntegerCap(5_242_880, 'bytes'),
    minImageSide: authorizedIntegerCap(64, 'pixels'),
    maxImageSide: authorizedIntegerCap(2_048, 'pixels'),
    maxImagePixels: authorizedIntegerCap(4_194_304, 'pixels'),
    minHumanUsefulPartsPerSuccessfulRun: authorizedIntegerCap(3, 'parts'),
    maxLayerCount: authorizedIntegerCap(5, 'parts'),
    minAggregateRequiredLayerRecall: authorizedIntegerCap(8_000, 'basis-points'),
    minAggregateUsefulProposalPrecision: authorizedIntegerCap(8_000, 'basis-points'),
    requiredExactTextMultisetPrecision: authorizedIntegerCap(10_000, 'basis-points'),
    requiredExactTextMultisetRecall: authorizedIntegerCap(10_000, 'basis-points'),
    minExactTextBoundingBoxIou: authorizedIntegerCap(7_000, 'basis-points'),
  })
  .superRefine((caps, context) => {
    if (
      caps.admittedFixtureCount.value * caps.requiredSuccessfulRunsPerFixture.value !==
      caps.requiredSuccessfulRunCount.value
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Required run count must equal fixtures times successful runs per fixture.',
      });
    }
    if (
      caps.requiredSuccessfulRunCount.value + caps.maxFailedAttempts.value !==
      caps.maxTotalProviderCalls.value
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Call ceiling must equal six planned successes plus at most three failures.',
      });
    }
    if (
      caps.admittedFixtureCount.value * caps.maxRetriesPerFixtureAcrossBothRuns.value !==
      caps.maxRetriesTotal.value
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Numerical retry ceilings must retain the existing three-fixture arithmetic.',
      });
    }
    if (caps.maxLatencyPerLogicalRun.value !== caps.maxLatencyPerAttemptedProviderCall.value * 2) {
      context.addIssue({
        code: 'custom',
        message:
          'Logical-run latency cap retains room for at most one separately evidenced replay.',
      });
    }
    if (
      parseMicros(caps.perCallCostCeiling.value) * BigInt(caps.maxTotalProviderCalls.value) !==
      parseMicros(caps.totalBenchmarkSpendCeiling.value)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Total spend ceiling must equal the exact per-call ceiling times call ceiling.',
      });
    }
  })
  .readonly();

export const REAL_MODEL_BENCHMARK_CAPS_V1 = RealModelBenchmarkCapsV1Schema.parse({
  admittedFixtureCount: {
    value: 3,
    unit: 'fixtures',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  requiredSuccessfulRunsPerFixture: {
    value: 2,
    unit: 'runs-per-fixture',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  requiredSuccessfulRunCount: {
    value: 6,
    unit: 'runs',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  maxTotalProviderCalls: {
    value: 9,
    unit: 'provider-calls',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  maxRetriesPerFixtureAcrossBothRuns: {
    value: 1,
    unit: 'retries-per-fixture',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  maxRetriesTotal: {
    value: 3,
    unit: 'retries',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  maxFailedAttemptsPerFixture: {
    value: 2,
    unit: 'failed-attempts-per-fixture',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  maxFailedAttempts: {
    value: 3,
    unit: 'failed-attempts',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  perCallCostCeiling: {
    value: '100000',
    currency: 'USD',
    unit: 'micro-USD',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  totalBenchmarkSpendCeiling: {
    value: '900000',
    currency: 'USD',
    unit: 'micro-USD',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  maxLatencyPerAttemptedProviderCall: {
    value: 60_000,
    unit: 'milliseconds',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  maxLatencyPerLogicalRun: {
    value: 120_000,
    unit: 'milliseconds',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  maxTotalWallClock: {
    value: 600_000,
    unit: 'milliseconds',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  minTransmittedImageBytes: {
    value: 1,
    unit: 'bytes',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  maxTransmittedImageBytes: {
    value: 5_242_880,
    unit: 'bytes',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  minImageSide: {
    value: 64,
    unit: 'pixels',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  maxImageSide: {
    value: 2_048,
    unit: 'pixels',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  maxImagePixels: {
    value: 4_194_304,
    unit: 'pixels',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  minHumanUsefulPartsPerSuccessfulRun: {
    value: 3,
    unit: 'parts',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  maxLayerCount: {
    value: 5,
    unit: 'parts',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  minAggregateRequiredLayerRecall: {
    value: 8_000,
    unit: 'basis-points',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  minAggregateUsefulProposalPrecision: {
    value: 8_000,
    unit: 'basis-points',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  requiredExactTextMultisetPrecision: {
    value: 10_000,
    unit: 'basis-points',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  requiredExactTextMultisetRecall: {
    value: 10_000,
    unit: 'basis-points',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
  minExactTextBoundingBoxIou: {
    value: 7_000,
    unit: 'basis-points',
    authorization: EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  },
});

export const RealModelBenchmarkProfileSha256Schema =
  Sha256HexSchema.brand<'RealModelBenchmarkProfileSha256'>();
export const RealModelBenchmarkReservationConfigSha256Schema =
  Sha256HexSchema.brand<'RealModelBenchmarkReservationConfigSha256'>();

export const digestRealModelBenchmarkReservationConfigV1 = (
  input: unknown,
): z.infer<typeof RealModelBenchmarkReservationConfigSha256Schema> => {
  const reservationConfig = BenchmarkPricingConfigV1Schema.parse(input);
  return RealModelBenchmarkReservationConfigSha256Schema.parse(
    sha256Hex(Buffer.from(canonicalizeJson(reservationConfig), 'utf8')),
  );
};

export const BenchmarkPromptBindingV1Schema = z
  .strictObject({
    id: z.literal('scene-analysis-v1'),
    version: z.literal(1),
    contentSha256: z.literal(SCENE_ANALYSIS_PROMPT_V1.contentSha256),
  })
  .readonly();

export const BenchmarkContentPolicyBindingV1Schema = z
  .strictObject({
    definitionId: z.literal('banner-ai-model-dispatch-content-policy-v1'),
    definitionVersion: z.literal(1),
    definitionSha256: z.literal(BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256),
  })
  .readonly();

export const BenchmarkQualityContractV1Schema = z
  .strictObject({
    structuredSuccesses: z.literal('six-of-six-valid-structured-results'),
    visibleEvidenceOnly: z.literal('only-directly-visible-objects-and-text-may-be-reported'),
    layerProposalContract: z.literal('CompositionAnalysisResultV1-three-to-five-useful-max-five'),
    ocrContract: z.literal('TextObservationV1-with-server-constructed-actual-model-provenance'),
    terminalFailures: z.tuple([
      z.literal('invalid-json-or-schema'),
      z.literal('missing-ocr-evidence'),
      z.literal('timeout'),
      z.literal('cap-breach'),
      z.literal('identity-mismatch'),
    ]),
    retryLimits: z.literal('strict-authorization-union-and-existing-call-cost-time-ceilings'),
    proposalDisposition: z.literal('user-review-required-never-automatic-cutout-or-export'),
  })
  .readonly();

export const REAL_MODEL_BENCHMARK_QUALITY_CONTRACT_V1 = BenchmarkQualityContractV1Schema.parse({
  structuredSuccesses: 'six-of-six-valid-structured-results',
  visibleEvidenceOnly: 'only-directly-visible-objects-and-text-may-be-reported',
  layerProposalContract: 'CompositionAnalysisResultV1-three-to-five-useful-max-five',
  ocrContract: 'TextObservationV1-with-server-constructed-actual-model-provenance',
  terminalFailures: [
    'invalid-json-or-schema',
    'missing-ocr-evidence',
    'timeout',
    'cap-breach',
    'identity-mismatch',
  ],
  retryLimits: 'strict-authorization-union-and-existing-call-cost-time-ceilings',
  proposalDisposition: 'user-review-required-never-automatic-cutout-or-export',
});

const profileCommonValues = {
  profileVersion: 2 as const,
  profileId: REAL_MODEL_BENCHMARK_PROFILE_ID,
  purpose: 'benchmark-only-design-not-execution' as const,
  workload: 'single-local-image-scene-analysis-plus-ocr-in-one-responses-call' as const,
  prompt: {
    id: 'scene-analysis-v1' as const,
    version: 1 as const,
    contentSha256: SCENE_ANALYSIS_PROMPT_V1.contentSha256,
  },
  contentPolicy: {
    definitionId: 'banner-ai-model-dispatch-content-policy-v1' as const,
    definitionVersion: 1 as const,
    definitionSha256: BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
  },
  workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
  requestOptions: {
    maxParts: 5 as const,
    includeBackground: true as const,
    preserveVisibleText: true as const,
  },
  outputContract: {
    compositionResult: 'CompositionAnalysisResultV1' as const,
    textObservations:
      'TextObservationV1-provider-array-server-wraps-actual-model-provenance' as const,
    structuredJson: 'strict-json-schema-and-runtime-validation-required' as const,
    maximumLayerCount: 5 as const,
    imageDetail: 'original' as const,
    maxOutputTokens: OPENAI_REAL_MODEL_MAX_OUTPUT_TOKENS,
  },
  autonomyRestrictions: {
    tools: 'forbidden' as const,
    browsing: 'forbidden' as const,
    retrieval: 'forbidden' as const,
    urlFetching: 'forbidden' as const,
    codeExecution: 'forbidden' as const,
    providerSideBackgroundWork: 'forbidden' as const,
    previousResponseOrConversation: 'forbidden' as const,
    modelDirectedFollowUpCalls: 'forbidden' as const,
    autonomousFollowUpCalls: 'forbidden' as const,
  },
  caps: REAL_MODEL_BENCHMARK_CAPS_V1,
  qualityContract: REAL_MODEL_BENCHMARK_QUALITY_CONTRACT_V1,
  futureBoundary: {
    browserProviderCalls: 'forbidden' as const,
    browserActivationOrConfiguration: 'forbidden' as const,
    secretAccess: 'server-side-only-reference-name-never-value' as const,
    environmentPresenceAuthorizes: false as const,
    defaultNetworkAccess: 'disabled' as const,
    defaultKillSwitch: 'engaged' as const,
    manualControlAuthority:
      'future-opaque-server-only-capability-required-before-every-call' as const,
    requestLogging: {
      imageBytesOrDataUri: 'forbidden' as const,
      filenames: 'forbidden' as const,
      ocrText: 'forbidden' as const,
      promptBody: 'forbidden' as const,
      secretValuesOrHeaders: 'forbidden' as const,
      rawProviderBodiesOrErrors: 'forbidden' as const,
      fullLinkableCorpusSourceRequestIdsOrHashes: 'forbidden' as const,
    },
  },
  execution: {
    state: 'disabled-by-default' as const,
    networkAccess: 'disabled' as const,
    killSwitch: 'engaged' as const,
    corpus: 'blocked-empty-production-registry' as const,
    committedAuthorization: 'none' as const,
    retryAuthority: 'none' as const,
    dispatcherOrClient: 'non-networking-refusal-stub-only' as const,
  },
};

export const SelectedRealModelBenchmarkProfileV1Schema = z
  .strictObject({
    profileVersion: z.literal(2),
    profileId: z.literal(REAL_MODEL_BENCHMARK_PROFILE_ID),
    purpose: z.literal('benchmark-only-design-not-execution'),
    workload: z.literal('single-local-image-scene-analysis-plus-ocr-in-one-responses-call'),
    candidateStatus: z.literal('proposed-unverified-execution-blocked'),
    candidateSelection: SelectedRealModelBenchmarkCandidateV1Schema,
    prompt: BenchmarkPromptBindingV1Schema,
    contentPolicy: BenchmarkContentPolicyBindingV1Schema,
    workflow: BannerAiWorkflowRefV1Schema,
    requestOptions: z
      .strictObject({
        maxParts: z.literal(5),
        includeBackground: z.literal(true),
        preserveVisibleText: z.literal(true),
      })
      .readonly(),
    outputContract: z
      .strictObject({
        compositionResult: z.literal('CompositionAnalysisResultV1'),
        textObservations: z.literal(
          'TextObservationV1-provider-array-server-wraps-actual-model-provenance',
        ),
        structuredJson: z.literal('strict-json-schema-and-runtime-validation-required'),
        maximumLayerCount: z.literal(5),
        imageDetail: z.literal('original'),
        maxOutputTokens: z.literal(OPENAI_REAL_MODEL_MAX_OUTPUT_TOKENS),
      })
      .readonly(),
    autonomyRestrictions: z
      .strictObject({
        tools: z.literal('forbidden'),
        browsing: z.literal('forbidden'),
        retrieval: z.literal('forbidden'),
        urlFetching: z.literal('forbidden'),
        codeExecution: z.literal('forbidden'),
        providerSideBackgroundWork: z.literal('forbidden'),
        previousResponseOrConversation: z.literal('forbidden'),
        modelDirectedFollowUpCalls: z.literal('forbidden'),
        autonomousFollowUpCalls: z.literal('forbidden'),
      })
      .readonly(),
    caps: RealModelBenchmarkCapsV1Schema,
    qualityContract: BenchmarkQualityContractV1Schema,
    futureBoundary: z
      .strictObject({
        browserProviderCalls: z.literal('forbidden'),
        browserActivationOrConfiguration: z.literal('forbidden'),
        secretAccess: z.literal('server-side-only-reference-name-never-value'),
        environmentPresenceAuthorizes: z.literal(false),
        defaultNetworkAccess: z.literal('disabled'),
        defaultKillSwitch: z.literal('engaged'),
        manualControlAuthority: z.literal(
          'future-opaque-server-only-capability-required-before-every-call',
        ),
        requestLogging: z
          .strictObject({
            imageBytesOrDataUri: z.literal('forbidden'),
            filenames: z.literal('forbidden'),
            ocrText: z.literal('forbidden'),
            promptBody: z.literal('forbidden'),
            secretValuesOrHeaders: z.literal('forbidden'),
            rawProviderBodiesOrErrors: z.literal('forbidden'),
            fullLinkableCorpusSourceRequestIdsOrHashes: z.literal('forbidden'),
          })
          .readonly(),
      })
      .readonly(),
    execution: z
      .strictObject({
        state: z.literal('disabled-by-default'),
        networkAccess: z.literal('disabled'),
        killSwitch: z.literal('engaged'),
        corpus: z.literal('blocked-empty-production-registry'),
        committedAuthorization: z.literal('none'),
        retryAuthority: z.literal('none'),
        dispatcherOrClient: z.literal('non-networking-refusal-stub-only'),
      })
      .readonly(),
  })
  .superRefine((profile, context) => {
    if (
      !exactCanonicalEquality(
        profile.candidateSelection,
        OPENAI_REAL_MODEL_BENCHMARK_CANDIDATE_V1,
      ) ||
      !exactCanonicalEquality(profile.prompt, profileCommonValues.prompt) ||
      !exactCanonicalEquality(profile.contentPolicy, profileCommonValues.contentPolicy) ||
      !exactCanonicalEquality(profile.workflow, INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1) ||
      !exactCanonicalEquality(profile.caps, REAL_MODEL_BENCHMARK_CAPS_V1) ||
      !exactCanonicalEquality(profile.qualityContract, REAL_MODEL_BENCHMARK_QUALITY_CONTRACT_V1)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'OpenAI benchmark profile identity, evidence, policy, workflow, caps, or quality drifted.',
      });
    }
  })
  .readonly();

export const OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1 =
  SelectedRealModelBenchmarkProfileV1Schema.parse({
    ...profileCommonValues,
    candidateStatus: 'proposed-unverified-execution-blocked',
    candidateSelection: OPENAI_REAL_MODEL_BENCHMARK_CANDIDATE_V1,
  });

/** Compatibility name: blocked now means evidence/corpus/authorization blocked, not unselected. */
export const BLOCKED_REAL_MODEL_BENCHMARK_PROFILE_V1 = OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1;
export const RealModelBenchmarkProfileV1Schema = SelectedRealModelBenchmarkProfileV1Schema;

export type SelectedRealModelBenchmarkProfileV1 = z.infer<
  typeof SelectedRealModelBenchmarkProfileV1Schema
>;

export const digestSelectedRealModelBenchmarkProfileV1 = (
  input: unknown,
): z.infer<typeof RealModelBenchmarkProfileSha256Schema> => {
  const profile = SelectedRealModelBenchmarkProfileV1Schema.parse(input);
  return RealModelBenchmarkProfileSha256Schema.parse(
    sha256Hex(Buffer.from(canonicalizeJson(profile), 'utf8')),
  );
};

const authorizationIdPattern = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/;

export const AuthorizedRealModelBenchmarkRunBindingV1Schema = z
  .strictObject({
    bindingVersion: z.literal(1),
    fixtureId: RealModelBenchmarkFixtureIdSchema,
    runOrdinal: z.union([z.literal(1), z.literal(2)]),
    sourceSha256: Sha256HexSchema,
    requestFixtureBindingSha256: Sha256HexSchema,
    requestIdentity: AiModelRequestIdentityV1Schema,
    inputDigest: AiInputDigestV1Schema,
    providerRequestSha256: CapabilityRequestSha256Schema,
  })
  .superRefine((binding, context) => {
    if (!exactCanonicalEquality(binding.inputDigest, binding.requestIdentity.inputDigest)) {
      context.addIssue({
        code: 'custom',
        message: 'Authorized input digest must equal its request identity digest.',
      });
    }
  })
  .readonly();

const AuthorizedRunBindingsV1Schema = z
  .array(AuthorizedRealModelBenchmarkRunBindingV1Schema)
  .length(6)
  .superRefine((bindings, context) => {
    const fixtureRunKeys = bindings.map((binding) => `${binding.fixtureId}:${binding.runOrdinal}`);
    const requestIds = bindings.map((binding) => binding.requestIdentity.requestId);
    if (
      new Set(fixtureRunKeys).size !== bindings.length ||
      new Set(requestIds).size !== bindings.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Authorization requires six unique fixture/run and request identities.',
      });
    }
    const fixtureCounts = new Map<string, number>();
    for (const binding of bindings) {
      fixtureCounts.set(binding.fixtureId, (fixtureCounts.get(binding.fixtureId) ?? 0) + 1);
    }
    if (fixtureCounts.size !== 3 || [...fixtureCounts.values()].some((count) => count !== 2)) {
      context.addIssue({
        code: 'custom',
        message: 'Authorization requires exactly two request bindings for each of three fixtures.',
      });
    }
  })
  .readonly();

export const RealModelBenchmarkAuthorizationConfirmationsV1Schema = z
  .strictObject({
    licenseAndThirdPartyRights: z.literal('confirmed'),
    currentOfficialModelAvailabilityAndApiFieldSemantics: z.literal('confirmed'),
    observedProviderModelVersionAndFingerprintEvidence: z.literal('confirmed'),
    datedPricingAssertionReconfirmed: z.literal('confirmed'),
    providerModelEndpointRequestShapeWorstCaseProof: z.literal('confirmed'),
    providerTrainingUse: z.literal('confirmed'),
    providerRetentionAndDeletion: z.literal('confirmed'),
    humanReviewSubprocessorsAndAbuseMonitoring: z.literal('confirmed'),
    processingRegionCrossBorderDpaAndLegalBasis: z.literal('confirmed'),
    corpusHumanTransmissionApprovals: z.literal('confirmed'),
  })
  .readonly();

const authorizationCoreShape = {
  authorizationVersion: z.literal(2),
  authorizationRevision: z.int().min(1).max(2_147_483_647),
  authorizationId: z.string().regex(authorizationIdPattern),
  issuedAt: CanonicalUtcTimestampSchema,
  expiresAt: CanonicalUtcTimestampSchema,
  authorizationRevisionEvidenceSha256: Sha256HexSchema,
  profileId: z.literal(REAL_MODEL_BENCHMARK_PROFILE_ID),
  profileSha256: RealModelBenchmarkProfileSha256Schema,
  admittedCorpusManifestSha256: RealModelBenchmarkCorpusManifestSha256Schema,
  corpusEvidenceSha256: Sha256HexSchema,
  candidate: SelectedRealModelBenchmarkCandidateV1Schema,
  responsesRequestShapeSha256: z.literal(
    PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1.requestShapeSha256,
  ),
  pricingEvidenceSha256: z.literal(OPENAI_BENCHMARK_PRICING_EVIDENCE_V1.evidenceSha256),
  worstCaseRequestCostProof: OpenAiWorstCaseRequestCostProofV1Schema,
  authorizedObservedIdentityEvidence: OpenAiAuthorizedObservedIdentityEvidenceV1Schema,
  prompt: BenchmarkPromptBindingV1Schema,
  contentPolicy: BenchmarkContentPolicyBindingV1Schema,
  workflow: BannerAiWorkflowRefV1Schema,
  authorizedRunBindings: AuthorizedRunBindingsV1Schema,
  caps: RealModelBenchmarkCapsV1Schema,
  qualityContract: BenchmarkQualityContractV1Schema,
  retryPolicy: RealModelBenchmarkRetryPolicyV1Schema,
  secretReferenceName: z.literal(OPENAI_REAL_MODEL_SECRET_REFERENCE_NAME),
  confirmations: RealModelBenchmarkAuthorizationConfirmationsV1Schema,
  requiredManualControlReleaseRevision: z.int().min(1).max(2_147_483_647),
  executionRelease: z
    .strictObject({
      manualKillSwitch: z.literal('fresh-exact-revision-release-required'),
      serverSideNetwork: z.literal('future-only-exact-allowlisted-endpoint'),
      browserNetwork: z.literal('forbidden'),
      environmentSecretPresenceAloneAuthorizes: z.literal(false),
    })
    .readonly(),
} as const;

const RealModelBenchmarkAuthorizationCoreV1Schema = z
  .strictObject(authorizationCoreShape)
  .readonly();

const digestParsedRealModelBenchmarkAuthorizationCoreV1 = (core: unknown): string =>
  sha256Hex(Buffer.from(canonicalizeJson(core), 'utf8'));

export const digestRealModelBenchmarkAuthorizationPayloadV1 = (input: unknown): string => {
  const core = RealModelBenchmarkAuthorizationCoreV1Schema.parse(input);
  return digestParsedRealModelBenchmarkAuthorizationCoreV1(core);
};

const RealModelBenchmarkAuthorizationPayloadV1Schema = z
  .strictObject({
    ...authorizationCoreShape,
    authorizationPayloadSha256: Sha256HexSchema,
  })
  .superRefine((authorization, context) => {
    const { authorizationPayloadSha256, ...core } = authorization;
    if (authorizationPayloadSha256 !== digestParsedRealModelBenchmarkAuthorizationCoreV1(core)) {
      context.addIssue({
        code: 'custom',
        message: 'Authorization payload digest differs from its exact canonical core.',
        path: ['authorizationPayloadSha256'],
      });
    }
  })
  .readonly();

const renderParsedRealModelBenchmarkAuthorizationStatementV1 = (payload: unknown): string =>
  `I explicitly authorize this one bounded Banner AI OpenAI Responses benchmark payload=${canonicalizeJson(payload)}. I authorize no other provider, model alias, observed model version or fingerprint, endpoint, request shape, corpus, prompt, policy, workflow, call, retry, spend, time, data use, or purpose.`;

export const renderRealModelBenchmarkAuthorizationStatementV1 = (input: unknown): string => {
  const payload = RealModelBenchmarkAuthorizationPayloadV1Schema.parse(input);
  return renderParsedRealModelBenchmarkAuthorizationStatementV1(payload);
};

export const RealModelBenchmarkAuthorizationV1Schema = z
  .strictObject({
    ...authorizationCoreShape,
    authorizationPayloadSha256: Sha256HexSchema,
    renderedUserStatement: z.string(),
    renderedUserStatementSha256: Sha256HexSchema,
  })
  .superRefine((authorization, context) => {
    const {
      renderedUserStatement,
      renderedUserStatementSha256,
      authorizationPayloadSha256,
      ...core
    } = authorization;
    const expectedPayloadSha = digestParsedRealModelBenchmarkAuthorizationCoreV1(core);
    const payload = { ...core, authorizationPayloadSha256 };
    const expectedStatement = renderParsedRealModelBenchmarkAuthorizationStatementV1(payload);
    const expectedStatementSha = sha256Hex(Buffer.from(expectedStatement, 'utf8'));
    if (authorizationPayloadSha256 !== expectedPayloadSha) {
      context.addIssue({
        code: 'custom',
        message: 'Authorization payload digest mismatched.',
        path: ['authorizationPayloadSha256'],
      });
    }
    if (
      renderedUserStatement !== expectedStatement ||
      renderedUserStatementSha256 !== expectedStatementSha
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Rendered authorization statement or digest must exactly bind the payload.',
        path: ['renderedUserStatement'],
      });
    }
    if (
      Date.parse(authorization.issuedAt) >= Date.parse(authorization.expiresAt) ||
      !exactCanonicalEquality(authorization.candidate, OPENAI_REAL_MODEL_BENCHMARK_CANDIDATE_V1) ||
      authorization.profileSha256 !==
        digestSelectedRealModelBenchmarkProfileV1(OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1) ||
      !exactCanonicalEquality(
        authorization.prompt,
        OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1.prompt,
      ) ||
      !exactCanonicalEquality(
        authorization.contentPolicy,
        OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1.contentPolicy,
      ) ||
      !exactCanonicalEquality(
        authorization.workflow,
        OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1.workflow,
      ) ||
      !exactCanonicalEquality(authorization.caps, REAL_MODEL_BENCHMARK_CAPS_V1) ||
      !exactCanonicalEquality(
        authorization.qualityContract,
        REAL_MODEL_BENCHMARK_QUALITY_CONTRACT_V1,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Authorization identity, time, profile, prompt, policy, workflow, caps, or quality drifted.',
      });
    }
  })
  .readonly();

export type RealModelBenchmarkAuthorizationV1 = z.infer<
  typeof RealModelBenchmarkAuthorizationV1Schema
>;

export const RealModelBenchmarkAuthorizationSha256Schema =
  Sha256HexSchema.brand<'RealModelBenchmarkAuthorizationSha256'>();

export const digestRealModelBenchmarkAuthorizationV1 = (
  input: unknown,
): z.infer<typeof RealModelBenchmarkAuthorizationSha256Schema> => {
  const authorization = RealModelBenchmarkAuthorizationV1Schema.parse(input);
  return RealModelBenchmarkAuthorizationSha256Schema.parse(
    sha256Hex(Buffer.from(canonicalizeJson(authorization), 'utf8')),
  );
};

const ManualControlCommonShape = {
  controlVersion: z.literal(2),
  controlId: z.literal('banner-ai-real-model-benchmark-kill-switch-v1'),
  revision: z.int().min(1).max(2_147_483_647),
  authoritySource: z.literal(
    'structural-design-input-future-opaque-authoritative-control-capability-required',
  ),
} as const;

const EngagedManualControlV1Schema = z
  .strictObject({ ...ManualControlCommonShape, state: z.literal('engaged') })
  .readonly();

const ReengagedManualControlV1Schema = z
  .strictObject({
    ...ManualControlCommonShape,
    state: z.literal('re-engaged'),
    authorizationId: z.string().regex(authorizationIdPattern),
    authorizationSha256: RealModelBenchmarkAuthorizationSha256Schema,
  })
  .readonly();

const ReleasedManualControlV1Schema = z
  .strictObject({
    ...ManualControlCommonShape,
    state: z.literal('released-for-one-bounded-benchmark'),
    authorizationId: z.string().regex(authorizationIdPattern),
    authorizationSha256: RealModelBenchmarkAuthorizationSha256Schema,
    profileId: z.literal(REAL_MODEL_BENCHMARK_PROFILE_ID),
    profileSha256: RealModelBenchmarkProfileSha256Schema,
    admittedCorpusManifestSha256: RealModelBenchmarkCorpusManifestSha256Schema,
    releasedAt: CanonicalUtcTimestampSchema,
    expiresAt: CanonicalUtcTimestampSchema,
    releaseEvidenceSha256: Sha256HexSchema,
  })
  .superRefine((control, context) => {
    if (Date.parse(control.releasedAt) >= Date.parse(control.expiresAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Manual release must have a positive fresh window.',
      });
    }
  })
  .readonly();

export const RealModelBenchmarkManualControlV1Schema = z.discriminatedUnion('state', [
  EngagedManualControlV1Schema,
  ReengagedManualControlV1Schema,
  ReleasedManualControlV1Schema,
]);

export const DEFAULT_REAL_MODEL_BENCHMARK_MANUAL_CONTROL_V1 =
  RealModelBenchmarkManualControlV1Schema.parse({
    controlVersion: 2,
    controlId: 'banner-ai-real-model-benchmark-kill-switch-v1',
    revision: 1,
    authoritySource:
      'structural-design-input-future-opaque-authoritative-control-capability-required',
    state: 'engaged',
  });
