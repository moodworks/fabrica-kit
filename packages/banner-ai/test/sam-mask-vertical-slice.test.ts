import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import * as publicBannerAi from '../src/index.js';
import {
  SAM_LIMITS,
  SAM_MASK_CONTRACT_VERSION,
  SAM_MASK_ENCODING,
  SamLiveExecutionIdentitySchema,
  SamMaskRequestSchema,
  type SamMaskRequest,
  type SamMaskResponse,
} from '../src/sam/sam-mask-contracts.js';
import { materializeSamMaskCutout } from '../src/sam/sam-cutout-materializer.js';
import { postprocessSamMasks } from '../src/sam/sam-mask-postprocess.js';
import {
  boxBasisToPixel,
  decodeBinaryMaskRle,
  canonicalResponseSha256,
  createCandidateFromMask,
  deriveSamCandidateId,
  encodeBinaryMaskRle,
  maskContentSha256,
  pointBasisToPixel,
} from '../src/sam/sam-mask-rle.js';
import { canonicalizeJson, sha256Hex } from '../src/scene/canonical-scene-json.js';
import {
  parseAndVerifySamMaskRequest,
  parseAndVerifySamMaskResponse,
} from '../src/sam/sam-mask-validation.js';
import { parsePngChunks } from '../src/security/raster-container.js';
import {
  consumeSamRunPodDispatchCapability,
  createSamRunPodAdapter,
  type SamLiveAuthorization,
  type SamRunPodTransportPort,
} from '../src/server/sam-runpod-adapter.js';
import {
  SAM_DETERMINISTIC_FAKE_IDENTITY,
  createDeterministicSamRunPodTransport,
} from '../src/server/sam-runpod-deterministic-fake-transport.js';

const packageRoot = resolve(import.meta.dirname, '..');
const fixture = readFileSync(
  join(packageRoot, 'test/fixtures/real-model-benchmark/normalized/banner-no-text-v1.png'),
);
const sourceSha256 = createHash('sha256').update(fixture).digest('hex');
let identityCounter = 1;

const uuidWithCounter = (counter: number): string =>
  `684173c2-7a85-4703-b99f-${counter.toString(16).padStart(12, '0')}`;

const createRequest = (
  source = fixture,
  width = 738,
  height = 255,
  overrides?: Partial<SamMaskRequest>,
): SamMaskRequest => {
  const counter = identityCounter;
  identityCounter += 1;
  const digest = createHash('sha256').update(source).digest('hex');
  return SamMaskRequestSchema.parse({
    contractVersion: SAM_MASK_CONTRACT_VERSION,
    requestId: uuidWithCounter(counter + 100),
    workspaceId: '32205d2c-f4a4-41bf-a08d-9927bb4b4b52',
    jobId: uuidWithCounter(counter + 200),
    attemptId: uuidWithCounter(counter),
    source: {
      mediaType: 'image/png',
      byteSize: source.byteLength,
      width,
      height,
      sha256: digest,
      pngBase64: source.toString('base64'),
    },
    segmentation: { mode: 'automatic-candidates', prompt: { kind: 'none' } },
    limits: { minMaskAreaPixels: 2, maxCandidates: 64 },
    output: { maskEncoding: SAM_MASK_ENCODING },
    ...overrides,
  });
};

const rectangle = (
  width: number,
  height: number,
  left: number,
  top: number,
  right: number,
  bottom: number,
): Uint8Array => {
  const mask = new Uint8Array(width * height);
  for (let y = top; y < bottom; y += 1) mask.fill(1, y * width + left, y * width + right);
  return mask;
};

describe('SAM mask protocol', () => {
  it('consumes the same machine vectors as the Python worker', () => {
    const vectors = JSON.parse(
      readFileSync(resolve(packageRoot, '../../services/sam-worker/protocol-vectors.json'), 'utf8'),
    ) as {
      readonly limits: {
        readonly rawMaskWorkingBytes: number;
      };
      readonly mask: {
        readonly width: number;
        readonly height: number;
        readonly rowMajorBits: string;
        readonly rleHex: string;
        readonly rleBase64: string;
        readonly maskSha256: string;
        readonly sourceSha256: string;
        readonly candidateId: string;
      };
      readonly canonicalJson: {
        readonly input: unknown;
        readonly encoded: string;
        readonly sha256: string;
      };
      readonly coordinates: {
        readonly dimension: number;
        readonly basisPoints: number;
        readonly pixel: number;
        readonly box: {
          readonly input: {
            readonly xBps: number;
            readonly yBps: number;
            readonly widthBps: number;
            readonly heightBps: number;
          };
          readonly sourceWidth: number;
          readonly sourceHeight: number;
          readonly output: unknown;
        };
      };
    };
    expect(SAM_LIMITS.rawMaskWorkingBytes).toBe(vectors.limits.rawMaskWorkingBytes);
    const mask = Uint8Array.from([...vectors.mask.rowMajorBits].map(Number));
    const encoded = encodeBinaryMaskRle(mask, vectors.mask.width, vectors.mask.height);
    expect(Buffer.from(encoded).toString('hex')).toBe(vectors.mask.rleHex);
    expect(Buffer.from(encoded).toString('base64')).toBe(vectors.mask.rleBase64);
    expect(decodeBinaryMaskRle(encoded).pixels).toEqual(mask);
    const digest = maskContentSha256(mask, vectors.mask.width, vectors.mask.height);
    expect(digest).toBe(vectors.mask.maskSha256);
    expect(
      deriveSamCandidateId({
        sourceSha256: vectors.mask.sourceSha256,
        width: vectors.mask.width,
        height: vectors.mask.height,
        maskSha256: digest,
      }),
    ).toBe(vectors.mask.candidateId);
    expect(pointBasisToPixel(vectors.coordinates.basisPoints, vectors.coordinates.dimension)).toBe(
      vectors.coordinates.pixel,
    );
    expect(
      boxBasisToPixel(
        vectors.coordinates.box.input,
        vectors.coordinates.box.sourceWidth,
        vectors.coordinates.box.sourceHeight,
      ),
    ).toEqual(vectors.coordinates.box.output);
    expect(canonicalizeJson(vectors.canonicalJson.input)).toBe(vectors.canonicalJson.encoded);
    expect(sha256Hex(Buffer.from(vectors.canonicalJson.encoded, 'utf8'))).toBe(
      vectors.canonicalJson.sha256,
    );
  });

  it('validates exact normalized PNG bytes, dimensions, media type and digest', () => {
    const request = createRequest();
    expect(Buffer.from(parseAndVerifySamMaskRequest(request).sourceBytes)).toEqual(fixture);
    expect(sourceSha256).toBe('40f8a1c4312ec86cb4e38e16b9a423e85c2a9e3cf5f98a4bc510c23f3d4cf073');
    for (const mutation of [
      { ...request, endpoint: 'https://example.invalid' },
      { ...request, source: { ...request.source, mediaType: 'image/jpeg' } },
      { ...request, source: { ...request.source, sha256: '0'.repeat(64) } },
      { ...request, source: { ...request.source, width: 737 } },
      { ...request, source: { ...request.source, pngBase64: `${request.source.pngBase64}\n` } },
      { ...request, requestId: request.requestId.toUpperCase() },
    ]) {
      expect(() => parseAndVerifySamMaskRequest(mutation)).toThrow();
    }
  });

  it('uses one outward basis-point convention and excludes Qwen prompt authority', () => {
    expect(pointBasisToPixel(0, 4)).toBe(0);
    expect(pointBasisToPixel(10_000, 4)).toBe(3);
    expect(
      boxBasisToPixel({ xBps: 2_500, yBps: 0, widthBps: 5_000, heightBps: 10_000 }, 4, 3),
    ).toEqual({ left: 1, top: 0, rightInclusive: 2, bottomInclusive: 2 });
    expect(() =>
      SamMaskRequestSchema.parse({
        ...createRequest(),
        segmentation: {
          mode: 'point-prompt',
          prompt: {
            kind: 'points',
            authority: 'qwen-proposal',
            points: [{ xBps: 10, yBps: 20, polarity: 'positive' }],
          },
        },
      }),
    ).toThrow();
    expect(() =>
      SamMaskRequestSchema.parse({
        ...createRequest(),
        segmentation: {
          mode: 'point-prompt',
          prompt: {
            kind: 'points',
            authority: 'user-interaction',
            points: [{ xBps: Number.NaN, yBps: 20, polarity: 'positive' }],
          },
        },
      }),
    ).toThrow();
  });

  it('losslessly decodes RLE and rejects zero, overlong, trailing and dimension drift', () => {
    const mask = Uint8Array.from([0, 1, 1, 0, 1, 1, 0, 0]);
    const encoded = encodeBinaryMaskRle(mask, 4, 2);
    expect(decodeBinaryMaskRle(encoded, 4, 2).pixels).toEqual(mask);
    expect(() => decodeBinaryMaskRle(Uint8Array.from([...encoded, 0]), 4, 2)).toThrow();
    const zero = Uint8Array.from(encoded);
    zero[18] = 0;
    expect(() => decodeBinaryMaskRle(zero, 4, 2)).toThrow();
    const overlong = Uint8Array.from([...encoded.slice(0, 18), 0x81, 0, ...encoded.slice(19)]);
    expect(() => decodeBinaryMaskRle(overlong, 4, 2)).toThrow();
    expect(() => decodeBinaryMaskRle(encoded, 5, 2)).toThrow();
  });

  it('filters exact duplicates, tiny and full masks while retaining flagged geometry', () => {
    const width = 100;
    const height = 100;
    const source = createRequest(fixture, 738, 255);
    const request = {
      ...source,
      source: { ...source.source, width, height },
      limits: { minMaskAreaPixels: 2, maxCandidates: 2 },
    } as SamMaskRequest;
    const large = rectangle(width, height, 0, 0, 90, 90);
    const contained = rectangle(width, height, 0, 0, 90, 89);
    const result = postprocessSamMasks(request, [
      { mask: large, predictedIou: 0.9, stabilityScore: 0.95 },
      { mask: large, predictedIou: 0.8, stabilityScore: 0.9 },
      { mask: contained, predictedIou: 0.85, stabilityScore: 0.96 },
      { mask: rectangle(width, height, 5, 5, 6, 6), predictedIou: 0.99, stabilityScore: 0.99 },
      { mask: new Uint8Array(width * height).fill(1), predictedIou: 0.99, stabilityScore: 0.99 },
      {
        mask: rectangle(width, height, 91, 91, 99, 99),
        predictedIou: 0.7,
        stabilityScore: 0.8,
      },
    ]);
    expect(result.filterSummary).toMatchObject({
      rawCandidateCount: 6,
      exactDuplicateFiltered: 1,
      tinyFiltered: 1,
      fullCanvasFiltered: 1,
      candidateLimitFiltered: 1,
      returnedCandidateCount: 2,
    });
    expect(result.candidates.map((candidate) => candidate.predictedIouBps)).toEqual([9000, 8500]);
    expect(result.candidates[0]?.reviewFlags).toEqual([
      'near-contained',
      'overlapping',
      'touches-source-edge',
    ]);
  });

  it('validates all response identities, mask digests, flags, accounting and ordering', async () => {
    const request = createRequest();
    const transport = createDeterministicSamRunPodTransport();
    const response = await createSamRunPodAdapter({
      endpointId: 'fake-sam-test-one',
      expectedExecutionIdentity: SAM_DETERMINISTIC_FAKE_IDENTITY,
      transport,
    }).generate(request, null);
    expect(
      parseAndVerifySamMaskResponse({
        response,
        request,
        expectedExecutionKind: 'deterministic-fake',
      }),
    ).toEqual(response);
    const resign = (changed: { responseSha256: string }): void => {
      const unsigned = Object.fromEntries(
        Object.entries(changed).filter(([key]) => key !== 'responseSha256'),
      ) as unknown as Omit<SamMaskResponse, 'responseSha256'>;
      changed.responseSha256 = canonicalResponseSha256(unsigned);
    };
    const assertResignedTamperRejected = (
      mutate: (changed: SamMaskResponse & { responseSha256: string }) => void,
      boundaryRequest = request,
    ): void => {
      const changed = JSON.parse(JSON.stringify(response)) as SamMaskResponse & {
        responseSha256: string;
      };
      mutate(changed);
      resign(changed);
      expect(() =>
        parseAndVerifySamMaskResponse({
          response: changed,
          request: boundaryRequest,
          expectedExecutionKind: 'deterministic-fake',
        }),
      ).toThrow();
    };
    assertResignedTamperRejected((changed) => {
      (changed.candidates[0]!.mask as { sha256: string }).sha256 = '0'.repeat(64);
    });
    assertResignedTamperRejected((changed) => {
      (changed.candidates as SamMaskResponse['candidates'][number][]).reverse();
    });
    assertResignedTamperRejected((changed) => {
      (changed.candidates as SamMaskResponse['candidates'][number][])[1] = changed.candidates[0]!;
    });
    assertResignedTamperRejected((changed) => {
      (changed.candidates[0] as unknown as { reviewFlags: string[] }).reviewFlags = ['overlapping'];
    });
    assertResignedTamperRejected((changed) => {
      (changed.filterSummary as { rawCandidateCount: number }).rawCandidateCount += 1;
    });
    assertResignedTamperRejected((changed) => {
      const tiny = new Uint8Array(request.source.width * request.source.height);
      tiny[tiny.length - 1] = 1;
      (changed.candidates as SamMaskResponse['candidates'][number][])[0] = createCandidateFromMask({
        mask: tiny,
        width: request.source.width,
        height: request.source.height,
        sourceSha256: request.source.sha256,
        predictedIou: changed.candidates[0]!.predictedIouBps / 10_000,
        stabilityScore: changed.candidates[0]!.stabilityScoreBps / 10_000,
        reviewFlags: [],
      });
    });
    assertResignedTamperRejected((changed) => {
      (changed.candidates as SamMaskResponse['candidates'][number][])[0] = createCandidateFromMask({
        mask: new Uint8Array(request.source.width * request.source.height).fill(1),
        width: request.source.width,
        height: request.source.height,
        sourceSha256: request.source.sha256,
        predictedIou: changed.candidates[0]!.predictedIouBps / 10_000,
        stabilityScore: changed.candidates[0]!.stabilityScoreBps / 10_000,
        reviewFlags: ['touches-source-edge'],
      });
    });
    assertResignedTamperRejected(
      () => {},
      SamMaskRequestSchema.parse({
        ...request,
        limits: { ...request.limits, maxCandidates: 1 },
      }),
    );
    expect(transport.networkCalls).toBe(0);
  });

  it('fails the entire request above 512 raw masks before materialization', () => {
    const request = createRequest();
    const mask = new Uint8Array(request.source.width * request.source.height);
    mask[0] = 1;
    expect(() =>
      postprocessSamMasks(
        request,
        Array.from({ length: 513 }, () => ({
          mask,
          predictedIou: 0.5,
          stabilityScore: 0.5,
        })),
      ),
    ).toThrow(/ENGINE_OUTPUT_LIMIT/u);

    const maximumRequest = {
      ...request,
      source: { ...request.source, width: 4_096, height: 4_096 },
    } as SamMaskRequest;
    expect(() =>
      postprocessSamMasks(
        maximumRequest,
        Array.from({ length: 17 }, () => ({
          mask: new Uint8Array(),
          predictedIou: 0.5,
          stabilityScore: 0.5,
        })),
      ),
    ).toThrow(/aggregate raw mask working bytes/u);
    expect(SAM_LIMITS.rawMaskWorkingBytes).toBe(268_435_456);
  });
});

describe('SAM cutout and server boundary', () => {
  it('materializes deterministic transparent cutouts with zero RGB under zero alpha', async () => {
    const raw = Buffer.from([255, 0, 0, 0, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
    const sharpPng = await sharp(raw, { raw: { width: 2, height: 2, channels: 4 } })
      .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
      .toBuffer();
    const source = Buffer.concat([
      sharpPng.subarray(0, 8),
      ...parsePngChunks(sharpPng)
        .filter((chunk) => ['IHDR', 'IDAT', 'IEND'].includes(chunk.type))
        .map((chunk) => sharpPng.subarray(chunk.start, chunk.end)),
    ]);
    const request = createRequest(source, 2, 2);
    const result = postprocessSamMasks(request, [
      { mask: Uint8Array.from([1, 1, 0, 0]), predictedIou: 0.9, stabilityScore: 0.9 },
    ]);
    const candidate = result.candidates[0]!;
    const before = Buffer.from(source);
    const first = await materializeSamMaskCutout({ trustedRequest: request, candidate });
    const second = await materializeSamMaskCutout({ trustedRequest: request, candidate });
    expect(first).toEqual(second);
    expect(source).toEqual(before);
    expect(first.metadata.crop).toEqual({ left: 0, top: 0, width: 2, height: 1 });
    expect(first.metadata.filenames).toEqual(second.metadata.filenames);
    expect(JSON.stringify(first.metadata)).not.toMatch(/(?:20\d\d-|\/Users\/|Local Sites)/u);
    const decoded = await sharp(first.cutoutPng).ensureAlpha().raw().toBuffer();
    for (let offset = 0; offset < decoded.length; offset += 4) {
      if (decoded[offset + 3] === 0)
        expect([...decoded.subarray(offset, offset + 3)]).toEqual([0, 0, 0]);
    }
    const decodedMask = await sharp(first.binaryMaskPng).greyscale().raw().toBuffer({
      resolveWithObject: true,
    });
    expect(decodedMask.info).toMatchObject({ width: 2, height: 2 });
    expect([...decodedMask.data]).toEqual([255, 255, 0, 0]);
    expect(createHash('sha256').update(first.binaryMaskPng).digest('hex')).toBe(
      first.metadata.binaryMaskPngSha256,
    );
    expect(createHash('sha256').update(first.cutoutPng).digest('hex')).toBe(
      first.metadata.cutoutPngSha256,
    );
  });

  it('rejects duplicate dispatch and treats timeout/cancellation as indeterminate', async () => {
    const request = createRequest();
    const adapter = createSamRunPodAdapter({
      endpointId: 'fake-sam-duplicate',
      expectedExecutionIdentity: SAM_DETERMINISTIC_FAKE_IDENTITY,
      transport: createDeterministicSamRunPodTransport(),
    });
    await adapter.generate(request, null);
    await expect(adapter.generate(request, null)).rejects.toMatchObject({
      reason: 'DUPLICATE_DISPATCH',
      retryable: false,
    });

    const timeoutRequest = createRequest();
    const timeoutAdapter = createSamRunPodAdapter({
      endpointId: 'fake-sam-timeout',
      expectedExecutionIdentity: SAM_DETERMINISTIC_FAKE_IDENTITY,
      transport: createDeterministicSamRunPodTransport({ waitForAbort: true }),
      fakeTimeoutMs: 5,
    });
    await expect(timeoutAdapter.generate(timeoutRequest, null)).rejects.toMatchObject({
      reason: 'INDETERMINATE',
      retryable: false,
    });

    const cancellationRequest = createRequest();
    const cancellationAdapter = createSamRunPodAdapter({
      endpointId: 'fake-sam-cancel',
      expectedExecutionIdentity: SAM_DETERMINISTIC_FAKE_IDENTITY,
      transport: createDeterministicSamRunPodTransport({ waitForAbort: true }),
      fakeTimeoutMs: 1_000,
    });
    const controller = new AbortController();
    const pending = cancellationAdapter.generate(cancellationRequest, null, {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ reason: 'INDETERMINATE', retryable: false });

    const preCancelledRequest = createRequest();
    const preCancelledTransport = createDeterministicSamRunPodTransport();
    const preCancelledAdapter = createSamRunPodAdapter({
      endpointId: 'fake-sam-pre-cancel',
      expectedExecutionIdentity: SAM_DETERMINISTIC_FAKE_IDENTITY,
      transport: preCancelledTransport,
    });
    const preCancelledController = new AbortController();
    preCancelledController.abort();
    await expect(
      preCancelledAdapter.generate(preCancelledRequest, null, {
        signal: preCancelledController.signal,
      }),
    ).rejects.toMatchObject({ reason: 'PRE_DISPATCH_CANCELLED', retryable: false });
    expect(preCancelledTransport.getCallCount()).toBe(0);
  });

  it('strictly parses every supported RunPod envelope without exposing worker identity', async () => {
    const telemetry: unknown[] = [];
    const completedRequest = createRequest();
    const completed = await createSamRunPodAdapter({
      endpointId: 'fake-sam-envelope-worker',
      expectedExecutionIdentity: SAM_DETERMINISTIC_FAKE_IDENTITY,
      transport: createDeterministicSamRunPodTransport({
        responseVariant: {
          kind: 'completed',
          delayTime: 604_800_000,
          executionTime: 604_800_000,
          workerId: `w${'a'.repeat(255)}`,
        },
      }),
      telemetry: (event) => telemetry.push(event),
    }).generate(completedRequest, null);
    expect(completed.requestId).toBe(completedRequest.requestId);
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0]).not.toHaveProperty('workerId');

    for (const responseVariant of [
      { kind: 'completed', delayTime: 0.5 },
      { kind: 'completed', executionTime: 604_800_001 },
      { kind: 'completed', workerId: `w${'a'.repeat(256)}` },
      { kind: 'completed', includeUnknownField: true },
      { kind: 'completed', omitOutput: true },
      {
        kind: 'non-completed',
        status: 'FAILED',
        delayTime: 0.5,
        error: 'fractional timing must fail schema validation',
      },
      {
        kind: 'non-completed',
        status: 'FAILED',
        includeUnknownField: true,
        error: 'unknown field must fail schema validation',
      },
    ] as const) {
      await expect(
        createSamRunPodAdapter({
          endpointId: `fake-sam-envelope-invalid-${identityCounter}`,
          expectedExecutionIdentity: SAM_DETERMINISTIC_FAKE_IDENTITY,
          transport: createDeterministicSamRunPodTransport({ responseVariant }),
        }).generate(createRequest(), null),
      ).rejects.toMatchObject({ reason: 'RESPONSE_INVALID', retryable: false });
    }

    for (const status of ['IN_QUEUE', 'IN_PROGRESS', 'RUNNING', 'TIMED_OUT'] as const) {
      await expect(
        createSamRunPodAdapter({
          endpointId: `fake-sam-envelope-${status.toLowerCase().replace('_', '-')}`,
          expectedExecutionIdentity: SAM_DETERMINISTIC_FAKE_IDENTITY,
          transport: createDeterministicSamRunPodTransport({
            responseVariant: {
              kind: 'non-completed',
              status,
              delayTime: 0,
              executionTime: 1,
              workerId: 'worker.safe:1',
            },
          }),
        }).generate(createRequest(), null),
      ).rejects.toMatchObject({ reason: 'INDETERMINATE', retryable: false });
    }

    for (const status of ['FAILED', 'CANCELLED'] as const) {
      await expect(
        createSamRunPodAdapter({
          endpointId: `fake-sam-envelope-${status.toLowerCase()}`,
          expectedExecutionIdentity: SAM_DETERMINISTIC_FAKE_IDENTITY,
          transport: createDeterministicSamRunPodTransport({
            responseVariant: {
              kind: 'non-completed',
              status,
              delayTime: 0,
              executionTime: 1,
              workerId: 'worker.safe:1',
              error: 'bounded deterministic provider error',
            },
          }),
        }).generate(createRequest(), null),
      ).rejects.toMatchObject({ reason: 'PROVIDER_FAILURE', retryable: false });
    }
  });

  it('rejects placeholder checkpoint identity and cloned live authorization IDs', async () => {
    const liveIdentity = {
      kind: 'meta-sam2.1',
      repositoryUrl: 'https://github.com/facebookresearch/sam2',
      repositoryCommit: '05d9e57fb3945b10c861046c1e6749e2bfc258e3',
      modelId: 'sam2.1_hiera_base_plus',
      configIdentity: 'configs/sam2.1/sam2.1_hiera_b+.yaml',
      checkpointUrl:
        'https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt',
      checkpointSha256: '1'.repeat(64),
    } as const;
    expect(() =>
      SamLiveExecutionIdentitySchema.parse({
        ...liveIdentity,
        checkpointSha256: '0'.repeat(64),
      }),
    ).toThrow();

    let transportCalls = 0;
    const localFailureTransport: SamRunPodTransportPort = {
      transportKind: 'native-fetch',
      async dispatch(transportRequest) {
        consumeSamRunPodDispatchCapability(transportRequest, 'native-fetch');
        const wrapper = JSON.parse(transportRequest.requestBodyText) as {
          readonly input: Record<string, unknown>;
          readonly policy: Record<string, unknown>;
        };
        expect(Object.keys(wrapper).sort()).toEqual(['input', 'policy']);
        expect(wrapper.policy).toEqual({ executionTimeout: 5_000, ttl: 10_000 });
        expect(wrapper.input).not.toHaveProperty('policy');
        expect(transportRequest.timeoutMs).toBe(1_000);
        transportCalls += 1;
        return {
          status: 200,
          bodyText: JSON.stringify({
            id: `local-no-network-${transportCalls}`,
            status: 'FAILED',
            error: 'deterministic local provider failure',
          }),
        };
      },
    };
    const firstRequest = createRequest();
    const authorization: SamLiveAuthorization = {
      kind: 'single-fixture-sam-runpod-v1',
      authorizationId: '08dbe0ed-f7c0-4b55-b615-cd15f8da31f7',
      endpointId: 'future-test-endpoint',
      imageDigest: `sha256:${'2'.repeat(64)}`,
      secretReferenceName: 'RUNPOD_API_KEY',
      executionIdentity: liveIdentity,
      fixture: {
        sha256: firstRequest.source.sha256,
        byteSize: firstRequest.source.byteSize,
        width: firstRequest.source.width,
        height: firstRequest.source.height,
      },
      requestLimits: firstRequest.limits,
      output: firstRequest.output,
      automaticCandidatesOnly: true,
      providerCallsMaximum: 1,
      clientRetryCount: 0,
      clientWallTimeoutMs: 1_000,
      providerExecutionTimeoutMs: 5_000,
      providerTtlMs: 10_000,
      costMaximumMicroUsd: 1,
      issuedAtMs: 100,
      expiresAtMs: 200,
      executionAuthorized: true,
      productionAdmissionAuthority: false,
      webRouteActivated: false,
    };
    const nativeAdapter = (
      liveAuthorization: SamLiveAuthorization,
      transport: SamRunPodTransportPort = localFailureTransport,
    ) =>
      createSamRunPodAdapter({
        endpointId: liveAuthorization.endpointId,
        expectedExecutionIdentity: liveIdentity,
        transport,
        authorization: liveAuthorization,
        configuredImageDigest: liveAuthorization.imageDigest,
        configuredClientWallTimeoutMs: liveAuthorization.clientWallTimeoutMs,
        configuredProviderExecutionTimeoutMs: liveAuthorization.providerExecutionTimeoutMs,
        configuredProviderTtlMs: liveAuthorization.providerTtlMs,
        nowMs: () => 150,
      });
    expect(() =>
      createSamRunPodAdapter({
        endpointId: authorization.endpointId,
        expectedExecutionIdentity: liveIdentity,
        transport: localFailureTransport,
        authorization,
        configuredImageDigest: `sha256:${'0'.repeat(64)}`,
        configuredClientWallTimeoutMs: authorization.clientWallTimeoutMs,
        configuredProviderExecutionTimeoutMs: authorization.providerExecutionTimeoutMs,
        configuredProviderTtlMs: authorization.providerTtlMs,
      }),
    ).toThrow();
    for (const [providerExecutionTimeoutMs, providerTtlMs] of [
      [4_999, 10_000],
      [604_800_001, 10_000],
      [5_000, 9_999],
      [5_000, 604_800_001],
    ] as const) {
      expect(() =>
        createSamRunPodAdapter({
          endpointId: authorization.endpointId,
          expectedExecutionIdentity: liveIdentity,
          transport: localFailureTransport,
          authorization,
          configuredImageDigest: authorization.imageDigest,
          configuredClientWallTimeoutMs: authorization.clientWallTimeoutMs,
          configuredProviderExecutionTimeoutMs: providerExecutionTimeoutMs,
          configuredProviderTtlMs: providerTtlMs,
        }),
      ).toThrow();
    }
    expect(() =>
      createSamRunPodAdapter({
        endpointId: authorization.endpointId,
        expectedExecutionIdentity: liveIdentity,
        transport: localFailureTransport,
        authorization,
        configuredImageDigest: authorization.imageDigest,
        configuredClientWallTimeoutMs: authorization.clientWallTimeoutMs + 1,
        configuredProviderExecutionTimeoutMs: authorization.providerExecutionTimeoutMs,
        configuredProviderTtlMs: authorization.providerTtlMs,
      }),
    ).toThrow();
    expect(() =>
      createSamRunPodAdapter({
        endpointId: authorization.endpointId,
        expectedExecutionIdentity: liveIdentity,
        transport: localFailureTransport,
        authorization,
        configuredImageDigest: authorization.imageDigest,
        configuredClientWallTimeoutMs: authorization.clientWallTimeoutMs,
        configuredProviderExecutionTimeoutMs: authorization.providerExecutionTimeoutMs,
        configuredProviderTtlMs: authorization.providerTtlMs + 1,
      }),
    ).toThrow();
    expect(() =>
      createSamRunPodAdapter({
        endpointId: authorization.endpointId,
        expectedExecutionIdentity: liveIdentity,
        transport: localFailureTransport,
        authorization,
        configuredImageDigest: `sha256:${'3'.repeat(64)}`,
        configuredClientWallTimeoutMs: authorization.clientWallTimeoutMs,
        configuredProviderExecutionTimeoutMs: authorization.providerExecutionTimeoutMs,
        configuredProviderTtlMs: authorization.providerTtlMs,
      }),
    ).toThrow();
    expect(() =>
      createSamRunPodAdapter({
        endpointId: authorization.endpointId,
        expectedExecutionIdentity: liveIdentity,
        transport: localFailureTransport,
        authorization,
        configuredImageDigest: authorization.imageDigest,
        configuredClientWallTimeoutMs: authorization.clientWallTimeoutMs,
        configuredProviderExecutionTimeoutMs: 5_001,
        configuredProviderTtlMs: authorization.providerTtlMs,
      }),
    ).toThrow();
    const changedMinimumAuthorization = {
      ...structuredClone(authorization),
      authorizationId: '08dbe0ed-f7c0-4b55-b615-cd15f8da31f8',
    };
    const changedMinimumAdapter = nativeAdapter(changedMinimumAuthorization);
    await expect(
      changedMinimumAdapter.generate(
        SamMaskRequestSchema.parse({
          ...firstRequest,
          limits: { ...firstRequest.limits, minMaskAreaPixels: 3 },
        }),
        'local-test-secret',
      ),
    ).rejects.toMatchObject({ reason: 'UNAUTHORIZED' });

    const changedMaximumAuthorization = {
      ...structuredClone(authorization),
      authorizationId: '08dbe0ed-f7c0-4b55-b615-cd15f8da31f9',
    };
    const changedMaximumAdapter = nativeAdapter(changedMaximumAuthorization);
    await expect(
      changedMaximumAdapter.generate(
        SamMaskRequestSchema.parse({
          ...firstRequest,
          limits: { ...firstRequest.limits, maxCandidates: 63 },
        }),
        'local-test-secret',
      ),
    ).rejects.toMatchObject({ reason: 'UNAUTHORIZED' });
    expect(transportCalls).toBe(0);

    const firstAdapter = nativeAdapter(authorization);
    await expect(firstAdapter.generate(firstRequest, 'local-test-secret')).rejects.toMatchObject({
      reason: 'PROVIDER_FAILURE',
    });
    expect(transportCalls).toBe(1);

    const rejectedRequest = createRequest();
    const rejectedAuthorization: SamLiveAuthorization = {
      ...structuredClone(authorization),
      authorizationId: '08dbe0ed-f7c0-4b55-b615-cd15f8da31fa',
      fixture: {
        sha256: rejectedRequest.source.sha256,
        byteSize: rejectedRequest.source.byteSize,
        width: rejectedRequest.source.width,
        height: rejectedRequest.source.height,
      },
      requestLimits: rejectedRequest.limits,
      output: rejectedRequest.output,
    };
    const rejectingTransport: SamRunPodTransportPort = {
      transportKind: 'native-fetch',
      async dispatch(transportRequest) {
        consumeSamRunPodDispatchCapability(transportRequest, 'native-fetch');
        throw new TypeError('deterministic post-dispatch transport rejection');
      },
    };
    const rejectingAdapter = nativeAdapter(rejectedAuthorization, rejectingTransport);
    await expect(
      rejectingAdapter.generate(rejectedRequest, 'local-test-secret'),
    ).rejects.toMatchObject({ reason: 'INDETERMINATE', retryable: false });

    const clonedAuthorization = structuredClone(authorization);
    const secondAdapter = nativeAdapter(clonedAuthorization);
    await expect(
      secondAdapter.generate(createRequest(), 'local-test-secret'),
    ).rejects.toMatchObject({
      reason: 'UNAUTHORIZED',
      retryable: false,
    });
    expect(transportCalls).toBe(1);
  });

  it('keeps native endpoint, secret reference, image bytes and adapter out of the public graph', () => {
    expect(publicBannerAi).toHaveProperty('SamMaskRequestSchema');
    expect(publicBannerAi).not.toHaveProperty('RUNPOD_API_KEY_REFERENCE');
    expect(publicBannerAi).not.toHaveProperty('createSamRunPodAdapter');
    expect(publicBannerAi).not.toHaveProperty('createSamRunPodNativeFetchTransport');
    expect(publicBannerAi).not.toHaveProperty('materializeSamMaskCutout');

    const collect = (directory: string): readonly string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? collect(path) : path.endsWith('.ts') ? [path] : [];
      });
    const publicSource = readFileSync(join(packageRoot, 'src/index.ts'), 'utf8');
    expect(publicSource).not.toContain('/server/');
    expect(publicSource).not.toContain('sam-cutout-materializer');
    const serverSources = collect(join(packageRoot, 'src/server'))
      .filter((path) => path.includes('sam-'))
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    expect(serverSources).not.toMatch(/qwen.*(?:xBps|yBps|widthBps|heightBps)/iu);
    expect(SAM_LIMITS.providerEnvelopeBytes).toBe(12_500_000);
  });

  it('allows selection by immutable candidate ID without semantic labels or geometry mutation', async () => {
    const request = createRequest();
    const response = await createSamRunPodAdapter({
      endpointId: 'fake-sam-selection',
      expectedExecutionIdentity: SAM_DETERMINISTIC_FAKE_IDENTITY,
      transport: createDeterministicSamRunPodTransport(),
    }).generate(request, null);
    const before = JSON.stringify(response.candidates);
    const proposalOnlySelection = { candidateIds: [response.candidates[0]!.candidateId] };
    expect(proposalOnlySelection.candidateIds[0]).toBe(response.candidates[0]!.candidateId);
    expect(JSON.stringify(response.candidates)).toBe(before);
    expect(response.candidates[0]).not.toHaveProperty('semanticLabel');
  });
});
