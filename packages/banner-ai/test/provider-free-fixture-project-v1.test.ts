import { describe, expect, it } from 'vitest';

import {
  BannerSceneV1Schema,
  INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
  PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1,
  PROVIDER_FREE_LEFT_WING_LAYER_ID_V1,
  PROVIDER_FREE_RIGHT_WING_LAYER_ID_V1,
  PROVIDER_FREE_SCENE_EDIT_WORKFLOW_V1,
  appendProviderFreeBannerProjectRevisionV1,
  canonicalizeJson,
  createInitialProviderFreeBannerProjectV1,
  materializeProviderFreeFixtureProjectV1,
  mutateProviderFreeBannerSceneV1,
  parseProviderFreeBannerProjectV1,
  sha256BannerScene,
  validateProviderFreeBannerProjectAgainstFixtureV1,
} from '../src/index.js';

const pinnedMaterialization = {
  sceneSha256: 'f84488e2bc45e411c46e180714db64ee4f5ac550cb04f4412c57eca7a4413712',
  sceneVersionId: '20cf0087-38de-5b86-8019-48d65bad4216',
  initialWorkflowSha256: 'e3784eefd371b1bf343db9e2dfb97697f2fe5889c8374fe777316add8a59230c',
  editWorkflowSha256: '5f3e1ef067095795128d7a0db59605e2ebd53fe8347d2cd0ccb8a94be109450e',
  assets: [
    [
      'version_16767d791c8b19501eb071b51c3ee56f0bbfe3139b0cd39c38e3deef',
      77,
      '16767d791c8b19501eb071b51c3ee56f0bbfe3139b0cd39c38e3deef6528dd4f',
    ],
    [
      'asset_version_angel_body_visual_v1',
      286,
      '5927efb1aff9e9f00f72265a6a3b744985f9b58fe0d848230fde163292e08ced',
    ],
    [
      'asset_version_left_wing_visual_v1',
      253,
      '7a5b4061cb1917e365442a745404a9118898eab7a292b108b470f3796b19a28a',
    ],
    [
      'asset_version_right_wing_visual_v1',
      252,
      'c38c7fe5e4f3f7fb11ce7487360dc97f70edf9c3cbce7355093c7087aa02eb6a',
    ],
  ],
  thumbnails: [
    ['background', 206, '6213f8e149431252e2ecc8cc46a16466723d98d059cc0d4cdd901566ba63bb92'],
    ['angel.body', 249, 'de4273d8f5c6599433d572de1458539ad7b375cf4ed42cd16497d2db777d40cc'],
    ['wing.left', 257, '7b71889c68e7c4ff61d9d971fe4b6856805a9338301ac4d6594aef74ac6a078f'],
    ['wing.right', 255, 'd01030ff3a599e13066f0467e7f022736cd09ba708af9ae2f5374b625d611959'],
  ],
} as const;

describe('provider-free Angel fixture project v1', () => {
  it('materializes identical pinned assets, thumbnails, scene, identities, and references', async () => {
    const first = await materializeProviderFreeFixtureProjectV1();
    const second = await materializeProviderFreeFixtureProjectV1();

    expect(canonicalizeJson(first.project)).toBe(canonicalizeJson(second.project));
    expect(first.assets.map((asset) => asset.bytes)).toEqual(
      second.assets.map((asset) => asset.bytes),
    );
    expect(sha256BannerScene(first.scene)).toBe(pinnedMaterialization.sceneSha256);
    expect(first.project.revisions[0]?.sceneVersionId).toBe(pinnedMaterialization.sceneVersionId);
    expect(INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definitionSha256).toBe(
      pinnedMaterialization.initialWorkflowSha256,
    );
    expect(first.project.revisions[0]?.sceneWorkflow.definitionSha256).toBe(
      pinnedMaterialization.initialWorkflowSha256,
    );
    expect(PROVIDER_FREE_SCENE_EDIT_WORKFLOW_V1.definitionSha256).toBe(
      pinnedMaterialization.editWorkflowSha256,
    );
    expect(
      first.assets.map((asset) => [
        asset.reference.assetVersionId,
        asset.reference.byteSize,
        asset.reference.sha256,
      ]),
    ).toEqual(pinnedMaterialization.assets);
    expect(
      first.presentationParts.map((part) => [
        part.partKey,
        part.thumbnail.byteSize,
        part.thumbnail.sha256,
      ]),
    ).toEqual(pinnedMaterialization.thumbnails);
    expect(new Set(first.presentationParts.map((part) => part.thumbnail.sha256)).size).toBe(4);
    expect(
      first.presentationParts.every(
        (part) => part.thumbnail.pixelWidth === 120 && part.thumbnail.pixelHeight === 80,
      ),
    ).toBe(true);
    expect(
      first.presentationParts.every((part) =>
        part.thumbnail.dataUrl.startsWith('data:image/png;base64,'),
      ),
    ).toBe(true);
    expect(first.scene.canvas).toMatchObject({ width: 300, height: 200 });
    expect(first.scene.layers.map((layer) => [layer.name, layer.frame])).toEqual([
      ['Angel body', { x: 105, y: 30, width: 90, height: 160 }],
      ['Left wing', { x: 15, y: 36, width: 105, height: 120 }],
      ['Right wing', { x: 180, y: 36, width: 105, height: 120 }],
    ]);
    expect(first.scene.exportSettings).toMatchObject({
      kind: 'gdn-html5',
      interaction: { kind: 'single-exit', destinationUrl: 'https://example.com/campaign' },
      validatorProfile: PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1,
    });
  });

  it('applies only inclusion, visibility, background, and one exact Gentle float track', async () => {
    const materialization = await materializeProviderFreeFixtureProjectV1();
    let scene = materialization.scene;
    scene = mutateProviderFreeBannerSceneV1(scene, {
      type: 'set_layer_visible',
      layerId: PROVIDER_FREE_LEFT_WING_LAYER_ID_V1,
      visible: false,
    });
    scene = mutateProviderFreeBannerSceneV1(scene, {
      type: 'set_layer_included',
      layerId: PROVIDER_FREE_LEFT_WING_LAYER_ID_V1,
      included: false,
    });
    scene = mutateProviderFreeBannerSceneV1(scene, {
      type: 'apply_gentle_float',
      layerId: PROVIDER_FREE_LEFT_WING_LAYER_ID_V1,
    });

    expect(scene.layers[1]).toMatchObject({ included: false, visible: false });
    expect(scene.timeline).toEqual([
      {
        id: 'track_gentle_float_left_v1',
        targetLayerId: PROVIDER_FREE_LEFT_WING_LAYER_ID_V1,
        preset: { kind: 'float', presetVersion: 1, axis: 'y', distancePx: -6 },
        timing: {
          startMs: 0,
          durationMs: 1_200,
          iterations: 2,
          iterationMode: 'alternate',
          easing: 'ease-in-out',
        },
      },
    ]);

    const moved = mutateProviderFreeBannerSceneV1(scene, {
      type: 'apply_gentle_float',
      layerId: PROVIDER_FREE_RIGHT_WING_LAYER_ID_V1,
    });
    expect(moved.timeline).toHaveLength(1);
    expect(moved.timeline[0]?.targetLayerId).toBe(PROVIDER_FREE_RIGHT_WING_LAYER_ID_V1);
    expect(mutateProviderFreeBannerSceneV1(moved, { type: 'clear_gentle_float' }).timeline).toEqual(
      [],
    );
    expect(
      mutateProviderFreeBannerSceneV1(scene, {
        type: 'set_background_included',
        included: false,
      }).canvas.background,
    ).toEqual({ kind: 'transparent' });
  });

  it('appends canonical ancestry and gives repeated scene content a unique deterministic identity', async () => {
    const materialization = await materializeProviderFreeFixtureProjectV1();
    const hidden = mutateProviderFreeBannerSceneV1(materialization.scene, {
      type: 'set_layer_visible',
      layerId: PROVIDER_FREE_LEFT_WING_LAYER_ID_V1,
      visible: false,
    });
    const revision2 = appendProviderFreeBannerProjectRevisionV1({
      project: materialization.project,
      scene: hidden,
      selectedPartId: PROVIDER_FREE_LEFT_WING_LAYER_ID_V1,
    });
    const revision3 = appendProviderFreeBannerProjectRevisionV1({
      project: revision2,
      scene: hidden,
      selectedPartId: PROVIDER_FREE_RIGHT_WING_LAYER_ID_V1,
    });
    const restored = mutateProviderFreeBannerSceneV1(hidden, {
      type: 'set_layer_visible',
      layerId: PROVIDER_FREE_LEFT_WING_LAYER_ID_V1,
      visible: true,
    });
    const revision4 = appendProviderFreeBannerProjectRevisionV1({
      project: revision3,
      scene: restored,
      selectedPartId: PROVIDER_FREE_LEFT_WING_LAYER_ID_V1,
    });

    expect(revision3.revisions[1]?.sceneSha256).toBe(revision3.revisions[2]?.sceneSha256);
    expect(revision4.revisions[3]?.sceneSha256).toBe(revision4.revisions[0]?.sceneSha256);
    expect(new Set(revision4.revisions.map((revision) => revision.sceneVersionId)).size).toBe(4);
    expect(revision4.revisions.map((revision) => revision.revision)).toEqual([1, 2, 3, 4]);
    expect(revision4.revisions[3]?.parentSceneSha256).toBe(revision4.revisions[2]?.sceneSha256);
    expect(
      revision4.revisions
        .slice(1)
        .every(
          (revision) =>
            revision.sceneWorkflow.definitionSha256 === pinnedMaterialization.editWorkflowSha256,
        ),
    ).toBe(true);
    expect(parseProviderFreeBannerProjectV1(revision4)).toEqual(revision4);
  });

  it('rejects unknown fields, digest drift, broken ancestry, foreign base material, and arbitrary tracks', async () => {
    const materialization = await materializeProviderFreeFixtureProjectV1();
    const unknown = { ...materialization.project, extra: true };
    const digestDrift = structuredClone(materialization.project);
    digestDrift.revisions[0]!.sceneSha256 = 'f'.repeat(64);
    const brokenParent = structuredClone(materialization.project);
    brokenParent.revisions[0]!.parentSceneSha256 = 'e'.repeat(64);

    for (const invalid of [unknown, digestDrift, brokenParent]) {
      expect(() => parseProviderFreeBannerProjectV1(invalid)).toThrow(/strict validation/);
    }

    const foreignScene = BannerSceneV1Schema.parse({
      ...materialization.scene,
      sourceAsset: { ...materialization.scene.sourceAsset, sha256: 'd'.repeat(64) },
    });
    const foreignProject = createInitialProviderFreeBannerProjectV1(foreignScene);
    expect(() =>
      validateProviderFreeBannerProjectAgainstFixtureV1({
        project: foreignProject,
        initialScene: materialization.scene,
      }),
    ).toThrow(/fixed fixture/);

    const arbitrary = BannerSceneV1Schema.parse({
      ...materialization.scene,
      timeline: [
        {
          id: 'track_arbitrary_01',
          targetLayerId: PROVIDER_FREE_LEFT_WING_LAYER_ID_V1,
          preset: { kind: 'float', presetVersion: 1, axis: 'y', distancePx: -7 },
          timing: {
            startMs: 0,
            durationMs: 1_200,
            iterations: 2,
            iterationMode: 'alternate',
            easing: 'ease-in-out',
          },
        },
      ],
    });
    expect(() =>
      appendProviderFreeBannerProjectRevisionV1({
        project: materialization.project,
        scene: arbitrary,
        selectedPartId: PROVIDER_FREE_LEFT_WING_LAYER_ID_V1,
      }),
    ).toThrow(/strict validation/);
  });
});
