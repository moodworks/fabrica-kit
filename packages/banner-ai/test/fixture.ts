import { readFileSync } from 'node:fs';

import { parseBannerSceneV1, type BannerSceneV1 } from '../src/index.js';

const fixtureUrl = new URL('./fixtures/scenes/angel-v1.json', import.meta.url);

export const loadAngelInput = (): unknown =>
  JSON.parse(readFileSync(fixtureUrl, 'utf8')) as unknown;

export const loadAngelRecord = (): Record<string, unknown> => {
  const input = loadAngelInput();
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Angel fixture must be a JSON object.');
  }
  return input as Record<string, unknown>;
};

export const loadAngelScene = (): BannerSceneV1 => {
  const parsed = parseBannerSceneV1(loadAngelInput());
  if (!parsed.success) {
    throw new TypeError(`Angel fixture is invalid: ${JSON.stringify(parsed.issues)}`);
  }
  return parsed.data;
};

export const cloneRecord = (input: Record<string, unknown>): Record<string, unknown> =>
  structuredClone(input);

export const valueAt = (root: unknown, path: readonly (number | string)[]): unknown => {
  let value = root;
  for (const segment of path) {
    if (value === null || typeof value !== 'object') {
      throw new TypeError(`Fixture path is not traversable: ${path.join('/')}.`);
    }
    value = (value as Record<number | string, unknown>)[segment];
  }
  return value;
};

export const recordAt = (
  root: unknown,
  path: readonly (number | string)[],
): Record<string, unknown> => {
  const value = valueAt(root, path);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Fixture path is not an object: ${path.join('/')}.`);
  }
  return value as Record<string, unknown>;
};

export const arrayAt = (root: unknown, path: readonly (number | string)[]): unknown[] => {
  const value = valueAt(root, path);
  if (!Array.isArray(value)) {
    throw new TypeError(`Fixture path is not an array: ${path.join('/')}.`);
  }
  return value;
};

export const setAt = (root: unknown, path: readonly (number | string)[], value: unknown): void => {
  const parent = path.slice(0, -1);
  const key = path.at(-1);
  if (key === undefined) {
    throw new TypeError('Cannot replace the fixture root.');
  }
  const container = valueAt(root, parent);
  if (container === null || typeof container !== 'object') {
    throw new TypeError(`Fixture parent is not an object: ${parent.join('/')}.`);
  }
  (container as Record<number | string, unknown>)[key] = value;
};

export const deleteAt = (root: unknown, path: readonly (number | string)[]): void => {
  const parent = path.slice(0, -1);
  const key = path.at(-1);
  if (key === undefined) {
    throw new TypeError('Cannot delete the fixture root.');
  }
  const container = valueAt(root, parent);
  if (container === null || typeof container !== 'object') {
    throw new TypeError(`Fixture parent is not an object: ${parent.join('/')}.`);
  }
  delete (container as Record<number | string, unknown>)[key];
};
