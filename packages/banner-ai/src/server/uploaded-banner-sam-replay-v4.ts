import { createHash } from 'node:crypto';
import { constants as F, existsSync, readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { dirname } from 'node:path';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { z } from 'zod';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import { assertCanonicalNormalizedPng } from '../security/raster-container.js';
import { createBoundedLayerPreview } from './sam-box-prompt-layer-extraction.js';
import {
  encodeBinaryMaskRle,
  encodeCanonicalBase64,
  deriveSamCandidateId,
  maskContentSha256,
  pixelBoundsToBasisPoints,
} from '../sam/sam-mask-rle.js';
import { materializeSamMaskCutout } from '../sam/sam-cutout-materializer.js';
import {
  SamMaskRequestSchema,
  SAM_MASK_CONTRACT_VERSION,
  SAM_MASK_ENCODING,
  SamMaskCandidateSchema,
  SamLiveExecutionIdentitySchema,
  type SamMaskRequest,
} from '../sam/sam-mask-contracts.js';
import type {
  UploadedBannerSamCandidate,
  UploadedBannerSamOperationResult,
} from './uploaded-banner-sam-operation-v1.js';

const findRoot = (): string => {
  const starts = [dirname(fileURLToPath(import.meta.url)), process.cwd()];
  for (const start of starts) {
    let current = resolve(start);
    for (let i = 0; i < 10; i += 1) {
      try {
        const packageJson = JSON.parse(readFileSync(join(current, 'package.json'), 'utf8')) as {
          name?: unknown;
        };
        if (packageJson.name === 'fabrica-kit' && existsSync(join(current, 'pnpm-workspace.yaml')))
          return current;
      } catch {
        /* continue bounded ancestor search */
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return fail('trusted repository root not found');
};
const SOURCE_SHA256 = 'd806659c8572dd32c6db89f9af71eda38c1e644c47210498fff6dedaf0896b04';
const evidencePath = (): string =>
  resolve(
    findRoot(),
    '.local-data/banner-ai/sam-samsung-live-v4/sam-samsung-live-v4-2098ae4e2e2091c6e0eb10f2f5561682a59785d102fa911b69d3e09ac5ee178a',
  );
const REPORT_SHA256 = 'a0ad1d997bad4945a7454db22cfc40e5981874122b895b09da8d5c6d48d2275c';
const RESPONSE_FILE_SHA256 = 'ab725431d201f5af2d8318dc9012e2b0dd5377e471ffaa30e07e5b6d7ece252a';
export class SamReplayError extends Error {
  constructor(
    readonly kind: 'SOURCE_MISMATCH' | 'EVIDENCE_INVALID',
    message: string,
  ) {
    super(message);
    this.name = 'SamReplayError';
  }
}
const fail = (
  message: string,
  kind: 'SOURCE_MISMATCH' | 'EVIDENCE_INVALID' = 'EVIDENCE_INVALID',
): never => {
  throw new SamReplayError(kind, message);
};
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const readFixed = async (base: string, name: string) => {
  if (!/^(?:report\.json|response\.json|candidate-[1-8]\.(?:mask|cutout)\.png)$/u.test(name))
    return fail('unsupported artifact filename');
  const p = resolve(base, name);
  const r = relative(base, p);
  if (r.startsWith('..') || resolve(base, r) !== p) return fail('artifact containment failure');
  const h = await open(p, F.O_RDONLY | F.O_NOFOLLOW);
  try {
    const s = await h.stat();
    if (!s.isFile()) return fail('artifact is not a regular file');
    return new Uint8Array(await h.readFile());
  } finally {
    await h.close();
  }
};
const uuid = (seed: string) =>
  `${seed.slice(0, 8)}-${seed.slice(8, 12)}-4${seed.slice(13, 16)}-8${seed.slice(17, 20)}-${seed.slice(20, 32)}`;
const modelIdentity = {
  kind: 'meta-sam2.1' as const,
  repositoryUrl: 'https://github.com/facebookresearch/sam2' as const,
  repositoryCommit: '05d9e57fb3945b10c861046c1e6749e2bfc258e3' as const,
  modelId: 'sam2.1_hiera_base_plus' as const,
  configIdentity: 'configs/sam2.1/sam2.1_hiera_b+.yaml' as const,
  checkpointUrl:
    'https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt' as const,
  checkpointSha256: 'a2345aede8715ab1d5d31b4a509fb160c5a4af1970f199d9054ccfb746c004c5',
  workerImageDigest: 'sha256:5f6058eb5f626ada2ce9ad3e9f105cd12b601f614df83265ab8479c8403ae7a8',
} as const;
const CandidateEvidence = z.strictObject({
  candidateId: z.string(),
  order: z.number().int(),
  bounds: z.strictObject({
    xBps: z.number().int(),
    yBps: z.number().int(),
    widthBps: z.number().int(),
    heightBps: z.number().int(),
  }),
  pixelArea: z.number().int(),
  predictedIouBps: z.number().int(),
  stabilityScoreBps: z.number().int(),
  maskSha256: z.string().length(64),
  cutout: z.strictObject({
    filename: z.string(),
    sha256: z.string().length(64),
    bytes: z.number().int(),
  }),
  binaryMask: z.strictObject({
    filename: z.string(),
    sha256: z.string().length(64),
    bytes: z.number().int(),
  }),
});
const ReportEvidence = z.strictObject({
  operationId: z.literal(
    'sam-samsung-live-v4-2098ae4e2e2091c6e0eb10f2f5561682a59785d102fa911b69d3e09ac5ee178a',
  ),
  endpointId: z.literal('sawwuq4u7oiftj'),
  preparedRequestSha256: z.literal(
    '9a8719169442a319d762cc1542e3a61656c10c24ec416b8ec09fdc6eba7a7cf5',
  ),
  sourceSha256: z.literal(SOURCE_SHA256),
  modelIdentity: SamLiveExecutionIdentitySchema,
  responseSha256: z.literal('a88ef2065883ce949ee3b2fec8f65993faf625d938c0e277125c1d19f32e2cfb'),
  candidates: z.array(CandidateEvidence).length(8),
  dispatchCount: z.literal(1),
  retryCount: z.literal(0),
  pollCount: z.literal(0),
  costMaximumMicroUsd: z.literal(250000),
  providerBillingGuarantee: z.literal(false),
  terminalClassification: z.literal('success'),
  providerTelemetry: z.strictObject({ status: z.literal(200), providerErrorCode: z.null() }),
});
const ResponseEvidence = z.strictObject({
  operationId: z.literal(
    'sam-samsung-live-v4-2098ae4e2e2091c6e0eb10f2f5561682a59785d102fa911b69d3e09ac5ee178a',
  ),
  endpointId: z.literal('sawwuq4u7oiftj'),
  preparedRequestSha256: z.literal(
    '9a8719169442a319d762cc1542e3a61656c10c24ec416b8ec09fdc6eba7a7cf5',
  ),
  sourceSha256: z.literal(SOURCE_SHA256),
  modelIdentity: SamLiveExecutionIdentitySchema,
  responseSha256: z.literal('a88ef2065883ce949ee3b2fec8f65993faf625d938c0e277125c1d19f32e2cfb'),
  candidates: z.array(CandidateEvidence).length(8),
  dispatchCount: z.literal(1),
  retryCount: z.literal(0),
  pollCount: z.literal(0),
  costMaximumMicroUsd: z.literal(250000),
  providerBillingGuarantee: z.literal(false),
});
export const loadSamsungSamV4Replay = async (
  source: Uint8Array,
): Promise<UploadedBannerSamOperationResult> => {
  if (hash(source) !== SOURCE_SHA256 || source.byteLength !== 30726)
    return fail('source identity mismatch', 'SOURCE_MISMATCH');
  const d = assertCanonicalNormalizedPng(source);
  if (d.width !== 255 || d.height !== 512)
    return fail('source dimensions mismatch', 'SOURCE_MISMATCH');
  const evidence = evidencePath();
  const rb = await readFixed(evidence, 'report.json');
  if (hash(rb) !== REPORT_SHA256) return fail('report digest mismatch');
  let report: z.infer<typeof ReportEvidence>;
  try {
    report = ReportEvidence.parse(JSON.parse(Buffer.from(rb).toString('utf8')));
  } catch {
    return fail('report schema invalid');
  }
  if (
    report.terminalClassification !== 'success' ||
    report.operationId !==
      'sam-samsung-live-v4-2098ae4e2e2091c6e0eb10f2f5561682a59785d102fa911b69d3e09ac5ee178a' ||
    report.sourceSha256 !== SOURCE_SHA256 ||
    report.dispatchCount !== 1 ||
    report.retryCount !== 0 ||
    report.pollCount !== 0 ||
    report.modelIdentity.kind !== modelIdentity.kind ||
    report.modelIdentity.repositoryUrl !== modelIdentity.repositoryUrl ||
    report.modelIdentity.repositoryCommit !== modelIdentity.repositoryCommit ||
    report.modelIdentity.modelId !== modelIdentity.modelId ||
    report.modelIdentity.configIdentity !== modelIdentity.configIdentity ||
    report.modelIdentity.checkpointUrl !== modelIdentity.checkpointUrl ||
    report.modelIdentity.checkpointSha256 !== modelIdentity.checkpointSha256 ||
    report.modelIdentity.workerImageDigest !== modelIdentity.workerImageDigest ||
    !Array.isArray(report.candidates) ||
    report.candidates.length !== 8
  )
    return fail('report metadata mismatch');
  const config = sha256Hex(
    Buffer.from(
      canonicalizeJson({
        operationNamespace: 'sam-samsung-live-v4',
        endpointId: 'sawwuq4u7oiftj',
        sourceSha256: SOURCE_SHA256,
        minMaskAreaPixels: 64,
        maxCandidates: 8,
        timeoutMs: 330000,
      }),
      'utf8',
    ),
  );
  const request = SamMaskRequestSchema.parse({
    contractVersion: SAM_MASK_CONTRACT_VERSION,
    requestId: uuid(config),
    workspaceId: uuid(config.slice(1) + config.slice(0, 1)),
    jobId: uuid(config.slice(2) + config.slice(0, 2)),
    attemptId: uuid(config.slice(3) + config.slice(0, 3)),
    source: {
      mediaType: 'image/png',
      byteSize: source.byteLength,
      width: d.width,
      height: d.height,
      sha256: SOURCE_SHA256,
      pngBase64: Buffer.from(source).toString('base64'),
    },
    segmentation: { mode: 'automatic-candidates', prompt: { kind: 'none' } },
    limits: { minMaskAreaPixels: 64, maxCandidates: 8 },
    output: { maskEncoding: SAM_MASK_ENCODING },
  }) as SamMaskRequest;
  const preparedRequestSha256 = sha256Hex(
    Buffer.from(
      canonicalizeJson({ ...request, workerImageDigest: modelIdentity.workerImageDigest }),
      'utf8',
    ),
  );
  if (preparedRequestSha256 !== report.preparedRequestSha256)
    return fail('prepared request digest mismatch');
  const responseBytes = await readFixed(evidence, 'response.json');
  if (sha256Hex(responseBytes) !== RESPONSE_FILE_SHA256)
    return fail('response artifact digest mismatch ' + sha256Hex(responseBytes));
  let response: z.infer<typeof ResponseEvidence>;
  try {
    response = ResponseEvidence.parse(JSON.parse(Buffer.from(responseBytes).toString('utf8')));
  } catch {
    return fail('response schema invalid');
  }
  if (response.responseSha256 !== report.responseSha256) return fail('response metadata mismatch');
  const candidates: UploadedBannerSamCandidate[] = [];
  for (const item of report.candidates) {
    if (item.order !== candidates.length + 1 || !/^samc_v1_[0-9a-f]{64}$/u.test(item.candidateId))
      return fail('candidate identity mismatch');
    const mb = await readFixed(evidence, item.binaryMask.filename);
    if (hash(mb) !== item.binaryMask.sha256 || mb.byteLength !== item.binaryMask.bytes)
      return fail('mask artifact digest mismatch');
    const raw = await sharp(mb).greyscale().raw().toBuffer({ resolveWithObject: true });
    if (
      raw.info.width !== 255 ||
      raw.info.height !== 512 ||
      raw.info.channels !== 1 ||
      raw.data.some((v) => v !== 0 && v !== 1 && v !== 255)
    )
      return fail('mask must be 255x512 binary grayscale');
    const pixels = Uint8Array.from(raw.data, (v) => (v === 0 ? 0 : 1));
    const maskSha = maskContentSha256(pixels, 255, 512);
    const rle = encodeBinaryMaskRle(pixels, 255, 512);
    const bounds = (() => {
      let minX = 255,
        minY = 512,
        maxX = -1,
        maxY = -1,
        area = 0;
      for (let i = 0; i < pixels.length; i++)
        if (pixels[i]) {
          area++;
          const x = i % 255,
            y = Math.floor(i / 255);
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1, area };
    })();
    if (
      maskSha !== item.maskSha256 ||
      deriveSamCandidateId({
        sourceSha256: SOURCE_SHA256,
        width: 255,
        height: 512,
        maskSha256: maskSha,
      }) !== item.candidateId ||
      bounds.area !== item.pixelArea
    )
      return fail('mask metadata mismatch');
    const derivedBounds = pixelBoundsToBasisPoints(
      {
        left: bounds.x,
        top: bounds.y,
        rightExclusive: bounds.x + bounds.width,
        bottomExclusive: bounds.y + bounds.height,
        area: bounds.area,
      },
      255,
      512,
    );
    if (
      Object.keys(derivedBounds).some(
        (key) =>
          derivedBounds[key as keyof typeof derivedBounds] !==
          item.bounds[key as keyof typeof item.bounds],
      )
    )
      return fail('candidate bounds metadata mismatch');
    const candidate = SamMaskCandidateSchema.parse({
      candidateId: item.candidateId,
      bounds: derivedBounds,
      pixelArea: bounds.area,
      areaRatioBps: Math.floor((bounds.area * 10000) / (255 * 512)),
      predictedIouBps: item.predictedIouBps,
      stabilityScoreBps: item.stabilityScoreBps,
      mask: {
        encoding: SAM_MASK_ENCODING,
        width: 255,
        height: 512,
        byteSize: rle.byteLength,
        dataBase64: encodeCanonicalBase64(rle),
        sha256: maskSha,
      },
      reviewFlags: [],
    });
    const responseCandidate = response.candidates[candidates.length];
    if (
      responseCandidate === undefined ||
      responseCandidate.candidateId !== item.candidateId ||
      responseCandidate.cutout.sha256 !== item.cutout.sha256 ||
      responseCandidate.binaryMask.sha256 !== item.binaryMask.sha256 ||
      responseCandidate.pixelArea !== item.pixelArea ||
      responseCandidate.predictedIouBps !== item.predictedIouBps ||
      responseCandidate.stabilityScoreBps !== item.stabilityScoreBps
    )
      return fail('report and response candidate metadata mismatch');
    const cut = await readFixed(evidence, item.cutout.filename);
    if (hash(cut) !== item.cutout.sha256 || cut.byteLength !== item.cutout.bytes)
      return fail('cutout artifact digest mismatch');
    const materialization = await materializeSamMaskCutout({ trustedRequest: request, candidate });
    if (
      hash(materialization.cutoutPng) !== item.cutout.sha256 ||
      hash(materialization.binaryMaskPng) !== item.binaryMask.sha256
    )
      return fail('materialized artifact mismatch');
    const preview = await createBoundedLayerPreview(cut);
    candidates.push(Object.freeze({ ...candidate, materialization, preview }));
  }
  return Object.freeze({
    request,
    candidates: Object.freeze(candidates),
    provenance: 'Verified Meta SAM 2.1 cutout replay — no live call' as const,
  });
};
