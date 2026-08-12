import { createHash, randomUUID } from 'node:crypto';

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
  type SamMaskCandidate,
  type SamMaskRequest,
  type SamMaskResponse,
} from '../sam/sam-mask-contracts.js';
import { SamFakeExecutionIdentitySchema } from '../sam/sam-mask-contracts.js';
import { materializeSamMaskCutout } from '../sam/sam-cutout-materializer.js';
import { assertSamMaskResponseWasStrictlyValidated } from '../sam/sam-mask-validation.js';
import { boxBasisToPixel } from '../sam/sam-mask-rle.js';
import { canonicalResponseSha256 } from '../sam/sam-mask-rle.js';
import {
  parseAndVerifySamMaskRequest,
  parseAndVerifySamMaskResponse,
} from '../sam/sam-mask-validation.js';
import { postprocessSamMasks } from '../sam/sam-mask-postprocess.js';
import { createAngelBenchmarkFixtureSourceV1 } from '../evaluation/repository-benchmark-fixture.js';
import {
  ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1,
  ANGEL_PROVIDER_FREE_EXPECTED_LAYERS_V1,
} from '../evaluation/benchmark-case.js';
import { byteSourceFrom, normalizeRasterUpload } from '../security/raster-upload.js';
import {
  materializeProviderFreeAngelForegroundProjectV1,
  type ProviderFreeFixtureMaterializationV1,
} from '../editor/provider-free-fixture-materializer-v1.js';

const SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY = SamFakeExecutionIdentitySchema.parse({
  kind: 'deterministic-fake',
  engineId: 'fabrica-code-mask-engine-v1',
  definitionSha256: '711d087a27ca497fdbbb9bee07603a89ce4bc14f4357c96295467a2bdfe45dd9',
  notice: 'NOT_SAM_OUTPUT',
});

let angelMaterializationPromise: Promise<ProviderFreeFixtureMaterializationV1> | null = null;

export const materializeProviderFreeAngelProjectWithDeterministicSamBoxPromptsV1 =
  (): Promise<ProviderFreeFixtureMaterializationV1> => {
    if (angelMaterializationPromise !== null) return angelMaterializationPromise;
    angelMaterializationPromise = (async () => {
      const source = createAngelBenchmarkFixtureSourceV1('png');
      const normalized = await normalizeRasterUpload({
        bytes: byteSourceFrom(source.bytes),
        declaredMediaType: source.declaredMediaType,
        filename: source.filename,
      });
      const expected = ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1.input.sourceAsset;
      if (
        normalized.sha256 !== expected.sha256 ||
        normalized.byteSize !== expected.byteSize ||
        normalized.width !== expected.pixelWidth ||
        normalized.height !== expected.pixelHeight
      )
        throw new TypeError('Approved Angel source identity drifted.');
      const fake = createDeterministicSamBoxPromptAdapter();
      const foreground: Record<string, unknown> = {};
      for (const evidence of ANGEL_PROVIDER_FREE_EXPECTED_LAYERS_V1.slice(1)) {
        const part = evidence.proposal;
        const extracted = await extractLayerWithSamBoxPrompt({
          request: { sourceAsset: expected, part, trimTransparentPixels: true },
          normalizedPng: normalized.bytes,
          requestId: randomUUID(),
          workspaceId: randomUUID(),
          jobId: randomUUID(),
          attemptId: randomUUID(),
          sam: fake.adapter,
        });
        foreground[part.partKey] = extracted.layer.bytes;
      }
      if (
        fake.getCallCount() !== 3 ||
        fake.networkCalls !== 0 ||
        fake.executionIdentity.kind !== 'deterministic-fake' ||
        fake.executionIdentity.notice !== 'NOT_SAM_OUTPUT'
      )
        throw new TypeError('Deterministic Angel SAM accounting drifted.');
      return materializeProviderFreeAngelForegroundProjectV1(foreground);
    })().catch((error) => {
      angelMaterializationPromise = null;
      throw error;
    });
    return angelMaterializationPromise;
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
