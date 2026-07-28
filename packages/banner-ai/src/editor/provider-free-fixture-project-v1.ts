import { z } from 'zod';

import { PersistedSceneVersionIdSchema } from '../jobs/syntax.js';
import {
  BannerSceneV1Schema,
  parseBannerSceneV1,
  type BannerSceneV1,
} from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256BannerScene, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  WorkflowManifestRefV1Schema,
  type WorkflowManifestRefV1,
} from '../scene/export-reproduction-manifest-v1.schema.js';
import { INITIAL_BANNER_ANALYZE_WORKFLOW_V1 } from '../workflows/workflow-definition.js';
import {
  GENTLE_FLOAT_PRESET_V1,
  PROVIDER_FREE_BACKGROUND_PART_ID_V1,
  PROVIDER_FREE_LAYER_IDS_V1,
  PROVIDER_FREE_SOLID_BACKGROUND_V1,
  createGentleFloatTrackV1,
  isProviderFreeLayerIdV1,
  type ProviderFreeSelectedPartIdV1,
} from './provider-free-banner-scene-v1.js';
import {
  PROVIDER_FREE_FIXTURE_ID_V1,
  PROVIDER_FREE_PROJECT_DISPLAY_NAME_V1,
  PROVIDER_FREE_PROJECT_ID_V1,
} from './provider-free-identities-v1.js';

export const MAX_PROVIDER_FREE_PROJECT_REVISIONS_V1 = 32;

const providerFreeSceneEditDefinitionV1 = Object.freeze({
  definitionVersion: 1 as const,
  workflowKey: 'banner.scene-edit' as const,
  execution: 'synchronous-local-provider-free' as const,
  networkAccess: 'disabled' as const,
  providerCalls: 0 as const,
  estimatedCostMicros: '0' as const,
  allowedMutations: Object.freeze([
    'background-inclusion',
    'layer-inclusion',
    'layer-visibility',
    'gentle-float-v1',
  ] as const),
  gentleFloat: GENTLE_FLOAT_PRESET_V1,
});

export const PROVIDER_FREE_SCENE_EDIT_WORKFLOW_V1 = Object.freeze({
  workflowVersionId: '33333333-3333-5333-8333-333333333333' as const,
  workflowVersion: 1 as const,
  definitionSha256: sha256Hex(
    Buffer.from(canonicalizeJson(providerFreeSceneEditDefinitionV1), 'utf8'),
  ),
  definition: providerFreeSceneEditDefinitionV1,
});

export const PROVIDER_FREE_SCENE_EDIT_WORKFLOW_REF_V1 = WorkflowManifestRefV1Schema.parse({
  workflowVersionId: PROVIDER_FREE_SCENE_EDIT_WORKFLOW_V1.workflowVersionId,
  workflowVersion: PROVIDER_FREE_SCENE_EDIT_WORKFLOW_V1.workflowVersion,
  definitionSha256: PROVIDER_FREE_SCENE_EDIT_WORKFLOW_V1.definitionSha256,
});

export const PROVIDER_FREE_INITIAL_SCENE_WORKFLOW_REF_V1 = WorkflowManifestRefV1Schema.parse({
  workflowVersionId: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
  workflowVersion: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersion,
  definitionSha256: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definitionSha256,
});

const ProviderFreeSelectedPartIdV1Schema = z.enum([
  PROVIDER_FREE_BACKGROUND_PART_ID_V1,
  ...PROVIDER_FREE_LAYER_IDS_V1,
]);

const ProviderFreeBannerProjectRevisionV1Schema = z.strictObject({
  revision: z.int().min(1).max(MAX_PROVIDER_FREE_PROJECT_REVISIONS_V1),
  sceneVersionId: PersistedSceneVersionIdSchema,
  sceneSha256: z.string().regex(/^[0-9a-f]{64}$/),
  parentSceneSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  sceneWorkflow: WorkflowManifestRefV1Schema,
  scene: BannerSceneV1Schema,
});

const sameCanonicalValue = (left: unknown, right: unknown): boolean =>
  canonicalizeJson(left) === canonicalizeJson(right);

const workflowForRevision = (revision: number): WorkflowManifestRefV1 =>
  revision === 1
    ? PROVIDER_FREE_INITIAL_SCENE_WORKFLOW_REF_V1
    : PROVIDER_FREE_SCENE_EDIT_WORKFLOW_REF_V1;

const uuidFromDigest = (digest: string): string => {
  const characters = [...digest.slice(0, 32)];
  characters[12] = '5';
  characters[16] = ((Number.parseInt(characters[16]!, 16) & 0x3) | 0x8).toString(16);
  const hex = characters.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
};

export const deriveProviderFreeSceneVersionIdV1 = (input: {
  readonly revision: number;
  readonly sceneSha256: string;
  readonly parentSceneSha256: string | null;
  readonly sceneWorkflow: WorkflowManifestRefV1;
}): z.infer<typeof PersistedSceneVersionIdSchema> => {
  const digest = sha256Hex(
    Buffer.from(
      canonicalizeJson({
        identityVersion: 1,
        projectId: PROVIDER_FREE_PROJECT_ID_V1,
        revision: input.revision,
        sceneSha256: input.sceneSha256,
        parentSceneSha256: input.parentSceneSha256,
        sceneWorkflow: input.sceneWorkflow,
      }),
      'utf8',
    ),
  );
  return PersistedSceneVersionIdSchema.parse(uuidFromDigest(digest));
};

const immutableSceneProjection = (scene: BannerSceneV1): unknown => ({
  schemaVersion: scene.schemaVersion,
  canvas: { width: scene.canvas.width, height: scene.canvas.height },
  sourceAsset: scene.sourceAsset,
  layers: scene.layers.map((layer) => ({
    id: layer.id,
    name: layer.name,
    order: layer.order,
    opacity: layer.opacity,
    asset: layer.asset,
    frame: layer.frame,
    transform: layer.transform,
  })),
  exportSettings: scene.exportSettings,
});

const hasAllowedBackground = (scene: BannerSceneV1): boolean =>
  scene.canvas.background.kind === 'transparent' ||
  sameCanonicalValue(scene.canvas.background, PROVIDER_FREE_SOLID_BACKGROUND_V1);

const hasAllowedTimeline = (scene: BannerSceneV1): boolean => {
  if (scene.timeline.length === 0) return true;
  const track = scene.timeline[0];
  return (
    scene.timeline.length === 1 &&
    track !== undefined &&
    isProviderFreeLayerIdV1(track.targetLayerId) &&
    sameCanonicalValue(track, createGentleFloatTrackV1(track.targetLayerId))
  );
};

const ProviderFreeBannerProjectV1StructuralSchema = z.strictObject({
  envelopeVersion: z.literal(1),
  fixtureId: z.literal(PROVIDER_FREE_FIXTURE_ID_V1),
  projectId: z.literal(PROVIDER_FREE_PROJECT_ID_V1),
  displayName: z.literal(PROVIDER_FREE_PROJECT_DISPLAY_NAME_V1),
  selectedPartId: ProviderFreeSelectedPartIdV1Schema,
  revisions: z
    .array(ProviderFreeBannerProjectRevisionV1Schema)
    .min(1)
    .max(MAX_PROVIDER_FREE_PROJECT_REVISIONS_V1)
    .readonly(),
  currentAcceptedRevision: z.int().min(1).max(MAX_PROVIDER_FREE_PROJECT_REVISIONS_V1),
});

export const ProviderFreeBannerProjectV1Schema =
  ProviderFreeBannerProjectV1StructuralSchema.superRefine((project, context) => {
    const firstScene = project.revisions[0]?.scene;
    if (project.currentAcceptedRevision !== project.revisions.length) {
      context.addIssue({
        code: 'custom',
        path: ['currentAcceptedRevision'],
        message: 'Current accepted revision must identify the append-only tail.',
      });
    }

    for (const [index, revision] of project.revisions.entries()) {
      const expectedRevision = index + 1;
      const expectedParent = index === 0 ? null : project.revisions[index - 1]!.sceneSha256;
      const expectedWorkflow = workflowForRevision(expectedRevision);
      const expectedDigest = sha256BannerScene(revision.scene);
      const expectedSceneVersionId = deriveProviderFreeSceneVersionIdV1({
        revision: expectedRevision,
        sceneSha256: expectedDigest,
        parentSceneSha256: expectedParent,
        sceneWorkflow: expectedWorkflow,
      });

      if (revision.revision !== expectedRevision) {
        context.addIssue({
          code: 'custom',
          path: ['revisions', index, 'revision'],
          message: 'Project revisions must be contiguous and stored in ascending order.',
        });
      }
      if (revision.sceneSha256 !== expectedDigest) {
        context.addIssue({
          code: 'custom',
          path: ['revisions', index, 'sceneSha256'],
          message: 'Scene digest must match the canonical scene.',
        });
      }
      if (revision.parentSceneSha256 !== expectedParent) {
        context.addIssue({
          code: 'custom',
          path: ['revisions', index, 'parentSceneSha256'],
          message: 'Scene revision ancestry is invalid.',
        });
      }
      if (!sameCanonicalValue(revision.sceneWorkflow, expectedWorkflow)) {
        context.addIssue({
          code: 'custom',
          path: ['revisions', index, 'sceneWorkflow'],
          message: 'Scene revision workflow provenance is invalid.',
        });
      }
      if (revision.sceneVersionId !== expectedSceneVersionId) {
        context.addIssue({
          code: 'custom',
          path: ['revisions', index, 'sceneVersionId'],
          message: 'Scene version identity is invalid.',
        });
      }
      if (!hasAllowedBackground(revision.scene) || !hasAllowedTimeline(revision.scene)) {
        context.addIssue({
          code: 'custom',
          path: ['revisions', index, 'scene'],
          message: 'Scene revision contains a mutation outside the provider-free edit contract.',
        });
      }
      if (
        firstScene !== undefined &&
        !sameCanonicalValue(
          immutableSceneProjection(revision.scene),
          immutableSceneProjection(firstScene),
        )
      ) {
        context.addIssue({
          code: 'custom',
          path: ['revisions', index, 'scene'],
          message: 'Immutable scene material drifted across revisions.',
        });
      }
    }

    if (
      firstScene === undefined ||
      !sameCanonicalValue(firstScene.canvas.background, PROVIDER_FREE_SOLID_BACKGROUND_V1) ||
      firstScene.timeline.length !== 0 ||
      firstScene.layers.length !== PROVIDER_FREE_LAYER_IDS_V1.length ||
      firstScene.layers.some(
        (layer, index) =>
          layer.id !== PROVIDER_FREE_LAYER_IDS_V1[index] || !layer.included || !layer.visible,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['revisions', 0, 'scene'],
        message: 'Initial provider-free fixture scene is invalid.',
      });
    }
  });

export type ProviderFreeBannerProjectRevisionV1 = z.infer<
  typeof ProviderFreeBannerProjectRevisionV1Schema
>;
export type ProviderFreeBannerProjectV1 = z.infer<typeof ProviderFreeBannerProjectV1Schema>;

export const parseProviderFreeBannerProjectV1 = (input: unknown): ProviderFreeBannerProjectV1 => {
  const parsed = ProviderFreeBannerProjectV1Schema.safeParse(input);
  if (!parsed.success) {
    throw new TypeError('Provider-free project data failed strict validation.');
  }
  return parsed.data;
};

export const createInitialProviderFreeBannerProjectV1 = (
  sceneInput: BannerSceneV1,
): ProviderFreeBannerProjectV1 => {
  const parsedScene = parseBannerSceneV1(sceneInput);
  if (!parsedScene.success) {
    throw new TypeError('Initial provider-free fixture scene is invalid.');
  }
  const scene = parsedScene.data;
  const sceneSha256 = sha256BannerScene(scene);
  const sceneWorkflow = PROVIDER_FREE_INITIAL_SCENE_WORKFLOW_REF_V1;
  const revision = 1;
  return parseProviderFreeBannerProjectV1({
    envelopeVersion: 1,
    fixtureId: PROVIDER_FREE_FIXTURE_ID_V1,
    projectId: PROVIDER_FREE_PROJECT_ID_V1,
    displayName: PROVIDER_FREE_PROJECT_DISPLAY_NAME_V1,
    selectedPartId: PROVIDER_FREE_BACKGROUND_PART_ID_V1,
    revisions: [
      {
        revision,
        sceneVersionId: deriveProviderFreeSceneVersionIdV1({
          revision,
          sceneSha256,
          parentSceneSha256: null,
          sceneWorkflow,
        }),
        sceneSha256,
        parentSceneSha256: null,
        sceneWorkflow,
        scene,
      },
    ],
    currentAcceptedRevision: revision,
  });
};

export const validateProviderFreeBannerProjectAgainstFixtureV1 = (input: {
  readonly project: unknown;
  readonly initialScene: BannerSceneV1;
}): ProviderFreeBannerProjectV1 => {
  const project = parseProviderFreeBannerProjectV1(input.project);
  const initialScene = parseBannerSceneV1(input.initialScene);
  if (
    !initialScene.success ||
    !sameCanonicalValue(project.revisions[0]!.scene, initialScene.data)
  ) {
    throw new TypeError('Provider-free project does not match the fixed fixture scene.');
  }
  return project;
};

export const appendProviderFreeBannerProjectRevisionV1 = (input: {
  readonly project: unknown;
  readonly scene: BannerSceneV1;
  readonly selectedPartId: ProviderFreeSelectedPartIdV1;
}): ProviderFreeBannerProjectV1 => {
  const project = parseProviderFreeBannerProjectV1(input.project);
  if (project.revisions.length >= MAX_PROVIDER_FREE_PROJECT_REVISIONS_V1) {
    throw new RangeError('The provider-free project revision limit was reached.');
  }
  const parsedScene = parseBannerSceneV1(input.scene);
  if (!parsedScene.success) {
    throw new TypeError('The provider-free project draft is invalid.');
  }
  const scene = parsedScene.data;
  const current = project.revisions.at(-1)!;
  const sceneSha256 = sha256BannerScene(scene);
  const selectedPartId = ProviderFreeSelectedPartIdV1Schema.parse(input.selectedPartId);
  if (sceneSha256 === current.sceneSha256 && selectedPartId === project.selectedPartId) {
    throw new TypeError('The provider-free project draft has no changes to save.');
  }
  const revision = project.revisions.length + 1;
  const sceneWorkflow = PROVIDER_FREE_SCENE_EDIT_WORKFLOW_REF_V1;
  return parseProviderFreeBannerProjectV1({
    ...project,
    selectedPartId,
    revisions: [
      ...project.revisions,
      {
        revision,
        sceneVersionId: deriveProviderFreeSceneVersionIdV1({
          revision,
          sceneSha256,
          parentSceneSha256: current.sceneSha256,
          sceneWorkflow,
        }),
        sceneSha256,
        parentSceneSha256: current.sceneSha256,
        sceneWorkflow,
        scene,
      },
    ],
    currentAcceptedRevision: revision,
  });
};

export const setProviderFreeBannerProjectSelectionV1 = (input: {
  readonly project: unknown;
  readonly selectedPartId: ProviderFreeSelectedPartIdV1;
}): ProviderFreeBannerProjectV1 =>
  parseProviderFreeBannerProjectV1({
    ...parseProviderFreeBannerProjectV1(input.project),
    selectedPartId: ProviderFreeSelectedPartIdV1Schema.parse(input.selectedPartId),
  });
