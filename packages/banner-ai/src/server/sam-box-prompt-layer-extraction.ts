import { createHash } from 'node:crypto';

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
import { materializeSamMaskCutout } from '../sam/sam-cutout-materializer.js';
import {
  assertSamMaskResponseWasStrictlyValidated,
  parseAndVerifySamMaskResponse,
} from '../sam/sam-mask-validation.js';
import { boxBasisToPixel } from '../sam/sam-mask-rle.js';
import { createSamRunPodDirectV3Adapter } from './sam-runpod-direct-v3-adapter.js';
import {
  createDeterministicSamRunPodDirectV3Transport,
  SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
} from './sam-runpod-direct-v3-deterministic-fake-transport.js';

export const createDeterministicSamBoxPromptAdapter = () => {
  const transport = createDeterministicSamRunPodDirectV3Transport({
    rawCandidates: (request) => {
      if (request.segmentation.mode !== 'box-prompt') {
        throw new TypeError('Deterministic box adapter requires a box prompt.');
      }
      const box = boxBasisToPixel(
        request.segmentation.prompt.box,
        request.source.width,
        request.source.height,
      );
      const mask = new Uint8Array(request.source.width * request.source.height);
      for (let y = box.top; y <= box.bottomInclusive; y += 1) {
        mask.fill(
          1,
          y * request.source.width + box.left,
          y * request.source.width + box.rightInclusive + 1,
        );
      }
      return [{ mask, predictedIou: 1, stabilityScore: 1 }];
    },
  });
  const adapter = createSamRunPodDirectV3Adapter({
    endpointId: 'fake-sam-box-prompt',
    expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
    transport,
  });
  return Object.freeze({
    adapter: {
      generate: async (request: SamMaskRequest) => {
        const response = await adapter.generate(request);
        return parseAndVerifySamMaskResponse({
          response,
          request,
          expectedExecutionKind: 'deterministic-fake',
        });
      },
    },
    getCallCount: transport.getCallCount,
    networkCalls: transport.networkCalls,
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
