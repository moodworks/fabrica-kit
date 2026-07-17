import { z } from 'zod';

import { CompositionPartV1Schema } from '../workflows/composition-contracts.js';
import { TextObservationV1Schema } from './ai-contracts.js';
import {
  ProposedSceneAnalysisOcrOutputV1Schema,
  type ProposedSceneAnalysisOcrOutputV1,
} from './openai-scene-analysis-output.js';
import {
  QwenSemanticSceneAnalysisOutputV1Schema,
  type QwenSemanticSceneAnalysisOutputV1,
} from './qwen-semantic-scene-analysis-output.js';
import {
  HUMAN_ORACLE_APPROVED_BY_FIXTURE_V2,
  HumanOracleApprovedV2Schema,
  REAL_MODEL_BENCHMARK_HUMAN_ORACLE_CORPUS_V2,
} from './real-model-benchmark-human-oracle.js';
import { evaluateRealModelBenchmarkHumanOracleOcrQualityV2 } from './real-model-benchmark-human-oracle-quality.js';
import { exactBoundingBoxIouMeetsThreshold } from './real-model-benchmark-quality.js';

export const QwenBenchmarkFixtureIdSchema = z.enum([
  'banner-person-v1',
  'banner-product-v1',
  'banner-text-heavy-v1',
  'banner-no-text-v1',
]);

export type QwenBenchmarkFixtureId = z.infer<typeof QwenBenchmarkFixtureIdSchema>;

export const getQwenFourFixtureEvaluationBindingsV1 = () => {
  if (
    REAL_MODEL_BENCHMARK_HUMAN_ORACLE_CORPUS_V2.corpusSha256 !==
    'aa499d5560a97a2bf7df84fd0240f39941a82f485f804a42a608d96cb9acba51'
  ) {
    throw new TypeError('Qwen benchmark human-oracle corpus digest drifted.');
  }
  return Object.freeze(
    QwenBenchmarkFixtureIdSchema.options.map((fixtureId) => {
      const oracle = HumanOracleApprovedV2Schema.parse(
        HUMAN_ORACLE_APPROVED_BY_FIXTURE_V2[fixtureId],
      );
      return Object.freeze({
        fixtureId,
        normalizedSource: oracle.sourceBinding.canonicalNormalized,
        oracleSha256: oracle.oracleSha256,
      });
    }),
  );
};

const toTextBox = (bounds: z.infer<typeof CompositionPartV1Schema>['bounds']) => ({
  unit: 'normalized-basis-points' as const,
  xBps: bounds.xBps,
  yBps: bounds.yBps,
  widthBps: bounds.widthBps,
  heightBps: bounds.heightBps,
});

const maximumLayerMatches = (input: {
  readonly fixtureId: QwenBenchmarkFixtureId;
  readonly actualParts: readonly z.infer<typeof CompositionPartV1Schema>[];
}): number => {
  const expected = HUMAN_ORACLE_APPROVED_BY_FIXTURE_V2[input.fixtureId].requiredLayers;
  const actual = [...input.actualParts].toSorted((left, right) =>
    left.partKey.localeCompare(right.partKey),
  );
  const actualMatch = new Map<number, number>();
  const tryMatch = (expectedIndex: number, visited: Set<number>): boolean => {
    const expectedLayer = expected[expectedIndex]!;
    for (const [actualIndex, actualPart] of actual.entries()) {
      if (
        visited.has(actualIndex) ||
        actualPart.role !== expectedLayer.role ||
        !exactBoundingBoxIouMeetsThreshold({
          left: expectedLayer.boundingBox,
          right: toTextBox(actualPart.bounds),
          thresholdBps: 5_000,
        })
      ) {
        continue;
      }
      visited.add(actualIndex);
      const previousExpected = actualMatch.get(actualIndex);
      if (previousExpected === undefined || tryMatch(previousExpected, visited)) {
        actualMatch.set(actualIndex, expectedIndex);
        return true;
      }
    }
    return false;
  };
  for (const expectedIndex of expected.keys()) tryMatch(expectedIndex, new Set<number>());
  return actualMatch.size;
};

export const evaluateQwenFourFixtureQualityV1 = (input: {
  readonly fixtureId: unknown;
  readonly normalizedSourceSha256: unknown;
  readonly oracleSha256: unknown;
  readonly actualParts: unknown;
  readonly actualObservations: unknown;
}) => {
  const fixtureId = QwenBenchmarkFixtureIdSchema.parse(input.fixtureId);
  const oracle = HumanOracleApprovedV2Schema.parse(HUMAN_ORACLE_APPROVED_BY_FIXTURE_V2[fixtureId]);
  if (
    input.normalizedSourceSha256 !== oracle.sourceBinding.canonicalNormalized.sha256 ||
    input.oracleSha256 !== oracle.oracleSha256
  ) {
    throw new TypeError('Qwen quality source or human-oracle identity is stale or foreign.');
  }
  const actualParts = z.array(CompositionPartV1Schema).min(3).max(5).parse(input.actualParts);
  const actualObservations = z
    .array(TextObservationV1Schema)
    .max(100)
    .parse(input.actualObservations);
  const matchedRequiredLayerCount = maximumLayerMatches({ fixtureId, actualParts });
  const expectedRequiredLayerCount = oracle.requiredLayers.length;
  const layerQuality = Object.freeze({
    evaluationVersion: 1 as const,
    matchingRule: 'same-semantic-role-and-bounding-box-iou-at-least-5000-bps' as const,
    boundingBoxIouThresholdBps: 5_000 as const,
    expectedRequiredLayerCount,
    actualLayerCount: actualParts.length,
    matchedRequiredLayerCount,
    allRequiredLayersMatched: matchedRequiredLayerCount === expectedRequiredLayerCount,
    noExtraLayers: actualParts.length === expectedRequiredLayerCount,
    pass:
      matchedRequiredLayerCount === expectedRequiredLayerCount &&
      actualParts.length === expectedRequiredLayerCount,
  });
  const ocrQuality = evaluateRealModelBenchmarkHumanOracleOcrQualityV2({
    fixtureId,
    normalizedSourceSha256: input.normalizedSourceSha256,
    oracleSha256: input.oracleSha256,
    actualObservations,
  });
  const ocrPass =
    ocrQuality.approvedMainTextPass &&
    (ocrQuality.precisionStatus === 'unavailable-unscored' || ocrQuality.precisionPass === true);
  return Object.freeze({
    evaluationVersion: 1 as const,
    fixtureId,
    normalizedSourceSha256: oracle.sourceBinding.canonicalNormalized.sha256,
    oracleSha256: oracle.oracleSha256,
    layerQuality,
    ocrQuality,
    ocrPass,
    pass: layerQuality.pass && ocrPass,
  });
};

export const createDeterministicOracleMatchingQwenOutputV1 = (
  fixtureIdInput: unknown,
): ProposedSceneAnalysisOcrOutputV1 => {
  const fixtureId = QwenBenchmarkFixtureIdSchema.parse(fixtureIdInput);
  const fixtureIndex = QwenBenchmarkFixtureIdSchema.options.indexOf(fixtureId);
  const oracle = HUMAN_ORACLE_APPROVED_BY_FIXTURE_V2[fixtureId];
  const parts = oracle.requiredLayers.map((layer, index) => ({
    partKey: `layer_${fixtureIndex + 1}_${index + 1}`,
    label: layer.approvedLabel,
    role: layer.role,
    bounds: {
      xBps: layer.boundingBox.xBps,
      yBps: layer.boundingBox.yBps,
      widthBps: layer.boundingBox.widthBps,
      heightBps: layer.boundingBox.heightBps,
    },
  }));
  const textObservations = oracle.expectedTextOccurrences.map((occurrence, index) => ({
    observationVersion: 1 as const,
    observationId: `qwenocr_${fixtureIndex + 1}_${index + 1}`,
    text: {
      kind: 'observed-text' as const,
      value: occurrence.normalizedScoringText,
      normalization: 'unicode-nfc-single-space-v1' as const,
      contentTrust: 'untrusted-user-image-content' as const,
      instructionAuthority: 'none' as const,
    },
    boundingBox: occurrence.boundingBox,
    confidence: { unit: 'basis-points' as const, valueBps: 10_000 },
  }));
  return ProposedSceneAnalysisOcrOutputV1Schema.parse({
    outputVersion: 1,
    visibleContentConstraint: 'only-directly-visible-objects-and-text',
    composition: {
      kind: 'composition_proposal',
      proposalVersion: 1,
      sourceAssetSha256: oracle.sourceBinding.canonicalNormalized.sha256,
      parts,
    },
    layerEvidence: parts.map((part) => ({
      partKey: part.partKey,
      observationBasis: 'directly-visible-in-source-image',
      confidence: { unit: 'basis-points', valueBps: 10_000 },
      reviewFlags: [],
    })),
    ocrCompletion:
      textObservations.length === 0
        ? { kind: 'no-visible-text-observed', observationCount: 0 }
        : {
            kind: 'visible-text-observations-complete',
            observationCount: textObservations.length,
          },
    textObservations,
    reviewFlags: [],
    humanReview: {
      required: true,
      proposalOnly: true,
      automaticCutoutExportOrOtherDecisionAuthority: 'none',
    },
  });
};

export const createDeterministicOracleMatchingQwenSemanticOutputV1 = (
  fixtureIdInput: unknown,
): QwenSemanticSceneAnalysisOutputV1 => {
  const canonical = createDeterministicOracleMatchingQwenOutputV1(fixtureIdInput);
  return QwenSemanticSceneAnalysisOutputV1Schema.parse({
    composition:
      canonical.composition.kind === 'composition_proposal'
        ? {
            kind: canonical.composition.kind,
            parts: canonical.composition.parts,
          }
        : {
            kind: canonical.composition.kind,
            reason: canonical.composition.reason,
          },
    layerEvidence: canonical.layerEvidence.map((evidence) => ({
      partKey: evidence.partKey,
      observationBasis: evidence.observationBasis,
      confidence: { valueBps: evidence.confidence.valueBps },
      reviewFlags: evidence.reviewFlags,
    })),
    ocrCompletion: { kind: canonical.ocrCompletion.kind },
    textObservations: canonical.textObservations.map((observation) => ({
      observationId: observation.observationId,
      text: { value: observation.text.value },
      boundingBox: {
        xBps: observation.boundingBox.xBps,
        yBps: observation.boundingBox.yBps,
        widthBps: observation.boundingBox.widthBps,
        heightBps: observation.boundingBox.heightBps,
      },
      confidence: { valueBps: observation.confidence.valueBps },
    })),
    reviewFlags: canonical.reviewFlags,
  });
};
