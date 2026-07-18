import { z } from 'zod';

import { SAM_LIMITS, SamLiveExecutionIdentitySchema } from '../sam/sam-mask-contracts.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';

export const RUNPOD_API_KEY_REFERENCE = 'RUNPOD_API_KEY' as const;
export const RUNPOD_DIRECT_METHOD = 'POST' as const;
export const RUNPOD_DIRECT_HEALTH_PATH = '/ping' as const;
export const RUNPOD_DIRECT_MASK_PATH = '/v1/masks' as const;
export const RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT = '2026-07-18T13:15:50Z' as const;
export const RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT = '2026-08-18T13:15:50Z' as const;
export const RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS = Date.parse(
  RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT,
);
export const RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT_MS = Date.parse(
  RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT,
);
export const RUNPOD_DIRECT_TIMEOUT_MAXIMUM_MS = 330_000;

export const SAM_RUNPOD_DIRECT_HOSTING_PROFILE = Object.freeze({
  profileVersion: 'sam-runpod-direct-hosting-v1',
  workerHostingVersion: 'sam-worker-fastapi-direct-v1',
  provider: 'runpod-serverless-load-balancer',
  protocolContractVersion: 'sam-mask-v1',
  routes: {
    health: { method: 'GET', path: RUNPOD_DIRECT_HEALTH_PATH },
    inference: { method: RUNPOD_DIRECT_METHOD, path: RUNPOD_DIRECT_MASK_PATH },
  },
  health: {
    cacheControl: 'no-store',
    retryAfter: 'forbidden',
    states: {
      'model-not-staged': {
        status: 503,
        body: 'strict-redacted-json',
        inferenceReady: false,
      },
      'model-staged-not-loaded': {
        status: 204,
        body: 'empty',
        inferenceReady: false,
      },
      'model-loaded-ready': {
        status: 200,
        body: 'strict-redacted-json',
        inferenceReady: true,
      },
      'startup-blocked': {
        status: 503,
        body: 'strict-redacted-json',
        inferenceReady: false,
      },
    },
  },
  requestEnvelope: 'bare-sam-mask-v1',
  responseEnvelope: 'bare-sam-mask-v1',
  endpointHostTemplate: 'https://{endpointId}.api.runpod.ai/v1/masks',
  endpointIdSyntax: 'dns-label-lowercase-v1',
  requestLifecycle: {
    dispatchCount: 1,
    clientRetryCount: 0,
    queueing: 'none',
    polling: 'none',
    requestBacklog: 'none',
    acceptedLaterResponse: false,
    backgroundRequestProcessing: false,
    inFlightDisconnect: 'engine-may-finish-permit-held-no-gpu-cancel-claim',
    postDispatchIndeterminate: [
      'client-cancellation',
      'connection-loss',
      'response-truncation',
      'timeout',
      'http-500',
      'http-502',
      'http-503',
      'http-504',
    ],
  },
  workerConcurrency: {
    maximumInference: 1,
    admission: 'nonblocking-no-backlog',
    admissionBeforeBodyBuffering: true,
    overloadStatus: 429,
    permitRelease: 'after-blocking-inference-finishes',
  },
  timeouts: {
    providerProcessingMaximumMs: RUNPOD_DIRECT_TIMEOUT_MAXIMUM_MS,
    clientSemantics: 'single-wall-timeout-indeterminate-after-dispatch',
  },
  documentationEvidence: {
    retrievedAt: RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT,
    expiresAt: RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT,
    sources: [
      'https://docs.runpod.io/serverless/load-balancing/overview',
      'https://docs.runpod.io/serverless/load-balancing/build-a-worker',
      'https://docs.runpod.io/serverless/endpoints/overview',
      'https://docs.runpod.io/serverless/workers/github-integration',
    ],
  },
} as const);

export const SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256 =
  '2e5d64b6741802f7963fa678d174fca92a367a32672764fae5831c3131702f3a' as const;

export const SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V2 = Object.freeze({
  profileVersion: 'sam-runpod-direct-adapter-v2',
  hostingProfileSha256: SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
  endpoint: {
    idSyntax: 'dns-label-lowercase-v1',
    urlTemplate: 'https://{endpointId}.api.runpod.ai/v1/masks',
    method: RUNPOD_DIRECT_METHOD,
    redirects: 'error',
  },
  request: {
    contractVersion: 'sam-mask-v1',
    envelope: 'bare',
    mediaType: 'application/json',
    maximumBytes: SAM_LIMITS.requestJsonBytes,
    dispatchCount: 1,
  },
  response: {
    contractVersion: 'sam-mask-v1',
    envelope: 'bare',
    status: 200,
    mediaTypes: ['application/json'],
    maximumBytes: SAM_LIMITS.responseJsonBytes,
    validation: [
      'closed-schema',
      'request-identity',
      'source-digest',
      'mask-digests',
      'response-digest',
      'model-identity',
    ],
  },
  clientExecution: {
    attemptClaim: 'process-local-single-dispatch',
    authorizationUse: 'single',
    retryCount: 0,
    pollCount: 0,
    cancelRoute: 'none',
  },
  outcomeSemantics: {
    preDispatchAbort: 'PRE_DISPATCH_CANCELLED',
    postDispatchIndeterminate: [
      'client-cancellation',
      'connection-loss',
      'response-truncation',
      'timeout',
      'http-500',
      'http-502',
      'http-503',
      'http-504',
    ],
    strict4xx: 'PROVIDER_FAILURE',
    invalid200: 'RESPONSE_INVALID',
  },
  secrets: {
    reference: RUNPOD_API_KEY_REFERENCE,
    placement: 'native-transport-construction-only',
    telemetry: 'redacted-allowlist-only',
  },
  documentationEvidence: {
    retrievedAt: RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT,
    expiresAt: RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT,
    hostingProfileSha256: SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
  },
} as const);

export const SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V2_SHA256 =
  'c114b8b0bc3030ef2d7df524c88bd1710c9e6bc264d186c6b9e8ee7845718747' as const;

export const SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V2 = Object.freeze({
  profileVersion: 'sam-runpod-direct-authorization-v2',
  authorizationKind: 'single-fixture-sam-runpod-direct-v2',
  hostingProfileSha256: SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
  adapterProfileSha256: SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V2_SHA256,
  bindings: [
    'authorization-id',
    'endpoint-id',
    'image-digest',
    'live-model-identity',
    'fixture-bytes-and-dimensions',
    'request-limits',
    'mask-encoding',
    'client-wall-timeout',
    'cost-cap',
    'documentation-evidence',
  ],
  activation: {
    automaticCandidatesOnly: true,
    clientDispatchMaximum: 1,
    applicationInferenceMaximum: 1,
    providerBillingGuarantee: false,
    clientRetryCount: 0,
    pollCount: 0,
    executionAuthorized: true,
    productionAdmissionAuthority: false,
    webRouteActivated: false,
  },
  singleUse: {
    authorizationId: 'process-local',
    objectIdentity: true,
  },
  evidence: {
    retrievedAt: RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT,
    expiresAt: RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT,
    nativeConstructionAndExecutionBeforeExpiry: true,
  },
  endpoint: {
    idSyntax: 'dns-label-lowercase-v1',
    derivedOnly: true,
  },
  secretReference: RUNPOD_API_KEY_REFERENCE,
} as const);

export const SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V2_SHA256 =
  'c1ab605534b23b8aa6be2433b333696eeed9f13e1f87be76a49e60a26bc7509e' as const;

const profileDigest = (profile: unknown): string =>
  sha256Hex(Buffer.from(canonicalizeJson(profile), 'utf8'));

if (
  profileDigest(SAM_RUNPOD_DIRECT_HOSTING_PROFILE) !== SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256 ||
  profileDigest(SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V2) !==
    SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V2_SHA256 ||
  profileDigest(SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V2) !==
    SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V2_SHA256
) {
  throw new TypeError('SAM RunPod direct profile digest drifted.');
}

export const SamRunPodDirectEndpointIdSchema = z
  .string()
  .regex(/^(?=.{1,63}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u);

const ImageDigestSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/u)
  .refine((value) => value !== `sha256:${'0'.repeat(64)}`, 'Image digest must be resolved.');

const DocumentationEvidenceSchema = z
  .strictObject({
    retrievedAt: z.literal(RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT),
    expiresAt: z.literal(RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT),
    hostingProfileSha256: z.literal(SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256),
  })
  .readonly();

export const SamRunPodDirectV2AuthorizationSchema = z
  .strictObject({
    kind: z.literal('single-fixture-sam-runpod-direct-v2'),
    authorizationId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u),
    endpointId: SamRunPodDirectEndpointIdSchema,
    imageDigest: ImageDigestSchema,
    secretReferenceName: z.literal(RUNPOD_API_KEY_REFERENCE),
    executionIdentity: SamLiveExecutionIdentitySchema,
    hostingProfileSha256: z.literal(SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256),
    adapterProfileSha256: z.literal(SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V2_SHA256),
    authorizationProfileSha256: z.literal(SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V2_SHA256),
    documentationEvidence: DocumentationEvidenceSchema,
    fixture: z
      .strictObject({
        sha256: z.string().regex(/^[0-9a-f]{64}$/u),
        byteSize: z.int().min(1).max(SAM_LIMITS.sourcePngBytes),
        width: z.int().min(1).max(SAM_LIMITS.sidePixels),
        height: z.int().min(1).max(SAM_LIMITS.sidePixels),
      })
      .readonly(),
    requestLimits: z
      .strictObject({
        minMaskAreaPixels: z.int().min(1).max(SAM_LIMITS.imagePixels),
        maxCandidates: z.int().min(1).max(SAM_LIMITS.returnedCandidates),
      })
      .readonly(),
    output: z
      .strictObject({
        maskEncoding: z.literal('fabrica-binary-rle-v1'),
      })
      .readonly(),
    automaticCandidatesOnly: z.literal(true),
    clientDispatchMaximum: z.literal(1),
    applicationInferenceMaximum: z.literal(1),
    providerBillingGuarantee: z.literal(false),
    clientRetryCount: z.literal(0),
    pollCount: z.literal(0),
    clientWallTimeoutMs: z.int().min(1).max(RUNPOD_DIRECT_TIMEOUT_MAXIMUM_MS),
    costMaximumMicroUsd: z.int().min(1),
    issuedAtMs: z.int().min(0),
    expiresAtMs: z.int().min(1),
    executionAuthorized: z.literal(true),
    productionAdmissionAuthority: z.literal(false),
    webRouteActivated: z.literal(false),
  })
  .readonly();

export type SamRunPodDirectV2Authorization = z.infer<typeof SamRunPodDirectV2AuthorizationSchema>;
