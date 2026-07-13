import { z, type RefinementCtx } from 'zod';

import { RequestIdSchema } from '../context/actor-workspace-context.js';
import { ModelKeySchema, ProviderKeySchema } from '../jobs/syntax.js';
import {
  AssetVersionRefV1Schema,
  OpaqueIdSchema,
  PositiveInt32Schema,
  Sha256HexSchema,
} from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  CompositionAnalysisResultV1Schema,
  CompositionPartV1Schema,
  validateCompositionAnalysisResultV1,
} from '../workflows/composition-contracts.js';
import { INITIAL_BANNER_ANALYZE_WORKFLOW_V1 } from '../workflows/workflow-definition.js';
import { BenchmarkCostBreakdownV1Schema } from './cost-estimator.js';
import { BannerAiPromptRefV1Schema, type BannerAiPromptRefV1 } from './prompt-catalog.js';

export const AiModelCapabilitySchema = z.enum([
  'animation_planning',
  'background_fill',
  'deterministic_replay',
  'image_segmentation',
  'ocr',
  'scene_analysis',
  'structured_output',
]);

const capabilityOrder = new Map(
  AiModelCapabilitySchema.options.map((capability, index) => [capability, index]),
);

export const AiModelCapabilitiesV1Schema = z
  .strictObject({
    capabilitiesVersion: z.literal(1),
    capabilities: z
      .array(AiModelCapabilitySchema)
      .min(1)
      .max(AiModelCapabilitySchema.options.length)
      .superRefine((capabilities, context) => {
        if (new Set(capabilities).size !== capabilities.length) {
          context.addIssue({ code: 'custom', message: 'Model capabilities must be unique.' });
        }
        for (let index = 1; index < capabilities.length; index += 1) {
          const previous = capabilityOrder.get(capabilities[index - 1]!)!;
          const current = capabilityOrder.get(capabilities[index]!)!;
          if (previous >= current) {
            context.addIssue({
              code: 'custom',
              message: 'Model capabilities must use canonical catalog order.',
            });
            break;
          }
        }
      })
      .readonly(),
  })
  .readonly();

export const AiModelProviderIdentityV1Schema = z
  .strictObject({
    identityVersion: z.literal(1),
    providerKey: ProviderKeySchema,
    modelKey: ModelKeySchema,
    modelVersion: PositiveInt32Schema,
    external: z.boolean(),
  })
  .readonly();

export const AiModelContractV1Schema = z
  .strictObject({
    identity: AiModelProviderIdentityV1Schema,
    capabilities: AiModelCapabilitiesV1Schema,
  })
  .readonly();

export const PROVIDER_FREE_FIXTURE_SCENE_MODEL_V1 = AiModelContractV1Schema.parse({
  identity: {
    identityVersion: 1,
    providerKey: 'fixture',
    modelKey: 'phase1a-fixture-v1',
    modelVersion: 1,
    external: false,
  },
  capabilities: {
    capabilitiesVersion: 1,
    capabilities: ['deterministic_replay', 'scene_analysis', 'structured_output'],
  },
});

export const BannerAiWorkflowRefV1Schema = z
  .strictObject({
    workflowVersionId: z.literal(INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId),
    workflowVersion: z.literal(INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersion),
    definitionSha256: z.literal(INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definitionSha256),
  })
  .readonly();

export const INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1 = BannerAiWorkflowRefV1Schema.parse({
  workflowVersionId: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
  workflowVersion: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersion,
  definitionSha256: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definitionSha256,
});

export const AiInputSha256Schema = Sha256HexSchema.brand<'AiInputSha256'>();

export const AiInputDigestV1Schema = z
  .strictObject({
    algorithm: z.literal('sha256'),
    sha256: AiInputSha256Schema,
  })
  .readonly()
  .brand<'AiInputDigestV1'>();

export const AiModelRequestIdentityV1Schema = z
  .strictObject({
    identityVersion: z.literal(1),
    requestId: RequestIdSchema,
    inputDigest: AiInputDigestV1Schema,
  })
  .readonly();

const safeRepositoryPathPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const safeExportNamePattern = /^[A-Za-z_$][A-Za-z0-9_$]{0,79}$/;

export const RepositoryFixtureInputRefV1Schema = z
  .strictObject({
    referenceVersion: z.literal(1),
    kind: z.literal('repository-fixture'),
    repositoryPath: z
      .string()
      .regex(safeRepositoryPathPattern)
      .refine((path) => !path.split('/').includes('..'), 'Fixture paths cannot traverse upward.'),
    exportName: z.string().regex(safeExportNamePattern),
    variant: z.enum(['png', 'jpeg']),
    normalization: z.literal('canonical-raster-upload-v1'),
  })
  .readonly();

export const SceneAnalysisOptionsV1Schema = z
  .strictObject({
    maxParts: z.int().min(1).max(5),
    includeBackground: z.boolean(),
    preserveVisibleText: z.boolean(),
  })
  .readonly();

const hasCapabilities = (
  model: z.infer<typeof AiModelContractV1Schema>,
  required: readonly z.infer<typeof AiModelCapabilitySchema>[],
): boolean => required.every((capability) => model.capabilities.capabilities.includes(capability));

const addCapabilityIssue = (
  model: z.infer<typeof AiModelContractV1Schema>,
  required: readonly z.infer<typeof AiModelCapabilitySchema>[],
  context: RefinementCtx,
): void => {
  if (!hasCapabilities(model, required)) {
    context.addIssue({
      code: 'custom',
      message: `Model contract lacks required capabilities: ${required.join(', ')}.`,
      path: ['model'],
    });
  }
};

export const SceneAnalysisModelInputV1Schema = z
  .strictObject({
    inputVersion: z.literal(1),
    fixture: RepositoryFixtureInputRefV1Schema,
    sourceAsset: AssetVersionRefV1Schema,
    model: AiModelContractV1Schema,
    prompt: BannerAiPromptRefV1Schema,
    options: SceneAnalysisOptionsV1Schema,
    workflow: BannerAiWorkflowRefV1Schema,
  })
  .superRefine((input, context) => {
    if (input.prompt.id !== 'scene-analysis-v1') {
      context.addIssue({
        code: 'custom',
        message: 'Scene analysis requires the canonical scene-analysis prompt.',
        path: ['prompt'],
      });
    }
    addCapabilityIssue(input.model, ['scene_analysis', 'structured_output'], context);
  })
  .readonly();

const digestCanonicalInput = (input: unknown): z.infer<typeof AiInputDigestV1Schema> =>
  AiInputDigestV1Schema.parse({
    algorithm: 'sha256',
    sha256: sha256Hex(Buffer.from(canonicalizeJson(input), 'utf8')),
  });

export const sceneAnalysisModelInputDigestV1 = (
  input: unknown,
): z.infer<typeof AiInputDigestV1Schema> =>
  digestCanonicalInput(SceneAnalysisModelInputV1Schema.parse(input));

export const SceneAnalysisModelRequestV1Schema = z
  .strictObject({
    requestVersion: z.literal(1),
    requestIdentity: AiModelRequestIdentityV1Schema,
    input: SceneAnalysisModelInputV1Schema,
  })
  .superRefine((request, context) => {
    const expected = sceneAnalysisModelInputDigestV1(request.input);
    if (expected.sha256 !== request.requestIdentity.inputDigest.sha256) {
      context.addIssue({
        code: 'custom',
        message: 'Scene-analysis input digest differs from the entire validated model input.',
        path: ['requestIdentity', 'inputDigest'],
      });
    }
  })
  .readonly();

export const createSceneAnalysisModelRequestV1 = (input: {
  readonly requestId: unknown;
  readonly modelInput: unknown;
}): z.infer<typeof SceneAnalysisModelRequestV1Schema> => {
  const modelInput = SceneAnalysisModelInputV1Schema.parse(input.modelInput);
  return SceneAnalysisModelRequestV1Schema.parse({
    requestVersion: 1,
    requestIdentity: {
      identityVersion: 1,
      requestId: input.requestId,
      inputDigest: sceneAnalysisModelInputDigestV1(modelInput),
    },
    input: modelInput,
  });
};

export const SegmentationMaskReferenceV1Schema = z
  .strictObject({
    referenceVersion: z.literal(1),
    segmentationId: OpaqueIdSchema,
    sourceAssetSha256: Sha256HexSchema,
    maskAsset: AssetVersionRefV1Schema,
    coordinateSpace: z
      .strictObject({
        pixelWidth: PositiveInt32Schema,
        pixelHeight: PositiveInt32Schema,
      })
      .readonly(),
    maskSemantics: z.enum(['background-region', 'foreground-object', 'inpaint-region']),
    producer: AiModelProviderIdentityV1Schema,
  })
  .superRefine((reference, context) => {
    if (
      reference.maskAsset.pixelWidth !== reference.coordinateSpace.pixelWidth ||
      reference.maskAsset.pixelHeight !== reference.coordinateSpace.pixelHeight
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Mask asset dimensions must match its declared source coordinate space.',
        path: ['maskAsset'],
      });
    }
  })
  .readonly();

const safeInstructionSchema = z.string().superRefine((value, context) => {
  if (
    [...value].length < 1 ||
    [...value].length > 1_000 ||
    value.normalize('NFC') !== value ||
    value.trim() !== value ||
    /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u.test(value)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'AI instructions must be safe trimmed NFC text of 1–1,000 code points.',
    });
  }
});

export const BackgroundFillModelInputV1Schema = z
  .strictObject({
    inputVersion: z.literal(1),
    sourceAsset: AssetVersionRefV1Schema,
    mask: SegmentationMaskReferenceV1Schema,
    instructions: safeInstructionSchema,
    output: z
      .strictObject({
        pixelWidth: PositiveInt32Schema,
        pixelHeight: PositiveInt32Schema,
      })
      .readonly(),
    model: AiModelContractV1Schema,
    prompt: BannerAiPromptRefV1Schema,
    workflow: BannerAiWorkflowRefV1Schema,
  })
  .superRefine((input, context) => {
    if (input.prompt.id !== 'background-fill-v1') {
      context.addIssue({
        code: 'custom',
        message: 'Background fill requires the canonical background-fill prompt.',
        path: ['prompt'],
      });
    }
    if (
      input.mask.sourceAssetSha256 !== input.sourceAsset.sha256 ||
      input.mask.coordinateSpace.pixelWidth !== input.sourceAsset.pixelWidth ||
      input.mask.coordinateSpace.pixelHeight !== input.sourceAsset.pixelHeight
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Background-fill mask must belong to the exact source asset and dimensions.',
        path: ['mask'],
      });
    }
    addCapabilityIssue(input.model, ['background_fill'], context);
  })
  .readonly();

export const backgroundFillModelInputDigestV1 = (
  input: unknown,
): z.infer<typeof AiInputDigestV1Schema> =>
  digestCanonicalInput(BackgroundFillModelInputV1Schema.parse(input));

export const BackgroundFillModelRequestV1Schema = z
  .strictObject({
    requestVersion: z.literal(1),
    requestIdentity: AiModelRequestIdentityV1Schema,
    input: BackgroundFillModelInputV1Schema,
  })
  .superRefine((request, context) => {
    if (
      backgroundFillModelInputDigestV1(request.input).sha256 !==
      request.requestIdentity.inputDigest.sha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Background-fill input digest differs from the validated model input.',
        path: ['requestIdentity', 'inputDigest'],
      });
    }
  })
  .readonly();

export const LayerProposalV1Schema = CompositionPartV1Schema;
export const StructuredSceneAnalysisOutputV1Schema = CompositionAnalysisResultV1Schema;

export const AnimationPlanModelInputV1Schema = z
  .strictObject({
    inputVersion: z.literal(1),
    sourceAssetSha256: Sha256HexSchema,
    canvas: z
      .strictObject({
        pixelWidth: PositiveInt32Schema,
        pixelHeight: PositiveInt32Schema,
      })
      .readonly(),
    layerProposals: z.array(LayerProposalV1Schema).min(1).max(5).readonly(),
    options: z
      .strictObject({
        durationMs: z.int().min(100).max(60_000),
        maxTracks: z.int().min(1).max(64),
        preserveVisibleText: z.boolean(),
      })
      .readonly(),
    model: AiModelContractV1Schema,
    prompt: BannerAiPromptRefV1Schema,
    workflow: BannerAiWorkflowRefV1Schema,
  })
  .superRefine((input, context) => {
    if (input.prompt.id !== 'animation-plan-v1') {
      context.addIssue({
        code: 'custom',
        message: 'Animation planning requires the canonical animation-plan prompt.',
        path: ['prompt'],
      });
    }
    const partKeys = input.layerProposals.map((part) => part.partKey);
    if (new Set(partKeys).size !== partKeys.length) {
      context.addIssue({
        code: 'custom',
        message: 'Animation-plan layer proposal keys must be unique.',
        path: ['layerProposals'],
      });
    }
    addCapabilityIssue(input.model, ['animation_planning', 'structured_output'], context);
  })
  .readonly();

export const animationPlanModelInputDigestV1 = (
  input: unknown,
): z.infer<typeof AiInputDigestV1Schema> =>
  digestCanonicalInput(AnimationPlanModelInputV1Schema.parse(input));

export const AnimationPlanModelRequestV1Schema = z
  .strictObject({
    requestVersion: z.literal(1),
    requestIdentity: AiModelRequestIdentityV1Schema,
    input: AnimationPlanModelInputV1Schema,
  })
  .superRefine((request, context) => {
    if (
      animationPlanModelInputDigestV1(request.input).sha256 !==
      request.requestIdentity.inputDigest.sha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Animation-plan input digest differs from the validated model input.',
        path: ['requestIdentity', 'inputDigest'],
      });
    }
  })
  .readonly();

export const ModelLatencyMetadataV1Schema = z
  .strictObject({
    unit: z.literal('milliseconds'),
    total: z.int().min(0).max(600_000),
  })
  .readonly();

export const ModelRetryMetadataV1Schema = z
  .strictObject({
    attemptCount: z.int().min(1).max(10),
    retryCount: z.int().min(0).max(9),
    failedAttemptCount: z.int().min(0).max(10),
  })
  .superRefine((retry, context) => {
    if (
      retry.retryCount !== retry.attemptCount - 1 ||
      retry.failedAttemptCount > retry.attemptCount
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Retry metadata must describe one initial attempt plus exact retries.',
      });
    }
  })
  .readonly();

export const EstimatedActualCostV1Schema = z
  .strictObject({
    estimated: BenchmarkCostBreakdownV1Schema,
    actual: BenchmarkCostBreakdownV1Schema,
  })
  .superRefine((cost, context) => {
    if (
      cost.estimated.pricingConfigId !== cost.actual.pricingConfigId ||
      cost.estimated.pricingConfigVersion !== cost.actual.pricingConfigVersion
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Estimated and actual costs must use the same versioned pricing configuration.',
      });
    }
  })
  .readonly();

export const SceneAnalysisInvocationMetadataV1Schema = z
  .strictObject({
    metadataVersion: z.literal(1),
    requestIdentity: AiModelRequestIdentityV1Schema,
    workflow: BannerAiWorkflowRefV1Schema,
    model: AiModelContractV1Schema,
    prompt: BannerAiPromptRefV1Schema,
    latency: ModelLatencyMetadataV1Schema,
    retry: ModelRetryMetadataV1Schema,
    cost: EstimatedActualCostV1Schema,
  })
  .readonly();

const SuccessfulSceneAnalysisInvocationV1Schema = z
  .strictObject({
    kind: z.literal('success'),
    metadata: SceneAnalysisInvocationMetadataV1Schema,
    output: StructuredSceneAnalysisOutputV1Schema,
  })
  .readonly();

const MalformedSceneAnalysisInvocationV1Schema = z
  .strictObject({
    kind: z.literal('malformed-output'),
    metadata: SceneAnalysisInvocationMetadataV1Schema,
    rawOutput: z.json(),
  })
  .readonly();

const TimedOutSceneAnalysisInvocationV1Schema = z
  .strictObject({
    kind: z.literal('timeout'),
    metadata: SceneAnalysisInvocationMetadataV1Schema,
    timeout: z
      .strictObject({
        code: z.literal('MODEL_TIMEOUT'),
        timeoutMs: z.int().min(1).max(600_000),
      })
      .readonly(),
  })
  .readonly();

export const SceneAnalysisModelInvocationV1Schema = z
  .discriminatedUnion('kind', [
    SuccessfulSceneAnalysisInvocationV1Schema,
    MalformedSceneAnalysisInvocationV1Schema,
    TimedOutSceneAnalysisInvocationV1Schema,
  ])
  .superRefine((invocation, context) => {
    if (
      invocation.kind === 'malformed-output' &&
      StructuredSceneAnalysisOutputV1Schema.safeParse(invocation.rawOutput).success
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Malformed-output invocation must carry raw data that fails the output schema.',
        path: ['rawOutput'],
      });
    }
    if (
      invocation.kind === 'timeout' &&
      invocation.metadata.latency.total !== invocation.timeout.timeoutMs
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Timeout latency must equal the deterministic timeout boundary.',
        path: ['metadata', 'latency'],
      });
    }
  });

export type AiModelCapability = z.infer<typeof AiModelCapabilitySchema>;
export type AiModelCapabilitiesV1 = z.infer<typeof AiModelCapabilitiesV1Schema>;
export type AiModelProviderIdentityV1 = z.infer<typeof AiModelProviderIdentityV1Schema>;
export type AiModelContractV1 = z.infer<typeof AiModelContractV1Schema>;
export type BannerAiWorkflowRefV1 = z.infer<typeof BannerAiWorkflowRefV1Schema>;
export type AiInputDigestV1 = z.infer<typeof AiInputDigestV1Schema>;
export type AiModelRequestIdentityV1 = z.infer<typeof AiModelRequestIdentityV1Schema>;
export type SceneAnalysisModelInputV1 = z.infer<typeof SceneAnalysisModelInputV1Schema>;
export type SceneAnalysisModelRequestV1 = z.infer<typeof SceneAnalysisModelRequestV1Schema>;
export type SceneAnalysisModelInvocationV1 = z.infer<typeof SceneAnalysisModelInvocationV1Schema>;
export type LayerProposalV1 = z.infer<typeof LayerProposalV1Schema>;
export type StructuredSceneAnalysisOutputV1 = z.infer<typeof StructuredSceneAnalysisOutputV1Schema>;
export type SegmentationMaskReferenceV1 = z.infer<typeof SegmentationMaskReferenceV1Schema>;
export type BackgroundFillModelInputV1 = z.infer<typeof BackgroundFillModelInputV1Schema>;
export type BackgroundFillModelRequestV1 = z.infer<typeof BackgroundFillModelRequestV1Schema>;
export type AnimationPlanModelInputV1 = z.infer<typeof AnimationPlanModelInputV1Schema>;
export type AnimationPlanModelRequestV1 = z.infer<typeof AnimationPlanModelRequestV1Schema>;

const sameCanonicalValue = (left: unknown, right: unknown): boolean =>
  canonicalizeJson(left) === canonicalizeJson(right);

export const validateInitialBannerAnalyzeWorkflowRefV1 = (
  input: unknown,
): BannerAiWorkflowRefV1 => {
  const workflow = BannerAiWorkflowRefV1Schema.parse(input);
  if (!sameCanonicalValue(workflow, INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1)) {
    throw new TypeError('AI request uses a stale or foreign Banner analyze workflow identity.');
  }
  return workflow;
};

export const validateSceneAnalysisRequestContextV1 = (input: {
  readonly request: unknown;
  readonly expectedModel: unknown;
  readonly expectedWorkflow?: unknown;
}): SceneAnalysisModelRequestV1 => {
  const request = SceneAnalysisModelRequestV1Schema.parse(input.request);
  const expectedModel = AiModelContractV1Schema.parse(input.expectedModel);
  const expectedWorkflow = BannerAiWorkflowRefV1Schema.parse(
    input.expectedWorkflow ?? INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
  );
  if (
    !sameCanonicalValue(request.input.model, expectedModel) ||
    !sameCanonicalValue(request.input.workflow, expectedWorkflow)
  ) {
    throw new TypeError('Scene-analysis request uses a foreign model or workflow identity.');
  }
  return request;
};

const assertInvocationMetadataMatchesRequest = (
  request: SceneAnalysisModelRequestV1,
  metadata: z.infer<typeof SceneAnalysisInvocationMetadataV1Schema>,
): void => {
  if (
    !sameCanonicalValue(metadata.requestIdentity, request.requestIdentity) ||
    !sameCanonicalValue(metadata.workflow, request.input.workflow) ||
    !sameCanonicalValue(metadata.model, request.input.model) ||
    !sameCanonicalValue(metadata.prompt, request.input.prompt)
  ) {
    throw new TypeError(
      'Scene-analysis result identity differs from its authoritative request context.',
    );
  }
};

export const validateSceneAnalysisInvocationForRequestV1 = (input: {
  readonly request: unknown;
  readonly invocation: unknown;
}): SceneAnalysisModelInvocationV1 => {
  const request = SceneAnalysisModelRequestV1Schema.parse(input.request);
  const invocation = SceneAnalysisModelInvocationV1Schema.parse(input.invocation);
  assertInvocationMetadataMatchesRequest(request, invocation.metadata);
  if (invocation.kind === 'success') {
    validateCompositionAnalysisResultV1({
      request: {
        sourceAsset: request.input.sourceAsset,
        maxParts: request.input.options.maxParts,
        includeBackground: request.input.options.includeBackground,
      },
      result: invocation.output,
    });
  }
  return invocation;
};

export const promptRefMatches = (left: BannerAiPromptRefV1, right: BannerAiPromptRefV1): boolean =>
  sameCanonicalValue(left, right);
