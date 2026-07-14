import { beforeAll, describe, expect, it, vi } from 'vitest';

import * as publicBannerAi from '../src/index.js';

import {
  OPENAI_SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_SHA256,
  OPENAI_SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_V1,
  OpenAiProposedSceneAnalysisOcrOutputV1Schema,
  PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1,
  admitRealModelBenchmarkCorpusV1,
  canonicalizeJson,
  createDetachedOpenAiSceneAnalysisOcrJsonSchemaV1,
  digestOpenAiExecutionObservedIdentityV1,
  sha256Hex,
} from '../src/index.js';
import {
  admittedManifest,
  admittedManifestInput,
  authorizationFor,
  executionPreparationFor,
  getSyntheticBenchmarkTestSources,
  mutableClone,
  prepareSyntheticBenchmarkTestSources,
  recomputeAdmittedEntryEvidenceBinding,
  releasedManualControlFor,
  requestFor,
  selectedProfile,
} from './support/real-model-benchmark-test-support.js';

type LoaderModule = typeof import('../src/server/real-model-benchmark-corpus-loader.js');
type BoundaryModule = typeof import('../src/server/openai-real-model-request-boundary.js');

let loader: LoaderModule;
let boundary: BoundaryModule;

const createTestStaticRegistry = () => {
  const manifest = admittedManifest();
  const sources = getSyntheticBenchmarkTestSources();
  return manifest.entries.map((entry, index) => ({
    sourceVersion: 1 as const,
    fixtureId: entry.fixtureId,
    requestFixtureBinding: entry.requestFixtureBinding,
    filename: sources[index]!.filename,
    declaredContentType: sources[index]!.declaredContentType,
    originalBytes: Uint8Array.from(sources[index]!.originalBytes),
  }));
};

const installTestStaticRegistryMock = (registry: ReturnType<typeof createTestStaticRegistry>) => {
  vi.doUnmock('../src/server/real-model-benchmark-corpus-source-registry.js');
  vi.doMock('../src/server/real-model-benchmark-corpus-source-registry.js', () => ({
    REAL_MODEL_BENCHMARK_STATIC_CORPUS_SOURCE_REGISTRY_V1: Object.freeze(registry),
  }));
};

const importIsolatedLoaderWithRegistry = async (
  registry: ReturnType<typeof createTestStaticRegistry>,
): Promise<LoaderModule> => {
  vi.resetModules();
  installTestStaticRegistryMock(registry);
  return import('../src/server/real-model-benchmark-corpus-loader.js');
};

beforeAll(async () => {
  await prepareSyntheticBenchmarkTestSources();
  vi.resetModules();
  installTestStaticRegistryMock(createTestStaticRegistry());
  loader = await import('../src/server/real-model-benchmark-corpus-loader.js');
  boundary = await import('../src/server/openai-real-model-request-boundary.js');
});

const loadedContext = async (retryMode: 'zero' | 'evidenced-replay' = 'zero') => {
  const profile = selectedProfile();
  const manifest = admittedManifest();
  const authorization = authorizationFor(profile, manifest, { retryMode });
  const corpusCapability = await loader.loadTrustedRealModelBenchmarkCorpusV1({
    manifest,
    authorizationContext: authorization,
  });
  return { profile, manifest, authorization, corpusCapability };
};

describe('trusted whole-corpus loader', () => {
  it('re-normalizes all three static sources atomically and rejects cloned authority', async () => {
    const context = await loadedContext();
    expect(context.corpusCapability).toMatchObject({
      fixtureCount: 3,
      sourceAuthority: 'whole-corpus-package-owned-static-registry',
      capabilityId: 'runtime-whole-corpus-capability-v1',
    });
    expect(context.corpusCapability).not.toHaveProperty('manifestSha256');
    expect(context.corpusCapability).not.toHaveProperty('authorizationPayloadSha256');
    const clone = structuredClone(context.corpusCapability);
    expect(() =>
      loader.requireTrustedRealModelBenchmarkCorpusStateV1(
        clone,
        context.manifest.entries[0]!.fixtureId,
      ),
    ).toThrow(/cloned|forged/i);
  });

  it('fails closed on duplicates, evidence drift, stale review, missing evidence, and unapproved transmission', async () => {
    const profile = selectedProfile();
    const cases: unknown[] = [];

    const duplicate = admittedManifestInput();
    duplicate.entries[1]!.fixtureId = duplicate.entries[0]!.fixtureId;
    cases.push(duplicate);

    const drift = admittedManifestInput();
    drift.entries[0]!.normalizedTransmission.sha256 = 'f'.repeat(64);
    cases.push(drift);

    const missing = admittedManifestInput();
    delete (missing.entries[0]!.evidenceBinding as Record<string, unknown>).bindingSha256;
    cases.push(missing);

    const unapprovedInput = admittedManifestInput();
    const unapproved = {
      ...unapprovedInput,
      entries: [
        {
          ...unapprovedInput.entries[0]!,
          admissionReview: {
            ...unapprovedInput.entries[0]!.admissionReview,
            providerTransmissionApproval: {
              ...unapprovedInput.entries[0]!.admissionReview.providerTransmissionApproval,
              status: 'not-approved',
            },
          },
        },
        unapprovedInput.entries[1]!,
        unapprovedInput.entries[2]!,
      ],
    };
    cases.push(unapproved);

    for (const manifest of cases) {
      await expect(
        loader.loadTrustedRealModelBenchmarkCorpusV1({
          manifest,
          authorizationContext: authorizationFor(profile),
        }),
      ).rejects.toThrow();
    }

    const staleInput = admittedManifestInput();
    staleInput.entries[0]!.admissionReview.expiresAt = '2026-01-02T00:00:00.000Z';
    staleInput.entries[0] = recomputeAdmittedEntryEvidenceBinding(staleInput.entries[0]!);
    const stale = admitRealModelBenchmarkCorpusV1(staleInput);
    const staleAuthorization = authorizationFor(profile, stale, { retryMode: 'zero' });
    await expect(
      loader.loadTrustedRealModelBenchmarkCorpusV1({
        manifest: stale,
        authorizationContext: staleAuthorization,
      }),
    ).rejects.toThrow(/not fresh/i);
  });

  it('rejects isolated original-byte and later-entry normalization drift without minting partial authority', async () => {
    const profile = selectedProfile();
    const manifest = admittedManifest();
    const corruptedRegistry = createTestStaticRegistry();
    corruptedRegistry[0]!.originalBytes[0] = corruptedRegistry[0]!.originalBytes[0]! ^ 0xff;
    const originalDriftLoader = await importIsolatedLoaderWithRegistry(corruptedRegistry);
    await expect(
      originalDriftLoader.loadTrustedRealModelBenchmarkCorpusV1({
        manifest,
        authorizationContext: authorizationFor(profile, manifest, { retryMode: 'zero' }),
      }),
    ).rejects.toThrow(/original source bytes drifted/i);

    const laterEntryDriftInput = admittedManifestInput();
    laterEntryDriftInput.entries[2]!.normalizedTransmission.sha256 = 'f'.repeat(64);
    laterEntryDriftInput.entries[2]!.admissionReview.providerTransmissionApproval.normalizedSourceSha256 =
      'f'.repeat(64);
    laterEntryDriftInput.entries[2] = recomputeAdmittedEntryEvidenceBinding(
      laterEntryDriftInput.entries[2]!,
    );
    const laterEntryDrift = admitRealModelBenchmarkCorpusV1(laterEntryDriftInput);
    const laterEntryDriftLoader = await importIsolatedLoaderWithRegistry(
      createTestStaticRegistry(),
    );
    await expect(
      laterEntryDriftLoader.loadTrustedRealModelBenchmarkCorpusV1({
        manifest: laterEntryDrift,
        authorizationContext: authorizationFor(profile, laterEntryDrift, { retryMode: 'zero' }),
      }),
    ).rejects.toThrow(/re-normalized.*drifted/i);
    expect(() =>
      laterEntryDriftLoader.requireTrustedRealModelBenchmarkCorpusStateV1(
        {
          capabilityVersion: 1,
          capabilityId: 'runtime-whole-corpus-capability-v1',
          fixtureCount: 3,
          sourceAuthority: 'whole-corpus-package-owned-static-registry',
        },
        laterEntryDrift.entries[2]!.fixtureId,
      ),
    ).toThrow(/absent|cloned|forged/i);

    vi.resetModules();
    installTestStaticRegistryMock(createTestStaticRegistry());
  });

  it('expires on the earliest non-authorization evidence window after mint and first plan', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-14T00:00:00.000Z'));
      const profile = selectedProfile();
      const manifestInput = admittedManifestInput();
      manifestInput.entries[0]!.expectedOracle.expiresAt = '2026-07-14T00:01:00.000Z';
      manifestInput.entries[0] = recomputeAdmittedEntryEvidenceBinding(manifestInput.entries[0]!);
      const manifest = admitRealModelBenchmarkCorpusV1(manifestInput);
      const authorization = authorizationFor(profile, manifest, { retryMode: 'zero' });
      const corpusCapability = await loader.loadTrustedRealModelBenchmarkCorpusV1({
        manifest,
        authorizationContext: authorization,
      });
      const context = { profile, manifest, authorization, corpusCapability };
      const firstPrepared = executionPreparationFor(context);
      const existingPlan = boundary.buildNonDispatchingOpenAiRequestPlanV1({
        profile,
        corpusCapability,
        request: firstPrepared.request,
        fixtureId: manifest.entries[0]!.fixtureId,
        manualControl: releasedManualControlFor(authorization),
        executionPreparation: firstPrepared.executionPreparation,
      });
      expect(existingPlan.kind).toBe('validated-non-dispatching-openai-responses-request-plan');

      vi.setSystemTime(new Date('2026-07-14T00:02:00.000Z'));
      const distinctPrepared = executionPreparationFor({ ...context, fixtureOrdinal: 2 });
      expect(() =>
        boundary.buildNonDispatchingOpenAiRequestPlanV1({
          profile,
          corpusCapability,
          request: distinctPrepared.request,
          fixtureId: manifest.entries[1]!.fixtureId,
          manualControl: releasedManualControlFor(authorization),
          executionPreparation: distinctPrepared.executionPreparation,
        }),
      ).toThrow(/expired|fresh/i);
      expect(() =>
        boundary.materializeOpenAiSceneAnalysisProposalFromPrivatePlanV1({
          plan: existingPlan,
          jsonText: '{}',
          executionObservedIdentity: undefined,
        }),
      ).toThrow(/expired|fresh/i);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('non-dispatching OpenAI Responses boundary', () => {
  it('builds the exact local-data request shape while keeping body and bindings private', async () => {
    const context = await loadedContext('zero');
    const entry = context.manifest.entries[0]!;
    const prepared = executionPreparationFor(context);
    const plan = boundary.buildNonDispatchingOpenAiRequestPlanV1({
      profile: context.profile,
      corpusCapability: context.corpusCapability,
      request: prepared.request,
      fixtureId: entry.fixtureId,
      manualControl: releasedManualControlFor(context.authorization),
      executionPreparation: prepared.executionPreparation,
    });
    expect(plan).toMatchObject({
      providerKey: 'openai',
      apiFamily: 'responses',
      requestedModelId: 'gpt-5.6-terra',
      endpoint: 'https://api.openai.com/v1/responses',
      secretReferenceName: 'OPENAI_API_KEY',
      dispatchAuthority: false,
      networkDispatch: 'not-implemented',
    });
    expect(plan).not.toHaveProperty('requestBody');
    expect(plan).not.toHaveProperty('image');
    expect(plan).not.toHaveProperty('requestIdentity');

    expect(boundary.inspectNonDispatchingOpenAiRequestPlanSafetyV1(plan)).toMatchObject({
      bodyKeys: [
        'background',
        'input',
        'instructions',
        'max_output_tokens',
        'model',
        'store',
        'text',
        'tool_choice',
        'tools',
      ],
      model: 'gpt-5.6-terra',
      imageTransport: 'data:image/png;base64',
      imageDetail: 'original',
      strictJsonSchema: true,
      maxOutputTokens: 4_096,
      toolCount: 0,
      toolChoice: 'none',
      background: false,
      store: false,
      remoteImageUrlPresent: false,
      previousResponseOrConversationFieldPresent: false,
      webRetrievalCodeOrFollowUpFieldPresent: false,
      dispatchAuthority: false,
    });
    expect(() =>
      boundary.inspectNonDispatchingOpenAiRequestPlanSafetyV1(structuredClone(plan)),
    ).toThrow(/cloned|forged/i);
    expect(() =>
      boundary.buildNonDispatchingOpenAiRequestPlanV1({
        profile: context.profile,
        corpusCapability: context.corpusCapability,
        request: prepared.request,
        fixtureId: entry.fixtureId,
        manualControl: releasedManualControlFor(context.authorization),
        executionPreparation: prepared.executionPreparation,
      }),
    ).toThrow(/already minted/i);
  });

  it('rejects authorization/request/revision substitution and every retry under zero-retry mode', async () => {
    const context = await loadedContext('zero');
    const entry = context.manifest.entries[0]!;
    const prepared = executionPreparationFor(context);
    const base = {
      profile: context.profile,
      corpusCapability: context.corpusCapability,
      request: prepared.request,
      fixtureId: entry.fixtureId,
      manualControl: releasedManualControlFor(context.authorization),
      executionPreparation: prepared.executionPreparation,
    };
    const retryPreparation = {
      ...prepared.executionPreparation,
      ordinals: {
        ...prepared.executionPreparation.ordinals,
        retryOrdinal: 1 as const,
      },
    };
    expect(() =>
      boundary.buildNonDispatchingOpenAiRequestPlanV1({
        ...base,
        executionPreparation: retryPreparation,
      }),
    ).toThrow(/zero-retry/i);
    const staleControl = mutableClone(base.manualControl);
    staleControl.revision -= 1;
    expect(() =>
      boundary.buildNonDispatchingOpenAiRequestPlanV1({ ...base, manualControl: staleControl }),
    ).toThrow(/stale|foreign/i);
    const foreignRequest = requestFor(context.profile, context.manifest.entries[1]!, 1);
    expect(() =>
      boundary.buildNonDispatchingOpenAiRequestPlanV1({ ...base, request: foreignRequest }),
    ).toThrow();
    expect(() =>
      boundary.buildNonDispatchingOpenAiRequestPlanV1({
        ...base,
        corpusCapability: structuredClone(context.corpusCapability),
      }),
    ).toThrow(/cloned|forged/i);
    const overCapPreparation = mutableClone(prepared.executionPreparation);
    overCapPreparation.estimatedCostMicros = '100001';
    expect(() =>
      boundary.buildNonDispatchingOpenAiRequestPlanV1({
        ...base,
        executionPreparation: overCapPreparation,
      }),
    ).toThrow(/caps cannot fit/i);
  });

  it('exposes only a validate/describe/refuse stub and strictly redacted telemetry', async () => {
    const context = await loadedContext();
    const entry = context.manifest.entries[0]!;
    const prepared = executionPreparationFor(context);
    const plan = boundary.buildNonDispatchingOpenAiRequestPlanV1({
      profile: context.profile,
      corpusCapability: context.corpusCapability,
      request: prepared.request,
      fixtureId: entry.fixtureId,
      manualControl: releasedManualControlFor(context.authorization),
      executionPreparation: prepared.executionPreparation,
    });
    const adapter = boundary.createNonNetworkingOpenAiAdapterStubV1();
    for (const internalAuthorityExport of [
      'REAL_MODEL_BENCHMARK_STATIC_CORPUS_SOURCE_REGISTRY_V1',
      'loadTrustedRealModelBenchmarkCorpusV1',
      'requireTrustedRealModelBenchmarkCorpusStateV1',
      'claimTrustedRealModelBenchmarkPlanKeyV1',
      'buildNonDispatchingOpenAiRequestPlanV1',
      'inspectNonDispatchingOpenAiRequestPlanSafetyV1',
      'materializeOpenAiSceneAnalysisProposalFromPrivatePlanV1',
      'createNonNetworkingOpenAiAdapterStubV1',
      'setOpenAiBenchmarkConfiguration',
      'injectOpenAiBenchmarkCorpusOrClient',
    ]) {
      expect(publicBannerAi).not.toHaveProperty(internalAuthorityExport);
    }
    expect(
      Object.keys(publicBannerAi).filter(
        (exportName) =>
          /(?:openai|realmodelbenchmark)/iu.test(exportName) &&
          /(?:registry|loader|setter|inject|^build|^load|^set)/iu.test(exportName),
      ),
    ).toEqual([]);
    expect('dispatch' in adapter).toBe(false);
    expect(adapter.describe(plan)).toMatchObject({
      providerKey: 'openai',
      imageDetail: 'original',
      strictJsonSchema: true,
      dispatchAuthority: false,
    });
    expect(() => adapter.refuse(plan)).toThrow(/cannot dispatch|network/i);

    const telemetry = boundary.createRedactedOpenAiBenchmarkTelemetryV1({
      runOrdinal: 1,
      status: 'refused',
      counts: { attemptedCalls: 0, successfulRuns: 0, failedAttempts: 0 },
      latencyMs: 0,
      exactCostMicros: '0',
      errorCode: 'internal-refusal',
    });
    const serialized = JSON.stringify(telemetry);
    expect(serialized).not.toContain('data:image');
    expect(serialized).not.toContain('Synthetic text');
    expect(serialized).not.toContain('You are the scene-analysis');
    expect(serialized).not.toContain(context.manifest.entries[0]!.normalizedTransmission.sha256);
    const telemetryInput = {
      runOrdinal: 1 as const,
      status: 'refused' as const,
      counts: { attemptedCalls: 0, successfulRuns: 0, failedAttempts: 0 },
      latencyMs: 0,
      exactCostMicros: '0',
      errorCode: 'internal-refusal' as const,
    };
    for (const sensitiveExtra of [
      { opaqueCorrelationId: 'caller-controlled-correlation' },
      { rawError: 'provider body or stack' },
      { authorizationHeader: 'Bearer secret' },
      { headers: { authorization: 'Bearer secret' } },
      { promptBody: 'canonical prompt must not enter telemetry' },
      { filename: 'private-banner.png' },
      { sourceSha256: 'f'.repeat(64) },
    ]) {
      expect(() =>
        boundary.createRedactedOpenAiBenchmarkTelemetryV1({
          ...telemetryInput,
          ...sensitiveExtra,
        }),
      ).toThrow();
    }
    expect(() =>
      boundary.createRedactedOpenAiBenchmarkTelemetryV1({
        ...telemetryInput,
        runOrdinal: 1,
        imageBytes: 'sensitive',
      }),
    ).toThrow();
  });
});

describe('strict provider-output proposal parsing', () => {
  it('publishes a detached deeply frozen JSON Schema projection', () => {
    const assertRecursivelyFrozen = (value: unknown, seen = new WeakSet<object>()): void => {
      if (value === null || typeof value !== 'object' || seen.has(value)) return;
      seen.add(value);
      expect(Object.isFrozen(value)).toBe(true);
      for (const nested of Object.values(value)) assertRecursivelyFrozen(nested, seen);
    };
    const first = createDetachedOpenAiSceneAnalysisOcrJsonSchemaV1();
    const second = createDetachedOpenAiSceneAnalysisOcrJsonSchemaV1();
    assertRecursivelyFrozen(OPENAI_SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_V1);
    assertRecursivelyFrozen(first);
    assertRecursivelyFrozen(second);
    expect(first).not.toBe(second);

    const firstProperties = (first as { readonly properties: object }).properties;
    const secondProperties = (second as { readonly properties: object }).properties;
    expect(firstProperties).not.toBe(secondProperties);
    expect(Reflect.set(firstProperties, '__tampered', true)).toBe(false);
    expect(firstProperties).not.toHaveProperty('__tampered');

    for (const projection of [OPENAI_SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_V1, first, second]) {
      expect(sha256Hex(Buffer.from(canonicalizeJson(projection), 'utf8'))).toBe(
        OPENAI_SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_SHA256,
      );
    }
    expect(PROPOSED_OPENAI_RESPONSES_REQUEST_CONTRACT_V1.structuredOutput.schemaSha256).toBe(
      OPENAI_SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_SHA256,
    );
  });

  it('materializes only behind a private plan with observed identity and oracle-bound OCR completion', async () => {
    const context = await loadedContext('zero');
    const entry = context.manifest.entries[0]!;
    const prepared = executionPreparationFor(context);
    const request = prepared.request;
    const plan = boundary.buildNonDispatchingOpenAiRequestPlanV1({
      profile: context.profile,
      corpusCapability: context.corpusCapability,
      request,
      fixtureId: entry.fixtureId,
      manualControl: releasedManualControlFor(context.authorization),
      executionPreparation: prepared.executionPreparation,
    });
    const parts = [
      {
        partKey: 'background',
        label: 'Background',
        role: 'background',
        bounds: { xBps: 0, yBps: 0, widthBps: 10_000, heightBps: 10_000 },
      },
      {
        partKey: 'subject',
        label: 'Subject',
        role: 'subject',
        bounds: { xBps: 1_000, yBps: 1_000, widthBps: 4_000, heightBps: 7_000 },
      },
      {
        partKey: 'copy',
        label: 'Copy',
        role: 'text',
        bounds: { xBps: 5_000, yBps: 2_000, widthBps: 4_000, heightBps: 2_000 },
      },
    ] as const;
    const output = {
      outputVersion: 1 as const,
      visibleContentConstraint: 'only-directly-visible-objects-and-text' as const,
      composition: {
        kind: 'composition_proposal' as const,
        proposalVersion: 1 as const,
        sourceAssetSha256: entry.normalizedTransmission.sha256,
        parts,
      },
      layerEvidence: parts.map((part) => ({
        partKey: part.partKey,
        observationBasis: 'directly-visible-in-source-image' as const,
        confidence: { unit: 'basis-points' as const, valueBps: 8_000 },
        reviewFlags: [],
      })),
      ocrCompletion: {
        kind: 'visible-text-observations-complete' as const,
        observationCount: entry.expectedOracle.expectedTextOccurrences.length,
      },
      textObservations: entry.expectedOracle.expectedTextOccurrences.map((observation, index) => ({
        observationVersion: 1 as const,
        observationId: `test_only_observation_${index + 1}`,
        text: {
          kind: 'observed-text' as const,
          value: observation.normalizedText,
          normalization: 'unicode-nfc-single-space-v1' as const,
          contentTrust: 'untrusted-user-image-content' as const,
          instructionAuthority: 'none' as const,
        },
        boundingBox: observation.boundingBox,
        confidence: { unit: 'basis-points' as const, valueBps: 8_000 },
      })),
      reviewFlags: [],
      humanReview: {
        required: true as const,
        proposalOnly: true as const,
        automaticCutoutExportOrOtherDecisionAuthority: 'none' as const,
      },
    };
    expect(OpenAiProposedSceneAnalysisOcrOutputV1Schema.parse(output)).toEqual(output);
    const observedCore = {
      identityEvidenceVersion: 1 as const,
      providerKey: 'openai' as const,
      requestedModelId: 'gpt-5.6-terra' as const,
      observedProviderModelVersion:
        context.authorization.authorizedObservedIdentityEvidence.observedProviderModelVersion,
      observedProviderFingerprint:
        context.authorization.authorizedObservedIdentityEvidence.observedProviderFingerprint,
      responseObservedAt: '2026-07-13T00:00:00.000Z',
    };
    const observedIdentityFor = (
      overrides: Partial<{
        readonly observedProviderModelVersion: string;
        readonly observedProviderFingerprint: string;
        readonly responseObservedAt: string;
      }> = {},
    ) => {
      const core = { ...observedCore, ...overrides };
      return {
        ...core,
        responseIdentityEvidenceSha256: digestOpenAiExecutionObservedIdentityV1(core),
      };
    };
    const executionObservedIdentity = observedIdentityFor();
    const materialized = boundary.materializeOpenAiSceneAnalysisProposalFromPrivatePlanV1({
      plan,
      jsonText: JSON.stringify(output),
      executionObservedIdentity,
    });
    expect(materialized.textObservations.provenance).toMatchObject({
      evidenceRole: 'model-produced-actual',
      sourceAssetSha256: entry.normalizedTransmission.sha256,
      requestIdentity: request.requestIdentity,
      model: request.input.model,
      prompt: request.input.prompt,
      workflow: request.input.workflow,
    });
    expect(materialized.decisionAuthority).toBe('proposal-requires-user-review');

    expect(() =>
      boundary.materializeOpenAiSceneAnalysisProposalFromPrivatePlanV1({
        plan: structuredClone(plan),
        jsonText: JSON.stringify(output),
        executionObservedIdentity,
      }),
    ).toThrow(/cloned|forged/i);
    expect(() =>
      boundary.materializeOpenAiSceneAnalysisProposalFromPrivatePlanV1({
        plan,
        jsonText: JSON.stringify(output),
        executionObservedIdentity: undefined,
      }),
    ).toThrow();
    expect(() =>
      boundary.materializeOpenAiSceneAnalysisProposalFromPrivatePlanV1({
        plan,
        jsonText: JSON.stringify(output),
        executionObservedIdentity: observedIdentityFor({
          observedProviderModelVersion: 'mismatched-version.invalid',
        }),
      }),
    ).toThrow(/absent|mismatched/i);
    expect(() =>
      boundary.materializeOpenAiSceneAnalysisProposalFromPrivatePlanV1({
        plan,
        jsonText: JSON.stringify(output),
        executionObservedIdentity: observedIdentityFor({
          observedProviderFingerprint: 'mismatched-fingerprint.invalid',
        }),
      }),
    ).toThrow(/absent|mismatched/i);
    expect(() =>
      boundary.materializeOpenAiSceneAnalysisProposalFromPrivatePlanV1({
        plan,
        jsonText: JSON.stringify(output),
        executionObservedIdentity: observedIdentityFor({
          responseObservedAt: '2100-01-01T00:00:00.000Z',
        }),
      }),
    ).toThrow(/authorization|future|timestamp|window/i);

    expect(() =>
      boundary.materializeOpenAiSceneAnalysisProposalFromPrivatePlanV1({
        plan,
        jsonText: JSON.stringify({ ...output, providerKey: 'openai' }),
        executionObservedIdentity,
      }),
    ).toThrow();
    expect(() =>
      boundary.materializeOpenAiSceneAnalysisProposalFromPrivatePlanV1({
        plan,
        jsonText: JSON.stringify({ ...output, textObservations: undefined }),
        executionObservedIdentity,
      }),
    ).toThrow();
    expect(() =>
      boundary.materializeOpenAiSceneAnalysisProposalFromPrivatePlanV1({
        plan,
        jsonText: JSON.stringify({ ...output, ocrCompletion: undefined }),
        executionObservedIdentity,
      }),
    ).toThrow();
    expect(() =>
      boundary.materializeOpenAiSceneAnalysisProposalFromPrivatePlanV1({
        plan,
        jsonText: '{not-json',
        executionObservedIdentity,
      }),
    ).toThrow(/valid JSON/i);
    expect(() =>
      boundary.materializeOpenAiSceneAnalysisProposalFromPrivatePlanV1({
        plan,
        jsonText: JSON.stringify({
          ...output,
          ocrCompletion: { kind: 'no-visible-text-observed', observationCount: 0 },
          textObservations: [],
        }),
        executionObservedIdentity,
      }),
    ).toThrow(/oracle/i);
  });
});
