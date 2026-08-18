import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { canonicalizeJson } from '../scene/canonical-scene-json.js';
import { assertCanonicalNormalizedPng } from '../security/raster-container.js';
import { materializeSamMaskCutout } from '../sam/sam-cutout-materializer.js';
import { parseAndVerifySamMaskResponse } from '../sam/sam-mask-validation.js';
import { parseAndVerifySamMaskRequest } from '../sam/sam-mask-validation.js';
import {
  SamMaskRequestSchema,
  SAM_MASK_CONTRACT_VERSION,
  SAM_MASK_ENCODING,
} from '../sam/sam-mask-contracts.js';
import { createBoundedLayerPreview } from './sam-box-prompt-layer-extraction.js';
import { canonicalResponseSha256 } from '../sam/sam-mask-rle.js';
import type {
  UploadedBannerSamOperationResult,
  UploadedBannerSamCandidate,
} from './uploaded-banner-sam-operation-v1.js';

export const SAM_SAMSUNG_REPLAY_PROVENANCE =
  'Verified Meta SAM 2.1 user box-prompt replay — no live call' as const;
const SOURCE_SHA256 = 'd806659c8572dd32c6db89f9af71eda38c1e644c47210498fff6dedaf0896b04';
const OPERATION_ID =
  'sam-samsung-manual-box-live-v1-33ee8796c5bc6ab49b5656ff3b8d81f9b9c07d2b84f75beaa60003f60650a96e';
const REPORT_SHA256 = '5a265d1dc8405d2916691e0f666303ab2d6317f4ab2991809a1de1ddf5873ca4';
const RESPONSE_SHA256 = '68582370dccc60889dc161717a6d34ee472126ef7a8a26a22bc3bb2a701cbf88';
const CLAIM_SHA256 = '054d866e81a9a5608b7f3b2f66016a99df5fa16d77d8faab2c02be2692dd4cc5';
const RESPONSE_SEMANTIC_SHA256 = '4fbcc1380f809c2c8069ef328e2d98ffef72ca2381e2162bcef2bca61cf7d40e';
const CUTOUT_SHA256 = '1dc52701797254546be7c494119bdf2ee6076c538fff0207c3ec976a74575cb5';
const MASK_SHA256 = '776a56d5592fe2facc2ebbf5c0de64504ebee44d612bcc09bb48a1eff8f9faa2';
const CANDIDATE_ID = 'samc_v1_5d30b0cbbf54dadc3455193a306f2c81d2acd30163adcc968f1d91092808f7e0';
const MODEL = {
  kind: 'meta-sam2.1' as const,
  repositoryUrl: 'https://github.com/facebookresearch/sam2' as const,
  repositoryCommit: '05d9e57fb3945b10c861046c1e6749e2bfc258e3' as const,
  modelId: 'sam2.1_hiera_base_plus' as const,
  configIdentity: 'configs/sam2.1/sam2.1_hiera_b+.yaml' as const,
  checkpointUrl:
    'https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt' as const,
  checkpointSha256: 'a2345aede8715ab1d5d31b4a509fb160c5a4af1970f199d9054ccfb746c004c5' as const,
  workerImageDigest:
    'sha256:5f6058eb5f626ada2ce9ad3e9f105cd12b601f614df83265ab8479c8403ae7a8' as const,
};
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const evidence = resolve(
  root,
  '.local-data/banner-ai/sam-samsung-manual-box-live-v1',
  OPERATION_ID,
);
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const readArtifact = async (name: string) => {
  const h = await open(resolve(evidence, name), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = await h.stat();
    if (!s.isFile()) throw new Error('Replay artifact is not a file.');
    return new Uint8Array(await h.readFile());
  } finally {
    await h.close();
  }
};
export const loadSamsungManualBoxReplay = async (
  source: Uint8Array,
  input?: { requestId?: string; workspaceId?: string; jobId?: string; attemptId?: string },
): Promise<UploadedBannerSamOperationResult & { readonly response: unknown }> => {
  if (hash(source) !== SOURCE_SHA256 || source.byteLength !== 30726)
    throw new Error('Samsung replay source mismatch.');
  const dimensions = assertCanonicalNormalizedPng(source);
  if (dimensions.width !== 255 || dimensions.height !== 512)
    throw new Error('Samsung replay dimensions mismatch.');
  const reportBytes = await readArtifact('report.json');
  if (hash(reportBytes) !== REPORT_SHA256)
    throw new Error('Samsung replay report evidence mismatch.');
  const claimBytes = await readArtifact('claim.json');
  if (hash(claimBytes) !== CLAIM_SHA256) throw new Error('Samsung replay claim evidence mismatch.');
  const report = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(Buffer.from(reportBytes).toString('utf8')));
  if (
    report.operationId !== OPERATION_ID ||
    report.terminalClassification !== 'success' ||
    report.dispatchCount !== 1 ||
    report.retryCount !== 0 ||
    report.pollCount !== 0 ||
    report.endpointId !== 'sawwuq4u7oiftj' ||
    report.status !== 200 ||
    report.costMaximumMicroUsd !== 250000 ||
    report.providerBillingGuarantee !== false ||
    report.canonicalRequestSha256 !==
      '55a79b2664abf73f4654d37f376b448fae89512d49b11dbb0055f0bac4cc91ae'
  )
    throw new Error('Samsung replay report metadata mismatch.');
  const responseBytes = await readArtifact('response.json');
  if (hash(responseBytes) !== RESPONSE_SHA256)
    throw new Error('Samsung replay response evidence mismatch.');
  const stored = JSON.parse(Buffer.from(responseBytes).toString('utf8')) as Record<string, unknown>;
  if (stored.responseSha256 !== RESPONSE_SEMANTIC_SHA256 || stored.sourceSha256 !== SOURCE_SHA256)
    throw new Error('Samsung replay response metadata mismatch.');
  const sourceMeta = report.source;
  const cropMeta = report.crop;
  const boundsMeta = report.workerRoundtripBounds;
  if (
    !sourceMeta ||
    typeof sourceMeta !== 'object' ||
    JSON.stringify(sourceMeta) !==
      JSON.stringify({ sha256: SOURCE_SHA256, byteSize: 30726, width: 255, height: 512 }) ||
    !cropMeta ||
    JSON.stringify(cropMeta) !== JSON.stringify({ left: 14, top: 77, width: 141, height: 134 }) ||
    !boundsMeta ||
    JSON.stringify(boundsMeta) !==
      JSON.stringify({ xBps: 550, yBps: 1504, widthBps: 5528, heightBps: 2617 }) ||
    report.workerImageDigest !== MODEL.workerImageDigest ||
    report.responseSha256 !== RESPONSE_SEMANTIC_SHA256 ||
    report.cutoutSha256 !== CUTOUT_SHA256 ||
    report.maskSha256 !== '7781870aab3fe7da2616ddf8b9ec891c5e778d60110f61cab2be4dc80cb07175' ||
    report.claimSha256 !== CLAIM_SHA256
  )
    throw new Error('Samsung replay evidence identities mismatch.');
  const storedCandidate = (stored.candidates as unknown[] | undefined)?.[0] as
    Record<string, unknown> | undefined;
  if (
    !storedCandidate ||
    stored.candidateCount !== 1 ||
    (stored.candidates instanceof Array && stored.candidates.length !== 1) ||
    storedCandidate.candidateId !== CANDIDATE_ID ||
    JSON.stringify(storedCandidate.bounds) !==
      JSON.stringify({ xBps: 627, yBps: 1660, widthBps: 5373, heightBps: 2325 }) ||
    storedCandidate.pixelArea !== 5838 ||
    storedCandidate.predictedIouBps !== 7031 ||
    storedCandidate.stabilityScoreBps !== 8274 ||
    (storedCandidate.mask as Record<string, unknown>)?.sha256 !==
      '7781870aab3fe7da2616ddf8b9ec891c5e778d60110f61cab2be4dc80cb07175'
  )
    throw new Error('Samsung replay candidate metadata mismatch.');
  const request = SamMaskRequestSchema.parse({
    contractVersion: SAM_MASK_CONTRACT_VERSION,
    requestId: input?.requestId ?? String(stored.requestId),
    workspaceId: input?.workspaceId ?? String(stored.workspaceId),
    jobId: input?.jobId ?? String(stored.jobId),
    attemptId: input?.attemptId ?? String(stored.attemptId),
    source: {
      mediaType: 'image/png',
      byteSize: source.byteLength,
      width: 255,
      height: 512,
      sha256: SOURCE_SHA256,
      pngBase64: Buffer.from(source).toString('base64'),
    },
    segmentation: {
      mode: 'box-prompt',
      prompt: {
        kind: 'box',
        authority: 'user-interaction',
        box: { xBps: 550, yBps: 1504, widthBps: 5528, heightBps: 2617 },
      },
    },
    limits: { minMaskAreaPixels: 1, maxCandidates: 1 },
    output: { maskEncoding: SAM_MASK_ENCODING },
  });
  const unsignedResponse: Record<string, unknown> = {
    ...stored,
    requestId: request.requestId,
    workspaceId: request.workspaceId,
    jobId: request.jobId,
    attemptId: request.attemptId,
  };
  const responseWithoutDigest = { ...unsignedResponse };
  delete responseWithoutDigest.responseSha256;
  const response = {
    ...responseWithoutDigest,
    responseSha256: canonicalResponseSha256(responseWithoutDigest as never),
  };
  const strict = parseAndVerifySamMaskResponse({
    response,
    request,
    expectedExecutionKind: 'meta-sam2.1',
  });
  if (
    strict.candidates.length !== 1 ||
    strict.candidates[0]!.candidateId !== CANDIDATE_ID ||
    canonicalizeJson(strict.executionIdentity) !== canonicalizeJson(MODEL)
  )
    throw new Error('Samsung replay candidate identity mismatch.');
  const materialization = await materializeSamMaskCutout({
    trustedRequest: request,
    candidate: strict.candidates[0]!,
  });
  const cutout = await readArtifact('candidate-1.cutout.png');
  const mask = await readArtifact('candidate-1.mask.png');
  if (
    hash(cutout) !== CUTOUT_SHA256 ||
    hash(mask) !== MASK_SHA256 ||
    hash(materialization.cutoutPng) !== CUTOUT_SHA256 ||
    hash(materialization.binaryMaskPng) !== MASK_SHA256
  )
    throw new Error('Samsung replay materialization mismatch.');
  const candidate: UploadedBannerSamCandidate = Object.freeze({
    ...strict.candidates[0]!,
    materialization,
    preview: await createBoundedLayerPreview(cutout),
  });
  return Object.freeze({
    request,
    response: strict,
    candidates: Object.freeze([candidate]),
    provenance: SAM_SAMSUNG_REPLAY_PROVENANCE,
  });
};

export const createSamsungManualBoxReplayGenerator = () => ({
  generate: async (request: import('../sam/sam-mask-contracts.js').SamMaskRequest) => {
    const trusted = parseAndVerifySamMaskRequest(request).request;
    if (
      trusted.source.sha256 !== SOURCE_SHA256 ||
      trusted.source.byteSize !== 30726 ||
      trusted.source.width !== 255 ||
      trusted.source.height !== 512 ||
      trusted.segmentation.mode !== 'box-prompt' ||
      trusted.segmentation.prompt.authority !== 'user-interaction' ||
      trusted.segmentation.prompt.box.xBps !== 550 ||
      trusted.segmentation.prompt.box.yBps !== 1504 ||
      trusted.segmentation.prompt.box.widthBps !== 5528 ||
      trusted.segmentation.prompt.box.heightBps !== 2617 ||
      trusted.limits.minMaskAreaPixels !== 1 ||
      trusted.limits.maxCandidates !== 1 ||
      trusted.output.maskEncoding !== SAM_MASK_ENCODING
    )
      throw new Error('Samsung replay prompt mismatch.');
    const source = Buffer.from(trusted.source.pngBase64, 'base64');
    const loaded = await loadSamsungManualBoxReplay(source, trusted);
    return parseAndVerifySamMaskResponse({
      response: loaded.response,
      request,
      expectedExecutionKind: 'meta-sam2.1',
    });
  },
});
