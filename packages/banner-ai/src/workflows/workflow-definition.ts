import { z } from 'zod';

import {
  BannerOperationSchema,
  OutputKeySchema,
  PersistedWorkflowVersionIdSchema,
  StepKeySchema,
} from '../jobs/syntax.js';
import { PositiveInt32Schema, Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';

export const WorkflowStepKindSchema = z.enum([
  'source_load',
  'scene_load',
  'fixture_analysis',
  'fixture_extraction',
  'deterministic_export',
  'output_validation',
  'atomic_persistence',
]);

export const WorkflowOutputKindSchema = z.enum([
  'analysis_proposal',
  'asset_version',
  'banner_scene_version',
  'export_artifact',
]);

export const WorkflowOutputDispositionSchema = z.enum(['checkpoint', 'final']);

export const WorkflowStepDefinitionV1Schema = z
  .strictObject({
    stepKey: StepKeySchema,
    kind: WorkflowStepKindSchema,
    weightBps: z.int().min(1).max(10_000),
    replaySafe: z.boolean(),
    externalIdempotency: z.enum(['none', 'job-step-call-v1']),
  })
  .readonly();

export const WorkflowOutputDeclarationV1Schema = z
  .strictObject({
    outputKey: OutputKeySchema,
    kind: WorkflowOutputKindSchema,
    disposition: WorkflowOutputDispositionSchema,
    producingStepKey: StepKeySchema,
    replaySafe: z.boolean(),
  })
  .superRefine((output, context) => {
    if (output.kind === 'export_artifact' && output.disposition !== 'final') {
      context.addIssue({
        code: 'custom',
        message: 'Export artifacts are final outputs and cannot be checkpoints.',
      });
    }
  })
  .readonly();

const allowedKindsByOperation = Object.freeze({
  'banner.analyze': new Set([
    'source_load',
    'fixture_analysis',
    'output_validation',
    'atomic_persistence',
  ]),
  'banner.extract': new Set([
    'source_load',
    'fixture_extraction',
    'output_validation',
    'atomic_persistence',
  ]),
  'banner.export': new Set([
    'scene_load',
    'deterministic_export',
    'output_validation',
    'atomic_persistence',
  ]),
} satisfies Record<z.infer<typeof BannerOperationSchema>, ReadonlySet<string>>);

export const WorkflowDefinitionV1Schema = z
  .strictObject({
    definitionVersion: z.literal(1),
    workflowKey: BannerOperationSchema,
    steps: z.array(WorkflowStepDefinitionV1Schema).min(1).max(16).readonly(),
    outputs: z.array(WorkflowOutputDeclarationV1Schema).min(1).max(16).readonly(),
    policy: z
      .strictObject({
        maxAttempts: z.literal(3),
        maxProviderCalls: z.literal(64),
        attemptTimeoutMs: z.literal(120_000),
        jobTimeoutMs: z.literal(600_000),
        leaseDurationMs: z.literal(30_000),
        heartbeatIntervalMs: z.literal(10_000),
        maxCapabilityCallMs: z.literal(60_000),
      })
      .readonly(),
  })
  .superRefine((definition, context) => {
    const stepKeys = new Set<string>();
    const stepByKey = new Map<string, (typeof definition.steps)[number]>();
    let weightTotal = 0;
    for (const [index, step] of definition.steps.entries()) {
      weightTotal += step.weightBps;
      if (stepKeys.has(step.stepKey)) {
        context.addIssue({
          code: 'custom',
          message: 'Workflow step keys must be unique.',
          path: ['steps', index, 'stepKey'],
        });
      }
      if (!allowedKindsByOperation[definition.workflowKey].has(step.kind)) {
        context.addIssue({
          code: 'custom',
          message: 'Workflow step kind does not belong to this product operation.',
          path: ['steps', index, 'kind'],
        });
      }
      stepKeys.add(step.stepKey);
      stepByKey.set(step.stepKey, step);
    }
    if (weightTotal !== 10_000) {
      context.addIssue({
        code: 'custom',
        message: 'Workflow step weights must sum exactly to 10,000 basis points.',
        path: ['steps'],
      });
    }

    const outputKeys = new Set<string>();
    let finalCount = 0;
    for (const [index, output] of definition.outputs.entries()) {
      if (outputKeys.has(output.outputKey)) {
        context.addIssue({
          code: 'custom',
          message: 'Workflow output keys must be unique.',
          path: ['outputs', index, 'outputKey'],
        });
      }
      outputKeys.add(output.outputKey);
      if (output.disposition === 'final') finalCount += 1;
      const producingStep = stepByKey.get(output.producingStepKey);
      if (producingStep === undefined) {
        context.addIssue({
          code: 'custom',
          message: 'Workflow output must name an existing producing step.',
          path: ['outputs', index, 'producingStepKey'],
        });
      } else if (output.replaySafe !== producingStep.replaySafe) {
        context.addIssue({
          code: 'custom',
          message: 'Workflow output replay safety must equal its producing step policy.',
          path: ['outputs', index, 'replaySafe'],
        });
      }
    }
    if (finalCount < 1) {
      context.addIssue({
        code: 'custom',
        message: 'Workflow must declare at least one final output.',
        path: ['outputs'],
      });
    }
  })
  .readonly();

export type WorkflowStepDefinitionV1 = z.infer<typeof WorkflowStepDefinitionV1Schema>;
export type WorkflowOutputDeclarationV1 = z.infer<typeof WorkflowOutputDeclarationV1Schema>;
export type WorkflowDefinitionV1 = z.infer<typeof WorkflowDefinitionV1Schema>;

export const computeWorkflowDefinitionSha256 = (definition: WorkflowDefinitionV1): string =>
  sha256Hex(Buffer.from(canonicalizeJson(WorkflowDefinitionV1Schema.parse(definition)), 'utf8'));

export const WorkflowVersionContractSchema = z
  .strictObject({
    workflowVersionId: PersistedWorkflowVersionIdSchema,
    workflowVersion: PositiveInt32Schema,
    definitionSha256: Sha256HexSchema,
    definition: WorkflowDefinitionV1Schema,
  })
  .superRefine((workflow, context) => {
    if (computeWorkflowDefinitionSha256(workflow.definition) !== workflow.definitionSha256) {
      context.addIssue({
        code: 'custom',
        message: 'Workflow definition digest does not match its canonical immutable definition.',
        path: ['definitionSha256'],
      });
    }
  })
  .readonly();

export type WorkflowVersionContract = z.infer<typeof WorkflowVersionContractSchema>;

const initialBannerAnalyzeDefinition = WorkflowDefinitionV1Schema.parse({
  definitionVersion: 1,
  workflowKey: 'banner.analyze',
  steps: [
    {
      stepKey: 'source-load',
      kind: 'source_load',
      weightBps: 1_000,
      replaySafe: true,
      externalIdempotency: 'none',
    },
    {
      stepKey: 'fixture-analysis',
      kind: 'fixture_analysis',
      weightBps: 6_000,
      replaySafe: true,
      externalIdempotency: 'job-step-call-v1',
    },
    {
      stepKey: 'output-validation',
      kind: 'output_validation',
      weightBps: 1_500,
      replaySafe: true,
      externalIdempotency: 'none',
    },
    {
      stepKey: 'atomic-persistence',
      kind: 'atomic_persistence',
      weightBps: 1_500,
      replaySafe: true,
      externalIdempotency: 'none',
    },
  ],
  outputs: [
    {
      outputKey: 'analysis.fixture-proposal',
      kind: 'analysis_proposal',
      disposition: 'checkpoint',
      producingStepKey: 'fixture-analysis',
      replaySafe: true,
    },
    {
      outputKey: 'analysis.proposal',
      kind: 'analysis_proposal',
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

export const INITIAL_BANNER_ANALYZE_WORKFLOW_V1 = WorkflowVersionContractSchema.parse({
  workflowVersionId: '11111111-1111-5111-8111-111111111111',
  workflowVersion: 1,
  definitionSha256: computeWorkflowDefinitionSha256(initialBannerAnalyzeDefinition),
  definition: initialBannerAnalyzeDefinition,
});

export const workflowCumulativeBoundaries = (
  definition: WorkflowDefinitionV1,
): readonly number[] => {
  const parsed = WorkflowDefinitionV1Schema.parse(definition);
  let cumulative = 0;
  return Object.freeze(
    parsed.steps.map((step) => {
      cumulative += step.weightBps;
      return cumulative;
    }),
  );
};
