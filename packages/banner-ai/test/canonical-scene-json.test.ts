import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  canonicalBannerSceneBytes,
  canonicalBannerSceneJson,
  canonicalizeJson,
  sha256BannerScene,
} from '../src/index.js';
import { loadAngelScene } from './fixture.js';

const independentlyPinnedAngelDigest =
  'fe760df85bed2f88c34eda3e0cdcd5840bef1b80eb60edcf9101bc306cea0b4a';

describe('canonical scene JSON', () => {
  it('matches an independently computed, hardcoded angel digest', () => {
    const scene = loadAngelScene();
    const bytes = canonicalBannerSceneBytes(scene);

    expect(bytes.byteLength).toBe(2_999);
    expect(sha256BannerScene(scene)).toBe(independentlyPinnedAngelDigest);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(independentlyPinnedAngelDigest);
  });

  it('recursively ASCII-sorts keys while preserving array order', () => {
    expect(canonicalizeJson({ z: { b: 1, a: 2 }, a: [{ y: 3, x: 4 }, 5] })).toBe(
      '{"a":[{"x":4,"y":3},5],"z":{"a":2,"b":1}}',
    );
  });

  it('retains an own __proto__ key without prototype pollution', () => {
    const input = JSON.parse('{"__proto__":{"x":1},"a":2}') as unknown;
    const canonical = canonicalizeJson(input);
    const reparsed = JSON.parse(canonical) as Record<string, unknown>;

    expect(canonical).toBe('{"__proto__":{"x":1},"a":2}');
    expect(Object.hasOwn(reparsed, '__proto__')).toBe(true);
    expect(Object.prototype).not.toHaveProperty('x');
  });

  it('normalizes negative zero without changing the parsed scene', () => {
    expect(canonicalizeJson({ value: -0 })).toBe('{"value":0}');
    expect(canonicalBannerSceneJson(loadAngelScene())).not.toContain('-0');
  });

  it('fails closed for non-NFC strings, non-finite numbers, and non-JSON values', () => {
    expect(() => canonicalizeJson({ value: 'Cafe\u0301' })).toThrow(/Non-NFC/);
    expect(() => canonicalizeJson({ value: Number.POSITIVE_INFINITY })).toThrow(/Non-finite/);
    expect(() => canonicalizeJson({ value: undefined })).toThrow(/Non-JSON/);
  });

  it('rejects sparse arrays instead of serializing holes as null', () => {
    const sparse = new Array<unknown>(1);

    expect(() => canonicalizeJson(sparse)).toThrow(/Sparse array/);
  });
});
