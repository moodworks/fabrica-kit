import { z } from 'zod';

import { OutputKeySchema } from '../jobs/syntax.js';
import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';

const unsafeLabelPattern = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;

const PartLabelSchema = z.string().superRefine((value, context) => {
  if (
    [...value].length < 1 ||
    [...value].length > 80 ||
    value.normalize('NFC') !== value ||
    value.trim() !== value ||
    unsafeLabelPattern.test(value)
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Composition part labels must be safe trimmed NFC text of 1–80 code points.',
    });
  }
});

export const CompositionBoundsV1Schema = z
  .strictObject({
    xBps: z.int().min(0).max(9_999),
    yBps: z.int().min(0).max(9_999),
    widthBps: z.int().min(1).max(10_000),
    heightBps: z.int().min(1).max(10_000),
  })
  .superRefine((bounds, context) => {
    if (bounds.xBps + bounds.widthBps > 10_000) {
      context.addIssue({ code: 'custom', message: 'Composition bounds exceed the source width.' });
    }
    if (bounds.yBps + bounds.heightBps > 10_000) {
      context.addIssue({ code: 'custom', message: 'Composition bounds exceed the source height.' });
    }
  })
  .readonly();

export const CompositionPartV1Schema = z
  .strictObject({
    partKey: OutputKeySchema,
    label: PartLabelSchema,
    role: z.enum(['background', 'subject', 'foreground', 'decoration', 'text', 'other']),
    bounds: CompositionBoundsV1Schema,
  })
  .readonly();

const CompositionProposalV1Schema = z
  .strictObject({
    kind: z.literal('composition_proposal'),
    proposalVersion: z.literal(1),
    sourceAssetSha256: Sha256HexSchema,
    parts: z.array(CompositionPartV1Schema).min(1).max(5).readonly(),
  })
  .superRefine((proposal, context) => {
    const seen = new Set<string>();
    for (const [index, part] of proposal.parts.entries()) {
      if (seen.has(part.partKey)) {
        context.addIssue({
          code: 'custom',
          message: 'Composition part keys must be unique.',
          path: ['parts', index, 'partKey'],
        });
      }
      seen.add(part.partKey);
    }
  })
  .readonly();

const NoUsefulLayersV1Schema = z
  .strictObject({
    kind: z.literal('no_useful_layers'),
    proposalVersion: z.literal(1),
    sourceAssetSha256: Sha256HexSchema,
    reason: z.enum(['flat_image', 'insufficient_separation', 'unsupported_composition']),
  })
  .readonly();

export const CompositionAnalysisResultV1Schema = z.discriminatedUnion('kind', [
  CompositionProposalV1Schema,
  NoUsefulLayersV1Schema,
]);

export type CompositionBoundsV1 = z.infer<typeof CompositionBoundsV1Schema>;
export type CompositionPartV1 = z.infer<typeof CompositionPartV1Schema>;
export type CompositionAnalysisResultV1 = z.infer<typeof CompositionAnalysisResultV1Schema>;

export const validateCompositionAnalysisResultV1 = (input: {
  readonly request: {
    readonly sourceAsset: { readonly sha256: string };
    readonly maxParts: number;
    readonly includeBackground: boolean;
  };
  readonly result: unknown;
}): CompositionAnalysisResultV1 => {
  const sourceAssetSha256 = Sha256HexSchema.parse(input.request.sourceAsset.sha256);
  const maxParts = z.int().min(1).max(5).parse(input.request.maxParts);
  const includeBackground = z.boolean().parse(input.request.includeBackground);
  const result = CompositionAnalysisResultV1Schema.parse(input.result);
  if (result.sourceAssetSha256 !== sourceAssetSha256) {
    throw new TypeError('Composition result source digest must match the authoritative request.');
  }
  if (result.kind === 'composition_proposal') {
    if (result.parts.length > maxParts) {
      throw new RangeError('Composition result exceeds the request-specific part limit.');
    }
    if (!includeBackground && result.parts.some((part) => part.role === 'background')) {
      throw new TypeError('Composition result included a background excluded by the request.');
    }
  }
  return result;
};
