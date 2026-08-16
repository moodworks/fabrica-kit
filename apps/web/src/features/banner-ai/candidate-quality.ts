import type { UploadedBannerCandidate } from './banner-ai-project-api';

export const SUGGESTED_AREA_RATIO_BPS = 50;

export const partitionUploadedCandidates = <
  T extends Pick<UploadedBannerCandidate, 'areaRatioBps'>,
>(
  candidates: readonly T[],
) => {
  const suggested: T[] = [];
  const smallFragments: T[] = [];
  for (const candidate of candidates) {
    (candidate.areaRatioBps >= SUGGESTED_AREA_RATIO_BPS ? suggested : smallFragments).push(
      candidate,
    );
  }
  return { suggested, smallFragments } as const;
};
