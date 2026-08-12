import { describe, expect, it } from 'vitest';

import {
  BannerExportRequestSchema,
  GdnValidationRequestSchema,
  PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_V1,
  PROVIDER_FREE_EXPORTER_V1,
  PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1,
  canonicalizeJson,
  createProviderFreeBannerExporterV1,
  createProviderFreeInternalValidatorV1,
  sha256Hex,
  validateBannerExportResult,
  validateInternalGdnValidationResult,
} from '../src/index.js';
import { materializeProviderFreePersonSamReplayProjectV1 } from '../src/server/sam-box-prompt-layer-extraction.js';

const cancellation = Object.freeze({
  cancelled: false,
  throwIfCancelled(): void {},
});

const pinnedProviderFreeZip = Object.freeze({
  byteSize: 64_476,
  sha256: 'ea5127b1cc6aafcdb50d555e2877496bf5e3b8608d2733c48cb96f7f1ae0e0ee',
  exportWorkflowSha256: '88d7bfe729ac99474172944bbf2de27c650dccd858c54f2acbfacb3dce1f4355',
  exporterBuildSha256: 'f3ad1dd6128df6986515badd28115416b59e2ae7d14b82b524b2d064fe812504',
  validatorRulesSha256: '2193e3352520f6ad608c81ded65ab3b3d595c9921728fe5e266a13a8235f993f',
});

const createFixtureExport = async () => {
  const materialization = await materializeProviderFreePersonSamReplayProjectV1();
  const revision = materialization.project.revisions[0]!;
  const request = BannerExportRequestSchema.parse({
    scene: revision.scene,
    sceneVersionId: revision.sceneVersionId,
    sceneRevision: revision.revision,
    sceneWorkflow: revision.sceneWorkflow,
    exportWorkflow: {
      workflowVersionId: PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_V1.workflowVersionId,
      workflowVersion: PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_V1.workflowVersion,
      definitionSha256: PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_V1.definitionSha256,
    },
    exporter: PROVIDER_FREE_EXPORTER_V1,
    assets: materialization.assets,
    deadlineAtMs: Date.now() + 60_000,
    cancellation,
  });
  const exporter = createProviderFreeBannerExporterV1();
  const result = await exporter.export(request);
  return { materialization, request, result };
};

describe('provider-free exporter and internal validator adapter', () => {
  it('produces byte-identical ZIPs and exact manifests for identical validated inputs', async () => {
    const fixture = await createFixtureExport();
    const exporter = createProviderFreeBannerExporterV1();
    const second = await exporter.export(fixture.request);

    expect(second.artifact.bytes).toEqual(fixture.result.artifact.bytes);
    expect(second.artifact.sha256).toBe(fixture.result.artifact.sha256);
    expect(second.artifact).toMatchObject({
      byteSize: pinnedProviderFreeZip.byteSize,
      sha256: pinnedProviderFreeZip.sha256,
    });
    expect(PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_V1.definitionSha256).toBe(
      pinnedProviderFreeZip.exportWorkflowSha256,
    );
    expect(PROVIDER_FREE_EXPORTER_V1.buildSha256).toBe(pinnedProviderFreeZip.exporterBuildSha256);
    expect(PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1.rulesSha256).toBe(
      pinnedProviderFreeZip.validatorRulesSha256,
    );
    expect(second.manifest).toEqual(fixture.result.manifest);
    await expect(
      validateBannerExportResult({ request: fixture.request, result: fixture.result }),
    ).resolves.toEqual(fixture.result);
    expect(fixture.result.manifest).toMatchObject({
      sceneVersionId: fixture.request.sceneVersionId,
      sceneRevision: 1,
      sceneSha256: fixture.materialization.project.revisions[0]!.sceneSha256,
      exporter: PROVIDER_FREE_EXPORTER_V1,
      validator: { kind: 'profile', profile: PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1 },
      output: {
        mediaType: 'application/zip',
        byteSize: fixture.result.artifact.byteSize,
        sha256: fixture.result.artifact.sha256,
      },
    });
  });

  it('passes the exact offline package with an explicit internal non-certification identity', async () => {
    const fixture = await createFixtureExport();
    if (fixture.result.artifact.mediaType !== 'application/zip') {
      throw new TypeError('Expected ZIP artifact.');
    }
    const validator = createProviderFreeInternalValidatorV1({
      exportRequest: fixture.request,
      manifest: fixture.result.manifest,
    });
    const request = GdnValidationRequestSchema.parse({
      artifact: fixture.result.artifact,
      profile: PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1,
    });
    const result = await validator.validate(request);

    expect(result).toEqual({
      validationLabel: 'internal-provider-free-not-gdn',
      artifactSha256: fixture.result.artifact.sha256,
      profile: PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1,
      outcome: 'internal-check-passed',
      findings: [],
    });
    expect(validateInternalGdnValidationResult({ request, result })).toEqual(result);
  });

  it('maps malformed bytes and profile drift to stable sorted safe findings', async () => {
    const fixture = await createFixtureExport();
    if (fixture.result.artifact.mediaType !== 'application/zip') {
      throw new TypeError('Expected ZIP artifact.');
    }
    const validator = createProviderFreeInternalValidatorV1({
      exportRequest: fixture.request,
      manifest: fixture.result.manifest,
    });
    const bytes = fixture.result.artifact.bytes.subarray(0, 24);
    const artifact = {
      ...fixture.result.artifact,
      bytes,
      byteSize: bytes.byteLength,
      sha256: sha256Hex(bytes),
    };
    const foreignProfile = {
      ...PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1,
      rulesSha256: 'f'.repeat(64),
    };
    const request = GdnValidationRequestSchema.parse({ artifact, profile: foreignProfile });
    const result = await validator.validate(request);

    expect(result.outcome).toBe('internal-check-failed');
    expect(result.findings.map((entry) => entry.ruleCode)).toEqual([
      'MANIFEST_IDENTITY_MISMATCH',
      'VALIDATOR_PROFILE_MISMATCH',
      'ZIP_INVALID',
    ]);
    expect(
      result.findings.every(
        (entry) =>
          !entry.message.includes('/') &&
          !/stack|cause|secret|authorization|bearer/iu.test(entry.message),
      ),
    ).toBe(true);
    expect(canonicalizeJson(result.profile)).toBe(canonicalizeJson(foreignProfile));
  });

  it('fails every forged manifest provenance field even when archive bytes are unchanged', async () => {
    const fixture = await createFixtureExport();
    if (fixture.result.artifact.mediaType !== 'application/zip') {
      throw new TypeError('Expected ZIP artifact.');
    }
    const manifests = [
      {
        ...fixture.result.manifest,
        sceneVersionId: 'aaaaaaaa-aaaa-5aaa-8aaa-aaaaaaaaaaaa',
      },
      { ...fixture.result.manifest, sceneRevision: 2 },
      {
        ...fixture.result.manifest,
        sceneWorkflow: {
          ...fixture.result.manifest.sceneWorkflow,
          definitionSha256: 'a'.repeat(64),
        },
      },
      {
        ...fixture.result.manifest,
        exportWorkflow: {
          ...fixture.result.manifest.exportWorkflow,
          definitionSha256: 'b'.repeat(64),
        },
      },
      {
        ...fixture.result.manifest,
        exporter: { ...fixture.result.manifest.exporter, exporterVersion: 2 },
      },
    ] as const;

    for (const manifest of manifests) {
      const validator = createProviderFreeInternalValidatorV1({
        exportRequest: fixture.request,
        manifest: manifest as typeof fixture.result.manifest,
      });
      const result = await validator.validate({
        artifact: fixture.result.artifact,
        profile: PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1,
      });

      expect(result.outcome).toBe('internal-check-failed');
      expect(result.findings.map((entry) => entry.ruleCode)).toContain(
        'MANIFEST_IDENTITY_MISMATCH',
      );
    }
  });

  it('rejects coupled request and manifest forgeries against the fixed export identities', async () => {
    const fixture = await createFixtureExport();
    if (fixture.result.artifact.mediaType !== 'application/zip') {
      throw new TypeError('Expected ZIP artifact.');
    }
    const exportRequest = BannerExportRequestSchema.parse({
      ...fixture.request,
      exportWorkflow: {
        workflowVersionId: '33333333-3333-5333-8333-333333333333',
        workflowVersion: fixture.request.exportWorkflow.workflowVersion + 1,
        definitionSha256: 'a'.repeat(64),
      },
      exporter: {
        exporterId: 'exporter_coupled_forgery_v1',
        exporterVersion: fixture.request.exporter.exporterVersion + 1,
        buildSha256: 'b'.repeat(64),
      },
    });
    const validator = createProviderFreeInternalValidatorV1({
      exportRequest,
      manifest: {
        ...fixture.result.manifest,
        exportWorkflow: exportRequest.exportWorkflow,
        exporter: exportRequest.exporter,
      },
    });
    const result = await validator.validate({
      artifact: fixture.result.artifact,
      profile: PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1,
    });

    expect(result.outcome).toBe('internal-check-failed');
    expect(result.findings.map((entry) => entry.ruleCode)).toEqual([
      'EXPORTER_IDENTITY_MISMATCH',
      'EXPORT_WORKFLOW_IDENTITY_MISMATCH',
    ]);
    expect(result.findings.map((entry) => entry.ruleCode)).not.toContain(
      'MANIFEST_IDENTITY_MISMATCH',
    );
  });
});
