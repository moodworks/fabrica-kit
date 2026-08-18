import { createHash } from 'node:crypto';
import {
  buildQwenSamContactSheet,
  buildQwenSamRequest,
  createQwenSamAuthorization,
  executeQwenSamSelection,
  QWEN_SAM_COST_CAP_MICRO_USD,
  QWEN_SAM_EVIDENCE_ROOT,
  QWEN_SAM_MODEL,
  QWEN_SAM_RELEASE_PHRASE,
  verifyQwenSamEvidence,
} from './qwen-sam-candidate-selector-v1.js';

const args = process.argv.slice(2);
const stdout = (value: string) => process.stdout.write(`${value}\n`);
if (args.length === 0 || (args.length === 1 && args[0] === '--dry-run')) {
  const catalog = await verifyQwenSamEvidence(QWEN_SAM_EVIDENCE_ROOT);
  const sheet = await buildQwenSamContactSheet(QWEN_SAM_EVIDENCE_ROOT);
  const request = buildQwenSamRequest(catalog, sheet);
  stdout(
    JSON.stringify(
      {
        mode: 'dry-run',
        provider: 'alibaba-singapore',
        model: QWEN_SAM_MODEL,
        fixture: catalog.fixtureId,
        evidenceSha256: catalog.manifestSha256,
        candidateIds: catalog.candidates.map((c) => c.candidateId),
        sheetSha256: sheet.sha256,
        requestSha256: createHash('sha256').update(request.requestBodyText).digest('hex'),
        requestBytes: Buffer.byteLength(request.requestBodyText),
        maxOutputTokens: 512,
        costCapMicroUsd: QWEN_SAM_COST_CAP_MICRO_USD,
      },
      null,
      2,
    ),
  );
} else {
  if (
    args.length !== 3 ||
    args[0] !== '--live' ||
    args[1] !== '--release' ||
    args[2] !== QWEN_SAM_RELEASE_PHRASE
  )
    throw new Error(`Live mode requires --live --release '${QWEN_SAM_RELEASE_PHRASE}'.`);
  const catalog = await verifyQwenSamEvidence(QWEN_SAM_EVIDENCE_ROOT);
  const sheet = await buildQwenSamContactSheet(QWEN_SAM_EVIDENCE_ROOT);
  const request = buildQwenSamRequest(catalog, sheet);
  const authorization = createQwenSamAuthorization(
    QWEN_SAM_RELEASE_PHRASE,
    catalog,
    sheet,
    request.requestBodyText,
  );
  const secret = process.env.DASHSCOPE_API_KEY;
  if (!secret) throw new Error('DASHSCOPE_API_KEY is required for live mode.');
  const { dispatchQwenSamNative } =
    await import('./qwen-sam-candidate-selector-native-fetch-v1.js');
  const result = await executeQwenSamSelection({
    authorization,
    catalog,
    sheet,
    request,
    secret,
    transport: dispatchQwenSamNative,
  });
  stdout(JSON.stringify(result));
}
