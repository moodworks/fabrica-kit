import {
  PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_REF_V1,
  PROVIDER_FREE_EXPORTER_REF_V1,
  PROVIDER_FREE_EXPORT_VALIDATION_LABEL_V1,
  PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_REF_V1,
  assetReferencesEqual,
  collectSceneAssetReferences,
  type AssetVersionRefV1,
  type BannerSceneV1,
  type ExporterManifestRefV1,
  type ValidatorProfileRefV1,
  type WorkflowManifestRefV1,
} from '@fabrica/banner-ai/browser';
import type { ProviderFreeBannerProjectV1 } from '@fabrica/banner-ai';

import {
  getAcceptedRevision,
  parseProviderFreeExportEnvelope,
  parseProviderFreePreviewEnvelope,
  parseProviderFreeProjectEnvelope,
  parseProviderFreeCandidateCatalogEnvelope,
  type ProviderFreeCandidateChoice,
  type ProviderFreeExportData,
  type ProviderFreePreviewData,
  type ProviderFreeProjectOpenData,
} from './banner-ai-project-contract';

export type BannerProjectFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface UploadedBannerCandidate {
  readonly candidateId: string;
  readonly order: number;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly pixelArea: number;
  readonly areaRatioBps: number;
  readonly thumbnail: {
    readonly dataUrl: string;
    readonly byteSize: number;
    readonly pixelWidth: number;
    readonly pixelHeight: number;
    readonly sha256: string;
  };
  readonly provenance:
    | 'Deterministic test output — NOT SAM OUTPUT'
    | 'Verified Meta SAM 2.1 cutout replay — no live call';
}

export interface UploadedBannerOperationData {
  readonly operationId: string;
  readonly candidates: readonly UploadedBannerCandidate[];
  readonly provenance: UploadedBannerCandidate['provenance'];
}
export interface UploadedBannerBinding {
  readonly operationId: string;
  readonly candidateId: string;
}
const uploadedBody = (binding: UploadedBannerBinding, body: Record<string, unknown>) => ({
  ...body,
  operationId: binding.operationId,
  candidateId: binding.candidateId,
});
export const openUploadedBannerCandidate = async (
  binding: UploadedBannerBinding,
  fetchImplementation: BannerProjectFetch = fetch,
): Promise<ProviderFreeProjectOpenData> => {
  const response = await fetchImplementation('/api/banner-ai/uploaded-operation', {
    method: 'PUT',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'select', ...binding }),
  });
  return resolveEnvelope(parseProviderFreeProjectEnvelope(await parseJsonResponse(response)));
};
export const saveUploadedBannerProject = async (
  binding: UploadedBannerBinding,
  input: {
    readonly project: ProviderFreeBannerProjectV1;
    readonly scene: BannerSceneV1;
    readonly selectedPartId: string;
  },
  fetchImplementation: BannerProjectFetch = fetch,
): Promise<ProviderFreeProjectOpenData> => {
  const response = await fetchImplementation('/api/banner-ai/uploaded-operation', {
    method: 'PUT',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(
      uploadedBody(binding, {
        action: 'save',
        project: input.project,
        scene: input.scene,
        selectedPartId: input.selectedPartId,
      }),
    ),
  });
  return resolveEnvelope(parseProviderFreeProjectEnvelope(await parseJsonResponse(response)));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (record: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
};

const parseUploadedThumbnail = (input: unknown): void => {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ['byteSize', 'dataUrl', 'pixelHeight', 'pixelWidth', 'sha256']) ||
    typeof input['dataUrl'] !== 'string' ||
    !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(input['dataUrl']) ||
    input['dataUrl'].length > 524_288 ||
    !Number.isSafeInteger(input['byteSize']) ||
    Number(input['byteSize']) < 1 ||
    !Number.isSafeInteger(input['pixelWidth']) ||
    Number(input['pixelWidth']) < 1 ||
    !Number.isSafeInteger(input['pixelHeight']) ||
    Number(input['pixelHeight']) < 1 ||
    typeof input['sha256'] !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(input['sha256'])
  ) {
    throw new BannerProjectRequestError(
      'INVALID_UPLOADED_OPERATION',
      'The uploaded operation response contained an invalid thumbnail.',
    );
  }
};

export const requestUploadedBannerOperation = async (
  file: File,
  fetchImplementation: BannerProjectFetch = fetch,
): Promise<UploadedBannerOperationData> => {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetchImplementation('/api/banner-ai/uploaded-operation', {
    method: 'POST',
    body: formData,
    cache: 'no-store',
    credentials: 'same-origin',
  });
  const payload = await parseJsonResponse(response);
  if (!isRecord(payload) || payload['ok'] !== true || !isRecord(payload['data'])) {
    const error =
      isRecord(payload) && isRecord(payload['error']) ? payload['error']['message'] : null;
    throw new BannerProjectRequestError(
      'UPLOADED_OPERATION_FAILED',
      typeof error === 'string' ? error : 'The uploaded operation could not be created.',
    );
  }
  return parseUploadedBannerOperationPayload(payload);
};

export const parseUploadedBannerOperationPayload = (
  payload: unknown,
): UploadedBannerOperationData => {
  if (!isRecord(payload) || payload['ok'] !== true || !isRecord(payload['data'])) {
    throw new BannerProjectRequestError(
      'UPLOADED_OPERATION_FAILED',
      'The uploaded operation could not be created.',
    );
  }
  const data = payload['data'];
  if (
    !hasExactKeys(data, ['candidates', 'operationId', 'provenance']) ||
    typeof data['operationId'] !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(data['operationId']) ||
    !Array.isArray(data['candidates']) ||
    data['candidates'].length < 1 ||
    data['candidates'].length > 8 ||
    (data['provenance'] !== 'Deterministic test output — NOT SAM OUTPUT' &&
      data['provenance'] !== 'Verified Meta SAM 2.1 cutout replay — no live call')
  ) {
    throw new BannerProjectRequestError(
      'INVALID_UPLOADED_OPERATION',
      'The uploaded operation response was invalid.',
    );
  }
  const candidates = data['candidates'].map((candidate, index) => {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, [
        'areaRatioBps',
        'bounds',
        'candidateId',
        'order',
        'pixelArea',
        'provenance',
        'thumbnail',
      ]) ||
      typeof candidate['candidateId'] !== 'string' ||
      !/^samc_v1_[0-9a-f]{64}$/u.test(candidate['candidateId']) ||
      candidate['order'] !== index + 1 ||
      candidate['provenance'] !== data['provenance'] ||
      !Number.isSafeInteger(candidate['pixelArea']) ||
      Number(candidate['pixelArea']) < 64 ||
      !Number.isSafeInteger(candidate['areaRatioBps']) ||
      Number(candidate['areaRatioBps']) < 0 ||
      Number(candidate['areaRatioBps']) > 10_000 ||
      !isRecord(candidate['bounds']) ||
      !hasExactKeys(candidate['bounds'], ['height', 'width', 'x', 'y']) ||
      Object.values(candidate['bounds']).some(
        (value) => typeof value !== 'number' || !Number.isInteger(value) || value < 0,
      ) ||
      Number(candidate['bounds']['width']) < 1 ||
      Number(candidate['bounds']['height']) < 1 ||
      Number(candidate['bounds']['x']) + Number(candidate['bounds']['width']) > 10_000 ||
      Number(candidate['bounds']['y']) + Number(candidate['bounds']['height']) > 10_000
    ) {
      throw new BannerProjectRequestError(
        'INVALID_UPLOADED_OPERATION',
        'The uploaded operation response contained an invalid candidate.',
      );
    }
    parseUploadedThumbnail(candidate['thumbnail']);
    return candidate as unknown as UploadedBannerCandidate;
  });
  if (new Set(candidates.map((candidate) => candidate.candidateId)).size !== candidates.length) {
    throw new BannerProjectRequestError(
      'INVALID_UPLOADED_OPERATION',
      'The uploaded operation response contained duplicate candidates.',
    );
  }
  return {
    operationId: data['operationId'],
    candidates,
    provenance: data['provenance'],
  };
};

export class BannerProjectRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'BannerProjectRequestError';
    this.code = code;
  }
}

const parseJsonResponse = async (response: Response): Promise<unknown> => {
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new BannerProjectRequestError(
      'INVALID_DEMO_RESPONSE',
      'The local demo returned an unreadable response. Your accepted scene is unchanged.',
    );
  }
};

const resolveEnvelope = <T>(
  envelope:
    | { readonly ok: true; readonly data: T }
    | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } },
): T => {
  if (envelope.ok) return envelope.data;
  throw new BannerProjectRequestError(envelope.error.code, envelope.error.message);
};

const postJson = async (
  fetchImplementation: BannerProjectFetch,
  path: string,
  body: unknown,
): Promise<Response> =>
  fetchImplementation(path, {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

export const requestProviderFreeProject = async (
  fetchImplementation: BannerProjectFetch = fetch,
): Promise<ProviderFreeProjectOpenData> => {
  const response = await fetchImplementation('/api/banner-ai/demo-project', {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
  });
  return resolveEnvelope(parseProviderFreeProjectEnvelope(await parseJsonResponse(response)));
};

export const requestProviderFreeCandidateCatalog = async (
  fetchImplementation: BannerProjectFetch = fetch,
): Promise<readonly ProviderFreeCandidateChoice[]> => {
  const response = await postJson(fetchImplementation, '/api/banner-ai/demo-project', {
    action: 'catalog',
  });
  return parseProviderFreeCandidateCatalogEnvelope(await parseJsonResponse(response));
};

export const openProviderFreeCandidate = async (
  candidateId: string,
  fetchImplementation: BannerProjectFetch = fetch,
): Promise<ProviderFreeProjectOpenData> => {
  const response = await postJson(fetchImplementation, '/api/banner-ai/demo-project', {
    action: 'open-candidate',
    candidateId,
  });
  return resolveEnvelope(parseProviderFreeProjectEnvelope(await parseJsonResponse(response)));
};

export const reopenProviderFreeProject = async (
  canonicalProjectJson: string,
  fetchImplementation: BannerProjectFetch = fetch,
): Promise<ProviderFreeProjectOpenData> => {
  let project: unknown;
  try {
    project = JSON.parse(canonicalProjectJson) as unknown;
  } catch {
    throw new BannerProjectRequestError(
      'PROJECT_STORAGE_CORRUPT',
      'Saved demo data is corrupt. Reset only this local demo project to continue.',
    );
  }
  const response = await postJson(fetchImplementation, '/api/banner-ai/demo-project', {
    action: 'reopen',
    project,
  });
  return resolveEnvelope(parseProviderFreeProjectEnvelope(await parseJsonResponse(response)));
};

export const saveProviderFreeProject = async (
  input: {
    readonly project: ProviderFreeBannerProjectV1;
    readonly scene: BannerSceneV1;
    readonly selectedPartId: string;
  },
  fetchImplementation: BannerProjectFetch = fetch,
): Promise<ProviderFreeProjectOpenData> => {
  const response = await postJson(fetchImplementation, '/api/banner-ai/demo-project', {
    action: 'save',
    project: input.project,
    scene: input.scene,
    selectedPartId: input.selectedPartId,
  });
  return resolveEnvelope(parseProviderFreeProjectEnvelope(await parseJsonResponse(response)));
};

export interface ProviderFreeOperationCapture {
  readonly project: ProviderFreeBannerProjectV1;
  readonly revision: number;
  readonly sceneSha256: string;
  readonly sceneVersionId: string;
}

export const captureAcceptedProviderFreeRevision = (
  project: ProviderFreeBannerProjectV1,
): ProviderFreeOperationCapture => {
  const revision = getAcceptedRevision(project);
  return Object.freeze({
    project,
    revision: revision.revision,
    sceneSha256: revision.sceneSha256,
    sceneVersionId: revision.sceneVersionId,
  });
};

export const requestProviderFreePreview = async (
  capture: ProviderFreeOperationCapture,
  nonce: string,
  fetchImplementation: BannerProjectFetch = fetch,
): Promise<ProviderFreePreviewData> => {
  const response = await postJson(fetchImplementation, '/api/banner-ai/demo-project/preview', {
    nonce,
    project: capture.project,
    revision: capture.revision,
    sceneSha256: capture.sceneSha256,
    sceneVersionId: capture.sceneVersionId,
  });
  return resolveEnvelope(parseProviderFreePreviewEnvelope(await parseJsonResponse(response)));
};
export const requestUploadedBannerPreview = async (
  binding: UploadedBannerBinding,
  capture: ProviderFreeOperationCapture,
  nonce: string,
  fetchImplementation: BannerProjectFetch = fetch,
): Promise<ProviderFreePreviewData> => {
  const response = await postJson(
    fetchImplementation,
    '/api/banner-ai/uploaded-operation/preview',
    uploadedBody(binding, {
      nonce,
      project: capture.project,
      revision: capture.revision,
      sceneSha256: capture.sceneSha256,
      sceneVersionId: capture.sceneVersionId,
    }),
  );
  return resolveEnvelope(parseProviderFreePreviewEnvelope(await parseJsonResponse(response)));
};

export type ProviderFreeAcceptedExportData = ProviderFreeExportData;

const workflowRefsEqual = (left: WorkflowManifestRefV1, right: WorkflowManifestRefV1): boolean =>
  left.workflowVersionId === right.workflowVersionId &&
  left.workflowVersion === right.workflowVersion &&
  left.definitionSha256 === right.definitionSha256;

const exporterRefsEqual = (left: ExporterManifestRefV1, right: ExporterManifestRefV1): boolean =>
  left.exporterId === right.exporterId &&
  left.exporterVersion === right.exporterVersion &&
  left.buildSha256 === right.buildSha256;

const validatorProfilesEqual = (
  left: ValidatorProfileRefV1,
  right: ValidatorProfileRefV1,
): boolean =>
  left.validatorProfileId === right.validatorProfileId &&
  left.validatorProfileVersion === right.validatorProfileVersion &&
  left.rulesSha256 === right.rulesSha256;

const distinctSceneAssets = (scene: BannerSceneV1): readonly AssetVersionRefV1[] => {
  const byVersion = new Map<string, AssetVersionRefV1>();
  for (const { reference } of collectSceneAssetReferences(scene)) {
    if (!byVersion.has(reference.assetVersionId))
      byVersion.set(reference.assetVersionId, reference);
  }
  return [...byVersion.values()].sort((left, right) =>
    left.assetVersionId < right.assetVersionId
      ? -1
      : left.assetVersionId > right.assetVersionId
        ? 1
        : 0,
  );
};

const exactArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const rejectExportIdentity = (): never => {
  throw new BannerProjectRequestError(
    'EXPORT_IDENTITY_MISMATCH',
    'The deterministic export evidence did not match the accepted scene.',
  );
};

const decodeBase64 = (encoded: string): Uint8Array => {
  try {
    const binary = atob(encoded);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    return rejectExportIdentity();
  }
};

const browserSha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', exactArrayBuffer(bytes)));
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('');
};

export const acceptProviderFreeExportForCapture = async (
  data: ProviderFreeExportData,
  capture: ProviderFreeOperationCapture,
  filenamePrefix = 'verified-meta-sam-replay',
): Promise<ProviderFreeAcceptedExportData> => {
  const revision = getAcceptedRevision(capture.project);
  if (
    revision.revision !== capture.revision ||
    revision.sceneVersionId !== capture.sceneVersionId ||
    revision.sceneSha256 !== capture.sceneSha256 ||
    data.sceneSha256 !== capture.sceneSha256 ||
    revision.scene.exportSettings.kind !== 'gdn-html5'
  ) {
    return rejectExportIdentity();
  }

  const bytes = decodeBase64(data.artifact.bytesBase64);
  const bytesSha256 = await browserSha256Hex(bytes);
  if (
    bytes.byteLength !== data.artifact.byteSize ||
    bytesSha256 !== data.artifact.sha256 ||
    data.artifact.mediaType !== 'application/zip' ||
    data.artifact.validationLabel !== PROVIDER_FREE_EXPORT_VALIDATION_LABEL_V1 ||
    data.artifact.filename !==
      `${filenamePrefix}-r${String(capture.revision)}-${data.artifact.sha256.slice(0, 12)}.zip`
  ) {
    return rejectExportIdentity();
  }

  const manifest = data.manifest;
  const expectedAssets = distinctSceneAssets(revision.scene);
  if (
    manifest.sceneVersionId !== capture.sceneVersionId ||
    manifest.sceneRevision !== capture.revision ||
    manifest.sceneSha256 !== capture.sceneSha256 ||
    !workflowRefsEqual(manifest.sceneWorkflow, revision.sceneWorkflow) ||
    !workflowRefsEqual(manifest.exportWorkflow, PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_REF_V1) ||
    !exporterRefsEqual(manifest.exporter, PROVIDER_FREE_EXPORTER_REF_V1) ||
    manifest.validator.kind !== 'profile' ||
    !validatorProfilesEqual(
      manifest.validator.profile,
      PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_REF_V1,
    ) ||
    !validatorProfilesEqual(
      revision.scene.exportSettings.validatorProfile,
      PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_REF_V1,
    ) ||
    manifest.output.mediaType !== data.artifact.mediaType ||
    manifest.output.byteSize !== bytes.byteLength ||
    manifest.output.sha256 !== bytesSha256 ||
    manifest.assetVersions.length !== expectedAssets.length ||
    !manifest.assetVersions.every((asset, index) =>
      assetReferencesEqual(asset, expectedAssets[index]!),
    )
  ) {
    return rejectExportIdentity();
  }

  const validation = data.validation;
  if (
    validation.validationLabel !== data.artifact.validationLabel ||
    validation.artifactSha256 !== bytesSha256 ||
    !validatorProfilesEqual(validation.profile, PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_REF_V1) ||
    !validatorProfilesEqual(validation.profile, manifest.validator.profile)
  ) {
    return rejectExportIdentity();
  }

  return {
    artifact: {
      byteSize: bytes.byteLength,
      bytesBase64: data.artifact.bytesBase64,
      filename: data.artifact.filename,
      mediaType: data.artifact.mediaType,
      sha256: bytesSha256,
      validationLabel: data.artifact.validationLabel,
    },
    manifest,
    sceneSha256: data.sceneSha256,
    validation,
  };
};

export const requestProviderFreeExport = async (
  capture: ProviderFreeOperationCapture,
  fetchImplementation: BannerProjectFetch = fetch,
): Promise<ProviderFreeAcceptedExportData> => {
  const response = await postJson(fetchImplementation, '/api/banner-ai/demo-project/export', {
    project: capture.project,
    revision: capture.revision,
    sceneSha256: capture.sceneSha256,
    sceneVersionId: capture.sceneVersionId,
  });
  const data = resolveEnvelope(parseProviderFreeExportEnvelope(await parseJsonResponse(response)));
  return acceptProviderFreeExportForCapture(data, capture);
};
export const requestUploadedBannerExport = async (
  binding: UploadedBannerBinding,
  capture: ProviderFreeOperationCapture,
  fetchImplementation: BannerProjectFetch = fetch,
): Promise<ProviderFreeAcceptedExportData> => {
  const response = await postJson(
    fetchImplementation,
    '/api/banner-ai/uploaded-operation/export',
    uploadedBody(binding, {
      project: capture.project,
      revision: capture.revision,
      sceneSha256: capture.sceneSha256,
      sceneVersionId: capture.sceneVersionId,
    }),
  );
  const data = resolveEnvelope(parseProviderFreeExportEnvelope(await parseJsonResponse(response)));
  const prefixes = ['uploaded-verified-meta-sam-replay', 'uploaded-deterministic-test'] as const;
  const prefix = prefixes.find((candidate) =>
    data.artifact.filename.startsWith(`${candidate}-r${String(capture.revision)}-`),
  );
  if (prefix === undefined) return rejectExportIdentity();
  return acceptProviderFreeExportForCapture(data, capture, prefix);
};
