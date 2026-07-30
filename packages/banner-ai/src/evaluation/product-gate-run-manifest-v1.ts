import { constants } from 'node:fs';
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  unlink,
} from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { z } from 'zod';

import {
  CanonicalMicrosStringSchema,
  ProviderUsageStatusSchema,
  formatMicros,
  parseMicros,
} from '../jobs/cost-budget.js';
import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import { INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1 } from './ai-contracts.js';
import { SCENE_ANALYSIS_PROMPT_V1 } from './prompt-catalog.js';
import {
  PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
  ProductGateCorpusCaseIdV1Schema,
} from './product-gate-corpus-v1.js';
import {
  PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1,
  ProductGateAdjudicationIdV1Schema,
  ProductGateArtifactIdV1Schema,
  ProductGateAttemptIdV1Schema,
  ProductGateEvaluationStageV1Schema,
  ProductGateLogicalOperationIdV1Schema,
  ProductGateProviderProvenanceV1Schema,
  ProductGateReviewRecordIdV1Schema,
  ProductGateRunIdV1Schema,
  createProductGateAdjudicationIdV1,
  createProductGateLogicalOperationIdV1,
  createProductGateReviewRecordIdV1,
  createProductGateRunIdV1,
  digestProductGateStableIdentityV1,
} from './product-gate-segmentation-v1.js';
import {
  ProductGateAdjudicationV1Schema,
  ProductGateBackgroundScorecardV1Schema,
  ProductGateCompositeUsefulnessScorecardV1Schema,
  ProductGateEndToEndScorecardV1Schema,
  ProductGateRawReviewV1Schema,
  ProductGateSegmentationScorecardV1Schema,
  ProductGateVisionScorecardV1Schema,
  validateProductGateBackgroundScorecardForCurrentCorpusV1,
} from './product-gate-scorecards-v1.js';

export {
  PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1,
  ProductGateAdjudicationIdV1Schema,
  ProductGateArtifactIdV1Schema,
  ProductGateAttemptIdV1Schema,
  ProductGateEvaluationStageV1Schema,
  ProductGateLogicalOperationIdV1Schema,
  ProductGateProviderProvenanceV1Schema,
  ProductGateReviewRecordIdV1Schema,
  ProductGateRunIdV1Schema,
  createProductGateAdjudicationIdV1,
  createProductGateLogicalOperationIdV1,
  createProductGateReviewRecordIdV1,
  createProductGateRunIdV1,
} from './product-gate-segmentation-v1.js';

export const ProductGateProtectedIdentityProjectionV1Schema = z
  .strictObject({
    sceneAnalysisPrompt: z
      .strictObject({
        id: z.literal(SCENE_ANALYSIS_PROMPT_V1.id),
        version: z.literal(SCENE_ANALYSIS_PROMPT_V1.version),
        contentSha256: z.literal(SCENE_ANALYSIS_PROMPT_V1.contentSha256),
      })
      .readonly(),
    analyzeWorkflow: z
      .strictObject({
        workflowVersionId: z.literal(INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1.workflowVersionId),
        workflowVersion: z.literal(INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1.workflowVersion),
        definitionSha256: z.literal(INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1.definitionSha256),
      })
      .readonly(),
  })
  .readonly();

export const PRODUCT_GATE_PROTECTED_IDENTITIES_V1 =
  ProductGateProtectedIdentityProjectionV1Schema.parse({
    sceneAnalysisPrompt: {
      id: SCENE_ANALYSIS_PROMPT_V1.id,
      version: SCENE_ANALYSIS_PROMPT_V1.version,
      contentSha256: SCENE_ANALYSIS_PROMPT_V1.contentSha256,
    },
    analyzeWorkflow: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
  });

export const ProductGateAttemptCostV1Schema = z
  .strictObject({
    currency: z.literal('USD'),
    usageStatus: ProviderUsageStatusSchema,
    actualCostMicros: CanonicalMicrosStringSchema.nullable(),
    estimatedCostMicros: CanonicalMicrosStringSchema.nullable(),
    reservedCostMicros: CanonicalMicrosStringSchema,
    accountingBasis: z.enum(['actual', 'estimate', 'reservation']),
    accountedCostMicros: CanonicalMicrosStringSchema,
  })
  .superRefine((cost, context) => {
    const expectedBasis =
      cost.actualCostMicros !== null
        ? 'actual'
        : cost.estimatedCostMicros !== null
          ? 'estimate'
          : 'reservation';
    const expectedAmount =
      cost.actualCostMicros ?? cost.estimatedCostMicros ?? cost.reservedCostMicros;
    if (cost.accountingBasis !== expectedBasis || cost.accountedCostMicros !== expectedAmount) {
      context.addIssue({
        code: 'custom',
        message: 'Attempt cost must prefer actual, then estimate, then full reservation.',
      });
    }
    if (
      cost.actualCostMicros !== null &&
      parseMicros(cost.actualCostMicros) > parseMicros(cost.reservedCostMicros)
    ) {
      // Actual cost is retained even if it exceeds reservation; no refinement issue is emitted.
    }
  })
  .readonly();

export type ProductGateAttemptCostV1 = z.infer<typeof ProductGateAttemptCostV1Schema>;

export const createProductGateAttemptCostV1 = (input: {
  readonly usageStatus: z.infer<typeof ProviderUsageStatusSchema>;
  readonly actualCostMicros: string | null;
  readonly estimatedCostMicros: string | null;
  readonly reservedCostMicros: string;
}): ProductGateAttemptCostV1 => {
  const actual =
    input.actualCostMicros === null ? null : formatMicros(parseMicros(input.actualCostMicros));
  const estimate =
    input.estimatedCostMicros === null
      ? null
      : formatMicros(parseMicros(input.estimatedCostMicros));
  const reservation = formatMicros(parseMicros(input.reservedCostMicros));
  const accountingBasis =
    actual !== null ? 'actual' : estimate !== null ? 'estimate' : 'reservation';
  return ProductGateAttemptCostV1Schema.parse({
    currency: 'USD',
    usageStatus: input.usageStatus,
    actualCostMicros: actual,
    estimatedCostMicros: estimate,
    reservedCostMicros: reservation,
    accountingBasis,
    accountedCostMicros: actual ?? estimate ?? reservation,
  });
};

const safeErrorCodeSchema = z.enum([
  'injected-stage-failure',
  'contract-rejection',
  'artifact-write-failure',
  'indeterminate-attempt',
]);

export const ProductGateSafeFailureV1Schema = z
  .strictObject({
    stage: ProductGateEvaluationStageV1Schema,
    code: safeErrorCodeSchema,
    safeErrorIdentity: Sha256HexSchema,
    retryable: z.boolean(),
    providerBodyRecorded: z.literal(false),
    credentialsRecorded: z.literal(false),
  })
  .readonly();

export const createProductGateSafeFailureV1 = (input: {
  readonly stage: z.infer<typeof ProductGateEvaluationStageV1Schema>;
  readonly code: z.infer<typeof safeErrorCodeSchema>;
  readonly retryable: boolean;
}) =>
  ProductGateSafeFailureV1Schema.parse({
    ...input,
    safeErrorIdentity: sha256Hex(Buffer.from(canonicalizeJson(input), 'utf8')),
    providerBodyRecorded: false,
    credentialsRecorded: false,
  });

const artifactRelativePathPattern = new RegExp(
  '^(?:run\\.json|report\\.json|cases/(?:banner-person-v1|banner-product-v1|banner-text-heavy-v1|banner-no-text-v1)/(?:adjudication\\.json|reviews/pge_review_v1_[0-9a-f]{64}\\.json|attempts/pge_attempt_v1_[0-9a-f]{64}/(?:sanitized-request\\.json|structured-result\\.json|validation\\.json|(?:masks|cutouts|background|preview|export)/[a-z0-9][a-z0-9._-]{0,127}\\.(?:json|png|html|zip))))$',
  'u',
);

export const ProductGateArtifactRelativePathV1Schema = z
  .string()
  .min(1)
  .max(512)
  .regex(artifactRelativePathPattern)
  .superRefine((path, context) => {
    if (
      isAbsolute(path) ||
      path.includes('\\\\') ||
      path.split('/').some((part) => part === '' || part === '.' || part === '..')
    ) {
      context.addIssue({ code: 'custom', message: 'Artifact path must be bounded and relative.' });
    }
  });

export const ProductGateArtifactKindV1Schema = z.enum([
  'run-record',
  'sanitized-request',
  'structured-result',
  'mask',
  'cutout',
  'background',
  'preview',
  'export',
  'validation',
  'review',
  'adjudication',
  'report',
]);

export const ProductGateArtifactMediaTypeV1Schema = z.enum([
  'application/json',
  'application/zip',
  'image/png',
  'text/html',
]);

export const canonicalProductGateJsonBytesV1 = (input: unknown): Uint8Array =>
  Buffer.from(canonicalizeJson(input), 'utf8');

const forbiddenJsonEvidenceKeys = new Set([
  'authorization',
  'authorizationheader',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'apikey',
  'xapikey',
  'password',
  'passwd',
  'secret',
  'secrets',
  'credential',
  'credentials',
  'token',
  'tokens',
  'bearertoken',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'clientsecret',
  'privatekey',
  'requestheaders',
  'responseheaders',
  'providerbody',
  'rawproviderbody',
  'providerresponsebody',
  'providererrorbody',
  'rawprovidererror',
  'rawerror',
]);

const secretJsonEvidenceValuePatterns = [
  /(?:^|\s)(?:Bearer|Basic)\s+[A-Za-z0-9+/=_-]{8,}/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /(?:^|[^A-Za-z0-9_])sk-(?:proj-)?[A-Za-z0-9_]{20,}/u,
  /AKIA[0-9A-Z]{16}/u,
];

const assertSanitizedProductGateJsonEvidenceV1 = (
  value: unknown,
  evidencePath = '$',
  depth = 0,
): void => {
  if (depth > 32)
    throw new TypeError(`JSON evidence nesting exceeds its bound at ${evidencePath}.`);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`JSON evidence contains a non-finite number at ${evidencePath}.`);
    }
    return;
  }
  if (typeof value === 'string') {
    if (
      value.length > 16_384 ||
      /(?:^|[\s"'(=])(?:\/(?!\/)|~\/|[A-Za-z]:[\\/]|file:\/\/|\\\\)/u.test(value) ||
      secretJsonEvidenceValuePatterns.some((pattern) => pattern.test(value))
    ) {
      throw new TypeError(`JSON evidence contains sensitive or unbounded text at ${evidencePath}.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 2_048) {
      throw new TypeError(`JSON evidence array exceeds its bound at ${evidencePath}.`);
    }
    for (const [index, item] of value.entries()) {
      assertSanitizedProductGateJsonEvidenceV1(
        item,
        `${evidencePath}[${String(index)}]`,
        depth + 1,
      );
    }
    return;
  }
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError(`JSON evidence contains a non-JSON value at ${evidencePath}.`);
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 256) {
    throw new TypeError(`JSON evidence object exceeds its bound at ${evidencePath}.`);
  }
  for (const [key, item] of entries) {
    const normalizedKey = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
    if (key.length < 1 || key.length > 128 || forbiddenJsonEvidenceKeys.has(normalizedKey)) {
      throw new TypeError(`JSON evidence contains a forbidden key at ${evidencePath}.`);
    }
    assertSanitizedProductGateJsonEvidenceV1(item, `${evidencePath}.${key}`, depth + 1);
  }
};

const ProductGateSanitizedJsonEvidenceV1Schema = z.unknown().superRefine((value, context) => {
  try {
    assertSanitizedProductGateJsonEvidenceV1(value);
  } catch (error) {
    context.addIssue({
      code: 'custom',
      message: error instanceof Error ? error.message : 'JSON evidence is not sanitized.',
    });
  }
});

const parseCanonicalSanitizedProductGateJsonBytesV1 = (bytes: Uint8Array): unknown => {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const parsed = ProductGateSanitizedJsonEvidenceV1Schema.parse(JSON.parse(text) as unknown);
  if (!Buffer.from(canonicalProductGateJsonBytesV1(parsed)).equals(Buffer.from(bytes))) {
    throw new TypeError('JSON evidence must use exact canonical bytes.');
  }
  return parsed;
};

const ProductGateArtifactInventoryCoreV1Schema = z.strictObject({
  relativePath: ProductGateArtifactRelativePathV1Schema,
  kind: ProductGateArtifactKindV1Schema,
  mediaType: ProductGateArtifactMediaTypeV1Schema,
  byteSize: z.int().min(1).max(52_428_800),
  sha256: Sha256HexSchema,
});

const artifactPathProjection = (
  relativePath: string,
): {
  readonly kind: z.infer<typeof ProductGateArtifactKindV1Schema>;
  readonly mediaTypes: readonly z.infer<typeof ProductGateArtifactMediaTypeV1Schema>[];
} | null => {
  if (relativePath === 'run.json') return { kind: 'run-record', mediaTypes: ['application/json'] };
  if (relativePath === 'report.json') return { kind: 'report', mediaTypes: ['application/json'] };
  if (relativePath.endsWith('/sanitized-request.json')) {
    return { kind: 'sanitized-request', mediaTypes: ['application/json'] };
  }
  if (relativePath.endsWith('/structured-result.json')) {
    return { kind: 'structured-result', mediaTypes: ['application/json'] };
  }
  if (relativePath.endsWith('/validation.json')) {
    return { kind: 'validation', mediaTypes: ['application/json'] };
  }
  if (relativePath.includes('/masks/')) {
    return { kind: 'mask', mediaTypes: ['application/json', 'image/png'] };
  }
  if (relativePath.includes('/cutouts/')) return { kind: 'cutout', mediaTypes: ['image/png'] };
  if (relativePath.includes('/background/')) {
    return { kind: 'background', mediaTypes: ['application/json', 'image/png'] };
  }
  if (relativePath.includes('/preview/')) return { kind: 'preview', mediaTypes: ['text/html'] };
  if (relativePath.includes('/export/')) {
    return { kind: 'export', mediaTypes: ['application/zip', 'text/html'] };
  }
  if (relativePath.includes('/reviews/')) {
    return { kind: 'review', mediaTypes: ['application/json'] };
  }
  if (relativePath.endsWith('/adjudication.json')) {
    return { kind: 'adjudication', mediaTypes: ['application/json'] };
  }
  return null;
};

const artifactIdForCore = (core: z.infer<typeof ProductGateArtifactInventoryCoreV1Schema>) =>
  digestProductGateStableIdentityV1('pge_artifact_v1', ProductGateArtifactIdV1Schema, core);

export const ProductGateArtifactInventoryEntryV1Schema = z
  .strictObject({
    artifactId: ProductGateArtifactIdV1Schema,
    ...ProductGateArtifactInventoryCoreV1Schema.shape,
  })
  .superRefine((entry, context) => {
    const { artifactId, ...core } = entry;
    if (artifactId !== artifactIdForCore(core)) {
      context.addIssue({
        code: 'custom',
        message: 'Artifact identity must derive from its exact stable inventory projection.',
        path: ['artifactId'],
      });
    }
    const projection = artifactPathProjection(entry.relativePath);
    if (
      projection === null ||
      entry.kind !== projection.kind ||
      !projection.mediaTypes.includes(entry.mediaType)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Artifact path, kind, and media type must match the closed runtime layout.',
      });
    }
  })
  .readonly();

export type ProductGateArtifactInventoryEntryV1 = z.infer<
  typeof ProductGateArtifactInventoryEntryV1Schema
>;

const ProductGateAttemptCoreV1Schema = z
  .strictObject({
    recordVersion: z.literal(1),
    runId: ProductGateRunIdV1Schema,
    caseId: ProductGateCorpusCaseIdV1Schema,
    attemptOrdinal: z.int().min(1).max(32),
    stage: ProductGateEvaluationStageV1Schema,
    logicalOperationId: ProductGateLogicalOperationIdV1Schema,
    parentAttemptId: ProductGateAttemptIdV1Schema.nullable(),
    retry: z
      .strictObject({
        parentAttemptId: ProductGateAttemptIdV1Schema,
        logicalOperationId: ProductGateLogicalOperationIdV1Schema,
      })
      .readonly()
      .nullable(),
    status: z.enum(['succeeded', 'failed', 'indeterminate']),
    runtimeMs: z.int().min(0).max(Number.MAX_SAFE_INTEGER),
    sanitizedRequestSha256: Sha256HexSchema,
    corpusManifestSha256: z.literal(PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.manifestSha256),
    corpusVersion: z.literal(1),
    corpusSplit: z.literal('development'),
    protectedIdentities: ProductGateProtectedIdentityProjectionV1Schema,
    cost: ProductGateAttemptCostV1Schema,
    provenance: ProductGateProviderProvenanceV1Schema,
    structuredResultSha256: Sha256HexSchema.nullable(),
    artifacts: z.array(ProductGateArtifactIdV1Schema).max(64).readonly(),
    reviewRecordIds: z.array(ProductGateReviewRecordIdV1Schema).max(3).readonly(),
    adjudicationId: ProductGateAdjudicationIdV1Schema.nullable(),
    correctionClassification: z
      .enum([
        'none',
        'rename-only',
        'required-include-exclude-default-correction',
        'reordering',
        'combining-fragments',
        'minor-mask-correction',
        'major-mask-correction',
        'background-replacement',
        'complete-decomposition-failure',
      ])
      .nullable(),
    failure: ProductGateSafeFailureV1Schema.nullable(),
    outputFinalized: z.boolean(),
  })
  .superRefine((attempt, context) => {
    const initial = attempt.attemptOrdinal === 1;
    if (
      (initial && (attempt.parentAttemptId !== null || attempt.retry !== null)) ||
      (!initial && (attempt.parentAttemptId === null || attempt.retry === null)) ||
      (attempt.retry !== null &&
        (attempt.retry.parentAttemptId !== attempt.parentAttemptId ||
          attempt.retry.logicalOperationId !== attempt.logicalOperationId))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Retry must bind the exact parent attempt and logical operation.',
      });
    }
    if (
      attempt.logicalOperationId !==
      createProductGateLogicalOperationIdV1({
        runId: attempt.runId,
        caseId: attempt.caseId,
        stage: attempt.stage,
        operationVersion: 1,
      })
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Logical operation identity must derive from the exact run, case, and stage.',
      });
    }
    const successful = attempt.status === 'succeeded';
    if (
      successful !== (attempt.failure === null) ||
      (successful && (attempt.structuredResultSha256 === null || !attempt.outputFinalized)) ||
      (!successful && (attempt.structuredResultSha256 !== null || attempt.outputFinalized))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Attempt status, failure, structured result, and finalization disagree.',
      });
    }
    if (attempt.failure !== null && attempt.failure.stage !== attempt.stage) {
      context.addIssue({ code: 'custom', message: 'Failure stage must equal attempt stage.' });
    }
    if (attempt.cost.usageStatus !== attempt.status) {
      context.addIssue({
        code: 'custom',
        message: 'Terminal attempt status must equal its conservative usage status.',
      });
    }
    if (new Set(attempt.artifacts).size !== attempt.artifacts.length) {
      context.addIssue({ code: 'custom', message: 'Attempt artifacts must be unique.' });
    }
    if (
      new Set(attempt.reviewRecordIds).size !== attempt.reviewRecordIds.length ||
      (attempt.adjudicationId !== null && attempt.reviewRecordIds.length !== 2)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Attempt review and adjudication references must be unique and complete.',
      });
    }
  });

const ProductGateAttemptIdentityInputV1Schema = z
  .strictObject({
    recordVersion: z.literal(1),
    runId: ProductGateRunIdV1Schema,
    caseId: ProductGateCorpusCaseIdV1Schema,
    attemptOrdinal: z.int().min(1).max(32),
    stage: ProductGateEvaluationStageV1Schema,
    logicalOperationId: ProductGateLogicalOperationIdV1Schema,
    parentAttemptId: ProductGateAttemptIdV1Schema.nullable(),
    retry: z
      .strictObject({
        parentAttemptId: ProductGateAttemptIdV1Schema,
        logicalOperationId: ProductGateLogicalOperationIdV1Schema,
      })
      .readonly()
      .nullable(),
  })
  .readonly();

export const createProductGateAttemptIdV1 = (input: unknown) =>
  digestProductGateStableIdentityV1(
    'pge_attempt_v1',
    ProductGateAttemptIdV1Schema,
    ProductGateAttemptIdentityInputV1Schema.parse(input),
  );

const attemptIdForCore = (core: z.infer<typeof ProductGateAttemptCoreV1Schema>) =>
  createProductGateAttemptIdV1({
    recordVersion: core.recordVersion,
    runId: core.runId,
    caseId: core.caseId,
    attemptOrdinal: core.attemptOrdinal,
    stage: core.stage,
    logicalOperationId: core.logicalOperationId,
    parentAttemptId: core.parentAttemptId,
    retry: core.retry,
  });

export const ProductGateAttemptRecordV1Schema = z
  .strictObject({
    attemptId: ProductGateAttemptIdV1Schema,
    ...ProductGateAttemptCoreV1Schema.shape,
  })
  .superRefine((attempt, context) => {
    const { attemptId, ...core } = attempt;
    const parsed = ProductGateAttemptCoreV1Schema.safeParse(core);
    if (!parsed.success || attemptId !== attemptIdForCore(parsed.data)) {
      context.addIssue({
        code: 'custom',
        message: 'Attempt identity must derive from its immutable stable record.',
        path: ['attemptId'],
      });
    }
  })
  .readonly();

export type ProductGateAttemptRecordV1 = z.infer<typeof ProductGateAttemptRecordV1Schema>;

export const createProductGateAttemptRecordV1 = (
  input: z.input<typeof ProductGateAttemptCoreV1Schema>,
): ProductGateAttemptRecordV1 => {
  const core = ProductGateAttemptCoreV1Schema.parse(input);
  return ProductGateAttemptRecordV1Schema.parse({ attemptId: attemptIdForCore(core), ...core });
};

export const ProductGateAttemptChainV1Schema = z
  .array(ProductGateAttemptRecordV1Schema)
  .min(1)
  .max(512)
  .superRefine((attempts, context) => {
    if (
      new Set(attempts.map((attempt) => attempt.runId)).size !== 1 ||
      new Set(attempts.map((attempt) => attempt.caseId)).size !== 1
    ) {
      context.addIssue({
        code: 'custom',
        message: 'An attempt chain must belong to one exact run and case.',
      });
    }
    const byId = new Map<string, ProductGateAttemptRecordV1>();
    const successfulByOperation = new Map<string, number>();
    const seenOperations = new Set<string>();
    const stageByOperation = new Map<string, z.infer<typeof ProductGateEvaluationStageV1Schema>>();
    for (const [index, attempt] of attempts.entries()) {
      seenOperations.add(attempt.logicalOperationId);
      const ownedStage = stageByOperation.get(attempt.logicalOperationId);
      if (ownedStage !== undefined && ownedStage !== attempt.stage) {
        context.addIssue({
          code: 'custom',
          message: 'One logical operation cannot be reused across incompatible stages.',
        });
      }
      stageByOperation.set(attempt.logicalOperationId, attempt.stage);
      if (byId.has(attempt.attemptId)) {
        context.addIssue({
          code: 'custom',
          message: 'Attempt chain contains a duplicate identity.',
        });
      }
      if (attempt.status === 'succeeded') {
        successfulByOperation.set(
          attempt.logicalOperationId,
          (successfulByOperation.get(attempt.logicalOperationId) ?? 0) + 1,
        );
      }
      if (attempt.retry !== null) {
        const parent = byId.get(attempt.retry.parentAttemptId);
        if (
          parent === undefined ||
          !['failed', 'indeterminate'].includes(parent.status) ||
          parent.failure === null ||
          !parent.failure.retryable ||
          parent.runId !== attempt.runId ||
          parent.caseId !== attempt.caseId ||
          parent.stage !== attempt.stage ||
          parent.logicalOperationId !== attempt.logicalOperationId ||
          attempt.attemptOrdinal !== parent.attemptOrdinal + 1 ||
          attempts[index - 1]?.attemptId !== parent.attemptId
        ) {
          context.addIssue({
            code: 'custom',
            message:
              'Retry parent must be the immediately preceding retryable failed or indeterminate attempt.',
          });
        }
      }
      byId.set(attempt.attemptId, attempt);
    }
    if ([...seenOperations].some((id) => (successfulByOperation.get(id) ?? 0) > 1)) {
      context.addIssue({
        code: 'custom',
        message: 'A logical operation may finalize at most one successful output.',
      });
    }
  })
  .readonly();

export const ProductGateRunRecordV1Schema = z
  .strictObject({
    recordVersion: z.literal(1),
    runId: ProductGateRunIdV1Schema,
    runnerIdentity: z.literal('provider-free-deterministic-fake-runner-v1'),
    sanitizedInputSha256: Sha256HexSchema,
    corpusManifestSha256: z.literal(PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.manifestSha256),
    corpusVersion: z.literal(1),
    corpusSplit: z.literal('development'),
    deterministicSeed: Sha256HexSchema,
    protectedIdentities: ProductGateProtectedIdentityProjectionV1Schema,
    provenance: ProductGateProviderProvenanceV1Schema,
    providerTransmissionAuthority: z.literal(false),
    realEvaluationAuthority: z.literal(false),
    productGateEvidence: z.literal(false),
  })
  .superRefine((record, context) => {
    const { runId, ...identityInput } = record;
    if (runId !== createProductGateRunIdV1(identityInput)) {
      context.addIssue({ code: 'custom', message: 'Run ID must derive from stable run input.' });
    }
    if (
      canonicalizeJson(record.provenance) !==
      canonicalizeJson(PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Deterministic fake run records require provider-free fake provenance.',
      });
    }
  })
  .readonly();

export const PRODUCT_GATE_FAKE_RUNNER_STAGES_V1 = Object.freeze([
  ...ProductGateEvaluationStageV1Schema.options,
]);

export const ProductGateDeterministicFakeCaseResultV1Schema = z
  .strictObject({
    caseId: ProductGateCorpusCaseIdV1Schema,
    acceptedStages: z.array(ProductGateEvaluationStageV1Schema).length(11).readonly(),
    attempts: ProductGateAttemptChainV1Schema,
    visionScorecard: ProductGateVisionScorecardV1Schema,
    segmentationScorecards: z
      .array(ProductGateSegmentationScorecardV1Schema)
      .min(1)
      .max(5)
      .readonly(),
    backgroundScorecard: ProductGateBackgroundScorecardV1Schema,
    compositeScorecard: ProductGateCompositeUsefulnessScorecardV1Schema,
    endToEndScorecard: ProductGateEndToEndScorecardV1Schema,
    rawReviews: z.tuple([ProductGateRawReviewV1Schema, ProductGateRawReviewV1Schema]).readonly(),
    adjudication: ProductGateAdjudicationV1Schema,
    correctionClassification: z.literal('none'),
    injectedFailureRecovered: z.boolean(),
  })
  .superRefine((result, context) => {
    const successfulOperations = result.attempts.filter(
      (attempt) => attempt.status === 'succeeded',
    );
    const expectedEntry = PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.entries.find(
      (entry) => entry.caseId === result.caseId,
    );
    const scorecardCandidateIds = result.segmentationScorecards
      .map((scorecard) => scorecard.candidateId)
      .toSorted();
    let backgroundScorecardAuthorized = true;
    try {
      validateProductGateBackgroundScorecardForCurrentCorpusV1({
        scorecard: result.backgroundScorecard,
        corpusManifest: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
      });
    } catch {
      backgroundScorecardAuthorized = false;
    }
    if (
      canonicalizeJson(result.acceptedStages) !==
        canonicalizeJson(PRODUCT_GATE_FAKE_RUNNER_STAGES_V1) ||
      successfulOperations.length !== PRODUCT_GATE_FAKE_RUNNER_STAGES_V1.length ||
      new Set(successfulOperations.map((attempt) => attempt.logicalOperationId)).size !==
        PRODUCT_GATE_FAKE_RUNNER_STAGES_V1.length ||
      canonicalizeJson(successfulOperations.map((attempt) => attempt.stage)) !==
        canonicalizeJson(PRODUCT_GATE_FAKE_RUNNER_STAGES_V1) ||
      expectedEntry === undefined ||
      result.attempts.some(
        (attempt) =>
          attempt.caseId !== result.caseId ||
          attempt.corpusManifestSha256 !== PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.manifestSha256 ||
          canonicalizeJson(attempt.provenance) !==
            canonicalizeJson(PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1),
      ) ||
      !backgroundScorecardAuthorized ||
      result.backgroundScorecard.caseId !== result.caseId ||
      result.backgroundScorecard.originalSourceSha256 !== expectedEntry.original.sha256 ||
      result.backgroundScorecard.normalizedSourceSha256 !== expectedEntry.normalized.sha256 ||
      canonicalizeJson(result.compositeScorecard.foregroundComponents) !==
        canonicalizeJson(result.segmentationScorecards) ||
      result.endToEndScorecard.compositeUsefulness !==
        (result.compositeScorecard.useful ? 'pass' : 'fail') ||
      result.rawReviews.some(
        (review) =>
          review.caseId !== result.caseId ||
          canonicalizeJson(review.presentationItemIds) !== canonicalizeJson(scorecardCandidateIds),
      ) ||
      canonicalizeJson(result.adjudication.rawReviews) !== canonicalizeJson(result.rawReviews)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Every logical stage and nested case-bound score/review record must finalize exactly once.',
      });
    }
  })
  .readonly();

export const ProductGateDeterministicFakeReportV1Schema = z
  .strictObject({
    reportVersion: z.literal(1),
    runId: ProductGateRunIdV1Schema,
    runnerIdentity: z.literal('provider-free-deterministic-fake-runner-v1'),
    corpusSplit: z.literal('development'),
    corpusManifestSha256: z.literal(PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.manifestSha256),
    cases: z.array(ProductGateDeterministicFakeCaseResultV1Schema).length(4).readonly(),
    productGateMetric: z
      .strictObject({
        metricVersion: z.literal(1),
        metricId: z.literal('product-gate-e2e'),
        evidenceScope: z.literal('authority-bound'),
        stage: z.null(),
        decision: z.literal('not-measurable'),
        numerator: z.null(),
        denominator: z.null(),
        observations: z.tuple([]).readonly(),
        threshold: z.literal('at-least-14-of-18-with-all-seven-requirements'),
        reason: z.literal('development-corpus-not-product-gate-evidence'),
      })
      .readonly(),
    productGateOutcome: z.literal('not-measurable'),
    holdoutAdmitted: z.literal(false),
    authoritativeGdnEvidenceAvailable: z.literal(false),
    providerTransmissionAuthority: z.literal(false),
    realEvaluationAuthority: z.literal(false),
    networkOperations: z.literal(0),
    providerModelCalls: z.literal(0),
    samRunpodGpuCalls: z.literal(0),
    credentialAccesses: z.literal(0),
    paidOperations: z.literal(0),
  })
  .superRefine((report, context) => {
    if (
      canonicalizeJson(report.cases.map((item) => item.caseId)) !==
      canonicalizeJson(ProductGateCorpusCaseIdV1Schema.options)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Final report must contain the exact ordered development cases.',
      });
    }
    if (
      report.cases.some((item) =>
        item.attempts.some(
          (attempt) =>
            attempt.runId !== report.runId ||
            attempt.caseId !== item.caseId ||
            attempt.corpusManifestSha256 !== report.corpusManifestSha256,
        ),
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Fake report cases and attempts must bind the exact ordered run corpus.',
      });
    }
  })
  .readonly();

export type ProductGateDeterministicFakeReportV1 = z.infer<
  typeof ProductGateDeterministicFakeReportV1Schema
>;

export const ProductGateFinalManifestV1Schema = z
  .strictObject({
    manifestVersion: z.literal(1),
    runId: ProductGateRunIdV1Schema,
    status: z.literal('finalized'),
    partial: z.literal(false),
    entries: z.array(ProductGateArtifactInventoryEntryV1Schema).min(1).max(1_024).readonly(),
    inventorySha256: Sha256HexSchema,
    manifestSha256: Sha256HexSchema,
    publishedLast: z.literal(true),
  })
  .superRefine((manifest, context) => {
    const sorted = manifest.entries.toSorted((left, right) =>
      left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
    );
    if (
      canonicalizeJson(sorted) !== canonicalizeJson(manifest.entries) ||
      new Set(manifest.entries.map((entry) => entry.relativePath)).size !==
        manifest.entries.length ||
      manifest.inventorySha256 !== digestProductGateArtifactInventoryV1(manifest.entries)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Final manifest entries must be unique, sorted, and digest-bound.',
      });
    }
    const requiredCorePaths = manifest.entries.filter((entry) =>
      ['run.json', 'report.json'].includes(entry.relativePath),
    );
    if (
      requiredCorePaths.length !== 2 ||
      !requiredCorePaths.some(
        (entry) =>
          entry.relativePath === 'run.json' &&
          entry.kind === 'run-record' &&
          entry.mediaType === 'application/json',
      ) ||
      !requiredCorePaths.some(
        (entry) =>
          entry.relativePath === 'report.json' &&
          entry.kind === 'report' &&
          entry.mediaType === 'application/json',
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A finalized manifest requires its exact run.json and report.json core entries.',
      });
    }
    const { manifestSha256, ...core } = manifest;
    if (manifestSha256 !== digestProductGateFinalManifestCoreV1(core)) {
      context.addIssue({ code: 'custom', message: 'Final manifest canonical digest drifted.' });
    }
  })
  .readonly();

export type ProductGateFinalManifestV1 = z.infer<typeof ProductGateFinalManifestV1Schema>;

export const digestProductGateArtifactInventoryV1 = (
  entries: readonly ProductGateArtifactInventoryEntryV1[],
): string =>
  sha256Hex(
    Buffer.from(
      canonicalizeJson(z.array(ProductGateArtifactInventoryEntryV1Schema).parse(entries)),
      'utf8',
    ),
  );

const digestProductGateFinalManifestCoreV1 = (input: unknown): string =>
  sha256Hex(Buffer.from(canonicalizeJson(input), 'utf8'));

const assertContained = (root: string, candidate: string): void => {
  const child = relative(resolve(root), resolve(candidate));
  if (child === '' || child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw new TypeError('Evidence path escaped its exact run root.');
  }
};

const ensurePrivateDirectory = async (directory: string): Promise<void> => {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new TypeError('Evidence directory must be a non-symlink directory.');
  }
  await chmod(directory, 0o700);
};

const ensurePrivateRootDirectory = async (directory: string): Promise<void> => {
  if (resolve(directory) === resolve(directory, sep)) {
    throw new TypeError('Filesystem root cannot be an evidence root.');
  }
  let created = false;
  try {
    await lstat(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    created = true;
  }
  const metadata = await lstat(directory);
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (!created && (metadata.mode & 0o777) !== 0o700)
  ) {
    throw new TypeError('Evidence root must be a private 0700 non-symlink directory.');
  }
  if (created) await chmod(directory, 0o700);
};

const assertNoSymlinkChain = async (root: string, directory: string): Promise<void> => {
  const child = relative(resolve(root), resolve(directory));
  if (child === '') return;
  assertContained(root, directory);
  let cursor = resolve(root);
  for (const component of child.split(sep)) {
    cursor = join(cursor, component);
    const metadata = await lstat(cursor);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new TypeError('Evidence directory chain contains a symlink or special entry.');
    }
  }
  const [realRoot, realDirectory] = await Promise.all([realpath(root), realpath(directory)]);
  const realChild = relative(realRoot, realDirectory);
  if (realChild === '..' || realChild.startsWith(`..${sep}`) || isAbsolute(realChild)) {
    throw new TypeError('Evidence directory real path escaped its root.');
  }
};

const withProductGateRunMutationLockV1 = async <T>(
  runDirectoryInput: string,
  operation: () => Promise<T>,
): Promise<T> => {
  const runDirectory = resolve(runDirectoryInput);
  const runId = ProductGateRunIdV1Schema.parse(basename(runDirectory));
  const runsDirectory = resolve(runDirectory, '..');
  const runsMetadata = await lstat(runsDirectory);
  if (
    !runsMetadata.isDirectory() ||
    runsMetadata.isSymbolicLink() ||
    (runsMetadata.mode & 0o777) !== 0o700
  ) {
    throw new TypeError(
      'Run mutation lock parent must be a private regular non-symlink directory.',
    );
  }
  const lockPath = resolve(runsDirectory, `.${runId}.mutation-lock`);
  assertContained(runsDirectory, lockPath);
  let lockHandle;
  try {
    lockHandle = await open(
      lockPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new TypeError('Concurrent mutation or finalization of this run is rejected.', {
        cause: error,
      });
    }
    throw error;
  }
  try {
    return await operation();
  } finally {
    await lockHandle.close();
    await unlink(lockPath).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
};

export const productGateRunDirectoryV1 = (rootDirectory: string, runId: unknown): string => {
  const parsedRunId = ProductGateRunIdV1Schema.parse(runId);
  const root = resolve(z.string().min(1).parse(rootDirectory));
  const result = resolve(root, 'runs', parsedRunId);
  assertContained(root, result);
  return result;
};

export const createProductGateRunDirectoryV1 = async (input: {
  readonly rootDirectory: string;
  readonly runId: unknown;
}): Promise<string> => {
  const root = resolve(z.string().min(1).parse(input.rootDirectory));
  await ensurePrivateRootDirectory(root);
  await assertNoSymlinkChain(root, root);
  const runs = resolve(root, 'runs');
  await ensurePrivateDirectory(runs);
  await assertNoSymlinkChain(root, runs);
  const runDirectory = productGateRunDirectoryV1(root, input.runId);
  try {
    await mkdir(runDirectory, { mode: 0o700 });
  } catch (error) {
    throw new TypeError('Run evidence already exists or cannot be reserved.', { cause: error });
  }
  await chmod(runDirectory, 0o700);
  await assertNoSymlinkChain(root, runDirectory);
  return runDirectory;
};

const ensureArtifactParent = async (
  runDirectory: string,
  relativePath: string,
): Promise<string> => {
  const components = relativePath.split('/');
  components.pop();
  let cursor = resolve(runDirectory);
  for (const component of components) {
    cursor = resolve(cursor, component);
    assertContained(runDirectory, cursor);
    try {
      await mkdir(cursor, { mode: 0o700 });
    } catch (error) {
      const metadata = await lstat(cursor).catch(() => null);
      if (metadata === null || !metadata.isDirectory() || metadata.isSymbolicLink()) {
        throw new TypeError('Artifact parent is not a private regular directory.', {
          cause: error,
        });
      }
    }
    await chmod(cursor, 0o700);
  }
  await assertNoSymlinkChain(runDirectory, cursor);
  return cursor;
};

export const writeProductGateEvidenceFileV1 = async (input: {
  readonly runDirectory: string;
  readonly relativePath: unknown;
  readonly kind: unknown;
  readonly mediaType: unknown;
  readonly bytes: Uint8Array;
}): Promise<ProductGateArtifactInventoryEntryV1> => {
  const runDirectory = resolve(z.string().min(1).parse(input.runDirectory));
  const relativePath = ProductGateArtifactRelativePathV1Schema.parse(input.relativePath);
  const kind = ProductGateArtifactKindV1Schema.parse(input.kind);
  const mediaType = ProductGateArtifactMediaTypeV1Schema.parse(input.mediaType);
  const bytes = Uint8Array.from(input.bytes);
  if (bytes.byteLength < 1 || bytes.byteLength > 52_428_800) {
    throw new RangeError('Evidence file bytes are outside the bounded artifact size.');
  }
  if (mediaType === 'application/json') {
    try {
      parseCanonicalSanitizedProductGateJsonBytesV1(bytes);
    } catch (error) {
      throw new TypeError('JSON evidence must be bounded, sanitized, valid, and canonical.', {
        cause: error,
      });
    }
  }
  const core = ProductGateArtifactInventoryCoreV1Schema.parse({
    relativePath,
    kind,
    mediaType,
    byteSize: bytes.byteLength,
    sha256: sha256Hex(bytes),
  });
  const entry = ProductGateArtifactInventoryEntryV1Schema.parse({
    artifactId: artifactIdForCore(core),
    ...core,
  });
  return withProductGateRunMutationLockV1(runDirectory, async () => {
    const rootMetadata = await lstat(runDirectory);
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
      throw new TypeError('Run evidence root must be a non-symlink directory.');
    }
    try {
      await lstat(resolve(runDirectory, 'manifest.json'));
      throw new TypeError('Finalized evidence cannot receive additional artifacts.');
    } catch (error) {
      if (error instanceof TypeError) throw error;
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await ensureArtifactParent(runDirectory, relativePath);
    const candidate = resolve(runDirectory, relativePath);
    assertContained(runDirectory, candidate);
    const handle = await open(
      candidate,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await chmod(candidate, 0o600);
    return entry;
  });
};

const verifyInventoryEntry = async (
  runDirectory: string,
  entry: ProductGateArtifactInventoryEntryV1,
): Promise<void> => {
  const candidate = resolve(runDirectory, entry.relativePath);
  assertContained(runDirectory, candidate);
  await assertNoSymlinkChain(runDirectory, resolve(candidate, '..'));
  const metadata = await lstat(candidate);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (metadata.mode & 0o777) !== 0o600 ||
    metadata.size !== entry.byteSize
  ) {
    throw new TypeError('Final inventory contains an unsafe or drifted evidence file.');
  }
  const bytes = await readFile(candidate);
  if (sha256Hex(bytes) !== entry.sha256) {
    throw new TypeError('Final inventory evidence digest drifted.');
  }
  if (entry.mediaType === 'application/json') {
    parseCanonicalSanitizedProductGateJsonBytesV1(bytes);
  }
};

const listProductGateEvidenceFilesV1 = async (runDirectory: string): Promise<readonly string[]> => {
  const collected: string[] = [];
  const visit = async (directory: string, prefix: string): Promise<void> => {
    const directoryMetadata = await lstat(directory);
    if (
      !directoryMetadata.isDirectory() ||
      directoryMetadata.isSymbolicLink() ||
      (directoryMetadata.mode & 0o777) !== 0o700
    ) {
      throw new TypeError('Evidence inventory contains an unsafe directory.');
    }
    for (const name of (await readdir(directory)).toSorted()) {
      const candidate = resolve(directory, name);
      assertContained(runDirectory, candidate);
      const metadata = await lstat(candidate);
      if (metadata.isSymbolicLink()) {
        throw new TypeError('Evidence inventory contains a symlink.');
      }
      const child = prefix.length === 0 ? name : `${prefix}/${name}`;
      if (metadata.isDirectory()) {
        await visit(candidate, child);
      } else if (metadata.isFile()) {
        collected.push(child);
      } else {
        throw new TypeError('Evidence inventory contains a special entry.');
      }
    }
  };
  await visit(runDirectory, '');
  return Object.freeze(collected);
};

const readCanonicalProductGateJsonEvidenceV1 = async (
  runDirectory: string,
  relativePath: string,
): Promise<unknown> => {
  const candidate = resolve(runDirectory, relativePath);
  assertContained(runDirectory, candidate);
  const bytes = await readFile(candidate);
  try {
    return parseCanonicalSanitizedProductGateJsonBytesV1(bytes);
  } catch (error) {
    throw new TypeError('Core run evidence is not sanitized canonical JSON.', { cause: error });
  }
};

export const publishProductGateFinalManifestV1 = async (input: {
  readonly runDirectory: string;
  readonly runId: unknown;
  readonly entries: readonly unknown[];
}): Promise<{ readonly manifest: ProductGateFinalManifestV1; readonly bytes: Uint8Array }> => {
  const runDirectory = resolve(z.string().min(1).parse(input.runDirectory));
  const runId = ProductGateRunIdV1Schema.parse(input.runId);
  if (basename(runDirectory) !== runId) {
    throw new TypeError('Final manifest run identity must match its exact run directory.');
  }
  const runDirectoryMetadata = await lstat(runDirectory);
  if (
    !runDirectoryMetadata.isDirectory() ||
    runDirectoryMetadata.isSymbolicLink() ||
    (runDirectoryMetadata.mode & 0o777) !== 0o700
  ) {
    throw new TypeError('Final manifest requires a private 0700 non-symlink run directory.');
  }
  await assertNoSymlinkChain(resolve(runDirectory, '..'), runDirectory);
  const entries = z
    .array(ProductGateArtifactInventoryEntryV1Schema)
    .min(1)
    .max(1_024)
    .parse(input.entries)
    .toSorted((left, right) =>
      left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
    );
  return withProductGateRunMutationLockV1(runDirectory, async () => {
    for (const entry of entries) await verifyInventoryEntry(runDirectory, entry);
    const expectedPaths = entries.map((entry) => entry.relativePath);
    const actualPaths = await listProductGateEvidenceFilesV1(runDirectory);
    if (
      !expectedPaths.includes('run.json') ||
      !expectedPaths.includes('report.json') ||
      canonicalizeJson(actualPaths) !== canonicalizeJson(expectedPaths)
    ) {
      throw new TypeError('Final manifest must contain the complete exact run/report inventory.');
    }
    const runRecord = ProductGateRunRecordV1Schema.parse(
      await readCanonicalProductGateJsonEvidenceV1(runDirectory, 'run.json'),
    );
    const reportRecord = ProductGateDeterministicFakeReportV1Schema.parse(
      await readCanonicalProductGateJsonEvidenceV1(runDirectory, 'report.json'),
    );
    if (
      runRecord.runId !== runId ||
      reportRecord.runId !== runId ||
      reportRecord.corpusManifestSha256 !== runRecord.corpusManifestSha256
    ) {
      throw new TypeError(
        'Run, report, corpus, directory, and final manifest identities must agree.',
      );
    }
    const entryByPath = new Map(entries.map((entry) => [entry.relativePath, entry]));
    const entryById = new Map(entries.map((entry) => [entry.artifactId, entry]));
    const coveredPaths = new Set<string>(['run.json', 'report.json']);
    for (const caseEvidence of reportRecord.cases) {
      const caseReviewIds = caseEvidence.rawReviews.map((review) => {
        if (review.deterministicPresentationSeed !== runRecord.deterministicSeed) {
          throw new TypeError('Raw review presentation seed must equal its exact run seed.');
        }
        const { reviewRecordId, ...reviewCore } = review;
        const parsedId = ProductGateReviewRecordIdV1Schema.parse(reviewRecordId);
        if (parsedId !== createProductGateReviewRecordIdV1(reviewCore)) {
          throw new TypeError('Raw review content-derived identity drifted.');
        }
        return parsedId;
      });
      if (new Set(caseReviewIds).size !== caseReviewIds.length) {
        throw new TypeError('Raw review identities must be unique within one case.');
      }
      const { adjudicationId: rawAdjudicationId, ...adjudicationCore } = caseEvidence.adjudication;
      const caseAdjudicationId = ProductGateAdjudicationIdV1Schema.parse(rawAdjudicationId);
      if (caseAdjudicationId !== createProductGateAdjudicationIdV1(adjudicationCore)) {
        throw new TypeError('Adjudication content-derived identity drifted.');
      }
      for (const attempt of caseEvidence.attempts) {
        if (attempt.corpusManifestSha256 !== runRecord.corpusManifestSha256) {
          throw new TypeError('Attempt corpus identity differs from its exact run and report.');
        }
        if (
          attempt.reviewRecordIds.some(
            (reviewRecordId) => !caseReviewIds.includes(reviewRecordId),
          ) ||
          (attempt.adjudicationId !== null && attempt.adjudicationId !== caseAdjudicationId)
        ) {
          throw new TypeError('Attempt review or adjudication reference is dangling or foreign.');
        }
        const attemptRoot = `cases/${caseEvidence.caseId}/attempts/${attempt.attemptId}`;
        const sanitizedPath = `${attemptRoot}/sanitized-request.json`;
        const sanitizedEntry = entryByPath.get(sanitizedPath);
        if (
          sanitizedEntry === undefined ||
          sanitizedEntry.sha256 !== attempt.sanitizedRequestSha256 ||
          !attempt.artifacts.includes(sanitizedEntry.artifactId)
        ) {
          throw new TypeError('Attempt sanitized-request evidence is missing or identity-drifted.');
        }
        coveredPaths.add(sanitizedPath);
        const referencedEntries = attempt.artifacts.map((artifactId) => entryById.get(artifactId));
        if (
          referencedEntries.some(
            (entry) => entry === undefined || !entry.relativePath.startsWith(`${attemptRoot}/`),
          )
        ) {
          throw new TypeError(
            'Attempt artifact references are missing or owned by another attempt.',
          );
        }
        for (const entry of referencedEntries) coveredPaths.add(entry!.relativePath);
        const structuredPath = `${attemptRoot}/structured-result.json`;
        const structuredEntry = entryByPath.get(structuredPath);
        if (attempt.status !== 'succeeded') {
          if (structuredEntry !== undefined) {
            throw new TypeError('A non-successful attempt cannot own finalized structured output.');
          }
          continue;
        }
        if (structuredEntry === undefined) {
          throw new TypeError('A successful attempt requires finalized structured output.');
        }
        const structuredJson = await readCanonicalProductGateJsonEvidenceV1(
          runDirectory,
          structuredPath,
        );
        const structuredProjection = z
          .strictObject({
            recordVersion: z.literal(1),
            attempt: ProductGateAttemptRecordV1Schema,
            result: ProductGateSanitizedJsonEvidenceV1Schema,
          })
          .parse(structuredJson);
        if (
          !Object.hasOwn(structuredJson as object, 'result') ||
          canonicalizeJson(structuredProjection.attempt) !== canonicalizeJson(attempt) ||
          attempt.structuredResultSha256 !==
            sha256Hex(Buffer.from(canonicalizeJson(structuredProjection.result), 'utf8'))
        ) {
          throw new TypeError(
            'Structured result does not bind its exact attempt and result digest.',
          );
        }
        coveredPaths.add(structuredPath);
      }
      for (const review of caseEvidence.rawReviews) {
        const reviewRecordId = ProductGateReviewRecordIdV1Schema.parse(review.reviewRecordId);
        const reviewPath = `cases/${caseEvidence.caseId}/reviews/${reviewRecordId}.json`;
        const reviewEntry = entryByPath.get(reviewPath);
        if (
          reviewEntry === undefined ||
          canonicalizeJson(
            await readCanonicalProductGateJsonEvidenceV1(runDirectory, reviewPath),
          ) !== canonicalizeJson(review)
        ) {
          throw new TypeError('Raw review artifact is missing or identity-drifted.');
        }
        coveredPaths.add(reviewPath);
      }
      const adjudicationPath = `cases/${caseEvidence.caseId}/adjudication.json`;
      const adjudicationEntry = entryByPath.get(adjudicationPath);
      if (
        adjudicationEntry === undefined ||
        canonicalizeJson(
          await readCanonicalProductGateJsonEvidenceV1(runDirectory, adjudicationPath),
        ) !== canonicalizeJson(caseEvidence.adjudication) ||
        caseEvidence.adjudication.adjudicationId !== caseAdjudicationId
      ) {
        throw new TypeError('Adjudication artifact is missing or identity-drifted.');
      }
      coveredPaths.add(adjudicationPath);
    }
    if (canonicalizeJson([...coveredPaths].toSorted()) !== canonicalizeJson(expectedPaths)) {
      throw new TypeError('Final inventory contains unbound or incomplete case evidence.');
    }
    const core = {
      manifestVersion: 1 as const,
      runId,
      status: 'finalized' as const,
      partial: false as const,
      entries,
      inventorySha256: digestProductGateArtifactInventoryV1(entries),
      publishedLast: true as const,
    };
    const manifest = ProductGateFinalManifestV1Schema.parse({
      ...core,
      manifestSha256: digestProductGateFinalManifestCoreV1(core),
    });
    const bytes = canonicalProductGateJsonBytesV1(manifest);
    const path = resolve(runDirectory, 'manifest.json');
    const temporaryPath = resolve(runDirectory, `.manifest-${manifest.manifestSha256}.tmp`);
    assertContained(runDirectory, path);
    assertContained(runDirectory, temporaryPath);
    const handle = await open(
      temporaryPath,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await chmod(temporaryPath, 0o600);
      await link(temporaryPath, path);
      const directoryHandle = await open(runDirectory, constants.O_RDONLY);
      try {
        await directoryHandle.sync();
      } finally {
        await directoryHandle.close();
      }
    } finally {
      await unlink(temporaryPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    }
    return Object.freeze({ manifest, bytes });
  });
};

export const cleanupPartialProductGateRunV1 = async (input: {
  readonly rootDirectory: string;
  readonly runId: unknown;
}): Promise<void> => {
  const root = resolve(z.string().min(1).parse(input.rootDirectory));
  const rootMetadata = await lstat(root);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new TypeError('Partial cleanup root must be a regular non-symlink directory.');
  }
  const runDirectory = productGateRunDirectoryV1(root, input.runId);
  await withProductGateRunMutationLockV1(runDirectory, async () => {
    await assertNoSymlinkChain(root, runDirectory);
    const metadata = await lstat(runDirectory);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new TypeError('Partial cleanup target must be the exact regular run directory.');
    }
    try {
      await stat(resolve(runDirectory, 'manifest.json'));
      throw new TypeError('Finalized evidence cannot be cleaned as a partial run.');
    } catch (error) {
      if (error instanceof TypeError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
    }
    await rm(runDirectory, { recursive: true, force: false });
  });
};
