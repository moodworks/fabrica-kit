import type { BannerAnalysisData, BannerAnalysisPart } from './banner-ai-contract';

export interface BannerLayerReviewPartState {
  readonly partKey: string;
  readonly included: boolean;
  readonly visible: boolean | null;
}

export interface BannerLayerReviewState {
  readonly sourceSha256: string;
  readonly selectedPartKey: string;
  readonly parts: readonly BannerLayerReviewPartState[];
}

export type BannerLayerReviewEvent =
  | { readonly type: 'select'; readonly partKey: string }
  | { readonly type: 'set_included'; readonly partKey: string; readonly included: boolean }
  | { readonly type: 'set_visible'; readonly partKey: string; readonly visible: boolean };

export interface SelectedBannerLayerReview {
  readonly part: BannerAnalysisPart;
  readonly state: BannerLayerReviewPartState;
}

export interface BannerSourceDisplayDimensions {
  readonly width: number;
  readonly height: number;
}

const freezePartState = (part: BannerLayerReviewPartState): BannerLayerReviewPartState =>
  Object.freeze(part);

const freezeReviewState = (state: BannerLayerReviewState): BannerLayerReviewState =>
  Object.freeze({ ...state, parts: Object.freeze([...state.parts]) });

export const createBannerLayerReviewState = (
  result: BannerAnalysisData,
): BannerLayerReviewState => {
  if (result.proposal.parts.length < 1) {
    throw new TypeError('A provider-free fixture review requires at least one proposed part.');
  }

  const partKeys = new Set<string>();
  const parts = result.proposal.parts.map((part) => {
    if (part.partKey.length < 1) {
      throw new TypeError('Provider-free fixture review part keys must be non-empty.');
    }
    if (partKeys.has(part.partKey)) {
      throw new TypeError('Provider-free fixture review part keys must be unique.');
    }
    partKeys.add(part.partKey);
    return freezePartState({
      partKey: part.partKey,
      included: true,
      visible: part.role === 'background' ? null : true,
    });
  });

  return freezeReviewState({
    sourceSha256: result.source.sha256,
    selectedPartKey: result.proposal.parts[0]!.partKey,
    parts,
  });
};

export const bannerLayerReviewReducer = (
  state: BannerLayerReviewState,
  event: BannerLayerReviewEvent,
): BannerLayerReviewState => {
  const partIndex = state.parts.findIndex((part) => part.partKey === event.partKey);
  if (partIndex < 0) return state;

  const currentPart = state.parts[partIndex]!;
  if (event.type === 'select') {
    return state.selectedPartKey === event.partKey
      ? state
      : freezeReviewState({ ...state, selectedPartKey: event.partKey });
  }

  if (event.type === 'set_visible' && currentPart.visible === null) return state;
  const nextValue = event.type === 'set_included' ? event.included : event.visible;
  const currentValue = event.type === 'set_included' ? currentPart.included : currentPart.visible;
  if (currentValue === nextValue) return state;

  const nextPart =
    event.type === 'set_included'
      ? freezePartState({ ...currentPart, included: event.included })
      : freezePartState({ ...currentPart, visible: event.visible });
  const parts = state.parts.map((part, index) => (index === partIndex ? nextPart : part));
  return freezeReviewState({ ...state, parts });
};

export const getSelectedBannerLayerReview = (
  result: BannerAnalysisData | null,
  review: BannerLayerReviewState | null,
): SelectedBannerLayerReview | null => {
  if (result === null || review === null || review.sourceSha256 !== result.source.sha256) {
    return null;
  }

  const state = review.parts.find((part) => part.partKey === review.selectedPartKey);
  const part = result.proposal.parts.find(
    (candidate) => candidate.partKey === review.selectedPartKey,
  );
  return state === undefined || part === undefined ? null : { part, state };
};

export const getSelectedFixtureBoundsAnnotation = (input: {
  readonly result: BannerAnalysisData | null;
  readonly review: BannerLayerReviewState | null;
  readonly displayedSource: BannerSourceDisplayDimensions;
}): SelectedBannerLayerReview | null => {
  const selected = getSelectedBannerLayerReview(input.result, input.review);
  if (
    selected === null ||
    input.result === null ||
    input.displayedSource.width !== input.result.source.width ||
    input.displayedSource.height !== input.result.source.height
  ) {
    return null;
  }
  return selected;
};
