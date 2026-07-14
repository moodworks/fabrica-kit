import type { RepositoryFixtureInputRefV1 } from '../evaluation/ai-contracts.js';
import type { AdmittedRealModelBenchmarkCorpusEntryV1 } from '../evaluation/real-model-benchmark-corpus-manifest.js';

export interface RealModelBenchmarkStaticCorpusSourceV1 {
  readonly sourceVersion: 1;
  readonly fixtureId: AdmittedRealModelBenchmarkCorpusEntryV1['fixtureId'];
  readonly requestFixtureBinding: RepositoryFixtureInputRefV1;
  readonly filename: string;
  readonly declaredContentType: 'image/jpeg' | 'image/png';
  readonly originalBytes: Uint8Array;
}

/**
 * Production is intentionally empty. A later corpus-intake milestone must add reviewed,
 * repository-local sources here; callers cannot inject sources through the loader API.
 */
export const REAL_MODEL_BENCHMARK_STATIC_CORPUS_SOURCE_REGISTRY_V1 = Object.freeze(
  [] as readonly RealModelBenchmarkStaticCorpusSourceV1[],
);
