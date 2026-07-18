import { z } from 'zod';

import { SAM_LIMITS } from '../sam/sam-mask-contracts.js';
import {
  RUNPOD_API_KEY_REFERENCE,
  RUNPOD_METHOD,
  consumeSamRunPodDispatchCapability,
  type SamRunPodTransportRequest,
  type SamRunPodTransportResponse,
  type SamRunPodTransportPort,
} from './sam-runpod-adapter.js';

const readBoundedBody = async (response: Response): Promise<string> => {
  const length = response.headers.get('content-length');
  if (
    length !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(length) ||
      BigInt(length) > BigInt(SAM_LIMITS.providerEnvelopeBytes))
  ) {
    throw new TypeError('RunPod response exceeds the bounded reader limit.');
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
      if (total > SAM_LIMITS.providerEnvelopeBytes) {
        throw new TypeError('RunPod response exceeds the bounded reader limit.');
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

export const createSamRunPodNativeFetchTransport = (input?: {
  readonly fetchImplementation?: typeof globalThis.fetch;
}): SamRunPodTransportPort & {
  readonly secretReferenceName: typeof RUNPOD_API_KEY_REFERENCE;
  readonly logging: 'redacted-allowlist-only';
} => {
  const fetchImplementation = input?.fetchImplementation ?? globalThis.fetch;
  return Object.freeze({
    transportKind: 'native-fetch' as const,
    secretReferenceName: RUNPOD_API_KEY_REFERENCE,
    logging: 'redacted-allowlist-only' as const,
    async dispatch(request: SamRunPodTransportRequest): Promise<SamRunPodTransportResponse> {
      consumeSamRunPodDispatchCapability(request, 'native-fetch');
      const endpoint = new URL(request.endpoint);
      if (
        endpoint.protocol !== 'https:' ||
        endpoint.hostname !== 'api.runpod.ai' ||
        !/^\/v2\/[A-Za-z0-9][A-Za-z0-9_-]{2,127}\/runsync$/u.test(endpoint.pathname) ||
        endpoint.search !== '?wait=300000' ||
        request.method !== RUNPOD_METHOD ||
        request.signal.aborted
      ) {
        throw new TypeError('RunPod native transport received a foreign boundary.');
      }
      const secret = z.string().min(1).max(16_384).parse(request.secret);
      const response = await fetchImplementation(request.endpoint, {
        method: RUNPOD_METHOD,
        headers: {
          authorization: `Bearer ${secret}`,
          'content-type': 'application/json',
        },
        body: request.requestBodyText,
        signal: request.signal,
        redirect: 'error',
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      });
      return { status: response.status, bodyText: await readBoundedBody(response) };
    },
  });
};
