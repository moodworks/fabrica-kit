import type { ProviderFreeExportData } from './banner-ai-project-contract';
import type { BannerSceneV1 } from '@fabrica/banner-ai/browser';

import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  createDemoExport,
  openInitialDemoProject,
  saveDemoProject,
} from '../../server/banner-ai/provider-free-demo-project';
import {
  acceptProviderFreeExportForCapture,
  captureAcceptedProviderFreeRevision,
  requestProviderFreeExport,
  type ProviderFreeOperationCapture,
} from './banner-ai-project-api';
import {
  parseProviderFreeExportEnvelope,
  parseProviderFreeProjectPresentation,
  parseProviderFreeProjectEnvelope,
} from './banner-ai-project-contract';
import {
  composeUploadedBannerCandidateGroups,
  composeUploadedBannerMixedLayers,
  parseUploadedMixedLayers,
} from './banner-ai-project-api';

describe('uploaded mixed layer payloads', () => {
  it('accepts a source crop touching the top-left edge', () => {
    expect(
      parseUploadedMixedLayers([
        { kind: 'source-region-v1', crop: { left: 0, top: 0, width: 12, height: 8 } },
      ]),
    ).toEqual([{ kind: 'source-region-v1', crop: { left: 0, top: 0, width: 12, height: 8 } }]);
  });
});

describe('multi-layer presentation contract', () => {
  const thumbnail = {
    dataUrl: 'data:image/png;base64,AA==',
    byteSize: 1,
    pixelWidth: 1,
    pixelHeight: 1,
    sha256: 'a'.repeat(64),
  };
  const sourceAsset = {
    assetId: 'source',
    assetVersionId: 'source-version',
    sha256: 'b'.repeat(64),
    mediaType: 'image/png',
    byteSize: 1,
    pixelWidth: 1,
    pixelHeight: 1,
  };
  const firstLayer = {
    id: 'layer_uploaded_cutout_aaaaaaaaaaaaaaaaaaaaaaaa',
    name: 'One',
    frame: { x: 1, y: 2, width: 3, height: 4 },
  };
  const secondLayer = {
    id: 'layer_uploaded_cutout_bbbbbbbbbbbbbbbbbbbbbbbb',
    name: 'Two',
    frame: { x: 5, y: 6, width: 7, height: 8 },
  };
  const scene = {
    sourceAsset,
    layers: [firstLayer, secondLayer],
  } as unknown as BannerSceneV1;
  const presentation = () => ({
    canvas: { width: 300, height: 200 },
    fixtureLabel: 'Uploaded layer selection',
    candidateId: 'sams_v1_' + 'c'.repeat(64),
    source: { name: 'Source', asset: sourceAsset, thumbnail },
    parts: [
      {
        partKey: 'background',
        targetId: 'background',
        name: 'Background',
        role: 'background',
        bounds: { x: 0, y: 0, width: 300, height: 200 },
        thumbnail,
      },
      {
        partKey: 'one',
        targetId: firstLayer.id,
        name: 'One',
        role: 'subject',
        bounds: firstLayer.frame,
        thumbnail,
      },
      {
        partKey: 'two',
        targetId: secondLayer.id,
        name: 'Two',
        role: 'subject',
        bounds: secondLayer.frame,
        thumbnail,
      },
    ],
  });
  it('accepts exact background plus two foreground parts and rejects drift', () => {
    const valid = presentation();
    expect(parseProviderFreeProjectPresentation(valid, scene)).toMatchObject({
      parts: valid.parts,
    });
    expect(() =>
      parseProviderFreeProjectPresentation({ ...valid, parts: valid.parts.slice(0, 2) }, scene),
    ).toThrow();
    expect(() =>
      parseProviderFreeProjectPresentation(
        { ...valid, parts: [...valid.parts, valid.parts[1]] },
        scene,
      ),
    ).toThrow();
    expect(() =>
      parseProviderFreeProjectPresentation(
        {
          ...valid,
          parts: valid.parts.map((part, index) =>
            index === 1 ? { ...part, targetId: 'background' } : part,
          ),
        },
        scene,
      ),
    ).toThrow();
    expect(() =>
      parseProviderFreeProjectPresentation(
        {
          ...valid,
          parts: valid.parts.map((part, index) =>
            index === 2 ? { ...part, name: 'Drifted' } : part,
          ),
        },
        scene,
      ),
    ).toThrow();
    expect(() =>
      parseProviderFreeProjectPresentation(
        {
          ...valid,
          parts: valid.parts.map((part, index) =>
            index === 1 ? { ...part, bounds: { ...part.bounds, width: 999 } } : part,
          ),
        },
        scene,
      ),
    ).toThrow();
  });
});

describe('grouped compose request contract', () => {
  it('sends exact nested candidateGroups and rejects malformed responses', async () => {
    let body: unknown;
    await expect(
      composeUploadedBannerCandidateGroups(
        'c'.repeat(64),
        [['samc_v1_' + 'a'.repeat(64)], ['samc_v1_' + 'b'.repeat(64)]],
        async (_input, init) => {
          body = JSON.parse(String(init?.body));
          return Response.json({ ok: true, data: { subjectId: 'sams_v1_' + 'd'.repeat(64) } });
        },
      ),
    ).resolves.toEqual({ subjectId: 'sams_v1_' + 'd'.repeat(64) });
    expect(body).toMatchObject({ action: 'compose', candidateGroups: expect.any(Array) });
    await expect(
      composeUploadedBannerCandidateGroups('c'.repeat(64), [], async () =>
        Response.json({ ok: true, data: {} }),
      ),
    ).rejects.toMatchObject({ code: 'UPLOADED_COMPOSE_FAILED' });
  });
});

describe('mixed compose request contract', () => {
  it('sends exact ordered mixed layers and rejects malformed responses', async () => {
    let body: unknown;
    await expect(
      composeUploadedBannerMixedLayers(
        'c'.repeat(64),
        [
          { kind: 'sam-candidate-group-v1', candidateIds: ['samc_v1_' + 'a'.repeat(64)] },
          { kind: 'source-region-v1', crop: { left: 0, top: 0, width: 10, height: 20 } },
        ],
        async (_input, init) => {
          body = JSON.parse(String(init?.body));
          return Response.json({ ok: true, data: { subjectId: 'sams_v1_' + 'd'.repeat(64) } });
        },
      ),
    ).resolves.toEqual({ subjectId: 'sams_v1_' + 'd'.repeat(64) });
    expect(body).toEqual({
      action: 'compose',
      operationId: 'c'.repeat(64),
      layers: [
        { kind: 'sam-candidate-group-v1', candidateIds: ['samc_v1_' + 'a'.repeat(64)] },
        { kind: 'source-region-v1', crop: { left: 0, top: 0, width: 10, height: 20 } },
      ],
    });
    await expect(
      composeUploadedBannerMixedLayers('c'.repeat(64), [
        { kind: 'source-region-v1', crop: { left: -1, top: 0, width: 1, height: 1 } },
      ]),
    ).rejects.toThrow();
  });
});

let firstCapture: ProviderFreeOperationCapture;
let firstData: ProviderFreeExportData;

const otherSha256 = 'f'.repeat(64);

beforeAll(async () => {
  const opened = await openInitialDemoProject();
  firstCapture = captureAcceptedProviderFreeRevision(opened.project);
  firstData = await createDemoExport(firstCapture);
});

const identityMutators = [
  [
    'scene version identity',
    (data: ProviderFreeExportData): ProviderFreeExportData => ({
      ...data,
      manifest: {
        ...data.manifest,
        sceneVersionId:
          'aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa' as typeof data.manifest.sceneVersionId,
      },
    }),
  ],
  [
    'scene revision identity',
    (data: ProviderFreeExportData): ProviderFreeExportData => ({
      ...data,
      manifest: { ...data.manifest, sceneRevision: data.manifest.sceneRevision + 1 },
    }),
  ],
  [
    'scene workflow identity',
    (data: ProviderFreeExportData): ProviderFreeExportData => ({
      ...data,
      manifest: {
        ...data.manifest,
        sceneWorkflow: {
          ...data.manifest.sceneWorkflow,
          definitionSha256: otherSha256 as typeof data.manifest.sceneWorkflow.definitionSha256,
        },
      },
    }),
  ],
  [
    'export workflow identity',
    (data: ProviderFreeExportData): ProviderFreeExportData => ({
      ...data,
      manifest: {
        ...data.manifest,
        exportWorkflow: {
          ...data.manifest.exportWorkflow,
          definitionSha256: otherSha256 as typeof data.manifest.exportWorkflow.definitionSha256,
        },
      },
    }),
  ],
  [
    'exporter identity',
    (data: ProviderFreeExportData): ProviderFreeExportData => ({
      ...data,
      manifest: {
        ...data.manifest,
        exporter: {
          ...data.manifest.exporter,
          buildSha256: otherSha256 as typeof data.manifest.exporter.buildSha256,
        },
      },
    }),
  ],
  [
    'manifest output identity',
    (data: ProviderFreeExportData): ProviderFreeExportData => ({
      ...data,
      manifest: {
        ...data.manifest,
        output: {
          ...data.manifest.output,
          sha256: otherSha256 as typeof data.manifest.output.sha256,
        },
      },
    }),
  ],
  [
    'manifest validator profile',
    (data: ProviderFreeExportData): ProviderFreeExportData => {
      if (data.manifest.validator.kind !== 'profile')
        throw new Error('Expected profile validator.');
      return {
        ...data,
        manifest: {
          ...data.manifest,
          validator: {
            kind: 'profile',
            profile: {
              ...data.manifest.validator.profile,
              rulesSha256: otherSha256 as typeof data.manifest.validator.profile.rulesSha256,
            },
          },
        },
      };
    },
  ],
  [
    'manifest asset graph',
    (data: ProviderFreeExportData): ProviderFreeExportData => ({
      ...data,
      manifest: {
        ...data.manifest,
        assetVersions: data.manifest.assetVersions.map((asset, index) =>
          index === 0 ? { ...asset, byteSize: asset.byteSize + 1 } : asset,
        ),
      },
    }),
  ],
  [
    'validation artifact digest',
    (data: ProviderFreeExportData): ProviderFreeExportData => ({
      ...data,
      validation: {
        ...data.validation,
        artifactSha256: otherSha256 as typeof data.validation.artifactSha256,
      },
    }),
  ],
  [
    'validation profile and rules digest',
    (data: ProviderFreeExportData): ProviderFreeExportData => ({
      ...data,
      validation: {
        ...data.validation,
        profile: {
          ...data.validation.profile,
          rulesSha256: otherSha256 as typeof data.validation.profile.rulesSha256,
        },
      },
    }),
  ],
] as const;

describe('provider-free browser export acceptance', () => {
  it('strictly accepts and binds the source reference presentation', async () => {
    const opened = await openInitialDemoProject();
    const envelope = { ok: true as const, data: opened };
    expect(parseProviderFreeProjectEnvelope(envelope).ok).toBe(true);
    const source = opened.presentation.source;
    expect(() =>
      parseProviderFreeProjectEnvelope({
        ok: true,
        data: { ...opened, presentation: { ...opened.presentation, source: undefined } },
      }),
    ).toThrow();
    expect(() =>
      parseProviderFreeProjectEnvelope({
        ok: true,
        data: {
          ...opened,
          presentation: { ...opened.presentation, source: { ...source, extra: true } },
        },
      }),
    ).toThrow();
    expect(() =>
      parseProviderFreeProjectEnvelope({
        ok: true,
        data: {
          ...opened,
          presentation: {
            ...opened.presentation,
            source: { ...source, asset: { ...source.asset, sha256: otherSha256 } },
          },
        },
      }),
    ).toThrow();
    expect(() =>
      parseProviderFreeProjectEnvelope({
        ok: true,
        data: {
          ...opened,
          presentation: {
            ...opened.presentation,
            source: {
              ...source,
              asset: { ...source.asset, pixelWidth: source.asset.pixelWidth + 1 },
            },
          },
        },
      }),
    ).toThrow();
  });

  it('strictly parses the shared manifest and validation result contracts', () => {
    expect(() =>
      parseProviderFreeExportEnvelope({ ok: true, data: firstData, unknown: true }),
    ).toThrow(/success envelope/u);
    expect(() =>
      parseProviderFreeExportEnvelope({
        ok: true,
        data: { ...firstData, manifest: { ...firstData.manifest, unknown: true } },
      }),
    ).toThrow(/manifest or validation/u);
    expect(() =>
      parseProviderFreeExportEnvelope({
        ok: true,
        data: { ...firstData, validation: { ...firstData.validation, unknown: true } },
      }),
    ).toThrow(/manifest or validation/u);
    expect(() =>
      parseProviderFreeExportEnvelope({
        ok: true,
        data: {
          ...firstData,
          validation: {
            ...firstData.validation,
            outcome: 'internal-check-passed',
            findings: [
              {
                ruleCode: 'EXPORT_CONTENT_INVALID',
                severity: 'error',
                message: 'The packaged content is invalid.',
                entryPath: 'index.html',
              },
            ],
          },
        },
      }),
    ).toThrow(/manifest or validation/u);
  });

  it('decodes and hashes the exact ZIP before returning accepted evidence', async () => {
    const accepted = await acceptProviderFreeExportForCapture(firstData, firstCapture);
    expect(accepted).toEqual(firstData);

    const bytes = Buffer.from(firstData.artifact.bytesBase64, 'base64');
    bytes[0] = bytes[0]! ^ 0xff;
    await expect(
      acceptProviderFreeExportForCapture(
        {
          ...firstData,
          artifact: { ...firstData.artifact, bytesBase64: bytes.toString('base64') },
        },
        firstCapture,
      ),
    ).rejects.toMatchObject({
      code: 'EXPORT_IDENTITY_MISMATCH',
    });
  });

  it.each(identityMutators)(
    'rejects a validly shaped response with mismatched %s',
    async (_, mutate) => {
      await expect(
        acceptProviderFreeExportForCapture(mutate(firstData), firstCapture),
      ).rejects.toMatchObject({
        code: 'EXPORT_IDENTITY_MISMATCH',
      });
    },
  );

  it('rejects revision-one evidence for a selection-only revision sharing scene and ZIP digests', async () => {
    const opened = await openInitialDemoProject();
    const selectedPartId = opened.presentation.parts.find(
      (part) => part.targetId !== opened.project.selectedPartId,
    )!.targetId;
    const saved = await saveDemoProject({
      project: opened.project,
      scene: opened.project.revisions[0]!.scene,
      selectedPartId,
    });
    const secondCapture = captureAcceptedProviderFreeRevision(saved.project);
    const secondData = await createDemoExport(secondCapture);

    expect(secondCapture.sceneSha256).toBe(firstCapture.sceneSha256);
    expect(secondData.artifact.sha256).toBe(firstData.artifact.sha256);
    expect(secondCapture.sceneVersionId).not.toBe(firstCapture.sceneVersionId);
    await expect(
      acceptProviderFreeExportForCapture(
        {
          ...firstData,
          artifact: { ...firstData.artifact, filename: secondData.artifact.filename },
        },
        secondCapture,
      ),
    ).rejects.toMatchObject({
      code: 'EXPORT_IDENTITY_MISMATCH',
    });
    await expect(acceptProviderFreeExportForCapture(secondData, secondCapture)).resolves.toEqual(
      secondData,
    );
  });

  it('does not resolve the request helper until browser acceptance succeeds', async () => {
    const fetchImplementation = vi.fn(async () =>
      Response.json({
        ok: true,
        data: {
          ...firstData,
          validation: {
            ...firstData.validation,
            artifactSha256: otherSha256,
          },
        },
      }),
    );

    await expect(
      requestProviderFreeExport(firstCapture, fetchImplementation),
    ).rejects.toMatchObject({
      code: 'EXPORT_IDENTITY_MISMATCH',
    });
    expect(fetchImplementation).toHaveBeenCalledOnce();
  });
});

import {
  composeUploadedBannerCandidates,
  parseUploadedBannerOperationPayload,
} from './banner-ai-project-api';

const uploadedCandidate = {
  candidateId: `samc_v1_${'a'.repeat(64)}`,
  order: 1,
  bounds: { x: 10, y: 20, width: 100, height: 200 },
  source: { width: 1000, height: 500 },
  crop: { left: 100, top: 100, width: 100, height: 200 },
  pixelArea: 200,
  areaRatioBps: 100,
  provenance: 'Deterministic test output — NOT SAM OUTPUT',
  thumbnail: {
    dataUrl: 'data:image/png;base64,AAAA',
    byteSize: 3,
    pixelWidth: 1,
    pixelHeight: 1,
    sha256: 'b'.repeat(64),
  },
};

describe('uploaded operation client parser', () => {
  it('accepts the exact bounded envelope', () => {
    expect(
      parseUploadedBannerOperationPayload({
        ok: true,
        data: {
          operationId: 'c'.repeat(64),
          candidates: [uploadedCandidate],
          provenance: 'Deterministic test output — NOT SAM OUTPUT',
        },
      }).candidates,
    ).toHaveLength(1);
  });
  it('rejects crop drift and malformed compose responses', async () => {
    expect(() =>
      parseUploadedBannerOperationPayload({
        ok: true,
        data: {
          operationId: 'c'.repeat(64),
          candidates: [{ ...uploadedCandidate, crop: { ...uploadedCandidate.crop, left: 950 } }],
          provenance: uploadedCandidate.provenance,
        },
      }),
    ).toThrow();
    expect(() =>
      parseUploadedBannerOperationPayload({
        ok: true,
        data: {
          operationId: 'c'.repeat(64),
          candidates: [
            uploadedCandidate,
            {
              ...uploadedCandidate,
              candidateId: `samc_v1_${'d'.repeat(64)}`,
              order: 2,
              source: { width: 900, height: 500 },
            },
          ],
          provenance: uploadedCandidate.provenance,
        },
      }),
    ).toThrow();
    await expect(
      composeUploadedBannerCandidates('c'.repeat(64), [uploadedCandidate.candidateId], async () =>
        Response.json({ ok: true, data: {} }),
      ),
    ).rejects.toMatchObject({ code: 'UPLOADED_COMPOSE_FAILED' });
  });
  it('accepts verified replay provenance and rejects provenance drift', () => {
    const value = {
      ok: true as const,
      data: {
        operationId: 'c'.repeat(64),
        candidates: [
          {
            ...uploadedCandidate,
            provenance: 'Verified Meta SAM 2.1 cutout replay — no live call',
          },
        ],
        provenance: 'Verified Meta SAM 2.1 cutout replay — no live call',
      },
    };
    expect(parseUploadedBannerOperationPayload(value).provenance).toBe(value.data.provenance);
    expect(() =>
      parseUploadedBannerOperationPayload({
        ...value,
        data: {
          ...value.data,
          candidates: [
            {
              ...value.data.candidates[0],
              provenance: 'Deterministic test output — NOT SAM OUTPUT',
            },
          ],
        },
      }),
    ).toThrow();
  });
  type MutableParserPayload = {
    data: {
      candidates: Array<{ bounds: { x: number } }>;
      [key: string]: unknown;
    };
  };
  it.each([
    (value: MutableParserPayload) => {
      value.data.extra = true;
    },
    (value: MutableParserPayload) => {
      value.data.candidates.push(uploadedCandidate);
    },
    (value: MutableParserPayload) => {
      const first = value.data.candidates[0];
      if (first === undefined) throw new Error('Expected one candidate.');
      first.bounds.x = 1.5;
    },
  ])('rejects malformed or non-closed responses', (mutate) => {
    const value = {
      ok: true,
      data: {
        operationId: 'c'.repeat(64),
        candidates: [structuredClone(uploadedCandidate)],
        provenance: 'Deterministic test output — NOT SAM OUTPUT',
      },
    };
    mutate(value);
    expect(() => parseUploadedBannerOperationPayload(value)).toThrow();
  });
});
