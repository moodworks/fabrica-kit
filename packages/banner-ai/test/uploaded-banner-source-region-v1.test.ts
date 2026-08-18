import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { materializeUploadedSourceRegionV1 } from '../src/server/uploaded-banner-source-region-v1';

describe('uploaded source-region materialization', () => {
  it('preserves every requested source RGBA pixel', async () => {
    const pixels = Buffer.from(
      Array.from({ length: 4 * 3 * 4 }, (_, index) => (index * 17 + 3) % 256),
    );
    const source = Uint8Array.from(
      await sharp(pixels, { raw: { width: 4, height: 3, channels: 4 } })
        .png()
        .toBuffer(),
    );
    const output = await materializeUploadedSourceRegionV1({
      source,
      crop: { left: 0, top: 0, width: 3, height: 2 },
      sourceWidth: 4,
      sourceHeight: 3,
    });
    const actual = await sharp(output).raw().toBuffer();
    const expected = Buffer.alloc(3 * 2 * 4);
    for (let row = 0; row < 2; row++)
      pixels.copy(expected, row * 3 * 4, row * 4 * 4, row * 4 * 4 + 3 * 4);
    expect(actual).toEqual(expected);
  });
});
