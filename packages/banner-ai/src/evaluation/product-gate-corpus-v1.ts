import { z } from 'zod';

import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  HUMAN_ORACLE_APPROVED_BY_FIXTURE_V2,
  REAL_MODEL_BENCHMARK_HUMAN_ORACLE_CORPUS_V2,
} from './real-model-benchmark-human-oracle.js';
import {
  PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256,
  REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2,
} from './real-model-benchmark-pending-corpus-v2.js';

export const ProductGateCorpusCaseIdV1Schema = z.enum([
  'banner-person-v1',
  'banner-product-v1',
  'banner-text-heavy-v1',
  'banner-no-text-v1',
]);

export const ProductGatePrimaryStratumV1Schema = z.enum([
  'person-and-copy',
  'product-and-copy',
  'text-heavy',
  'no-text-layered',
]);

const originalPathPattern =
  /^packages\/banner-ai\/test\/fixtures\/real-model-benchmark\/original\/[a-z0-9.-]+$/u;
const normalizedPathPattern =
  /^packages\/banner-ai\/test\/fixtures\/real-model-benchmark\/normalized\/[a-z0-9.-]+\.png$/u;

const ProductGateSourceIdentityV1Schema = z
  .strictObject({
    packageRelativePath: z.string().regex(originalPathPattern),
    mediaType: z.enum(['image/jpeg', 'image/png']),
    byteSize: z.int().min(1).max(5_242_880),
    pixelWidth: z.int().min(1).max(4_096),
    pixelHeight: z.int().min(1).max(4_096),
    sha256: Sha256HexSchema,
  })
  .superRefine((source, context) => {
    if (source.pixelWidth * source.pixelHeight > 4_194_304) {
      context.addIssue({ code: 'custom', message: 'Development source exceeds pixel limits.' });
    }
  })
  .readonly();

const ProductGateNormalizedSourceIdentityV1Schema = z
  .strictObject({
    packageRelativePath: z.string().regex(normalizedPathPattern),
    mediaType: z.literal('image/png'),
    byteSize: z.int().min(1).max(5_242_880),
    pixelWidth: z.int().min(1).max(4_096),
    pixelHeight: z.int().min(1).max(4_096),
    sha256: Sha256HexSchema,
  })
  .readonly();

const ProductGateOracleIdentityV1Schema = z
  .strictObject({
    oracleVersion: z.literal(2),
    oracleSha256: Sha256HexSchema,
    originalSourceSha256: Sha256HexSchema,
    normalizedSourceSha256: Sha256HexSchema,
    requiredLayers: z
      .array(
        z
          .strictObject({
            oracleLayerId: z.string().min(1).max(160),
            approvedLabel: z.string().min(1).max(160),
            role: z.enum(['background', 'subject', 'foreground', 'decoration', 'text', 'other']),
            boundingBox: z
              .strictObject({
                unit: z.literal('normalized-basis-points'),
                xBps: z.int().min(0).max(10_000),
                yBps: z.int().min(0).max(10_000),
                widthBps: z.int().min(1).max(10_000),
                heightBps: z.int().min(1).max(10_000),
              })
              .readonly(),
          })
          .readonly(),
      )
      .min(3)
      .max(5)
      .readonly(),
    requiredLayerIds: z.array(z.string().min(1).max(160)).min(3).max(5).readonly(),
  })
  .superRefine((oracle, context) => {
    if (
      new Set(oracle.requiredLayerIds).size !== oracle.requiredLayerIds.length ||
      canonicalizeJson(oracle.requiredLayers.map((layer) => layer.oracleLayerId)) !==
        canonicalizeJson(oracle.requiredLayerIds)
    ) {
      context.addIssue({ code: 'custom', message: 'Oracle layer identities must be unique.' });
    }
  })
  .readonly();

export const ProductGateDevelopmentCorpusEntryV1Schema = z
  .strictObject({
    caseId: ProductGateCorpusCaseIdV1Schema,
    primaryStratum: ProductGatePrimaryStratumV1Schema,
    original: ProductGateSourceIdentityV1Schema,
    normalized: ProductGateNormalizedSourceIdentityV1Schema,
    oracle: ProductGateOracleIdentityV1Schema,
    evidenceUse: z.literal('biased-development-fixture-only'),
    holdout: z.literal(false),
    productGateEvidence: z.literal(false),
    commercialGeneralizabilityEvidence: z.literal(false),
    providerTransmissionAuthority: z.literal(false),
    realEvaluationAuthority: z.literal(false),
  })
  .superRefine((entry, context) => {
    if (
      entry.original.pixelWidth !== entry.normalized.pixelWidth ||
      entry.original.pixelHeight !== entry.normalized.pixelHeight ||
      entry.original.sha256 !== entry.oracle.originalSourceSha256 ||
      entry.normalized.sha256 !== entry.oracle.normalizedSourceSha256 ||
      entry.original.sha256 === entry.normalized.sha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Development source, normalization, or oracle binding drifted.',
      });
    }
  })
  .readonly();

const ProductGateDevelopmentCorpusCoreV1Schema = z
  .strictObject({
    manifestVersion: z.literal(1),
    manifestId: z.literal('banner-ai-product-gate-development-corpus-v1'),
    split: z.literal('development'),
    status: z.literal('development-only'),
    purpose: z.literal('deterministic-provider-free-evaluation-foundation-only'),
    sourceCorpusIdentity: z.literal(PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256),
    oracleCorpusIdentity: z.literal(REAL_MODEL_BENCHMARK_HUMAN_ORACLE_CORPUS_V2.corpusSha256),
    fixtureCount: z.literal(4),
    entries: z
      .tuple([
        ProductGateDevelopmentCorpusEntryV1Schema,
        ProductGateDevelopmentCorpusEntryV1Schema,
        ProductGateDevelopmentCorpusEntryV1Schema,
        ProductGateDevelopmentCorpusEntryV1Schema,
      ])
      .readonly(),
    holdoutAdmitted: z.literal(false),
    productGateDenominatorAvailable: z.literal(false),
    providerTransmissionAuthority: z.literal(false),
    realEvaluationAuthority: z.literal(false),
    fakeDevelopmentExecutionOnly: z.literal(true),
  })
  .superRefine((manifest, context) => {
    const expectedIds = ProductGateCorpusCaseIdV1Schema.options;
    const actualIds = manifest.entries.map((entry) => entry.caseId);
    const allSourceDigests = manifest.entries.flatMap((entry) => [
      entry.original.sha256,
      entry.normalized.sha256,
    ]);
    if (
      canonicalizeJson(actualIds) !== canonicalizeJson(expectedIds) ||
      new Set(allSourceDigests).size !== 8
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Development manifest requires the exact ordered four fixtures and eight sources.',
      });
    }
  });

export const digestProductGateDevelopmentCorpusV1 = (input: unknown): string =>
  sha256Hex(
    Buffer.from(canonicalizeJson(ProductGateDevelopmentCorpusCoreV1Schema.parse(input)), 'utf8'),
  );

export const ProductGateDevelopmentCorpusManifestV1Schema = z
  .strictObject({
    ...ProductGateDevelopmentCorpusCoreV1Schema.shape,
    manifestSha256: Sha256HexSchema,
  })
  .superRefine((manifest, context) => {
    const { manifestSha256, ...core } = manifest;
    if (manifestSha256 !== digestProductGateDevelopmentCorpusV1(core)) {
      context.addIssue({
        code: 'custom',
        message: 'Development corpus canonical digest drifted.',
        path: ['manifestSha256'],
      });
    }
  })
  .readonly();

const stratumByCase = Object.freeze({
  'banner-person-v1': 'person-and-copy',
  'banner-product-v1': 'product-and-copy',
  'banner-text-heavy-v1': 'text-heavy',
  'banner-no-text-v1': 'no-text-layered',
} as const);

const developmentEntries = REAL_MODEL_BENCHMARK_PENDING_CORPUS_V2.entries.map((source) => {
  const caseId = ProductGateCorpusCaseIdV1Schema.parse(source.fixtureId);
  const oracle = HUMAN_ORACLE_APPROVED_BY_FIXTURE_V2[caseId];
  return ProductGateDevelopmentCorpusEntryV1Schema.parse({
    caseId,
    primaryStratum: stratumByCase[caseId],
    original: {
      packageRelativePath: source.packageOriginal.packageRelativePath,
      mediaType: source.packageOriginal.detectedMediaType,
      byteSize: source.packageOriginal.byteSize,
      pixelWidth: source.packageOriginal.pixelWidth,
      pixelHeight: source.packageOriginal.pixelHeight,
      sha256: source.packageOriginal.sha256,
    },
    normalized: {
      packageRelativePath: source.canonicalNormalized.packageRelativePath,
      mediaType: source.canonicalNormalized.detectedMediaType,
      byteSize: source.canonicalNormalized.byteSize,
      pixelWidth: source.canonicalNormalized.pixelWidth,
      pixelHeight: source.canonicalNormalized.pixelHeight,
      sha256: source.canonicalNormalized.sha256,
    },
    oracle: {
      oracleVersion: oracle.oracleVersion,
      oracleSha256: oracle.oracleSha256,
      originalSourceSha256: oracle.sourceBinding.original.sha256,
      normalizedSourceSha256: oracle.sourceBinding.canonicalNormalized.sha256,
      requiredLayers: oracle.requiredLayers.map((layer) => ({
        oracleLayerId: layer.oracleLayerId,
        approvedLabel: layer.approvedLabel,
        role: layer.role,
        boundingBox: layer.boundingBox,
      })),
      requiredLayerIds: oracle.requiredLayers.map((layer) => layer.oracleLayerId),
    },
    evidenceUse: 'biased-development-fixture-only',
    holdout: false,
    productGateEvidence: false,
    commercialGeneralizabilityEvidence: false,
    providerTransmissionAuthority: false,
    realEvaluationAuthority: false,
  });
});

const developmentCore = ProductGateDevelopmentCorpusCoreV1Schema.parse({
  manifestVersion: 1,
  manifestId: 'banner-ai-product-gate-development-corpus-v1',
  split: 'development',
  status: 'development-only',
  purpose: 'deterministic-provider-free-evaluation-foundation-only',
  sourceCorpusIdentity: PENDING_REAL_MODEL_BENCHMARK_CORPUS_CORE_V2_SHA256,
  oracleCorpusIdentity: REAL_MODEL_BENCHMARK_HUMAN_ORACLE_CORPUS_V2.corpusSha256,
  fixtureCount: 4,
  entries: developmentEntries,
  holdoutAdmitted: false,
  productGateDenominatorAvailable: false,
  providerTransmissionAuthority: false,
  realEvaluationAuthority: false,
  fakeDevelopmentExecutionOnly: true,
});

export const PRODUCT_GATE_DEVELOPMENT_CORPUS_V1 =
  ProductGateDevelopmentCorpusManifestV1Schema.parse({
    ...developmentCore,
    manifestSha256: digestProductGateDevelopmentCorpusV1(developmentCore),
  });

const ProductGateBlockedHoldoutCoreV1Schema = z.strictObject({
  manifestVersion: z.literal(1),
  manifestId: z.literal('banner-ai-product-gate-holdout-v1'),
  split: z.literal('holdout'),
  status: z.literal('blocked-no-authoritative-corpus'),
  expectedCaseCount: z.literal(18),
  admittedCaseCount: z.literal(0),
  entries: z.tuple([]).readonly(),
  holdoutAdmitted: z.literal(false),
  providerTransmissionAuthority: z.literal(false),
  realEvaluationAuthority: z.literal(false),
  productGateDenominator: z.literal('unavailable'),
  authoritativeGdnEvidence: z.literal('absent'),
  productGateOutcome: z.literal('not-measurable'),
  blocker: z.literal('authoritative-18-case-holdout-not-admitted'),
});

export const digestProductGateBlockedHoldoutV1 = (input: unknown): string =>
  sha256Hex(
    Buffer.from(canonicalizeJson(ProductGateBlockedHoldoutCoreV1Schema.parse(input)), 'utf8'),
  );

export const ProductGateBlockedHoldoutManifestV1Schema = z
  .strictObject({
    ...ProductGateBlockedHoldoutCoreV1Schema.shape,
    manifestSha256: Sha256HexSchema,
  })
  .superRefine((manifest, context) => {
    const { manifestSha256, ...core } = manifest;
    if (manifestSha256 !== digestProductGateBlockedHoldoutV1(core)) {
      context.addIssue({
        code: 'custom',
        message: 'Blocked holdout canonical digest drifted.',
        path: ['manifestSha256'],
      });
    }
  })
  .readonly();

const blockedHoldoutCore = ProductGateBlockedHoldoutCoreV1Schema.parse({
  manifestVersion: 1,
  manifestId: 'banner-ai-product-gate-holdout-v1',
  split: 'holdout',
  status: 'blocked-no-authoritative-corpus',
  expectedCaseCount: 18,
  admittedCaseCount: 0,
  entries: [],
  holdoutAdmitted: false,
  providerTransmissionAuthority: false,
  realEvaluationAuthority: false,
  productGateDenominator: 'unavailable',
  authoritativeGdnEvidence: 'absent',
  productGateOutcome: 'not-measurable',
  blocker: 'authoritative-18-case-holdout-not-admitted',
});

export const PRODUCT_GATE_BLOCKED_HOLDOUT_V1 = ProductGateBlockedHoldoutManifestV1Schema.parse({
  ...blockedHoldoutCore,
  manifestSha256: digestProductGateBlockedHoldoutV1(blockedHoldoutCore),
});

export const ProductGateCorpusManifestV1Schema = z.discriminatedUnion('split', [
  ProductGateDevelopmentCorpusManifestV1Schema,
  ProductGateBlockedHoldoutManifestV1Schema,
]);

export type ProductGateDevelopmentCorpusEntryV1 = z.infer<
  typeof ProductGateDevelopmentCorpusEntryV1Schema
>;
export type ProductGateDevelopmentCorpusManifestV1 = z.infer<
  typeof ProductGateDevelopmentCorpusManifestV1Schema
>;
export type ProductGateBlockedHoldoutManifestV1 = z.infer<
  typeof ProductGateBlockedHoldoutManifestV1Schema
>;

export const requireExactProductGateDevelopmentCorpusV1 = (
  input: unknown,
): ProductGateDevelopmentCorpusManifestV1 => {
  const parsed = ProductGateDevelopmentCorpusManifestV1Schema.parse(input);
  if (canonicalizeJson(parsed) !== canonicalizeJson(PRODUCT_GATE_DEVELOPMENT_CORPUS_V1)) {
    throw new TypeError('Only the exact pinned four-fixture development corpus is accepted.');
  }
  return parsed;
};

export const rejectBlockedProductGateHoldoutExecutionV1 = (input: unknown): never => {
  const parsed = ProductGateBlockedHoldoutManifestV1Schema.parse(input);
  if (canonicalizeJson(parsed) !== canonicalizeJson(PRODUCT_GATE_BLOCKED_HOLDOUT_V1)) {
    throw new TypeError('Unknown or drifted holdout evidence is rejected.');
  }
  throw new TypeError(
    'Product-gate execution is blocked: the authoritative 18-case holdout is not admitted.',
  );
};
