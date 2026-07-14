import { beforeAll, describe, expect, it } from 'vitest';

import { loadTrustedRealModelBenchmarkCorpusV1 } from '../src/server/real-model-benchmark-corpus-loader.js';
import {
  admittedManifest,
  authorizationFor,
  prepareSyntheticBenchmarkTestSources,
  selectedProfile,
} from './support/real-model-benchmark-test-support.js';

beforeAll(prepareSyntheticBenchmarkTestSources);

describe('production real-model corpus registry', () => {
  it('is explicitly empty and blocks before any source can be admitted', async () => {
    const manifest = admittedManifest();
    await expect(
      loadTrustedRealModelBenchmarkCorpusV1({
        manifest,
        authorizationContext: authorizationFor(selectedProfile(), manifest, { retryMode: 'zero' }),
      }),
    ).rejects.toThrow(/exactly three package-owned local sources/i);
  });
});
