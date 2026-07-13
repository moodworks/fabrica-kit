import type { BannerAnalysisData } from './banner-ai-contract';
import {
  bannerLayerReviewReducer,
  createBannerLayerReviewState,
  type BannerLayerReviewState,
} from './banner-ai-layer-state';

export type BannerAiPhase = 'idle' | 'validating' | 'running' | 'succeeded' | 'failed';

export interface SelectedBannerUpload {
  readonly filename: string;
  readonly mediaType: 'image/jpeg' | 'image/png';
  readonly originalByteSize: number;
  readonly previewUrl: string;
  readonly width: number;
  readonly height: number;
}

export interface BannerAiState {
  readonly phase: BannerAiPhase;
  readonly selection: SelectedBannerUpload | null;
  readonly result: BannerAnalysisData | null;
  readonly layerReview: BannerLayerReviewState | null;
  readonly error: { readonly source: 'validation' | 'analysis'; readonly message: string } | null;
  readonly requestRevision: number;
  readonly activeRequestRevision: number | null;
}

export interface BannerAiUploadControlCopy {
  readonly kind: 'filename' | 'status';
  readonly text: string;
}

export type BannerAiEvent =
  | { readonly type: 'selection_started'; readonly requestRevision: number }
  | {
      readonly type: 'selection_succeeded';
      readonly requestRevision: number;
      readonly selection: SelectedBannerUpload;
    }
  | {
      readonly type: 'selection_failed';
      readonly requestRevision: number;
      readonly message: string;
    }
  | { readonly type: 'selection_cleared'; readonly requestRevision: number }
  | { readonly type: 'analysis_started'; readonly requestRevision: number }
  | {
      readonly type: 'analysis_succeeded';
      readonly requestRevision: number;
      readonly result: BannerAnalysisData;
    }
  | { readonly type: 'analysis_failed'; readonly requestRevision: number; readonly message: string }
  | { readonly type: 'layer_selected'; readonly partKey: string }
  | { readonly type: 'layer_inclusion_set'; readonly partKey: string; readonly included: boolean }
  | { readonly type: 'layer_visibility_set'; readonly partKey: string; readonly visible: boolean };

export const initialBannerAiState: BannerAiState = Object.freeze({
  phase: 'idle',
  selection: null,
  result: null,
  layerReview: null,
  error: null,
  requestRevision: 0,
  activeRequestRevision: null,
});

export const getBannerAiUploadControlCopy = (state: BannerAiState): BannerAiUploadControlCopy => {
  if (state.selection !== null) {
    return { kind: 'filename', text: state.selection.filename };
  }
  if (state.phase === 'validating') {
    return { kind: 'status', text: 'Validating selected image…' };
  }
  if (state.error?.source === 'validation') {
    return { kind: 'status', text: 'No valid image selected' };
  }
  return { kind: 'status', text: 'No image selected' };
};

const isNewRequestRevision = (state: BannerAiState, requestRevision: number): boolean =>
  Number.isSafeInteger(requestRevision) && requestRevision > state.requestRevision;

export const bannerAiReducer = (state: BannerAiState, event: BannerAiEvent): BannerAiState => {
  switch (event.type) {
    case 'selection_started': {
      if (!isNewRequestRevision(state, event.requestRevision)) return state;
      return {
        phase: 'validating',
        selection: null,
        result: null,
        layerReview: null,
        error: null,
        requestRevision: event.requestRevision,
        activeRequestRevision: event.requestRevision,
      };
    }
    case 'selection_succeeded':
      if (state.phase !== 'validating' || state.activeRequestRevision !== event.requestRevision) {
        return state;
      }
      return {
        ...state,
        phase: 'idle',
        selection: event.selection,
        result: null,
        layerReview: null,
        error: null,
        activeRequestRevision: null,
      };
    case 'selection_failed':
      if (state.phase !== 'validating' || state.activeRequestRevision !== event.requestRevision) {
        return state;
      }
      return {
        ...state,
        phase: 'failed',
        selection: null,
        result: null,
        layerReview: null,
        error: { source: 'validation', message: event.message },
        activeRequestRevision: null,
      };
    case 'selection_cleared': {
      if (!isNewRequestRevision(state, event.requestRevision)) return state;
      return {
        ...initialBannerAiState,
        requestRevision: event.requestRevision,
      };
    }
    case 'analysis_started':
      if (state.selection === null || !isNewRequestRevision(state, event.requestRevision)) {
        return state;
      }
      return {
        ...state,
        phase: 'running',
        result: null,
        layerReview: null,
        error: null,
        requestRevision: event.requestRevision,
        activeRequestRevision: event.requestRevision,
      };
    case 'analysis_succeeded': {
      if (
        state.selection === null ||
        state.phase !== 'running' ||
        state.activeRequestRevision !== event.requestRevision
      ) {
        return state;
      }
      try {
        return {
          ...state,
          phase: 'succeeded',
          result: event.result,
          layerReview: createBannerLayerReviewState(event.result),
          error: null,
          activeRequestRevision: null,
        };
      } catch {
        return {
          ...state,
          phase: 'failed',
          result: null,
          layerReview: null,
          error: {
            source: 'analysis',
            message: 'The provider-free fixture proposal could not initialize layer controls.',
          },
          activeRequestRevision: null,
        };
      }
    }
    case 'analysis_failed':
      if (
        state.selection === null ||
        state.phase !== 'running' ||
        state.activeRequestRevision !== event.requestRevision
      ) {
        return state;
      }
      return {
        ...state,
        phase: 'failed',
        result: null,
        layerReview: null,
        error: { source: 'analysis', message: event.message },
        activeRequestRevision: null,
      };
    case 'layer_selected':
    case 'layer_inclusion_set':
    case 'layer_visibility_set': {
      if (state.layerReview === null) return state;
      const layerReview = bannerLayerReviewReducer(
        state.layerReview,
        event.type === 'layer_selected'
          ? { type: 'select', partKey: event.partKey }
          : event.type === 'layer_inclusion_set'
            ? { type: 'set_included', partKey: event.partKey, included: event.included }
            : { type: 'set_visible', partKey: event.partKey, visible: event.visible },
      );
      return layerReview === state.layerReview ? state : { ...state, layerReview };
    }
  }
};
