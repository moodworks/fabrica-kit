import { z } from 'zod';

import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { StructuredJobErrorSchema, type StructuredJobError } from './error-policy.js';
import { CapabilityRequestSha256Schema, type CapabilityRequestSha256 } from './request-digests.js';
import { EpochMillisecondsSchema } from './timing.js';
import {
  CallKeySchema,
  CurrencyCodeSchema,
  GenerationAttemptIdSchema,
  GenerationJobIdSchema,
  LeaseTokenSchema,
  ModelKeySchema,
  PersistedWorkflowVersionIdSchema,
  PersistedWorkspaceIdSchema,
  ProviderKeySchema,
  ProviderUsageIdSchema,
} from './syntax.js';

export const MAX_COST_MICROS = 9_000_000_000_000_000n;
export const MAX_AGGREGATE_COST_MICROS = 576_000_000_000_000_000n;
export const MAX_PROVIDER_CALLS = 64;

const canonicalUnsignedDecimalPattern = /^(?:0|[1-9][0-9]*)$/;

export const CanonicalMicrosStringSchema = z
  .string()
  .max(16)
  .regex(canonicalUnsignedDecimalPattern)
  .superRefine((value, context) => {
    if (value.length > 16 || !canonicalUnsignedDecimalPattern.test(value)) return;
    if (BigInt(value) > MAX_COST_MICROS) {
      context.addIssue({ code: 'custom', message: 'Micros value exceeds the per-row/job bound.' });
    }
  })
  .brand<'CanonicalMicrosString'>();

export type CanonicalMicrosString = z.infer<typeof CanonicalMicrosStringSchema>;

export const parseMicros = (input: unknown): bigint =>
  BigInt(CanonicalMicrosStringSchema.parse(input));

export const formatMicros = (input: bigint): CanonicalMicrosString => {
  if (typeof input !== 'bigint' || input < 0n || input > MAX_COST_MICROS) {
    throw new RangeError('Micros bigint is outside the per-row/job bound.');
  }
  return CanonicalMicrosStringSchema.parse(input.toString(10));
};

export const UsageCostBoundaryRowSchema = z
  .strictObject({
    workspaceId: PersistedWorkspaceIdSchema,
    jobId: GenerationJobIdSchema,
    attemptId: GenerationAttemptIdSchema,
    callKey: CallKeySchema,
    estimatedCostMicros: CanonicalMicrosStringSchema,
    actualCostMicros: CanonicalMicrosStringSchema.nullable(),
  })
  .readonly();

export type UsageCostBoundaryRow = z.infer<typeof UsageCostBoundaryRowSchema>;

export const calculateCommittedCostMicros = (
  rowsInput: readonly UsageCostBoundaryRow[],
): bigint => {
  const rows = z.array(UsageCostBoundaryRowSchema).max(MAX_PROVIDER_CALLS).parse(rowsInput);
  let total = 0n;
  for (const row of rows) {
    const committed = parseMicros(row.actualCostMicros ?? row.estimatedCostMicros);
    total += committed;
    if (total > MAX_AGGREGATE_COST_MICROS) {
      throw new RangeError('Committed cost exceeds the checked aggregate bound.');
    }
  }
  return total;
};

export const UsageMetricsSchema = z
  .strictObject({
    calls: z.int().min(0).max(9_000_000_000_000_000),
    inputTokens: z.int().min(0).max(9_000_000_000_000_000),
    outputTokens: z.int().min(0).max(9_000_000_000_000_000),
    inputPixels: z.int().min(0).max(9_000_000_000_000_000),
    outputImages: z.int().min(0).max(9_000_000_000_000_000),
    computeMs: z.int().min(0).max(9_000_000_000_000_000),
  })
  .readonly();

export type UsageMetrics = z.infer<typeof UsageMetricsSchema>;

export const ProviderUsageStatusSchema = z.enum([
  'started',
  'succeeded',
  'failed',
  'indeterminate',
]);

export type ProviderUsageStatus = z.infer<typeof ProviderUsageStatusSchema>;

export const ProviderCapabilitySchema = z.enum([
  'vision_analysis',
  'image_segmentation',
  'image_inpainting',
  'fixture_replay',
]);

export const ProviderCallIdentitySchema = z
  .strictObject({
    capability: ProviderCapabilitySchema,
    providerKey: ProviderKeySchema,
    modelKey: ModelKeySchema,
    workflowVersionId: PersistedWorkflowVersionIdSchema,
    external: z.boolean(),
  })
  .readonly();

export type ProviderCallIdentity = z.infer<typeof ProviderCallIdentitySchema>;

export const ProviderUsageReservationIdentitySchema = z
  .strictObject({
    capability: ProviderCapabilitySchema,
    providerKey: ProviderKeySchema,
    modelKey: ModelKeySchema,
    workflowVersionId: PersistedWorkflowVersionIdSchema,
    external: z.boolean(),
    estimatedCostMicros: CanonicalMicrosStringSchema,
    currency: CurrencyCodeSchema,
  })
  .readonly();

export type ProviderUsageReservationIdentity = z.infer<
  typeof ProviderUsageReservationIdentitySchema
>;

export const ExistingUsageIdentitySchema = z
  .strictObject({
    usageId: ProviderUsageIdSchema,
    workspaceId: PersistedWorkspaceIdSchema,
    jobId: GenerationJobIdSchema,
    attemptId: GenerationAttemptIdSchema,
    callKey: CallKeySchema,
    capability: ProviderCapabilitySchema,
    providerKey: ProviderKeySchema,
    modelKey: ModelKeySchema,
    workflowVersionId: PersistedWorkflowVersionIdSchema,
    external: z.boolean(),
    requestSha256: CapabilityRequestSha256Schema,
    estimatedCostMicros: CanonicalMicrosStringSchema,
    currency: CurrencyCodeSchema,
    status: ProviderUsageStatusSchema,
  })
  .readonly();

export type ExistingUsageIdentity = z.infer<typeof ExistingUsageIdentitySchema>;

export const StartedUsageFinalizationAuthoritySchema = z
  .strictObject({
    usageId: ProviderUsageIdSchema,
    workspaceId: PersistedWorkspaceIdSchema,
    jobId: GenerationJobIdSchema,
    attemptId: GenerationAttemptIdSchema,
    callKey: CallKeySchema,
    capability: ProviderCapabilitySchema,
    providerKey: ProviderKeySchema,
    modelKey: ModelKeySchema,
    workflowVersionId: PersistedWorkflowVersionIdSchema,
    external: z.boolean(),
    requestSha256: CapabilityRequestSha256Schema,
    estimatedCostMicros: CanonicalMicrosStringSchema,
    currency: CurrencyCodeSchema,
    expectedStatus: z.literal('started'),
  })
  .readonly();

export type StartedUsageFinalizationAuthority = z.infer<
  typeof StartedUsageFinalizationAuthoritySchema
>;

export const UsageReservationAuthoritySchema = z
  .strictObject({
    workspaceId: PersistedWorkspaceIdSchema,
    jobId: GenerationJobIdSchema,
    attemptId: GenerationAttemptIdSchema,
    leaseToken: LeaseTokenSchema,
    presentedAttemptId: GenerationAttemptIdSchema,
    presentedLeaseToken: LeaseTokenSchema,
    jobState: z.literal('running'),
    attemptState: z.literal('running'),
    cancelRequestedAtMs: z.null(),
    nowMs: EpochMillisecondsSchema,
    leaseExpiresAtMs: EpochMillisecondsSchema,
    attemptDeadlineAtMs: EpochMillisecondsSchema,
    jobDeadlineAtMs: EpochMillisecondsSchema,
  })
  .superRefine((authority, context) => {
    if (
      authority.attemptId !== authority.presentedAttemptId ||
      authority.leaseToken !== authority.presentedLeaseToken ||
      authority.nowMs >= authority.leaseExpiresAtMs ||
      authority.nowMs >= authority.attemptDeadlineAtMs ||
      authority.nowMs >= authority.jobDeadlineAtMs
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Usage reservation requires a live authoritative attempt, lease, and deadline.',
      });
    }
  })
  .readonly();

export type UsageReservationAuthority = z.infer<typeof UsageReservationAuthoritySchema>;

export type UsageReservationDecision =
  | {
      readonly kind: 'duplicate';
      readonly existingStatus: ProviderUsageStatus;
      readonly existingUsage: ExistingUsageIdentity;
      readonly incrementProviderCallCount: false;
      readonly createUsageRow: false;
      readonly dispatch: false;
    }
  | {
      readonly kind: 'rejected';
      readonly code: 'COST_CURRENCY_MISMATCH';
      readonly incrementProviderCallCount: false;
      readonly createUsageRow: false;
      readonly dispatch: false;
    }
  | {
      readonly kind: 'budget-stopped';
      readonly code: 'PROVIDER_CALL_LIMIT_EXCEEDED' | 'BUDGET_LIMIT_EXCEEDED';
      readonly jobState: 'budget_stopped';
      readonly attemptState: 'budget_stopped';
      readonly incrementProviderCallCount: false;
      readonly createUsageRow: false;
      readonly dispatch: false;
      readonly committedCostMicros: bigint;
    }
  | {
      readonly kind: 'reserve';
      readonly nextProviderCallCount: number;
      readonly incrementProviderCallCount: true;
      readonly createUsageRow: true;
      readonly dispatch: 'after-reservation-commit';
      readonly committedCostMicros: bigint;
      readonly projectedCostMicros: bigint;
    };

export const decideUsageReservation = (input: {
  readonly authority: UsageReservationAuthority;
  readonly callKey: string;
  readonly requestSha256: CapabilityRequestSha256;
  readonly identity: ProviderCallIdentity;
  readonly existingUsage: ExistingUsageIdentity | null;
  readonly providerCallCount: number;
  readonly usageRows: readonly UsageCostBoundaryRow[];
  readonly jobCurrency: string;
  readonly estimateCurrency: string;
  readonly budgetLimitMicros: string;
  readonly nextEstimateMicros: string;
}): UsageReservationDecision => {
  const authority = UsageReservationAuthoritySchema.parse(input.authority);
  const callKey = CallKeySchema.parse(input.callKey);
  const requestSha256 = CapabilityRequestSha256Schema.parse(input.requestSha256);
  const identity = ProviderCallIdentitySchema.parse(input.identity);
  const jobCurrency = CurrencyCodeSchema.parse(input.jobCurrency);
  const estimateCurrency = CurrencyCodeSchema.parse(input.estimateCurrency);
  const budgetLimitMicros = parseMicros(input.budgetLimitMicros);
  const nextEstimateMicros = parseMicros(input.nextEstimateMicros);
  if (input.existingUsage !== null) {
    const existing = ExistingUsageIdentitySchema.parse(input.existingUsage);
    if (
      existing.workspaceId !== authority.workspaceId ||
      existing.jobId !== authority.jobId ||
      existing.attemptId !== authority.attemptId ||
      existing.callKey !== callKey ||
      existing.capability !== identity.capability ||
      existing.providerKey !== identity.providerKey ||
      existing.modelKey !== identity.modelKey ||
      existing.workflowVersionId !== identity.workflowVersionId ||
      existing.external !== identity.external ||
      existing.requestSha256 !== requestSha256 ||
      existing.estimatedCostMicros !== input.nextEstimateMicros ||
      existing.currency !== estimateCurrency
    ) {
      throw new TypeError(
        'Existing usage identity must match the authoritative reservation scope.',
      );
    }
    return {
      kind: 'duplicate',
      existingStatus: existing.status,
      existingUsage: existing,
      incrementProviderCallCount: false,
      createUsageRow: false,
      dispatch: false,
    };
  }

  const providerCallCount = z.int().min(0).max(MAX_PROVIDER_CALLS).parse(input.providerCallCount);
  const usageRows = z
    .array(UsageCostBoundaryRowSchema)
    .max(MAX_PROVIDER_CALLS)
    .parse(input.usageRows);
  if (usageRows.length !== providerCallCount) {
    throw new TypeError('Provider call counter must equal authoritative usage row count.');
  }
  const usageKeys = new Set<string>();
  for (const row of usageRows) {
    if (row.workspaceId !== authority.workspaceId || row.jobId !== authority.jobId) {
      throw new TypeError('Committed usage rows must belong to the authoritative job scope.');
    }
    const identity = `${row.attemptId}\0${row.callKey}`;
    if (usageKeys.has(identity)) {
      throw new TypeError('Authoritative usage rows must be unique by attempt and call key.');
    }
    usageKeys.add(identity);
  }
  if (jobCurrency !== estimateCurrency) {
    return {
      kind: 'rejected',
      code: 'COST_CURRENCY_MISMATCH',
      incrementProviderCallCount: false,
      createUsageRow: false,
      dispatch: false,
    };
  }

  const committedCostMicros = calculateCommittedCostMicros(usageRows);
  if (providerCallCount >= MAX_PROVIDER_CALLS) {
    return {
      kind: 'budget-stopped',
      code: 'PROVIDER_CALL_LIMIT_EXCEEDED',
      jobState: 'budget_stopped',
      attemptState: 'budget_stopped',
      incrementProviderCallCount: false,
      createUsageRow: false,
      dispatch: false,
      committedCostMicros,
    };
  }
  const projectedCostMicros = committedCostMicros + nextEstimateMicros;
  if (projectedCostMicros > MAX_AGGREGATE_COST_MICROS) {
    throw new RangeError('Projected cost exceeds the checked aggregate bound.');
  }
  if (projectedCostMicros > budgetLimitMicros) {
    return {
      kind: 'budget-stopped',
      code: 'BUDGET_LIMIT_EXCEEDED',
      jobState: 'budget_stopped',
      attemptState: 'budget_stopped',
      incrementProviderCallCount: false,
      createUsageRow: false,
      dispatch: false,
      committedCostMicros,
    };
  }
  return {
    kind: 'reserve',
    nextProviderCallCount: providerCallCount + 1,
    incrementProviderCallCount: true,
    createUsageRow: true,
    dispatch: 'after-reservation-commit',
    committedCostMicros,
    projectedCostMicros,
  };
};

export const decideLeaseLossUsageRecovery = (input: {
  readonly callKey: string;
  readonly status: ProviderUsageStatus;
}):
  | {
      readonly kind: 'finalize-indeterminate';
      readonly callKey: string;
      readonly status: 'indeterminate';
      readonly errorCode: 'PROVIDER_RESULT_INDETERMINATE';
      readonly redispatch: false;
    }
  | {
      readonly kind: 'already-final';
      readonly callKey: string;
      readonly status: Exclude<ProviderUsageStatus, 'started'>;
      readonly redispatch: false;
    } => {
  const callKey = CallKeySchema.parse(input.callKey);
  const status = ProviderUsageStatusSchema.parse(input.status);
  return status === 'started'
    ? {
        kind: 'finalize-indeterminate',
        callKey,
        status: 'indeterminate',
        errorCode: 'PROVIDER_RESULT_INDETERMINATE',
        redispatch: false,
      }
    : { kind: 'already-final', callKey, status, redispatch: false };
};

export interface ProviderUsageFinalization {
  readonly status: Exclude<ProviderUsageStatus, 'started'>;
  readonly responseSha256: string | null;
  readonly usageMetrics: UsageMetrics;
  readonly actualCostMicros: CanonicalMicrosString | null;
  readonly error: StructuredJobError | null;
}

export type UsageFinalizationDecision =
  | { readonly kind: 'finalize'; readonly finalization: ProviderUsageFinalization }
  | {
      readonly kind: 'already-final';
      readonly status: Exclude<ProviderUsageStatus, 'started'>;
      readonly rewrite: false;
    };

export const decideUsageFinalization = (input: {
  readonly currentStatus: ProviderUsageStatus;
  readonly targetStatus: Exclude<ProviderUsageStatus, 'started'>;
  readonly responseSha256: string | null;
  readonly usageMetrics: UsageMetrics;
  readonly actualCostMicros: string | null;
  readonly error: StructuredJobError | null;
}): UsageFinalizationDecision => {
  const currentStatus = ProviderUsageStatusSchema.parse(input.currentStatus);
  const targetStatus = z.enum(['succeeded', 'failed', 'indeterminate']).parse(input.targetStatus);
  if (currentStatus !== 'started') {
    return { kind: 'already-final', status: currentStatus, rewrite: false };
  }
  const responseSha256 =
    input.responseSha256 === null ? null : Sha256HexSchema.parse(input.responseSha256);
  const usageMetrics = UsageMetricsSchema.parse(input.usageMetrics);
  const actualCostMicros =
    input.actualCostMicros === null
      ? null
      : CanonicalMicrosStringSchema.parse(input.actualCostMicros);
  const error = input.error === null ? null : StructuredJobErrorSchema.parse(input.error);
  if (targetStatus === 'succeeded') {
    if (responseSha256 === null || error !== null) {
      throw new TypeError('Successful usage finalization requires a response digest and no error.');
    }
  } else if (targetStatus === 'indeterminate') {
    if (
      responseSha256 !== null ||
      error?.code !== 'PROVIDER_RESULT_INDETERMINATE' ||
      error.category !== 'provider_transient'
    ) {
      throw new TypeError(
        'Indeterminate usage finalization requires no response and the exact indeterminate error.',
      );
    }
  } else if (
    error === null ||
    error.category === 'cancelled' ||
    error.category === 'budget_stop' ||
    error.code === 'PROVIDER_RESULT_INDETERMINATE'
  ) {
    throw new TypeError('Failed usage finalization requires a classified adapter failure.');
  }
  return {
    kind: 'finalize',
    finalization: {
      status: targetStatus,
      responseSha256,
      usageMetrics,
      actualCostMicros,
      error,
    },
  };
};

const fixtureUsageMetrics = Object.freeze({
  calls: 1,
  inputTokens: 0,
  outputTokens: 0,
  inputPixels: 0,
  outputImages: 0,
  computeMs: 0,
});

const hasExactFixtureUsageMetrics = (metrics: UsageMetrics): boolean =>
  Object.entries(fixtureUsageMetrics).every(
    ([key, value]) => metrics[key as keyof UsageMetrics] === value,
  );

export const FixtureUsageIdentitySchema = z
  .strictObject({
    capability: z.literal('fixture_replay'),
    providerKey: z.literal('fixture'),
    modelKey: z.literal('phase1a-fixture-v1'),
    external: z.literal(false),
    usageMetrics: UsageMetricsSchema,
    estimatedCostMicros: z.literal('0'),
    actualCostMicros: z.literal('0'),
    currency: CurrencyCodeSchema,
  })
  .superRefine((usage, context) => {
    if (!hasExactFixtureUsageMetrics(usage.usageMetrics)) {
      context.addIssue({
        code: 'custom',
        message: 'Fixture usage metrics must equal the frozen six-key identity.',
      });
    }
  })
  .readonly();

export type FixtureUsageIdentity = z.infer<typeof FixtureUsageIdentitySchema>;

export const FixtureUsageReservationIdentitySchema = z
  .strictObject({
    capability: z.literal('fixture_replay'),
    providerKey: z.literal('fixture'),
    modelKey: z.literal('phase1a-fixture-v1'),
    workflowVersionId: PersistedWorkflowVersionIdSchema,
    external: z.literal(false),
    estimatedCostMicros: z.literal('0'),
    currency: CurrencyCodeSchema,
  })
  .readonly();

export type FixtureUsageReservationIdentity = z.infer<typeof FixtureUsageReservationIdentitySchema>;

export const createFixtureUsageReservationIdentity = (
  workflowVersionIdInput: unknown,
  currencyInput: unknown,
): FixtureUsageReservationIdentity => {
  const identity = createFixtureUsageIdentity(currencyInput);
  return FixtureUsageReservationIdentitySchema.parse({
    capability: identity.capability,
    providerKey: identity.providerKey,
    modelKey: identity.modelKey,
    workflowVersionId: PersistedWorkflowVersionIdSchema.parse(workflowVersionIdInput),
    external: identity.external,
    estimatedCostMicros: identity.estimatedCostMicros,
    currency: identity.currency,
  });
};

export const createFixtureUsageIdentity = (currencyInput: unknown): FixtureUsageIdentity =>
  FixtureUsageIdentitySchema.parse({
    capability: 'fixture_replay',
    providerKey: ProviderKeySchema.parse('fixture') as 'fixture',
    modelKey: ModelKeySchema.parse('phase1a-fixture-v1') as 'phase1a-fixture-v1',
    external: false,
    usageMetrics: UsageMetricsSchema.parse({
      calls: 1,
      inputTokens: 0,
      outputTokens: 0,
      inputPixels: 0,
      outputImages: 0,
      computeMs: 0,
    }),
    estimatedCostMicros: '0',
    actualCostMicros: '0',
    currency: CurrencyCodeSchema.parse(currencyInput),
  });
