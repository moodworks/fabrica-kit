import { describe, expect, it } from 'vitest';

import {
  PROVIDER_FREE_PROJECT_STORAGE_KEY,
  readStoredProviderFreeProject,
  resetStoredProviderFreeProject,
  writeStoredProviderFreeProject,
  type BannerProjectStorage,
} from './banner-ai-project-storage';

const memoryStorage = (): BannerProjectStorage & { readonly values: Map<string, string> } => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
};

describe('provider-free project browser storage adapter', () => {
  it('writes one canonical value and requires exact readback', () => {
    const storage = memoryStorage();
    const canonical = '{"envelopeVersion":1}';

    expect(writeStoredProviderFreeProject(storage, canonical)).toEqual({
      success: true,
      canonicalProjectJson: canonical,
    });
    expect(storage.values).toEqual(new Map([[PROVIDER_FREE_PROJECT_STORAGE_KEY, canonical]]));
    expect(readStoredProviderFreeProject(storage)).toEqual({
      status: 'available',
      canonicalProjectJson: canonical,
    });
  });

  it('closes quota and readback failures without changing accepted in-memory input', () => {
    const acceptedProject = Object.freeze({ revision: 1, digest: 'accepted' });
    const quotaStorage: BannerProjectStorage = {
      getItem: () => '{"revision":1}',
      removeItem: () => undefined,
      setItem: () => {
        throw new DOMException('Quota exceeded', 'QuotaExceededError');
      },
    };
    const mismatchedReadback: BannerProjectStorage = {
      getItem: () => '{"corrupt":true}',
      removeItem: () => undefined,
      setItem: () => undefined,
    };

    expect(writeStoredProviderFreeProject(quotaStorage, '{"revision":2}').success).toBe(false);
    expect(writeStoredProviderFreeProject(mismatchedReadback, '{"revision":2}').success).toBe(
      false,
    );
    expect(acceptedProject).toEqual({ revision: 1, digest: 'accepted' });
  });

  it('removes only the fixed demo key after explicit reset', () => {
    const storage = memoryStorage();
    storage.values.set(PROVIDER_FREE_PROJECT_STORAGE_KEY, 'demo');
    storage.values.set('unrelated', 'keep');

    expect(resetStoredProviderFreeProject(storage)).toBe(true);
    expect(storage.values).toEqual(new Map([['unrelated', 'keep']]));
  });

  it('reports unavailable storage without leaking the thrown cause', () => {
    const storage: BannerProjectStorage = {
      getItem: () => {
        throw new Error('/private/path should not escape');
      },
      removeItem: () => undefined,
      setItem: () => undefined,
    };

    expect(readStoredProviderFreeProject(storage)).toEqual({ status: 'unavailable' });
  });
});
