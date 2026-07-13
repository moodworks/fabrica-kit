import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1,
  ANGEL_PROVIDER_FREE_SCENE_PROPOSAL_V1,
  AiInputDigestV1Schema,
  AiInputSha256Schema,
  AiModelContractV1Schema,
  AnimationPlanModelInputV1Schema,
  AnimationPlanModelRequestV1Schema,
  BANNER_AI_BENCHMARK_CASES_V1,
  BACKGROUND_FILL_PROMPT_V1,
  BackgroundFillModelInputV1Schema,
  BackgroundFillModelRequestV1Schema,
  BannerAiBenchmarkCaseV1Schema,
  BannerAiPromptCatalogEntryV1Schema,
  BannerAiPromptRefV1Schema,
  BenchmarkCostBreakdownV1Schema,
  BenchmarkCostUsageV1Schema,
  BenchmarkPricingConfigV1Schema,
  CANONICAL_BANNER_AI_PROMPTS,
  CanonicalMicrosStringSchema,
  INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
  PROVIDER_FREE_FIXTURE_SCENE_MODEL_V1,
  ProviderKeySchema,
  RequestIdSchema,
  SCENE_ANALYSIS_PROMPT_V1,
  SceneAnalysisModelInvocationV1Schema,
  SceneAnalysisModelRequestV1Schema,
  SegmentationMaskReferenceV1Schema,
  Sha256HexSchema,
  OutputKeySchema,
  UsdMicrosAmountV1Schema,
  animationPlanModelInputDigestV1,
  backgroundFillModelInputDigestV1,
  benchmarkCaseSceneAnalysisRequestV1,
  canonicalBannerAiPromptRef,
  createProviderFreeFakeSceneAnalysisAdapterV1,
  createSceneAnalysisModelRequestV1,
  estimateBenchmarkCostV1,
  evaluateBannerAiBenchmarkCaseV1,
  sceneAnalysisModelInputDigestV1,
  sha256Hex,
  validateSceneAnalysisInvocationForRequestV1,
} from '../src/index.js';

const benchmarkRequest = () =>
  benchmarkCaseSceneAnalysisRequestV1(ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1);

const fakeAdapter = () => createProviderFreeFakeSceneAnalysisAdapterV1();

type Mutable<T> = T extends readonly (infer Entry)[]
  ? Mutable<Entry>[]
  : T extends object
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T;

const mutableClone = <T>(input: T): Mutable<T> => structuredClone(input) as Mutable<T>;

describe('versioned Banner AI prompt catalog', () => {
  it('freezes stable IDs, versions, and literal UTF-8 content hashes', () => {
    expect(CANONICAL_BANNER_AI_PROMPTS.map((prompt) => prompt.id)).toEqual([
      'scene-analysis-v1',
      'background-fill-v1',
      'animation-plan-v1',
    ]);
    expect(
      Object.fromEntries(
        CANONICAL_BANNER_AI_PROMPTS.map((prompt) => [prompt.id, prompt.contentSha256]),
      ),
    ).toEqual({
      'scene-analysis-v1': '5cc311b7b353e06c61bcdf840b40dff9d35de0aea12851ffa18a654177917227',
      'background-fill-v1': '98c6a7212d29cecd8b4949bc35f7baeb770826e675fb705e0854f52ec2408b97',
      'animation-plan-v1': 'a096c0e71b81143b9e8c533e6360fa5159b2e849e8b274d9556a9531b4580393',
    });
    for (const prompt of CANONICAL_BANNER_AI_PROMPTS) {
      expect(prompt.version).toBe(1);
      expect(sha256Hex(Buffer.from(prompt.content, 'utf8'))).toBe(prompt.contentSha256);
      expect(Object.isFrozen(prompt)).toBe(true);
    }
  });

  it('rejects prompt drift, stale refs, missing fields, and unknown fields', () => {
    expect(
      BannerAiPromptCatalogEntryV1Schema.safeParse({
        ...SCENE_ANALYSIS_PROMPT_V1,
        content: `${SCENE_ANALYSIS_PROMPT_V1.content} drift`,
      }).success,
    ).toBe(false);
    expect(
      BannerAiPromptRefV1Schema.safeParse({
        ...canonicalBannerAiPromptRef('scene-analysis-v1'),
        contentSha256: 'f'.repeat(64),
      }).success,
    ).toBe(false);
    expect(
      BannerAiPromptRefV1Schema.safeParse({
        id: 'scene-analysis-v1',
        version: 2,
        contentSha256: SCENE_ANALYSIS_PROMPT_V1.contentSha256,
      }).success,
    ).toBe(false);
    expect(
      BannerAiPromptRefV1Schema.safeParse({
        id: 'scene-analysis-v1',
        version: 1,
      }).success,
    ).toBe(false);
    expect(
      BannerAiPromptRefV1Schema.safeParse({
        ...canonicalBannerAiPromptRef('scene-analysis-v1'),
        foreignField: true,
      }).success,
    ).toBe(false);
  });
});

describe('strict provider-neutral AI contracts', () => {
  it('rejects missing, unknown, stale, foreign, and request-mismatched values', () => {
    const request = benchmarkRequest();
    const success = fakeAdapter().invoke(request, 'success');

    const missing = structuredClone(request) as Record<string, unknown>;
    delete (missing['input'] as Record<string, unknown>)['options'];
    expect(SceneAnalysisModelRequestV1Schema.safeParse(missing).success).toBe(false);

    expect(
      SceneAnalysisModelRequestV1Schema.safeParse({ ...request, foreignField: true }).success,
    ).toBe(false);
    expect(
      SceneAnalysisModelInvocationV1Schema.safeParse({ ...success, foreignField: true }).success,
    ).toBe(false);

    const staleWorkflowInput = {
      ...ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1.input,
      workflow: {
        ...ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1.input.workflow,
        workflowVersion: 2,
        definitionSha256: 'f'.repeat(64),
      },
    };
    expect(() =>
      createSceneAnalysisModelRequestV1({
        requestId: ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1.requestId,
        modelInput: staleWorkflowInput,
      }),
    ).toThrow();

    const foreignModelResult = mutableClone(success);
    foreignModelResult.metadata.model.identity.providerKey =
      ProviderKeySchema.parse('foreign-fixture');
    expect(() =>
      validateSceneAnalysisInvocationForRequestV1({
        request,
        invocation: foreignModelResult,
      }),
    ).toThrow(/identity differs/i);

    const foreignModelVersion = mutableClone(success);
    foreignModelVersion.metadata.model.identity.modelVersion = 2;
    expect(() =>
      validateSceneAnalysisInvocationForRequestV1({
        request,
        invocation: foreignModelVersion,
      }),
    ).toThrow(/identity differs/i);

    const mismatchedRequestIdentity = mutableClone(success);
    mismatchedRequestIdentity.metadata.requestIdentity.requestId = RequestIdSchema.parse(
      'benchmark.angel-local-png-v1:foreign',
    );
    expect(() =>
      validateSceneAnalysisInvocationForRequestV1({
        request,
        invocation: mismatchedRequestIdentity,
      }),
    ).toThrow(/identity differs/i);

    const mismatchedSource = mutableClone(success);
    if (mismatchedSource.kind !== 'success') throw new TypeError('Expected success fixture.');
    mismatchedSource.output.sourceAssetSha256 = Sha256HexSchema.parse('e'.repeat(64));
    expect(() =>
      validateSceneAnalysisInvocationForRequestV1({ request, invocation: mismatchedSource }),
    ).toThrow(/source digest/i);
  });

  it('binds background-fill, segmentation-mask, and animation requests to exact inputs', () => {
    const sourceAsset = ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1.input.sourceAsset;
    const fillModel = AiModelContractV1Schema.parse({
      identity: {
        identityVersion: 1,
        providerKey: 'benchmark-fixture',
        modelKey: 'background-fill-fixture',
        modelVersion: 1,
        external: false,
      },
      capabilities: { capabilitiesVersion: 1, capabilities: ['background_fill'] },
    });
    const mask = SegmentationMaskReferenceV1Schema.parse({
      referenceVersion: 1,
      segmentationId: 'segment_angel_background',
      sourceAssetSha256: sourceAsset.sha256,
      maskAsset: {
        ...sourceAsset,
        assetId: 'asset_mask_angel_background',
        assetVersionId: 'version_mask_angel_background',
        sha256: 'd'.repeat(64),
      },
      coordinateSpace: {
        pixelWidth: sourceAsset.pixelWidth,
        pixelHeight: sourceAsset.pixelHeight,
      },
      maskSemantics: 'inpaint-region',
      producer: fillModel.identity,
    });
    const fillInput = BackgroundFillModelInputV1Schema.parse({
      inputVersion: 1,
      sourceAsset,
      mask,
      instructions: 'Continue the existing background through the masked region.',
      output: { pixelWidth: 12, pixelHeight: 8 },
      model: fillModel,
      prompt: canonicalBannerAiPromptRef(BACKGROUND_FILL_PROMPT_V1.id),
      workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
    });
    const fillRequest = {
      requestVersion: 1,
      requestIdentity: {
        identityVersion: 1,
        requestId: 'benchmark.background-fill:request',
        inputDigest: backgroundFillModelInputDigestV1(fillInput),
      },
      input: fillInput,
    };
    expect(BackgroundFillModelRequestV1Schema.safeParse(fillRequest).success).toBe(true);
    expect(
      BackgroundFillModelRequestV1Schema.safeParse({ ...fillRequest, unknown: true }).success,
    ).toBe(false);

    const animationModel = AiModelContractV1Schema.parse({
      identity: {
        identityVersion: 1,
        providerKey: 'benchmark-fixture',
        modelKey: 'animation-plan-fixture',
        modelVersion: 1,
        external: false,
      },
      capabilities: {
        capabilitiesVersion: 1,
        capabilities: ['animation_planning', 'structured_output'],
      },
    });
    if (ANGEL_PROVIDER_FREE_SCENE_PROPOSAL_V1.kind !== 'composition_proposal') {
      throw new TypeError('Expected canonical Angel composition proposal.');
    }
    const animationInput = AnimationPlanModelInputV1Schema.parse({
      inputVersion: 1,
      sourceAssetSha256: sourceAsset.sha256,
      canvas: { pixelWidth: 12, pixelHeight: 8 },
      layerProposals: ANGEL_PROVIDER_FREE_SCENE_PROPOSAL_V1.parts,
      options: { durationMs: 3_000, maxTracks: 4, preserveVisibleText: true },
      model: animationModel,
      prompt: canonicalBannerAiPromptRef('animation-plan-v1'),
      workflow: INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1,
    });
    const animationRequest = {
      requestVersion: 1,
      requestIdentity: {
        identityVersion: 1,
        requestId: 'benchmark.animation-plan:request',
        inputDigest: animationPlanModelInputDigestV1(animationInput),
      },
      input: animationInput,
    };
    expect(AnimationPlanModelRequestV1Schema.safeParse(animationRequest).success).toBe(true);

    const wrongDigest = mutableClone(animationRequest);
    wrongDigest.requestIdentity.inputDigest.sha256 = AiInputSha256Schema.parse('c'.repeat(64));
    expect(AnimationPlanModelRequestV1Schema.safeParse(wrongDigest).success).toBe(false);
  });
});

describe('deterministic benchmark input identity and fixture adapter', () => {
  it('uses exactly one logical 12x8 normalized repository fixture case', () => {
    expect(BANNER_AI_BENCHMARK_CASES_V1).toHaveLength(1);
    expect(ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1.input.fixture).toEqual({
      referenceVersion: 1,
      kind: 'repository-fixture',
      repositoryPath: 'apps/web/src/server/banner-ai/raster.test-fixtures.ts',
      exportName: 'createRasterFile',
      variant: 'png',
      normalization: 'canonical-raster-upload-v1',
    });
    expect(ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1.input.sourceAsset).toMatchObject({
      pixelWidth: 12,
      pixelHeight: 8,
      byteSize: 77,
      sha256: '16767d791c8b19501eb071b51c3ee56f0bbfe3139b0cd39c38e3deef6528dd4f',
    });
    expect(ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1.expectedLayers).toHaveLength(4);
    expect(
      BannerAiBenchmarkCaseV1Schema.safeParse(ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1).success,
    ).toBe(true);
  });

  it('derives request-relative digests from the full validated model input', () => {
    const baseline = ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1.inputDigest;
    expect(baseline).toEqual(
      sceneAnalysisModelInputDigestV1(ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1.input),
    );
    expect(baseline.sha256).not.toBe(
      ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1.input.sourceAsset.sha256,
    );

    const changedOptions = mutableClone(ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1.input);
    changedOptions.options.maxParts = 5;
    expect(sceneAnalysisModelInputDigestV1(changedOptions).sha256).not.toBe(baseline.sha256);

    const changedFixture = mutableClone(ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1.input);
    changedFixture.fixture.variant = 'jpeg';
    expect(sceneAnalysisModelInputDigestV1(changedFixture).sha256).not.toBe(baseline.sha256);

    const rubricOnly = {
      ...ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1,
      status: 'accepted' as const,
      qualityReviewFlags: ['ocr-not-required'] as const,
    };
    expect(sceneAnalysisModelInputDigestV1(rubricOnly.input)).toEqual(baseline);
  });

  it('returns the exact existing Angel proposal and fully deterministic metadata', () => {
    const request = benchmarkRequest();
    const adapter = fakeAdapter();
    const first = adapter.invoke(request, 'success');
    const second = adapter.invoke(request, 'success');

    expect(adapter.networkAccess).toBe('disabled');
    expect(first).toEqual(second);
    expect(first.kind).toBe('success');
    if (first.kind !== 'success') throw new TypeError('Expected success fixture.');
    if (first.output.kind !== 'composition_proposal') {
      throw new TypeError('Expected composition proposal fixture.');
    }
    expect(first.output).toEqual(ANGEL_PROVIDER_FREE_SCENE_PROPOSAL_V1);
    expect(first.output.parts.map((part) => [part.partKey, part.label, part.role])).toEqual([
      ['background', 'Background', 'background'],
      ['angel.body', 'Angel body', 'subject'],
      ['wing.left', 'Left wing', 'decoration'],
      ['wing.right', 'Right wing', 'decoration'],
    ]);
    expect(first.metadata).toMatchObject({
      requestIdentity: request.requestIdentity,
      model: PROVIDER_FREE_FIXTURE_SCENE_MODEL_V1,
      prompt: canonicalBannerAiPromptRef('scene-analysis-v1'),
      latency: { unit: 'milliseconds', total: 17 },
      retry: { attemptCount: 1, retryCount: 0, failedAttemptCount: 0 },
    });
    expect(first.metadata.cost.estimated.total).toEqual({ currency: 'USD', micros: '0' });
    expect(first.metadata.cost.actual.total).toEqual({ currency: 'USD', micros: '0' });
  });
});

describe('pure benchmark cost and evaluation', () => {
  it('calculates every USD component and total with exact integer micros', () => {
    const pricing = BenchmarkPricingConfigV1Schema.parse({
      configVersion: 1,
      configId: 'synthetic-exact-pricing-v1',
      currency: 'USD',
      purpose: 'benchmark-only',
      productionPriceTruth: false,
      rates: {
        modelInferenceMicrosPerUnit: '2',
        segmentationComputeMicrosPerUnit: '3',
        inpaintingMicrosPerUnit: '5',
        storageMicrosPerByteMonth: '7',
        retryMicrosPerUnit: '11',
        failedAttemptMicrosPerUnit: '13',
      },
    });
    const usage = BenchmarkCostUsageV1Schema.parse({
      modelInferenceUnits: 17,
      segmentationComputeUnits: 19,
      inpaintingUnits: 23,
      storageByteMonths: 29,
      retryUnits: 31,
      failedAttemptUnits: 37,
    });
    const result = estimateBenchmarkCostV1({ pricing, usage });

    expect(
      Object.fromEntries(
        Object.entries(result.components).map(([key, value]) => [key, value.subtotal.micros]),
      ),
    ).toEqual({
      modelInference: '34',
      segmentationCompute: '57',
      inpainting: '115',
      storage: '203',
      retries: '341',
      failedAttempts: '481',
    });
    expect(result.total).toEqual({ currency: 'USD', micros: '1231' });

    const corrupt = mutableClone(result);
    corrupt.total.micros = CanonicalMicrosStringSchema.parse('1232');
    expect(BenchmarkCostBreakdownV1Schema.safeParse(corrupt).success).toBe(false);
  });

  it('keeps cost values runtime-distinct from workflow, prompt, and input digests', () => {
    const request = benchmarkRequest();
    const success = fakeAdapter().invoke(request, 'success');
    const estimated = success.metadata.cost.estimated;

    expect(AiInputDigestV1Schema.safeParse(estimated.total).success).toBe(false);
    expect(UsdMicrosAmountV1Schema.safeParse(request.requestIdentity.inputDigest).success).toBe(
      false,
    );
    expect(Sha256HexSchema.safeParse(estimated).success).toBe(false);
    expect(
      BenchmarkCostBreakdownV1Schema.safeParse(
        INITIAL_BANNER_ANALYZE_WORKFLOW_REF_V1.definitionSha256,
      ).success,
    ).toBe(false);
    expect(UsdMicrosAmountV1Schema.safeParse(SCENE_ANALYSIS_PROMPT_V1.contentSha256).success).toBe(
      false,
    );
  });

  it('classifies malformed output and timeout separately with fixed metrics', () => {
    const request = benchmarkRequest();
    const adapter = fakeAdapter();
    const malformed = adapter.invoke(request, 'malformed-output');
    const timedOut = adapter.invoke(request, 'timeout');
    expect(timedOut.metadata.cost.actual.components).toMatchObject({
      modelInference: { usageUnits: 3 },
      retries: { usageUnits: 2 },
      failedAttempts: { usageUnits: 3 },
    });

    const malformedReport = evaluateBannerAiBenchmarkCaseV1({
      benchmarkCase: ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1,
      primaryInvocation: malformed,
      reproducibilityInvocation: malformed,
    });
    expect(malformedReport).toMatchObject({
      classification: 'malformed-output',
      pass: false,
      latencyMs: 23,
      retryCount: 0,
      schemaValidity: {
        primary: { structural: true, contextual: true, structuredOutput: 'invalid' },
      },
    });

    const timeoutReport = evaluateBannerAiBenchmarkCaseV1({
      benchmarkCase: ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1,
      primaryInvocation: timedOut,
      reproducibilityInvocation: timedOut,
    });
    expect(timeoutReport).toMatchObject({
      classification: 'timeout',
      pass: false,
      latencyMs: 60_000,
      retryCount: 2,
      schemaValidity: {
        primary: { structural: true, contextual: true, structuredOutput: 'not-returned' },
      },
    });
  });

  it('produces reproducible passing evaluations and deterministic layer flags', () => {
    const request = benchmarkRequest();
    const adapter = fakeAdapter();
    const primary = adapter.invoke(request, 'success');
    const replay = adapter.invoke(request, 'success');
    const input = {
      benchmarkCase: ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1,
      primaryInvocation: primary,
      reproducibilityInvocation: replay,
    };
    const first = evaluateBannerAiBenchmarkCaseV1(input);
    const second = evaluateBannerAiBenchmarkCaseV1(input);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      classification: 'pass',
      pass: true,
      deterministicReproducibility: true,
      textPreservation: 'not-applicable',
      latencyMs: 17,
      retryCount: 0,
      layerAgreement: {
        expectedCount: 4,
        actualCount: 4,
        countMatches: true,
        roleAgreement: true,
        rubricAgreement: true,
        missingLayerKeys: [],
        extraLayerKeys: [],
      },
      cost: { totalsMatch: true },
    });

    const changed = mutableClone(primary);
    if (changed.kind !== 'success' || changed.output.kind !== 'composition_proposal') {
      throw new TypeError('Expected proposal fixture.');
    }
    changed.output.parts[3] = {
      ...changed.output.parts[3]!,
      partKey: OutputKeySchema.parse('extra.cloud'),
      label: 'Cloud',
      role: 'other',
    };
    const failed = evaluateBannerAiBenchmarkCaseV1({
      benchmarkCase: ANGEL_PROVIDER_FREE_BENCHMARK_CASE_V1,
      primaryInvocation: changed,
      reproducibilityInvocation: changed,
    });
    expect(failed.classification).toBe('quality-failed');
    expect(failed.layerAgreement).toMatchObject({
      missingLayerKeys: ['wing.right'],
      extraLayerKeys: ['extra.cloud'],
      hasMissingLayers: true,
      hasExtraLayers: true,
    });
  });
});

describe('provider-free dependency boundary', () => {
  it('contains no provider SDK, network primitive, or forbidden dependency', () => {
    const packageRoot = fileURLToPath(new URL('..', import.meta.url));
    const sourceRoot = join(packageRoot, 'src');
    const collectTypeScript = (directory: string): readonly string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return collectTypeScript(path);
        return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
      });
    const source = collectTypeScript(sourceRoot)
      .toSorted()
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
    const packageJson = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      readonly dependencies?: Readonly<Record<string, string>>;
      readonly devDependencies?: Readonly<Record<string, string>>;
    };
    const dependencyNames = [
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
    ];
    const forbiddenDependencyPrefixes = [
      'openai',
      '@anthropic-ai',
      '@google',
      '@ai-sdk/google',
      'google-generative-ai',
      'runpod',
      '@runpod',
      'black-forest-labs',
      '@black-forest-labs',
      'bfl',
      '@bfl',
      'replicate',
      'undici',
    ];

    expect(
      dependencyNames.filter((name) =>
        forbiddenDependencyPrefixes.some(
          (prefix) => name === prefix || name.startsWith(`${prefix}/`),
        ),
      ),
    ).toEqual([]);
    expect(source).not.toMatch(
      /from\s+['"](?:node:)?(?:http|https|http2|net|dns|dgram|tls)(?:\/[^'"]*)?['"]|\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/u,
    );
    for (const dependency of forbiddenDependencyPrefixes) {
      expect(source).not.toContain(`from '${dependency}'`);
      expect(source).not.toContain(`from "${dependency}"`);
      expect(source).not.toContain(`import('${dependency}')`);
    }
  });
});
