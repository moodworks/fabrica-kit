import { randomBytes, randomUUID } from 'node:crypto';

import {
  byteSourceFrom,
  normalizeRasterUpload,
  type ActorWorkspaceContext,
  appendProviderFreeBannerProjectRevisionV1,
  canonicalizeJson,
  createBannerSceneV1PreviewDocument,
  createBannerSceneV1RenderPlan,
  createProviderFreeBannerExporterV1,
  createProviderFreeInternalValidatorV1,
  BannerExportRequestSchema,
  PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_V1,
  PROVIDER_FREE_EXPORTER_V1,
  PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1,
  parseBannerSceneV1,
  parseProviderFreeBannerProjectV1,
  sha256BannerScene,
  validateBannerExportResult,
  validateInternalGdnValidationResult,
} from '@fabrica/banner-ai';
import {
  generateUploadedBannerSamCandidates,
  composeUploadedBannerSamCandidates,
  type UploadedBannerSamGenerator,
  type UploadedBannerSamOperationResult,
} from '@fabrica/banner-ai/server/uploaded-banner-sam-operation-v1';
import { materializeUploadedBannerOperationProjectV1 } from '@fabrica/banner-ai';
import { SamReplayError } from '@fabrica/banner-ai/server/uploaded-banner-sam-replay-v4';

const OPERATION_TTL_MS = 5 * 60_000;
const MAX_OPERATION_BYTES = 48 * 1024 * 1024;
const MAX_PREVIEW_DOCUMENT_BYTES = 1_048_576;
const MAX_EXPORT_RESPONSE_BYTES = 2_097_152;
const operationIdPattern = /^[0-9a-f]{64}$/u;

export class UploadedBannerOperationError extends Error {
  constructor(
    readonly code:
      | 'AUTHORIZATION_REQUIRED'
      | 'OPERATION_INVALID'
      | 'OPERATION_EXPIRED'
      | 'CANDIDATE_INVALID'
      | 'UNSUPPORTED_SOURCE',
    message: string,
  ) {
    super(message);
    this.name = 'UploadedBannerOperationError';
  }
}

export interface UploadedBannerOperation {
  readonly operationId: string;
  readonly workspaceId: string;
  readonly createdAtMs: number;
  readonly expiresAtMs: number;
  readonly source: UploadedBannerSamOperationResult['request']['source'];
  readonly sourceBytes: Uint8Array;
  readonly result: UploadedBannerSamOperationResult;
  readonly projects: Map<
    string,
    Promise<Awaited<ReturnType<typeof materializeUploadedBannerOperationProjectV1>>>
  >;
  readonly projectBytes: Map<string, number>;
  readonly composed: Map<
    string,
    Promise<{
      readonly subjectId: string;
      readonly candidates: readonly UploadedBannerSamOperationResult['candidates'][number][];
    }>
  >;
  readonly resolvedSubjects: Map<
    string,
    {
      readonly subjectId: string;
      readonly candidates: readonly UploadedBannerSamOperationResult['candidates'][number][];
    }
  >;
  composedBytes: number;
  readonly saveLocks: Map<string, Promise<void>>;
}

const uploadedOperationRegistryKey = Symbol.for('fabrica.banner-ai.uploaded-operation.v1');
const uploadedOperationRegistry = globalThis as typeof globalThis & {
  [uploadedOperationRegistryKey]?: UploadedBannerOperation | null;
};
const getCurrent = (): UploadedBannerOperation | null =>
  uploadedOperationRegistry[uploadedOperationRegistryKey] ?? null;
const setCurrent = (value: UploadedBannerOperation | null): void => {
  uploadedOperationRegistry[uploadedOperationRegistryKey] = value;
};

const assertId = (operationId: unknown): string => {
  if (typeof operationId !== 'string' || !operationIdPattern.test(operationId)) {
    throw new UploadedBannerOperationError(
      'OPERATION_INVALID',
      'The uploaded operation is invalid.',
    );
  }
  return operationId;
};

const resolve = (
  operationId: unknown,
  authority: ActorWorkspaceContext,
): UploadedBannerOperation => {
  const id = assertId(operationId);
  const operation = getCurrent();
  if (
    operation === null ||
    operation.operationId !== id ||
    operation.workspaceId !== authority.workspaceId
  ) {
    throw new UploadedBannerOperationError(
      'OPERATION_INVALID',
      'The uploaded operation is unknown or foreign.',
    );
  }
  if (Date.now() >= operation.expiresAtMs) {
    setCurrent(null);
    throw new UploadedBannerOperationError(
      'OPERATION_EXPIRED',
      'The uploaded operation has expired.',
    );
  }
  return operation;
};

export const createUploadedBannerOperation = async (input: {
  readonly file: File;
  readonly authority: ActorWorkspaceContext;
  readonly generator?: UploadedBannerSamGenerator;
  readonly replay?: (source: Uint8Array) => Promise<UploadedBannerSamOperationResult>;
}): Promise<{
  readonly operationId: string;
  readonly catalog: ReturnType<typeof uploadedCandidateCatalog>;
}> => {
  if (input.generator === undefined && input.replay === undefined) {
    throw new UploadedBannerOperationError(
      'AUTHORIZATION_REQUIRED',
      'Real SAM generation requires authorization before transport construction.',
    );
  }
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const normalized = await normalizeRasterUpload({
    bytes: byteSourceFrom(bytes),
    declaredMediaType: input.file.type,
    filename: input.file.name,
  });
  const result =
    input.replay !== undefined
      ? await input.replay(Uint8Array.from(normalized.bytes)).catch((error: unknown) => {
          if (error instanceof SamReplayError && error.kind === 'SOURCE_MISMATCH')
            throw new UploadedBannerOperationError(
              'UNSUPPORTED_SOURCE',
              'Only the authorized Samsung fixture has a verified local replay; this upload is not supported.',
            );
          throw new UploadedBannerOperationError(
            'OPERATION_INVALID',
            'The verified local replay evidence is unavailable or invalid.',
          );
        })
      : await generateUploadedBannerSamCandidates({
          normalizedPng: normalized.bytes,
          requestId: randomUUID(),
          workspaceId: randomUUID(),
          jobId: randomUUID(),
          attemptId: randomUUID(),
          generator: input.generator!,
        });
  const aggregateBytes =
    normalized.byteSize +
    result.candidates.reduce(
      (sum, candidate) =>
        sum + candidate.materialization.cutoutPng.byteLength + candidate.preview.byteSize,
      0,
    );
  if (aggregateBytes > MAX_OPERATION_BYTES) {
    throw new UploadedBannerOperationError(
      'OPERATION_INVALID',
      'The uploaded operation exceeds its byte bound.',
    );
  }
  const now = Date.now();
  const operation: UploadedBannerOperation = {
    operationId: randomBytes(32).toString('hex'),
    workspaceId: input.authority.workspaceId,
    createdAtMs: now,
    expiresAtMs: now + OPERATION_TTL_MS,
    source: result.request.source,
    sourceBytes: Uint8Array.from(normalized.bytes),
    result,
    projects: new Map(),
    projectBytes: new Map(),
    composed: new Map(),
    resolvedSubjects: new Map(),
    composedBytes: 0,
    saveLocks: new Map(),
  };
  setCurrent(operation);
  return { operationId: operation.operationId, catalog: uploadedCandidateCatalog(operation) };
};

export const uploadedCandidateCatalog = (operation: UploadedBannerOperation) =>
  Object.freeze(
    operation.result.candidates.map((candidate, index) =>
      Object.freeze({
        candidateId: candidate.candidateId,
        source: {
          width: operation.result.request.source.width,
          height: operation.result.request.source.height,
        },
        order: index + 1,
        bounds: {
          x: candidate.bounds.xBps,
          y: candidate.bounds.yBps,
          width: candidate.bounds.widthBps,
          height: candidate.bounds.heightBps,
        },
        crop: candidate.materialization.metadata.crop,
        pixelArea: candidate.pixelArea,
        areaRatioBps: candidate.areaRatioBps,
        thumbnail: Object.freeze({
          byteSize: candidate.preview.byteSize,
          pixelWidth: candidate.preview.pixelWidth,
          pixelHeight: candidate.preview.pixelHeight,
          sha256: candidate.preview.sha256,
          dataUrl: candidate.preview.dataUrl,
        }),
        provenance: operation.result.provenance,
      }),
    ),
  );

export const resolveUploadedBannerOperation = (
  operationId: unknown,
  authority: ActorWorkspaceContext,
) => resolve(operationId, authority);

export const resolveUploadedBannerCandidate = (
  operationId: unknown,
  candidateId: unknown,
  authority: ActorWorkspaceContext,
) => {
  const operation = resolve(operationId, authority);
  if (typeof candidateId !== 'string') {
    throw new UploadedBannerOperationError('CANDIDATE_INVALID', 'The candidate ID is invalid.');
  }
  const candidate = operation.result.candidates.find((entry) => entry.candidateId === candidateId);
  if (candidate === undefined) {
    throw new UploadedBannerOperationError(
      'CANDIDATE_INVALID',
      'The candidate is not owned by this operation.',
    );
  }
  return { operation, candidate };
};

export const composeUploadedBannerOperation = async (input: {
  readonly operationId: unknown;
  readonly candidateIds: unknown;
  readonly authority: ActorWorkspaceContext;
}) => {
  const operation = resolve(input.operationId, input.authority);
  if (
    !Array.isArray(input.candidateIds) ||
    input.candidateIds.length < 1 ||
    input.candidateIds.length > 8 ||
    input.candidateIds.some((id) => typeof id !== 'string') ||
    new Set(input.candidateIds).size !== input.candidateIds.length
  )
    throw new UploadedBannerOperationError(
      'CANDIDATE_INVALID',
      'Select one to eight unique candidates.',
    );
  const requestedIds = input.candidateIds as string[];
  const ids = operation.result.candidates
    .filter((candidate) => requestedIds.includes(candidate.candidateId))
    .map((candidate) => candidate.candidateId);
  if (ids.length !== requestedIds.length)
    throw new UploadedBannerOperationError(
      'CANDIDATE_INVALID',
      'The candidate is not owned by this operation.',
    );
  const key = operation.result.candidates
    .map((candidate) => (ids.includes(candidate.candidateId) ? candidate.candidateId : ''))
    .filter(Boolean)
    .join(',');
  let composed = operation.composed.get(key);
  if (composed === undefined) {
    if (operation.composed.size >= 8)
      throw new UploadedBannerOperationError(
        'OPERATION_INVALID',
        'The operation has reached its combined-subject limit.',
      );
    composed = composeUploadedBannerSamCandidates({
      operation: operation.result,
      candidateIds: ids,
    }).then((value) => ({ subjectId: value.subjectId, candidates: value.candidates }));
    operation.composed.set(key, composed);
    void composed.catch(() => {
      if (operation.composed.get(key) === composed) operation.composed.delete(key);
    });
  }
  const value = await composed;
  const selectedBytes = value.candidates.reduce(
    (sum, candidate) => sum + candidate.materialization.cutoutPng.byteLength,
    0,
  );
  if (selectedBytes > 64 * 1024 * 1024) {
    operation.composed.delete(key);
    throw new UploadedBannerOperationError(
      'OPERATION_INVALID',
      'The combined subject exceeds its byte bound.',
    );
  }
  if (!operation.resolvedSubjects.has(value.subjectId))
    operation.resolvedSubjects.set(value.subjectId, value);
  operation.composedBytes = [...operation.resolvedSubjects.values()].reduce(
    (sum, entry) =>
      sum +
      entry.candidates.reduce(
        (bytes, candidate) => bytes + candidate.materialization.cutoutPng.byteLength,
        0,
      ),
    0,
  );
  if (operation.composedBytes > 64 * 1024 * 1024) {
    operation.composed.delete(key);
    operation.resolvedSubjects.delete(value.subjectId);
    operation.composedBytes = [...operation.resolvedSubjects.values()].reduce(
      (sum, entry) =>
        sum +
        entry.candidates.reduce(
          (bytes, candidate) => bytes + candidate.materialization.cutoutPng.byteLength,
          0,
        ),
      0,
    );
    throw new UploadedBannerOperationError(
      'OPERATION_INVALID',
      'The operation has reached its derived-byte limit.',
    );
  }
  return { operation, ...value };
};

export const openUploadedBannerProject = async (input: {
  readonly operationId: unknown;
  readonly candidateId: unknown;
  readonly authority: ActorWorkspaceContext;
}) => {
  const operation = resolve(input.operationId, input.authority);
  let candidate = operation.result.candidates.find(
    (entry) => entry.candidateId === input.candidateId,
  );
  let selectedCandidates:
    readonly UploadedBannerSamOperationResult['candidates'][number][] | undefined;
  if (
    candidate === undefined &&
    typeof input.candidateId === 'string' &&
    /^sams_v1_[0-9a-f]{64}$/u.test(input.candidateId)
  ) {
    for (const composed of operation.resolvedSubjects.values()) {
      if (composed.subjectId === input.candidateId) {
        selectedCandidates = composed.candidates;
        candidate = composed.candidates[0];
        break;
      }
    }
  }
  if (candidate === undefined)
    throw new UploadedBannerOperationError(
      'CANDIDATE_INVALID',
      'The candidate is not owned by this operation.',
    );
  const projectKey = input.candidateId as string;
  let project = operation.projects.get(projectKey);
  if (project === undefined) {
    if (operation.projects.size >= 8)
      throw new UploadedBannerOperationError(
        'OPERATION_INVALID',
        'The operation has reached its materialized project limit.',
      );
    project = materializeUploadedBannerOperationProjectV1({
      source: operation.sourceBytes,
      subject: candidate.materialization.cutoutPng,
      candidateId: input.candidateId as string,
      bounds: candidate.bounds,
      ...(selectedCandidates === undefined
        ? {}
        : {
            subjects: selectedCandidates.map((entry) => ({
              subject: entry.materialization.cutoutPng,
              candidateId: entry.candidateId,
              bounds: entry.bounds,
            })),
          }),
    });
    operation.projects.set(projectKey, project);
    void project.catch(() => {
      if (operation.projects.get(projectKey) === project) {
        operation.projects.delete(projectKey);
        operation.projectBytes.delete(projectKey);
      }
    });
  }
  const materialization = await project;
  operation.projectBytes.set(
    projectKey,
    materialization.assets.reduce((bytes, asset) => bytes + asset.bytes.byteLength, 0),
  );
  const materializedBytes = [...operation.projectBytes.values()].reduce(
    (sum, bytes) => sum + bytes,
    0,
  );
  if (materializedBytes > 64 * 1024 * 1024) {
    operation.projects.delete(projectKey);
    operation.projectBytes.delete(projectKey);
    throw new UploadedBannerOperationError(
      'OPERATION_INVALID',
      'The operation materialized asset bound was exceeded.',
    );
  }
  return { operation, candidate, materialization };
};

export const resetUploadedBannerOperationRegistryForTests = (): void => {
  setCurrent(null);
};

const projectFor = async (
  operationId: unknown,
  candidateId: unknown,
  authority: ActorWorkspaceContext,
) => {
  const opened = await openUploadedBannerProject({ operationId, candidateId, authority });
  return opened;
};

const assertProject = async (input: {
  readonly operationId: unknown;
  readonly candidateId: unknown;
  readonly project: unknown;
  readonly authority: ActorWorkspaceContext;
}) => {
  const opened = await projectFor(input.operationId, input.candidateId, input.authority);
  const project = parseProviderFreeBannerProjectV1(input.project);
  if (canonicalizeJson(project) !== canonicalizeJson(opened.materialization.project)) {
    throw new UploadedBannerOperationError(
      'OPERATION_INVALID',
      'The uploaded project is foreign to this operation.',
    );
  }
  return { ...opened, project };
};

export const saveUploadedBannerProject = async (input: {
  readonly operationId: unknown;
  readonly candidateId: unknown;
  readonly project: unknown;
  readonly scene: unknown;
  readonly selectedPartId: unknown;
  readonly authority: ActorWorkspaceContext;
}) => {
  const initial = await openUploadedBannerProject({
    operationId: input.operationId,
    candidateId: input.candidateId,
    authority: input.authority,
  });
  const subjectKey = input.candidateId as string;
  const prior = initial.operation.saveLocks.get(subjectKey) ?? Promise.resolve();
  let release!: () => void;
  const lock = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = prior.then(() => lock);
  initial.operation.saveLocks.set(subjectKey, queued);
  await prior;
  try {
    const opened = await assertProject(input);
    const parsed = parseBannerSceneV1(input.scene);
    if (!parsed.success || typeof input.selectedPartId !== 'string') {
      throw new UploadedBannerOperationError(
        'OPERATION_INVALID',
        'The uploaded scene draft is invalid.',
      );
    }
    const project = appendProviderFreeBannerProjectRevisionV1({
      project: opened.project,
      scene: parsed.data,
      selectedPartId: input.selectedPartId as never,
    });
    opened.operation.projects.set(
      subjectKey,
      Promise.resolve({ ...opened.materialization, project }),
    );
    return {
      project,
      canonicalProjectJson: canonicalizeJson(project),
      presentation: opened.materialization,
    };
  } finally {
    release();
    if (initial.operation.saveLocks.get(subjectKey) === queued)
      initial.operation.saveLocks.delete(subjectKey);
  }
};

export const createUploadedBannerPreview = async (input: {
  readonly operationId: unknown;
  readonly candidateId: unknown;
  readonly project: unknown;
  readonly revision: unknown;
  readonly sceneSha256: unknown;
  readonly sceneVersionId: unknown;
  readonly nonce: unknown;
  readonly authority: ActorWorkspaceContext;
}) => {
  if (typeof input.nonce !== 'string' || !/^[0-9a-f]{32}$/u.test(input.nonce))
    throw new UploadedBannerOperationError('OPERATION_INVALID', 'The preview nonce is invalid.');
  const checked = await assertProject(input);
  const revision = checked.project.revisions.at(-1)!;
  if (
    input.revision !== revision.revision ||
    input.sceneSha256 !== revision.sceneSha256 ||
    input.sceneVersionId !== revision.sceneVersionId
  )
    throw new UploadedBannerOperationError(
      'OPERATION_INVALID',
      'The uploaded scene capture is stale.',
    );
  const bytes = createBannerSceneV1PreviewDocument({
    plan: createBannerSceneV1RenderPlan(revision.scene),
    assets: checked.materialization.assets,
    nonce: input.nonce,
  });
  if (bytes.byteLength > MAX_PREVIEW_DOCUMENT_BYTES)
    throw new UploadedBannerOperationError(
      'OPERATION_INVALID',
      'The uploaded preview exceeds its response limit.',
    );
  return {
    contentBase64: Buffer.from(bytes).toString('base64'),
    mediaType: 'text/html',
    byteSize: bytes.byteLength,
    nonce: input.nonce,
    sceneSha256: revision.sceneSha256,
  };
};

export const createUploadedBannerExport = async (input: {
  readonly operationId: unknown;
  readonly candidateId: unknown;
  readonly project: unknown;
  readonly revision: unknown;
  readonly sceneSha256: unknown;
  readonly sceneVersionId: unknown;
  readonly authority: ActorWorkspaceContext;
}) => {
  const checked = await assertProject(input);
  const revision = checked.project.revisions.at(-1)!;
  if (
    input.revision !== revision.revision ||
    input.sceneSha256 !== revision.sceneSha256 ||
    input.sceneVersionId !== revision.sceneVersionId
  )
    throw new UploadedBannerOperationError(
      'OPERATION_INVALID',
      'The uploaded scene capture is stale.',
    );
  const request = BannerExportRequestSchema.parse({
    scene: revision.scene,
    sceneVersionId: revision.sceneVersionId,
    sceneRevision: revision.revision,
    sceneWorkflow: revision.sceneWorkflow,
    exportWorkflow: {
      workflowVersionId: PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_V1.workflowVersionId,
      workflowVersion: PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_V1.workflowVersion,
      definitionSha256: PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_V1.definitionSha256,
    },
    exporter: PROVIDER_FREE_EXPORTER_V1,
    assets: checked.materialization.assets,
    deadlineAtMs: Date.now() + 60_000,
    cancellation: Object.freeze({ cancelled: false, throwIfCancelled(): void {} }),
  });
  const result = await createProviderFreeBannerExporterV1().export(request);
  const validated = await validateBannerExportResult({ request, result });
  if (validated.artifact.mediaType !== 'application/zip') {
    throw new UploadedBannerOperationError(
      'OPERATION_INVALID',
      'The uploaded exporter returned a non-ZIP artifact.',
    );
  }
  const manifest = validated.manifest;
  const bytesBase64 = Buffer.from(validated.artifact.bytes).toString('base64');
  if (
    bytesBase64.length > MAX_EXPORT_RESPONSE_BYTES ||
    Buffer.byteLength(JSON.stringify({ ok: true, data: { artifact: { bytesBase64 } } }), 'utf8') >
      MAX_EXPORT_RESPONSE_BYTES
  )
    throw new UploadedBannerOperationError(
      'OPERATION_INVALID',
      'The uploaded export exceeds its response limit.',
    );
  const validationRequest = {
    artifact: validated.artifact,
    profile: PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1,
  };
  const validator = createProviderFreeInternalValidatorV1({ exportRequest: request, manifest });
  const validation = validateInternalGdnValidationResult({
    request: validationRequest,
    result: await validator.validate(validationRequest),
  });
  return {
    artifact: {
      bytesBase64,
      byteSize: validated.artifact.byteSize,
      filename: `${checked.operation.result.provenance === 'Verified Meta SAM 2.1 cutout replay — no live call' ? 'uploaded-verified-meta-sam-replay' : 'uploaded-deterministic-test'}-r${revision.revision}-${validated.artifact.sha256.slice(0, 12)}.zip`,
      mediaType: validated.artifact.mediaType,
      sha256: validated.artifact.sha256,
      validationLabel: validated.artifact.validationLabel,
    },
    manifest,
    sceneSha256: sha256BannerScene(revision.scene),
    validation,
  };
};
