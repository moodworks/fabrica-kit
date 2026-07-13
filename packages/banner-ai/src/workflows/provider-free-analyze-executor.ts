import { z } from 'zod';

import {
  ExistingUsageIdentitySchema,
  createFixtureUsageIdentity,
  createFixtureUsageReservationIdentity,
  type ExistingUsageIdentity,
} from '../jobs/cost-budget.js';
import {
  StructuredJobErrorSchema,
  createStructuredJobError,
  decideErrorRetry,
  deriveExternalIdempotencyKey,
  type StableJobErrorCode,
  type StructuredJobError,
} from '../jobs/error-policy.js';
import {
  GenerationJobLifecycleSchema,
  cleanupAttemptTemporaries,
  type AttemptTemporaryCleanupPort,
  type GenerationJobLifecycle,
  type TemporaryCleanupCause,
} from '../jobs/lifecycle.js';
import {
  Phase1AOperationCommandSchema,
  decideIdempotentJobCreation,
  operationRequestSha256,
  projectCanonicalOperationRequest,
  type Phase1AOperationCommand,
} from '../jobs/operation-command.js';
import {
  CallKeySchema,
  GenerationAttemptIdSchema,
  GenerationJobIdSchema,
  GenerationOutputIdSchema,
  LeaseTokenSchema,
  OutputKeySchema,
  PersistedAssetVersionIdSchema,
  PersistedWorkspaceIdSchema,
  StepKeySchema,
  WorkerIdSchema,
  type GenerationAttemptId,
  type GenerationJobId,
  type PersistedAssetVersionId,
  type PersistedProjectId,
  type PersistedWorkspaceId,
  type WorkerId,
} from '../jobs/syntax.js';
import { capabilityCallWindow } from '../jobs/timing.js';
import {
  CompositionAnalysisRequestV1Schema,
  compositionAnalysisRequestSha256,
  validateCompositionAnalysisResponseV1,
  type BannerCompositionAnalysisPort,
  type CancellationSignalPort,
  type CompositionAnalysisRequestV1,
} from '../ports/banner-capability-ports.js';
import {
  AtomicSuccessCommitRequestSchema,
  AtomicUsageReservationCommandSchema,
  AttemptFailureCommitRequestSchema,
  AuthoritativeWorkflowExecutionSchema,
  CancellationRequestSchema,
  CheckpointCommitRequestSchema,
  CurrentAttemptCommitAuthoritySchema,
  PersistedActorWorkspaceContextSchema,
  ProviderUsageFinalizationCommandSchema,
  RunningProgressCommitRequestSchema,
  WorkflowExecutionInvocationSchema,
  startedUsageFinalizationAuthority,
  validateAtomicSuccessCommitResult,
  validateAtomicUsageReservationResult,
  validateCancellationRequestResult,
  validateCheckpointCommitResult,
  validateLeaseAttemptResult,
  validateProviderUsageFinalizationResult,
  validateRunningProgressCommitResult,
  type AuthoritativeWorkflowExecution,
  type CheckpointReusePort,
  type ClockPort,
  type CostBudgetPort,
  type GenerationJobRepository,
  type PersistedActorWorkspaceContext,
  type ProviderUsageRepository,
  type WorkflowVersionRepository,
} from '../ports/job-workflow-ports.js';
import {
  AssetVersionRefV1Schema,
  Sha256HexSchema,
  type AssetVersionRefV1,
} from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  CheckpointReuseDecisionSchema,
  PersistedCheckpointIdentitySchema,
} from './checkpoint-identity.js';
import {
  PROVIDER_FREE_COMPOSITION_POLICY,
  dispatchProviderFreeCompositionAnalysis,
  estimateProviderFreeCompositionAnalysis,
} from './provider-free-policy.js';
import { INITIAL_BANNER_ANALYZE_WORKFLOW_V1 } from './workflow-definition.js';

const ANALYSIS_CALL_KEY = CallKeySchema.parse('analysis.fixture-proposal');
const ANALYSIS_CHECKPOINT_OUTPUT_KEY = OutputKeySchema.parse('analysis.fixture-proposal');
const ANALYSIS_CHECKPOINT_BOUNDARY_BPS = 7_000;

export interface ProviderFreeAnalyzeSourcePort {
  resolveSource(input: {
    readonly workspaceId: PersistedWorkspaceId;
    readonly projectId: PersistedProjectId;
    readonly assetVersionId: PersistedAssetVersionId;
  }): Promise<AssetVersionRefV1 | null>;
}

export interface ProviderFreeAnalyzeUuidPort {
  nextUuid(purpose: 'lease-token' | 'final-output'): string;
}

export interface ProviderFreeAnalyzeCancellationPort {
  forJob(input: {
    readonly workspaceId: PersistedWorkspaceId;
    readonly jobId: GenerationJobId;
  }): CancellationSignalPort;
  signal(input: {
    readonly workspaceId: PersistedWorkspaceId;
    readonly jobId: GenerationJobId;
  }): void;
}

export interface ProviderFreeAnalyzeTemporaryPort {
  forAttempt(input: {
    readonly workspaceId: PersistedWorkspaceId;
    readonly jobId: GenerationJobId;
    readonly attemptId: GenerationAttemptId;
  }): AttemptTemporaryCleanupPort;
}

export interface ProviderFreeAnalyzeDependencies {
  readonly clock: ClockPort;
  readonly uuids: ProviderFreeAnalyzeUuidPort;
  readonly jobs: GenerationJobRepository;
  readonly workflows: WorkflowVersionRepository;
  readonly sources: ProviderFreeAnalyzeSourcePort;
  readonly budgets: CostBudgetPort;
  readonly usage: ProviderUsageRepository;
  readonly checkpoints: CheckpointReusePort;
  readonly analysis: BannerCompositionAnalysisPort;
  readonly cancellations: ProviderFreeAnalyzeCancellationPort;
  readonly temporaries: ProviderFreeAnalyzeTemporaryPort;
}

export type ProviderFreeAnalyzeSubmissionResult =
  | {
      readonly kind: 'accepted';
      readonly disposition: 'existing' | 'created-or-concurrent-existing';
      readonly job: GenerationJobLifecycle;
    }
  | {
      readonly kind: 'conflict';
      readonly code: 'IDEMPOTENCY_KEY_REUSED';
      readonly sideEffects: 'none';
    };

export type ProviderFreeAnalyzeAttemptResult =
  | { readonly kind: 'not-eligible' }
  | {
      readonly kind: 'succeeded';
      readonly job: GenerationJobLifecycle;
      readonly checkpoint: 'created' | 'reused';
    }
  | {
      readonly kind: 'retry-scheduled';
      readonly job: GenerationJobLifecycle;
      readonly nextAttemptAtMs: number;
      readonly delayMs: 1_000 | 5_000;
    }
  | {
      readonly kind: 'terminal';
      readonly job: GenerationJobLifecycle;
      readonly code: string;
    }
  | {
      readonly kind: 'budget-stopped';
      readonly code: 'PROVIDER_CALL_LIMIT_EXCEEDED' | 'BUDGET_LIMIT_EXCEEDED';
    }
  | {
      readonly kind: 'lost-commit-race';
      readonly winner: 'cancellation' | 'another-worker';
    };

export class ProviderFreeAnalyzeCommitRaceError extends Error {
  readonly winner: 'cancellation' | 'another-worker';

  constructor(winner: 'cancellation' | 'another-worker') {
    super(`Provider-free analyze commit lost to ${winner}.`);
    this.name = 'ProviderFreeAnalyzeCommitRaceError';
    this.winner = winner;
  }
}

class AnalyzeExecutionFault extends Error {
  readonly structuredError: StructuredJobError;
  readonly indeterminateProviderCall: boolean;

  constructor(code: StableJobErrorCode, message: string, indeterminateProviderCall = false) {
    super(message);
    this.name = 'AnalyzeExecutionFault';
    this.structuredError = createStructuredJobError(code, message);
    this.indeterminateProviderCall = indeterminateProviderCall;
  }
}

const SubmitAnalyzeSchema = z
  .strictObject({
    context: PersistedActorWorkspaceContextSchema,
    command: Phase1AOperationCommandSchema,
  })
  .readonly();

const ExecuteAnalyzeSchema = z
  .strictObject({
    workspaceId: PersistedWorkspaceIdSchema,
    jobId: GenerationJobIdSchema,
    workerId: WorkerIdSchema,
  })
  .readonly();

const RecoverLeaseLossSchema = z
  .strictObject({
    workspaceId: PersistedWorkspaceIdSchema,
    jobId: GenerationJobIdSchema,
    attemptId: GenerationAttemptIdSchema,
    leaseToken: LeaseTokenSchema,
  })
  .readonly();

const sameInitialAnalyzeWorkflow = (value: unknown): boolean =>
  canonicalizeJson(value) === canonicalizeJson(INITIAL_BANNER_ANALYZE_WORKFLOW_V1);

const structuredErrorFrom = (error: unknown): StructuredJobError => {
  if (typeof error === 'object' && error !== null && 'structuredError' in error) {
    const parsed = StructuredJobErrorSchema.safeParse(
      (error as { readonly structuredError: unknown }).structuredError,
    );
    if (parsed.success) return parsed.data;
  }
  return createStructuredJobError(
    'INTERNAL_INVARIANT',
    'Provider-free analyze execution violated an internal invariant.',
  );
};

const cleanupCauseFor = (error: StructuredJobError): TemporaryCleanupCause => {
  if (error.category === 'cancelled') return 'cancellation';
  if (error.category === 'timeout') return 'timeout';
  if (error.category === 'worker_lost') return 'lease_loss';
  return 'failure';
};

const assertJobMatchesSubmission = (input: {
  readonly jobInput: unknown;
  readonly context: PersistedActorWorkspaceContext;
  readonly request: ReturnType<typeof projectCanonicalOperationRequest>;
  readonly requestSha256: ReturnType<typeof operationRequestSha256>;
}): GenerationJobLifecycle => {
  const job = GenerationJobLifecycleSchema.parse(input.jobInput);
  if (
    job.workspaceId !== input.context.workspaceId ||
    job.projectId !== input.request.projectId ||
    job.operation !== 'banner.analyze' ||
    job.workflowVersionId !== input.request.workflowVersion.workflowVersionId ||
    job.requestSha256 !== input.requestSha256
  ) {
    throw new TypeError('Idempotent analyze repository returned a job from another request.');
  }
  return job;
};

export class ProviderFreeBannerAnalyzeService {
  readonly #dependencies: ProviderFreeAnalyzeDependencies;

  constructor(dependencies: ProviderFreeAnalyzeDependencies) {
    this.#dependencies = dependencies;
  }

  async submit(input: {
    readonly context: PersistedActorWorkspaceContext;
    readonly command: Phase1AOperationCommand;
  }): Promise<ProviderFreeAnalyzeSubmissionResult> {
    const parsed = SubmitAnalyzeSchema.parse(input);
    if (parsed.command.operation !== 'banner.analyze') {
      throw new TypeError('Provider-free analyze submission accepts only banner.analyze.');
    }
    const workflowInput = await this.#dependencies.workflows.resolveExplicit(
      parsed.command.workflowVersionId,
    );
    if (workflowInput === null || !sameInitialAnalyzeWorkflow(workflowInput)) {
      throw new TypeError('Provider-free analyze requires the frozen initial workflow version.');
    }
    const source = await this.#dependencies.sources.resolveSource({
      workspaceId: parsed.context.workspaceId,
      projectId: parsed.command.projectId,
      assetVersionId: parsed.command.sourceAssetVersionId,
    });
    if (source === null) {
      throw new AnalyzeExecutionFault(
        'PROJECT_OR_ASSET_NOT_FOUND',
        'The scoped Banner source asset was not found.',
      );
    }
    const sourceAsset = AssetVersionRefV1Schema.parse(source);
    if (String(sourceAsset.assetVersionId) !== String(parsed.command.sourceAssetVersionId)) {
      throw new TypeError('Resolved analyze source differs from the command asset version.');
    }
    const resolution = {
      workflow: workflowInput,
      inputAssets: [
        {
          assetVersionId: PersistedAssetVersionIdSchema.parse(sourceAsset.assetVersionId),
          sha256: sourceAsset.sha256,
        },
      ],
    } as const;
    const request = projectCanonicalOperationRequest(parsed.command, resolution);
    const requestSha256 = operationRequestSha256(parsed.command, resolution);
    const scope = {
      workspaceId: parsed.context.workspaceId,
      operation: parsed.command.operation,
      idempotencyKey: parsed.command.idempotencyKey,
    } as const;
    const existing = await this.#dependencies.jobs.findIdempotent(scope);
    const decision = decideIdempotentJobCreation({
      scope,
      requestSha256,
      existing:
        existing === null
          ? null
          : { scope, requestSha256: existing.requestSha256, job: existing.job },
    });
    if (decision.kind === 'conflict') return decision;
    if (decision.kind === 'return-existing') {
      return {
        kind: 'accepted',
        disposition: 'existing',
        job: assertJobMatchesSubmission({
          jobInput: decision.job,
          context: parsed.context,
          request,
          requestSha256,
        }),
      };
    }

    const createdOrWinner = await this.#dependencies.jobs.createQueued({
      context: parsed.context,
      request,
      requestSha256,
      idempotencyScope: scope,
    });
    const job = GenerationJobLifecycleSchema.parse(createdOrWinner);
    if (job.requestSha256 !== requestSha256) {
      return { kind: 'conflict', code: 'IDEMPOTENCY_KEY_REUSED', sideEffects: 'none' };
    }
    return {
      kind: 'accepted',
      disposition: 'created-or-concurrent-existing',
      job: assertJobMatchesSubmission({
        jobInput: job,
        context: parsed.context,
        request,
        requestSha256,
      }),
    };
  }

  async requestCancellation(input: {
    readonly context: PersistedActorWorkspaceContext;
    readonly jobId: GenerationJobId;
  }): Promise<ReturnType<typeof validateCancellationRequestResult>> {
    const request = CancellationRequestSchema.parse({
      context: input.context,
      jobId: input.jobId,
      requestedAtMs: this.#dependencies.clock.nowMs(),
    });
    const result = validateCancellationRequestResult({
      request,
      result: await this.#dependencies.jobs.requestCancellation(request),
    });
    if (result.kind !== 'return-existing-terminal') {
      this.#dependencies.cancellations.signal({
        workspaceId: request.context.workspaceId,
        jobId: request.jobId,
      });
    }
    return result;
  }

  async executeAttempt(input: {
    readonly workspaceId: PersistedWorkspaceId;
    readonly jobId: GenerationJobId;
    readonly workerId: WorkerId;
  }): Promise<ProviderFreeAnalyzeAttemptResult> {
    const parsed = ExecuteAnalyzeSchema.parse(input);
    const leaseCommand = {
      ...parsed,
      leaseToken: LeaseTokenSchema.parse(this.#dependencies.uuids.nextUuid('lease-token')),
      nowMs: this.#dependencies.clock.nowMs(),
    };
    const leased = validateLeaseAttemptResult({
      command: leaseCommand,
      result: await this.#dependencies.jobs.leaseAttempt(leaseCommand),
    });
    if (leased.kind === 'not-eligible') return { kind: 'not-eligible' };

    let execution = await this.#loadExactExecution({
      workspaceId: parsed.workspaceId,
      jobId: parsed.jobId,
      attemptId: leased.attempt.attemptId,
      leaseToken: leased.attempt.leaseToken,
    });
    if (
      canonicalizeJson(execution.job) !== canonicalizeJson(leased.job) ||
      canonicalizeJson(execution.attempt) !== canonicalizeJson(leased.attempt)
    ) {
      throw new TypeError('Leased analyze aggregate changed before authoritative reload.');
    }
    const cancellation = this.#dependencies.cancellations.forJob({
      workspaceId: execution.workspaceId,
      jobId: execution.job.jobId,
    });
    const cleanup = this.#dependencies.temporaries.forAttempt({
      workspaceId: execution.workspaceId,
      jobId: execution.job.jobId,
      attemptId: execution.attempt.attemptId,
    });
    let cleanupCause: TemporaryCleanupCause | null = null;
    let currentStep = 'source-load';
    let activeUsage: ExistingUsageIdentity | null = null;
    let usageFinalized = false;
    let checkpointDisposition: 'created' | 'reused' = 'created';

    try {
      execution = this.#assertAnalyzeExecution(execution);
      if (execution.request.operation !== 'banner.analyze') {
        throw new AnalyzeExecutionFault(
          'COMMAND_INVALID',
          'Provider-free analyze executor received a different operation.',
        );
      }
      const analyzeParameters = execution.request.parameters;
      const source = await this.#resolveExecutionSource(execution);
      execution = await this.#reloadLive(execution, cancellation);
      execution = await this.#recordProgress(execution, 'source-load');

      const analysisRequest = CompositionAnalysisRequestV1Schema.parse({
        sourceAsset: source,
        maxParts: analyzeParameters.maxParts,
        includeBackground: analyzeParameters.includeBackground,
      });
      const checkpointDecision = CheckpointReuseDecisionSchema.parse(
        await this.#dependencies.checkpoints.verify({
          workspaceId: execution.workspaceId,
          jobId: execution.job.jobId,
          outputKey: ANALYSIS_CHECKPOINT_OUTPUT_KEY,
        }),
      );

      let proposal;
      currentStep = 'fixture-analysis';
      if (checkpointDecision.kind === 'mismatch') {
        throw new AnalyzeExecutionFault(
          'CHECKPOINT_IDENTITY_MISMATCH',
          checkpointDecision.error.message,
        );
      }
      if (checkpointDecision.kind === 'reuse') {
        proposal = this.#proposalFromCheckpoint(
          execution,
          analysisRequest,
          checkpointDecision.checkpoint,
        );
        checkpointDisposition = 'reused';
        execution = await this.#reloadLive(execution, cancellation);
        execution = await this.#recordProgress(execution, 'fixture-analysis');
      } else {
        if (execution.job.progressBps >= ANALYSIS_CHECKPOINT_BOUNDARY_BPS) {
          throw new AnalyzeExecutionFault(
            'CHECKPOINT_IDENTITY_MISMATCH',
            'Analyze progress requires a committed fixture checkpoint that is absent.',
          );
        }
        execution = await this.#reloadLive(execution, cancellation);
        const estimate = await estimateProviderFreeCompositionAnalysis({
          policy: PROVIDER_FREE_COMPOSITION_POLICY,
          port: this.#dependencies.analysis,
          request: analysisRequest,
        });
        const usageIdentity = createFixtureUsageReservationIdentity(
          execution.workflow.workflowVersionId,
          estimate.currency,
        );
        const descriptor = {
          adapter: {
            capability: 'fixture_replay' as const,
            providerKey: 'fixture' as const,
            modelKey: 'phase1a-fixture-v1' as const,
            external: false as const,
          },
          usage: usageIdentity,
        };
        const callWindow = capabilityCallWindow({
          nowMs: this.#dependencies.clock.nowMs(),
          attemptDeadlineAtMs: execution.attemptDeadlineAtMs,
          jobDeadlineAtMs: execution.job.deadlineAtMs!,
        });
        if (callWindow.kind === 'expired') {
          throw new AnalyzeExecutionFault(
            'ATTEMPT_TIMEOUT',
            'The provider-free analyze attempt expired before fixture dispatch.',
          );
        }
        const reservationCommand = AtomicUsageReservationCommandSchema.parse({
          workspaceId: execution.workspaceId,
          jobId: execution.job.jobId,
          attemptId: execution.attempt.attemptId,
          leaseToken: execution.attempt.leaseToken,
          nowMs: this.#dependencies.clock.nowMs(),
          callKey: ANALYSIS_CALL_KEY,
          requestSha256: compositionAnalysisRequestSha256(analysisRequest),
          workflowVersionId: execution.workflow.workflowVersionId,
          identity: usageIdentity,
          estimateCurrency: estimate.currency,
          nextEstimateMicros: '0' as const,
        });
        const reservation = validateAtomicUsageReservationResult({
          command: reservationCommand,
          result: await this.#dependencies.budgets.reserveUnderJobLock(reservationCommand),
        });
        if (reservation.kind === 'rejected') {
          throw new AnalyzeExecutionFault(
            'COST_CURRENCY_MISMATCH',
            'Fixture estimate currency differs from the job budget currency.',
          );
        }
        if (reservation.kind === 'budget-stopped') {
          cleanupCause = 'failure';
          return { kind: 'budget-stopped', code: reservation.code };
        }
        if (reservation.kind === 'duplicate') {
          cleanupCause = 'losing_commit_race';
          return { kind: 'lost-commit-race', winner: 'another-worker' };
        }
        activeUsage = reservation.usage;

        proposal = await dispatchProviderFreeCompositionAnalysis({
          policy: PROVIDER_FREE_COMPOSITION_POLICY,
          port: this.#dependencies.analysis,
          descriptor,
          request: analysisRequest,
          context: {
            deadlineAtMs: callWindow.deadlineAtMs,
            externalIdempotencyKey: deriveExternalIdempotencyKey({
              jobId: execution.job.jobId,
              stepKey: 'fixture-analysis',
              logicalCallNumber: 1,
            }),
            cancellation,
          },
        });
        proposal = validateCompositionAnalysisResponseV1({
          request: analysisRequest,
          result: proposal,
        });
        await this.#finalizeUsage({
          usage: activeUsage,
          status: 'succeeded',
          responseSha256: sha256Hex(Buffer.from(canonicalizeJson(proposal), 'utf8')),
          error: null,
        });
        usageFinalized = true;

        execution = await this.#reloadLive(execution, cancellation);
        const declaration = execution.workflow.definition.outputs.find(
          (output) => output.outputKey === ANALYSIS_CHECKPOINT_OUTPUT_KEY,
        );
        if (declaration === undefined) {
          throw new AnalyzeExecutionFault(
            'INTERNAL_INVARIANT',
            'Analyze checkpoint declaration is missing.',
          );
        }
        const contentSha256 = Sha256HexSchema.parse(
          sha256Hex(Buffer.from(canonicalizeJson(proposal), 'utf8')),
        );
        const checkpoint = PersistedCheckpointIdentitySchema.parse({
          workspaceId: execution.workspaceId,
          projectId: execution.projectId,
          jobId: execution.job.jobId,
          attemptId: execution.attempt.attemptId,
          requestSha256: execution.requestSha256,
          workflow: {
            workflowVersionId: execution.workflow.workflowVersionId,
            workflowVersion: execution.workflow.workflowVersion,
            definitionSha256: execution.workflow.definitionSha256,
          },
          output: declaration,
          reference: { kind: 'analysis_payload' },
          payload: proposal,
          contentSha256,
        });
        const checkpointRequest = CheckpointCommitRequestSchema.parse({
          authority: this.#commitAuthority(execution),
          workflow: execution.workflow,
          checkpoint,
          material: {
            kind: 'analysis_payload' as const,
            workspaceId: execution.workspaceId,
            projectId: execution.projectId,
            jobId: execution.job.jobId,
            declaredContentSha256: contentSha256,
            payload: proposal,
          },
        });
        await validateCheckpointCommitResult({
          request: checkpointRequest,
          result: await this.#dependencies.jobs.commitCheckpoint(checkpointRequest),
        });
        execution = await this.#reloadLive(execution, cancellation);
        execution = await this.#recordProgress(execution, 'fixture-analysis');
      }

      currentStep = 'output-validation';
      proposal = validateCompositionAnalysisResponseV1({
        request: analysisRequest,
        result: proposal,
      });
      execution = await this.#reloadLive(execution, cancellation);
      execution = await this.#recordProgress(execution, 'output-validation');

      currentStep = 'atomic-persistence';
      execution = await this.#reloadLive(execution, cancellation);
      const declaration = execution.workflow.definition.outputs.find(
        (output) => output.outputKey === 'analysis.proposal',
      );
      if (declaration === undefined) {
        throw new AnalyzeExecutionFault(
          'INTERNAL_INVARIANT',
          'Analyze final declaration is missing.',
        );
      }
      const contentSha256 = Sha256HexSchema.parse(
        sha256Hex(Buffer.from(canonicalizeJson(proposal), 'utf8')),
      );
      const successRequest = AtomicSuccessCommitRequestSchema.parse({
        authority: this.#commitAuthority(execution),
        workflow: execution.workflow,
        finalOutputs: [
          {
            outputId: GenerationOutputIdSchema.parse(
              this.#dependencies.uuids.nextUuid('final-output'),
            ),
            workspaceId: execution.workspaceId,
            projectId: execution.projectId,
            jobId: execution.job.jobId,
            attemptId: execution.attempt.attemptId,
            declaration,
            contentSha256,
            material: { kind: 'analysis_payload' as const, payload: proposal },
          },
        ],
      });
      const succeeded = validateAtomicSuccessCommitResult({
        request: successRequest,
        result: await this.#dependencies.jobs.commitSuccessAtomically(successRequest),
      });
      return { kind: 'succeeded', job: succeeded.job, checkpoint: checkpointDisposition };
    } catch (error) {
      if (error instanceof ProviderFreeAnalyzeCommitRaceError) {
        cleanupCause = 'losing_commit_race';
        return { kind: 'lost-commit-race', winner: error.winner };
      }

      let failureExecution = await this.#loadFailureExecution(execution);
      if (failureExecution === null) {
        cleanupCause = 'losing_commit_race';
        return { kind: 'lost-commit-race', winner: 'another-worker' };
      }
      let structuredError = structuredErrorFrom(error);
      const nowMs = this.#dependencies.clock.nowMs();
      if (failureExecution.job.cancelRequestedAtMs !== null) {
        structuredError = createStructuredJobError(
          'CANCELLED',
          'The provider-free analyze job was cancelled.',
        );
      } else if (
        nowMs >= failureExecution.attemptDeadlineAtMs ||
        nowMs >= failureExecution.job.deadlineAtMs!
      ) {
        structuredError = createStructuredJobError(
          'ATTEMPT_TIMEOUT',
          'The provider-free analyze attempt exceeded its deadline.',
        );
      } else if (nowMs >= failureExecution.attempt.leaseExpiresAtMs) {
        structuredError = createStructuredJobError(
          'WORKER_LOST',
          'The provider-free analyze worker lease expired.',
        );
      }
      cleanupCause = cleanupCauseFor(structuredError);

      let indeterminateProviderCall =
        error instanceof AnalyzeExecutionFault && error.indeterminateProviderCall;
      if (activeUsage !== null && !usageFinalized) {
        const uncertain =
          structuredError.code === 'CANCELLED' ||
          structuredError.code === 'WORKER_LOST' ||
          structuredError.code === 'PROVIDER_RESULT_INDETERMINATE';
        const usageError = uncertain
          ? createStructuredJobError(
              'PROVIDER_RESULT_INDETERMINATE',
              'The started fixture call did not produce a trustworthy committed result.',
            )
          : structuredError;
        await this.#finalizeUsage({
          usage: activeUsage,
          status: uncertain ? 'indeterminate' : 'failed',
          responseSha256: null,
          error: usageError,
        });
        usageFinalized = true;
        if (
          structuredError.code === 'WORKER_LOST' ||
          structuredError.code === 'PROVIDER_RESULT_INDETERMINATE'
        ) {
          indeterminateProviderCall = uncertain;
        }
      }
      failureExecution = await this.#loadFailureExecution(failureExecution);
      if (failureExecution === null) {
        cleanupCause = 'losing_commit_race';
        return { kind: 'lost-commit-race', winner: 'another-worker' };
      }
      return this.#commitFailure({
        execution: failureExecution,
        stepKey: currentStep,
        error: structuredError,
        indeterminateProviderCall,
      });
    } finally {
      if (cleanupCause !== null) await cleanupAttemptTemporaries(cleanupCause, cleanup);
    }
  }

  async recoverLeaseLoss(input: {
    readonly workspaceId: PersistedWorkspaceId;
    readonly jobId: GenerationJobId;
    readonly attemptId: GenerationAttemptId;
    readonly leaseToken: string;
  }): Promise<ProviderFreeAnalyzeAttemptResult> {
    const parsed = RecoverLeaseLossSchema.parse(input);
    const execution = await this.#loadExactExecution(parsed);
    if (this.#dependencies.clock.nowMs() < execution.attempt.leaseExpiresAtMs) {
      throw new TypeError('A live analyze lease cannot be recovered as worker loss.');
    }
    const cleanup = this.#dependencies.temporaries.forAttempt({
      workspaceId: execution.workspaceId,
      jobId: execution.job.jobId,
      attemptId: execution.attempt.attemptId,
    });
    try {
      const usageInput = await this.#dependencies.usage.findAttemptCall({
        workspaceId: execution.workspaceId,
        jobId: execution.job.jobId,
        attemptId: execution.attempt.attemptId,
        callKey: ANALYSIS_CALL_KEY,
      });
      const usage = usageInput === null ? null : ExistingUsageIdentitySchema.parse(usageInput);
      if (
        usage !== null &&
        (usage.workspaceId !== execution.workspaceId ||
          usage.jobId !== execution.job.jobId ||
          usage.attemptId !== execution.attempt.attemptId ||
          usage.callKey !== ANALYSIS_CALL_KEY)
      ) {
        throw new TypeError('Lease recovery usage belongs to another analyze attempt call.');
      }
      let indeterminateProviderCall = false;
      if (usage?.status === 'started') {
        const error = createStructuredJobError(
          'PROVIDER_RESULT_INDETERMINATE',
          'Worker lease loss left the fixture call result indeterminate.',
        );
        await this.#finalizeUsage({
          usage,
          status: 'indeterminate',
          responseSha256: null,
          error,
        });
        indeterminateProviderCall = true;
      }
      const cancellationWon = execution.job.cancelRequestedAtMs !== null;
      return await this.#commitFailure({
        execution,
        stepKey: 'fixture-analysis',
        error: cancellationWon
          ? createStructuredJobError('CANCELLED', 'The provider-free analyze job was cancelled.')
          : createStructuredJobError(
              'WORKER_LOST',
              'The provider-free analyze worker lease expired.',
            ),
        indeterminateProviderCall: cancellationWon ? false : indeterminateProviderCall,
      });
    } finally {
      await cleanupAttemptTemporaries('lease_loss', cleanup);
    }
  }

  async #loadExactExecution(input: {
    readonly workspaceId: PersistedWorkspaceId;
    readonly jobId: GenerationJobId;
    readonly attemptId: GenerationAttemptId;
    readonly leaseToken: string;
  }): Promise<AuthoritativeWorkflowExecution> {
    const loaded = await this.#dependencies.jobs.loadExecutionAggregate({
      workspaceId: input.workspaceId,
      jobId: input.jobId,
    });
    if (loaded === null) throw new TypeError('Authoritative analyze execution was not found.');
    const execution = AuthoritativeWorkflowExecutionSchema.parse(loaded);
    if (
      execution.attempt.attemptId !== input.attemptId ||
      execution.attempt.leaseToken !== input.leaseToken
    ) {
      throw new ProviderFreeAnalyzeCommitRaceError('another-worker');
    }
    return execution;
  }

  #assertAnalyzeExecution(
    executionInput: AuthoritativeWorkflowExecution,
  ): AuthoritativeWorkflowExecution {
    const execution = AuthoritativeWorkflowExecutionSchema.parse(executionInput);
    const invocation = WorkflowExecutionInvocationSchema.parse({
      context: {
        actorId: execution.initiatedByActorId,
        workspaceId: execution.workspaceId,
        requestId: execution.requestId,
      },
      execution,
    });
    if (
      invocation.execution.request.operation !== 'banner.analyze' ||
      !sameInitialAnalyzeWorkflow(invocation.execution.workflow)
    ) {
      throw new AnalyzeExecutionFault(
        'COMMAND_INVALID',
        'Provider-free analyze executor received a different operation or workflow.',
      );
    }
    return invocation.execution;
  }

  async #resolveExecutionSource(
    execution: AuthoritativeWorkflowExecution,
  ): Promise<AssetVersionRefV1> {
    if (
      execution.request.operation !== 'banner.analyze' ||
      execution.request.inputAssets.length !== 1
    ) {
      throw new AnalyzeExecutionFault(
        'COMMAND_INVALID',
        'Analyze execution requires one source asset.',
      );
    }
    const expected = execution.request.inputAssets[0]!;
    const source = await this.#dependencies.sources.resolveSource({
      workspaceId: execution.workspaceId,
      projectId: execution.projectId,
      assetVersionId: expected.assetVersionId,
    });
    if (source === null) {
      throw new AnalyzeExecutionFault(
        'PROJECT_OR_ASSET_NOT_FOUND',
        'The scoped Banner source asset was not found.',
      );
    }
    const parsed = AssetVersionRefV1Schema.parse(source);
    if (
      String(parsed.assetVersionId) !== String(expected.assetVersionId) ||
      parsed.sha256 !== expected.sha256
    ) {
      throw new AnalyzeExecutionFault(
        'INTERNAL_INVARIANT',
        'Resolved analyze source identity differs from the persisted request.',
      );
    }
    return parsed;
  }

  async #reloadLive(
    previous: AuthoritativeWorkflowExecution,
    cancellation: CancellationSignalPort,
  ): Promise<AuthoritativeWorkflowExecution> {
    const execution = await this.#loadExactExecution({
      workspaceId: previous.workspaceId,
      jobId: previous.job.jobId,
      attemptId: previous.attempt.attemptId,
      leaseToken: previous.attempt.leaseToken,
    });
    if (cancellation.cancelled || execution.job.cancelRequestedAtMs !== null) {
      throw new AnalyzeExecutionFault('CANCELLED', 'The provider-free analyze job was cancelled.');
    }
    cancellation.throwIfCancelled();
    const nowMs = this.#dependencies.clock.nowMs();
    if (nowMs >= execution.attemptDeadlineAtMs || nowMs >= execution.job.deadlineAtMs!) {
      throw new AnalyzeExecutionFault(
        'ATTEMPT_TIMEOUT',
        'The provider-free analyze attempt exceeded its deadline.',
      );
    }
    if (nowMs >= execution.attempt.leaseExpiresAtMs) {
      throw new AnalyzeExecutionFault(
        'WORKER_LOST',
        'The provider-free analyze worker lease expired.',
      );
    }
    return execution;
  }

  #commitAuthority(execution: AuthoritativeWorkflowExecution) {
    return CurrentAttemptCommitAuthoritySchema.parse({
      workspaceId: execution.workspaceId,
      projectId: execution.projectId,
      jobId: execution.job.jobId,
      attemptId: execution.attempt.attemptId,
      attemptNumber: execution.attempt.attemptNumber,
      requestSha256: execution.requestSha256,
      workflowVersionId: execution.workflow.workflowVersionId,
      workflowVersion: execution.workflow.workflowVersion,
      workflowDefinitionSha256: execution.workflow.definitionSha256,
      currentLeaseToken: execution.attempt.leaseToken,
      presentedLeaseToken: execution.attempt.leaseToken,
      jobState: execution.job.state,
      attemptState: execution.attempt.state,
      cancelRequestedAtMs: execution.job.cancelRequestedAtMs,
      nowMs: this.#dependencies.clock.nowMs(),
      leaseExpiresAtMs: execution.attempt.leaseExpiresAtMs,
      attemptDeadlineAtMs: execution.attemptDeadlineAtMs,
      jobDeadlineAtMs: execution.job.deadlineAtMs,
    });
  }

  async #recordProgress(
    execution: AuthoritativeWorkflowExecution,
    completedStepKey: 'source-load' | 'fixture-analysis' | 'output-validation',
  ): Promise<AuthoritativeWorkflowExecution> {
    const request = RunningProgressCommitRequestSchema.parse({
      authority: this.#commitAuthority(execution),
      workflow: execution.workflow,
      completedStepKey: StepKeySchema.parse(completedStepKey),
      expectedCurrentProgressBps: execution.job.progressBps,
    });
    const result = validateRunningProgressCommitResult({
      request,
      result: await this.#dependencies.jobs.recordRunningProgress(request),
    });
    return AuthoritativeWorkflowExecutionSchema.parse({ ...execution, job: result.job });
  }

  #proposalFromCheckpoint(
    execution: AuthoritativeWorkflowExecution,
    request: CompositionAnalysisRequestV1,
    checkpointInput: unknown,
  ) {
    const checkpoint = PersistedCheckpointIdentitySchema.parse(checkpointInput);
    const declaration = execution.workflow.definition.outputs.find(
      (output) => output.outputKey === ANALYSIS_CHECKPOINT_OUTPUT_KEY,
    );
    if (
      declaration === undefined ||
      checkpoint.workspaceId !== execution.workspaceId ||
      checkpoint.projectId !== execution.projectId ||
      checkpoint.jobId !== execution.job.jobId ||
      checkpoint.requestSha256 !== execution.requestSha256 ||
      checkpoint.workflow.workflowVersionId !== execution.workflow.workflowVersionId ||
      checkpoint.workflow.workflowVersion !== execution.workflow.workflowVersion ||
      checkpoint.workflow.definitionSha256 !== execution.workflow.definitionSha256 ||
      checkpoint.output.outputKey !== ANALYSIS_CHECKPOINT_OUTPUT_KEY ||
      canonicalizeJson(checkpoint.output) !== canonicalizeJson(declaration) ||
      checkpoint.payload === null
    ) {
      throw new AnalyzeExecutionFault(
        'CHECKPOINT_IDENTITY_MISMATCH',
        'Verified checkpoint result is not bound to this analyze execution.',
      );
    }
    return validateCompositionAnalysisResponseV1({ request, result: checkpoint.payload });
  }

  async #finalizeUsage(input: {
    readonly usage: ExistingUsageIdentity;
    readonly status: 'succeeded' | 'failed' | 'indeterminate';
    readonly responseSha256: string | null;
    readonly error: StructuredJobError | null;
  }): Promise<void> {
    const fixture = createFixtureUsageIdentity(input.usage.currency);
    const command = ProviderUsageFinalizationCommandSchema.parse({
      authority: startedUsageFinalizationAuthority(input.usage),
      status: input.status,
      responseSha256:
        input.responseSha256 === null ? null : Sha256HexSchema.parse(input.responseSha256),
      usageMetrics: fixture.usageMetrics,
      actualCostMicros: fixture.actualCostMicros,
      error: input.error,
      finishedAtMs: this.#dependencies.clock.nowMs(),
    });
    validateProviderUsageFinalizationResult({
      command,
      result: await this.#dependencies.usage.finalizeOnce(command),
    });
  }

  async #loadFailureExecution(
    previous: AuthoritativeWorkflowExecution,
  ): Promise<AuthoritativeWorkflowExecution | null> {
    const loaded = await this.#dependencies.jobs.loadExecutionAggregate({
      workspaceId: previous.workspaceId,
      jobId: previous.job.jobId,
    });
    if (loaded === null) return null;
    const execution = AuthoritativeWorkflowExecutionSchema.safeParse(loaded);
    if (
      !execution.success ||
      execution.data.attempt.attemptId !== previous.attempt.attemptId ||
      execution.data.attempt.leaseToken !== previous.attempt.leaseToken
    ) {
      return null;
    }
    return execution.data;
  }

  async #commitFailure(input: {
    readonly execution: AuthoritativeWorkflowExecution;
    readonly stepKey: string;
    readonly error: StructuredJobError;
    readonly indeterminateProviderCall: boolean;
  }): Promise<ProviderFreeAnalyzeAttemptResult> {
    const finishedAtMs = this.#dependencies.clock.nowMs();
    const step = input.execution.workflow.definition.steps.find(
      (candidate) => candidate.stepKey === input.stepKey,
    );
    if (step === undefined) throw new TypeError('Failure step is absent from analyze workflow.');
    const externalIdempotencyKey =
      step.externalIdempotency === 'job-step-call-v1'
        ? deriveExternalIdempotencyKey({
            jobId: input.execution.job.jobId,
            stepKey: input.stepKey,
            logicalCallNumber: 1,
          })
        : null;
    const decision = decideErrorRetry({
      error: input.error,
      workflow: input.execution.workflow,
      stepKey: input.stepKey,
      jobId: input.execution.job.jobId,
      logicalCallNumber: 1,
      externalIdempotencyKey,
      currentAttemptNumber: input.execution.attempt.attemptNumber,
      finishedAtMs,
      jobDeadlineAtMs: input.execution.job.deadlineAtMs!,
      indeterminateProviderCall: input.indeterminateProviderCall,
    });
    const request = AttemptFailureCommitRequestSchema.parse({
      workspaceId: input.execution.workspaceId,
      projectId: input.execution.projectId,
      jobId: input.execution.job.jobId,
      attemptId: input.execution.attempt.attemptId,
      currentLeaseToken: input.execution.attempt.leaseToken,
      presentedLeaseToken: input.execution.attempt.leaseToken,
      currentAttemptNumber: input.execution.attempt.attemptNumber,
      finishedAtMs,
      jobDeadlineAtMs: input.execution.job.deadlineAtMs,
      cancelRequestedAtMs: input.execution.job.cancelRequestedAtMs,
      workflow: input.execution.workflow,
      stepKey: input.stepKey,
      logicalCallNumber: 1,
      externalIdempotencyKey,
      indeterminateProviderCall: input.indeterminateProviderCall,
      error: input.error,
      decision,
    });
    const job = GenerationJobLifecycleSchema.parse(
      await this.#dependencies.jobs.finalizeAttemptFailure(request),
    );
    if (job.jobId !== input.execution.job.jobId || job.state !== decision.jobState) {
      throw new TypeError('Failure repository result differs from the exact retry decision.');
    }
    return decision.kind === 'retry'
      ? {
          kind: 'retry-scheduled',
          job,
          nextAttemptAtMs: decision.nextAttemptAtMs,
          delayMs: decision.delayMs,
        }
      : {
          kind: 'terminal',
          job,
          code: decision.jobErrorCode,
        };
  }
}
