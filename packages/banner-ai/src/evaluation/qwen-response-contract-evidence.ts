import { SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_SHA256 } from './openai-scene-analysis-output.js';
import { QWEN_SEMANTIC_SCENE_ANALYSIS_JSON_SCHEMA_V1_SHA256 } from './qwen-semantic-scene-analysis-output.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';

type QwenDiagnosticSemanticProjectionPrimitiveKindV1 = 'null' | 'boolean' | 'number' | 'string';
type QwenDiagnosticSemanticProjectionStringModeV1 =
  'part-key' | 'label' | 'ocr-text' | 'enum' | 'opaque-id';
export type QwenDiagnosticSemanticProjectionNodeV1 =
  | {
      readonly kind: 'leaf';
      readonly expected: readonly QwenDiagnosticSemanticProjectionPrimitiveKindV1[];
      readonly stringMode?: QwenDiagnosticSemanticProjectionStringModeV1;
      readonly allowedStrings?: readonly string[];
    }
  | {
      readonly kind: 'object';
      readonly fields: Readonly<Record<string, QwenDiagnosticSemanticProjectionNodeV1>>;
    }
  | {
      readonly kind: 'array';
      readonly element: QwenDiagnosticSemanticProjectionNodeV1;
      readonly maximumItems: number;
    };

const semanticLeaf = (
  expected: readonly QwenDiagnosticSemanticProjectionPrimitiveKindV1[],
  input: Omit<
    Extract<QwenDiagnosticSemanticProjectionNodeV1, { readonly kind: 'leaf' }>,
    'kind' | 'expected'
  > = {},
): QwenDiagnosticSemanticProjectionNodeV1 => ({ kind: 'leaf', expected, ...input });
const semanticObject = (
  fields: Readonly<Record<string, QwenDiagnosticSemanticProjectionNodeV1>>,
): QwenDiagnosticSemanticProjectionNodeV1 => ({ kind: 'object', fields });
const semanticArray = (
  element: QwenDiagnosticSemanticProjectionNodeV1,
  maximumItems: number,
): QwenDiagnosticSemanticProjectionNodeV1 => ({ kind: 'array', element, maximumItems });
const deepFreezeSemanticProjection = (
  node: QwenDiagnosticSemanticProjectionNodeV1,
): QwenDiagnosticSemanticProjectionNodeV1 => {
  if (Object.isFrozen(node)) return node;
  if (node.kind === 'leaf') {
    Object.freeze(node.expected);
    if (node.allowedStrings !== undefined) Object.freeze(node.allowedStrings);
  } else if (node.kind === 'object') {
    for (const field of Object.values(node.fields)) {
      deepFreezeSemanticProjection(field);
    }
    Object.freeze(node.fields);
  } else {
    deepFreezeSemanticProjection(node.element);
  }
  return Object.freeze(node);
};
const semanticEnum = (allowedStrings: readonly string[]): QwenDiagnosticSemanticProjectionNodeV1 =>
  semanticLeaf(['string'], { stringMode: 'enum', allowedStrings });
const semanticNumber = semanticLeaf(['number']);
const semanticPartKey = semanticLeaf(['string'], { stringMode: 'part-key' });
const semanticLabel = semanticLeaf(['string'], { stringMode: 'label' });
const semanticOcrText = semanticLeaf(['string'], { stringMode: 'ocr-text' });
const semanticReviewFlags = semanticArray(
  semanticEnum(['ambiguous-overlap', 'low-confidence', 'possible-occlusion', 'text-needs-review']),
  4,
);
const semanticBounds = semanticObject({
  xBps: semanticNumber,
  yBps: semanticNumber,
  widthBps: semanticNumber,
  heightBps: semanticNumber,
});
const semanticCompositionPart = semanticObject({
  partKey: semanticPartKey,
  label: semanticLabel,
  role: semanticEnum(['background', 'subject', 'foreground', 'decoration', 'text', 'other']),
  bounds: semanticBounds,
});

export const QWEN_DIAGNOSTIC_V2_SEMANTIC_PROJECTION_VERSION = 1 as const;
export const QWEN_DIAGNOSTIC_V2_SEMANTIC_PROJECTION_V1 = deepFreezeSemanticProjection(
  semanticObject({
    composition: semanticObject({
      kind: semanticEnum(['composition_proposal', 'no_useful_layers']),
      parts: semanticArray(semanticCompositionPart, 5),
      reason: semanticEnum(['flat_image', 'insufficient_separation', 'unsupported_composition']),
    }),
    layerEvidence: semanticArray(
      semanticObject({
        partKey: semanticPartKey,
        observationBasis: semanticEnum(['directly-visible-in-source-image']),
        confidence: semanticObject({
          valueBps: semanticNumber,
        }),
        reviewFlags: semanticReviewFlags,
      }),
      5,
    ),
    ocrCompletion: semanticObject({
      kind: semanticEnum(['visible-text-observations-complete', 'no-visible-text-observed']),
    }),
    textObservations: semanticArray(
      semanticObject({
        observationId: semanticLeaf(['string'], { stringMode: 'opaque-id' }),
        text: semanticObject({
          value: semanticOcrText,
        }),
        boundingBox: semanticBounds,
        confidence: semanticObject({
          valueBps: semanticNumber,
        }),
      }),
      100,
    ),
    reviewFlags: semanticReviewFlags,
  }),
);
export const QWEN_DIAGNOSTIC_V2_SEMANTIC_PROJECTION_V1_SHA256 = sha256Hex(
  Buffer.from(canonicalizeJson(QWEN_DIAGNOSTIC_V2_SEMANTIC_PROJECTION_V1), 'utf8'),
);

export const QWEN_SEMANTIC_MATERIALIZER_V1_DEFINITION = Object.freeze({
  materializerVersion: 1 as const,
  semanticOutputSchemaSha256: QWEN_SEMANTIC_SCENE_ANALYSIS_JSON_SCHEMA_V1_SHA256,
  canonicalOutputSchemaSha256: SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_SHA256,
  rules: Object.freeze([
    'exact-canonical-request-context-required',
    'server-attaches-output-version-and-visible-content-constraint',
    'server-attaches-proposal-version-and-request-source-digest',
    'server-attaches-units-normalization-trust-and-authority',
    'server-derives-ocr-observation-count',
    'server-attaches-human-review-only-disposition',
    'assembled-output-must-pass-unchanged-canonical-schema',
    'composition-must-pass-request-relative-validation',
    'server-constructs-request-bound-ocr-provenance',
    'provider-observation-basis-remains-untrusted-semantic-claim',
    'provider-observation-id-remains-untrusted-local-reference',
  ] as const),
});

export const QWEN_SEMANTIC_MATERIALIZER_V1_DEFINITION_SHA256 = sha256Hex(
  Buffer.from(canonicalizeJson(QWEN_SEMANTIC_MATERIALIZER_V1_DEFINITION), 'utf8'),
);

export const QWEN_RESPONSE_BOUNDARY_V2_DEFINITION = Object.freeze({
  boundaryVersion: 2 as const,
  envelopeVersion: 1 as const,
  semanticOutputSchemaSha256: QWEN_SEMANTIC_SCENE_ANALYSIS_JSON_SCHEMA_V1_SHA256,
  canonicalOutputSchemaSha256: SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_SHA256,
  semanticMaterializerVersion: 1 as const,
  semanticMaterializerSha256: QWEN_SEMANTIC_MATERIALIZER_V1_DEFINITION_SHA256,
  rules: Object.freeze([
    'strict-provider-envelope',
    'strict-semantic-root-and-nested-unknown-field-rejection',
    'reserved-server-owned-fields-rejected',
    'semantic-parse-failure-distinct-from-materialization-invariant-failure',
    'only-canonical-materialized-scene-may-reach-quality',
    'historical-boundary-v1-never-reinterpreted',
  ] as const),
});

export const QWEN_RESPONSE_BOUNDARY_V2_DEFINITION_SHA256 = sha256Hex(
  Buffer.from(canonicalizeJson(QWEN_RESPONSE_BOUNDARY_V2_DEFINITION), 'utf8'),
);
