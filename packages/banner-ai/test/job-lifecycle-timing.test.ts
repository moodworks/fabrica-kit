import { describe, expect, it, vi } from 'vitest';

import {
  ATTEMPT_TIMEOUT_MS,
  GenerationAttemptLifecycleSchema,
  GenerationJobLifecycleSchema,
  JOB_TIMEOUT_MS,
  MAX_DATE_EPOCH_MS,
  capabilityCallWindow,
  checkedEpochAdd,
  cleanupAttemptTemporaries,
  decideHeartbeat,
  isExpiredAt,
  nextProgressBps,
  planAttemptLease,
  resolveCancellationCommitRace,
  retryDelayForAttempt,
  scheduleRetry,
  transitionAttemptState,
  transitionJobState,
  type AttemptState,
  type JobState,
  type JobTransitionCause,
  type JobTransitionSource,
} from '../src/index.js';

const jobStates: readonly JobState[] = [
  'queued',
  'running',
  'retry_wait',
  'succeeded',
  'failed',
  'cancelled',
  'budget_stopped',
];
const jobSources: readonly JobTransitionSource[] = ['creation', ...jobStates];
const attemptStates: readonly AttemptState[] = [
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'budget_stopped',
  'timed_out',
  'abandoned',
];
const transitionCauses: readonly JobTransitionCause[] = [
  'create',
  'lease',
  'cancel',
  'success',
  'failure',
  'timeout',
  'worker_loss',
  'budget_stop',
  'retry_deadline',
];

const validJobPairs = new Map<
  string,
  { readonly cause: JobTransitionCause; readonly activeAttempt: unknown }
>([
  ['creation->queued', { cause: 'create', activeAttempt: { kind: 'none' } }],
  ['queued->running', { cause: 'lease', activeAttempt: { kind: 'create', state: 'running' } }],
  ['queued->cancelled', { cause: 'cancel', activeAttempt: { kind: 'none' } }],
  [
    'running->succeeded',
    { cause: 'success', activeAttempt: { kind: 'finalize', state: 'succeeded' } },
  ],
  [
    'running->retry_wait',
    { cause: 'failure', activeAttempt: { kind: 'finalize', state: 'failed' } },
  ],
  ['running->failed', { cause: 'failure', activeAttempt: { kind: 'finalize', state: 'failed' } }],
  [
    'running->cancelled',
    { cause: 'cancel', activeAttempt: { kind: 'finalize', state: 'cancelled' } },
  ],
  [
    'running->budget_stopped',
    { cause: 'budget_stop', activeAttempt: { kind: 'finalize', state: 'budget_stopped' } },
  ],
  ['retry_wait->running', { cause: 'lease', activeAttempt: { kind: 'create', state: 'running' } }],
  ['retry_wait->cancelled', { cause: 'cancel', activeAttempt: { kind: 'none' } }],
  ['retry_wait->failed', { cause: 'retry_deadline', activeAttempt: { kind: 'none' } }],
  ['retry_wait->budget_stopped', { cause: 'budget_stop', activeAttempt: { kind: 'none' } }],
]);

const safeError = (category: string, code: string) => ({
  category,
  code,
  message: 'Synthetic bounded lifecycle error.',
});

const workspaceId = '11111111-1111-4111-8111-111111111111';
const projectId = '22222222-2222-4222-8222-222222222222';
const actorId = '33333333-3333-4333-8333-333333333333';
const jobId = '44444444-4444-4444-8444-444444444444';
const attemptId = '55555555-5555-4555-8555-555555555555';
const workflowVersionId = '66666666-6666-4666-8666-666666666666';

const baseJob = {
  jobId,
  workspaceId,
  projectId,
  initiatedByActorId: actorId,
  requestId: 'request.lifecycle:0001',
  operation: 'banner.analyze',
  workflowVersionId,
  requestSha256: 'a'.repeat(64),
  state: 'queued',
  progressBps: 0,
  attemptCount: 0,
  maxAttempts: 3,
  providerCallCount: 0,
  maxProviderCalls: 64,
  attemptTimeoutMs: 120_000,
  jobTimeoutMs: 600_000,
  nextAttemptAtMs: null,
  cancelRequestedAtMs: null,
  startedAtMs: null,
  deadlineAtMs: null,
  finishedAtMs: null,
  terminalError: null,
} as const;

const leaseToken = '11111111-1111-4111-8111-111111111111';
const otherLeaseToken = '22222222-2222-4222-8222-222222222222';

describe('exhaustive job and attempt state matrices', () => {
  it('accepts exactly every frozen from/to/cause triple and rejects every other triple', () => {
    const legal = new Set([
      'creation->queued:create',
      'queued->running:lease',
      'queued->cancelled:cancel',
      'running->succeeded:success',
      'running->retry_wait:failure',
      'running->retry_wait:timeout',
      'running->retry_wait:worker_loss',
      'running->failed:failure',
      'running->failed:timeout',
      'running->failed:worker_loss',
      'running->cancelled:cancel',
      'running->budget_stopped:budget_stop',
      'retry_wait->running:lease',
      'retry_wait->cancelled:cancel',
      'retry_wait->failed:retry_deadline',
      'retry_wait->budget_stopped:budget_stop',
    ]);
    let accepted = 0;
    for (const from of jobSources) {
      for (const to of jobStates) {
        for (const cause of transitionCauses) {
          const key = `${from}->${to}:${cause}`;
          if (legal.has(key)) {
            expect(() => transitionJobState({ from, to, cause }), key).not.toThrow();
            accepted += 1;
          } else {
            expect(() => transitionJobState({ from, to, cause }), key).toThrow();
          }
        }
      }
    }
    expect(accepted).toBe(legal.size);
  });

  it('accepts exactly every frozen job pair and rejects every other pair', () => {
    for (const from of jobSources) {
      for (const to of jobStates) {
        const key = `${from}->${to}`;
        const valid = validJobPairs.get(key);
        if (valid === undefined) {
          expect(() => transitionJobState({ from, to, cause: 'failure' }), key).toThrow();
        } else {
          expect(transitionJobState({ from, to, cause: valid.cause }), key).toMatchObject({
            from,
            to,
            activeAttempt: valid.activeAttempt,
          });
        }
      }
    }
    expect(validJobPairs.size).toBe(12);
  });

  it('maps failure, timeout, and worker loss to exact attempt terminal states on retry or failure', () => {
    for (const to of ['retry_wait', 'failed'] as const) {
      expect(transitionJobState({ from: 'running', to, cause: 'failure' }).activeAttempt).toEqual({
        kind: 'finalize',
        state: 'failed',
      });
      expect(transitionJobState({ from: 'running', to, cause: 'timeout' }).activeAttempt).toEqual({
        kind: 'finalize',
        state: 'timed_out',
      });
      expect(
        transitionJobState({ from: 'running', to, cause: 'worker_loss' }).activeAttempt,
      ).toEqual({ kind: 'finalize', state: 'abandoned' });
    }
    expect(() =>
      transitionJobState({ from: 'running', to: 'retry_wait', cause: 'success' }),
    ).toThrow(/cause/);
  });

  it('accepts only running-to-one-terminal attempt transitions exactly once', () => {
    for (const from of attemptStates) {
      for (const to of attemptStates) {
        const legal = from === 'running' && to !== 'running';
        if (legal) expect(transitionAttemptState({ from, to })).toEqual({ from, to });
        else expect(() => transitionAttemptState({ from, to })).toThrow();
      }
    }
    expect(() =>
      transitionAttemptState({ from: 'running', to: 'invented' as AttemptState }),
    ).toThrow();
    expect(() =>
      transitionJobState({ from: 'invented' as JobState, to: 'queued', cause: 'create' }),
    ).toThrow();
  });
});

describe('strict job and attempt lifecycle models', () => {
  it('accepts coherent queued, running, retry, success, failure, cancellation, and budget states', () => {
    expect(GenerationJobLifecycleSchema.parse(baseJob).state).toBe('queued');
    const running = {
      ...baseJob,
      state: 'running',
      progressBps: 1,
      attemptCount: 1,
      startedAtMs: 1_000,
      deadlineAtMs: 601_000,
    };
    expect(GenerationJobLifecycleSchema.parse(running).state).toBe('running');
    expect(
      GenerationJobLifecycleSchema.parse({
        ...running,
        state: 'retry_wait',
        nextAttemptAtMs: 5_000,
      }).state,
    ).toBe('retry_wait');
    expect(
      GenerationJobLifecycleSchema.parse({
        ...running,
        state: 'succeeded',
        progressBps: 10_000,
        finishedAtMs: 10_000,
      }).state,
    ).toBe('succeeded');
    expect(
      GenerationJobLifecycleSchema.parse({
        ...running,
        state: 'failed',
        finishedAtMs: 10_000,
        terminalError: safeError('provider_permanent', 'PROVIDER_REQUEST_REJECTED'),
      }).state,
    ).toBe('failed');
    expect(
      GenerationJobLifecycleSchema.parse({
        ...running,
        state: 'budget_stopped',
        finishedAtMs: 10_000,
        terminalError: safeError('budget_stop', 'BUDGET_LIMIT_EXCEEDED'),
      }).state,
    ).toBe('budget_stopped');
    expect(
      GenerationJobLifecycleSchema.parse({
        ...baseJob,
        state: 'cancelled',
        cancelRequestedAtMs: 2_000,
        finishedAtMs: 2_000,
        terminalError: safeError('cancelled', 'CANCELLED'),
      }).state,
    ).toBe('cancelled');
  });

  it('rejects unreachable state-correlated timing, progress, attempt, and error combinations', () => {
    const running = {
      ...baseJob,
      state: 'running',
      progressBps: 1,
      attemptCount: 1,
      startedAtMs: 1_000,
      deadlineAtMs: 601_000,
    };
    for (const invalid of [
      { ...baseJob, providerCallCount: 1 },
      { ...running, startedAtMs: null, deadlineAtMs: null },
      { ...running, terminalError: safeError('internal', 'INTERNAL_INVARIANT') },
      { ...running, state: 'retry_wait', nextAttemptAtMs: null },
      {
        ...running,
        state: 'failed',
        progressBps: 0,
        finishedAtMs: 2_000,
        terminalError: safeError('internal', 'INTERNAL_INVARIANT'),
      },
      {
        ...running,
        state: 'failed',
        attemptCount: 0,
        finishedAtMs: 2_000,
        terminalError: safeError('internal', 'INTERNAL_INVARIANT'),
      },
      {
        ...running,
        state: 'budget_stopped',
        finishedAtMs: 2_000,
        terminalError: safeError('internal', 'INTERNAL_INVARIANT'),
      },
      {
        ...running,
        state: 'cancelled',
        finishedAtMs: 2_000,
        terminalError: safeError('cancelled', 'CANCELLED'),
      },
      { ...running, deadlineAtMs: 601_001 },
      { ...running, workspaceId: 'workspace_opaque_0001' },
      {
        ...running,
        state: 'cancelled',
        cancelRequestedAtMs: 1_500,
        finishedAtMs: 2_000,
        terminalError: safeError('cancelled', 'INTERNAL_INVARIANT'),
      },
      {
        ...running,
        state: 'budget_stopped',
        finishedAtMs: 2_000,
        terminalError: safeError('budget_stop', 'CANCELLED'),
      },
      {
        ...running,
        state: 'failed',
        finishedAtMs: 2_000,
        terminalError: safeError('timeout', 'WORKER_LOST'),
      },
    ]) {
      expect(GenerationJobLifecycleSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('keeps attempts running until one coherent immutable terminal state', () => {
    const running = {
      attemptId,
      workspaceId,
      jobId,
      attemptNumber: 1,
      state: 'running',
      workerId: 'worker.local:1',
      leaseToken,
      leaseExpiresAtMs: 31_000,
      heartbeatAtMs: 1_000,
      startedAtMs: 1_000,
      finishedAtMs: null,
      error: null,
    } as const;
    expect(GenerationAttemptLifecycleSchema.parse(running).state).toBe('running');
    expect(
      GenerationAttemptLifecycleSchema.parse({
        ...running,
        state: 'timed_out',
        finishedAtMs: 121_000,
        error: safeError('timeout', 'ATTEMPT_TIMEOUT'),
      }).state,
    ).toBe('timed_out');
    expect(
      GenerationAttemptLifecycleSchema.parse({
        ...running,
        state: 'abandoned',
        finishedAtMs: 2_000,
        error: safeError('worker_lost', 'WORKER_LOST'),
      }).state,
    ).toBe('abandoned');
    expect(
      GenerationAttemptLifecycleSchema.safeParse({
        ...running,
        state: 'failed',
        finishedAtMs: 2_000,
        error: null,
      }).success,
    ).toBe(false);
    expect(
      GenerationAttemptLifecycleSchema.safeParse({
        ...running,
        state: 'succeeded',
        finishedAtMs: 2_000,
        error: safeError('internal', 'INTERNAL_INVARIANT'),
      }).success,
    ).toBe(false);
    for (const invalid of [
      {
        ...running,
        state: 'cancelled',
        finishedAtMs: 2_000,
        error: safeError('cancelled', 'INTERNAL_INVARIANT'),
      },
      {
        ...running,
        state: 'budget_stopped',
        finishedAtMs: 2_000,
        error: safeError('budget_stop', 'CAPABILITY_TIMEOUT'),
      },
      {
        ...running,
        state: 'timed_out',
        finishedAtMs: 2_000,
        error: safeError('timeout', 'WORKER_LOST'),
      },
      {
        ...running,
        state: 'abandoned',
        finishedAtMs: 2_000,
        error: safeError('provider_transient', 'PROVIDER_RATE_LIMITED'),
      },
      {
        ...running,
        state: 'abandoned',
        finishedAtMs: 2_000,
        error: safeError('provider_transient', 'PROVIDER_RESULT_INDETERMINATE'),
      },
      { ...running, attemptId: 'generation_attempt_opaque' },
      {
        ...running,
        heartbeatAtMs: 3_000,
        state: 'failed',
        finishedAtMs: 2_000,
        error: safeError('internal', 'INTERNAL_INVARIANT'),
      },
    ]) {
      expect(GenerationAttemptLifecycleSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe('progress, retry, attempt, call, lease, and heartbeat boundaries', () => {
  it('enforces monotonic state-specific progress including retry retention and atomic success', () => {
    expect(nextProgressBps({ current: 0, next: 1, destinationState: 'running' })).toBe(1);
    expect(nextProgressBps({ current: 7_000, next: 8_500, destinationState: 'running' })).toBe(
      8_500,
    );
    expect(nextProgressBps({ current: 8_500, next: 8_500, destinationState: 'retry_wait' })).toBe(
      8_500,
    );
    expect(nextProgressBps({ current: 9_999, next: 10_000, destinationState: 'succeeded' })).toBe(
      10_000,
    );
    for (const invalid of [
      { current: 10, next: 9, destinationState: 'running' },
      { current: 0, next: 10_000, destinationState: 'running' },
      { current: 8_500, next: 8_501, destinationState: 'failed' },
      { current: 0, next: 1, destinationState: 'queued' },
      { current: 0, next: 0, destinationState: 'invented' },
    ]) {
      expect(() => nextProgressBps(invalid as Parameters<typeof nextProgressBps>[0])).toThrow();
    }
  });

  it('uses exact retry delays and requires the next start strictly before the job deadline', () => {
    expect(retryDelayForAttempt(2)).toBe(1_000);
    expect(retryDelayForAttempt(3)).toBe(5_000);
    expect(() => retryDelayForAttempt(1)).toThrow();
    expect(() => retryDelayForAttempt(4)).toThrow();
    expect(
      scheduleRetry({ currentAttemptNumber: 1, finishedAtMs: 10_000, jobDeadlineAtMs: 20_000 }),
    ).toEqual({
      kind: 'eligible',
      nextAttemptNumber: 2,
      delayMs: 1_000,
      nextAttemptAtMs: 11_000,
    });
    expect(
      scheduleRetry({ currentAttemptNumber: 2, finishedAtMs: 10_000, jobDeadlineAtMs: 15_001 }),
    ).toMatchObject({ kind: 'eligible', nextAttemptAtMs: 15_000 });
    expect(
      scheduleRetry({ currentAttemptNumber: 2, finishedAtMs: 10_000, jobDeadlineAtMs: 15_000 }),
    ).toEqual({ kind: 'job-deadline-prevents-retry' });
    expect(scheduleRetry({ currentAttemptNumber: 3, finishedAtMs: 1, jobDeadlineAtMs: 2 })).toEqual(
      {
        kind: 'attempts-exhausted',
      },
    );
    expect(() =>
      scheduleRetry({ currentAttemptNumber: 4, finishedAtMs: 1, jobDeadlineAtMs: 2 }),
    ).toThrow();
  });

  it('creates fresh numbered attempts, pins exact waits, and never extends the first-start deadline', () => {
    const first = planAttemptLease({
      jobState: 'queued',
      attemptCount: 0,
      nowMs: 1_000,
      jobStartedAtMs: null,
      jobDeadlineAtMs: null,
      nextAttemptAtMs: null,
      priorAttemptFinishedAtMs: null,
    });
    expect(first).toMatchObject({
      attemptNumber: 1,
      attemptStartedAtMs: 1_000,
      attemptDeadlineAtMs: 121_000,
      jobStartedAtMs: 1_000,
      jobDeadlineAtMs: 601_000,
      heartbeatAtMs: 1_000,
      nextHeartbeatAtMs: 11_000,
      leaseExpiresAtMs: 31_000,
    });
    const second = planAttemptLease({
      jobState: 'retry_wait',
      attemptCount: 1,
      nowMs: 11_000,
      jobStartedAtMs: 1_000,
      jobDeadlineAtMs: 601_000,
      nextAttemptAtMs: 11_000,
      priorAttemptFinishedAtMs: 10_000,
    });
    expect(second).toMatchObject({
      attemptNumber: 2,
      attemptStartedAtMs: 11_000,
      jobDeadlineAtMs: 601_000,
    });
    const third = planAttemptLease({
      jobState: 'retry_wait',
      attemptCount: 2,
      nowMs: 25_000,
      jobStartedAtMs: 1_000,
      jobDeadlineAtMs: 601_000,
      nextAttemptAtMs: 25_000,
      priorAttemptFinishedAtMs: 20_000,
    });
    expect(third).toMatchObject({ attemptNumber: 3, jobDeadlineAtMs: 601_000 });
    expect(() =>
      planAttemptLease({
        jobState: 'retry_wait',
        attemptCount: 1,
        nowMs: 10_999,
        jobStartedAtMs: 1_000,
        jobDeadlineAtMs: 601_000,
        nextAttemptAtMs: 11_000,
        priorAttemptFinishedAtMs: 10_000,
      }),
    ).toThrow();
    expect(() =>
      planAttemptLease({
        jobState: 'retry_wait',
        attemptCount: 1,
        nowMs: 11_000,
        jobStartedAtMs: 1_000,
        jobDeadlineAtMs: 601_001,
        nextAttemptAtMs: 11_000,
        priorAttemptFinishedAtMs: 10_000,
      }),
    ).toThrow(/extend/);
    expect(() =>
      planAttemptLease({
        jobState: 'retry_wait',
        attemptCount: 1,
        nowMs: 11_000,
        jobStartedAtMs: 1_000,
        jobDeadlineAtMs: 601_000,
        nextAttemptAtMs: 10_999,
        priorAttemptFinishedAtMs: 10_000,
      }),
    ).toThrow(/exact prior finish/);
    expect(() =>
      planAttemptLease({
        jobState: 'retry_wait',
        attemptCount: 1,
        nowMs: 11_000,
        jobStartedAtMs: 10_000,
        jobDeadlineAtMs: 610_000,
        nextAttemptAtMs: 6_000,
        priorAttemptFinishedAtMs: 5_000,
      }),
    ).toThrow(/predate/);
    expect(() =>
      planAttemptLease({
        jobState: 'invented' as 'retry_wait',
        attemptCount: 1,
        nowMs: 11_000,
        jobStartedAtMs: 1_000,
        jobDeadlineAtMs: 601_000,
        nextAttemptAtMs: 11_000,
        priorAttemptFinishedAtMs: 10_000,
      }),
    ).toThrow();
  });

  it('bounds each call by 60s, remaining attempt, and remaining job with equality expired', () => {
    expect(
      capabilityCallWindow({
        nowMs: 1_000,
        attemptDeadlineAtMs: 121_000,
        jobDeadlineAtMs: 601_000,
      }),
    ).toEqual({ kind: 'dispatch', timeoutMs: 60_000, deadlineAtMs: 61_000 });
    expect(
      capabilityCallWindow({
        nowMs: 120_999,
        attemptDeadlineAtMs: 121_000,
        jobDeadlineAtMs: 601_000,
      }),
    ).toEqual({ kind: 'dispatch', timeoutMs: 1, deadlineAtMs: 121_000 });
    expect(
      capabilityCallWindow({
        nowMs: 600_999,
        attemptDeadlineAtMs: 700_000,
        jobDeadlineAtMs: 601_000,
      }),
    ).toEqual({ kind: 'dispatch', timeoutMs: 1, deadlineAtMs: 601_000 });
    expect(
      capabilityCallWindow({
        nowMs: 121_000,
        attemptDeadlineAtMs: 121_000,
        jobDeadlineAtMs: 601_000,
      }),
    ).toEqual({ kind: 'expired', expiredBoundary: 'attempt' });
    expect(
      capabilityCallWindow({
        nowMs: 601_000,
        attemptDeadlineAtMs: 700_000,
        jobDeadlineAtMs: 601_000,
      }),
    ).toEqual({ kind: 'expired', expiredBoundary: 'job' });
    expect(isExpiredAt(999, 1_000)).toBe(false);
    expect(isExpiredAt(1_000, 1_000)).toBe(true);
    expect(isExpiredAt(1_001, 1_000)).toBe(true);
  });

  it('renews only a live matching lease before lease, attempt, and job expiry', () => {
    const lease = {
      leaseToken,
      jobState: 'running',
      attemptState: 'running',
      heartbeatAtMs: 10_000,
      leaseExpiresAtMs: 40_000,
      attemptDeadlineAtMs: 120_000,
      jobDeadlineAtMs: 600_000,
    } as const;
    expect(decideHeartbeat({ lease, presentedLeaseToken: leaseToken, nowMs: 39_999 })).toEqual({
      kind: 'renewed',
      heartbeatAtMs: 39_999,
      nextHeartbeatAtMs: 49_999,
      leaseExpiresAtMs: 69_999,
      jobDeadlineAtMs: 600_000,
    });
    expect(decideHeartbeat({ lease, presentedLeaseToken: leaseToken, nowMs: 40_000 })).toEqual({
      kind: 'rejected',
      reason: 'lease-expired',
    });
    expect(
      decideHeartbeat({
        lease: { ...lease, heartbeatAtMs: 90_000, leaseExpiresAtMs: 120_000 },
        presentedLeaseToken: leaseToken,
        nowMs: 119_999,
      }).kind,
    ).toBe('renewed');
    expect(
      decideHeartbeat({
        lease: { ...lease, heartbeatAtMs: 90_000, leaseExpiresAtMs: 120_000 },
        presentedLeaseToken: leaseToken,
        nowMs: 120_000,
      }),
    ).toEqual({ kind: 'rejected', reason: 'attempt-expired' });
    expect(
      decideHeartbeat({
        lease: {
          ...lease,
          heartbeatAtMs: 570_000,
          leaseExpiresAtMs: 600_000,
          attemptDeadlineAtMs: 700_000,
        },
        presentedLeaseToken: leaseToken,
        nowMs: 600_000,
      }),
    ).toEqual({ kind: 'rejected', reason: 'job-expired' });
    expect(decideHeartbeat({ lease, presentedLeaseToken: otherLeaseToken, nowMs: 20_000 })).toEqual(
      {
        kind: 'rejected',
        reason: 'wrong-token',
      },
    );
    expect(
      decideHeartbeat({
        lease: { ...lease, attemptState: 'failed' },
        presentedLeaseToken: leaseToken,
        nowMs: 20_000,
      }),
    ).toEqual({ kind: 'rejected', reason: 'stale-state' });
    expect(decideHeartbeat({ lease, presentedLeaseToken: leaseToken, nowMs: 10_000 })).toEqual({
      kind: 'rejected',
      reason: 'non-monotonic',
    });
    expect(() =>
      decideHeartbeat({
        lease: { ...lease, jobState: 'invented' as 'running' },
        presentedLeaseToken: leaseToken,
        nowMs: 20_000,
      }),
    ).toThrow();
    expect(() =>
      decideHeartbeat({
        lease: { ...lease, attemptState: 'invented' as 'running' },
        presentedLeaseToken: leaseToken,
        nowMs: 20_000,
      }),
    ).toThrow();
    expect(() =>
      decideHeartbeat({
        lease: { ...lease, leaseExpiresAtMs: 99_000 },
        presentedLeaseToken: leaseToken,
        nowMs: 20_000,
      }),
    ).toThrow(/frozen duration/);
  });

  it('checks safe-integer and Date-range arithmetic', () => {
    expect(checkedEpochAdd(1_000, ATTEMPT_TIMEOUT_MS)).toBe(121_000);
    expect(checkedEpochAdd(1_000, JOB_TIMEOUT_MS)).toBe(601_000);
    expect(() => checkedEpochAdd(MAX_DATE_EPOCH_MS, 1)).toThrow(/Date range/);
    expect(() => checkedEpochAdd(Number.MAX_SAFE_INTEGER, 0)).toThrow();
    expect(() => checkedEpochAdd(0, -1)).toThrow();
    expect(() => checkedEpochAdd(0, 1.5)).toThrow();
  });
});

describe('cancellation races and temporary cleanup', () => {
  it('resolves both commit orders without rewriting an existing terminal result', () => {
    expect(
      resolveCancellationCommitRace({
        firstCommit: 'cancellation',
        workerTerminalState: 'succeeded',
      }),
    ).toEqual({
      winner: 'cancellation',
      jobState: 'cancelled',
      attemptState: 'cancelled',
      commitFinalOutput: false,
    });
    expect(
      resolveCancellationCommitRace({ firstCommit: 'worker', workerTerminalState: 'succeeded' }),
    ).toEqual({
      winner: 'worker',
      jobState: 'succeeded',
      attemptState: 'succeeded',
      laterCancellation: 'return-existing-terminal',
    });
    expect(() =>
      resolveCancellationCommitRace({
        firstCommit: 'invented' as 'worker',
        workerTerminalState: 'succeeded',
      }),
    ).toThrow();
  });

  it.each(['failure', 'cancellation', 'timeout', 'lease_loss', 'losing_commit_race'] as const)(
    'deletes both temporary classes and retains committed checkpoints for %s',
    async (cause) => {
      const incomplete = vi.fn();
      const staged = vi.fn();
      await expect(
        cleanupAttemptTemporaries(cause, {
          deleteIncompleteStepBytes: incomplete,
          deleteStagedFinalBytes: staged,
        }),
      ).resolves.toEqual({ committedCheckpoints: 'retained' });
      expect(incomplete).toHaveBeenCalledOnce();
      expect(staged).toHaveBeenCalledOnce();
    },
  );

  it.each(['incomplete', 'staged'] as const)(
    'attempts both cleanup actions and surfaces a %s deletion failure',
    async (failing) => {
      const incomplete = vi.fn(() => {
        if (failing === 'incomplete') throw new Error('incomplete cleanup failed');
      });
      const staged = vi.fn(() => {
        if (failing === 'staged') throw new Error('staged cleanup failed');
      });
      await expect(
        cleanupAttemptTemporaries('failure', {
          deleteIncompleteStepBytes: incomplete,
          deleteStagedFinalBytes: staged,
        }),
      ).rejects.toThrow(/cleanup failed/);
      expect(incomplete).toHaveBeenCalledOnce();
      expect(staged).toHaveBeenCalledOnce();
    },
  );

  it('rejects an unknown cleanup cause before invoking either deletion', async () => {
    const incomplete = vi.fn();
    const staged = vi.fn();
    await expect(
      cleanupAttemptTemporaries('invented' as 'failure', {
        deleteIncompleteStepBytes: incomplete,
        deleteStagedFinalBytes: staged,
      }),
    ).rejects.toThrow();
    expect(incomplete).not.toHaveBeenCalled();
    expect(staged).not.toHaveBeenCalled();
  });
});
