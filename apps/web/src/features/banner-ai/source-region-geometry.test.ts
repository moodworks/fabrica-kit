import { describe, expect, it } from 'vitest';
import { sourceCropFromDisplayDrag } from './source-region-geometry';
describe('source region geometry', () => {
  it('maps display pixels to clamped integer source pixels', () => {
    expect(
      sourceCropFromDisplayDrag(
        { x: -2, y: 10 },
        { x: 60, y: 50 },
        { width: 100, height: 100 },
        { width: 200, height: 100 },
      ),
    ).toEqual({ left: 0, top: 10, width: 120, height: 40 });
    expect(
      sourceCropFromDisplayDrag(
        { x: 4, y: 4 },
        { x: 4, y: 4 },
        { width: 100, height: 100 },
        { width: 100, height: 100 },
      ),
    ).toBeNull();
  });
});
