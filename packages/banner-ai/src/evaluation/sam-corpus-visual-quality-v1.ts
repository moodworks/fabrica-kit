import { z } from 'zod';

export const SAM_CORPUS_VISUAL_REVIEW_VERSION = 1 as const;

export const SAM_CORPUS_VISUAL_SCORE_ANCHORS_V1 = Object.freeze({
  semanticUsefulness: Object.freeze({
    0: 'irrelevant-or-harmful',
    1: 'weakly-related-major-semantic-rework',
    2: 'partially-useful-moderate-semantic-rework',
    3: 'useful-layer-minor-semantic-adjustment',
    4: 'directly-useful-approved-layer',
  }),
  completeness: Object.freeze({
    0: 'absent-or-wrong-subject',
    1: 'majority-missing',
    2: 'material-portions-missing',
    3: 'substantially-complete-minor-omissions',
    4: 'complete-for-proposed-layer',
  }),
  edgeMatteQuality: Object.freeze({
    0: 'unusable-edge-or-matte',
    1: 'major-edge-reconstruction-required',
    2: 'moderate-edge-repair-required',
    3: 'minor-edge-cleanup-required',
    4: 'clean-native-scale-edge-and-matte',
  }),
  backgroundCleanliness: Object.freeze({
    0: 'dominated-by-background-contamination',
    1: 'major-background-contamination',
    2: 'moderate-background-contamination',
    3: 'minor-background-contamination',
    4: 'no-or-trace-background-contamination',
  }),
  granularityIntegrity: Object.freeze({
    0: 'duplicate-fragment-or-wrong-granularity',
    1: 'major-over-segmentation-or-merge-error',
    2: 'moderate-granularity-repair-required',
    3: 'minor-granularity-adjustment-required',
    4: 'unique-and-correctly-segmented-layer-unit',
  }),
  repairReadiness: Object.freeze({
    0: 'redraw-or-resegmentation-required',
    1: 'major-manual-repair-required',
    2: 'moderate-manual-repair-required',
    3: 'minor-manual-repair-required',
    4: 'no-repair-required',
  }),
} as const);

export const SAM_CORPUS_CAPABILITY_SEPARATION_V1 = Object.freeze({
  segmentation: 'sam-candidate-geometry-only' as const,
  semanticRankingAndNaming: 'separate-capability-human-reviewed' as const,
  ocr: 'separate-capability-not-performed' as const,
  backgroundReconstruction: 'separate-capability-not-performed' as const,
  matteRepair: 'separate-capability-not-performed' as const,
});

const remainingFixtureIds = [
  'banner-product-v1',
  'banner-text-heavy-v1',
  'banner-no-text-v1',
] as const;

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const ScoreSchema = z.int().min(0).max(4);
const CandidateOrderSchema = z.int().min(1).max(8);
const InspectionSchema = z
  .strictObject({
    inspected: z.literal(true),
    findings: z.string().trim().min(1).max(2_000),
  })
  .readonly();

export const SamCorpusCandidateVisualReviewV1Schema = z
  .strictObject({
    candidateOrder: CandidateOrderSchema,
    candidateId: z.string().regex(/^samc_v1_[0-9a-f]{64}$/u),
    artifactInspection: z
      .strictObject({
        mask: InspectionSchema,
        cutout: InspectionSchema,
        overlay: InspectionSchema,
      })
      .readonly(),
    proposedLayerId: z.string().min(1).max(160).nullable(),
    rationale: z.string().trim().min(1).max(4_000),
    usability: z.enum(['usable', 'repairable', 'unusable']),
    scores: z
      .strictObject({
        semanticUsefulness: ScoreSchema,
        completeness: ScoreSchema,
        edgeMatteQuality: ScoreSchema,
        backgroundCleanliness: ScoreSchema,
        granularityIntegrity: ScoreSchema,
        repairReadiness: ScoreSchema,
      })
      .readonly(),
    duplicateOfCandidateOrders: z.array(CandidateOrderSchema).max(7).readonly(),
    mergeWithCandidateOrders: z.array(CandidateOrderSchema).max(7).readonly(),
  })
  .superRefine((review, context) => {
    for (const [field, values] of [
      ['duplicateOfCandidateOrders', review.duplicateOfCandidateOrders],
      ['mergeWithCandidateOrders', review.mergeWithCandidateOrders],
    ] as const) {
      if (
        values.includes(review.candidateOrder) ||
        new Set(values).size !== values.length ||
        values.some((value, index) => value !== [...values].toSorted((a, b) => a - b)[index])
      ) {
        context.addIssue({
          code: 'custom',
          message: `${field} must be unique, sorted, and exclude the reviewed candidate.`,
          path: [field],
        });
      }
    }
    const scoreValues = Object.values(review.scores);
    const expectedUsability =
      review.proposedLayerId === null || scoreValues.some((score) => score === 0)
        ? 'unusable'
        : scoreValues.every((score) => score >= 3)
          ? 'usable'
          : 'repairable';
    if (review.usability !== expectedUsability) {
      context.addIssue({
        code: 'custom',
        message: 'Candidate usability contradicts its proposed layer or six score values.',
        path: ['usability'],
      });
    }
  })
  .readonly();

const MissingLayerObservationSchema = z
  .strictObject({
    layerId: z.string().min(1).max(160),
    rationale: z.string().trim().min(1).max(2_000),
  })
  .readonly();

const CandidatePairObservationSchema = z
  .strictObject({
    candidateOrders: z.tuple([CandidateOrderSchema, CandidateOrderSchema]).readonly(),
    rationale: z.string().trim().min(1).max(2_000),
  })
  .superRefine((observation, context) => {
    if (observation.candidateOrders[0] >= observation.candidateOrders[1]) {
      context.addIssue({
        code: 'custom',
        message: 'Candidate-pair observations must be strictly ascending.',
        path: ['candidateOrders'],
      });
    }
  })
  .readonly();

const MergeObservationSchema = z
  .strictObject({
    candidateOrders: z.tuple([CandidateOrderSchema, CandidateOrderSchema]).readonly(),
    proposedLayerId: z.string().min(1).max(160).nullable(),
    rationale: z.string().trim().min(1).max(2_000),
  })
  .superRefine((observation, context) => {
    if (observation.candidateOrders[0] >= observation.candidateOrders[1]) {
      context.addIssue({
        code: 'custom',
        message: 'Merge observations must be strictly ascending.',
        path: ['candidateOrders'],
      });
    }
  })
  .readonly();

export const SamCorpusVisualReviewV1Schema = z
  .strictObject({
    reviewVersion: z.literal(SAM_CORPUS_VISUAL_REVIEW_VERSION),
    evidenceRole: z.literal('provider-neutral-sam-corpus-candidate-review-v1'),
    fixtureId: z.enum(remainingFixtureIds),
    bindings: z
      .strictObject({
        sourceSha256: Sha256Schema,
        humanOracleSha256: Sha256Schema,
        canonicalRequestSha256: Sha256Schema,
        validatedResponseSha256: Sha256Schema,
        sanitizedResponseSha256: Sha256Schema,
        manifestSha256: Sha256Schema,
        inventorySha256: Sha256Schema,
      })
      .readonly(),
    expectedLayerIds: z.array(z.string().min(1).max(160)).min(3).max(5).readonly(),
    candidateCount: z.int().min(0).max(8),
    candidates: z.array(SamCorpusCandidateVisualReviewV1Schema).max(8).readonly(),
    missingLayerObservations: z.array(MissingLayerObservationSchema).max(5).readonly(),
    duplicateObservations: z.array(CandidatePairObservationSchema).max(28).readonly(),
    mergeObservations: z.array(MergeObservationSchema).max(28).readonly(),
    fixtureUsability: z.enum(['usable', 'repairable', 'unusable']),
    fixtureRationale: z.string().trim().min(1).max(4_000),
    scorePolarity: z.literal('zero-worst-four-best-no-average'),
    capabilitySeparation: z
      .strictObject({
        segmentation: z.literal(SAM_CORPUS_CAPABILITY_SEPARATION_V1.segmentation),
        semanticRankingAndNaming: z.literal(
          SAM_CORPUS_CAPABILITY_SEPARATION_V1.semanticRankingAndNaming,
        ),
        ocr: z.literal(SAM_CORPUS_CAPABILITY_SEPARATION_V1.ocr),
        backgroundReconstruction: z.literal(
          SAM_CORPUS_CAPABILITY_SEPARATION_V1.backgroundReconstruction,
        ),
        matteRepair: z.literal(SAM_CORPUS_CAPABILITY_SEPARATION_V1.matteRepair),
      })
      .readonly(),
    providerNeutral: z.literal(true),
    providerCallAuthority: z.literal(false),
  })
  .superRefine((review, context) => {
    const expectedLayerIds = review.expectedLayerIds;
    if (new Set(expectedLayerIds).size !== expectedLayerIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Visual review expected layers must be unique.',
        path: ['expectedLayerIds'],
      });
    }
    if (
      review.candidateCount !== review.candidates.length ||
      review.candidates.some((candidate, index) => candidate.candidateOrder !== index + 1) ||
      new Set(review.candidates.map((candidate) => candidate.candidateId)).size !==
        review.candidates.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Visual review candidates must be unique, complete, and ordered.',
        path: ['candidates'],
      });
    }
    const candidateOrders = new Set(review.candidates.map((candidate) => candidate.candidateOrder));
    for (const [index, candidate] of review.candidates.entries()) {
      if (
        (candidate.proposedLayerId !== null &&
          !expectedLayerIds.includes(candidate.proposedLayerId)) ||
        [...candidate.duplicateOfCandidateOrders, ...candidate.mergeWithCandidateOrders].some(
          (order) => !candidateOrders.has(order),
        )
      ) {
        context.addIssue({
          code: 'custom',
          message: 'Candidate layer, duplicate, or merge observation is outside this fixture.',
          path: ['candidates', index],
        });
      }
    }
    const pairKey = (left: number, right: number): string =>
      left < right ? `${left}:${right}` : `${right}:${left}`;
    const expectedDuplicatePairs = new Set(
      review.candidates.flatMap((candidate) =>
        candidate.duplicateOfCandidateOrders.map((other) =>
          pairKey(candidate.candidateOrder, other),
        ),
      ),
    );
    const observedDuplicatePairs = review.duplicateObservations.map((observation) =>
      pairKey(observation.candidateOrders[0], observation.candidateOrders[1]),
    );
    const expectedMergePairs = new Set(
      review.candidates.flatMap((candidate) =>
        candidate.mergeWithCandidateOrders.map((other) => pairKey(candidate.candidateOrder, other)),
      ),
    );
    const observedMergePairs = review.mergeObservations.map((observation) =>
      pairKey(observation.candidateOrders[0], observation.candidateOrders[1]),
    );
    if (
      new Set(observedDuplicatePairs).size !== observedDuplicatePairs.length ||
      new Set(observedMergePairs).size !== observedMergePairs.length ||
      JSON.stringify([...expectedDuplicatePairs].toSorted()) !==
        JSON.stringify(observedDuplicatePairs.toSorted()) ||
      JSON.stringify([...expectedMergePairs].toSorted()) !==
        JSON.stringify(observedMergePairs.toSorted()) ||
      [...review.duplicateObservations, ...review.mergeObservations].some((observation) =>
        observation.candidateOrders.some((order) => !candidateOrders.has(order)),
      ) ||
      review.mergeObservations.some(
        (observation) =>
          observation.proposedLayerId !== null &&
          !expectedLayerIds.includes(observation.proposedLayerId),
      )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Fixture duplicate or merge observations are incomplete or invalid.',
        path: ['duplicateObservations'],
      });
    }
    const proposedLayers = new Set(
      review.candidates.flatMap((candidate) =>
        candidate.proposedLayerId === null || candidate.usability === 'unusable'
          ? []
          : [candidate.proposedLayerId],
      ),
    );
    const missingLayerIds = review.missingLayerObservations.map(
      (observation) => observation.layerId,
    );
    const expectedMissing = expectedLayerIds.filter((layerId) => !proposedLayers.has(layerId));
    if (
      JSON.stringify(missingLayerIds) !== JSON.stringify(expectedMissing) ||
      new Set(missingLayerIds).size !== missingLayerIds.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Missing-layer observations must exactly cover all unproposed oracle layers.',
        path: ['missingLayerObservations'],
      });
    }
    if (
      review.candidateCount === 0 &&
      (review.fixtureUsability !== 'unusable' || missingLayerIds.length !== expectedLayerIds.length)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'A zero-candidate fixture is unusable and must record every layer as missing.',
      });
    }
    const expectedFixtureUsability = expectedLayerIds.every((layerId) =>
      review.candidates.some(
        (candidate) => candidate.proposedLayerId === layerId && candidate.usability === 'usable',
      ),
    )
      ? 'usable'
      : review.candidates.some((candidate) => candidate.usability !== 'unusable')
        ? 'repairable'
        : 'unusable';
    if (review.fixtureUsability !== expectedFixtureUsability) {
      context.addIssue({
        code: 'custom',
        message: 'Fixture usability contradicts candidate usability and oracle-layer coverage.',
        path: ['fixtureUsability'],
      });
    }
  })
  .readonly();

export type SamCorpusCandidateVisualReviewV1 = z.infer<
  typeof SamCorpusCandidateVisualReviewV1Schema
>;
export type SamCorpusVisualReviewV1 = z.infer<typeof SamCorpusVisualReviewV1Schema>;

const SamCorpusCandidateVisualJudgmentV1Schema = z
  .strictObject({
    artifactInspection: z
      .strictObject({
        mask: InspectionSchema,
        cutout: InspectionSchema,
        overlay: InspectionSchema,
      })
      .readonly(),
    proposedLayerId: z.string().min(1).max(160).nullable(),
    rationale: z.string().trim().min(1).max(4_000),
    usability: z.enum(['usable', 'repairable', 'unusable']),
    scores: z
      .strictObject({
        semanticUsefulness: ScoreSchema,
        completeness: ScoreSchema,
        edgeMatteQuality: ScoreSchema,
        backgroundCleanliness: ScoreSchema,
        granularityIntegrity: ScoreSchema,
        repairReadiness: ScoreSchema,
      })
      .readonly(),
    duplicateOfCandidateOrders: z.array(CandidateOrderSchema).max(7).readonly(),
    mergeWithCandidateOrders: z.array(CandidateOrderSchema).max(7).readonly(),
  })
  .readonly();

export const SamCorpusVisualJudgmentV1Schema = z
  .strictObject({
    candidates: z.array(SamCorpusCandidateVisualJudgmentV1Schema).max(8).readonly(),
    missingLayerObservations: z.array(MissingLayerObservationSchema).max(5).readonly(),
    duplicateObservations: z.array(CandidatePairObservationSchema).max(28).readonly(),
    mergeObservations: z.array(MergeObservationSchema).max(28).readonly(),
    fixtureUsability: z.enum(['usable', 'repairable', 'unusable']),
    fixtureRationale: z.string().trim().min(1).max(4_000),
  })
  .readonly();
