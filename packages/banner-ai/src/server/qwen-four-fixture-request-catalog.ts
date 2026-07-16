import {
  INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
  SceneAnalysisModelRequestV1Schema,
  createSceneAnalysisModelRequestV1,
  sceneAnalysisModelInputDigestV1,
  type SceneAnalysisModelRequestV1,
} from '../evaluation/ai-contracts.js';
import {
  QWEN3_VL_FLASH_MODEL_CONTRACT_V1,
  QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V1_SHA256,
  QWEN_FOUR_FIXTURE_HUMAN_ORACLE_CORPUS_SHA256,
  QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256,
  QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_SHA256,
  QWEN3_VL_REQUEST_SHAPE_V1_SHA256,
  QWEN3_VL_REQUEST_SHAPE_V2_SHA256,
} from '../evaluation/qwen3-vl-candidate-evidence.js';
import {
  QwenBenchmarkFixtureIdSchema,
  getQwenFourFixtureEvaluationBindingsV1,
  type QwenBenchmarkFixtureId,
} from '../evaluation/qwen-four-fixture-quality.js';
import {
  SCENE_ANALYSIS_PROMPT_V1,
  canonicalBannerAiPromptRef,
} from '../evaluation/prompt-catalog.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';

const filenameByFixture = Object.freeze({
  'banner-person-v1': 'banner-person-v1.png',
  'banner-product-v1': 'banner-product-v1.png',
  'banner-text-heavy-v1': 'banner-text-heavy-v1.png',
  'banner-no-text-v1': 'banner-no-text-v1.png',
} as const);

const evaluationBindings = getQwenFourFixtureEvaluationBindingsV1();

const catalogEntries = evaluationBindings.map((binding) => {
  const fixtureId = QwenBenchmarkFixtureIdSchema.parse(binding.fixtureId);
  const filename = filenameByFixture[fixtureId];
  const modelInput = Object.freeze({
    inputVersion: 1 as const,
    fixture: Object.freeze({
      referenceVersion: 1 as const,
      kind: 'repository-fixture' as const,
      repositoryPath: `packages/banner-ai/test/fixtures/real-model-benchmark/normalized/${filename}`,
      exportName: `qwen_${fixtureId.replaceAll('-', '_')}`,
      variant: 'png' as const,
      normalization: 'canonical-raster-upload-v1' as const,
    }),
    sourceAsset: Object.freeze({
      assetId: `qwen_asset_${fixtureId.replaceAll('-', '_')}`,
      assetVersionId: `qwen_version_${fixtureId.replaceAll('-', '_')}`,
      sha256: binding.normalizedSource.sha256,
      mediaType: 'image/png' as const,
      byteSize: binding.normalizedSource.byteSize,
      pixelWidth: binding.normalizedSource.pixelWidth,
      pixelHeight: binding.normalizedSource.pixelHeight,
    }),
    model: QWEN3_VL_FLASH_MODEL_CONTRACT_V1,
    prompt: canonicalBannerAiPromptRef(SCENE_ANALYSIS_PROMPT_V1.id),
    options: Object.freeze({
      maxParts: 5 as const,
      includeBackground: true,
      preserveVisibleText: true,
    }),
    workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
  });
  const inputDigest = sceneAnalysisModelInputDigestV1(modelInput);
  return Object.freeze({
    fixtureId,
    filename,
    requestId: `qwen.${fixtureId}.run.1` as const,
    normalizedSource: binding.normalizedSource,
    oracleSha256: binding.oracleSha256,
    modelInput,
    inputDigest,
  });
});

export const QWEN_FOUR_FIXTURE_CANONICAL_REQUEST_CATALOG_V1 = Object.freeze(catalogEntries);

export const QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_V1 = Object.freeze(
  catalogEntries.map((entry) => entry.inputDigest),
);

export const QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_SHA256 = sha256Hex(
  Buffer.from(
    canonicalizeJson({
      aggregateVersion: 1,
      fixtureOrder: catalogEntries.map((entry) => entry.fixtureId),
      fullCanonicalModelInputDigests: QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_V1,
      pendingCorpusCoreSha256: QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256,
      humanOracleCorpusSha256: QWEN_FOUR_FIXTURE_HUMAN_ORACLE_CORPUS_SHA256,
    }),
    'utf8',
  ),
);

export const QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_V1_SHA256 =
  '4dc9f1265bf0494784026836f42506f0b8f42e045862376318e905b437629041' as const;
if (
  QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_SHA256 !==
  QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_V1_SHA256
) {
  throw new TypeError('Historical provider-neutral Qwen model-input aggregate drifted.');
}

const reconstructedHistoricalV1BindingSha256 = sha256Hex(
  Buffer.from(
    canonicalizeJson({
      bindingVersion: 1,
      orderedModelInputDigestsSha256: QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_SHA256,
      providerProtocolWrapperSha256: QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V1_SHA256,
      requestShapeSha256: QWEN3_VL_REQUEST_SHAPE_V1_SHA256,
    }),
    'utf8',
  ),
);
export const QWEN_FOUR_FIXTURE_HISTORICAL_V1_BINDING_SHA256 =
  'd6b0957ca617139b382b0585570ecf27c5a00a050a45c2b729c2f251bf7bd252' as const;
if (reconstructedHistoricalV1BindingSha256 !== QWEN_FOUR_FIXTURE_HISTORICAL_V1_BINDING_SHA256) {
  throw new TypeError('Reconstructed historical Qwen V1 provider binding drifted.');
}

export const QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_V2_SHA256 = sha256Hex(
  Buffer.from(
    canonicalizeJson({
      aggregateVersion: 2,
      fixtureOrder: catalogEntries.map((entry) => entry.fixtureId),
      fullCanonicalModelInputDigests: QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_V1,
      pendingCorpusCoreSha256: QWEN_FOUR_FIXTURE_PENDING_CORPUS_CORE_SHA256,
      humanOracleCorpusSha256: QWEN_FOUR_FIXTURE_HUMAN_ORACLE_CORPUS_SHA256,
      providerProtocolWrapperSha256: QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V2_SHA256,
      requestShapeSha256: QWEN3_VL_REQUEST_SHAPE_V2_SHA256,
    }),
    'utf8',
  ),
);

export const QWEN_FOUR_FIXTURE_ACTIVE_MODEL_INPUT_DIGESTS_SHA256 =
  QWEN_FOUR_FIXTURE_ORDERED_MODEL_INPUT_DIGESTS_V2_SHA256;

export const createCanonicalQwenBenchmarkRequestV1 = (
  fixtureIdInput: unknown,
): SceneAnalysisModelRequestV1 => {
  const fixtureId = QwenBenchmarkFixtureIdSchema.parse(fixtureIdInput);
  const entry = catalogEntries.find((candidate) => candidate.fixtureId === fixtureId);
  if (entry === undefined) throw new TypeError('Canonical Qwen request catalog entry is absent.');
  return createSceneAnalysisModelRequestV1({
    requestId: entry.requestId,
    modelInput: entry.modelInput,
  });
};

export const requireCanonicalQwenBenchmarkRequestV1 = (
  requestInput: unknown,
): {
  readonly fixtureId: QwenBenchmarkFixtureId;
  readonly request: SceneAnalysisModelRequestV1;
} => {
  const request = SceneAnalysisModelRequestV1Schema.parse(requestInput);
  const entry = catalogEntries.find(
    (candidate) => candidate.requestId === request.requestIdentity.requestId,
  );
  if (entry === undefined) throw new TypeError('Qwen request ID is absent from the fixed catalog.');
  const expected = createCanonicalQwenBenchmarkRequestV1(entry.fixtureId);
  if (canonicalizeJson(request) !== canonicalizeJson(expected)) {
    throw new TypeError('Qwen request differs from its exact canonical fixture and input binding.');
  }
  return Object.freeze({ fixtureId: entry.fixtureId, request });
};
