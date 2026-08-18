import type { QwenSamTransportRequest } from './qwen-sam-candidate-selector-v1.js';

export async function dispatchQwenSamNative(
  request: QwenSamTransportRequest,
  secret: string,
): Promise<{ status: number; bodyText: string }> {
  if (!secret) throw new Error('DASHSCOPE_API_KEY is required at dispatch.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await globalThis.fetch(request.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: request.requestBodyText,
      redirect: 'error',
      cache: 'no-store',
      credentials: 'omit',
      referrer: '',
      signal: controller.signal,
    });
    const body = await response.arrayBuffer();
    if (body.byteLength > 2_000_000) throw new Error('Response exceeds 2MB.');
    return { status: response.status, bodyText: new TextDecoder().decode(body) };
  } finally {
    clearTimeout(timer);
  }
}
