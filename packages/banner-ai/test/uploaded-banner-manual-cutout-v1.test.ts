import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';

import { createDeterministicNonRectangularSamBoxPromptAdapter } from '../src/server/sam-box-prompt-layer-extraction';
import { extractUploadedManualCutoutV1 } from '../src/server/uploaded-banner-manual-cutout-v1';
import type { SamMaskRequest, SamMaskResponse } from '../src/sam/sam-mask-contracts';
import { assertCanonicalNormalizedPng } from '../src/security/raster-container';

const source = new Uint8Array(
  readFileSync(
    resolve(import.meta.dirname, 'fixtures/real-model-benchmark/normalized/banner-no-text-v1.png'),
  ),
);

describe('uploaded manual prompted cutout', () => {
  it('emits a user-interaction box with outward bounds and transparent cutout', async () => {
    const fake = createDeterministicNonRectangularSamBoxPromptAdapter();
    let request: SamMaskRequest | undefined;
    const result = await extractUploadedManualCutoutV1({
      normalizedPng: source,
      crop: { left: 3, top: 4, width: 20, height: 15 },
      requestId: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      jobId: '00000000-0000-4000-8000-000000000003',
      attemptId: '00000000-0000-4000-8000-000000000004',
      expectedExecutionKind: 'deterministic-fake',
      sam: {
        generate: async (value) => {
          request = value;
          return fake.adapter.generate(value);
        },
      },
    });
    expect(
      request?.segmentation.mode === 'box-prompt' && request.segmentation.prompt.authority,
    ).toBe('user-interaction');
    const dimensions = assertCanonicalNormalizedPng(source);
    expect(
      request?.segmentation.mode === 'box-prompt' ? request.segmentation.prompt.box : null,
    ).toEqual({
      xBps: Math.floor((3 * 10_000) / dimensions.width),
      yBps: Math.floor((4 * 10_000) / dimensions.height),
      widthBps:
        Math.ceil((23 * 10_000) / dimensions.width) - Math.floor((3 * 10_000) / dimensions.width),
      heightBps:
        Math.ceil((19 * 10_000) / dimensions.height) - Math.floor((4 * 10_000) / dimensions.height),
    });
    expect(request?.limits).toMatchObject({ maxCandidates: 1 });
    expect(result.layer.bytes.byteLength).toBeGreaterThan(0);
    const rgba = await sharp(result.layer.bytes).ensureAlpha().raw().toBuffer();
    const alpha = rgba.filter((_value, index) => index % 4 === 3);
    expect(alpha.some((value) => value === 0)).toBe(true);
    expect(alpha.some((value) => value === 255)).toBe(true);
    expect(result.bounds.xBps).toBeLessThanOrEqual(10_000);
  });

  it('fails closed for zero, multiple, and foreign execution responses', async () => {
    const fake = createDeterministicNonRectangularSamBoxPromptAdapter();
    const input = {
      normalizedPng: source,
      crop: { left: 3, top: 4, width: 20, height: 15 },
      requestId: '00000000-0000-4000-8000-000000000001',
      workspaceId: '00000000-0000-4000-8000-000000000002',
      jobId: '00000000-0000-4000-8000-000000000003',
      attemptId: '00000000-0000-4000-8000-000000000004',
      expectedExecutionKind: 'deterministic-fake' as const,
    };
    for (const mutate of [
      (response: SamMaskResponse) => ({ ...response, candidateCount: 0, candidates: [] }),
      (response: SamMaskResponse) => ({
        ...response,
        candidateCount: 2,
        candidates: [...response.candidates, response.candidates[0]!],
      }),
      (response: SamMaskResponse) =>
        ({
          ...response,
          executionIdentity: { kind: 'meta-sam2.1' as const, model: 'foreign' },
        }) as unknown as SamMaskResponse,
    ]) {
      await expect(
        extractUploadedManualCutoutV1({
          ...input,
          sam: { generate: async (request) => mutate(await fake.adapter.generate(request)) },
        }),
      ).rejects.toThrow();
    }
  });
});
