import type { z } from 'zod';

import {
  SAM_MASK_CONTRACT_VERSION,
  SamFakeExecutionIdentitySchema,
  type SamMaskRequest,
  type SamMaskResponse,
} from '../sam/sam-mask-contracts.js';
import { postprocessSamMasks, type SamRawMaskCandidate } from '../sam/sam-mask-postprocess.js';
import { canonicalResponseSha256 } from '../sam/sam-mask-rle.js';
import { parseAndVerifySamMaskRequest } from '../sam/sam-mask-validation.js';
import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import {
  consumeSamRunPodDirectV3DispatchCapability,
  deriveSamRunPodDirectV3Endpoint,
  type SamRunPodDirectV3TransportPort,
  type SamRunPodDirectV3TransportRequest,
  type SamRunPodDirectV3TransportResponse,
} from './sam-runpod-direct-v3-adapter.js';
import { SamRunPodDirectEndpointIdSchema } from './sam-runpod-direct-v3-profiles.js';

export const SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY: z.infer<
  typeof SamFakeExecutionIdentitySchema
> = Object.freeze({
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

export const createDeterministicSamRunPodDirectV3Transport = (input?: {
  readonly rawCandidates?: (request: SamMaskRequest) => readonly SamRawMaskCandidate[];
  readonly waitForAbort?: boolean;
  readonly throwAfterDispatch?: boolean;
  readonly status?: number;
  readonly contentType?: string | null;
  readonly bodyText?: string;
  readonly responseBody?: (response: SamMaskResponse) => unknown;
}): SamRunPodDirectV3TransportPort & {
  readonly getCallCount: () => number;
  readonly getLastRequestBodyText: () => string | null;
  readonly networkCalls: 0;
} => {
  let callCount = 0;
  let lastRequestBodyText: string | null = null;
  return Object.freeze({
    transportKind: 'deterministic-fake-direct-v3' as const,
    secretReferenceName: null,
    networkCalls: 0 as const,
    getCallCount: () => callCount,
    getLastRequestBodyText: () => lastRequestBodyText,
    async dispatch(
      request: SamRunPodDirectV3TransportRequest,
    ): Promise<SamRunPodDirectV3TransportResponse> {
      consumeSamRunPodDirectV3DispatchCapability(request, 'deterministic-fake-direct-v3');
      const match =
        /^https:\/\/([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\.api\.runpod\.ai\/v1\/masks$/u.exec(
          request.endpoint,
        );
      const endpointId = SamRunPodDirectEndpointIdSchema.parse(match?.[1]);
      if (
        request.endpoint !== deriveSamRunPodDirectV3Endpoint(endpointId) ||
        request.method !== 'POST'
      ) {
        throw new TypeError('Deterministic SAM direct transport received a foreign boundary.');
      }
      callCount += 1;
      lastRequestBodyText = request.requestBodyText;
      if (input?.throwAfterDispatch === true) {
        throw new TypeError('Deterministic direct post-dispatch connection loss.');
      }
      if (input?.waitForAbort === true) {
        return new Promise<SamRunPodDirectV3TransportResponse>((_resolve, reject) => {
          const abort = () => reject(new DOMException('Deterministic abort.', 'AbortError'));
          if (request.signal.aborted) abort();
          else request.signal.addEventListener('abort', abort, { once: true });
        });
      }
      const parsedInput: unknown = JSON.parse(request.requestBodyText);
      if (
        typeof parsedInput !== 'object' ||
        parsedInput === null ||
        Array.isArray(parsedInput) ||
        Object.hasOwn(parsedInput, 'input') ||
        Object.hasOwn(parsedInput, 'endpoint') ||
        canonicalizeJson(parsedInput) !== request.requestBodyText
      ) {
        throw new TypeError('Deterministic SAM direct transport received a wrapped request.');
      }
      const { request: parsed } = parseAndVerifySamMaskRequest(parsedInput);
      const result = postprocessSamMasks(parsed, (input?.rawCandidates ?? defaultMasks)(parsed));
      const unsigned: Omit<SamMaskResponse, 'responseSha256'> = {
        contractVersion: SAM_MASK_CONTRACT_VERSION,
        requestId: parsed.requestId,
        workspaceId: parsed.workspaceId,
        jobId: parsed.jobId,
        attemptId: parsed.attemptId,
        sourceSha256: parsed.source.sha256,
        executionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
        timing: { inferenceMs: 0, totalMs: 0 },
        filterSummary: result.filterSummary,
        candidateCount: result.candidates.length,
        candidates: result.candidates,
      };
      const response: SamMaskResponse = {
        ...unsigned,
        responseSha256: canonicalResponseSha256(unsigned),
      };
      return {
        status: input?.status ?? 200,
        contentType:
          input === undefined || input.contentType === undefined
            ? 'application/json'
            : input.contentType,
        bodyText:
          input?.bodyText ??
          JSON.stringify(
            input?.responseBody === undefined ? response : input.responseBody(response),
          ),
      };
    },
  });
};
