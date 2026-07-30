import { describe, expect, it } from 'vitest';

import {
  PRODUCT_GATE_BLOCKED_HOLDOUT_V1,
  PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
} from '../src/evaluation/product-gate-corpus-v1.js';
import {
  ProductGateMetricResultV1Schema,
  calculateAuthoritativeExportFormulaV1,
  calculateProductGateEndToEndFormulaV1,
  calculateUsefulLayerSuccessFormulaV1,
  evaluateAllCaseTerminalLatencyV1,
  evaluateAuthoritativeExportV1,
  evaluateComponentRepeatReproducibilityV1,
  evaluateCostPerSuccessV1,
  evaluateInjectedRecoveryV1,
  evaluateMajorInterventionRateV1,
  evaluateManualCorrectionRateV1,
  evaluateObservedRealRecoveryV1,
  evaluateProductGateEndToEndMetricV1,
  evaluateReplayReproducibilityV1,
  evaluateStepFailureRateV1,
  evaluateSuccessfulRunLatencyV1,
  evaluateUsefulLayerSuccessV1,
  nearestRankPercentileV1,
} from '../src/evaluation/product-gate-metrics-v1.js';

const holdoutCases = (successful: number) =>
  Array.from({ length: 18 }, (_, index) => ({
    caseId: `holdout-${String(index + 1)}`,
    primaryStratum: `stratum-${String(Math.floor(index / 2) + 1)}`,
    useful: index < successful,
  }));

describe('authority-aware useful-layer and E2E metrics', () => {
  it('never treats development fixtures or a blocked holdout as product-gate evidence', () => {
    expect(
      evaluateUsefulLayerSuccessV1({
        corpusManifest: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
      }).decision,
    ).toBe('not-measurable');
    expect(
      evaluateUsefulLayerSuccessV1({
        corpusManifest: PRODUCT_GATE_BLOCKED_HOLDOUT_V1,
      }).decision,
    ).toBe('not-measurable');
    expect(
      evaluateProductGateEndToEndMetricV1({
        corpusManifest: PRODUCT_GATE_BLOCKED_HOLDOUT_V1,
      }).decision,
    ).toBe('not-measurable');
    expect(
      evaluateAuthoritativeExportV1({
        corpusManifest: PRODUCT_GATE_BLOCKED_HOLDOUT_V1,
      }).decision,
    ).toBe('not-measurable');
  });

  it('implements 15/18 plus every two-case stratum and the 14/18 E2E boundary exactly', () => {
    const thresholdCases = holdoutCases(18).map((item, index) => ({
      ...item,
      useful: ![1, 3, 5].includes(index),
    }));
    expect(
      calculateUsefulLayerSuccessFormulaV1({
        cases: thresholdCases,
      }).decision,
    ).toBe('pass');
    const missingStratum = holdoutCases(18).map((item, index) => ({
      ...item,
      useful: index === 0 || index === 1 ? false : item.useful,
    }));
    expect(
      calculateUsefulLayerSuccessFormulaV1({
        cases: missingStratum,
      }).decision,
    ).toBe('fail');
    expect(
      calculateUsefulLayerSuccessFormulaV1({
        cases: holdoutCases(14),
      }).decision,
    ).toBe('fail');
    for (const [successes, expected] of [
      [14, 'pass'],
      [13, 'fail'],
    ] as const) {
      expect(
        calculateProductGateEndToEndFormulaV1({
          cases: Array.from({ length: 18 }, (_, index) => ({
            caseId: `holdout-${String(index + 1)}`,
            allSevenRequirementsSatisfied: index < successes,
          })),
        }).decision,
      ).toBe(expected);
    }
    expect(
      calculateProductGateEndToEndFormulaV1({
        cases: [],
      }).decision,
    ).toBe('inconclusive');
  });
});

describe('latency, cost, and failure-rate formulas', () => {
  it('uses nearest-rank p50/p95 and exact terminal latency boundaries', () => {
    expect(nearestRankPercentileV1([4, 1, 3, 2], 0.5)).toBe(2);
    expect(nearestRankPercentileV1([4, 1, 3, 2], 0.95)).toBe(4);
    expect(nearestRankPercentileV1([], 0.95)).toBeNull();
    expect(
      evaluateSuccessfulRunLatencyV1({
        successfulRuns: [
          { caseId: 'case-1', durationMs: 240_000 },
          { caseId: 'case-2', durationMs: 420_000 },
        ],
        evidenceComplete: true,
      }).decision,
    ).toBe('pass');
    expect(
      evaluateSuccessfulRunLatencyV1({
        successfulRuns: [
          { caseId: 'case-1', durationMs: 240_001 },
          { caseId: 'case-2', durationMs: 420_001 },
        ],
        evidenceComplete: true,
      }).decision,
    ).toBe('fail');
    expect(
      evaluateSuccessfulRunLatencyV1({
        successfulRuns: [],
        evidenceComplete: true,
      }).decision,
    ).toBe('inconclusive');
    expect(
      evaluateAllCaseTerminalLatencyV1({
        terminalCases: Array.from({ length: 18 }, (_, index) => ({
          caseId: `case-${String(index + 1)}`,
          durationMs: index === 17 ? 600_000 : 1,
        })),
        evidenceComplete: true,
      }).decision,
    ).toBe('pass');
    expect(
      evaluateAllCaseTerminalLatencyV1({
        terminalCases: Array.from({ length: 18 }, (_, index) => ({
          caseId: `case-${String(index + 1)}`,
          durationMs: index === 17 ? 600_001 : 1,
        })),
        evidenceComplete: true,
      }).decision,
    ).toBe('fail');
    expect(
      evaluateAllCaseTerminalLatencyV1({
        terminalCases: [{ caseId: 'only-one', durationMs: 1 }],
        evidenceComplete: true,
      }).decision,
    ).toBe('inconclusive');
  });

  it('includes actual, estimated, and reserved costs for failed and indeterminate attempts', () => {
    const attempts = [
      {
        attemptId: 'attempt-1',
        caseId: 'case-1',
        terminalStatus: 'succeeded',
        actualCostMicros: '350000',
        estimatedCostMicros: '999999',
        reservedCostMicros: '999999',
      },
      {
        attemptId: 'attempt-2',
        caseId: 'case-2',
        terminalStatus: 'failed',
        actualCostMicros: null,
        estimatedCostMicros: '350000',
        reservedCostMicros: '999999',
      },
      {
        attemptId: 'attempt-3',
        caseId: 'case-3',
        terminalStatus: 'indeterminate',
        actualCostMicros: null,
        estimatedCostMicros: null,
        reservedCostMicros: '350000',
      },
    ];
    const atBoundary = evaluateCostPerSuccessV1({
      attempts,
      endToEndSuccessCaseIds: ['case-1', 'case-2', 'case-3'],
      evidenceComplete: true,
    });
    expect(atBoundary.decision).toBe('pass');
    expect(atBoundary.observations).toContainEqual({
      name: 'accounted-cost-micros',
      value: '1050000',
    });
    expect(
      evaluateCostPerSuccessV1({
        attempts: [
          ...attempts,
          {
            ...attempts[0],
            attemptId: 'attempt-4',
            actualCostMicros: '1',
          },
        ],
        endToEndSuccessCaseIds: ['case-1', 'case-2', 'case-3'],
        evidenceComplete: true,
      }).decision,
    ).toBe('fail');
    expect(
      evaluateCostPerSuccessV1({
        attempts,
        endToEndSuccessCaseIds: [],
        evidenceComplete: true,
      }),
    ).toMatchObject({ decision: 'inconclusive', reason: 'zero-successes' });
  });

  it('measures first-attempt failures descriptively and applies <=10% only to final failures', () => {
    const cases = (count: number, firstFailures: number, terminalFailures: number) =>
      Array.from({ length: count }, (_, index) => ({
        caseId: `case-${String(index + 1)}`,
        firstAttemptFailed: index < firstFailures,
        terminalFailed: index < terminalFailures,
      }));
    expect(
      evaluateStepFailureRateV1({
        kind: 'first-attempt',
        stage: 'segmentation',
        cases: cases(10, 5, 0),
      }),
    ).toMatchObject({ decision: 'inconclusive', reason: 'descriptive-measure-only' });
    expect(
      evaluateStepFailureRateV1({
        kind: 'final',
        stage: 'segmentation',
        cases: cases(10, 5, 1),
      }).decision,
    ).toBe('pass');
    expect(
      evaluateStepFailureRateV1({
        kind: 'final',
        stage: 'segmentation',
        cases: cases(100, 20, 11),
      }).decision,
    ).toBe('fail');
    expect(
      evaluateStepFailureRateV1({ kind: 'final', stage: 'segmentation', cases: [] }).decision,
    ).toBe('inconclusive');
  });
});

describe('export, correction, intervention, recovery, and reproducibility metrics', () => {
  it('keeps export not-measurable before GDN and applies exact 17/18 then 18/18 targets', () => {
    expect(
      evaluateAuthoritativeExportV1({
        corpusManifest: PRODUCT_GATE_BLOCKED_HOLDOUT_V1,
      }).decision,
    ).toBe('not-measurable');
    const exportCases = (firstPassCount: number, finalPassCount: number) =>
      Array.from({ length: 18 }, (_, index) => ({
        caseId: `case-${String(index + 1)}`,
        firstPass: index < firstPassCount,
        finalPass: index < finalPassCount,
      }));
    expect(
      calculateAuthoritativeExportFormulaV1({
        cases: exportCases(17, 18),
      }).decision,
    ).toBe('pass');
    expect(
      calculateAuthoritativeExportFormulaV1({
        cases: exportCases(16, 18),
      }).decision,
    ).toBe('fail');
  });

  it('applies <=30% corrections and <=10% major intervention with zero-denominator closure', () => {
    const threeCorrections = [
      'rename-only',
      'reordering',
      'minor-mask-correction',
      ...Array.from({ length: 7 }, () => 'none' as const),
    ];
    expect(
      evaluateManualCorrectionRateV1({
        decompositions: threeCorrections.map((correctionClass, index) => ({
          decompositionId: `decomposition-${String(index + 1)}`,
          correctionClass,
        })),
      }).decision,
    ).toBe('pass');
    expect(
      evaluateManualCorrectionRateV1({
        decompositions: [
          ...threeCorrections.slice(0, 3),
          'rename-only' as const,
          ...threeCorrections.slice(4),
        ].map((correctionClass, index) => ({
          decompositionId: `decomposition-${String(index + 1)}`,
          correctionClass,
        })),
      }).decision,
    ).toBe('fail');
    expect(evaluateManualCorrectionRateV1({ decompositions: [] }).decision).toBe('inconclusive');
    expect(() =>
      evaluateManualCorrectionRateV1({
        decompositions: [
          {
            decompositionId: 'not-produced',
            correctionClass: 'complete-decomposition-failure',
          },
        ],
      }),
    ).toThrow(/not a decomposition produced/u);

    expect(
      evaluateMajorInterventionRateV1({
        cases: [
          'major-mask-correction' as const,
          ...Array.from({ length: 17 }, () => 'none' as const),
        ].map((correctionClass, index) => ({
          caseId: `case-${String(index + 1)}`,
          correctionClass,
        })),
      }).decision,
    ).toBe('pass');
    expect(
      evaluateMajorInterventionRateV1({
        cases: [
          'major-mask-correction' as const,
          'background-replacement' as const,
          ...Array.from({ length: 16 }, () => 'none' as const),
        ].map((correctionClass, index) => ({
          caseId: `case-${String(index + 1)}`,
          correctionClass,
        })),
      }).decision,
    ).toBe('fail');
  });

  it('closes injected/real recovery and both reproducibility targets at their boundaries', () => {
    expect(evaluateInjectedRecoveryV1(10, 10).decision).toBe('pass');
    expect(evaluateInjectedRecoveryV1(9, 10).decision).toBe('fail');
    expect(evaluateObservedRealRecoveryV1(9, 9).decision).toBe('inconclusive');
    expect(evaluateObservedRealRecoveryV1(9, 10).decision).toBe('pass');
    expect(evaluateObservedRealRecoveryV1(8, 10).decision).toBe('fail');
    expect(evaluateReplayReproducibilityV1(4, 4).decision).toBe('pass');
    expect(evaluateReplayReproducibilityV1(3, 4).decision).toBe('fail');
    const repeatCases = (successes: number, count = 6) =>
      Array.from({ length: count }, (_, index) => ({
        caseId: `repeat-${String(index + 1)}`,
        predesignated: true,
        backgroundStrategy: 'reconstruction' as const,
        sameClassification: index < successes,
        sameCriticalCoverage: index < successes,
      }));
    expect(evaluateComponentRepeatReproducibilityV1({ cases: repeatCases(5) }).decision).toBe(
      'pass',
    );
    expect(evaluateComponentRepeatReproducibilityV1({ cases: repeatCases(4) }).decision).toBe(
      'fail',
    );
    expect(evaluateComponentRepeatReproducibilityV1({ cases: repeatCases(5, 5) }).decision).toBe(
      'inconclusive',
    );
  });

  it('uses strict closed metric results with no NaN or omitted decision path', () => {
    const result = evaluateInjectedRecoveryV1(0, 0);
    expect(result.decision).toBe('inconclusive');
    expect(JSON.stringify(result)).not.toContain('NaN');
    expect(ProductGateMetricResultV1Schema.safeParse({ ...result, unexpected: true }).success).toBe(
      false,
    );
    const formulaPass = evaluateInjectedRecoveryV1(1, 1);
    expect(
      ProductGateMetricResultV1Schema.safeParse({
        ...formulaPass,
        evidenceScope: 'authority-bound',
      }).success,
    ).toBe(false);
    const authorityBlocked = evaluateProductGateEndToEndMetricV1({
      corpusManifest: PRODUCT_GATE_BLOCKED_HOLDOUT_V1,
    });
    expect(
      ProductGateMetricResultV1Schema.safeParse({
        ...authorityBlocked,
        evidenceScope: 'formula-only',
      }).success,
    ).toBe(false);
  });

  it('returns inconclusive invalid-denominator decisions for bounded overfull projections', () => {
    const nineteen = Array.from({ length: 19 }, (_, index) => `case-${String(index + 1)}`);
    const results = [
      calculateUsefulLayerSuccessFormulaV1({
        cases: nineteen.map((caseId, index) => ({
          caseId,
          primaryStratum: `stratum-${String(Math.floor(index / 2) + 1)}`,
          useful: true,
        })),
      }),
      calculateProductGateEndToEndFormulaV1({
        cases: nineteen.map((caseId) => ({
          caseId,
          allSevenRequirementsSatisfied: true,
        })),
      }),
      evaluateSuccessfulRunLatencyV1({
        successfulRuns: nineteen.map((caseId) => ({ caseId, durationMs: 1 })),
        evidenceComplete: true,
      }),
      evaluateAllCaseTerminalLatencyV1({
        terminalCases: nineteen.map((caseId) => ({ caseId, durationMs: 1 })),
        evidenceComplete: true,
      }),
      evaluateCostPerSuccessV1({
        attempts: nineteen.map((caseId, index) => ({
          attemptId: `attempt-${String(index + 1)}`,
          caseId,
          terminalStatus: 'succeeded',
          actualCostMicros: '0',
          estimatedCostMicros: null,
          reservedCostMicros: '0',
        })),
        endToEndSuccessCaseIds: nineteen,
        evidenceComplete: true,
      }),
      calculateAuthoritativeExportFormulaV1({
        cases: nineteen.map((caseId) => ({ caseId, firstPass: true, finalPass: true })),
      }),
      evaluateMajorInterventionRateV1({
        cases: nineteen.map((caseId) => ({ caseId, correctionClass: 'none' })),
      }),
      evaluateComponentRepeatReproducibilityV1({
        cases: nineteen.slice(0, 7).map((caseId) => ({
          caseId,
          predesignated: true,
          backgroundStrategy: 'reconstruction',
          sameClassification: true,
          sameCriticalCoverage: true,
        })),
      }),
    ];
    expect(results).toHaveLength(8);
    for (const result of results) {
      expect(result).toMatchObject({
        decision: 'inconclusive',
        reason: 'invalid-denominator',
      });
    }
  });
});
