import { describe, expect, it } from 'vitest';
import {
  materializeProviderFreePersonSamCandidateProjectV1,
  PROVIDER_FREE_PERSON_SAM_CANDIDATES_V1,
} from '../src/server/sam-box-prompt-layer-extraction.js';

describe('preserved Meta SAM automatic candidate catalog', () => {
  it('contains exactly eight ordered strict candidates with unique identities', () => {
    expect(PROVIDER_FREE_PERSON_SAM_CANDIDATES_V1).toHaveLength(8);
    expect(
      PROVIDER_FREE_PERSON_SAM_CANDIDATES_V1.map((candidate) => candidate.candidateId),
    ).toHaveLength(8);
    expect(
      PROVIDER_FREE_PERSON_SAM_CANDIDATES_V1.map((candidate) => candidate.mask.encoding),
    ).toEqual(Array(8).fill('fabrica-binary-rle-v1'));
  });

  it('materializes a non-default candidate from embedded RLE and preserves its cutout digest', async () => {
    const candidate = PROVIDER_FREE_PERSON_SAM_CANDIDATES_V1[0]!;
    const project = await materializeProviderFreePersonSamCandidateProjectV1(candidate.candidateId);
    expect(project.scene.layers).toHaveLength(1);
    expect(project.scene.layers[0]!.asset.sha256).toBe(
      'efa97f238a11d55d31e0438887bddece3de757f2b4abf117c8f1895553977022',
    );
    expect(project.scene.layers[0]!.frame).toEqual({ x: 258, y: 62, width: 42, height: 26 });
  });

  it('materializes every preserved candidate with its pinned cutout identity', async () => {
    const projects = await Promise.all(
      PROVIDER_FREE_PERSON_SAM_CANDIDATES_V1.map((candidate) =>
        materializeProviderFreePersonSamCandidateProjectV1(candidate.candidateId),
      ),
    );
    expect(projects.map((project) => project.candidateId)).toHaveLength(8);
    expect(new Set(projects.map((project) => project.scene.layers[0]!.asset.sha256)).size).toBe(8);
    expect(projects.every((project) => project.scene.layers.length === 1)).toBe(true);
  });

  it('rejects unknown candidate IDs before materialization', async () => {
    await expect(materializeProviderFreePersonSamCandidateProjectV1('unknown')).rejects.toThrow(
      'Unknown preserved Meta SAM candidate',
    );
  });
});
