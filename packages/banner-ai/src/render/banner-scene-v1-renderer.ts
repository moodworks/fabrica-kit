import { PREVIEW_CSP, PreviewMessageV1Schema } from '../security/preview-policy.js';
import {
  assetReferencesEqual,
  parseBannerSceneV1,
  type AnimationTrackV1,
  type AssetVersionRefV1,
  type BannerSceneV1,
} from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';

export interface BannerSceneV1RenderPlan {
  readonly renderPlanVersion: 1;
  readonly canvas: BannerSceneV1['canvas'];
  readonly layers: BannerSceneV1['layers'];
  readonly timeline: BannerSceneV1['timeline'];
  readonly interaction:
    | { readonly kind: 'none' }
    | {
        readonly kind: 'single-exit';
        readonly destinationUrl: string;
      };
  readonly durationMs: number;
}

export interface BannerSceneV1EvaluatedLayer {
  readonly id: string;
  readonly name: string;
  readonly order: number;
  readonly included: boolean;
  readonly visible: boolean;
  readonly asset: AssetVersionRefV1;
  readonly frame: BannerSceneV1['layers'][number]['frame'];
  readonly opacity: number;
  readonly transform: BannerSceneV1['layers'][number]['transform'];
}

export interface BannerSceneV1Evaluation {
  readonly timeMs: number;
  readonly layers: readonly BannerSceneV1EvaluatedLayer[];
}

export interface BannerRenderResolvedAssetV1 {
  readonly bytes: Uint8Array;
  readonly reference: AssetVersionRefV1;
}

export interface BannerSceneV1ExportDocumentParts {
  readonly indexHtml: string;
  readonly runtimeJavaScript: string;
  readonly stylesCss: string;
}

const trustedRenderPlans = new WeakSet<object>();

const deepFreezeRenderValue = <Value>(value: Value): Value => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreezeRenderValue(nested);
    Object.freeze(value);
  }
  return value;
};

const requireTrustedRenderPlan = (plan: BannerSceneV1RenderPlan): void => {
  if (!trustedRenderPlans.has(plan)) {
    throw new TypeError('Rendering requires an immutable validated BannerSceneV1 render plan.');
  }
};

const timelineDuration = (scene: BannerSceneV1): number => {
  const includedLayerIds = new Set(
    scene.layers.filter((layer) => layer.included).map((layer) => layer.id),
  );
  return scene.timeline.reduce(
    (duration, track) =>
      includedLayerIds.has(track.targetLayerId)
        ? Math.max(
            duration,
            track.timing.startMs + track.timing.durationMs * track.timing.iterations,
          )
        : duration,
    0,
  );
};

export const createBannerSceneV1RenderPlan = (
  sceneInput: BannerSceneV1,
): BannerSceneV1RenderPlan => {
  const parsed = parseBannerSceneV1(sceneInput);
  if (!parsed.success) throw new TypeError('A render plan requires a valid BannerSceneV1.');
  const scene = parsed.data;
  const interaction =
    scene.exportSettings.kind === 'static-png'
      ? ({ kind: 'none' } as const)
      : scene.exportSettings.interaction;
  const plan = deepFreezeRenderValue({
    renderPlanVersion: 1 as const,
    canvas: JSON.parse(canonicalizeJson(scene.canvas)) as BannerSceneV1['canvas'],
    layers: JSON.parse(canonicalizeJson(scene.layers)) as BannerSceneV1['layers'],
    timeline: JSON.parse(canonicalizeJson(scene.timeline)) as BannerSceneV1['timeline'],
    interaction,
    durationMs: timelineDuration(scene),
  });
  trustedRenderPlans.add(plan);
  return plan;
};

const cubicCoordinate = (time: number, first: number, second: number): number => {
  const inverse = 1 - time;
  return 3 * inverse * inverse * time * first + 3 * inverse * time * time * second + time ** 3;
};

const cubicDerivative = (time: number, first: number, second: number): number => {
  const inverse = 1 - time;
  return (
    3 * inverse * inverse * first +
    6 * inverse * time * (second - first) +
    3 * time * time * (1 - second)
  );
};

const cubicBezierProgress = (
  progress: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number => {
  if (progress === 0 || progress === 1) return progress;
  let parameter = progress;
  for (let index = 0; index < 8; index += 1) {
    const error = cubicCoordinate(parameter, x1, x2) - progress;
    const derivative = cubicDerivative(parameter, x1, x2);
    if (Math.abs(error) <= 1e-10 || Math.abs(derivative) < 1e-10) break;
    const next = parameter - error / derivative;
    if (next < 0 || next > 1) break;
    parameter = next;
  }
  let lower = 0;
  let upper = 1;
  for (let index = 0; index < 32; index += 1) {
    const value = cubicCoordinate(parameter, x1, x2);
    if (Math.abs(value - progress) <= 1e-10) break;
    if (value < progress) lower = parameter;
    else upper = parameter;
    parameter = (lower + upper) / 2;
  }
  return cubicCoordinate(parameter, y1, y2);
};

export const evaluateBannerEasingV1 = (
  easing: AnimationTrackV1['timing']['easing'],
  progress: number,
): number => {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new TypeError('Animation progress must be within the unit interval.');
  }
  switch (easing) {
    case 'linear':
      return progress;
    case 'ease-in':
      return cubicBezierProgress(progress, 0.42, 0, 1, 1);
    case 'ease-out':
      return cubicBezierProgress(progress, 0, 0, 0.58, 1);
    case 'ease-in-out':
      return cubicBezierProgress(progress, 0.42, 0, 0.58, 1);
  }
};

interface EvaluatedChannels {
  opacityFactor: number;
  translateX: number;
  translateY: number;
  scaleFactor: number;
  rotationDegrees: number;
}

const neutralChannels = (): EvaluatedChannels => ({
  opacityFactor: 1,
  translateX: 0,
  translateY: 0,
  scaleFactor: 1,
  rotationDegrees: 0,
});

const interpolate = (from: number, to: number, progress: number): number =>
  from + (to - from) * progress;

const evaluateTrackProgress = (track: AnimationTrackV1, timeMs: number): number | null => {
  const end = track.timing.startMs + track.timing.durationMs * track.timing.iterations;
  if (timeMs < track.timing.startMs || timeMs >= end) return null;
  const local = timeMs - track.timing.startMs;
  const iteration = Math.floor(local / track.timing.durationMs);
  const within = (local - iteration * track.timing.durationMs) / track.timing.durationMs;
  const directed =
    track.timing.iterationMode === 'alternate' && iteration % 2 === 1 ? 1 - within : within;
  return evaluateBannerEasingV1(track.timing.easing, directed);
};

const evaluateLayerChannels = (
  tracks: readonly AnimationTrackV1[],
  timeMs: number,
): EvaluatedChannels => {
  const channels = neutralChannels();
  for (const track of tracks) {
    const progress = evaluateTrackProgress(track, timeMs);
    if (progress === null) continue;
    switch (track.preset.kind) {
      case 'fade':
        channels.opacityFactor = interpolate(
          track.preset.fromFactor,
          track.preset.toFactor,
          progress,
        );
        break;
      case 'slide':
        channels.translateX = interpolate(track.preset.offsetX, 0, progress);
        channels.translateY = interpolate(track.preset.offsetY, 0, progress);
        break;
      case 'float':
        if (track.preset.axis === 'x') {
          channels.translateX = interpolate(0, track.preset.distancePx, progress);
        } else {
          channels.translateY = interpolate(0, track.preset.distancePx, progress);
        }
        break;
      case 'pulse':
        channels.scaleFactor = interpolate(track.preset.fromScale, track.preset.toScale, progress);
        break;
      case 'flutter':
        channels.rotationDegrees = interpolate(
          track.preset.fromDegrees,
          track.preset.toDegrees,
          progress,
        );
        break;
    }
  }
  return channels;
};

export const evaluateBannerSceneV1RenderPlan = (
  plan: BannerSceneV1RenderPlan,
  timeMs: number,
): BannerSceneV1Evaluation => {
  requireTrustedRenderPlan(plan);
  if (!Number.isFinite(timeMs) || timeMs < 0) {
    throw new TypeError('Render evaluation time must be finite and non-negative.');
  }
  return {
    timeMs,
    layers: plan.layers.map((layer) => {
      const channels = layer.included
        ? evaluateLayerChannels(
            plan.timeline.filter((track) => track.targetLayerId === layer.id),
            timeMs,
          )
        : neutralChannels();
      return {
        id: layer.id,
        name: layer.name,
        order: layer.order,
        included: layer.included,
        visible: layer.visible,
        asset: layer.asset,
        frame: layer.frame,
        opacity: layer.opacity * channels.opacityFactor,
        transform: {
          ...layer.transform,
          translateX: layer.transform.translateX + channels.translateX,
          translateY: layer.transform.translateY + channels.translateY,
          scaleX: layer.transform.scaleX * channels.scaleFactor,
          scaleY: layer.transform.scaleY * channels.scaleFactor,
          rotationDegrees: layer.transform.rotationDegrees + channels.rotationDegrees,
        },
      };
    }),
  };
};

const renderAssetReferences = (plan: BannerSceneV1RenderPlan): readonly AssetVersionRefV1[] => {
  const references = new Map<string, AssetVersionRefV1>();
  if (plan.canvas.background.kind === 'image') {
    references.set(plan.canvas.background.asset.assetVersionId, plan.canvas.background.asset);
  }
  for (const layer of plan.layers) {
    if (layer.included) references.set(layer.asset.assetVersionId, layer.asset);
  }
  return [...references.values()].sort((left, right) =>
    left.assetVersionId < right.assetVersionId
      ? -1
      : left.assetVersionId > right.assetVersionId
        ? 1
        : 0,
  );
};

const validateAndIndexAssets = (
  plan: BannerSceneV1RenderPlan,
  assets: readonly BannerRenderResolvedAssetV1[],
): ReadonlyMap<string, BannerRenderResolvedAssetV1> => {
  const byVersion = new Map<string, BannerRenderResolvedAssetV1>();
  for (const asset of assets) {
    if (
      byVersion.has(asset.reference.assetVersionId) ||
      asset.bytes.byteLength !== asset.reference.byteSize ||
      sha256Hex(asset.bytes) !== asset.reference.sha256
    ) {
      throw new TypeError('Render assets must have unique exact immutable identities.');
    }
    byVersion.set(asset.reference.assetVersionId, asset);
  }
  for (const reference of renderAssetReferences(plan)) {
    const resolved = byVersion.get(reference.assetVersionId);
    if (resolved === undefined || !assetReferencesEqual(reference, resolved.reference)) {
      throw new TypeError('A required render asset could not be resolved exactly.');
    }
  }
  return byVersion;
};

const encodeRuntimePayload = (value: unknown): string =>
  Buffer.from(canonicalizeJson(value), 'utf8').toString('base64');

const runtimeSource = (payloadBase64: string): string => `(() => {
  'use strict';
  const decode = (value) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), (character) => character.charCodeAt(0))));
  let input;
  try {
  input = decode('${payloadBase64}');
  const banner = document.getElementById('banner');
  const post = (message) => { if (input.mode === 'preview') parent.postMessage(message, '*'); };
  const cubic = (time, first, second) => { const inverse = 1 - time; return 3 * inverse * inverse * time * first + 3 * inverse * time * time * second + time ** 3; };
  const derivative = (time, first, second) => { const inverse = 1 - time; return 3 * inverse * inverse * first + 6 * inverse * time * (second - first) + 3 * time * time * (1 - second); };
  const bezier = (progress, x1, y1, x2, y2) => {
    if (progress === 0 || progress === 1) return progress;
    let parameter = progress;
    for (let index = 0; index < 8; index += 1) { const error = cubic(parameter, x1, x2) - progress; const slope = derivative(parameter, x1, x2); if (Math.abs(error) <= 1e-10 || Math.abs(slope) < 1e-10) break; const next = parameter - error / slope; if (next < 0 || next > 1) break; parameter = next; }
    let lower = 0; let upper = 1;
    for (let index = 0; index < 32; index += 1) { const value = cubic(parameter, x1, x2); if (Math.abs(value - progress) <= 1e-10) break; if (value < progress) lower = parameter; else upper = parameter; parameter = (lower + upper) / 2; }
    return cubic(parameter, y1, y2);
  };
  const ease = (name, progress) => name === 'linear' ? progress : name === 'ease-in' ? bezier(progress, .42, 0, 1, 1) : name === 'ease-out' ? bezier(progress, 0, 0, .58, 1) : bezier(progress, .42, 0, .58, 1);
  const mix = (from, to, progress) => from + (to - from) * progress;
  const elements = new Map();
  const sourceFor = (assetVersionId) => input.sources[assetVersionId];
  const addImage = (reference, label) => { const image = document.createElement('img'); image.alt = ''; image.draggable = false; image.src = sourceFor(reference.assetVersionId); image.setAttribute('data-layer-name', label); return image; };
  if (input.plan.canvas.background.kind === 'solid') banner.style.background = input.plan.canvas.background.color;
  if (input.plan.canvas.background.kind === 'image') { const background = addImage(input.plan.canvas.background.asset, 'Canvas background'); background.className = 'render-background'; background.style.objectFit = input.plan.canvas.background.fit; background.style.objectPosition = String(input.plan.canvas.background.positionX * 100) + '% ' + String(input.plan.canvas.background.positionY * 100) + '%'; background.style.opacity = String(input.plan.canvas.background.opacity); banner.append(background); }
  for (const layer of input.plan.layers) { if (!layer.included) continue; const image = addImage(layer.asset, layer.name); image.className = 'render-layer'; image.style.left = String(layer.frame.x) + 'px'; image.style.top = String(layer.frame.y) + 'px'; image.style.width = String(layer.frame.width) + 'px'; image.style.height = String(layer.frame.height) + 'px'; image.style.zIndex = String(layer.order + 1); image.style.visibility = layer.visible ? 'visible' : 'hidden'; image.style.transformOrigin = String(layer.transform.anchorX * 100) + '% ' + String(layer.transform.anchorY * 100) + '%'; banner.append(image); elements.set(layer.id, image); }
  const trackProgress = (track, timeMs) => { const end = track.timing.startMs + track.timing.durationMs * track.timing.iterations; if (timeMs < track.timing.startMs || timeMs >= end) return null; const local = timeMs - track.timing.startMs; const iteration = Math.floor(local / track.timing.durationMs); const within = (local - iteration * track.timing.durationMs) / track.timing.durationMs; return ease(track.timing.easing, track.timing.iterationMode === 'alternate' && iteration % 2 === 1 ? 1 - within : within); };
  const render = (timeMs) => { for (const layer of input.plan.layers) { const image = elements.get(layer.id); if (!image) continue; let opacity = 1; let x = 0; let y = 0; let scale = 1; let rotation = 0; for (const track of input.plan.timeline) { if (track.targetLayerId !== layer.id) continue; const progress = trackProgress(track, timeMs); if (progress === null) continue; const preset = track.preset; if (preset.kind === 'fade') opacity = mix(preset.fromFactor, preset.toFactor, progress); else if (preset.kind === 'slide') { x = mix(preset.offsetX, 0, progress); y = mix(preset.offsetY, 0, progress); } else if (preset.kind === 'float') { if (preset.axis === 'x') x = mix(0, preset.distancePx, progress); else y = mix(0, preset.distancePx, progress); } else if (preset.kind === 'pulse') scale = mix(preset.fromScale, preset.toScale, progress); else rotation = mix(preset.fromDegrees, preset.toDegrees, progress); } image.style.opacity = String(layer.opacity * opacity); image.style.transform = 'translate(' + String(layer.transform.translateX + x) + 'px,' + String(layer.transform.translateY + y) + 'px) rotate(' + String(layer.transform.rotationDegrees + rotation) + 'deg) scale(' + String(layer.transform.scaleX * scale) + ',' + String(layer.transform.scaleY * scale) + ')'; } };
  const activate = (event) => { if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return; event.preventDefault(); if (input.mode === 'preview') post({ type: 'exit', nonce: input.nonce }); else if (input.plan.interaction.kind === 'single-exit') window.location.href = input.plan.interaction.destinationUrl; };
  if (input.previewExitEnabled || input.plan.interaction.kind === 'single-exit') { banner.tabIndex = 0; banner.setAttribute('role', input.mode === 'preview' ? 'button' : 'link'); banner.setAttribute('aria-label', input.mode === 'preview' ? 'Report preview exit' : 'Open banner destination'); banner.addEventListener('click', activate); banner.addEventListener('keydown', activate); }
  render(0); post({ type: 'ready', nonce: input.nonce });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (input.plan.durationMs === 0 || reduced) { post({ type: 'progress', nonce: input.nonce, progressBps: 10000 }); return; }
  const started = performance.now();
  const frame = (now) => { const elapsed = Math.min(input.plan.durationMs, now - started); render(elapsed); post({ type: 'progress', nonce: input.nonce, progressBps: Math.min(10000, Math.floor(elapsed / input.plan.durationMs * 10000)) }); if (elapsed < input.plan.durationMs) requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
  } catch {
    if (input && input.mode === 'preview') parent.postMessage({ type: 'error', nonce: input.nonce, code: 'RENDER_FAILED', message: 'The isolated preview could not be rendered.' }, '*');
  }
})()`;

const trustedStyles = (plan: BannerSceneV1RenderPlan): string =>
  `html,body{margin:0;width:${String(plan.canvas.width)}px;height:${String(
    plan.canvas.height,
  )}px;overflow:hidden}#banner{position:relative;width:100%;height:100%;overflow:hidden}.render-background,.render-layer{position:absolute;display:block;margin:0;border:0;padding:0}.render-background{inset:0;width:100%;height:100%}`;

const sourcesFor = (
  plan: BannerSceneV1RenderPlan,
  assets: readonly BannerRenderResolvedAssetV1[],
  mode: 'export' | 'preview',
): Readonly<Record<string, string>> => {
  const indexed = validateAndIndexAssets(plan, assets);
  const sources: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const reference of renderAssetReferences(plan)) {
    const asset = indexed.get(reference.assetVersionId)!;
    sources[reference.assetVersionId] =
      mode === 'preview'
        ? `data:${reference.mediaType};base64,${Buffer.from(asset.bytes).toString('base64')}`
        : `assets/${reference.assetVersionId}.${reference.mediaType === 'image/png' ? 'png' : 'jpg'}`;
  }
  return sources;
};

export const createBannerSceneV1ExportDocumentParts = (input: {
  readonly plan: BannerSceneV1RenderPlan;
  readonly assets: readonly BannerRenderResolvedAssetV1[];
}): BannerSceneV1ExportDocumentParts => {
  requireTrustedRenderPlan(input.plan);
  const payload = {
    mode: 'export' as const,
    nonce: null,
    previewExitEnabled: false,
    plan: input.plan,
    sources: sourcesFor(input.plan, input.assets, 'export'),
  };
  return {
    indexHtml: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=${String(
      input.plan.canvas.width,
    )},height=${String(
      input.plan.canvas.height,
    )}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"><link rel="stylesheet" href="styles.css"></head><body><main id="banner" aria-label="Internal provider-free banner"></main><script src="runtime.js"></script></body></html>`,
    stylesCss: trustedStyles(input.plan),
    runtimeJavaScript: runtimeSource(encodeRuntimePayload(payload)),
  };
};

export const createBannerSceneV1PreviewDocument = (input: {
  readonly plan: BannerSceneV1RenderPlan;
  readonly assets: readonly BannerRenderResolvedAssetV1[];
  readonly nonce: string;
}): Uint8Array => {
  requireTrustedRenderPlan(input.plan);
  PreviewMessageV1Schema.parse({ type: 'ready', nonce: input.nonce });
  const payload = {
    mode: 'preview' as const,
    nonce: input.nonce,
    previewExitEnabled: input.plan.interaction.kind === 'single-exit',
    plan: { ...input.plan, interaction: { kind: 'none' as const } },
    sources: sourcesFor(input.plan, input.assets, 'preview'),
  };
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=${String(
    input.plan.canvas.width,
  )},height=${String(
    input.plan.canvas.height,
  )}"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><style>${trustedStyles(
    input.plan,
  )}</style></head><body><main id="banner" aria-label="Isolated provider-free banner preview"></main><script>${runtimeSource(
    encodeRuntimePayload(payload),
  )}</script></body></html>`;
  return Buffer.from(html, 'utf8');
};
