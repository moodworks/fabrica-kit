import { z } from 'zod';

import { parseMicros } from '../jobs/cost-budget.js';
import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import { REAL_MODEL_BENCHMARK_PROFILE_ID } from './real-model-benchmark-corpus-manifest.js';
import {
  PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_SHA256,
  PENDING_REAL_MODEL_BENCHMARK_REPOSITORY_BINDINGS_V1,
  PendingRealModelBenchmarkCorpusEntryV1Schema,
  REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1,
  THREE_BANNER_INTAKE_PERMISSION_STATEMENT,
  THREE_BANNER_INTAKE_PERMISSION_STATEMENT_SHA256,
} from './real-model-benchmark-pending-corpus.js';
import {
  RealModelBenchmarkRetryPolicyV1Schema,
  ZERO_RETRY_REAL_MODEL_BENCHMARK_POLICY_V1,
} from './real-model-benchmark-profile.js';

export const FOURTH_BANNER_INTAKE_PERMISSION_STATEMENT_TEMPLATE =
  'I own or have permission to use [filename], it contains no sensitive/private information, and I authorize sending it to OpenAI solely for the capped Fabrica benchmark.' as const;
export const FOURTH_BANNER_INTAKE_RESOLVED_FILENAME = 'banners-tests/4-no-text.jpeg' as const;
export const FOURTH_BANNER_INTAKE_PERMISSION_STATEMENT =
  'I own or have permission to use banners-tests/4-no-text.jpeg, it contains no sensitive/private information, and I authorize sending it to OpenAI solely for the capped Fabrica benchmark.' as const;
export const FOURTH_BANNER_INTAKE_PERMISSION_STATEMENT_SHA256 =
  '08ac203542aa678d0992b1ac997b42c7e9b187a1de65901be876ff043de82600' as const;

export const FOURTH_BANNER_ORIGINAL_SHA256 =
  'af4ee315a16887692aaec4e972615535a086a906b43257eb1c78aa50212d31c3' as const;
export const FOURTH_BANNER_NORMALIZED_SHA256 =
  '40f8a1c4312ec86cb4e38e16b9a423e85c2a9e3cf5f98a4bc510c23f3d4cf073' as const;

const FOURTH_BANNER_PACKAGE_ORIGINAL_PATH =
  'packages/banner-ai/test/fixtures/real-model-benchmark/original/banner-no-text-v1.jpeg' as const;
const FOURTH_BANNER_PACKAGE_NORMALIZED_PATH =
  'packages/banner-ai/test/fixtures/real-model-benchmark/normalized/banner-no-text-v1.png' as const;
const FOURTH_BANNER_PACKAGE_ORIGINAL_FILENAME = 'banner-no-text-v1.jpeg' as const;
const FOURTH_BANNER_PACKAGE_NORMALIZED_FILENAME = 'banner-no-text-v1.png' as const;

const digestCanonical = (input: unknown): string =>
  sha256Hex(Buffer.from(canonicalizeJson(input), 'utf8'));

const exactCanonicalEquality = (left: unknown, right: unknown): boolean =>
  canonicalizeJson(left) === canonicalizeJson(right);

const FourFixturePendingCapsRevisionCoreV2Schema = z
  .strictObject({
    revisionVersion: z.literal(2),
    revisionId: z.literal('banner-ai-four-fixture-pending-caps-v2'),
    state: z.literal('disabled'),
    scope: z.literal('pending-corpus-ceilings-only'),
    supersedes: z.literal('three-fixture-pending-ceilings-only'),
    doesNotSupersede: z
      .tuple([
        z.literal('real-model-benchmark-profile-v1'),
        z.literal('real-model-benchmark-execution-v1'),
        z.literal('real-model-benchmark-authorization-v1'),
        z.literal('real-model-benchmark-execution-ledger-v1'),
      ])
      .readonly(),
    fixtureCount: z.literal(4),
    successfulRunsPerFixture: z.literal(2),
    requiredSuccessfulRunCount: z.literal(8),
    maximumProviderCalls: z.literal(12),
    maximumRetriesPerFixtureAcrossBothRuns: z.literal(1),
    maximumRetriesTotal: z.literal(4),
    maximumFailedAttemptsPerFixture: z.literal(2),
    maximumFailedAttempts: z.literal(4),
    perCallCostCeilingMicroUsd: z.literal('100000'),
    totalCostCeilingMicroUsd: z.literal('1200000'),
    maximumAttemptedCallMs: z.literal(60_000),
    maximumLogicalRunMs: z.literal(120_000),
    maximumTotalWallClockMs: z.literal(800_000),
    retryPolicy: RealModelBenchmarkRetryPolicyV1Schema,
    numericalRetryCaps: z.literal('ceilings-retained-but-zero-retry-policy-controls'),
    authority: z.literal('ceilings-only-no-call-or-execution-authority'),
  })
  .superRefine((caps, context) => {
    if (!exactCanonicalEquality(caps.retryPolicy, ZERO_RETRY_REAL_MODEL_BENCHMARK_POLICY_V1)) {
      context.addIssue({
        code: 'custom',
        message: 'The four-fixture pending revision retains the exact zero-retry policy.',
      });
    }
    if (caps.fixtureCount * caps.successfulRunsPerFixture !== caps.requiredSuccessfulRunCount) {
      context.addIssue({
        code: 'custom',
        message: 'Four-fixture successful-run arithmetic is inconsistent.',
      });
    }
    if (
      caps.requiredSuccessfulRunCount + caps.maximumFailedAttempts !==
      caps.maximumProviderCalls
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Four-fixture provider-call arithmetic is inconsistent.',
      });
    }
    if (
      caps.fixtureCount * caps.maximumRetriesPerFixtureAcrossBothRuns !==
      caps.maximumRetriesTotal
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Four-fixture numerical retry ceilings are inconsistent.',
      });
    }
    if (
      parseMicros(caps.perCallCostCeilingMicroUsd) * BigInt(caps.maximumProviderCalls) !==
      parseMicros(caps.totalCostCeilingMicroUsd)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Four-fixture cost ceilings must use exact bigint micro-USD arithmetic.',
      });
    }
    if (
      caps.maximumLogicalRunMs !== caps.maximumAttemptedCallMs * 2 ||
      caps.maximumTotalWallClockMs < caps.maximumProviderCalls * caps.maximumAttemptedCallMs ||
      [caps.maximumAttemptedCallMs, caps.maximumLogicalRunMs, caps.maximumTotalWallClockMs].some(
        (duration) => duration % 1_000 !== 0,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Four-fixture call, logical-run, or total-duration arithmetic is inconsistent.',
      });
    }
  });

export const digestFourFixturePendingCapsRevisionV2 = (input: unknown): string =>
  digestCanonical(FourFixturePendingCapsRevisionCoreV2Schema.parse(input));

const fourFixturePendingCapsRevisionCore = {
  revisionVersion: 2 as const,
  revisionId: 'banner-ai-four-fixture-pending-caps-v2' as const,
  state: 'disabled' as const,
  scope: 'pending-corpus-ceilings-only' as const,
  supersedes: 'three-fixture-pending-ceilings-only' as const,
  doesNotSupersede: [
    'real-model-benchmark-profile-v1',
    'real-model-benchmark-execution-v1',
    'real-model-benchmark-authorization-v1',
    'real-model-benchmark-execution-ledger-v1',
  ] as const,
  fixtureCount: 4 as const,
  successfulRunsPerFixture: 2 as const,
  requiredSuccessfulRunCount: 8 as const,
  maximumProviderCalls: 12 as const,
  maximumRetriesPerFixtureAcrossBothRuns: 1 as const,
  maximumRetriesTotal: 4 as const,
  maximumFailedAttemptsPerFixture: 2 as const,
  maximumFailedAttempts: 4 as const,
  perCallCostCeilingMicroUsd: '100000' as const,
  totalCostCeilingMicroUsd: '1200000' as const,
  maximumAttemptedCallMs: 60_000 as const,
  maximumLogicalRunMs: 120_000 as const,
  maximumTotalWallClockMs: 800_000 as const,
  retryPolicy: ZERO_RETRY_REAL_MODEL_BENCHMARK_POLICY_V1,
  numericalRetryCaps: 'ceilings-retained-but-zero-retry-policy-controls' as const,
  authority: 'ceilings-only-no-call-or-execution-authority' as const,
};

export const FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256 =
  '441f97ae556252b601e8e788896e552f2215bf0ffe1d48f9a36d144fe6fa9295' as const;

export const FourFixturePendingCapsRevisionV2Schema = z
  .strictObject({
    ...FourFixturePendingCapsRevisionCoreV2Schema.shape,
    capsRevisionSha256: Sha256HexSchema,
  })
  .superRefine((caps, context) => {
    const { capsRevisionSha256, ...core } = caps;
    if (capsRevisionSha256 !== digestFourFixturePendingCapsRevisionV2(core)) {
      context.addIssue({
        code: 'custom',
        message: 'Four-fixture pending cap revision digest drifted.',
        path: ['capsRevisionSha256'],
      });
    }
  })
  .readonly();

export const FOUR_FIXTURE_PENDING_CAPS_REVISION_V2 = FourFixturePendingCapsRevisionV2Schema.parse({
  ...fourFixturePendingCapsRevisionCore,
  capsRevisionSha256: FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256,
});

const PendingPackageImageV2Schema = z
  .strictObject({
    packageRelativePath: z
      .string()
      .regex(
        /^packages\/banner-ai\/test\/fixtures\/real-model-benchmark\/(?:original|normalized)\/[a-z0-9.-]+$/u,
      ),
    filename: z.string().regex(/^[a-z0-9][a-z0-9.-]+\.(?:jpeg|png)$/u),
    detectedMediaType: z.enum(['image/jpeg', 'image/png']),
    byteSize: z.int().min(1).max(5_242_880),
    pixelWidth: z.int().min(64).max(2_048),
    pixelHeight: z.int().min(64).max(2_048),
    pixelCount: z.int().min(4_096).max(4_194_304),
    sha256: Sha256HexSchema,
    ancillaryByteSize: z.int().min(0).max(1_048_576),
  })
  .superRefine((image, context) => {
    const extension = image.filename.slice(image.filename.lastIndexOf('.') + 1);
    if (
      image.pixelWidth * image.pixelHeight !== image.pixelCount ||
      (image.detectedMediaType === 'image/jpeg' && extension !== 'jpeg') ||
      (image.detectedMediaType === 'image/png' && extension !== 'png')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Pending V2 image dimensions, extension, or byte-detected type drifted.',
      });
    }
  })
  .readonly();

export const FourthBannerLocalMetadataPrivacyFindingsV2Schema = z
  .strictObject({
    reviewVersion: z.literal(2),
    reviewActor: z.literal('codex-local-inspection'),
    reviewScope: z.literal('original-container-metadata-and-visible-pixels'),
    humanApprovalAuthority: z.literal(false),
    originalAncillaryByteSize: z.literal(14),
    originalMetadataFindings: z.tuple([z.literal('jpeg-jfif-payload-only')]).readonly(),
    normalizedAncillaryByteSize: z.literal(0),
    normalizedMetadataDisposition: z.literal(
      'canonical-normalization-stripped-all-container-ancillary-metadata',
    ),
    sensitiveOrPrivateContent: z.literal('none-observed-by-local-review'),
    humanPrivacyAdmissionStatus: z.literal('pending-human-confirmation'),
  })
  .readonly();

const fourthBannerLocalMetadataPrivacyFindings =
  FourthBannerLocalMetadataPrivacyFindingsV2Schema.parse({
    reviewVersion: 2,
    reviewActor: 'codex-local-inspection',
    reviewScope: 'original-container-metadata-and-visible-pixels',
    humanApprovalAuthority: false,
    originalAncillaryByteSize: 14,
    originalMetadataFindings: ['jpeg-jfif-payload-only'],
    normalizedAncillaryByteSize: 0,
    normalizedMetadataDisposition:
      'canonical-normalization-stripped-all-container-ancillary-metadata',
    sensitiveOrPrivateContent: 'none-observed-by-local-review',
    humanPrivacyAdmissionStatus: 'pending-human-confirmation',
  });

export const FOURTH_BANNER_LOCAL_FINDINGS_SHA256 =
  '704fe1e07e54a126a0e454009e6938332758dc2088e8c1b831ff50c36f684499' as const;

const FourthBannerVisibleContentFindingsV2Schema = z
  .strictObject({
    semanticText: z.literal('none-observed'),
    lettering: z.literal('none-observed'),
    watermark: z.literal('none-observed'),
    logoLettering: z.literal('none-observed'),
    url: z.literal('none-observed'),
    label: z.literal('none-observed'),
    signature: z.literal('none-observed'),
    person: z.literal('none-observed'),
    privateContent: z.literal('none-observed'),
    decorativeLetterformReviewFlag: z.literal(
      'cyan-angular-shapes-resemble-letterforms-but-are-not-automatically-semantic-text',
    ),
    classification: z.literal('draft-zero-semantic-text-candidate-pending-human-review'),
  })
  .readonly();

const FourthBannerSourceAuditV2Schema = z
  .strictObject({
    auditVersion: z.literal(2),
    intakeFilename: z.literal(FOURTH_BANNER_INTAKE_RESOLVED_FILENAME),
    filenameTrust: z.literal('not-trusted-byte-evidence-controls'),
    byteTypeDetection: z.literal('trusted-byte-level-container-parser'),
    actualContainer: z.literal('jpeg'),
    actualMimeType: z.literal('image/jpeg'),
    pixelWidth: z.literal(738),
    pixelHeight: z.literal(255),
    pixelCount: z.literal(188_190),
    originalByteSize: z.literal(15_312),
    originalSha256: z.literal(FOURTH_BANNER_ORIGINAL_SHA256),
    currentBannerRasterLimits: z.literal('passed'),
    benchmarkIntakeLimits: z.literal('passed'),
    malformedOrAmbiguousContainer: z.literal(false),
    committedComparisonDigestCount: z.literal(6),
    collisionStatus: z.literal('unique-original-and-normalized-across-all-eight-corpus-digests'),
    localMetadataPrivacy: FourthBannerLocalMetadataPrivacyFindingsV2Schema,
    visibleContent: FourthBannerVisibleContentFindingsV2Schema,
  })
  .readonly();

const ProposedBasisPointBoxV2Schema = z
  .strictObject({
    unit: z.literal('normalized-basis-points'),
    xBps: z.int().min(0).max(10_000),
    yBps: z.int().min(0).max(10_000),
    widthBps: z.int().min(1).max(10_000),
    heightBps: z.int().min(1).max(10_000),
  })
  .superRefine((box, context) => {
    if (box.xBps + box.widthBps > 10_000 || box.yBps + box.heightBps > 10_000) {
      context.addIssue({ code: 'custom', message: 'Draft V2 box exceeds the image plane.' });
    }
  })
  .readonly();

const ProposedSemanticLayerV2Schema = z
  .strictObject({
    draftLayerId: z.string().regex(/^[a-z0-9][a-z0-9.-]{7,79}$/u),
    proposedLabel: z.string().min(1).max(120),
    proposedRole: z.enum(['background', 'subject', 'foreground', 'decoration', 'other']),
    proposedBox: ProposedBasisPointBoxV2Schema,
    animationUsefulness: z.enum([
      'useful-static-anchor',
      'useful-for-subtle-depth-motion',
      'useful-for-independent-drift-or-rotation',
      'useful-for-border-emphasis',
    ]),
    animationRationale: z.string().min(10).max(180),
    basis: z.literal('codex-local-visual-estimate-requires-human-review'),
  })
  .readonly();

const DraftEmptyTextObservationSetV2Schema = z
  .strictObject({
    observationSetVersion: z.literal(2),
    evidenceRole: z.literal('codex-draft-unapproved'),
    reviewStatus: z.literal('draft-unapproved'),
    humanApprovalAuthority: z.literal(false),
    visibleTextResult: z.literal('no-semantic-text-observed'),
    observations: z.tuple([]).readonly(),
    conversionToHumanOracle: z.literal('forbidden-requires-separate-human-approved-evidence'),
  })
  .readonly();

export const CodexDraftUnapprovedZeroTextReviewV2Schema = z
  .strictObject({
    draftVersion: z.literal(2),
    evidenceRole: z.literal('codex-draft-unapproved'),
    reviewStatus: z.literal('draft-unapproved'),
    humanApprovalAuthority: z.literal(false),
    sourceDimensions: z
      .strictObject({ pixelWidth: z.literal(738), pixelHeight: z.literal(255) })
      .readonly(),
    scenarioAssessment: z.literal('no-text-layered-candidate'),
    explicitVisibleTextResult: z.literal('no-semantic-text-observed'),
    proposedSemanticLayers: z.array(ProposedSemanticLayerV2Schema).min(3).max(5).readonly(),
    draftTextObservationSet: DraftEmptyTextObservationSetV2Schema,
    backgroundClassification: z.literal('flat-peach-field-with-framed-cream-panel'),
    overallAnimationUsefulness: z.literal(
      'decorative-elements-could-support-subtle-independent-motion-after-human-approval',
    ),
    uncertaintyAndReviewFlags: z
      .tuple([
        z.literal('layer-boxes-approximate'),
        z.literal('decorative-elements-grouped-not-instance-segmented'),
        z.literal('frame-and-panel-boundary-requires-human-confirmation'),
        z.literal('cyan-angular-shapes-letterform-like-ambiguity'),
        z.literal('human-zero-text-confirmation-required'),
      ])
      .readonly(),
    humanReviewWorksheet: z.array(z.string().min(10).max(240)).min(3).max(8).readonly(),
  })
  .superRefine((draft, context) => {
    const layerIds = draft.proposedSemanticLayers.map((layer) => layer.draftLayerId);
    if (new Set(layerIds).size !== layerIds.length) {
      context.addIssue({ code: 'custom', message: 'Draft V2 semantic layer IDs must be unique.' });
    }
    if (draft.draftTextObservationSet.observations.length !== 0) {
      context.addIssue({
        code: 'custom',
        message:
          'The draft zero-text candidate cannot contain semantic text layers or observations.',
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

const fourthBannerDraftReview = CodexDraftUnapprovedZeroTextReviewV2Schema.parse({
  draftVersion: 2,
  evidenceRole: 'codex-draft-unapproved',
  reviewStatus: 'draft-unapproved',
  humanApprovalAuthority: false,
  sourceDimensions: { pixelWidth: 738, pixelHeight: 255 },
  scenarioAssessment: 'no-text-layered-candidate',
  explicitVisibleTextResult: 'no-semantic-text-observed',
  proposedSemanticLayers: [
    {
      draftLayerId: 'no-text.background',
      proposedLabel: 'Flat peach outer background',
      proposedRole: 'background',
      proposedBox: box(0, 0, 10_000, 10_000),
      animationUsefulness: 'useful-static-anchor',
      animationRationale: 'Stable field can anchor motion of the decorative foreground groups.',
      basis: 'codex-local-visual-estimate-requires-human-review',
    },
    {
      draftLayerId: 'no-text.panel',
      proposedLabel: 'Cream inner banner panel and soft shadow',
      proposedRole: 'subject',
      proposedBox: box(450, 1_650, 9_100, 6_900),
      animationUsefulness: 'useful-for-subtle-depth-motion',
      animationRationale:
        'A restrained depth offset could separate the panel from the outer field.',
      basis: 'codex-local-visual-estimate-requires-human-review',
    },
    {
      draftLayerId: 'no-text.frame',
      proposedLabel: 'Thin cyan and gray rounded frame lines',
      proposedRole: 'foreground',
      proposedBox: box(500, 1_750, 8_950, 6_500),
      animationUsefulness: 'useful-for-border-emphasis',
      animationRationale: 'A subtle border reveal could emphasize the framed composition.',
      basis: 'codex-local-visual-estimate-requires-human-review',
    },
    {
      draftLayerId: 'no-text.cyan-shapes',
      proposedLabel: 'Grouped cyan angular edge decorations',
      proposedRole: 'decoration',
      proposedBox: box(400, 1_650, 9_150, 6_700),
      animationUsefulness: 'useful-for-independent-drift-or-rotation',
      animationRationale:
        'Grouped angular accents could drift independently after instance review.',
      basis: 'codex-local-visual-estimate-requires-human-review',
    },
    {
      draftLayerId: 'no-text.sunbursts',
      proposedLabel: 'Grouped coral and peach sunburst decorations',
      proposedRole: 'decoration',
      proposedBox: box(250, 1_350, 9_300, 7_250),
      animationUsefulness: 'useful-for-independent-drift-or-rotation',
      animationRationale: 'Sunburst accents could support restrained rotation or parallax motion.',
      basis: 'codex-local-visual-estimate-requires-human-review',
    },
  ],
  draftTextObservationSet: {
    observationSetVersion: 2,
    evidenceRole: 'codex-draft-unapproved',
    reviewStatus: 'draft-unapproved',
    humanApprovalAuthority: false,
    visibleTextResult: 'no-semantic-text-observed',
    observations: [],
    conversionToHumanOracle: 'forbidden-requires-separate-human-approved-evidence',
  },
  backgroundClassification: 'flat-peach-field-with-framed-cream-panel',
  overallAnimationUsefulness:
    'decorative-elements-could-support-subtle-independent-motion-after-human-approval',
  uncertaintyAndReviewFlags: [
    'layer-boxes-approximate',
    'decorative-elements-grouped-not-instance-segmented',
    'frame-and-panel-boundary-requires-human-confirmation',
    'cyan-angular-shapes-letterform-like-ambiguity',
    'human-zero-text-confirmation-required',
  ],
  humanReviewWorksheet: [
    'Confirm that no cyan angular shape is intended as a semantic letter or logo.',
    'Approve or correct each grouped semantic-layer label, role, and normalized box.',
    'Confirm the panel, frame, shadow, and outer-field grouping boundaries.',
    'Approve the explicit empty text-observation set or record any semantic text found.',
    'Confirm the proposed animation usefulness remains review-only and non-authoritative.',
    'Classify the source as user-owned or explicitly licensed for OpenAI evaluation.',
  ],
});

const FourthImageIntakePermissionEvidenceCoreV2Schema = z
  .strictObject({
    evidenceVersion: z.literal(2),
    evidenceRole: z.literal('user-intake-permission-not-execution-authorization'),
    permissionScopeId: z.literal('exclusive-fourth-image-intake-scope-v2'),
    exactUserStatementTemplate: z.literal(FOURTH_BANNER_INTAKE_PERMISSION_STATEMENT_TEMPLATE),
    filenamePlaceholder: z.literal('[filename]'),
    contextualResolution: z
      .strictObject({
        resolvedFilename: z.literal(FOURTH_BANNER_INTAKE_RESOLVED_FILENAME),
        resolutionRule: z.literal(
          'contextually-and-exclusively-resolved-for-this-milestone-to-the-fourth-jpeg-intake',
        ),
      })
      .readonly(),
    renderedResolvedStatement: z.literal(FOURTH_BANNER_INTAKE_PERMISSION_STATEMENT),
    renderedResolvedStatementSha256: z.literal(FOURTH_BANNER_INTAKE_PERMISSION_STATEMENT_SHA256),
    rightsAssertion: z.literal('owner-or-permitted'),
    humanLicenseClassification: z.literal(
      'pending-user-classification-as-user-owned-or-explicitly-licensed',
    ),
    userPrivacyAssertion: z.literal('contains-no-sensitive-or-private-information'),
    humanPrivacyAdmissionStatus: z.literal('pending-human-confirmation'),
    localFindingsSha256: Sha256HexSchema,
    boundSourceDigestsInOrder: z
      .tuple([z.literal(FOURTH_BANNER_ORIGINAL_SHA256), z.literal(FOURTH_BANNER_NORMALIZED_SHA256)])
      .readonly(),
    capsRevisionSha256: z.literal(FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256),
    transmissionScope: z.literal('openai-only-capped-fabrica-benchmark-future-milestone'),
    currentMilestoneTransmission: z.literal('forbidden-and-not-performed'),
    humanReviewRequirement: z.literal('human-approval-required-before-any-admission'),
    humanAdmissionStatus: z.literal('pending'),
    executionAuthorization: z.literal('none'),
    admissionAuthority: z.literal(false),
    requestPlanAuthority: z.literal(false),
    dispatchAuthority: z.literal(false),
  })
  .superRefine((evidence, context) => {
    if (
      evidence.renderedResolvedStatement !==
        evidence.exactUserStatementTemplate.replace(
          evidence.filenamePlaceholder,
          evidence.contextualResolution.resolvedFilename,
        ) ||
      sha256Hex(Buffer.from(evidence.renderedResolvedStatement, 'utf8')) !==
        evidence.renderedResolvedStatementSha256 ||
      evidence.localFindingsSha256 !== digestCanonical(fourthBannerLocalMetadataPrivacyFindings) ||
      evidence.localFindingsSha256 !== FOURTH_BANNER_LOCAL_FINDINGS_SHA256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Fourth-image statement resolution or local evidence digest drifted.',
      });
    }
  });

export const digestFourthImageIntakePermissionEvidenceV2 = (input: unknown): string =>
  digestCanonical(FourthImageIntakePermissionEvidenceCoreV2Schema.parse(input));

const fourthImageIntakePermissionEvidenceCore = {
  evidenceVersion: 2 as const,
  evidenceRole: 'user-intake-permission-not-execution-authorization' as const,
  permissionScopeId: 'exclusive-fourth-image-intake-scope-v2' as const,
  exactUserStatementTemplate: FOURTH_BANNER_INTAKE_PERMISSION_STATEMENT_TEMPLATE,
  filenamePlaceholder: '[filename]' as const,
  contextualResolution: {
    resolvedFilename: FOURTH_BANNER_INTAKE_RESOLVED_FILENAME,
    resolutionRule:
      'contextually-and-exclusively-resolved-for-this-milestone-to-the-fourth-jpeg-intake' as const,
  },
  renderedResolvedStatement: FOURTH_BANNER_INTAKE_PERMISSION_STATEMENT,
  renderedResolvedStatementSha256: FOURTH_BANNER_INTAKE_PERMISSION_STATEMENT_SHA256,
  rightsAssertion: 'owner-or-permitted' as const,
  humanLicenseClassification:
    'pending-user-classification-as-user-owned-or-explicitly-licensed' as const,
  userPrivacyAssertion: 'contains-no-sensitive-or-private-information' as const,
  humanPrivacyAdmissionStatus: 'pending-human-confirmation' as const,
  localFindingsSha256: FOURTH_BANNER_LOCAL_FINDINGS_SHA256,
  boundSourceDigestsInOrder: [
    FOURTH_BANNER_ORIGINAL_SHA256,
    FOURTH_BANNER_NORMALIZED_SHA256,
  ] as const,
  capsRevisionSha256: FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256,
  transmissionScope: 'openai-only-capped-fabrica-benchmark-future-milestone' as const,
  currentMilestoneTransmission: 'forbidden-and-not-performed' as const,
  humanReviewRequirement: 'human-approval-required-before-any-admission' as const,
  humanAdmissionStatus: 'pending' as const,
  executionAuthorization: 'none' as const,
  admissionAuthority: false as const,
  requestPlanAuthority: false as const,
  dispatchAuthority: false as const,
};

export const FOURTH_IMAGE_INTAKE_PERMISSION_EVIDENCE_V2_SHA256 =
  '29a92d505c4432bf59f5520c24bbf79e45f4f0555c1e02feff970d3170c7282f' as const;

export const FourthImageIntakePermissionEvidenceV2Schema = z
  .strictObject({
    ...FourthImageIntakePermissionEvidenceCoreV2Schema.shape,
    evidenceSha256: Sha256HexSchema,
  })
  .superRefine((evidence, context) => {
    const { evidenceSha256, ...core } = evidence;
    if (evidenceSha256 !== digestFourthImageIntakePermissionEvidenceV2(core)) {
      context.addIssue({
        code: 'custom',
        message: 'Fourth-image intake permission evidence digest drifted.',
        path: ['evidenceSha256'],
      });
    }
  })
  .readonly();

export const FOURTH_IMAGE_INTAKE_PERMISSION_EVIDENCE_V2 =
  FourthImageIntakePermissionEvidenceV2Schema.parse({
    ...fourthImageIntakePermissionEvidenceCore,
    evidenceSha256: FOURTH_IMAGE_INTAKE_PERMISSION_EVIDENCE_V2_SHA256,
  });

const historicalV1Entries = REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1.entries;
const historicalV1EntryOne = historicalV1Entries[0]!;
const historicalV1EntryTwo = historicalV1Entries[1]!;
const historicalV1EntryThree = historicalV1Entries[2]!;
export const FROZEN_THREE_FIXTURE_ENTRY_PROJECTION_SHA256 =
  '4a2145f7a8e501c34489f3330e417ce5bc39cd5728591832e97f3fe892d60a86' as const;
const orderedCorpusDigests = [
  historicalV1EntryOne.packageOriginal.sha256,
  historicalV1EntryOne.canonicalNormalized.sha256,
  historicalV1EntryTwo.packageOriginal.sha256,
  historicalV1EntryTwo.canonicalNormalized.sha256,
  historicalV1EntryThree.packageOriginal.sha256,
  historicalV1EntryThree.canonicalNormalized.sha256,
  FOURTH_BANNER_ORIGINAL_SHA256,
  FOURTH_BANNER_NORMALIZED_SHA256,
] as const;

const HistoricalThreeImagePermissionScopeCoreV2Schema = z
  .strictObject({
    scopeVersion: z.literal(1),
    scopeId: z.literal('historical-three-image-intake-scope-v1'),
    exactUserStatement: z.literal(THREE_BANNER_INTAKE_PERMISSION_STATEMENT),
    exactUserStatementSha256: z.literal(THREE_BANNER_INTAKE_PERMISSION_STATEMENT_SHA256),
    pendingCoreSha256: z.literal(PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_SHA256),
    frozenEntryProjectionSha256: Sha256HexSchema,
    capsSha256: z.literal(PENDING_REAL_MODEL_BENCHMARK_REPOSITORY_BINDINGS_V1.capsSha256),
    entryEvidenceInOrder: z
      .tuple([
        z
          .strictObject({
            fixtureId: z.literal(historicalV1EntryOne.fixtureId),
            originalSourceSha256: z.literal(historicalV1EntryOne.packageOriginal.sha256),
            normalizedSourceSha256: z.literal(historicalV1EntryOne.canonicalNormalized.sha256),
            intakeEvidenceSha256: z.literal(historicalV1EntryOne.intakeEvidence.evidenceSha256),
          })
          .readonly(),
        z
          .strictObject({
            fixtureId: z.literal(historicalV1EntryTwo.fixtureId),
            originalSourceSha256: z.literal(historicalV1EntryTwo.packageOriginal.sha256),
            normalizedSourceSha256: z.literal(historicalV1EntryTwo.canonicalNormalized.sha256),
            intakeEvidenceSha256: z.literal(historicalV1EntryTwo.intakeEvidence.evidenceSha256),
          })
          .readonly(),
        z
          .strictObject({
            fixtureId: z.literal(historicalV1EntryThree.fixtureId),
            originalSourceSha256: z.literal(historicalV1EntryThree.packageOriginal.sha256),
            normalizedSourceSha256: z.literal(historicalV1EntryThree.canonicalNormalized.sha256),
            intakeEvidenceSha256: z.literal(historicalV1EntryThree.intakeEvidence.evidenceSha256),
          })
          .readonly(),
      ])
      .readonly(),
    currentMilestoneTransmission: z.literal('forbidden-and-not-performed'),
    executionAuthorization: z.literal('none'),
  })
  .superRefine((scope, context) => {
    if (
      sha256Hex(Buffer.from(scope.exactUserStatement, 'utf8')) !== scope.exactUserStatementSha256 ||
      scope.frozenEntryProjectionSha256 !== digestCanonical(historicalV1Entries) ||
      scope.frozenEntryProjectionSha256 !== FROZEN_THREE_FIXTURE_ENTRY_PROJECTION_SHA256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Historical three-image statement or frozen entry projection drifted.',
      });
    }
  });

const historicalThreeImagePermissionScopeCore = {
  scopeVersion: 1 as const,
  scopeId: 'historical-three-image-intake-scope-v1' as const,
  exactUserStatement: THREE_BANNER_INTAKE_PERMISSION_STATEMENT,
  exactUserStatementSha256: THREE_BANNER_INTAKE_PERMISSION_STATEMENT_SHA256,
  pendingCoreSha256: PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_SHA256,
  frozenEntryProjectionSha256: FROZEN_THREE_FIXTURE_ENTRY_PROJECTION_SHA256,
  capsSha256: PENDING_REAL_MODEL_BENCHMARK_REPOSITORY_BINDINGS_V1.capsSha256,
  entryEvidenceInOrder: [
    {
      fixtureId: historicalV1EntryOne.fixtureId,
      originalSourceSha256: historicalV1EntryOne.packageOriginal.sha256,
      normalizedSourceSha256: historicalV1EntryOne.canonicalNormalized.sha256,
      intakeEvidenceSha256: historicalV1EntryOne.intakeEvidence.evidenceSha256,
    },
    {
      fixtureId: historicalV1EntryTwo.fixtureId,
      originalSourceSha256: historicalV1EntryTwo.packageOriginal.sha256,
      normalizedSourceSha256: historicalV1EntryTwo.canonicalNormalized.sha256,
      intakeEvidenceSha256: historicalV1EntryTwo.intakeEvidence.evidenceSha256,
    },
    {
      fixtureId: historicalV1EntryThree.fixtureId,
      originalSourceSha256: historicalV1EntryThree.packageOriginal.sha256,
      normalizedSourceSha256: historicalV1EntryThree.canonicalNormalized.sha256,
      intakeEvidenceSha256: historicalV1EntryThree.intakeEvidence.evidenceSha256,
    },
  ] as const,
  currentMilestoneTransmission: 'forbidden-and-not-performed' as const,
  executionAuthorization: 'none' as const,
};

const digestHistoricalThreeImagePermissionScopeV2 = (input: unknown): string =>
  digestCanonical(HistoricalThreeImagePermissionScopeCoreV2Schema.parse(input));

export const HISTORICAL_THREE_IMAGE_PERMISSION_SCOPE_V1_SHA256 =
  'd0b886c2f9e041860887093c3c1c25a95a8018d26cca06c072aa68101b19d5dc' as const;

const HistoricalThreeImagePermissionScopeV2Schema = z
  .strictObject({
    ...HistoricalThreeImagePermissionScopeCoreV2Schema.shape,
    scopeSha256: Sha256HexSchema,
  })
  .superRefine((scope, context) => {
    const { scopeSha256, ...core } = scope;
    if (scopeSha256 !== digestHistoricalThreeImagePermissionScopeV2(core)) {
      context.addIssue({
        code: 'custom',
        message: 'Historical three-image permission scope digest drifted.',
        path: ['scopeSha256'],
      });
    }
  })
  .readonly();

export const HISTORICAL_THREE_IMAGE_PERMISSION_SCOPE_V1 =
  HistoricalThreeImagePermissionScopeV2Schema.parse({
    ...historicalThreeImagePermissionScopeCore,
    scopeSha256: HISTORICAL_THREE_IMAGE_PERMISSION_SCOPE_V1_SHA256,
  });

const CombinedIntakePermissionBindingCoreV2Schema = z
  .strictObject({
    bindingVersion: z.literal(2),
    bindingId: z.literal('four-fixture-combined-intake-permission-binding-v2'),
    permissionScopeOrder: z
      .tuple([
        z.literal('historical-three-image-intake-scope-v1'),
        z.literal('exclusive-fourth-image-intake-scope-v2'),
      ])
      .readonly(),
    historicalThreeImageScope: HistoricalThreeImagePermissionScopeV2Schema,
    fourthImageScope: FourthImageIntakePermissionEvidenceV2Schema,
    orderedCorpusDigests: z
      .tuple([
        z.literal(orderedCorpusDigests[0]),
        z.literal(orderedCorpusDigests[1]),
        z.literal(orderedCorpusDigests[2]),
        z.literal(orderedCorpusDigests[3]),
        z.literal(orderedCorpusDigests[4]),
        z.literal(orderedCorpusDigests[5]),
        z.literal(orderedCorpusDigests[6]),
        z.literal(orderedCorpusDigests[7]),
      ])
      .readonly(),
    capsRevisionSha256: z.literal(FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256),
    capsState: z.literal('disabled-ceilings-only'),
    currentMilestoneTransmission: z.literal('forbidden-and-not-performed'),
    executionAuthorization: z.literal('none'),
    admissionAuthority: z.literal(false),
    requestPlanAuthority: z.literal(false),
    dispatchAuthority: z.literal(false),
  })
  .superRefine((binding, context) => {
    if (
      binding.historicalThreeImageScope.scopeSha256 === binding.fourthImageScope.evidenceSha256 ||
      new Set(binding.orderedCorpusDigests).size !== 8
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Distinct intake scopes and eight ordered source digests are required.',
      });
    }
  });

export const digestCombinedIntakePermissionBindingV2 = (input: unknown): string =>
  digestCanonical(CombinedIntakePermissionBindingCoreV2Schema.parse(input));

const combinedIntakePermissionBindingCore = {
  bindingVersion: 2 as const,
  bindingId: 'four-fixture-combined-intake-permission-binding-v2' as const,
  permissionScopeOrder: [
    'historical-three-image-intake-scope-v1',
    'exclusive-fourth-image-intake-scope-v2',
  ] as const,
  historicalThreeImageScope: HISTORICAL_THREE_IMAGE_PERMISSION_SCOPE_V1,
  fourthImageScope: FOURTH_IMAGE_INTAKE_PERMISSION_EVIDENCE_V2,
  orderedCorpusDigests,
  capsRevisionSha256: FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256,
  capsState: 'disabled-ceilings-only' as const,
  currentMilestoneTransmission: 'forbidden-and-not-performed' as const,
  executionAuthorization: 'none' as const,
  admissionAuthority: false as const,
  requestPlanAuthority: false as const,
  dispatchAuthority: false as const,
};

export const COMBINED_INTAKE_PERMISSION_BINDING_V2_SHA256 =
  'bc96823dfbfaaa2bc2e910f2e190caa37b9dff7566f4d4298f9e088f5931b1cc' as const;

export const CombinedIntakePermissionBindingV2Schema = z
  .strictObject({
    ...CombinedIntakePermissionBindingCoreV2Schema.shape,
    bindingSha256: Sha256HexSchema,
  })
  .superRefine((binding, context) => {
    const { bindingSha256, ...core } = binding;
    if (bindingSha256 !== digestCombinedIntakePermissionBindingV2(core)) {
      context.addIssue({
        code: 'custom',
        message: 'Combined intake permission binding digest drifted.',
        path: ['bindingSha256'],
      });
    }
  })
  .readonly();

export const COMBINED_INTAKE_PERMISSION_BINDING_V2 = CombinedIntakePermissionBindingV2Schema.parse({
  ...combinedIntakePermissionBindingCore,
  bindingSha256: COMBINED_INTAKE_PERMISSION_BINDING_V2_SHA256,
});

export const PendingFourthRealModelBenchmarkCorpusEntryV2Schema = z
  .strictObject({
    pendingEntryVersion: z.literal(2),
    fixtureId: z.literal('banner-no-text-v1'),
    scenario: z.literal('no-text-layered-candidate'),
    sourceAudit: FourthBannerSourceAuditV2Schema,
    packageOriginal: PendingPackageImageV2Schema,
    canonicalNormalized: PendingPackageImageV2Schema,
    intakeEvidence: FourthImageIntakePermissionEvidenceV2Schema,
    draftReview: CodexDraftUnapprovedZeroTextReviewV2Schema,
    admissionAuthority: z.literal(false),
    requestPlanAuthority: z.literal(false),
    dispatchAuthority: z.literal(false),
  })
  .superRefine((entry, context) => {
    if (
      entry.packageOriginal.packageRelativePath !== FOURTH_BANNER_PACKAGE_ORIGINAL_PATH ||
      entry.packageOriginal.filename !== FOURTH_BANNER_PACKAGE_ORIGINAL_FILENAME ||
      entry.packageOriginal.detectedMediaType !== 'image/jpeg' ||
      entry.packageOriginal.byteSize !== 15_312 ||
      entry.packageOriginal.pixelWidth !== 738 ||
      entry.packageOriginal.pixelHeight !== 255 ||
      entry.packageOriginal.pixelCount !== 188_190 ||
      entry.packageOriginal.sha256 !== FOURTH_BANNER_ORIGINAL_SHA256 ||
      entry.packageOriginal.ancillaryByteSize !== 14 ||
      entry.canonicalNormalized.packageRelativePath !== FOURTH_BANNER_PACKAGE_NORMALIZED_PATH ||
      entry.canonicalNormalized.filename !== FOURTH_BANNER_PACKAGE_NORMALIZED_FILENAME ||
      entry.canonicalNormalized.detectedMediaType !== 'image/png' ||
      entry.canonicalNormalized.byteSize !== 125_894 ||
      entry.canonicalNormalized.pixelWidth !== 738 ||
      entry.canonicalNormalized.pixelHeight !== 255 ||
      entry.canonicalNormalized.pixelCount !== 188_190 ||
      entry.canonicalNormalized.sha256 !== FOURTH_BANNER_NORMALIZED_SHA256 ||
      entry.canonicalNormalized.ancillaryByteSize !== 0 ||
      entry.sourceAudit.actualMimeType !== entry.packageOriginal.detectedMediaType ||
      entry.sourceAudit.originalByteSize !== entry.packageOriginal.byteSize ||
      entry.sourceAudit.pixelWidth !== entry.packageOriginal.pixelWidth ||
      entry.sourceAudit.pixelHeight !== entry.packageOriginal.pixelHeight ||
      entry.sourceAudit.pixelCount !== entry.packageOriginal.pixelCount ||
      entry.sourceAudit.originalSha256 !== entry.packageOriginal.sha256 ||
      entry.sourceAudit.localMetadataPrivacy.originalAncillaryByteSize !==
        entry.packageOriginal.ancillaryByteSize ||
      entry.sourceAudit.localMetadataPrivacy.normalizedAncillaryByteSize !==
        entry.canonicalNormalized.ancillaryByteSize ||
      entry.packageOriginal.pixelWidth !== entry.canonicalNormalized.pixelWidth ||
      entry.packageOriginal.pixelHeight !== entry.canonicalNormalized.pixelHeight ||
      entry.packageOriginal.pixelCount !== entry.canonicalNormalized.pixelCount ||
      entry.intakeEvidence.evidenceSha256 !==
        FOURTH_IMAGE_INTAKE_PERMISSION_EVIDENCE_V2.evidenceSha256 ||
      !exactCanonicalEquality(entry.intakeEvidence.boundSourceDigestsInOrder, [
        entry.packageOriginal.sha256,
        entry.canonicalNormalized.sha256,
      ])
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Fourth pending entry source, dimensions, type, or permission binding drifted.',
      });
    }
  })
  .readonly();

const fourthPendingEntry = PendingFourthRealModelBenchmarkCorpusEntryV2Schema.parse({
  pendingEntryVersion: 2,
  fixtureId: 'banner-no-text-v1',
  scenario: 'no-text-layered-candidate',
  sourceAudit: {
    auditVersion: 2,
    intakeFilename: FOURTH_BANNER_INTAKE_RESOLVED_FILENAME,
    filenameTrust: 'not-trusted-byte-evidence-controls',
    byteTypeDetection: 'trusted-byte-level-container-parser',
    actualContainer: 'jpeg',
    actualMimeType: 'image/jpeg',
    pixelWidth: 738,
    pixelHeight: 255,
    pixelCount: 188_190,
    originalByteSize: 15_312,
    originalSha256: FOURTH_BANNER_ORIGINAL_SHA256,
    currentBannerRasterLimits: 'passed',
    benchmarkIntakeLimits: 'passed',
    malformedOrAmbiguousContainer: false,
    committedComparisonDigestCount: 6,
    collisionStatus: 'unique-original-and-normalized-across-all-eight-corpus-digests',
    localMetadataPrivacy: fourthBannerLocalMetadataPrivacyFindings,
    visibleContent: {
      semanticText: 'none-observed',
      lettering: 'none-observed',
      watermark: 'none-observed',
      logoLettering: 'none-observed',
      url: 'none-observed',
      label: 'none-observed',
      signature: 'none-observed',
      person: 'none-observed',
      privateContent: 'none-observed',
      decorativeLetterformReviewFlag:
        'cyan-angular-shapes-resemble-letterforms-but-are-not-automatically-semantic-text',
      classification: 'draft-zero-semantic-text-candidate-pending-human-review',
    },
  },
  packageOriginal: {
    packageRelativePath: FOURTH_BANNER_PACKAGE_ORIGINAL_PATH,
    filename: FOURTH_BANNER_PACKAGE_ORIGINAL_FILENAME,
    detectedMediaType: 'image/jpeg',
    byteSize: 15_312,
    pixelWidth: 738,
    pixelHeight: 255,
    pixelCount: 188_190,
    sha256: FOURTH_BANNER_ORIGINAL_SHA256,
    ancillaryByteSize: 14,
  },
  canonicalNormalized: {
    packageRelativePath: FOURTH_BANNER_PACKAGE_NORMALIZED_PATH,
    filename: FOURTH_BANNER_PACKAGE_NORMALIZED_FILENAME,
    detectedMediaType: 'image/png',
    byteSize: 125_894,
    pixelWidth: 738,
    pixelHeight: 255,
    pixelCount: 188_190,
    sha256: FOURTH_BANNER_NORMALIZED_SHA256,
    ancillaryByteSize: 0,
  },
  intakeEvidence: FOURTH_IMAGE_INTAKE_PERMISSION_EVIDENCE_V2,
  draftReview: fourthBannerDraftReview,
  admissionAuthority: false,
  requestPlanAuthority: false,
  dispatchAuthority: false,
});

const frozenV1RepositoryBindingsSchema = z.custom<
  typeof PENDING_REAL_MODEL_BENCHMARK_REPOSITORY_BINDINGS_V1
>((value) => exactCanonicalEquality(value, PENDING_REAL_MODEL_BENCHMARK_REPOSITORY_BINDINGS_V1), {
  message: 'Frozen V1 repository bindings drifted.',
});

const FourFixturePendingRepositoryBindingsV2Schema = z
  .strictObject({
    bindingVersion: z.literal(2),
    frozenV1RepositoryBindings: frozenV1RepositoryBindingsSchema,
    historicalPendingCoreSha256: z.literal(PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_SHA256),
    frozenThreeEntryProjectionSha256: z.literal(
      HISTORICAL_THREE_IMAGE_PERMISSION_SCOPE_V1.frozenEntryProjectionSha256,
    ),
    fourFixtureCapsRevisionSha256: z.literal(FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256),
    profileAndExecutionRevision: z.literal('unchanged-v1'),
    productionExecutionRegistry: z.literal('empty-unchanged'),
  })
  .readonly();

const fourFixturePendingRepositoryBindings = FourFixturePendingRepositoryBindingsV2Schema.parse({
  bindingVersion: 2,
  frozenV1RepositoryBindings: PENDING_REAL_MODEL_BENCHMARK_REPOSITORY_BINDINGS_V1,
  historicalPendingCoreSha256: PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_SHA256,
  frozenThreeEntryProjectionSha256:
    HISTORICAL_THREE_IMAGE_PERMISSION_SCOPE_V1.frozenEntryProjectionSha256,
  fourFixtureCapsRevisionSha256: FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256,
  profileAndExecutionRevision: 'unchanged-v1',
  productionExecutionRegistry: 'empty-unchanged',
});

const fourEntryTupleSchema = z
  .tuple([
    PendingRealModelBenchmarkCorpusEntryV1Schema,
    PendingRealModelBenchmarkCorpusEntryV1Schema,
    PendingRealModelBenchmarkCorpusEntryV1Schema,
    PendingFourthRealModelBenchmarkCorpusEntryV2Schema,
  ])
  .readonly();

const PendingRealModelBenchmarkCorpusCoreV2Schema = z
  .strictObject({
    pendingManifestVersion: z.literal(2),
    revisionId: z.literal('banner-ai-four-fixture-pending-corpus-v2'),
    profileId: z.literal(REAL_MODEL_BENCHMARK_PROFILE_ID),
    status: z.literal('oracle-review-pending'),
    purpose: z.literal('local-four-banner-corpus-preparation-for-future-capped-openai-benchmark'),
    repositoryBindings: FourFixturePendingRepositoryBindingsV2Schema,
    capRevision: FourFixturePendingCapsRevisionV2Schema,
    combinedIntakePermissionBinding: CombinedIntakePermissionBindingV2Schema,
    entries: fourEntryTupleSchema,
    contractGap: z.literal(
      'fourth-zero-text-candidate-and-all-four-oracles-require-separate-human-approval',
    ),
    conversionBlocker: z.literal(
      'human-license-privacy-text-layer-scenario-and-oracle-review-required-before-separate-admission-milestone',
    ),
    active: z.literal(false),
    dispatchable: z.literal(false),
    admissionAuthority: z.literal(false),
    requestPlanAuthority: z.literal(false),
    providerCallAuthority: z.literal(false),
    dispatchAuthority: z.literal(false),
    productionSourceRegistry: z.literal('empty-unchanged'),
    providerTransport: z.literal('absent'),
    committedExecutionAuthorization: z.literal('absent'),
  })
  .superRefine((manifest, context) => {
    const fixtureIds = manifest.entries.map((entry) => entry.fixtureId);
    const allDigests = manifest.entries.flatMap((entry) => [
      entry.packageOriginal.sha256,
      entry.canonicalNormalized.sha256,
    ]);
    if (
      !exactCanonicalEquality(manifest.entries.slice(0, 3), historicalV1Entries) ||
      !exactCanonicalEquality(manifest.entries[3], fourthPendingEntry)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'V2 must reuse the exact frozen V1 projection and exact fourth pending entry.',
      });
    }
    if (new Set(fixtureIds).size !== 4 || new Set(allDigests).size !== 8) {
      context.addIssue({
        code: 'custom',
        message: 'V2 requires four unique fixtures and eight unique source digests.',
      });
    }
    if (
      !exactCanonicalEquality(manifest.capRevision, FOUR_FIXTURE_PENDING_CAPS_REVISION_V2) ||
      !exactCanonicalEquality(
        manifest.combinedIntakePermissionBinding,
        COMBINED_INTAKE_PERMISSION_BINDING_V2,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'V2 cap or combined permission binding drifted.',
      });
    }
  });

export const digestPendingRealModelBenchmarkCorpusCoreV2 = (input: unknown): string =>
  digestCanonical(PendingRealModelBenchmarkCorpusCoreV2Schema.parse(input));

const pendingManifestCoreV2 = {
  pendingManifestVersion: 2 as const,
  revisionId: 'banner-ai-four-fixture-pending-corpus-v2' as const,
  profileId: REAL_MODEL_BENCHMARK_PROFILE_ID,
  status: 'oracle-review-pending' as const,
  purpose: 'local-four-banner-corpus-preparation-for-future-capped-openai-benchmark' as const,
  repositoryBindings: fourFixturePendingRepositoryBindings,
  capRevision: FOUR_FIXTURE_PENDING_CAPS_REVISION_V2,
  combinedIntakePermissionBinding: COMBINED_INTAKE_PERMISSION_BINDING_V2,
  entries: [...historicalV1Entries, fourthPendingEntry] as const,
  contractGap:
    'fourth-zero-text-candidate-and-all-four-oracles-require-separate-human-approval' as const,
  conversionBlocker:
    'human-license-privacy-text-layer-scenario-and-oracle-review-required-before-separate-admission-milestone' as const,
  active: false as const,
  dispatchable: false as const,
  admissionAuthority: false as const,
  requestPlanAuthority: false as const,
  providerCallAuthority: false as const,
  dispatchAuthority: false as const,
  productionSourceRegistry: 'empty-unchanged' as const,
  providerTransport: 'absent' as const,
  committedExecutionAuthorization: 'absent' as const,
};

export const PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256 =
  'fa3ecc650a14611e6274b123b65ee7fcf34fe9443cb1125655b70393195e7f51' as const;

const PendingCoreCombinedAuthorizationBindingCoreV2Schema = z.strictObject({
  bindingVersion: z.literal(2),
  bindingId: z.literal('four-fixture-pending-core-combined-authorization-v2'),
  pendingCoreSha256: z.literal(PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256),
  combinedIntakePermissionBindingSha256: z.literal(COMBINED_INTAKE_PERMISSION_BINDING_V2_SHA256),
  capRevisionSha256: z.literal(FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256),
  authorizationScope: z.literal('local-preparation-and-future-transmission-only'),
  currentMilestoneTransmission: z.literal('forbidden-and-not-performed'),
  executionAuthorization: z.literal('none'),
  admissionAuthority: z.literal(false),
  requestPlanAuthority: z.literal(false),
  providerCallAuthority: z.literal(false),
  dispatchAuthority: z.literal(false),
});

export const digestPendingCoreCombinedAuthorizationBindingV2 = (input: unknown): string =>
  digestCanonical(PendingCoreCombinedAuthorizationBindingCoreV2Schema.parse(input));

const pendingCoreCombinedAuthorizationBindingCore = {
  bindingVersion: 2 as const,
  bindingId: 'four-fixture-pending-core-combined-authorization-v2' as const,
  pendingCoreSha256: PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256,
  combinedIntakePermissionBindingSha256: COMBINED_INTAKE_PERMISSION_BINDING_V2_SHA256,
  capRevisionSha256: FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256,
  authorizationScope: 'local-preparation-and-future-transmission-only' as const,
  currentMilestoneTransmission: 'forbidden-and-not-performed' as const,
  executionAuthorization: 'none' as const,
  admissionAuthority: false as const,
  requestPlanAuthority: false as const,
  providerCallAuthority: false as const,
  dispatchAuthority: false as const,
};

export const PENDING_CORE_COMBINED_AUTHORIZATION_BINDING_V2_SHA256 =
  'bb6e0cd73e3b043bd69d58f3808be53433920ced6ae3d6ead0911aa82fe54acf' as const;

export const PendingCoreCombinedAuthorizationBindingV2Schema = z
  .strictObject({
    ...PendingCoreCombinedAuthorizationBindingCoreV2Schema.shape,
    bindingSha256: Sha256HexSchema,
  })
  .superRefine((binding, context) => {
    const { bindingSha256, ...core } = binding;
    if (bindingSha256 !== digestPendingCoreCombinedAuthorizationBindingV2(core)) {
      context.addIssue({
        code: 'custom',
        message: 'Pending-core/combined-authorization binding digest drifted.',
        path: ['bindingSha256'],
      });
    }
  })
  .readonly();

export const PENDING_CORE_COMBINED_AUTHORIZATION_BINDING_V2 =
  PendingCoreCombinedAuthorizationBindingV2Schema.parse({
    ...pendingCoreCombinedAuthorizationBindingCore,
    bindingSha256: PENDING_CORE_COMBINED_AUTHORIZATION_BINDING_V2_SHA256,
  });

export const PendingRealModelBenchmarkCorpusV2Schema = z
  .strictObject({
    ...PendingRealModelBenchmarkCorpusCoreV2Schema.shape,
    pendingCoreSha256: z.literal(PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256),
    pendingCoreCombinedAuthorizationBinding: PendingCoreCombinedAuthorizationBindingV2Schema,
  })
  .superRefine((manifest, context) => {
    const { pendingCoreSha256, pendingCoreCombinedAuthorizationBinding, ...core } = manifest;
    if (
      pendingCoreSha256 !== digestPendingRealModelBenchmarkCorpusCoreV2(core) ||
      pendingCoreCombinedAuthorizationBinding.pendingCoreSha256 !== pendingCoreSha256 ||
      pendingCoreCombinedAuthorizationBinding.combinedIntakePermissionBindingSha256 !==
        manifest.combinedIntakePermissionBinding.bindingSha256 ||
      !exactCanonicalEquality(
        pendingCoreCombinedAuthorizationBinding,
        PENDING_CORE_COMBINED_AUTHORIZATION_BINDING_V2,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Four-fixture pending core or final authorization binding drifted.',
      });
    }
  })
  .readonly();

export const REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2 = PendingRealModelBenchmarkCorpusV2Schema.parse(
  {
    ...pendingManifestCoreV2,
    pendingCoreSha256: PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256,
    pendingCoreCombinedAuthorizationBinding: PENDING_CORE_COMBINED_AUTHORIZATION_BINDING_V2,
  },
);

export type PendingFourthRealModelBenchmarkCorpusEntryV2 = z.infer<
  typeof PendingFourthRealModelBenchmarkCorpusEntryV2Schema
>;
export type PendingRealModelBenchmarkCorpusV2 = z.infer<
  typeof PendingRealModelBenchmarkCorpusV2Schema
>;
