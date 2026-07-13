import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
  CheckpointReferenceIdentitySchema,
  CheckpointReuseDecisionSchema,
  PersistedCheckpointIdentitySchema,
  WorkflowDefinitionV1Schema,
  WorkflowVersionContractSchema,
  byteSourceFrom,
  canonicalizeJson,
  computeWorkflowDefinitionSha256,
  normalizeRasterUpload,
  resolveCheckpointReuseCandidate,
  sha256BannerScene,
  sha256Hex,
  verifyCheckpointReuse,
  workflowCumulativeBoundaries,
  type WorkflowVersionContract,
} from '../src/index.js';
import { loadAngelInput, loadAngelScene } from './fixture.js';

const workspaceId = '10000000-0000-4000-8000-000000000001';
const otherWorkspaceId = '10000000-0000-4000-8000-000000000002';
const projectId = '20000000-0000-4000-8000-000000000001';
const otherProjectId = '20000000-0000-4000-8000-000000000002';
const jobId = '30000000-0000-4000-8000-000000000001';
const otherJobId = '30000000-0000-4000-8000-000000000002';
const attemptId = '40000000-0000-4000-8000-000000000001';
const otherAttemptId = '40000000-0000-4000-8000-000000000002';
const requestSha256 = 'a'.repeat(64);

const proposal = {
  kind: 'composition_proposal',
  proposalVersion: 1,
  sourceAssetSha256: '1'.repeat(64),
  parts: [
    {
      partKey: 'part.body',
      label: 'Body',
      role: 'subject',
      bounds: { xBps: 2_000, yBps: 1_000, widthBps: 6_000, heightBps: 8_000 },
    },
  ],
} as const;

const proposalSha256 = sha256Hex(Buffer.from(canonicalizeJson(proposal), 'utf8'));
const analyzeCheckpointDeclaration = INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definition.outputs[0]!;

const analyzeCheckpoint = () => ({
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
  output: structuredClone(analyzeCheckpointDeclaration),
  reference: { kind: 'analysis_payload' as const },
  payload: structuredClone(proposal),
  contentSha256: proposalSha256,
});

const analyzeExpected = () => ({
  workspaceId,
  projectId,
  jobId,
  creatingAttemptId: attemptId,
  requestSha256,
  workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
  outputKey: analyzeCheckpointDeclaration.outputKey,
  reference: { kind: 'analysis_payload' as const },
});

const analyzeMaterial = () => ({
  kind: 'analysis_payload' as const,
  workspaceId,
  projectId,
  jobId,
  declaredContentSha256: proposalSha256,
  payload: structuredClone(proposal),
});

const createAssetCheckpointWorkflow = (): WorkflowVersionContract => {
  const definition = WorkflowDefinitionV1Schema.parse({
    definitionVersion: 1,
    workflowKey: 'banner.extract',
    steps: [
      {
        stepKey: 'source-load',
        kind: 'source_load',
        weightBps: 2_000,
        replaySafe: true,
        externalIdempotency: 'none',
      },
      {
        stepKey: 'fixture-extraction',
        kind: 'fixture_extraction',
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
        outputKey: 'extract.fixture-layer',
        kind: 'asset_version',
        disposition: 'checkpoint',
        producingStepKey: 'fixture-extraction',
        replaySafe: true,
      },
      {
        outputKey: 'extract.layer',
        kind: 'asset_version',
        disposition: 'final',
        producingStepKey: 'atomic-persistence',
        replaySafe: true,
      },
    ],
    policy: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definition.policy,
  });
  return WorkflowVersionContractSchema.parse({
    workflowVersionId: '50000000-0000-4000-8000-000000000001',
    workflowVersion: 1,
    definitionSha256: computeWorkflowDefinitionSha256(definition),
    definition,
  });
};

const createSceneCheckpointWorkflow = (): WorkflowVersionContract => {
  const definition = WorkflowDefinitionV1Schema.parse({
    definitionVersion: 1,
    workflowKey: 'banner.export',
    steps: [
      {
        stepKey: 'scene-load',
        kind: 'scene_load',
        weightBps: 3_000,
        replaySafe: true,
        externalIdempotency: 'none',
      },
      {
        stepKey: 'deterministic-export',
        kind: 'deterministic_export',
        weightBps: 5_000,
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
        outputKey: 'export.scene-loaded',
        kind: 'banner_scene_version',
        disposition: 'checkpoint',
        producingStepKey: 'scene-load',
        replaySafe: true,
      },
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
    workflowVersionId: '60000000-0000-4000-8000-000000000001',
    workflowVersion: 1,
    definitionSha256: computeWorkflowDefinitionSha256(definition),
    definition,
  });
};

describe('immutable workflow contracts', () => {
  it('pins the initial analyze step order, cumulative progress, outputs, and digest', () => {
    expect(workflowCumulativeBoundaries(INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definition)).toEqual([
      1_000, 7_000, 8_500, 10_000,
    ]);
    expect(INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definition.steps.map((step) => step.stepKey)).toEqual(
      ['source-load', 'fixture-analysis', 'output-validation', 'atomic-persistence'],
    );
    expect(computeWorkflowDefinitionSha256(INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definition)).toBe(
      INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definitionSha256,
    );
    expect(INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId).toBe(
      '11111111-1111-5111-8111-111111111111',
    );
  });

  it('rejects every workflow identity, graph, output, replay, weight, and policy mutation class', () => {
    const base = structuredClone(INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definition);
    const mutations: Array<(value: Record<string, unknown>) => void> = [
      (value) => {
        value['unknown'] = true;
      },
      (value) => {
        value['definitionVersion'] = 2;
      },
      (value) => {
        value['workflowKey'] = 'banner.export';
      },
      (value) => {
        const steps = value['steps'] as Array<Record<string, unknown>>;
        steps[1]!['stepKey'] = steps[0]!['stepKey'];
      },
      (value) => {
        const steps = value['steps'] as Array<Record<string, unknown>>;
        steps[0]!['weightBps'] = 999;
      },
      (value) => {
        const steps = value['steps'] as Array<Record<string, unknown>>;
        steps[0]!['kind'] = 'scene_load';
      },
      (value) => {
        const steps = value['steps'] as Array<Record<string, unknown>>;
        steps[0]!['externalIdempotency'] = 'arbitrary';
      },
      (value) => {
        const outputs = value['outputs'] as Array<Record<string, unknown>>;
        outputs[1]!['outputKey'] = outputs[0]!['outputKey'];
      },
      (value) => {
        const outputs = value['outputs'] as Array<Record<string, unknown>>;
        outputs[0]!['producingStepKey'] = 'missing-step';
      },
      (value) => {
        const outputs = value['outputs'] as Array<Record<string, unknown>>;
        outputs[0]!['replaySafe'] = false;
      },
      (value) => {
        const outputs = value['outputs'] as Array<Record<string, unknown>>;
        outputs[0]!['kind'] = 'export_artifact';
      },
      (value) => {
        const outputs = value['outputs'] as Array<Record<string, unknown>>;
        for (const output of outputs) output['disposition'] = 'checkpoint';
      },
      (value) => {
        (value['policy'] as Record<string, unknown>)['maxAttempts'] = 4;
      },
      (value) => {
        (value['policy'] as Record<string, unknown>)['maxProviderCalls'] = 65;
      },
      (value) => {
        (value['policy'] as Record<string, unknown>)['attemptTimeoutMs'] = 119_999;
      },
      (value) => {
        (value['policy'] as Record<string, unknown>)['jobTimeoutMs'] = 599_999;
      },
      (value) => {
        (value['policy'] as Record<string, unknown>)['leaseDurationMs'] = 29_999;
      },
      (value) => {
        (value['policy'] as Record<string, unknown>)['heartbeatIntervalMs'] = 9_999;
      },
      (value) => {
        (value['policy'] as Record<string, unknown>)['maxCapabilityCallMs'] = 59_999;
      },
    ];
    for (const mutate of mutations) {
      const value = structuredClone(base) as unknown as Record<string, unknown>;
      mutate(value);
      expect(WorkflowDefinitionV1Schema.safeParse(value).success).toBe(false);
    }

    for (const invalid of [
      { ...INITIAL_BANNER_ANALYZE_WORKFLOW_V1, workflowVersionId: 'workflow_analyze_v1' },
      { ...INITIAL_BANNER_ANALYZE_WORKFLOW_V1, workflowVersion: 0 },
      { ...INITIAL_BANNER_ANALYZE_WORKFLOW_V1, definitionSha256: 'f'.repeat(64) },
      { ...INITIAL_BANNER_ANALYZE_WORKFLOW_V1, unknown: true },
    ]) {
      expect(WorkflowVersionContractSchema.safeParse(invalid).success).toBe(false);
    }
  });
});

describe('authoritative checkpoint reuse', () => {
  it('grants replay on strict scoped absence but never converts corrupt existing data to absence', async () => {
    await expect(resolveCheckpointReuseCandidate({ kind: 'absent' })).resolves.toEqual({
      kind: 'absent',
      overwrite: false,
    });
    for (const invalid of [
      { kind: 'absent' },
      { kind: 'absent', overwrite: false, existing: false },
      { kind: 'missing' },
      { kind: 'reuse', checkpoint: analyzeCheckpoint(), overwrite: false },
      {
        kind: 'reuse',
        checkpoint: analyzeCheckpoint(),
        contentSha256: 'f'.repeat(64),
        overwrite: false,
      },
      {
        kind: 'mismatch',
        jobState: 'failed',
        error: {
          code: 'INTERNAL_INVARIANT',
          category: 'internal',
          retryable: false,
          message: 'Wrong mismatch authority.',
        },
        overwrite: false,
        ignore: false,
      },
    ]) {
      expect(CheckpointReuseDecisionSchema.safeParse(invalid).success).toBe(false);
    }

    await expect(
      resolveCheckpointReuseCandidate({
        kind: 'existing',
        expected: analyzeExpected(),
        persisted: { ...analyzeCheckpoint(), contentSha256: 'f'.repeat(64) },
        material: analyzeMaterial(),
      }),
    ).resolves.toMatchObject({
      kind: 'mismatch',
      error: { code: 'CHECKPOINT_IDENTITY_MISMATCH' },
      overwrite: false,
      ignore: false,
    });
  });

  it('reuses one exact analysis checkpoint and rejects every persisted identity field mutation', async () => {
    await expect(
      verifyCheckpointReuse({
        expected: analyzeExpected(),
        persisted: analyzeCheckpoint(),
        material: analyzeMaterial(),
      }),
    ).resolves.toMatchObject({ kind: 'reuse', contentSha256: proposalSha256, overwrite: false });

    const mutations: Array<(value: Record<string, unknown>) => void> = [
      (value) => {
        value['workspaceId'] = otherWorkspaceId;
      },
      (value) => {
        value['projectId'] = otherProjectId;
      },
      (value) => {
        value['jobId'] = otherJobId;
      },
      (value) => {
        value['attemptId'] = otherAttemptId;
      },
      (value) => {
        value['requestSha256'] = 'b'.repeat(64);
      },
      (value) => {
        (value['workflow'] as Record<string, unknown>)['workflowVersionId'] =
          '70000000-0000-4000-8000-000000000001';
      },
      (value) => {
        (value['workflow'] as Record<string, unknown>)['workflowVersion'] = 2;
      },
      (value) => {
        (value['workflow'] as Record<string, unknown>)['definitionSha256'] = 'b'.repeat(64);
      },
      (value) => {
        (value['output'] as Record<string, unknown>)['outputKey'] = 'analysis.other';
      },
      (value) => {
        (value['output'] as Record<string, unknown>)['kind'] = 'asset_version';
      },
      (value) => {
        (value['output'] as Record<string, unknown>)['disposition'] = 'final';
      },
      (value) => {
        (value['output'] as Record<string, unknown>)['producingStepKey'] = 'source-load';
      },
      (value) => {
        (value['output'] as Record<string, unknown>)['replaySafe'] = false;
      },
      (value) => {
        value['reference'] = {
          kind: 'asset_version',
          assetVersionId: '80000000-0000-4000-8000-000000000001',
        };
      },
      (value) => {
        (value['payload'] as Record<string, unknown>)['unknown'] = true;
      },
      (value) => {
        (value['payload'] as Record<string, unknown>)['sourceAssetSha256'] = '2'.repeat(64);
      },
      (value) => {
        value['contentSha256'] = 'b'.repeat(64);
      },
      (value) => {
        value['unknown'] = true;
      },
    ];
    for (const mutate of mutations) {
      const value = structuredClone(analyzeCheckpoint()) as unknown as Record<string, unknown>;
      mutate(value);
      await expect(
        verifyCheckpointReuse({
          expected: analyzeExpected(),
          persisted: value,
          material: analyzeMaterial(),
        }),
      ).resolves.toMatchObject({
        kind: 'mismatch',
        error: { code: 'CHECKPOINT_IDENTITY_MISMATCH' },
        overwrite: false,
        ignore: false,
      });
    }
  });

  it('fails closed for wrong-scope, malformed, stale-digest, and replay-unsafe analysis material', async () => {
    for (const mutation of [
      { workspaceId: otherWorkspaceId },
      { projectId: otherProjectId },
      { jobId: otherJobId },
      { declaredContentSha256: 'b'.repeat(64) },
      { payload: { ...proposal, unknown: true } },
      { payload: { ...proposal, sourceAssetSha256: '2'.repeat(64) } },
    ]) {
      await expect(
        verifyCheckpointReuse({
          expected: analyzeExpected(),
          persisted: analyzeCheckpoint(),
          material: { ...analyzeMaterial(), ...mutation },
        }),
      ).resolves.toMatchObject({ kind: 'mismatch' });
    }

    const definition = WorkflowDefinitionV1Schema.parse({
      ...INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definition,
      steps: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definition.steps.map((step) =>
        step.stepKey === 'fixture-analysis' ? { ...step, replaySafe: false } : step,
      ),
      outputs: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definition.outputs.map((output) =>
        output.outputKey === analyzeCheckpointDeclaration.outputKey
          ? { ...output, replaySafe: false }
          : output,
      ),
    });
    const workflow = WorkflowVersionContractSchema.parse({
      ...INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
      definition,
      definitionSha256: computeWorkflowDefinitionSha256(definition),
    });
    await expect(
      verifyCheckpointReuse({
        expected: { ...analyzeExpected(), workflow },
        persisted: analyzeCheckpoint(),
        material: analyzeMaterial(),
      }),
    ).resolves.toMatchObject({ kind: 'mismatch' });
  });

  it('fully decodes and rechecks bounded canonical PNG checkpoint bytes', async () => {
    const source = await sharp({
      create: { width: 2, height: 2, channels: 4, background: '#336699cc' },
    })
      .png()
      .toBuffer();
    const normalized = await normalizeRasterUpload({
      bytes: byteSourceFrom(source),
      declaredMediaType: 'image/png',
      filename: 'checkpoint.png',
    });
    const workflow = createAssetCheckpointWorkflow();
    const declaration = workflow.definition.outputs[0]!;
    const assetVersionId = '80000000-0000-4000-8000-000000000001';
    const assetReference = CheckpointReferenceIdentitySchema.parse({
      kind: 'asset_version',
      assetVersionId,
    });
    const persisted = {
      workspaceId,
      projectId,
      jobId,
      attemptId,
      requestSha256,
      workflow: {
        workflowVersionId: workflow.workflowVersionId,
        workflowVersion: workflow.workflowVersion,
        definitionSha256: workflow.definitionSha256,
      },
      output: declaration,
      reference: assetReference,
      payload: null,
      contentSha256: normalized.sha256,
    };
    const expected = {
      workspaceId,
      projectId,
      jobId,
      creatingAttemptId: attemptId,
      requestSha256,
      workflow,
      outputKey: declaration.outputKey,
      reference: assetReference,
    };
    const material = {
      kind: 'asset_version' as const,
      workspaceId,
      projectId,
      jobId,
      assetVersionId,
      declaredContentSha256: normalized.sha256,
      byteSize: normalized.byteSize,
      bytes: normalized.bytes,
    };
    await expect(verifyCheckpointReuse({ expected, persisted, material })).resolves.toMatchObject({
      kind: 'reuse',
    });

    const corrupt = Buffer.from(normalized.bytes);
    corrupt[corrupt.length - 8] = corrupt[corrupt.length - 8]! ^ 1;
    for (const mutation of [
      { byteSize: normalized.byteSize + 1 },
      { declaredContentSha256: 'b'.repeat(64) },
      { assetVersionId: '80000000-0000-4000-8000-000000000002' },
      { bytes: corrupt, declaredContentSha256: sha256Hex(corrupt) },
      { bytes: new Uint8Array(20_971_521), byteSize: 20_971_521 },
    ]) {
      await expect(
        verifyCheckpointReuse({ expected, persisted, material: { ...material, ...mutation } }),
      ).resolves.toMatchObject({ kind: 'mismatch' });
    }
  });

  it('strictly parses and rederives canonical scene checkpoint content', async () => {
    const workflow = createSceneCheckpointWorkflow();
    const declaration = workflow.definition.outputs[0]!;
    const sceneVersionId = '90000000-0000-4000-8000-000000000001';
    const sceneReference = CheckpointReferenceIdentitySchema.parse({
      kind: 'banner_scene_version',
      sceneVersionId,
    });
    const scene = loadAngelScene();
    const contentSha256 = sha256BannerScene(scene);
    const expected = {
      workspaceId,
      projectId,
      jobId,
      creatingAttemptId: attemptId,
      requestSha256,
      workflow,
      outputKey: declaration.outputKey,
      reference: sceneReference,
    };
    const persisted = PersistedCheckpointIdentitySchema.parse({
      workspaceId,
      projectId,
      jobId,
      attemptId,
      requestSha256,
      workflow: {
        workflowVersionId: workflow.workflowVersionId,
        workflowVersion: workflow.workflowVersion,
        definitionSha256: workflow.definitionSha256,
      },
      output: declaration,
      reference: sceneReference,
      payload: null,
      contentSha256,
    });
    const material = {
      kind: 'banner_scene_version' as const,
      workspaceId,
      projectId,
      jobId,
      sceneVersionId,
      declaredContentSha256: contentSha256,
      scene,
    };
    await expect(verifyCheckpointReuse({ expected, persisted, material })).resolves.toMatchObject({
      kind: 'reuse',
    });
    await expect(
      verifyCheckpointReuse({
        expected,
        persisted,
        material: { ...material, scene: { ...(loadAngelInput() as object), unknown: true } },
      }),
    ).resolves.toMatchObject({ kind: 'mismatch' });
    await expect(
      verifyCheckpointReuse({
        expected,
        persisted,
        material: { ...material, declaredContentSha256: 'b'.repeat(64) },
      }),
    ).resolves.toMatchObject({ kind: 'mismatch' });
  });
});
