import { PROVIDER_FREE_PROJECT_STORAGE_KEY_V1 } from '@fabrica/banner-ai/browser';

export const PROVIDER_FREE_PROJECT_STORAGE_KEY = PROVIDER_FREE_PROJECT_STORAGE_KEY_V1;

export interface BannerProjectStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export type StoredProjectReadResult =
  | { readonly status: 'missing' }
  | { readonly status: 'available'; readonly canonicalProjectJson: string }
  | { readonly status: 'unavailable' };

export type StoredProjectWriteResult =
  | { readonly success: true; readonly canonicalProjectJson: string }
  | { readonly success: false; readonly code: 'PROJECT_STORAGE_WRITE_FAILED' };

export const readStoredProviderFreeProject = (
  storage: BannerProjectStorage,
): StoredProjectReadResult => {
  try {
    const canonicalProjectJson = storage.getItem(PROVIDER_FREE_PROJECT_STORAGE_KEY);
    return canonicalProjectJson === null
      ? { status: 'missing' }
      : { status: 'available', canonicalProjectJson };
  } catch {
    return { status: 'unavailable' };
  }
};

/**
 * localStorage setItem is atomic. Exact readback prevents reporting a save
 * unless the validated server-produced canonical bytes are the bytes stored.
 */
export const writeStoredProviderFreeProject = (
  storage: BannerProjectStorage,
  canonicalProjectJson: string,
): StoredProjectWriteResult => {
  try {
    storage.setItem(PROVIDER_FREE_PROJECT_STORAGE_KEY, canonicalProjectJson);
    const readBack = storage.getItem(PROVIDER_FREE_PROJECT_STORAGE_KEY);
    return readBack === canonicalProjectJson
      ? { success: true, canonicalProjectJson: readBack }
      : { success: false, code: 'PROJECT_STORAGE_WRITE_FAILED' };
  } catch {
    return { success: false, code: 'PROJECT_STORAGE_WRITE_FAILED' };
  }
};

export const resetStoredProviderFreeProject = (storage: BannerProjectStorage): boolean => {
  try {
    storage.removeItem(PROVIDER_FREE_PROJECT_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
};
