import {
  SAM_MASK_CONTRACT_VERSION,
  SamFakeExecutionIdentitySchema,
  type SamMaskRequest,
  type SamMaskResponse,
} from '../sam/sam-mask-contracts.js';
import { canonicalResponseSha256 } from '../sam/sam-mask-rle.js';
import { postprocessSamMasks, type SamRawMaskCandidate } from '../sam/sam-mask-postprocess.js';
import { parseAndVerifySamMaskRequest } from '../sam/sam-mask-validation.js';
import {
  consumeSamRunPodDispatchCapability,
  type SamRunPodTransportRequest,
  type SamRunPodTransportResponse,
  type SamRunPodTransportPort,
} from './sam-runpod-adapter.js';
import type { z } from 'zod';

export const SAM_DETERMINISTIC_FAKE_IDENTITY: z.infer<typeof SamFakeExecutionIdentitySchema> =
  Object.freeze({
    kind: 'deterministic-fake',
    engineId: 'fabrica-code-mask-engine-v1',
    definitionSha256: '711d087a27ca497fdbbb9bee07603a89ce4bc14f4357c96295467a2bdfe45dd9',
    notice: 'NOT_SAM_OUTPUT',
  });

const defaultMasks = (request: SamMaskRequest): readonly SamRawMaskCandidate[] => {
  const { width, height } = request.source;
  const rectangle = (xStart: number, yStart: number, xEnd: number, yEnd: number): Uint8Array => {
    const mask = new Uint8Array(width * height);
    const left = Math.max(0, Math.min(width - 1, xStart));
    const top = Math.max(0, Math.min(height - 1, yStart));
    const right = Math.max(left + 1, Math.min(width, xEnd));
    const bottom = Math.max(top + 1, Math.min(height, yEnd));
    for (let y = top; y < bottom; y += 1) {
      mask.fill(1, y * width + left, y * width + right);
    }
    return mask;
  };
  return [
    {
      mask: rectangle(
        Math.floor(width / 32),
        Math.floor(height / 10),
        Math.ceil(width / 3),
        Math.ceil((height * 9) / 10),
      ),
      predictedIou: 0.93,
      stabilityScore: 0.97,
    },
    {
      mask: rectangle(
        Math.floor(width / 3),
        Math.floor(height / 6),
        Math.ceil((width * 2) / 3),
        Math.ceil((height * 5) / 6),
      ),
      predictedIou: 0.89,
      stabilityScore: 0.95,
    },
    {
      mask: rectangle(
        Math.floor((width * 2) / 3),
        Math.floor(height / 12),
        Math.ceil((width * 31) / 32),
        Math.ceil((height * 11) / 12),
      ),
      predictedIou: 0.87,
      stabilityScore: 0.96,
    },
  ];
};

export const createDeterministicSamRunPodTransport = (input?: {
  readonly rawCandidates?: (request: SamMaskRequest) => readonly SamRawMaskCandidate[];
  readonly waitForAbort?: boolean;
  readonly responseVariant?:
    | {
        readonly kind: 'completed';
        readonly delayTime?: number;
        readonly executionTime?: number;
        readonly workerId?: string;
        readonly includeUnknownField?: boolean;
        readonly omitOutput?: boolean;
      }
    | {
        readonly kind: 'non-completed';
        readonly status:
          'CANCELLED' | 'FAILED' | 'IN_PROGRESS' | 'IN_QUEUE' | 'RUNNING' | 'TIMED_OUT';
        readonly delayTime?: number;
        readonly executionTime?: number;
        readonly workerId?: string;
        readonly error?: string;
        readonly includeUnknownField?: boolean;
      };
}): SamRunPodTransportPort & { readonly getCallCount: () => number; readonly networkCalls: 0 } => {
  let callCount = 0;
  return Object.freeze({
    transportKind: 'deterministic-fake' as const,
    networkCalls: 0 as const,
    getCallCount: () => callCount,
    async dispatch(request: SamRunPodTransportRequest): Promise<SamRunPodTransportResponse> {
      consumeSamRunPodDispatchCapability(request, 'deterministic-fake');
      if (
        request.secret !== null ||
        request.method !== 'POST' ||
        !/^https:\/\/api\.runpod\.ai\/v2\/[A-Za-z0-9_-]+\/runsync\?wait=300000$/u.test(
          request.endpoint,
        )
      ) {
        throw new TypeError('Deterministic SAM transport received a foreign dispatch boundary.');
      }
      callCount += 1;
      if (input?.waitForAbort === true) {
        return new Promise<SamRunPodTransportResponse>((_resolve, reject) => {
          const abort = () => reject(new DOMException('Deterministic abort.', 'AbortError'));
          if (request.signal.aborted) abort();
          else request.signal.addEventListener('abort', abort, { once: true });
        });
      }
      const wrapper = JSON.parse(request.requestBodyText) as { readonly input?: unknown };
      if (
        Object.keys(wrapper).length !== 1 ||
        !Object.hasOwn(wrapper, 'input') ||
        Object.hasOwn(wrapper.input as object, 'endpoint')
      ) {
        throw new TypeError('Deterministic SAM transport received a drifted wrapper.');
      }
      const { request: parsed } = parseAndVerifySamMaskRequest(wrapper.input);
      const result = postprocessSamMasks(parsed, (input?.rawCandidates ?? defaultMasks)(parsed));
      const unsigned: Omit<SamMaskResponse, 'responseSha256'> = {
        contractVersion: SAM_MASK_CONTRACT_VERSION,
        requestId: parsed.requestId,
        workspaceId: parsed.workspaceId,
        jobId: parsed.jobId,
        attemptId: parsed.attemptId,
        sourceSha256: parsed.source.sha256,
        executionIdentity: SAM_DETERMINISTIC_FAKE_IDENTITY,
        timing: { inferenceMs: 0, totalMs: 0 },
        filterSummary: result.filterSummary,
        candidateCount: result.candidates.length,
        candidates: result.candidates,
      };
      const output: SamMaskResponse = {
        ...unsigned,
        responseSha256: canonicalResponseSha256(unsigned),
      };
      const variant = input?.responseVariant;
      if (variant?.kind === 'non-completed') {
        return {
          status: 200,
          bodyText: JSON.stringify({
            id: `fake-runpod-job-${callCount}`,
            status: variant.status,
            ...(variant.delayTime === undefined ? {} : { delayTime: variant.delayTime }),
            ...(variant.executionTime === undefined
              ? {}
              : { executionTime: variant.executionTime }),
            ...(variant.workerId === undefined ? {} : { workerId: variant.workerId }),
            ...(variant.error === undefined ? {} : { error: variant.error }),
            ...(variant.includeUnknownField === true ? { unknown: true } : {}),
          }),
        };
      }
      return {
        status: 200,
        bodyText: JSON.stringify({
          delayTime: variant?.delayTime ?? 0,
          executionTime: variant?.executionTime ?? 0,
          id: `fake-runpod-job-${callCount}`,
          ...(variant?.omitOutput === true ? {} : { output }),
          status: 'COMPLETED',
          ...(variant?.workerId === undefined ? {} : { workerId: variant.workerId }),
          ...(variant?.includeUnknownField === true ? { unknown: true } : {}),
        }),
      };
    },
  });
};
