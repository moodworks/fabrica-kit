import { describe, expect, it } from 'vitest';

import {
  BannerSceneV1Schema,
  PREVIEW_CSP,
  canonicalizeJson,
  createBannerSceneV1ExportDocumentParts,
  createBannerSceneV1PreviewDocument,
  createBannerSceneV1RenderPlan,
  evaluateBannerEasingV1,
  evaluateBannerSceneV1RenderPlan,
  materializeProviderFreeFixtureProjectV1,
  type AnimationTrackV1,
  type BannerSceneV1,
  type BannerSceneV1RenderPlan,
} from '../src/index.js';

const track = (
  scene: BannerSceneV1,
  preset: AnimationTrackV1['preset'],
  timing: Partial<AnimationTrackV1['timing']> = {},
): AnimationTrackV1 => ({
  id: `track_${preset.kind}_test_01` as AnimationTrackV1['id'],
  targetLayerId: scene.layers[0]!.id,
  preset,
  timing: {
    startMs: 0,
    durationMs: 1_000,
    iterations: 1,
    iterationMode: 'restart',
    easing: 'linear',
    ...timing,
  },
});

const withTrack = (scene: BannerSceneV1, value: AnimationTrackV1): BannerSceneV1 =>
  BannerSceneV1Schema.parse({ ...scene, timeline: [value] });

const runtimePayload = (source: string): Record<string, unknown> => {
  const encoded = /input = decode\('([A-Za-z0-9+/=]+)'\)/u.exec(source)?.[1];
  if (encoded === undefined) throw new TypeError('Runtime payload was not found.');
  return JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as Record<string, unknown>;
};

describe('shared BannerSceneV1 render and evaluation plan', () => {
  it('evaluates the exact Gentle float boundaries, alternate direction, and exclusive end', async () => {
    const materialization = await materializeProviderFreeFixtureProjectV1();
    const scene = withTrack(
      materialization.scene,
      track(
        materialization.scene,
        { kind: 'float', presetVersion: 1, axis: 'y', distancePx: -6 },
        {
          durationMs: 1_200,
          iterations: 2,
          iterationMode: 'alternate',
          easing: 'ease-in-out',
        },
      ),
    );
    const plan = createBannerSceneV1RenderPlan(scene);
    const translateY = (timeMs: number) =>
      evaluateBannerSceneV1RenderPlan(plan, timeMs).layers[0]!.transform.translateY;

    expect(translateY(0)).toBe(0);
    expect(translateY(600)).toBeCloseTo(-3, 10);
    expect(translateY(1_200)).toBe(-6);
    expect(translateY(1_800)).toBeCloseTo(-3, 10);
    expect(translateY(2_400)).toBe(0);
    expect(translateY(3_000)).toBe(0);
  });

  it.each([
    {
      kind: 'fade',
      preset: { kind: 'fade', presetVersion: 1, fromFactor: 0.2, toFactor: 0.8 },
      read: (scene: BannerSceneV1, time: number) =>
        evaluateBannerSceneV1RenderPlan(createBannerSceneV1RenderPlan(scene), time).layers[0]!
          .opacity,
      expectedStart: 0.2,
      expectedMiddle: 0.5,
      expectedEnd: 1,
    },
    {
      kind: 'slide',
      preset: { kind: 'slide', presetVersion: 1, offsetX: 10, offsetY: -4 },
      read: (scene: BannerSceneV1, time: number) =>
        evaluateBannerSceneV1RenderPlan(createBannerSceneV1RenderPlan(scene), time).layers[0]!
          .transform.translateX,
      expectedStart: 10,
      expectedMiddle: 5,
      expectedEnd: 0,
    },
    {
      kind: 'float',
      preset: { kind: 'float', presetVersion: 1, axis: 'x', distancePx: 8 },
      read: (scene: BannerSceneV1, time: number) =>
        evaluateBannerSceneV1RenderPlan(createBannerSceneV1RenderPlan(scene), time).layers[0]!
          .transform.translateX,
      expectedStart: 0,
      expectedMiddle: 4,
      expectedEnd: 0,
    },
    {
      kind: 'pulse',
      preset: { kind: 'pulse', presetVersion: 1, fromScale: 0.8, toScale: 1.4 },
      read: (scene: BannerSceneV1, time: number) =>
        evaluateBannerSceneV1RenderPlan(createBannerSceneV1RenderPlan(scene), time).layers[0]!
          .transform.scaleX,
      expectedStart: 0.8,
      expectedMiddle: 1.1,
      expectedEnd: 1,
    },
    {
      kind: 'flutter',
      preset: { kind: 'flutter', presetVersion: 1, fromDegrees: -10, toDegrees: 6 },
      read: (scene: BannerSceneV1, time: number) =>
        evaluateBannerSceneV1RenderPlan(createBannerSceneV1RenderPlan(scene), time).layers[0]!
          .transform.rotationDegrees,
      expectedStart: -10,
      expectedMiddle: -2,
      expectedEnd: 0,
    },
  ] as const)(
    'evaluates the closed $kind preset against neutral base channels',
    async ({ preset, read, expectedStart, expectedMiddle, expectedEnd }) => {
      const materialization = await materializeProviderFreeFixtureProjectV1();
      const scene = withTrack(
        materialization.scene,
        track(materialization.scene, preset as AnimationTrackV1['preset']),
      );
      expect(read(scene, 0)).toBeCloseTo(expectedStart, 10);
      expect(read(scene, 500)).toBeCloseTo(expectedMiddle, 10);
      expect(read(scene, 1_000)).toBeCloseTo(expectedEnd, 10);
    },
  );

  it('uses the accepted cubic-bezier easing curves deterministically', () => {
    expect(evaluateBannerEasingV1('linear', 0.37)).toBe(0.37);
    expect(evaluateBannerEasingV1('ease-in-out', 0.5)).toBeCloseTo(0.5, 10);
    expect(evaluateBannerEasingV1('ease-in', 0.5)).toBeCloseTo(0.3153568, 6);
    expect(evaluateBannerEasingV1('ease-out', 0.5)).toBeCloseTo(0.6846432, 6);
  });

  it('ignores animation channels and duration for an excluded target layer', async () => {
    const materialization = await materializeProviderFreeFixtureProjectV1();
    const animated = withTrack(
      materialization.scene,
      track(materialization.scene, {
        kind: 'float',
        presetVersion: 1,
        axis: 'y',
        distancePx: -6,
      }),
    );
    const excluded = BannerSceneV1Schema.parse({
      ...animated,
      layers: animated.layers.map((layer, index) =>
        index === 0 ? { ...layer, included: false } : layer,
      ),
    });
    const plan = createBannerSceneV1RenderPlan(excluded);

    expect(plan.durationMs).toBe(0);
    expect(evaluateBannerSceneV1RenderPlan(plan, 500).layers[0]!.transform.translateY).toBe(0);
  });

  it('generates preview and export from one canonical plan without executable user text or preview exit URL', async () => {
    const materialization = await materializeProviderFreeFixtureProjectV1();
    const maliciousLookingName = '</script><img src=x onerror=alert(1)>';
    const scene = BannerSceneV1Schema.parse({
      ...materialization.scene,
      layers: materialization.scene.layers.map((layer, index) =>
        index === 0 ? { ...layer, name: maliciousLookingName } : layer,
      ),
    });
    const plan = createBannerSceneV1RenderPlan(scene);
    const before = canonicalizeJson(plan);
    const exportParts = createBannerSceneV1ExportDocumentParts({
      plan,
      assets: materialization.assets,
    });
    const previewBytes = createBannerSceneV1PreviewDocument({
      plan,
      assets: materialization.assets,
      nonce: '0123456789abcdef0123456789abcdef',
    });
    const preview = Buffer.from(previewBytes).toString('utf8');
    const previewPayload = runtimePayload(preview);
    const exportPayload = runtimePayload(exportParts.runtimeJavaScript);

    expect(canonicalizeJson(plan)).toBe(before);
    expect(exportParts.indexHtml).toContain('Content-Security-Policy');
    expect(exportParts.runtimeJavaScript).not.toContain(maliciousLookingName);
    expect(exportParts.runtimeJavaScript).not.toContain('innerHTML');
    expect(exportParts.runtimeJavaScript).not.toMatch(/\b(?:fetch|WebSocket|EventSource)\s*\(/);
    expect(preview).toContain(`content="${PREVIEW_CSP}"`);
    expect(preview).not.toContain(maliciousLookingName);
    expect(preview).not.toContain('https://example.com/campaign');
    expect(preview).not.toContain('innerHTML');
    expect(canonicalizeJson(previewPayload['plan'])).toBe(
      canonicalizeJson({ ...plan, interaction: { kind: 'none' } }),
    );
    expect(Object.values(previewPayload['sources'] as Record<string, string>)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^data:image\/png;base64,/u)]),
    );
    expect(Object.values(exportPayload['sources'] as Record<string, string>)).toContain(
      'assets/asset_version_angel_body_visual_v1.png',
    );
  });

  it('deep-freezes trusted plans and rejects forged or copied plan structures', async () => {
    const materialization = await materializeProviderFreeFixtureProjectV1();
    const plan = createBannerSceneV1RenderPlan(materialization.scene);

    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.interaction)).toBe(true);
    expect(Object.isFrozen(plan.layers)).toBe(true);
    expect(Object.isFrozen(plan.layers[0])).toBe(true);
    expect(Reflect.set(plan.interaction, 'destinationUrl', 'javascript:alert(1)')).toBe(false);
    expect(Reflect.set(plan.layers[0]!, 'name', '</script><script>alert(1)</script>')).toBe(false);

    const forged = {
      ...plan,
      interaction: { kind: 'single-exit', destinationUrl: 'javascript:alert(1)' },
    } as BannerSceneV1RenderPlan;
    expect(() =>
      createBannerSceneV1ExportDocumentParts({
        plan: forged,
        assets: materialization.assets,
      }),
    ).toThrow(/immutable validated/);
    expect(() => evaluateBannerSceneV1RenderPlan(structuredClone(plan), 0)).toThrow(
      /immutable validated/,
    );
  });

  it('rejects an unresolved or byte-mismatched asset before generating executable content', async () => {
    const materialization = await materializeProviderFreeFixtureProjectV1();
    const plan = createBannerSceneV1RenderPlan(materialization.scene);
    const required = materialization.assets.filter(
      (asset) => asset.reference.assetVersionId !== 'asset_version_angel_body_visual_v1',
    );
    expect(() =>
      createBannerSceneV1PreviewDocument({
        plan,
        assets: required,
        nonce: '0123456789abcdef0123456789abcdef',
      }),
    ).toThrow(/required render asset/);
    const corrupt = materialization.assets.map((asset, index) =>
      index === 1 ? { ...asset, bytes: Buffer.from('corrupt') } : asset,
    );
    expect(() => createBannerSceneV1ExportDocumentParts({ plan, assets: corrupt })).toThrow(
      /exact immutable identities/,
    );
  });
});
