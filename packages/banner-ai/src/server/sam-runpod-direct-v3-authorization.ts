import { randomUUID } from 'node:crypto';

import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import {
  RUNPOD_API_KEY_REFERENCE,
  RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT,
  RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT_MS,
  RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT,
  RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS,
  SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3_SHA256,
  SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V3_SHA256,
  SAM_RUNPOD_DIRECT_BOX_AUTHORIZATION_PROFILE_V3_SHA256,
  SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
  SamRunPodDirectV3AuthorizationSchema,
  SamRunPodDirectV3BoxAuthorizationSchema,
  type SamRunPodDirectV3Authorization,
  type SamRunPodDirectV3BoxAuthorization,
} from './sam-runpod-direct-v3-profiles.js';
import {
  SAM_FIRST_INFERENCE_CLIENT_TIMEOUT_MS,
  SAM_FIRST_INFERENCE_COST_MAXIMUM_MICRO_USD,
  SAM_FIRST_INFERENCE_EXECUTION_IDENTITY,
  SAM_FIRST_INFERENCE_FIXTURE,
  SAM_FIRST_INFERENCE_ENDPOINT_ID,
  SAM_FIRST_INFERENCE_REQUEST_LIMITS,
  SAM_FIRST_INFERENCE_BOX_REQUEST_LIMITS,
  SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
  assertSamFirstInferenceV3PreparedRequest,
  inspectSamRunPodDirectV3PreparedRequest,
  type SamRunPodDirectV3PreparedRequest,
} from './sam-runpod-direct-v3-request-preparation.js';

export const SAM_FIRST_INFERENCE_AUTHORIZATION_LIFETIME_MS = SAM_FIRST_INFERENCE_CLIENT_TIMEOUT_MS;

interface AuthorizationPrivateState {
  readonly prepared: SamRunPodDirectV3PreparedRequest;
  readonly canonicalBodySha256: string;
  readonly canonicalBodyByteLength: number;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}
interface BoxAuthorizationPrivateState extends AuthorizationPrivateState {
  readonly segmentationCanonical: string;
  readonly requestIdentityCanonical: string;
}

interface TestOnlyAuthorizationSourcesState {
  readonly nowMs: () => number;
  readonly authorizationId: () => string;
}

export interface SamRunPodDirectV3TestOnlyAuthorizationSources {
  readonly purpose: 'test-only-deterministic-sam-authorization-v3';
}

export interface SamRunPodDirectV3AuthorizedDispatch {
  readonly authorization: SamRunPodDirectV3Authorization;
  readonly prepared: SamRunPodDirectV3PreparedRequest;
}

const authorizationState = new WeakMap<object, AuthorizationPrivateState>();
const boxAuthorizationState = new WeakMap<object, BoxAuthorizationPrivateState>();
const testOnlySourcesState = new WeakMap<object, TestOnlyAuthorizationSourcesState>();
const authorizedDispatchState = new WeakMap<
  object,
  {
    readonly authorization: SamRunPodDirectV3Authorization;
    readonly prepared: SamRunPodDirectV3PreparedRequest;
  }
>();
const consumedAuthorizedDispatches = new WeakSet<object>();

const assertClockValue = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS) {
    throw new TypeError('SAM authorization clock is outside the reviewed evidence window.');
  }
  return value;
};

const assertAuthorizationId = (value: string): string => {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value) ||
    value === '00000000-0000-0000-0000-000000000000'
  ) {
    throw new TypeError('SAM authorization identifier is malformed or unresolved.');
  }
  return value;
};

const mint = (
  prepared: SamRunPodDirectV3PreparedRequest,
  sources: TestOnlyAuthorizationSourcesState,
): SamRunPodDirectV3Authorization => {
  const preparedState = assertSamFirstInferenceV3PreparedRequest(prepared);
  const issuedAtMs = assertClockValue(sources.nowMs());
  const expiresAtMs = issuedAtMs + SAM_FIRST_INFERENCE_AUTHORIZATION_LIFETIME_MS;
  if (
    !Number.isSafeInteger(expiresAtMs) ||
    expiresAtMs > RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT_MS
  ) {
    throw new TypeError('SAM authorization cannot fit inside the reviewed evidence window.');
  }
  const authorization = SamRunPodDirectV3AuthorizationSchema.parse({
    kind: 'single-fixture-sam-runpod-direct-v3',
    authorizationId: assertAuthorizationId(sources.authorizationId()),
    endpointId: preparedState.endpointId,
    imageDigest: SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
    secretReferenceName: RUNPOD_API_KEY_REFERENCE,
    executionIdentity: SAM_FIRST_INFERENCE_EXECUTION_IDENTITY,
    hostingProfileSha256: SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
    adapterProfileSha256: SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3_SHA256,
    authorizationProfileSha256: SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V3_SHA256,
    documentationEvidence: {
      retrievedAt: RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT,
      expiresAt: RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT,
      hostingProfileSha256: SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
    },
    fixture: {
      sha256: preparedState.request.source.sha256,
      byteSize: preparedState.request.source.byteSize,
      width: preparedState.request.source.width,
      height: preparedState.request.source.height,
    },
    requestLimits: preparedState.request.limits,
    output: preparedState.request.output,
    automaticCandidatesOnly: true,
    clientDispatchMaximum: 1,
    applicationInferenceMaximum: 1,
    providerBillingGuarantee: false,
    clientRetryCount: 0,
    pollCount: 0,
    clientWallTimeoutMs: SAM_FIRST_INFERENCE_CLIENT_TIMEOUT_MS,
    costMaximumMicroUsd: SAM_FIRST_INFERENCE_COST_MAXIMUM_MICRO_USD,
    issuedAtMs,
    expiresAtMs,
    executionAuthorized: true,
    productionAdmissionAuthority: false,
    webRouteActivated: false,
  });
  authorizationState.set(
    authorization,
    Object.freeze({
      prepared,
      canonicalBodySha256: preparedState.canonicalBodySha256,
      canonicalBodyByteLength: preparedState.canonicalBodyByteLength,
      issuedAtMs,
      expiresAtMs,
    }),
  );
  return authorization;
};

/** Production minting uses only the trusted process clock and UUID source. */
export const mintSamFirstInferenceV3Authorization = (
  prepared: SamRunPodDirectV3PreparedRequest,
): SamRunPodDirectV3Authorization =>
  mint(prepared, { nowMs: Date.now, authorizationId: randomUUID });

/** Test-only deterministic injection; this object carries no identity or dispatch authority. */
export const createTestOnlySamRunPodDirectV3AuthorizationSources = (input: {
  readonly nowMs: () => number;
  readonly authorizationId: () => string;
}): SamRunPodDirectV3TestOnlyAuthorizationSources => {
  const sources = Object.freeze({
    purpose: 'test-only-deterministic-sam-authorization-v3' as const,
  });
  testOnlySourcesState.set(sources, Object.freeze({ ...input }));
  return sources;
};

/** Never used by the real execution branch. */
export const mintTestOnlySamFirstInferenceV3Authorization = (
  prepared: SamRunPodDirectV3PreparedRequest,
  sources: SamRunPodDirectV3TestOnlyAuthorizationSources,
): SamRunPodDirectV3Authorization => {
  const privateSources = testOnlySourcesState.get(sources);
  if (privateSources === undefined) {
    throw new TypeError('SAM test authorization sources are foreign or reconstructed.');
  }
  return mint(prepared, privateSources);
};

/** Test-only box authority minted only from a private-state-backed prepared request. */
export const mintTestOnlySamRunPodDirectV3BoxAuthorization = (
  prepared: SamRunPodDirectV3PreparedRequest,
  sources: SamRunPodDirectV3TestOnlyAuthorizationSources,
): SamRunPodDirectV3BoxAuthorization => {
  const preparedState = inspectSamRunPodDirectV3PreparedRequest(prepared);
  if (preparedState.request.segmentation.mode !== 'box-prompt') {
    throw new TypeError('SAM box authority requires an exact box-prompt prepared request.');
  }
  if (
    preparedState.endpointId !== SAM_FIRST_INFERENCE_ENDPOINT_ID ||
    preparedState.workerImageDigest !== SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST ||
    preparedState.request.source.sha256 !== SAM_FIRST_INFERENCE_FIXTURE.sha256 ||
    preparedState.request.source.byteSize !== SAM_FIRST_INFERENCE_FIXTURE.byteSize ||
    preparedState.request.source.width !== SAM_FIRST_INFERENCE_FIXTURE.width ||
    preparedState.request.source.height !== SAM_FIRST_INFERENCE_FIXTURE.height ||
    canonicalizeJson(preparedState.request.limits) !==
      canonicalizeJson(SAM_FIRST_INFERENCE_BOX_REQUEST_LIMITS) ||
    preparedState.request.output.maskEncoding !== 'fabrica-binary-rle-v1' ||
    canonicalizeJson(preparedState.expectedExecutionIdentity) !==
      canonicalizeJson(SAM_FIRST_INFERENCE_EXECUTION_IDENTITY)
  )
    throw new TypeError('SAM box prepared request is outside the strict milestone identity.');
  const privateSources = testOnlySourcesState.get(sources);
  if (privateSources === undefined) {
    throw new TypeError('SAM test authorization sources are foreign or reconstructed.');
  }
  const issuedAtMs = assertClockValue(privateSources.nowMs());
  const expiresAtMs = issuedAtMs + SAM_FIRST_INFERENCE_AUTHORIZATION_LIFETIME_MS;
  if (
    !Number.isSafeInteger(expiresAtMs) ||
    expiresAtMs > RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT_MS
  ) {
    throw new TypeError('SAM box authorization cannot fit inside the reviewed evidence window.');
  }
  const authorization = SamRunPodDirectV3BoxAuthorizationSchema.parse({
    kind: 'single-box-prompt-sam-runpod-direct-v3',
    authorizationId: assertAuthorizationId(privateSources.authorizationId()),
    endpointId: preparedState.endpointId,
    imageDigest: SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
    secretReferenceName: RUNPOD_API_KEY_REFERENCE,
    executionIdentity: SAM_FIRST_INFERENCE_EXECUTION_IDENTITY,
    hostingProfileSha256: SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
    adapterProfileSha256: SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3_SHA256,
    authorizationProfileSha256: SAM_RUNPOD_DIRECT_BOX_AUTHORIZATION_PROFILE_V3_SHA256,
    documentationEvidence: {
      retrievedAt: RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT,
      expiresAt: RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT,
      hostingProfileSha256: SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
    },
    fixture: {
      sha256: preparedState.request.source.sha256,
      byteSize: preparedState.request.source.byteSize,
      width: preparedState.request.source.width,
      height: preparedState.request.source.height,
    },
    requestLimits: preparedState.request.limits,
    output: preparedState.request.output,
    automaticCandidatesOnly: false,
    clientDispatchMaximum: 1,
    applicationInferenceMaximum: 1,
    providerBillingGuarantee: false,
    clientRetryCount: 0,
    pollCount: 0,
    clientWallTimeoutMs: SAM_FIRST_INFERENCE_CLIENT_TIMEOUT_MS,
    costMaximumMicroUsd: SAM_FIRST_INFERENCE_COST_MAXIMUM_MICRO_USD,
    issuedAtMs,
    expiresAtMs,
    executionAuthorized: true,
    productionAdmissionAuthority: false,
    webRouteActivated: false,
  });
  boxAuthorizationState.set(
    authorization,
    Object.freeze({
      prepared,
      canonicalBodySha256: preparedState.canonicalBodySha256,
      canonicalBodyByteLength: preparedState.canonicalBodyByteLength,
      issuedAtMs,
      expiresAtMs,
      segmentationCanonical: canonicalizeJson(preparedState.request.segmentation),
      requestIdentityCanonical: canonicalizeJson({
        requestId: preparedState.request.requestId,
        workspaceId: preparedState.request.workspaceId,
        jobId: preparedState.request.jobId,
        attemptId: preparedState.request.attemptId,
      }),
    }),
  );
  return authorization;
};

export const validateSamRunPodDirectV3BoxAuthorization = (input: {
  readonly prepared: SamRunPodDirectV3PreparedRequest;
  readonly authorization: unknown;
  readonly currentTimeMs?: number;
}): SamRunPodDirectV3BoxAuthorization => {
  const preparedState = inspectSamRunPodDirectV3PreparedRequest(input.prepared);
  const authState =
    typeof input.authorization === 'object' && input.authorization !== null
      ? boxAuthorizationState.get(input.authorization)
      : undefined;
  if (
    authState === undefined ||
    authState.canonicalBodySha256 !== preparedState.canonicalBodySha256 ||
    authState.canonicalBodyByteLength !== preparedState.canonicalBodyByteLength ||
    preparedState.request.segmentation.mode !== 'box-prompt' ||
    authState.segmentationCanonical !== canonicalizeJson(preparedState.request.segmentation) ||
    authState.requestIdentityCanonical !==
      canonicalizeJson({
        requestId: preparedState.request.requestId,
        workspaceId: preparedState.request.workspaceId,
        jobId: preparedState.request.jobId,
        attemptId: preparedState.request.attemptId,
      })
  )
    throw new TypeError('SAM box authorization is foreign, reconstructed, or request-mismatched.');
  const authorization = SamRunPodDirectV3BoxAuthorizationSchema.parse(input.authorization);
  const now = assertClockValue(input.currentTimeMs ?? Date.now());
  if (
    authorization.issuedAtMs !== authState.issuedAtMs ||
    authorization.expiresAtMs !== authState.expiresAtMs ||
    now < authorization.issuedAtMs ||
    now >= authorization.expiresAtMs ||
    authorization.expiresAtMs > RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT_MS ||
    authorization.endpointId !== preparedState.endpointId ||
    authorization.imageDigest !== preparedState.workerImageDigest ||
    authorization.fixture.sha256 !== preparedState.request.source.sha256 ||
    authorization.fixture.byteSize !== preparedState.request.source.byteSize ||
    authorization.fixture.width !== preparedState.request.source.width ||
    authorization.fixture.height !== preparedState.request.source.height ||
    authorization.requestLimits.minMaskAreaPixels !==
      preparedState.request.limits.minMaskAreaPixels ||
    authorization.requestLimits.maxCandidates !== preparedState.request.limits.maxCandidates ||
    authorization.output.maskEncoding !== preparedState.request.output.maskEncoding
  )
    throw new TypeError('SAM box authorization is stale or identity-mismatched.');
  return authorization;
};

const validateAt = (input: {
  readonly prepared: SamRunPodDirectV3PreparedRequest;
  readonly authorization: unknown;
  readonly currentTimeMs: number;
}): SamRunPodDirectV3Authorization => {
  const preparedState = assertSamFirstInferenceV3PreparedRequest(input.prepared);
  if (typeof input.authorization !== 'object' || input.authorization === null) {
    throw new TypeError('SAM authorization is absent or malformed.');
  }
  const privateState = authorizationState.get(input.authorization);
  if (
    privateState === undefined ||
    privateState.prepared !== input.prepared ||
    privateState.canonicalBodySha256 !== preparedState.canonicalBodySha256 ||
    privateState.canonicalBodyByteLength !== preparedState.canonicalBodyByteLength
  ) {
    throw new TypeError('SAM authorization is foreign, reconstructed, or request-mismatched.');
  }
  const authorization = SamRunPodDirectV3AuthorizationSchema.parse(input.authorization);
  const currentTimeMs = assertClockValue(input.currentTimeMs);
  if (
    authorization.authorizationId === '00000000-0000-0000-0000-000000000000' ||
    authorization.issuedAtMs !== privateState.issuedAtMs ||
    authorization.expiresAtMs !== privateState.expiresAtMs ||
    authorization.expiresAtMs - authorization.issuedAtMs >
      SAM_FIRST_INFERENCE_AUTHORIZATION_LIFETIME_MS ||
    authorization.issuedAtMs > currentTimeMs ||
    currentTimeMs >= authorization.expiresAtMs ||
    authorization.endpointId !== preparedState.endpointId ||
    authorization.imageDigest !== preparedState.workerImageDigest ||
    authorization.fixture.sha256 !== SAM_FIRST_INFERENCE_FIXTURE.sha256 ||
    authorization.fixture.byteSize !== SAM_FIRST_INFERENCE_FIXTURE.byteSize ||
    authorization.fixture.width !== SAM_FIRST_INFERENCE_FIXTURE.width ||
    authorization.fixture.height !== SAM_FIRST_INFERENCE_FIXTURE.height ||
    canonicalizeJson(authorization.requestLimits) !==
      canonicalizeJson(SAM_FIRST_INFERENCE_REQUEST_LIMITS) ||
    canonicalizeJson(authorization.executionIdentity) !==
      canonicalizeJson(SAM_FIRST_INFERENCE_EXECUTION_IDENTITY) ||
    authorization.clientWallTimeoutMs !== SAM_FIRST_INFERENCE_CLIENT_TIMEOUT_MS ||
    authorization.costMaximumMicroUsd !== SAM_FIRST_INFERENCE_COST_MAXIMUM_MICRO_USD
  ) {
    throw new TypeError('SAM authorization is stale, future, overlong, or identity-mismatched.');
  }
  return input.authorization as SamRunPodDirectV3Authorization;
};

export const validateSamFirstInferenceV3Authorization = (input: {
  readonly prepared: SamRunPodDirectV3PreparedRequest;
  readonly authorization: unknown;
}): SamRunPodDirectV3Authorization => validateAt({ ...input, currentTimeMs: Date.now() });

/** Test-only time control for expiry and not-yet-valid proofs. */
export const validateTestOnlySamFirstInferenceV3Authorization = (input: {
  readonly prepared: SamRunPodDirectV3PreparedRequest;
  readonly authorization: unknown;
  readonly sources: SamRunPodDirectV3TestOnlyAuthorizationSources;
}): SamRunPodDirectV3Authorization => {
  const sources = testOnlySourcesState.get(input.sources);
  if (sources === undefined) {
    throw new TypeError('SAM test authorization sources are foreign or reconstructed.');
  }
  return validateAt({
    prepared: input.prepared,
    authorization: input.authorization,
    currentTimeMs: sources.nowMs(),
  });
};

export const authorizeSamFirstInferenceV3Dispatch = (input: {
  readonly prepared: SamRunPodDirectV3PreparedRequest;
  readonly authorization: unknown;
  readonly testOnlySources?: SamRunPodDirectV3TestOnlyAuthorizationSources;
}): SamRunPodDirectV3AuthorizedDispatch => {
  const authorization =
    input.testOnlySources === undefined
      ? validateSamFirstInferenceV3Authorization(input)
      : validateTestOnlySamFirstInferenceV3Authorization({
          ...input,
          sources: input.testOnlySources,
        });
  const authorized = Object.freeze({ authorization, prepared: input.prepared });
  authorizedDispatchState.set(authorized, {
    authorization,
    prepared: input.prepared,
  });
  return authorized;
};

export const consumeSamFirstInferenceV3AuthorizedDispatch = (
  authorized: SamRunPodDirectV3AuthorizedDispatch,
): {
  readonly authorization: SamRunPodDirectV3Authorization;
  readonly prepared: SamRunPodDirectV3PreparedRequest;
} => {
  const state = authorizedDispatchState.get(authorized);
  if (state === undefined || consumedAuthorizedDispatches.has(authorized)) {
    throw new TypeError('SAM authorized dispatch is foreign or already consumed.');
  }
  consumedAuthorizedDispatches.add(authorized);
  return state;
};
