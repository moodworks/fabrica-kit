const jsonMediaTypePattern = /^application\/json(?:\s*;|$)/iu;

export class DemoProjectHttpError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'DemoProjectHttpError';
    this.status = status;
    this.code = code;
  }
}

export const demoProjectFailure = (status: number, code: string, message: string): Response =>
  Response.json({ ok: false, error: { code, message } }, { status });

export const demoProjectFailureFrom = (error: unknown, fallbackCode: string): Response =>
  error instanceof DemoProjectHttpError
    ? demoProjectFailure(error.status, error.code, error.message)
    : demoProjectFailure(
        500,
        fallbackCode,
        'The provider-free demo operation could not be completed. Your accepted scene is unchanged.',
      );

const encodedLength = (value: string): number => new TextEncoder().encode(value).byteLength;

export const readBoundedJson = async (request: Request, maximumBytes: number): Promise<unknown> => {
  if (!jsonMediaTypePattern.test(request.headers.get('content-type') ?? '')) {
    throw new DemoProjectHttpError(
      415,
      'JSON_REQUEST_REQUIRED',
      'Submit one bounded application/json request.',
    );
  }

  const declaredLength = request.headers.get('content-length');
  if (
    declaredLength !== null &&
    (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > maximumBytes)
  ) {
    throw new DemoProjectHttpError(
      413,
      'DEMO_REQUEST_TOO_LARGE',
      'The demo request exceeds its fixed size limit.',
    );
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new DemoProjectHttpError(
      400,
      'INVALID_DEMO_REQUEST',
      'The demo request body could not be read.',
    );
  }
  if (text.length === 0 || encodedLength(text) > maximumBytes) {
    throw new DemoProjectHttpError(
      text.length === 0 ? 400 : 413,
      text.length === 0 ? 'INVALID_DEMO_REQUEST' : 'DEMO_REQUEST_TOO_LARGE',
      text.length === 0
        ? 'The demo request body must contain one JSON object.'
        : 'The demo request exceeds its fixed size limit.',
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new DemoProjectHttpError(
      400,
      'INVALID_DEMO_REQUEST',
      'The demo request body must be valid JSON.',
    );
  }
};

export const requireExactObjectKeys = <T extends readonly string[]>(
  input: unknown,
  keys: T,
): { readonly [K in T[number]]: unknown } => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new DemoProjectHttpError(
      400,
      'INVALID_DEMO_REQUEST',
      'The demo request must be one exact JSON object.',
    );
  }
  const actual = Object.keys(input).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw new DemoProjectHttpError(
      400,
      'INVALID_DEMO_REQUEST',
      'The demo request contains missing or unsupported fields.',
    );
  }
  return input as { readonly [K in T[number]]: unknown };
};

export const requireBoundedString = (
  value: unknown,
  code: string,
  message: string,
  maximumBytes: number,
): string => {
  if (typeof value !== 'string' || value.length === 0 || encodedLength(value) > maximumBytes) {
    throw new DemoProjectHttpError(400, code, message);
  }
  return value;
};
