import { z } from 'zod';

import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { canonicalizeJson, sha256Hex } from '../scene/canonical-scene-json.js';

export const OperationRequestSha256Schema = Sha256HexSchema.brand<'OperationRequestSha256'>();
export const CapabilityRequestSha256Schema = Sha256HexSchema.brand<'CapabilityRequestSha256'>();

export type OperationRequestSha256 = z.infer<typeof OperationRequestSha256Schema>;
export type CapabilityRequestSha256 = z.infer<typeof CapabilityRequestSha256Schema>;

const canonicalDigest = (validatedRequest: unknown): string =>
  sha256Hex(Buffer.from(canonicalizeJson(validatedRequest), 'utf8'));

export const digestValidatedOperationRequest = (
  validatedRequest: unknown,
): OperationRequestSha256 => OperationRequestSha256Schema.parse(canonicalDigest(validatedRequest));

export const digestValidatedCapabilityRequest = (
  validatedRequest: unknown,
): CapabilityRequestSha256 =>
  CapabilityRequestSha256Schema.parse(canonicalDigest(validatedRequest));
