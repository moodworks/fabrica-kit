import { describe, expect, it } from 'vitest';

import {
  BannerSceneV1Schema,
  INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
  PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1,
  PROVIDER_FREE_PERSON_SUBJECT_LAYER_ID_V1,
  PROVIDER_FREE_SCENE_EDIT_WORKFLOW_V1,
  appendProviderFreeBannerProjectRevisionV1,
  canonicalizeJson,
  materializeProviderFreePersonSubjectProjectV1,
  mutateProviderFreeBannerSceneV1,
  parseProviderFreeBannerProjectV1,
  sha256BannerScene,
  validateProviderFreeBannerProjectAgainstFixtureV1,
} from '../src/index.js';
import {
  materializeProviderFreePersonSamReplayProjectV1,
  PROVIDER_FREE_PERSON_SAM_REPLAY_EVIDENCE_V1,
} from '../src/server/sam-box-prompt-layer-extraction.js';

const pinnedMaterialization = {
  sceneSha256: 'a7228740596d4033329f24bd366b7528703ed56491f4f7b9c9a3ce8fb8494f2e',
  sceneVersionId: '427f573c-a043-52ef-abb5-c45ef0fc3b12',
  initialWorkflowSha256: 'e3784eefd371b1bf343db9e2dfb97697f2fe5889c8374fe777316add8a59230c',
  editWorkflowSha256: '5f3e1ef067095795128d7a0db59605e2ebd53fe8347d2cd0ccb8a94be109450e',
  assets: [
    [
      'asset_version_banner_person_source_v1',
      241013,
      '6e3175cdd260fde33a3885945eb6f8831da3905afbc723f684035f411dc6d699',
    ],
    [
      'asset_version_banner_person_v1',
      53742,
      '464f1bb286ac4a599e3b49a25b1f427d2b73acaac6c2cd1829902d0d5a870c33',
    ],
  ],
  thumbnails: [
    ['background', 207, '4237837fa98436d44fda2ec3421253e17cfcc1a85c161a4686aa43ec3036c3d7'],
    ['subject', 9812, 'efcaae53e2a4ad62fdf1d5b63799beb981788f584ee8dcf5bf04e5d434a806db'],
  ],
  sourceThumbnail: [7957, '61af239b98d3a4fc3250b16d9467f8be69e3d0e46b90fda5dbe7b848bba53baf'],
} as const;

describe('provider-free person fixture project v1', () => {
  it('materializes the exact tracked person source and SAM replay subject', async () => {
    const first = await materializeProviderFreePersonSamReplayProjectV1();
    const second = await materializeProviderFreePersonSamReplayProjectV1();
    expect(first).toBe(second);
    expect(first.assets).toHaveLength(2);
    expect(first.presentationParts).toHaveLength(2);
    expect([
      first.sourceReference.thumbnail.byteSize,
      first.sourceReference.thumbnail.sha256,
    ]).toEqual(pinnedMaterialization.sourceThumbnail);
    expect(first.sourceReference.asset).toEqual(first.scene.sourceAsset);
    expect(first.presentationParts.map((part) => part.partKey)).toEqual(['background', 'subject']);
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
    expect(first.scene.layers).toHaveLength(1);
    expect(first.scene.layers[0]).toMatchObject({
      id: PROVIDER_FREE_PERSON_SUBJECT_LAYER_ID_V1,
      name: 'banner-person-v1 subject',
      included: true,
      visible: true,
      frame: { x: 195, y: 64, width: 54, height: 74 },
    });
    expect(first.scene.layers.map((layer) => layer.asset.sha256)).toEqual([
      pinnedMaterialization.assets[1][2],
    ]);
    expect(first.scene.canvas).toMatchObject({ width: 300, height: 200 });
    expect(first.scene.exportSettings).toMatchObject({
      kind: 'gdn-html5',
      interaction: { kind: 'single-exit', destinationUrl: 'https://example.com/campaign' },
      validatorProfile: PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1,
    });
    expect(sha256BannerScene(first.scene)).toBe(pinnedMaterialization.sceneSha256);
    expect(first.project.revisions[0]?.sceneVersionId).toBe(pinnedMaterialization.sceneVersionId);
    expect(first.project.revisions[0]?.sceneWorkflow.definitionSha256).toBe(
      pinnedMaterialization.initialWorkflowSha256,
    );
    expect(INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definitionSha256).toBe(
      pinnedMaterialization.initialWorkflowSha256,
    );
    expect(PROVIDER_FREE_SCENE_EDIT_WORKFLOW_V1.definitionSha256).toBe(
      pinnedMaterialization.editWorkflowSha256,
    );
    expect(
      validateProviderFreeBannerProjectAgainstFixtureV1({
        project: first.project,
        initialScene: first.scene,
      }),
    ).toEqual(first.project);
    expect(PROVIDER_FREE_PERSON_SAM_REPLAY_EVIDENCE_V1).toMatchObject({
      manifestSha256: 'b921f3390307857a166bcd4ba6c36a3d19d6c7f55ccd96e61e07d589af8638ee',
      validatedResponseSha256: '371b51fe00b0d80a32ad53a0de3ad864d089ea3dbb1e7cb3f2667ce170b29646',
      sanitizedResponseSha256: '68c85095d9d0524dae4edb1f40f049cf1a6143a6be59a5446350530b2a2b3999',
      outputClassification: 'real-sam-output',
      candidateOrder: 5,
      cutout: { width: 157, height: 215, byteSize: 53742 },
    });
  });

  it('accepts only the exact person subject input shape', async () => {
    const replay = await materializeProviderFreePersonSamReplayProjectV1();
    const source = replay.assets[0]!.bytes;
    const subject = replay.assets[1]!.bytes;
    await expect(materializeProviderFreePersonSubjectProjectV1({})).rejects.toThrow();
    await expect(
      materializeProviderFreePersonSubjectProjectV1({ source, subject, extra: subject }),
    ).rejects.toThrow();
    await expect(
      materializeProviderFreePersonSubjectProjectV1({ source, subject: Uint8Array.of(1) }),
    ).rejects.toThrow();
    const supplied = await materializeProviderFreePersonSubjectProjectV1({ source, subject });
    expect(supplied.assets.slice(1)[0]?.reference.sha256).toBe(replay.assets[1]?.reference.sha256);
    expect(canonicalizeJson(supplied.project)).toBe(canonicalizeJson(replay.project));
  });

  it('applies only inclusion, visibility, background, and one Gentle Float track', async () => {
    const materialization = await materializeProviderFreePersonSamReplayProjectV1();
    let scene = mutateProviderFreeBannerSceneV1(materialization.scene, {
      type: 'set_layer_visible',
      layerId: PROVIDER_FREE_PERSON_SUBJECT_LAYER_ID_V1,
      visible: false,
    });
    scene = mutateProviderFreeBannerSceneV1(scene, {
      type: 'set_layer_included',
      layerId: PROVIDER_FREE_PERSON_SUBJECT_LAYER_ID_V1,
      included: false,
    });
    scene = mutateProviderFreeBannerSceneV1(scene, {
      type: 'apply_gentle_float',
      layerId: PROVIDER_FREE_PERSON_SUBJECT_LAYER_ID_V1,
    });
    expect(scene.layers[0]).toMatchObject({ included: false, visible: false });
    expect(scene.timeline).toHaveLength(1);
    expect(scene.timeline[0]).toMatchObject({
      targetLayerId: PROVIDER_FREE_PERSON_SUBJECT_LAYER_ID_V1,
      preset: { kind: 'float', presetVersion: 1, axis: 'y', distancePx: -6 },
    });
    expect(mutateProviderFreeBannerSceneV1(scene, { type: 'clear_gentle_float' }).timeline).toEqual(
      [],
    );
    expect(
      mutateProviderFreeBannerSceneV1(scene, { type: 'set_background_included', included: false })
        .canvas.background,
    ).toEqual({ kind: 'transparent' });
  });

  it('preserves canonical ancestry and unique revision identities', async () => {
    const materialization = await materializeProviderFreePersonSamReplayProjectV1();
    const hidden = mutateProviderFreeBannerSceneV1(materialization.scene, {
      type: 'set_layer_visible',
      layerId: PROVIDER_FREE_PERSON_SUBJECT_LAYER_ID_V1,
      visible: false,
    });
    const revision2 = appendProviderFreeBannerProjectRevisionV1({
      project: materialization.project,
      scene: hidden,
      selectedPartId: PROVIDER_FREE_PERSON_SUBJECT_LAYER_ID_V1,
    });
    const revision3 = appendProviderFreeBannerProjectRevisionV1({
      project: revision2,
      scene: hidden,
      selectedPartId: 'background',
    });
    const restored = mutateProviderFreeBannerSceneV1(hidden, {
      type: 'set_layer_visible',
      layerId: PROVIDER_FREE_PERSON_SUBJECT_LAYER_ID_V1,
      visible: true,
    });
    const revision4 = appendProviderFreeBannerProjectRevisionV1({
      project: revision3,
      scene: restored,
      selectedPartId: PROVIDER_FREE_PERSON_SUBJECT_LAYER_ID_V1,
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

  it('rejects unknown fields, digest drift, broken ancestry, foreign source, and arbitrary tracks', async () => {
    const materialization = await materializeProviderFreePersonSamReplayProjectV1();
    const unknown = { ...materialization.project, extra: true };
    const digestDrift = structuredClone(materialization.project);
    digestDrift.revisions[0]!.sceneSha256 = 'f'.repeat(64);
    const brokenParent = structuredClone(materialization.project);
    brokenParent.revisions[0]!.parentSceneSha256 = 'e'.repeat(64);
    for (const invalid of [unknown, digestDrift, brokenParent])
      expect(() => parseProviderFreeBannerProjectV1(invalid)).toThrow(/strict validation/);
    const foreignScene = BannerSceneV1Schema.parse({
      ...materialization.scene,
      sourceAsset: { ...materialization.scene.sourceAsset, sha256: 'd'.repeat(64) },
    });
    expect(() =>
      validateProviderFreeBannerProjectAgainstFixtureV1({
        project: materialization.project,
        initialScene: foreignScene,
      }),
    ).toThrow(/fixed fixture/);
    const arbitrary = BannerSceneV1Schema.parse({
      ...materialization.scene,
      timeline: [
        {
          id: 'track_arbitrary_01',
          targetLayerId: PROVIDER_FREE_PERSON_SUBJECT_LAYER_ID_V1,
          preset: { kind: 'float', presetVersion: 1, axis: 'y', distancePx: -7 },
          timing: {
            startMs: 0,
            durationMs: 1200,
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
        selectedPartId: PROVIDER_FREE_PERSON_SUBJECT_LAYER_ID_V1,
      }),
    ).toThrow(/strict validation/);
  });
});
