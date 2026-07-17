import { z, type RefinementCtx } from 'zod';

import { OutputKeySchema } from '../jobs/syntax.js';
import { OpaqueIdSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import { CompositionPartV1Schema } from '../workflows/composition-contracts.js';
import { NormalizedObservedTextValueV1Schema } from './ai-contracts.js';

const QwenSemanticReviewFlagV1Schema = z.enum([
  'ambiguous-overlap',
  'low-confidence',
  'possible-occlusion',
  'text-needs-review',
]);

const reviewFlagOrder = new Map(
  QwenSemanticReviewFlagV1Schema.options.map((flag, index) => [flag, index]),
);

const QwenSemanticReviewFlagsV1Schema = z
  .array(QwenSemanticReviewFlagV1Schema)
  .max(QwenSemanticReviewFlagV1Schema.options.length)
  .superRefine((flags, context) => {
    if (new Set(flags).size !== flags.length) {
      context.addIssue({ code: 'custom', message: 'Review flags must be unique.' });
    }
    for (let index = 1; index < flags.length; index += 1) {
      if (reviewFlagOrder.get(flags[index - 1]!)! >= reviewFlagOrder.get(flags[index]!)!) {
        context.addIssue({ code: 'custom', message: 'Review flags must use canonical order.' });
        break;
      }
    }
  })
  .readonly();

const QwenSemanticCompositionProposalV1Schema = z
  .strictObject({
    kind: z.literal('composition_proposal'),
    parts: z.array(CompositionPartV1Schema).min(3).max(5).readonly(),
  })
  .superRefine((proposal, context) => {
    const seen = new Set<string>();
    for (const [index, part] of proposal.parts.entries()) {
      if (seen.has(part.partKey)) {
        context.addIssue({
          code: 'custom',
          message: 'Composition part keys must be unique.',
          path: ['parts', index, 'partKey'],
        });
      }
      seen.add(part.partKey);
    }
  })
  .readonly();

const QwenSemanticNoUsefulLayersV1Schema = z
  .strictObject({
    kind: z.literal('no_useful_layers'),
    reason: z.enum(['flat_image', 'insufficient_separation', 'unsupported_composition']),
  })
  .readonly();

const QwenSemanticCompositionV1Schema = z.discriminatedUnion('kind', [
  QwenSemanticCompositionProposalV1Schema,
  QwenSemanticNoUsefulLayersV1Schema,
]);

const QwenSemanticLayerEvidenceV1Schema = z
  .strictObject({
    partKey: OutputKeySchema,
    observationBasis: z.literal('directly-visible-in-source-image'),
    confidence: z
      .strictObject({
        valueBps: z.int().min(0).max(10_000),
      })
      .readonly(),
    reviewFlags: QwenSemanticReviewFlagsV1Schema,
  })
  .readonly();

const QwenSemanticOcrCompletionV1Schema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('visible-text-observations-complete') }).readonly(),
  z.strictObject({ kind: z.literal('no-visible-text-observed') }).readonly(),
]);

const QwenSemanticTextBoundingBoxV1Schema = z
  .strictObject({
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

const QwenSemanticObservationIdV1Schema = OpaqueIdSchema.refine(
  (observationId) => !/^[0-9]+$/u.test(observationId),
  'Observation IDs must not be numeric-only.',
);

const QwenSemanticTextObservationV1Schema = z
  .strictObject({
    observationId: QwenSemanticObservationIdV1Schema,
    text: z
      .strictObject({
        value: NormalizedObservedTextValueV1Schema,
      })
      .readonly(),
    boundingBox: QwenSemanticTextBoundingBoxV1Schema,
    confidence: z
      .strictObject({
        valueBps: z.int().min(0).max(10_000),
      })
      .readonly(),
  })
  .readonly();

const addQwenSemanticRelationIssues = (
  output: {
    readonly composition: z.infer<typeof QwenSemanticCompositionV1Schema>;
    readonly layerEvidence: readonly z.infer<typeof QwenSemanticLayerEvidenceV1Schema>[];
    readonly ocrCompletion: z.infer<typeof QwenSemanticOcrCompletionV1Schema>;
    readonly textObservations: readonly z.infer<typeof QwenSemanticTextObservationV1Schema>[];
  },
  context: RefinementCtx,
): void => {
  const expectedPartKeys =
    output.composition.kind === 'composition_proposal'
      ? output.composition.parts.map((part) => part.partKey)
      : [];
  const evidencePartKeys = output.layerEvidence.map((evidence) => evidence.partKey);
  if (
    expectedPartKeys.length !== evidencePartKeys.length ||
    expectedPartKeys.some((partKey, index) => evidencePartKeys[index] !== partKey)
  ) {
    context.addIssue({
      code: 'custom',
      message:
        'Layer evidence must exactly key the proposed composition parts in canonical part order.',
      path: ['layerEvidence'],
    });
  }
  const observationIds = output.textObservations.map((observation) => observation.observationId);
  if (new Set(observationIds).size !== observationIds.length) {
    context.addIssue({
      code: 'custom',
      message: 'Text observation IDs must be unique within the semantic response.',
      path: ['textObservations'],
    });
  }
  if (
    (output.ocrCompletion.kind === 'no-visible-text-observed') !==
    (output.textObservations.length === 0)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'OCR completion disposition must exactly account for the observation array.',
      path: ['ocrCompletion'],
    });
  }
};

/**
 * Provider-produced Qwen semantics only. Identity, source, trust, units, provenance, policy,
 * authorization, and decision-authority fields are server-owned and rejected here.
 */
export const QwenSemanticSceneAnalysisOutputV1Schema = z
  .strictObject({
    composition: QwenSemanticCompositionV1Schema,
    layerEvidence: z.array(QwenSemanticLayerEvidenceV1Schema).max(5).readonly(),
    ocrCompletion: QwenSemanticOcrCompletionV1Schema,
    textObservations: z.array(QwenSemanticTextObservationV1Schema).max(100).readonly(),
    reviewFlags: QwenSemanticReviewFlagsV1Schema,
  })
  .superRefine(addQwenSemanticRelationIssues)
  .readonly();

export type QwenSemanticSceneAnalysisOutputV1 = z.infer<
  typeof QwenSemanticSceneAnalysisOutputV1Schema
>;

const deepFreezeJson = <Value>(value: Value): Readonly<Value> => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value as Record<string, unknown>)) {
      deepFreezeJson(nested);
    }
    Object.freeze(value);
  }
  return value;
};

export const createDetachedQwenSemanticSceneAnalysisJsonSchemaV1 = (): Readonly<unknown> => {
  const projected = z.toJSONSchema(QwenSemanticSceneAnalysisOutputV1Schema);
  const detached = JSON.parse(JSON.stringify(projected)) as unknown;
  return deepFreezeJson(detached);
};

export const QWEN_SEMANTIC_SCENE_ANALYSIS_JSON_SCHEMA_V1 =
  createDetachedQwenSemanticSceneAnalysisJsonSchemaV1();

export const QWEN_SEMANTIC_SCENE_ANALYSIS_JSON_SCHEMA_V1_SHA256 = sha256Hex(
  Buffer.from(canonicalizeJson(QWEN_SEMANTIC_SCENE_ANALYSIS_JSON_SCHEMA_V1), 'utf8'),
);

export const parseQwenSemanticSceneAnalysisJsonV1 = (
  jsonText: unknown,
): QwenSemanticSceneAnalysisOutputV1 => {
  const text = z.string().min(1).parse(jsonText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new TypeError('Qwen semantic output must be one valid JSON value.');
  }
  return QwenSemanticSceneAnalysisOutputV1Schema.parse(parsed);
};
