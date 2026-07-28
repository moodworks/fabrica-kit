import {
  GdnValidationResultSchema,
  PREVIEW_CSP,
  createDeterministicFakeZipEntriesV1,
  createExactZipContentPolicy,
  inspectZipBytes,
  materializeProviderFreeFixtureProjectV1,
} from '@fabrica/banner-ai';
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
  const leftWing = opened.project.revisions[0]!.scene.layers.find((layer) =>
    layer.name.includes('Left wing'),
  )!;
  if (!isProviderFreeLayerIdV1(leftWing.id)) throw new Error('Expected fixed left-wing ID.');
  let scene = mutateProviderFreeBannerSceneV1(opened.project.revisions[0]!.scene, {
    type: 'set_layer_visible',
    layerId: leftWing.id,
    visible: false,
  });
  scene = mutateProviderFreeBannerSceneV1(scene, {
    type: 'set_layer_included',
    layerId: leftWing.id,
    included: false,
  });
  scene = mutateProviderFreeBannerSceneV1(scene, {
    type: 'set_layer_included',
    layerId: leftWing.id,
    included: true,
  });
  scene = mutateProviderFreeBannerSceneV1(scene, {
    type: 'apply_gentle_float',
    layerId: leftWing.id,
  });
  const response = await postJson(updateProject, '/api/banner-ai/demo-project', {
    action: 'save',
    project: opened.project,
    scene,
    selectedPartId: leftWing.id,
  });
  const envelope = parseProviderFreeProjectEnvelope(await response.json());
  if (!envelope.ok) throw new Error('Expected revision two to save.');
  return { opened, saved: envelope.data, leftWing };
};

afterEach(() => vi.restoreAllMocks());

describe('provider-free demo project route integration', () => {
  it('opens the one exact server-owned 300 by 200 fixture without network activity', async () => {
    const outbound = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('network forbidden'));
    const data = await openData();

    expect(data.project).toMatchObject({
      envelopeVersion: 1,
      fixtureId: 'angel-local-png-v1',
      projectId: '2a000000-0000-5000-8000-000000000001',
      currentAcceptedRevision: 1,
    });
    expect(data.project.revisions[0]!.scene.canvas).toMatchObject({ width: 300, height: 200 });
    expect(data.presentation.parts.map((part) => part.name)).toEqual([
      'Background',
      'Angel body',
      'Left wing',
      'Right wing',
    ]);
    expect(
      data.presentation.parts.every((part) =>
        part.thumbnail.dataUrl.startsWith('data:image/png;base64,'),
      ),
    ).toBe(true);
    expect(new Set(data.presentation.parts.map((part) => part.thumbnail.sha256)).size).toBe(4);
    expect(outbound).not.toHaveBeenCalled();
  });

  it('appends and reopens an exact canonical revision with unique identity and ancestry', async () => {
    const { opened, saved, leftWing } = await revisionTwo();
    const first = saved.project.revisions[0]!;
    const second = saved.project.revisions[1]!;

    expect(saved.project.currentAcceptedRevision).toBe(2);
    expect(saved.project.selectedPartId).toBe(leftWing.id);
    expect(second.sceneVersionId).not.toBe(first.sceneVersionId);
    expect(second.parentSceneSha256).toBe(first.sceneSha256);
    expect(second.sceneSha256).not.toBe(first.sceneSha256);
    expect(second.scene.layers.find((layer) => layer.id === leftWing.id)).toMatchObject({
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

    const fixed = await materializeProviderFreeFixtureProjectV1();
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
