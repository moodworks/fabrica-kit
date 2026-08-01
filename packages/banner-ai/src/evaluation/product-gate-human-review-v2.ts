import { z } from 'zod';

import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  ProductGateCaseIdV2Schema,
  ProductGateHoldoutCorpusManifestV2Schema,
} from './product-gate-corpus-v2.js';

const contentIdSchema = (prefix: string) =>
  z.string().regex(new RegExp(`^${prefix}_[0-9a-f]{64}$`, 'u'));

const digestCanonical = (input: unknown): string =>
  sha256Hex(Buffer.from(canonicalizeJson(input), 'utf8'));

const createContentId = <T extends z.ZodType<string>>(
  prefix: string,
  schema: T,
  input: unknown,
): z.infer<T> => schema.parse(`${prefix}_${digestCanonical(input)}`);

export const ProductGateOpaqueCaseIdV2Schema =
  contentIdSchema('pge_case_v2').brand<'ProductGateOpaqueCaseIdV2'>();

export const ProductGateReviewerIdV2Schema =
  contentIdSchema('pge_reviewer_v2').brand<'ProductGateReviewerIdV2'>();

export const ProductGateReviewPresentationItemIdV2Schema =
  contentIdSchema('pge_review_item_v2').brand<'ProductGateReviewPresentationItemIdV2'>();

export const ProductGateReviewPresentationIdV2Schema = contentIdSchema(
  'pge_review_presentation_v2',
).brand<'ProductGateReviewPresentationIdV2'>();

export const ProductGatePrimaryReviewIdV2Schema =
  contentIdSchema('pge_primary_review_v2').brand<'ProductGatePrimaryReviewIdV2'>();

export const ProductGateThirdReviewIdV2Schema =
  contentIdSchema('pge_third_review_v2').brand<'ProductGateThirdReviewIdV2'>();

export const ProductGateHumanAdjudicationIdV2Schema = contentIdSchema(
  'pge_human_adjudication_v2',
).brand<'ProductGateHumanAdjudicationIdV2'>();

const ProductGateOpaqueCaseBindingCoreV2Schema = z.strictObject({
  bindingVersion: z.literal(2),
  corpusManifestSha256: Sha256HexSchema,
  corpusIdentitySha256: Sha256HexSchema,
  admittedCaseId: ProductGateCaseIdV2Schema,
  admissionBindingSha256: Sha256HexSchema,
});

export const ProductGateOpaqueCaseBindingV2Schema = z
  .strictObject({
    ...ProductGateOpaqueCaseBindingCoreV2Schema.shape,
    opaqueCaseId: ProductGateOpaqueCaseIdV2Schema,
  })
  .superRefine((binding, context) => {
    const { opaqueCaseId, ...core } = binding;
    if (opaqueCaseId !== createContentId('pge_case_v2', ProductGateOpaqueCaseIdV2Schema, core)) {
      context.addIssue({
        code: 'custom',
        message: 'Opaque review case identity must bind the admitted corpus case metadata.',
      });
    }
  })
  .readonly();

export type ProductGateOpaqueCaseBindingV2 = z.infer<typeof ProductGateOpaqueCaseBindingV2Schema>;

export const createProductGateOpaqueCaseBindingV2 = (
  input: unknown,
): ProductGateOpaqueCaseBindingV2 => {
  const parsed = z
    .strictObject({
      bindingVersion: z.literal(2),
      corpusManifest: ProductGateHoldoutCorpusManifestV2Schema,
      admittedCaseId: ProductGateCaseIdV2Schema,
    })
    .parse(input);
  const admittedCase = parsed.corpusManifest.cases.find(
    (entry) => entry.caseId === parsed.admittedCaseId,
  );
  if (admittedCase === undefined) {
    throw new TypeError('Opaque review binding requires a case in the exact corpus manifest.');
  }
  const core = ProductGateOpaqueCaseBindingCoreV2Schema.parse({
    bindingVersion: parsed.bindingVersion,
    corpusManifestSha256: parsed.corpusManifest.manifestSha256,
    corpusIdentitySha256: admittedCase.corpusIdentitySha256,
    admittedCaseId: admittedCase.caseId,
    admissionBindingSha256: admittedCase.admissionBinding.bindingSha256,
  });
  return ProductGateOpaqueCaseBindingV2Schema.parse({
    ...core,
    opaqueCaseId: createContentId('pge_case_v2', ProductGateOpaqueCaseIdV2Schema, core),
  });
};

export const createProductGateOpaqueCaseIdV2 = (input: unknown) =>
  createProductGateOpaqueCaseBindingV2(input).opaqueCaseId;

export const createProductGateReviewerIdV2 = (input: unknown) =>
  createContentId('pge_reviewer_v2', ProductGateReviewerIdV2Schema, input);

const forbiddenRationalePatterns = Object.freeze([
  /(?:^|[ (])\/(?:Users|home|private|tmp|var)\//iu,
  /[A-Za-z]:\\/u,
  /\b(?:file|https?):\/\//iu,
  /data:image\//iu,
  /\braw provider (?:body|request|response)\b/iu,
  /\b(?:authorization header|bearer token|api key|credential value|secret value)\b/iu,
  /\b(?:source bytes|private path|private visual material)\b/iu,
  /\b(?:provider|model)\b/iu,
  /\bpge_(?:holdout_case|proposal|oracle_layer)_v2_[0-9a-f]{64}\b/iu,
  /\bbanner-(?:person|product|text-heavy|no-text)-v1\b/iu,
]);

export const ProductGateSanitizedRationaleV2Schema = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9 .,;:!?()'_-]*$/u,
    'Shareable rationales must use the closed sanitized text alphabet.',
  )
  .refine(
    (value) => forbiddenRationalePatterns.every((pattern) => !pattern.test(value)),
    'Shareable rationale contains private or provider material.',
  );

export const ProductGateShareableReviewSafetyV2Schema = z
  .strictObject({
    opaqueCaseIdOnly: z.literal(true),
    sourceBytesIncluded: z.literal(false),
    privatePathsIncluded: z.literal(false),
    rawProviderBodiesIncluded: z.literal(false),
    privateVisualMaterialIncluded: z.literal(false),
    credentialValuesIncluded: z.literal(false),
    providerOrModelIdentityIncluded: z.literal(false),
  })
  .readonly();

export const PRODUCT_GATE_SHAREABLE_REVIEW_SAFETY_V2 =
  ProductGateShareableReviewSafetyV2Schema.parse({
    opaqueCaseIdOnly: true,
    sourceBytesIncluded: false,
    privatePathsIncluded: false,
    rawProviderBodiesIncluded: false,
    privateVisualMaterialIncluded: false,
    credentialValuesIncluded: false,
    providerOrModelIdentityIncluded: false,
  });

export const ProductGateReviewPresentationItemKindV2Schema = z.enum([
  'source-projection',
  'vision-projection',
  'segmentation-projection',
  'background-projection',
  'composite-projection',
  'export-projection',
]);

const ProductGateReviewPresentationItemIdentityInputV2Schema = z
  .strictObject({
    caseId: ProductGateOpaqueCaseIdV2Schema,
    ordinal: z.int().min(1).max(128),
    kind: ProductGateReviewPresentationItemKindV2Schema,
    evidenceProjectionSha256: Sha256HexSchema,
  })
  .readonly();

export const createProductGateReviewPresentationItemIdV2 = (input: unknown) => {
  const parsed = ProductGateReviewPresentationItemIdentityInputV2Schema.parse(input);
  return createContentId('pge_review_item_v2', ProductGateReviewPresentationItemIdV2Schema, parsed);
};

const ProductGateReviewPresentationItemV2Schema = z
  .strictObject({
    itemId: ProductGateReviewPresentationItemIdV2Schema,
    ordinal: z.int().min(1).max(128),
    kind: ProductGateReviewPresentationItemKindV2Schema,
    evidenceProjectionSha256: Sha256HexSchema,
  })
  .readonly();

const ProductGateReviewPresentationCoreV2Schema = z
  .strictObject({
    presentationVersion: z.literal(2),
    caseId: ProductGateOpaqueCaseIdV2Schema,
    items: z.array(ProductGateReviewPresentationItemV2Schema).min(1).max(128).readonly(),
    providerModelBlind: z.literal(true),
    shareableSafety: ProductGateShareableReviewSafetyV2Schema,
  })
  .superRefine((presentation, context) => {
    if (
      new Set(presentation.items.map((item) => item.itemId)).size !== presentation.items.length ||
      presentation.items.some((item, index) => item.ordinal !== index + 1)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Presentation items must have unique identities and exact contiguous order.',
        path: ['items'],
      });
    }
    const invalidIdentityIndex = presentation.items.findIndex(
      (item) =>
        item.itemId !==
        createProductGateReviewPresentationItemIdV2({
          caseId: presentation.caseId,
          ordinal: item.ordinal,
          kind: item.kind,
          evidenceProjectionSha256: item.evidenceProjectionSha256,
        }),
    );
    if (invalidIdentityIndex !== -1) {
      context.addIssue({
        code: 'custom',
        message: 'Presentation item identity must bind its case, order, kind, and projection.',
        path: ['items', invalidIdentityIndex, 'itemId'],
      });
    }
  });

export const digestProductGateReviewPresentationV2 = (input: unknown): string =>
  digestCanonical(ProductGateReviewPresentationCoreV2Schema.parse(input));

export const ProductGateReviewPresentationV2Schema = z
  .strictObject({
    presentationId: ProductGateReviewPresentationIdV2Schema,
    presentationSha256: Sha256HexSchema,
    ...ProductGateReviewPresentationCoreV2Schema.shape,
  })
  .superRefine((presentation, context) => {
    const { presentationId, presentationSha256, ...coreInput } = presentation;
    const core = ProductGateReviewPresentationCoreV2Schema.safeParse(coreInput);
    if (!core.success) {
      for (const issue of core.error.issues) {
        context.addIssue({ ...issue, path: [...issue.path] });
      }
      return;
    }
    const expectedDigest = digestProductGateReviewPresentationV2(core.data);
    const expectedId = ProductGateReviewPresentationIdV2Schema.parse(
      `pge_review_presentation_v2_${expectedDigest}`,
    );
    if (presentationSha256 !== expectedDigest || presentationId !== expectedId) {
      context.addIssue({
        code: 'custom',
        message: 'Review presentation content identity drifted.',
      });
    }
  })
  .readonly();

export type ProductGateReviewPresentationV2 = z.infer<typeof ProductGateReviewPresentationV2Schema>;

export const createProductGateReviewPresentationV2 = (
  input: z.input<typeof ProductGateReviewPresentationCoreV2Schema>,
): ProductGateReviewPresentationV2 => {
  const core = ProductGateReviewPresentationCoreV2Schema.parse(input);
  const presentationSha256 = digestProductGateReviewPresentationV2(core);
  return ProductGateReviewPresentationV2Schema.parse({
    presentationId: `pge_review_presentation_v2_${presentationSha256}`,
    presentationSha256,
    ...core,
  });
};

export const ProductGateReviewConflictDeclarationV2Schema = z
  .strictObject({
    declarationVersion: z.literal(2),
    declarationComplete: z.literal(true),
    selectedCase: z.boolean(),
    tunedAgainstCase: z.boolean(),
    createdCaseOracle: z.boolean(),
    otherConflictDeclared: z.boolean(),
    statement: ProductGateSanitizedRationaleV2Schema,
  })
  .readonly();

export type ProductGateReviewConflictDeclarationV2 = z.infer<
  typeof ProductGateReviewConflictDeclarationV2Schema
>;

export const ProductGateReviewClassificationV2Schema = z.enum(['pass', 'fail', 'inconclusive']);

const ScoreZeroToFourSchema = z.int().min(0).max(4);

export const PRODUCT_GATE_CATEGORICAL_REVIEW_FIELDS_V2 = Object.freeze([
  'vision',
  'segmentation',
  'background',
  'composite',
] as const);

export const PRODUCT_GATE_NUMERIC_REVIEW_FIELDS_V2 = Object.freeze([
  'visionUsefulness',
  'semanticUsefulness',
  'completeness',
  'edgeMatteQuality',
  'backgroundCleanliness',
  'granularityIntegrity',
  'repairReadiness',
  'backgroundUsability',
  'compositeUsefulness',
] as const);

export const ProductGateCategoricalReviewScoresV2Schema = z
  .strictObject({
    vision: ProductGateReviewClassificationV2Schema,
    segmentation: ProductGateReviewClassificationV2Schema,
    background: ProductGateReviewClassificationV2Schema,
    composite: ProductGateReviewClassificationV2Schema,
  })
  .readonly();

export const ProductGateNumericReviewScoresV2Schema = z
  .strictObject({
    visionUsefulness: ScoreZeroToFourSchema,
    semanticUsefulness: ScoreZeroToFourSchema,
    completeness: ScoreZeroToFourSchema,
    edgeMatteQuality: ScoreZeroToFourSchema,
    backgroundCleanliness: ScoreZeroToFourSchema,
    granularityIntegrity: ScoreZeroToFourSchema,
    repairReadiness: ScoreZeroToFourSchema,
    backgroundUsability: ScoreZeroToFourSchema,
    compositeUsefulness: ScoreZeroToFourSchema,
  })
  .readonly();

export type ProductGateCategoricalReviewScoresV2 = z.infer<
  typeof ProductGateCategoricalReviewScoresV2Schema
>;
export type ProductGateNumericReviewScoresV2 = z.infer<
  typeof ProductGateNumericReviewScoresV2Schema
>;

type CategoricalReviewScoresV2 = ProductGateCategoricalReviewScoresV2;
type NumericReviewScoresV2 = ProductGateNumericReviewScoresV2;

const ProductGatePrimaryReviewCoreV2Schema = z
  .strictObject({
    reviewVersion: z.literal(2),
    caseId: ProductGateOpaqueCaseIdV2Schema,
    reviewRole: z.enum(['primary-one', 'primary-two']),
    reviewerId: ProductGateReviewerIdV2Schema,
    reviewerKind: z.enum(['maintainer', 'non-maintainer']),
    independentReview: z.literal(true),
    providerModelBlind: z.literal(true),
    otherPrimaryScoresAccessed: z.literal(false),
    presentation: ProductGateReviewPresentationV2Schema,
    conflictDeclaration: ProductGateReviewConflictDeclarationV2Schema,
    categorical: ProductGateCategoricalReviewScoresV2Schema,
    numeric: ProductGateNumericReviewScoresV2Schema,
    rationale: ProductGateSanitizedRationaleV2Schema,
    shareableSafety: ProductGateShareableReviewSafetyV2Schema,
  })
  .superRefine((review, context) => {
    if (review.caseId !== review.presentation.caseId) {
      context.addIssue({
        code: 'custom',
        message: 'Primary review must bind the exact opaque presentation case.',
      });
    }
    if (
      review.reviewerKind === 'maintainer' &&
      (review.conflictDeclaration.selectedCase ||
        review.conflictDeclaration.tunedAgainstCase ||
        review.conflictDeclaration.createdCaseOracle)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'A maintainer primary reviewer cannot select, tune against, or create the case oracle.',
      });
    }
  });

export const ProductGatePrimaryReviewV2Schema = z
  .strictObject({
    reviewId: ProductGatePrimaryReviewIdV2Schema,
    ...ProductGatePrimaryReviewCoreV2Schema.shape,
  })
  .superRefine((review, context) => {
    const { reviewId, ...coreInput } = review;
    const core = ProductGatePrimaryReviewCoreV2Schema.safeParse(coreInput);
    if (
      !core.success ||
      reviewId !==
        createContentId('pge_primary_review_v2', ProductGatePrimaryReviewIdV2Schema, core.data)
    ) {
      context.addIssue({ code: 'custom', message: 'Primary review immutable identity drifted.' });
    }
  })
  .readonly();

export type ProductGatePrimaryReviewV2 = z.infer<typeof ProductGatePrimaryReviewV2Schema>;

export const createProductGatePrimaryReviewV2 = (
  input: z.input<typeof ProductGatePrimaryReviewCoreV2Schema>,
): ProductGatePrimaryReviewV2 => {
  const core = ProductGatePrimaryReviewCoreV2Schema.parse(input);
  return ProductGatePrimaryReviewV2Schema.parse({
    reviewId: createContentId('pge_primary_review_v2', ProductGatePrimaryReviewIdV2Schema, core),
    ...core,
  });
};

const ProductGateThirdReviewCoreV2Schema = z
  .strictObject({
    reviewVersion: z.literal(2),
    caseId: ProductGateOpaqueCaseIdV2Schema,
    reviewRole: z.literal('third'),
    reviewerId: ProductGateReviewerIdV2Schema,
    reviewerKind: z.enum(['maintainer', 'non-maintainer']),
    independentReview: z.literal(true),
    providerModelBlind: z.literal(true),
    primaryScoresAccessed: z.literal(false),
    completedBeforePrimaryScoresRevealed: z.literal(true),
    nonMaintainerThirdPreferred: z.literal(true),
    nonMaintainerUnavailableRationale: ProductGateSanitizedRationaleV2Schema.nullable(),
    presentation: ProductGateReviewPresentationV2Schema,
    conflictDeclaration: ProductGateReviewConflictDeclarationV2Schema,
    categorical: ProductGateCategoricalReviewScoresV2Schema,
    numeric: ProductGateNumericReviewScoresV2Schema,
    rationale: ProductGateSanitizedRationaleV2Schema,
    shareableSafety: ProductGateShareableReviewSafetyV2Schema,
  })
  .superRefine((review, context) => {
    if (review.caseId !== review.presentation.caseId) {
      context.addIssue({
        code: 'custom',
        message: 'Third review must bind the exact opaque presentation case.',
      });
    }
    if (
      (review.reviewerKind === 'maintainer') !==
      (review.nonMaintainerUnavailableRationale !== null)
    ) {
      context.addIssue({
        code: 'custom',
        message:
          'A maintainer third reviewer requires a sanitized non-maintainer-unavailability rationale.',
      });
    }
  });

export const ProductGateThirdReviewV2Schema = z
  .strictObject({
    reviewId: ProductGateThirdReviewIdV2Schema,
    ...ProductGateThirdReviewCoreV2Schema.shape,
  })
  .superRefine((review, context) => {
    const { reviewId, ...coreInput } = review;
    const core = ProductGateThirdReviewCoreV2Schema.safeParse(coreInput);
    if (
      !core.success ||
      reviewId !==
        createContentId('pge_third_review_v2', ProductGateThirdReviewIdV2Schema, core.data)
    ) {
      context.addIssue({ code: 'custom', message: 'Third review immutable identity drifted.' });
    }
  })
  .readonly();

export type ProductGateThirdReviewV2 = z.infer<typeof ProductGateThirdReviewV2Schema>;

export const createProductGateThirdReviewV2 = (
  input: z.input<typeof ProductGateThirdReviewCoreV2Schema>,
): ProductGateThirdReviewV2 => {
  const core = ProductGateThirdReviewCoreV2Schema.parse(input);
  return ProductGateThirdReviewV2Schema.parse({
    reviewId: createContentId('pge_third_review_v2', ProductGateThirdReviewIdV2Schema, core),
    ...core,
  });
};

const categoricalFieldSchema = z.enum(PRODUCT_GATE_CATEGORICAL_REVIEW_FIELDS_V2);
const numericFieldSchema = z.enum(PRODUCT_GATE_NUMERIC_REVIEW_FIELDS_V2);

const ProductGateThirdReviewRequirementCoreV2Schema = z.strictObject({
  requirementVersion: z.literal(2),
  thirdReviewRequired: z.boolean(),
  categoricalDisagreementFields: z.array(categoricalFieldSchema).max(4).readonly(),
  numericDifferenceAtLeastTwoFields: z.array(numericFieldSchema).max(9).readonly(),
});

export const ProductGateThirdReviewRequirementV2Schema = z
  .strictObject({
    ...ProductGateThirdReviewRequirementCoreV2Schema.shape,
    requirementSha256: Sha256HexSchema,
  })
  .superRefine((requirement, context) => {
    const { requirementSha256, ...core } = requirement;
    const categorical = [...requirement.categoricalDisagreementFields].toSorted();
    const numeric = [...requirement.numericDifferenceAtLeastTwoFields].toSorted();
    const expectedRequired = categorical.length + numeric.length > 0;
    if (
      canonicalizeJson(categorical) !==
        canonicalizeJson(requirement.categoricalDisagreementFields) ||
      canonicalizeJson(numeric) !==
        canonicalizeJson(requirement.numericDifferenceAtLeastTwoFields) ||
      new Set(categorical).size !== categorical.length ||
      new Set(numeric).size !== numeric.length ||
      requirement.thirdReviewRequired !== expectedRequired ||
      requirementSha256 !== digestCanonical(core)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Third-review trigger fields or identity drifted.',
      });
    }
  })
  .readonly();

export type ProductGateThirdReviewRequirementV2 = z.infer<
  typeof ProductGateThirdReviewRequirementV2Schema
>;

const parseIndependentPrimaryPair = (
  input: unknown,
): readonly [ProductGatePrimaryReviewV2, ProductGatePrimaryReviewV2] => {
  const parsed = z
    .strictObject({
      first: ProductGatePrimaryReviewV2Schema,
      second: ProductGatePrimaryReviewV2Schema,
    })
    .parse(input);
  const { first, second } = parsed;
  if (
    first.caseId !== second.caseId ||
    first.reviewerId === second.reviewerId ||
    first.reviewRole !== 'primary-one' ||
    second.reviewRole !== 'primary-two' ||
    canonicalizeJson(first.presentation) !== canonicalizeJson(second.presentation)
  ) {
    throw new TypeError(
      'Primary pair requires one case, distinct roles and reviewers, and one exact presentation.',
    );
  }
  return [first, second] as const;
};

export const determineProductGateThirdReviewRequirementV2 = (
  input: unknown,
): ProductGateThirdReviewRequirementV2 => {
  const [first, second] = parseIndependentPrimaryPair(input);
  const categoricalDisagreementFields = PRODUCT_GATE_CATEGORICAL_REVIEW_FIELDS_V2.filter(
    (field) => first.categorical[field] !== second.categorical[field],
  ).toSorted();
  const numericDifferenceAtLeastTwoFields = PRODUCT_GATE_NUMERIC_REVIEW_FIELDS_V2.filter(
    (field) => Math.abs(first.numeric[field] - second.numeric[field]) >= 2,
  ).toSorted();
  const core = ProductGateThirdReviewRequirementCoreV2Schema.parse({
    requirementVersion: 2,
    thirdReviewRequired:
      categoricalDisagreementFields.length + numericDifferenceAtLeastTwoFields.length > 0,
    categoricalDisagreementFields,
    numericDifferenceAtLeastTwoFields,
  });
  return ProductGateThirdReviewRequirementV2Schema.parse({
    ...core,
    requirementSha256: digestCanonical(core),
  });
};

const medianOfThree = (first: number, second: number, third: number): number =>
  [first, second, third].toSorted((left, right) => left - right)[1]!;

const resolveCategorical = (
  first: CategoricalReviewScoresV2,
  second: CategoricalReviewScoresV2,
  third: CategoricalReviewScoresV2 | null,
): CategoricalReviewScoresV2 =>
  ProductGateCategoricalReviewScoresV2Schema.parse(
    Object.fromEntries(
      PRODUCT_GATE_CATEGORICAL_REVIEW_FIELDS_V2.map((field) => [
        field,
        first[field] === second[field] ? first[field] : third?.[field],
      ]),
    ),
  );

const resolveNumeric = (
  first: NumericReviewScoresV2,
  second: NumericReviewScoresV2,
  third: NumericReviewScoresV2 | null,
): NumericReviewScoresV2 =>
  ProductGateNumericReviewScoresV2Schema.parse(
    Object.fromEntries(
      PRODUCT_GATE_NUMERIC_REVIEW_FIELDS_V2.map((field) => {
        const firstScore = first[field];
        const secondScore = second[field];
        const difference = Math.abs(firstScore - secondScore);
        return [
          field,
          difference === 0
            ? firstScore
            : difference === 1
              ? Math.min(firstScore, secondScore)
              : medianOfThree(firstScore, secondScore, third?.[field] ?? Number.NaN),
        ];
      }),
    ),
  );

export const ProductGateThirdReviewTimingV2Schema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('not-required'),
    })
    .readonly(),
  z
    .strictObject({
      kind: z.literal('completed-before-primary-score-reveal'),
      primaryScoresRevealedBeforeCompletion: z.literal(false),
    })
    .readonly(),
]);

const ProductGateHumanAdjudicationCoreV2Schema = z
  .strictObject({
    adjudicationVersion: z.literal(2),
    caseId: ProductGateOpaqueCaseIdV2Schema,
    primaryReviews: z
      .tuple([ProductGatePrimaryReviewV2Schema, ProductGatePrimaryReviewV2Schema])
      .readonly(),
    primaryScoresMutuallyHiddenUntilBothCompleted: z.literal(true),
    requirement: ProductGateThirdReviewRequirementV2Schema,
    thirdReview: ProductGateThirdReviewV2Schema.nullable(),
    thirdReviewTiming: ProductGateThirdReviewTimingV2Schema,
    resolvedCategorical: ProductGateCategoricalReviewScoresV2Schema,
    resolvedNumeric: ProductGateNumericReviewScoresV2Schema,
    originalPrimaryReviewsPreservedUnchanged: z.literal(true),
    shareableSafety: ProductGateShareableReviewSafetyV2Schema,
  })
  .superRefine((adjudication, context) => {
    let pair: readonly [ProductGatePrimaryReviewV2, ProductGatePrimaryReviewV2];
    try {
      pair = parseIndependentPrimaryPair({
        first: adjudication.primaryReviews[0],
        second: adjudication.primaryReviews[1],
      });
    } catch {
      context.addIssue({ code: 'custom', message: 'Adjudication primary pair is invalid.' });
      return;
    }
    const [first, second] = pair;
    const expectedRequirement = determineProductGateThirdReviewRequirementV2({ first, second });
    const requiresThird = expectedRequirement.thirdReviewRequired;
    if (
      adjudication.caseId !== first.caseId ||
      canonicalizeJson(adjudication.requirement) !== canonicalizeJson(expectedRequirement) ||
      requiresThird !== (adjudication.thirdReview !== null) ||
      (requiresThird
        ? adjudication.thirdReviewTiming.kind !== 'completed-before-primary-score-reveal'
        : adjudication.thirdReviewTiming.kind !== 'not-required')
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Third review must be present if and only if the exact trigger requires it.',
      });
      return;
    }
    const third = adjudication.thirdReview;
    if (
      third !== null &&
      (third.caseId !== first.caseId ||
        [first.reviewerId, second.reviewerId].includes(third.reviewerId) ||
        canonicalizeJson(third.presentation) !== canonicalizeJson(first.presentation))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Third reviewer must be distinct and receive the exact primary presentation.',
      });
      return;
    }
    let expectedCategorical: CategoricalReviewScoresV2;
    let expectedNumeric: NumericReviewScoresV2;
    try {
      expectedCategorical = resolveCategorical(
        first.categorical,
        second.categorical,
        third?.categorical ?? null,
      );
      expectedNumeric = resolveNumeric(first.numeric, second.numeric, third?.numeric ?? null);
    } catch {
      context.addIssue({ code: 'custom', message: 'Adjudication resolution is incomplete.' });
      return;
    }
    if (
      canonicalizeJson(adjudication.resolvedCategorical) !==
        canonicalizeJson(expectedCategorical) ||
      canonicalizeJson(adjudication.resolvedNumeric) !== canonicalizeJson(expectedNumeric)
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Adjudication resolution contradicts the deterministic frozen rules.',
      });
    }
  });

export const ProductGateHumanAdjudicationV2Schema = z
  .strictObject({
    adjudicationId: ProductGateHumanAdjudicationIdV2Schema,
    ...ProductGateHumanAdjudicationCoreV2Schema.shape,
  })
  .superRefine((adjudication, context) => {
    const { adjudicationId, ...coreInput } = adjudication;
    const core = ProductGateHumanAdjudicationCoreV2Schema.safeParse(coreInput);
    if (
      !core.success ||
      adjudicationId !==
        createContentId(
          'pge_human_adjudication_v2',
          ProductGateHumanAdjudicationIdV2Schema,
          core.data,
        )
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Human adjudication immutable identity drifted.',
      });
    }
  })
  .readonly();

export type ProductGateHumanAdjudicationV2 = z.infer<typeof ProductGateHumanAdjudicationV2Schema>;

export const createProductGateHumanAdjudicationV2 = (
  input: unknown,
): ProductGateHumanAdjudicationV2 => {
  const parsedInput = z
    .strictObject({
      first: ProductGatePrimaryReviewV2Schema,
      second: ProductGatePrimaryReviewV2Schema,
      thirdReview: ProductGateThirdReviewV2Schema.nullable(),
    })
    .parse(input);
  const [first, second] = parseIndependentPrimaryPair({
    first: parsedInput.first,
    second: parsedInput.second,
  });
  const requirement = determineProductGateThirdReviewRequirementV2({ first, second });
  const thirdReview = parsedInput.thirdReview;
  if (requirement.thirdReviewRequired !== (thirdReview !== null)) {
    throw new TypeError('Third review must be supplied if and only if a trigger exists.');
  }
  const resolvedCategorical = resolveCategorical(
    first.categorical,
    second.categorical,
    thirdReview?.categorical ?? null,
  );
  const resolvedNumeric = resolveNumeric(
    first.numeric,
    second.numeric,
    thirdReview?.numeric ?? null,
  );
  const core = ProductGateHumanAdjudicationCoreV2Schema.parse({
    adjudicationVersion: 2,
    caseId: first.caseId,
    primaryReviews: [first, second],
    primaryScoresMutuallyHiddenUntilBothCompleted: true,
    requirement,
    thirdReview,
    thirdReviewTiming:
      thirdReview === null
        ? { kind: 'not-required' }
        : {
            kind: 'completed-before-primary-score-reveal',
            primaryScoresRevealedBeforeCompletion: false,
          },
    resolvedCategorical,
    resolvedNumeric,
    originalPrimaryReviewsPreservedUnchanged: true,
    shareableSafety: PRODUCT_GATE_SHAREABLE_REVIEW_SAFETY_V2,
  });
  return ProductGateHumanAdjudicationV2Schema.parse({
    adjudicationId: createContentId(
      'pge_human_adjudication_v2',
      ProductGateHumanAdjudicationIdV2Schema,
      core,
    ),
    ...core,
  });
};

const ProductGatePrivateBoundHumanReviewRecordV2Schema = z.union([
  ProductGatePrimaryReviewV2Schema,
  ProductGateThirdReviewV2Schema,
  ProductGateHumanAdjudicationV2Schema,
]);

/**
 * Private validation package only. The admitted case identity remains outside every shareable
 * review, presentation, and adjudication record.
 */
export const ProductGatePrivateBoundHumanReviewV2Schema = z
  .strictObject({
    packageVersion: z.literal(2),
    caseBinding: ProductGateOpaqueCaseBindingV2Schema,
    record: ProductGatePrivateBoundHumanReviewRecordV2Schema,
    privateAdmissionBindingIncluded: z.literal(true),
    shareable: z.literal(false),
  })
  .superRefine((bound, context) => {
    if (bound.record.caseId !== bound.caseBinding.opaqueCaseId) {
      context.addIssue({
        code: 'custom',
        message: 'Private human-review validation must bind the exact admitted corpus case.',
      });
    }
  })
  .readonly();

export type ProductGatePrivateBoundHumanReviewV2 = z.infer<
  typeof ProductGatePrivateBoundHumanReviewV2Schema
>;

export const validateProductGatePrivateHumanReviewBindingV2 = (
  input: unknown,
): ProductGatePrivateBoundHumanReviewV2 => ProductGatePrivateBoundHumanReviewV2Schema.parse(input);
