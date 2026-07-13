import { z } from 'zod';

import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import {
  ModelProducedActualTextObservationSetV1Schema,
  SceneAnalysisModelRequestV1Schema,
  TextObservationBoundingBoxV1Schema,
  validateModelProducedTextObservationsForSceneAnalysisRequestV1,
  type SceneAnalysisModelRequestV1,
  type TextObservationV1,
} from './ai-contracts.js';
import { AdmittedRealModelBenchmarkCorpusEntryV1Schema } from './real-model-benchmark-corpus-manifest.js';

export const exactBasisPointRatioMeetsThreshold = (input: {
  readonly numerator: number;
  readonly denominator: number;
  readonly thresholdBps: number;
}): boolean => {
  const numerator = z.int().min(0).parse(input.numerator);
  const denominator = z.int().min(1).parse(input.denominator);
  const thresholdBps = z.int().min(0).max(10_000).parse(input.thresholdBps);
  if (numerator > denominator) throw new RangeError('Ratio numerator cannot exceed denominator.');
  return BigInt(numerator) * 10_000n >= BigInt(thresholdBps) * BigInt(denominator);
};

type TextBox = z.infer<typeof TextObservationBoundingBoxV1Schema>;

export const exactBoundingBoxIouMeetsThreshold = (input: {
  readonly left: TextBox;
  readonly right: TextBox;
  readonly thresholdBps?: number;
}): boolean => {
  const left = TextObservationBoundingBoxV1Schema.parse(input.left);
  const right = TextObservationBoundingBoxV1Schema.parse(input.right);
  const thresholdBps = z
    .int()
    .min(0)
    .max(10_000)
    .parse(input.thresholdBps ?? 7_000);
  const intersectionWidth = Math.max(
    0,
    Math.min(left.xBps + left.widthBps, right.xBps + right.widthBps) -
      Math.max(left.xBps, right.xBps),
  );
  const intersectionHeight = Math.max(
    0,
    Math.min(left.yBps + left.heightBps, right.yBps + right.heightBps) -
      Math.max(left.yBps, right.yBps),
  );
  const intersectionArea = BigInt(intersectionWidth) * BigInt(intersectionHeight);
  const leftArea = BigInt(left.widthBps) * BigInt(left.heightBps);
  const rightArea = BigInt(right.widthBps) * BigInt(right.heightBps);
  const unionArea = leftArea + rightArea - intersectionArea;
  return intersectionArea * 10_000n >= BigInt(thresholdBps) * unionArea;
};

type ExpectedTextOccurrence = {
  readonly oracleOccurrenceId: string;
  readonly normalizedText: string;
  readonly boundingBox: TextBox;
};

const maximumDeterministicBboxMatches = (
  expected: readonly ExpectedTextOccurrence[],
  actual: readonly TextObservationV1[],
): number => {
  const expectedSorted = expected.toSorted((left, right) =>
    canonicalizeJson(left) < canonicalizeJson(right)
      ? -1
      : canonicalizeJson(left) > canonicalizeJson(right)
        ? 1
        : 0,
  );
  const actualSorted = actual.toSorted((left, right) =>
    canonicalizeJson({ observationId: left.observationId, boundingBox: left.boundingBox }) <
    canonicalizeJson({ observationId: right.observationId, boundingBox: right.boundingBox })
      ? -1
      : canonicalizeJson({ observationId: left.observationId, boundingBox: left.boundingBox }) >
          canonicalizeJson({ observationId: right.observationId, boundingBox: right.boundingBox })
        ? 1
        : 0,
  );
  const actualMatch = new Map<number, number>();
  const tryMatch = (expectedIndex: number, visited: Set<number>): boolean => {
    const expectedOccurrence = expectedSorted[expectedIndex]!;
    for (const [actualIndex, actualObservation] of actualSorted.entries()) {
      if (
        visited.has(actualIndex) ||
        expectedOccurrence.normalizedText !== actualObservation.text.value ||
        !exactBoundingBoxIouMeetsThreshold({
          left: expectedOccurrence.boundingBox,
          right: actualObservation.boundingBox,
        })
      ) {
        continue;
      }
      visited.add(actualIndex);
      const priorExpected = actualMatch.get(actualIndex);
      if (priorExpected === undefined || tryMatch(priorExpected, visited)) {
        actualMatch.set(actualIndex, expectedIndex);
        return true;
      }
    }
    return false;
  };
  let matchCount = 0;
  for (const expectedIndex of expectedSorted.keys()) {
    if (tryMatch(expectedIndex, new Set<number>())) matchCount += 1;
  }
  return matchCount;
};

export const evaluateRealModelBenchmarkOcrQualityV1 = (input: {
  readonly admittedEntry: unknown;
  readonly request: unknown;
  readonly actualObservationSet: unknown;
}) => {
  const entry = AdmittedRealModelBenchmarkCorpusEntryV1Schema.parse(input.admittedEntry);
  const request: SceneAnalysisModelRequestV1 = SceneAnalysisModelRequestV1Schema.parse(
    input.request,
  );
  const actualObservationSet = ModelProducedActualTextObservationSetV1Schema.parse(
    input.actualObservationSet,
  );
  if (
    canonicalizeJson(request.input.fixture) !== canonicalizeJson(entry.requestFixtureBinding) ||
    request.input.sourceAsset.sha256 !== entry.normalizedTransmission.sha256 ||
    request.input.sourceAsset.mediaType !== entry.normalizedTransmission.contentType ||
    request.input.sourceAsset.byteSize !== entry.normalizedTransmission.byteSize ||
    request.input.sourceAsset.pixelWidth !== entry.normalizedTransmission.pixelWidth ||
    request.input.sourceAsset.pixelHeight !== entry.normalizedTransmission.pixelHeight
  ) {
    throw new TypeError('OCR quality request source or fixture differs from the admitted entry.');
  }
  const validatedActual = validateModelProducedTextObservationsForSceneAnalysisRequestV1({
    request,
    actualObservations: actualObservationSet,
  });
  const expected: readonly ExpectedTextOccurrence[] = entry.expectedOracle.expectedTextOccurrences;
  const actual = validatedActual.observations;
  const countValues = (values: readonly string[]) => {
    const counts = new Map<string, number>();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
    return counts;
  };
  const expectedCounts = countValues(expected.map((occurrence) => occurrence.normalizedText));
  const actualCounts = countValues(actual.map((observation) => observation.text.value));
  let textIntersectionCount = 0;
  for (const [text, expectedCount] of expectedCounts) {
    textIntersectionCount += Math.min(expectedCount, actualCounts.get(text) ?? 0);
  }
  const bboxMatchedOccurrenceCount = maximumDeterministicBboxMatches(expected, actual);
  const noTextPass = expected.length === 0 && actual.length === 0;
  const precisionPass =
    actual.length === 0
      ? expected.length === 0
      : exactBasisPointRatioMeetsThreshold({
          numerator: textIntersectionCount,
          denominator: actual.length,
          thresholdBps: 10_000,
        });
  const recallPass =
    expected.length === 0
      ? actual.length === 0
      : exactBasisPointRatioMeetsThreshold({
          numerator: textIntersectionCount,
          denominator: expected.length,
          thresholdBps: 10_000,
        });
  const boundingBoxesPass = bboxMatchedOccurrenceCount === textIntersectionCount;
  return Object.freeze({
    expectedOccurrenceCount: expected.length,
    actualObservationCount: actual.length,
    textIntersectionCount,
    bboxMatchedOccurrenceCount,
    precisionPass,
    recallPass,
    boundingBoxesPass,
    noTextPass,
    pass: precisionPass && recallPass && boundingBoxesPass && (expected.length !== 0 || noTextPass),
    modelConfidenceUsedAsOracle: false as const,
  });
};
