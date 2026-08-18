export interface MarqueeRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface MarqueeCandidate {
  readonly candidateId: string;
  readonly order: number;
  readonly crop: MarqueeRect;
}

export const clampMarqueePoint = (
  point: { x: number; y: number },
  width: number,
  height: number,
) => ({
  x: Math.max(0, Math.min(width, point.x)),
  y: Math.max(0, Math.min(height, point.y)),
});

export const marqueeRectFromPoints = (
  start: { x: number; y: number },
  end: { x: number; y: number },
): MarqueeRect => ({
  left: Math.min(start.x, end.x),
  top: Math.min(start.y, end.y),
  width: Math.abs(end.x - start.x),
  height: Math.abs(end.y - start.y),
});

export const hasPositiveAreaIntersection = (a: MarqueeRect, b: MarqueeRect): boolean =>
  Math.min(a.left + a.width, b.left + b.width) > Math.max(a.left, b.left) &&
  Math.min(a.top + a.height, b.top + b.height) > Math.max(a.top, b.top);

export const selectMarqueeCandidates = (
  marquee: MarqueeRect,
  candidates: readonly MarqueeCandidate[],
  stageWidth: number,
  stageHeight: number,
  sourceWidth = stageWidth,
  sourceHeight = stageHeight,
): readonly string[] => {
  const scaleX = stageWidth / Math.max(1, sourceWidth);
  const scaleY = stageHeight / Math.max(1, sourceHeight);
  return candidates
    .filter((candidate) =>
      hasPositiveAreaIntersection(marquee, {
        left: candidate.crop.left * scaleX,
        top: candidate.crop.top * scaleY,
        width: candidate.crop.width * scaleX,
        height: candidate.crop.height * scaleY,
      }),
    )
    .sort((a, b) => a.order - b.order)
    .map((candidate) => candidate.candidateId);
};
