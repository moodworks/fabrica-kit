import { lstat } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { canonicalizeJson, sha256Hex } from '../src/scene/canonical-scene-json.js';
import { SAM_CORPUS_EVALUATION_FIXTURES_V1 } from '../src/server/sam-corpus-evaluation-catalog-v1.js';
import { SAM_TEXT_HEAVY_PRODUCTION_V3_FROZEN_CORPUS_REQUEST_IDENTITY } from '../src/server/sam-text-heavy-production-v3-authorization.js';
import {
  createTestOnlySamTextHeavyProductionV3TransportFactory,
  inspectTestOnlySamTextHeavyProductionV3TransportFactory,
} from '../src/server/sam-text-heavy-production-v3-control.js';
import {
  SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1,
  SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1_CANONICAL_SHA256,
  SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1_SCHEMA_ID,
  SamTextHeavyRunPodDeploymentV1Schema,
  compareSamTextHeavyRunPodDeploymentV1Observation,
} from '../src/server/sam-text-heavy-production-v3-deployment.js';
import {
  SAM_TEXT_HEAVY_PRODUCTION_V3_CLAIM_ROOT,
  SAM_TEXT_HEAVY_PRODUCTION_V3_OUTPUT_NAMING_POLICY,
  SAM_TEXT_HEAVY_PRODUCTION_V3_OUTPUT_NAMING_POLICY_SHA256,
  classifySamTextHeavyProductionV3PriorOutputBasename,
  deriveSamTextHeavyProductionV3CanonicalCallEvidence,
  prepareSamTextHeavyProductionV3OutputTarget,
  summarizeSamTextHeavyProductionV3PriorOutputBasenames,
} from '../src/server/sam-text-heavy-production-v3-reservation.js';
import { SAM_TEXT_HEAVY_PRODUCTION_V3_CORPUS_PROVENANCE_SHA } from '../src/server/sam-text-heavy-production-v3-repository-binding.js';
import { createValidTestOnlySamTextHeavyProductionV3RepositoryBinding } from './sam-text-heavy-production-v3-test-helpers.js';

const expectedDeployment = {
  schema: 'fabrica-sam-text-heavy-runpod-deployment-v1',
  version: 1,
  endpointId: 'sawwuq4u7oiftj',
  endpointName: 'fabrica-sam21-baseplus-build3',
  endpointType: 'LOAD_BALANCING',
  endpointVersion: 12,
  workerImage:
    'ghcr.io/moodworks/fabrica-sam-worker@sha256:5f6058eb5f626ada2ce9ad3e9f105cd12b601f614df83265ab8479c8403ae7a8',
  minimumWorkers: 0,
  maximumWorkers: 1,
  gpuCount: 1,
  ports: ['8000/http'],
  templateIdentity: { state: 'absent' },
} as const;

const observedDeployment = () => ({
  schema: 'fabrica-sam-text-heavy-runpod-observed-deployment-v1' as const,
  version: 1 as const,
  deployment: {
    endpointId: expectedDeployment.endpointId,
    endpointName: expectedDeployment.endpointName,
    endpointType: expectedDeployment.endpointType,
    endpointVersion: expectedDeployment.endpointVersion,
    workerImage: expectedDeployment.workerImage,
    minimumWorkers: expectedDeployment.minimumWorkers,
    maximumWorkers: expectedDeployment.maximumWorkers,
    gpuCount: expectedDeployment.gpuCount,
    ports: [...expectedDeployment.ports],
    templateIdentity: { ...expectedDeployment.templateIdentity },
  },
});

const replace = (
  key: keyof typeof expectedDeployment,
  value: unknown,
): Record<string, unknown> => ({ ...structuredClone(expectedDeployment), [key]: value });

const absent = async (path: string): Promise<boolean> => {
  try {
    await lstat(path);
    return false;
  } catch (error) {
    return (
      typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
    );
  }
};

describe('SAM text-heavy RunPod deployment V1 closed identity', () => {
  it('accepts exactly one complete deeply immutable deployment object', () => {
    expect(SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1_SCHEMA_ID).toBe(
      'fabrica-sam-text-heavy-runpod-deployment-v1',
    );
    expect(SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1).toEqual(expectedDeployment);
    expect(SamTextHeavyRunPodDeploymentV1Schema.parse(expectedDeployment)).toEqual(
      expectedDeployment,
    );
    expect(Object.isFrozen(SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1)).toBe(true);
    expect(Object.isFrozen(SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1.ports)).toBe(true);
    expect(Object.isFrozen(SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1.templateIdentity)).toBe(true);
  });

  it('derives the deterministic canonical deployment digest', () => {
    expect(
      sha256Hex(Buffer.from(canonicalizeJson(SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1), 'utf8')),
    ).toBe(SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1_CANONICAL_SHA256);
    expect(SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1_CANONICAL_SHA256).toBe(
      '3dc9365383ee512316e8883503071243d6b35dfae489967008ab7396c19b72dd',
    );
  });

  it.each(Object.keys(expectedDeployment))('rejects a missing %s field', (key) => {
    const candidate = structuredClone(expectedDeployment) as Record<string, unknown>;
    delete candidate[key];
    expect(SamTextHeavyRunPodDeploymentV1Schema.safeParse(candidate).success).toBe(false);
  });

  it('rejects unknown keys, caller overrides, partial objects, and defaults', () => {
    expect(
      SamTextHeavyRunPodDeploymentV1Schema.safeParse({ ...expectedDeployment, extra: true })
        .success,
    ).toBe(false);
    expect(
      SamTextHeavyRunPodDeploymentV1Schema.safeParse({
        endpointId: expectedDeployment.endpointId,
      }).success,
    ).toBe(false);
    expect(
      SamTextHeavyRunPodDeploymentV1Schema.safeParse({
        ...expectedDeployment,
        endpointId: 'caller-override',
      }).success,
    ).toBe(false);
  });

  it.each([
    ['schema', 'other'],
    ['version', 2],
    ['endpointId', 'different'],
    ['endpointName', 'different'],
    ['endpointType', 'QUEUE'],
    ['endpointVersion', 11],
    ['workerImage', 'ghcr.io/moodworks/fabrica-sam-worker:latest'],
    ['workerImage', `ghcr.io/moodworks/fabrica-sam-worker@sha256:${'0'.repeat(64)}`],
    ['minimumWorkers', 1],
    ['maximumWorkers', 2],
    ['gpuCount', 2],
  ] as const)('rejects a wrong literal %s value', (key, value) => {
    expect(SamTextHeavyRunPodDeploymentV1Schema.safeParse(replace(key, value)).success).toBe(false);
  });

  it.each([
    ['schema', 1],
    ['version', '1'],
    ['endpointId', 1],
    ['endpointName', null],
    ['endpointType', false],
    ['endpointVersion', '12'],
    ['endpointVersion', 12.5],
    ['workerImage', {}],
    ['minimumWorkers', '0'],
    ['minimumWorkers', 0.5],
    ['maximumWorkers', '1'],
    ['maximumWorkers', 1.5],
    ['gpuCount', '1'],
    ['gpuCount', 1.5],
  ] as const)('rejects wrong scalar representation for %s', (key, value) => {
    expect(SamTextHeavyRunPodDeploymentV1Schema.safeParse(replace(key, value)).success).toBe(false);
  });

  it.each([
    [],
    ['8000/http', '8001/http'],
    ['8000/http', '8000/http'],
    ['8001/http', '8000/http'],
    ['8000/http', 8000],
    '8000/http',
  ])('rejects non-exact ports %#', (ports) => {
    expect(SamTextHeavyRunPodDeploymentV1Schema.safeParse(replace('ports', ports)).success).toBe(
      false,
    );
  });

  it.each([undefined, null, {}, { state: 'present' }, { state: 'absent', id: 'template' }])(
    'rejects ambiguous or present template identity %#',
    (templateIdentity) => {
      expect(
        SamTextHeavyRunPodDeploymentV1Schema.safeParse(
          replace('templateIdentity', templateIdentity),
        ).success,
      ).toBe(false);
    },
  );

  it('compares sanitized observed fields without letting observations define expectations', () => {
    const input = observedDeployment();
    const comparison = compareSamTextHeavyRunPodDeploymentV1Observation(input);
    expect(comparison).toEqual({
      schema: 'fabrica-sam-text-heavy-runpod-deployment-comparison-v1',
      version: 1,
      comparisonKind: 'semantic-only-no-observation-authority',
      expected: SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1,
      observed: input.deployment,
      expectedDeploymentSha256: SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1_CANONICAL_SHA256,
      matches: true,
      productionEvidence: false,
    });
    (input.deployment as { endpointName: string }).endpointName = 'mutated-after-validation';
    expect(comparison.expected.endpointName).toBe('fabrica-sam21-baseplus-build3');
    expect(comparison.observed.endpointName).toBe('fabrica-sam21-baseplus-build3');
  });

  it('never converts a semantic or test-labelled observation into production evidence', () => {
    expect(compareSamTextHeavyRunPodDeploymentV1Observation(observedDeployment())).toMatchObject({
      comparisonKind: 'semantic-only-no-observation-authority',
      matches: true,
      productionEvidence: false,
    });
    expect(() =>
      compareSamTextHeavyRunPodDeploymentV1Observation({
        ...observedDeployment(),
        observerProvenance: 'runpod-control-plane-closed-allowlist',
      }),
    ).toThrow(/observation failed closed/u);
    expect(() =>
      compareSamTextHeavyRunPodDeploymentV1Observation({
        ...observedDeployment(),
        observerProvenance: 'test-only-injected',
      }),
    ).toThrow(/observation failed closed/u);
  });

  it.each([
    ['endpointId', 'different'],
    ['endpointName', 'different'],
    ['endpointType', 'QUEUE'],
    ['endpointVersion', 11],
    ['workerImage', 'ghcr.io/moodworks/fabrica-sam-worker:latest'],
    ['minimumWorkers', 1],
    ['maximumWorkers', 2],
    ['gpuCount', 2],
    ['ports', []],
  ] as const)('fails a sanitized observed %s mutation', (key, value) => {
    const input = observedDeployment() as unknown as {
      deployment: Record<string, unknown>;
    };
    input.deployment[key] = value;
    expect(() => compareSamTextHeavyRunPodDeploymentV1Observation(input)).toThrow(
      /comparison failed closed/u,
    );
  });

  it('rejects malformed, missing, unknown, and contradictory sanitized observations', () => {
    const missing = observedDeployment() as unknown as { deployment: Record<string, unknown> };
    delete missing.deployment.endpointVersion;
    expect(() => compareSamTextHeavyRunPodDeploymentV1Observation(missing)).toThrow(
      /observation failed closed/u,
    );
    expect(() =>
      compareSamTextHeavyRunPodDeploymentV1Observation({
        ...observedDeployment(),
        rawResponse: {},
      }),
    ).toThrow(/observation failed closed/u);
    const wrongType = observedDeployment() as unknown as { deployment: Record<string, unknown> };
    wrongType.deployment.endpointVersion = '12';
    expect(() => compareSamTextHeavyRunPodDeploymentV1Observation(wrongType)).toThrow(
      /observation failed closed/u,
    );
    const presentTemplate = observedDeployment() as unknown as {
      deployment: Record<string, unknown>;
    };
    presentTemplate.deployment.templateIdentity = { state: 'present', id: 'x' };
    expect(() => compareSamTextHeavyRunPodDeploymentV1Observation(presentTemplate)).toThrow(
      /observation failed closed/u,
    );
  });

  it('binds every deployment field and digest into authorization and canonical claim identity', () => {
    const binding = createValidTestOnlySamTextHeavyProductionV3RepositoryBinding();
    const claim = deriveSamTextHeavyProductionV3CanonicalCallEvidence(binding);
    expect(SAM_TEXT_HEAVY_PRODUCTION_V3_FROZEN_CORPUS_REQUEST_IDENTITY).toMatchObject({
      deploymentIdentity: SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1,
      deploymentIdentitySha256: SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1_CANONICAL_SHA256,
    });
    expect(claim.identity).toMatchObject({
      deploymentIdentity: SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1,
      deploymentIdentitySha256: SAM_TEXT_HEAVY_RUNPOD_DEPLOYMENT_V1_CANONICAL_SHA256,
    });
    for (const key of Object.keys(expectedDeployment)) {
      const mutatedIdentity = structuredClone(claim.identity) as unknown as Record<string, unknown>;
      const deployment = mutatedIdentity.deploymentIdentity as Record<string, unknown>;
      deployment[key] = `mutation-${key}`;
      const mutationDigest = sha256Hex(Buffer.from(canonicalizeJson(mutatedIdentity), 'utf8'));
      expect(mutationDigest, key).not.toBe(claim.claimSha256);
    }
  });

  it('preserves the frozen text-heavy and product capacity refusal facts', () => {
    expect(SAM_CORPUS_EVALUATION_FIXTURES_V1['text-heavy'].capacity).toMatchObject({
      automaticOnePointPeakBytes: 114_138_112,
      ceilingBytes: 268_435_456,
      eligible: true,
    });
    expect(SAM_CORPUS_EVALUATION_FIXTURES_V1.product.capacity).toMatchObject({
      automaticOnePointPeakBytes: 650_511_040,
      eligible: false,
    });
  });

  it('leaves claim, output, transport, and dispatch state zero for deployment failures', async () => {
    const output = '/private/tmp/fabrica-sam-text-heavy-real-call-v3-00-corpus-524a708ed959';
    const dormantFactory = createTestOnlySamTextHeavyProductionV3TransportFactory({
      outcome: { kind: 'throw-after-dispatch' },
    });
    expect(await absent(SAM_TEXT_HEAVY_PRODUCTION_V3_CLAIM_ROOT)).toBe(true);
    expect(await absent(output)).toBe(true);
    for (const key of Object.keys(expectedDeployment)) {
      const candidate = structuredClone(expectedDeployment) as Record<string, unknown>;
      delete candidate[key];
      expect(SamTextHeavyRunPodDeploymentV1Schema.safeParse(candidate).success, key).toBe(false);
    }
    expect(() =>
      compareSamTextHeavyRunPodDeploymentV1Observation({
        ...observedDeployment(),
        deployment: { ...observedDeployment().deployment, endpointVersion: 11 },
      }),
    ).toThrow(/comparison failed closed/u);
    expect(await absent(SAM_TEXT_HEAVY_PRODUCTION_V3_CLAIM_ROOT)).toBe(true);
    expect(await absent(output)).toBe(true);
    expect(inspectTestOnlySamTextHeavyProductionV3TransportFactory(dormantFactory)).toEqual({
      constructionCount: 0,
      dispatchCount: 0,
      fetchCount: 0,
    });
  });
});

describe('SAM text-heavy V3 canonical corpus-labelled output naming', () => {
  it('derives the only canonical policy suffix from corpus provenance', () => {
    expect(SAM_TEXT_HEAVY_PRODUCTION_V3_OUTPUT_NAMING_POLICY).toEqual({
      schema: 'fabrica-sam-text-heavy-production-v3-output-naming-v1',
      version: 1,
      outputRoot: '/private/tmp',
      sequenceMinimum: 0,
      sequenceMaximum: 99,
      sequenceWidth: 2,
      allocationOrder: 'ascending',
      provenanceKind: 'corpus-provenance-sha-first-12',
      corpusProvenanceSha: SAM_TEXT_HEAVY_PRODUCTION_V3_CORPUS_PROVENANCE_SHA,
      corpusProvenancePrefix: SAM_TEXT_HEAVY_PRODUCTION_V3_CORPUS_PROVENANCE_SHA.slice(0, 12),
      canonicalBasenamePolicy: 'fabrica-sam-text-heavy-real-call-v3-NN-corpus-524a708ed959',
      conflictingLegacyBasenamePolicy: 'fabrica-sam-text-heavy-real-call-v3-NN-524a708ed959',
    });
    expect(SAM_TEXT_HEAVY_PRODUCTION_V3_OUTPUT_NAMING_POLICY_SHA256).toBe(
      sha256Hex(
        Buffer.from(canonicalizeJson(SAM_TEXT_HEAVY_PRODUCTION_V3_OUTPUT_NAMING_POLICY), 'utf8'),
      ),
    );
  });

  it.each(['00', '01', '99'])('accepts canonical sequence %s only as canonical', (sequence) => {
    expect(
      classifySamTextHeavyProductionV3PriorOutputBasename(
        `fabrica-sam-text-heavy-real-call-v3-${sequence}-corpus-524a708ed959`,
      ),
    ).toBe('canonical');
  });

  it('detects, but never aliases, the conflicting legacy namespace', () => {
    expect(
      classifySamTextHeavyProductionV3PriorOutputBasename(
        'fabrica-sam-text-heavy-real-call-v3-00-524a708ed959',
      ),
    ).toBe('conflicting-legacy');
    expect(
      classifySamTextHeavyProductionV3PriorOutputBasename(
        'fabrica-sam-text-heavy-real-call-v3-00-524a708ed959.fabrica-sam-corpus-staging',
      ),
    ).toBe('conflicting-legacy-staging');
  });

  it.each([
    'fabrica-sam-text-heavy-real-call-v3-0-corpus-524a708ed959',
    'fabrica-sam-text-heavy-real-call-v3-100-corpus-524a708ed959',
    'other-00-corpus-524a708ed959',
    'fabrica-sam-text-heavy-real-call-v3-00-corpus-3e44f9cec9bb',
    'fabrica-sam-text-heavy-real-call-v3-00-corpus-22f2f962bff7',
    'fabrica-sam-text-heavy-real-call-v3-00-corpus-524a708ed959-extra',
    '/private/tmp/fabrica-sam-text-heavy-real-call-v3-00-corpus-524a708ed959',
  ])('rejects arbitrary or repository-derived basename %s', (name) => {
    expect(classifySamTextHeavyProductionV3PriorOutputBasename(name)).toBeNull();
  });

  it('summarizes canonical and legacy prior state without choosing a future sequence', () => {
    expect(
      summarizeSamTextHeavyProductionV3PriorOutputBasenames([
        'unrelated',
        'fabrica-sam-text-heavy-real-call-v3-00-corpus-524a708ed959',
        'fabrica-sam-text-heavy-real-call-v3-01-corpus-524a708ed959.fabrica-sam-corpus-staging',
        'fabrica-sam-text-heavy-real-call-v3-02-524a708ed959',
        'fabrica-sam-text-heavy-real-call-v3-03-524a708ed959.fabrica-sam-corpus-staging',
      ]),
    ).toEqual({
      schema: 'fabrica-sam-text-heavy-production-v3-prior-output-state-v1',
      canonicalCount: 1,
      canonicalStagingCount: 1,
      conflictingLegacyCount: 1,
      conflictingLegacyStagingCount: 1,
      matchingEntryCount: 4,
    });
  });

  it('rejects caller path components before production selection or filesystem work', async () => {
    const repositoryBinding = createValidTestOnlySamTextHeavyProductionV3RepositoryBinding();
    await expect(
      prepareSamTextHeavyProductionV3OutputTarget({
        repositoryBinding,
        outputDirectory: '/private/tmp/fabrica-sam-text-heavy-real-call-v3-00-corpus-524a708ed959',
      } as never),
    ).rejects.toThrow(/input is not closed/u);
  });

  it('performs pure naming validation without creating a claim, output, or staging path', async () => {
    const output = '/private/tmp/fabrica-sam-text-heavy-real-call-v3-00-corpus-524a708ed959';
    const staging = `${output}.fabrica-sam-corpus-staging`;
    expect(await absent(SAM_TEXT_HEAVY_PRODUCTION_V3_CLAIM_ROOT)).toBe(true);
    expect(await absent(output)).toBe(true);
    expect(await absent(staging)).toBe(true);
    expect(classifySamTextHeavyProductionV3PriorOutputBasename(output.split('/').at(-1))).toBe(
      'canonical',
    );
    expect(await absent(SAM_TEXT_HEAVY_PRODUCTION_V3_CLAIM_ROOT)).toBe(true);
    expect(await absent(output)).toBe(true);
    expect(await absent(staging)).toBe(true);
  });
});
