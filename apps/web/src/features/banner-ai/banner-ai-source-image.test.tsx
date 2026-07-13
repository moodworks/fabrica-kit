import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { sampleBannerAnalysisData } from './banner-ai.test-fixtures';
import type { BannerAnalysisData } from './banner-ai-contract';
import { bannerLayerReviewReducer, createBannerLayerReviewState } from './banner-ai-layer-state';
import { BannerAiSourceImage } from './banner-ai-source-image';
import type { SelectedBannerUpload } from './banner-ai-state';

const selection: SelectedBannerUpload = {
  filename: 'angel.png',
  mediaType: 'image/png',
  originalByteSize: 123,
  previewUrl: 'blob:angel',
  width: 300,
  height: 250,
};

describe('provider-free fixture source annotation', () => {
  it('positions selected replay bounds inside the shrink-wrapped source image box', () => {
    let review = createBannerLayerReviewState(sampleBannerAnalysisData);
    review = bannerLayerReviewReducer(review, { type: 'select', partKey: 'wing.left' });
    review = bannerLayerReviewReducer(review, {
      type: 'set_included',
      partKey: 'wing.left',
      included: false,
    });
    review = bannerLayerReviewReducer(review, {
      type: 'set_visible',
      partKey: 'wing.left',
      visible: false,
    });

    const markup = renderToStaticMarkup(
      createElement(BannerAiSourceImage, {
        selection,
        result: sampleBannerAnalysisData,
        review,
      }),
    );

    expect(markup).toContain('<div class="source-image-box">');
    expect(markup).toContain('src="blob:angel"');
    expect(markup).toContain('class="fixture-bounds-rectangle"');
    expect(markup).toContain('left:5%;top:18%;width:35%;height:60%');
    expect(markup).toContain('Replayed provider-free fixture bounds: Left wing.');
    expect(markup).toContain('Review controls do not alter or extract pixels.');
    expect(markup).toContain('not a cutout, extracted imagery, or a scene preview');
    expect(markup).not.toContain('<iframe');
    expect(markup).not.toContain('srcdoc');
  });

  it('omits annotation when the active digest or displayed dimensions do not match', () => {
    const review = createBannerLayerReviewState(sampleBannerAnalysisData);
    const otherResult: BannerAnalysisData = {
      ...sampleBannerAnalysisData,
      source: { ...sampleBannerAnalysisData.source, sha256: 'c'.repeat(64) },
    };

    const digestMismatch = renderToStaticMarkup(
      createElement(BannerAiSourceImage, { selection, result: otherResult, review }),
    );
    const dimensionMismatch = renderToStaticMarkup(
      createElement(BannerAiSourceImage, {
        selection: { ...selection, width: selection.width + 1 },
        result: sampleBannerAnalysisData,
        review,
      }),
    );

    for (const markup of [digestMismatch, dimensionMismatch]) {
      expect(markup).not.toContain('fixture-bounds-rectangle');
      expect(markup).not.toContain('fixture-annotation-note');
    }
  });
});
