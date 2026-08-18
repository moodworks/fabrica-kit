import { describe, expect, it, vi } from 'vitest';

import { requestLocalFixtureAnalysis } from './banner-ai-api';
import { sampleBannerAnalysisData } from './banner-ai.test-fixtures';
import { parseBannerAnalysisEnvelope } from './banner-ai-contract';

/* eslint-disable @typescript-eslint/no-explicit-any -- compact immutable mutation table */

describe('Banner AI browser transport', () => {
  it.each([
    [
      'source',
      (data: any) => {
        data.source.extra = true;
      },
    ],
    [
      'part',
      (data: any) => {
        data.proposal.parts[0].extra = true;
      },
    ],
    [
      'bounds',
      (data: any) => {
        data.proposal.parts[0].bounds.extra = true;
      },
    ],
    [
      'provenance',
      (data: any) => {
        data.provenance.extra = true;
      },
    ],
    [
      'fixture',
      (data: any) => {
        data.provenance.fixture.extra = true;
      },
    ],
    [
      'workflow',
      (data: any) => {
        data.provenance.workflow.extra = true;
      },
    ],
    [
      'ownership',
      (data: any) => {
        data.provenance.ownership.extra = true;
      },
    ],
    [
      'success envelope',
      (data: any) => {
        data.extra = true;
      },
    ],
  ])('rejects nested extra %s key', (_label, mutate) => {
    const data = structuredClone(sampleBannerAnalysisData) as any;
    mutate(data);
    expect(() => parseBannerAnalysisEnvelope({ ok: true, data })).toThrow();
  });

  it('rejects extra error-envelope keys', () => {
    expect(() =>
      parseBannerAnalysisEnvelope({ ok: false, error: { code: 'X', message: 'x', extra: true } }),
    ).toThrow();
    expect(() =>
      parseBannerAnalysisEnvelope({ ok: false, error: { code: 'X', message: 'x' }, extra: true }),
    ).toThrow();
  });
  it.each([
    [
      'extra data key',
      (data: any) => {
        data.extra = true;
      },
    ],
    [
      'extra extraction key',
      (data: any) => {
        data.extraction.extra = true;
      },
    ],
    [
      'extra preview key',
      (data: any) => {
        data.extraction.previews[0].extra = true;
      },
    ],
    [
      'duplicate proposal key',
      (data: any) => {
        data.proposal.parts[1].partKey = data.proposal.parts[0].partKey;
      },
    ],
    [
      'duplicate preview key',
      (data: any) => {
        data.extraction.previews[1].partKey = data.extraction.previews[0].partKey;
      },
    ],
    [
      'foreign preview key',
      (data: any) => {
        data.extraction.previews[0].partKey = 'foreign';
      },
    ],
    [
      'background preview key',
      (data: any) => {
        data.extraction.previews[0].partKey = 'background';
      },
    ],
    [
      'mismatched byte size',
      (data: any) => {
        data.extraction.previews[0].byteSize = 1;
      },
    ],
    [
      'oversized dimensions',
      (data: any) => {
        data.extraction.previews[0].pixelWidth = 161;
      },
    ],
    [
      'malformed signature',
      (data: any) => {
        data.extraction.previews[0].dataUrl = 'data:image/png;base64,AA==';
      },
    ],
    [
      'IHDR mismatch',
      (data: any) => {
        data.extraction.previews[0].pixelWidth = 2;
      },
    ],
  ])('rejects %s', (_label, mutate) => {
    const data = structuredClone(sampleBannerAnalysisData) as any;
    mutate(data);
    expect(() => parseBannerAnalysisEnvelope({ ok: true, data })).toThrow();
  });
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
