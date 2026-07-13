import { z } from 'zod';

export const PREVIEW_SANDBOX = 'allow-scripts' as const;
export const PREVIEW_CSP =
  "default-src 'none'; img-src blob: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; font-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'" as const;
export const MAX_PREVIEW_MESSAGE_BYTES = 65_536;

export const PREVIEW_POLICY = Object.freeze({
  csp: PREVIEW_CSP,
  renderTarget: 'opaque-origin-iframe' as const,
  sandbox: PREVIEW_SANDBOX,
});

const safeMessagePattern = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;
const PreviewNonceSchema = z.string().regex(/^[0-9a-f]{32}$/);
const ErrorCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/);
const ErrorMessageSchema = z.string().superRefine((value, context) => {
  if (
    [...value].length < 1 ||
    [...value].length > 500 ||
    value.normalize('NFC') !== value ||
    safeMessagePattern.test(value)
  ) {
    context.addIssue({ code: 'custom', message: 'Preview error message is unsafe.' });
  }
});

const ReadyMessageSchema = z.strictObject({
  type: z.literal('ready'),
  nonce: PreviewNonceSchema,
});
const ProgressMessageSchema = z.strictObject({
  type: z.literal('progress'),
  nonce: PreviewNonceSchema,
  progressBps: z.int().min(0).max(10_000),
});
const ErrorMessageV1Schema = z.strictObject({
  type: z.literal('error'),
  nonce: PreviewNonceSchema,
  code: ErrorCodeSchema,
  message: ErrorMessageSchema,
});
const ExitMessageSchema = z.strictObject({
  type: z.literal('exit'),
  nonce: PreviewNonceSchema,
});

export const PreviewMessageV1Schema = z.discriminatedUnion('type', [
  ReadyMessageSchema,
  ProgressMessageSchema,
  ErrorMessageV1Schema,
  ExitMessageSchema,
]);

export type PreviewMessageV1 = z.infer<typeof PreviewMessageV1Schema>;

export type PreviewMessageRejectionCode =
  | 'PREVIEW_MESSAGE_INVALID'
  | 'PREVIEW_MESSAGE_OVERSIZED'
  | 'PREVIEW_NONCE_MISMATCH'
  | 'PREVIEW_SOURCE_MISMATCH';

export type PreviewMessageResult =
  | { readonly success: true; readonly data: PreviewMessageV1 }
  | { readonly success: false; readonly code: PreviewMessageRejectionCode };

export interface PreviewMessageCandidate {
  readonly data: unknown;
  readonly source: unknown;
}

export const validatePreviewMessage = (
  candidate: PreviewMessageCandidate,
  expected: { readonly nonce: string; readonly source: unknown },
): PreviewMessageResult => {
  if (candidate.source !== expected.source) {
    return { success: false, code: 'PREVIEW_SOURCE_MISMATCH' };
  }

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(candidate.data);
  } catch {
    return { success: false, code: 'PREVIEW_MESSAGE_INVALID' };
  }
  if (serialized === undefined) {
    return { success: false, code: 'PREVIEW_MESSAGE_INVALID' };
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_PREVIEW_MESSAGE_BYTES) {
    return { success: false, code: 'PREVIEW_MESSAGE_OVERSIZED' };
  }

  const parsed = PreviewMessageV1Schema.safeParse(candidate.data);
  if (!parsed.success) {
    return { success: false, code: 'PREVIEW_MESSAGE_INVALID' };
  }
  if (parsed.data.nonce !== expected.nonce) {
    return { success: false, code: 'PREVIEW_NONCE_MISMATCH' };
  }
  return { success: true, data: parsed.data };
};

export const parsePreviewCsp = (csp: string): ReadonlyMap<string, readonly string[]> => {
  const directives = new Map<string, readonly string[]>();
  for (const rawDirective of csp.split(';')) {
    const values = rawDirective.trim().split(/\s+/u);
    const name = values.shift();
    if (name === undefined || name === '' || directives.has(name)) {
      throw new TypeError('Preview CSP contains an empty or duplicate directive.');
    }
    directives.set(name, values);
  }
  return directives;
};
