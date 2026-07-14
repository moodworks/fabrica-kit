import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as publicBannerAi from '../src/index.js';
import {
  COMBINED_INTAKE_PERMISSION_BINDING_V2,
  COMBINED_INTAKE_PERMISSION_BINDING_V2_SHA256,
  CombinedIntakePermissionBindingV2Schema,
  FOURTH_BANNER_INTAKE_PERMISSION_STATEMENT_SHA256,
  FOURTH_BANNER_NORMALIZED_SHA256,
  FOURTH_BANNER_ORIGINAL_SHA256,
  FOURTH_IMAGE_INTAKE_PERMISSION_EVIDENCE_V2,
  FOURTH_IMAGE_INTAKE_PERMISSION_EVIDENCE_V2_SHA256,
  FOUR_FIXTURE_PENDING_CAPS_REVISION_V2,
  FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256,
  HISTORICAL_THREE_IMAGE_PERMISSION_SCOPE_V1,
  HISTORICAL_THREE_IMAGE_PERMISSION_SCOPE_V1_SHA256,
  OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1,
  PENDING_CORE_COMBINED_AUTHORIZATION_BINDING_V2,
  PENDING_CORE_COMBINED_AUTHORIZATION_BINDING_V2_SHA256,
  PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_SHA256,
  PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256,
  PendingFourthRealModelBenchmarkCorpusEntryV2Schema,
  PendingRealModelBenchmarkCorpusV1Schema,
  PendingRealModelBenchmarkCorpusV2Schema,
  ProviderNeutralHumanOracleV1Schema,
  REAL_MODEL_BENCHMARK_CAPS_V1,
  REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1,
  REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2,
  RealModelBenchmarkExecutionLedgerV1Schema,
  SelectedRealModelBenchmarkProfileV1Schema,
  THREE_BANNER_INTAKE_PERMISSION_STATEMENT_SHA256,
  admitRealModelBenchmarkCorpusV1,
  byteSourceFrom,
  canonicalizeJson,
  digestCombinedIntakePermissionBindingV2,
  digestFourFixturePendingCapsRevisionV2,
  digestFourthImageIntakePermissionEvidenceV2,
  digestPendingCoreCombinedAuthorizationBindingV2,
  digestPendingRealModelBenchmarkCorpusCoreV1,
  digestPendingRealModelBenchmarkCorpusCoreV2,
  digestSelectedRealModelBenchmarkProfileV1,
  inspectRasterContainer,
  normalizeRasterUpload,
  parseMicros,
  sha256Hex,
  validateNormalizedPng,
} from '../src/index.js';
import { buildNonDispatchingOpenAiRequestPlanV1 } from '../src/server/openai-real-model-request-boundary.js';
import { REAL_MODEL_BENCHMARK_STATIC_CORPUS_SOURCE_REGISTRY_V1 } from '../src/server/real-model-benchmark-corpus-source-registry.js';
import { loadTrustedRealModelBenchmarkCorpusV1 } from '../src/server/real-model-benchmark-corpus-loader.js';
import { loadVerifiedPendingRealModelBenchmarkCorpusV2 } from '../src/server/real-model-benchmark-pending-corpus-loader-v2.js';
import {
  REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V2,
  readPendingCorpusPackageFileV2,
} from '../src/server/real-model-benchmark-pending-corpus-source-registry-v2.js';

const sourceRegistryModulePath =
  '../src/server/real-model-benchmark-pending-corpus-source-registry-v2.js';
const rasterUploadModulePath = '../src/security/raster-upload.js';

type SourceRegistryModuleV2 =
  typeof import('../src/server/real-model-benchmark-pending-corpus-source-registry-v2.js');
type PendingLoaderModuleV2 =
  typeof import('../src/server/real-model-benchmark-pending-corpus-loader-v2.js');
type RasterUploadModule = typeof import('../src/security/raster-upload.js');

type Mutable<T> = T extends readonly (infer Entry)[]
  ? Mutable<Entry>[]
  : T extends Uint8Array
    ? Uint8Array
    : T extends object
      ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
      : T;

const mutableV2Manifest = (): Mutable<typeof REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2> =>
  structuredClone(REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2) as unknown as Mutable<
    typeof REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2
  >;

type MutableFourthEntry = Mutable<(typeof REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2.entries)[3]>;

const mutableFourthEntry = (): MutableFourthEntry =>
  structuredClone(
    REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2.entries[3],
  ) as unknown as MutableFourthEntry;

const expectDeeplyFrozen = (value: unknown, seen = new Set<object>()): void => {
  if (typeof value !== 'object' || value === null || seen.has(value)) return;
  seen.add(value);
  expect(Object.isFrozen(value)).toBe(true);
  for (const nested of Object.values(value as Record<string, unknown>)) {
    expectDeeplyFrozen(nested, seen);
  }
};

const resetPendingV2ModuleMocks = (): void => {
  vi.doUnmock(sourceRegistryModulePath);
  vi.doUnmock(rasterUploadModulePath);
  vi.resetModules();
};

afterEach(resetPendingV2ModuleMocks);

const importLoaderWithFileMutation = async (
  targetReference: Parameters<SourceRegistryModuleV2['readPendingCorpusPackageFileV2']>[0],
): Promise<PendingLoaderModuleV2> => {
  resetPendingV2ModuleMocks();
  vi.doMock(sourceRegistryModulePath, async (importOriginal) => {
    const actual = await importOriginal<SourceRegistryModuleV2>();
    return {
      ...actual,
      async readPendingCorpusPackageFileV2(
        reference: Parameters<SourceRegistryModuleV2['readPendingCorpusPackageFileV2']>[0],
      ) {
        const bytes = await actual.readPendingCorpusPackageFileV2(reference);
        if (reference !== targetReference) return bytes;
        const changed = Uint8Array.from(bytes);
        const index = Math.min(100, changed.byteLength - 1);
        changed[index] = changed[index]! ^ 1;
        return changed;
      },
    };
  });
  return import('../src/server/real-model-benchmark-pending-corpus-loader-v2.js');
};

const importLoaderWithRenormalizationDrift = async (): Promise<PendingLoaderModuleV2> => {
  resetPendingV2ModuleMocks();
  vi.doMock(rasterUploadModulePath, async (importOriginal) => {
    const actual = await importOriginal<RasterUploadModule>();
    return {
      ...actual,
      async normalizeRasterUpload(
        input: Parameters<RasterUploadModule['normalizeRasterUpload']>[0],
      ) {
        const normalized = await actual.normalizeRasterUpload(input);
        if (input.filename !== 'banner-no-text-v1.jpeg') return normalized;
        return { ...normalized, sha256: 'f'.repeat(64) };
      },
    };
  });
  return import('../src/server/real-model-benchmark-pending-corpus-loader-v2.js');
};

const portableRasterFailure =
  /original|normalized|container|checksum|drifted|vipspng|libpng|read error|warning treated as error|failOn setting/i;

describe('provider-free four-banner pending corpus V2', () => {
  it('detects the fourth JPEG and canonical PNG from bytes and reproduces every pin', async () => {
    const [original, normalized] = await Promise.all([
      readPendingCorpusPackageFileV2('no-text-original'),
      readPendingCorpusPackageFileV2('no-text-normalized'),
    ]);
    expect(original.subarray(0, 2)).toEqual(Uint8Array.from([0xff, 0xd8]));
    expect(normalized.subarray(0, 8)).toEqual(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(inspectRasterContainer(original, 'image/jpeg')).toEqual({
      ancillaryByteSize: 14,
      height: 255,
      mediaType: 'image/jpeg',
      width: 738,
    });
    expect(await validateNormalizedPng(normalized)).toEqual({
      ancillaryByteSize: 0,
      height: 255,
      mediaType: 'image/png',
      width: 738,
    });
    expect({ originalBytes: original.byteLength, originalSha256: sha256Hex(original) }).toEqual({
      originalBytes: 15_312,
      originalSha256: FOURTH_BANNER_ORIGINAL_SHA256,
    });
    expect({
      normalizedBytes: normalized.byteLength,
      normalizedSha256: sha256Hex(normalized),
    }).toEqual({
      normalizedBytes: 125_894,
      normalizedSha256: FOURTH_BANNER_NORMALIZED_SHA256,
    });
  });

  it('loads four fixed pairs, pins eight unique digests, and returns deeply frozen inert metadata', async () => {
    const verified = await loadVerifiedPendingRealModelBenchmarkCorpusV2({
      manifest: REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2,
    });
    const expectedDigests = [
      'd9a5a64f4fb4353a11d2fac605049b8cf1565ee8a056cf792f0181d1798189d3',
      '6e3175cdd260fde33a3885945eb6f8831da3905afbc723f684035f411dc6d699',
      'ce1be4eacbd65763d1d2b2835f9ad49c50cd9b3f56edc4a6a289822965bf09c5',
      'a38db6f627ee275eabf7643c99a83aac5e1ac77bbfe1b1abcc24112c6a04e69a',
      '886afa4806fd252175d08a56eb5cae4989f3ac59c6a0c6e0a59f8a6d61195d77',
      '181e4c3762b79b5dfcbdb21c6c873ede8b32bf85dfe98fdecc13d59fb8cbcb62',
      FOURTH_BANNER_ORIGINAL_SHA256,
      FOURTH_BANNER_NORMALIZED_SHA256,
    ];
    expect(verified.fixtureCount).toBe(4);
    expect(
      verified.entries.flatMap((entry) => [entry.original.sha256, entry.normalized.sha256]),
    ).toEqual(expectedDigests);
    expect(new Set(expectedDigests).size).toBe(8);
    expect(verified).toMatchObject({
      status: 'oracle-review-pending',
      pendingCoreSha256: PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256,
      combinedIntakePermissionBindingSha256: COMBINED_INTAKE_PERMISSION_BINDING_V2_SHA256,
      pendingCoreCombinedAuthorizationBindingSha256:
        PENDING_CORE_COMBINED_AUTHORIZATION_BINDING_V2_SHA256,
      active: false,
      dispatchable: false,
      admissionAuthority: false,
      requestPlanAuthority: false,
      providerCallAuthority: false,
      dispatchAuthority: false,
    });
    expect(Object.isFrozen(verified)).toBe(true);
    expect(Object.isFrozen(verified.entries)).toBe(true);
    for (const entry of verified.entries) {
      expect(Object.isFrozen(entry)).toBe(true);
      expect(Object.isFrozen(entry.original)).toBe(true);
      expect(Object.isFrozen(entry.normalized)).toBe(true);
    }
    expect(JSON.stringify(verified)).not.toMatch(
      /(?:base64|data:image|packageRelativePath|\/fixtures\/|"bytes")/u,
    );
  });

  it('preserves all six historical binaries and recomputable V1 evidence unchanged', () => {
    const packageRoot = fileURLToPath(new URL('..', import.meta.url));
    const historicalFiles = [
      [
        'test/fixtures/real-model-benchmark/original/banner-person-v1.png',
        'd9a5a64f4fb4353a11d2fac605049b8cf1565ee8a056cf792f0181d1798189d3',
      ],
      [
        'test/fixtures/real-model-benchmark/normalized/banner-person-v1.png',
        '6e3175cdd260fde33a3885945eb6f8831da3905afbc723f684035f411dc6d699',
      ],
      [
        'test/fixtures/real-model-benchmark/original/banner-product-v1.jpg',
        'ce1be4eacbd65763d1d2b2835f9ad49c50cd9b3f56edc4a6a289822965bf09c5',
      ],
      [
        'test/fixtures/real-model-benchmark/normalized/banner-product-v1.png',
        'a38db6f627ee275eabf7643c99a83aac5e1ac77bbfe1b1abcc24112c6a04e69a',
      ],
      [
        'test/fixtures/real-model-benchmark/original/banner-text-heavy-v1.jpg',
        '886afa4806fd252175d08a56eb5cae4989f3ac59c6a0c6e0a59f8a6d61195d77',
      ],
      [
        'test/fixtures/real-model-benchmark/normalized/banner-text-heavy-v1.png',
        '181e4c3762b79b5dfcbdb21c6c873ede8b32bf85dfe98fdecc13d59fb8cbcb62',
      ],
    ] as const;
    for (const [relativePath, expected] of historicalFiles) {
      expect(sha256Hex(readFileSync(join(packageRoot, relativePath)))).toBe(expected);
    }
    const { pendingCoreSha256, ...v1Core } = REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1;
    expect(pendingCoreSha256).toBe(
      '961331ea74f826d428a0aabcbf44378cd583856a3101a3a59495e97040aa8b3c',
    );
    expect(digestPendingRealModelBenchmarkCorpusCoreV1(v1Core)).toBe(
      PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_SHA256,
    );
    expect(THREE_BANNER_INTAKE_PERMISSION_STATEMENT_SHA256).toBe(
      'c70506656b23342c7410cc06b8b5a0dbd643699d9b6698d0629869c7e891632a',
    );
    expect(sha256Hex(Buffer.from(canonicalizeJson(REAL_MODEL_BENCHMARK_CAPS_V1), 'utf8'))).toBe(
      '409cbc9d8f62a03b87de35b15e9e044f11773c085eca80da74f25e3ba1fe5d00',
    );
    expect(digestSelectedRealModelBenchmarkProfileV1(OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1)).toBe(
      '0f0b392165604c2ebb166e62e5b04c659dd60e7e941c400e623c8a70f5a9790f',
    );
    expect(REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2.entries.slice(0, 3)).toEqual(
      REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1.entries,
    );
  });

  it('recomputes every V2 digest in the acyclic cap/evidence/core binding graph', () => {
    const { capsRevisionSha256, ...capsCore } = FOUR_FIXTURE_PENDING_CAPS_REVISION_V2;
    expect(digestFourFixturePendingCapsRevisionV2(capsCore)).toBe(capsRevisionSha256);
    expect(capsRevisionSha256).toBe(FOUR_FIXTURE_PENDING_CAPS_REVISION_V2_SHA256);

    const { evidenceSha256, ...fourthEvidenceCore } = FOURTH_IMAGE_INTAKE_PERMISSION_EVIDENCE_V2;
    expect(digestFourthImageIntakePermissionEvidenceV2(fourthEvidenceCore)).toBe(evidenceSha256);
    expect(evidenceSha256).toBe(FOURTH_IMAGE_INTAKE_PERMISSION_EVIDENCE_V2_SHA256);

    expect(HISTORICAL_THREE_IMAGE_PERMISSION_SCOPE_V1.scopeSha256).toBe(
      HISTORICAL_THREE_IMAGE_PERMISSION_SCOPE_V1_SHA256,
    );
    const { bindingSha256: combinedSha256, ...combinedCore } =
      COMBINED_INTAKE_PERMISSION_BINDING_V2;
    expect(digestCombinedIntakePermissionBindingV2(combinedCore)).toBe(combinedSha256);

    const {
      pendingCoreSha256,
      pendingCoreCombinedAuthorizationBinding: finalBinding,
      ...pendingCore
    } = REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2;
    expect(digestPendingRealModelBenchmarkCorpusCoreV2(pendingCore)).toBe(pendingCoreSha256);
    expect(finalBinding).toEqual(PENDING_CORE_COMBINED_AUTHORIZATION_BINDING_V2);
    const { bindingSha256: finalSha256, ...finalCore } =
      PENDING_CORE_COMBINED_AUTHORIZATION_BINDING_V2;
    expect(digestPendingCoreCombinedAuthorizationBindingV2(finalCore)).toBe(finalSha256);
  });

  it('deep-freezes every exported V2 evidence object and all reachable draft structures', () => {
    for (const evidence of [
      REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2,
      FOUR_FIXTURE_PENDING_CAPS_REVISION_V2,
      FOURTH_IMAGE_INTAKE_PERMISSION_EVIDENCE_V2,
      HISTORICAL_THREE_IMAGE_PERMISSION_SCOPE_V1,
      COMBINED_INTAKE_PERMISSION_BINDING_V2,
      PENDING_CORE_COMBINED_AUTHORIZATION_BINDING_V2,
    ]) {
      expectDeeplyFrozen(evidence);
    }

    const fourth = REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2.entries[3];
    expectDeeplyFrozen(REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2.entries);
    expectDeeplyFrozen(FOUR_FIXTURE_PENDING_CAPS_REVISION_V2.doesNotSupersede);
    expectDeeplyFrozen(FOURTH_IMAGE_INTAKE_PERMISSION_EVIDENCE_V2.boundSourceDigestsInOrder);
    expectDeeplyFrozen(HISTORICAL_THREE_IMAGE_PERMISSION_SCOPE_V1.entryEvidenceInOrder);
    expectDeeplyFrozen(COMBINED_INTAKE_PERMISSION_BINDING_V2.permissionScopeOrder);
    expectDeeplyFrozen(COMBINED_INTAKE_PERMISSION_BINDING_V2.orderedCorpusDigests);
    expectDeeplyFrozen(fourth.sourceAudit);
    expectDeeplyFrozen(fourth.packageOriginal);
    expectDeeplyFrozen(fourth.canonicalNormalized);
    expectDeeplyFrozen(fourth.draftReview);
    expectDeeplyFrozen(fourth.draftReview.proposedSemanticLayers);
    expectDeeplyFrozen(fourth.draftReview.draftTextObservationSet.observations);
    expectDeeplyFrozen(fourth.draftReview.uncertaintyAndReviewFlags);
  });

  it('normalizes the fourth original deterministically without metadata or pixel drift', async () => {
    const [original, stored] = await Promise.all([
      readPendingCorpusPackageFileV2('no-text-original'),
      readPendingCorpusPackageFileV2('no-text-normalized'),
    ]);
    const fresh = await normalizeRasterUpload({
      bytes: byteSourceFrom(original),
      declaredMediaType: 'image/jpeg',
      filename: 'banner-no-text-v1.jpeg',
    });
    expect(fresh).toMatchObject({
      sourceMediaType: 'image/jpeg',
      sourceWidth: 738,
      sourceHeight: 255,
      mediaType: 'image/png',
      width: 738,
      height: 255,
      byteSize: 125_894,
      sha256: FOURTH_BANNER_NORMALIZED_SHA256,
    });
    expect(Buffer.from(fresh.bytes).equals(Buffer.from(stored))).toBe(true);
    expect((await validateNormalizedPng(fresh.bytes)).ancillaryByteSize).toBe(0);
  });

  it('fails closed on metadata, manifest, source-byte, corruption, and renormalization drift', async () => {
    const metadataDrift = mutableV2Manifest();
    metadataDrift.entries[3]!.sourceAudit.localMetadataPrivacy.originalAncillaryByteSize =
      15 as never;
    expect(PendingRealModelBenchmarkCorpusV2Schema.safeParse(metadataDrift).success).toBe(false);

    const manifestDrift = mutableV2Manifest();
    manifestDrift.pendingCoreSha256 = 'f'.repeat(64) as never;
    expect(PendingRealModelBenchmarkCorpusV2Schema.safeParse(manifestDrift).success).toBe(false);

    const originalDriftLoader = await importLoaderWithFileMutation('no-text-original');
    await expect(
      originalDriftLoader.loadVerifiedPendingRealModelBenchmarkCorpusV2({
        manifest: REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2,
      }),
    ).rejects.toThrow(portableRasterFailure);

    const normalizedDriftLoader = await importLoaderWithFileMutation('no-text-normalized');
    await expect(
      normalizedDriftLoader.loadVerifiedPendingRealModelBenchmarkCorpusV2({
        manifest: REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2,
      }),
    ).rejects.toThrow(portableRasterFailure);

    const renormalizationDriftLoader = await importLoaderWithRenormalizationDrift();
    await expect(
      renormalizationDriftLoader.loadVerifiedPendingRealModelBenchmarkCorpusV2({
        manifest: REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2,
      }),
    ).rejects.toThrow(/fresh trusted normalization.*differs/i);
  });

  it('pins the standalone fourth entry against size, path, name, ancillary, and audit substitution', () => {
    const substitutions: readonly ((entry: MutableFourthEntry) => void)[] = [
      (entry) => {
        entry.packageOriginal.byteSize += 1;
        entry.canonicalNormalized.byteSize += 1;
      },
      (entry) => {
        entry.packageOriginal.packageRelativePath =
          'packages/banner-ai/test/fixtures/real-model-benchmark/original/substitute.jpeg';
      },
      (entry) => {
        entry.canonicalNormalized.filename = 'banner-no-text-substitute.png';
      },
      (entry) => {
        entry.packageOriginal.ancillaryByteSize += 1;
        entry.sourceAudit.localMetadataPrivacy.originalAncillaryByteSize = 15 as never;
      },
      (entry) => {
        entry.sourceAudit.originalByteSize = 15_313 as never;
      },
    ];

    for (const substitute of substitutions) {
      const entry = mutableFourthEntry();
      substitute(entry);
      expect(PendingFourthRealModelBenchmarkCorpusEntryV2Schema.safeParse(entry).success).toBe(
        false,
      );
    }
  });

  it('keeps historical and fourth permission scopes distinct and non-substitutable', () => {
    expect(FOURTH_BANNER_INTAKE_PERMISSION_STATEMENT_SHA256).not.toBe(
      THREE_BANNER_INTAKE_PERMISSION_STATEMENT_SHA256,
    );
    expect(FOURTH_IMAGE_INTAKE_PERMISSION_EVIDENCE_V2.evidenceSha256).not.toBe(
      HISTORICAL_THREE_IMAGE_PERMISSION_SCOPE_V1.scopeSha256,
    );

    const oldForNew = mutableV2Manifest();
    (
      oldForNew.entries[3]!.intakeEvidence as Mutable<
        typeof FOURTH_IMAGE_INTAKE_PERMISSION_EVIDENCE_V2
      >
    ).renderedResolvedStatement = REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1.entries[0]!.intakeEvidence
      .exactUserStatement as never;
    expect(PendingRealModelBenchmarkCorpusV2Schema.safeParse(oldForNew).success).toBe(false);

    const newForOld = mutableV2Manifest();
    (
      newForOld.entries[0]!.intakeEvidence as Mutable<
        (typeof REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1.entries)[number]['intakeEvidence']
      >
    ).exactUserStatement =
      FOURTH_IMAGE_INTAKE_PERMISSION_EVIDENCE_V2.renderedResolvedStatement as never;
    expect(PendingRealModelBenchmarkCorpusV2Schema.safeParse(newForOld).success).toBe(false);

    const sourceSubstitution = structuredClone(
      COMBINED_INTAKE_PERMISSION_BINDING_V2,
    ) as unknown as Mutable<typeof COMBINED_INTAKE_PERMISSION_BINDING_V2>;
    sourceSubstitution.orderedCorpusDigests[7] = sourceSubstitution.orderedCorpusDigests[5]!;
    expect(CombinedIntakePermissionBindingV2Schema.safeParse(sourceSubstitution).success).toBe(
      false,
    );
  });

  it('retains valid V1 history while only V2 accepts exactly four fixed pending entries', () => {
    expect(
      PendingRealModelBenchmarkCorpusV1Schema.safeParse(REAL_MODEL_BENCHMARK_PENDING_CORPUS_V1)
        .success,
    ).toBe(true);
    expect(
      PendingRealModelBenchmarkCorpusV2Schema.safeParse(REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2)
        .success,
    ).toBe(true);
    expect(
      PendingRealModelBenchmarkCorpusV1Schema.safeParse(REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2)
        .success,
    ).toBe(false);

    const three = mutableV2Manifest();
    three.entries.pop();
    expect(PendingRealModelBenchmarkCorpusV2Schema.safeParse(three).success).toBe(false);
    const five = mutableV2Manifest();
    five.entries.push(structuredClone(five.entries[3]!));
    expect(PendingRealModelBenchmarkCorpusV2Schema.safeParse(five).success).toBe(false);
    expect(REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V2).toHaveLength(4);
    expect(
      new Set(
        REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V2.map((entry) => entry.fixtureId),
      ).size,
    ).toBe(4);
  });

  it('uses exact four-fixture run, call, time, retry, and bigint micro-USD arithmetic', () => {
    const caps = FOUR_FIXTURE_PENDING_CAPS_REVISION_V2;
    expect(caps).toMatchObject({
      state: 'disabled',
      fixtureCount: 4,
      successfulRunsPerFixture: 2,
      requiredSuccessfulRunCount: 8,
      maximumProviderCalls: 12,
      maximumRetriesPerFixtureAcrossBothRuns: 1,
      maximumRetriesTotal: 4,
      maximumFailedAttemptsPerFixture: 2,
      maximumFailedAttempts: 4,
      perCallCostCeilingMicroUsd: '100000',
      totalCostCeilingMicroUsd: '1200000',
      maximumAttemptedCallMs: 60_000,
      maximumLogicalRunMs: 120_000,
      maximumTotalWallClockMs: 800_000,
      retryPolicy: { mode: 'zero-retry', maximumRetryCount: 0 },
      authority: 'ceilings-only-no-call-or-execution-authority',
    });
    expect(caps.fixtureCount * caps.successfulRunsPerFixture).toBe(caps.requiredSuccessfulRunCount);
    expect(caps.requiredSuccessfulRunCount + caps.maximumFailedAttempts).toBe(
      caps.maximumProviderCalls,
    );
    expect(parseMicros(caps.perCallCostCeilingMicroUsd) * BigInt(caps.maximumProviderCalls)).toBe(
      parseMicros(caps.totalCostCeilingMicroUsd),
    );
    expect(caps.maximumProviderCalls * caps.maximumAttemptedCallMs).toBeLessThanOrEqual(
      caps.maximumTotalWallClockMs,
    );
  });

  it('keeps the empty zero-text draft structurally incompatible with human oracle evidence', () => {
    const fourth = REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2.entries[3];
    expect(fourth.draftReview).toMatchObject({
      evidenceRole: 'codex-draft-unapproved',
      reviewStatus: 'draft-unapproved',
      humanApprovalAuthority: false,
      explicitVisibleTextResult: 'no-semantic-text-observed',
      draftTextObservationSet: {
        evidenceRole: 'codex-draft-unapproved',
        humanApprovalAuthority: false,
        observations: [],
      },
    });
    expect(ProviderNeutralHumanOracleV1Schema.safeParse(fourth.draftReview).success).toBe(false);
    expect(
      ProviderNeutralHumanOracleV1Schema.safeParse(fourth.draftReview.draftTextObservationSet)
        .success,
    ).toBe(false);
    expect(fourth.draftReview).not.toHaveProperty('oracleVersion');
    expect(fourth.draftReview).not.toHaveProperty('requiredLayers');
    expect(fourth.draftReview).not.toHaveProperty('expectedTextOccurrences');
  });

  it('remains inactive and rejected by admission, profile, execution, and request-plan paths', async () => {
    expect(() => admitRealModelBenchmarkCorpusV1(REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2)).toThrow();
    expect(
      SelectedRealModelBenchmarkProfileV1Schema.safeParse(REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2)
        .success,
    ).toBe(false);
    expect(
      RealModelBenchmarkExecutionLedgerV1Schema.safeParse(REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2)
        .success,
    ).toBe(false);

    let authorizationRead = false;
    const admittedLoaderInput: Record<string, unknown> = {
      manifest: REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2,
    };
    Object.defineProperty(admittedLoaderInput, 'authorizationContext', {
      enumerable: true,
      get() {
        authorizationRead = true;
        throw new TypeError('Pending V2 must fail before authorization inspection.');
      },
    });
    await expect(
      loadTrustedRealModelBenchmarkCorpusV1(admittedLoaderInput as never),
    ).rejects.toThrow();
    expect(authorizationRead).toBe(false);

    const metadata = await loadVerifiedPendingRealModelBenchmarkCorpusV2({
      manifest: REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2,
    });
    expect(() =>
      buildNonDispatchingOpenAiRequestPlanV1({
        profile: OPENAI_REAL_MODEL_BENCHMARK_PROFILE_V1,
        corpusCapability: metadata as never,
        request: {},
        fixtureId: 'banner-no-text-v1',
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

  it('adds no provider, network, secret, obsolete-intake, or package-root server surface', () => {
    const packageRoot = fileURLToPath(new URL('..', import.meta.url));
    const surfacePaths = [
      join(packageRoot, 'src/evaluation/real-model-benchmark-pending-corpus-v2.ts'),
      join(packageRoot, 'src/server/real-model-benchmark-pending-corpus-source-registry-v2.ts'),
      join(packageRoot, 'src/server/real-model-benchmark-pending-corpus-loader-v2.ts'),
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
    expect(source).not.toContain('4-no-text.jpg');
    for (const serverAuthority of [
      'REAL_MODEL_BENCHMARK_PENDING_STATIC_SOURCE_REGISTRY_V2',
      'readPendingCorpusPackageFileV2',
      'loadVerifiedPendingRealModelBenchmarkCorpusV2',
    ]) {
      expect(publicBannerAi).not.toHaveProperty(serverAuthority);
    }
  });
});
