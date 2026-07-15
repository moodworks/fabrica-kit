import { z } from 'zod';

import { OutputKeySchema } from '../jobs/syntax.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import { CompositionAnalysisResultV1Schema } from '../workflows/composition-contracts.js';
import { TextObservationV1Schema } from './ai-contracts.js';

const ReviewFlagV1Schema = z.enum([
  'ambiguous-overlap',
  'low-confidence',
  'possible-occlusion',
  'text-needs-review',
]);

const reviewFlagOrder = new Map(ReviewFlagV1Schema.options.map((flag, index) => [flag, index]));

const CanonicalReviewFlagsV1Schema = z
  .array(ReviewFlagV1Schema)
  .max(ReviewFlagV1Schema.options.length)
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

const OpenAiProposedLayerEvidenceV1Schema = z
  .strictObject({
    partKey: OutputKeySchema,
    observationBasis: z.literal('directly-visible-in-source-image'),
    confidence: z
      .strictObject({
        unit: z.literal('basis-points'),
        valueBps: z.int().min(0).max(10_000),
      })
      .readonly(),
    reviewFlags: CanonicalReviewFlagsV1Schema,
  })
  .readonly();

const OpenAiOcrCompletionV1Schema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('visible-text-observations-complete'),
      observationCount: z.int().min(1).max(100),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('no-visible-text-observed'),
      observationCount: z.literal(0),
    })
    .readonly(),
]);

/**
 * Provider-produced JSON only. Request, provider, model, policy, authorization, and provenance
 * fields are deliberately absent and rejected by strict-object validation.
 */
export const ProposedSceneAnalysisOcrOutputV1Schema = z
  .strictObject({
    outputVersion: z.literal(1),
    visibleContentConstraint: z.literal('only-directly-visible-objects-and-text'),
    composition: CompositionAnalysisResultV1Schema,
    layerEvidence: z.array(OpenAiProposedLayerEvidenceV1Schema).max(5).readonly(),
    ocrCompletion: OpenAiOcrCompletionV1Schema,
    textObservations: z.array(TextObservationV1Schema).max(100).readonly(),
    reviewFlags: CanonicalReviewFlagsV1Schema,
    humanReview: z
      .strictObject({
        required: z.literal(true),
        proposalOnly: z.literal(true),
        automaticCutoutExportOrOtherDecisionAuthority: z.literal('none'),
      })
      .readonly(),
  })
  .superRefine((output, context) => {
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
    if (
      output.ocrCompletion.observationCount !== output.textObservations.length ||
      (output.ocrCompletion.kind === 'no-visible-text-observed' &&
        output.textObservations.length !== 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'OCR completion disposition must exactly account for the observation array.',
        path: ['ocrCompletion'],
      });
    }
  })
  .readonly();

export type ProposedSceneAnalysisOcrOutputV1 = z.infer<
  typeof ProposedSceneAnalysisOcrOutputV1Schema
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

export const createDetachedSceneAnalysisOcrJsonSchemaV1 = (): Readonly<unknown> => {
  const projected = z.toJSONSchema(ProposedSceneAnalysisOcrOutputV1Schema);
  const detached = JSON.parse(canonicalizeJson(projected)) as unknown;
  return deepFreezeJson(detached);
};

export const SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_V1 =
  createDetachedSceneAnalysisOcrJsonSchemaV1();

export const SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_SHA256 = sha256Hex(
  Buffer.from(canonicalizeJson(SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_V1), 'utf8'),
);

export const parseProposedSceneAnalysisOcrJsonV1 = (
  jsonText: unknown,
): ProposedSceneAnalysisOcrOutputV1 => {
  const text = z.string().min(1).parse(jsonText);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new TypeError('Scene-analysis output must be one valid JSON value.');
  }
  return ProposedSceneAnalysisOcrOutputV1Schema.parse(parsed);
};

/** Compatibility aliases retained for the earlier inactive OpenAI boundary. */
export const OpenAiProposedSceneAnalysisOcrOutputV1Schema = ProposedSceneAnalysisOcrOutputV1Schema;
export type OpenAiProposedSceneAnalysisOcrOutputV1 = ProposedSceneAnalysisOcrOutputV1;
export const createDetachedOpenAiSceneAnalysisOcrJsonSchemaV1 =
  createDetachedSceneAnalysisOcrJsonSchemaV1;
export const OPENAI_SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_V1 =
  SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_V1;
export const OPENAI_SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_SHA256 =
  SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_SHA256;
export const parseOpenAiProposedSceneAnalysisOcrJsonV1 = parseProposedSceneAnalysisOcrJsonV1;
