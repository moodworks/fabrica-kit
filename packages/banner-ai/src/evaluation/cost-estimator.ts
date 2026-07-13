import { z } from 'zod';

import { CanonicalMicrosStringSchema, formatMicros, parseMicros } from '../jobs/cost-budget.js';

const benchmarkPricingConfigIdPattern = /^[a-z0-9][a-z0-9._-]{7,79}$/;

export const BenchmarkPricingConfigIdSchema = z
  .string()
  .regex(benchmarkPricingConfigIdPattern)
  .brand<'BenchmarkPricingConfigId'>();

export const UsdMicrosAmountV1Schema = z
  .strictObject({
    currency: z.literal('USD'),
    micros: CanonicalMicrosStringSchema,
  })
  .readonly()
  .brand<'UsdMicrosAmountV1'>();

const BenchmarkUsageUnitSchema = z
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .brand<'BenchmarkUsageUnit'>();

export const BenchmarkCostRatesV1Schema = z
  .strictObject({
    modelInferenceMicrosPerUnit: CanonicalMicrosStringSchema,
    segmentationComputeMicrosPerUnit: CanonicalMicrosStringSchema,
    inpaintingMicrosPerUnit: CanonicalMicrosStringSchema,
    storageMicrosPerByteMonth: CanonicalMicrosStringSchema,
    retryMicrosPerUnit: CanonicalMicrosStringSchema,
    failedAttemptMicrosPerUnit: CanonicalMicrosStringSchema,
  })
  .readonly();

export const BenchmarkPricingConfigV1Schema = z
  .strictObject({
    configVersion: z.literal(1),
    configId: BenchmarkPricingConfigIdSchema,
    currency: z.literal('USD'),
    purpose: z.literal('benchmark-only'),
    productionPriceTruth: z.literal(false),
    rates: BenchmarkCostRatesV1Schema,
  })
  .readonly();

export const BenchmarkCostUsageV1Schema = z
  .strictObject({
    modelInferenceUnits: BenchmarkUsageUnitSchema,
    segmentationComputeUnits: BenchmarkUsageUnitSchema,
    inpaintingUnits: BenchmarkUsageUnitSchema,
    storageByteMonths: BenchmarkUsageUnitSchema,
    retryUnits: BenchmarkUsageUnitSchema,
    failedAttemptUnits: BenchmarkUsageUnitSchema,
  })
  .readonly();

export const BenchmarkCostComponentV1Schema = z
  .strictObject({
    usageUnits: BenchmarkUsageUnitSchema,
    rateMicrosPerUnit: CanonicalMicrosStringSchema,
    subtotal: UsdMicrosAmountV1Schema,
  })
  .superRefine((component, context) => {
    const expected = parseMicros(component.rateMicrosPerUnit) * BigInt(component.usageUnits);
    if (expected !== parseMicros(component.subtotal.micros)) {
      context.addIssue({
        code: 'custom',
        message: 'Cost component subtotal does not equal its exact integer rate and usage.',
        path: ['subtotal'],
      });
    }
  })
  .readonly();

export const BenchmarkCostComponentsV1Schema = z
  .strictObject({
    modelInference: BenchmarkCostComponentV1Schema,
    segmentationCompute: BenchmarkCostComponentV1Schema,
    inpainting: BenchmarkCostComponentV1Schema,
    storage: BenchmarkCostComponentV1Schema,
    retries: BenchmarkCostComponentV1Schema,
    failedAttempts: BenchmarkCostComponentV1Schema,
  })
  .readonly();

export const BenchmarkCostBreakdownV1Schema = z
  .strictObject({
    breakdownVersion: z.literal(1),
    pricingConfigId: BenchmarkPricingConfigIdSchema,
    pricingConfigVersion: z.literal(1),
    components: BenchmarkCostComponentsV1Schema,
    total: UsdMicrosAmountV1Schema,
  })
  .superRefine((breakdown, context) => {
    let expectedTotal = 0n;
    for (const component of Object.values(breakdown.components)) {
      expectedTotal += parseMicros(component.subtotal.micros);
    }
    if (expectedTotal !== parseMicros(breakdown.total.micros)) {
      context.addIssue({
        code: 'custom',
        message: 'Cost total does not equal the exact sum of all component subtotals.',
        path: ['total'],
      });
    }
  })
  .readonly();

export type BenchmarkPricingConfigV1 = z.infer<typeof BenchmarkPricingConfigV1Schema>;
export type BenchmarkCostUsageV1 = z.infer<typeof BenchmarkCostUsageV1Schema>;
export type BenchmarkCostBreakdownV1 = z.infer<typeof BenchmarkCostBreakdownV1Schema>;
export type UsdMicrosAmountV1 = z.infer<typeof UsdMicrosAmountV1Schema>;

export const PROVIDER_FREE_BENCHMARK_PRICING_V1 = BenchmarkPricingConfigV1Schema.parse({
  configVersion: 1,
  configId: 'provider-free-benchmark-pricing-v1',
  currency: 'USD',
  purpose: 'benchmark-only',
  productionPriceTruth: false,
  rates: {
    modelInferenceMicrosPerUnit: '0',
    segmentationComputeMicrosPerUnit: '0',
    inpaintingMicrosPerUnit: '0',
    storageMicrosPerByteMonth: '0',
    retryMicrosPerUnit: '0',
    failedAttemptMicrosPerUnit: '0',
  },
});

const component = (usageUnits: number, rateMicrosPerUnit: string) => {
  const rate = parseMicros(rateMicrosPerUnit);
  return BenchmarkCostComponentV1Schema.parse({
    usageUnits,
    rateMicrosPerUnit,
    subtotal: {
      currency: 'USD',
      micros: formatMicros(rate * BigInt(usageUnits)),
    },
  });
};

export const estimateBenchmarkCostV1 = (input: {
  readonly pricing: BenchmarkPricingConfigV1;
  readonly usage: BenchmarkCostUsageV1;
}): BenchmarkCostBreakdownV1 => {
  const pricing = BenchmarkPricingConfigV1Schema.parse(input.pricing);
  const usage = BenchmarkCostUsageV1Schema.parse(input.usage);
  const components = BenchmarkCostComponentsV1Schema.parse({
    modelInference: component(usage.modelInferenceUnits, pricing.rates.modelInferenceMicrosPerUnit),
    segmentationCompute: component(
      usage.segmentationComputeUnits,
      pricing.rates.segmentationComputeMicrosPerUnit,
    ),
    inpainting: component(usage.inpaintingUnits, pricing.rates.inpaintingMicrosPerUnit),
    storage: component(usage.storageByteMonths, pricing.rates.storageMicrosPerByteMonth),
    retries: component(usage.retryUnits, pricing.rates.retryMicrosPerUnit),
    failedAttempts: component(usage.failedAttemptUnits, pricing.rates.failedAttemptMicrosPerUnit),
  });
  let total = 0n;
  for (const entry of Object.values(components)) {
    total += parseMicros(entry.subtotal.micros);
  }
  return BenchmarkCostBreakdownV1Schema.parse({
    breakdownVersion: 1,
    pricingConfigId: pricing.configId,
    pricingConfigVersion: pricing.configVersion,
    components,
    total: { currency: 'USD', micros: formatMicros(total) },
  });
};
