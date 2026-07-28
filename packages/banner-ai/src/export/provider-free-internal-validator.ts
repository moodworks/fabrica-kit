import {
  BannerExportRequestSchema,
  GdnValidationRequestSchema,
  GdnValidationResultSchema,
  validateInternalGdnValidationResult,
  type BannerExportRequest,
  type GdnValidationPort,
  type GdnValidationResult,
} from '../ports/banner-capability-ports.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import { ValidatorProfileRefV1Schema, type Sha256Hex } from '../scene/banner-scene-v1.schema.js';
import {
  ExportReproductionManifestV1Schema,
  SceneVersionIdSchema,
  validateExportReproductionManifestV1,
  type ExportReproductionManifestV1,
} from '../scene/export-reproduction-manifest-v1.schema.js';
import {
  createDeterministicFakeZipEntriesV1,
  PROVIDER_FREE_EXPORTER_V1,
} from './deterministic-fake-exporter.js';
import { createExactZipContentPolicy, inspectZipBytes, ZipSecurityError } from './zip-inspector.js';
import { PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_V1 } from '../workflows/workflow-definition.js';
import { PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_REF_V1 } from './provider-free-export-identities-v1.js';

const providerFreeInternalRulesDefinitionV1 = Object.freeze({
  rulesDefinitionVersion: 1 as const,
  label: 'internal-provider-free-not-gdn' as const,
  canvas: Object.freeze({ width: 300 as const, height: 200 as const }),
  entryPoint: 'index.html' as const,
  requiredEntries: Object.freeze([
    'index.html',
    'styles.css',
    'runtime.js',
    'scene.json',
    'INTERNAL-NON-GDN.txt',
  ] as const),
  checks: Object.freeze([
    'bounded-zip-structure',
    'exporter-owned-executable-content',
    'scene-and-profile-binding',
    'included-asset-graph',
    'single-exit-runtime',
    'no-remote-render-dependencies',
    'manifest-artifact-equality',
  ] as const),
});

const computedProviderFreeValidatorRulesSha256 = sha256Hex(
  Buffer.from(canonicalizeJson(providerFreeInternalRulesDefinitionV1), 'utf8'),
);
if (
  computedProviderFreeValidatorRulesSha256 !==
  PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_REF_V1.rulesSha256
) {
  throw new TypeError('The provider-free internal validator rules identity drifted.');
}
export const PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1 = ValidatorProfileRefV1Schema.parse(
  PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_REF_V1,
);

const providerFreeExportWorkflowRefV1 = Object.freeze({
  workflowVersionId: PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_V1.workflowVersionId,
  workflowVersion: PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_V1.workflowVersion,
  definitionSha256: PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_V1.definitionSha256,
});

interface InternalFinding {
  readonly ruleCode: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly entryPath: string | null;
}

const finding = (
  ruleCode: string,
  message: string,
  entryPath: string | null = null,
): InternalFinding => ({ ruleCode, severity: 'error', message, entryPath });

const compareFindings = (left: InternalFinding, right: InternalFinding): number => {
  const severity = left.severity === right.severity ? 0 : left.severity === 'error' ? -1 : 1;
  return (
    severity ||
    (left.ruleCode < right.ruleCode ? -1 : left.ruleCode > right.ruleCode ? 1 : 0) ||
    ((left.entryPath ?? '') < (right.entryPath ?? '')
      ? -1
      : (left.entryPath ?? '') > (right.entryPath ?? '')
        ? 1
        : 0)
  );
};

const outputFor = (artifact: {
  readonly mediaType: 'application/zip';
  readonly byteSize: number;
  readonly sha256: Sha256Hex;
}) => ({
  mediaType: artifact.mediaType,
  byteSize: artifact.byteSize,
  sha256: artifact.sha256,
});

export const createProviderFreeInternalValidatorV1 = (input: {
  readonly exportRequest: BannerExportRequest;
  readonly manifest: ExportReproductionManifestV1;
}): GdnValidationPort => {
  const exportRequest = BannerExportRequestSchema.parse(input.exportRequest);
  const manifest = ExportReproductionManifestV1Schema.parse(input.manifest);
  const expectedEntries = createDeterministicFakeZipEntriesV1({
    scene: exportRequest.scene,
    assets: exportRequest.assets,
  });

  return {
    async validate(requestInput) {
      const request = GdnValidationRequestSchema.parse(requestInput);
      const findings: InternalFinding[] = [];

      if (
        canonicalizeJson(request.profile) !==
        canonicalizeJson(PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1)
      ) {
        findings.push(
          finding(
            'VALIDATOR_PROFILE_MISMATCH',
            'Retry with the fixed internal provider-free validator profile.',
          ),
        );
      }
      if (
        canonicalizeJson(exportRequest.exportWorkflow) !==
        canonicalizeJson(providerFreeExportWorkflowRefV1)
      ) {
        findings.push(
          finding(
            'EXPORT_WORKFLOW_IDENTITY_MISMATCH',
            'Retry the export with the fixed provider-free export workflow.',
          ),
        );
      }
      if (
        canonicalizeJson(exportRequest.exporter) !== canonicalizeJson(PROVIDER_FREE_EXPORTER_V1)
      ) {
        findings.push(
          finding(
            'EXPORTER_IDENTITY_MISMATCH',
            'Retry the export with the fixed provider-free exporter.',
          ),
        );
      }
      if (
        exportRequest.scene.exportSettings.kind !== 'gdn-html5' ||
        canonicalizeJson(exportRequest.scene.exportSettings.validatorProfile) !==
          canonicalizeJson(PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_V1)
      ) {
        findings.push(
          finding(
            'SCENE_PROFILE_MISMATCH',
            'Return to the project and retry from its accepted export profile.',
            'scene.json',
          ),
        );
      }
      if (exportRequest.scene.canvas.width !== 300 || exportRequest.scene.canvas.height !== 200) {
        findings.push(
          finding(
            'CANVAS_PROFILE_MISMATCH',
            'Return to the fixed 300 by 200 provider-free project.',
            'scene.json',
          ),
        );
      }

      try {
        await inspectZipBytes(request.artifact.bytes, {
          contentPolicy: createExactZipContentPolicy(expectedEntries),
        });
      } catch (error) {
        findings.push(
          error instanceof ZipSecurityError
            ? finding(
                error.code,
                'Generate the package again from the same accepted scene revision.',
              )
            : finding(
                'VALIDATOR_INTERNAL_ERROR',
                'Retry the internal check for the same accepted scene revision.',
              ),
        );
      }

      const manifestValidation = validateExportReproductionManifestV1(manifest, {
        scene: exportRequest.scene,
        sceneVersionId: SceneVersionIdSchema.parse(exportRequest.sceneVersionId),
        sceneRevision: exportRequest.sceneRevision,
        sceneWorkflow: exportRequest.sceneWorkflow,
        exportWorkflow: exportRequest.exportWorkflow,
        exporter: exportRequest.exporter,
        output: outputFor(request.artifact),
      });
      if (!manifestValidation.success) {
        findings.push(
          finding(
            'MANIFEST_IDENTITY_MISMATCH',
            'Generate the package again from the same accepted scene revision.',
          ),
        );
      }

      const sorted = findings.sort(compareFindings);
      const result = GdnValidationResultSchema.parse({
        validationLabel: 'internal-provider-free-not-gdn',
        artifactSha256: request.artifact.sha256,
        profile: request.profile,
        outcome: sorted.some((entry) => entry.severity === 'error')
          ? 'internal-check-failed'
          : 'internal-check-passed',
        findings: sorted,
      });
      return validateInternalGdnValidationResult({ request, result }) as GdnValidationResult;
    },
  };
};
