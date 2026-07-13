import type { BannerAnalysisData } from './banner-ai-contract';

export const sampleBannerAnalysisData: BannerAnalysisData = {
  source: {
    displayFilename: 'angel.png',
    sourceMediaType: 'image/png',
    normalizedMediaType: 'image/png',
    normalizedByteSize: 512,
    width: 300,
    height: 250,
    sha256: 'a'.repeat(64),
  },
  proposal: {
    kind: 'composition_proposal',
    proposalVersion: 1,
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
  },
  provenance: {
    fixture: {
      capability: 'fixture_replay',
      providerKey: 'fixture',
      modelKey: 'phase1a-fixture-v1',
    },
    workflow: {
      workflowVersionId: '11111111-1111-5111-8111-111111111111',
      workflowVersion: 1,
      definitionSha256: 'b'.repeat(64),
    },
    policyVersion: 1,
    external: false,
    outboundNetworkEnabled: false,
    estimatedCostMicros: '0',
    currency: 'USD',
    elapsedMs: 4.2,
    ownership: {
      mode: 'development-local',
      requestId: 'banner-ai:00000000-0000-4000-8000-000000000001',
    },
  },
};
