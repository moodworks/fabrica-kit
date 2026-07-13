import { z } from 'zod';

import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import { byteSourceFrom, normalizeRasterUpload } from '../security/raster-upload.js';
import {
  RepositoryFixtureInputRefV1Schema,
  SceneAnalysisModelRequestV1Schema,
  type AiModelRequestIdentityV1,
  type RepositoryFixtureInputRefV1,
  type SceneAnalysisModelRequestV1,
} from './ai-contracts.js';

const angelPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAwAAAAICAYAAADN5B7xAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAFklEQVQYlWOQc+v5TwpmGNXgRoNQAgCcm7mh+9cD/gAAAABJRU5ErkJggg==';

const angelJpegBase64 =
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAwDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIcAaK3/2Q==';

const fixtureRepositoryPath = 'packages/banner-ai/src/evaluation/repository-benchmark-fixture.ts';
const fixtureExportName = 'createAngelBenchmarkFixtureSourceV1';

const angelFixtureReference = (variant: 'jpeg' | 'png'): RepositoryFixtureInputRefV1 =>
  RepositoryFixtureInputRefV1Schema.parse({
    referenceVersion: 1,
    kind: 'repository-fixture',
    repositoryPath: fixtureRepositoryPath,
    exportName: fixtureExportName,
    variant,
    normalization: 'canonical-raster-upload-v1',
  });

export const ANGEL_PROVIDER_FREE_FIXTURE_INPUT_REF_V1 = angelFixtureReference('png');

export interface TrustedBenchmarkFixtureSourceV1 {
  readonly sourceVersion: 1;
  readonly reference: RepositoryFixtureInputRefV1;
  readonly filename: string;
  readonly declaredMediaType: 'image/jpeg' | 'image/png';
  readonly bytes: Buffer;
}

export const createAngelBenchmarkFixtureSourceV1 = (
  variant: 'jpeg' | 'png',
): TrustedBenchmarkFixtureSourceV1 => {
  const png = variant === 'png';
  return Object.freeze({
    sourceVersion: 1 as const,
    reference: angelFixtureReference(variant),
    filename: png ? 'angel.png' : 'angel.jpeg',
    declaredMediaType: png ? ('image/png' as const) : ('image/jpeg' as const),
    bytes: Buffer.from(png ? angelPngBase64 : angelJpegBase64, 'base64'),
  });
};

export interface VerifiedRepositoryBenchmarkFixtureV1 {
  readonly verificationVersion: 1;
  readonly request: SceneAnalysisModelRequestV1;
  readonly requestIdentity: AiModelRequestIdentityV1;
  readonly reference: RepositoryFixtureInputRefV1;
  readonly normalized: {
    readonly byteSize: number;
    readonly bytes: Uint8Array;
    readonly height: number;
    readonly mediaType: 'image/png';
    readonly sha256: string;
    readonly sourceMediaType: 'image/jpeg' | 'image/png';
    readonly width: number;
  };
}

const referenceKey = (reference: RepositoryFixtureInputRefV1): string =>
  canonicalizeJson(reference);

const resolveAllowlistedFixture = (
  reference: RepositoryFixtureInputRefV1,
): TrustedBenchmarkFixtureSourceV1 => {
  if (referenceKey(reference) !== referenceKey(ANGEL_PROVIDER_FREE_FIXTURE_INPUT_REF_V1)) {
    throw new TypeError('Benchmark fixture reference is stale, foreign, or not allowlisted.');
  }
  return createAngelBenchmarkFixtureSourceV1('png');
};

export const loadVerifiedRepositoryBenchmarkFixtureV1 = async (input: {
  readonly request: unknown;
  readonly fixtureReferences: readonly unknown[];
}): Promise<VerifiedRepositoryBenchmarkFixtureV1> => {
  const request = SceneAnalysisModelRequestV1Schema.parse(input.request);
  const rawReferences = z.array(z.unknown()).max(32).parse(input.fixtureReferences);
  if (rawReferences.length === 0) {
    throw new TypeError('The request-relative benchmark fixture reference is missing.');
  }
  const references = rawReferences.map((reference) =>
    RepositoryFixtureInputRefV1Schema.parse(reference),
  );
  const keys = references.map(referenceKey);
  if (new Set(keys).size !== keys.length) {
    throw new TypeError('Duplicate benchmark fixture references are not accepted.');
  }
  const requestedKey = referenceKey(request.input.fixture);
  const matches = references.filter((reference) => referenceKey(reference) === requestedKey);
  if (matches.length !== 1 || references.length !== 1) {
    throw new TypeError('Exactly one request-relative benchmark fixture reference is required.');
  }

  const reference = matches[0]!;
  const source = resolveAllowlistedFixture(reference);
  if (
    referenceKey(source.reference) !== requestedKey ||
    source.filename !== 'angel.png' ||
    source.declaredMediaType !== 'image/png'
  ) {
    throw new TypeError('Allowlisted benchmark fixture source identity drifted.');
  }

  const normalized = await normalizeRasterUpload({
    bytes: byteSourceFrom(source.bytes),
    declaredMediaType: source.declaredMediaType,
    filename: source.filename,
  });
  const pinned = request.input.sourceAsset;
  if (
    normalized.sourceMediaType !== source.declaredMediaType ||
    normalized.mediaType !== pinned.mediaType ||
    normalized.bytes.byteLength !== normalized.byteSize ||
    normalized.byteSize !== pinned.byteSize ||
    normalized.width !== pinned.pixelWidth ||
    normalized.height !== pinned.pixelHeight ||
    normalized.sha256 !== pinned.sha256
  ) {
    throw new TypeError(
      'Normalized benchmark fixture bytes, type, dimensions, or SHA-256 differ from pinned request metadata.',
    );
  }

  return Object.freeze({
    verificationVersion: 1 as const,
    request,
    requestIdentity: request.requestIdentity,
    reference,
    normalized: Object.freeze({
      byteSize: normalized.byteSize,
      bytes: Uint8Array.from(normalized.bytes),
      height: normalized.height,
      mediaType: normalized.mediaType,
      sha256: normalized.sha256,
      sourceMediaType: normalized.sourceMediaType,
      width: normalized.width,
    }),
  });
};
