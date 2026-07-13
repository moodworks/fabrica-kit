import { createHash } from 'node:crypto';

import type { BannerSceneV1 } from './banner-scene-v1.schema.js';

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

const asciiKeyPattern = /^[\x20-\x7e]+$/;

const normalizeJsonValue = (value: unknown, path: string): JsonValue => {
  if (value === null || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value.normalize('NFC') !== value) {
      throw new TypeError(`Non-NFC string at ${path}.`);
    }
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new TypeError(`Non-finite number at ${path}.`);
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (Array.isArray(value)) {
    const normalized: JsonValue[] = [];
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        throw new TypeError(`Sparse array entry at ${path}/${index}.`);
      }
      normalized.push(normalizeJsonValue(value[index], `${path}/${index}`));
    }
    return normalized;
  }

  if (typeof value === 'object') {
    const normalized = Object.create(null) as Record<string, JsonValue>;
    const entries = Object.entries(value).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );

    for (const [key, entry] of entries) {
      if (!asciiKeyPattern.test(key)) {
        throw new TypeError(`Non-ASCII or empty key at ${path}.`);
      }
      normalized[key] = normalizeJsonValue(entry, `${path}/${key}`);
    }

    return normalized;
  }

  throw new TypeError(`Non-JSON value at ${path}.`);
};

export const canonicalizeJson = (value: unknown): string =>
  JSON.stringify(normalizeJsonValue(value, ''));

export const canonicalBannerSceneJson = (scene: BannerSceneV1): string => canonicalizeJson(scene);

export const canonicalBannerSceneBytes = (scene: BannerSceneV1): Uint8Array =>
  Buffer.from(canonicalBannerSceneJson(scene), 'utf8');

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

export const sha256BannerScene = (scene: BannerSceneV1): string =>
  sha256Hex(canonicalBannerSceneBytes(scene));
