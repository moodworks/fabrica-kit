import { z } from 'zod';

import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import {
  PROVIDER_FREE_FIXTURE_SCENE_MODEL_V1,
  SceneAnalysisModelInvocationV1Schema,
  SceneAnalysisModelRequestV1Schema,
  validateSceneAnalysisInvocationForRequestV1,
  validateSceneAnalysisRequestContextV1,
  type AiModelContractV1,
  type SceneAnalysisModelInvocationV1,
  type SceneAnalysisModelRequestV1,
} from './ai-contracts.js';
import {
  ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1,
  ANGEL_PROVIDER_FREE_SCENE_PROPOSAL_V1,
} from './benchmark-case.js';
import {
  BenchmarkCostUsageV1Schema,
  PROVIDER_FREE_BENCHMARK_PRICING_V1,
  estimateBenchmarkCostV1,
} from './cost-estimator.js';
import { getCanonicalBannerAiPrompt } from './prompt-catalog.js';

export const ProviderFreeFakeModelScenarioSchema = z.enum([
  'success',
  'malformed-output',
  'timeout',
]);

export type ProviderFreeFakeModelScenario = z.infer<typeof ProviderFreeFakeModelScenarioSchema>;

export interface ProviderFreeFakeSceneAnalysisAdapterV1 {
  readonly adapterVersion: 1;
  readonly kind: 'provider-free-fake-scene-analysis';
  readonly networkAccess: 'disabled';
  readonly model: AiModelContractV1;
  invoke(
    request: SceneAnalysisModelRequestV1,
    scenario: ProviderFreeFakeModelScenario,
  ): SceneAnalysisModelInvocationV1;
}

const scenarioMetadata = Object.freeze({
  success: {
    latencyMs: 17,
    retry: { attemptCount: 1, retryCount: 0, failedAttemptCount: 0 },
    actualUsage: {
      modelInferenceUnits: 1,
      segmentationComputeUnits: 0,
      inpaintingUnits: 0,
      storageByteMonths: 0,
      retryUnits: 0,
      failedAttemptUnits: 0,
    },
  },
  'malformed-output': {
    latencyMs: 23,
    retry: { attemptCount: 1, retryCount: 0, failedAttemptCount: 1 },
    actualUsage: {
      modelInferenceUnits: 1,
      segmentationComputeUnits: 0,
      inpaintingUnits: 0,
      storageByteMonths: 0,
      retryUnits: 0,
      failedAttemptUnits: 1,
    },
  },
  timeout: {
    latencyMs: 60_000,
    retry: { attemptCount: 3, retryCount: 2, failedAttemptCount: 3 },
    actualUsage: {
      modelInferenceUnits: 3,
      segmentationComputeUnits: 0,
      inpaintingUnits: 0,
      storageByteMonths: 0,
      retryUnits: 2,
      failedAttemptUnits: 3,
    },
  },
} as const);

const estimatedUsage = BenchmarkCostUsageV1Schema.parse({
  modelInferenceUnits: 1,
  segmentationComputeUnits: 0,
  inpaintingUnits: 0,
  storageByteMonths: 0,
  retryUnits: 0,
  failedAttemptUnits: 0,
});

const validateCanonicalFixtureRequest = (
  requestInput: SceneAnalysisModelRequestV1,
): SceneAnalysisModelRequestV1 => {
  const request = validateSceneAnalysisRequestContextV1({
    request: requestInput,
    expectedModel: PROVIDER_FREE_FIXTURE_SCENE_MODEL_V1,
    expectedWorkflow: ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1.expectedWorkflow,
  });
  const prompt = getCanonicalBannerAiPrompt(request.input.prompt.id);
  if (
    prompt.version !== request.input.prompt.version ||
    prompt.contentSha256 !== request.input.prompt.contentSha256
  ) {
    throw new TypeError('Provider-free fake adapter requires the exact canonical prompt content.');
  }
  if (
    canonicalizeJson(request.input) !==
    canonicalizeJson(ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1.input)
  ) {
    throw new TypeError(
      'Provider-free fake adapter accepts only the canonical Angel benchmark input.',
    );
  }
  return request;
};

const buildMetadata = (
  request: SceneAnalysisModelRequestV1,
  scenario: ProviderFreeFakeModelScenario,
) => {
  const fixed = scenarioMetadata[scenario];
  const actualUsage = BenchmarkCostUsageV1Schema.parse(fixed.actualUsage);
  return {
    metadataVersion: 1 as const,
    requestIdentity: request.requestIdentity,
    workflow: request.input.workflow,
    model: request.input.model,
    prompt: request.input.prompt,
    latency: { unit: 'milliseconds' as const, total: fixed.latencyMs },
    retry: fixed.retry,
    cost: {
      estimated: estimateBenchmarkCostV1({
        pricing: PROVIDER_FREE_BENCHMARK_PRICING_V1,
        usage: estimatedUsage,
      }),
      actual: estimateBenchmarkCostV1({
        pricing: PROVIDER_FREE_BENCHMARK_PRICING_V1,
        usage: actualUsage,
      }),
    },
  };
};

const invoke = (
  requestInput: SceneAnalysisModelRequestV1,
  scenarioInput: ProviderFreeFakeModelScenario,
): SceneAnalysisModelInvocationV1 => {
  const request = validateCanonicalFixtureRequest(
    SceneAnalysisModelRequestV1Schema.parse(requestInput),
  );
  const scenario = ProviderFreeFakeModelScenarioSchema.parse(scenarioInput);
  const metadata = buildMetadata(request, scenario);
  let invocation: SceneAnalysisModelInvocationV1;
  if (scenario === 'success') {
    invocation = SceneAnalysisModelInvocationV1Schema.parse({
      kind: 'success',
      metadata,
      output: ANGEL_PROVIDER_FREE_SCENE_PROPOSAL_V1,
    });
  } else if (scenario === 'malformed-output') {
    invocation = SceneAnalysisModelInvocationV1Schema.parse({
      kind: 'malformed-output',
      metadata,
      rawOutput: {
        kind: 'composition_proposal',
        proposalVersion: 1,
        sourceAssetSha256: request.input.sourceAsset.sha256,
        parts: 'deterministic-malformed-parts',
      },
    });
  } else {
    invocation = SceneAnalysisModelInvocationV1Schema.parse({
      kind: 'timeout',
      metadata,
      timeout: { code: 'MODEL_TIMEOUT', timeoutMs: scenarioMetadata.timeout.latencyMs },
    });
  }
  return validateSceneAnalysisInvocationForRequestV1({ request, invocation });
};

export const createProviderFreeFakeSceneAnalysisAdapterV1 =
  (): ProviderFreeFakeSceneAnalysisAdapterV1 =>
    Object.freeze({
      adapterVersion: 1 as const,
      kind: 'provider-free-fake-scene-analysis' as const,
      networkAccess: 'disabled' as const,
      model: PROVIDER_FREE_FIXTURE_SCENE_MODEL_V1,
      invoke,
    });
