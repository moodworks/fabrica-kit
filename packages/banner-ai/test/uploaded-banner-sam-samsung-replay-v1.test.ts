import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  loadSamsungManualBoxReplay,
  createSamsungManualBoxReplayGenerator,
} from '../src/server/uploaded-banner-sam-samsung-replay-v1.js';
import { assertSamMaskResponseWasStrictlyValidated } from '../src/sam/sam-mask-validation.js';

const sourcePath = resolve(import.meta.dirname, '../../../.local-data/sam-samsung/normalized.png');
const available = existsSync(sourcePath);

describe('Samsung manual-box replay', () => {
  it.skipIf(!available)(
    'replays the exact prompt without network and rejects prompt/source drift',
    async () => {
      const source = new Uint8Array(readFileSync(sourcePath));
      const loaded = await loadSamsungManualBoxReplay(source);
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      try {
        const exactRequest = {
          ...loaded.request,
          requestId: '11111111-1111-4111-8111-111111111111',
          workspaceId: '22222222-2222-4222-8222-222222222222',
          jobId: '33333333-3333-4333-8333-333333333333',
          attemptId: '44444444-4444-4444-8444-444444444444',
        };
        const response = await createSamsungManualBoxReplayGenerator().generate(exactRequest);
        expect(response.candidateCount).toBe(1);
        expect(response.candidates[0]!.candidateId).toBe(loaded.candidates[0]!.candidateId);
        expect(() =>
          assertSamMaskResponseWasStrictlyValidated({
            response,
            request: exactRequest,
            expectedExecutionKind: 'meta-sam2.1',
          }),
        ).not.toThrow();
        expect(loaded.candidates[0]!.materialization.metadata.cutoutPngSha256).toBe(
          '1dc52701797254546be7c494119bdf2ee6076c538fff0207c3ec976a74575cb5',
        );
        expect(loaded.candidates[0]!.materialization.metadata.maskSha256).toBe(
          '7781870aab3fe7da2616ddf8b9ec891c5e778d60110f61cab2be4dc80cb07175',
        );
        expect(fetchSpy).not.toHaveBeenCalled();
        await expect(
          createSamsungManualBoxReplayGenerator().generate({
            ...loaded.request,
            segmentation: {
              ...loaded.request.segmentation,
              prompt: { ...loaded.request.segmentation.prompt, authority: 'provider' },
            },
          } as never),
        ).rejects.toThrow();
        await expect(
          createSamsungManualBoxReplayGenerator().generate({
            ...loaded.request,
            source: { ...loaded.request.source, sha256: '0'.repeat(64) },
          } as never),
        ).rejects.toThrow();
      } finally {
        fetchSpy.mockRestore();
      }
    },
  );
});
