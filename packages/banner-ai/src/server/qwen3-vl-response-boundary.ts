import { z } from 'zod';

import {
  createModelProducedActualTextObservationSetV1,
  type SceneAnalysisModelRequestV1,
} from '../evaluation/ai-contracts.js';
import {
  QWEN3_VL_REQUESTED_MODEL_ID,
  QwenProviderUsageV1Schema,
  type QwenProviderUsageV1,
} from '../evaluation/qwen3-vl-candidate-evidence.js';
import {
  ProposedSceneAnalysisOcrOutputV1Schema,
  type ProposedSceneAnalysisOcrOutputV1,
} from '../evaluation/openai-scene-analysis-output.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import { validateCompositionAnalysisResultV1 } from '../workflows/composition-contracts.js';

export const QwenValidationStageV1Schema = z.enum([
  'http-envelope',
  'provider-error-envelope',
  'usage-accounting',
  'model-identity',
  'choice-count',
  'finish-reason',
  'assistant-role-content',
  'assistant-json-syntax',
  'scene-top-level-schema',
  'source-identity',
  'layer-schema',
  'ocr-observation-schema',
  'bbox-schema',
  'unknown-field-rejection',
  'request-relative-identity',
]);

export type QwenValidationStageV1 = z.infer<typeof QwenValidationStageV1Schema>;

const QwenSanitizedValueTypeV1Schema = z.enum([
  'undefined',
  'null',
  'boolean',
  'number',
  'string',
  'array',
  'object',
  'enum',
  'literal',
  'union',
  'unknown',
]);

const QwenSanitizedIssueCodeV1Schema = z.enum([
  'http-status',
  'provider-error',
  'missing-required',
  'invalid-type',
  'invalid-value',
  'too-small',
  'too-big',
  'unknown-fields',
  'invalid-json',
  'invalid-format',
  'invalid-union',
  'identity-mismatch',
  'request-constraint',
  'custom',
]);

const QwenSanitizedIssueClassificationV1Schema = z.enum([
  'http-status',
  'provider-error',
  'missing-required',
  'type-mismatch',
  'enum-mismatch',
  'literal-mismatch',
  'union-mismatch',
  'constraint',
  'format-constraint',
  'range-constraint',
  'size-constraint',
  'unknown-field',
  'message-metadata',
  'json-syntax',
  'identity-mismatch',
]);

export const QwenSanitizedValidationIssueV1Schema = z
  .strictObject({
    path: z.string().regex(/^(?:|\/(?:[^\u0000-\u001F]*))$/u),
    validatorIssueCode: QwenSanitizedIssueCodeV1Schema,
    classification: QwenSanitizedIssueClassificationV1Schema,
    expectedType: QwenSanitizedValueTypeV1Schema.optional(),
    receivedType: QwenSanitizedValueTypeV1Schema.optional(),
    unknownFieldNames: z.array(z.string().min(1).max(96)).max(64).readonly().optional(),
    actualUnknownFieldNameCount: z.int().min(1).optional(),
    retainedUnknownFieldNameCount: z.int().min(0).max(64).optional(),
    truncatedUnknownFieldNameCount: z.int().min(0).optional(),
  })
  .superRefine((issue, context) => {
    const unknownFieldNames = issue.unknownFieldNames;
    const hasUnknownNames = unknownFieldNames !== undefined;
    const counts = [
      issue.actualUnknownFieldNameCount,
      issue.retainedUnknownFieldNameCount,
      issue.truncatedUnknownFieldNameCount,
    ];
    if (
      hasUnknownNames !== counts.every((count) => count !== undefined) ||
      (hasUnknownNames &&
        (issue.retainedUnknownFieldNameCount !== unknownFieldNames.length ||
          issue.actualUnknownFieldNameCount !==
            issue.retainedUnknownFieldNameCount! + issue.truncatedUnknownFieldNameCount!))
    ) {
      context.addIssue({ code: 'custom', message: 'Unknown-field truncation metadata drifted.' });
    }
  })
  .readonly();

export type QwenSanitizedValidationIssueV1 = z.infer<typeof QwenSanitizedValidationIssueV1Schema>;

export const QwenValidationDiagnosticV1Schema = z
  .strictObject({
    diagnosticVersion: z.literal(1),
    stage: QwenValidationStageV1Schema,
    issues: z.array(QwenSanitizedValidationIssueV1Schema).min(1).max(256).readonly(),
    totalIssueCount: z.int().min(1),
    retainedIssueCount: z.int().min(1).max(256),
    truncatedIssueCount: z.int().min(0),
    issueDigestSha256: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .superRefine((diagnostic, context) => {
    const digestPayload = {
      diagnosticVersion: diagnostic.diagnosticVersion,
      stage: diagnostic.stage,
      issues: diagnostic.issues,
      totalIssueCount: diagnostic.totalIssueCount,
      retainedIssueCount: diagnostic.retainedIssueCount,
      truncatedIssueCount: diagnostic.truncatedIssueCount,
    };
    if (
      diagnostic.retainedIssueCount !== diagnostic.issues.length ||
      diagnostic.totalIssueCount !==
        diagnostic.retainedIssueCount + diagnostic.truncatedIssueCount ||
      diagnostic.issueDigestSha256 !==
        sha256Hex(Buffer.from(canonicalizeJson(digestPayload), 'utf8'))
    ) {
      context.addIssue({ code: 'custom', message: 'Qwen diagnostic digest or count drifted.' });
    }
  })
  .readonly();

export type QwenValidationDiagnosticV1 = z.infer<typeof QwenValidationDiagnosticV1Schema>;

type BoundaryFailureReason =
  | 'http-error'
  | 'identity-mismatch'
  | 'malformed-json'
  | 'missing-usage'
  | 'provider-error'
  | 'schema-invalid'
  | 'unexpected-finish'
  | 'unexpected-model';

export class QwenResponseBoundaryFailure extends Error {
  readonly reason: BoundaryFailureReason;
  readonly usage: QwenProviderUsageV1 | null;
  readonly diagnostic: QwenValidationDiagnosticV1;

  constructor(input: {
    readonly reason: BoundaryFailureReason;
    readonly usage: QwenProviderUsageV1 | null;
    readonly diagnostic: QwenValidationDiagnosticV1;
  }) {
    super('Qwen response boundary rejected a provider response.');
    this.name = 'QwenResponseBoundaryFailure';
    this.reason = input.reason;
    this.usage = input.usage;
    this.diagnostic = input.diagnostic;
  }
}

interface ZodIssueLike {
  readonly code: string;
  readonly path?: readonly PropertyKey[];
  readonly expected?: unknown;
  readonly input?: unknown;
  readonly keys?: readonly unknown[];
  readonly values?: readonly unknown[];
  readonly errors?: readonly (readonly ZodIssueLike[])[];
  readonly origin?: unknown;
  readonly format?: unknown;
}

export const compareQwenDiagnosticCodeUnits = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const forbiddenDiagnosticMaterial =
  /data:image|\bbase64\b|;base64,|https?:\/\/|\bbearer\b|authorization|execution[_ -]?authoriz(?:ed|ation)|dashscope_api_key|secret[_ -]?(?:reference[_ -]?name|name)|you are the scene-analysis stage|provider protocol wrapper|(?:sk|ak|key)[-_][A-Za-z0-9_-]{12,}|eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/iu;

const QWEN_DIAGNOSTIC_FIELD_PSEUDONYM_PATTERN = /^qdf-[0-9a-f]{64}$/u;
const QWEN_DIAGNOSTIC_REPLAY_SYNTHETIC_FIELD_PATTERN = /^qrs-[0-9]{8}$/u;

export const containsForbiddenQwenDiagnosticMaterialV1 = (value: string): boolean =>
  forbiddenDiagnosticMaterial.test(value);

/**
 * Unknown provider field names are never retained. The closed replay namespace is idempotent so
 * projected live diagnostics and their locally reconstructed responses produce identical issues.
 */
export const pseudonymizeQwenDiagnosticFieldNameV1 = (input: unknown): string => {
  const text = typeof input === 'string' ? input : String(input);
  if (
    QWEN_DIAGNOSTIC_FIELD_PSEUDONYM_PATTERN.test(text) ||
    QWEN_DIAGNOSTIC_REPLAY_SYNTHETIC_FIELD_PATTERN.test(text)
  ) {
    return text;
  }
  return `qdf-${sha256Hex(Buffer.from(text, 'utf8'))}`;
};

const valueType = (input: unknown): z.infer<typeof QwenSanitizedValueTypeV1Schema> => {
  if (input === undefined) return 'undefined';
  if (input === null) return 'null';
  if (Array.isArray(input)) return 'array';
  switch (typeof input) {
    case 'boolean':
      return 'boolean';
    case 'number':
    case 'bigint':
      return 'number';
    case 'string':
      return 'string';
    case 'object':
      return 'object';
    default:
      return 'unknown';
  }
};

const safePathSegment = (segment: PropertyKey): string => {
  const text = String(segment);
  const safe =
    [...text].length >= 1 &&
    [...text].length <= 80 &&
    !/[\p{Cc}\u202A-\u202E\u2066-\u2069]/u.test(text) &&
    !containsForbiddenQwenDiagnosticMaterialV1(text)
      ? text
      : `field-${sha256Hex(Buffer.from(text, 'utf8')).slice(0, 16)}`;
  return safe.replaceAll('~', '~0').replaceAll('/', '~1');
};

const jsonPointer = (path: readonly PropertyKey[] = []): string =>
  path.length === 0 ? '' : `/${path.map(safePathSegment).join('/')}`;

const safeUnknownFieldName = (input: unknown): string => {
  return pseudonymizeQwenDiagnosticFieldNameV1(input);
};

const issueCode = (
  input: ZodIssueLike,
  receivedKnown: boolean,
  received: unknown,
): z.infer<typeof QwenSanitizedIssueCodeV1Schema> => {
  switch (input.code) {
    case 'invalid_type':
      return !receivedKnown || received === undefined ? 'missing-required' : 'invalid-type';
    case 'invalid_value':
      return 'invalid-value';
    case 'invalid_union':
      return 'invalid-union';
    case 'invalid_format':
      return 'invalid-format';
    case 'too_small':
      return 'too-small';
    case 'too_big':
      return 'too-big';
    case 'unrecognized_keys':
      return 'unknown-fields';
    default:
      return 'custom';
  }
};

const issueClassification = (
  input: ZodIssueLike,
  receivedKnown: boolean,
  received: unknown,
): z.infer<typeof QwenSanitizedIssueClassificationV1Schema> => {
  if (input.code === 'unrecognized_keys') return 'unknown-field';
  const path = input.path ?? [];
  const messageMetadata = new Set([
    'reasoning_content',
    'refusal',
    'tool_calls',
    'function_call',
    'audio',
  ]);
  if (
    path.length === 4 &&
    path[0] === 'choices' &&
    path[2] === 'message' &&
    typeof path[3] === 'string' &&
    messageMetadata.has(path[3])
  ) {
    return 'message-metadata';
  }
  if (input.code === 'invalid_value') {
    return (input.values?.length ?? 0) === 1 ? 'literal-mismatch' : 'enum-mismatch';
  }
  if (input.code === 'invalid_union') return 'union-mismatch';
  if (input.code === 'invalid_format') return 'format-constraint';
  if (input.code === 'invalid_type' && (!receivedKnown || received === undefined)) {
    return 'missing-required';
  }
  if (input.code === 'invalid_type') return 'type-mismatch';
  if (input.code === 'too_small' || input.code === 'too_big') {
    return input.origin === 'number' || input.origin === 'bigint'
      ? 'range-constraint'
      : 'size-constraint';
  }
  return 'constraint';
};

const expectedType = (
  issue: ZodIssueLike,
): z.infer<typeof QwenSanitizedValueTypeV1Schema> | undefined => {
  if (issue.code === 'invalid_value') return (issue.values?.length ?? 0) === 1 ? 'literal' : 'enum';
  if (issue.code === 'invalid_union') return 'union';
  if (issue.code === 'unrecognized_keys') return 'object';
  if (issue.code === 'invalid_format' && typeof issue.origin === 'string') {
    const origin = QwenSanitizedValueTypeV1Schema.safeParse(issue.origin);
    return origin.success ? origin.data : 'unknown';
  }
  if (typeof issue.expected === 'string') {
    const normalizedExpected =
      issue.expected === 'int' || issue.expected === 'bigint'
        ? 'number'
        : issue.expected === 'record'
          ? 'object'
          : issue.expected;
    const parsed = QwenSanitizedValueTypeV1Schema.safeParse(normalizedExpected);
    return parsed.success ? parsed.data : 'unknown';
  }
  return undefined;
};

const flattenZodIssues = (
  issues: readonly ZodIssueLike[],
  prefix: readonly PropertyKey[] = [],
): readonly ZodIssueLike[] =>
  issues.flatMap((issue) => {
    const path = [...prefix, ...(issue.path ?? [])];
    if (issue.code === 'invalid_union' && (issue.errors?.length ?? 0) > 0) {
      return issue.errors!.flatMap((branch) => flattenZodIssues(branch, path));
    }
    return [{ ...issue, path }];
  });

const sanitizeZodIssues = (
  issues: readonly ZodIssueLike[],
  receivedRoot?: unknown,
): readonly QwenSanitizedValidationIssueV1[] =>
  flattenZodIssues(issues)
    .map((issue) => {
      let received = receivedRoot;
      let receivedKnown = true;
      for (const segment of issue.path ?? []) {
        if (Array.isArray(received) && typeof segment === 'number' && segment in received) {
          received = received[segment];
        } else if (
          typeof received === 'object' &&
          received !== null &&
          Object.hasOwn(received, segment)
        ) {
          received = (received as Record<PropertyKey, unknown>)[segment];
        } else {
          receivedKnown = false;
          received = undefined;
          break;
        }
      }
      const allUnknownFieldNames =
        issue.code === 'unrecognized_keys'
          ? [...(issue.keys ?? [])]
              .map(safeUnknownFieldName)
              .toSorted(compareQwenDiagnosticCodeUnits)
          : undefined;
      const unknownFieldNames = allUnknownFieldNames?.slice(0, 64);
      const candidate = {
        path: jsonPointer(issue.path),
        validatorIssueCode: issueCode(issue, receivedKnown, received),
        classification: issueClassification(issue, receivedKnown, received),
        ...(expectedType(issue) === undefined ? {} : { expectedType: expectedType(issue) }),
        ...(receivedKnown || issue.code === 'invalid_type'
          ? { receivedType: valueType(received) }
          : {}),
        ...(unknownFieldNames === undefined
          ? {}
          : {
              unknownFieldNames,
              actualUnknownFieldNameCount: allUnknownFieldNames!.length,
              retainedUnknownFieldNameCount: unknownFieldNames.length,
              truncatedUnknownFieldNameCount:
                allUnknownFieldNames!.length - unknownFieldNames.length,
            }),
      };
      const parsed = QwenSanitizedValidationIssueV1Schema.safeParse(candidate);
      if (parsed.success) return parsed.data;
      return QwenSanitizedValidationIssueV1Schema.parse({
        path: jsonPointer(issue.path),
        validatorIssueCode: 'custom',
        classification: 'constraint',
      });
    })
    .toSorted((left, right) =>
      compareQwenDiagnosticCodeUnits(canonicalizeJson(left), canonicalizeJson(right)),
    );

const createDiagnostic = (
  stage: QwenValidationStageV1,
  issuesInput: readonly QwenSanitizedValidationIssueV1[],
): QwenValidationDiagnosticV1 => {
  const sortedIssues = [...issuesInput].toSorted((left, right) =>
    compareQwenDiagnosticCodeUnits(canonicalizeJson(left), canonicalizeJson(right)),
  );
  const issues = Object.freeze(sortedIssues.slice(0, 256));
  const digestPayload = {
    diagnosticVersion: 1 as const,
    stage,
    issues,
    totalIssueCount: sortedIssues.length,
    retainedIssueCount: issues.length,
    truncatedIssueCount: sortedIssues.length - issues.length,
  };
  const parsed = QwenValidationDiagnosticV1Schema.safeParse({
    ...digestPayload,
    issueDigestSha256: sha256Hex(Buffer.from(canonicalizeJson(digestPayload), 'utf8')),
  });
  if (parsed.success) return parsed.data;
  const fallbackIssues = Object.freeze([
    QwenSanitizedValidationIssueV1Schema.parse({
      path: '',
      validatorIssueCode: 'custom',
      classification: 'constraint',
    }),
  ]);
  const fallbackPayload = {
    diagnosticVersion: 1 as const,
    stage,
    issues: fallbackIssues,
    totalIssueCount: 1,
    retainedIssueCount: 1,
    truncatedIssueCount: 0,
  };
  return QwenValidationDiagnosticV1Schema.parse({
    ...fallbackPayload,
    issueDigestSha256: sha256Hex(Buffer.from(canonicalizeJson(fallbackPayload), 'utf8')),
  });
};

export const createSyntheticQwenValidationDiagnosticV1 = (input: {
  readonly stage: QwenValidationStageV1;
  readonly path: readonly PropertyKey[];
  readonly validatorIssueCode: z.infer<typeof QwenSanitizedIssueCodeV1Schema>;
  readonly classification: z.infer<typeof QwenSanitizedIssueClassificationV1Schema>;
  readonly expectedType?: z.infer<typeof QwenSanitizedValueTypeV1Schema>;
  readonly receivedType?: z.infer<typeof QwenSanitizedValueTypeV1Schema>;
}): QwenValidationDiagnosticV1 =>
  createDiagnostic(input.stage, [
    QwenSanitizedValidationIssueV1Schema.parse({
      path: jsonPointer(input.path),
      validatorIssueCode: input.validatorIssueCode,
      classification: input.classification,
      ...(input.expectedType === undefined ? {} : { expectedType: input.expectedType }),
      ...(input.receivedType === undefined ? {} : { receivedType: input.receivedType }),
    }),
  ]);

const stageForEnvelopeIssues = (issues: readonly ZodIssueLike[]): QwenValidationStageV1 => {
  if (issues.some((issue) => issue.code === 'unrecognized_keys')) {
    return 'unknown-field-rejection';
  }
  if (issues.some((issue) => issue.path?.[0] === 'model')) return 'model-identity';
  if (issues.some((issue) => issue.path?.[0] === 'choices' && (issue.path?.length ?? 0) <= 1)) {
    return 'choice-count';
  }
  if (
    issues.some(
      (issue) =>
        issue.path?.[0] === 'choices' &&
        issue.path?.[2] === 'message' &&
        [
          'role',
          'content',
          'reasoning_content',
          'refusal',
          'tool_calls',
          'function_call',
          'audio',
        ].includes(String(issue.path?.[3])),
    )
  ) {
    return 'assistant-role-content';
  }
  if (
    issues.some((issue) => issue.path?.[0] === 'choices' && issue.path?.[2] === 'finish_reason')
  ) {
    return 'finish-reason';
  }
  return 'http-envelope';
};

const stageForSceneIssues = (issues: readonly ZodIssueLike[]): QwenValidationStageV1 => {
  if (issues.some((issue) => issue.code === 'unrecognized_keys')) {
    return 'unknown-field-rejection';
  }
  if (
    issues.some((issue) =>
      (issue.path ?? []).some((segment) => segment === 'boundingBox' || segment === 'bounds'),
    )
  ) {
    return 'bbox-schema';
  }
  if (
    issues.some((issue) =>
      (issue.path ?? []).some(
        (segment) => segment === 'textObservations' || segment === 'ocrCompletion',
      ),
    )
  ) {
    return 'ocr-observation-schema';
  }
  if (
    issues.some((issue) =>
      (issue.path ?? []).some(
        (segment) => segment === 'composition' || segment === 'layerEvidence',
      ),
    )
  ) {
    return 'layer-schema';
  }
  return 'scene-top-level-schema';
};

const failureFromZod = (input: {
  readonly reason: BoundaryFailureReason;
  readonly usage: QwenProviderUsageV1 | null;
  readonly stage: QwenValidationStageV1;
  readonly error: z.ZodError;
  readonly receivedRoot?: unknown;
}): QwenResponseBoundaryFailure =>
  new QwenResponseBoundaryFailure({
    reason: input.reason,
    usage: input.usage,
    diagnostic: createDiagnostic(
      input.stage,
      sanitizeZodIssues(input.error.issues as readonly ZodIssueLike[], input.receivedRoot),
    ),
  });

const syntheticFailure = (input: {
  readonly reason: BoundaryFailureReason;
  readonly usage: QwenProviderUsageV1 | null;
  readonly stage: QwenValidationStageV1;
  readonly path: readonly PropertyKey[];
  readonly validatorIssueCode: z.infer<typeof QwenSanitizedIssueCodeV1Schema>;
  readonly classification: z.infer<typeof QwenSanitizedIssueClassificationV1Schema>;
  readonly expectedType?: z.infer<typeof QwenSanitizedValueTypeV1Schema>;
  readonly receivedType?: z.infer<typeof QwenSanitizedValueTypeV1Schema>;
}): QwenResponseBoundaryFailure =>
  new QwenResponseBoundaryFailure({
    reason: input.reason,
    usage: input.usage,
    diagnostic: createSyntheticQwenValidationDiagnosticV1(input),
  });

export const QwenProviderErrorPayloadSchema = z
  .strictObject({
    error: z
      .strictObject({
        message: z.string().min(1).max(4_096),
        type: z.string().min(1).max(256),
        param: z.string().max(256).nullable().optional(),
        code: z.union([z.string().min(1).max(256), z.int()]),
      })
      .readonly(),
    request_id: z.string().min(1).max(256).optional(),
  })
  .readonly();

export const QwenSuccessEnvelopeSchema = z
  .strictObject({
    id: z.string().min(1).max(256),
    object: z.literal('chat.completion'),
    created: z.int().min(0),
    model: z.string().min(1).max(256),
    choices: z
      .tuple([
        z
          .strictObject({
            index: z.literal(0),
            message: z
              .strictObject({
                role: z.literal('assistant'),
                content: z.string().min(1).max(2_000_000),
                reasoning_content: z.union([z.literal(''), z.null()]).optional(),
                refusal: z.null().optional(),
                audio: z.null().optional(),
                function_call: z.null().optional(),
                tool_calls: z.union([z.tuple([]).readonly(), z.null()]).optional(),
              })
              .readonly(),
            finish_reason: z
              .enum(['stop', 'length', 'tool_calls', 'content_filter', 'function_call'])
              .nullable(),
            logprobs: z.null().optional(),
          })
          .readonly(),
      ])
      .readonly(),
    usage: QwenProviderUsageV1Schema,
    system_fingerprint: z.string().max(256).nullable().optional(),
    service_tier: z.null().optional(),
  })
  .readonly();

export type QwenSuccessEnvelope = z.infer<typeof QwenSuccessEnvelopeSchema>;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const materializeValidatedProposal = (input: {
  readonly request: SceneAnalysisModelRequestV1;
  readonly providerOutput: ProposedSceneAnalysisOcrOutputV1;
}) => {
  if (
    input.providerOutput.composition.sourceAssetSha256 !== input.request.input.sourceAsset.sha256
  ) {
    throw syntheticFailure({
      reason: 'identity-mismatch',
      usage: null,
      stage: 'source-identity',
      path: ['composition', 'sourceAssetSha256'],
      validatorIssueCode: 'identity-mismatch',
      classification: 'identity-mismatch',
      expectedType: 'string',
      receivedType: 'string',
    });
  }
  let composition;
  try {
    composition = validateCompositionAnalysisResultV1({
      request: {
        sourceAsset: input.request.input.sourceAsset,
        maxParts: input.request.input.options.maxParts,
        includeBackground: input.request.input.options.includeBackground,
      },
      result: input.providerOutput.composition,
    });
  } catch {
    throw syntheticFailure({
      reason: 'identity-mismatch',
      usage: null,
      stage: 'request-relative-identity',
      path: ['composition'],
      validatorIssueCode: 'request-constraint',
      classification: 'identity-mismatch',
      expectedType: 'object',
      receivedType: 'object',
    });
  }
  if (
    composition.kind !== 'composition_proposal' ||
    composition.parts.length < 3 ||
    composition.parts.length > 5
  ) {
    throw syntheticFailure({
      reason: 'schema-invalid',
      usage: null,
      stage: 'layer-schema',
      path: ['composition', 'parts'],
      validatorIssueCode: 'request-constraint',
      classification: 'constraint',
      expectedType: 'array',
      receivedType: 'array',
    });
  }
  const isNoTextFixture =
    input.request.input.fixture.repositoryPath.endsWith('/banner-no-text-v1.png');
  if (
    (isNoTextFixture &&
      (input.providerOutput.ocrCompletion.kind !== 'no-visible-text-observed' ||
        input.providerOutput.textObservations.length !== 0)) ||
    (!isNoTextFixture &&
      (input.providerOutput.ocrCompletion.kind !== 'visible-text-observations-complete' ||
        input.providerOutput.textObservations.length === 0))
  ) {
    throw syntheticFailure({
      reason: 'identity-mismatch',
      usage: null,
      stage: 'request-relative-identity',
      path: ['ocrCompletion'],
      validatorIssueCode: 'identity-mismatch',
      classification: 'identity-mismatch',
      expectedType: 'object',
      receivedType: 'object',
    });
  }
  let textObservations;
  try {
    textObservations = createModelProducedActualTextObservationSetV1({
      request: input.request,
      observations: input.providerOutput.textObservations,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw failureFromZod({
        reason: 'schema-invalid',
        usage: null,
        stage: 'ocr-observation-schema',
        error,
        receivedRoot: input.providerOutput.textObservations,
      });
    }
    throw syntheticFailure({
      reason: 'identity-mismatch',
      usage: null,
      stage: 'request-relative-identity',
      path: ['textObservations'],
      validatorIssueCode: 'identity-mismatch',
      classification: 'identity-mismatch',
      expectedType: 'array',
      receivedType: 'array',
    });
  }
  return Object.freeze({
    composition,
    layerEvidence: input.providerOutput.layerEvidence,
    ocrCompletion: input.providerOutput.ocrCompletion,
    textObservations,
    reviewFlags: input.providerOutput.reviewFlags,
    humanReview: input.providerOutput.humanReview,
    decisionAuthority: 'proposal-requires-user-review' as const,
  });
};

export interface QwenBoundaryTransportResponse {
  readonly status: number;
  readonly bodyText: string;
}

export const validateQwenProviderResponseBoundaryV1 = (input: {
  readonly response: QwenBoundaryTransportResponse;
  readonly request: SceneAnalysisModelRequestV1;
}) => {
  if (input.response.status < 200 || input.response.status >= 300) {
    try {
      const parsedError = JSON.parse(input.response.bodyText) as unknown;
      const providerError = QwenProviderErrorPayloadSchema.safeParse(parsedError);
      if (providerError.success) {
        throw syntheticFailure({
          reason: 'provider-error',
          usage: null,
          stage: 'provider-error-envelope',
          path: ['error'],
          validatorIssueCode: 'provider-error',
          classification: 'provider-error',
          expectedType: 'object',
          receivedType: 'object',
        });
      }
      if (isRecord(parsedError) && Object.hasOwn(parsedError, 'error')) {
        throw failureFromZod({
          reason: 'http-error',
          usage: null,
          stage: 'provider-error-envelope',
          error: providerError.error,
          receivedRoot: parsedError,
        });
      }
    } catch (error) {
      if (error instanceof QwenResponseBoundaryFailure) throw error;
    }
    throw syntheticFailure({
      reason: 'http-error',
      usage: null,
      stage: 'http-envelope',
      path: [],
      validatorIssueCode: 'http-status',
      classification: 'http-status',
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.response.bodyText) as unknown;
  } catch {
    throw syntheticFailure({
      reason: 'malformed-json',
      usage: null,
      stage: 'http-envelope',
      path: [],
      validatorIssueCode: 'invalid-json',
      classification: 'json-syntax',
      expectedType: 'object',
      receivedType: 'string',
    });
  }
  const providerError = QwenProviderErrorPayloadSchema.safeParse(parsed);
  if (providerError.success) {
    throw syntheticFailure({
      reason: 'provider-error',
      usage: null,
      stage: 'provider-error-envelope',
      path: ['error'],
      validatorIssueCode: 'provider-error',
      classification: 'provider-error',
      expectedType: 'object',
      receivedType: 'object',
    });
  }
  if (!isRecord(parsed) || !Object.hasOwn(parsed, 'usage')) {
    throw syntheticFailure({
      reason: 'missing-usage',
      usage: null,
      stage: 'usage-accounting',
      path: ['usage'],
      validatorIssueCode: 'missing-required',
      classification: 'missing-required',
      expectedType: 'object',
      receivedType: isRecord(parsed) ? 'undefined' : valueType(parsed),
    });
  }
  const parsedUsage = QwenProviderUsageV1Schema.safeParse(parsed.usage);
  if (!parsedUsage.success) {
    throw failureFromZod({
      reason: 'schema-invalid',
      usage: null,
      stage: 'usage-accounting',
      error: parsedUsage.error,
      receivedRoot: parsed.usage,
    });
  }
  const usage = parsedUsage.data;
  if (Object.hasOwn(parsed, 'error')) {
    throw failureFromZod({
      reason: 'schema-invalid',
      usage,
      stage: 'provider-error-envelope',
      error: providerError.error,
      receivedRoot: parsed,
    });
  }
  if (!Array.isArray(parsed.choices) || parsed.choices.length !== 1) {
    throw syntheticFailure({
      reason: 'schema-invalid',
      usage,
      stage: 'choice-count',
      path: ['choices'],
      validatorIssueCode: 'request-constraint',
      classification: 'constraint',
      expectedType: 'array',
      receivedType: valueType(parsed.choices),
    });
  }
  const envelope = QwenSuccessEnvelopeSchema.safeParse(parsed);
  if (!envelope.success) {
    const issues = envelope.error.issues as readonly ZodIssueLike[];
    throw failureFromZod({
      reason: 'schema-invalid',
      usage,
      stage: stageForEnvelopeIssues(issues),
      error: envelope.error,
      receivedRoot: parsed,
    });
  }
  if (envelope.data.model !== QWEN3_VL_REQUESTED_MODEL_ID) {
    throw syntheticFailure({
      reason: 'unexpected-model',
      usage,
      stage: 'model-identity',
      path: ['model'],
      validatorIssueCode: 'identity-mismatch',
      classification: 'identity-mismatch',
      expectedType: 'string',
      receivedType: 'string',
    });
  }
  if (envelope.data.choices[0].finish_reason !== 'stop') {
    throw syntheticFailure({
      reason: 'unexpected-finish',
      usage,
      stage: 'finish-reason',
      path: ['choices', 0, 'finish_reason'],
      validatorIssueCode: 'invalid-value',
      classification: 'enum-mismatch',
      expectedType: 'enum',
      receivedType: valueType(envelope.data.choices[0].finish_reason),
    });
  }
  let parsedAssistant: unknown;
  try {
    parsedAssistant = JSON.parse(envelope.data.choices[0].message.content) as unknown;
  } catch {
    throw syntheticFailure({
      reason: 'malformed-json',
      usage,
      stage: 'assistant-json-syntax',
      path: ['choices', 0, 'message', 'content'],
      validatorIssueCode: 'invalid-json',
      classification: 'json-syntax',
      expectedType: 'object',
      receivedType: 'string',
    });
  }
  const providerOutput = ProposedSceneAnalysisOcrOutputV1Schema.safeParse(parsedAssistant);
  if (!providerOutput.success) {
    const issues = providerOutput.error.issues as readonly ZodIssueLike[];
    throw failureFromZod({
      reason: 'schema-invalid',
      usage,
      stage: stageForSceneIssues(issues),
      error: providerOutput.error,
      receivedRoot: parsedAssistant,
    });
  }
  try {
    const proposal = materializeValidatedProposal({
      request: input.request,
      providerOutput: providerOutput.data,
    });
    return Object.freeze({ envelope: envelope.data, proposal });
  } catch (error) {
    if (error instanceof QwenResponseBoundaryFailure) {
      throw new QwenResponseBoundaryFailure({
        reason: error.reason,
        usage,
        diagnostic: error.diagnostic,
      });
    }
    throw error;
  }
};
