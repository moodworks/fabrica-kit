import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import {
  AdmittedRealModelBenchmarkCorpusEntryV1Schema,
  BLOCKED_REAL_MODEL_BENCHMARK_PROFILE_V1,
  PROVIDER_FREE_COMPOSITION_POLICY,
  TextObservationV1Schema,
  canonicalizeJson,
  createModelProducedActualTextObservationSetV1,
  createProviderFreeFakeSceneAnalysisAdapterV1,
  dispatchProviderFreeCapability,
  evaluateRealModelBenchmarkOcrQualityV1,
  exactBasisPointRatioMeetsThreshold,
  exactBoundingBoxIouMeetsThreshold,
  prepareRealModelBenchmarkCallIntentV1,
} from '../src/index.js';
import {
  admittedEntryInput,
  admittedManifest,
  mutableClone,
  prepareSyntheticBenchmarkTestSources,
  recomputeAdmittedEntryEvidenceBinding,
  requestFor,
  selectedProfile,
  validGateInput,
} from './support/real-model-benchmark-test-support.js';

beforeAll(prepareSyntheticBenchmarkTestSources);

describe('real-model benchmark quality evaluation', () => {
  it('uses exact scene-layer ratios and integer-rational IoU at the threshold edge', () => {
    expect(
      exactBasisPointRatioMeetsThreshold({ numerator: 4, denominator: 5, thresholdBps: 8_000 }),
    ).toBe(true);
    expect(
      exactBasisPointRatioMeetsThreshold({ numerator: 3, denominator: 5, thresholdBps: 8_000 }),
    ).toBe(false);
    const left = {
      unit: 'normalized-basis-points' as const,
      xBps: 1_000,
      yBps: 1_000,
      widthBps: 1_000,
      heightBps: 1_000,
    };
    expect(
      exactBoundingBoxIouMeetsThreshold({
        left,
        right: { ...left, xBps: 1_176 },
        thresholdBps: 7_000,
      }),
    ).toBe(true);
    expect(
      exactBoundingBoxIouMeetsThreshold({
        left,
        right: { ...left, xBps: 1_177 },
        thresholdBps: 7_000,
      }),
    ).toBe(false);
  });

  it('preserves duplicate text multiplicity, deterministic bbox matches, and no-text strictness', () => {
    const expected = [
      {
        oracleOccurrenceId: 'oracle.duplicate.1',
        normalizedText: 'Duplicate synthetic text',
        boundingBox: {
          unit: 'normalized-basis-points' as const,
          xBps: 1_000,
          yBps: 1_000,
          widthBps: 2_000,
          heightBps: 500,
        },
      },
      {
        oracleOccurrenceId: 'oracle.duplicate.2',
        normalizedText: 'Duplicate synthetic text',
        boundingBox: {
          unit: 'normalized-basis-points' as const,
          xBps: 5_000,
          yBps: 5_000,
          widthBps: 2_000,
          heightBps: 500,
        },
      },
    ];
    const actualObservation = (
      observationId: string,
      boundingBox: (typeof expected)[number]['boundingBox'],
    ) =>
      TextObservationV1Schema.parse({
        observationVersion: 1,
        observationId,
        text: {
          kind: 'observed-text',
          value: 'Duplicate synthetic text',
          normalization: 'unicode-nfc-single-space-v1',
          contentTrust: 'untrusted-user-image-content',
          instructionAuthority: 'none',
        },
        boundingBox,
        confidence: { unit: 'basis-points', valueBps: 1 },
      });
    const actual = [
      actualObservation('actual_duplicate_2', expected[1]!.boundingBox),
      actualObservation('actual_duplicate_1', expected[0]!.boundingBox),
    ];
    const profile = selectedProfile();
    const entryInput = admittedEntryInput(1, 'mixed-subject-copy');
    entryInput.expectedOracle.expectedTextOccurrences = expected;
    const entry = AdmittedRealModelBenchmarkCorpusEntryV1Schema.parse(
      recomputeAdmittedEntryEvidenceBinding(entryInput),
    );
    const request = requestFor(profile, entry);
    const actualObservationSet = createModelProducedActualTextObservationSetV1({
      request,
      observations: actual,
    });
    expect(
      evaluateRealModelBenchmarkOcrQualityV1({
        admittedEntry: entry,
        request,
        actualObservationSet,
      }),
    ).toMatchObject({
      textIntersectionCount: 2,
      bboxMatchedOccurrenceCount: 2,
      precisionPass: true,
      recallPass: true,
      boundingBoxesPass: true,
      pass: true,
      modelConfidenceUsedAsOracle: false,
    });
    expect(
      evaluateRealModelBenchmarkOcrQualityV1({
        admittedEntry: entry,
        request,
        actualObservationSet: createModelProducedActualTextObservationSetV1({
          request,
          observations: actual.slice(0, 1),
        }),
      }).pass,
    ).toBe(false);

    const noTextEntry = admittedManifest().entries[2]!;
    const noTextRequest = requestFor(profile, noTextEntry);
    expect(
      evaluateRealModelBenchmarkOcrQualityV1({
        admittedEntry: noTextEntry,
        request: noTextRequest,
        actualObservationSet: createModelProducedActualTextObservationSetV1({
          request: noTextRequest,
          observations: [],
        }),
      }).pass,
    ).toBe(true);
    expect(
      evaluateRealModelBenchmarkOcrQualityV1({
        admittedEntry: noTextEntry,
        request: noTextRequest,
        actualObservationSet: createModelProducedActualTextObservationSetV1({
          request: noTextRequest,
          observations: actual.slice(0, 1),
        }),
      }).pass,
    ).toBe(false);
  });

  it('rejects missing, stale, foreign, or cross-role provenance before scoring', () => {
    const profile = selectedProfile();
    const entry = admittedManifest().entries[0]!;
    const request = requestFor(profile, entry);
    const actual = createModelProducedActualTextObservationSetV1({
      request,
      observations: [],
    });
    const stale = mutableClone(actual);
    stale.provenance.sourceAssetSha256 = 'f'.repeat(64) as never;
    expect(() =>
      evaluateRealModelBenchmarkOcrQualityV1({
        admittedEntry: entry,
        request,
        actualObservationSet: stale,
      }),
    ).toThrow(/provenance/i);

    const missing = mutableClone(actual) as unknown as { provenance: Record<string, unknown> };
    delete missing.provenance.requestIdentity;
    expect(() =>
      evaluateRealModelBenchmarkOcrQualityV1({
        admittedEntry: entry,
        request,
        actualObservationSet: missing,
      }),
    ).toThrow();
    expect(() =>
      evaluateRealModelBenchmarkOcrQualityV1({
        admittedEntry: entry,
        request,
        actualObservationSet: entry.expectedOracle,
      }),
    ).toThrow();

    const foreignRequest = requestFor(profile, admittedManifest().entries[1]!);
    expect(() =>
      evaluateRealModelBenchmarkOcrQualityV1({
        admittedEntry: entry,
        request: foreignRequest,
        actualObservationSet: actual,
      }),
    ).toThrow(/source or fixture/i);
  });
});

describe('provider-free and web isolation', () => {
  it('keeps the inert intent outside the current provider-free adapter trust set', async () => {
    const intent = prepareRealModelBenchmarkCallIntentV1(validGateInput());
    await expect(
      dispatchProviderFreeCapability({
        policy: PROVIDER_FREE_COMPOSITION_POLICY,
        execution: intent as never,
      }),
    ).rejects.toThrow(/not materialized/i);
    expect(() =>
      createProviderFreeFakeSceneAnalysisAdapterV1().invoke(intent as never, 'success'),
    ).toThrow();
  });

  it('contains no provider SDK/network primitive and gives no web route an activation import', () => {
    const packageRoot = fileURLToPath(new URL('..', import.meta.url));
    const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
    const collectTypeScript = (directory: string): readonly string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return collectTypeScript(path);
        return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
      });
    const source = collectTypeScript(join(packageRoot, 'src'))
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
    expect(
      dependencyNames.filter((name) =>
        ['openai', '@anthropic-ai', '@google', 'replicate', 'undici'].some(
          (prefix) => name === prefix || name.startsWith(`${prefix}/`),
        ),
      ),
    ).toEqual([]);
    expect(source).not.toMatch(
      /from\s+['"](?:node:)?(?:http|https|http2|net|dns|dgram|tls)(?:\/[^'"]*)?['"]|\b(?:fetch|WebSocket|XMLHttpRequest)\s*\(/u,
    );

    const routes = collectTypeScript(join(repositoryRoot, 'apps/web/src')).filter((path) =>
      path.endsWith('/route.ts'),
    );
    expect(routes.length).toBeGreaterThan(0);
    for (const routePath of routes) {
      const route = readFileSync(routePath, 'utf8');
      expect(route, routePath).not.toContain('real-model-benchmark-profile');
      expect(route, routePath).not.toContain('real-model-benchmark-execution');
      expect(route, routePath).not.toContain('openai-real-model-request-boundary');
      expect(route, routePath).not.toContain('real-model-benchmark-corpus-loader');
      expect(route, routePath).not.toContain('prepareRealModelBenchmarkCallIntentV1');
      expect(route, routePath).not.toContain('OPENAI_API_KEY');
    }
    expect(canonicalizeJson(BLOCKED_REAL_MODEL_BENCHMARK_PROFILE_V1)).not.toContain(
      'synthetic-provider.invalid',
    );
  });
});
