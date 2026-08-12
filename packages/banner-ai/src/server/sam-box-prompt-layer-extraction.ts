import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import { z } from 'zod';

import sharp from 'sharp';

import {
  LayerExtractionRequestV1Schema,
  validateExtractedLayerResultV1,
  type ExtractedLayerResultV1,
  type LayerExtractionRequestV1,
} from '../ports/banner-capability-ports.js';
import {
  assertCanonicalNormalizedPng,
  stripPngAncillaryChunks,
} from '../security/raster-container.js';
import {
  SAM_MASK_CONTRACT_VERSION,
  SAM_MASK_ENCODING,
  SamMaskRequestSchema,
  SamMaskCandidateSchema,
  SamLiveExecutionIdentitySchema,
  type SamMaskCandidate,
  type SamMaskRequest,
  type SamMaskResponse,
} from '../sam/sam-mask-contracts.js';
import { SamFakeExecutionIdentitySchema } from '../sam/sam-mask-contracts.js';
import { materializeSamMaskCutout } from '../sam/sam-cutout-materializer.js';
import { assertSamMaskResponseWasStrictlyValidated } from '../sam/sam-mask-validation.js';
import {
  boxBasisToPixel,
  decodeBinaryMaskRle,
  decodeCanonicalBase64,
  maskContentSha256,
} from '../sam/sam-mask-rle.js';
import { canonicalResponseSha256 } from '../sam/sam-mask-rle.js';
import {
  parseAndVerifySamMaskRequest,
  parseAndVerifySamMaskResponse,
} from '../sam/sam-mask-validation.js';
import { postprocessSamMasks } from '../sam/sam-mask-postprocess.js';
import { byteSourceFrom, normalizeRasterUpload } from '../security/raster-upload.js';
import {
  materializeProviderFreePersonSubjectProjectV1,
  type ProviderFreeFixtureMaterializationV1,
} from '../editor/provider-free-fixture-materializer-v1.js';

const SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY = SamFakeExecutionIdentitySchema.parse({
  kind: 'deterministic-fake',
  engineId: 'fabrica-code-mask-engine-v1',
  definitionSha256: '711d087a27ca497fdbbb9bee07603a89ce4bc14f4357c96295467a2bdfe45dd9',
  notice: 'NOT_SAM_OUTPUT',
});
let personReplayMaterializationPromise: Promise<ProviderFreeFixtureMaterializationV1> | null = null;

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

const replayRle =
  'RkJSTAEAAANsAAAA3QAAAAG5nS4C5QYO3AYS2AYX0gYczQYhyQYlxQYowwYqwAYtvgYvuwYyugYzuAY1tgY2tgY3tQY4tAY4swY5swY6sQY7sQY7sQY7sAY8sQY7sQY7sQY7sQY7sQY7sQY7sQY7sgY6sgY6sgY6swY5swY5swY6sgY6swY6sQY6swY6sgY5swY5swY5swY4tQY3tQY3tQY3tQY3tgY1twY1twY0uQYzuQYyugYyuwYwvAYwvQYvvQYvvgYtvwYtvwYtwAYswAYrwQYswQYrwQYrwgYrwQYtwAYtvwYuvwYtvwYuvwYtvwYuvwYtvgYuvgYvvQYvvAYxuwYzuQY1twY3tQY6sgY7sAY+rgZArAZDqQZEpwZHpQZJoAZOmgZTlwZWlAZZjwZejAZhiQZjhwZmhQZnhAZpggZqgQZrgAZt/wVt/gVu/QVv/QVv/QVv/QVv/AVw/AVw+wVx+wVx+gVy+gVy+QVz+QVz+AV0+AV09wV19gV29gV29QV39QV39AV49AV48wV58wV58gV68gV68QV78AV88AV87wV87wV0AQfvBXQHAfAFc/gFdPgFc/gFc/kFc/gFdPcFdPcFdfcFdPUFd/QFd/UFd/QFePQFefIFe/AFfe0Ffu4Ffu0Ffu4Ffe0Ffu4Ffe8FfO4Ffu0Ffu4Ffe0Ffu0Ffu0Ffe0Ff+wFf+0Ffu0Ffu0Ffu4Ffe8FfO8FfPAFe/EFevIFefMFePQFd/UFdvYFdfcFdPgFc/kFcvoFcfsFb/4Fbv4Fbf8Fa4EGaoIGaoIGaYQGZ4UGZocGZIgGY4sGYI4GGgJBkQYSCT+VBgoOPq4GPa8GPLAGO7EGOrIGObMGN7YGNbcGNbcGNLkGMb0GLr8GLcAGKsMGKMUGJuAB';

const ReplayEvidenceSchema = z
  .strictObject({
    manifestSha256: z.literal('b921f3390307857a166bcd4ba6c36a3d19d6c7f55ccd96e61e07d589af8638ee'),
    validatedResponseSha256: z.literal(
      '371b51fe00b0d80a32ad53a0de3ad864d089ea3dbb1e7cb3f2667ce170b29646',
    ),
    sanitizedResponseSha256: z.literal(
      '68c85095d9d0524dae4edb1f40f049cf1a6143a6be59a5446350530b2a2b3999',
    ),
    outputClassification: z.literal('real-sam-output'),
    fixture: z
      .strictObject({
        id: z.literal('banner-person-v1'),
        sourceSha256: z.literal('6e3175cdd260fde33a3885945eb6f8831da3905afbc723f684035f411dc6d699'),
        sourceByteSize: z.literal(241013),
        sourceWidth: z.literal(876),
        sourceHeight: z.literal(221),
        canonicalRequestSha256: z.literal(
          '506e75d829f2494f34a58e9e9f4d610b9b0881a520ed815e7b38f62561815f80',
        ),
        contractVersion: z.literal('sam-mask-v2'),
        requestIdentifiers: z
          .strictObject({
            requestId: z.literal('817e7fd7-0c34-4449-ae81-38c90505a39b'),
            workspaceId: z.literal('dd1f94e4-308e-4fd9-8ea0-e1d60f5d6cb5'),
            jobId: z.literal('2f249fbd-f14b-4004-8c74-1817fd2ef537'),
            attemptId: z.literal('08fb06c9-50c8-40e7-851f-922e4e2be5ff'),
          })
          .readonly(),
        segmentation: z
          .strictObject({
            mode: z.literal('automatic-candidates'),
            prompt: z.strictObject({ kind: z.literal('none') }).readonly(),
          })
          .readonly(),
        limits: z
          .strictObject({ minMaskAreaPixels: z.literal(64), maxCandidates: z.literal(8) })
          .readonly(),
        output: z.strictObject({ maskEncoding: z.literal('fabrica-binary-rle-v1') }).readonly(),
        workerImageDigest: z.literal(
          'sha256:5f6058eb5f626ada2ce9ad3e9f105cd12b601f614df83265ab8479c8403ae7a8',
        ),
      })
      .readonly(),
    executionIdentity: SamLiveExecutionIdentitySchema,
    candidateOrder: z.literal(5),
    candidate: SamMaskCandidateSchema,
    cutout: z
      .strictObject({
        sha256: z.literal('464f1bb286ac4a599e3b49a25b1f427d2b73acaac6c2cd1829902d0d5a870c33'),
        width: z.literal(157),
        height: z.literal(215),
        byteSize: z.literal(53742),
      })
      .readonly(),
  })
  .readonly();

/** Immutable, local provenance for the preserved real Meta SAM replay artifact. */
export const PROVIDER_FREE_PERSON_SAM_REPLAY_EVIDENCE_V1 = deepFreeze(
  ReplayEvidenceSchema.parse({
    manifestSha256: 'b921f3390307857a166bcd4ba6c36a3d19d6c7f55ccd96e61e07d589af8638ee',
    validatedResponseSha256: '371b51fe00b0d80a32ad53a0de3ad864d089ea3dbb1e7cb3f2667ce170b29646',
    sanitizedResponseSha256: '68c85095d9d0524dae4edb1f40f049cf1a6143a6be59a5446350530b2a2b3999',
    outputClassification: 'real-sam-output',
    fixture: {
      id: 'banner-person-v1',
      sourceSha256: '6e3175cdd260fde33a3885945eb6f8831da3905afbc723f684035f411dc6d699',
      sourceByteSize: 241013,
      sourceWidth: 876,
      sourceHeight: 221,
      canonicalRequestSha256: '506e75d829f2494f34a58e9e9f4d610b9b0881a520ed815e7b38f62561815f80',
      contractVersion: 'sam-mask-v2',
      requestIdentifiers: {
        requestId: '817e7fd7-0c34-4449-ae81-38c90505a39b',
        workspaceId: 'dd1f94e4-308e-4fd9-8ea0-e1d60f5d6cb5',
        jobId: '2f249fbd-f14b-4004-8c74-1817fd2ef537',
        attemptId: '08fb06c9-50c8-40e7-851f-922e4e2be5ff',
      },
      segmentation: { mode: 'automatic-candidates', prompt: { kind: 'none' } },
      limits: { minMaskAreaPixels: 64, maxCandidates: 8 },
      output: { maskEncoding: 'fabrica-binary-rle-v1' },
      workerImageDigest: 'sha256:5f6058eb5f626ada2ce9ad3e9f105cd12b601f614df83265ab8479c8403ae7a8',
    },
    executionIdentity: {
      kind: 'meta-sam2.1',
      repositoryUrl: 'https://github.com/facebookresearch/sam2',
      repositoryCommit: '05d9e57fb3945b10c861046c1e6749e2bfc258e3',
      modelId: 'sam2.1_hiera_base_plus',
      configIdentity: 'configs/sam2.1/sam2.1_hiera_b+.yaml',
      checkpointUrl:
        'https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt',
      checkpointSha256: 'a2345aede8715ab1d5d31b4a509fb160c5a4af1970f199d9054ccfb746c004c5',
      workerImageDigest: 'sha256:5f6058eb5f626ada2ce9ad3e9f105cd12b601f614df83265ab8479c8403ae7a8',
    },
    candidateOrder: 5,
    candidate: {
      candidateId: 'samc_v1_478780b81c47a3b064a5398bbf275ddd137a4e21d746b5aeb0623a7a546f99cf',
      bounds: { xBps: 6506, yBps: 271, widthBps: 1794, heightBps: 9729 },
      pixelArea: 17822,
      areaRatioBps: 920,
      predictedIouBps: 9648,
      stabilityScoreBps: 9644,
      reviewFlags: ['near-contained', 'touches-source-edge'],
      mask: {
        encoding: 'fabrica-binary-rle-v1',
        width: 876,
        height: 221,
        byteSize: 675,
        sha256: '218f758d896e6f14198080c50705b1c7cf013b2902922596ee8fa8a2be0f75b0',
        dataBase64: replayRle,
      },
    },
    cutout: {
      sha256: '464f1bb286ac4a599e3b49a25b1f427d2b73acaac6c2cd1829902d0d5a870c33',
      width: 157,
      height: 215,
      byteSize: 53742,
    },
  }),
);

export const validateProviderFreePersonSamReplayEvidenceV1 = (
  input: unknown,
): typeof PROVIDER_FREE_PERSON_SAM_REPLAY_EVIDENCE_V1 => {
  const parsed = ReplayEvidenceSchema.parse(input);
  const maskBytes = decodeCanonicalBase64(
    parsed.candidate.mask.dataBase64,
    parsed.candidate.mask.byteSize,
  );
  const decodedMask = decodeBinaryMaskRle(
    maskBytes,
    parsed.candidate.mask.width,
    parsed.candidate.mask.height,
  );
  if (
    maskBytes.byteLength !== parsed.candidate.mask.byteSize ||
    maskContentSha256(decodedMask.pixels, decodedMask.width, decodedMask.height) !==
      parsed.candidate.mask.sha256
  ) {
    throw new TypeError('Provider-free SAM replay candidate mask integrity drifted.');
  }
  if (canonicalizeJson(parsed) !== canonicalizeJson(PROVIDER_FREE_PERSON_SAM_REPLAY_EVIDENCE_V1)) {
    throw new TypeError('Provider-free SAM replay evidence drifted from the preserved binding.');
  }
  return deepFreeze(parsed) as typeof PROVIDER_FREE_PERSON_SAM_REPLAY_EVIDENCE_V1;
};

const loadPersonReplayFixture = async (): Promise<Uint8Array> => {
  const fixtureRelativePath =
    'packages/banner-ai/test/fixtures/real-model-benchmark/normalized/banner-person-v1.png';
  const cwd = process.cwd();
  const candidates = [
    resolve(cwd, fixtureRelativePath),
    resolve(cwd, '..', '..', fixtureRelativePath),
  ];
  for (const candidate of candidates) {
    try {
      const stat = await lstat(candidate);
      if (!stat.isFile() || (await realpath(candidate)) !== candidate) continue;
      return Uint8Array.from(await readFile(candidate));
    } catch {
      // The second path is the apps/web-cwd build layout fallback.
    }
  }
  throw new TypeError('Pinned person replay fixture is unavailable.');
};

export const materializeProviderFreePersonSamReplayProjectV1 =
  (): Promise<ProviderFreeFixtureMaterializationV1> => {
    if (personReplayMaterializationPromise !== null) return personReplayMaterializationPromise;
    personReplayMaterializationPromise = (async () => {
      const evidence = validateProviderFreePersonSamReplayEvidenceV1(
        PROVIDER_FREE_PERSON_SAM_REPLAY_EVIDENCE_V1,
      );
      const source = {
        bytes: await loadPersonReplayFixture(),
        declaredMediaType: 'image/png' as const,
        filename: 'banner-person-v1.png',
      };
      const normalized = await normalizeRasterUpload({
        bytes: byteSourceFrom(source.bytes),
        declaredMediaType: source.declaredMediaType,
        filename: source.filename,
      });
      const normalizedIdentity = evidence.fixture;
      const expected = {
        assetId: 'asset_banner_person_source_v1',
        assetVersionId: 'asset_version_banner_person_source_v1',
        sha256: normalizedIdentity.sourceSha256,
        mediaType: 'image/png' as const,
        byteSize: normalizedIdentity.sourceByteSize,
        pixelWidth: normalizedIdentity.sourceWidth,
        pixelHeight: normalizedIdentity.sourceHeight,
      };
      if (
        normalized.sha256 !== expected.sha256 ||
        normalized.byteSize !== expected.byteSize ||
        normalized.width !== expected.pixelWidth ||
        normalized.height !== expected.pixelHeight
      )
        throw new TypeError('Verified person replay source identity drifted.');
      const request = SamMaskRequestSchema.parse({
        contractVersion: evidence.fixture.contractVersion,
        ...evidence.fixture.requestIdentifiers,
        source: {
          mediaType: 'image/png',
          byteSize: evidence.fixture.sourceByteSize,
          width: evidence.fixture.sourceWidth,
          height: evidence.fixture.sourceHeight,
          sha256: evidence.fixture.sourceSha256,
          pngBase64: Buffer.from(normalized.bytes).toString('base64'),
        },
        segmentation: evidence.fixture.segmentation,
        limits: evidence.fixture.limits,
        output: evidence.fixture.output,
      });
      if (
        sha256Hex(
          Buffer.from(
            canonicalizeJson({
              ...request,
              workerImageDigest: evidence.executionIdentity.workerImageDigest,
            }),
            'utf8',
          ),
        ) !== evidence.fixture.canonicalRequestSha256
      )
        throw new TypeError('Meta SAM replay request drifted.');
      if (
        request.source.sha256 !== evidence.fixture.sourceSha256 ||
        request.requestId !== evidence.fixture.requestIdentifiers.requestId ||
        request.workspaceId !== evidence.fixture.requestIdentifiers.workspaceId ||
        request.jobId !== evidence.fixture.requestIdentifiers.jobId ||
        request.attemptId !== evidence.fixture.requestIdentifiers.attemptId ||
        request.limits.maxCandidates !== evidence.fixture.limits.maxCandidates ||
        request.limits.minMaskAreaPixels !== evidence.fixture.limits.minMaskAreaPixels
      )
        throw new TypeError('Meta SAM replay request identity drifted.');
      const cutout = await materializeSamMaskCutout({
        trustedRequest: request,
        candidate: evidence.candidate,
      });
      const canonicalCutoutPng = stripPngAncillaryChunks(cutout.cutoutPng);
      if (
        canonicalCutoutPng.byteLength !== evidence.cutout.byteSize ||
        sha256Hex(canonicalCutoutPng) !== evidence.cutout.sha256
      )
        throw new TypeError('Meta SAM replay cutout drifted.');
      return materializeProviderFreePersonSubjectProjectV1({
        source: normalized.bytes,
        subject: canonicalCutoutPng,
      });
    })().catch((error) => {
      personReplayMaterializationPromise = null;
      throw error;
    });
    return personReplayMaterializationPromise;
  };

export const createDeterministicSamBoxPromptAdapter = () => {
  let callCount = 0;
  const adapter = {
    async generate(request: SamMaskRequest): Promise<SamMaskResponse> {
      const parsed = parseAndVerifySamMaskRequest(request).request;
      if (request.segmentation.mode !== 'box-prompt') {
        throw new TypeError('Deterministic box adapter requires a box prompt.');
      }
      const box = boxBasisToPixel(
        request.segmentation.prompt.box,
        parsed.source.width,
        parsed.source.height,
      );
      const mask = new Uint8Array(parsed.source.width * parsed.source.height);
      for (let y = box.top; y <= box.bottomInclusive; y += 1) {
        mask.fill(
          1,
          y * parsed.source.width + box.left,
          y * request.source.width + box.rightInclusive + 1,
        );
      }
      const result = postprocessSamMasks(parsed, [{ mask, predictedIou: 1, stabilityScore: 1 }]);
      callCount += 1;
      const unsigned = {
        contractVersion: SAM_MASK_CONTRACT_VERSION,
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
      } satisfies Omit<SamMaskResponse, 'responseSha256'>;
      const response = { ...unsigned, responseSha256: canonicalResponseSha256(unsigned) };
      return parseAndVerifySamMaskResponse({
        response,
        request,
        expectedExecutionKind: 'deterministic-fake',
      });
    },
  };
  return Object.freeze({
    adapter,
    getCallCount: () => callCount,
    networkCalls: 0 as const,
    executionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
  });
};

export const createBoundedLayerPreview = async (bytes: Uint8Array) => {
  const png = await sharp(bytes)
    .ensureAlpha()
    .toColourspace('srgb')
    .resize({ width: 160, height: 160, fit: 'inside', withoutEnlargement: true })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false, force: true })
    .toBuffer();
  const canonical = stripPngAncillaryChunks(png);
  const info = assertCanonicalNormalizedPng(canonical);
  if (canonical.byteLength > 524_288 || info.width > 160 || info.height > 160)
    throw new TypeError('Layer preview exceeds its bound.');
  return {
    bytes: Uint8Array.from(canonical),
    byteSize: canonical.byteLength,
    pixelWidth: info.width,
    pixelHeight: info.height,
    sha256: digest(canonical),
    dataUrl: `data:image/png;base64,${Buffer.from(canonical).toString('base64')}`,
  };
};

export interface SamBoxPromptGeneratePort {
  generate(request: SamMaskRequest): Promise<SamMaskResponse>;
}

export interface SamBoxPromptLayerExtractionResult {
  readonly layer: ExtractedLayerResultV1;
  readonly part: LayerExtractionRequestV1['part'];
  readonly candidate: SamMaskCandidate;
}

const digest = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export const extractLayerWithSamBoxPrompt = async (input: {
  readonly request: unknown;
  readonly normalizedPng: Uint8Array;
  readonly requestId: string;
  readonly workspaceId: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly sam: SamBoxPromptGeneratePort;
}): Promise<SamBoxPromptLayerExtractionResult> => {
  const request = LayerExtractionRequestV1Schema.parse(input.request);
  if (request.sourceAsset.mediaType !== 'image/png') {
    throw new TypeError('SAM box extraction requires a PNG source asset.');
  }
  if (!request.trimTransparentPixels) {
    throw new TypeError('SAM box extraction only supports tight-cropped transparent pixels.');
  }

  const sourceInfo = assertCanonicalNormalizedPng(input.normalizedPng);
  const sourceSha256 = digest(input.normalizedPng);
  if (
    sourceSha256 !== request.sourceAsset.sha256 ||
    input.normalizedPng.byteLength !== request.sourceAsset.byteSize ||
    sourceInfo.width !== request.sourceAsset.pixelWidth ||
    sourceInfo.height !== request.sourceAsset.pixelHeight
  ) {
    throw new TypeError('Trusted normalized PNG differs from request.sourceAsset.');
  }

  const trustedRequest = SamMaskRequestSchema.parse({
    contractVersion: SAM_MASK_CONTRACT_VERSION,
    requestId: input.requestId,
    workspaceId: input.workspaceId,
    jobId: input.jobId,
    attemptId: input.attemptId,
    source: {
      mediaType: 'image/png',
      byteSize: input.normalizedPng.byteLength,
      width: sourceInfo.width,
      height: sourceInfo.height,
      sha256: sourceSha256,
      pngBase64: Buffer.from(input.normalizedPng).toString('base64'),
    },
    segmentation: {
      mode: 'box-prompt',
      prompt: { kind: 'box', authority: 'server-validated-detector', box: request.part.bounds },
    },
    limits: { minMaskAreaPixels: 1, maxCandidates: 1 },
    output: { maskEncoding: SAM_MASK_ENCODING },
  });

  const response = await input.sam.generate(trustedRequest);
  assertSamMaskResponseWasStrictlyValidated({
    response,
    request: trustedRequest,
    expectedExecutionKind: response.executionIdentity.kind,
  });
  const candidate = response.candidates[0];
  if (!candidate) throw new TypeError('SAM returned no canonical mask candidates.');
  const materialized = await materializeSamMaskCutout({ trustedRequest, candidate });
  // normalized materializer output is validated below
  const canonicalCutout = await sharp(materialized.cutoutPng)
    .ensureAlpha()
    .toColourspace('srgb')
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false, force: true })
    .toBuffer();
  const canonicalCutoutBytes = stripPngAncillaryChunks(canonicalCutout);
  const layer = await validateExtractedLayerResultV1({
    bytes: canonicalCutoutBytes,
    mediaType: 'image/png',
    byteSize: canonicalCutoutBytes.byteLength,
    pixelWidth: materialized.metadata.crop.width,
    pixelHeight: materialized.metadata.crop.height,
    sha256: digest(canonicalCutoutBytes),
  });
  return { layer, part: request.part, candidate };
};
