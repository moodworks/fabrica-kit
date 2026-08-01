import { z } from 'zod';

import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  ProductGateCaseOracleV2Schema,
  ProductGateExactSolidOracleAuthorizationV2Schema,
  ProductGateOracleLayerIdV2Schema,
} from './product-gate-corpus-v2.js';
import {
  ProductGateMetricIdV1Schema,
  type ProductGateMetricResultV1,
} from './product-gate-metrics-v1.js';
import {
  PRODUCT_GATE_SEGMENTATION_SCORE_ANCHORS_V1,
  ProductGateCorrectionBudgetV1Schema,
  ProductGateMaskCorrectionAssessmentV1Schema,
  ProductGateSegmentationScoresV1Schema,
} from './product-gate-scorecards-v1.js';

const ScoreZeroToFourSchema = z.int().min(0).max(4);

export const ProductGateDecisionV2Schema = z.enum([
  'pass',
  'fail',
  'inconclusive',
  'not-measurable',
]);

export const ProductGateRequiredOutputStatusV2Schema = z.enum([
  'produced',
  'missing',
  'failed',
  'invalid-schema',
  'unsupported',
  'unattempted',
]);

export const ProductGateRequiredOutputEnvelopeV2Schema = z
  .strictObject({
    authority: z.enum(['available', 'missing-holdout-authority']),
    outputStatus: ProductGateRequiredOutputStatusV2Schema,
    evidenceComplete: z.boolean(),
    output: z.record(z.string(), z.unknown()).nullable(),
  })
  .superRefine((envelope, context) => {
    if ((envelope.outputStatus === 'produced') !== (envelope.output !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Only a produced output may carry structured evidence.',
      });
    }
  })
  .readonly();

export type ProductGateRequiredOutputEnvelopeV2 = z.infer<
  typeof ProductGateRequiredOutputEnvelopeV2Schema
>;

const componentReasonSchema = z.enum([
  'all-requirements-pass',
  'missing-authority',
  'missing-required-output',
  'failed-required-output',
  'invalid-schema-hard-failure',
  'unsupported-required-output',
  'unattempted-required-output',
  'incomplete-material-evidence',
  'vision-structural-threshold-not-met',
  'segmentation-unusable',
  'segmentation-repairable-does-not-pass',
  'segmentation-correction-budget-exceeded',
  'background-threshold-not-met',
  'transparent-cutout-is-not-background',
]);

export const ProductGateComponentEvaluationV2Schema = z
  .strictObject({
    evaluationVersion: z.literal(2),
    component: z.enum(['vision', 'segmentation', 'background']),
    decision: ProductGateDecisionV2Schema,
    outputDisposition: z.enum([
      'valid',
      'missing',
      'failed',
      'invalid-schema',
      'unsupported',
      'unattempted',
      'incomplete',
    ]),
    classification: z.enum(['usable', 'repairable', 'unusable']).nullable(),
    backgroundResultKind: z
      .enum([
        'reconstruction',
        'deterministic-solid-fallback',
        'transparent-foreground-cutout-only',
      ])
      .nullable()
      .default(null),
    reason: componentReasonSchema,
  })
  .superRefine((evaluation, context) => {
    const commonReasons = [
      'all-requirements-pass',
      'missing-authority',
      'missing-required-output',
      'failed-required-output',
      'invalid-schema-hard-failure',
      'unsupported-required-output',
      'unattempted-required-output',
      'incomplete-material-evidence',
    ] as const;
    const componentReasons = {
      vision: ['vision-structural-threshold-not-met'],
      segmentation: [
        'segmentation-unusable',
        'segmentation-repairable-does-not-pass',
        'segmentation-correction-budget-exceeded',
      ],
      background: ['background-threshold-not-met', 'transparent-cutout-is-not-background'],
    } as const;
    const reasonAllowedForComponent =
      commonReasons.includes(evaluation.reason as (typeof commonReasons)[number]) ||
      componentReasons[evaluation.component].includes(evaluation.reason as never);
    const expectedDecision =
      evaluation.reason === 'all-requirements-pass'
        ? 'pass'
        : evaluation.reason === 'missing-authority'
          ? 'not-measurable'
          : evaluation.reason === 'incomplete-material-evidence'
            ? 'inconclusive'
            : 'fail';
    const expectedClassification =
      evaluation.component !== 'segmentation' ||
      ['missing-authority', 'incomplete-material-evidence'].includes(evaluation.reason)
        ? null
        : evaluation.reason === 'all-requirements-pass'
          ? 'usable'
          : evaluation.reason === 'segmentation-repairable-does-not-pass'
            ? 'repairable'
            : 'unusable';
    const expectedOutputDisposition = {
      'all-requirements-pass': 'valid',
      'missing-required-output': 'missing',
      'failed-required-output': 'failed',
      'invalid-schema-hard-failure': 'invalid-schema',
      'unsupported-required-output': 'unsupported',
      'unattempted-required-output': 'unattempted',
      'incomplete-material-evidence': 'incomplete',
      'vision-structural-threshold-not-met': 'valid',
      'segmentation-unusable': 'valid',
      'segmentation-repairable-does-not-pass': 'valid',
      'segmentation-correction-budget-exceeded': 'valid',
      'background-threshold-not-met': 'valid',
      'transparent-cutout-is-not-background': 'valid',
    } as const;
    const outputDispositionMatches =
      evaluation.reason === 'missing-authority' ||
      evaluation.outputDisposition === expectedOutputDisposition[evaluation.reason];
    const evaluatedBackgroundReason =
      evaluation.component === 'background' &&
      [
        'all-requirements-pass',
        'incomplete-material-evidence',
        'background-threshold-not-met',
      ].includes(evaluation.reason);
    const backgroundKindMatches =
      evaluation.component !== 'background'
        ? evaluation.backgroundResultKind === null
        : evaluation.reason === 'transparent-cutout-is-not-background'
          ? evaluation.backgroundResultKind === 'transparent-foreground-cutout-only'
          : evaluatedBackgroundReason
            ? evaluation.backgroundResultKind === 'reconstruction' ||
              evaluation.backgroundResultKind === 'deterministic-solid-fallback'
            : evaluation.backgroundResultKind === null;
    if (
      !reasonAllowedForComponent ||
      evaluation.decision !== expectedDecision ||
      evaluation.classification !== expectedClassification ||
      !outputDispositionMatches ||
      !backgroundKindMatches
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Component decision, reason, and segmentation classification must agree.',
      });
    }
  })
  .readonly();

export type ProductGateComponentEvaluationV2 = z.infer<
  typeof ProductGateComponentEvaluationV2Schema
>;

const componentResult = (
  input: z.input<typeof ProductGateComponentEvaluationV2Schema>,
): ProductGateComponentEvaluationV2 => ProductGateComponentEvaluationV2Schema.parse(input);

type EnvelopePreflight =
  | { readonly kind: 'continue'; readonly envelope: ProductGateRequiredOutputEnvelopeV2 }
  | { readonly kind: 'result'; readonly result: ProductGateComponentEvaluationV2 };

const preflightRequiredOutput = (input: {
  readonly component: 'vision' | 'segmentation' | 'background';
  readonly envelope: unknown;
}): EnvelopePreflight => {
  const parsed = ProductGateRequiredOutputEnvelopeV2Schema.safeParse(input.envelope);
  if (!parsed.success) {
    return {
      kind: 'result',
      result: componentResult({
        evaluationVersion: 2,
        component: input.component,
        decision: 'fail',
        outputDisposition: 'invalid-schema',
        classification: input.component === 'segmentation' ? 'unusable' : null,
        reason: 'invalid-schema-hard-failure',
      }),
    };
  }
  const envelope = parsed.data;
  if (envelope.authority === 'missing-holdout-authority') {
    return {
      kind: 'result',
      result: componentResult({
        evaluationVersion: 2,
        component: input.component,
        decision: 'not-measurable',
        outputDisposition: envelope.outputStatus === 'produced' ? 'valid' : envelope.outputStatus,
        classification: null,
        reason: 'missing-authority',
      }),
    };
  }
  if (envelope.outputStatus !== 'produced') {
    const reasonByStatus = {
      missing: 'missing-required-output',
      failed: 'failed-required-output',
      'invalid-schema': 'invalid-schema-hard-failure',
      unsupported: 'unsupported-required-output',
      unattempted: 'unattempted-required-output',
    } as const;
    return {
      kind: 'result',
      result: componentResult({
        evaluationVersion: 2,
        component: input.component,
        decision: 'fail',
        outputDisposition: envelope.outputStatus,
        classification: input.component === 'segmentation' ? 'unusable' : null,
        reason: reasonByStatus[envelope.outputStatus],
      }),
    };
  }
  return { kind: 'continue', envelope };
};

const identitySchema = z.string().trim().min(1).max(160);

const ProductGateVisionLayerMatchV2Schema = z
  .strictObject({
    oracleLayerId: ProductGateOracleLayerIdV2Schema,
    semanticRoleMatches: z.boolean(),
    semanticRoleAndNameUsefulness: ScoreZeroToFourSchema,
    boundingBoxEvidence: z
      .strictObject({
        kind: z.literal('oracle-iou'),
        iouBps: z.int().min(0).max(10_000),
      })
      .readonly(),
  })
  .readonly();

export const ProductGateVisionEvidenceV2Schema = z
  .strictObject({
    evidenceVersion: z.literal(2),
    oracle: ProductGateCaseOracleV2Schema,
    coveredCriticalLayerIds: z.array(ProductGateOracleLayerIdV2Schema).max(64).readonly(),
    actualLayerCount: z.int().min(0).max(64),
    groupingAllowedByOracle: z.boolean(),
    matchedLayers: z.array(ProductGateVisionLayerMatchV2Schema).max(64).readonly(),
    extraLayerIds: z.array(identitySchema).max(64).readonly(),
    unresolvedDuplicate: z.boolean(),
    unresolvedFragment: z.boolean(),
    modelConfidenceUsedAsOracle: z.literal(false),
  })
  .superRefine((evidence, context) => {
    const arrays = [
      evidence.coveredCriticalLayerIds,
      evidence.matchedLayers.map((layer) => layer.oracleLayerId),
      evidence.extraLayerIds,
    ];
    if (arrays.some((values) => new Set(values).size !== values.length)) {
      context.addIssue({ code: 'custom', message: 'Vision evidence identities must be unique.' });
    }
    const criticalLayerIds = evidence.oracle.requiredLayers
      .filter((layer) => layer.critical)
      .map((layer) => layer.oracleLayerId);
    if (evidence.coveredCriticalLayerIds.some((layerId) => !criticalLayerIds.includes(layerId))) {
      context.addIssue({
        code: 'custom',
        message: 'Covered critical layers must be declared critical by the bound case oracle.',
      });
    }
    if (
      evidence.actualLayerCount !==
      evidence.matchedLayers.length + evidence.extraLayerIds.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Vision layer counts must be derived from the exact evidence arrays.',
      });
    }
  })
  .readonly();

export const evaluateProductGateVisionV2 = (input: unknown): ProductGateComponentEvaluationV2 => {
  const preflight = preflightRequiredOutput({ component: 'vision', envelope: input });
  if (preflight.kind === 'result') return preflight.result;
  const evidence = ProductGateVisionEvidenceV2Schema.safeParse(preflight.envelope.output);
  if (!evidence.success) {
    return componentResult({
      evaluationVersion: 2,
      component: 'vision',
      decision: 'fail',
      outputDisposition: 'invalid-schema',
      classification: null,
      reason: 'invalid-schema-hard-failure',
    });
  }
  const observed = evidence.data;
  const required = [...observed.oracle.requiredLayerIds].toSorted();
  const matched = observed.matchedLayers.map((layer) => layer.oracleLayerId).toSorted();
  const critical = observed.oracle.requiredLayers
    .filter((layer) => layer.critical)
    .map((layer) => layer.oracleLayerId)
    .toSorted();
  const passes =
    canonicalizeJson(required) === canonicalizeJson(matched) &&
    canonicalizeJson([...observed.coveredCriticalLayerIds].toSorted()) ===
      canonicalizeJson(critical) &&
    observed.actualLayerCount === observed.oracle.requiredLayerIds.length &&
    observed.groupingAllowedByOracle &&
    observed.extraLayerIds.length === 0 &&
    !observed.unresolvedDuplicate &&
    !observed.unresolvedFragment &&
    observed.matchedLayers.every(
      (layer) =>
        layer.semanticRoleMatches &&
        layer.semanticRoleAndNameUsefulness >= 3 &&
        layer.boundingBoxEvidence.iouBps >= 5_000,
    );
  if (passes && !preflight.envelope.evidenceComplete) {
    return componentResult({
      evaluationVersion: 2,
      component: 'vision',
      decision: 'inconclusive',
      outputDisposition: 'incomplete',
      classification: null,
      reason: 'incomplete-material-evidence',
    });
  }
  return componentResult({
    evaluationVersion: 2,
    component: 'vision',
    decision: passes ? 'pass' : 'fail',
    outputDisposition: 'valid',
    classification: null,
    reason: passes ? 'all-requirements-pass' : 'vision-structural-threshold-not-met',
  });
};

const exactSegmentationAnchorsV2Schema = z.custom<
  typeof PRODUCT_GATE_SEGMENTATION_SCORE_ANCHORS_V1
>(
  (value) =>
    canonicalizeJson(value) === canonicalizeJson(PRODUCT_GATE_SEGMENTATION_SCORE_ANCHORS_V1),
  { message: 'Segmentation anchors must equal the frozen V1 six-dimension anchors.' },
);

const ProductGateSegmentationComponentEvidenceV2Schema = z
  .strictObject({
    oracleLayerId: ProductGateOracleLayerIdV2Schema,
    scores: ProductGateSegmentationScoresV1Schema,
    duplicateProblem: z.boolean(),
    unresolvedFragmentProblem: z.boolean(),
  })
  .readonly();

export const ProductGateSegmentationEvidenceV2Schema = z
  .strictObject({
    evidenceVersion: z.literal(2),
    scoringStage: z.enum(['initial', 'corrected-final']),
    oracle: ProductGateCaseOracleV2Schema,
    components: z.array(ProductGateSegmentationComponentEvidenceV2Schema).min(1).max(64).readonly(),
    anchors: exactSegmentationAnchorsV2Schema,
    scorePolarity: z.literal('zero-worst-four-best-no-average'),
    averagedScore: z.null(),
    correctionBudget: ProductGateCorrectionBudgetV1Schema,
    minorMaskCorrectionAssessments: z
      .array(ProductGateMaskCorrectionAssessmentV1Schema)
      .max(1)
      .readonly(),
  })
  .superRefine((evidence, context) => {
    const componentIds = evidence.components.map((component) => component.oracleLayerId);
    if (new Set(componentIds).size !== componentIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Segmentation component oracle-layer identities must be unique.',
      });
    }
    const appliedCorrection = evidence.correctionBudget.corrections.some(
      (correction) => correction.countedAsCorrection,
    );
    if (appliedCorrection && evidence.scoringStage !== 'corrected-final') {
      context.addIssue({
        code: 'custom',
        message: 'Applied corrections require a corrected-final rescore.',
      });
    }
    if (
      evidence.minorMaskCorrectionAssessments.length !==
        evidence.correctionBudget.minorMaskCorrectionCount ||
      evidence.minorMaskCorrectionAssessments.some(
        (assessment) => assessment.correctionClass !== 'minor-mask-correction',
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Every retained minor mask correction requires one qualifying V1 assessment.',
      });
    }
  })
  .readonly();

export const evaluateProductGateSegmentationV2 = (
  input: unknown,
): ProductGateComponentEvaluationV2 => {
  const preflight = preflightRequiredOutput({ component: 'segmentation', envelope: input });
  if (preflight.kind === 'result') return preflight.result;
  const evidence = ProductGateSegmentationEvidenceV2Schema.safeParse(preflight.envelope.output);
  if (!evidence.success) {
    return componentResult({
      evaluationVersion: 2,
      component: 'segmentation',
      decision: 'fail',
      outputDisposition: 'invalid-schema',
      classification: 'unusable',
      reason: 'invalid-schema-hard-failure',
    });
  }
  const observed = evidence.data;
  const requiredForegroundIds = observed.oracle.requiredLayers
    .filter((layer) => layer.semanticRole !== 'background')
    .map((layer) => layer.oracleLayerId)
    .toSorted();
  const componentIds = observed.components.map((component) => component.oracleLayerId).toSorted();
  const scores = observed.components.flatMap((component) => Object.values(component.scores));
  if (
    canonicalizeJson(componentIds) !== canonicalizeJson(requiredForegroundIds) ||
    observed.components.some(
      (component) => component.duplicateProblem || component.unresolvedFragmentProblem,
    ) ||
    scores.some((score) => score === 0)
  ) {
    return componentResult({
      evaluationVersion: 2,
      component: 'segmentation',
      decision: 'fail',
      outputDisposition: 'valid',
      classification: 'unusable',
      reason: 'segmentation-unusable',
    });
  }
  if (scores.some((score) => score < 3)) {
    return componentResult({
      evaluationVersion: 2,
      component: 'segmentation',
      decision: 'fail',
      outputDisposition: 'valid',
      classification: 'repairable',
      reason: 'segmentation-repairable-does-not-pass',
    });
  }
  const correctionsPass =
    observed.correctionBudget.withinUsefulBudget &&
    observed.correctionBudget.fragmentCombinationCount <= 1 &&
    observed.correctionBudget.minorMaskCorrectionCount <= 1 &&
    observed.correctionBudget.maximumSeverity < 6;
  if (correctionsPass && !preflight.envelope.evidenceComplete) {
    return componentResult({
      evaluationVersion: 2,
      component: 'segmentation',
      decision: 'inconclusive',
      outputDisposition: 'incomplete',
      classification: null,
      reason: 'incomplete-material-evidence',
    });
  }
  return componentResult({
    evaluationVersion: 2,
    component: 'segmentation',
    decision: correctionsPass ? 'pass' : 'fail',
    outputDisposition: 'valid',
    classification: correctionsPass ? 'usable' : 'unusable',
    reason: correctionsPass ? 'all-requirements-pass' : 'segmentation-correction-budget-exceeded',
  });
};

const SolidRgbaV2Schema = z
  .tuple([
    z.int().min(0).max(255),
    z.int().min(0).max(255),
    z.int().min(0).max(255),
    z.int().min(0).max(255),
  ])
  .readonly();

export const ProductGateSolidFallbackAuthorizationV2Schema =
  ProductGateExactSolidOracleAuthorizationV2Schema;

const ProductGateReconstructionBackgroundEvidenceV2Schema = z
  .strictObject({
    evidenceVersion: z.literal(2),
    kind: z.literal('reconstruction'),
    requiredMode: z.literal('reconstruction-required'),
    oracle: ProductGateCaseOracleV2Schema,
    reconstructionDimensions: z
      .strictObject({
        kind: z.literal('scored'),
        removedObjectLeakage: ScoreZeroToFourSchema,
        continuity: ScoreZeroToFourSchema,
        contamination: ScoreZeroToFourSchema,
      })
      .readonly(),
    usability: ScoreZeroToFourSchema,
    transparentForegroundCutoutAlsoAvailable: z.boolean(),
  })
  .superRefine((evidence, context) => {
    if (evidence.oracle.backgroundRequirement.mode !== 'reconstruction-required') {
      context.addIssue({
        code: 'custom',
        message: 'Reconstruction evidence requires a reconstruction-required case oracle.',
      });
    }
  })
  .readonly();

const ProductGateSolidBackgroundEvidenceV2Schema = z
  .strictObject({
    evidenceVersion: z.literal(2),
    kind: z.literal('deterministic-solid-fallback'),
    requiredMode: z.literal('exact-solid-eligible'),
    oracle: ProductGateCaseOracleV2Schema,
    exactRgba: SolidRgbaV2Schema,
    authorization: ProductGateSolidFallbackAuthorizationV2Schema,
    reconstructionDimensions: z
      .strictObject({
        kind: z.literal('not-applicable'),
        reason: z.literal('oracle-authorized-deterministic-solid-fallback'),
      })
      .readonly(),
    usability: ScoreZeroToFourSchema,
  })
  .superRefine((evidence, context) => {
    const authorization = evidence.authorization;
    if (
      evidence.oracle.backgroundRequirement.mode !== 'exact-solid-eligible' ||
      canonicalizeJson(evidence.oracle.backgroundRequirement.exactSolidAuthorization) !==
        canonicalizeJson(authorization) ||
      canonicalizeJson(evidence.exactRgba) !== canonicalizeJson(authorization.exactRgba)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Solid fallback must bind the exact corpus, case, source, oracle, proposal, and RGBA.',
      });
    }
  })
  .readonly();

const ProductGateTransparentCutoutOnlyEvidenceV2Schema = z
  .strictObject({
    evidenceVersion: z.literal(2),
    kind: z.literal('transparent-foreground-cutout-only'),
    requiredMode: z.enum(['exact-solid-eligible', 'reconstruction-required']),
    oracle: ProductGateCaseOracleV2Schema,
    foregroundIsolationSatisfied: z.literal(true),
    backgroundRequirementSatisfied: z.literal(false),
  })
  .superRefine((evidence, context) => {
    if (evidence.requiredMode !== evidence.oracle.backgroundRequirement.mode) {
      context.addIssue({
        code: 'custom',
        message: 'Transparent cutout evidence must bind the case oracle background mode.',
      });
    }
  })
  .readonly();

export const ProductGateBackgroundEvidenceV2Schema = z.discriminatedUnion('kind', [
  ProductGateReconstructionBackgroundEvidenceV2Schema,
  ProductGateSolidBackgroundEvidenceV2Schema,
  ProductGateTransparentCutoutOnlyEvidenceV2Schema,
]);

export const evaluateProductGateBackgroundV2 = (
  input: unknown,
): ProductGateComponentEvaluationV2 => {
  const preflight = preflightRequiredOutput({ component: 'background', envelope: input });
  if (preflight.kind === 'result') return preflight.result;
  const evidence = ProductGateBackgroundEvidenceV2Schema.safeParse(preflight.envelope.output);
  if (!evidence.success) {
    return componentResult({
      evaluationVersion: 2,
      component: 'background',
      decision: 'fail',
      outputDisposition: 'invalid-schema',
      classification: null,
      reason: 'invalid-schema-hard-failure',
    });
  }
  const observed = evidence.data;
  if (observed.kind === 'transparent-foreground-cutout-only') {
    return componentResult({
      evaluationVersion: 2,
      component: 'background',
      decision: 'fail',
      outputDisposition: 'valid',
      classification: null,
      backgroundResultKind: observed.kind,
      reason: 'transparent-cutout-is-not-background',
    });
  }
  const passes =
    observed.kind === 'deterministic-solid-fallback'
      ? observed.usability >= 3
      : observed.reconstructionDimensions.removedObjectLeakage >= 3 &&
        observed.reconstructionDimensions.continuity >= 3 &&
        observed.reconstructionDimensions.contamination >= 3 &&
        observed.usability >= 3;
  if (passes && !preflight.envelope.evidenceComplete) {
    return componentResult({
      evaluationVersion: 2,
      component: 'background',
      decision: 'inconclusive',
      outputDisposition: 'incomplete',
      classification: null,
      backgroundResultKind: observed.kind,
      reason: 'incomplete-material-evidence',
    });
  }
  return componentResult({
    evaluationVersion: 2,
    component: 'background',
    decision: passes ? 'pass' : 'fail',
    outputDisposition: 'valid',
    classification: null,
    backgroundResultKind: observed.kind,
    reason: passes ? 'all-requirements-pass' : 'background-threshold-not-met',
  });
};

export const ProductGateFrozenThresholdsCoreV2Schema = z
  .strictObject({
    policyVersion: z.literal(2),
    policyId: z.literal('banner-ai-product-gate-frozen-thresholds-v2'),
    denominator: z.literal(18),
    usefulLayer: z
      .strictObject({ minimumSuccesses: z.literal(15), requiredSuccessfulStrata: z.literal(9) })
      .readonly(),
    endToEnd: z.strictObject({ minimumSuccesses: z.literal(14) }).readonly(),
    successfulLatencyMs: z
      .strictObject({ p50Maximum: z.literal(240_000), p95Maximum: z.literal(420_000) })
      .readonly(),
    terminalLatencyMs: z.strictObject({ maximum: z.literal(600_000) }).readonly(),
    costPerSuccessMicros: z.strictObject({ maximum: z.literal('350000') }).readonly(),
    firstAttemptFailure: z.strictObject({ role: z.literal('descriptive-only') }).readonly(),
    finalStepFailure: z
      .strictObject({ maximumNumerator: z.literal(1), denominator: z.literal(10) })
      .readonly(),
    authoritativeExport: z
      .strictObject({ firstPassMinimum: z.literal(17), finalPassRequired: z.literal(18) })
      .readonly(),
    manualCorrection: z
      .strictObject({
        maximumNumerator: z.literal(3),
        denominator: z.literal(10),
        includedSeverities: z
          .tuple([
            z.literal(1),
            z.literal(2),
            z.literal(3),
            z.literal(4),
            z.literal(5),
            z.literal(6),
            z.literal(7),
          ])
          .readonly(),
      })
      .readonly(),
    majorIntervention: z
      .strictObject({
        maximumNumerator: z.literal(1),
        denominator: z.literal(10),
        includedSeverities: z.tuple([z.literal(6), z.literal(7), z.literal(8)]).readonly(),
      })
      .readonly(),
    injectedRecovery: z
      .strictObject({ requiredNumerator: z.literal(1), denominator: z.literal(1) })
      .readonly(),
    observedRealRecovery: z
      .strictObject({
        minimumNumerator: z.literal(9),
        denominator: z.literal(10),
        minimumEligibleEvents: z.literal(10),
      })
      .readonly(),
    replayReproducibility: z
      .strictObject({ requiredNumerator: z.literal(1), denominator: z.literal(1) })
      .readonly(),
    componentRepeat: z
      .strictObject({ minimumMatching: z.literal(5), predesignatedCases: z.literal(6) })
      .readonly(),
    aggregation: z.literal('ordered-precedence-no-weighted-average'),
  })
  .readonly();

const frozenThresholdsCore = ProductGateFrozenThresholdsCoreV2Schema.parse({
  policyVersion: 2,
  policyId: 'banner-ai-product-gate-frozen-thresholds-v2',
  denominator: 18,
  usefulLayer: { minimumSuccesses: 15, requiredSuccessfulStrata: 9 },
  endToEnd: { minimumSuccesses: 14 },
  successfulLatencyMs: { p50Maximum: 240_000, p95Maximum: 420_000 },
  terminalLatencyMs: { maximum: 600_000 },
  costPerSuccessMicros: { maximum: '350000' },
  firstAttemptFailure: { role: 'descriptive-only' },
  finalStepFailure: { maximumNumerator: 1, denominator: 10 },
  authoritativeExport: { firstPassMinimum: 17, finalPassRequired: 18 },
  manualCorrection: {
    maximumNumerator: 3,
    denominator: 10,
    includedSeverities: [1, 2, 3, 4, 5, 6, 7],
  },
  majorIntervention: { maximumNumerator: 1, denominator: 10, includedSeverities: [6, 7, 8] },
  injectedRecovery: { requiredNumerator: 1, denominator: 1 },
  observedRealRecovery: { minimumNumerator: 9, denominator: 10, minimumEligibleEvents: 10 },
  replayReproducibility: { requiredNumerator: 1, denominator: 1 },
  componentRepeat: { minimumMatching: 5, predesignatedCases: 6 },
  aggregation: 'ordered-precedence-no-weighted-average',
});

export const PRODUCT_GATE_FROZEN_THRESHOLDS_V2 = Object.freeze(frozenThresholdsCore);
export const PRODUCT_GATE_FROZEN_THRESHOLDS_V2_SHA256 = sha256Hex(
  Buffer.from(canonicalizeJson(frozenThresholdsCore), 'utf8'),
);

const metricRoleById = Object.freeze({
  'useful-layer-success': 'mandatory-target',
  'product-gate-e2e': 'mandatory-target',
  'successful-run-latency': 'mandatory-target',
  'all-case-terminal-latency': 'mandatory-target',
  'cost-per-success': 'mandatory-target',
  'first-attempt-step-failure': 'descriptive-only',
  'final-step-failure': 'mandatory-target',
  'authoritative-export': 'mandatory-target',
  'manual-correction-rate': 'mandatory-target',
  'major-intervention-rate': 'mandatory-target',
  'injected-recovery': 'mandatory-target',
  'observed-real-recovery': 'separate-observational',
  'replay-reproducibility': 'mandatory-target',
  'component-repeat-reproducibility': 'mandatory-target',
} as const);

const requiredMetricIds = Object.keys(metricRoleById).toSorted() as readonly z.infer<
  typeof ProductGateMetricIdV1Schema
>[];

export const ProductGateAggregateMetricV2Schema = z
  .strictObject({
    metricId: ProductGateMetricIdV1Schema,
    role: z.enum(['mandatory-target', 'descriptive-only', 'separate-observational']),
    decision: ProductGateDecisionV2Schema,
  })
  .superRefine((metric, context) => {
    if (metric.role !== metricRoleById[metric.metricId]) {
      context.addIssue({
        code: 'custom',
        message: 'Metric aggregate role is frozen by metric ID.',
      });
    }
  })
  .readonly();

const ProductGateAggregateAuthorityV2Schema = z
  .strictObject({
    holdout: z.enum(['available', 'missing']),
    authoritativeGdn: z.enum(['available', 'missing']),
    internalProviderFreeValidatorAcceptedAsAuthoritativeGdn: z.literal(false),
  })
  .readonly();

export const ProductGateAggregateInputV2Schema = z
  .strictObject({
    aggregateVersion: z.literal(2),
    authority: ProductGateAggregateAuthorityV2Schema,
    evidenceComplete: z.boolean(),
    metrics: z.array(ProductGateAggregateMetricV2Schema).max(requiredMetricIds.length).readonly(),
  })
  .superRefine((input, context) => {
    const ids = input.metrics.map((metric) => metric.metricId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: 'custom', message: 'Aggregate metric identities must be unique.' });
    }
    if (
      input.metrics.some(
        (metric) =>
          metric.decision === 'not-measurable' &&
          input.authority.holdout === 'available' &&
          input.authority.authoritativeGdn === 'available',
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Not-measurable is reserved for missing holdout or GDN authority.',
      });
    }
  })
  .readonly();

export const ProductGateAggregateVerdictV2Schema = z
  .strictObject({
    verdictVersion: z.literal(2),
    verdict: ProductGateDecisionV2Schema,
    reason: z.enum([
      'missing-holdout-or-gdn-authority',
      'invalid-aggregate-schema-hard-failure',
      'mandatory-target-failed',
      'incomplete-material-evidence',
      'all-mandatory-targets-pass',
    ]),
    failedMandatoryMetricIds: z.array(ProductGateMetricIdV1Schema).readonly(),
    incompleteMandatoryMetricIds: z.array(ProductGateMetricIdV1Schema).readonly(),
    weightedAverageUsed: z.literal(false),
  })
  .superRefine((result, context) => {
    const expectedVerdict =
      result.reason === 'missing-holdout-or-gdn-authority'
        ? 'not-measurable'
        : ['invalid-aggregate-schema-hard-failure', 'mandatory-target-failed'].includes(
              result.reason,
            )
          ? 'fail'
          : result.reason === 'incomplete-material-evidence'
            ? 'inconclusive'
            : 'pass';
    const sortedUnique = (values: readonly string[]) =>
      new Set(values).size === values.length &&
      canonicalizeJson(values) === canonicalizeJson([...values].toSorted());
    if (
      result.verdict !== expectedVerdict ||
      !sortedUnique(result.failedMandatoryMetricIds) ||
      !sortedUnique(result.incompleteMandatoryMetricIds) ||
      result.failedMandatoryMetricIds.some(
        (metricId) => metricRoleById[metricId] !== 'mandatory-target',
      ) ||
      result.incompleteMandatoryMetricIds.some(
        (metricId) => metricRoleById[metricId] !== 'mandatory-target',
      ) ||
      (result.reason === 'mandatory-target-failed' &&
        result.failedMandatoryMetricIds.length === 0) ||
      (result.reason !== 'mandatory-target-failed' &&
        result.failedMandatoryMetricIds.length !== 0) ||
      (result.reason !== 'incomplete-material-evidence' &&
        result.incompleteMandatoryMetricIds.length !== 0) ||
      (result.verdict === 'pass' && result.incompleteMandatoryMetricIds.length !== 0)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Aggregate verdict, reason, and metric identity projections must agree.',
      });
    }
  })
  .readonly();

export type ProductGateAggregateVerdictV2 = z.infer<typeof ProductGateAggregateVerdictV2Schema>;

export const aggregateProductGateVerdictV2 = (input: unknown): ProductGateAggregateVerdictV2 => {
  const authorityCandidate =
    typeof input === 'object' && input !== null && 'authority' in input
      ? ProductGateAggregateAuthorityV2Schema.safeParse(input.authority)
      : null;
  if (
    authorityCandidate?.success &&
    (authorityCandidate.data.holdout === 'missing' ||
      authorityCandidate.data.authoritativeGdn === 'missing')
  ) {
    return ProductGateAggregateVerdictV2Schema.parse({
      verdictVersion: 2,
      verdict: 'not-measurable',
      reason: 'missing-holdout-or-gdn-authority',
      failedMandatoryMetricIds: [],
      incompleteMandatoryMetricIds: [],
      weightedAverageUsed: false,
    });
  }
  const parsed = ProductGateAggregateInputV2Schema.safeParse(input);
  if (!parsed.success) {
    return ProductGateAggregateVerdictV2Schema.parse({
      verdictVersion: 2,
      verdict: 'fail',
      reason: 'invalid-aggregate-schema-hard-failure',
      failedMandatoryMetricIds: [],
      incompleteMandatoryMetricIds: [],
      weightedAverageUsed: false,
    });
  }
  const aggregate = parsed.data;
  const mandatory = aggregate.metrics.filter((metric) => metric.role === 'mandatory-target');
  const failedMandatoryMetricIds = mandatory
    .filter((metric) => metric.decision === 'fail')
    .map((metric) => metric.metricId)
    .toSorted();
  if (failedMandatoryMetricIds.length > 0) {
    return ProductGateAggregateVerdictV2Schema.parse({
      verdictVersion: 2,
      verdict: 'fail',
      reason: 'mandatory-target-failed',
      failedMandatoryMetricIds,
      incompleteMandatoryMetricIds: [],
      weightedAverageUsed: false,
    });
  }
  const presentIds = new Set(aggregate.metrics.map((metric) => metric.metricId));
  const missingMandatoryIds = requiredMetricIds.filter(
    (metricId) => metricRoleById[metricId] === 'mandatory-target' && !presentIds.has(metricId),
  );
  const incompleteMandatoryMetricIds = [
    ...missingMandatoryIds,
    ...mandatory.filter((metric) => metric.decision !== 'pass').map((metric) => metric.metricId),
  ].toSorted();
  if (!aggregate.evidenceComplete || incompleteMandatoryMetricIds.length > 0) {
    return ProductGateAggregateVerdictV2Schema.parse({
      verdictVersion: 2,
      verdict: 'inconclusive',
      reason: 'incomplete-material-evidence',
      failedMandatoryMetricIds: [],
      incompleteMandatoryMetricIds: [...new Set(incompleteMandatoryMetricIds)],
      weightedAverageUsed: false,
    });
  }
  return ProductGateAggregateVerdictV2Schema.parse({
    verdictVersion: 2,
    verdict: 'pass',
    reason: 'all-mandatory-targets-pass',
    failedMandatoryMetricIds: [],
    incompleteMandatoryMetricIds: [],
    weightedAverageUsed: false,
  });
};

export const projectProductGateMetricForAggregateV2 = (
  result: ProductGateMetricResultV1,
): z.infer<typeof ProductGateAggregateMetricV2Schema> =>
  ProductGateAggregateMetricV2Schema.parse({
    metricId: result.metricId,
    role: metricRoleById[result.metricId],
    decision: result.decision,
  });
