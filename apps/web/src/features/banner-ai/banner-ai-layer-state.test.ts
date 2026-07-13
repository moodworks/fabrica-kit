import { describe, expect, it } from 'vitest';

import { sampleBannerAnalysisData } from './banner-ai.test-fixtures';
import type { BannerAnalysisData } from './banner-ai-contract';
import {
  bannerLayerReviewReducer,
  createBannerLayerReviewState,
  getSelectedBannerLayerReview,
  getSelectedFixtureBoundsAnnotation,
} from './banner-ai-layer-state';

const withParts = (
  parts: BannerAnalysisData['proposal']['parts'],
  source: Partial<BannerAnalysisData['source']> = {},
): BannerAnalysisData => ({
  ...sampleBannerAnalysisData,
  source: { ...sampleBannerAnalysisData.source, ...source },
  proposal: { ...sampleBannerAnalysisData.proposal, parts },
});

describe('provider-free fixture layer review state', () => {
  it('initializes one selected part with inclusion everywhere and visibility where applicable', () => {
    const state = createBannerLayerReviewState(sampleBannerAnalysisData);

    expect(state).toEqual({
      sourceSha256: sampleBannerAnalysisData.source.sha256,
      selectedPartKey: 'background',
      parts: [
        { partKey: 'background', included: true, visible: null },
        { partKey: 'angel.body', included: true, visible: true },
        { partKey: 'wing.left', included: true, visible: true },
        { partKey: 'wing.right', included: true, visible: true },
      ],
    });
    expect(Object.isFrozen(state)).toBe(true);
    expect(Object.isFrozen(state.parts)).toBe(true);
    expect(state.parts.every(Object.isFrozen)).toBe(true);
  });

  it('selects exactly one part even when that part is excluded and hidden', () => {
    let state = createBannerLayerReviewState(sampleBannerAnalysisData);
    state = bannerLayerReviewReducer(state, {
      type: 'set_included',
      partKey: 'wing.left',
      included: false,
    });
    state = bannerLayerReviewReducer(state, {
      type: 'set_visible',
      partKey: 'wing.left',
      visible: false,
    });
    state = bannerLayerReviewReducer(state, { type: 'select', partKey: 'wing.left' });

    expect(state.selectedPartKey).toBe('wing.left');
    expect(getSelectedBannerLayerReview(sampleBannerAnalysisData, state)).toMatchObject({
      part: { partKey: 'wing.left' },
      state: { partKey: 'wing.left', included: false, visible: false },
    });

    state = bannerLayerReviewReducer(state, { type: 'select', partKey: 'wing.right' });
    expect(state.selectedPartKey).toBe('wing.right');
  });

  it('sets inclusion independently for every proposed part', () => {
    let state = createBannerLayerReviewState(sampleBannerAnalysisData);
    for (const part of sampleBannerAnalysisData.proposal.parts) {
      state = bannerLayerReviewReducer(state, {
        type: 'set_included',
        partKey: part.partKey,
        included: false,
      });
    }

    expect(state.parts.map((part) => [part.partKey, part.included])).toEqual([
      ['background', false],
      ['angel.body', false],
      ['wing.left', false],
      ['wing.right', false],
    ]);
  });

  it('retains independent visibility when inclusion changes', () => {
    const initial = createBannerLayerReviewState(sampleBannerAnalysisData);
    const hidden = bannerLayerReviewReducer(initial, {
      type: 'set_visible',
      partKey: 'angel.body',
      visible: false,
    });
    const excluded = bannerLayerReviewReducer(hidden, {
      type: 'set_included',
      partKey: 'angel.body',
      included: false,
    });
    const includedAgain = bannerLayerReviewReducer(excluded, {
      type: 'set_included',
      partKey: 'angel.body',
      included: true,
    });

    expect(includedAgain.parts.find((part) => part.partKey === 'angel.body')).toEqual({
      partKey: 'angel.body',
      included: true,
      visible: false,
    });
  });

  it('keeps background visibility N/A and invalid targets as exact identity no-ops', () => {
    const state = createBannerLayerReviewState(sampleBannerAnalysisData);

    expect(
      bannerLayerReviewReducer(state, {
        type: 'set_visible',
        partKey: 'background',
        visible: false,
      }),
    ).toBe(state);
    expect(bannerLayerReviewReducer(state, { type: 'select', partKey: 'missing' })).toBe(state);
    expect(
      bannerLayerReviewReducer(state, {
        type: 'set_included',
        partKey: 'missing',
        included: false,
      }),
    ).toBe(state);
    expect(
      bannerLayerReviewReducer(state, {
        type: 'set_visible',
        partKey: 'missing',
        visible: false,
      }),
    ).toBe(state);
  });

  it('rejects empty proposals, blank keys, and duplicate keys', () => {
    expect(() => createBannerLayerReviewState(withParts([]))).toThrow('at least one');
    expect(() =>
      createBannerLayerReviewState(
        withParts([{ ...sampleBannerAnalysisData.proposal.parts[0]!, partKey: '' }]),
      ),
    ).toThrow('non-empty');
    expect(() =>
      createBannerLayerReviewState(
        withParts([
          sampleBannerAnalysisData.proposal.parts[0]!,
          { ...sampleBannerAnalysisData.proposal.parts[1]!, partKey: 'background' },
        ]),
      ),
    ).toThrow('unique');
  });

  it('guards annotations by active digest and matching displayed dimensions without mutation', () => {
    const review = createBannerLayerReviewState(sampleBannerAnalysisData);
    const dimensions = {
      width: sampleBannerAnalysisData.source.width,
      height: sampleBannerAnalysisData.source.height,
    };

    const selected = getSelectedFixtureBoundsAnnotation({
      result: sampleBannerAnalysisData,
      review,
      displayedSource: dimensions,
    });
    expect(selected?.part.partKey).toBe('background');
    expect(
      getSelectedFixtureBoundsAnnotation({
        result: withParts(sampleBannerAnalysisData.proposal.parts, { sha256: 'c'.repeat(64) }),
        review,
        displayedSource: dimensions,
      }),
    ).toBeNull();
    expect(
      getSelectedFixtureBoundsAnnotation({
        result: sampleBannerAnalysisData,
        review,
        displayedSource: { ...dimensions, width: dimensions.width + 1 },
      }),
    ).toBeNull();
    expect(review).toBe(review);
    expect(Object.isFrozen(review)).toBe(true);
  });
});
