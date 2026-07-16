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
  validateSceneAnalysisModelDispatchContentPolicyV1,
  validateSceneAnalysisRequestContextV1,
} from '../evaluation/ai-contracts.js';
import {
  QWEN3_VL_API_FAMILY,
  QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT,
  QWEN3_VL_HISTORICAL_FRANKFURT_CHAT_COMPLETIONS_ENDPOINT,
  QWEN3_VL_HISTORICAL_FRANKFURT_WORKSPACE_ID,
  QWEN3_VL_HISTORICAL_EVIDENCE_RETRIEVED_DATE,
  QWEN3_VL_HISTORICAL_PRICING_EVIDENCE_SHA256,
  QWEN3_VL_ENDPOINT_METHOD,
  QWEN3_VL_FLASH_MODEL_CONTRACT_V1,
  QWEN3_VL_MAX_OUTPUT_TOKENS,
  QWEN3_VL_OFFICIAL_EVIDENCE_RETRIEVED_DATE,
  QWEN3_VL_OFFICIAL_EVIDENCE_RETRIEVED_AT,
  QWEN3_VL_PRICING_EVIDENCE_V1_SHA256,
  QWEN3_VL_PRICING_EVIDENCE_V2_SHA256,
  QWEN3_VL_PROVIDER_IDENTITY_V2_SHA256,
  QWEN3_VL_PROVIDER_KEY,
  QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2,
  QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_SHA256,
  QWEN3_VL_REQUESTED_MODEL_ID,
  QWEN3_VL_REQUEST_SHAPE_V2_SHA256,
  QWEN3_VL_REQUEST_SHAPE_V3_SHA256,
  QWEN3_VL_SECRET_REFERENCE_NAME,
  QWEN3_VL_SERVER_WORKSPACE_ID,
  QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256,
  QWEN_FOUR_FIXTURE_HUMAN_ORACLE_CORPUS_SHA256,
  QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256,
  QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2,
  QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2_SHA256,
  QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V3,
  QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V3_SHA256,
  assertQwen3VlOfficialEvidenceFresh,
  calculateQwen3VlListCostMicros,
  type QwenProviderUsageV1,
} from '../evaluation/qwen3-vl-candidate-evidence.js';
import { SCENE_ANALYSIS_PROMPT_V1 } from '../evaluation/prompt-catalog.js';
import {
  QWEN_FOUR_FIXTURE_CANONICAL_REQUEST_CATALOG_V1,
  QWEN_FOUR_FIXTURE_ACTIVE_MODEL_INPUT_DIGESTS_SHA256,
  QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_V2_SHA256,
  requireCanonicalQwenBenchmarkRequestV1,
} from './qwen-four-fixture-request-catalog.js';
import {
  QwenResponseBoundaryFailure,
  createSyntheticQwenValidationDiagnosticV1,
  validateQwenProviderResponseBoundaryV1,
  type QwenValidationDiagnosticV1,
} from './qwen3-vl-response-boundary.js';
import {
  QwenDiagnosticCaptureError,
  QwenDiagnosticReportRelativePathV1Schema,
  QwenDiagnosticResponseRelativePathV1Schema,
  abortQwenDiagnosticArtifactReservationsV1,
  captureSanitizedQwenResponseV1,
  finalizeReservedQwenDiagnosticReportV1,
  reserveQwenDiagnosticArtifactFilesV1,
  verifyQwenDiagnosticArtifactReservationsV1,
  type QwenDiagnosticArtifactMetadataV1,
  type QwenDiagnosticReservationSetV1,
} from './qwen3-vl-response-diagnostics.js';

export const QwenDiagnosticCaptureAuthorizationV1Schema = z
  .strictObject({
    diagnosticVersion: z.literal(1),
    mode: z.literal('single-fixture-response-capture'),
    fixtureId: z.literal('banner-person-v1'),
    providerCallsMaximum: z.literal(1),
    retryCount: z.literal(0),
    responseArtifactRelativePath: QwenDiagnosticResponseRelativePathV1Schema,
    diagnosticReportRelativePath: QwenDiagnosticReportRelativePathV1Schema,
    productionAdmissionAuthority: z.literal(false),
  })
  .superRefine((diagnostic, context) => {
    if (
      diagnostic.responseArtifactRelativePath === diagnostic.diagnosticReportRelativePath ||
      diagnostic.responseArtifactRelativePath.endsWith('qwen3-vl-four-fixture-benchmark.json') ||
      diagnostic.diagnosticReportRelativePath.endsWith('qwen3-vl-four-fixture-benchmark.json') ||
      diagnostic.responseArtifactRelativePath.endsWith('qwen-live-execution-authorization.json') ||
      diagnostic.diagnosticReportRelativePath.endsWith('qwen-live-execution-authorization.json')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Qwen diagnostic paths must be unique and new.',
      });
    }
  })
  .readonly();

export const QwenBenchmarkAuthorizationPacketV2Schema = z
  .strictObject({
    authorizationVersion: z.literal(2),
    authorizationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/u),
    mode: z.enum(['deterministic-fake', 'live-provider']),
    purpose: z.literal('one-capped-four-fixture-sequential-zero-retry-benchmark'),
    issuedAtMs: z.int().min(0),
    expiresAtMs: z.int().min(1),
    serverWorkspaceId: z.literal('ws-vy71dtw49uzef5hz'),
    endpoint: z.literal(QWEN3_VL_HISTORICAL_FRANKFURT_CHAT_COMPLETIONS_ENDPOINT),
    endpointMethod: z.literal(QWEN3_VL_ENDPOINT_METHOD),
    apiFamily: z.literal(QWEN3_VL_API_FAMILY),
    providerKey: z.literal(QWEN3_VL_PROVIDER_KEY),
    requestedModelId: z.literal(QWEN3_VL_REQUESTED_MODEL_ID),
    secretReferenceName: z.literal(QWEN3_VL_SECRET_REFERENCE_NAME),
    pendingCorpusCoreSha256: z.literal(QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256),
    humanOracleCorpusSha256: z.literal(QWEN_FOUR_FIXTURE_HUMAN_ORACLE_CORPUS_SHA256),
    pricingEvidenceSha256: z.literal(QWEN3_VL_PRICING_EVIDENCE_V1_SHA256),
    pricingEvidenceRetrievedDate: z.literal('2026-07-15'),
    providerProtocolWrapperSha256: z.literal(QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_SHA256),
    requestShapeSha256: z.literal(QWEN3_VL_REQUEST_SHAPE_V2_SHA256),
    benchmarkCapsSha256: z.literal(QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256),
    contentPolicyDefinitionSha256: z.literal(
      BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
    ),
    workflowDefinitionSha256: z.literal(INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1.definitionSha256),
    orderedModelInputDigestsSha256: z.literal(
      QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_V2_SHA256,
    ),
    diagnosticCapture: QwenDiagnosticCaptureAuthorizationV1Schema.optional(),
    executionAuthorized: z.literal(true),
  })
  .superRefine((authorization, context) => {
    if (
      authorization.issuedAtMs >= authorization.expiresAtMs ||
      authorization.endpoint !== QWEN3_VL_HISTORICAL_FRANKFURT_CHAT_COMPLETIONS_ENDPOINT
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Qwen authorization timing or derived endpoint is stale or foreign.',
      });
    }
    if (authorization.diagnosticCapture !== undefined && authorization.mode !== 'live-provider') {
      context.addIssue({
        code: 'custom',
        message: 'Qwen response capture requires an exact live-provider authorization.',
      });
    }
  })
  .readonly();

export const QwenDiagnosticCaptureAuthorizationV2Schema = z
  .strictObject({
    diagnosticVersion: z.literal(2),
    mode: z.literal('single-fixture-response-capture'),
    fixtureId: z.literal('banner-person-v1'),
    providerCallsMaximum: z.literal(1),
    retryCount: z.literal(0),
    perCallTimeoutMs: z.literal(QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2.perCallTimeoutMs),
    totalWallTimeMs: z.literal(QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2.totalWallTimeMs),
    totalCalculatedListCostMaximumMicroUsd: z.literal('50000'),
    diagnosticCapsSha256: z.literal(QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2_SHA256),
    responseArtifactRelativePath: QwenDiagnosticResponseRelativePathV1Schema,
    diagnosticReportRelativePath: QwenDiagnosticReportRelativePathV1Schema,
    productionAdmissionAuthority: z.literal(false),
    webRouteActivated: z.literal(false),
  })
  .superRefine((diagnostic, context) => {
    if (
      diagnostic.perCallTimeoutMs !== QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2.perCallTimeoutMs ||
      diagnostic.totalWallTimeMs !== QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2.totalWallTimeMs ||
      diagnostic.totalCalculatedListCostMaximumMicroUsd !== '50000' ||
      diagnostic.diagnosticCapsSha256 !== QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2_SHA256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Qwen diagnostic caps are not exact active revision V2.',
      });
    }
    if (
      diagnostic.responseArtifactRelativePath === diagnostic.diagnosticReportRelativePath ||
      diagnostic.responseArtifactRelativePath.endsWith('qwen3-vl-four-fixture-benchmark.json') ||
      diagnostic.diagnosticReportRelativePath.endsWith('qwen3-vl-four-fixture-benchmark.json') ||
      diagnostic.responseArtifactRelativePath.endsWith('qwen-live-execution-authorization.json') ||
      diagnostic.diagnosticReportRelativePath.endsWith('qwen-live-execution-authorization.json')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Qwen diagnostic paths must be unique and new.',
      });
    }
  })
  .readonly();

export const QwenBenchmarkAuthorizationPacketV3Schema = z
  .strictObject({
    authorizationVersion: z.literal(3),
    authorizationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/u),
    mode: z.literal('live-provider'),
    purpose: z.literal('one-capped-single-fixture-diagnostic-response-capture'),
    issuedAtMs: z.int().min(0),
    expiresAtMs: z.int().min(1),
    serverWorkspaceId: z.literal(QWEN3_VL_HISTORICAL_FRANKFURT_WORKSPACE_ID),
    endpoint: z.literal(QWEN3_VL_HISTORICAL_FRANKFURT_CHAT_COMPLETIONS_ENDPOINT),
    endpointMethod: z.literal(QWEN3_VL_ENDPOINT_METHOD),
    apiFamily: z.literal(QWEN3_VL_API_FAMILY),
    providerKey: z.literal(QWEN3_VL_PROVIDER_KEY),
    requestedModelId: z.literal(QWEN3_VL_REQUESTED_MODEL_ID),
    secretReferenceName: z.literal(QWEN3_VL_SECRET_REFERENCE_NAME),
    pendingCorpusCoreSha256: z.literal(QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256),
    humanOracleCorpusSha256: z.literal(QWEN_FOUR_FIXTURE_HUMAN_ORACLE_CORPUS_SHA256),
    pricingEvidenceSha256: z.literal(QWEN3_VL_HISTORICAL_PRICING_EVIDENCE_SHA256),
    pricingEvidenceRetrievedDate: z.literal(QWEN3_VL_HISTORICAL_EVIDENCE_RETRIEVED_DATE),
    providerProtocolWrapperSha256: z.literal(QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_SHA256),
    requestShapeSha256: z.literal(QWEN3_VL_REQUEST_SHAPE_V2_SHA256),
    benchmarkCapsSha256: z.literal(QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256),
    contentPolicyDefinitionSha256: z.literal(
      BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
    ),
    workflowDefinitionSha256: z.literal(INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1.definitionSha256),
    orderedModelInputDigestsSha256: z.literal(
      QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_V2_SHA256,
    ),
    diagnosticCapture: z.strictObject({
      diagnosticVersion: z.literal(2),
      mode: z.literal('single-fixture-response-capture'),
      fixtureId: z.literal('banner-person-v1'),
      providerCallsMaximum: z.literal(1),
      retryCount: z.literal(0),
      perCallTimeoutMs: z.literal(QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2.perCallTimeoutMs),
      totalWallTimeMs: z.literal(QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2.totalWallTimeMs),
      totalCalculatedListCostMaximumMicroUsd: z.literal('50000'),
      diagnosticCapsSha256: z.literal(QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2_SHA256),
      responseArtifactRelativePath: QwenDiagnosticResponseRelativePathV1Schema,
      diagnosticReportRelativePath: QwenDiagnosticReportRelativePathV1Schema,
      productionAdmissionAuthority: z.literal(false),
      webRouteActivated: z.literal(false),
    }),
    executionAuthorized: z.literal(true),
  })
  .superRefine((authorization, context) => {
    if (
      authorization.issuedAtMs >= authorization.expiresAtMs ||
      authorization.endpoint !== QWEN3_VL_HISTORICAL_FRANKFURT_CHAT_COMPLETIONS_ENDPOINT
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Qwen historical diagnostic V3 timing or endpoint drifted.',
      });
    }
  })
  .readonly();

export const QwenManualReleaseBindingV1Schema = z
  .strictObject({
    releaseVersion: z.literal(1),
    releaseId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/u),
    issuedAtMs: z.int().min(0),
    expiresAtMs: z.int().min(1),
    providerIdentitySha256: z.literal(QWEN3_VL_PROVIDER_IDENTITY_V2_SHA256),
    productionAdmissionAuthority: z.literal(false),
    webRouteActivated: z.literal(false),
    releaseSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .superRefine((release, context) => {
    const releaseCore = {
      releaseVersion: release.releaseVersion,
      releaseId: release.releaseId,
      issuedAtMs: release.issuedAtMs,
      expiresAtMs: release.expiresAtMs,
      providerIdentitySha256: release.providerIdentitySha256,
      productionAdmissionAuthority: release.productionAdmissionAuthority,
      webRouteActivated: release.webRouteActivated,
    };
    if (
      release.issuedAtMs >= release.expiresAtMs ||
      release.expiresAtMs - release.issuedAtMs > QWEN_ACTIVE_MANUAL_RELEASE_MAX_VALIDITY_MS
    ) {
      context.addIssue({ code: 'custom', message: 'Manual release timing is invalid.' });
    }
    if (sha256Hex(Buffer.from(canonicalizeJson(releaseCore), 'utf8')) !== release.releaseSha256) {
      context.addIssue({ code: 'custom', message: 'Manual release digest drifted.' });
    }
  })
  .readonly();
export type QwenManualReleaseBindingV1 = z.infer<typeof QwenManualReleaseBindingV1Schema>;

export const QWEN_ACTIVE_AUTHORIZATION_MAX_VALIDITY_MS = 600_000 as const;
export const QWEN_ACTIVE_MANUAL_RELEASE_MAX_VALIDITY_MS = 900_000 as const;
export const QWEN_ACTIVE_AUTHORIZATION_MAX_ISSUANCE_AGE_MS = 60_000 as const;

export const createQwenManualReleaseBindingV1 = (input: {
  readonly releaseId: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}): QwenManualReleaseBindingV1 => {
  const releaseCore = {
    releaseVersion: 1 as const,
    releaseId: z
      .string()
      .regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/u)
      .parse(input.releaseId),
    issuedAtMs: z.int().min(0).parse(input.issuedAtMs),
    expiresAtMs: z.int().min(1).parse(input.expiresAtMs),
    providerIdentitySha256: QWEN3_VL_PROVIDER_IDENTITY_V2_SHA256,
    productionAdmissionAuthority: false as const,
    webRouteActivated: false as const,
  };
  return QwenManualReleaseBindingV1Schema.parse({
    ...releaseCore,
    releaseSha256: sha256Hex(Buffer.from(canonicalizeJson(releaseCore), 'utf8')),
  });
};

const activeDiagnosticCatalogEntry = QWEN_FOUR_FIXTURE_CANONICAL_REQUEST_CATALOG_V1[0]!;
export const QWEN_ACTIVE_DIAGNOSTIC_FIXTURE_ID = 'banner-person-v1' as const;
export const QWEN_ACTIVE_DIAGNOSTIC_NORMALIZED_SOURCE_SHA256 =
  activeDiagnosticCatalogEntry.normalizedSource.sha256;
export const QWEN_ACTIVE_DIAGNOSTIC_ORACLE_SHA256 = activeDiagnosticCatalogEntry.oracleSha256;
export const QWEN_ACTIVE_DIAGNOSTIC_MODEL_INPUT_SHA256 =
  activeDiagnosticCatalogEntry.inputDigest.sha256;

const QwenActiveDiagnosticCaptureV3Schema = z
  .strictObject({
    diagnosticVersion: z.literal(3),
    mode: z.literal('single-fixture-response-capture'),
    fixtureId: z.literal(QWEN_ACTIVE_DIAGNOSTIC_FIXTURE_ID),
    providerCallsMaximum: z.literal(1),
    retryCount: z.literal(0),
    perCallTimeoutMs: z.literal(QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V3.perCallTimeoutMs),
    totalWallTimeMs: z.literal(QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V3.totalWallTimeMs),
    totalCalculatedListCostMaximumMicroUsd: z.literal('100000'),
    diagnosticCapsSha256: z.literal(QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V3_SHA256),
    responseArtifactRelativePath: QwenDiagnosticResponseRelativePathV1Schema,
    diagnosticReportRelativePath: QwenDiagnosticReportRelativePathV1Schema,
    productionAdmissionAuthority: z.literal(false),
    webRouteActivated: z.literal(false),
  })
  .readonly();

export const QwenBenchmarkAuthorizationPacketV4Schema = z
  .strictObject({
    authorizationVersion: z.literal(4),
    authorizationId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/u),
    gitSha: z.string().regex(/^[0-9a-f]{40}$/u),
    mode: z.enum(['deterministic-fake', 'live-provider']),
    purpose: z.enum([
      'one-capped-four-fixture-sequential-zero-retry-benchmark',
      'one-capped-single-fixture-diagnostic-response-capture',
    ]),
    issuedAtMs: z.int().min(0),
    expiresAtMs: z.int().min(1),
    serverWorkspaceId: z.literal(QWEN3_VL_SERVER_WORKSPACE_ID),
    endpoint: z.literal(QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT),
    endpointMethod: z.literal(QWEN3_VL_ENDPOINT_METHOD),
    apiFamily: z.literal(QWEN3_VL_API_FAMILY),
    providerKey: z.literal(QWEN3_VL_PROVIDER_KEY),
    requestedModelId: z.literal(QWEN3_VL_REQUESTED_MODEL_ID),
    providerIdentitySha256: z.literal(QWEN3_VL_PROVIDER_IDENTITY_V2_SHA256),
    secretReferenceName: z.literal(QWEN3_VL_SECRET_REFERENCE_NAME),
    pendingCorpusCoreSha256: z.literal(QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256),
    humanOracleCorpusSha256: z.literal(QWEN_FOUR_FIXTURE_HUMAN_ORACLE_CORPUS_SHA256),
    pricingEvidenceSha256: z.literal(QWEN3_VL_PRICING_EVIDENCE_V2_SHA256),
    pricingEvidenceVersion: z.literal(2),
    pricingEvidenceRetrievedAt: z.literal(QWEN3_VL_OFFICIAL_EVIDENCE_RETRIEVED_AT),
    pricingEvidenceRetrievedDate: z.literal(QWEN3_VL_OFFICIAL_EVIDENCE_RETRIEVED_DATE),
    providerProtocolWrapperSha256: z.literal(QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_SHA256),
    requestShapeSha256: z.literal(QWEN3_VL_REQUEST_SHAPE_V3_SHA256),
    benchmarkCapsSha256: z.literal(QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256),
    contentPolicyDefinitionSha256: z.literal(
      BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
    ),
    workflowDefinitionSha256: z.literal(INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1.definitionSha256),
    orderedModelInputDigestsSha256: z.literal(QWEN_FOUR_FIXTURE_ACTIVE_MODEL_INPUT_DIGESTS_SHA256),
    activeProviderAggregateSha256: z.literal(QWEN_FOUR_FIXTURE_ACTIVE_MODEL_INPUT_DIGESTS_SHA256),
    diagnosticFixtureId: z.literal(QWEN_ACTIVE_DIAGNOSTIC_FIXTURE_ID),
    diagnosticNormalizedSourceSha256: z.literal(QWEN_ACTIVE_DIAGNOSTIC_NORMALIZED_SOURCE_SHA256),
    diagnosticOracleSha256: z.literal(QWEN_ACTIVE_DIAGNOSTIC_ORACLE_SHA256),
    diagnosticModelInputSha256: z.literal(QWEN_ACTIVE_DIAGNOSTIC_MODEL_INPUT_SHA256),
    manualRelease: QwenManualReleaseBindingV1Schema,
    productionAdmissionAuthority: z.literal(false),
    webRouteActivated: z.literal(false),
    diagnosticCapture: QwenActiveDiagnosticCaptureV3Schema.optional(),
    executionAuthorized: z.literal(true),
  })
  .superRefine((authorization, context) => {
    const isFourFixturePurpose =
      authorization.purpose === 'one-capped-four-fixture-sequential-zero-retry-benchmark';
    const isDiagnosticPurpose =
      authorization.purpose === 'one-capped-single-fixture-diagnostic-response-capture';
    const modePurposeRelationIsValid =
      (authorization.mode === 'deterministic-fake' &&
        isFourFixturePurpose &&
        authorization.diagnosticCapture === undefined) ||
      (authorization.mode === 'live-provider' &&
        isDiagnosticPurpose &&
        authorization.diagnosticCapture !== undefined);
    if (
      authorization.issuedAtMs >= authorization.expiresAtMs ||
      authorization.expiresAtMs - authorization.issuedAtMs >
        QWEN_ACTIVE_AUTHORIZATION_MAX_VALIDITY_MS ||
      !modePurposeRelationIsValid
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Qwen active V4 timing or diagnostic binding drifted.',
      });
    }
  })
  .readonly();

export type QwenBenchmarkAuthorizationPacketV2 = z.infer<
  typeof QwenBenchmarkAuthorizationPacketV2Schema
>;
export type QwenBenchmarkAuthorizationPacketV3 = z.infer<
  typeof QwenBenchmarkAuthorizationPacketV3Schema
>;
export type QwenBenchmarkAuthorizationPacketV4 = z.infer<
  typeof QwenBenchmarkAuthorizationPacketV4Schema
>;

export interface QwenBenchmarkExecutionAuthorization {
  readonly authorizationVersion: 2 | 3 | 4;
  readonly authorizationId: string;
  readonly mode: 'deterministic-fake' | 'live-provider';
  readonly providerKey: typeof QWEN3_VL_PROVIDER_KEY;
  readonly requestedModelId: typeof QWEN3_VL_REQUESTED_MODEL_ID;
  readonly gitSha: string;
  readonly manualReleaseSha256: string;
  readonly endpoint: string;
  readonly diagnosticCapture:
    | z.infer<typeof QwenDiagnosticCaptureAuthorizationV1Schema>
    | z.infer<typeof QwenDiagnosticCaptureAuthorizationV2Schema>
    | z.infer<typeof QwenBenchmarkAuthorizationPacketV3Schema>['diagnosticCapture']
    | z.infer<typeof QwenBenchmarkAuthorizationPacketV4Schema>['diagnosticCapture']
    | null;
  readonly dispatchAuthority: true;
}

export const createQwenDiagnosticAuthorizationPacketV3 = (input: {
  readonly authorizationId: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly responseArtifactRelativePath: string;
  readonly diagnosticReportRelativePath: string;
}): QwenBenchmarkAuthorizationPacketV3 =>
  QwenBenchmarkAuthorizationPacketV3Schema.parse({
    authorizationVersion: 3,
    authorizationId: input.authorizationId,
    mode: 'live-provider',
    purpose: 'one-capped-single-fixture-diagnostic-response-capture',
    issuedAtMs: input.issuedAtMs,
    expiresAtMs: input.expiresAtMs,
    serverWorkspaceId: QWEN3_VL_HISTORICAL_FRANKFURT_WORKSPACE_ID,
    endpoint: QWEN3_VL_HISTORICAL_FRANKFURT_CHAT_COMPLETIONS_ENDPOINT,
    endpointMethod: QWEN3_VL_ENDPOINT_METHOD,
    apiFamily: QWEN3_VL_API_FAMILY,
    providerKey: QWEN3_VL_PROVIDER_KEY,
    requestedModelId: QWEN3_VL_REQUESTED_MODEL_ID,
    secretReferenceName: QWEN3_VL_SECRET_REFERENCE_NAME,
    pendingCorpusCoreSha256: QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256,
    humanOracleCorpusSha256: QWEN_FOUR_FIXTURE_HUMAN_ORACLE_CORPUS_SHA256,
    pricingEvidenceSha256: QWEN3_VL_HISTORICAL_PRICING_EVIDENCE_SHA256,
    pricingEvidenceRetrievedDate: QWEN3_VL_HISTORICAL_EVIDENCE_RETRIEVED_DATE,
    providerProtocolWrapperSha256: QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_SHA256,
    requestShapeSha256: QWEN3_VL_REQUEST_SHAPE_V2_SHA256,
    benchmarkCapsSha256: QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256,
    contentPolicyDefinitionSha256: BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
    workflowDefinitionSha256: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1.definitionSha256,
    orderedModelInputDigestsSha256: QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_V2_SHA256,
    diagnosticCapture: {
      diagnosticVersion: 2,
      mode: 'single-fixture-response-capture',
      fixtureId: 'banner-person-v1',
      providerCallsMaximum: 1,
      retryCount: 0,
      perCallTimeoutMs: QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2.perCallTimeoutMs,
      totalWallTimeMs: QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2.totalWallTimeMs,
      totalCalculatedListCostMaximumMicroUsd: '50000',
      diagnosticCapsSha256: QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V2_SHA256,
      responseArtifactRelativePath: input.responseArtifactRelativePath,
      diagnosticReportRelativePath: input.diagnosticReportRelativePath,
      productionAdmissionAuthority: false,
      webRouteActivated: false,
    },
    executionAuthorized: true,
  });

export const createQwenDiagnosticAuthorizationPacketV4 = (input: {
  readonly authorizationId: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly gitSha: string;
  readonly responseArtifactRelativePath: string;
  readonly diagnosticReportRelativePath: string;
  readonly manualRelease: unknown;
}): QwenBenchmarkAuthorizationPacketV4 => {
  const manualRelease = QwenManualReleaseBindingV1Schema.parse(input.manualRelease);
  return QwenBenchmarkAuthorizationPacketV4Schema.parse({
    authorizationVersion: 4,
    authorizationId: input.authorizationId,
    gitSha: z
      .string()
      .regex(/^[0-9a-f]{40}$/u)
      .parse(input.gitSha),
    mode: 'live-provider',
    purpose: 'one-capped-single-fixture-diagnostic-response-capture',
    issuedAtMs: input.issuedAtMs,
    expiresAtMs: input.expiresAtMs,
    serverWorkspaceId: QWEN3_VL_SERVER_WORKSPACE_ID,
    endpoint: QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT,
    endpointMethod: QWEN3_VL_ENDPOINT_METHOD,
    apiFamily: QWEN3_VL_API_FAMILY,
    providerKey: QWEN3_VL_PROVIDER_KEY,
    requestedModelId: QWEN3_VL_REQUESTED_MODEL_ID,
    providerIdentitySha256: QWEN3_VL_PROVIDER_IDENTITY_V2_SHA256,
    secretReferenceName: QWEN3_VL_SECRET_REFERENCE_NAME,
    pendingCorpusCoreSha256: QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256,
    humanOracleCorpusSha256: QWEN_FOUR_FIXTURE_HUMAN_ORACLE_CORPUS_SHA256,
    pricingEvidenceSha256: QWEN3_VL_PRICING_EVIDENCE_V2_SHA256,
    pricingEvidenceVersion: 2,
    pricingEvidenceRetrievedAt: QWEN3_VL_OFFICIAL_EVIDENCE_RETRIEVED_AT,
    pricingEvidenceRetrievedDate: QWEN3_VL_OFFICIAL_EVIDENCE_RETRIEVED_DATE,
    providerProtocolWrapperSha256: QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_SHA256,
    requestShapeSha256: QWEN3_VL_REQUEST_SHAPE_V3_SHA256,
    benchmarkCapsSha256: QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256,
    contentPolicyDefinitionSha256: BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
    workflowDefinitionSha256: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1.definitionSha256,
    orderedModelInputDigestsSha256: QWEN_FOUR_FIXTURE_ACTIVE_MODEL_INPUT_DIGESTS_SHA256,
    activeProviderAggregateSha256: QWEN_FOUR_FIXTURE_ACTIVE_MODEL_INPUT_DIGESTS_SHA256,
    diagnosticFixtureId: QWEN_ACTIVE_DIAGNOSTIC_FIXTURE_ID,
    diagnosticNormalizedSourceSha256: QWEN_ACTIVE_DIAGNOSTIC_NORMALIZED_SOURCE_SHA256,
    diagnosticOracleSha256: QWEN_ACTIVE_DIAGNOSTIC_ORACLE_SHA256,
    diagnosticModelInputSha256: QWEN_ACTIVE_DIAGNOSTIC_MODEL_INPUT_SHA256,
    manualRelease,
    productionAdmissionAuthority: false,
    webRouteActivated: false,
    diagnosticCapture: {
      diagnosticVersion: 3,
      mode: 'single-fixture-response-capture',
      fixtureId: QWEN_ACTIVE_DIAGNOSTIC_FIXTURE_ID,
      providerCallsMaximum: 1,
      retryCount: 0,
      perCallTimeoutMs: QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V3.perCallTimeoutMs,
      totalWallTimeMs: QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V3.totalWallTimeMs,
      totalCalculatedListCostMaximumMicroUsd: '100000',
      diagnosticCapsSha256: QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V3_SHA256,
      responseArtifactRelativePath: input.responseArtifactRelativePath,
      diagnosticReportRelativePath: input.diagnosticReportRelativePath,
      productionAdmissionAuthority: false,
      webRouteActivated: false,
    },
    executionAuthorized: true,
  });
};

interface PrivateAuthorizationState {
  readonly packet:
    | QwenBenchmarkAuthorizationPacketV2
    | QwenBenchmarkAuthorizationPacketV3
    | QwenBenchmarkAuthorizationPacketV4;
  readonly claimedInvocationKeys: Set<string>;
  readonly claimedFixtureIds: Set<string>;
  diagnosticReservations: QwenDiagnosticReservationSetV1 | null;
}

const validAuthorizations = new WeakSet<object>();
const privateAuthorizationState = new WeakMap<object, PrivateAuthorizationState>();

const mintValidatedQwenBenchmarkExecutionAuthorization = (
  input: unknown,
): QwenBenchmarkExecutionAuthorization => {
  const activePacket = QwenBenchmarkAuthorizationPacketV4Schema.safeParse(input);
  if (activePacket.success === false) {
    const historicalV3 = QwenBenchmarkAuthorizationPacketV3Schema.safeParse(input);
    const historicalPacket = historicalV3.success
      ? historicalV3.data
      : QwenBenchmarkAuthorizationPacketV2Schema.parse(input);
    if (historicalPacket.diagnosticCapture !== undefined) {
      throw new QwenSceneAnalysisError('authorization-missing');
    }
    throw new QwenSceneAnalysisError('authorization-missing');
  }
  const packet = activePacket.data;
  const authorization = Object.freeze({
    authorizationVersion: packet.authorizationVersion,
    authorizationId: packet.authorizationId,
    mode: packet.mode,
    providerKey: QWEN3_VL_PROVIDER_KEY,
    requestedModelId: QWEN3_VL_REQUESTED_MODEL_ID,
    gitSha: packet.gitSha,
    manualReleaseSha256: packet.manualRelease.releaseSha256,
    endpoint: packet.endpoint,
    diagnosticCapture: packet.diagnosticCapture ?? null,
    dispatchAuthority: true as const,
  });
  validAuthorizations.add(authorization);
  privateAuthorizationState.set(authorization, {
    packet,
    claimedInvocationKeys: new Set<string>(),
    claimedFixtureIds: new Set<string>(),
    diagnosticReservations: null,
  });
  return authorization;
};

export const mintQwenBenchmarkExecutionAuthorization = (
  input: unknown,
): QwenBenchmarkExecutionAuthorization => {
  const activePacket = QwenBenchmarkAuthorizationPacketV4Schema.safeParse(input);
  if (activePacket.success && activePacket.data.mode === 'live-provider') {
    throw new QwenSceneAnalysisError('authorization-missing');
  }
  return mintValidatedQwenBenchmarkExecutionAuthorization(input);
};

export const createQwenDryRunExecutionAuthorization = (input: {
  readonly nowMs: number;
  readonly serverWorkspaceId?: string;
  readonly currentGitSha: string;
}): QwenBenchmarkExecutionAuthorization => {
  const nowMs = z.int().min(0).parse(input.nowMs);
  const serverWorkspaceId = z
    .literal(QWEN3_VL_SERVER_WORKSPACE_ID)
    .parse(input.serverWorkspaceId ?? QWEN3_VL_SERVER_WORKSPACE_ID);
  return mintQwenBenchmarkExecutionAuthorization({
    authorizationVersion: 4,
    authorizationId: 'qwen.deterministic.fake.authorization.v4',
    gitSha: z
      .string()
      .regex(/^[0-9a-f]{40}$/u)
      .parse(input.currentGitSha),
    mode: 'deterministic-fake',
    purpose: 'one-capped-four-fixture-sequential-zero-retry-benchmark',
    issuedAtMs: nowMs,
    expiresAtMs: nowMs + QWEN_ACTIVE_AUTHORIZATION_MAX_VALIDITY_MS,
    serverWorkspaceId,
    endpoint: QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT,
    endpointMethod: QWEN3_VL_ENDPOINT_METHOD,
    apiFamily: QWEN3_VL_API_FAMILY,
    providerKey: QWEN3_VL_PROVIDER_KEY,
    requestedModelId: QWEN3_VL_REQUESTED_MODEL_ID,
    secretReferenceName: QWEN3_VL_SECRET_REFERENCE_NAME,
    pendingCorpusCoreSha256: QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256,
    humanOracleCorpusSha256: QWEN_FOUR_FIXTURE_HUMAN_ORACLE_CORPUS_SHA256,
    providerIdentitySha256: QWEN3_VL_PROVIDER_IDENTITY_V2_SHA256,
    pricingEvidenceSha256: QWEN3_VL_PRICING_EVIDENCE_V2_SHA256,
    pricingEvidenceVersion: 2,
    pricingEvidenceRetrievedAt: QWEN3_VL_OFFICIAL_EVIDENCE_RETRIEVED_AT,
    pricingEvidenceRetrievedDate: QWEN3_VL_OFFICIAL_EVIDENCE_RETRIEVED_DATE,
    providerProtocolWrapperSha256: QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_SHA256,
    requestShapeSha256: QWEN3_VL_REQUEST_SHAPE_V3_SHA256,
    benchmarkCapsSha256: QWEN_FOUR_FIXTURE_BENCHMARK_CAPS_SHA256,
    contentPolicyDefinitionSha256: BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
    workflowDefinitionSha256: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1.definitionSha256,
    orderedModelInputDigestsSha256: QWEN_FOUR_FIXTURE_ACTIVE_MODEL_INPUT_DIGESTS_SHA256,
    activeProviderAggregateSha256: QWEN_FOUR_FIXTURE_ACTIVE_MODEL_INPUT_DIGESTS_SHA256,
    diagnosticFixtureId: QWEN_ACTIVE_DIAGNOSTIC_FIXTURE_ID,
    diagnosticNormalizedSourceSha256: QWEN_ACTIVE_DIAGNOSTIC_NORMALIZED_SOURCE_SHA256,
    diagnosticOracleSha256: QWEN_ACTIVE_DIAGNOSTIC_ORACLE_SHA256,
    diagnosticModelInputSha256: QWEN_ACTIVE_DIAGNOSTIC_MODEL_INPUT_SHA256,
    manualRelease: createQwenManualReleaseBindingV1({
      releaseId: 'qwen.deterministic.fake.release.v4',
      issuedAtMs: nowMs,
      expiresAtMs: nowMs + 600_000,
    }),
    productionAdmissionAuthority: false,
    webRouteActivated: false,
    executionAuthorized: true,
  });
};

export const preflightQwenLiveExecutionAuthorization = (input: {
  readonly packet: unknown;
  readonly secretPresent: unknown;
  readonly nowMs: number;
  readonly currentGitSha?: string;
}): QwenBenchmarkExecutionAuthorization => {
  const nowMs = z.int().min(0).parse(input.nowMs);
  z.literal(true).parse(input.secretPresent);
  assertQwen3VlOfficialEvidenceFresh(nowMs);
  const activePacket = QwenBenchmarkAuthorizationPacketV4Schema.safeParse(input.packet);
  if (!activePacket.success) {
    throw new QwenSceneAnalysisError('authorization-missing');
  }
  const packet = activePacket.data;
  if (
    packet.gitSha === undefined ||
    input.currentGitSha === undefined ||
    !/^[0-9a-f]{40}$/u.test(input.currentGitSha) ||
    packet.gitSha !== input.currentGitSha
  ) {
    throw new QwenSceneAnalysisError('authorization-missing');
  }
  const release = QwenManualReleaseBindingV1Schema.parse(
    packet.manualRelease,
  ) as QwenManualReleaseBindingV1;
  if (
    nowMs < release.issuedAtMs ||
    nowMs >= release.expiresAtMs ||
    nowMs - release.issuedAtMs >= QWEN_ACTIVE_AUTHORIZATION_MAX_ISSUANCE_AGE_MS ||
    release.providerIdentitySha256 !== QWEN3_VL_PROVIDER_IDENTITY_V2_SHA256
  ) {
    throw new QwenSceneAnalysisError('authorization-stale');
  }
  if (
    packet.mode !== 'live-provider' ||
    nowMs < packet.issuedAtMs ||
    nowMs - packet.issuedAtMs >= QWEN_ACTIVE_AUTHORIZATION_MAX_ISSUANCE_AGE_MS ||
    nowMs >= packet.expiresAtMs
  ) {
    throw new QwenSceneAnalysisError('authorization-stale');
  }
  return mintValidatedQwenBenchmarkExecutionAuthorization(packet);
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
  if (state.packet.authorizationVersion === 4) {
    const release = QwenManualReleaseBindingV1Schema.parse(
      state.packet.manualRelease,
    ) as QwenManualReleaseBindingV1;
    if (
      nowMs < release.issuedAtMs ||
      nowMs >= release.expiresAtMs ||
      release.providerIdentitySha256 !== QWEN3_VL_PROVIDER_IDENTITY_V2_SHA256
    ) {
      throw new QwenSceneAnalysisError('authorization-stale');
    }
    if (
      state.packet.mode === 'live-provider' &&
      (nowMs < state.packet.issuedAtMs ||
        nowMs - state.packet.issuedAtMs >= QWEN_ACTIVE_AUTHORIZATION_MAX_ISSUANCE_AGE_MS ||
        nowMs - release.issuedAtMs >= QWEN_ACTIVE_AUTHORIZATION_MAX_ISSUANCE_AGE_MS)
    ) {
      throw new QwenSceneAnalysisError('authorization-stale');
    }
  }
  return state;
};

const requireOpaqueAuthorizationState = (input: unknown): PrivateAuthorizationState => {
  if (typeof input !== 'object' || input === null || !validAuthorizations.has(input)) {
    throw new QwenSceneAnalysisError('authorization-missing');
  }
  const state = privateAuthorizationState.get(input);
  if (state === undefined) throw new QwenSceneAnalysisError('authorization-missing');
  return state;
};

export const reserveQwenDiagnosticArtifactsForAuthorizationV1 = async (
  authorization: QwenBenchmarkExecutionAuthorization,
): Promise<void> => {
  const state = requireOpaqueAuthorizationState(authorization);
  const diagnostic = state.packet.diagnosticCapture;
  if (
    diagnostic === undefined ||
    state.diagnosticReservations !== null ||
    state.claimedFixtureIds.size !== 0
  ) {
    throw new QwenSceneAnalysisError('authorization-missing');
  }
  state.diagnosticReservations = await reserveQwenDiagnosticArtifactFilesV1({
    responseArtifactRelativePath: diagnostic.responseArtifactRelativePath,
    diagnosticReportRelativePath: diagnostic.diagnosticReportRelativePath,
  });
};

export const finalizeQwenDiagnosticReportForAuthorizationV1 = async (input: {
  readonly authorization: QwenBenchmarkExecutionAuthorization;
  readonly bytes: Uint8Array;
}): Promise<void> => {
  const state = requireOpaqueAuthorizationState(input.authorization);
  if (state.diagnosticReservations === null) {
    throw new QwenSceneAnalysisError('authorization-missing');
  }
  await finalizeReservedQwenDiagnosticReportV1({
    reservations: state.diagnosticReservations,
    bytes: input.bytes,
  });
};

export const releaseQwenDiagnosticArtifactsForAuthorizationV1 = async (
  authorization: QwenBenchmarkExecutionAuthorization,
): Promise<void> => {
  const state = requireOpaqueAuthorizationState(authorization);
  const reservations = state.diagnosticReservations;
  if (reservations === null) return;
  await abortQwenDiagnosticArtifactReservationsV1(reservations);
  state.diagnosticReservations = null;
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
  readonly diagnostic: QwenValidationDiagnosticV1 | null;
  readonly diagnosticArtifact: QwenDiagnosticArtifactMetadataV1 | null;

  constructor(
    reason: QwenSceneAnalysisFailureReason,
    accounting: QwenAttemptAccounting = NOT_DISPATCHED_ACCOUNTING,
    diagnostic: QwenValidationDiagnosticV1 | null = null,
    diagnosticArtifact: QwenDiagnosticArtifactMetadataV1 | null = null,
  ) {
    super(safeMessageByReason[reason]);
    this.name = 'QwenSceneAnalysisError';
    this.reason = reason;
    this.accounting = accounting;
    this.diagnostic = diagnostic;
    this.diagnosticArtifact = diagnosticArtifact;
  }
}

export interface QwenTransportRequest {
  readonly endpoint: string;
  readonly method: typeof QWEN3_VL_ENDPOINT_METHOD;
  readonly secret: string | null;
  readonly requestBodyText: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly mode: 'deterministic-fake' | 'live-provider';
  readonly dispatchCapability: QwenTransportDispatchCapability;
}

export interface QwenTransportDispatchCapability {
  readonly marker: 'qwen-single-use-dispatch-capability-v1';
}

interface QwenDispatchCapabilityBinding {
  readonly authorization: QwenBenchmarkExecutionAuthorization;
  readonly transportKind: QwenTransportPort['transportKind'];
  readonly mode: QwenTransportRequest['mode'];
  readonly endpoint: string;
  readonly method: typeof QWEN3_VL_ENDPOINT_METHOD;
  readonly requestBodyText: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
  readonly secretPresent: boolean;
}

const dispatchCapabilityBindings = new WeakMap<object, QwenDispatchCapabilityBinding>();
const consumedDispatchCapabilities = new WeakSet<object>();

const mintQwenTransportDispatchCapability = (binding: QwenDispatchCapabilityBinding) => {
  const capability = Object.freeze({
    marker: 'qwen-single-use-dispatch-capability-v1' as const,
  });
  dispatchCapabilityBindings.set(capability, binding);
  return capability;
};

export const consumeQwenTransportDispatchCapability = (
  request: QwenTransportRequest,
  expectedTransportKind: QwenTransportPort['transportKind'],
): void => {
  const capability = request.dispatchCapability;
  const binding = dispatchCapabilityBindings.get(capability);
  if (
    binding === undefined ||
    consumedDispatchCapabilities.has(capability) ||
    binding.transportKind !== expectedTransportKind ||
    binding.mode !== request.mode ||
    binding.endpoint !== request.endpoint ||
    binding.method !== request.method ||
    binding.requestBodyText !== request.requestBodyText ||
    binding.timeoutMs !== request.timeoutMs ||
    binding.signal !== request.signal ||
    binding.secretPresent !== (typeof request.secret === 'string' && request.secret.length > 0)
  ) {
    throw new QwenSceneAnalysisError('authorization-missing');
  }
  consumedDispatchCapabilities.add(capability);
};

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

export interface QwenAdapterTimerPort {
  setTimeout(handler: () => void, delayMs: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
  setInterval(handler: () => void, delayMs: number): ReturnType<typeof setInterval>;
  clearInterval(handle: ReturnType<typeof setInterval>): void;
}

const defaultClock: QwenAdapterClockPort = Object.freeze({
  nowEpochMs: () => Date.now(),
  nowMonotonicMs: () => performance.now(),
});

const defaultTimers: QwenAdapterTimerPort = Object.freeze({
  setTimeout: (handler: () => void, delayMs: number) => setTimeout(handler, delayMs),
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
  setInterval: (handler: () => void, delayMs: number) => setInterval(handler, delayMs),
  clearInterval: (handle: ReturnType<typeof setInterval>) => clearInterval(handle),
});

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

const validateTrustedNormalizedBytes = (
  request: Parameters<typeof validateQwenProviderResponseBoundaryV1>[0]['request'],
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
        content: QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2.content,
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

const cancellationError = (): QwenSceneAnalysisError => new QwenSceneAnalysisError('cancellation');

export const createQwen3VlSceneAnalysisAdapter = (input: {
  readonly transport: QwenTransportPort;
  readonly clock?: QwenAdapterClockPort;
  readonly timers?: QwenAdapterTimerPort;
}) => {
  const transport = input.transport;
  const clock = input.clock ?? defaultClock;
  const timers = input.timers ?? defaultTimers;
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
      const diagnosticCapture = authorizationState.packet.diagnosticCapture ?? null;
      const activeDiagnostic =
        (authorizationState.packet.authorizationVersion === 3 ||
          authorizationState.packet.authorizationVersion === 4) &&
        diagnosticCapture !== null;
      if (diagnosticCapture !== null && fixtureId !== diagnosticCapture.fixtureId) {
        throw new QwenSceneAnalysisError('authorization-missing');
      }
      if (
        diagnosticCapture !== null &&
        authorizationState.claimedFixtureIds.size >= diagnosticCapture.providerCallsMaximum
      ) {
        throw new QwenSceneAnalysisError('duplicate-invocation');
      }
      if (diagnosticCapture !== null && authorizationState.diagnosticReservations === null) {
        throw new QwenSceneAnalysisError('authorization-missing');
      }
      if (authorizationState.diagnosticReservations !== null) {
        try {
          await verifyQwenDiagnosticArtifactReservationsV1(
            authorizationState.diagnosticReservations,
          );
        } catch (error) {
          if (error instanceof QwenDiagnosticCaptureError) {
            throw new QwenSceneAnalysisError('authorization-missing');
          }
          throw error;
        }
      }
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
          (diagnosticCapture?.providerCallsMaximum ??
            QWEN_FOUR_FIXTURE_CANONICAL_REQUEST_CATALOG_V1.length)
      ) {
        throw new QwenSceneAnalysisError('duplicate-invocation');
      }
      authorizationState.claimedInvocationKeys.add(invocationKey);
      authorizationState.claimedFixtureIds.add(fixtureId);

      const requestBodyText = JSON.stringify(
        buildPrivateRequestBody(analyzeInput.normalizedImageBytes),
      );
      const dispatchNowMs = z.int().min(0).parse(clock.nowEpochMs());
      const timeoutMs = Math.min(
        activeDiagnostic ? QWEN_SINGLE_FIXTURE_DIAGNOSTIC_CAPS_V3.perCallTimeoutMs : 60_000,
        context.deadlineAtMs - dispatchNowMs,
      );
      if (timeoutMs <= 0) throw new QwenSceneAnalysisError('timeout');
      const controller = new AbortController();
      const startedAt = clock.nowMonotonicMs();
      let termination: 'cancellation' | 'timeout' | null = null;
      const timeout = timers.setTimeout(() => {
        termination = 'timeout';
        controller.abort();
      }, timeoutMs);
      const timeoutWithUnref = timeout as ReturnType<typeof setTimeout> & { unref?: () => void };
      timeoutWithUnref.unref?.();
      const cancellationPoll = timers.setInterval(() => {
        if (context.cancellation.cancelled) {
          termination = 'cancellation';
          controller.abort();
        }
      }, 25);
      const pollWithUnref = cancellationPoll as ReturnType<typeof setInterval> & {
        unref?: () => void;
      };
      pollWithUnref.unref?.();
      const elapsedLatencyMs = (): number =>
        Math.max(0, Math.ceil(clock.nowMonotonicMs() - startedAt));
      requireAuthorizationState(analyzeInput.authorization, dispatchNowMs);
      const dispatchCapability = mintQwenTransportDispatchCapability({
        authorization: analyzeInput.authorization!,
        transportKind: transport.transportKind,
        mode: authorizationState.packet.mode,
        endpoint: authorizationState.packet.endpoint,
        method: QWEN3_VL_ENDPOINT_METHOD,
        requestBodyText,
        timeoutMs,
        signal: controller.signal,
        secretPresent: typeof analyzeInput.secret === 'string' && analyzeInput.secret.length > 0,
      });
      let transportResponse: QwenTransportResponse;
      try {
        transportResponse = await transport.dispatch({
          endpoint: authorizationState.packet.endpoint,
          method: QWEN3_VL_ENDPOINT_METHOD,
          secret: analyzeInput.secret,
          requestBodyText,
          timeoutMs,
          signal: controller.signal,
          mode: authorizationState.packet.mode,
          dispatchCapability,
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
        timers.clearTimeout(timeout);
        timers.clearInterval(cancellationPoll);
      }
      const rawElapsedMs = clock.nowMonotonicMs() - startedAt;
      const latencyMs = Math.max(0, Math.ceil(rawElapsedMs));
      if (termination === 'timeout' || rawElapsedMs >= timeoutMs) {
        controller.abort();
        throw new QwenSceneAnalysisError('timeout', indeterminateAccounting(latencyMs));
      }
      if (context.cancellation.cancelled) {
        throw new QwenSceneAnalysisError('cancellation', indeterminateAccounting(latencyMs));
      }
      let boundaryResult: ReturnType<typeof validateQwenProviderResponseBoundaryV1> | null = null;
      let boundaryFailure: QwenResponseBoundaryFailure | null = null;
      try {
        boundaryResult = validateQwenProviderResponseBoundaryV1({
          response: transportResponse,
          request,
        });
      } catch (error) {
        if (error instanceof QwenResponseBoundaryFailure) {
          boundaryFailure = error;
        } else {
          throw error;
        }
      }
      let diagnosticArtifact: QwenDiagnosticArtifactMetadataV1 | null = null;
      if (diagnosticCapture !== null) {
        try {
          diagnosticArtifact = await captureSanitizedQwenResponseV1({
            reservations: authorizationState.diagnosticReservations!,
            capturedAtMs: z.int().min(0).parse(clock.nowEpochMs()),
            fixtureId: diagnosticCapture.fixtureId,
            response: transportResponse,
            failure: boundaryFailure,
          });
        } catch (error) {
          if (error instanceof QwenDiagnosticCaptureError) {
            const usage = boundaryFailure?.usage ?? boundaryResult?.envelope.usage ?? null;
            const accounting =
              usage === null
                ? indeterminateAccounting(latencyMs)
                : completeAccounting(latencyMs, usage);
            if (boundaryFailure !== null) {
              throw new QwenSceneAnalysisError(
                boundaryFailure.reason,
                accounting,
                boundaryFailure.diagnostic,
              );
            }
            throw new QwenSceneAnalysisError(
              'schema-invalid',
              accounting,
              createSyntheticQwenValidationDiagnosticV1({
                stage: 'request-relative-identity',
                path: ['diagnosticCapture'],
                validatorIssueCode: 'request-constraint',
                classification: 'identity-mismatch',
                expectedType: 'object',
                receivedType: 'object',
              }),
            );
          }
          throw error;
        }
      }
      if (boundaryFailure !== null) {
        const accounting =
          boundaryFailure.usage === null
            ? indeterminateAccounting(latencyMs)
            : completeAccounting(latencyMs, boundaryFailure.usage);
        throw new QwenSceneAnalysisError(
          boundaryFailure.reason,
          accounting,
          boundaryFailure.diagnostic,
          diagnosticArtifact,
        );
      }
      if (boundaryResult === null) throw new QwenSceneAnalysisError('schema-invalid');
      const envelope = boundaryResult.envelope;
      const proposal = boundaryResult.proposal;
      const accounting = completeAccounting(latencyMs, envelope.usage);
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
        diagnosticArtifact,
        proposal,
      });
    },
  });
};
