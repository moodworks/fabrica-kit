import { describe, expect, it } from 'vitest';

import { parseBannerScene, parseBannerSceneV1, type ValidationIssueCode } from '../src/index.js';
import {
  arrayAt,
  cloneRecord,
  deleteAt,
  loadAngelRecord,
  loadAngelScene,
  recordAt,
  setAt,
} from './fixture.js';

interface InvalidCase {
  readonly code: ValidationIssueCode;
  readonly mutate: (scene: Record<string, unknown>) => void;
  readonly name: string;
  readonly path: string;
}

const validatorProfile = {
  validatorProfileId: 'validator_profile_01',
  validatorProfileVersion: 1,
  rulesSha256: '6666666666666666666666666666666666666666666666666666666666666666',
};

const invalidCases: readonly InvalidCase[] = [
  {
    name: 'unknown scene key',
    code: 'SCENE_UNKNOWN_KEY',
    path: '/customCss',
    mutate: (scene) => {
      scene['customCss'] = 'body{}';
    },
  },
  {
    name: 'required key set to null',
    code: 'SCENE_REQUIRED',
    path: '/canvas/background',
    mutate: (scene) => setAt(scene, ['canvas', 'background'], null),
  },
  {
    name: 'fractional canvas dimension',
    code: 'CANVAS_DIMENSION_INVALID',
    path: '/canvas/width',
    mutate: (scene) => setAt(scene, ['canvas', 'width'], 1.5),
  },
  {
    name: 'canvas area above the ceiling',
    code: 'CANVAS_AREA_EXCEEDED',
    path: '/canvas',
    mutate: (scene) => {
      setAt(scene, ['canvas', 'width'], 4_096);
      setAt(scene, ['canvas', 'height'], 4_097);
    },
  },
  {
    name: 'mixed background union branch',
    code: 'BACKGROUND_VARIANT_INVALID',
    path: '/canvas/background/asset',
    mutate: (scene) => {
      const asset = structuredClone(recordAt(scene, ['canvas', 'background', 'asset']));
      setAt(scene, ['canvas', 'background'], { kind: 'solid', color: '#FFFFFFFF', asset });
    },
  },
  {
    name: 'non-canonical color',
    code: 'COLOR_INVALID',
    path: '/canvas/background/color',
    mutate: (scene) => setAt(scene, ['canvas', 'background'], { kind: 'solid', color: '#fff' }),
  },
  {
    name: 'invalid digest',
    code: 'DIGEST_INVALID',
    path: '/sourceAsset/sha256',
    mutate: (scene) => setAt(scene, ['sourceAsset', 'sha256'], 'A'.repeat(64)),
  },
  {
    name: 'wrong layer media role',
    code: 'ASSET_MEDIA_TYPE_INVALID',
    path: '/layers/0/asset/mediaType',
    mutate: (scene) => setAt(scene, ['layers', 0, 'asset', 'mediaType'], 'image/jpeg'),
  },
  {
    name: 'asset decoded area above the ceiling',
    code: 'ASSET_LIMIT_EXCEEDED',
    path: '/sourceAsset',
    mutate: (scene) => {
      setAt(scene, ['sourceAsset', 'pixelWidth'], 8_192);
      setAt(scene, ['sourceAsset', 'pixelHeight'], 8_192);
    },
  },
  {
    name: 'conflicting repeated asset version metadata',
    code: 'ASSET_REFERENCE_CONFLICT',
    path: '/layers/0/asset',
    mutate: (scene) =>
      setAt(
        scene,
        ['layers', 0, 'asset', 'assetVersionId'],
        recordAt(scene, ['sourceAsset'])['assetVersionId'],
      ),
  },
  {
    name: 'zero layers',
    code: 'LAYER_COUNT_INVALID',
    path: '/layers',
    mutate: (scene) => setAt(scene, ['layers'], []),
  },
  {
    name: 'duplicate layer id',
    code: 'LAYER_ID_DUPLICATE',
    path: '/layers/1/id',
    mutate: (scene) => setAt(scene, ['layers', 1, 'id'], recordAt(scene, ['layers', 0])['id']),
  },
  {
    name: 'non-contiguous layer order',
    code: 'LAYER_ORDER_INVALID',
    path: '/layers',
    mutate: (scene) => setAt(scene, ['layers', 2, 'order'], 1),
  },
  {
    name: 'unsorted layer array',
    code: 'LAYER_ARRAY_UNSORTED',
    path: '/layers',
    mutate: (scene) => {
      const layers = arrayAt(scene, ['layers']);
      [layers[0], layers[1]] = [layers[1], layers[0]];
    },
  },
  {
    name: 'non-NFC layer name',
    code: 'LAYER_NAME_INVALID',
    path: '/layers/0/name',
    mutate: (scene) => setAt(scene, ['layers', 0, 'name'], 'Cafe\u0301'),
  },
  {
    name: 'frame outside canvas',
    code: 'LAYER_FRAME_INVALID',
    path: '/layers/0/frame',
    mutate: (scene) => setAt(scene, ['layers', 0, 'frame', 'x'], 300),
  },
  {
    name: 'zero layer scale',
    code: 'LAYER_TRANSFORM_INVALID',
    path: '/layers/0/transform/scaleX',
    mutate: (scene) => setAt(scene, ['layers', 0, 'transform', 'scaleX'], 0),
  },
  {
    name: 'opacity above one',
    code: 'LAYER_OPACITY_INVALID',
    path: '/layers/0/opacity',
    mutate: (scene) => setAt(scene, ['layers', 0, 'opacity'], 1.01),
  },
  {
    name: 'non-boolean layer control',
    code: 'LAYER_CONTROL_INVALID',
    path: '/layers/0/included',
    mutate: (scene) => setAt(scene, ['layers', 0, 'included'], 1),
  },
  {
    name: 'more than 128 tracks',
    code: 'TRACK_COUNT_INVALID',
    path: '/timeline',
    mutate: (scene) => {
      const track = recordAt(scene, ['timeline', 0]);
      setAt(
        scene,
        ['timeline'],
        Array.from({ length: 129 }, (_, index) => ({
          ...structuredClone(track),
          id: `track_many_${String(index).padStart(4, '0')}`,
        })),
      );
    },
  },
  {
    name: 'duplicate track id',
    code: 'TRACK_ID_DUPLICATE',
    path: '/timeline/1/id',
    mutate: (scene) => {
      const tracks = arrayAt(scene, ['timeline']);
      tracks.splice(1, 0, structuredClone(tracks[0]));
    },
  },
  {
    name: 'missing track target',
    code: 'TRACK_TARGET_NOT_FOUND',
    path: '/timeline/0/targetLayerId',
    mutate: (scene) => setAt(scene, ['timeline', 0, 'targetLayerId'], 'layer_missing_01'),
  },
  {
    name: 'unsorted timeline',
    code: 'TRACK_ARRAY_UNSORTED',
    path: '/timeline',
    mutate: (scene) => {
      const tracks = arrayAt(scene, ['timeline']);
      [tracks[0], tracks[1]] = [tracks[1], tracks[0]];
    },
  },
  {
    name: 'unknown preset',
    code: 'TRACK_VARIANT_INVALID',
    path: '/timeline/0/preset/kind',
    mutate: (scene) => setAt(scene, ['timeline', 0, 'preset', 'kind'], 'spin'),
  },
  {
    name: 'inert preset',
    code: 'PRESET_NO_EFFECT',
    path: '/timeline/0/preset',
    mutate: (scene) => setAt(scene, ['timeline', 0, 'preset', 'distancePx'], 0),
  },
  {
    name: 'preset parameter outside bounds',
    code: 'PRESET_PARAMETER_INVALID',
    path: '/timeline/0/preset/distancePx',
    mutate: (scene) => setAt(scene, ['timeline', 0, 'preset', 'distancePx'], 513),
  },
  {
    name: 'fractional timing',
    code: 'TRACK_TIMING_INVALID',
    path: '/timeline/0/timing/durationMs',
    mutate: (scene) => setAt(scene, ['timeline', 0, 'timing', 'durationMs'], 100.5),
  },
  {
    name: 'track end after 30 seconds',
    code: 'TRACK_DURATION_EXCEEDED',
    path: '/timeline/0/timing',
    mutate: (scene) => {
      setAt(scene, ['timeline', 0, 'timing', 'durationMs'], 10_000);
      setAt(scene, ['timeline', 0, 'timing', 'iterations'], 4);
    },
  },
  {
    name: 'overlapping same-channel tracks',
    code: 'TRACK_CHANNEL_CONFLICT',
    path: '/timeline/1',
    mutate: (scene) => {
      const track = structuredClone(recordAt(scene, ['timeline', 0]));
      track['id'] = 'track_body_slide_01';
      track['preset'] = { kind: 'slide', presetVersion: 1, offsetX: 10, offsetY: 0 };
      arrayAt(scene, ['timeline']).splice(1, 0, track);
    },
  },
  {
    name: 'mixed export branch',
    code: 'EXPORT_VARIANT_INVALID',
    path: '/exportSettings/validatorProfile',
    mutate: (scene) => {
      recordAt(scene, ['exportSettings'])['validatorProfile'] = validatorProfile;
    },
  },
  {
    name: 'non-canonical exit URL',
    code: 'EXIT_URL_INVALID',
    path: '/exportSettings/interaction/destinationUrl',
    mutate: (scene) =>
      setAt(scene, ['exportSettings', 'interaction', 'destinationUrl'], '/campaign'),
  },
  {
    name: 'missing GDN validator profile',
    code: 'VALIDATOR_PROFILE_MISMATCH',
    path: '/exportSettings/validatorProfile',
    mutate: (scene) => {
      setAt(scene, ['exportSettings', 'kind'], 'gdn-html5');
      deleteAt(scene, ['exportSettings', 'validatorProfile']);
    },
  },
  {
    name: 'static frame after an empty timeline',
    code: 'STATIC_FRAME_INVALID',
    path: '/exportSettings/frameTimeMs',
    mutate: (scene) => {
      setAt(scene, ['timeline'], []);
      setAt(scene, ['exportSettings'], {
        kind: 'static-png',
        profileVersion: 1,
        frameTimeMs: 1,
      });
    },
  },
];

describe('BannerSceneV1', () => {
  it('parses the canonical angel fixture without coercing or stripping values', () => {
    const input = loadAngelRecord();
    const parsed = parseBannerSceneV1(input);

    expect(parsed).toEqual({ success: true, data: input });
  });

  it('rejects a sparse layers array at the missing entry', () => {
    const input = cloneRecord(loadAngelRecord());
    const layers = arrayAt(input, ['layers']);
    const sparseLayers = new Array<unknown>(layers.length);
    for (let index = 1; index < layers.length; index += 1) {
      sparseLayers[index] = layers[index];
    }
    setAt(input, ['layers'], sparseLayers);

    const parsed = parseBannerSceneV1(input);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.issues).toContainEqual(
        expect.objectContaining({ code: 'SCENE_REQUIRED', path: '/layers/0' }),
      );
    }
  });

  it.each(invalidCases)('rejects $name with $code', ({ code, mutate, path }) => {
    const input = cloneRecord(loadAngelRecord());
    mutate(input);

    const parsed = parseBannerSceneV1(input);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.issues).toContainEqual(expect.objectContaining({ code, path }));
      expect(parsed.issues.every((entry) => entry.path === '' || entry.path.startsWith('/'))).toBe(
        true,
      );
    }
  });

  it.each([undefined, '1', 2, null])('fails closed for unsupported schemaVersion %s', (version) => {
    const input = cloneRecord(loadAngelRecord());
    if (version === undefined) {
      delete input['schemaVersion'];
    } else {
      input['schemaVersion'] = version;
    }

    expect(parseBannerScene(input)).toEqual({
      success: false,
      issues: [
        {
          code: 'SCENE_VERSION_UNSUPPORTED',
          path: '/schemaVersion',
          message: 'Banner scene schemaVersion must be the literal integer 1.',
        },
      ],
    });
  });

  it('accepts exact inclusive canvas and asset area boundaries', () => {
    const input = cloneRecord(loadAngelRecord());
    setAt(input, ['canvas', 'width'], 4_096);
    setAt(input, ['canvas', 'height'], 4_096);
    setAt(input, ['sourceAsset', 'pixelWidth'], 8_000);
    setAt(input, ['sourceAsset', 'pixelHeight'], 5_000);
    setAt(input, ['sourceAsset', 'byteSize'], 20_971_520);

    expect(parseBannerSceneV1(input).success).toBe(true);
  });

  it('accepts adjacent half-open same-channel tracks and a static frame at timeline end', () => {
    const input = cloneRecord(loadAngelRecord());
    const targetLayerId = recordAt(input, ['layers', 0])['id'];
    setAt(
      input,
      ['timeline'],
      [
        {
          id: 'track_adjacent_01',
          targetLayerId,
          preset: { kind: 'slide', presetVersion: 1, offsetX: 10, offsetY: 0 },
          timing: {
            startMs: 0,
            durationMs: 100,
            iterations: 1,
            iterationMode: 'restart',
            easing: 'linear',
          },
        },
        {
          id: 'track_adjacent_02',
          targetLayerId,
          preset: { kind: 'float', presetVersion: 1, axis: 'x', distancePx: 10 },
          timing: {
            startMs: 100,
            durationMs: 100,
            iterations: 1,
            iterationMode: 'restart',
            easing: 'linear',
          },
        },
      ],
    );
    setAt(input, ['exportSettings'], {
      kind: 'static-png',
      profileVersion: 1,
      frameTimeMs: 200,
    });

    expect(parseBannerSceneV1(input).success).toBe(true);
  });

  it('accepts negative zero structurally while retaining a typed scene', () => {
    const input = cloneRecord(loadAngelRecord());
    setAt(input, ['layers', 0, 'frame', 'x'], -0);

    const parsed = parseBannerSceneV1(input);

    expect(parsed.success).toBe(true);
    expect(loadAngelScene().schemaVersion).toBe(1);
  });

  it('rejects port zero even though WHATWG URL parsing can serialize it', () => {
    const input = cloneRecord(loadAngelRecord());
    setAt(
      input,
      ['exportSettings', 'interaction', 'destinationUrl'],
      'https://example.com:0/campaign',
    );

    const parsed = parseBannerSceneV1(input);

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.issues.map((entry) => entry.code)).toContain('EXIT_URL_INVALID');
    }
  });
});
