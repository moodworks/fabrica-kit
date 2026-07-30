import { z } from 'zod';

import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import { SAM_CORPUS_VISUAL_SCORE_ANCHORS_V1 } from './sam-corpus-visual-quality-v1.js';
import { ProductGateBackgroundStrategyV1Schema } from './product-gate-background-v1.js';
import {
  PRODUCT_GATE_BLOCKED_HOLDOUT_V1,
  PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
  ProductGateCorpusCaseIdV1Schema,
  ProductGateCorpusManifestV1Schema,
} from './product-gate-corpus-v1.js';
import {
  ProductGateAdjudicationIdV1Schema,
  ProductGateReviewRecordIdV1Schema,
  createProductGateAdjudicationIdV1,
  createProductGateReviewRecordIdV1,
} from './product-gate-segmentation-v1.js';

export const ProductGateClosedDecisionV1Schema = z.enum([
  'pass',
  'fail',
  'inconclusive',
  'not-measurable',
]);

const ScoreZeroToFourSchema = z.int().min(0).max(4);

export const ProductGateVisionScorecardV1Schema = z
  .strictObject({
    scorecardVersion: z.literal(1),
    expectedLayerCount: z
      .strictObject({ minimum: z.int().min(1).max(64), maximum: z.int().min(1).max(64) })
      .readonly(),
    actualLayerCount: z.int().min(0).max(64),
    layerCountValid: z.boolean(),
    semanticRoleAndNameUsefulness: ScoreZeroToFourSchema,
    criticalElementCount: z.int().min(0).max(64),
    coveredCriticalElementCount: z.int().min(0).max(64),
    criticalElementCoverageComplete: z.boolean(),
    groupingAllowedByOracle: z.boolean(),
    directlyVisibleEvidenceOnly: z.boolean(),
    boundingBoxAgreementBps: z.int().min(0).max(10_000).nullable(),
    outcome: z.enum(['pass', 'fail', 'inconclusive']),
    modelConfidenceUsedAsOracle: z.literal(false),
  })
  .superRefine((scorecard, context) => {
    const countValid =
      scorecard.actualLayerCount >= scorecard.expectedLayerCount.minimum &&
      scorecard.actualLayerCount <= scorecard.expectedLayerCount.maximum;
    const coverageComplete =
      scorecard.criticalElementCount > 0 &&
      scorecard.coveredCriticalElementCount === scorecard.criticalElementCount;
    if (
      scorecard.expectedLayerCount.minimum > scorecard.expectedLayerCount.maximum ||
      scorecard.coveredCriticalElementCount > scorecard.criticalElementCount ||
      scorecard.layerCountValid !== countValid ||
      scorecard.criticalElementCoverageComplete !== coverageComplete
    ) {
      context.addIssue({ code: 'custom', message: 'Vision count or coverage derivation drifted.' });
    }
    const measurable = scorecard.boundingBoxAgreementBps !== null;
    const hardFailure =
      measurable &&
      (!countValid ||
        !coverageComplete ||
        !scorecard.groupingAllowedByOracle ||
        !scorecard.directlyVisibleEvidenceOnly);
    const expectedOutcome = hardFailure ? 'fail' : 'inconclusive';
    if (scorecard.outcome !== expectedOutcome) {
      context.addIssue({ code: 'custom', message: 'Vision scorecard outcome drifted.' });
    }
  })
  .readonly();

const exactAnchorsSchema = z.custom<typeof SAM_CORPUS_VISUAL_SCORE_ANCHORS_V1>(
  (value) => canonicalizeJson(value) === canonicalizeJson(SAM_CORPUS_VISUAL_SCORE_ANCHORS_V1),
  { message: 'Segmentation score anchors must equal the frozen SAM six-dimension anchors.' },
);

export const PRODUCT_GATE_SEGMENTATION_SCORE_ANCHORS_V1 = SAM_CORPUS_VISUAL_SCORE_ANCHORS_V1;

export const ProductGateSegmentationScoresV1Schema = z
  .strictObject({
    semanticUsefulness: ScoreZeroToFourSchema,
    completeness: ScoreZeroToFourSchema,
    edgeMatteQuality: ScoreZeroToFourSchema,
    backgroundCleanliness: ScoreZeroToFourSchema,
    granularityIntegrity: ScoreZeroToFourSchema,
    repairReadiness: ScoreZeroToFourSchema,
  })
  .readonly();

export const ProductGateSegmentationScorecardV1Schema = z
  .strictObject({
    scorecardVersion: z.literal(1),
    semanticElementId: z.string().min(1).max(160),
    candidateId: z.string().regex(/^pge_candidate_v1_[0-9a-f]{64}$/u),
    scores: ProductGateSegmentationScoresV1Schema,
    anchors: exactAnchorsSchema,
    scorePolarity: z.literal('zero-worst-four-best-no-average'),
    duplicateProblem: z.boolean(),
    fragmentProblem: z.boolean(),
    classification: z.enum(['usable', 'repairable', 'unusable']),
  })
  .superRefine((scorecard, context) => {
    const scores = Object.values(scorecard.scores);
    const expected =
      scorecard.duplicateProblem || scorecard.fragmentProblem || scores.some((score) => score === 0)
        ? 'unusable'
        : scores.every((score) => score >= 3)
          ? 'usable'
          : 'repairable';
    if (scorecard.classification !== expected) {
      context.addIssue({
        code: 'custom',
        message: 'Segmentation classification contradicts six scores or integrity problems.',
      });
    }
  })
  .readonly();

const BackgroundReconstructionScoresV1Schema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('scored'),
      removedObjectLeakage: ScoreZeroToFourSchema,
      continuity: ScoreZeroToFourSchema,
      contamination: ScoreZeroToFourSchema,
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('not-applicable'),
      reason: z.literal('oracle-authorized-deterministic-solid-fallback'),
      permissionSha256: Sha256HexSchema,
    })
    .readonly(),
]);

export const ProductGateBackgroundScorecardV1Schema = z
  .strictObject({
    scorecardVersion: z.literal(1),
    caseId: ProductGateCorpusCaseIdV1Schema,
    originalSourceSha256: Sha256HexSchema,
    normalizedSourceSha256: Sha256HexSchema,
    strategy: ProductGateBackgroundStrategyV1Schema,
    strategyResultUsable: z.boolean(),
    oracleAuthorizationProjectionPresent: z.boolean(),
    reconstructionDimensions: BackgroundReconstructionScoresV1Schema,
    usability: ScoreZeroToFourSchema,
    outcome: z.enum(['pass', 'fail', 'inconclusive']),
  })
  .superRefine((scorecard, context) => {
    const solid = scorecard.strategy === 'deterministic-solid-fallback';
    const notApplicable = scorecard.reconstructionDimensions.kind === 'not-applicable';
    if (
      notApplicable !== (solid && scorecard.oracleAuthorizationProjectionPresent) ||
      (!solid && scorecard.oracleAuthorizationProjectionPresent)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Background N/A is closed to oracle-authorized deterministic solid fallback.',
      });
      return;
    }
    const measurable = ![
      'unsupported',
      'failed',
      'not-attempted',
      'optional-later-inpainting',
    ].includes(scorecard.strategy);
    const expected = measurable && !scorecard.strategyResultUsable ? 'fail' : 'inconclusive';
    if (scorecard.outcome !== expected) {
      context.addIssue({ code: 'custom', message: 'Background scorecard outcome drifted.' });
    }
  })
  .readonly();

export const validateProductGateBackgroundScorecardForCurrentCorpusV1 = (input: {
  readonly scorecard: unknown;
  readonly corpusManifest: unknown;
}): z.infer<typeof ProductGateBackgroundScorecardV1Schema> => {
  const scorecard = ProductGateBackgroundScorecardV1Schema.parse(input.scorecard);
  const corpus = ProductGateCorpusManifestV1Schema.parse(input.corpusManifest);
  if (canonicalizeJson(corpus) === canonicalizeJson(PRODUCT_GATE_BLOCKED_HOLDOUT_V1)) {
    throw new TypeError('Blocked holdout grants no background scoring authority.');
  }
  if (canonicalizeJson(corpus) !== canonicalizeJson(PRODUCT_GATE_DEVELOPMENT_CORPUS_V1)) {
    throw new TypeError('Unknown corpus authority projection is rejected.');
  }
  const entry = PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.entries.find(
    (candidate) => candidate.caseId === scorecard.caseId,
  );
  if (
    entry === undefined ||
    scorecard.originalSourceSha256 !== entry.original.sha256 ||
    scorecard.normalizedSourceSha256 !== entry.normalized.sha256
  ) {
    throw new TypeError(
      'Background scorecard must bind the exact development case and source identities.',
    );
  }
  if (scorecard.reconstructionDimensions.kind === 'not-applicable') {
    throw new TypeError(
      'Background N/A is not authorized: Phase 3A has no admitted solid-fallback case oracle.',
    );
  }
  return scorecard;
};

export const ProductGateCorrectionClassV1Schema = z.enum([
  'none',
  'rename-only',
  'required-include-exclude-default-correction',
  'reordering',
  'combining-fragments',
  'minor-mask-correction',
  'major-mask-correction',
  'background-replacement',
  'complete-decomposition-failure',
]);

export const PRODUCT_GATE_CORRECTION_SEVERITY_V1 = Object.freeze({
  none: 0,
  'rename-only': 1,
  'required-include-exclude-default-correction': 2,
  reordering: 3,
  'combining-fragments': 4,
  'minor-mask-correction': 5,
  'major-mask-correction': 6,
  'background-replacement': 7,
  'complete-decomposition-failure': 8,
} as const);

export const ProductGateMaskCorrectionAssessmentV1Schema = z
  .strictObject({
    changedPixels: z.int().min(0).max(16_777_216),
    sourceCanvasPixels: z.int().min(0).max(16_777_216),
    oracleTargetPixels: z.int().min(0).max(16_777_216),
    connectedEditRegionCount: z.int().min(0).max(16_777_216),
    recoveredMissingCriticalSemanticElement: z.boolean(),
    sourceThresholdSatisfied: z.boolean(),
    oracleThresholdSatisfied: z.boolean(),
    denominatorsValid: z.boolean(),
    correctionClass: z.enum(['none', 'minor-mask-correction', 'major-mask-correction']),
    severity: z.union([z.literal(0), z.literal(5), z.literal(6)]),
  })
  .superRefine((assessment, context) => {
    const denominatorsValid =
      assessment.sourceCanvasPixels > 0 && assessment.oracleTargetPixels > 0;
    const sourceThresholdSatisfied =
      denominatorsValid &&
      BigInt(assessment.changedPixels) * 100n <= BigInt(assessment.sourceCanvasPixels) * 2n;
    const oracleThresholdSatisfied =
      denominatorsValid &&
      BigInt(assessment.changedPixels) * 10n <= BigInt(assessment.oracleTargetPixels);
    const minor =
      assessment.changedPixels > 0 &&
      sourceThresholdSatisfied &&
      oracleThresholdSatisfied &&
      assessment.connectedEditRegionCount === 1 &&
      !assessment.recoveredMissingCriticalSemanticElement;
    const expectedClass = !denominatorsValid
      ? 'major-mask-correction'
      : assessment.changedPixels === 0
        ? 'none'
        : minor
          ? 'minor-mask-correction'
          : 'major-mask-correction';
    if (
      assessment.denominatorsValid !== denominatorsValid ||
      assessment.sourceThresholdSatisfied !== sourceThresholdSatisfied ||
      assessment.oracleThresholdSatisfied !== oracleThresholdSatisfied ||
      assessment.correctionClass !== expectedClass ||
      assessment.severity !== PRODUCT_GATE_CORRECTION_SEVERITY_V1[expectedClass] ||
      assessment.changedPixels > assessment.sourceCanvasPixels ||
      assessment.oracleTargetPixels > assessment.sourceCanvasPixels ||
      (assessment.changedPixels === 0 && assessment.connectedEditRegionCount !== 0) ||
      (assessment.changedPixels > 0 &&
        (assessment.connectedEditRegionCount < 1 ||
          assessment.connectedEditRegionCount > assessment.changedPixels))
    ) {
      context.addIssue({ code: 'custom', message: 'Mask correction derivation drifted.' });
    }
  })
  .readonly();

export type ProductGateMaskCorrectionAssessmentV1 = z.infer<
  typeof ProductGateMaskCorrectionAssessmentV1Schema
>;

export const classifyProductGateForegroundMaskCorrectionV1 = (input: {
  readonly alphaBefore: Uint8Array;
  readonly alphaCorrected: Uint8Array;
  readonly oracleTargetPixels: number;
  readonly connectedEditRegionCount: number;
  readonly recoveredMissingCriticalSemanticElement: boolean;
}): ProductGateMaskCorrectionAssessmentV1 => {
  const before = Uint8Array.from(input.alphaBefore);
  const corrected = Uint8Array.from(input.alphaCorrected);
  if (before.byteLength !== corrected.byteLength) {
    throw new TypeError('Mask correction alpha planes must have identical canvas size.');
  }
  let changedPixels = 0;
  for (let index = 0; index < before.byteLength; index += 1) {
    if (before[index] !== corrected[index]) changedPixels += 1;
  }
  const oracleTargetPixels = z.int().min(0).max(16_777_216).parse(input.oracleTargetPixels);
  const connectedEditRegionCount = z
    .int()
    .min(0)
    .max(16_777_216)
    .parse(input.connectedEditRegionCount);
  const denominatorsValid = before.byteLength > 0 && oracleTargetPixels > 0;
  const sourceThresholdSatisfied =
    denominatorsValid && BigInt(changedPixels) * 100n <= BigInt(before.byteLength) * 2n;
  const oracleThresholdSatisfied =
    denominatorsValid && BigInt(changedPixels) * 10n <= BigInt(oracleTargetPixels);
  const correctionClass = !denominatorsValid
    ? 'major-mask-correction'
    : changedPixels === 0
      ? 'none'
      : sourceThresholdSatisfied &&
          oracleThresholdSatisfied &&
          connectedEditRegionCount === 1 &&
          !input.recoveredMissingCriticalSemanticElement
        ? 'minor-mask-correction'
        : 'major-mask-correction';
  return ProductGateMaskCorrectionAssessmentV1Schema.parse({
    changedPixels,
    sourceCanvasPixels: before.byteLength,
    oracleTargetPixels,
    connectedEditRegionCount,
    recoveredMissingCriticalSemanticElement: input.recoveredMissingCriticalSemanticElement,
    sourceThresholdSatisfied,
    oracleThresholdSatisfied,
    denominatorsValid,
    correctionClass,
    severity: PRODUCT_GATE_CORRECTION_SEVERITY_V1[correctionClass],
  });
};

export const ProductGateCorrectionRecordV1Schema = z
  .strictObject({
    correctionClass: ProductGateCorrectionClassV1Schema,
    severity: z.int().min(0).max(8),
    ordinaryCreativeIncludeExcludeSelection: z.boolean(),
    countedAsCorrection: z.boolean(),
    rationale: z.string().trim().min(1).max(1_000),
  })
  .superRefine((record, context) => {
    const expectedSeverity = PRODUCT_GATE_CORRECTION_SEVERITY_V1[record.correctionClass];
    const expectedCounted = record.correctionClass !== 'none';
    if (record.severity !== expectedSeverity || record.countedAsCorrection !== expectedCounted) {
      context.addIssue({ code: 'custom', message: 'Correction severity or counting drifted.' });
    }
    if (
      record.ordinaryCreativeIncludeExcludeSelection &&
      (record.correctionClass !== 'none' || record.countedAsCorrection)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Ordinary creative include/exclude selection is not a correction.',
      });
    }
  })
  .readonly();

export const ProductGateCorrectionBudgetV1Schema = z
  .strictObject({
    corrections: z.array(ProductGateCorrectionRecordV1Schema).max(64).readonly(),
    ordinaryCreativeSelectionCount: z.int().min(0).max(64),
    fragmentCombinationCount: z.int().min(0).max(64),
    minorMaskCorrectionCount: z.int().min(0).max(64),
    maximumSeverity: z.int().min(0).max(8),
    withinUsefulBudget: z.boolean(),
  })
  .superRefine((budget, context) => {
    const fragmentCombinationCount = budget.corrections.filter(
      (record) => record.correctionClass === 'combining-fragments',
    ).length;
    const minorMaskCorrectionCount = budget.corrections.filter(
      (record) => record.correctionClass === 'minor-mask-correction',
    ).length;
    const ordinaryCreativeSelectionCount = budget.corrections.filter(
      (record) => record.ordinaryCreativeIncludeExcludeSelection,
    ).length;
    const maximumSeverity = Math.max(0, ...budget.corrections.map((record) => record.severity));
    const withinUsefulBudget =
      fragmentCombinationCount <= 1 &&
      minorMaskCorrectionCount <= 1 &&
      !budget.corrections.some((record) => record.severity >= 6);
    if (
      budget.fragmentCombinationCount !== fragmentCombinationCount ||
      budget.minorMaskCorrectionCount !== minorMaskCorrectionCount ||
      budget.ordinaryCreativeSelectionCount !== ordinaryCreativeSelectionCount ||
      budget.maximumSeverity !== maximumSeverity ||
      budget.withinUsefulBudget !== withinUsefulBudget
    ) {
      context.addIssue({ code: 'custom', message: 'Correction budget derivation drifted.' });
    }
  })
  .readonly();

export const ProductGateCompositeUsefulnessScorecardV1Schema = z
  .strictObject({
    scorecardVersion: z.literal(1),
    everyCriticalElementCovered: z.boolean(),
    oracleValidCountAndGrouping: z.boolean(),
    foregroundComponents: z
      .array(ProductGateSegmentationScorecardV1Schema)
      .min(1)
      .max(64)
      .readonly(),
    approvedUsableBackground: z.boolean(),
    meaningfulAnimationReadyForegroundCount: z.int().min(0).max(64),
    correctionBudget: ProductGateCorrectionBudgetV1Schema,
    unresolvedDuplicateProblem: z.boolean(),
    unresolvedFragmentProblem: z.boolean(),
    useful: z.boolean(),
    outcome: z.enum(['pass', 'fail']),
  })
  .superRefine((scorecard, context) => {
    const useful =
      scorecard.everyCriticalElementCovered &&
      scorecard.oracleValidCountAndGrouping &&
      scorecard.foregroundComponents.every(
        (component) =>
          component.classification === 'usable' &&
          !component.duplicateProblem &&
          !component.fragmentProblem &&
          Object.values(component.scores).every((score) => score >= 3),
      ) &&
      scorecard.approvedUsableBackground &&
      scorecard.meaningfulAnimationReadyForegroundCount >= 1 &&
      scorecard.correctionBudget.withinUsefulBudget &&
      !scorecard.unresolvedDuplicateProblem &&
      !scorecard.unresolvedFragmentProblem;
    const derivedDuplicateProblem = scorecard.foregroundComponents.some(
      (component) => component.duplicateProblem,
    );
    const derivedFragmentProblem = scorecard.foregroundComponents.some(
      (component) => component.fragmentProblem,
    );
    if (
      (derivedDuplicateProblem && !scorecard.unresolvedDuplicateProblem) ||
      (derivedFragmentProblem && !scorecard.unresolvedFragmentProblem) ||
      scorecard.useful !== useful ||
      scorecard.outcome !== (useful ? 'pass' : 'fail')
    ) {
      context.addIssue({ code: 'custom', message: 'Composite usefulness derivation drifted.' });
    }
  })
  .readonly();

const RequirementResultV1Schema = z.enum(['pass', 'fail', 'inconclusive']);

export const ProductGateAuthoritativeValidationEvidenceV1Schema = z
  .strictObject({
    kind: z.literal('absent-gdn-authority'),
    status: z.literal('not-measurable'),
    authority: z.literal(false),
    internalProviderFreeValidationAcceptedAsGdn: z.literal(false),
  })
  .readonly();

export const ProductGateEndToEndScorecardV1Schema = z
  .strictObject({
    scorecardVersion: z.literal(1),
    compositeUsefulness: RequirementResultV1Schema,
    sceneMaterialization: RequirementResultV1Schema,
    presetAndTargetAppropriateness: RequirementResultV1Schema,
    preview: RequirementResultV1Schema,
    export: RequirementResultV1Schema,
    authoritativeValidation: ProductGateAuthoritativeValidationEvidenceV1Schema,
    failureRecovery: RequirementResultV1Schema,
    sevenRequirementCount: z.literal(7),
    outcome: ProductGateClosedDecisionV1Schema,
  })
  .superRefine((scorecard, context) => {
    if (scorecard.outcome !== 'not-measurable') {
      context.addIssue({
        code: 'custom',
        message: 'End-to-end outcome must remain not-measurable without GDN authority.',
      });
    }
  })
  .readonly();

const ReviewerIdV1Schema = z.string().regex(/^reviewer_[a-z0-9][a-z0-9_-]{2,31}$/u);
const ReviewClassificationV1Schema = z.enum(['pass', 'fail', 'inconclusive']);

const deriveDeterministicPresentationOrderV1 = (
  seed: string,
  itemIds: readonly string[],
): readonly string[] =>
  Object.freeze(
    [...itemIds].toSorted((left, right) => {
      const leftKey = sha256Hex(Buffer.from(canonicalizeJson({ seed, itemId: left }), 'utf8'));
      const rightKey = sha256Hex(Buffer.from(canonicalizeJson({ seed, itemId: right }), 'utf8'));
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : left < right ? -1 : 1;
    }),
  );

const ProductGateRawReviewCoreV1Schema = z
  .strictObject({
    reviewVersion: z.literal(1),
    caseId: ProductGateCorpusCaseIdV1Schema,
    reviewerId: ReviewerIdV1Schema,
    independentReview: z.literal(true),
    providerModelBlind: z.literal(true),
    deterministicPresentationSeed: Sha256HexSchema,
    presentationItemIds: z.array(z.string().min(1).max(160)).min(1).max(128).readonly(),
    presentationOrderSha256: Sha256HexSchema,
    categorical: z
      .strictObject({
        vision: ReviewClassificationV1Schema,
        segmentation: ReviewClassificationV1Schema,
        background: ReviewClassificationV1Schema,
        composite: ReviewClassificationV1Schema,
      })
      .readonly(),
    numeric: z
      .strictObject({
        visionUsefulness: ScoreZeroToFourSchema,
        semanticUsefulness: ScoreZeroToFourSchema,
        completeness: ScoreZeroToFourSchema,
        edgeMatteQuality: ScoreZeroToFourSchema,
        backgroundCleanliness: ScoreZeroToFourSchema,
        granularityIntegrity: ScoreZeroToFourSchema,
        repairReadiness: ScoreZeroToFourSchema,
        backgroundUsability: ScoreZeroToFourSchema,
        compositeUsefulness: ScoreZeroToFourSchema,
      })
      .readonly(),
    rationale: z.string().trim().min(1).max(2_000),
    modelConfidenceUsedAsOracle: z.literal(false),
  })
  .superRefine((review, context) => {
    const sortedItemIds = [...review.presentationItemIds].toSorted();
    if (
      new Set(review.presentationItemIds).size !== review.presentationItemIds.length ||
      canonicalizeJson(review.presentationItemIds) !== canonicalizeJson(sortedItemIds)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Presentation item identities must be unique and sorted.',
      });
      return;
    }
    const expectedOrder = deriveDeterministicPresentationOrderV1(
      review.deterministicPresentationSeed,
      review.presentationItemIds,
    );
    const expectedSha256 = sha256Hex(Buffer.from(canonicalizeJson(expectedOrder), 'utf8'));
    if (review.presentationOrderSha256 !== expectedSha256) {
      context.addIssue({ code: 'custom', message: 'Review presentation order identity drifted.' });
    }
  });

export const ProductGateRawReviewV1Schema = z
  .strictObject({
    reviewRecordId: ProductGateReviewRecordIdV1Schema,
    ...ProductGateRawReviewCoreV1Schema.shape,
  })
  .superRefine((review, context) => {
    const { reviewRecordId, ...core } = review;
    if (reviewRecordId !== createProductGateReviewRecordIdV1(core)) {
      context.addIssue({ code: 'custom', message: 'Raw review immutable identity drifted.' });
    }
  })
  .readonly();

export type ProductGateRawReviewV1 = z.infer<typeof ProductGateRawReviewV1Schema>;

export const createProductGateRawReviewV1 = (
  input: z.input<typeof ProductGateRawReviewCoreV1Schema>,
): ProductGateRawReviewV1 => {
  const core = ProductGateRawReviewCoreV1Schema.parse(input);
  return ProductGateRawReviewV1Schema.parse({
    reviewRecordId: createProductGateReviewRecordIdV1(core),
    ...core,
  });
};

export const deterministicProductGatePresentationOrderV1 = (input: {
  readonly seed: unknown;
  readonly itemIds: readonly string[];
}): readonly string[] => {
  const seed = Sha256HexSchema.parse(input.seed);
  const itemIds = z.array(z.string().min(1).max(160)).min(1).max(128).parse(input.itemIds);
  if (new Set(itemIds).size !== itemIds.length) {
    throw new TypeError('Presentation items must be unique.');
  }
  return deriveDeterministicPresentationOrderV1(seed, itemIds);
};

export const ProductGateAdjudicationRequirementV1Schema = z
  .strictObject({
    required: z.boolean(),
    categoricalDisagreements: z.array(z.string()).max(4).readonly(),
    numericDifferencesAtLeastTwo: z.array(z.string()).max(9).readonly(),
    triggerSha256: Sha256HexSchema,
  })
  .readonly();

export type ProductGateAdjudicationRequirementV1 = z.infer<
  typeof ProductGateAdjudicationRequirementV1Schema
>;

export const determineProductGateAdjudicationRequirementV1 = (input: {
  readonly first: unknown;
  readonly second: unknown;
}): ProductGateAdjudicationRequirementV1 => {
  const first = ProductGateRawReviewV1Schema.parse(input.first);
  const second = ProductGateRawReviewV1Schema.parse(input.second);
  if (first.caseId !== second.caseId || first.reviewerId === second.reviewerId) {
    throw new TypeError('Independent review pair requires one case and two distinct reviewers.');
  }
  if (
    first.deterministicPresentationSeed !== second.deterministicPresentationSeed ||
    first.presentationOrderSha256 !== second.presentationOrderSha256 ||
    canonicalizeJson(first.presentationItemIds) !== canonicalizeJson(second.presentationItemIds)
  ) {
    throw new TypeError('Independent review pair must share one exact deterministic presentation.');
  }
  const categoricalDisagreements = Object.keys(first.categorical)
    .filter(
      (key) =>
        first.categorical[key as keyof typeof first.categorical] !==
        second.categorical[key as keyof typeof second.categorical],
    )
    .toSorted();
  const numericDifferencesAtLeastTwo = Object.keys(first.numeric)
    .filter(
      (key) =>
        Math.abs(
          first.numeric[key as keyof typeof first.numeric] -
            second.numeric[key as keyof typeof second.numeric],
        ) >= 2,
    )
    .toSorted();
  const core = {
    required: categoricalDisagreements.length > 0 || numericDifferencesAtLeastTwo.length > 0,
    categoricalDisagreements,
    numericDifferencesAtLeastTwo,
  };
  return ProductGateAdjudicationRequirementV1Schema.parse({
    ...core,
    triggerSha256: sha256Hex(Buffer.from(canonicalizeJson(core), 'utf8')),
  });
};

const ProductGateAdjudicationCoreV1Schema = z
  .strictObject({
    adjudicationVersion: z.literal(1),
    rawReviews: z.tuple([ProductGateRawReviewV1Schema, ProductGateRawReviewV1Schema]).readonly(),
    requirement: ProductGateAdjudicationRequirementV1Schema,
    thirdReviewerId: ReviewerIdV1Schema,
    finalClassification: ReviewClassificationV1Schema,
    rationale: z.string().trim().min(1).max(2_000),
    rawReviewsOverwritten: z.literal(false),
    modelConfidenceUsedAsOracle: z.literal(false),
  })
  .superRefine((adjudication, context) => {
    const [first, second] = adjudication.rawReviews;
    let expected: ProductGateAdjudicationRequirementV1 | null = null;
    try {
      expected = determineProductGateAdjudicationRequirementV1({ first, second });
    } catch {
      context.addIssue({ code: 'custom', message: 'Adjudication raw review pair is invalid.' });
      return;
    }
    if (
      !expected.required ||
      canonicalizeJson(expected) !== canonicalizeJson(adjudication.requirement) ||
      [first.reviewerId, second.reviewerId].includes(adjudication.thirdReviewerId)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Required adjudication needs exact triggers and a distinct third reviewer.',
      });
    }
  });

export const ProductGateAdjudicationV1Schema = z
  .strictObject({
    adjudicationId: ProductGateAdjudicationIdV1Schema,
    ...ProductGateAdjudicationCoreV1Schema.shape,
  })
  .superRefine((adjudication, context) => {
    const { adjudicationId, ...core } = adjudication;
    const parsed = ProductGateAdjudicationCoreV1Schema.safeParse(core);
    if (!parsed.success || adjudicationId !== createProductGateAdjudicationIdV1(parsed.data)) {
      context.addIssue({ code: 'custom', message: 'Adjudication immutable identity drifted.' });
    }
  })
  .readonly();

export type ProductGateAdjudicationV1 = z.infer<typeof ProductGateAdjudicationV1Schema>;

export const createProductGateAdjudicationV1 = (
  input: z.input<typeof ProductGateAdjudicationCoreV1Schema>,
): ProductGateAdjudicationV1 => {
  const core = ProductGateAdjudicationCoreV1Schema.parse(input);
  return ProductGateAdjudicationV1Schema.parse({
    adjudicationId: createProductGateAdjudicationIdV1(core),
    ...core,
  });
};
