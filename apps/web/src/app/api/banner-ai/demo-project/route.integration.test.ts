import {
  GdnValidationResultSchema,
  PREVIEW_CSP,
  createDeterministicFakeZipEntriesV1,
  createExactZipContentPolicy,
  inspectZipBytes,
} from '@fabrica/banner-ai';
import { materializeProviderFreePersonSamReplayProjectV1 } from '@fabrica/banner-ai/server/sam-box-prompt-layer-extraction';
import {
  isProviderFreeLayerIdV1,
  mutateProviderFreeBannerSceneV1,
} from '@fabrica/banner-ai/browser';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  parseProviderFreeExportEnvelope,
  parseProviderFreePreviewEnvelope,
  parseProviderFreeProjectEnvelope,
} from '../../../../features/banner-ai/banner-ai-project-contract';
import { POST as exportProject } from './export/route';
import { POST as previewProject } from './preview/route';
import { GET as getProject, POST as updateProject } from './route';

const get = (): Promise<Response> =>
  getProject(new Request('http://localhost/api/banner-ai/demo-project'));

const postJson = (
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
): Promise<Response> =>
  handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

const openData = async () => {
  const response = await get();
  const envelope = parseProviderFreeProjectEnvelope(await response.json());
  if (!envelope.ok) throw new Error('Expected the demo project to open.');
  return envelope.data;
};

const operationBody = (project: Awaited<ReturnType<typeof openData>>['project']) => {
  const revision = project.revisions[project.currentAcceptedRevision - 1]!;
  return {
    project,
    revision: revision.revision,
    sceneSha256: revision.sceneSha256,
    sceneVersionId: revision.sceneVersionId,
  };
};

const revisionTwo = async () => {
  const opened = await openData();
  const subject = opened.project.revisions[0]!.scene.layers[0]!;
  if (!isProviderFreeLayerIdV1(subject.id)) throw new Error('Expected fixed subject ID.');
  let scene = mutateProviderFreeBannerSceneV1(opened.project.revisions[0]!.scene, {
    type: 'set_layer_visible',
    layerId: subject.id,
    visible: false,
  });
  scene = mutateProviderFreeBannerSceneV1(scene, {
    type: 'set_layer_included',
    layerId: subject.id,
    included: false,
  });
  scene = mutateProviderFreeBannerSceneV1(scene, {
    type: 'set_layer_included',
    layerId: subject.id,
    included: true,
  });
  scene = mutateProviderFreeBannerSceneV1(scene, {
    type: 'apply_gentle_float',
    layerId: subject.id,
  });
  const response = await postJson(updateProject, '/api/banner-ai/demo-project', {
    action: 'save',
    project: opened.project,
    scene,
    selectedPartId: subject.id,
  });
  const envelope = parseProviderFreeProjectEnvelope(await response.json());
  if (!envelope.ok) throw new Error('Expected revision two to save.');
  return { opened, saved: envelope.data, subject };
};

afterEach(() => vi.restoreAllMocks());

describe('provider-free demo project route integration', () => {
  it('opens candidate catalog and a non-default candidate strictly', async () => {
    const catalogResponse = await postJson(updateProject, '/api/banner-ai/demo-project', {
      action: 'catalog',
    });
    expect(catalogResponse.status).toBe(200);
    const catalog = (await catalogResponse.json()) as {
      ok: true;
      data: { candidates: { candidateId: string }[] };
    };
    expect(catalog.data.candidates).toHaveLength(8);
    const candidateId = catalog.data.candidates[0]!.candidateId;
    const opened = await postJson(updateProject, '/api/banner-ai/demo-project', {
      action: 'open-candidate',
      candidateId,
    });
    expect(opened.status).toBe(200);
    const data = parseProviderFreeProjectEnvelope(await opened.json());
    if (!data.ok) throw new Error('Expected candidate project.');
    expect(data.data.presentation.candidateId).toBe(candidateId);
    expect(data.data.project.revisions[0]!.scene.layers[0]!.asset.sha256).toBe(
      'efa97f238a11d55d31e0438887bddece3de757f2b4abf117c8f1895553977022',
    );
    const unknown = await postJson(updateProject, '/api/banner-ai/demo-project', {
      action: 'open-candidate',
      candidateId: 'samc_v1_' + 'f'.repeat(64),
    });
    expect(unknown.status).toBe(400);
  });
  it('opens the one exact server-owned 300 by 200 fixture without network activity', async () => {
    const outbound = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network forbidden'));
    const data = await openData();

    expect(data.project).toMatchObject({
      envelopeVersion: 1,
      fixtureId: 'banner-person-sam-replay-v1',
      projectId: '2a000000-0000-5000-8000-000000000001',
      currentAcceptedRevision: 1,
    });
    expect(data.project.revisions[0]!.scene.canvas).toMatchObject({ width: 300, height: 200 });
    expect(data.presentation.parts.map((part) => part.name)).toEqual([
      'Solid background',
      'banner-person-v1 subject',
    ]);
    expect(
      data.presentation.parts.every((part) =>
        part.thumbnail.dataUrl.startsWith('data:image/png;base64,'),
      ),
    ).toBe(true);
    expect(data.presentation.parts).toHaveLength(2);
    expect(data.presentation.source.name).toBe('Source banner');
    expect(data.presentation.source.asset).toEqual(data.project.revisions[0]!.scene.sourceAsset);
    expect(data.presentation.source.thumbnail.sha256).toBe(
      '61af239b98d3a4fc3250b16d9467f8be69e3d0e46b90fda5dbe7b848bba53baf',
    );
    expect(new Set(data.presentation.parts.map((part) => part.partKey)).size).toBe(2);
    const fixed = await materializeProviderFreePersonSamReplayProjectV1();
    expect(data.presentation.parts.map((part) => [part.partKey, part.thumbnail.sha256])).toEqual(
      fixed.presentationParts.map((part) => [part.partKey, part.thumbnail.sha256]),
    );
    expect(data.project.revisions[0]!.scene.layers.map((layer) => layer.asset.sha256)).toEqual(
      fixed.scene.layers.map((layer) => layer.asset.sha256),
    );
    expect(data.project.revisions[0]!.scene.layers).toHaveLength(1);
    expect(data.project.revisions[0]!.scene.layers[0]!.asset.sha256).toBe(
      '464f1bb286ac4a599e3b49a25b1f427d2b73acaac6c2cd1829902d0d5a870c33',
    );
    expect(outbound).not.toHaveBeenCalled();
  });

  it('appends and reopens an exact canonical revision with unique identity and ancestry', async () => {
    const { opened, saved, subject } = await revisionTwo();
    const first = saved.project.revisions[0]!;
    const second = saved.project.revisions[1]!;

    expect(saved.project.currentAcceptedRevision).toBe(2);
    expect(saved.project.selectedPartId).toBe(subject.id);
    expect(second.sceneVersionId).not.toBe(first.sceneVersionId);
    expect(second.parentSceneSha256).toBe(first.sceneSha256);
    expect(second.sceneSha256).not.toBe(first.sceneSha256);
    expect(second.scene.layers.find((layer) => layer.id === subject.id)).toMatchObject({
      included: true,
      visible: false,
    });
    expect(second.scene.timeline).toHaveLength(1);
    expect(opened.project.currentAcceptedRevision).toBe(1);

    const reopenedResponse = await postJson(updateProject, '/api/banner-ai/demo-project', {
      action: 'reopen',
      project: JSON.parse(saved.canonicalProjectJson) as unknown,
    });
    const reopened = parseProviderFreeProjectEnvelope(await reopenedResponse.json());
    expect(reopened).toEqual({ ok: true, data: saved });
  });

  it('rejects client authority, digest drift, and query input with closed safe errors', async () => {
    const opened = await openData();
    const legacy = structuredClone(opened.project);
    (legacy as { fixtureId: string }).fixtureId = 'angel-local-png-v1';
    const legacyResponse = await postJson(updateProject, '/api/banner-ai/demo-project', {
      action: 'reopen',
      project: legacy,
    });
    expect(legacyResponse.status).toBe(400);
    await expect(legacyResponse.text()).resolves.toContain('PROJECT_STORAGE_CORRUPT');

    const extra = await postJson(updateProject, '/api/banner-ai/demo-project', {
      action: 'reopen',
      project: opened.project,
      workspaceId: 'client-controlled',
    });
    expect(extra.status).toBe(400);
    await expect(extra.json()).resolves.toMatchObject({
      ok: false,
      error: { code: 'INVALID_DEMO_REQUEST' },
    });

    const corrupt = structuredClone(opened.project);
    corrupt.revisions[0]!.sceneSha256 = '0'.repeat(
      64,
    ) as (typeof corrupt.revisions)[0]['sceneSha256'];
    const corruptResponse = await postJson(updateProject, '/api/banner-ai/demo-project', {
      action: 'reopen',
      project: corrupt,
    });
    const corruptText = await corruptResponse.text();
    expect(corruptResponse.status).toBe(400);
    expect(corruptText).toContain('PROJECT_STORAGE_CORRUPT');
    expect(corruptText).not.toMatch(/(?:\/Users\/|node_modules|\.ts:\d+|stack|secret)/u);

    const query = await getProject(
      new Request('http://localhost/api/banner-ai/demo-project?project=foreign'),
    );
    expect(query.status).toBe(400);
  });
});

describe('provider-free preview route integration', () => {
  it('returns the exact opaque-preview document without destination or remote dependency', async () => {
    const opened = await openData();
    const nonce = '0123456789abcdef0123456789abcdef';
    const response = await postJson(previewProject, '/api/banner-ai/demo-project/preview', {
      ...operationBody(opened.project),
      nonce,
    });
    const envelope = parseProviderFreePreviewEnvelope(await response.json());
    if (!envelope.ok) throw new Error('Expected preview success.');
    const html = Buffer.from(envelope.data.contentBase64, 'base64').toString('utf8');

    expect(envelope.data.sceneSha256).toBe(opened.project.revisions[0]!.sceneSha256);
    expect(envelope.data.nonce).toBe(nonce);
    expect(html).toContain(`content="${PREVIEW_CSP}"`);
    expect(html).not.toContain('https://example.com/campaign');
    expect(html).not.toMatch(/<(?:iframe|form|object|base)\b/iu);
    expect(html).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/u);
    const fixed = await materializeProviderFreePersonSamReplayProjectV1();
    const encodedPlan = /input = decode\('([^']+)'\)/u.exec(html)?.[1];
    expect(encodedPlan).toBeDefined();
    const plan = JSON.parse(Buffer.from(encodedPlan!, 'base64').toString('utf8')) as {
      sources: Record<string, string>;
    };
    for (const asset of fixed.assets.slice(1)) {
      const dataUrl = `data:image/png;base64,${Buffer.from(asset.bytes).toString('base64')}`;
      expect(Object.values(plan.sources)).toContain(dataUrl);
    }
  });

  it('rejects malformed nonce, stale digest, foreign fields, and never returns raw HTML on failure', async () => {
    const opened = await openData();
    const base = operationBody(opened.project);
    for (const body of [
      { ...base, nonce: 'bad' },
      { ...base, nonce: '0'.repeat(32), sceneSha256: 'f'.repeat(64) },
      { ...base, nonce: '0'.repeat(32), sourceUrl: 'client-controlled' },
    ]) {
      const response = await postJson(previewProject, '/api/banner-ai/demo-project/preview', body);
      const text = await response.text();
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(text).not.toContain('<!doctype html>');
      expect(text).not.toMatch(/(?:\/Users\/|node_modules|\.ts:\d+|stack|secret)/u);
    }
  });
});

describe('provider-free export route integration', () => {
  it('returns byte-identical inspected ZIPs and exact manifest/internal validation identities', async () => {
    const opened = await openData();
    const body = operationBody(opened.project);
    const [firstResponse, secondResponse] = await Promise.all([
      postJson(exportProject, '/api/banner-ai/demo-project/export', body),
      postJson(exportProject, '/api/banner-ai/demo-project/export', body),
    ]);
    const first = parseProviderFreeExportEnvelope(await firstResponse.json());
    const second = parseProviderFreeExportEnvelope(await secondResponse.json());
    if (!first.ok || !second.ok) throw new Error('Expected export success.');

    expect(first.data.artifact.bytesBase64).toBe(second.data.artifact.bytesBase64);
    expect(first.data.artifact.sha256).toBe(second.data.artifact.sha256);
    expect(first.data.manifest).toEqual(second.data.manifest);
    expect(first.data.manifest.sceneSha256).toBe(body.sceneSha256);
    expect(GdnValidationResultSchema.parse(first.data.validation)).toMatchObject({
      validationLabel: 'internal-provider-free-not-gdn',
      outcome: 'internal-check-passed',
      findings: [],
    });

    const fixed = await materializeProviderFreePersonSamReplayProjectV1();
    const bytes = Buffer.from(first.data.artifact.bytesBase64, 'base64');
    const expectedEntries = createDeterministicFakeZipEntriesV1({
      scene: opened.project.revisions[0]!.scene,
      assets: fixed.assets,
    });
    const inspection = await inspectZipBytes(bytes, {
      contentPolicy: createExactZipContentPolicy(expectedEntries),
    });
    expect(inspection.entries.map((entry) => entry.name)).toEqual(
      expectedEntries.map((entry) => entry.name),
    );
  });

  it('changes artifact identity for revision two and rejects a stale capture safely', async () => {
    const { opened, saved } = await revisionTwo();
    const firstResponse = await postJson(
      exportProject,
      '/api/banner-ai/demo-project/export',
      operationBody(opened.project),
    );
    const secondResponse = await postJson(
      exportProject,
      '/api/banner-ai/demo-project/export',
      operationBody(saved.project),
    );
    const first = parseProviderFreeExportEnvelope(await firstResponse.json());
    const second = parseProviderFreeExportEnvelope(await secondResponse.json());
    if (!first.ok || !second.ok) throw new Error('Expected both revisions to export.');
    expect(second.data.artifact.sha256).not.toBe(first.data.artifact.sha256);

    const stale = await postJson(exportProject, '/api/banner-ai/demo-project/export', {
      ...operationBody(saved.project),
      sceneSha256: opened.project.revisions[0]!.sceneSha256,
    });
    const text = await stale.text();
    expect(stale.status).toBe(409);
    expect(text).toContain('SCENE_CAPTURE_MISMATCH');
    expect(text).not.toMatch(/(?:\/Users\/|node_modules|\.ts:\d+|stack|secret)/u);
  });
});
