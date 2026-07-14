import { z } from 'zod';

import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  NormalizedObservedTextValueV1Schema,
  RepositoryFixtureInputRefV1Schema,
  TextObservationBoundingBoxV1Schema,
} from './ai-contracts.js';
import {
  CanonicalUtcTimestampSchema,
  OPENAI_REAL_MODEL_ENDPOINT,
  OPENAI_REAL_MODEL_PROVIDER_KEY,
  OPENAI_REAL_MODEL_REQUESTED_MODEL_ID,
} from './openai-real-model-candidate-evidence.js';

export const REAL_MODEL_BENCHMARK_PROFILE_ID = 'banner-scene-analysis-ocr-first-call-v1' as const;

const fixtureIdPattern = /^[a-z0-9][a-z0-9._-]{7,79}$/;
const oracleReferencePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

export const RealModelBenchmarkFixtureIdSchema = z
  .string()
  .regex(fixtureIdPattern)
  .brand<'RealModelBenchmarkFixtureId'>();

export const RealModelBenchmarkCorpusManifestSha256Schema =
  Sha256HexSchema.brand<'RealModelBenchmarkCorpusManifestSha256'>();

export const RealModelBenchmarkCorpusScenarioSchema = z.enum([
  'mixed-subject-copy',
  'text-heavy',
  'no-text-layered',
]);

const OriginalIngressImageV1Schema = z
  .strictObject({
    filename: z.string().min(5).max(120),
    declaredContentType: z.enum(['image/jpeg', 'image/png']),
    sha256: Sha256HexSchema,
    byteSize: z.int().min(1).max(5_242_880),
    pixelWidth: z.int().min(64).max(2_048),
    pixelHeight: z.int().min(64).max(2_048),
  })
  .superRefine((image, context) => {
    if (image.pixelWidth * image.pixelHeight > 4_194_304) {
      context.addIssue({
        code: 'custom',
        message: 'Original benchmark images cannot exceed 4,194,304 pixels.',
      });
    }
    const extension = image.filename.slice(image.filename.lastIndexOf('.') + 1).toLowerCase();
    if (
      (image.declaredContentType === 'image/png' && extension !== 'png') ||
      (image.declaredContentType === 'image/jpeg' && !['jpg', 'jpeg'].includes(extension))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Original filename extension must match the declared raster type.',
      });
    }
  })
  .readonly();

export const RealModelBenchmarkNormalizedImageV1Schema = z
  .strictObject({
    contentType: z.literal('image/png'),
    sha256: Sha256HexSchema,
    byteSize: z.int().min(1).max(5_242_880),
    pixelWidth: z.int().min(64).max(2_048),
    pixelHeight: z.int().min(64).max(2_048),
  })
  .superRefine((image, context) => {
    if (image.pixelWidth * image.pixelHeight > 4_194_304) {
      context.addIssue({
        code: 'custom',
        message: 'Normalized benchmark images cannot exceed 4,194,304 pixels.',
      });
    }
  })
  .readonly();

const licenseCommonShape = {
  thirdPartyProviderEvaluationRights: z.literal('confirmed'),
  evidenceReference: z.string().regex(oracleReferencePattern),
  evidenceSha256: Sha256HexSchema,
} as const;

const UserOwnedLicenseV1Schema = z
  .strictObject({ status: z.literal('user-owned'), ...licenseCommonShape })
  .readonly();

const ExplicitProviderEvaluationLicenseV1Schema = z
  .strictObject({
    status: z.literal('explicitly-licensed-for-third-party-provider-evaluation'),
    ...licenseCommonShape,
  })
  .readonly();

export const RealModelBenchmarkOwnerLicenseV1Schema = z.discriminatedUnion('status', [
  UserOwnedLicenseV1Schema,
  ExplicitProviderEvaluationLicenseV1Schema,
]);

const ProviderTransmissionApprovalV1Schema = z
  .strictObject({
    approvalVersion: z.literal(1),
    status: z.literal('explicit-human-approval-recorded'),
    normalizedSourceSha256: Sha256HexSchema,
    providerKey: z.literal(OPENAI_REAL_MODEL_PROVIDER_KEY),
    requestedModelId: z.literal(OPENAI_REAL_MODEL_REQUESTED_MODEL_ID),
    endpoint: z.literal(OPENAI_REAL_MODEL_ENDPOINT),
    endpointMethod: z.literal('POST'),
    profileId: z.literal(REAL_MODEL_BENCHMARK_PROFILE_ID),
    purpose: z.literal('sanitized-third-party-provider-evaluation-only'),
    authorizationId: z.string().regex(oracleReferencePattern),
    authorizationRevision: z.int().min(1).max(2_147_483_647),
    authorizationRevisionEvidenceSha256: Sha256HexSchema,
    authorizationIssuedAt: CanonicalUtcTimestampSchema,
    authorizationExpiresAt: CanonicalUtcTimestampSchema,
    reviewedAt: CanonicalUtcTimestampSchema,
    expiresAt: CanonicalUtcTimestampSchema,
    approvalEvidenceSha256: Sha256HexSchema,
  })
  .superRefine((approval, context) => {
    if (
      Date.parse(approval.authorizationIssuedAt) >= Date.parse(approval.authorizationExpiresAt) ||
      Date.parse(approval.reviewedAt) >= Date.parse(approval.expiresAt)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Transmission approval and bound authorization must have positive fresh windows.',
      });
    }
  })
  .readonly();

const HumanAdmissionReviewV1Schema = z
  .strictObject({
    reviewVersion: z.literal(1),
    reviewStatus: z.literal('human-approved'),
    reviewedAt: CanonicalUtcTimestampSchema,
    expiresAt: CanonicalUtcTimestampSchema,
    visualPixelsReviewed: z.literal(true),
    metadataReviewed: z.literal(true),
    secrets: z.literal('confirmed-absent'),
    personalData: z.literal('confirmed-absent'),
    credentials: z.literal('confirmed-absent'),
    privateClientWork: z.literal('confirmed-absent'),
    embeddedTrackingUrls: z.literal('confirmed-absent'),
    visibleTrackingUrls: z.literal('confirmed-absent'),
    reviewEvidenceSha256: Sha256HexSchema,
    providerTransmissionApproval: ProviderTransmissionApprovalV1Schema,
  })
  .superRefine((review, context) => {
    if (Date.parse(review.reviewedAt) >= Date.parse(review.expiresAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Admission review must have a positive fresh window.',
      });
    }
  })
  .readonly();

const HumanOracleLayerV1Schema = z
  .strictObject({
    oracleLayerId: z.string().regex(oracleReferencePattern),
    role: z.enum(['background', 'subject', 'foreground', 'decoration', 'text', 'other']),
    required: z.literal(true),
  })
  .readonly();

export const HumanOracleTextOccurrenceV1Schema = z
  .strictObject({
    oracleOccurrenceId: z.string().regex(oracleReferencePattern),
    normalizedText: NormalizedObservedTextValueV1Schema,
    boundingBox: TextObservationBoundingBoxV1Schema,
  })
  .readonly();

export const ProviderNeutralHumanOracleV1Schema = z
  .strictObject({
    oracleVersion: z.literal(1),
    evidenceRole: z.literal('human-expected-oracle'),
    evidenceSha256: Sha256HexSchema,
    evidenceReference: z.string().regex(oracleReferencePattern),
    reviewStatus: z.literal('human-approved'),
    reviewedAt: CanonicalUtcTimestampSchema,
    expiresAt: CanonicalUtcTimestampSchema,
    requiredLayers: z.array(HumanOracleLayerV1Schema).min(3).max(5).readonly(),
    expectedTextOccurrences: z.array(HumanOracleTextOccurrenceV1Schema).max(100).readonly(),
  })
  .superRefine((oracle, context) => {
    if (Date.parse(oracle.reviewedAt) >= Date.parse(oracle.expiresAt)) {
      context.addIssue({
        code: 'custom',
        message: 'Oracle review must have a positive fresh window.',
      });
    }
    const layerIds = oracle.requiredLayers.map((layer) => layer.oracleLayerId);
    if (new Set(layerIds).size !== layerIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Human oracle layer IDs must be unique.',
        path: ['requiredLayers'],
      });
    }
    const occurrenceIds = oracle.expectedTextOccurrences.map(
      (occurrence) => occurrence.oracleOccurrenceId,
    );
    if (new Set(occurrenceIds).size !== occurrenceIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Human oracle text-occurrence IDs must be unique.',
        path: ['expectedTextOccurrences'],
      });
    }
  })
  .readonly();

const FixtureEvidenceBindingCoreV1Schema = z
  .strictObject({
    bindingVersion: z.literal(1),
    fixtureId: RealModelBenchmarkFixtureIdSchema,
    requestFixtureBindingSha256: Sha256HexSchema,
    originalSourceSha256: Sha256HexSchema,
    normalizedSourceSha256: Sha256HexSchema,
    licenseEvidenceSha256: Sha256HexSchema,
    privacyReviewEvidenceSha256: Sha256HexSchema,
    oracleEvidenceSha256: Sha256HexSchema,
    transmissionApprovalEvidenceSha256: Sha256HexSchema,
  })
  .readonly();

export const digestRealModelBenchmarkFixtureEvidenceBindingV1 = (input: unknown): string => {
  const binding = FixtureEvidenceBindingCoreV1Schema.parse(input);
  return sha256Hex(Buffer.from(canonicalizeJson(binding), 'utf8'));
};

export const digestRealModelBenchmarkEvidenceAssertionV1 = (input: unknown): string =>
  sha256Hex(Buffer.from(canonicalizeJson(input), 'utf8'));

const FixtureEvidenceBindingV1Schema = z
  .strictObject({
    bindingVersion: z.literal(1),
    fixtureId: RealModelBenchmarkFixtureIdSchema,
    requestFixtureBindingSha256: Sha256HexSchema,
    originalSourceSha256: Sha256HexSchema,
    normalizedSourceSha256: Sha256HexSchema,
    licenseEvidenceSha256: Sha256HexSchema,
    privacyReviewEvidenceSha256: Sha256HexSchema,
    oracleEvidenceSha256: Sha256HexSchema,
    transmissionApprovalEvidenceSha256: Sha256HexSchema,
    bindingSha256: Sha256HexSchema,
  })
  .superRefine((binding, context) => {
    const { bindingSha256, ...core } = binding;
    if (bindingSha256 !== digestRealModelBenchmarkFixtureEvidenceBindingV1(core)) {
      context.addIssue({
        code: 'custom',
        message: 'Fixture evidence binding digest differs from its canonical evidence projection.',
        path: ['bindingSha256'],
      });
    }
  })
  .readonly();

export const digestRepositoryFixtureInputRefV1 = (input: unknown): string => {
  const reference = RepositoryFixtureInputRefV1Schema.parse(input);
  return sha256Hex(Buffer.from(canonicalizeJson(reference), 'utf8'));
};

export const AdmittedRealModelBenchmarkCorpusEntryV1Schema = z
  .strictObject({
    entryVersion: z.literal(2),
    fixtureId: RealModelBenchmarkFixtureIdSchema,
    scenario: RealModelBenchmarkCorpusScenarioSchema,
    requestFixtureBinding: RepositoryFixtureInputRefV1Schema,
    originalIngress: OriginalIngressImageV1Schema,
    normalizedTransmission: RealModelBenchmarkNormalizedImageV1Schema,
    ownerLicense: RealModelBenchmarkOwnerLicenseV1Schema,
    admissionReview: HumanAdmissionReviewV1Schema,
    expectedOracle: ProviderNeutralHumanOracleV1Schema,
    evidenceBinding: FixtureEvidenceBindingV1Schema,
  })
  .superRefine((entry, context) => {
    const observationCount = entry.expectedOracle.expectedTextOccurrences.length;
    const requiredLayerRoles = entry.expectedOracle.requiredLayers.map((layer) => layer.role);
    if (entry.scenario === 'mixed-subject-copy' && observationCount < 2) {
      context.addIssue({
        code: 'custom',
        message: 'The mixed subject-and-copy fixture requires at least two text occurrences.',
        path: ['expectedOracle', 'expectedTextOccurrences'],
      });
    }
    if (entry.scenario === 'text-heavy' && observationCount < 3) {
      context.addIssue({
        code: 'custom',
        message: 'The text-heavy fixture requires at least three text occurrences.',
        path: ['expectedOracle', 'expectedTextOccurrences'],
      });
    }
    if (entry.scenario === 'no-text-layered' && observationCount !== 0) {
      context.addIssue({
        code: 'custom',
        message: 'The no-text layered fixture requires exactly zero text occurrences.',
        path: ['expectedOracle', 'expectedTextOccurrences'],
      });
    }
    if (
      (entry.scenario === 'no-text-layered' && requiredLayerRoles.includes('text')) ||
      (entry.scenario !== 'no-text-layered' && !requiredLayerRoles.includes('text'))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Oracle layer roles must agree with the fixture text scenario.',
        path: ['expectedOracle', 'requiredLayers'],
      });
    }
    const approval = entry.admissionReview.providerTransmissionApproval;
    const binding = entry.evidenceBinding;
    if (
      approval.normalizedSourceSha256 !== entry.normalizedTransmission.sha256 ||
      binding.fixtureId !== entry.fixtureId ||
      binding.requestFixtureBindingSha256 !==
        digestRepositoryFixtureInputRefV1(entry.requestFixtureBinding) ||
      binding.originalSourceSha256 !== entry.originalIngress.sha256 ||
      binding.normalizedSourceSha256 !== entry.normalizedTransmission.sha256 ||
      binding.licenseEvidenceSha256 !==
        digestRealModelBenchmarkEvidenceAssertionV1(entry.ownerLicense) ||
      binding.privacyReviewEvidenceSha256 !==
        digestRealModelBenchmarkEvidenceAssertionV1(entry.admissionReview) ||
      binding.oracleEvidenceSha256 !==
        digestRealModelBenchmarkEvidenceAssertionV1(entry.expectedOracle) ||
      binding.transmissionApprovalEvidenceSha256 !==
        digestRealModelBenchmarkEvidenceAssertionV1(approval)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Fixture approval, source, license, privacy, oracle, or transmission evidence drifted.',
        path: ['evidenceBinding'],
      });
    }
  })
  .readonly();

const AdmittedRealModelBenchmarkCorpusManifestV1Schema = z
  .strictObject({
    manifestVersion: z.literal(2),
    profileId: z.literal(REAL_MODEL_BENCHMARK_PROFILE_ID),
    status: z.literal('admitted'),
    corpusPurpose: z.literal('sanitized-third-party-provider-evaluation-only'),
    entries: z.array(AdmittedRealModelBenchmarkCorpusEntryV1Schema).length(3).readonly(),
  })
  .superRefine((manifest, context) => {
    const fixtureIds = manifest.entries.map((entry) => entry.fixtureId);
    const originalDigests = manifest.entries.map((entry) => entry.originalIngress.sha256);
    const sourceDigests = manifest.entries.map((entry) => entry.normalizedTransmission.sha256);
    const fixtureBindings = manifest.entries.map((entry) =>
      canonicalizeJson(entry.requestFixtureBinding),
    );
    const scenarios = manifest.entries.map((entry) => entry.scenario);
    if (new Set(fixtureIds).size !== fixtureIds.length) {
      context.addIssue({ code: 'custom', message: 'Admitted fixture IDs must be unique.' });
    }
    if (
      new Set(originalDigests).size !== originalDigests.length ||
      new Set(sourceDigests).size !== sourceDigests.length
    ) {
      context.addIssue({ code: 'custom', message: 'Admitted source digests must be unique.' });
    }
    if (new Set(fixtureBindings).size !== fixtureBindings.length) {
      context.addIssue({
        code: 'custom',
        message: 'Admitted request-fixture bindings must be unique.',
      });
    }
    if (
      scenarios.length !== RealModelBenchmarkCorpusScenarioSchema.options.length ||
      !RealModelBenchmarkCorpusScenarioSchema.options.every((scenario) =>
        scenarios.includes(scenario),
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'The admitted corpus requires exactly one fixture from each frozen scenario.',
        path: ['entries'],
      });
    }
  })
  .readonly();

const BlockedRealModelBenchmarkCorpusManifestV1Schema = z
  .strictObject({
    manifestVersion: z.literal(2),
    profileId: z.literal(REAL_MODEL_BENCHMARK_PROFILE_ID),
    status: z.literal('blocked-awaiting-user-supplied-corpus'),
    corpusPurpose: z.literal('sanitized-third-party-provider-evaluation-only'),
    entries: z.tuple([]),
    admissionAllowed: z.literal(false),
    productionSourceRegistry: z.literal('empty'),
    currentAngelFixture: z.literal(
      'ineligible-12x8-77-byte-provider-free-fixture-insufficient-for-real-benchmark',
    ),
    blocker: z.literal(
      'exactly-three-user-owned-or-explicitly-licensed-human-approved-local-fixtures-required',
    ),
  })
  .readonly();

export const RealModelBenchmarkCorpusManifestV1Schema = z.discriminatedUnion('status', [
  BlockedRealModelBenchmarkCorpusManifestV1Schema,
  AdmittedRealModelBenchmarkCorpusManifestV1Schema,
]);

export const BLOCKED_REAL_MODEL_BENCHMARK_CORPUS_MANIFEST_V1 =
  RealModelBenchmarkCorpusManifestV1Schema.parse({
    manifestVersion: 2,
    profileId: REAL_MODEL_BENCHMARK_PROFILE_ID,
    status: 'blocked-awaiting-user-supplied-corpus',
    corpusPurpose: 'sanitized-third-party-provider-evaluation-only',
    entries: [],
    admissionAllowed: false,
    productionSourceRegistry: 'empty',
    currentAngelFixture:
      'ineligible-12x8-77-byte-provider-free-fixture-insufficient-for-real-benchmark',
    blocker:
      'exactly-three-user-owned-or-explicitly-licensed-human-approved-local-fixtures-required',
  });

export type AdmittedRealModelBenchmarkCorpusEntryV1 = z.infer<
  typeof AdmittedRealModelBenchmarkCorpusEntryV1Schema
>;
export type AdmittedRealModelBenchmarkCorpusManifestV1 = z.infer<
  typeof AdmittedRealModelBenchmarkCorpusManifestV1Schema
>;

export const admitRealModelBenchmarkCorpusV1 = (
  input: unknown,
): AdmittedRealModelBenchmarkCorpusManifestV1 =>
  AdmittedRealModelBenchmarkCorpusManifestV1Schema.parse(input);

export const digestAdmittedRealModelBenchmarkCorpusV1 = (
  input: unknown,
): z.infer<typeof RealModelBenchmarkCorpusManifestSha256Schema> => {
  const manifest = admitRealModelBenchmarkCorpusV1(input);
  return RealModelBenchmarkCorpusManifestSha256Schema.parse(
    sha256Hex(Buffer.from(canonicalizeJson(manifest), 'utf8')),
  );
};
