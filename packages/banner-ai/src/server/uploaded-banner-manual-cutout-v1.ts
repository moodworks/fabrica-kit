import { createHash } from 'node:crypto';

import {
  extractLayerWithSamBoxPrompt,
  type SamBoxPromptGeneratePort,
} from './sam-box-prompt-layer-extraction.js';
import { assertCanonicalNormalizedPng } from '../security/raster-container.js';

export interface ManualCutoutCropV1 {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

export const extractUploadedManualCutoutV1 = async (input: {
  readonly normalizedPng: Uint8Array;
  readonly crop: ManualCutoutCropV1;
  readonly sam: SamBoxPromptGeneratePort;
  readonly requestId: string;
  readonly workspaceId: string;
  readonly jobId: string;
  readonly attemptId: string;
  readonly expectedExecutionKind: 'deterministic-fake' | 'meta-sam2.1';
}) => {
  const dimensions = assertCanonicalNormalizedPng(input.normalizedPng);
  const { crop } = input;
  if (
    ![crop.left, crop.top, crop.width, crop.height].every(Number.isSafeInteger) ||
    crop.left < 0 ||
    crop.top < 0 ||
    crop.width < 1 ||
    crop.height < 1 ||
    crop.left + crop.width > dimensions.width ||
    crop.top + crop.height > dimensions.height
  )
    throw new TypeError('The manual cutout crop is invalid.');
  // The worker's integer round-trip convention is ceil for the leading edge and
  // floor for the trailing edge. This keeps the half-open pixel crop stable.
  const xBps = Math.ceil((crop.left * 10_000) / dimensions.width);
  const yBps = Math.ceil((crop.top * 10_000) / dimensions.height);
  const rightBps = Math.min(
    10_000,
    Math.floor(((crop.left + crop.width) * 10_000) / dimensions.width),
  );
  const bottomBps = Math.min(
    10_000,
    Math.floor(((crop.top + crop.height) * 10_000) / dimensions.height),
  );
  const extracted = await extractLayerWithSamBoxPrompt({
    normalizedPng: input.normalizedPng,
    requestId: input.requestId,
    workspaceId: input.workspaceId,
    jobId: input.jobId,
    attemptId: input.attemptId,
    promptAuthority: 'user-interaction',
    expectedExecutionKind: input.expectedExecutionKind,
    sam: input.sam,
    request: {
      sourceAsset: {
        assetId: 'asset_uploaded_source_manual',
        assetVersionId: 'asset_version_uploaded_source_manual',
        sha256: sha256(input.normalizedPng),
        mediaType: 'image/png',
        byteSize: input.normalizedPng.byteLength,
        pixelWidth: dimensions.width,
        pixelHeight: dimensions.height,
      },
      part: {
        partKey: 'manual_cutout',
        label: 'Manual cutout',
        role: 'subject',
        bounds: {
          xBps,
          yBps,
          widthBps: Math.max(1, rightBps - xBps),
          heightBps: Math.max(1, bottomBps - yBps),
        },
      },
      trimTransparentPixels: true,
    },
  });
  return {
    ...extracted,
    crop,
    promptBounds: {
      xBps,
      yBps,
      widthBps: Math.max(1, rightBps - xBps),
      heightBps: Math.max(1, bottomBps - yBps),
    },
    bounds: extracted.candidate.bounds,
  };
};
