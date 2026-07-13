import { z } from 'zod';

import { OutputKeySchema } from '../jobs/syntax.js';
import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import { BenchmarkCostBreakdownV1Schema } from './cost-estimator.js';
import {
  SceneAnalysisModelInvocationV1Schema,
  StructuredSceneAnalysisOutputV1Schema,
  validateSceneAnalysisInvocationForRequestV1,
  type LayerProposalV1,
  type SceneAnalysisModelInvocationV1,
  type SceneAnalysisModelRequestV1,
} from './ai-contracts.js';
import {
  BannerAiBenchmarkCaseV1Schema,
  BenchmarkCaseIdSchema,
  BenchmarkQualityReviewFlagSchema,
  benchmarkCaseSceneAnalysisRequestV1,
  type BannerAiBenchmarkCaseV1,
} from './benchmark-case.js';

const OutputSchemaStatusSchema = z.enum(['valid', 'invalid', 'not-returned', 'not-checked']);

export const BenchmarkInvocationValidityV1Schema = z
  .strictObject({
    structural: z.boolean(),
    contextual: z.boolean(),
    structuredOutput: OutputSchemaStatusSchema,
  })
  .readonly();

const LayerRoleMismatchV1Schema = z
  .strictObject({
    partKey: OutputKeySchema,
    expectedRole: z.enum(['background', 'subject', 'foreground', 'decoration', 'text', 'other']),
    actualRole: z.enum(['background', 'subject', 'foreground', 'decoration', 'text', 'other']),
  })
  .readonly();

export const BenchmarkLayerAgreementV1Schema = z
  .strictObject({
    expectedCount: z.int().min(0).max(5),
    actualCount: z.int().min(0).max(5).nullable(),
    countMatches: z.boolean(),
    roleAgreement: z.boolean(),
    rubricAgreement: z.boolean(),
    missingLayerKeys: z.array(OutputKeySchema).max(5).readonly(),
    extraLayerKeys: z.array(OutputKeySchema).max(5).readonly(),
    roleMismatches: z.array(LayerRoleMismatchV1Schema).max(5).readonly(),
    hasMissingLayers: z.boolean(),
    hasExtraLayers: z.boolean(),
  })
  .superRefine((agreement, context) => {
    if (
      agreement.hasMissingLayers !== agreement.missingLayerKeys.length > 0 ||
      agreement.hasExtraLayers !== agreement.extraLayerKeys.length > 0
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Layer presence flags must equal their missing and extra key lists.',
      });
    }
  })
  .readonly();

export const BenchmarkTextPreservationStatusSchema = z.enum([
  'preserved',
  'missing',
  'changed',
  'not-applicable',
  'unexpected-text',
  'not-evaluated',
]);

export const BenchmarkCostObservationV1Schema = z
  .strictObject({
    estimated: BenchmarkCostBreakdownV1Schema,
    actual: BenchmarkCostBreakdownV1Schema,
    totalsMatch: z.boolean(),
  })
  .superRefine((observation, context) => {
    const exactMatch = observation.estimated.total.micros === observation.actual.total.micros;
    if (exactMatch !== observation.totalsMatch) {
      context.addIssue({
        code: 'custom',
        message: 'Estimated/actual cost equality must use exact canonical micros.',
        path: ['totalsMatch'],
      });
    }
  })
  .readonly();

export const BannerAiBenchmarkEvaluationV1Schema = z
  .strictObject({
    evaluationVersion: z.literal(1),
    caseId: BenchmarkCaseIdSchema,
    classification: z.enum([
      'pass',
      'schema-invalid',
      'malformed-output',
      'timeout',
      'not-reproducible',
      'quality-failed',
    ]),
    schemaValidity: z
      .strictObject({
        primary: BenchmarkInvocationValidityV1Schema,
        reproducibility: BenchmarkInvocationValidityV1Schema,
      })
      .readonly(),
    layerAgreement: BenchmarkLayerAgreementV1Schema,
    textPreservation: BenchmarkTextPreservationStatusSchema,
    deterministicReproducibility: z.boolean(),
    cost: BenchmarkCostObservationV1Schema.nullable(),
    latencyMs: z.int().min(0).max(600_000).nullable(),
    retryCount: z.int().min(0).max(9).nullable(),
    qualityReviewFlags: z
      .array(BenchmarkQualityReviewFlagSchema)
      .max(BenchmarkQualityReviewFlagSchema.options.length)
      .readonly(),
    pass: z.boolean(),
  })
  .superRefine((evaluation, context) => {
    if (evaluation.pass !== (evaluation.classification === 'pass')) {
      context.addIssue({
        code: 'custom',
        message: 'Benchmark pass boolean must match the pass classification.',
        path: ['pass'],
      });
    }
  })
  .readonly();

export type BannerAiBenchmarkEvaluationV1 = z.infer<typeof BannerAiBenchmarkEvaluationV1Schema>;

type InspectedInvocation = {
  readonly validity: z.infer<typeof BenchmarkInvocationValidityV1Schema>;
  readonly invocation: SceneAnalysisModelInvocationV1 | null;
};

const inspectInvocation = (
  request: SceneAnalysisModelRequestV1,
  input: unknown,
): InspectedInvocation => {
  const structural = SceneAnalysisModelInvocationV1Schema.safeParse(input);
  if (!structural.success) {
    return {
      validity: BenchmarkInvocationValidityV1Schema.parse({
        structural: false,
        contextual: false,
        structuredOutput: 'not-checked',
      }),
      invocation: null,
    };
  }
  let invocation: SceneAnalysisModelInvocationV1;
  try {
    invocation = validateSceneAnalysisInvocationForRequestV1({
      request,
      invocation: structural.data,
    });
  } catch {
    return {
      validity: BenchmarkInvocationValidityV1Schema.parse({
        structural: true,
        contextual: false,
        structuredOutput: 'not-checked',
      }),
      invocation: null,
    };
  }
  const structuredOutput =
    invocation.kind === 'success'
      ? 'valid'
      : invocation.kind === 'malformed-output'
        ? StructuredSceneAnalysisOutputV1Schema.safeParse(invocation.rawOutput).success
          ? 'valid'
          : 'invalid'
        : 'not-returned';
  return {
    validity: BenchmarkInvocationValidityV1Schema.parse({
      structural: true,
      contextual: true,
      structuredOutput,
    }),
    invocation,
  };
};

const actualParts = (
  invocation: SceneAnalysisModelInvocationV1 | null,
): readonly LayerProposalV1[] => {
  if (
    invocation === null ||
    invocation.kind !== 'success' ||
    invocation.output.kind !== 'composition_proposal'
  ) {
    return [];
  }
  return invocation.output.parts;
};

const evaluateLayers = (
  benchmark: BannerAiBenchmarkCaseV1,
  invocation: SceneAnalysisModelInvocationV1 | null,
) => {
  const outputAvailable =
    invocation !== null &&
    invocation.kind === 'success' &&
    invocation.output.kind === 'composition_proposal';
  const parts = actualParts(invocation);
  const expectedByKey = new Map(
    benchmark.expectedLayers.map((layer) => [layer.proposal.partKey, layer.proposal]),
  );
  const actualByKey = new Map(parts.map((part) => [part.partKey, part]));
  const missingLayerKeys = [...expectedByKey.keys()].filter((key) => !actualByKey.has(key));
  const extraLayerKeys = [...actualByKey.keys()].filter((key) => !expectedByKey.has(key));
  const roleMismatches = [...expectedByKey.entries()].flatMap(([partKey, expected]) => {
    const actual = actualByKey.get(partKey);
    return actual !== undefined && actual.role !== expected.role
      ? [{ partKey, expectedRole: expected.role, actualRole: actual.role }]
      : [];
  });
  const rubricAgreement =
    outputAvailable &&
    missingLayerKeys.length === 0 &&
    extraLayerKeys.length === 0 &&
    [...expectedByKey.entries()].every(
      ([partKey, expected]) =>
        canonicalizeJson(actualByKey.get(partKey)) === canonicalizeJson(expected),
    );
  return BenchmarkLayerAgreementV1Schema.parse({
    expectedCount: benchmark.expectedLayers.length,
    actualCount: outputAvailable ? parts.length : null,
    countMatches: outputAvailable && parts.length === benchmark.expectedLayers.length,
    roleAgreement: outputAvailable && missingLayerKeys.length === 0 && roleMismatches.length === 0,
    rubricAgreement,
    missingLayerKeys,
    extraLayerKeys,
    roleMismatches,
    hasMissingLayers: missingLayerKeys.length > 0,
    hasExtraLayers: extraLayerKeys.length > 0,
  });
};

const evaluateTextPreservation = (
  benchmark: BannerAiBenchmarkCaseV1,
  invocation: SceneAnalysisModelInvocationV1 | null,
): z.infer<typeof BenchmarkTextPreservationStatusSchema> => {
  if (
    invocation === null ||
    invocation.kind !== 'success' ||
    invocation.output.kind !== 'composition_proposal'
  ) {
    return 'not-evaluated';
  }
  const actualText = invocation.output.parts
    .filter((part) => part.role === 'text')
    .map((part) => part.label);
  if (benchmark.textPreservation.kind === 'no-text-present') {
    return actualText.length === 0 ? 'not-applicable' : 'unexpected-text';
  }
  if (actualText.length === 0) return 'missing';
  return canonicalizeJson(actualText) === canonicalizeJson(benchmark.textPreservation.expectedText)
    ? 'preserved'
    : 'changed';
};

const reproducibilityValue = (invocation: SceneAnalysisModelInvocationV1): unknown => {
  if (invocation.kind === 'success') return invocation.output;
  if (invocation.kind === 'malformed-output') return invocation.rawOutput;
  return invocation.timeout;
};

const isTextStatusPassing = (
  status: z.infer<typeof BenchmarkTextPreservationStatusSchema>,
): boolean => status === 'preserved' || status === 'not-applicable';

export const evaluateBannerAiBenchmarkCaseV1 = (input: {
  readonly benchmarkCase: unknown;
  readonly primaryInvocation: unknown;
  readonly reproducibilityInvocation: unknown;
}): BannerAiBenchmarkEvaluationV1 => {
  const benchmark = BannerAiBenchmarkCaseV1Schema.parse(input.benchmarkCase);
  const request = benchmarkCaseSceneAnalysisRequestV1(benchmark);
  const primary = inspectInvocation(request, input.primaryInvocation);
  const reproducibility = inspectInvocation(request, input.reproducibilityInvocation);
  const deterministicReproducibility =
    primary.invocation !== null &&
    reproducibility.invocation !== null &&
    primary.invocation.kind === reproducibility.invocation.kind &&
    canonicalizeJson(reproducibilityValue(primary.invocation)) ===
      canonicalizeJson(reproducibilityValue(reproducibility.invocation));
  const layerAgreement = evaluateLayers(benchmark, primary.invocation);
  const textPreservation = evaluateTextPreservation(benchmark, primary.invocation);
  const metadata = primary.invocation?.metadata;
  const cost =
    metadata === undefined
      ? null
      : BenchmarkCostObservationV1Schema.parse({
          estimated: metadata.cost.estimated,
          actual: metadata.cost.actual,
          totalsMatch: metadata.cost.estimated.total.micros === metadata.cost.actual.total.micros,
        });

  let classification: z.infer<typeof BannerAiBenchmarkEvaluationV1Schema>['classification'];
  if (!primary.validity.structural || !primary.validity.contextual) {
    classification = 'schema-invalid';
  } else if (primary.invocation?.kind === 'malformed-output') {
    classification = 'malformed-output';
  } else if (primary.invocation?.kind === 'timeout') {
    classification = 'timeout';
  } else if (
    !reproducibility.validity.structural ||
    !reproducibility.validity.contextual ||
    reproducibility.invocation?.kind !== 'success' ||
    !deterministicReproducibility
  ) {
    classification = 'not-reproducible';
  } else if (
    !layerAgreement.countMatches ||
    !layerAgreement.roleAgreement ||
    !layerAgreement.rubricAgreement ||
    !isTextStatusPassing(textPreservation)
  ) {
    classification = 'quality-failed';
  } else {
    classification = 'pass';
  }

  return BannerAiBenchmarkEvaluationV1Schema.parse({
    evaluationVersion: 1,
    caseId: benchmark.caseId,
    classification,
    schemaValidity: {
      primary: primary.validity,
      reproducibility: reproducibility.validity,
    },
    layerAgreement,
    textPreservation,
    deterministicReproducibility,
    cost,
    latencyMs: metadata?.latency.total ?? null,
    retryCount: metadata?.retry.retryCount ?? null,
    qualityReviewFlags: benchmark.qualityReviewFlags,
    pass: classification === 'pass',
  });
};
