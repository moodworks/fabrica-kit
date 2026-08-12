import type { ProviderFreeExportData } from './banner-ai-project-contract';

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
  parseProviderFreeProjectEnvelope,
} from './banner-ai-project-contract';

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
