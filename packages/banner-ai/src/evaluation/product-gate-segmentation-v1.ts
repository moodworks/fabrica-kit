import { z } from 'zod';

import { validateExtractedLayerResultV1 } from '../ports/banner-capability-ports.js';
import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  CompositionAnalysisResultV1Schema,
  CompositionPartV1Schema,
  validateCompositionAnalysisResultV1,
} from '../workflows/composition-contracts.js';

const contentIdSchema = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[0-9a-f]{64}$`, 'u'));

export const ProductGateEvaluationStageV1Schema = z.enum([
  'intake',
  'vision',
  'segmentation',
  'cutout',
  'background',
  'scene',
  'preset',
  'preview',
  'export',
  'authoritative-validation',
  'recovery',
]);

export const ProductGateRunIdV1Schema = contentIdSchema('pge_run_v1').brand<'ProductGateRunIdV1'>();
export const ProductGateAttemptIdV1Schema =
  contentIdSchema('pge_attempt_v1').brand<'ProductGateAttemptIdV1'>();
export const ProductGateLogicalOperationIdV1Schema =
  contentIdSchema('pge_operation_v1').brand<'ProductGateLogicalOperationIdV1'>();
export const ProductGateArtifactIdV1Schema =
  contentIdSchema('pge_artifact_v1').brand<'ProductGateArtifactIdV1'>();
export const ProductGateReviewRecordIdV1Schema =
  contentIdSchema('pge_review_v1').brand<'ProductGateReviewRecordIdV1'>();
export const ProductGateAdjudicationIdV1Schema =
  contentIdSchema('pge_adjudication_v1').brand<'ProductGateAdjudicationIdV1'>();

export const digestProductGateStableIdentityV1 = <T extends z.ZodType<string>>(
  prefix: string,
  schema: T,
  input: unknown,
): z.infer<T> =>
  schema.parse(`${prefix}_${sha256Hex(Buffer.from(canonicalizeJson(input), 'utf8'))}`);

const stableIdentity = digestProductGateStableIdentityV1;

export const createProductGateRunIdV1 = (input: unknown) =>
  stableIdentity('pge_run_v1', ProductGateRunIdV1Schema, input);

export const createProductGateLogicalOperationIdV1 = (input: unknown) =>
  stableIdentity('pge_operation_v1', ProductGateLogicalOperationIdV1Schema, input);

export const createProductGateReviewRecordIdV1 = (input: unknown) =>
  stableIdentity('pge_review_v1', ProductGateReviewRecordIdV1Schema, input);

export const createProductGateAdjudicationIdV1 = (input: unknown) =>
  stableIdentity('pge_adjudication_v1', ProductGateAdjudicationIdV1Schema, input);

export const ProductGateProviderProvenanceV1Schema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('provider-free-deterministic-fake'),
      providerIdentity: z.literal('not-applicable'),
      modelIdentity: z.literal('deterministic-product-gate-fake-v1'),
      checkpointIdentity: z.literal('not-applicable'),
      imageIdentity: z.literal('not-applicable'),
      external: z.literal(false),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('recorded-provider-projection'),
      provider: z
        .strictObject({
          key: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,63}$/u),
          identitySha256: Sha256HexSchema,
        })
        .readonly(),
      model: z
        .strictObject({
          key: z.string().regex(/^[a-z0-9][a-z0-9._-]{1,127}$/u),
          identitySha256: Sha256HexSchema,
        })
        .readonly(),
      checkpoint: z.discriminatedUnion('status', [
        z.strictObject({ status: z.literal('not-applicable') }).readonly(),
        z
          .strictObject({
            status: z.literal('recorded'),
            identitySha256: Sha256HexSchema,
          })
          .readonly(),
      ]),
      image: z.discriminatedUnion('status', [
        z.strictObject({ status: z.literal('not-applicable') }).readonly(),
        z
          .strictObject({
            status: z.literal('recorded'),
            identitySha256: Sha256HexSchema,
          })
          .readonly(),
      ]),
      external: z.literal(true),
    })
    .readonly(),
]);

export const PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1 =
  ProductGateProviderProvenanceV1Schema.parse({
    kind: 'provider-free-deterministic-fake',
    providerIdentity: 'not-applicable',
    modelIdentity: 'deterministic-product-gate-fake-v1',
    checkpointIdentity: 'not-applicable',
    imageIdentity: 'not-applicable',
    external: false,
  });

export const ProductGateCompositionProposalIdV1Schema =
  contentIdSchema('pge_proposal_v1').brand<'ProductGateCompositionProposalIdV1'>();
export const ProductGateSemanticElementIdV1Schema =
  contentIdSchema('pge_element_v1').brand<'ProductGateSemanticElementIdV1'>();
export const ProductGateSegmentationCandidateIdV1Schema =
  contentIdSchema('pge_candidate_v1').brand<'ProductGateSegmentationCandidateIdV1'>();
export const ProductGateMaskIdV1Schema =
  contentIdSchema('pge_mask_v1').brand<'ProductGateMaskIdV1'>();
export const ProductGateCutoutIdV1Schema =
  contentIdSchema('pge_cutout_v1').brand<'ProductGateCutoutIdV1'>();
export const ProductGateSegmentationInvocationIdV1Schema = contentIdSchema(
  'pge_segmentation_invocation_v1',
).brand<'ProductGateSegmentationInvocationIdV1'>();

const proposalIdentityInput = (sourceAssetSha256: string, compositionResult: unknown) => ({
  contractVersion: 1,
  sourceAssetSha256,
  compositionResult,
});

export const createProductGateCompositionProposalIdV1 = (input: {
  readonly sourceAssetSha256: string;
  readonly compositionResult: unknown;
}) =>
  stableIdentity(
    'pge_proposal_v1',
    ProductGateCompositionProposalIdV1Schema,
    proposalIdentityInput(input.sourceAssetSha256, input.compositionResult),
  );

const semanticElementIdentityInput = (input: {
  readonly proposalId: string;
  readonly part: unknown;
}) => ({ contractVersion: 1, proposalId: input.proposalId, part: input.part });

export const createProductGateSemanticElementIdV1 = (input: {
  readonly proposalId: string;
  readonly part: unknown;
}) =>
  stableIdentity(
    'pge_element_v1',
    ProductGateSemanticElementIdV1Schema,
    semanticElementIdentityInput(input),
  );

export const ProductGateSemanticElementV1Schema = z
  .strictObject({
    semanticElementId: ProductGateSemanticElementIdV1Schema,
    proposalId: ProductGateCompositionProposalIdV1Schema,
    part: CompositionPartV1Schema,
    critical: z.boolean(),
  })
  .superRefine((element, context) => {
    if (
      element.semanticElementId !==
      createProductGateSemanticElementIdV1({
        proposalId: element.proposalId,
        part: element.part,
      })
    ) {
      context.addIssue({ code: 'custom', message: 'Semantic element identity drifted.' });
    }
  })
  .readonly();

export const ProductGateCompositionProposalV1Schema = z
  .strictObject({
    contractVersion: z.literal(1),
    proposalId: ProductGateCompositionProposalIdV1Schema,
    sourceAssetSha256: Sha256HexSchema,
    compositionResult: CompositionAnalysisResultV1Schema,
    elements: z.array(ProductGateSemanticElementV1Schema).min(1).max(5).readonly(),
  })
  .superRefine((proposal, context) => {
    if (proposal.compositionResult.kind !== 'composition_proposal') {
      context.addIssue({
        code: 'custom',
        message: 'Segmentation requires a useful composition proposal.',
      });
      return;
    }
    const expectedProposalId = createProductGateCompositionProposalIdV1({
      sourceAssetSha256: proposal.sourceAssetSha256,
      compositionResult: proposal.compositionResult,
    });
    const partKeys = proposal.elements.map((element) => element.part.partKey);
    if (
      proposal.compositionResult.sourceAssetSha256 !== proposal.sourceAssetSha256 ||
      proposal.proposalId !== expectedProposalId ||
      new Set(partKeys).size !== partKeys.length ||
      canonicalizeJson(proposal.compositionResult.parts) !==
        canonicalizeJson(proposal.elements.map((element) => element.part)) ||
      proposal.elements.some((element) => element.proposalId !== proposal.proposalId)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Composition proposal source, identity, parts, or element ownership drifted.',
      });
    }
  })
  .readonly();

export type ProductGateCompositionProposalV1 = z.infer<
  typeof ProductGateCompositionProposalV1Schema
>;

export const createProductGateCompositionProposalV1 = (input: {
  readonly request: {
    readonly sourceAsset: { readonly sha256: string };
    readonly maxParts: number;
    readonly includeBackground: boolean;
  };
  readonly result: unknown;
  readonly criticalPartKeys: readonly string[];
}): ProductGateCompositionProposalV1 => {
  const compositionResult = validateCompositionAnalysisResultV1({
    request: input.request,
    result: input.result,
  });
  if (compositionResult.kind !== 'composition_proposal') {
    throw new TypeError('A no-useful-layers result cannot become a segmentation proposal.');
  }
  const criticalPartKeys = z.array(z.string()).parse(input.criticalPartKeys);
  if (
    new Set(criticalPartKeys).size !== criticalPartKeys.length ||
    criticalPartKeys.some(
      (partKey) => !compositionResult.parts.some((part) => part.partKey === partKey),
    )
  ) {
    throw new TypeError('Critical part keys must be a unique subset of the composition proposal.');
  }
  const proposalId = createProductGateCompositionProposalIdV1({
    sourceAssetSha256: compositionResult.sourceAssetSha256,
    compositionResult,
  });
  return ProductGateCompositionProposalV1Schema.parse({
    contractVersion: 1,
    proposalId,
    sourceAssetSha256: compositionResult.sourceAssetSha256,
    compositionResult,
    elements: compositionResult.parts.map((part) => ({
      semanticElementId: createProductGateSemanticElementIdV1({ proposalId, part }),
      proposalId,
      part,
      critical: criticalPartKeys.includes(part.partKey),
    })),
  });
};

const ProductGateSegmentationInvocationCoreV1Schema = z
  .strictObject({
    invocationVersion: z.literal(1),
    boundary: z.literal('evaluation-only-provider-neutral-segmentation'),
    runId: ProductGateRunIdV1Schema,
    attemptId: ProductGateAttemptIdV1Schema,
    logicalOperationId: ProductGateLogicalOperationIdV1Schema,
    sourceAssetSha256: Sha256HexSchema,
    proposal: ProductGateCompositionProposalV1Schema,
    provenance: ProductGateProviderProvenanceV1Schema,
    providerCallAuthority: z.literal(false),
  })
  .superRefine((invocation, context) => {
    if (invocation.sourceAssetSha256 !== invocation.proposal.sourceAssetSha256) {
      context.addIssue({ code: 'custom', message: 'Invocation source and proposal disagree.' });
    }
  });

export const createProductGateSegmentationInvocationIdV1 = (input: unknown) =>
  stableIdentity(
    'pge_segmentation_invocation_v1',
    ProductGateSegmentationInvocationIdV1Schema,
    ProductGateSegmentationInvocationCoreV1Schema.parse(input),
  );

export const ProductGateSegmentationInvocationV1Schema = z
  .strictObject({
    invocationId: ProductGateSegmentationInvocationIdV1Schema,
    ...ProductGateSegmentationInvocationCoreV1Schema.shape,
  })
  .superRefine((invocation, context) => {
    const { invocationId, ...core } = invocation;
    const parsed = ProductGateSegmentationInvocationCoreV1Schema.safeParse(core);
    if (
      !parsed.success ||
      invocationId !== createProductGateSegmentationInvocationIdV1(parsed.data)
    ) {
      context.addIssue({ code: 'custom', message: 'Segmentation invocation identity drifted.' });
    }
  })
  .readonly();

const CandidateDispositionV1Schema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('primary') }).readonly(),
  z.strictObject({ kind: z.literal('fragment'), fragmentGroupId: Sha256HexSchema }).readonly(),
  z
    .strictObject({
      kind: z.literal('duplicate'),
      duplicateOfCandidateId: ProductGateSegmentationCandidateIdV1Schema,
    })
    .readonly(),
  z.strictObject({ kind: z.literal('ambiguous-proposal-ownership') }).readonly(),
]);

const SegmentationCandidateCoreV1Schema = z.strictObject({
  proposalId: ProductGateCompositionProposalIdV1Schema,
  semanticElementId: ProductGateSemanticElementIdV1Schema,
  candidateOrdinal: z.int().min(1).max(32),
  disposition: CandidateDispositionV1Schema,
});

export const createProductGateSegmentationCandidateIdV1 = (input: unknown) => {
  const core = SegmentationCandidateCoreV1Schema.parse(input);
  return stableIdentity('pge_candidate_v1', ProductGateSegmentationCandidateIdV1Schema, core);
};

export const ProductGateSegmentationCandidateV1Schema = z
  .strictObject({
    candidateId: ProductGateSegmentationCandidateIdV1Schema,
    ...SegmentationCandidateCoreV1Schema.shape,
  })
  .superRefine((candidate, context) => {
    const { candidateId, ...core } = candidate;
    if (candidateId !== createProductGateSegmentationCandidateIdV1(core)) {
      context.addIssue({ code: 'custom', message: 'Segmentation candidate identity drifted.' });
    }
    if (
      candidate.disposition.kind === 'duplicate' &&
      candidate.disposition.duplicateOfCandidateId === candidate.candidateId
    ) {
      context.addIssue({ code: 'custom', message: 'Candidate cannot duplicate itself.' });
    }
  })
  .readonly();

const MaskCoreV1Schema = z.strictObject({
  candidateId: ProductGateSegmentationCandidateIdV1Schema,
  sourceAssetSha256: Sha256HexSchema,
  pixelWidth: z.int().min(1).max(4_096),
  pixelHeight: z.int().min(1).max(4_096),
  alphaSha256: Sha256HexSchema,
});

export const createProductGateMaskIdV1 = (input: unknown) => {
  const core = MaskCoreV1Schema.parse(input);
  return stableIdentity('pge_mask_v1', ProductGateMaskIdV1Schema, core);
};

export const ProductGateMaskV1Schema = z
  .strictObject({ maskId: ProductGateMaskIdV1Schema, ...MaskCoreV1Schema.shape })
  .superRefine((mask, context) => {
    const { maskId, ...core } = mask;
    if (maskId !== createProductGateMaskIdV1(core)) {
      context.addIssue({ code: 'custom', message: 'Mask identity drifted.' });
    }
  })
  .readonly();

const CutoutCoreV1Schema = z.strictObject({
  maskId: ProductGateMaskIdV1Schema,
  mediaType: z.literal('image/png'),
  byteSize: z.int().min(1).max(20_971_520),
  pixelWidth: z.int().min(1).max(4_096),
  pixelHeight: z.int().min(1).max(4_096),
  sha256: Sha256HexSchema,
});

export const createProductGateCutoutIdV1 = (input: unknown) => {
  const core = CutoutCoreV1Schema.parse(input);
  return stableIdentity('pge_cutout_v1', ProductGateCutoutIdV1Schema, core);
};

export const ProductGateMaterializedCutoutV1Schema = z
  .strictObject({ cutoutId: ProductGateCutoutIdV1Schema, ...CutoutCoreV1Schema.shape })
  .superRefine((cutout, context) => {
    const { cutoutId, ...core } = cutout;
    if (cutoutId !== createProductGateCutoutIdV1(core)) {
      context.addIssue({ code: 'custom', message: 'Materialized cutout identity drifted.' });
    }
  })
  .readonly();

export type ProductGateMaterializedCutoutV1 = z.infer<typeof ProductGateMaterializedCutoutV1Schema>;

export const validateProductGateMaterializedCutoutV1 = async (input: {
  readonly cutout: unknown;
  readonly bytes: Uint8Array;
}): Promise<ProductGateMaterializedCutoutV1> => {
  const cutout = ProductGateMaterializedCutoutV1Schema.parse(input.cutout);
  await validateExtractedLayerResultV1({
    bytes: input.bytes,
    mediaType: cutout.mediaType,
    byteSize: cutout.byteSize,
    pixelWidth: cutout.pixelWidth,
    pixelHeight: cutout.pixelHeight,
    sha256: cutout.sha256,
  });
  return cutout;
};

export const ProductGateSegmentationAssociationV1Schema = z
  .strictObject({
    proposalId: ProductGateCompositionProposalIdV1Schema,
    semanticElementId: ProductGateSemanticElementIdV1Schema,
    candidateId: ProductGateSegmentationCandidateIdV1Schema,
    maskId: ProductGateMaskIdV1Schema,
    cutoutId: ProductGateCutoutIdV1Schema,
  })
  .readonly();

export const ProductGateSegmentationResultV1Schema = z
  .strictObject({
    resultVersion: z.literal(1),
    boundary: z.literal('evaluation-only-provider-neutral-segmentation'),
    invocationId: ProductGateSegmentationInvocationIdV1Schema,
    runId: ProductGateRunIdV1Schema,
    attemptId: ProductGateAttemptIdV1Schema,
    logicalOperationId: ProductGateLogicalOperationIdV1Schema,
    sourceAssetSha256: Sha256HexSchema,
    proposalId: ProductGateCompositionProposalIdV1Schema,
    proposal: ProductGateCompositionProposalV1Schema,
    semanticElements: z.array(ProductGateSemanticElementV1Schema).min(1).max(5).readonly(),
    candidates: z.array(ProductGateSegmentationCandidateV1Schema).min(1).max(32).readonly(),
    masks: z.array(ProductGateMaskV1Schema).min(1).max(32).readonly(),
    cutouts: z.array(ProductGateMaterializedCutoutV1Schema).min(1).max(32).readonly(),
    associations: z.array(ProductGateSegmentationAssociationV1Schema).min(1).max(32).readonly(),
    provenance: ProductGateProviderProvenanceV1Schema,
    providerCallAuthority: z.literal(false),
  })
  .superRefine((result, context) => {
    const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;
    const elementById = new Map(
      result.semanticElements.map((element) => [element.semanticElementId, element]),
    );
    const candidateById = new Map(
      result.candidates.map((candidate) => [candidate.candidateId, candidate]),
    );
    const maskById = new Map(result.masks.map((mask) => [mask.maskId, mask]));
    const cutoutById = new Map(result.cutouts.map((cutout) => [cutout.cutoutId, cutout]));
    const associationKeys = result.associations.map((association) => canonicalizeJson(association));
    if (
      !unique(result.semanticElements.map((element) => element.semanticElementId)) ||
      !unique(result.candidates.map((candidate) => candidate.candidateId)) ||
      !unique(result.masks.map((mask) => mask.maskId)) ||
      !unique(result.cutouts.map((cutout) => cutout.cutoutId)) ||
      !unique(associationKeys)
    ) {
      context.addIssue({ code: 'custom', message: 'Segmentation identities must be unique.' });
    }
    if (
      result.proposal.proposalId !== result.proposalId ||
      result.proposal.sourceAssetSha256 !== result.sourceAssetSha256 ||
      canonicalizeJson(result.proposal.elements) !== canonicalizeJson(result.semanticElements) ||
      result.semanticElements.some((element) => element.proposalId !== result.proposalId) ||
      result.candidates.some(
        (candidate) =>
          candidate.proposalId !== result.proposalId ||
          !elementById.has(candidate.semanticElementId) ||
          candidate.disposition.kind !== 'primary',
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Ambiguous, duplicate, fragment, orphan, or foreign candidates are rejected.',
      });
    }
    const elementIds = result.semanticElements
      .map((element) => element.semanticElementId)
      .toSorted();
    const candidateElementIds = result.candidates
      .map((candidate) => candidate.semanticElementId)
      .toSorted();
    if (canonicalizeJson(elementIds) !== canonicalizeJson(candidateElementIds)) {
      context.addIssue({
        code: 'custom',
        message: 'Every proposal element requires exactly one accepted segmentation candidate.',
      });
    }
    const candidateMaskCounts = new Map<string, number>();
    const maskCutoutCounts = new Map<string, number>();
    const associationCandidateCounts = new Map<string, number>();
    for (const mask of result.masks) {
      candidateMaskCounts.set(
        mask.candidateId,
        (candidateMaskCounts.get(mask.candidateId) ?? 0) + 1,
      );
      if (
        !candidateById.has(mask.candidateId) ||
        mask.sourceAssetSha256 !== result.sourceAssetSha256
      ) {
        context.addIssue({ code: 'custom', message: 'Orphan or foreign mask is rejected.' });
      }
    }
    for (const cutout of result.cutouts) {
      maskCutoutCounts.set(cutout.maskId, (maskCutoutCounts.get(cutout.maskId) ?? 0) + 1);
      if (!maskById.has(cutout.maskId)) {
        context.addIssue({ code: 'custom', message: 'Orphan cutout is rejected.' });
      }
    }
    for (const association of result.associations) {
      const candidate = candidateById.get(association.candidateId);
      const mask = maskById.get(association.maskId);
      const cutout = cutoutById.get(association.cutoutId);
      associationCandidateCounts.set(
        association.candidateId,
        (associationCandidateCounts.get(association.candidateId) ?? 0) + 1,
      );
      if (
        association.proposalId !== result.proposalId ||
        candidate === undefined ||
        mask === undefined ||
        cutout === undefined ||
        candidate.semanticElementId !== association.semanticElementId ||
        mask.candidateId !== association.candidateId ||
        cutout.maskId !== association.maskId
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Segmentation association is ambiguous, orphaned, or incorrectly bound.',
        });
      }
    }
    if (
      result.candidates.length !== result.masks.length ||
      result.masks.length !== result.cutouts.length ||
      result.cutouts.length !== result.associations.length ||
      result.candidates.some(
        (candidate) =>
          candidateMaskCounts.get(candidate.candidateId) !== 1 ||
          associationCandidateCounts.get(candidate.candidateId) !== 1,
      ) ||
      result.masks.some((mask) => maskCutoutCounts.get(mask.maskId) !== 1)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Every candidate, mask, cutout, and association must form one exact chain.',
      });
    }
  })
  .readonly();

export type ProductGateSegmentationResultV1 = z.infer<typeof ProductGateSegmentationResultV1Schema>;

export const validateProductGateSegmentationInvocationResultV1 = (input: {
  readonly invocation: unknown;
  readonly result: unknown;
}): ProductGateSegmentationResultV1 => {
  const invocation = ProductGateSegmentationInvocationV1Schema.parse(input.invocation);
  const result = ProductGateSegmentationResultV1Schema.parse(input.result);
  if (
    result.invocationId !== invocation.invocationId ||
    result.runId !== invocation.runId ||
    result.attemptId !== invocation.attemptId ||
    result.logicalOperationId !== invocation.logicalOperationId ||
    result.sourceAssetSha256 !== invocation.sourceAssetSha256 ||
    result.proposalId !== invocation.proposal.proposalId ||
    canonicalizeJson(result.proposal) !== canonicalizeJson(invocation.proposal) ||
    canonicalizeJson(result.semanticElements) !== canonicalizeJson(invocation.proposal.elements) ||
    canonicalizeJson(result.provenance) !== canonicalizeJson(invocation.provenance) ||
    result.providerCallAuthority !== invocation.providerCallAuthority
  ) {
    throw new TypeError(
      'Segmentation result must exactly bind its invocation, proposal, elements, and provenance.',
    );
  }
  return result;
};

export const ProductGateSegmentationPreparationResultV1Schema = z
  .strictObject({
    resultVersion: z.literal(1),
    boundary: z.literal('evaluation-only-provider-neutral-segmentation-preparation'),
    invocation: ProductGateSegmentationInvocationV1Schema,
    candidates: z.array(ProductGateSegmentationCandidateV1Schema).min(1).max(32).readonly(),
    masks: z.array(ProductGateMaskV1Schema).min(1).max(32).readonly(),
  })
  .superRefine((result, context) => {
    const elements = new Map(
      result.invocation.proposal.elements.map((element) => [element.semanticElementId, element]),
    );
    const candidates = new Map(
      result.candidates.map((candidate) => [candidate.candidateId, candidate]),
    );
    if (
      result.candidates.length !== elements.size ||
      result.masks.length !== result.candidates.length ||
      new Set(result.candidates.map((candidate) => candidate.candidateId)).size !==
        result.candidates.length ||
      new Set(result.masks.map((mask) => mask.maskId)).size !== result.masks.length ||
      result.candidates.some(
        (candidate) =>
          candidate.proposalId !== result.invocation.proposal.proposalId ||
          candidate.disposition.kind !== 'primary' ||
          !elements.has(candidate.semanticElementId),
      ) ||
      result.masks.some(
        (mask) =>
          !candidates.has(mask.candidateId) ||
          mask.sourceAssetSha256 !== result.invocation.sourceAssetSha256,
      ) ||
      result.candidates.some(
        (candidate) =>
          result.masks.filter((mask) => mask.candidateId === candidate.candidateId).length !== 1,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Segmentation preparation must bind one primary candidate and mask per element.',
      });
    }
  })
  .readonly();

export const ProductGateCutoutStageResultV1Schema = z
  .strictObject({
    resultVersion: z.literal(1),
    boundary: z.literal('evaluation-only-provider-neutral-cutout'),
    runId: ProductGateRunIdV1Schema,
    attemptId: ProductGateAttemptIdV1Schema,
    logicalOperationId: ProductGateLogicalOperationIdV1Schema,
    segmentationInvocation: ProductGateSegmentationInvocationV1Schema,
    segmentationResult: ProductGateSegmentationResultV1Schema,
    provenance: ProductGateProviderProvenanceV1Schema,
    providerCallAuthority: z.literal(false),
  })
  .superRefine((result, context) => {
    let invocationPairValid = true;
    try {
      validateProductGateSegmentationInvocationResultV1({
        invocation: result.segmentationInvocation,
        result: result.segmentationResult,
      });
    } catch {
      invocationPairValid = false;
    }
    if (
      !invocationPairValid ||
      result.runId !== result.segmentationInvocation.runId ||
      result.attemptId === result.segmentationInvocation.attemptId ||
      result.logicalOperationId === result.segmentationInvocation.logicalOperationId ||
      canonicalizeJson(result.provenance) !==
        canonicalizeJson(result.segmentationInvocation.provenance) ||
      result.providerCallAuthority !== result.segmentationInvocation.providerCallAuthority
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Cutout stage must bind its own attempt to one exact prior segmentation invocation and result.',
      });
    }
  })
  .readonly();
