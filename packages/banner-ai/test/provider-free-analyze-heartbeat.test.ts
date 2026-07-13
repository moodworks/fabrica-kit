import { describe, expect, it, vi } from 'vitest';

import {
  AuthoritativeWorkflowExecutionSchema,
  EpochMillisecondsSchema,
  ExistingUsageIdentitySchema,
  GenerationAttemptLifecycleSchema,
  GenerationJobLifecycleSchema,
  HeartbeatAttemptCommandSchema,
  INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
  ProviderFreeAnalyzeCommitRaceError,
  ProviderFreeBannerAnalyzeService,
  canonicalizeJson,
  createStructuredJobError,
  decideHeartbeat,
  operationRequestSha256,
  projectCanonicalOperationRequest,
  validateAttemptFailureCommitResult,
  validateHeartbeatAttemptResult,
  type AttemptFailureCommitRequest,
  type HeartbeatAttemptCommand,
  type HeartbeatAttemptResult,
  type ProviderUsageFinalizationCommand,
  type StableJobErrorCode,
} from '../src/index.js';

const workspaceId = '10000000-0000-4000-8000-000000000001';
const otherWorkspaceId = '10000000-0000-4000-8000-000000000002';
const projectId = '20000000-0000-4000-8000-000000000001';
const actorId = '30000000-0000-4000-8000-000000000001';
const sourceAssetVersionId = '40000000-0000-4000-8000-000000000001';
const jobId = '50000000-0000-4000-8000-000000000001';
const otherJobId = '50000000-0000-4000-8000-000000000002';
const attemptId = '60000000-0000-4000-8000-000000000001';
const leaseToken = '70000000-0000-4000-8000-000000000001';
const otherLeaseToken = '70000000-0000-4000-8000-000000000002';
const usageId = '80000000-0000-4000-8000-000000000001';
const requestId = 'request.heartbeat:0001';
const sourceSha256 = '1'.repeat(64);

const operationCommand = {
  commandVersion: 1,
  projectId,
  operation: 'banner.analyze',
  workflowVersionId: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
  idempotencyKey: 'analyze.heartbeat:0001',
  sourceAssetVersionId,
  parameters: { maxParts: 1, includeBackground: false },
} as const;
const resolution = {
  workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
  inputAssets: [{ assetVersionId: sourceAssetVersionId, sha256: sourceSha256 }],
} as const;
const request = projectCanonicalOperationRequest(operationCommand, resolution);
const requestSha256 = operationRequestSha256(operationCommand, resolution);

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
}

const deferred = (): Deferred => {
  let resolvePromise!: () => void;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return Object.freeze({ promise, resolve: resolvePromise });
};

const mutate = (input: unknown, path: readonly string[], value: unknown): unknown => {
  const result: unknown = structuredClone(input);
  let current = result;
  for (const segment of path.slice(0, -1)) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) {
      throw new TypeError('Mutation path must resolve through objects.');
    }
    current = (current as Record<string, unknown>)[segment];
  }
  const field = path.at(-1);
  if (
    field === undefined ||
    typeof current !== 'object' ||
    current === null ||
    Array.isArray(current)
  ) {
    throw new TypeError('Mutation path must target an object field.');
  }
  (current as Record<string, unknown>)[field] = value;
  return result;
};

const buildHarness = (input?: {
  readonly nowMs?: number;
  readonly attemptNumber?: 1 | 3;
  readonly attemptStartedAtMs?: number;
  readonly heartbeatAtMs?: number;
  readonly usageStarted?: boolean;
  readonly cancelRequestedAtMs?: number;
}) => {
  let nowMs = input?.nowMs ?? 1_000;
  const attemptNumber = input?.attemptNumber ?? 1;
  const attemptStartedAtMs = input?.attemptStartedAtMs ?? 1_000;
  const heartbeatAtMs = input?.heartbeatAtMs ?? attemptStartedAtMs;
  const jobStartedAtMs = 1_000;
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
    providerCallCount: input?.usageStarted ? 1 : 0,
    maxProviderCalls: 64,
    attemptTimeoutMs: 120_000,
    jobTimeoutMs: 600_000,
    nextAttemptAtMs: null,
    cancelRequestedAtMs: input?.cancelRequestedAtMs ?? null,
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
    workerId: 'worker.heartbeat:1',
    leaseToken,
    heartbeatAtMs,
    leaseExpiresAtMs: heartbeatAtMs + 30_000,
    startedAtMs: attemptStartedAtMs,
    finishedAtMs: null,
    error: null,
  });
  let usage = input?.usageStarted
    ? ExistingUsageIdentitySchema.parse({
        usageId,
        workspaceId,
        jobId,
        attemptId,
        callKey: 'analysis.fixture-proposal',
        capability: 'fixture_replay',
        providerKey: 'fixture',
        modelKey: 'phase1a-fixture-v1',
        workflowVersionId: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
        external: false,
        requestSha256: '2'.repeat(64),
        estimatedCostMicros: '0',
        currency: 'USD',
        status: 'started',
      })
    : null;

  const heartbeatCommands: HeartbeatAttemptCommand[] = [];
  const heartbeatResults: HeartbeatAttemptResult[] = [];
  const failureRequests: AttemptFailureCommitRequest[] = [];
  const usageFinalizations: ProviderUsageFinalizationCommand[] = [];
  const events: string[] = [];
  let heartbeatWrites = 0;
  let failureCasCalls = 0;
  let failureCommits = 0;
  let temporaryScopes = 0;
  const cleanupIncomplete = vi.fn(() => events.push('cleanup-incomplete'));
  const cleanupStaged = vi.fn(() => events.push('cleanup-staged'));
  let beforeHeartbeatCas: (() => Promise<void>) | null = null;
  let beforeFailureCas: (() => Promise<void>) | null = null;
  let beforeUsageLookup: (() => Promise<void>) | null = null;

  const execution = () =>
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
      attemptDeadlineAtMs: attemptStartedAtMs + 120_000,
    });

  const heartbeatAttempt = vi.fn(async (command: HeartbeatAttemptCommand) => {
    heartbeatCommands.push(structuredClone(command));
    if (beforeHeartbeatCas !== null) await beforeHeartbeatCas();

    if (
      canonicalizeJson(command.currentJob) !== canonicalizeJson(job) ||
      canonicalizeJson(command.currentAttempt) !== canonicalizeJson(attempt)
    ) {
      const result = {
        kind: 'rejected' as const,
        reason:
          command.nowMs <= attempt.heartbeatAtMs
            ? ('non-monotonic' as const)
            : ('stale-state' as const),
      };
      heartbeatResults.push(result);
      return result;
    }

    const decision = decideHeartbeat({
      lease: {
        leaseToken: attempt.leaseToken,
        jobState: job.state,
        attemptState: attempt.state,
        heartbeatAtMs: attempt.heartbeatAtMs,
        leaseExpiresAtMs: attempt.leaseExpiresAtMs,
        attemptDeadlineAtMs: command.attemptDeadlineAtMs,
        jobDeadlineAtMs: command.jobDeadlineAtMs,
      },
      presentedLeaseToken: command.presentedLeaseToken,
      nowMs: command.nowMs,
    });
    if (decision.kind === 'rejected') {
      heartbeatResults.push(decision);
      return decision;
    }

    attempt = GenerationAttemptLifecycleSchema.parse({
      ...attempt,
      heartbeatAtMs: decision.heartbeatAtMs,
      leaseExpiresAtMs: decision.leaseExpiresAtMs,
    });
    heartbeatWrites += 1;
    events.push('heartbeat-write');
    const result = {
      ...decision,
      attemptDeadlineAtMs: command.attemptDeadlineAtMs,
      job,
      attempt,
    };
    heartbeatResults.push(structuredClone(result));
    return result;
  });

  const finalizeAttemptFailure = vi.fn(async (failure: AttemptFailureCommitRequest) => {
    failureCasCalls += 1;
    if (beforeFailureCas !== null) await beforeFailureCas();
    if (
      job.state !== 'running' ||
      attempt.state !== 'running' ||
      canonicalizeJson(failure.currentJob) !== canonicalizeJson(job) ||
      canonicalizeJson(failure.currentAttempt) !== canonicalizeJson(attempt)
    ) {
      throw new ProviderFreeAnalyzeCommitRaceError('another-worker');
    }

    failureRequests.push(structuredClone(failure));
    const attemptError = createStructuredJobError(
      failure.decision.attemptErrorCode as StableJobErrorCode,
      failure.error.message,
    );
    const nextJob = GenerationJobLifecycleSchema.parse({
      ...job,
      state: failure.decision.jobState,
      nextAttemptAtMs: failure.decision.kind === 'retry' ? failure.decision.nextAttemptAtMs : null,
      finishedAtMs: failure.decision.kind === 'terminal' ? failure.finishedAtMs : null,
      terminalError:
        failure.decision.kind === 'terminal'
          ? (() => {
              const error = createStructuredJobError(
                failure.decision.jobErrorCode as StableJobErrorCode,
                failure.error.message,
              );
              return { category: error.category, code: error.code, message: error.message };
            })()
          : null,
    });
    const nextAttempt = GenerationAttemptLifecycleSchema.parse({
      ...attempt,
      state: failure.decision.attemptState,
      finishedAtMs: failure.finishedAtMs,
      error: {
        category: attemptError.category,
        code: attemptError.code,
        message: attemptError.message,
      },
    });
    const result = validateAttemptFailureCommitResult({
      request: failure,
      result: { job: nextJob, attempt: nextAttempt },
    });
    job = result.job;
    attempt = result.attempt;
    failureCommits += 1;
    events.push('failure-commit');
    return result;
  });

  const finalizeUsage = vi.fn(async (command: ProviderUsageFinalizationCommand) => {
    if (usage === null) throw new TypeError('No started usage exists for finalization.');
    usageFinalizations.push(structuredClone(command));
    if (usage.status !== 'started') {
      return {
        kind: 'already-final' as const,
        usage,
        status: usage.status,
        rewrite: false as const,
        finishedAtMs: command.finishedAtMs,
      };
    }
    usage = ExistingUsageIdentitySchema.parse({ ...usage, status: command.status });
    events.push('usage-finalize');
    return {
      kind: 'finalize' as const,
      usage,
      finalization: {
        status: command.status,
        responseSha256: command.responseSha256,
        usageMetrics: command.usageMetrics,
        actualCostMicros: command.actualCostMicros,
        error: command.error,
        finishedAtMs: command.finishedAtMs,
      },
    };
  });

  const jobs = {
    heartbeatAttempt,
    finalizeAttemptFailure,
    async loadExecutionAggregate(scope: { workspaceId: string; jobId: string }) {
      if (
        scope.workspaceId !== workspaceId ||
        scope.jobId !== jobId ||
        job.state !== 'running' ||
        attempt.state !== 'running'
      ) {
        return null;
      }
      return execution();
    },
  };

  const service = new ProviderFreeBannerAnalyzeService({
    clock: { nowMs: () => EpochMillisecondsSchema.parse(nowMs) },
    uuids: { nextUuid: () => '90000000-0000-4000-8000-000000000001' },
    jobs,
    workflows: { resolveExplicit: async () => INITIAL_BANNER_ANALYZE_WORKFLOW_V1 },
    sources: { resolveSource: async () => null },
    budgets: { reserveUnderJobLock: async () => ({ kind: 'rejected' }) },
    usage: {
      async findAttemptCall() {
        if (beforeUsageLookup !== null) await beforeUsageLookup();
        return usage;
      },
      finalizeOnce: finalizeUsage,
    },
    checkpoints: { verify: async () => ({ kind: 'absent', overwrite: false }) },
    analysis: {
      async estimate() {
        throw new Error('Heartbeat tests do not estimate capability calls.');
      },
      async analyze() {
        throw new Error('Heartbeat tests do not dispatch capability calls.');
      },
    },
    cancellations: {
      forJob: () => ({ cancelled: false, throwIfCancelled() {} }),
      signal() {},
    },
    temporaries: {
      forAttempt() {
        temporaryScopes += 1;
        events.push('temporary-scope');
        return {
          deleteIncompleteStepBytes: cleanupIncomplete,
          deleteStagedFinalBytes: cleanupStaged,
        };
      },
    },
  } as never);

  const installBarrier = (
    target: 'heartbeat' | 'failure' | 'usage',
    expectedEntrants: number,
  ): { readonly entered: Promise<void>; release(): void } => {
    const entered = deferred();
    const released = deferred();
    let entrants = 0;
    const wait = async () => {
      entrants += 1;
      if (entrants === expectedEntrants) entered.resolve();
      await released.promise;
    };
    if (target === 'heartbeat') beforeHeartbeatCas = wait;
    else if (target === 'failure') beforeFailureCas = wait;
    else beforeUsageLookup = wait;
    return Object.freeze({ entered: entered.promise, release: released.resolve });
  };

  const durableSnapshot = () =>
    canonicalizeJson({
      job,
      attempt,
      usage,
      heartbeatWrites,
      failureCommits,
      temporaryScopes,
      cleanupIncompleteCalls: cleanupIncomplete.mock.calls.length,
      cleanupStagedCalls: cleanupStaged.mock.calls.length,
    });

  return {
    service,
    events,
    heartbeatAttempt,
    heartbeatCommands,
    heartbeatResults,
    finalizeAttemptFailure,
    failureRequests,
    finalizeUsage,
    usageFinalizations,
    cleanupIncomplete,
    cleanupStaged,
    installBarrier,
    durableSnapshot,
    setNowMs(value: number) {
      nowMs = value;
    },
    get job() {
      return job;
    },
    get attempt() {
      return attempt;
    },
    get usage() {
      return usage;
    },
    get heartbeatWrites() {
      return heartbeatWrites;
    },
    get failureCasCalls() {
      return failureCasCalls;
    },
    get failureCommits() {
      return failureCommits;
    },
    get temporaryScopes() {
      return temporaryScopes;
    },
  };
};

const heartbeat = (harness: ReturnType<typeof buildHarness>, token = leaseToken) =>
  harness.service.heartbeatAttempt({ workspaceId, jobId, attemptId, leaseToken: token } as never);

const recover = (harness: ReturnType<typeof buildHarness>) =>
  harness.service.recoverLeaseLoss({ workspaceId, jobId, attemptId, leaseToken } as never);

describe('provider-free analyze heartbeat and worker-loss orchestration', () => {
  it('uses strict lease/attempt/job boundaries while keeping the 10s cadence non-normative', async () => {
    const cadence = buildHarness({ nowMs: 11_000 });
    await expect(heartbeat(cadence)).resolves.toMatchObject({
      kind: 'renewed',
      heartbeatAtMs: 11_000,
      nextHeartbeatAtMs: 21_000,
      leaseExpiresAtMs: 41_000,
      attemptDeadlineAtMs: 121_000,
      jobDeadlineAtMs: 601_000,
    });
    cadence.setNowMs(21_000);
    await expect(heartbeat(cadence)).resolves.toMatchObject({
      kind: 'renewed',
      heartbeatAtMs: 21_000,
      nextHeartbeatAtMs: 31_000,
      leaseExpiresAtMs: 51_000,
      attemptDeadlineAtMs: 121_000,
      jobDeadlineAtMs: 601_000,
      job: { startedAtMs: 1_000, deadlineAtMs: 601_000 },
      attempt: { startedAtMs: 1_000 },
    });

    const early = buildHarness({ nowMs: 1_001 });
    await expect(heartbeat(early)).resolves.toMatchObject({
      kind: 'renewed',
      heartbeatAtMs: 1_001,
      nextHeartbeatAtMs: 11_001,
      leaseExpiresAtMs: 31_001,
    });

    const before = buildHarness({ nowMs: 30_999 });
    await expect(heartbeat(before)).resolves.toMatchObject({
      kind: 'renewed',
      heartbeatAtMs: 30_999,
      leaseExpiresAtMs: 60_999,
    });
    const equal = buildHarness({ nowMs: 31_000 });
    await expect(heartbeat(equal)).resolves.toEqual({
      kind: 'rejected',
      reason: 'lease-expired',
    });
    const after = buildHarness({ nowMs: 31_001 });
    await expect(heartbeat(after)).resolves.toEqual({
      kind: 'rejected',
      reason: 'lease-expired',
    });

    const attemptEqual = buildHarness({
      nowMs: 121_000,
      heartbeatAtMs: 91_000,
    });
    await expect(heartbeat(attemptEqual)).resolves.toEqual({
      kind: 'rejected',
      reason: 'attempt-expired',
    });
    const jobEqual = buildHarness({
      nowMs: 601_000,
      attemptStartedAtMs: 500_000,
      heartbeatAtMs: 571_000,
    });
    await expect(heartbeat(jobEqual)).resolves.toEqual({
      kind: 'rejected',
      reason: 'job-expired',
    });
    const bothEqual = buildHarness({
      nowMs: 601_000,
      attemptStartedAtMs: 481_000,
      heartbeatAtMs: 571_000,
    });
    await expect(heartbeat(bothEqual)).resolves.toEqual({
      kind: 'rejected',
      reason: 'job-expired',
    });

    const beyondAbsoluteAttempt = buildHarness({
      nowMs: 119_999,
      heartbeatAtMs: 91_000,
    });
    await expect(heartbeat(beyondAbsoluteAttempt)).resolves.toMatchObject({
      kind: 'renewed',
      leaseExpiresAtMs: 149_999,
      attemptDeadlineAtMs: 121_000,
      jobDeadlineAtMs: 601_000,
      job: { startedAtMs: 1_000, deadlineAtMs: 601_000 },
      attempt: { startedAtMs: 1_000 },
    });
  });

  it('rejects foreign, wrong-token, and duplicate requests without a second write', async () => {
    const foreign = buildHarness({ nowMs: 11_000 });
    await expect(
      foreign.service.heartbeatAttempt({
        workspaceId: otherWorkspaceId,
        jobId,
        attemptId,
        leaseToken,
      } as never),
    ).resolves.toEqual({ kind: 'rejected', reason: 'stale-state' });
    await expect(
      foreign.service.heartbeatAttempt({
        workspaceId,
        jobId: otherJobId,
        attemptId,
        leaseToken,
      } as never),
    ).resolves.toEqual({ kind: 'rejected', reason: 'stale-state' });
    await expect(
      foreign.service.heartbeatAttempt({
        workspaceId,
        jobId,
        attemptId: '60000000-0000-4000-8000-000000000002',
        leaseToken,
      } as never),
    ).resolves.toEqual({ kind: 'rejected', reason: 'stale-state' });
    expect(foreign.heartbeatAttempt).not.toHaveBeenCalled();

    const wrongToken = buildHarness({ nowMs: 11_000 });
    await expect(heartbeat(wrongToken, otherLeaseToken)).resolves.toEqual({
      kind: 'rejected',
      reason: 'wrong-token',
    });
    expect(wrongToken.heartbeatWrites).toBe(0);

    const duplicate = buildHarness({ nowMs: 11_000 });
    const barrier = duplicate.installBarrier('heartbeat', 2);
    const first = heartbeat(duplicate);
    const second = heartbeat(duplicate);
    await barrier.entered;
    barrier.release();
    const results = await Promise.all([first, second]);
    expect(results.filter((result) => result.kind === 'renewed')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'rejected')).toEqual([
      { kind: 'rejected', reason: 'non-monotonic' },
    ]);
    const winner = duplicate.durableSnapshot();
    await expect(heartbeat(duplicate)).resolves.toEqual({
      kind: 'rejected',
      reason: 'non-monotonic',
    });
    expect(duplicate.heartbeatWrites).toBe(1);
    expect(duplicate.durableSnapshot()).toBe(winner);
  });

  it('binds every renewed persistence identity and rejects command/result mutations', async () => {
    const harness = buildHarness({ nowMs: 11_000 });
    const result = await heartbeat(harness);
    if (result.kind !== 'renewed') throw new Error('Expected the heartbeat fixture to renew.');
    const command = harness.heartbeatCommands[0]!;
    expect(validateHeartbeatAttemptResult({ command, result })).toEqual(result);

    const invalidCommands = [
      mutate(command, ['workspaceId'], otherWorkspaceId),
      mutate(command, ['projectId'], '20000000-0000-4000-8000-000000000002'),
      mutate(command, ['jobId'], otherJobId),
      mutate(command, ['attemptId'], '60000000-0000-4000-8000-000000000002'),
      mutate(command, ['requestSha256'], '3'.repeat(64)),
      mutate(command, ['operation'], 'banner.extract'),
      mutate(command, ['currentAttemptNumber'], 2),
      mutate(command, ['workerId'], 'worker.heartbeat:2'),
      mutate(command, ['currentLeaseToken'], otherLeaseToken),
      mutate(command, ['currentHeartbeatAtMs'], 2_000),
      mutate(command, ['currentLeaseExpiresAtMs'], 32_000),
      mutate(command, ['attemptDeadlineAtMs'], 121_001),
      mutate(command, ['jobDeadlineAtMs'], 601_001),
      mutate(command, ['currentJob', 'requestSha256'], '3'.repeat(64)),
      mutate(command, ['currentJob', 'workflowVersionId'], otherJobId),
      mutate(command, ['currentAttempt', 'leaseToken'], otherLeaseToken),
      mutate(command, ['workflow', 'definitionSha256'], '4'.repeat(64)),
    ];
    for (const invalid of invalidCommands) {
      expect(HeartbeatAttemptCommandSchema.safeParse(invalid).success).toBe(false);
    }

    const resultMutations = [
      [['job', 'workspaceId'], otherWorkspaceId],
      [['job', 'projectId'], '20000000-0000-4000-8000-000000000002'],
      [['job', 'jobId'], otherJobId],
      [['job', 'initiatedByActorId'], '30000000-0000-4000-8000-000000000002'],
      [['job', 'requestId'], 'request.heartbeat:0002'],
      [['job', 'operation'], 'banner.extract'],
      [['job', 'workflowVersionId'], otherJobId],
      [['job', 'requestSha256'], '3'.repeat(64)],
      [['job', 'progressBps'], 2],
      [['job', 'startedAtMs'], 2_000],
      [['job', 'deadlineAtMs'], 602_000],
      [['attempt', 'workspaceId'], otherWorkspaceId],
      [['attempt', 'jobId'], otherJobId],
      [['attempt', 'attemptId'], '60000000-0000-4000-8000-000000000002'],
      [['attempt', 'attemptNumber'], 2],
      [['attempt', 'workerId'], 'worker.heartbeat:2'],
      [['attempt', 'leaseToken'], otherLeaseToken],
      [['attempt', 'startedAtMs'], 2_000],
      [['attempt', 'heartbeatAtMs'], 11_001],
      [['attempt', 'leaseExpiresAtMs'], 41_001],
      [['attemptDeadlineAtMs'], 121_001],
      [['jobDeadlineAtMs'], 601_001],
    ] as const;
    for (const [path, value] of resultMutations) {
      expect(() =>
        validateHeartbeatAttemptResult({ command, result: mutate(result, path, value) }),
      ).toThrow();
    }
    expect(() =>
      validateHeartbeatAttemptResult({
        command: { ...command, presentedLeaseToken: otherLeaseToken },
        result,
      }),
    ).toThrow();
  });

  it('keeps live and deadline-owned recovery paths completely inert', async () => {
    const live = buildHarness({ nowMs: 30_999, usageStarted: true });
    const liveSnapshot = live.durableSnapshot();
    await expect(recover(live)).rejects.toThrow('live analyze lease');
    expect(live.durableSnapshot()).toBe(liveSnapshot);
    expect(live.failureCasCalls).toBe(0);
    expect(live.finalizeUsage).not.toHaveBeenCalled();
    expect(live.temporaryScopes).toBe(0);

    const attemptBoundary = buildHarness({
      nowMs: 121_000,
      heartbeatAtMs: 91_000,
      usageStarted: true,
    });
    const attemptSnapshot = attemptBoundary.durableSnapshot();
    await expect(recover(attemptBoundary)).rejects.toThrow('attempt deadline owns');
    expect(attemptBoundary.durableSnapshot()).toBe(attemptSnapshot);
    expect(attemptBoundary.failureCasCalls).toBe(0);

    const attemptBoundaryWithLiveLease = buildHarness({
      nowMs: 121_000,
      heartbeatAtMs: 119_999,
      usageStarted: true,
    });
    const liveLeaseDeadlineSnapshot = attemptBoundaryWithLiveLease.durableSnapshot();
    await expect(recover(attemptBoundaryWithLiveLease)).rejects.toThrow('attempt deadline owns');
    expect(attemptBoundaryWithLiveLease.durableSnapshot()).toBe(liveLeaseDeadlineSnapshot);
    expect(attemptBoundaryWithLiveLease.failureCasCalls).toBe(0);

    const jobBoundary = buildHarness({
      nowMs: 601_000,
      attemptStartedAtMs: 500_000,
      heartbeatAtMs: 571_000,
      usageStarted: true,
    });
    const jobSnapshot = jobBoundary.durableSnapshot();
    await expect(recover(jobBoundary)).rejects.toThrow('job deadline owns');
    expect(jobBoundary.durableSnapshot()).toBe(jobSnapshot);
    expect(jobBoundary.failureCasCalls).toBe(0);

    const bothBoundary = buildHarness({
      nowMs: 601_000,
      attemptStartedAtMs: 481_000,
      heartbeatAtMs: 571_000,
      usageStarted: true,
    });
    await expect(recover(bothBoundary)).rejects.toThrow('job deadline owns');
    expect(bothBoundary.failureCasCalls).toBe(0);
  });

  it('carries one validated recovery timestamp across an await without crossing deadline ownership', async () => {
    const harness = buildHarness({
      nowMs: 120_999,
      heartbeatAtMs: 90_000,
      usageStarted: false,
    });
    const usageBarrier = harness.installBarrier('usage', 1);
    const recovering = recover(harness);
    await usageBarrier.entered;

    harness.setNowMs(121_000);
    usageBarrier.release();
    await expect(recovering).resolves.toMatchObject({
      kind: 'retry-scheduled',
      nextAttemptAtMs: 121_999,
      delayMs: 1_000,
    });
    expect(harness.failureRequests).toEqual([
      expect.objectContaining({
        finishedAtMs: 120_999,
        error: expect.objectContaining({ code: 'WORKER_LOST' }),
      }),
    ]);
    expect(harness.attempt).toMatchObject({
      state: 'abandoned',
      finishedAtMs: 120_999,
      error: { code: 'WORKER_LOST' },
    });
    expect(harness.job).toMatchObject({
      state: 'retry_wait',
      nextAttemptAtMs: 121_999,
      deadlineAtMs: 601_000,
    });
  });

  it('preserves a persisted cancellation winner at an overlapping recovery boundary', async () => {
    const harness = buildHarness({
      nowMs: 121_000,
      heartbeatAtMs: 91_000,
      cancelRequestedAtMs: 120_999,
    });
    await expect(recover(harness)).resolves.toMatchObject({
      kind: 'terminal',
      code: 'CANCELLED',
      job: { state: 'cancelled' },
    });
    expect(harness.attempt).toMatchObject({
      state: 'cancelled',
      finishedAtMs: 121_000,
      error: { category: 'cancelled', code: 'CANCELLED' },
    });
    expect(harness.failureRequests).toEqual([
      expect.objectContaining({
        finishedAtMs: 121_000,
        cancelRequestedAtMs: 120_999,
        error: expect.objectContaining({ code: 'CANCELLED' }),
      }),
    ]);
  });

  it('recovers a genuinely expired lease through the exact abandoned retry or terminal path', async () => {
    const retry = buildHarness({ nowMs: 31_000, usageStarted: true });
    await expect(recover(retry)).resolves.toMatchObject({
      kind: 'retry-scheduled',
      nextAttemptAtMs: 32_000,
      delayMs: 1_000,
      job: { state: 'retry_wait' },
    });
    expect(retry.job).toMatchObject({
      state: 'retry_wait',
      nextAttemptAtMs: 32_000,
      deadlineAtMs: 601_000,
    });
    expect(retry.attempt).toMatchObject({
      state: 'abandoned',
      finishedAtMs: 31_000,
      error: { category: 'worker_lost', code: 'WORKER_LOST' },
    });
    expect(retry.usage).toMatchObject({ status: 'indeterminate' });
    expect(retry.events).toEqual([
      'failure-commit',
      'temporary-scope',
      'usage-finalize',
      'cleanup-incomplete',
      'cleanup-staged',
    ]);

    const terminal = buildHarness({
      nowMs: 31_000,
      attemptNumber: 3,
      usageStarted: false,
    });
    await expect(recover(terminal)).resolves.toMatchObject({
      kind: 'terminal',
      code: 'WORKER_LOST',
      job: { state: 'failed' },
    });
    expect(terminal.attempt).toMatchObject({
      state: 'abandoned',
      error: { code: 'WORKER_LOST' },
    });
    expect(terminal.job).toMatchObject({
      state: 'failed',
      terminalError: { code: 'WORKER_LOST' },
    });
    const terminalWinner = terminal.durableSnapshot();
    await expect(heartbeat(terminal)).resolves.toEqual({
      kind: 'rejected',
      reason: 'stale-state',
    });
    await expect(recover(terminal)).resolves.toEqual({
      kind: 'lost-commit-race',
      winner: 'another-worker',
    });
    expect(terminal.durableSnapshot()).toBe(terminalWinner);
    expect(terminal.failureCommits).toBe(1);
    expect(terminal.temporaryScopes).toBe(1);
  });

  it('lets a newer heartbeat beat stale recovery without any losing mutation', async () => {
    const harness = buildHarness({ nowMs: 30_999, usageStarted: true });
    const heartbeatBarrier = harness.installBarrier('heartbeat', 1);
    const heartbeatContender = heartbeat(harness);
    await heartbeatBarrier.entered;

    harness.setNowMs(31_000);
    const recoveryBarrier = harness.installBarrier('failure', 1);
    const recoveryContender = recover(harness);
    await recoveryBarrier.entered;

    heartbeatBarrier.release();
    await expect(heartbeatContender).resolves.toMatchObject({
      kind: 'renewed',
      heartbeatAtMs: 30_999,
      leaseExpiresAtMs: 60_999,
    });
    const heartbeatWinner = harness.durableSnapshot();
    recoveryBarrier.release();
    await expect(recoveryContender).resolves.toEqual({
      kind: 'lost-commit-race',
      winner: 'another-worker',
    });
    expect(harness.durableSnapshot()).toBe(heartbeatWinner);
    expect(harness.failureCommits).toBe(0);
    expect(harness.finalizeUsage).not.toHaveBeenCalled();
    expect(harness.temporaryScopes).toBe(0);
  });

  it('lets recovery beat a queued heartbeat and leaves the terminal winner byte-for-byte intact', async () => {
    const harness = buildHarness({ nowMs: 30_999, usageStarted: true });
    const heartbeatBarrier = harness.installBarrier('heartbeat', 1);
    const heartbeatContender = heartbeat(harness);
    await heartbeatBarrier.entered;

    harness.setNowMs(31_000);
    await expect(recover(harness)).resolves.toMatchObject({ kind: 'retry-scheduled' });
    const recoveryWinner = harness.durableSnapshot();
    heartbeatBarrier.release();
    await expect(heartbeatContender).resolves.toEqual({
      kind: 'rejected',
      reason: 'stale-state',
    });
    expect(harness.durableSnapshot()).toBe(recoveryWinner);
    expect(harness.heartbeatWrites).toBe(0);
    expect(harness.failureCommits).toBe(1);
    expect(harness.finalizeUsage).toHaveBeenCalledOnce();
    expect(harness.temporaryScopes).toBe(1);
  });

  it('allows only one duplicate recovery and keeps all late terminal contenders inert', async () => {
    const harness = buildHarness({ nowMs: 31_000, usageStarted: true });
    const barrier = harness.installBarrier('failure', 2);
    const first = recover(harness);
    const second = recover(harness);
    await barrier.entered;
    barrier.release();
    const results = await Promise.all([first, second]);
    expect(results.filter((result) => result.kind === 'retry-scheduled')).toHaveLength(1);
    expect(results.filter((result) => result.kind === 'lost-commit-race')).toEqual([
      { kind: 'lost-commit-race', winner: 'another-worker' },
    ]);
    expect(harness.failureCasCalls).toBe(2);
    expect(harness.failureCommits).toBe(1);
    expect(harness.finalizeUsage).toHaveBeenCalledOnce();
    expect(harness.temporaryScopes).toBe(1);
    expect(harness.cleanupIncomplete).toHaveBeenCalledOnce();
    expect(harness.cleanupStaged).toHaveBeenCalledOnce();

    const winner = harness.durableSnapshot();
    await expect(heartbeat(harness)).resolves.toEqual({
      kind: 'rejected',
      reason: 'stale-state',
    });
    await expect(recover(harness)).resolves.toEqual({
      kind: 'lost-commit-race',
      winner: 'another-worker',
    });
    expect(harness.durableSnapshot()).toBe(winner);
    expect(harness.failureCasCalls).toBe(2);
    expect(harness.finalizeUsage).toHaveBeenCalledOnce();
    expect(harness.temporaryScopes).toBe(1);
  });
});
