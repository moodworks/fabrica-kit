import { ValidatorProfileRefV1Schema } from '../scene/banner-scene-v1.schema.js';
import {
  ExporterManifestRefV1Schema,
  WorkflowManifestRefV1Schema,
} from '../scene/export-reproduction-manifest-v1.contract.js';

export const PROVIDER_FREE_EXPORT_VALIDATION_LABEL_V1 = 'internal-provider-free-not-gdn' as const;

export const PROVIDER_FREE_BANNER_EXPORT_WORKFLOW_REF_V1 = Object.freeze(
  WorkflowManifestRefV1Schema.parse({
    workflowVersionId: '22222222-2222-5222-8222-222222222222',
    workflowVersion: 1,
    definitionSha256: '88d7bfe729ac99474172944bbf2de27c650dccd858c54f2acbfacb3dce1f4355',
  }),
);

export const PROVIDER_FREE_EXPORTER_REF_V1 = Object.freeze(
  ExporterManifestRefV1Schema.parse({
    exporterId: 'exporter_provider_free_html5_v1',
    exporterVersion: 1,
    buildSha256: 'f3ad1dd6128df6986515badd28115416b59e2ae7d14b82b524b2d064fe812504',
  }),
);

export const PROVIDER_FREE_INTERNAL_VALIDATOR_PROFILE_REF_V1 = Object.freeze(
  ValidatorProfileRefV1Schema.parse({
    validatorProfileId: 'validator_provider_free_internal_v1',
    validatorProfileVersion: 1,
    rulesSha256: '2193e3352520f6ad608c81ded65ab3b3d595c9921728fe5e266a13a8235f993f',
  }),
);
