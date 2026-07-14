import { z } from 'zod';

import { CanonicalMicrosStringSchema } from '../jobs/cost-budget.js';
import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import { AiModelContractV1Schema } from './ai-contracts.js';
import { BenchmarkPricingConfigV1Schema } from './cost-estimator.js';
import { OPENAI_SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_SHA256 } from './openai-scene-analysis-output.js';
import { SCENE_ANALYSIS_PROMPT_V1 } from './prompt-catalog.js';

export const OPENAI_REAL_MODEL_PROVIDER_KEY = 'openai' as const;
export const OPENAI_REAL_MODEL_RESPONSES_API_FAMILY = 'responses' as const;
export const OPENAI_REAL_MODEL_ENDPOINT = 'https://api.openai.com/v1/responses' as const;
export const OPENAI_REAL_MODEL_REQUESTED_MODEL_ID = 'gpt-5.6-terra' as const;
export const OPENAI_REAL_MODEL_SECRET_REFERENCE_NAME = 'OPENAI_API_KEY' as const;
export const OPENAI_REAL_MODEL_MAX_OUTPUT_TOKENS = 4_096 as const;

export const CanonicalUtcTimestampSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
  }, 'Timestamp must be a real canonical UTC instant with millisecond precision.');

const exactCanonicalEquality = (left: unknown, right: unknown): boolean =>
  canonicalizeJson(left) === canonicalizeJson(right);

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

export const OPENAI_REAL_MODEL_ENDPOINT_POLICY_V1 = BenchmarkEndpointPolicyV1Schema.parse({
  method: 'POST',
  url: OPENAI_REAL_MODEL_ENDPOINT,
  redirects: 'forbidden',
  alternateOrigins: 'forbidden',
  alternatePaths: 'forbidden',
  alternateMethods: 'forbidden',
  literalIpHosts: 'forbidden',
  localhostLocalAndInternalHosts: 'forbidden',
  dnsResolution:
    'future-executor-resolves-only-public-approved-addresses-and-pins-them-for-the-call',
  privateReservedLinkLocalAndLoopbackAddresses: 'forbidden',
  dnsRebinding: 'forbidden',
  proxyOverride: 'forbidden',
});

const OpenAiExactEndpointPolicyV1Schema = BenchmarkEndpointPolicyV1Schema.superRefine(
  (endpoint, context) => {
    if (!exactCanonicalEquality(endpoint, OPENAI_REAL_MODEL_ENDPOINT_POLICY_V1)) {
      context.addIssue({
        code: 'custom',
        message: 'Only the exact OpenAI Responses endpoint policy is admissible.',
      });
    }
  },
);

export const OPENAI_REAL_MODEL_CONTRACT_V1 = AiModelContractV1Schema.parse({
  identity: {
    identityVersion: 1,
    providerKey: OPENAI_REAL_MODEL_PROVIDER_KEY,
    modelKey: OPENAI_REAL_MODEL_REQUESTED_MODEL_ID,
    modelVersion: 1,
    external: true,
  },
  capabilities: {
    capabilitiesVersion: 1,
    capabilities: ['ocr', 'scene_analysis', 'structured_output'],
  },
});

const pricingEvidenceCore = Object.freeze({
  pricingEvidenceVersion: 1 as const,
  capturedDate: '2026-07-13' as const,
  sourceDescriptor: 'user-supplied OpenAI public pricing page evidence' as const,
  providerKey: OPENAI_REAL_MODEL_PROVIDER_KEY,
  requestedModelId: OPENAI_REAL_MODEL_REQUESTED_MODEL_ID,
  priceClass: 'standard' as const,
  currency: 'USD' as const,
  unit: 'micro-USD-per-million-tokens' as const,
  standardInputMicrosPerMillionTokens: '2500000' as const,
  standardOutputMicrosPerMillionTokens: '15000000' as const,
  productionPriceTruth: false as const,
  futureAuthorizationReconfirmation: 'required' as const,
});

export const OpenAiBenchmarkPricingEvidenceV1Schema = z
  .strictObject({
    pricingEvidenceVersion: z.literal(1),
    capturedDate: z.literal('2026-07-13'),
    sourceDescriptor: z.literal('user-supplied OpenAI public pricing page evidence'),
    providerKey: z.literal(OPENAI_REAL_MODEL_PROVIDER_KEY),
    requestedModelId: z.literal(OPENAI_REAL_MODEL_REQUESTED_MODEL_ID),
    priceClass: z.literal('standard'),
    currency: z.literal('USD'),
    unit: z.literal('micro-USD-per-million-tokens'),
    standardInputMicrosPerMillionTokens: z.literal('2500000'),
    standardOutputMicrosPerMillionTokens: z.literal('15000000'),
    productionPriceTruth: z.literal(false),
    futureAuthorizationReconfirmation: z.literal('required'),
    evidenceSha256: Sha256HexSchema,
  })
  .superRefine((evidence, context) => {
    const { evidenceSha256, ...core } = evidence;
    const actual = sha256Hex(Buffer.from(canonicalizeJson(core), 'utf8'));
    if (evidenceSha256 !== actual) {
      context.addIssue({
        code: 'custom',
        message: 'Pricing evidence digest differs from the exact dated assertion.',
        path: ['evidenceSha256'],
      });
    }
  })
  .readonly();

export const OPENAI_BENCHMARK_PRICING_EVIDENCE_V1 = OpenAiBenchmarkPricingEvidenceV1Schema.parse({
  ...pricingEvidenceCore,
  evidenceSha256: sha256Hex(Buffer.from(canonicalizeJson(pricingEvidenceCore), 'utf8')),
});

const responsesRequestContractCore = Object.freeze({
  contractVersion: 1 as const,
  status: 'proposed-unverified-api-shape' as const,
  providerKey: OPENAI_REAL_MODEL_PROVIDER_KEY,
  apiFamily: OPENAI_REAL_MODEL_RESPONSES_API_FAMILY,
  endpoint: OPENAI_REAL_MODEL_ENDPOINT,
  method: 'POST' as const,
  requestedModelId: OPENAI_REAL_MODEL_REQUESTED_MODEL_ID,
  canonicalPrompt: Object.freeze({
    id: 'scene-analysis-v1' as const,
    version: 1 as const,
    contentSha256: SCENE_ANALYSIS_PROMPT_V1.contentSha256,
    placement: 'sole-instructions-field' as const,
  }),
  imageInput: Object.freeze({
    source: 'trusted-local-normalized-png-bytes-only' as const,
    transport: 'data:image/png;base64-only' as const,
    detail: 'original' as const,
    providerUrlFetching: 'forbidden' as const,
  }),
  structuredOutput: Object.freeze({
    formatType: 'json_schema' as const,
    name: 'banner_scene_analysis_ocr_v1' as const,
    strict: true as const,
    schemaSha256: OPENAI_SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_SHA256,
  }),
  maxOutputTokens: OPENAI_REAL_MODEL_MAX_OUTPUT_TOKENS,
  tools: Object.freeze([]),
  toolChoice: 'none' as const,
  background: false as const,
  store: false as const,
  previousResponseOrConversation: 'absent' as const,
  followUpOrAutonomousWork: 'absent' as const,
  futureOfficialEvidenceRequirement:
    'authorization-must-bind-current-official-model-availability-and-every-api-field-semantics' as const,
});

export const ProposedOpenAiResponsesRequestContractV1Schema = z
  .strictObject({
    contractVersion: z.literal(1),
    status: z.literal('proposed-unverified-api-shape'),
    providerKey: z.literal(OPENAI_REAL_MODEL_PROVIDER_KEY),
    apiFamily: z.literal(OPENAI_REAL_MODEL_RESPONSES_API_FAMILY),
    endpoint: z.literal(OPENAI_REAL_MODEL_ENDPOINT),
    method: z.literal('POST'),
    requestedModelId: z.literal(OPENAI_REAL_MODEL_REQUESTED_MODEL_ID),
    canonicalPrompt: z
      .strictObject({
        id: z.literal('scene-analysis-v1'),
        version: z.literal(1),
        contentSha256: z.literal(SCENE_ANALYSIS_PROMPT_V1.contentSha256),
        placement: z.literal('sole-instructions-field'),
      })
      .readonly(),
    imageInput: z
      .strictObject({
        source: z.literal('trusted-local-normalized-png-bytes-only'),
        transport: z.literal('data:image/png;base64-only'),
        detail: z.literal('original'),
        providerUrlFetching: z.literal('forbidden'),
      })
      .readonly(),
    structuredOutput: z
      .strictObject({
        formatType: z.literal('json_schema'),
        name: z.literal('banner_scene_analysis_ocr_v1'),
        strict: z.literal(true),
        schemaSha256: z.literal(OPENAI_SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_SHA256),
      })
      .readonly(),
    maxOutputTokens: z.literal(OPENAI_REAL_MODEL_MAX_OUTPUT_TOKENS),
    tools: z.tuple([]),
    toolChoice: z.literal('none'),
    background: z.literal(false),
    store: z.literal(false),
    previousResponseOrConversation: z.literal('absent'),
    followUpOrAutonomousWork: z.literal('absent'),
    futureOfficialEvidenceRequirement: z.literal(
      'authorization-must-bind-current-official-model-availability-and-every-api-field-semantics',
    ),
    requestShapeSha256: Sha256HexSchema,
  })
  .superRefine((contract, context) => {
    const { requestShapeSha256, ...core } = contract;
    const actual = sha256Hex(Buffer.from(canonicalizeJson(core), 'utf8'));
    if (actual !== requestShapeSha256) {
      context.addIssue({
        code: 'custom',
        message: 'Responses API request-shape digest differs from the frozen proposal.',
        path: ['requestShapeSha256'],
      });
    }
  })
  .readonly();

export const PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1 =
  ProposedOpenAiResponsesRequestContractV1Schema.parse({
    ...responsesRequestContractCore,
    requestShapeSha256: sha256Hex(
      Buffer.from(canonicalizeJson(responsesRequestContractCore), 'utf8'),
    ),
  });

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

const ZeroRetryPolicyV1Schema = z
  .strictObject({
    mode: z.literal('zero-retry'),
    maximumRetryCount: z.literal(0),
    idempotencyHeaderOrMechanism: z.literal('none'),
    timeoutDisposition: z.literal('terminal-fail-closed'),
  })
  .readonly();

const EvidencedTimeoutReplayPolicyV1Schema = z
  .strictObject({
    mode: z.literal('one-timeout-replay-with-exact-provider-evidence'),
    maximumRetryCount: z.literal(1),
    providerKey: z.literal(OPENAI_REAL_MODEL_PROVIDER_KEY),
    requestedModelId: z.literal(OPENAI_REAL_MODEL_REQUESTED_MODEL_ID),
    endpoint: OpenAiExactEndpointPolicyV1Schema,
    evidenceCapturedAt: CanonicalUtcTimestampSchema,
    evidenceExpiresAt: CanonicalUtcTimestampSchema,
    evidenceSha256: Sha256HexSchema,
    executionAndBillingAssertion: z.literal(
      'at-most-once-provider-execution-and-billing-for-one-logical-run-after-indeterminate-timeout',
    ),
    mechanism: ExternalIdempotencyMechanismV1Schema,
    userConfirmation: z.literal(
      'confirmed-current-provider-model-endpoint-specific-idempotency-replay-and-billing-contract',
    ),
  })
  .superRefine((policy, context) => {
    if (Date.parse(policy.evidenceCapturedAt) >= Date.parse(policy.evidenceExpiresAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Replay evidence must have a positive fresh window.',
      });
    }
  })
  .readonly();

export const RealModelBenchmarkRetryPolicyV1Schema = z.discriminatedUnion('mode', [
  ZeroRetryPolicyV1Schema,
  EvidencedTimeoutReplayPolicyV1Schema,
]);

export const ZERO_RETRY_REAL_MODEL_BENCHMARK_POLICY_V1 =
  RealModelBenchmarkRetryPolicyV1Schema.parse({
    mode: 'zero-retry',
    maximumRetryCount: 0,
    idempotencyHeaderOrMechanism: 'none',
    timeoutDisposition: 'terminal-fail-closed',
  });

const observedProviderIdentityCoreSchema = {
  identityEvidenceVersion: z.literal(1),
  providerKey: z.literal(OPENAI_REAL_MODEL_PROVIDER_KEY),
  requestedModelId: z.literal(OPENAI_REAL_MODEL_REQUESTED_MODEL_ID),
  observedProviderModelVersion: z.string().min(1).max(200),
  observedProviderFingerprint: z.string().min(1).max(300),
} as const;

export const OpenAiAuthorizedObservedIdentityEvidenceV1Schema = z
  .strictObject({
    ...observedProviderIdentityCoreSchema,
    officialEvidenceCapturedAt: CanonicalUtcTimestampSchema,
    officialEvidenceExpiresAt: CanonicalUtcTimestampSchema,
    modelAvailabilityEvidenceSha256: Sha256HexSchema,
    responsesApiFieldSemanticsEvidenceSha256: Sha256HexSchema,
    endpointEvidenceSha256: Sha256HexSchema,
    observedIdentityEvidenceSha256: Sha256HexSchema,
  })
  .superRefine((evidence, context) => {
    const { observedIdentityEvidenceSha256, ...core } = evidence;
    const actual = sha256Hex(Buffer.from(canonicalizeJson(core), 'utf8'));
    if (actual !== observedIdentityEvidenceSha256) {
      context.addIssue({
        code: 'custom',
        message: 'Authorized observed provider identity evidence digest mismatched.',
        path: ['observedIdentityEvidenceSha256'],
      });
    }
    if (
      Date.parse(evidence.officialEvidenceCapturedAt) >=
      Date.parse(evidence.officialEvidenceExpiresAt)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Official identity evidence must have a positive fresh window.',
      });
    }
  })
  .readonly();

export const digestOpenAiAuthorizedObservedIdentityEvidenceV1 = (input: unknown): string => {
  const parsed = z
    .strictObject({
      ...observedProviderIdentityCoreSchema,
      officialEvidenceCapturedAt: CanonicalUtcTimestampSchema,
      officialEvidenceExpiresAt: CanonicalUtcTimestampSchema,
      modelAvailabilityEvidenceSha256: Sha256HexSchema,
      responsesApiFieldSemanticsEvidenceSha256: Sha256HexSchema,
      endpointEvidenceSha256: Sha256HexSchema,
    })
    .parse(input);
  return sha256Hex(Buffer.from(canonicalizeJson(parsed), 'utf8'));
};

export const OpenAiExecutionObservedIdentityV1Schema = z
  .strictObject({
    ...observedProviderIdentityCoreSchema,
    responseObservedAt: CanonicalUtcTimestampSchema,
    responseIdentityEvidenceSha256: Sha256HexSchema,
  })
  .superRefine((evidence, context) => {
    const { responseIdentityEvidenceSha256, ...core } = evidence;
    const actual = sha256Hex(Buffer.from(canonicalizeJson(core), 'utf8'));
    if (actual !== responseIdentityEvidenceSha256) {
      context.addIssue({
        code: 'custom',
        message: 'Execution-observed provider identity evidence digest mismatched.',
        path: ['responseIdentityEvidenceSha256'],
      });
    }
  })
  .readonly();

export const digestOpenAiExecutionObservedIdentityV1 = (input: unknown): string => {
  const parsed = z
    .strictObject({
      ...observedProviderIdentityCoreSchema,
      responseObservedAt: CanonicalUtcTimestampSchema,
    })
    .parse(input);
  return sha256Hex(Buffer.from(canonicalizeJson(parsed), 'utf8'));
};

export const validateOpenAiExecutionObservedIdentityV1 = (input: {
  readonly authorizedEvidence: unknown;
  readonly executionObservedIdentity: unknown;
}) => {
  const authorized = OpenAiAuthorizedObservedIdentityEvidenceV1Schema.parse(
    input.authorizedEvidence,
  );
  const observed = OpenAiExecutionObservedIdentityV1Schema.parse(input.executionObservedIdentity);
  if (
    authorized.providerKey !== observed.providerKey ||
    authorized.requestedModelId !== observed.requestedModelId ||
    authorized.observedProviderModelVersion !== observed.observedProviderModelVersion ||
    authorized.observedProviderFingerprint !== observed.observedProviderFingerprint
  ) {
    throw new TypeError(
      'Execution-observed provider/model-version/fingerprint identity is absent or mismatched.',
    );
  }
  const responseObservedAtMs = Date.parse(observed.responseObservedAt);
  if (
    responseObservedAtMs < Date.parse(authorized.officialEvidenceCapturedAt) ||
    responseObservedAtMs >= Date.parse(authorized.officialEvidenceExpiresAt) ||
    responseObservedAtMs > Date.now()
  ) {
    throw new TypeError(
      'Execution-observed provider identity timestamp is future-dated or outside the authorized evidence window.',
    );
  }
  return observed;
};

const openAiWorstCaseRequestCostProofCoreShape = {
  proofVersion: z.literal(1),
  status: z.literal('complete-provider-model-endpoint-request-shape-specific-proof'),
  providerKey: z.literal(OPENAI_REAL_MODEL_PROVIDER_KEY),
  requestedModelId: z.literal(OPENAI_REAL_MODEL_REQUESTED_MODEL_ID),
  endpoint: OpenAiExactEndpointPolicyV1Schema,
  requestShapeSha256: z.literal(PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1.requestShapeSha256),
  pricingEvidenceSha256: z.literal(OPENAI_BENCHMARK_PRICING_EVIDENCE_V1.evidenceSha256),
  exactMaxOutputTokens: z.literal(OPENAI_REAL_MODEL_MAX_OUTPUT_TOKENS),
  originalDetailImageTokenFormulaEvidenceSha256: Sha256HexSchema,
  promptSchemaAndInputTokenEvidenceSha256: Sha256HexSchema,
  hiddenReasoningAndBilledOutputEvidenceSha256: Sha256HexSchema,
  roundingAndOtherBilledUnitsEvidenceSha256: Sha256HexSchema,
  exactWorstCaseCostMicros: CanonicalMicrosStringSchema,
  perCallCeilingMicros: z.literal('100000'),
  capturedAt: CanonicalUtcTimestampSchema,
  expiresAt: CanonicalUtcTimestampSchema,
  userConfirmation: z.literal('confirmed-worst-case-request-cost-does-not-exceed-100000-micro-usd'),
} as const;

const OpenAiWorstCaseRequestCostProofCoreV1Schema = z
  .strictObject(openAiWorstCaseRequestCostProofCoreShape)
  .readonly();

export const OpenAiWorstCaseRequestCostProofV1Schema = z
  .strictObject({
    ...openAiWorstCaseRequestCostProofCoreShape,
    proofSha256: Sha256HexSchema,
  })
  .superRefine((proof, context) => {
    const { proofSha256, ...core } = proof;
    if (BigInt(proof.exactWorstCaseCostMicros) > 100_000n) {
      context.addIssue({
        code: 'custom',
        message: 'Worst-case proof exceeds the immutable per-call ceiling.',
        path: ['exactWorstCaseCostMicros'],
      });
    }
    const actual = sha256Hex(Buffer.from(canonicalizeJson(core), 'utf8'));
    if (actual !== proofSha256) {
      context.addIssue({
        code: 'custom',
        message: 'Worst-case request-cost proof digest mismatched.',
        path: ['proofSha256'],
      });
    }
    if (Date.parse(proof.capturedAt) >= Date.parse(proof.expiresAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Worst-case proof must have a positive fresh window.',
      });
    }
  })
  .readonly();

export const digestOpenAiWorstCaseRequestCostProofV1 = (input: unknown): string => {
  const parsed = OpenAiWorstCaseRequestCostProofCoreV1Schema.parse(input);
  return sha256Hex(Buffer.from(canonicalizeJson(parsed), 'utf8'));
};

export const OPENAI_REAL_MODEL_RESERVATION_CONFIG_V1 = BenchmarkPricingConfigV1Schema.parse({
  configVersion: 1,
  configId: 'openai-gpt-5.6-terra-reservation-ceiling-v1',
  currency: 'USD',
  purpose: 'benchmark-only',
  productionPriceTruth: false,
  rates: {
    modelInferenceMicrosPerUnit: '100000',
    segmentationComputeMicrosPerUnit: '0',
    inpaintingMicrosPerUnit: '0',
    storageMicrosPerByteMonth: '0',
    retryMicrosPerUnit: '0',
    failedAttemptMicrosPerUnit: '0',
  },
});

export const digestOpenAiReservationConfigV1 = (): string =>
  sha256Hex(Buffer.from(canonicalizeJson(OPENAI_REAL_MODEL_RESERVATION_CONFIG_V1), 'utf8'));

export const SelectedRealModelBenchmarkCandidateV1Schema = z
  .strictObject({
    candidateVersion: z.literal(2),
    providerKey: z.literal(OPENAI_REAL_MODEL_PROVIDER_KEY),
    apiFamily: z.literal(OPENAI_REAL_MODEL_RESPONSES_API_FAMILY),
    model: AiModelContractV1Schema,
    providerModelIdentifier: z.literal(OPENAI_REAL_MODEL_REQUESTED_MODEL_ID),
    modelAliasStatus: z.literal('proposed-unverified-provider-alias'),
    immutableSnapshotClaim: z.literal(false),
    providerModelVersionEvidenceStatus: z.literal(
      'absent-must-be-bound-by-future-exact-authorization-and-verified-at-execution',
    ),
    responseIdentityRequirement: z
      .strictObject({
        providerKey: z.literal(OPENAI_REAL_MODEL_PROVIDER_KEY),
        requestedModelId: z.literal(OPENAI_REAL_MODEL_REQUESTED_MODEL_ID),
        comparison: z.literal(
          'future-authorized-observed-provider-model-version-and-fingerprint-exact-equality',
        ),
        missingOrMismatch: z.literal('fail-closed'),
      })
      .readonly(),
    responsesRequestContract: ProposedOpenAiResponsesRequestContractV1Schema,
    endpointAllowlist: z.tuple([OpenAiExactEndpointPolicyV1Schema]).readonly(),
    pricingEvidence: OpenAiBenchmarkPricingEvidenceV1Schema,
    worstCaseReservationConfig: BenchmarkPricingConfigV1Schema,
    worstCaseReservationConfigSha256: Sha256HexSchema,
    worstCaseRequestCostProofStatus: z.literal(
      'absent-token-rates-do-not-prove-per-call-reservation-execution-blocked',
    ),
    retryPolicyRequirement: z
      .strictObject({
        committedDefault: z.literal('zero-retry'),
        numericalRetryCaps: z.literal('ceilings-not-authority'),
        futureAuthorization: z.literal(
          'strict-zero-retry-or-one-timeout-replay-with-exact-dated-provider-evidence',
        ),
      })
      .readonly(),
    serverSideSecret: z
      .strictObject({
        name: z.literal(OPENAI_REAL_MODEL_SECRET_REFERENCE_NAME),
        access: z.literal('server-side-only'),
        valueStorage: z.literal(
          'reference-name-only-no-value-in-source-profile-authorization-or-logs',
        ),
      })
      .readonly(),
  })
  .superRefine((candidate, context) => {
    if (!exactCanonicalEquality(candidate.model, OPENAI_REAL_MODEL_CONTRACT_V1)) {
      context.addIssue({
        code: 'custom',
        message: 'Candidate model contract is not exact OpenAI.',
      });
    }
    if (
      !exactCanonicalEquality(
        candidate.responsesRequestContract,
        PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1,
      ) ||
      !exactCanonicalEquality(
        candidate.endpointAllowlist[0],
        OPENAI_REAL_MODEL_ENDPOINT_POLICY_V1,
      ) ||
      !exactCanonicalEquality(candidate.pricingEvidence, OPENAI_BENCHMARK_PRICING_EVIDENCE_V1) ||
      !exactCanonicalEquality(
        candidate.worstCaseReservationConfig,
        OPENAI_REAL_MODEL_RESERVATION_CONFIG_V1,
      ) ||
      candidate.worstCaseReservationConfigSha256 !== digestOpenAiReservationConfigV1()
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Candidate endpoint, request shape, pricing, or reservation evidence drifted.',
      });
    }
  })
  .readonly();

export const OPENAI_REAL_MODEL_BENCHMARK_CANDIDATE_V1 =
  SelectedRealModelBenchmarkCandidateV1Schema.parse({
    candidateVersion: 2,
    providerKey: OPENAI_REAL_MODEL_PROVIDER_KEY,
    apiFamily: OPENAI_REAL_MODEL_RESPONSES_API_FAMILY,
    model: OPENAI_REAL_MODEL_CONTRACT_V1,
    providerModelIdentifier: OPENAI_REAL_MODEL_REQUESTED_MODEL_ID,
    modelAliasStatus: 'proposed-unverified-provider-alias',
    immutableSnapshotClaim: false,
    providerModelVersionEvidenceStatus:
      'absent-must-be-bound-by-future-exact-authorization-and-verified-at-execution',
    responseIdentityRequirement: {
      providerKey: OPENAI_REAL_MODEL_PROVIDER_KEY,
      requestedModelId: OPENAI_REAL_MODEL_REQUESTED_MODEL_ID,
      comparison:
        'future-authorized-observed-provider-model-version-and-fingerprint-exact-equality',
      missingOrMismatch: 'fail-closed',
    },
    responsesRequestContract: PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1,
    endpointAllowlist: [OPENAI_REAL_MODEL_ENDPOINT_POLICY_V1],
    pricingEvidence: OPENAI_BENCHMARK_PRICING_EVIDENCE_V1,
    worstCaseReservationConfig: OPENAI_REAL_MODEL_RESERVATION_CONFIG_V1,
    worstCaseReservationConfigSha256: digestOpenAiReservationConfigV1(),
    worstCaseRequestCostProofStatus:
      'absent-token-rates-do-not-prove-per-call-reservation-execution-blocked',
    retryPolicyRequirement: {
      committedDefault: 'zero-retry',
      numericalRetryCaps: 'ceilings-not-authority',
      futureAuthorization:
        'strict-zero-retry-or-one-timeout-replay-with-exact-dated-provider-evidence',
    },
    serverSideSecret: {
      name: OPENAI_REAL_MODEL_SECRET_REFERENCE_NAME,
      access: 'server-side-only',
      valueStorage: 'reference-name-only-no-value-in-source-profile-authorization-or-logs',
    },
  });

export type SelectedRealModelBenchmarkCandidateV1 = z.infer<
  typeof SelectedRealModelBenchmarkCandidateV1Schema
>;
