import { z } from 'zod';

import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
  ProductGateCorpusCaseIdV1Schema,
} from './product-gate-corpus-v1.js';

const canonicalSha256 = (input: unknown): string =>
  sha256Hex(Buffer.from(canonicalizeJson(input), 'utf8'));

const developmentArtifactSha256s = new Set(
  PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.entries.flatMap((entry) => [
    entry.original.sha256,
    entry.normalized.sha256,
  ]),
);

export const ProductGateCanonicalUtcTimestampV2Schema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u)
  .refine((value) => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
  }, 'Timestamp must be a real canonical UTC instant with millisecond precision.');

const OpaqueKeyV2Schema = z.string().regex(/^[a-z0-9][a-z0-9._-]{1,127}$/u);

export const ProductGateCaseIdV2Schema = z
  .string()
  .regex(/^pge_holdout_case_v2_[0-9a-f]{64}$/u)
  .brand<'ProductGateCaseIdV2'>();

export const ProductGateProposalIdV2Schema = z
  .string()
  .regex(/^pge_proposal_v2_[0-9a-f]{64}$/u)
  .brand<'ProductGateProposalIdV2'>();

export const ProductGateOracleLayerIdV2Schema = z
  .string()
  .regex(/^pge_oracle_layer_v2_[0-9a-f]{64}$/u)
  .brand<'ProductGateOracleLayerIdV2'>();

export const ProductGateContentFamilyIdV2Schema = z.enum([
  'subject-product-led',
  'text-heavy',
  'layered-graphic-no-text',
]);

export const ProductGateDifficultyV2Schema = z.enum(['easy', 'moderate', 'hard']);

export const PRODUCT_GATE_DIFFICULTY_ANCHORS_V2 = Object.freeze({
  easy: 'opaque-high-contrast-clean-separation-little-overlap-no-fine-or-translucent-edges',
  moderate: 'partial-overlap-shadows-thin-components-moderate-texture-or-edge-ambiguity',
  hard: 'hair-fur-translucency-reflections-fine-strokes-touching-occlusion-or-high-similarity',
} as const);

export const ProductGateDifficultyAnchorV2Schema = z.enum([
  PRODUCT_GATE_DIFFICULTY_ANCHORS_V2.easy,
  PRODUCT_GATE_DIFFICULTY_ANCHORS_V2.moderate,
  PRODUCT_GATE_DIFFICULTY_ANCHORS_V2.hard,
]);

export const ProductGatePrimaryStratumV2Schema = z.enum([
  'subject-product-led:easy',
  'subject-product-led:moderate',
  'subject-product-led:hard',
  'text-heavy:easy',
  'text-heavy:moderate',
  'text-heavy:hard',
  'layered-graphic-no-text:easy',
  'layered-graphic-no-text:moderate',
  'layered-graphic-no-text:hard',
]);

export const ProductGateContentFamilyV2Schema = z.discriminatedUnion('family', [
  z
    .strictObject({
      family: z.literal('subject-product-led'),
      leadKind: z.enum(['person', 'product']),
      visibleText: z.literal('light-to-moderate-copy'),
      textHeavy: z.literal(false),
    })
    .readonly(),
  z
    .strictObject({
      family: z.literal('text-heavy'),
      visibleText: z.literal('text-heavy-copy'),
      textHeavy: z.literal(true),
    })
    .readonly(),
  z
    .strictObject({
      family: z.literal('layered-graphic-no-text'),
      visibleText: z.literal('none'),
      textHeavy: z.literal(false),
    })
    .readonly(),
]);

export const ProductGateBackgroundModeV2Schema = z.enum([
  'exact-solid-eligible',
  'reconstruction-required',
]);

export const ProductGateSourceIdentityV2Schema = z
  .strictObject({
    identityVersion: z.literal(2),
    sha256: Sha256HexSchema,
    mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    byteSize: z.int().min(1).max(52_428_800),
    pixelWidth: z.int().min(1).max(16_384),
    pixelHeight: z.int().min(1).max(16_384),
  })
  .superRefine((source, context) => {
    if (source.pixelWidth * source.pixelHeight > 67_108_864) {
      context.addIssue({
        code: 'custom',
        message: 'Source pixel count exceeds its metadata bound.',
      });
    }
  })
  .readonly();

export const ProductGateNormalizationIdentityV2Schema = z
  .strictObject({
    identityVersion: z.literal(2),
    sourceSha256: Sha256HexSchema,
    normalizedArtifactSha256: Sha256HexSchema,
    normalizedPixelSha256: Sha256HexSchema,
    normalizationSpecificationSha256: Sha256HexSchema,
    mediaType: z.literal('image/png'),
    pixelWidth: z.int().min(1).max(16_384),
    pixelHeight: z.int().min(1).max(16_384),
  })
  .readonly();

const ProductGateAcquisitionBasisV2Schema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('owned-source') }).readonly(),
  z
    .strictObject({
      kind: z.literal('public-domain-or-cc0'),
      classification: z.enum(['public-domain', 'cc0']),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('qualifying-license'),
      licenseReference: OpaqueKeyV2Schema,
    })
    .readonly(),
]);

export const ProductGateSourceProvenanceV2Schema = z
  .strictObject({
    provenanceVersion: z.literal(2),
    sourceSha256: Sha256HexSchema,
    opaqueSourceReference: OpaqueKeyV2Schema,
    acquisitionBasis: ProductGateAcquisitionBasisV2Schema,
    acquiredAt: ProductGateCanonicalUtcTimestampV2Schema,
    acquisitionEvidenceSha256: Sha256HexSchema,
    provenanceEvidenceSha256: Sha256HexSchema,
  })
  .readonly();

const ProductGateRightsBasisV2Schema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('ownership'),
      ownershipStatus: z.literal('confirmed'),
      evidenceSha256: Sha256HexSchema,
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('public-domain-or-cc0'),
      classification: z.enum(['public-domain', 'cc0']),
      evidenceSha256: Sha256HexSchema,
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('qualifying-license'),
      licenseReference: OpaqueKeyV2Schema,
      qualifyingLicenseStatus: z.literal('confirmed'),
      evidenceSha256: Sha256HexSchema,
    })
    .readonly(),
]);

const ProductGateRelevantRightsStatusV2Schema = z.enum(['not-present', 'cleared']);

export const ProductGateRightsReviewV2Schema = z
  .strictObject({
    rightsVersion: z.literal(2),
    sourceSha256: Sha256HexSchema,
    basis: ProductGateRightsBasisV2Schema,
    permissions: z
      .strictObject({
        commercialEvaluation: z.literal('permitted'),
        derivativeCutouts: z.literal('permitted'),
        backgroundReconstruction: z.literal('permitted'),
        providerTransmission: z.literal('permitted-subject-to-separate-specific-approval'),
      })
      .readonly(),
    relevantRights: z
      .strictObject({
        likeness: ProductGateRelevantRightsStatusV2Schema,
        trademark: ProductGateRelevantRightsStatusV2Schema,
        logo: ProductGateRelevantRightsStatusV2Schema,
        watermark: ProductGateRelevantRightsStatusV2Schema,
        label: ProductGateRelevantRightsStatusV2Schema,
        visibleText: ProductGateRelevantRightsStatusV2Schema,
      })
      .readonly(),
    rightsEvidenceSha256: Sha256HexSchema,
  })
  .readonly();

export const ProductGateMetadataPrivacyReviewV2Schema = z
  .strictObject({
    reviewVersion: z.literal(2),
    sourceSha256: Sha256HexSchema,
    metadataReview: z.literal('completed'),
    privacyReview: z.literal('completed'),
    personalData: z.literal('reviewed-and-cleared'),
    credentials: z.literal('confirmed-absent'),
    secrets: z.literal('confirmed-absent'),
    undisclosedClientMaterial: z.literal('confirmed-absent'),
    prohibitedSensitiveData: z.literal('confirmed-absent'),
    trackingMaterial: z.literal('confirmed-absent'),
    reviewEvidenceSha256: Sha256HexSchema,
  })
  .readonly();

export const ProductGateNearDuplicateCandidateV2Schema = z
  .strictObject({
    candidateVersion: z.literal(2),
    comparisonScope: z.enum(['holdout', 'development-corpus']),
    opaqueComparisonIdentitySha256: Sha256HexSchema,
    candidateReason: z.enum([
      'crop',
      'resize',
      're-encoding',
      'recolor',
      'copy-only-variant',
      'same-template-creative',
      'other-perceptual-similarity',
    ]),
    perceptualEvidenceSha256: Sha256HexSchema,
  })
  .readonly();

const ProductGateNearDuplicateHumanReviewV2Schema = z
  .strictObject({
    status: z.literal('completed'),
    reviewerRole: z.enum(['duplicate-reviewer', 'corpus-admission-reviewer']),
    reviewerIdentitySha256: Sha256HexSchema,
    reviewedCaseId: ProductGateCaseIdV2Schema,
    reviewedCandidateSetSha256: Sha256HexSchema,
    reviewedAt: ProductGateCanonicalUtcTimestampV2Schema,
    reviewEvidenceSha256: Sha256HexSchema,
    materialNearDuplicate: z.boolean(),
  })
  .readonly();

export const ProductGateDuplicateDispositionV2Schema = z
  .strictObject({
    dispositionVersion: z.literal(2),
    caseId: ProductGateCaseIdV2Schema,
    sourceSha256: Sha256HexSchema,
    normalizedArtifactSha256: Sha256HexSchema,
    normalizedPixelSha256: Sha256HexSchema,
    developmentCorpusManifestSha256: z.literal(PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.manifestSha256),
    exactByteComparison: z
      .strictObject({
        withinHoldout: z.enum(['no-match', 'match']),
        againstDevelopmentCorpus: z.enum(['no-match', 'match']),
      })
      .readonly(),
    normalizedPixelComparison: z
      .strictObject({
        withinHoldout: z.enum(['no-match', 'match']),
        againstDevelopmentCorpus: z.enum(['no-match', 'match']),
      })
      .readonly(),
    perceptualCandidates: z.array(ProductGateNearDuplicateCandidateV2Schema).max(128).readonly(),
    perceptualMethodsEstablishAdmissionTruth: z.literal(false),
    perceptualComparisonImplementedByThisContract: z.literal(false),
    humanReview: ProductGateNearDuplicateHumanReviewV2Schema,
    disposition: z.enum(['admissible', 'rejected-replacement-required']),
    replacementRequired: z.boolean(),
    dispositionEvidenceSha256: Sha256HexSchema,
  })
  .superRefine((record, context) => {
    const exactMatch = Object.values(record.exactByteComparison).includes('match');
    const pixelMatch = Object.values(record.normalizedPixelComparison).includes('match');
    const materialNearDuplicate = record.humanReview.materialNearDuplicate;
    const rejected = exactMatch || pixelMatch || materialNearDuplicate;
    if (
      record.disposition !== (rejected ? 'rejected-replacement-required' : 'admissible') ||
      record.replacementRequired !== rejected
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Duplicate rejection must require replacement and cannot remain admissible.',
      });
    }
    const candidateKeys = record.perceptualCandidates.map(
      (candidate) => `${candidate.comparisonScope}\0${candidate.opaqueComparisonIdentitySha256}`,
    );
    if (new Set(candidateKeys).size !== candidateKeys.length) {
      context.addIssue({ code: 'custom', message: 'Near-duplicate candidates must be unique.' });
    }
    if (
      record.humanReview.reviewedCaseId !== record.caseId ||
      record.humanReview.reviewedCandidateSetSha256 !== canonicalSha256(record.perceptualCandidates)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Near-duplicate human review must bind the case and exact candidate set.',
      });
    }
  })
  .readonly();

export const ProductGateAdmissionAttestationV2Schema = z
  .strictObject({
    attestationVersion: z.literal(2),
    recordScope: z.enum(['admission-record', 'deterministic-structural-fake']),
    reviewerRole: z.enum(['rights-reviewer', 'privacy-reviewer', 'corpus-admission-reviewer']),
    attestedAt: ProductGateCanonicalUtcTimestampV2Schema,
    expiresAt: ProductGateCanonicalUtcTimestampV2Schema.nullable(),
    approvalStatus: z.enum(['approved', 'rejected']),
    evidenceDigestSha256: Sha256HexSchema,
    conflictDeclaration: z.enum(['none', 'declared-and-resolved']),
  })
  .superRefine((attestation, context) => {
    if (
      attestation.expiresAt !== null &&
      Date.parse(attestation.attestedAt) >= Date.parse(attestation.expiresAt)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Attestation expiry must be later than its attestation instant.',
      });
    }
  })
  .readonly();

export const ProductGateTransmissionApprovalV2Schema = z
  .strictObject({
    approvalVersion: z.literal(2),
    recordScope: z.enum(['admission-record', 'deterministic-structural-fake']),
    status: z.literal('explicit-approval-recorded'),
    caseId: ProductGateCaseIdV2Schema,
    originalSourceSha256: Sha256HexSchema,
    normalizedSourceSha256: Sha256HexSchema,
    provider: z
      .strictObject({ key: OpaqueKeyV2Schema, identitySha256: Sha256HexSchema })
      .readonly(),
    model: z.strictObject({ key: OpaqueKeyV2Schema, identitySha256: Sha256HexSchema }).readonly(),
    endpoint: z
      .strictObject({
        key: OpaqueKeyV2Schema,
        identitySha256: Sha256HexSchema,
        method: z.enum(['POST', 'PUT']),
      })
      .readonly(),
    purpose: z.literal('commercial-product-gate-evaluation-only'),
    approvedAt: ProductGateCanonicalUtcTimestampV2Schema,
    expiresAt: ProductGateCanonicalUtcTimestampV2Schema.nullable(),
    approvalEvidenceSha256: Sha256HexSchema,
  })
  .superRefine((approval, context) => {
    if (
      approval.expiresAt !== null &&
      Date.parse(approval.approvedAt) >= Date.parse(approval.expiresAt)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Transmission approval expiry must be later than its approval instant.',
      });
    }
  })
  .readonly();

const ProductGateOracleBoundingBoxV2Schema = z
  .strictObject({
    unit: z.literal('normalized-basis-points'),
    xBps: z.int().min(0).max(10_000),
    yBps: z.int().min(0).max(10_000),
    widthBps: z.int().min(1).max(10_000),
    heightBps: z.int().min(1).max(10_000),
  })
  .superRefine((box, context) => {
    if (box.xBps + box.widthBps > 10_000 || box.yBps + box.heightBps > 10_000) {
      context.addIssue({ code: 'custom', message: 'Oracle box must remain inside the canvas.' });
    }
  })
  .readonly();

export const ProductGateOracleLayerV2Schema = z
  .strictObject({
    oracleLayerId: ProductGateOracleLayerIdV2Schema,
    approvedName: z.string().trim().min(1).max(160),
    semanticRole: z.enum(['background', 'subject', 'product', 'foreground', 'decoration', 'text']),
    required: z.literal(true),
    critical: z.boolean(),
    groupKey: OpaqueKeyV2Schema,
    boundingBox: ProductGateOracleBoundingBoxV2Schema,
  })
  .readonly();

const ExactRgbaV2Schema = z
  .tuple([
    z.int().min(0).max(255),
    z.int().min(0).max(255),
    z.int().min(0).max(255),
    z.int().min(0).max(255),
  ])
  .readonly();

export const ProductGateExactSolidOracleAuthorizationV2Schema = z
  .strictObject({
    authorizationVersion: z.literal(2),
    kind: z.literal('exact-rgba-solid-fallback-authorization'),
    corpusIdentitySha256: Sha256HexSchema,
    caseId: ProductGateCaseIdV2Schema,
    originalSourceSha256: Sha256HexSchema,
    normalizedSourceSha256: Sha256HexSchema,
    normalizedPixelSha256: Sha256HexSchema,
    oracleSha256: Sha256HexSchema,
    proposalId: ProductGateProposalIdV2Schema,
    exactRgba: ExactRgbaV2Schema,
    authorizationEvidenceSha256: Sha256HexSchema,
    authorized: z.literal(true),
  })
  .readonly();

const ProductGateReconstructionBackgroundRequirementV2Schema = z
  .strictObject({
    mode: z.literal('reconstruction-required'),
    solidFallbackAuthorized: z.literal(false),
    exactSolidAuthorization: z.null(),
  })
  .readonly();

const ProductGateExactSolidBackgroundRequirementV2Schema = z
  .strictObject({
    mode: z.literal('exact-solid-eligible'),
    solidFallbackAuthorized: z.literal(true),
    exactSolidAuthorization: ProductGateExactSolidOracleAuthorizationV2Schema,
  })
  .readonly();

export const ProductGateBackgroundRequirementV2Schema = z.discriminatedUnion('mode', [
  ProductGateExactSolidBackgroundRequirementV2Schema,
  ProductGateReconstructionBackgroundRequirementV2Schema,
]);

export const ProductGateCaseOracleV2Schema = z
  .strictObject({
    oracleVersion: z.literal(2),
    oracleSha256: Sha256HexSchema,
    oracleEvidenceSha256: Sha256HexSchema,
    corpusIdentitySha256: Sha256HexSchema,
    caseId: ProductGateCaseIdV2Schema,
    originalSourceSha256: Sha256HexSchema,
    normalizedSourceSha256: Sha256HexSchema,
    normalizedPixelSha256: Sha256HexSchema,
    proposalId: ProductGateProposalIdV2Schema,
    requiredLayers: z.array(ProductGateOracleLayerV2Schema).min(1).max(64).readonly(),
    requiredLayerIds: z.array(ProductGateOracleLayerIdV2Schema).min(1).max(64).readonly(),
    allowedGroupingKeys: z.array(OpaqueKeyV2Schema).min(1).max(64).readonly(),
    extraLayersAllowed: z.literal(false),
    backgroundRequirement: ProductGateBackgroundRequirementV2Schema,
  })
  .superRefine((oracle, context) => {
    const layerIds = oracle.requiredLayers.map((layer) => layer.oracleLayerId);
    const groupingKeys = oracle.requiredLayers.map((layer) => layer.groupKey).toSorted();
    if (
      new Set(layerIds).size !== layerIds.length ||
      canonicalizeJson(layerIds) !== canonicalizeJson(oracle.requiredLayerIds)
    ) {
      context.addIssue({ code: 'custom', message: 'Oracle required-layer identities drifted.' });
    }
    if (
      new Set(oracle.allowedGroupingKeys).size !== oracle.allowedGroupingKeys.length ||
      canonicalizeJson([...new Set(groupingKeys)]) !==
        canonicalizeJson([...oracle.allowedGroupingKeys].toSorted())
    ) {
      context.addIssue({ code: 'custom', message: 'Oracle grouping identities drifted.' });
    }
    if (!oracle.requiredLayers.some((layer) => layer.critical)) {
      context.addIssue({ code: 'custom', message: 'Oracle requires at least one critical layer.' });
    }
    const authorization = oracle.backgroundRequirement.exactSolidAuthorization;
    if (
      authorization !== null &&
      (authorization.corpusIdentitySha256 !== oracle.corpusIdentitySha256 ||
        authorization.caseId !== oracle.caseId ||
        authorization.originalSourceSha256 !== oracle.originalSourceSha256 ||
        authorization.normalizedSourceSha256 !== oracle.normalizedSourceSha256 ||
        authorization.normalizedPixelSha256 !== oracle.normalizedPixelSha256 ||
        authorization.oracleSha256 !== oracle.oracleSha256 ||
        authorization.proposalId !== oracle.proposalId)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Exact solid authorization must bind the exact corpus, case, sources, oracle, and proposal.',
      });
    }
  })
  .readonly();

const ProductGateCaseAdmissionBindingCoreV2Schema = z.strictObject({
  bindingVersion: z.literal(2),
  bindingContractIdentity: z.literal('banner-ai-product-gate-case-admission-v2'),
  corpusIdentitySha256: Sha256HexSchema,
  caseId: ProductGateCaseIdV2Schema,
  originalSourceSha256: Sha256HexSchema,
  normalizedSourceSha256: Sha256HexSchema,
  normalizedPixelSha256: Sha256HexSchema,
  oracleSha256: Sha256HexSchema,
  proposalId: ProductGateProposalIdV2Schema,
  classificationRecordSha256: Sha256HexSchema,
  sourceIdentityRecordSha256: Sha256HexSchema,
  normalizationIdentityRecordSha256: Sha256HexSchema,
  oracleRecordSha256: Sha256HexSchema,
  sourceProvenanceRecordSha256: Sha256HexSchema,
  rightsRecordSha256: Sha256HexSchema,
  metadataPrivacyRecordSha256: Sha256HexSchema,
  duplicateDispositionRecordSha256: Sha256HexSchema,
  attestationRecordSha256: Sha256HexSchema,
  transmissionApprovalRecordSha256: Sha256HexSchema,
});

export const digestProductGateCaseAdmissionBindingV2 = (input: unknown): string =>
  canonicalSha256(ProductGateCaseAdmissionBindingCoreV2Schema.parse(input));

export const ProductGateCaseAdmissionBindingV2Schema = z
  .strictObject({
    ...ProductGateCaseAdmissionBindingCoreV2Schema.shape,
    bindingSha256: Sha256HexSchema,
  })
  .superRefine((binding, context) => {
    const { bindingSha256, ...core } = binding;
    if (bindingSha256 !== digestProductGateCaseAdmissionBindingV2(core)) {
      context.addIssue({ code: 'custom', message: 'Case admission evidence binding drifted.' });
    }
  })
  .readonly();

const ProductGateCaseEvidenceForBindingV2Schema = z.strictObject({
  corpusIdentitySha256: Sha256HexSchema,
  caseId: ProductGateCaseIdV2Schema,
  contentFamily: ProductGateContentFamilyV2Schema,
  difficulty: ProductGateDifficultyV2Schema,
  difficultyAnchor: ProductGateDifficultyAnchorV2Schema,
  primaryStratum: ProductGatePrimaryStratumV2Schema,
  backgroundMode: ProductGateBackgroundModeV2Schema,
  source: ProductGateSourceIdentityV2Schema,
  normalization: ProductGateNormalizationIdentityV2Schema,
  sourceProvenance: ProductGateSourceProvenanceV2Schema,
  rights: ProductGateRightsReviewV2Schema,
  metadataPrivacyReview: ProductGateMetadataPrivacyReviewV2Schema,
  duplicateDisposition: ProductGateDuplicateDispositionV2Schema,
  oracle: ProductGateCaseOracleV2Schema,
  attestation: ProductGateAdmissionAttestationV2Schema,
  transmissionApproval: ProductGateTransmissionApprovalV2Schema,
});

export const createProductGateCaseAdmissionBindingV2 = (
  input: z.input<typeof ProductGateCaseEvidenceForBindingV2Schema>,
): z.infer<typeof ProductGateCaseAdmissionBindingV2Schema> => {
  const evidence = ProductGateCaseEvidenceForBindingV2Schema.parse(input);
  const core = ProductGateCaseAdmissionBindingCoreV2Schema.parse({
    bindingVersion: 2,
    bindingContractIdentity: 'banner-ai-product-gate-case-admission-v2',
    corpusIdentitySha256: evidence.corpusIdentitySha256,
    caseId: evidence.caseId,
    originalSourceSha256: evidence.source.sha256,
    normalizedSourceSha256: evidence.normalization.normalizedArtifactSha256,
    normalizedPixelSha256: evidence.normalization.normalizedPixelSha256,
    oracleSha256: evidence.oracle.oracleSha256,
    proposalId: evidence.oracle.proposalId,
    classificationRecordSha256: canonicalSha256({
      contentFamily: evidence.contentFamily,
      difficulty: evidence.difficulty,
      difficultyAnchor: evidence.difficultyAnchor,
      primaryStratum: evidence.primaryStratum,
      backgroundMode: evidence.backgroundMode,
    }),
    sourceIdentityRecordSha256: canonicalSha256(evidence.source),
    normalizationIdentityRecordSha256: canonicalSha256(evidence.normalization),
    oracleRecordSha256: canonicalSha256(evidence.oracle),
    sourceProvenanceRecordSha256: canonicalSha256(evidence.sourceProvenance),
    rightsRecordSha256: canonicalSha256(evidence.rights),
    metadataPrivacyRecordSha256: canonicalSha256(evidence.metadataPrivacyReview),
    duplicateDispositionRecordSha256: canonicalSha256(evidence.duplicateDisposition),
    attestationRecordSha256: canonicalSha256(evidence.attestation),
    transmissionApprovalRecordSha256: canonicalSha256(evidence.transmissionApproval),
  });
  return ProductGateCaseAdmissionBindingV2Schema.parse({
    ...core,
    bindingSha256: digestProductGateCaseAdmissionBindingV2(core),
  });
};

export const ProductGateHoldoutCaseV2Schema = z
  .strictObject({
    caseContractVersion: z.literal(2),
    evidenceScope: z.enum(['admission-record', 'deterministic-structural-fake']),
    caseId: ProductGateCaseIdV2Schema,
    corpusIdentitySha256: Sha256HexSchema,
    contentFamily: ProductGateContentFamilyV2Schema,
    difficulty: ProductGateDifficultyV2Schema,
    difficultyAnchor: ProductGateDifficultyAnchorV2Schema,
    primaryStratum: ProductGatePrimaryStratumV2Schema,
    backgroundMode: ProductGateBackgroundModeV2Schema,
    source: ProductGateSourceIdentityV2Schema,
    normalization: ProductGateNormalizationIdentityV2Schema,
    sourceProvenance: ProductGateSourceProvenanceV2Schema,
    rights: ProductGateRightsReviewV2Schema,
    metadataPrivacyReview: ProductGateMetadataPrivacyReviewV2Schema,
    duplicateDisposition: ProductGateDuplicateDispositionV2Schema,
    oracle: ProductGateCaseOracleV2Schema,
    attestation: ProductGateAdmissionAttestationV2Schema,
    transmissionApproval: ProductGateTransmissionApprovalV2Schema,
    admissionBinding: ProductGateCaseAdmissionBindingV2Schema,
    developmentFixture: z.literal(false),
    actualAssetPresent: z.literal(false),
    sourceBytesAccessible: z.literal(false),
    holdoutAccessAuthority: z.literal(false),
    providerCallAuthority: z.literal(false),
    realEvaluationAuthority: z.literal(false),
  })
  .superRefine((entry, context) => {
    const expectedStratum = `${entry.contentFamily.family}:${entry.difficulty}`;
    if (entry.primaryStratum !== expectedStratum) {
      context.addIssue({
        code: 'custom',
        message: 'Primary stratum must derive from family and difficulty.',
      });
    }
    if (entry.difficultyAnchor !== PRODUCT_GATE_DIFFICULTY_ANCHORS_V2[entry.difficulty]) {
      context.addIssue({ code: 'custom', message: 'Difficulty anchor drifted.' });
    }
    if (ProductGateCorpusCaseIdV1Schema.options.some((caseId) => caseId === entry.caseId)) {
      context.addIssue({
        code: 'custom',
        message: 'Development fixture IDs cannot enter the holdout.',
      });
    }
    if (
      entry.normalization.sourceSha256 !== entry.source.sha256 ||
      entry.sourceProvenance.sourceSha256 !== entry.source.sha256 ||
      entry.rights.sourceSha256 !== entry.source.sha256 ||
      entry.metadataPrivacyReview.sourceSha256 !== entry.source.sha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Source, normalization, provenance, rights, or privacy identity drifted.',
      });
    }
    if (
      entry.duplicateDisposition.caseId !== entry.caseId ||
      entry.duplicateDisposition.sourceSha256 !== entry.source.sha256 ||
      entry.duplicateDisposition.normalizedArtifactSha256 !==
        entry.normalization.normalizedArtifactSha256 ||
      entry.duplicateDisposition.normalizedPixelSha256 !== entry.normalization.normalizedPixelSha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Duplicate disposition must bind the exact case and source identities.',
      });
    }
    if (
      developmentArtifactSha256s.has(entry.source.sha256) ||
      developmentArtifactSha256s.has(entry.normalization.normalizedArtifactSha256)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Committed development-corpus byte artifacts cannot enter the holdout.',
      });
    }
    const provenanceBasis = entry.sourceProvenance.acquisitionBasis;
    const rightsBasis = entry.rights.basis;
    const basisMatches =
      (provenanceBasis.kind === 'owned-source' && rightsBasis.kind === 'ownership') ||
      (provenanceBasis.kind === 'public-domain-or-cc0' &&
        rightsBasis.kind === 'public-domain-or-cc0' &&
        provenanceBasis.classification === rightsBasis.classification) ||
      (provenanceBasis.kind === 'qualifying-license' &&
        rightsBasis.kind === 'qualifying-license' &&
        provenanceBasis.licenseReference === rightsBasis.licenseReference);
    if (!basisMatches) {
      context.addIssue({
        code: 'custom',
        message: 'Acquisition provenance and qualifying rights basis disagree.',
      });
    }
    if (
      entry.contentFamily.family === 'layered-graphic-no-text' &&
      entry.rights.relevantRights.visibleText !== 'not-present'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'No-text cases must record visible text as absent.',
      });
    }
    if (
      entry.contentFamily.family !== 'layered-graphic-no-text' &&
      entry.rights.relevantRights.visibleText !== 'cleared'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Copy-bearing cases require cleared visible-text rights.',
      });
    }
    if (
      entry.contentFamily.family === 'subject-product-led' &&
      entry.contentFamily.leadKind === 'person' &&
      entry.rights.relevantRights.likeness !== 'cleared'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Person-led cases require cleared likeness rights.',
      });
    }
    const semanticRoles = new Set(entry.oracle.requiredLayers.map((layer) => layer.semanticRole));
    const familySemanticsValid =
      entry.contentFamily.family === 'subject-product-led'
        ? semanticRoles.has(entry.contentFamily.leadKind === 'person' ? 'subject' : 'product') &&
          semanticRoles.has('text')
        : entry.contentFamily.family === 'text-heavy'
          ? semanticRoles.has('text')
          : !semanticRoles.has('text') &&
            !semanticRoles.has('subject') &&
            !semanticRoles.has('product');
    if (!familySemanticsValid) {
      context.addIssue({
        code: 'custom',
        message: 'Content family must agree with the authoritative oracle semantic roles.',
      });
    }
    if (
      entry.oracle.corpusIdentitySha256 !== entry.corpusIdentitySha256 ||
      entry.oracle.caseId !== entry.caseId ||
      entry.oracle.originalSourceSha256 !== entry.source.sha256 ||
      entry.oracle.normalizedSourceSha256 !== entry.normalization.normalizedArtifactSha256 ||
      entry.oracle.normalizedPixelSha256 !== entry.normalization.normalizedPixelSha256 ||
      entry.oracle.backgroundRequirement.mode !== entry.backgroundMode
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Case oracle identity or background mode drifted.',
      });
    }
    if (
      entry.transmissionApproval.caseId !== entry.caseId ||
      entry.transmissionApproval.originalSourceSha256 !== entry.source.sha256 ||
      entry.transmissionApproval.normalizedSourceSha256 !==
        entry.normalization.normalizedArtifactSha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Transmission approval must bind the exact case and sources.',
      });
    }
    if (
      entry.attestation.recordScope !== entry.evidenceScope ||
      entry.transmissionApproval.recordScope !== entry.evidenceScope ||
      entry.attestation.approvalStatus !== 'approved'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Admitted case metadata requires one approved scope-bound attestation.',
      });
    }
    const acquiredAt = Date.parse(entry.sourceProvenance.acquiredAt);
    if (
      acquiredAt > Date.parse(entry.duplicateDisposition.humanReview.reviewedAt) ||
      acquiredAt > Date.parse(entry.attestation.attestedAt) ||
      acquiredAt > Date.parse(entry.transmissionApproval.approvedAt)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Acquisition must precede duplicate review, attestation, and transmission approval.',
      });
    }
    if (
      entry.duplicateDisposition.disposition !== 'admissible' ||
      entry.duplicateDisposition.replacementRequired
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Rejected duplicate cases must be replaced before entering the final 18.',
      });
    }
    let expectedBinding: z.infer<typeof ProductGateCaseAdmissionBindingV2Schema> | null = null;
    try {
      expectedBinding = createProductGateCaseAdmissionBindingV2({
        corpusIdentitySha256: entry.corpusIdentitySha256,
        caseId: entry.caseId,
        contentFamily: entry.contentFamily,
        difficulty: entry.difficulty,
        difficultyAnchor: entry.difficultyAnchor,
        primaryStratum: entry.primaryStratum,
        backgroundMode: entry.backgroundMode,
        source: entry.source,
        normalization: entry.normalization,
        sourceProvenance: entry.sourceProvenance,
        rights: entry.rights,
        metadataPrivacyReview: entry.metadataPrivacyReview,
        duplicateDisposition: entry.duplicateDisposition,
        oracle: entry.oracle,
        attestation: entry.attestation,
        transmissionApproval: entry.transmissionApproval,
      });
    } catch {
      context.addIssue({ code: 'custom', message: 'Case admission evidence cannot be bound.' });
    }
    if (
      expectedBinding !== null &&
      canonicalizeJson(expectedBinding) !== canonicalizeJson(entry.admissionBinding)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Case admission binding does not cover the exact metadata records.',
      });
    }
  })
  .readonly();

export type ProductGateHoldoutCaseV2 = z.infer<typeof ProductGateHoldoutCaseV2Schema>;

const corpusIdentityFromCases = (cases: readonly ProductGateHoldoutCaseV2[]): string =>
  canonicalSha256({
    identityVersion: 2,
    identityContract: 'banner-ai-product-gate-holdout-corpus-content-v2',
    cases: cases.map((entry) => ({
      caseId: entry.caseId,
      classification: {
        contentFamily: entry.contentFamily,
        difficulty: entry.difficulty,
        difficultyAnchor: entry.difficultyAnchor,
        primaryStratum: entry.primaryStratum,
        backgroundMode: entry.backgroundMode,
      },
      source: entry.source,
      normalization: entry.normalization,
      oracle: {
        oracleSha256: entry.oracle.oracleSha256,
        oracleEvidenceSha256: entry.oracle.oracleEvidenceSha256,
        proposalId: entry.oracle.proposalId,
        requiredLayers: entry.oracle.requiredLayers,
        requiredLayerIds: entry.oracle.requiredLayerIds,
        allowedGroupingKeys: entry.oracle.allowedGroupingKeys,
        extraLayersAllowed: entry.oracle.extraLayersAllowed,
        backgroundRequirement:
          entry.oracle.backgroundRequirement.mode === 'reconstruction-required'
            ? entry.oracle.backgroundRequirement
            : {
                mode: entry.oracle.backgroundRequirement.mode,
                solidFallbackAuthorized: entry.oracle.backgroundRequirement.solidFallbackAuthorized,
                exactRgba: entry.oracle.backgroundRequirement.exactSolidAuthorization.exactRgba,
                authorizationEvidenceSha256:
                  entry.oracle.backgroundRequirement.exactSolidAuthorization
                    .authorizationEvidenceSha256,
                authorized: entry.oracle.backgroundRequirement.exactSolidAuthorization.authorized,
              },
      },
    })),
  });

export const deriveProductGateHoldoutCorpusIdentityV2 = (input: unknown): string =>
  corpusIdentityFromCases(z.array(ProductGateHoldoutCaseV2Schema).length(18).parse(input));

const ProductGateHoldoutCorpusCoreV2Schema = z
  .strictObject({
    manifestVersion: z.literal(2),
    manifestId: z.literal('banner-ai-product-gate-holdout-structure-v2'),
    corpusIdentitySha256: Sha256HexSchema,
    split: z.literal('final-holdout'),
    status: z.literal('structural-validation-only'),
    evidenceScope: z.literal('deterministic-structural-fake'),
    caseCount: z.literal(18),
    primaryStratumCount: z.literal(9),
    cases: z.array(ProductGateHoldoutCaseV2Schema).length(18).readonly(),
    developmentFixtureCountInDenominator: z.literal(0),
    actualHoldoutAssetsPresent: z.literal(false),
    holdoutAssetBytesAccessible: z.literal(false),
    holdoutAdmissionAuthority: z.literal(false),
    holdoutAccessAuthority: z.literal(false),
    providerStackFrozen: z.literal(false),
    providerTransmissionAuthority: z.literal(false),
    providerCallAuthority: z.literal(false),
    realEvaluationAuthority: z.literal(false),
    authoritativeGdnAuthority: z.literal(false),
  })
  .superRefine((manifest, context) => {
    if (manifest.corpusIdentitySha256 !== corpusIdentityFromCases(manifest.cases)) {
      context.addIssue({
        code: 'custom',
        message:
          'Corpus identity must derive from the exact case, classification, source, and oracle projection.',
      });
    }
    const caseIds = manifest.cases.map((entry) => entry.caseId);
    if (new Set(caseIds).size !== 18) {
      context.addIssue({ code: 'custom', message: 'Final holdout case IDs must be unique.' });
    }
    if (
      caseIds.some((caseId) => ProductGateCorpusCaseIdV1Schema.options.includes(caseId as never))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Development fixtures cannot enter the final denominator.',
      });
    }
    if (
      manifest.cases.some(
        (entry) =>
          entry.corpusIdentitySha256 !== manifest.corpusIdentitySha256 ||
          entry.evidenceScope !== manifest.evidenceScope,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Every case must bind the exact structural corpus identity and scope.',
      });
    }
    const sourceDigests = manifest.cases.map((entry) => entry.source.sha256);
    if (new Set(sourceDigests).size !== 18) {
      context.addIssue({ code: 'custom', message: 'Exact source byte identities must be unique.' });
    }
    const normalizedPixelDigests = manifest.cases.map(
      (entry) => entry.normalization.normalizedPixelSha256,
    );
    if (new Set(normalizedPixelDigests).size !== 18) {
      context.addIssue({ code: 'custom', message: 'Normalized pixel identities must be unique.' });
    }
    const normalizedArtifactDigests = manifest.cases.map(
      (entry) => entry.normalization.normalizedArtifactSha256,
    );
    if (new Set(normalizedArtifactDigests).size !== 18) {
      context.addIssue({
        code: 'custom',
        message: 'Normalized artifact identities must be unique.',
      });
    }
    const byteArtifactOwnerByDigest = new Map<string, string>();
    for (const entry of manifest.cases) {
      for (const digest of [entry.source.sha256, entry.normalization.normalizedArtifactSha256]) {
        const existingOwner = byteArtifactOwnerByDigest.get(digest);
        if (existingOwner !== undefined && existingOwner !== entry.caseId) {
          context.addIssue({
            code: 'custom',
            message: 'Exact byte identities must be unique across every case artifact kind.',
          });
        } else {
          byteArtifactOwnerByDigest.set(digest, entry.caseId);
        }
      }
    }
    for (const stratum of ProductGatePrimaryStratumV2Schema.options) {
      const cases = manifest.cases.filter((entry) => entry.primaryStratum === stratum);
      if (
        cases.length !== 2 ||
        cases.filter((entry) => entry.backgroundMode === 'exact-solid-eligible').length !== 1 ||
        cases.filter((entry) => entry.backgroundMode === 'reconstruction-required').length !== 1
      ) {
        context.addIssue({
          code: 'custom',
          message:
            'Every primary stratum requires exactly two cases: one solid and one reconstruction.',
          path: ['cases'],
        });
      }
    }
    for (const family of ProductGateContentFamilyIdV2Schema.options) {
      if (manifest.cases.filter((entry) => entry.contentFamily.family === family).length !== 6) {
        context.addIssue({
          code: 'custom',
          message: 'Every content family requires exactly six cases.',
        });
      }
    }
    for (const difficulty of ProductGateDifficultyV2Schema.options) {
      if (manifest.cases.filter((entry) => entry.difficulty === difficulty).length !== 6) {
        context.addIssue({
          code: 'custom',
          message: 'Every difficulty requires exactly six cases.',
        });
      }
    }
    const textHeavy = manifest.cases.filter((entry) => entry.contentFamily.textHeavy).length;
    if (textHeavy !== 6 || manifest.cases.length - textHeavy !== 12) {
      context.addIssue({
        code: 'custom',
        message: 'Corpus requires six text-heavy and twelve non-text-heavy cases.',
      });
    }
    const subjectCases = manifest.cases.filter(
      (entry) => entry.contentFamily.family === 'subject-product-led',
    );
    const personLed = subjectCases.filter(
      (entry) =>
        entry.contentFamily.family === 'subject-product-led' &&
        entry.contentFamily.leadKind === 'person',
    ).length;
    const productLed = subjectCases.filter(
      (entry) =>
        entry.contentFamily.family === 'subject-product-led' &&
        entry.contentFamily.leadKind === 'product',
    ).length;
    if (personLed !== 3 || productLed !== 3) {
      context.addIssue({
        code: 'custom',
        message:
          'Subject/product-led family requires exactly three person and three product cases.',
      });
    }
    if (
      manifest.cases.filter((entry) => entry.backgroundMode === 'exact-solid-eligible').length !==
        9 ||
      manifest.cases.filter((entry) => entry.backgroundMode === 'reconstruction-required')
        .length !== 9
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Corpus requires exactly nine solid and nine reconstruction cases.',
      });
    }
  });

export const digestProductGateHoldoutCorpusV2 = (input: unknown): string =>
  canonicalSha256(ProductGateHoldoutCorpusCoreV2Schema.parse(input));

export const ProductGateHoldoutCorpusManifestV2Schema = z
  .strictObject({
    ...ProductGateHoldoutCorpusCoreV2Schema.shape,
    manifestSha256: Sha256HexSchema,
  })
  .superRefine((manifest, context) => {
    const { manifestSha256, ...core } = manifest;
    const parsed = ProductGateHoldoutCorpusCoreV2Schema.safeParse(core);
    if (!parsed.success || manifestSha256 !== digestProductGateHoldoutCorpusV2(parsed.data)) {
      context.addIssue({
        code: 'custom',
        message: 'Holdout structural manifest canonical digest drifted.',
      });
    }
  })
  .readonly();

export type ProductGateHoldoutCorpusManifestV2 = z.infer<
  typeof ProductGateHoldoutCorpusManifestV2Schema
>;

export const canonicalProductGateHoldoutCorpusJsonV2 = (input: unknown): string =>
  canonicalizeJson(ProductGateHoldoutCorpusManifestV2Schema.parse(input));

export const canonicalProductGateHoldoutCorpusBytesV2 = (input: unknown): Uint8Array =>
  Buffer.from(canonicalProductGateHoldoutCorpusJsonV2(input), 'utf8');

const fakeHash = (kind: string, ordinal: number): string =>
  canonicalSha256({ contract: 'banner-ai-product-gate-holdout-structure-v2', kind, ordinal });

const fakeCaseId = (ordinal: number) =>
  ProductGateCaseIdV2Schema.parse(`pge_holdout_case_v2_${fakeHash('case', ordinal)}`);

const fakeProposalId = (ordinal: number) =>
  ProductGateProposalIdV2Schema.parse(`pge_proposal_v2_${fakeHash('proposal', ordinal)}`);

const fakeOracleLayerId = (ordinal: number, layer: number) =>
  ProductGateOracleLayerIdV2Schema.parse(
    `pge_oracle_layer_v2_${canonicalSha256({ kind: 'oracle-layer', ordinal, layer })}`,
  );

const makeFakeDuplicateDisposition = (input: {
  readonly ordinal: number;
  readonly caseId: z.infer<typeof ProductGateCaseIdV2Schema>;
  readonly sourceSha256: string;
  readonly normalizedArtifactSha256: string;
  readonly normalizedPixelSha256: string;
}) =>
  ProductGateDuplicateDispositionV2Schema.parse({
    caseId: input.caseId,
    sourceSha256: input.sourceSha256,
    normalizedArtifactSha256: input.normalizedArtifactSha256,
    normalizedPixelSha256: input.normalizedPixelSha256,
    developmentCorpusManifestSha256: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.manifestSha256,
    dispositionVersion: 2,
    exactByteComparison: { withinHoldout: 'no-match', againstDevelopmentCorpus: 'no-match' },
    normalizedPixelComparison: {
      withinHoldout: 'no-match',
      againstDevelopmentCorpus: 'no-match',
    },
    perceptualCandidates: [],
    perceptualMethodsEstablishAdmissionTruth: false,
    perceptualComparisonImplementedByThisContract: false,
    humanReview: {
      status: 'completed',
      reviewerRole: 'duplicate-reviewer',
      reviewerIdentitySha256: fakeHash('duplicate-reviewer', 0),
      reviewedCaseId: input.caseId,
      reviewedCandidateSetSha256: canonicalSha256([]),
      reviewedAt: '2026-01-02T00:00:00.000Z',
      reviewEvidenceSha256: fakeHash('near-duplicate-review-evidence', input.ordinal),
      materialNearDuplicate: false,
    },
    disposition: 'admissible',
    replacementRequired: false,
    dispositionEvidenceSha256: fakeHash('duplicate-disposition-evidence', input.ordinal),
  });

const fakeRightsAndProvenance = (ordinal: number) => {
  const remainder = ordinal % 3;
  if (remainder === 0) {
    return {
      acquisitionBasis: { kind: 'owned-source' } as const,
      rightsBasis: {
        kind: 'ownership' as const,
        ownershipStatus: 'confirmed' as const,
        evidenceSha256: fakeHash('ownership-evidence', ordinal),
      },
    };
  }
  if (remainder === 1) {
    return {
      acquisitionBasis: {
        kind: 'public-domain-or-cc0' as const,
        classification: 'public-domain' as const,
      },
      rightsBasis: {
        kind: 'public-domain-or-cc0' as const,
        classification: 'public-domain' as const,
        evidenceSha256: fakeHash('public-domain-evidence', ordinal),
      },
    };
  }
  return {
    acquisitionBasis: {
      kind: 'qualifying-license' as const,
      licenseReference: `license_ref_${String(ordinal).padStart(2, '0')}`,
    },
    rightsBasis: {
      kind: 'qualifying-license' as const,
      licenseReference: `license_ref_${String(ordinal).padStart(2, '0')}`,
      qualifyingLicenseStatus: 'confirmed' as const,
      evidenceSha256: fakeHash('license-evidence', ordinal),
    },
  };
};

const makeFakeCase = (input: {
  readonly ordinal: number;
  readonly corpusIdentitySha256: string;
  readonly family: z.infer<typeof ProductGateContentFamilyIdV2Schema>;
  readonly difficulty: z.infer<typeof ProductGateDifficultyV2Schema>;
  readonly withinStratumOrdinal: 0 | 1;
}): ProductGateHoldoutCaseV2 => {
  const { ordinal, corpusIdentitySha256, family, difficulty, withinStratumOrdinal } = input;
  const caseId = fakeCaseId(ordinal);
  const sourceSha256 = fakeHash('source-bytes', ordinal);
  const normalizedArtifactSha256 = fakeHash('normalized-artifact', ordinal);
  const normalizedPixelSha256 = fakeHash('normalized-pixels', ordinal);
  const proposalId = fakeProposalId(ordinal);
  const oracleSha256 = fakeHash('oracle', ordinal);
  const backgroundMode =
    withinStratumOrdinal === 0
      ? ('exact-solid-eligible' as const)
      : ('reconstruction-required' as const);
  const contentFamily =
    family === 'subject-product-led'
      ? ({
          family,
          leadKind: withinStratumOrdinal === 0 ? ('person' as const) : ('product' as const),
          visibleText: 'light-to-moderate-copy' as const,
          textHeavy: false as const,
        } as const)
      : family === 'text-heavy'
        ? ({ family, visibleText: 'text-heavy-copy' as const, textHeavy: true as const } as const)
        : ({ family, visibleText: 'none' as const, textHeavy: false as const } as const);
  const source = ProductGateSourceIdentityV2Schema.parse({
    identityVersion: 2,
    sha256: sourceSha256,
    mediaType: ordinal % 2 === 0 ? 'image/png' : 'image/jpeg',
    byteSize: 100_000 + ordinal,
    pixelWidth: 1200,
    pixelHeight: 628,
  });
  const normalization = ProductGateNormalizationIdentityV2Schema.parse({
    identityVersion: 2,
    sourceSha256,
    normalizedArtifactSha256,
    normalizedPixelSha256,
    normalizationSpecificationSha256: fakeHash('normalization-specification', 2),
    mediaType: 'image/png',
    pixelWidth: 1200,
    pixelHeight: 628,
  });
  const basis = fakeRightsAndProvenance(ordinal);
  const sourceProvenance = ProductGateSourceProvenanceV2Schema.parse({
    provenanceVersion: 2,
    sourceSha256,
    opaqueSourceReference: `source_ref_${String(ordinal).padStart(2, '0')}`,
    acquisitionBasis: basis.acquisitionBasis,
    acquiredAt: '2026-01-01T00:00:00.000Z',
    acquisitionEvidenceSha256: fakeHash('acquisition-evidence', ordinal),
    provenanceEvidenceSha256: fakeHash('provenance-evidence', ordinal),
  });
  const rights = ProductGateRightsReviewV2Schema.parse({
    rightsVersion: 2,
    sourceSha256,
    basis: basis.rightsBasis,
    permissions: {
      commercialEvaluation: 'permitted',
      derivativeCutouts: 'permitted',
      backgroundReconstruction: 'permitted',
      providerTransmission: 'permitted-subject-to-separate-specific-approval',
    },
    relevantRights: {
      likeness:
        family === 'subject-product-led' && contentFamily.leadKind === 'person'
          ? 'cleared'
          : 'not-present',
      trademark: 'not-present',
      logo: 'not-present',
      watermark: 'not-present',
      label: 'not-present',
      visibleText: family === 'layered-graphic-no-text' ? 'not-present' : 'cleared',
    },
    rightsEvidenceSha256: fakeHash('rights-evidence', ordinal),
  });
  const metadataPrivacyReview = ProductGateMetadataPrivacyReviewV2Schema.parse({
    reviewVersion: 2,
    sourceSha256,
    metadataReview: 'completed',
    privacyReview: 'completed',
    personalData: 'reviewed-and-cleared',
    credentials: 'confirmed-absent',
    secrets: 'confirmed-absent',
    undisclosedClientMaterial: 'confirmed-absent',
    prohibitedSensitiveData: 'confirmed-absent',
    trackingMaterial: 'confirmed-absent',
    reviewEvidenceSha256: fakeHash('metadata-privacy-evidence', ordinal),
  });
  const duplicateDisposition = makeFakeDuplicateDisposition({
    ordinal,
    caseId,
    sourceSha256,
    normalizedArtifactSha256,
    normalizedPixelSha256,
  });
  const requiredLayers = [0, 1, 2].map((layer) =>
    ProductGateOracleLayerV2Schema.parse({
      oracleLayerId: fakeOracleLayerId(ordinal, layer),
      approvedName:
        layer === 0 ? 'background' : layer === 1 ? 'primary subject' : 'supporting graphic',
      semanticRole:
        layer === 0
          ? 'background'
          : layer === 1
            ? family === 'layered-graphic-no-text'
              ? 'foreground'
              : family === 'subject-product-led' && contentFamily.leadKind === 'product'
                ? 'product'
                : 'subject'
            : family === 'layered-graphic-no-text'
              ? 'decoration'
              : 'text',
      required: true,
      critical: layer !== 0,
      groupKey: `group_${String(layer)}`,
      boundingBox: {
        unit: 'normalized-basis-points',
        xBps: layer * 2_000,
        yBps: layer * 1_000,
        widthBps: 4_000,
        heightBps: 3_000,
      },
    }),
  );
  const exactSolidAuthorization =
    backgroundMode === 'exact-solid-eligible'
      ? ProductGateExactSolidOracleAuthorizationV2Schema.parse({
          authorizationVersion: 2,
          kind: 'exact-rgba-solid-fallback-authorization',
          corpusIdentitySha256,
          caseId,
          originalSourceSha256: sourceSha256,
          normalizedSourceSha256: normalizedArtifactSha256,
          normalizedPixelSha256,
          oracleSha256,
          proposalId,
          exactRgba: [ordinal, ordinal, ordinal, 255],
          authorizationEvidenceSha256: fakeHash('solid-authorization-evidence', ordinal),
          authorized: true,
        })
      : null;
  const oracle = ProductGateCaseOracleV2Schema.parse({
    oracleVersion: 2,
    oracleSha256,
    oracleEvidenceSha256: fakeHash('oracle-evidence', ordinal),
    corpusIdentitySha256,
    caseId,
    originalSourceSha256: sourceSha256,
    normalizedSourceSha256: normalizedArtifactSha256,
    normalizedPixelSha256,
    proposalId,
    requiredLayers,
    requiredLayerIds: requiredLayers.map((layer) => layer.oracleLayerId),
    allowedGroupingKeys: requiredLayers.map((layer) => layer.groupKey),
    extraLayersAllowed: false,
    backgroundRequirement:
      backgroundMode === 'exact-solid-eligible'
        ? {
            mode: backgroundMode,
            solidFallbackAuthorized: true,
            exactSolidAuthorization,
          }
        : {
            mode: backgroundMode,
            solidFallbackAuthorized: false,
            exactSolidAuthorization: null,
          },
  });
  const attestation = ProductGateAdmissionAttestationV2Schema.parse({
    attestationVersion: 2,
    recordScope: 'deterministic-structural-fake',
    reviewerRole: 'corpus-admission-reviewer',
    attestedAt: '2026-01-02T00:00:00.000Z',
    expiresAt: null,
    approvalStatus: 'approved',
    evidenceDigestSha256: fakeHash('attestation-evidence', ordinal),
    conflictDeclaration: 'none',
  });
  const transmissionApproval = ProductGateTransmissionApprovalV2Schema.parse({
    approvalVersion: 2,
    recordScope: 'deterministic-structural-fake',
    status: 'explicit-approval-recorded',
    caseId,
    originalSourceSha256: sourceSha256,
    normalizedSourceSha256: normalizedArtifactSha256,
    provider: {
      key: 'structural-fake-provider',
      identitySha256: fakeHash('fake-provider', 0),
    },
    model: { key: 'structural-fake-model', identitySha256: fakeHash('fake-model', 0) },
    endpoint: {
      key: 'structural-fake-endpoint',
      identitySha256: fakeHash('fake-endpoint', 0),
      method: 'POST',
    },
    purpose: 'commercial-product-gate-evaluation-only',
    approvedAt: '2026-01-02T00:00:00.000Z',
    expiresAt: '2027-01-02T00:00:00.000Z',
    approvalEvidenceSha256: fakeHash('transmission-approval-evidence', ordinal),
  });
  const bindingInput = {
    corpusIdentitySha256,
    caseId,
    contentFamily,
    difficulty,
    difficultyAnchor: PRODUCT_GATE_DIFFICULTY_ANCHORS_V2[difficulty],
    primaryStratum: `${family}:${difficulty}` as z.infer<typeof ProductGatePrimaryStratumV2Schema>,
    backgroundMode,
    source,
    normalization,
    sourceProvenance,
    rights,
    metadataPrivacyReview,
    duplicateDisposition,
    oracle,
    attestation,
    transmissionApproval,
  };
  return ProductGateHoldoutCaseV2Schema.parse({
    caseContractVersion: 2,
    evidenceScope: 'deterministic-structural-fake',
    ...bindingInput,
    admissionBinding: createProductGateCaseAdmissionBindingV2(bindingInput),
    developmentFixture: false,
    actualAssetPresent: false,
    sourceBytesAccessible: false,
    holdoutAccessAuthority: false,
    providerCallAuthority: false,
    realEvaluationAuthority: false,
  });
};

export const createDeterministicProductGateHoldoutCorpusStructuralFakeV2 =
  (): ProductGateHoldoutCorpusManifestV2 => {
    const createCases = (corpusIdentitySha256: string): ProductGateHoldoutCaseV2[] => {
      const entries: ProductGateHoldoutCaseV2[] = [];
      let ordinal = 0;
      for (const family of ProductGateContentFamilyIdV2Schema.options) {
        for (const difficulty of ProductGateDifficultyV2Schema.options) {
          for (const withinStratumOrdinal of [0, 1] as const) {
            entries.push(
              makeFakeCase({
                ordinal,
                corpusIdentitySha256,
                family,
                difficulty,
                withinStratumOrdinal,
              }),
            );
            ordinal += 1;
          }
        }
      }
      return entries;
    };
    const provisionalCases = createCases(fakeHash('provisional-corpus-identity', 0));
    const corpusIdentitySha256 = corpusIdentityFromCases(provisionalCases);
    const cases = createCases(corpusIdentitySha256);
    const core = ProductGateHoldoutCorpusCoreV2Schema.parse({
      manifestVersion: 2,
      manifestId: 'banner-ai-product-gate-holdout-structure-v2',
      corpusIdentitySha256,
      split: 'final-holdout',
      status: 'structural-validation-only',
      evidenceScope: 'deterministic-structural-fake',
      caseCount: 18,
      primaryStratumCount: 9,
      cases,
      developmentFixtureCountInDenominator: 0,
      actualHoldoutAssetsPresent: false,
      holdoutAssetBytesAccessible: false,
      holdoutAdmissionAuthority: false,
      holdoutAccessAuthority: false,
      providerStackFrozen: false,
      providerTransmissionAuthority: false,
      providerCallAuthority: false,
      realEvaluationAuthority: false,
      authoritativeGdnAuthority: false,
    });
    return ProductGateHoldoutCorpusManifestV2Schema.parse({
      ...core,
      manifestSha256: digestProductGateHoldoutCorpusV2(core),
    });
  };

export const PRODUCT_GATE_HOLDOUT_STRUCTURAL_FAKE_V2 =
  createDeterministicProductGateHoldoutCorpusStructuralFakeV2();
