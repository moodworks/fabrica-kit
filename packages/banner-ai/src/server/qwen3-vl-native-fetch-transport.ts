import { z } from 'zod';

import {
  QWEN3_VL_ENDPOINT_METHOD,
  QWEN3_VL_SECRET_REFERENCE_NAME,
} from '../evaluation/qwen3-vl-candidate-evidence.js';
import type {
  QwenTransportPort,
  QwenTransportRequest,
  QwenTransportResponse,
} from './qwen3-vl-scene-analysis-adapter.js';

const MAX_PROVIDER_RESPONSE_BYTES = 2_097_152;

const assertPinnedFrankfurtEndpoint = (input: string): void => {
  const endpoint = new URL(input);
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username !== '' ||
    endpoint.password !== '' ||
    endpoint.port !== '' ||
    !/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])\.eu-central-1\.maas\.aliyuncs\.com$/u.test(
      endpoint.hostname,
    ) ||
    endpoint.pathname !== '/compatible-mode/v1/chat/completions' ||
    endpoint.search !== '' ||
    endpoint.hash !== ''
  ) {
    throw new TypeError('Qwen transport endpoint is not the pinned Frankfurt workspace endpoint.');
  }
};

const readBoundedUtf8Body = async (response: Response): Promise<string> => {
  const declaredLength = response.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^(?:0|[1-9][0-9]*)$/u.test(declaredLength) ||
      BigInt(declaredLength) > BigInt(MAX_PROVIDER_RESPONSE_BYTES))
  ) {
    throw new TypeError('Qwen provider response exceeds the private response-size limit.');
  }
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
        throw new TypeError('Qwen provider response exceeds the private response-size limit.');
      }
      chunks.push(Uint8Array.from(chunk.value));
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
};

/**
 * The sole native network implementation. Merely importing or constructing it dispatches nothing;
 * the opaque live authorization gate in the adapter must pass before this port can be invoked.
 */
export const createQwen3VlNativeFetchTransport = (input?: {
  readonly fetchImplementation?: typeof globalThis.fetch;
}): QwenTransportPort => {
  const fetchImplementation = input?.fetchImplementation ?? globalThis.fetch;
  return Object.freeze({
    transportKind: 'native-fetch' as const,
    async dispatch(request: QwenTransportRequest): Promise<QwenTransportResponse> {
      assertPinnedFrankfurtEndpoint(request.endpoint);
      if (request.method !== QWEN3_VL_ENDPOINT_METHOD) {
        throw new TypeError('Qwen transport method differs from the pinned request shape.');
      }
      const secret = z.string().min(1).max(16_384).parse(request.secret);
      const timeoutMs = z.int().min(1).max(60_000).parse(request.timeoutMs);
      if (request.signal.aborted || timeoutMs < 1) {
        throw new DOMException('Qwen request was aborted.', 'AbortError');
      }
      const response = await fetchImplementation(request.endpoint, {
        method: QWEN3_VL_ENDPOINT_METHOD,
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
      return Object.freeze({
        status: response.status,
        bodyText: await readBoundedUtf8Body(response),
      });
    },
    secretReferenceName: QWEN3_VL_SECRET_REFERENCE_NAME,
    logging: 'none' as const,
  });
};
