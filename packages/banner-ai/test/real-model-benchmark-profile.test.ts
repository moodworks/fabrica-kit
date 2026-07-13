import { beforeAll, describe, expect, it } from 'vitest';

import {
  BLOCKED_REAL_MODEL_BENCHMARK_CORPUS_MANIFEST_V1,
  BLOCKED_REAL_MODEL_BENCHMARK_PROFILE_V1,
  DEFAULT_REAL_MODEL_BENCHMARK_MANUAL_CONTROL_V1,
  EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
  REAL_MODEL_BENCHMARK_CAPS_V1,
  RealModelBenchmarkAuthorizationV1Schema,
  RealModelBenchmarkCorpusManifestV1Schema,
  RealModelBenchmarkManualControlV1Schema,
  SelectedRealModelBenchmarkCandidateV1Schema,
  SelectedRealModelBenchmarkProfileV1Schema,
  admitRealModelBenchmarkCorpusV1,
  createModelProducedActualTextObservationSetV1,
  digestSelectedRealModelBenchmarkProfileV1,
} from '../src/index.js';
import {
  admittedManifest,
  authorizationFor,
  mutableClone,
  prepareSyntheticBenchmarkTestSources,
  requestFor,
  selectedCandidate,
  selectedProfile,
} from './support/real-model-benchmark-test-support.js';

beforeAll(prepareSyntheticBenchmarkTestSources);

describe('hard-disabled real-model benchmark profile', () => {
  it('commits no candidate, endpoint, authorization, dispatcher, release, or corpus', () => {
    expect(BLOCKED_REAL_MODEL_BENCHMARK_PROFILE_V1).toMatchObject({
      candidateStatus: 'blocked-unselected',
      candidateSelection: {
        providerAndExactModelSelected: false,
        immutableModelVersionOrSnapshotSelected: false,
        exactEndpointSelected: false,
        worstCaseReservationEvidenceConfirmed: false,
        atMostOnceTimeoutReplayAndBillingContractConfirmed: false,
        endpointAllowlist: [],
      },
      execution: {
        state: 'disabled-by-default',
        networkAccess: 'disabled',
        killSwitch: 'engaged',
        committedAuthorization: 'none',
        retryAuthority: 'none',
        dispatcherOrClient: 'not-implemented',
      },
    });
    expect(DEFAULT_REAL_MODEL_BENCHMARK_MANUAL_CONTROL_V1.state).toBe('engaged');
    expect(BLOCKED_REAL_MODEL_BENCHMARK_CORPUS_MANIFEST_V1.entries).toEqual([]);
    const blockedManifest = BLOCKED_REAL_MODEL_BENCHMARK_CORPUS_MANIFEST_V1;
    if (blockedManifest.status !== 'blocked-awaiting-user-supplied-corpus') {
      throw new TypeError('Expected the committed corpus manifest to remain blocked.');
    }
    expect(blockedManifest.currentAngelFixture).toContain('ineligible-12x8-77-byte');
    expect(() =>
      digestSelectedRealModelBenchmarkProfileV1(BLOCKED_REAL_MODEL_BENCHMARK_PROFILE_V1),
    ).toThrow();
  });

  it('marks every numeric budget, including both latency meanings, as explicitly authorized', () => {
    expect(
      Object.values(REAL_MODEL_BENCHMARK_CAPS_V1).every(
        (cap) => cap.authorization === EXPLICIT_BENCHMARK_AUTHORIZATION_REQUIRED,
      ),
    ).toBe(true);
    expect(REAL_MODEL_BENCHMARK_CAPS_V1.maxLatencyPerAttemptedProviderCall.value).toBe(60_000);
    expect(REAL_MODEL_BENCHMARK_CAPS_V1.maxLatencyPerLogicalRun.value).toBe(120_000);
  });
});

describe('selected candidate and exact authorization configuration', () => {
  it('requires every authorization field, exact rendered text, and every cap', () => {
    const profile = selectedProfile();
    const authorization = authorizationFor(profile);
    expect(SelectedRealModelBenchmarkProfileV1Schema.parse(profile).candidateStatus).toBe(
      'selected-future-caller-input-only',
    );

    for (const key of Object.keys(authorization)) {
      const missing = mutableClone(authorization) as unknown as Record<string, unknown>;
      delete missing[key];
      expect(RealModelBenchmarkAuthorizationV1Schema.safeParse(missing).success, key).toBe(false);
    }
    for (const key of Object.keys(authorization.caps)) {
      const missing = mutableClone(authorization) as unknown as {
        caps: Record<string, unknown>;
      };
      delete missing.caps[key];
      expect(RealModelBenchmarkAuthorizationV1Schema.safeParse(missing).success, key).toBe(false);
    }
    const alteredStatement = mutableClone(authorization);
    alteredStatement.renderedUserStatement += ' ';
    expect(RealModelBenchmarkAuthorizationV1Schema.safeParse(alteredStatement).success).toBe(false);
  });

  it('requires provider/model/version/endpoint-bound reservation and replay evidence', () => {
    const missingCases = [
      'providerKey',
      'providerModelIdentifier',
      'immutableProviderModelVersion',
      'endpoint',
      'evidenceSha256',
      'userConfirmation',
    ] as const;
    for (const key of missingCases) {
      const missingReplay = mutableClone(selectedCandidate()) as unknown as {
        timeoutReplayContract: Record<string, unknown>;
      };
      delete missingReplay.timeoutReplayContract[key];
      expect(
        SelectedRealModelBenchmarkCandidateV1Schema.safeParse(missingReplay).success,
        'replay ' + key,
      ).toBe(false);
    }
    const missingReservation = mutableClone(selectedCandidate()) as unknown as {
      worstCaseReservationScope: Record<string, unknown>;
    };
    delete missingReservation.worstCaseReservationScope.evidenceSha256;
    expect(SelectedRealModelBenchmarkCandidateV1Schema.safeParse(missingReservation).success).toBe(
      false,
    );
  });

  it('rejects unsafe endpoints, policy drift, and more than one endpoint', () => {
    const candidate = selectedCandidate();
    for (const endpointAllowlist of [
      [{ ...candidate.endpointAllowlist[0], url: 'https://user:pass@api.invalid/v1/analyze' }],
      [{ ...candidate.endpointAllowlist[0], url: 'https://api.invalid/v1/analyze?q=1' }],
      [{ ...candidate.endpointAllowlist[0], url: 'https://api.invalid/v1/analyze#fragment' }],
      [{ ...candidate.endpointAllowlist[0], redirects: 'allowed' }],
      [{ ...candidate.endpointAllowlist[0], method: 'GET' }],
      [{ ...candidate.endpointAllowlist[0], url: 'https://127.0.0.1/v1/analyze' }],
      [{ ...candidate.endpointAllowlist[0], url: 'https://[::1]/v1/analyze' }],
      [{ ...candidate.endpointAllowlist[0], url: 'https://localhost/v1/analyze' }],
      [{ ...candidate.endpointAllowlist[0], url: 'https://provider.internal/v1/analyze' }],
      [{ ...candidate.endpointAllowlist[0], dnsRebinding: 'allowed' }],
      [{ ...candidate.endpointAllowlist[0], proxyOverride: 'allowed' }],
      [
        candidate.endpointAllowlist[0],
        { ...candidate.endpointAllowlist[0], url: 'https://other.invalid/v1/analyze' },
      ],
    ]) {
      expect(
        SelectedRealModelBenchmarkCandidateV1Schema.safeParse({
          ...candidate,
          endpointAllowlist,
        }).success,
      ).toBe(false);
    }
  });

  it('models engaged, re-engaged, and exactly bound release states without a committed release', () => {
    const authorization = authorizationFor(selectedProfile());
    expect(
      RealModelBenchmarkManualControlV1Schema.safeParse({
        controlVersion: 1,
        controlId: 'banner-ai-real-model-benchmark-kill-switch-v1',
        revision: 2,
        authoritySource: 'fresh-authoritative-server-side-read-required-before-every-call',
        state: 're-engaged',
        authorizationId: authorization.authorizationId,
        authorizationSha256: 'a'.repeat(64),
      }).success,
    ).toBe(true);
  });
});

describe('sanitized corpus admission', () => {
  it('admits only the exact three visibly test-only reviewed scenarios', () => {
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

  it('rejects missing digest/type/dimensions/license/review/transmission/data-safety metadata', () => {
    const deletions: readonly ((entry: Record<string, unknown>) => void)[] = [
      (entry) => delete (entry.normalizedTransmission as Record<string, unknown>).sha256,
      (entry) => delete (entry.originalIngress as Record<string, unknown>).declaredContentType,
      (entry) => delete (entry.normalizedTransmission as Record<string, unknown>).pixelWidth,
      (entry) => delete (entry.normalizedTransmission as Record<string, unknown>).pixelHeight,
      (entry) => delete (entry.ownerLicense as Record<string, unknown>).status,
      (entry) => delete (entry.ownerLicense as Record<string, unknown>).evidenceSha256,
      (entry) => delete (entry.admissionReview as Record<string, unknown>).reviewStatus,
      (entry) =>
        delete (entry.admissionReview as Record<string, unknown>).providerTransmissionApproval,
      (entry) =>
        delete (
          (entry.admissionReview as Record<string, unknown>).providerTransmissionApproval as Record<
            string,
            unknown
          >
        ).approvalEvidenceSha256,
      (entry) => delete (entry.admissionReview as Record<string, unknown>).reviewEvidenceSha256,
      (entry) => delete (entry.admissionReview as Record<string, unknown>).secrets,
      (entry) => delete (entry.admissionReview as Record<string, unknown>).personalData,
      (entry) => delete (entry.admissionReview as Record<string, unknown>).credentials,
      (entry) => delete (entry.admissionReview as Record<string, unknown>).privateClientWork,
      (entry) => delete (entry.admissionReview as Record<string, unknown>).embeddedTrackingUrls,
      (entry) => delete (entry.admissionReview as Record<string, unknown>).visibleTrackingUrls,
    ];
    for (const remove of deletions) {
      const manifest = mutableClone(admittedManifest()) as unknown as {
        entries: Record<string, unknown>[];
      };
      remove(manifest.entries[0]!);
      expect(() => admitRealModelBenchmarkCorpusV1(manifest)).toThrow();
    }
  });

  it('keeps human oracle evidence structurally incompatible with model-produced evidence', () => {
    const profile = selectedProfile();
    const manifest = mutableClone(admittedManifest());
    const request = requestFor(profile, manifest.entries[0]!);
    const actual = createModelProducedActualTextObservationSetV1({ request, observations: [] });
    manifest.entries[0]!.expectedOracle = actual as never;
    expect(() => admitRealModelBenchmarkCorpusV1(manifest)).toThrow();

    const unknownActualEvidence = mutableClone(admittedManifest()) as unknown as {
      entries: (Record<string, unknown> & { expectedOracle: Record<string, unknown> })[];
    };
    unknownActualEvidence.entries[0]!.expectedOracle.modelProducedEvidence = actual;
    expect(() => admitRealModelBenchmarkCorpusV1(unknownActualEvidence)).toThrow();
  });
});
