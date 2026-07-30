import { z } from 'zod';

import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  PRODUCT_GATE_BLOCKED_HOLDOUT_V1,
  PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
  ProductGateCorpusCaseIdV1Schema,
  ProductGateCorpusManifestV1Schema,
} from './product-gate-corpus-v1.js';
import {
  ProductGateAttemptIdV1Schema,
  ProductGateCompositionProposalIdV1Schema,
  ProductGateLogicalOperationIdV1Schema,
  ProductGateProviderProvenanceV1Schema,
  ProductGateRunIdV1Schema,
} from './product-gate-segmentation-v1.js';

export const ProductGateBackgroundStrategyV1Schema = z.enum([
  'deterministic-solid-fallback',
  'reconstruction',
  'optional-later-inpainting',
  'unsupported',
  'failed',
  'not-attempted',
]);

const SolidRgbaV1Schema = z
  .tuple([
    z.int().min(0).max(255),
    z.int().min(0).max(255),
    z.int().min(0).max(255),
    z.int().min(0).max(255),
  ])
  .readonly();

const ProductGateSolidFallbackPermissionCoreV1Schema = z
  .strictObject({
    permissionVersion: z.literal(1),
    permissionKind: z.literal('explicit-case-oracle-solid-fallback'),
    corpusSplit: z.literal('holdout'),
    caseId: ProductGateCorpusCaseIdV1Schema,
    corpusManifestSha256: Sha256HexSchema,
    originalSourceSha256: Sha256HexSchema,
    normalizedSourceSha256: Sha256HexSchema,
    oracleSha256: Sha256HexSchema,
    proposalId: ProductGateCompositionProposalIdV1Schema,
    permittedSolidRgba: SolidRgbaV1Schema,
    holdoutAdmissionManifestSha256: Sha256HexSchema,
    explicitlyPermitted: z.literal(true),
  })
  .superRefine((permission, context) => {
    if (permission.corpusManifestSha256 !== permission.holdoutAdmissionManifestSha256) {
      context.addIssue({
        code: 'custom',
        message: 'Solid fallback permission must bind one admitted holdout manifest identity.',
      });
    }
  });

export const digestProductGateSolidFallbackPermissionV1 = (input: unknown): string =>
  sha256Hex(
    Buffer.from(
      canonicalizeJson(ProductGateSolidFallbackPermissionCoreV1Schema.parse(input)),
      'utf8',
    ),
  );

export const ProductGateSolidFallbackPermissionV1Schema = z
  .strictObject({
    ...ProductGateSolidFallbackPermissionCoreV1Schema.shape,
    permissionSha256: Sha256HexSchema,
  })
  .superRefine((permission, context) => {
    const { permissionSha256, ...core } = permission;
    const parsed = ProductGateSolidFallbackPermissionCoreV1Schema.safeParse(core);
    if (
      !parsed.success ||
      permissionSha256 !== digestProductGateSolidFallbackPermissionV1(parsed.data)
    ) {
      context.addIssue({ code: 'custom', message: 'Solid fallback permission identity drifted.' });
    }
  })
  .readonly();

export const ProductGateBackgroundInvocationV1Schema = z
  .strictObject({
    invocationVersion: z.literal(1),
    boundary: z.literal('evaluation-only-provider-neutral-background'),
    runId: ProductGateRunIdV1Schema,
    attemptId: ProductGateAttemptIdV1Schema,
    logicalOperationId: ProductGateLogicalOperationIdV1Schema,
    caseId: ProductGateCorpusCaseIdV1Schema,
    originalSourceSha256: Sha256HexSchema,
    sourceAssetSha256: Sha256HexSchema,
    proposalId: ProductGateCompositionProposalIdV1Schema,
    strategy: z.enum([
      'deterministic-solid-fallback',
      'reconstruction',
      'optional-later-inpainting',
    ]),
    solidFallbackPermission: ProductGateSolidFallbackPermissionV1Schema.nullable(),
    provenance: ProductGateProviderProvenanceV1Schema,
    providerCallAuthority: z.literal(false),
  })
  .superRefine((invocation, context) => {
    if (
      (invocation.strategy === 'deterministic-solid-fallback') !==
      (invocation.solidFallbackPermission !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Solid fallback invocation requires an explicit case-oracle permission only.',
      });
    }
    if (
      invocation.solidFallbackPermission !== null &&
      (invocation.solidFallbackPermission.caseId !== invocation.caseId ||
        invocation.solidFallbackPermission.originalSourceSha256 !==
          invocation.originalSourceSha256 ||
        invocation.solidFallbackPermission.normalizedSourceSha256 !==
          invocation.sourceAssetSha256 ||
        invocation.solidFallbackPermission.proposalId !== invocation.proposalId)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Solid fallback permission must bind the exact case, source, and proposal.',
      });
    }
    if (
      invocation.strategy === 'optional-later-inpainting' &&
      invocation.provenance.kind !== 'recorded-provider-projection'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Later inpainting can only be represented with recorded future provenance.',
      });
    }
  })
  .readonly();

export type ProductGateBackgroundInvocationV1 = z.infer<
  typeof ProductGateBackgroundInvocationV1Schema
>;

/**
 * Establishes executable corpus authority. Phase 3A has only the exact development manifest and
 * the exact blocked holdout, neither of which contains an affirmative solid-fallback oracle field.
 */
export const validateProductGateBackgroundInvocationForCurrentCorpusV1 = (input: {
  readonly invocation: unknown;
  readonly corpusManifest: unknown;
}): ProductGateBackgroundInvocationV1 => {
  const invocation = ProductGateBackgroundInvocationV1Schema.parse(input.invocation);
  const corpus = ProductGateCorpusManifestV1Schema.parse(input.corpusManifest);
  if (canonicalizeJson(corpus) === canonicalizeJson(PRODUCT_GATE_BLOCKED_HOLDOUT_V1)) {
    throw new TypeError('Blocked holdout grants no background execution authority.');
  }
  if (canonicalizeJson(corpus) !== canonicalizeJson(PRODUCT_GATE_DEVELOPMENT_CORPUS_V1)) {
    throw new TypeError('Unknown corpus authority projection is rejected.');
  }
  const entry = PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.entries.find(
    (candidate) => candidate.caseId === invocation.caseId,
  );
  if (
    entry === undefined ||
    invocation.originalSourceSha256 !== entry.original.sha256 ||
    invocation.sourceAssetSha256 !== entry.normalized.sha256
  ) {
    throw new TypeError(
      'Background invocation must bind the exact development case and source identities.',
    );
  }
  if (invocation.strategy === 'deterministic-solid-fallback') {
    throw new TypeError(
      'Solid fallback is not authorized: no admitted case oracle grants it in Phase 3A.',
    );
  }
  return invocation;
};

export const ProductGateBackgroundIdV1Schema = z
  .string()
  .regex(/^pge_background_v1_[0-9a-f]{64}$/u)
  .brand<'ProductGateBackgroundIdV1'>();

const ProductGateBackgroundResultCoreV1Schema = z
  .strictObject({
    resultVersion: z.literal(1),
    boundary: z.literal('evaluation-only-provider-neutral-background'),
    runId: ProductGateRunIdV1Schema,
    attemptId: ProductGateAttemptIdV1Schema,
    logicalOperationId: ProductGateLogicalOperationIdV1Schema,
    caseId: ProductGateCorpusCaseIdV1Schema,
    originalSourceSha256: Sha256HexSchema,
    sourceAssetSha256: Sha256HexSchema,
    proposalId: ProductGateCompositionProposalIdV1Schema,
    strategy: ProductGateBackgroundStrategyV1Schema,
    disposition: z.enum(['succeeded', 'unsupported', 'failed', 'not-attempted']),
    artifactSha256: Sha256HexSchema.nullable(),
    solidRgba: SolidRgbaV1Schema.nullable(),
    solidFallbackPermission: ProductGateSolidFallbackPermissionV1Schema.nullable(),
    usable: z.boolean(),
    failureIdentity: Sha256HexSchema.nullable(),
    provenance: ProductGateProviderProvenanceV1Schema,
    providerCallAuthority: z.literal(false),
  })
  .superRefine((result, context) => {
    const solid = result.strategy === 'deterministic-solid-fallback';
    const reconstruction = result.strategy === 'reconstruction';
    const optionalInpainting = result.strategy === 'optional-later-inpainting';
    if (
      solid &&
      (result.disposition !== 'succeeded' ||
        !result.usable ||
        result.solidRgba === null ||
        result.solidFallbackPermission === null ||
        canonicalizeJson(result.solidRgba) !==
          canonicalizeJson(result.solidFallbackPermission.permittedSolidRgba) ||
        result.artifactSha256 === null ||
        result.failureIdentity !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Solid fallback must be successful, usable, artifact-bound, and oracle-permitted.',
      });
    }
    if (
      reconstruction &&
      (result.disposition !== 'succeeded' ||
        result.artifactSha256 === null ||
        result.solidRgba !== null ||
        result.solidFallbackPermission !== null ||
        result.failureIdentity !== null)
    ) {
      context.addIssue({ code: 'custom', message: 'Reconstruction result fields disagree.' });
    }
    if (
      optionalInpainting &&
      (result.disposition !== 'not-attempted' ||
        result.usable ||
        result.artifactSha256 !== null ||
        result.solidRgba !== null ||
        result.solidFallbackPermission !== null ||
        result.failureIdentity !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Phase 3A optional inpainting must remain explicitly not attempted.',
      });
    }
    if (
      result.strategy === 'unsupported' &&
      (result.disposition !== 'unsupported' ||
        result.usable ||
        result.artifactSha256 !== null ||
        result.failureIdentity !== null)
    ) {
      context.addIssue({ code: 'custom', message: 'Unsupported background fields disagree.' });
    }
    if (
      result.strategy === 'failed' &&
      (result.disposition !== 'failed' ||
        result.usable ||
        result.artifactSha256 !== null ||
        result.failureIdentity === null)
    ) {
      context.addIssue({ code: 'custom', message: 'Failed background fields disagree.' });
    }
    if (
      result.strategy === 'not-attempted' &&
      (result.disposition !== 'not-attempted' ||
        result.usable ||
        result.artifactSha256 !== null ||
        result.failureIdentity !== null)
    ) {
      context.addIssue({ code: 'custom', message: 'Not-attempted background fields disagree.' });
    }
    if (!solid && (result.solidRgba !== null || result.solidFallbackPermission !== null)) {
      context.addIssue({
        code: 'custom',
        message: 'Only deterministic solid fallback may carry solid permission fields.',
      });
    }
  });

const backgroundIdentityForCore = (core: unknown) =>
  ProductGateBackgroundIdV1Schema.parse(
    `pge_background_v1_${sha256Hex(Buffer.from(canonicalizeJson(core), 'utf8'))}`,
  );

export const ProductGateBackgroundResultV1Schema = z
  .strictObject({
    backgroundId: ProductGateBackgroundIdV1Schema,
    ...ProductGateBackgroundResultCoreV1Schema.shape,
  })
  .superRefine((result, context) => {
    const { backgroundId, ...core } = result;
    const parsed = ProductGateBackgroundResultCoreV1Schema.safeParse(core);
    if (!parsed.success || backgroundId !== backgroundIdentityForCore(parsed.data)) {
      context.addIssue({ code: 'custom', message: 'Background result identity drifted.' });
    }
  })
  .readonly();

export type ProductGateBackgroundResultV1 = z.infer<typeof ProductGateBackgroundResultV1Schema>;

export const createProductGateBackgroundResultV1 = (
  input: z.input<typeof ProductGateBackgroundResultCoreV1Schema>,
): ProductGateBackgroundResultV1 => {
  const core = ProductGateBackgroundResultCoreV1Schema.parse(input);
  return ProductGateBackgroundResultV1Schema.parse({
    backgroundId: backgroundIdentityForCore(core),
    ...core,
  });
};

export const validateProductGateBackgroundInvocationResultForCurrentCorpusV1 = (input: {
  readonly invocation: unknown;
  readonly result: unknown;
  readonly corpusManifest: unknown;
}): ProductGateBackgroundResultV1 => {
  const invocation = validateProductGateBackgroundInvocationForCurrentCorpusV1({
    invocation: input.invocation,
    corpusManifest: input.corpusManifest,
  });
  const result = ProductGateBackgroundResultV1Schema.parse(input.result);
  if (
    result.runId !== invocation.runId ||
    result.attemptId !== invocation.attemptId ||
    result.logicalOperationId !== invocation.logicalOperationId ||
    result.caseId !== invocation.caseId ||
    result.originalSourceSha256 !== invocation.originalSourceSha256 ||
    result.sourceAssetSha256 !== invocation.sourceAssetSha256 ||
    result.proposalId !== invocation.proposalId ||
    result.strategy !== invocation.strategy ||
    canonicalizeJson(result.provenance) !== canonicalizeJson(invocation.provenance) ||
    result.providerCallAuthority !== invocation.providerCallAuthority
  ) {
    throw new TypeError(
      'Background result must exactly bind its validated invocation, source, and provenance.',
    );
  }
  return result;
};
