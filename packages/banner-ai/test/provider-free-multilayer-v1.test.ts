import { describe, expect, it } from 'vitest';

import {
  createGentleFloatTrackV1,
  gentleFloatTrackIdForLayerV1,
} from '../src/editor/provider-free-banner-scene-v1.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  createDeterministicUploadedBannerSamGenerator,
  generateUploadedBannerSamCandidates,
} from '../src/server/uploaded-banner-sam-operation-v1.js';
import { materializeUploadedBannerOperationProjectV1 } from '../src/editor/provider-free-fixture-materializer-v1.js';

const source = new Uint8Array(
  readFileSync(
    resolve(import.meta.dirname, 'fixtures/real-model-benchmark/normalized/banner-no-text-v1.png'),
  ),
);

describe('uploaded multi-layer editor contracts', () => {
  it('derives bounded independent tracks for two uploaded layers', () => {
    const first = 'layer_uploaded_cutout_aaaaaaaaaaaaaaaaaaaaaaaa' as never;
    const second = 'layer_uploaded_cutout_bbbbbbbbbbbbbbbbbbbbbbbb' as never;
    const tracks = [createGentleFloatTrackV1(first), createGentleFloatTrackV1(second)].sort(
      (a, b) => a.targetLayerId.localeCompare(b.targetLayerId),
    );
    expect(gentleFloatTrackIdForLayerV1(first)).toHaveLength(36);
    expect(tracks.map((track) => track.targetLayerId)).toEqual([first, second].sort());
    expect(tracks.every((track) => track.id.length <= 64)).toBe(true);
  });

  it('materializes two original candidate layers in canonical order', async () => {
    const result = await generateUploadedBannerSamCandidates({
      normalizedPng: source,
      requestId: '11111111-1111-4111-8111-111111111111',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      jobId: '33333333-3333-4333-8333-333333333333',
      attemptId: '44444444-4444-4444-8444-444444444444',
      generator: createDeterministicUploadedBannerSamGenerator(),
    });
    const selected = result.candidates.slice(0, 2);
    const materialization = await materializeUploadedBannerOperationProjectV1({
      source,
      subject: selected[0]!.materialization.cutoutPng,
      candidateId: selected[0]!.candidateId,
      bounds: selected[0]!.bounds,
      subjects: selected.map((candidate) => ({
        subject: candidate.materialization.cutoutPng,
        candidateId: candidate.candidateId,
        bounds: candidate.bounds,
      })),
    });
    expect(materialization.scene.layers).toHaveLength(2);
    expect(materialization.assets).toHaveLength(3);
    expect(materialization.scene.layers.map((layer) => layer.order)).toEqual([0, 1]);
    expect(materialization.presentationParts).toHaveLength(3);
    const layerDigests = materialization.scene.layers.map((layer) => layer.asset.sha256);
    expect(new Set(layerDigests).size).toBe(2);
    expect(materialization.assets.slice(1).every((asset) => asset.bytes.byteLength > 0)).toBe(true);
  });

  it('supports one and eight bounded uploaded layers', async () => {
    const result = await generateUploadedBannerSamCandidates({
      normalizedPng: source,
      requestId: '11111111-1111-4111-8111-111111111111',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      jobId: '33333333-3333-4333-8333-333333333333',
      attemptId: '44444444-4444-4444-8444-444444444444',
      generator: createDeterministicUploadedBannerSamGenerator(),
    });
    const make = (count: number) =>
      Array.from({ length: count }, (_, index) => {
        const candidate = result.candidates[index % result.candidates.length]!;
        return {
          subject: candidate.materialization.cutoutPng,
          candidateId: `samc_v1_${String(index + 1).padStart(2, '0')}${'a'.repeat(62)}`,
          bounds: candidate.bounds,
        };
      });
    for (const count of [1, 8]) {
      const subjects = make(count);
      const materialization = await materializeUploadedBannerOperationProjectV1({
        source,
        subject: subjects[0]!.subject,
        candidateId: subjects[0]!.candidateId,
        bounds: subjects[0]!.bounds,
        subjects,
      });
      expect(materialization.scene.layers).toHaveLength(count);
      expect(materialization.assets).toHaveLength(count + 1);
      expect(materialization.scene.layers.map((layer) => layer.order)).toEqual(
        Array.from({ length: count }, (_, index) => index),
      );
    }
  });
});
