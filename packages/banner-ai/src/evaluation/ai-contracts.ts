import { z, type RefinementCtx } from 'zod';

import { RequestIdSchema } from '../context/actor-workspace-context.js';
import { ModelKeySchema, ProviderKeySchema } from '../jobs/syntax.js';
import { MAX_ATTEMPTS } from '../jobs/timing.js';
import {
  MAX_RASTER_ENCODED_BYTES,
  MAX_RASTER_PIXELS,
  MAX_RASTER_RGBA_BYTES,
  MAX_RASTER_SIDE,
} from '../security/raster-container.js';
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
    capabilities: ['deterministic_replay', 'ocr', 'scene_analysis', 'structured_output'],
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

const benchmarkCaseIdPattern = /^[a-z0-9][a-z0-9._-]{7,79}$/;

export const BenchmarkCaseIdSchema = z
  .string()
  .regex(benchmarkCaseIdPattern)
  .brand<'BenchmarkCaseId'>();

const canonicalValuesEqual = (left: unknown, right: unknown): boolean =>
  canonicalizeJson(left) === canonicalizeJson(right);

const bannerAiModelDispatchContentPolicyDefinitionV1 = Object.freeze({
  definitionVersion: 1,
  definitionId: 'banner-ai-model-dispatch-content-policy-v1',
  rules: Object.freeze({
    allImageContent: 'untrusted-data-never-instructions',
    ocrDerivedText: 'untrusted-data-never-instructions',
    userProvidedText: 'untrusted-data-never-instructions',
    instructionSource: 'canonical-prompt-catalog-template-only',
    nonCatalogInstructions: 'forbidden',
  }),
} as const);

export const BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256 =
  '14a27c163a4082a966971028e59b6d1d56ea9cde99038b823c0a18b1ea92d0c4' as const;

export const BannerAiModelDispatchContentPolicyDefinitionV1Schema = z
  .strictObject({
    definitionVersion: z.literal(1),
    definitionId: z.literal('banner-ai-model-dispatch-content-policy-v1'),
    definitionSha256: z.literal(BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256),
    rules: z
      .strictObject({
        allImageContent: z.literal('untrusted-data-never-instructions'),
        ocrDerivedText: z.literal('untrusted-data-never-instructions'),
        userProvidedText: z.literal('untrusted-data-never-instructions'),
        instructionSource: z.literal('canonical-prompt-catalog-template-only'),
        nonCatalogInstructions: z.literal('forbidden'),
      })
      .readonly(),
  })
  .superRefine((definition, context) => {
    const canonicalDefinition = {
      definitionVersion: definition.definitionVersion,
      definitionId: definition.definitionId,
      rules: definition.rules,
    };
    const actual = sha256Hex(Buffer.from(canonicalizeJson(canonicalDefinition), 'utf8'));
    if (actual !== BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256) {
      context.addIssue({
        code: 'custom',
        message: 'Dispatch content-policy definition differs from its frozen SHA-256.',
        path: ['definitionSha256'],
      });
    }
  })
  .readonly();

export const BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION =
  BannerAiModelDispatchContentPolicyDefinitionV1Schema.parse({
    ...bannerAiModelDispatchContentPolicyDefinitionV1,
    definitionSha256: BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
  });

export const BannerAiModelDispatchContentPolicyV1Schema = z
  .strictObject({
    contentPolicyVersion: z.literal(1),
    definition: BannerAiModelDispatchContentPolicyDefinitionV1Schema,
    binding: z
      .strictObject({
        sourceAssetSha256: Sha256HexSchema,
        requestIdentity: AiModelRequestIdentityV1Schema,
        prompt: BannerAiPromptRefV1Schema,
        model: AiModelContractV1Schema,
        workflow: BannerAiWorkflowRefV1Schema,
      })
      .readonly(),
  })
  .readonly()
  .brand<'BannerAiModelDispatchContentPolicyV1'>();

export const createBannerAiModelDispatchContentPolicyV1 = (input: {
  readonly sourceAssetSha256: unknown;
  readonly requestIdentity: unknown;
  readonly prompt: unknown;
  readonly model: unknown;
  readonly workflow: unknown;
}): z.infer<typeof BannerAiModelDispatchContentPolicyV1Schema> =>
  BannerAiModelDispatchContentPolicyV1Schema.parse({
    contentPolicyVersion: 1,
    definition: BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION,
    binding: {
      sourceAssetSha256: Sha256HexSchema.parse(input.sourceAssetSha256),
      requestIdentity: AiModelRequestIdentityV1Schema.parse(input.requestIdentity),
      prompt: BannerAiPromptRefV1Schema.parse(input.prompt),
      model: AiModelContractV1Schema.parse(input.model),
      workflow: BannerAiWorkflowRefV1Schema.parse(input.workflow),
    },
  });

export const validateBannerAiModelDispatchContentPolicyV1 = (input: {
  readonly contentPolicy: unknown;
  readonly sourceAssetSha256: unknown;
  readonly requestIdentity: unknown;
  readonly prompt: unknown;
  readonly model: unknown;
  readonly workflow: unknown;
}): z.infer<typeof BannerAiModelDispatchContentPolicyV1Schema> => {
  const contentPolicy = BannerAiModelDispatchContentPolicyV1Schema.parse(input.contentPolicy);
  const expected = createBannerAiModelDispatchContentPolicyV1(input);
  if (!canonicalValuesEqual(contentPolicy, expected)) {
    throw new TypeError(
      'Dispatch content policy is stale, foreign, substituted, or altered for its request context.',
    );
  }
  return contentPolicy;
};

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

export const BannerAiRasterDispatchDimensionsV1Schema = z
  .strictObject({
    pixelWidth: z.int().min(1).max(MAX_RASTER_SIDE),
    pixelHeight: z.int().min(1).max(MAX_RASTER_SIDE),
  })
  .superRefine((dimensions, context) => {
    const pixels = dimensions.pixelWidth * dimensions.pixelHeight;
    if (pixels > MAX_RASTER_PIXELS || pixels * 4 > MAX_RASTER_RGBA_BYTES) {
      context.addIssue({
        code: 'custom',
        message: 'Raster dispatch dimensions exceed Banner decoded-pixel product limits.',
      });
    }
  })
  .readonly();

export const BannerAiRasterDispatchAssetV1Schema = AssetVersionRefV1Schema.superRefine(
  (asset, context) => {
    if (asset.byteSize > MAX_RASTER_ENCODED_BYTES) {
      context.addIssue({
        code: 'custom',
        message: 'Raster dispatch source exceeds the Banner encoded-byte product limit.',
        path: ['byteSize'],
      });
    }
    const dimensions = BannerAiRasterDispatchDimensionsV1Schema.safeParse({
      pixelWidth: asset.pixelWidth,
      pixelHeight: asset.pixelHeight,
    });
    if (!dimensions.success) {
      context.addIssue({
        code: 'custom',
        message: 'Raster dispatch source dimensions exceed Banner product limits.',
      });
    }
  },
).readonly();

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
    sourceAsset: BannerAiRasterDispatchAssetV1Schema,
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
    contentPolicy: BannerAiModelDispatchContentPolicyV1Schema,
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
    try {
      validateBannerAiModelDispatchContentPolicyV1({
        contentPolicy: request.contentPolicy,
        sourceAssetSha256: request.input.sourceAsset.sha256,
        requestIdentity: request.requestIdentity,
        prompt: request.input.prompt,
        model: request.input.model,
        workflow: request.input.workflow,
      });
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Scene-analysis dispatch content policy differs from its request context.',
        path: ['contentPolicy'],
      });
    }
  })
  .readonly();

export const createSceneAnalysisModelRequestV1 = (input: {
  readonly requestId: unknown;
  readonly modelInput: unknown;
}): z.infer<typeof SceneAnalysisModelRequestV1Schema> => {
  const modelInput = SceneAnalysisModelInputV1Schema.parse(input.modelInput);
  const requestIdentity = AiModelRequestIdentityV1Schema.parse({
    identityVersion: 1,
    requestId: input.requestId,
    inputDigest: sceneAnalysisModelInputDigestV1(modelInput),
  });
  return SceneAnalysisModelRequestV1Schema.parse({
    requestVersion: 1,
    requestIdentity,
    contentPolicy: createBannerAiModelDispatchContentPolicyV1({
      sourceAssetSha256: modelInput.sourceAsset.sha256,
      requestIdentity,
      prompt: modelInput.prompt,
      model: modelInput.model,
      workflow: modelInput.workflow,
    }),
    input: modelInput,
  });
};

export const validateSceneAnalysisModelDispatchContentPolicyV1 = (
  input: unknown,
): z.infer<typeof SceneAnalysisModelRequestV1Schema> => {
  const request = SceneAnalysisModelRequestV1Schema.parse(input);
  validateBannerAiModelDispatchContentPolicyV1({
    contentPolicy: request.contentPolicy,
    sourceAssetSha256: request.input.sourceAsset.sha256,
    requestIdentity: request.requestIdentity,
    prompt: request.input.prompt,
    model: request.input.model,
    workflow: request.input.workflow,
  });
  return request;
};

const unsafeObservedTextPattern = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;
const observedWhitespacePattern = /\p{White_Space}+/gu;

export const NormalizedObservedTextValueV1Schema = z
  .string()
  .superRefine((value, context) => {
    if (
      [...value].length < 1 ||
      [...value].length > 500 ||
      value.normalize('NFC') !== value ||
      value.replace(observedWhitespacePattern, ' ').trim() !== value ||
      unsafeObservedTextPattern.test(value)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Observed text must be trimmed NFC text with canonical single-space separation.',
      });
    }
  })
  .brand<'NormalizedObservedTextValueV1'>();

export const normalizeObservedTextValueV1 = (
  input: unknown,
): z.infer<typeof NormalizedObservedTextValueV1Schema> => {
  const value = z.string().parse(input);
  return NormalizedObservedTextValueV1Schema.parse(
    value.normalize('NFC').replace(observedWhitespacePattern, ' ').trim(),
  );
};

export const TextObservationBoundingBoxV1Schema = z
  .strictObject({
    unit: z.literal('normalized-basis-points'),
    xBps: z.int().min(0).max(9_999),
    yBps: z.int().min(0).max(9_999),
    widthBps: z.int().min(1).max(10_000),
    heightBps: z.int().min(1).max(10_000),
  })
  .superRefine((box, context) => {
    if (box.xBps + box.widthBps > 10_000 || box.yBps + box.heightBps > 10_000) {
      context.addIssue({
        code: 'custom',
        message: 'Observed-text bounding box exceeds the normalized source coordinate space.',
      });
    }
  })
  .readonly();

export const TextObservationConfidenceV1Schema = z
  .strictObject({
    unit: z.literal('basis-points'),
    valueBps: z.int().min(0).max(10_000),
  })
  .readonly();

export const TextObservationV1Schema = z
  .strictObject({
    observationVersion: z.literal(1),
    observationId: OpaqueIdSchema,
    text: z
      .strictObject({
        kind: z.literal('observed-text'),
        value: NormalizedObservedTextValueV1Schema,
        normalization: z.literal('unicode-nfc-single-space-v1'),
        contentTrust: z.literal('untrusted-user-image-content'),
        instructionAuthority: z.literal('none'),
      })
      .readonly(),
    boundingBox: TextObservationBoundingBoxV1Schema,
    confidence: TextObservationConfidenceV1Schema,
  })
  .readonly();

const textObservationRequestProvenanceShape = {
  sourceAssetSha256: Sha256HexSchema,
  requestIdentity: AiModelRequestIdentityV1Schema,
  model: AiModelContractV1Schema,
  prompt: BannerAiPromptRefV1Schema,
  workflow: BannerAiWorkflowRefV1Schema,
} as const;

export const ExpectedBenchmarkTextObservationContextV1Schema = z
  .strictObject({
    caseId: BenchmarkCaseIdSchema,
    caseVersion: z.literal(1),
    inputDigest: AiInputDigestV1Schema,
    fixture: RepositoryFixtureInputRefV1Schema,
  })
  .readonly();

const BenchmarkExpectedTextObservationProvenanceV1Schema = z
  .strictObject({
    provenanceVersion: z.literal(1),
    evidenceRole: z.literal('benchmark-expected-oracle'),
    producer: z
      .strictObject({
        kind: z.literal('repository-benchmark-fixture-oracle'),
      })
      .readonly(),
    ...textObservationRequestProvenanceShape,
    benchmarkCase: ExpectedBenchmarkTextObservationContextV1Schema,
  })
  .readonly();

const ModelProducedActualTextObservationProvenanceV1Schema = z
  .strictObject({
    provenanceVersion: z.literal(1),
    evidenceRole: z.literal('model-produced-actual'),
    producer: z
      .strictObject({
        kind: z.literal('model-produced-ocr-observation'),
      })
      .readonly(),
    ...textObservationRequestProvenanceShape,
  })
  .readonly();

const addTextObservationIdIssues = (
  set: { readonly observations: readonly z.infer<typeof TextObservationV1Schema>[] },
  context: RefinementCtx,
): void => {
  const observationIds = set.observations.map((observation) => observation.observationId);
  if (new Set(observationIds).size !== observationIds.length) {
    context.addIssue({
      code: 'custom',
      message: 'Text observation IDs must be unique within their provenance-bound set.',
      path: ['observations'],
    });
  }
};

export const BenchmarkExpectedTextObservationSetV1Schema = z
  .strictObject({
    observationSetVersion: z.literal(1),
    provenance: BenchmarkExpectedTextObservationProvenanceV1Schema,
    observations: z.array(TextObservationV1Schema).max(100).readonly(),
  })
  .superRefine(addTextObservationIdIssues)
  .readonly()
  .brand<'BenchmarkExpectedTextObservationSetV1'>();

export const ModelProducedActualTextObservationSetV1Schema = z
  .strictObject({
    observationSetVersion: z.literal(1),
    provenance: ModelProducedActualTextObservationProvenanceV1Schema,
    observations: z.array(TextObservationV1Schema).max(100).readonly(),
  })
  .superRefine(addTextObservationIdIssues)
  .readonly()
  .brand<'ModelProducedActualTextObservationSetV1'>();

type TextObservationRequestProvenanceV1 = {
  readonly sourceAssetSha256: string;
  readonly requestIdentity: z.infer<typeof AiModelRequestIdentityV1Schema>;
  readonly model: z.infer<typeof AiModelContractV1Schema>;
  readonly prompt: z.infer<typeof BannerAiPromptRefV1Schema>;
  readonly workflow: z.infer<typeof BannerAiWorkflowRefV1Schema>;
};

const assertTextObservationProvenanceMatchesRequest = (
  request: z.infer<typeof SceneAnalysisModelRequestV1Schema>,
  provenance: TextObservationRequestProvenanceV1,
): void => {
  if (
    provenance.sourceAssetSha256 !== request.input.sourceAsset.sha256 ||
    !canonicalValuesEqual(provenance.requestIdentity, request.requestIdentity) ||
    !canonicalValuesEqual(provenance.model, request.input.model) ||
    !canonicalValuesEqual(provenance.prompt, request.input.prompt) ||
    !canonicalValuesEqual(provenance.workflow, request.input.workflow)
  ) {
    throw new TypeError(
      'Text-observation provenance uses a stale or foreign source, request, model, prompt, or workflow identity.',
    );
  }
};

const assertExpectedBenchmarkObservationContextMatchesRequest = (
  request: z.infer<typeof SceneAnalysisModelRequestV1Schema>,
  benchmarkCase: z.infer<typeof ExpectedBenchmarkTextObservationContextV1Schema>,
): void => {
  if (
    !canonicalValuesEqual(benchmarkCase.inputDigest, request.requestIdentity.inputDigest) ||
    !canonicalValuesEqual(benchmarkCase.fixture, request.input.fixture)
  ) {
    throw new TypeError(
      'Expected text-observation provenance uses a stale or foreign benchmark input or fixture.',
    );
  }
};

export const validateBenchmarkExpectedTextObservationsForSceneAnalysisRequestV1 = (input: {
  readonly request: unknown;
  readonly benchmarkCase: unknown;
  readonly expectedObservations: unknown;
}): z.infer<typeof BenchmarkExpectedTextObservationSetV1Schema> => {
  const request = SceneAnalysisModelRequestV1Schema.parse(input.request);
  const benchmarkCase = ExpectedBenchmarkTextObservationContextV1Schema.parse(input.benchmarkCase);
  const expectedObservations = BenchmarkExpectedTextObservationSetV1Schema.parse(
    input.expectedObservations,
  );
  assertTextObservationProvenanceMatchesRequest(request, expectedObservations.provenance);
  assertExpectedBenchmarkObservationContextMatchesRequest(request, benchmarkCase);
  if (!canonicalValuesEqual(expectedObservations.provenance.benchmarkCase, benchmarkCase)) {
    throw new TypeError(
      'Expected text-observation provenance uses a stale or foreign benchmark case identity.',
    );
  }
  return expectedObservations;
};

export const validateModelProducedTextObservationsForSceneAnalysisRequestV1 = (input: {
  readonly request: unknown;
  readonly actualObservations: unknown;
}): z.infer<typeof ModelProducedActualTextObservationSetV1Schema> => {
  const request = SceneAnalysisModelRequestV1Schema.parse(input.request);
  const actualObservations = ModelProducedActualTextObservationSetV1Schema.parse(
    input.actualObservations,
  );
  assertTextObservationProvenanceMatchesRequest(request, actualObservations.provenance);
  if (!actualObservations.provenance.model.capabilities.capabilities.includes('ocr')) {
    throw new TypeError(
      'Model-produced text observations require an OCR-capable bound model identity.',
    );
  }
  return actualObservations;
};

export const createBenchmarkExpectedTextObservationSetV1 = (input: {
  readonly request: unknown;
  readonly benchmarkCase: unknown;
  readonly observations: unknown;
}): z.infer<typeof BenchmarkExpectedTextObservationSetV1Schema> => {
  const request = SceneAnalysisModelRequestV1Schema.parse(input.request);
  const benchmarkCase = ExpectedBenchmarkTextObservationContextV1Schema.parse(input.benchmarkCase);
  assertExpectedBenchmarkObservationContextMatchesRequest(request, benchmarkCase);
  const expectedObservations = BenchmarkExpectedTextObservationSetV1Schema.parse({
    observationSetVersion: 1,
    provenance: {
      provenanceVersion: 1,
      evidenceRole: 'benchmark-expected-oracle',
      producer: { kind: 'repository-benchmark-fixture-oracle' },
      sourceAssetSha256: request.input.sourceAsset.sha256,
      requestIdentity: request.requestIdentity,
      model: request.input.model,
      prompt: request.input.prompt,
      workflow: request.input.workflow,
      benchmarkCase,
    },
    observations: input.observations,
  });
  return validateBenchmarkExpectedTextObservationsForSceneAnalysisRequestV1({
    request,
    benchmarkCase,
    expectedObservations,
  });
};

export const createModelProducedActualTextObservationSetV1 = (input: {
  readonly request: unknown;
  readonly observations: unknown;
}): z.infer<typeof ModelProducedActualTextObservationSetV1Schema> => {
  const request = SceneAnalysisModelRequestV1Schema.parse(input.request);
  const actualObservations = ModelProducedActualTextObservationSetV1Schema.parse({
    observationSetVersion: 1,
    provenance: {
      provenanceVersion: 1,
      evidenceRole: 'model-produced-actual',
      producer: { kind: 'model-produced-ocr-observation' },
      sourceAssetSha256: request.input.sourceAsset.sha256,
      requestIdentity: request.requestIdentity,
      model: request.input.model,
      prompt: request.input.prompt,
      workflow: request.input.workflow,
    },
    observations: input.observations,
  });
  return validateModelProducedTextObservationsForSceneAnalysisRequestV1({
    request,
    actualObservations,
  });
};

export const SegmentationMaskReferenceV1Schema = z
  .strictObject({
    referenceVersion: z.literal(1),
    segmentationId: OpaqueIdSchema,
    sourceAssetSha256: Sha256HexSchema,
    maskAsset: BannerAiRasterDispatchAssetV1Schema,
    coordinateSpace: BannerAiRasterDispatchDimensionsV1Schema,
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

export const BackgroundFillModelInputV1Schema = z
  .strictObject({
    inputVersion: z.literal(1),
    sourceAsset: BannerAiRasterDispatchAssetV1Schema,
    mask: SegmentationMaskReferenceV1Schema,
    output: BannerAiRasterDispatchDimensionsV1Schema,
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
    if (
      input.output.pixelWidth > input.sourceAsset.pixelWidth ||
      input.output.pixelHeight > input.sourceAsset.pixelHeight
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Background-fill output dimensions cannot exceed the validated source.',
        path: ['output'],
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
    contentPolicy: BannerAiModelDispatchContentPolicyV1Schema,
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
    try {
      validateBannerAiModelDispatchContentPolicyV1({
        contentPolicy: request.contentPolicy,
        sourceAssetSha256: request.input.sourceAsset.sha256,
        requestIdentity: request.requestIdentity,
        prompt: request.input.prompt,
        model: request.input.model,
        workflow: request.input.workflow,
      });
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Background-fill dispatch content policy differs from its request context.',
        path: ['contentPolicy'],
      });
    }
  })
  .readonly();

export const createBackgroundFillModelRequestV1 = (input: {
  readonly requestId: unknown;
  readonly modelInput: unknown;
}): z.infer<typeof BackgroundFillModelRequestV1Schema> => {
  const modelInput = BackgroundFillModelInputV1Schema.parse(input.modelInput);
  const requestIdentity = AiModelRequestIdentityV1Schema.parse({
    identityVersion: 1,
    requestId: input.requestId,
    inputDigest: backgroundFillModelInputDigestV1(modelInput),
  });
  return BackgroundFillModelRequestV1Schema.parse({
    requestVersion: 1,
    requestIdentity,
    contentPolicy: createBannerAiModelDispatchContentPolicyV1({
      sourceAssetSha256: modelInput.sourceAsset.sha256,
      requestIdentity,
      prompt: modelInput.prompt,
      model: modelInput.model,
      workflow: modelInput.workflow,
    }),
    input: modelInput,
  });
};

export const LayerProposalV1Schema = CompositionPartV1Schema;
export const StructuredSceneAnalysisOutputV1Schema = CompositionAnalysisResultV1Schema;

export const AnimationPlanModelInputV1Schema = z
  .strictObject({
    inputVersion: z.literal(1),
    sourceAssetSha256: Sha256HexSchema,
    canvas: BannerAiRasterDispatchDimensionsV1Schema,
    layerProposals: z.array(LayerProposalV1Schema).min(1).max(5).readonly(),
    options: z
      .strictObject({
        durationMs: z.int().min(1).max(30_000),
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
    contentPolicy: BannerAiModelDispatchContentPolicyV1Schema,
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
    try {
      validateBannerAiModelDispatchContentPolicyV1({
        contentPolicy: request.contentPolicy,
        sourceAssetSha256: request.input.sourceAssetSha256,
        requestIdentity: request.requestIdentity,
        prompt: request.input.prompt,
        model: request.input.model,
        workflow: request.input.workflow,
      });
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Animation-plan dispatch content policy differs from its request context.',
        path: ['contentPolicy'],
      });
    }
  })
  .readonly();

export const createAnimationPlanModelRequestV1 = (input: {
  readonly requestId: unknown;
  readonly modelInput: unknown;
}): z.infer<typeof AnimationPlanModelRequestV1Schema> => {
  const modelInput = AnimationPlanModelInputV1Schema.parse(input.modelInput);
  const requestIdentity = AiModelRequestIdentityV1Schema.parse({
    identityVersion: 1,
    requestId: input.requestId,
    inputDigest: animationPlanModelInputDigestV1(modelInput),
  });
  return AnimationPlanModelRequestV1Schema.parse({
    requestVersion: 1,
    requestIdentity,
    contentPolicy: createBannerAiModelDispatchContentPolicyV1({
      sourceAssetSha256: modelInput.sourceAssetSha256,
      requestIdentity,
      prompt: modelInput.prompt,
      model: modelInput.model,
      workflow: modelInput.workflow,
    }),
    input: modelInput,
  });
};

export const ModelLatencyMetadataV1Schema = z
  .strictObject({
    unit: z.literal('milliseconds'),
    total: z.int().min(0).max(600_000),
  })
  .readonly();

export const ModelRetryMetadataV1Schema = z
  .strictObject({
    attemptCount: z.int().min(1).max(MAX_ATTEMPTS),
    retryCount: z
      .int()
      .min(0)
      .max(MAX_ATTEMPTS - 1),
    failedAttemptCount: z.int().min(0).max(MAX_ATTEMPTS),
  })
  .superRefine((retry, context) => {
    if (retry.retryCount !== retry.attemptCount - 1) {
      context.addIssue({
        code: 'custom',
        message: 'Retry metadata must describe one initial attempt plus exact retries.',
        path: ['retryCount'],
      });
    }
    if (retry.failedAttemptCount > retry.attemptCount) {
      context.addIssue({
        code: 'custom',
        message: 'Failed-attempt count cannot exceed the total attempt count.',
        path: ['failedAttemptCount'],
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
  .superRefine((metadata, context) => {
    if (metadata.cost.actual.components.retries.usageUnits !== metadata.retry.retryCount) {
      context.addIssue({
        code: 'custom',
        message: 'Actual retry cost usage must equal retry metadata.',
        path: ['cost', 'actual', 'components', 'retries', 'usageUnits'],
      });
    }
    if (
      metadata.cost.actual.components.failedAttempts.usageUnits !==
      metadata.retry.failedAttemptCount
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Actual failed-attempt cost usage must equal failed-attempt metadata.',
        path: ['cost', 'actual', 'components', 'failedAttempts', 'usageUnits'],
      });
    }
  })
  .readonly();

const SuccessfulSceneAnalysisInvocationV1Schema = z
  .strictObject({
    kind: z.literal('success'),
    metadata: SceneAnalysisInvocationMetadataV1Schema,
    output: StructuredSceneAnalysisOutputV1Schema,
    textObservations: ModelProducedActualTextObservationSetV1Schema,
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
    const expectedFailedAttempts =
      invocation.kind === 'success'
        ? invocation.metadata.retry.attemptCount - 1
        : invocation.metadata.retry.attemptCount;
    if (invocation.metadata.retry.failedAttemptCount !== expectedFailedAttempts) {
      context.addIssue({
        code: 'custom',
        message: 'Failed-attempt metadata contradicts the invocation outcome.',
        path: ['metadata', 'retry', 'failedAttemptCount'],
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
export type BenchmarkCaseId = z.infer<typeof BenchmarkCaseIdSchema>;
export type BannerAiModelDispatchContentPolicyV1 = z.infer<
  typeof BannerAiModelDispatchContentPolicyV1Schema
>;
export type RepositoryFixtureInputRefV1 = z.infer<typeof RepositoryFixtureInputRefV1Schema>;
export type BannerAiRasterDispatchDimensionsV1 = z.infer<
  typeof BannerAiRasterDispatchDimensionsV1Schema
>;
export type BannerAiRasterDispatchAssetV1 = z.infer<typeof BannerAiRasterDispatchAssetV1Schema>;
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
export type TextObservationV1 = z.infer<typeof TextObservationV1Schema>;
export type ExpectedBenchmarkTextObservationContextV1 = z.infer<
  typeof ExpectedBenchmarkTextObservationContextV1Schema
>;
export type BenchmarkExpectedTextObservationSetV1 = z.infer<
  typeof BenchmarkExpectedTextObservationSetV1Schema
>;
export type ModelProducedActualTextObservationSetV1 = z.infer<
  typeof ModelProducedActualTextObservationSetV1Schema
>;

const sameCanonicalValue = (left: unknown, right: unknown): boolean =>
  canonicalValuesEqual(left, right);

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
    validateModelProducedTextObservationsForSceneAnalysisRequestV1({
      request,
      actualObservations: invocation.textObservations,
    });
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
