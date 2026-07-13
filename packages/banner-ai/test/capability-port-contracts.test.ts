import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  AtomicSuccessCommitRequestSchema,
  AtomicSuccessCommitResultSchema,
  AtomicUsageReservationCommandSchema,
  AtomicUsageReservationResultSchema,
  AttemptFailureCommitRequestSchema,
  AttemptFailureCommitResultSchema,
  AuthoritativeWorkflowExecutionSchema,
  BannerExportRequestSchema,
  CancellationRequestResultSchema,
  CancellationRequestSchema,
  CheckpointCommitRequestSchema,
  CheckpointCommitResultSchema,
  CompositionAnalysisRequestV1Schema,
  ExportReproductionManifestV1Schema,
  ExtractedLayerResultV1Schema,
  GdnValidationRequestSchema,
  GdnValidationResultSchema,
  HeartbeatAttemptCommandSchema,
  HeartbeatDecisionSchema,
  INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
  LayerExtractionRequestV1Schema,
  LeaseAttemptCommandSchema,
  LeaseAttemptResultSchema,
  ProviderUsageFinalizationCommandSchema,
  ProviderUsageFinalizationResultSchema,
  RunningProgressCommitRequestSchema,
  WorkflowExecutionInvocationSchema,
  WorkflowDefinitionV1Schema,
  WorkflowVersionContractSchema,
  byteSourceFrom,
  canonicalizeJson,
  collectSceneAssetReferences,
  compositionAnalysisRequestSha256,
  createDeterministicFakeZipArtifact,
  createFixtureUsageReservationIdentity,
  createStructuredJobError,
  decideErrorRetry,
  computeWorkflowDefinitionSha256,
  normalizeRasterUpload,
  operationRequestSha256,
  parseCapabilityCallContext,
  parseCapabilityEstimate,
  projectCanonicalOperationRequest,
  sha256BannerScene,
  sha256Hex,
  startedUsageFinalizationAuthority,
  validateBannerExportResult,
  validateAtomicSuccessCommitResult,
  validateAtomicUsageReservationResult,
  validateAttemptFailureCommitResult,
  validateCancellationRequestResult,
  validateCheckpointCommitRequest,
  validateCheckpointCommitResult,
  validateCompositionAnalysisResponseV1,
  validateExtractedLayerResultV1,
  validateHeartbeatDecision,
  validateInternalGdnValidationResult,
  validateLeaseAttemptResult,
  validateProviderUsageFinalizationResult,
  validateRunningProgressCommitResult,
  type AssetVersionRefV1,
  type CapabilityRequestSha256,
  type ExistingUsageIdentity,
} from '../src/index.js';
import { loadAngelInput } from './fixture.js';

const workspaceId = '10000000-0000-4000-8000-000000000001';
const projectId = '20000000-0000-4000-8000-000000000001';
const actorId = '30000000-0000-4000-8000-000000000001';
const jobId = '40000000-0000-4000-8000-000000000001';
const attemptId = '50000000-0000-4000-8000-000000000001';
const sourceAssetVersionId = '60000000-0000-4000-8000-000000000001';
const outputId = '70000000-0000-4000-8000-000000000001';
const usageId = '80000000-0000-4000-8000-000000000001';
const sceneVersionId = '90000000-0000-4000-8000-000000000001';
const leaseToken = 'a0000000-0000-4000-8000-000000000001';
const requestId = 'request.phase1a:0001';
const sourceSha256 = '1'.repeat(64);

const cancellation = Object.freeze({
  cancelled: false,
  throwIfCancelled(): void {},
});

const proposal = {
  kind: 'composition_proposal',
  proposalVersion: 1,
  sourceAssetSha256: sourceSha256,
  parts: [
    {
      partKey: 'part.body',
      label: 'Body',
      role: 'subject',
      bounds: { xBps: 1_000, yBps: 1_000, widthBps: 8_000, heightBps: 8_000 },
    },
  ],
} as const;

const proposalSha256 = sha256Hex(Buffer.from(canonicalizeJson(proposal), 'utf8'));

const sourceAsset = {
  assetId: 'asset_source_0001',
  assetVersionId: 'asset_version_source_0001',
  sha256: sourceSha256,
  mediaType: 'image/png',
  byteSize: 100,
  pixelWidth: 300,
  pixelHeight: 250,
} as const;

const analysisRequest = {
  sourceAsset,
  maxParts: 1,
  includeBackground: false,
} as const;

const analysisCapabilityRequestSha256 = compositionAnalysisRequestSha256(analysisRequest);

const makeNormalizedPng = async (width = 2, height = 2) => {
  const source = await sharp({
    create: { width, height, channels: 4, background: { r: 40, g: 80, b: 120, alpha: 0.5 } },
  })
    .png()
    .toBuffer();
  return normalizeRasterUpload({
    bytes: byteSourceFrom(source),
    declaredMediaType: 'image/png',
    filename: 'synthetic.png',
  });
};

const createExportWorkflow = () => {
  const definition = WorkflowDefinitionV1Schema.parse({
    definitionVersion: 1,
    workflowKey: 'banner.export',
    steps: [
      {
        stepKey: 'scene-load',
        kind: 'scene_load',
        weightBps: 2_000,
        replaySafe: true,
        externalIdempotency: 'none',
      },
      {
        stepKey: 'deterministic-export',
        kind: 'deterministic_export',
        weightBps: 6_000,
        replaySafe: true,
        externalIdempotency: 'job-step-call-v1',
      },
      {
        stepKey: 'atomic-persistence',
        kind: 'atomic_persistence',
        weightBps: 2_000,
        replaySafe: true,
        externalIdempotency: 'none',
      },
    ],
    outputs: [
      {
        outputKey: 'export.artifact',
        kind: 'export_artifact',
        disposition: 'final',
        producingStepKey: 'atomic-persistence',
        replaySafe: true,
      },
    ],
    policy: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definition.policy,
  });
  return WorkflowVersionContractSchema.parse({
    workflowVersionId: 'c0000000-0000-4000-8000-000000000001',
    workflowVersion: 1,
    definitionSha256: computeWorkflowDefinitionSha256(definition),
    definition,
  });
};

const replaceAssetMetadata = (
  reference: Record<string, unknown>,
  normalized: Awaited<ReturnType<typeof makeNormalizedPng>>,
): void => {
  reference['sha256'] = normalized.sha256;
  reference['mediaType'] = 'image/png';
  reference['byteSize'] = normalized.byteSize;
  reference['pixelWidth'] = normalized.width;
  reference['pixelHeight'] = normalized.height;
};

const createExportFixture = async () => {
  const normalized = await makeNormalizedPng(300, 250);
  const input = structuredClone(loadAngelInput()) as Record<string, unknown>;
  replaceAssetMetadata(input['sourceAsset'] as Record<string, unknown>, normalized);
  const canvas = input['canvas'] as Record<string, unknown>;
  const background = canvas['background'] as Record<string, unknown>;
  replaceAssetMetadata(background['asset'] as Record<string, unknown>, normalized);
  for (const layer of input['layers'] as Array<Record<string, unknown>>) {
    replaceAssetMetadata(layer['asset'] as Record<string, unknown>, normalized);
  }
  const scene = (await import('../src/index.js')).BannerSceneV1Schema.parse(input);
  const references = new Map<string, AssetVersionRefV1>();
  for (const { reference } of collectSceneAssetReferences(scene)) {
    references.set(reference.assetVersionId, reference);
  }
  const assets = [...references.values()].map((reference) => ({
    bytes: normalized.bytes,
    reference,
  }));
  const fakeArtifact = await createDeterministicFakeZipArtifact({ scene, assets });
  const artifact = {
    byteSize: fakeArtifact.byteSize,
    bytes: fakeArtifact.bytes,
    mediaType: fakeArtifact.mediaType,
    sha256: fakeArtifact.sha256,
    validationLabel: fakeArtifact.validationLabel,
  } as const;
  const sceneWorkflow = {
    workflowVersionId: 'b0000000-0000-4000-8000-000000000001',
    workflowVersion: 1,
    definitionSha256: '2'.repeat(64),
  } as const;
  const exportWorkflowContract = createExportWorkflow();
  const exportWorkflow = {
    workflowVersionId: exportWorkflowContract.workflowVersionId,
    workflowVersion: exportWorkflowContract.workflowVersion,
    definitionSha256: exportWorkflowContract.definitionSha256,
  };
  const exporter = {
    exporterId: 'exporter_phase1a_0001',
    exporterVersion: 1,
    buildSha256: '4'.repeat(64),
  } as const;
  const manifest = ExportReproductionManifestV1Schema.parse({
    manifestVersion: 1,
    sceneVersionId,
    sceneRevision: 1,
    sceneEncoding: 'banner-scene-json-v1',
    sceneSha256: sha256BannerScene(scene),
    assetVersions: [...references.values()].sort((left, right) =>
      left.assetVersionId < right.assetVersionId ? -1 : 1,
    ),
    sceneWorkflow,
    exportWorkflow,
    exporter,
    validator: { kind: 'none' },
    output: {
      mediaType: 'application/zip',
      byteSize: artifact.byteSize,
      sha256: artifact.sha256,
    },
  });
  const request = BannerExportRequestSchema.parse({
    scene,
    sceneVersionId,
    sceneRevision: 1,
    sceneWorkflow,
    exportWorkflow,
    exporter,
    assets,
    deadlineAtMs: 60_000,
    cancellation,
  });
  return {
    artifact,
    assets,
    exporter,
    exportWorkflow,
    exportWorkflowContract,
    manifest,
    normalized,
    request,
    scene,
    sceneWorkflow,
  };
};

const analyzeCommand = {
  commandVersion: 1,
  projectId,
  operation: 'banner.analyze',
  workflowVersionId: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
  idempotencyKey: 'analyze.command:0001',
  sourceAssetVersionId,
  parameters: { maxParts: 5, includeBackground: true },
} as const;

const commandResolution = {
  workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
  inputAssets: [{ assetVersionId: sourceAssetVersionId, sha256: sourceSha256 }],
} as const;

const canonicalRequest = projectCanonicalOperationRequest(analyzeCommand, commandResolution);
const requestSha256 = operationRequestSha256(analyzeCommand, commandResolution);

const runningJob = () => ({
  jobId,
  workspaceId,
  projectId,
  initiatedByActorId: actorId,
  requestId,
  operation: 'banner.analyze' as const,
  workflowVersionId: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
  requestSha256,
  state: 'running' as const,
  progressBps: 1,
  attemptCount: 1,
  maxAttempts: 3 as const,
  providerCallCount: 0,
  maxProviderCalls: 64 as const,
  attemptTimeoutMs: 120_000 as const,
  jobTimeoutMs: 600_000 as const,
  nextAttemptAtMs: null,
  cancelRequestedAtMs: null,
  startedAtMs: 1_000,
  deadlineAtMs: 601_000,
  finishedAtMs: null,
  terminalError: null,
});

const runningAttempt = () => ({
  attemptId,
  workspaceId,
  jobId,
  attemptNumber: 1,
  state: 'running' as const,
  workerId: 'worker.local:1',
  leaseToken,
  leaseExpiresAtMs: 31_000,
  heartbeatAtMs: 1_000,
  startedAtMs: 1_000,
  finishedAtMs: null,
  error: null,
});

const executionAggregate = () => ({
  workspaceId,
  projectId,
  initiatedByActorId: actorId,
  requestId,
  request: canonicalRequest,
  requestSha256,
  workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
  job: runningJob(),
  attempt: runningAttempt(),
  attemptDeadlineAtMs: 121_000,
});

const commitAuthority = () => ({
  workspaceId,
  projectId,
  jobId,
  attemptId,
  attemptNumber: 1,
  requestSha256,
  workflowVersionId: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
  workflowVersion: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersion,
  workflowDefinitionSha256: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definitionSha256,
  currentLeaseToken: leaseToken,
  presentedLeaseToken: leaseToken,
  jobState: 'running' as const,
  attemptState: 'running' as const,
  cancelRequestedAtMs: null,
  nowMs: 2_000,
  leaseExpiresAtMs: 31_000,
  attemptDeadlineAtMs: 121_000,
  jobDeadlineAtMs: 601_000,
});

const finalAnalyzeOutput = () => ({
  outputId,
  workspaceId,
  projectId,
  jobId,
  attemptId,
  declaration: structuredClone(INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definition.outputs[1]!),
  contentSha256: proposalSha256,
  material: { kind: 'analysis_payload' as const, payload: structuredClone(proposal) },
});

describe('request-relative capability contracts', () => {
  it('binds analysis results to the exact source, maxParts, and background policy', () => {
    expect(CompositionAnalysisRequestV1Schema.parse(analysisRequest)).toEqual(analysisRequest);
    expect(
      validateCompositionAnalysisResponseV1({ request: analysisRequest, result: proposal }),
    ).toEqual(proposal);
    expect(
      validateCompositionAnalysisResponseV1({
        request: analysisRequest,
        result: {
          kind: 'no_useful_layers',
          proposalVersion: 1,
          sourceAssetSha256: sourceSha256,
          reason: 'flat_image',
        },
      }),
    ).toMatchObject({ kind: 'no_useful_layers' });
    for (const invalid of [
      { ...proposal, sourceAssetSha256: '2'.repeat(64) },
      { ...proposal, parts: [...proposal.parts, { ...proposal.parts[0], partKey: 'part.other' }] },
      {
        ...proposal,
        parts: [{ ...proposal.parts[0], partKey: 'part.background', role: 'background' }],
      },
      { ...proposal, unknown: true },
      {
        kind: 'no_useful_layers',
        proposalVersion: 1,
        sourceAssetSha256: '2'.repeat(64),
        reason: 'flat_image',
      },
    ]) {
      expect(() =>
        validateCompositionAnalysisResponseV1({ request: analysisRequest, result: invalid }),
      ).toThrow();
    }
  });

  it('strictly validates call context, exact bigint estimates, and extraction requests/results', async () => {
    const context = { deadlineAtMs: 60_000, externalIdempotencyKey: null, cancellation };
    expect(parseCapabilityCallContext(context)).toEqual(context);
    for (const invalid of [
      { ...context, deadlineAtMs: -1 },
      { ...context, externalIdempotencyKey: 'not-a-digest' },
      { ...context, cancellation: { cancelled: false } },
      { ...context, unknown: true },
    ]) {
      expect(() => parseCapabilityCallContext(invalid as never)).toThrow();
    }
    expect(parseCapabilityEstimate({ micros: 0n, currency: 'USD' })).toEqual({
      micros: 0n,
      currency: 'USD',
    });
    for (const micros of [-1n, 9_000_000_000_000_001n, 1]) {
      expect(() =>
        parseCapabilityEstimate({ micros: micros as bigint, currency: 'USD' }),
      ).toThrow();
    }

    expect(
      LayerExtractionRequestV1Schema.parse({
        sourceAsset,
        part: proposal.parts[0],
        trimTransparentPixels: true,
      }),
    ).toBeDefined();
    const normalized = await makeNormalizedPng();
    const result = {
      bytes: normalized.bytes,
      mediaType: 'image/png' as const,
      byteSize: normalized.byteSize,
      pixelWidth: normalized.width,
      pixelHeight: normalized.height,
      sha256: normalized.sha256,
    };
    expect(ExtractedLayerResultV1Schema.parse(result)).toEqual(result);
    await expect(validateExtractedLayerResultV1(result)).resolves.toEqual(result);
    const corrupt = Buffer.from(normalized.bytes);
    corrupt[corrupt.length - 8] = corrupt[corrupt.length - 8]! ^ 1;
    for (const invalid of [
      { ...result, byteSize: result.byteSize + 1 },
      { ...result, pixelWidth: result.pixelWidth + 1 },
      { ...result, sha256: 'f'.repeat(64) },
      { ...result, bytes: corrupt, sha256: sha256Hex(corrupt) },
      { ...result, unknown: true },
    ]) {
      await expect(validateExtractedLayerResultV1(invalid)).rejects.toThrow();
    }
  });
});

describe('manifest-bound exporter and internal non-GDN validator ports', () => {
  it('accepts only an artifact and manifest bound to exact scene/workflow/exporter bytes', async () => {
    const fixture = await createExportFixture();
    const result = { artifact: fixture.artifact, manifest: fixture.manifest };
    await expect(validateBannerExportResult({ request: fixture.request, result })).resolves.toEqual(
      result,
    );

    const mutations = [
      { artifact: { ...fixture.artifact, byteSize: fixture.artifact.byteSize + 1 } },
      { artifact: { ...fixture.artifact, sha256: 'f'.repeat(64) } },
      {
        manifest: { ...fixture.manifest, sceneVersionId: '90000000-0000-4000-8000-000000000002' },
      },
      {
        manifest: {
          ...fixture.manifest,
          exportWorkflow: { ...fixture.manifest.exportWorkflow, workflowVersion: 2 },
        },
      },
      {
        manifest: {
          ...fixture.manifest,
          exporter: { ...fixture.manifest.exporter, exporterVersion: 2 },
        },
      },
      { manifest: { ...fixture.manifest, validator: { kind: 'none' }, unknown: true } },
      {
        manifest: {
          ...fixture.manifest,
          output: { ...fixture.manifest.output, byteSize: fixture.artifact.byteSize + 1 },
        },
      },
    ];
    for (const mutation of mutations) {
      await expect(
        validateBannerExportResult({
          request: fixture.request,
          result: { ...result, ...mutation },
        }),
      ).rejects.toThrow();
    }
  });

  it('rederives validator ZIP identity and binds explicit profile/findings without a GDN claim', async () => {
    const fixture = await createExportFixture();
    const profile = {
      validatorProfileId: 'validator_profile_phase1a',
      validatorProfileVersion: 1,
      rulesSha256: '5'.repeat(64),
    } as const;
    const request = GdnValidationRequestSchema.parse({ artifact: fixture.artifact, profile });
    const result = {
      validationLabel: 'internal-provider-free-not-gdn',
      artifactSha256: fixture.artifact.sha256,
      profile,
      outcome: 'internal-check-passed',
      findings: [],
    } as const;
    expect(validateInternalGdnValidationResult({ request, result })).toEqual(result);
    expect(GdnValidationResultSchema.parse(result).validationLabel).toBe(
      'internal-provider-free-not-gdn',
    );

    const wrongBytes = Buffer.from(fixture.artifact.bytes);
    wrongBytes[0] = wrongBytes[0]! ^ 1;
    for (const invalidRequest of [
      { ...request, artifact: { ...request.artifact, bytes: wrongBytes } },
      { ...request, artifact: { ...request.artifact, byteSize: request.artifact.byteSize + 1 } },
      { ...request, artifact: { ...request.artifact, sha256: 'f'.repeat(64) } },
      {
        ...request,
        artifact: { ...request.artifact, mediaType: 'image/png', pixelWidth: 1, pixelHeight: 1 },
      },
      { ...request, unknown: true },
    ]) {
      expect(GdnValidationRequestSchema.safeParse(invalidRequest).success).toBe(false);
    }
    for (const invalidResult of [
      { ...result, artifactSha256: 'f'.repeat(64) },
      { ...result, profile: { ...profile, validatorProfileVersion: 2 } },
      { ...result, validationLabel: 'gdn-valid' },
      { ...result, outcome: 'internal-check-failed' },
      {
        ...result,
        findings: [
          {
            ruleCode: 'REMOTE_DEPENDENCY',
            severity: 'error',
            message: 'Remote dependency was rejected.',
            entryPath: 'index.html',
          },
        ],
      },
      { ...result, unknown: true },
    ]) {
      expect(() =>
        validateInternalGdnValidationResult({ request, result: invalidResult }),
      ).toThrow();
    }
  });
});

describe('authoritative execution and atomic repository command contracts', () => {
  it('derives strict monotonic running progress from the completed workflow step', () => {
    const request = {
      authority: commitAuthority(),
      workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
      completedStepKey: 'source-load',
      expectedCurrentProgressBps: 1,
    } as const;
    const advancedJob = { ...runningJob(), progressBps: 1_000 };
    expect(
      validateRunningProgressCommitResult({
        request,
        result: { kind: 'advanced', job: advancedJob },
      }),
    ).toEqual({ kind: 'advanced', job: advancedJob });

    const fixtureRequest = {
      ...request,
      completedStepKey: 'fixture-analysis',
      expectedCurrentProgressBps: 1_000,
    } as const;
    const fixtureJob = { ...runningJob(), progressBps: 7_000 };
    expect(
      validateRunningProgressCommitResult({
        request: fixtureRequest,
        result: { kind: 'advanced', job: fixtureJob },
      }),
    ).toEqual({ kind: 'advanced', job: fixtureJob });

    const retryReplayRequest = {
      ...request,
      expectedCurrentProgressBps: 7_000,
    } as const;
    const retainedJob = { ...runningJob(), progressBps: 7_000 };
    expect(
      validateRunningProgressCommitResult({
        request: retryReplayRequest,
        result: { kind: 'unchanged', job: retainedJob },
      }),
    ).toEqual({ kind: 'unchanged', job: retainedJob });

    const validationRequest = {
      ...request,
      completedStepKey: 'output-validation',
      expectedCurrentProgressBps: 7_000,
    } as const;
    expect(
      validateRunningProgressCommitResult({
        request: validationRequest,
        result: { kind: 'advanced', job: { ...runningJob(), progressBps: 8_500 } },
      }).job.progressBps,
    ).toBe(8_500);
  });

  it('rejects caller-selected, skipped, stale, cancelled, expired, and terminal progress writes', () => {
    const request = {
      authority: commitAuthority(),
      workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
      completedStepKey: 'fixture-analysis',
      expectedCurrentProgressBps: 1_000,
    } as const;
    for (const invalid of [
      { ...request, completedStepKey: 'missing-step' },
      { ...request, completedStepKey: 'atomic-persistence', expectedCurrentProgressBps: 8_500 },
      { ...request, completedStepKey: 'output-validation' },
      { ...request, expectedCurrentProgressBps: 2 },
      {
        ...request,
        authority: {
          ...commitAuthority(),
          currentLeaseToken: 'a0000000-0000-4000-8000-000000000002',
        },
      },
      { ...request, authority: { ...commitAuthority(), cancelRequestedAtMs: 1_999 } },
      { ...request, authority: { ...commitAuthority(), nowMs: 31_000 } },
      {
        ...request,
        authority: {
          ...commitAuthority(),
          workflowDefinitionSha256: 'f'.repeat(64),
        },
      },
      { ...request, targetProgressBps: 7_000 },
    ]) {
      expect(RunningProgressCommitRequestSchema.safeParse(invalid).success).toBe(false);
    }

    const advancedJob = { ...runningJob(), progressBps: 7_000 };
    for (const invalidResult of [
      { kind: 'unchanged', job: advancedJob },
      { kind: 'advanced', job: { ...advancedJob, progressBps: 6_999 } },
      { kind: 'advanced', job: { ...advancedJob, attemptCount: 2 } },
      { kind: 'advanced', job: { ...advancedJob, cancelRequestedAtMs: 2_000 } },
      {
        kind: 'advanced',
        job: { ...advancedJob, workspaceId: '10000000-0000-4000-8000-000000000002' },
      },
      { kind: 'advanced', job: { ...advancedJob, unknown: true } },
    ]) {
      expect(() =>
        validateRunningProgressCommitResult({ request, result: invalidResult }),
      ).toThrow();
    }
  });

  it('accepts one persisted aggregate and rejects every workspace/project/actor/request/job/attempt mutation', () => {
    const aggregate = executionAggregate();
    expect(AuthoritativeWorkflowExecutionSchema.parse(aggregate)).toBeDefined();
    const invocation = {
      context: { actorId, workspaceId, requestId },
      execution: aggregate,
    };
    expect(WorkflowExecutionInvocationSchema.parse(invocation)).toBeDefined();
    for (const invalidContext of [
      { ...invocation.context, actorId: '30000000-0000-4000-8000-000000000002' },
      { ...invocation.context, workspaceId: '10000000-0000-4000-8000-000000000002' },
      { ...invocation.context, requestId: 'request.phase1a:0002' },
      { ...invocation.context, actorId: 'actor_opaque_0001' },
    ]) {
      expect(
        WorkflowExecutionInvocationSchema.safeParse({ ...invocation, context: invalidContext })
          .success,
      ).toBe(false);
    }

    const mutations: Array<(value: Record<string, unknown>) => void> = [
      (value) => {
        value['workspaceId'] = '10000000-0000-4000-8000-000000000002';
      },
      (value) => {
        value['projectId'] = '20000000-0000-4000-8000-000000000002';
      },
      (value) => {
        value['initiatedByActorId'] = '30000000-0000-4000-8000-000000000002';
      },
      (value) => {
        value['requestId'] = 'request.phase1a:0002';
      },
      (value) => {
        value['requestSha256'] = 'f'.repeat(64);
      },
      (value) => {
        value['attemptDeadlineAtMs'] = 120_999;
      },
      (value) => {
        (value['job'] as Record<string, unknown>)['operation'] = 'banner.export';
      },
      (value) => {
        (value['job'] as Record<string, unknown>)['workflowVersionId'] =
          'b0000000-0000-4000-8000-000000000001';
      },
      (value) => {
        (value['job'] as Record<string, unknown>)['requestSha256'] = 'f'.repeat(64);
      },
      (value) => {
        (value['job'] as Record<string, unknown>)['state'] = 'failed';
      },
      (value) => {
        (value['attempt'] as Record<string, unknown>)['workspaceId'] =
          '10000000-0000-4000-8000-000000000002';
      },
      (value) => {
        (value['attempt'] as Record<string, unknown>)['jobId'] =
          '40000000-0000-4000-8000-000000000002';
      },
      (value) => {
        (value['attempt'] as Record<string, unknown>)['attemptNumber'] = 2;
      },
      (value) => {
        (value['attempt'] as Record<string, unknown>)['state'] = 'failed';
      },
      (value) => {
        const request = value['request'] as Record<string, unknown>;
        (request['parameters'] as Record<string, unknown>)['maxParts'] = 4;
      },
      (value) => {
        value['unknown'] = true;
      },
    ];
    for (const mutate of mutations) {
      const value = structuredClone(aggregate) as unknown as Record<string, unknown>;
      mutate(value);
      expect(AuthoritativeWorkflowExecutionSchema.safeParse(value).success).toBe(false);
    }
  });

  it('commits a checkpoint only when authority, workflow, declaration, material, and result match', async () => {
    const declaration = INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definition.outputs.find(
      (output) => output.disposition === 'checkpoint',
    )!;
    const checkpoint = {
      workspaceId,
      projectId,
      jobId,
      attemptId,
      requestSha256,
      workflow: {
        workflowVersionId: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
        workflowVersion: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersion,
        definitionSha256: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definitionSha256,
      },
      output: declaration,
      reference: { kind: 'analysis_payload' as const },
      payload: proposal,
      contentSha256: proposalSha256,
    };
    const material = {
      kind: 'analysis_payload' as const,
      workspaceId,
      projectId,
      jobId,
      declaredContentSha256: proposalSha256,
      payload: proposal,
    };
    const request = {
      authority: commitAuthority(),
      workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
      checkpoint,
      material,
    };
    expect(CheckpointCommitRequestSchema.parse(request)).toBeDefined();
    await expect(validateCheckpointCommitRequest(request)).resolves.toBeDefined();
    expect(CheckpointCommitResultSchema.parse(checkpoint)).toBeDefined();
    await expect(validateCheckpointCommitResult({ request, result: checkpoint })).resolves.toEqual(
      checkpoint,
    );

    for (const invalid of [
      {
        ...request,
        authority: {
          ...request.authority,
          presentedLeaseToken: 'a0000000-0000-4000-8000-000000000002',
        },
      },
      { ...request, authority: { ...request.authority, cancelRequestedAtMs: 2_000 } },
      { ...request, authority: { ...request.authority, nowMs: 31_000 } },
      {
        ...request,
        checkpoint: {
          ...checkpoint,
          workspaceId: '10000000-0000-4000-8000-000000000002',
        },
      },
      {
        ...request,
        checkpoint: { ...checkpoint, projectId: '20000000-0000-4000-8000-000000000002' },
      },
      {
        ...request,
        checkpoint: { ...checkpoint, jobId: '40000000-0000-4000-8000-000000000002' },
      },
      {
        ...request,
        checkpoint: { ...checkpoint, attemptId: '50000000-0000-4000-8000-000000000002' },
      },
      { ...request, checkpoint: { ...checkpoint, requestSha256: 'f'.repeat(64) } },
      {
        ...request,
        checkpoint: {
          ...checkpoint,
          workflow: { ...checkpoint.workflow, workflowVersion: 2 },
        },
      },
      {
        ...request,
        checkpoint: { ...checkpoint, output: { ...declaration, replaySafe: false } },
      },
      {
        ...request,
        checkpoint: {
          ...checkpoint,
          reference: {
            kind: 'asset_version',
            assetVersionId: '60000000-0000-4000-8000-000000000002',
          },
        },
      },
      { ...request, checkpoint: { ...checkpoint, contentSha256: 'f'.repeat(64) } },
      {
        ...request,
        checkpoint: {
          ...checkpoint,
          payload: { ...proposal, sourceAssetSha256: 'f'.repeat(64) },
        },
      },
      {
        ...request,
        material: { ...material, workspaceId: '10000000-0000-4000-8000-000000000002' },
      },
      { ...request, material: { ...material, declaredContentSha256: 'f'.repeat(64) } },
      {
        ...request,
        material: { ...material, payload: { ...proposal, sourceAssetSha256: 'f'.repeat(64) } },
      },
      { ...request, material: { ...material, unknown: true } },
    ]) {
      expect(CheckpointCommitRequestSchema.safeParse(invalid).success).toBe(false);
      await expect(validateCheckpointCommitRequest(invalid)).rejects.toThrow();
    }
    await expect(
      validateCheckpointCommitResult({
        request,
        result: { ...checkpoint, contentSha256: 'f'.repeat(64) },
      }),
    ).rejects.toThrow();
  });

  it('binds all required finals to one live lease and an atomic job/attempt success result', () => {
    const request = {
      authority: commitAuthority(),
      workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
      finalOutputs: [finalAnalyzeOutput()],
    };
    expect(AtomicSuccessCommitRequestSchema.parse(request)).toBeDefined();
    for (const invalid of [
      { ...request, finalOutputs: [] },
      { ...request, finalOutputs: [finalAnalyzeOutput(), finalAnalyzeOutput()] },
      {
        ...request,
        finalOutputs: [
          { ...finalAnalyzeOutput(), workspaceId: '10000000-0000-4000-8000-000000000002' },
        ],
      },
      {
        ...request,
        finalOutputs: [{ ...finalAnalyzeOutput(), contentSha256: 'f'.repeat(64) }],
      },
      {
        ...request,
        finalOutputs: [
          {
            ...finalAnalyzeOutput(),
            declaration: { ...finalAnalyzeOutput().declaration, outputKey: 'analysis.wrong' },
          },
        ],
      },
      {
        ...request,
        authority: {
          ...commitAuthority(),
          presentedLeaseToken: 'a0000000-0000-4000-8000-000000000002',
        },
      },
      { ...request, authority: { ...commitAuthority(), cancelRequestedAtMs: 1_999 } },
      { ...request, authority: { ...commitAuthority(), nowMs: 31_000 } },
      { ...request, unknown: true },
    ]) {
      expect(AtomicSuccessCommitRequestSchema.safeParse(invalid).success).toBe(false);
    }

    const succeededJob = {
      ...runningJob(),
      state: 'succeeded' as const,
      progressBps: 10_000,
      finishedAtMs: 3_000,
    };
    const succeededAttempt = {
      ...runningAttempt(),
      state: 'succeeded' as const,
      finishedAtMs: 3_000,
    };
    const result = {
      job: succeededJob,
      attempt: succeededAttempt,
      finalOutputs: [finalAnalyzeOutput()],
    };
    expect(validateAtomicSuccessCommitResult({ request, result })).toEqual(result);
    expect(
      AtomicSuccessCommitResultSchema.safeParse({
        job: { ...succeededJob, progressBps: 9_999 },
        attempt: succeededAttempt,
        finalOutputs: [finalAnalyzeOutput()],
      }).success,
    ).toBe(false);
    expect(() =>
      validateAtomicSuccessCommitResult({
        request,
        result: {
          ...result,
          job: { ...succeededJob, jobId: '40000000-0000-4000-8000-000000000002' },
        },
      }),
    ).toThrow();
    expect(() =>
      validateAtomicSuccessCommitResult({
        request,
        result: { ...result, finalOutputs: [] },
      }),
    ).toThrow();
  });

  it('commits an export only with the strict manifest bound to the authoritative export workflow', async () => {
    const fixture = await createExportFixture();
    const authority = {
      ...commitAuthority(),
      workflowVersionId: fixture.exportWorkflowContract.workflowVersionId,
      workflowVersion: fixture.exportWorkflowContract.workflowVersion,
      workflowDefinitionSha256: fixture.exportWorkflowContract.definitionSha256,
    };
    const output = {
      outputId,
      workspaceId,
      projectId,
      jobId,
      attemptId,
      declaration: fixture.exportWorkflowContract.definition.outputs[0]!,
      contentSha256: fixture.artifact.sha256,
      material: {
        kind: 'export_artifact' as const,
        stagingToken: 'd0000000-0000-4000-8000-000000000001',
        sceneVersionId,
        sceneRevision: 1,
        scene: fixture.scene,
        sceneWorkflow: fixture.sceneWorkflow,
        exporter: fixture.exporter,
        mediaType: fixture.artifact.mediaType,
        byteSize: fixture.artifact.byteSize,
        sha256: fixture.artifact.sha256,
        pixelWidth: null,
        pixelHeight: null,
        manifest: fixture.manifest,
      },
    };
    const request = {
      authority,
      workflow: fixture.exportWorkflowContract,
      finalOutputs: [output],
    };
    expect(AtomicSuccessCommitRequestSchema.parse(request)).toBeDefined();
    for (const invalidOutput of [
      {
        ...output,
        material: {
          ...output.material,
          manifest: {
            ...output.material.manifest,
            exportWorkflow: {
              ...output.material.manifest.exportWorkflow,
              workflowVersionId: 'c0000000-0000-4000-8000-000000000002',
            },
          },
        },
      },
      {
        ...output,
        material: {
          ...output.material,
          manifest: {
            ...output.material.manifest,
            exportWorkflow: {
              ...output.material.manifest.exportWorkflow,
              workflowVersion: 2,
            },
          },
        },
      },
      {
        ...output,
        material: {
          ...output.material,
          manifest: {
            ...output.material.manifest,
            exportWorkflow: {
              ...output.material.manifest.exportWorkflow,
              definitionSha256: 'f'.repeat(64),
            },
          },
        },
      },
      {
        ...output,
        material: {
          ...output.material,
          manifest: { ...output.material.manifest, sceneSha256: 'f'.repeat(64) },
        },
      },
      {
        ...output,
        material: { ...output.material, sha256: 'f'.repeat(64) },
      },
    ]) {
      expect(
        AtomicSuccessCommitRequestSchema.safeParse({ ...request, finalOutputs: [invalidOutput] })
          .success,
      ).toBe(false);
    }
  });

  it('rederives failure targets/retry timing and exposes explicit cancellation/heartbeat schemas', () => {
    const error = createStructuredJobError('PROVIDER_RATE_LIMITED', 'Synthetic transient failure.');
    const decision = decideErrorRetry({
      error,
      workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
      stepKey: 'fixture-analysis',
      jobId,
      logicalCallNumber: 1,
      externalIdempotencyKey: null,
      currentAttemptNumber: 1,
      finishedAtMs: 10_000,
      jobDeadlineAtMs: 601_000,
      indeterminateProviderCall: false,
    });
    const request = {
      currentJob: runningJob(),
      currentAttempt: runningAttempt(),
      workspaceId,
      projectId,
      jobId,
      attemptId,
      currentLeaseToken: leaseToken,
      presentedLeaseToken: leaseToken,
      currentAttemptNumber: 1,
      finishedAtMs: 10_000,
      jobDeadlineAtMs: 601_000,
      cancelRequestedAtMs: null,
      workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
      stepKey: 'fixture-analysis',
      logicalCallNumber: 1,
      externalIdempotencyKey: null,
      indeterminateProviderCall: false,
      error,
      decision,
    };
    expect(AttemptFailureCommitRequestSchema.parse(request)).toBeDefined();
    if (decision.kind !== 'retry') throw new Error('Expected retry fixture decision.');
    const persistedError = {
      category: error.category,
      code: error.code,
      message: error.message,
    };
    const retryResult = {
      job: {
        ...runningJob(),
        state: 'retry_wait' as const,
        nextAttemptAtMs: decision.nextAttemptAtMs,
      },
      attempt: {
        ...runningAttempt(),
        state: decision.attemptState,
        finishedAtMs: 10_000,
        error: persistedError,
      },
    };
    expect(validateAttemptFailureCommitResult({ request, result: retryResult })).toEqual(
      retryResult,
    );
    expect(
      AttemptFailureCommitRequestSchema.safeParse({
        ...request,
        decision: { ...decision, nextAttemptAtMs: 10_999 },
      }).success,
    ).toBe(false);
    expect(
      AttemptFailureCommitRequestSchema.safeParse({
        ...request,
        presentedLeaseToken: 'a0000000-0000-4000-8000-000000000002',
      }).success,
    ).toBe(false);

    expect(
      CancellationRequestSchema.parse({
        context: { actorId, workspaceId, requestId },
        jobId,
        requestedAtMs: 2_000,
      }),
    ).toBeDefined();
    expect(
      CancellationRequestSchema.safeParse({
        context: { actorId: 'actor_opaque_0001', workspaceId, requestId },
        jobId,
        requestedAtMs: 2_000,
      }).success,
    ).toBe(false);
    expect(
      HeartbeatAttemptCommandSchema.parse({
        workspaceId,
        jobId,
        attemptId,
        leaseToken,
        nowMs: 10_000,
        currentHeartbeatAtMs: 1_000,
        currentLeaseExpiresAtMs: 31_000,
        attemptDeadlineAtMs: 121_000,
        jobDeadlineAtMs: 601_000,
      }),
    ).toBeDefined();
  });

  it('permits only the decision-derived failure transition and preserves both snapshots exactly', () => {
    const error = createStructuredJobError(
      'PROVIDER_REQUEST_REJECTED',
      'Synthetic permanent provider failure.',
    );
    const decision = decideErrorRetry({
      error,
      workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
      stepKey: 'fixture-analysis',
      jobId,
      logicalCallNumber: 1,
      externalIdempotencyKey: null,
      currentAttemptNumber: 1,
      finishedAtMs: 10_000,
      jobDeadlineAtMs: 601_000,
      indeterminateProviderCall: false,
    });
    if (decision.kind !== 'terminal') throw new Error('Expected terminal fixture decision.');
    const request = {
      currentJob: runningJob(),
      currentAttempt: runningAttempt(),
      workspaceId,
      projectId,
      jobId,
      attemptId,
      currentLeaseToken: leaseToken,
      presentedLeaseToken: leaseToken,
      currentAttemptNumber: 1,
      finishedAtMs: 10_000,
      jobDeadlineAtMs: 601_000,
      cancelRequestedAtMs: null,
      workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
      stepKey: 'fixture-analysis',
      logicalCallNumber: 1,
      externalIdempotencyKey: null,
      indeterminateProviderCall: false,
      error,
      decision,
    } as const;
    const persistedError = {
      category: error.category,
      code: error.code,
      message: error.message,
    };
    const result = {
      job: {
        ...runningJob(),
        state: 'failed' as const,
        finishedAtMs: 10_000,
        terminalError: persistedError,
      },
      attempt: {
        ...runningAttempt(),
        state: 'failed' as const,
        finishedAtMs: 10_000,
        error: persistedError,
      },
    };
    expect(AttemptFailureCommitResultSchema.parse(result)).toBeDefined();
    expect(validateAttemptFailureCommitResult({ request, result })).toEqual(result);

    for (const invalidRequest of [
      {
        ...request,
        currentJob: {
          ...request.currentJob,
          workspaceId: '10000000-0000-4000-8000-000000000002',
        },
      },
      {
        ...request,
        currentJob: { ...request.currentJob, deadlineAtMs: 602_000 },
      },
      {
        ...request,
        currentAttempt: {
          ...request.currentAttempt,
          leaseToken: 'a0000000-0000-4000-8000-000000000002',
        },
      },
      { ...request, currentAttempt: { ...request.currentAttempt, attemptNumber: 2 } },
      { ...request, currentJob: { ...request.currentJob, unknown: true } },
      { ...request, currentAttempt: { ...request.currentAttempt, unknown: true } },
    ]) {
      expect(AttemptFailureCommitRequestSchema.safeParse(invalidRequest).success).toBe(false);
    }

    const jobMutations: Array<(value: Record<string, unknown>) => void> = [
      (value) => void (value['workspaceId'] = '10000000-0000-4000-8000-000000000002'),
      (value) => void (value['projectId'] = '20000000-0000-4000-8000-000000000002'),
      (value) => void (value['jobId'] = '40000000-0000-4000-8000-000000000002'),
      (value) => void (value['initiatedByActorId'] = '30000000-0000-4000-8000-000000000002'),
      (value) => void (value['requestId'] = 'request.phase1a:0002'),
      (value) => void (value['operation'] = 'banner.extract'),
      (value) => void (value['workflowVersionId'] = '11111111-1111-5111-8111-111111111112'),
      (value) => void (value['requestSha256'] = 'f'.repeat(64)),
      (value) => void (value['progressBps'] = 2),
      (value) => void (value['attemptCount'] = 2),
      (value) => void (value['providerCallCount'] = 1),
      (value) => void (value['maxAttempts'] = 2),
      (value) => void (value['maxProviderCalls'] = 63),
      (value) => void (value['attemptTimeoutMs'] = 119_999),
      (value) => void (value['jobTimeoutMs'] = 599_999),
      (value) => void (value['nextAttemptAtMs'] = 11_000),
      (value) => void (value['cancelRequestedAtMs'] = 9_000),
      (value) => {
        value['startedAtMs'] = 2_000;
        value['deadlineAtMs'] = 602_000;
      },
      (value) => void (value['finishedAtMs'] = 9_999),
      (value) => {
        value['state'] = 'retry_wait';
        value['nextAttemptAtMs'] = 11_000;
        value['finishedAtMs'] = null;
        value['terminalError'] = null;
      },
      (value) =>
        void (value['terminalError'] = {
          category: 'internal',
          code: 'INTERNAL_INVARIANT',
          message: 'Mutated terminal error.',
        }),
      (value) => void (value['unknown'] = true),
    ];
    for (const mutate of jobMutations) {
      const mutated = structuredClone(result);
      mutate(mutated.job as unknown as Record<string, unknown>);
      expect(() => validateAttemptFailureCommitResult({ request, result: mutated })).toThrow();
    }

    const attemptMutations: Array<(value: Record<string, unknown>) => void> = [
      (value) => void (value['workspaceId'] = '10000000-0000-4000-8000-000000000002'),
      (value) => void (value['jobId'] = '40000000-0000-4000-8000-000000000002'),
      (value) => void (value['attemptId'] = '50000000-0000-4000-8000-000000000002'),
      (value) => void (value['attemptNumber'] = 2),
      (value) => void (value['workerId'] = 'worker.local:2'),
      (value) => void (value['leaseToken'] = 'a0000000-0000-4000-8000-000000000002'),
      (value) => void (value['leaseExpiresAtMs'] = 31_001),
      (value) => void (value['heartbeatAtMs'] = 2_000),
      (value) => {
        value['startedAtMs'] = 2_000;
        value['heartbeatAtMs'] = 2_000;
        value['leaseExpiresAtMs'] = 32_000;
      },
      (value) => {
        value['state'] = 'timed_out';
        value['error'] = {
          category: 'timeout',
          code: 'CAPABILITY_TIMEOUT',
          message: 'Mutated timeout.',
        };
      },
      (value) => void (value['finishedAtMs'] = 9_999),
      (value) =>
        void (value['error'] = {
          category: 'internal',
          code: 'INTERNAL_INVARIANT',
          message: 'Mutated attempt error.',
        }),
      (value) => void (value['unknown'] = true),
    ];
    for (const mutate of attemptMutations) {
      const mutated = structuredClone(result);
      mutate(mutated.attempt as unknown as Record<string, unknown>);
      expect(() => validateAttemptFailureCommitResult({ request, result: mutated })).toThrow();
    }
    expect(() =>
      validateAttemptFailureCommitResult({ request, result: { ...result, unknown: true } }),
    ).toThrow();
  });

  it('binds lease adapter results to the exact job, worker, token, and lease timing', () => {
    const command = {
      workspaceId,
      jobId,
      workerId: 'worker.local:1',
      leaseToken,
      nowMs: 1_000,
    } as const;
    const result = { kind: 'leased', job: runningJob(), attempt: runningAttempt() } as const;
    expect(LeaseAttemptCommandSchema.parse(command)).toBeDefined();
    expect(LeaseAttemptResultSchema.parse(result)).toBeDefined();
    expect(validateLeaseAttemptResult({ command, result })).toEqual(result);
    expect(validateLeaseAttemptResult({ command, result: { kind: 'not-eligible' } })).toEqual({
      kind: 'not-eligible',
    });

    for (const invalidCommand of [
      { ...command, workspaceId: '10000000-0000-4000-8000-000000000002' },
      { ...command, jobId: '40000000-0000-4000-8000-000000000002' },
      { ...command, workerId: 'worker.local:2' },
      { ...command, leaseToken: 'a0000000-0000-4000-8000-000000000002' },
      { ...command, nowMs: 2_000 },
    ]) {
      expect(() => validateLeaseAttemptResult({ command: invalidCommand, result })).toThrow();
    }
    for (const invalidResult of [
      { ...result, unknown: true },
      { ...result, job: { ...result.job, cancelRequestedAtMs: 1_000 } },
      { ...result, attempt: { ...result.attempt, heartbeatAtMs: 1_001 } },
      { ...result, attempt: { ...result.attempt, leaseExpiresAtMs: 31_001 } },
      { ...result, attempt: { ...result.attempt, workerId: 'worker.local:2' } },
      {
        ...result,
        attempt: {
          ...result.attempt,
          leaseToken: 'a0000000-0000-4000-8000-000000000002',
        },
      },
    ]) {
      expect(() => validateLeaseAttemptResult({ command, result: invalidResult })).toThrow();
    }
    expect(
      LeaseAttemptResultSchema.safeParse({ kind: 'not-eligible', unknown: true }).success,
    ).toBe(false);
  });

  it('strictly validates heartbeat timing and every cancellation result variant', () => {
    const heartbeatCommand = {
      workspaceId,
      jobId,
      attemptId,
      leaseToken,
      nowMs: 10_000,
      currentHeartbeatAtMs: 1_000,
      currentLeaseExpiresAtMs: 31_000,
      attemptDeadlineAtMs: 121_000,
      jobDeadlineAtMs: 601_000,
    } as const;
    const renewed = {
      kind: 'renewed',
      heartbeatAtMs: 10_000,
      nextHeartbeatAtMs: 20_000,
      leaseExpiresAtMs: 40_000,
      jobDeadlineAtMs: 601_000,
    } as const;
    expect(HeartbeatDecisionSchema.parse(renewed)).toBeDefined();
    expect(validateHeartbeatDecision({ command: heartbeatCommand, result: renewed })).toEqual(
      renewed,
    );
    expect(
      validateHeartbeatDecision({
        command: heartbeatCommand,
        result: { kind: 'rejected', reason: 'wrong-token' },
      }),
    ).toEqual({ kind: 'rejected', reason: 'wrong-token' });
    for (const invalid of [
      { ...renewed, heartbeatAtMs: 10_001 },
      { ...renewed, nextHeartbeatAtMs: 20_001 },
      { ...renewed, leaseExpiresAtMs: 40_001 },
      { ...renewed, jobDeadlineAtMs: 10_000 },
      { ...renewed, jobDeadlineAtMs: 602_000 },
      { ...renewed, unknown: true },
    ]) {
      expect(() =>
        validateHeartbeatDecision({ command: heartbeatCommand, result: invalid }),
      ).toThrow();
    }
    for (const invalidCommand of [
      { ...heartbeatCommand, currentLeaseExpiresAtMs: 99_000 },
      { ...heartbeatCommand, currentHeartbeatAtMs: 10_000, currentLeaseExpiresAtMs: 40_000 },
      { ...heartbeatCommand, attemptDeadlineAtMs: 10_000 },
      { ...heartbeatCommand, jobDeadlineAtMs: 10_000 },
    ]) {
      expect(() =>
        validateHeartbeatDecision({ command: invalidCommand, result: renewed }),
      ).toThrow();
    }
    expect(
      HeartbeatDecisionSchema.safeParse({ kind: 'rejected', reason: 'invented' }).success,
    ).toBe(false);

    const cancelRequest = {
      context: { actorId, workspaceId, requestId: 'request.cancel:0001' },
      jobId,
      requestedAtMs: 2_000,
    } as const;
    const cancellationError = {
      category: 'cancelled' as const,
      code: 'CANCELLED',
      message: 'Cancellation requested.',
    };
    const queuedCancellation = {
      ...runningJob(),
      state: 'cancelled' as const,
      progressBps: 0,
      attemptCount: 0,
      startedAtMs: null,
      deadlineAtMs: null,
      cancelRequestedAtMs: 2_000,
      finishedAtMs: 2_000,
      terminalError: cancellationError,
    };
    const retryWaitCancellation = {
      ...runningJob(),
      state: 'cancelled' as const,
      cancelRequestedAtMs: 2_000,
      finishedAtMs: 2_000,
      terminalError: cancellationError,
    };
    const requestedRunning = { ...runningJob(), cancelRequestedAtMs: 2_000 };
    const existingSuccess = {
      ...runningJob(),
      state: 'succeeded' as const,
      progressBps: 10_000,
      finishedAtMs: 1_500,
    };
    const cancellationResults = [
      {
        kind: 'cancelled-immediately' as const,
        acknowledgedRequest: cancelRequest,
        previousState: 'queued' as const,
        job: queuedCancellation,
      },
      {
        kind: 'cancelled-immediately' as const,
        acknowledgedRequest: cancelRequest,
        previousState: 'retry_wait' as const,
        job: retryWaitCancellation,
      },
      {
        kind: 'cancellation-requested' as const,
        acknowledgedRequest: cancelRequest,
        job: requestedRunning,
      },
      {
        kind: 'return-existing-terminal' as const,
        acknowledgedRequest: cancelRequest,
        job: existingSuccess,
      },
    ];
    for (const result of cancellationResults) {
      expect(CancellationRequestResultSchema.parse(result)).toBeDefined();
      expect(validateCancellationRequestResult({ request: cancelRequest, result })).toEqual(result);
    }
    const duplicateRequest = { ...cancelRequest, requestedAtMs: 2_500 };
    const duplicateResult = {
      kind: 'cancellation-requested' as const,
      acknowledgedRequest: duplicateRequest,
      job: requestedRunning,
    };
    expect(
      validateCancellationRequestResult({ request: duplicateRequest, result: duplicateResult }),
    ).toEqual(duplicateResult);
    for (const invalid of [
      {
        kind: 'cancelled-immediately',
        acknowledgedRequest: cancelRequest,
        previousState: 'retry_wait',
        job: queuedCancellation,
      },
      {
        kind: 'cancellation-requested',
        acknowledgedRequest: cancelRequest,
        job: queuedCancellation,
      },
      {
        kind: 'return-existing-terminal',
        acknowledgedRequest: cancelRequest,
        job: requestedRunning,
      },
      {
        kind: 'cancelled-immediately',
        acknowledgedRequest: cancelRequest,
        previousState: 'queued',
        job: { ...queuedCancellation, cancelRequestedAtMs: 1_999 },
      },
      {
        kind: 'return-existing-terminal',
        acknowledgedRequest: cancelRequest,
        job: { ...existingSuccess, finishedAtMs: 2_001 },
      },
      {
        kind: 'cancellation-requested',
        acknowledgedRequest: cancelRequest,
        job: { ...requestedRunning, cancelRequestedAtMs: 2_001 },
      },
      {
        kind: 'return-existing-terminal',
        acknowledgedRequest: cancelRequest,
        job: existingSuccess,
        unknown: true,
      },
    ]) {
      expect(() =>
        validateCancellationRequestResult({ request: cancelRequest, result: invalid }),
      ).toThrow();
    }
    expect(() =>
      validateCancellationRequestResult({
        request: cancelRequest,
        result: {
          kind: 'return-existing-terminal',
          acknowledgedRequest: cancelRequest,
          job: {
            ...existingSuccess,
            workspaceId: '10000000-0000-4000-8000-000000000002',
          },
        },
      }),
    ).toThrow(/context or job/);
    expect(() =>
      validateCancellationRequestResult({
        request: cancelRequest,
        result: {
          kind: 'return-existing-terminal',
          acknowledgedRequest: {
            ...cancelRequest,
            context: {
              ...cancelRequest.context,
              actorId: '30000000-0000-4000-8000-000000000002',
            },
          },
          job: existingSuccess,
        },
      }),
    ).toThrow(/context or job/);
  });

  it('freezes atomic reservation and post-lease once-only fixture finalization identities', () => {
    const identity = createFixtureUsageReservationIdentity(
      INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
      'USD',
    );
    const reservation = {
      workspaceId,
      jobId,
      attemptId,
      leaseToken,
      nowMs: 2_000,
      callKey: 'fixture.call',
      requestSha256: analysisCapabilityRequestSha256,
      workflowVersionId: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
      identity,
      estimateCurrency: 'USD',
      nextEstimateMicros: '0',
    };
    expect(AtomicUsageReservationCommandSchema.parse(reservation)).toBeDefined();
    const providerNeutralReservation = {
      ...reservation,
      identity: {
        capability: 'vision_analysis',
        providerKey: 'replaceable-provider',
        modelKey: 'replaceable-model-v1',
        workflowVersionId: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
        external: true,
        estimatedCostMicros: '125',
        currency: 'USD',
      },
      nextEstimateMicros: '125',
    } as const;
    expect(AtomicUsageReservationCommandSchema.parse(providerNeutralReservation)).toBeDefined();
    expect(analysisCapabilityRequestSha256).not.toBe(requestSha256);
    // @ts-expect-error Operation and capability request digests are intentionally non-interchangeable.
    const operationDigestCannotBeCapability: CapabilityRequestSha256 = requestSha256;
    void operationDigestCannotBeCapability;
    for (const invalid of [
      { ...reservation, estimateCurrency: 'EUR' },
      { ...reservation, nextEstimateMicros: '1' },
      {
        ...reservation,
        identity: {
          ...identity,
          workflowVersionId: 'b0000000-0000-4000-8000-000000000002',
        },
      },
      { ...reservation, identity: { ...identity, actualCostMicros: '0' } },
      { ...reservation, identity: { ...identity, usageMetrics: { calls: 0 } } },
      { ...reservation, unknown: true },
    ]) {
      expect(AtomicUsageReservationCommandSchema.safeParse(invalid).success).toBe(false);
    }

    const startedUsage: ExistingUsageIdentity = {
      usageId: usageId as ExistingUsageIdentity['usageId'],
      workspaceId: workspaceId as ExistingUsageIdentity['workspaceId'],
      jobId: jobId as ExistingUsageIdentity['jobId'],
      attemptId: attemptId as ExistingUsageIdentity['attemptId'],
      callKey: 'fixture.call' as ExistingUsageIdentity['callKey'],
      capability: 'fixture_replay',
      providerKey: 'fixture' as ExistingUsageIdentity['providerKey'],
      modelKey: 'phase1a-fixture-v1' as ExistingUsageIdentity['modelKey'],
      workflowVersionId:
        INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId as ExistingUsageIdentity['workflowVersionId'],
      external: false,
      requestSha256: analysisCapabilityRequestSha256,
      estimatedCostMicros: '0' as ExistingUsageIdentity['estimatedCostMicros'],
      currency: 'USD' as ExistingUsageIdentity['currency'],
      status: 'started',
    };
    const reservedResult = {
      kind: 'reserved' as const,
      usage: startedUsage,
      incrementProviderCallCount: true as const,
      createUsageRow: true as const,
      dispatch: 'after-transaction-commit' as const,
    };
    expect(AtomicUsageReservationResultSchema.parse(reservedResult)).toBeDefined();
    expect(
      validateAtomicUsageReservationResult({ command: reservation, result: reservedResult }),
    ).toEqual(reservedResult);
    const duplicateResult = {
      kind: 'duplicate' as const,
      usage: { ...startedUsage, status: 'succeeded' as const },
      incrementProviderCallCount: false as const,
      createUsageRow: false as const,
      dispatch: false as const,
    };
    expect(
      validateAtomicUsageReservationResult({ command: reservation, result: duplicateResult }),
    ).toEqual(duplicateResult);
    for (const invalidUsage of [
      { ...startedUsage, workspaceId: '10000000-0000-4000-8000-000000000002' },
      { ...startedUsage, jobId: '40000000-0000-4000-8000-000000000002' },
      { ...startedUsage, attemptId: '50000000-0000-4000-8000-000000000002' },
      { ...startedUsage, callKey: 'fixture.other' },
      { ...startedUsage, requestSha256 },
      { ...startedUsage, capability: 'image_segmentation' },
      { ...startedUsage, providerKey: 'other' },
      { ...startedUsage, modelKey: 'other-v1' },
      {
        ...startedUsage,
        workflowVersionId: 'b0000000-0000-4000-8000-000000000002',
      },
      { ...startedUsage, external: true },
      { ...startedUsage, estimatedCostMicros: '1' },
      { ...startedUsage, currency: 'EUR' },
    ]) {
      expect(() =>
        validateAtomicUsageReservationResult({
          command: reservation,
          result: { ...reservedResult, usage: invalidUsage },
        }),
      ).toThrow();
    }
    for (const invalidResult of [
      { ...reservedResult, usage: { ...startedUsage, status: 'succeeded' } },
      { ...reservedResult, incrementProviderCallCount: false },
      { ...reservedResult, createUsageRow: false },
      { ...reservedResult, dispatch: false },
      { ...reservedResult, unknown: true },
      {
        kind: 'budget-stopped',
        code: 'PROVIDER_CALL_LIMIT_EXCEEDED',
        jobState: 'failed',
        attemptState: 'budget_stopped',
        incrementProviderCallCount: false,
        createUsageRow: false,
        dispatch: false,
      },
    ]) {
      expect(AtomicUsageReservationResultSchema.safeParse(invalidResult).success).toBe(false);
    }
    expect(
      AtomicUsageReservationResultSchema.parse({
        kind: 'rejected',
        code: 'COST_CURRENCY_MISMATCH',
        incrementProviderCallCount: false,
        createUsageRow: false,
        dispatch: false,
      }),
    ).toBeDefined();
    for (const code of ['PROVIDER_CALL_LIMIT_EXCEEDED', 'BUDGET_LIMIT_EXCEEDED'] as const) {
      expect(
        AtomicUsageReservationResultSchema.parse({
          kind: 'budget-stopped',
          code,
          jobState: 'budget_stopped',
          attemptState: 'budget_stopped',
          incrementProviderCallCount: false,
          createUsageRow: false,
          dispatch: false,
        }),
      ).toBeDefined();
    }
    const authority = startedUsageFinalizationAuthority(startedUsage);
    expect(authority).not.toHaveProperty('leaseToken');
    expect(authority).not.toHaveProperty('jobState');
    const finalization = {
      authority,
      status: 'succeeded',
      responseSha256: 'f'.repeat(64),
      usageMetrics: {
        calls: 1,
        inputTokens: 0,
        outputTokens: 0,
        inputPixels: 0,
        outputImages: 0,
        computeMs: 0,
      },
      actualCostMicros: '0',
      error: null,
      finishedAtMs: 40_000,
    };
    expect(ProviderUsageFinalizationCommandSchema.parse(finalization)).toBeDefined();
    const finalizedUsage = { ...startedUsage, status: 'succeeded' as const };
    const finalizationResult = {
      kind: 'finalize' as const,
      usage: finalizedUsage,
      finalization: {
        status: finalization.status,
        responseSha256: finalization.responseSha256,
        usageMetrics: finalization.usageMetrics,
        actualCostMicros: finalization.actualCostMicros,
        error: finalization.error,
        finishedAtMs: finalization.finishedAtMs,
      },
    };
    expect(ProviderUsageFinalizationResultSchema.parse(finalizationResult)).toBeDefined();
    expect(
      validateProviderUsageFinalizationResult({
        command: finalization,
        result: finalizationResult,
      }),
    ).toEqual(finalizationResult);
    const alreadyFinalResult = {
      kind: 'already-final' as const,
      usage: finalizedUsage,
      status: 'succeeded' as const,
      finishedAtMs: 39_000,
      rewrite: false as const,
    };
    expect(
      validateProviderUsageFinalizationResult({
        command: finalization,
        result: alreadyFinalResult,
      }),
    ).toEqual(alreadyFinalResult);
    for (const invalidResult of [
      { ...finalizationResult, usage: { ...finalizedUsage, usageId: jobId } },
      {
        ...finalizationResult,
        usage: { ...finalizedUsage, requestSha256: requestSha256 },
      },
      {
        ...finalizationResult,
        usage: { ...finalizedUsage, status: 'failed' },
      },
      {
        ...finalizationResult,
        finalization: { ...finalizationResult.finalization, responseSha256: 'e'.repeat(64) },
      },
      {
        ...finalizationResult,
        finalization: {
          ...finalizationResult.finalization,
          usageMetrics: { ...finalization.usageMetrics, calls: 2 },
        },
      },
      {
        ...finalizationResult,
        finalization: { ...finalizationResult.finalization, finishedAtMs: 40_001 },
      },
      { ...alreadyFinalResult, finishedAtMs: 40_001 },
      { ...alreadyFinalResult, rewrite: true },
      { ...alreadyFinalResult, unknown: true },
    ]) {
      expect(() =>
        validateProviderUsageFinalizationResult({ command: finalization, result: invalidResult }),
      ).toThrow();
    }
    for (const invalid of [
      { ...finalization, actualCostMicros: '1' },
      { ...finalization, usageMetrics: { ...finalization.usageMetrics, calls: 2 } },
      { ...finalization, responseSha256: null },
      { ...finalization, unknown: true },
    ]) {
      expect(ProviderUsageFinalizationCommandSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe('portable inward architecture', () => {
  it('keeps source imports free of framework, DB, auth, billing, provider, cloud, and queue SDKs', () => {
    const sourceRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
    const files: string[] = [];
    const collect = (directory: string): void => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) collect(path);
        else if (entry.name.endsWith('.ts')) files.push(path);
      }
    };
    collect(sourceRoot);
    const forbidden = [
      'next',
      'react',
      'drizzle-orm',
      'postgres',
      '@supabase',
      '@makerkit',
      'stripe',
      'openai',
      '@anthropic-ai',
      'replicate',
      '@runpod',
      '@aws-sdk',
      '@google-cloud',
      '@vercel',
      'bullmq',
      'inngest',
      '@trigger.dev',
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      const specifiers = [...source.matchAll(/(?:from\s+|import\s*\()(['"])([^'"]+)\1/gu)].map(
        (match) => match[2]!,
      );
      for (const specifier of specifiers) {
        expect(
          forbidden.some((prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`)),
          `${file} imports ${specifier}`,
        ).toBe(false);
      }
    }
  });

  it('exposes one atomic usage reservation and explicit success/failure/cancel/heartbeat contracts', () => {
    const portSource = readFileSync(
      new URL('../src/ports/job-workflow-ports.ts', import.meta.url),
      'utf8',
    );
    for (const required of [
      'reserveUnderJobLock',
      'commitSuccessAtomically',
      'finalizeAttemptFailure',
      'requestCancellation',
      'heartbeatAttempt',
      'StartedUsageFinalizationAuthority',
      'ProviderUsageFinalizationCommand',
    ]) {
      expect(portSource).toContain(required);
    }
    for (const staleSplit of ['listJobCosts(', 'reserveStarted(', 'decideUnderJobLock(']) {
      expect(portSource).not.toContain(staleSplit);
    }
    expect(portSource).not.toMatch(/drizzle-orm|from ['"]postgres['"]|@supabase|stripe/iu);
  });
});
