import { z } from 'zod';

import { LeaseTokenSchema } from './syntax.js';

export const MAX_DATE_EPOCH_MS = 8_640_000_000_000_000;
export const MAX_ATTEMPTS = 3;
export const ATTEMPT_TIMEOUT_MS = 120_000;
export const JOB_TIMEOUT_MS = 600_000;
export const MAX_CAPABILITY_CALL_MS = 60_000;
export const LEASE_DURATION_MS = 30_000;
export const HEARTBEAT_INTERVAL_MS = 10_000;

export const EpochMillisecondsSchema = z
  .int()
  .min(0)
  .max(MAX_DATE_EPOCH_MS)
  .brand<'EpochMilliseconds'>();

export type EpochMilliseconds = z.infer<typeof EpochMillisecondsSchema>;

export const checkedEpochAdd = (epochInput: number, durationMs: number): EpochMilliseconds => {
  const epoch = EpochMillisecondsSchema.parse(epochInput);
  if (!Number.isSafeInteger(durationMs) || durationMs < 0) {
    throw new RangeError('Duration must be a non-negative safe integer.');
  }
  const result = epoch + durationMs;
  if (!Number.isSafeInteger(result) || result > MAX_DATE_EPOCH_MS) {
    throw new RangeError('Timestamp arithmetic exceeds the safe Date range.');
  }
  return EpochMillisecondsSchema.parse(result);
};

export const retryDelayForAttempt = (nextAttemptNumber: number): 1_000 | 5_000 => {
  if (nextAttemptNumber === 2) return 1_000;
  if (nextAttemptNumber === 3) return 5_000;
  throw new RangeError('Only attempts 2 and 3 have Phase 1A retry delays.');
};

export type RetryScheduleDecision =
  | {
      readonly kind: 'eligible';
      readonly nextAttemptNumber: 2 | 3;
      readonly delayMs: 1_000 | 5_000;
      readonly nextAttemptAtMs: EpochMilliseconds;
    }
  | { readonly kind: 'attempts-exhausted' }
  | { readonly kind: 'job-deadline-prevents-retry' };

export const scheduleRetry = (input: {
  readonly currentAttemptNumber: number;
  readonly finishedAtMs: number;
  readonly jobDeadlineAtMs: number;
}): RetryScheduleDecision => {
  const finishedAtMs = EpochMillisecondsSchema.parse(input.finishedAtMs);
  const jobDeadlineAtMs = EpochMillisecondsSchema.parse(input.jobDeadlineAtMs);
  if (
    !Number.isSafeInteger(input.currentAttemptNumber) ||
    input.currentAttemptNumber < 1 ||
    input.currentAttemptNumber > MAX_ATTEMPTS
  ) {
    throw new RangeError('Current attempt number is invalid.');
  }
  if (input.currentAttemptNumber >= MAX_ATTEMPTS) return { kind: 'attempts-exhausted' };
  const nextAttemptNumber = (input.currentAttemptNumber + 1) as 2 | 3;
  const delayMs = retryDelayForAttempt(nextAttemptNumber);
  const nextAttemptAtMs = checkedEpochAdd(finishedAtMs, delayMs);
  return nextAttemptAtMs < jobDeadlineAtMs
    ? { kind: 'eligible', nextAttemptNumber, delayMs, nextAttemptAtMs }
    : { kind: 'job-deadline-prevents-retry' };
};

export type CapabilityCallWindow =
  | {
      readonly kind: 'dispatch';
      readonly timeoutMs: number;
      readonly deadlineAtMs: EpochMilliseconds;
    }
  | {
      readonly kind: 'expired';
      readonly expiredBoundary: 'attempt' | 'job';
    };

export const capabilityCallWindow = (input: {
  readonly nowMs: number;
  readonly attemptDeadlineAtMs: number;
  readonly jobDeadlineAtMs: number;
}): CapabilityCallWindow => {
  const nowMs = EpochMillisecondsSchema.parse(input.nowMs);
  const attemptDeadlineAtMs = EpochMillisecondsSchema.parse(input.attemptDeadlineAtMs);
  const jobDeadlineAtMs = EpochMillisecondsSchema.parse(input.jobDeadlineAtMs);
  if (nowMs >= jobDeadlineAtMs) return { kind: 'expired', expiredBoundary: 'job' };
  if (nowMs >= attemptDeadlineAtMs) return { kind: 'expired', expiredBoundary: 'attempt' };
  const timeoutMs = Math.min(
    MAX_CAPABILITY_CALL_MS,
    attemptDeadlineAtMs - nowMs,
    jobDeadlineAtMs - nowMs,
  );
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    return {
      kind: 'expired',
      expiredBoundary: jobDeadlineAtMs <= attemptDeadlineAtMs ? 'job' : 'attempt',
    };
  }
  return { kind: 'dispatch', timeoutMs, deadlineAtMs: checkedEpochAdd(nowMs, timeoutMs) };
};

export interface PlannedAttemptLease {
  readonly attemptNumber: 1 | 2 | 3;
  readonly attemptStartedAtMs: EpochMilliseconds;
  readonly attemptDeadlineAtMs: EpochMilliseconds;
  readonly heartbeatAtMs: EpochMilliseconds;
  readonly nextHeartbeatAtMs: EpochMilliseconds;
  readonly leaseExpiresAtMs: EpochMilliseconds;
  readonly jobStartedAtMs: EpochMilliseconds;
  readonly jobDeadlineAtMs: EpochMilliseconds;
}

export const planAttemptLease = (input: {
  readonly jobState: 'queued' | 'retry_wait';
  readonly attemptCount: number;
  readonly nowMs: number;
  readonly jobStartedAtMs: number | null;
  readonly jobDeadlineAtMs: number | null;
  readonly nextAttemptAtMs: number | null;
  readonly priorAttemptFinishedAtMs: number | null;
}): PlannedAttemptLease => {
  const jobState = z.enum(['queued', 'retry_wait']).parse(input.jobState);
  const nowMs = EpochMillisecondsSchema.parse(input.nowMs);
  if (
    !Number.isSafeInteger(input.attemptCount) ||
    input.attemptCount < 0 ||
    input.attemptCount > 2
  ) {
    throw new RangeError('A new attempt requires a prior attempt count from 0 through 2.');
  }
  const attemptNumber = (input.attemptCount + 1) as 1 | 2 | 3;
  let jobStartedAtMs: EpochMilliseconds;
  let jobDeadlineAtMs: EpochMilliseconds;

  if (jobState === 'queued') {
    if (
      input.attemptCount !== 0 ||
      input.jobStartedAtMs !== null ||
      input.jobDeadlineAtMs !== null ||
      input.nextAttemptAtMs !== null ||
      input.priorAttemptFinishedAtMs !== null
    ) {
      throw new TypeError('A queued first lease must have no prior attempt timing.');
    }
    jobStartedAtMs = nowMs;
    jobDeadlineAtMs = checkedEpochAdd(nowMs, JOB_TIMEOUT_MS);
  } else {
    if (
      input.attemptCount < 1 ||
      input.jobStartedAtMs === null ||
      input.jobDeadlineAtMs === null ||
      input.nextAttemptAtMs === null ||
      input.priorAttemptFinishedAtMs === null
    ) {
      throw new TypeError('A retry lease requires prior immutable job and retry timing.');
    }
    jobStartedAtMs = EpochMillisecondsSchema.parse(input.jobStartedAtMs);
    jobDeadlineAtMs = EpochMillisecondsSchema.parse(input.jobDeadlineAtMs);
    const expectedJobDeadline = checkedEpochAdd(jobStartedAtMs, JOB_TIMEOUT_MS);
    if (jobDeadlineAtMs !== expectedJobDeadline) {
      throw new TypeError('A retry cannot extend or replace the fixed job deadline.');
    }
    const nextAttemptAtMs = EpochMillisecondsSchema.parse(input.nextAttemptAtMs);
    const priorAttemptFinishedAtMs = EpochMillisecondsSchema.parse(input.priorAttemptFinishedAtMs);
    if (priorAttemptFinishedAtMs < jobStartedAtMs) {
      throw new TypeError('A retry finish cannot predate the fixed first job start.');
    }
    const expectedSchedule = scheduleRetry({
      currentAttemptNumber: input.attemptCount,
      finishedAtMs: priorAttemptFinishedAtMs,
      jobDeadlineAtMs,
    });
    if (
      expectedSchedule.kind !== 'eligible' ||
      expectedSchedule.nextAttemptAtMs !== nextAttemptAtMs
    ) {
      throw new TypeError('Stored retry timing does not match the exact prior finish and delay.');
    }
    if (nextAttemptAtMs >= jobDeadlineAtMs || nowMs < nextAttemptAtMs || nowMs >= jobDeadlineAtMs) {
      throw new RangeError('Retry attempt is not eligible before the fixed job deadline.');
    }
  }

  return {
    attemptNumber,
    attemptStartedAtMs: nowMs,
    attemptDeadlineAtMs: checkedEpochAdd(nowMs, ATTEMPT_TIMEOUT_MS),
    heartbeatAtMs: nowMs,
    nextHeartbeatAtMs: checkedEpochAdd(nowMs, HEARTBEAT_INTERVAL_MS),
    leaseExpiresAtMs: checkedEpochAdd(nowMs, LEASE_DURATION_MS),
    jobStartedAtMs,
    jobDeadlineAtMs,
  };
};

export interface ActiveLeaseTiming {
  readonly leaseToken: string;
  readonly jobState:
    'running' | 'queued' | 'retry_wait' | 'succeeded' | 'failed' | 'cancelled' | 'budget_stopped';
  readonly attemptState:
    'running' | 'succeeded' | 'failed' | 'cancelled' | 'budget_stopped' | 'timed_out' | 'abandoned';
  readonly heartbeatAtMs: number;
  readonly leaseExpiresAtMs: number;
  readonly attemptDeadlineAtMs: number;
  readonly jobDeadlineAtMs: number;
}

export const HeartbeatDecisionSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('renewed'),
      heartbeatAtMs: EpochMillisecondsSchema,
      nextHeartbeatAtMs: EpochMillisecondsSchema,
      leaseExpiresAtMs: EpochMillisecondsSchema,
      jobDeadlineAtMs: EpochMillisecondsSchema,
    }),
    z.strictObject({
      kind: z.literal('rejected'),
      reason: z.enum([
        'wrong-token',
        'stale-state',
        'non-monotonic',
        'lease-expired',
        'attempt-expired',
        'job-expired',
      ]),
    }),
  ])
  .readonly();

export type HeartbeatDecision = z.infer<typeof HeartbeatDecisionSchema>;

export const decideHeartbeat = (input: {
  readonly lease: ActiveLeaseTiming;
  readonly presentedLeaseToken: string;
  readonly nowMs: number;
}): HeartbeatDecision => {
  const expectedToken = LeaseTokenSchema.parse(input.lease.leaseToken);
  const presentedToken = LeaseTokenSchema.parse(input.presentedLeaseToken);
  const jobState = z
    .enum(['running', 'queued', 'retry_wait', 'succeeded', 'failed', 'cancelled', 'budget_stopped'])
    .parse(input.lease.jobState);
  const attemptState = z
    .enum([
      'running',
      'succeeded',
      'failed',
      'cancelled',
      'budget_stopped',
      'timed_out',
      'abandoned',
    ])
    .parse(input.lease.attemptState);
  if (presentedToken !== expectedToken) return { kind: 'rejected', reason: 'wrong-token' };
  if (jobState !== 'running' || attemptState !== 'running') {
    return { kind: 'rejected', reason: 'stale-state' };
  }
  const nowMs = EpochMillisecondsSchema.parse(input.nowMs);
  const heartbeatAtMs = EpochMillisecondsSchema.parse(input.lease.heartbeatAtMs);
  const leaseExpiresAtMs = EpochMillisecondsSchema.parse(input.lease.leaseExpiresAtMs);
  const attemptDeadlineAtMs = EpochMillisecondsSchema.parse(input.lease.attemptDeadlineAtMs);
  const jobDeadlineAtMs = EpochMillisecondsSchema.parse(input.lease.jobDeadlineAtMs);
  if (leaseExpiresAtMs !== checkedEpochAdd(heartbeatAtMs, LEASE_DURATION_MS)) {
    throw new TypeError('Active lease expiry must equal the frozen duration from its heartbeat.');
  }
  if (nowMs >= jobDeadlineAtMs) return { kind: 'rejected', reason: 'job-expired' };
  if (nowMs >= attemptDeadlineAtMs) return { kind: 'rejected', reason: 'attempt-expired' };
  if (nowMs >= leaseExpiresAtMs) return { kind: 'rejected', reason: 'lease-expired' };
  if (nowMs <= heartbeatAtMs) return { kind: 'rejected', reason: 'non-monotonic' };
  return {
    kind: 'renewed',
    heartbeatAtMs: nowMs,
    nextHeartbeatAtMs: checkedEpochAdd(nowMs, HEARTBEAT_INTERVAL_MS),
    leaseExpiresAtMs: checkedEpochAdd(nowMs, LEASE_DURATION_MS),
    jobDeadlineAtMs,
  };
};

export const isExpiredAt = (nowInput: number, deadlineInput: number): boolean =>
  EpochMillisecondsSchema.parse(nowInput) >= EpochMillisecondsSchema.parse(deadlineInput);
