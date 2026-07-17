import { describe, expect, it } from 'vitest';

import { createSceneAnalysisModelRequestV1 } from '../src/evaluation/ai-contracts.js';
import {
  QWEN3_VL_REQUESTED_MODEL_ID,
  QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V3_SHA256,
  QWEN3_VL_REQUEST_SHAPE_V4_SHA256,
} from '../src/evaluation/qwen3-vl-candidate-evidence.js';
import {
  SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_SHA256,
  ProposedSceneAnalysisOcrOutputV1Schema,
} from '../src/evaluation/openai-scene-analysis-output.js';
import {
  createDeterministicOracleMatchingQwenSemanticOutputV1,
  evaluateQwenFourFixtureQualityV1,
  getQwenFourFixtureEvaluationBindingsV1,
} from '../src/evaluation/qwen-four-fixture-quality.js';
import {
  QWEN_DIAGNOSTIC_V2_SEMANTIC_PROJECTION_V1_SHA256,
  QWEN_DIAGNOSTIC_V2_SEMANTIC_PROJECTION_VERSION,
  QWEN_RESPONSE_BOUNDARY_V2_DEFINITION_SHA256,
  QWEN_SEMANTIC_MATERIALIZER_V1_DEFINITION_SHA256,
} from '../src/evaluation/qwen-response-contract-evidence.js';
import {
  QWEN_SEMANTIC_SCENE_ANALYSIS_JSON_SCHEMA_V1,
  QWEN_SEMANTIC_SCENE_ANALYSIS_JSON_SCHEMA_V1_SHA256,
  QwenSemanticSceneAnalysisOutputV1Schema,
  type QwenSemanticSceneAnalysisOutputV1,
} from '../src/evaluation/qwen-semantic-scene-analysis-output.js';
import { canonicalizeJson, sha256Hex } from '../src/scene/canonical-scene-json.js';
import { createCanonicalQwenBenchmarkRequestV1 } from '../src/server/qwen-four-fixture-request-catalog.js';
import {
  QwenResponseBoundaryFailure,
  validateQwenProviderResponseBoundaryV2,
} from '../src/server/qwen3-vl-response-boundary.js';

const semanticRootKeys = [
  'composition',
  'layerEvidence',
  'ocrCompletion',
  'textObservations',
  'reviewFlags',
] as const;

const request = createCanonicalQwenBenchmarkRequestV1('banner-person-v1');
const binding = getQwenFourFixtureEvaluationBindingsV1()[0]!;

const envelope = (assistantOutput: unknown) => ({
  status: 200,
  bodyText: JSON.stringify({
    id: 'chatcmpl-semantic-boundary-test',
    object: 'chat.completion',
    created: 1_784_064_000,
    model: QWEN3_VL_REQUESTED_MODEL_ID,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: JSON.stringify(assistantOutput),
          refusal: null,
          audio: null,
          function_call: null,
          tool_calls: null,
        },
        finish_reason: 'stop',
        logprobs: null,
      },
    ],
    usage: {
      prompt_tokens: 1_000,
      completion_tokens: 200,
      total_tokens: 1_200,
    },
    system_fingerprint: 'provider-free-semantic-test',
    service_tier: null,
  }),
});

const createFiveObservationSemanticOutput = (): QwenSemanticSceneAnalysisOutputV1 => {
  const base = createDeterministicOracleMatchingQwenSemanticOutputV1('banner-person-v1');
  if (base.composition.kind !== 'composition_proposal') {
    throw new TypeError('The person oracle must produce a composition proposal.');
  }
  return QwenSemanticSceneAnalysisOutputV1Schema.parse({
    composition: base.composition,
    layerEvidence: base.layerEvidence,
    ocrCompletion: { kind: 'visible-text-observations-complete' },
    textObservations: [
      {
        observationId: 'semantic_text_1',
        text: { value: 'ONE' },
        boundingBox: { xBps: 100, yBps: 100, widthBps: 1_000, heightBps: 500 },
        confidence: { valueBps: 9_900 },
      },
      {
        observationId: 'semantic_text_2',
        text: { value: 'TWO' },
        boundingBox: { xBps: 1_200, yBps: 100, widthBps: 1_000, heightBps: 500 },
        confidence: { valueBps: 9_800 },
      },
      {
        observationId: 'semantic_text_3',
        text: { value: 'THREE' },
        boundingBox: { xBps: 2_300, yBps: 100, widthBps: 1_000, heightBps: 500 },
        confidence: { valueBps: 9_700 },
      },
      {
        observationId: 'semantic_text_4',
        text: { value: 'FOUR' },
        boundingBox: { xBps: 3_400, yBps: 100, widthBps: 1_000, heightBps: 500 },
        confidence: { valueBps: 9_600 },
      },
      {
        observationId: 'semantic_text_5',
        text: { value: 'FIVE' },
        boundingBox: { xBps: 4_500, yBps: 100, widthBps: 1_000, heightBps: 500 },
        confidence: { valueBps: 9_500 },
      },
    ],
    reviewFlags: [],
  });
};

const captureFailure = (input: {
  readonly output: unknown;
  readonly boundaryRequest?: typeof request;
}): QwenResponseBoundaryFailure => {
  try {
    validateQwenProviderResponseBoundaryV2({
      response: envelope(input.output),
      request: input.boundaryRequest ?? request,
    });
  } catch (error) {
    if (error instanceof QwenResponseBoundaryFailure) return error;
    throw error;
  }
  throw new Error('Expected the semantic boundary to reject.');
};

describe('Qwen semantic response boundary V2', () => {
  it('publishes exactly five ordered semantic roots and preserves the canonical schema contract', () => {
    const output = createFiveObservationSemanticOutput();
    const jsonSchema = QWEN_SEMANTIC_SCENE_ANALYSIS_JSON_SCHEMA_V1 as {
      readonly properties: Readonly<Record<string, unknown>>;
      readonly additionalProperties: boolean;
    };

    expect(Object.keys(output)).toEqual(semanticRootKeys);
    expect(Object.keys(jsonSchema.properties)).toEqual(semanticRootKeys);
    expect(jsonSchema.additionalProperties).toBe(false);
    expect(
      sha256Hex(Buffer.from(canonicalizeJson(QWEN_SEMANTIC_SCENE_ANALYSIS_JSON_SCHEMA_V1), 'utf8')),
    ).toBe(QWEN_SEMANTIC_SCENE_ANALYSIS_JSON_SCHEMA_V1_SHA256);
    expect(SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_SHA256).toBe(
      '2bdfd91875bc097b6bac93eadad924cdfb89b9fe9dc4f8293f494c721179dc9d',
    );
  });

  it('materializes five parts, ordered evidence, five texts, and every server-owned field', () => {
    const semanticOutput = createFiveObservationSemanticOutput();
    const result = validateQwenProviderResponseBoundaryV2({
      response: envelope(semanticOutput),
      request,
    });

    expect(result).toMatchObject({
      boundaryVersion: 2,
      boundarySha256: QWEN_RESPONSE_BOUNDARY_V2_DEFINITION_SHA256,
      proposal: {
        materializerVersion: 1,
        materializerSha256: QWEN_SEMANTIC_MATERIALIZER_V1_DEFINITION_SHA256,
        observationBasisAuthority: 'untrusted-provider-semantic-claim',
        observationIdAuthority: 'untrusted-validated-local-semantic-reference',
        decisionAuthority: 'proposal-requires-user-review',
      },
    });
    expect(result.proposal.composition.parts).toHaveLength(5);
    expect(result.proposal.layerEvidence).toHaveLength(5);
    expect(result.proposal.layerEvidence.map((evidence) => evidence.partKey)).toEqual(
      result.proposal.composition.parts.map((part) => part.partKey),
    );
    expect(result.proposal.canonicalScene).toMatchObject({
      outputVersion: 1,
      visibleContentConstraint: 'only-directly-visible-objects-and-text',
      composition: {
        proposalVersion: 1,
        sourceAssetSha256: request.input.sourceAsset.sha256,
      },
      ocrCompletion: {
        kind: 'visible-text-observations-complete',
        observationCount: 5,
      },
      humanReview: {
        required: true,
        proposalOnly: true,
        automaticCutoutExportOrOtherDecisionAuthority: 'none',
      },
    });
    expect(result.proposal.canonicalScene.textObservations).toHaveLength(5);
    expect(
      result.proposal.canonicalScene.textObservations.every(
        (observation) =>
          observation.observationVersion === 1 &&
          observation.text.normalization === 'unicode-nfc-single-space-v1' &&
          observation.text.contentTrust === 'untrusted-user-image-content' &&
          observation.text.instructionAuthority === 'none' &&
          observation.boundingBox.unit === 'normalized-basis-points' &&
          observation.confidence.unit === 'basis-points',
      ),
    ).toBe(true);
    expect(ProposedSceneAnalysisOcrOutputV1Schema.parse(result.proposal.canonicalScene)).toEqual(
      result.proposal.canonicalScene,
    );
  });

  it('lets a materialized oracle reach and pass the unchanged quality gate', () => {
    const semanticOutput =
      createDeterministicOracleMatchingQwenSemanticOutputV1('banner-person-v1');
    const result = validateQwenProviderResponseBoundaryV2({
      response: envelope(semanticOutput),
      request,
    });
    const quality = evaluateQwenFourFixtureQualityV1({
      fixtureId: 'banner-person-v1',
      normalizedSourceSha256: binding.normalizedSource.sha256,
      oracleSha256: binding.oracleSha256,
      actualParts: result.proposal.composition.parts,
      actualObservations: result.proposal.textObservations.observations,
    });

    expect(quality).toMatchObject({
      layerQuality: { actualLayerCount: 5, pass: true },
      ocrPass: true,
      pass: true,
    });
  });

  it.each([
    [
      'root source identity',
      (output: Record<string, unknown>) => {
        output.sourceAssetSha256 = request.input.sourceAsset.sha256;
      },
    ],
    [
      'root visible-content policy',
      (output: Record<string, unknown>) => {
        output.visibleContentConstraint = 'only-directly-visible-objects-and-text';
      },
    ],
    [
      'root output version',
      (output: Record<string, unknown>) => {
        output.outputVersion = 1;
      },
    ],
    [
      'root human-review authority',
      (output: Record<string, unknown>) => {
        output.humanReview = {
          required: true,
          proposalOnly: true,
          automaticCutoutExportOrOtherDecisionAuthority: 'none',
        };
      },
    ],
    [
      'root provenance',
      (output: Record<string, unknown>) => {
        output.provenance = { producer: 'provider' };
      },
    ],
    [
      'root decision authority',
      (output: Record<string, unknown>) => {
        output.decisionAuthority = 'proposal-requires-user-review';
      },
    ],
    [
      'composition proposal version',
      (output: Record<string, unknown>) => {
        (output.composition as Record<string, unknown>).proposalVersion = 1;
      },
    ],
    [
      'composition source identity',
      (output: Record<string, unknown>) => {
        (output.composition as Record<string, unknown>).sourceAssetSha256 =
          request.input.sourceAsset.sha256;
      },
    ],
    [
      'OCR observation count',
      (output: Record<string, unknown>) => {
        (output.ocrCompletion as Record<string, unknown>).observationCount = 5;
      },
    ],
    [
      'text trust metadata',
      (output: Record<string, unknown>) => {
        const observation = (output.textObservations as Record<string, unknown>[])[0]!;
        (observation.text as Record<string, unknown>).contentTrust = 'untrusted-user-image-content';
      },
    ],
    [
      'text observation version',
      (output: Record<string, unknown>) => {
        const observation = (output.textObservations as Record<string, unknown>[])[0]!;
        observation.observationVersion = 1;
      },
    ],
    [
      'text kind',
      (output: Record<string, unknown>) => {
        const observation = (output.textObservations as Record<string, unknown>[])[0]!;
        (observation.text as Record<string, unknown>).kind = 'observed-text';
      },
    ],
    [
      'text normalization',
      (output: Record<string, unknown>) => {
        const observation = (output.textObservations as Record<string, unknown>[])[0]!;
        (observation.text as Record<string, unknown>).normalization = 'unicode-nfc-single-space-v1';
      },
    ],
    [
      'text instruction authority',
      (output: Record<string, unknown>) => {
        const observation = (output.textObservations as Record<string, unknown>[])[0]!;
        (observation.text as Record<string, unknown>).instructionAuthority = 'none';
      },
    ],
    [
      'text bounding-box unit',
      (output: Record<string, unknown>) => {
        const observation = (output.textObservations as Record<string, unknown>[])[0]!;
        (observation.boundingBox as Record<string, unknown>).unit = 'normalized-basis-points';
      },
    ],
    [
      'text confidence unit',
      (output: Record<string, unknown>) => {
        const observation = (output.textObservations as Record<string, unknown>[])[0]!;
        (observation.confidence as Record<string, unknown>).unit = 'basis-points';
      },
    ],
    [
      'confidence unit',
      (output: Record<string, unknown>) => {
        const evidence = (output.layerEvidence as Record<string, unknown>[])[0]!;
        (evidence.confidence as Record<string, unknown>).unit = 'basis-points';
      },
    ],
    [
      'arbitrary root extension',
      (output: Record<string, unknown>) => {
        output.futureSemanticSummary = 'forbidden';
      },
    ],
    [
      'arbitrary nested extension',
      (output: Record<string, unknown>) => {
        const observation = (output.textObservations as Record<string, unknown>[])[0]!;
        (observation.boundingBox as Record<string, unknown>).futureCoordinateUnit = 'pixels';
      },
    ],
  ])('rejects the reserved or unknown %s field before materialization', (_label, mutate) => {
    const output = structuredClone(createFiveObservationSemanticOutput()) as unknown as Record<
      string,
      unknown
    >;
    mutate(output);
    const failure = captureFailure({ output });

    expect(failure).toMatchObject({
      reason: 'schema-invalid',
      diagnostic: {
        diagnosticVersion: 2,
        stage: 'unknown-field-rejection',
      },
    });
  });

  it.each([
    'requestId',
    'requestIdentity',
    'workflowId',
    'workflowDefinitionSha256',
    'policySha256',
    'contentPolicyDefinitionSha256',
    'promptSha256',
    'promptContentSha256',
    'modelId',
    'requestedModelId',
    'authorizationId',
    'authorizationVersion',
  ])('rejects provider-owned root identity key %s', (identityKey) => {
    const output = {
      ...createFiveObservationSemanticOutput(),
      [identityKey]: identityKey.endsWith('Version') ? 1 : 'forbidden-provider-identity',
    };
    const failure = captureFailure({ output });

    expect(failure).toMatchObject({
      reason: 'schema-invalid',
      diagnostic: {
        stage: 'unknown-field-rejection',
        totalIssueCount: 1,
      },
    });
  });

  it.each([
    'requestId',
    'workflowId',
    'policySha256',
    'promptSha256',
    'modelId',
    'authorizationId',
  ])('rejects provider-owned nested identity key %s', (identityKey) => {
    const output = structuredClone(createFiveObservationSemanticOutput()) as unknown as Record<
      string,
      unknown
    >;
    (output.composition as Record<string, unknown>)[identityKey] =
      'forbidden-nested-provider-identity';
    const failure = captureFailure({ output });

    expect(failure).toMatchObject({
      reason: 'schema-invalid',
      diagnostic: {
        diagnosticVersion: 2,
        stage: 'unknown-field-rejection',
        totalIssueCount: 1,
      },
    });
  });

  it('sorts two forbidden root identity fields into one deterministic issue digest', () => {
    const base = createFiveObservationSemanticOutput();
    const first = {
      sourceAssetSha256: request.input.sourceAsset.sha256,
      ...base,
      visibleContentConstraint: 'only-directly-visible-objects-and-text',
    };
    const second = {
      visibleContentConstraint: 'only-directly-visible-objects-and-text',
      ...base,
      sourceAssetSha256: request.input.sourceAsset.sha256,
    };
    const firstFailure = captureFailure({ output: first });
    const secondFailure = captureFailure({ output: second });

    expect(firstFailure.diagnostic).toEqual(secondFailure.diagnostic);
    expect(firstFailure.diagnostic).toMatchObject({
      stage: 'unknown-field-rejection',
      totalIssueCount: 1,
      retainedIssueCount: 1,
      truncatedIssueCount: 0,
    });
  });

  it.each([
    [
      'duplicate observation IDs',
      (output: Record<string, unknown>) => {
        const observations = output.textObservations as Record<string, unknown>[];
        observations[1]!.observationId = observations[0]!.observationId;
      },
    ],
    [
      'numeric-only observation ID',
      (output: Record<string, unknown>) => {
        const observations = output.textObservations as Record<string, unknown>[];
        observations[0]!.observationId = '12345';
      },
    ],
    [
      'evidence order drift',
      (output: Record<string, unknown>) => {
        const evidence = output.layerEvidence as unknown[];
        [evidence[0], evidence[1]] = [evidence[1], evidence[0]];
      },
    ],
    [
      'missing evidence entry',
      (output: Record<string, unknown>) => {
        (output.layerEvidence as unknown[]).pop();
      },
    ],
    [
      'fewer than three parts and evidence entries',
      (output: Record<string, unknown>) => {
        const composition = output.composition as Record<string, unknown>;
        composition.parts = (composition.parts as unknown[]).slice(0, 2);
        output.layerEvidence = (output.layerEvidence as unknown[]).slice(0, 2);
      },
    ],
    [
      'more than five parts and evidence entries',
      (output: Record<string, unknown>) => {
        const composition = output.composition as Record<string, unknown>;
        const parts = composition.parts as Record<string, unknown>[];
        const evidence = output.layerEvidence as Record<string, unknown>[];
        parts.push({ ...parts[0], partKey: 'semantic_layer_6' });
        evidence.push({ ...evidence[0], partKey: 'semantic_layer_6' });
      },
    ],
    [
      'OCR disposition drift',
      (output: Record<string, unknown>) => {
        output.ocrCompletion = { kind: 'no-visible-text-observed' };
      },
    ],
  ])('rejects relational semantic failure: %s', (_label, mutate) => {
    const output = structuredClone(createFiveObservationSemanticOutput()) as unknown as Record<
      string,
      unknown
    >;
    mutate(output);
    const failure = captureFailure({ output });

    expect(failure).toMatchObject({
      reason: 'schema-invalid',
      diagnostic: { stage: 'semantic-output-schema' },
    });
  });

  it('accepts only the exact canonical request and rejects a foreign request before parsing output', () => {
    const semanticOutput = createFiveObservationSemanticOutput();
    expect(
      validateQwenProviderResponseBoundaryV2({
        response: envelope(semanticOutput),
        request,
      }).proposal.canonicalScene.composition.sourceAssetSha256,
    ).toBe(request.input.sourceAsset.sha256);

    const foreignRequest = createSceneAnalysisModelRequestV1({
      requestId: 'qwen.banner-person-v1.foreign',
      modelInput: request.input,
    });
    const failure = captureFailure({
      output: semanticOutput,
      boundaryRequest: foreignRequest,
    });
    expect(failure).toMatchObject({
      reason: 'identity-mismatch',
      diagnostic: {
        stage: 'request-relative-identity',
        issueDigestSha256: expect.stringMatching(/^[0-9a-f]{64}$/u),
      },
    });
  });

  it.each([
    [
      'source digest',
      {
        ...request.input,
        sourceAsset: {
          ...request.input.sourceAsset,
          sha256: 'f'.repeat(64),
        },
      },
    ],
    [
      'source dimensions',
      {
        ...request.input,
        sourceAsset: {
          ...request.input.sourceAsset,
          pixelWidth: request.input.sourceAsset.pixelWidth + 1,
        },
      },
    ],
  ])(
    'rejects altered canonical request %s context before semantic parsing',
    (_label, modelInput) => {
      const alteredRequest = createSceneAnalysisModelRequestV1({
        requestId: request.requestIdentity.requestId,
        modelInput,
      });
      const failure = captureFailure({
        output: createFiveObservationSemanticOutput(),
        boundaryRequest: alteredRequest,
      });

      expect(failure).toMatchObject({
        reason: 'identity-mismatch',
        diagnostic: {
          stage: 'request-relative-identity',
          totalIssueCount: 1,
        },
      });
    },
  );

  it('rejects no-useful-layers as a provider request constraint before quality evaluation', () => {
    const failure = captureFailure({
      output: {
        composition: { kind: 'no_useful_layers', reason: 'flat_image' },
        layerEvidence: [],
        ocrCompletion: { kind: 'no-visible-text-observed' },
        textObservations: [],
        reviewFlags: [],
      },
    });

    expect(failure).toMatchObject({
      reason: 'schema-invalid',
      diagnostic: {
        stage: 'semantic-output-schema',
        issues: [
          expect.objectContaining({
            path: '/composition',
            validatorIssueCode: 'request-constraint',
          }),
        ],
      },
    });
  });

  it('binds the active wrapper, request, boundary, and materializer revisions independently', () => {
    expect({
      wrapper: QWEN3_VL_PROVIDER_PROTOCOL_WRAPPER_V3_SHA256,
      request: QWEN3_VL_REQUEST_SHAPE_V4_SHA256,
      semantic: QWEN_SEMANTIC_SCENE_ANALYSIS_JSON_SCHEMA_V1_SHA256,
      canonical: SCENE_ANALYSIS_OCR_OUTPUT_JSON_SCHEMA_SHA256,
      boundary: QWEN_RESPONSE_BOUNDARY_V2_DEFINITION_SHA256,
      materializer: QWEN_SEMANTIC_MATERIALIZER_V1_DEFINITION_SHA256,
      diagnosticProjectionVersion: QWEN_DIAGNOSTIC_V2_SEMANTIC_PROJECTION_VERSION,
      diagnosticProjection: QWEN_DIAGNOSTIC_V2_SEMANTIC_PROJECTION_V1_SHA256,
    }).toEqual({
      wrapper: '85125a2547002fa381da4c0c9042ec21add1df1ee26bd080cb92c6c6f1ad1058',
      request: '1f864a8efccdaaa59539bc745963c98284913979703fb1e38966b59e4d56d580',
      semantic: 'cbf8d753572046e03d25fc14ac6e62ace5eccf6a8ab975684bd307e08d452dcc',
      canonical: '2bdfd91875bc097b6bac93eadad924cdfb89b9fe9dc4f8293f494c721179dc9d',
      boundary: '584f7b62cb9a34e9d05e39aed67bf339a3df2e484c278626db65b8ddcbe4054a',
      materializer: 'e85ff59a190163d5fcf7800b818960c49a9f1965d4ada6bb23f4b9fb65436c63',
      diagnosticProjectionVersion: 1,
      diagnosticProjection: '613c6d94a3b70a7ca9d494a667917ed185bb0c14fb53b6e7a87c4eea97f5a186',
    });
  });
});
