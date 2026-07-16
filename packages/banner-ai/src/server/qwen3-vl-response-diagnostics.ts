import { constants as fsConstants } from 'node:fs';
import { lstat, open, realpath, unlink, type FileHandle } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import {
  QWEN3_VL_PROVIDER_KEY,
  QWEN3_VL_REQUESTED_MODEL_ID,
} from '../evaluation/qwen3-vl-candidate-evidence.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import { createCanonicalQwenBenchmarkRequestV1 } from './qwen-four-fixture-request-catalog.js';
import {
  QwenResponseBoundaryFailure,
  QwenValidationDiagnosticV1Schema,
  compareQwenDiagnosticCodeUnits,
  pseudonymizeQwenDiagnosticFieldNameV1,
  validateQwenProviderResponseBoundaryV1,
  type QwenBoundaryTransportResponse,
} from './qwen3-vl-response-boundary.js';

const MAX_DIAGNOSTIC_ARTIFACT_BYTES = 2_500_000;
const MAX_PROVIDER_RESPONSE_CAPTURE_INPUT_BYTES = 16_000_000;
const MAX_CAPTURED_UNKNOWN_FIELD_COUNT = 8_192;
const MAX_PRIMARY_UNKNOWN_FIELDS = 256;
const MAX_RETAINED_OVERFLOW_FIELDS_PER_PARENT = 64;
const MAX_UNKNOWN_FIELD_OVERFLOW_GROUPS = 512;
const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const bannerPersonSourceAssetSha256 =
  createCanonicalQwenBenchmarkRequestV1('banner-person-v1').input.sourceAsset.sha256;
const foreignSourceAssetSha256Sentinels = Object.freeze(
  ['0'.repeat(64), '1'.repeat(64), '2'.repeat(64)].filter(
    (candidate) => candidate !== bannerPersonSourceAssetSha256,
  ),
);

export const QwenDiagnosticResponseRelativePathV1Schema = z
  .string()
  .regex(
    /^\.local-data\/banner-ai\/qwen-response-diagnostic-[A-Za-z0-9][A-Za-z0-9_.-]{7,120}\.json$/u,
  );

export const QwenDiagnosticReportRelativePathV1Schema = z
  .string()
  .regex(
    /^\.local-data\/banner-ai\/qwen-response-diagnostic-report-[A-Za-z0-9][A-Za-z0-9_.-]{7,120}\.json$/u,
  );

const PackageDiagnosticFixtureRelativePathV1Schema = z
  .string()
  .regex(
    /^packages\/banner-ai\/test\/fixtures\/qwen-response-diagnostics\/[A-Za-z0-9][A-Za-z0-9_.-]{1,120}\.json$/u,
  );

const CapturedValueTypeV1Schema = z.enum([
  'undefined',
  'null',
  'boolean',
  'number',
  'string',
  'array',
  'object',
]);

const QwenCapturedUnknownFieldV1Schema = z
  .strictObject({
    scope: z.enum(['provider-envelope', 'assistant-json']),
    parentPath: z.string().regex(/^(?:|\/(?:[^\u0000-\u001F]*))$/u),
    name: z.string().min(1).max(96),
    receivedType: CapturedValueTypeV1Schema,
  })
  .readonly();

const QwenCapturedUnknownFieldOverflowV1Schema = z
  .strictObject({
    scope: z.enum(['provider-envelope', 'assistant-json']),
    parentPath: z.string().regex(/^(?:|\/(?:[^\u0000-\u001F]*))$/u),
    retainedFields: z
      .array(QwenCapturedUnknownFieldV1Schema)
      .max(MAX_RETAINED_OVERFLOW_FIELDS_PER_PARENT)
      .readonly(),
    actualFieldCount: z.int().min(1).max(MAX_CAPTURED_UNKNOWN_FIELD_COUNT),
    retainedFieldCount: z.int().min(0).max(MAX_RETAINED_OVERFLOW_FIELDS_PER_PARENT),
    generatedFieldCount: z.int().min(0).max(MAX_CAPTURED_UNKNOWN_FIELD_COUNT),
  })
  .superRefine((overflow, context) => {
    if (
      overflow.retainedFields.some((field) => field.parentPath !== overflow.parentPath) ||
      overflow.retainedFields.some((field) => field.scope !== overflow.scope) ||
      overflow.retainedFieldCount !== overflow.retainedFields.length ||
      overflow.actualFieldCount !== overflow.retainedFieldCount + overflow.generatedFieldCount
    ) {
      context.addIssue({ code: 'custom', message: 'Unknown-field overflow metadata drifted.' });
    }
  })
  .readonly();

const QwenCapturedBodyProjectionV1Schema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('malformed-json'),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('json-projection'),
      canonicalBodyProjection: z.string().min(1).max(MAX_DIAGNOSTIC_ARTIFACT_BYTES),
      unknownFields: z
        .array(QwenCapturedUnknownFieldV1Schema)
        .max(MAX_PRIMARY_UNKNOWN_FIELDS)
        .readonly(),
      actualUnknownFieldCount: z.int().min(0).max(MAX_CAPTURED_UNKNOWN_FIELD_COUNT),
      retainedUnknownFieldCount: z.int().min(0).max(MAX_CAPTURED_UNKNOWN_FIELD_COUNT),
      truncatedUnknownFieldCount: z.int().min(0).max(MAX_CAPTURED_UNKNOWN_FIELD_COUNT),
      unknownFieldOverflow: z
        .array(QwenCapturedUnknownFieldOverflowV1Schema)
        .max(MAX_UNKNOWN_FIELD_OVERFLOW_GROUPS)
        .readonly(),
    })
    .superRefine((body, context) => {
      if (
        body.retainedUnknownFieldCount !==
          body.unknownFields.length +
            body.unknownFieldOverflow.reduce(
              (total, overflow) => total + overflow.retainedFieldCount,
              0,
            ) ||
        body.actualUnknownFieldCount !==
          body.retainedUnknownFieldCount + body.truncatedUnknownFieldCount ||
        body.unknownFieldOverflow.reduce(
          (total, overflow) => total + overflow.generatedFieldCount,
          0,
        ) !== body.truncatedUnknownFieldCount ||
        body.unknownFields.length +
          body.unknownFieldOverflow.reduce(
            (total, overflow) => total + overflow.actualFieldCount,
            0,
          ) !==
          body.actualUnknownFieldCount
      ) {
        context.addIssue({ code: 'custom', message: 'Projected unknown-field counts drifted.' });
      }
    })
    .readonly(),
]);

const QwenCapturedExpectedOutcomeV1Schema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('replay-valid'),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('rejected'),
      failureReason: z.enum([
        'http-error',
        'identity-mismatch',
        'malformed-json',
        'missing-usage',
        'provider-error',
        'schema-invalid',
        'unexpected-finish',
        'unexpected-model',
      ]),
      diagnostic: QwenValidationDiagnosticV1Schema,
    })
    .readonly(),
]);

export const QwenSanitizedResponseCapturePayloadV1Schema = z
  .strictObject({
    captureVersion: z.literal(1),
    artifactKind: z.literal('qwen-sanitized-provider-response-capture'),
    fixtureId: z.literal('banner-person-v1'),
    providerKey: z.literal(QWEN3_VL_PROVIDER_KEY),
    requestedModelId: z.literal(QWEN3_VL_REQUESTED_MODEL_ID),
    capturedAtMs: z.int().min(0),
    response: z
      .strictObject({
        status: z.int().min(0).max(999),
        body: QwenCapturedBodyProjectionV1Schema,
      })
      .readonly(),
    expectedOutcome: QwenCapturedExpectedOutcomeV1Schema,
    providerCallCount: z.literal(1),
    retryCount: z.literal(0),
    productionAdmissionAuthority: z.literal(false),
    humanOracleModified: z.literal(false),
  })
  .readonly();

export const QwenSanitizedResponseCaptureArtifactV1Schema = z
  .strictObject({
    artifactVersion: z.literal(1),
    payload: QwenSanitizedResponseCapturePayloadV1Schema,
    canonicalPayloadSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .superRefine((artifact, context) => {
    if (
      artifact.canonicalPayloadSha256 !==
      sha256Hex(Buffer.from(canonicalizeJson(artifact.payload), 'utf8'))
    ) {
      context.addIssue({ code: 'custom', message: 'Diagnostic artifact payload digest drifted.' });
    }
  })
  .readonly();

export type QwenSanitizedResponseCaptureArtifactV1 = z.infer<
  typeof QwenSanitizedResponseCaptureArtifactV1Schema
>;

export const QwenDiagnosticArtifactMetadataV1Schema = z
  .strictObject({
    relativePath: QwenDiagnosticResponseRelativePathV1Schema,
    rawFileSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    mode: z.literal('0600'),
  })
  .readonly();

export type QwenDiagnosticArtifactMetadataV1 = z.infer<
  typeof QwenDiagnosticArtifactMetadataV1Schema
>;

export class QwenDiagnosticCaptureError extends Error {
  readonly reason:
    | 'forbidden-response-material'
    | 'unsafe-path'
    | 'artifact-reservation-failed'
    | 'artifact-write-failed';

  constructor(reason: QwenDiagnosticCaptureError['reason']) {
    super('Qwen diagnostic capture failed closed.');
    this.name = 'QwenDiagnosticCaptureError';
    this.reason = reason;
  }
}

export interface QwenDiagnosticReservationSetV1 {
  readonly reservationVersion: 1;
  readonly responseArtifactRelativePath: z.infer<typeof QwenDiagnosticResponseRelativePathV1Schema>;
  readonly diagnosticReportRelativePath: z.infer<typeof QwenDiagnosticReportRelativePathV1Schema>;
}

interface ReservedFileState {
  readonly relativePath: string;
  readonly absolutePath: string;
  readonly handle: FileHandle;
  readonly dev: number;
  readonly ino: number;
  readonly parentChain: DiagnosticParentChainState;
  finalized: boolean;
  closed: boolean;
}

interface ReservationState {
  readonly parentChain: DiagnosticParentChainState;
  readonly response: ReservedFileState;
  readonly report: ReservedFileState;
}

const reservationStates = new WeakMap<object, ReservationState>();

const stableFileIdentity = (
  left: { readonly dev: number; readonly ino: number },
  right: {
    readonly dev: number;
    readonly ino: number;
  },
): boolean => left.dev === right.dev && left.ino === right.ino;

interface DiagnosticParentComponentIdentity {
  readonly absolutePath: string;
  readonly canonicalPath: string;
  readonly dev: number;
  readonly ino: number;
}

interface DiagnosticParentChainState {
  readonly rootPath: string;
  readonly canonicalRoot: string;
  readonly components: readonly DiagnosticParentComponentIdentity[];
  readonly canonicalParent: string;
}

const captureDiagnosticParentComponent = async (
  absolutePath: string,
  expectedCanonicalPath: string,
): Promise<DiagnosticParentComponentIdentity> => {
  const before = await lstat(absolutePath);
  const canonicalBefore = await realpath(absolutePath);
  const after = await lstat(absolutePath);
  const canonicalAfter = await realpath(absolutePath);
  if (
    !before.isDirectory() ||
    !after.isDirectory() ||
    before.isSymbolicLink() ||
    after.isSymbolicLink() ||
    !stableFileIdentity(before, after) ||
    canonicalBefore !== expectedCanonicalPath ||
    canonicalAfter !== expectedCanonicalPath
  ) {
    throw new QwenDiagnosticCaptureError('unsafe-path');
  }
  return Object.freeze({
    absolutePath,
    canonicalPath: expectedCanonicalPath,
    dev: after.dev,
    ino: after.ino,
  });
};

const captureDiagnosticParentChain = async (
  rootPathInput: string,
): Promise<DiagnosticParentChainState> => {
  try {
    const rootPath = resolve(rootPathInput);
    const canonicalRoot = await realpath(rootPath);
    const localDataPath = resolve(rootPath, '.local-data');
    const parentPath = resolve(localDataPath, 'banner-ai');
    const expectedCanonicalPaths = [
      canonicalRoot,
      resolve(canonicalRoot, '.local-data'),
      resolve(canonicalRoot, '.local-data/banner-ai'),
    ] as const;
    const absolutePaths = [rootPath, localDataPath, parentPath] as const;
    const components: DiagnosticParentComponentIdentity[] = [];
    for (const [index, absolutePath] of absolutePaths.entries()) {
      components.push(
        await captureDiagnosticParentComponent(absolutePath, expectedCanonicalPaths[index]!),
      );
    }
    return Object.freeze({
      rootPath,
      canonicalRoot,
      components: Object.freeze(components),
      canonicalParent: expectedCanonicalPaths[2],
    });
  } catch (error) {
    if (error instanceof QwenDiagnosticCaptureError) throw error;
    throw new QwenDiagnosticCaptureError('unsafe-path');
  }
};

const verifyDiagnosticParentChain = async (
  chain: DiagnosticParentChainState,
  failureReason: 'unsafe-path' | 'artifact-reservation-failed' | 'artifact-write-failed',
): Promise<void> => {
  try {
    if ((await realpath(chain.rootPath)) !== chain.canonicalRoot) {
      throw new QwenDiagnosticCaptureError(failureReason);
    }
    for (const component of chain.components) {
      const before = await lstat(component.absolutePath);
      const canonicalBefore = await realpath(component.absolutePath);
      const after = await lstat(component.absolutePath);
      const canonicalAfter = await realpath(component.absolutePath);
      if (
        !before.isDirectory() ||
        !after.isDirectory() ||
        before.isSymbolicLink() ||
        after.isSymbolicLink() ||
        !stableFileIdentity(before, component) ||
        !stableFileIdentity(after, component) ||
        !stableFileIdentity(before, after) ||
        canonicalBefore !== component.canonicalPath ||
        canonicalAfter !== component.canonicalPath
      ) {
        throw new QwenDiagnosticCaptureError(failureReason);
      }
    }
    if (
      chain.components[2]?.canonicalPath !== chain.canonicalParent ||
      chain.canonicalParent !== resolve(chain.canonicalRoot, '.local-data/banner-ai')
    ) {
      throw new QwenDiagnosticCaptureError(failureReason);
    }
  } catch (error) {
    if (error instanceof QwenDiagnosticCaptureError) throw error;
    throw new QwenDiagnosticCaptureError(failureReason);
  }
};

export interface QwenDiagnosticParentChainGuardV1 {
  readonly guardVersion: 1;
}

const parentChainGuardStates = new WeakMap<object, DiagnosticParentChainState>();

/** Read-only probe used by isolated filesystem tests; production reservations stay repo-bound. */
export const createQwenDiagnosticParentChainGuardV1 = async (
  rootPathInput: unknown,
): Promise<QwenDiagnosticParentChainGuardV1> => {
  const supplied = z.string().min(1).max(4_096).parse(rootPathInput);
  if (!isAbsolute(supplied)) throw new QwenDiagnosticCaptureError('unsafe-path');
  const chain = await captureDiagnosticParentChain(supplied);
  const guard = Object.freeze({ guardVersion: 1 as const });
  parentChainGuardStates.set(guard, chain);
  return guard;
};

export const verifyQwenDiagnosticParentChainGuardV1 = async (
  guard: QwenDiagnosticParentChainGuardV1,
): Promise<void> => {
  const chain = parentChainGuardStates.get(guard);
  if (chain === undefined) throw new QwenDiagnosticCaptureError('unsafe-path');
  await verifyDiagnosticParentChain(chain, 'unsafe-path');
};

const verifyReservedFile = async (
  file: ReservedFileState,
  expectedSize?: number,
): Promise<void> => {
  try {
    await verifyDiagnosticParentChain(file.parentChain, 'artifact-write-failed');
    const [handleInfo, pathInfo] = await Promise.all([
      file.handle.stat(),
      lstat(file.absolutePath),
    ]);
    if (
      !handleInfo.isFile() ||
      !pathInfo.isFile() ||
      pathInfo.isSymbolicLink() ||
      handleInfo.nlink !== 1 ||
      pathInfo.nlink !== 1 ||
      (handleInfo.mode & 0o777) !== 0o600 ||
      (pathInfo.mode & 0o777) !== 0o600 ||
      !stableFileIdentity(handleInfo, file) ||
      !stableFileIdentity(pathInfo, file) ||
      (expectedSize !== undefined &&
        (handleInfo.size !== expectedSize || pathInfo.size !== expectedSize))
    ) {
      throw new QwenDiagnosticCaptureError('artifact-write-failed');
    }
    await verifyDiagnosticParentChain(file.parentChain, 'artifact-write-failed');
  } catch (error) {
    if (error instanceof QwenDiagnosticCaptureError) throw error;
    throw new QwenDiagnosticCaptureError('artifact-write-failed');
  }
};

const removeReservedFile = async (file: ReservedFileState): Promise<void> => {
  if (!file.closed) {
    await file.handle.close().catch(() => undefined);
    file.closed = true;
  }
  if (file.finalized) return;
  try {
    await verifyDiagnosticParentChain(file.parentChain, 'artifact-write-failed');
    const pathInfo = await lstat(file.absolutePath);
    if (stableFileIdentity(pathInfo, file) && !pathInfo.isSymbolicLink()) {
      await unlink(file.absolutePath);
    }
  } catch {
    // The reservation is already absent or foreign; never follow or remove a replacement.
  }
};

const reserveFile = async (input: {
  readonly relativePath: string;
  readonly parentChain: DiagnosticParentChainState;
}): Promise<ReservedFileState> => {
  const absolutePath = resolve(input.parentChain.rootPath, input.relativePath);
  if (!absolutePath.startsWith(`${input.parentChain.canonicalParent}${sep}`)) {
    throw new QwenDiagnosticCaptureError('unsafe-path');
  }
  let handle: FileHandle | undefined;
  let reservation: ReservedFileState | undefined;
  try {
    await verifyDiagnosticParentChain(input.parentChain, 'artifact-reservation-failed');
    handle = await open(
      absolutePath,
      fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_RDWR | fsConstants.O_NOFOLLOW,
      0o600,
    );
    const info = await handle.stat();
    reservation = {
      relativePath: input.relativePath,
      absolutePath,
      handle,
      dev: info.dev,
      ino: info.ino,
      parentChain: input.parentChain,
      finalized: false,
      closed: false,
    };
    if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600) {
      throw new QwenDiagnosticCaptureError('artifact-reservation-failed');
    }
    await verifyReservedFile(reservation, 0);
    return reservation;
  } catch (error) {
    if (reservation !== undefined) await removeReservedFile(reservation);
    else await handle?.close().catch(() => undefined);
    if (error instanceof QwenDiagnosticCaptureError) throw error;
    throw new QwenDiagnosticCaptureError('artifact-reservation-failed');
  }
};

export const reserveQwenDiagnosticArtifactFilesV1 = async (input: {
  readonly responseArtifactRelativePath: unknown;
  readonly diagnosticReportRelativePath: unknown;
}): Promise<QwenDiagnosticReservationSetV1> => {
  const responseArtifactRelativePath = QwenDiagnosticResponseRelativePathV1Schema.parse(
    input.responseArtifactRelativePath,
  );
  const diagnosticReportRelativePath = QwenDiagnosticReportRelativePathV1Schema.parse(
    input.diagnosticReportRelativePath,
  );
  const parentChain = await captureDiagnosticParentChain(repositoryRoot);
  await verifyDiagnosticParentChain(parentChain, 'artifact-reservation-failed');
  const response = await reserveFile({
    relativePath: responseArtifactRelativePath,
    parentChain,
  });
  let report: ReservedFileState | undefined;
  try {
    report = await reserveFile({ relativePath: diagnosticReportRelativePath, parentChain });
    const reservations = Object.freeze({
      reservationVersion: 1 as const,
      responseArtifactRelativePath,
      diagnosticReportRelativePath,
    });
    reservationStates.set(reservations, { parentChain, response, report });
    return reservations;
  } catch (error) {
    await removeReservedFile(response);
    if (report !== undefined) await removeReservedFile(report);
    throw error;
  }
};

const requireReservationState = (input: unknown): ReservationState => {
  if (typeof input !== 'object' || input === null) {
    throw new QwenDiagnosticCaptureError('artifact-reservation-failed');
  }
  const state = reservationStates.get(input);
  if (state === undefined) throw new QwenDiagnosticCaptureError('artifact-reservation-failed');
  return state;
};

const finalizeReservedFile = async (file: ReservedFileState, bytes: Uint8Array): Promise<void> => {
  if (file.finalized || file.closed) {
    throw new QwenDiagnosticCaptureError('artifact-write-failed');
  }
  try {
    await verifyDiagnosticParentChain(file.parentChain, 'artifact-write-failed');
    await verifyReservedFile(file, 0);
    await file.handle.writeFile(bytes);
    await file.handle.sync();
    await verifyReservedFile(file, bytes.byteLength);
    await verifyDiagnosticParentChain(file.parentChain, 'artifact-write-failed');
    await file.handle.close();
    file.closed = true;
    await verifyDiagnosticParentChain(file.parentChain, 'artifact-write-failed');
    file.finalized = true;
  } catch (error) {
    if (error instanceof QwenDiagnosticCaptureError) throw error;
    throw new QwenDiagnosticCaptureError('artifact-write-failed');
  }
};

export const finalizeReservedQwenDiagnosticReportV1 = async (input: {
  readonly reservations: QwenDiagnosticReservationSetV1;
  readonly bytes: Uint8Array;
}): Promise<void> => {
  if (input.bytes.byteLength < 2 || input.bytes.byteLength > MAX_DIAGNOSTIC_ARTIFACT_BYTES) {
    throw new QwenDiagnosticCaptureError('artifact-write-failed');
  }
  const state = requireReservationState(input.reservations);
  await finalizeReservedFile(state.report, input.bytes);
};

export const verifyQwenDiagnosticArtifactReservationsV1 = async (
  reservations: QwenDiagnosticReservationSetV1,
): Promise<void> => {
  const state = requireReservationState(reservations);
  if (state.response.finalized || state.report.finalized) {
    throw new QwenDiagnosticCaptureError('artifact-reservation-failed');
  }
  await verifyDiagnosticParentChain(state.parentChain, 'artifact-reservation-failed');
  await Promise.all([verifyReservedFile(state.response, 0), verifyReservedFile(state.report, 0)]);
  await verifyDiagnosticParentChain(state.parentChain, 'artifact-reservation-failed');
};

export const abortQwenDiagnosticArtifactReservationsV1 = async (
  reservations: QwenDiagnosticReservationSetV1,
): Promise<void> => {
  const state = requireReservationState(reservations);
  await Promise.all([removeReservedFile(state.response), removeReservedFile(state.report)]);
};

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const capturedType = (value: unknown): z.infer<typeof CapturedValueTypeV1Schema> => {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  switch (typeof value) {
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    case 'string':
      return 'string';
    case 'object':
      return 'object';
    default:
      return 'undefined';
  }
};

const safeFieldName = (name: string): string => pseudonymizeQwenDiagnosticFieldNameV1(name);

const pointerSegment = (segment: string | number): string =>
  String(segment).replaceAll('~', '~0').replaceAll('/', '~1');

const pointer = (path: readonly (string | number)[]): string =>
  path.length === 0 ? '' : `/${path.map(pointerSegment).join('/')}`;

type PrimitiveKind = 'null' | 'boolean' | 'number' | 'string';
type StringMode =
  'redact' | 'part-key' | 'label' | 'ocr-text' | 'enum' | 'model' | 'sha256' | 'opaque-id';
type ProjectionNode =
  | {
      readonly kind: 'leaf';
      readonly expected: readonly PrimitiveKind[];
      readonly stringMode?: StringMode;
      readonly allowedStrings?: readonly string[];
      readonly maximumLength?: number;
    }
  | {
      readonly kind: 'object';
      readonly fields: Readonly<Record<string, ProjectionNode>>;
    }
  | {
      readonly kind: 'array';
      readonly element: ProjectionNode;
      readonly maximumItems: number;
    }
  | {
      readonly kind: 'assistant-json';
      readonly schema: ProjectionNode;
      readonly maximumLength: number;
    };

const leaf = (
  expected: readonly PrimitiveKind[],
  input: Omit<Extract<ProjectionNode, { readonly kind: 'leaf' }>, 'kind' | 'expected'> = {},
): ProjectionNode => ({ kind: 'leaf', expected, ...input });
const objectNode = (fields: Readonly<Record<string, ProjectionNode>>): ProjectionNode => ({
  kind: 'object',
  fields,
});
const arrayNode = (element: ProjectionNode, maximumItems: number): ProjectionNode => ({
  kind: 'array',
  element,
  maximumItems,
});
const enumString = (allowedStrings: readonly string[]): ProjectionNode =>
  leaf(['string'], { stringMode: 'enum', allowedStrings });
const numberLeaf = leaf(['number']);
const nullableNumberLeaf = leaf(['number', 'null']);
const nullLeaf = leaf(['null']);
const booleanLeaf = leaf(['boolean']);
const partKeyString = leaf(['string'], { stringMode: 'part-key' });
const labelString = leaf(['string'], { stringMode: 'label' });
const ocrTextString = leaf(['string'], { stringMode: 'ocr-text' });

const reviewFlagsNode = arrayNode(
  enumString(['ambiguous-overlap', 'low-confidence', 'possible-occlusion', 'text-needs-review']),
  4,
);
const compositionBoundsNode = objectNode({
  xBps: numberLeaf,
  yBps: numberLeaf,
  widthBps: numberLeaf,
  heightBps: numberLeaf,
});
const compositionPartNode = objectNode({
  partKey: partKeyString,
  label: labelString,
  role: enumString(['background', 'subject', 'foreground', 'decoration', 'text', 'other']),
  bounds: compositionBoundsNode,
});
const compositionNode = objectNode({
  kind: enumString(['composition_proposal', 'no_useful_layers']),
  proposalVersion: numberLeaf,
  sourceAssetSha256: leaf(['string'], { stringMode: 'sha256' }),
  parts: arrayNode(compositionPartNode, 5),
  reason: enumString(['flat_image', 'insufficient_separation', 'unsupported_composition']),
});
const layerEvidenceNode = objectNode({
  partKey: partKeyString,
  observationBasis: enumString(['directly-visible-in-source-image']),
  confidence: objectNode({
    unit: enumString(['basis-points']),
    valueBps: numberLeaf,
  }),
  reviewFlags: reviewFlagsNode,
});
const textObservationNode = objectNode({
  observationVersion: numberLeaf,
  observationId: leaf(['string'], { stringMode: 'opaque-id' }),
  text: objectNode({
    kind: enumString(['observed-text']),
    value: ocrTextString,
    normalization: enumString(['unicode-nfc-single-space-v1']),
    contentTrust: enumString(['untrusted-user-image-content']),
    instructionAuthority: enumString(['none']),
  }),
  boundingBox: objectNode({
    unit: enumString(['normalized-basis-points']),
    xBps: numberLeaf,
    yBps: numberLeaf,
    widthBps: numberLeaf,
    heightBps: numberLeaf,
  }),
  confidence: objectNode({
    unit: enumString(['basis-points']),
    valueBps: numberLeaf,
  }),
});
const sceneOutputNode = objectNode({
  outputVersion: numberLeaf,
  visibleContentConstraint: enumString(['only-directly-visible-objects-and-text']),
  composition: compositionNode,
  layerEvidence: arrayNode(layerEvidenceNode, 5),
  ocrCompletion: objectNode({
    kind: enumString(['visible-text-observations-complete', 'no-visible-text-observed']),
    observationCount: numberLeaf,
  }),
  textObservations: arrayNode(textObservationNode, 100),
  reviewFlags: reviewFlagsNode,
  humanReview: objectNode({
    required: booleanLeaf,
    proposalOnly: booleanLeaf,
    automaticCutoutExportOrOtherDecisionAuthority: enumString(['none']),
  }),
});
const usageDetailsNode = objectNode({
  audio_tokens: nullableNumberLeaf,
  cached_tokens: numberLeaf,
  text_tokens: numberLeaf,
  image_tokens: numberLeaf,
  video_tokens: numberLeaf,
  cache_creation: objectNode({
    ephemeral_5m_input_tokens: numberLeaf,
    cache_creation_input_tokens: numberLeaf,
    cache_type: enumString(['ephemeral']),
  }),
});
const completionUsageDetailsNode = objectNode({
  audio_tokens: nullableNumberLeaf,
  reasoning_tokens: nullableNumberLeaf,
  text_tokens: numberLeaf,
});
const providerEnvelopeNode = objectNode({
  id: leaf(['string'], { stringMode: 'redact', maximumLength: 256 }),
  object: enumString(['chat.completion']),
  created: numberLeaf,
  model: leaf(['string'], { stringMode: 'model', maximumLength: 256 }),
  choices: arrayNode(
    objectNode({
      index: numberLeaf,
      message: objectNode({
        role: enumString(['assistant']),
        content: { kind: 'assistant-json', schema: sceneOutputNode, maximumLength: 2_000_000 },
        reasoning_content: leaf(['string', 'null'], {
          stringMode: 'enum',
          allowedStrings: [''],
        }),
        refusal: nullLeaf,
        audio: nullLeaf,
        function_call: nullLeaf,
        tool_calls: arrayNode(objectNode({}), 0),
      }),
      finish_reason: leaf(['string', 'null'], {
        stringMode: 'enum',
        allowedStrings: ['stop', 'length', 'tool_calls', 'content_filter', 'function_call'],
      }),
      logprobs: nullLeaf,
    }),
    1,
  ),
  usage: objectNode({
    prompt_tokens: numberLeaf,
    completion_tokens: numberLeaf,
    total_tokens: numberLeaf,
    prompt_tokens_details: usageDetailsNode,
    completion_tokens_details: completionUsageDetailsNode,
  }),
  system_fingerprint: leaf(['string', 'null'], { stringMode: 'redact', maximumLength: 256 }),
  service_tier: nullLeaf,
  error: objectNode({
    message: leaf(['string'], { stringMode: 'redact', maximumLength: 4_096 }),
    type: leaf(['string'], { stringMode: 'redact', maximumLength: 256 }),
    param: leaf(['string', 'null'], { stringMode: 'redact', maximumLength: 256 }),
    code: leaf(['string', 'number'], { stringMode: 'redact', maximumLength: 256 }),
  }),
  request_id: leaf(['string'], { stringMode: 'redact', maximumLength: 256 }),
});

const sanitizedWrongTypePlaceholder = (value: unknown): unknown => {
  if (typeof value === 'string') return 'sanitized-wrong-type-string';
  if (Array.isArray(value)) return [];
  if (isRecord(value)) return {};
  if (typeof value === 'number') return 0;
  if (typeof value === 'boolean') return false;
  return null;
};

const projectString = (
  value: string,
  node: Extract<ProjectionNode, { readonly kind: 'leaf' }>,
): string => {
  const mode = node.stringMode ?? 'redact';
  if (node.maximumLength !== undefined && value.length > node.maximumLength) {
    return 'x'.repeat(node.maximumLength + 1);
  }
  if (value.length === 0) return '';
  if (mode === 'enum') {
    return node.allowedStrings?.includes(value) === true ? value : 'sanitized-invalid-value';
  }
  if (mode === 'model') {
    return value === QWEN3_VL_REQUESTED_MODEL_ID ? value : 'sanitized-foreign-model';
  }
  if (mode === 'sha256') {
    if (value === bannerPersonSourceAssetSha256) return value;
    return /^[0-9a-f]{64}$/u.test(value)
      ? foreignSourceAssetSha256Sentinels.find((candidate) => candidate !== value)!
      : 'invalid-sha';
  }
  if (mode === 'opaque-id') {
    return /^[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u.test(value)
      ? `obs-${sha256Hex(Buffer.from(value, 'utf8')).slice(0, 24)}`
      : `invalid id ${sha256Hex(Buffer.from(value, 'utf8')).slice(0, 16)}`;
  }
  if (mode === 'part-key') {
    const digest = sha256Hex(Buffer.from(value, 'utf8'));
    return /^[a-z0-9][a-z0-9._-]{0,79}$/u.test(value) ? `part_${digest}` : `INVALID-${digest}`;
  }
  if (mode === 'label') {
    const valid =
      [...value].length >= 1 &&
      [...value].length <= 80 &&
      value.normalize('NFC') === value &&
      value.trim() === value &&
      !/[\p{Cc}\u202A-\u202E\u2066-\u2069]/u.test(value);
    return valid
      ? `Label ${sha256Hex(Buffer.from(value, 'utf8')).slice(0, 24)}`
      : ' invalid-label ';
  }
  if (mode === 'ocr-text') {
    const valid =
      [...value].length >= 1 &&
      [...value].length <= 500 &&
      value.normalize('NFC') === value &&
      value.replace(/\p{White_Space}+/gu, ' ').trim() === value &&
      !/[\p{Cc}\u202A-\u202E\u2066-\u2069]/u.test(value);
    return valid
      ? `Observed ${sha256Hex(Buffer.from(value, 'utf8')).slice(0, 24)}`
      : ' invalid-observed-text ';
  }
  if (mode === 'redact') return 'sanitized-provider-string';
  return 'sanitized-provider-string';
};

type CapturedUnknownField = z.infer<typeof QwenCapturedUnknownFieldV1Schema>;

const projectWithSchema = (input: {
  readonly value: unknown;
  readonly node: ProjectionNode;
  readonly path: readonly (string | number)[];
  readonly scope: CapturedUnknownField['scope'];
  readonly unknownFields: CapturedUnknownField[];
}): unknown => {
  if (input.node.kind === 'assistant-json') {
    if (typeof input.value !== 'string') return sanitizedWrongTypePlaceholder(input.value);
    if (input.value.length === 0) return '';
    if (input.value.length > input.node.maximumLength) {
      return 'x'.repeat(input.node.maximumLength + 1);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.value) as unknown;
    } catch {
      return '{';
    }
    return canonicalizeJson(
      projectWithSchema({
        value: parsed,
        node: input.node.schema,
        path: [],
        scope: 'assistant-json',
        unknownFields: input.unknownFields,
      }),
    );
  }
  if (input.node.kind === 'object') {
    if (!isRecord(input.value)) return sanitizedWrongTypePlaceholder(input.value);
    const projected: JsonRecord = {};
    for (const key of Object.keys(input.value).toSorted(compareQwenDiagnosticCodeUnits)) {
      const fieldNode = input.node.fields[key];
      if (fieldNode === undefined) {
        if (input.unknownFields.length >= MAX_CAPTURED_UNKNOWN_FIELD_COUNT) {
          throw new QwenDiagnosticCaptureError('artifact-write-failed');
        }
        input.unknownFields.push(
          QwenCapturedUnknownFieldV1Schema.parse({
            scope: input.scope,
            parentPath: pointer(input.path),
            name: safeFieldName(key),
            receivedType: capturedType(input.value[key]),
          }),
        );
      } else {
        projected[key] = projectWithSchema({
          value: input.value[key],
          node: fieldNode,
          path: [...input.path, key],
          scope: input.scope,
          unknownFields: input.unknownFields,
        });
      }
    }
    return projected;
  }
  if (input.node.kind === 'array') {
    if (!Array.isArray(input.value)) return sanitizedWrongTypePlaceholder(input.value);
    const element = input.node.element;
    const retainedValues = input.value.slice(0, input.node.maximumItems + 1);
    return retainedValues.map((value, index) =>
      projectWithSchema({
        value,
        node: element,
        path: [...input.path, index],
        scope: input.scope,
        unknownFields: input.unknownFields,
      }),
    );
  }
  if (typeof input.value === 'string' && input.node.expected.includes('string')) {
    return projectString(input.value, input.node);
  }
  if (
    (input.value === null && input.node.expected.includes('null')) ||
    (typeof input.value === 'number' &&
      Number.isFinite(input.value) &&
      input.node.expected.includes('number')) ||
    (typeof input.value === 'boolean' && input.node.expected.includes('boolean'))
  ) {
    return input.value;
  }
  return sanitizedWrongTypePlaceholder(input.value);
};

const unknownFieldComparator = (left: CapturedUnknownField, right: CapturedUnknownField): number =>
  compareQwenDiagnosticCodeUnits(canonicalizeJson(left), canonicalizeJson(right));

const projectBody = (bodyText: string): z.infer<typeof QwenCapturedBodyProjectionV1Schema> => {
  if (Buffer.byteLength(bodyText, 'utf8') > MAX_PROVIDER_RESPONSE_CAPTURE_INPUT_BYTES) {
    throw new QwenDiagnosticCaptureError('artifact-write-failed');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText) as unknown;
  } catch {
    return { kind: 'malformed-json' };
  }
  try {
    const allUnknownFields: CapturedUnknownField[] = [];
    const projection = projectWithSchema({
      value: parsed,
      node: providerEnvelopeNode,
      path: [],
      scope: 'provider-envelope',
      unknownFields: allUnknownFields,
    });
    const sortedUnknownFields = allUnknownFields.toSorted(unknownFieldComparator);
    const unknownFields = sortedUnknownFields.slice(0, MAX_PRIMARY_UNKNOWN_FIELDS);
    const overflowFields = sortedUnknownFields.slice(MAX_PRIMARY_UNKNOWN_FIELDS);
    const overflowGroups = new Map<string, CapturedUnknownField[]>();
    for (const field of overflowFields) {
      const key = `${field.scope}:${field.parentPath}`;
      const group = overflowGroups.get(key) ?? [];
      group.push(field);
      overflowGroups.set(key, group);
      if (overflowGroups.size > MAX_UNKNOWN_FIELD_OVERFLOW_GROUPS) {
        throw new QwenDiagnosticCaptureError('artifact-write-failed');
      }
    }
    const unknownFieldOverflow = [...overflowGroups.values()]
      .map((fields) => {
        const retainedFields = fields.slice(0, MAX_RETAINED_OVERFLOW_FIELDS_PER_PARENT);
        return {
          scope: fields[0]!.scope,
          parentPath: fields[0]!.parentPath,
          retainedFields,
          actualFieldCount: fields.length,
          retainedFieldCount: retainedFields.length,
          generatedFieldCount: fields.length - retainedFields.length,
        };
      })
      .toSorted((left, right) =>
        compareQwenDiagnosticCodeUnits(canonicalizeJson(left), canonicalizeJson(right)),
      );
    const retainedOverflowFieldCount = unknownFieldOverflow.reduce(
      (total, overflow) => total + overflow.retainedFieldCount,
      0,
    );
    const generatedOverflowFieldCount = unknownFieldOverflow.reduce(
      (total, overflow) => total + overflow.generatedFieldCount,
      0,
    );
    return QwenCapturedBodyProjectionV1Schema.parse({
      kind: 'json-projection',
      canonicalBodyProjection: canonicalizeJson(projection),
      unknownFields,
      actualUnknownFieldCount: sortedUnknownFields.length,
      retainedUnknownFieldCount: unknownFields.length + retainedOverflowFieldCount,
      truncatedUnknownFieldCount: generatedOverflowFieldCount,
      unknownFieldOverflow,
    });
  } catch (error) {
    if (error instanceof QwenDiagnosticCaptureError) throw error;
    throw new QwenDiagnosticCaptureError('artifact-write-failed');
  }
};

const placeholderForType = (type: z.infer<typeof CapturedValueTypeV1Schema>): unknown => {
  switch (type) {
    case 'null':
      return null;
    case 'boolean':
      return false;
    case 'number':
      return 0;
    case 'string':
      return 'unknown-field';
    case 'array':
      return [];
    case 'object':
      return {};
    case 'undefined':
      return null;
  }
};

const unescapePointerSegment = (segment: string): string =>
  segment.replaceAll('~1', '/').replaceAll('~0', '~');

const applyUnknownFields = (
  projection: unknown,
  unknownFields: readonly z.infer<typeof QwenCapturedUnknownFieldV1Schema>[],
): unknown => {
  for (const unknownField of unknownFields) {
    const segments =
      unknownField.parentPath === ''
        ? []
        : unknownField.parentPath.slice(1).split('/').map(unescapePointerSegment);
    let parent = projection;
    for (const segment of segments) {
      if (Array.isArray(parent)) parent = parent[Number(segment)];
      else if (isRecord(parent)) parent = parent[segment];
      else throw new TypeError('Diagnostic unknown-field parent path is invalid.');
    }
    if (!isRecord(parent)) throw new TypeError('Diagnostic unknown-field parent is not an object.');
    parent[unknownField.name] = placeholderForType(unknownField.receivedType);
  }
  return projection;
};

const reconstructionUnknownFields = (
  body: Extract<
    z.infer<typeof QwenCapturedBodyProjectionV1Schema>,
    { readonly kind: 'json-projection' }
  >,
): readonly CapturedUnknownField[] => {
  const fields = [...body.unknownFields];
  for (const overflow of body.unknownFieldOverflow) {
    fields.push(...overflow.retainedFields);
    for (let index = 0; index < overflow.generatedFieldCount; index += 1) {
      fields.push(
        QwenCapturedUnknownFieldV1Schema.parse({
          scope: overflow.scope,
          parentPath: overflow.parentPath,
          name: `qrs-${String(index).padStart(8, '0')}`,
          receivedType: 'null',
        }),
      );
    }
  }
  return fields;
};

const reconstructResponse = (
  artifact: QwenSanitizedResponseCaptureArtifactV1,
): QwenBoundaryTransportResponse => {
  const body = artifact.payload.response.body;
  if (body.kind === 'malformed-json') {
    return Object.freeze({ status: artifact.payload.response.status, bodyText: '{' });
  }
  const projection = JSON.parse(body.canonicalBodyProjection) as unknown;
  const unknownFields = reconstructionUnknownFields(body);
  const providerUnknownFields = unknownFields.filter(
    (field) => field.scope === 'provider-envelope',
  );
  const assistantUnknownFields = unknownFields.filter((field) => field.scope === 'assistant-json');
  if (
    assistantUnknownFields.length > 0 &&
    isRecord(projection) &&
    Array.isArray(projection.choices)
  ) {
    const choice = projection.choices[0];
    if (
      isRecord(choice) &&
      isRecord(choice.message) &&
      typeof choice.message.content === 'string'
    ) {
      const assistantProjection = JSON.parse(choice.message.content) as unknown;
      choice.message.content = canonicalizeJson(
        applyUnknownFields(assistantProjection, assistantUnknownFields),
      );
    }
  }
  return Object.freeze({
    status: artifact.payload.response.status,
    bodyText: canonicalizeJson(applyUnknownFields(projection, providerUnknownFields)),
  });
};

const expectedOutcome = (input: {
  readonly failure: QwenResponseBoundaryFailure | null;
}): z.infer<typeof QwenCapturedExpectedOutcomeV1Schema> =>
  input.failure === null
    ? { kind: 'replay-valid' }
    : {
        kind: 'rejected',
        failureReason: input.failure.reason,
        diagnostic: input.failure.diagnostic,
      };

export const captureSanitizedQwenResponseV1 = async (input: {
  readonly reservations: QwenDiagnosticReservationSetV1;
  readonly capturedAtMs: number;
  readonly fixtureId: 'banner-person-v1';
  readonly response: QwenBoundaryTransportResponse;
  readonly failure: QwenResponseBoundaryFailure | null;
}): Promise<QwenDiagnosticArtifactMetadataV1> => {
  try {
    const reservationState = requireReservationState(input.reservations);
    const relativePath = input.reservations.responseArtifactRelativePath;
    if (reservationState.response.relativePath !== relativePath) {
      throw new QwenDiagnosticCaptureError('artifact-reservation-failed');
    }
    const payload = QwenSanitizedResponseCapturePayloadV1Schema.parse({
      captureVersion: 1,
      artifactKind: 'qwen-sanitized-provider-response-capture',
      fixtureId: input.fixtureId,
      providerKey: QWEN3_VL_PROVIDER_KEY,
      requestedModelId: QWEN3_VL_REQUESTED_MODEL_ID,
      capturedAtMs: z.int().min(0).parse(input.capturedAtMs),
      response: {
        status: input.response.status,
        body: projectBody(input.response.bodyText),
      },
      expectedOutcome: expectedOutcome({ failure: input.failure }),
      providerCallCount: 1,
      retryCount: 0,
      productionAdmissionAuthority: false,
      humanOracleModified: false,
    });
    const artifact = QwenSanitizedResponseCaptureArtifactV1Schema.parse({
      artifactVersion: 1,
      payload,
      canonicalPayloadSha256: sha256Hex(Buffer.from(canonicalizeJson(payload), 'utf8')),
    });
    const bytes = Buffer.from(`${canonicalizeJson(artifact)}\n`, 'utf8');
    if (bytes.byteLength < 2 || bytes.byteLength > MAX_DIAGNOSTIC_ARTIFACT_BYTES) {
      throw new QwenDiagnosticCaptureError('artifact-write-failed');
    }
    const metadata = QwenDiagnosticArtifactMetadataV1Schema.parse({
      relativePath,
      rawFileSha256: sha256Hex(bytes),
      mode: '0600',
    });
    await finalizeReservedFile(reservationState.response, bytes);
    return metadata;
  } catch (error) {
    if (error instanceof QwenDiagnosticCaptureError) throw error;
    throw new QwenDiagnosticCaptureError('artifact-write-failed');
  }
};

const readSafeReplayBytes = async (input: unknown): Promise<Buffer> => {
  const supplied = z.string().min(1).max(4_096).parse(input);
  const absolutePath = isAbsolute(supplied) ? resolve(supplied) : resolve(repositoryRoot, supplied);
  const relativePath = relative(repositoryRoot, absolutePath).split(sep).join('/');
  const isLocal = QwenDiagnosticResponseRelativePathV1Schema.safeParse(relativePath).success;
  const isPackageFixture =
    PackageDiagnosticFixtureRelativePathV1Schema.safeParse(relativePath).success;
  const allowed = isLocal || isPackageFixture;
  if (!allowed || relativePath.startsWith('../')) throw new TypeError('Unsafe Qwen replay path.');
  const canonicalRoot = await realpath(repositoryRoot);
  const pathSegments = relativePath.split('/');
  let componentPath = repositoryRoot;
  for (const segment of pathSegments.slice(0, -1)) {
    componentPath = resolve(componentPath, segment);
    const componentInfo = await lstat(componentPath);
    if (!componentInfo.isDirectory() || componentInfo.isSymbolicLink()) {
      throw new TypeError('Unsafe Qwen replay path component.');
    }
  }
  const canonicalFile = await realpath(absolutePath);
  if (canonicalFile !== resolve(canonicalRoot, relativePath)) {
    throw new TypeError('Qwen replay file escapes the repository.');
  }
  const handle = await open(absolutePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    const pathBefore = await lstat(absolutePath);
    const canonicalAfterOpen = await realpath(absolutePath);
    if (
      !before.isFile() ||
      !pathBefore.isFile() ||
      pathBefore.isSymbolicLink() ||
      before.nlink !== 1 ||
      pathBefore.nlink !== 1 ||
      !stableFileIdentity(before, pathBefore) ||
      before.size < 2 ||
      before.size > MAX_DIAGNOSTIC_ARTIFACT_BYTES ||
      canonicalAfterOpen !== resolve(canonicalRoot, relativePath) ||
      (isLocal && ((before.mode & 0o777) !== 0o600 || (pathBefore.mode & 0o777) !== 0o600))
    ) {
      throw new TypeError('Unsafe Qwen replay file.');
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const pathAfter = await lstat(absolutePath);
    const canonicalAfterRead = await realpath(absolutePath);
    if (
      !after.isFile() ||
      !pathAfter.isFile() ||
      pathAfter.isSymbolicLink() ||
      after.nlink !== 1 ||
      pathAfter.nlink !== 1 ||
      bytes.byteLength !== before.size ||
      !stableFileIdentity(before, after) ||
      !stableFileIdentity(before, pathAfter) ||
      canonicalAfterRead !== resolve(canonicalRoot, relativePath) ||
      after.size !== before.size ||
      pathAfter.size !== before.size ||
      (isLocal && ((after.mode & 0o777) !== 0o600 || (pathAfter.mode & 0o777) !== 0o600))
    ) {
      throw new TypeError('Qwen replay file changed during validation.');
    }
    return bytes;
  } finally {
    await handle.close();
  }
};

export const QwenReplayResultV1Schema = z
  .strictObject({
    replayVersion: z.literal(1),
    replayKind: z.literal('qwen-offline-response-validation-replay'),
    fixtureId: z.literal('banner-person-v1'),
    providerCallCount: z.literal(0),
    networkUsed: z.literal(false),
    validationStatus: z.enum(['replay-valid', 'replay-rejected']),
    failureReason: z
      .enum([
        'http-error',
        'identity-mismatch',
        'malformed-json',
        'missing-usage',
        'provider-error',
        'schema-invalid',
        'unexpected-finish',
        'unexpected-model',
      ])
      .nullable(),
    diagnostic: QwenValidationDiagnosticV1Schema.nullable(),
    replayReproduced: z.boolean(),
    sourceRawFileSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    productionAdmissionAuthority: z.literal(false),
    providerSuccessAuthority: z.literal(false),
    humanOracleModified: z.literal(false),
  })
  .readonly();

export type QwenReplayResultV1 = z.infer<typeof QwenReplayResultV1Schema>;

export const replaySanitizedQwenResponseV1 = async (input: {
  readonly responseFile: unknown;
}): Promise<QwenReplayResultV1> => {
  const bytes = await readSafeReplayBytes(input.responseFile);
  const artifact = QwenSanitizedResponseCaptureArtifactV1Schema.parse(
    JSON.parse(bytes.toString('utf8')),
  );
  const request = createCanonicalQwenBenchmarkRequestV1(artifact.payload.fixtureId);
  let failure: QwenResponseBoundaryFailure | null = null;
  try {
    validateQwenProviderResponseBoundaryV1({
      response: reconstructResponse(artifact),
      request,
    });
  } catch (error) {
    if (!(error instanceof QwenResponseBoundaryFailure)) throw error;
    failure = error;
  }
  const expected = artifact.payload.expectedOutcome;
  const replayReproduced =
    (expected.kind === 'replay-valid' && failure === null) ||
    (expected.kind === 'rejected' &&
      failure !== null &&
      expected.failureReason === failure.reason &&
      expected.diagnostic.stage === failure.diagnostic.stage &&
      expected.diagnostic.issueDigestSha256 === failure.diagnostic.issueDigestSha256 &&
      expected.diagnostic.totalIssueCount === failure.diagnostic.totalIssueCount &&
      expected.diagnostic.retainedIssueCount === failure.diagnostic.retainedIssueCount &&
      expected.diagnostic.truncatedIssueCount === failure.diagnostic.truncatedIssueCount);
  return QwenReplayResultV1Schema.parse({
    replayVersion: 1,
    replayKind: 'qwen-offline-response-validation-replay',
    fixtureId: artifact.payload.fixtureId,
    providerCallCount: 0,
    networkUsed: false,
    validationStatus: failure === null ? 'replay-valid' : 'replay-rejected',
    failureReason: failure?.reason ?? null,
    diagnostic: failure?.diagnostic ?? null,
    replayReproduced,
    sourceRawFileSha256: sha256Hex(bytes),
    productionAdmissionAuthority: false,
    providerSuccessAuthority: false,
    humanOracleModified: false,
  });
};
