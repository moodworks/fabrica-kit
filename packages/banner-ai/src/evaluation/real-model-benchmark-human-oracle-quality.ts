import { z } from 'zod';

import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import { TextObservationV1Schema, type TextObservationV1 } from './ai-contracts.js';
import {
  HUMAN_ORACLE_APPROVED_BY_FIXTURE_V2,
  type HumanOracleApprovedCorpusV2,
} from './real-model-benchmark-human-oracle.js';
import { exactBoundingBoxIouMeetsThreshold } from './real-model-benchmark-quality.js';

const fixtureIds = [
  'banner-person-v1',
  'banner-product-v1',
  'banner-text-heavy-v1',
  'banner-no-text-v1',
] as const;

const HumanOracleActualObservationsV2Schema = z
  .array(TextObservationV1Schema)
  .max(100)
  .superRefine((observations, context) => {
    const observationIds = observations.map((observation) => observation.observationId);
    if (new Set(observationIds).size !== observationIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Actual human-oracle quality observations require unique IDs.',
      });
    }
  })
  .readonly();

export const HumanOracleOcrQualityInputV2Schema = z
  .strictObject({
    fixtureId: z.enum(fixtureIds),
    normalizedSourceSha256: Sha256HexSchema,
    oracleSha256: Sha256HexSchema,
    actualObservations: HumanOracleActualObservationsV2Schema,
  })
  .superRefine((input, context) => {
    const oracle = HUMAN_ORACLE_APPROVED_BY_FIXTURE_V2[input.fixtureId];
    if (
      input.normalizedSourceSha256 !== oracle.sourceBinding.canonicalNormalized.sha256 ||
      input.oracleSha256 !== oracle.oracleSha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Human-oracle quality source or oracle digest is stale, foreign, or substituted.',
      });
    }
  })
  .readonly();

const HumanOracleOcrQualityResultV2Schema = z
  .strictObject({
    evaluationVersion: z.literal(2),
    fixtureId: z.enum(fixtureIds),
    normalizedSourceSha256: Sha256HexSchema,
    oracleSha256: Sha256HexSchema,
    boundingBoxIouThresholdBps: z.literal(7_000),
    expectedMainTextOccurrenceCount: z.int().min(0).max(100),
    actualObservationCount: z.int().min(0).max(100),
    actualObservations: HumanOracleActualObservationsV2Schema,
    matchedMainTextObservationCount: z.int().min(0).max(100),
    bboxMatchedMainTextObservationCount: z.int().min(0).max(100),
    extraObservationCount: z.int().min(0).max(100),
    extraObservations: HumanOracleActualObservationsV2Schema,
    mainTextRecallPass: z.boolean(),
    mainTextBoundingBoxesPass: z.boolean(),
    approvedMainTextPass: z.boolean(),
    precisionStatus: z.enum(['unavailable-unscored', 'available-scored']),
    precisionPass: z.boolean().nullable(),
    semanticFalsePositiveCount: z.int().min(0).max(100).nullable(),
    fullExactOcrEligible: z.boolean(),
    fullExactOcrPass: z.boolean(),
    exactOcrClaimStatus: z.enum([
      'prohibited-unresolved-watermark-even-when-approved-main-text-perfect',
      'eligible-requires-full-exact-scoring-pass',
    ]),
    modelConfidenceUsedAsOracle: z.literal(false),
  })
  .superRefine((result, context) => {
    const oracle = HUMAN_ORACLE_APPROVED_BY_FIXTURE_V2[result.fixtureId];
    const precisionAvailable =
      oracle.ocrPolicy.extraObservationPrecisionStatus === 'available-scored';
    const expectedFullPass =
      precisionAvailable &&
      result.mainTextRecallPass &&
      result.mainTextBoundingBoxesPass &&
      result.precisionPass === true;
    if (
      result.normalizedSourceSha256 !== oracle.sourceBinding.canonicalNormalized.sha256 ||
      result.oracleSha256 !== oracle.oracleSha256 ||
      result.expectedMainTextOccurrenceCount !== oracle.expectedTextOccurrences.length ||
      result.actualObservationCount !== result.actualObservations.length ||
      result.extraObservationCount !== result.extraObservations.length ||
      result.matchedMainTextObservationCount + result.extraObservationCount !==
        result.actualObservationCount ||
      result.matchedMainTextObservationCount > result.expectedMainTextOccurrenceCount ||
      result.bboxMatchedMainTextObservationCount > result.matchedMainTextObservationCount ||
      result.mainTextRecallPass !==
        (result.matchedMainTextObservationCount === result.expectedMainTextOccurrenceCount) ||
      result.mainTextBoundingBoxesPass !==
        (result.bboxMatchedMainTextObservationCount === result.expectedMainTextOccurrenceCount) ||
      result.approvedMainTextPass !==
        (result.mainTextRecallPass && result.mainTextBoundingBoxesPass) ||
      result.fullExactOcrEligible !== precisionAvailable ||
      result.fullExactOcrPass !== expectedFullPass ||
      (precisionAvailable &&
        (result.precisionStatus !== 'available-scored' ||
          result.precisionPass !== (result.extraObservationCount === 0) ||
          result.semanticFalsePositiveCount !== result.extraObservationCount ||
          result.exactOcrClaimStatus !== 'eligible-requires-full-exact-scoring-pass')) ||
      (!precisionAvailable &&
        (result.precisionStatus !== 'unavailable-unscored' ||
          result.precisionPass !== null ||
          result.semanticFalsePositiveCount !== null ||
          result.fullExactOcrPass ||
          result.exactOcrClaimStatus !==
            'prohibited-unresolved-watermark-even-when-approved-main-text-perfect')) ||
      (result.fixtureId === 'banner-no-text-v1' &&
        result.semanticFalsePositiveCount !== result.actualObservationCount)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Human-oracle OCR quality result is internally inconsistent or foreign.',
      });
    }
  })
  .readonly();

export { HumanOracleOcrQualityResultV2Schema };

type ApprovedOracle = HumanOracleApprovedCorpusV2['entries'][number]['approvedOracle'];
type ExpectedOccurrence = ApprovedOracle['expectedTextOccurrences'][number];

const compareCanonical = (left: unknown, right: unknown): number => {
  const leftCanonical = canonicalizeJson(left);
  const rightCanonical = canonicalizeJson(right);
  return leftCanonical < rightCanonical ? -1 : leftCanonical > rightCanonical ? 1 : 0;
};

const deterministicMatches = (input: {
  readonly expected: readonly ExpectedOccurrence[];
  readonly actual: readonly TextObservationV1[];
}) => {
  const expected = input.expected.toSorted(compareCanonical);
  const actual = input.actual.toSorted(compareCanonical);
  const bboxActualToExpected = new Map<number, number>();

  const tryBboxMatch = (expectedIndex: number, visitedActual: Set<number>): boolean => {
    const expectedOccurrence = expected[expectedIndex]!;
    for (const [actualIndex, actualObservation] of actual.entries()) {
      if (
        visitedActual.has(actualIndex) ||
        actualObservation.text.value !== expectedOccurrence.normalizedScoringText ||
        !exactBoundingBoxIouMeetsThreshold({
          left: expectedOccurrence.boundingBox,
          right: actualObservation.boundingBox,
          thresholdBps: 7_000,
        })
      ) {
        continue;
      }
      visitedActual.add(actualIndex);
      const priorExpectedIndex = bboxActualToExpected.get(actualIndex);
      if (priorExpectedIndex === undefined || tryBboxMatch(priorExpectedIndex, visitedActual)) {
        bboxActualToExpected.set(actualIndex, expectedIndex);
        return true;
      }
    }
    return false;
  };

  for (const expectedIndex of expected.keys()) {
    tryBboxMatch(expectedIndex, new Set<number>());
  }

  const matchedActualIndexes = new Set(bboxActualToExpected.keys());
  const matchedExpectedIndexes = new Set(bboxActualToExpected.values());
  for (const [expectedIndex, expectedOccurrence] of expected.entries()) {
    if (matchedExpectedIndexes.has(expectedIndex)) continue;
    const actualIndex = actual.findIndex(
      (actualObservation, index) =>
        !matchedActualIndexes.has(index) &&
        actualObservation.text.value === expectedOccurrence.normalizedScoringText,
    );
    if (actualIndex < 0) continue;
    matchedExpectedIndexes.add(expectedIndex);
    matchedActualIndexes.add(actualIndex);
  }

  return Object.freeze({
    matchedMainTextObservationCount: matchedExpectedIndexes.size,
    bboxMatchedMainTextObservationCount: bboxActualToExpected.size,
    extraObservations: Object.freeze(
      actual.filter((_observation, index) => !matchedActualIndexes.has(index)),
    ),
  });
};

export const evaluateRealModelBenchmarkHumanOracleOcrQualityV2 = (
  input: unknown,
): HumanOracleOcrQualityResultV2 => {
  const parsed = HumanOracleOcrQualityInputV2Schema.parse(input);
  const oracle = HUMAN_ORACLE_APPROVED_BY_FIXTURE_V2[parsed.fixtureId];
  const matches = deterministicMatches({
    expected: oracle.expectedTextOccurrences,
    actual: parsed.actualObservations,
  });
  const expectedMainTextOccurrenceCount = oracle.expectedTextOccurrences.length;
  const mainTextRecallPass =
    matches.matchedMainTextObservationCount === expectedMainTextOccurrenceCount;
  const mainTextBoundingBoxesPass =
    matches.bboxMatchedMainTextObservationCount === expectedMainTextOccurrenceCount;
  const precisionAvailable =
    oracle.ocrPolicy.extraObservationPrecisionStatus === 'available-scored';
  const precisionPass = precisionAvailable ? matches.extraObservations.length === 0 : null;
  const fullExactOcrPass =
    precisionAvailable && mainTextRecallPass && mainTextBoundingBoxesPass && precisionPass === true;

  return HumanOracleOcrQualityResultV2Schema.parse({
    evaluationVersion: 2,
    fixtureId: parsed.fixtureId,
    normalizedSourceSha256: parsed.normalizedSourceSha256,
    oracleSha256: parsed.oracleSha256,
    boundingBoxIouThresholdBps: 7_000,
    expectedMainTextOccurrenceCount,
    actualObservationCount: parsed.actualObservations.length,
    actualObservations: parsed.actualObservations,
    matchedMainTextObservationCount: matches.matchedMainTextObservationCount,
    bboxMatchedMainTextObservationCount: matches.bboxMatchedMainTextObservationCount,
    extraObservationCount: matches.extraObservations.length,
    extraObservations: matches.extraObservations,
    mainTextRecallPass,
    mainTextBoundingBoxesPass,
    approvedMainTextPass: mainTextRecallPass && mainTextBoundingBoxesPass,
    precisionStatus: precisionAvailable ? 'available-scored' : 'unavailable-unscored',
    precisionPass,
    semanticFalsePositiveCount: precisionAvailable ? matches.extraObservations.length : null,
    fullExactOcrEligible: precisionAvailable,
    fullExactOcrPass,
    exactOcrClaimStatus: precisionAvailable
      ? 'eligible-requires-full-exact-scoring-pass'
      : 'prohibited-unresolved-watermark-even-when-approved-main-text-perfect',
    modelConfidenceUsedAsOracle: false,
  });
};

export type HumanOracleOcrQualityInputV2 = z.infer<typeof HumanOracleOcrQualityInputV2Schema>;
export type HumanOracleOcrQualityResultV2 = z.infer<typeof HumanOracleOcrQualityResultV2Schema>;
