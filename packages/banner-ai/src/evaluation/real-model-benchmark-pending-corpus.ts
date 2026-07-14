import { z } from 'zod';

import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
  INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
} from './ai-contracts.js';
import {
  OPENAI_BENCHMARK_PRICING_EVIDENCE_V1,
  OPENAI_REAL_MODEL_BENCHMARK_CANDIDATE_V1,
  PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1,
} from './openai-real-model-candidate-evidence.js';
import { SCENE_ANALYSIS_PROMPT_V1 } from './prompt-catalog.js';
import {
  REAL_MODEL_BENCHMARK_PROFILE_ID,
  RealModelBenchmarkFixtureIdSchema,
} from './real-model-benchmark-corpus-manifest.js';
import {
  DEFAULT_REAL_MODEL_BENCHMARK_MANUAL_CONTROL_V1,
  OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1,
  REAL_MODEL_BENCHMARK_CAPS_V1,
  digestSelectedRealModelBenchmarkProfileV1,
} from './real-model-benchmark-profile.js';

export const THREE_BANNER_INTAKE_PERMISSION_STATEMENT =
  'I own or have permission to use all three images in banners-tests, they contain no sensitive/private information, and I authorize sending them to OpenAI solely for the capped Fabrica benchmark.' as const;
export const THREE_BANNER_INTAKE_PERMISSION_STATEMENT_SHA256 =
  'c70506656b23342c7410cc06b8b5a0dbd643699d9b6698d0629869c7e891632a' as const;

const PROFILE_SHA256 = '0f0b392165604c2ebb166e62e5b04c659dd60e7e941c400e623c8a70f5a9790f' as const;
const CANDIDATE_SHA256 =
  'c07a2998f7269a6c7479203023743a4d7e06319adcb78b9b438c7b7151c126d2' as const;
const REQUEST_SHAPE_SHA256 =
  'e93de8b5d1c47db26476b8912bfdca402b2432a6719401cd29438c273dab7242' as const;
const PROMPT_SHA256 = '5cc311b7b353e06c61bcdf840b40dff9d35de0aea12851ffa18a654177917227' as const;
const CONTENT_POLICY_SHA256 =
  '14a27c163a4082a966971028e59b6d1d56ea9cde99038b823c0a18b1ea92d0c4' as const;
const PRICING_EVIDENCE_SHA256 =
  'f1355e4a11d55165f619082d7e0300a9e0ebca02cf0048d77803b8f85717e693' as const;
const WORKFLOW_DEFINITION_SHA256 =
  'e3784eefd371b1bf343db9e2dfb97697f2fe5889c8374fe777316add8a59230c' as const;
const CAPS_SHA256 = '409cbc9d8f62a03b87de35b15e9e044f11773c085eca80da74f25e3ba1fe5d00' as const;
const ENGAGED_MANUAL_CONTROL_SHA256 =
  'caf0929d12747f33473c536ef5e9e87b9ed610f8ef99943bdc9f03bb61518c9a' as const;
export const PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_SHA256 =
  '961331ea74f826d428a0aabcbf44378cd583856a3101a3a59495e97040aa8b3c' as const;

const digestCanonical = (input: unknown): string =>
  sha256Hex(Buffer.from(canonicalizeJson(input), 'utf8'));

const exactCanonicalEquality = (left: unknown, right: unknown): boolean =>
  canonicalizeJson(left) === canonicalizeJson(right);

const PendingRepositoryEvidenceBindingsV1Schema = z
  .strictObject({
    bindingVersion: z.literal(1),
    profileSha256: z.literal(PROFILE_SHA256),
    candidateSha256: z.literal(CANDIDATE_SHA256),
    responsesRequestShapeSha256: z.literal(REQUEST_SHAPE_SHA256),
    promptSha256: z.literal(PROMPT_SHA256),
    contentPolicySha256: z.literal(CONTENT_POLICY_SHA256),
    pricingEvidenceSha256: z.literal(PRICING_EVIDENCE_SHA256),
    workflowDefinitionSha256: z.literal(WORKFLOW_DEFINITION_SHA256),
    capsSha256: z.literal(CAPS_SHA256),
    engagedManualControlSha256: z.literal(ENGAGED_MANUAL_CONTROL_SHA256),
    providerCandidateState: z.literal('proposed-unverified-execution-blocked'),
    requestBoundaryState: z.literal('non-networking-refusal-stub-only'),
  })
  .readonly();

export const PENDING_REAL_MODEL_BENCHMARK_REPOSITORY_BINDINGS_V1 =
  PendingRepositoryEvidenceBindingsV1Schema.parse({
    bindingVersion: 1,
    profileSha256: PROFILE_SHA256,
    candidateSha256: CANDIDATE_SHA256,
    responsesRequestShapeSha256: REQUEST_SHAPE_SHA256,
    promptSha256: PROMPT_SHA256,
    contentPolicySha256: CONTENT_POLICY_SHA256,
    pricingEvidenceSha256: PRICING_EVIDENCE_SHA256,
    workflowDefinitionSha256: WORKFLOW_DEFINITION_SHA256,
    capsSha256: CAPS_SHA256,
    engagedManualControlSha256: ENGAGED_MANUAL_CONTROL_SHA256,
    providerCandidateState: 'proposed-unverified-execution-blocked',
    requestBoundaryState: 'non-networking-refusal-stub-only',
  });

const currentRepositoryEvidenceBindings = () => ({
  bindingVersion: 1 as const,
  profileSha256: digestSelectedRealModelBenchmarkProfileV1(OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1),
  candidateSha256: digestCanonical(OPENAI_REAL_MODEL_BENCHMARK_CANDIDATE_V1),
  responsesRequestShapeSha256: PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1.requestShapeSha256,
  promptSha256: SCENE_ANALYSIS_PROMPT_V1.contentSha256,
  contentPolicySha256: BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION_SHA256,
  pricingEvidenceSha256: OPENAI_BENCHMARK_PRICING_EVIDENCE_V1.evidenceSha256,
  workflowDefinitionSha256: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1.definitionSha256,
  capsSha256: digestCanonical(REAL_MODEL_BENCHMARK_CAPS_V1),
  engagedManualControlSha256: digestCanonical(DEFAULT_REAL_MODEL_BENCHMARK_MANUAL_CONTROL_V1),
  providerCandidateState: OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1.candidateStatus,
  requestBoundaryState: 'non-networking-refusal-stub-only' as const,
});

const PendingBenchmarkCapsBindingV1Schema = z
  .strictObject({
    capsSha256: z.literal(CAPS_SHA256),
    fixtureCount: z.literal(3),
    successfulRunsPerFixture: z.literal(2),
    successfulRunCount: z.literal(6),
    maximumProviderCalls: z.literal(9),
    maximumRetriesPerFixtureAcrossBothRuns: z.literal(1),
    maximumRetriesTotal: z.literal(3),
    maximumFailedAttemptsPerFixture: z.literal(2),
    maximumFailedAttempts: z.literal(3),
    perCallCostCeilingMicroUsd: z.literal(100_000),
    totalCostCeilingMicroUsd: z.literal(900_000),
    maximumAttemptedCallMs: z.literal(60_000),
    maximumLogicalRunMs: z.literal(120_000),
    maximumTotalWallClockMs: z.literal(600_000),
    authority: z.literal('ceilings-only-no-call-authority'),
  })
  .readonly();

const PENDING_BENCHMARK_CAPS_BINDING_V1 = PendingBenchmarkCapsBindingV1Schema.parse({
  capsSha256: CAPS_SHA256,
  fixtureCount: 3,
  successfulRunsPerFixture: 2,
  successfulRunCount: 6,
  maximumProviderCalls: 9,
  maximumRetriesPerFixtureAcrossBothRuns: 1,
  maximumRetriesTotal: 3,
  maximumFailedAttemptsPerFixture: 2,
  maximumFailedAttempts: 3,
  perCallCostCeilingMicroUsd: 100_000,
  totalCostCeilingMicroUsd: 900_000,
  maximumAttemptedCallMs: 60_000,
  maximumLogicalRunMs: 120_000,
  maximumTotalWallClockMs: 600_000,
  authority: 'ceilings-only-no-call-authority',
});

const PendingEngagedManualControlBindingV1Schema = z
  .strictObject({
    controlId: z.literal('banner-ai-real-model-benchmark-kill-switch-v1'),
    revision: z.literal(1),
    state: z.literal('engaged'),
    controlSha256: z.literal(ENGAGED_MANUAL_CONTROL_SHA256),
    authority: z.literal('structural-design-only-no-release-or-execution-authority'),
  })
  .readonly();

const PENDING_ENGAGED_MANUAL_CONTROL_BINDING_V1 = PendingEngagedManualControlBindingV1Schema.parse({
  controlId: 'banner-ai-real-model-benchmark-kill-switch-v1',
  revision: 1,
  state: 'engaged',
  controlSha256: ENGAGED_MANUAL_CONTROL_SHA256,
  authority: 'structural-design-only-no-release-or-execution-authority',
});

const PendingPackageImageV1Schema = z
  .strictObject({
    packageRelativePath: z
      .string()
      .regex(
        /^packages\/banner-ai\/test\/fixtures\/real-model-benchmark\/(?:original|normalized)\/[a-z0-9.-]+$/u,
      ),
    filename: z.string().regex(/^[a-z0-9][a-z0-9.-]+\.(?:jpg|png)$/u),
    detectedMediaType: z.enum(['image/jpeg', 'image/png']),
    byteSize: z.int().min(1).max(5_242_880),
    pixelWidth: z.int().min(64).max(2_048),
    pixelHeight: z.int().min(64).max(2_048),
    sha256: Sha256HexSchema,
  })
  .superRefine((image, context) => {
    if (image.pixelWidth * image.pixelHeight > 4_194_304) {
      context.addIssue({ code: 'custom', message: 'Pending fixture exceeds pixel limits.' });
    }
    const extension = image.filename.slice(image.filename.lastIndexOf('.') + 1);
    if (
      (image.detectedMediaType === 'image/png' && extension !== 'png') ||
      (image.detectedMediaType === 'image/jpeg' && extension !== 'jpg')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Pending fixture filename and byte-detected media type disagree.',
      });
    }
  })
  .readonly();

const PendingLocalMetadataPrivacyFindingsV1Schema = z
  .strictObject({
    reviewVersion: z.literal(1),
    reviewActor: z.literal('codex-local-inspection'),
    reviewScope: z.literal('original-container-metadata-and-visible-pixels'),
    humanApprovalAuthority: z.literal(false),
    originalAncillaryByteSize: z.int().min(0).max(1_048_576),
    originalMetadataFindings: z
      .array(
        z.enum([
          'png-icc-profile-including-apple-profile-data',
          'png-exif-user-comment-screenshot',
          'png-adobe-xmp-packet',
          'jpeg-photoshop-xmp-packet',
          'jpeg-xmp-document-and-instance-identifiers',
          'jpeg-exif-and-adobe-metadata',
          'jpeg-jfif-payload-only',
        ]),
      )
      .min(1)
      .max(4)
      .readonly(),
    visiblePrivacyOrRightsConcerns: z
      .array(
        z.enum([
          'recognizable-adult-likeness',
          'placeholder-visible-url',
          'faint-repeated-watermark-text',
          'visible-brand-and-label-text',
          'faint-watermark-text',
          'no-additional-obvious-sensitive-content-locally-observed',
        ]),
      )
      .min(1)
      .max(5)
      .readonly(),
    normalizedMetadataDisposition: z.literal(
      'canonical-normalization-stripped-all-container-ancillary-metadata',
    ),
    humanPrivacyAdmissionStatus: z.literal('pending-human-confirmation'),
  })
  .superRefine((findings, context) => {
    if (
      new Set(findings.originalMetadataFindings).size !==
        findings.originalMetadataFindings.length ||
      new Set(findings.visiblePrivacyOrRightsConcerns).size !==
        findings.visiblePrivacyOrRightsConcerns.length
    ) {
      context.addIssue({ code: 'custom', message: 'Local review findings must be unique.' });
    }
  })
  .readonly();

const ProposedBasisPointBoxV1Schema = z
  .strictObject({
    unit: z.literal('normalized-basis-points'),
    xBps: z.int().min(0).max(10_000),
    yBps: z.int().min(0).max(10_000),
    widthBps: z.int().min(1).max(10_000),
    heightBps: z.int().min(1).max(10_000),
  })
  .superRefine((box, context) => {
    if (box.xBps + box.widthBps > 10_000 || box.yBps + box.heightBps > 10_000) {
      context.addIssue({
        code: 'custom',
        message: 'Draft box exceeds the normalized image plane.',
      });
    }
  })
  .readonly();

const ProposedSemanticLayerV1Schema = z
  .strictObject({
    draftLayerId: z.string().regex(/^[a-z0-9][a-z0-9.-]{7,79}$/u),
    proposedLabel: z.string().min(1).max(120),
    proposedRole: z.enum(['background', 'subject', 'foreground', 'decoration', 'text', 'other']),
    proposedBox: ProposedBasisPointBoxV1Schema,
    basis: z.literal('codex-local-visual-estimate-requires-human-review'),
  })
  .readonly();

const ProposedVisibleTextV1Schema = z
  .strictObject({
    draftTextId: z.string().regex(/^[a-z0-9][a-z0-9.-]{7,79}$/u),
    transcription: z.string().min(1).max(500).nullable(),
    transcriptionCompleteness: z.enum(['complete-codex-draft', 'incomplete-human-review-required']),
    proposedBox: ProposedBasisPointBoxV1Schema.nullable(),
    basis: z.literal('codex-local-visual-estimate-requires-human-review'),
  })
  .superRefine((text, context) => {
    if (
      text.transcriptionCompleteness === 'complete-codex-draft' &&
      (text.transcription === null || text.proposedBox === null)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A complete draft transcription requires text and one proposed box.',
      });
    }
    if (
      text.transcriptionCompleteness === 'incomplete-human-review-required' &&
      text.transcription !== null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Unreliable faint text must not carry an invented transcription.',
      });
    }
  })
  .readonly();

export const CodexDraftUnapprovedBannerReviewV1Schema = z
  .strictObject({
    draftVersion: z.literal(1),
    evidenceRole: z.literal('codex-draft-unapproved'),
    reviewStatus: z.literal('draft-unapproved'),
    humanApprovalAuthority: z.literal(false),
    sourceDimensions: z
      .strictObject({
        pixelWidth: z.int().min(64).max(2_048),
        pixelHeight: z.int().min(64).max(2_048),
      })
      .readonly(),
    scenarioAssessment: z.enum([
      'mixed-subject-copy-candidate',
      'text-heavy-candidate',
      'text-containing-product-candidate-ineligible-for-no-text-slot',
    ]),
    proposedSemanticLayers: z.array(ProposedSemanticLayerV1Schema).min(3).max(5).readonly(),
    proposedVisibleText: z.array(ProposedVisibleTextV1Schema).min(1).max(20).readonly(),
    backgroundClassification: z.enum([
      'geometric-graphic-background',
      'photographic-shallow-depth-of-field-background',
      'photographic-product-mockup-on-neutral-background',
    ]),
    uncertaintyAndReviewFlags: z
      .array(
        z.enum([
          'layer-boxes-approximate',
          'adult-likeness-model-release-human-decision-required',
          'placeholder-url-tracking-human-decision-required',
          'faint-watermark-transcription-and-license-human-review-required',
          'brand-and-label-transcription-human-confirmation-required',
          'ineligible-for-no-text-scenario',
        ]),
      )
      .min(1)
      .max(6)
      .readonly(),
    humanReviewWorksheet: z.array(z.string().min(10).max(240)).min(3).max(8).readonly(),
  })
  .superRefine((draft, context) => {
    if (draft.sourceDimensions.pixelWidth * draft.sourceDimensions.pixelHeight > 4_194_304) {
      context.addIssue({
        code: 'custom',
        message: 'Draft source dimensions exceed intake limits.',
      });
    }
    const layerIds = draft.proposedSemanticLayers.map((layer) => layer.draftLayerId);
    const textIds = draft.proposedVisibleText.map((text) => text.draftTextId);
    if (
      new Set(layerIds).size !== layerIds.length ||
      new Set(textIds).size !== textIds.length ||
      new Set(draft.uncertaintyAndReviewFlags).size !== draft.uncertaintyAndReviewFlags.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Draft review identities and flags must be unique.',
      });
    }
  })
  .readonly();

const PendingIntakeEvidenceCoreV1Schema = z
  .strictObject({
    evidenceVersion: z.literal(1),
    evidenceRole: z.literal('user-intake-permission-not-execution-authorization'),
    exactUserStatement: z.literal(THREE_BANNER_INTAKE_PERMISSION_STATEMENT),
    exactUserStatementSha256: z.literal(THREE_BANNER_INTAKE_PERMISSION_STATEMENT_SHA256),
    rightsAssertion: z.literal('owner-or-permitted'),
    humanLicenseClassification: z.literal(
      'pending-user-classification-as-user-owned-or-explicitly-licensed',
    ),
    userPrivacyAssertion: z.literal('contains-no-sensitive-or-private-information'),
    humanPrivacyAdmissionStatus: z.literal('pending-human-confirmation'),
    localFindingsSha256: Sha256HexSchema,
    originalSourceSha256: Sha256HexSchema,
    normalizedSourceSha256: Sha256HexSchema,
    transmissionScope: z.literal('openai-only-capped-fabrica-benchmark-future-milestone'),
    currentMilestoneTransmission: z.literal('forbidden-and-not-performed'),
    humanReviewRequirement: z.literal('human-approval-required-before-any-admission'),
    humanAdmissionStatus: z.literal('pending'),
    caps: PendingBenchmarkCapsBindingV1Schema,
    manualControl: PendingEngagedManualControlBindingV1Schema,
  })
  .readonly();

export const digestPendingIntakeEvidenceV1 = (input: unknown): string =>
  digestCanonical(PendingIntakeEvidenceCoreV1Schema.parse(input));

const PendingIntakeEvidenceV1Schema = z
  .strictObject({
    evidenceVersion: z.literal(1),
    evidenceRole: z.literal('user-intake-permission-not-execution-authorization'),
    exactUserStatement: z.literal(THREE_BANNER_INTAKE_PERMISSION_STATEMENT),
    exactUserStatementSha256: z.literal(THREE_BANNER_INTAKE_PERMISSION_STATEMENT_SHA256),
    rightsAssertion: z.literal('owner-or-permitted'),
    humanLicenseClassification: z.literal(
      'pending-user-classification-as-user-owned-or-explicitly-licensed',
    ),
    userPrivacyAssertion: z.literal('contains-no-sensitive-or-private-information'),
    humanPrivacyAdmissionStatus: z.literal('pending-human-confirmation'),
    localFindingsSha256: Sha256HexSchema,
    originalSourceSha256: Sha256HexSchema,
    normalizedSourceSha256: Sha256HexSchema,
    transmissionScope: z.literal('openai-only-capped-fabrica-benchmark-future-milestone'),
    currentMilestoneTransmission: z.literal('forbidden-and-not-performed'),
    humanReviewRequirement: z.literal('human-approval-required-before-any-admission'),
    humanAdmissionStatus: z.literal('pending'),
    caps: PendingBenchmarkCapsBindingV1Schema,
    manualControl: PendingEngagedManualControlBindingV1Schema,
    evidenceSha256: Sha256HexSchema,
  })
  .superRefine((evidence, context) => {
    const { evidenceSha256, ...core } = evidence;
    if (evidenceSha256 !== digestPendingIntakeEvidenceV1(core)) {
      context.addIssue({
        code: 'custom',
        message: 'Pending intake evidence digest drifted.',
        path: ['evidenceSha256'],
      });
    }
  })
  .readonly();

const PendingSourceAuditV1Schema = z
  .strictObject({
    auditVersion: z.literal(1),
    intakeFilename: z.enum(['1-person.png', '2-product.jpg', '3-text-heavy.jpg']),
    byteTypeDetection: z.literal('trusted-byte-level-container-parser'),
    currentBannerRasterLimits: z.literal('passed'),
    benchmarkIntakeLimits: z.literal('passed'),
    malformedOrAmbiguous: z.literal(false),
    duplicateStatus: z.literal('unique-original-and-normalized-across-six-digests'),
    localMetadataPrivacy: PendingLocalMetadataPrivacyFindingsV1Schema,
  })
  .readonly();

export const PendingRealModelBenchmarkCorpusEntryV1Schema = z
  .strictObject({
    pendingEntryVersion: z.literal(1),
    fixtureId: RealModelBenchmarkFixtureIdSchema,
    sourceAudit: PendingSourceAuditV1Schema,
    packageOriginal: PendingPackageImageV1Schema,
    canonicalNormalized: PendingPackageImageV1Schema,
    intakeEvidence: PendingIntakeEvidenceV1Schema,
    draftReview: CodexDraftUnapprovedBannerReviewV1Schema,
    admissionAuthority: z.literal(false),
    requestPlanAuthority: z.literal(false),
    dispatchAuthority: z.literal(false),
  })
  .superRefine((entry, context) => {
    const localFindingsSha256 = digestCanonical(entry.sourceAudit.localMetadataPrivacy);
    if (
      entry.packageOriginal.sha256 === entry.canonicalNormalized.sha256 ||
      entry.canonicalNormalized.detectedMediaType !== 'image/png' ||
      entry.packageOriginal.pixelWidth !== entry.canonicalNormalized.pixelWidth ||
      entry.packageOriginal.pixelHeight !== entry.canonicalNormalized.pixelHeight ||
      entry.intakeEvidence.originalSourceSha256 !== entry.packageOriginal.sha256 ||
      entry.intakeEvidence.normalizedSourceSha256 !== entry.canonicalNormalized.sha256 ||
      entry.intakeEvidence.localFindingsSha256 !== localFindingsSha256 ||
      entry.draftReview.sourceDimensions.pixelWidth !== entry.packageOriginal.pixelWidth ||
      entry.draftReview.sourceDimensions.pixelHeight !== entry.packageOriginal.pixelHeight ||
      !exactCanonicalEquality(entry.intakeEvidence.caps, PENDING_BENCHMARK_CAPS_BINDING_V1) ||
      !exactCanonicalEquality(
        entry.intakeEvidence.manualControl,
        PENDING_ENGAGED_MANUAL_CONTROL_BINDING_V1,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Pending source, local findings, evidence, dimensions, caps, or control drifted.',
      });
    }
  })
  .readonly();

const box = (xBps: number, yBps: number, widthBps: number, heightBps: number) => ({
  unit: 'normalized-basis-points' as const,
  xBps,
  yBps,
  widthBps,
  heightBps,
});

const localFindingsSha256 = (findings: unknown): string => digestCanonical(findings);

const intakeEvidenceFor = (
  originalSourceSha256: string,
  normalizedSourceSha256: string,
  findings: unknown,
) => {
  const core = {
    evidenceVersion: 1 as const,
    evidenceRole: 'user-intake-permission-not-execution-authorization' as const,
    exactUserStatement: THREE_BANNER_INTAKE_PERMISSION_STATEMENT,
    exactUserStatementSha256: THREE_BANNER_INTAKE_PERMISSION_STATEMENT_SHA256,
    rightsAssertion: 'owner-or-permitted' as const,
    humanLicenseClassification:
      'pending-user-classification-as-user-owned-or-explicitly-licensed' as const,
    userPrivacyAssertion: 'contains-no-sensitive-or-private-information' as const,
    humanPrivacyAdmissionStatus: 'pending-human-confirmation' as const,
    localFindingsSha256: localFindingsSha256(findings),
    originalSourceSha256,
    normalizedSourceSha256,
    transmissionScope: 'openai-only-capped-fabrica-benchmark-future-milestone' as const,
    currentMilestoneTransmission: 'forbidden-and-not-performed' as const,
    humanReviewRequirement: 'human-approval-required-before-any-admission' as const,
    humanAdmissionStatus: 'pending' as const,
    caps: PENDING_BENCHMARK_CAPS_BINDING_V1,
    manualControl: PENDING_ENGAGED_MANUAL_CONTROL_BINDING_V1,
  };
  return { ...core, evidenceSha256: digestPendingIntakeEvidenceV1(core) };
};

const personLocalFindings = {
  reviewVersion: 1 as const,
  reviewActor: 'codex-local-inspection' as const,
  reviewScope: 'original-container-metadata-and-visible-pixels' as const,
  humanApprovalAuthority: false as const,
  originalAncillaryByteSize: 878,
  originalMetadataFindings: [
    'png-icc-profile-including-apple-profile-data',
    'png-exif-user-comment-screenshot',
    'png-adobe-xmp-packet',
  ] as const,
  visiblePrivacyOrRightsConcerns: [
    'recognizable-adult-likeness',
    'placeholder-visible-url',
    'faint-repeated-watermark-text',
  ] as const,
  normalizedMetadataDisposition:
    'canonical-normalization-stripped-all-container-ancillary-metadata' as const,
  humanPrivacyAdmissionStatus: 'pending-human-confirmation' as const,
};

const productLocalFindings = {
  reviewVersion: 1 as const,
  reviewActor: 'codex-local-inspection' as const,
  reviewScope: 'original-container-metadata-and-visible-pixels' as const,
  humanApprovalAuthority: false as const,
  originalAncillaryByteSize: 888,
  originalMetadataFindings: [
    'jpeg-photoshop-xmp-packet',
    'jpeg-xmp-document-and-instance-identifiers',
    'jpeg-exif-and-adobe-metadata',
  ] as const,
  visiblePrivacyOrRightsConcerns: [
    'visible-brand-and-label-text',
    'no-additional-obvious-sensitive-content-locally-observed',
  ] as const,
  normalizedMetadataDisposition:
    'canonical-normalization-stripped-all-container-ancillary-metadata' as const,
  humanPrivacyAdmissionStatus: 'pending-human-confirmation' as const,
};

const textHeavyLocalFindings = {
  reviewVersion: 1 as const,
  reviewActor: 'codex-local-inspection' as const,
  reviewScope: 'original-container-metadata-and-visible-pixels' as const,
  humanApprovalAuthority: false as const,
  originalAncillaryByteSize: 14,
  originalMetadataFindings: ['jpeg-jfif-payload-only'] as const,
  visiblePrivacyOrRightsConcerns: [
    'visible-brand-and-label-text',
    'faint-watermark-text',
    'no-additional-obvious-sensitive-content-locally-observed',
  ] as const,
  normalizedMetadataDisposition:
    'canonical-normalization-stripped-all-container-ancillary-metadata' as const,
  humanPrivacyAdmissionStatus: 'pending-human-confirmation' as const,
};

const pendingEntries = [
  {
    pendingEntryVersion: 1 as const,
    fixtureId: 'banner-person-v1',
    sourceAudit: {
      auditVersion: 1 as const,
      intakeFilename: '1-person.png' as const,
      byteTypeDetection: 'trusted-byte-level-container-parser' as const,
      currentBannerRasterLimits: 'passed' as const,
      benchmarkIntakeLimits: 'passed' as const,
      malformedOrAmbiguous: false as const,
      duplicateStatus: 'unique-original-and-normalized-across-six-digests' as const,
      localMetadataPrivacy: personLocalFindings,
    },
    packageOriginal: {
      packageRelativePath:
        'packages/banner-ai/test/fixtures/real-model-benchmark/original/banner-person-v1.png',
      filename: 'banner-person-v1.png',
      detectedMediaType: 'image/png' as const,
      byteSize: 229_241,
      pixelWidth: 876,
      pixelHeight: 221,
      sha256: 'd9a5a64f4fb4353a11d2fac605049b8cf1565ee8a056cf792f0181d1798189d3',
    },
    canonicalNormalized: {
      packageRelativePath:
        'packages/banner-ai/test/fixtures/real-model-benchmark/normalized/banner-person-v1.png',
      filename: 'banner-person-v1.png',
      detectedMediaType: 'image/png' as const,
      byteSize: 241_013,
      pixelWidth: 876,
      pixelHeight: 221,
      sha256: '6e3175cdd260fde33a3885945eb6f8831da3905afbc723f684035f411dc6d699',
    },
    intakeEvidence: intakeEvidenceFor(
      'd9a5a64f4fb4353a11d2fac605049b8cf1565ee8a056cf792f0181d1798189d3',
      '6e3175cdd260fde33a3885945eb6f8831da3905afbc723f684035f411dc6d699',
      personLocalFindings,
    ),
    draftReview: {
      draftVersion: 1 as const,
      evidenceRole: 'codex-draft-unapproved' as const,
      reviewStatus: 'draft-unapproved' as const,
      humanApprovalAuthority: false as const,
      sourceDimensions: { pixelWidth: 876, pixelHeight: 221 },
      scenarioAssessment: 'mixed-subject-copy-candidate' as const,
      proposedSemanticLayers: [
        {
          draftLayerId: 'person.background',
          proposedLabel: 'Red, orange, and cream geometric background',
          proposedRole: 'background' as const,
          proposedBox: box(0, 0, 10_000, 10_000),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftLayerId: 'person.copy-block',
          proposedLabel: 'Left headline and body copy',
          proposedRole: 'text' as const,
          proposedBox: box(300, 700, 3_100, 8_700),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftLayerId: 'person.call-to-action',
          proposedLabel: 'Learn More button and website line',
          proposedRole: 'foreground' as const,
          proposedBox: box(3_900, 5_900, 1_900, 3_200),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftLayerId: 'person.adult-subject',
          proposedLabel: 'Recognizable adult in business attire',
          proposedRole: 'subject' as const,
          proposedBox: box(6_400, 0, 2_200, 10_000),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftLayerId: 'person.logo',
          proposedLabel: 'Your Logo placeholder mark',
          proposedRole: 'decoration' as const,
          proposedBox: box(8_850, 7_650, 1_050, 1_950),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
      ],
      proposedVisibleText: [
        {
          draftTextId: 'person.text.build',
          transcription: 'BUILD',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(400, 900, 1_200, 1_350),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftTextId: 'person.text.your',
          transcription: 'YOUR',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(400, 2_450, 1_250, 1_250),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftTextId: 'person.text.business',
          transcription: 'BUSINESS',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(400, 4_100, 1_950, 1_600),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftTextId: 'person.text.body',
          transcription: 'Lorem ipsum dolor sit\namet, consectetur adipiscing\nelit sed non risus.',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(400, 6_950, 2_600, 2_400),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftTextId: 'person.text.learn-more',
          transcription: 'Learn More',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(4_150, 6_250, 1_150, 950),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftTextId: 'person.text.website',
          transcription: 'www.yourwebsite.com',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(3_900, 8_250, 1_800, 750),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftTextId: 'person.text.logo',
          transcription: 'YOUR\nLOGO',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(8_950, 7_950, 850, 1_500),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftTextId: 'person.text.watermarks',
          transcription: null,
          transcriptionCompleteness: 'incomplete-human-review-required' as const,
          proposedBox: null,
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
      ],
      backgroundClassification: 'geometric-graphic-background' as const,
      uncertaintyAndReviewFlags: [
        'layer-boxes-approximate',
        'adult-likeness-model-release-human-decision-required',
        'placeholder-url-tracking-human-decision-required',
        'faint-watermark-transcription-and-license-human-review-required',
      ] as const,
      humanReviewWorksheet: [
        'Confirm or correct every proposed semantic-layer box and role.',
        'Confirm every exact visible-text transcription and bounding box.',
        'Identify the faint repeated watermark text without guessing and decide whether it is permitted.',
        'Confirm likeness/model-release permission for the recognizable adult.',
        'Classify the placeholder URL as acceptable or reject it as visible tracking/link content.',
        'Classify the source as user-owned or explicitly licensed for OpenAI evaluation.',
      ],
    },
    admissionAuthority: false as const,
    requestPlanAuthority: false as const,
    dispatchAuthority: false as const,
  },
  {
    pendingEntryVersion: 1 as const,
    fixtureId: 'banner-product-v1',
    sourceAudit: {
      auditVersion: 1 as const,
      intakeFilename: '2-product.jpg' as const,
      byteTypeDetection: 'trusted-byte-level-container-parser' as const,
      currentBannerRasterLimits: 'passed' as const,
      benchmarkIntakeLimits: 'passed' as const,
      malformedOrAmbiguous: false as const,
      duplicateStatus: 'unique-original-and-normalized-across-six-digests' as const,
      localMetadataPrivacy: productLocalFindings,
    },
    packageOriginal: {
      packageRelativePath:
        'packages/banner-ai/test/fixtures/real-model-benchmark/original/banner-product-v1.jpg',
      filename: 'banner-product-v1.jpg',
      detectedMediaType: 'image/jpeg' as const,
      byteSize: 217_384,
      pixelWidth: 2_015,
      pixelHeight: 900,
      sha256: 'ce1be4eacbd65763d1d2b2835f9ad49c50cd9b3f56edc4a6a289822965bf09c5',
    },
    canonicalNormalized: {
      packageRelativePath:
        'packages/banner-ai/test/fixtures/real-model-benchmark/normalized/banner-product-v1.png',
      filename: 'banner-product-v1.png',
      detectedMediaType: 'image/png' as const,
      byteSize: 1_984_404,
      pixelWidth: 2_015,
      pixelHeight: 900,
      sha256: 'a38db6f627ee275eabf7643c99a83aac5e1ac77bbfe1b1abcc24112c6a04e69a',
    },
    intakeEvidence: intakeEvidenceFor(
      'ce1be4eacbd65763d1d2b2835f9ad49c50cd9b3f56edc4a6a289822965bf09c5',
      'a38db6f627ee275eabf7643c99a83aac5e1ac77bbfe1b1abcc24112c6a04e69a',
      productLocalFindings,
    ),
    draftReview: {
      draftVersion: 1 as const,
      evidenceRole: 'codex-draft-unapproved' as const,
      reviewStatus: 'draft-unapproved' as const,
      humanApprovalAuthority: false as const,
      sourceDimensions: { pixelWidth: 2_015, pixelHeight: 900 },
      scenarioAssessment: 'text-containing-product-candidate-ineligible-for-no-text-slot' as const,
      proposedSemanticLayers: [
        {
          draftLayerId: 'product.background',
          proposedLabel: 'Blurred light interior and marble surface',
          proposedRole: 'background' as const,
          proposedBox: box(0, 0, 10_000, 10_000),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftLayerId: 'product.plants',
          proposedLabel: 'Blurred plants and patterned panel',
          proposedRole: 'decoration' as const,
          proposedBox: box(200, 500, 5_800, 4_700),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftLayerId: 'product.candle',
          proposedLabel: 'Foreground candle jar and label',
          proposedRole: 'subject' as const,
          proposedBox: box(3_000, 3_900, 2_200, 5_900),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftLayerId: 'product.headline',
          proposedLabel: 'Right-side blurry background headline',
          proposedRole: 'text' as const,
          proposedBox: box(6_100, 2_200, 3_000, 1_400),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
      ],
      proposedVisibleText: [
        {
          draftTextId: 'product.text.headline',
          transcription: 'blurry background',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(6_150, 2_550, 2_750, 650),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftTextId: 'product.text.brand',
          transcription: 'TONKA + OUD',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(3_500, 6_650, 1_100, 500),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftTextId: 'product.text.label-company',
          transcription: 'candles, candles, candles co.',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(3_500, 7_150, 1_100, 300),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftTextId: 'product.text.label-type',
          transcription: 'soy wax candle',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(4_050, 8_100, 600, 300),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftTextId: 'product.text.label-weight',
          transcription: 'NET WT. 8 OZ',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(4_050, 8_500, 600, 300),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
      ],
      backgroundClassification: 'photographic-shallow-depth-of-field-background' as const,
      uncertaintyAndReviewFlags: [
        'layer-boxes-approximate',
        'brand-and-label-transcription-human-confirmation-required',
        'ineligible-for-no-text-scenario',
      ] as const,
      humanReviewWorksheet: [
        'Confirm or correct every proposed semantic-layer box and role.',
        'Confirm the blurry background headline and every candle-label transcription and box.',
        'Confirm the visible brand/product content is permitted for OpenAI evaluation.',
        'Acknowledge that this fixture contains visible text and cannot fill the required no-text slot.',
        'Classify the source as user-owned or explicitly licensed for OpenAI evaluation.',
      ],
    },
    admissionAuthority: false as const,
    requestPlanAuthority: false as const,
    dispatchAuthority: false as const,
  },
  {
    pendingEntryVersion: 1 as const,
    fixtureId: 'banner-text-heavy-v1',
    sourceAudit: {
      auditVersion: 1 as const,
      intakeFilename: '3-text-heavy.jpg' as const,
      byteTypeDetection: 'trusted-byte-level-container-parser' as const,
      currentBannerRasterLimits: 'passed' as const,
      benchmarkIntakeLimits: 'passed' as const,
      malformedOrAmbiguous: false as const,
      duplicateStatus: 'unique-original-and-normalized-across-six-digests' as const,
      localMetadataPrivacy: textHeavyLocalFindings,
    },
    packageOriginal: {
      packageRelativePath:
        'packages/banner-ai/test/fixtures/real-model-benchmark/original/banner-text-heavy-v1.jpg',
      filename: 'banner-text-heavy-v1.jpg',
      detectedMediaType: 'image/jpeg' as const,
      byteSize: 25_417,
      pixelWidth: 416,
      pixelHeight: 522,
      sha256: '886afa4806fd252175d08a56eb5cae4989f3ac59c6a0c6e0a59f8a6d61195d77',
    },
    canonicalNormalized: {
      packageRelativePath:
        'packages/banner-ai/test/fixtures/real-model-benchmark/normalized/banner-text-heavy-v1.png',
      filename: 'banner-text-heavy-v1.png',
      detectedMediaType: 'image/png' as const,
      byteSize: 166_461,
      pixelWidth: 416,
      pixelHeight: 522,
      sha256: '181e4c3762b79b5dfcbdb21c6c873ede8b32bf85dfe98fdecc13d59fb8cbcb62',
    },
    intakeEvidence: intakeEvidenceFor(
      '886afa4806fd252175d08a56eb5cae4989f3ac59c6a0c6e0a59f8a6d61195d77',
      '181e4c3762b79b5dfcbdb21c6c873ede8b32bf85dfe98fdecc13d59fb8cbcb62',
      textHeavyLocalFindings,
    ),
    draftReview: {
      draftVersion: 1 as const,
      evidenceRole: 'codex-draft-unapproved' as const,
      reviewStatus: 'draft-unapproved' as const,
      humanApprovalAuthority: false as const,
      sourceDimensions: { pixelWidth: 416, pixelHeight: 522 },
      scenarioAssessment: 'text-heavy-candidate' as const,
      proposedSemanticLayers: [
        {
          draftLayerId: 'text-heavy.background',
          proposedLabel: 'Neutral gray product-mockup background and floor',
          proposedRole: 'background' as const,
          proposedBox: box(0, 0, 10_000, 10_000),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftLayerId: 'text-heavy.stand',
          proposedLabel: 'Retractable banner stand hardware',
          proposedRole: 'subject' as const,
          proposedBox: box(1_900, 300, 6_100, 9_600),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftLayerId: 'text-heavy.header',
          proposedLabel: 'Brand mark, red header art, and BANNER OPTIONS title',
          proposedRole: 'text' as const,
          proposedBox: box(2_150, 800, 5_650, 3_400),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftLayerId: 'text-heavy.options',
          proposedLabel: 'Numbered banner option list',
          proposedRole: 'text' as const,
          proposedBox: box(2_200, 4_300, 5_550, 4_500),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftLayerId: 'text-heavy.footer-accent',
          proposedLabel: 'Red lower banner accent and stand base',
          proposedRole: 'foreground' as const,
          proposedBox: box(2_000, 8_250, 5_900, 1_700),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
      ],
      proposedVisibleText: [
        {
          draftTextId: 'text-heavy.text.brand',
          transcription: 'HALF PRICE\nBANNERS',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(5_600, 850, 1_450, 950),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftTextId: 'text-heavy.text.title',
          transcription: 'BANNER\nOPTIONS',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(2_650, 2_000, 4_500, 1_250),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftTextId: 'text-heavy.text.option-1-number',
          transcription: '1',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(2_600, 4_650, 500, 450),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftTextId: 'text-heavy.text.option-1',
          transcription: 'Large Format Double-\nSided Banners',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(3_450, 4_600, 4_200, 700),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftTextId: 'text-heavy.text.option-2-number',
          transcription: '2',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(2_600, 5_600, 500, 450),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftTextId: 'text-heavy.text.option-2',
          transcription: 'Large Format Vinyl\nBanners',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(3_450, 5_550, 4_200, 700),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftTextId: 'text-heavy.text.option-3-number',
          transcription: '3',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(2_600, 6_550, 500, 450),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftTextId: 'text-heavy.text.option-3',
          transcription: 'Large Format Double-\nSided Fence Banners',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(3_450, 6_500, 4_300, 750),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftTextId: 'text-heavy.text.option-4-number',
          transcription: '4',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(2_600, 7_500, 500, 450),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftTextId: 'text-heavy.text.option-4',
          transcription: 'Large Format Mesh\nBanners',
          transcriptionCompleteness: 'complete-codex-draft' as const,
          proposedBox: box(3_450, 7_450, 4_200, 700),
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
        {
          draftTextId: 'text-heavy.text.watermark',
          transcription: null,
          transcriptionCompleteness: 'incomplete-human-review-required' as const,
          proposedBox: null,
          basis: 'codex-local-visual-estimate-requires-human-review' as const,
        },
      ],
      backgroundClassification: 'photographic-product-mockup-on-neutral-background' as const,
      uncertaintyAndReviewFlags: [
        'layer-boxes-approximate',
        'faint-watermark-transcription-and-license-human-review-required',
      ] as const,
      humanReviewWorksheet: [
        'Confirm or correct every proposed semantic-layer box and role.',
        'Confirm the brand, title, option numbers, option copy, line breaks, and every text box.',
        'Identify the faint watermark text without guessing and decide whether it is permitted.',
        'Confirm the HALF PRICE BANNERS branding is permitted for OpenAI evaluation.',
        'Classify the source as user-owned or explicitly licensed for OpenAI evaluation.',
      ],
    },
    admissionAuthority: false as const,
    requestPlanAuthority: false as const,
    dispatchAuthority: false as const,
  },
] as const;

const PendingRealModelBenchmarkCorpusCoreV1Schema = z
  .strictObject({
    pendingManifestVersion: z.literal(1),
    profileId: z.literal(REAL_MODEL_BENCHMARK_PROFILE_ID),
    status: z.literal('oracle-review-pending'),
    purpose: z.literal('local-three-banner-corpus-preparation-for-future-capped-openai-benchmark'),
    repositoryBindings: PendingRepositoryEvidenceBindingsV1Schema,
    entries: z.array(PendingRealModelBenchmarkCorpusEntryV1Schema).length(3).readonly(),
    contractGap: z.literal(
      'all-three-images-contain-visible-text-genuine-zero-text-layered-fixture-still-required',
    ),
    conversionBlocker: z.literal(
      'human-license-privacy-text-layer-and-scenario-review-required-before-separate-admission-milestone',
    ),
    active: z.literal(false),
    dispatchable: z.literal(false),
    admissionAuthority: z.literal(false),
    requestPlanAuthority: z.literal(false),
    dispatchAuthority: z.literal(false),
    productionSourceRegistry: z.literal('empty-unchanged'),
    providerTransport: z.literal('absent'),
    committedExecutionAuthorization: z.literal('absent'),
  })
  .superRefine((manifest, context) => {
    const fixtureIds = manifest.entries.map((entry) => entry.fixtureId);
    const originalDigests = manifest.entries.map((entry) => entry.packageOriginal.sha256);
    const normalizedDigests = manifest.entries.map((entry) => entry.canonicalNormalized.sha256);
    const allDigests = [...originalDigests, ...normalizedDigests];
    if (new Set(fixtureIds).size !== 3) {
      context.addIssue({ code: 'custom', message: 'Pending fixture IDs must be unique.' });
    }
    if (
      new Set(originalDigests).size !== 3 ||
      new Set(normalizedDigests).size !== 3 ||
      new Set(allDigests).size !== 6
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Pending original and normalized digests must be unique across all six files.',
      });
    }
    if (
      sha256Hex(Buffer.from(THREE_BANNER_INTAKE_PERMISSION_STATEMENT, 'utf8')) !==
      THREE_BANNER_INTAKE_PERMISSION_STATEMENT_SHA256
    ) {
      context.addIssue({ code: 'custom', message: 'Exact user statement digest drifted.' });
    }
    if (
      !exactCanonicalEquality(
        manifest.repositoryBindings,
        PENDING_REAL_MODEL_BENCHMARK_REPOSITORY_BINDINGS_V1,
      ) ||
      !exactCanonicalEquality(manifest.repositoryBindings, currentRepositoryEvidenceBindings())
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Pinned profile, candidate, prompt, policy, pricing, workflow, caps, or control drifted.',
      });
    }
  })
  .readonly();

export const digestPendingRealModelBenchmarkCorpusCoreV1 = (input: unknown): string =>
  digestCanonical(PendingRealModelBenchmarkCorpusCoreV1Schema.parse(input));

export const PendingRealModelBenchmarkCorpusV1Schema = z
  .strictObject({
    pendingManifestVersion: z.literal(1),
    profileId: z.literal(REAL_MODEL_BENCHMARK_PROFILE_ID),
    status: z.literal('oracle-review-pending'),
    purpose: z.literal('local-three-banner-corpus-preparation-for-future-capped-openai-benchmark'),
    repositoryBindings: PendingRepositoryEvidenceBindingsV1Schema,
    entries: z.array(PendingRealModelBenchmarkCorpusEntryV1Schema).length(3).readonly(),
    contractGap: z.literal(
      'all-three-images-contain-visible-text-genuine-zero-text-layered-fixture-still-required',
    ),
    conversionBlocker: z.literal(
      'human-license-privacy-text-layer-and-scenario-review-required-before-separate-admission-milestone',
    ),
    active: z.literal(false),
    dispatchable: z.literal(false),
    admissionAuthority: z.literal(false),
    requestPlanAuthority: z.literal(false),
    dispatchAuthority: z.literal(false),
    productionSourceRegistry: z.literal('empty-unchanged'),
    providerTransport: z.literal('absent'),
    committedExecutionAuthorization: z.literal('absent'),
    pendingCoreSha256: z.literal(PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_SHA256),
  })
  .superRefine((manifest, context) => {
    const { pendingCoreSha256, ...core } = manifest;
    const fixtureIds = manifest.entries.map((entry) => entry.fixtureId);
    const allDigests = manifest.entries.flatMap((entry) => [
      entry.packageOriginal.sha256,
      entry.canonicalNormalized.sha256,
    ]);
    if (new Set(fixtureIds).size !== 3) {
      context.addIssue({ code: 'custom', message: 'Pending fixture IDs must be unique.' });
    }
    if (new Set(allDigests).size !== 6) {
      context.addIssue({
        code: 'custom',
        message: 'Pending original and normalized digests must be unique across all six files.',
      });
    }
    const parsedCore = PendingRealModelBenchmarkCorpusCoreV1Schema.safeParse(core);
    if (
      !parsedCore.success ||
      pendingCoreSha256 !== digestPendingRealModelBenchmarkCorpusCoreV1(core)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Pending corpus whole-core digest drifted.',
        path: ['pendingCoreSha256'],
      });
    }
  })
  .readonly();

const pendingManifestCore = {
  pendingManifestVersion: 1 as const,
  profileId: REAL_MODEL_BENCHMARK_PROFILE_ID,
  status: 'oracle-review-pending' as const,
  purpose: 'local-three-banner-corpus-preparation-for-future-capped-openai-benchmark' as const,
  repositoryBindings: PENDING_REAL_MODEL_BENCHMARK_REPOSITORY_BINDINGS_V1,
  entries: pendingEntries,
  contractGap:
    'all-three-images-contain-visible-text-genuine-zero-text-layered-fixture-still-required' as const,
  conversionBlocker:
    'human-license-privacy-text-layer-and-scenario-review-required-before-separate-admission-milestone' as const,
  active: false as const,
  dispatchable: false as const,
  admissionAuthority: false as const,
  requestPlanAuthority: false as const,
  dispatchAuthority: false as const,
  productionSourceRegistry: 'empty-unchanged' as const,
  providerTransport: 'absent' as const,
  committedExecutionAuthorization: 'absent' as const,
};

export const REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1 = PendingRealModelBenchmarkCorpusV1Schema.parse(
  {
    ...pendingManifestCore,
    pendingCoreSha256: PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_SHA256,
  },
);

export type PendingRealModelBenchmarkCorpusEntryV1 = z.infer<
  typeof PendingRealModelBenchmarkCorpusEntryV1Schema
>;
export type PendingRealModelBenchmarkCorpusV1 = z.infer<
  typeof PendingRealModelBenchmarkCorpusV1Schema
>;
