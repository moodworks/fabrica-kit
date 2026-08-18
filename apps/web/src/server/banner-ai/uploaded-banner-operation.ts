import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
  composeUploadedBannerSamCandidateGroups,
  type UploadedBannerSamGenerator,
  type UploadedBannerSamOperationResult,
} from '@fabrica/banner-ai/server/uploaded-banner-sam-operation-v1';
import { materializeUploadedBannerOperationProjectV1 } from '@fabrica/banner-ai';
import { SamReplayError } from '@fabrica/banner-ai/server/uploaded-banner-sam-replay-v4';
import { materializeUploadedSourceRegionV1 } from '@fabrica/banner-ai/server/uploaded-banner-source-region-v1';
import {
  extractUploadedManualCutoutV1,
  type ManualCutoutCropV1,
} from '@fabrica/banner-ai/server/uploaded-banner-manual-cutout-v1';
import {
  createBoundedLayerPreview,
  type SamBoxPromptGeneratePort,
} from '@fabrica/banner-ai/server/sam-box-prompt-layer-extraction';

const OPERATION_TTL_MS = 5 * 60_000;
const MAX_OPERATION_BYTES = 48 * 1024 * 1024;
const MAX_PREVIEW_DOCUMENT_BYTES = 1_048_576;
const MAX_EXPORT_RESPONSE_BYTES = 2_097_152;
const operationIdPattern = /^[0-9a-f]{64}$/u;
type MixedLayerResult = {
  readonly subjectId: string;
  readonly layers: readonly {
    readonly subjectId: string;
    readonly bytes: Uint8Array;
    readonly bounds: {
      readonly xBps: number;
      readonly yBps: number;
      readonly widthBps: number;
      readonly heightBps: number;
    };
  }[];
};
type PromptedResult = Awaited<ReturnType<typeof extractUploadedManualCutoutV1>> & {
  readonly promptedId: string;
  readonly preview: Awaited<ReturnType<typeof createBoundedLayerPreview>>;
};
export interface UploadedPromptedExecutionConfig {
  readonly generator: SamBoxPromptGeneratePort;
  readonly expectedExecutionKind: 'deterministic-fake' | 'meta-sam2.1';
  readonly provenance:
    | 'Deterministic test output — NOT SAM OUTPUT'
    | 'Verified Meta SAM 2.1 cutout replay — no live call';
}

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
  readonly grouped: Map<
    string,
    Promise<Awaited<ReturnType<typeof composeUploadedBannerSamCandidateGroups>>>
  >;
  readonly resolvedGrouped: Map<
    string,
    Awaited<ReturnType<typeof composeUploadedBannerSamCandidateGroups>>
  >;
  readonly mixed: Map<string, Promise<MixedLayerResult>>;
  readonly resolvedMixed: Map<string, MixedLayerResult>;
  readonly prompted: Map<string, Promise<PromptedResult>>;
  readonly resolvedPrompted: Map<string, PromptedResult>;
  readonly promptedExecution?: UploadedPromptedExecutionConfig;
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
const groupedRetainedBytes = (operation: UploadedBannerOperation): number => {
  let total = 0;
  for (const selection of operation.resolvedGrouped.values())
    for (const group of selection.groups)
      total +=
        group.candidate.materialization.cutoutPng.byteLength + group.candidate.preview.byteSize;
  return total;
};
const combinedDerivedBytes = (operation: UploadedBannerOperation): number =>
  groupedRetainedBytes(operation) +
  [...operation.resolvedMixed.values()].reduce(
    (sum, result) =>
      sum + result.layers.reduce((bytes, layer) => bytes + layer.bytes.byteLength, 0),
    0,
  ) +
  [...operation.resolvedPrompted.values()].reduce(
    (sum, result) => sum + result.layer.bytes.byteLength + result.preview.byteSize,
    0,
  ) +
  [...operation.projectBytes.values()].reduce((sum, bytes) => sum + bytes, 0);

const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

export const materializeUploadedSourceRegion = materializeUploadedSourceRegionV1;

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
  readonly promptedExecution?: UploadedPromptedExecutionConfig;
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
    grouped: new Map(),
    resolvedGrouped: new Map(),
    mixed: new Map(),
    resolvedMixed: new Map(),
    prompted: new Map(),
    resolvedPrompted: new Map(),
    ...(input.promptedExecution === undefined
      ? {}
      : { promptedExecution: input.promptedExecution }),
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

export const promptUploadedBannerOperation = async (input: {
  readonly operationId: unknown;
  readonly crop: ManualCutoutCropV1;
  readonly authority: ActorWorkspaceContext;
}) => {
  const operation = resolve(input.operationId, input.authority);
  const promptedExecution = operation.promptedExecution;
  if (promptedExecution === undefined)
    throw new UploadedBannerOperationError(
      'AUTHORIZATION_REQUIRED',
      'Manual cutout prompting is unavailable.',
    );
  const key = JSON.stringify(input.crop);
  let pending = operation.prompted.get(key);
  if (pending === undefined) {
    if (operation.prompted.size >= 8)
      throw new UploadedBannerOperationError(
        'OPERATION_INVALID',
        'The prompted crop limit has been reached.',
      );
    pending = (async () => {
      const extracted = await extractUploadedManualCutoutV1({
        normalizedPng: operation.sourceBytes,
        crop: input.crop,
        sam: promptedExecution.generator,
        expectedExecutionKind: promptedExecution.expectedExecutionKind,
        requestId: randomUUID(),
        workspaceId: randomUUID(),
        jobId: randomUUID(),
        attemptId: randomUUID(),
      });
      const preview = await createBoundedLayerPreview(extracted.layer.bytes);
      const promptedId = `samp_v1_${digest(
        canonicalizeJson({
          source: {
            sha256: operation.source.sha256,
            width: operation.source.width,
            height: operation.source.height,
          },
          crop: extracted.crop,
          promptBounds: extracted.promptBounds,
          bounds: extracted.bounds,
          candidateId: extracted.candidate.candidateId,
          mask: extracted.candidate.mask.sha256,
          geometry: {
            bounds: extracted.candidate.bounds,
            pixelArea: extracted.candidate.pixelArea,
            areaRatioBps: extracted.candidate.areaRatioBps,
          },
          layer: extracted.layer.sha256,
        }),
      )}`;
      return { ...extracted, promptedId, preview };
    })();
    operation.prompted.set(key, pending);
    void pending.catch(() => {
      if (operation.prompted.get(key) === pending) operation.prompted.delete(key);
    });
  }
  const result = await pending;
  operation.resolvedPrompted.set(result.promptedId, result);
  if (combinedDerivedBytes(operation) > 64 * 1024 * 1024) {
    operation.resolvedPrompted.delete(result.promptedId);
    operation.prompted.delete(key);
    throw new UploadedBannerOperationError(
      'OPERATION_INVALID',
      'The prompted cutout exceeds the cumulative byte bound.',
    );
  }
  return { operation, ...result };
};

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
  readonly candidateGroups?: unknown;
  readonly layers?: unknown;
  readonly authority: ActorWorkspaceContext;
}) => {
  const operation = resolve(input.operationId, input.authority);
  if (input.layers !== undefined) {
    if (!Array.isArray(input.layers) || input.layers.length < 1 || input.layers.length > 8)
      throw new UploadedBannerOperationError('CANDIDATE_INVALID', 'Layers are invalid.');
    const usedCandidates = new Set<string>();
    const usedCrops = new Set<string>();
    const layers = input.layers.map((entry) => {
      if (entry === null || typeof entry !== 'object' || Array.isArray(entry))
        throw new UploadedBannerOperationError('CANDIDATE_INVALID', 'Layers are invalid.');
      const record = entry as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      if (record.kind === 'sam-candidate-group-v1' && keys.join(',') === 'candidateIds,kind') {
        if (!Array.isArray(record.candidateIds) || record.candidateIds.length < 1)
          throw new UploadedBannerOperationError(
            'CANDIDATE_INVALID',
            'Layer candidates are invalid.',
          );
        const ids = record.candidateIds;
        if (ids.some((id) => typeof id !== 'string' || usedCandidates.has(id)))
          throw new UploadedBannerOperationError(
            'CANDIDATE_INVALID',
            'Layer candidates are invalid.',
          );
        ids.forEach((id) => usedCandidates.add(id));
        const canonical = operation.result.candidates.filter((candidate) =>
          ids.includes(candidate.candidateId),
        );
        if (canonical.length !== ids.length)
          throw new UploadedBannerOperationError(
            'CANDIDATE_INVALID',
            'The candidate is not owned by this operation.',
          );
        return {
          kind: record.kind,
          ids: canonical.map((candidate) => candidate.candidateId),
        } as const;
      }
      if (record.kind === 'source-region-v1' && keys.join(',') === 'crop,kind') {
        const crop = record.crop;
        if (crop === null || typeof crop !== 'object' || Array.isArray(crop))
          throw new UploadedBannerOperationError(
            'CANDIDATE_INVALID',
            'The source crop is invalid.',
          );
        const c = crop as Record<string, unknown>;
        if (Object.keys(c).sort().join(',') !== 'height,left,top,width')
          throw new UploadedBannerOperationError(
            'CANDIDATE_INVALID',
            'The source crop is invalid.',
          );
        const values = [c.left, c.top, c.width, c.height];
        if (
          !values.every(Number.isSafeInteger) ||
          Number(c.left) < 0 ||
          Number(c.top) < 0 ||
          Number(c.width) < 1 ||
          Number(c.height) < 1 ||
          Number(c.left) + Number(c.width) > operation.source.width ||
          Number(c.top) + Number(c.height) > operation.source.height
        )
          throw new UploadedBannerOperationError(
            'CANDIDATE_INVALID',
            'The source crop is invalid.',
          );
        const cropValue = {
          left: Number(c.left),
          top: Number(c.top),
          width: Number(c.width),
          height: Number(c.height),
        };
        const cropKey = JSON.stringify(cropValue);
        if (usedCrops.has(cropKey))
          throw new UploadedBannerOperationError(
            'CANDIDATE_INVALID',
            'The source crop is duplicated.',
          );
        usedCrops.add(cropKey);
        return { kind: record.kind, crop: cropValue } as const;
      }
      if (
        record.kind === 'prompted-cutout-v1' &&
        keys.join(',') === 'kind,promptedId' &&
        typeof record.promptedId === 'string'
      ) {
        if (!operation.resolvedPrompted.has(record.promptedId))
          throw new UploadedBannerOperationError(
            'CANDIDATE_INVALID',
            'The prompted cutout is not owned by this operation.',
          );
        return { kind: record.kind, promptedId: record.promptedId } as const;
      }
      throw new UploadedBannerOperationError('CANDIDATE_INVALID', 'Layers are invalid.');
    });
    const key = JSON.stringify(layers);
    let mixed = operation.mixed.get(key);
    if (mixed === undefined) {
      if (operation.mixed.size >= 8)
        throw new UploadedBannerOperationError(
          'OPERATION_INVALID',
          'The operation has reached its layer limit.',
        );
      mixed = (async () => {
        const samLayers = layers.filter((layer) => layer.kind === 'sam-candidate-group-v1');
        const samResult =
          samLayers.length === 0
            ? undefined
            : await composeUploadedBannerSamCandidateGroups({
                operation: operation.result,
                candidateGroups: samLayers.map((layer) => layer.ids),
              });
        const materialized: MixedLayerResult['layers'][number][] = [];
        let samIndex = 0;
        for (const layer of layers) {
          if (layer.kind === 'source-region-v1') {
            const bytes = await materializeUploadedSourceRegionV1({
              source: operation.sourceBytes,
              crop: layer.crop,
              sourceWidth: operation.source.width,
              sourceHeight: operation.source.height,
            });
            const subjectId = `srcl_v1_${digest(canonicalizeJson({ source: { sha256: operation.source.sha256, width: operation.source.width, height: operation.source.height }, layer }))}`;
            materialized.push({
              subjectId,
              bytes,
              bounds: {
                xBps: Math.round((layer.crop.left * 10000) / operation.source.width),
                yBps: Math.round((layer.crop.top * 10000) / operation.source.height),
                widthBps: Math.round((layer.crop.width * 10000) / operation.source.width),
                heightBps: Math.round((layer.crop.height * 10000) / operation.source.height),
              },
            });
          } else if (layer.kind === 'prompted-cutout-v1') {
            const prompted = operation.resolvedPrompted.get(layer.promptedId)!;
            materialized.push({
              subjectId: prompted.promptedId,
              bytes: prompted.layer.bytes,
              bounds: prompted.bounds,
            });
          } else {
            const group = samResult!.groups[samIndex++]!;
            materialized.push({
              subjectId: group.groupId,
              bytes: group.candidate.materialization.cutoutPng,
              bounds: group.candidate.bounds,
            });
          }
        }
        return {
          subjectId: `sams_v1_${digest(
            canonicalizeJson({
              algorithm: 'uploaded-mixed-layer-selection-v1',
              source: {
                sha256: operation.source.sha256,
                width: operation.source.width,
                height: operation.source.height,
              },
              layers: materialized.map((entry, index) => ({
                kind: layers[index]!.kind,
                subjectId: entry.subjectId,
              })),
            }),
          )}`,
          layers: materialized,
        };
      })();
      operation.mixed.set(key, mixed);
      void mixed.catch(() => {
        if (operation.mixed.get(key) === mixed) operation.mixed.delete(key);
      });
    }
    const value = await mixed;
    operation.resolvedMixed.set(value.subjectId, value);
    if (combinedDerivedBytes(operation) > 64 * 1024 * 1024) {
      operation.resolvedMixed.delete(value.subjectId);
      operation.mixed.delete(key);
      throw new UploadedBannerOperationError(
        'OPERATION_INVALID',
        'The mixed layers exceed their cumulative byte bound.',
      );
    }
    return { operation, subjectId: value.subjectId, mixedLayers: value.layers };
  }
  if (input.candidateGroups !== undefined) {
    if (!Array.isArray(input.candidateGroups))
      throw new UploadedBannerOperationError('CANDIDATE_INVALID', 'Layer groups are invalid.');
    const groups = input.candidateGroups as unknown[];
    if (
      !groups.every((group) => Array.isArray(group) && group.every((id) => typeof id === 'string'))
    )
      throw new UploadedBannerOperationError('CANDIDATE_INVALID', 'Layer groups are invalid.');
    const canonicalGroups = groups.map((group) =>
      operation.result.candidates
        .filter((candidate) => (group as string[]).includes(candidate.candidateId))
        .map((candidate) => candidate.candidateId),
    );
    if (canonicalGroups.some((group, index) => group.length !== (groups[index] as string[]).length))
      throw new UploadedBannerOperationError(
        'CANDIDATE_INVALID',
        'The candidate is not owned by this operation.',
      );
    const key = JSON.stringify(canonicalGroups);
    let grouped = operation.grouped.get(key);
    if (grouped === undefined) {
      if (operation.grouped.size >= 8)
        throw new UploadedBannerOperationError(
          'OPERATION_INVALID',
          'The operation has reached its layer selection limit.',
        );
      grouped = composeUploadedBannerSamCandidateGroups({
        operation: operation.result,
        candidateGroups: canonicalGroups,
      });
      operation.grouped.set(key, grouped);
      void grouped.catch(() => {
        if (operation.grouped.get(key) === grouped) operation.grouped.delete(key);
      });
    }
    const result = await grouped;
    operation.resolvedGrouped.set(result.subjectId, result);
    if (combinedDerivedBytes(operation) > 64 * 1024 * 1024) {
      operation.resolvedGrouped.delete(result.subjectId);
      operation.grouped.delete(key);
      throw new UploadedBannerOperationError(
        'OPERATION_INVALID',
        'The grouped selection exceeds its cumulative byte bound.',
      );
    }
    return {
      operation,
      subjectId: result.subjectId,
      candidates: result.groups.map((group) => group.candidate),
      groups: result.groups,
    };
  }
  const candidateIds = input.candidateIds;
  if (
    !Array.isArray(candidateIds) ||
    candidateIds.length < 1 ||
    candidateIds.length > 8 ||
    candidateIds.some((id) => typeof id !== 'string') ||
    new Set(candidateIds).size !== candidateIds.length
  )
    throw new UploadedBannerOperationError(
      'CANDIDATE_INVALID',
      'Select one to eight unique candidates.',
    );
  const requestedIds = candidateIds as string[];
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
  let selectedGroups:
    Awaited<ReturnType<typeof composeUploadedBannerSamCandidateGroups>>['groups'] | undefined;
  let selectedMixed:
    | readonly {
        readonly subjectId: string;
        readonly bytes: Uint8Array;
        readonly bounds: {
          readonly xBps: number;
          readonly yBps: number;
          readonly widthBps: number;
          readonly heightBps: number;
        };
      }[]
    | undefined;
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
    for (const grouped of operation.resolvedGrouped.values()) {
      if (grouped.subjectId === input.candidateId) {
        selectedGroups = grouped.groups;
        candidate = grouped.groups[0]?.candidate;
        break;
      }
    }
    for (const resolved of operation.resolvedMixed.values()) {
      if (resolved.subjectId === input.candidateId) {
        selectedMixed = resolved.layers;
        candidate = operation.result.candidates[0];
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
      ...(selectedGroups !== undefined
        ? {
            subjects: selectedGroups.map((group) => ({
              subject: group.candidate.materialization.cutoutPng,
              candidateId: group.groupId,
              bounds: group.candidate.bounds,
            })),
          }
        : selectedMixed !== undefined
          ? {
              subjects: selectedMixed.map((entry) => ({
                subject: entry.bytes,
                candidateId: entry.subjectId,
                bounds: entry.bounds,
              })),
            }
          : selectedCandidates === undefined
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
  const materializedBytes = combinedDerivedBytes(operation);
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
