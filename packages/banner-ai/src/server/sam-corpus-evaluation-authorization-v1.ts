import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { SAM_MASK_ENCODING, SamLiveExecutionIdentitySchema } from '../sam/sam-mask-contracts.js';
import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import {
  SAM_CORPUS_CLIENT_TIMEOUT_MS,
  SAM_CORPUS_COST_MAXIMUM_MICRO_USD,
  SAM_CORPUS_ENDPOINT_ID,
  SAM_CORPUS_ENDPOINT_VERSION,
  SAM_CORPUS_EXECUTION_IDENTITY,
  SAM_CORPUS_LOCAL_IDENTITY_EVIDENCE_SHA256,
  SAM_CORPUS_PROFILE_IDENTITIES,
  SAM_CORPUS_REQUEST_LIMITS,
  SAM_CORPUS_WORKER_IMAGE_DIGEST,
  inspectSamCorpusPreparedRequestV1,
  type SamCorpusFixtureKeyV1,
  type SamCorpusPreparedRequestV1,
} from './sam-corpus-evaluation-catalog-v1.js';

export const SAM_CORPUS_AUTHORIZATION_LIFETIME_MS = SAM_CORPUS_CLIENT_TIMEOUT_MS;

const AuthorizationSchema = z
  .strictObject({
    kind: z.literal('single-fixture-sam-corpus-evaluation-v1'),
    authorizationId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u),
    fixtureKey: z.enum(['product', 'text-heavy', 'no-text']),
    fixtureId: z.enum(['banner-product-v1', 'banner-text-heavy-v1', 'banner-no-text-v1']),
    endpointId: z.literal(SAM_CORPUS_ENDPOINT_ID),
    endpointVersion: z.literal(SAM_CORPUS_ENDPOINT_VERSION),
    workerImageDigest: z.literal(SAM_CORPUS_WORKER_IMAGE_DIGEST),
    executionIdentity: SamLiveExecutionIdentitySchema,
    localIdentityEvidenceSha256: z.literal(SAM_CORPUS_LOCAL_IDENTITY_EVIDENCE_SHA256),
    profiles: z
      .strictObject({
        hostingSha256: z.literal(SAM_CORPUS_PROFILE_IDENTITIES.hostingSha256),
        adapterV3Sha256: z.literal(SAM_CORPUS_PROFILE_IDENTITIES.adapterV3Sha256),
        authorizationV3Sha256: z.literal(SAM_CORPUS_PROFILE_IDENTITIES.authorizationV3Sha256),
      })
      .readonly(),
    sourceSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    requestLimits: z
      .strictObject({
        minMaskAreaPixels: z.literal(SAM_CORPUS_REQUEST_LIMITS.minMaskAreaPixels),
        maxCandidates: z.literal(SAM_CORPUS_REQUEST_LIMITS.maxCandidates),
      })
      .readonly(),
    output: z.strictObject({ maskEncoding: z.literal(SAM_MASK_ENCODING) }).readonly(),
    canonicalRequestByteLength: z.int().min(1),
    canonicalRequestSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    issuedAtMs: z.int().min(0),
    expiresAtMs: z.int().min(1),
    clientWallTimeoutMs: z.literal(SAM_CORPUS_CLIENT_TIMEOUT_MS),
    costMaximumMicroUsd: z.literal(SAM_CORPUS_COST_MAXIMUM_MICRO_USD),
    dispatchMaximum: z.literal(1),
    materializationMaximum: z.literal(1),
    retryCount: z.literal(0),
    pollCount: z.literal(0),
    healthRequestCount: z.literal(0),
    pingRequestCount: z.literal(0),
    queueRequestCount: z.literal(0),
    providerBillingGuarantee: z.literal(false),
    providerCallAuthority: z.literal(false),
    productionExecutionAuthority: z.literal(false),
    productionAdmissionAuthority: z.literal(false),
    webRouteAuthority: z.literal(false),
    generalAdmissionAuthority: z.literal(false),
    corpusBatchAuthority: z.literal(false),
    deterministicProviderFreeEvaluationAuthority: z.literal(true),
  })
  .readonly();

export type SamCorpusEvaluationAuthorizationV1 = z.infer<typeof AuthorizationSchema>;

interface AuthorizationStateV1 {
  readonly prepared: SamCorpusPreparedRequestV1;
  readonly fixtureKey: SamCorpusFixtureKeyV1;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
}

interface AuthorizationSourcesStateV1 {
  readonly nowMs: () => number;
  readonly authorizationId: () => string;
}

export interface SamCorpusTestOnlyAuthorizationSourcesV1 {
  readonly purpose: 'test-only-sam-corpus-authorization-sources-v1';
}

export interface SamCorpusAuthorizedDispatchV1 {
  readonly purpose: 'single-sam-corpus-authorized-dispatch-v1';
  readonly fixtureKey: SamCorpusFixtureKeyV1;
}

const authorizationStates = new WeakMap<object, AuthorizationStateV1>();
const sourcesStates = new WeakMap<object, AuthorizationSourcesStateV1>();
const authorizedDispatchStates = new WeakMap<
  object,
  {
    readonly prepared: SamCorpusPreparedRequestV1;
    readonly authorization: SamCorpusEvaluationAuthorizationV1;
  }
>();
const authorizedPreparedRequests = new WeakSet<object>();
const consumedAuthorizations = new WeakSet<object>();
const consumedAuthorizedDispatches = new WeakSet<object>();
const issuedAuthorizationIds = new Set<string>();

const assertNow = (value: number): number => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError('SAM corpus authorization clock is invalid.');
  }
  return value;
};

const assertAuthorizationId = (value: string): string => {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value) ||
    value === '00000000-0000-0000-0000-000000000000'
  ) {
    throw new TypeError('SAM corpus authorization identifier is malformed or unresolved.');
  }
  return value;
};

const mint = (
  prepared: SamCorpusPreparedRequestV1,
  sources: AuthorizationSourcesStateV1,
): SamCorpusEvaluationAuthorizationV1 => {
  const state = inspectSamCorpusPreparedRequestV1(prepared);
  if (authorizedPreparedRequests.has(prepared)) {
    throw new TypeError('SAM corpus prepared request already received its one authorization.');
  }
  const issuedAtMs = assertNow(sources.nowMs());
  const expiresAtMs = issuedAtMs + SAM_CORPUS_AUTHORIZATION_LIFETIME_MS;
  if (!Number.isSafeInteger(expiresAtMs)) {
    throw new TypeError('SAM corpus authorization expiry is unsafe.');
  }
  const entry = state.catalogEntry;
  const authorizationId = assertAuthorizationId(sources.authorizationId());
  if (issuedAuthorizationIds.has(authorizationId)) {
    throw new TypeError('SAM corpus authorization identifier was already issued.');
  }
  const authorization = AuthorizationSchema.parse({
    kind: 'single-fixture-sam-corpus-evaluation-v1',
    authorizationId,
    fixtureKey: entry.fixtureKey,
    fixtureId: entry.fixtureId,
    endpointId: SAM_CORPUS_ENDPOINT_ID,
    endpointVersion: SAM_CORPUS_ENDPOINT_VERSION,
    workerImageDigest: SAM_CORPUS_WORKER_IMAGE_DIGEST,
    executionIdentity: SAM_CORPUS_EXECUTION_IDENTITY,
    localIdentityEvidenceSha256: SAM_CORPUS_LOCAL_IDENTITY_EVIDENCE_SHA256,
    profiles: SAM_CORPUS_PROFILE_IDENTITIES,
    sourceSha256: entry.normalized.sha256,
    requestLimits: SAM_CORPUS_REQUEST_LIMITS,
    output: { maskEncoding: SAM_MASK_ENCODING },
    canonicalRequestByteLength: entry.canonicalRequest.byteLength,
    canonicalRequestSha256: entry.canonicalRequest.sha256,
    issuedAtMs,
    expiresAtMs,
    clientWallTimeoutMs: SAM_CORPUS_CLIENT_TIMEOUT_MS,
    costMaximumMicroUsd: SAM_CORPUS_COST_MAXIMUM_MICRO_USD,
    dispatchMaximum: 1,
    materializationMaximum: 1,
    retryCount: 0,
    pollCount: 0,
    healthRequestCount: 0,
    pingRequestCount: 0,
    queueRequestCount: 0,
    providerBillingGuarantee: false,
    providerCallAuthority: false,
    productionExecutionAuthority: false,
    productionAdmissionAuthority: false,
    webRouteAuthority: false,
    generalAdmissionAuthority: false,
    corpusBatchAuthority: false,
    deterministicProviderFreeEvaluationAuthority: true,
  });
  issuedAuthorizationIds.add(authorizationId);
  authorizationStates.set(
    authorization,
    Object.freeze({
      prepared,
      fixtureKey: entry.fixtureKey,
      issuedAtMs,
      expiresAtMs,
    }),
  );
  authorizedPreparedRequests.add(prepared);
  return authorization;
};

/** Mints only provider-free evaluation authority; it can never authorize a provider transport. */
export const mintSamCorpusProviderFreeAuthorizationV1 = (
  prepared: SamCorpusPreparedRequestV1,
): SamCorpusEvaluationAuthorizationV1 =>
  mint(prepared, { nowMs: Date.now, authorizationId: randomUUID });

export const createTestOnlySamCorpusAuthorizationSourcesV1 = (input: {
  readonly nowMs: () => number;
  readonly authorizationId: () => string;
}): SamCorpusTestOnlyAuthorizationSourcesV1 => {
  if (typeof input.nowMs !== 'function' || typeof input.authorizationId !== 'function') {
    throw new TypeError('SAM corpus test authorization sources are malformed.');
  }
  const sources = Object.freeze({
    purpose: 'test-only-sam-corpus-authorization-sources-v1' as const,
  });
  sourcesStates.set(sources, Object.freeze({ ...input }));
  return sources;
};

export const mintTestOnlySamCorpusAuthorizationV1 = (
  prepared: SamCorpusPreparedRequestV1,
  sources: SamCorpusTestOnlyAuthorizationSourcesV1,
): SamCorpusEvaluationAuthorizationV1 => {
  const privateSources = sourcesStates.get(sources);
  if (privateSources === undefined) {
    throw new TypeError('SAM corpus test authorization sources are foreign or reconstructed.');
  }
  return mint(prepared, privateSources);
};

const validateAt = (input: {
  readonly prepared: SamCorpusPreparedRequestV1;
  readonly authorization: unknown;
  readonly currentTimeMs: number;
}): SamCorpusEvaluationAuthorizationV1 => {
  const preparedState = inspectSamCorpusPreparedRequestV1(input.prepared);
  if (typeof input.authorization !== 'object' || input.authorization === null) {
    throw new TypeError('SAM corpus authorization is absent or malformed.');
  }
  const state = authorizationStates.get(input.authorization);
  if (state === undefined || state.prepared !== input.prepared) {
    throw new TypeError(
      'SAM corpus authorization is foreign, reconstructed, or fixture-mismatched.',
    );
  }
  const authorization = AuthorizationSchema.parse(input.authorization);
  const currentTimeMs = assertNow(input.currentTimeMs);
  const entry = preparedState.catalogEntry;
  if (
    state.fixtureKey !== entry.fixtureKey ||
    authorization.fixtureKey !== entry.fixtureKey ||
    authorization.fixtureId !== entry.fixtureId ||
    authorization.sourceSha256 !== entry.normalized.sha256 ||
    authorization.canonicalRequestByteLength !== entry.canonicalRequest.byteLength ||
    authorization.canonicalRequestSha256 !== entry.canonicalRequest.sha256 ||
    authorization.issuedAtMs !== state.issuedAtMs ||
    authorization.expiresAtMs !== state.expiresAtMs ||
    authorization.issuedAtMs > currentTimeMs ||
    currentTimeMs >= authorization.expiresAtMs ||
    authorization.expiresAtMs - authorization.issuedAtMs !== SAM_CORPUS_AUTHORIZATION_LIFETIME_MS ||
    canonicalizeJson(authorization.executionIdentity) !==
      canonicalizeJson(SAM_CORPUS_EXECUTION_IDENTITY) ||
    authorization.localIdentityEvidenceSha256 !== SAM_CORPUS_LOCAL_IDENTITY_EVIDENCE_SHA256 ||
    canonicalizeJson(authorization.profiles) !== canonicalizeJson(SAM_CORPUS_PROFILE_IDENTITIES) ||
    canonicalizeJson(authorization.requestLimits) !== canonicalizeJson(SAM_CORPUS_REQUEST_LIMITS) ||
    canonicalizeJson(authorization.output) !==
      canonicalizeJson({ maskEncoding: SAM_MASK_ENCODING }) ||
    canonicalizeJson(preparedState.directPrepared.request.limits) !==
      canonicalizeJson(SAM_CORPUS_REQUEST_LIMITS)
  ) {
    throw new TypeError('SAM corpus authorization is stale, mutated, or identity-mismatched.');
  }
  return input.authorization as SamCorpusEvaluationAuthorizationV1;
};

export const validateTestOnlySamCorpusAuthorizationV1 = (input: {
  readonly prepared: SamCorpusPreparedRequestV1;
  readonly authorization: unknown;
  readonly sources: SamCorpusTestOnlyAuthorizationSourcesV1;
}): SamCorpusEvaluationAuthorizationV1 => {
  const sources = sourcesStates.get(input.sources);
  if (sources === undefined) {
    throw new TypeError('SAM corpus test authorization sources are foreign or reconstructed.');
  }
  return validateAt({
    prepared: input.prepared,
    authorization: input.authorization,
    currentTimeMs: sources.nowMs(),
  });
};

export const authorizeTestOnlySamCorpusDispatchV1 = (input: {
  readonly prepared: SamCorpusPreparedRequestV1;
  readonly authorization: unknown;
  readonly sources: SamCorpusTestOnlyAuthorizationSourcesV1;
}): SamCorpusAuthorizedDispatchV1 => {
  const authorization = validateTestOnlySamCorpusAuthorizationV1(input);
  if (consumedAuthorizations.has(authorization)) {
    throw new TypeError('SAM corpus authorization is already consumed.');
  }
  consumedAuthorizations.add(authorization);
  const preparedState = inspectSamCorpusPreparedRequestV1(input.prepared);
  const authorized = Object.freeze({
    purpose: 'single-sam-corpus-authorized-dispatch-v1' as const,
    fixtureKey: preparedState.catalogEntry.fixtureKey,
  });
  authorizedDispatchStates.set(
    authorized,
    Object.freeze({ prepared: input.prepared, authorization }),
  );
  return authorized;
};

export const consumeTestOnlySamCorpusAuthorizedDispatchV1 = (
  authorized: SamCorpusAuthorizedDispatchV1,
): {
  readonly prepared: SamCorpusPreparedRequestV1;
  readonly authorization: SamCorpusEvaluationAuthorizationV1;
} => {
  const state = authorizedDispatchStates.get(authorized);
  if (state === undefined || consumedAuthorizedDispatches.has(authorized)) {
    throw new TypeError('SAM corpus authorized dispatch is foreign or already consumed.');
  }
  consumedAuthorizedDispatches.add(authorized);
  return state;
};
