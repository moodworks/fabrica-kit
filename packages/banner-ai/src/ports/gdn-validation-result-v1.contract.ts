import { z } from 'zod';

import { ErrorCodeSchema, SafePersistedMessageSchema } from '../jobs/syntax.js';
import { Sha256HexSchema, ValidatorProfileRefV1Schema } from '../scene/banner-scene-v1.schema.js';

export const GdnValidationFindingSchema = z
  .strictObject({
    ruleCode: ErrorCodeSchema,
    severity: z.enum(['error', 'warning']),
    message: SafePersistedMessageSchema,
    entryPath: z
      .string()
      .min(1)
      .max(240)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/)
      .nullable(),
  })
  .readonly();

export const GdnValidationResultSchema = z
  .strictObject({
    validationLabel: z.literal('internal-provider-free-not-gdn'),
    artifactSha256: Sha256HexSchema,
    profile: ValidatorProfileRefV1Schema,
    outcome: z.enum(['internal-check-passed', 'internal-check-failed']),
    findings: z.array(GdnValidationFindingSchema).max(256).readonly(),
  })
  .superRefine((result, context) => {
    const hasErrors = result.findings.some((finding) => finding.severity === 'error');
    if ((result.outcome === 'internal-check-failed') !== hasErrors) {
      context.addIssue({
        code: 'custom',
        message: 'Internal validator outcome must match the presence of error findings.',
      });
    }
  })
  .readonly();

export type GdnValidationResult = z.infer<typeof GdnValidationResultSchema>;
