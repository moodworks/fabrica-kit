import type { SamMaskRequest } from '../sam/sam-mask-contracts.js';
import type { SamRawMaskCandidate } from '../sam/sam-mask-postprocess.js';

import {
  SAM_CORPUS_CLIENT_TIMEOUT_MS,
  SAM_CORPUS_COST_MAXIMUM_MICRO_USD,
  SAM_CORPUS_ENDPOINT_ID,
  inspectSamCorpusPreparedRequestV1,
  prepareSamNoTextCorpusRequestV1,
  prepareSamProductCorpusRequestV1,
  prepareSamTextHeavyCorpusRequestV1,
  type SamCorpusPreparedRequestV1,
} from './sam-corpus-evaluation-catalog-v1.js';
import {
  authorizeTestOnlySamCorpusDispatchV1,
  consumeTestOnlySamCorpusAuthorizedDispatchV1,
  mintTestOnlySamCorpusAuthorizationV1,
  type SamCorpusTestOnlyAuthorizationSourcesV1,
} from './sam-corpus-evaluation-authorization-v1.js';
import {
  assertSamCorpusOutputDirectoryAbsentV2,
  materializeSamCorpusVisualEvaluationV2,
  validateSamCorpusVisualResponseV2,
  type SamCorpusMaterializationResultV2,
} from './sam-corpus-visual-evaluation-v2.js';
import { createSamRunPodDirectV3Adapter } from './sam-runpod-direct-v3-adapter.js';
import {
  SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
  createDeterministicSamRunPodDirectV3Transport,
} from './sam-runpod-direct-v3-deterministic-fake-transport.js';

export const SAM_CORPUS_EVALUATION_ACTIVATION_V1 = Object.freeze({
  productionExecutionAuthority: false as const,
  productionAdmissionAuthority: false as const,
  webRouteAuthority: false as const,
  generalAdmissionAuthority: false as const,
  corpusBatchAuthority: false as const,
  providerCallAuthority: false as const,
  dispatchMaximum: 1 as const,
  materializationMaximum: 1 as const,
  retryCount: 0 as const,
  pollCount: 0 as const,
  healthRequestCount: 0 as const,
  pingRequestCount: 0 as const,
  queueRequestCount: 0 as const,
  providerBillingGuarantee: false as const,
});

export interface SamCorpusProviderFreeTransportFactoryV1 {
  readonly purpose: 'deferred-provider-free-sam-corpus-transport-factory-v1';
  readonly networkCalls: 0;
  readonly getConstructionCount: () => number;
  readonly getDispatchCount: () => number;
}

interface TransportFactoryStateV1 {
  readonly candidateCount: number;
  readonly throwAfterDispatch: boolean;
  constructed: boolean;
  constructionCount: number;
  dispatchCount: () => number;
}

const transportFactoryStates = new WeakMap<object, TransportFactoryStateV1>();

const deterministicCandidates = (
  request: SamMaskRequest,
  candidateCount: number,
): readonly SamRawMaskCandidate[] =>
  Array.from({ length: candidateCount }, (_, index) => {
    const width = 8 + (index % 3);
    const height = 8 + index;
    const left = 4 + index * 16;
    const top = 4 + index * 13;
    if (left + width >= request.source.width || top + height >= request.source.height) {
      throw new TypeError('Deterministic SAM corpus mask generator exceeded its fixed fixture.');
    }
    const mask = new Uint8Array(request.source.width * request.source.height);
    for (let y = top; y < top + height; y += 1) {
      mask.fill(1, y * request.source.width + left, y * request.source.width + left + width);
    }
    return Object.freeze({
      mask,
      predictedIou: 0.99 - index * 0.02,
      stabilityScore: 0.98 - index * 0.015,
    });
  });

export const createSamCorpusProviderFreeTransportFactoryV1 = (input?: {
  readonly candidateCount?: number;
  readonly throwAfterDispatch?: boolean;
}): SamCorpusProviderFreeTransportFactoryV1 => {
  const candidateCount = input?.candidateCount ?? 3;
  if (!Number.isInteger(candidateCount) || candidateCount < 0 || candidateCount > 8) {
    throw new TypeError('SAM corpus fake candidate count must be an integer from zero to eight.');
  }
  if (input !== undefined) {
    const keys = Object.keys(input).toSorted();
    if (
      keys.some((key) => key !== 'candidateCount' && key !== 'throwAfterDispatch') ||
      (input.throwAfterDispatch !== undefined && typeof input.throwAfterDispatch !== 'boolean')
    ) {
      throw new TypeError('SAM corpus fake transport factory input is not closed.');
    }
  }
  const state: TransportFactoryStateV1 = {
    candidateCount,
    throwAfterDispatch: input?.throwAfterDispatch ?? false,
    constructed: false,
    constructionCount: 0,
    dispatchCount: () => 0,
  };
  const factory = Object.freeze({
    purpose: 'deferred-provider-free-sam-corpus-transport-factory-v1' as const,
    networkCalls: 0 as const,
    getConstructionCount: () => state.constructionCount,
    getDispatchCount: () => state.dispatchCount(),
  });
  transportFactoryStates.set(factory, state);
  return factory;
};

const constructTransport = (factory: SamCorpusProviderFreeTransportFactoryV1) => {
  const state = transportFactoryStates.get(factory);
  if (state === undefined || state.constructed) {
    throw new TypeError('SAM corpus transport factory is foreign or already consumed.');
  }
  state.constructed = true;
  state.constructionCount += 1;
  const transport = createDeterministicSamRunPodDirectV3Transport({
    rawCandidates: (request) => deterministicCandidates(request, state.candidateCount),
    throwAfterDispatch: state.throwAfterDispatch,
  });
  state.dispatchCount = transport.getCallCount;
  return transport;
};

export interface SamCorpusProviderFreeExecutionInputV1 {
  readonly outputDirectory: string;
  readonly authorizationSources: SamCorpusTestOnlyAuthorizationSourcesV1;
  readonly transportFactory: SamCorpusProviderFreeTransportFactoryV1;
}

export interface SamCorpusProviderFreeExecutionResultV1 {
  readonly fixtureKey: 'text-heavy' | 'no-text';
  readonly artifacts: SamCorpusMaterializationResultV2;
  readonly canonicalRequestByteLength: number;
  readonly canonicalRequestSha256: string;
  readonly validatedResponseSha256: string;
  readonly runtimeMs: number;
  readonly dispatchCount: 1;
  readonly materializationCount: 1;
  readonly retryCount: 0;
  readonly pollCount: 0;
  readonly healthRequestCount: 0;
  readonly pingRequestCount: 0;
  readonly queueRequestCount: 0;
  readonly timeoutMs: typeof SAM_CORPUS_CLIENT_TIMEOUT_MS;
  readonly billingEvidence: {
    readonly kind: 'authorization-ceiling-only';
    readonly costMaximumMicroUsd: typeof SAM_CORPUS_COST_MAXIMUM_MICRO_USD;
    readonly observedProviderCostMicroUsd: null;
    readonly providerBillingGuarantee: false;
  };
  readonly providerBillingGuarantee: false;
}

const assertClosedExecutionInput = (input: SamCorpusProviderFreeExecutionInputV1): void => {
  if (
    typeof input !== 'object' ||
    input === null ||
    JSON.stringify(Object.keys(input).toSorted()) !==
      JSON.stringify(['authorizationSources', 'outputDirectory', 'transportFactory'])
  ) {
    throw new TypeError('SAM corpus execution input is not a strict closed object.');
  }
};

const executeEligible = async (input: {
  readonly fixtureKey: 'text-heavy' | 'no-text';
  readonly prepared: SamCorpusPreparedRequestV1;
  readonly executionInput: SamCorpusProviderFreeExecutionInputV1;
}): Promise<SamCorpusProviderFreeExecutionResultV1> => {
  assertClosedExecutionInput(input.executionInput);
  await assertSamCorpusOutputDirectoryAbsentV2({
    outputDirectory: input.executionInput.outputDirectory,
    outputClassification: 'fake-test-output',
  });
  const authorization = mintTestOnlySamCorpusAuthorizationV1(
    input.prepared,
    input.executionInput.authorizationSources,
  );
  const authorized = authorizeTestOnlySamCorpusDispatchV1({
    prepared: input.prepared,
    authorization,
    sources: input.executionInput.authorizationSources,
  });
  const exact = consumeTestOnlySamCorpusAuthorizedDispatchV1(authorized);
  if (exact.prepared !== input.prepared || exact.authorization !== authorization) {
    throw new TypeError('SAM corpus authorization diverged from its prepared fixture.');
  }
  const transport = constructTransport(input.executionInput.transportFactory);
  if (
    transport.transportKind !== 'deterministic-fake-direct-v3' ||
    transport.secretReferenceName !== null ||
    transport.networkCalls !== 0
  ) {
    throw new TypeError('SAM corpus provider-free transport boundary drifted.');
  }
  const adapter = createSamRunPodDirectV3Adapter({
    endpointId: SAM_CORPUS_ENDPOINT_ID,
    expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
    transport,
    fakeTimeoutMs: SAM_CORPUS_CLIENT_TIMEOUT_MS,
  });
  const startedAt = performance.now();
  const directPrepared = inspectSamCorpusPreparedRequestV1(input.prepared).directPrepared;
  const response = await adapter.dispatchPrepared(directPrepared);
  const validated = validateSamCorpusVisualResponseV2({
    prepared: input.prepared,
    response,
    outputClassification: 'fake-test-output',
  });
  const artifacts = await materializeSamCorpusVisualEvaluationV2({
    validated,
    outputDirectory: input.executionInput.outputDirectory,
  });
  const runtimeMs = performance.now() - startedAt;
  if (!Number.isFinite(runtimeMs) || runtimeMs < 0 || transport.getCallCount() !== 1) {
    throw new TypeError('SAM corpus runtime or exact-once counter drifted.');
  }
  return Object.freeze({
    fixtureKey: input.fixtureKey,
    artifacts,
    canonicalRequestByteLength: input.prepared.canonicalBodyByteLength,
    canonicalRequestSha256: input.prepared.canonicalBodySha256,
    validatedResponseSha256: response.responseSha256,
    runtimeMs,
    dispatchCount: 1 as const,
    materializationCount: 1 as const,
    retryCount: 0 as const,
    pollCount: 0 as const,
    healthRequestCount: 0 as const,
    pingRequestCount: 0 as const,
    queueRequestCount: 0 as const,
    timeoutMs: SAM_CORPUS_CLIENT_TIMEOUT_MS,
    billingEvidence: Object.freeze({
      kind: 'authorization-ceiling-only' as const,
      costMaximumMicroUsd: SAM_CORPUS_COST_MAXIMUM_MICRO_USD,
      observedProviderCostMicroUsd: null,
      providerBillingGuarantee: false as const,
    }),
    providerBillingGuarantee: false as const,
  });
};

export const executeSamTextHeavyCorpusProviderFreeV1 = async (
  input: SamCorpusProviderFreeExecutionInputV1,
): Promise<SamCorpusProviderFreeExecutionResultV1> => {
  const prepared = await prepareSamTextHeavyCorpusRequestV1();
  return executeEligible({ fixtureKey: 'text-heavy', prepared, executionInput: input });
};

export const executeSamNoTextCorpusProviderFreeV1 = async (
  input: SamCorpusProviderFreeExecutionInputV1,
): Promise<SamCorpusProviderFreeExecutionResultV1> => {
  const prepared = await prepareSamNoTextCorpusRequestV1();
  return executeEligible({ fixtureKey: 'no-text', prepared, executionInput: input });
};

/** Capacity is deliberately the first operation; every input capability remains untouched. */
export const executeSamProductCorpusProviderFreeV1 = async (
  input: SamCorpusProviderFreeExecutionInputV1,
): Promise<never> => {
  await prepareSamProductCorpusRequestV1();
  void input;
  throw new TypeError('Unreachable product control state.');
};

export const inspectSamCorpusTransportFactoryCountersV1 = (
  factory: SamCorpusProviderFreeTransportFactoryV1,
): {
  readonly constructionCount: number;
  readonly dispatchCount: number;
  readonly networkCalls: 0;
} => {
  const state = transportFactoryStates.get(factory);
  if (state === undefined) {
    throw new TypeError('SAM corpus transport factory is foreign or reconstructed.');
  }
  return Object.freeze({
    constructionCount: state.constructionCount,
    dispatchCount: state.dispatchCount(),
    networkCalls: 0 as const,
  });
};
