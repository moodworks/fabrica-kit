import { describe, expect, it } from 'vitest';

import {
  ProductGateBackgroundInvocationV1Schema,
  ProductGateSolidFallbackPermissionV1Schema,
  digestProductGateSolidFallbackPermissionV1,
  validateProductGateBackgroundInvocationForCurrentCorpusV1,
} from '../src/evaluation/product-gate-background-v1.js';
import {
  PRODUCT_GATE_BLOCKED_HOLDOUT_V1,
  PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
} from '../src/evaluation/product-gate-corpus-v1.js';
import {
  PRODUCT_GATE_CORRECTION_SEVERITY_V1,
  PRODUCT_GATE_SEGMENTATION_SCORE_ANCHORS_V1,
  ProductGateAdjudicationV1Schema,
  ProductGateBackgroundScorecardV1Schema,
  ProductGateCompositeUsefulnessScorecardV1Schema,
  ProductGateCorrectionBudgetV1Schema,
  ProductGateCorrectionRecordV1Schema,
  ProductGateEndToEndScorecardV1Schema,
  ProductGateSegmentationScorecardV1Schema,
  ProductGateVisionScorecardV1Schema,
  classifyProductGateForegroundMaskCorrectionV1,
  createProductGateAdjudicationV1,
  createProductGateRawReviewV1,
  determineProductGateAdjudicationRequirementV1,
  deterministicProductGatePresentationOrderV1,
  validateProductGateBackgroundScorecardForCurrentCorpusV1,
} from '../src/evaluation/product-gate-scorecards-v1.js';
import {
  ProductGateCutoutStageResultV1Schema,
  ProductGateMaskV1Schema,
  ProductGateMaterializedCutoutV1Schema,
  ProductGateSegmentationCandidateV1Schema,
  ProductGateSegmentationInvocationV1Schema,
  ProductGateSegmentationResultV1Schema,
  createProductGateCompositionProposalIdV1,
  createProductGateCompositionProposalV1,
  createProductGateCutoutIdV1,
  createProductGateMaskIdV1,
  createProductGateSegmentationCandidateIdV1,
  createProductGateSegmentationInvocationIdV1,
  validateProductGateSegmentationInvocationResultV1,
} from '../src/evaluation/product-gate-segmentation-v1.js';
import {
  PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1,
  createProductGateAttemptIdV1,
  createProductGateLogicalOperationIdV1,
  createProductGateRunIdV1,
} from '../src/evaluation/product-gate-run-manifest-v1.js';
import { canonicalizeJson, sha256Hex } from '../src/scene/canonical-scene-json.js';

const sha = (digit: string): string => digit.repeat(64);
const sha256ForJson = (input: unknown): string =>
  sha256Hex(Buffer.from(canonicalizeJson(input), 'utf8'));
const candidateId = `pge_candidate_v1_${sha('a')}`;
const reviewPresentationItemIds = [candidateId] as const;
const reviewPresentationSeed = sha('1');

const usableSegmentation = () =>
  ProductGateSegmentationScorecardV1Schema.parse({
    scorecardVersion: 1,
    semanticElementId: 'element.primary',
    candidateId,
    scores: {
      semanticUsefulness: 3,
      completeness: 3,
      edgeMatteQuality: 3,
      backgroundCleanliness: 3,
      granularityIntegrity: 3,
      repairReadiness: 3,
    },
    anchors: PRODUCT_GATE_SEGMENTATION_SCORE_ANCHORS_V1,
    scorePolarity: 'zero-worst-four-best-no-average',
    duplicateProblem: false,
    fragmentProblem: false,
    classification: 'usable',
  });

const noCorrectionBudget = () =>
  ProductGateCorrectionBudgetV1Schema.parse({
    corrections: [],
    ordinaryCreativeSelectionCount: 0,
    fragmentCombinationCount: 0,
    minorMaskCorrectionCount: 0,
    maximumSeverity: 0,
    withinUsefulBudget: true,
  });

const alphaCorrection = (canvasPixels: number, changedPixels: number) => {
  const before = new Uint8Array(canvasPixels);
  const after = new Uint8Array(canvasPixels);
  after.fill(255, 0, changedPixels);
  return { before, after };
};

const rawReview = (input: {
  readonly reviewerId: string;
  readonly segmentation: 'pass' | 'fail' | 'inconclusive';
  readonly semanticUsefulness: number;
  readonly presentationSeed?: string;
  readonly presentationItemIds?: readonly string[];
}) => {
  const presentationSeed = input.presentationSeed ?? reviewPresentationSeed;
  const presentationItemIds = [
    ...(input.presentationItemIds ?? reviewPresentationItemIds),
  ].toSorted();
  return createProductGateRawReviewV1({
    reviewVersion: 1,
    caseId: 'banner-person-v1',
    reviewerId: input.reviewerId,
    independentReview: true,
    providerModelBlind: true,
    deterministicPresentationSeed: presentationSeed,
    presentationItemIds,
    presentationOrderSha256: sha256ForJson(
      deterministicProductGatePresentationOrderV1({
        seed: presentationSeed,
        itemIds: presentationItemIds,
      }),
    ),
    categorical: {
      vision: 'pass',
      segmentation: input.segmentation,
      background: 'pass',
      composite: 'pass',
    },
    numeric: {
      visionUsefulness: 4,
      semanticUsefulness: input.semanticUsefulness,
      completeness: 4,
      edgeMatteQuality: 4,
      backgroundCleanliness: 4,
      granularityIntegrity: 4,
      repairReadiness: 4,
      backgroundUsability: 4,
      compositeUsefulness: 4,
    },
    rationale: 'Provider/model-blind deterministic test review.',
    modelConfidenceUsedAsOracle: false,
  });
};

describe('separate product-gate scorecards', () => {
  it('strictly derives vision, six-dimensional segmentation, and composite usefulness', () => {
    const vision = ProductGateVisionScorecardV1Schema.parse({
      scorecardVersion: 1,
      expectedLayerCount: { minimum: 3, maximum: 5 },
      actualLayerCount: 4,
      layerCountValid: true,
      semanticRoleAndNameUsefulness: 3,
      criticalElementCount: 3,
      coveredCriticalElementCount: 3,
      criticalElementCoverageComplete: true,
      groupingAllowedByOracle: true,
      directlyVisibleEvidenceOnly: true,
      boundingBoxAgreementBps: 7_000,
      outcome: 'inconclusive',
      modelConfidenceUsedAsOracle: false,
    });
    expect(vision.outcome).toBe('inconclusive');
    expect(
      ProductGateVisionScorecardV1Schema.safeParse({ ...vision, unexpected: true }).success,
    ).toBe(false);

    const segmentation = usableSegmentation();
    expect(Object.keys(segmentation.scores)).toEqual([
      'semanticUsefulness',
      'completeness',
      'edgeMatteQuality',
      'backgroundCleanliness',
      'granularityIntegrity',
      'repairReadiness',
    ]);
    expect(
      ProductGateSegmentationScorecardV1Schema.safeParse({
        ...segmentation,
        duplicateProblem: true,
      }).success,
    ).toBe(false);

    const composite = ProductGateCompositeUsefulnessScorecardV1Schema.parse({
      scorecardVersion: 1,
      everyCriticalElementCovered: true,
      oracleValidCountAndGrouping: true,
      foregroundComponents: [segmentation],
      approvedUsableBackground: true,
      meaningfulAnimationReadyForegroundCount: 1,
      correctionBudget: noCorrectionBudget(),
      unresolvedDuplicateProblem: false,
      unresolvedFragmentProblem: false,
      useful: true,
      outcome: 'pass',
    });
    expect(composite.useful).toBe(true);
    expect(
      ProductGateCompositeUsefulnessScorecardV1Schema.safeParse({
        ...composite,
        meaningfulAnimationReadyForegroundCount: 0,
      }).success,
    ).toBe(false);
    const duplicateComponent = ProductGateSegmentationScorecardV1Schema.parse({
      ...segmentation,
      duplicateProblem: true,
      classification: 'unusable',
    });
    expect(
      ProductGateCompositeUsefulnessScorecardV1Schema.safeParse({
        ...composite,
        foregroundComponents: [duplicateComponent],
        unresolvedDuplicateProblem: false,
      }).success,
    ).toBe(false);
  });

  it('allows reconstruction N/A only for an oracle-authorized deterministic solid fallback', () => {
    const developmentEntry = PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.entries[0];
    const fallback = ProductGateBackgroundScorecardV1Schema.parse({
      scorecardVersion: 1,
      caseId: developmentEntry.caseId,
      originalSourceSha256: developmentEntry.original.sha256,
      normalizedSourceSha256: developmentEntry.normalized.sha256,
      strategy: 'deterministic-solid-fallback',
      strategyResultUsable: true,
      oracleAuthorizationProjectionPresent: true,
      reconstructionDimensions: {
        kind: 'not-applicable',
        reason: 'oracle-authorized-deterministic-solid-fallback',
        permissionSha256: sha('3'),
      },
      usability: 4,
      outcome: 'inconclusive',
    });
    expect(fallback.outcome).toBe('inconclusive');
    expect(() =>
      validateProductGateBackgroundScorecardForCurrentCorpusV1({
        scorecard: fallback,
        corpusManifest: PRODUCT_GATE_BLOCKED_HOLDOUT_V1,
      }),
    ).toThrow(/Blocked holdout/u);
    expect(
      ProductGateBackgroundScorecardV1Schema.safeParse({
        ...fallback,
        oracleAuthorizationProjectionPresent: false,
      }).success,
    ).toBe(false);
    expect(
      ProductGateBackgroundScorecardV1Schema.safeParse({
        ...fallback,
        strategy: 'reconstruction',
      }).success,
    ).toBe(false);
    expect(
      ProductGateBackgroundScorecardV1Schema.parse({
        scorecardVersion: 1,
        caseId: developmentEntry.caseId,
        originalSourceSha256: developmentEntry.original.sha256,
        normalizedSourceSha256: developmentEntry.normalized.sha256,
        strategy: 'not-attempted',
        strategyResultUsable: false,
        oracleAuthorizationProjectionPresent: false,
        reconstructionDimensions: {
          kind: 'scored',
          removedObjectLeakage: 0,
          continuity: 0,
          contamination: 0,
        },
        usability: 0,
        outcome: 'inconclusive',
      }).outcome,
    ).toBe('inconclusive');

    const reconstruction = ProductGateBackgroundScorecardV1Schema.parse({
      scorecardVersion: 1,
      caseId: developmentEntry.caseId,
      originalSourceSha256: developmentEntry.original.sha256,
      normalizedSourceSha256: developmentEntry.normalized.sha256,
      strategy: 'reconstruction',
      strategyResultUsable: true,
      oracleAuthorizationProjectionPresent: false,
      reconstructionDimensions: {
        kind: 'scored',
        removedObjectLeakage: 4,
        continuity: 4,
        contamination: 4,
      },
      usability: 4,
      outcome: 'inconclusive',
    });
    expect(
      validateProductGateBackgroundScorecardForCurrentCorpusV1({
        scorecard: reconstruction,
        corpusManifest: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
      }).strategy,
    ).toBe('reconstruction');
    expect(() =>
      validateProductGateBackgroundScorecardForCurrentCorpusV1({
        scorecard: reconstruction,
        corpusManifest: PRODUCT_GATE_BLOCKED_HOLDOUT_V1,
      }),
    ).toThrow(/Blocked holdout/u);
    for (const drifted of [
      { ...reconstruction, originalSourceSha256: sha('e') },
      { ...reconstruction, normalizedSourceSha256: sha('f') },
    ]) {
      expect(() =>
        validateProductGateBackgroundScorecardForCurrentCorpusV1({
          scorecard: drifted,
          corpusManifest: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
        }),
      ).toThrow(/exact development case and source/u);
    }
  });

  it('keeps the E2E result not-measurable until separate authoritative GDN evidence exists', () => {
    const absent = ProductGateEndToEndScorecardV1Schema.parse({
      scorecardVersion: 1,
      compositeUsefulness: 'pass',
      sceneMaterialization: 'pass',
      presetAndTargetAppropriateness: 'pass',
      preview: 'pass',
      export: 'pass',
      authoritativeValidation: {
        kind: 'absent-gdn-authority',
        status: 'not-measurable',
        authority: false,
        internalProviderFreeValidationAcceptedAsGdn: false,
      },
      failureRecovery: 'pass',
      sevenRequirementCount: 7,
      outcome: 'not-measurable',
    });
    expect(absent.outcome).toBe('not-measurable');
    expect(
      ProductGateEndToEndScorecardV1Schema.safeParse({ ...absent, outcome: 'pass' }).success,
    ).toBe(false);

    expect(
      ProductGateEndToEndScorecardV1Schema.safeParse({
        ...absent,
        authoritativeValidation: {
          kind: 'authoritative-gdn-evidence',
          status: 'pass',
          authority: true,
          validatorIdentitySha256: sha('4'),
          evidenceSha256: sha('5'),
          gateIdentity: 'separate-authoritative-gdn-gate',
          internalProviderFreeValidationAcceptedAsGdn: false,
        },
        outcome: 'pass',
      }).success,
    ).toBe(false);
  });
});

describe('closed correction taxonomy and exact mask boundaries', () => {
  it('classifies below, exactly at, and above both minor-correction thresholds', () => {
    for (const changedPixels of [19, 20]) {
      const { before, after } = alphaCorrection(1_000, changedPixels);
      expect(
        classifyProductGateForegroundMaskCorrectionV1({
          alphaBefore: before,
          alphaCorrected: after,
          oracleTargetPixels: 200,
          connectedEditRegionCount: 1,
          recoveredMissingCriticalSemanticElement: false,
        }).correctionClass,
      ).toBe('minor-mask-correction');
    }
    const aboveSource = alphaCorrection(1_000, 21);
    expect(
      classifyProductGateForegroundMaskCorrectionV1({
        alphaBefore: aboveSource.before,
        alphaCorrected: aboveSource.after,
        oracleTargetPixels: 1_000,
        connectedEditRegionCount: 1,
        recoveredMissingCriticalSemanticElement: false,
      }).correctionClass,
    ).toBe('major-mask-correction');
    const aboveOracle = alphaCorrection(2_000, 21);
    expect(
      classifyProductGateForegroundMaskCorrectionV1({
        alphaBefore: aboveOracle.before,
        alphaCorrected: aboveOracle.after,
        oracleTargetPixels: 200,
        connectedEditRegionCount: 1,
        recoveredMissingCriticalSemanticElement: false,
      }).correctionClass,
    ).toBe('major-mask-correction');
  });

  it('fails closed for zero denominators, multiple edit regions, and recovered critical elements', () => {
    expect(
      classifyProductGateForegroundMaskCorrectionV1({
        alphaBefore: new Uint8Array(),
        alphaCorrected: new Uint8Array(),
        oracleTargetPixels: 0,
        connectedEditRegionCount: 0,
        recoveredMissingCriticalSemanticElement: false,
      }),
    ).toMatchObject({
      denominatorsValid: false,
      correctionClass: 'major-mask-correction',
      severity: PRODUCT_GATE_CORRECTION_SEVERITY_V1['major-mask-correction'],
    });
    const twoPixels = alphaCorrection(1_000, 2);
    expect(
      classifyProductGateForegroundMaskCorrectionV1({
        alphaBefore: twoPixels.before,
        alphaCorrected: twoPixels.after,
        oracleTargetPixels: 100,
        connectedEditRegionCount: 2,
        recoveredMissingCriticalSemanticElement: false,
      }).correctionClass,
    ).toBe('major-mask-correction');
    const onePixel = alphaCorrection(1_000, 1);
    expect(
      classifyProductGateForegroundMaskCorrectionV1({
        alphaBefore: onePixel.before,
        alphaCorrected: onePixel.after,
        oracleTargetPixels: 100,
        connectedEditRegionCount: 1,
        recoveredMissingCriticalSemanticElement: true,
      }).correctionClass,
    ).toBe('major-mask-correction');
    expect(() =>
      classifyProductGateForegroundMaskCorrectionV1({
        alphaBefore: onePixel.before,
        alphaCorrected: onePixel.after,
        oracleTargetPixels: 1_001,
        connectedEditRegionCount: 1,
        recoveredMissingCriticalSemanticElement: false,
      }),
    ).toThrow();
    expect(() =>
      classifyProductGateForegroundMaskCorrectionV1({
        alphaBefore: onePixel.before,
        alphaCorrected: onePixel.after,
        oracleTargetPixels: 100,
        connectedEditRegionCount: 0,
        recoveredMissingCriticalSemanticElement: false,
      }),
    ).toThrow();
  });

  it('does not count ordinary creative selection and closes the useful correction budget', () => {
    const creative = ProductGateCorrectionRecordV1Schema.parse({
      correctionClass: 'none',
      severity: 0,
      ordinaryCreativeIncludeExcludeSelection: true,
      countedAsCorrection: false,
      rationale: 'Ordinary creative selection.',
    });
    const fragment = ProductGateCorrectionRecordV1Schema.parse({
      correctionClass: 'combining-fragments',
      severity: 4,
      ordinaryCreativeIncludeExcludeSelection: false,
      countedAsCorrection: true,
      rationale: 'One fragment combination.',
    });
    const minor = ProductGateCorrectionRecordV1Schema.parse({
      correctionClass: 'minor-mask-correction',
      severity: 5,
      ordinaryCreativeIncludeExcludeSelection: false,
      countedAsCorrection: true,
      rationale: 'One bounded mask correction.',
    });
    expect(
      ProductGateCorrectionBudgetV1Schema.parse({
        corrections: [creative, fragment, minor],
        ordinaryCreativeSelectionCount: 1,
        fragmentCombinationCount: 1,
        minorMaskCorrectionCount: 1,
        maximumSeverity: 5,
        withinUsefulBudget: true,
      }).withinUsefulBudget,
    ).toBe(true);
    expect(
      ProductGateCorrectionBudgetV1Schema.safeParse({
        corrections: [fragment, fragment],
        ordinaryCreativeSelectionCount: 0,
        fragmentCombinationCount: 2,
        minorMaskCorrectionCount: 0,
        maximumSeverity: 4,
        withinUsefulBudget: true,
      }).success,
    ).toBe(false);
  });
});

describe('provider/model-blind review and adjudication', () => {
  it('uses deterministic seeded order and triggers on categorical or >=2 numeric disagreement', () => {
    const items = ['candidate-c', 'candidate-a', 'candidate-b'];
    const firstOrder = deterministicProductGatePresentationOrderV1({
      seed: sha('6'),
      itemIds: items,
    });
    const secondOrder = deterministicProductGatePresentationOrderV1({
      seed: sha('6'),
      itemIds: items,
    });
    expect(secondOrder).toEqual(firstOrder);
    expect(new Set(firstOrder)).toEqual(new Set(items));

    const first = rawReview({
      reviewerId: 'reviewer_alpha',
      segmentation: 'pass',
      semanticUsefulness: 4,
    });
    const second = rawReview({
      reviewerId: 'reviewer_beta',
      segmentation: 'fail',
      semanticUsefulness: 2,
    });
    const requirement = determineProductGateAdjudicationRequirementV1({ first, second });
    expect(requirement).toMatchObject({
      required: true,
      categoricalDisagreements: ['segmentation'],
      numericDifferencesAtLeastTwo: ['semanticUsefulness'],
    });
    const differentlyPresented = rawReview({
      reviewerId: 'reviewer_eta',
      segmentation: 'fail',
      semanticUsefulness: 2,
      presentationSeed: sha('7'),
    });
    expect(() =>
      determineProductGateAdjudicationRequirementV1({
        first,
        second: differentlyPresented,
      }),
    ).toThrow(/presentation/u);
    const adjudication = createProductGateAdjudicationV1({
      adjudicationVersion: 1,
      rawReviews: [first, second],
      requirement,
      thirdReviewerId: 'reviewer_gamma',
      finalClassification: 'pass',
      rationale: 'Third blinded reviewer resolves the recorded disagreement.',
      rawReviewsOverwritten: false,
      modelConfidenceUsedAsOracle: false,
    });
    expect(adjudication.rawReviews.map((review) => review.reviewRecordId)).toEqual([
      first.reviewRecordId,
      second.reviewRecordId,
    ]);
    expect(
      ProductGateAdjudicationV1Schema.safeParse({ ...adjudication, unexpected: true }).success,
    ).toBe(false);
  });

  it('does not trigger for identical categories and numeric differences below two', () => {
    const first = rawReview({
      reviewerId: 'reviewer_delta',
      segmentation: 'pass',
      semanticUsefulness: 4,
    });
    const second = rawReview({
      reviewerId: 'reviewer_epsilon',
      segmentation: 'pass',
      semanticUsefulness: 3,
    });
    expect(determineProductGateAdjudicationRequirementV1({ first, second }).required).toBe(false);
    expect(() =>
      createProductGateAdjudicationV1({
        adjudicationVersion: 1,
        rawReviews: [first, second],
        requirement: determineProductGateAdjudicationRequirementV1({ first, second }),
        thirdReviewerId: 'reviewer_zeta',
        finalClassification: 'pass',
        rationale: 'No adjudication should be created.',
        rawReviewsOverwritten: false,
        modelConfidenceUsedAsOracle: false,
      }),
    ).toThrow();
  });
});

describe('provider-neutral segmentation and background association boundaries', () => {
  const validAssociationFixture = () => {
    const sourceAssetSha256 = sha('8');
    const proposal = createProductGateCompositionProposalV1({
      request: {
        sourceAsset: { sha256: sourceAssetSha256 },
        maxParts: 1,
        includeBackground: true,
      },
      result: {
        kind: 'composition_proposal',
        proposalVersion: 1,
        sourceAssetSha256,
        parts: [
          {
            partKey: 'subject.primary',
            label: 'Primary subject',
            role: 'subject',
            bounds: { xBps: 0, yBps: 0, widthBps: 10_000, heightBps: 10_000 },
          },
        ],
      },
      criticalPartKeys: ['subject.primary'],
    });
    const candidateCore = {
      proposalId: proposal.proposalId,
      semanticElementId: proposal.elements[0]!.semanticElementId,
      candidateOrdinal: 1,
      disposition: { kind: 'primary' as const },
    };
    const candidate = ProductGateSegmentationCandidateV1Schema.parse({
      candidateId: createProductGateSegmentationCandidateIdV1(candidateCore),
      ...candidateCore,
    });
    const maskCore = {
      candidateId: candidate.candidateId,
      sourceAssetSha256,
      pixelWidth: 10,
      pixelHeight: 10,
      alphaSha256: sha('9'),
    };
    const mask = ProductGateMaskV1Schema.parse({
      maskId: createProductGateMaskIdV1(maskCore),
      ...maskCore,
    });
    const cutoutCore = {
      maskId: mask.maskId,
      mediaType: 'image/png' as const,
      byteSize: 100,
      pixelWidth: 10,
      pixelHeight: 10,
      sha256: sha('a'),
    };
    const cutout = ProductGateMaterializedCutoutV1Schema.parse({
      cutoutId: createProductGateCutoutIdV1(cutoutCore),
      ...cutoutCore,
    });
    const runId = createProductGateRunIdV1({ association: true });
    const logicalOperationId = createProductGateLogicalOperationIdV1({
      runId,
      stage: 'segmentation',
    });
    const attemptId = createProductGateAttemptIdV1({
      recordVersion: 1,
      runId,
      caseId: 'banner-person-v1',
      attemptOrdinal: 1,
      stage: 'segmentation',
      logicalOperationId,
      parentAttemptId: null,
      retry: null,
    });
    const invocationCore = {
      invocationVersion: 1 as const,
      boundary: 'evaluation-only-provider-neutral-segmentation' as const,
      runId,
      attemptId,
      logicalOperationId,
      sourceAssetSha256,
      proposal,
      provenance: PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1,
      providerCallAuthority: false as const,
    };
    const invocation = ProductGateSegmentationInvocationV1Schema.parse({
      invocationId: createProductGateSegmentationInvocationIdV1(invocationCore),
      ...invocationCore,
    });
    const cutoutLogicalOperationId = createProductGateLogicalOperationIdV1({
      runId,
      stage: 'cutout',
    });
    const cutoutAttemptId = createProductGateAttemptIdV1({
      recordVersion: 1,
      runId,
      caseId: 'banner-person-v1',
      attemptOrdinal: 1,
      stage: 'cutout',
      logicalOperationId: cutoutLogicalOperationId,
      parentAttemptId: null,
      retry: null,
    });
    const result = {
      resultVersion: 1 as const,
      boundary: 'evaluation-only-provider-neutral-segmentation' as const,
      invocationId: invocation.invocationId,
      runId,
      attemptId,
      logicalOperationId,
      sourceAssetSha256,
      proposalId: proposal.proposalId,
      proposal,
      semanticElements: proposal.elements,
      candidates: [candidate],
      masks: [mask],
      cutouts: [cutout],
      associations: [
        {
          proposalId: proposal.proposalId,
          semanticElementId: candidate.semanticElementId,
          candidateId: candidate.candidateId,
          maskId: mask.maskId,
          cutoutId: cutout.cutoutId,
        },
      ],
      provenance: PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1,
      providerCallAuthority: false as const,
    };
    return {
      proposal,
      invocation,
      candidate,
      mask,
      cutout,
      runId,
      attemptId,
      logicalOperationId,
      cutoutAttemptId,
      cutoutLogicalOperationId,
      result,
    };
  };

  it('accepts one exact proposal→candidate→mask→cutout chain and rejects duplicates or orphans', () => {
    const fixture = validAssociationFixture();
    expect(ProductGateSegmentationResultV1Schema.parse(fixture.result).associations).toHaveLength(
      1,
    );
    expect(
      validateProductGateSegmentationInvocationResultV1({
        invocation: fixture.invocation,
        result: fixture.result,
      }).invocationId,
    ).toBe(fixture.invocation.invocationId);
    expect(
      ProductGateSegmentationInvocationV1Schema.safeParse({
        ...fixture.invocation,
        providerField: 'forbidden',
      }).success,
    ).toBe(false);
    expect(() =>
      validateProductGateSegmentationInvocationResultV1({
        invocation: fixture.invocation,
        result: {
          ...fixture.result,
          invocationId: `pge_segmentation_invocation_v1_${sha('f')}`,
        },
      }),
    ).toThrow(/exactly bind/u);
    expect(
      ProductGateSegmentationResultV1Schema.safeParse({
        ...fixture.result,
        associations: [...fixture.result.associations, fixture.result.associations[0]],
      }).success,
    ).toBe(false);
    expect(
      ProductGateSegmentationResultV1Schema.safeParse({
        ...fixture.result,
        cutouts: [],
      }).success,
    ).toBe(false);
    expect(
      ProductGateSegmentationResultV1Schema.safeParse({
        ...fixture.result,
        provenance: { ...PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1, endpointId: 'forbidden' },
      }).success,
    ).toBe(false);
  });

  it('binds cutout-stage evidence to its own attempt and one exact segmentation result', () => {
    const fixture = validAssociationFixture();
    const envelope = ProductGateCutoutStageResultV1Schema.parse({
      resultVersion: 1,
      boundary: 'evaluation-only-provider-neutral-cutout',
      runId: fixture.runId,
      attemptId: fixture.cutoutAttemptId,
      logicalOperationId: fixture.cutoutLogicalOperationId,
      segmentationInvocation: fixture.invocation,
      segmentationResult: fixture.result,
      provenance: PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1,
      providerCallAuthority: false,
    });
    expect(envelope.attemptId).toBe(fixture.cutoutAttemptId);
    expect(envelope.segmentationResult.attemptId).toBe(fixture.attemptId);
    for (const drifted of [
      { ...envelope, runId: createProductGateRunIdV1({ drift: 'run' }) },
      { ...envelope, attemptId: fixture.attemptId },
      { ...envelope, logicalOperationId: fixture.logicalOperationId },
    ]) {
      expect(ProductGateCutoutStageResultV1Schema.safeParse(drifted).success).toBe(false);
    }
  });

  it('rejects fragment, duplicate, ambiguous, and incompatible-proposal candidate reuse', () => {
    const fixture = validAssociationFixture();
    for (const disposition of [
      { kind: 'fragment' as const, fragmentGroupId: sha('b') },
      { kind: 'duplicate' as const, duplicateOfCandidateId: fixture.candidate.candidateId },
      { kind: 'ambiguous-proposal-ownership' as const },
    ]) {
      const core = {
        proposalId: fixture.proposal.proposalId,
        semanticElementId: fixture.candidate.semanticElementId,
        candidateOrdinal: 1,
        disposition,
      };
      const candidateInput = {
        candidateId: createProductGateSegmentationCandidateIdV1(core),
        ...core,
      };
      expect(
        ProductGateSegmentationResultV1Schema.safeParse({
          ...fixture.result,
          candidates: [candidateInput],
        }).success,
      ).toBe(false);
    }
    const otherProposalId = createProductGateCompositionProposalIdV1({
      sourceAssetSha256: sha('c'),
      compositionResult: {
        kind: 'no_useful_layers',
        proposalVersion: 1,
        sourceAssetSha256: sha('c'),
        reason: 'flat_image',
      },
    });
    const incompatibleCore = {
      proposalId: otherProposalId,
      semanticElementId: fixture.candidate.semanticElementId,
      candidateOrdinal: 1,
      disposition: { kind: 'primary' as const },
    };
    expect(
      ProductGateSegmentationResultV1Schema.safeParse({
        ...fixture.result,
        candidates: [
          {
            candidateId: createProductGateSegmentationCandidateIdV1(incompatibleCore),
            ...incompatibleCore,
          },
        ],
      }).success,
    ).toBe(false);
  });

  it('requires explicit oracle permission for solid fallback and keeps invocation authority false', () => {
    const fixture = validAssociationFixture();
    const developmentEntry = PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.entries[0];
    const permissionCore = {
      permissionVersion: 1 as const,
      permissionKind: 'explicit-case-oracle-solid-fallback' as const,
      corpusSplit: 'holdout' as const,
      caseId: 'banner-person-v1',
      corpusManifestSha256: PRODUCT_GATE_BLOCKED_HOLDOUT_V1.manifestSha256,
      originalSourceSha256: sha('7'),
      normalizedSourceSha256: sha('8'),
      oracleSha256: sha('d'),
      proposalId: fixture.proposal.proposalId,
      permittedSolidRgba: [255, 255, 255, 255] as const,
      holdoutAdmissionManifestSha256: PRODUCT_GATE_BLOCKED_HOLDOUT_V1.manifestSha256,
      explicitlyPermitted: true as const,
    };
    const permission = ProductGateSolidFallbackPermissionV1Schema.parse({
      ...permissionCore,
      permissionSha256: digestProductGateSolidFallbackPermissionV1(permissionCore),
    });
    const invocation = {
      invocationVersion: 1,
      boundary: 'evaluation-only-provider-neutral-background',
      runId: fixture.runId,
      attemptId: fixture.attemptId,
      logicalOperationId: fixture.logicalOperationId,
      caseId: 'banner-person-v1',
      originalSourceSha256: sha('7'),
      sourceAssetSha256: sha('8'),
      proposalId: fixture.proposal.proposalId,
      strategy: 'deterministic-solid-fallback',
      solidFallbackPermission: permission,
      provenance: PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1,
      providerCallAuthority: false,
    };
    expect(ProductGateBackgroundInvocationV1Schema.parse(invocation).providerCallAuthority).toBe(
      false,
    );
    expect(
      ProductGateBackgroundInvocationV1Schema.safeParse({
        ...invocation,
        solidFallbackPermission: null,
      }).success,
    ).toBe(false);
    expect(() =>
      validateProductGateBackgroundInvocationForCurrentCorpusV1({
        invocation,
        corpusManifest: PRODUCT_GATE_BLOCKED_HOLDOUT_V1,
      }),
    ).toThrow(/Blocked holdout/u);
    const reconstruction = {
      ...invocation,
      caseId: developmentEntry.caseId,
      originalSourceSha256: developmentEntry.original.sha256,
      sourceAssetSha256: developmentEntry.normalized.sha256,
      strategy: 'reconstruction' as const,
      solidFallbackPermission: null,
    };
    expect(
      validateProductGateBackgroundInvocationForCurrentCorpusV1({
        invocation: reconstruction,
        corpusManifest: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
      }).strategy,
    ).toBe('reconstruction');
    expect(() =>
      validateProductGateBackgroundInvocationForCurrentCorpusV1({
        invocation: reconstruction,
        corpusManifest: PRODUCT_GATE_BLOCKED_HOLDOUT_V1,
      }),
    ).toThrow(/Blocked holdout/u);
    for (const drifted of [
      { ...reconstruction, originalSourceSha256: sha('e') },
      { ...reconstruction, sourceAssetSha256: sha('f') },
    ]) {
      expect(() =>
        validateProductGateBackgroundInvocationForCurrentCorpusV1({
          invocation: drifted,
          corpusManifest: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
        }),
      ).toThrow(/exact development case and source/u);
    }
    expect(
      ProductGateBackgroundInvocationV1Schema.safeParse({
        ...reconstruction,
        providerField: true,
      }).success,
    ).toBe(false);
  });
});
