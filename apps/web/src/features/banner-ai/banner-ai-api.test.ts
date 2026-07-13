import { describe, expect, it, vi } from 'vitest';

import { requestLocalFixtureAnalysis } from './banner-ai-api';
import { sampleBannerAnalysisData } from './banner-ai.test-fixtures';
import { parseBannerAnalysisEnvelope } from './banner-ai-contract';

describe('Banner AI browser transport', () => {
  it('sends only one file field and parses the browser-safe response', async () => {
    const selected = new File([new Uint8Array([1, 2, 3])], 'banner.png', {
      type: 'image/png',
    });
    const fetchImplementation = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input).toBe('/api/banner-ai/analyze');
      expect(init?.method).toBe('POST');
      expect(init?.body).toBeInstanceOf(FormData);
      const entries = [...(init?.body as FormData).entries()];
      expect(entries).toHaveLength(1);
      expect(entries[0]?.[0]).toBe('file');
      expect(entries[0]?.[1]).toBe(selected);
      return Response.json({ ok: true, data: sampleBannerAnalysisData });
    });

    await expect(requestLocalFixtureAnalysis(selected, fetchImplementation)).resolves.toEqual(
      sampleBannerAnalysisData,
    );
  });

  it('surfaces bounded server failures and rejects malformed success payloads', async () => {
    const selected = new File([new Uint8Array([1])], 'banner.png', { type: 'image/png' });
    await expect(
      requestLocalFixtureAnalysis(selected, async () =>
        Response.json(
          { ok: false, error: { code: 'RASTER_MAGIC_MISMATCH', message: 'Invalid PNG bytes.' } },
          { status: 400 },
        ),
      ),
    ).rejects.toThrow('Invalid PNG bytes.');
    await expect(
      requestLocalFixtureAnalysis(selected, async () =>
        Response.json({ ok: true, data: { proposal: { parts: [] } } }),
      ),
    ).rejects.toThrow('response was not valid');
  });

  it('requires provider-free provenance and a string zero-cost identity', () => {
    expect(() =>
      parseBannerAnalysisEnvelope({
        ok: true,
        data: {
          ...sampleBannerAnalysisData,
          provenance: { ...sampleBannerAnalysisData.provenance, external: true },
        },
      }),
    ).toThrow('External-call flag');
    expect(() =>
      parseBannerAnalysisEnvelope({
        ok: true,
        data: {
          ...sampleBannerAnalysisData,
          provenance: { ...sampleBannerAnalysisData.provenance, estimatedCostMicros: 0n },
        },
      }),
    ).toThrow('Estimated cost');
  });
});
