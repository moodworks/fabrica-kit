import { mkdir } from 'node:fs/promises';

import type { SamExecutionIdentity, SamMaskResponse } from '../sam/sam-mask-contracts.js';
import { postprocessSamMasks } from '../sam/sam-mask-postprocess.js';
import { canonicalResponseSha256 } from '../sam/sam-mask-rle.js';
import { parseAndVerifySamMaskRequest } from '../sam/sam-mask-validation.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  SAM_CORPUS_CLIENT_TIMEOUT_MS,
  SAM_CORPUS_COST_MAXIMUM_MICRO_USD,
  SAM_CORPUS_ENDPOINT_ID,
  SAM_CORPUS_ENDPOINT_VERSION,
  SAM_CORPUS_EVALUATION_FIXTURES_V1,
  SAM_CORPUS_EXECUTION_IDENTITY,
  SAM_CORPUS_PROFILE_IDENTITIES,
  SAM_CORPUS_REQUEST_LIMITS,
  SAM_CORPUS_WORKER_IMAGE,
  SAM_CORPUS_WORKER_IMAGE_DIGEST,
  deriveSamAutomaticBatchPeakBytesV1,
  inspectSamCorpusPreparedRequestV1,
} from './sam-corpus-evaluation-catalog-v1.js';
import {
  SAM_CORPUS_FAKE_OUTPUT_LABEL,
  bindSamCorpusVisualReviewEvidenceV1,
  assertSamCorpusOutputDirectoryAbsentV2,
  materializeSamCorpusVisualEvaluationV2,
  validateSamCorpusVisualResponseV2,
  verifySamCorpusVisualArtifactSetV2,
  type SamCorpusMaterializationResultV2,
  type SamCorpusOutputClassificationV2,
  type SamCorpusVisualReviewEvidenceV1,
} from './sam-corpus-visual-evaluation-v2.js';
import {
  consumeSamRunPodDirectV3DispatchCapability,
  createSamRunPodDirectV3Adapter,
  SamRunPodDirectV3Error,
  type SamRunPodDirectV3TransportPort,
  type SamRunPodDirectV3TransportRequest,
  type SamRunPodDirectV3TransportResponse,
} from './sam-runpod-direct-v3-adapter.js';
import { SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY } from './sam-runpod-direct-v3-deterministic-fake-transport.js';
import { createSamRunPodDirectV3NativeFetchTransport } from './sam-runpod-direct-v3-native-fetch-transport.js';
import {
  RUNPOD_API_KEY_REFERENCE,
  RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT,
  RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT,
  SamRunPodDirectV3AuthorizationSchema,
} from './sam-runpod-direct-v3-profiles.js';
import {
  consumeSamTextHeavyProductionV3AuthorizedExecution,
  SAM_TEXT_HEAVY_PRODUCTION_V3_FROZEN_IDENTITY,
  type SamTextHeavyProductionV3AuthorizedExecution,
} from './sam-text-heavy-production-v3-authorization.js';
import {
  retireSamTextHeavyProductionV3Output,
  verifyRetiredSamTextHeavyProductionV3DurableClaim,
} from './sam-text-heavy-production-v3-reservation.js';

export const SAM_TEXT_HEAVY_PRODUCTION_V3_ACTIVATION = Object.freeze({
  productionExecutionRegistry: 'empty-unchanged' as const,
  productionNativeTransportRegistry: 'empty-unchanged' as const,
  productionExecutionActivated: false as const,
  providerCallAuthority: false as const,
  webRouteAuthority: false as const,
  productProductionAuthority: false as const,
  generalAdmissionAuthority: false as const,
  productionAdmissionAuthority: false as const,
  corpusBatchAuthority: false as const,
  dispatchMaximum: 1 as const,
  fetchMaximum: 1 as const,
  materializationMaximum: 1 as const,
  retryCount: 0 as const,
  redirectCount: 0 as const,
  pollCount: 0 as const,
  healthRequestCount: 0 as const,
  pingRequestCount: 0 as const,
  queueRequestCount: 0 as const,
  providerBillingGuarantee: false as const,
});

export const SAM_TEXT_HEAVY_PRODUCTION_V3_NATIVE_TRANSPORT_REGISTRY = Object.freeze(
  [] as readonly never[],
);

export interface SamTextHeavyProductionV3NativeTransportFactory {
  readonly purpose: 'deferred-native-sam-text-heavy-production-v3-transport';
}

export interface SamTextHeavyProductionV3TestTransportFactory {
  readonly purpose: 'test-only-deterministic-sam-text-heavy-production-v3-transport';
}

export interface SamTextHeavyProductionV3TestNativeBoundaryFactory {
  readonly purpose: 'test-only-in-memory-native-boundary-sam-text-heavy-production-v3';
}

type SamTextHeavyProductionV3TransportFactory =
  SamTextHeavyProductionV3NativeTransportFactory | SamTextHeavyProductionV3TestTransportFactory;

interface TransportFactoryCounters {
  constructed: boolean;
  constructionCount: number;
  dispatchCount: number;
  fetchCount: number;
}

interface NativeTransportFactoryState extends TransportFactoryCounters {
  readonly apiKey: string;
}

interface TestTransportFactoryState extends TransportFactoryCounters {
  readonly outcome: SamTextHeavyProductionV3TestOutcome;
}

interface TestNativeBoundaryFactoryState extends TransportFactoryCounters {
  readonly candidateCount: number;
  dispatchedTimeoutMs: number | null;
  capturedRequest: SamTextHeavyProductionV3SanitizedNativeRequestEvidence | null;
}

export type SamTextHeavyProductionV3TestOutcome =
  | { readonly kind: 'valid-deterministic-fake'; readonly candidateCount: number }
  | { readonly kind: 'valid-deterministic-fake-with-output-race'; readonly candidateCount: number }
  | { readonly kind: 'throw-after-dispatch' }
  | { readonly kind: 'wait-for-timeout' }
  | { readonly kind: 'known-provider-failure' }
  | { readonly kind: 'invalid-composite-response' };

export interface SamTextHeavyProductionV3SanitizedNativeRequestEvidence {
  readonly endpoint: string;
  readonly method: 'POST';
  readonly canonicalRequestByteLength: number;
  readonly canonicalRequestSha256: string;
  readonly timeoutMs: typeof SAM_CORPUS_CLIENT_TIMEOUT_MS;
  readonly redirect: 'error';
  readonly cache: 'no-store';
  readonly credentials: 'omit';
  readonly referrerPolicy: 'no-referrer';
  readonly dummyAuthorizationHeaderVerified: true;
  readonly networkCalls: 0;
}

export interface SamTextHeavyProductionV3TransportFactorySnapshot {
  readonly constructionCount: number;
  readonly dispatchCount: number;
  readonly fetchCount: number;
}

export interface SamTextHeavyProductionV3TestNativeBoundaryFactorySnapshot extends SamTextHeavyProductionV3TransportFactorySnapshot {
  readonly capturedRequest: SamTextHeavyProductionV3SanitizedNativeRequestEvidence | null;
}

const nativeTransportFactories = new WeakMap<object, NativeTransportFactoryState>();
const testTransportFactories = new WeakMap<object, TestTransportFactoryState>();
const testNativeBoundaryFactories = new WeakMap<object, TestNativeBoundaryFactoryState>();
const TEST_ONLY_DUMMY_API_KEY = 'TEST_ONLY_SAM_TEXT_HEAVY_V3_DUMMY_KEY_NOT_A_CREDENTIAL';

/**
 * This only seals a future server-owned dependency. The API key is neither logged nor passed to
 * the native transport until an exact production execution has consumed every prior capability.
 */
export const createSamTextHeavyProductionV3NativeTransportFactory = (input: {
  readonly apiKey: string;
  readonly secretReferenceName: typeof RUNPOD_API_KEY_REFERENCE;
}): SamTextHeavyProductionV3NativeTransportFactory => {
  if (
    typeof input !== 'object' ||
    input === null ||
    JSON.stringify(Object.keys(input).toSorted()) !==
      JSON.stringify(['apiKey', 'secretReferenceName']) ||
    !Object.hasOwn(input, 'apiKey') ||
    !Object.hasOwn(input, 'secretReferenceName') ||
    typeof input.apiKey !== 'string' ||
    input.secretReferenceName !== RUNPOD_API_KEY_REFERENCE
  ) {
    throw new TypeError('SAM text-heavy native transport factory input is not closed.');
  }
  const factory = Object.freeze({
    purpose: 'deferred-native-sam-text-heavy-production-v3-transport' as const,
  });
  nativeTransportFactories.set(factory, {
    apiKey: input.apiKey,
    constructed: false,
    constructionCount: 0,
    dispatchCount: 0,
    fetchCount: 0,
  });
  return factory;
};

const assertCandidateCount = (value: number): number => {
  if (!Number.isInteger(value) || value < 0 || value > 8) {
    throw new TypeError('SAM text-heavy test candidate count is outside 0..8.');
  }
  return value;
};

const parseTestOutcome = (input: unknown): SamTextHeavyProductionV3TestOutcome => {
  if (typeof input !== 'object' || input === null || !Object.hasOwn(input, 'kind')) {
    throw new TypeError('SAM text-heavy test outcome is not closed.');
  }
  const candidate = input as Record<string, unknown>;
  if (
    candidate.kind === 'valid-deterministic-fake' ||
    candidate.kind === 'valid-deterministic-fake-with-output-race'
  ) {
    if (
      JSON.stringify(Object.keys(candidate).toSorted()) !==
      JSON.stringify(['candidateCount', 'kind'])
    ) {
      throw new TypeError('SAM text-heavy valid test outcome is not closed.');
    }
    return Object.freeze({
      kind: candidate.kind,
      candidateCount: assertCandidateCount(candidate.candidateCount as number),
    });
  }
  if (
    (candidate.kind === 'throw-after-dispatch' ||
      candidate.kind === 'wait-for-timeout' ||
      candidate.kind === 'known-provider-failure' ||
      candidate.kind === 'invalid-composite-response') &&
    JSON.stringify(Object.keys(candidate)) === JSON.stringify(['kind'])
  ) {
    return Object.freeze({ kind: candidate.kind });
  }
  throw new TypeError('SAM text-heavy test outcome is not closed.');
};

export const createTestOnlySamTextHeavyProductionV3TransportFactory = (input: {
  readonly outcome: SamTextHeavyProductionV3TestOutcome;
}): SamTextHeavyProductionV3TestTransportFactory => {
  if (
    typeof input !== 'object' ||
    input === null ||
    JSON.stringify(Object.keys(input)) !== JSON.stringify(['outcome'])
  ) {
    throw new TypeError('SAM text-heavy test transport factory input is not closed.');
  }
  const factory = Object.freeze({
    purpose: 'test-only-deterministic-sam-text-heavy-production-v3-transport' as const,
  });
  testTransportFactories.set(factory, {
    outcome: parseTestOutcome(input.outcome),
    constructed: false,
    constructionCount: 0,
    dispatchCount: 0,
    fetchCount: 0,
  });
  return factory;
};

export const createTestOnlySamTextHeavyProductionV3NativeBoundaryFactory = (input: {
  readonly candidateCount: number;
}): SamTextHeavyProductionV3TestNativeBoundaryFactory => {
  if (
    typeof input !== 'object' ||
    input === null ||
    JSON.stringify(Object.keys(input)) !== JSON.stringify(['candidateCount'])
  ) {
    throw new TypeError('SAM text-heavy test-native boundary factory input is not closed.');
  }
  const factory = Object.freeze({
    purpose: 'test-only-in-memory-native-boundary-sam-text-heavy-production-v3' as const,
  });
  testNativeBoundaryFactories.set(factory, {
    candidateCount: assertCandidateCount(input.candidateCount),
    dispatchedTimeoutMs: null,
    capturedRequest: null,
    constructed: false,
    constructionCount: 0,
    dispatchCount: 0,
    fetchCount: 0,
  });
  return factory;
};

const snapshotCounters = (
  state: TransportFactoryCounters,
): SamTextHeavyProductionV3TransportFactorySnapshot =>
  Object.freeze({
    constructionCount: state.constructionCount,
    dispatchCount: state.dispatchCount,
    fetchCount: state.fetchCount,
  });

export const inspectSamTextHeavyProductionV3NativeTransportFactory = (
  factory: SamTextHeavyProductionV3NativeTransportFactory,
): SamTextHeavyProductionV3TransportFactorySnapshot => {
  const state = nativeTransportFactories.get(factory);
  if (state === undefined) {
    throw new TypeError('SAM text-heavy native transport factory is foreign.');
  }
  return snapshotCounters(state);
};

export const inspectTestOnlySamTextHeavyProductionV3TransportFactory = (
  factory: SamTextHeavyProductionV3TestTransportFactory,
): SamTextHeavyProductionV3TransportFactorySnapshot => {
  const state = testTransportFactories.get(factory);
  if (state === undefined) {
    throw new TypeError('SAM text-heavy test transport factory is foreign.');
  }
  return snapshotCounters(state);
};

export const inspectTestOnlySamTextHeavyProductionV3NativeBoundaryFactory = (
  factory: SamTextHeavyProductionV3TestNativeBoundaryFactory,
): SamTextHeavyProductionV3TestNativeBoundaryFactorySnapshot => {
  const state = testNativeBoundaryFactories.get(factory);
  if (state === undefined) {
    throw new TypeError('SAM text-heavy test-native boundary factory is foreign.');
  }
  return Object.freeze({ ...snapshotCounters(state), capturedRequest: state.capturedRequest });
};

const createCountedNativeTransport = (input: {
  readonly apiKey: string;
  readonly fetchImplementation: typeof globalThis.fetch;
  readonly state: TransportFactoryCounters;
}): SamRunPodDirectV3TransportPort => {
  const countedFetch: typeof globalThis.fetch = async (...args) => {
    if (input.state.fetchCount >= SAM_TEXT_HEAVY_PRODUCTION_V3_ACTIVATION.fetchMaximum) {
      throw new TypeError('SAM text-heavy native fetch maximum was already consumed.');
    }
    input.state.fetchCount += 1;
    return input.fetchImplementation(...args);
  };
  const native = createSamRunPodDirectV3NativeFetchTransport({
    apiKey: input.apiKey,
    secretReferenceName: RUNPOD_API_KEY_REFERENCE,
    fetchImplementation: countedFetch,
  });
  return Object.freeze({
    transportKind: native.transportKind,
    secretReferenceName: native.secretReferenceName,
    async dispatch(request: SamRunPodDirectV3TransportRequest) {
      if (input.state.dispatchCount >= SAM_TEXT_HEAVY_PRODUCTION_V3_ACTIVATION.dispatchMaximum) {
        throw new TypeError('SAM text-heavy native dispatch maximum was already consumed.');
      }
      input.state.dispatchCount += 1;
      if ('dispatchedTimeoutMs' in input.state) {
        (input.state as TestNativeBoundaryFactoryState).dispatchedTimeoutMs = request.timeoutMs;
      }
      return native.dispatch(request);
    },
  });
};

const createSyntheticResponse = (
  requestBodyText: string,
  executionIdentity: SamExecutionIdentity,
  candidateCount: number,
): SamMaskResponse => {
  const parsed: unknown = JSON.parse(requestBodyText);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new TypeError('SAM text-heavy test request body is malformed.');
  }
  const { workerImageDigest, ...baseRequest } = parsed as Record<string, unknown>;
  if (workerImageDigest !== SAM_CORPUS_WORKER_IMAGE_DIGEST) {
    throw new TypeError('SAM text-heavy test request image digest drifted.');
  }
  const { request } = parseAndVerifySamMaskRequest(baseRequest);
  const rawCandidates = Array.from({ length: candidateCount }, (_, index) => {
    const mask = new Uint8Array(request.source.width * request.source.height);
    const left = 8 + index * 24;
    const top = 8 + index * 20;
    for (let y = top; y < top + 12; y += 1) {
      mask.fill(1, y * request.source.width + left, y * request.source.width + left + 12);
    }
    return {
      mask,
      predictedIou: 0.98 - index * 0.03,
      stabilityScore: 0.97 - index * 0.02,
    };
  });
  const postprocessed = postprocessSamMasks(request, rawCandidates);
  const unsigned: Omit<SamMaskResponse, 'responseSha256'> = {
    contractVersion: request.contractVersion,
    requestId: request.requestId,
    workspaceId: request.workspaceId,
    jobId: request.jobId,
    attemptId: request.attemptId,
    sourceSha256: request.source.sha256,
    executionIdentity,
    timing: { inferenceMs: 0, totalMs: 0 },
    filterSummary: postprocessed.filterSummary,
    candidateCount: postprocessed.candidates.length,
    candidates: postprocessed.candidates,
  };
  return Object.freeze({ ...unsigned, responseSha256: canonicalResponseSha256(unsigned) });
};

const constructNativeTransport = (
  factory: SamTextHeavyProductionV3NativeTransportFactory,
): {
  readonly transport: SamRunPodDirectV3TransportPort;
  readonly state: TransportFactoryCounters;
} => {
  const state = nativeTransportFactories.get(factory);
  if (state === undefined || state.constructed) {
    throw new TypeError('SAM text-heavy native transport factory is foreign or already consumed.');
  }
  // Irreversible consumption precedes native construction and every injected fetch callback.
  state.constructed = true;
  state.constructionCount += 1;
  const transport = createCountedNativeTransport({
    apiKey: state.apiKey,
    fetchImplementation: globalThis.fetch,
    state,
  });
  return Object.freeze({ transport, state });
};

const constructTestNativeBoundaryTransport = (
  factory: SamTextHeavyProductionV3TestNativeBoundaryFactory,
): {
  readonly transport: SamRunPodDirectV3TransportPort;
  readonly state: TestNativeBoundaryFactoryState;
} => {
  const state = testNativeBoundaryFactories.get(factory);
  if (state === undefined || state.constructed) {
    throw new TypeError(
      'SAM text-heavy test-native boundary factory is foreign or already consumed.',
    );
  }
  state.constructed = true;
  state.constructionCount += 1;
  const localFakeFetch: typeof globalThis.fetch = async (requestInput, init) => {
    const headers = init?.headers;
    const body = init?.body;
    if (
      typeof requestInput !== 'string' ||
      requestInput !== `https://${SAM_CORPUS_ENDPOINT_ID}.api.runpod.ai/v1/masks` ||
      init?.method !== 'POST' ||
      typeof headers !== 'object' ||
      headers === null ||
      Array.isArray(headers) ||
      canonicalizeJson(headers) !==
        canonicalizeJson({
          accept: 'application/json',
          authorization: `Bearer ${TEST_ONLY_DUMMY_API_KEY}`,
          'content-type': 'application/json',
        }) ||
      typeof body !== 'string' ||
      init.redirect !== 'error' ||
      init.cache !== 'no-store' ||
      init.credentials !== 'omit' ||
      init.referrerPolicy !== 'no-referrer' ||
      state.dispatchedTimeoutMs !== SAM_CORPUS_CLIENT_TIMEOUT_MS
    ) {
      throw new TypeError('SAM text-heavy test-native request composition drifted.');
    }
    const canonicalBytes = Buffer.from(body, 'utf8');
    state.capturedRequest = Object.freeze({
      endpoint: requestInput,
      method: 'POST' as const,
      canonicalRequestByteLength: canonicalBytes.byteLength,
      canonicalRequestSha256: sha256Hex(canonicalBytes),
      timeoutMs: SAM_CORPUS_CLIENT_TIMEOUT_MS,
      redirect: 'error' as const,
      cache: 'no-store' as const,
      credentials: 'omit' as const,
      referrerPolicy: 'no-referrer' as const,
      dummyAuthorizationHeaderVerified: true as const,
      networkCalls: 0 as const,
    });
    return new Response(
      JSON.stringify(
        createSyntheticResponse(body, SAM_CORPUS_EXECUTION_IDENTITY, state.candidateCount),
      ),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  return Object.freeze({
    transport: createCountedNativeTransport({
      apiKey: TEST_ONLY_DUMMY_API_KEY,
      fetchImplementation: localFakeFetch,
      state,
    }),
    state,
  });
};

const constructTestTransport = (
  factory: SamTextHeavyProductionV3TestTransportFactory,
): {
  readonly transport: SamRunPodDirectV3TransportPort;
  readonly state: TransportFactoryCounters;
} => {
  const state = testTransportFactories.get(factory);
  if (state === undefined || state.constructed) {
    throw new TypeError('SAM text-heavy test transport factory is foreign or already consumed.');
  }
  // Irreversible consumption precedes the injected responder callback.
  state.constructed = true;
  state.constructionCount += 1;
  const transport: SamRunPodDirectV3TransportPort = Object.freeze({
    transportKind: 'deterministic-fake-direct-v3' as const,
    secretReferenceName: null,
    async dispatch(request: SamRunPodDirectV3TransportRequest) {
      if (state.dispatchCount >= SAM_TEXT_HEAVY_PRODUCTION_V3_ACTIVATION.dispatchMaximum) {
        throw new TypeError('SAM text-heavy test dispatch maximum was already consumed.');
      }
      state.dispatchCount += 1;
      consumeSamRunPodDirectV3DispatchCapability(request, 'deterministic-fake-direct-v3');
      if (state.outcome.kind === 'throw-after-dispatch') {
        const injected = new Error('TEST_ONLY_SECRET_BEARER_MUST_NOT_ESCAPE');
        Object.assign(injected, {
          headers: { authorization: 'Bearer TEST_ONLY_SECRET_BEARER_MUST_NOT_ESCAPE' },
          rawBody: 'TEST_ONLY_SECRET_BEARER_MUST_NOT_ESCAPE',
        });
        throw injected;
      }
      if (state.outcome.kind === 'wait-for-timeout') {
        return new Promise<SamRunPodDirectV3TransportResponse>((_resolve, reject) => {
          const abort = () => reject(new DOMException('Test-only timeout.', 'AbortError'));
          if (request.signal.aborted) abort();
          else request.signal.addEventListener('abort', abort, { once: true });
        });
      }
      if (state.outcome.kind === 'known-provider-failure') {
        return {
          status: 422,
          contentType: 'application/json',
          bodyText: JSON.stringify({ rawMarker: 'TEST_ONLY_PROVIDER_BODY_MUST_NOT_ESCAPE' }),
        };
      }
      if (state.outcome.kind === 'invalid-composite-response') {
        return {
          status: 200,
          contentType: 'application/json',
          bodyText: JSON.stringify({
            rawMarker: 'TEST_ONLY_RAW_RESPONSE_MUST_NOT_ESCAPE',
            candidateCount: 9,
            executionIdentity: { kind: 'meta-sam2.1' },
            candidates: [{ mask: { encoding: 'invalid-rle', dataBase64: 'not-canonical' } }],
          }),
        };
      }
      return {
        status: 200,
        contentType: 'application/json',
        bodyText: JSON.stringify(
          createSyntheticResponse(
            request.requestBodyText,
            SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
            state.outcome.candidateCount,
          ),
        ),
      };
    },
  });
  return Object.freeze({ transport, state });
};

const constructTransport = (
  environment: 'production-native' | 'provider-free-native-boundary-test',
  factory: SamTextHeavyProductionV3TransportFactory,
): {
  readonly transport: SamRunPodDirectV3TransportPort;
  readonly state: TransportFactoryCounters;
} => {
  if (environment === 'production-native') {
    if (!nativeTransportFactories.has(factory)) {
      throw new TypeError(
        'SAM text-heavy production execution requires its opaque native factory.',
      );
    }
    return constructNativeTransport(factory as SamTextHeavyProductionV3NativeTransportFactory);
  }
  if (!testTransportFactories.has(factory)) {
    throw new TypeError('SAM text-heavy provider-free execution requires its opaque test factory.');
  }
  return constructTestTransport(factory as SamTextHeavyProductionV3TestTransportFactory);
};

export type SamTextHeavyProductionV3ExecutionFailureReason =
  'INDETERMINATE' | 'PROVIDER_FAILURE' | 'RESPONSE_INVALID' | 'LOCAL_FAILURE';

export class SamTextHeavyProductionV3ExecutionError extends Error {
  readonly retryable = false;
  readonly providerBillingGuarantee = false;

  constructor(
    readonly reason: SamTextHeavyProductionV3ExecutionFailureReason,
    readonly transportConstructionCount: number,
    readonly dispatchCount: number,
    readonly fetchCount: number,
    readonly materializationCount: number,
  ) {
    super(
      reason === 'INDETERMINATE'
        ? 'SAM text-heavy execution became indeterminate after its one-way claim.'
        : reason === 'PROVIDER_FAILURE'
          ? 'SAM text-heavy provider returned a known failure.'
          : reason === 'RESPONSE_INVALID'
            ? 'SAM text-heavy response failed closed verification.'
            : 'SAM text-heavy execution failed locally before a validated result.',
    );
    this.name = 'SamTextHeavyProductionV3ExecutionError';
  }
}

const sanitizeExecutionFailure = (
  error: unknown,
  counters: TransportFactoryCounters | undefined,
  materializationCount: number,
): SamTextHeavyProductionV3ExecutionError => {
  const reason: SamTextHeavyProductionV3ExecutionFailureReason =
    error instanceof SamRunPodDirectV3Error
      ? error.reason === 'INDETERMINATE'
        ? 'INDETERMINATE'
        : error.reason === 'PROVIDER_FAILURE'
          ? 'PROVIDER_FAILURE'
          : error.reason === 'RESPONSE_INVALID'
            ? 'RESPONSE_INVALID'
            : 'LOCAL_FAILURE'
      : 'LOCAL_FAILURE';
  return new SamTextHeavyProductionV3ExecutionError(
    reason,
    counters?.constructionCount ?? 0,
    counters?.dispatchCount ?? 0,
    counters?.fetchCount ?? 0,
    materializationCount,
  );
};

type ConsumedTextHeavyExecution = ReturnType<
  typeof consumeSamTextHeavyProductionV3AuthorizedExecution
>;

const verifyExactPreconstructionBindings = (exact: ConsumedTextHeavyExecution) => {
  const preparedState = inspectSamCorpusPreparedRequestV1(exact.prepared);
  const entry = preparedState.catalogEntry;
  const canonicalBytes = Buffer.from(preparedState.directPrepared.canonicalBodyText, 'utf8');
  const canonicalRequestSha256 = sha256Hex(canonicalBytes);
  const recomputedCapacity = deriveSamAutomaticBatchPeakBytesV1(
    entry.normalized.width,
    entry.normalized.height,
    1,
  );
  const binding = exact.authorization.identity;
  const production = exact.environment === 'production-native';
  if (
    entry !== SAM_CORPUS_EVALUATION_FIXTURES_V1['text-heavy'] ||
    entry.normalized.width !== 416 ||
    entry.normalized.height !== 522 ||
    recomputedCapacity !== 114_138_112 ||
    recomputedCapacity > 268_435_456 ||
    canonicalBytes.byteLength !== entry.canonicalRequest.byteLength ||
    canonicalRequestSha256 !== entry.canonicalRequest.sha256 ||
    exact.prepared.canonicalBodyByteLength !== canonicalBytes.byteLength ||
    exact.prepared.canonicalBodySha256 !== canonicalRequestSha256 ||
    canonicalizeJson(binding) !== canonicalizeJson(SAM_TEXT_HEAVY_PRODUCTION_V3_FROZEN_IDENTITY) ||
    binding.repositorySha !== SAM_TEXT_HEAVY_PRODUCTION_V3_FROZEN_IDENTITY.repositorySha ||
    binding.endpoint.id !== SAM_CORPUS_ENDPOINT_ID ||
    binding.endpoint.version !== SAM_CORPUS_ENDPOINT_VERSION ||
    binding.endpoint.method !== 'POST' ||
    binding.endpoint.path !== '/v1/masks' ||
    binding.endpoint.redirectCount !== 0 ||
    binding.workerImage !== SAM_CORPUS_WORKER_IMAGE ||
    binding.workerImageDigest !== SAM_CORPUS_WORKER_IMAGE_DIGEST ||
    canonicalizeJson(binding.fixture.source) !== canonicalizeJson(entry.normalized) ||
    canonicalizeJson(binding.fixture.humanOracle) !== canonicalizeJson(entry.humanOracle) ||
    canonicalizeJson(binding.request.identifiers) !== canonicalizeJson(entry.identifiers) ||
    canonicalizeJson(binding.request.canonical) !== canonicalizeJson(entry.canonicalRequest) ||
    canonicalizeJson(binding.executionIdentity) !==
      canonicalizeJson(SAM_CORPUS_EXECUTION_IDENTITY) ||
    canonicalizeJson(binding.profiles) !== canonicalizeJson(SAM_CORPUS_PROFILE_IDENTITIES) ||
    binding.capacity.automaticOnePointPeakBytes !== recomputedCapacity ||
    binding.capacity.ceilingBytes !== 268_435_456 ||
    binding.capacity.pointsPerBatch !== 3 ||
    !binding.capacity.eligible ||
    binding.policy.clientWallTimeoutMs !== SAM_CORPUS_CLIENT_TIMEOUT_MS ||
    binding.policy.incrementalCostMaximumMicroUsd !== SAM_CORPUS_COST_MAXIMUM_MICRO_USD ||
    binding.policy.dispatchMaximum !== 1 ||
    binding.policy.fetchMaximum !== 1 ||
    binding.policy.materializationMaximum !== 1 ||
    binding.policy.retryCount !== 0 ||
    binding.policy.redirectCount !== 0 ||
    binding.policy.pollCount !== 0 ||
    binding.policy.healthRequestCount !== 0 ||
    binding.policy.pingRequestCount !== 0 ||
    binding.policy.queueRequestCount !== 0 ||
    binding.policy.providerBillingGuarantee !== false ||
    exact.authorization.providerCallAuthority !== production
  ) {
    throw new TypeError(
      'SAM text-heavy identity, capacity, or request drifted before construction.',
    );
  }
  return Object.freeze({ preparedState, entry, canonicalBytes, canonicalRequestSha256 });
};

const createExactAdapterAuthorization = (
  exact: ConsumedTextHeavyExecution,
  entry: (typeof SAM_CORPUS_EVALUATION_FIXTURES_V1)['text-heavy'],
) =>
  SamRunPodDirectV3AuthorizationSchema.parse({
    kind: 'single-fixture-sam-runpod-direct-v3',
    authorizationId: exact.authorization.authorizationId,
    endpointId: SAM_CORPUS_ENDPOINT_ID,
    imageDigest: SAM_CORPUS_WORKER_IMAGE_DIGEST,
    secretReferenceName: RUNPOD_API_KEY_REFERENCE,
    executionIdentity: SAM_CORPUS_EXECUTION_IDENTITY,
    hostingProfileSha256: exact.authorization.identity.profiles.hostingSha256,
    adapterProfileSha256: exact.authorization.identity.profiles.adapterV3Sha256,
    authorizationProfileSha256: exact.authorization.identity.profiles.authorizationV3Sha256,
    documentationEvidence: {
      retrievedAt: RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT,
      expiresAt: RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT,
      hostingProfileSha256: exact.authorization.identity.profiles.hostingSha256,
    },
    fixture: {
      sha256: entry.normalized.sha256,
      byteSize: entry.normalized.byteLength,
      width: entry.normalized.width,
      height: entry.normalized.height,
    },
    requestLimits: SAM_CORPUS_REQUEST_LIMITS,
    output: { maskEncoding: exact.authorization.identity.request.maskEncoding },
    automaticCandidatesOnly: true,
    clientDispatchMaximum: 1,
    applicationInferenceMaximum: 1,
    providerBillingGuarantee: false,
    clientRetryCount: 0,
    pollCount: 0,
    clientWallTimeoutMs: SAM_CORPUS_CLIENT_TIMEOUT_MS,
    costMaximumMicroUsd: SAM_CORPUS_COST_MAXIMUM_MICRO_USD,
    issuedAtMs: exact.authorization.issuedAtMs,
    expiresAtMs: exact.authorization.expiresAtMs,
    executionAuthorized: true,
    productionAdmissionAuthority: false,
    webRouteActivated: false,
  });

export interface SamTextHeavyProductionV3ExecutionResult {
  readonly classification: 'validated-real-sam-output' | 'provider-free-deterministic-fake';
  readonly canonicalRequestByteLength: number;
  readonly canonicalRequestSha256: string;
  readonly validatedResponseSha256: string;
  readonly artifacts: SamCorpusMaterializationResultV2;
  readonly reviewEvidence: SamCorpusVisualReviewEvidenceV1;
  readonly runtimeMs: number;
  readonly transportConstructionCount: number;
  readonly dispatchCount: number;
  readonly fetchCount: number;
  readonly materializationCount: number;
  readonly retryCount: 0;
  readonly redirectCount: 0;
  readonly pollCount: 0;
  readonly healthRequestCount: 0;
  readonly pingRequestCount: 0;
  readonly queueRequestCount: 0;
  readonly timeoutMs: typeof SAM_CORPUS_CLIENT_TIMEOUT_MS;
  readonly billingEvidence: {
    readonly kind: 'authorization-ceiling-only';
    readonly incrementalCostMaximumMicroUsd: typeof SAM_CORPUS_COST_MAXIMUM_MICRO_USD;
    readonly observedProviderCostMicroUsd: null;
    readonly providerBillingGuarantee: false;
  };
  readonly providerBillingGuarantee: false;
}

export interface SamTextHeavyProductionV3TestNativeBoundaryResult {
  readonly classification: 'test-only-native-boundary-in-memory-not-sam-output';
  readonly label: typeof SAM_CORPUS_FAKE_OUTPUT_LABEL;
  readonly canonicalRequestByteLength: number;
  readonly canonicalRequestSha256: string;
  readonly discardedSyntheticResponseSha256: string;
  readonly discardedSyntheticCandidateCount: number;
  readonly requestEvidence: SamTextHeavyProductionV3SanitizedNativeRequestEvidence;
  readonly transportConstructionCount: 1;
  readonly dispatchCount: 1;
  readonly fetchCount: 1;
  readonly materializationCount: 0;
  readonly networkCalls: 0;
  readonly retryCount: 0;
  readonly providerCallAuthority: false;
  readonly providerBillingGuarantee: false;
}

/**
 * Exercises native request composition with a built-in dummy token and module-internal fake fetch.
 * It consumes only test authority, returns sanitized in-memory counters, and cannot materialize.
 */
export const executeTestOnlySamTextHeavyProductionV3NativeBoundary = async (input: {
  readonly authorized: SamTextHeavyProductionV3AuthorizedExecution;
  readonly transportFactory: SamTextHeavyProductionV3TestNativeBoundaryFactory;
}): Promise<SamTextHeavyProductionV3TestNativeBoundaryResult> => {
  if (
    typeof input !== 'object' ||
    input === null ||
    JSON.stringify(Object.keys(input).toSorted()) !==
      JSON.stringify(['authorized', 'transportFactory'])
  ) {
    throw new TypeError('SAM text-heavy test-native boundary input is not closed.');
  }
  const exact = consumeSamTextHeavyProductionV3AuthorizedExecution(input.authorized);
  retireSamTextHeavyProductionV3Output(exact.reservation);
  let counters: TransportFactoryCounters | undefined;
  try {
    if (
      exact.environment !== 'provider-free-native-boundary-test' ||
      exact.authorization.providerCallAuthority
    ) {
      throw new TypeError('SAM text-heavy test-native boundary requires test-only authority.');
    }
    await verifyRetiredSamTextHeavyProductionV3DurableClaim(exact.reservation);
    await assertSamCorpusOutputDirectoryAbsentV2({
      outputDirectory: exact.outputDirectory,
      outputClassification: 'fake-test-output',
    });
    const { preparedState, entry, canonicalBytes, canonicalRequestSha256 } =
      verifyExactPreconstructionBindings(exact);
    const constructed = constructTestNativeBoundaryTransport(input.transportFactory);
    counters = constructed.state;
    const adapter = createSamRunPodDirectV3Adapter({
      endpointId: SAM_CORPUS_ENDPOINT_ID,
      expectedExecutionIdentity: SAM_CORPUS_EXECUTION_IDENTITY,
      transport: constructed.transport,
      authorization: createExactAdapterAuthorization(exact, entry),
      configuredImageDigest: SAM_CORPUS_WORKER_IMAGE_DIGEST,
      nowMs: () => exact.authorization.issuedAtMs,
    });
    const response = await adapter.dispatchPrepared(preparedState.directPrepared);
    const actual = snapshotCounters(counters);
    if (
      actual.constructionCount !== 1 ||
      actual.dispatchCount !== 1 ||
      actual.fetchCount !== 1 ||
      constructed.state.capturedRequest === null
    ) {
      throw new TypeError('SAM text-heavy test-native boundary counters drifted.');
    }
    return Object.freeze({
      classification: 'test-only-native-boundary-in-memory-not-sam-output' as const,
      label: SAM_CORPUS_FAKE_OUTPUT_LABEL,
      canonicalRequestByteLength: canonicalBytes.byteLength,
      canonicalRequestSha256,
      discardedSyntheticResponseSha256: response.responseSha256,
      discardedSyntheticCandidateCount: response.candidateCount,
      requestEvidence: constructed.state.capturedRequest,
      transportConstructionCount: 1 as const,
      dispatchCount: 1 as const,
      fetchCount: 1 as const,
      materializationCount: 0 as const,
      networkCalls: 0 as const,
      retryCount: 0 as const,
      providerCallAuthority: false as const,
      providerBillingGuarantee: false as const,
    });
  } catch (error) {
    throw sanitizeExecutionFailure(error, counters, 0);
  }
};

/**
 * Exact text-heavy executor. Global production admission remains disabled; only the distinct,
 * caller-held production authorization and opaque native factory can select the real branch.
 */
export const executeSamTextHeavyProductionV3 = async (input: {
  readonly authorized: SamTextHeavyProductionV3AuthorizedExecution;
  readonly transportFactory: SamTextHeavyProductionV3TransportFactory;
}): Promise<SamTextHeavyProductionV3ExecutionResult> => {
  if (
    typeof input !== 'object' ||
    input === null ||
    JSON.stringify(Object.keys(input).toSorted()) !==
      JSON.stringify(['authorized', 'transportFactory'])
  ) {
    throw new TypeError('SAM text-heavy production execution input is not closed.');
  }
  // Authorization, process state, and output path are consumed synchronously before callbacks.
  const exact = consumeSamTextHeavyProductionV3AuthorizedExecution(input.authorized);
  retireSamTextHeavyProductionV3Output(exact.reservation);
  let counters: TransportFactoryCounters | undefined;
  let materializationCount = 0;
  try {
    const production = exact.environment === 'production-native';
    if (
      production &&
      (Date.now() < exact.authorization.issuedAtMs || Date.now() >= exact.authorization.expiresAtMs)
    ) {
      throw new TypeError('SAM text-heavy production authorization expired before construction.');
    }
    await verifyRetiredSamTextHeavyProductionV3DurableClaim(exact.reservation);
    const outputClassification: SamCorpusOutputClassificationV2 = production
      ? 'real-sam-output'
      : 'fake-test-output';
    await assertSamCorpusOutputDirectoryAbsentV2({
      outputDirectory: exact.outputDirectory,
      outputClassification,
    });
    const { preparedState, entry, canonicalBytes, canonicalRequestSha256 } =
      verifyExactPreconstructionBindings(exact);
    const constructed = constructTransport(exact.environment, input.transportFactory);
    counters = constructed.state;
    const adapterAuthorization = production
      ? createExactAdapterAuthorization(exact, entry)
      : undefined;
    if (
      canonicalizeJson(exact.authorization.identity.executionIdentity) !==
      canonicalizeJson(SAM_CORPUS_EXECUTION_IDENTITY)
    ) {
      throw new TypeError('SAM text-heavy authorization execution identity drifted.');
    }
    const adapter = createSamRunPodDirectV3Adapter({
      endpointId: SAM_CORPUS_ENDPOINT_ID,
      expectedExecutionIdentity: production
        ? SAM_CORPUS_EXECUTION_IDENTITY
        : SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
      transport: constructed.transport,
      ...(production
        ? {
            authorization: adapterAuthorization,
            configuredImageDigest: SAM_CORPUS_WORKER_IMAGE_DIGEST,
            nowMs: Date.now,
          }
        : { fakeTimeoutMs: SAM_CORPUS_CLIENT_TIMEOUT_MS }),
    });
    const startedAt = performance.now();
    const response = await adapter.dispatchPrepared(preparedState.directPrepared);
    const validated = validateSamCorpusVisualResponseV2({
      prepared: exact.prepared,
      response,
      outputClassification,
    });
    materializationCount = 1;
    const testState = testTransportFactories.get(input.transportFactory);
    if (testState?.outcome.kind === 'valid-deterministic-fake-with-output-race') {
      await mkdir(exact.outputDirectory);
    }
    const materialized = await materializeSamCorpusVisualEvaluationV2({
      validated,
      outputDirectory: exact.outputDirectory,
    });
    const artifacts = await verifySamCorpusVisualArtifactSetV2(exact.outputDirectory);
    if (
      materialized.manifestSha256 !== artifacts.manifestSha256 ||
      materialized.inventorySha256 !== artifacts.inventorySha256
    ) {
      throw new TypeError('SAM text-heavy materialization and offline verification diverged.');
    }
    const runtimeMs = performance.now() - startedAt;
    if (!Number.isFinite(runtimeMs) || runtimeMs < 0) {
      throw new TypeError('SAM text-heavy runtime evidence is invalid.');
    }
    const actual = snapshotCounters(counters);
    if (
      actual.constructionCount !== 1 ||
      actual.dispatchCount !== 1 ||
      actual.fetchCount !== (production ? 1 : 0) ||
      materializationCount !== 1
    ) {
      throw new TypeError('SAM text-heavy exact-once control counters drifted.');
    }
    return Object.freeze({
      classification: production
        ? ('validated-real-sam-output' as const)
        : ('provider-free-deterministic-fake' as const),
      canonicalRequestByteLength: canonicalBytes.byteLength,
      canonicalRequestSha256,
      validatedResponseSha256: response.responseSha256,
      artifacts,
      reviewEvidence: bindSamCorpusVisualReviewEvidenceV1(artifacts),
      runtimeMs,
      transportConstructionCount: actual.constructionCount,
      dispatchCount: actual.dispatchCount,
      fetchCount: actual.fetchCount,
      materializationCount,
      retryCount: 0 as const,
      redirectCount: 0 as const,
      pollCount: 0 as const,
      healthRequestCount: 0 as const,
      pingRequestCount: 0 as const,
      queueRequestCount: 0 as const,
      timeoutMs: SAM_CORPUS_CLIENT_TIMEOUT_MS,
      billingEvidence: Object.freeze({
        kind: 'authorization-ceiling-only' as const,
        incrementalCostMaximumMicroUsd: SAM_CORPUS_COST_MAXIMUM_MICRO_USD,
        observedProviderCostMicroUsd: null,
        providerBillingGuarantee: false as const,
      }),
      providerBillingGuarantee: false as const,
    });
  } catch (error) {
    throw sanitizeExecutionFailure(error, counters, materializationCount);
  }
};
