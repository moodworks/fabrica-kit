import { z } from 'zod';

import {
  ActorIdSchema,
  RequestIdSchema,
  WorkspaceIdSchema,
} from '../context/actor-workspace-context.js';
import {
  CanonicalMicrosStringSchema,
  ExistingUsageIdentitySchema,
  ProviderUsageReservationIdentitySchema,
  StartedUsageFinalizationAuthoritySchema,
  UsageMetricsSchema,
  decideUsageFinalization,
  type ExistingUsageIdentity,
  type StartedUsageFinalizationAuthority,
} from '../jobs/cost-budget.js';
import {
  StructuredJobErrorSchema,
  decideErrorRetry,
  type ErrorRetryDecision,
} from '../jobs/error-policy.js';
import {
  GenerationAttemptLifecycleSchema,
  GenerationJobLifecycleSchema,
  type GenerationJobLifecycle,
} from '../jobs/lifecycle.js';
import {
  CanonicalOperationRequestV1Schema,
  type CanonicalOperationRequestV1,
  type IdempotencyScope,
} from '../jobs/operation-command.js';
import {
  CapabilityRequestSha256Schema,
  OperationRequestSha256Schema,
  type OperationRequestSha256,
} from '../jobs/request-digests.js';
import {
  CallKeySchema,
  CanonicalUuidSchema,
  CurrencyCodeSchema,
  GenerationAttemptIdSchema,
  GenerationJobIdSchema,
  GenerationOutputIdSchema,
  LeaseTokenSchema,
  PersistedActorIdSchema,
  PersistedAssetVersionIdSchema,
  PersistedProjectIdSchema,
  PersistedSceneVersionIdSchema,
  PersistedWorkflowVersionIdSchema,
  PersistedWorkspaceIdSchema,
  StepKeySchema,
  WorkerIdSchema,
  type CallKey,
  type GenerationAttemptId,
  type GenerationJobId,
  type OutputKey,
  type PersistedWorkflowVersionId,
  type PersistedWorkspaceId,
} from '../jobs/syntax.js';
import {
  ATTEMPT_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
  JOB_TIMEOUT_MS,
  LEASE_DURATION_MS,
  EpochMillisecondsSchema,
  HeartbeatDecisionSchema,
  checkedEpochAdd,
  type EpochMilliseconds,
  type HeartbeatDecision,
} from '../jobs/timing.js';
import { BannerSceneV1Schema, Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  ExportReproductionManifestV1Schema,
  ExporterManifestRefV1Schema,
  WorkflowManifestRefV1Schema,
  SceneVersionIdSchema,
  validateExportReproductionManifestV1,
} from '../scene/export-reproduction-manifest-v1.schema.js';
import {
  CheckpointMaterialSchema,
  PersistedCheckpointIdentitySchema,
  validateCheckpointMaterial,
  type CheckpointReuseDecision,
  type PersistedCheckpointIdentity,
} from '../workflows/checkpoint-identity.js';
import { CompositionAnalysisResultV1Schema } from '../workflows/composition-contracts.js';
import {
  WorkflowOutputDeclarationV1Schema,
  WorkflowVersionContractSchema,
  workflowCumulativeBoundaries,
  type WorkflowVersionContract,
} from '../workflows/workflow-definition.js';

export interface ClockPort {
  nowMs(): EpochMilliseconds;
}

export const PersistedActorWorkspaceContextSchema = z
  .strictObject({
    actorId: z.intersection(ActorIdSchema, PersistedActorIdSchema),
    workspaceId: z.intersection(WorkspaceIdSchema, PersistedWorkspaceIdSchema),
    requestId: RequestIdSchema,
  })
  .readonly();

export type PersistedActorWorkspaceContext = z.infer<typeof PersistedActorWorkspaceContextSchema>;

export interface WorkflowVersionRepository {
  resolveExplicit(
    workflowVersionId: PersistedWorkflowVersionId,
  ): Promise<WorkflowVersionContract | null>;
}

export const AuthoritativeWorkflowExecutionSchema = z
  .strictObject({
    workspaceId: PersistedWorkspaceIdSchema,
    projectId: PersistedProjectIdSchema,
    initiatedByActorId: PersistedActorIdSchema,
    requestId: RequestIdSchema,
    request: CanonicalOperationRequestV1Schema,
    requestSha256: OperationRequestSha256Schema,
    workflow: WorkflowVersionContractSchema,
    job: GenerationJobLifecycleSchema,
    attempt: GenerationAttemptLifecycleSchema,
    attemptDeadlineAtMs: EpochMillisecondsSchema,
  })
  .superRefine((execution, context) => {
    const requestWorkflow = execution.request.workflowVersion;
    if (
      execution.workspaceId !== execution.job.workspaceId ||
      execution.projectId !== execution.job.projectId ||
      execution.initiatedByActorId !== execution.job.initiatedByActorId ||
      execution.requestId !== execution.job.requestId ||
      execution.projectId !== execution.request.projectId ||
      execution.request.operation !== execution.job.operation ||
      execution.request.operation !== execution.workflow.definition.workflowKey ||
      execution.job.workflowVersionId !== execution.workflow.workflowVersionId ||
      requestWorkflow.workflowVersionId !== execution.workflow.workflowVersionId ||
      requestWorkflow.workflowVersion !== execution.workflow.workflowVersion ||
      requestWorkflow.definitionSha256 !== execution.workflow.definitionSha256 ||
      execution.job.requestSha256 !== execution.requestSha256 ||
      execution.attempt.workspaceId !== execution.workspaceId ||
      execution.attempt.jobId !== execution.job.jobId ||
      execution.attempt.attemptNumber !== execution.job.attemptCount ||
      execution.job.state !== 'running' ||
      execution.attempt.state !== 'running' ||
      execution.job.deadlineAtMs === null ||
      execution.attemptDeadlineAtMs !==
        checkedEpochAdd(execution.attempt.startedAtMs, ATTEMPT_TIMEOUT_MS) ||
      sha256Hex(Buffer.from(canonicalizeJson(execution.request), 'utf8')) !==
        execution.requestSha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Workflow execution aggregate does not match authoritative persisted identity.',
      });
    }
  })
  .readonly();

export const WorkflowExecutionInvocationSchema = z
  .strictObject({
    context: PersistedActorWorkspaceContextSchema,
    execution: AuthoritativeWorkflowExecutionSchema,
  })
  .superRefine((invocation, context) => {
    if (
      String(invocation.context.workspaceId) !== String(invocation.execution.workspaceId) ||
      String(invocation.context.actorId) !== String(invocation.execution.initiatedByActorId) ||
      invocation.context.requestId !== invocation.execution.requestId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Executor context must be reconstructed from the persisted job identity.',
      });
    }
  })
  .readonly();

export type AuthoritativeWorkflowExecution = z.infer<typeof AuthoritativeWorkflowExecutionSchema>;
export type WorkflowExecutionInvocation = z.infer<typeof WorkflowExecutionInvocationSchema>;

export const CurrentAttemptCommitAuthoritySchema = z
  .strictObject({
    workspaceId: PersistedWorkspaceIdSchema,
    projectId: PersistedProjectIdSchema,
    jobId: GenerationJobIdSchema,
    attemptId: GenerationAttemptIdSchema,
    attemptNumber: z.int().min(1).max(3),
    requestSha256: OperationRequestSha256Schema,
    workflowVersionId: PersistedWorkflowVersionIdSchema,
    workflowVersion: z.int().min(1).max(2_147_483_647),
    workflowDefinitionSha256: Sha256HexSchema,
    currentLeaseToken: LeaseTokenSchema,
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
      authority.currentLeaseToken !== authority.presentedLeaseToken ||
      authority.nowMs >= authority.leaseExpiresAtMs ||
      authority.nowMs >= authority.attemptDeadlineAtMs ||
      authority.nowMs >= authority.jobDeadlineAtMs
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Output commit requires the current live lease and all active deadlines.',
      });
    }
  })
  .readonly();

export type CurrentAttemptCommitAuthority = z.infer<typeof CurrentAttemptCommitAuthoritySchema>;

export const RunningProgressCommitRequestSchema = z
  .strictObject({
    authority: CurrentAttemptCommitAuthoritySchema,
    workflow: WorkflowVersionContractSchema,
    completedStepKey: StepKeySchema,
    expectedCurrentProgressBps: z.int().min(1).max(9_999),
  })
  .superRefine((request, context) => {
    const { authority, workflow } = request;
    if (
      workflow.workflowVersionId !== authority.workflowVersionId ||
      workflow.workflowVersion !== authority.workflowVersion ||
      workflow.definitionSha256 !== authority.workflowDefinitionSha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Progress workflow identity is stale or belongs to another attempt.',
      });
      return;
    }

    const stepIndex = workflow.definition.steps.findIndex(
      (step) => step.stepKey === request.completedStepKey,
    );
    if (stepIndex < 0) {
      context.addIssue({ code: 'custom', message: 'Completed progress step is not declared.' });
      return;
    }
    const boundaries = workflowCumulativeBoundaries(workflow.definition);
    const boundary = boundaries[stepIndex]!;
    if (boundary >= 10_000) {
      context.addIssue({
        code: 'custom',
        message: 'Progress 10000 is reserved for the atomic success transaction.',
      });
      return;
    }

    const knownRunningProgress = new Set([1, ...boundaries.filter((value) => value < 10_000)]);
    if (!knownRunningProgress.has(request.expectedCurrentProgressBps)) {
      context.addIssue({
        code: 'custom',
        message: 'Expected progress must be a persisted workflow boundary or initial lease value.',
      });
      return;
    }
    const previousBoundary = stepIndex === 0 ? 1 : boundaries[stepIndex - 1]!;
    if (
      request.expectedCurrentProgressBps < boundary &&
      request.expectedCurrentProgressBps !== previousBoundary
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Progress cannot skip an incomplete workflow step.',
      });
    }
  })
  .readonly();

export type RunningProgressCommitRequest = z.infer<typeof RunningProgressCommitRequestSchema>;

export const deriveRunningProgressCommitTarget = (
  requestInput: unknown,
): { readonly currentProgressBps: number; readonly targetProgressBps: number } => {
  const request = RunningProgressCommitRequestSchema.parse(requestInput);
  const stepIndex = request.workflow.definition.steps.findIndex(
    (step) => step.stepKey === request.completedStepKey,
  );
  const boundary = workflowCumulativeBoundaries(request.workflow.definition)[stepIndex]!;
  return Object.freeze({
    currentProgressBps: request.expectedCurrentProgressBps,
    targetProgressBps: Math.max(request.expectedCurrentProgressBps, boundary),
  });
};

export const RunningProgressCommitResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('advanced'), job: GenerationJobLifecycleSchema }).readonly(),
  z.strictObject({ kind: z.literal('unchanged'), job: GenerationJobLifecycleSchema }).readonly(),
]);

export type RunningProgressCommitResult = z.infer<typeof RunningProgressCommitResultSchema>;

export const validateRunningProgressCommitResult = (input: {
  readonly request: unknown;
  readonly result: unknown;
}): RunningProgressCommitResult => {
  const request = RunningProgressCommitRequestSchema.parse(input.request);
  const result = RunningProgressCommitResultSchema.parse(input.result);
  const { currentProgressBps, targetProgressBps } = deriveRunningProgressCommitTarget(request);
  const expectedKind = targetProgressBps === currentProgressBps ? 'unchanged' : 'advanced';
  const { authority } = request;
  const { job } = result;
  if (
    result.kind !== expectedKind ||
    job.workspaceId !== authority.workspaceId ||
    job.projectId !== authority.projectId ||
    job.jobId !== authority.jobId ||
    job.requestSha256 !== authority.requestSha256 ||
    job.workflowVersionId !== authority.workflowVersionId ||
    job.state !== 'running' ||
    job.progressBps !== targetProgressBps ||
    job.attemptCount !== authority.attemptNumber ||
    job.cancelRequestedAtMs !== null ||
    job.deadlineAtMs !== authority.jobDeadlineAtMs
  ) {
    throw new TypeError(
      'Progress result must equal the exact monotonic boundary for the current live attempt.',
    );
  }
  return result;
};

export const CheckpointCommitRequestSchema = z
  .strictObject({
    authority: CurrentAttemptCommitAuthoritySchema,
    workflow: WorkflowVersionContractSchema,
    checkpoint: PersistedCheckpointIdentitySchema,
    material: CheckpointMaterialSchema,
  })
  .superRefine((request, context) => {
    const { authority, workflow, checkpoint, material } = request;
    const declaration = workflow.definition.outputs.find(
      (output) => output.outputKey === checkpoint.output.outputKey,
    );
    const workflowIdentityMatches =
      workflow.workflowVersionId === authority.workflowVersionId &&
      workflow.workflowVersion === authority.workflowVersion &&
      workflow.definitionSha256 === authority.workflowDefinitionSha256 &&
      checkpoint.workflow.workflowVersionId === workflow.workflowVersionId &&
      checkpoint.workflow.workflowVersion === workflow.workflowVersion &&
      checkpoint.workflow.definitionSha256 === workflow.definitionSha256;
    const scopeMatches =
      checkpoint.workspaceId === authority.workspaceId &&
      checkpoint.projectId === authority.projectId &&
      checkpoint.jobId === authority.jobId &&
      checkpoint.attemptId === authority.attemptId &&
      checkpoint.requestSha256 === authority.requestSha256 &&
      material.workspaceId === authority.workspaceId &&
      material.projectId === authority.projectId &&
      material.jobId === authority.jobId;
    const declarationMatches =
      declaration !== undefined &&
      declaration.disposition === 'checkpoint' &&
      declaration.replaySafe &&
      canonicalizeJson(declaration) === canonicalizeJson(checkpoint.output);
    const materialMatches =
      material.declaredContentSha256 === checkpoint.contentSha256 &&
      ((material.kind === 'analysis_payload' &&
        checkpoint.reference.kind === 'analysis_payload' &&
        canonicalizeJson(material.payload) === canonicalizeJson(checkpoint.payload)) ||
        (material.kind === 'asset_version' &&
          checkpoint.reference.kind === 'asset_version' &&
          material.assetVersionId === checkpoint.reference.assetVersionId &&
          checkpoint.payload === null) ||
        (material.kind === 'banner_scene_version' &&
          checkpoint.reference.kind === 'banner_scene_version' &&
          material.sceneVersionId === checkpoint.reference.sceneVersionId &&
          checkpoint.payload === null));
    if (!workflowIdentityMatches || !scopeMatches || !declarationMatches || !materialMatches) {
      context.addIssue({
        code: 'custom',
        message:
          'Checkpoint commit must match current authority, workflow declaration, and material identity.',
      });
    }
  })
  .readonly();

export type CheckpointCommitRequest = z.infer<typeof CheckpointCommitRequestSchema>;

export const CheckpointCommitResultSchema = PersistedCheckpointIdentitySchema;

export const validateCheckpointCommitRequest = async (
  input: unknown,
): Promise<CheckpointCommitRequest> => {
  const request = CheckpointCommitRequestSchema.parse(input);
  const material = await validateCheckpointMaterial(request.material, {
    workspaceId: request.authority.workspaceId,
    projectId: request.authority.projectId,
    jobId: request.authority.jobId,
  });
  if (
    canonicalizeJson(material.reference) !== canonicalizeJson(request.checkpoint.reference) ||
    canonicalizeJson(material.payload) !== canonicalizeJson(request.checkpoint.payload) ||
    material.contentSha256 !== request.checkpoint.contentSha256
  ) {
    throw new TypeError('Checkpoint material differs from the authoritative commit identity.');
  }
  return request;
};

export const validateCheckpointCommitResult = async (input: {
  readonly request: unknown;
  readonly result: unknown;
}): Promise<PersistedCheckpointIdentity> => {
  const request = await validateCheckpointCommitRequest(input.request);
  const result = CheckpointCommitResultSchema.parse(input.result);
  if (canonicalizeJson(result) !== canonicalizeJson(request.checkpoint)) {
    throw new TypeError('Checkpoint commit result must equal the immutable requested checkpoint.');
  }
  return result;
};

const AnalysisFinalMaterialSchema = z
  .strictObject({
    kind: z.literal('analysis_payload'),
    payload: CompositionAnalysisResultV1Schema,
  })
  .readonly();
const AssetFinalMaterialSchema = z
  .strictObject({
    kind: z.literal('asset_version'),
    assetVersionId: PersistedAssetVersionIdSchema,
  })
  .readonly();
const SceneFinalMaterialSchema = z
  .strictObject({
    kind: z.literal('banner_scene_version'),
    sceneVersionId: PersistedSceneVersionIdSchema,
  })
  .readonly();
const ArtifactFinalMaterialSchema = z
  .strictObject({
    kind: z.literal('export_artifact'),
    stagingToken: CanonicalUuidSchema,
    sceneVersionId: PersistedSceneVersionIdSchema,
    sceneRevision: z.int().min(1).max(2_147_483_647),
    scene: BannerSceneV1Schema,
    sceneWorkflow: WorkflowManifestRefV1Schema,
    exporter: ExporterManifestRefV1Schema,
    mediaType: z.enum(['application/zip', 'image/png']),
    byteSize: z.int().min(1).max(52_428_800),
    sha256: Sha256HexSchema,
    pixelWidth: z.int().min(1).max(4_096).nullable(),
    pixelHeight: z.int().min(1).max(4_096).nullable(),
    manifest: ExportReproductionManifestV1Schema,
  })
  .superRefine((artifact, context) => {
    const png = artifact.mediaType === 'image/png';
    if (png !== (artifact.pixelWidth !== null && artifact.pixelHeight !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Only staged PNG artifacts carry both pixel dimensions.',
      });
    }
    const output =
      artifact.mediaType === 'image/png'
        ? {
            mediaType: artifact.mediaType,
            byteSize: artifact.byteSize,
            sha256: artifact.sha256,
            pixelWidth: artifact.pixelWidth,
            pixelHeight: artifact.pixelHeight,
          }
        : {
            mediaType: artifact.mediaType,
            byteSize: artifact.byteSize,
            sha256: artifact.sha256,
          };
    const manifest = validateExportReproductionManifestV1(artifact.manifest, {
      scene: artifact.scene,
      sceneVersionId: SceneVersionIdSchema.parse(artifact.sceneVersionId),
      sceneRevision: artifact.sceneRevision,
      sceneWorkflow: artifact.sceneWorkflow,
      exportWorkflow: artifact.manifest.exportWorkflow,
      exporter: artifact.exporter,
      output: output as Parameters<typeof validateExportReproductionManifestV1>[1]['output'],
    });
    if (!manifest.success) {
      context.addIssue({
        code: 'custom',
        message:
          'Staged export manifest must match the exact scene, workflow, and artifact identity.',
      });
    }
  })
  .readonly();

export const FinalOutputCommitIdentitySchema = z
  .strictObject({
    outputId: GenerationOutputIdSchema,
    workspaceId: PersistedWorkspaceIdSchema,
    projectId: PersistedProjectIdSchema,
    jobId: GenerationJobIdSchema,
    attemptId: GenerationAttemptIdSchema,
    declaration: WorkflowOutputDeclarationV1Schema,
    contentSha256: Sha256HexSchema,
    material: z.discriminatedUnion('kind', [
      AnalysisFinalMaterialSchema,
      AssetFinalMaterialSchema,
      SceneFinalMaterialSchema,
      ArtifactFinalMaterialSchema,
    ]),
  })
  .superRefine((output, context) => {
    const materialKind =
      output.material.kind === 'analysis_payload' ? 'analysis_proposal' : output.material.kind;
    if (output.declaration.disposition !== 'final' || output.declaration.kind !== materialKind) {
      context.addIssue({
        code: 'custom',
        message: 'Final output material must match its workflow declaration.',
      });
    }
    if (
      output.material.kind === 'analysis_payload' &&
      sha256Hex(Buffer.from(canonicalizeJson(output.material.payload), 'utf8')) !==
        output.contentSha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Final analysis content digest must be rederived from its strict payload.',
      });
    }
    if (
      output.material.kind === 'export_artifact' &&
      output.material.sha256 !== output.contentSha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Final artifact content digest must equal its staged byte identity.',
      });
    }
  })
  .readonly();

export type FinalOutputCommitIdentity = z.infer<typeof FinalOutputCommitIdentitySchema>;

export const AtomicSuccessCommitRequestSchema = z
  .strictObject({
    authority: CurrentAttemptCommitAuthoritySchema,
    workflow: WorkflowVersionContractSchema,
    finalOutputs: z.array(FinalOutputCommitIdentitySchema).min(1).max(16).readonly(),
  })
  .superRefine((request, context) => {
    const authority = request.authority;
    if (
      request.workflow.workflowVersionId !== authority.workflowVersionId ||
      request.workflow.workflowVersion !== authority.workflowVersion ||
      request.workflow.definitionSha256 !== authority.workflowDefinitionSha256
    ) {
      context.addIssue({ code: 'custom', message: 'Success workflow identity is stale.' });
      return;
    }
    const required = request.workflow.definition.outputs.filter(
      (output) => output.disposition === 'final',
    );
    const byKey = new Map(
      request.finalOutputs.map((output) => [output.declaration.outputKey, output]),
    );
    const outputIds = new Set(request.finalOutputs.map((output) => output.outputId));
    if (
      byKey.size !== request.finalOutputs.length ||
      outputIds.size !== request.finalOutputs.length ||
      byKey.size !== required.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Atomic success requires each declared final output exactly once.',
      });
      return;
    }
    for (const declaration of required) {
      const output = byKey.get(declaration.outputKey);
      if (
        output === undefined ||
        canonicalizeJson(output.declaration) !== canonicalizeJson(declaration) ||
        output.workspaceId !== authority.workspaceId ||
        output.projectId !== authority.projectId ||
        output.jobId !== authority.jobId ||
        output.attemptId !== authority.attemptId
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Final output identity differs from its authoritative job or workflow.',
        });
      }
      if (
        output?.material.kind === 'export_artifact' &&
        canonicalizeJson(output.material.manifest.exportWorkflow) !==
          canonicalizeJson({
            workflowVersionId: request.workflow.workflowVersionId,
            workflowVersion: request.workflow.workflowVersion,
            definitionSha256: request.workflow.definitionSha256,
          })
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Export manifest must name the exact authoritative export workflow.',
        });
      }
    }
  })
  .readonly();

export type AtomicSuccessCommitRequest = z.infer<typeof AtomicSuccessCommitRequestSchema>;

export const AtomicSuccessCommitResultSchema = z
  .strictObject({
    job: GenerationJobLifecycleSchema,
    attempt: GenerationAttemptLifecycleSchema,
    finalOutputs: z.array(FinalOutputCommitIdentitySchema).min(1).max(16).readonly(),
  })
  .superRefine((result, context) => {
    if (
      result.job.state !== 'succeeded' ||
      result.job.progressBps !== 10_000 ||
      result.attempt.state !== 'succeeded' ||
      result.attempt.jobId !== result.job.jobId ||
      result.attempt.workspaceId !== result.job.workspaceId ||
      result.finalOutputs.some(
        (output) =>
          output.workspaceId !== result.job.workspaceId ||
          output.projectId !== result.job.projectId ||
          output.jobId !== result.job.jobId ||
          output.attemptId !== result.attempt.attemptId,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Atomic success result must bind outputs and terminal job/attempt states.',
      });
    }
  })
  .readonly();

export type AtomicSuccessCommitResult = z.infer<typeof AtomicSuccessCommitResultSchema>;

export const validateAtomicSuccessCommitResult = (input: {
  readonly request: unknown;
  readonly result: unknown;
}): AtomicSuccessCommitResult => {
  const request = AtomicSuccessCommitRequestSchema.parse(input.request);
  const result = AtomicSuccessCommitResultSchema.parse(input.result);
  if (
    result.job.workspaceId !== request.authority.workspaceId ||
    result.job.projectId !== request.authority.projectId ||
    result.job.jobId !== request.authority.jobId ||
    result.job.requestSha256 !== request.authority.requestSha256 ||
    result.job.workflowVersionId !== request.authority.workflowVersionId ||
    result.job.attemptCount !== request.authority.attemptNumber ||
    result.attempt.workspaceId !== request.authority.workspaceId ||
    result.attempt.jobId !== request.authority.jobId ||
    result.attempt.attemptId !== request.authority.attemptId ||
    result.attempt.attemptNumber !== request.authority.attemptNumber ||
    canonicalizeJson(result.finalOutputs) !== canonicalizeJson(request.finalOutputs)
  ) {
    throw new TypeError(
      'Atomic success result must equal the authoritative request identities and final output set.',
    );
  }
  return result;
};

const ErrorRetryDecisionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('retry'),
    jobState: z.literal('retry_wait'),
    attemptState: z.enum(['failed', 'timed_out', 'abandoned']),
    attemptErrorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
    nextAttemptNumber: z.union([z.literal(2), z.literal(3)]),
    nextAttemptAtMs: EpochMillisecondsSchema,
    delayMs: z.union([z.literal(1_000), z.literal(5_000)]),
  }),
  z.strictObject({
    kind: z.literal('terminal'),
    jobState: z.enum(['failed', 'cancelled', 'budget_stopped']),
    attemptState: z.enum(['failed', 'cancelled', 'budget_stopped', 'timed_out', 'abandoned']),
    attemptErrorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
    jobErrorCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/),
    reason: z.enum([
      'not-retryable',
      'step-not-replay-safe',
      'external-idempotency-unavailable',
      'attempts-exhausted',
      'job-deadline-prevents-retry',
    ]),
  }),
]);

export const AttemptFailureCommitRequestSchema = z
  .strictObject({
    workspaceId: PersistedWorkspaceIdSchema,
    projectId: PersistedProjectIdSchema,
    jobId: GenerationJobIdSchema,
    attemptId: GenerationAttemptIdSchema,
    currentLeaseToken: LeaseTokenSchema,
    presentedLeaseToken: LeaseTokenSchema,
    currentAttemptNumber: z.int().min(1).max(3),
    finishedAtMs: EpochMillisecondsSchema,
    jobDeadlineAtMs: EpochMillisecondsSchema,
    cancelRequestedAtMs: EpochMillisecondsSchema.nullable(),
    workflow: WorkflowVersionContractSchema,
    stepKey: StepKeySchema,
    logicalCallNumber: z.int().min(1).max(64),
    externalIdempotencyKey: Sha256HexSchema.nullable(),
    indeterminateProviderCall: z.boolean(),
    error: StructuredJobErrorSchema,
    decision: ErrorRetryDecisionSchema,
  })
  .superRefine((request, context) => {
    if (request.currentLeaseToken !== request.presentedLeaseToken) {
      context.addIssue({ code: 'custom', message: 'Failure commit lease token is stale.' });
      return;
    }
    if ((request.error.category === 'cancelled') !== (request.cancelRequestedAtMs !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Cancellation failure commits require the persisted cancellation request.',
      });
      return;
    }
    let expected: ErrorRetryDecision;
    try {
      expected = decideErrorRetry({
        error: request.error,
        workflow: request.workflow,
        stepKey: request.stepKey,
        jobId: request.jobId,
        logicalCallNumber: request.logicalCallNumber,
        externalIdempotencyKey: request.externalIdempotencyKey,
        currentAttemptNumber: request.currentAttemptNumber,
        finishedAtMs: request.finishedAtMs,
        jobDeadlineAtMs: request.jobDeadlineAtMs,
        indeterminateProviderCall: request.indeterminateProviderCall,
      });
    } catch {
      context.addIssue({ code: 'custom', message: 'Failure retry inputs are not authoritative.' });
      return;
    }
    if (canonicalizeJson(expected) !== canonicalizeJson(request.decision)) {
      context.addIssue({
        code: 'custom',
        message: 'Failure target and retry timing must equal the authoritative retry decision.',
      });
    }
  })
  .readonly();

export type AttemptFailureCommitRequest = z.infer<typeof AttemptFailureCommitRequestSchema>;

export const LeaseAttemptCommandSchema = z
  .strictObject({
    workspaceId: PersistedWorkspaceIdSchema,
    jobId: GenerationJobIdSchema,
    workerId: WorkerIdSchema,
    leaseToken: LeaseTokenSchema,
    nowMs: EpochMillisecondsSchema,
  })
  .readonly();

export type LeaseAttemptCommand = z.infer<typeof LeaseAttemptCommandSchema>;

export const LeaseAttemptResultSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('leased'),
      job: GenerationJobLifecycleSchema,
      attempt: GenerationAttemptLifecycleSchema,
    }),
    z.strictObject({ kind: z.literal('not-eligible') }),
  ])
  .superRefine((result, context) => {
    if (
      result.kind === 'leased' &&
      (result.job.state !== 'running' ||
        result.attempt.state !== 'running' ||
        result.attempt.workspaceId !== result.job.workspaceId ||
        result.attempt.jobId !== result.job.jobId ||
        result.attempt.attemptNumber !== result.job.attemptCount)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A lease result must contain one coherent running job and current attempt.',
      });
    }
  })
  .readonly();

export type LeaseAttemptResult = z.infer<typeof LeaseAttemptResultSchema>;

export const validateLeaseAttemptResult = (input: {
  readonly command: unknown;
  readonly result: unknown;
}): LeaseAttemptResult => {
  const command = LeaseAttemptCommandSchema.parse(input.command);
  const result = LeaseAttemptResultSchema.parse(input.result);
  if (result.kind === 'not-eligible') return result;
  const firstAttempt = result.attempt.attemptNumber === 1;
  if (
    result.job.workspaceId !== command.workspaceId ||
    result.job.jobId !== command.jobId ||
    result.job.cancelRequestedAtMs !== null ||
    result.job.startedAtMs === null ||
    result.job.deadlineAtMs === null ||
    result.job.deadlineAtMs <= command.nowMs ||
    result.attempt.workspaceId !== command.workspaceId ||
    result.attempt.jobId !== command.jobId ||
    result.attempt.workerId !== command.workerId ||
    result.attempt.leaseToken !== command.leaseToken ||
    result.attempt.startedAtMs !== command.nowMs ||
    result.attempt.heartbeatAtMs !== command.nowMs ||
    result.attempt.leaseExpiresAtMs !== checkedEpochAdd(command.nowMs, LEASE_DURATION_MS) ||
    (firstAttempt
      ? result.job.startedAtMs !== command.nowMs ||
        result.job.deadlineAtMs !== checkedEpochAdd(command.nowMs, JOB_TIMEOUT_MS)
      : result.job.startedAtMs >= command.nowMs)
  ) {
    throw new TypeError('Lease result does not match the requested job, worker, token, or timing.');
  }
  return result;
};

export const CancellationRequestSchema = z
  .strictObject({
    context: PersistedActorWorkspaceContextSchema,
    jobId: GenerationJobIdSchema,
    requestedAtMs: EpochMillisecondsSchema,
  })
  .readonly();

export type CancellationRequest = z.infer<typeof CancellationRequestSchema>;

export const CancellationRequestResultSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('cancelled-immediately'),
      acknowledgedRequest: CancellationRequestSchema,
      previousState: z.enum(['queued', 'retry_wait']),
      job: GenerationJobLifecycleSchema,
    }),
    z.strictObject({
      kind: z.literal('cancellation-requested'),
      acknowledgedRequest: CancellationRequestSchema,
      job: GenerationJobLifecycleSchema,
    }),
    z.strictObject({
      kind: z.literal('return-existing-terminal'),
      acknowledgedRequest: CancellationRequestSchema,
      job: GenerationJobLifecycleSchema,
    }),
  ])
  .superRefine((result, context) => {
    const terminal = ['succeeded', 'failed', 'cancelled', 'budget_stopped'].includes(
      result.job.state,
    );
    const coherent =
      (result.kind === 'cancelled-immediately' &&
        result.job.state === 'cancelled' &&
        (result.previousState === 'queued'
          ? result.job.attemptCount === 0 && result.job.startedAtMs === null
          : result.job.attemptCount > 0 && result.job.startedAtMs !== null)) ||
      (result.kind === 'cancellation-requested' && result.job.state === 'running') ||
      (result.kind === 'return-existing-terminal' && terminal);
    if (!coherent) {
      context.addIssue({
        code: 'custom',
        message: 'Cancellation result variant and persisted job state must cohere.',
      });
    }
  })
  .readonly();

export type CancellationRequestResult = z.infer<typeof CancellationRequestResultSchema>;

export const validateCancellationRequestResult = (input: {
  readonly request: unknown;
  readonly result: unknown;
}): CancellationRequestResult => {
  const request = CancellationRequestSchema.parse(input.request);
  const result = CancellationRequestResultSchema.parse(input.result);
  const job = result.job;
  if (
    canonicalizeJson(result.acknowledgedRequest) !== canonicalizeJson(request) ||
    job.workspaceId !== request.context.workspaceId ||
    job.jobId !== request.jobId
  ) {
    throw new TypeError('Cancellation result belongs to a different request context or job.');
  }
  if (result.kind === 'cancelled-immediately') {
    if (
      job.cancelRequestedAtMs !== request.requestedAtMs ||
      job.finishedAtMs !== request.requestedAtMs
    ) {
      throw new TypeError('Immediate cancellation must persist the exact request timestamp.');
    }
  } else if (result.kind === 'cancellation-requested') {
    if (
      job.cancelRequestedAtMs === null ||
      job.finishedAtMs !== null ||
      job.startedAtMs === null ||
      job.cancelRequestedAtMs < job.startedAtMs ||
      job.cancelRequestedAtMs > request.requestedAtMs
    ) {
      throw new TypeError(
        'Running cancellation must retain the first coherent request timestamp exactly once.',
      );
    }
  } else if (job.finishedAtMs === null || job.finishedAtMs > request.requestedAtMs) {
    throw new TypeError('Existing terminal cancellation results must predate the later request.');
  } else if (
    job.state === 'cancelled' &&
    (job.cancelRequestedAtMs === null || job.cancelRequestedAtMs > request.requestedAtMs)
  ) {
    throw new TypeError('Existing cancellation timestamp cannot postdate the later request.');
  }
  return result;
};

export const HeartbeatAttemptCommandSchema = z
  .strictObject({
    workspaceId: PersistedWorkspaceIdSchema,
    jobId: GenerationJobIdSchema,
    attemptId: GenerationAttemptIdSchema,
    leaseToken: LeaseTokenSchema,
    nowMs: EpochMillisecondsSchema,
    currentHeartbeatAtMs: EpochMillisecondsSchema,
    currentLeaseExpiresAtMs: EpochMillisecondsSchema,
    attemptDeadlineAtMs: EpochMillisecondsSchema,
    jobDeadlineAtMs: EpochMillisecondsSchema,
  })
  .superRefine((command, context) => {
    if (
      command.currentLeaseExpiresAtMs - command.currentHeartbeatAtMs !== LEASE_DURATION_MS ||
      command.currentHeartbeatAtMs > command.nowMs
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Heartbeat command must carry coherent immutable current lease timing.',
      });
    }
  })
  .readonly();

export type HeartbeatAttemptCommand = z.infer<typeof HeartbeatAttemptCommandSchema>;

export const validateHeartbeatDecision = (input: {
  readonly command: unknown;
  readonly result: unknown;
}): HeartbeatDecision => {
  const command = HeartbeatAttemptCommandSchema.parse(input.command);
  const result = HeartbeatDecisionSchema.parse(input.result);
  if (
    result.kind === 'renewed' &&
    (result.heartbeatAtMs !== command.nowMs ||
      result.nextHeartbeatAtMs !== checkedEpochAdd(command.nowMs, HEARTBEAT_INTERVAL_MS) ||
      result.leaseExpiresAtMs !== checkedEpochAdd(command.nowMs, LEASE_DURATION_MS) ||
      result.jobDeadlineAtMs !== command.jobDeadlineAtMs ||
      command.nowMs <= command.currentHeartbeatAtMs ||
      command.nowMs >= command.currentLeaseExpiresAtMs ||
      command.nowMs >= command.attemptDeadlineAtMs ||
      command.nowMs >= command.jobDeadlineAtMs)
  ) {
    throw new TypeError('Heartbeat renewal does not match the requested timestamp and deadlines.');
  }
  return result;
};

export const AtomicUsageReservationCommandSchema = z
  .strictObject({
    workspaceId: PersistedWorkspaceIdSchema,
    jobId: GenerationJobIdSchema,
    attemptId: GenerationAttemptIdSchema,
    leaseToken: LeaseTokenSchema,
    nowMs: EpochMillisecondsSchema,
    callKey: CallKeySchema,
    requestSha256: CapabilityRequestSha256Schema,
    workflowVersionId: PersistedWorkflowVersionIdSchema,
    identity: ProviderUsageReservationIdentitySchema,
    estimateCurrency: CurrencyCodeSchema,
    nextEstimateMicros: CanonicalMicrosStringSchema,
  })
  .superRefine((command, context) => {
    if (
      command.identity.currency !== command.estimateCurrency ||
      command.identity.estimatedCostMicros !== command.nextEstimateMicros ||
      command.identity.workflowVersionId !== command.workflowVersionId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Atomic reservation command identity and exact estimate must agree.',
      });
    }
  })
  .readonly();

export type AtomicUsageReservationCommand = z.infer<typeof AtomicUsageReservationCommandSchema>;

export const AtomicUsageReservationResultSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('duplicate'),
      usage: ExistingUsageIdentitySchema,
      incrementProviderCallCount: z.literal(false),
      createUsageRow: z.literal(false),
      dispatch: z.literal(false),
    }),
    z.strictObject({
      kind: z.literal('rejected'),
      code: z.literal('COST_CURRENCY_MISMATCH'),
      incrementProviderCallCount: z.literal(false),
      createUsageRow: z.literal(false),
      dispatch: z.literal(false),
    }),
    z.strictObject({
      kind: z.literal('budget-stopped'),
      code: z.enum(['PROVIDER_CALL_LIMIT_EXCEEDED', 'BUDGET_LIMIT_EXCEEDED']),
      jobState: z.literal('budget_stopped'),
      attemptState: z.literal('budget_stopped'),
      incrementProviderCallCount: z.literal(false),
      createUsageRow: z.literal(false),
      dispatch: z.literal(false),
    }),
    z.strictObject({
      kind: z.literal('reserved'),
      usage: ExistingUsageIdentitySchema,
      incrementProviderCallCount: z.literal(true),
      createUsageRow: z.literal(true),
      dispatch: z.literal('after-transaction-commit'),
    }),
  ])
  .superRefine((result, context) => {
    if (result.kind === 'reserved' && result.usage.status !== 'started') {
      context.addIssue({
        code: 'custom',
        message: 'Dispatch authorization requires the exact newly started usage row.',
      });
    }
  })
  .readonly();

export type AtomicUsageReservationResult = z.infer<typeof AtomicUsageReservationResultSchema>;

export const validateAtomicUsageReservationResult = (input: {
  readonly command: unknown;
  readonly result: unknown;
}): AtomicUsageReservationResult => {
  const command = AtomicUsageReservationCommandSchema.parse(input.command);
  const result = AtomicUsageReservationResultSchema.parse(input.result);
  if (result.kind !== 'duplicate' && result.kind !== 'reserved') return result;
  const usage = result.usage;
  if (
    usage.workspaceId !== command.workspaceId ||
    usage.jobId !== command.jobId ||
    usage.attemptId !== command.attemptId ||
    usage.callKey !== command.callKey ||
    usage.requestSha256 !== command.requestSha256 ||
    usage.capability !== command.identity.capability ||
    usage.providerKey !== command.identity.providerKey ||
    usage.modelKey !== command.identity.modelKey ||
    usage.workflowVersionId !== command.workflowVersionId ||
    usage.external !== command.identity.external ||
    usage.estimatedCostMicros !== command.nextEstimateMicros ||
    usage.currency !== command.estimateCurrency
  ) {
    throw new TypeError('Usage reservation result does not match the exact command identity.');
  }
  return result;
};

export const startedUsageFinalizationAuthority = (
  usageInput: unknown,
): StartedUsageFinalizationAuthority => {
  const usage = ExistingUsageIdentitySchema.parse(usageInput);
  if (usage.status !== 'started') {
    throw new TypeError('Usage finalization authority can be derived only from a started row.');
  }
  return StartedUsageFinalizationAuthoritySchema.parse({
    usageId: usage.usageId,
    workspaceId: usage.workspaceId,
    jobId: usage.jobId,
    attemptId: usage.attemptId,
    callKey: usage.callKey,
    capability: usage.capability,
    providerKey: usage.providerKey,
    modelKey: usage.modelKey,
    workflowVersionId: usage.workflowVersionId,
    external: usage.external,
    requestSha256: usage.requestSha256,
    estimatedCostMicros: usage.estimatedCostMicros,
    currency: usage.currency,
    expectedStatus: 'started',
  });
};

export const ProviderUsageFinalizationCommandSchema = z
  .strictObject({
    authority: StartedUsageFinalizationAuthoritySchema,
    status: z.enum(['succeeded', 'failed', 'indeterminate']),
    responseSha256: Sha256HexSchema.nullable(),
    usageMetrics: UsageMetricsSchema,
    actualCostMicros: CanonicalMicrosStringSchema.nullable(),
    error: StructuredJobErrorSchema.nullable(),
    finishedAtMs: EpochMillisecondsSchema,
  })
  .superRefine((command, context) => {
    try {
      decideUsageFinalization({
        currentStatus: command.authority.expectedStatus,
        targetStatus: command.status,
        responseSha256: command.responseSha256,
        usageMetrics: command.usageMetrics,
        actualCostMicros: command.actualCostMicros,
        error: command.error,
      });
    } catch {
      context.addIssue({
        code: 'custom',
        message: 'Usage finalization fields do not form one valid started-to-terminal update.',
      });
    }
    if (
      command.authority.capability === 'fixture_replay' &&
      (command.authority.providerKey !== 'fixture' ||
        command.authority.modelKey !== 'phase1a-fixture-v1' ||
        command.authority.external !== false ||
        command.actualCostMicros !== '0' ||
        canonicalizeJson(command.usageMetrics) !==
          canonicalizeJson({
            calls: 1,
            inputTokens: 0,
            outputTokens: 0,
            inputPixels: 0,
            outputImages: 0,
            computeMs: 0,
          }))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Fixture usage must finalize with its exact six metrics and zero actual cost.',
      });
    }
  })
  .readonly();

export type ProviderUsageFinalizationCommand = z.infer<
  typeof ProviderUsageFinalizationCommandSchema
>;

const TerminalProviderUsageStatusSchema = z.enum(['succeeded', 'failed', 'indeterminate']);

const ProviderUsageFinalizationPayloadSchema = z
  .strictObject({
    status: TerminalProviderUsageStatusSchema,
    responseSha256: Sha256HexSchema.nullable(),
    usageMetrics: UsageMetricsSchema,
    actualCostMicros: CanonicalMicrosStringSchema.nullable(),
    error: StructuredJobErrorSchema.nullable(),
    finishedAtMs: EpochMillisecondsSchema,
  })
  .readonly();

export const ProviderUsageFinalizationResultSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('finalize'),
      usage: ExistingUsageIdentitySchema,
      finalization: ProviderUsageFinalizationPayloadSchema,
    }),
    z.strictObject({
      kind: z.literal('already-final'),
      usage: ExistingUsageIdentitySchema,
      status: TerminalProviderUsageStatusSchema,
      finishedAtMs: EpochMillisecondsSchema,
      rewrite: z.literal(false),
    }),
  ])
  .superRefine((result, context) => {
    const expectedStatus = result.kind === 'finalize' ? result.finalization.status : result.status;
    if (result.usage.status !== expectedStatus) {
      context.addIssue({
        code: 'custom',
        message: 'Usage finalization result identity must carry the exact terminal status.',
      });
    }
  })
  .readonly();

export type ProviderUsageFinalizationResult = z.infer<typeof ProviderUsageFinalizationResultSchema>;

export const validateProviderUsageFinalizationResult = (input: {
  readonly command: unknown;
  readonly result: unknown;
}): ProviderUsageFinalizationResult => {
  const command = ProviderUsageFinalizationCommandSchema.parse(input.command);
  const result = ProviderUsageFinalizationResultSchema.parse(input.result);
  const usage = result.usage;
  const authority = command.authority;
  if (
    usage.usageId !== authority.usageId ||
    usage.workspaceId !== authority.workspaceId ||
    usage.jobId !== authority.jobId ||
    usage.attemptId !== authority.attemptId ||
    usage.callKey !== authority.callKey ||
    usage.capability !== authority.capability ||
    usage.providerKey !== authority.providerKey ||
    usage.modelKey !== authority.modelKey ||
    usage.workflowVersionId !== authority.workflowVersionId ||
    usage.external !== authority.external ||
    usage.requestSha256 !== authority.requestSha256 ||
    usage.estimatedCostMicros !== authority.estimatedCostMicros ||
    usage.currency !== authority.currency
  ) {
    throw new TypeError('Usage finalization result belongs to a different immutable call.');
  }
  if (result.kind === 'already-final') {
    const expected = decideUsageFinalization({
      currentStatus: result.status,
      targetStatus: command.status,
      responseSha256: command.responseSha256,
      usageMetrics: command.usageMetrics,
      actualCostMicros: command.actualCostMicros,
      error: command.error,
    });
    if (
      canonicalizeJson(expected) !==
        canonicalizeJson({ kind: result.kind, status: result.status, rewrite: result.rewrite }) ||
      result.finishedAtMs > command.finishedAtMs
    ) {
      throw new TypeError('Already-final usage must retain its earlier terminal state unchanged.');
    }
    return result;
  }
  const expected = decideUsageFinalization({
    currentStatus: authority.expectedStatus,
    targetStatus: command.status,
    responseSha256: command.responseSha256,
    usageMetrics: command.usageMetrics,
    actualCostMicros: command.actualCostMicros,
    error: command.error,
  });
  if (
    expected.kind !== 'finalize' ||
    canonicalizeJson(result.finalization) !==
      canonicalizeJson({ ...expected.finalization, finishedAtMs: command.finishedAtMs })
  ) {
    throw new TypeError('Usage finalization result differs from the exact once-only command.');
  }
  return result;
};

export interface GenerationJobRepository {
  findIdempotent<TJob = GenerationJobLifecycle>(
    scope: IdempotencyScope,
  ): Promise<{ readonly requestSha256: OperationRequestSha256; readonly job: TJob } | null>;
  createQueued(input: {
    readonly context: PersistedActorWorkspaceContext;
    readonly request: CanonicalOperationRequestV1;
    readonly requestSha256: OperationRequestSha256;
    readonly idempotencyScope: IdempotencyScope;
  }): Promise<GenerationJobLifecycle>;
  leaseAttempt(input: LeaseAttemptCommand): Promise<LeaseAttemptResult>;
  /** Reload and compare the current lease timing and immutable deadlines under the job lock. */
  heartbeatAttempt(input: HeartbeatAttemptCommand): Promise<HeartbeatDecision>;
  /**
   * Under the job lock, compare the live lease, cancellation, deadlines, workflow identity, and
   * persisted current progress before deriving the completed step's cumulative boundary.
   */
  recordRunningProgress(input: RunningProgressCommitRequest): Promise<RunningProgressCommitResult>;
  requestCancellation(input: CancellationRequest): Promise<CancellationRequestResult>;
  finalizeAttemptFailure(input: AttemptFailureCommitRequest): Promise<GenerationJobLifecycle>;
  /**
   * The adapter must re-resolve asset/scene material from its immutable authoritative row and
   * compare its scoped identity, bounded content, and digest before inserting the checkpoint.
   */
  commitCheckpoint(input: CheckpointCommitRequest): Promise<PersistedCheckpointIdentity>;
  commitSuccessAtomically(input: AtomicSuccessCommitRequest): Promise<AtomicSuccessCommitResult>;
  loadExecutionAggregate(input: {
    readonly workspaceId: PersistedWorkspaceId;
    readonly jobId: GenerationJobId;
  }): Promise<AuthoritativeWorkflowExecution | null>;
}

export interface CostBudgetPort {
  /**
   * One transaction locks the job, reloads job/attempt/cancellation/deadlines, checks a scoped
   * duplicate, aggregates actual-or-estimated costs, then either budget-stops or increments the
   * call counter and inserts the started row before dispatch is authorized.
   */
  reserveUnderJobLock(
    command: AtomicUsageReservationCommand,
  ): Promise<AtomicUsageReservationResult>;
}

export interface ProviderUsageRepository {
  findAttemptCall(input: {
    readonly workspaceId: PersistedWorkspaceId;
    readonly jobId: GenerationJobId;
    readonly attemptId: GenerationAttemptId;
    readonly callKey: CallKey;
  }): Promise<ExistingUsageIdentity | null>;
  /** This once-only started-to-terminal CAS intentionally does not require a live lease. */
  finalizeOnce(input: ProviderUsageFinalizationCommand): Promise<ProviderUsageFinalizationResult>;
}

export interface CheckpointReusePort {
  /**
   * Return absent only when no scoped output row exists. Any existing row or material that fails
   * identity/content verification must return mismatch and must never fall back to replay.
   */
  verify(input: {
    readonly workspaceId: PersistedWorkspaceId;
    readonly jobId: GenerationJobId;
    readonly outputKey: OutputKey;
  }): Promise<CheckpointReuseDecision>;
}

export interface WorkflowExecutorPort {
  execute(invocation: WorkflowExecutionInvocation): Promise<void>;
}
