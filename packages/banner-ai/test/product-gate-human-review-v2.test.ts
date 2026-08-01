import { describe, expect, it } from 'vitest';

import { PRODUCT_GATE_HOLDOUT_STRUCTURAL_FAKE_V2 } from '../src/evaluation/product-gate-corpus-v2.js';
import {
  PRODUCT_GATE_SHAREABLE_REVIEW_SAFETY_V2,
  ProductGateHumanAdjudicationV2Schema,
  ProductGateOpaqueCaseIdV2Schema,
  ProductGatePrivateBoundHumanReviewV2Schema,
  ProductGatePrimaryReviewV2Schema,
  ProductGateReviewPresentationV2Schema,
  ProductGateThirdReviewV2Schema,
  createProductGateHumanAdjudicationV2,
  createProductGateOpaqueCaseBindingV2,
  createProductGateOpaqueCaseIdV2,
  createProductGatePrimaryReviewV2,
  createProductGateReviewPresentationItemIdV2,
  createProductGateReviewPresentationV2,
  createProductGateReviewerIdV2,
  createProductGateThirdReviewV2,
  determineProductGateThirdReviewRequirementV2,
  validateProductGatePrivateHumanReviewBindingV2,
  type ProductGateCategoricalReviewScoresV2,
  type ProductGateNumericReviewScoresV2,
  type ProductGatePrimaryReviewV2,
  type ProductGateReviewConflictDeclarationV2,
  type ProductGateReviewPresentationV2,
  type ProductGateThirdReviewV2,
} from '../src/evaluation/product-gate-human-review-v2.js';
import { canonicalizeJson, sha256Hex } from '../src/scene/canonical-scene-json.js';

const admittedCase = PRODUCT_GATE_HOLDOUT_STRUCTURAL_FAKE_V2.cases[0]!;
const privateCaseBindingInput = {
  bindingVersion: 2 as const,
  corpusManifest: PRODUCT_GATE_HOLDOUT_STRUCTURAL_FAKE_V2,
  admittedCaseId: admittedCase.caseId,
};
const privateCaseBinding = createProductGateOpaqueCaseBindingV2(privateCaseBindingInput);
const caseId = createProductGateOpaqueCaseIdV2(privateCaseBindingInput);
const firstReviewerId = createProductGateReviewerIdV2({ reviewer: 'one' });
const secondReviewerId = createProductGateReviewerIdV2({ reviewer: 'two' });
const thirdReviewerId = createProductGateReviewerIdV2({ reviewer: 'three' });
const projectionSha256 = (name: string) => sha256Hex(Buffer.from(`projection:${name}`, 'utf8'));

const presentationWithRecomputedIdentity = (core: object) => {
  const presentationSha256 = sha256Hex(Buffer.from(canonicalizeJson(core), 'utf8'));
  return {
    presentationId: `pge_review_presentation_v2_${presentationSha256}`,
    presentationSha256,
    ...core,
  };
};

const presentationItem = (
  ordinal: number,
  kind: 'source-projection' | 'composite-projection',
  projectionName: string,
) => {
  const evidenceProjectionSha256 = projectionSha256(projectionName);
  return {
    itemId: createProductGateReviewPresentationItemIdV2({
      caseId,
      ordinal,
      kind,
      evidenceProjectionSha256,
    }),
    ordinal,
    kind,
    evidenceProjectionSha256,
  };
};

const presentation = createProductGateReviewPresentationV2({
  presentationVersion: 2,
  caseId,
  items: [
    presentationItem(1, 'source-projection', 'source'),
    presentationItem(2, 'composite-projection', 'composite'),
  ],
  providerModelBlind: true,
  shareableSafety: PRODUCT_GATE_SHAREABLE_REVIEW_SAFETY_V2,
});

const categorical = Object.freeze({
  vision: 'pass' as const,
  segmentation: 'pass' as const,
  background: 'pass' as const,
  composite: 'pass' as const,
});

const numeric = Object.freeze({
  visionUsefulness: 3,
  semanticUsefulness: 3,
  completeness: 3,
  edgeMatteQuality: 3,
  backgroundCleanliness: 3,
  granularityIntegrity: 3,
  repairReadiness: 3,
  backgroundUsability: 3,
  compositeUsefulness: 3,
});

const noConflict = Object.freeze({
  declarationVersion: 2 as const,
  declarationComplete: true as const,
  selectedCase: false,
  tunedAgainstCase: false,
  createdCaseOracle: false,
  otherConflictDeclared: false,
  statement: 'No relevant conflict declared.',
});

const primary = (input: {
  readonly role: 'primary-one' | 'primary-two';
  readonly reviewerId: typeof firstReviewerId;
  readonly reviewerKind?: 'maintainer' | 'non-maintainer';
  readonly boundPresentation?: ProductGateReviewPresentationV2;
  readonly categorical?: ProductGateCategoricalReviewScoresV2;
  readonly numeric?: ProductGateNumericReviewScoresV2;
  readonly conflict?: ProductGateReviewConflictDeclarationV2;
  readonly rationale?: string;
}): ProductGatePrimaryReviewV2 =>
  createProductGatePrimaryReviewV2({
    reviewVersion: 2,
    caseId,
    reviewRole: input.role,
    reviewerId: input.reviewerId,
    reviewerKind: input.reviewerKind ?? 'non-maintainer',
    independentReview: true,
    providerModelBlind: true,
    otherPrimaryScoresAccessed: false,
    presentation: input.boundPresentation ?? presentation,
    conflictDeclaration: input.conflict ?? noConflict,
    categorical: input.categorical ?? categorical,
    numeric: input.numeric ?? numeric,
    rationale: input.rationale ?? 'Evidence meets the frozen review anchors.',
    shareableSafety: PRODUCT_GATE_SHAREABLE_REVIEW_SAFETY_V2,
  });

const third = (input?: {
  readonly reviewerId?: typeof firstReviewerId;
  readonly reviewerKind?: 'maintainer' | 'non-maintainer';
  readonly boundPresentation?: ProductGateReviewPresentationV2;
  readonly categorical?: ProductGateCategoricalReviewScoresV2;
  readonly numeric?: ProductGateNumericReviewScoresV2;
  readonly nonMaintainerUnavailableRationale?: string | null;
}): ProductGateThirdReviewV2 =>
  createProductGateThirdReviewV2({
    reviewVersion: 2,
    caseId,
    reviewRole: 'third',
    reviewerId: input?.reviewerId ?? thirdReviewerId,
    reviewerKind: input?.reviewerKind ?? 'non-maintainer',
    independentReview: true,
    providerModelBlind: true,
    primaryScoresAccessed: false,
    completedBeforePrimaryScoresRevealed: true,
    nonMaintainerThirdPreferred: true,
    nonMaintainerUnavailableRationale: input?.nonMaintainerUnavailableRationale ?? null,
    presentation: input?.boundPresentation ?? presentation,
    conflictDeclaration: noConflict,
    categorical: input?.categorical ?? categorical,
    numeric: input?.numeric ?? numeric,
    rationale: 'Independent third review applies the same frozen anchors.',
    shareableSafety: PRODUCT_GATE_SHAREABLE_REVIEW_SAFETY_V2,
  });

describe('product-gate human review V2 exported presentation schema', () => {
  it('rejects malformed semantic cores with independently recomputed outer identities', () => {
    const {
      presentationId: ignoredPresentationId,
      presentationSha256: ignoredPresentationSha256,
      ...validCore
    } = presentation;
    void ignoredPresentationId;
    void ignoredPresentationSha256;

    const malformedCores = [
      {
        name: 'noncanonical item order',
        core: { ...validCore, items: [...validCore.items].toReversed() },
        expectedMessage:
          'Presentation items must have unique identities and exact contiguous order.',
        expectedPath: ['items'],
      },
      {
        name: 'evidence projection identity binding',
        core: {
          ...validCore,
          items: validCore.items.map((item, index) =>
            index === 0
              ? {
                  ...item,
                  evidenceProjectionSha256: projectionSha256('malformed-binding'),
                }
              : item,
          ),
        },
        expectedMessage:
          'Presentation item identity must bind its case, order, kind, and projection.',
        expectedPath: ['items', 0, 'itemId'],
      },
    ];

    for (const { name, core, expectedMessage, expectedPath } of malformedCores) {
      const malformed = presentationWithRecomputedIdentity(core);
      expect(malformed.presentationSha256, name).toBe(
        sha256Hex(Buffer.from(canonicalizeJson(core), 'utf8')),
      );
      expect(malformed.presentationId, name).toBe(
        `pge_review_presentation_v2_${malformed.presentationSha256}`,
      );
      expect(malformed.presentationSha256, name).not.toBe(presentation.presentationSha256);

      const result = ProductGateReviewPresentationV2Schema.safeParse(malformed);
      expect(result.success, name).toBe(false);
      if (result.success) throw new TypeError(`Malformed presentation passed: ${name}`);
      expect(result.error.issues, name).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ message: expectedMessage, path: expectedPath }),
        ]),
      );
      expect(
        result.error.issues.some(
          (issue) => issue.message === 'Review presentation content identity drifted.',
        ),
        name,
      ).toBe(false);
    }
  });

  it('accepts a valid control with the same deterministic presentation identity', () => {
    const replay = createProductGateReviewPresentationV2({
      presentationVersion: presentation.presentationVersion,
      caseId: presentation.caseId,
      items: presentation.items,
      providerModelBlind: presentation.providerModelBlind,
      shareableSafety: presentation.shareableSafety,
    });
    const result = ProductGateReviewPresentationV2Schema.safeParse(replay);

    expect(result.success).toBe(true);
    if (!result.success) throw result.error;
    expect(result.data.presentationId).toBe(presentation.presentationId);
    expect(result.data.presentationSha256).toBe(presentation.presentationSha256);
    expect(canonicalizeJson(result.data)).toBe(canonicalizeJson(presentation));
  });
});

describe('product-gate human review V2 primary independence', () => {
  it('requires two distinct blind independent reviewers in distinct primary roles', () => {
    const first = primary({ role: 'primary-one', reviewerId: firstReviewerId });
    const second = primary({ role: 'primary-two', reviewerId: secondReviewerId });

    expect(determineProductGateThirdReviewRequirementV2({ first, second })).toMatchObject({
      thirdReviewRequired: false,
      categoricalDisagreementFields: [],
      numericDifferenceAtLeastTwoFields: [],
    });
    expect(first).toMatchObject({
      independentReview: true,
      providerModelBlind: true,
      otherPrimaryScoresAccessed: false,
    });
    expect(() =>
      determineProductGateThirdReviewRequirementV2({
        first,
        second: primary({ role: 'primary-two', reviewerId: firstReviewerId }),
      }),
    ).toThrow(/distinct roles and reviewers/u);
    expect(() =>
      determineProductGateThirdReviewRequirementV2({
        first,
        second: primary({ role: 'primary-one', reviewerId: secondReviewerId }),
      }),
    ).toThrow(/distinct roles and reviewers/u);
    expect(
      ProductGatePrimaryReviewV2Schema.safeParse({
        ...first,
        otherPrimaryScoresAccessed: true,
      }).success,
    ).toBe(false);
  });

  it('requires the exact same content-derived presentation, not merely one case ID', () => {
    const otherPresentation = createProductGateReviewPresentationV2({
      presentationVersion: 2,
      caseId,
      items: [presentationItem(1, 'source-projection', 'different')],
      providerModelBlind: true,
      shareableSafety: PRODUCT_GATE_SHAREABLE_REVIEW_SAFETY_V2,
    });
    const first = primary({ role: 'primary-one', reviewerId: firstReviewerId });
    const second = primary({
      role: 'primary-two',
      reviewerId: secondReviewerId,
      boundPresentation: otherPresentation,
    });

    expect(() => determineProductGateThirdReviewRequirementV2({ first, second })).toThrow(
      /one exact presentation/u,
    );
    expect(
      ProductGateReviewPresentationV2Schema.safeParse({
        ...presentation,
        presentationSha256: 'f'.repeat(64),
      }).success,
    ).toBe(false);
    expect(() =>
      createProductGateReviewPresentationV2({
        presentationVersion: 2,
        caseId,
        items: [
          {
            ...presentation.items[0]!,
            evidenceProjectionSha256: projectionSha256('different-content-same-item-id'),
          },
        ],
        providerModelBlind: true,
        shareableSafety: PRODUCT_GATE_SHAREABLE_REVIEW_SAFETY_V2,
      }),
    ).toThrow(/projection/u);
  });
});

describe('product-gate human review V2 deterministic resolution', () => {
  it('resolves every one-point numeric difference to the lower primary score without a third', () => {
    const first = primary({ role: 'primary-one', reviewerId: firstReviewerId });
    const second = primary({
      role: 'primary-two',
      reviewerId: secondReviewerId,
      numeric: { ...numeric, visionUsefulness: 4, backgroundUsability: 2 },
    });
    const result = createProductGateHumanAdjudicationV2({
      first,
      second,
      thirdReview: null,
    });

    expect(result.requirement.thirdReviewRequired).toBe(false);
    expect(result.thirdReview).toBeNull();
    expect(result.thirdReviewTiming).toEqual({ kind: 'not-required' });
    expect(result.resolvedNumeric).toMatchObject({
      visionUsefulness: 3,
      backgroundUsability: 2,
    });
    expect(result.resolvedCategorical).toEqual(categorical);
    expect(() =>
      createProductGateHumanAdjudicationV2({ first, second, thirdReview: third() }),
    ).toThrow(/if and only if/u);
  });

  it('triggers on any categorical disagreement or numeric gap of two and uses the third median', () => {
    const first = primary({
      role: 'primary-one',
      reviewerId: firstReviewerId,
      numeric: { ...numeric, semanticUsefulness: 1, completeness: 3 },
    });
    const second = primary({
      role: 'primary-two',
      reviewerId: secondReviewerId,
      categorical: { ...categorical, vision: 'fail' },
      numeric: { ...numeric, semanticUsefulness: 3, completeness: 4 },
    });
    const thirdReview = third({
      categorical: {
        vision: 'inconclusive',
        segmentation: 'fail',
        background: 'fail',
        composite: 'fail',
      },
      numeric: { ...numeric, semanticUsefulness: 2, completeness: 0 },
    });
    const firstBefore = canonicalizeJson(first);
    const secondBefore = canonicalizeJson(second);
    const requirement = determineProductGateThirdReviewRequirementV2({ first, second });

    expect(requirement).toMatchObject({
      thirdReviewRequired: true,
      categoricalDisagreementFields: ['vision'],
      numericDifferenceAtLeastTwoFields: ['semanticUsefulness'],
    });
    expect(() =>
      createProductGateHumanAdjudicationV2({ first, second, thirdReview: null }),
    ).toThrow(/if and only if/u);

    const result = createProductGateHumanAdjudicationV2({
      first,
      second,
      thirdReview,
    });

    expect(result.resolvedCategorical).toEqual({
      vision: 'inconclusive',
      segmentation: 'pass',
      background: 'pass',
      composite: 'pass',
    });
    expect(result.resolvedNumeric.semanticUsefulness).toBe(2);
    expect(result.resolvedNumeric.completeness).toBe(3);
    expect(result.thirdReviewTiming).toEqual({
      kind: 'completed-before-primary-score-reveal',
      primaryScoresRevealedBeforeCompletion: false,
    });
    expect(result.originalPrimaryReviewsPreservedUnchanged).toBe(true);
    expect(canonicalizeJson(result.primaryReviews[0])).toBe(firstBefore);
    expect(canonicalizeJson(result.primaryReviews[1])).toBe(secondBefore);
    expect(canonicalizeJson(first)).toBe(firstBefore);
    expect(canonicalizeJson(second)).toBe(secondBefore);
  });
});

describe('product-gate human review V2 third-review boundaries', () => {
  const triggeredPair = () => {
    const first = primary({ role: 'primary-one', reviewerId: firstReviewerId });
    const second = primary({
      role: 'primary-two',
      reviewerId: secondReviewerId,
      categorical: { ...categorical, composite: 'fail' },
    });
    return { first, second };
  };

  it('requires a distinct blind third reviewer who completed before score reveal', () => {
    const { first, second } = triggeredPair();
    const validThird = third();
    const result = createProductGateHumanAdjudicationV2({
      first,
      second,
      thirdReview: validThird,
    });

    expect(result.thirdReview).toMatchObject({
      reviewRole: 'third',
      independentReview: true,
      providerModelBlind: true,
      primaryScoresAccessed: false,
      completedBeforePrimaryScoresRevealed: true,
    });
    expect(() =>
      createProductGateHumanAdjudicationV2({
        first,
        second,
        thirdReview: third({ reviewerId: firstReviewerId }),
      }),
    ).toThrow(/distinct/u);
    for (const mutation of [
      { primaryScoresAccessed: true },
      { completedBeforePrimaryScoresRevealed: false },
      { providerModelBlind: false },
    ]) {
      expect(ProductGateThirdReviewV2Schema.safeParse({ ...validThird, ...mutation }).success).toBe(
        false,
      );
    }
  });

  it('requires the third reviewer to receive the exact identity-bound presentation', () => {
    const { first, second } = triggeredPair();
    const otherPresentation = createProductGateReviewPresentationV2({
      presentationVersion: 2,
      caseId,
      items: [presentationItem(1, 'composite-projection', 'alternate')],
      providerModelBlind: true,
      shareableSafety: PRODUCT_GATE_SHAREABLE_REVIEW_SAFETY_V2,
    });

    expect(() =>
      createProductGateHumanAdjudicationV2({
        first,
        second,
        thirdReview: third({ boundPresentation: otherPresentation }),
      }),
    ).toThrow(/exact primary presentation/u);
  });
});

describe('product-gate human review V2 maintainer eligibility', () => {
  it('allows an uninvolved blind maintainer primary and rejects selection, tuning, or oracle work', () => {
    expect(
      primary({
        role: 'primary-one',
        reviewerId: firstReviewerId,
        reviewerKind: 'maintainer',
      }).reviewerKind,
    ).toBe('maintainer');

    for (const conflict of [
      { selectedCase: true },
      { tunedAgainstCase: true },
      { createdCaseOracle: true },
    ]) {
      expect(() =>
        primary({
          role: 'primary-one',
          reviewerId: firstReviewerId,
          reviewerKind: 'maintainer',
          conflict: { ...noConflict, ...conflict },
        }),
      ).toThrow(/maintainer primary reviewer/u);
    }
  });

  it('prefers a non-maintainer third and records the exception for a maintainer third', () => {
    expect(third().nonMaintainerUnavailableRationale).toBeNull();
    expect(() => third({ reviewerKind: 'maintainer' })).toThrow(/unavailability rationale/u);
    expect(
      third({
        reviewerKind: 'maintainer',
        nonMaintainerUnavailableRationale: 'No eligible non-maintainer reviewer was available.',
      }),
    ).toMatchObject({
      reviewerKind: 'maintainer',
      nonMaintainerThirdPreferred: true,
      nonMaintainerUnavailableRationale: 'No eligible non-maintainer reviewer was available.',
    });
  });
});

describe('product-gate human review V2 shareable safety and canonical identity', () => {
  it('rejects private paths, raw provider material, unknown fields, bytes, and non-opaque cases', () => {
    expect(() =>
      primary({
        role: 'primary-one',
        reviewerId: firstReviewerId,
        rationale: 'Reviewed file at /Users/example/private.png.',
      }),
    ).toThrow();
    expect(() =>
      primary({
        role: 'primary-one',
        reviewerId: firstReviewerId,
        rationale: 'Raw provider response was copied here.',
      }),
    ).toThrow(/private or provider material/u);
    expect(() =>
      primary({
        role: 'primary-one',
        reviewerId: firstReviewerId,
        rationale: `Case ${admittedCase.caseId} passed.`,
      }),
    ).toThrow(/private or provider material/u);
    expect(() =>
      primary({
        role: 'primary-one',
        reviewerId: firstReviewerId,
        conflict: { ...noConflict, statement: 'Reviewed banner-person-v1 previously.' },
      }),
    ).toThrow(/private or provider material/u);
    expect(() =>
      primary({
        role: 'primary-one',
        reviewerId: firstReviewerId,
        rationale: 'Provider Alpha model Beta scored poorly.',
      }),
    ).toThrow(/private or provider material/u);
    expect(() =>
      primary({
        role: 'primary-one',
        reviewerId: firstReviewerId,
        rationale: 'Provider: Alpha scored poorly.',
      }),
    ).toThrow(/private or provider material/u);

    const valid = primary({ role: 'primary-one', reviewerId: firstReviewerId });
    expect(ProductGatePrimaryReviewV2Schema.safeParse({ ...valid, unknown: true }).success).toBe(
      false,
    );
    expect(
      ProductGatePrimaryReviewV2Schema.safeParse({
        ...valid,
        sourceBytes: new Uint8Array([1, 2, 3]),
      }).success,
    ).toBe(false);
    expect(
      ProductGatePrimaryReviewV2Schema.safeParse({
        ...valid,
        shareableSafety: { ...valid.shareableSafety, privatePathsIncluded: true },
      }).success,
    ).toBe(false);
    expect(
      ProductGatePrimaryReviewV2Schema.safeParse({
        ...valid,
        conflictDeclaration: { ...valid.conflictDeclaration, unknownConflictKey: true },
      }).success,
    ).toBe(false);
    expect(ProductGateThirdReviewV2Schema.safeParse({ ...third(), unknown: true }).success).toBe(
      false,
    );
    expect(ProductGateOpaqueCaseIdV2Schema.safeParse('banner-person-v1').success).toBe(false);
    expect(privateCaseBinding.opaqueCaseId).toBe(caseId);
    expect(() =>
      createProductGateOpaqueCaseBindingV2({ ...privateCaseBindingInput, unexpected: true }),
    ).toThrow();
    expect(() =>
      createProductGateOpaqueCaseBindingV2({
        ...privateCaseBindingInput,
        admittedCaseId: `pge_holdout_case_v2_${'f'.repeat(64)}`,
      }),
    ).toThrow(/exact corpus manifest/u);
    expect(() =>
      createProductGateReviewPresentationItemIdV2({
        caseId,
        ordinal: 1,
        kind: 'source-projection',
        evidenceProjectionSha256: projectionSha256('source'),
        unexpected: true,
      }),
    ).toThrow();

    const first = primary({ role: 'primary-one', reviewerId: firstReviewerId });
    const second = primary({ role: 'primary-two', reviewerId: secondReviewerId });
    expect(() =>
      determineProductGateThirdReviewRequirementV2({ first, second, unexpected: true }),
    ).toThrow();
    expect(() =>
      createProductGateHumanAdjudicationV2({
        first,
        second,
        thirdReview: null,
        unexpected: true,
      }),
    ).toThrow();
    expect(() =>
      determineProductGateThirdReviewRequirementV2({ first: second, second: first }),
    ).toThrow(/distinct roles and reviewers/u);
  });

  it('validates every shareable review against the exact private admitted-case binding', () => {
    const first = primary({ role: 'primary-one', reviewerId: firstReviewerId });
    expect(
      validateProductGatePrivateHumanReviewBindingV2({
        packageVersion: 2,
        caseBinding: privateCaseBinding,
        record: first,
        privateAdmissionBindingIncluded: true,
        shareable: false,
      }).record,
    ).toEqual(first);

    const otherBinding = createProductGateOpaqueCaseBindingV2({
      bindingVersion: 2,
      corpusManifest: PRODUCT_GATE_HOLDOUT_STRUCTURAL_FAKE_V2,
      admittedCaseId: PRODUCT_GATE_HOLDOUT_STRUCTURAL_FAKE_V2.cases[1]!.caseId,
    });
    expect(
      ProductGatePrivateBoundHumanReviewV2Schema.safeParse({
        packageVersion: 2,
        caseBinding: otherBinding,
        record: first,
        privateAdmissionBindingIncluded: true,
        shareable: false,
      }).success,
    ).toBe(false);
    expect(() =>
      validateProductGatePrivateHumanReviewBindingV2({
        packageVersion: 2,
        caseBinding: privateCaseBinding,
        record: first,
        privateAdmissionBindingIncluded: true,
        shareable: true,
      }),
    ).toThrow();
  });

  it('produces stable canonical presentation, review, trigger, and adjudication identities', () => {
    const firstA = primary({ role: 'primary-one', reviewerId: firstReviewerId });
    const firstB = primary({ role: 'primary-one', reviewerId: firstReviewerId });
    const second = primary({ role: 'primary-two', reviewerId: secondReviewerId });
    const firstResult = createProductGateHumanAdjudicationV2({
      first: firstA,
      second,
      thirdReview: null,
    });
    const secondResult = createProductGateHumanAdjudicationV2({
      first: firstB,
      second,
      thirdReview: null,
    });

    expect(firstA.reviewId).toBe(firstB.reviewId);
    expect(canonicalizeJson(firstA)).toBe(canonicalizeJson(firstB));
    expect(presentation.presentationId.endsWith(presentation.presentationSha256)).toBe(true);
    expect(firstResult.adjudicationId).toBe(secondResult.adjudicationId);
    expect(canonicalizeJson(firstResult)).toBe(canonicalizeJson(secondResult));
    expect(
      ProductGateHumanAdjudicationV2Schema.parse(
        JSON.parse(canonicalizeJson(firstResult)) as unknown,
      ),
    ).toEqual(firstResult);
    expect(
      ProductGateHumanAdjudicationV2Schema.safeParse({ ...firstResult, extra: 'rejected' }).success,
    ).toBe(false);
  });
});
