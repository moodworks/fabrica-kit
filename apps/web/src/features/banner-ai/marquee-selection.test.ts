import { describe, expect, it } from 'vitest';

import {
  clampMarqueePoint,
  hasPositiveAreaIntersection,
  marqueeRectFromPoints,
  selectMarqueeCandidates,
} from './marquee-selection';

const candidates = [
  { candidateId: 'second', order: 2, crop: { left: 60, top: 10, width: 20, height: 20 } },
  { candidateId: 'first', order: 1, crop: { left: 10, top: 10, width: 20, height: 20 } },
] as const;

describe('marquee selection geometry', () => {
  it('normalizes reverse drags and clamps to stage bounds', () => {
    expect(marqueeRectFromPoints({ x: 90, y: 80 }, { x: 10, y: 20 })).toEqual({
      left: 10,
      top: 20,
      width: 80,
      height: 60,
    });
    expect(clampMarqueePoint({ x: -4, y: 120 }, 100, 100)).toEqual({ x: 0, y: 100 });
  });

  it('excludes edge-only contact and returns canonical catalog order', () => {
    expect(
      hasPositiveAreaIntersection({ left: 30, top: 10, width: 30, height: 20 }, candidates[0].crop),
    ).toBe(false);
    expect(
      selectMarqueeCandidates({ left: 0, top: 0, width: 100, height: 50 }, candidates, 100, 50),
    ).toEqual(['first', 'second']);
  });

  it('is independent of display scale', () => {
    const crop = { left: 10, top: 10, width: 20, height: 20 };
    expect(
      selectMarqueeCandidates(
        { left: 20, top: 20, width: 20, height: 20 },
        [{ candidateId: 'x', order: 1, crop }],
        100,
        100,
        100,
        100,
      ),
    ).toEqual(['x']);
    expect(
      selectMarqueeCandidates(
        { left: 200, top: 200, width: 200, height: 200 },
        [{ candidateId: 'x', order: 1, crop: { left: 100, top: 100, width: 200, height: 200 } }],
        1000,
        1000,
        500,
        500,
      ),
    ).toEqual(['x']);
  });
});
