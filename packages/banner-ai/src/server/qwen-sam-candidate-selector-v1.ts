import { execFileSync } from 'node:child_process';
import { chmod, lstat, mkdir, open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { OverlayOptions } from 'sharp';
import { z } from 'zod';
import {
  QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT,
  QWEN3_VL_ENDPOINT_METHOD,
  QWEN3_VL_PRICING_EVIDENCE_V2_SHA256,
  QWEN3_VL_PROVIDER_IDENTITY_V2_SHA256,
  QWEN3_VL_REQUESTED_MODEL_ID,
  QwenProviderUsageV1Schema,
  calculateQwen3VlListCostMicros,
} from '../evaluation/qwen3-vl-candidate-evidence.js';
import { QwenSuccessEnvelopeSchema } from './qwen3-vl-response-boundary.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';
import {
  verifySamVisualEvaluationArtifactSetV1,
  type SamVisualEvaluationManifestV1,
} from './sam-visual-evaluation-v1.js';

export const QWEN_SAM_EVIDENCE_ROOT =
  '/Users/m/Documents/Fabrica/evaluation-evidence/sam/person-real-call-02-0fcc33436e67';
export const QWEN_SAM_MANIFEST_SHA256 =
  'b921f3390307857a166bcd4ba6c36a3d19d6c7f55ccd96e61e07d589af8638ee';
export const QWEN_SAM_EXPIRES_AT = '2026-08-16T00:00:00.000Z';
export const QWEN_SAM_MODEL = QWEN3_VL_REQUESTED_MODEL_ID;
export const QWEN_SAM_MAX_OUTPUT_TOKENS = 512;
export const QWEN_SAM_COST_CAP_MICRO_USD = 500_000;
export const QWEN_SAM_RELEASE_PHRASE = 'RUN THE ONE QWEN SAM CANDIDATE SELECTION CALL';
const digest = (value: unknown) => sha256Hex(Buffer.from(canonicalizeJson(value), 'utf8'));
const CandidateIdSchema = z.string().regex(/^samc_v1_[0-9a-f]{64}$/u);
const SelectionSchema = z
  .strictObject({
    selection: z.enum(['one', 'none']),
    candidateId: z.union([CandidateIdSchema, z.null()]),
    semanticRole: z.union([z.literal('subject'), z.null()]),
    rationale: z.string().min(1).max(280),
  })
  .superRefine((v, c) => {
    if (v.selection === 'one' && (v.candidateId === null || v.semanticRole !== 'subject'))
      c.addIssue({ code: 'custom', message: 'one requires a subject candidate.' });
    if (v.selection === 'none' && (v.candidateId !== null || v.semanticRole !== null))
      c.addIssue({ code: 'custom', message: 'none requires null values.' });
  })
  .readonly();
export type QwenSamSelection = z.infer<typeof SelectionSchema>;
export interface QwenSamCatalog {
  readonly fixtureId: 'banner-person-v1';
  readonly manifestSha256: string;
  readonly source: Readonly<{ sha256: string; bytes: number; width: number; height: number }>;
  readonly candidates: readonly Readonly<{
    candidateId: string;
    order: number;
    cutout: Readonly<{
      filename: string;
      sha256: string;
      bytes: number;
      width: number;
      height: number;
    }>;
  }>[];
}
export interface QwenSamContactSheet extends QwenSamCatalog {
  readonly sha256: string;
  readonly bytes: number;
  readonly width: 960;
  readonly height: 720;
}
const contactSheetBytes = new WeakMap<object, Uint8Array>();
export const copyQwenSamContactSheetPng = (sheet: QwenSamContactSheet) => {
  const bytes = contactSheetBytes.get(sheet);
  if (!bytes) throw new TypeError('Unknown contact sheet.');
  return Uint8Array.from(bytes);
};
async function assertRegular(path: string) {
  const s = await lstat(path);
  if (!s.isFile() || s.isSymbolicLink())
    throw new TypeError(`Non-regular evidence artifact: ${path}`);
}
export async function verifyQwenSamEvidence(
  root = QWEN_SAM_EVIDENCE_ROOT,
): Promise<QwenSamCatalog> {
  const exact = await realpath(root);
  if (exact !== root)
    throw new TypeError('Evidence root must be the exact non-symlink absolute path.');
  const s = await lstat(root);
  if (!s.isDirectory() || s.isSymbolicLink())
    throw new TypeError('Evidence root is not a regular directory.');
  await assertRegular(join(root, 'manifest.json'));
  const v = await verifySamVisualEvaluationArtifactSetV1(root);
  const m: SamVisualEvaluationManifestV1 = v.manifest;
  if (
    v.manifestSha256 !== QWEN_SAM_MANIFEST_SHA256 ||
    m.outputClassification !== 'real-sam-output' ||
    m.fixture.fixtureId !== 'banner-person-v1' ||
    m.validatedResponseSha256 !==
      '371b51fe00b0d80a32ad53a0de3ad864d089ea3dbb1e7cb3f2667ce170b29646' ||
    m.sanitizedResponseSha256 !==
      '68c85095d9d0524dae4edb1f40f049cf1a6143a6be59a5446350530b2a2b3999' ||
    m.candidates.length !== 8
  )
    throw new TypeError('SAM evidence identity or candidate count mismatch.');
  const candidates = m.candidates
    .toSorted((a, b) => a.order - b.order)
    .map((c) => ({
      candidateId: c.candidateId,
      order: c.order,
      cutout: {
        filename: c.artifacts.cutout.filename,
        sha256: c.artifacts.cutout.sha256,
        bytes: c.artifacts.cutout.byteLength,
        width: c.artifacts.cutout.dimensions.width,
        height: c.artifacts.cutout.dimensions.height,
      },
    }));
  if (candidates.some((c, i) => c.order !== i + 1))
    throw new TypeError('SAM candidate order mismatch.');
  return Object.freeze({
    fixtureId: 'banner-person-v1',
    manifestSha256: v.manifestSha256,
    source: Object.freeze({
      sha256: m.source.sha256,
      bytes: m.source.byteLength,
      ...m.source.dimensions,
    }),
    candidates: Object.freeze(
      candidates.map((c) => Object.freeze({ ...c, cutout: Object.freeze(c.cutout) })),
    ),
  });
}
export async function buildQwenSamContactSheet(
  root = QWEN_SAM_EVIDENCE_ROOT,
): Promise<QwenSamContactSheet> {
  const catalog = await verifyQwenSamEvidence(root);
  const overlays: OverlayOptions[] = [];
  const source = await sharp(join(root, 'source.png'))
    .resize(920, 200, { fit: 'contain', background: '#222' })
    .png()
    .toBuffer();
  overlays.push({ input: source, left: 20, top: 20 });
  for (const c of catalog.candidates) {
    const tile = await sharp(join(root, c.cutout.filename))
      .resize(200, 190, { fit: 'contain', background: '#333' })
      .png()
      .toBuffer();
    const label = Buffer.from(
      `<svg width="240" height="240"><rect width="240" height="240" fill="#222"/><image href="data:image/png;base64,${tile.toString('base64')}" x="20" y="40" width="200" height="190"/><text x="8" y="26" fill="white" font-size="14">${c.order}: ${c.candidateId.slice(0, 16)}</text></svg>`,
    );
    overlays.push({
      input: label,
      left: ((c.order - 1) % 4) * 240,
      top: 240 + Math.floor((c.order - 1) / 4) * 240,
    });
  }
  const png = await sharp({ create: { width: 960, height: 720, channels: 4, background: '#222' } })
    .composite(overlays)
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false, force: true })
    .toBuffer();
  if (png.length > 2_000_000) throw new TypeError('Contact sheet exceeds cap.');
  const sheet = Object.freeze({
    ...catalog,
    sha256: sha256Hex(png),
    bytes: png.length,
    width: 960 as const,
    height: 720 as const,
  });
  contactSheetBytes.set(sheet, Uint8Array.from(png));
  return sheet;
}
export function parseQwenSamSelection(value: unknown, catalog: QwenSamCatalog): QwenSamSelection {
  const p = SelectionSchema.parse(value);
  if (p.selection === 'one' && !catalog.candidates.some((c) => c.candidateId === p.candidateId))
    throw new TypeError('Unknown SAM candidate ID.');
  return Object.freeze(p);
}
export interface QwenSamTransportRequest {
  readonly endpoint: typeof QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT;
  readonly method: typeof QWEN3_VL_ENDPOINT_METHOD;
  readonly requestBodyText: string;
  readonly maxOutputTokens: 512;
}
const REQUEST_BYTE_CAP = 2_000_000;
export function buildQwenSamRequest(
  catalog: QwenSamCatalog,
  sheet: QwenSamContactSheet,
): QwenSamTransportRequest {
  const image = `data:image/png;base64,${Buffer.from(copyQwenSamContactSheetPng(sheet)).toString('base64')}`;
  const requestBodyText = JSON.stringify({
    model: QWEN_SAM_MODEL,
    messages: [
      {
        role: 'system',
        content:
          'Choose exactly one allowlisted candidateId or none. Return JSON only. Never return geometry.',
      },
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              fixtureId: catalog.fixtureId,
              sourceSha256: catalog.source.sha256,
              candidateIds: catalog.candidates.map((c) => c.candidateId),
              orderedCandidates: catalog.candidates.map((c) => ({
                order: c.order,
                candidateId: c.candidateId,
                cutoutSha256: c.cutout.sha256,
              })),
              contactSheetSha256: sheet.sha256,
            }),
          },
          { type: 'image_url', image_url: { url: image } },
        ],
      },
    ],
    response_format: { type: 'json_object' },
    enable_thinking: false,
    enable_search: false,
    enable_code_interpreter: false,
    tools: [],
    tool_choice: 'none',
    parallel_tool_calls: false,
    stream: false,
    n: 1,
    temperature: 0,
    seed: 0,
    max_tokens: 512,
  });
  if (Buffer.byteLength(requestBodyText) > REQUEST_BYTE_CAP)
    throw new TypeError('Qwen request exceeds fixed byte cap.');
  return Object.freeze({
    endpoint: QWEN3_VL_CHAT_COMPLETIONS_ENDPOINT,
    method: 'POST',
    requestBodyText,
    maxOutputTokens: 512,
  });
}
export interface QwenSamAuthorization {
  readonly id: string;
  readonly catalogSha256: string;
  readonly sourceSha256: string;
  readonly validatedSha256: string;
  readonly sanitizedSha256: string;
  readonly orderedCandidatesSha256: string;
  readonly sheetSha256: string;
  readonly sheetBytes: number;
  readonly sheetWidth: 960;
  readonly sheetHeight: 720;
  readonly requestSha256: string;
  readonly operationId: string;
  readonly providerIdentitySha256: string;
  readonly pricingEvidenceSha256: string;
  readonly headSha: string;
  readonly expiresAt: string;
  readonly maxCalls: 1;
  readonly retryCount: 0;
  readonly maxOutputTokens: 512;
  readonly costCapMicroUsd: 500000;
  readonly providerBillingGuarantee: false;
}
export interface QwenSamGitSource {
  readonly head: () => string;
  readonly status: () => string;
}
const defaultGit: QwenSamGitSource = {
  head: () => execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  status: () => execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }),
};
const consumed = new WeakSet<object>();
const authorizationStates = new WeakMap<
  object,
  {
    readonly headSha: string;
    readonly catalogSha256: string;
    readonly sheetSha256: string;
    readonly requestSha256: string;
    readonly operationId: string;
  }
>();
export function createQwenSamAuthorization(
  releasePhrase: string,
  catalog: QwenSamCatalog,
  sheet: QwenSamContactSheet,
  requestBodyText: string,
): QwenSamAuthorization {
  if (releasePhrase !== QWEN_SAM_RELEASE_PHRASE)
    throw new Error('Qwen-SAM release phrase mismatch.');
  const now = new Date();
  const git = defaultGit;
  if (now.toISOString() >= QWEN_SAM_EXPIRES_AT)
    throw new Error('Qwen-SAM evidence authorization expired.');
  if (git.status().trim() !== '')
    throw new Error('Qwen-SAM authorization requires a clean worktree.');
  const orderedCandidatesSha256 = digest(
    catalog.candidates.map((c) => ({
      id: c.candidateId,
      order: c.order,
      cutoutSha256: c.cutout.sha256,
    })),
  );
  const catalogSha256 = digest(catalog);
  const requestSha256 = sha256Hex(Buffer.from(requestBodyText));
  const operationId = `qwen-sam-candidate-selection-v1-${digest({
    provider: QWEN3_VL_PROVIDER_IDENTITY_V2_SHA256,
    model: QWEN_SAM_MODEL,
    fixtureId: catalog.fixtureId,
    catalogSha256,
    sheetSha256: sheet.sha256,
    requestSha256,
  })}`;
  const issuedAt = new Date().toISOString();
  const authorization = Object.freeze({
    id: operationId,
    operationId,
    catalogSha256,
    sourceSha256: catalog.source.sha256,
    validatedSha256: '371b51fe00b0d80a32ad53a0de3ad864d089ea3dbb1e7cb3f2667ce170b29646',
    sanitizedSha256: '68c85095d9d0524dae4edb1f40f049cf1a6143a6be59a5446350530b2a2b3999',
    orderedCandidatesSha256,
    sheetSha256: sheet.sha256,
    sheetBytes: sheet.bytes,
    sheetWidth: 960,
    sheetHeight: 720,
    requestSha256,
    providerIdentitySha256: QWEN3_VL_PROVIDER_IDENTITY_V2_SHA256,
    pricingEvidenceSha256: QWEN3_VL_PRICING_EVIDENCE_V2_SHA256,
    headSha: git.head(),
    expiresAt: QWEN_SAM_EXPIRES_AT,
    issuedAt,
    releasePhrase: QWEN_SAM_RELEASE_PHRASE,
    purpose: 'candidate-selection-only',
    maxCalls: 1,
    retryCount: 0,
    maxOutputTokens: 512,
    costCapMicroUsd: 500000,
    providerBillingGuarantee: false,
  });
  authorizationStates.set(authorization, {
    headSha: authorization.headSha,
    catalogSha256: authorization.catalogSha256,
    sheetSha256: authorization.sheetSha256,
    requestSha256: authorization.requestSha256,
    operationId: authorization.operationId,
  });
  return authorization;
}
const hasGeometry = (v: unknown): boolean =>
  Array.isArray(v)
    ? v.some(hasGeometry)
    : typeof v === 'object' && v !== null
      ? Object.entries(v).some(
          ([k, x]) => /box|bbox|coord|mask|polygon|point|geometry|rect/u.test(k) || hasGeometry(x),
        )
      : false;
export function assertQwenSamAuthorizationLive(
  a: QwenSamAuthorization,
  catalog: QwenSamCatalog,
  sheet: QwenSamContactSheet,
  request: QwenSamTransportRequest,
) {
  const now = new Date();
  const git = defaultGit;
  const state = authorizationStates.get(a);
  if (!state) throw new Error('Unknown or forged Qwen-SAM authorization.');
  if (consumed.has(a)) throw new Error('Qwen-SAM authorization already consumed.');
  if (
    now.toISOString() >= a.expiresAt ||
    git.status().trim() !== '' ||
    git.head() !== state.headSha ||
    state.catalogSha256 !== digest(catalog) ||
    state.sheetSha256 !== sheet.sha256 ||
    state.requestSha256 !== sha256Hex(Buffer.from(request.requestBodyText)) ||
    state.operationId !== a.operationId ||
    a.id !== a.operationId
  )
    throw new Error('Qwen-SAM authorization binding mismatch.');
  consumed.add(a);
}
export async function reserveQwenSamSelection(
  id: string,
): Promise<{ responsePath: string; reportPath: string }> {
  const dir = join(process.cwd(), '.local-data/banner-ai/qwen-sam-candidate-selection-v1', id);
  await mkdir(join(process.cwd(), '.local-data/banner-ai/qwen-sam-candidate-selection-v1'), {
    recursive: true,
    mode: 0o700,
  });
  await mkdir(dir, { recursive: false, mode: 0o700 });
  await chmod(dir, 0o700);
  const responsePath = join(dir, 'response.json'),
    reportPath = join(dir, 'report.json');
  const response = await open(
    responsePath,
    constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  let report: FileHandle;
  try {
    report = await open(
      reportPath,
      constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
  } catch (error) {
    await response.close();
    throw error;
  }
  const reservation = Object.freeze({ responsePath, reportPath });
  reservationStates.set(reservation, {
    response,
    report,
    responseIdentity: await response.stat(),
    reportIdentity: await report.stat(),
  });
  return reservation;
}
const reservationStates = new WeakMap<
  object,
  {
    response: FileHandle;
    report: FileHandle;
    responseIdentity: { dev: number; ino: number };
    reportIdentity: { dev: number; ino: number };
  }
>();
async function assertReservationPath(path: string, identity: { dev: number; ino: number }) {
  const s = await lstat(path);
  if (
    !s.isFile() ||
    s.isSymbolicLink() ||
    s.dev !== identity.dev ||
    s.ino !== identity.ino ||
    s.nlink !== 1 ||
    (s.mode & 0o777) !== 0o600
  )
    throw new Error('Reservation integrity failure.');
}
export async function verifyQwenSamReservation(paths: {
  responsePath: string;
  reportPath: string;
}) {
  const state = reservationStates.get(paths);
  if (!state) throw new Error('Unknown reservation.');
  await assertReservationPath(paths.responsePath, state.responseIdentity);
  await assertReservationPath(paths.reportPath, state.reportIdentity);
}
export async function closeQwenSamReservation(paths: { responsePath: string; reportPath: string }) {
  const state = reservationStates.get(paths);
  if (state) await Promise.allSettled([state.response.close(), state.report.close()]);
}
export async function finalizeQwenSamReservation(
  paths: { responsePath: string; reportPath: string },
  response: unknown,
  report: unknown,
) {
  const state = reservationStates.get(paths);
  if (!state) throw new Error('Unknown reservation.');
  await verifyQwenSamReservation(paths);
  for (const [handle, value, identity] of [
    [state.response, response, state.responseIdentity],
    [state.report, report, state.reportIdentity],
  ] as const) {
    await assertReservationPath(
      handle === state.response ? paths.responsePath : paths.reportPath,
      identity,
    );
    const bytes = Buffer.from(JSON.stringify(value));
    await handle.writeFile(bytes);
    await handle.sync();
    const after = await handle.stat();
    if (after.size !== bytes.length || after.nlink !== 1)
      throw new Error('Reservation integrity failure.');
    await assertReservationPath(
      handle === state.response ? paths.responsePath : paths.reportPath,
      identity,
    );
    await handle.close();
  }
}
export type QwenSamTerminalOutcome =
  | 'success'
  | 'invalid'
  | 'http-error'
  | 'transport-error'
  | 'missing-usage'
  | 'over-cap'
  | 'timeout';
class QwenSamTerminalError extends Error {
  constructor(readonly outcome: Exclude<QwenSamTerminalOutcome, 'success'>) {
    super(outcome);
  }
}
export function sanitizeQwenSamOutcome(
  outcome: QwenSamTerminalOutcome,
  selection: QwenSamSelection | null = null,
) {
  return { version: 1, outcome, selection };
}
export async function executeQwenSamSelection(input: {
  authorization: QwenSamAuthorization;
  catalog: QwenSamCatalog;
  sheet: QwenSamContactSheet;
  request: QwenSamTransportRequest;
  secret: string;
  transport: (
    request: QwenSamTransportRequest,
    secret: string,
  ) => Promise<{ status: number; bodyText: string }>;
}): Promise<{ reportPath: string; outcome: QwenSamTerminalOutcome }> {
  if (!input.secret) throw new Error('DASHSCOPE_API_KEY is required at dispatch.');
  const reservation = await reserveQwenSamSelection(input.authorization.id);
  try {
    await verifyQwenSamReservation(reservation);
    assertQwenSamAuthorizationLive(input.authorization, input.catalog, input.sheet, input.request);
  } catch (error) {
    await closeQwenSamReservation(reservation);
    throw error;
  }
  let outcome: QwenSamTerminalOutcome = 'transport-error';
  let record: unknown = null;
  try {
    const response = await input.transport(input.request, input.secret);
    if (response.status < 200 || response.status >= 300) {
      outcome = 'http-error';
      record = { status: response.status };
    } else {
      const validated = validateQwenSamProviderResponse(response.bodyText, input.catalog);
      outcome = 'success';
      record = validated;
    }
  } catch (error) {
    if (error instanceof QwenSamTerminalError) outcome = error.outcome;
    else if (
      error instanceof SyntaxError ||
      error instanceof z.ZodError ||
      error instanceof TypeError
    )
      outcome = 'invalid';
    else if (error instanceof Error && error.name === 'AbortError') outcome = 'timeout';
    else outcome = 'transport-error';
  }
  try {
    await finalizeQwenSamReservation(
      reservation,
      { version: 1, terminal: outcome, result: record },
      {
        version: 1,
        terminal: outcome,
        authorizationId: input.authorization.id,
        requestSha256: input.authorization.requestSha256,
        evidenceSha256: input.authorization.catalogSha256,
        providerIdentitySha256: input.authorization.providerIdentitySha256,
        developmentOnly: true,
        selectionOnly: true,
        noGeometry: true,
        noProductAdmission: true,
        providerBillingGuarantee: false,
      },
    );
  } catch (error) {
    await closeQwenSamReservation(reservation);
    throw error;
  }
  return { reportPath: reservation.reportPath, outcome };
}
export interface QwenSamValidatedResponse {
  readonly responseId: string | null;
  readonly requestId: string | null;
  readonly model: string;
  readonly finishReason: 'stop';
  readonly usage: z.infer<typeof QwenProviderUsageV1Schema>;
  readonly calculatedListCost: ReturnType<typeof calculateQwen3VlListCostMicros>;
  readonly selection: QwenSamSelection;
}
export function validateQwenSamProviderResponse(
  bodyText: string,
  catalog: QwenSamCatalog,
): QwenSamValidatedResponse {
  let raw: unknown;
  try {
    raw = JSON.parse(bodyText);
  } catch {
    throw new QwenSamTerminalError('invalid');
  }
  if (typeof raw !== 'object' || raw === null || !('usage' in raw) || raw.usage === undefined)
    throw new QwenSamTerminalError('missing-usage');
  const envelope = QwenSuccessEnvelopeSchema.parse(raw);
  if (envelope.model !== QWEN_SAM_MODEL || envelope.choices[0].finish_reason !== 'stop')
    throw new QwenSamTerminalError('invalid');
  const usage = QwenProviderUsageV1Schema.parse(envelope.usage);
  if (
    BigInt(calculateQwen3VlListCostMicros(usage).calculatedListCostMicros) >
    BigInt(QWEN_SAM_COST_CAP_MICRO_USD)
  )
    throw new QwenSamTerminalError('over-cap');
  const output = JSON.parse(envelope.choices[0].message.content) as unknown;
  if (hasGeometry(output)) throw new QwenSamTerminalError('invalid');
  return {
    responseId: typeof envelope.id === 'string' ? envelope.id : null,
    requestId: null,
    model: envelope.model,
    finishReason: 'stop',
    usage,
    calculatedListCost: calculateQwen3VlListCostMicros(usage),
    selection: parseQwenSamSelection(output, catalog),
  };
}
