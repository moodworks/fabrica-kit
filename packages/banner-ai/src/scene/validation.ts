import type { ZodIssue } from 'zod';

export type ValidationIssueCode =
  | 'ASSET_LIMIT_EXCEEDED'
  | 'ASSET_MEDIA_TYPE_INVALID'
  | 'ASSET_REFERENCE_CONFLICT'
  | 'ASSET_REFERENCE_MISMATCH'
  | 'BACKGROUND_VARIANT_INVALID'
  | 'CANVAS_AREA_EXCEEDED'
  | 'CANVAS_DIMENSION_INVALID'
  | 'COLOR_INVALID'
  | 'DIGEST_INVALID'
  | 'EXIT_URL_INVALID'
  | 'EXPORT_VARIANT_INVALID'
  | 'IDENTIFIER_INVALID'
  | 'LAYER_ARRAY_UNSORTED'
  | 'LAYER_CONTROL_INVALID'
  | 'LAYER_COUNT_INVALID'
  | 'LAYER_FRAME_INVALID'
  | 'LAYER_ID_DUPLICATE'
  | 'LAYER_NAME_INVALID'
  | 'LAYER_OPACITY_INVALID'
  | 'LAYER_ORDER_INVALID'
  | 'LAYER_TRANSFORM_INVALID'
  | 'MANIFEST_ASSET_MISMATCH'
  | 'MANIFEST_ASSET_ORDER_INVALID'
  | 'MANIFEST_INVALID'
  | 'MANIFEST_OUTPUT_MISMATCH'
  | 'MANIFEST_REQUIRED'
  | 'MANIFEST_SCENE_MISMATCH'
  | 'MANIFEST_UNKNOWN_KEY'
  | 'MANIFEST_VALIDATOR_MISMATCH'
  | 'MANIFEST_WORKFLOW_MISMATCH'
  | 'PRESET_NO_EFFECT'
  | 'PRESET_PARAMETER_INVALID'
  | 'REFERENCE_NOT_FOUND'
  | 'SCENE_INVALID'
  | 'SCENE_REQUIRED'
  | 'SCENE_UNKNOWN_KEY'
  | 'SCENE_VERSION_UNSUPPORTED'
  | 'STATIC_FRAME_INVALID'
  | 'TRACK_ARRAY_UNSORTED'
  | 'TRACK_CHANNEL_CONFLICT'
  | 'TRACK_COUNT_INVALID'
  | 'TRACK_DURATION_EXCEEDED'
  | 'TRACK_ID_DUPLICATE'
  | 'TRACK_TARGET_NOT_FOUND'
  | 'TRACK_TIMING_INVALID'
  | 'TRACK_VARIANT_INVALID'
  | 'UPCASTER_INVALID'
  | 'UPCASTER_MUTATED_SOURCE'
  | 'UPCASTER_NON_DETERMINISTIC'
  | 'VALIDATOR_PROFILE_MISMATCH';

export interface ValidationIssue {
  readonly code: ValidationIssueCode;
  readonly path: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly issues: readonly ValidationIssue[] };

export const validationSuccess = <T>(data: T): ValidationResult<T> => ({ success: true, data });

export const validationFailure = <T = never>(
  issues: readonly ValidationIssue[],
): ValidationResult<T> => ({ success: false, issues });

export const jsonPointer = (path: readonly PropertyKey[]): string => {
  if (path.length === 0) {
    return '';
  }

  return `/${path
    .map((segment) => String(segment).replaceAll('~', '~0').replaceAll('/', '~1'))
    .join('/')}`;
};

export const issue = (
  code: ValidationIssueCode,
  path: readonly PropertyKey[],
  message: string,
): ValidationIssue => ({ code, path: jsonPointer(path), message });

const readPath = (input: unknown, path: readonly PropertyKey[]): unknown => {
  let cursor = input;

  for (const segment of path) {
    if (typeof segment === 'symbol' || cursor === null || typeof cursor !== 'object') {
      return undefined;
    }

    cursor = (cursor as Record<PropertyKey, unknown>)[segment];
  }

  return cursor;
};

const customCode = (zodIssue: ZodIssue): ValidationIssueCode | null => {
  if (zodIssue.code !== 'custom') {
    return null;
  }

  const value = zodIssue.params?.['validationCode'];
  return typeof value === 'string' ? (value as ValidationIssueCode) : null;
};

const sceneCodeForPath = (path: readonly PropertyKey[], input: unknown): ValidationIssueCode => {
  const value = readPath(input, path);
  const [root, second, third, fourth] = path;

  if (root === 'schemaVersion') return 'SCENE_VERSION_UNSUPPORTED';
  if (root === 'exportSettings' && second === 'validatorProfile') {
    return 'VALIDATOR_PROFILE_MISMATCH';
  }
  if (value === null || value === undefined) return 'SCENE_REQUIRED';
  if (root === 'canvas' && (second === 'width' || second === 'height')) {
    return 'CANVAS_DIMENSION_INVALID';
  }
  if (root === 'canvas' && second === 'background') {
    if (third === 'color') return 'COLOR_INVALID';
    if (third === 'asset') {
      if (fourth === 'sha256') return 'DIGEST_INVALID';
      if (fourth === 'mediaType') return 'ASSET_MEDIA_TYPE_INVALID';
      if (fourth === 'assetId' || fourth === 'assetVersionId') return 'IDENTIFIER_INVALID';
      return 'ASSET_LIMIT_EXCEEDED';
    }
    return 'BACKGROUND_VARIANT_INVALID';
  }
  if (root === 'sourceAsset') {
    if (second === 'sha256') return 'DIGEST_INVALID';
    if (second === 'mediaType') return 'ASSET_MEDIA_TYPE_INVALID';
    if (second === 'assetId' || second === 'assetVersionId') return 'IDENTIFIER_INVALID';
    return 'ASSET_LIMIT_EXCEEDED';
  }
  if (root === 'layers') {
    if (path.length === 1) return 'LAYER_COUNT_INVALID';
    if (third === 'id') return 'IDENTIFIER_INVALID';
    if (third === 'name') return 'LAYER_NAME_INVALID';
    if (third === 'order') return 'LAYER_ORDER_INVALID';
    if (third === 'included' || third === 'visible') return 'LAYER_CONTROL_INVALID';
    if (third === 'opacity') return 'LAYER_OPACITY_INVALID';
    if (third === 'frame') return 'LAYER_FRAME_INVALID';
    if (third === 'transform') return 'LAYER_TRANSFORM_INVALID';
    if (third === 'asset') {
      if (fourth === 'sha256') return 'DIGEST_INVALID';
      if (fourth === 'mediaType') return 'ASSET_MEDIA_TYPE_INVALID';
      if (fourth === 'assetId' || fourth === 'assetVersionId') return 'IDENTIFIER_INVALID';
      return 'ASSET_LIMIT_EXCEEDED';
    }
  }
  if (root === 'timeline') {
    if (path.length === 1) return 'TRACK_COUNT_INVALID';
    if (third === 'id') return 'IDENTIFIER_INVALID';
    if (third === 'targetLayerId') return 'TRACK_TARGET_NOT_FOUND';
    if (third === 'timing') return 'TRACK_TIMING_INVALID';
    if (third === 'preset') {
      return fourth === 'kind' || fourth === 'presetVersion'
        ? 'TRACK_VARIANT_INVALID'
        : 'PRESET_PARAMETER_INVALID';
    }
  }
  if (root === 'exportSettings') {
    if (second === 'interaction' && third === 'destinationUrl') return 'EXIT_URL_INVALID';
    if (second === 'validatorProfile' && third === 'rulesSha256') return 'DIGEST_INVALID';
    return 'EXPORT_VARIANT_INVALID';
  }

  return 'SCENE_INVALID';
};

const isAlternateVariantKey = (path: readonly PropertyKey[], key: string): boolean => {
  if (path[0] === 'canvas' && path[1] === 'background') {
    return ['asset', 'color', 'fit', 'opacity', 'positionX', 'positionY'].includes(key);
  }
  if (path[0] === 'exportSettings') {
    return ['frameTimeMs', 'interaction', 'validatorProfile'].includes(key);
  }
  if (path[0] === 'timeline' && path[2] === 'preset') {
    return [
      'axis',
      'distancePx',
      'fromDegrees',
      'fromFactor',
      'fromScale',
      'offsetX',
      'offsetY',
      'toDegrees',
      'toFactor',
      'toScale',
    ].includes(key);
  }
  return false;
};

export const zodIssuesToValidationIssues = (
  zodIssues: readonly ZodIssue[],
  input: unknown,
  domain: 'manifest' | 'scene',
): readonly ValidationIssue[] => {
  const result: ValidationIssue[] = [];

  for (const zodIssue of zodIssues) {
    const code = customCode(zodIssue);
    if (code !== null) {
      result.push(issue(code, zodIssue.path, zodIssue.message));
      continue;
    }

    if (zodIssue.code === 'unrecognized_keys') {
      for (const key of zodIssue.keys) {
        const alternateCode =
          domain === 'scene' && isAlternateVariantKey(zodIssue.path, key)
            ? zodIssue.path[0] === 'canvas'
              ? 'BACKGROUND_VARIANT_INVALID'
              : zodIssue.path[0] === 'exportSettings'
                ? 'EXPORT_VARIANT_INVALID'
                : 'TRACK_VARIANT_INVALID'
            : domain === 'scene'
              ? 'SCENE_UNKNOWN_KEY'
              : 'MANIFEST_UNKNOWN_KEY';
        result.push(issue(alternateCode, [...zodIssue.path, key], `Unknown key: ${key}.`));
      }
      continue;
    }

    const mappedCode =
      domain === 'scene'
        ? sceneCodeForPath(zodIssue.path, input)
        : readPath(input, zodIssue.path) === null || readPath(input, zodIssue.path) === undefined
          ? 'MANIFEST_REQUIRED'
          : 'MANIFEST_INVALID';
    result.push(issue(mappedCode, zodIssue.path, zodIssue.message));
  }

  return result;
};
