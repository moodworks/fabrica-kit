import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { type SamMaskResponse } from '../src/sam/sam-mask-contracts.js';
import { postprocessSamMasks, type SamRawMaskCandidate } from '../src/sam/sam-mask-postprocess.js';
import { canonicalResponseSha256 } from '../src/sam/sam-mask-rle.js';
import { parseAndVerifySamMaskResponse } from '../src/sam/sam-mask-validation.js';
import { sha256Hex } from '../src/scene/canonical-scene-json.js';
import {
  SAM_CORPUS_CLIENT_TIMEOUT_MS,
  SAM_CORPUS_ENDPOINT_ID,
  SAM_CORPUS_ENDPOINT_VERSION,
  SAM_CORPUS_EVALUATION_FIXTURES_V1,
  SAM_CORPUS_EXECUTION_IDENTITY,
  SAM_CORPUS_WORKER_IMAGE,
  SAM_CORPUS_WORKER_IMAGE_DIGEST,
  inspectSamCorpusPreparedRequestV1,
  prepareSamNoTextCorpusRequestV1,
  prepareSamProductCorpusRequestV1,
  prepareSamTextHeavyCorpusRequestV1,
  type SamCorpusPreparedRequestV1,
} from '../src/server/sam-corpus-evaluation-catalog-v1.js';
import {
  SAM_CORPUS_FAKE_OUTPUT_LABEL,
  createSamCorpusVisualReviewV1,
  materializeSamCorpusVisualEvaluationV2,
  validateSamCorpusVisualResponseV2,
  verifySamCorpusVisualArtifactSetV2,
} from '../src/server/sam-corpus-visual-evaluation-v2.js';
import { SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY } from '../src/server/sam-runpod-direct-v3-deterministic-fake-transport.js';
import { RUNPOD_API_KEY_REFERENCE } from '../src/server/sam-runpod-direct-v3-profiles.js';
import { prepareSamFirstInferenceV3Request } from '../src/server/sam-runpod-direct-v3-request-preparation.js';
import {
  SAM_TEXT_HEAVY_PRODUCTION_V3_AUTHORIZATION_LIFETIME_MS,
  SAM_TEXT_HEAVY_PRODUCTION_V3_FROZEN_IDENTITY,
  SamTextHeavyProductionV3AuthorizationSchema,
  authorizeTestOnlySamTextHeavyProductionV3Execution,
  consumeSamTextHeavyProductionV3AuthorizedExecution,
  createTestOnlySamTextHeavyProductionV3AuthorizationSources,
  mintTestOnlySamTextHeavyProductionV3Authorization,
  validateTestOnlySamTextHeavyProductionV3Authorization,
  type SamTextHeavyProductionV3Authorization,
  type SamTextHeavyProductionV3AuthorizedExecution,
  type SamTextHeavyProductionV3TestAuthorizationSources,
} from '../src/server/sam-text-heavy-production-v3-authorization.js';
import {
  SAM_TEXT_HEAVY_PRODUCTION_V3_ACTIVATION,
  SAM_TEXT_HEAVY_PRODUCTION_V3_NATIVE_TRANSPORT_REGISTRY,
  SamTextHeavyProductionV3ExecutionError,
  createSamTextHeavyProductionV3NativeTransportFactory,
  createTestOnlySamTextHeavyProductionV3TransportFactory,
  executeSamTextHeavyProductionV3,
  inspectSamTextHeavyProductionV3NativeTransportFactory,
  inspectTestOnlySamTextHeavyProductionV3TransportFactory,
} from '../src/server/sam-text-heavy-production-v3-control.js';
import {
  SAM_TEXT_HEAVY_PRODUCTION_V3_CANONICAL_CALL_CLAIM_SHA256,
  SAM_TEXT_HEAVY_PRODUCTION_V3_CANONICAL_CALL_IDENTITY,
  SAM_TEXT_HEAVY_PRODUCTION_V3_CLAIM_ROOT,
  SAM_TEXT_HEAVY_PRODUCTION_V3_OUTPUT_ROOT,
  SAM_TEXT_HEAVY_PRODUCTION_V3_REPOSITORY_SHA,
  createTestOnlySamTextHeavyProductionV3Root,
  inspectSamTextHeavyProductionV3DurableReservation,
  inspectSamTextHeavyProductionV3OutputTarget,
  prepareTestOnlySamTextHeavyProductionV3OutputTarget,
  reserveSamTextHeavyProductionV3CanonicalCall,
  retireSamTextHeavyProductionV3Output,
  type SamTextHeavyProductionV3DurableReservation,
  type SamTextHeavyProductionV3TestRoot,
} from '../src/server/sam-text-heavy-production-v3-reservation.js';

const roots: string[] = [];
let ordinal = 0;

const freshRoot = async (): Promise<{
  readonly path: string;
  readonly capability: SamTextHeavyProductionV3TestRoot;
}> => {
  const path = await mkdtemp(
    join(await realpath(tmpdir()), 'fabrica-sam-text-heavy-production-v3-test-root-'),
  );
  roots.push(path);
  return {
    path,
    capability: await createTestOnlySamTextHeavyProductionV3Root({ rootDirectory: path }),
  };
};

const nextNonce = (): string => {
  ordinal += 1;
  return ordinal.toString(16).padStart(12, '0');
};

const nextAuthorizationId = (): string => `f3000000-0000-4000-8000-${nextNonce()}`;

const reserveFresh = async (): Promise<{
  readonly root: Awaited<ReturnType<typeof freshRoot>>;
  readonly outputDirectory: string;
  readonly reservation: SamTextHeavyProductionV3DurableReservation;
}> => {
  const root = await freshRoot();
  const target = await prepareTestOnlySamTextHeavyProductionV3OutputTarget({
    root: root.capability,
    nonce: nextNonce(),
  });
  const outputDirectory = inspectSamTextHeavyProductionV3OutputTarget(target).outputDirectory;
  const reservation = await reserveSamTextHeavyProductionV3CanonicalCall(target);
  return { root, outputDirectory, reservation };
};

interface AuthorizationContext {
  readonly prepared: SamCorpusPreparedRequestV1;
  readonly outputDirectory: string;
  readonly reservation: SamTextHeavyProductionV3DurableReservation;
  readonly sources: SamTextHeavyProductionV3TestAuthorizationSources;
  readonly authorization: SamTextHeavyProductionV3Authorization;
  readonly clock: { value: number };
}

const freshAuthorization = async (input?: {
  readonly authorizationId?: string;
  readonly prepared?: SamCorpusPreparedRequestV1;
}): Promise<AuthorizationContext> => {
  const reserved = await reserveFresh();
  const prepared = input?.prepared ?? (await prepareSamTextHeavyCorpusRequestV1());
  const clock = { value: Date.parse('2026-07-23T12:00:00Z') };
  const sources = createTestOnlySamTextHeavyProductionV3AuthorizationSources({
    nowMs: () => clock.value,
    authorizationId: () => input?.authorizationId ?? nextAuthorizationId(),
  });
  const authorization = mintTestOnlySamTextHeavyProductionV3Authorization(
    prepared,
    reserved.reservation,
    sources,
  );
  return { prepared, ...reserved, sources, authorization, clock };
};

const authorize = (context: AuthorizationContext): SamTextHeavyProductionV3AuthorizedExecution =>
  authorizeTestOnlySamTextHeavyProductionV3Execution({
    prepared: context.prepared,
    reservation: context.reservation,
    authorization: context.authorization,
    sources: context.sources,
  });

afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

const rawCandidates = (
  prepared: SamCorpusPreparedRequestV1,
  count: number,
): readonly SamRawMaskCandidate[] => {
  const request = inspectSamCorpusPreparedRequestV1(prepared).directPrepared.request;
  return Array.from({ length: count }, (_, index) => {
    const mask = new Uint8Array(request.source.width * request.source.height);
    const left = 8 + index * 32;
    const top = 8 + index * 24;
    for (let y = top; y < top + 12; y += 1) {
      mask.fill(1, y * request.source.width + left, y * request.source.width + left + 12);
    }
    return Object.freeze({
      mask,
      predictedIou: 0.98 - index * 0.03,
      stabilityScore: 0.97 - index * 0.02,
    });
  });
};

const fakeResponse = (
  prepared: SamCorpusPreparedRequestV1,
  candidateCount: number,
): SamMaskResponse => {
  const request = inspectSamCorpusPreparedRequestV1(prepared).directPrepared.request;
  const postprocessed = postprocessSamMasks(request, rawCandidates(prepared, candidateCount));
  const unsigned: Omit<SamMaskResponse, 'responseSha256'> = {
    contractVersion: request.contractVersion,
    requestId: request.requestId,
    workspaceId: request.workspaceId,
    jobId: request.jobId,
    attemptId: request.attemptId,
    sourceSha256: request.source.sha256,
    executionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
    timing: { inferenceMs: 0, totalMs: 0 },
    filterSummary: postprocessed.filterSummary,
    candidateCount: postprocessed.candidates.length,
    candidates: postprocessed.candidates,
  };
  return parseAndVerifySamMaskResponse({
    response: { ...unsigned, responseSha256: canonicalResponseSha256(unsigned) },
    request,
    expectedExecutionKind: 'deterministic-fake',
  });
};

describe('SAM text-heavy production V3 frozen identity and inactive admission', () => {
  it('binds the exact repository, fixture, request, deployment, model, and policy identity', () => {
    const fixture = SAM_CORPUS_EVALUATION_FIXTURES_V1['text-heavy'];
    expect(SAM_TEXT_HEAVY_PRODUCTION_V3_REPOSITORY_SHA).toBe(
      '524a708ed95972e39a994ad711e4202238094fc2',
    );
    expect(SAM_TEXT_HEAVY_PRODUCTION_V3_FROZEN_IDENTITY).toMatchObject({
      repositorySha: SAM_TEXT_HEAVY_PRODUCTION_V3_REPOSITORY_SHA,
      endpoint: {
        id: SAM_CORPUS_ENDPOINT_ID,
        version: SAM_CORPUS_ENDPOINT_VERSION,
        url: `https://${SAM_CORPUS_ENDPOINT_ID}.api.runpod.ai/v1/masks`,
        method: 'POST',
        path: '/v1/masks',
        redirectCount: 0,
      },
      workerImage: SAM_CORPUS_WORKER_IMAGE,
      workerImageDigest: SAM_CORPUS_WORKER_IMAGE_DIGEST,
      fixture: {
        key: 'text-heavy',
        id: fixture.fixtureId,
        source: fixture.normalized,
        humanOracle: fixture.humanOracle,
      },
      request: {
        identifiers: fixture.identifiers,
        canonical: fixture.canonicalRequest,
        contractVersion: 'sam-mask-v2',
        segmentationMode: 'automatic-candidates',
        limits: { minMaskAreaPixels: 64, maxCandidates: 8 },
        maskEncoding: 'fabrica-binary-rle-v1',
      },
      executionIdentity: SAM_CORPUS_EXECUTION_IDENTITY,
      capacity: {
        automaticOnePointPeakBytes: 114_138_112,
        ceilingBytes: 268_435_456,
        pointsPerBatch: 3,
        eligible: true,
      },
      policy: {
        clientWallTimeoutMs: 330_000,
        incrementalCostMaximumMicroUsd: 250_000,
        dispatchMaximum: 1,
        fetchMaximum: 1,
        materializationMaximum: 1,
        retryCount: 0,
        redirectCount: 0,
        pollCount: 0,
        healthRequestCount: 0,
        pingRequestCount: 0,
        queueRequestCount: 0,
        providerBillingGuarantee: false,
      },
      activation: {
        corpusProductionExecutionAuthority: false,
        corpusProviderCallAuthority: false,
        webRouteAuthority: false,
        productProductionAuthority: false,
        generalAdmissionAuthority: false,
        productionAdmissionAuthority: false,
        corpusBatchAuthority: false,
        providerBillingGuarantee: false,
      },
    });
    expect(SAM_TEXT_HEAVY_PRODUCTION_V3_AUTHORIZATION_LIFETIME_MS).toBe(
      SAM_CORPUS_CLIENT_TIMEOUT_MS,
    );
    expect(SAM_TEXT_HEAVY_PRODUCTION_V3_CANONICAL_CALL_IDENTITY).toMatchObject({
      repositorySha: SAM_TEXT_HEAVY_PRODUCTION_V3_REPOSITORY_SHA,
      endpointId: SAM_CORPUS_ENDPOINT_ID,
      endpointVersion: 12,
      workerImageDigest: SAM_CORPUS_WORKER_IMAGE_DIGEST,
      fixtureId: fixture.fixtureId,
      ...fixture.identifiers,
      canonicalRequestByteLength: 222_620,
      canonicalRequestSha256: 'a14354bb67685293a8aa3c2523db36506b2050d53f0dea90c4070bcdd015ee26',
    });
    expect(SAM_TEXT_HEAVY_PRODUCTION_V3_CANONICAL_CALL_CLAIM_SHA256).toMatch(/^[0-9a-f]{64}$/u);
    expect(SAM_TEXT_HEAVY_PRODUCTION_V3_OUTPUT_ROOT).toBe('/private/tmp');
    expect(SAM_TEXT_HEAVY_PRODUCTION_V3_CLAIM_ROOT).toBe(
      '/private/tmp/fabrica-sam-text-heavy-production-v3-claims',
    );
  });

  it('keeps every broad registry and activation flag closed', () => {
    expect(SAM_TEXT_HEAVY_PRODUCTION_V3_NATIVE_TRANSPORT_REGISTRY).toEqual([]);
    expect(SAM_TEXT_HEAVY_PRODUCTION_V3_ACTIVATION).toEqual({
      productionExecutionRegistry: 'empty-unchanged',
      productionNativeTransportRegistry: 'empty-unchanged',
      productionExecutionActivated: false,
      providerCallAuthority: false,
      webRouteAuthority: false,
      productProductionAuthority: false,
      generalAdmissionAuthority: false,
      productionAdmissionAuthority: false,
      corpusBatchAuthority: false,
      dispatchMaximum: 1,
      fetchMaximum: 1,
      materializationMaximum: 1,
      retryCount: 0,
      redirectCount: 0,
      pollCount: 0,
      healthRequestCount: 0,
      pingRequestCount: 0,
      queueRequestCount: 0,
      providerBillingGuarantee: false,
    });
  });

  it('accepts only the opaque text-heavy preparation', async () => {
    const [noTextReserved, personReserved] = await Promise.all([reserveFresh(), reserveFresh()]);
    const noText = await prepareSamNoTextCorpusRequestV1();
    const person = await prepareSamFirstInferenceV3Request();
    const sources = createTestOnlySamTextHeavyProductionV3AuthorizationSources({
      nowMs: () => Date.parse('2026-07-23T12:00:00Z'),
      authorizationId: nextAuthorizationId,
    });
    expect(() =>
      mintTestOnlySamTextHeavyProductionV3Authorization(
        noText,
        noTextReserved.reservation,
        sources,
      ),
    ).toThrow(/text-heavy production preparation/u);
    expect(() =>
      mintTestOnlySamTextHeavyProductionV3Authorization(
        person,
        personReserved.reservation,
        sources,
      ),
    ).toThrow(/foreign or reconstructed/u);
    const textHeavy = await prepareSamTextHeavyCorpusRequestV1();
    expect(() =>
      inspectSamCorpusPreparedRequestV1({ ...textHeavy } as SamCorpusPreparedRequestV1),
    ).toThrow(/foreign or reconstructed/u);
  });

  it('refuses product before any authorization source or transport construction can run', async () => {
    let clockCalls = 0;
    let identifierCalls = 0;
    createTestOnlySamTextHeavyProductionV3AuthorizationSources({
      nowMs: () => {
        clockCalls += 1;
        return Date.parse('2026-07-23T12:00:00Z');
      },
      authorizationId: () => {
        identifierCalls += 1;
        return nextAuthorizationId();
      },
    });
    const dormantFactory = createTestOnlySamTextHeavyProductionV3TransportFactory({
      outcome: { kind: 'throw-after-dispatch' },
    });
    await expect(prepareSamProductCorpusRequestV1()).rejects.toThrow(/650511040 > 268435456/u);
    expect({ clockCalls, identifierCalls }).toEqual({ clockCalls: 0, identifierCalls: 0 });
    expect(inspectTestOnlySamTextHeavyProductionV3TransportFactory(dormantFactory)).toEqual({
      constructionCount: 0,
      dispatchCount: 0,
      fetchCount: 0,
    });
  });
});

describe('SAM text-heavy production V3 durable canonical-call claim', () => {
  it('atomically permits one canonical claim across different output names', async () => {
    const root = await freshRoot();
    const targets = await Promise.all([
      prepareTestOnlySamTextHeavyProductionV3OutputTarget({
        root: root.capability,
        nonce: nextNonce(),
      }),
      prepareTestOnlySamTextHeavyProductionV3OutputTarget({
        root: root.capability,
        nonce: nextNonce(),
      }),
    ]);
    const results = await Promise.allSettled(
      targets.map((target) => reserveSamTextHeavyProductionV3CanonicalCall(target)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const files = await readdir(join(root.path, 'fabrica-sam-text-heavy-production-v3-claims'));
    expect(files).toEqual([`${SAM_TEXT_HEAVY_PRODUCTION_V3_CANONICAL_CALL_CLAIM_SHA256}.json`]);
    const winner = results.find(
      (result): result is PromiseFulfilledResult<SamTextHeavyProductionV3DurableReservation> =>
        result.status === 'fulfilled',
    )!;
    const snapshot = inspectSamTextHeavyProductionV3DurableReservation(winner.value);
    const bytes = await readFile(snapshot.claimPath);
    const record = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    expect(sha256Hex(bytes)).toBe(snapshot.claimRecordSha256);
    expect(record).toEqual({
      schema: 'fabrica-sam-text-heavy-production-v3-durable-claim',
      version: 1,
      status: 'claimed-before-authorization-and-dispatch',
      canonicalCallIdentity: SAM_TEXT_HEAVY_PRODUCTION_V3_CANONICAL_CALL_IDENTITY,
      canonicalCallClaimSha256: SAM_TEXT_HEAVY_PRODUCTION_V3_CANONICAL_CALL_CLAIM_SHA256,
      outputRootKind: 'test-only-temporary-root',
      outputDirectory: snapshot.outputDirectory,
    });
    expect(bytes.toString('utf8')).not.toMatch(/apiKey|credential|bearer|rawResponse|headers/iu);
    expect(await lstat(snapshot.claimPath)).toMatchObject({ mode: expect.any(Number) });
  });

  it.each(['output', 'staging'] as const)(
    'refuses a raced existing %s before writing the durable claim',
    async (kind) => {
      const root = await freshRoot();
      const target = await prepareTestOnlySamTextHeavyProductionV3OutputTarget({
        root: root.capability,
        nonce: nextNonce(),
      });
      const snapshot = inspectSamTextHeavyProductionV3OutputTarget(target);
      await mkdir(
        kind === 'output'
          ? snapshot.outputDirectory
          : `${snapshot.outputDirectory}.fabrica-sam-corpus-staging`,
      );
      await expect(reserveSamTextHeavyProductionV3CanonicalCall(target)).rejects.toThrow(
        /already exists/u,
      );
      expect(await readdir(join(root.path, 'fabrica-sam-text-heavy-production-v3-claims'))).toEqual(
        [],
      );
      await expect(reserveSamTextHeavyProductionV3CanonicalCall(target)).rejects.toThrow(
        /already attempted/u,
      );
    },
  );

  it('rejects symlink roots, outputs, reconstructed roots, escapes, and malformed basenames', async () => {
    const temporary = await realpath(tmpdir());
    const linkedRootPath = await mkdtemp(
      join(temporary, 'fabrica-sam-text-heavy-production-v3-test-root-'),
    );
    roots.push(linkedRootPath);
    const external = await mkdtemp(join(temporary, 'fabrica-sam-text-heavy-production-v3-link-'));
    roots.push(external);
    await symlink(external, join(linkedRootPath, 'fabrica-sam-text-heavy-production-v3-claims'));
    await expect(
      createTestOnlySamTextHeavyProductionV3Root({ rootDirectory: linkedRootPath }),
    ).rejects.toThrow(/non-symlink directory/u);

    const root = await freshRoot();
    const nonce = nextNonce();
    const linkedOutput = join(root.path, `fabrica-sam-text-heavy-production-v3-fake-${nonce}`);
    await symlink(external, linkedOutput);
    await expect(
      prepareTestOnlySamTextHeavyProductionV3OutputTarget({
        root: root.capability,
        nonce,
      }),
    ).rejects.toThrow(/already exists/u);
    await expect(
      prepareTestOnlySamTextHeavyProductionV3OutputTarget({
        root: { purpose: 'test-only-sam-text-heavy-production-v3-root' },
        nonce: nextNonce(),
      }),
    ).rejects.toThrow(/foreign/u);
    await expect(
      prepareTestOnlySamTextHeavyProductionV3OutputTarget({
        root: root.capability,
        nonce: '../escape' as never,
      }),
    ).rejects.toThrow(/nonce is malformed/u);
  });

  it('never releases a retired path or crash-left claim for replay', async () => {
    const reserved = await reserveFresh();
    const claimPath = inspectSamTextHeavyProductionV3DurableReservation(
      reserved.reservation,
    ).claimPath;
    retireSamTextHeavyProductionV3Output(reserved.reservation);
    expect(() => inspectSamTextHeavyProductionV3DurableReservation(reserved.reservation)).toThrow(
      /foreign or retired/u,
    );
    expect(() => retireSamTextHeavyProductionV3Output(reserved.reservation)).toThrow(
      /already retired/u,
    );
    await expect(lstat(claimPath)).resolves.toMatchObject({ mode: expect.any(Number) });
    await expect(
      prepareTestOnlySamTextHeavyProductionV3OutputTarget({
        root: reserved.root.capability,
        nonce: nextNonce(),
      }).then(reserveSamTextHeavyProductionV3CanonicalCall),
    ).rejects.toThrow(/failed closed/u);
  });
});

type MutableRecord = Record<string | number, unknown>;

const primitivePaths = (value: unknown, prefix: readonly (string | number)[] = []) => {
  const paths: (readonly (string | number)[])[] = [];
  if (typeof value !== 'object' || value === null) return [prefix];
  for (const [key, child] of Object.entries(value)) {
    paths.push(...primitivePaths(child, [...prefix, Array.isArray(value) ? Number(key) : key]));
  }
  return paths;
};

const mutatePath = (value: unknown, path: readonly (string | number)[]): unknown => {
  const clone = structuredClone(value) as MutableRecord;
  let cursor = clone;
  for (const part of path.slice(0, -1)) cursor = cursor[part] as MutableRecord;
  const final = path.at(-1)!;
  const current = cursor[final];
  cursor[final] =
    typeof current === 'string'
      ? `${current}x`
      : typeof current === 'number'
        ? current + 1
        : typeof current === 'boolean'
          ? !current
          : 'mutated';
  return clone;
};

const schemaAuthorization = (): unknown => ({
  kind: 'single-text-heavy-sam-production-v3',
  authorizationId: 'f3ffffff-ffff-4fff-8fff-ffffffffffff',
  environment: 'provider-free-native-boundary-test',
  providerCallAuthority: false,
  identity: structuredClone(SAM_TEXT_HEAVY_PRODUCTION_V3_FROZEN_IDENTITY),
  output: {
    rootKind: 'test-only-temporary-root',
    outputDirectory: '/private/tmp/fabrica-sam-text-heavy-production-v3-fake-ffffffffffff',
    canonicalCallClaimSha256: SAM_TEXT_HEAVY_PRODUCTION_V3_CANONICAL_CALL_CLAIM_SHA256,
    claimRecordSha256: 'f'.repeat(64),
  },
  issuedAtMs: Date.parse('2026-07-23T12:00:00Z'),
  expiresAtMs:
    Date.parse('2026-07-23T12:00:00Z') + SAM_TEXT_HEAVY_PRODUCTION_V3_AUTHORIZATION_LIFETIME_MS,
  executionAuthorized: true,
  singleUse: true,
});

describe('SAM text-heavy production V3 fixture-exact authorization', () => {
  it('rejects a mutation of every primitive frozen-identity leaf', () => {
    const paths = primitivePaths(SAM_TEXT_HEAVY_PRODUCTION_V3_FROZEN_IDENTITY);
    expect(paths.length).toBeGreaterThan(60);
    for (const path of paths) {
      const candidate = structuredClone(schemaAuthorization()) as MutableRecord;
      candidate.identity = mutatePath(candidate.identity, path);
      expect(
        SamTextHeavyProductionV3AuthorizationSchema.safeParse(candidate).success,
        path.join('.'),
      ).toBe(false);
    }
  });

  it.each([
    ['endpoint version 11', ['endpoint', 'version'], 11],
    ['endpoint version string', ['endpoint', 'version'], '12'],
    ['mutable worker image tag', ['workerImage'], 'ghcr.io/moodworks/fabrica-sam-worker:latest'],
    ['wrong worker digest', ['workerImageDigest'], `sha256:${'0'.repeat(64)}`],
    ['health route', ['endpoint', 'path'], '/ping'],
    ['wrong endpoint URL route', ['endpoint', 'url'], 'https://sawwuq4u7oiftj.api.runpod.ai/ping'],
    ['wrong method', ['endpoint', 'method'], 'GET'],
    ['missing endpoint version', ['endpoint', 'version'], undefined],
    ['string source byte length', ['fixture', 'source', 'byteLength'], '166461'],
    ['string timeout', ['policy', 'clientWallTimeoutMs'], '330000'],
  ] as const)('names and rejects %s', (_label, path, replacement) => {
    const candidate = structuredClone(schemaAuthorization()) as MutableRecord;
    const identity = candidate.identity as MutableRecord;
    let cursor = identity;
    for (const part of path.slice(0, -1)) cursor = cursor[part] as MutableRecord;
    const final = path.at(-1)!;
    if (replacement === undefined) delete cursor[final];
    else cursor[final] = replacement;
    expect(SamTextHeavyProductionV3AuthorizationSchema.safeParse(candidate).success).toBe(false);
  });

  it.each([
    [
      'extra key',
      (value: MutableRecord): void => {
        Object.assign(value, { batchAuthority: true });
      },
    ],
    [
      'missing kind',
      (value: MutableRecord): void => {
        delete value.kind;
      },
    ],
    [
      'wrong kind',
      (value: MutableRecord): void => {
        value.kind = 'corpus-wide';
      },
    ],
    [
      'zero UUID',
      (value: MutableRecord): void => {
        value.authorizationId = '00000000-0000-0000-0000-000000000000';
      },
    ],
    [
      'malformed UUID',
      (value: MutableRecord): void => {
        value.authorizationId = 'not-a-uuid';
      },
    ],
    [
      'production environment',
      (value: MutableRecord): void => {
        value.environment = 'production-native';
      },
    ],
    [
      'provider authority',
      (value: MutableRecord): void => {
        value.providerCallAuthority = true;
      },
    ],
    [
      'production output root',
      (value: MutableRecord): void => {
        (value.output as MutableRecord).rootKind = 'production-private-tmp';
      },
    ],
    [
      'canonical claim',
      (value: MutableRecord): void => {
        (value.output as MutableRecord).canonicalCallClaimSha256 = '0'.repeat(64);
      },
    ],
    [
      'claim record digest',
      (value: MutableRecord): void => {
        (value.output as MutableRecord).claimRecordSha256 = 'short';
      },
    ],
    [
      'future lifetime',
      (value: MutableRecord): void => {
        value.expiresAtMs = Number(value.expiresAtMs) + 1;
      },
    ],
    [
      'execution disabled',
      (value: MutableRecord): void => {
        value.executionAuthorized = false;
      },
    ],
    [
      'not single use',
      (value: MutableRecord): void => {
        value.singleUse = false;
      },
    ],
  ] as const)('fails the closed schema on %s', (_label, mutate) => {
    const value = structuredClone(schemaAuthorization()) as MutableRecord;
    mutate(value);
    expect(SamTextHeavyProductionV3AuthorizationSchema.safeParse(value).success).toBe(false);
  });

  it('binds one tracked authorization and rejects clones, substitutions, second mint, and replay', async () => {
    const context = await freshAuthorization();
    expect(
      validateTestOnlySamTextHeavyProductionV3Authorization({
        prepared: context.prepared,
        reservation: context.reservation,
        authorization: context.authorization,
        sources: context.sources,
      }),
    ).toBe(context.authorization);
    expect(() =>
      validateTestOnlySamTextHeavyProductionV3Authorization({
        prepared: context.prepared,
        reservation: context.reservation,
        authorization: structuredClone(context.authorization),
        sources: context.sources,
      }),
    ).toThrow(/foreign, cloned, or request-mismatched/u);
    const otherPrepared = await prepareSamTextHeavyCorpusRequestV1();
    expect(() =>
      validateTestOnlySamTextHeavyProductionV3Authorization({
        prepared: otherPrepared,
        reservation: context.reservation,
        authorization: context.authorization,
        sources: context.sources,
      }),
    ).toThrow(/request-mismatched/u);
    expect(() =>
      mintTestOnlySamTextHeavyProductionV3Authorization(
        context.prepared,
        context.reservation,
        context.sources,
      ),
    ).toThrow(/already attempted authorization/u);
    const authorized = authorize(context);
    expect(consumeSamTextHeavyProductionV3AuthorizedExecution(authorized).prepared).toBe(
      context.prepared,
    );
    expect(() => consumeSamTextHeavyProductionV3AuthorizedExecution(authorized)).toThrow(
      /already consumed/u,
    );
    expect(() => authorize(context)).toThrow(/already consumed/u);
  });

  it('rejects exact expiry, future issue time, and duplicate authorization IDs', async () => {
    const expired = await freshAuthorization();
    expired.clock.value = expired.authorization.expiresAtMs;
    expect(() => authorize(expired)).toThrow(/stale, mutated, or identity-mismatched/u);
    expect(() => authorize(expired)).toThrow(/already consumed/u);

    const future = await freshAuthorization();
    future.clock.value = future.authorization.issuedAtMs - 1;
    expect(() => authorize(future)).toThrow(/stale, mutated, or identity-mismatched/u);

    const collision = nextAuthorizationId();
    await freshAuthorization({ authorizationId: collision });
    const secondReserved = await reserveFresh();
    const secondPrepared = await prepareSamTextHeavyCorpusRequestV1();
    const sources = createTestOnlySamTextHeavyProductionV3AuthorizationSources({
      nowMs: () => Date.parse('2026-07-23T12:00:00Z'),
      authorizationId: () => collision,
    });
    expect(() =>
      mintTestOnlySamTextHeavyProductionV3Authorization(
        secondPrepared,
        secondReserved.reservation,
        sources,
      ),
    ).toThrow(/malformed or already issued/u);
  });

  it('marks mint, validation, and authorization state before injected callback reentry', async () => {
    const reserved = await reserveFresh();
    const prepared = await prepareSamTextHeavyCorpusRequestV1();
    let mintReentry = '';
    const sources: SamTextHeavyProductionV3TestAuthorizationSources =
      createTestOnlySamTextHeavyProductionV3AuthorizationSources({
        nowMs: () => {
          try {
            mintTestOnlySamTextHeavyProductionV3Authorization(
              prepared,
              reserved.reservation,
              sources,
            );
          } catch (error) {
            mintReentry = String(error);
          }
          return Date.parse('2026-07-23T12:00:00Z');
        },
        authorizationId: nextAuthorizationId,
      });
    const authorization = mintTestOnlySamTextHeavyProductionV3Authorization(
      prepared,
      reserved.reservation,
      sources,
    );
    expect(mintReentry).toMatch(/already attempted authorization/u);

    let authorizationReentry = '';
    const reentrySources = createTestOnlySamTextHeavyProductionV3AuthorizationSources({
      nowMs: () => {
        try {
          authorizeTestOnlySamTextHeavyProductionV3Execution({
            prepared,
            reservation: reserved.reservation,
            authorization,
            sources: reentrySources,
          });
        } catch (error) {
          authorizationReentry = String(error);
        }
        return Date.parse('2026-07-23T12:00:00Z');
      },
      authorizationId: nextAuthorizationId,
    });
    expect(
      authorizeTestOnlySamTextHeavyProductionV3Execution({
        prepared,
        reservation: reserved.reservation,
        authorization,
        sources: reentrySources,
      }),
    ).toMatchObject({ purpose: 'authorized-sam-text-heavy-production-v3-execution' });
    expect(authorizationReentry).toMatch(/already consumed/u);
  });

  it('sanitizes injected authorization-source errors and retains one-way consumption', async () => {
    const marker = 'TEST_ONLY_AUTHORIZATION_SOURCE_SECRET_MUST_NOT_ESCAPE';
    const reserved = await reserveFresh();
    const prepared = await prepareSamTextHeavyCorpusRequestV1();
    const throwingSources = createTestOnlySamTextHeavyProductionV3AuthorizationSources({
      nowMs: () => {
        throw new Error(marker);
      },
      authorizationId: nextAuthorizationId,
    });
    const mintError = (() => {
      try {
        mintTestOnlySamTextHeavyProductionV3Authorization(
          prepared,
          reserved.reservation,
          throwingSources,
        );
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(String(mintError)).toMatch(/clock source failed closed/u);
    expect(String(mintError)).not.toContain(marker);
    expect(Object.hasOwn(mintError as object, 'cause')).toBe(false);
    expect(() =>
      mintTestOnlySamTextHeavyProductionV3Authorization(
        prepared,
        reserved.reservation,
        throwingSources,
      ),
    ).toThrow(/already attempted authorization/u);

    const context = await freshAuthorization();
    const failingValidationSources = createTestOnlySamTextHeavyProductionV3AuthorizationSources({
      nowMs: () => {
        throw new Error(marker);
      },
      authorizationId: nextAuthorizationId,
    });
    const authorizationError = (() => {
      try {
        authorizeTestOnlySamTextHeavyProductionV3Execution({
          prepared: context.prepared,
          reservation: context.reservation,
          authorization: context.authorization,
          sources: failingValidationSources,
        });
        return null;
      } catch (error) {
        return error;
      }
    })();
    expect(String(authorizationError)).toMatch(/clock source failed closed/u);
    expect(String(authorizationError)).not.toContain(marker);
    expect(Object.hasOwn(authorizationError as object, 'cause')).toBe(false);
    expect(() => authorize(context)).toThrow(/already consumed/u);
  });
});

describe('SAM text-heavy production V3 exact-once provider-free control', () => {
  it('reverifies the consumed durable claim before transport construction', async () => {
    const context = await freshAuthorization();
    const claimPath = inspectSamTextHeavyProductionV3DurableReservation(
      context.reservation,
    ).claimPath;
    await writeFile(claimPath, '{"tampered":true}\n', 'utf8');
    const factory = createTestOnlySamTextHeavyProductionV3TransportFactory({
      outcome: { kind: 'throw-after-dispatch' },
    });
    const error = await executeSamTextHeavyProductionV3({
      authorized: authorize(context),
      transportFactory: factory,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SamTextHeavyProductionV3ExecutionError);
    expect(error).toMatchObject({
      reason: 'LOCAL_FAILURE',
      transportConstructionCount: 0,
      dispatchCount: 0,
      fetchCount: 0,
      materializationCount: 0,
    });
    expect(inspectTestOnlySamTextHeavyProductionV3TransportFactory(factory)).toEqual({
      constructionCount: 0,
      dispatchCount: 0,
      fetchCount: 0,
    });
    expect(await readFile(claimPath, 'utf8')).toBe('{"tampered":true}\n');
    await expect(lstat(context.outputDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('defers the opaque native factory and rejects it on the provider-free authorization path', async () => {
    expect(() =>
      createSamTextHeavyProductionV3NativeTransportFactory({
        apiKey: 'test-only-placeholder-not-a-provider-credential',
        secretReferenceName: RUNPOD_API_KEY_REFERENCE,
        fetchImplementation: async () => new Response() as never,
      } as never),
    ).toThrow(/input is not closed/u);
    const nativeFactory = createSamTextHeavyProductionV3NativeTransportFactory({
      apiKey: 'test-only-placeholder-not-a-provider-credential',
      secretReferenceName: RUNPOD_API_KEY_REFERENCE,
    });
    expect(inspectSamTextHeavyProductionV3NativeTransportFactory(nativeFactory)).toEqual({
      constructionCount: 0,
      dispatchCount: 0,
      fetchCount: 0,
    });
    const context = await freshAuthorization();
    const error = await executeSamTextHeavyProductionV3({
      authorized: authorize(context),
      transportFactory: nativeFactory,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(SamTextHeavyProductionV3ExecutionError);
    expect(error).toMatchObject({
      reason: 'LOCAL_FAILURE',
      retryable: false,
      transportConstructionCount: 0,
      dispatchCount: 0,
      fetchCount: 0,
      materializationCount: 0,
      providerBillingGuarantee: false,
    });
    expect(inspectSamTextHeavyProductionV3NativeTransportFactory(nativeFactory)).toEqual({
      constructionCount: 0,
      dispatchCount: 0,
      fetchCount: 0,
    });
    await expect(lstat(context.outputDirectory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it.each(Array.from({ length: 9 }, (_, candidateCount) => candidateCount))(
    'inherits V2 verification of candidateCount=%i as exactly 3 + 3N fake files',
    async (candidateCount) => {
      const root = await freshRoot();
      const prepared = await prepareSamTextHeavyCorpusRequestV1();
      const validated = validateSamCorpusVisualResponseV2({
        prepared,
        response: fakeResponse(prepared, candidateCount),
        outputClassification: 'fake-test-output',
      });
      const outputDirectory = join(root.path, `v3-candidate-${candidateCount}-fake-output`);
      const materialized = await materializeSamCorpusVisualEvaluationV2({
        validated,
        outputDirectory,
      });
      expect(materialized.manifest.candidateCount).toBe(candidateCount);
      expect(materialized.inventory).toHaveLength(3 + 3 * candidateCount);
      expect(materialized.manifest.inventory.expectedFileCount).toBe(3 + 3 * candidateCount);
      await expect(verifySamCorpusVisualArtifactSetV2(outputDirectory)).resolves.toEqual(
        materialized,
      );
    },
    30_000,
  );

  it('consumes duplicate concurrent execution before either factory can construct', async () => {
    const context = await freshAuthorization();
    const authorized = authorize(context);
    await mkdir(context.outputDirectory);
    const factories = [0, 1].map(() =>
      createTestOnlySamTextHeavyProductionV3TransportFactory({
        outcome: { kind: 'throw-after-dispatch' },
      }),
    );
    const results = await Promise.allSettled(
      factories.map((transportFactory) =>
        executeSamTextHeavyProductionV3({ authorized, transportFactory }),
      ),
    );
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(factories.map(inspectTestOnlySamTextHeavyProductionV3TransportFactory)).toEqual([
      { constructionCount: 0, dispatchCount: 0, fetchCount: 0 },
      { constructionCount: 0, dispatchCount: 0, fetchCount: 0 },
    ]);
  });

  it('executes one deterministic fake boundary, verifies artifacts, and binds one visual review', async () => {
    const context = await freshAuthorization();
    const authorized = authorize(context);
    const factory = createTestOnlySamTextHeavyProductionV3TransportFactory({
      outcome: { kind: 'valid-deterministic-fake', candidateCount: 2 },
    });
    const dormantFactory = createTestOnlySamTextHeavyProductionV3TransportFactory({
      outcome: { kind: 'throw-after-dispatch' },
    });
    const first = executeSamTextHeavyProductionV3({ authorized, transportFactory: factory });
    const concurrentReplay = executeSamTextHeavyProductionV3({
      authorized,
      transportFactory: dormantFactory,
    }).then(
      (result) => ({ result, error: null }),
      (error: unknown) => ({ result: null, error }),
    );
    const [result, replay] = await Promise.all([first, concurrentReplay]);
    expect(replay.result).toBeNull();
    expect(String(replay.error)).toMatch(/already consumed/u);
    expect(inspectTestOnlySamTextHeavyProductionV3TransportFactory(dormantFactory)).toEqual({
      constructionCount: 0,
      dispatchCount: 0,
      fetchCount: 0,
    });
    await expect(
      executeSamTextHeavyProductionV3({
        authorized,
        transportFactory: dormantFactory,
      }),
    ).rejects.toThrow(/already consumed/u);
    expect(result).toMatchObject({
      classification: 'provider-free-deterministic-fake',
      canonicalRequestByteLength: 222_620,
      canonicalRequestSha256: 'a14354bb67685293a8aa3c2523db36506b2050d53f0dea90c4070bcdd015ee26',
      transportConstructionCount: 1,
      dispatchCount: 1,
      fetchCount: 0,
      materializationCount: 1,
      retryCount: 0,
      redirectCount: 0,
      pollCount: 0,
      healthRequestCount: 0,
      pingRequestCount: 0,
      queueRequestCount: 0,
      timeoutMs: 330_000,
      providerBillingGuarantee: false,
      billingEvidence: {
        kind: 'authorization-ceiling-only',
        incrementalCostMaximumMicroUsd: 250_000,
        observedProviderCostMicroUsd: null,
        providerBillingGuarantee: false,
      },
    });
    expect(result.runtimeMs).toBeGreaterThanOrEqual(0);
    expect(result.validatedResponseSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(inspectTestOnlySamTextHeavyProductionV3TransportFactory(factory)).toEqual({
      constructionCount: 1,
      dispatchCount: 1,
      fetchCount: 0,
    });
    const verified = await verifySamCorpusVisualArtifactSetV2(context.outputDirectory);
    expect(verified).toEqual(result.artifacts);
    expect(verified.inventory).toHaveLength(3 + 3 * 2);
    expect(verified.manifest).toMatchObject({
      outputClassification: 'fake-test-output',
      label: SAM_CORPUS_FAKE_OUTPUT_LABEL,
      candidateCount: 2,
      identities: {
        targetExecution: SAM_CORPUS_EXECUTION_IDENTITY,
        actualExecution: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
      },
      inventory: { expectedFileCount: 9 },
    });
    expect(verified.manifestSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(verified.sanitizedResponseSha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(verified.inventorySha256).toMatch(/^[0-9a-f]{64}$/u);

    const candidateJudgment = (proposedLayerId: string) => ({
      artifactInspection: {
        mask: { inspected: true as const, findings: 'Mask artifact inspected.' },
        cutout: { inspected: true as const, findings: 'Cutout artifact inspected.' },
        overlay: { inspected: true as const, findings: 'Overlay artifact inspected.' },
      },
      proposedLayerId,
      rationale: 'Provider-neutral proposed-layer mapping for deterministic fake evidence.',
      usability: 'usable' as const,
      scores: {
        semanticUsefulness: 3,
        completeness: 3,
        edgeMatteQuality: 3,
        backgroundCleanliness: 3,
        granularityIntegrity: 3,
        repairReadiness: 3,
      },
      duplicateOfCandidateOrders: [] as number[],
      mergeWithCandidateOrders: [] as number[],
    });
    const review = createSamCorpusVisualReviewV1(result.reviewEvidence, {
      candidates: [
        candidateJudgment('text-heavy.layer.stand'),
        candidateJudgment('text-heavy.layer.header'),
      ],
      missingLayerObservations: [
        { layerId: 'text-heavy.layer.background', rationale: 'No proposed candidate.' },
        { layerId: 'text-heavy.layer.options', rationale: 'No proposed candidate.' },
        { layerId: 'text-heavy.layer.lower-accent', rationale: 'No proposed candidate.' },
      ],
      duplicateObservations: [],
      mergeObservations: [],
      fixtureUsability: 'repairable',
      fixtureRationale: 'Two useful proposed layers; three approved layers remain missing.',
    });
    expect(review).toMatchObject({
      fixtureId: 'banner-text-heavy-v1',
      candidateCount: 2,
      scorePolarity: 'zero-worst-four-best-no-average',
      fixtureUsability: 'repairable',
      providerNeutral: true,
      providerCallAuthority: false,
    });
    expect(review).not.toHaveProperty('averageScore');
    expect(() =>
      createSamCorpusVisualReviewV1(result.reviewEvidence, {
        candidates: [],
        missingLayerObservations: [],
        duplicateObservations: [],
        mergeObservations: [],
        fixtureUsability: 'unusable',
        fixtureRationale: 'replay',
      }),
    ).toThrow(/already consumed/u);
  }, 30_000);

  it('contains no environment, logging, public-export, or provider-fetch test escape hatch', async () => {
    const sourceRoot = join(process.cwd(), 'packages', 'banner-ai', 'src');
    const files = [
      'server/sam-text-heavy-production-v3-reservation.ts',
      'server/sam-text-heavy-production-v3-authorization.ts',
      'server/sam-text-heavy-production-v3-control.ts',
    ];
    const source = (
      await Promise.all(files.map((file) => readFile(join(sourceRoot, file), 'utf8')))
    ).join('\n');
    expect(source).not.toMatch(/process\.env|Bun\.env|Deno\.env|getenv|console\.|logger\./u);
    expect(source).not.toMatch(/RUNPOD_CONTROL_PLANE_API_KEY/u);
    const publicIndex = await readFile(join(sourceRoot, 'index.ts'), 'utf8');
    expect(publicIndex).not.toMatch(/sam-text-heavy-production-v3/u);
  });
});
