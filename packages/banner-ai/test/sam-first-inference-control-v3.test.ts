import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { SAM_MASK_CONTRACT_VERSION, SamMaskRequestSchema } from '../src/sam/sam-mask-contracts.js';
import { parseAndVerifySamMaskRequest } from '../src/sam/sam-mask-validation.js';
import { canonicalizeJson, sha256Hex } from '../src/scene/canonical-scene-json.js';
import {
  SAM_FIRST_INFERENCE_ACTIVATION,
  executeSamFirstInferenceV3,
} from '../src/server/sam-first-inference-control-v3.js';
import {
  SAM_FIRST_INFERENCE_AUTHORIZATION_LIFETIME_MS,
  authorizeSamFirstInferenceV3Dispatch,
  consumeSamFirstInferenceV3AuthorizedDispatch,
  createTestOnlySamRunPodDirectV3AuthorizationSources,
  mintTestOnlySamFirstInferenceV3Authorization,
  validateTestOnlySamFirstInferenceV3Authorization,
} from '../src/server/sam-runpod-direct-v3-authorization.js';
import {
  createSamRunPodDirectV3Adapter,
  type SamRunPodDirectV3TransportPort,
} from '../src/server/sam-runpod-direct-v3-adapter.js';
import {
  SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
  createDeterministicSamRunPodDirectV3Transport,
} from '../src/server/sam-runpod-direct-v3-deterministic-fake-transport.js';
import {
  RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT_MS,
  RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS,
  SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3_SHA256,
  SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V3_SHA256,
  SAM_RUNPOD_DIRECT_HOSTING_PROFILE,
  SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
} from '../src/server/sam-runpod-direct-v3-profiles.js';
import {
  SAM_FIRST_INFERENCE_CLIENT_TIMEOUT_MS,
  SAM_FIRST_INFERENCE_COST_MAXIMUM_MICRO_USD,
  SAM_FIRST_INFERENCE_ENDPOINT_ID,
  SAM_FIRST_INFERENCE_EXECUTION_IDENTITY,
  SAM_FIRST_INFERENCE_FIXTURE,
  SAM_FIRST_INFERENCE_LOCAL_IDENTITY_EVIDENCE,
  SAM_FIRST_INFERENCE_REQUEST_IDENTIFIERS,
  SAM_FIRST_INFERENCE_REQUEST_LIMITS,
  SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
  prepareSamFirstInferenceV3Request,
  prepareSamRunPodDirectV3Request,
} from '../src/server/sam-runpod-direct-v3-request-preparation.js';

const packageRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(packageRoot, '../..');
const fileSha256 = (relativePath: string): string =>
  createHash('sha256')
    .update(readFileSync(join(repositoryRoot, relativePath)))
    .digest('hex');
const deterministicAuthorizationId = '7aa03f06-5544-4afd-8b66-a44b05fd7cb9';
const deterministicIssuedAtMs = RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS + 10_000;

const sourcesAt = (nowMs: () => number, authorizationId = deterministicAuthorizationId) =>
  createTestOnlySamRunPodDirectV3AuthorizationSources({
    nowMs,
    authorizationId: () => authorizationId,
  });

describe('first SAM inference V3 fixed preparation', () => {
  it('resolves only the committed normalized banner-person fixture without transport authority', async () => {
    const transport = createDeterministicSamRunPodDirectV3Transport();
    const first = await prepareSamFirstInferenceV3Request();
    const second = await prepareSamFirstInferenceV3Request();
    expect(transport.getCallCount()).toBe(0);
    expect(transport.networkCalls).toBe(0);
    expect(first.endpointId).toBe(SAM_FIRST_INFERENCE_ENDPOINT_ID);
    expect(first.endpoint).toBe('https://sawwuq4u7oiftj.api.runpod.ai/v1/masks');
    expect(first.request).toMatchObject({
      contractVersion: SAM_MASK_CONTRACT_VERSION,
      ...SAM_FIRST_INFERENCE_REQUEST_IDENTIFIERS,
      source: {
        mediaType: 'image/png',
        byteSize: 241_013,
        width: 876,
        height: 221,
        sha256: SAM_FIRST_INFERENCE_FIXTURE.sha256,
      },
      segmentation: { mode: 'automatic-candidates', prompt: { kind: 'none' } },
      limits: SAM_FIRST_INFERENCE_REQUEST_LIMITS,
      output: { maskEncoding: 'fabrica-binary-rle-v1' },
    });
    expect(first.workerImageDigest).toBe(SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST);
    expect(first.canonicalBodyText).toBe(second.canonicalBodyText);
    expect(first.canonicalBodySha256).toBe(second.canonicalBodySha256);
    expect(first.canonicalBodyByteLength).toBe(second.canonicalBodyByteLength);
    expect(Buffer.from(first.canonicalBodyBytes).toString('utf8')).toBe(first.canonicalBodyText);
    const changedCopy = first.canonicalBodyBytes;
    changedCopy[0] = 0;
    expect(Buffer.from(first.canonicalBodyBytes).toString('utf8')).toBe(first.canonicalBodyText);
    expect(sha256Hex(first.canonicalBodyBytes)).toBe(first.canonicalBodySha256);

    const body = JSON.parse(first.canonicalBodyText) as Record<string, unknown>;
    const { workerImageDigest, ...baseRequest } = body;
    expect(workerImageDigest).toBe(SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST);
    expect(parseAndVerifySamMaskRequest(baseRequest).request).toEqual(first.request);
    expect(Object.keys(body).toSorted()).toEqual(first.orderedTopLevelFieldNames);
    expect(Object.keys(body).toSorted()).toEqual([
      'attemptId',
      'contractVersion',
      'jobId',
      'limits',
      'output',
      'requestId',
      'segmentation',
      'source',
      'workerImageDigest',
      'workspaceId',
    ]);
    const countImageFields = (value: unknown): number => {
      if (Array.isArray(value)) return value.reduce((sum, part) => sum + countImageFields(part), 0);
      if (typeof value !== 'object' || value === null) return 0;
      return Object.entries(value).reduce(
        (sum, [key, part]) => sum + (key === 'pngBase64' ? 1 : countImageFields(part)),
        0,
      );
    };
    expect(countImageFields(body)).toBe(1);
    expect(first.canonicalBodyText).not.toContain('banner-person-v1.png');
    expect(first.canonicalBodyText).not.toContain('original/banner-person-v1');
  });

  it('rejects caller substitution and keeps fixed request identifiers one-milestone owned', async () => {
    for (const injected of [
      { fixtureId: 'banner-no-text-v1' },
      { endpoint: 'https://attacker.invalid/v1/masks' },
      { imageBytes: Uint8Array.of(1) },
      { requestId: '00000000-0000-0000-0000-000000000001' },
      { minMaskAreaPixels: 1 },
    ]) {
      await expect(prepareSamFirstInferenceV3Request(injected as never)).rejects.toThrow(
        /accepts no caller input/u,
      );
    }
    expect(Object.isFrozen(SAM_FIRST_INFERENCE_REQUEST_IDENTIFIERS)).toBe(true);
    expect(Object.keys(SAM_FIRST_INFERENCE_REQUEST_IDENTIFIERS).toSorted()).toEqual([
      'attemptId',
      'jobId',
      'requestId',
      'workspaceId',
    ]);
  });

  it('guards duplicated caller evidence against the actual committed worker files', () => {
    const artifactManifest = JSON.parse(
      readFileSync(join(repositoryRoot, 'services/sam-worker/artifact-manifest.json'), 'utf8'),
    ) as Record<string, unknown>;
    const adapterProfile = JSON.parse(
      readFileSync(join(repositoryRoot, 'services/sam-worker/adapter-profile.json'), 'utf8'),
    ) as Record<string, unknown>;
    const protocolVectors = JSON.parse(
      readFileSync(join(repositoryRoot, 'services/sam-worker/protocol-vectors.json'), 'utf8'),
    ) as Record<string, unknown>;
    expect(artifactManifest.manifestSha256).toBe(
      SAM_FIRST_INFERENCE_LOCAL_IDENTITY_EVIDENCE.artifactManifestSha256,
    );
    expect(adapterProfile.profileSha256).toBe(
      SAM_FIRST_INFERENCE_LOCAL_IDENTITY_EVIDENCE.selectedConfigurationAdapterProfileSha256,
    );
    expect(protocolVectors.vectorVersion).toBe(
      SAM_FIRST_INFERENCE_LOCAL_IDENTITY_EVIDENCE.protocolVectorsVersion,
    );
    expect(fileSha256('services/sam-worker/protocol-vectors.json')).toBe(
      SAM_FIRST_INFERENCE_LOCAL_IDENTITY_EVIDENCE.protocolVectorsFileSha256,
    );
    expect(fileSha256('services/sam-worker/artifact-manifest.json')).toBe(
      SAM_FIRST_INFERENCE_LOCAL_IDENTITY_EVIDENCE.artifactManifestFileSha256,
    );
    expect(fileSha256('services/sam-worker/adapter-profile.json')).toBe(
      SAM_FIRST_INFERENCE_LOCAL_IDENTITY_EVIDENCE.selectedConfigurationAdapterProfileFileSha256,
    );
    expect(fileSha256('services/sam-worker/sam_worker/runtime.py')).toBe(
      SAM_FIRST_INFERENCE_LOCAL_IDENTITY_EVIDENCE.workerRuntimeFileSha256,
    );
    expect(fileSha256('services/sam-worker/sam_worker/engine.py')).toBe(
      SAM_FIRST_INFERENCE_LOCAL_IDENTITY_EVIDENCE.workerEngineFileSha256,
    );
    expect(fileSha256('services/sam-worker/sam_worker/hosting.py')).toBe(
      SAM_FIRST_INFERENCE_LOCAL_IDENTITY_EVIDENCE.workerHostingFileSha256,
    );
    expect(fileSha256('services/sam-worker/sam_worker/model_loader.py')).toBe(
      SAM_FIRST_INFERENCE_LOCAL_IDENTITY_EVIDENCE.modelLoaderSha256,
    );
    expect(SAM_RUNPOD_DIRECT_HOSTING_PROFILE.workerHostingVersion).toBe(
      SAM_FIRST_INFERENCE_LOCAL_IDENTITY_EVIDENCE.workerHostingVersion,
    );
    expect(SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256).toBe(
      SAM_FIRST_INFERENCE_LOCAL_IDENTITY_EVIDENCE.directHostingProfileSha256,
    );
    expect(SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V3_SHA256).toBe(
      SAM_FIRST_INFERENCE_LOCAL_IDENTITY_EVIDENCE.directAdapterV3ProfileSha256,
    );
    expect(SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V3_SHA256).toBe(
      SAM_FIRST_INFERENCE_LOCAL_IDENTITY_EVIDENCE.authorizationV3ProfileSha256,
    );
    expect(SAM_FIRST_INFERENCE_EXECUTION_IDENTITY).toMatchObject({
      kind: 'meta-sam2.1',
      repositoryCommit: '05d9e57fb3945b10c861046c1e6749e2bfc258e3',
      modelId: 'sam2.1_hiera_base_plus',
      configIdentity: 'configs/sam2.1/sam2.1_hiera_b+.yaml',
      checkpointSha256: 'a2345aede8715ab1d5d31b4a509fb160c5a4af1970f199d9054ccfb746c004c5',
      workerImageDigest: SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
    });
  });
});

describe('first SAM inference V3 authorization', () => {
  it('derives the unchanged V3 authorization exclusively from one genuine preparation', async () => {
    const prepared = await prepareSamFirstInferenceV3Request();
    const sources = sourcesAt(() => deterministicIssuedAtMs);
    const authorization = mintTestOnlySamFirstInferenceV3Authorization(prepared, sources);
    expect(authorization).toMatchObject({
      kind: 'single-fixture-sam-runpod-direct-v3',
      authorizationId: deterministicAuthorizationId,
      endpointId: SAM_FIRST_INFERENCE_ENDPOINT_ID,
      imageDigest: SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
      secretReferenceName: 'RUNPOD_API_KEY',
      executionIdentity: SAM_FIRST_INFERENCE_EXECUTION_IDENTITY,
      fixture: {
        sha256: SAM_FIRST_INFERENCE_FIXTURE.sha256,
        byteSize: SAM_FIRST_INFERENCE_FIXTURE.byteSize,
        width: SAM_FIRST_INFERENCE_FIXTURE.width,
        height: SAM_FIRST_INFERENCE_FIXTURE.height,
      },
      requestLimits: SAM_FIRST_INFERENCE_REQUEST_LIMITS,
      automaticCandidatesOnly: true,
      clientDispatchMaximum: 1,
      applicationInferenceMaximum: 1,
      providerBillingGuarantee: false,
      clientRetryCount: 0,
      pollCount: 0,
      clientWallTimeoutMs: SAM_FIRST_INFERENCE_CLIENT_TIMEOUT_MS,
      costMaximumMicroUsd: SAM_FIRST_INFERENCE_COST_MAXIMUM_MICRO_USD,
      issuedAtMs: deterministicIssuedAtMs,
      expiresAtMs: deterministicIssuedAtMs + SAM_FIRST_INFERENCE_AUTHORIZATION_LIFETIME_MS,
      executionAuthorized: true,
      productionAdmissionAuthority: false,
      webRouteActivated: false,
    });
    expect(
      validateTestOnlySamFirstInferenceV3Authorization({
        prepared,
        authorization,
        sources,
      }),
    ).toBe(authorization);
    const authorized = authorizeSamFirstInferenceV3Dispatch({
      prepared,
      authorization,
      testOnlySources: sources,
    });
    expect(consumeSamFirstInferenceV3AuthorizedDispatch(authorized)).toEqual({
      prepared,
      authorization,
    });
    expect(() => consumeSamFirstInferenceV3AuthorizedDispatch(authorized)).toThrow(
      /already consumed/u,
    );

    for (const mismatch of [
      { ...authorization, endpointId: 'foreign-endpoint' },
      { ...authorization, imageDigest: `sha256:${'3'.repeat(64)}` },
      { ...authorization, executionIdentity: { ...authorization.executionIdentity, modelId: 'x' } },
      { ...authorization, fixture: { ...authorization.fixture, sha256: '0'.repeat(64) } },
      { ...authorization, requestLimits: { ...authorization.requestLimits, maxCandidates: 7 } },
      { ...authorization, clientWallTimeoutMs: 1 },
      { ...authorization, costMaximumMicroUsd: 1 },
      { ...authorization, hostingProfileSha256: '0'.repeat(64) },
      { ...authorization, adapterProfileSha256: '0'.repeat(64) },
      { ...authorization, authorizationProfileSha256: '0'.repeat(64) },
      { ...authorization, unknown: true },
    ]) {
      expect(() =>
        validateTestOnlySamFirstInferenceV3Authorization({
          prepared,
          authorization: mismatch,
          sources,
        }),
      ).toThrow();
    }

    const reconstructed = prepareSamRunPodDirectV3Request({
      endpointId: prepared.endpointId,
      requestInput: prepared.request,
      workerImageDigest: SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
    });
    expect(reconstructed.canonicalBodyText).toBe(prepared.canonicalBodyText);
    expect(() => mintTestOnlySamFirstInferenceV3Authorization(reconstructed, sources)).toThrow(
      /preparation identity drifted/u,
    );
  });

  it('rejects zero, malformed, future, expired, and overlong authorization locally', async () => {
    const prepared = await prepareSamFirstInferenceV3Request();
    for (const authorizationId of [
      '00000000-0000-0000-0000-000000000000',
      'not-an-authorization-id',
    ]) {
      expect(() =>
        mintTestOnlySamFirstInferenceV3Authorization(
          prepared,
          sourcesAt(() => deterministicIssuedAtMs, authorizationId),
        ),
      ).toThrow();
    }
    expect(() =>
      mintTestOnlySamFirstInferenceV3Authorization(
        prepared,
        sourcesAt(
          () =>
            RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT_MS -
            SAM_FIRST_INFERENCE_AUTHORIZATION_LIFETIME_MS +
            1,
        ),
      ),
    ).toThrow(/cannot fit/u);

    let currentTimeMs = deterministicIssuedAtMs;
    const mutableSources = sourcesAt(() => currentTimeMs);
    const authorization = mintTestOnlySamFirstInferenceV3Authorization(prepared, mutableSources);
    currentTimeMs = deterministicIssuedAtMs - 1;
    expect(() =>
      validateTestOnlySamFirstInferenceV3Authorization({
        prepared,
        authorization,
        sources: mutableSources,
      }),
    ).toThrow(/future/u);
    currentTimeMs = authorization.expiresAtMs;
    expect(() =>
      validateTestOnlySamFirstInferenceV3Authorization({
        prepared,
        authorization,
        sources: mutableSources,
      }),
    ).toThrow(/stale/u);
  });
});

describe('first SAM inference V3 mint-and-dispatch control', () => {
  it('passes the exact prepared bytes to one fake dispatch and blocks a duplicate beforehand', async () => {
    const firstTransport = createDeterministicSamRunPodDirectV3Transport();
    const first = await executeSamFirstInferenceV3({
      mode: 'provider-free-deterministic-fake',
      transport: firstTransport,
      testOnlyAuthorizationSources: sourcesAt(() => deterministicIssuedAtMs),
    });
    expect(firstTransport.getCallCount()).toBe(1);
    expect(firstTransport.networkCalls).toBe(0);
    expect(firstTransport.getLastRequestBodyText()).toBe(first.prepared.canonicalBodyText);
    expect(Buffer.from(first.prepared.canonicalBodyBytes).toString('utf8')).toBe(
      firstTransport.getLastRequestBodyText(),
    );
    expect(JSON.parse(firstTransport.getLastRequestBodyText()!)).toHaveProperty(
      'workerImageDigest',
      SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
    );
    expect(first).toMatchObject({
      transportKind: 'deterministic-fake-direct-v3',
      authorizationKind: 'deterministic-test-only',
      dispatchCount: 1,
      retryCount: 0,
      pollCount: 0,
      timeoutMs: 330_000,
      response: { executionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY },
    });

    const secondTransport = createDeterministicSamRunPodDirectV3Transport();
    await expect(
      executeSamFirstInferenceV3({
        mode: 'provider-free-deterministic-fake',
        transport: secondTransport,
        testOnlyAuthorizationSources: sourcesAt(
          () => deterministicIssuedAtMs,
          '962845c9-2ee8-49c0-992f-c62239666cca',
        ),
      }),
    ).rejects.toMatchObject({ reason: 'DUPLICATE_DISPATCH', retryable: false });
    expect(secondTransport.getCallCount()).toBe(0);
    expect(secondTransport.networkCalls).toBe(0);
  });

  it('keeps native/network transport inaccessible without the exact future phrase', async () => {
    let nativeCalls = 0;
    const nativeTransport: SamRunPodDirectV3TransportPort = {
      transportKind: 'native-fetch-direct-v3',
      secretReferenceName: 'RUNPOD_API_KEY',
      async dispatch() {
        nativeCalls += 1;
        throw new TypeError('Native test transport must remain unreachable.');
      },
    };
    await expect(
      executeSamFirstInferenceV3({
        mode: 'explicitly-authorized-native',
        authorizationPhrase: 'not-authorized',
        transport: nativeTransport,
      }),
    ).rejects.toThrow(/not explicitly authorized/u);
    expect(nativeCalls).toBe(0);

    const fake = createDeterministicSamRunPodDirectV3Transport();
    await expect(
      executeSamFirstInferenceV3({
        mode: 'provider-free-deterministic-fake',
        transport: fake,
        testOnlyAuthorizationSources: sourcesAt(() => deterministicIssuedAtMs),
        endpoint: 'https://attacker.invalid/v1/masks',
      } as never),
    ).rejects.toThrow(/strict closed object/u);
    expect(fake.getCallCount()).toBe(0);
    expect(SAM_FIRST_INFERENCE_ACTIVATION).toEqual({
      productionActivated: false,
      webRouteActivated: false,
      productionAdmissionAuthority: false,
      generalDispatchActivated: false,
      phaseBActivated: false,
      retryCount: 0,
      pollCount: 0,
      healthRequestCount: 0,
      queueRequestCount: 0,
    });
  });

  it('keeps existing generic fake wire vectors digest-free and byte-identical', async () => {
    const milestone = await prepareSamFirstInferenceV3Request();
    const request = SamMaskRequestSchema.parse({
      ...milestone.request,
      requestId: '0048213a-f517-4014-b52e-8650de41f655',
      jobId: '82929d7a-3f37-488e-a244-3b9259331199',
      attemptId: '4ab8c808-7774-4175-ae41-618e6b445c8a',
    });
    const transport = createDeterministicSamRunPodDirectV3Transport();
    await createSamRunPodDirectV3Adapter({
      endpointId: 'generic-fake-vector',
      expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
      transport,
    }).generate(request);
    expect(transport.getCallCount()).toBe(1);
    expect(transport.networkCalls).toBe(0);
    expect(transport.getLastRequestBodyText()).toBe(canonicalizeJson(request));
    expect(JSON.parse(transport.getLastRequestBodyText()!)).not.toHaveProperty('workerImageDigest');
  });
});
