import { z } from 'zod';

import {
  SAM_LIMITS,
  SamLiveExecutionIdentitySchema,
  type SamExecutionIdentity,
  type SamMaskResponse,
} from '../sam/sam-mask-contracts.js';
import {
  parseAndVerifySamMaskRequest,
  parseAndVerifySamMaskResponse,
} from '../sam/sam-mask-validation.js';

export const RUNPOD_API_KEY_REFERENCE = 'RUNPOD_API_KEY' as const;
export const RUNPOD_METHOD = 'POST' as const;
export const RUNPOD_WAIT_MILLISECONDS = 300_000;
export const RUNPOD_EXECUTION_TIMEOUT_MINIMUM_MS = 5_000;
export const RUNPOD_EXECUTION_TIMEOUT_MAXIMUM_MS = 604_800_000;
export const RUNPOD_TTL_MINIMUM_MS = 10_000;
export const RUNPOD_TTL_MAXIMUM_MS = 604_800_000;

const EndpointIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{2,127}$/u);
const ImageDigestSchema = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/u)
  .refine((value) => value !== `sha256:${'0'.repeat(64)}`, 'Image digest must be resolved.');
const WorkerIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/u);
const RunPodTimingSchema = z.int().min(0).max(RUNPOD_EXECUTION_TIMEOUT_MAXIMUM_MS);

const SamLiveAuthorizationSchema = z
  .strictObject({
    kind: z.literal('single-fixture-sam-runpod-v1'),
    authorizationId: z
      .string()
      .uuid()
      .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u),
    endpointId: EndpointIdSchema,
    imageDigest: ImageDigestSchema,
    secretReferenceName: z.literal(RUNPOD_API_KEY_REFERENCE),
    executionIdentity: SamLiveExecutionIdentitySchema,
    fixture: z.strictObject({
      sha256: z.string().regex(/^[0-9a-f]{64}$/u),
      byteSize: z.int().positive(),
      width: z.int().positive(),
      height: z.int().positive(),
    }),
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
    providerCallsMaximum: z.literal(1),
    clientRetryCount: z.literal(0),
    clientWallTimeoutMs: z.int().min(1).max(RUNPOD_WAIT_MILLISECONDS),
    providerExecutionTimeoutMs: z
      .int()
      .min(RUNPOD_EXECUTION_TIMEOUT_MINIMUM_MS)
      .max(RUNPOD_EXECUTION_TIMEOUT_MAXIMUM_MS),
    providerTtlMs: z.int().min(RUNPOD_TTL_MINIMUM_MS).max(RUNPOD_TTL_MAXIMUM_MS),
    costMaximumMicroUsd: z.int().min(1),
    issuedAtMs: z.int().min(0),
    expiresAtMs: z.int().min(1),
    executionAuthorized: z.literal(true),
    productionAdmissionAuthority: z.literal(false),
    webRouteActivated: z.literal(false),
  })
  .readonly();

export type SamLiveAuthorization = z.infer<typeof SamLiveAuthorizationSchema>;

export interface SamRunPodTransportRequest {
  readonly endpoint: string;
  readonly method: typeof RUNPOD_METHOD;
  readonly requestBodyText: string;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly secret: string | null;
  readonly dispatchCapability: object;
}

export interface SamRunPodTransportResponse {
  readonly status: number;
  readonly bodyText: string;
}

export interface SamRunPodTransportPort {
  readonly transportKind: 'deterministic-fake' | 'native-fetch';
  readonly dispatch: (request: SamRunPodTransportRequest) => Promise<SamRunPodTransportResponse>;
}

const issuedCapabilities = new WeakMap<object, SamRunPodTransportPort['transportKind']>();
const consumedCapabilities = new WeakSet<object>();

export const consumeSamRunPodDispatchCapability = (
  request: SamRunPodTransportRequest,
  expectedKind: SamRunPodTransportPort['transportKind'],
): void => {
  if (
    issuedCapabilities.get(request.dispatchCapability) !== expectedKind ||
    consumedCapabilities.has(request.dispatchCapability)
  ) {
    throw new TypeError('SAM transport dispatch capability is foreign or already consumed.');
  }
  consumedCapabilities.add(request.dispatchCapability);
};

export class SamRunPodError extends Error {
  readonly reason:
    | 'DUPLICATE_DISPATCH'
    | 'INDETERMINATE'
    | 'PRE_DISPATCH_CANCELLED'
    | 'PROVIDER_FAILURE'
    | 'RESPONSE_INVALID'
    | 'UNAUTHORIZED';
  readonly retryable = false;

  constructor(reason: SamRunPodError['reason'], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SamRunPodError';
    this.reason = reason;
  }
}

export interface SamRunPodTelemetry {
  readonly event: 'sam-runpod-failed' | 'sam-runpod-succeeded';
  readonly requestId: string;
  readonly attemptId: string;
  readonly endpointId: string;
  readonly status: number | null;
  readonly candidateCount: number | null;
  readonly failureReason: SamRunPodError['reason'] | null;
}

const completedEnvelopeSchema = z
  .strictObject({
    delayTime: RunPodTimingSchema,
    executionTime: RunPodTimingSchema,
    id: z.string().min(1).max(256),
    output: z.unknown().refine((value) => value !== undefined),
    status: z.literal('COMPLETED'),
    workerId: WorkerIdSchema.optional(),
  })
  .readonly();
const failureEnvelopeSchema = z
  .strictObject({
    id: z.string().min(1).max(256),
    status: z.enum(['FAILED', 'CANCELLED', 'TIMED_OUT', 'IN_QUEUE', 'IN_PROGRESS', 'RUNNING']),
    error: z.string().min(1).max(8_192).optional(),
    delayTime: RunPodTimingSchema.optional(),
    executionTime: RunPodTimingSchema.optional(),
    workerId: WorkerIdSchema.optional(),
  })
  .readonly();

const deriveEndpoint = (endpointId: string): string =>
  `https://api.runpod.ai/v2/${EndpointIdSchema.parse(endpointId)}/runsync?wait=${RUNPOD_WAIT_MILLISECONDS}`;
const signalIsAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;

const claims = new Set<string>();
const consumedLiveAuthorizations = new WeakSet<object>();
const consumedLiveAuthorizationIds = new Set<string>();

export const createSamRunPodAdapter = (input: {
  readonly endpointId: string;
  readonly expectedExecutionIdentity: SamExecutionIdentity;
  readonly transport: SamRunPodTransportPort;
  readonly authorization?: SamLiveAuthorization;
  readonly configuredImageDigest?: string;
  readonly configuredClientWallTimeoutMs?: number;
  readonly configuredProviderExecutionTimeoutMs?: number;
  readonly configuredProviderTtlMs?: number;
  readonly fakeTimeoutMs?: number;
  readonly nowMs?: () => number;
  readonly telemetry?: (event: SamRunPodTelemetry) => void;
}) => {
  const endpointId = EndpointIdSchema.parse(input.endpointId);
  const expectedKind =
    input.transport.transportKind === 'native-fetch' ? 'meta-sam2.1' : 'deterministic-fake';
  if (input.expectedExecutionIdentity.kind !== expectedKind) {
    throw new TypeError('SAM execution identity and transport kind disagree.');
  }
  const liveAuthorization =
    input.transport.transportKind === 'native-fetch'
      ? SamLiveAuthorizationSchema.parse(input.authorization)
      : undefined;
  const configuredImageDigest =
    input.transport.transportKind === 'native-fetch'
      ? ImageDigestSchema.parse(input.configuredImageDigest)
      : undefined;
  const configuredClientWallTimeoutMs =
    input.transport.transportKind === 'native-fetch'
      ? z.int().min(1).max(RUNPOD_WAIT_MILLISECONDS).parse(input.configuredClientWallTimeoutMs)
      : undefined;
  const configuredProviderExecutionTimeoutMs =
    input.transport.transportKind === 'native-fetch'
      ? z
          .int()
          .min(RUNPOD_EXECUTION_TIMEOUT_MINIMUM_MS)
          .max(RUNPOD_EXECUTION_TIMEOUT_MAXIMUM_MS)
          .parse(input.configuredProviderExecutionTimeoutMs)
      : undefined;
  const configuredProviderTtlMs =
    input.transport.transportKind === 'native-fetch'
      ? z
          .int()
          .min(RUNPOD_TTL_MINIMUM_MS)
          .max(RUNPOD_TTL_MAXIMUM_MS)
          .parse(input.configuredProviderTtlMs)
      : undefined;
  if (
    input.transport.transportKind === 'native-fetch' &&
    (input.authorization === undefined ||
      liveAuthorization === undefined ||
      liveAuthorization.endpointId !== endpointId ||
      liveAuthorization.imageDigest !== configuredImageDigest ||
      liveAuthorization.clientWallTimeoutMs !== configuredClientWallTimeoutMs ||
      liveAuthorization.providerExecutionTimeoutMs !== configuredProviderExecutionTimeoutMs ||
      liveAuthorization.providerTtlMs !== configuredProviderTtlMs ||
      JSON.stringify(liveAuthorization.executionIdentity) !==
        JSON.stringify(input.expectedExecutionIdentity))
  ) {
    throw new TypeError('Native SAM adapter construction requires exact live authorization.');
  }
  const fakeTimeoutMs =
    input.fakeTimeoutMs === undefined
      ? 30_000
      : z.int().min(1).max(30_000).parse(input.fakeTimeoutMs);
  const nowMs = input.nowMs ?? Date.now;

  return Object.freeze({
    async generate(
      requestInput: unknown,
      secret: string | null,
      options?: { readonly signal?: AbortSignal },
    ): Promise<SamMaskResponse> {
      const { request } = parseAndVerifySamMaskRequest(requestInput);
      const claim = `${request.workspaceId}:${request.jobId}:${request.attemptId}`;
      if (claims.has(claim)) {
        throw new SamRunPodError(
          'DUPLICATE_DISPATCH',
          'This process has already claimed the SAM job attempt.',
        );
      }
      if (signalIsAborted(options?.signal)) {
        throw new SamRunPodError(
          'PRE_DISPATCH_CANCELLED',
          'SAM request was cancelled before provider dispatch.',
        );
      }

      if (input.transport.transportKind === 'native-fetch') {
        const authorization = liveAuthorization!;
        const currentTime = nowMs();
        if (
          secret === null ||
          secret.length < 1 ||
          authorization.endpointId !== endpointId ||
          authorization.executionIdentity.checkpointSha256 !==
            (input.expectedExecutionIdentity.kind === 'meta-sam2.1'
              ? input.expectedExecutionIdentity.checkpointSha256
              : '') ||
          authorization.issuedAtMs >= authorization.expiresAtMs ||
          authorization.issuedAtMs > currentTime ||
          currentTime >= authorization.expiresAtMs ||
          request.segmentation.mode !== 'automatic-candidates' ||
          authorization.fixture.sha256 !== request.source.sha256 ||
          authorization.fixture.byteSize !== request.source.byteSize ||
          authorization.fixture.width !== request.source.width ||
          authorization.fixture.height !== request.source.height ||
          authorization.requestLimits.minMaskAreaPixels !== request.limits.minMaskAreaPixels ||
          authorization.requestLimits.maxCandidates !== request.limits.maxCandidates ||
          authorization.output.maskEncoding !== request.output.maskEncoding
        ) {
          throw new SamRunPodError(
            'UNAUTHORIZED',
            'SAM live execution authorization is absent or stale.',
          );
        }
        if (
          typeof input.authorization !== 'object' ||
          input.authorization === null ||
          consumedLiveAuthorizations.has(input.authorization) ||
          consumedLiveAuthorizationIds.has(authorization.authorizationId)
        ) {
          throw new SamRunPodError(
            'UNAUTHORIZED',
            'SAM live execution authorization was already consumed.',
          );
        }
      } else if (secret !== null || input.authorization !== undefined) {
        throw new SamRunPodError(
          'UNAUTHORIZED',
          'Deterministic SAM transport accepts no secret or live authorization.',
        );
      }

      const body = JSON.stringify(
        input.transport.transportKind === 'native-fetch'
          ? {
              input: request,
              policy: {
                executionTimeout: configuredProviderExecutionTimeoutMs!,
                ttl: configuredProviderTtlMs!,
              },
            }
          : { input: request },
      );
      if (
        Buffer.byteLength(body, 'utf8') > SAM_LIMITS.wrappedRequestJsonBytes ||
        Object.hasOwn(request, 'endpoint')
      ) {
        throw new SamRunPodError(
          'UNAUTHORIZED',
          'SAM native request body is oversized or contains endpoint authority.',
        );
      }
      const controller = new AbortController();
      const timeoutMs =
        input.transport.transportKind === 'native-fetch'
          ? SamLiveAuthorizationSchema.parse(input.authorization).clientWallTimeoutMs
          : fakeTimeoutMs;
      const forwardAbort = () =>
        controller.abort(
          options?.signal?.reason ?? new DOMException('SAM cancellation.', 'AbortError'),
        );
      options?.signal?.addEventListener('abort', forwardAbort, { once: true });
      if (signalIsAborted(options?.signal)) {
        options?.signal?.removeEventListener('abort', forwardAbort);
        throw new SamRunPodError(
          'PRE_DISPATCH_CANCELLED',
          'SAM request was cancelled before provider dispatch.',
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
      if (
        input.transport.transportKind === 'native-fetch' &&
        typeof input.authorization === 'object' &&
        input.authorization !== null
      ) {
        consumedLiveAuthorizations.add(input.authorization);
        consumedLiveAuthorizationIds.add(liveAuthorization!.authorizationId);
      }
      try {
        let transportResponse: SamRunPodTransportResponse;
        try {
          transportResponse = await input.transport.dispatch({
            endpoint: deriveEndpoint(endpointId),
            method: RUNPOD_METHOD,
            requestBodyText: body,
            signal: controller.signal,
            timeoutMs,
            secret,
            dispatchCapability: capability,
          });
        } catch (error) {
          if (input.transport.transportKind === 'native-fetch') {
            throw new SamRunPodError(
              'INDETERMINATE',
              'Native SAM transport rejected after dispatch; remote completion is unknown.',
              { cause: error },
            );
          }
          throw error;
        }
        status = transportResponse.status;
        if (
          Buffer.byteLength(transportResponse.bodyText, 'utf8') > SAM_LIMITS.providerEnvelopeBytes
        ) {
          throw new TypeError('RunPod response exceeded the bounded reader limit.');
        }
        if (transportResponse.status < 200 || transportResponse.status > 299) {
          throw new SamRunPodError(
            'PROVIDER_FAILURE',
            'RunPod returned a non-success HTTP status.',
          );
        }
        const parsed: unknown = JSON.parse(transportResponse.bodyText);
        const completed = completedEnvelopeSchema.safeParse(parsed);
        if (!completed.success) {
          const failed = failureEnvelopeSchema.safeParse(parsed);
          if (failed.success) {
            if (['TIMED_OUT', 'IN_QUEUE', 'IN_PROGRESS', 'RUNNING'].includes(failed.data.status)) {
              throw new SamRunPodError(
                'INDETERMINATE',
                `RunPod returned ${failed.data.status}; remote completion is unknown.`,
              );
            }
            throw new SamRunPodError(
              'PROVIDER_FAILURE',
              `RunPod returned terminal/non-completed status ${failed.data.status}.`,
            );
          }
          throw new TypeError('RunPod envelope is not a strict supported variant.');
        }
        const response = parseAndVerifySamMaskResponse({
          response: completed.data.output,
          request,
          expectedExecutionKind: expectedKind,
        });
        if (
          JSON.stringify(response.executionIdentity) !==
          JSON.stringify(input.expectedExecutionIdentity)
        ) {
          throw new TypeError('RunPod response model identity differs from configured identity.');
        }
        input.telemetry?.({
          event: 'sam-runpod-succeeded',
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
          error instanceof SamRunPodError
            ? error
            : controller.signal.aborted ||
                (error instanceof DOMException && error.name === 'AbortError')
              ? new SamRunPodError(
                  'INDETERMINATE',
                  'SAM dispatch was aborted after claim; remote completion is unknown.',
                  { cause: error },
                )
              : new SamRunPodError(
                  'RESPONSE_INVALID',
                  'SAM provider response failed closed validation.',
                  {
                    cause: error,
                  },
                );
        input.telemetry?.({
          event: 'sam-runpod-failed',
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
    },
  });
};

/**
 * Duplicate protection above is intentionally process-local. Production activation additionally
 * requires a durable job/attempt/provider-dispatch claim before calling this adapter.
 */
