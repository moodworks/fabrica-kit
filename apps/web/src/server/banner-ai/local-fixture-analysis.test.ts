import { describe, expect, it, vi } from 'vitest';

import { sampleBannerAnalysisData } from '../../features/banner-ai/banner-ai.test-fixtures';
import { resolveDevelopmentActorWorkspaceContext } from './development-context';
import { analyzeBannerWithLocalFixture } from './local-fixture-analysis';
import { createRasterFile } from './raster.test-fixtures';

describe('trusted local Banner AI fixture', () => {
  it.each([
    ['png', 'image/png'],
    ['jpeg', 'image/jpeg'],
  ] as const)(
    'normalizes a trusted %s upload before fixture analysis',
    async (kind, sourceType) => {
      const outboundFetch = vi.fn();
      vi.stubGlobal('fetch', outboundFetch);
      const result = await analyzeBannerWithLocalFixture(
        createRasterFile(kind),
        resolveDevelopmentActorWorkspaceContext(),
      );

      expect(result.source).toMatchObject({
        displayFilename: `angel.${kind}`,
        sourceMediaType: sourceType,
        normalizedMediaType: 'image/png',
        width: 12,
        height: 8,
      });
      expect(result.source.normalizedByteSize).toBeGreaterThan(0);
      expect(result.source.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(result.proposal.parts).toHaveLength(4);
      expect(result.proposal.parts.map((part) => [part.label, part.role])).toEqual([
        ['Background', 'background'],
        ['Angel body', 'subject'],
        ['Left wing', 'decoration'],
        ['Right wing', 'decoration'],
      ]);
      expect(result.provenance).toMatchObject({
        fixture: sampleBannerAnalysisData.provenance.fixture,
        workflow: { workflowVersionId: '11111111-1111-5111-8111-111111111111' },
        policyVersion: 1,
        external: false,
        outboundNetworkEnabled: false,
        estimatedCostMicros: '0',
        currency: 'USD',
        ownership: { mode: 'development-local' },
      });
      expect(result.provenance.ownership.requestId).toMatch(/^banner-ai:/);
      expect(outboundFetch).not.toHaveBeenCalled();
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain('actorId');
      expect(serialized).not.toContain('workspaceId');
    },
  );
});
