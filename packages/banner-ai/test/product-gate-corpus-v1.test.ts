import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
  copyFile,
} from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PRODUCT_GATE_BLOCKED_HOLDOUT_V1,
  PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
  ProductGateBlockedHoldoutManifestV1Schema,
  ProductGateDevelopmentCorpusManifestV1Schema,
  digestProductGateDevelopmentCorpusV1,
  rejectBlockedProductGateHoldoutExecutionV1,
  requireExactProductGateDevelopmentCorpusV1,
} from '../src/evaluation/product-gate-corpus-v1.js';
import { loadVerifiedProductGateDevelopmentCorpusV1 } from '../src/server/product-gate-development-corpus-loader-v1.js';

const temporaryRoots = new Set<string>();
const packagePrefix = 'packages/banner-ai/test/fixtures/real-model-benchmark/';

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all([...temporaryRoots].map((root) => rm(root, { recursive: true, force: true })));
  temporaryRoots.clear();
});

const copyFixtureTree = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'fabrica-product-gate-corpus-'));
  temporaryRoots.add(root);
  await Promise.all([mkdir(join(root, 'original')), mkdir(join(root, 'normalized'))]);
  for (const entry of PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.entries) {
    for (const source of [entry.original, entry.normalized]) {
      const child = source.packageRelativePath.slice(packagePrefix.length);
      await copyFile(resolve(source.packageRelativePath), join(root, child));
    }
  }
  return root;
};

describe('Phase 3A development and blocked-holdout corpus contracts', () => {
  it('binds the exact four development source, normalization, and oracle identities', () => {
    expect(PRODUCT_GATE_DEVELOPMENT_CORPUS_V1).toMatchObject({
      split: 'development',
      status: 'development-only',
      fixtureCount: 4,
      holdoutAdmitted: false,
      productGateDenominatorAvailable: false,
      providerTransmissionAuthority: false,
      realEvaluationAuthority: false,
    });
    expect(
      PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.entries.map((entry) => ({
        caseId: entry.caseId,
        original: entry.original.sha256,
        normalized: entry.normalized.sha256,
        oracle: entry.oracle.oracleSha256,
      })),
    ).toEqual([
      {
        caseId: 'banner-person-v1',
        original: 'd9a5a64f4fb4353a11d2fac605049b8cf1565ee8a056cf792f0181d1798189d3',
        normalized: '6e3175cdd260fde33a3885945eb6f8831da3905afbc723f684035f411dc6d699',
        oracle: '2a1acd4e0c2efbaead58db83339877225fb2e2d0656a880be777f01c5187dafd',
      },
      {
        caseId: 'banner-product-v1',
        original: 'ce1be4eacbd65763d1d2b2835f9ad49c50cd9b3f56edc4a6a289822965bf09c5',
        normalized: 'a38db6f627ee275eabf7643c99a83aac5e1ac77bbfe1b1abcc24112c6a04e69a',
        oracle: 'bf9d42ed77e5aa3e8dedf3b593d65802bacdb38314b2df8e31632272d0e5e019',
      },
      {
        caseId: 'banner-text-heavy-v1',
        original: '886afa4806fd252175d08a56eb5cae4989f3ac59c6a0c6e0a59f8a6d61195d77',
        normalized: '181e4c3762b79b5dfcbdb21c6c873ede8b32bf85dfe98fdecc13d59fb8cbcb62',
        oracle: '80a2407ade80036bb82eb1c7cb486b418eb6c8b369668844a978caf4d88a9fa1',
      },
      {
        caseId: 'banner-no-text-v1',
        original: 'af4ee315a16887692aaec4e972615535a086a906b43257eb1c78aa50212d31c3',
        normalized: '40f8a1c4312ec86cb4e38e16b9a423e85c2a9e3cf5f98a4bc510c23f3d4cf073',
        oracle: '14152119e3a999bba8f5ffe48aec6138c9f678ded6cd7071945b76b5792a8c38',
      },
    ]);
    const { manifestSha256, ...core } = PRODUCT_GATE_DEVELOPMENT_CORPUS_V1;
    expect(digestProductGateDevelopmentCorpusV1(core)).toBe(manifestSha256);
  });

  it('rejects unknown keys, reordered entries, authority drift, and rehashed substitutions', () => {
    expect(
      ProductGateDevelopmentCorpusManifestV1Schema.safeParse({
        ...PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
        unexpected: true,
      }).success,
    ).toBe(false);
    const reordered = {
      ...structuredClone(PRODUCT_GATE_DEVELOPMENT_CORPUS_V1),
      entries: [
        PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.entries[1],
        PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.entries[0],
        PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.entries[2],
        PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.entries[3],
      ],
    };
    const { manifestSha256: oldManifestSha256, ...reorderedCore } = reordered;
    expect(oldManifestSha256).toBe(PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.manifestSha256);
    expect(() =>
      requireExactProductGateDevelopmentCorpusV1({
        ...reorderedCore,
        manifestSha256: digestProductGateDevelopmentCorpusV1(reorderedCore),
      }),
    ).toThrow();
    expect(
      ProductGateDevelopmentCorpusManifestV1Schema.safeParse({
        ...PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
        providerTransmissionAuthority: true,
      }).success,
    ).toBe(false);
  });

  it('represents the absent 18-case holdout as strictly blocked and non-measurable', () => {
    expect(PRODUCT_GATE_BLOCKED_HOLDOUT_V1).toMatchObject({
      split: 'holdout',
      expectedCaseCount: 18,
      admittedCaseCount: 0,
      entries: [],
      holdoutAdmitted: false,
      providerTransmissionAuthority: false,
      realEvaluationAuthority: false,
      productGateDenominator: 'unavailable',
      productGateOutcome: 'not-measurable',
    });
    expect(() =>
      rejectBlockedProductGateHoldoutExecutionV1(PRODUCT_GATE_BLOCKED_HOLDOUT_V1),
    ).toThrow(/not admitted/u);
    expect(
      ProductGateBlockedHoldoutManifestV1Schema.safeParse({
        ...PRODUCT_GATE_BLOCKED_HOLDOUT_V1,
        entries: [{ caseId: 'invented' }],
      }).success,
    ).toBe(false);
  });
});

describe('Phase 3A development corpus loader', () => {
  it('verifies committed bytes, fresh normalization, and oracle bindings without network access', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network forbidden');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const verified = await loadVerifiedProductGateDevelopmentCorpusV1({
      manifest: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
      sourceRoot: { kind: 'committed-package-root' },
    });
    expect(verified.entries).toHaveLength(4);
    expect(verified).toMatchObject({
      split: 'development',
      holdoutAdmitted: false,
      productGateDenominatorAvailable: false,
      providerTransmissionAuthority: false,
      realEvaluationAuthority: false,
      productGateEvidence: false,
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fails closed for missing files, symlinks, digest drift, and invalid normalization', async () => {
    const missingRoot = await copyFixtureTree();
    const missingChild =
      PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.entries[0]!.original.packageRelativePath.slice(
        packagePrefix.length,
      );
    await unlink(join(missingRoot, missingChild));
    await expect(
      loadVerifiedProductGateDevelopmentCorpusV1({
        manifest: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
        sourceRoot: { kind: 'bounded-test-root', absolutePath: missingRoot },
      }),
    ).rejects.toThrow();

    const symlinkRoot = await copyFixtureTree();
    const symlinkChild =
      PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.entries[0]!.normalized.packageRelativePath.slice(
        packagePrefix.length,
      );
    await unlink(join(symlinkRoot, symlinkChild));
    await symlink(
      join(symlinkRoot, 'normalized/banner-product-v1.png'),
      join(symlinkRoot, symlinkChild),
    );
    await expect(
      loadVerifiedProductGateDevelopmentCorpusV1({
        manifest: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
        sourceRoot: { kind: 'bounded-test-root', absolutePath: symlinkRoot },
      }),
    ).rejects.toThrow(/symlink/u);

    const driftRoot = await copyFixtureTree();
    const driftChild =
      PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.entries[1]!.original.packageRelativePath.slice(
        packagePrefix.length,
      );
    const driftBytes = await readFile(join(driftRoot, driftChild));
    await writeFile(join(driftRoot, driftChild), Buffer.concat([driftBytes, Buffer.from([0])]));
    await expect(
      loadVerifiedProductGateDevelopmentCorpusV1({
        manifest: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
        sourceRoot: { kind: 'bounded-test-root', absolutePath: driftRoot },
      }),
    ).rejects.toThrow();

    const invalidNormalizationRoot = await copyFixtureTree();
    const entry = PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.entries[2]!;
    const originalChild = entry.original.packageRelativePath.slice(packagePrefix.length);
    const normalizedChild = entry.normalized.packageRelativePath.slice(packagePrefix.length);
    await writeFile(
      join(invalidNormalizationRoot, normalizedChild),
      await readFile(join(invalidNormalizationRoot, originalChild)),
    );
    await expect(
      loadVerifiedProductGateDevelopmentCorpusV1({
        manifest: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
        sourceRoot: { kind: 'bounded-test-root', absolutePath: invalidNormalizationRoot },
      }),
    ).rejects.toThrow();
  });

  it('rejects traversal-shaped roots and unknown loader keys before reading', async () => {
    await expect(
      loadVerifiedProductGateDevelopmentCorpusV1({
        manifest: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
        sourceRoot: { kind: 'bounded-test-root', absolutePath: relative(process.cwd(), tmpdir()) },
      }),
    ).rejects.toThrow(/absolute/u);
    await expect(
      loadVerifiedProductGateDevelopmentCorpusV1({
        manifest: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
        sourceRoot: { kind: 'committed-package-root' },
        unexpected: true,
      }),
    ).rejects.toThrow();
  });
});
