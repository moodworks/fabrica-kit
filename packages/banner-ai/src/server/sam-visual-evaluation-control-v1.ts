import type { SamMaskRequest } from '../sam/sam-mask-contracts.js';
import type { SamRawMaskCandidate } from '../sam/sam-mask-postprocess.js';

import {
  createSamRunPodDirectV3Adapter,
  type SamRunPodDirectV3TransportPort,
} from './sam-runpod-direct-v3-adapter.js';
import {
  authorizeSamFirstInferenceV3Dispatch,
  consumeSamFirstInferenceV3AuthorizedDispatch,
  mintSamFirstInferenceV3Authorization,
  mintTestOnlySamFirstInferenceV3Authorization,
  type SamRunPodDirectV3TestOnlyAuthorizationSources,
} from './sam-runpod-direct-v3-authorization.js';
import {
  SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
  createDeterministicSamRunPodDirectV3Transport,
} from './sam-runpod-direct-v3-deterministic-fake-transport.js';
import { RUNPOD_API_KEY_REFERENCE } from './sam-runpod-direct-v3-profiles.js';
import {
  SAM_FIRST_INFERENCE_CLIENT_TIMEOUT_MS,
  SAM_FIRST_INFERENCE_COST_MAXIMUM_MICRO_USD,
  SAM_FIRST_INFERENCE_ENDPOINT_ID,
  SAM_FIRST_INFERENCE_EXECUTION_IDENTITY,
  SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
  prepareSamFirstInferenceV3Request,
} from './sam-runpod-direct-v3-request-preparation.js';
import {
  assertSamVisualEvaluationOutputDirectoryV1,
  materializeSamVisualEvaluationV1,
  validateSamVisualEvaluationResponseV1,
  type SamVisualEvaluationMaterializationResultV1,
} from './sam-visual-evaluation-v1.js';

export const SAM_VISUAL_EVALUATION_EXACT_AUTHORIZATION_PHRASE =
  'RUN THE ONE SAM VISUAL CALL' as const;
export const SAM_VISUAL_EVALUATION_INCREMENTAL_COST_MAXIMUM_MICRO_USD =
  SAM_FIRST_INFERENCE_COST_MAXIMUM_MICRO_USD;
export const SAM_VISUAL_EVALUATION_CUMULATIVE_AUTHORIZED_CEILING_MICRO_USD = 500_000 as const;

export const SAM_VISUAL_EVALUATION_ACTIVATION = Object.freeze({
  productionActivated: false as const,
  webRouteActivated: false as const,
  productionAdmissionAuthority: false as const,
  secondPaidCall: true as const,
  dispatchMaximum: 1 as const,
  retryCount: 0 as const,
  pollCount: 0 as const,
  healthRequestCount: 0 as const,
  queueRequestCount: 0 as const,
});

const eightVisualFakeCandidates = (request: SamMaskRequest): readonly SamRawMaskCandidate[] =>
  Array.from({ length: 8 }, (_, index) => {
    const left = 12 + index * 107;
    const right = Math.min(request.source.width - 8, left + 72 + (index % 3) * 4);
    const top = 12 + (index % 4) * 9;
    const bottom = request.source.height - 12 - ((index + 1) % 4) * 7;
    const mask = new Uint8Array(request.source.width * request.source.height);
    for (let y = top; y < bottom; y += 1) {
      mask.fill(1, y * request.source.width + left, y * request.source.width + right);
    }
    return Object.freeze({
      mask,
      predictedIou: 0.99 - index * 0.02,
      stabilityScore: 0.98 - index * 0.015,
    });
  });

export const createSamVisualEvaluationDeterministicFakeTransportV1 = () =>
  createDeterministicSamRunPodDirectV3Transport({
    rawCandidates: eightVisualFakeCandidates,
  });

export type SamVisualEvaluationExecutionInputV1 =
  | {
      readonly mode: 'provider-free-deterministic-fake';
      readonly outputDirectory: string;
      readonly transport: SamRunPodDirectV3TransportPort;
      readonly testOnlyAuthorizationSources: SamRunPodDirectV3TestOnlyAuthorizationSources;
    }
  | {
      readonly mode: 'explicitly-authorized-native';
      readonly authorizationPhrase: unknown;
      readonly outputDirectory: string;
      readonly transport: SamRunPodDirectV3TransportPort;
    };

export interface SamVisualEvaluationExecutionResultV1 {
  readonly artifacts: SamVisualEvaluationMaterializationResultV1;
  readonly canonicalRequestByteLength: number;
  readonly canonicalRequestSha256: string;
  readonly validatedResponseSha256: string;
  readonly transportKind: SamRunPodDirectV3TransportPort['transportKind'];
  readonly authorizationKind: 'deterministic-test-only' | 'fresh-production-short-lived';
  readonly dispatchCount: 1;
  readonly materializationCount: 1;
  readonly retryCount: 0;
  readonly pollCount: 0;
  readonly timeoutMs: typeof SAM_FIRST_INFERENCE_CLIENT_TIMEOUT_MS;
  readonly incrementalCostMaximumMicroUsd: typeof SAM_VISUAL_EVALUATION_INCREMENTAL_COST_MAXIMUM_MICRO_USD;
  readonly cumulativeAuthorizedCeilingMicroUsd: typeof SAM_VISUAL_EVALUATION_CUMULATIVE_AUTHORIZED_CEILING_MICRO_USD;
  readonly providerBillingGuarantee: false;
}

/**
 * The exact-purpose second-call stack. The prepared request remains one object from preparation,
 * through fresh authorization, one dispatch, strict response branding, and one materialization.
 */
export const executeSamVisualEvaluationV1 = async (
  input: SamVisualEvaluationExecutionInputV1,
): Promise<SamVisualEvaluationExecutionResultV1> => {
  const native = input.mode === 'explicitly-authorized-native';
  const expectedInputKeys = native
    ? ['authorizationPhrase', 'mode', 'outputDirectory', 'transport']
    : ['mode', 'outputDirectory', 'testOnlyAuthorizationSources', 'transport'];
  if (
    typeof input !== 'object' ||
    input === null ||
    JSON.stringify(Object.keys(input).toSorted()) !== JSON.stringify(expectedInputKeys)
  ) {
    throw new TypeError('The SAM visual execution input is not a strict closed object.');
  }
  if (
    native &&
    (input.authorizationPhrase !== SAM_VISUAL_EVALUATION_EXACT_AUTHORIZATION_PHRASE ||
      input.transport.transportKind !== 'native-fetch-direct-v3' ||
      input.transport.secretReferenceName !== RUNPOD_API_KEY_REFERENCE)
  ) {
    throw new TypeError('The second paid SAM visual call is not explicitly authorized.');
  }
  if (
    !native &&
    (input.transport.transportKind !== 'deterministic-fake-direct-v3' ||
      input.transport.secretReferenceName !== null)
  ) {
    throw new TypeError('Provider-free SAM visual evaluation requires the fake transport.');
  }

  await assertSamVisualEvaluationOutputDirectoryV1({
    outputDirectory: input.outputDirectory,
    outputClassification: native ? 'real-sam-output' : 'fake-test-output',
  });
  const prepared = await prepareSamFirstInferenceV3Request();

  // Minting deliberately occurs only after output preflight and immediately before dispatch setup.
  const authorization = native
    ? mintSamFirstInferenceV3Authorization(prepared)
    : mintTestOnlySamFirstInferenceV3Authorization(prepared, input.testOnlyAuthorizationSources);
  if (
    authorization.costMaximumMicroUsd !==
      SAM_VISUAL_EVALUATION_INCREMENTAL_COST_MAXIMUM_MICRO_USD ||
    authorization.clientWallTimeoutMs !== SAM_FIRST_INFERENCE_CLIENT_TIMEOUT_MS
  ) {
    throw new TypeError('SAM visual incremental cost or timeout authorization drifted.');
  }
  const authorized = authorizeSamFirstInferenceV3Dispatch({
    prepared,
    authorization,
    ...(!native ? { testOnlySources: input.testOnlyAuthorizationSources } : {}),
  });
  const exact = consumeSamFirstInferenceV3AuthorizedDispatch(authorized);
  if (exact.prepared !== prepared || exact.authorization !== authorization) {
    throw new TypeError('SAM visual authorization and prepared request diverged.');
  }
  const adapter = createSamRunPodDirectV3Adapter({
    endpointId: SAM_FIRST_INFERENCE_ENDPOINT_ID,
    expectedExecutionIdentity: native
      ? SAM_FIRST_INFERENCE_EXECUTION_IDENTITY
      : SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
    transport: input.transport,
    ...(native
      ? {
          authorization,
          configuredImageDigest: SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
        }
      : { fakeTimeoutMs: SAM_FIRST_INFERENCE_CLIENT_TIMEOUT_MS }),
  });
  const response = await adapter.dispatchPrepared(prepared);
  if (!native && response.candidateCount !== 8) {
    throw new TypeError('Provider-free SAM visual evaluation requires exactly eight candidates.');
  }
  const validated = validateSamVisualEvaluationResponseV1({
    prepared,
    response,
    outputClassification: native ? 'real-sam-output' : 'fake-test-output',
  });
  const artifacts = await materializeSamVisualEvaluationV1({
    validated,
    outputDirectory: input.outputDirectory,
  });
  return Object.freeze({
    artifacts,
    canonicalRequestByteLength: prepared.canonicalBodyByteLength,
    canonicalRequestSha256: prepared.canonicalBodySha256,
    validatedResponseSha256: response.responseSha256,
    transportKind: input.transport.transportKind,
    authorizationKind: native ? 'fresh-production-short-lived' : 'deterministic-test-only',
    dispatchCount: 1 as const,
    materializationCount: 1 as const,
    retryCount: 0 as const,
    pollCount: 0 as const,
    timeoutMs: SAM_FIRST_INFERENCE_CLIENT_TIMEOUT_MS,
    incrementalCostMaximumMicroUsd: SAM_VISUAL_EVALUATION_INCREMENTAL_COST_MAXIMUM_MICRO_USD,
    cumulativeAuthorizedCeilingMicroUsd:
      SAM_VISUAL_EVALUATION_CUMULATIVE_AUTHORIZED_CEILING_MICRO_USD,
    providerBillingGuarantee: false as const,
  });
};
