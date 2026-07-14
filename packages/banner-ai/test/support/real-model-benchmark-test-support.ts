import sharp from 'sharp';
import type { z } from 'zod';

import {
  AdmittedRealModelBenchmarkCorpusEntryV1Schema,
  INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
  OPENAI_BENCHMARK_PRICING_EVIDENCE_V1,
  OPENAI_REAL_MODEL_BENCHMARK_CANDIDATE_V1,
  OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1,
  OPENAI_REAL_MODEL_ENDPOINT_POLICY_V1,
  OPENAI_REAL_MODEL_REQUESTED_MODEL_ID,
  OPENAI_REAL_MODEL_SECRET_REFERENCE_NAME,
  OpenAiAuthorizedObservedIdentityEvidenceV1Schema,
  OpenAiWorstCaseRequestCostProofV1Schema,
  PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1,
  RealModelBenchmarkAuthorizationV1Schema,
  SelectedRealModelBenchmarkCandidateV1Schema,
  SelectedRealModelBenchmarkProfileV1Schema,
  ZERO_RETRY_REAL_MODEL_BENCHMARK_POLICY_V1,
  admitRealModelBenchmarkCorpusV1,
  byteSourceFrom,
  createSceneAnalysisModelRequestV1,
  deriveRealModelBenchmarkLogicalCallKeyV1,
  digestAdmittedRealModelBenchmarkCorpusV1,
  digestOpenAiAuthorizedObservedIdentityEvidenceV1,
  digestOpenAiWorstCaseRequestCostProofV1,
  digestRealModelBenchmarkAuthorizationPayloadV1,
  digestRealModelBenchmarkAuthorizationV1,
  digestRealModelBenchmarkEvidenceAssertionV1,
  digestRealModelBenchmarkFixtureEvidenceBindingV1,
  digestRepositoryFixtureInputRefV1,
  digestSelectedRealModelBenchmarkProfileV1,
  digestValidatedCapabilityRequest,
  normalizeRasterUpload,
  renderRealModelBenchmarkAuthorizationStatementV1,
  sha256Hex,
  type RealModelBenchmarkAuthorizationV1,
  type SelectedRealModelBenchmarkProfileV1,
} from '../../src/index.js';

export type Mutable<T> = T extends readonly (infer Entry)[]
  ? Mutable<Entry>[]
  : T extends Uint8Array
    ? Uint8Array
    : T extends object
      ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
      : T;

export const mutableClone = <T>(input: T): Mutable<T> => structuredClone(input) as Mutable<T>;

type AdmittedEntryInput = Mutable<z.input<typeof AdmittedRealModelBenchmarkCorpusEntryV1Schema>>;

export const TEST_AUTHORIZATION_ID = 'test-only.authorization.openai.invalid' as const;
export const TEST_AUTHORIZATION_REVISION = 7 as const;
export const TEST_AUTHORIZATION_ISSUED_AT = '2026-01-01T00:00:00.000Z' as const;
export const TEST_AUTHORIZATION_EXPIRES_AT = '2099-12-31T23:59:59.999Z' as const;
export const TEST_AUTHORIZATION_REVISION_EVIDENCE_SHA256 = 'd'.repeat(64);

export const confirmedAuthorizationReviews = {
  licenseAndThirdPartyRights: 'confirmed',
  currentOfficialModelAvailabilityAndApiFieldSemantics: 'confirmed',
  observedProviderModelVersionAndFingerprintEvidence: 'confirmed',
  datedPricingAssertionReconfirmed: 'confirmed',
  providerModelEndpointRequestShapeWorstCaseProof: 'confirmed',
  providerTrainingUse: 'confirmed',
  providerRetentionAndDeletion: 'confirmed',
  humanReviewSubprocessorsAndAbuseMonitoring: 'confirmed',
  processingRegionCrossBorderDpaAndLegalBasis: 'confirmed',
  corpusHumanTransmissionApprovals: 'confirmed',
} as const;

export const selectedCandidate = () =>
  SelectedRealModelBenchmarkCandidateV1Schema.parse(OPENAI_REAL_MODEL_BENCHMARK_CANDIDATE_V1);

export const selectedProfile = (): SelectedRealModelBenchmarkProfileV1 =>
  SelectedRealModelBenchmarkProfileV1Schema.parse(OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1);

type SyntheticSource = {
  readonly filename: string;
  readonly declaredContentType: 'image/png';
  readonly originalBytes: Uint8Array;
  readonly originalIngress: {
    readonly filename: string;
    readonly declaredContentType: 'image/png';
    readonly sha256: string;
    readonly byteSize: number;
    readonly pixelWidth: number;
    readonly pixelHeight: number;
  };
  readonly normalizedTransmission: {
    readonly contentType: 'image/png';
    readonly sha256: string;
    readonly byteSize: number;
    readonly pixelWidth: number;
    readonly pixelHeight: number;
  };
  readonly callSource: {
    readonly contentType: 'image/png';
    readonly sha256: string;
    readonly byteSize: number;
    readonly pixelWidth: number;
    readonly pixelHeight: number;
    readonly bytes: Uint8Array;
  };
};

const createSyntheticInvalidSource = async (ordinal: number): Promise<SyntheticSource> => {
  const ingress = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: { r: ordinal * 30, g: 40, b: 50, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const filename = `synthetic-test-only-${ordinal}.invalid.png`;
  const normalized = await normalizeRasterUpload({
    bytes: byteSourceFrom(ingress),
    declaredMediaType: 'image/png',
    filename,
  });
  const metadata = {
    contentType: 'image/png' as const,
    sha256: normalized.sha256,
    byteSize: normalized.byteSize,
    pixelWidth: normalized.width,
    pixelHeight: normalized.height,
  };
  return {
    filename,
    declaredContentType: 'image/png',
    originalBytes: Uint8Array.from(ingress),
    originalIngress: {
      filename,
      declaredContentType: 'image/png',
      sha256: sha256Hex(ingress),
      byteSize: ingress.byteLength,
      pixelWidth: normalized.sourceWidth,
      pixelHeight: normalized.sourceHeight,
    },
    normalizedTransmission: metadata,
    callSource: { ...metadata, bytes: Uint8Array.from(normalized.bytes) },
  };
};

let syntheticTestOnlySources: readonly SyntheticSource[] | undefined;

const detachSyntheticSource = (source: SyntheticSource): SyntheticSource => ({
  filename: source.filename,
  declaredContentType: source.declaredContentType,
  originalBytes: Uint8Array.from(source.originalBytes),
  originalIngress: { ...source.originalIngress },
  normalizedTransmission: { ...source.normalizedTransmission },
  callSource: {
    ...source.callSource,
    bytes: Uint8Array.from(source.callSource.bytes),
  },
});

export const prepareSyntheticBenchmarkTestSources = async (): Promise<void> => {
  syntheticTestOnlySources ??= await Promise.all([1, 2, 3].map(createSyntheticInvalidSource));
};

export const getSyntheticBenchmarkTestSources = (): readonly SyntheticSource[] => {
  if (syntheticTestOnlySources === undefined) {
    throw new TypeError('Synthetic test-only benchmark sources were not prepared.');
  }
  return syntheticTestOnlySources.map(detachSyntheticSource);
};

const oracleTextOccurrence = (ordinal: number) => ({
  oracleOccurrenceId: `oracle.text.${ordinal}.invalid`,
  normalizedText: ordinal % 2 === 0 ? 'Duplicate synthetic text' : 'Synthetic text',
  boundingBox: {
    unit: 'normalized-basis-points' as const,
    xBps: ordinal * 500,
    yBps: ordinal * 400,
    widthBps: 2_000,
    heightBps: 800,
  },
});

const requestFixtureBindingFor = (ordinal: number) => ({
  referenceVersion: 1 as const,
  kind: 'repository-fixture' as const,
  repositoryPath: `packages/banner-ai/test/synthetic.test-only-fixture-${ordinal}.invalid.ts`,
  exportName: `createSyntheticTestOnlyInvalidFixture${ordinal}`,
  variant: 'png' as const,
  normalization: 'canonical-raster-upload-v1' as const,
});

export const admittedEntryInput = (
  ordinal: number,
  scenario: 'mixed-subject-copy' | 'text-heavy' | 'no-text-layered',
): AdmittedEntryInput => {
  const source = getSyntheticBenchmarkTestSources()[ordinal - 1];
  if (source === undefined) throw new TypeError('Synthetic test-only source was not prepared.');
  const originalIngress = { ...source.originalIngress };
  const normalizedTransmission = { ...source.normalizedTransmission };
  const observationCount =
    scenario === 'mixed-subject-copy' ? 2 : scenario === 'text-heavy' ? 3 : 0;
  const fixtureId = `synthetic.test-only.fixture.${ordinal}.invalid`;
  const requestFixtureBinding = requestFixtureBindingFor(ordinal);
  const ownerLicense = {
    status: 'user-owned' as const,
    thirdPartyProviderEvaluationRights: 'confirmed' as const,
    evidenceReference: `test-only.license.${ordinal}.invalid`,
    evidenceSha256: String(ordinal).repeat(64),
  };
  const providerTransmissionApproval = {
    approvalVersion: 1 as const,
    status: 'explicit-human-approval-recorded' as const,
    normalizedSourceSha256: normalizedTransmission.sha256,
    providerKey: 'openai' as const,
    requestedModelId: OPENAI_REAL_MODEL_REQUESTED_MODEL_ID,
    endpoint: 'https://api.openai.com/v1/responses' as const,
    endpointMethod: 'POST' as const,
    profileId: 'banner-scene-analysis-ocr-first-call-v1' as const,
    purpose: 'sanitized-third-party-provider-evaluation-only' as const,
    authorizationId: TEST_AUTHORIZATION_ID,
    authorizationRevision: TEST_AUTHORIZATION_REVISION,
    authorizationRevisionEvidenceSha256: TEST_AUTHORIZATION_REVISION_EVIDENCE_SHA256,
    authorizationIssuedAt: TEST_AUTHORIZATION_ISSUED_AT,
    authorizationExpiresAt: TEST_AUTHORIZATION_EXPIRES_AT,
    reviewedAt: TEST_AUTHORIZATION_ISSUED_AT,
    expiresAt: TEST_AUTHORIZATION_EXPIRES_AT,
    approvalEvidenceSha256: ['a', 'b', 'c'][ordinal - 1]!.repeat(64),
  };
  const admissionReview = {
    reviewVersion: 1 as const,
    reviewStatus: 'human-approved' as const,
    reviewedAt: TEST_AUTHORIZATION_ISSUED_AT,
    expiresAt: TEST_AUTHORIZATION_EXPIRES_AT,
    visualPixelsReviewed: true as const,
    metadataReviewed: true as const,
    secrets: 'confirmed-absent' as const,
    personalData: 'confirmed-absent' as const,
    credentials: 'confirmed-absent' as const,
    privateClientWork: 'confirmed-absent' as const,
    embeddedTrackingUrls: 'confirmed-absent' as const,
    visibleTrackingUrls: 'confirmed-absent' as const,
    reviewEvidenceSha256: String(ordinal + 3).repeat(64),
    providerTransmissionApproval,
  };
  const expectedOracle = {
    oracleVersion: 1 as const,
    evidenceRole: 'human-expected-oracle' as const,
    evidenceSha256: String(ordinal + 6).repeat(64),
    evidenceReference: `oracle.evidence.${ordinal}.invalid`,
    reviewStatus: 'human-approved' as const,
    reviewedAt: TEST_AUTHORIZATION_ISSUED_AT,
    expiresAt: TEST_AUTHORIZATION_EXPIRES_AT,
    requiredLayers: [1, 2, 3].map((layer) => ({
      oracleLayerId: `oracle.layer.${ordinal}.${layer}`,
      role:
        layer === 1
          ? ('background' as const)
          : layer === 2
            ? ('subject' as const)
            : scenario === 'no-text-layered'
              ? ('decoration' as const)
              : ('text' as const),
      required: true as const,
    })),
    expectedTextOccurrences: Array.from({ length: observationCount }, (_, index) =>
      oracleTextOccurrence(index + 1),
    ),
  };
  const evidenceCore = {
    bindingVersion: 1 as const,
    fixtureId,
    requestFixtureBindingSha256: digestRepositoryFixtureInputRefV1(requestFixtureBinding),
    originalSourceSha256: originalIngress.sha256,
    normalizedSourceSha256: normalizedTransmission.sha256,
    licenseEvidenceSha256: digestRealModelBenchmarkEvidenceAssertionV1(ownerLicense),
    privacyReviewEvidenceSha256: digestRealModelBenchmarkEvidenceAssertionV1(admissionReview),
    oracleEvidenceSha256: digestRealModelBenchmarkEvidenceAssertionV1(expectedOracle),
    transmissionApprovalEvidenceSha256: digestRealModelBenchmarkEvidenceAssertionV1(
      providerTransmissionApproval,
    ),
  };
  return {
    entryVersion: 2 as const,
    fixtureId,
    scenario,
    requestFixtureBinding,
    originalIngress,
    normalizedTransmission,
    ownerLicense,
    admissionReview,
    expectedOracle,
    evidenceBinding: {
      ...evidenceCore,
      bindingSha256: digestRealModelBenchmarkFixtureEvidenceBindingV1(evidenceCore),
    },
  };
};

export const recomputeAdmittedEntryEvidenceBinding = (
  entry: AdmittedEntryInput,
): AdmittedEntryInput => {
  const evidenceCore = {
    bindingVersion: 1 as const,
    fixtureId: entry.fixtureId,
    requestFixtureBindingSha256: digestRepositoryFixtureInputRefV1(entry.requestFixtureBinding),
    originalSourceSha256: entry.originalIngress.sha256,
    normalizedSourceSha256: entry.normalizedTransmission.sha256,
    licenseEvidenceSha256: digestRealModelBenchmarkEvidenceAssertionV1(entry.ownerLicense),
    privacyReviewEvidenceSha256: digestRealModelBenchmarkEvidenceAssertionV1(entry.admissionReview),
    oracleEvidenceSha256: digestRealModelBenchmarkEvidenceAssertionV1(entry.expectedOracle),
    transmissionApprovalEvidenceSha256: digestRealModelBenchmarkEvidenceAssertionV1(
      entry.admissionReview.providerTransmissionApproval,
    ),
  };
  return {
    ...entry,
    evidenceBinding: {
      ...evidenceCore,
      bindingSha256: digestRealModelBenchmarkFixtureEvidenceBindingV1(evidenceCore),
    },
  };
};

export const admittedManifestInput = () => ({
  manifestVersion: 2 as const,
  profileId: 'banner-scene-analysis-ocr-first-call-v1' as const,
  status: 'admitted' as const,
  corpusPurpose: 'sanitized-third-party-provider-evaluation-only' as const,
  entries: [
    admittedEntryInput(1, 'mixed-subject-copy'),
    admittedEntryInput(2, 'text-heavy'),
    admittedEntryInput(3, 'no-text-layered'),
  ],
});

export const admittedManifest = () => admitRealModelBenchmarkCorpusV1(admittedManifestInput());

export const requestFor = (
  profile: SelectedRealModelBenchmarkProfileV1,
  entry: unknown = admittedManifest().entries[0]!,
  runOrdinal: 1 | 2 = 1,
) => {
  const admittedEntry = AdmittedRealModelBenchmarkCorpusEntryV1Schema.parse(entry);
  return createSceneAnalysisModelRequestV1({
    requestId: `${admittedEntry.fixtureId}.run.${runOrdinal}.request.invalid`,
    modelInput: {
      inputVersion: 1,
      fixture: admittedEntry.requestFixtureBinding,
      sourceAsset: {
        assetId: `asset_${admittedEntry.fixtureId.replaceAll('.', '_')}`,
        assetVersionId: `version_${admittedEntry.fixtureId.replaceAll('.', '_')}`,
        sha256: admittedEntry.normalizedTransmission.sha256,
        mediaType: admittedEntry.normalizedTransmission.contentType,
        byteSize: admittedEntry.normalizedTransmission.byteSize,
        pixelWidth: admittedEntry.normalizedTransmission.pixelWidth,
        pixelHeight: admittedEntry.normalizedTransmission.pixelHeight,
      },
      model: profile.candidateSelection.model,
      prompt: profile.prompt,
      options: profile.requestOptions,
      workflow: profile.workflow,
    },
  });
};

const evidencedRetryPolicy = {
  mode: 'one-timeout-replay-with-exact-provider-evidence' as const,
  maximumRetryCount: 1 as const,
  providerKey: 'openai' as const,
  requestedModelId: OPENAI_REAL_MODEL_REQUESTED_MODEL_ID,
  endpoint: OPENAI_REAL_MODEL_ENDPOINT_POLICY_V1,
  evidenceCapturedAt: TEST_AUTHORIZATION_ISSUED_AT,
  evidenceExpiresAt: TEST_AUTHORIZATION_EXPIRES_AT,
  evidenceSha256: 'e'.repeat(64),
  executionAndBillingAssertion:
    'at-most-once-provider-execution-and-billing-for-one-logical-run-after-indeterminate-timeout' as const,
  mechanism: {
    kind: 'https-header' as const,
    exactHeaderName: 'Test-Only-Idempotency-Key',
    valueEncoding: 'lowercase-sha256-hex-logical-call-key-v1' as const,
    retryBehavior: 'initial-and-timeout-retry-send-the-identical-key' as const,
  },
  userConfirmation:
    'confirmed-current-provider-model-endpoint-specific-idempotency-replay-and-billing-contract' as const,
};

const authorizedObservedIdentityEvidence = () => {
  const core = {
    identityEvidenceVersion: 1 as const,
    providerKey: 'openai' as const,
    requestedModelId: OPENAI_REAL_MODEL_REQUESTED_MODEL_ID,
    observedProviderModelVersion: 'test-only-observed-version.invalid',
    observedProviderFingerprint: 'test-only-observed-fingerprint.invalid',
    officialEvidenceCapturedAt: TEST_AUTHORIZATION_ISSUED_AT,
    officialEvidenceExpiresAt: TEST_AUTHORIZATION_EXPIRES_AT,
    modelAvailabilityEvidenceSha256: '1'.repeat(64),
    responsesApiFieldSemanticsEvidenceSha256: '2'.repeat(64),
    endpointEvidenceSha256: '3'.repeat(64),
  };
  return OpenAiAuthorizedObservedIdentityEvidenceV1Schema.parse({
    ...core,
    observedIdentityEvidenceSha256: digestOpenAiAuthorizedObservedIdentityEvidenceV1(core),
  });
};

const worstCaseRequestCostProof = () => {
  const core = {
    proofVersion: 1 as const,
    status: 'complete-provider-model-endpoint-request-shape-specific-proof' as const,
    providerKey: 'openai' as const,
    requestedModelId: OPENAI_REAL_MODEL_REQUESTED_MODEL_ID,
    endpoint: OPENAI_REAL_MODEL_ENDPOINT_POLICY_V1,
    requestShapeSha256: PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1.requestShapeSha256,
    pricingEvidenceSha256: OPENAI_BENCHMARK_PRICING_EVIDENCE_V1.evidenceSha256,
    exactMaxOutputTokens: 4_096 as const,
    originalDetailImageTokenFormulaEvidenceSha256: '4'.repeat(64),
    promptSchemaAndInputTokenEvidenceSha256: '5'.repeat(64),
    hiddenReasoningAndBilledOutputEvidenceSha256: '6'.repeat(64),
    roundingAndOtherBilledUnitsEvidenceSha256: '7'.repeat(64),
    exactWorstCaseCostMicros: '100000',
    perCallCeilingMicros: '100000' as const,
    capturedAt: TEST_AUTHORIZATION_ISSUED_AT,
    expiresAt: TEST_AUTHORIZATION_EXPIRES_AT,
    userConfirmation: 'confirmed-worst-case-request-cost-does-not-exceed-100000-micro-usd' as const,
  };
  return OpenAiWorstCaseRequestCostProofV1Schema.parse({
    ...core,
    proofSha256: digestOpenAiWorstCaseRequestCostProofV1(core),
  });
};

export const authorizationFor = (
  profile: SelectedRealModelBenchmarkProfileV1,
  manifest = admittedManifest(),
  options: { readonly retryMode?: 'zero' | 'evidenced-replay' } = {},
): RealModelBenchmarkAuthorizationV1 => {
  const authorizedRunBindings = manifest.entries.flatMap((entry) =>
    ([1, 2] as const).map((runOrdinal) => {
      const request = requestFor(profile, entry, runOrdinal);
      return {
        bindingVersion: 1 as const,
        fixtureId: entry.fixtureId,
        runOrdinal,
        sourceSha256: entry.normalizedTransmission.sha256,
        requestFixtureBindingSha256: digestRepositoryFixtureInputRefV1(entry.requestFixtureBinding),
        requestIdentity: request.requestIdentity,
        inputDigest: request.requestIdentity.inputDigest,
        providerRequestSha256: digestValidatedCapabilityRequest(request),
      };
    }),
  );
  const core = {
    authorizationVersion: 2 as const,
    authorizationRevision: TEST_AUTHORIZATION_REVISION,
    authorizationId: TEST_AUTHORIZATION_ID,
    issuedAt: TEST_AUTHORIZATION_ISSUED_AT,
    expiresAt: TEST_AUTHORIZATION_EXPIRES_AT,
    authorizationRevisionEvidenceSha256: TEST_AUTHORIZATION_REVISION_EVIDENCE_SHA256,
    profileId: profile.profileId,
    profileSha256: digestSelectedRealModelBenchmarkProfileV1(profile),
    admittedCorpusManifestSha256: digestAdmittedRealModelBenchmarkCorpusV1(manifest),
    corpusEvidenceSha256: '8'.repeat(64),
    candidate: profile.candidateSelection,
    responsesRequestShapeSha256: PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1.requestShapeSha256,
    pricingEvidenceSha256: OPENAI_BENCHMARK_PRICING_EVIDENCE_V1.evidenceSha256,
    worstCaseRequestCostProof: worstCaseRequestCostProof(),
    authorizedObservedIdentityEvidence: authorizedObservedIdentityEvidence(),
    prompt: profile.prompt,
    contentPolicy: profile.contentPolicy,
    workflow: profile.workflow,
    authorizedRunBindings,
    caps: profile.caps,
    qualityContract: profile.qualityContract,
    retryPolicy:
      options.retryMode === 'zero'
        ? ZERO_RETRY_REAL_MODEL_BENCHMARK_POLICY_V1
        : evidencedRetryPolicy,
    secretReferenceName: OPENAI_REAL_MODEL_SECRET_REFERENCE_NAME,
    confirmations: confirmedAuthorizationReviews,
    requiredManualControlReleaseRevision: 11,
    executionRelease: {
      manualKillSwitch: 'fresh-exact-revision-release-required' as const,
      serverSideNetwork: 'future-only-exact-allowlisted-endpoint' as const,
      browserNetwork: 'forbidden' as const,
      environmentSecretPresenceAloneAuthorizes: false as const,
    },
  };
  const authorizationPayloadSha256 = digestRealModelBenchmarkAuthorizationPayloadV1(core);
  const payload = { ...core, authorizationPayloadSha256 };
  const renderedUserStatement = renderRealModelBenchmarkAuthorizationStatementV1(payload);
  return RealModelBenchmarkAuthorizationV1Schema.parse({
    ...payload,
    renderedUserStatement,
    renderedUserStatementSha256: sha256Hex(Buffer.from(renderedUserStatement, 'utf8')),
  });
};

export const emptyLedger = (manifest = admittedManifest()) => ({
  ledgerVersion: 1 as const,
  status: 'running-authorized-benchmark' as const,
  totalProviderCalls: 0,
  totalRetries: 0,
  totalFailedAttempts: 0,
  worstCaseReservedSpendMicros: '0',
  accountedActualOrEstimatedSpend: {
    micros: '0',
    rule: 'actual-when-known-otherwise-full-reservation-including-failed-and-indeterminate-calls' as const,
  },
  elapsedWallTimeMs: 0,
  fixtures: manifest.entries.map((entry) => ({
    fixtureId: entry.fixtureId,
    successfulRuns: 0,
    providerCalls: 0,
    retryCountAcrossBothRuns: 0,
    failedAttemptCount: 0,
    logicalRuns: [
      { runOrdinal: 1 as const, attemptedProviderCallCount: 0, elapsedAttemptedProviderCallMs: 0 },
      { runOrdinal: 2 as const, attemptedProviderCallCount: 0, elapsedAttemptedProviderCallMs: 0 },
    ],
    pendingTimeoutRetry: { kind: 'none' as const },
  })),
});

export const releasedManualControlFor = (authorizationInput: unknown, revision?: number) => {
  const authorization = RealModelBenchmarkAuthorizationV1Schema.parse(authorizationInput);
  return {
    controlVersion: 2 as const,
    controlId: 'banner-ai-real-model-benchmark-kill-switch-v1' as const,
    revision: revision ?? authorization.requiredManualControlReleaseRevision,
    authoritySource:
      'structural-design-input-future-opaque-authoritative-control-capability-required' as const,
    state: 'released-for-one-bounded-benchmark' as const,
    authorizationId: authorization.authorizationId,
    authorizationSha256: digestRealModelBenchmarkAuthorizationV1(authorization),
    profileId: authorization.profileId,
    profileSha256: authorization.profileSha256,
    admittedCorpusManifestSha256: authorization.admittedCorpusManifestSha256,
    releasedAt: TEST_AUTHORIZATION_ISSUED_AT,
    expiresAt: TEST_AUTHORIZATION_EXPIRES_AT,
    releaseEvidenceSha256: '9'.repeat(64),
  };
};

export const executionPreparationFor = (input: {
  readonly profile: SelectedRealModelBenchmarkProfileV1;
  readonly manifest: ReturnType<typeof admittedManifest>;
  readonly authorization: RealModelBenchmarkAuthorizationV1;
  readonly fixtureOrdinal?: 1 | 2 | 3;
  readonly runOrdinal?: 1 | 2;
}) => {
  const fixtureOrdinal = input.fixtureOrdinal ?? 1;
  const runOrdinal = input.runOrdinal ?? 1;
  const entry = input.manifest.entries[fixtureOrdinal - 1]!;
  const request = requestFor(input.profile, entry, runOrdinal);
  const providerRequestSha256 = digestValidatedCapabilityRequest(request);
  const logicalCallKey = deriveRealModelBenchmarkLogicalCallKeyV1({
    authorization: input.authorization,
    admittedCorpusManifestSha256: input.authorization.admittedCorpusManifestSha256,
    fixtureId: entry.fixtureId,
    runOrdinal,
    providerRequestSha256,
  });
  return {
    request,
    executionPreparation: {
      providerCallIdentity: {
        capability: 'vision_analysis' as const,
        providerKey: input.profile.candidateSelection.model.identity.providerKey,
        modelKey: input.profile.candidateSelection.model.identity.modelKey,
        workflowVersionId: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1.workflowVersionId,
        external: true as const,
      },
      providerRequestSha256,
      callTarget: {
        endpoint: input.profile.candidateSelection.endpointAllowlist[0],
        serverSideSecretName: OPENAI_REAL_MODEL_SECRET_REFERENCE_NAME,
        logicalCall:
          input.authorization.retryPolicy.mode === 'zero-retry'
            ? {
                kind: 'zero-retry-no-idempotency' as const,
                key: logicalCallKey,
                idempotencyHeaderOrMechanism: 'none' as const,
              }
            : {
                kind: 'evidenced-timeout-replay' as const,
                key: logicalCallKey,
                mechanism: input.authorization.retryPolicy.mechanism,
              },
      },
      ordinals: { fixtureOrdinal, runOrdinal, retryOrdinal: 0 as const, callOrdinal: 1 },
      ledger: emptyLedger(input.manifest),
      estimatedCostMicros: '100000',
      attemptedProviderCallTimeoutMs: 60_000,
    },
  };
};

export const validGateInput = () => {
  const profile = selectedProfile();
  const manifest = admittedManifest();
  const entry = manifest.entries[0]!;
  const request = requestFor(profile, entry, 1);
  const authorization = authorizationFor(profile, manifest, { retryMode: 'evidenced-replay' });
  const providerRequestSha256 = digestValidatedCapabilityRequest(request);
  const logicalCallKey = deriveRealModelBenchmarkLogicalCallKeyV1({
    authorization,
    admittedCorpusManifestSha256: authorization.admittedCorpusManifestSha256,
    fixtureId: entry.fixtureId,
    runOrdinal: 1,
    providerRequestSha256,
  });
  return {
    profile,
    authorization,
    admittedManifest: manifest,
    admittedEntry: entry,
    normalizedSource: getSyntheticBenchmarkTestSources()[0]!.callSource,
    request,
    providerCallIdentity: {
      capability: 'vision_analysis',
      providerKey: profile.candidateSelection.model.identity.providerKey,
      modelKey: profile.candidateSelection.model.identity.modelKey,
      workflowVersionId: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1.workflowVersionId,
      external: true,
    },
    providerRequestSha256,
    callTarget: {
      endpoint: profile.candidateSelection.endpointAllowlist[0],
      serverSideSecretName: OPENAI_REAL_MODEL_SECRET_REFERENCE_NAME,
      logicalCall: {
        kind: 'evidenced-timeout-replay' as const,
        key: logicalCallKey,
        mechanism: evidencedRetryPolicy.mechanism,
      },
    },
    ordinals: {
      fixtureOrdinal: 1 as const,
      runOrdinal: 1 as const,
      retryOrdinal: 0 as const,
      callOrdinal: 1,
    },
    ledger: emptyLedger(manifest),
    manualControl: releasedManualControlFor(authorization),
    estimatedCostMicros: '100000',
    attemptedProviderCallTimeoutMs: 60_000,
  };
};
