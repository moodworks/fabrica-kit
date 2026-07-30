import { lstat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { GENTLE_FLOAT_PRESET_V1 } from '../editor/provider-free-banner-scene-v1.js';
import {
  PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_REF_V1,
  PROVIDER_FREE_EXPORTER_REF_V1,
  PROVIDER_FREE_EXPORT_VALIDATION_LABEL_V1,
  PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_REF_V1,
} from '../export/provider-free-export-identities-v1.js';
import {
  createBannerSceneV1ExportDocumentParts,
  createBannerSceneV1PreviewDocument,
  createBannerSceneV1RenderPlan,
  type BannerSceneV1RenderPlan,
} from '../render/banner-scene-v1-renderer.js';
import {
  BannerSceneV1Schema,
  Sha256HexSchema,
  type BannerSceneV1,
} from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  PRODUCT_GATE_BLOCKED_HOLDOUT_V1,
  PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
  ProductGateBlockedHoldoutManifestV1Schema,
  ProductGateCorpusCaseIdV1Schema,
  ProductGatePrimaryStratumV1Schema,
  rejectBlockedProductGateHoldoutExecutionV1,
} from '../evaluation/product-gate-corpus-v1.js';
import {
  ProductGateBackgroundInvocationV1Schema,
  createProductGateBackgroundResultV1,
  validateProductGateBackgroundInvocationForCurrentCorpusV1,
  validateProductGateBackgroundInvocationResultForCurrentCorpusV1,
  type ProductGateBackgroundResultV1,
} from '../evaluation/product-gate-background-v1.js';
import { evaluateProductGateEndToEndMetricV1 } from '../evaluation/product-gate-metrics-v1.js';
import {
  PRODUCT_GATE_SEGMENTATION_SCORE_ANCHORS_V1,
  ProductGateBackgroundScorecardV1Schema,
  ProductGateCompositeUsefulnessScorecardV1Schema,
  ProductGateCorrectionBudgetV1Schema,
  ProductGateEndToEndScorecardV1Schema,
  ProductGateSegmentationScorecardV1Schema,
  ProductGateVisionScorecardV1Schema,
  createProductGateAdjudicationV1,
  createProductGateRawReviewV1,
  determineProductGateAdjudicationRequirementV1,
  deterministicProductGatePresentationOrderV1,
} from '../evaluation/product-gate-scorecards-v1.js';
import {
  ProductGateCompositionProposalV1Schema,
  ProductGateCutoutStageResultV1Schema,
  ProductGateSegmentationInvocationV1Schema,
  ProductGateMaskV1Schema,
  ProductGateMaterializedCutoutV1Schema,
  ProductGateSegmentationCandidateV1Schema,
  ProductGateSegmentationResultV1Schema,
  ProductGateSegmentationPreparationResultV1Schema,
  createProductGateCompositionProposalV1,
  createProductGateCutoutIdV1,
  createProductGateMaskIdV1,
  createProductGateSegmentationCandidateIdV1,
  createProductGateSegmentationInvocationIdV1,
  validateProductGateSegmentationInvocationResultV1,
  validateProductGateMaterializedCutoutV1,
  type ProductGateCompositionProposalV1,
} from '../evaluation/product-gate-segmentation-v1.js';
import {
  PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1,
  PRODUCT_GATE_FAKE_RUNNER_STAGES_V1,
  PRODUCT_GATE_PROTECTED_IDENTITIES_V1,
  ProductGateAttemptRecordV1Schema,
  ProductGateDeterministicFakeCaseResultV1Schema,
  ProductGateDeterministicFakeReportV1Schema,
  ProductGateEvaluationStageV1Schema,
  ProductGateFinalManifestV1Schema,
  ProductGateRunRecordV1Schema,
  canonicalProductGateJsonBytesV1,
  cleanupPartialProductGateRunV1,
  createProductGateAttemptCostV1,
  createProductGateAttemptIdV1,
  createProductGateAttemptRecordV1,
  createProductGateLogicalOperationIdV1,
  createProductGateRunDirectoryV1,
  createProductGateRunIdV1,
  createProductGateSafeFailureV1,
  publishProductGateFinalManifestV1,
  writeProductGateEvidenceFileV1,
  type ProductGateArtifactInventoryEntryV1,
  type ProductGateAttemptRecordV1,
  type ProductGateDeterministicFakeReportV1,
} from '../evaluation/product-gate-run-manifest-v1.js';
import type {
  VerifiedProductGateDevelopmentCorpusEntryV1,
  VerifiedProductGateDevelopmentCorpusV1,
} from './product-gate-development-corpus-loader-v1.js';

export const PRODUCT_GATE_RUNTIME_RELATIVE_ROOT_V1 =
  '.local-data/banner-ai/product-gate-evaluation/v1' as const;

const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url));

const resolveProductGateOutputRootV1 = async (
  input:
    | { readonly kind: 'bounded-test-root'; readonly absolutePath: string }
    | { readonly kind: 'ignored-runtime-root' },
): Promise<string> => {
  if (input.kind === 'ignored-runtime-root') {
    const root = resolve(repositoryRoot, PRODUCT_GATE_RUNTIME_RELATIVE_ROOT_V1);
    let cursor = resolve(repositoryRoot);
    for (const component of PRODUCT_GATE_RUNTIME_RELATIVE_ROOT_V1.split('/')) {
      cursor = resolve(cursor, component);
      try {
        const metadata = await lstat(cursor);
        if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
          throw new TypeError('Ignored runtime root chain contains a symlink or special entry.');
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
        throw error;
      }
    }
    return root;
  }
  if (!isAbsolute(input.absolutePath)) {
    throw new TypeError('Bounded test output root must be absolute.');
  }
  const root = resolve(input.absolutePath);
  const metadata = await lstat(root);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || (metadata.mode & 0o777) !== 0o700) {
    throw new TypeError('Bounded test output root must be an existing private 0700 directory.');
  }
  const [realRoot, realTemporaryRoot] = await Promise.all([realpath(root), realpath(tmpdir())]);
  const child = relative(realTemporaryRoot, realRoot);
  if (
    child === '' ||
    child === '..' ||
    child.startsWith(`..${sep}`) ||
    child.includes(sep) ||
    basename(realRoot) !== child ||
    !child.startsWith('fabrica-product-gate-')
  ) {
    throw new TypeError('Bounded test output root is outside the closed temporary-root contract.');
  }
  return root;
};

export {
  PRODUCT_GATE_FAKE_RUNNER_STAGES_V1,
  ProductGateDeterministicFakeReportV1Schema,
} from '../evaluation/product-gate-run-manifest-v1.js';
export type { ProductGateDeterministicFakeReportV1 } from '../evaluation/product-gate-run-manifest-v1.js';

const FailureInjectionV1Schema = z
  .strictObject({
    caseId: ProductGateCorpusCaseIdV1Schema,
    stage: ProductGateEvaluationStageV1Schema,
    disposition: z.enum(['recover', 'abort-and-clean-partial']),
  })
  .readonly();

const VerifiedSourceIdentityWithBytesV1Schema = z
  .strictObject({
    packageRelativePath: z.string().min(1).max(512),
    mediaType: z.enum(['image/jpeg', 'image/png']),
    byteSize: z.int().min(1).max(5_242_880),
    pixelWidth: z.int().min(1).max(4_096),
    pixelHeight: z.int().min(1).max(4_096),
    sha256: Sha256HexSchema,
    bytes: z.instanceof(Uint8Array),
  })
  .readonly();

const VerifiedNormalizedSourceIdentityWithBytesV1Schema = z
  .strictObject({
    packageRelativePath: z.string().min(1).max(512),
    mediaType: z.literal('image/png'),
    byteSize: z.int().min(1).max(5_242_880),
    pixelWidth: z.int().min(1).max(4_096),
    pixelHeight: z.int().min(1).max(4_096),
    sha256: Sha256HexSchema,
    bytes: z.instanceof(Uint8Array),
  })
  .readonly();

const VerifiedOracleIdentityV1Schema = z
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
  .readonly();

const VerifiedDevelopmentCorpusEntryV1Schema = z
  .strictObject({
    caseId: ProductGateCorpusCaseIdV1Schema,
    primaryStratum: ProductGatePrimaryStratumV1Schema,
    original: VerifiedSourceIdentityWithBytesV1Schema,
    normalized: VerifiedNormalizedSourceIdentityWithBytesV1Schema,
    oracle: VerifiedOracleIdentityV1Schema,
  })
  .readonly();

const VerifiedDevelopmentCorpusV1Schema = z
  .strictObject({
    verificationVersion: z.literal(1),
    manifestSha256: z.literal(PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.manifestSha256),
    split: z.literal('development'),
    entries: z
      .tuple([
        VerifiedDevelopmentCorpusEntryV1Schema,
        VerifiedDevelopmentCorpusEntryV1Schema,
        VerifiedDevelopmentCorpusEntryV1Schema,
        VerifiedDevelopmentCorpusEntryV1Schema,
      ])
      .readonly(),
    fixtureCount: z.literal(4),
    holdoutAdmitted: z.literal(false),
    productGateDenominatorAvailable: z.literal(false),
    providerTransmissionAuthority: z.literal(false),
    realEvaluationAuthority: z.literal(false),
    productGateEvidence: z.literal(false),
  })
  .readonly();

const FakeRunnerInputV1Schema = z
  .strictObject({
    verifiedCorpus: VerifiedDevelopmentCorpusV1Schema,
    outputRoot: z.discriminatedUnion('kind', [
      z
        .strictObject({
          kind: z.literal('bounded-test-root'),
          absolutePath: z.string().min(1).max(4_096),
        })
        .readonly(),
      z.strictObject({ kind: z.literal('ignored-runtime-root') }).readonly(),
    ]),
    deterministicSeed: Sha256HexSchema,
    failureInjection: FailureInjectionV1Schema.nullable(),
  })
  .readonly();

type Candidate = z.infer<typeof ProductGateSegmentationCandidateV1Schema>;
type Mask = z.infer<typeof ProductGateMaskV1Schema>;
type Cutout = z.infer<typeof ProductGateMaterializedCutoutV1Schema>;
type SegmentationInvocation = z.infer<typeof ProductGateSegmentationInvocationV1Schema>;
type BackgroundInvocation = z.infer<typeof ProductGateBackgroundInvocationV1Schema>;

interface CaseState {
  proposal: ProductGateCompositionProposalV1 | null;
  segmentationInvocation: SegmentationInvocation | null;
  candidates: Candidate[];
  masks: Mask[];
  cutouts: Cutout[];
  segmentationResult: z.infer<typeof ProductGateSegmentationResultV1Schema> | null;
  backgroundResult: ProductGateBackgroundResultV1 | null;
  backgroundInvocation: BackgroundInvocation | null;
  scene: BannerSceneV1 | null;
  renderPlan: BannerSceneV1RenderPlan | null;
}

const assertVerifiedCorpus = (corpus: VerifiedProductGateDevelopmentCorpusV1): void => {
  if (
    corpus.verificationVersion !== 1 ||
    corpus.manifestSha256 !== PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.manifestSha256 ||
    corpus.split !== 'development' ||
    corpus.fixtureCount !== 4 ||
    corpus.entries.length !== 4 ||
    corpus.holdoutAdmitted ||
    corpus.productGateDenominatorAvailable ||
    corpus.providerTransmissionAuthority ||
    corpus.realEvaluationAuthority ||
    corpus.productGateEvidence
  ) {
    throw new TypeError('Fake runner accepts only the exact inert verified development corpus.');
  }
  for (const [index, entry] of corpus.entries.entries()) {
    const expected = PRODUCT_GATE_DEVELOPMENT_CORPUS_V1.entries[index];
    const { bytes: originalBytes, ...originalIdentity } = entry.original;
    const { bytes: normalizedBytes, ...normalizedIdentity } = entry.normalized;
    const exactProjection = {
      caseId: entry.caseId,
      primaryStratum: entry.primaryStratum,
      original: originalIdentity,
      normalized: normalizedIdentity,
      oracle: entry.oracle,
      evidenceUse: 'biased-development-fixture-only' as const,
      holdout: false as const,
      productGateEvidence: false as const,
      commercialGeneralizabilityEvidence: false as const,
      providerTransmissionAuthority: false as const,
      realEvaluationAuthority: false as const,
    };
    if (
      expected === undefined ||
      !(originalBytes instanceof Uint8Array) ||
      !(normalizedBytes instanceof Uint8Array) ||
      canonicalizeJson(exactProjection) !== canonicalizeJson(expected) ||
      sha256Hex(originalBytes) !== expected.original.sha256 ||
      sha256Hex(normalizedBytes) !== expected.normalized.sha256
    ) {
      throw new TypeError('Verified development corpus source or oracle identity drifted.');
    }
  }
};

const createFakeScene = (entry: VerifiedProductGateDevelopmentCorpusEntryV1): BannerSceneV1 => {
  const suffix = entry.normalized.sha256.slice(0, 16);
  const layerId = `layer_${suffix}`;
  return BannerSceneV1Schema.parse({
    schemaVersion: 1,
    canvas: {
      width: entry.normalized.pixelWidth,
      height: entry.normalized.pixelHeight,
      background: { kind: 'solid', color: '#FFFFFFFF' },
    },
    sourceAsset: {
      assetId: `source_${entry.original.sha256.slice(0, 16)}`,
      assetVersionId: `sourcev_${entry.original.sha256.slice(0, 16)}`,
      sha256: entry.original.sha256,
      mediaType: entry.original.mediaType,
      byteSize: entry.original.byteSize,
      pixelWidth: entry.original.pixelWidth,
      pixelHeight: entry.original.pixelHeight,
    },
    layers: [
      {
        id: layerId,
        name: 'Deterministic development foreground',
        order: 0,
        included: true,
        visible: true,
        opacity: 1,
        asset: {
          assetId: `asset_${suffix}`,
          assetVersionId: `assetv_${suffix}`,
          sha256: entry.normalized.sha256,
          mediaType: 'image/png',
          byteSize: entry.normalized.byteSize,
          pixelWidth: entry.normalized.pixelWidth,
          pixelHeight: entry.normalized.pixelHeight,
        },
        frame: {
          x: 0,
          y: 0,
          width: entry.normalized.pixelWidth,
          height: entry.normalized.pixelHeight,
        },
        transform: {
          anchorX: 0.5,
          anchorY: 0.5,
          translateX: 0,
          translateY: 0,
          scaleX: 1,
          scaleY: 1,
          rotationDegrees: 0,
        },
      },
    ],
    timeline: [
      {
        id: `track_${suffix}`,
        targetLayerId: layerId,
        preset: GENTLE_FLOAT_PRESET_V1.preset,
        timing: GENTLE_FLOAT_PRESET_V1.timing,
      },
    ],
    exportSettings: {
      kind: 'regular-html',
      profileVersion: 1,
      interaction: { kind: 'none' },
    },
  });
};

const canonicalDigest = (input: unknown): string =>
  sha256Hex(Buffer.from(canonicalizeJson(input), 'utf8'));

const cutoutValidationCache = new Set<string>();

const createScorecards = (input: {
  readonly entry: VerifiedProductGateDevelopmentCorpusEntryV1;
  readonly state: CaseState;
  readonly deterministicSeed: string;
}) => {
  const proposal = ProductGateCompositionProposalV1Schema.parse(input.state.proposal);
  const background = input.state.backgroundResult;
  if (background === null) throw new TypeError('Background score requires a result.');
  const visionScorecard = ProductGateVisionScorecardV1Schema.parse({
    scorecardVersion: 1,
    expectedLayerCount: { minimum: proposal.elements.length, maximum: proposal.elements.length },
    actualLayerCount: proposal.elements.length,
    layerCountValid: true,
    semanticRoleAndNameUsefulness: 4,
    criticalElementCount: proposal.elements.length,
    coveredCriticalElementCount: proposal.elements.length,
    criticalElementCoverageComplete: true,
    groupingAllowedByOracle: true,
    directlyVisibleEvidenceOnly: true,
    boundingBoxAgreementBps: 10_000,
    outcome: 'inconclusive',
    modelConfidenceUsedAsOracle: false,
  });
  const segmentationScorecards = input.state.candidates.map((candidate) =>
    ProductGateSegmentationScorecardV1Schema.parse({
      scorecardVersion: 1,
      semanticElementId: candidate.semanticElementId,
      candidateId: candidate.candidateId,
      scores: {
        semanticUsefulness: 4,
        completeness: 4,
        edgeMatteQuality: 4,
        backgroundCleanliness: 4,
        granularityIntegrity: 4,
        repairReadiness: 4,
      },
      anchors: PRODUCT_GATE_SEGMENTATION_SCORE_ANCHORS_V1,
      scorePolarity: 'zero-worst-four-best-no-average',
      duplicateProblem: false,
      fragmentProblem: false,
      classification: 'usable',
    }),
  );
  const backgroundScorecard = ProductGateBackgroundScorecardV1Schema.parse({
    scorecardVersion: 1,
    caseId: input.entry.caseId,
    originalSourceSha256: input.entry.original.sha256,
    normalizedSourceSha256: input.entry.normalized.sha256,
    strategy: background.strategy,
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
  const correctionBudget = ProductGateCorrectionBudgetV1Schema.parse({
    corrections: [],
    ordinaryCreativeSelectionCount: 0,
    fragmentCombinationCount: 0,
    minorMaskCorrectionCount: 0,
    maximumSeverity: 0,
    withinUsefulBudget: true,
  });
  const compositeScorecard = ProductGateCompositeUsefulnessScorecardV1Schema.parse({
    scorecardVersion: 1,
    everyCriticalElementCovered: true,
    oracleValidCountAndGrouping: true,
    foregroundComponents: segmentationScorecards,
    approvedUsableBackground: true,
    meaningfulAnimationReadyForegroundCount: 1,
    correctionBudget,
    unresolvedDuplicateProblem: false,
    unresolvedFragmentProblem: false,
    useful: true,
    outcome: 'pass',
  });
  const endToEndScorecard = ProductGateEndToEndScorecardV1Schema.parse({
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
  const itemIds = input.state.candidates.map((candidate) => candidate.candidateId).toSorted();
  const presentationOrder = deterministicProductGatePresentationOrderV1({
    seed: input.deterministicSeed,
    itemIds,
  });
  const reviewBase = {
    reviewVersion: 1 as const,
    caseId: input.entry.caseId,
    independentReview: true as const,
    providerModelBlind: true as const,
    deterministicPresentationSeed: input.deterministicSeed,
    presentationItemIds: itemIds,
    presentationOrderSha256: canonicalDigest(presentationOrder),
    rationale: 'Deterministic fake review record; no human scoring was performed.',
    modelConfidenceUsedAsOracle: false as const,
  };
  const firstReview = createProductGateRawReviewV1({
    ...reviewBase,
    reviewerId: 'reviewer_fake_alpha',
    categorical: {
      vision: 'inconclusive',
      segmentation: 'pass',
      background: 'inconclusive',
      composite: 'pass',
    },
    numeric: {
      visionUsefulness: 4,
      semanticUsefulness: 4,
      completeness: 4,
      edgeMatteQuality: 4,
      backgroundCleanliness: 4,
      granularityIntegrity: 4,
      repairReadiness: 4,
      backgroundUsability: 4,
      compositeUsefulness: 4,
    },
  });
  const secondReview = createProductGateRawReviewV1({
    ...reviewBase,
    reviewerId: 'reviewer_fake_beta',
    categorical: {
      vision: 'inconclusive',
      segmentation: 'fail',
      background: 'inconclusive',
      composite: 'pass',
    },
    numeric: {
      visionUsefulness: 4,
      semanticUsefulness: 2,
      completeness: 4,
      edgeMatteQuality: 4,
      backgroundCleanliness: 4,
      granularityIntegrity: 4,
      repairReadiness: 4,
      backgroundUsability: 4,
      compositeUsefulness: 4,
    },
  });
  const requirement = determineProductGateAdjudicationRequirementV1({
    first: firstReview,
    second: secondReview,
  });
  const adjudication = createProductGateAdjudicationV1({
    adjudicationVersion: 1,
    rawReviews: [firstReview, secondReview],
    requirement,
    thirdReviewerId: 'reviewer_fake_gamma',
    finalClassification: 'pass',
    rationale: 'Deterministic fake adjudication exercises the contract without human scoring.',
    rawReviewsOverwritten: false,
    modelConfidenceUsedAsOracle: false,
  });
  return {
    visionScorecard,
    segmentationScorecards,
    backgroundScorecard,
    compositeScorecard,
    endToEndScorecard,
    rawReviews: [firstReview, secondReview] as const,
    adjudication,
  };
};

class InjectedAbortError extends Error {}

export const runProductGateDeterministicFakeV1 = async (
  input: unknown,
): Promise<{
  readonly runDirectory: string;
  readonly report: ProductGateDeterministicFakeReportV1;
  readonly finalManifest: z.infer<typeof ProductGateFinalManifestV1Schema>;
  readonly finalManifestBytes: Uint8Array;
  readonly replayEvidenceSha256: string;
}> => {
  const parsed = FakeRunnerInputV1Schema.parse(input);
  assertVerifiedCorpus(parsed.verifiedCorpus);
  const outputRoot = await resolveProductGateOutputRootV1(parsed.outputRoot);
  const sanitizedInput = {
    runnerVersion: 1 as const,
    runnerIdentity: 'provider-free-deterministic-fake-runner-v1' as const,
    corpusManifestSha256: parsed.verifiedCorpus.manifestSha256,
    deterministicSeed: parsed.deterministicSeed,
    failureInjection: parsed.failureInjection,
  };
  const sanitizedInputSha256 = canonicalDigest(sanitizedInput);
  const runIdentityInput = {
    recordVersion: 1 as const,
    runnerIdentity: 'provider-free-deterministic-fake-runner-v1' as const,
    sanitizedInputSha256,
    corpusManifestSha256: parsed.verifiedCorpus.manifestSha256,
    corpusVersion: 1 as const,
    corpusSplit: 'development' as const,
    deterministicSeed: parsed.deterministicSeed,
    protectedIdentities: PRODUCT_GATE_PROTECTED_IDENTITIES_V1,
    provenance: PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1,
    providerTransmissionAuthority: false as const,
    realEvaluationAuthority: false as const,
    productGateEvidence: false as const,
  };
  const runId = createProductGateRunIdV1(runIdentityInput);
  const runRecord = ProductGateRunRecordV1Schema.parse({ runId, ...runIdentityInput });
  let runDirectory: string | null = null;
  const inventory: ProductGateArtifactInventoryEntryV1[] = [];
  try {
    runDirectory = await createProductGateRunDirectoryV1({
      rootDirectory: outputRoot,
      runId,
    });
    inventory.push(
      await writeProductGateEvidenceFileV1({
        runDirectory,
        relativePath: 'run.json',
        kind: 'run-record',
        mediaType: 'application/json',
        bytes: canonicalProductGateJsonBytesV1(runRecord),
      }),
    );
    let injectionConsumed = false;
    const caseResults: z.input<typeof ProductGateDeterministicFakeCaseResultV1Schema>[] = [];
    for (const [caseIndex, entry] of parsed.verifiedCorpus.entries.entries()) {
      const state: CaseState = {
        proposal: null,
        segmentationInvocation: null,
        candidates: [],
        masks: [],
        cutouts: [],
        segmentationResult: null,
        backgroundResult: null,
        backgroundInvocation: null,
        scene: null,
        renderPlan: null,
      };
      const attempts: ProductGateAttemptRecordV1[] = [];
      const acceptedStages: z.infer<typeof ProductGateEvaluationStageV1Schema>[] = [];
      let injectedFailureRecovered = false;

      const executeStage = async (
        stage: z.infer<typeof ProductGateEvaluationStageV1Schema>,
        attemptId: z.infer<typeof ProductGateAttemptRecordV1Schema>['attemptId'],
        logicalOperationId: z.infer<typeof ProductGateAttemptRecordV1Schema>['logicalOperationId'],
      ): Promise<{ result: unknown; artifacts: ProductGateArtifactInventoryEntryV1[] }> => {
        const artifacts: ProductGateArtifactInventoryEntryV1[] = [];
        const attemptRoot = `cases/${entry.caseId}/attempts/${attemptId}`;
        switch (stage) {
          case 'intake':
            return {
              result: {
                status: 'verified-development-fixture',
                sourceSha256: entry.original.sha256,
                normalizedSha256: entry.normalized.sha256,
                oracleSha256: entry.oracle.oracleSha256,
                providerTransmissionAuthority: false,
              },
              artifacts,
            };
          case 'vision': {
            const result = {
              kind: 'composition_proposal' as const,
              proposalVersion: 1 as const,
              sourceAssetSha256: entry.normalized.sha256,
              parts: entry.oracle.requiredLayers.map((layer) => ({
                partKey: layer.oracleLayerId,
                label: [...layer.approvedLabel].slice(0, 80).join(''),
                role: layer.role,
                bounds: {
                  xBps: layer.boundingBox.xBps,
                  yBps: layer.boundingBox.yBps,
                  widthBps: layer.boundingBox.widthBps,
                  heightBps: layer.boundingBox.heightBps,
                },
              })),
            };
            state.proposal = createProductGateCompositionProposalV1({
              request: {
                sourceAsset: { sha256: entry.normalized.sha256 },
                maxParts: 5,
                includeBackground: true,
              },
              result,
              criticalPartKeys: result.parts.map((part) => part.partKey),
            });
            return { result: state.proposal, artifacts };
          }
          case 'segmentation': {
            const proposal = ProductGateCompositionProposalV1Schema.parse(state.proposal);
            const invocationCore = {
              invocationVersion: 1 as const,
              boundary: 'evaluation-only-provider-neutral-segmentation' as const,
              runId,
              attemptId,
              logicalOperationId,
              sourceAssetSha256: entry.normalized.sha256,
              proposal,
              provenance: PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1,
              providerCallAuthority: false as const,
            };
            state.segmentationInvocation = ProductGateSegmentationInvocationV1Schema.parse({
              invocationId: createProductGateSegmentationInvocationIdV1(invocationCore),
              ...invocationCore,
            });
            state.candidates = proposal.elements.map((element, index) => {
              const core = {
                proposalId: proposal.proposalId,
                semanticElementId: element.semanticElementId,
                candidateOrdinal: index + 1,
                disposition: { kind: 'primary' as const },
              };
              return ProductGateSegmentationCandidateV1Schema.parse({
                candidateId: createProductGateSegmentationCandidateIdV1(core),
                ...core,
              });
            });
            state.masks = state.candidates.map((candidate) => {
              const core = {
                candidateId: candidate.candidateId,
                sourceAssetSha256: entry.normalized.sha256,
                pixelWidth: entry.normalized.pixelWidth,
                pixelHeight: entry.normalized.pixelHeight,
                alphaSha256: canonicalDigest({
                  fakeAlpha: true,
                  caseId: entry.caseId,
                  candidateId: candidate.candidateId,
                }),
              };
              return ProductGateMaskV1Schema.parse({
                maskId: createProductGateMaskIdV1(core),
                ...core,
              });
            });
            for (const [index, mask] of state.masks.entries()) {
              const artifact = await writeProductGateEvidenceFileV1({
                runDirectory: runDirectory!,
                relativePath: `${attemptRoot}/masks/mask-${String(index + 1)}.json`,
                kind: 'mask',
                mediaType: 'application/json',
                bytes: canonicalProductGateJsonBytesV1(mask),
              });
              inventory.push(artifact);
              artifacts.push(artifact);
            }
            return {
              result: ProductGateSegmentationPreparationResultV1Schema.parse({
                resultVersion: 1,
                boundary: 'evaluation-only-provider-neutral-segmentation-preparation',
                invocation: state.segmentationInvocation,
                candidates: state.candidates,
                masks: state.masks,
              }),
              artifacts,
            };
          }
          case 'cutout': {
            const proposal = ProductGateCompositionProposalV1Schema.parse(state.proposal);
            const invocation = ProductGateSegmentationInvocationV1Schema.parse(
              state.segmentationInvocation,
            );
            state.cutouts = [];
            for (const [index, mask] of state.masks.entries()) {
              const core = {
                maskId: mask.maskId,
                mediaType: 'image/png' as const,
                byteSize: entry.normalized.byteSize,
                pixelWidth: entry.normalized.pixelWidth,
                pixelHeight: entry.normalized.pixelHeight,
                sha256: entry.normalized.sha256,
              };
              const cutout = ProductGateMaterializedCutoutV1Schema.parse({
                cutoutId: createProductGateCutoutIdV1(core),
                ...core,
              });
              if (!cutoutValidationCache.has(cutout.sha256)) {
                await validateProductGateMaterializedCutoutV1({
                  cutout,
                  bytes: entry.normalized.bytes,
                });
                cutoutValidationCache.add(cutout.sha256);
              }
              state.cutouts.push(cutout);
              const artifact = await writeProductGateEvidenceFileV1({
                runDirectory: runDirectory!,
                relativePath: `${attemptRoot}/cutouts/cutout-${String(index + 1)}.png`,
                kind: 'cutout',
                mediaType: 'image/png',
                bytes: entry.normalized.bytes,
              });
              inventory.push(artifact);
              artifacts.push(artifact);
            }
            state.segmentationResult = validateProductGateSegmentationInvocationResultV1({
              invocation,
              result: {
                resultVersion: 1,
                boundary: 'evaluation-only-provider-neutral-segmentation',
                invocationId: invocation.invocationId,
                runId: invocation.runId,
                attemptId: invocation.attemptId,
                logicalOperationId: invocation.logicalOperationId,
                sourceAssetSha256: entry.normalized.sha256,
                proposalId: proposal.proposalId,
                proposal,
                semanticElements: proposal.elements,
                candidates: state.candidates,
                masks: state.masks,
                cutouts: state.cutouts,
                associations: state.candidates.map((candidate, index) => ({
                  proposalId: proposal.proposalId,
                  semanticElementId: candidate.semanticElementId,
                  candidateId: candidate.candidateId,
                  maskId: state.masks[index]!.maskId,
                  cutoutId: state.cutouts[index]!.cutoutId,
                })),
                provenance: PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1,
                providerCallAuthority: false,
              },
            });
            return {
              result: ProductGateCutoutStageResultV1Schema.parse({
                resultVersion: 1,
                boundary: 'evaluation-only-provider-neutral-cutout',
                runId,
                attemptId,
                logicalOperationId,
                segmentationInvocation: invocation,
                segmentationResult: state.segmentationResult,
                provenance: PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1,
                providerCallAuthority: false,
              }),
              artifacts,
            };
          }
          case 'background': {
            const proposal = ProductGateCompositionProposalV1Schema.parse(state.proposal);
            state.backgroundInvocation = validateProductGateBackgroundInvocationForCurrentCorpusV1({
              corpusManifest: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
              invocation: {
                invocationVersion: 1,
                boundary: 'evaluation-only-provider-neutral-background',
                runId,
                attemptId,
                logicalOperationId,
                caseId: entry.caseId,
                originalSourceSha256: entry.original.sha256,
                sourceAssetSha256: entry.normalized.sha256,
                proposalId: proposal.proposalId,
                strategy: 'reconstruction',
                solidFallbackPermission: null,
                provenance: PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1,
                providerCallAuthority: false,
              },
            });
            const artifact = await writeProductGateEvidenceFileV1({
              runDirectory: runDirectory!,
              relativePath: `${attemptRoot}/background/background.png`,
              kind: 'background',
              mediaType: 'image/png',
              bytes: entry.normalized.bytes,
            });
            inventory.push(artifact);
            artifacts.push(artifact);
            state.backgroundResult =
              validateProductGateBackgroundInvocationResultForCurrentCorpusV1({
                invocation: state.backgroundInvocation,
                corpusManifest: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
                result: createProductGateBackgroundResultV1({
                  resultVersion: 1,
                  boundary: 'evaluation-only-provider-neutral-background',
                  runId,
                  attemptId,
                  logicalOperationId,
                  caseId: entry.caseId,
                  originalSourceSha256: entry.original.sha256,
                  sourceAssetSha256: entry.normalized.sha256,
                  proposalId: proposal.proposalId,
                  strategy: 'reconstruction',
                  disposition: 'succeeded',
                  artifactSha256: artifact.sha256,
                  solidRgba: null,
                  solidFallbackPermission: null,
                  usable: true,
                  failureIdentity: null,
                  provenance: PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1,
                  providerCallAuthority: false,
                }),
              });
            return {
              result: {
                invocation: state.backgroundInvocation,
                result: state.backgroundResult,
              },
              artifacts,
            };
          }
          case 'scene':
            state.scene = createFakeScene(entry);
            return {
              result: {
                scene: state.scene,
                sceneSha256: canonicalDigest(state.scene),
                bannerSceneVersion: 1,
              },
              artifacts,
            };
          case 'preset':
            if (state.scene === null) throw new TypeError('Preset stage requires the scene.');
            return {
              result: {
                preset: GENTLE_FLOAT_PRESET_V1,
                targetLayerId: state.scene.layers[0]!.id,
                appropriateness: 'deterministic-development-fake-only',
              },
              artifacts,
            };
          case 'preview': {
            if (state.scene === null) throw new TypeError('Preview stage requires the scene.');
            state.renderPlan = createBannerSceneV1RenderPlan(state.scene);
            const previewBytes = createBannerSceneV1PreviewDocument({
              plan: state.renderPlan,
              assets: [
                {
                  reference: state.scene.layers[0]!.asset,
                  bytes: entry.normalized.bytes,
                },
              ],
              nonce: parsed.deterministicSeed.slice(0, 32),
            });
            const artifact = await writeProductGateEvidenceFileV1({
              runDirectory: runDirectory!,
              relativePath: `${attemptRoot}/preview/preview.html`,
              kind: 'preview',
              mediaType: 'text/html',
              bytes: previewBytes,
            });
            inventory.push(artifact);
            artifacts.push(artifact);
            return {
              result: {
                previewSha256: artifact.sha256,
                previewPolicy: 'existing-provider-free-isolated-preview',
              },
              artifacts,
            };
          }
          case 'export': {
            if (state.scene === null || state.renderPlan === null) {
              throw new TypeError('Export stage requires the accepted scene and preview plan.');
            }
            const parts = createBannerSceneV1ExportDocumentParts({
              plan: state.renderPlan,
              assets: [
                {
                  reference: state.scene.layers[0]!.asset,
                  bytes: entry.normalized.bytes,
                },
              ],
            });
            const bytes = Buffer.from(parts.indexHtml, 'utf8');
            const artifact = await writeProductGateEvidenceFileV1({
              runDirectory: runDirectory!,
              relativePath: `${attemptRoot}/export/index.html`,
              kind: 'export',
              mediaType: 'text/html',
              bytes,
            });
            inventory.push(artifact);
            artifacts.push(artifact);
            return {
              result: {
                exportArtifactSha256: artifact.sha256,
                stylesSha256: sha256Hex(Buffer.from(parts.stylesCss, 'utf8')),
                runtimeSha256: sha256Hex(Buffer.from(parts.runtimeJavaScript, 'utf8')),
                exportWorkflow: PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_REF_V1,
                exporter: PROVIDER_FREE_EXPORTER_REF_V1,
                reproductionContractPreserved: true,
                validationLabel: PROVIDER_FREE_EXPORT_VALIDATION_LABEL_V1,
                authoritativeGdnValidation: false,
              },
              artifacts,
            };
          }
          case 'authoritative-validation': {
            const validation = {
              status: 'not-measurable' as const,
              authoritativeGdnAuthority: false as const,
              internalValidator: PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_REF_V1,
              internalValidationLabel: PROVIDER_FREE_EXPORT_VALIDATION_LABEL_V1,
              internalValidationAcceptedAsGdn: false as const,
              separateGdnGateRequired: true as const,
            };
            const artifact = await writeProductGateEvidenceFileV1({
              runDirectory: runDirectory!,
              relativePath: `${attemptRoot}/validation.json`,
              kind: 'validation',
              mediaType: 'application/json',
              bytes: canonicalProductGateJsonBytesV1(validation),
            });
            inventory.push(artifact);
            artifacts.push(artifact);
            return { result: validation, artifacts };
          }
          case 'recovery':
            return {
              result: {
                status: injectedFailureRecovered ? 'injected-failure-recovered' : 'not-needed',
                acceptedEvidencePreserved: true,
                duplicateCostFinalizationPrevented: true,
              },
              artifacts,
            };
        }
      };

      for (const [stageIndex, stage] of PRODUCT_GATE_FAKE_RUNNER_STAGES_V1.entries()) {
        const logicalOperationId = createProductGateLogicalOperationIdV1({
          runId,
          caseId: entry.caseId,
          stage,
          operationVersion: 1,
        });
        const shouldInject =
          !injectionConsumed &&
          parsed.failureInjection?.caseId === entry.caseId &&
          parsed.failureInjection.stage === stage;
        let parentAttemptId: z.infer<typeof ProductGateAttemptRecordV1Schema>['attemptId'] | null =
          null;
        const maximumAttempts = shouldInject ? 2 : 1;
        for (let ordinal = 1; ordinal <= maximumAttempts; ordinal += 1) {
          const retry =
            ordinal === 1
              ? null
              : {
                  parentAttemptId: parentAttemptId!,
                  logicalOperationId,
                };
          const attemptIdentity = {
            recordVersion: 1 as const,
            runId,
            caseId: entry.caseId,
            attemptOrdinal: ordinal,
            stage,
            logicalOperationId,
            parentAttemptId: ordinal === 1 ? null : parentAttemptId,
            retry,
          };
          const attemptId = createProductGateAttemptIdV1(attemptIdentity);
          const attemptRoot = `cases/${entry.caseId}/attempts/${attemptId}`;
          const sanitizedRequestEntry = await writeProductGateEvidenceFileV1({
            runDirectory,
            relativePath: `${attemptRoot}/sanitized-request.json`,
            kind: 'sanitized-request',
            mediaType: 'application/json',
            bytes: canonicalProductGateJsonBytesV1({
              requestVersion: 1,
              runId,
              caseId: entry.caseId,
              stage,
              logicalOperationId,
              attemptOrdinal: ordinal,
              parentAttemptId: ordinal === 1 ? null : parentAttemptId,
              sourceSha256: entry.normalized.sha256,
              providerTransmissionAuthority: false,
            }),
          });
          inventory.push(sanitizedRequestEntry);
          if (shouldInject && ordinal === 1) {
            injectionConsumed = true;
            const failure = createProductGateSafeFailureV1({
              stage,
              code: 'injected-stage-failure',
              retryable: parsed.failureInjection!.disposition === 'recover',
            });
            const failedAttempt = createProductGateAttemptRecordV1({
              ...attemptIdentity,
              status: 'failed',
              runtimeMs: (caseIndex + 1) * 100 + stageIndex + 1,
              sanitizedRequestSha256: sanitizedRequestEntry.sha256,
              corpusManifestSha256: parsed.verifiedCorpus.manifestSha256,
              corpusVersion: 1,
              corpusSplit: 'development',
              protectedIdentities: PRODUCT_GATE_PROTECTED_IDENTITIES_V1,
              cost: createProductGateAttemptCostV1({
                usageStatus: 'failed',
                actualCostMicros: '0',
                estimatedCostMicros: '0',
                reservedCostMicros: '0',
              }),
              provenance: PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1,
              structuredResultSha256: null,
              artifacts: [sanitizedRequestEntry.artifactId],
              reviewRecordIds: [],
              adjudicationId: null,
              correctionClassification: null,
              failure,
              outputFinalized: false,
            });
            attempts.push(failedAttempt);
            parentAttemptId = failedAttempt.attemptId;
            if (parsed.failureInjection!.disposition === 'abort-and-clean-partial') {
              throw new InjectedAbortError(`Injected abort at ${stage}.`);
            }
            injectedFailureRecovered = true;
            continue;
          }
          const executed = await executeStage(stage, attemptId, logicalOperationId);
          const structuredResultSha256 = canonicalDigest(executed.result);
          const succeededAttempt = createProductGateAttemptRecordV1({
            ...attemptIdentity,
            status: 'succeeded',
            runtimeMs: (caseIndex + 1) * 100 + stageIndex + ordinal,
            sanitizedRequestSha256: sanitizedRequestEntry.sha256,
            corpusManifestSha256: parsed.verifiedCorpus.manifestSha256,
            corpusVersion: 1,
            corpusSplit: 'development',
            protectedIdentities: PRODUCT_GATE_PROTECTED_IDENTITIES_V1,
            cost: createProductGateAttemptCostV1({
              usageStatus: 'succeeded',
              actualCostMicros: '0',
              estimatedCostMicros: '0',
              reservedCostMicros: '0',
            }),
            provenance: PRODUCT_GATE_DETERMINISTIC_FAKE_PROVENANCE_V1,
            structuredResultSha256,
            artifacts: [
              sanitizedRequestEntry.artifactId,
              ...executed.artifacts.map((artifact) => artifact.artifactId),
            ],
            reviewRecordIds: [],
            adjudicationId: null,
            correctionClassification: null,
            failure: null,
            outputFinalized: true,
          });
          const structuredEntry = await writeProductGateEvidenceFileV1({
            runDirectory,
            relativePath: `${attemptRoot}/structured-result.json`,
            kind: 'structured-result',
            mediaType: 'application/json',
            bytes: canonicalProductGateJsonBytesV1({
              recordVersion: 1,
              attempt: succeededAttempt,
              result: executed.result,
            }),
          });
          inventory.push(structuredEntry);
          attempts.push(succeededAttempt);
          acceptedStages.push(stage);
          break;
        }
      }

      const scorecards = createScorecards({
        entry,
        state,
        deterministicSeed: parsed.deterministicSeed,
      });
      for (const review of scorecards.rawReviews) {
        const artifact = await writeProductGateEvidenceFileV1({
          runDirectory,
          relativePath: `cases/${entry.caseId}/reviews/${review.reviewRecordId}.json`,
          kind: 'review',
          mediaType: 'application/json',
          bytes: canonicalProductGateJsonBytesV1(review),
        });
        inventory.push(artifact);
      }
      inventory.push(
        await writeProductGateEvidenceFileV1({
          runDirectory,
          relativePath: `cases/${entry.caseId}/adjudication.json`,
          kind: 'adjudication',
          mediaType: 'application/json',
          bytes: canonicalProductGateJsonBytesV1(scorecards.adjudication),
        }),
      );
      caseResults.push({
        caseId: entry.caseId,
        acceptedStages,
        attempts,
        visionScorecard: scorecards.visionScorecard,
        segmentationScorecards: scorecards.segmentationScorecards,
        backgroundScorecard: scorecards.backgroundScorecard,
        compositeScorecard: scorecards.compositeScorecard,
        endToEndScorecard: scorecards.endToEndScorecard,
        rawReviews: scorecards.rawReviews,
        adjudication: scorecards.adjudication,
        correctionClassification: 'none',
        injectedFailureRecovered,
      });
    }

    if (parsed.failureInjection !== null && !injectionConsumed) {
      throw new TypeError('Requested deterministic failure injection was not exercised.');
    }
    const productGateMetric = evaluateProductGateEndToEndMetricV1({
      corpusManifest: PRODUCT_GATE_DEVELOPMENT_CORPUS_V1,
    });
    const report = ProductGateDeterministicFakeReportV1Schema.parse({
      reportVersion: 1,
      runId,
      runnerIdentity: 'provider-free-deterministic-fake-runner-v1',
      corpusSplit: 'development',
      corpusManifestSha256: parsed.verifiedCorpus.manifestSha256,
      cases: caseResults,
      productGateMetric,
      productGateOutcome: 'not-measurable',
      holdoutAdmitted: false,
      authoritativeGdnEvidenceAvailable: false,
      providerTransmissionAuthority: false,
      realEvaluationAuthority: false,
      networkOperations: 0,
      providerModelCalls: 0,
      samRunpodGpuCalls: 0,
      credentialAccesses: 0,
      paidOperations: 0,
    });
    inventory.push(
      await writeProductGateEvidenceFileV1({
        runDirectory,
        relativePath: 'report.json',
        kind: 'report',
        mediaType: 'application/json',
        bytes: canonicalProductGateJsonBytesV1(report),
      }),
    );
    const published = await publishProductGateFinalManifestV1({
      runDirectory,
      runId,
      entries: inventory,
    });
    return Object.freeze({
      runDirectory,
      report,
      finalManifest: published.manifest,
      finalManifestBytes: published.bytes,
      replayEvidenceSha256: sha256Hex(published.bytes),
    });
  } catch (error) {
    if (runDirectory !== null) {
      try {
        await cleanupPartialProductGateRunV1({
          rootDirectory: outputRoot,
          runId,
        });
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Product-gate run failed and exact partial cleanup also failed.',
        );
      }
    }
    throw error;
  }
};

export const rejectProductGateBlockedHoldoutFakeExecutionV1 = (input: unknown): never => {
  const parsed = z
    .strictObject({ manifest: ProductGateBlockedHoldoutManifestV1Schema })
    .readonly()
    .parse(input);
  if (canonicalizeJson(parsed.manifest) !== canonicalizeJson(PRODUCT_GATE_BLOCKED_HOLDOUT_V1)) {
    throw new TypeError('Unknown blocked holdout projection is rejected.');
  }
  return rejectBlockedProductGateHoldoutExecutionV1(parsed.manifest);
};
