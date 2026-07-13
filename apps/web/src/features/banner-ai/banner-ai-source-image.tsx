import type { BannerAnalysisData } from './banner-ai-contract';
import {
  getSelectedFixtureBoundsAnnotation,
  type BannerLayerReviewState,
} from './banner-ai-layer-state';
import type { SelectedBannerUpload } from './banner-ai-state';

export interface BannerAiSourceImageProps {
  readonly selection: SelectedBannerUpload;
  readonly result: BannerAnalysisData | null;
  readonly review: BannerLayerReviewState | null;
}

const percentage = (basisPoints: number): string => `${basisPoints / 100}%`;

export function BannerAiSourceImage({ selection, result, review }: BannerAiSourceImageProps) {
  const annotation = getSelectedFixtureBoundsAnnotation({
    result,
    review,
    displayedSource: selection,
  });

  return (
    <>
      <div className="image-stage">
        <div className="source-image-box">
          {/* A local blob URL is deliberately used for an unoptimized, in-memory preview. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={selection.previewUrl}
            alt={`Preview of ${selection.filename}`}
            aria-describedby={annotation === null ? undefined : 'fixture-bounds-annotation-note'}
          />
          {annotation === null ? null : (
            <span
              className="fixture-bounds-rectangle"
              style={{
                left: percentage(annotation.part.bounds.xBps),
                top: percentage(annotation.part.bounds.yBps),
                width: percentage(annotation.part.bounds.widthBps),
                height: percentage(annotation.part.bounds.heightBps),
              }}
              aria-hidden="true"
            />
          )}
        </div>
      </div>
      {annotation === null ? null : (
        <p className="fixture-annotation-note" id="fixture-bounds-annotation-note">
          <strong>Replayed provider-free fixture bounds: {annotation.part.label}.</strong> This
          rectangle annotates fixed fixture metadata over the local source image. Review controls do
          not alter or extract pixels. It is not a cutout, extracted imagery, or a scene preview.
        </p>
      )}
    </>
  );
}
