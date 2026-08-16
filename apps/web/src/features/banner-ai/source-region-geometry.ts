export interface SourceCrop {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}
export const sourceCropFromDisplayDrag = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  display: { width: number; height: number },
  source: { width: number; height: number },
): SourceCrop | null => {
  const sx = Math.max(0, Math.min(display.width, start.x));
  const sy = Math.max(0, Math.min(display.height, start.y));
  const ex = Math.max(0, Math.min(display.width, end.x));
  const ey = Math.max(0, Math.min(display.height, end.y));
  const left = Math.min(sx, ex);
  const top = Math.min(sy, ey);
  const width = Math.abs(ex - sx);
  const height = Math.abs(ey - sy);
  if (width < 1 || height < 1 || display.width <= 0 || display.height <= 0) return null;
  return {
    left: Math.max(
      0,
      Math.min(source.width - 1, Math.floor((left / display.width) * source.width)),
    ),
    top: Math.max(
      0,
      Math.min(source.height - 1, Math.floor((top / display.height) * source.height)),
    ),
    width: Math.max(1, Math.min(source.width, Math.ceil((width / display.width) * source.width))),
    height: Math.max(
      1,
      Math.min(source.height, Math.ceil((height / display.height) * source.height)),
    ),
  };
};
