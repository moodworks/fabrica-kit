import { z } from 'zod';

import {
  SAM_LIMITS,
  SamExecutionIdentitySchema,
  SamWorkerImageDigestSchema,
  type SamExecutionIdentity,
  type SamMaskResponse,
} from '../sam/sam-mask-contracts.js';
import { parseAndVerifySamMaskResponse } from '../sam/sam-mask-validation.js';
import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import {
  RUNPOD_API_KEY_REFERENCE,
  RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT_MS,
  RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS,
  RUNPOD_DIRECT_METHOD,
  RUNPOD_DIRECT_TIMEOUT_MAXIMUM_MS,
  SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3_SHA256,
  SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V3_SHA256,
  SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
  SamRunPodDirectEndpointIdSchema,
  SamRunPodDirectV3AuthorizationSchema,
  deriveSamRunPodDirectV3Endpoint as deriveEndpoint,
  type SamRunPodDirectV3Authorization,
} from './sam-runpod-direct-v3-profiles.js';
import {
  inspectSamRunPodDirectV3PreparedRequest,
  prepareSamRunPodDirectV3Request,
  type SamRunPodDirectV3PreparedRequest,
} from './sam-runpod-direct-v3-request-preparation.js';

export const deriveSamRunPodDirectV3Endpoint = deriveEndpoint;

export interface SamRunPodDirectV3TransportRequest {
  readonly endpoint: string;
  readonly method: typeof RUNPOD_DIRECT_METHOD;
  readonly requestBodyText: string;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly dispatchCapability: object;
}

export interface SamRunPodDirectV3TransportResponse {
  readonly status: number;
  readonly contentType: string | null;
  readonly bodyText: string;
}

export interface SamRunPodDirectV3TransportPort {
  readonly transportKind: 'deterministic-fake-direct-v3' | 'native-fetch-direct-v3';
  readonly secretReferenceName: typeof RUNPOD_API_KEY_REFERENCE | null;
  readonly dispatch: (
    request: SamRunPodDirectV3TransportRequest,
  ) => Promise<SamRunPodDirectV3TransportResponse>;
}

const issuedCapabilities = new WeakMap<object, SamRunPodDirectV3TransportPort['transportKind']>();
const consumedCapabilities = new WeakSet<object>();

export const consumeSamRunPodDirectV3DispatchCapability = (
  request: SamRunPodDirectV3TransportRequest,
  expectedKind: SamRunPodDirectV3TransportPort['transportKind'],
): void => {
  if (
    issuedCapabilities.get(request.dispatchCapability) !== expectedKind ||
    consumedCapabilities.has(request.dispatchCapability)
  ) {
    throw new TypeError('SAM direct transport capability is foreign or already consumed.');
  }
  consumedCapabilities.add(request.dispatchCapability);
};

export class SamRunPodDirectV3Error extends Error {
  readonly reason:
    | 'DUPLICATE_DISPATCH'
    | 'INDETERMINATE'
    | 'PRE_DISPATCH_CANCELLED'
    | 'PROVIDER_FAILURE'
    | 'RESPONSE_INVALID'
    | 'UNAUTHORIZED';
  readonly retryable = false;

  constructor(reason: SamRunPodDirectV3Error['reason'], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SamRunPodDirectV3Error';
    this.reason = reason;
  }
}

export interface SamRunPodDirectV3Telemetry {
  readonly event: 'sam-runpod-direct-failed' | 'sam-runpod-direct-succeeded';
  readonly requestId: string;
  readonly attemptId: string;
  readonly endpointId: string;
  readonly status: number | null;
  readonly candidateCount: number | null;
  readonly failureReason: SamRunPodDirectV3Error['reason'] | null;
}

const claims = new Set<string>();
const consumedLiveAuthorizationObjects = new WeakSet<object>();
const consumedLiveAuthorizationIds = new Set<string>();
const signalIsAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;
const identitiesMatch = (left: SamExecutionIdentity, right: SamExecutionIdentity): boolean =>
  canonicalizeJson(left) === canonicalizeJson(right);

const assertEvidenceAndAuthorizationWindow = (
  authorization: SamRunPodDirectV3Authorization,
  currentTime: number,
): void => {
  if (
    !Number.isSafeInteger(currentTime) ||
    currentTime < RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS ||
    currentTime >= RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT_MS ||
    authorization.issuedAtMs < RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS ||
    authorization.issuedAtMs >= authorization.expiresAtMs ||
    authorization.expiresAtMs > RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT_MS ||
    authorization.issuedAtMs > currentTime ||
    currentTime >= authorization.expiresAtMs
  ) {
    throw new SamRunPodDirectV3Error(
      'UNAUTHORIZED',
      'SAM direct execution evidence or authorization is absent, stale, or not yet valid.',
    );
  }
};

export const createSamRunPodDirectV3Adapter = (input: {
  readonly endpointId: string;
  readonly expectedExecutionIdentity: SamExecutionIdentity;
  readonly transport: SamRunPodDirectV3TransportPort;
  readonly authorization?: unknown;
  readonly configuredImageDigest?: string;
  readonly fakeTimeoutMs?: number;
  readonly nowMs?: () => number;
  readonly telemetry?: (event: SamRunPodDirectV3Telemetry) => void;
}) => {
  const endpointId = SamRunPodDirectEndpointIdSchema.parse(input.endpointId);
  const endpoint = deriveSamRunPodDirectV3Endpoint(endpointId);
  const expectedExecutionIdentity = SamExecutionIdentitySchema.parse(
    input.expectedExecutionIdentity,
  );
  const native = input.transport.transportKind === 'native-fetch-direct-v3';
  const expectedKind = native ? 'meta-sam2.1' : 'deterministic-fake';
  if (
    expectedExecutionIdentity.kind !== expectedKind ||
    input.transport.secretReferenceName !== (native ? RUNPOD_API_KEY_REFERENCE : null)
  ) {
    throw new TypeError('SAM direct execution identity and transport configuration disagree.');
  }
  const nowMs = input.nowMs ?? Date.now;
  let liveAuthorization: SamRunPodDirectV3Authorization | undefined;
  let configuredImageDigest: string | undefined;
  if (native) {
    liveAuthorization = SamRunPodDirectV3AuthorizationSchema.parse(input.authorization);
    configuredImageDigest = SamWorkerImageDigestSchema.parse(input.configuredImageDigest);
    assertEvidenceAndAuthorizationWindow(liveAuthorization, nowMs());
    if (
      liveAuthorization.endpointId !== endpointId ||
      liveAuthorization.imageDigest !== configuredImageDigest ||
      expectedExecutionIdentity.kind !== 'meta-sam2.1' ||
      expectedExecutionIdentity.workerImageDigest !== configuredImageDigest ||
      liveAuthorization.hostingProfileSha256 !== SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256 ||
      liveAuthorization.adapterProfileSha256 !== SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3_SHA256 ||
      liveAuthorization.authorizationProfileSha256 !==
        SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V3_SHA256 ||
      !identitiesMatch(liveAuthorization.executionIdentity, expectedExecutionIdentity)
    ) {
      throw new TypeError('Native SAM direct construction requires exact reviewed authorization.');
    }
  } else if (input.authorization !== undefined || input.configuredImageDigest !== undefined) {
    throw new TypeError('Deterministic SAM direct construction accepts no live authorization.');
  }
  const fakeTimeoutMs =
    input.fakeTimeoutMs === undefined
      ? 30_000
      : z.int().min(1).max(RUNPOD_DIRECT_TIMEOUT_MAXIMUM_MS).parse(input.fakeTimeoutMs);

  const dispatchPrepared = async (
    prepared: SamRunPodDirectV3PreparedRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<SamMaskResponse> => {
    const preparedState = inspectSamRunPodDirectV3PreparedRequest(prepared);
    const request = preparedState.request;
    if (
      preparedState.endpointId !== endpointId ||
      preparedState.endpoint !== endpoint ||
      (native && preparedState.workerImageDigest !== configuredImageDigest)
    ) {
      throw new SamRunPodDirectV3Error(
        'UNAUTHORIZED',
        'SAM direct prepared request differs from adapter configuration.',
      );
    }
    const claim = `${request.workspaceId}:${request.jobId}:${request.attemptId}`;
    if (claims.has(claim)) {
      throw new SamRunPodDirectV3Error(
        'DUPLICATE_DISPATCH',
        'This process has already claimed the SAM job attempt.',
      );
    }
    if (signalIsAborted(options?.signal)) {
      throw new SamRunPodDirectV3Error(
        'PRE_DISPATCH_CANCELLED',
        'SAM direct request was cancelled before dispatch.',
      );
    }

    if (native) {
      const authorization = liveAuthorization!;
      assertEvidenceAndAuthorizationWindow(authorization, nowMs());
      if (
        request.segmentation.mode !== 'automatic-candidates' ||
        authorization.fixture.sha256 !== request.source.sha256 ||
        authorization.fixture.byteSize !== request.source.byteSize ||
        authorization.fixture.width !== request.source.width ||
        authorization.fixture.height !== request.source.height ||
        authorization.requestLimits.minMaskAreaPixels !== request.limits.minMaskAreaPixels ||
        authorization.requestLimits.maxCandidates !== request.limits.maxCandidates ||
        authorization.output.maskEncoding !== request.output.maskEncoding ||
        typeof input.authorization !== 'object' ||
        input.authorization === null ||
        consumedLiveAuthorizationObjects.has(input.authorization) ||
        consumedLiveAuthorizationIds.has(authorization.authorizationId)
      ) {
        throw new SamRunPodDirectV3Error(
          'UNAUTHORIZED',
          'SAM direct execution authorization is absent, consumed, or request-inexact.',
        );
      }
    }

    const requestBodyText = preparedState.canonicalBodyText;

    const controller = new AbortController();
    const timeoutMs = native ? liveAuthorization!.clientWallTimeoutMs : fakeTimeoutMs;
    const forwardAbort = () =>
      controller.abort(
        options?.signal?.reason ?? new DOMException('SAM cancellation.', 'AbortError'),
      );
    options?.signal?.addEventListener('abort', forwardAbort, { once: true });
    if (signalIsAborted(options?.signal)) {
      options?.signal?.removeEventListener('abort', forwardAbort);
      throw new SamRunPodDirectV3Error(
        'PRE_DISPATCH_CANCELLED',
        'SAM direct request was cancelled before dispatch.',
      );
    }
    const timer = setTimeout(
      () => controller.abort(new DOMException('SAM timeout.', 'TimeoutError')),
      timeoutMs,
    );
    const capability = {};
    issuedCapabilities.set(capability, input.transport.transportKind);
    let status: number | null = null;
    claims.add(claim);
    if (native && typeof input.authorization === 'object' && input.authorization !== null) {
      consumedLiveAuthorizationObjects.add(input.authorization);
      consumedLiveAuthorizationIds.add(liveAuthorization!.authorizationId);
    }

    try {
      let transportResponse: SamRunPodDirectV3TransportResponse;
      try {
        transportResponse = await input.transport.dispatch({
          endpoint,
          method: RUNPOD_DIRECT_METHOD,
          requestBodyText,
          signal: controller.signal,
          timeoutMs,
          dispatchCapability: capability,
        });
      } catch (error) {
        throw new SamRunPodDirectV3Error(
          'INDETERMINATE',
          'SAM direct dispatch failed after claim; remote completion is unknown.',
          { cause: error },
        );
      }
      if (controller.signal.aborted) {
        throw new SamRunPodDirectV3Error(
          'INDETERMINATE',
          'SAM direct dispatch ended after timeout or cancellation.',
        );
      }
      status = transportResponse.status;
      if (!Number.isInteger(status) || status < 100 || status > 599) {
        throw new TypeError('SAM direct transport returned an invalid HTTP status.');
      }
      if (status >= 500) {
        throw new SamRunPodDirectV3Error(
          'INDETERMINATE',
          'SAM direct gateway/server failure leaves completion unknown.',
        );
      }
      if (status >= 400) {
        throw new SamRunPodDirectV3Error(
          'PROVIDER_FAILURE',
          'SAM direct worker rejected the request.',
        );
      }
      if (status !== 200) {
        throw new TypeError('SAM direct worker returned an unsupported HTTP status.');
      }
      if (
        transportResponse.contentType !== 'application/json' ||
        typeof transportResponse.bodyText !== 'string' ||
        Buffer.byteLength(transportResponse.bodyText, 'utf8') > SAM_LIMITS.responseJsonBytes
      ) {
        throw new TypeError('SAM direct response media type or byte budget is invalid.');
      }
      const parsed: unknown = JSON.parse(transportResponse.bodyText);
      const response = parseAndVerifySamMaskResponse({
        response: parsed,
        request,
        expectedExecutionKind: expectedKind,
      });
      if (
        !identitiesMatch(response.executionIdentity, expectedExecutionIdentity) ||
        (native &&
          (response.executionIdentity.kind !== 'meta-sam2.1' ||
            response.executionIdentity.workerImageDigest !== configuredImageDigest))
      ) {
        throw new TypeError('SAM direct response model identity differs from configuration.');
      }
      input.telemetry?.({
        event: 'sam-runpod-direct-succeeded',
        requestId: request.requestId,
        attemptId: request.attemptId,
        endpointId,
        status,
        candidateCount: response.candidateCount,
        failureReason: null,
      });
      return response;
    } catch (error) {
      const mapped =
        error instanceof SamRunPodDirectV3Error
          ? error
          : controller.signal.aborted ||
              (error instanceof DOMException && error.name === 'AbortError')
            ? new SamRunPodDirectV3Error(
                'INDETERMINATE',
                'SAM direct dispatch was interrupted after claim.',
                { cause: error },
              )
            : new SamRunPodDirectV3Error(
                'RESPONSE_INVALID',
                'SAM direct response failed closed validation.',
                { cause: error },
              );
      input.telemetry?.({
        event: 'sam-runpod-direct-failed',
        requestId: request.requestId,
        attemptId: request.attemptId,
        endpointId,
        status,
        candidateCount: null,
        failureReason: mapped.reason,
      });
      throw mapped;
    } finally {
      clearTimeout(timer);
      options?.signal?.removeEventListener('abort', forwardAbort);
    }
  };

  return Object.freeze({
    async generate(
      requestInput: unknown,
      options?: { readonly signal?: AbortSignal },
    ): Promise<SamMaskResponse> {
      const prepared = prepareSamRunPodDirectV3Request({
        endpointId,
        requestInput,
        ...(native ? { workerImageDigest: configuredImageDigest! } : {}),
      });
      return dispatchPrepared(prepared, options);
    },
    dispatchPrepared,
  });
};

/**
 * The duplicate guard is intentionally process-local. Production activation still requires the
 * repository's durable job/attempt/provider-usage claim before calling this server-only adapter.
 */
