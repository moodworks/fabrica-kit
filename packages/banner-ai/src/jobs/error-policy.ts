import { createHash } from 'node:crypto';

import { z } from 'zod';

import {
  WorkflowVersionContractSchema,
  type WorkflowVersionContract,
} from '../workflows/workflow-definition.js';
import { ErrorCategorySchema, type AttemptState } from './lifecycle.js';
import {
  ErrorCodeSchema,
  GenerationJobIdSchema,
  SafePersistedMessageSchema,
  StepKeySchema,
  type ErrorCode,
} from './syntax.js';
import { scheduleRetry } from './timing.js';

const errorDefinitions = Object.freeze({
  COMMAND_INVALID: { category: 'validation', retryable: false },
  COST_VALUE_INVALID: { category: 'validation', retryable: false },
  COST_CURRENCY_MISMATCH: { category: 'validation', retryable: false },
  PROJECT_OR_ASSET_NOT_FOUND: { category: 'not_found', retryable: false },
  IDEMPOTENCY_KEY_REUSED: { category: 'conflict', retryable: false },
  CHECKPOINT_IDENTITY_MISMATCH: { category: 'internal', retryable: false },
  CAPABILITY_POLICY_REJECTED: { category: 'policy_rejected', retryable: false },
  EXTERNAL_CALLS_DISABLED: { category: 'policy_rejected', retryable: false },
  EXTERNAL_USAGE_REJECTED: { category: 'policy_rejected', retryable: false },
  PROVIDER_RATE_LIMITED: { category: 'provider_transient', retryable: true },
  PROVIDER_TEMPORARILY_UNAVAILABLE: { category: 'provider_transient', retryable: true },
  PROVIDER_RESULT_INDETERMINATE: { category: 'provider_transient', retryable: true },
  PROVIDER_REQUEST_REJECTED: { category: 'provider_permanent', retryable: false },
  CAPABILITY_TIMEOUT: { category: 'timeout', retryable: true },
  ATTEMPT_TIMEOUT: { category: 'timeout', retryable: true },
  WORKER_LOST: { category: 'worker_lost', retryable: true },
  BUDGET_LIMIT_EXCEEDED: { category: 'budget_stop', retryable: false },
  PROVIDER_CALL_LIMIT_EXCEEDED: { category: 'budget_stop', retryable: false },
  CANCELLED: { category: 'cancelled', retryable: false },
  INTERNAL_INVARIANT: { category: 'internal', retryable: false },
  INTERNAL_TRANSIENT: { category: 'internal', retryable: true },
} as const satisfies Record<
  string,
  { readonly category: z.infer<typeof ErrorCategorySchema>; readonly retryable: boolean }
>);

export type StableJobErrorCode = keyof typeof errorDefinitions;

export const StructuredJobErrorSchema = z
  .strictObject({
    code: ErrorCodeSchema,
    category: ErrorCategorySchema,
    retryable: z.boolean(),
    message: SafePersistedMessageSchema,
  })
  .superRefine((error, context) => {
    const definition = errorDefinitions[error.code as StableJobErrorCode];
    if (
      definition === undefined ||
      error.category !== definition.category ||
      error.retryable !== definition.retryable
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Error classification must match the closed stable code taxonomy.',
      });
    }
  })
  .readonly();

export type StructuredJobError = z.infer<typeof StructuredJobErrorSchema>;

export const createStructuredJobError = (
  codeInput: StableJobErrorCode,
  messageInput: string,
): StructuredJobError => {
  const code = ErrorCodeSchema.parse(codeInput);
  const definition = errorDefinitions[codeInput];
  return StructuredJobErrorSchema.parse({
    code,
    category: definition.category,
    retryable: definition.retryable,
    message: messageInput,
  });
};

export const classifyStableErrorCode = (
  codeInput: unknown,
): Readonly<{ code: ErrorCode; category: StructuredJobError['category']; retryable: boolean }> => {
  const code = ErrorCodeSchema.parse(codeInput);
  const definition = errorDefinitions[code as StableJobErrorCode];
  if (definition === undefined) throw new TypeError('Unknown stable job error code.');
  return Object.freeze({ code, ...definition });
};

export const deriveExternalIdempotencyKey = (input: {
  readonly jobId: string;
  readonly stepKey: string;
  readonly logicalCallNumber: number;
}): string => {
  const jobId = GenerationJobIdSchema.parse(input.jobId);
  const stepKey = StepKeySchema.parse(input.stepKey);
  const logicalCallNumber = z.int().min(1).max(64).parse(input.logicalCallNumber);
  return createHash('sha256')
    .update(`phase1a-call-v1\0${jobId}\0${stepKey}\0${String(logicalCallNumber)}`, 'utf8')
    .digest('hex');
};

const attemptStateForError = (
  code: StableJobErrorCode,
): Exclude<AttemptState, 'running' | 'succeeded'> => {
  if (code === 'CAPABILITY_TIMEOUT' || code === 'ATTEMPT_TIMEOUT') return 'timed_out';
  if (code === 'WORKER_LOST') return 'abandoned';
  if (code === 'CANCELLED') return 'cancelled';
  if (code === 'BUDGET_LIMIT_EXCEEDED' || code === 'PROVIDER_CALL_LIMIT_EXCEEDED') {
    return 'budget_stopped';
  }
  return 'failed';
};

export type ErrorRetryDecision =
  | {
      readonly kind: 'retry';
      readonly jobState: 'retry_wait';
      readonly attemptState: 'failed' | 'timed_out' | 'abandoned';
      readonly attemptErrorCode: StableJobErrorCode;
      readonly nextAttemptNumber: 2 | 3;
      readonly nextAttemptAtMs: number;
      readonly delayMs: 1_000 | 5_000;
    }
  | {
      readonly kind: 'terminal';
      readonly jobState: 'failed' | 'cancelled' | 'budget_stopped';
      readonly attemptState: Exclude<AttemptState, 'running' | 'succeeded'>;
      readonly attemptErrorCode: StableJobErrorCode;
      readonly jobErrorCode: StableJobErrorCode;
      readonly reason:
        | 'not-retryable'
        | 'step-not-replay-safe'
        | 'external-idempotency-unavailable'
        | 'attempts-exhausted'
        | 'job-deadline-prevents-retry';
    };

type TerminalRetryReason = Extract<ErrorRetryDecision, { readonly kind: 'terminal' }>['reason'];

export const decideErrorRetry = (input: {
  readonly error: StructuredJobError;
  readonly workflow: WorkflowVersionContract;
  readonly stepKey: string;
  readonly jobId: string;
  readonly logicalCallNumber: number;
  readonly externalIdempotencyKey: string | null;
  readonly currentAttemptNumber: number;
  readonly finishedAtMs: number;
  readonly jobDeadlineAtMs: number;
  readonly indeterminateProviderCall: boolean;
}): ErrorRetryDecision => {
  const error = StructuredJobErrorSchema.parse(input.error);
  const code = error.code as StableJobErrorCode;
  const authoritative = classifyStableErrorCode(code);
  const workflow = WorkflowVersionContractSchema.parse(input.workflow);
  const stepKey = StepKeySchema.parse(input.stepKey);
  const indeterminateProviderCall = z.boolean().parse(input.indeterminateProviderCall);
  const step = workflow.definition.steps.find((candidate) => candidate.stepKey === stepKey);
  if (step === undefined)
    throw new TypeError('Retry step is absent from the authoritative workflow.');
  if (
    (code === 'PROVIDER_RESULT_INDETERMINATE' && !indeterminateProviderCall) ||
    (indeterminateProviderCall &&
      code !== 'PROVIDER_RESULT_INDETERMINATE' &&
      code !== 'WORKER_LOST')
  ) {
    throw new TypeError(
      'Indeterminate provider-call state must belong to a live indeterminate result or worker loss.',
    );
  }
  const attemptState = attemptStateForError(code);
  const jobErrorCode = indeterminateProviderCall ? 'PROVIDER_RESULT_INDETERMINATE' : code;
  const jobError = classifyStableErrorCode(jobErrorCode);
  const terminalJobState =
    jobError.category === 'budget_stop'
      ? 'budget_stopped'
      : jobError.category === 'cancelled'
        ? 'cancelled'
        : 'failed';

  const terminal = (reason: TerminalRetryReason): ErrorRetryDecision => ({
    kind: 'terminal',
    jobState: terminalJobState,
    attemptState,
    attemptErrorCode: code,
    jobErrorCode,
    reason,
  });

  if (!authoritative.retryable) return terminal('not-retryable');
  if (indeterminateProviderCall) {
    if (!step.replaySafe) return terminal('step-not-replay-safe');
    const expectedKey = deriveExternalIdempotencyKey({
      jobId: input.jobId,
      stepKey,
      logicalCallNumber: input.logicalCallNumber,
    });
    if (
      step.externalIdempotency !== 'job-step-call-v1' ||
      input.externalIdempotencyKey !== expectedKey
    ) {
      return terminal('external-idempotency-unavailable');
    }
  } else if (
    (error.category === 'provider_transient' ||
      error.category === 'timeout' ||
      error.category === 'worker_lost' ||
      error.category === 'internal') &&
    !step.replaySafe
  ) {
    return terminal('step-not-replay-safe');
  }

  const schedule = scheduleRetry({
    currentAttemptNumber: input.currentAttemptNumber,
    finishedAtMs: input.finishedAtMs,
    jobDeadlineAtMs: input.jobDeadlineAtMs,
  });
  if (schedule.kind === 'attempts-exhausted') return terminal('attempts-exhausted');
  if (schedule.kind === 'job-deadline-prevents-retry') {
    return terminal('job-deadline-prevents-retry');
  }
  return {
    kind: 'retry',
    jobState: 'retry_wait',
    attemptState: attemptState as 'failed' | 'timed_out' | 'abandoned',
    attemptErrorCode: code,
    nextAttemptNumber: schedule.nextAttemptNumber,
    nextAttemptAtMs: schedule.nextAttemptAtMs,
    delayMs: schedule.delayMs,
  };
};
