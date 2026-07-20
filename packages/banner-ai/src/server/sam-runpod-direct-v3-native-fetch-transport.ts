import { z } from 'zod';

import { SAM_LIMITS, SamWorkerImageDigestSchema } from '../sam/sam-mask-contracts.js';
import { parseAndVerifySamMaskRequest } from '../sam/sam-mask-validation.js';
import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import {
  consumeSamRunPodDirectV3DispatchCapability,
  deriveSamRunPodDirectV3Endpoint,
  type SamRunPodDirectV3TransportPort,
  type SamRunPodDirectV3TransportRequest,
  type SamRunPodDirectV3TransportResponse,
} from './sam-runpod-direct-v3-adapter.js';
import {
  RUNPOD_API_KEY_REFERENCE,
  RUNPOD_DIRECT_METHOD,
  SamRunPodDirectEndpointIdSchema,
} from './sam-runpod-direct-v3-profiles.js';

export const assertSamRunPodDirectV3EndpointUrl = (endpoint: string): string => {
  const parsed = new URL(endpoint);
  const suffix = '.api.runpod.ai';
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.pathname !== '/v1/masks' ||
    !parsed.hostname.endsWith(suffix)
  ) {
    throw new TypeError('RunPod direct endpoint URL is foreign.');
  }
  const endpointId = SamRunPodDirectEndpointIdSchema.parse(
    parsed.hostname.slice(0, -suffix.length),
  );
  if (endpoint !== deriveSamRunPodDirectV3Endpoint(endpointId) || parsed.href !== endpoint) {
    throw new TypeError('RunPod direct endpoint URL is not exact.');
  }
  return endpointId;
};

const readBoundedBody = async (response: Response): Promise<string> => {
  const length = response.headers.get('content-length');
  if (
    length !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(length) || BigInt(length) > BigInt(SAM_LIMITS.responseJsonBytes))
  ) {
    throw new TypeError('RunPod direct response exceeds the bounded reader limit.');
  }
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > SAM_LIMITS.responseJsonBytes) {
        throw new TypeError('RunPod direct response exceeds the bounded reader limit.');
      }
      chunks.push(Uint8Array.from(part.value));
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, cursor);
    cursor += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
};

export const createSamRunPodDirectV3NativeFetchTransport = (input: {
  readonly apiKey: string;
  readonly secretReferenceName: typeof RUNPOD_API_KEY_REFERENCE;
  readonly fetchImplementation?: typeof globalThis.fetch;
}): SamRunPodDirectV3TransportPort & {
  readonly secretReferenceName: typeof RUNPOD_API_KEY_REFERENCE;
  readonly logging: 'redacted-allowlist-only';
} => {
  const apiKey = z.string().min(1).max(16_384).parse(input.apiKey);
  if (input.secretReferenceName !== RUNPOD_API_KEY_REFERENCE) {
    throw new TypeError('SAM direct native transport requires the server-owned API-key reference.');
  }
  const fetchImplementation = input.fetchImplementation ?? globalThis.fetch;
  return Object.freeze({
    transportKind: 'native-fetch-direct-v3' as const,
    secretReferenceName: RUNPOD_API_KEY_REFERENCE,
    logging: 'redacted-allowlist-only' as const,
    async dispatch(
      request: SamRunPodDirectV3TransportRequest,
    ): Promise<SamRunPodDirectV3TransportResponse> {
      consumeSamRunPodDirectV3DispatchCapability(request, 'native-fetch-direct-v3');
      assertSamRunPodDirectV3EndpointUrl(request.endpoint);
      if (
        request.method !== RUNPOD_DIRECT_METHOD ||
        request.signal.aborted ||
        Buffer.byteLength(request.requestBodyText, 'utf8') > SAM_LIMITS.requestJsonBytes
      ) {
        throw new TypeError('RunPod direct native transport received a foreign boundary.');
      }
      const parsed: unknown = JSON.parse(request.requestBodyText);
      if (
        typeof parsed !== 'object' ||
        parsed === null ||
        Array.isArray(parsed) ||
        Object.hasOwn(parsed, 'input') ||
        Object.hasOwn(parsed, 'endpoint') ||
        canonicalizeJson(parsed) !== request.requestBodyText
      ) {
        throw new TypeError('RunPod direct native transport received a wrapped request.');
      }
      const { workerImageDigest, ...baseRequest } = parsed as Record<string, unknown>;
      SamWorkerImageDigestSchema.parse(workerImageDigest);
      parseAndVerifySamMaskRequest(baseRequest);
      const response = await fetchImplementation(request.endpoint, {
        method: RUNPOD_DIRECT_METHOD,
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: request.requestBodyText,
        signal: request.signal,
        redirect: 'error',
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      return {
        status: response.status,
        contentType: response.headers.get('content-type'),
        bodyText: await readBoundedBody(response),
      };
    },
  });
};
