import { z } from 'zod';

import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  SAM_FIRST_INFERENCE_ENDPOINT_ID,
  SAM_FIRST_INFERENCE_ENDPOINT_NAME,
  SAM_FIRST_INFERENCE_ENDPOINT_VERSION,
  SAM_FIRST_INFERENCE_WORKER_IMAGE,
} from './sam-runpod-direct-v3-request-preparation.js';

export const SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1_SCHEMA_ID =
  'fabrica-sam-text-heavy-runpod-deployment-v1' as const;

const CanonicalPortsSchema = z.tuple([z.literal('8000/http')]).readonly();
const CanonicalTemplateIdentitySchema = z.strictObject({ state: z.literal('absent') }).readonly();

export const SamTextHeavyRunPodDeploymentV1Schema = z
  .strictObject({
    schema: z.literal(SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1_SCHEMA_ID),
    version: z.literal(1),
    endpointId: z.literal(SAM_FIRST_INFERENCE_ENDPOINT_ID),
    endpointName: z.literal(SAM_FIRST_INFERENCE_ENDPOINT_NAME),
    endpointType: z.literal('LOAD_BALANCING'),
    endpointVersion: z.literal(SAM_FIRST_INFERENCE_ENDPOINT_VERSION),
    workerImage: z.literal(SAM_FIRST_INFERENCE_WORKER_IMAGE),
    minimumWorkers: z.literal(0),
    maximumWorkers: z.literal(1),
    gpuCount: z.literal(1),
    ports: CanonicalPortsSchema,
    templateIdentity: CanonicalTemplateIdentitySchema,
  })
  .readonly();

export type SamTextHeavyRunPodDeploymentV1 = z.infer<typeof SamTextHeavyRunPodDeploymentV1Schema>;

export const SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1 = SamTextHeavyRunPodDeploymentV1Schema.parse(
  Object.freeze({
    schema: SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1_SCHEMA_ID,
    version: 1 as const,
    endpointId: SAM_FIRST_INFERENCE_ENDPOINT_ID,
    endpointName: SAM_FIRST_INFERENCE_ENDPOINT_NAME,
    endpointType: 'LOAD_BALANCING' as const,
    endpointVersion: SAM_FIRST_INFERENCE_ENDPOINT_VERSION,
    workerImage: SAM_FIRST_INFERENCE_WORKER_IMAGE,
    minimumWorkers: 0 as const,
    maximumWorkers: 1 as const,
    gpuCount: 1 as const,
    ports: Object.freeze(['8000/http'] as const),
    templateIdentity: Object.freeze({ state: 'absent' as const }),
  }),
);

export const SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1_CANONICAL_SHA256 =
  '3dc9365383ee512316e8883503071243d6b35dfae489967008ab7396c19b72dd' as const;

const canonicalDeploymentSha256 = sha256Hex(
  Buffer.from(canonicalizeJson(SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1), 'utf8'),
);

if (canonicalDeploymentSha256 !== SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1_CANONICAL_SHA256) {
  throw new TypeError('SAM text-heavy RunPod deployment identity digest drifted.');
}

const workerImageSeparator = SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1.workerImage.lastIndexOf('@');
export const SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1_WORKER_IMAGE_DIGEST =
  SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1.workerImage.slice(workerImageSeparator + 1);

if (
  workerImageSeparator < 1 ||
  !/^sha256:[0-9a-f]{64}$/u.test(SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1_WORKER_IMAGE_DIGEST)
) {
  throw new TypeError('SAM text-heavy RunPod deployment image is not immutable.');
}

const ObservedDeploymentFieldsSchema = z
  .strictObject({
    endpointId: z.string().min(1).max(63),
    endpointName: z.string().min(1).max(256),
    endpointType: z.string().min(1).max(64),
    endpointVersion: z.int(),
    workerImage: z.string().min(1).max(1_024),
    minimumWorkers: z.int(),
    maximumWorkers: z.int(),
    gpuCount: z.int(),
    ports: z.array(z.string().min(1).max(64)).readonly(),
    templateIdentity: CanonicalTemplateIdentitySchema,
  })
  .readonly();

export const SamTextHeavyRunPodObservedDeploymentV1Schema = z
  .strictObject({
    schema: z.literal('fabrica-sam-text-heavy-runpod-observed-deployment-v1'),
    version: z.literal(1),
    deployment: ObservedDeploymentFieldsSchema,
  })
  .readonly();

export type SamTextHeavyRunPodObservedDeploymentV1 = z.infer<
  typeof SamTextHeavyRunPodObservedDeploymentV1Schema
>;

export interface SamTextHeavyRunPodDeploymentComparisonV1 {
  readonly schema: 'fabrica-sam-text-heavy-runpod-deployment-comparison-v1';
  readonly version: 1;
  readonly comparisonKind: 'semantic-only-no-observation-authority';
  readonly expected: SamTextHeavyRunPodDeploymentV1;
  readonly observed: SamTextHeavyRunPodObservedDeploymentV1['deployment'];
  readonly expectedDeploymentSha256: typeof SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1_CANONICAL_SHA256;
  readonly matches: true;
  readonly productionEvidence: false;
}

const comparableExpectedDeployment = Object.freeze({
  endpointId: SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1.endpointId,
  endpointName: SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1.endpointName,
  endpointType: SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1.endpointType,
  endpointVersion: SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1.endpointVersion,
  workerImage: SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1.workerImage,
  minimumWorkers: SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1.minimumWorkers,
  maximumWorkers: SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1.maximumWorkers,
  gpuCount: SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1.gpuCount,
  ports: SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1.ports,
  templateIdentity: SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1.templateIdentity,
});

/** Pure semantic comparison only; trusted preflight code must establish observation provenance. */
export const compareSamTextHeavyRunPodDeploymentV1Observation = (
  input: unknown,
): SamTextHeavyRunPodDeploymentComparisonV1 => {
  const observed = (() => {
    try {
      return SamTextHeavyRunPodObservedDeploymentV1Schema.parse(input);
    } catch {
      throw new TypeError('SAM text-heavy RunPod deployment observation failed closed.');
    }
  })();
  if (canonicalizeJson(observed.deployment) !== canonicalizeJson(comparableExpectedDeployment)) {
    throw new TypeError('SAM text-heavy RunPod deployment comparison failed closed.');
  }
  return Object.freeze({
    schema: 'fabrica-sam-text-heavy-runpod-deployment-comparison-v1' as const,
    version: 1 as const,
    comparisonKind: 'semantic-only-no-observation-authority' as const,
    expected: SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1,
    observed: observed.deployment,
    expectedDeploymentSha256: SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1_CANONICAL_SHA256,
    matches: true as const,
    productionEvidence: false as const,
  });
};
