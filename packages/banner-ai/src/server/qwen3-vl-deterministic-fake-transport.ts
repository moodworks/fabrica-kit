import { z } from 'zod';

import {
  QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT,
  QWEN3_VL_ENDPOINT_METHOD,
  QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V3,
  QWEN3_VL_MAX_OUTPUT_TOKENS,
  QWEN3_VL_REQUESTED_MODEL_ID,
  type QwenProviderUsageV1,
} from '../evaluation/qwen3-vl-candidate-evidence.js';
import type { QwenSemanticSceneAnalysisOutputV1 } from '../evaluation/qwen-semantic-scene-analysis-output.js';
import type {
  QwenTransportPort,
  QwenTransportRequest,
  QwenTransportResponse,
} from './qwen3-vl-scene-analysis-adapter.js';
import { consumeQwenTransportDispatchCapability } from './qwen3-vl-scene-analysis-adapter.js';

export type DeterministicQwenTransportStep =
  | {
      readonly kind: 'success';
      readonly output: QwenSemanticSceneAnalysisOutputV1;
      readonly usage?: QwenProviderUsageV1;
    }
  | { readonly kind: 'malformed-json' }
  | { readonly kind: 'schema-invalid' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'cancellation' }
  | { readonly kind: 'http-error' }
  | { readonly kind: 'provider-error' }
  | { readonly kind: 'missing-usage' }
  | { readonly kind: 'unexpected-model'; readonly model?: string }
  | { readonly kind: 'unexpected-finish' }
  | { readonly kind: 'unknown-response-field' }
  | { readonly kind: 'wait-for-abort' };

const defaultUsage = Object.freeze({
  prompt_tokens: 1_000,
  completion_tokens: 200,
  total_tokens: 1_200,
});

const expectedBodyKeys = [
  'enable_code_interpreter',
  'enable_search',
  'enable_thinking',
  'max_tokens',
  'messages',
  'model',
  'n',
  'parallel_tool_calls',
  'response_format',
  'seed',
  'stream',
  'temperature',
  'tool_choice',
  'tools',
];

const assertFakeRequestBoundary = (request: QwenTransportRequest): void => {
  if (
    request.method !== QWEN3_VL_ENDPOINT_METHOD ||
    request.secret !== null ||
    request.signal.aborted ||
    request.endpoint !== QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT
  ) {
    throw new TypeError('Deterministic Qwen transport received a foreign dispatch boundary.');
  }
  const body = z.record(z.string(), z.unknown()).parse(JSON.parse(request.requestBodyText));
  if (
    JSON.stringify(Object.keys(body).toSorted()) !== JSON.stringify(expectedBodyKeys) ||
    body.model !== QWEN3_VL_REQUESTED_MODEL_ID ||
    body.enable_thinking !== false ||
    body.enable_search !== false ||
    body.enable_code_interpreter !== false ||
    body.tool_choice !== 'none' ||
    body.parallel_tool_calls !== false ||
    body.stream !== false ||
    body.n !== 1 ||
    body.temperature !== 0 ||
    body.seed !== 0 ||
    body.max_tokens !== QWEN3_VL_MAX_OUTPUT_TOKENS ||
    JSON.stringify(body.response_format) !== JSON.stringify({ type: 'json_object' }) ||
    !Array.isArray(body.tools) ||
    body.tools.length !== 0
  ) {
    throw new TypeError('Deterministic Qwen transport received a drifted request shape.');
  }
  const messages = z.array(z.record(z.string(), z.unknown())).length(2).parse(body.messages);
  const systemContent = z.string().parse(messages[0]?.content);
  const userContent = z
    .array(z.record(z.string(), z.unknown()))
    .length(1)
    .parse(messages[1]?.content);
  const imageUrl = z.record(z.string(), z.unknown()).parse(userContent[0]?.image_url).url;
  if (
    systemContent !== QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V3.content ||
    typeof imageUrl !== 'string' ||
    !imageUrl.startsWith('data:image/png;base64,') ||
    /^https?:/u.test(imageUrl)
  ) {
    throw new TypeError('Deterministic Qwen transport received unsafe image or protocol content.');
  }
};

const envelope = (input: {
  readonly index: number;
  readonly content: string;
  readonly usage?: QwenProviderUsageV1;
  readonly model?: string;
  readonly includeUsage?: boolean;
  readonly finishReason?: 'stop' | 'length';
}): string =>
  JSON.stringify({
    id: `chatcmpl-qwen-fake-${String(input.index).padStart(2, '0')}`,
    object: 'chat.completion',
    created: 1_784_064_000,
    model: input.model ?? QWEN3_VL_REQUESTED_MODEL_ID,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: input.content,
          refusal: null,
          audio: null,
          function_call: null,
          tool_calls: null,
        },
        finish_reason: input.finishReason ?? 'stop',
        logprobs: null,
      },
    ],
    ...(input.includeUsage === false ? {} : { usage: input.usage ?? defaultUsage }),
    system_fingerprint: 'deterministic-fake-no-provider',
    service_tier: null,
  });

const responseForStep = (
  step: DeterministicQwenTransportStep,
  index: number,
): QwenTransportResponse => {
  switch (step.kind) {
    case 'success':
      return {
        status: 200,
        bodyText: envelope({
          index,
          content: JSON.stringify(step.output),
          ...(step.usage === undefined ? {} : { usage: step.usage }),
        }),
      };
    case 'malformed-json':
      return { status: 200, bodyText: envelope({ index, content: '{not-json' }) };
    case 'schema-invalid':
      return { status: 200, bodyText: envelope({ index, content: '{}' }) };
    case 'http-error':
      return { status: 503, bodyText: '<html>deterministic upstream failure</html>' };
    case 'provider-error':
      return {
        status: 400,
        bodyText: JSON.stringify({
          error: {
            message: 'deterministic fake provider error',
            type: 'invalid_request_error',
            param: null,
            code: 'InvalidParameter',
          },
          request_id: `fake-request-${index}`,
        }),
      };
    case 'missing-usage':
      return {
        status: 200,
        bodyText: envelope({ index, content: '{}', includeUsage: false }),
      };
    case 'unexpected-model':
      return {
        status: 200,
        bodyText: envelope({ index, content: '{}', model: step.model ?? 'qwen-unexpected-model' }),
      };
    case 'unexpected-finish':
      return {
        status: 200,
        bodyText: envelope({ index, content: '{}', finishReason: 'length' }),
      };
    case 'unknown-response-field': {
      const parsed = JSON.parse(envelope({ index, content: '{}' })) as Record<string, unknown>;
      parsed.unknown_provider_field = true;
      return { status: 200, bodyText: JSON.stringify(parsed) };
    }
    case 'timeout': {
      const error = new Error('Deterministic timeout.');
      error.name = 'TimeoutError';
      throw error;
    }
    case 'cancellation': {
      const error = new Error('Deterministic cancellation.');
      error.name = 'CancellationError';
      throw error;
    }
    case 'wait-for-abort':
      throw new TypeError('Signal-waiting steps are handled by the async transport boundary.');
  }
};

export const createDeterministicQwenTransport = (
  stepsInput: readonly DeterministicQwenTransportStep[],
): QwenTransportPort & {
  readonly getCallCount: () => number;
  readonly getAbortCount: () => number;
} => {
  const steps = Object.freeze([...stepsInput]);
  let callCount = 0;
  let abortCount = 0;
  return Object.freeze({
    transportKind: 'deterministic-fake' as const,
    async dispatch(request: QwenTransportRequest): Promise<QwenTransportResponse> {
      consumeQwenTransportDispatchCapability(request, 'deterministic-fake');
      assertFakeRequestBoundary(request);
      const step = steps[callCount];
      callCount += 1;
      if (step === undefined) {
        throw new TypeError('Deterministic Qwen transport call cap was exceeded.');
      }
      if (step.kind === 'wait-for-abort') {
        return new Promise<QwenTransportResponse>((_resolve, reject) => {
          const abort = () => {
            abortCount += 1;
            reject(new DOMException('Deterministic signal abort.', 'AbortError'));
          };
          if (request.signal.aborted) abort();
          else request.signal.addEventListener('abort', abort, { once: true });
        });
      }
      return responseForStep(step, callCount);
    },
    getCallCount: () => callCount,
    getAbortCount: () => abortCount,
  });
};
