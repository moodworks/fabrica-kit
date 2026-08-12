import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { extractLayerWithSamBoxPrompt } from '../src/server/sam-box-prompt-layer-extraction.js';
import { postprocessSamMasks } from '../src/sam/sam-mask-postprocess.js';
import {
  SamMaskResponseSchema,
  type SamMaskRequest,
  type SamMaskResponse,
} from '../src/sam/sam-mask-contracts.js';
import { canonicalResponseSha256 } from '../src/sam/sam-mask-rle.js';
import { parseAndVerifySamMaskResponse } from '../src/sam/sam-mask-validation.js';

const png = readFileSync(
  join(import.meta.dirname, 'fixtures/real-model-benchmark/normalized/banner-no-text-v1.png'),
);
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const ids = {
  requestId: '684173c2-7a85-4703-b99f-000000000001',
  workspaceId: '684173c2-7a85-4703-b99f-000000000002',
  jobId: '684173c2-7a85-4703-b99f-000000000003',
  attemptId: '684173c2-7a85-4703-b99f-000000000004',
};

const createInput = async (source = png, trimTransparentPixels = true) => {
  const metadata = await sharp(source).metadata();
  return {
    request: {
      sourceAsset: {
        assetId: '684173c2-7a85-4703-b99f-000000000005',
        assetVersionId: '684173c2-7a85-4703-b99f-000000000006',
        sha256: sha256(source),
        mediaType: 'image/png',
        byteSize: source.byteLength,
        pixelWidth: metadata.width,
        pixelHeight: metadata.height,
      },
      part: {
        partKey: 'subject',
        label: 'Subject',
        role: 'subject',
        bounds: { xBps: 100, yBps: 200, widthBps: 5000, heightBps: 6000 },
      },
      trimTransparentPixels,
    },
    normalizedPng: Uint8Array.from(source),
    ...ids,
  } as const;
};

const fakeSam = (calls: SamMaskRequest[], empty = false) => ({
  async generate(request: SamMaskRequest) {
    calls.push(request);
    const mask = new Uint8Array(request.source.width * request.source.height);
    mask[request.source.width + 1] = 1;
    const candidates = empty
      ? []
      : postprocessSamMasks(request, [{ mask, predictedIou: 0.9, stabilityScore: 0.9 }]).candidates;
    const responseBase: Omit<SamMaskResponse, 'responseSha256'> = {
      contractVersion: 'sam-mask-v2',
      requestId: request.requestId,
      workspaceId: request.workspaceId,
      jobId: request.jobId,
      attemptId: request.attemptId,
      sourceSha256: request.source.sha256,
      executionIdentity: {
        kind: 'deterministic-fake',
        engineId: 'box-test-fake',
        definitionSha256: 'a'.repeat(64),
        notice: 'NOT_SAM_OUTPUT',
      },
      timing: { inferenceMs: 0, totalMs: 0 },
      filterSummary: {
        rawCandidateCount: empty ? 0 : 1,
        exactDuplicateFiltered: 0,
        tinyFiltered: 0,
        fullCanvasFiltered: 0,
        rleTooLargeFiltered: 0,
        rleBudgetFiltered: 0,
        candidateLimitFiltered: 0,
        returnedCandidateCount: candidates.length,
      },
      candidateCount: candidates.length,
      candidates,
    };
    const response: SamMaskResponse = {
      ...responseBase,
      responseSha256: canonicalResponseSha256(responseBase),
    };
    return parseAndVerifySamMaskResponse({
      response: SamMaskResponseSchema.parse(response),
      request,
      expectedExecutionKind: 'deterministic-fake',
    });
  },
});

describe('SAM box-prompt layer extraction', () => {
  it('dispatches one exact box prompt and materializes the first candidate', async () => {
    const calls: SamMaskRequest[] = [];
    const input = await createInput();
    const result = await extractLayerWithSamBoxPrompt({ ...input, sam: fakeSam(calls) });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.segmentation).toEqual({
      mode: 'box-prompt',
      prompt: {
        kind: 'box',
        authority: 'server-validated-detector',
        box: input.request.part.bounds,
      },
    });
    expect(result.part).toEqual(input.request.part);
    expect(result.layer.mediaType).toBe('image/png');
  });

  it('fails before dispatch for source mismatch, trim=false, and zero candidates', async () => {
    const calls: SamMaskRequest[] = [];
    const input = await createInput();
    await expect(
      extractLayerWithSamBoxPrompt({
        ...input,
        request: { ...input.request, sourceAsset: { ...input.request.sourceAsset, byteSize: 1 } },
        sam: fakeSam(calls),
      }),
    ).rejects.toThrow();
    await expect(
      extractLayerWithSamBoxPrompt({ ...(await createInput(png, false)), sam: fakeSam(calls) }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
    await expect(
      extractLayerWithSamBoxPrompt({ ...input, sam: fakeSam(calls, true) }),
    ).rejects.toThrow('no canonical mask candidates');
    expect(calls).toHaveLength(1);
  });

  it('fails closed for a schema-valid but strictly unvalidated response', async () => {
    const input = await createInput();
    const validatedFake = fakeSam([]);
    const unvalidatedSam = {
      async generate(request: SamMaskRequest): Promise<SamMaskResponse> {
        const response = await validatedFake.generate(request);
        return { ...response };
      },
    };
    await expect(extractLayerWithSamBoxPrompt({ ...input, sam: unvalidatedSam })).rejects.toThrow(
      'not strictly validated',
    );
  });

  it('rejects invalid caller identity before dispatch', async () => {
    const calls: SamMaskRequest[] = [];
    const input = await createInput();
    await expect(
      extractLayerWithSamBoxPrompt({ ...input, requestId: 'not-a-uuid', sam: fakeSam(calls) }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
