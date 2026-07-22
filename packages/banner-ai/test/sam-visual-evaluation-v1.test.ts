import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { SAM_MASK_CONTRACT_VERSION, type SamMaskResponse } from '../src/sam/sam-mask-contracts.js';
import { canonicalResponseSha256, createCandidateFromMask } from '../src/sam/sam-mask-rle.js';
import { parseAndVerifySamMaskResponse } from '../src/sam/sam-mask-validation.js';
import { parsePngChunks } from '../src/security/raster-container.js';
import { SAM_FIRST_INFERENCE_EXACT_AUTHORIZATION_PHRASE } from '../src/server/sam-first-inference-control-v3.js';
import { createTestOnlySamRunPodDirectV3AuthorizationSources } from '../src/server/sam-runpod-direct-v3-authorization.js';
import type { SamRunPodDirectV3TransportPort } from '../src/server/sam-runpod-direct-v3-adapter.js';
import { SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY } from '../src/server/sam-runpod-direct-v3-deterministic-fake-transport.js';
import { RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS } from '../src/server/sam-runpod-direct-v3-profiles.js';
import {
  SAM_FIRST_INFERENCE_EXECUTION_IDENTITY,
  SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
  prepareSamFirstInferenceV3Request,
  prepareSamRunPodDirectV3Request,
  type SamRunPodDirectV3PreparedRequest,
} from '../src/server/sam-runpod-direct-v3-request-preparation.js';
import {
  SAM_VISUAL_EVALUATION_ACTIVATION,
  SAM_VISUAL_EVALUATION_CUMULATIVE_AUTHORIZED_CEILING_MICRO_USD,
  SAM_VISUAL_EVALUATION_EXACT_AUTHORIZATION_PHRASE,
  SAM_VISUAL_EVALUATION_INCREMENTAL_COST_MAXIMUM_MICRO_USD,
  createSamVisualEvaluationDeterministicFakeTransportV1,
  executeSamVisualEvaluationV1,
} from '../src/server/sam-visual-evaluation-control-v1.js';
import {
  SAM_VISUAL_EVALUATION_FAKE_LABEL,
  SAM_VISUAL_EVALUATION_REAL_LABEL,
  SamVisualEvaluationManifestV1Schema,
  assertSamVisualEvaluationOutputDirectoryV1,
  createTestOnlySamVisualEvaluationWriteFaultV1,
  escapeSamVisualEvaluationHtml,
  materializeSamVisualEvaluationV1,
  validateSamVisualEvaluationResponseV1,
  verifySamVisualEvaluationArtifactSetV1,
  type SamVisualEvaluationManifestV1,
} from '../src/server/sam-visual-evaluation-v1.js';

const packageRoot = resolve(import.meta.dirname, '..');
const repositoryRoot = resolve(packageRoot, '../..');
const cliPath = join(packageRoot, 'src/server/sam-visual-evaluation-fake-cli.ts');
const requestSha256 = '506e75d829f2494f34a58e9e9f4d610b9b0881a520ed815e7b38f62561815f80';

interface FakeCliSummary {
  readonly label: string;
  readonly candidateCount: number;
  readonly canonicalRequestSha256: string;
  readonly sanitizedResponseSha256: string;
  readonly manifestSha256: string;
  readonly dispatchCount: number;
  readonly materializationCount: number;
  readonly nativeTransportCalls: number;
  readonly networkCalls: number;
  readonly realAuthorizationMinted: boolean;
  readonly retryCount: number;
  readonly pollCount: number;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const gitStatus = (): string =>
  execFileSync('git', ['status', '--short'], {
    cwd: repositoryRoot,
    encoding: 'utf8',
  });
const runFakeCli = (outputDirectory: string): FakeCliSummary =>
  JSON.parse(
    execFileSync(process.execPath, ['--import', 'tsx', cliPath, outputDirectory], {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: 4_000_000,
    }),
  ) as FakeCliSummary;
const readInventory = async (directory: string): Promise<Map<string, Buffer>> => {
  const result = new Map<string, Buffer>();
  for (const filename of (await readdir(directory)).toSorted()) {
    result.set(filename, await readFile(join(directory, filename)));
  }
  return result;
};

let temporaryRoot = '';
let firstOutput = '';
let secondOutput = '';
let firstSummary: FakeCliSummary;
let secondSummary: FakeCliSummary;
let firstManifest: SamVisualEvaluationManifestV1;
let secondManifest: SamVisualEvaluationManifestV1;
let prepared: SamRunPodDirectV3PreparedRequest;
let rawFakeResponse: SamMaskResponse;
let statusBefore = '';
let statusAfter = '';

const buildRawFakeResponse = async (): Promise<SamMaskResponse> => {
  const candidates = await Promise.all(
    firstManifest.candidates.map(async (manifestCandidate) => {
      const decoded = await sharp(join(firstOutput, manifestCandidate.artifacts.mask.filename))
        .greyscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return createCandidateFromMask({
        mask: Uint8Array.from(decoded.data, (pixel) => (pixel === 255 ? 1 : 0)),
        width: decoded.info.width,
        height: decoded.info.height,
        sourceSha256: prepared.request.source.sha256,
        predictedIou: manifestCandidate.score.predictedIouBps / 10_000,
        stabilityScore: manifestCandidate.score.stabilityScoreBps / 10_000,
        reviewFlags: manifestCandidate.reviewFlags,
      });
    }),
  );
  const unsigned: Omit<SamMaskResponse, 'responseSha256'> = {
    contractVersion: SAM_MASK_CONTRACT_VERSION,
    requestId: prepared.request.requestId,
    workspaceId: prepared.request.workspaceId,
    jobId: prepared.request.jobId,
    attemptId: prepared.request.attemptId,
    sourceSha256: prepared.request.source.sha256,
    executionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
    timing: { inferenceMs: 0, totalMs: 0 },
    filterSummary: {
      rawCandidateCount: 8,
      exactDuplicateFiltered: 0,
      tinyFiltered: 0,
      fullCanvasFiltered: 0,
      rleTooLargeFiltered: 0,
      rleBudgetFiltered: 0,
      candidateLimitFiltered: 0,
      returnedCandidateCount: 8,
    },
    candidateCount: 8,
    candidates,
  };
  return { ...unsigned, responseSha256: canonicalResponseSha256(unsigned) };
};

const cloneRawFakeResponse = (): SamMaskResponse =>
  JSON.parse(JSON.stringify(rawFakeResponse)) as SamMaskResponse;
const resign = (response: SamMaskResponse): SamMaskResponse => {
  const unsigned = Object.fromEntries(
    Object.entries(response).filter(([key]) => key !== 'responseSha256'),
  ) as Omit<SamMaskResponse, 'responseSha256'>;
  return { ...unsigned, responseSha256: canonicalResponseSha256(unsigned) };
};
const freshlyStrictValidatedFakeResponse = (): SamMaskResponse =>
  parseAndVerifySamMaskResponse({
    response: cloneRawFakeResponse(),
    request: prepared.request,
    expectedExecutionKind: 'deterministic-fake',
  });
const testAuthorizationSources = (authorizationId: string) =>
  createTestOnlySamRunPodDirectV3AuthorizationSources({
    nowMs: () => RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS + 10_000,
    authorizationId: () => authorizationId,
  });

beforeAll(async () => {
  temporaryRoot = await mkdtemp(
    join(realpathSync(tmpdir()), 'fabrica-sam-visual-evaluation-test-'),
  );
  firstOutput = join(temporaryRoot, 'fake-run-one');
  secondOutput = join(temporaryRoot, 'fake-run-two');
  statusBefore = gitStatus();
  firstSummary = runFakeCli(firstOutput);
  secondSummary = runFakeCli(secondOutput);
  firstManifest = SamVisualEvaluationManifestV1Schema.parse(
    JSON.parse(await readFile(join(firstOutput, 'manifest.json'), 'utf8')),
  );
  secondManifest = SamVisualEvaluationManifestV1Schema.parse(
    JSON.parse(await readFile(join(secondOutput, 'manifest.json'), 'utf8')),
  );
  prepared = await prepareSamFirstInferenceV3Request();
  rawFakeResponse = await buildRawFakeResponse();
  statusAfter = gitStatus();
}, 120_000);

afterAll(async () => {
  if (temporaryRoot !== '') await rm(temporaryRoot, { recursive: true });
});

describe('SAM visual evaluation V1 provider-free artifact path', () => {
  it('runs two isolated eight-candidate fake flows with byte-identical local artifacts', async () => {
    expect(statusAfter).toBe(statusBefore);
    expect(firstSummary).toEqual(secondSummary);
    expect(firstSummary).toMatchObject({
      label: SAM_VISUAL_EVALUATION_FAKE_LABEL,
      candidateCount: 8,
      canonicalRequestSha256: requestSha256,
      dispatchCount: 1,
      materializationCount: 1,
      nativeTransportCalls: 0,
      networkCalls: 0,
      realAuthorizationMinted: false,
      retryCount: 0,
      pollCount: 0,
    });
    expect(firstManifest).toEqual(secondManifest);
    expect(firstManifest).toMatchObject({
      schema: 'fabrica-sam-visual-evaluation-manifest',
      version: 1,
      outputClassification: 'fake-test-output',
      label: SAM_VISUAL_EVALUATION_FAKE_LABEL,
      candidateCount: 8,
      canonicalRequest: { byteLength: 322_024, sha256: requestSha256 },
      fixture: {
        fixtureId: 'banner-person-v1',
        byteLength: 241_013,
        dimensions: { width: 876, height: 221 },
        sha256: '6e3175cdd260fde33a3885945eb6f8831da3905afbc723f684035f411dc6d699',
      },
      identities: {
        endpointId: 'sawwuq4u7oiftj',
        endpointVersion: 12,
        contractVersion: 'sam-mask-v2',
        maskEncoding: 'fabrica-binary-rle-v1',
        targetExecution: {
          modelId: 'sam2.1_hiera_base_plus',
          repositoryCommit: '05d9e57fb3945b10c861046c1e6749e2bfc258e3',
          workerImageDigest:
            'sha256:5f6058eb5f626ada2ce9ad3e9f105cd12b601f614df83265ab8479c8403ae7a8',
        },
        actualExecution: {
          kind: 'deterministic-fake',
          notice: 'NOT_SAM_OUTPUT',
        },
      },
    });
    expect(firstManifest.candidates.map((candidate) => candidate.order)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    const expectedInventory = [
      'source.png',
      ...Array.from({ length: 8 }, (_, index) => {
        const number = String(index + 1).padStart(2, '0');
        return [
          `candidate-${number}-mask.png`,
          `candidate-${number}-cutout.png`,
          `candidate-${number}-overlay.png`,
        ];
      }).flat(),
      'index.html',
      'manifest.json',
    ].toSorted();
    const firstFiles = await readInventory(firstOutput);
    const secondFiles = await readInventory(secondOutput);
    expect([...firstFiles.keys()]).toEqual(expectedInventory);
    expect([...secondFiles.keys()]).toEqual(expectedInventory);
    for (const [filename, firstBytes] of firstFiles) {
      expect(secondFiles.get(filename), filename).toEqual(firstBytes);
    }
    const firstVerification = await verifySamVisualEvaluationArtifactSetV1(firstOutput);
    const secondVerification = await verifySamVisualEvaluationArtifactSetV1(secondOutput);
    expect(firstVerification).toEqual(secondVerification);
    expect(firstVerification.inventory).toEqual(expectedInventory);
    expect(firstVerification.manifestSha256).toBe(firstSummary.manifestSha256);
    expect(sha256(firstFiles.get('manifest.json')!)).toBe(firstSummary.manifestSha256);
    expect(firstManifest.sanitizedResponseSha256).toBe(firstSummary.sanitizedResponseSha256);
    expect(rawFakeResponse.responseSha256).toBe(firstManifest.validatedResponseSha256);
  }, 120_000);

  it('always shows the exact normalized source in a correctly labeled zero-candidate report', async () => {
    const unsigned: Omit<SamMaskResponse, 'responseSha256'> = {
      contractVersion: SAM_MASK_CONTRACT_VERSION,
      requestId: prepared.request.requestId,
      workspaceId: prepared.request.workspaceId,
      jobId: prepared.request.jobId,
      attemptId: prepared.request.attemptId,
      sourceSha256: prepared.request.source.sha256,
      executionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
      timing: { inferenceMs: 0, totalMs: 0 },
      filterSummary: {
        rawCandidateCount: 0,
        exactDuplicateFiltered: 0,
        tinyFiltered: 0,
        fullCanvasFiltered: 0,
        rleTooLargeFiltered: 0,
        rleBudgetFiltered: 0,
        candidateLimitFiltered: 0,
        returnedCandidateCount: 0,
      },
      candidateCount: 0,
      candidates: [],
    };
    const response = parseAndVerifySamMaskResponse({
      response: { ...unsigned, responseSha256: canonicalResponseSha256(unsigned) },
      request: prepared.request,
      expectedExecutionKind: 'deterministic-fake',
    });
    const outputDirectory = join(temporaryRoot, 'fake-zero-candidate-output');
    const result = await materializeSamVisualEvaluationV1({
      validated: validateSamVisualEvaluationResponseV1({
        prepared,
        response,
        outputClassification: 'fake-test-output',
      }),
      outputDirectory,
    });
    expect(result.manifest).toMatchObject({
      outputClassification: 'fake-test-output',
      label: SAM_VISUAL_EVALUATION_FAKE_LABEL,
      candidateCount: 0,
      candidates: [],
      source: { filename: 'source.png' },
    });
    expect((await readdir(outputDirectory)).toSorted()).toEqual([
      'index.html',
      'manifest.json',
      'source.png',
    ]);
    expect(await readFile(join(outputDirectory, 'source.png'))).toEqual(
      await readFile(join(firstOutput, 'source.png')),
    );
    const report = await readFile(join(outputDirectory, 'index.html'), 'utf8');
    expect(report).toContain(`<h1>${SAM_VISUAL_EVALUATION_FAKE_LABEL}</h1>`);
    expect(report).toContain('<h2>Normalized source</h2>');
    expect(report.match(/\bsrc="source\.png"/gu)).toHaveLength(1);
    expect(report).not.toContain(SAM_VISUAL_EVALUATION_REAL_LABEL);
    expect(await verifySamVisualEvaluationArtifactSetV1(outputDirectory)).toEqual({
      manifest: result.manifest,
      manifestSha256: result.manifestSha256,
      inventory: ['index.html', 'manifest.json', 'source.png'],
    });
  }, 120_000);

  it('requires the opaque complete-validation brand and a genuine fixed preparation', () => {
    expect(() =>
      validateSamVisualEvaluationResponseV1({
        prepared,
        response: cloneRawFakeResponse(),
        outputClassification: 'fake-test-output',
      }),
    ).toThrow(/raw|not strictly validated/u);
    expect(() =>
      parseAndVerifySamMaskResponse({
        response: { ...cloneRawFakeResponse(), unknown: true },
        request: prepared.request,
        expectedExecutionKind: 'deterministic-fake',
      }),
    ).toThrow();

    const strictResponse = freshlyStrictValidatedFakeResponse();
    expect(
      validateSamVisualEvaluationResponseV1({
        prepared,
        response: strictResponse,
        outputClassification: 'fake-test-output',
      }),
    ).toMatchObject({
      purpose: 'strictly-validated-sam-visual-evaluation-v1',
      candidateCount: 8,
    });

    const reconstructed = prepareSamRunPodDirectV3Request({
      endpointId: prepared.endpointId,
      requestInput: prepared.request,
      workerImageDigest: SAM_FIRST_INFERENCE_WORKER_IMAGE_DIGEST,
    });
    const reconstructedResponse = parseAndVerifySamMaskResponse({
      response: cloneRawFakeResponse(),
      request: reconstructed.request,
      expectedExecutionKind: 'deterministic-fake',
    });
    expect(() =>
      validateSamVisualEvaluationResponseV1({
        prepared: reconstructed,
        response: reconstructedResponse,
        outputClassification: 'fake-test-output',
      }),
    ).toThrow(/preparation identity/u);
  });

  it('rejects request, fixture, response, geometry, ordering, model, worker and profile drift', () => {
    const requestMismatch = resign({
      ...cloneRawFakeResponse(),
      requestId: '00000000-0000-0000-0000-000000000001',
    });
    const fixtureMismatch = resign({
      ...cloneRawFakeResponse(),
      sourceSha256: '0'.repeat(64),
    });
    const responseDigestMismatch = {
      ...cloneRawFakeResponse(),
      responseSha256: '0'.repeat(64),
    };
    const dimensionsRaw = cloneRawFakeResponse();
    const dimensionsCandidate = dimensionsRaw.candidates[0]!;
    const wrongDimensions = resign({
      ...dimensionsRaw,
      candidates: [
        {
          ...dimensionsCandidate,
          mask: { ...dimensionsCandidate.mask, width: 875 },
        },
        ...dimensionsRaw.candidates.slice(1),
      ],
    });
    const areaRaw = cloneRawFakeResponse();
    const areaCandidate = areaRaw.candidates[0]!;
    const wrongArea = resign({
      ...areaRaw,
      candidates: [
        { ...areaCandidate, pixelArea: areaCandidate.pixelArea + 1 },
        ...areaRaw.candidates.slice(1),
      ],
    });
    const boundsRaw = cloneRawFakeResponse();
    const boundsCandidate = boundsRaw.candidates[0]!;
    const wrongBounds = resign({
      ...boundsRaw,
      candidates: [
        {
          ...boundsCandidate,
          bounds: { ...boundsCandidate.bounds, xBps: boundsCandidate.bounds.xBps + 1 },
        },
        ...boundsRaw.candidates.slice(1),
      ],
    });
    const orderRaw = cloneRawFakeResponse();
    const wrongOrder = resign({
      ...orderRaw,
      candidates: [...orderRaw.candidates].toReversed(),
    });
    const wrongCount = resign({ ...cloneRawFakeResponse(), candidateCount: 7 });
    const candidateLimitRaw = cloneRawFakeResponse();
    const ninthMask = new Uint8Array(
      prepared.request.source.width * prepared.request.source.height,
    );
    for (let y = 5; y < 15; y += 1) {
      ninthMask.fill(
        1,
        y * prepared.request.source.width + 840,
        y * prepared.request.source.width + 860,
      );
    }
    const ninthCandidate = createCandidateFromMask({
      mask: ninthMask,
      width: prepared.request.source.width,
      height: prepared.request.source.height,
      sourceSha256: prepared.request.source.sha256,
      predictedIou: 0.1,
      stabilityScore: 0.1,
    });
    const overCandidateLimit = resign({
      ...candidateLimitRaw,
      filterSummary: {
        ...candidateLimitRaw.filterSummary,
        rawCandidateCount: 9,
        returnedCandidateCount: 9,
      },
      candidateCount: 9,
      candidates: [...candidateLimitRaw.candidates, ninthCandidate],
    });
    for (const invalid of [
      requestMismatch,
      fixtureMismatch,
      responseDigestMismatch,
      wrongDimensions,
      wrongArea,
      wrongBounds,
      wrongOrder,
      wrongCount,
      overCandidateLimit,
    ]) {
      expect(() =>
        parseAndVerifySamMaskResponse({
          response: invalid,
          request: prepared.request,
          expectedExecutionKind: 'deterministic-fake',
        }),
      ).toThrow();
    }

    const liveWorkerMismatch = resign({
      ...cloneRawFakeResponse(),
      executionIdentity: {
        ...SAM_FIRST_INFERENCE_EXECUTION_IDENTITY,
        workerImageDigest: `sha256:${'3'.repeat(64)}`,
      },
    });
    const strictLiveWorkerMismatch = parseAndVerifySamMaskResponse({
      response: liveWorkerMismatch,
      request: prepared.request,
      expectedExecutionKind: 'meta-sam2.1',
    });
    expect(() =>
      validateSamVisualEvaluationResponseV1({
        prepared,
        response: strictLiveWorkerMismatch,
        outputClassification: 'real-sam-output',
      }),
    ).toThrow(/model or worker identity/u);
    expect(() =>
      parseAndVerifySamMaskResponse({
        response: resign({
          ...cloneRawFakeResponse(),
          executionIdentity: {
            ...SAM_FIRST_INFERENCE_EXECUTION_IDENTITY,
            modelId: 'foreign-model',
          } as never,
        }),
        request: prepared.request,
        expectedExecutionKind: 'meta-sam2.1',
      }),
    ).toThrow();
    expect(() =>
      SamVisualEvaluationManifestV1Schema.parse({
        ...firstManifest,
        identities: {
          ...firstManifest.identities,
          profiles: {
            ...firstManifest.identities.profiles,
            adapterV3Sha256: '0'.repeat(64),
          },
        },
      }),
    ).toThrow();
  });

  it('rejects malformed zero-run and overflowing RLE before visual materialization', () => {
    const zeroRaw = cloneRawFakeResponse();
    const zeroCandidate = zeroRaw.candidates[0]!;
    const zeroRunBytes = Buffer.from(zeroCandidate.mask.dataBase64, 'base64');
    zeroRunBytes[18] = 0;
    const zeroRun = resign({
      ...zeroRaw,
      candidates: [
        {
          ...zeroCandidate,
          mask: { ...zeroCandidate.mask, dataBase64: zeroRunBytes.toString('base64') },
        },
        ...zeroRaw.candidates.slice(1),
      ],
    });

    const overflowRaw = cloneRawFakeResponse();
    const overflowCandidate = overflowRaw.candidates[0]!;
    const header = Buffer.from(
      Buffer.from(overflowCandidate.mask.dataBase64, 'base64').subarray(0, 18),
    );
    header.writeUInt32BE(1, 14);
    const overflowBytes = Buffer.concat([header, Buffer.from([0xff, 0xff, 0xff, 0xff, 0x7f])]);
    const overflowing = resign({
      ...overflowRaw,
      candidates: [
        {
          ...overflowCandidate,
          mask: {
            ...overflowCandidate.mask,
            byteSize: overflowBytes.byteLength,
            dataBase64: overflowBytes.toString('base64'),
          },
        },
        ...overflowRaw.candidates.slice(1),
      ],
    });
    for (const invalid of [zeroRun, overflowing]) {
      expect(() =>
        parseAndVerifySamMaskResponse({
          response: invalid,
          request: prepared.request,
          expectedExecutionKind: 'deterministic-fake',
        }),
      ).toThrow(/RLE|run|mask/u);
    }
  });

  it('never redispatches after an output failure and blocks a duplicate before transport', async () => {
    const failedOutput = join(temporaryRoot, 'fake-output-failure');
    await mkdir(failedOutput);
    const innerTransport = createSamVisualEvaluationDeterministicFakeTransportV1();
    const outputFailureTransport: SamRunPodDirectV3TransportPort = {
      transportKind: 'deterministic-fake-direct-v3',
      secretReferenceName: null,
      async dispatch(request) {
        const response = await innerTransport.dispatch(request);
        await writeFile(join(failedOutput, 'pre-existing-after-response.txt'), 'occupied\n');
        return response;
      },
    };
    await expect(
      executeSamVisualEvaluationV1({
        mode: 'provider-free-deterministic-fake',
        outputDirectory: failedOutput,
        transport: outputFailureTransport,
        testOnlyAuthorizationSources: testAuthorizationSources(
          '5f02c07f-b5ae-4c22-ad8a-ccfae7d7610c',
        ),
      }),
    ).rejects.toThrow(/empty|overwritten/u);
    expect(innerTransport.getCallCount()).toBe(1);
    expect(innerTransport.networkCalls).toBe(0);
    expect((await readdir(failedOutput)).toSorted()).toEqual(['pre-existing-after-response.txt']);
    expect(existsSync(join(failedOutput, 'manifest.json'))).toBe(false);

    const duplicateTransport = createSamVisualEvaluationDeterministicFakeTransportV1();
    const duplicateOutput = join(temporaryRoot, 'fake-duplicate-dispatch');
    await expect(
      executeSamVisualEvaluationV1({
        mode: 'provider-free-deterministic-fake',
        outputDirectory: duplicateOutput,
        transport: duplicateTransport,
        testOnlyAuthorizationSources: testAuthorizationSources(
          '0d2c3978-134d-437b-bdf7-193cc92170d5',
        ),
      }),
    ).rejects.toMatchObject({ reason: 'DUPLICATE_DISPATCH', retryable: false });
    expect(duplicateTransport.getCallCount()).toBe(0);
    expect(duplicateTransport.networkCalls).toBe(0);
    expect(existsSync(duplicateOutput)).toBe(false);
  }, 120_000);

  it('keeps native transport and fresh real authorization inaccessible without the new phrase', async () => {
    let nativeCalls = 0;
    const nativeTransport: SamRunPodDirectV3TransportPort = {
      transportKind: 'native-fetch-direct-v3',
      secretReferenceName: 'RUNPOD_API_KEY',
      async dispatch() {
        nativeCalls += 1;
        throw new TypeError('Native visual transport must remain unreachable.');
      },
    };
    await expect(
      executeSamVisualEvaluationV1({
        mode: 'explicitly-authorized-native',
        authorizationPhrase: SAM_FIRST_INFERENCE_EXACT_AUTHORIZATION_PHRASE,
        outputDirectory: join(temporaryRoot, 'real-sam-output-not-authorized'),
        transport: nativeTransport,
      }),
    ).rejects.toThrow(/not explicitly authorized/u);
    expect(nativeCalls).toBe(0);
    expect(SAM_FIRST_INFERENCE_EXACT_AUTHORIZATION_PHRASE).toBe('RUN THE ONE SAM CALL');
    expect(SAM_VISUAL_EVALUATION_EXACT_AUTHORIZATION_PHRASE).toBe('RUN THE ONE SAM VISUAL CALL');
    expect(SAM_VISUAL_EVALUATION_INCREMENTAL_COST_MAXIMUM_MICRO_USD).toBe(250_000);
    expect(SAM_VISUAL_EVALUATION_CUMULATIVE_AUTHORIZED_CEILING_MICRO_USD).toBe(500_000);
    expect(SAM_VISUAL_EVALUATION_ACTIVATION).toMatchObject({
      productionActivated: false,
      secondPaidCall: true,
      dispatchMaximum: 1,
      retryCount: 0,
      pollCount: 0,
      healthRequestCount: 0,
      queueRequestCount: 0,
    });
  });

  it('rejects unsafe output paths, symlinks, non-empty targets and overwrite attempts', async () => {
    await expect(
      assertSamVisualEvaluationOutputDirectoryV1({
        outputDirectory: 'fake-relative-output',
        outputClassification: 'fake-test-output',
      }),
    ).rejects.toThrow(/absolute|unambiguous/u);
    await expect(
      assertSamVisualEvaluationOutputDirectoryV1({
        outputDirectory: `${temporaryRoot}/fake-a/../fake-traversal`,
        outputClassification: 'fake-test-output',
      }),
    ).rejects.toThrow(/unambiguous|traversal/u);
    await expect(
      assertSamVisualEvaluationOutputDirectoryV1({
        outputDirectory: join(temporaryRoot, 'unlabeled-output'),
        outputClassification: 'fake-test-output',
      }),
    ).rejects.toThrow(/labeled as fake/u);

    const symlinkTarget = join(temporaryRoot, 'fake-real-symlink-target');
    const symlinkOutput = join(temporaryRoot, 'fake-symlink-output');
    await mkdir(symlinkTarget);
    await symlink(symlinkTarget, symlinkOutput, 'dir');
    await expect(
      assertSamVisualEvaluationOutputDirectoryV1({
        outputDirectory: symlinkOutput,
        outputClassification: 'fake-test-output',
      }),
    ).rejects.toThrow(/real empty|symbolic/u);

    await expect(
      assertSamVisualEvaluationOutputDirectoryV1({
        outputDirectory: firstOutput,
        outputClassification: 'fake-test-output',
      }),
    ).rejects.toThrow(/empty|overwritten/u);
    const stagingCollisionOutput = join(temporaryRoot, 'fake-staging-collision');
    await mkdir(`${stagingCollisionOutput}.fabrica-sam-visual-staging`);
    await expect(
      assertSamVisualEvaluationOutputDirectoryV1({
        outputDirectory: stagingCollisionOutput,
        outputClassification: 'fake-test-output',
      }),
    ).rejects.toThrow(/staging directory already exists/u);

    const beforeManifest = await readFile(join(firstOutput, 'manifest.json'));
    const overwriteCapability = validateSamVisualEvaluationResponseV1({
      prepared,
      response: freshlyStrictValidatedFakeResponse(),
      outputClassification: 'fake-test-output',
    });
    await expect(
      materializeSamVisualEvaluationV1({
        validated: overwriteCapability,
        outputDirectory: firstOutput,
      }),
    ).rejects.toThrow(/empty|overwritten/u);
    expect(await readFile(join(firstOutput, 'manifest.json'))).toEqual(beforeManifest);
  });

  it('removes only attempt-created files after a partial publish and leaves no manifest', async () => {
    const outputDirectory = join(temporaryRoot, 'fake-partial-publish');
    await mkdir(outputDirectory);
    const capability = validateSamVisualEvaluationResponseV1({
      prepared,
      response: freshlyStrictValidatedFakeResponse(),
      outputClassification: 'fake-test-output',
    });
    await expect(
      materializeSamVisualEvaluationV1({
        validated: capability,
        outputDirectory,
        testOnlyWriteFault: createTestOnlySamVisualEvaluationWriteFaultV1({
          phase: 'existing-output-publish',
          afterCount: 2,
        }),
      }),
    ).rejects.toThrow(/Injected deterministic/u);
    expect(await readdir(outputDirectory)).toEqual([]);
    expect(existsSync(join(outputDirectory, 'manifest.json'))).toBe(false);
    expect(existsSync(`${outputDirectory}.fabrica-sam-visual-staging`)).toBe(false);
    await expect(
      materializeSamVisualEvaluationV1({
        validated: capability,
        outputDirectory: join(temporaryRoot, 'fake-partial-retry-forbidden'),
      }),
    ).rejects.toThrow(/already consumed/u);
  }, 120_000);

  it('never deletes a manifest that appears concurrently before final exclusive creation', async () => {
    const outputDirectory = join(temporaryRoot, 'fake-concurrent-manifest');
    await mkdir(outputDirectory);
    const capability = validateSamVisualEvaluationResponseV1({
      prepared,
      response: freshlyStrictValidatedFakeResponse(),
      outputClassification: 'fake-test-output',
    });
    await expect(
      materializeSamVisualEvaluationV1({
        validated: capability,
        outputDirectory,
        testOnlyWriteFault: createTestOnlySamVisualEvaluationWriteFaultV1({
          phase: 'existing-output-manifest-collision',
          afterCount: 1,
        }),
      }),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect((await readdir(outputDirectory)).toSorted()).toEqual(['manifest.json']);
    expect(await readFile(join(outputDirectory, 'manifest.json'), 'utf8')).toBe(
      'simulated-concurrent-manifest\n',
    );
    expect(existsSync(`${outputDirectory}.fabrica-sam-visual-staging`)).toBe(false);
  }, 120_000);

  it('verifies exact mask pixels, cutout alpha semantics, PNG boundaries and artifact hashes', async () => {
    const source = await sharp(join(firstOutput, firstManifest.source.filename))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(source.info).toMatchObject({ width: 876, height: 221, channels: 4 });
    for (const candidate of firstManifest.candidates) {
      const maskBytes = await readFile(join(firstOutput, candidate.artifacts.mask.filename));
      const cutoutBytes = await readFile(join(firstOutput, candidate.artifacts.cutout.filename));
      const overlayBytes = await readFile(join(firstOutput, candidate.artifacts.overlay.filename));
      for (const [artifact, bytes] of [
        [candidate.artifacts.mask, maskBytes],
        [candidate.artifacts.cutout, cutoutBytes],
        [candidate.artifacts.overlay, overlayBytes],
      ] as const) {
        expect(bytes.byteLength).toBe(artifact.byteLength);
        expect(sha256(bytes)).toBe(artifact.sha256);
        expect(
          parsePngChunks(bytes).every((chunk) => ['IHDR', 'IDAT', 'IEND'].includes(chunk.type)),
        ).toBe(true);
      }
      const mask = await sharp(maskBytes).greyscale().raw().toBuffer({ resolveWithObject: true });
      expect(mask.info).toMatchObject({ width: 876, height: 221, channels: 1 });
      expect([...new Set(mask.data)]).toEqual([0, 255]);
      expect(mask.data.reduce((area, pixel) => area + (pixel === 255 ? 1 : 0), 0)).toBe(
        candidate.pixelArea,
      );
      const cutout = await sharp(cutoutBytes)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const cropWidth = candidate.boundsPixels.rightExclusive - candidate.boundsPixels.left;
      const cropHeight = candidate.boundsPixels.bottomExclusive - candidate.boundsPixels.top;
      expect(cutout.info).toMatchObject({ width: cropWidth, height: cropHeight, channels: 4 });
      let exactCutout = true;
      for (let y = 0; y < cropHeight && exactCutout; y += 1) {
        for (let x = 0; x < cropWidth && exactCutout; x += 1) {
          const sourcePixel =
            (candidate.boundsPixels.top + y) * source.info.width + candidate.boundsPixels.left + x;
          const sourceOffset = sourcePixel * 4;
          const cutoutOffset = (y * cropWidth + x) * 4;
          const selected = mask.data[sourcePixel] === 255 && source.data[sourceOffset + 3] !== 0;
          for (let channel = 0; channel < 4; channel += 1) {
            if (
              cutout.data[cutoutOffset + channel] !==
              (selected ? source.data[sourceOffset + channel] : 0)
            ) {
              exactCutout = false;
            }
          }
        }
      }
      expect(exactCutout).toBe(true);
      expect(overlayBytes).toEqual(
        await readFile(join(secondOutput, candidate.artifacts.overlay.filename)),
      );
    }
  }, 120_000);

  it('escapes rendered values, enforces fake/real labels and detects any artifact tamper', async () => {
    expect(escapeSamVisualEvaluationHtml(`<tag a="b">Tom & 'Ada'</tag>`)).toBe(
      '&lt;tag a=&quot;b&quot;&gt;Tom &amp; &#39;Ada&#39;&lt;/tag&gt;',
    );
    const report = await readFile(join(firstOutput, 'index.html'), 'utf8');
    expect(report).toContain(SAM_VISUAL_EVALUATION_FAKE_LABEL);
    expect(report).not.toContain(SAM_VISUAL_EVALUATION_REAL_LABEL);
    expect(report).not.toMatch(/<script\b|\b(?:https?:)?\/\/|\burl\s*\(/iu);
    const references = [...report.matchAll(/\bsrc="([^"]+)"/gu)].map((match) => match[1]);
    expect(references.length).toBe(33);
    expect(
      references.every((reference) => reference !== undefined && !reference.includes('/')),
    ).toBe(true);
    expect(() =>
      SamVisualEvaluationManifestV1Schema.parse({
        ...firstManifest,
        label: SAM_VISUAL_EVALUATION_REAL_LABEL,
      }),
    ).toThrow();
    expect(() =>
      SamVisualEvaluationManifestV1Schema.parse({ ...firstManifest, unknown: true }),
    ).toThrow();
    expect(() =>
      validateSamVisualEvaluationResponseV1({
        prepared,
        response: freshlyStrictValidatedFakeResponse(),
        outputClassification: 'real-sam-output',
      }),
    ).toThrow(/not strictly validated|request-mismatched/u);

    const tamperedOutput = join(temporaryRoot, 'fake-tampered-output');
    await cp(firstOutput, tamperedOutput, { recursive: true, errorOnExist: true });
    await writeFile(
      join(tamperedOutput, 'index.html'),
      Buffer.concat([await readFile(join(tamperedOutput, 'index.html')), Buffer.from('<!--x-->')]),
    );
    await expect(verifySamVisualEvaluationArtifactSetV1(tamperedOutput)).rejects.toThrow(
      /digest|report/u,
    );
  });

  it('persists no credentials, authorization packet, Base64/RLE payload or raw body', async () => {
    const inventory = await readInventory(firstOutput);
    const allBytes = [...inventory.values()];
    const text = `${await readFile(join(firstOutput, 'manifest.json'), 'utf8')}\n${await readFile(
      join(firstOutput, 'index.html'),
      'utf8',
    )}\n${JSON.stringify(firstSummary)}`;
    for (const forbidden of [
      'RUNPOD_API_KEY',
      'Authorization:',
      'Bearer ',
      'authorizationId',
      'secretReferenceName',
      'pngBase64',
      'dataBase64',
      SAM_VISUAL_EVALUATION_EXACT_AUTHORIZATION_PHRASE,
      prepared.request.requestId,
      prepared.request.workspaceId,
      prepared.request.jobId,
      prepared.request.attemptId,
      prepared.endpoint,
      firstOutput,
      repositoryRoot,
    ]) {
      expect(text).not.toContain(forbidden);
    }
    const forbiddenPayloads = [
      Buffer.from(prepared.canonicalBodyText, 'utf8'),
      Buffer.from(prepared.request.source.pngBase64, 'utf8'),
      Buffer.from(JSON.stringify(rawFakeResponse), 'utf8'),
      ...rawFakeResponse.candidates.map((candidate) =>
        Buffer.from(candidate.mask.dataBase64, 'utf8'),
      ),
    ];
    for (const fileBytes of allBytes) {
      for (const payload of forbiddenPayloads) {
        expect(fileBytes.includes(payload)).toBe(false);
      }
    }
  });
});
