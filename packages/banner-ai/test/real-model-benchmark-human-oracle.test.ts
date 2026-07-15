import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import * as publicBannerAi from '../src/index.js';
import {
  BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION,
  CodexDraftUnapprovedBannerReviewV1Schema,
  CodexDraftUnapprovedZeroTextReviewV2Schema,
  FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256,
  INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
  OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1,
  PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256,
  PENDING_REAL_MODEL_BENCHMARK_REPOSITORY_BINDINGS_V1,
  REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2,
  RealModelBenchmarkExecutionLedgerV1Schema,
  SCENE_ANALYSIS_PROMPT_V1,
  SelectedRealModelBenchmarkProfileV1Schema,
  TextObservationV1Schema,
  admitRealModelBenchmarkCorpusV1,
  canonicalizeJson,
  sha256Hex,
} from '../src/index.js';
import { PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1 } from '../src/evaluation/openai-real-model-candidate-evidence.js';
import {
  BANNER_NO_TEXT_HUMAN_ORACLE_V2,
  BANNER_PERSON_HUMAN_ORACLE_V2,
  BANNER_PRODUCT_HUMAN_ORACLE_V2,
  BANNER_TEXT_HEAVY_HUMAN_ORACLE_V2,
  HUMAN_ORACLE_APPROVAL_RECORDED_AT,
  HUMAN_ORACLE_APPROVED_CORPUS_ENTRIES_V2,
  HUMAN_ORACLE_APPROVED_ORACLES_V2,
  HUMAN_ORACLE_FIXTURE_STATEMENT_BUNDLES_V2,
  HUMAN_ORACLE_OWNER_APPROVAL_EVIDENCE_V2,
  HUMAN_ORACLE_RAW_STATEMENT_RECORDS_V2,
  HUMAN_ORACLE_REPOSITORY_BINDINGS_V2,
  HUMAN_ORACLE_RIGHTS_AND_PRIVACY_DECISIONS_V2,
  HUMAN_ORACLE_SOURCE_BINDINGS_V2,
  HumanOracleApprovedCorpusEntryV2Schema,
  HumanOracleApprovedCorpusV2Schema,
  HumanOracleApprovedV2Schema,
  HumanOracleFixtureStatementBundleV2Schema,
  LocalProjectOwnerHumanOracleApprovalEvidenceV2Schema,
  REAL_MODEL_BENCHMARK_HUMAN_ORACLE_CORPUS_V2,
  digestHumanOracleApprovedCorpusEntryV2,
  digestHumanOracleApprovedCorpusV2,
  digestHumanOracleApprovedV2,
  digestHumanOracleFixtureStatementBundleV2,
  digestLocalProjectOwnerHumanOracleApprovalEvidenceV2,
} from '../src/evaluation/real-model-benchmark-human-oracle.js';
import {
  HumanOracleOcrQualityInputV2Schema,
  evaluateRealModelBenchmarkHumanOracleOcrQualityV2,
} from '../src/evaluation/real-model-benchmark-human-oracle-quality.js';
import { buildNonDispatchingOpenAiRequestPlanV1 } from '../src/server/openai-real-model-request-boundary.js';
import { REAL_MODEL_BENCHMARK_STATIC_CORPUS_SOURCE_REGISTRY_V1 } from '../src/server/real-model-benchmark-corpus-source-registry.js';

type Primitive = string | number | boolean | bigint | symbol | null | undefined;

type Mutable<Value> = Value extends Primitive
  ? Value
  : Value extends readonly (infer Entry)[]
    ? Mutable<Entry>[]
    : Value extends object
      ? { -readonly [Key in keyof Value]: Mutable<Value[Key]> }
      : Value;

const mutableClone = <Value>(value: Value): Mutable<Value> =>
  structuredClone(value) as Mutable<Value>;

const canonicalDigest = (input: unknown): string =>
  sha256Hex(Buffer.from(canonicalizeJson(input), 'utf8'));

const box = (xBps: number, yBps: number, widthBps: number, heightBps: number) => ({
  unit: 'normalized-basis-points' as const,
  xBps,
  yBps,
  widthBps,
  heightBps,
});

const actualObservation = (
  observationId: string,
  value: string,
  boundingBox: ReturnType<typeof box>,
) =>
  TextObservationV1Schema.parse({
    observationVersion: 1,
    observationId,
    text: {
      kind: 'observed-text',
      value,
      normalization: 'unicode-nfc-single-space-v1',
      contentTrust: 'untrusted-user-image-content',
      instructionAuthority: 'none',
    },
    boundingBox,
    confidence: { unit: 'basis-points', valueBps: 1 },
  });

const actualFromOracle = (
  oracle: (typeof HUMAN_ORACLE_APPROVED_ORACLES_V2)[number],
  prefix: string,
) =>
  oracle.expectedTextOccurrences.map((occurrence, index) =>
    actualObservation(
      `${prefix}_${String(index).padStart(2, '0')}`,
      occurrence.normalizedScoringText,
      occurrence.boundingBox,
    ),
  );

const score = (
  oracle: (typeof HUMAN_ORACLE_APPROVED_ORACLES_V2)[number],
  actualObservations: readonly ReturnType<typeof actualObservation>[],
) =>
  evaluateRealModelBenchmarkHumanOracleOcrQualityV2({
    fixtureId: oracle.fixtureId,
    normalizedSourceSha256: oracle.sourceBinding.canonicalNormalized.sha256,
    oracleSha256: oracle.oracleSha256,
    actualObservations,
  });

describe('provider-free human-oracle evidence', () => {
  it('pins all 11 verbatim statements and every acyclic evidence digest', () => {
    const expectedStatements = [
      [
        'banner-person-v1: user-owned',
        'eb36b312c7949c53801752400567df8a94c1ea26a4ff4d708889b73484a7af10',
      ],
      [
        'banner-product-v1: user-owned',
        'ffce5059bcda594f171d79ce10f2095f8b519152582edfcbf62db7cdd7f72a8b',
      ],
      [
        'banner-text-heavy-v1: user-owned',
        'c77f8c9b49e2533052c52a99df678ab4332d341f6b545db4b60c74394b11f4ea',
      ],
      [
        'banner-no-text-v1: user-owned',
        '8d114a4b68db02f86a00acd8a8b19817af9f331cd1809f8ebf7cea0a3d664fa8',
      ],
      [
        '4-no-text.jpeg is owned. I accept the JFIF-only metadata and privacy findings. The cyan angular forms are decorative shapes, not semantic lettering or a logo. I confirm there is no visible semantic text and approve the empty text-observation set. I approve these corrected layers: background composite, grouped cyan decorations, and grouped coral sunbursts.',
        'f478d9fee48ef8f0f1a2bd70c31a8e1f3813cf30521bd0e02867827ebf306a60',
      ],
      [
        'I accept the documented metadata and privacy findings for the person, product, and text-heavy fixtures. I confirm that I have the necessary rights for the adult likeness/model use, placeholder URL, logos, brand/label text, and visible watermarks for this OpenAI benchmark.',
        'bb60b7497f9799416e7f913d8e862045b4cd5bd52ffcc1efbe240a74f670e230',
      ],
      [
        'I approve the person and text-heavy draft layers, text transcriptions, and approximate boxes. For the product fixture, I approve these corrected layers: photographic background including blurred plants/patterned panel, candle jar and label, and right-side headline.',
        'a8782d19f968d1fd8866ad1f7881f8900455fc8e27f09de9da6dd22179d2ef47',
      ],
      [
        'I approve these visible-text transcriptions and approximate boxes for the product fixture: “blurry background”, “TONKA + OUD”, “candles, candles, candles co.”, “soy wax candle”, and “NET WT. 8 OZ”.',
        '1a88e03c49bf2a1df62fcb7e50e5428cdae4a8816cba4244cfe8d377687fdf1b',
      ],
      [
        'Person and text-heavy watermark regions are approved as unscored OCR uncertainty.',
        '4e6641a35c1d685e7e635373e845bf778b619dc7dad499e852d1e9799fddde80',
      ],
      [
        'Do not invent watermark transcription.',
        '94d5d6b54ae49853b2836c8959bcf74712c8a22abd82a9c3992d96536ad03ed0',
      ],
      [
        'Do not treat unresolved watermark content as exact oracle text.',
        'c6c558a392bd60120eed3216f1753422d09cf303ffd54e75a226c585373d6534',
      ],
    ] as const;
    expect(
      HUMAN_ORACLE_RAW_STATEMENT_RECORDS_V2.map((record) => [
        record.exactStatement,
        record.rawUtf8Sha256,
      ]),
    ).toEqual(expectedStatements);
    for (const [statement, digest] of expectedStatements) {
      expect(sha256Hex(Buffer.from(statement, 'utf8'))).toBe(digest);
    }

    const bundlePins = [
      '6cc1310bba312c4de3e53aab355ac6d27aa0ee2af3568cc85d932c28ad416ec7',
      'acbb0b965c283c5ad764950377ef6cdf81d4103c12f70c9644f8253ca5e864c3',
      'aeece0293dbcda867481d073ba0832e5c7fb93bd921f20d3e98f8b0fa4a1bd19',
      '0e458c0f9f858354417be3e7fc1f3062cdb8df1a606cde4a28bdfe9139b38685',
    ] as const;
    const oraclePins = [
      '2a1acd4e0c2efbaead58db83339877225fb2e2d0656a880be777f01c5187dafd',
      'bf9d42ed77e5aa3e8dedf3b593d65802bacdb38314b2df8e31632272d0e5e019',
      '80a2407ade80036bb82eb1c7cb486b418eb6c8b369668844a978caf4d88a9fa1',
      '14152119e3a999bba8f5ffe48aec6138c9f678ded6cd7071945b76b5792a8c38',
    ] as const;
    const approvalPins = [
      'f8d47386bb3458cd85d7caa35f08add3bf5c22e05591b21272b96063742b94e9',
      '0ef698a57ef4a34b9600ff6cdfe3d22a98d3270d90330d1756e1d2f274066525',
      '0dfc24d618f489463b48b3605e95ce2162441000995f1e00b2f4048b91e1567a',
      '7bdf74e65b6183876651e3fa1c347061c5f633b2cc6dfc9a19ce0b798b36f18d',
    ] as const;
    const entryPins = [
      '968502b7a2cfee47a06df955ee35ec1d0ba164e3400a47ba0168a1cc5ab78d8c',
      '35691f952c9ed92b0462127720c05f3755cecf3987c852bf20a6dd27fe16ffaf',
      '8d65fc7575e83666bfa406258c82a0c228457ec6859ba694c8601fed502b22f7',
      '5069ba7fab787bb0eac55259c0e3c1f9402b657e568440671a7eb1c6929fdf21',
    ] as const;

    for (const [index, bundle] of HUMAN_ORACLE_FIXTURE_STATEMENT_BUNDLES_V2.entries()) {
      const { statementBundleSha256, ...core } = bundle;
      expect(statementBundleSha256).toBe(bundlePins[index]);
      expect(digestHumanOracleFixtureStatementBundleV2(core)).toBe(bundlePins[index]);
    }
    for (const [index, oracle] of HUMAN_ORACLE_APPROVED_ORACLES_V2.entries()) {
      const { oracleSha256, ...core } = oracle;
      expect(oracleSha256).toBe(oraclePins[index]);
      expect(digestHumanOracleApprovedV2(core)).toBe(oraclePins[index]);
    }
    for (const [index, approval] of HUMAN_ORACLE_OWNER_APPROVAL_EVIDENCE_V2.entries()) {
      const { approvalEvidenceSha256, ...core } = approval;
      expect(approvalEvidenceSha256).toBe(approvalPins[index]);
      expect(digestLocalProjectOwnerHumanOracleApprovalEvidenceV2(core)).toBe(approvalPins[index]);
    }
    for (const [index, entry] of HUMAN_ORACLE_APPROVED_CORPUS_ENTRIES_V2.entries()) {
      const { entrySha256, ...core } = entry;
      expect(entrySha256).toBe(entryPins[index]);
      expect(digestHumanOracleApprovedCorpusEntryV2(core)).toBe(entryPins[index]);
    }
    const { corpusSha256, ...corpusCore } = REAL_MODEL_BENCHMARK_HUMAN_ORACLE_CORPUS_V2;
    expect(corpusSha256).toBe('aa499d5560a97a2bf7df84fd0240f39941a82f485f804a42a608d96cb9acba51');
    expect(digestHumanOracleApprovedCorpusV2(corpusCore)).toBe(corpusSha256);
  });

  it('binds the exact four source pairs, V2 core/cap, and frozen evaluation target', () => {
    expect(
      HUMAN_ORACLE_SOURCE_BINDINGS_V2.map((binding) => [
        binding.fixtureId,
        binding.original.sha256,
        binding.canonicalNormalized.sha256,
      ]),
    ).toEqual([
      [
        'banner-person-v1',
        'd9a5a64f4fb4353a11d2fac605049b8cf1565ee8a056cf792f0181d1798189d3',
        '6e3175cdd260fde33a3885945eb6f8831da3905afbc723f684035f411dc6d699',
      ],
      [
        'banner-product-v1',
        'ce1be4eacbd65763d1d2b2835f9ad49c50cd9b3f56edc4a6a289822965bf09c5',
        'a38db6f627ee275eabf7643c99a83aac5e1ac77bbfe1b1abcc24112c6a04e69a',
      ],
      [
        'banner-text-heavy-v1',
        '886afa4806fd252175d08a56eb5cae4989f3ac59c6a0c6e0a59f8a6d61195d77',
        '181e4c3762b79b5dfcbdb21c6c873ede8b32bf85dfe98fdecc13d59fb8cbcb62',
      ],
      [
        'banner-no-text-v1',
        'af4ee315a16887692aaec4e972615535a086a906b43257eb1c78aa50212d31c3',
        '40f8a1c4312ec86cb4e38e16b9a423e85c2a9e3cf5f98a4bc510c23f3d4cf073',
      ],
    ]);
    expect(REAL_MODEL_BENCHMARK_HUMAN_ORACLE_CORPUS_V2).toMatchObject({
      pendingCorpusCoreSha256: PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256,
      capRevisionSha256: FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256,
    });
    expect(HUMAN_ORACLE_REPOSITORY_BINDINGS_V2).toMatchObject({
      providerKey: 'openai',
      apiFamily: 'responses',
      endpoint: 'https://api.openai.com/v1/responses',
      endpointMethod: 'POST',
      requestedModelId: 'gpt-5.6-terra',
      profileId: 'banner-scene-analysis-ocr-first-call-v1',
      frozenV1RepositoryBindings: PENDING_REAL_MODEL_BENCHMARK_REPOSITORY_BINDINGS_V1,
      selectedProfile: OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1,
      proposedRequestContract: PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1,
      prompt: SCENE_ANALYSIS_PROMPT_V1,
      contentPolicyDefinition: BANNER_AI_MODEL_DISPATCH_CONTENT_POLICY_V1_DEFINITION,
      workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
    });
    expect(HUMAN_ORACLE_REPOSITORY_BINDINGS_V2.frozenV1RepositoryBindings).toMatchObject({
      responsesRequestShapeSha256:
        'e93de8b5d1c47db26476b8912bfdca402b2432a6719401cd29438c273dab7242',
      promptSha256: '5cc311b7b353e06c61bcdf840b40dff9d35de0aea12851ffa18a654177917227',
      contentPolicySha256: '14a27c163a4082a966971028e59b6d1d56ea9cde99038b823c0a18b1ea92d0c4',
      workflowDefinitionSha256: 'e3784eefd371b1bf343db9e2dfb97697f2fe5889c8374fe777316add8a59230c',
    });
  });

  it('rejects fixture, image, statement, timestamp, oracle, entry, and corpus substitutions after rehashing', () => {
    const fixtureSubstitution = mutableClone(BANNER_PERSON_HUMAN_ORACLE_V2);
    fixtureSubstitution.fixtureId = 'banner-product-v1' as never;
    const { oracleSha256: _fixtureDigest, ...fixtureCore } = fixtureSubstitution;
    void _fixtureDigest;
    fixtureSubstitution.oracleSha256 = canonicalDigest(fixtureCore) as never;
    expect(HumanOracleApprovedV2Schema.safeParse(fixtureSubstitution).success).toBe(false);

    const imageSubstitution = mutableClone(BANNER_PRODUCT_HUMAN_ORACLE_V2);
    imageSubstitution.sourceBinding.canonicalNormalized.sha256 = 'f'.repeat(64) as never;
    const { oracleSha256: _imageDigest, ...imageCore } = imageSubstitution;
    void _imageDigest;
    imageSubstitution.oracleSha256 = canonicalDigest(imageCore) as never;
    expect(HumanOracleApprovedV2Schema.safeParse(imageSubstitution).success).toBe(false);

    const statementSubstitution = mutableClone(HUMAN_ORACLE_FIXTURE_STATEMENT_BUNDLES_V2[0]!);
    statementSubstitution.statementsInDecisionOrder[0]!.exactStatement =
      'banner-person-v1: user-owned ' as never;
    statementSubstitution.statementsInDecisionOrder[0]!.rawUtf8Sha256 = sha256Hex(
      Buffer.from(statementSubstitution.statementsInDecisionOrder[0]!.exactStatement, 'utf8'),
    ) as never;
    const { statementBundleSha256: _statementDigest, ...statementCore } = statementSubstitution;
    void _statementDigest;
    statementSubstitution.statementBundleSha256 = canonicalDigest(statementCore) as never;
    expect(HumanOracleFixtureStatementBundleV2Schema.safeParse(statementSubstitution).success).toBe(
      false,
    );

    const staleApproval = mutableClone(HUMAN_ORACLE_OWNER_APPROVAL_EVIDENCE_V2[0]);
    staleApproval.approvalRecordedAt = '2026-07-14T13:51:14Z' as never;
    const { approvalEvidenceSha256: _staleDigest, ...staleCore } = staleApproval;
    void _staleDigest;
    staleApproval.approvalEvidenceSha256 = canonicalDigest(staleCore) as never;
    expect(
      LocalProjectOwnerHumanOracleApprovalEvidenceV2Schema.safeParse(staleApproval).success,
    ).toBe(false);

    const foreignOracleApproval = mutableClone(HUMAN_ORACLE_OWNER_APPROVAL_EVIDENCE_V2[1]);
    foreignOracleApproval.approvedOracleSha256 =
      BANNER_PERSON_HUMAN_ORACLE_V2.oracleSha256 as never;
    const { approvalEvidenceSha256: _foreignDigest, ...foreignCore } = foreignOracleApproval;
    void _foreignDigest;
    foreignOracleApproval.approvalEvidenceSha256 = canonicalDigest(foreignCore) as never;
    expect(
      LocalProjectOwnerHumanOracleApprovalEvidenceV2Schema.safeParse(foreignOracleApproval).success,
    ).toBe(false);

    const foreignEntry = mutableClone(HUMAN_ORACLE_APPROVED_CORPUS_ENTRIES_V2[2]);
    foreignEntry.ownerApprovalEvidence = mutableClone(
      HUMAN_ORACLE_OWNER_APPROVAL_EVIDENCE_V2[0],
    ) as never;
    const { entrySha256: _entryDigest, ...entryCore } = foreignEntry;
    void _entryDigest;
    foreignEntry.entrySha256 = canonicalDigest(entryCore) as never;
    expect(HumanOracleApprovedCorpusEntryV2Schema.safeParse(foreignEntry).success).toBe(false);

    const activatedCorpus = mutableClone(REAL_MODEL_BENCHMARK_HUMAN_ORACLE_CORPUS_V2);
    activatedCorpus.active = true as never;
    const { corpusSha256: _corpusDigest, ...corpusCore } = activatedCorpus;
    void _corpusDigest;
    activatedCorpus.corpusSha256 = canonicalDigest(corpusCore) as never;
    expect(HumanOracleApprovedCorpusV2Schema.safeParse(activatedCorpus).success).toBe(false);
  });

  it('records exact user-owned metadata, privacy, and rights decisions', () => {
    expect(HUMAN_ORACLE_RIGHTS_AND_PRIVACY_DECISIONS_V2).toEqual([
      expect.objectContaining({
        fixtureId: 'banner-person-v1',
        licenseClassification: 'user-owned',
        metadataAndPrivacyFindings: 'accepted-as-documented',
        rightsAndPrivacyAssertions: [
          'adult-likeness-and-model-use-rights-confirmed',
          'placeholder-url-rights-and-privacy-accepted',
          'logo-rights-confirmed',
          'visible-watermark-rights-confirmed',
        ],
      }),
      expect.objectContaining({
        fixtureId: 'banner-product-v1',
        licenseClassification: 'user-owned',
        rightsAndPrivacyAssertions: ['brand-and-label-rights-confirmed'],
      }),
      expect.objectContaining({
        fixtureId: 'banner-text-heavy-v1',
        licenseClassification: 'user-owned',
        rightsAndPrivacyAssertions: [
          'logo-and-brand-rights-confirmed',
          'visible-watermark-rights-confirmed',
        ],
      }),
      expect.objectContaining({
        fixtureId: 'banner-no-text-v1',
        licenseClassification: 'user-owned',
        acceptedOriginalMetadataFindings: ['jpeg-jfif-payload-only'],
        rightsAndPrivacyAssertions: [
          'jfif-only-metadata-accepted',
          'cyan-angular-forms-decorative-not-semantic-lettering-or-logo',
          'no-visible-semantic-text-confirmed',
          'empty-text-observation-set-approved',
        ],
      }),
    ]);
    expect(
      HUMAN_ORACLE_RIGHTS_AND_PRIVACY_DECISIONS_V2.every(
        (decision) =>
          decision.privateOrSensitiveInformation === 'confirmed-absent' &&
          decision.normalizedMetadataDisposition ===
            'accepted-canonical-normalization-stripped-container-ancillary-metadata',
      ),
    ).toBe(true);
    expect(HUMAN_ORACLE_APPROVAL_RECORDED_AT).toBe('2026-07-14T13:51:13Z');
    expect(
      HUMAN_ORACLE_OWNER_APPROVAL_EVIDENCE_V2.every(
        (evidence) =>
          evidence.reviewerRole === 'local-project-owner' &&
          evidence.approvalRecordedAtMeaning ===
            'utc-implementation-recording-time-not-user-account-or-message-time',
      ),
    ).toBe(true);
  });

  it('pins every approved layer and main-text occurrence, including corrected groupings', () => {
    const layerProjection = (oracle: (typeof HUMAN_ORACLE_APPROVED_ORACLES_V2)[number]) =>
      oracle.requiredLayers.map((layer) => [layer.approvedLabel, layer.role, layer.boundingBox]);
    expect(layerProjection(BANNER_PERSON_HUMAN_ORACLE_V2)).toEqual([
      ['geometric red/orange/cream background', 'background', box(0, 0, 10_000, 10_000)],
      ['left headline/body-copy block', 'text', box(300, 700, 3_100, 8_700)],
      ['Learn More button and website line', 'foreground', box(3_900, 5_900, 1_900, 3_200)],
      ['recognizable adult in business attire', 'subject', box(6_400, 0, 2_200, 10_000)],
      ['Your Logo placeholder mark', 'decoration', box(8_850, 7_650, 1_050, 1_950)],
    ]);
    expect(layerProjection(BANNER_PRODUCT_HUMAN_ORACLE_V2)).toEqual([
      [
        'photographic background including blurred plants and patterned panel',
        'background',
        box(0, 0, 10_000, 10_000),
      ],
      ['foreground candle jar and label', 'subject', box(3_000, 3_900, 2_200, 5_900)],
      ['right-side headline', 'text', box(6_100, 2_200, 3_000, 1_400)],
    ]);
    expect(BANNER_PRODUCT_HUMAN_ORACLE_V2.requiredLayers).toHaveLength(3);
    expect(
      BANNER_PRODUCT_HUMAN_ORACLE_V2.requiredLayers.some((layer) =>
        layer.oracleLayerId.includes('plants'),
      ),
    ).toBe(false);
    expect(layerProjection(BANNER_TEXT_HEAVY_HUMAN_ORACLE_V2)).toEqual([
      ['neutral product-mockup background/floor', 'background', box(0, 0, 10_000, 10_000)],
      ['retractable banner stand hardware', 'subject', box(1_900, 300, 6_100, 9_600)],
      ['brand mark, header art, and title', 'text', box(2_150, 800, 5_650, 3_400)],
      ['numbered banner-option list', 'text', box(2_200, 4_300, 5_550, 4_500)],
      ['lower accent and stand base', 'foreground', box(2_000, 8_250, 5_900, 1_700)],
    ]);
    expect(layerProjection(BANNER_NO_TEXT_HUMAN_ORACLE_V2)).toEqual([
      [
        'background composite including peach field, cream panel, shadow, and frame',
        'background',
        box(0, 0, 10_000, 10_000),
      ],
      ['grouped cyan decorations', 'decoration', box(400, 1_650, 9_150, 6_700)],
      ['grouped coral sunbursts', 'decoration', box(250, 1_350, 9_300, 7_250)],
    ]);
    expect(BANNER_NO_TEXT_HUMAN_ORACLE_V2.requiredLayers).toHaveLength(3);

    const textProjection = (oracle: (typeof HUMAN_ORACLE_APPROVED_ORACLES_V2)[number]) =>
      oracle.expectedTextOccurrences.map((occurrence) => [
        occurrence.approvedTranscription,
        occurrence.boundingBox,
      ]);
    expect(textProjection(BANNER_PERSON_HUMAN_ORACLE_V2)).toEqual([
      ['BUILD', box(400, 900, 1_200, 1_350)],
      ['YOUR', box(400, 2_450, 1_250, 1_250)],
      ['BUSINESS', box(400, 4_100, 1_950, 1_600)],
      [
        'Lorem ipsum dolor sit\namet, consectetur adipiscing\nelit sed non risus.',
        box(400, 6_950, 2_600, 2_400),
      ],
      ['Learn More', box(4_150, 6_250, 1_150, 950)],
      ['www.yourwebsite.com', box(3_900, 8_250, 1_800, 750)],
      ['YOUR\nLOGO', box(8_950, 7_950, 850, 1_500)],
    ]);
    expect(textProjection(BANNER_PRODUCT_HUMAN_ORACLE_V2)).toEqual([
      ['blurry background', box(6_150, 2_550, 2_750, 650)],
      ['TONKA + OUD', box(3_500, 6_650, 1_100, 500)],
      ['candles, candles, candles co.', box(3_500, 7_150, 1_100, 300)],
      ['soy wax candle', box(4_050, 8_100, 600, 300)],
      ['NET WT. 8 OZ', box(4_050, 8_500, 600, 300)],
    ]);
    expect(textProjection(BANNER_TEXT_HEAVY_HUMAN_ORACLE_V2)).toEqual([
      ['HALF PRICE\nBANNERS', box(5_600, 850, 1_450, 950)],
      ['BANNER\nOPTIONS', box(2_650, 2_000, 4_500, 1_250)],
      ['1', box(2_600, 4_650, 500, 450)],
      ['Large Format Double-\nSided Banners', box(3_450, 4_600, 4_200, 700)],
      ['2', box(2_600, 5_600, 500, 450)],
      ['Large Format Vinyl\nBanners', box(3_450, 5_550, 4_200, 700)],
      ['3', box(2_600, 6_550, 500, 450)],
      ['Large Format Double-\nSided Fence Banners', box(3_450, 6_500, 4_300, 750)],
      ['4', box(2_600, 7_500, 500, 450)],
      ['Large Format Mesh\nBanners', box(3_450, 7_450, 4_200, 700)],
    ]);
    expect(BANNER_NO_TEXT_HUMAN_ORACLE_V2.expectedTextOccurrences).toEqual([]);
    expect(
      HUMAN_ORACLE_APPROVED_ORACLES_V2.map((oracle) => oracle.expectedTextOccurrences.length),
    ).toEqual([7, 5, 10, 0]);
  });

  it('keeps every Codex draft unchanged and structurally separate in both directions', () => {
    for (const entry of REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2.entries.slice(0, 3)) {
      expect(entry.draftReview).toMatchObject({
        evidenceRole: 'codex-draft-unapproved',
        reviewStatus: 'draft-unapproved',
        humanApprovalAuthority: false,
      });
      const flipped = mutableClone(entry.draftReview);
      flipped.reviewStatus = 'human-approved' as never;
      flipped.humanApprovalAuthority = true as never;
      expect(HumanOracleApprovedV2Schema.safeParse(flipped).success).toBe(false);
      expect(LocalProjectOwnerHumanOracleApprovalEvidenceV2Schema.safeParse(flipped).success).toBe(
        false,
      );
    }
    const noTextDraft = REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2.entries[3].draftReview;
    expect(noTextDraft).toMatchObject({
      evidenceRole: 'codex-draft-unapproved',
      reviewStatus: 'draft-unapproved',
      humanApprovalAuthority: false,
      draftTextObservationSet: { observations: [] },
    });
    const flippedNoText = mutableClone(noTextDraft);
    flippedNoText.reviewStatus = 'human-approved' as never;
    flippedNoText.humanApprovalAuthority = true as never;
    expect(HumanOracleApprovedV2Schema.safeParse(flippedNoText).success).toBe(false);
    expect(
      LocalProjectOwnerHumanOracleApprovalEvidenceV2Schema.safeParse(flippedNoText).success,
    ).toBe(false);

    for (const oracle of HUMAN_ORACLE_APPROVED_ORACLES_V2) {
      expect(CodexDraftUnapprovedBannerReviewV1Schema.safeParse(oracle).success).toBe(false);
      expect(CodexDraftUnapprovedZeroTextReviewV2Schema.safeParse(oracle).success).toBe(false);
    }
    for (const approval of HUMAN_ORACLE_OWNER_APPROVAL_EVIDENCE_V2) {
      expect(CodexDraftUnapprovedBannerReviewV1Schema.safeParse(approval).success).toBe(false);
      expect(CodexDraftUnapprovedZeroTextReviewV2Schema.safeParse(approval).success).toBe(false);
    }
  });
});

describe('human-oracle OCR quality asymmetry', () => {
  it('requires exact source and oracle digests before scoring', () => {
    const oracle = BANNER_PRODUCT_HUMAN_ORACLE_V2;
    const actualObservations = actualFromOracle(oracle, 'actual_product');
    expect(() =>
      evaluateRealModelBenchmarkHumanOracleOcrQualityV2({
        fixtureId: oracle.fixtureId,
        normalizedSourceSha256: 'f'.repeat(64),
        oracleSha256: oracle.oracleSha256,
        actualObservations,
      }),
    ).toThrow(/source or oracle digest/i);
    expect(
      HumanOracleOcrQualityInputV2Schema.safeParse({
        fixtureId: oracle.fixtureId,
        normalizedSourceSha256: oracle.sourceBinding.canonicalNormalized.sha256,
        oracleSha256: BANNER_PERSON_HUMAN_ORACLE_V2.oracleSha256,
        actualObservations,
      }).success,
    ).toBe(false);
  });

  it('retains person and text-heavy extras while prohibiting a full exact claim', () => {
    for (const [oracle, prefix, extraText] of [
      [BANNER_PERSON_HUMAN_ORACLE_V2, 'actual_person', 'unresolved watermark candidate'],
      [BANNER_TEXT_HEAVY_HUMAN_ORACLE_V2, 'actual_text_heavy', 'another watermark candidate'],
    ] as const) {
      const extras = actualObservation(`${prefix}_extra`, extraText, box(100, 100, 500, 500));
      const actual = [...actualFromOracle(oracle, prefix), extras];
      const result = score(oracle, actual);
      expect(result).toMatchObject({
        actualObservationCount: actual.length,
        matchedMainTextObservationCount: oracle.expectedTextOccurrences.length,
        bboxMatchedMainTextObservationCount: oracle.expectedTextOccurrences.length,
        extraObservationCount: 1,
        mainTextRecallPass: true,
        mainTextBoundingBoxesPass: true,
        approvedMainTextPass: true,
        precisionStatus: 'unavailable-unscored',
        precisionPass: null,
        semanticFalsePositiveCount: null,
        fullExactOcrEligible: false,
        fullExactOcrPass: false,
        exactOcrClaimStatus: 'prohibited-unresolved-watermark-even-when-approved-main-text-perfect',
      });
      expect(result.actualObservations).toHaveLength(actual.length);
      expect(result.extraObservations).toEqual([extras]);
      expect(Object.isFrozen(result.actualObservations)).toBe(true);
      expect(Object.isFrozen(result.extraObservations)).toBe(true);
    }
  });

  it('fully scores product and makes any no-text observation an explicit false positive', () => {
    const productActual = actualFromOracle(BANNER_PRODUCT_HUMAN_ORACLE_V2, 'actual_product');
    expect(score(BANNER_PRODUCT_HUMAN_ORACLE_V2, productActual)).toMatchObject({
      precisionStatus: 'available-scored',
      precisionPass: true,
      semanticFalsePositiveCount: 0,
      mainTextRecallPass: true,
      mainTextBoundingBoxesPass: true,
      fullExactOcrEligible: true,
      fullExactOcrPass: true,
    });

    expect(score(BANNER_NO_TEXT_HUMAN_ORACLE_V2, [])).toMatchObject({
      expectedMainTextOccurrenceCount: 0,
      actualObservationCount: 0,
      precisionPass: true,
      semanticFalsePositiveCount: 0,
      mainTextRecallPass: true,
      mainTextBoundingBoxesPass: true,
      fullExactOcrEligible: true,
      fullExactOcrPass: true,
    });
    const falsePositive = actualObservation(
      'actual_no_text_false_positive',
      'semantic false positive',
      box(200, 200, 900, 400),
    );
    expect(score(BANNER_NO_TEXT_HUMAN_ORACLE_V2, [falsePositive])).toMatchObject({
      actualObservationCount: 1,
      extraObservationCount: 1,
      extraObservations: [falsePositive],
      precisionPass: false,
      semanticFalsePositiveCount: 1,
      fullExactOcrEligible: true,
      fullExactOcrPass: false,
    });
  });
});

describe('human-oracle inert isolation', () => {
  it('is approval-complete evidence but rejected by every existing execution path', () => {
    const corpus = REAL_MODEL_BENCHMARK_HUMAN_ORACLE_CORPUS_V2;
    expect(corpus).toMatchObject({
      status: 'human-oracle-approved',
      humanOracleApproved: true,
      corpusAdmissionReady: true,
      active: false,
      dispatchable: false,
      admissionAuthority: false,
      requestPlanAuthority: false,
      providerCallAuthority: false,
      dispatchAuthority: false,
      productionExecutionRegistry: 'empty-unchanged',
      productionSourceRegistry: 'empty-unchanged',
      providerTransport: 'absent',
      webRouteAccess: 'none',
      imageTransmission: 'not-performed',
      committedExecutionAuthorization: 'absent',
      manualRelease: 'absent',
    });
    expect(corpus.entries).toHaveLength(4);
    expect(
      HUMAN_ORACLE_OWNER_APPROVAL_EVIDENCE_V2.every(
        (approval) => approval.imageTransmission === 'not-performed',
      ),
    ).toBe(true);
    expect(() => admitRealModelBenchmarkCorpusV1(corpus)).toThrow();
    expect(SelectedRealModelBenchmarkProfileV1Schema.safeParse(corpus).success).toBe(false);
    expect(RealModelBenchmarkExecutionLedgerV1Schema.safeParse(corpus).success).toBe(false);
    expect(() =>
      buildNonDispatchingOpenAiRequestPlanV1({
        profile: OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1,
        corpusCapability: corpus as never,
        request: {},
        fixtureId: 'banner-person-v1',
        manualControl: {},
        executionPreparation: {
          providerCallIdentity: {},
          providerRequestSha256: '',
          callTarget: {},
          ordinals: {},
          ledger: {},
          estimatedCostMicros: '0',
          attemptedProviderCallTimeoutMs: 0,
        },
      }),
    ).toThrow(/capability.*absent|cloned|forged/i);
    expect(REAL_MODEL_BENCHMARK_STATIC_CORPUS_SOURCE_REGISTRY_V1).toEqual([]);
  });

  it('adds no package-root, server, web, SDK, network, environment, or application access', () => {
    for (const symbol of [
      'REAL_MODEL_BENCHMARK_HUMAN_ORACLE_CORPUS_V2',
      'HumanOracleApprovedV2Schema',
      'evaluateRealModelBenchmarkHumanOracleOcrQualityV2',
      'HumanOracleOcrQualityInputV2Schema',
    ]) {
      expect(publicBannerAi).not.toHaveProperty(symbol);
    }

    const packageRoot = fileURLToPath(new URL('..', import.meta.url));
    const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
    const collectTypeScript = (directory: string): readonly string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return collectTypeScript(path);
        return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
      });
    for (const path of [
      ...collectTypeScript(join(packageRoot, 'src/server')),
      ...collectTypeScript(join(repositoryRoot, 'apps/web/src')),
    ]) {
      expect(readFileSync(path, 'utf8'), path).not.toContain('real-model-benchmark-human-oracle');
    }

    const newSource = [
      join(packageRoot, 'src/evaluation/real-model-benchmark-human-oracle.ts'),
      join(packageRoot, 'src/evaluation/real-model-benchmark-human-oracle-quality.ts'),
    ]
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(newSource).not.toMatch(
      /from\s+['"](?:openai|@anthropic-ai|@google|replicate|undici)(?:\/[^'"]*)?['"]|\bnew\s+OpenAI\b|\.responses\.create\s*\(/u,
    );
    expect(newSource).not.toMatch(
      /from\s+['"](?:node:)?(?:http|https|http2|net|dns|dgram|tls)(?:\/[^'"]*)?['"]|\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/u,
    );
    expect(newSource).not.toMatch(
      /\b(?:process\.env|Deno\.env|Bun\.env|import\.meta\.env)\b|OPENAI_API_KEY/u,
    );
    expect(newSource).not.toMatch(
      /from\s+['"][^'"]*(?:prisma|drizzle|database|db-client|auth-client|billing|stripe|react|next\/)[^'"]*['"]|\b(?:prisma|database|billing|authClient)\s*\./u,
    );
  });
});
