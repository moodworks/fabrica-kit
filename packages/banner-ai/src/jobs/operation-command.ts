import { z } from 'zod';

import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import { WorkflowVersionContractSchema } from '../workflows/workflow-definition.js';
import {
  BannerOperationSchema,
  GenerationOutputIdSchema,
  IdempotencyKeySchema,
  OutputKeySchema,
  PersistedAssetVersionIdSchema,
  PersistedProjectIdSchema,
  PersistedSceneVersionIdSchema,
  PersistedWorkflowVersionIdSchema,
  PersistedWorkspaceIdSchema,
  type BannerOperation,
} from './syntax.js';
import {
  OperationRequestSha256Schema,
  digestValidatedOperationRequest,
  type OperationRequestSha256,
} from './request-digests.js';

const AnalyzeParametersV1Schema = z
  .strictObject({
    maxParts: z.int().min(1).max(5),
    includeBackground: z.boolean(),
  })
  .readonly();

const ExtractParametersV1Schema = z
  .strictObject({
    analysisOutputId: GenerationOutputIdSchema,
    partKey: OutputKeySchema,
    trimTransparentPixels: z.boolean(),
  })
  .readonly();

const ExportParametersV1Schema = z
  .strictObject({
    sceneVersionId: PersistedSceneVersionIdSchema,
    artifactProfile: z.literal('scene-export-settings-v1'),
  })
  .readonly();

const AnalyzeCommandV1Schema = z
  .strictObject({
    commandVersion: z.literal(1),
    projectId: PersistedProjectIdSchema,
    operation: z.literal('banner.analyze'),
    workflowVersionId: PersistedWorkflowVersionIdSchema,
    idempotencyKey: IdempotencyKeySchema,
    sourceAssetVersionId: PersistedAssetVersionIdSchema,
    parameters: AnalyzeParametersV1Schema,
  })
  .readonly();

const ExtractCommandV1Schema = z
  .strictObject({
    commandVersion: z.literal(1),
    projectId: PersistedProjectIdSchema,
    operation: z.literal('banner.extract'),
    workflowVersionId: PersistedWorkflowVersionIdSchema,
    idempotencyKey: IdempotencyKeySchema,
    sourceAssetVersionId: PersistedAssetVersionIdSchema,
    parameters: ExtractParametersV1Schema,
  })
  .readonly();

const ExportCommandV1Schema = z
  .strictObject({
    commandVersion: z.literal(1),
    projectId: PersistedProjectIdSchema,
    operation: z.literal('banner.export'),
    workflowVersionId: PersistedWorkflowVersionIdSchema,
    idempotencyKey: IdempotencyKeySchema,
    parameters: ExportParametersV1Schema,
  })
  .readonly();

export const Phase1AOperationCommandSchema = z.discriminatedUnion('operation', [
  AnalyzeCommandV1Schema,
  ExtractCommandV1Schema,
  ExportCommandV1Schema,
]);

export type Phase1AOperationCommand = z.infer<typeof Phase1AOperationCommandSchema>;

export const ResolvedAssetRequestIdentitySchema = z
  .strictObject({
    assetVersionId: PersistedAssetVersionIdSchema,
    sha256: Sha256HexSchema,
  })
  .readonly();

export type ResolvedAssetRequestIdentity = z.infer<typeof ResolvedAssetRequestIdentitySchema>;

export interface AuthoritativeCommandResolution {
  readonly workflow: z.input<typeof WorkflowVersionContractSchema>;
  readonly inputAssets: readonly z.input<typeof ResolvedAssetRequestIdentitySchema>[];
}

const WorkflowRequestIdentitySchema = z
  .strictObject({
    workflowVersionId: PersistedWorkflowVersionIdSchema,
    workflowVersion: z.int().min(1).max(2_147_483_647),
    definitionSha256: Sha256HexSchema,
  })
  .readonly();

const CanonicalInputAssetsSchema = z
  .array(ResolvedAssetRequestIdentitySchema)
  .min(1)
  .max(66)
  .readonly();

const CanonicalAnalyzeRequestV1Schema = z
  .strictObject({
    commandVersion: z.literal(1),
    projectId: PersistedProjectIdSchema,
    operation: z.literal('banner.analyze'),
    workflowVersion: WorkflowRequestIdentitySchema,
    inputAssets: CanonicalInputAssetsSchema,
    parameters: AnalyzeParametersV1Schema,
  })
  .readonly();

const CanonicalExtractRequestV1Schema = z
  .strictObject({
    commandVersion: z.literal(1),
    projectId: PersistedProjectIdSchema,
    operation: z.literal('banner.extract'),
    workflowVersion: WorkflowRequestIdentitySchema,
    inputAssets: CanonicalInputAssetsSchema,
    parameters: ExtractParametersV1Schema,
  })
  .readonly();

const CanonicalExportRequestV1Schema = z
  .strictObject({
    commandVersion: z.literal(1),
    projectId: PersistedProjectIdSchema,
    operation: z.literal('banner.export'),
    workflowVersion: WorkflowRequestIdentitySchema,
    inputAssets: CanonicalInputAssetsSchema,
    parameters: ExportParametersV1Schema,
  })
  .readonly();

export const CanonicalOperationRequestV1Schema = z.discriminatedUnion('operation', [
  CanonicalAnalyzeRequestV1Schema,
  CanonicalExtractRequestV1Schema,
  CanonicalExportRequestV1Schema,
]);

export type CanonicalOperationRequestV1 = z.infer<typeof CanonicalOperationRequestV1Schema>;

const canonicalInputAssets = (
  assets: readonly z.input<typeof ResolvedAssetRequestIdentitySchema>[],
): readonly ResolvedAssetRequestIdentity[] => {
  const parsed = assets.map((asset) => ResolvedAssetRequestIdentitySchema.parse(asset));
  parsed.sort((left, right) =>
    left.assetVersionId < right.assetVersionId
      ? -1
      : left.assetVersionId > right.assetVersionId
        ? 1
        : 0,
  );
  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index - 1]!.assetVersionId === parsed[index]!.assetVersionId) {
      throw new TypeError('Resolved command input asset versions must be unique.');
    }
  }
  return Object.freeze(parsed);
};

export const projectCanonicalOperationRequest = (
  commandInput: unknown,
  resolutionInput: AuthoritativeCommandResolution,
): CanonicalOperationRequestV1 => {
  const command = Phase1AOperationCommandSchema.parse(commandInput);
  const workflow = WorkflowVersionContractSchema.parse(resolutionInput.workflow);
  if (
    workflow.workflowVersionId !== command.workflowVersionId ||
    workflow.definition.workflowKey !== command.operation
  ) {
    throw new TypeError('Resolved workflow identity does not match the operation command.');
  }
  const inputAssets = canonicalInputAssets(resolutionInput.inputAssets);
  if (inputAssets.length < 1 || inputAssets.length > 66) {
    throw new TypeError('Resolved command input assets are outside the product bound.');
  }
  if (
    command.operation !== 'banner.export' &&
    (inputAssets.length !== 1 || inputAssets[0]!.assetVersionId !== command.sourceAssetVersionId)
  ) {
    throw new TypeError('Resolved source asset identity does not match the operation command.');
  }

  const workflowVersion = {
    workflowVersionId: workflow.workflowVersionId,
    workflowVersion: workflow.workflowVersion,
    definitionSha256: workflow.definitionSha256,
  };
  return CanonicalOperationRequestV1Schema.parse({
    commandVersion: command.commandVersion,
    projectId: command.projectId,
    operation: command.operation,
    workflowVersion,
    inputAssets,
    parameters: command.parameters,
  });
};

export const canonicalOperationRequestJson = (
  commandInput: unknown,
  resolution: AuthoritativeCommandResolution,
): string => canonicalizeJson(projectCanonicalOperationRequest(commandInput, resolution));

export const operationRequestSha256 = (
  commandInput: unknown,
  resolution: AuthoritativeCommandResolution,
): OperationRequestSha256 =>
  digestValidatedOperationRequest(projectCanonicalOperationRequest(commandInput, resolution));

export interface IdempotencyScope {
  readonly workspaceId: string;
  readonly operation: BannerOperation;
  readonly idempotencyKey: string;
}

export interface ExistingIdempotentJob<TJob> {
  readonly scope: IdempotencyScope;
  readonly requestSha256: OperationRequestSha256;
  readonly job: TJob;
}

export type IdempotentCreationDecision<TJob> =
  | { readonly kind: 'create'; readonly requestSha256: OperationRequestSha256 }
  | {
      readonly kind: 'return-existing';
      readonly job: TJob;
      readonly sideEffects: 'none';
    }
  | {
      readonly kind: 'conflict';
      readonly code: 'IDEMPOTENCY_KEY_REUSED';
      readonly sideEffects: 'none';
    };

const parseIdempotencyScope = (scope: IdempotencyScope): IdempotencyScope => ({
  workspaceId: PersistedWorkspaceIdSchema.parse(scope.workspaceId),
  operation: BannerOperationSchema.parse(scope.operation),
  idempotencyKey: IdempotencyKeySchema.parse(scope.idempotencyKey),
});

const scopesEqual = (left: IdempotencyScope, right: IdempotencyScope): boolean =>
  left.workspaceId === right.workspaceId &&
  left.operation === right.operation &&
  left.idempotencyKey === right.idempotencyKey;

export const decideIdempotentJobCreation = <TJob>(input: {
  readonly scope: IdempotencyScope;
  readonly requestSha256: OperationRequestSha256;
  readonly existing: ExistingIdempotentJob<TJob> | null;
}): IdempotentCreationDecision<TJob> => {
  const scope = parseIdempotencyScope(input.scope);
  const requestSha256 = OperationRequestSha256Schema.parse(input.requestSha256);
  if (input.existing === null) return { kind: 'create', requestSha256 };
  const existingScope = parseIdempotencyScope(input.existing.scope);
  if (!scopesEqual(scope, existingScope)) {
    throw new TypeError('Idempotency comparison requires the exact authoritative scope.');
  }
  const existingDigest = OperationRequestSha256Schema.parse(input.existing.requestSha256);
  return existingDigest === requestSha256
    ? { kind: 'return-existing', job: input.existing.job, sideEffects: 'none' }
    : { kind: 'conflict', code: 'IDEMPOTENCY_KEY_REUSED', sideEffects: 'none' };
};
