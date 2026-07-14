import { beforeAll, describe, expect, it } from 'vitest';

import {
  BLOCKED_REAL_MODEL_BENCHMARK_CORPUS_MANIFEST_V1,
  BLOCKED_REAL_MODEL_BENCHMARK_PROFILE_V1,
  DEFAULT_REAL_MODEL_BENCHMARK_MANUAL_CONTROL_V1,
  EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  OPENAI_BENCHMARK_PRICING_EVIDENCE_V1,
  OPENAI_REAL_MODEL_ENDPOINT,
  OPENAI_REAL_MODEL_MAX_OUTPUT_TOKENS,
  OPENAI_REAL_MODEL_REQUESTED_MODEL_ID,
  PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1,
  REAL_MODEL_BENCHMARK_CAPS_V1,
  RealModelBenchmarkAuthorizationV1Schema,
  RealModelBenchmarkCorpusManifestV1Schema,
  SelectedRealModelBenchmarkCandidateV1Schema,
  SelectedRealModelBenchmarkProfileV1Schema,
  admitRealModelBenchmarkCorpusV1,
  createModelProducedActualTextObservationSetV1,
  digestOpenAiExecutionObservedIdentityV1,
  validateOpenAiExecutionObservedIdentityV1,
} from '../src/index.js';
import {
  admittedManifest,
  admittedManifestInput,
  authorizationFor,
  mutableClone,
  prepareSyntheticBenchmarkTestSources,
  recomputeAdmittedEntryEvidenceBinding,
  requestFor,
  selectedCandidate,
  selectedProfile,
} from './support/real-model-benchmark-test-support.js';

beforeAll(prepareSyntheticBenchmarkTestSources);

describe('explicit but hard-disabled OpenAI benchmark profile', () => {
  it('pins only the proposed OpenAI Responses alias/endpoint/request shape without snapshot claims', () => {
    expect(BLOCKED_REAL_MODEL_BENCHMARK_PROFILE_V1).toMatchObject({
      candidateStatus: 'proposed-unverified-execution-blocked',
      candidateSelection: {
        providerKey: 'openai',
        apiFamily: 'responses',
        providerModelIdentifier: OPENAI_REAL_MODEL_REQUESTED_MODEL_ID,
        modelAliasStatus: 'proposed-unverified-provider-alias',
        immutableSnapshotClaim: false,
        endpointAllowlist: [{ method: 'POST', url: OPENAI_REAL_MODEL_ENDPOINT }],
        serverSideSecret: { name: 'OPENAI_API_KEY' },
      },
      execution: {
        state: 'disabled-by-default',
        networkAccess: 'disabled',
        killSwitch: 'engaged',
        corpus: 'blocked-empty-production-registry',
        committedAuthorization: 'none',
        retryAuthority: 'none',
        dispatcherOrClient: 'non-networking-refusal-stub-only',
      },
    });
    expect(PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1).toMatchObject({
      status: 'proposed-unverified-api-shape',
      maxOutputTokens: OPENAI_REAL_MODEL_MAX_OUTPUT_TOKENS,
      imageInput: { detail: 'original', providerUrlFetching: 'forbidden' },
      tools: [],
      toolChoice: 'none',
      background: false,
      store: false,
      previousResponseOrConversation: 'absent',
      followUpOrAutonomousWork: 'absent',
    });
    expect(DEFAULT_REAL_MODEL_BENCHMARK_MANUAL_CONTROL_V1.state).toBe('engaged');
    expect(BLOCKED_REAL_MODEL_BENCHMARK_CORPUS_MANIFEST_V1).toMatchObject({
      entries: [],
      productionSourceRegistry: 'empty',
      admissionAllowed: false,
    });
  });

  it('hash-binds the supplied dated token-rate evidence without calling it production truth', () => {
    expect(OPENAI_BENCHMARK_PRICING_EVIDENCE_V1).toMatchObject({
      capturedDate: '2026-07-13',
      sourceDescriptor: 'user-supplied OpenAI public pricing page evidence',
      standardInputMicrosPerMillionTokens: '2500000',
      standardOutputMicrosPerMillionTokens: '15000000',
      productionPriceTruth: false,
      futureAuthorizationReconfirmation: 'required',
    });
    expect(OPENAI_BENCHMARK_PRICING_EVIDENCE_V1.evidenceSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(BLOCKED_REAL_MODEL_BENCHMARK_PROFILE_V1.candidateSelection).toMatchObject({
      worstCaseRequestCostProofStatus:
        'absent-token-rates-do-not-prove-per-call-reservation-execution-blocked',
    });
  });

  it('keeps every established numerical cap as an explicit ceiling, not retry authority', () => {
    expect(
      Object.values(REAL_MODEL_BENCHMARK_CAPS_V1).every(
        (cap) => cap.authorization === EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
      ),
    ).toBe(true);
    expect(REAL_MODEL_BENCHMARK_CAPS_V1.maxLatencyPerAttemptedProviderCall.value).toBe(60_000);
    expect(REAL_MODEL_BENCHMARK_CAPS_V1.maxLatencyPerLogicalRun.value).toBe(120_000);
    expect(
      BLOCKED_REAL_MODEL_BENCHMARK_PROFILE_V1.candidateSelection.retryPolicyRequirement,
    ).toMatchObject({
      committedDefault: 'zero-retry',
      numericalRetryCaps: 'ceilings-not-authority',
    });
  });
});

describe('future exact authorization evidence', () => {
  it('requires every field, exact rendered statement/digests, request bindings, and caps', () => {
    const profile = selectedProfile();
    const authorization = authorizationFor(profile);
    expect(SelectedRealModelBenchmarkProfileV1Schema.parse(profile).candidateStatus).toBe(
      'proposed-unverified-execution-blocked',
    );
    expect(authorization.authorizedRunBindings).toHaveLength(6);

    for (const key of Object.keys(authorization)) {
      const missing = mutableClone(authorization) as unknown as Record<string, unknown>;
      delete missing[key];
      expect(RealModelBenchmarkAuthorizationV1Schema.safeParse(missing).success, key).toBe(false);
    }
    const alteredStatement = mutableClone(authorization);
    alteredStatement.renderedUserStatement += ' ';
    expect(RealModelBenchmarkAuthorizationV1Schema.safeParse(alteredStatement).success).toBe(false);

    const alteredInputDigest = mutableClone(authorization);
    alteredInputDigest.authorizedRunBindings[0]!.inputDigest.sha256 = 'a'.repeat(64) as never;
    expect(RealModelBenchmarkAuthorizationV1Schema.safeParse(alteredInputDigest).success).toBe(
      false,
    );

    const assertPayloadDigestFailure = (candidate: unknown): void => {
      expect(() => RealModelBenchmarkAuthorizationV1Schema.safeParse(candidate)).not.toThrow();
      const result = RealModelBenchmarkAuthorizationV1Schema.safeParse(candidate);
      expect(result.success).toBe(false);
      if (result.success) throw new TypeError('Expected an authorization payload digest failure.');
      expect(
        result.error.issues.some(
          (issue) =>
            issue.path.join('.') === 'authorizationPayloadSha256' &&
            /payload digest/i.test(issue.message),
        ),
      ).toBe(true);
    };

    const staleDigestAfterValidCoreMutation = mutableClone(authorization);
    staleDigestAfterValidCoreMutation.authorizationRevision += 1;
    assertPayloadDigestFailure(staleDigestAfterValidCoreMutation);

    const directlyTamperedPayloadDigest = mutableClone(authorization);
    directlyTamperedPayloadDigest.authorizationPayloadSha256 = '0'.repeat(64) as never;
    assertPayloadDigestFailure(directlyTamperedPayloadDigest);
  });

  it('fails closed when execution-observed version/fingerprint evidence is absent or mismatched', () => {
    const authorized = authorizationFor(selectedProfile()).authorizedObservedIdentityEvidence;
    const core = {
      identityEvidenceVersion: 1 as const,
      providerKey: 'openai' as const,
      requestedModelId: OPENAI_REAL_MODEL_REQUESTED_MODEL_ID,
      observedProviderModelVersion: authorized.observedProviderModelVersion,
      observedProviderFingerprint: authorized.observedProviderFingerprint,
      responseObservedAt: '2026-07-13T00:00:00.000Z',
    };
    const observed = {
      ...core,
      responseIdentityEvidenceSha256: digestOpenAiExecutionObservedIdentityV1(core),
    };
    expect(
      validateOpenAiExecutionObservedIdentityV1({
        authorizedEvidence: authorized,
        executionObservedIdentity: observed,
      }),
    ).toEqual(observed);
    expect(() =>
      validateOpenAiExecutionObservedIdentityV1({
        authorizedEvidence: authorized,
        executionObservedIdentity: undefined,
      }),
    ).toThrow();
    const mismatchCore = { ...core, observedProviderFingerprint: 'mismatch.invalid' };
    expect(() =>
      validateOpenAiExecutionObservedIdentityV1({
        authorizedEvidence: authorized,
        executionObservedIdentity: {
          ...mismatchCore,
          responseIdentityEvidenceSha256: digestOpenAiExecutionObservedIdentityV1(mismatchCore),
        },
      }),
    ).toThrow(/mismatched/i);
  });

  it('rejects any provider, model, endpoint, request-shape, or pricing substitution', () => {
    const candidate = mutableClone(selectedCandidate());
    const substitutions: readonly ((value: typeof candidate) => void)[] = [
      (value) => {
        value.providerKey = 'other' as never;
      },
      (value) => {
        value.providerModelIdentifier = 'other-model' as never;
      },
      (value) => {
        value.endpointAllowlist[0]!.url = 'https://api.openai.com/v1/other' as never;
      },
      (value) => {
        value.responsesRequestContract.requestShapeSha256 = 'f'.repeat(64) as never;
      },
      (value) => {
        value.pricingEvidence.evidenceSha256 = 'f'.repeat(64) as never;
      },
    ];
    for (const substitute of substitutions) {
      const changed = mutableClone(candidate);
      substitute(changed);
      expect(SelectedRealModelBenchmarkCandidateV1Schema.safeParse(changed).success).toBe(false);
    }
  });
});

describe('sanitized corpus admission', () => {
  it('admits exactly three visibly test-only, evidence-bound scenarios', () => {
    expect(
      RealModelBenchmarkCorpusManifestV1Schema.safeParse(
        BLOCKED_REAL_MODEL_BENCHMARK_CORPUS_MANIFEST_V1,
      ).success,
    ).toBe(true);
    expect(admittedManifest().entries.map((entry) => entry.scenario)).toEqual([
      'mixed-subject-copy',
      'text-heavy',
      'no-text-layered',
    ]);
    expect(admittedManifest().entries.every((entry) => entry.fixtureId.includes('test-only'))).toBe(
      true,
    );
  });

  it('rejects missing or drifted source, license, privacy, oracle, and transmission evidence', () => {
    const deletions: readonly ((entry: Record<string, unknown>) => void)[] = [
      (entry) => delete (entry.originalIngress as Record<string, unknown>).sha256,
      (entry) => delete (entry.normalizedTransmission as Record<string, unknown>).pixelWidth,
      (entry) => delete (entry.ownerLicense as Record<string, unknown>).evidenceSha256,
      (entry) => delete (entry.admissionReview as Record<string, unknown>).reviewedAt,
      (entry) => delete (entry.admissionReview as Record<string, unknown>).expiresAt,
      (entry) => delete (entry.admissionReview as Record<string, unknown>).reviewEvidenceSha256,
      (entry) =>
        delete (entry.admissionReview as Record<string, unknown>).providerTransmissionApproval,
      (entry) => delete (entry.expectedOracle as Record<string, unknown>).evidenceSha256,
      (entry) => delete (entry.evidenceBinding as Record<string, unknown>).bindingSha256,
    ];
    for (const remove of deletions) {
      const manifest = admittedManifestInput();
      remove(manifest.entries[0]!);
      expect(() => admitRealModelBenchmarkCorpusV1(manifest)).toThrow();
    }

    const drifted = admittedManifestInput();
    drifted.entries[0]!.admissionReview.providerTransmissionApproval.normalizedSourceSha256 =
      'f'.repeat(64);
    expect(() => admitRealModelBenchmarkCorpusV1(drifted)).toThrow(/drifted/i);
  });

  it('rejects duplicate original digests, normalized digests, and request bindings', () => {
    const duplicateOriginal = admittedManifestInput();
    duplicateOriginal.entries[1]!.originalIngress.sha256 =
      duplicateOriginal.entries[0]!.originalIngress.sha256;
    duplicateOriginal.entries[1] = recomputeAdmittedEntryEvidenceBinding(
      duplicateOriginal.entries[1]!,
    );

    const duplicateNormalized = admittedManifestInput();
    duplicateNormalized.entries[1]!.normalizedTransmission.sha256 =
      duplicateNormalized.entries[0]!.normalizedTransmission.sha256;
    duplicateNormalized.entries[1]!.admissionReview.providerTransmissionApproval.normalizedSourceSha256 =
      duplicateNormalized.entries[0]!.normalizedTransmission.sha256;
    duplicateNormalized.entries[1] = recomputeAdmittedEntryEvidenceBinding(
      duplicateNormalized.entries[1]!,
    );

    const duplicateRequestBinding = admittedManifestInput();
    duplicateRequestBinding.entries[1]!.requestFixtureBinding =
      duplicateRequestBinding.entries[0]!.requestFixtureBinding;
    duplicateRequestBinding.entries[1] = recomputeAdmittedEntryEvidenceBinding(
      duplicateRequestBinding.entries[1]!,
    );

    expect(() => admitRealModelBenchmarkCorpusV1(duplicateOriginal)).toThrow(/digests.*unique/i);
    expect(() => admitRealModelBenchmarkCorpusV1(duplicateNormalized)).toThrow(/digests.*unique/i);
    expect(() => admitRealModelBenchmarkCorpusV1(duplicateRequestBinding)).toThrow(
      /bindings.*unique/i,
    );
  });

  it('keeps human oracle evidence structurally incompatible with model-produced evidence', () => {
    const profile = selectedProfile();
    const admitted = admittedManifest();
    const request = requestFor(profile, admitted.entries[0]!);
    const actual = createModelProducedActualTextObservationSetV1({ request, observations: [] });
    const manifest = admittedManifestInput();
    const incompatible = {
      ...manifest,
      entries: [
        { ...manifest.entries[0]!, expectedOracle: actual },
        manifest.entries[1]!,
        manifest.entries[2]!,
      ],
    };
    expect(() => admitRealModelBenchmarkCorpusV1(incompatible)).toThrow();
  });
});
