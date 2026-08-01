import { describe, expect, it } from 'vitest';

import { PRODUCT_GATE_HOLDOUT_STRUCTURAL_FAKE_V2 } from '../src/evaluation/product-gate-corpus-v2.js';
import {
  PRODUCT_GATE_FROZEN_THRESHOLDS_V2,
  PRODUCT_GATE_FROZEN_THRESHOLDS_V2_SHA256,
  ProductGateAggregateInputV2Schema,
  ProductGateBackgroundEvidenceV2Schema,
  ProductGateSegmentationEvidenceV2Schema,
  ProductGateVisionEvidenceV2Schema,
  aggregateProductGateVerdictV2,
  evaluateProductGateBackgroundV2,
  evaluateProductGateSegmentationV2,
  evaluateProductGateVisionV2,
} from '../src/evaluation/product-gate-scorecards-v2.js';
import { PRODUCT_GATE_SEGMENTATION_SCORE_ANCHORS_V1 } from '../src/evaluation/product-gate-scorecards-v1.js';
import { canonicalizeJson, sha256Hex } from '../src/scene/canonical-scene-json.js';

const envelope = (output: object, evidenceComplete = true) => ({
  authority: 'available' as const,
  outputStatus: 'produced' as const,
  evidenceComplete,
  output,
});

const reconstructionCase = PRODUCT_GATE_HOLDOUT_STRUCTURAL_FAKE_V2.cases.find(
  (entry) => entry.backgroundMode === 'reconstruction-required',
)!;
const solidCase = PRODUCT_GATE_HOLDOUT_STRUCTURAL_FAKE_V2.cases.find(
  (entry) => entry.backgroundMode === 'exact-solid-eligible',
)!;
const reconstructionRequirement = reconstructionCase.oracle.backgroundRequirement;
const solidRequirement = solidCase.oracle.backgroundRequirement;
if (
  reconstructionRequirement.mode !== 'reconstruction-required' ||
  solidRequirement.mode !== 'exact-solid-eligible'
) {
  throw new TypeError('Deterministic scorecard cases do not carry the expected oracle modes.');
}
const solidAuthorization = solidRequirement.exactSolidAuthorization;

const visionEvidence = () => ({
  evidenceVersion: 2 as const,
  oracle: reconstructionCase.oracle,
  coveredCriticalLayerIds: reconstructionCase.oracle.requiredLayers
    .filter((layer) => layer.critical)
    .map((layer) => layer.oracleLayerId),
  actualLayerCount: reconstructionCase.oracle.requiredLayerIds.length,
  groupingAllowedByOracle: true,
  matchedLayers: reconstructionCase.oracle.requiredLayerIds.map((oracleLayerId, index) => ({
    oracleLayerId,
    semanticRoleMatches: true,
    semanticRoleAndNameUsefulness: index === 0 ? 3 : 4,
    boundingBoxEvidence: {
      kind: 'oracle-iou' as const,
      iouBps: index === 0 ? 5_000 : 10_000,
    },
  })),
  extraLayerIds: [],
  unresolvedDuplicate: false,
  unresolvedFragment: false,
  modelConfidenceUsedAsOracle: false as const,
});

const segmentationEvidence = () => ({
  evidenceVersion: 2 as const,
  scoringStage: 'initial' as const,
  oracle: reconstructionCase.oracle,
  components: reconstructionCase.oracle.requiredLayers
    .filter((layer) => layer.semanticRole !== 'background')
    .map((layer) => ({
      oracleLayerId: layer.oracleLayerId,
      scores: {
        semanticUsefulness: 3,
        completeness: 3,
        edgeMatteQuality: 3,
        backgroundCleanliness: 3,
        granularityIntegrity: 3,
        repairReadiness: 3,
      },
      duplicateProblem: false,
      unresolvedFragmentProblem: false,
    })),
  anchors: PRODUCT_GATE_SEGMENTATION_SCORE_ANCHORS_V1,
  scorePolarity: 'zero-worst-four-best-no-average' as const,
  averagedScore: null,
  correctionBudget: {
    corrections: [],
    ordinaryCreativeSelectionCount: 0,
    fragmentCombinationCount: 0,
    minorMaskCorrectionCount: 0,
    maximumSeverity: 0,
    withinUsefulBudget: true,
  },
  minorMaskCorrectionAssessments: [],
});

const reconstructionEvidence = () => ({
  evidenceVersion: 2 as const,
  kind: 'reconstruction' as const,
  requiredMode: 'reconstruction-required' as const,
  oracle: reconstructionCase.oracle,
  reconstructionDimensions: {
    kind: 'scored' as const,
    removedObjectLeakage: 3,
    continuity: 3,
    contamination: 3,
  },
  usability: 3,
  transparentForegroundCutoutAlsoAvailable: true,
});

const solidEvidence = () => ({
  evidenceVersion: 2 as const,
  kind: 'deterministic-solid-fallback' as const,
  requiredMode: 'exact-solid-eligible' as const,
  oracle: solidCase.oracle,
  exactRgba: solidAuthorization.exactRgba,
  authorization: solidAuthorization,
  reconstructionDimensions: {
    kind: 'not-applicable' as const,
    reason: 'oracle-authorized-deterministic-solid-fallback' as const,
  },
  usability: 3,
});

type CorrectionClass =
  | 'combining-fragments'
  | 'minor-mask-correction'
  | 'major-mask-correction'
  | 'complete-decomposition-failure';

const severityByCorrection = {
  'combining-fragments': 4,
  'minor-mask-correction': 5,
  'major-mask-correction': 6,
  'complete-decomposition-failure': 8,
} as const;

const correctionBudget = (classes: readonly CorrectionClass[]) => {
  const corrections = classes.map((correctionClass) => ({
    correctionClass,
    severity: severityByCorrection[correctionClass],
    ordinaryCreativeIncludeExcludeSelection: false,
    countedAsCorrection: true,
    rationale: 'Deterministic correction evidence.',
  }));
  const fragmentCombinationCount = classes.filter(
    (correctionClass) => correctionClass === 'combining-fragments',
  ).length;
  const minorMaskCorrectionCount = classes.filter(
    (correctionClass) => correctionClass === 'minor-mask-correction',
  ).length;
  const maximumSeverity = Math.max(0, ...classes.map((entry) => severityByCorrection[entry]));
  return {
    corrections,
    ordinaryCreativeSelectionCount: 0,
    fragmentCombinationCount,
    minorMaskCorrectionCount,
    maximumSeverity,
    withinUsefulBudget:
      fragmentCombinationCount <= 1 && minorMaskCorrectionCount <= 1 && maximumSeverity < 6,
  };
};

const qualifyingMinorMaskAssessment = () => ({
  changedPixels: 1,
  sourceCanvasPixels: 100,
  oracleTargetPixels: 10,
  connectedEditRegionCount: 1,
  recoveredMissingCriticalSemanticElement: false,
  sourceThresholdSatisfied: true,
  oracleThresholdSatisfied: true,
  denominatorsValid: true,
  correctionClass: 'minor-mask-correction' as const,
  severity: 5 as const,
});

const segmentationEvidenceWithCorrections = (classes: readonly CorrectionClass[]) => ({
  ...segmentationEvidence(),
  scoringStage: 'corrected-final' as const,
  correctionBudget: correctionBudget(classes),
  minorMaskCorrectionAssessments: classes
    .filter((correctionClass) => correctionClass === 'minor-mask-correction')
    .map(() => qualifyingMinorMaskAssessment()),
});

describe('Phase 3B vision scoring', () => {
  it('passes every boundary at role/name 3 and IoU 5,000 bps only with exact coverage', () => {
    expect(evaluateProductGateVisionV2(envelope(visionEvidence())).decision).toBe('pass');

    const belowIou = structuredClone(visionEvidence());
    belowIou.matchedLayers[0]!.boundingBoxEvidence.iouBps = 4_999;
    expect(evaluateProductGateVisionV2(envelope(belowIou)).decision).toBe('fail');
    expect(evaluateProductGateVisionV2(envelope(belowIou, false)).decision).toBe('fail');

    const belowUsefulness = structuredClone(visionEvidence());
    belowUsefulness.matchedLayers[0]!.semanticRoleAndNameUsefulness = 2;
    expect(evaluateProductGateVisionV2(envelope(belowUsefulness)).decision).toBe('fail');

    const wrongRole = structuredClone(visionEvidence());
    wrongRole.matchedLayers[0]!.semanticRoleMatches = false;
    expect(evaluateProductGateVisionV2(envelope(wrongRole)).decision).toBe('fail');

    const missingRequired = structuredClone(visionEvidence());
    missingRequired.matchedLayers.pop();
    missingRequired.actualLayerCount -= 1;
    expect(evaluateProductGateVisionV2(envelope(missingRequired)).decision).toBe('fail');

    for (const invalid of [
      { ...visionEvidence(), coveredCriticalLayerIds: [] },
      { ...visionEvidence(), groupingAllowedByOracle: false },
      {
        ...visionEvidence(),
        extraLayerIds: [`pge_oracle_layer_v2_${'f'.repeat(64)}`],
        actualLayerCount: visionEvidence().actualLayerCount + 1,
      },
      { ...visionEvidence(), unresolvedDuplicate: true },
      { ...visionEvidence(), unresolvedFragment: true },
    ]) {
      expect(evaluateProductGateVisionV2(envelope(invalid)).decision).toBe('fail');
    }
  });

  it('makes omitted required box evidence a hard invalid-schema failure, never inconclusive', () => {
    const missingBox = structuredClone(visionEvidence()) as Record<string, unknown>;
    const matches = missingBox['matchedLayers'] as Record<string, unknown>[];
    delete matches[0]!['boundingBoxEvidence'];
    expect(evaluateProductGateVisionV2(envelope(missingBox, false))).toMatchObject({
      decision: 'fail',
      outputDisposition: 'invalid-schema',
      reason: 'invalid-schema-hard-failure',
    });
  });

  it('fails missing, failed, unsupported, invalid, and unattempted required output', () => {
    for (const outputStatus of [
      'missing',
      'failed',
      'invalid-schema',
      'unsupported',
      'unattempted',
    ] as const) {
      expect(
        evaluateProductGateVisionV2({
          authority: 'available',
          outputStatus,
          evidenceComplete: false,
          output: null,
        }).decision,
      ).toBe('fail');
    }
    expect(evaluateProductGateVisionV2({ ...envelope(visionEvidence(), false) }).decision).toBe(
      'inconclusive',
    );
    expect(
      evaluateProductGateVisionV2({
        ...envelope(visionEvidence()),
        authority: 'missing-holdout-authority',
      }).decision,
    ).toBe('not-measurable');
  });

  it('rejects unknown vision fields through the strict evidence contract', () => {
    expect(
      ProductGateVisionEvidenceV2Schema.safeParse({ ...visionEvidence(), unexpected: true })
        .success,
    ).toBe(false);
    expect(
      evaluateProductGateVisionV2({ ...envelope(visionEvidence()), unexpected: true }),
    ).toMatchObject({ decision: 'fail', outputDisposition: 'invalid-schema' });
  });
});

describe('Phase 3B segmentation scoring', () => {
  it('preserves all six independent >=3 dimensions without averaging', () => {
    expect(evaluateProductGateSegmentationV2(envelope(segmentationEvidence()))).toMatchObject({
      decision: 'pass',
      classification: 'usable',
    });
    expect(Object.keys(segmentationEvidence().components[0]!.scores)).toHaveLength(6);

    const repairable = structuredClone(segmentationEvidence());
    repairable.components[0]!.scores.edgeMatteQuality = 2;
    expect(evaluateProductGateSegmentationV2(envelope(repairable))).toMatchObject({
      decision: 'fail',
      classification: 'repairable',
    });
    expect(evaluateProductGateSegmentationV2(envelope(repairable, false)).decision).toBe('fail');
    const corrected = { ...segmentationEvidence(), scoringStage: 'corrected-final' as const };
    expect(evaluateProductGateSegmentationV2(envelope(corrected)).decision).toBe('pass');
  });

  it('makes duplicates, unresolved fragments, and zero scores unusable', () => {
    const zero = structuredClone(segmentationEvidence());
    zero.components[0]!.scores.completeness = 0;
    const duplicate = structuredClone(segmentationEvidence());
    duplicate.components[0]!.duplicateProblem = true;
    const fragment = structuredClone(segmentationEvidence());
    fragment.components[0]!.unresolvedFragmentProblem = true;
    for (const observed of [
      zero,
      duplicate,
      fragment,
      { ...segmentationEvidence(), components: segmentationEvidence().components.slice(1) },
    ]) {
      expect(evaluateProductGateSegmentationV2(envelope(observed))).toMatchObject({
        decision: 'fail',
        classification: 'unusable',
      });
    }
  });

  it('allows at most one fragment combination and one minor correction, excluding severity 6-8', () => {
    expect(
      evaluateProductGateSegmentationV2(
        envelope({
          ...segmentationEvidenceWithCorrections(['combining-fragments', 'minor-mask-correction']),
        }),
      ).decision,
    ).toBe('pass');
    for (const overBudget of [
      correctionBudget(['combining-fragments', 'combining-fragments']),
      correctionBudget(['minor-mask-correction', 'minor-mask-correction']),
      correctionBudget(['major-mask-correction']),
      correctionBudget(['complete-decomposition-failure']),
    ]) {
      expect(
        evaluateProductGateSegmentationV2(
          envelope({
            ...segmentationEvidence(),
            scoringStage: 'corrected-final',
            correctionBudget: overBudget,
            minorMaskCorrectionAssessments: Array.from(
              { length: overBudget.minorMaskCorrectionCount },
              qualifyingMinorMaskAssessment,
            ),
          }),
        ).decision,
      ).toBe('fail');
    }
  });

  it('requires corrected-final rescoring and a qualifying assessment for retained corrections', () => {
    const corrected = segmentationEvidenceWithCorrections(['minor-mask-correction']);
    expect(evaluateProductGateSegmentationV2(envelope(corrected)).decision).toBe('pass');
    expect(
      evaluateProductGateSegmentationV2(
        envelope({ ...corrected, scoringStage: 'initial' as const }),
      ),
    ).toMatchObject({ decision: 'fail', outputDisposition: 'invalid-schema' });
    expect(
      evaluateProductGateSegmentationV2(
        envelope({ ...corrected, minorMaskCorrectionAssessments: [] }),
      ),
    ).toMatchObject({ decision: 'fail', outputDisposition: 'invalid-schema' });
    expect(
      evaluateProductGateSegmentationV2(
        envelope({
          ...corrected,
          minorMaskCorrectionAssessments: [
            { ...qualifyingMinorMaskAssessment(), recoveredMissingCriticalSemanticElement: true },
          ],
        }),
      ),
    ).toMatchObject({ decision: 'fail', outputDisposition: 'invalid-schema' });
  });

  it('keeps the segmentation evidence contract strict', () => {
    expect(
      ProductGateSegmentationEvidenceV2Schema.safeParse({
        ...segmentationEvidence(),
        averagedScore: 3,
      }).success,
    ).toBe(false);
    expect(
      ProductGateSegmentationEvidenceV2Schema.safeParse({
        ...segmentationEvidence(),
        components: [
          {
            ...segmentationEvidence().components[0],
            scores: {
              ...segmentationEvidence().components[0]!.scores,
              seventhDimension: 4,
            },
          },
          ...segmentationEvidence().components.slice(1),
        ],
      }).success,
    ).toBe(false);
    expect(
      ProductGateSegmentationEvidenceV2Schema.safeParse({
        ...segmentationEvidence(),
        anchors: { drifted: true },
      }).success,
    ).toBe(false);
    expect(
      ProductGateSegmentationEvidenceV2Schema.safeParse({
        ...segmentationEvidence(),
        correctionBudget: {
          ...correctionBudget(['minor-mask-correction']),
          maximumSeverity: 0,
        },
      }).success,
    ).toBe(false);
  });
});

describe('Phase 3B background scoring', () => {
  it('passes reconstruction only when every independent dimension and usability are >=3', () => {
    expect(evaluateProductGateBackgroundV2(envelope(reconstructionEvidence())).decision).toBe(
      'pass',
    );
    for (const key of ['removedObjectLeakage', 'continuity', 'contamination'] as const) {
      const below = structuredClone(reconstructionEvidence());
      below.reconstructionDimensions[key] = 2;
      expect(evaluateProductGateBackgroundV2(envelope(below)).decision).toBe('fail');
      expect(evaluateProductGateBackgroundV2(envelope(below, false)).decision).toBe('fail');
    }
    expect(
      evaluateProductGateBackgroundV2(envelope({ ...reconstructionEvidence(), usability: 2 }))
        .decision,
    ).toBe('fail');
  });

  it('accepts exact solid fallback only with exact identity-bound oracle authorization', () => {
    expect(evaluateProductGateBackgroundV2(envelope(solidEvidence()))).toMatchObject({
      decision: 'pass',
      reason: 'all-requirements-pass',
      backgroundResultKind: 'deterministic-solid-fallback',
    });
    const validSolid = solidEvidence();
    const wrongColor = {
      ...validSolid,
      authorization: { ...validSolid.authorization, exactRgba: [11, 20, 30, 255] },
    };
    expect(evaluateProductGateBackgroundV2(envelope(wrongColor))).toMatchObject({
      decision: 'fail',
      outputDisposition: 'invalid-schema',
    });
    expect(
      ProductGateBackgroundEvidenceV2Schema.safeParse({
        ...solidEvidence(),
        requiredMode: 'reconstruction-required',
      }).success,
    ).toBe(false);
    expect(
      evaluateProductGateBackgroundV2(envelope({ ...solidEvidence(), usability: 2 })).decision,
    ).toBe('fail');
  });

  it('never treats a transparent foreground cutout as background success', () => {
    expect(
      evaluateProductGateBackgroundV2(
        envelope({
          evidenceVersion: 2,
          kind: 'transparent-foreground-cutout-only',
          requiredMode: 'reconstruction-required',
          oracle: reconstructionCase.oracle,
          foregroundIsolationSatisfied: true,
          backgroundRequirementSatisfied: false,
        }),
      ),
    ).toMatchObject({ decision: 'fail', reason: 'transparent-cutout-is-not-background' });
  });
});

const roles = {
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
} as const;

const aggregateInput = () => ({
  aggregateVersion: 2 as const,
  authority: {
    holdout: 'available' as const,
    authoritativeGdn: 'available' as const,
    internalProviderFreeValidatorAcceptedAsAuthoritativeGdn: false as const,
  },
  evidenceComplete: true,
  metrics: Object.entries(roles).map(([metricId, role]) => ({
    metricId: metricId as keyof typeof roles,
    role,
    decision:
      role === 'descriptive-only' || role === 'separate-observational'
        ? ('inconclusive' as const)
        : ('pass' as const),
  })),
});

describe('Phase 3B aggregate verdict and frozen thresholds', () => {
  it('applies not-measurable, fail, inconclusive, pass precedence without averaging', () => {
    const baseMissingAuthority = aggregateInput();
    const missingAuthority = {
      ...baseMissingAuthority,
      authority: { ...baseMissingAuthority.authority, authoritativeGdn: 'missing' as const },
      metrics: baseMissingAuthority.metrics.map((metric, index) =>
        index === 0 ? { ...metric, decision: 'fail' as const } : metric,
      ),
    };
    expect(aggregateProductGateVerdictV2(missingAuthority)).toMatchObject({
      verdict: 'not-measurable',
      weightedAverageUsed: false,
    });

    const baseFailed = aggregateInput();
    const failed = {
      ...baseFailed,
      evidenceComplete: false,
      metrics: baseFailed.metrics.map((metric, index) =>
        index === 0 ? { ...metric, decision: 'fail' as const } : metric,
      ),
    };
    expect(aggregateProductGateVerdictV2(failed).verdict).toBe('fail');

    const incomplete = aggregateInput();
    incomplete.metrics = incomplete.metrics.slice(1);
    expect(aggregateProductGateVerdictV2(incomplete).verdict).toBe('inconclusive');
    expect(aggregateProductGateVerdictV2({ ...aggregateInput(), metrics: [] }).verdict).toBe(
      'inconclusive',
    );
    expect(aggregateProductGateVerdictV2(aggregateInput())).toMatchObject({
      verdict: 'pass',
      weightedAverageUsed: false,
    });
  });

  it('keeps observed recovery separately inconclusive below ten events without blocking pass', () => {
    const input = aggregateInput();
    const observed = input.metrics.find((metric) => metric.metricId === 'observed-real-recovery');
    expect(observed).toMatchObject({ role: 'separate-observational', decision: 'inconclusive' });
    expect(PRODUCT_GATE_FROZEN_THRESHOLDS_V2.observedRealRecovery.minimumEligibleEvents).toBe(10);
    expect(aggregateProductGateVerdictV2(input).verdict).toBe('pass');
  });

  it('freezes every Phase 3A target and stable canonical policy identity', () => {
    expect(PRODUCT_GATE_FROZEN_THRESHOLDS_V2).toMatchObject({
      denominator: 18,
      usefulLayer: { minimumSuccesses: 15, requiredSuccessfulStrata: 9 },
      endToEnd: { minimumSuccesses: 14 },
      successfulLatencyMs: { p50Maximum: 240_000, p95Maximum: 420_000 },
      terminalLatencyMs: { maximum: 600_000 },
      costPerSuccessMicros: { maximum: '350000' },
      firstAttemptFailure: { role: 'descriptive-only' },
      finalStepFailure: { maximumNumerator: 1, denominator: 10 },
      authoritativeExport: { firstPassMinimum: 17, finalPassRequired: 18 },
      manualCorrection: { maximumNumerator: 3, denominator: 10 },
      majorIntervention: { maximumNumerator: 1, denominator: 10 },
      observedRealRecovery: { minimumNumerator: 9, denominator: 10 },
      componentRepeat: { minimumMatching: 5, predesignatedCases: 6 },
      aggregation: 'ordered-precedence-no-weighted-average',
    });
    expect(PRODUCT_GATE_FROZEN_THRESHOLDS_V2_SHA256).toBe(
      sha256Hex(Buffer.from(canonicalizeJson(PRODUCT_GATE_FROZEN_THRESHOLDS_V2), 'utf8')),
    );
    expect(PRODUCT_GATE_FROZEN_THRESHOLDS_V2_SHA256).toBe(
      'e4e6a22365c9759ffcbf4c3685a37ae34372507d804460917bbb5d7451a56880',
    );
  });

  it('reserves not-measurable for missing authority and rejects unknown aggregate fields', () => {
    const baseInvalidDecision = aggregateInput();
    const invalidDecision = {
      ...baseInvalidDecision,
      metrics: baseInvalidDecision.metrics.map((metric, index) =>
        index === 0 ? { ...metric, decision: 'not-measurable' as const } : metric,
      ),
    };
    expect(ProductGateAggregateInputV2Schema.safeParse(invalidDecision).success).toBe(false);
    expect(aggregateProductGateVerdictV2(invalidDecision)).toMatchObject({
      verdict: 'fail',
      reason: 'invalid-aggregate-schema-hard-failure',
    });
    expect(
      ProductGateAggregateInputV2Schema.safeParse({ ...aggregateInput(), weightedAverage: 4 })
        .success,
    ).toBe(false);
    expect(aggregateProductGateVerdictV2({ ...aggregateInput(), weightedAverage: 4 }).verdict).toBe(
      'fail',
    );
    const missingAuthorityWithInvalidSchema = {
      ...aggregateInput(),
      authority: { ...aggregateInput().authority, authoritativeGdn: 'missing' as const },
      unknown: true,
    };
    expect(
      ProductGateAggregateInputV2Schema.safeParse(missingAuthorityWithInvalidSchema).success,
    ).toBe(false);
    expect(aggregateProductGateVerdictV2(missingAuthorityWithInvalidSchema).verdict).toBe(
      'not-measurable',
    );
  });
});
