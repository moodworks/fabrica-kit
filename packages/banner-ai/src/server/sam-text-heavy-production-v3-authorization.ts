import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import {
  SAM_CORPUS_CLIENT_TIMEOUT_MS,
  SAM_CORPUS_COST_MAXIMUM_MICRO_USD,
  SAM_CORPUS_EVALUATION_FIXTURES_V1,
  inspectSamCorpusPreparedRequestV1,
  type SamCorpusPreparedRequestV1,
} from './sam-corpus-evaluation-catalog-v1.js';
import {
  RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT_MS,
  RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS,
} from './sam-runpod-direct-v3-profiles.js';
import {
  SAM_TEXT_HEAVY_PRODUCTION_V3_FROZEN_CORPUS_REQUEST_IDENTITY,
  deriveSamTextHeavyProductionV3CanonicalCallEvidenceFromRepositoryExecution,
  inspectSamTextHeavyProductionV3DurableReservation,
  type SamTextHeavyProductionV3DurableReservation,
  type SamTextHeavyProductionV3RootKind,
} from './sam-text-heavy-production-v3-reservation.js';
import {
  SAM_TEXT_HEAVY_PRODUCTION_V3_CORPUS_PROVENANCE_SHA,
  SamTextHeavyProductionV3RepositoryExecutionEvidenceSchema,
  assertSamTextHeavyProductionV3RepositoryBindingProvenance,
  revalidateSamTextHeavyProductionV3RepositoryExecutionBinding,
  type SamTextHeavyProductionV3RepositoryExecutionEvidence,
  type SamTextHeavyProductionV3VerifiedRepositoryBinding,
} from './sam-text-heavy-production-v3-repository-binding.js';

export const SAM_TEXT_HEAVY_PRODUCTION_V3_AUTHORIZATION_LIFETIME_MS = 330_000 as const;

const textHeavy = SAM_CORPUS_EVALUATION_FIXTURES_V1['text-heavy'];

if (
  SAM_TEXT_HEAVY_PRODUCTION_V3_AUTHORIZATION_LIFETIME_MS !== SAM_CORPUS_CLIENT_TIMEOUT_MS ||
  SAM_CORPUS_COST_MAXIMUM_MICRO_USD !== 250_000 ||
  textHeavy.capacity.automaticOnePointPeakBytes !== 114_138_112 ||
  textHeavy.capacity.ceilingBytes !== 268_435_456 ||
  textHeavy.capacity.pointsPerBatch !== 3 ||
  !textHeavy.capacity.eligible
) {
  throw new TypeError('SAM text-heavy production constants drifted from the reviewed catalog.');
}

export { SAM_TEXT_HEAVY_PRODUCTION_V3_FROZEN_CORPUS_REQUEST_IDENTITY } from './sam-text-heavy-production-v3-reservation.js';

export type SamTextHeavyProductionV3AuthorizationIdentity = Readonly<
  typeof SAM_TEXT_HEAVY_PRODUCTION_V3_FROZEN_CORPUS_REQUEST_IDENTITY & {
    readonly repositoryExecution: SamTextHeavyProductionV3RepositoryExecutionEvidence;
  }
>;

const createAuthorizationIdentity = (
  repositoryExecution: SamTextHeavyProductionV3RepositoryExecutionEvidence,
): SamTextHeavyProductionV3AuthorizationIdentity =>
  Object.freeze({
    ...SAM_TEXT_HEAVY_PRODUCTION_V3_FROZEN_CORPUS_REQUEST_IDENTITY,
    repositoryExecution,
  });

const isExactAuthorizationIdentity = (
  input: unknown,
): input is SamTextHeavyProductionV3AuthorizationIdentity => {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return false;
  const candidate = input as Record<string, unknown>;
  const repositoryExecution = SamTextHeavyProductionV3RepositoryExecutionEvidenceSchema.safeParse(
    candidate.repositoryExecution,
  );
  if (!repositoryExecution.success) return false;
  const frozen = { ...candidate };
  delete frozen.repositoryExecution;
  return (
    canonicalizeJson(frozen) ===
      canonicalizeJson(SAM_TEXT_HEAVY_PRODUCTION_V3_FROZEN_CORPUS_REQUEST_IDENTITY) &&
    candidate.corpusProvenanceSha === SAM_TEXT_HEAVY_PRODUCTION_V3_CORPUS_PROVENANCE_SHA
  );
};

const OutputBindingSchema = z
  .strictObject({
    rootKind: z.enum(['production-private-tmp', 'test-only-temporary-root']),
    outputDirectory: z.string().min(1).max(1_024),
    canonicalCallClaimSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    claimRecordSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .readonly();

export const SamTextHeavyProductionV3AuthorizationSchema = z
  .strictObject({
    kind: z.literal('single-text-heavy-sam-production-v3'),
    authorizationId: z
      .string()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u),
    environment: z.enum(['production-native', 'provider-free-native-boundary-test']),
    providerCallAuthority: z.boolean(),
    identity: z.custom<SamTextHeavyProductionV3AuthorizationIdentity>(isExactAuthorizationIdentity),
    output: OutputBindingSchema,
    issuedAtMs: z.int().min(0),
    expiresAtMs: z.int().min(1),
    executionAuthorized: z.literal(true),
    singleUse: z.literal(true),
  })
  .superRefine((authorization, context) => {
    const production = authorization.environment === 'production-native';
    if (
      authorization.authorizationId === '00000000-0000-0000-0000-000000000000' ||
      authorization.providerCallAuthority !== production ||
      authorization.output.rootKind !==
        (production ? 'production-private-tmp' : 'test-only-temporary-root') ||
      authorization.expiresAtMs - authorization.issuedAtMs !==
        SAM_TEXT_HEAVY_PRODUCTION_V3_AUTHORIZATION_LIFETIME_MS ||
      authorization.output.canonicalCallClaimSha256 !==
        deriveSamTextHeavyProductionV3CanonicalCallEvidenceFromRepositoryExecution(
          authorization.identity.repositoryExecution,
        ).claimSha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'SAM text-heavy production authorization identity or environment drifted.',
      });
    }
  })
  .readonly();

export type SamTextHeavyProductionV3Authorization = z.infer<
  typeof SamTextHeavyProductionV3AuthorizationSchema
>;

export interface SamTextHeavyProductionV3TestAuthorizationSources {
  readonly purpose: 'test-only-sam-text-heavy-production-v3-authorization-sources';
}

export interface SamTextHeavyProductionV3AuthorizedExecution {
  readonly purpose: 'authorized-sam-text-heavy-production-v3-execution';
}

interface AuthorizationSourcesState {
  readonly nowMs: () => number;
  readonly authorizationId: () => string;
}

interface AuthorizationState {
  readonly prepared: SamCorpusPreparedRequestV1;
  readonly reservation: SamTextHeavyProductionV3DurableReservation;
  readonly rootKind: SamTextHeavyProductionV3RootKind;
  readonly outputDirectory: string;
  readonly issuedAtMs: number;
  readonly expiresAtMs: number;
  readonly environment: SamTextHeavyProductionV3Authorization['environment'];
  readonly identity: SamTextHeavyProductionV3AuthorizationIdentity;
  readonly repositoryBinding: SamTextHeavyProductionV3VerifiedRepositoryBinding;
}

interface AuthorizedExecutionState {
  readonly prepared: SamCorpusPreparedRequestV1;
  readonly authorization: SamTextHeavyProductionV3Authorization;
  readonly reservation: SamTextHeavyProductionV3DurableReservation;
  readonly outputDirectory: string;
  readonly environment: SamTextHeavyProductionV3Authorization['environment'];
  readonly repositoryBinding: SamTextHeavyProductionV3VerifiedRepositoryBinding;
  readonly repositoryExecutionEvidence: SamTextHeavyProductionV3RepositoryExecutionEvidence;
}

const testSources = new WeakMap<object, AuthorizationSourcesState>();
const authorizationStates = new WeakMap<object, AuthorizationState>();
const authorizedExecutionStates = new WeakMap<object, AuthorizedExecutionState>();
const mintAttemptedPrepared = new WeakSet<object>();
const mintAttemptedReservations = new WeakSet<object>();
const consumedAuthorizations = new WeakSet<object>();
const consumedExecutions = new WeakSet<object>();
const validationsInProgress = new WeakSet<object>();
const issuedAuthorizationIds = new Set<string>();

const assertClock = (value: number): number => {
  if (
    !Number.isSafeInteger(value) ||
    value < RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS ||
    value >= RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT_MS
  ) {
    throw new TypeError('SAM text-heavy authorization clock is outside reviewed evidence.');
  }
  return value;
};

const assertAuthorizationId = (value: string): string => {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(value) ||
    value === '00000000-0000-0000-0000-000000000000' ||
    issuedAuthorizationIds.has(value)
  ) {
    throw new TypeError('SAM text-heavy authorization identifier is malformed or already issued.');
  }
  return value;
};

const readAuthorizationSource = <T>(label: 'clock' | 'identifier', source: () => T): T => {
  try {
    return source();
  } catch {
    throw new TypeError(`SAM text-heavy authorization ${label} source failed closed.`);
  }
};

const assertPreparedTextHeavy = (prepared: SamCorpusPreparedRequestV1) => {
  const state = inspectSamCorpusPreparedRequestV1(prepared);
  if (
    state.catalogEntry.fixtureKey !== 'text-heavy' ||
    state.catalogEntry.fixtureId !== textHeavy.fixtureId ||
    prepared.canonicalBodyByteLength !== textHeavy.canonicalRequest.byteLength ||
    prepared.canonicalBodySha256 !== textHeavy.canonicalRequest.sha256
  ) {
    throw new TypeError('SAM text-heavy production preparation is foreign or identity-drifted.');
  }
  return state;
};

const mint = (
  prepared: SamCorpusPreparedRequestV1,
  reservation: SamTextHeavyProductionV3DurableReservation,
  sources: AuthorizationSourcesState,
  environment: SamTextHeavyProductionV3Authorization['environment'],
): SamTextHeavyProductionV3Authorization => {
  assertPreparedTextHeavy(prepared);
  const durable = inspectSamTextHeavyProductionV3DurableReservation(reservation);
  assertSamTextHeavyProductionV3RepositoryBindingProvenance(
    durable.repositoryBinding,
    environment === 'production-native' ? 'production-local-git' : 'test-only-injected',
  );
  const expectedRootKind =
    environment === 'production-native' ? 'production-private-tmp' : 'test-only-temporary-root';
  if (durable.rootKind !== expectedRootKind) {
    throw new TypeError('SAM text-heavy authorization environment and output root disagree.');
  }
  if (mintAttemptedPrepared.has(prepared) || mintAttemptedReservations.has(reservation)) {
    throw new TypeError(
      'SAM text-heavy preparation or reservation already attempted authorization.',
    );
  }
  // These marks precede injected clock/UUID callbacks and make callback reentry fail closed.
  mintAttemptedPrepared.add(prepared);
  mintAttemptedReservations.add(reservation);
  const repositoryExecution = revalidateSamTextHeavyProductionV3RepositoryExecutionBinding(
    durable.repositoryBinding,
  );
  if (
    canonicalizeJson(repositoryExecution) !==
    canonicalizeJson(durable.canonicalCallIdentity.repositoryExecution)
  ) {
    throw new TypeError('SAM text-heavy repository binding drifted before authorization mint.');
  }
  const identity = createAuthorizationIdentity(repositoryExecution);
  const issuedAtMs = assertClock(readAuthorizationSource('clock', sources.nowMs));
  const expiresAtMs = issuedAtMs + SAM_TEXT_HEAVY_PRODUCTION_V3_AUTHORIZATION_LIFETIME_MS;
  if (
    !Number.isSafeInteger(expiresAtMs) ||
    expiresAtMs > RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT_MS
  ) {
    throw new TypeError('SAM text-heavy authorization cannot fit the reviewed evidence window.');
  }
  const authorizationId = assertAuthorizationId(
    readAuthorizationSource('identifier', sources.authorizationId),
  );
  const authorization = SamTextHeavyProductionV3AuthorizationSchema.parse({
    kind: 'single-text-heavy-sam-production-v3',
    authorizationId,
    environment,
    providerCallAuthority: environment === 'production-native',
    identity,
    output: {
      rootKind: durable.rootKind,
      outputDirectory: durable.outputDirectory,
      canonicalCallClaimSha256: durable.canonicalCallClaimSha256,
      claimRecordSha256: durable.claimRecordSha256,
    },
    issuedAtMs,
    expiresAtMs,
    executionAuthorized: true,
    singleUse: true,
  });
  issuedAuthorizationIds.add(authorizationId);
  authorizationStates.set(
    authorization,
    Object.freeze({
      prepared,
      reservation,
      rootKind: durable.rootKind,
      outputDirectory: durable.outputDirectory,
      issuedAtMs,
      expiresAtMs,
      environment,
      identity,
      repositoryBinding: durable.repositoryBinding,
    }),
  );
  return authorization;
};

/** Production mint exists but this milestone registers no production transport or real target. */
export const mintSamTextHeavyProductionV3Authorization = (
  prepared: SamCorpusPreparedRequestV1,
  reservation: SamTextHeavyProductionV3DurableReservation,
): SamTextHeavyProductionV3Authorization =>
  mint(
    prepared,
    reservation,
    { nowMs: Date.now, authorizationId: randomUUID },
    'production-native',
  );

export const createTestOnlySamTextHeavyProductionV3AuthorizationSources = (input: {
  readonly nowMs: () => number;
  readonly authorizationId: () => string;
}): SamTextHeavyProductionV3TestAuthorizationSources => {
  if (
    typeof input !== 'object' ||
    input === null ||
    JSON.stringify(Object.keys(input).toSorted()) !==
      JSON.stringify(['authorizationId', 'nowMs']) ||
    typeof input.nowMs !== 'function' ||
    typeof input.authorizationId !== 'function'
  ) {
    throw new TypeError('SAM text-heavy test authorization sources are not closed.');
  }
  const sources = Object.freeze({
    purpose: 'test-only-sam-text-heavy-production-v3-authorization-sources' as const,
  });
  testSources.set(sources, Object.freeze({ ...input }));
  return sources;
};

export const mintTestOnlySamTextHeavyProductionV3Authorization = (
  prepared: SamCorpusPreparedRequestV1,
  reservation: SamTextHeavyProductionV3DurableReservation,
  sources: SamTextHeavyProductionV3TestAuthorizationSources,
): SamTextHeavyProductionV3Authorization => {
  const state = testSources.get(sources);
  if (state === undefined) {
    throw new TypeError('SAM text-heavy test authorization sources are foreign.');
  }
  return mint(prepared, reservation, state, 'provider-free-native-boundary-test');
};

const validateAt = (input: {
  readonly prepared: SamCorpusPreparedRequestV1;
  readonly reservation: SamTextHeavyProductionV3DurableReservation;
  readonly authorization: unknown;
  readonly currentTimeMs: () => number;
}): SamTextHeavyProductionV3Authorization => {
  assertPreparedTextHeavy(input.prepared);
  const durable = inspectSamTextHeavyProductionV3DurableReservation(input.reservation);
  if (typeof input.authorization !== 'object' || input.authorization === null) {
    throw new TypeError('SAM text-heavy authorization is absent or malformed.');
  }
  const state = authorizationStates.get(input.authorization);
  if (
    state === undefined ||
    state.prepared !== input.prepared ||
    state.reservation !== input.reservation
  ) {
    throw new TypeError('SAM text-heavy authorization is foreign, cloned, or request-mismatched.');
  }
  if (validationsInProgress.has(input.authorization)) {
    throw new TypeError('SAM text-heavy authorization validation reentry is forbidden.');
  }
  validationsInProgress.add(input.authorization);
  try {
    const parsed = SamTextHeavyProductionV3AuthorizationSchema.parse(input.authorization);
    // The tracked minted object, rather than Zod's parsed clone, is the authority-bearing value.
    const authorization = input.authorization as SamTextHeavyProductionV3Authorization;
    const nowMs = assertClock(readAuthorizationSource('clock', input.currentTimeMs));
    if (
      parsed.issuedAtMs !== state.issuedAtMs ||
      parsed.expiresAtMs !== state.expiresAtMs ||
      parsed.environment !== state.environment ||
      parsed.output.rootKind !== state.rootKind ||
      parsed.output.outputDirectory !== state.outputDirectory ||
      parsed.output.outputDirectory !== durable.outputDirectory ||
      parsed.output.claimRecordSha256 !== durable.claimRecordSha256 ||
      canonicalizeJson(parsed.identity) !== canonicalizeJson(state.identity) ||
      parsed.output.canonicalCallClaimSha256 !== durable.canonicalCallClaimSha256 ||
      parsed.issuedAtMs > nowMs ||
      nowMs >= parsed.expiresAtMs
    ) {
      throw new TypeError(
        'SAM text-heavy authorization is stale, mutated, or identity-mismatched.',
      );
    }
    return authorization;
  } finally {
    validationsInProgress.delete(input.authorization);
  }
};

export const validateSamTextHeavyProductionV3Authorization = (input: {
  readonly prepared: SamCorpusPreparedRequestV1;
  readonly reservation: SamTextHeavyProductionV3DurableReservation;
  readonly authorization: unknown;
}): SamTextHeavyProductionV3Authorization => {
  const authorization = validateAt({ ...input, currentTimeMs: Date.now });
  if (authorization.environment !== 'production-native' || !authorization.providerCallAuthority) {
    throw new TypeError('SAM text-heavy production authorization lacks production authority.');
  }
  return authorization;
};

export const validateTestOnlySamTextHeavyProductionV3Authorization = (input: {
  readonly prepared: SamCorpusPreparedRequestV1;
  readonly reservation: SamTextHeavyProductionV3DurableReservation;
  readonly authorization: unknown;
  readonly sources: SamTextHeavyProductionV3TestAuthorizationSources;
}): SamTextHeavyProductionV3Authorization => {
  const sources = testSources.get(input.sources);
  if (sources === undefined) {
    throw new TypeError('SAM text-heavy test authorization sources are foreign.');
  }
  return validateAt({ ...input, currentTimeMs: sources.nowMs });
};

const claimAuthorization = (input: {
  readonly prepared: SamCorpusPreparedRequestV1;
  readonly reservation: SamTextHeavyProductionV3DurableReservation;
  readonly authorization: unknown;
}): void => {
  if (
    typeof input.authorization !== 'object' ||
    input.authorization === null ||
    authorizationStates.get(input.authorization)?.prepared !== input.prepared ||
    authorizationStates.get(input.authorization)?.reservation !== input.reservation
  ) {
    throw new TypeError('SAM text-heavy authorization is foreign, cloned, or request-mismatched.');
  }
  if (consumedAuthorizations.has(input.authorization)) {
    throw new TypeError('SAM text-heavy authorization is already consumed.');
  }
  // Consumption precedes the injected validation clock and is never rolled back on failure.
  consumedAuthorizations.add(input.authorization);
  const state = authorizationStates.get(input.authorization)!;
  const repositoryExecution = revalidateSamTextHeavyProductionV3RepositoryExecutionBinding(
    state.repositoryBinding,
  );
  if (
    canonicalizeJson(repositoryExecution) !== canonicalizeJson(state.identity.repositoryExecution)
  ) {
    throw new TypeError('SAM text-heavy repository binding drifted before execution authority.');
  }
};

const authorizeValidated = (input: {
  readonly prepared: SamCorpusPreparedRequestV1;
  readonly reservation: SamTextHeavyProductionV3DurableReservation;
  readonly authorization: SamTextHeavyProductionV3Authorization;
}): SamTextHeavyProductionV3AuthorizedExecution => {
  const state = authorizationStates.get(input.authorization)!;
  const authorized = Object.freeze({
    purpose: 'authorized-sam-text-heavy-production-v3-execution' as const,
  });
  authorizedExecutionStates.set(
    authorized,
    Object.freeze({
      prepared: input.prepared,
      authorization: input.authorization,
      reservation: input.reservation,
      outputDirectory: state.outputDirectory,
      environment: state.environment,
      repositoryBinding: state.repositoryBinding,
      repositoryExecutionEvidence: state.identity.repositoryExecution,
    }),
  );
  return authorized;
};

export const authorizeSamTextHeavyProductionV3Execution = (input: {
  readonly prepared: SamCorpusPreparedRequestV1;
  readonly reservation: SamTextHeavyProductionV3DurableReservation;
  readonly authorization: unknown;
}): SamTextHeavyProductionV3AuthorizedExecution => {
  claimAuthorization(input);
  return authorizeValidated({
    ...input,
    authorization: validateSamTextHeavyProductionV3Authorization(input),
  });
};

export const authorizeTestOnlySamTextHeavyProductionV3Execution = (input: {
  readonly prepared: SamCorpusPreparedRequestV1;
  readonly reservation: SamTextHeavyProductionV3DurableReservation;
  readonly authorization: unknown;
  readonly sources: SamTextHeavyProductionV3TestAuthorizationSources;
}): SamTextHeavyProductionV3AuthorizedExecution => {
  claimAuthorization(input);
  const authorization = validateTestOnlySamTextHeavyProductionV3Authorization(input);
  return authorizeValidated({ ...input, authorization });
};

export const consumeSamTextHeavyProductionV3AuthorizedExecution = (
  authorized: SamTextHeavyProductionV3AuthorizedExecution,
): AuthorizedExecutionState => {
  const state = authorizedExecutionStates.get(authorized);
  if (state === undefined || consumedExecutions.has(authorized)) {
    throw new TypeError('SAM text-heavy authorized execution is foreign or already consumed.');
  }
  consumedExecutions.add(authorized);
  const repositoryExecution = revalidateSamTextHeavyProductionV3RepositoryExecutionBinding(
    state.repositoryBinding,
  );
  if (
    canonicalizeJson(repositoryExecution) !== canonicalizeJson(state.repositoryExecutionEvidence)
  ) {
    throw new TypeError('SAM text-heavy repository binding drifted before transport construction.');
  }
  return state;
};
