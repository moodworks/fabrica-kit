import { describe, expect, it, vi } from 'vitest';

import {
  AuthoritativeWorkflowExecutionSchema,
  EpochMillisecondsSchema,
  ExistingUsageIdentitySchema,
  GenerationAttemptLifecycleSchema,
  GenerationJobLifecycleSchema,
  INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
  ProviderFreeBannerAnalyzeService,
  canonicalizeJson,
  createStructuredJobError,
  createProviderFreeCompositionAnalysisFixturePort,
  deriveRunningProgressCommitTarget,
  operationRequestSha256,
  projectCanonicalOperationRequest,
  sha256Hex,
  type AuthoritativeWorkflowExecution,
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
const sourceSha256 = '1'.repeat(64);

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
  const attempt = {
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
  };
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
    attempt,
    usage,
    setNowMs(value: number) {
      nowMs = value;
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
    get committedSuccessAttempt() {
      return committedSuccessAttempt;
    },
  };
};

describe('timeboxed provider-free analyze executor safety', () => {
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
});
