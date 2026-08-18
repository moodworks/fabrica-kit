import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import {
  createBoundedLayerPreview,
  createDeterministicSamBoxPromptAdapter,
  extractLayerWithSamBoxPrompt,
  materializeProviderFreePersonSamCandidateProjectV1,
  materializeProviderFreePersonSamReplayProjectV1,
  PROVIDER_FREE_PERSON_SAM_CANDIDATES_V1,
  PROVIDER_FREE_PERSON_SAM_REPLAY_EVIDENCE_V1,
  validateProviderFreePersonSamReplayEvidenceV1,
} from '../src/server/sam-box-prompt-layer-extraction.js';
import { postprocessSamMasks } from '../src/sam/sam-mask-postprocess.js';
import { assertCanonicalNormalizedPng } from '../src/security/raster-container.js';
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
    expectedExecutionKind: 'deterministic-fake',
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
  it('exposes deeply frozen pinned replay evidence and rejects every major tamper class', () => {
    const evidence = PROVIDER_FREE_PERSON_SAM_REPLAY_EVIDENCE_V1;
    expect(Object.isFrozen(evidence)).toBe(true);
    expect(Object.isFrozen(evidence.fixture)).toBe(true);
    expect(Object.isFrozen(evidence.fixture.requestIdentifiers)).toBe(true);
    expect(Object.isFrozen(evidence.candidate.mask)).toBe(true);
    expect(Object.isFrozen(validateProviderFreePersonSamReplayEvidenceV1(evidence))).toBe(true);

    const tampered = [
      ['manifest', ['manifestSha256'], '0'.repeat(64)],
      ['validated', ['validatedResponseSha256'], '0'.repeat(64)],
      ['sanitized', ['sanitizedResponseSha256'], '0'.repeat(64)],
      ['classification', ['outputClassification'], 'not-sam-output'],
      ['fixture', ['fixture', 'sourceSha256'], '0'.repeat(64)],
      ['request', ['fixture', 'requestIdentifiers', 'requestId'], ids.requestId],
      ['execution', ['executionIdentity', 'repositoryCommit'], '0'.repeat(40)],
      ['candidate order', ['candidateOrder'], 4],
      ['candidate score', ['candidate', 'predictedIouBps'], 1],
      ['candidate flags', ['candidate', 'reviewFlags'], []],
      ['candidate mask', ['candidate', 'mask', 'sha256'], '0'.repeat(64)],
      ['cutout', ['cutout', 'sha256'], '0'.repeat(64)],
    ] as const;
    for (const [, path, value] of tampered) {
      const copy = structuredClone(evidence) as Record<string, unknown>;
      let target: Record<string, unknown> = copy;
      for (const key of path.slice(0, -1)) {
        const child = target[key];
        if (child === null || typeof child !== 'object')
          throw new TypeError('Invalid tamper path.');
        target = child as Record<string, unknown>;
      }
      target[path[path.length - 1]!] = value;
      expect(() => validateProviderFreePersonSamReplayEvidenceV1(copy)).toThrow();
    }
  });

  it('memoizes the verified person SAM replay project with extracted foreground assets', async () => {
    const [first, second] = await Promise.all([
      materializeProviderFreePersonSamReplayProjectV1(),
      materializeProviderFreePersonSamReplayProjectV1(),
    ]);
    expect(first).toBe(second);
    expect(first.assets).toHaveLength(2);
    expect(first.scene.layers).toHaveLength(1);
    expect(first.scene.layers.map((layer) => layer.name)).toEqual(['banner-person-v1 subject']);
    expect(first.scene.layers.map((layer) => layer.asset.sha256)).toEqual(
      first.assets.slice(1).map((asset) => asset.reference.sha256),
    );
    expect(
      first.assets.slice(1).every((asset) => {
        const info = assertCanonicalNormalizedPng(asset.bytes);
        return info.width > 0 && info.height > 0;
      }),
    ).toBe(true);
    expect(first.scene.layers.map((layer) => layer.frame)).toEqual([
      { x: 195, y: 64, width: 54, height: 74 },
    ]);
    const legacyTintDigests = new Set([
      '5927efb1aff9e9f00f72265a6a3b744985f9b58fe0d848230fde163292e08ced',
      '7a5b4061cb1917e365442a745404a9118898eab7a292b108b470f3796b19a28a',
      'c38c7fe5e4f3f7fb11ce7487360dc97f70edf9c3cbce7355093c7087aa02eb6a',
    ]);
    expect(
      first.assets.slice(1).every((asset) => !legacyTintDigests.has(asset.reference.sha256)),
    ).toBe(true);
    await expect(materializeProviderFreePersonSamReplayProjectV1()).resolves.toBe(first);
  });

  it('maps every preserved candidate into the letterboxed canvas without stretching cutouts', async () => {
    const materializations = await Promise.all(
      PROVIDER_FREE_PERSON_SAM_CANDIDATES_V1.map((candidate) =>
        materializeProviderFreePersonSamCandidateProjectV1(candidate.candidateId),
      ),
    );
    expect(materializations).toHaveLength(8);
    expect(materializations[0]!.scene.layers[0]!.frame).toEqual({
      x: 258,
      y: 62,
      width: 42,
      height: 26,
    });
    expect(materializations[4]!.scene.layers[0]!.frame).toEqual({
      x: 195,
      y: 64,
      width: 54,
      height: 74,
    });
    for (const materialization of materializations) {
      const frame = materialization.scene.layers[0]!.frame;
      const cutout = materialization.assets[1]!.reference;
      const scale = Math.min(300 / 876, 200 / 221);
      expect(Math.abs(frame.width - cutout.pixelWidth * scale)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(frame.height - cutout.pixelHeight * scale)).toBeLessThanOrEqual(0.5);
    }
  });
  it('uses the exact box in the deterministic adapter with one zero-network call', async () => {
    const input = await createInput();
    const fake = createDeterministicSamBoxPromptAdapter();
    const result = await extractLayerWithSamBoxPrompt({ ...input, sam: fake.adapter });
    expect(fake.getCallCount()).toBe(1);
    expect(fake.networkCalls).toBe(0);
    expect(result.candidate.bounds.xBps).toBeGreaterThanOrEqual(90);
    expect(result.candidate.bounds.xBps).toBeLessThanOrEqual(110);
    expect(result.candidate.bounds.yBps).toBeGreaterThanOrEqual(190);
    expect(result.candidate.bounds.yBps).toBeLessThanOrEqual(210);
  });

  it('creates bounded canonical previews and rejects malformed input', async () => {
    const input = await createInput();
    const fake = createDeterministicSamBoxPromptAdapter();
    const result = await extractLayerWithSamBoxPrompt({
      ...input,
      attemptId: '684173c2-7a85-4703-b99f-000000000007',
      sam: fake.adapter,
    });
    const preview = await createBoundedLayerPreview(result.layer.bytes);
    expect(preview.byteSize).toBeLessThanOrEqual(524_288);
    expect(preview.pixelWidth).toBeLessThanOrEqual(160);
    expect(preview.dataUrl).toMatch(/^data:image\/png;base64,/);
    await expect(createBoundedLayerPreview(Uint8Array.of(1, 2, 3))).rejects.toThrow();
  });

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
