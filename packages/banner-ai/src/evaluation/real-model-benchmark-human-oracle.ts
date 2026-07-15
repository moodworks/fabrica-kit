import { z } from 'zod';

import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION,
  INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
  NormalizedObservedTextValueV1Schema,
  TextObservationBoundingBoxV1Schema,
  normalizeObservedTextValueV1,
} from './ai-contracts.js';
import {
  OPENAI_REAL_MODEL_ENDPOINT,
  OPENAI_REAL_MODEL_PROVIDER_KEY,
  OPENAI_REAL_MODEL_REQUESTED_MODEL_ID,
  OPENAI_REAL_MODEL_RESPONSES_API_FAMILY,
  PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1,
} from './openai-real-model-candidate-evidence.js';
import { SCENE_ANALYSIS_PROMPT_V1 } from './prompt-catalog.js';
import { REAL_MODEL_BENCHMARK_PROFILE_ID } from './real-model-benchmark-corpus-manifest.js';
import {
  FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256,
  PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256,
  REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2,
} from './real-model-benchmark-pending-corpus-v2.js';
import { PENDING_REAL_MODEL_BENCHMARK_REPOSITORY_BINDINGS_V1 } from './real-model-benchmark-pending-corpus.js';
import { OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1 } from './real-model-benchmark-profile.js';

export const HUMAN_ORACLE_APPROVAL_RECORDED_AT = '2026-07-14T13:51:13Z' as const;

const digestCanonical = (input: unknown): string =>
  sha256Hex(Buffer.from(canonicalizeJson(input), 'utf8'));

const exactCanonicalEquality = (left: unknown, right: unknown): boolean =>
  canonicalizeJson(left) === canonicalizeJson(right);

const statementIds = [
  'person-rights',
  'product-rights',
  'text-heavy-rights',
  'no-text-rights',
  'no-text-decisions',
  'first-three-rights-and-privacy',
  'layer-and-text-decisions',
  'product-text-decisions',
  'watermark-unscored',
  'watermark-do-not-invent',
  'watermark-not-exact-oracle-text',
] as const;

const statementTexts = [
  'banner-person-v1: user-owned',
  'banner-product-v1: user-owned',
  'banner-text-heavy-v1: user-owned',
  'banner-no-text-v1: user-owned',
  '4-no-text.jpeg is owned. I accept the JFIF-only metadata and privacy findings. The cyan angular forms are decorative shapes, not semantic lettering or a logo. I confirm there is no visible semantic text and approve the empty text-observation set. I approve these corrected layers: background composite, grouped cyan decorations, and grouped coral sunbursts.',
  'I accept the documented metadata and privacy findings for the person, product, and text-heavy fixtures. I confirm that I have the necessary rights for the adult likeness/model use, placeholder URL, logos, brand/label text, and visible watermarks for this OpenAI benchmark.',
  'I approve the person and text-heavy draft layers, text transcriptions, and approximate boxes. For the product fixture, I approve these corrected layers: photographic background including blurred plants/patterned panel, candle jar and label, and right-side headline.',
  'I approve these visible-text transcriptions and approximate boxes for the product fixture: “blurry background”, “TONKA + OUD”, “candles, candles, candles co.”, “soy wax candle”, and “NET WT. 8 OZ”.',
  'Person and text-heavy watermark regions are approved as unscored OCR uncertainty.',
  'Do not invent watermark transcription.',
  'Do not treat unresolved watermark content as exact oracle text.',
] as const;

const statementRawUtf8Sha256 = [
  'eb36b312c7949c53801752400567df8a94c1ea26a4ff4d708889b73484a7af10',
  'ffce5059bcda594f171d79ce10f2095f8b519152582edfcbf62db7cdd7f72a8b',
  'c77f8c9b49e2533052c52a99df678ab4332d341f6b545db4b60c74394b11f4ea',
  '8d114a4b68db02f86a00acd8a8b19817af9f331cd1809f8ebf7cea0a3d664fa8',
  'f478d9fee48ef8f0f1a2bd70c31a8e1f3813cf30521bd0e02867827ebf306a60',
  'bb60b7497f9799416e7f913d8e862045b4cd5bd52ffcc1efbe240a74f670e230',
  'a8782d19f968d1fd8866ad1f7881f8900455fc8e27f09de9da6dd22179d2ef47',
  '1a88e03c49bf2a1df62fcb7e50e5428cdae4a8816cba4244cfe8d377687fdf1b',
  '4e6641a35c1d685e7e635373e845bf778b619dc7dad499e852d1e9799fddde80',
  '94d5d6b54ae49853b2836c8959bcf74712c8a22abd82a9c3992d96536ad03ed0',
  'c6c558a392bd60120eed3216f1753422d09cf303ffd54e75a226c585373d6534',
] as const;

export const HumanOracleRawStatementRecordV2Schema = z
  .strictObject({
    statementVersion: z.literal(2),
    evidenceRole: z.literal('verbatim-local-project-owner-decision'),
    statementId: z.enum(statementIds),
    exactStatement: z.enum(statementTexts),
    rawUtf8Sha256: Sha256HexSchema,
    digestScope: z.literal('raw-utf8-statement-bytes-only'),
  })
  .superRefine((record, context) => {
    const index = statementIds.indexOf(record.statementId);
    if (
      index < 0 ||
      record.exactStatement !== statementTexts[index] ||
      record.rawUtf8Sha256 !== statementRawUtf8Sha256[index] ||
      sha256Hex(Buffer.from(record.exactStatement, 'utf8')) !== record.rawUtf8Sha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Verbatim human-decision statement text, order, or raw UTF-8 digest drifted.',
      });
    }
  })
  .readonly();

const rawStatementRecords = statementIds.map((statementId, index) =>
  HumanOracleRawStatementRecordV2Schema.parse({
    statementVersion: 2,
    evidenceRole: 'verbatim-local-project-owner-decision',
    statementId,
    exactStatement: statementTexts[index]!,
    rawUtf8Sha256: statementRawUtf8Sha256[index]!,
    digestScope: 'raw-utf8-statement-bytes-only',
  }),
);

export const HUMAN_ORACLE_RAW_STATEMENT_RECORDS_V2 = Object.freeze(rawStatementRecords);

const recordById = new Map(
  HUMAN_ORACLE_RAW_STATEMENT_RECORDS_V2.map((record) => [record.statementId, record]),
);

const statementRecord = (statementId: (typeof statementIds)[number]) => {
  const record = recordById.get(statementId);
  if (!record) throw new TypeError(`Missing fixed human-oracle statement ${statementId}.`);
  return record;
};

const fixtureIds = [
  'banner-person-v1',
  'banner-product-v1',
  'banner-text-heavy-v1',
  'banner-no-text-v1',
] as const;

const statementIdsByFixture = {
  'banner-person-v1': [
    'person-rights',
    'first-three-rights-and-privacy',
    'layer-and-text-decisions',
    'watermark-unscored',
    'watermark-do-not-invent',
    'watermark-not-exact-oracle-text',
  ],
  'banner-product-v1': [
    'product-rights',
    'first-three-rights-and-privacy',
    'layer-and-text-decisions',
    'product-text-decisions',
  ],
  'banner-text-heavy-v1': [
    'text-heavy-rights',
    'first-three-rights-and-privacy',
    'layer-and-text-decisions',
    'watermark-unscored',
    'watermark-do-not-invent',
    'watermark-not-exact-oracle-text',
  ],
  'banner-no-text-v1': ['no-text-rights', 'no-text-decisions'],
} as const;

const HumanOracleFixtureStatementBundleCoreV2Schema = z
  .strictObject({
    statementBundleVersion: z.literal(2),
    evidenceRole: z.literal('fixture-ordered-human-decision-statement-bundle'),
    fixtureId: z.enum(fixtureIds),
    pendingCorpusCoreSha256: z.literal(PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256),
    capRevisionSha256: z.literal(FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256),
    statementsInDecisionOrder: z
      .array(HumanOracleRawStatementRecordV2Schema)
      .min(2)
      .max(6)
      .readonly(),
    digestScope: z.literal('canonical-json-fixture-statement-bundle-core-v2'),
  })
  .superRefine((bundle, context) => {
    const expectedIds = statementIdsByFixture[bundle.fixtureId];
    const actualIds = bundle.statementsInDecisionOrder.map((record) => record.statementId);
    const expectedRecords = expectedIds.map(statementRecord);
    if (
      !exactCanonicalEquality(actualIds, expectedIds) ||
      !exactCanonicalEquality(bundle.statementsInDecisionOrder, expectedRecords)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Fixture statement membership, verbatim records, or decision order drifted.',
        path: ['statementsInDecisionOrder'],
      });
    }
  });

export const digestHumanOracleFixtureStatementBundleV2 = (input: unknown): string =>
  digestCanonical(HumanOracleFixtureStatementBundleCoreV2Schema.parse(input));

export const HumanOracleFixtureStatementBundleV2Schema = z
  .strictObject({
    ...HumanOracleFixtureStatementBundleCoreV2Schema.shape,
    statementBundleSha256: Sha256HexSchema,
  })
  .superRefine((bundle, context) => {
    const { statementBundleSha256, ...core } = bundle;
    const parsedCore = HumanOracleFixtureStatementBundleCoreV2Schema.safeParse(core);
    if (
      !parsedCore.success ||
      statementBundleSha256 !== digestHumanOracleFixtureStatementBundleV2(core)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Fixture statement-bundle digest drifted.',
        path: ['statementBundleSha256'],
      });
    }
  })
  .readonly();

const statementBundleCores = fixtureIds.map((fixtureId) => ({
  statementBundleVersion: 2 as const,
  evidenceRole: 'fixture-ordered-human-decision-statement-bundle' as const,
  fixtureId,
  pendingCorpusCoreSha256: PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256,
  capRevisionSha256: FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256,
  statementsInDecisionOrder: statementIdsByFixture[fixtureId].map(statementRecord),
  digestScope: 'canonical-json-fixture-statement-bundle-core-v2' as const,
}));

export const HUMAN_ORACLE_FIXTURE_STATEMENT_BUNDLES_V2 = Object.freeze(
  statementBundleCores.map((core) =>
    HumanOracleFixtureStatementBundleV2Schema.parse({
      ...core,
      statementBundleSha256: digestHumanOracleFixtureStatementBundleV2(core),
    }),
  ),
);

const statementBundleByFixture = new Map(
  HUMAN_ORACLE_FIXTURE_STATEMENT_BUNDLES_V2.map((bundle) => [bundle.fixtureId, bundle]),
);

const statementBundleFor = (fixtureId: (typeof fixtureIds)[number]) => {
  const bundle = statementBundleByFixture.get(fixtureId);
  if (!bundle) throw new TypeError(`Missing fixed human-oracle statement bundle ${fixtureId}.`);
  return bundle;
};

const HumanOracleSourceAssetV2Schema = z
  .strictObject({
    detectedMediaType: z.enum(['image/jpeg', 'image/png']),
    byteSize: z.int().min(1).max(5_242_880),
    pixelWidth: z.int().min(64).max(2_048),
    pixelHeight: z.int().min(64).max(2_048),
    sha256: Sha256HexSchema,
  })
  .superRefine((asset, context) => {
    if (asset.pixelWidth * asset.pixelHeight > 4_194_304) {
      context.addIssue({ code: 'custom', message: 'Human-oracle source exceeds pixel limits.' });
    }
  })
  .readonly();

export const HumanOracleSourceBindingV2Schema = z
  .strictObject({
    sourceBindingVersion: z.literal(2),
    fixtureId: z.enum(fixtureIds),
    pendingEntryIndex: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    pendingCorpusCoreSha256: z.literal(PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256),
    capRevisionSha256: z.literal(FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256),
    original: HumanOracleSourceAssetV2Schema,
    canonicalNormalized: HumanOracleSourceAssetV2Schema,
    sourcePairOrder: z.literal('original-then-canonical-normalized'),
  })
  .superRefine((binding, context) => {
    const pendingEntry = REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2.entries[binding.pendingEntryIndex];
    const expected = pendingEntry && {
      sourceBindingVersion: 2,
      fixtureId: pendingEntry.fixtureId,
      pendingEntryIndex: binding.pendingEntryIndex,
      pendingCorpusCoreSha256: PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256,
      capRevisionSha256: FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256,
      original: {
        detectedMediaType: pendingEntry.packageOriginal.detectedMediaType,
        byteSize: pendingEntry.packageOriginal.byteSize,
        pixelWidth: pendingEntry.packageOriginal.pixelWidth,
        pixelHeight: pendingEntry.packageOriginal.pixelHeight,
        sha256: pendingEntry.packageOriginal.sha256,
      },
      canonicalNormalized: {
        detectedMediaType: pendingEntry.canonicalNormalized.detectedMediaType,
        byteSize: pendingEntry.canonicalNormalized.byteSize,
        pixelWidth: pendingEntry.canonicalNormalized.pixelWidth,
        pixelHeight: pendingEntry.canonicalNormalized.pixelHeight,
        sha256: pendingEntry.canonicalNormalized.sha256,
      },
      sourcePairOrder: 'original-then-canonical-normalized',
    };
    if (
      !expected ||
      !exactCanonicalEquality(binding, expected) ||
      binding.original.sha256 === binding.canonicalNormalized.sha256 ||
      binding.original.pixelWidth !== binding.canonicalNormalized.pixelWidth ||
      binding.original.pixelHeight !== binding.canonicalNormalized.pixelHeight ||
      binding.canonicalNormalized.detectedMediaType !== 'image/png'
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Human-oracle source pair differs from its exact frozen V2 fixture binding.',
      });
    }
  })
  .readonly();

export const HumanOracleBasisPointBoxV2Schema = TextObservationBoundingBoxV1Schema;

export const HumanOracleApprovedLayerV2Schema = z
  .strictObject({
    oracleLayerId: z.string().regex(/^[a-z0-9][a-z0-9.-]{7,79}$/u),
    approvedLabel: z.string().min(1).max(160),
    role: z.enum(['background', 'subject', 'foreground', 'decoration', 'text', 'other']),
    boundingBox: HumanOracleBasisPointBoxV2Schema,
    required: z.literal(true),
    approvalBasis: z.literal('local-project-owner-approved-human-oracle-v2'),
  })
  .readonly();

export const HumanOracleApprovedTextOccurrenceV2Schema = z
  .strictObject({
    oracleOccurrenceId: z.string().regex(/^[a-z0-9][a-z0-9.-]{7,79}$/u),
    approvedTranscription: z
      .string()
      .min(1)
      .max(500)
      .refine(
        (value) =>
          value.normalize('NFC') === value &&
          value.trim() === value &&
          !value.includes('\r') &&
          !/[\u0000-\u0009\u000b-\u001f\u007f]/u.test(value),
        'Approved transcription must be trimmed NFC text with LF as its only control character.',
      ),
    normalizedScoringText: NormalizedObservedTextValueV1Schema,
    boundingBox: HumanOracleBasisPointBoxV2Schema,
    scoringRole: z.literal('approved-main-visible-text'),
  })
  .superRefine((occurrence, context) => {
    if (
      normalizeObservedTextValueV1(occurrence.approvedTranscription) !==
      occurrence.normalizedScoringText
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Approved transcription and normalized scoring text disagree.',
        path: ['normalizedScoringText'],
      });
    }
  })
  .readonly();

const UnresolvedWatermarkOcrPolicyV2Schema = z
  .strictObject({
    policyVersion: z.literal(2),
    policyKind: z.literal('approved-main-text-with-unresolved-watermark'),
    watermarkDisposition: z.literal('permitted-unscored-ocr-uncertainty'),
    transcriptionRule: z.literal('do-not-invent-or-treat-unresolved-content-as-exact-oracle-text'),
    extraObservationPrecisionStatus: z.literal('unavailable-unscored'),
    fullExactOcrEligible: z.literal(false),
    fullExactOcrResult: z.literal('prohibited-even-when-approved-main-text-is-perfect'),
  })
  .readonly();

const CompleteVisibleTextOcrPolicyV2Schema = z
  .strictObject({
    policyVersion: z.literal(2),
    policyKind: z.literal('complete-visible-semantic-text-oracle'),
    watermarkDisposition: z.literal('none-unresolved'),
    transcriptionRule: z.literal('all-approved-semantic-text-is-exact-oracle-text'),
    extraObservationPrecisionStatus: z.literal('available-scored'),
    fullExactOcrEligible: z.literal(true),
    fullExactOcrResult: z.literal('requires-full-precision-recall-and-box-accuracy'),
  })
  .readonly();

export const HumanOracleOcrPolicyV2Schema = z.discriminatedUnion('policyKind', [
  UnresolvedWatermarkOcrPolicyV2Schema,
  CompleteVisibleTextOcrPolicyV2Schema,
]);

const box = (xBps: number, yBps: number, widthBps: number, heightBps: number) => ({
  unit: 'normalized-basis-points' as const,
  xBps,
  yBps,
  widthBps,
  heightBps,
});

const approvedText = (
  oracleOccurrenceId: string,
  approvedTranscription: string,
  boundingBox: ReturnType<typeof box>,
) => ({
  oracleOccurrenceId,
  approvedTranscription,
  normalizedScoringText: normalizeObservedTextValueV1(approvedTranscription),
  boundingBox,
  scoringRole: 'approved-main-visible-text' as const,
});

const exactFrozenV1RepositoryBindingsSchema = z.custom<
  typeof PENDING_REAL_MODEL_BENCHMARK_REPOSITORY_BINDINGS_V1
>((value) => exactCanonicalEquality(value, PENDING_REAL_MODEL_BENCHMARK_REPOSITORY_BINDINGS_V1), {
  message: 'Frozen V1 repository evidence bindings drifted.',
});

const exactSelectedProfileSchema = z.custom<typeof OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1>(
  (value) => exactCanonicalEquality(value, OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1),
  { message: 'Frozen selected real-model benchmark profile drifted.' },
);

const exactProposedRequestContractSchema = z.custom<
  typeof PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1
>((value) => exactCanonicalEquality(value, PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1), {
  message: 'Frozen proposed Responses request contract drifted.',
});

const exactPromptSchema = z.custom<typeof SCENE_ANALYSIS_PROMPT_V1>(
  (value) => exactCanonicalEquality(value, SCENE_ANALYSIS_PROMPT_V1),
  { message: 'Frozen scene-analysis prompt drifted.' },
);

const exactContentPolicySchema = z.custom<
  typeof BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION
>((value) => exactCanonicalEquality(value, BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION), {
  message: 'Frozen dispatch content-policy definition drifted.',
});

const exactWorkflowSchema = z.custom<typeof INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1>(
  (value) => exactCanonicalEquality(value, INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1),
  { message: 'Frozen Banner analyze workflow binding drifted.' },
);

export const HumanOracleRepositoryBindingsV2Schema = z
  .strictObject({
    bindingVersion: z.literal(2),
    pendingCorpusCoreSha256: z.literal(PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256),
    capRevisionSha256: z.literal(FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256),
    providerKey: z.literal(OPENAI_REAL_MODEL_PROVIDER_KEY),
    apiFamily: z.literal(OPENAI_REAL_MODEL_RESPONSES_API_FAMILY),
    endpoint: z.literal(OPENAI_REAL_MODEL_ENDPOINT),
    endpointMethod: z.literal(PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1.method),
    requestedModelId: z.literal(OPENAI_REAL_MODEL_REQUESTED_MODEL_ID),
    profileId: z.literal(REAL_MODEL_BENCHMARK_PROFILE_ID),
    frozenV1RepositoryBindings: exactFrozenV1RepositoryBindingsSchema,
    selectedProfile: exactSelectedProfileSchema,
    proposedRequestContract: exactProposedRequestContractSchema,
    prompt: exactPromptSchema,
    contentPolicyDefinition: exactContentPolicySchema,
    workflow: exactWorkflowSchema,
    bindingDisposition: z.literal('evaluation-target-pins-only-no-provider-or-dispatch-authority'),
  })
  .superRefine((bindings, context) => {
    if (
      bindings.frozenV1RepositoryBindings.profileSha256 !==
        PENDING_REAL_MODEL_BENCHMARK_REPOSITORY_BINDINGS_V1.profileSha256 ||
      bindings.frozenV1RepositoryBindings.responsesRequestShapeSha256 !==
        bindings.proposedRequestContract.requestShapeSha256 ||
      bindings.frozenV1RepositoryBindings.promptSha256 !== bindings.prompt.contentSha256 ||
      bindings.frozenV1RepositoryBindings.contentPolicySha256 !==
        bindings.contentPolicyDefinition.definitionSha256 ||
      bindings.frozenV1RepositoryBindings.workflowDefinitionSha256 !==
        bindings.workflow.definitionSha256 ||
      bindings.selectedProfile.profileId !== bindings.profileId ||
      bindings.selectedProfile.candidateSelection.providerKey !== bindings.providerKey ||
      bindings.selectedProfile.candidateSelection.providerModelIdentifier !==
        bindings.requestedModelId ||
      bindings.proposedRequestContract.providerKey !== bindings.providerKey ||
      bindings.proposedRequestContract.apiFamily !== bindings.apiFamily ||
      bindings.proposedRequestContract.endpoint !== bindings.endpoint ||
      bindings.proposedRequestContract.requestedModelId !== bindings.requestedModelId ||
      !exactCanonicalEquality(bindings.selectedProfile.prompt, {
        id: bindings.prompt.id,
        version: bindings.prompt.version,
        contentSha256: bindings.prompt.contentSha256,
      }) ||
      !exactCanonicalEquality(bindings.selectedProfile.workflow, bindings.workflow)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Human-oracle provider, profile, request, prompt, policy, or workflow pins drifted.',
      });
    }
  })
  .readonly();

export const HUMAN_ORACLE_REPOSITORY_BINDINGS_V2 = HumanOracleRepositoryBindingsV2Schema.parse({
  bindingVersion: 2,
  pendingCorpusCoreSha256: PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256,
  capRevisionSha256: FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256,
  providerKey: OPENAI_REAL_MODEL_PROVIDER_KEY,
  apiFamily: OPENAI_REAL_MODEL_RESPONSES_API_FAMILY,
  endpoint: OPENAI_REAL_MODEL_ENDPOINT,
  endpointMethod: PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1.method,
  requestedModelId: OPENAI_REAL_MODEL_REQUESTED_MODEL_ID,
  profileId: REAL_MODEL_BENCHMARK_PROFILE_ID,
  frozenV1RepositoryBindings: PENDING_REAL_MODEL_BENCHMARK_REPOSITORY_BINDINGS_V1,
  selectedProfile: OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1,
  proposedRequestContract: PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1,
  prompt: SCENE_ANALYSIS_PROMPT_V1,
  contentPolicyDefinition: BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION,
  workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
  bindingDisposition: 'evaluation-target-pins-only-no-provider-or-dispatch-authority',
});

const rightsAndPrivacyAssertionOptions = [
  'adult-likeness-and-model-use-rights-confirmed',
  'placeholder-url-rights-and-privacy-accepted',
  'logo-rights-confirmed',
  'visible-watermark-rights-confirmed',
  'brand-and-label-rights-confirmed',
  'logo-and-brand-rights-confirmed',
  'jfif-only-metadata-accepted',
  'cyan-angular-forms-decorative-not-semantic-lettering-or-logo',
  'no-visible-semantic-text-confirmed',
  'empty-text-observation-set-approved',
] as const;

const rightsAndPrivacyDecisionInputs = {
  'banner-person-v1': {
    decisionVersion: 2 as const,
    evidenceRole: 'human-license-metadata-privacy-and-rights-decision' as const,
    fixtureId: 'banner-person-v1' as const,
    licenseClassification: 'user-owned' as const,
    metadataAndPrivacyFindings: 'accepted-as-documented' as const,
    privateOrSensitiveInformation: 'confirmed-absent' as const,
    normalizedMetadataDisposition:
      'accepted-canonical-normalization-stripped-container-ancillary-metadata' as const,
    acceptedOriginalMetadataFindings: [
      'png-icc-profile-including-apple-profile-data',
      'png-exif-user-comment-screenshot',
      'png-adobe-xmp-packet',
    ] as const,
    rightsAndPrivacyAssertions: [
      'adult-likeness-and-model-use-rights-confirmed',
      'placeholder-url-rights-and-privacy-accepted',
      'logo-rights-confirmed',
      'visible-watermark-rights-confirmed',
    ] as const,
  },
  'banner-product-v1': {
    decisionVersion: 2 as const,
    evidenceRole: 'human-license-metadata-privacy-and-rights-decision' as const,
    fixtureId: 'banner-product-v1' as const,
    licenseClassification: 'user-owned' as const,
    metadataAndPrivacyFindings: 'accepted-as-documented' as const,
    privateOrSensitiveInformation: 'confirmed-absent' as const,
    normalizedMetadataDisposition:
      'accepted-canonical-normalization-stripped-container-ancillary-metadata' as const,
    acceptedOriginalMetadataFindings: [
      'jpeg-photoshop-xmp-packet',
      'jpeg-xmp-document-and-instance-identifiers',
      'jpeg-exif-and-adobe-metadata',
    ] as const,
    rightsAndPrivacyAssertions: ['brand-and-label-rights-confirmed'] as const,
  },
  'banner-text-heavy-v1': {
    decisionVersion: 2 as const,
    evidenceRole: 'human-license-metadata-privacy-and-rights-decision' as const,
    fixtureId: 'banner-text-heavy-v1' as const,
    licenseClassification: 'user-owned' as const,
    metadataAndPrivacyFindings: 'accepted-as-documented' as const,
    privateOrSensitiveInformation: 'confirmed-absent' as const,
    normalizedMetadataDisposition:
      'accepted-canonical-normalization-stripped-container-ancillary-metadata' as const,
    acceptedOriginalMetadataFindings: ['jpeg-jfif-payload-only'] as const,
    rightsAndPrivacyAssertions: [
      'logo-and-brand-rights-confirmed',
      'visible-watermark-rights-confirmed',
    ] as const,
  },
  'banner-no-text-v1': {
    decisionVersion: 2 as const,
    evidenceRole: 'human-license-metadata-privacy-and-rights-decision' as const,
    fixtureId: 'banner-no-text-v1' as const,
    licenseClassification: 'user-owned' as const,
    metadataAndPrivacyFindings: 'accepted-as-documented' as const,
    privateOrSensitiveInformation: 'confirmed-absent' as const,
    normalizedMetadataDisposition:
      'accepted-canonical-normalization-stripped-container-ancillary-metadata' as const,
    acceptedOriginalMetadataFindings: ['jpeg-jfif-payload-only'] as const,
    rightsAndPrivacyAssertions: [
      'jfif-only-metadata-accepted',
      'cyan-angular-forms-decorative-not-semantic-lettering-or-logo',
      'no-visible-semantic-text-confirmed',
      'empty-text-observation-set-approved',
    ] as const,
  },
} as const;

export const HumanOracleRightsAndPrivacyDecisionV2Schema = z
  .strictObject({
    decisionVersion: z.literal(2),
    evidenceRole: z.literal('human-license-metadata-privacy-and-rights-decision'),
    fixtureId: z.enum(fixtureIds),
    licenseClassification: z.literal('user-owned'),
    metadataAndPrivacyFindings: z.literal('accepted-as-documented'),
    privateOrSensitiveInformation: z.literal('confirmed-absent'),
    normalizedMetadataDisposition: z.literal(
      'accepted-canonical-normalization-stripped-container-ancillary-metadata',
    ),
    acceptedOriginalMetadataFindings: z.array(z.string().min(1).max(120)).min(1).max(4).readonly(),
    rightsAndPrivacyAssertions: z
      .array(z.enum(rightsAndPrivacyAssertionOptions))
      .min(1)
      .max(6)
      .readonly(),
  })
  .superRefine((decision, context) => {
    if (
      new Set(decision.acceptedOriginalMetadataFindings).size !==
        decision.acceptedOriginalMetadataFindings.length ||
      new Set(decision.rightsAndPrivacyAssertions).size !==
        decision.rightsAndPrivacyAssertions.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Human rights and privacy decisions must be unique.',
      });
    }
    if (!exactCanonicalEquality(decision, rightsAndPrivacyDecisionInputs[decision.fixtureId])) {
      context.addIssue({
        code: 'custom',
        message: 'Human rights, metadata, or privacy decision differs from the exact fixture pin.',
      });
    }
  })
  .readonly();

export const HUMAN_ORACLE_RIGHTS_AND_PRIVACY_DECISIONS_V2 = Object.freeze(
  fixtureIds.map((fixtureId) =>
    HumanOracleRightsAndPrivacyDecisionV2Schema.parse(rightsAndPrivacyDecisionInputs[fixtureId]),
  ),
);

const rightsAndPrivacyDecisionByFixture = new Map(
  HUMAN_ORACLE_RIGHTS_AND_PRIVACY_DECISIONS_V2.map((decision) => [decision.fixtureId, decision]),
);

const rightsAndPrivacyDecisionFor = (fixtureId: (typeof fixtureIds)[number]) => {
  const decision = rightsAndPrivacyDecisionByFixture.get(fixtureId);
  if (!decision) throw new TypeError(`Missing fixed rights/privacy decision ${fixtureId}.`);
  return decision;
};

const pendingEntryIndexByFixture = {
  'banner-person-v1': 0,
  'banner-product-v1': 1,
  'banner-text-heavy-v1': 2,
  'banner-no-text-v1': 3,
} as const;

const sourceBindingFor = (fixtureId: (typeof fixtureIds)[number]) => {
  const pendingEntryIndex = pendingEntryIndexByFixture[fixtureId];
  const pendingEntry = REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2.entries[pendingEntryIndex];
  return HumanOracleSourceBindingV2Schema.parse({
    sourceBindingVersion: 2,
    fixtureId,
    pendingEntryIndex,
    pendingCorpusCoreSha256: PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256,
    capRevisionSha256: FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256,
    original: {
      detectedMediaType: pendingEntry.packageOriginal.detectedMediaType,
      byteSize: pendingEntry.packageOriginal.byteSize,
      pixelWidth: pendingEntry.packageOriginal.pixelWidth,
      pixelHeight: pendingEntry.packageOriginal.pixelHeight,
      sha256: pendingEntry.packageOriginal.sha256,
    },
    canonicalNormalized: {
      detectedMediaType: pendingEntry.canonicalNormalized.detectedMediaType,
      byteSize: pendingEntry.canonicalNormalized.byteSize,
      pixelWidth: pendingEntry.canonicalNormalized.pixelWidth,
      pixelHeight: pendingEntry.canonicalNormalized.pixelHeight,
      sha256: pendingEntry.canonicalNormalized.sha256,
    },
    sourcePairOrder: 'original-then-canonical-normalized',
  });
};

export const HUMAN_ORACLE_SOURCE_BINDINGS_V2 = Object.freeze(fixtureIds.map(sourceBindingFor));

const approvedOracleCorePins = new Map<string, unknown>();

const HumanOracleApprovedCoreV2Schema = z
  .strictObject({
    oracleVersion: z.literal(2),
    evidenceRole: z.literal('human-expected-oracle-v2'),
    reviewStatus: z.literal('human-approved'),
    humanApprovalAuthority: z.literal(true),
    fixtureId: z.enum(fixtureIds),
    scenario: z.enum(['mixed-subject-copy', 'product-with-copy', 'text-heavy', 'no-text-layered']),
    sourceBinding: HumanOracleSourceBindingV2Schema,
    statementBundle: HumanOracleFixtureStatementBundleV2Schema,
    repositoryBindings: HumanOracleRepositoryBindingsV2Schema,
    rightsAndPrivacyDecision: HumanOracleRightsAndPrivacyDecisionV2Schema,
    requiredLayers: z.array(HumanOracleApprovedLayerV2Schema).min(3).max(5).readonly(),
    expectedTextOccurrences: z.array(HumanOracleApprovedTextOccurrenceV2Schema).max(100).readonly(),
    ocrPolicy: HumanOracleOcrPolicyV2Schema,
    separateOwnerApprovalEvidence: z.literal('required-and-bound-after-oracle-digest'),
    providerNeutral: z.literal(true),
    admissionAuthority: z.literal(false),
    requestPlanAuthority: z.literal(false),
    providerCallAuthority: z.literal(false),
    dispatchAuthority: z.literal(false),
    digestScope: z.literal('canonical-json-approved-human-oracle-core-v2'),
  })
  .superRefine((oracle, context) => {
    const layerIds = oracle.requiredLayers.map((layer) => layer.oracleLayerId);
    const occurrenceIds = oracle.expectedTextOccurrences.map(
      (occurrence) => occurrence.oracleOccurrenceId,
    );
    const unresolvedWatermark =
      oracle.ocrPolicy.policyKind === 'approved-main-text-with-unresolved-watermark';
    if (
      oracle.sourceBinding.fixtureId !== oracle.fixtureId ||
      oracle.statementBundle.fixtureId !== oracle.fixtureId ||
      oracle.rightsAndPrivacyDecision.fixtureId !== oracle.fixtureId ||
      !exactCanonicalEquality(oracle.repositoryBindings, HUMAN_ORACLE_REPOSITORY_BINDINGS_V2) ||
      new Set(layerIds).size !== layerIds.length ||
      new Set(occurrenceIds).size !== occurrenceIds.length ||
      (oracle.scenario === 'mixed-subject-copy' || oracle.scenario === 'text-heavy') !==
        unresolvedWatermark ||
      (oracle.scenario === 'no-text-layered' &&
        (oracle.expectedTextOccurrences.length !== 0 ||
          oracle.requiredLayers.some((layer) => layer.role === 'text'))) ||
      (oracle.scenario !== 'no-text-layered' &&
        !oracle.requiredLayers.some((layer) => layer.role === 'text'))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Approved oracle fixture, evidence, layer, text, or OCR-policy binding drifted.',
      });
    }
    const exactPin = approvedOracleCorePins.get(oracle.fixtureId);
    if (exactPin !== undefined && !exactCanonicalEquality(oracle, exactPin)) {
      context.addIssue({
        code: 'custom',
        message: 'Approved human-oracle content differs from its exact fixture pin.',
      });
    }
  });

export const digestHumanOracleApprovedV2 = (input: unknown): string =>
  digestCanonical(HumanOracleApprovedCoreV2Schema.parse(input));

export const HumanOracleApprovedV2Schema = z
  .strictObject({
    ...HumanOracleApprovedCoreV2Schema.shape,
    oracleSha256: Sha256HexSchema,
  })
  .superRefine((oracle, context) => {
    const { oracleSha256, ...core } = oracle;
    const parsedCore = HumanOracleApprovedCoreV2Schema.safeParse(core);
    if (!parsedCore.success || oracleSha256 !== digestHumanOracleApprovedV2(core)) {
      context.addIssue({
        code: 'custom',
        message: 'Approved human-oracle digest drifted.',
        path: ['oracleSha256'],
      });
    }
  })
  .readonly();

const approvedLayer = (
  oracleLayerId: string,
  approvedLabel: string,
  role: 'background' | 'subject' | 'foreground' | 'decoration' | 'text' | 'other',
  boundingBox: ReturnType<typeof box>,
) => ({
  oracleLayerId,
  approvedLabel,
  role,
  boundingBox,
  required: true as const,
  approvalBasis: 'local-project-owner-approved-human-oracle-v2' as const,
});

const personOracleCore = {
  oracleVersion: 2 as const,
  evidenceRole: 'human-expected-oracle-v2' as const,
  reviewStatus: 'human-approved' as const,
  humanApprovalAuthority: true as const,
  fixtureId: 'banner-person-v1' as const,
  scenario: 'mixed-subject-copy' as const,
  sourceBinding: sourceBindingFor('banner-person-v1'),
  statementBundle: statementBundleFor('banner-person-v1'),
  repositoryBindings: HUMAN_ORACLE_REPOSITORY_BINDINGS_V2,
  rightsAndPrivacyDecision: rightsAndPrivacyDecisionFor('banner-person-v1'),
  requiredLayers: [
    approvedLayer(
      'person.layer.background',
      'geometric red/orange/cream background',
      'background',
      box(0, 0, 10_000, 10_000),
    ),
    approvedLayer(
      'person.layer.copy-block',
      'left headline/body-copy block',
      'text',
      box(300, 700, 3_100, 8_700),
    ),
    approvedLayer(
      'person.layer.call-to-action',
      'Learn More button and website line',
      'foreground',
      box(3_900, 5_900, 1_900, 3_200),
    ),
    approvedLayer(
      'person.layer.adult-subject',
      'recognizable adult in business attire',
      'subject',
      box(6_400, 0, 2_200, 10_000),
    ),
    approvedLayer(
      'person.layer.logo',
      'Your Logo placeholder mark',
      'decoration',
      box(8_850, 7_650, 1_050, 1_950),
    ),
  ],
  expectedTextOccurrences: [
    approvedText('person.text.build', 'BUILD', box(400, 900, 1_200, 1_350)),
    approvedText('person.text.your', 'YOUR', box(400, 2_450, 1_250, 1_250)),
    approvedText('person.text.business', 'BUSINESS', box(400, 4_100, 1_950, 1_600)),
    approvedText(
      'person.text.body',
      'Lorem ipsum dolor sit\namet, consectetur adipiscing\nelit sed non risus.',
      box(400, 6_950, 2_600, 2_400),
    ),
    approvedText('person.text.learn-more', 'Learn More', box(4_150, 6_250, 1_150, 950)),
    approvedText('person.text.website', 'www.yourwebsite.com', box(3_900, 8_250, 1_800, 750)),
    approvedText('person.text.logo', 'YOUR\nLOGO', box(8_950, 7_950, 850, 1_500)),
  ],
  ocrPolicy: {
    policyVersion: 2 as const,
    policyKind: 'approved-main-text-with-unresolved-watermark' as const,
    watermarkDisposition: 'permitted-unscored-ocr-uncertainty' as const,
    transcriptionRule: 'do-not-invent-or-treat-unresolved-content-as-exact-oracle-text' as const,
    extraObservationPrecisionStatus: 'unavailable-unscored' as const,
    fullExactOcrEligible: false as const,
    fullExactOcrResult: 'prohibited-even-when-approved-main-text-is-perfect' as const,
  },
  separateOwnerApprovalEvidence: 'required-and-bound-after-oracle-digest' as const,
  providerNeutral: true as const,
  admissionAuthority: false as const,
  requestPlanAuthority: false as const,
  providerCallAuthority: false as const,
  dispatchAuthority: false as const,
  digestScope: 'canonical-json-approved-human-oracle-core-v2' as const,
};

approvedOracleCorePins.set(personOracleCore.fixtureId, personOracleCore);

export const BANNER_PERSON_HUMAN_ORACLE_V2 = HumanOracleApprovedV2Schema.parse({
  ...personOracleCore,
  oracleSha256: digestHumanOracleApprovedV2(personOracleCore),
});

const productOracleCore = {
  oracleVersion: 2 as const,
  evidenceRole: 'human-expected-oracle-v2' as const,
  reviewStatus: 'human-approved' as const,
  humanApprovalAuthority: true as const,
  fixtureId: 'banner-product-v1' as const,
  scenario: 'product-with-copy' as const,
  sourceBinding: sourceBindingFor('banner-product-v1'),
  statementBundle: statementBundleFor('banner-product-v1'),
  repositoryBindings: HUMAN_ORACLE_REPOSITORY_BINDINGS_V2,
  rightsAndPrivacyDecision: rightsAndPrivacyDecisionFor('banner-product-v1'),
  requiredLayers: [
    approvedLayer(
      'product.layer.background',
      'photographic background including blurred plants and patterned panel',
      'background',
      box(0, 0, 10_000, 10_000),
    ),
    approvedLayer(
      'product.layer.candle',
      'foreground candle jar and label',
      'subject',
      box(3_000, 3_900, 2_200, 5_900),
    ),
    approvedLayer(
      'product.layer.headline',
      'right-side headline',
      'text',
      box(6_100, 2_200, 3_000, 1_400),
    ),
  ],
  expectedTextOccurrences: [
    approvedText('product.text.headline', 'blurry background', box(6_150, 2_550, 2_750, 650)),
    approvedText('product.text.brand', 'TONKA + OUD', box(3_500, 6_650, 1_100, 500)),
    approvedText(
      'product.text.label-company',
      'candles, candles, candles co.',
      box(3_500, 7_150, 1_100, 300),
    ),
    approvedText('product.text.label-type', 'soy wax candle', box(4_050, 8_100, 600, 300)),
    approvedText('product.text.label-weight', 'NET WT. 8 OZ', box(4_050, 8_500, 600, 300)),
  ],
  ocrPolicy: {
    policyVersion: 2 as const,
    policyKind: 'complete-visible-semantic-text-oracle' as const,
    watermarkDisposition: 'none-unresolved' as const,
    transcriptionRule: 'all-approved-semantic-text-is-exact-oracle-text' as const,
    extraObservationPrecisionStatus: 'available-scored' as const,
    fullExactOcrEligible: true as const,
    fullExactOcrResult: 'requires-full-precision-recall-and-box-accuracy' as const,
  },
  separateOwnerApprovalEvidence: 'required-and-bound-after-oracle-digest' as const,
  providerNeutral: true as const,
  admissionAuthority: false as const,
  requestPlanAuthority: false as const,
  providerCallAuthority: false as const,
  dispatchAuthority: false as const,
  digestScope: 'canonical-json-approved-human-oracle-core-v2' as const,
};

approvedOracleCorePins.set(productOracleCore.fixtureId, productOracleCore);

export const BANNER_PRODUCT_HUMAN_ORACLE_V2 = HumanOracleApprovedV2Schema.parse({
  ...productOracleCore,
  oracleSha256: digestHumanOracleApprovedV2(productOracleCore),
});

const textHeavyOracleCore = {
  oracleVersion: 2 as const,
  evidenceRole: 'human-expected-oracle-v2' as const,
  reviewStatus: 'human-approved' as const,
  humanApprovalAuthority: true as const,
  fixtureId: 'banner-text-heavy-v1' as const,
  scenario: 'text-heavy' as const,
  sourceBinding: sourceBindingFor('banner-text-heavy-v1'),
  statementBundle: statementBundleFor('banner-text-heavy-v1'),
  repositoryBindings: HUMAN_ORACLE_REPOSITORY_BINDINGS_V2,
  rightsAndPrivacyDecision: rightsAndPrivacyDecisionFor('banner-text-heavy-v1'),
  requiredLayers: [
    approvedLayer(
      'text-heavy.layer.background',
      'neutral product-mockup background/floor',
      'background',
      box(0, 0, 10_000, 10_000),
    ),
    approvedLayer(
      'text-heavy.layer.stand',
      'retractable banner stand hardware',
      'subject',
      box(1_900, 300, 6_100, 9_600),
    ),
    approvedLayer(
      'text-heavy.layer.header',
      'brand mark, header art, and title',
      'text',
      box(2_150, 800, 5_650, 3_400),
    ),
    approvedLayer(
      'text-heavy.layer.options',
      'numbered banner-option list',
      'text',
      box(2_200, 4_300, 5_550, 4_500),
    ),
    approvedLayer(
      'text-heavy.layer.lower-accent',
      'lower accent and stand base',
      'foreground',
      box(2_000, 8_250, 5_900, 1_700),
    ),
  ],
  expectedTextOccurrences: [
    approvedText('text-heavy.text.brand', 'HALF PRICE\nBANNERS', box(5_600, 850, 1_450, 950)),
    approvedText('text-heavy.text.title', 'BANNER\nOPTIONS', box(2_650, 2_000, 4_500, 1_250)),
    approvedText('text-heavy.text.option-1-number', '1', box(2_600, 4_650, 500, 450)),
    approvedText(
      'text-heavy.text.option-1',
      'Large Format Double-\nSided Banners',
      box(3_450, 4_600, 4_200, 700),
    ),
    approvedText('text-heavy.text.option-2-number', '2', box(2_600, 5_600, 500, 450)),
    approvedText(
      'text-heavy.text.option-2',
      'Large Format Vinyl\nBanners',
      box(3_450, 5_550, 4_200, 700),
    ),
    approvedText('text-heavy.text.option-3-number', '3', box(2_600, 6_550, 500, 450)),
    approvedText(
      'text-heavy.text.option-3',
      'Large Format Double-\nSided Fence Banners',
      box(3_450, 6_500, 4_300, 750),
    ),
    approvedText('text-heavy.text.option-4-number', '4', box(2_600, 7_500, 500, 450)),
    approvedText(
      'text-heavy.text.option-4',
      'Large Format Mesh\nBanners',
      box(3_450, 7_450, 4_200, 700),
    ),
  ],
  ocrPolicy: {
    policyVersion: 2 as const,
    policyKind: 'approved-main-text-with-unresolved-watermark' as const,
    watermarkDisposition: 'permitted-unscored-ocr-uncertainty' as const,
    transcriptionRule: 'do-not-invent-or-treat-unresolved-content-as-exact-oracle-text' as const,
    extraObservationPrecisionStatus: 'unavailable-unscored' as const,
    fullExactOcrEligible: false as const,
    fullExactOcrResult: 'prohibited-even-when-approved-main-text-is-perfect' as const,
  },
  separateOwnerApprovalEvidence: 'required-and-bound-after-oracle-digest' as const,
  providerNeutral: true as const,
  admissionAuthority: false as const,
  requestPlanAuthority: false as const,
  providerCallAuthority: false as const,
  dispatchAuthority: false as const,
  digestScope: 'canonical-json-approved-human-oracle-core-v2' as const,
};

approvedOracleCorePins.set(textHeavyOracleCore.fixtureId, textHeavyOracleCore);

export const BANNER_TEXT_HEAVY_HUMAN_ORACLE_V2 = HumanOracleApprovedV2Schema.parse({
  ...textHeavyOracleCore,
  oracleSha256: digestHumanOracleApprovedV2(textHeavyOracleCore),
});

const noTextOracleCore = {
  oracleVersion: 2 as const,
  evidenceRole: 'human-expected-oracle-v2' as const,
  reviewStatus: 'human-approved' as const,
  humanApprovalAuthority: true as const,
  fixtureId: 'banner-no-text-v1' as const,
  scenario: 'no-text-layered' as const,
  sourceBinding: sourceBindingFor('banner-no-text-v1'),
  statementBundle: statementBundleFor('banner-no-text-v1'),
  repositoryBindings: HUMAN_ORACLE_REPOSITORY_BINDINGS_V2,
  rightsAndPrivacyDecision: rightsAndPrivacyDecisionFor('banner-no-text-v1'),
  requiredLayers: [
    approvedLayer(
      'no-text.layer.background-composite',
      'background composite including peach field, cream panel, shadow, and frame',
      'background',
      box(0, 0, 10_000, 10_000),
    ),
    approvedLayer(
      'no-text.layer.cyan-decorations',
      'grouped cyan decorations',
      'decoration',
      box(400, 1_650, 9_150, 6_700),
    ),
    approvedLayer(
      'no-text.layer.coral-sunbursts',
      'grouped coral sunbursts',
      'decoration',
      box(250, 1_350, 9_300, 7_250),
    ),
  ],
  expectedTextOccurrences: [],
  ocrPolicy: {
    policyVersion: 2 as const,
    policyKind: 'complete-visible-semantic-text-oracle' as const,
    watermarkDisposition: 'none-unresolved' as const,
    transcriptionRule: 'all-approved-semantic-text-is-exact-oracle-text' as const,
    extraObservationPrecisionStatus: 'available-scored' as const,
    fullExactOcrEligible: true as const,
    fullExactOcrResult: 'requires-full-precision-recall-and-box-accuracy' as const,
  },
  separateOwnerApprovalEvidence: 'required-and-bound-after-oracle-digest' as const,
  providerNeutral: true as const,
  admissionAuthority: false as const,
  requestPlanAuthority: false as const,
  providerCallAuthority: false as const,
  dispatchAuthority: false as const,
  digestScope: 'canonical-json-approved-human-oracle-core-v2' as const,
};

approvedOracleCorePins.set(noTextOracleCore.fixtureId, noTextOracleCore);

export const BANNER_NO_TEXT_HUMAN_ORACLE_V2 = HumanOracleApprovedV2Schema.parse({
  ...noTextOracleCore,
  oracleSha256: digestHumanOracleApprovedV2(noTextOracleCore),
});

export const HumanOracleApprovedTupleV2Schema = z
  .tuple([
    HumanOracleApprovedV2Schema,
    HumanOracleApprovedV2Schema,
    HumanOracleApprovedV2Schema,
    HumanOracleApprovedV2Schema,
  ])
  .superRefine((oracles, context) => {
    if (
      !exactCanonicalEquality(
        oracles.map((oracle) => oracle.fixtureId),
        fixtureIds,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Approved human oracles must use exact four-fixture order.',
      });
    }
  })
  .readonly();

export const HUMAN_ORACLE_APPROVED_ORACLES_V2 = HumanOracleApprovedTupleV2Schema.parse([
  BANNER_PERSON_HUMAN_ORACLE_V2,
  BANNER_PRODUCT_HUMAN_ORACLE_V2,
  BANNER_TEXT_HEAVY_HUMAN_ORACLE_V2,
  BANNER_NO_TEXT_HUMAN_ORACLE_V2,
]);

export const HUMAN_ORACLE_APPROVED_BY_FIXTURE_V2 = Object.freeze({
  'banner-person-v1': BANNER_PERSON_HUMAN_ORACLE_V2,
  'banner-product-v1': BANNER_PRODUCT_HUMAN_ORACLE_V2,
  'banner-text-heavy-v1': BANNER_TEXT_HEAVY_HUMAN_ORACLE_V2,
  'banner-no-text-v1': BANNER_NO_TEXT_HUMAN_ORACLE_V2,
});

const ownerApprovalEvidenceCorePins = new Map<string, unknown>();

const LocalProjectOwnerHumanOracleApprovalEvidenceCoreV2Schema = z
  .strictObject({
    approvalEvidenceVersion: z.literal(2),
    evidenceRole: z.literal('local-project-owner-human-oracle-approval-evidence-v2'),
    reviewStatus: z.literal('human-approved'),
    reviewerRole: z.literal('local-project-owner'),
    approvalRecordedAt: z.literal(HUMAN_ORACLE_APPROVAL_RECORDED_AT),
    approvalRecordedAtMeaning: z.literal(
      'utc-implementation-recording-time-not-user-account-or-message-time',
    ),
    fixtureId: z.enum(fixtureIds),
    sourceBinding: HumanOracleSourceBindingV2Schema,
    pendingCorpusCoreSha256: z.literal(PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256),
    capRevisionSha256: z.literal(FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256),
    repositoryBindings: HumanOracleRepositoryBindingsV2Schema,
    statementBundle: HumanOracleFixtureStatementBundleV2Schema,
    rightsAndPrivacyDecision: HumanOracleRightsAndPrivacyDecisionV2Schema,
    approvedOracleVersion: z.literal(2),
    approvedOracleSha256: Sha256HexSchema,
    humanApproval: z.literal(true),
    approvalScope: z.literal('human-oracle-and-local-corpus-readiness-evidence-only'),
    imageTransmission: z.literal('not-performed'),
    admissionAuthority: z.literal(false),
    requestPlanAuthority: z.literal(false),
    providerCallAuthority: z.literal(false),
    dispatchAuthority: z.literal(false),
    digestScope: z.literal('canonical-json-local-project-owner-approval-core-v2'),
  })
  .superRefine((evidence, context) => {
    const oracle = HUMAN_ORACLE_APPROVED_BY_FIXTURE_V2[evidence.fixtureId];
    if (
      evidence.sourceBinding.original.sha256 !== oracle.sourceBinding.original.sha256 ||
      evidence.sourceBinding.canonicalNormalized.sha256 !==
        oracle.sourceBinding.canonicalNormalized.sha256 ||
      !exactCanonicalEquality(evidence.sourceBinding, oracle.sourceBinding) ||
      !exactCanonicalEquality(evidence.repositoryBindings, HUMAN_ORACLE_REPOSITORY_BINDINGS_V2) ||
      !exactCanonicalEquality(evidence.statementBundle, oracle.statementBundle) ||
      !exactCanonicalEquality(evidence.rightsAndPrivacyDecision, oracle.rightsAndPrivacyDecision) ||
      evidence.approvedOracleVersion !== oracle.oracleVersion ||
      evidence.approvedOracleSha256 !== oracle.oracleSha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Owner approval uses a stale or foreign source, statement, decision, or oracle.',
      });
    }
    const exactPin = ownerApprovalEvidenceCorePins.get(evidence.fixtureId);
    if (exactPin !== undefined && !exactCanonicalEquality(evidence, exactPin)) {
      context.addIssue({
        code: 'custom',
        message: 'Owner-approval evidence differs from its exact fixture pin.',
      });
    }
  });

export const digestLocalProjectOwnerHumanOracleApprovalEvidenceV2 = (input: unknown): string =>
  digestCanonical(LocalProjectOwnerHumanOracleApprovalEvidenceCoreV2Schema.parse(input));

export const LocalProjectOwnerHumanOracleApprovalEvidenceV2Schema = z
  .strictObject({
    ...LocalProjectOwnerHumanOracleApprovalEvidenceCoreV2Schema.shape,
    approvalEvidenceSha256: Sha256HexSchema,
  })
  .superRefine((evidence, context) => {
    const { approvalEvidenceSha256, ...core } = evidence;
    const parsedCore = LocalProjectOwnerHumanOracleApprovalEvidenceCoreV2Schema.safeParse(core);
    if (
      !parsedCore.success ||
      approvalEvidenceSha256 !== digestLocalProjectOwnerHumanOracleApprovalEvidenceV2(core)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Local-project-owner approval evidence digest drifted.',
        path: ['approvalEvidenceSha256'],
      });
    }
  })
  .readonly();

const ownerApprovalEvidenceCoreFor = (fixtureId: (typeof fixtureIds)[number]) => {
  const oracle = HUMAN_ORACLE_APPROVED_BY_FIXTURE_V2[fixtureId];
  return {
    approvalEvidenceVersion: 2 as const,
    evidenceRole: 'local-project-owner-human-oracle-approval-evidence-v2' as const,
    reviewStatus: 'human-approved' as const,
    reviewerRole: 'local-project-owner' as const,
    approvalRecordedAt: HUMAN_ORACLE_APPROVAL_RECORDED_AT,
    approvalRecordedAtMeaning:
      'utc-implementation-recording-time-not-user-account-or-message-time' as const,
    fixtureId,
    sourceBinding: oracle.sourceBinding,
    pendingCorpusCoreSha256: PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256,
    capRevisionSha256: FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256,
    repositoryBindings: HUMAN_ORACLE_REPOSITORY_BINDINGS_V2,
    statementBundle: oracle.statementBundle,
    rightsAndPrivacyDecision: oracle.rightsAndPrivacyDecision,
    approvedOracleVersion: oracle.oracleVersion,
    approvedOracleSha256: oracle.oracleSha256,
    humanApproval: true as const,
    approvalScope: 'human-oracle-and-local-corpus-readiness-evidence-only' as const,
    imageTransmission: 'not-performed' as const,
    admissionAuthority: false as const,
    requestPlanAuthority: false as const,
    providerCallAuthority: false as const,
    dispatchAuthority: false as const,
    digestScope: 'canonical-json-local-project-owner-approval-core-v2' as const,
  };
};

const ownerApprovalEvidenceCores = fixtureIds.map(ownerApprovalEvidenceCoreFor);
for (const core of ownerApprovalEvidenceCores) {
  ownerApprovalEvidenceCorePins.set(core.fixtureId, core);
}

export const LocalProjectOwnerHumanOracleApprovalEvidenceTupleV2Schema = z
  .tuple([
    LocalProjectOwnerHumanOracleApprovalEvidenceV2Schema,
    LocalProjectOwnerHumanOracleApprovalEvidenceV2Schema,
    LocalProjectOwnerHumanOracleApprovalEvidenceV2Schema,
    LocalProjectOwnerHumanOracleApprovalEvidenceV2Schema,
  ])
  .superRefine((records, context) => {
    if (
      !exactCanonicalEquality(
        records.map((record) => record.fixtureId),
        fixtureIds,
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Owner approvals must use exact fixture order.',
      });
    }
  })
  .readonly();

export const HUMAN_ORACLE_OWNER_APPROVAL_EVIDENCE_V2 =
  LocalProjectOwnerHumanOracleApprovalEvidenceTupleV2Schema.parse(
    ownerApprovalEvidenceCores.map((core) => ({
      ...core,
      approvalEvidenceSha256: digestLocalProjectOwnerHumanOracleApprovalEvidenceV2(core),
    })),
  );

const ownerApprovalEvidenceByFixture = Object.freeze({
  'banner-person-v1': HUMAN_ORACLE_OWNER_APPROVAL_EVIDENCE_V2[0],
  'banner-product-v1': HUMAN_ORACLE_OWNER_APPROVAL_EVIDENCE_V2[1],
  'banner-text-heavy-v1': HUMAN_ORACLE_OWNER_APPROVAL_EVIDENCE_V2[2],
  'banner-no-text-v1': HUMAN_ORACLE_OWNER_APPROVAL_EVIDENCE_V2[3],
});

const humanOracleEntryCorePins = new Map<string, unknown>();

const HumanOracleApprovedCorpusEntryCoreV2Schema = z
  .strictObject({
    entryVersion: z.literal(2),
    evidenceRole: z.literal('human-oracle-approved-corpus-entry-v2'),
    fixtureId: z.enum(fixtureIds),
    scenario: z.enum(['mixed-subject-copy', 'product-with-copy', 'text-heavy', 'no-text-layered']),
    sourceBinding: HumanOracleSourceBindingV2Schema,
    statementBundle: HumanOracleFixtureStatementBundleV2Schema,
    approvedOracle: HumanOracleApprovedV2Schema,
    ownerApprovalEvidence: LocalProjectOwnerHumanOracleApprovalEvidenceV2Schema,
    pendingCorpusCoreSha256: z.literal(PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256),
    capRevisionSha256: z.literal(FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256),
    repositoryBindings: HumanOracleRepositoryBindingsV2Schema,
    humanOracleApproved: z.literal(true),
    corpusAdmissionReady: z.literal(true),
    draftDisposition: z.literal('codex-draft-unapproved-preserved-unchanged-never-promoted'),
    active: z.literal(false),
    dispatchable: z.literal(false),
    admissionAuthority: z.literal(false),
    requestPlanAuthority: z.literal(false),
    providerCallAuthority: z.literal(false),
    dispatchAuthority: z.literal(false),
    digestScope: z.literal('canonical-json-human-oracle-approved-entry-core-v2'),
  })
  .superRefine((entry, context) => {
    const oracle = HUMAN_ORACLE_APPROVED_BY_FIXTURE_V2[entry.fixtureId];
    const approval = ownerApprovalEvidenceByFixture[entry.fixtureId];
    if (
      entry.scenario !== oracle.scenario ||
      !exactCanonicalEquality(entry.sourceBinding, oracle.sourceBinding) ||
      !exactCanonicalEquality(entry.statementBundle, oracle.statementBundle) ||
      !exactCanonicalEquality(entry.approvedOracle, oracle) ||
      !exactCanonicalEquality(entry.ownerApprovalEvidence, approval) ||
      entry.ownerApprovalEvidence.approvedOracleSha256 !== entry.approvedOracle.oracleSha256 ||
      entry.ownerApprovalEvidence.approvalEvidenceSha256 !== approval.approvalEvidenceSha256 ||
      !exactCanonicalEquality(entry.repositoryBindings, HUMAN_ORACLE_REPOSITORY_BINDINGS_V2)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'Human-oracle entry uses stale or foreign source, statements, oracle, or approval.',
      });
    }
    const exactPin = humanOracleEntryCorePins.get(entry.fixtureId);
    if (exactPin !== undefined && !exactCanonicalEquality(entry, exactPin)) {
      context.addIssue({
        code: 'custom',
        message: 'Human-oracle entry differs from its exact fixture pin.',
      });
    }
  });

export const digestHumanOracleApprovedCorpusEntryV2 = (input: unknown): string =>
  digestCanonical(HumanOracleApprovedCorpusEntryCoreV2Schema.parse(input));

export const HumanOracleApprovedCorpusEntryV2Schema = z
  .strictObject({
    ...HumanOracleApprovedCorpusEntryCoreV2Schema.shape,
    entrySha256: Sha256HexSchema,
  })
  .superRefine((entry, context) => {
    const { entrySha256, ...core } = entry;
    const parsedCore = HumanOracleApprovedCorpusEntryCoreV2Schema.safeParse(core);
    if (!parsedCore.success || entrySha256 !== digestHumanOracleApprovedCorpusEntryV2(core)) {
      context.addIssue({
        code: 'custom',
        message: 'Human-oracle approved entry digest drifted.',
        path: ['entrySha256'],
      });
    }
  })
  .readonly();

const humanOracleEntryCoreFor = (fixtureId: (typeof fixtureIds)[number]) => {
  const approvedOracle = HUMAN_ORACLE_APPROVED_BY_FIXTURE_V2[fixtureId];
  return {
    entryVersion: 2 as const,
    evidenceRole: 'human-oracle-approved-corpus-entry-v2' as const,
    fixtureId,
    scenario: approvedOracle.scenario,
    sourceBinding: approvedOracle.sourceBinding,
    statementBundle: approvedOracle.statementBundle,
    approvedOracle,
    ownerApprovalEvidence: ownerApprovalEvidenceByFixture[fixtureId],
    pendingCorpusCoreSha256: PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256,
    capRevisionSha256: FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256,
    repositoryBindings: HUMAN_ORACLE_REPOSITORY_BINDINGS_V2,
    humanOracleApproved: true as const,
    corpusAdmissionReady: true as const,
    draftDisposition: 'codex-draft-unapproved-preserved-unchanged-never-promoted' as const,
    active: false as const,
    dispatchable: false as const,
    admissionAuthority: false as const,
    requestPlanAuthority: false as const,
    providerCallAuthority: false as const,
    dispatchAuthority: false as const,
    digestScope: 'canonical-json-human-oracle-approved-entry-core-v2' as const,
  };
};

const humanOracleEntryCores = fixtureIds.map(humanOracleEntryCoreFor);
for (const core of humanOracleEntryCores) {
  humanOracleEntryCorePins.set(core.fixtureId, core);
}

export const HumanOracleApprovedCorpusEntryTupleV2Schema = z
  .tuple([
    HumanOracleApprovedCorpusEntryV2Schema,
    HumanOracleApprovedCorpusEntryV2Schema,
    HumanOracleApprovedCorpusEntryV2Schema,
    HumanOracleApprovedCorpusEntryV2Schema,
  ])
  .superRefine((entries, context) => {
    if (
      !exactCanonicalEquality(
        entries.map((entry) => entry.fixtureId),
        fixtureIds,
      )
    ) {
      context.addIssue({ code: 'custom', message: 'Human-oracle entries must use exact order.' });
    }
  })
  .readonly();

export const HUMAN_ORACLE_APPROVED_CORPUS_ENTRIES_V2 =
  HumanOracleApprovedCorpusEntryTupleV2Schema.parse(
    humanOracleEntryCores.map((core) => ({
      ...core,
      entrySha256: digestHumanOracleApprovedCorpusEntryV2(core),
    })),
  );

const HumanOracleFixtureStatementBundleTupleV2Schema = z
  .tuple([
    HumanOracleFixtureStatementBundleV2Schema,
    HumanOracleFixtureStatementBundleV2Schema,
    HumanOracleFixtureStatementBundleV2Schema,
    HumanOracleFixtureStatementBundleV2Schema,
  ])
  .superRefine((bundles, context) => {
    if (
      !exactCanonicalEquality(
        bundles.map((bundle) => bundle.fixtureId),
        fixtureIds,
      )
    ) {
      context.addIssue({ code: 'custom', message: 'Statement bundles must use exact order.' });
    }
  })
  .readonly();

const HumanOracleApprovedCorpusCoreV2Schema = z
  .strictObject({
    corpusVersion: z.literal(2),
    revisionId: z.literal('banner-ai-four-fixture-human-oracle-v2'),
    evidenceRole: z.literal('human-oracle-approved-corpus-v2'),
    profileId: z.literal(REAL_MODEL_BENCHMARK_PROFILE_ID),
    status: z.literal('human-oracle-approved'),
    purpose: z.literal('provider-free-human-oracle-evaluation-evidence-only'),
    approvalRecordedAt: z.literal(HUMAN_ORACLE_APPROVAL_RECORDED_AT),
    approvalRecordedAtMeaning: z.literal(
      'utc-implementation-recording-time-not-user-account-or-message-time',
    ),
    pendingCorpusCoreSha256: z.literal(PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256),
    capRevisionSha256: z.literal(FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256),
    repositoryBindings: HumanOracleRepositoryBindingsV2Schema,
    statementBundles: HumanOracleFixtureStatementBundleTupleV2Schema,
    entries: HumanOracleApprovedCorpusEntryTupleV2Schema,
    humanOracleApproved: z.literal(true),
    corpusAdmissionReady: z.literal(true),
    draftDisposition: z.literal('all-codex-draft-unapproved-records-preserved-unchanged'),
    active: z.literal(false),
    dispatchable: z.literal(false),
    admissionAuthority: z.literal(false),
    requestPlanAuthority: z.literal(false),
    providerCallAuthority: z.literal(false),
    dispatchAuthority: z.literal(false),
    productionExecutionRegistry: z.literal('empty-unchanged'),
    productionSourceRegistry: z.literal('empty-unchanged'),
    providerTransport: z.literal('absent'),
    webRouteAccess: z.literal('none'),
    imageTransmission: z.literal('not-performed'),
    committedExecutionAuthorization: z.literal('absent'),
    manualRelease: z.literal('absent'),
    digestScope: z.literal('canonical-json-human-oracle-approved-corpus-core-v2'),
  })
  .superRefine((corpus, context) => {
    if (
      !exactCanonicalEquality(corpus.repositoryBindings, HUMAN_ORACLE_REPOSITORY_BINDINGS_V2) ||
      !exactCanonicalEquality(corpus.statementBundles, HUMAN_ORACLE_FIXTURE_STATEMENT_BUNDLES_V2) ||
      !exactCanonicalEquality(corpus.entries, HUMAN_ORACLE_APPROVED_CORPUS_ENTRIES_V2) ||
      new Set(corpus.entries.map((entry) => entry.fixtureId)).size !== 4 ||
      new Set(
        corpus.entries.flatMap((entry) => [
          entry.sourceBinding.original.sha256,
          entry.sourceBinding.canonicalNormalized.sha256,
        ]),
      ).size !== 8
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Human-oracle corpus bindings, entries, fixtures, or sources drifted.',
      });
    }
    if (
      humanOracleCorpusCorePin !== undefined &&
      !exactCanonicalEquality(corpus, humanOracleCorpusCorePin)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Human-oracle corpus differs from its exact whole-core pin.',
      });
    }
  });

export const digestHumanOracleApprovedCorpusV2 = (input: unknown): string =>
  digestCanonical(HumanOracleApprovedCorpusCoreV2Schema.parse(input));

export const HumanOracleApprovedCorpusV2Schema = z
  .strictObject({
    ...HumanOracleApprovedCorpusCoreV2Schema.shape,
    corpusSha256: Sha256HexSchema,
  })
  .superRefine((corpus, context) => {
    const { corpusSha256, ...core } = corpus;
    const parsedCore = HumanOracleApprovedCorpusCoreV2Schema.safeParse(core);
    if (!parsedCore.success || corpusSha256 !== digestHumanOracleApprovedCorpusV2(core)) {
      context.addIssue({
        code: 'custom',
        message: 'Human-oracle approved corpus digest drifted.',
        path: ['corpusSha256'],
      });
    }
  })
  .readonly();

const humanOracleCorpusCore = {
  corpusVersion: 2 as const,
  revisionId: 'banner-ai-four-fixture-human-oracle-v2' as const,
  evidenceRole: 'human-oracle-approved-corpus-v2' as const,
  profileId: REAL_MODEL_BENCHMARK_PROFILE_ID,
  status: 'human-oracle-approved' as const,
  purpose: 'provider-free-human-oracle-evaluation-evidence-only' as const,
  approvalRecordedAt: HUMAN_ORACLE_APPROVAL_RECORDED_AT,
  approvalRecordedAtMeaning:
    'utc-implementation-recording-time-not-user-account-or-message-time' as const,
  pendingCorpusCoreSha256: PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256,
  capRevisionSha256: FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256,
  repositoryBindings: HUMAN_ORACLE_REPOSITORY_BINDINGS_V2,
  statementBundles: HUMAN_ORACLE_FIXTURE_STATEMENT_BUNDLES_V2,
  entries: HUMAN_ORACLE_APPROVED_CORPUS_ENTRIES_V2,
  humanOracleApproved: true as const,
  corpusAdmissionReady: true as const,
  draftDisposition: 'all-codex-draft-unapproved-records-preserved-unchanged' as const,
  active: false as const,
  dispatchable: false as const,
  admissionAuthority: false as const,
  requestPlanAuthority: false as const,
  providerCallAuthority: false as const,
  dispatchAuthority: false as const,
  productionExecutionRegistry: 'empty-unchanged' as const,
  productionSourceRegistry: 'empty-unchanged' as const,
  providerTransport: 'absent' as const,
  webRouteAccess: 'none' as const,
  imageTransmission: 'not-performed' as const,
  committedExecutionAuthorization: 'absent' as const,
  manualRelease: 'absent' as const,
  digestScope: 'canonical-json-human-oracle-approved-corpus-core-v2' as const,
};

const humanOracleCorpusCorePin: unknown = humanOracleCorpusCore;

export const REAL_MODEL_BENCHMARK_HUMAN_ORACLE_CORPUS_V2 = HumanOracleApprovedCorpusV2Schema.parse({
  ...humanOracleCorpusCore,
  corpusSha256: digestHumanOracleApprovedCorpusV2(humanOracleCorpusCore),
});

export type HumanOracleApprovedCorpusEntryV2 = z.infer<
  typeof HumanOracleApprovedCorpusEntryV2Schema
>;
export type HumanOracleApprovedCorpusV2 = z.infer<typeof HumanOracleApprovedCorpusV2Schema>;
