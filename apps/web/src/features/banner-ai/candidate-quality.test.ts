import { describe, expect, it } from 'vitest';

import { partitionUploadedCandidates } from './candidate-quality';

describe('uploaded candidate quality partition', () => {
  it('keeps catalog order and partitions the strict 0.5% boundary exactly once', () => {
    const candidates = [998, 49, 60, 73, 50, 100, 20, 27, 10, 21].map((areaRatioBps) => ({
      areaRatioBps,
    }));
    const result = partitionUploadedCandidates(candidates);
    expect(result.suggested.map((candidate) => candidate.areaRatioBps)).toEqual([
      998, 60, 73, 50, 100,
    ]);
    expect(result.smallFragments.map((candidate) => candidate.areaRatioBps)).toEqual([
      49, 20, 27, 10, 21,
    ]);
    expect([...result.suggested, ...result.smallFragments]).toHaveLength(candidates.length);
  });
});
