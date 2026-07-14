import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as publicBannerAi from '../src/index.js';
import {
  OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1,
  PROVIDER_FREE_COMPOSITION_POLICY,
  ProviderNeutralHumanOracleV1Schema,
  REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1,
  PendingRealModelBenchmarkCorpusV1Schema,
  admitRealModelBenchmarkCorpusV1,
  createProviderFreeFakeSceneAnalysisAdapterV1,
  dispatchProviderFreeCapability,
} from '../src/index.js';
import {
  buildNonDispatchingOpenAiRequestPlanV1,
  createNonNetworkingOpenAiAdapterStubV1,
} from '../src/server/openai-real-model-request-boundary.js';
import { REAL_MODEL_BENCHMARK_STATIC_CORPUS_SOURCE_REGISTRY_V1 } from '../src/server/real-model-benchmark-corpus-source-registry.js';
import { loadTrustedRealModelBenchmarkCorpusV1 } from '../src/server/real-model-benchmark-corpus-loader.js';
import { loadVerifiedPendingRealModelBenchmarkCorpusV1 } from '../src/server/real-model-benchmark-pending-corpus-loader.js';

const sourceRegistryModulePath =
  '../src/server/real-model-benchmark-pending-corpus-source-registry.js';
const rasterUploadModulePath = '../src/security/raster-upload.js';

type PendingSourceRegistryModule =
  typeof import('../src/server/real-model-benchmark-pending-corpus-source-registry.js');
type PendingLoaderModule =
  typeof import('../src/server/real-model-benchmark-pending-corpus-loader.js');
type RasterUploadModule = typeof import('../src/security/raster-upload.js');

type Mutable<T> = T extends readonly (infer Entry)[]
  ? Mutable<Entry>[]
  : T extends Uint8Array
    ? Uint8Array
    : T extends object
      ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
      : T;

const resetPendingModuleMocks = (): void => {
  vi.doUnmock(sourceRegistryModulePath);
  vi.doUnmock(rasterUploadModulePath);
  vi.resetModules();
};

afterEach(resetPendingModuleMocks);

const importLoaderWithFileMutation = async (
  targetReference: Parameters<PendingSourceRegistryModule['readPendingCorpusPackageFileV1']>[0],
): Promise<PendingLoaderModule> => {
  resetPendingModuleMocks();
  vi.doMock(sourceRegistryModulePath, async (importOriginal) => {
    const actual = await importOriginal<PendingSourceRegistryModule>();
    return {
      ...actual,
      async readPendingCorpusPackageFileV1(
        reference: Parameters<PendingSourceRegistryModule['readPendingCorpusPackageFileV1']>[0],
      ) {
        const bytes = await actual.readPendingCorpusPackageFileV1(reference);
        if (reference !== targetReference) return bytes;
        const changed = Uint8Array.from(bytes);
        const index = Math.min(100, changed.byteLength - 1);
        changed[index] = changed[index]! ^ 1;
        return changed;
      },
    };
  });
  return import('../src/server/real-model-benchmark-pending-corpus-loader.js');
};

const importLoaderWithRenormalizationDrift = async (): Promise<PendingLoaderModule> => {
  resetPendingModuleMocks();
  vi.doMock(rasterUploadModulePath, async (importOriginal) => {
    const actual = await importOriginal<RasterUploadModule>();
    return {
      ...actual,
      async normalizeRasterUpload(
        input: Parameters<RasterUploadModule['normalizeRasterUpload']>[0],
      ) {
        const normalized = await actual.normalizeRasterUpload(input);
        if (input.filename !== 'banner-person-v1.png') return normalized;
        return { ...normalized, sha256: 'f'.repeat(64) };
      },
    };
  });
  return import('../src/server/real-model-benchmark-pending-corpus-loader.js');
};

const mutablePendingManifest = (): Mutable<typeof REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1> =>
  structuredClone(REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1) as unknown as Mutable<
    typeof REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1
  >;

describe('provider-free three-banner pending corpus', () => {
  it('loads exactly three fixed fixtures and reproduces every pinned byte/type/dimension/hash', async () => {
    const verified = await loadVerifiedPendingRealModelBenchmarkCorpusV1({
      manifest: REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1,
    });
    expect(verified).toEqual({
      verificationVersion: 1,
      status: 'oracle-review-pending',
      pendingCoreSha256: '961331ea74f826d428a0aabcbf44378cd583856a3101a3a59495e97040aa8b3c',
      fixtureCount: 3,
      entries: [
        {
          fixtureId: 'banner-person-v1',
          original: {
            detectedMediaType: 'image/png',
            byteSize: 229_241,
            pixelWidth: 876,
            pixelHeight: 221,
            sha256: 'd9a5a64f4fb4353a11d2fac605049b8cf1565ee8a056cf792f0181d1798189d3',
          },
          normalized: {
            detectedMediaType: 'image/png',
            byteSize: 241_013,
            pixelWidth: 876,
            pixelHeight: 221,
            sha256: '6e3175cdd260fde33a3885945eb6f8831da3905afbc723f684035f411dc6d699',
          },
        },
        {
          fixtureId: 'banner-product-v1',
          original: {
            detectedMediaType: 'image/jpeg',
            byteSize: 217_384,
            pixelWidth: 2_015,
            pixelHeight: 900,
            sha256: 'ce1be4eacbd65763d1d2b2835f9ad49c50cd9b3f56edc4a6a289822965bf09c5',
          },
          normalized: {
            detectedMediaType: 'image/png',
            byteSize: 1_984_404,
            pixelWidth: 2_015,
            pixelHeight: 900,
            sha256: 'a38db6f627ee275eabf7643c99a83aac5e1ac77bbfe1b1abcc24112c6a04e69a',
          },
        },
        {
          fixtureId: 'banner-text-heavy-v1',
          original: {
            detectedMediaType: 'image/jpeg',
            byteSize: 25_417,
            pixelWidth: 416,
            pixelHeight: 522,
            sha256: '886afa4806fd252175d08a56eb5cae4989f3ac59c6a0c6e0a59f8a6d61195d77',
          },
          normalized: {
            detectedMediaType: 'image/png',
            byteSize: 166_461,
            pixelWidth: 416,
            pixelHeight: 522,
            sha256: '181e4c3762b79b5dfcbdb21c6c873ede8b32bf85dfe98fdecc13d59fb8cbcb62',
          },
        },
      ],
      active: false,
      admissionAuthority: false,
      requestPlanAuthority: false,
      dispatchAuthority: false,
    });
    expect(Object.isFrozen(verified)).toBe(true);
    expect(Object.isFrozen(verified.entries)).toBe(true);
    expect(verified.entries.every((entry) => Object.isFrozen(entry))).toBe(true);
    const serialized = JSON.stringify(verified);
    expect(serialized).not.toMatch(
      /(?:base64|data:image|packageRelativePath|\/fixtures\/|"bytes")/u,
    );
  });

  it('fails closed on original, stored-normalized, and fresh re-normalization drift', async () => {
    const originalDriftLoader = await importLoaderWithFileMutation('person-original');
    await expect(
      originalDriftLoader.loadVerifiedPendingRealModelBenchmarkCorpusV1({
        manifest: REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1,
      }),
    ).rejects.toThrow(/original|container|checksum|drifted/i);

    const normalizedDriftLoader = await importLoaderWithFileMutation('product-normalized');
    await expect(
      normalizedDriftLoader.loadVerifiedPendingRealModelBenchmarkCorpusV1({
        manifest: REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1,
      }),
    ).rejects.toThrow(
      /normalized|container|checksum|drifted|vipspng|libpng|read error|warning treated as error|failOn setting/i,
    );

    const renormalizationDriftLoader = await importLoaderWithRenormalizationDrift();
    await expect(
      renormalizationDriftLoader.loadVerifiedPendingRealModelBenchmarkCorpusV1({
        manifest: REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1,
      }),
    ).rejects.toThrow(/fresh trusted normalization.*differs/i);
  });

  it('rejects duplicate original, normalized, and cross-set digests', () => {
    const cases = [
      (() => {
        const manifest = mutablePendingManifest();
        manifest.entries[1]!.packageOriginal.sha256 = manifest.entries[0]!.packageOriginal.sha256;
        return manifest;
      })(),
      (() => {
        const manifest = mutablePendingManifest();
        manifest.entries[1]!.canonicalNormalized.sha256 =
          manifest.entries[0]!.canonicalNormalized.sha256;
        return manifest;
      })(),
      (() => {
        const manifest = mutablePendingManifest();
        manifest.entries[2]!.canonicalNormalized.sha256 =
          manifest.entries[0]!.packageOriginal.sha256;
        return manifest;
      })(),
    ];
    for (const manifest of cases) {
      const result = PendingRealModelBenchmarkCorpusV1Schema.safeParse(manifest);
      expect(result.success).toBe(false);
      if (result.success) throw new TypeError('Expected pending digest uniqueness rejection.');
    }
  });

  it('rejects license, privacy, transmission, cap, manual-control, and repository substitution', () => {
    const substitutions: readonly ((
      manifest: ReturnType<typeof mutablePendingManifest>,
    ) => void)[] = [
      (manifest) => {
        manifest.entries[0]!.intakeEvidence.rightsAssertion = 'user-owned' as never;
      },
      (manifest) => {
        manifest.entries[0]!.intakeEvidence.humanPrivacyAdmissionStatus = 'approved' as never;
      },
      (manifest) => {
        manifest.entries[0]!.sourceAudit.localMetadataPrivacy.originalAncillaryByteSize += 1;
      },
      (manifest) => {
        manifest.entries[0]!.intakeEvidence.transmissionScope =
          'another-provider-or-purpose' as never;
      },
      (manifest) => {
        manifest.entries[0]!.intakeEvidence.exactUserStatement =
          `${manifest.entries[0]!.intakeEvidence.exactUserStatement} ` as never;
      },
      (manifest) => {
        manifest.entries[0]!.intakeEvidence.caps.perCallCostCeilingMicroUsd = 100_001 as never;
      },
      (manifest) => {
        manifest.entries[0]!.intakeEvidence.manualControl.revision = 2 as never;
      },
      (manifest) => {
        manifest.repositoryBindings.profileSha256 = 'f'.repeat(64) as never;
      },
      (manifest) => {
        manifest.repositoryBindings.workflowDefinitionSha256 = 'f'.repeat(64) as never;
      },
    ];
    for (const substitute of substitutions) {
      const manifest = mutablePendingManifest();
      substitute(manifest);
      expect(PendingRealModelBenchmarkCorpusV1Schema.safeParse(manifest).success).toBe(false);
    }
  });

  it('keeps Codex drafts structurally incompatible with approved human evidence', () => {
    for (const entry of REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1.entries) {
      expect(entry.draftReview).toMatchObject({
        evidenceRole: 'codex-draft-unapproved',
        reviewStatus: 'draft-unapproved',
        humanApprovalAuthority: false,
      });
      expect(ProviderNeutralHumanOracleV1Schema.safeParse(entry.draftReview).success).toBe(false);
      expect(entry.draftReview).not.toHaveProperty('oracleVersion');
      expect(entry.draftReview).not.toHaveProperty('requiredLayers');
      expect(entry.draftReview).not.toHaveProperty('expectedTextOccurrences');
    }
  });

  it('cannot be admitted, loaded as admitted, or used to create a request plan', async () => {
    expect(() => admitRealModelBenchmarkCorpusV1(REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1)).toThrow();

    let authorizationRead = false;
    const admittedLoaderInput: Record<string, unknown> = {
      manifest: REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1,
    };
    Object.defineProperty(admittedLoaderInput, 'authorizationContext', {
      enumerable: true,
      get() {
        authorizationRead = true;
        throw new TypeError('Authorization inspection must not occur for a pending manifest.');
      },
    });
    await expect(
      loadTrustedRealModelBenchmarkCorpusV1(admittedLoaderInput as never),
    ).rejects.toThrow();
    expect(authorizationRead).toBe(false);

    const pendingMetadata = await loadVerifiedPendingRealModelBenchmarkCorpusV1({
      manifest: REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1,
    });
    for (const injectedAuthority of [
      { sourcePath: '/caller/path.png' },
      { sourceUrl: 'https://example.invalid/banner.png' },
      { sourceBytes: new Uint8Array([1]) },
      { registry: [] },
      { provider: 'openai' },
      { authorization: {} },
    ]) {
      await expect(
        loadVerifiedPendingRealModelBenchmarkCorpusV1({
          manifest: REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1,
          ...injectedAuthority,
        }),
      ).rejects.toThrow();
    }
    expect(() =>
      buildNonDispatchingOpenAiRequestPlanV1({
        profile: OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1,
        corpusCapability: pendingMetadata as never,
        request: {},
        fixtureId: 'banner-person-v1',
        manualControl: {},
        executionPreparation: {
          providerCallIdentity: {},
          providerRequestSha256: '',
          callTarget: {},
          ordinals: {},
          ledger: {},
          estimatedCostMicros: '0',
          attemptedProviderCallTimeoutMs: 0,
        },
      }),
    ).toThrow(/capability.*absent|cloned|forged/i);
    expect(REAL_MODEL_BENCHMARK_STATIC_CORPUS_SOURCE_REGISTRY_V1).toEqual([]);
  });

  it('cannot enter browser routes, the fake adapter, provider-free dispatch, or the server stub', async () => {
    const pendingMetadata = await loadVerifiedPendingRealModelBenchmarkCorpusV1({
      manifest: REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1,
    });
    expect(() =>
      createProviderFreeFakeSceneAnalysisAdapterV1().invoke(pendingMetadata as never, 'success'),
    ).toThrow();
    await expect(
      dispatchProviderFreeCapability({
        policy: PROVIDER_FREE_COMPOSITION_POLICY,
        execution: pendingMetadata as never,
      }),
    ).rejects.toThrow(/not materialized/i);

    const serverStub = createNonNetworkingOpenAiAdapterStubV1();
    expect('dispatch' in serverStub).toBe(false);
    expect(() => serverStub.refuse(pendingMetadata as never)).toThrow(/absent|cloned|forged/i);

    const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
    const collectTypeScript = (directory: string): readonly string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return collectTypeScript(path);
        return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
      });
    const routes = collectTypeScript(join(repositoryRoot, 'apps/web/src')).filter((path) =>
      path.endsWith('/route.ts'),
    );
    expect(routes.length).toBeGreaterThan(0);
    for (const routePath of routes) {
      const route = readFileSync(routePath, 'utf8');
      expect(route, routePath).not.toContain('real-model-benchmark-pending-corpus');
      expect(route, routePath).not.toContain('real-model-benchmark-pending-corpus-loader');
    }
  });

  it('introduces no provider/network/secret surface and exports no pending server authority', () => {
    const packageRoot = fileURLToPath(new URL('..', import.meta.url));
    const surfacePaths = [
      join(packageRoot, 'src/evaluation/real-model-benchmark-pending-corpus.ts'),
      join(packageRoot, 'src/server/real-model-benchmark-pending-corpus-source-registry.ts'),
      join(packageRoot, 'src/server/real-model-benchmark-pending-corpus-loader.ts'),
    ];
    const source = surfacePaths.map((path) => readFileSync(path, 'utf8')).join('\n');
    expect(source).not.toMatch(
      /from\s+['"](?:openai|@anthropic-ai|@google|replicate|undici)(?:\/[^'"]*)?['"]/u,
    );
    expect(source).not.toMatch(
      /from\s+['"](?:node:)?(?:http|https|http2|net|dns|dgram|tls)(?:\/[^'"]*)?['"]|\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/u,
    );
    expect(source).not.toMatch(
      /\b(?:process\.env|Deno\.env|Bun\.env|import\.meta\.env)\b|OPENAI_API_KEY/u,
    );
    for (const serverAuthority of [
      'REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V1',
      'readPendingCorpusPackageFileV1',
      'loadVerifiedPendingRealModelBenchmarkCorpusV1',
    ]) {
      expect(publicBannerAi).not.toHaveProperty(serverAuthority);
    }
  });
});
