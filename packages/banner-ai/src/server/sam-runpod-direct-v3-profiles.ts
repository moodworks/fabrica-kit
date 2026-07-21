import { z } from 'zod';

import {
  SAM_LIMITS,
  SamLiveExecutionIdentitySchema,
  SamWorkerImageDigestSchema,
} from '../sam/sam-mask-contracts.js';
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
  profileVersion: 'sam-runpod-direct-hosting-v2',
  workerHostingVersion: 'sam-worker-fastapi-direct-v2',
  provider: 'runpod-serverless-load-balancer',
  protocolContractVersion: 'sam-mask-v2',
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
  requestEnvelope: 'bare-sam-mask-v2',
  responseEnvelope: 'bare-sam-mask-v2',
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
  workerImageIdentity: {
    platform: 'linux/amd64',
    objectType: 'oci-or-docker-v2-image-manifest',
    trustedConfiguration: 'SAM_WORKER_IMAGE_DIGEST',
    authorizationRequestField: 'workerImageDigest',
    responseField: 'executionIdentity.workerImageDigest',
    mismatchBehavior: 'fail-before-inference-or-result-acceptance',
    trustStrength: 'environment-bound-not-hardware-backed',
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
  '872054e82fc13e771fa65381e2db1f19dfb2dd609584574e8c532ed8eb82fa18' as const;

export const SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3 = Object.freeze({
  profileVersion: 'sam-runpod-direct-adapter-v3',
  hostingProfileSha256: SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
  endpoint: {
    idSyntax: 'dns-label-lowercase-v1',
    urlTemplate: 'https://{endpointId}.api.runpod.ai/v1/masks',
    method: RUNPOD_DIRECT_METHOD,
    redirects: 'error',
  },
  request: {
    contractVersion: 'sam-mask-v2',
    envelope: 'bare',
    mediaType: 'application/json',
    maximumBytes: SAM_LIMITS.requestJsonBytes,
    dispatchCount: 1,
  },
  response: {
    contractVersion: 'sam-mask-v2',
    envelope: 'bare',
    status: 200,
    mediaTypes: ['application/json'],
    maximumBytes: SAM_LIMITS.responseJsonBytes,
    validation: [
      'closed-schema',
      'request-identity',
      'worker-image-digest',
      'source-digest',
      'mask-digests',
      'response-digest',
      'model-identity',
    ],
  },
  workerImageIdentity: {
    configuredExpectation: 'server-owned-image-manifest-digest',
    authorizationBinding: 'exact-equality',
    workerRequestBinding: 'exact-equality-before-inference',
    strictResponseBinding: 'exact-equality-before-result-acceptance',
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

export const SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3_SHA256 =
  '1e6795c970fcfa9443b850f27149e237daf63ffa668cd5094189936453467e28' as const;

export const SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V3 = Object.freeze({
  profileVersion: 'sam-runpod-direct-authorization-v3',
  authorizationKind: 'single-fixture-sam-runpod-direct-v3',
  hostingProfileSha256: SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
  adapterProfileSha256: SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3_SHA256,
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

export const SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V3_SHA256 =
  '194272140ae7e717a69f122f6a3e7b1083c80a5f3022f12ffd73ca0016183492' as const;

const profileDigest = (profile: unknown): string =>
  sha256Hex(Buffer.from(canonicalizeJson(profile), 'utf8'));

if (
  profileDigest(SAM_RUNPOD_DIRECT_HOSTING_PROFILE) !== SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256 ||
  profileDigest(SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3) !==
    SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3_SHA256 ||
  profileDigest(SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V3) !==
    SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V3_SHA256
) {
  throw new TypeError('SAM RunPod direct profile digest drifted.');
}

export const SamRunPodDirectEndpointIdSchema = z
  .string()
  .regex(/^(?=.{1,63}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u);

export const deriveSamRunPodDirectV3Endpoint = (endpointIdInput: string): string =>
  `https://${SamRunPodDirectEndpointIdSchema.parse(endpointIdInput)}.api.runpod.ai/v1/masks`;

const DocumentationEvidenceSchema = z
  .strictObject({
    retrievedAt: z.literal(RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT),
    expiresAt: z.literal(RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT),
    hostingProfileSha256: z.literal(SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256),
  })
  .readonly();

export const SamRunPodDirectV3AuthorizationSchema = z
  .strictObject({
    kind: z.literal('single-fixture-sam-runpod-direct-v3'),
    authorizationId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u),
    endpointId: SamRunPodDirectEndpointIdSchema,
    imageDigest: SamWorkerImageDigestSchema,
    secretReferenceName: z.literal(RUNPOD_API_KEY_REFERENCE),
    executionIdentity: SamLiveExecutionIdentitySchema,
    hostingProfileSha256: z.literal(SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256),
    adapterProfileSha256: z.literal(SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3_SHA256),
    authorizationProfileSha256: z.literal(SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V3_SHA256),
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
  .superRefine((authorization, context) => {
    if (authorization.executionIdentity.workerImageDigest !== authorization.imageDigest) {
      context.addIssue({
        code: 'custom',
        message: 'Authorized worker image identities must agree.',
      });
    }
  })
  .readonly();

export type SamRunPodDirectV3Authorization = z.infer<typeof SamRunPodDirectV3AuthorizationSchema>;
