import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, beforeEach, vi } from 'vitest';

import {
  createActorId,
  createActorWorkspaceContext,
  createRequestId,
  createWorkspaceId,
} from '@fabrica/banner-ai';
import {
  SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
  createDeterministicSamRunPodDirectV3Transport,
} from '../../../../../packages/banner-ai/src/server/sam-runpod-direct-v3-deterministic-fake-transport';
import { createSamRunPodDirectV3Adapter } from '../../../../../packages/banner-ai/src/server/sam-runpod-direct-v3-adapter';
import {
  createDeterministicUploadedBannerSamGenerator,
  generateUploadedBannerSamCandidates,
} from '../../../../../packages/banner-ai/src/server/uploaded-banner-sam-operation-v1';
import { SamReplayError } from '../../../../../packages/banner-ai/src/server/uploaded-banner-sam-replay-v4';
import { sha256Hex } from '../../../../../packages/banner-ai/src/scene/canonical-scene-json';

import {
  createUploadedBannerOperation,
  resetUploadedBannerOperationRegistryForTests,
  resolveUploadedBannerCandidate,
  openUploadedBannerProject,
  createUploadedBannerPreview,
  createUploadedBannerExport,
  composeUploadedBannerOperation,
  materializeUploadedSourceRegion,
  promptUploadedBannerOperation,
} from './uploaded-banner-operation';
import { createDeterministicNonRectangularSamBoxPromptAdapter } from '../../../../../packages/banner-ai/src/server/sam-box-prompt-layer-extraction';
import {
  isProviderFreeLayerIdV1,
  mutateProviderFreeBannerSceneV1,
} from '../../../../../packages/banner-ai/src/editor/provider-free-banner-scene-v1';

const source = new Uint8Array(
  readFileSync(
    resolve(
      import.meta.dirname,
      '../../../../../packages/banner-ai/test/fixtures/real-model-benchmark/normalized/banner-no-text-v1.png',
    ),
  ),
);
const authority = (workspaceId = createWorkspaceId('uploaded_test_workspace')) =>
  createActorWorkspaceContext({
    actorId: createActorId('uploaded-test-actor'),
    workspaceId,
    requestId: createRequestId('uploaded-test-request'),
  });

describe('uploaded banner operation registry', () => {
  it('crops a trusted source region with exact requested dimensions and rejects bounds drift', async () => {
    const cropped = await materializeUploadedSourceRegion({
      source,
      crop: { left: 3, top: 4, width: 20, height: 15 },
      sourceWidth: 876,
      sourceHeight: 221,
    });
    expect(cropped.byteLength).toBeGreaterThan(0);
    await expect(
      materializeUploadedSourceRegion({
        source,
        crop: { left: 870, top: 0, width: 20, height: 10 },
        sourceWidth: 876,
        sourceHeight: 221,
      }),
    ).rejects.toThrow();
  });
  beforeEach(() => resetUploadedBannerOperationRegistryForTests());

  it('requires authorization before reading or dispatching an uploaded operation', async () => {
    await expect(
      createUploadedBannerOperation({
        file: new File([source], 'banner.png', { type: 'image/png' }),
        authority: authority(),
      }),
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_REQUIRED' });
  });

  it('binds the operation to the creating workspace and rejects foreign access', async () => {
    const transport = createDeterministicSamRunPodDirectV3Transport();
    const generator = createSamRunPodDirectV3Adapter({
      endpointId: 'fabrica-uploaded-banner-v1',
      expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
      transport,
    });
    const owner = authority();
    const created = await createUploadedBannerOperation({
      file: new File([source], 'banner.png', { type: 'image/png' }),
      authority: owner,
      generator,
    });
    expect(created.operationId).toMatch(/^[0-9a-f]{64}$/u);
    expect(transport.getCallCount()).toBe(1);
    const candidateId = created.catalog[0]!.candidateId;
    expect(() =>
      resolveUploadedBannerCandidate(
        created.operationId,
        candidateId,
        authority(createWorkspaceId('foreign_workspace')),
      ),
    ).toThrow(/foreign/u);
    expect(() => resolveUploadedBannerCandidate('0'.repeat(64), candidateId, owner)).toThrow(
      /unknown/u,
    );
  });

  it('replaces the previous single registry entry and rejects the replaced operation', async () => {
    const transport = createDeterministicSamRunPodDirectV3Transport();
    const generator = createSamRunPodDirectV3Adapter({
      endpointId: 'fabrica-uploaded-banner-v1',
      expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
      transport,
    });
    const owner = authority();
    const first = await createUploadedBannerOperation({
      file: new File([source], 'one.png', { type: 'image/png' }),
      authority: owner,
      generator,
    });
    const second = await createUploadedBannerOperation({
      file: new File([source], 'two.png', { type: 'image/png' }),
      authority: owner,
      generator,
    });
    expect(second.operationId).not.toBe(first.operationId);
    expect(() =>
      resolveUploadedBannerCandidate(first.operationId, first.catalog[0]!.candidateId, owner),
    ).toThrow(/unknown/u);
  });

  it('opens the exact candidate and produces deterministic preview/export from its operation', async () => {
    const transport = createDeterministicSamRunPodDirectV3Transport();
    const generator = createSamRunPodDirectV3Adapter({
      endpointId: 'fabrica-uploaded-banner-v1',
      expectedExecutionIdentity: SAM_DETERMINISTIC_DIRECT_FAKE_IDENTITY,
      transport,
    });
    const owner = authority();
    const created = await createUploadedBannerOperation({
      file: new File([source], 'banner.png', { type: 'image/png' }),
      authority: owner,
      generator,
    });
    const opened = await openUploadedBannerProject({
      operationId: created.operationId,
      candidateId: created.catalog[0]!.candidateId,
      authority: owner,
    });
    const revision = opened.materialization.project.revisions.at(-1)!;
    const identity = {
      operationId: created.operationId,
      candidateId: created.catalog[0]!.candidateId,
      project: opened.materialization.project,
      revision: revision.revision,
      sceneSha256: revision.sceneSha256,
      sceneVersionId: revision.sceneVersionId,
      authority: owner,
    };
    const preview = await createUploadedBannerPreview({ ...identity, nonce: 'a'.repeat(32) });
    const exported = await createUploadedBannerExport(identity);
    expect(preview.mediaType).toBe('text/html');
    expect(exported.artifact.mediaType).toBe('application/zip');
    expect(exported.artifact.filename).toContain('uploaded-deterministic-test');
  });

  it('canonicalizes composed subjects, coalesces concurrent opens, and supports preview/export', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const owner = authority();
    const created = await createUploadedBannerOperation({
      file: new File([source], 'banner.png', { type: 'image/png' }),
      authority: owner,
      generator: createDeterministicUploadedBannerSamGenerator(),
    });
    const ids = created.catalog.slice(0, 2).map((candidate) => candidate.candidateId);
    const [forward, reverse] = await Promise.all([
      composeUploadedBannerOperation({
        operationId: created.operationId,
        candidateIds: ids,
        authority: owner,
      }),
      composeUploadedBannerOperation({
        operationId: created.operationId,
        candidateIds: ids.toReversed(),
        authority: owner,
      }),
    ]);
    expect(forward.subjectId).toBe(reverse.subjectId);
    const opened = await openUploadedBannerProject({
      operationId: created.operationId,
      candidateId: forward.subjectId,
      authority: owner,
    });
    expect(opened.materialization.scene.layers).toHaveLength(2);
    expect(opened.materialization.assets).toHaveLength(3);
    const firstLayer = opened.materialization.scene.layers[0]!;
    const secondLayer = opened.materialization.scene.layers[1]!;
    if (!isProviderFreeLayerIdV1(firstLayer.id) || !isProviderFreeLayerIdV1(secondLayer.id))
      throw new Error('expected uploaded layers');
    let animated = mutateProviderFreeBannerSceneV1(opened.materialization.scene, {
      type: 'apply_gentle_float',
      layerId: firstLayer.id,
    });
    animated = mutateProviderFreeBannerSceneV1(animated, {
      type: 'apply_gentle_float',
      layerId: secondLayer.id,
    });
    expect(animated.timeline).toHaveLength(2);
    const cleared = mutateProviderFreeBannerSceneV1(animated, {
      type: 'clear_gentle_float',
      layerId: firstLayer.id,
    });
    expect(cleared.timeline).toHaveLength(1);
    const revision = opened.materialization.project.revisions.at(-1)!;
    const identity = {
      operationId: created.operationId,
      candidateId: forward.subjectId,
      project: opened.materialization.project,
      revision: revision.revision,
      sceneSha256: revision.sceneSha256,
      sceneVersionId: revision.sceneVersionId,
      authority: owner,
    };
    await expect(
      createUploadedBannerPreview({ ...identity, nonce: 'c'.repeat(32) }),
    ).resolves.toMatchObject({ mediaType: 'text/html' });
    await expect(createUploadedBannerExport(identity)).resolves.toMatchObject({
      artifact: { mediaType: 'application/zip' },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
    await expect(
      composeUploadedBannerOperation({
        operationId: created.operationId,
        candidateIds: [],
        authority: owner,
      }),
    ).rejects.toMatchObject({ code: 'CANDIDATE_INVALID' });
    await expect(
      composeUploadedBannerOperation({
        operationId: created.operationId,
        candidateIds: Array.from({ length: 9 }, (_, index) => ids[index % ids.length]!),
        authority: owner,
      }),
    ).rejects.toMatchObject({ code: 'CANDIDATE_INVALID' });
    await expect(
      composeUploadedBannerOperation({
        operationId: created.operationId,
        candidateIds: [ids[0], ids[0]],
        authority: owner,
      }),
    ).rejects.toMatchObject({ code: 'CANDIDATE_INVALID' });
    await expect(
      composeUploadedBannerOperation({
        operationId: created.operationId,
        candidateIds: ['samc_v1_' + 'f'.repeat(64)],
        authority: owner,
      }),
    ).rejects.toMatchObject({ code: 'CANDIDATE_INVALID' });
  });

  it('rejects cumulative grouped cache over-cap and cleans the new entry', async () => {
    const owner = authority();
    const created = await createUploadedBannerOperation({
      file: new File([source], 'banner.png', { type: 'image/png' }),
      authority: owner,
      generator: createDeterministicUploadedBannerSamGenerator(),
    });
    const ids = created.catalog.slice(0, 3).map((candidate) => candidate.candidateId);
    const first = await composeUploadedBannerOperation({
      operationId: created.operationId,
      candidateIds: [],
      candidateGroups: [[ids[0]!, ids[1]!], [ids[2]!]],
      authority: owner,
    });
    for (let index = 0; index < 2_000; index += 1)
      first.operation.resolvedGrouped.set(
        `dummy-${index}`,
        first.operation.resolvedGrouped.get(first.subjectId)!,
      );
    first.operation.projectBytes.set('preloaded-project', 64 * 1024 * 1024);
    const groupedSizeBefore = first.operation.grouped.size;
    const resolvedSizeBefore = first.operation.resolvedGrouped.size;
    await expect(
      composeUploadedBannerOperation({
        operationId: created.operationId,
        candidateIds: [],
        candidateGroups: [[ids[0]!], [ids[1]!, ids[2]!]],
        authority: owner,
      }),
    ).rejects.toMatchObject({ code: 'OPERATION_INVALID' });
    expect(first.operation.grouped.size).toBe(groupedSizeBefore);
    expect(first.operation.resolvedGrouped.size).toBe(resolvedSizeBefore);
  });

  it('opens grouped layers in order and preserves composite assets through export', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const owner = authority();
    const created = await createUploadedBannerOperation({
      file: new File([source], 'banner.png', { type: 'image/png' }),
      authority: owner,
      generator: createDeterministicUploadedBannerSamGenerator(),
    });
    const ids = created.catalog.slice(0, 3).map((candidate) => candidate.candidateId);
    const first = await composeUploadedBannerOperation({
      operationId: created.operationId,
      candidateIds: [],
      candidateGroups: [[ids[0]!, ids[1]!], [ids[2]!]],
      authority: owner,
    });
    const inner = await composeUploadedBannerOperation({
      operationId: created.operationId,
      candidateIds: [],
      candidateGroups: [[ids[1]!, ids[0]!], [ids[2]!]],
      authority: owner,
    });
    const outer = await composeUploadedBannerOperation({
      operationId: created.operationId,
      candidateIds: [],
      candidateGroups: [[ids[2]!], [ids[0]!, ids[1]!]],
      authority: owner,
    });
    expect(inner.subjectId).toBe(first.subjectId);
    expect(outer.subjectId).not.toBe(first.subjectId);
    const opened = await openUploadedBannerProject({
      operationId: created.operationId,
      candidateId: first.subjectId,
      authority: owner,
    });
    expect(opened.materialization.scene.layers).toHaveLength(2);
    expect(opened.materialization.scene.layers.map((layer) => layer.name)).toEqual([
      'Uploaded layer 1',
      'Uploaded layer 2',
    ]);
    expect(opened.materialization.assets).toHaveLength(3);
    expect(opened.materialization.assets.slice(1).map((asset) => asset.reference.sha256)).toEqual(
      first.groups!.map((group) => group.candidate.materialization.metadata.cutoutPngSha256),
    );
    expect(
      opened.materialization.assets.every(
        (asset) => sha256Hex(asset.bytes) === asset.reference.sha256,
      ),
    ).toBe(true);
    expect(first.operation.grouped.size).toBe(2);
    const revision = opened.materialization.project.revisions.at(-1)!;
    const identity = {
      operationId: created.operationId,
      candidateId: first.subjectId,
      project: opened.materialization.project,
      revision: revision.revision,
      sceneSha256: revision.sceneSha256,
      sceneVersionId: revision.sceneVersionId,
      authority: owner,
    };
    await expect(
      createUploadedBannerPreview({ ...identity, nonce: 'e'.repeat(32) }),
    ).resolves.toMatchObject({ mediaType: 'text/html' });
    await expect(createUploadedBannerExport(identity)).resolves.toMatchObject({
      artifact: { mediaType: 'application/zip' },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('composes an ordered SAM group and source region as separate layers', async () => {
    const owner = authority();
    const created = await createUploadedBannerOperation({
      file: new File([source], 'banner.png', { type: 'image/png' }),
      authority: owner,
      generator: createDeterministicUploadedBannerSamGenerator(),
    });
    const ids = created.catalog.slice(0, 2).map((candidate) => candidate.candidateId);
    const mixed = await composeUploadedBannerOperation({
      operationId: created.operationId,
      candidateIds: [],
      layers: [
        { kind: 'sam-candidate-group-v1', candidateIds: ids },
        { kind: 'source-region-v1', crop: { left: 0, top: 0, width: 20, height: 15 } },
      ],
      authority: owner,
    });
    const opened = await openUploadedBannerProject({
      operationId: created.operationId,
      candidateId: mixed.subjectId,
      authority: owner,
    });
    expect(opened.materialization.scene.layers).toHaveLength(2);
    expect(opened.materialization.scene.layers.map((layer) => layer.name)).toEqual([
      'Uploaded layer 1',
      'Source region 2 · opaque crop',
    ]);
    expect(opened.materialization.assets).toHaveLength(3);
    expect(
      opened.materialization.assets.every(
        (asset) => sha256Hex(asset.bytes) === asset.reference.sha256,
      ),
    ).toBe(true);
  });

  it('rejects malformed mixed layers', async () => {
    const owner = authority();
    const created = await createUploadedBannerOperation({
      file: new File([source], 'banner.png', { type: 'image/png' }),
      authority: owner,
      generator: createDeterministicUploadedBannerSamGenerator(),
    });
    await expect(
      composeUploadedBannerOperation({
        operationId: created.operationId,
        candidateIds: [],
        layers: [],
        authority: owner,
      }),
    ).rejects.toMatchObject({ code: 'CANDIDATE_INVALID' });
    await expect(
      composeUploadedBannerOperation({
        operationId: created.operationId,
        candidateIds: [],
        layers: [{ kind: 'source-region-v1', crop: { left: 0, top: 0, width: 99999, height: 1 } }],
        authority: owner,
      }),
    ).rejects.toMatchObject({ code: 'CANDIDATE_INVALID' });
  });

  it('rolls back grouped project cache when the combined open cap is exceeded', async () => {
    const owner = authority();
    const created = await createUploadedBannerOperation({
      file: new File([source], 'banner.png', { type: 'image/png' }),
      authority: owner,
      generator: createDeterministicUploadedBannerSamGenerator(),
    });
    const ids = created.catalog.slice(0, 2).map((candidate) => candidate.candidateId);
    const grouped = await composeUploadedBannerOperation({
      operationId: created.operationId,
      candidateIds: [],
      candidateGroups: [[ids[0]!], [ids[1]!]],
      authority: owner,
    });
    grouped.operation.projectBytes.set('preloaded', 64 * 1024 * 1024);
    await expect(
      openUploadedBannerProject({
        operationId: created.operationId,
        candidateId: grouped.subjectId,
        authority: owner,
      }),
    ).rejects.toMatchObject({ code: 'OPERATION_INVALID' });
    expect(grouped.operation.projects.has(grouped.subjectId)).toBe(false);
    expect(grouped.operation.projectBytes.has(grouped.subjectId)).toBe(false);
  });

  it('replays verified candidates without network and preserves provenance through open/export', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const fake = createDeterministicUploadedBannerSamGenerator();
    const replay = async (normalizedPng: Uint8Array) => {
      const generated = await generateUploadedBannerSamCandidates({
        normalizedPng,
        requestId: '11111111-1111-4111-8111-111111111111',
        workspaceId: '22222222-2222-4222-8222-222222222222',
        jobId: '33333333-3333-4333-8333-333333333333',
        attemptId: '44444444-4444-4444-8444-444444444444',
        generator: fake,
      });
      return {
        request: generated.request,
        candidates: generated.candidates,
        provenance: 'Verified Meta SAM 2.1 cutout replay — no live call' as const,
      };
    };
    const owner = authority();
    const created = await createUploadedBannerOperation({
      file: new File([source], 'banner.png', { type: 'image/png' }),
      authority: owner,
      replay,
    });
    expect(created.catalog[0]?.provenance).toBe(
      'Verified Meta SAM 2.1 cutout replay — no live call',
    );
    const opened = await openUploadedBannerProject({
      operationId: created.operationId,
      candidateId: created.catalog[0]!.candidateId,
      authority: owner,
    });
    expect(opened.materialization.candidateId).toBe(created.catalog[0]!.candidateId);
    const resolved = resolveUploadedBannerCandidate(
      created.operationId,
      created.catalog[0]!.candidateId,
      owner,
    );
    expect(resolved.candidate.bounds).toEqual({
      xBps: created.catalog[0]!.bounds.x,
      yBps: created.catalog[0]!.bounds.y,
      widthBps: created.catalog[0]!.bounds.width,
      heightBps: created.catalog[0]!.bounds.height,
    });
    expect(resolved.candidate.materialization.cutoutPng.byteLength).toBeGreaterThan(0);
    expect(opened.materialization.assets.some((asset) => asset.bytes.byteLength > 0)).toBe(true);
    const revision = opened.materialization.project.revisions.at(-1)!;
    const identity = {
      operationId: created.operationId,
      candidateId: created.catalog[0]!.candidateId,
      project: opened.materialization.project,
      revision: revision.revision,
      sceneSha256: revision.sceneSha256,
      sceneVersionId: revision.sceneVersionId,
      authority: owner,
    };
    await createUploadedBannerPreview({ ...identity, nonce: 'b'.repeat(32) });
    const exported = await createUploadedBannerExport(identity);
    expect(exported.artifact.filename).toContain('uploaded-verified-meta-sam-replay');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('maps replay source mismatch to unsupported source', async () => {
    await expect(
      createUploadedBannerOperation({
        file: new File([source], 'banner.png', { type: 'image/png' }),
        authority: authority(),
        replay: async () => {
          throw new SamReplayError('SOURCE_MISMATCH', 'source mismatch');
        },
      }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_SOURCE' });
  });

  it('coalesces prompted crops and materializes ordered prompted/source layers', async () => {
    const owner = authority();
    const fake = createDeterministicNonRectangularSamBoxPromptAdapter();
    const created = await createUploadedBannerOperation({
      file: new File([source], 'banner.png', { type: 'image/png' }),
      authority: owner,
      generator: createDeterministicUploadedBannerSamGenerator(),
      promptedExecution: {
        generator: fake.adapter,
        expectedExecutionKind: 'deterministic-fake',
        provenance: 'Deterministic test output — NOT SAM OUTPUT',
      },
    });
    const crop = { left: 3, top: 4, width: 20, height: 15 };
    const first = await promptUploadedBannerOperation({
      operationId: created.operationId,
      crop,
      authority: owner,
    });
    const second = await promptUploadedBannerOperation({
      operationId: created.operationId,
      crop,
      authority: owner,
    });
    expect(second.promptedId).toBe(first.promptedId);
    expect(fake.getCallCount()).toBe(1);
    const mixed = await composeUploadedBannerOperation({
      operationId: created.operationId,
      candidateIds: [],
      layers: [
        { kind: 'prompted-cutout-v1', promptedId: first.promptedId },
        { kind: 'source-region-v1', crop: { left: 0, top: 0, width: 20, height: 15 } },
      ],
      authority: owner,
    });
    const opened = await openUploadedBannerProject({
      operationId: created.operationId,
      candidateId: mixed.subjectId,
      authority: owner,
    });
    expect(opened.materialization.scene.layers.map((layer) => layer.name)).toEqual([
      'Manual cutout 1',
      'Source region 2 · opaque crop',
    ]);
  });

  it('rejects unknown prompted IDs', async () => {
    const owner = authority();
    const created = await createUploadedBannerOperation({
      file: new File([source], 'banner.png', { type: 'image/png' }),
      authority: owner,
      generator: createDeterministicUploadedBannerSamGenerator(),
    });
    await expect(
      composeUploadedBannerOperation({
        operationId: created.operationId,
        candidateIds: [],
        layers: [{ kind: 'prompted-cutout-v1', promptedId: 'samp_v1_' + 'f'.repeat(64) }],
        authority: owner,
      }),
    ).rejects.toMatchObject({ code: 'CANDIDATE_INVALID' });
  });

  it('evicts failed prompted work and rolls back over-cap prompted results', async () => {
    const owner = authority();
    const fake = createDeterministicNonRectangularSamBoxPromptAdapter();
    let calls = 0;
    const flaky = {
      generate: async (request: Parameters<typeof fake.adapter.generate>[0]) => {
        calls += 1;
        if (calls === 1) throw new Error('synthetic prompt failure');
        return fake.adapter.generate(request);
      },
    };
    const created = await createUploadedBannerOperation({
      file: new File([source], 'banner.png', { type: 'image/png' }),
      authority: owner,
      generator: createDeterministicUploadedBannerSamGenerator(),
      promptedExecution: {
        generator: flaky,
        expectedExecutionKind: 'deterministic-fake',
        provenance: 'Deterministic test output — NOT SAM OUTPUT',
      },
    });
    const crop = { left: 3, top: 4, width: 20, height: 15 };
    await expect(
      promptUploadedBannerOperation({ operationId: created.operationId, crop, authority: owner }),
    ).rejects.toThrow();
    const retried = await promptUploadedBannerOperation({
      operationId: created.operationId,
      crop,
      authority: owner,
    });
    expect(calls).toBe(2);
    retried.operation.projectBytes.set('preloaded', 64 * 1024 * 1024);
    await expect(
      promptUploadedBannerOperation({
        operationId: created.operationId,
        crop: { ...crop, left: 5 },
        authority: owner,
      }),
    ).rejects.toMatchObject({ code: 'OPERATION_INVALID' });
    retried.operation.projectBytes.delete('preloaded');
    await expect(
      promptUploadedBannerOperation({
        operationId: created.operationId,
        crop: { ...crop, left: 5 },
        authority: owner,
      }),
    ).resolves.toMatchObject({ promptedId: expect.stringMatching(/^samp_v1_/u) });
    expect(retried.promptedId).toMatch(/^samp_v1_/u);
  });

  it('caps distinct prompted crops at eight while reusing duplicates', async () => {
    const owner = authority();
    const fake = createDeterministicNonRectangularSamBoxPromptAdapter();
    const created = await createUploadedBannerOperation({
      file: new File([source], 'banner.png', { type: 'image/png' }),
      authority: owner,
      generator: createDeterministicUploadedBannerSamGenerator(),
      promptedExecution: {
        generator: fake.adapter,
        expectedExecutionKind: 'deterministic-fake',
        provenance: 'Deterministic test output — NOT SAM OUTPUT',
      },
    });
    const crops = Array.from({ length: 8 }, (_, index) => ({
      left: index * 2,
      top: 0,
      width: 10,
      height: 10,
    }));
    const results = await Promise.all(
      crops.map((crop) =>
        promptUploadedBannerOperation({ operationId: created.operationId, crop, authority: owner }),
      ),
    );
    expect(results).toHaveLength(8);
    expect(fake.getCallCount()).toBe(8);
    await expect(
      promptUploadedBannerOperation({
        operationId: created.operationId,
        crop: crops[0]!,
        authority: owner,
      }),
    ).resolves.toMatchObject({ promptedId: results[0]!.promptedId });
    await expect(
      promptUploadedBannerOperation({
        operationId: created.operationId,
        crop: { left: 20, top: 0, width: 10, height: 10 },
        authority: owner,
      }),
    ).rejects.toMatchObject({ code: 'OPERATION_INVALID' });
    expect(fake.getCallCount()).toBe(8);
  });
});
