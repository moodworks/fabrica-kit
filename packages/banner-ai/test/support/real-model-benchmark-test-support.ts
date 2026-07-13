import sharp from 'sharp';

import {
  AdmittedRealModelBenchmarkCorpusEntryV1Schema,
  BLOCKED_REAL_MODEL_BENCHMARK_PROFILE_V1,
  INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
  RealModelBenchmarkAuthorizationV1Schema,
  SelectedRealModelBenchmarkCandidateV1Schema,
  SelectedRealModelBenchmarkProfileV1Schema,
  admitRealModelBenchmarkCorpusV1,
  byteSourceFrom,
  createSceneAnalysisModelRequestV1,
  deriveRealModelBenchmarkLogicalCallKeyV1,
  digestAdmittedRealModelBenchmarkCorpusV1,
  digestRealModelBenchmarkAuthorizationV1,
  digestRealModelBenchmarkReservationConfigV1,
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

export const confirmedAuthorizationReviews = {
  licenseAndThirdPartyRights: 'confirmed',
  providerTermsAndModelAvailability: 'confirmed',
  providerModelEndpointWorstCaseReservationCeiling: 'confirmed',
  providerAtMostOnceTimeoutReplayExecutionAndBilling: 'confirmed',
  providerTrainingUse: 'confirmed',
  providerRetentionAndDeletion: 'confirmed',
  humanReviewSubprocessorsAndAbuseMonitoring: 'confirmed',
  processingRegionCrossBorderDpaAndLegalBasis: 'confirmed',
  corpusHumanTransmissionApprovals: 'confirmed',
} as const;

// This synthetic `.invalid` candidate exists only to exercise provider-free schema validation.
// It is never committed in the benchmark profile and cannot identify a real provider or corpus.
export const selectedCandidate = () => {
  const model = {
    identity: {
      identityVersion: 1 as const,
      providerKey: 'synthetic-provider.invalid',
      modelKey: 'synthetic-model.invalid/vision-ocr-v1',
      modelVersion: 1,
      external: true,
    },
    capabilities: {
      capabilitiesVersion: 1 as const,
      capabilities: ['ocr', 'scene_analysis', 'structured_output'] as const,
    },
  };
  const reservationConfig = {
    configVersion: 1 as const,
    configId: 'synthetic-provider.invalid-reservation-v1',
    currency: 'USD' as const,
    purpose: 'benchmark-only' as const,
    productionPriceTruth: false as const,
    rates: {
      modelInferenceMicrosPerUnit: '100000',
      segmentationComputeMicrosPerUnit: '0',
      inpaintingMicrosPerUnit: '0',
      storageMicrosPerByteMonth: '0',
      retryMicrosPerUnit: '0',
      failedAttemptMicrosPerUnit: '0',
    },
  };
  const providerModelIdentifier = model.identity.modelKey;
  const immutableProviderModelVersion = 'synthetic-snapshot-20260713.invalid';
  const endpoint = {
    method: 'POST' as const,
    url: 'https://api.synthetic-provider.invalid/v1/scene-analysis',
    redirects: 'forbidden' as const,
    alternateOrigins: 'forbidden' as const,
    alternatePaths: 'forbidden' as const,
    alternateMethods: 'forbidden' as const,
    literalIpHosts: 'forbidden' as const,
    localhostLocalAndInternalHosts: 'forbidden' as const,
    dnsResolution:
      'future-executor-resolves-only-public-approved-addresses-and-pins-them-for-the-call' as const,
    privateReservedLinkLocalAndLoopbackAddresses: 'forbidden' as const,
    dnsRebinding: 'forbidden' as const,
    proxyOverride: 'forbidden' as const,
  };
  return SelectedRealModelBenchmarkCandidateV1Schema.parse({
    candidateVersion: 1,
    model,
    providerModelIdentifier,
    immutableProviderModelVersion,
    versionPinRequirement: 'exact-immutable-provider-model-or-snapshot-id',
    responseIdentityRequirement: {
      comparison: 'exact-equality-with-requested-candidate',
      providerKey: model.identity.providerKey,
      providerModelIdentifier,
      immutableProviderModelVersion,
    },
    worstCaseReservationConfig: reservationConfig,
    worstCaseReservationConfigSha256:
      digestRealModelBenchmarkReservationConfigV1(reservationConfig),
    worstCaseReservationScope: {
      providerKey: model.identity.providerKey,
      providerModelIdentifier,
      immutableProviderModelVersion,
      endpoint,
      evidenceSha256: 'a'.repeat(64),
      boundedRequestCostAssertion:
        'selected-bounded-request-cannot-exceed-model-inference-reservation',
      userConfirmation: 'confirmed-provider-model-endpoint-specific-worst-case-reservation-ceiling',
    },
    timeoutReplayContract: {
      providerKey: model.identity.providerKey,
      providerModelIdentifier,
      immutableProviderModelVersion,
      endpoint,
      evidenceSha256: 'b'.repeat(64),
      executionAndBillingAssertion:
        'at-most-once-provider-execution-and-billing-for-one-logical-run-after-indeterminate-timeout',
      mechanism: {
        kind: 'https-header',
        exactHeaderName: 'Idempotency-Key',
        valueEncoding: 'lowercase-sha256-hex-logical-call-key-v1',
        retryBehavior: 'initial-and-timeout-retry-send-the-identical-key',
      },
      userConfirmation:
        'confirmed-provider-model-endpoint-specific-idempotency-replay-and-billing-contract',
    },
    serverSideSecret: {
      name: 'BANNER_AI_REAL_MODEL_BENCHMARK_API_KEY',
      access: 'server-side-only',
      valueStorage: 'not-present-in-profile-or-authorization',
    },
    endpointAllowlist: [endpoint],
  });
};

export const selectedProfile = (): SelectedRealModelBenchmarkProfileV1 => {
  const blocked = mutableClone(BLOCKED_REAL_MODEL_BENCHMARK_PROFILE_V1);
  const {
    candidateStatus: ignoredStatus,
    candidateSelection: ignoredSelection,
    ...common
  } = blocked;
  void ignoredStatus;
  void ignoredSelection;
  return SelectedRealModelBenchmarkProfileV1Schema.parse({
    ...common,
    candidateStatus: 'selected-future-caller-input-only',
    candidateSelection: selectedCandidate(),
  });
};

type SyntheticSource = {
  readonly originalIngress: {
    readonly declaredContentType: 'image/png';
    readonly sha256: string;
    readonly byteSize: number;
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
  const normalized = await normalizeRasterUpload({
    bytes: byteSourceFrom(ingress),
    declaredMediaType: 'image/png',
    filename: `synthetic-test-only-${ordinal}.invalid.png`,
  });
  const metadata = {
    contentType: 'image/png' as const,
    sha256: normalized.sha256,
    byteSize: normalized.byteSize,
    pixelWidth: normalized.width,
    pixelHeight: normalized.height,
  };
  return {
    originalIngress: {
      declaredContentType: 'image/png',
      sha256: sha256Hex(ingress),
      byteSize: ingress.byteLength,
    },
    normalizedTransmission: metadata,
    callSource: { ...metadata, bytes: Uint8Array.from(normalized.bytes) },
  };
};

let syntheticTestOnlySources: readonly SyntheticSource[] | undefined;

export const prepareSyntheticBenchmarkTestSources = async (): Promise<void> => {
  syntheticTestOnlySources ??= await Promise.all([1, 2, 3].map(createSyntheticInvalidSource));
};

export const getSyntheticBenchmarkTestSources = (): readonly SyntheticSource[] => {
  if (syntheticTestOnlySources === undefined) {
    throw new TypeError('Synthetic test-only benchmark sources were not prepared.');
  }
  return syntheticTestOnlySources;
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

export const admittedEntry = (
  ordinal: number,
  scenario: 'mixed-subject-copy' | 'text-heavy' | 'no-text-layered',
) => {
  const source = getSyntheticBenchmarkTestSources()[ordinal - 1];
  if (source === undefined) throw new TypeError('Synthetic test-only source was not prepared.');
  const observationCount =
    scenario === 'mixed-subject-copy' ? 2 : scenario === 'text-heavy' ? 3 : 0;
  return {
    entryVersion: 1 as const,
    fixtureId: `synthetic.test-only.fixture.${ordinal}.invalid`,
    scenario,
    requestFixtureBinding: {
      referenceVersion: 1 as const,
      kind: 'repository-fixture' as const,
      repositoryPath: `packages/banner-ai/test/synthetic.test-only-fixture-${ordinal}.invalid.ts`,
      exportName: `createSyntheticTestOnlyInvalidFixture${ordinal}`,
      variant: 'png' as const,
      normalization: 'canonical-raster-upload-v1' as const,
    },
    originalIngress: source.originalIngress,
    normalizedTransmission: source.normalizedTransmission,
    ownerLicense: {
      status: 'user-owned' as const,
      thirdPartyProviderEvaluationRights: 'confirmed' as const,
      evidenceSha256: String(ordinal).repeat(64),
    },
    admissionReview: {
      reviewStatus: 'human-approved' as const,
      visualPixelsReviewed: true as const,
      metadataReviewed: true as const,
      providerTransmissionApproval: {
        status: 'explicit-human-approval-recorded' as const,
        scope: 'exact-normalized-image-to-selected-provider-for-this-benchmark-only' as const,
        approvalEvidenceSha256: ['a', 'b', 'c'][ordinal - 1]!.repeat(64),
      },
      secrets: 'confirmed-absent' as const,
      personalData: 'confirmed-absent' as const,
      credentials: 'confirmed-absent' as const,
      privateClientWork: 'confirmed-absent' as const,
      embeddedTrackingUrls: 'confirmed-absent' as const,
      visibleTrackingUrls: 'confirmed-absent' as const,
      reviewEvidenceSha256: String(ordinal + 3).repeat(64),
    },
    expectedOracle: {
      oracleVersion: 1 as const,
      evidenceRole: 'human-expected-oracle' as const,
      evidenceSha256: String(ordinal + 6).repeat(64),
      evidenceReference: `oracle.evidence.${ordinal}.invalid`,
      reviewStatus: 'human-approved' as const,
      requiredLayers: [1, 2, 3].map((layer) => ({
        oracleLayerId: `oracle.layer.${ordinal}.${layer}`,
        role:
          layer === 1
            ? ('background' as const)
            : layer === 2
              ? ('subject' as const)
              : ('text' as const),
        required: true as const,
      })),
      expectedTextOccurrences: Array.from({ length: observationCount }, (_, index) =>
        oracleTextOccurrence(index + 1),
      ),
    },
  };
};

export const admittedManifest = () =>
  admitRealModelBenchmarkCorpusV1({
    manifestVersion: 1,
    profileId: 'banner-scene-analysis-ocr-first-call-v1',
    status: 'admitted',
    corpusPurpose: 'sanitized-third-party-provider-evaluation-only',
    entries: [
      admittedEntry(1, 'mixed-subject-copy'),
      admittedEntry(2, 'text-heavy'),
      admittedEntry(3, 'no-text-layered'),
    ],
  });

export const authorizationFor = (
  profile: SelectedRealModelBenchmarkProfileV1,
  manifest = admittedManifest(),
): RealModelBenchmarkAuthorizationV1 => {
  const payload = {
    authorizationVersion: 1 as const,
    authorizationId: 'synthetic.test-only.authorization.invalid',
    profileId: profile.profileId,
    profileSha256: digestSelectedRealModelBenchmarkProfileV1(profile),
    admittedCorpusManifestSha256: digestAdmittedRealModelBenchmarkCorpusV1(manifest),
    candidate: profile.candidateSelection,
    prompt: profile.prompt,
    contentPolicy: profile.contentPolicy,
    workflow: profile.workflow,
    caps: profile.caps,
    confirmations: confirmedAuthorizationReviews,
    executionRelease: {
      manualKillSwitch: 'manually-released-for-this-bounded-benchmark-only' as const,
      serverSideNetwork: 'authorized-only-for-the-exact-allowlisted-endpoint' as const,
      browserNetwork: 'forbidden' as const,
      environmentSecretPresenceAloneAuthorizes: false as const,
    },
  };
  return RealModelBenchmarkAuthorizationV1Schema.parse({
    ...payload,
    renderedUserStatement: renderRealModelBenchmarkAuthorizationStatementV1(payload),
  });
};

export const requestFor = (
  profile: SelectedRealModelBenchmarkProfileV1,
  entry: unknown = admittedManifest().entries[0]!,
) => {
  const admittedEntry = AdmittedRealModelBenchmarkCorpusEntryV1Schema.parse(entry);
  return createSceneAnalysisModelRequestV1({
    requestId: 'synthetic.test-only.benchmark.request.invalid',
    modelInput: {
      inputVersion: 1,
      fixture: admittedEntry.requestFixtureBinding,
      sourceAsset: {
        assetId: 'asset_synthetic_test_only_invalid_01',
        assetVersionId: 'version_synthetic_test_only_invalid_01',
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

export const releasedManualControlFor = (authorizationInput: unknown, revision = 2) => {
  const authorization = RealModelBenchmarkAuthorizationV1Schema.parse(authorizationInput);
  return {
    controlVersion: 1 as const,
    controlId: 'banner-ai-real-model-benchmark-kill-switch-v1' as const,
    revision,
    authoritySource: 'fresh-authoritative-server-side-read-required-before-every-call' as const,
    state: 'released-for-one-bounded-benchmark' as const,
    authorizationId: authorization.authorizationId,
    authorizationSha256: digestRealModelBenchmarkAuthorizationV1(authorization),
    profileId: authorization.profileId,
    profileSha256: authorization.profileSha256,
    admittedCorpusManifestSha256: authorization.admittedCorpusManifestSha256,
  };
};

export const validGateInput = () => {
  const profile = selectedProfile();
  const manifest = admittedManifest();
  const entry = manifest.entries[0]!;
  const request = requestFor(profile, entry);
  const authorization = authorizationFor(profile, manifest);
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
      serverSideSecretName: 'BANNER_AI_REAL_MODEL_BENCHMARK_API_KEY',
      logicalCall: {
        key: logicalCallKey,
        mechanism: profile.candidateSelection.timeoutReplayContract.mechanism,
      },
    },
    ordinals: { fixtureOrdinal: 1, runOrdinal: 1, retryOrdinal: 0, callOrdinal: 1 },
    ledger: emptyLedger(manifest),
    manualControl: releasedManualControlFor(authorization),
    estimatedCostMicros: '100000',
    attemptedProviderCallTimeoutMs: 60_000,
  };
};
