import { z } from 'zod';

export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,127}$/;
export const LOGICAL_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,79}$/;
export const WORKER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
export const PROVIDER_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
export const MODEL_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
export const ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,79}$/;
export const CURRENCY_PATTERN = /^[A-Z]{3}$/;
export const CANONICAL_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const unsafeMessagePattern = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;
const credentialLikeMessagePattern =
  /(?:\b(?:authorization|bearer|password|secret)\b|\b(?:https?|wss?):\/\/|\bsk-[A-Za-z0-9]|\bAKIA[A-Z0-9])/iu;

export const IdempotencyKeySchema = z
  .string()
  .regex(IDEMPOTENCY_KEY_PATTERN)
  .brand<'IdempotencyKey'>();
export const OutputKeySchema = z.string().regex(LOGICAL_KEY_PATTERN).brand<'OutputKey'>();
export const CallKeySchema = z.string().regex(LOGICAL_KEY_PATTERN).brand<'CallKey'>();
export const StepKeySchema = z.string().regex(LOGICAL_KEY_PATTERN).brand<'StepKey'>();
export const WorkerIdSchema = z.string().regex(WORKER_ID_PATTERN).brand<'WorkerId'>();
export const ProviderKeySchema = z.string().regex(PROVIDER_KEY_PATTERN).brand<'ProviderKey'>();
export const ModelKeySchema = z.string().regex(MODEL_KEY_PATTERN).brand<'ModelKey'>();
export const ErrorCodeSchema = z.string().regex(ERROR_CODE_PATTERN).brand<'ErrorCode'>();
export const CurrencyCodeSchema = z.string().regex(CURRENCY_PATTERN).brand<'CurrencyCode'>();
export const CanonicalUuidSchema = z
  .string()
  .regex(CANONICAL_UUID_PATTERN)
  .brand<'CanonicalUuid'>();
export const PersistedActorIdSchema = CanonicalUuidSchema.brand<'PersistedActorId'>();
export const PersistedWorkspaceIdSchema = CanonicalUuidSchema.brand<'PersistedWorkspaceId'>();
export const PersistedProjectIdSchema = CanonicalUuidSchema.brand<'PersistedProjectId'>();
export const PersistedAssetIdSchema = CanonicalUuidSchema.brand<'PersistedAssetId'>();
export const PersistedAssetVersionIdSchema = CanonicalUuidSchema.brand<'PersistedAssetVersionId'>();
export const PersistedSceneVersionIdSchema = CanonicalUuidSchema.brand<'PersistedSceneVersionId'>();
export const PersistedWorkflowVersionIdSchema =
  CanonicalUuidSchema.brand<'PersistedWorkflowVersionId'>();
export const GenerationJobIdSchema = CanonicalUuidSchema.brand<'GenerationJobId'>();
export const GenerationAttemptIdSchema = CanonicalUuidSchema.brand<'GenerationAttemptId'>();
export const GenerationOutputIdSchema = CanonicalUuidSchema.brand<'GenerationOutputId'>();
export const ProviderUsageIdSchema = CanonicalUuidSchema.brand<'ProviderUsageId'>();
export const LeaseTokenSchema = CanonicalUuidSchema.brand<'LeaseToken'>();
export const BannerOperationSchema = z.enum(['banner.analyze', 'banner.extract', 'banner.export']);

export const SafePersistedMessageSchema = z.string().superRefine((value, context) => {
  if (
    [...value].length < 1 ||
    [...value].length > 500 ||
    value.normalize('NFC') !== value ||
    value.trim() !== value ||
    unsafeMessagePattern.test(value) ||
    credentialLikeMessagePattern.test(value)
  ) {
    context.addIssue({
      code: 'custom',
      message:
        'Persisted error messages must be trimmed NFC text of 1–500 code points without unsafe controls or credential-like material.',
    });
  }
});

export type IdempotencyKey = z.infer<typeof IdempotencyKeySchema>;
export type OutputKey = z.infer<typeof OutputKeySchema>;
export type CallKey = z.infer<typeof CallKeySchema>;
export type StepKey = z.infer<typeof StepKeySchema>;
export type WorkerId = z.infer<typeof WorkerIdSchema>;
export type ProviderKey = z.infer<typeof ProviderKeySchema>;
export type ModelKey = z.infer<typeof ModelKeySchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type CurrencyCode = z.infer<typeof CurrencyCodeSchema>;
export type CanonicalUuid = z.infer<typeof CanonicalUuidSchema>;
export type PersistedActorId = z.infer<typeof PersistedActorIdSchema>;
export type PersistedWorkspaceId = z.infer<typeof PersistedWorkspaceIdSchema>;
export type PersistedProjectId = z.infer<typeof PersistedProjectIdSchema>;
export type PersistedAssetId = z.infer<typeof PersistedAssetIdSchema>;
export type PersistedAssetVersionId = z.infer<typeof PersistedAssetVersionIdSchema>;
export type PersistedSceneVersionId = z.infer<typeof PersistedSceneVersionIdSchema>;
export type PersistedWorkflowVersionId = z.infer<typeof PersistedWorkflowVersionIdSchema>;
export type GenerationJobId = z.infer<typeof GenerationJobIdSchema>;
export type GenerationAttemptId = z.infer<typeof GenerationAttemptIdSchema>;
export type GenerationOutputId = z.infer<typeof GenerationOutputIdSchema>;
export type ProviderUsageId = z.infer<typeof ProviderUsageIdSchema>;
export type LeaseToken = z.infer<typeof LeaseTokenSchema>;
export type BannerOperation = z.infer<typeof BannerOperationSchema>;
