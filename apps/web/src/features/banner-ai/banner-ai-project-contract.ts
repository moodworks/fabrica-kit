import {
  ExportReproductionManifestV1Schema,
  GdnValidationResultSchema,
  parseBannerSceneV1,
  type BannerSceneV1,
  type ExportReproductionManifestV1,
  type GdnValidationResult,
  type PreviewMessageV1,
} from '@fabrica/banner-ai/browser';
import type {
  ProviderFreeBannerProjectRevisionV1,
  ProviderFreeBannerProjectV1,
} from '@fabrica/banner-ai';

const sha256Pattern = /^[0-9a-f]{64}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const safeCodePattern = /^[A-Z][A-Z0-9_]{0,79}$/u;
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const dataPngPattern = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (record: Record<string, unknown>, expected: readonly string[]): boolean => {
  const actual = Object.keys(record).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
};

const isSafeText = (value: unknown, maximumCodePoints: number): value is string =>
  typeof value === 'string' &&
  [...value].length >= 1 &&
  [...value].length <= maximumCodePoints &&
  value.normalize('NFC') === value &&
  !/[\p{Cc}\u202A-\u202E\u2066-\u2069]/u.test(value);

const parseSafeError = (input: unknown): BannerProjectApiError => {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ['code', 'message']) ||
    typeof input['code'] !== 'string' ||
    !safeCodePattern.test(input['code']) ||
    !isSafeText(input['message'], 500)
  ) {
    throw new TypeError('The demo API returned an invalid safe error envelope.');
  }
  return { code: input['code'], message: input['message'] };
};

const parseWorkflowRef = (input: unknown): boolean =>
  isRecord(input) &&
  hasExactKeys(input, ['workflowVersionId', 'workflowVersion', 'definitionSha256']) &&
  typeof input['workflowVersionId'] === 'string' &&
  uuidPattern.test(input['workflowVersionId']) &&
  Number.isInteger(input['workflowVersion']) &&
  Number(input['workflowVersion']) >= 1 &&
  typeof input['definitionSha256'] === 'string' &&
  sha256Pattern.test(input['definitionSha256']);

const parseRevision = (
  input: unknown,
  expectedRevision: number,
): ProviderFreeBannerProjectRevisionV1 => {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, [
      'parentSceneSha256',
      'revision',
      'scene',
      'sceneSha256',
      'sceneVersionId',
      'sceneWorkflow',
    ]) ||
    input['revision'] !== expectedRevision ||
    typeof input['sceneVersionId'] !== 'string' ||
    !uuidPattern.test(input['sceneVersionId']) ||
    typeof input['sceneSha256'] !== 'string' ||
    !sha256Pattern.test(input['sceneSha256']) ||
    (expectedRevision === 1
      ? input['parentSceneSha256'] !== null
      : typeof input['parentSceneSha256'] !== 'string' ||
        !sha256Pattern.test(input['parentSceneSha256'])) ||
    !parseWorkflowRef(input['sceneWorkflow'])
  ) {
    throw new TypeError('The demo API returned an invalid scene revision.');
  }
  const scene = parseBannerSceneV1(input['scene']);
  if (!scene.success) {
    throw new TypeError('The demo API returned an invalid BannerSceneV1.');
  }
  return input as unknown as ProviderFreeBannerProjectRevisionV1;
};

export const parseProviderFreeProjectForClient = (input: unknown): ProviderFreeBannerProjectV1 => {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, [
      'currentAcceptedRevision',
      'displayName',
      'envelopeVersion',
      'fixtureId',
      'projectId',
      'revisions',
      'selectedPartId',
    ]) ||
    input['envelopeVersion'] !== 1 ||
    !isSafeText(input['fixtureId'], 64) ||
    !isSafeText(input['projectId'], 64) ||
    !isSafeText(input['displayName'], 120) ||
    !isSafeText(input['selectedPartId'], 80) ||
    !Array.isArray(input['revisions']) ||
    input['revisions'].length < 1 ||
    input['revisions'].length > 32 ||
    input['currentAcceptedRevision'] !== input['revisions'].length
  ) {
    throw new TypeError('The demo API returned an invalid project envelope.');
  }

  const revisions = input['revisions'].map((revision, index) => parseRevision(revision, index + 1));
  for (let index = 1; index < revisions.length; index += 1) {
    if (revisions[index]!.parentSceneSha256 !== revisions[index - 1]!.sceneSha256) {
      throw new TypeError('The demo API returned broken scene ancestry.');
    }
  }
  return input as unknown as ProviderFreeBannerProjectV1;
};

export interface ProviderFreeProjectPresentationPart {
  readonly partKey: string;
  readonly targetId: string;
  readonly name: string;
  readonly role: 'background' | 'decoration' | 'subject';
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly thumbnail: {
    readonly dataUrl: string;
    readonly byteSize: number;
    readonly sha256: string;
    readonly pixelWidth: number;
    readonly pixelHeight: number;
  };
}

export interface ProviderFreeProjectPresentation {
  readonly canvas: { readonly width: 300; readonly height: 200 };
  readonly fixtureLabel: string;
  readonly candidateId: string;
  readonly source: {
    readonly name: string;
    readonly asset: {
      readonly assetId: string;
      readonly assetVersionId: string;
      readonly sha256: string;
      readonly mediaType: 'image/jpeg' | 'image/png';
      readonly byteSize: number;
      readonly pixelWidth: number;
      readonly pixelHeight: number;
    };
    readonly thumbnail: ProviderFreeProjectPresentationPart['thumbnail'];
  };
  readonly parts: readonly ProviderFreeProjectPresentationPart[];
}

export interface ProviderFreeProjectOpenData {
  readonly canonicalProjectJson: string;
  readonly presentation: ProviderFreeProjectPresentation;
  readonly project: ProviderFreeBannerProjectV1;
}

export interface ProviderFreeCandidateChoice {
  readonly candidateId: string;
  readonly order: number;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly thumbnail: ProviderFreeProjectPresentationPart['thumbnail'];
  readonly asset: BannerSceneV1['layers'][number]['asset'];
}

export const parseProviderFreeCandidateCatalogEnvelope = (
  input: unknown,
): readonly ProviderFreeCandidateChoice[] => {
  if (
    !isRecord(input) ||
    input['ok'] !== true ||
    !isRecord(input['data']) ||
    !hasExactKeys(input['data'], ['candidates']) ||
    !Array.isArray(input['data']['candidates']) ||
    input['data']['candidates'].length !== 8
  )
    throw new TypeError('The demo API returned an invalid candidate catalog.');
  const candidates = input['data']['candidates'].map((candidate, index) => {
    if (
      !isRecord(candidate) ||
      !hasExactKeys(candidate, ['asset', 'bounds', 'candidateId', 'order', 'thumbnail']) ||
      typeof candidate['candidateId'] !== 'string' ||
      !/^samc_v1_[0-9a-f]{64}$/u.test(candidate['candidateId']) ||
      candidate['order'] !== index + 1 ||
      !isRecord(candidate['bounds']) ||
      !hasExactKeys(candidate['bounds'], ['height', 'width', 'x', 'y']) ||
      Object.values(candidate['bounds']).some(
        (value) => typeof value !== 'number' || !Number.isFinite(value),
      ) ||
      !isRecord(candidate['asset']) ||
      !hasExactKeys(candidate['asset'], [
        'assetId',
        'assetVersionId',
        'byteSize',
        'mediaType',
        'pixelHeight',
        'pixelWidth',
        'sha256',
      ]) ||
      candidate['asset']['mediaType'] !== 'image/png' ||
      typeof candidate['asset']['sha256'] !== 'string' ||
      !sha256Pattern.test(candidate['asset']['sha256'])
    )
      throw new TypeError('The demo API returned an invalid candidate choice.');
    parseThumbnail(candidate['thumbnail']);
    return candidate as unknown as ProviderFreeCandidateChoice;
  });
  if (new Set(candidates.map((candidate) => candidate.candidateId)).size !== 8)
    throw new TypeError('The demo API returned duplicate candidates.');
  return candidates;
};

export interface BannerProjectApiError {
  readonly code: string;
  readonly message: string;
}

export type BannerProjectApiEnvelope<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: BannerProjectApiError };

const parseThumbnail = (input: unknown): ProviderFreeProjectPresentationPart['thumbnail'] => {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ['byteSize', 'dataUrl', 'pixelHeight', 'pixelWidth', 'sha256']) ||
    typeof input['dataUrl'] !== 'string' ||
    input['dataUrl'].length > 524_288 ||
    !dataPngPattern.test(input['dataUrl']) ||
    !Number.isInteger(input['byteSize']) ||
    Number(input['byteSize']) < 1 ||
    typeof input['sha256'] !== 'string' ||
    !sha256Pattern.test(input['sha256']) ||
    !Number.isInteger(input['pixelWidth']) ||
    Number(input['pixelWidth']) < 1 ||
    !Number.isInteger(input['pixelHeight']) ||
    Number(input['pixelHeight']) < 1
  ) {
    throw new TypeError('The demo API returned an invalid local thumbnail.');
  }
  return input as unknown as ProviderFreeProjectPresentationPart['thumbnail'];
};

const parsePresentation = (
  input: unknown,
  scene: BannerSceneV1,
): ProviderFreeProjectPresentation => {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, ['candidateId', 'canvas', 'fixtureLabel', 'parts', 'source']) ||
    !isRecord(input['canvas']) ||
    !hasExactKeys(input['canvas'], ['height', 'width']) ||
    input['canvas']['width'] !== 300 ||
    input['canvas']['height'] !== 200 ||
    !isSafeText(input['fixtureLabel'], 120) ||
    typeof input['candidateId'] !== 'string' ||
    !/^samc_v1_[0-9a-f]{64}$/u.test(input['candidateId']) ||
    !Array.isArray(input['parts']) ||
    input['parts'].length !== 2
  ) {
    throw new TypeError('The demo API returned an invalid project presentation.');
  }
  const source = input['source'];
  if (
    !isRecord(source) ||
    !hasExactKeys(source, ['asset', 'name', 'thumbnail']) ||
    !isSafeText(source['name'], 80) ||
    !isRecord(source['asset']) ||
    !hasExactKeys(source['asset'], [
      'assetId',
      'assetVersionId',
      'byteSize',
      'mediaType',
      'pixelHeight',
      'pixelWidth',
      'sha256',
    ]) ||
    !isSafeText(source['asset']['assetId'], 120) ||
    !isSafeText(source['asset']['assetVersionId'], 120) ||
    source['asset']['mediaType'] !== 'image/png' ||
    typeof source['asset']['sha256'] !== 'string' ||
    !sha256Pattern.test(source['asset']['sha256']) ||
    !Number.isInteger(source['asset']['byteSize']) ||
    Number(source['asset']['byteSize']) < 1 ||
    !Number.isInteger(source['asset']['pixelWidth']) ||
    Number(source['asset']['pixelWidth']) < 1 ||
    !Number.isInteger(source['asset']['pixelHeight']) ||
    Number(source['asset']['pixelHeight']) < 1 ||
    JSON.stringify(source['asset']) !== JSON.stringify(scene.sourceAsset)
  )
    throw new TypeError('The demo API returned an invalid source reference.');
  parseThumbnail(source['thumbnail']);
  for (const part of input['parts']) {
    if (
      !isRecord(part) ||
      !hasExactKeys(part, ['bounds', 'name', 'partKey', 'role', 'targetId', 'thumbnail']) ||
      !isSafeText(part['partKey'], 80) ||
      !isSafeText(part['targetId'], 80) ||
      !isSafeText(part['name'], 80) ||
      !['background', 'decoration', 'subject'].includes(String(part['role'])) ||
      !isRecord(part['bounds']) ||
      !hasExactKeys(part['bounds'], ['height', 'width', 'x', 'y']) ||
      typeof part['bounds']['x'] !== 'number' ||
      !Number.isFinite(part['bounds']['x']) ||
      typeof part['bounds']['y'] !== 'number' ||
      !Number.isFinite(part['bounds']['y']) ||
      typeof part['bounds']['width'] !== 'number' ||
      !Number.isFinite(part['bounds']['width']) ||
      typeof part['bounds']['height'] !== 'number' ||
      !Number.isFinite(part['bounds']['height'])
    ) {
      throw new TypeError('The demo API returned invalid presentation part metadata.');
    }
    parseThumbnail(part['thumbnail']);
  }
  return input as unknown as ProviderFreeProjectPresentation;
};

export const parseProviderFreeProjectEnvelope = (
  input: unknown,
): BannerProjectApiEnvelope<ProviderFreeProjectOpenData> => {
  if (!isRecord(input) || typeof input['ok'] !== 'boolean') {
    throw new TypeError('The demo API returned an invalid envelope.');
  }
  if (input['ok'] === false) {
    if (!hasExactKeys(input, ['error', 'ok'])) {
      throw new TypeError('The demo API returned an invalid failure envelope.');
    }
    return { ok: false, error: parseSafeError(input['error']) };
  }
  if (!hasExactKeys(input, ['data', 'ok']) || !isRecord(input['data'])) {
    throw new TypeError('The demo API returned an invalid success envelope.');
  }
  const data = input['data'];
  if (
    !hasExactKeys(data, ['canonicalProjectJson', 'presentation', 'project']) ||
    typeof data['canonicalProjectJson'] !== 'string' ||
    data['canonicalProjectJson'].length < 1 ||
    data['canonicalProjectJson'].length > 1_048_576
  ) {
    throw new TypeError('The demo API returned an invalid project payload.');
  }
  const project = parseProviderFreeProjectForClient(data['project']);
  const scene = getAcceptedRevision(project).scene;
  return {
    ok: true,
    data: {
      canonicalProjectJson: data['canonicalProjectJson'],
      presentation: parsePresentation(data['presentation'], scene),
      project,
    },
  };
};

export interface ProviderFreePreviewData {
  readonly contentBase64: string;
  readonly mediaType: 'text/html';
  readonly byteSize: number;
  readonly nonce: string;
  readonly sceneSha256: string;
}

export const parseProviderFreePreviewEnvelope = (
  input: unknown,
): BannerProjectApiEnvelope<ProviderFreePreviewData> => {
  if (!isRecord(input) || typeof input['ok'] !== 'boolean') {
    throw new TypeError('The preview API returned an invalid envelope.');
  }
  if (input['ok'] === false) {
    return { ok: false, error: parseSafeError(input['error']) };
  }
  const data = input['data'];
  if (
    !isRecord(data) ||
    !hasExactKeys(data, ['byteSize', 'contentBase64', 'mediaType', 'nonce', 'sceneSha256']) ||
    data['mediaType'] !== 'text/html' ||
    !Number.isInteger(data['byteSize']) ||
    Number(data['byteSize']) < 1 ||
    typeof data['contentBase64'] !== 'string' ||
    data['contentBase64'].length < 1 ||
    data['contentBase64'].length > 1_398_104 ||
    !base64Pattern.test(data['contentBase64']) ||
    typeof data['nonce'] !== 'string' ||
    !/^[0-9a-f]{32}$/u.test(data['nonce']) ||
    typeof data['sceneSha256'] !== 'string' ||
    !sha256Pattern.test(data['sceneSha256'])
  ) {
    throw new TypeError('The preview API returned an invalid payload.');
  }
  return { ok: true, data: data as unknown as ProviderFreePreviewData };
};

export interface ProviderFreeExportData {
  readonly artifact: {
    readonly bytesBase64: string;
    readonly byteSize: number;
    readonly filename: string;
    readonly mediaType: 'application/zip';
    readonly sha256: string;
    readonly validationLabel: 'internal-provider-free-not-gdn';
  };
  readonly manifest: ExportReproductionManifestV1;
  readonly sceneSha256: string;
  readonly validation: GdnValidationResult;
}

export const parseProviderFreeExportEnvelope = (
  input: unknown,
): BannerProjectApiEnvelope<ProviderFreeExportData> => {
  if (!isRecord(input) || typeof input['ok'] !== 'boolean') {
    throw new TypeError('The export API returned an invalid envelope.');
  }
  if (input['ok'] === false) {
    if (!hasExactKeys(input, ['error', 'ok'])) {
      throw new TypeError('The export API returned an invalid failure envelope.');
    }
    return { ok: false, error: parseSafeError(input['error']) };
  }
  if (!hasExactKeys(input, ['data', 'ok'])) {
    throw new TypeError('The export API returned an invalid success envelope.');
  }
  const data = input['data'];
  if (
    !isRecord(data) ||
    !hasExactKeys(data, ['artifact', 'manifest', 'sceneSha256', 'validation']) ||
    !isRecord(data['artifact']) ||
    !hasExactKeys(data['artifact'], [
      'byteSize',
      'bytesBase64',
      'filename',
      'mediaType',
      'sha256',
      'validationLabel',
    ]) ||
    data['artifact']['mediaType'] !== 'application/zip' ||
    data['artifact']['validationLabel'] !== 'internal-provider-free-not-gdn' ||
    !Number.isInteger(data['artifact']['byteSize']) ||
    Number(data['artifact']['byteSize']) < 1 ||
    typeof data['artifact']['bytesBase64'] !== 'string' ||
    data['artifact']['bytesBase64'].length < 1 ||
    data['artifact']['bytesBase64'].length > 2_097_152 ||
    !base64Pattern.test(data['artifact']['bytesBase64']) ||
    !isSafeText(data['artifact']['filename'], 120) ||
    !String(data['artifact']['filename']).endsWith('.zip') ||
    typeof data['artifact']['sha256'] !== 'string' ||
    !sha256Pattern.test(data['artifact']['sha256']) ||
    typeof data['sceneSha256'] !== 'string' ||
    !sha256Pattern.test(data['sceneSha256'])
  ) {
    throw new TypeError('The export API returned an invalid payload.');
  }
  const manifest = ExportReproductionManifestV1Schema.safeParse(data['manifest']);
  const validation = GdnValidationResultSchema.safeParse(data['validation']);
  if (!manifest.success || !validation.success) {
    throw new TypeError('The export API returned invalid manifest or validation evidence.');
  }
  return {
    ok: true,
    data: {
      artifact: {
        byteSize: Number(data['artifact']['byteSize']),
        bytesBase64: data['artifact']['bytesBase64'],
        filename: data['artifact']['filename'],
        mediaType: data['artifact']['mediaType'],
        sha256: data['artifact']['sha256'],
        validationLabel: data['artifact']['validationLabel'],
      },
      manifest: manifest.data,
      sceneSha256: data['sceneSha256'],
      validation: validation.data,
    },
  };
};

export const getAcceptedRevision = (
  project: ProviderFreeBannerProjectV1,
): ProviderFreeBannerProjectRevisionV1 => {
  const revision = project.revisions[project.currentAcceptedRevision - 1];
  if (revision === undefined || revision.revision !== project.currentAcceptedRevision) {
    throw new TypeError('The current accepted revision is unavailable.');
  }
  return revision;
};

export const previewMessageStatus = (
  message: PreviewMessageV1,
): 'ready' | 'running' | 'completed' | 'failed' | 'exit' => {
  switch (message.type) {
    case 'ready':
      return 'ready';
    case 'progress':
      return message.progressBps === 10_000 ? 'completed' : 'running';
    case 'error':
      return 'failed';
    case 'exit':
      return 'exit';
  }
};

export const cloneDraftScene = (scene: BannerSceneV1): BannerSceneV1 => structuredClone(scene);
