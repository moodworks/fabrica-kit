import { z } from 'zod';

import { RequestIdSchema } from '../context/actor-workspace-context.js';
import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import { CompositionPartV1Schema } from '../workflows/composition-contracts.js';
import {
  AiInputDigestV1Schema,
  AiModelContractV1Schema,
  BannerAiWorkflowRefV1Schema,
  BenchmarkCaseIdSchema,
  BenchmarkExpectedTextObservationSetV1Schema,
  INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
  PROVIDER_FREE_FIXTURE_SCENE_MODEL_V1,
  RepositoryFixtureInputRefV1Schema,
  SceneAnalysisModelInputV1Schema,
  StructuredSceneAnalysisOutputV1Schema,
  createBenchmarkExpectedTextObservationSetV1,
  createSceneAnalysisModelRequestV1,
  sceneAnalysisModelInputDigestV1,
  validateBenchmarkExpectedTextObservationsForSceneAnalysisRequestV1,
  validateInitialBannerAnalyzeWorkflowRefV1,
  type SceneAnalysisModelRequestV1,
} from './ai-contracts.js';
import { BannerAiPromptRefV1Schema, canonicalBannerAiPromptRef } from './prompt-catalog.js';
import { ANGEL_PROVIDER_FREE_FIXTURE_INPUT_REF_V1 } from './repository-benchmark-fixture.js';

export const BenchmarkStatusSchema = z.enum(['draft', 'ready', 'accepted', 'retired']);

export const ExpectedLayerRubricV1Schema = z
  .strictObject({
    proposal: CompositionPartV1Schema,
    required: z.literal(true),
  })
  .readonly();

export const TextPreservationRequirementsV1Schema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('no-text-present'),
      expectedObservations: BenchmarkExpectedTextObservationSetV1Schema.refine(
        (set) => set.observations.length === 0,
        'A no-text benchmark requires an explicit empty observation set.',
      ),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('preserve-exact'),
      expectedObservations: BenchmarkExpectedTextObservationSetV1Schema.refine(
        (set) => set.observations.length > 0,
        'Exact text preservation requires at least one observed text value.',
      ),
    })
    .readonly(),
]);

export const BenchmarkQualityReviewFlagSchema = z.enum([
  'bounds-approximate',
  'ocr-not-required',
  'segmentation-not-evaluated',
]);

export const BannerAiBenchmarkCaseV1Schema = z
  .strictObject({
    caseVersion: z.literal(1),
    caseId: BenchmarkCaseIdSchema,
    requestId: RequestIdSchema,
    input: SceneAnalysisModelInputV1Schema,
    inputDigest: AiInputDigestV1Schema,
    expectedLayers: z.array(ExpectedLayerRubricV1Schema).min(1).max(5).readonly(),
    textPreservation: TextPreservationRequirementsV1Schema,
    qualityReviewFlags: z
      .array(BenchmarkQualityReviewFlagSchema)
      .max(BenchmarkQualityReviewFlagSchema.options.length)
      .readonly(),
    expectedModel: AiModelContractV1Schema,
    expectedPrompt: BannerAiPromptRefV1Schema,
    expectedWorkflow: BannerAiWorkflowRefV1Schema,
    status: BenchmarkStatusSchema,
  })
  .superRefine((benchmark, context) => {
    if (sceneAnalysisModelInputDigestV1(benchmark.input).sha256 !== benchmark.inputDigest.sha256) {
      context.addIssue({
        code: 'custom',
        message: 'Benchmark digest must cover the exact validated model-request input.',
        path: ['inputDigest'],
      });
    }
    if (
      canonicalizeJson(benchmark.expectedModel) !== canonicalizeJson(benchmark.input.model) ||
      canonicalizeJson(benchmark.expectedPrompt) !== canonicalizeJson(benchmark.input.prompt) ||
      canonicalizeJson(benchmark.expectedWorkflow) !== canonicalizeJson(benchmark.input.workflow)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Benchmark expected identities must equal its model-request identities.',
      });
    }
    try {
      validateInitialBannerAnalyzeWorkflowRefV1(benchmark.expectedWorkflow);
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Benchmark case must use the frozen initial Banner analyze workflow.',
        path: ['expectedWorkflow'],
      });
    }
    const expectedKeys = benchmark.expectedLayers.map((layer) => layer.proposal.partKey);
    if (new Set(expectedKeys).size !== expectedKeys.length) {
      context.addIssue({
        code: 'custom',
        message: 'Expected benchmark layer keys must be unique.',
        path: ['expectedLayers'],
      });
    }
    if (benchmark.expectedLayers.length > benchmark.input.options.maxParts) {
      context.addIssue({
        code: 'custom',
        message: 'Expected layers exceed the request-relative maximum part count.',
        path: ['expectedLayers'],
      });
    }
    try {
      validateBenchmarkExpectedTextObservationsForSceneAnalysisRequestV1({
        request: createSceneAnalysisModelRequestV1({
          requestId: benchmark.requestId,
          modelInput: benchmark.input,
        }),
        benchmarkCase: {
          caseId: benchmark.caseId,
          caseVersion: benchmark.caseVersion,
          inputDigest: benchmark.inputDigest,
          fixture: benchmark.input.fixture,
        },
        expectedObservations: benchmark.textPreservation.expectedObservations,
      });
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Expected text observations must bind to the benchmark request and source.',
        path: ['textPreservation'],
      });
    }
    if (new Set(benchmark.qualityReviewFlags).size !== benchmark.qualityReviewFlags.length) {
      context.addIssue({
        code: 'custom',
        message: 'Quality-review flags must be unique.',
        path: ['qualityReviewFlags'],
      });
    }
  })
  .readonly();

export type BannerAiBenchmarkCaseV1 = z.infer<typeof BannerAiBenchmarkCaseV1Schema>;
export type ExpectedLayerRubricV1 = z.infer<typeof ExpectedLayerRubricV1Schema>;
export type TextPreservationRequirementsV1 = z.infer<typeof TextPreservationRequirementsV1Schema>;

const ANGEL_NORMALIZED_SOURCE_SHA256 =
  '16767d791c8b19501eb071b51c3ee56f0bbfe3139b0cd39c38e3deef6528dd4f';

const angelRepositoryFixture = RepositoryFixtureInputRefV1Schema.parse(
  ANGEL_PROVIDER_FREE_FIXTURE_INPUT_REF_V1,
);

const angelSourceAsset = {
  assetId: 'asset_16767d791c8b19501eb071b51c3ee56f0bbfe3139b0cd39c38e3deef65',
  assetVersionId: 'version_16767d791c8b19501eb071b51c3ee56f0bbfe3139b0cd39c38e3deef',
  sha256: ANGEL_NORMALIZED_SOURCE_SHA256,
  mediaType: 'image/png',
  byteSize: 77,
  pixelWidth: 12,
  pixelHeight: 8,
} as const;

export const ANGEL_PROVIDER_FREE_EXPECTED_LAYERS_V1 = z
  .array(ExpectedLayerRubricV1Schema)
  .length(4)
  .readonly()
  .parse([
    {
      proposal: {
        partKey: 'background',
        label: 'Background',
        role: 'background',
        bounds: { xBps: 0, yBps: 0, widthBps: 10_000, heightBps: 10_000 },
      },
      required: true,
    },
    {
      proposal: {
        partKey: 'angel.body',
        label: 'Angel body',
        role: 'subject',
        bounds: { xBps: 3_500, yBps: 1_500, widthBps: 3_000, heightBps: 8_000 },
      },
      required: true,
    },
    {
      proposal: {
        partKey: 'wing.left',
        label: 'Left wing',
        role: 'decoration',
        bounds: { xBps: 500, yBps: 1_800, widthBps: 3_500, heightBps: 6_000 },
      },
      required: true,
    },
    {
      proposal: {
        partKey: 'wing.right',
        label: 'Right wing',
        role: 'decoration',
        bounds: { xBps: 6_000, yBps: 1_800, widthBps: 3_500, heightBps: 6_000 },
      },
      required: true,
    },
  ]);

const angelModelInput = SceneAnalysisModelInputV1Schema.parse({
  inputVersion: 1,
  fixture: angelRepositoryFixture,
  sourceAsset: angelSourceAsset,
  model: PROVIDER_FREE_FIXTURE_SCENE_MODEL_V1,
  prompt: canonicalBannerAiPromptRef('scene-analysis-v1'),
  options: {
    maxParts: 4,
    includeBackground: true,
    preserveVisibleText: true,
  },
  workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
});

const angelRequestId = 'benchmark.angel-local-png-v1:request';
const angelModelRequest = createSceneAnalysisModelRequestV1({
  requestId: angelRequestId,
  modelInput: angelModelInput,
});

export const ANGEL_PROVIDER_FREE_EXPECTED_TEXT_OBSERVATIONS_V1 =
  createBenchmarkExpectedTextObservationSetV1({
    request: angelModelRequest,
    benchmarkCase: {
      caseId: 'angel-local-png-v1',
      caseVersion: 1,
      inputDigest: angelModelRequest.requestIdentity.inputDigest,
      fixture: angelRepositoryFixture,
    },
    observations: [],
  });

export const ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1 = BannerAiBenchmarkCaseV1Schema.parse({
  caseVersion: 1,
  caseId: 'angel-local-png-v1',
  requestId: angelRequestId,
  input: angelModelInput,
  inputDigest: sceneAnalysisModelInputDigestV1(angelModelInput),
  expectedLayers: ANGEL_PROVIDER_FREE_EXPECTED_LAYERS_V1,
  textPreservation: {
    kind: 'no-text-present',
    expectedObservations: ANGEL_PROVIDER_FREE_EXPECTED_TEXT_OBSERVATIONS_V1,
  },
  qualityReviewFlags: ['bounds-approximate', 'ocr-not-required', 'segmentation-not-evaluated'],
  expectedModel: PROVIDER_FREE_FIXTURE_SCENE_MODEL_V1,
  expectedPrompt: canonicalBannerAiPromptRef('scene-analysis-v1'),
  expectedWorkflow: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
  status: 'ready',
});

export const ANGEL_PROVIDER_FREE_SCENE_PROPOSAL_V1 = StructuredSceneAnalysisOutputV1Schema.parse({
  kind: 'composition_proposal',
  proposalVersion: 1,
  sourceAssetSha256: ANGEL_NORMALIZED_SOURCE_SHA256,
  parts: ANGEL_PROVIDER_FREE_EXPECTED_LAYERS_V1.map((layer) => layer.proposal),
});

export const BANNER_AI_BENCHMARK_CASES_V1 = Object.freeze([
  ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1,
] as const);

export const benchmarkCaseSceneAnalysisRequestV1 = (
  input: unknown,
): SceneAnalysisModelRequestV1 => {
  const benchmark = BannerAiBenchmarkCaseV1Schema.parse(input);
  return createSceneAnalysisModelRequestV1({
    requestId: benchmark.requestId,
    modelInput: benchmark.input,
  });
};
