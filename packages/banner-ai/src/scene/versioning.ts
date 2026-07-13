import { canonicalizeJson, type JsonValue } from './canonical-scene-json.js';
import { issue, validationFailure, type ValidationResult } from './validation.js';

export interface JsonVersionedDocument extends Record<string, JsonValue> {
  readonly schemaVersion: number;
}

export interface PureJsonUpcaster {
  readonly fromVersion: number;
  readonly toVersion: number;
  upcast(source: Readonly<JsonVersionedDocument>): JsonVersionedDocument;
}

export type JsonVersionParser<T> = (input: unknown) => ValidationResult<T>;

const cloneJsonDocument = (source: JsonVersionedDocument): JsonVersionedDocument =>
  JSON.parse(canonicalizeJson(source)) as JsonVersionedDocument;

const upcasterFailure = (message: string): ValidationResult<never> =>
  validationFailure([issue('UPCASTER_INVALID', [], message)]);

const tryCanonicalize = (value: unknown): string | null => {
  try {
    return canonicalizeJson(value);
  } catch {
    return null;
  }
};

export const runPureUpcasterHarness = <T>(
  source: JsonVersionedDocument,
  upcaster: PureJsonUpcaster,
  targetParser: JsonVersionParser<T>,
): ValidationResult<T> => {
  if (
    !Number.isSafeInteger(upcaster.fromVersion) ||
    !Number.isSafeInteger(upcaster.toVersion) ||
    upcaster.fromVersion < 1 ||
    upcaster.toVersion !== upcaster.fromVersion + 1 ||
    source.schemaVersion !== upcaster.fromVersion
  ) {
    return validationFailure([
      issue(
        'UPCASTER_INVALID',
        ['schemaVersion'],
        'Upcasters must advance exactly one explicit schema version.',
      ),
    ]);
  }

  let sourceBefore: string;
  let firstInput: JsonVersionedDocument;
  let secondInput: JsonVersionedDocument;
  try {
    sourceBefore = canonicalizeJson(source);
    firstInput = cloneJsonDocument(source);
    secondInput = cloneJsonDocument(source);
  } catch {
    return upcasterFailure('Upcaster source must be canonicalizable JSON.');
  }

  let firstOutput: JsonVersionedDocument;
  try {
    firstOutput = upcaster.upcast(firstInput);
  } catch {
    if (tryCanonicalize(firstInput) !== sourceBefore || tryCanonicalize(source) !== sourceBefore) {
      return validationFailure([
        issue('UPCASTER_MUTATED_SOURCE', [], 'Upcaster mutated its source document.'),
      ]);
    }
    return upcasterFailure('Upcaster must be total for every valid source document.');
  }

  if (tryCanonicalize(source) !== sourceBefore || tryCanonicalize(firstInput) !== sourceBefore) {
    return validationFailure([
      issue('UPCASTER_MUTATED_SOURCE', [], 'Upcaster mutated its source document.'),
    ]);
  }

  let firstCanonicalOutput: string;
  let firstOutputSnapshot: unknown;
  try {
    firstCanonicalOutput = canonicalizeJson(firstOutput);
    firstOutputSnapshot = JSON.parse(firstCanonicalOutput) as unknown;
  } catch {
    return upcasterFailure('Upcaster output must be canonicalizable JSON.');
  }

  if (
    firstOutputSnapshot === null ||
    typeof firstOutputSnapshot !== 'object' ||
    Array.isArray(firstOutputSnapshot) ||
    (firstOutputSnapshot as Record<string, unknown>)['schemaVersion'] !== upcaster.toVersion
  ) {
    return validationFailure([
      issue(
        'UPCASTER_INVALID',
        ['schemaVersion'],
        'Upcaster output did not declare its target schema version.',
      ),
    ]);
  }

  let secondOutput: JsonVersionedDocument;
  try {
    secondOutput = upcaster.upcast(secondInput);
  } catch {
    if (
      tryCanonicalize(source) !== sourceBefore ||
      tryCanonicalize(firstInput) !== sourceBefore ||
      tryCanonicalize(secondInput) !== sourceBefore
    ) {
      return validationFailure([
        issue('UPCASTER_MUTATED_SOURCE', [], 'Upcaster mutated its source document.'),
      ]);
    }
    return upcasterFailure('Upcaster must be total for every valid source document.');
  }

  if (
    tryCanonicalize(source) !== sourceBefore ||
    tryCanonicalize(firstInput) !== sourceBefore ||
    tryCanonicalize(secondInput) !== sourceBefore
  ) {
    return validationFailure([
      issue('UPCASTER_MUTATED_SOURCE', [], 'Upcaster mutated its source document.'),
    ]);
  }

  let secondCanonicalOutput: string;
  try {
    secondCanonicalOutput = canonicalizeJson(secondOutput);
  } catch {
    return upcasterFailure('Upcaster output must be canonicalizable JSON.');
  }

  if (firstCanonicalOutput !== secondCanonicalOutput) {
    return validationFailure([
      issue('UPCASTER_NON_DETERMINISTIC', [], 'Upcaster returned different canonical outputs.'),
    ]);
  }

  let parsed: ValidationResult<T>;
  try {
    parsed = targetParser(firstOutputSnapshot);
  } catch {
    return upcasterFailure('Target runtime parser must fail closed without throwing.');
  }
  return parsed.success
    ? parsed
    : validationFailure([
        issue('UPCASTER_INVALID', [], 'Upcaster output failed target runtime validation.'),
        ...parsed.issues,
      ]);
};
