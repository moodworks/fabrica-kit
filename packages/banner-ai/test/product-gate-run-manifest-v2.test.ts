import { describe, expect, it } from 'vitest';

import { PRODUCT_GATE_HOLDOUT_STRUCTURAL_FAKE_V2 } from '../src/evaluation/product-gate-corpus-v2.js';
import * as runManifestV2 from '../src/evaluation/product-gate-run-manifest-v2.js';
import {
  PRODUCT_GATE_BUDGET_POLICY_V2,
  PRODUCT_GATE_OUTER_EXECUTION_KILL_SWITCH_MICROS_V2,
  PRODUCT_GATE_PROVIDER_FREE_RUN_AUTHORITY_V2,
  PRODUCT_GATE_SCORED_COST_TARGET_MICROS_V2,
  PRODUCT_GATE_ZERO_RETRY_POLICY_V2,
  ProductGateActualCostEvidenceV2Schema,
  ProductGateAttemptCostLedgerV2Schema,
  ProductGateAttemptCostV2Schema,
  ProductGateAttemptInventoryV2Schema,
  ProductGateBudgetReservationDecisionV2Schema,
  ProductGateProviderFreeRunManifestV2Schema,
  calculateProductGateAccountedGrossListCostV2,
  canonicalProductGateProviderFreeRunManifestBytesV2,
  canonicalProductGateProviderFreeRunManifestJsonV2,
  createProductGateActualCostEvidenceV2,
  createProductGateAttemptCostV2,
  createProductGateAttemptIdV2,
  createProductGateAttemptInventoryV2,
  createProductGateCalculatedCostEstimateV2,
  createProductGateE2ESuccessEvidenceV2,
  createProductGateLogicalOperationIdV2,
  createProductGateProviderFreeRunManifestV2,
  createProductGateRunIdV2,
  digestProductGateProviderFreeRunManifestCoreV2,
  enforceProductGateOuterKillSwitchFakeV2,
  enforceProductGateZeroRetryV2,
  evaluateProductGateScoredCostV2,
} from '../src/evaluation/product-gate-run-manifest-v2.js';
import { canonicalizeJson, sha256Hex } from '../src/scene/canonical-scene-json.js';

const sha = (digit: string): string => digit.repeat(64);

const inventoryWithRecomputedIdentity = (core: object) => ({
  ...core,
  inventorySha256: sha256Hex(Buffer.from(canonicalizeJson(core), 'utf8')),
});

const costRunManifestSha256 = sha('d');
const costRunId = createProductGateRunIdV2({
  runVersion: 2,
  runManifestSha256: costRunManifestSha256,
});

const logicalOperationByName = new Map<
  string,
  ReturnType<typeof createProductGateLogicalOperationIdV2>
>();
const logicalOperationByAttemptId = new Map<
  string,
  {
    readonly logicalOperationId: ReturnType<typeof createProductGateLogicalOperationIdV2>;
    readonly caseId: (typeof PRODUCT_GATE_HOLDOUT_STRUCTURAL_FAKE_V2.cases)[number]['caseId'];
    readonly stage: 'vision' | 'authoritative-validation';
  }
>();

const logicalOperationId = (name: string, stage: 'vision' | 'authoritative-validation') => {
  const key = `${name}:${stage}`;
  const existing = logicalOperationByName.get(key);
  if (existing !== undefined) return existing;
  const caseId = PRODUCT_GATE_HOLDOUT_STRUCTURAL_FAKE_V2.cases[logicalOperationByName.size]!.caseId;
  const created = createProductGateLogicalOperationIdV2({
    operationVersion: 2,
    runId: costRunId,
    caseId,
    stage,
  });
  logicalOperationByName.set(key, created);
  return created;
};

const attemptId = (name: string, stage: 'vision' | 'authoritative-validation' = 'vision') => {
  const operationId = logicalOperationId(name, stage);
  const caseId =
    PRODUCT_GATE_HOLDOUT_STRUCTURAL_FAKE_V2.cases[
      [...logicalOperationByName.keys()].indexOf(`${name}:${stage}`)
    ]!.caseId;
  const created = createProductGateAttemptIdV2({
    attemptVersion: 2,
    logicalOperationId: operationId,
    attemptOrdinal: 0,
    retryCount: 0,
  });
  logicalOperationByAttemptId.set(created, { logicalOperationId: operationId, caseId, stage });
  return created;
};

const actualEvidence = (
  ownedAttemptId: ReturnType<typeof attemptId>,
  grossListCostMicros = '900',
) =>
  createProductGateActualCostEvidenceV2({
    evidenceVersion: 2,
    evidenceKind: 'sanitized-exact-attempt-actual-cost',
    attemptId: ownedAttemptId,
    currency: 'USD',
    grossListCostMicros,
    creditsAppliedMicros: '400',
    netAccountChargeMicros: '500',
    sanitizedEvidenceArtifactSha256: sha('e'),
    evidenceSource: 'provider-usage-record',
    sanitized: true,
    exactAttemptBinding: true,
    rawProviderBodyRecorded: false,
    credentialsRecorded: false,
    privatePathRecorded: false,
  });

const calculatedEstimate = (
  ownedAttemptId: ReturnType<typeof attemptId>,
  calculatedGrossListCostMicros = '800',
) =>
  createProductGateCalculatedCostEstimateV2({
    estimateVersion: 2,
    estimateKind: 'calculated-gross-list-cost',
    attemptId: ownedAttemptId,
    currency: 'USD',
    calculatedGrossListCostMicros,
    calculationIdentitySha256: sha('a'),
    sanitizedInputsOnly: true,
  });

const attemptCost = (input: {
  readonly attemptId: ReturnType<typeof attemptId>;
  readonly attemptStatus: 'succeeded' | 'failed' | 'indeterminate';
  readonly actualCostEvidence?: ReturnType<typeof actualEvidence>;
  readonly calculatedEstimate?: ReturnType<typeof calculatedEstimate>;
  readonly reservedGrossListCostMicros: string;
}) => {
  const operationId = logicalOperationByAttemptId.get(input.attemptId);
  if (operationId === undefined) throw new TypeError('Test attempt has no logical operation.');
  return createProductGateAttemptCostV2({
    ...input,
    logicalOperationId: operationId.logicalOperationId,
  });
};

const canonicalLedger = (costs: readonly ReturnType<typeof attemptCost>[]) =>
  [...costs].toSorted((left, right) => left.attemptId.localeCompare(right.attemptId));

const attemptInventory = (costs: readonly ReturnType<typeof attemptCost>[]) =>
  createProductGateAttemptInventoryV2({
    runId: costRunId,
    runManifestSha256: costRunManifestSha256,
    expectedOperations: costs.map((cost) => {
      const operation = logicalOperationByAttemptId.get(cost.attemptId);
      if (operation === undefined) throw new TypeError('Test cost has no expected operation.');
      return { caseId: operation.caseId, stage: operation.stage };
    }),
  });

const emptyAttemptInventory = () =>
  createProductGateAttemptInventoryV2({
    runId: costRunId,
    runManifestSha256: costRunManifestSha256,
    expectedOperations: [],
  });

const e2eSuccessEvidence = (attemptIds: readonly ReturnType<typeof attemptId>[]) =>
  attemptIds
    .map((authoritativeValidationAttemptId) => {
      const operation = logicalOperationByAttemptId.get(authoritativeValidationAttemptId);
      if (operation === undefined) throw new TypeError('Test success has no expected operation.');
      return createProductGateE2ESuccessEvidenceV2({
        evidenceVersion: 2,
        runId: costRunId,
        caseId: operation.caseId,
        authoritativeValidationAttemptId,
        requirements: {
          compositeUsefulness: 'pass',
          sceneMaterialization: 'pass',
          presetAndTargetAppropriateness: 'pass',
          preview: 'pass',
          export: 'pass',
          authoritativeValidation: 'pass',
          failureRecovery: 'pass',
        },
        sevenRequirementCount: 7,
        allSevenRequirementsSatisfied: true,
        evidenceComplete: true,
        evidenceProjectionSha256: sha('c'),
      });
    })
    .toSorted((left, right) => left.caseId.localeCompare(right.caseId));

describe('Phase 3B V2 exported attempt inventory schema', () => {
  const inventoryRunManifestSha256 = sha('7');
  const inventoryRunId = createProductGateRunIdV2({
    runVersion: 2,
    runManifestSha256: inventoryRunManifestSha256,
  });
  const inventoryOperations = [
    { caseId: PRODUCT_GATE_HOLDOUT_STRUCTURAL_FAKE_V2.cases[0]!.caseId, stage: 'vision' as const },
    { caseId: PRODUCT_GATE_HOLDOUT_STRUCTURAL_FAKE_V2.cases[1]!.caseId, stage: 'vision' as const },
  ];

  const createValidInventory = () =>
    createProductGateAttemptInventoryV2({
      runId: inventoryRunId,
      runManifestSha256: inventoryRunManifestSha256,
      expectedOperations: inventoryOperations,
    });

  it('rejects every representative malformed core after its digest is recomputed', () => {
    const valid = createValidInventory();
    const { inventorySha256: ignoredInventorySha256, ...validCore } = valid;
    void ignoredInventorySha256;
    const foreignRunManifestSha256 = sha('8');
    const foreignRunId = createProductGateRunIdV2({
      runVersion: 2,
      runManifestSha256: foreignRunManifestSha256,
    });
    const foreignInventory = createProductGateAttemptInventoryV2({
      runId: foreignRunId,
      runManifestSha256: foreignRunManifestSha256,
      expectedOperations: inventoryOperations.slice(0, 1),
    });

    const malformedCores = [
      {
        name: 'invalid expected count',
        core: { ...validCore, expectedAttemptCount: validCore.expectedAttemptCount - 1 },
        expectedMessage:
          'Expected attempt count must equal the complete terminal attempt inventory.',
        expectedPath: ['expectedAttemptCount'],
      },
      {
        name: 'manifest and run binding mismatch',
        core: { ...validCore, runManifestSha256: sha('9') },
        expectedMessage: 'Attempt inventory run identity must bind its exact run manifest.',
        expectedPath: ['runId'],
      },
      {
        name: 'attempt and inventory run binding mismatch',
        core: {
          ...validCore,
          expectedTerminalAttempts: [foreignInventory.expectedTerminalAttempts[0]!],
          expectedAttemptCount: 1,
        },
        expectedMessage: 'Every expected attempt must bind the exact inventory run.',
        expectedPath: ['expectedTerminalAttempts', 0, 'runId'],
      },
      {
        name: 'duplicate logical operation and attempt identity',
        core: {
          ...validCore,
          expectedTerminalAttempts: [
            validCore.expectedTerminalAttempts[0]!,
            validCore.expectedTerminalAttempts[0]!,
          ],
          expectedAttemptCount: 2,
        },
        expectedMessage: 'Attempt inventory cannot contain duplicate logical operations.',
        expectedPath: ['expectedTerminalAttempts'],
      },
      {
        name: 'noncanonical attempt ordering',
        core: {
          ...validCore,
          expectedTerminalAttempts: [...validCore.expectedTerminalAttempts].toReversed(),
        },
        expectedMessage: 'Attempt inventory must be sorted canonically by attempt identity.',
        expectedPath: ['expectedTerminalAttempts'],
      },
    ];

    for (const { name, core, expectedMessage, expectedPath } of malformedCores) {
      const malformed = inventoryWithRecomputedIdentity(core);
      expect(malformed.inventorySha256, name).toBe(
        sha256Hex(Buffer.from(canonicalizeJson(core), 'utf8')),
      );
      expect(malformed.inventorySha256, name).not.toBe(valid.inventorySha256);

      const result = ProductGateAttemptInventoryV2Schema.safeParse(malformed);
      expect(result.success, name).toBe(false);
      if (result.success) throw new TypeError(`Malformed inventory passed: ${name}`);
      expect(result.error.issues, name).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: expectedMessage, path: expectedPath }),
        ]),
      );
      expect(
        result.error.issues.some((issue) => issue.path[0] === 'inventorySha256'),
        name,
      ).toBe(false);
    }
  });

  it('accepts a valid control and preserves canonical replay and inventory identity', () => {
    const valid = createValidInventory();
    const replay = createProductGateAttemptInventoryV2({
      runId: inventoryRunId,
      runManifestSha256: inventoryRunManifestSha256,
      expectedOperations: [...inventoryOperations].toReversed(),
    });
    const result = ProductGateAttemptInventoryV2Schema.safeParse(valid);
    const { inventorySha256: ignoredInventorySha256, ...validCore } = valid;
    void ignoredInventorySha256;

    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    expect(replay).toEqual(valid);
    expect(replay.inventorySha256).toBe(valid.inventorySha256);
    expect(valid.inventorySha256).toBe(sha256Hex(Buffer.from(canonicalizeJson(validCore), 'utf8')));
    expect(result.data).toEqual(valid);
  });
});

describe('Phase 3B V2 cost truth and separate budget concepts', () => {
  it('prefers exact actual evidence, then a calculated estimate, then the full reservation', () => {
    const actualAttemptId = attemptId('actual');
    const actual = actualEvidence(actualAttemptId);
    const estimate = calculatedEstimate(actualAttemptId);
    const actualCost = attemptCost({
      attemptId: actualAttemptId,
      attemptStatus: 'succeeded',
      actualCostEvidence: actual,
      calculatedEstimate: estimate,
      reservedGrossListCostMicros: '1000',
    });
    expect(actualCost).toMatchObject({
      accountingBasis: 'actual',
      accountedGrossListCostMicros: '900',
      creditsAppliedMicros: '400',
      netAccountChargeMicros: '500',
      grossListCostReducedByCredits: false,
    });

    const estimatedAttemptId = attemptId('estimate');
    const estimatedCost = attemptCost({
      attemptId: estimatedAttemptId,
      attemptStatus: 'failed',
      calculatedEstimate: calculatedEstimate(estimatedAttemptId, '700'),
      reservedGrossListCostMicros: '1000',
    });
    expect(estimatedCost).toMatchObject({
      accountingBasis: 'calculated-estimate',
      accountedGrossListCostMicros: '700',
      creditsAppliedMicros: null,
      netAccountChargeMicros: null,
    });

    const reservedAttemptId = attemptId('reservation');
    const reservedCost = attemptCost({
      attemptId: reservedAttemptId,
      attemptStatus: 'indeterminate',
      reservedGrossListCostMicros: '1000',
    });
    expect(reservedCost).toMatchObject({
      accountingBasis: 'full-reservation',
      accountedGrossListCostMicros: '1000',
      creditsAppliedMicros: null,
      netAccountChargeMicros: null,
    });

    expect(
      calculateProductGateAccountedGrossListCostV2(
        canonicalLedger([actualCost, estimatedCost, reservedCost]),
      ),
    ).toBe('2600');
  });

  it('requires sanitized actual evidence bound unambiguously to the exact attempt', () => {
    const firstAttemptId = attemptId('first');
    const secondAttemptId = attemptId('second');
    const firstEvidence = actualEvidence(firstAttemptId);

    expect(() =>
      attemptCost({
        attemptId: secondAttemptId,
        attemptStatus: 'succeeded',
        actualCostEvidence: firstEvidence,
        reservedGrossListCostMicros: '1000',
      }),
    ).toThrow(/exact accounted attempt/u);
    expect(
      ProductGateActualCostEvidenceV2Schema.safeParse({
        ...firstEvidence,
        attemptId: secondAttemptId,
      }).success,
    ).toBe(false);
    expect(
      ProductGateActualCostEvidenceV2Schema.safeParse({
        ...firstEvidence,
        sanitized: false,
      }).success,
    ).toBe(false);
    expect(
      ProductGateActualCostEvidenceV2Schema.safeParse({
        ...firstEvidence,
        sanitizedEvidenceArtifactSha256: undefined,
      }).success,
    ).toBe(false);
    expect(
      ProductGateActualCostEvidenceV2Schema.safeParse({
        ...firstEvidence,
        rawProviderBody: { arbitrary: true },
      }).success,
    ).toBe(false);
    expect(
      ProductGateAttemptCostV2Schema.safeParse({
        ...attemptCost({
          attemptId: firstAttemptId,
          attemptStatus: 'succeeded',
          actualCostEvidence: firstEvidence,
          reservedGrossListCostMicros: '1000',
        }),
        accountedGrossListCostMicros: '500',
      }).success,
    ).toBe(false);
  });

  it('counts failed and indeterminate attempt costs without subtracting credits or net charges', () => {
    const succeededId = attemptId('succeeded-ledger');
    const failedId = attemptId('failed-ledger');
    const indeterminateId = attemptId('indeterminate-ledger');
    const succeeded = attemptCost({
      attemptId: succeededId,
      attemptStatus: 'succeeded',
      actualCostEvidence: actualEvidence(succeededId, '1000'),
      reservedGrossListCostMicros: '1200',
    });
    const failed = attemptCost({
      attemptId: failedId,
      attemptStatus: 'failed',
      calculatedEstimate: calculatedEstimate(failedId, '200'),
      reservedGrossListCostMicros: '300',
    });
    const indeterminate = attemptCost({
      attemptId: indeterminateId,
      attemptStatus: 'indeterminate',
      reservedGrossListCostMicros: '300',
    });

    for (const cost of [succeeded, failed, indeterminate]) {
      expect(cost).toMatchObject({
        countsTowardScoredCostMetric: true,
        countsTowardOuterExecutionKillSwitch: true,
        reservationCountsTowardOuterExecutionKillSwitch: true,
      });
    }
    expect(
      calculateProductGateAccountedGrossListCostV2(
        canonicalLedger([succeeded, failed, indeterminate]),
      ),
    ).toBe('1500');
    expect(ProductGateAttemptCostLedgerV2Schema.safeParse([failed, failed]).success).toBe(false);
    expect(
      ProductGateAttemptCostV2Schema.safeParse({
        ...failed,
        attemptId: attemptId('foreign-attempt-for-same-operation'),
      }).success,
    ).toBe(false);
  });

  it('freezes and evaluates the scored target independently from the execution kill switch', () => {
    expect(PRODUCT_GATE_SCORED_COST_TARGET_MICROS_V2).toBe('350000');
    expect(PRODUCT_GATE_OUTER_EXECUTION_KILL_SWITCH_MICROS_V2).toBe('13100000');
    expect(PRODUCT_GATE_BUDGET_POLICY_V2).toMatchObject({
      scoredCostTarget: {
        maximumMicrosPerSuccess: '350000',
        relaxedByOuterKillSwitch: false,
      },
      outerExecutionKillSwitch: {
        maximumGrossListCostMicros: '13100000',
        independentOfScoredCostTarget: true,
      },
    });
    const atTargetFirstId = attemptId('at-scored-target-first', 'authoritative-validation');
    const atTargetSecondId = attemptId('at-scored-target-second', 'authoritative-validation');
    const atTargetCosts = canonicalLedger([
      attemptCost({
        attemptId: atTargetFirstId,
        attemptStatus: 'succeeded',
        reservedGrossListCostMicros: '350000',
      }),
      attemptCost({
        attemptId: atTargetSecondId,
        attemptStatus: 'succeeded',
        reservedGrossListCostMicros: '350000',
      }),
    ]);
    const atTargetSuccessEvidence = e2eSuccessEvidence([atTargetFirstId, atTargetSecondId]);
    expect(
      evaluateProductGateScoredCostV2({
        attemptInventory: attemptInventory(atTargetCosts),
        attemptCosts: atTargetCosts,
        e2eSuccessEvidence: atTargetSuccessEvidence,
      }),
    ).toMatchObject({ decision: 'pass', accountedGrossListCostMicros: '700000' });
    const aboveTargetFirstId = attemptId('above-scored-target-first', 'authoritative-validation');
    const aboveTargetSecondId = attemptId('above-scored-target-second', 'authoritative-validation');
    const aboveTargetCosts = canonicalLedger([
      attemptCost({
        attemptId: aboveTargetFirstId,
        attemptStatus: 'succeeded',
        reservedGrossListCostMicros: '350001',
      }),
      attemptCost({
        attemptId: aboveTargetSecondId,
        attemptStatus: 'succeeded',
        reservedGrossListCostMicros: '350000',
      }),
    ]);
    expect(
      evaluateProductGateScoredCostV2({
        attemptInventory: attemptInventory(aboveTargetCosts),
        attemptCosts: aboveTargetCosts,
        e2eSuccessEvidence: e2eSuccessEvidence([aboveTargetFirstId, aboveTargetSecondId]),
      }).decision,
    ).toBe('fail');
    expect(
      evaluateProductGateScoredCostV2({
        attemptInventory: emptyAttemptInventory(),
        attemptCosts: [],
        e2eSuccessEvidence: [],
      }),
    ).toMatchObject({ decision: 'inconclusive', reason: 'zero-successes' });
    expect(() =>
      evaluateProductGateScoredCostV2({
        attemptInventory: emptyAttemptInventory(),
        attemptCosts: [],
        e2eSuccessEvidence: atTargetSuccessEvidence.slice(0, 1),
      }),
    ).toThrow();
    const failedAuthoritativeCosts = canonicalLedger([
      attemptCost({
        attemptId: atTargetFirstId,
        attemptStatus: 'failed',
        reservedGrossListCostMicros: '350000',
      }),
      atTargetCosts.find((cost) => cost.attemptId === atTargetSecondId)!,
    ]);
    expect(() =>
      evaluateProductGateScoredCostV2({
        attemptInventory: attemptInventory(failedAuthoritativeCosts),
        attemptCosts: failedAuthoritativeCosts,
        e2eSuccessEvidence: atTargetSuccessEvidence,
      }),
    ).toThrow(/independent per-success target/u);
    const { successEvidenceSha256: ignoredSuccessEvidenceSha256, ...successCore } =
      atTargetSuccessEvidence[0]!;
    void ignoredSuccessEvidenceSha256;
    expect(() =>
      createProductGateE2ESuccessEvidenceV2({
        ...successCore,
        requirements: {
          ...successCore.requirements,
          failureRecovery: 'fail',
        },
      }),
    ).toThrow();
    expect(() =>
      evaluateProductGateScoredCostV2({
        attemptInventory: attemptInventory(atTargetCosts),
        attemptCosts: atTargetCosts.slice(1),
        e2eSuccessEvidence: atTargetSuccessEvidence,
      }),
    ).toThrow(/every run-bound expected attempt/u);
    expect(() =>
      evaluateProductGateScoredCostV2({
        attemptInventory: attemptInventory(atTargetCosts),
        attemptCosts: atTargetCosts,
        e2eSuccessEvidence: atTargetSuccessEvidence,
        accountedGrossListCostMicros: '0',
      }),
    ).toThrow();
    expect(() =>
      calculateProductGateAccountedGrossListCostV2([...atTargetCosts].toReversed()),
    ).toThrow(/sorted canonically/u);
    const separateRunId = createProductGateRunIdV2({
      runVersion: 2,
      runManifestSha256: sha('b'),
    });
    expect(
      createProductGateLogicalOperationIdV2({
        operationVersion: 2,
        runId: separateRunId,
        caseId: logicalOperationByAttemptId.get(atTargetFirstId)!.caseId,
        stage: 'authoritative-validation',
      }),
    ).not.toBe(logicalOperationByAttemptId.get(atTargetFirstId)!.logicalOperationId);
  });

  it('allows the exact outer boundary, blocks only above it, and never dispatches', () => {
    const committedAttemptId = attemptId('outer-committed');
    const committedAttempt = attemptCost({
      attemptId: committedAttemptId,
      attemptStatus: 'failed',
      reservedGrossListCostMicros: '12750000',
    });
    const exactBoundary = enforceProductGateOuterKillSwitchFakeV2({
      attemptInventory: attemptInventory([committedAttempt]),
      attemptCosts: [committedAttempt],
      nextReservationGrossListCostMicros: '350000',
    });
    expect(exactBoundary).toMatchObject({
      projectedExecutionGrossListCostMicros: '13100000',
      decision: 'within-outer-kill-switch',
      reservationWithinBudget: true,
      scoredCostTargetAppliedToReservation: false,
      providerCallAuthority: false,
      paidCallAuthority: false,
      dispatch: false,
    });

    const aboveBoundary = enforceProductGateOuterKillSwitchFakeV2({
      attemptInventory: attemptInventory([committedAttempt]),
      attemptCosts: [committedAttempt],
      nextReservationGrossListCostMicros: '350001',
    });
    expect(aboveBoundary).toMatchObject({
      projectedExecutionGrossListCostMicros: '13100001',
      decision: 'blocked-by-outer-kill-switch',
      reservationWithinBudget: false,
    });

    const aboveScoredTargetButInsideOuterCeiling = enforceProductGateOuterKillSwitchFakeV2({
      attemptInventory: emptyAttemptInventory(),
      attemptCosts: [],
      nextReservationGrossListCostMicros: '350001',
    });
    expect(aboveScoredTargetButInsideOuterCeiling.decision).toBe('within-outer-kill-switch');
    expect(
      ProductGateBudgetReservationDecisionV2Schema.safeParse({
        ...aboveBoundary,
        decision: 'within-outer-kill-switch',
        reservationWithinBudget: true,
        reason: 'projected-cost-at-or-below-outer-kill-switch',
      }).success,
    ).toBe(false);
  });
});

describe('Phase 3B V2 zero-retry and inert provider-free run manifest', () => {
  it('defaults to zero retries and rejects every retry or assumed retry semantic', () => {
    expect(PRODUCT_GATE_ZERO_RETRY_POLICY_V2).toEqual({
      policyVersion: 2,
      defaultRetryCount: 0,
      maximumRetryCount: 0,
      retryAuthority: false,
      idempotencySemanticsProven: false,
      billingSemanticsProven: false,
    });
    expect(enforceProductGateZeroRetryV2()).toEqual({
      retryCount: 0,
      retryOfAttemptId: null,
      idempotencySemanticsProven: false,
      billingSemanticsProven: false,
      retryAuthorized: false,
    });
    expect(() => enforceProductGateZeroRetryV2({ retryCount: 1 })).toThrow();
    expect(() =>
      enforceProductGateZeroRetryV2({ retryOfAttemptId: attemptId('retry-parent') }),
    ).toThrow();
    expect(() => enforceProductGateZeroRetryV2({ idempotencySemanticsProven: true })).toThrow();
    expect(() => enforceProductGateZeroRetryV2({ billingSemanticsProven: true })).toThrow();
    expect(() => enforceProductGateZeroRetryV2({ unexpected: true })).toThrow();
    expect(() =>
      enforceProductGateOuterKillSwitchFakeV2({
        attemptInventory: emptyAttemptInventory(),
        attemptCosts: [],
        nextReservationGrossListCostMicros: '1',
        retryCount: 1,
      }),
    ).toThrow();
  });

  it('creates byte-stable content-derived fake manifests with every authority and counter inert', () => {
    const input = {
      deterministicSeed: sha('1'),
      corpusStructureContractSha256: sha('2'),
      caseAdmissionContractSha256: sha('3'),
    };
    const first = createProductGateProviderFreeRunManifestV2(input);
    const replay = createProductGateProviderFreeRunManifestV2({
      caseAdmissionContractSha256: sha('3'),
      deterministicSeed: sha('1'),
      corpusStructureContractSha256: sha('2'),
    });
    expect(replay).toEqual(first);
    expect(canonicalProductGateProviderFreeRunManifestJsonV2(replay)).toBe(
      canonicalProductGateProviderFreeRunManifestJsonV2(first),
    );
    expect(Buffer.from(canonicalProductGateProviderFreeRunManifestBytesV2(replay))).toEqual(
      Buffer.from(canonicalProductGateProviderFreeRunManifestBytesV2(first)),
    );

    const { manifestId, manifestSha256: ignoredManifestSha256, ...core } = first;
    void ignoredManifestSha256;
    expect(manifestId).toBe(
      `pge_provider_free_run_manifest_v2_${digestProductGateProviderFreeRunManifestCoreV2(core)}`,
    );
    expect(first.authority).toEqual(PRODUCT_GATE_PROVIDER_FREE_RUN_AUTHORITY_V2);
    expect(first.authority).toMatchObject({
      providerStackFrozen: false,
      holdoutStatus: 'unopened',
      transmissionAuthority: false,
      realEvaluationAuthority: false,
      executionAuthority: false,
      authoritativeGdnAuthority: false,
      runpodAuthority: false,
      samAuthority: false,
      gpuAuthority: false,
      providerCallAuthority: false,
      paidCallAuthority: false,
      executable: false,
    });
    expect(Object.values(first.operationCounters).every((count) => count === 0)).toBe(true);
    expect(first).toMatchObject({
      evidenceKind: 'provider-free-contract-fake-only',
      holdoutCaseDataPresent: false,
      expectedHoldoutCaseCount: 18,
    });
  });

  it('rejects unknown provider selections, executable authority, drift, and nonzero operations', () => {
    const manifest = createProductGateProviderFreeRunManifestV2({
      deterministicSeed: sha('4'),
      corpusStructureContractSha256: sha('5'),
      caseAdmissionContractSha256: sha('6'),
    });
    expect(
      ProductGateProviderFreeRunManifestV2Schema.safeParse({
        ...manifest,
        provider: 'forbidden',
      }).success,
    ).toBe(false);
    expect(
      ProductGateProviderFreeRunManifestV2Schema.safeParse({
        ...manifest,
        authority: { ...manifest.authority, endpoint: 'forbidden' },
      }).success,
    ).toBe(false);
    expect(
      ProductGateProviderFreeRunManifestV2Schema.safeParse({
        ...manifest,
        authority: { ...manifest.authority, executable: true },
      }).success,
    ).toBe(false);
    expect(
      ProductGateProviderFreeRunManifestV2Schema.safeParse({
        ...manifest,
        operationCounters: { ...manifest.operationCounters, paidCalls: 1 },
      }).success,
    ).toBe(false);
    expect(
      ProductGateProviderFreeRunManifestV2Schema.safeParse({
        ...manifest,
        budgetPolicy: {
          ...manifest.budgetPolicy,
          scoredCostTarget: {
            ...manifest.budgetPolicy.scoredCostTarget,
            maximumMicrosPerSuccess: '13100000',
          },
        },
      }).success,
    ).toBe(false);
    expect(() =>
      createProductGateProviderFreeRunManifestV2({
        deterministicSeed: sha('4'),
        corpusStructureContractSha256: sha('5'),
        caseAdmissionContractSha256: sha('6'),
        model: 'forbidden',
      }),
    ).toThrow();

    const exactProhibitedSelectionKeys = new Set([
      'provider',
      'providerId',
      'model',
      'modelId',
      'endpoint',
      'endpointId',
    ]);
    const inspectKeys = (value: unknown): boolean => {
      if (Array.isArray(value)) return value.some(inspectKeys);
      if (value === null || typeof value !== 'object') return false;
      return Object.entries(value).some(
        ([key, child]) => exactProhibitedSelectionKeys.has(key) || inspectKeys(child),
      );
    };
    expect(inspectKeys(manifest)).toBe(false);
    expect(Object.keys(runManifestV2).some((name) => /execute|dispatch|adapter/iu.test(name))).toBe(
      false,
    );
  });
});
