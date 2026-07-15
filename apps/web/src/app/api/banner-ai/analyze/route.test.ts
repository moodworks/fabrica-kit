import { describe, expect, it, vi } from 'vitest';

import { parseBannerAnalysisEnvelope } from '../../../../features/banner-ai/banner-ai-contract';
import { createRasterFile } from '../../../../server/banner-ai/raster.test-fixtures';
import { POST } from './route';

const postForm = (formData: FormData): Promise<Response> =>
  POST(
    new Request('http://localhost/api/banner-ai/analyze', {
      method: 'POST',
      body: formData,
    }),
  );

describe('POST /api/banner-ai/analyze', () => {
  it('authoritatively validates and analyzes one supported upload', async () => {
    const outboundFetch = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('The existing analyze route attempted forbidden outbound network access.');
    });
    const formData = new FormData();
    formData.append('file', createRasterFile('png'));

    try {
      const response = await postForm(formData);
      expect(response.status).toBe(200);
      const envelope = parseBannerAnalysisEnvelope(await response.json());
      expect(envelope.ok).toBe(true);
      if (!envelope.ok) throw new Error('Expected successful analysis response.');
      expect(envelope.data.proposal.parts.map((part) => part.label)).toEqual([
        'Background',
        'Angel body',
        'Left wing',
        'Right wing',
      ]);
      expect(envelope.data.provenance).toMatchObject({
        external: false,
        outboundNetworkEnabled: false,
        estimatedCostMicros: '0',
        ownership: { mode: 'development-local' },
      });
      expect(outboundFetch).not.toHaveBeenCalled();
    } finally {
      outboundFetch.mockRestore();
    }
  });

  it('returns a clear trusted-boundary error for invalid raster bytes', async () => {
    const formData = new FormData();
    formData.append(
      'file',
      new File([new Uint8Array([1, 2, 3])], 'not-really.png', { type: 'image/png' }),
    );

    const response = await postForm(formData);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'RASTER_MAGIC_MISMATCH',
        message: expect.stringContaining('PNG signature'),
      },
    });
  });

  it('rejects a missing file', async () => {
    const response = await postForm(new FormData());
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_UPLOAD_FORM', message: expect.stringContaining('exactly one') },
    });
  });

  it('rejects multiple files before analysis', async () => {
    const formData = new FormData();
    formData.append('file', createRasterFile('png'));
    formData.append('file', createRasterFile('jpeg'));

    const response = await postForm(formData);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_UPLOAD_FORM', message: expect.stringContaining('exactly one') },
    });
  });

  it.each(['actorId', 'workspaceId', 'requestId', 'unexpected'])(
    'rejects the extra %s field so authority stays server-owned',
    async (field) => {
      const formData = new FormData();
      formData.append('file', createRasterFile('png'));
      formData.append(field, 'client-controlled-value');

      const response = await postForm(formData);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'INVALID_UPLOAD_FORM',
          message: expect.stringContaining('server-owned'),
        },
      });
    },
  );

  it.each(['benchmarkProfile', 'benchmarkAuthorization', 'benchmarkActivation'])(
    'rejects the extra %s field so the web route cannot activate a real-model benchmark',
    async (field) => {
      const formData = new FormData();
      formData.append('file', createRasterFile('png'));
      formData.append(field, 'synthetic.invalid');

      const response = await postForm(formData);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'INVALID_UPLOAD_FORM',
          message: expect.stringContaining('Only the file field'),
        },
      });
    },
  );

  it('rejects a text value in the file field', async () => {
    const formData = new FormData();
    formData.append('file', 'not-a-file');

    const response = await postForm(formData);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_UPLOAD_FORM', message: expect.stringContaining('uploaded file') },
    });
  });
});
