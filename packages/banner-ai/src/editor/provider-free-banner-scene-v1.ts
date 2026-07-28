import {
  parseBannerSceneV1,
  type AnimationTrackV1,
  type BannerSceneV1,
} from '../scene/banner-scene-v1.schema.js';

export const PROVIDER_FREE_BACKGROUND_PART_ID_V1 = 'background' as const;
export const PROVIDER_FREE_ANGEL_BODY_LAYER_ID_V1 = 'layer_angel_body_v1' as const;
export const PROVIDER_FREE_LEFT_WING_LAYER_ID_V1 = 'layer_left_wing_v1' as const;
export const PROVIDER_FREE_RIGHT_WING_LAYER_ID_V1 = 'layer_right_wing_v1' as const;

export const PROVIDER_FREE_LAYER_IDS_V1 = Object.freeze([
  PROVIDER_FREE_ANGEL_BODY_LAYER_ID_V1,
  PROVIDER_FREE_LEFT_WING_LAYER_ID_V1,
  PROVIDER_FREE_RIGHT_WING_LAYER_ID_V1,
] as const);

export type ProviderFreeLayerIdV1 = (typeof PROVIDER_FREE_LAYER_IDS_V1)[number];
export type ProviderFreeSelectedPartIdV1 =
  typeof PROVIDER_FREE_BACKGROUND_PART_ID_V1 | ProviderFreeLayerIdV1;

export const PROVIDER_FREE_SOLID_BACKGROUND_V1 = Object.freeze({
  kind: 'solid' as const,
  color: '#F3E7D3FF' as const,
});

export const GENTLE_FLOAT_PRESET_V1 = Object.freeze({
  label: 'Gentle float' as const,
  presetVersion: 1 as const,
  preset: Object.freeze({
    kind: 'float' as const,
    presetVersion: 1 as const,
    axis: 'y' as const,
    distancePx: -6 as const,
  }),
  timing: Object.freeze({
    startMs: 0 as const,
    durationMs: 1_200 as const,
    iterations: 2 as const,
    iterationMode: 'alternate' as const,
    easing: 'ease-in-out' as const,
  }),
});

const gentleFloatTrackIds = Object.freeze({
  [PROVIDER_FREE_ANGEL_BODY_LAYER_ID_V1]: 'track_gentle_float_body_v1',
  [PROVIDER_FREE_LEFT_WING_LAYER_ID_V1]: 'track_gentle_float_left_v1',
  [PROVIDER_FREE_RIGHT_WING_LAYER_ID_V1]: 'track_gentle_float_right_v1',
} satisfies Record<ProviderFreeLayerIdV1, string>);

export const isProviderFreeLayerIdV1 = (value: string): value is ProviderFreeLayerIdV1 =>
  PROVIDER_FREE_LAYER_IDS_V1.some((layerId) => layerId === value);

export const isProviderFreeSelectedPartIdV1 = (
  value: string,
): value is ProviderFreeSelectedPartIdV1 =>
  value === PROVIDER_FREE_BACKGROUND_PART_ID_V1 || isProviderFreeLayerIdV1(value);

export const gentleFloatTrackIdForLayerV1 = (layerId: ProviderFreeLayerIdV1): string =>
  gentleFloatTrackIds[layerId];

export const createGentleFloatTrackV1 = (layerId: ProviderFreeLayerIdV1): AnimationTrackV1 => ({
  id: gentleFloatTrackIdForLayerV1(layerId) as AnimationTrackV1['id'],
  targetLayerId: layerId as AnimationTrackV1['targetLayerId'],
  preset: GENTLE_FLOAT_PRESET_V1.preset,
  timing: GENTLE_FLOAT_PRESET_V1.timing,
});

export type ProviderFreeBannerSceneMutationV1 =
  | { readonly type: 'set_background_included'; readonly included: boolean }
  | {
      readonly type: 'set_layer_included';
      readonly layerId: ProviderFreeLayerIdV1;
      readonly included: boolean;
    }
  | {
      readonly type: 'set_layer_visible';
      readonly layerId: ProviderFreeLayerIdV1;
      readonly visible: boolean;
    }
  | { readonly type: 'apply_gentle_float'; readonly layerId: ProviderFreeLayerIdV1 }
  | { readonly type: 'clear_gentle_float' };

const requireProviderFreeLayer = (scene: BannerSceneV1, layerId: ProviderFreeLayerIdV1): void => {
  if (!scene.layers.some((layer) => layer.id === layerId)) {
    throw new TypeError('The provider-free scene mutation target is not available.');
  }
};

const parseMutatedScene = (input: unknown): BannerSceneV1 => {
  const parsed = parseBannerSceneV1(input);
  if (!parsed.success) {
    throw new TypeError('The provider-free scene mutation produced an invalid scene.');
  }
  return parsed.data;
};

/**
 * Applies the only Phase 2A scene mutations and reparses every resulting value.
 * Selection is project UI state and deliberately does not enter this reducer.
 */
export const mutateProviderFreeBannerSceneV1 = (
  scene: BannerSceneV1,
  event: ProviderFreeBannerSceneMutationV1,
): BannerSceneV1 => {
  switch (event.type) {
    case 'set_background_included':
      return parseMutatedScene({
        ...scene,
        canvas: {
          ...scene.canvas,
          background: event.included
            ? PROVIDER_FREE_SOLID_BACKGROUND_V1
            : { kind: 'transparent' as const },
        },
      });
    case 'set_layer_included':
      requireProviderFreeLayer(scene, event.layerId);
      return parseMutatedScene({
        ...scene,
        layers: scene.layers.map((layer) =>
          layer.id === event.layerId ? { ...layer, included: event.included } : layer,
        ),
      });
    case 'set_layer_visible':
      requireProviderFreeLayer(scene, event.layerId);
      return parseMutatedScene({
        ...scene,
        layers: scene.layers.map((layer) =>
          layer.id === event.layerId ? { ...layer, visible: event.visible } : layer,
        ),
      });
    case 'apply_gentle_float':
      requireProviderFreeLayer(scene, event.layerId);
      return parseMutatedScene({
        ...scene,
        timeline: [createGentleFloatTrackV1(event.layerId)],
      });
    case 'clear_gentle_float':
      return parseMutatedScene({ ...scene, timeline: [] });
  }
};
