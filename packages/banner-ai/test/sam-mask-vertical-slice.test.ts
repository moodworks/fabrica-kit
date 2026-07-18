import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
  consumeSamRunPodDirectV2DispatchCapability,
  createSamRunPodDirectV2Adapter,
  deriveSamRunPodDirectV2Endpoint,
  type SamRunPodDirectV2TransportPort,
} from '../src/server/sam-runpod-direct-v2-adapter.js';
import {
  SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
  createDeterministicSamRunPodDirectV2Transport,
} from '../src/server/sam-runpod-direct-v2-deterministic-fake-transport.js';
import {
  assertSamRunPodDirectV2EndpointUrl,
  createSamRunPodDirectV2NativeFetchTransport,
} from '../src/server/sam-runpod-direct-v2-native-fetch-transport.js';
import {
  RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT_MS,
  RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT,
  RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS,
  RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT,
  SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V2,
  SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V2_SHA256,
  SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V2,
  SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V2_SHA256,
  SAM_RUNPOD_DIRECT_HOSTING_PROFILE,
  SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
  SamRunPodDirectV2AuthorizationSchema,
  type SamRunPodDirectV2Authorization,
} from '../src/server/sam-runpod-direct-v2-profiles.js';

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
const nativeImageDigest = `sha256:${'2'.repeat(64)}` as const;
let authorizationCounter = 1;

const createDirectAuthorization = (
  request: SamMaskRequest,
  overrides?: Partial<SamRunPodDirectV2Authorization>,
): SamRunPodDirectV2Authorization => {
  const counter = authorizationCounter;
  authorizationCounter += 1;
  return SamRunPodDirectV2AuthorizationSchema.parse({
    kind: 'single-fixture-sam-runpod-direct-v2',
    authorizationId: `08dbe0ed-f7c0-4b55-b615-${counter.toString(16).padStart(12, '0')}`,
    endpointId: 'future-direct-endpoint',
    imageDigest: nativeImageDigest,
    secretReferenceName: 'RUNPOD_API_KEY',
    executionIdentity: liveIdentity,
    hostingProfileSha256: SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
    adapterProfileSha256: SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V2_SHA256,
    authorizationProfileSha256: SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V2_SHA256,
    documentationEvidence: {
      retrievedAt: RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT,
      expiresAt: RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT,
      hostingProfileSha256: SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
    },
    fixture: {
      sha256: request.source.sha256,
      byteSize: request.source.byteSize,
      width: request.source.width,
      height: request.source.height,
    },
    requestLimits: request.limits,
    output: request.output,
    automaticCandidatesOnly: true,
    clientDispatchMaximum: 1,
    applicationInferenceMaximum: 1,
    providerBillingGuarantee: false,
    clientRetryCount: 0,
    pollCount: 0,
    clientWallTimeoutMs: 1_000,
    costMaximumMicroUsd: 1,
    issuedAtMs: RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS,
    expiresAtMs: RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT_MS,
    executionAuthorized: true,
    productionAdmissionAuthority: false,
    webRouteActivated: false,
    ...overrides,
  });
};

describe('SAM mask protocol', () => {
  it('consumes the same machine vectors as the Python worker', () => {
    const vectors = JSON.parse(
      readFileSync(resolve(packageRoot, '../../services/sam-worker/protocol-vectors.json'), 'utf8'),
    ) as {
      readonly vectorVersion: number;
      readonly directHosting: {
        readonly profile: unknown;
        readonly sha256: string;
      };
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
    expect(vectors.vectorVersion).toBe(2);
    expect(vectors.directHosting.profile).toEqual(SAM_RUNPOD_DIRECT_HOSTING_PROFILE);
    expect(vectors.directHosting.sha256).toBe(SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256);
    expect(sha256Hex(Buffer.from(canonicalizeJson(vectors.directHosting.profile), 'utf8'))).toBe(
      SAM_RUNPOD_DIRECT_HOSTING_PROFILE_SHA256,
    );
    expect(
      sha256Hex(Buffer.from(canonicalizeJson(SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V2), 'utf8')),
    ).toBe(SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V2_SHA256);
    expect(
      sha256Hex(Buffer.from(canonicalizeJson(SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V2), 'utf8')),
    ).toBe(SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V2_SHA256);
    expect(SAM_RUNPOD_DIRECT_AUTHORIZATION_PROFILE_V2.activation).toMatchObject({
      clientDispatchMaximum: 1,
      applicationInferenceMaximum: 1,
      providerBillingGuarantee: false,
    });
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
    const transport = createDeterministicSamRunPodDirectV2Transport();
    const response = await createSamRunPodDirectV2Adapter({
      endpointId: 'fake-sam-test-one',
      expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
      transport,
    }).generate(request);
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
    const duplicateTransport = createDeterministicSamRunPodDirectV2Transport();
    const adapter = createSamRunPodDirectV2Adapter({
      endpointId: 'fake-sam-duplicate',
      expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
      transport: duplicateTransport,
    });
    await adapter.generate(request);
    await expect(adapter.generate(request)).rejects.toMatchObject({
      reason: 'DUPLICATE_DISPATCH',
      retryable: false,
    });
    expect(duplicateTransport.getCallCount()).toBe(1);

    const timeoutRequest = createRequest();
    const timeoutAdapter = createSamRunPodDirectV2Adapter({
      endpointId: 'fake-sam-timeout',
      expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
      transport: createDeterministicSamRunPodDirectV2Transport({ waitForAbort: true }),
      fakeTimeoutMs: 5,
    });
    await expect(timeoutAdapter.generate(timeoutRequest)).rejects.toMatchObject({
      reason: 'INDETERMINATE',
      retryable: false,
    });

    const cancellationRequest = createRequest();
    const cancellationAdapter = createSamRunPodDirectV2Adapter({
      endpointId: 'fake-sam-cancel',
      expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
      transport: createDeterministicSamRunPodDirectV2Transport({ waitForAbort: true }),
      fakeTimeoutMs: 1_000,
    });
    const controller = new AbortController();
    const pending = cancellationAdapter.generate(cancellationRequest, {
      signal: controller.signal,
    });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ reason: 'INDETERMINATE', retryable: false });

    const preCancelledRequest = createRequest();
    const preCancelledTransport = createDeterministicSamRunPodDirectV2Transport();
    const preCancelledAdapter = createSamRunPodDirectV2Adapter({
      endpointId: 'fake-sam-pre-cancel',
      expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
      transport: preCancelledTransport,
    });
    const preCancelledController = new AbortController();
    preCancelledController.abort();
    await expect(
      preCancelledAdapter.generate(preCancelledRequest, {
        signal: preCancelledController.signal,
      }),
    ).rejects.toMatchObject({ reason: 'PRE_DISPATCH_CANCELLED', retryable: false });
    expect(preCancelledTransport.getCallCount()).toBe(0);
  });

  it('accepts only a direct response and maps strict status outcomes without retry', async () => {
    const telemetry: unknown[] = [];
    const request = createRequest();
    const transport = createDeterministicSamRunPodDirectV2Transport();
    const completed = await createSamRunPodDirectV2Adapter({
      endpointId: 'fake-sam-direct-response',
      expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
      transport,
      telemetry: (event) => telemetry.push(event),
    }).generate(request);
    expect(completed.requestId).toBe(request.requestId);
    expect(transport.getCallCount()).toBe(1);
    expect(JSON.parse(transport.getLastRequestBodyText()!)).toEqual(request);
    expect(JSON.parse(transport.getLastRequestBodyText()!)).not.toHaveProperty('input');
    expect(JSON.parse(transport.getLastRequestBodyText()!)).not.toHaveProperty('policy');
    expect(telemetry).toHaveLength(1);
    expect(telemetry[0]).toEqual({
      event: 'sam-runpod-direct-succeeded',
      requestId: request.requestId,
      attemptId: request.attemptId,
      endpointId: 'fake-sam-direct-response',
      status: 200,
      candidateCount: completed.candidateCount,
      failureReason: null,
    });

    for (const status of [400, 404, 409, 413, 415, 422, 429] as const) {
      await expect(
        createSamRunPodDirectV2Adapter({
          endpointId: `fake-sam-direct-http-${status}`,
          expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
          transport: createDeterministicSamRunPodDirectV2Transport({ status }),
        }).generate(createRequest()),
      ).rejects.toMatchObject({ reason: 'PROVIDER_FAILURE', retryable: false });
    }
    for (const status of [500, 502, 503, 504] as const) {
      const oneCall = createDeterministicSamRunPodDirectV2Transport({
        status,
        contentType: 'text/plain',
        bodyText: 'malformed gateway body',
      });
      await expect(
        createSamRunPodDirectV2Adapter({
          endpointId: `fake-sam-direct-http-${status}`,
          expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
          transport: oneCall,
        }).generate(createRequest()),
      ).rejects.toMatchObject({ reason: 'INDETERMINATE', retryable: false });
      expect(oneCall.getCallCount()).toBe(1);
    }

    const resign = (
      response: SamMaskResponse,
      changed: Partial<Omit<SamMaskResponse, 'responseSha256'>>,
    ): SamMaskResponse => {
      const unsigned = Object.fromEntries(
        Object.entries(response).filter(([key]) => key !== 'responseSha256'),
      ) as Omit<SamMaskResponse, 'responseSha256'>;
      const merged = { ...unsigned, ...changed };
      return { ...merged, responseSha256: canonicalResponseSha256(merged) };
    };
    for (const invalidTransport of [
      createDeterministicSamRunPodDirectV2Transport({ status: 201 }),
      createDeterministicSamRunPodDirectV2Transport({ contentType: 'text/json' }),
      createDeterministicSamRunPodDirectV2Transport({
        bodyText: JSON.stringify({
          id: 'legacy-queue-job',
          status: 'COMPLETED',
          output: completed,
        }),
      }),
      createDeterministicSamRunPodDirectV2Transport({
        responseBody: (response) => ({ ...response, unknown: true }),
      }),
      createDeterministicSamRunPodDirectV2Transport({
        responseBody: (response) =>
          resign(response, {
            requestId: '00000000-0000-0000-0000-000000000001',
          }),
      }),
      createDeterministicSamRunPodDirectV2Transport({
        responseBody: (response) =>
          resign(response, {
            sourceSha256: '0'.repeat(64),
          }),
      }),
      createDeterministicSamRunPodDirectV2Transport({
        responseBody: (response) =>
          resign(response, {
            executionIdentity: {
              ...SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
              engineId: 'different-code-mask-engine-v1',
            },
          }),
      }),
      createDeterministicSamRunPodDirectV2Transport({
        bodyText: 'x'.repeat(SAM_LIMITS.responseJsonBytes + 1),
      }),
    ]) {
      await expect(
        createSamRunPodDirectV2Adapter({
          endpointId: `fake-sam-invalid-response-${identityCounter}`,
          expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
          transport: invalidTransport,
        }).generate(createRequest()),
      ).rejects.toMatchObject({ reason: 'RESPONSE_INVALID', retryable: false });
      expect(invalidTransport.getCallCount()).toBe(1);
    }

    await expect(
      createSamRunPodDirectV2Adapter({
        endpointId: 'fake-sam-connection-loss',
        expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
        transport: createDeterministicSamRunPodDirectV2Transport({
          throwAfterDispatch: true,
        }),
      }).generate(createRequest()),
    ).rejects.toMatchObject({ reason: 'INDETERMINATE', retryable: false });
  });

  it('requires exact unexpired direct authorization and consumes it once', async () => {
    expect(() =>
      SamLiveExecutionIdentitySchema.parse({
        ...liveIdentity,
        checkpointSha256: '0'.repeat(64),
      }),
    ).toThrow();
    expect(() =>
      SamRunPodDirectV2AuthorizationSchema.parse({
        kind: 'single-fixture-sam-runpod-v1',
      }),
    ).toThrow();

    let transportCalls = 0;
    const localFailureTransport: SamRunPodDirectV2TransportPort = {
      transportKind: 'native-fetch-direct-v2',
      secretReferenceName: 'RUNPOD_API_KEY',
      async dispatch(transportRequest) {
        consumeSamRunPodDirectV2DispatchCapability(transportRequest, 'native-fetch-direct-v2');
        expect(transportRequest.endpoint).toBe(
          'https://future-direct-endpoint.api.runpod.ai/v1/masks',
        );
        expect(transportRequest.method).toBe('POST');
        expect(transportRequest.timeoutMs).toBe(1_000);
        const body = JSON.parse(transportRequest.requestBodyText) as Record<string, unknown>;
        expect(body).not.toHaveProperty('input');
        expect(body).not.toHaveProperty('policy');
        expect(body).not.toHaveProperty('endpoint');
        transportCalls += 1;
        return {
          status: 400,
          contentType: 'application/json',
          bodyText: '{"error":{"code":"REQUEST_INVALID","message":"Request rejected."}}',
        };
      },
    };
    const request = createRequest();
    const authorization = createDirectAuthorization(request);
    expect(() =>
      createSamRunPodDirectV2Adapter({
        endpointId: authorization.endpointId,
        expectedExecutionIdentity: liveIdentity,
        transport: localFailureTransport,
        authorization: {
          ...authorization,
          kind: 'single-fixture-sam-runpod-v1',
        },
        configuredImageDigest: authorization.imageDigest,
        nowMs: () => RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS + 1,
      }),
    ).toThrow();
    const nativeAdapter = (
      liveAuthorization: SamRunPodDirectV2Authorization,
      transport: SamRunPodDirectV2TransportPort = localFailureTransport,
      nowMs: () => number = () => RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS + 1,
    ) =>
      createSamRunPodDirectV2Adapter({
        endpointId: liveAuthorization.endpointId,
        expectedExecutionIdentity: liveIdentity,
        transport,
        authorization: liveAuthorization,
        configuredImageDigest: liveAuthorization.imageDigest,
        nowMs,
      });

    expect(() =>
      createSamRunPodDirectV2Adapter({
        endpointId: authorization.endpointId,
        expectedExecutionIdentity: liveIdentity,
        transport: localFailureTransport,
        authorization,
        configuredImageDigest: `sha256:${'3'.repeat(64)}`,
        nowMs: () => RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS + 1,
      }),
    ).toThrow();
    expect(() =>
      createSamRunPodDirectV2Adapter({
        endpointId: authorization.endpointId,
        expectedExecutionIdentity: liveIdentity,
        transport: localFailureTransport,
        authorization: {
          ...authorization,
          adapterProfileSha256: '0'.repeat(64),
        },
        configuredImageDigest: authorization.imageDigest,
        nowMs: () => RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS + 1,
      }),
    ).toThrow();
    expect(() =>
      nativeAdapter(
        authorization,
        localFailureTransport,
        () => RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT_MS,
      ),
    ).toThrow();
    const fakeAfterEvidenceExpiryRequest = createRequest();
    await expect(
      createSamRunPodDirectV2Adapter({
        endpointId: 'fake-remains-provider-free',
        expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
        transport: createDeterministicSamRunPodDirectV2Transport(),
        nowMs: () => RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT_MS + 1,
      }).generate(fakeAfterEvidenceExpiryRequest),
    ).resolves.toMatchObject({
      requestId: fakeAfterEvidenceExpiryRequest.requestId,
      executionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
    });

    const changedLimitsAuthorization = createDirectAuthorization(request);
    await expect(
      nativeAdapter(changedLimitsAuthorization).generate(
        SamMaskRequestSchema.parse({
          ...request,
          limits: { ...request.limits, maxCandidates: 63 },
        }),
      ),
    ).rejects.toMatchObject({ reason: 'UNAUTHORIZED', retryable: false });
    expect(transportCalls).toBe(0);

    const firstAdapter = nativeAdapter(authorization);
    await expect(firstAdapter.generate(request)).rejects.toMatchObject({
      reason: 'PROVIDER_FAILURE',
      retryable: false,
    });
    expect(transportCalls).toBe(1);

    const secondRequest = createRequest();
    const reusedIdAuthorization = createDirectAuthorization(secondRequest, {
      authorizationId: authorization.authorizationId,
    });
    await expect(
      nativeAdapter(reusedIdAuthorization).generate(secondRequest),
    ).rejects.toMatchObject({ reason: 'UNAUTHORIZED', retryable: false });
    expect(transportCalls).toBe(1);

    const expiringRequest = createRequest();
    const expiringAuthorization = createDirectAuthorization(expiringRequest);
    let currentTime = RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS + 1;
    const expiringAdapter = nativeAdapter(
      expiringAuthorization,
      localFailureTransport,
      () => currentTime,
    );
    currentTime = RUNPOD_DIRECT_DOCUMENTATION_EXPIRES_AT_MS;
    await expect(expiringAdapter.generate(expiringRequest)).rejects.toMatchObject({
      reason: 'UNAUTHORIZED',
      retryable: false,
    });
    expect(transportCalls).toBe(1);
  });

  it('derives one exact native URL and keeps Bearer authorization inside fetch transport', async () => {
    for (const endpointId of [
      'Uppercase',
      'under_score',
      '.dot',
      '-leading',
      'trailing-',
      `a${'b'.repeat(63)}`,
      'two.labels',
    ]) {
      expect(() => deriveSamRunPodDirectV2Endpoint(endpointId)).toThrow();
    }
    expect(deriveSamRunPodDirectV2Endpoint('a')).toBe('https://a.api.runpod.ai/v1/masks');
    for (const url of [
      'http://valid.api.runpod.ai/v1/masks',
      'https://user@valid.api.runpod.ai/v1/masks',
      'https://valid.api.runpod.ai:443/v1/masks',
      'https://valid.api.runpod.ai/v1/masks?query=1',
      'https://valid.api.runpod.ai/v1/masks#fragment',
      'https://valid.api.runpod.ai/v1/masks/',
      'https://valid.example.com/v1/masks',
    ]) {
      expect(() => assertSamRunPodDirectV2EndpointUrl(url)).toThrow();
    }

    const request = createRequest();
    const processed = postprocessSamMasks(request, [
      {
        mask: rectangle(request.source.width, request.source.height, 10, 10, 100, 100),
        predictedIou: 0.9,
        stabilityScore: 0.95,
      },
    ]);
    const unsigned: Omit<SamMaskResponse, 'responseSha256'> = {
      contractVersion: SAM_MASK_CONTRACT_VERSION,
      requestId: request.requestId,
      workspaceId: request.workspaceId,
      jobId: request.jobId,
      attemptId: request.attemptId,
      sourceSha256: request.source.sha256,
      executionIdentity: liveIdentity,
      timing: { inferenceMs: 1, totalMs: 1 },
      filterSummary: processed.filterSummary,
      candidateCount: processed.candidates.length,
      candidates: processed.candidates,
    };
    const liveResponse: SamMaskResponse = {
      ...unsigned,
      responseSha256: canonicalResponseSha256(unsigned),
    };
    let fetchCalls = 0;
    const fetchImplementation: typeof fetch = async (url, init) => {
      fetchCalls += 1;
      expect(String(url)).toBe('https://future-direct-endpoint.api.runpod.ai/v1/masks');
      expect(init?.method).toBe('POST');
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const headers = new Headers(init?.headers);
      expect(headers.get('authorization')).toBe('Bearer server-only-test-key');
      expect(headers.get('content-type')).toBe('application/json');
      expect(JSON.parse(String(init?.body))).toEqual(request);
      expect(JSON.parse(String(init?.body))).not.toHaveProperty('input');
      return new Response(JSON.stringify(liveResponse), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    const transport = createSamRunPodDirectV2NativeFetchTransport({
      apiKey: 'server-only-test-key',
      secretReferenceName: 'RUNPOD_API_KEY',
      fetchImplementation,
    });
    const authorization = createDirectAuthorization(request);
    const response = await createSamRunPodDirectV2Adapter({
      endpointId: authorization.endpointId,
      expectedExecutionIdentity: liveIdentity,
      transport,
      authorization,
      configuredImageDigest: authorization.imageDigest,
      nowMs: () => RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS + 1,
    }).generate(request);
    expect(response).toEqual(liveResponse);
    expect(fetchCalls).toBe(1);

    await expect(
      transport.dispatch({
        endpoint: deriveSamRunPodDirectV2Endpoint('foreign-capability'),
        method: 'POST',
        requestBodyText: canonicalizeJson(createRequest()),
        signal: new AbortController().signal,
        timeoutMs: 1,
        dispatchCapability: {},
      }),
    ).rejects.toThrow(/capability/u);
    expect(fetchCalls).toBe(1);
    expect(transport).not.toHaveProperty('apiKey');

    const lostRequest = createRequest();
    const lostAuthorization = createDirectAuthorization(lostRequest);
    let lostCalls = 0;
    const lostTransport = createSamRunPodDirectV2NativeFetchTransport({
      apiKey: 'server-only-test-key',
      secretReferenceName: 'RUNPOD_API_KEY',
      fetchImplementation: async () => {
        lostCalls += 1;
        throw new TypeError('deterministic socket reset after POST');
      },
    });
    await expect(
      createSamRunPodDirectV2Adapter({
        endpointId: lostAuthorization.endpointId,
        expectedExecutionIdentity: liveIdentity,
        transport: lostTransport,
        authorization: lostAuthorization,
        configuredImageDigest: lostAuthorization.imageDigest,
        nowMs: () => RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS + 1,
      }).generate(lostRequest),
    ).rejects.toMatchObject({ reason: 'INDETERMINATE', retryable: false });
    expect(lostCalls).toBe(1);

    const truncatedRequest = createRequest();
    const truncatedAuthorization = createDirectAuthorization(truncatedRequest);
    const truncatedTransport = createSamRunPodDirectV2NativeFetchTransport({
      apiKey: 'server-only-test-key',
      secretReferenceName: 'RUNPOD_API_KEY',
      fetchImplementation: async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(Buffer.from('{"contractVersion":'));
              controller.error(new TypeError('deterministic response truncation'));
            },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    });
    await expect(
      createSamRunPodDirectV2Adapter({
        endpointId: truncatedAuthorization.endpointId,
        expectedExecutionIdentity: liveIdentity,
        transport: truncatedTransport,
        authorization: truncatedAuthorization,
        configuredImageDigest: truncatedAuthorization.imageDigest,
        nowMs: () => RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS + 1,
      }).generate(truncatedRequest),
    ).rejects.toMatchObject({ reason: 'INDETERMINATE', retryable: false });

    const timeoutRequest = createRequest();
    const timeoutAuthorization = createDirectAuthorization(timeoutRequest, {
      clientWallTimeoutMs: 5,
    });
    let timeoutCalls = 0;
    const timeoutTransport = createSamRunPodDirectV2NativeFetchTransport({
      apiKey: 'server-only-test-key',
      secretReferenceName: 'RUNPOD_API_KEY',
      fetchImplementation: async (_url, init) => {
        timeoutCalls += 1;
        return new Promise<Response>((_resolve, reject) => {
          const abort = () =>
            reject(new DOMException('deterministic native timeout', 'AbortError'));
          if (init?.signal?.aborted === true) abort();
          else init?.signal?.addEventListener('abort', abort, { once: true });
        });
      },
    });
    await expect(
      createSamRunPodDirectV2Adapter({
        endpointId: timeoutAuthorization.endpointId,
        expectedExecutionIdentity: liveIdentity,
        transport: timeoutTransport,
        authorization: timeoutAuthorization,
        configuredImageDigest: timeoutAuthorization.imageDigest,
        nowMs: () => RUNPOD_DIRECT_DOCUMENTATION_RETRIEVED_AT_MS + 1,
      }).generate(timeoutRequest),
    ).rejects.toMatchObject({ reason: 'INDETERMINATE', retryable: false });
    expect(timeoutCalls).toBe(1);
  });

  it('keeps native endpoint, secret reference, image bytes and adapter out of the public graph', () => {
    expect(publicBannerAi).toHaveProperty('SamMaskRequestSchema');
    expect(publicBannerAi).not.toHaveProperty('RUNPOD_API_KEY_REFERENCE');
    expect(publicBannerAi).not.toHaveProperty('createSamRunPodDirectV2Adapter');
    expect(publicBannerAi).not.toHaveProperty('createSamRunPodDirectV2NativeFetchTransport');
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
    const adapterSource = readFileSync(
      join(packageRoot, 'src/server/sam-runpod-direct-v2-adapter.ts'),
      'utf8',
    );
    expect(serverSources).not.toMatch(/qwen.*(?:xBps|yBps|widthBps|heightBps)/iu);
    expect(serverSources).not.toMatch(
      /(?:\/runsync|api\.runpod\.ai\/v2|IN_QUEUE|IN_PROGRESS|providerTtl|executionTimeout)/u,
    );
    expect(serverSources).not.toMatch(/["']\/run["'?]/u);
    expect(serverSources).not.toMatch(/runpod\.serverless/u);
    expect(adapterSource).toMatch(
      /async generate\(\s*requestInput: unknown,\s*options\?: \{ readonly signal\?: AbortSignal \}/u,
    );
    expect(adapterSource).not.toMatch(/async generate\([^)]*(?:secret|endpoint)/su);
    for (const removed of [
      'sam-runpod-adapter.ts',
      'sam-runpod-native-fetch-transport.ts',
      'sam-runpod-deterministic-fake-transport.ts',
    ]) {
      expect(existsSync(join(packageRoot, 'src/server', removed))).toBe(false);
    }
    expect(SAM_RUNPOD_DIRECT_ADAPTER_PROFILE_V2.response.maximumBytes).toBe(
      SAM_LIMITS.responseJsonBytes,
    );
  });

  it('allows selection by immutable candidate ID without semantic labels or geometry mutation', async () => {
    const request = createRequest();
    const response = await createSamRunPodDirectV2Adapter({
      endpointId: 'fake-sam-selection',
      expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
      transport: createDeterministicSamRunPodDirectV2Transport(),
    }).generate(request);
    const before = JSON.stringify(response.candidates);
    const proposalOnlySelection = { candidateIds: [response.candidates[0]!.candidateId] };
    expect(proposalOnlySelection.candidateIds[0]).toBe(response.candidates[0]!.candidateId);
    expect(JSON.stringify(response.candidates)).toBe(before);
    expect(response.candidates[0]).not.toHaveProperty('semanticLabel');
  });
});
