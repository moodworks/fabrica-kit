import {
  BannerExportRequestSchema,
  ProjectIdSchema,
  PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_V1,
  PROVIDER_FREE_EXPORTER_V1,
  PROVIDER_FREE_FIXTURE_VISUALIZATION_LABEL_V1,
  PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1,
  PROVIDER_FREE_PROJECT_ID_V1,
  appendProviderFreeBannerProjectRevisionV1,
  canonicalizeJson,
  createBannerSceneV1PreviewDocument,
  createBannerSceneV1RenderPlan,
  createProviderFreeBannerExporterV1,
  createProviderFreeInternalValidatorV1,
  createProviderFreeSceneReferenceResolver,
  parseBannerSceneV1,
  validateBannerExportResult,
  validateInternalGdnValidationResult,
  validateProviderFreeBannerProjectAgainstFixtureV1,
  validateSceneReferences,
  type ProviderFreeBannerProjectV1,
  type ProviderFreeFixtureMaterializationV1,
} from '@fabrica/banner-ai';
import { materializeProviderFreeAngelProjectWithDeterministicSamBoxPromptsV1 } from '@fabrica/banner-ai/server/sam-box-prompt-layer-extraction';

import type {
  ProviderFreeExportData,
  ProviderFreePreviewData,
  ProviderFreeProjectOpenData,
} from '../../features/banner-ai/banner-ai-project-contract';
import { resolveDevelopmentActorWorkspaceContext } from './development-context';
import { DemoProjectHttpError } from './demo-project-http';

const MAX_PREVIEW_DOCUMENT_BYTES = 1_048_576;
const MAX_EXPORT_RESPONSE_BYTES = 2_097_152;

let materializationPromise: Promise<ProviderFreeFixtureMaterializationV1> | null = null;

const materialization = (): Promise<ProviderFreeFixtureMaterializationV1> => {
  materializationPromise ??= materializeProviderFreeAngelProjectWithDeterministicSamBoxPromptsV1();
  return materializationPromise;
};

const scopeFor = (fixed: ProviderFreeFixtureMaterializationV1) => {
  const authority = resolveDevelopmentActorWorkspaceContext();
  if (fixed.project.projectId !== PROVIDER_FREE_PROJECT_ID_V1) {
    throw new TypeError('The fixed provider-free project identity drifted.');
  }
  return {
    workspaceId: authority.workspaceId,
    projectId: ProjectIdSchema.parse(PROVIDER_FREE_PROJECT_ID_V1),
  };
};

const validateEverySceneReference = async (
  project: ProviderFreeBannerProjectV1,
  fixed: ProviderFreeFixtureMaterializationV1,
): Promise<void> => {
  const scope = scopeFor(fixed);
  const resolver = createProviderFreeSceneReferenceResolver(fixed);
  for (const revision of project.revisions) {
    const validation = await validateSceneReferences(revision.scene, scope, resolver);
    if (!validation.success) {
      throw new DemoProjectHttpError(
        400,
        'PROJECT_REFERENCE_INVALID',
        'Saved demo references do not match the approved local fixture.',
      );
    }
  }
};

export const validateDemoProject = async (
  input: unknown,
): Promise<{
  readonly fixed: ProviderFreeFixtureMaterializationV1;
  readonly project: ProviderFreeBannerProjectV1;
}> => {
  const fixed = await materialization();
  let project: ProviderFreeBannerProjectV1;
  try {
    project = validateProviderFreeBannerProjectAgainstFixtureV1({
      project: input,
      initialScene: fixed.scene,
    });
  } catch {
    throw new DemoProjectHttpError(
      400,
      'PROJECT_STORAGE_CORRUPT',
      'Saved demo data is corrupt or foreign. Reset only this local demo project to continue.',
    );
  }
  await validateEverySceneReference(project, fixed);
  return { fixed, project };
};

export const projectOpenData = (
  fixed: ProviderFreeFixtureMaterializationV1,
  project: ProviderFreeBannerProjectV1,
): ProviderFreeProjectOpenData => ({
  project,
  canonicalProjectJson: canonicalizeJson(project),
  presentation: {
    canvas: { width: 300, height: 200 },
    fixtureLabel: PROVIDER_FREE_FIXTURE_VISUALIZATION_LABEL_V1,
    parts: fixed.presentationParts,
  },
});

export const openInitialDemoProject = async (): Promise<ProviderFreeProjectOpenData> => {
  const fixed = await materialization();
  await validateEverySceneReference(fixed.project, fixed);
  return projectOpenData(fixed, fixed.project);
};

export const saveDemoProject = async (input: {
  readonly project: unknown;
  readonly scene: unknown;
  readonly selectedPartId: unknown;
}): Promise<ProviderFreeProjectOpenData> => {
  const { fixed, project } = await validateDemoProject(input.project);
  const parsedScene = parseBannerSceneV1(input.scene);
  if (!parsedScene.success || typeof input.selectedPartId !== 'string') {
    throw new DemoProjectHttpError(
      400,
      'INVALID_SCENE_DRAFT',
      'The scene draft contains unsupported or invalid changes.',
    );
  }
  let appended: ProviderFreeBannerProjectV1;
  try {
    appended = appendProviderFreeBannerProjectRevisionV1({
      project,
      scene: parsedScene.data,
      selectedPartId: input.selectedPartId as Parameters<
        typeof appendProviderFreeBannerProjectRevisionV1
      >[0]['selectedPartId'],
    });
  } catch (error) {
    throw new DemoProjectHttpError(
      error instanceof RangeError ? 409 : 400,
      error instanceof RangeError ? 'PROJECT_REVISION_LIMIT_REACHED' : 'INVALID_SCENE_DRAFT',
      error instanceof RangeError
        ? 'The local demo reached its fixed 32-revision limit. Reset the demo to begin again.'
        : 'The scene draft contains no supported change or drifted from the fixed fixture.',
    );
  }
  await validateEverySceneReference(appended, fixed);
  return projectOpenData(fixed, appended);
};

export interface DemoOperationIdentity {
  readonly project: unknown;
  readonly revision: unknown;
  readonly sceneSha256: unknown;
  readonly sceneVersionId: unknown;
}

const resolveOperation = async (input: DemoOperationIdentity) => {
  const { fixed, project } = await validateDemoProject(input.project);
  if (
    !Number.isInteger(input.revision) ||
    input.revision !== project.currentAcceptedRevision ||
    typeof input.sceneSha256 !== 'string' ||
    typeof input.sceneVersionId !== 'string'
  ) {
    throw new DemoProjectHttpError(
      409,
      'SCENE_CAPTURE_MISMATCH',
      'Retry from the exact current accepted scene revision.',
    );
  }
  const revision = project.revisions[project.currentAcceptedRevision - 1]!;
  if (
    revision.sceneSha256 !== input.sceneSha256 ||
    revision.sceneVersionId !== input.sceneVersionId
  ) {
    throw new DemoProjectHttpError(
      409,
      'SCENE_CAPTURE_MISMATCH',
      'Retry from the exact current accepted scene revision.',
    );
  }
  return { fixed, project, revision };
};

export const createDemoPreview = async (
  input: DemoOperationIdentity & { readonly nonce: unknown },
): Promise<ProviderFreePreviewData> => {
  if (typeof input.nonce !== 'string' || !/^[0-9a-f]{32}$/u.test(input.nonce)) {
    throw new DemoProjectHttpError(
      400,
      'PREVIEW_NONCE_INVALID',
      'The isolated preview correlation value is invalid.',
    );
  }
  const { fixed, revision } = await resolveOperation(input);
  const bytes = createBannerSceneV1PreviewDocument({
    plan: createBannerSceneV1RenderPlan(revision.scene),
    assets: fixed.assets,
    nonce: input.nonce,
  });
  if (bytes.byteLength > MAX_PREVIEW_DOCUMENT_BYTES) {
    throw new DemoProjectHttpError(
      413,
      'PREVIEW_RESPONSE_TOO_LARGE',
      'The isolated preview exceeds its fixed local size limit.',
    );
  }
  return {
    contentBase64: Buffer.from(bytes).toString('base64'),
    mediaType: 'text/html',
    byteSize: bytes.byteLength,
    nonce: input.nonce,
    sceneSha256: revision.sceneSha256,
  };
};

const exportWorkflowRef = {
  workflowVersionId: PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_V1.workflowVersionId,
  workflowVersion: PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_V1.workflowVersion,
  definitionSha256: PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_V1.definitionSha256,
};

export const createDemoExport = async (
  input: DemoOperationIdentity,
): Promise<ProviderFreeExportData> => {
  const { fixed, revision } = await resolveOperation(input);
  const request = BannerExportRequestSchema.parse({
    scene: revision.scene,
    sceneVersionId: revision.sceneVersionId,
    sceneRevision: revision.revision,
    sceneWorkflow: revision.sceneWorkflow,
    exportWorkflow: exportWorkflowRef,
    exporter: PROVIDER_FREE_EXPORTER_V1,
    assets: fixed.assets,
    deadlineAtMs: Date.now() + 60_000,
    cancellation: Object.freeze({ cancelled: false, throwIfCancelled(): void {} }),
  });
  const result = await createProviderFreeBannerExporterV1().export(request);
  const validated = await validateBannerExportResult({ request, result });
  if (validated.artifact.mediaType !== 'application/zip') {
    throw new TypeError('The fixed HTML exporter returned a non-ZIP artifact.');
  }
  const validationRequest = {
    artifact: validated.artifact,
    profile: PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1,
  };
  const validator = createProviderFreeInternalValidatorV1({
    exportRequest: request,
    manifest: validated.manifest,
  });
  const validation = validateInternalGdnValidationResult({
    request: validationRequest,
    result: await validator.validate(validationRequest),
  });
  const bytesBase64 = Buffer.from(validated.artifact.bytes).toString('base64');
  const data: ProviderFreeExportData = {
    artifact: {
      bytesBase64,
      byteSize: validated.artifact.byteSize,
      filename: `angel-provider-free-r${String(revision.revision)}-${validated.artifact.sha256.slice(0, 12)}.zip`,
      mediaType: validated.artifact.mediaType,
      sha256: validated.artifact.sha256,
      validationLabel: validated.artifact.validationLabel,
    },
    manifest: validated.manifest,
    sceneSha256: revision.sceneSha256,
    validation,
  };
  if (
    bytesBase64.length > MAX_EXPORT_RESPONSE_BYTES ||
    Buffer.byteLength(JSON.stringify({ ok: true, data }), 'utf8') > MAX_EXPORT_RESPONSE_BYTES
  ) {
    throw new DemoProjectHttpError(
      413,
      'EXPORT_RESPONSE_TOO_LARGE',
      'The local export exceeds its fixed encoded response limit.',
    );
  }
  return data;
};

export const clearDemoMaterializationCacheForTests = (): void => {
  materializationPromise = null;
};
