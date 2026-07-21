import type { SamMaskResponse } from '../sam/sam-mask-contracts.js';
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
import { SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY } from './sam-runpod-direct-v3-deterministic-fake-transport.js';
import { RUNPOD_API_KEY_REFERENCE } from './sam-runpod-direct-v3-profiles.js';
import {
  SAM_FIRST_INFERENCE_CLIENT_TIMEOUT_MS,
  SAM_FIRST_INFERENCE_ENDPOINT_ID,
  SAM_FIRST_INFERENCE_EXECUTION_IDENTITY,
  SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
  prepareSamFirstInferenceV3Request,
  type SamRunPodDirectV3PreparedRequest,
} from './sam-runpod-direct-v3-request-preparation.js';

export const SAM_FIRST_INFERENCE_EXACT_AUTHORIZATION_PHRASE = 'RUN THE ONE SAM CALL' as const;

export const SAM_FIRST_INFERENCE_ACTIVATION = Object.freeze({
  productionActivated: false as const,
  webRouteActivated: false as const,
  productionAdmissionAuthority: false as const,
  generalDispatchActivated: false as const,
  phaseBActivated: false as const,
  retryCount: 0 as const,
  pollCount: 0 as const,
  healthRequestCount: 0 as const,
  queueRequestCount: 0 as const,
});

export type SamFirstInferenceV3ExecutionInput =
  | {
      readonly mode: 'provider-free-deterministic-fake';
      readonly transport: SamRunPodDirectV3TransportPort;
      readonly testOnlyAuthorizationSources: SamRunPodDirectV3TestOnlyAuthorizationSources;
    }
  | {
      readonly mode: 'explicitly-authorized-native';
      readonly authorizationPhrase: unknown;
      readonly transport: SamRunPodDirectV3TransportPort;
    };

export interface SamFirstInferenceV3ExecutionResult {
  readonly prepared: SamRunPodDirectV3PreparedRequest;
  readonly response: SamMaskResponse;
  readonly transportKind: SamRunPodDirectV3TransportPort['transportKind'];
  readonly authorizationKind: 'deterministic-test-only' | 'production-short-lived';
  readonly dispatchCount: 1;
  readonly retryCount: 0;
  readonly pollCount: 0;
  readonly timeoutMs: typeof SAM_FIRST_INFERENCE_CLIENT_TIMEOUT_MS;
}

/**
 * The only milestone orchestration. Preparation, minting, validation, capability consumption and
 * one adapter call remain in this stack frame; no authorization packet is returned.
 */
export const executeSamFirstInferenceV3 = async (
  input: SamFirstInferenceV3ExecutionInput,
): Promise<SamFirstInferenceV3ExecutionResult> => {
  const native = input.mode === 'explicitly-authorized-native';
  const expectedInputKeys = native
    ? ['authorizationPhrase', 'mode', 'transport']
    : ['mode', 'testOnlyAuthorizationSources', 'transport'];
  if (
    typeof input !== 'object' ||
    input === null ||
    JSON.stringify(Object.keys(input).toSorted()) !== JSON.stringify(expectedInputKeys)
  ) {
    throw new TypeError('The SAM milestone execution input is not a strict closed object.');
  }
  if (
    native &&
    (input.authorizationPhrase !== SAM_FIRST_INFERENCE_EXACT_AUTHORIZATION_PHRASE ||
      input.transport.transportKind !== 'native-fetch-direct-v3' ||
      input.transport.secretReferenceName !== RUNPOD_API_KEY_REFERENCE)
  ) {
    throw new TypeError('The SAM native milestone execution path is not explicitly authorized.');
  }
  if (
    !native &&
    (input.transport.transportKind !== 'deterministic-fake-direct-v3' ||
      input.transport.secretReferenceName !== null)
  ) {
    throw new TypeError(
      'The provider-free SAM milestone requires the deterministic fake transport.',
    );
  }

  const prepared = await prepareSamFirstInferenceV3Request();
  const authorization = native
    ? mintSamFirstInferenceV3Authorization(prepared)
    : mintTestOnlySamFirstInferenceV3Authorization(prepared, input.testOnlyAuthorizationSources);
  const authorized = authorizeSamFirstInferenceV3Dispatch({
    prepared,
    authorization,
    ...(!native ? { testOnlySources: input.testOnlyAuthorizationSources } : {}),
  });
  const exact = consumeSamFirstInferenceV3AuthorizedDispatch(authorized);
  if (exact.prepared !== prepared || exact.authorization !== authorization) {
    throw new TypeError('SAM milestone authorization and preparation diverged.');
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
  return Object.freeze({
    prepared,
    response,
    transportKind: input.transport.transportKind,
    authorizationKind: native ? 'production-short-lived' : 'deterministic-test-only',
    dispatchCount: 1 as const,
    retryCount: 0 as const,
    pollCount: 0 as const,
    timeoutMs: SAM_FIRST_INFERENCE_CLIENT_TIMEOUT_MS,
  });
};
