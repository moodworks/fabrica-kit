import { describe, expect, it, vi } from 'vitest';

import { bannerAiReducer, initialBannerAiState } from './banner-ai-state';
import { inspectBrowserRasterUpload, type BrowserRasterDimensions } from './browser-upload';

const file = (name = 'banner.png', type = 'image/png', size = 3): File =>
  new File([new Uint8Array(size)], name, { type });

describe('browser raster preflight', () => {
  it.each([
    ['banner.png', 'image/png'],
    ['banner.jpg', 'image/jpeg'],
    ['banner.jpeg', 'image/jpeg'],
  ])('accepts %s after asynchronous browser decode', async (name, type) => {
    let resolveDimensions!: (value: BrowserRasterDimensions) => void;
    const decode = vi.fn(
      () =>
        new Promise<BrowserRasterDimensions>((resolve) => {
          resolveDimensions = resolve;
        }),
    );
    let state = bannerAiReducer(initialBannerAiState, {
      type: 'selection_started',
      requestRevision: 1,
    });
    const inspection = inspectBrowserRasterUpload(file(name, type), 'blob:preview', decode);

    await Promise.resolve();
    expect(state.phase).toBe('validating');
    expect(decode).toHaveBeenCalledWith('blob:preview');
    resolveDimensions({ width: 300, height: 250 });
    const selection = await inspection;
    state = bannerAiReducer(state, {
      type: 'selection_succeeded',
      requestRevision: 1,
      selection,
    });

    expect(state).toMatchObject({
      phase: 'idle',
      selection: { filename: name, mediaType: type, width: 300, height: 250 },
    });
  });

  it.each([
    [file('banner.gif', 'image/gif'), 'Choose a JPG, JPEG, or PNG file.'],
    [file('banner.jpg', 'image/png'), 'filename extension and image type do not match'],
    [file('banner.png', 'text/plain'), 'must declare image/jpeg or image/png'],
    [new File([], 'banner.png', { type: 'image/png' }), 'selected image is empty'],
    [file('bad/name.png'), 'safe plain-text filename'],
  ])('rejects invalid identity before accepting a preview %#', async (invalid, message) => {
    await expect(
      inspectBrowserRasterUpload(invalid, 'blob:invalid', async () => ({ width: 1, height: 1 })),
    ).rejects.toThrow(message);
  });

  it('reports browser decode and dimension failures clearly', async () => {
    await expect(
      inspectBrowserRasterUpload(file(), 'blob:bad', async () => {
        throw new Error('decoder detail');
      }),
    ).rejects.toThrow('browser could not decode');
    await expect(
      inspectBrowserRasterUpload(file(), 'blob:large', async () => ({
        width: 4_097,
        height: 1,
      })),
    ).rejects.toThrow('4096 × 4096');
  });
});
