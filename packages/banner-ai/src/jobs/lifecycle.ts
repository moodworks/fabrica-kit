import { z } from 'zod';

import { RequestIdSchema } from '../context/actor-workspace-context.js';
import { OperationRequestSha256Schema } from './request-digests.js';
import {
  ATTEMPT_TIMEOUT_MS,
  JOB_TIMEOUT_MS,
  MAX_ATTEMPTS,
  EpochMillisecondsSchema,
  checkedEpochAdd,
} from './timing.js';
import {
  ErrorCodeSchema,
  GenerationAttemptIdSchema,
  GenerationJobIdSchema,
  LeaseTokenSchema,
  PersistedActorIdSchema,
  PersistedProjectIdSchema,
  PersistedWorkflowVersionIdSchema,
  PersistedWorkspaceIdSchema,
  SafePersistedMessageSchema,
  WorkerIdSchema,
  BannerOperationSchema,
} from './syntax.js';

export const JobStateSchema = z.enum([
  'queued',
  'running',
  'retry_wait',
  'succeeded',
  'failed',
  'cancelled',
  'budget_stopped',
]);

export const AttemptStateSchema = z.enum([
  'running',
  'succeeded',
  'failed',
  'cancelled',
  'budget_stopped',
  'timed_out',
  'abandoned',
]);

export const ErrorCategorySchema = z.enum([
  'validation',
  'not_found',
  'conflict',
  'policy_rejected',
  'provider_transient',
  'provider_permanent',
  'timeout',
  'worker_lost',
  'budget_stop',
  'cancelled',
  'internal',
]);

export type JobState = z.infer<typeof JobStateSchema>;
export type AttemptState = z.infer<typeof AttemptStateSchema>;
export type ErrorCategory = z.infer<typeof ErrorCategorySchema>;

const persistedErrorCategoryByCode = Object.freeze({
  COMMAND_INVALID: 'validation',
  COST_VALUE_INVALID: 'validation',
  COST_CURRENCY_MISMATCH: 'validation',
  PROJECT_OR_ASSET_NOT_FOUND: 'not_found',
  IDEMPOTENCY_KEY_REUSED: 'conflict',
  CHECKPOINT_IDENTITY_MISMATCH: 'internal',
  CAPABILITY_POLICY_REJECTED: 'policy_rejected',
  EXTERNAL_CALLS_DISABLED: 'policy_rejected',
  EXTERNAL_USAGE_REJECTED: 'policy_rejected',
  PROVIDER_RATE_LIMITED: 'provider_transient',
  PROVIDER_TEMPORARILY_UNAVAILABLE: 'provider_transient',
  PROVIDER_RESULT_INDETERMINATE: 'provider_transient',
  PROVIDER_REQUEST_REJECTED: 'provider_permanent',
  CAPABILITY_TIMEOUT: 'timeout',
  ATTEMPT_TIMEOUT: 'timeout',
  WORKER_LOST: 'worker_lost',
  BUDGET_LIMIT_EXCEEDED: 'budget_stop',
  PROVIDER_CALL_LIMIT_EXCEEDED: 'budget_stop',
  CANCELLED: 'cancelled',
  INTERNAL_INVARIANT: 'internal',
  INTERNAL_TRANSIENT: 'internal',
} as const satisfies Record<string, ErrorCategory>);

export const PersistedErrorSummarySchema = z
  .strictObject({
    category: ErrorCategorySchema,
    code: ErrorCodeSchema,
    message: SafePersistedMessageSchema,
  })
  .superRefine((error, context) => {
    const expected =
      persistedErrorCategoryByCode[error.code as keyof typeof persistedErrorCategoryByCode];
    if (expected === undefined || expected !== error.category) {
      context.addIssue({
        code: 'custom',
        message: 'Persisted error code and category must match the closed taxonomy.',
      });
    }
  })
  .readonly();

export type PersistedErrorSummary = z.infer<typeof PersistedErrorSummarySchema>;

export const GenerationJobLifecycleSchema = z
  .strictObject({
    jobId: GenerationJobIdSchema,
    workspaceId: PersistedWorkspaceIdSchema,
    projectId: PersistedProjectIdSchema,
    initiatedByActorId: PersistedActorIdSchema,
    requestId: RequestIdSchema,
    operation: BannerOperationSchema,
    workflowVersionId: PersistedWorkflowVersionIdSchema,
    requestSha256: OperationRequestSha256Schema,
    state: JobStateSchema,
    progressBps: z.int().min(0).max(10_000),
    attemptCount: z.int().min(0).max(MAX_ATTEMPTS),
    maxAttempts: z.literal(MAX_ATTEMPTS),
    providerCallCount: z.int().min(0).max(64),
    maxProviderCalls: z.literal(64),
    attemptTimeoutMs: z.literal(ATTEMPT_TIMEOUT_MS),
    jobTimeoutMs: z.literal(JOB_TIMEOUT_MS),
    nextAttemptAtMs: EpochMillisecondsSchema.nullable(),
    cancelRequestedAtMs: EpochMillisecondsSchema.nullable(),
    startedAtMs: EpochMillisecondsSchema.nullable(),
    deadlineAtMs: EpochMillisecondsSchema.nullable(),
    finishedAtMs: EpochMillisecondsSchema.nullable(),
    terminalError: PersistedErrorSummarySchema.nullable(),
  })
  .superRefine((job, context) => {
    const terminal = ['succeeded', 'failed', 'cancelled', 'budget_stopped'].includes(job.state);
    if ((job.finishedAtMs !== null) !== terminal) {
      context.addIssue({
        code: 'custom',
        message: 'Finished time must exist exactly for terminal jobs.',
      });
    }
    if ((job.state === 'retry_wait') !== (job.nextAttemptAtMs !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Next-attempt time must exist exactly while waiting to retry.',
      });
    }
    if ((job.startedAtMs === null) !== (job.deadlineAtMs === null)) {
      context.addIssue({ code: 'custom', message: 'Job start and deadline must be set together.' });
    }
    if (
      job.startedAtMs !== null &&
      job.deadlineAtMs !== checkedEpochAdd(job.startedAtMs, JOB_TIMEOUT_MS)
    ) {
      context.addIssue({ code: 'custom', message: 'Job deadline must be fixed from first start.' });
    }
    if (
      job.finishedAtMs !== null &&
      job.startedAtMs !== null &&
      job.finishedAtMs < job.startedAtMs
    ) {
      context.addIssue({ code: 'custom', message: 'Job finish cannot predate its first start.' });
    }
    if (
      job.cancelRequestedAtMs !== null &&
      job.finishedAtMs !== null &&
      job.cancelRequestedAtMs > job.finishedAtMs &&
      job.state === 'cancelled'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Winning cancellation cannot postdate job finish.',
      });
    }
    if (job.state === 'queued') {
      if (
        job.progressBps !== 0 ||
        job.attemptCount !== 0 ||
        job.providerCallCount !== 0 ||
        job.startedAtMs !== null ||
        job.cancelRequestedAtMs !== null ||
        job.terminalError !== null
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Queued jobs begin with zero progress and attempts.',
        });
      }
    } else if (job.state === 'running') {
      if (
        job.progressBps < 1 ||
        job.progressBps > 9_999 ||
        job.attemptCount < 1 ||
        job.startedAtMs === null ||
        job.terminalError !== null
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Running jobs require an attempt and progress 1..9999.',
        });
      }
    } else if (job.state === 'retry_wait') {
      if (
        job.progressBps < 1 ||
        job.progressBps > 9_999 ||
        job.attemptCount < 1 ||
        job.startedAtMs === null ||
        job.cancelRequestedAtMs !== null ||
        job.terminalError !== null
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Retry-wait jobs retain progress and prior attempts without a pending cancellation.',
        });
      }
    } else if (job.state === 'succeeded') {
      if (
        job.progressBps !== 10_000 ||
        job.attemptCount < 1 ||
        job.startedAtMs === null ||
        job.cancelRequestedAtMs !== null ||
        job.terminalError !== null
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Successful jobs require progress 10000 and no error.',
        });
      }
    } else {
      if (
        job.progressBps >= 10_000 ||
        job.terminalError === null ||
        (job.attemptCount >= 1 && job.progressBps < 1)
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Failed, cancelled, and budget-stopped jobs retain sub-10000 progress and an error.',
        });
      }
      if (job.state === 'cancelled') {
        if (
          job.cancelRequestedAtMs === null ||
          job.terminalError?.category !== 'cancelled' ||
          job.terminalError.code !== 'CANCELLED' ||
          (job.attemptCount === 0
            ? job.startedAtMs !== null || job.progressBps !== 0
            : job.startedAtMs === null)
        ) {
          context.addIssue({
            code: 'custom',
            message: 'Cancelled job timing, request, progress, and error category must cohere.',
          });
        }
      } else if (
        job.attemptCount < 1 ||
        job.startedAtMs === null ||
        job.cancelRequestedAtMs !== null ||
        (job.state === 'budget_stopped'
          ? job.terminalError?.category !== 'budget_stop' ||
            !['BUDGET_LIMIT_EXCEEDED', 'PROVIDER_CALL_LIMIT_EXCEEDED'].includes(
              job.terminalError.code,
            )
          : job.terminalError?.category === 'budget_stop' ||
            job.terminalError?.category === 'cancelled')
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Failed and budget-stopped jobs require a prior attempt and coherent error category.',
        });
      }
    }
  })
  .readonly();

export const GenerationAttemptLifecycleSchema = z
  .strictObject({
    attemptId: GenerationAttemptIdSchema,
    workspaceId: PersistedWorkspaceIdSchema,
    jobId: GenerationJobIdSchema,
    attemptNumber: z.int().min(1).max(MAX_ATTEMPTS),
    state: AttemptStateSchema,
    workerId: WorkerIdSchema,
    leaseToken: LeaseTokenSchema,
    leaseExpiresAtMs: EpochMillisecondsSchema,
    heartbeatAtMs: EpochMillisecondsSchema,
    startedAtMs: EpochMillisecondsSchema,
    finishedAtMs: EpochMillisecondsSchema.nullable(),
    error: PersistedErrorSummarySchema.nullable(),
  })
  .superRefine((attempt, context) => {
    if (
      attempt.heartbeatAtMs < attempt.startedAtMs ||
      attempt.leaseExpiresAtMs <= attempt.heartbeatAtMs
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Attempt heartbeat and lease timing are invalid.',
      });
    }
    if (attempt.state === 'running') {
      if (attempt.finishedAtMs !== null || attempt.error !== null) {
        context.addIssue({ code: 'custom', message: 'Running attempts cannot be finalized.' });
      }
    } else {
      if (
        attempt.finishedAtMs === null ||
        attempt.finishedAtMs < attempt.startedAtMs ||
        attempt.finishedAtMs < attempt.heartbeatAtMs
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Terminal attempts require a valid finish time.',
        });
      }
      if (attempt.state === 'succeeded' ? attempt.error !== null : attempt.error === null) {
        context.addIssue({
          code: 'custom',
          message: 'Only successful attempts omit their terminal error.',
        });
      }
      const category = attempt.error?.category;
      const categoryCoherent =
        attempt.state === 'succeeded' ||
        (attempt.state === 'cancelled' &&
          category === 'cancelled' &&
          attempt.error?.code === 'CANCELLED') ||
        (attempt.state === 'budget_stopped' &&
          category === 'budget_stop' &&
          ['BUDGET_LIMIT_EXCEEDED', 'PROVIDER_CALL_LIMIT_EXCEEDED'].includes(
            attempt.error?.code ?? '',
          )) ||
        (attempt.state === 'timed_out' &&
          category === 'timeout' &&
          ['CAPABILITY_TIMEOUT', 'ATTEMPT_TIMEOUT'].includes(attempt.error?.code ?? '')) ||
        (attempt.state === 'abandoned' &&
          category === 'worker_lost' &&
          attempt.error?.code === 'WORKER_LOST') ||
        (attempt.state === 'failed' &&
          category !== undefined &&
          !['cancelled', 'budget_stop', 'timeout', 'worker_lost'].includes(category));
      if (!categoryCoherent) {
        context.addIssue({
          code: 'custom',
          message: 'Attempt terminal state and error category must cohere.',
        });
      }
    }
  })
  .readonly();

export type GenerationJobLifecycle = z.infer<typeof GenerationJobLifecycleSchema>;
export type GenerationAttemptLifecycle = z.infer<typeof GenerationAttemptLifecycleSchema>;

export type JobTransitionSource = 'creation' | JobState;
export type JobTransitionCause =
  | 'create'
  | 'lease'
  | 'cancel'
  | 'success'
  | 'failure'
  | 'timeout'
  | 'worker_loss'
  | 'budget_stop'
  | 'retry_deadline';

export type ActiveAttemptTransition =
  | { readonly kind: 'none' }
  | { readonly kind: 'create'; readonly state: 'running' }
  | { readonly kind: 'finalize'; readonly state: Exclude<AttemptState, 'running'> };

export interface JobTransitionResult {
  readonly from: JobTransitionSource;
  readonly to: JobState;
  readonly activeAttempt: ActiveAttemptTransition;
}

const JobTransitionSourceSchema = z.union([z.literal('creation'), JobStateSchema]);
const JobTransitionCauseSchema = z.enum([
  'create',
  'lease',
  'cancel',
  'success',
  'failure',
  'timeout',
  'worker_loss',
  'budget_stop',
  'retry_deadline',
]);

const targets = (...states: JobState[]): ReadonlySet<JobState> => new Set(states);

const legalTargetMap: Readonly<Record<JobTransitionSource, ReadonlySet<JobState>>> = Object.freeze({
  creation: targets('queued'),
  queued: targets('running', 'cancelled'),
  running: targets('succeeded', 'retry_wait', 'failed', 'cancelled', 'budget_stopped'),
  retry_wait: targets('running', 'cancelled', 'failed', 'budget_stopped'),
  succeeded: targets(),
  failed: targets(),
  cancelled: targets(),
  budget_stopped: targets(),
});

const attemptFinalStateForCause = (
  cause: 'failure' | 'timeout' | 'worker_loss',
): 'failed' | 'timed_out' | 'abandoned' =>
  cause === 'timeout' ? 'timed_out' : cause === 'worker_loss' ? 'abandoned' : 'failed';

export const transitionJobState = (input: {
  readonly from: JobTransitionSource;
  readonly to: JobState;
  readonly cause: JobTransitionCause;
}): JobTransitionResult => {
  const from = JobTransitionSourceSchema.parse(input.from);
  const to = JobStateSchema.parse(input.to);
  const cause = JobTransitionCauseSchema.parse(input.cause);
  const parsed = { from, to, cause };
  const targets = legalTargetMap[from];
  if (!targets.has(to)) {
    throw new TypeError(`Illegal job transition ${from} -> ${to}.`);
  }

  if (from === 'creation' && to === 'queued' && cause === 'create') {
    return { ...parsed, activeAttempt: { kind: 'none' } };
  }
  if ((from === 'queued' || from === 'retry_wait') && to === 'running' && cause === 'lease') {
    return { ...parsed, activeAttempt: { kind: 'create', state: 'running' } };
  }
  if ((from === 'queued' || from === 'retry_wait') && to === 'cancelled' && cause === 'cancel') {
    return { ...parsed, activeAttempt: { kind: 'none' } };
  }
  if (from === 'retry_wait' && to === 'failed' && cause === 'retry_deadline') {
    return { ...parsed, activeAttempt: { kind: 'none' } };
  }
  if (from === 'retry_wait' && to === 'budget_stopped' && cause === 'budget_stop') {
    return { ...parsed, activeAttempt: { kind: 'none' } };
  }
  if (from === 'running') {
    if (to === 'succeeded' && cause === 'success') {
      return { ...parsed, activeAttempt: { kind: 'finalize', state: 'succeeded' } };
    }
    if (to === 'cancelled' && cause === 'cancel') {
      return { ...parsed, activeAttempt: { kind: 'finalize', state: 'cancelled' } };
    }
    if (to === 'budget_stopped' && cause === 'budget_stop') {
      return { ...parsed, activeAttempt: { kind: 'finalize', state: 'budget_stopped' } };
    }
    if (
      (to === 'retry_wait' || to === 'failed') &&
      (cause === 'failure' || cause === 'timeout' || cause === 'worker_loss')
    ) {
      return {
        ...parsed,
        activeAttempt: { kind: 'finalize', state: attemptFinalStateForCause(cause) },
      };
    }
  }
  throw new TypeError(`Job transition cause ${cause} is invalid for ${from} -> ${to}.`);
};

export const transitionAttemptState = (input: {
  readonly from: AttemptState;
  readonly to: AttemptState;
}): { readonly from: 'running'; readonly to: Exclude<AttemptState, 'running'> } => {
  const from = AttemptStateSchema.parse(input.from);
  const to = AttemptStateSchema.parse(input.to);
  if (from !== 'running' || to === 'running') {
    throw new TypeError(`Illegal attempt transition ${from} -> ${to}.`);
  }
  return { from, to } as {
    readonly from: 'running';
    readonly to: Exclude<AttemptState, 'running'>;
  };
};

export const nextProgressBps = (input: {
  readonly current: number;
  readonly next: number;
  readonly destinationState: JobState;
}): number => {
  const current = z.int().min(0).max(10_000).parse(input.current);
  const next = z.int().min(0).max(10_000).parse(input.next);
  const destinationState = JobStateSchema.parse(input.destinationState);
  if (next < current) throw new RangeError('Job progress cannot decrease.');
  if (destinationState === 'queued' && next !== 0) {
    throw new RangeError('Queued progress must be zero.');
  }
  if (destinationState === 'running' && (next < 1 || next > 9_999)) {
    throw new RangeError('Running progress must be within 1..9999.');
  }
  if (destinationState === 'succeeded' && next !== 10_000) {
    throw new RangeError('Only successful promotion reports progress 10000.');
  }
  if (
    ['retry_wait', 'failed', 'cancelled', 'budget_stopped'].includes(destinationState) &&
    (next !== current || next >= 10_000)
  ) {
    throw new RangeError('Non-success completion retains the prior sub-10000 progress.');
  }
  return next;
};

export type WorkerTerminalState = 'succeeded' | 'failed' | 'budget_stopped';

export const resolveCancellationCommitRace = (input: {
  readonly firstCommit: 'cancellation' | 'worker';
  readonly workerTerminalState: WorkerTerminalState;
}):
  | {
      readonly winner: 'cancellation';
      readonly jobState: 'cancelled';
      readonly attemptState: 'cancelled';
      readonly commitFinalOutput: false;
    }
  | {
      readonly winner: 'worker';
      readonly jobState: WorkerTerminalState;
      readonly attemptState: 'succeeded' | 'failed' | 'budget_stopped';
      readonly laterCancellation: 'return-existing-terminal';
    } => {
  const firstCommit = z.enum(['cancellation', 'worker']).parse(input.firstCommit);
  const workerTerminalState = z
    .enum(['succeeded', 'failed', 'budget_stopped'])
    .parse(input.workerTerminalState);
  if (firstCommit === 'cancellation') {
    return {
      winner: 'cancellation',
      jobState: 'cancelled',
      attemptState: 'cancelled',
      commitFinalOutput: false,
    };
  }
  return {
    winner: 'worker',
    jobState: workerTerminalState,
    attemptState: workerTerminalState,
    laterCancellation: 'return-existing-terminal',
  };
};

export type TemporaryCleanupCause =
  'failure' | 'cancellation' | 'timeout' | 'lease_loss' | 'losing_commit_race';

export interface AttemptTemporaryCleanupPort {
  deleteIncompleteStepBytes(): Promise<void> | void;
  deleteStagedFinalBytes(): Promise<void> | void;
}

export const cleanupAttemptTemporaries = async (
  causeInput: TemporaryCleanupCause,
  cleanup: AttemptTemporaryCleanupPort,
): Promise<{ readonly committedCheckpoints: 'retained' }> => {
  z.enum(['failure', 'cancellation', 'timeout', 'lease_loss', 'losing_commit_race']).parse(
    causeInput,
  );
  const results = await Promise.allSettled([
    Promise.resolve().then(() => cleanup.deleteIncompleteStepBytes()),
    Promise.resolve().then(() => cleanup.deleteStagedFinalBytes()),
  ]);
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Attempt temporary cleanup failed.');
  }
  return { committedCheckpoints: 'retained' };
};
