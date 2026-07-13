import { z } from 'zod';

import { StructuredJobErrorSchema, createStructuredJobError } from '../jobs/error-policy.js';
import { OperationRequestSha256Schema } from '../jobs/request-digests.js';
import {
  GenerationJobIdSchema,
  GenerationAttemptIdSchema,
  OutputKeySchema,
  PersistedAssetVersionIdSchema,
  PersistedProjectIdSchema,
  PersistedSceneVersionIdSchema,
  PersistedWorkflowVersionIdSchema,
  PersistedWorkspaceIdSchema,
  StepKeySchema,
} from '../jobs/syntax.js';
import { BannerSceneV1Schema, Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256BannerScene, sha256Hex } from '../scene/canonical-scene-json.js';
import { MAX_RASTER_ENCODED_BYTES } from '../security/raster-container.js';
import { validateNormalizedPng } from '../security/raster-upload.js';
import { CompositionAnalysisResultV1Schema } from './composition-contracts.js';
import {
  WorkflowOutputDispositionSchema,
  WorkflowOutputKindSchema,
  WorkflowVersionContractSchema,
} from './workflow-definition.js';

const CheckpointWorkflowIdentitySchema = z
  .strictObject({
    workflowVersionId: PersistedWorkflowVersionIdSchema,
    workflowVersion: z.int().min(1).max(2_147_483_647),
    definitionSha256: Sha256HexSchema,
  })
  .readonly();

const CheckpointOutputIdentitySchema = z
  .strictObject({
    outputKey: OutputKeySchema,
    kind: WorkflowOutputKindSchema.exclude(['export_artifact']),
    disposition: WorkflowOutputDispositionSchema,
    producingStepKey: StepKeySchema,
    replaySafe: z.boolean(),
  })
  .superRefine((output, context) => {
    if (output.disposition !== 'checkpoint') {
      context.addIssue({ code: 'custom', message: 'Reusable outputs must be checkpoints.' });
    }
  })
  .readonly();

const AnalysisReferenceSchema = z.strictObject({ kind: z.literal('analysis_payload') }).readonly();
const AssetReferenceSchema = z
  .strictObject({
    kind: z.literal('asset_version'),
    assetVersionId: PersistedAssetVersionIdSchema,
  })
  .readonly();
const SceneReferenceSchema = z
  .strictObject({
    kind: z.literal('banner_scene_version'),
    sceneVersionId: PersistedSceneVersionIdSchema,
  })
  .readonly();

export const CheckpointReferenceIdentitySchema = z.discriminatedUnion('kind', [
  AnalysisReferenceSchema,
  AssetReferenceSchema,
  SceneReferenceSchema,
]);

export type CheckpointReferenceIdentity = z.infer<typeof CheckpointReferenceIdentitySchema>;

export const PersistedCheckpointIdentitySchema = z
  .strictObject({
    workspaceId: PersistedWorkspaceIdSchema,
    projectId: PersistedProjectIdSchema,
    jobId: GenerationJobIdSchema,
    attemptId: GenerationAttemptIdSchema,
    requestSha256: OperationRequestSha256Schema,
    workflow: CheckpointWorkflowIdentitySchema,
    output: CheckpointOutputIdentitySchema,
    reference: CheckpointReferenceIdentitySchema,
    payload: CompositionAnalysisResultV1Schema.nullable(),
    contentSha256: Sha256HexSchema,
  })
  .superRefine((checkpoint, context) => {
    const expectedReferenceKind =
      checkpoint.output.kind === 'analysis_proposal'
        ? 'analysis_payload'
        : checkpoint.output.kind === 'asset_version'
          ? 'asset_version'
          : 'banner_scene_version';
    if (checkpoint.reference.kind !== expectedReferenceKind) {
      context.addIssue({
        code: 'custom',
        message: 'Checkpoint reference identity must match its output kind.',
      });
    }
    if ((checkpoint.output.kind === 'analysis_proposal') !== (checkpoint.payload !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Only analysis checkpoints persist a strict payload.',
      });
    }
    if (
      checkpoint.payload !== null &&
      sha256Hex(Buffer.from(canonicalizeJson(checkpoint.payload), 'utf8')) !==
        checkpoint.contentSha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Analysis checkpoint content digest must be rederived from its strict payload.',
      });
    }
  })
  .readonly();

export type PersistedCheckpointIdentity = z.infer<typeof PersistedCheckpointIdentitySchema>;

export const CheckpointReuseExpectationSchema = z
  .strictObject({
    workspaceId: PersistedWorkspaceIdSchema,
    projectId: PersistedProjectIdSchema,
    jobId: GenerationJobIdSchema,
    creatingAttemptId: GenerationAttemptIdSchema,
    requestSha256: OperationRequestSha256Schema,
    workflow: WorkflowVersionContractSchema,
    outputKey: OutputKeySchema,
    reference: CheckpointReferenceIdentitySchema,
  })
  .readonly();

export type CheckpointReuseExpectation = z.infer<typeof CheckpointReuseExpectationSchema>;

const AnalysisCheckpointMaterialSchema = z
  .strictObject({
    kind: z.literal('analysis_payload'),
    workspaceId: PersistedWorkspaceIdSchema,
    projectId: PersistedProjectIdSchema,
    jobId: GenerationJobIdSchema,
    declaredContentSha256: Sha256HexSchema,
    payload: CompositionAnalysisResultV1Schema,
  })
  .superRefine((material, context) => {
    if (
      sha256Hex(Buffer.from(canonicalizeJson(material.payload), 'utf8')) !==
      material.declaredContentSha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Analysis checkpoint material digest must match its strict payload.',
      });
    }
  })
  .readonly();

const AssetCheckpointMaterialSchema = z
  .strictObject({
    kind: z.literal('asset_version'),
    workspaceId: PersistedWorkspaceIdSchema,
    projectId: PersistedProjectIdSchema,
    jobId: GenerationJobIdSchema,
    assetVersionId: PersistedAssetVersionIdSchema,
    declaredContentSha256: Sha256HexSchema,
    byteSize: z.int().min(1).max(MAX_RASTER_ENCODED_BYTES),
    bytes: z.instanceof(Uint8Array),
  })
  .superRefine((material, context) => {
    if (
      material.bytes.byteLength !== material.byteSize ||
      sha256Hex(material.bytes) !== material.declaredContentSha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Asset checkpoint material bytes must match size and digest.',
      });
    }
  })
  .readonly();

const SceneCheckpointMaterialSchema = z
  .strictObject({
    kind: z.literal('banner_scene_version'),
    workspaceId: PersistedWorkspaceIdSchema,
    projectId: PersistedProjectIdSchema,
    jobId: GenerationJobIdSchema,
    sceneVersionId: PersistedSceneVersionIdSchema,
    declaredContentSha256: Sha256HexSchema,
    scene: BannerSceneV1Schema,
  })
  .superRefine((material, context) => {
    if (sha256BannerScene(material.scene) !== material.declaredContentSha256) {
      context.addIssue({
        code: 'custom',
        message: 'Scene checkpoint material digest must match its strict scene.',
      });
    }
  })
  .readonly();

export const CheckpointMaterialSchema = z
  .discriminatedUnion('kind', [
    AnalysisCheckpointMaterialSchema,
    AssetCheckpointMaterialSchema,
    SceneCheckpointMaterialSchema,
  ])
  .readonly();

export type CheckpointMaterial = z.infer<typeof CheckpointMaterialSchema>;

const CheckpointMismatchErrorSchema = StructuredJobErrorSchema.superRefine((error, context) => {
  const expected = createStructuredJobError(
    'CHECKPOINT_IDENTITY_MISMATCH',
    'Committed checkpoint identity or content does not match the current job.',
  );
  if (canonicalizeJson(error) !== canonicalizeJson(expected)) {
    context.addIssue({
      code: 'custom',
      message: 'Checkpoint mismatch must use the exact fail-closed structured error.',
    });
  }
});

export const CheckpointReuseDecisionSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('absent'), overwrite: z.literal(false) }).readonly(),
    z
      .strictObject({
        kind: z.literal('reuse'),
        checkpoint: PersistedCheckpointIdentitySchema,
        contentSha256: Sha256HexSchema,
        overwrite: z.literal(false),
      })
      .superRefine((decision, context) => {
        if (decision.contentSha256 !== decision.checkpoint.contentSha256) {
          context.addIssue({
            code: 'custom',
            message: 'Reusable checkpoint content digest must equal its persisted identity.',
          });
        }
      })
      .readonly(),
    z
      .strictObject({
        kind: z.literal('mismatch'),
        jobState: z.literal('failed'),
        error: CheckpointMismatchErrorSchema,
        overwrite: z.literal(false),
        ignore: z.literal(false),
      })
      .readonly(),
  ])
  .readonly();

export type CheckpointReuseDecision = z.infer<typeof CheckpointReuseDecisionSchema>;

const CheckpointReuseCandidateSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('absent') }),
  z.strictObject({
    kind: z.literal('existing'),
    expected: z.unknown(),
    persisted: z.unknown(),
    material: z.unknown(),
  }),
]);

const mismatch = (): CheckpointReuseDecision =>
  CheckpointReuseDecisionSchema.parse({
    kind: 'mismatch',
    jobState: 'failed',
    error: createStructuredJobError(
      'CHECKPOINT_IDENTITY_MISMATCH',
      'Committed checkpoint identity or content does not match the current job.',
    ),
    overwrite: false,
    ignore: false,
  });

export const validateCheckpointMaterial = async (
  materialInput: unknown,
  expectedScope: {
    readonly workspaceId: string;
    readonly projectId: string;
    readonly jobId: string;
  },
): Promise<{
  readonly reference: CheckpointReferenceIdentity;
  readonly payload: z.infer<typeof CompositionAnalysisResultV1Schema> | null;
  readonly contentSha256: string;
}> => {
  const material = CheckpointMaterialSchema.parse(materialInput);
  if (
    material.workspaceId !== expectedScope.workspaceId ||
    material.projectId !== expectedScope.projectId ||
    material.jobId !== expectedScope.jobId
  ) {
    throw new TypeError('Checkpoint material must come from the authoritative job scope.');
  }
  const declaredContentSha256 = Sha256HexSchema.parse(material.declaredContentSha256);
  if (material.kind === 'analysis_payload') {
    const payload = material.payload;
    const contentSha256 = sha256Hex(Buffer.from(canonicalizeJson(payload), 'utf8'));
    if (contentSha256 !== declaredContentSha256) {
      throw new TypeError('Analysis material digest differs from its authoritative row.');
    }
    return {
      reference: AnalysisReferenceSchema.parse({ kind: 'analysis_payload' }),
      payload,
      contentSha256,
    };
  }
  if (material.kind === 'asset_version') {
    const assetVersionId = PersistedAssetVersionIdSchema.parse(material.assetVersionId);
    const byteSize = z.int().min(1).max(MAX_RASTER_ENCODED_BYTES).parse(material.byteSize);
    if (
      !(material.bytes instanceof Uint8Array) ||
      material.bytes.byteLength !== byteSize ||
      sha256Hex(material.bytes) !== declaredContentSha256
    ) {
      throw new TypeError('Checkpoint asset material must contain immutable bytes.');
    }
    await validateNormalizedPng(material.bytes);
    return {
      reference: AssetReferenceSchema.parse({ kind: 'asset_version', assetVersionId }),
      payload: null,
      contentSha256: declaredContentSha256,
    };
  }
  const sceneVersionId = PersistedSceneVersionIdSchema.parse(material.sceneVersionId);
  const scene = material.scene;
  const contentSha256 = sha256BannerScene(scene);
  if (contentSha256 !== declaredContentSha256) {
    throw new TypeError('Scene material digest differs from its authoritative row.');
  }
  return {
    reference: SceneReferenceSchema.parse({ kind: 'banner_scene_version', sceneVersionId }),
    payload: null,
    contentSha256,
  };
};

export const verifyCheckpointReuse = async (input: {
  readonly expected: unknown;
  readonly persisted: unknown;
  readonly material: unknown;
}): Promise<CheckpointReuseDecision> => {
  try {
    const expectedInput = CheckpointReuseExpectationSchema.parse(input.expected);
    const materialInput = CheckpointMaterialSchema.parse(input.material);
    const workflow = expectedInput.workflow;
    const outputKey = expectedInput.outputKey;
    const declaration = workflow.definition.outputs.find(
      (output) => output.outputKey === outputKey,
    );
    if (
      declaration === undefined ||
      declaration.disposition !== 'checkpoint' ||
      !declaration.replaySafe
    ) {
      return mismatch();
    }
    const expected = PersistedCheckpointIdentitySchema.parse({
      workspaceId: expectedInput.workspaceId,
      projectId: expectedInput.projectId,
      jobId: expectedInput.jobId,
      attemptId: expectedInput.creatingAttemptId,
      requestSha256: expectedInput.requestSha256,
      workflow: {
        workflowVersionId: workflow.workflowVersionId,
        workflowVersion: workflow.workflowVersion,
        definitionSha256: workflow.definitionSha256,
      },
      output: declaration,
      reference: expectedInput.reference,
      payload:
        declaration.kind === 'analysis_proposal'
          ? materialInput.kind === 'analysis_payload'
            ? materialInput.payload
            : null
          : null,
      contentSha256:
        declaration.kind === 'analysis_proposal' && materialInput.kind === 'analysis_payload'
          ? sha256Hex(Buffer.from(canonicalizeJson(materialInput.payload), 'utf8'))
          : '0'.repeat(64),
    });
    const persisted = PersistedCheckpointIdentitySchema.parse(input.persisted);
    const material = await validateCheckpointMaterial(materialInput, {
      workspaceId: expected.workspaceId,
      projectId: expected.projectId,
      jobId: expected.jobId,
    });
    const expectedIdentity = {
      workspaceId: expected.workspaceId,
      projectId: expected.projectId,
      jobId: expected.jobId,
      attemptId: expected.attemptId,
      requestSha256: expected.requestSha256,
      workflow: expected.workflow,
      output: expected.output,
      reference: expected.reference,
    };
    const persistedIdentity = {
      workspaceId: persisted.workspaceId,
      projectId: persisted.projectId,
      jobId: persisted.jobId,
      attemptId: persisted.attemptId,
      requestSha256: persisted.requestSha256,
      workflow: persisted.workflow,
      output: persisted.output,
      reference: persisted.reference,
    };
    if (
      canonicalizeJson(expectedIdentity) !== canonicalizeJson(persistedIdentity) ||
      canonicalizeJson(expected.reference) !== canonicalizeJson(material.reference) ||
      persisted.contentSha256 !== material.contentSha256 ||
      canonicalizeJson(persisted.payload) !== canonicalizeJson(material.payload)
    ) {
      return mismatch();
    }
    return CheckpointReuseDecisionSchema.parse({
      kind: 'reuse',
      checkpoint: persisted,
      contentSha256: material.contentSha256,
      overwrite: false,
    });
  } catch {
    return mismatch();
  }
};

export const resolveCheckpointReuseCandidate = async (
  input: unknown,
): Promise<CheckpointReuseDecision> => {
  const candidate = CheckpointReuseCandidateSchema.parse(input);
  if (candidate.kind === 'absent') {
    return CheckpointReuseDecisionSchema.parse({ kind: 'absent', overwrite: false });
  }
  return verifyCheckpointReuse(candidate);
};
