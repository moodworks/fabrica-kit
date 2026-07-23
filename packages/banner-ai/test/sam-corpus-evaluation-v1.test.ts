import { readFileSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  lstat,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  HUMAN_ORACLE_APPROVED_BY_FIXTURE_V2,
  HUMAN_ORACLE_APPROVED_CORPUS_ENTRIES_V2,
  REAL_MODEL_BENCHMARK_HUMAN_ORACLE_CORPUS_V2,
} from '../src/evaluation/real-model-benchmark-human-oracle.js';
import { SAM_MASK_CONTRACT_VERSION, type SamMaskResponse } from '../src/sam/sam-mask-contracts.js';
import { postprocessSamMasks, type SamRawMaskCandidate } from '../src/sam/sam-mask-postprocess.js';
import { canonicalResponseSha256 } from '../src/sam/sam-mask-rle.js';
import { parseAndVerifySamMaskResponse } from '../src/sam/sam-mask-validation.js';
import { canonicalizeJson, sha256Hex } from '../src/scene/canonical-scene-json.js';
import {
  SAM_AUTOMATIC_CAPACITY_CEILING_BYTES,
  SAM_CORPUS_CAPACITY_MATRIX_V1,
  SAM_CORPUS_EVALUATION_FIXTURES_V1,
  SAM_CORPUS_EXECUTION_IDENTITY,
  SAM_CORPUS_LOCAL_IDENTITY_EVIDENCE,
  SAM_CORPUS_LOCAL_IDENTITY_EVIDENCE_SHA256,
  SAM_CORPUS_PROFILE_IDENTITIES,
  SAM_CORPUS_WORKER_IMAGE,
  SAM_CORPUS_WORKER_IMAGE_DIGEST,
  deriveSamAutomaticBatchPeakBytesV1,
  inspectSamCorpusPreparedRequestV1,
  prepareSamNoTextCorpusRequestV1,
  prepareSamProductCorpusRequestV1,
  prepareSamTextHeavyCorpusRequestV1,
  verifySamCorpusCanonicalRequestIdentitiesV1,
  type SamCorpusPreparedRequestV1,
} from '../src/server/sam-corpus-evaluation-catalog-v1.js';
import {
  authorizeTestOnlySamCorpusDispatchV1,
  consumeTestOnlySamCorpusAuthorizedDispatchV1,
  createTestOnlySamCorpusAuthorizationSourcesV1,
  mintTestOnlySamCorpusAuthorizationV1,
  validateTestOnlySamCorpusAuthorizationV1,
} from '../src/server/sam-corpus-evaluation-authorization-v1.js';
import {
  SAM_CORPUS_EVALUATION_ACTIVATION_V1,
  createSamCorpusProviderFreeTransportFactoryV1,
  executeSamNoTextCorpusProviderFreeV1,
  executeSamProductCorpusProviderFreeV1,
  executeSamTextHeavyCorpusProviderFreeV1,
  inspectSamCorpusTransportFactoryCountersV1,
} from '../src/server/sam-corpus-evaluation-control-v1.js';
import {
  SamCorpusSanitizedResponseV2Schema,
  SamCorpusVisualManifestV2Schema,
  assertSamCorpusOutputDirectoryAbsentV2,
  materializeSamCorpusVisualEvaluationV2,
  validateSamCorpusVisualResponseV2,
  verifySamCorpusVisualArtifactSetV2,
  type SamCorpusSanitizedResponseV2,
} from '../src/server/sam-corpus-visual-evaluation-v2.js';
import { SamRunPodDirectV3Error } from '../src/server/sam-runpod-direct-v3-adapter.js';
import { SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY } from '../src/server/sam-runpod-direct-v3-deterministic-fake-transport.js';
import {
  SAM_FIRST_INFERENCE_REQUEST_IDENTIFIERS,
  prepareSamFirstInferenceV3Request,
} from '../src/server/sam-runpod-direct-v3-request-preparation.js';

const temporaryRoots: string[] = [];

const temporaryRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'fabrica-sam-corpus-fake-test-'));
  temporaryRoots.push(root);
  return root;
};

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

const sourceCounter = (authorizationId: string) => {
  let clockCalls = 0;
  let identifierCalls = 0;
  const sources = createTestOnlySamCorpusAuthorizationSourcesV1({
    nowMs: () => {
      clockCalls += 1;
      return Date.parse('2026-07-23T12:00:00Z');
    },
    authorizationId: () => {
      identifierCalls += 1;
      return authorizationId;
    },
  });
  return {
    sources,
    counts: () => ({ clockCalls, identifierCalls }),
  };
};

const rawCandidates = (
  prepared: SamCorpusPreparedRequestV1,
  count: number,
): readonly SamRawMaskCandidate[] => {
  const request = inspectSamCorpusPreparedRequestV1(prepared).directPrepared.request;
  return Array.from({ length: count }, (_, index) => {
    const width = 8 + (index % 3);
    const height = 8 + index;
    const left = 4 + index * 16;
    const top = 4 + index * 13;
    const mask = new Uint8Array(request.source.width * request.source.height);
    for (let y = top; y < top + height; y += 1) {
      mask.fill(1, y * request.source.width + left, y * request.source.width + left + width);
    }
    return {
      mask,
      predictedIou: 0.99 - index * 0.02,
      stabilityScore: 0.98 - index * 0.015,
    };
  });
};

const strictlyValidatedFakeResponse = (
  prepared: SamCorpusPreparedRequestV1,
  count: number,
): SamMaskResponse => {
  const request = inspectSamCorpusPreparedRequestV1(prepared).directPrepared.request;
  const result = postprocessSamMasks(request, rawCandidates(prepared, count));
  const unsigned: Omit<SamMaskResponse, 'responseSha256'> = {
    contractVersion: request.contractVersion,
    requestId: request.requestId,
    workspaceId: request.workspaceId,
    jobId: request.jobId,
    attemptId: request.attemptId,
    sourceSha256: request.source.sha256,
    executionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
    timing: { inferenceMs: 0, totalMs: 0 },
    filterSummary: result.filterSummary,
    candidateCount: result.candidates.length,
    candidates: result.candidates,
  };
  return parseAndVerifySamMaskResponse({
    response: { ...unsigned, responseSha256: canonicalResponseSha256(unsigned) },
    request,
    expectedExecutionKind: 'deterministic-fake',
  });
};

const rewriteCanonicalSanitizedEvidence = async (
  outputDirectory: string,
  mutate: (response: SamCorpusSanitizedResponseV2) => unknown,
): Promise<void> => {
  const responsePath = join(outputDirectory, 'response.json');
  const manifestPath = join(outputDirectory, 'manifest.json');
  const response = SamCorpusSanitizedResponseV2Schema.parse(
    JSON.parse(await readFile(responsePath, 'utf8')),
  );
  const changedResponse = SamCorpusSanitizedResponseV2Schema.parse(mutate(response));
  const changedResponseBytes = Buffer.from(`${canonicalizeJson(changedResponse)}\n`, 'utf8');
  const manifest = SamCorpusVisualManifestV2Schema.parse(
    JSON.parse(await readFile(manifestPath, 'utf8')),
  );
  const responseArtifact = Object.freeze({
    filename: 'response.json',
    byteLength: changedResponseBytes.byteLength,
    sha256: sha256Hex(changedResponseBytes),
  });
  const changedCandidates = changedResponse.candidates.map((candidate, index) => ({
    ...candidate,
    artifacts: manifest.candidates[index]!.artifacts,
  }));
  const nonManifestMetadata = [
    manifest.source,
    responseArtifact,
    ...changedCandidates.flatMap((candidate) => Object.values(candidate.artifacts)),
  ].toSorted((left, right) =>
    left.filename < right.filename ? -1 : left.filename > right.filename ? 1 : 0,
  );
  const changedManifest = SamCorpusVisualManifestV2Schema.parse({
    ...manifest,
    validatedResponseSha256: changedResponse.validatedResponseSha256,
    sanitizedResponse: responseArtifact,
    candidates: changedCandidates,
    inventory: {
      ...manifest.inventory,
      nonManifestSha256: sha256Hex(Buffer.from(canonicalizeJson(nonManifestMetadata), 'utf8')),
    },
  });
  await writeFile(responsePath, changedResponseBytes);
  await writeFile(manifestPath, `${canonicalizeJson(changedManifest)}\n`, 'utf8');
};

const changeFirstSanitizedCandidate = (
  response: SamCorpusSanitizedResponseV2,
  change: (candidate: SamCorpusSanitizedResponseV2['candidates'][number]) => unknown,
): unknown => ({
  ...response,
  candidates: response.candidates.map((candidate, index) =>
    index === 0 ? change(candidate) : candidate,
  ),
});

const reconstructedZeroCandidateResponseSha256 = (
  response: SamCorpusSanitizedResponseV2,
): string => {
  if (response.candidateCount !== 0 || response.candidates.length !== 0) {
    throw new TypeError('Zero-candidate response reconstruction received candidates.');
  }
  const unsigned: Omit<SamMaskResponse, 'responseSha256'> = {
    contractVersion: SAM_MASK_CONTRACT_VERSION,
    requestId: response.requestId,
    workspaceId: response.workspaceId,
    jobId: response.jobId,
    attemptId: response.attemptId,
    sourceSha256: response.sourceSha256,
    executionIdentity: response.executionIdentity,
    timing: response.timing,
    filterSummary: response.filterSummary,
    candidateCount: 0,
    candidates: [],
  };
  return canonicalResponseSha256(unsigned);
};

describe('SAM corpus closed catalog and capacity gate', () => {
  it('pins all deployment, worker, local identity, and profile evidence', () => {
    expect(SAM_CORPUS_WORKER_IMAGE).toBe(
      'ghcr.io/moodworks/fabrica-sam-worker@sha256:5f6058eb5f626ada2ce9ad3e9f105cd12b601f614df83265ab8479c8403ae7a8',
    );
    expect(SAM_CORPUS_WORKER_IMAGE_DIGEST).toBe(
      'sha256:5f6058eb5f626ada2ce9ad3e9f105cd12b601f614df83265ab8479c8403ae7a8',
    );
    expect(SAM_CORPUS_EXECUTION_IDENTITY).toMatchObject({
      kind: 'meta-sam2.1',
      repositoryCommit: '05d9e57fb3945b10c861046c1e6749e2bfc258e3',
      modelId: 'sam2.1_hiera_base_plus',
      configIdentity: 'configs/sam2.1/sam2.1_hiera_b+.yaml',
      checkpointSha256: 'a2345aede8715ab1d5d31b4a509fb160c5a4af1970f199d9054ccfb746c004c5',
    });
    expect(sha256Hex(Buffer.from(canonicalizeJson(SAM_CORPUS_LOCAL_IDENTITY_EVIDENCE)))).toBe(
      SAM_CORPUS_LOCAL_IDENTITY_EVIDENCE_SHA256,
    );
    expect(SAM_CORPUS_PROFILE_IDENTITIES).toEqual({
      hostingSha256: '872054e82fc13e771fa65381e2db1f19dfb2dd609584574e8c532ed8eb82fa18',
      adapterV3Sha256: '1e6795c970fcfa9443b850f27149e237daf63ffa668cd5094189936453467e28',
      authorizationV3Sha256: '194272140ae7e717a69f122f6a3e7b1083c80a5f3022f12ffd73ca0016183492',
    });
    expect(REAL_MODEL_BENCHMARK_HUMAN_ORACLE_CORPUS_V2.corpusSha256).toBe(
      'aa499d5560a97a2bf7df84fd0240f39941a82f485f804a42a608d96cb9acba51',
    );
    for (const entry of Object.values(SAM_CORPUS_EVALUATION_FIXTURES_V1)) {
      const oracle = HUMAN_ORACLE_APPROVED_BY_FIXTURE_V2[entry.fixtureId];
      const approvedEntry = HUMAN_ORACLE_APPROVED_CORPUS_ENTRIES_V2.find(
        (candidateEntry) => candidateEntry.fixtureId === entry.fixtureId,
      );
      expect(oracle.sourceBinding.original).toEqual({
        detectedMediaType: entry.original.mediaType,
        byteSize: entry.original.byteLength,
        pixelWidth: entry.original.width,
        pixelHeight: entry.original.height,
        sha256: entry.original.sha256,
      });
      expect(oracle.sourceBinding.canonicalNormalized).toEqual({
        detectedMediaType: entry.normalized.mediaType,
        byteSize: entry.normalized.byteLength,
        pixelWidth: entry.normalized.width,
        pixelHeight: entry.normalized.height,
        sha256: entry.normalized.sha256,
      });
      expect(oracle.oracleSha256).toBe(entry.humanOracle.oracleSha256);
      expect(approvedEntry?.entrySha256).toBe(entry.humanOracle.approvedEntrySha256);
      expect(oracle.requiredLayers.map((layer) => layer.oracleLayerId)).toEqual(
        entry.humanOracle.requiredLayerIds,
      );
    }
  });

  it('reproduces the complete endpoint-v12 capacity matrix with the worker formula', () => {
    expect(SAM_AUTOMATIC_CAPACITY_CEILING_BYTES).toBe(268_435_456);
    expect(SAM_CORPUS_CAPACITY_MATRIX_V1).toEqual({
      person: { width: 876, height: 221, automaticOnePointPeakBytes: 106_223_296, eligible: true },
      product: {
        width: 2_015,
        height: 900,
        automaticOnePointPeakBytes: 650_511_040,
        eligible: false,
      },
      'text-heavy': {
        width: 416,
        height: 522,
        automaticOnePointPeakBytes: 114_138_112,
        eligible: true,
      },
      'no-text': {
        width: 738,
        height: 255,
        automaticOnePointPeakBytes: 104_406_880,
        eligible: true,
      },
    });
    for (const fixture of Object.values(SAM_CORPUS_CAPACITY_MATRIX_V1)) {
      expect(deriveSamAutomaticBatchPeakBytesV1(fixture.width, fixture.height, 1)).toBe(
        fixture.automaticOnePointPeakBytes,
      );
    }
  });

  it('independently reconstructs and freezes all three canonical requests', async () => {
    await expect(verifySamCorpusCanonicalRequestIdentitiesV1()).resolves.toEqual([
      {
        fixtureKey: 'product',
        byteLength: 2_646_546,
        sha256: '61da2a2f6695365265c534ab06d30b4fedc3bf80e1c6a17ce8a86b4674315d20',
        dispatchAuthority: false,
      },
      {
        fixtureKey: 'text-heavy',
        byteLength: 222_620,
        sha256: 'a14354bb67685293a8aa3c2523db36506b2050d53f0dea90c4070bcdd015ee26',
        dispatchAuthority: false,
      },
      {
        fixtureKey: 'no-text',
        byteLength: 168_532,
        sha256: '53c78a074f8b92a36051fd6474ad4256af841218195fbee1fdfcfa29dcee7644',
        dispatchAuthority: false,
      },
    ]);
    const identifiers = [
      ...Object.values(SAM_FIRST_INFERENCE_REQUEST_IDENTIFIERS),
      ...Object.values(SAM_CORPUS_EVALUATION_FIXTURES_V1).flatMap((entry) =>
        Object.values(entry.identifiers),
      ),
    ];
    expect(identifiers).toHaveLength(16);
    expect(new Set(identifiers).size).toBe(16);
  });

  it('prepares text-heavy and no-text independently and rejects reconstruction', async () => {
    const [textHeavy, noText] = await Promise.all([
      prepareSamTextHeavyCorpusRequestV1(),
      prepareSamNoTextCorpusRequestV1(),
    ]);
    expect(textHeavy.canonicalBodySha256).not.toBe(noText.canonicalBodySha256);
    expect(inspectSamCorpusPreparedRequestV1(textHeavy).catalogEntry.fixtureKey).toBe('text-heavy');
    expect(inspectSamCorpusPreparedRequestV1(noText).catalogEntry.fixtureKey).toBe('no-text');
    expect(() =>
      inspectSamCorpusPreparedRequestV1({ ...textHeavy } as SamCorpusPreparedRequestV1),
    ).toThrow(/foreign or reconstructed/u);
  });

  it('rejects every caller-supplied preparation or verification input', async () => {
    const callerInput = Object.freeze({ fixtureKey: 'text-heavy' });
    await expect(prepareSamProductCorpusRequestV1(callerInput as never)).rejects.toThrow(
      /no caller input/u,
    );
    await expect(prepareSamTextHeavyCorpusRequestV1(callerInput as never)).rejects.toThrow(
      /no caller input/u,
    );
    await expect(prepareSamNoTextCorpusRequestV1(callerInput as never)).rejects.toThrow(
      /no caller input/u,
    );
    await expect(verifySamCorpusCanonicalRequestIdentitiesV1(callerInput as never)).rejects.toThrow(
      /no caller input/u,
    );
  });

  it('preserves the person V1 canonical request identity', async () => {
    const person = await prepareSamFirstInferenceV3Request();
    expect(person.canonicalBodyByteLength).toBe(322_024);
    expect(person.canonicalBodySha256).toBe(
      '506e75d829f2494f34a58e9e9f4d610b9b0881a520ed815e7b38f62561815f80',
    );
  });
});

describe('SAM corpus fixture-exact authorization', () => {
  it('binds one opaque preparation and grants nothing to another fixture', async () => {
    const [textHeavy, noText] = await Promise.all([
      prepareSamTextHeavyCorpusRequestV1(),
      prepareSamNoTextCorpusRequestV1(),
    ]);
    const textSources = sourceCounter('11111111-1111-4111-8111-111111111111');
    const noTextSources = sourceCounter('22222222-2222-4222-8222-222222222222');
    const textAuthorization = mintTestOnlySamCorpusAuthorizationV1(textHeavy, textSources.sources);
    const noTextAuthorization = mintTestOnlySamCorpusAuthorizationV1(noText, noTextSources.sources);
    expect(textAuthorization).toMatchObject({
      fixtureKey: 'text-heavy',
      fixtureId: 'banner-text-heavy-v1',
      sourceSha256: SAM_CORPUS_EVALUATION_FIXTURES_V1['text-heavy'].normalized.sha256,
      executionIdentity: SAM_CORPUS_EXECUTION_IDENTITY,
      profiles: SAM_CORPUS_PROFILE_IDENTITIES,
      requestLimits: { minMaskAreaPixels: 64, maxCandidates: 8 },
      output: { maskEncoding: 'fabrica-binary-rle-v1' },
      dispatchMaximum: 1,
      materializationMaximum: 1,
      retryCount: 0,
      pollCount: 0,
      providerBillingGuarantee: false,
      providerCallAuthority: false,
      productionExecutionAuthority: false,
      corpusBatchAuthority: false,
    });
    expect(() =>
      validateTestOnlySamCorpusAuthorizationV1({
        prepared: noText,
        authorization: textAuthorization,
        sources: noTextSources.sources,
      }),
    ).toThrow(/fixture-mismatched/u);
    expect(() =>
      validateTestOnlySamCorpusAuthorizationV1({
        prepared: textHeavy,
        authorization: noTextAuthorization,
        sources: textSources.sources,
      }),
    ).toThrow(/fixture-mismatched/u);
  });

  it('rejects an authorization identifier collision across independent fixtures', async () => {
    const [textHeavy, noText] = await Promise.all([
      prepareSamTextHeavyCorpusRequestV1(),
      prepareSamNoTextCorpusRequestV1(),
    ]);
    const collisionId = '99999999-9999-4999-8999-999999999999';
    const textSources = sourceCounter(collisionId);
    const noTextSources = sourceCounter(collisionId);
    expect(mintTestOnlySamCorpusAuthorizationV1(textHeavy, textSources.sources)).toMatchObject({
      authorizationId: collisionId,
      fixtureKey: 'text-heavy',
    });
    expect(() => mintTestOnlySamCorpusAuthorizationV1(noText, noTextSources.sources)).toThrow(
      /identifier was already issued/u,
    );
  });

  it('rejects reconstructed, mutated, replayed, and multiply minted authority', async () => {
    const prepared = await prepareSamTextHeavyCorpusRequestV1();
    const source = sourceCounter('33333333-3333-4333-8333-333333333333');
    const authorization = mintTestOnlySamCorpusAuthorizationV1(prepared, source.sources);
    const reconstructed = structuredClone(authorization);
    expect(() =>
      validateTestOnlySamCorpusAuthorizationV1({
        prepared,
        authorization: reconstructed,
        sources: source.sources,
      }),
    ).toThrow(/foreign|reconstructed/u);
    const mutated = structuredClone(authorization);
    Object.assign(mutated, { canonicalRequestSha256: 'f'.repeat(64) });
    expect(() =>
      validateTestOnlySamCorpusAuthorizationV1({
        prepared,
        authorization: mutated,
        sources: source.sources,
      }),
    ).toThrow(/foreign|reconstructed/u);
    expect(() => mintTestOnlySamCorpusAuthorizationV1(prepared, source.sources)).toThrow(
      /one authorization/u,
    );
    const authorized = authorizeTestOnlySamCorpusDispatchV1({
      prepared,
      authorization,
      sources: source.sources,
    });
    expect(consumeTestOnlySamCorpusAuthorizedDispatchV1(authorized).prepared).toBe(prepared);
    expect(() => consumeTestOnlySamCorpusAuthorizedDispatchV1(authorized)).toThrow(
      /already consumed/u,
    );
    expect(() =>
      authorizeTestOnlySamCorpusDispatchV1({
        prepared,
        authorization,
        sources: source.sources,
      }),
    ).toThrow(/already consumed/u);
  });

  it('rejects an authorization exactly at its short-lived expiry', async () => {
    const prepared = await prepareSamNoTextCorpusRequestV1();
    let nowMs = Date.parse('2026-07-23T12:00:00Z');
    const sources = createTestOnlySamCorpusAuthorizationSourcesV1({
      nowMs: () => nowMs,
      authorizationId: () => '88888888-8888-4888-8888-888888888888',
    });
    const authorization = mintTestOnlySamCorpusAuthorizationV1(prepared, sources);
    nowMs = authorization.expiresAtMs;
    expect(() =>
      validateTestOnlySamCorpusAuthorizationV1({ prepared, authorization, sources }),
    ).toThrow(/stale|identity-mismatched/u);
  });
});

describe('SAM corpus V2 dynamic materialization', () => {
  it.each(Array.from({ length: 9 }, (_, candidateCount) => candidateCount))(
    'strictly verifies candidateCount=%i as exactly 3 + 3N files',
    async (candidateCount) => {
      const prepared = await prepareSamNoTextCorpusRequestV1();
      const response = strictlyValidatedFakeResponse(prepared, candidateCount);
      const validated = validateSamCorpusVisualResponseV2({
        prepared,
        response,
        outputClassification: 'fake-test-output',
      });
      const root = await temporaryRoot();
      const output = join(root, `candidate-${candidateCount}-fake-output`);
      const materialized = await materializeSamCorpusVisualEvaluationV2({
        validated,
        outputDirectory: output,
      });
      expect(materialized.manifest.candidateCount).toBe(candidateCount);
      expect(materialized.inventory).toHaveLength(3 + 3 * candidateCount);
      expect(materialized.manifest.inventory.expectedFileCount).toBe(3 + 3 * candidateCount);
      expect(materialized.manifest.source.sha256).toBe(
        SAM_CORPUS_EVALUATION_FIXTURES_V1['no-text'].normalized.sha256,
      );
      expect(materialized.manifest.validatedResponseSha256).toBe(response.responseSha256);
      expect(materialized.manifestSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(materialized.sanitizedResponseSha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(materialized.inventorySha256).toMatch(/^[0-9a-f]{64}$/u);
      await expect(verifySamCorpusVisualArtifactSetV2(output)).resolves.toEqual(materialized);
    },
    30_000,
  );

  it.each([
    ['requestId', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'],
    ['workspaceId', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'],
    ['jobId', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3'],
    ['attemptId', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'],
  ] as const)('rejects a canonically rewritten %s', async (field, replacement) => {
    const prepared = await prepareSamNoTextCorpusRequestV1();
    const validated = validateSamCorpusVisualResponseV2({
      prepared,
      response: strictlyValidatedFakeResponse(prepared, 0),
      outputClassification: 'fake-test-output',
    });
    const root = await temporaryRoot();
    const output = join(root, `${field.toLowerCase()}-tamper-fake-output`);
    await materializeSamCorpusVisualEvaluationV2({ validated, outputDirectory: output });
    await rewriteCanonicalSanitizedEvidence(output, (response) => ({
      ...response,
      [field]: replacement,
    }));
    await expect(verifySamCorpusVisualArtifactSetV2(output)).rejects.toThrow(
      /frozen request identifiers/u,
    );
  });

  it.each([
    [
      'mask dimensions',
      (response: SamCorpusSanitizedResponseV2) =>
        changeFirstSanitizedCandidate(response, (candidate) => ({
          ...candidate,
          mask: { ...candidate.mask, width: candidate.mask.width + 1 },
        })),
      /dimensions, canonical RLE length, or area ratio/u,
    ],
    [
      'encoded RLE length',
      (response: SamCorpusSanitizedResponseV2) =>
        changeFirstSanitizedCandidate(response, (candidate) => ({
          ...candidate,
          mask: {
            ...candidate.mask,
            encodedByteLength: candidate.mask.encodedByteLength + 1,
          },
        })),
      /dimensions, canonical RLE length, or area ratio/u,
    ],
    [
      'area ratio',
      (response: SamCorpusSanitizedResponseV2) =>
        changeFirstSanitizedCandidate(response, (candidate) => ({
          ...candidate,
          areaRatioBps: candidate.areaRatioBps + 1,
        })),
      /dimensions, canonical RLE length, or area ratio/u,
    ],
    [
      'candidate ordering',
      (response: SamCorpusSanitizedResponseV2) =>
        changeFirstSanitizedCandidate(response, (candidate) => ({
          ...candidate,
          predictedIouBps: 0,
        })),
      /not canonically ordered/u,
    ],
    [
      'review flags',
      (response: SamCorpusSanitizedResponseV2) =>
        changeFirstSanitizedCandidate(response, (candidate) => ({
          ...candidate,
          reviewFlags: ['touches-source-edge'],
        })),
      /review flags are not exactly reproducible/u,
    ],
  ] as const)(
    'rejects coherent candidate tampering of %s',
    async (_label, mutate, expectedError) => {
      const prepared = await prepareSamNoTextCorpusRequestV1();
      const validated = validateSamCorpusVisualResponseV2({
        prepared,
        response: strictlyValidatedFakeResponse(prepared, 2),
        outputClassification: 'fake-test-output',
      });
      const root = await temporaryRoot();
      const output = join(root, `candidate-invariant-${_label.replaceAll(' ', '-')}-fake-output`);
      await materializeSamCorpusVisualEvaluationV2({ validated, outputDirectory: output });
      await rewriteCanonicalSanitizedEvidence(output, mutate);
      await expect(verifySamCorpusVisualArtifactSetV2(output)).rejects.toThrow(expectedError);
    },
    30_000,
  );

  it('rejects a coherently rebound validated response SHA-256 that artifacts cannot reproduce', async () => {
    const prepared = await prepareSamNoTextCorpusRequestV1();
    const validated = validateSamCorpusVisualResponseV2({
      prepared,
      response: strictlyValidatedFakeResponse(prepared, 0),
      outputClassification: 'fake-test-output',
    });
    const root = await temporaryRoot();
    const output = join(root, 'validated-response-hash-tamper-fake-output');
    await materializeSamCorpusVisualEvaluationV2({ validated, outputDirectory: output });
    await rewriteCanonicalSanitizedEvidence(output, (response) => ({
      ...response,
      validatedResponseSha256: SAM_CORPUS_EVALUATION_FIXTURES_V1['no-text'].canonicalRequest.sha256,
    }));
    await expect(verifySamCorpusVisualArtifactSetV2(output)).rejects.toThrow(
      /validated response SHA-256 is not reproducible/u,
    );
  });

  it.each([
    [
      'timing inconsistency',
      (response: SamCorpusSanitizedResponseV2) => {
        const changed = { ...response, timing: { inferenceMs: 1, totalMs: 0 } };
        return {
          ...changed,
          validatedResponseSha256: reconstructedZeroCandidateResponseSha256(changed),
        };
      },
      /timing is internally inconsistent/u,
    ],
    [
      'filter accounting inconsistency',
      (response: SamCorpusSanitizedResponseV2) => {
        const changed = {
          ...response,
          filterSummary: {
            ...response.filterSummary,
            rawCandidateCount: response.filterSummary.rawCandidateCount + 1,
          },
        };
        return {
          ...changed,
          validatedResponseSha256: reconstructedZeroCandidateResponseSha256(changed),
        };
      },
      /filter accounting is not exact/u,
    ],
  ] as const)(
    'runs strict response validation for coherent %s',
    async (_label, mutate, expectedError) => {
      const prepared = await prepareSamNoTextCorpusRequestV1();
      const validated = validateSamCorpusVisualResponseV2({
        prepared,
        response: strictlyValidatedFakeResponse(prepared, 0),
        outputClassification: 'fake-test-output',
      });
      const root = await temporaryRoot();
      const output = join(root, `strict-${_label.replaceAll(' ', '-')}-fake-output`);
      await materializeSamCorpusVisualEvaluationV2({ validated, outputDirectory: output });
      await rewriteCanonicalSanitizedEvidence(output, mutate);
      await expect(verifySamCorpusVisualArtifactSetV2(output)).rejects.toThrow(expectedError);
    },
  );

  it('fails closed on an existing output, a symbolic parent, and a response hash mutation', async () => {
    const root = await temporaryRoot();
    const existing = join(root, 'existing-fake-output');
    await mkdir(existing);
    await expect(
      assertSamCorpusOutputDirectoryAbsentV2({
        outputDirectory: existing,
        outputClassification: 'fake-test-output',
      }),
    ).rejects.toThrow(/must both be absent/u);

    const realParent = join(root, 'real-parent');
    const linkedParent = join(root, 'linked-parent');
    await mkdir(realParent);
    await symlink(realParent, linkedParent);
    await expect(
      assertSamCorpusOutputDirectoryAbsentV2({
        outputDirectory: join(linkedParent, 'linked-fake-output'),
        outputClassification: 'fake-test-output',
      }),
    ).rejects.toThrow(/symbolic|ambiguous/u);

    const prepared = await prepareSamNoTextCorpusRequestV1();
    const validated = validateSamCorpusVisualResponseV2({
      prepared,
      response: strictlyValidatedFakeResponse(prepared, 1),
      outputClassification: 'fake-test-output',
    });
    const output = join(root, 'tampered-response-fake-output');
    await materializeSamCorpusVisualEvaluationV2({ validated, outputDirectory: output });
    const responsePath = join(output, 'response.json');
    const responseBytes = await readFile(responsePath);
    responseBytes[20] = responseBytes[20]! ^ 1;
    await writeFile(responsePath, responseBytes);
    await expect(verifySamCorpusVisualArtifactSetV2(output)).rejects.toThrow(
      /length|SHA-256|JSON/u,
    );
  });

  it('rejects repository and path-escape targets plus an unexpected artifact', async () => {
    await expect(
      assertSamCorpusOutputDirectoryAbsentV2({
        outputDirectory: join(process.cwd(), 'packages', 'sam-corpus-fake-output'),
        outputClassification: 'fake-test-output',
      }),
    ).rejects.toThrow(/outside the repository/u);

    const root = await temporaryRoot();
    await expect(
      assertSamCorpusOutputDirectoryAbsentV2({
        outputDirectory: `${root}/nested/../escaped-fake-output`,
        outputClassification: 'fake-test-output',
      }),
    ).rejects.toThrow(/exact, absolute, and unambiguous/u);

    const prepared = await prepareSamNoTextCorpusRequestV1();
    const validated = validateSamCorpusVisualResponseV2({
      prepared,
      response: strictlyValidatedFakeResponse(prepared, 1),
      outputClassification: 'fake-test-output',
    });
    const output = join(root, 'unexpected-artifact-fake-output');
    await materializeSamCorpusVisualEvaluationV2({ validated, outputDirectory: output });
    await writeFile(join(output, 'unexpected.txt'), 'unexpected artifact\n');
    await expect(verifySamCorpusVisualArtifactSetV2(output)).rejects.toThrow(/inventory/u);
  });

  it('rejects an artifact symlink and preserves an empty raced destination', async () => {
    const root = await temporaryRoot();
    const prepared = await prepareSamNoTextCorpusRequestV1();
    const validated = validateSamCorpusVisualResponseV2({
      prepared,
      response: strictlyValidatedFakeResponse(prepared, 1),
      outputClassification: 'fake-test-output',
    });
    const output = join(root, 'symlink-artifact-fake-output');
    await materializeSamCorpusVisualEvaluationV2({ validated, outputDirectory: output });
    const mask = join(output, 'candidate-01-mask.png');
    await unlink(mask);
    await symlink(join(output, 'source.png'), mask);
    await expect(verifySamCorpusVisualArtifactSetV2(output)).rejects.toThrow(/non-symlink/u);

    const preparedRace = await prepareSamNoTextCorpusRequestV1();
    const validatedRace = validateSamCorpusVisualResponseV2({
      prepared: preparedRace,
      response: strictlyValidatedFakeResponse(preparedRace, 8),
      outputClassification: 'fake-test-output',
    });
    const racedOutput = join(root, 'raced-fake-output');
    const attempt = materializeSamCorpusVisualEvaluationV2({
      validated: validatedRace,
      outputDirectory: racedOutput,
    });
    const rejection = expect(attempt).rejects.toThrow();
    const stagingOutput = `${racedOutput}.fabrica-sam-corpus-staging`;
    await expect
      .poll(
        async () => {
          try {
            return (await lstat(stagingOutput)).isDirectory();
          } catch {
            return false;
          }
        },
        { interval: 1, timeout: 10_000 },
      )
      .toBe(true);
    await mkdir(racedOutput, { recursive: false });
    await rejection;
    await expect(readdir(racedOutput)).resolves.toEqual([]);
    await expect(lstat(stagingOutput)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);
});

describe('SAM corpus one-fixture provider-free control', () => {
  it('refuses product before minting, transport construction, dispatch, or output creation', async () => {
    const root = await temporaryRoot();
    const output = join(root, 'product-fake-output');
    const source = sourceCounter('44444444-4444-4444-8444-444444444444');
    const factory = createSamCorpusProviderFreeTransportFactoryV1({ candidateCount: 1 });
    await expect(
      executeSamProductCorpusProviderFreeV1({
        outputDirectory: output,
        authorizationSources: source.sources,
        transportFactory: factory,
      }),
    ).rejects.toThrow(/650511040 > 268435456/u);
    expect(source.counts()).toEqual({ clockCalls: 0, identifierCalls: 0 });
    expect(inspectSamCorpusTransportFactoryCountersV1(factory)).toEqual({
      constructionCount: 0,
      dispatchCount: 0,
      networkCalls: 0,
    });
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(prepareSamProductCorpusRequestV1()).rejects.toThrow(/capacity refused/u);
  });

  it('executes text-heavy once, materializes once, and fails closed on duplicate execution', async () => {
    const root = await temporaryRoot();
    const output = join(root, 'text-heavy-fake-output');
    const source = sourceCounter('55555555-5555-4555-8555-555555555555');
    const factory = createSamCorpusProviderFreeTransportFactoryV1({ candidateCount: 3 });
    const result = await executeSamTextHeavyCorpusProviderFreeV1({
      outputDirectory: output,
      authorizationSources: source.sources,
      transportFactory: factory,
    });
    expect(result).toMatchObject({
      fixtureKey: 'text-heavy',
      dispatchCount: 1,
      materializationCount: 1,
      retryCount: 0,
      pollCount: 0,
      healthRequestCount: 0,
      pingRequestCount: 0,
      queueRequestCount: 0,
      timeoutMs: 330_000,
      providerBillingGuarantee: false,
      billingEvidence: {
        kind: 'authorization-ceiling-only',
        costMaximumMicroUsd: 250_000,
        observedProviderCostMicroUsd: null,
        providerBillingGuarantee: false,
      },
    });
    expect(result.runtimeMs).toBeGreaterThanOrEqual(0);
    expect(result.artifacts.inventory).toHaveLength(12);
    expect(inspectSamCorpusTransportFactoryCountersV1(factory)).toEqual({
      constructionCount: 1,
      dispatchCount: 1,
      networkCalls: 0,
    });

    const duplicateOutput = join(root, 'text-heavy-duplicate-fake-output');
    const duplicateSource = sourceCounter('66666666-6666-4666-8666-666666666666');
    const duplicateFactory = createSamCorpusProviderFreeTransportFactoryV1({ candidateCount: 1 });
    await expect(
      executeSamTextHeavyCorpusProviderFreeV1({
        outputDirectory: duplicateOutput,
        authorizationSources: duplicateSource.sources,
        transportFactory: duplicateFactory,
      }),
    ).rejects.toMatchObject({ reason: 'DUPLICATE_DISPATCH', retryable: false });
    expect(inspectSamCorpusTransportFactoryCountersV1(duplicateFactory)).toEqual({
      constructionCount: 1,
      dispatchCount: 0,
      networkCalls: 0,
    });
    await expect(readFile(duplicateOutput)).rejects.toMatchObject({ code: 'ENOENT' });
  }, 30_000);

  it('classifies a no-text post-dispatch failure as terminal indeterminate with no artifacts', async () => {
    const root = await temporaryRoot();
    const output = join(root, 'no-text-indeterminate-fake-output');
    const source = sourceCounter('77777777-7777-4777-8777-777777777777');
    const factory = createSamCorpusProviderFreeTransportFactoryV1({
      candidateCount: 1,
      throwAfterDispatch: true,
    });
    let failure: unknown;
    try {
      await executeSamNoTextCorpusProviderFreeV1({
        outputDirectory: output,
        authorizationSources: source.sources,
        transportFactory: factory,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(SamRunPodDirectV3Error);
    expect(failure).toMatchObject({ reason: 'INDETERMINATE', retryable: false });
    expect(inspectSamCorpusTransportFactoryCountersV1(factory)).toEqual({
      constructionCount: 1,
      dispatchCount: 1,
      networkCalls: 0,
    });
    await expect(readFile(output)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('keeps every production, web, general, provider, and batch authority disabled', () => {
    expect(SAM_CORPUS_EVALUATION_ACTIVATION_V1).toEqual({
      productionExecutionAuthority: false,
      productionAdmissionAuthority: false,
      webRouteAuthority: false,
      generalAdmissionAuthority: false,
      corpusBatchAuthority: false,
      providerCallAuthority: false,
      dispatchMaximum: 1,
      materializationMaximum: 1,
      retryCount: 0,
      pollCount: 0,
      healthRequestCount: 0,
      pingRequestCount: 0,
      queueRequestCount: 0,
      providerBillingGuarantee: false,
    });
    const implementationFiles = [
      '../src/server/sam-corpus-evaluation-catalog-v1.ts',
      '../src/server/sam-corpus-evaluation-authorization-v1.ts',
      '../src/server/sam-corpus-visual-evaluation-v2.ts',
      '../src/server/sam-corpus-evaluation-control-v1.ts',
    ];
    for (const relativePath of implementationFiles) {
      const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
      expect(source).not.toMatch(/process\.env|Deno\.env|Bun\.env/u);
      expect(source).not.toMatch(/RUNPOD_CONTROL_PLANE_API_KEY/u);
      expect(source).not.toMatch(/\bfetch\s*\(/u);
    }
  });
});
