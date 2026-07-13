import { performance } from 'node:perf_hooks';

import {
  AssetVersionRefV1Schema,
  CompositionAnalysisRequestV1Schema,
  CompositionAnalysisResultV1Schema,
  INITIAL_BANNER_ANALYZE_WORKFLOW_V1,
  PROVIDER_FREE_COMPOSITION_POLICY,
  byteSourceFrom,
  checkedEpochAdd,
  compositionAnalysisRequestSha256,
  createActorWorkspaceContext,
  createFixtureUsageReservationIdentity,
  createProviderFreeCompositionAnalysisFixturePort,
  dispatchProviderFreeCompositionAnalysis,
  estimateProviderFreeCompositionAnalysis,
  normalizeRasterUpload,
  type ActorWorkspaceContext,
  type NormalizedRasterUpload,
} from '@fabrica/banner-ai';

import type { BannerAnalysisData } from '../../features/banner-ai/banner-ai-contract';

const currency = 'USD';

const createSourceAssetReference = (normalized: NormalizedRasterUpload) =>
  AssetVersionRefV1Schema.parse({
    assetId: `asset_${normalized.sha256.slice(0, 58)}`,
    assetVersionId: `version_${normalized.sha256.slice(0, 56)}`,
    sha256: normalized.sha256,
    mediaType: normalized.mediaType,
    byteSize: normalized.byteSize,
    pixelWidth: normalized.width,
    pixelHeight: normalized.height,
  });

const createFixtureProposal = (sourceAssetSha256: string) =>
  CompositionAnalysisResultV1Schema.parse({
    kind: 'composition_proposal',
    proposalVersion: 1,
    sourceAssetSha256,
    parts: [
      {
        partKey: 'background',
        label: 'Background',
        role: 'background',
        bounds: { xBps: 0, yBps: 0, widthBps: 10_000, heightBps: 10_000 },
      },
      {
        partKey: 'angel.body',
        label: 'Angel body',
        role: 'subject',
        bounds: { xBps: 3_500, yBps: 1_500, widthBps: 3_000, heightBps: 8_000 },
      },
      {
        partKey: 'wing.left',
        label: 'Left wing',
        role: 'decoration',
        bounds: { xBps: 500, yBps: 1_800, widthBps: 3_500, heightBps: 6_000 },
      },
      {
        partKey: 'wing.right',
        label: 'Right wing',
        role: 'decoration',
        bounds: { xBps: 6_000, yBps: 1_800, widthBps: 3_500, heightBps: 6_000 },
      },
    ],
  });

const normalizeTrustedFile = async (file: File): Promise<NormalizedRasterUpload> => {
  const encoded = new Uint8Array(await file.arrayBuffer());
  return normalizeRasterUpload({
    bytes: byteSourceFrom(encoded),
    declaredMediaType: file.type,
    filename: file.name,
  });
};

export const analyzeBannerWithLocalFixture = async (
  file: File,
  authorityInput: ActorWorkspaceContext,
): Promise<BannerAnalysisData> => {
  const startedAt = performance.now();
  const authority = createActorWorkspaceContext(authorityInput);
  const normalized = await normalizeTrustedFile(file);
  const sourceAsset = createSourceAssetReference(normalized);
  const request = CompositionAnalysisRequestV1Schema.parse({
    sourceAsset,
    maxParts: 4,
    includeBackground: true,
  });
  const proposal = createFixtureProposal(sourceAsset.sha256);
  const nowMs = Date.now();
  const fixture = createProviderFreeCompositionAnalysisFixturePort({
    initialNowMs: nowMs,
    currency,
    fixtures: [{ request, outcomes: [{ kind: 'success', result: proposal }] }],
  });
  const estimate = await estimateProviderFreeCompositionAnalysis({
    policy: PROVIDER_FREE_COMPOSITION_POLICY,
    port: fixture.port,
    request,
  });
  const usage = createFixtureUsageReservationIdentity(
    INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
    estimate.currency,
  );
  const result = await dispatchProviderFreeCompositionAnalysis({
    policy: PROVIDER_FREE_COMPOSITION_POLICY,
    port: fixture.port,
    descriptor: {
      adapter: {
        capability: usage.capability,
        providerKey: usage.providerKey,
        modelKey: usage.modelKey,
        external: usage.external,
      },
      usage,
    },
    request,
    context: {
      deadlineAtMs: checkedEpochAdd(
        nowMs,
        INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definition.policy.maxCapabilityCallMs,
      ),
      externalIdempotencyKey: compositionAnalysisRequestSha256(request),
      cancellation: Object.freeze({
        cancelled: false,
        throwIfCancelled(): void {},
      }),
    },
  });
  if (result.kind !== 'composition_proposal') {
    throw new TypeError('The local fixture did not return a composition proposal.');
  }

  return {
    source: {
      displayFilename: normalized.displayFilename,
      sourceMediaType: normalized.sourceMediaType,
      normalizedMediaType: normalized.mediaType,
      normalizedByteSize: normalized.byteSize,
      width: normalized.width,
      height: normalized.height,
      sha256: normalized.sha256,
    },
    proposal: {
      kind: result.kind,
      proposalVersion: result.proposalVersion,
      parts: result.parts,
    },
    provenance: {
      fixture: {
        capability: usage.capability,
        providerKey: usage.providerKey,
        modelKey: usage.modelKey,
      },
      workflow: {
        workflowVersionId: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersionId,
        workflowVersion: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.workflowVersion,
        definitionSha256: INITIAL_BANNER_ANALYZE_WORKFLOW_V1.definitionSha256,
      },
      policyVersion: PROVIDER_FREE_COMPOSITION_POLICY.policyVersion,
      external: usage.external,
      outboundNetworkEnabled: false,
      estimatedCostMicros: estimate.micros.toString() as '0',
      currency: estimate.currency,
      elapsedMs: Math.round((performance.now() - startedAt) * 10) / 10,
      ownership: {
        mode: 'development-local',
        requestId: authority.requestId,
      },
    },
  };
};
