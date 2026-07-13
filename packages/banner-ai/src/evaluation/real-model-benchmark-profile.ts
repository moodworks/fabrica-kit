import { z } from 'zod';

import { parseMicros } from '../jobs/cost-budget.js';
import { ModelKeySchema, ProviderKeySchema } from '../jobs/syntax.js';
import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  AiModelContractV1Schema,
  BannerAiWorkflowRefV1Schema,
  BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
  INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
} from './ai-contracts.js';
import { BenchmarkPricingConfigV1Schema } from './cost-estimator.js';
import { SCENE_ANALYSIS_PROMPT_V1 } from './prompt-catalog.js';
import {
  REAL_MODEL_BENCHMARK_PROFILE_ID,
  RealModelBenchmarkCorpusManifestSha256Schema,
} from './real-model-benchmark-corpus-manifest.js';

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
        message: 'Total retries must equal the one-retry ceiling across all fixtures.',
      });
    }
    if (caps.maxLatencyPerLogicalRun.value !== caps.maxLatencyPerAttemptedProviderCall.value * 2) {
      context.addIssue({
        code: 'custom',
        message:
          'Logical-run latency cap must equal an initial attempted call plus the sole possible replay.',
      });
    }
    const perCall = parseMicros(caps.perCallCostCeiling.value);
    const total = parseMicros(caps.totalBenchmarkSpendCeiling.value);
    if (perCall * BigInt(caps.maxTotalProviderCalls.value) !== total) {
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

export const BenchmarkEndpointPolicyV1Schema = z
  .strictObject({
    method: z.literal('POST'),
    url: z.string().superRefine((value, context) => {
      let parsed: URL;
      try {
        parsed = new URL(value);
      } catch {
        context.addIssue({ code: 'custom', message: 'Provider endpoint must be an absolute URL.' });
        return;
      }
      if (
        parsed.protocol !== 'https:' ||
        parsed.username !== '' ||
        parsed.password !== '' ||
        parsed.search !== '' ||
        parsed.hash !== '' ||
        parsed.pathname === '/' ||
        value !== `${parsed.origin}${parsed.pathname}`
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Provider endpoint must be one canonical credential-free HTTPS origin and non-root path without query or fragment.',
        });
      }
      const hostname = parsed.hostname.toLowerCase();
      const ipv4Parts = hostname.split('.');
      const literalIpv4 =
        ipv4Parts.length === 4 &&
        ipv4Parts.every((part) => /^(?:0|[1-9][0-9]{0,2})$/.test(part) && Number(part) <= 255);
      const hostLabels = hostname.split('.');
      if (
        literalIpv4 ||
        hostname.includes(':') ||
        hostLabels.some((label) =>
          ['localhost', 'local', 'internal', 'intranet', 'home', 'lan'].includes(label),
        )
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Provider endpoint cannot use a literal IP or local/internal-style host.',
        });
      }
    }),
    redirects: z.literal('forbidden'),
    alternateOrigins: z.literal('forbidden'),
    alternatePaths: z.literal('forbidden'),
    alternateMethods: z.literal('forbidden'),
    literalIpHosts: z.literal('forbidden'),
    localhostLocalAndInternalHosts: z.literal('forbidden'),
    dnsResolution: z.literal(
      'future-executor-resolves-only-public-approved-addresses-and-pins-them-for-the-call',
    ),
    privateReservedLinkLocalAndLoopbackAddresses: z.literal('forbidden'),
    dnsRebinding: z.literal('forbidden'),
    proxyOverride: z.literal('forbidden'),
  })
  .readonly();

const providerModelPinPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;

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

const ExternalIdempotencyHeaderNameSchema = z
  .string()
  .regex(/^[A-Za-z][A-Za-z0-9-]{0,79}$/)
  .refine(
    (value) => !['authorization', 'cookie', 'proxy-authorization'].includes(value.toLowerCase()),
    'External idempotency header cannot be a credential-bearing header.',
  );

export const ExternalIdempotencyMechanismV1Schema = z
  .strictObject({
    kind: z.literal('https-header'),
    exactHeaderName: ExternalIdempotencyHeaderNameSchema,
    valueEncoding: z.literal('lowercase-sha256-hex-logical-call-key-v1'),
    retryBehavior: z.literal('initial-and-timeout-retry-send-the-identical-key'),
  })
  .readonly();

export const SelectedRealModelBenchmarkCandidateV1Schema = z
  .strictObject({
    candidateVersion: z.literal(1),
    model: AiModelContractV1Schema,
    providerModelIdentifier: ModelKeySchema,
    immutableProviderModelVersion: z.string().regex(providerModelPinPattern),
    versionPinRequirement: z.literal('exact-immutable-provider-model-or-snapshot-id'),
    responseIdentityRequirement: z
      .strictObject({
        comparison: z.literal('exact-equality-with-requested-candidate'),
        providerKey: ProviderKeySchema,
        providerModelIdentifier: ModelKeySchema,
        immutableProviderModelVersion: z.string().regex(providerModelPinPattern),
      })
      .readonly(),
    worstCaseReservationConfig: BenchmarkPricingConfigV1Schema,
    worstCaseReservationConfigSha256: RealModelBenchmarkReservationConfigSha256Schema,
    worstCaseReservationScope: z
      .strictObject({
        providerKey: ProviderKeySchema,
        providerModelIdentifier: ModelKeySchema,
        immutableProviderModelVersion: z.string().regex(providerModelPinPattern),
        endpoint: BenchmarkEndpointPolicyV1Schema,
        evidenceSha256: Sha256HexSchema,
        boundedRequestCostAssertion: z.literal(
          'selected-bounded-request-cannot-exceed-model-inference-reservation',
        ),
        userConfirmation: z.literal(
          'confirmed-provider-model-endpoint-specific-worst-case-reservation-ceiling',
        ),
      })
      .readonly(),
    timeoutReplayContract: z
      .strictObject({
        providerKey: ProviderKeySchema,
        providerModelIdentifier: ModelKeySchema,
        immutableProviderModelVersion: z.string().regex(providerModelPinPattern),
        endpoint: BenchmarkEndpointPolicyV1Schema,
        evidenceSha256: Sha256HexSchema,
        executionAndBillingAssertion: z.literal(
          'at-most-once-provider-execution-and-billing-for-one-logical-run-after-indeterminate-timeout',
        ),
        mechanism: ExternalIdempotencyMechanismV1Schema,
        userConfirmation: z.literal(
          'confirmed-provider-model-endpoint-specific-idempotency-replay-and-billing-contract',
        ),
      })
      .readonly(),
    serverSideSecret: z
      .strictObject({
        name: z.literal('BANNER_AI_REAL_MODEL_BENCHMARK_API_KEY'),
        access: z.literal('server-side-only'),
        valueStorage: z.literal('not-present-in-profile-or-authorization'),
      })
      .readonly(),
    endpointAllowlist: z.tuple([BenchmarkEndpointPolicyV1Schema]).readonly(),
  })
  .superRefine((candidate, context) => {
    const identity = candidate.model.identity;
    const requiredCapabilities = ['ocr', 'scene_analysis', 'structured_output'] as const;
    if (!identity.external) {
      context.addIssue({ code: 'custom', message: 'A selected real model must be external.' });
    }
    for (const capability of requiredCapabilities) {
      if (!candidate.model.capabilities.capabilities.includes(capability)) {
        context.addIssue({
          code: 'custom',
          message: `Selected candidate lacks required ${capability} capability.`,
          path: ['model', 'capabilities'],
        });
      }
    }
    if (identity.modelKey !== candidate.providerModelIdentifier) {
      context.addIssue({
        code: 'custom',
        message: 'Existing model identity must use the exact provider model identifier.',
      });
    }
    const equalityBindings = [
      candidate.responseIdentityRequirement,
      candidate.worstCaseReservationScope,
      candidate.timeoutReplayContract,
    ];
    for (const binding of equalityBindings) {
      if (
        binding.providerKey !== identity.providerKey ||
        binding.providerModelIdentifier !== candidate.providerModelIdentifier ||
        binding.immutableProviderModelVersion !== candidate.immutableProviderModelVersion
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Candidate response/reservation identity must equal the selected provider model pin.',
        });
      }
    }
    for (const binding of [candidate.worstCaseReservationScope, candidate.timeoutReplayContract]) {
      if (!exactCanonicalEquality(binding.endpoint, candidate.endpointAllowlist[0])) {
        context.addIssue({
          code: 'custom',
          message: 'Reservation/replay evidence must bind the sole selected endpoint.',
        });
      }
    }
    if (
      candidate.worstCaseReservationConfig.productionPriceTruth !== false ||
      candidate.worstCaseReservationConfig.rates.modelInferenceMicrosPerUnit !== '100000' ||
      candidate.worstCaseReservationConfig.rates.segmentationComputeMicrosPerUnit !== '0' ||
      candidate.worstCaseReservationConfig.rates.inpaintingMicrosPerUnit !== '0' ||
      candidate.worstCaseReservationConfig.rates.storageMicrosPerByteMonth !== '0' ||
      candidate.worstCaseReservationConfig.rates.retryMicrosPerUnit !== '0' ||
      candidate.worstCaseReservationConfig.rates.failedAttemptMicrosPerUnit !== '0'
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'The proposed benchmark reserves one worst-case model-inference unit per attempted provider call and nothing else.',
        path: ['worstCaseReservationConfig'],
      });
    }
    if (
      digestRealModelBenchmarkReservationConfigV1(candidate.worstCaseReservationConfig) !==
      candidate.worstCaseReservationConfigSha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Reservation configuration digest differs from the exact selected object.',
        path: ['worstCaseReservationConfigSha256'],
      });
    }
  })
  .readonly();

const BenchmarkPromptBindingV1Schema = z
  .strictObject({
    id: z.literal('scene-analysis-v1'),
    version: z.literal(1),
    contentSha256: z.literal(SCENE_ANALYSIS_PROMPT_V1.contentSha256),
  })
  .readonly();

const BenchmarkContentPolicyBindingV1Schema = z
  .strictObject({
    definitionId: z.literal('banner-ai-model-dispatch-content-policy-v1'),
    definitionVersion: z.literal(1),
    definitionSha256: z.literal(BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256),
  })
  .readonly();

const BenchmarkOutputContractV1Schema = z
  .strictObject({
    compositionResult: z.literal('CompositionAnalysisResultV1'),
    textObservations: z.literal('ModelProducedActualTextObservationSetV1'),
    structuredJson: z.literal('strict-runtime-validation-required'),
    maximumLayerCount: z.literal(5),
    successfulProposalPartCount: z
      .strictObject({ min: z.literal(3), max: z.literal(5) })
      .readonly(),
    ocrTextRequirement: z.literal('exact-normalized-observed-text-with-provenance'),
    boundingBoxRequirement: z.literal('normalized-basis-points-required'),
  })
  .readonly();

const BenchmarkCapabilityRequirementsV1Schema = z
  .strictObject({
    imageInput: z.literal('required'),
    strictStructuredJson: z.literal('required'),
    sceneAnalysis: z.literal('required'),
    ocrExactTextObservations: z.literal('required'),
    normalizedBoundingBoxes: z.literal('required'),
    deterministicRequestMetadata: z.literal('required'),
  })
  .readonly();

const BenchmarkAutonomyRestrictionsV1Schema = z
  .strictObject({
    tools: z.literal('forbidden'),
    browsing: z.literal('forbidden'),
    retrieval: z.literal('forbidden'),
    urlFetching: z.literal('forbidden'),
    codeExecution: z.literal('forbidden'),
    modelDirectedFollowUpCalls: z.literal('forbidden'),
    autonomousFollowUpCalls: z.literal('forbidden'),
    timeoutRetry: z.literal(
      'outcome-helper-never-authorizes-bound-prepare-review-only-with-verified-at-most-once-provider-contract',
    ),
  })
  .readonly();

const BenchmarkFailurePolicyV1Schema = z
  .strictObject({
    malformedStructuredOutput: z.literal('terminal-no-retry-inconclusive-kill-switch-engaged'),
    firstTimeout: z.literal(
      'counted-pending-bound-prepare-review-retry-authority-false-control-engaged',
    ),
    secondTimeout: z.literal('terminal-inconclusive-kill-switch-engaged'),
    providerPermanentOrPolicyRejection: z.literal(
      'terminal-no-retry-inconclusive-kill-switch-engaged',
    ),
    transientRateLimitOrTransportFailure: z.literal(
      'terminal-no-autonomous-retry-inconclusive-kill-switch-engaged',
    ),
    indeterminateResultOrWorkerLoss: z.literal(
      'terminal-no-retry-inconclusive-kill-switch-engaged',
    ),
    insufficientRemainingWallTime: z.literal('stop-before-call-inconclusive'),
    preCallCapBreach: z.literal('stop-before-call-inconclusive'),
    actualPostCallCostOverrun: z.literal(
      'record-full-actual-cost-inconclusive-engage-kill-switch-forbid-later-calls',
    ),
    failedAndIndeterminateAttemptCosts: z.literal('count-and-record-without-clipping'),
    noTextFixture: z.literal('exactly-zero-model-produced-text-observations'),
    modelSelfConfidence: z.literal('recorded-never-oracle-truth'),
  })
  .readonly();

const BenchmarkFutureBoundaryV1Schema = z
  .strictObject({
    browserProviderCalls: z.literal('forbidden'),
    secretAccess: z.literal('server-side-only'),
    secretValuesInConfig: z.literal('forbidden'),
    environmentPresenceAuthorizes: z.literal(false),
    defaultNetworkAccess: z.literal('disabled'),
    defaultKillSwitch: z.literal('engaged'),
    redirects: z.literal('forbidden'),
    requestLogging: z
      .strictObject({
        imageBytes: z.literal('forbidden'),
        filenames: z.literal('forbidden'),
        ocrText: z.literal('forbidden'),
        secrets: z.literal('forbidden'),
        rawProviderBodies: z.literal('forbidden'),
        rawProviderErrors: z.literal('forbidden'),
        fullLinkableCorpusSourceRequestIdsOrHashes: z.literal('forbidden'),
        endpointQuery: z.literal('forbidden'),
      })
      .readonly(),
    redactedTelemetryAllowlist: z.tuple([
      z.literal('profile-id'),
      z.literal('model-identity-id'),
      z.literal('reservation-config-id'),
      z.literal('run-ordinal'),
      z.literal('status-class'),
      z.literal('counts'),
      z.literal('latency-ms'),
      z.literal('exact-cost-micros'),
      z.literal('opaque-redacted-correlation-id'),
    ]),
  })
  .readonly();

const profileCommonShape = {
  profileVersion: z.literal(1),
  profileId: z.literal(REAL_MODEL_BENCHMARK_PROFILE_ID),
  purpose: z.literal('benchmark-only-design-not-execution'),
  workload: z.literal('single-image-scene-analysis-plus-ocr-in-one-model-call'),
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
  capabilities: BenchmarkCapabilityRequirementsV1Schema,
  outputContract: BenchmarkOutputContractV1Schema,
  autonomyRestrictions: BenchmarkAutonomyRestrictionsV1Schema,
  caps: RealModelBenchmarkCapsV1Schema,
  qualityFormulas: z
    .strictObject({
      strictSuccessfulRuns: z.literal('six-of-six-runs-pass-strict-output-validation'),
      successfulProposalParts: z.literal(
        'each-successful-run-has-three-to-five-human-useful-parts',
      ),
      requiredLayerRecall: z.literal(
        'matched-required-human-oracle-layer-occurrences/all-required-oracle-occurrences-across-six-runs',
      ),
      usefulProposalPrecision: z.literal(
        'human-accepted-useful-proposed-part-occurrences/all-proposed-occurrences-across-six-runs',
      ),
      textPrecisionRecall: z.literal(
        'duplicate-aware-exact-normalized-text-multiset-intersection-over-actual-and-expected',
      ),
      textBoundingBoxes: z.literal(
        'deterministic-one-to-one-exact-text-matching-with-integer-rational-iou',
      ),
    })
    .readonly(),
  failurePolicy: BenchmarkFailurePolicyV1Schema,
  futureBoundary: BenchmarkFutureBoundaryV1Schema,
  execution: z
    .strictObject({
      state: z.literal('disabled-by-default'),
      networkAccess: z.literal('disabled'),
      killSwitch: z.literal('engaged'),
      committedAuthorization: z.literal('none'),
      retryAuthority: z.literal('none'),
      dispatcherOrClient: z.literal('not-implemented'),
    })
    .readonly(),
} as const;

const BlockedRealModelBenchmarkProfileV1Schema = z
  .strictObject({
    ...profileCommonShape,
    candidateStatus: z.literal('blocked-unselected'),
    candidateSelection: z
      .strictObject({
        selectionState: z.literal('blocking-user-decision-required'),
        providerAndExactModelSelected: z.literal(false),
        immutableModelVersionOrSnapshotSelected: z.literal(false),
        exactEndpointSelected: z.literal(false),
        worstCaseReservationEvidenceConfirmed: z.literal(false),
        atMostOnceTimeoutReplayAndBillingContractConfirmed: z.literal(false),
        endpointAllowlist: z.tuple([]),
      })
      .readonly(),
  })
  .readonly();

export const SelectedRealModelBenchmarkProfileV1Schema = z
  .strictObject({
    ...profileCommonShape,
    candidateStatus: z.literal('selected-future-caller-input-only'),
    candidateSelection: SelectedRealModelBenchmarkCandidateV1Schema,
  })
  .readonly();

export const RealModelBenchmarkProfileV1Schema = z.union([
  BlockedRealModelBenchmarkProfileV1Schema,
  SelectedRealModelBenchmarkProfileV1Schema,
]);

const commonProfileValues = {
  profileVersion: 1,
  profileId: REAL_MODEL_BENCHMARK_PROFILE_ID,
  purpose: 'benchmark-only-design-not-execution',
  workload: 'single-image-scene-analysis-plus-ocr-in-one-model-call',
  prompt: {
    id: 'scene-analysis-v1',
    version: 1,
    contentSha256: SCENE_ANALYSIS_PROMPT_V1.contentSha256,
  },
  contentPolicy: {
    definitionId: 'banner-ai-model-dispatch-content-policy-v1',
    definitionVersion: 1,
    definitionSha256: BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
  },
  workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
  requestOptions: { maxParts: 5, includeBackground: true, preserveVisibleText: true },
  capabilities: {
    imageInput: 'required',
    strictStructuredJson: 'required',
    sceneAnalysis: 'required',
    ocrExactTextObservations: 'required',
    normalizedBoundingBoxes: 'required',
    deterministicRequestMetadata: 'required',
  },
  outputContract: {
    compositionResult: 'CompositionAnalysisResultV1',
    textObservations: 'ModelProducedActualTextObservationSetV1',
    structuredJson: 'strict-runtime-validation-required',
    maximumLayerCount: 5,
    successfulProposalPartCount: { min: 3, max: 5 },
    ocrTextRequirement: 'exact-normalized-observed-text-with-provenance',
    boundingBoxRequirement: 'normalized-basis-points-required',
  },
  autonomyRestrictions: {
    tools: 'forbidden',
    browsing: 'forbidden',
    retrieval: 'forbidden',
    urlFetching: 'forbidden',
    codeExecution: 'forbidden',
    modelDirectedFollowUpCalls: 'forbidden',
    autonomousFollowUpCalls: 'forbidden',
    timeoutRetry:
      'outcome-helper-never-authorizes-bound-prepare-review-only-with-verified-at-most-once-provider-contract',
  },
  caps: REAL_MODEL_BENCHMARK_CAPS_V1,
  qualityFormulas: {
    strictSuccessfulRuns: 'six-of-six-runs-pass-strict-output-validation',
    successfulProposalParts: 'each-successful-run-has-three-to-five-human-useful-parts',
    requiredLayerRecall:
      'matched-required-human-oracle-layer-occurrences/all-required-oracle-occurrences-across-six-runs',
    usefulProposalPrecision:
      'human-accepted-useful-proposed-part-occurrences/all-proposed-occurrences-across-six-runs',
    textPrecisionRecall:
      'duplicate-aware-exact-normalized-text-multiset-intersection-over-actual-and-expected',
    textBoundingBoxes: 'deterministic-one-to-one-exact-text-matching-with-integer-rational-iou',
  },
  failurePolicy: {
    malformedStructuredOutput: 'terminal-no-retry-inconclusive-kill-switch-engaged',
    firstTimeout: 'counted-pending-bound-prepare-review-retry-authority-false-control-engaged',
    secondTimeout: 'terminal-inconclusive-kill-switch-engaged',
    providerPermanentOrPolicyRejection: 'terminal-no-retry-inconclusive-kill-switch-engaged',
    transientRateLimitOrTransportFailure:
      'terminal-no-autonomous-retry-inconclusive-kill-switch-engaged',
    indeterminateResultOrWorkerLoss: 'terminal-no-retry-inconclusive-kill-switch-engaged',
    insufficientRemainingWallTime: 'stop-before-call-inconclusive',
    preCallCapBreach: 'stop-before-call-inconclusive',
    actualPostCallCostOverrun:
      'record-full-actual-cost-inconclusive-engage-kill-switch-forbid-later-calls',
    failedAndIndeterminateAttemptCosts: 'count-and-record-without-clipping',
    noTextFixture: 'exactly-zero-model-produced-text-observations',
    modelSelfConfidence: 'recorded-never-oracle-truth',
  },
  futureBoundary: {
    browserProviderCalls: 'forbidden',
    secretAccess: 'server-side-only',
    secretValuesInConfig: 'forbidden',
    environmentPresenceAuthorizes: false,
    defaultNetworkAccess: 'disabled',
    defaultKillSwitch: 'engaged',
    redirects: 'forbidden',
    requestLogging: {
      imageBytes: 'forbidden',
      filenames: 'forbidden',
      ocrText: 'forbidden',
      secrets: 'forbidden',
      rawProviderBodies: 'forbidden',
      rawProviderErrors: 'forbidden',
      fullLinkableCorpusSourceRequestIdsOrHashes: 'forbidden',
      endpointQuery: 'forbidden',
    },
    redactedTelemetryAllowlist: [
      'profile-id',
      'model-identity-id',
      'reservation-config-id',
      'run-ordinal',
      'status-class',
      'counts',
      'latency-ms',
      'exact-cost-micros',
      'opaque-redacted-correlation-id',
    ],
  },
  execution: {
    state: 'disabled-by-default',
    networkAccess: 'disabled',
    killSwitch: 'engaged',
    committedAuthorization: 'none',
    retryAuthority: 'none',
    dispatcherOrClient: 'not-implemented',
  },
} as const;

export const BLOCKED_REAL_MODEL_BENCHMARK_PROFILE_V1 =
  BlockedRealModelBenchmarkProfileV1Schema.parse({
    ...commonProfileValues,
    candidateStatus: 'blocked-unselected',
    candidateSelection: {
      selectionState: 'blocking-user-decision-required',
      providerAndExactModelSelected: false,
      immutableModelVersionOrSnapshotSelected: false,
      exactEndpointSelected: false,
      worstCaseReservationEvidenceConfirmed: false,
      atMostOnceTimeoutReplayAndBillingContractConfirmed: false,
      endpointAllowlist: [],
    },
  });

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

export const RealModelBenchmarkAuthorizationConfirmationsV1Schema = z
  .strictObject({
    licenseAndThirdPartyRights: z.literal('confirmed'),
    providerTermsAndModelAvailability: z.literal('confirmed'),
    providerModelEndpointWorstCaseReservationCeiling: z.literal('confirmed'),
    providerAtMostOnceTimeoutReplayExecutionAndBilling: z.literal('confirmed'),
    providerTrainingUse: z.literal('confirmed'),
    providerRetentionAndDeletion: z.literal('confirmed'),
    humanReviewSubprocessorsAndAbuseMonitoring: z.literal('confirmed'),
    processingRegionCrossBorderDpaAndLegalBasis: z.literal('confirmed'),
    corpusHumanTransmissionApprovals: z.literal('confirmed'),
  })
  .readonly();

const authorizationPayloadShape = {
  authorizationVersion: z.literal(1),
  authorizationId: z.string().regex(authorizationIdPattern),
  profileId: z.literal(REAL_MODEL_BENCHMARK_PROFILE_ID),
  profileSha256: RealModelBenchmarkProfileSha256Schema,
  admittedCorpusManifestSha256: RealModelBenchmarkCorpusManifestSha256Schema,
  candidate: SelectedRealModelBenchmarkCandidateV1Schema,
  prompt: BenchmarkPromptBindingV1Schema,
  contentPolicy: BenchmarkContentPolicyBindingV1Schema,
  workflow: BannerAiWorkflowRefV1Schema,
  caps: RealModelBenchmarkCapsV1Schema,
  confirmations: RealModelBenchmarkAuthorizationConfirmationsV1Schema,
  executionRelease: z
    .strictObject({
      manualKillSwitch: z.literal('manually-released-for-this-bounded-benchmark-only'),
      serverSideNetwork: z.literal('authorized-only-for-the-exact-allowlisted-endpoint'),
      browserNetwork: z.literal('forbidden'),
      environmentSecretPresenceAloneAuthorizes: z.literal(false),
    })
    .readonly(),
} as const;

const RealModelBenchmarkAuthorizationPayloadV1Schema = z
  .strictObject(authorizationPayloadShape)
  .readonly();

export const renderRealModelBenchmarkAuthorizationStatementV1 = (input: unknown): string => {
  const payload = RealModelBenchmarkAuthorizationPayloadV1Schema.parse(input);
  return `I explicitly authorize this one bounded Banner AI real-model benchmark payload=${canonicalizeJson(payload)}. I authorize no other provider, model, version, endpoint, corpus, prompt, policy, workflow, call, retry, spend, time, data use, or purpose.`;
};

export const RealModelBenchmarkAuthorizationV1Schema = z
  .strictObject({
    ...authorizationPayloadShape,
    renderedUserStatement: z.string(),
  })
  .superRefine((authorization, context) => {
    const { renderedUserStatement, ...payload } = authorization;
    if (renderedUserStatement !== renderRealModelBenchmarkAuthorizationStatementV1(payload)) {
      context.addIssue({
        code: 'custom',
        message: 'Rendered authorization statement must exactly bind the canonical payload.',
        path: ['renderedUserStatement'],
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
  controlVersion: z.literal(1),
  controlId: z.literal('banner-ai-real-model-benchmark-kill-switch-v1'),
  revision: z.int().min(1).max(2_147_483_647),
  authoritySource: z.literal('fresh-authoritative-server-side-read-required-before-every-call'),
} as const;

const EngagedManualControlV1Schema = z
  .strictObject({
    ...ManualControlCommonShape,
    state: z.literal('engaged'),
  })
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
  })
  .readonly();

export const RealModelBenchmarkManualControlV1Schema = z.discriminatedUnion('state', [
  EngagedManualControlV1Schema,
  ReengagedManualControlV1Schema,
  ReleasedManualControlV1Schema,
]);

export const DEFAULT_REAL_MODEL_BENCHMARK_MANUAL_CONTROL_V1 =
  RealModelBenchmarkManualControlV1Schema.parse({
    controlVersion: 1,
    controlId: 'banner-ai-real-model-benchmark-kill-switch-v1',
    revision: 1,
    authoritySource: 'fresh-authoritative-server-side-read-required-before-every-call',
    state: 'engaged',
  });

// Execution-state validation and OCR quality evaluation live in their separate trust-boundary
// modules. This profile module remains configuration, candidate, authorization, and manual control only.
