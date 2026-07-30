import { z } from 'zod';

import { CanonicalMicrosStringSchema, parseMicros } from '../jobs/cost-budget.js';
import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import {
  PRODUCT_GATE_BLOCKED_HOLDOUT_V1,
  PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
  ProductGateCorpusManifestV1Schema,
} from './product-gate-corpus-v1.js';
import { ProductGateEvaluationStageV1Schema } from './product-gate-segmentation-v1.js';
import { ProductGateCorrectionClassV1Schema } from './product-gate-scorecards-v1.js';

export const ProductGateMetricIdV1Schema = z.enum([
  'useful-layer-success',
  'product-gate-e2e',
  'successful-run-latency',
  'all-case-terminal-latency',
  'cost-per-success',
  'first-attempt-step-failure',
  'final-step-failure',
  'authoritative-export',
  'manual-correction-rate',
  'major-intervention-rate',
  'injected-recovery',
  'observed-real-recovery',
  'replay-reproducibility',
  'component-repeat-reproducibility',
]);

const decisionSchema = z.enum(['pass', 'fail', 'inconclusive', 'not-measurable']);
const reasonSchema = z.enum([
  'target-met',
  'target-not-met',
  'authority-blocked',
  'development-corpus-not-product-gate-evidence',
  'incomplete-evidence',
  'invalid-denominator',
  'zero-successes',
  'minimum-events-not-met',
  'descriptive-measure-only',
]);

const observationNameSchema = z.enum([
  'useful-cases',
  'successful-strata',
  'all-seven-requirement-cases',
  'p50-ms',
  'p95-ms',
  'maximum-ms',
  'accounted-cost-micros',
  'cost-per-success-micros',
  'first-pass-exports',
  'final-exports',
  'counted-corrections',
  'major-interventions',
  'successful-events',
]);

const ProductGateMetricObservationV1Schema = z
  .strictObject({
    name: observationNameSchema,
    value: z.string().regex(/^(?:0|[1-9][0-9]*)$/u),
  })
  .readonly();

export const ProductGateMetricResultV1Schema = z
  .strictObject({
    metricVersion: z.literal(1),
    metricId: ProductGateMetricIdV1Schema,
    evidenceScope: z.enum(['formula-only', 'authority-bound']).default('formula-only'),
    stage: ProductGateEvaluationStageV1Schema.nullable().default(null),
    decision: decisionSchema,
    numerator: z.int().min(0).nullable(),
    denominator: z.int().min(0).nullable(),
    observations: z.array(ProductGateMetricObservationV1Schema).max(8).readonly(),
    threshold: z.string().min(1).max(240),
    reason: reasonSchema,
  })
  .superRefine((result, context) => {
    const names = result.observations.map((observation) => observation.name);
    if (
      new Set(names).size !== names.length ||
      names.some((name, index) => name !== [...names].toSorted()[index])
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Metric observations must be unique and sorted.',
      });
    }
    if (
      (result.decision === 'pass' && result.reason !== 'target-met') ||
      (result.decision === 'fail' && result.reason !== 'target-not-met') ||
      (result.decision === 'inconclusive' &&
        ![
          'incomplete-evidence',
          'invalid-denominator',
          'zero-successes',
          'minimum-events-not-met',
          'descriptive-measure-only',
        ].includes(result.reason)) ||
      (result.decision === 'not-measurable' &&
        !['authority-blocked', 'development-corpus-not-product-gate-evidence'].includes(
          result.reason,
        ))
    ) {
      context.addIssue({ code: 'custom', message: 'Metric decision and reason disagree.' });
    }
    const stepMetric = ['first-attempt-step-failure', 'final-step-failure'].includes(
      result.metricId,
    );
    if (stepMetric !== (result.stage !== null)) {
      context.addIssue({ code: 'custom', message: 'Per-step metrics require one stage identity.' });
    }
    if ((result.evidenceScope === 'authority-bound') !== (result.decision === 'not-measurable')) {
      context.addIssue({
        code: 'custom',
        message: 'Phase 3A authority-bound metrics must remain not-measurable.',
      });
    }
  })
  .readonly();

export type ProductGateMetricResultV1 = z.infer<typeof ProductGateMetricResultV1Schema>;

const metricResult = (input: z.input<typeof ProductGateMetricResultV1Schema>) =>
  ProductGateMetricResultV1Schema.parse({
    ...input,
    observations: [...input.observations].toSorted((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    ),
  });

const ratioAtLeast = (
  numerator: number,
  denominator: number,
  targetNumerator: number,
  targetDenominator: number,
): boolean =>
  BigInt(numerator) * BigInt(targetDenominator) >= BigInt(targetNumerator) * BigInt(denominator);

const ratioAtMost = (
  numerator: number,
  denominator: number,
  targetNumerator: number,
  targetDenominator: number,
): boolean =>
  BigInt(numerator) * BigInt(targetDenominator) <= BigInt(targetNumerator) * BigInt(denominator);

const currentCorpusBlockedDecision = (input: {
  readonly metricId: z.infer<typeof ProductGateMetricIdV1Schema>;
  readonly corpusManifest: unknown;
  readonly threshold: string;
}): ProductGateMetricResultV1 => {
  const corpus = ProductGateCorpusManifestV1Schema.parse(input.corpusManifest);
  if (canonicalizeJson(corpus) === canonicalizeJson(PRODUCT_GATE_DEVELOPMENT_CORPUS_V1)) {
    return metricResult({
      metricVersion: 1,
      metricId: input.metricId,
      evidenceScope: 'authority-bound',
      decision: 'not-measurable',
      numerator: null,
      denominator: null,
      observations: [],
      threshold: input.threshold,
      reason: 'development-corpus-not-product-gate-evidence',
    });
  }
  if (canonicalizeJson(corpus) === canonicalizeJson(PRODUCT_GATE_BLOCKED_HOLDOUT_V1)) {
    return metricResult({
      metricVersion: 1,
      metricId: input.metricId,
      evidenceScope: 'authority-bound',
      decision: 'not-measurable',
      numerator: null,
      denominator: null,
      observations: [],
      threshold: input.threshold,
      reason: 'authority-blocked',
    });
  }
  throw new TypeError('Unknown corpus authority projection is rejected.');
};

export const evaluateUsefulLayerSuccessV1 = (input: {
  readonly corpusManifest: unknown;
}): ProductGateMetricResultV1 =>
  currentCorpusBlockedDecision({
    metricId: 'useful-layer-success',
    corpusManifest: input.corpusManifest,
    threshold: 'at-least-15-of-18-and-at-least-one-success-in-each-two-case-primary-stratum',
  });

export const calculateUsefulLayerSuccessFormulaV1 = (input: {
  readonly cases: readonly {
    readonly caseId: string;
    readonly primaryStratum: string;
    readonly useful: boolean;
  }[];
}): ProductGateMetricResultV1 => {
  const threshold = 'at-least-15-of-18-and-at-least-one-success-in-each-two-case-primary-stratum';
  const cases = z
    .array(
      z
        .strictObject({
          caseId: z.string().min(1).max(80),
          primaryStratum: z.string().min(1).max(80),
          useful: z.boolean(),
        })
        .readonly(),
    )
    .max(10_000)
    .parse(input.cases);
  const groups = new Map<string, typeof cases>();
  for (const item of cases)
    groups.set(item.primaryStratum, [...(groups.get(item.primaryStratum) ?? []), item]);
  const valid =
    cases.length === 18 &&
    new Set(cases.map((item) => item.caseId)).size === 18 &&
    [...groups.values()].every((group) => group.length === 2);
  if (!valid) {
    return metricResult({
      metricVersion: 1,
      metricId: 'useful-layer-success',
      decision: 'inconclusive',
      numerator: cases.filter((item) => item.useful).length,
      denominator: cases.length,
      observations: [],
      threshold,
      reason: cases.length > 18 ? 'invalid-denominator' : 'incomplete-evidence',
    });
  }
  const successes = cases.filter((item) => item.useful).length;
  const successfulStrata = [...groups.values()].filter((group) =>
    group.some((item) => item.useful),
  ).length;
  const pass = successes >= 15 && successfulStrata === groups.size;
  return metricResult({
    metricVersion: 1,
    metricId: 'useful-layer-success',
    decision: pass ? 'pass' : 'fail',
    numerator: successes,
    denominator: 18,
    observations: [
      { name: 'useful-cases', value: String(successes) },
      { name: 'successful-strata', value: String(successfulStrata) },
    ],
    threshold,
    reason: pass ? 'target-met' : 'target-not-met',
  });
};

export const evaluateProductGateEndToEndMetricV1 = (input: {
  readonly corpusManifest: unknown;
}): ProductGateMetricResultV1 =>
  currentCorpusBlockedDecision({
    metricId: 'product-gate-e2e',
    corpusManifest: input.corpusManifest,
    threshold: 'at-least-14-of-18-with-all-seven-requirements',
  });

export const calculateProductGateEndToEndFormulaV1 = (input: {
  readonly cases: readonly {
    readonly caseId: string;
    readonly allSevenRequirementsSatisfied: boolean;
  }[];
}): ProductGateMetricResultV1 => {
  const threshold = 'at-least-14-of-18-with-all-seven-requirements';
  const cases = z
    .array(
      z
        .strictObject({
          caseId: z.string().min(1).max(80),
          allSevenRequirementsSatisfied: z.boolean(),
        })
        .readonly(),
    )
    .max(10_000)
    .parse(input.cases);
  if (cases.length !== 18 || new Set(cases.map((item) => item.caseId)).size !== 18) {
    return metricResult({
      metricVersion: 1,
      metricId: 'product-gate-e2e',
      decision: 'inconclusive',
      numerator: cases.filter((item) => item.allSevenRequirementsSatisfied).length,
      denominator: cases.length,
      observations: [],
      threshold,
      reason: cases.length > 18 ? 'invalid-denominator' : 'incomplete-evidence',
    });
  }
  const successes = cases.filter((item) => item.allSevenRequirementsSatisfied).length;
  const pass = successes >= 14;
  return metricResult({
    metricVersion: 1,
    metricId: 'product-gate-e2e',
    decision: pass ? 'pass' : 'fail',
    numerator: successes,
    denominator: 18,
    observations: [{ name: 'all-seven-requirement-cases', value: String(successes) }],
    threshold,
    reason: pass ? 'target-met' : 'target-not-met',
  });
};

export const nearestRankPercentileV1 = (
  values: readonly number[],
  percentile: number,
): number | null => {
  const parsedValues = z.array(z.int().min(0).max(Number.MAX_SAFE_INTEGER)).parse(values);
  const parsedPercentile = z.number().min(0).max(1).parse(percentile);
  if (parsedValues.length === 0 || parsedPercentile === 0) return null;
  const sorted = parsedValues.toSorted((left, right) => left - right);
  return sorted[Math.ceil(parsedPercentile * sorted.length) - 1] ?? null;
};

export const evaluateSuccessfulRunLatencyV1 = (input: {
  readonly successfulRuns: readonly { readonly caseId: string; readonly durationMs: number }[];
  readonly evidenceComplete: boolean;
}): ProductGateMetricResultV1 => {
  const successfulRuns = z
    .array(
      z
        .strictObject({
          caseId: z.string().min(1).max(80),
          durationMs: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
        })
        .readonly(),
    )
    .max(10_000)
    .parse(input.successfulRuns);
  const values = successfulRuns.map((run) => run.durationMs);
  const p50 = nearestRankPercentileV1(values, 0.5);
  const p95 = nearestRankPercentileV1(values, 0.95);
  const threshold = 'nearest-rank-p50-at-most-240000ms-and-p95-at-most-420000ms';
  const invalidDenominator =
    successfulRuns.length > 18 ||
    new Set(successfulRuns.map((run) => run.caseId)).size !== successfulRuns.length;
  if (!input.evidenceComplete || p50 === null || p95 === null || invalidDenominator) {
    return metricResult({
      metricVersion: 1,
      metricId: 'successful-run-latency',
      decision: 'inconclusive',
      numerator: null,
      denominator: values.length,
      observations: [],
      threshold,
      reason: invalidDenominator ? 'invalid-denominator' : 'incomplete-evidence',
    });
  }
  const pass = p50 <= 240_000 && p95 <= 420_000;
  return metricResult({
    metricVersion: 1,
    metricId: 'successful-run-latency',
    decision: pass ? 'pass' : 'fail',
    numerator: null,
    denominator: values.length,
    observations: [
      { name: 'p50-ms', value: String(p50) },
      { name: 'p95-ms', value: String(p95) },
    ],
    threshold,
    reason: pass ? 'target-met' : 'target-not-met',
  });
};

export const evaluateAllCaseTerminalLatencyV1 = (input: {
  readonly terminalCases: readonly { readonly caseId: string; readonly durationMs: number }[];
  readonly evidenceComplete: boolean;
}): ProductGateMetricResultV1 => {
  const terminalCases = z
    .array(
      z
        .strictObject({
          caseId: z.string().min(1).max(80),
          durationMs: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
        })
        .readonly(),
    )
    .max(10_000)
    .parse(input.terminalCases);
  const values = terminalCases.map((item) => item.durationMs);
  const threshold = 'maximum-at-most-600000ms';
  if (
    !input.evidenceComplete ||
    values.length !== 18 ||
    new Set(terminalCases.map((item) => item.caseId)).size !== 18
  ) {
    return metricResult({
      metricVersion: 1,
      metricId: 'all-case-terminal-latency',
      decision: 'inconclusive',
      numerator: null,
      denominator: values.length,
      observations: [],
      threshold,
      reason: values.length > 18 ? 'invalid-denominator' : 'incomplete-evidence',
    });
  }
  const maximum = Math.max(...values);
  const pass = maximum <= 600_000;
  return metricResult({
    metricVersion: 1,
    metricId: 'all-case-terminal-latency',
    decision: pass ? 'pass' : 'fail',
    numerator: null,
    denominator: values.length,
    observations: [{ name: 'maximum-ms', value: String(maximum) }],
    threshold,
    reason: pass ? 'target-met' : 'target-not-met',
  });
};

const MetricCostAttemptV1Schema = z
  .strictObject({
    attemptId: z.string().min(1).max(160),
    caseId: z.string().min(1).max(80),
    terminalStatus: z.enum(['succeeded', 'failed', 'indeterminate']),
    actualCostMicros: CanonicalMicrosStringSchema.nullable(),
    estimatedCostMicros: CanonicalMicrosStringSchema.nullable(),
    reservedCostMicros: CanonicalMicrosStringSchema,
  })
  .readonly();

export const evaluateCostPerSuccessV1 = (input: {
  readonly attempts: readonly unknown[];
  readonly endToEndSuccessCaseIds: readonly string[];
  readonly evidenceComplete: boolean;
}): ProductGateMetricResultV1 => {
  const attempts = z.array(MetricCostAttemptV1Schema).max(10_000).parse(input.attempts);
  const successCaseIds = z
    .array(z.string().min(1).max(80))
    .max(10_000)
    .parse(input.endToEndSuccessCaseIds);
  const successes = successCaseIds.length;
  const total = attempts.reduce(
    (sum, attempt) =>
      sum +
      parseMicros(
        attempt.actualCostMicros ?? attempt.estimatedCostMicros ?? attempt.reservedCostMicros,
      ),
    0n,
  );
  const threshold = 'all-attempt-cost-per-e2e-success-at-most-350000-micro-usd';
  const identitiesValid =
    successCaseIds.length <= 18 &&
    new Set(attempts.map((attempt) => attempt.attemptId)).size === attempts.length &&
    new Set(successCaseIds).size === successCaseIds.length &&
    successCaseIds.every((caseId) => attempts.some((attempt) => attempt.caseId === caseId));
  if (!input.evidenceComplete || !identitiesValid) {
    return metricResult({
      metricVersion: 1,
      metricId: 'cost-per-success',
      decision: 'inconclusive',
      numerator: null,
      denominator: successes,
      observations: [{ name: 'accounted-cost-micros', value: total.toString() }],
      threshold,
      reason: successCaseIds.length > 18 ? 'invalid-denominator' : 'incomplete-evidence',
    });
  }
  if (successes === 0) {
    return metricResult({
      metricVersion: 1,
      metricId: 'cost-per-success',
      decision: 'inconclusive',
      numerator: null,
      denominator: 0,
      observations: [{ name: 'accounted-cost-micros', value: total.toString() }],
      threshold,
      reason: 'zero-successes',
    });
  }
  const costPerSuccess = total / BigInt(successes);
  const pass = total <= 350_000n * BigInt(successes);
  return metricResult({
    metricVersion: 1,
    metricId: 'cost-per-success',
    decision: pass ? 'pass' : 'fail',
    numerator: null,
    denominator: successes,
    observations: [
      { name: 'accounted-cost-micros', value: total.toString() },
      { name: 'cost-per-success-micros', value: costPerSuccess.toString() },
    ],
    threshold,
    reason: pass ? 'target-met' : 'target-not-met',
  });
};

export const evaluateStepFailureRateV1 = (input: {
  readonly kind: 'first-attempt' | 'final';
  readonly stage: unknown;
  readonly cases: readonly unknown[];
}): ProductGateMetricResultV1 => {
  const stage = ProductGateEvaluationStageV1Schema.parse(input.stage);
  const cases = z
    .array(
      z
        .strictObject({
          caseId: z.string().min(1).max(80),
          firstAttemptFailed: z.boolean(),
          terminalFailed: z.boolean(),
        })
        .readonly(),
    )
    .max(10_000)
    .parse(input.cases);
  const reached = cases.length;
  const final = input.kind === 'final';
  const failures = cases.filter((item) =>
    final ? item.terminalFailed : item.firstAttemptFailed,
  ).length;
  const metricId = final ? 'final-step-failure' : 'first-attempt-step-failure';
  const threshold = final ? 'at-most-10-percent-per-step' : 'descriptive-first-attempt-rate';
  if (reached === 0 || new Set(cases.map((item) => item.caseId)).size !== reached) {
    return metricResult({
      metricVersion: 1,
      metricId,
      stage,
      decision: 'inconclusive',
      numerator: failures,
      denominator: reached,
      observations: [],
      threshold,
      reason: 'invalid-denominator',
    });
  }
  if (!final) {
    return metricResult({
      metricVersion: 1,
      metricId,
      stage,
      decision: 'inconclusive',
      numerator: failures,
      denominator: reached,
      observations: [],
      threshold,
      reason: 'descriptive-measure-only',
    });
  }
  const pass = ratioAtMost(failures, reached, 1, 10);
  return metricResult({
    metricVersion: 1,
    metricId,
    stage,
    decision: pass ? 'pass' : 'fail',
    numerator: failures,
    denominator: reached,
    observations: [],
    threshold,
    reason: pass ? 'target-met' : 'target-not-met',
  });
};

export const evaluateAuthoritativeExportV1 = (input: {
  readonly corpusManifest: unknown;
}): ProductGateMetricResultV1 =>
  currentCorpusBlockedDecision({
    metricId: 'authoritative-export',
    corpusManifest: input.corpusManifest,
    threshold: 'first-pass-at-least-17-of-18-and-final-18-of-18',
  });

export const calculateAuthoritativeExportFormulaV1 = (input: {
  readonly cases: readonly {
    readonly caseId: string;
    readonly firstPass: boolean;
    readonly finalPass: boolean;
  }[];
}): ProductGateMetricResultV1 => {
  const threshold = 'first-pass-at-least-17-of-18-and-final-18-of-18';
  const cases = z
    .array(
      z
        .strictObject({
          caseId: z.string().min(1).max(80),
          firstPass: z.boolean(),
          finalPass: z.boolean(),
        })
        .readonly(),
    )
    .max(10_000)
    .parse(input.cases);
  const first = cases.filter((item) => item.firstPass).length;
  const final = cases.filter((item) => item.finalPass).length;
  if (cases.length !== 18 || new Set(cases.map((item) => item.caseId)).size !== 18) {
    return metricResult({
      metricVersion: 1,
      metricId: 'authoritative-export',
      decision: 'inconclusive',
      numerator: final,
      denominator: cases.length,
      observations: [],
      threshold,
      reason: cases.length > 18 ? 'invalid-denominator' : 'incomplete-evidence',
    });
  }
  const pass = first >= 17 && final === 18;
  return metricResult({
    metricVersion: 1,
    metricId: 'authoritative-export',
    decision: pass ? 'pass' : 'fail',
    numerator: final,
    denominator: 18,
    observations: [
      { name: 'first-pass-exports', value: String(first) },
      { name: 'final-exports', value: String(final) },
    ],
    threshold,
    reason: pass ? 'target-met' : 'target-not-met',
  });
};

export const evaluateManualCorrectionRateV1 = (input: {
  readonly decompositions: readonly unknown[];
}): ProductGateMetricResultV1 => {
  const decompositions = z
    .array(
      z
        .strictObject({
          decompositionId: z.string().min(1).max(160),
          correctionClass: ProductGateCorrectionClassV1Schema.refine(
            (correctionClass) => correctionClass !== 'complete-decomposition-failure',
            'A complete decomposition failure is not a decomposition produced.',
          ),
        })
        .readonly(),
    )
    .max(10_000)
    .parse(input.decompositions);
  const denominator = decompositions.length;
  const counted = decompositions.filter(({ correctionClass }) =>
    [
      'rename-only',
      'required-include-exclude-default-correction',
      'reordering',
      'combining-fragments',
      'minor-mask-correction',
      'major-mask-correction',
      'background-replacement',
    ].includes(correctionClass),
  ).length;
  const threshold = 'classes-1-through-7-at-most-30-percent-of-decompositions-produced';
  if (
    denominator === 0 ||
    new Set(decompositions.map((item) => item.decompositionId)).size !== denominator
  ) {
    return metricResult({
      metricVersion: 1,
      metricId: 'manual-correction-rate',
      decision: 'inconclusive',
      numerator: counted,
      denominator,
      observations: [],
      threshold,
      reason: 'invalid-denominator',
    });
  }
  const pass = ratioAtMost(counted, denominator, 3, 10);
  return metricResult({
    metricVersion: 1,
    metricId: 'manual-correction-rate',
    decision: pass ? 'pass' : 'fail',
    numerator: counted,
    denominator,
    observations: [{ name: 'counted-corrections', value: String(counted) }],
    threshold,
    reason: pass ? 'target-met' : 'target-not-met',
  });
};

export const evaluateMajorInterventionRateV1 = (input: {
  readonly cases: readonly unknown[];
}): ProductGateMetricResultV1 => {
  const cases = z
    .array(
      z
        .strictObject({
          caseId: z.string().min(1).max(80),
          correctionClass: ProductGateCorrectionClassV1Schema,
        })
        .readonly(),
    )
    .max(10_000)
    .parse(input.cases);
  const denominator = cases.length;
  const major = cases.filter(({ correctionClass }) =>
    ['major-mask-correction', 'background-replacement', 'complete-decomposition-failure'].includes(
      correctionClass,
    ),
  ).length;
  const threshold = 'major-mask-background-replacement-or-complete-failure-at-most-10-percent';
  if (denominator !== 18 || new Set(cases.map((item) => item.caseId)).size !== 18) {
    return metricResult({
      metricVersion: 1,
      metricId: 'major-intervention-rate',
      decision: 'inconclusive',
      numerator: major,
      denominator,
      observations: [],
      threshold,
      reason: 'invalid-denominator',
    });
  }
  const pass = ratioAtMost(major, denominator, 1, 10);
  return metricResult({
    metricVersion: 1,
    metricId: 'major-intervention-rate',
    decision: pass ? 'pass' : 'fail',
    numerator: major,
    denominator,
    observations: [{ name: 'major-interventions', value: String(major) }],
    threshold,
    reason: pass ? 'target-met' : 'target-not-met',
  });
};

const evaluateRecoveryRatio = (input: {
  readonly metricId:
    | 'injected-recovery'
    | 'observed-real-recovery'
    | 'replay-reproducibility'
    | 'component-repeat-reproducibility';
  readonly successes: number;
  readonly eligible: number;
}): ProductGateMetricResultV1 => {
  const successes = z.int().min(0).max(10_000).parse(input.successes);
  const eligible = z.int().min(0).max(10_000).parse(input.eligible);
  const thresholdByMetric = {
    'injected-recovery': '100-percent',
    'observed-real-recovery': 'at-least-90-percent-with-at-least-10-events',
    'replay-reproducibility': '100-percent',
    'component-repeat-reproducibility': 'at-least-5-of-6-predesignated-non-inpainting-cases',
  } as const;
  const threshold = thresholdByMetric[input.metricId];
  if (eligible === 0 || successes > eligible) {
    return metricResult({
      metricVersion: 1,
      metricId: input.metricId,
      decision: 'inconclusive',
      numerator: successes,
      denominator: eligible,
      observations: [],
      threshold,
      reason: 'invalid-denominator',
    });
  }
  if (input.metricId === 'observed-real-recovery' && eligible < 10) {
    return metricResult({
      metricVersion: 1,
      metricId: input.metricId,
      decision: 'inconclusive',
      numerator: successes,
      denominator: eligible,
      observations: [{ name: 'successful-events', value: String(successes) }],
      threshold,
      reason: 'minimum-events-not-met',
    });
  }
  if (input.metricId === 'component-repeat-reproducibility' && eligible !== 6) {
    return metricResult({
      metricVersion: 1,
      metricId: input.metricId,
      decision: 'inconclusive',
      numerator: successes,
      denominator: eligible,
      observations: [],
      threshold,
      reason: 'incomplete-evidence',
    });
  }
  const pass =
    input.metricId === 'observed-real-recovery'
      ? ratioAtLeast(successes, eligible, 9, 10)
      : input.metricId === 'component-repeat-reproducibility'
        ? successes >= 5
        : successes === eligible;
  return metricResult({
    metricVersion: 1,
    metricId: input.metricId,
    decision: pass ? 'pass' : 'fail',
    numerator: successes,
    denominator: eligible,
    observations: [{ name: 'successful-events', value: String(successes) }],
    threshold,
    reason: pass ? 'target-met' : 'target-not-met',
  });
};

export const evaluateInjectedRecoveryV1 = (successes: number, eligible: number) =>
  evaluateRecoveryRatio({ metricId: 'injected-recovery', successes, eligible });

export const evaluateObservedRealRecoveryV1 = (successes: number, eligible: number) =>
  evaluateRecoveryRatio({ metricId: 'observed-real-recovery', successes, eligible });

export const evaluateReplayReproducibilityV1 = (successes: number, eligible: number) =>
  evaluateRecoveryRatio({ metricId: 'replay-reproducibility', successes, eligible });

export const evaluateComponentRepeatReproducibilityV1 = (input: {
  readonly cases: readonly {
    readonly caseId: string;
    readonly predesignated: boolean;
    readonly backgroundStrategy: 'deterministic-solid-fallback' | 'reconstruction';
    readonly sameClassification: boolean;
    readonly sameCriticalCoverage: boolean;
  }[];
}): ProductGateMetricResultV1 => {
  const cases = z
    .array(
      z
        .strictObject({
          caseId: z.string().min(1).max(80),
          predesignated: z.boolean(),
          backgroundStrategy: z.enum(['deterministic-solid-fallback', 'reconstruction']),
          sameClassification: z.boolean(),
          sameCriticalCoverage: z.boolean(),
        })
        .readonly(),
    )
    .max(10_000)
    .parse(input.cases);
  const valid =
    cases.length === 6 &&
    new Set(cases.map((item) => item.caseId)).size === 6 &&
    cases.every((item) => item.predesignated);
  if (!valid) {
    return metricResult({
      metricVersion: 1,
      metricId: 'component-repeat-reproducibility',
      decision: 'inconclusive',
      numerator: cases.filter((item) => item.sameClassification && item.sameCriticalCoverage)
        .length,
      denominator: cases.length,
      observations: [],
      threshold: 'at-least-5-of-6-predesignated-non-inpainting-cases',
      reason: cases.length > 6 ? 'invalid-denominator' : 'incomplete-evidence',
    });
  }
  return evaluateRecoveryRatio({
    metricId: 'component-repeat-reproducibility',
    successes: cases.filter((item) => item.sameClassification && item.sameCriticalCoverage).length,
    eligible: cases.length,
  });
};
