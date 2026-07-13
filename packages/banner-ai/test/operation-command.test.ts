import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
  CanonicalUuidSchema,
  OperationRequestSha256Schema,
  Phase1AOperationCommandSchema,
  WorkflowDefinitionV1Schema,
  WorkflowVersionContractSchema,
  canonicalOperationRequestJson,
  computeWorkflowDefinitionSha256,
  decideIdempotentJobCreation,
  operationRequestSha256,
  projectCanonicalOperationRequest,
  type WorkflowVersionContract,
} from '../src/index.js';

const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_PROJECT_ID = '22222222-2222-4222-8222-222222222223';
const SOURCE_ASSET_VERSION_ID = '33333333-3333-4333-8333-333333333333';
const OTHER_ASSET_VERSION_ID = '33333333-3333-4333-8333-333333333334';
const ANALYSIS_OUTPUT_ID = '44444444-4444-4444-8444-444444444444';
const SCENE_VERSION_ID = '55555555-5555-4555-8555-555555555555';
const WORKSPACE_ID = '88888888-8888-4888-8888-888888888888';

const analyzeCommand = {
  commandVersion: 1,
  projectId: PROJECT_ID,
  operation: 'banner.analyze',
  workflowVersionId: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
  idempotencyKey: 'analyze.command:0001',
  sourceAssetVersionId: SOURCE_ASSET_VERSION_ID,
  parameters: { maxParts: 5, includeBackground: true },
} as const;

const sourceResolution = {
  workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
  inputAssets: [
    {
      assetVersionId: SOURCE_ASSET_VERSION_ID,
      sha256: '1'.repeat(64),
    },
  ],
} as const;

const createWorkflow = (
  workflowKey: 'banner.extract' | 'banner.export',
): WorkflowVersionContract => {
  const extracting = workflowKey === 'banner.extract';
  const definition = WorkflowDefinitionV1Schema.parse({
    definitionVersion: 1,
    workflowKey,
    steps: [
      {
        stepKey: extracting ? 'source-load' : 'scene-load',
        kind: extracting ? 'source_load' : 'scene_load',
        weightBps: 2_000,
        replaySafe: true,
        externalIdempotency: 'none',
      },
      {
        stepKey: extracting ? 'fixture-extraction' : 'deterministic-export',
        kind: extracting ? 'fixture_extraction' : 'deterministic_export',
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
        outputKey: extracting ? 'extract.asset' : 'export.artifact',
        kind: extracting ? 'asset_version' : 'export_artifact',
        disposition: 'final',
        producingStepKey: 'atomic-persistence',
        replaySafe: true,
      },
    ],
    policy: {
      maxAttempts: 3,
      maxProviderCalls: 64,
      attemptTimeoutMs: 120_000,
      jobTimeoutMs: 600_000,
      leaseDurationMs: 30_000,
      heartbeatIntervalMs: 10_000,
      maxCapabilityCallMs: 60_000,
    },
  });
  return WorkflowVersionContractSchema.parse({
    workflowVersionId: extracting
      ? '66666666-6666-4666-8666-666666666666'
      : '77777777-7777-4777-8777-777777777777',
    workflowVersion: 1,
    definitionSha256: computeWorkflowDefinitionSha256(definition),
    definition,
  });
};

describe('strict Phase 1A operation commands', () => {
  it('accepts only the three closed product command variants without coercion', () => {
    expect(Phase1AOperationCommandSchema.parse(analyzeCommand)).toEqual(analyzeCommand);

    const extractWorkflow = createWorkflow('banner.extract');
    expect(
      Phase1AOperationCommandSchema.parse({
        commandVersion: 1,
        projectId: PROJECT_ID,
        operation: 'banner.extract',
        workflowVersionId: extractWorkflow.workflowVersionId,
        idempotencyKey: 'extract.command:0001',
        sourceAssetVersionId: SOURCE_ASSET_VERSION_ID,
        parameters: {
          analysisOutputId: ANALYSIS_OUTPUT_ID,
          partKey: 'part.body',
          trimTransparentPixels: true,
        },
      }),
    ).toBeDefined();

    const exportWorkflow = createWorkflow('banner.export');
    expect(
      Phase1AOperationCommandSchema.parse({
        commandVersion: 1,
        projectId: PROJECT_ID,
        operation: 'banner.export',
        workflowVersionId: exportWorkflow.workflowVersionId,
        idempotencyKey: 'export.command:0001',
        parameters: {
          sceneVersionId: SCENE_VERSION_ID,
          artifactProfile: 'scene-export-settings-v1',
        },
      }),
    ).toBeDefined();
  });

  it.each([
    ['workspaceId', 'workspace_0001'],
    ['actorId', 'actor_000001'],
    ['requestId', 'request_0001'],
    ['requestSha256', 'a'.repeat(64)],
    ['requestJson', {}],
    ['timestamp', 1_700_000_000_000],
    ['transport', { kind: 'http' }],
    ['prompt', 'do anything'],
    ['tools', []],
  ])('rejects caller-controlled or generic top-level field %s', (field, value) => {
    expect(
      Phase1AOperationCommandSchema.safeParse({ ...analyzeCommand, [field]: value }).success,
    ).toBe(false);
  });

  it('rejects unknown nested keys, mixed variants, future versions, and coercible scalar strings', () => {
    for (const invalid of [
      { ...analyzeCommand, commandVersion: '1' },
      { ...analyzeCommand, commandVersion: 2 },
      { ...analyzeCommand, operation: 'banner.generate' },
      { ...analyzeCommand, idempotencyKey: 'short' },
      { ...analyzeCommand, parameters: { ...analyzeCommand.parameters, maxParts: '5' } },
      {
        ...analyzeCommand,
        parameters: { ...analyzeCommand.parameters, includeBackground: 'true' },
      },
      { ...analyzeCommand, parameters: { ...analyzeCommand.parameters, prompt: 'layers' } },
      { ...analyzeCommand, sceneVersionId: SCENE_VERSION_ID },
      { ...analyzeCommand, sourceAssetSha256: '1'.repeat(64) },
    ]) {
      expect(Phase1AOperationCommandSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it('requires canonical lowercase UUIDs at every persistence-facing command boundary', () => {
    expect(CanonicalUuidSchema.parse(PROJECT_ID)).toBe(PROJECT_ID);
    for (const invalid of [
      'project_0001',
      'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
      PROJECT_ID.replaceAll('-', ''),
      `${PROJECT_ID} `,
    ]) {
      expect(CanonicalUuidSchema.safeParse(invalid).success).toBe(false);
      expect(
        Phase1AOperationCommandSchema.safeParse({ ...analyzeCommand, projectId: invalid }).success,
      ).toBe(false);
    }
    expect(
      Phase1AOperationCommandSchema.safeParse({
        ...analyzeCommand,
        workflowVersionId: 'workflow_analyze_v1',
      }).success,
    ).toBe(false);
    expect(
      Phase1AOperationCommandSchema.safeParse({
        ...analyzeCommand,
        sourceAssetVersionId: 'asset_version_source_0001',
      }).success,
    ).toBe(false);
  });
});

describe('authoritative canonical request projection', () => {
  it('projects exactly the frozen fields and pins canonical JSON plus digest', () => {
    const projected = projectCanonicalOperationRequest(analyzeCommand, sourceResolution);
    expect(Object.keys(projected)).toEqual([
      'commandVersion',
      'projectId',
      'operation',
      'workflowVersion',
      'inputAssets',
      'parameters',
    ]);
    expect(projected).not.toHaveProperty('idempotencyKey');
    expect(canonicalOperationRequestJson(analyzeCommand, sourceResolution)).toBe(
      '{"commandVersion":1,"inputAssets":[{"assetVersionId":"' +
        SOURCE_ASSET_VERSION_ID +
        '","sha256":"1111111111111111111111111111111111111111111111111111111111111111"}],"operation":"banner.analyze","parameters":{"includeBackground":true,"maxParts":5},"projectId":"' +
        PROJECT_ID +
        '","workflowVersion":{"definitionSha256":"' +
        INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definitionSha256 +
        '","workflowVersion":1,"workflowVersionId":"11111111-1111-5111-8111-111111111111"}}',
    );
    const canonicalJson = canonicalOperationRequestJson(analyzeCommand, sourceResolution);
    expect(operationRequestSha256(analyzeCommand, sourceResolution)).toBe(
      'bf85916ac3524021d031c3039b10e1483417fbf658a3cfdb10fdc2d415f7ad1e',
    );
    expect(createHash('sha256').update(canonicalJson).digest('hex')).toBe(
      'bf85916ac3524021d031c3039b10e1483417fbf658a3cfdb10fdc2d415f7ad1e',
    );
  });

  it('excludes idempotency metadata and is sensitive to every included authority or parameter', () => {
    const base = operationRequestSha256(analyzeCommand, sourceResolution);
    expect(
      operationRequestSha256(
        { ...analyzeCommand, idempotencyKey: 'analyze.command:9999' },
        sourceResolution,
      ),
    ).toBe(base);
    expect(
      operationRequestSha256({ ...analyzeCommand, projectId: OTHER_PROJECT_ID }, sourceResolution),
    ).not.toBe(base);
    expect(
      operationRequestSha256(
        { ...analyzeCommand, parameters: { ...analyzeCommand.parameters, maxParts: 4 } },
        sourceResolution,
      ),
    ).not.toBe(base);
    expect(
      operationRequestSha256(analyzeCommand, {
        ...sourceResolution,
        inputAssets: [{ ...sourceResolution.inputAssets[0]!, sha256: '2'.repeat(64) }],
      }),
    ).not.toBe(base);

    const changedDefinition = WorkflowDefinitionV1Schema.parse({
      ...INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definition,
      steps: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definition.steps.map((step, index) =>
        index === 0
          ? { ...step, weightBps: 999 }
          : index === 1
            ? { ...step, weightBps: 6_001 }
            : step,
      ),
    });
    const changedWorkflow = WorkflowVersionContractSchema.parse({
      ...INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
      definition: changedDefinition,
      definitionSha256: computeWorkflowDefinitionSha256(changedDefinition),
    });
    expect(
      operationRequestSha256(analyzeCommand, {
        workflow: changedWorkflow,
        inputAssets: sourceResolution.inputAssets,
      }),
    ).not.toBe(base);
  });

  it('canonical-sorts export input assets as a unique set and rejects missing/duplicate resolution', () => {
    const workflow = createWorkflow('banner.export');
    const command = {
      commandVersion: 1,
      projectId: PROJECT_ID,
      operation: 'banner.export',
      workflowVersionId: workflow.workflowVersionId,
      idempotencyKey: 'export.command:0001',
      parameters: {
        sceneVersionId: SCENE_VERSION_ID,
        artifactProfile: 'scene-export-settings-v1',
      },
    } as const;
    const first = { assetVersionId: SOURCE_ASSET_VERSION_ID, sha256: '1'.repeat(64) };
    const second = { assetVersionId: OTHER_ASSET_VERSION_ID, sha256: '2'.repeat(64) };
    const forward = operationRequestSha256(command, { workflow, inputAssets: [first, second] });
    const reverse = operationRequestSha256(command, { workflow, inputAssets: [second, first] });
    expect(reverse).toBe(forward);
    expect(() => operationRequestSha256(command, { workflow, inputAssets: [] })).toThrow();
    expect(() =>
      operationRequestSha256(command, { workflow, inputAssets: [first, first] }),
    ).toThrow(/unique/);
  });

  it('rejects a resolution that does not authoritatively match workflow operation or source ID', () => {
    const wrongWorkflow = createWorkflow('banner.export');
    expect(() =>
      projectCanonicalOperationRequest(analyzeCommand, {
        workflow: wrongWorkflow,
        inputAssets: sourceResolution.inputAssets,
      }),
    ).toThrow(/workflow identity/);
    expect(() =>
      projectCanonicalOperationRequest(analyzeCommand, {
        workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
        inputAssets: [{ assetVersionId: OTHER_ASSET_VERSION_ID, sha256: '1'.repeat(64) }],
      }),
    ).toThrow(/source asset/);
  });
});

describe('idempotent creation decisions', () => {
  const scope = {
    workspaceId: WORKSPACE_ID,
    operation: 'banner.analyze',
    idempotencyKey: 'analyze.command:0001',
  } as const;
  const requestSha256 = OperationRequestSha256Schema.parse('a'.repeat(64));
  const otherRequestSha256 = OperationRequestSha256Schema.parse('b'.repeat(64));

  it('creates only when no winner exists', () => {
    expect(decideIdempotentJobCreation({ scope, requestSha256, existing: null })).toEqual({
      kind: 'create',
      requestSha256,
    });
  });

  it('returns the exact current or terminal winner with no side effects for duplicate/concurrent calls', () => {
    for (const state of [
      'queued',
      'running',
      'retry_wait',
      'succeeded',
      'failed',
      'cancelled',
      'budget_stopped',
    ]) {
      const job = { id: `job_${state}`, state };
      const decision = decideIdempotentJobCreation({
        scope,
        requestSha256,
        existing: { scope, requestSha256, job },
      });
      expect(decision).toEqual({ kind: 'return-existing', job, sideEffects: 'none' });
      if (decision.kind === 'return-existing') expect(decision.job).toBe(job);
    }
  });

  it('conflicts on a scoped key with a different payload and never mutates scope', () => {
    expect(
      decideIdempotentJobCreation({
        scope,
        requestSha256,
        existing: { scope, requestSha256: otherRequestSha256, job: { id: 'job_existing' } },
      }),
    ).toEqual({ kind: 'conflict', code: 'IDEMPOTENCY_KEY_REUSED', sideEffects: 'none' });
    expect(() =>
      decideIdempotentJobCreation({
        scope,
        requestSha256,
        existing: {
          scope: { ...scope, workspaceId: '88888888-8888-4888-8888-888888888889' },
          requestSha256,
          job: {},
        },
      }),
    ).toThrow(/exact authoritative scope/);
  });
});
