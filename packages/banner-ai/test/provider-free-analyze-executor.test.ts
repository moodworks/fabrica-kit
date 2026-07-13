import { describe, expect, it, vi } from 'vitest';

import {
  AuthoritativeWorkflowExecutionSchema,
  EpochMillisecondsSchema,
  ExistingUsageIdentitySchema,
  GenerationAttemptLifecycleSchema,
  GenerationJobLifecycleSchema,
  INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
  ProviderFreeBannerAnalyzeService,
  ProviderFreeAnalyzeCommitRaceError,
  canonicalizeJson,
  createStructuredJobError,
  createProviderFreeCompositionAnalysisFixturePort,
  decideHeartbeat,
  deriveRunningProgressCommitTarget,
  nextProgressBps,
  operationRequestSha256,
  planAttemptLease,
  projectCanonicalOperationRequest,
  resolveCheckpointReuseCandidate,
  sha256Hex,
  transitionAttemptState,
  transitionJobState,
  validateAtomicUsageReservationResult,
  validateAttemptFailureCommitResult,
  validateCancellationRequestResult,
  validateProviderUsageFinalizationResult,
  verifyCheckpointReuse,
  type AtomicUsageReservationResult,
  type AtomicSuccessCommitRequest,
  type AtomicUsageReservationCommand,
  type AttemptFailureCommitResult,
  type AttemptFailureCommitRequest,
  type AuthoritativeWorkflowExecution,
  type CancellationRequest,
  type CancellationRequestResult,
  type CheckpointCommitRequest,
  type CheckpointMaterial,
  type ExistingUsageIdentity,
  type FinalOutputCommitIdentity,
  type HeartbeatAttemptCommand,
  type LeaseAttemptCommand,
  type PersistedCheckpointIdentity,
  type ProviderUsageFinalizationCommand,
  type ProviderUsageFinalizationResult,
} from '../src/index.js';

const workspaceId = '10000000-0000-4000-8000-000000000001';
const projectId = '20000000-0000-4000-8000-000000000001';
const actorId = '30000000-0000-4000-8000-000000000001';
const sourceAssetVersionId = '40000000-0000-4000-8000-000000000001';
const jobId = '50000000-0000-4000-8000-000000000001';
const attemptId = '60000000-0000-4000-8000-000000000001';
const leaseToken = '70000000-0000-4000-8000-000000000001';
const usageId = '80000000-0000-4000-8000-000000000001';
const outputId = '90000000-0000-4000-8000-000000000001';
const requestId = 'request.executor:0001';
const cancellationActorId = '30000000-0000-4000-8000-000000000002';
const cancellationRequestId = 'request.cancel:0002';
const sourceSha256 = '1'.repeat(64);

const mutatePersistenceResult = (
  input: unknown,
  mutations: readonly {
    readonly path: readonly string[];
    readonly value: unknown;
  }[],
): unknown => {
  const result: unknown = structuredClone(input);
  for (const mutation of mutations) {
    let current = result;
    const parentPath = mutation.path.slice(0, -1);
    for (const segment of parentPath) {
      if (typeof current !== 'object' || current === null || Array.isArray(current)) {
        throw new TypeError('Persistence-result mutation path must resolve through objects.');
      }
      current = (current as Record<string, unknown>)[segment];
    }
    const field = mutation.path.at(-1);
    if (
      field === undefined ||
      typeof current !== 'object' ||
      current === null ||
      Array.isArray(current)
    ) {
      throw new TypeError('Persistence-result mutation must target an object field.');
    }
    (current as Record<string, unknown>)[field] = mutation.value;
  }
  return result;
};

const command = {
  commandVersion: 1,
  projectId,
  operation: 'banner.analyze',
  workflowVersionId: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
  idempotencyKey: 'analyze.executor:0001',
  sourceAssetVersionId,
  parameters: { maxParts: 1, includeBackground: false },
} as const;
const resolution = {
  workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
  inputAssets: [{ assetVersionId: sourceAssetVersionId, sha256: sourceSha256 }],
} as const;
const request = projectCanonicalOperationRequest(command, resolution);
const requestSha256 = operationRequestSha256(command, resolution);
const source = {
  assetId: 'asset_source_0001',
  assetVersionId: sourceAssetVersionId,
  sha256: sourceSha256,
  mediaType: 'image/png' as const,
  byteSize: 100,
  pixelWidth: 300,
  pixelHeight: 250,
};
const proposal = {
  kind: 'composition_proposal' as const,
  proposalVersion: 1 as const,
  sourceAssetSha256: sourceSha256,
  parts: [
    {
      partKey: 'part.body',
      label: 'Body',
      role: 'subject' as const,
      bounds: { xBps: 1_000, yBps: 1_000, widthBps: 8_000, heightBps: 8_000 },
    },
  ],
};

const attemptTwoId = '60000000-0000-4000-8000-000000000002';
const preBoundaryLeaseToken = '70000000-0000-4000-8000-000000000099';
const attemptTwoLeaseToken = '70000000-0000-4000-8000-000000000002';
const attemptOneStartedAtMs = 1_000;
const attemptOneFinishedAtMs = 10_000;
const attemptTwoBoundaryMs = 11_000;

class SyntheticOutputValidationTransientError extends Error {
  readonly structuredError = createStructuredJobError(
    'INTERNAL_TRANSIENT',
    'Synthetic output validation transient failure.',
  );

  constructor() {
    super('Synthetic output validation transient failure.');
    this.name = 'SyntheticOutputValidationTransientError';
  }
}

const buildAnalyzeRetryHarness = () => {
  let nowMs = attemptOneStartedAtMs;
  let job = GenerationJobLifecycleSchema.parse({
    jobId,
    workspaceId,
    projectId,
    initiatedByActorId: actorId,
    requestId,
    operation: 'banner.analyze',
    workflowVersionId: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
    requestSha256,
    state: 'running',
    progressBps: 1,
    attemptCount: 1,
    maxAttempts: 3,
    providerCallCount: 0,
    maxProviderCalls: 64,
    attemptTimeoutMs: 120_000,
    jobTimeoutMs: 600_000,
    nextAttemptAtMs: null,
    cancelRequestedAtMs: null,
    startedAtMs: attemptOneStartedAtMs,
    deadlineAtMs: 601_000,
    finishedAtMs: null,
    terminalError: null,
  });
  let attempt = GenerationAttemptLifecycleSchema.parse({
    attemptId,
    workspaceId,
    jobId,
    attemptNumber: 1,
    state: 'running',
    workerId: 'worker.executor:1',
    leaseToken,
    leaseExpiresAtMs: 31_000,
    heartbeatAtMs: attemptOneStartedAtMs,
    startedAtMs: attemptOneStartedAtMs,
    finishedAtMs: null,
    error: null,
  });
  const attempts = new Map([[1, attempt]]);
  const events: string[] = [];
  const usageRows: ExistingUsageIdentity[] = [];
  const failureRequests: AttemptFailureCommitRequest[] = [];
  const progressCommits: Array<{
    readonly attemptNumber: number;
    readonly currentProgressBps: number;
    readonly targetProgressBps: number;
    readonly kind: 'advanced' | 'unchanged';
  }> = [];
  const reuseCandidates: Array<{
    readonly expected: unknown;
    readonly persisted: unknown;
    readonly material: unknown;
  }> = [];
  const reuseDecisions: unknown[] = [];
  let committedCheckpoint: PersistedCheckpointIdentity | null = null;
  let checkpointMaterial: CheckpointMaterial | null = null;
  let committedFinalOutputs: readonly FinalOutputCommitIdentity[] = [];
  let usageRow: ExistingUsageIdentity | null = null;
  let observedHeldDispatchCount = 0;
  let transientInjectionPending = true;
  let injectedError: SyntheticOutputValidationTransientError | null = null;

  const analysisRequest = {
    sourceAsset: source,
    maxParts: 1,
    includeBackground: false,
  };
  const fixture = createProviderFreeCompositionAnalysisFixturePort({
    initialNowMs: nowMs,
    currency: 'USD',
    fixtures: [
      {
        request: analysisRequest,
        outcomes: [
          {
            kind: 'held-success',
            gateKey: 'retry-analysis-dispatch',
            result: proposal,
          },
        ],
      },
    ],
  });

  const execution = (): AuthoritativeWorkflowExecution =>
    AuthoritativeWorkflowExecutionSchema.parse({
      workspaceId,
      projectId,
      initiatedByActorId: actorId,
      requestId,
      request,
      requestSha256,
      workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
      job,
      attempt,
      attemptDeadlineAtMs: attempt.startedAtMs + 120_000,
    });

  const leasePlanner = vi.fn(planAttemptLease);
  const reserveUnderJobLock = vi.fn(async (reservation: AtomicUsageReservationCommand) => {
    if (usageRow !== null) throw new Error('Analyze retry trace allows one usage row only.');
    usageRow = ExistingUsageIdentitySchema.parse({
      usageId,
      workspaceId: reservation.workspaceId,
      jobId: reservation.jobId,
      attemptId: reservation.attemptId,
      callKey: reservation.callKey,
      capability: reservation.identity.capability,
      providerKey: reservation.identity.providerKey,
      modelKey: reservation.identity.modelKey,
      workflowVersionId: reservation.workflowVersionId,
      external: reservation.identity.external,
      requestSha256: reservation.requestSha256,
      estimatedCostMicros: reservation.identity.estimatedCostMicros,
      currency: reservation.identity.currency,
      status: 'started',
    });
    usageRows.push(usageRow);
    job = GenerationJobLifecycleSchema.parse({
      ...job,
      providerCallCount: job.providerCallCount + 1,
    });
    events.push('reservation-commit');
    return {
      kind: 'reserved' as const,
      usage: usageRow,
      incrementProviderCallCount: true as const,
      createUsageRow: true as const,
      dispatch: 'after-transaction-commit' as const,
    };
  });
  const finalizeUsage = vi.fn(async (finalization: ProviderUsageFinalizationCommand) => {
    if (usageRow === null || usageRow.status !== 'started') {
      throw new Error('Started analyze usage must exist before its only finalization.');
    }
    usageRow = ExistingUsageIdentitySchema.parse({
      ...usageRow,
      status: finalization.status,
    });
    usageRows[0] = usageRow;
    events.push('usage-finalize');
    return {
      kind: 'finalize' as const,
      usage: usageRow,
      finalization: {
        status: finalization.status,
        responseSha256: finalization.responseSha256,
        usageMetrics: finalization.usageMetrics,
        actualCostMicros: finalization.actualCostMicros,
        error: finalization.error,
        finishedAtMs: finalization.finishedAtMs,
      },
    };
  });
  const commitCheckpoint = vi.fn(async (checkpointRequest: CheckpointCommitRequest) => {
    if (committedCheckpoint !== null || checkpointMaterial !== null) {
      throw new Error('Committed analyze checkpoints are immutable and unique by output key.');
    }
    committedCheckpoint = structuredClone(checkpointRequest.checkpoint);
    checkpointMaterial = structuredClone(checkpointRequest.material);
    events.push('checkpoint-commit');
    return structuredClone(committedCheckpoint);
  });
  const finalizeFailure = vi.fn(async (failure: AttemptFailureCommitRequest) => {
    if (failure.decision.kind !== 'retry') {
      throw new Error('Analyze retry trace requires the exact retry decision.');
    }
    expect(
      transitionJobState({ from: 'running', to: failure.decision.jobState, cause: 'failure' }),
    ).toMatchObject({ activeAttempt: { kind: 'finalize', state: 'failed' } });
    expect(
      transitionAttemptState({
        from: failure.currentAttempt.state,
        to: failure.decision.attemptState,
      }),
    ).toEqual({ from: 'running', to: 'failed' });
    expect(
      nextProgressBps({
        current: failure.currentJob.progressBps,
        next: failure.currentJob.progressBps,
        destinationState: failure.decision.jobState,
      }),
    ).toBe(7_000);
    failureRequests.push(structuredClone(failure));
    job = GenerationJobLifecycleSchema.parse({
      ...failure.currentJob,
      state: failure.decision.jobState,
      nextAttemptAtMs: failure.decision.nextAttemptAtMs,
      finishedAtMs: null,
      terminalError: null,
    });
    attempt = GenerationAttemptLifecycleSchema.parse({
      ...failure.currentAttempt,
      state: failure.decision.attemptState,
      finishedAtMs: failure.finishedAtMs,
      error: {
        category: failure.error.category,
        code: failure.decision.attemptErrorCode,
        message: failure.error.message,
      },
    });
    attempts.set(1, attempt);
    events.push('failure-commit');
    return { job, attempt };
  });
  const commitSuccess = vi.fn(async (successRequest: AtomicSuccessCommitRequest) => {
    expect(
      transitionJobState({ from: 'running', to: 'succeeded', cause: 'success' }),
    ).toMatchObject({ activeAttempt: { kind: 'finalize', state: 'succeeded' } });
    expect(transitionAttemptState({ from: attempt.state, to: 'succeeded' })).toEqual({
      from: 'running',
      to: 'succeeded',
    });
    job = GenerationJobLifecycleSchema.parse({
      ...job,
      state: 'succeeded',
      progressBps: nextProgressBps({
        current: job.progressBps,
        next: 10_000,
        destinationState: 'succeeded',
      }),
      nextAttemptAtMs: null,
      finishedAtMs: nowMs,
      terminalError: null,
    });
    attempt = GenerationAttemptLifecycleSchema.parse({
      ...attempt,
      state: 'succeeded',
      finishedAtMs: nowMs,
      error: null,
    });
    attempts.set(2, attempt);
    committedFinalOutputs = structuredClone(successRequest.finalOutputs);
    events.push('atomic-success');
    return {
      job,
      attempt,
      finalOutputs: structuredClone(successRequest.finalOutputs),
    };
  });
  const checkpointVerify = vi.fn(
    async (scope: { workspaceId: string; jobId: string; outputKey: string }) => {
      expect(scope).toEqual({
        workspaceId,
        jobId,
        outputKey: 'analysis.fixture-proposal',
      });
      if (committedCheckpoint === null || checkpointMaterial === null) {
        events.push('checkpoint-absent');
        return resolveCheckpointReuseCandidate({ kind: 'absent' });
      }
      const candidate = {
        expected: {
          workspaceId,
          projectId,
          jobId,
          creatingAttemptId: attemptId,
          requestSha256,
          workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
          outputKey: 'analysis.fixture-proposal',
          reference: { kind: 'analysis_payload' },
        },
        persisted: structuredClone(committedCheckpoint),
        material: structuredClone(checkpointMaterial),
      };
      reuseCandidates.push(structuredClone(candidate));
      const decision = await verifyCheckpointReuse(candidate);
      reuseDecisions.push(structuredClone(decision));
      events.push('checkpoint-reuse-verified');
      return decision;
    },
  );

  const cleanupByAttempt = new Map(
    [attemptId, attemptTwoId].map((currentAttemptId) => [
      currentAttemptId,
      {
        incomplete: vi.fn(() => events.push(`cleanup-incomplete:${currentAttemptId}`)),
        staged: vi.fn(() => events.push(`cleanup-staged:${currentAttemptId}`)),
      },
    ]),
  );

  const jobs = {
    async leaseAttempt(command: LeaseAttemptCommand) {
      if (job.state === 'running' && attempt.attemptNumber === 1) {
        expect(command).toMatchObject({
          workspaceId,
          jobId,
          workerId: attempt.workerId,
          leaseToken,
          nowMs: attemptOneStartedAtMs,
        });
        events.push('lease-attempt-1');
        return { kind: 'leased' as const, job, attempt };
      }
      if (job.state !== 'retry_wait') return { kind: 'not-eligible' as const };
      let planned;
      try {
        planned = leasePlanner({
          jobState: job.state,
          attemptCount: job.attemptCount,
          nowMs: command.nowMs,
          jobStartedAtMs: job.startedAtMs,
          jobDeadlineAtMs: job.deadlineAtMs,
          nextAttemptAtMs: job.nextAttemptAtMs,
          priorAttemptFinishedAtMs: attempt.finishedAtMs,
        });
      } catch (error) {
        if (error instanceof RangeError) return { kind: 'not-eligible' as const };
        throw error;
      }
      expect(transitionJobState({ from: job.state, to: 'running', cause: 'lease' })).toMatchObject({
        activeAttempt: { kind: 'create', state: 'running' },
      });
      job = GenerationJobLifecycleSchema.parse({
        ...job,
        state: 'running',
        progressBps: nextProgressBps({
          current: job.progressBps,
          next: job.progressBps,
          destinationState: 'running',
        }),
        attemptCount: planned.attemptNumber,
        nextAttemptAtMs: null,
        startedAtMs: planned.jobStartedAtMs,
        deadlineAtMs: planned.jobDeadlineAtMs,
      });
      attempt = GenerationAttemptLifecycleSchema.parse({
        attemptId: attemptTwoId,
        workspaceId,
        jobId,
        attemptNumber: planned.attemptNumber,
        state: 'running',
        workerId: command.workerId,
        leaseToken: command.leaseToken,
        leaseExpiresAtMs: planned.leaseExpiresAtMs,
        heartbeatAtMs: planned.heartbeatAtMs,
        startedAtMs: planned.attemptStartedAtMs,
        finishedAtMs: null,
        error: null,
      });
      attempts.set(2, attempt);
      events.push('lease-attempt-2');
      return { kind: 'leased' as const, job, attempt };
    },
    async loadExecutionAggregate() {
      if (transientInjectionPending && attempt.attemptNumber === 1 && job.progressBps === 7_000) {
        transientInjectionPending = false;
        nowMs = attemptOneFinishedAtMs;
        fixture.controller.advanceTo(nowMs);
        injectedError = new SyntheticOutputValidationTransientError();
        events.push('inject-INTERNAL_TRANSIENT:output-validation');
        throw injectedError;
      }
      return execution();
    },
    async recordRunningProgress(progressRequest: unknown) {
      const target = deriveRunningProgressCommitTarget(progressRequest);
      expect(target.currentProgressBps).toBe(job.progressBps);
      const kind =
        target.targetProgressBps === target.currentProgressBps ? 'unchanged' : 'advanced';
      job = GenerationJobLifecycleSchema.parse({ ...job, progressBps: target.targetProgressBps });
      progressCommits.push({ attemptNumber: attempt.attemptNumber, ...target, kind });
      if (kind === 'advanced') events.push(`progress-${String(target.targetProgressBps)}`);
      return { kind, job };
    },
    finalizeAttemptFailure: finalizeFailure,
    commitCheckpoint,
    commitSuccessAtomically: commitSuccess,
  };

  const service = new ProviderFreeBannerAnalyzeService({
    clock: { nowMs: () => EpochMillisecondsSchema.parse(nowMs) },
    uuids: {
      nextUuid: (purpose: 'lease-token' | 'final-output') => {
        if (purpose === 'final-output') return outputId;
        if (nowMs === attemptOneStartedAtMs) return leaseToken;
        if (nowMs < attemptTwoBoundaryMs) return preBoundaryLeaseToken;
        return attemptTwoLeaseToken;
      },
    },
    jobs,
    workflows: { resolveExplicit: async () => INITIAL_BANNER_ANALYZE_WORKFLOW_V1 },
    sources: { resolveSource: async () => source as never },
    budgets: { reserveUnderJobLock },
    usage: {
      async findAttemptCall() {
        return null;
      },
      finalizeOnce: finalizeUsage,
    },
    checkpoints: { verify: checkpointVerify },
    analysis: fixture.port,
    cancellations: {
      forJob: () => ({ cancelled: false, throwIfCancelled() {} }),
      signal() {},
    },
    temporaries: {
      forAttempt: ({ attemptId: currentAttemptId }: { attemptId: string }) => {
        const cleanup = cleanupByAttempt.get(currentAttemptId);
        if (cleanup === undefined) throw new Error('Unknown analyze attempt cleanup scope.');
        return {
          deleteIncompleteStepBytes: cleanup.incomplete,
          deleteStagedFinalBytes: cleanup.staged,
        };
      },
    },
  } as never);

  const sideEffectCounts = () => ({
    reservations: reserveUnderJobLock.mock.calls.length,
    usageRows: usageRows.length,
    usageFinalizations: finalizeUsage.mock.calls.length,
    checkpointCommits: commitCheckpoint.mock.calls.length,
    failureCommits: finalizeFailure.mock.calls.length,
    finalOutputs: committedFinalOutputs.length,
  });
  const durableSnapshot = () =>
    canonicalizeJson({
      job,
      attempt,
      attempts: [...attempts.entries()],
      usageRows,
      committedCheckpoint,
      checkpointMaterial,
      committedFinalOutputs,
    });

  return {
    service,
    fixture,
    events,
    attempts,
    progressCommits,
    failureRequests,
    reuseCandidates,
    reuseDecisions,
    leasePlanner,
    reserveUnderJobLock,
    finalizeUsage,
    commitCheckpoint,
    finalizeFailure,
    commitSuccess,
    checkpointVerify,
    cleanupByAttempt,
    sideEffectCounts,
    durableSnapshot,
    observeHeldDispatch() {
      expect(fixture.controller.pendingGateKeys()).toEqual(['retry-analysis-dispatch']);
      observedHeldDispatchCount += 1;
      events.push('held-dispatch-observed');
    },
    setNowMs(value: number) {
      nowMs = value;
      fixture.controller.advanceTo(value);
    },
    get currentJob() {
      return job;
    },
    get currentAttempt() {
      return attempt;
    },
    get usageRows() {
      return usageRows;
    },
    get committedCheckpoint() {
      return committedCheckpoint;
    },
    get checkpointMaterial() {
      return checkpointMaterial;
    },
    get committedFinalOutputs() {
      return committedFinalOutputs;
    },
    get injectedError() {
      return injectedError;
    },
    get observedHeldDispatchCount() {
      return observedHeldDispatchCount;
    },
  };
};

const buildHarness = (input?: {
  readonly nowMs?: number;
  readonly progressBps?: number;
  readonly attemptNumber?: 1 | 2;
  readonly duplicateReservation?: boolean;
  readonly happyPath?: boolean;
}) => {
  let nowMs = input?.nowMs ?? 1_000;
  const attemptNumber = input?.attemptNumber ?? 1;
  const startedAtMs = attemptNumber === 1 ? nowMs : 1_000;
  let job = GenerationJobLifecycleSchema.parse({
    jobId,
    workspaceId,
    projectId,
    initiatedByActorId: actorId,
    requestId,
    operation: 'banner.analyze',
    workflowVersionId: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
    requestSha256,
    state: 'running',
    progressBps: input?.progressBps ?? 1,
    attemptCount: attemptNumber,
    maxAttempts: 3,
    providerCallCount: input?.duplicateReservation ? 1 : 0,
    maxProviderCalls: 64,
    attemptTimeoutMs: 120_000,
    jobTimeoutMs: 600_000,
    nextAttemptAtMs: null,
    cancelRequestedAtMs: null,
    startedAtMs,
    deadlineAtMs: startedAtMs + 600_000,
    finishedAtMs: null,
    terminalError: null,
  });
  let attempt = GenerationAttemptLifecycleSchema.parse({
    attemptId,
    workspaceId,
    jobId,
    attemptNumber,
    state: 'running' as const,
    workerId: 'worker.executor:1',
    leaseToken,
    leaseExpiresAtMs: nowMs + 30_000,
    heartbeatAtMs: nowMs,
    startedAtMs: nowMs,
    finishedAtMs: null,
    error: null,
  });
  const execution = (): AuthoritativeWorkflowExecution =>
    AuthoritativeWorkflowExecutionSchema.parse({
      workspaceId,
      projectId,
      initiatedByActorId: actorId,
      requestId,
      request,
      requestSha256,
      workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
      job,
      attempt,
      attemptDeadlineAtMs: attempt.startedAtMs + 120_000,
    });
  const events: string[] = [];
  const heartbeatRequests: HeartbeatAttemptCommand[] = [];
  let usageRow: ReturnType<typeof ExistingUsageIdentitySchema.parse> | null = null;
  let committedCheckpoint: unknown = null;
  let committedFinalOutputs: readonly unknown[] = [];
  let committedSuccessAttempt: unknown = null;
  const finalizeUsage = vi.fn(
    async (finalization: {
      status: 'succeeded' | 'failed' | 'indeterminate';
      responseSha256: string | null;
      usageMetrics: Record<string, number>;
      actualCostMicros: string | null;
      error: unknown;
      finishedAtMs: number;
    }) => {
      if (usageRow === null || usageRow.status !== 'started') {
        throw new Error('Usage must exist in started state before finalization.');
      }
      events.push('usage-finalize');
      usageRow = ExistingUsageIdentitySchema.parse({
        ...usageRow,
        status: finalization.status,
      });
      return {
        kind: 'finalize' as const,
        usage: usageRow,
        finalization: {
          status: finalization.status,
          responseSha256: finalization.responseSha256,
          usageMetrics: finalization.usageMetrics,
          actualCostMicros: finalization.actualCostMicros,
          error: finalization.error,
          finishedAtMs: finalization.finishedAtMs,
        },
      };
    },
  );
  const finalizeFailure = vi.fn(
    async (failure: {
      currentAttempt: typeof attempt;
      decision: {
        kind: 'terminal';
        jobState: 'failed';
        attemptState: 'failed';
        jobErrorCode: Parameters<typeof createStructuredJobError>[0];
      };
      error: { code: string; category: string; message: string };
    }) => {
      const jobError = createStructuredJobError(
        failure.decision.jobErrorCode,
        failure.error.message,
      );
      job = GenerationJobLifecycleSchema.parse({
        ...job,
        state: failure.decision.jobState,
        nextAttemptAtMs: null,
        finishedAtMs: nowMs,
        terminalError: {
          category: jobError.category,
          code: jobError.code,
          message: jobError.message,
        },
      });
      const failedAttempt = GenerationAttemptLifecycleSchema.parse({
        ...failure.currentAttempt,
        state: failure.decision.attemptState,
        finishedAtMs: nowMs,
        error: {
          category: failure.error.category,
          code: failure.error.code,
          message: failure.error.message,
        },
      });
      return { job, attempt: failedAttempt };
    },
  );
  const cleanupIncomplete = vi.fn(() => events.push('cleanup-incomplete'));
  const cleanupStaged = vi.fn(() => events.push('cleanup-staged'));
  const analysisRequest = {
    sourceAsset: source,
    maxParts: 1,
    includeBackground: false,
  };
  const fixture = createProviderFreeCompositionAnalysisFixturePort({
    initialNowMs: nowMs,
    currency: 'USD',
    fixtures: [
      {
        request: analysisRequest,
        outcomes: [{ kind: 'held-success', gateKey: 'executor-dispatch', result: proposal }],
      },
    ],
  });
  const jobs = {
    async leaseAttempt(lease: { nowMs: number; leaseToken: string; workerId: string }) {
      expect(lease.nowMs).toBe(nowMs);
      expect(lease.leaseToken).toBe(leaseToken);
      expect(lease.workerId).toBe(attempt.workerId);
      return { kind: 'leased', job, attempt };
    },
    async loadExecutionAggregate() {
      return execution();
    },
    async heartbeatAttempt(heartbeat: HeartbeatAttemptCommand) {
      heartbeatRequests.push(structuredClone(heartbeat));
      const decision = decideHeartbeat({
        lease: {
          leaseToken: attempt.leaseToken,
          jobState: job.state,
          attemptState: attempt.state,
          heartbeatAtMs: attempt.heartbeatAtMs,
          leaseExpiresAtMs: attempt.leaseExpiresAtMs,
          attemptDeadlineAtMs: heartbeat.attemptDeadlineAtMs,
          jobDeadlineAtMs: job.deadlineAtMs!,
        },
        presentedLeaseToken: heartbeat.presentedLeaseToken,
        nowMs: heartbeat.nowMs,
      });
      if (decision.kind === 'rejected') return decision;
      if (
        canonicalizeJson(heartbeat.currentJob) !== canonicalizeJson(job) ||
        canonicalizeJson(heartbeat.currentAttempt) !== canonicalizeJson(attempt)
      ) {
        return { kind: 'rejected' as const, reason: 'stale-state' as const };
      }
      attempt = GenerationAttemptLifecycleSchema.parse({
        ...attempt,
        heartbeatAtMs: decision.heartbeatAtMs,
        leaseExpiresAtMs: decision.leaseExpiresAtMs,
      });
      events.push('heartbeat-renewed');
      return {
        ...decision,
        attemptDeadlineAtMs: heartbeat.attemptDeadlineAtMs,
        job,
        attempt,
      };
    },
    async recordRunningProgress(progressRequest: unknown) {
      const target = deriveRunningProgressCommitTarget(progressRequest);
      const kind =
        target.targetProgressBps === target.currentProgressBps ? 'unchanged' : 'advanced';
      job = GenerationJobLifecycleSchema.parse({ ...job, progressBps: target.targetProgressBps });
      events.push(`progress-${String(target.targetProgressBps)}`);
      return { kind, job };
    },
    finalizeAttemptFailure: finalizeFailure,
    async commitCheckpoint(checkpointRequest: { checkpoint: unknown }) {
      if (!input?.happyPath) throw new Error('checkpoint must not commit in this safety test');
      events.push('checkpoint-commit');
      committedCheckpoint = checkpointRequest.checkpoint;
      return checkpointRequest.checkpoint;
    },
    async commitSuccessAtomically(successRequest: { finalOutputs: readonly unknown[] }) {
      if (!input?.happyPath) throw new Error('success must not commit in this safety test');
      events.push('atomic-success');
      committedFinalOutputs = structuredClone(successRequest.finalOutputs);
      job = GenerationJobLifecycleSchema.parse({
        ...job,
        state: 'succeeded',
        progressBps: 10_000,
        finishedAtMs: nowMs,
      });
      const succeededAttempt = GenerationAttemptLifecycleSchema.parse({
        ...attempt,
        state: 'succeeded',
        finishedAtMs: nowMs,
      });
      committedSuccessAttempt = succeededAttempt;
      return { job, attempt: succeededAttempt, finalOutputs: successRequest.finalOutputs };
    },
  };
  const usage = {
    async findAttemptCall() {
      events.push('usage-find');
      return null;
    },
    finalizeOnce: finalizeUsage,
  };
  const service = new ProviderFreeBannerAnalyzeService({
    clock: { nowMs: () => EpochMillisecondsSchema.parse(nowMs) },
    uuids: {
      nextUuid: (purpose: 'lease-token' | 'final-output') =>
        purpose === 'lease-token' ? leaseToken : outputId,
    },
    jobs,
    workflows: { resolveExplicit: async () => INITIAL_BANNER_ANALYZE_WORKFLOW_V1 },
    sources: { resolveSource: async () => source as never },
    checkpoints: { verify: async () => ({ kind: 'absent', overwrite: false }) },
    budgets: {
      async reserveUnderJobLock(reservation: {
        workspaceId: string;
        jobId: string;
        attemptId: string;
        callKey: string;
        requestSha256: string;
        workflowVersionId: string;
        identity: {
          capability: string;
          providerKey: string;
          modelKey: string;
          external: boolean;
          estimatedCostMicros: string;
          currency: string;
        };
      }) {
        events.push(input?.happyPath ? 'reservation-commit' : 'reserve');
        const existing = ExistingUsageIdentitySchema.parse({
          usageId,
          workspaceId: reservation.workspaceId,
          jobId: reservation.jobId,
          attemptId: reservation.attemptId,
          callKey: reservation.callKey,
          capability: reservation.identity.capability,
          providerKey: reservation.identity.providerKey,
          modelKey: reservation.identity.modelKey,
          workflowVersionId: reservation.workflowVersionId,
          external: reservation.identity.external,
          requestSha256: reservation.requestSha256,
          estimatedCostMicros: reservation.identity.estimatedCostMicros,
          currency: reservation.identity.currency,
          status: 'started',
        });
        if (input?.happyPath) {
          job = GenerationJobLifecycleSchema.parse({
            ...job,
            providerCallCount: job.providerCallCount + 1,
          });
          usageRow = existing;
          return {
            kind: 'reserved',
            usage: existing,
            incrementProviderCallCount: true,
            createUsageRow: true,
            dispatch: 'after-transaction-commit',
          };
        }
        if (!input?.duplicateReservation) throw new Error('no reservation branch is configured');
        return {
          kind: 'duplicate',
          usage: existing,
          incrementProviderCallCount: false,
          createUsageRow: false,
          dispatch: false,
        };
      },
    },
    usage,
    analysis: fixture.port,
    cancellations: {
      forJob: () => ({ cancelled: false, throwIfCancelled() {} }),
      signal() {},
    },
    temporaries: {
      forAttempt: () => ({
        deleteIncompleteStepBytes: cleanupIncomplete,
        deleteStagedFinalBytes: cleanupStaged,
      }),
    },
  } as never);
  return {
    service,
    events,
    fixture,
    finalizeUsage,
    finalizeFailure,
    cleanupIncomplete,
    cleanupStaged,
    heartbeatRequests,
    get attempt() {
      return attempt;
    },
    usage,
    setNowMs(value: number) {
      nowMs = value;
      fixture.controller.advanceTo(value);
    },
    get usageRow() {
      return usageRow;
    },
    get committedCheckpoint() {
      return committedCheckpoint;
    },
    get committedFinalOutputs() {
      return committedFinalOutputs;
    },
    get currentJob() {
      return job;
    },
    get currentAttempt() {
      return attempt;
    },
    get committedSuccessAttempt() {
      return committedSuccessAttempt;
    },
  };
};

type AnalyzeTerminalHarnessMode =
  | 'held-cancellation'
  | 'operation-timeout'
  | 'success-cancellation-race'
  | 'checkpoint-cancellation';

const buildAnalyzeTerminalHarness = (mode: AnalyzeTerminalHarnessMode) => {
  const initialNowMs = mode === 'operation-timeout' ? 590_000 : 1_000;
  const attemptNumber = mode === 'operation-timeout' ? 3 : 1;
  const jobStartedAtMs = 1_000;
  let nowMs = initialNowMs;
  let job = GenerationJobLifecycleSchema.parse({
    jobId,
    workspaceId,
    projectId,
    initiatedByActorId: actorId,
    requestId,
    operation: 'banner.analyze',
    workflowVersionId: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
    requestSha256,
    state: 'running',
    progressBps: 1,
    attemptCount: attemptNumber,
    maxAttempts: 3,
    providerCallCount: 0,
    maxProviderCalls: 64,
    attemptTimeoutMs: 120_000,
    jobTimeoutMs: 600_000,
    nextAttemptAtMs: null,
    cancelRequestedAtMs: null,
    startedAtMs: jobStartedAtMs,
    deadlineAtMs: 601_000,
    finishedAtMs: null,
    terminalError: null,
  });
  let attempt = GenerationAttemptLifecycleSchema.parse({
    attemptId,
    workspaceId,
    jobId,
    attemptNumber,
    state: 'running',
    workerId: 'worker.executor:1',
    leaseToken,
    leaseExpiresAtMs: initialNowMs + 30_000,
    heartbeatAtMs: initialNowMs,
    startedAtMs: initialNowMs,
    finishedAtMs: null,
    error: null,
  });
  const originalJob = structuredClone(job);
  const originalAttempt = structuredClone(attempt);
  const events: string[] = [];
  const progressValues: number[] = [];
  const usageRows: ExistingUsageIdentity[] = [];
  const cancellationRequests: CancellationRequest[] = [];
  const cancellationResults: CancellationRequestResult[] = [];
  const reservationRequests: AtomicUsageReservationCommand[] = [];
  const reservationResults: AtomicUsageReservationResult[] = [];
  const usageFinalizationRequests: ProviderUsageFinalizationCommand[] = [];
  const usageFinalizationResults: ProviderUsageFinalizationResult[] = [];
  const failureRequests: AttemptFailureCommitRequest[] = [];
  const failureResults: AttemptFailureCommitResult[] = [];
  let usageRow: ExistingUsageIdentity | null = null;
  let committedCheckpoint: PersistedCheckpointIdentity | null = null;
  let checkpointMaterial: CheckpointMaterial | null = null;
  let committedFinalOutputs: readonly FinalOutputCommitIdentity[] = [];
  let checkpointWrites = 0;
  let dispatchesObserved = 0;
  let locallyCancelled = false;

  const analysisRequest = {
    sourceAsset: source,
    maxParts: 1,
    includeBackground: false,
  };
  const fixture = createProviderFreeCompositionAnalysisFixturePort({
    initialNowMs,
    currency: 'USD',
    fixtures: [
      {
        request: analysisRequest,
        outcomes: [
          {
            kind: 'held-success',
            gateKey: 'terminal-analysis-dispatch',
            result: proposal,
          },
        ],
      },
    ],
  });

  const execution = (): AuthoritativeWorkflowExecution =>
    AuthoritativeWorkflowExecutionSchema.parse({
      workspaceId,
      projectId,
      initiatedByActorId: actorId,
      requestId,
      request,
      requestSha256,
      workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
      job,
      attempt,
      attemptDeadlineAtMs: attempt.startedAtMs + 120_000,
    });

  const requestCancellation = vi.fn(async (cancellation: CancellationRequest) => {
    cancellationRequests.push(structuredClone(cancellation));
    const firstCancellationAtMs = job.cancelRequestedAtMs ?? cancellation.requestedAtMs;
    job = GenerationJobLifecycleSchema.parse({
      ...job,
      cancelRequestedAtMs: firstCancellationAtMs,
    });
    events.push('cancellation-persist');
    const result: CancellationRequestResult = {
      kind: 'cancellation-requested',
      acknowledgedRequest: structuredClone(cancellation),
      job,
    };
    cancellationResults.push(structuredClone(result));
    return result;
  });

  const reserveUnderJobLock = vi.fn(async (reservation: AtomicUsageReservationCommand) => {
    if (usageRow !== null) throw new Error('Terminal trace permits one usage reservation only.');
    reservationRequests.push(structuredClone(reservation));
    usageRow = ExistingUsageIdentitySchema.parse({
      usageId,
      workspaceId: reservation.workspaceId,
      jobId: reservation.jobId,
      attemptId: reservation.attemptId,
      callKey: reservation.callKey,
      capability: reservation.identity.capability,
      providerKey: reservation.identity.providerKey,
      modelKey: reservation.identity.modelKey,
      workflowVersionId: reservation.workflowVersionId,
      external: reservation.identity.external,
      requestSha256: reservation.requestSha256,
      estimatedCostMicros: reservation.identity.estimatedCostMicros,
      currency: reservation.identity.currency,
      status: 'started',
    });
    usageRows.push(usageRow);
    job = GenerationJobLifecycleSchema.parse({
      ...job,
      providerCallCount: job.providerCallCount + 1,
    });
    events.push('reservation-commit');
    const result: AtomicUsageReservationResult = {
      kind: 'reserved',
      usage: usageRow,
      incrementProviderCallCount: true,
      createUsageRow: true,
      dispatch: 'after-transaction-commit',
    };
    reservationResults.push(structuredClone(result));
    return result;
  });

  const finalizeUsage = vi.fn(async (finalization: ProviderUsageFinalizationCommand) => {
    if (usageRow === null || usageRow.status !== 'started') {
      throw new Error('Terminal trace usage must finalize once from started.');
    }
    usageFinalizationRequests.push(structuredClone(finalization));
    usageRow = ExistingUsageIdentitySchema.parse({
      ...usageRow,
      status: finalization.status,
    });
    usageRows[0] = usageRow;
    events.push('usage-finalize');
    const result: ProviderUsageFinalizationResult = {
      kind: 'finalize',
      usage: usageRow,
      finalization: {
        status: finalization.status,
        responseSha256: finalization.responseSha256,
        usageMetrics: finalization.usageMetrics,
        actualCostMicros: finalization.actualCostMicros,
        error: finalization.error,
        finishedAtMs: finalization.finishedAtMs,
      },
    };
    usageFinalizationResults.push(structuredClone(result));
    return result;
  });

  const finalizeFailure = vi.fn(async (failure: AttemptFailureCommitRequest) => {
    if (failure.decision.kind !== 'terminal') {
      throw new Error('Terminal trace cannot schedule a retry.');
    }
    failureRequests.push(structuredClone(failure));
    job = GenerationJobLifecycleSchema.parse({
      ...failure.currentJob,
      state: failure.decision.jobState,
      nextAttemptAtMs: null,
      finishedAtMs: failure.finishedAtMs,
      terminalError: {
        category: failure.error.category,
        code: failure.decision.jobErrorCode,
        message: failure.error.message,
      },
    });
    attempt = GenerationAttemptLifecycleSchema.parse({
      ...failure.currentAttempt,
      state: failure.decision.attemptState,
      finishedAtMs: failure.finishedAtMs,
      error: {
        category: failure.error.category,
        code: failure.decision.attemptErrorCode,
        message: failure.error.message,
      },
    });
    events.push('failure-commit');
    const result: AttemptFailureCommitResult = { job, attempt };
    failureResults.push(structuredClone(result));
    return result;
  });

  const commitCheckpoint = vi.fn(async (checkpointRequest: CheckpointCommitRequest) => {
    if (mode === 'checkpoint-cancellation') {
      nowMs = 1_500;
      fixture.controller.advanceTo(nowMs);
      job = GenerationJobLifecycleSchema.parse({
        ...job,
        cancelRequestedAtMs: nowMs,
      });
      locallyCancelled = true;
      events.push('checkpoint-cancellation-persist');
      throw new Error('Checkpoint commit observed a persisted cancellation.');
    }
    if (committedCheckpoint !== null || checkpointMaterial !== null) {
      throw new Error('Terminal trace checkpoint is immutable.');
    }
    committedCheckpoint = structuredClone(checkpointRequest.checkpoint);
    checkpointMaterial = structuredClone(checkpointRequest.material);
    checkpointWrites += 1;
    events.push('checkpoint-commit');
    return structuredClone(checkpointRequest.checkpoint);
  });

  const commitSuccess = vi.fn(async () => {
    if (mode !== 'success-cancellation-race') {
      throw new Error('Terminal trace must not attempt success in this mode.');
    }
    nowMs = 2_000;
    fixture.controller.advanceTo(nowMs);
    const cancellation = createStructuredJobError(
      'CANCELLED',
      'The provider-free analyze job was cancelled.',
    );
    job = GenerationJobLifecycleSchema.parse({
      ...job,
      state: 'cancelled',
      cancelRequestedAtMs: nowMs,
      finishedAtMs: nowMs,
      terminalError: {
        category: cancellation.category,
        code: cancellation.code,
        message: cancellation.message,
      },
    });
    attempt = GenerationAttemptLifecycleSchema.parse({
      ...attempt,
      state: 'cancelled',
      finishedAtMs: nowMs,
      error: {
        category: cancellation.category,
        code: cancellation.code,
        message: cancellation.message,
      },
    });
    committedFinalOutputs = [];
    events.push('cancellation-terminal-winner');
    throw new ProviderFreeAnalyzeCommitRaceError('cancellation');
  });

  const leaseAttempt = vi.fn(async (lease: LeaseAttemptCommand) => {
    if (job.state !== 'running') return { kind: 'not-eligible' as const };
    expect(lease).toEqual({
      workspaceId,
      jobId,
      workerId: attempt.workerId,
      leaseToken,
      nowMs,
    });
    events.push('lease');
    return { kind: 'leased' as const, job, attempt };
  });

  const recordRunningProgress = vi.fn(async (progressRequest: unknown) => {
    const target = deriveRunningProgressCommitTarget(progressRequest);
    expect(target.currentProgressBps).toBe(job.progressBps);
    const kind = target.targetProgressBps === target.currentProgressBps ? 'unchanged' : 'advanced';
    job = GenerationJobLifecycleSchema.parse({ ...job, progressBps: target.targetProgressBps });
    progressValues.push(target.targetProgressBps);
    events.push(`progress-${String(target.targetProgressBps)}`);
    return { kind, job };
  });

  const cleanupIncomplete = vi.fn(() => events.push('cleanup-incomplete'));
  const cleanupStaged = vi.fn(() => events.push('cleanup-staged'));
  const signalCancellation = vi.fn(() => {
    events.push('local-cancellation-signal');
    locallyCancelled = true;
  });
  const cancellationSignal = {
    get cancelled() {
      return locallyCancelled;
    },
    throwIfCancelled() {
      if (locallyCancelled) throw new Error('The local analyze cancellation signal fired.');
    },
  };

  const service = new ProviderFreeBannerAnalyzeService({
    clock: { nowMs: () => EpochMillisecondsSchema.parse(nowMs) },
    uuids: {
      nextUuid: (purpose: 'lease-token' | 'final-output') =>
        purpose === 'lease-token' ? leaseToken : outputId,
    },
    jobs: {
      async findIdempotent() {
        return null;
      },
      async createQueued() {
        throw new Error('Terminal finalization trace does not submit jobs.');
      },
      leaseAttempt,
      async heartbeatAttempt() {
        throw new Error('Heartbeat renewal is outside this milestone.');
      },
      recordRunningProgress,
      requestCancellation,
      finalizeAttemptFailure: finalizeFailure,
      commitCheckpoint,
      commitSuccessAtomically: commitSuccess,
      async loadExecutionAggregate() {
        return execution();
      },
    },
    workflows: { resolveExplicit: async () => INITIAL_BANNER_ANALYZE_WORKFLOW_V1 },
    sources: { resolveSource: async () => source as never },
    budgets: { reserveUnderJobLock },
    usage: {
      async findAttemptCall() {
        return null;
      },
      finalizeOnce: finalizeUsage,
    },
    checkpoints: { verify: async () => ({ kind: 'absent', overwrite: false }) },
    analysis: fixture.port,
    cancellations: {
      forJob: () => cancellationSignal,
      signal: signalCancellation,
    },
    temporaries: {
      forAttempt: () => ({
        deleteIncompleteStepBytes: cleanupIncomplete,
        deleteStagedFinalBytes: cleanupStaged,
      }),
    },
  } as never);

  const durableSnapshot = () =>
    canonicalizeJson({
      job,
      attempt,
      usageRows,
      committedCheckpoint,
      checkpointMaterial,
      committedFinalOutputs,
    });
  const sideEffectCounts = () => ({
    reservations: reservationRequests.length,
    usageRows: usageRows.length,
    usageFinalizations: usageFinalizationRequests.length,
    dispatches: dispatchesObserved,
    progressCommits: progressValues.length,
    checkpointWrites,
    failureCommits: failureRequests.length,
    finalOutputs: committedFinalOutputs.length,
  });

  return {
    service,
    fixture,
    events,
    originalJob,
    originalAttempt,
    progressValues,
    usageRows,
    cancellationRequests,
    cancellationResults,
    reservationRequests,
    reservationResults,
    usageFinalizationRequests,
    usageFinalizationResults,
    failureRequests,
    failureResults,
    requestCancellation,
    reserveUnderJobLock,
    finalizeUsage,
    finalizeFailure,
    commitCheckpoint,
    commitSuccess,
    leaseAttempt,
    cleanupIncomplete,
    cleanupStaged,
    signalCancellation,
    durableSnapshot,
    sideEffectCounts,
    observeHeldDispatch() {
      expect(fixture.controller.pendingGateKeys()).toEqual(['terminal-analysis-dispatch']);
      dispatchesObserved += 1;
      events.push('held-dispatch-observed');
    },
    setNowMs(value: number) {
      nowMs = value;
      fixture.controller.advanceTo(value);
    },
    releaseDispatch() {
      fixture.controller.release('terminal-analysis-dispatch');
    },
    get currentJob() {
      return job;
    },
    get currentAttempt() {
      return attempt;
    },
    get usageRow() {
      return usageRow;
    },
    get committedCheckpoint() {
      return committedCheckpoint;
    },
    get checkpointMaterial() {
      return checkpointMaterial;
    },
    get committedFinalOutputs() {
      return committedFinalOutputs;
    },
  };
};

const completeHeldCancellationTrace = async () => {
  const harness = buildAnalyzeTerminalHarness('held-cancellation');
  const executing = harness.service.executeAttempt({
    workspaceId,
    jobId,
    workerId: 'worker.executor:1',
  } as never);
  await vi.waitFor(() =>
    expect(harness.fixture.controller.pendingGateKeys()).toEqual(['terminal-analysis-dispatch']),
  );
  harness.observeHeldDispatch();
  harness.setNowMs(1_500);
  await harness.service.requestCancellation({
    context: {
      actorId: cancellationActorId,
      workspaceId,
      requestId: cancellationRequestId,
    },
    jobId,
  } as never);
  harness.releaseDispatch();
  await executing;
  return harness;
};

describe('timeboxed provider-free analyze executor safety', () => {
  it('renews a held running attempt at cadence without extending either absolute deadline', async () => {
    const harness = buildHarness({ happyPath: true });
    const executing = harness.service.executeAttempt({
      workspaceId,
      jobId,
      workerId: 'worker.executor:1',
    } as never);
    await vi.waitFor(() =>
      expect(harness.fixture.controller.pendingGateKeys()).toEqual(['executor-dispatch']),
    );

    harness.setNowMs(11_000);
    const heartbeat = await harness.service.heartbeatAttempt({
      workspaceId,
      jobId,
      attemptId,
      leaseToken,
    } as never);
    expect(heartbeat).toMatchObject({
      kind: 'renewed',
      heartbeatAtMs: 11_000,
      nextHeartbeatAtMs: 21_000,
      leaseExpiresAtMs: 41_000,
      attemptDeadlineAtMs: 121_000,
      jobDeadlineAtMs: 601_000,
    });
    expect(harness.currentJob).toMatchObject({ startedAtMs: 1_000, deadlineAtMs: 601_000 });
    expect(harness.currentAttempt).toMatchObject({
      startedAtMs: 1_000,
      heartbeatAtMs: 11_000,
      leaseExpiresAtMs: 41_000,
    });
    expect(harness.heartbeatRequests).toHaveLength(1);
    expect(harness.events).toEqual(['progress-1000', 'reservation-commit', 'heartbeat-renewed']);

    harness.fixture.controller.release('executor-dispatch');
    await expect(executing).resolves.toMatchObject({ kind: 'succeeded' });
    expect(harness.currentJob).toMatchObject({
      state: 'succeeded',
      startedAtMs: 1_000,
      deadlineAtMs: 601_000,
    });
    expect(harness.committedSuccessAttempt).toMatchObject({
      state: 'succeeded',
      startedAtMs: 1_000,
      heartbeatAtMs: 11_000,
      leaseExpiresAtMs: 41_000,
    });
  });

  it('commits reservation before held dispatch and completes one exact provider-free success', async () => {
    const harness = buildHarness({ happyPath: true });
    const executing = harness.service.executeAttempt({
      workspaceId,
      jobId,
      workerId: 'worker.executor:1',
    } as never);

    await vi.waitFor(() =>
      expect(harness.fixture.controller.pendingGateKeys()).toEqual(['executor-dispatch']),
    );
    expect(harness.events).toEqual(['progress-1000', 'reservation-commit']);
    expect(harness.usageRow).toMatchObject({
      usageId,
      status: 'started',
      external: false,
      capability: 'fixture_replay',
      providerKey: 'fixture',
      modelKey: 'phase1a-fixture-v1',
      estimatedCostMicros: '0',
      currency: 'USD',
    });
    expect(harness.currentJob.providerCallCount).toBe(1);
    expect(harness.finalizeUsage).not.toHaveBeenCalled();
    expect(harness.committedCheckpoint).toBeNull();
    expect(harness.committedFinalOutputs).toEqual([]);
    expect(harness.finalizeFailure).not.toHaveBeenCalled();
    harness.events.push('dispatch-held');

    harness.fixture.controller.release('executor-dispatch');
    const result = await executing;
    const responseSha256 = sha256Hex(Buffer.from(canonicalizeJson(proposal), 'utf8'));
    expect(harness.events).toEqual([
      'progress-1000',
      'reservation-commit',
      'dispatch-held',
      'usage-finalize',
      'checkpoint-commit',
      'progress-7000',
      'progress-8500',
      'atomic-success',
    ]);
    expect(harness.finalizeUsage).toHaveBeenCalledOnce();
    expect(harness.finalizeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'succeeded',
        responseSha256,
        usageMetrics: {
          calls: 1,
          inputTokens: 0,
          outputTokens: 0,
          inputPixels: 0,
          outputImages: 0,
          computeMs: 0,
        },
        actualCostMicros: '0',
        error: null,
      }),
    );
    expect(harness.usageRow).toMatchObject({ status: 'succeeded' });
    expect(harness.committedCheckpoint).toMatchObject({
      output: { outputKey: 'analysis.fixture-proposal', disposition: 'checkpoint' },
      contentSha256: responseSha256,
      payload: proposal,
    });
    expect(harness.committedFinalOutputs).toEqual([
      expect.objectContaining({
        outputId,
        workspaceId,
        projectId,
        jobId,
        attemptId,
        declaration: expect.objectContaining({
          outputKey: 'analysis.proposal',
          disposition: 'final',
        }),
        contentSha256: responseSha256,
        material: { kind: 'analysis_payload', payload: proposal },
      }),
    ]);
    expect(result).toMatchObject({
      kind: 'succeeded',
      checkpoint: 'created',
      job: { state: 'succeeded', progressBps: 10_000, providerCallCount: 1 },
    });
    expect(harness.committedSuccessAttempt).toMatchObject({
      attemptId,
      state: 'succeeded',
      finishedAtMs: 1_000,
      error: null,
    });
    expect(harness.finalizeFailure).not.toHaveBeenCalled();
    expect(harness.cleanupIncomplete).not.toHaveBeenCalled();
    expect(harness.cleanupStaged).not.toHaveBeenCalled();
  });

  it('never dispatches, finalizes, or rewrites the winning usage on a duplicate reservation', async () => {
    const harness = buildHarness({ duplicateReservation: true });
    await expect(
      harness.service.executeAttempt({
        workspaceId,
        jobId,
        workerId: 'worker.executor:1',
      } as never),
    ).resolves.toEqual({ kind: 'lost-commit-race', winner: 'another-worker' });
    expect(harness.events).toEqual([
      'progress-1000',
      'reserve',
      'cleanup-incomplete',
      'cleanup-staged',
    ]);
    expect(harness.finalizeUsage).not.toHaveBeenCalled();
    expect(harness.finalizeFailure).not.toHaveBeenCalled();
    expect(harness.fixture.controller.pendingGateKeys()).toEqual([]);
  });

  it('fails closed before every mutation when lease-loss recovery is requested before expiry', async () => {
    const harness = buildHarness({ nowMs: 1_000 });
    harness.setNowMs(harness.attempt.leaseExpiresAtMs - 1);
    await expect(
      harness.service.recoverLeaseLoss({
        workspaceId,
        jobId,
        attemptId,
        leaseToken,
      } as never),
    ).rejects.toThrow('live analyze lease');
    expect(harness.events).toEqual([]);
    expect(harness.finalizeUsage).not.toHaveBeenCalled();
    expect(harness.finalizeFailure).not.toHaveBeenCalled();
    expect(harness.cleanupIncomplete).not.toHaveBeenCalled();
    expect(harness.cleanupStaged).not.toHaveBeenCalled();
  });

  it('treats absent checkpoint at durable progress 7000 as terminal corruption before reserve', async () => {
    const harness = buildHarness({ nowMs: 7_000, attemptNumber: 2, progressBps: 7_000 });
    const result = await harness.service.executeAttempt({
      workspaceId,
      jobId,
      workerId: 'worker.executor:1',
    } as never);
    expect(result).toMatchObject({ kind: 'terminal', code: 'CHECKPOINT_IDENTITY_MISMATCH' });
    expect(harness.events).toEqual(['progress-7000', 'cleanup-incomplete', 'cleanup-staged']);
    expect(harness.finalizeUsage).not.toHaveBeenCalled();
    expect(harness.finalizeFailure).toHaveBeenCalledOnce();
  });

  it('waits exactly 1000ms and resumes attempt 2 from the immutable attempt-1 checkpoint', async () => {
    const harness = buildAnalyzeRetryHarness();
    const firstExecution = harness.service.executeAttempt({
      workspaceId,
      jobId,
      workerId: 'worker.executor:1',
    } as never);

    await vi.waitFor(() =>
      expect(harness.fixture.controller.pendingGateKeys()).toEqual(['retry-analysis-dispatch']),
    );
    expect(harness.events).toEqual([
      'lease-attempt-1',
      'progress-1000',
      'checkpoint-absent',
      'reservation-commit',
    ]);
    expect(harness.sideEffectCounts()).toEqual({
      reservations: 1,
      usageRows: 1,
      usageFinalizations: 0,
      checkpointCommits: 0,
      failureCommits: 0,
      finalOutputs: 0,
    });
    expect(harness.observedHeldDispatchCount).toBe(0);
    harness.observeHeldDispatch();
    expect(harness.observedHeldDispatchCount).toBe(1);
    harness.fixture.controller.release('retry-analysis-dispatch');

    const firstResult = await firstExecution;
    const responseSha256 = sha256Hex(Buffer.from(canonicalizeJson(proposal), 'utf8'));
    const transientError = createStructuredJobError(
      'INTERNAL_TRANSIENT',
      'Synthetic output validation transient failure.',
    );
    expect(harness.injectedError?.structuredError).toEqual(transientError);
    expect(firstResult).toEqual({
      kind: 'retry-scheduled',
      job: harness.currentJob,
      nextAttemptAtMs: attemptTwoBoundaryMs,
      delayMs: 1_000,
    });
    expect(harness.currentJob).toMatchObject({
      state: 'retry_wait',
      progressBps: 7_000,
      attemptCount: 1,
      providerCallCount: 1,
      nextAttemptAtMs: attemptOneFinishedAtMs + 1_000,
      startedAtMs: attemptOneStartedAtMs,
      deadlineAtMs: 601_000,
      finishedAtMs: null,
      terminalError: null,
    });
    expect(harness.attempts.get(1)).toEqual(
      expect.objectContaining({
        attemptId,
        attemptNumber: 1,
        state: 'failed',
        finishedAtMs: attemptOneFinishedAtMs,
        error: {
          code: 'INTERNAL_TRANSIENT',
          category: 'internal',
          message: transientError.message,
        },
      }),
    );
    expect(harness.failureRequests).toEqual([
      expect.objectContaining({
        stepKey: 'output-validation',
        currentAttemptNumber: 1,
        finishedAtMs: attemptOneFinishedAtMs,
        error: transientError,
        decision: {
          kind: 'retry',
          jobState: 'retry_wait',
          attemptState: 'failed',
          attemptErrorCode: 'INTERNAL_TRANSIENT',
          nextAttemptNumber: 2,
          nextAttemptAtMs: attemptTwoBoundaryMs,
          delayMs: 1_000,
        },
      }),
    ]);
    expect(harness.usageRows).toEqual([
      expect.objectContaining({
        usageId,
        attemptId,
        external: false,
        capability: 'fixture_replay',
        providerKey: 'fixture',
        modelKey: 'phase1a-fixture-v1',
        estimatedCostMicros: '0',
        currency: 'USD',
        status: 'succeeded',
      }),
    ]);
    expect(harness.finalizeUsage).toHaveBeenCalledOnce();
    expect(harness.finalizeUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'succeeded',
        responseSha256,
        usageMetrics: {
          calls: 1,
          inputTokens: 0,
          outputTokens: 0,
          inputPixels: 0,
          outputImages: 0,
          computeMs: 0,
        },
        actualCostMicros: '0',
        error: null,
      }),
    );
    expect(harness.progressCommits).toEqual([
      {
        attemptNumber: 1,
        currentProgressBps: 1,
        targetProgressBps: 1_000,
        kind: 'advanced',
      },
      {
        attemptNumber: 1,
        currentProgressBps: 1_000,
        targetProgressBps: 7_000,
        kind: 'advanced',
      },
    ]);
    expect(harness.committedFinalOutputs).toEqual([]);
    expect(harness.events).toEqual([
      'lease-attempt-1',
      'progress-1000',
      'checkpoint-absent',
      'reservation-commit',
      'held-dispatch-observed',
      'usage-finalize',
      'checkpoint-commit',
      'progress-7000',
      'inject-INTERNAL_TRANSIENT:output-validation',
      'failure-commit',
      `cleanup-incomplete:${attemptId}`,
      `cleanup-staged:${attemptId}`,
    ]);

    const checkpointBeforeRetry = harness.committedCheckpoint;
    const materialBeforeRetry = harness.checkpointMaterial;
    if (checkpointBeforeRetry === null || materialBeforeRetry === null) {
      throw new Error('Attempt 1 must retain its committed checkpoint and material.');
    }
    const clonedCheckpointBeforeRetry = structuredClone(checkpointBeforeRetry);
    const clonedMaterialBeforeRetry = structuredClone(materialBeforeRetry);
    const checkpointCanonicalBeforeRetry = canonicalizeJson(clonedCheckpointBeforeRetry);
    const materialCanonicalBeforeRetry = canonicalizeJson(clonedMaterialBeforeRetry);
    expect(clonedCheckpointBeforeRetry).toMatchObject({
      attemptId,
      output: {
        outputKey: 'analysis.fixture-proposal',
        disposition: 'checkpoint',
        replaySafe: true,
      },
      contentSha256: responseSha256,
      payload: proposal,
    });

    harness.setNowMs(attemptTwoBoundaryMs - 1);
    const preBoundarySnapshot = harness.durableSnapshot();
    const preBoundaryEffects = harness.sideEffectCounts();
    const preBoundaryEvents = [...harness.events];
    await expect(
      harness.service.executeAttempt({
        workspaceId,
        jobId,
        workerId: 'worker.executor:1',
      } as never),
    ).resolves.toEqual({ kind: 'not-eligible' });
    expect(harness.leasePlanner).toHaveBeenCalledOnce();
    expect(harness.leasePlanner).toHaveBeenCalledWith({
      jobState: 'retry_wait',
      attemptCount: 1,
      nowMs: attemptTwoBoundaryMs - 1,
      jobStartedAtMs: attemptOneStartedAtMs,
      jobDeadlineAtMs: 601_000,
      nextAttemptAtMs: attemptTwoBoundaryMs,
      priorAttemptFinishedAtMs: attemptOneFinishedAtMs,
    });
    expect(harness.leasePlanner.mock.results[0]).toMatchObject({ type: 'throw' });
    expect(harness.durableSnapshot()).toBe(preBoundarySnapshot);
    expect(harness.sideEffectCounts()).toEqual(preBoundaryEffects);
    expect(harness.events).toEqual(preBoundaryEvents);
    expect(harness.checkpointVerify).toHaveBeenCalledOnce();

    harness.setNowMs(attemptTwoBoundaryMs);
    const secondResult = await harness.service.executeAttempt({
      workspaceId,
      jobId,
      workerId: 'worker.executor:1',
    } as never);
    expect(harness.leasePlanner).toHaveBeenCalledTimes(2);
    expect(harness.leasePlanner.mock.calls[1]).toEqual([
      {
        jobState: 'retry_wait',
        attemptCount: 1,
        nowMs: attemptTwoBoundaryMs,
        jobStartedAtMs: attemptOneStartedAtMs,
        jobDeadlineAtMs: 601_000,
        nextAttemptAtMs: attemptTwoBoundaryMs,
        priorAttemptFinishedAtMs: attemptOneFinishedAtMs,
      },
    ]);
    expect(harness.leasePlanner.mock.results[1]).toEqual({
      type: 'return',
      value: {
        attemptNumber: 2,
        attemptStartedAtMs: attemptTwoBoundaryMs,
        attemptDeadlineAtMs: 131_000,
        heartbeatAtMs: attemptTwoBoundaryMs,
        nextHeartbeatAtMs: 21_000,
        leaseExpiresAtMs: 41_000,
        jobStartedAtMs: attemptOneStartedAtMs,
        jobDeadlineAtMs: 601_000,
      },
    });
    expect(secondResult).toEqual({
      kind: 'succeeded',
      job: harness.currentJob,
      checkpoint: 'reused',
    });
    expect(harness.currentJob).toMatchObject({
      state: 'succeeded',
      progressBps: 10_000,
      attemptCount: 2,
      providerCallCount: 1,
      startedAtMs: attemptOneStartedAtMs,
      deadlineAtMs: 601_000,
      nextAttemptAtMs: null,
      finishedAtMs: attemptTwoBoundaryMs,
      terminalError: null,
    });
    expect(harness.attempts.get(2)).toMatchObject({
      attemptId: attemptTwoId,
      attemptNumber: 2,
      leaseToken: attemptTwoLeaseToken,
      startedAtMs: attemptTwoBoundaryMs,
      state: 'succeeded',
      finishedAtMs: attemptTwoBoundaryMs,
      error: null,
    });
    expect(attemptTwoId).not.toBe(attemptId);
    expect(attemptTwoLeaseToken).not.toBe(leaseToken);
    expect(harness.progressCommits).toEqual([
      {
        attemptNumber: 1,
        currentProgressBps: 1,
        targetProgressBps: 1_000,
        kind: 'advanced',
      },
      {
        attemptNumber: 1,
        currentProgressBps: 1_000,
        targetProgressBps: 7_000,
        kind: 'advanced',
      },
      {
        attemptNumber: 2,
        currentProgressBps: 7_000,
        targetProgressBps: 7_000,
        kind: 'unchanged',
      },
      {
        attemptNumber: 2,
        currentProgressBps: 7_000,
        targetProgressBps: 7_000,
        kind: 'unchanged',
      },
      {
        attemptNumber: 2,
        currentProgressBps: 7_000,
        targetProgressBps: 8_500,
        kind: 'advanced',
      },
    ]);
    expect(harness.checkpointVerify).toHaveBeenCalledTimes(2);
    expect(harness.reuseCandidates).toEqual([
      {
        expected: {
          workspaceId,
          projectId,
          jobId,
          creatingAttemptId: attemptId,
          requestSha256,
          workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
          outputKey: 'analysis.fixture-proposal',
          reference: { kind: 'analysis_payload' },
        },
        persisted: clonedCheckpointBeforeRetry,
        material: clonedMaterialBeforeRetry,
      },
    ]);
    expect(harness.reuseDecisions).toEqual([
      {
        kind: 'reuse',
        checkpoint: clonedCheckpointBeforeRetry,
        contentSha256: responseSha256,
        overwrite: false,
      },
    ]);
    expect(canonicalizeJson(harness.committedCheckpoint)).toBe(checkpointCanonicalBeforeRetry);
    expect(canonicalizeJson(harness.checkpointMaterial)).toBe(materialCanonicalBeforeRetry);
    expect(harness.committedFinalOutputs).toEqual([
      expect.objectContaining({
        outputId,
        workspaceId,
        projectId,
        jobId,
        attemptId: attemptTwoId,
        declaration: expect.objectContaining({
          outputKey: 'analysis.proposal',
          disposition: 'final',
        }),
        contentSha256: responseSha256,
        material: { kind: 'analysis_payload', payload: proposal },
      }),
    ]);
    expect(harness.sideEffectCounts()).toEqual({
      reservations: 1,
      usageRows: 1,
      usageFinalizations: 1,
      checkpointCommits: 1,
      failureCommits: 1,
      finalOutputs: 1,
    });
    expect(harness.observedHeldDispatchCount).toBe(1);
    expect(harness.events.filter((event) => event === 'held-dispatch-observed')).toHaveLength(1);
    expect(harness.reserveUnderJobLock).toHaveBeenCalledOnce();
    expect(harness.commitCheckpoint).toHaveBeenCalledOnce();
    expect(harness.finalizeFailure).toHaveBeenCalledOnce();
    expect(harness.commitSuccess).toHaveBeenCalledOnce();
    expect(harness.fixture.controller.pendingGateKeys()).toEqual([]);
    expect(harness.cleanupByAttempt.get(attemptId)?.incomplete).toHaveBeenCalledOnce();
    expect(harness.cleanupByAttempt.get(attemptId)?.staged).toHaveBeenCalledOnce();
    expect(harness.cleanupByAttempt.get(attemptTwoId)?.incomplete).not.toHaveBeenCalled();
    expect(harness.cleanupByAttempt.get(attemptTwoId)?.staged).not.toHaveBeenCalled();
    expect(harness.events).toEqual([
      'lease-attempt-1',
      'progress-1000',
      'checkpoint-absent',
      'reservation-commit',
      'held-dispatch-observed',
      'usage-finalize',
      'checkpoint-commit',
      'progress-7000',
      'inject-INTERNAL_TRANSIENT:output-validation',
      'failure-commit',
      `cleanup-incomplete:${attemptId}`,
      `cleanup-staged:${attemptId}`,
      'lease-attempt-2',
      'checkpoint-reuse-verified',
      'progress-8500',
      'atomic-success',
    ]);
  });

  it('persists held cancellation, finalizes uncertain usage, then terminalizes once', async () => {
    const harness = buildAnalyzeTerminalHarness('held-cancellation');
    const executing = harness.service.executeAttempt({
      workspaceId,
      jobId,
      workerId: 'worker.executor:1',
    } as never);

    await vi.waitFor(() =>
      expect(harness.fixture.controller.pendingGateKeys()).toEqual(['terminal-analysis-dispatch']),
    );
    expect(harness.events).toEqual(['lease', 'progress-1000', 'reservation-commit']);
    harness.observeHeldDispatch();
    expect(harness.sideEffectCounts()).toEqual({
      reservations: 1,
      usageRows: 1,
      usageFinalizations: 0,
      dispatches: 1,
      progressCommits: 1,
      checkpointWrites: 0,
      failureCommits: 0,
      finalOutputs: 0,
    });
    expect(harness.usageRow).toMatchObject({ status: 'started' });
    expect(harness.currentJob).toMatchObject({
      state: 'running',
      progressBps: 1_000,
      providerCallCount: 1,
      cancelRequestedAtMs: null,
      deadlineAtMs: 601_000,
    });

    harness.setNowMs(1_500);
    const cancellation = await harness.service.requestCancellation({
      context: {
        actorId: cancellationActorId,
        workspaceId,
        requestId: cancellationRequestId,
      },
      jobId,
    } as never);
    expect(cancellation).toEqual({
      kind: 'cancellation-requested',
      acknowledgedRequest: {
        context: {
          actorId: cancellationActorId,
          workspaceId,
          requestId: cancellationRequestId,
        },
        jobId,
        requestedAtMs: 1_500,
      },
      job: harness.currentJob,
    });
    expect(harness.cancellationRequests).toEqual([
      {
        context: {
          actorId: cancellationActorId,
          workspaceId,
          requestId: cancellationRequestId,
        },
        jobId,
        requestedAtMs: 1_500,
      },
    ]);
    expect(harness.events.slice(-2)).toEqual(['cancellation-persist', 'local-cancellation-signal']);
    expect(harness.currentJob).toMatchObject({
      initiatedByActorId: actorId,
      requestId,
      requestSha256,
      cancelRequestedAtMs: 1_500,
      state: 'running',
    });
    expect(cancellationActorId).not.toBe(actorId);
    expect(cancellationRequestId).not.toBe(requestId);

    harness.releaseDispatch();
    const result = await executing;
    const cancelled = createStructuredJobError(
      'CANCELLED',
      'The provider-free analyze job was cancelled.',
    );
    expect(result).toEqual({
      kind: 'terminal',
      job: harness.currentJob,
      code: 'CANCELLED',
    });
    expect(harness.events).toEqual([
      'lease',
      'progress-1000',
      'reservation-commit',
      'held-dispatch-observed',
      'cancellation-persist',
      'local-cancellation-signal',
      'usage-finalize',
      'failure-commit',
      'cleanup-incomplete',
      'cleanup-staged',
    ]);
    expect(harness.usageFinalizationRequests).toEqual([
      expect.objectContaining({
        status: 'indeterminate',
        responseSha256: null,
        actualCostMicros: '0',
        finishedAtMs: 1_500,
        error: createStructuredJobError(
          'PROVIDER_RESULT_INDETERMINATE',
          'The started fixture call did not produce a trustworthy committed result.',
        ),
      }),
    ]);
    expect(harness.usageRow).toMatchObject({
      usageId,
      workspaceId,
      jobId,
      attemptId,
      status: 'indeterminate',
    });
    expect(harness.failureRequests).toEqual([
      expect.objectContaining({
        workspaceId,
        projectId,
        jobId,
        attemptId,
        currentAttemptNumber: 1,
        finishedAtMs: 1_500,
        jobDeadlineAtMs: 601_000,
        cancelRequestedAtMs: 1_500,
        indeterminateProviderCall: false,
        error: cancelled,
        decision: {
          kind: 'terminal',
          jobState: 'cancelled',
          attemptState: 'cancelled',
          attemptErrorCode: 'CANCELLED',
          jobErrorCode: 'CANCELLED',
          reason: 'not-retryable',
        },
      }),
    ]);
    expect(harness.currentJob).toEqual({
      ...harness.originalJob,
      state: 'cancelled',
      progressBps: 1_000,
      providerCallCount: 1,
      cancelRequestedAtMs: 1_500,
      finishedAtMs: 1_500,
      terminalError: {
        category: cancelled.category,
        code: cancelled.code,
        message: cancelled.message,
      },
    });
    expect(harness.currentAttempt).toEqual({
      ...harness.originalAttempt,
      state: 'cancelled',
      finishedAtMs: 1_500,
      error: {
        category: cancelled.category,
        code: cancelled.code,
        message: cancelled.message,
      },
    });
    expect(harness.progressValues).toEqual([1_000]);
    expect(harness.committedCheckpoint).toBeNull();
    expect(harness.checkpointMaterial).toBeNull();
    expect(harness.committedFinalOutputs).toEqual([]);
    expect(harness.commitCheckpoint).not.toHaveBeenCalled();
    expect(harness.commitSuccess).not.toHaveBeenCalled();
    expect(harness.finalizeUsage).toHaveBeenCalledOnce();
    expect(harness.finalizeFailure).toHaveBeenCalledOnce();
    expect(harness.cleanupIncomplete).toHaveBeenCalledOnce();
    expect(harness.cleanupStaged).toHaveBeenCalledOnce();
    expect(harness.sideEffectCounts()).toEqual({
      reservations: 1,
      usageRows: 1,
      usageFinalizations: 1,
      dispatches: 1,
      progressCommits: 1,
      checkpointWrites: 0,
      failureCommits: 1,
      finalOutputs: 0,
    });

    const terminalSnapshot = harness.durableSnapshot();
    const terminalEffects = harness.sideEffectCounts();
    const terminalEvents = [...harness.events];
    await expect(
      harness.service.executeAttempt({
        workspaceId,
        jobId,
        workerId: 'worker.executor:1',
      } as never),
    ).resolves.toEqual({ kind: 'not-eligible' });
    expect(harness.durableSnapshot()).toBe(terminalSnapshot);
    expect(harness.sideEffectCounts()).toEqual(terminalEffects);
    expect(harness.events).toEqual(terminalEvents);
  });

  it('expires attempt 3 at the immutable absolute job deadline and finalizes in order', async () => {
    const harness = buildAnalyzeTerminalHarness('operation-timeout');
    expect(harness.originalJob).toMatchObject({
      attemptCount: 3,
      startedAtMs: 1_000,
      deadlineAtMs: 601_000,
    });
    expect(harness.originalAttempt).toMatchObject({
      attemptNumber: 3,
      startedAtMs: 590_000,
      leaseExpiresAtMs: 620_000,
    });
    expect(harness.originalAttempt.startedAtMs + 120_000).toBe(710_000);
    expect(harness.originalJob.deadlineAtMs! - harness.originalAttempt.startedAtMs).toBe(11_000);

    const executing = harness.service.executeAttempt({
      workspaceId,
      jobId,
      workerId: 'worker.executor:1',
    } as never);
    await vi.waitFor(() =>
      expect(harness.fixture.controller.pendingGateKeys()).toEqual(['terminal-analysis-dispatch']),
    );
    harness.observeHeldDispatch();
    expect(harness.events).toEqual([
      'lease',
      'progress-1000',
      'reservation-commit',
      'held-dispatch-observed',
    ]);

    harness.setNowMs(601_000);
    harness.releaseDispatch();
    const result = await executing;
    const timedOut = createStructuredJobError(
      'ATTEMPT_TIMEOUT',
      'The provider-free analyze attempt exceeded its deadline.',
    );
    expect(result).toEqual({
      kind: 'terminal',
      job: harness.currentJob,
      code: 'ATTEMPT_TIMEOUT',
    });
    expect(harness.events).toEqual([
      'lease',
      'progress-1000',
      'reservation-commit',
      'held-dispatch-observed',
      'usage-finalize',
      'failure-commit',
      'cleanup-incomplete',
      'cleanup-staged',
    ]);
    expect(harness.usageFinalizationRequests).toEqual([
      expect.objectContaining({
        status: 'failed',
        responseSha256: null,
        error: timedOut,
        finishedAtMs: 601_000,
      }),
    ]);
    expect(harness.usageRow).toMatchObject({ status: 'failed' });
    expect(harness.failureRequests).toEqual([
      expect.objectContaining({
        currentAttemptNumber: 3,
        finishedAtMs: 601_000,
        jobDeadlineAtMs: 601_000,
        cancelRequestedAtMs: null,
        error: timedOut,
        decision: {
          kind: 'terminal',
          jobState: 'failed',
          attemptState: 'timed_out',
          attemptErrorCode: 'ATTEMPT_TIMEOUT',
          jobErrorCode: 'ATTEMPT_TIMEOUT',
          reason: 'attempts-exhausted',
        },
      }),
    ]);
    expect(harness.currentJob).toEqual({
      ...harness.originalJob,
      state: 'failed',
      progressBps: 1_000,
      providerCallCount: 1,
      finishedAtMs: 601_000,
      terminalError: {
        category: timedOut.category,
        code: timedOut.code,
        message: timedOut.message,
      },
    });
    expect(harness.currentAttempt).toEqual({
      ...harness.originalAttempt,
      state: 'timed_out',
      finishedAtMs: 601_000,
      error: {
        category: timedOut.category,
        code: timedOut.code,
        message: timedOut.message,
      },
    });
    expect(harness.currentJob.deadlineAtMs).toBe(601_000);
    expect(harness.currentAttempt.leaseExpiresAtMs).toBeGreaterThan(601_000);
    expect(harness.originalAttempt.startedAtMs + 120_000).toBeGreaterThan(601_000);
    expect(harness.progressValues).toEqual([1_000]);
    expect(harness.commitCheckpoint).not.toHaveBeenCalled();
    expect(harness.commitSuccess).not.toHaveBeenCalled();
    expect(harness.requestCancellation).not.toHaveBeenCalled();
    expect(harness.signalCancellation).not.toHaveBeenCalled();
    expect(harness.finalizeUsage).toHaveBeenCalledOnce();
    expect(harness.finalizeFailure).toHaveBeenCalledOnce();
    expect(harness.sideEffectCounts()).toEqual({
      reservations: 1,
      usageRows: 1,
      usageFinalizations: 1,
      dispatches: 1,
      progressCommits: 1,
      checkpointWrites: 0,
      failureCommits: 1,
      finalOutputs: 0,
    });

    const terminalSnapshot = harness.durableSnapshot();
    const terminalEffects = harness.sideEffectCounts();
    const terminalEvents = [...harness.events];
    await expect(
      harness.service.executeAttempt({
        workspaceId,
        jobId,
        workerId: 'worker.executor:1',
      } as never),
    ).resolves.toEqual({ kind: 'not-eligible' });
    expect(harness.durableSnapshot()).toBe(terminalSnapshot);
    expect(harness.sideEffectCounts()).toEqual(terminalEffects);
    expect(harness.events).toEqual(terminalEvents);
  });

  it('cannot overwrite a cancellation that wins the atomic success commit race', async () => {
    const harness = buildAnalyzeTerminalHarness('success-cancellation-race');
    const executing = harness.service.executeAttempt({
      workspaceId,
      jobId,
      workerId: 'worker.executor:1',
    } as never);
    await vi.waitFor(() =>
      expect(harness.fixture.controller.pendingGateKeys()).toEqual(['terminal-analysis-dispatch']),
    );
    harness.observeHeldDispatch();
    harness.releaseDispatch();
    const result = await executing;

    expect(result).toEqual({ kind: 'lost-commit-race', winner: 'cancellation' });
    expect(harness.events).toEqual([
      'lease',
      'progress-1000',
      'reservation-commit',
      'held-dispatch-observed',
      'usage-finalize',
      'checkpoint-commit',
      'progress-7000',
      'progress-8500',
      'cancellation-terminal-winner',
      'cleanup-incomplete',
      'cleanup-staged',
    ]);
    expect(harness.usageFinalizationRequests).toEqual([
      expect.objectContaining({
        status: 'succeeded',
        responseSha256: sha256Hex(Buffer.from(canonicalizeJson(proposal), 'utf8')),
        error: null,
      }),
    ]);
    expect(harness.usageRow).toMatchObject({ status: 'succeeded' });
    expect(harness.progressValues).toEqual([1_000, 7_000, 8_500]);
    expect(harness.currentJob).toMatchObject({
      ...harness.originalJob,
      state: 'cancelled',
      progressBps: 8_500,
      providerCallCount: 1,
      cancelRequestedAtMs: 2_000,
      finishedAtMs: 2_000,
      terminalError: { category: 'cancelled', code: 'CANCELLED' },
    });
    expect(harness.currentAttempt).toMatchObject({
      ...harness.originalAttempt,
      state: 'cancelled',
      finishedAtMs: 2_000,
      error: { category: 'cancelled', code: 'CANCELLED' },
    });
    expect(harness.committedCheckpoint).toMatchObject({
      workspaceId,
      projectId,
      jobId,
      attemptId,
      requestSha256,
      output: {
        outputKey: 'analysis.fixture-proposal',
        disposition: 'checkpoint',
      },
      payload: proposal,
    });
    const checkpointBeforeInertExecute = canonicalizeJson(harness.committedCheckpoint);
    const checkpointMaterialBeforeInertExecute = canonicalizeJson(harness.checkpointMaterial);
    expect(harness.committedFinalOutputs).toEqual([]);
    expect(harness.commitCheckpoint).toHaveBeenCalledOnce();
    expect(harness.commitSuccess).toHaveBeenCalledOnce();
    expect(harness.finalizeFailure).not.toHaveBeenCalled();
    expect(harness.requestCancellation).not.toHaveBeenCalled();
    expect(harness.cleanupIncomplete).toHaveBeenCalledOnce();
    expect(harness.cleanupStaged).toHaveBeenCalledOnce();
    expect(harness.sideEffectCounts()).toEqual({
      reservations: 1,
      usageRows: 1,
      usageFinalizations: 1,
      dispatches: 1,
      progressCommits: 3,
      checkpointWrites: 1,
      failureCommits: 0,
      finalOutputs: 0,
    });

    const terminalSnapshot = harness.durableSnapshot();
    const terminalEffects = harness.sideEffectCounts();
    const terminalEvents = [...harness.events];
    await expect(
      harness.service.executeAttempt({
        workspaceId,
        jobId,
        workerId: 'worker.executor:1',
      } as never),
    ).resolves.toEqual({ kind: 'not-eligible' });
    expect(harness.durableSnapshot()).toBe(terminalSnapshot);
    expect(harness.sideEffectCounts()).toEqual(terminalEffects);
    expect(harness.events).toEqual(terminalEvents);
    expect(canonicalizeJson(harness.committedCheckpoint)).toBe(checkpointBeforeInertExecute);
    expect(canonicalizeJson(harness.checkpointMaterial)).toBe(checkpointMaterialBeforeInertExecute);
  });

  it('routes a checkpoint cancellation through the normal failure CAS', async () => {
    const harness = buildAnalyzeTerminalHarness('checkpoint-cancellation');
    const executing = harness.service.executeAttempt({
      workspaceId,
      jobId,
      workerId: 'worker.executor:1',
    } as never);
    await vi.waitFor(() =>
      expect(harness.fixture.controller.pendingGateKeys()).toEqual(['terminal-analysis-dispatch']),
    );
    harness.observeHeldDispatch();
    harness.releaseDispatch();
    const result = await executing;

    expect(result).toEqual({
      kind: 'terminal',
      job: harness.currentJob,
      code: 'CANCELLED',
    });
    expect(harness.events).toEqual([
      'lease',
      'progress-1000',
      'reservation-commit',
      'held-dispatch-observed',
      'usage-finalize',
      'checkpoint-cancellation-persist',
      'failure-commit',
      'cleanup-incomplete',
      'cleanup-staged',
    ]);
    expect(harness.usageRow).toMatchObject({ status: 'succeeded' });
    expect(harness.finalizeUsage).toHaveBeenCalledOnce();
    expect(harness.commitCheckpoint).toHaveBeenCalledOnce();
    expect(harness.committedCheckpoint).toBeNull();
    expect(harness.checkpointMaterial).toBeNull();
    expect(harness.commitSuccess).not.toHaveBeenCalled();
    expect(harness.finalizeFailure).toHaveBeenCalledOnce();
    expect(harness.failureRequests).toEqual([
      expect.objectContaining({
        cancelRequestedAtMs: 1_500,
        error: expect.objectContaining({ code: 'CANCELLED', category: 'cancelled' }),
        decision: expect.objectContaining({
          kind: 'terminal',
          jobState: 'cancelled',
          attemptState: 'cancelled',
        }),
      }),
    ]);
    expect(harness.currentJob).toMatchObject({
      state: 'cancelled',
      progressBps: 1_000,
      providerCallCount: 1,
      cancelRequestedAtMs: 1_500,
      deadlineAtMs: 601_000,
    });
    expect(harness.currentAttempt).toMatchObject({ state: 'cancelled', finishedAtMs: 1_500 });
    expect(harness.sideEffectCounts()).toEqual({
      reservations: 1,
      usageRows: 1,
      usageFinalizations: 1,
      dispatches: 1,
      progressCommits: 1,
      checkpointWrites: 0,
      failureCommits: 1,
      finalOutputs: 0,
    });
  });

  it('validates exact executor persistence results and complete usage-finalization identity', async () => {
    const harness = await completeHeldCancellationTrace();
    const exactResults = [
      {
        label: 'cancellation',
        validate: () =>
          validateCancellationRequestResult({
            request: harness.cancellationRequests[0]!,
            result: harness.cancellationResults[0]!,
          }),
      },
      {
        label: 'reservation',
        validate: () =>
          validateAtomicUsageReservationResult({
            command: harness.reservationRequests[0]!,
            result: harness.reservationResults[0]!,
          }),
      },
      {
        label: 'usage finalization',
        validate: () =>
          validateProviderUsageFinalizationResult({
            command: harness.usageFinalizationRequests[0]!,
            result: harness.usageFinalizationResults[0]!,
          }),
      },
      {
        label: 'terminal failure',
        validate: () =>
          validateAttemptFailureCommitResult({
            request: harness.failureRequests[0]!,
            result: harness.failureResults[0]!,
          }),
      },
    ];
    for (const exact of exactResults) {
      expect(exact.validate(), exact.label).toBeDefined();
    }

    const command = harness.usageFinalizationRequests[0]!;
    const result = harness.usageFinalizationResults[0]!;
    const immutableUsageMutations = [
      ['usage id', ['usage', 'usageId'], '80000000-0000-4000-8000-000000000002'],
      ['workspace', ['usage', 'workspaceId'], '10000000-0000-4000-8000-000000000002'],
      ['job', ['usage', 'jobId'], '50000000-0000-4000-8000-000000000002'],
      ['attempt', ['usage', 'attemptId'], '60000000-0000-4000-8000-000000000002'],
      ['call key', ['usage', 'callKey'], 'analysis.other-call'],
      ['capability', ['usage', 'capability'], 'vision_analysis'],
      ['provider', ['usage', 'providerKey'], 'other-fixture'],
      ['model', ['usage', 'modelKey'], 'other-fixture-v1'],
      ['workflow', ['usage', 'workflowVersionId'], 'a0000000-0000-4000-8000-000000000001'],
      ['external marker', ['usage', 'external'], true],
      ['request digest', ['usage', 'requestSha256'], '2'.repeat(64)],
      ['estimate', ['usage', 'estimatedCostMicros'], '1'],
      ['currency', ['usage', 'currency'], 'EUR'],
    ] as const;
    for (const [label, path, value] of immutableUsageMutations) {
      expect(
        () =>
          validateProviderUsageFinalizationResult({
            command,
            result: mutatePersistenceResult(result, [{ path, value }]),
          }),
        label,
      ).toThrow();
    }

    const payloadMutations = [
      ['response digest', ['finalization', 'responseSha256'], '2'.repeat(64)],
      ['metrics', ['finalization', 'usageMetrics', 'calls'], 2],
      ['actual cost', ['finalization', 'actualCostMicros'], '1'],
      ['structured error', ['finalization', 'error'], null],
      ['finish timestamp', ['finalization', 'finishedAtMs'], 1_501],
    ] as const;
    for (const [label, path, value] of payloadMutations) {
      expect(
        () =>
          validateProviderUsageFinalizationResult({
            command,
            result: mutatePersistenceResult(result, [{ path, value }]),
          }),
        label,
      ).toThrow();
    }
    expect(() =>
      validateProviderUsageFinalizationResult({
        command,
        result: mutatePersistenceResult(result, [
          { path: ['usage', 'status'], value: 'failed' },
          { path: ['finalization', 'status'], value: 'failed' },
        ]),
      }),
    ).toThrow();
  });
});
