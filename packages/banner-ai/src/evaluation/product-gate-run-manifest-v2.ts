import { z } from 'zod';

import {
  CanonicalMicrosStringSchema,
  MAX_AGGREGATE_COST_MICROS,
  MAX_COST_MICROS,
  formatMicros,
  parseMicros,
} from '../jobs/cost-budget.js';
import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import { ProductGateCaseIdV2Schema } from './product-gate-corpus-v2.js';
import { ProductGateEvaluationStageV1Schema } from './product-gate-segmentation-v1.js';

export const PRODUCT_GATE_SCORED_COST_TARGET_MICROS_V2 = '350000' as const;
export const PRODUCT_GATE_OUTER_EXECUTION_KILL_SWITCH_MICROS_V2 = '13100000' as const;

const canonicalUnsignedDecimalPattern = /^(?:0|[1-9][0-9]*)$/u;

export const ProductGateAggregateMicrosStringV2Schema = z
  .string()
  .max(18)
  .regex(canonicalUnsignedDecimalPattern)
  .superRefine((value, context) => {
    if (
      value.length <= 18 &&
      canonicalUnsignedDecimalPattern.test(value) &&
      BigInt(value) > MAX_AGGREGATE_COST_MICROS + MAX_COST_MICROS
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Aggregate micros value exceeds the checked aggregate bound.',
      });
    }
  })
  .brand<'ProductGateAggregateMicrosStringV2'>();

export type ProductGateAggregateMicrosStringV2 = z.infer<
  typeof ProductGateAggregateMicrosStringV2Schema
>;

const formatAggregateMicros = (value: bigint): ProductGateAggregateMicrosStringV2 => {
  if (value < 0n || value > MAX_AGGREGATE_COST_MICROS + MAX_COST_MICROS) {
    throw new RangeError('Aggregate micros bigint is outside the checked aggregate bound.');
  }
  return ProductGateAggregateMicrosStringV2Schema.parse(value.toString(10));
};

const canonicalDigest = (input: unknown): string =>
  sha256Hex(Buffer.from(canonicalizeJson(input), 'utf8'));

export const ProductGateAttemptIdV2Schema = z
  .string()
  .regex(/^pge_attempt_v2_[0-9a-f]{64}$/u)
  .brand<'ProductGateAttemptIdV2'>();

export const ProductGateLogicalOperationIdV2Schema = z
  .string()
  .regex(/^pge_logical_operation_v2_[0-9a-f]{64}$/u)
  .brand<'ProductGateLogicalOperationIdV2'>();

export const ProductGateRunIdV2Schema = z
  .string()
  .regex(/^pge_run_v2_[0-9a-f]{64}$/u)
  .brand<'ProductGateRunIdV2'>();

const ProductGateRunIdentityCoreV2Schema = z.strictObject({
  runVersion: z.literal(2),
  runManifestSha256: Sha256HexSchema,
});

export const createProductGateRunIdV2 = (input: unknown) => {
  const core = ProductGateRunIdentityCoreV2Schema.parse(input);
  return ProductGateRunIdV2Schema.parse(`pge_run_v2_${canonicalDigest(core)}`);
};

const ProductGateLogicalOperationCoreV2Schema = z.strictObject({
  operationVersion: z.literal(2),
  runId: ProductGateRunIdV2Schema,
  caseId: ProductGateCaseIdV2Schema,
  stage: ProductGateEvaluationStageV1Schema,
});

export const createProductGateLogicalOperationIdV2 = (input: unknown) => {
  const core = ProductGateLogicalOperationCoreV2Schema.parse(input);
  return ProductGateLogicalOperationIdV2Schema.parse(
    `pge_logical_operation_v2_${canonicalDigest(core)}`,
  );
};

const ProductGateAttemptIdentityCoreV2Schema = z.strictObject({
  attemptVersion: z.literal(2),
  logicalOperationId: ProductGateLogicalOperationIdV2Schema,
  attemptOrdinal: z.literal(0),
  retryCount: z.literal(0),
});

export const createProductGateAttemptIdV2 = (input: unknown) => {
  const core = ProductGateAttemptIdentityCoreV2Schema.parse(input);
  return ProductGateAttemptIdV2Schema.parse(`pge_attempt_v2_${canonicalDigest(core)}`);
};

export const ProductGateExpectedAttemptV2Schema = z
  .strictObject({
    runId: ProductGateRunIdV2Schema,
    caseId: ProductGateCaseIdV2Schema,
    stage: ProductGateEvaluationStageV1Schema,
    logicalOperationId: ProductGateLogicalOperationIdV2Schema,
    attemptId: ProductGateAttemptIdV2Schema,
    attemptOrdinal: z.literal(0),
    retryCount: z.literal(0),
  })
  .superRefine((attempt, context) => {
    const expectedOperationId = createProductGateLogicalOperationIdV2({
      operationVersion: 2,
      runId: attempt.runId,
      caseId: attempt.caseId,
      stage: attempt.stage,
    });
    const expectedAttemptId = createProductGateAttemptIdV2({
      attemptVersion: 2,
      logicalOperationId: expectedOperationId,
      attemptOrdinal: 0,
      retryCount: 0,
    });
    if (
      attempt.logicalOperationId !== expectedOperationId ||
      attempt.attemptId !== expectedAttemptId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Expected attempt identity must bind the exact run, case, stage, and zero retry.',
      });
    }
  })
  .readonly();

const ProductGateAttemptInventoryCoreV2Schema = z
  .strictObject({
    inventoryVersion: z.literal(2),
    runId: ProductGateRunIdV2Schema,
    runManifestSha256: Sha256HexSchema,
    expectedTerminalAttempts: z.array(ProductGateExpectedAttemptV2Schema).max(512).readonly(),
    expectedAttemptCount: z.int().min(0).max(512),
    completeTerminalAttemptInventory: z.literal(true),
  })
  .superRefine((inventory, context) => {
    const attempts = inventory.expectedTerminalAttempts;
    const operationKeys = attempts.map((attempt) => `${attempt.caseId}:${attempt.stage}`);
    const attemptIds = attempts.map((attempt) => attempt.attemptId);
    if (inventory.expectedAttemptCount !== attempts.length) {
      context.addIssue({
        code: 'custom',
        message: 'Expected attempt count must equal the complete terminal attempt inventory.',
        path: ['expectedAttemptCount'],
      });
    }
    if (
      inventory.runId !==
      createProductGateRunIdV2({
        runVersion: 2,
        runManifestSha256: inventory.runManifestSha256,
      })
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Attempt inventory run identity must bind its exact run manifest.',
        path: ['runId'],
      });
    }
    attempts.forEach((attempt, index) => {
      if (attempt.runId !== inventory.runId) {
        context.addIssue({
          code: 'custom',
          message: 'Every expected attempt must bind the exact inventory run.',
          path: ['expectedTerminalAttempts', index, 'runId'],
        });
      }
    });
    if (new Set(operationKeys).size !== attempts.length) {
      context.addIssue({
        code: 'custom',
        message: 'Attempt inventory cannot contain duplicate logical operations.',
        path: ['expectedTerminalAttempts'],
      });
    }
    if (new Set(attemptIds).size !== attempts.length) {
      context.addIssue({
        code: 'custom',
        message: 'Attempt inventory cannot contain duplicate attempt identities.',
        path: ['expectedTerminalAttempts'],
      });
    }
    if (canonicalizeJson(attemptIds) !== canonicalizeJson([...attemptIds].toSorted())) {
      context.addIssue({
        code: 'custom',
        message: 'Attempt inventory must be sorted canonically by attempt identity.',
        path: ['expectedTerminalAttempts'],
      });
    }
  })
  .readonly();

export const digestProductGateAttemptInventoryCoreV2 = (input: unknown): string =>
  canonicalDigest(ProductGateAttemptInventoryCoreV2Schema.parse(input));

export const ProductGateAttemptInventoryV2Schema = z
  .strictObject({
    inventoryVersion: z.literal(2),
    runId: ProductGateRunIdV2Schema,
    runManifestSha256: Sha256HexSchema,
    expectedTerminalAttempts: z.array(ProductGateExpectedAttemptV2Schema).max(512).readonly(),
    expectedAttemptCount: z.int().min(0).max(512),
    completeTerminalAttemptInventory: z.literal(true),
    inventorySha256: Sha256HexSchema,
  })
  .superRefine((inventory, context) => {
    const { inventorySha256, ...core } = inventory;
    const parsedCore = ProductGateAttemptInventoryCoreV2Schema.safeParse(core);
    if (!parsedCore.success) {
      for (const issue of parsedCore.error.issues) {
        context.addIssue({ ...issue, path: [...issue.path] });
      }
      return;
    }
    if (inventorySha256 !== digestProductGateAttemptInventoryCoreV2(parsedCore.data)) {
      context.addIssue({
        code: 'custom',
        message: 'Attempt inventory digest must bind its complete canonical core.',
        path: ['inventorySha256'],
      });
    }
  })
  .readonly();

const ProductGateAttemptInventoryInputV2Schema = z
  .strictObject({
    runId: ProductGateRunIdV2Schema,
    runManifestSha256: Sha256HexSchema,
    expectedOperations: z
      .array(
        z
          .strictObject({
            caseId: ProductGateCaseIdV2Schema,
            stage: ProductGateEvaluationStageV1Schema,
          })
          .readonly(),
      )
      .max(512)
      .readonly(),
  })
  .readonly();

export const createProductGateAttemptInventoryV2 = (input: unknown) => {
  const parsed = ProductGateAttemptInventoryInputV2Schema.parse(input);
  const expectedTerminalAttempts = parsed.expectedOperations
    .map(({ caseId, stage }) => {
      const logicalOperationId = createProductGateLogicalOperationIdV2({
        operationVersion: 2,
        runId: parsed.runId,
        caseId,
        stage,
      });
      return ProductGateExpectedAttemptV2Schema.parse({
        runId: parsed.runId,
        caseId,
        stage,
        logicalOperationId,
        attemptId: createProductGateAttemptIdV2({
          attemptVersion: 2,
          logicalOperationId,
          attemptOrdinal: 0,
          retryCount: 0,
        }),
        attemptOrdinal: 0,
        retryCount: 0,
      });
    })
    .toSorted((left, right) => left.attemptId.localeCompare(right.attemptId));
  const core = ProductGateAttemptInventoryCoreV2Schema.parse({
    inventoryVersion: 2,
    runId: parsed.runId,
    runManifestSha256: parsed.runManifestSha256,
    expectedTerminalAttempts,
    expectedAttemptCount: expectedTerminalAttempts.length,
    completeTerminalAttemptInventory: true,
  });
  return ProductGateAttemptInventoryV2Schema.parse({
    ...core,
    inventorySha256: digestProductGateAttemptInventoryCoreV2(core),
  });
};

const actualCostEvidenceCoreShape = {
  evidenceVersion: z.literal(2),
  evidenceKind: z.literal('sanitized-exact-attempt-actual-cost'),
  attemptId: ProductGateAttemptIdV2Schema,
  currency: z.literal('USD'),
  grossListCostMicros: CanonicalMicrosStringSchema,
  creditsAppliedMicros: CanonicalMicrosStringSchema,
  netAccountChargeMicros: CanonicalMicrosStringSchema,
  sanitizedEvidenceArtifactSha256: Sha256HexSchema,
  evidenceSource: z.enum(['provider-invoice-line', 'provider-usage-record', 'provider-receipt']),
  sanitized: z.literal(true),
  exactAttemptBinding: z.literal(true),
  rawProviderBodyRecorded: z.literal(false),
  credentialsRecorded: z.literal(false),
  privatePathRecorded: z.literal(false),
} as const;

const ProductGateActualCostEvidenceCoreV2Schema = z.strictObject(actualCostEvidenceCoreShape);

export const digestProductGateActualCostEvidenceV2 = (input: unknown): string =>
  canonicalDigest(ProductGateActualCostEvidenceCoreV2Schema.parse(input));

export const ProductGateActualCostEvidenceV2Schema = z
  .strictObject({
    ...actualCostEvidenceCoreShape,
    evidenceSha256: Sha256HexSchema,
  })
  .superRefine((evidence, context) => {
    const { evidenceSha256, ...core } = evidence;
    if (evidenceSha256 !== digestProductGateActualCostEvidenceV2(core)) {
      context.addIssue({
        code: 'custom',
        message: 'Actual-cost evidence identity must bind its exact sanitized attempt evidence.',
        path: ['evidenceSha256'],
      });
    }
  })
  .readonly();

export type ProductGateActualCostEvidenceV2 = z.infer<typeof ProductGateActualCostEvidenceV2Schema>;

export const createProductGateActualCostEvidenceV2 = (
  input: unknown,
): ProductGateActualCostEvidenceV2 => {
  const core = ProductGateActualCostEvidenceCoreV2Schema.parse(input);
  return ProductGateActualCostEvidenceV2Schema.parse({
    ...core,
    evidenceSha256: digestProductGateActualCostEvidenceV2(core),
  });
};

const calculatedCostEstimateCoreShape = {
  estimateVersion: z.literal(2),
  estimateKind: z.literal('calculated-gross-list-cost'),
  attemptId: ProductGateAttemptIdV2Schema,
  currency: z.literal('USD'),
  calculatedGrossListCostMicros: CanonicalMicrosStringSchema,
  calculationIdentitySha256: Sha256HexSchema,
  sanitizedInputsOnly: z.literal(true),
} as const;

const ProductGateCalculatedCostEstimateCoreV2Schema = z.strictObject(
  calculatedCostEstimateCoreShape,
);

export const digestProductGateCalculatedCostEstimateV2 = (input: unknown): string =>
  canonicalDigest(ProductGateCalculatedCostEstimateCoreV2Schema.parse(input));

export const ProductGateCalculatedCostEstimateV2Schema = z
  .strictObject({
    ...calculatedCostEstimateCoreShape,
    estimateSha256: Sha256HexSchema,
  })
  .superRefine((estimate, context) => {
    const { estimateSha256, ...core } = estimate;
    if (estimateSha256 !== digestProductGateCalculatedCostEstimateV2(core)) {
      context.addIssue({
        code: 'custom',
        message: 'Calculated-cost estimate identity must bind its exact sanitized calculation.',
        path: ['estimateSha256'],
      });
    }
  })
  .readonly();

export type ProductGateCalculatedCostEstimateV2 = z.infer<
  typeof ProductGateCalculatedCostEstimateV2Schema
>;

export const createProductGateCalculatedCostEstimateV2 = (
  input: unknown,
): ProductGateCalculatedCostEstimateV2 => {
  const core = ProductGateCalculatedCostEstimateCoreV2Schema.parse(input);
  return ProductGateCalculatedCostEstimateV2Schema.parse({
    ...core,
    estimateSha256: digestProductGateCalculatedCostEstimateV2(core),
  });
};

const ProductGateTerminalAttemptStatusV2Schema = z.enum(['succeeded', 'failed', 'indeterminate']);

export const ProductGateAttemptCostV2Schema = z
  .strictObject({
    costVersion: z.literal(2),
    attemptId: ProductGateAttemptIdV2Schema,
    logicalOperationId: ProductGateLogicalOperationIdV2Schema,
    retryCount: z.literal(0),
    attemptStatus: ProductGateTerminalAttemptStatusV2Schema,
    currency: z.literal('USD'),
    actualCostEvidence: ProductGateActualCostEvidenceV2Schema.nullable(),
    calculatedEstimate: ProductGateCalculatedCostEstimateV2Schema.nullable(),
    reservedGrossListCostMicros: CanonicalMicrosStringSchema,
    accountingBasis: z.enum(['actual', 'calculated-estimate', 'full-reservation']),
    accountedGrossListCostMicros: CanonicalMicrosStringSchema,
    creditsAppliedMicros: CanonicalMicrosStringSchema.nullable(),
    netAccountChargeMicros: CanonicalMicrosStringSchema.nullable(),
    grossListCostReducedByCredits: z.literal(false),
    countsTowardScoredCostMetric: z.literal(true),
    countsTowardOuterExecutionKillSwitch: z.literal(true),
    reservationCountsTowardOuterExecutionKillSwitch: z.literal(true),
  })
  .superRefine((cost, context) => {
    if (
      cost.attemptId !==
      createProductGateAttemptIdV2({
        attemptVersion: 2,
        logicalOperationId: cost.logicalOperationId,
        attemptOrdinal: 0,
        retryCount: cost.retryCount,
      })
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Attempt cost identity must bind its zero-retry logical operation.',
      });
    }
    if (cost.actualCostEvidence !== null && cost.actualCostEvidence.attemptId !== cost.attemptId) {
      context.addIssue({
        code: 'custom',
        message: 'Actual-cost evidence must bind the exact accounted attempt.',
        path: ['actualCostEvidence', 'attemptId'],
      });
    }
    if (cost.calculatedEstimate !== null && cost.calculatedEstimate.attemptId !== cost.attemptId) {
      context.addIssue({
        code: 'custom',
        message: 'Calculated-cost estimate must bind the exact accounted attempt.',
        path: ['calculatedEstimate', 'attemptId'],
      });
    }

    const expectedBasis =
      cost.actualCostEvidence !== null
        ? 'actual'
        : cost.calculatedEstimate !== null
          ? 'calculated-estimate'
          : 'full-reservation';
    const expectedGrossListCost =
      cost.actualCostEvidence?.grossListCostMicros ??
      cost.calculatedEstimate?.calculatedGrossListCostMicros ??
      cost.reservedGrossListCostMicros;
    const expectedCredits = cost.actualCostEvidence?.creditsAppliedMicros ?? null;
    const expectedNetCharge = cost.actualCostEvidence?.netAccountChargeMicros ?? null;

    if (
      cost.accountingBasis !== expectedBasis ||
      cost.accountedGrossListCostMicros !== expectedGrossListCost ||
      cost.creditsAppliedMicros !== expectedCredits ||
      cost.netAccountChargeMicros !== expectedNetCharge
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Attempt cost must prefer exact actual evidence, then a calculated estimate, then the full reservation while keeping credits and net charges separate.',
      });
    }
  })
  .readonly();

export type ProductGateAttemptCostV2 = z.infer<typeof ProductGateAttemptCostV2Schema>;

const ProductGateAttemptCostInputV2Schema = z
  .strictObject({
    attemptId: ProductGateAttemptIdV2Schema,
    logicalOperationId: ProductGateLogicalOperationIdV2Schema,
    attemptStatus: ProductGateTerminalAttemptStatusV2Schema,
    actualCostEvidence: ProductGateActualCostEvidenceV2Schema.nullable().default(null),
    calculatedEstimate: ProductGateCalculatedCostEstimateV2Schema.nullable().default(null),
    reservedGrossListCostMicros: CanonicalMicrosStringSchema,
  })
  .readonly();

export const createProductGateAttemptCostV2 = (input: unknown): ProductGateAttemptCostV2 => {
  const parsed = ProductGateAttemptCostInputV2Schema.parse(input);
  const actual = parsed.actualCostEvidence;
  const estimate = parsed.calculatedEstimate;
  return ProductGateAttemptCostV2Schema.parse({
    costVersion: 2,
    attemptId: parsed.attemptId,
    logicalOperationId: parsed.logicalOperationId,
    retryCount: 0,
    attemptStatus: parsed.attemptStatus,
    currency: 'USD',
    actualCostEvidence: actual,
    calculatedEstimate: estimate,
    reservedGrossListCostMicros: formatMicros(parseMicros(parsed.reservedGrossListCostMicros)),
    accountingBasis:
      actual !== null ? 'actual' : estimate !== null ? 'calculated-estimate' : 'full-reservation',
    accountedGrossListCostMicros:
      actual?.grossListCostMicros ??
      estimate?.calculatedGrossListCostMicros ??
      parsed.reservedGrossListCostMicros,
    creditsAppliedMicros: actual?.creditsAppliedMicros ?? null,
    netAccountChargeMicros: actual?.netAccountChargeMicros ?? null,
    grossListCostReducedByCredits: false,
    countsTowardScoredCostMetric: true,
    countsTowardOuterExecutionKillSwitch: true,
    reservationCountsTowardOuterExecutionKillSwitch: true,
  });
};

export const ProductGateAttemptCostLedgerV2Schema = z
  .array(ProductGateAttemptCostV2Schema)
  .max(512)
  .superRefine((costs, context) => {
    if (new Set(costs.map((cost) => cost.attemptId)).size !== costs.length) {
      context.addIssue({ code: 'custom', message: 'Attempt cost ledger contains a duplicate ID.' });
    }
    if (new Set(costs.map((cost) => cost.logicalOperationId)).size !== costs.length) {
      context.addIssue({
        code: 'custom',
        message: 'Zero retry permits at most one attempt cost per logical operation.',
      });
    }
    const attemptIds = costs.map((cost) => cost.attemptId);
    if (canonicalizeJson(attemptIds) !== canonicalizeJson([...attemptIds].toSorted())) {
      context.addIssue({
        code: 'custom',
        message: 'Attempt cost ledger must be sorted canonically by attempt ID.',
      });
    }
  })
  .readonly();

const completeLedgerMatchesInventory = (
  inventory: z.infer<typeof ProductGateAttemptInventoryV2Schema>,
  costs: z.infer<typeof ProductGateAttemptCostLedgerV2Schema>,
): boolean =>
  canonicalizeJson(
    inventory.expectedTerminalAttempts.map(({ attemptId, logicalOperationId }) => ({
      attemptId,
      logicalOperationId,
    })),
  ) ===
  canonicalizeJson(
    costs.map(({ attemptId, logicalOperationId }) => ({ attemptId, logicalOperationId })),
  );

export const calculateProductGateAccountedGrossListCostV2 = (
  input: unknown,
): ProductGateAggregateMicrosStringV2 => {
  const costs = ProductGateAttemptCostLedgerV2Schema.parse(input);
  let total = 0n;
  for (const cost of costs) {
    total += parseMicros(cost.accountedGrossListCostMicros);
    if (total > MAX_AGGREGATE_COST_MICROS) {
      throw new RangeError('Product-gate accounted cost exceeds the aggregate bound.');
    }
  }
  return formatAggregateMicros(total);
};

export const ProductGateBudgetPolicyV2Schema = z
  .strictObject({
    policyVersion: z.literal(2),
    policyIdentity: z.literal('banner-ai-product-gate-budget-policy-v2'),
    currency: z.literal('USD'),
    scoredCostTarget: z
      .strictObject({
        metric: z.literal('gross-list-micro-usd-per-e2e-success'),
        maximumMicrosPerSuccess: z.literal(PRODUCT_GATE_SCORED_COST_TARGET_MICROS_V2),
        relaxedByOuterKillSwitch: z.literal(false),
      })
      .readonly(),
    outerExecutionKillSwitch: z
      .strictObject({
        maximumGrossListCostMicros: z.literal(PRODUCT_GATE_OUTER_EXECUTION_KILL_SWITCH_MICROS_V2),
        independentOfScoredCostTarget: z.literal(true),
        failedAndIndeterminateAttemptsCount: z.literal(true),
        reservationsCountBeforeDispatch: z.literal(true),
      })
      .readonly(),
    creditsReduceGrossListCost: z.literal(false),
    netAccountChargesReplaceGrossListCost: z.literal(false),
  })
  .readonly();

export const PRODUCT_GATE_BUDGET_POLICY_V2 = ProductGateBudgetPolicyV2Schema.parse({
  policyVersion: 2,
  policyIdentity: 'banner-ai-product-gate-budget-policy-v2',
  currency: 'USD',
  scoredCostTarget: {
    metric: 'gross-list-micro-usd-per-e2e-success',
    maximumMicrosPerSuccess: PRODUCT_GATE_SCORED_COST_TARGET_MICROS_V2,
    relaxedByOuterKillSwitch: false,
  },
  outerExecutionKillSwitch: {
    maximumGrossListCostMicros: PRODUCT_GATE_OUTER_EXECUTION_KILL_SWITCH_MICROS_V2,
    independentOfScoredCostTarget: true,
    failedAndIndeterminateAttemptsCount: true,
    reservationsCountBeforeDispatch: true,
  },
  creditsReduceGrossListCost: false,
  netAccountChargesReplaceGrossListCost: false,
});

const ProductGateE2ESuccessEvidenceCoreV2Schema = z.strictObject({
  evidenceVersion: z.literal(2),
  runId: ProductGateRunIdV2Schema,
  caseId: ProductGateCaseIdV2Schema,
  authoritativeValidationAttemptId: ProductGateAttemptIdV2Schema,
  requirements: z
    .strictObject({
      compositeUsefulness: z.literal('pass'),
      sceneMaterialization: z.literal('pass'),
      presetAndTargetAppropriateness: z.literal('pass'),
      preview: z.literal('pass'),
      export: z.literal('pass'),
      authoritativeValidation: z.literal('pass'),
      failureRecovery: z.literal('pass'),
    })
    .readonly(),
  sevenRequirementCount: z.literal(7),
  allSevenRequirementsSatisfied: z.literal(true),
  evidenceComplete: z.literal(true),
  evidenceProjectionSha256: Sha256HexSchema,
});

export const digestProductGateE2ESuccessEvidenceCoreV2 = (input: unknown): string =>
  canonicalDigest(ProductGateE2ESuccessEvidenceCoreV2Schema.parse(input));

export const ProductGateE2ESuccessEvidenceV2Schema = z
  .strictObject({
    ...ProductGateE2ESuccessEvidenceCoreV2Schema.shape,
    successEvidenceSha256: Sha256HexSchema,
  })
  .superRefine((evidence, context) => {
    const { successEvidenceSha256, ...core } = evidence;
    if (successEvidenceSha256 !== digestProductGateE2ESuccessEvidenceCoreV2(core)) {
      context.addIssue({
        code: 'custom',
        message: 'E2E success identity must bind all seven passing requirements.',
      });
    }
  })
  .readonly();

export const createProductGateE2ESuccessEvidenceV2 = (input: unknown) => {
  const core = ProductGateE2ESuccessEvidenceCoreV2Schema.parse(input);
  return ProductGateE2ESuccessEvidenceV2Schema.parse({
    ...core,
    successEvidenceSha256: digestProductGateE2ESuccessEvidenceCoreV2(core),
  });
};

export const ProductGateScoredCostEvaluationV2Schema = z
  .strictObject({
    evaluationVersion: z.literal(2),
    attemptInventory: ProductGateAttemptInventoryV2Schema,
    attemptInventorySha256: Sha256HexSchema,
    attemptCosts: ProductGateAttemptCostLedgerV2Schema,
    attemptLedgerSha256: Sha256HexSchema,
    accountedGrossListCostMicros: ProductGateAggregateMicrosStringV2Schema,
    e2eSuccessEvidence: z.array(ProductGateE2ESuccessEvidenceV2Schema).max(18).readonly(),
    e2eSuccessEvidenceManifestSha256: Sha256HexSchema,
    e2eSuccessCount: z.int().min(0).max(18),
    maximumMicrosPerSuccess: z.literal(PRODUCT_GATE_SCORED_COST_TARGET_MICROS_V2),
    decision: z.enum(['pass', 'fail', 'inconclusive']),
    reason: z.enum(['target-met', 'target-not-met', 'zero-successes']),
    outerKillSwitchUsedAsTarget: z.literal(false),
  })
  .superRefine((evaluation, context) => {
    const inventoryMatches = completeLedgerMatchesInventory(
      evaluation.attemptInventory,
      evaluation.attemptCosts,
    );
    const expectedLedgerSha256 = canonicalDigest(evaluation.attemptCosts);
    const expectedAccountedCost = calculateProductGateAccountedGrossListCostV2(
      evaluation.attemptCosts,
    );
    const zeroSuccesses = evaluation.e2eSuccessCount === 0;
    const successfulCaseIds = evaluation.e2eSuccessEvidence.map((evidence) => evidence.caseId);
    const successEvidenceValid = evaluation.e2eSuccessEvidence.every((evidence) => {
      const attemptIndex = evaluation.attemptInventory.expectedTerminalAttempts.findIndex(
        (attempt) => attempt.attemptId === evidence.authoritativeValidationAttemptId,
      );
      const attempt = evaluation.attemptInventory.expectedTerminalAttempts[attemptIndex];
      const cost = evaluation.attemptCosts[attemptIndex];
      return (
        attempt?.runId === evidence.runId &&
        attempt.caseId === evidence.caseId &&
        attempt.stage === 'authoritative-validation' &&
        cost?.attemptId === evidence.authoritativeValidationAttemptId &&
        cost.attemptStatus === 'succeeded'
      );
    });
    const targetMet =
      !zeroSuccesses &&
      BigInt(evaluation.accountedGrossListCostMicros) <=
        BigInt(PRODUCT_GATE_SCORED_COST_TARGET_MICROS_V2) * BigInt(evaluation.e2eSuccessCount);
    const expectedDecision = zeroSuccesses ? 'inconclusive' : targetMet ? 'pass' : 'fail';
    const expectedReason = zeroSuccesses
      ? 'zero-successes'
      : targetMet
        ? 'target-met'
        : 'target-not-met';
    if (
      evaluation.attemptInventorySha256 !== evaluation.attemptInventory.inventorySha256 ||
      !inventoryMatches ||
      evaluation.attemptLedgerSha256 !== expectedLedgerSha256 ||
      evaluation.accountedGrossListCostMicros !== expectedAccountedCost ||
      new Set(successfulCaseIds).size !== successfulCaseIds.length ||
      canonicalizeJson(successfulCaseIds) !== canonicalizeJson([...successfulCaseIds].toSorted()) ||
      !successEvidenceValid ||
      evaluation.e2eSuccessEvidenceManifestSha256 !==
        canonicalDigest(evaluation.e2eSuccessEvidence) ||
      evaluation.e2eSuccessCount !== successfulCaseIds.length ||
      evaluation.decision !== expectedDecision ||
      evaluation.reason !== expectedReason
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Scored cost decision must use only its independent per-success target.',
      });
    }
  })
  .readonly();

const ProductGateScoredCostEvaluationInputV2Schema = z
  .strictObject({
    attemptInventory: ProductGateAttemptInventoryV2Schema,
    attemptCosts: ProductGateAttemptCostLedgerV2Schema,
    e2eSuccessEvidence: z.array(ProductGateE2ESuccessEvidenceV2Schema).max(18).readonly(),
  })
  .superRefine((input, context) => {
    if (!completeLedgerMatchesInventory(input.attemptInventory, input.attemptCosts)) {
      context.addIssue({
        code: 'custom',
        message: 'Scored cost requires one terminal cost for every run-bound expected attempt.',
      });
    }
  })
  .readonly();

export const evaluateProductGateScoredCostV2 = (input: unknown) => {
  const parsed = ProductGateScoredCostEvaluationInputV2Schema.parse(input);
  const accountedGrossListCostMicros = calculateProductGateAccountedGrossListCostV2(
    parsed.attemptCosts,
  );
  const e2eSuccessEvidence = [...parsed.e2eSuccessEvidence].toSorted((left, right) =>
    left.caseId.localeCompare(right.caseId),
  );
  const e2eSuccessCount = e2eSuccessEvidence.length;
  const zeroSuccesses = e2eSuccessCount === 0;
  const targetMet =
    !zeroSuccesses &&
    BigInt(accountedGrossListCostMicros) <=
      BigInt(PRODUCT_GATE_SCORED_COST_TARGET_MICROS_V2) * BigInt(e2eSuccessCount);
  return ProductGateScoredCostEvaluationV2Schema.parse({
    evaluationVersion: 2,
    attemptInventory: parsed.attemptInventory,
    attemptInventorySha256: parsed.attemptInventory.inventorySha256,
    attemptCosts: parsed.attemptCosts,
    attemptLedgerSha256: canonicalDigest(parsed.attemptCosts),
    accountedGrossListCostMicros,
    e2eSuccessEvidence,
    e2eSuccessEvidenceManifestSha256: canonicalDigest(e2eSuccessEvidence),
    e2eSuccessCount,
    maximumMicrosPerSuccess: PRODUCT_GATE_SCORED_COST_TARGET_MICROS_V2,
    decision: zeroSuccesses ? 'inconclusive' : targetMet ? 'pass' : 'fail',
    reason: zeroSuccesses ? 'zero-successes' : targetMet ? 'target-met' : 'target-not-met',
    outerKillSwitchUsedAsTarget: false,
  });
};

export const ProductGateZeroRetryPolicyV2Schema = z
  .strictObject({
    policyVersion: z.literal(2),
    defaultRetryCount: z.literal(0),
    maximumRetryCount: z.literal(0),
    retryAuthority: z.literal(false),
    idempotencySemanticsProven: z.literal(false),
    billingSemanticsProven: z.literal(false),
  })
  .readonly();

export const PRODUCT_GATE_ZERO_RETRY_POLICY_V2 = ProductGateZeroRetryPolicyV2Schema.parse({
  policyVersion: 2,
  defaultRetryCount: 0,
  maximumRetryCount: 0,
  retryAuthority: false,
  idempotencySemanticsProven: false,
  billingSemanticsProven: false,
});

export const ProductGateZeroRetryAttemptV2Schema = z
  .strictObject({
    retryCount: z.literal(0).default(0),
    retryOfAttemptId: z.null().default(null),
    idempotencySemanticsProven: z.literal(false).default(false),
    billingSemanticsProven: z.literal(false).default(false),
    retryAuthorized: z.literal(false).default(false),
  })
  .readonly();

export const enforceProductGateZeroRetryV2 = (input: unknown = {}) =>
  ProductGateZeroRetryAttemptV2Schema.parse(input);

const budgetReservationProjectionShape = {
  enforcementVersion: z.literal(2),
  enforcementKind: z.literal('deterministic-provider-free-fake-budget-check'),
  attemptInventory: ProductGateAttemptInventoryV2Schema,
  attemptInventorySha256: Sha256HexSchema,
  attemptCosts: ProductGateAttemptCostLedgerV2Schema,
  attemptLedgerSha256: Sha256HexSchema,
  committedExecutionGrossListCostMicros: ProductGateAggregateMicrosStringV2Schema,
  nextReservationGrossListCostMicros: CanonicalMicrosStringSchema,
  projectedExecutionGrossListCostMicros: ProductGateAggregateMicrosStringV2Schema,
  outerExecutionKillSwitchMicros: z.literal(PRODUCT_GATE_OUTER_EXECUTION_KILL_SWITCH_MICROS_V2),
  scoredCostTargetMicrosPerSuccess: z.literal(PRODUCT_GATE_SCORED_COST_TARGET_MICROS_V2),
  scoredCostTargetAppliedToReservation: z.literal(false),
  retryCount: z.literal(0),
  providerCallAuthority: z.literal(false),
  paidCallAuthority: z.literal(false),
  dispatch: z.literal(false),
} as const;

export const ProductGateBudgetReservationDecisionV2Schema = z
  .discriminatedUnion('decision', [
    z
      .strictObject({
        ...budgetReservationProjectionShape,
        decision: z.literal('within-outer-kill-switch'),
        reservationWithinBudget: z.literal(true),
        reason: z.literal('projected-cost-at-or-below-outer-kill-switch'),
      })
      .readonly(),
    z
      .strictObject({
        ...budgetReservationProjectionShape,
        decision: z.literal('blocked-by-outer-kill-switch'),
        reservationWithinBudget: z.literal(false),
        reason: z.literal('projected-cost-exceeds-outer-kill-switch'),
      })
      .readonly(),
  ])
  .superRefine((decision, context) => {
    const inventoryMatches = completeLedgerMatchesInventory(
      decision.attemptInventory,
      decision.attemptCosts,
    );
    const expectedLedgerSha256 = canonicalDigest(decision.attemptCosts);
    const expectedCommitted = calculateProductGateAccountedGrossListCostV2(decision.attemptCosts);
    const expectedProjected =
      BigInt(expectedCommitted) + parseMicros(decision.nextReservationGrossListCostMicros);
    const blocked = expectedProjected > BigInt(PRODUCT_GATE_OUTER_EXECUTION_KILL_SWITCH_MICROS_V2);
    if (
      decision.attemptInventorySha256 !== decision.attemptInventory.inventorySha256 ||
      !inventoryMatches ||
      decision.attemptLedgerSha256 !== expectedLedgerSha256 ||
      decision.committedExecutionGrossListCostMicros !== expectedCommitted ||
      BigInt(decision.projectedExecutionGrossListCostMicros) !== expectedProjected ||
      blocked !== (decision.decision === 'blocked-by-outer-kill-switch')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Budget decision must derive only from the independent outer kill switch.',
      });
    }
  })
  .readonly();

const ProductGateBudgetReservationInputV2Schema = z
  .strictObject({
    attemptInventory: ProductGateAttemptInventoryV2Schema,
    attemptCosts: ProductGateAttemptCostLedgerV2Schema,
    nextReservationGrossListCostMicros: CanonicalMicrosStringSchema,
    retryCount: z.literal(0).default(0),
  })
  .superRefine((input, context) => {
    if (!completeLedgerMatchesInventory(input.attemptInventory, input.attemptCosts)) {
      context.addIssue({
        code: 'custom',
        message: 'Outer budget enforcement requires the complete run-bound terminal ledger.',
      });
    }
  })
  .readonly();

export const enforceProductGateOuterKillSwitchFakeV2 = (input: unknown) => {
  const parsed = ProductGateBudgetReservationInputV2Schema.parse(input);
  const committedExecutionGrossListCostMicros = calculateProductGateAccountedGrossListCostV2(
    parsed.attemptCosts,
  );
  const projected =
    BigInt(committedExecutionGrossListCostMicros) +
    parseMicros(parsed.nextReservationGrossListCostMicros);
  const projectedMicros = formatAggregateMicros(projected);
  const blocked = projected > BigInt(PRODUCT_GATE_OUTER_EXECUTION_KILL_SWITCH_MICROS_V2);
  return ProductGateBudgetReservationDecisionV2Schema.parse({
    enforcementVersion: 2,
    enforcementKind: 'deterministic-provider-free-fake-budget-check',
    attemptInventory: parsed.attemptInventory,
    attemptInventorySha256: parsed.attemptInventory.inventorySha256,
    attemptCosts: parsed.attemptCosts,
    attemptLedgerSha256: canonicalDigest(parsed.attemptCosts),
    committedExecutionGrossListCostMicros,
    nextReservationGrossListCostMicros: parsed.nextReservationGrossListCostMicros,
    projectedExecutionGrossListCostMicros: projectedMicros,
    outerExecutionKillSwitchMicros: PRODUCT_GATE_OUTER_EXECUTION_KILL_SWITCH_MICROS_V2,
    scoredCostTargetMicrosPerSuccess: PRODUCT_GATE_SCORED_COST_TARGET_MICROS_V2,
    scoredCostTargetAppliedToReservation: false,
    retryCount: 0,
    providerCallAuthority: false,
    paidCallAuthority: false,
    dispatch: false,
    decision: blocked ? 'blocked-by-outer-kill-switch' : 'within-outer-kill-switch',
    reservationWithinBudget: !blocked,
    reason: blocked
      ? 'projected-cost-exceeds-outer-kill-switch'
      : 'projected-cost-at-or-below-outer-kill-switch',
  });
};

export const ProductGateProviderFreeRunAuthorityV2Schema = z
  .strictObject({
    authorityVersion: z.literal(2),
    authorityIdentity: z.literal('banner-ai-product-gate-provider-free-authority-v2'),
    scope: z.literal('provider-free-contracts-and-deterministic-fakes-only'),
    providerStackFrozen: z.literal(false),
    holdoutStatus: z.literal('unopened'),
    providerResearchAuthority: z.literal(false),
    holdoutAccessAuthority: z.literal(false),
    transmissionAuthority: z.literal(false),
    realEvaluationAuthority: z.literal(false),
    executionAuthority: z.literal(false),
    authoritativeGdnAuthority: z.literal(false),
    runpodAuthority: z.literal(false),
    samAuthority: z.literal(false),
    gpuAuthority: z.literal(false),
    providerCallAuthority: z.literal(false),
    paidCallAuthority: z.literal(false),
    networkAuthority: z.literal(false),
    credentialAccessAuthority: z.literal(false),
    executable: z.literal(false),
  })
  .readonly();

export const PRODUCT_GATE_PROVIDER_FREE_RUN_AUTHORITY_V2 =
  ProductGateProviderFreeRunAuthorityV2Schema.parse({
    authorityVersion: 2,
    authorityIdentity: 'banner-ai-product-gate-provider-free-authority-v2',
    scope: 'provider-free-contracts-and-deterministic-fakes-only',
    providerStackFrozen: false,
    holdoutStatus: 'unopened',
    providerResearchAuthority: false,
    holdoutAccessAuthority: false,
    transmissionAuthority: false,
    realEvaluationAuthority: false,
    executionAuthority: false,
    authoritativeGdnAuthority: false,
    runpodAuthority: false,
    samAuthority: false,
    gpuAuthority: false,
    providerCallAuthority: false,
    paidCallAuthority: false,
    networkAuthority: false,
    credentialAccessAuthority: false,
    executable: false,
  });

export const ProductGateProviderFreeOperationCountersV2Schema = z
  .strictObject({
    remoteCalls: z.literal(0),
    networkOperations: z.literal(0),
    holdoutFilesAccessed: z.literal(0),
    imagesReadOrHashed: z.literal(0),
    providerModelCalls: z.literal(0),
    paidCalls: z.literal(0),
    runpodOperations: z.literal(0),
    samOperations: z.literal(0),
    gpuOperations: z.literal(0),
    credentialInspections: z.literal(0),
    gdnOperations: z.literal(0),
    externalQuarantineAccesses: z.literal(0),
  })
  .readonly();

export const PRODUCT_GATE_PROVIDER_FREE_OPERATION_COUNTERS_V2 =
  ProductGateProviderFreeOperationCountersV2Schema.parse({
    remoteCalls: 0,
    networkOperations: 0,
    holdoutFilesAccessed: 0,
    imagesReadOrHashed: 0,
    providerModelCalls: 0,
    paidCalls: 0,
    runpodOperations: 0,
    samOperations: 0,
    gpuOperations: 0,
    credentialInspections: 0,
    gdnOperations: 0,
    externalQuarantineAccesses: 0,
  });

export const ProductGateProviderFreeRunManifestIdV2Schema = z
  .string()
  .regex(/^pge_provider_free_run_manifest_v2_[0-9a-f]{64}$/u)
  .brand<'ProductGateProviderFreeRunManifestIdV2'>();

const providerFreeRunManifestCoreShape = {
  manifestVersion: z.literal(2),
  manifestContractIdentity: z.literal('banner-ai-product-gate-provider-free-run-manifest-v2'),
  runnerIdentity: z.literal('provider-free-deterministic-contract-fake-v2'),
  deterministicSeed: Sha256HexSchema,
  corpusStructureContractSha256: Sha256HexSchema,
  caseAdmissionContractSha256: Sha256HexSchema,
  evidenceKind: z.literal('provider-free-contract-fake-only'),
  expectedHoldoutCaseCount: z.literal(18),
  holdoutCaseDataPresent: z.literal(false),
  authority: ProductGateProviderFreeRunAuthorityV2Schema,
  budgetPolicy: ProductGateBudgetPolicyV2Schema,
  retryPolicy: ProductGateZeroRetryPolicyV2Schema,
  operationCounters: ProductGateProviderFreeOperationCountersV2Schema,
} as const;

const ProductGateProviderFreeRunManifestCoreV2Schema = z.strictObject(
  providerFreeRunManifestCoreShape,
);

export const digestProductGateProviderFreeRunManifestCoreV2 = (input: unknown): string =>
  canonicalDigest(ProductGateProviderFreeRunManifestCoreV2Schema.parse(input));

const manifestSha256 = (input: unknown): string => canonicalDigest(input);

export const ProductGateProviderFreeRunManifestV2Schema = z
  .strictObject({
    ...providerFreeRunManifestCoreShape,
    manifestId: ProductGateProviderFreeRunManifestIdV2Schema,
    manifestSha256: Sha256HexSchema,
  })
  .superRefine((manifest, context) => {
    const { manifestId, manifestSha256: recordedSha256, ...core } = manifest;
    const parsed = ProductGateProviderFreeRunManifestCoreV2Schema.safeParse(core);
    if (!parsed.success) return;
    const coreSha256 = digestProductGateProviderFreeRunManifestCoreV2(parsed.data);
    const expectedId = ProductGateProviderFreeRunManifestIdV2Schema.parse(
      `pge_provider_free_run_manifest_v2_${coreSha256}`,
    );
    if (manifestId !== expectedId) {
      context.addIssue({
        code: 'custom',
        message: 'Provider-free run manifest ID must derive from its canonical core.',
        path: ['manifestId'],
      });
    }
    if (recordedSha256 !== manifestSha256({ ...parsed.data, manifestId: expectedId })) {
      context.addIssue({
        code: 'custom',
        message:
          'Provider-free run manifest digest must derive from its canonical identified core.',
        path: ['manifestSha256'],
      });
    }
  })
  .readonly();

export type ProductGateProviderFreeRunManifestV2 = z.infer<
  typeof ProductGateProviderFreeRunManifestV2Schema
>;

const ProductGateProviderFreeRunManifestInputV2Schema = z
  .strictObject({
    deterministicSeed: Sha256HexSchema,
    corpusStructureContractSha256: Sha256HexSchema,
    caseAdmissionContractSha256: Sha256HexSchema,
  })
  .readonly();

/**
 * Creates inert, provider-free manifest evidence only. The resulting record carries no executable
 * authority and this module exposes no provider, endpoint, dispatch, or paid-operation adapter.
 */
export const createProductGateProviderFreeRunManifestV2 = (
  input: unknown,
): ProductGateProviderFreeRunManifestV2 => {
  const parsed = ProductGateProviderFreeRunManifestInputV2Schema.parse(input);
  const core = ProductGateProviderFreeRunManifestCoreV2Schema.parse({
    manifestVersion: 2,
    manifestContractIdentity: 'banner-ai-product-gate-provider-free-run-manifest-v2',
    runnerIdentity: 'provider-free-deterministic-contract-fake-v2',
    deterministicSeed: parsed.deterministicSeed,
    corpusStructureContractSha256: parsed.corpusStructureContractSha256,
    caseAdmissionContractSha256: parsed.caseAdmissionContractSha256,
    evidenceKind: 'provider-free-contract-fake-only',
    expectedHoldoutCaseCount: 18,
    holdoutCaseDataPresent: false,
    authority: PRODUCT_GATE_PROVIDER_FREE_RUN_AUTHORITY_V2,
    budgetPolicy: PRODUCT_GATE_BUDGET_POLICY_V2,
    retryPolicy: PRODUCT_GATE_ZERO_RETRY_POLICY_V2,
    operationCounters: PRODUCT_GATE_PROVIDER_FREE_OPERATION_COUNTERS_V2,
  });
  const coreSha256 = digestProductGateProviderFreeRunManifestCoreV2(core);
  const manifestId = ProductGateProviderFreeRunManifestIdV2Schema.parse(
    `pge_provider_free_run_manifest_v2_${coreSha256}`,
  );
  return ProductGateProviderFreeRunManifestV2Schema.parse({
    ...core,
    manifestId,
    manifestSha256: manifestSha256({ ...core, manifestId }),
  });
};

export const canonicalProductGateProviderFreeRunManifestJsonV2 = (input: unknown): string =>
  canonicalizeJson(ProductGateProviderFreeRunManifestV2Schema.parse(input));

export const canonicalProductGateProviderFreeRunManifestBytesV2 = (input: unknown): Uint8Array =>
  Buffer.from(canonicalProductGateProviderFreeRunManifestJsonV2(input), 'utf8');
