import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CanonicalMicrosStringSchema,
  CompositionAnalysisRequestV1Schema,
  CurrencyCodeSchema,
  INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
  MAX_AGGREGATE_COST_MICROS,
  MAX_COST_MICROS,
  PROVIDER_FREE_COMPOSITION_POLICY,
  ProviderFreeCompositionPolicySchema,
  StructuredJobErrorSchema,
  UsageMetricsSchema,
  WorkflowDefinitionV1Schema,
  WorkflowVersionContractSchema,
  calculateCommittedCostMicros,
  classifyStableErrorCode,
  computeWorkflowDefinitionSha256,
  createProviderFreeCompositionAnalysisFixturePort,
  createFixtureUsageIdentity,
  createFixtureUsageReservationIdentity,
  createStructuredJobError,
  decideErrorRetry,
  decideLeaseLossUsageRecovery,
  decideUsageFinalization,
  decideUsageReservation,
  deriveExternalIdempotencyKey,
  dispatchProviderFreeCapability,
  dispatchProviderFreeCompositionAnalysis,
  estimateProviderFreeCompositionAnalysis,
  formatMicros,
  materializeProviderFreeFixtureExecution,
  parseCapabilityCallContext,
  parseMicros,
  type UsageCostBoundaryRow,
  type WorkflowVersionContract,
} from '../src/index.js';

const originalExternalEnv = process.env['EXTERNAL_CALLS_ALLOWED'];

afterEach(() => {
  if (originalExternalEnv === undefined) delete process.env['EXTERNAL_CALLS_ALLOWED'];
  else process.env['EXTERNAL_CALLS_ALLOWED'] = originalExternalEnv;
});

const replayUnsafeWorkflow = (): WorkflowVersionContract => {
  const definition = WorkflowDefinitionV1Schema.parse({
    ...INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definition,
    steps: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definition.steps.map((step) =>
      step.stepKey === 'fixture-analysis' ? { ...step, replaySafe: false } : step,
    ),
    outputs: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definition.outputs.map((output) =>
      output.producingStepKey === 'fixture-analysis' ? { ...output, replaySafe: false } : output,
    ),
  });
  return WorkflowVersionContractSchema.parse({
    ...INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
    definition,
    definitionSha256: computeWorkflowDefinitionSha256(definition),
  });
};

const workspaceId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const attemptId = '33333333-3333-4333-8333-333333333333';
const usageId = '44444444-4444-4444-8444-444444444444';
const retryBase = {
  workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
  stepKey: 'fixture-analysis',
  jobId,
  logicalCallNumber: 1,
  externalIdempotencyKey: null,
  currentAttemptNumber: 1,
  finishedAtMs: 10_000,
  jobDeadlineAtMs: 600_000,
  indeterminateProviderCall: false,
} as const;

const authority = (overrides: Record<string, unknown> = {}) => ({
  workspaceId,
  jobId,
  attemptId,
  leaseToken: '11111111-1111-4111-8111-111111111111',
  presentedAttemptId: attemptId,
  presentedLeaseToken: '11111111-1111-4111-8111-111111111111',
  jobState: 'running',
  attemptState: 'running',
  cancelRequestedAtMs: null,
  nowMs: 10_000,
  leaseExpiresAtMs: 40_000,
  attemptDeadlineAtMs: 120_000,
  jobDeadlineAtMs: 600_000,
  ...overrides,
});

const usageRow = (
  index: number,
  values: { readonly estimated?: string; readonly actual?: string | null } = {},
): UsageCostBoundaryRow => ({
  workspaceId: workspaceId as UsageCostBoundaryRow['workspaceId'],
  jobId: jobId as UsageCostBoundaryRow['jobId'],
  attemptId: attemptId as UsageCostBoundaryRow['attemptId'],
  callKey: `call.${String(index).padStart(2, '0')}` as UsageCostBoundaryRow['callKey'],
  estimatedCostMicros: (values.estimated ?? '0') as UsageCostBoundaryRow['estimatedCostMicros'],
  actualCostMicros: (values.actual ?? null) as UsageCostBoundaryRow['actualCostMicros'],
});

const zeroMetrics = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  inputPixels: 0,
  outputImages: 0,
  computeMs: 0,
} as const;

const reservation = (overrides: Record<string, unknown> = {}) =>
  decideUsageReservation({
    authority: authority(),
    callKey: 'call.next',
    requestSha256: 'a'.repeat(64),
    identity: {
      capability: 'fixture_replay',
      providerKey: 'fixture',
      modelKey: 'phase1a-fixture-v1',
      workflowVersionId: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
      external: false,
    },
    existingUsage: null,
    providerCallCount: 0,
    usageRows: [],
    jobCurrency: 'USD',
    estimateCurrency: 'USD',
    budgetLimitMicros: '0',
    nextEstimateMicros: '0',
    ...overrides,
  } as unknown as Parameters<typeof decideUsageReservation>[0]);

describe('closed structured error taxonomy and replay policy', () => {
  it.each([
    ['COMMAND_INVALID', 'validation', false],
    ['COST_VALUE_INVALID', 'validation', false],
    ['COST_CURRENCY_MISMATCH', 'validation', false],
    ['PROJECT_OR_ASSET_NOT_FOUND', 'not_found', false],
    ['IDEMPOTENCY_KEY_REUSED', 'conflict', false],
    ['CHECKPOINT_IDENTITY_MISMATCH', 'internal', false],
    ['CAPABILITY_POLICY_REJECTED', 'policy_rejected', false],
    ['EXTERNAL_CALLS_DISABLED', 'policy_rejected', false],
    ['EXTERNAL_USAGE_REJECTED', 'policy_rejected', false],
    ['PROVIDER_RATE_LIMITED', 'provider_transient', true],
    ['PROVIDER_TEMPORARILY_UNAVAILABLE', 'provider_transient', true],
    ['PROVIDER_RESULT_INDETERMINATE', 'provider_transient', true],
    ['PROVIDER_REQUEST_REJECTED', 'provider_permanent', false],
    ['CAPABILITY_TIMEOUT', 'timeout', true],
    ['ATTEMPT_TIMEOUT', 'timeout', true],
    ['WORKER_LOST', 'worker_lost', true],
    ['BUDGET_LIMIT_EXCEEDED', 'budget_stop', false],
    ['PROVIDER_CALL_LIMIT_EXCEEDED', 'budget_stop', false],
    ['CANCELLED', 'cancelled', false],
    ['INTERNAL_INVARIANT', 'internal', false],
    ['INTERNAL_TRANSIENT', 'internal', true],
  ] as const)('classifies %s as %s/retryable=%s', (code, category, retryable) => {
    expect(classifyStableErrorCode(code)).toEqual({ code, category, retryable });
    expect(createStructuredJobError(code, 'Synthetic classified failure.')).toEqual({
      code,
      category,
      retryable,
      message: 'Synthetic classified failure.',
    });
  });

  it('rejects unknown codes, lowercase/unbounded codes, retryable spoofing, and unsafe messages', () => {
    expect(() => classifyStableErrorCode('UNKNOWN_FAILURE')).toThrow(/Unknown/);
    for (const invalid of [
      {
        code: 'PROVIDER_REQUEST_REJECTED',
        category: 'provider_permanent',
        retryable: true,
        message: 'Spoofed retry.',
      },
      {
        code: 'provider_bad',
        category: 'internal',
        retryable: false,
        message: 'Bad code.',
      },
      {
        code: `A${'B'.repeat(80)}`,
        category: 'internal',
        retryable: false,
        message: 'Long code.',
      },
      {
        code: 'INTERNAL_INVARIANT',
        category: 'internal',
        retryable: false,
        message: `A${'b'.repeat(500)}`,
      },
      {
        code: 'INTERNAL_INVARIANT',
        category: 'internal',
        retryable: false,
        message: 'Unsafe\nstack.',
      },
      {
        code: 'INTERNAL_INVARIANT',
        category: 'internal',
        retryable: false,
        message: 'Visit https://credential.example.',
      },
      {
        code: 'INTERNAL_INVARIANT',
        category: 'internal',
        retryable: false,
        message: 'Cafe\u0301 failure.',
      },
    ]) {
      expect(StructuredJobErrorSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it.each([
    ['PROVIDER_RATE_LIMITED', 'failed'],
    ['CAPABILITY_TIMEOUT', 'timed_out'],
    ['WORKER_LOST', 'abandoned'],
    ['INTERNAL_TRANSIENT', 'failed'],
  ] as const)('retries replay-safe %s with the exact attempt mapping', (code, attemptState) => {
    expect(
      decideErrorRetry({
        ...retryBase,
        error: createStructuredJobError(code, 'Synthetic retryable failure.'),
      }),
    ).toMatchObject({
      kind: 'retry',
      jobState: 'retry_wait',
      attemptState,
      nextAttemptNumber: 2,
      delayMs: 1_000,
      nextAttemptAtMs: 11_000,
    });
  });

  it.each([
    'PROVIDER_RATE_LIMITED',
    'CAPABILITY_TIMEOUT',
    'WORKER_LOST',
    'INTERNAL_TRANSIENT',
  ] as const)('fails retryable %s when the authoritative step is replay-unsafe', (code) => {
    expect(
      decideErrorRetry({
        ...retryBase,
        workflow: replayUnsafeWorkflow(),
        error: createStructuredJobError(code, 'Synthetic replay-unsafe failure.'),
      }),
    ).toMatchObject({ kind: 'terminal', jobState: 'failed', reason: 'step-not-replay-safe' });
  });

  it.each([
    ['COMMAND_INVALID', 'failed', 'failed'],
    ['PROVIDER_REQUEST_REJECTED', 'failed', 'failed'],
    ['INTERNAL_INVARIANT', 'failed', 'failed'],
    ['BUDGET_LIMIT_EXCEEDED', 'budget_stopped', 'budget_stopped'],
    ['CANCELLED', 'cancelled', 'cancelled'],
  ] as const)('makes %s terminal with job/attempt %s/%s', (code, jobState, attemptState) => {
    expect(
      decideErrorRetry({
        ...retryBase,
        error: createStructuredJobError(code, 'Synthetic permanent failure.'),
      }),
    ).toMatchObject({ kind: 'terminal', jobState, attemptState, reason: 'not-retryable' });
  });

  it('enforces attempt and job deadline ceilings after classification', () => {
    const error = createStructuredJobError('PROVIDER_RATE_LIMITED', 'Synthetic transient failure.');
    expect(decideErrorRetry({ ...retryBase, currentAttemptNumber: 3, error })).toMatchObject({
      kind: 'terminal',
      reason: 'attempts-exhausted',
    });
    expect(
      decideErrorRetry({ ...retryBase, finishedAtMs: 10_000, jobDeadlineAtMs: 11_000, error }),
    ).toMatchObject({ kind: 'terminal', reason: 'job-deadline-prevents-retry' });
    expect(decideErrorRetry({ ...retryBase, currentAttemptNumber: 2, error })).toMatchObject({
      kind: 'retry',
      nextAttemptNumber: 3,
      delayMs: 5_000,
    });
  });

  it('requires replay safety and the exact stable cross-attempt key for indeterminate calls', () => {
    const error = createStructuredJobError(
      'PROVIDER_RESULT_INDETERMINATE',
      'Provider result could not be determined.',
    );
    const keyInput = { jobId, stepKey: 'fixture-analysis', logicalCallNumber: 1 };
    const key = deriveExternalIdempotencyKey(keyInput);
    expect(
      deriveExternalIdempotencyKey({ ...keyInput, attemptId: 'attempt_one' } as typeof keyInput),
    ).toBe(key);
    expect(
      deriveExternalIdempotencyKey({ ...keyInput, attemptId: 'attempt_two' } as typeof keyInput),
    ).toBe(key);
    expect(
      decideErrorRetry({
        ...retryBase,
        error,
        externalIdempotencyKey: key,
        indeterminateProviderCall: true,
      }),
    ).toMatchObject({
      kind: 'retry',
      attemptState: 'failed',
      attemptErrorCode: 'PROVIDER_RESULT_INDETERMINATE',
    });
    expect(
      decideErrorRetry({
        ...retryBase,
        error,
        externalIdempotencyKey: '0'.repeat(64),
        indeterminateProviderCall: true,
      }),
    ).toMatchObject({ kind: 'terminal', reason: 'external-idempotency-unavailable' });
    expect(
      decideErrorRetry({
        ...retryBase,
        workflow: replayUnsafeWorkflow(),
        error,
        externalIdempotencyKey: key,
        indeterminateProviderCall: true,
      }),
    ).toMatchObject({ kind: 'terminal', reason: 'step-not-replay-safe' });
    expect(() => decideErrorRetry({ ...retryBase, error })).toThrow(/Indeterminate provider-call/);
  });

  it('separates a WORKER_LOST attempt from an indeterminate usage and job retry gate', () => {
    const workerLost = createStructuredJobError('WORKER_LOST', 'Worker lease expired.');
    const key = deriveExternalIdempotencyKey({
      jobId,
      stepKey: 'fixture-analysis',
      logicalCallNumber: 1,
    });
    expect(decideErrorRetry({ ...retryBase, error: workerLost })).toMatchObject({
      kind: 'retry',
      attemptState: 'abandoned',
      attemptErrorCode: 'WORKER_LOST',
    });
    expect(
      decideErrorRetry({
        ...retryBase,
        error: workerLost,
        externalIdempotencyKey: key,
        indeterminateProviderCall: true,
      }),
    ).toMatchObject({
      kind: 'retry',
      attemptState: 'abandoned',
      attemptErrorCode: 'WORKER_LOST',
    });
    expect(
      decideErrorRetry({
        ...retryBase,
        error: workerLost,
        indeterminateProviderCall: true,
      }),
    ).toMatchObject({
      kind: 'terminal',
      attemptState: 'abandoned',
      attemptErrorCode: 'WORKER_LOST',
      jobErrorCode: 'PROVIDER_RESULT_INDETERMINATE',
      reason: 'external-idempotency-unavailable',
    });
    expect(
      decideErrorRetry({
        ...retryBase,
        workflow: replayUnsafeWorkflow(),
        error: workerLost,
        externalIdempotencyKey: key,
        indeterminateProviderCall: true,
      }),
    ).toMatchObject({
      kind: 'terminal',
      attemptState: 'abandoned',
      attemptErrorCode: 'WORKER_LOST',
      jobErrorCode: 'PROVIDER_RESULT_INDETERMINATE',
      reason: 'step-not-replay-safe',
    });
  });
});

describe('exact bigint micros, usage lifecycle, and reservation rules', () => {
  it('accepts only canonical unsigned bounded decimal strings without Number conversion', () => {
    expect(parseMicros('0')).toBe(0n);
    expect(parseMicros(MAX_COST_MICROS.toString())).toBe(MAX_COST_MICROS);
    expect(formatMicros(MAX_COST_MICROS)).toBe('9000000000000000');
    for (const invalid of [
      '',
      '00',
      '01',
      '+1',
      '-1',
      ' 1',
      '1 ',
      '1.0',
      '1e3',
      '9000000000000001',
      '9'.repeat(100_000),
    ]) {
      expect(() => CanonicalMicrosStringSchema.safeParse(invalid)).not.toThrow();
      expect(CanonicalMicrosStringSchema.safeParse(invalid).success).toBe(false);
    }
    expect(() => formatMicros(-1n)).toThrow();
    expect(() => formatMicros(MAX_COST_MICROS + 1n)).toThrow();
  });

  it('checks exact committed aggregation, maximum, row bound, and actual-over-estimate', () => {
    const maximumRows = Array.from({ length: 64 }, (_, index) =>
      usageRow(index, { estimated: MAX_COST_MICROS.toString() }),
    );
    expect(calculateCommittedCostMicros(maximumRows)).toBe(MAX_AGGREGATE_COST_MICROS);
    expect(() => calculateCommittedCostMicros([...maximumRows, usageRow(64)])).toThrow();
    expect(calculateCommittedCostMicros([usageRow(0, { estimated: '1', actual: '9' })])).toBe(9n);
  });

  it('accepts uppercase three-character currency only', () => {
    expect(CurrencyCodeSchema.parse('USD')).toBe('USD');
    for (const invalid of ['usd', 'US', 'USDD', 'U1D', ' EUR']) {
      expect(CurrencyCodeSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('permits call 64, stops call 65, and permits budget equality but stops +1', () => {
    const rows63 = Array.from({ length: 63 }, (_, index) => usageRow(index));
    expect(reservation({ providerCallCount: 63, usageRows: rows63 })).toMatchObject({
      kind: 'reserve',
      nextProviderCallCount: 64,
      dispatch: 'after-reservation-commit',
    });
    const rows64 = [...rows63, usageRow(63)];
    expect(reservation({ providerCallCount: 64, usageRows: rows64 })).toMatchObject({
      kind: 'budget-stopped',
      code: 'PROVIDER_CALL_LIMIT_EXCEEDED',
      jobState: 'budget_stopped',
      attemptState: 'budget_stopped',
      dispatch: false,
    });
    const five = [usageRow(0, { estimated: '5' })];
    expect(
      reservation({
        providerCallCount: 1,
        usageRows: five,
        budgetLimitMicros: '10',
        nextEstimateMicros: '5',
      }),
    ).toMatchObject({ kind: 'reserve', committedCostMicros: 5n, projectedCostMicros: 10n });
    expect(
      reservation({
        providerCallCount: 1,
        usageRows: five,
        budgetLimitMicros: '9',
        nextEstimateMicros: '5',
      }),
    ).toMatchObject({ kind: 'budget-stopped', code: 'BUDGET_LIMIT_EXCEEDED', dispatch: false });
  });

  it('uses actual-over-estimate cost unclipped for every subsequent reservation', () => {
    const rows = [usageRow(0, { estimated: '1', actual: '8' })];
    expect(
      reservation({
        providerCallCount: 1,
        usageRows: rows,
        budgetLimitMicros: '10',
        nextEstimateMicros: '3',
      }),
    ).toMatchObject({
      kind: 'budget-stopped',
      code: 'BUDGET_LIMIT_EXCEEDED',
      committedCostMicros: 8n,
    });
  });

  it('rejects currency mismatch, stale authority, cancellation, deadline equality, and duplicate rows pre-dispatch', () => {
    expect(reservation({ estimateCurrency: 'EUR' })).toEqual({
      kind: 'rejected',
      code: 'COST_CURRENCY_MISMATCH',
      incrementProviderCallCount: false,
      createUsageRow: false,
      dispatch: false,
    });
    for (const invalidAuthority of [
      authority({ presentedLeaseToken: '22222222-2222-4222-8222-222222222222' }),
      authority({ presentedAttemptId: 'generation_attempt_9999' }),
      { ...authority(), cancelRequestedAtMs: 9_999 },
      authority({ nowMs: 40_000 }),
      authority({ nowMs: 120_000, leaseExpiresAtMs: 130_000 }),
      authority({ nowMs: 600_000, leaseExpiresAtMs: 700_000, attemptDeadlineAtMs: 700_000 }),
    ]) {
      expect(() => reservation({ authority: invalidAuthority })).toThrow();
    }
    const duplicate = usageRow(0);
    expect(() => reservation({ providerCallCount: 2, usageRows: [duplicate, duplicate] })).toThrow(
      /unique/,
    );
  });

  it('returns any scoped duplicate including started without increment or redispatch', () => {
    expect(
      reservation({
        existingUsage: {
          usageId,
          workspaceId,
          jobId,
          attemptId,
          callKey: 'call.next',
          capability: 'fixture_replay',
          providerKey: 'fixture',
          modelKey: 'phase1a-fixture-v1',
          workflowVersionId: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
          external: false,
          requestSha256: 'a'.repeat(64),
          estimatedCostMicros: '0',
          currency: 'USD',
          status: 'started',
        },
      }),
    ).toMatchObject({
      kind: 'duplicate',
      existingStatus: 'started',
      existingUsage: { usageId, status: 'started' },
      incrementProviderCallCount: false,
      createUsageRow: false,
      dispatch: false,
    });
    expect(() =>
      reservation({
        existingUsage: {
          usageId,
          workspaceId: '11111111-1111-4111-8111-111111111112',
          jobId,
          attemptId,
          callKey: 'call.next',
          capability: 'fixture_replay',
          providerKey: 'fixture',
          modelKey: 'phase1a-fixture-v1',
          workflowVersionId: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
          external: false,
          requestSha256: 'a'.repeat(64),
          estimatedCostMicros: '0',
          currency: 'USD',
          status: 'started',
        },
      }),
    ).toThrow(/scope/);
  });

  it('marks started usage indeterminate after lease loss before considering replay', () => {
    expect(decideLeaseLossUsageRecovery({ callKey: 'call.one', status: 'started' })).toEqual({
      kind: 'finalize-indeterminate',
      callKey: 'call.one',
      status: 'indeterminate',
      errorCode: 'PROVIDER_RESULT_INDETERMINATE',
      redispatch: false,
    });
    expect(decideLeaseLossUsageRecovery({ callKey: 'call.one', status: 'succeeded' })).toEqual({
      kind: 'already-final',
      callKey: 'call.one',
      status: 'succeeded',
      redispatch: false,
    });
  });

  it('finalizes started usage exactly once with coherent metrics, response, cost, and error', () => {
    const success = decideUsageFinalization({
      currentStatus: 'started',
      targetStatus: 'succeeded',
      responseSha256: 'b'.repeat(64),
      usageMetrics: { ...zeroMetrics, calls: 1 },
      actualCostMicros: MAX_COST_MICROS.toString(),
      error: null,
    });
    expect(success).toMatchObject({
      kind: 'finalize',
      finalization: { status: 'succeeded', actualCostMicros: MAX_COST_MICROS.toString() },
    });
    const failure = createStructuredJobError(
      'PROVIDER_REQUEST_REJECTED',
      'Synthetic provider rejection.',
    );
    expect(
      decideUsageFinalization({
        currentStatus: 'started',
        targetStatus: 'failed',
        responseSha256: null,
        usageMetrics: zeroMetrics,
        actualCostMicros: null,
        error: failure,
      }),
    ).toMatchObject({ kind: 'finalize', finalization: { status: 'failed', error: failure } });
    expect(
      decideUsageFinalization({
        currentStatus: 'failed',
        targetStatus: 'succeeded',
        responseSha256: 'b'.repeat(64),
        usageMetrics: zeroMetrics,
        actualCostMicros: '0',
        error: null,
      }),
    ).toEqual({ kind: 'already-final', status: 'failed', rewrite: false });
    expect(() =>
      decideUsageFinalization({
        currentStatus: 'started',
        targetStatus: 'succeeded',
        responseSha256: null,
        usageMetrics: zeroMetrics,
        actualCostMicros: '0',
        error: null,
      }),
    ).toThrow(/response digest/);
    expect(() =>
      decideUsageFinalization({
        currentStatus: 'started',
        targetStatus: 'indeterminate',
        responseSha256: null,
        usageMetrics: zeroMetrics,
        actualCostMicros: '0',
        error: null,
      }),
    ).toThrow(/exact indeterminate error/);
    const indeterminate = createStructuredJobError(
      'PROVIDER_RESULT_INDETERMINATE',
      'Provider result could not be trusted.',
    );
    expect(
      decideUsageFinalization({
        currentStatus: 'started',
        targetStatus: 'indeterminate',
        responseSha256: null,
        usageMetrics: zeroMetrics,
        actualCostMicros: null,
        error: indeterminate,
      }),
    ).toMatchObject({ kind: 'finalize', finalization: { status: 'indeterminate' } });
    for (const invalid of [
      {
        targetStatus: 'indeterminate' as const,
        responseSha256: 'b'.repeat(64),
        error: indeterminate,
      },
      { targetStatus: 'indeterminate' as const, responseSha256: null, error: failure },
      {
        targetStatus: 'failed' as const,
        responseSha256: null,
        error: createStructuredJobError('CANCELLED', 'Provider call was cancelled.'),
      },
      {
        targetStatus: 'failed' as const,
        responseSha256: null,
        error: createStructuredJobError('BUDGET_LIMIT_EXCEEDED', 'Budget was exhausted.'),
      },
    ]) {
      expect(() =>
        decideUsageFinalization({
          currentStatus: 'started',
          usageMetrics: zeroMetrics,
          actualCostMicros: null,
          ...invalid,
        }),
      ).toThrow();
    }
    for (const metrics of [
      { ...zeroMetrics, calls: 9_000_000_000_000_000 },
      { ...zeroMetrics, calls: 9_000_000_000_000_001 },
      { ...zeroMetrics, calls: 0.5 },
      { ...zeroMetrics, calls: Number.MAX_SAFE_INTEGER + 1 },
      { ...zeroMetrics, extra: 0 },
    ]) {
      expect(UsageMetricsSchema.safeParse(metrics).success).toBe(
        metrics.calls === 9_000_000_000_000_000,
      );
    }
  });
});

describe('hard provider-free composition', () => {
  const descriptor = () => ({
    adapter: {
      capability: 'fixture_replay' as const,
      providerKey: 'fixture' as const,
      modelKey: 'phase1a-fixture-v1' as const,
      external: false as const,
    },
    usage: createFixtureUsageReservationIdentity(
      INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
      'USD',
    ),
  });

  const analysisRequest = CompositionAnalysisRequestV1Schema.parse({
    sourceAsset: {
      assetId: 'asset_source_0001',
      assetVersionId: 'asset_version_source_0001',
      sha256: '1'.repeat(64),
      mediaType: 'image/png' as const,
      byteSize: 100,
      pixelWidth: 300,
      pixelHeight: 250,
    },
    maxParts: 1,
    includeBackground: false,
  });
  const analysisResult = {
    kind: 'composition_proposal' as const,
    proposalVersion: 1 as const,
    sourceAssetSha256: '1'.repeat(64),
    parts: [
      {
        partKey: 'part.body',
        label: 'Body',
        role: 'subject' as const,
        bounds: { xBps: 1_000, yBps: 1_000, widthBps: 8_000, heightBps: 8_000 },
      },
    ],
  } as const;
  const callContext = (cancellation: { readonly cancelled: boolean; throwIfCancelled(): void }) =>
    parseCapabilityCallContext({
      deadlineAtMs: 60_000,
      externalIdempotencyKey: 'a'.repeat(64),
      cancellation,
    });
  const activeCancellation = Object.freeze({
    cancelled: false,
    throwIfCancelled(): void {},
  });

  it('pins exact fixture identity, six metrics, one call, zero cost, and no credits', () => {
    const fixture = createFixtureUsageIdentity('USD');
    expect(fixture).toEqual({
      capability: 'fixture_replay',
      providerKey: 'fixture',
      modelKey: 'phase1a-fixture-v1',
      external: false,
      usageMetrics: zeroMetrics.calls === 0 ? { ...zeroMetrics, calls: 1 } : zeroMetrics,
      estimatedCostMicros: '0',
      actualCostMicros: '0',
      currency: 'USD',
    });
    expect(fixture).not.toHaveProperty('credits');
  });

  it('cannot be enabled by environment and dispatches only the exact fixture descriptor', async () => {
    process.env['EXTERNAL_CALLS_ALLOWED'] = 'true';
    expect(PROVIDER_FREE_COMPOSITION_POLICY.externalCallsAllowed).toBe(false);
    const execution = materializeProviderFreeFixtureExecution({
      descriptor: descriptor(),
      result: { value: 'fixture-result' },
    });
    await expect(
      dispatchProviderFreeCapability({
        policy: PROVIDER_FREE_COMPOSITION_POLICY,
        execution,
      }),
    ).resolves.toEqual({ value: 'fixture-result' });
  });

  it('consumes a bounded data-only failure/success script without consuming on estimate', async () => {
    const harness = createProviderFreeCompositionAnalysisFixturePort({
      initialNowMs: 1_000,
      currency: 'USD',
      fixtures: [
        {
          request: analysisRequest,
          outcomes: [
            { kind: 'failure', code: 'PROVIDER_TEMPORARILY_UNAVAILABLE' },
            { kind: 'success', result: analysisResult },
          ],
        },
      ],
    });
    await expect(
      estimateProviderFreeCompositionAnalysis({
        policy: PROVIDER_FREE_COMPOSITION_POLICY,
        port: harness.port,
        request: analysisRequest,
      }),
    ).resolves.toEqual({ micros: 0n, currency: 'USD' });
    await expect(
      estimateProviderFreeCompositionAnalysis({
        policy: PROVIDER_FREE_COMPOSITION_POLICY,
        port: harness.port,
        request: analysisRequest,
      }),
    ).resolves.toEqual({ micros: 0n, currency: 'USD' });
    await expect(
      dispatchProviderFreeCompositionAnalysis({
        policy: PROVIDER_FREE_COMPOSITION_POLICY,
        port: harness.port,
        descriptor: descriptor(),
        request: analysisRequest,
        context: callContext(activeCancellation),
      }),
    ).rejects.toMatchObject({
      structuredError: { code: 'PROVIDER_TEMPORARILY_UNAVAILABLE' },
    });
    await expect(
      dispatchProviderFreeCompositionAnalysis({
        policy: PROVIDER_FREE_COMPOSITION_POLICY,
        port: harness.port,
        descriptor: descriptor(),
        request: analysisRequest,
        context: callContext(activeCancellation),
      }),
    ).resolves.toEqual(analysisResult);
    await expect(
      dispatchProviderFreeCompositionAnalysis({
        policy: PROVIDER_FREE_COMPOSITION_POLICY,
        port: harness.port,
        descriptor: descriptor(),
        request: analysisRequest,
        context: callContext(activeCancellation),
      }),
    ).rejects.toMatchObject({ structuredError: { code: 'EXTERNAL_USAGE_REJECTED' } });
  });

  it('holds analysis inside the trusted factory for deterministic cancellation and timeout races', async () => {
    let cancelled = false;
    const cancellation = {
      get cancelled() {
        return cancelled;
      },
      throwIfCancelled(): void {
        if (cancelled) throw new Error('cancelled-by-test-signal');
      },
    };
    const cancelledHarness = createProviderFreeCompositionAnalysisFixturePort({
      initialNowMs: 1_000,
      currency: 'USD',
      fixtures: [
        {
          request: analysisRequest,
          outcomes: [{ kind: 'held-success', gateKey: 'cancel-gate', result: analysisResult }],
        },
      ],
    });
    const cancelledCall = dispatchProviderFreeCompositionAnalysis({
      policy: PROVIDER_FREE_COMPOSITION_POLICY,
      port: cancelledHarness.port,
      descriptor: descriptor(),
      request: analysisRequest,
      context: callContext(cancellation),
    });
    await vi.waitFor(() =>
      expect(cancelledHarness.controller.pendingGateKeys()).toEqual(['cancel-gate']),
    );
    cancelled = true;
    cancelledHarness.controller.release('cancel-gate');
    await expect(cancelledCall).rejects.toThrow('cancelled-by-test-signal');

    const timeoutHarness = createProviderFreeCompositionAnalysisFixturePort({
      initialNowMs: 1_000,
      currency: 'USD',
      fixtures: [
        {
          request: analysisRequest,
          outcomes: [{ kind: 'held-success', gateKey: 'timeout-gate', result: analysisResult }],
        },
      ],
    });
    const timedCall = dispatchProviderFreeCompositionAnalysis({
      policy: PROVIDER_FREE_COMPOSITION_POLICY,
      port: timeoutHarness.port,
      descriptor: descriptor(),
      request: analysisRequest,
      context: callContext(activeCancellation),
    });
    await vi.waitFor(() =>
      expect(timeoutHarness.controller.pendingGateKeys()).toEqual(['timeout-gate']),
    );
    timeoutHarness.controller.advanceTo(60_000);
    timeoutHarness.controller.release('timeout-gate');
    await expect(timedCall).rejects.toMatchObject({
      structuredError: { code: 'CAPABILITY_TIMEOUT' },
    });
  });

  it('rejects malformed scripts, duplicate gates, untrusted ports, and external enablement', async () => {
    const validFixture = {
      request: analysisRequest,
      outcomes: [{ kind: 'success', result: analysisResult }],
    } as const;
    for (const invalid of [
      { initialNowMs: 1_000, currency: 'USD', fixtures: [{ ...validFixture, outcomes: [] }] },
      {
        initialNowMs: 1_000,
        currency: 'USD',
        fixtures: [
          {
            ...validFixture,
            outcomes: Array.from({ length: 4 }, () => ({
              kind: 'success',
              result: analysisResult,
            })),
          },
        ],
      },
      {
        initialNowMs: 1_000,
        currency: 'USD',
        fixtures: [
          {
            ...validFixture,
            outcomes: [{ kind: 'failure', code: 'ARBITRARY_FAILURE' }],
          },
        ],
      },
      {
        initialNowMs: 1_000,
        currency: 'USD',
        fixtures: [
          {
            ...validFixture,
            outcomes: [
              { kind: 'success', result: { ...analysisResult, sourceAssetSha256: '2'.repeat(64) } },
            ],
          },
        ],
      },
      {
        initialNowMs: 1_000,
        currency: 'USD',
        fixtures: [
          {
            ...validFixture,
            outcomes: [
              { kind: 'held-success', gateKey: 'same-gate', result: analysisResult },
              { kind: 'held-success', gateKey: 'same-gate', result: analysisResult },
            ],
          },
        ],
      },
      { initialNowMs: 1_000, currency: 'USD', fixtures: [validFixture], callback: () => undefined },
    ]) {
      expect(() => createProviderFreeCompositionAnalysisFixturePort(invalid)).toThrow();
    }

    let invoked = false;
    const forgedPort = {
      kind: 'trusted-provider-free-composition-analysis-fixtures',
      async estimate() {
        invoked = true;
        return { micros: 0n, currency: 'USD' };
      },
      async analyze() {
        invoked = true;
        return analysisResult;
      },
    };
    await expect(
      estimateProviderFreeCompositionAnalysis({
        policy: PROVIDER_FREE_COMPOSITION_POLICY,
        port: forgedPort as never,
        request: analysisRequest,
      }),
    ).rejects.toMatchObject({ structuredError: { code: 'EXTERNAL_USAGE_REJECTED' } });
    expect(invoked).toBe(false);
    await expect(
      estimateProviderFreeCompositionAnalysis({
        policy: { ...PROVIDER_FREE_COMPOSITION_POLICY, externalCallsAllowed: true } as never,
        port: forgedPort as never,
        request: analysisRequest,
      }),
    ).rejects.toMatchObject({ structuredError: { code: 'EXTERNAL_CALLS_DISABLED' } });
  });

  it.each([
    { adapter: { external: true } },
    { adapter: { external: 0 } },
    { usage: { external: true } },
    { usage: { providerKey: 'other' } },
    { usage: { usageMetrics: { ...zeroMetrics, calls: 2 } } },
  ])(
    'rejects external, mismatched, or falsey fixture identity before materialization %#',
    (mutation) => {
      const base = descriptor();
      const mutated = {
        ...base,
        adapter: {
          ...base.adapter,
          ...('adapter' in mutation ? mutation.adapter : {}),
        },
        usage: {
          ...base.usage,
          ...('usage' in mutation ? mutation.usage : {}),
        },
      };
      expect(() =>
        materializeProviderFreeFixtureExecution({ descriptor: mutated as never, result: 'unused' }),
      ).toThrow();
    },
  );

  it.each([
    { ...PROVIDER_FREE_COMPOSITION_POLICY, externalCallsAllowed: true },
    { ...PROVIDER_FREE_COMPOSITION_POLICY, unknown: false },
  ])('rejects invalid policy even for a trusted materialized execution %#', async (policy) => {
    const execution = materializeProviderFreeFixtureExecution({
      descriptor: descriptor(),
      result: 'fixture-result',
    });
    await expect(
      dispatchProviderFreeCapability({ policy: policy as never, execution }),
    ).rejects.toThrow();
    expect(ProviderFreeCompositionPolicySchema.safeParse(policy).success).toBe(false);
  });

  it('rejects a structurally forged executor and never accepts an executable callback result', async () => {
    const forged = {
      kind: 'trusted-provider-free-fixture-execution',
      descriptor: descriptor(),
      resultType: 'materialized-clone',
    };
    await expect(
      dispatchProviderFreeCapability({
        policy: PROVIDER_FREE_COMPOSITION_POLICY,
        execution: forged as never,
      }),
    ).rejects.toMatchObject({
      structuredError: { code: 'EXTERNAL_USAGE_REJECTED' },
    });
    expect(() =>
      materializeProviderFreeFixtureExecution({
        descriptor: descriptor(),
        result: () => 'arbitrary-dispatch',
      }),
    ).toThrow(/materialized cloneable data/);
  });
});
