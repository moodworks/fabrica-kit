import { z } from 'zod';

import { Sha256HexSchema } from '../scene/banner-scene-v1.schema.js';
import { sha256Hex } from '../scene/canonical-scene-json.js';

export const BannerAiPromptIdSchema = z.enum([
  'scene-analysis-v1',
  'background-fill-v1',
  'animation-plan-v1',
]);

export const PromptContentSha256Schema = Sha256HexSchema.brand<'PromptContentSha256'>();

const canonicalPromptContentSchema = z.string().superRefine((content, context) => {
  if (
    content.length < 1 ||
    content.normalize('NFC') !== content ||
    content.trim() !== content ||
    content.includes('\r')
  ) {
    context.addIssue({
      code: 'custom',
      message: 'Canonical prompt content must be non-empty trimmed NFC text with LF line endings.',
    });
  }
});

export const BannerAiPromptCatalogEntryV1Schema = z
  .strictObject({
    id: BannerAiPromptIdSchema,
    version: z.literal(1),
    content: canonicalPromptContentSchema,
    contentSha256: PromptContentSha256Schema,
  })
  .superRefine((prompt, context) => {
    const actual = sha256Hex(Buffer.from(prompt.content, 'utf8'));
    if (actual !== prompt.contentSha256) {
      context.addIssue({
        code: 'custom',
        message: 'Prompt content differs from its frozen UTF-8 SHA-256.',
        path: ['contentSha256'],
      });
    }
  })
  .readonly();

export type BannerAiPromptId = z.infer<typeof BannerAiPromptIdSchema>;
export type BannerAiPromptCatalogEntryV1 = z.infer<typeof BannerAiPromptCatalogEntryV1Schema>;

const sceneAnalysisPromptContent = `You are the scene-analysis stage in the Banner AI pipeline.
Inspect the supplied banner image and propose a small, useful set of visual layers.
Preserve visible text exactly; never rewrite, translate, invent, or omit it.
Use normalized basis-point bounds from 0 to 10000 and stable semantic layer roles.
Do not perform segmentation, inpainting, animation rendering, or general-agent actions.
Return only structured data matching the supplied scene-analysis output contract.`;

const backgroundFillPromptContent = `You are the background-fill stage in the Banner AI pipeline.
Fill only the supplied masked region while respecting the source image, requested dimensions, and surrounding visual context.
Do not alter pixels outside the mask and do not add, remove, rewrite, or translate visible text.
Do not perform scene analysis, segmentation, animation planning, or general-agent actions.
Return only output described by the supplied background-fill contract.`;

const animationPlanPromptContent = `You are the animation-planning stage in the Banner AI pipeline.
Create a restrained animation plan only for the supplied canonical layers and timing limits.
Preserve all text layers exactly and never invent layers, assets, copy, links, or interactions.
Do not render animation, modify pixels, perform segmentation, or take general-agent actions.
Return only structured data matching the supplied animation-plan contract.`;

export const SCENE_ANALYSIS_PROMPT_V1 = BannerAiPromptCatalogEntryV1Schema.parse({
  id: 'scene-analysis-v1',
  version: 1,
  content: sceneAnalysisPromptContent,
  contentSha256: '5cc311b7b353e06c61bcdf840b40dff9d35de0aea12851ffa18a654177917227',
});

export const BACKGROUND_FILL_PROMPT_V1 = BannerAiPromptCatalogEntryV1Schema.parse({
  id: 'background-fill-v1',
  version: 1,
  content: backgroundFillPromptContent,
  contentSha256: '98c6a7212d29cecd8b4949bc35f7baeb770826e675fb705e0854f52ec2408b97',
});

export const ANIMATION_PLAN_PROMPT_V1 = BannerAiPromptCatalogEntryV1Schema.parse({
  id: 'animation-plan-v1',
  version: 1,
  content: animationPlanPromptContent,
  contentSha256: 'a096c0e71b81143b9e8c533e6360fa5159b2e849e8b274d9556a9531b4580393',
});

export const CANONICAL_BANNER_AI_PROMPTS = Object.freeze([
  SCENE_ANALYSIS_PROMPT_V1,
  BACKGROUND_FILL_PROMPT_V1,
  ANIMATION_PLAN_PROMPT_V1,
] as const);

const canonicalPromptById = new Map<BannerAiPromptId, BannerAiPromptCatalogEntryV1>(
  CANONICAL_BANNER_AI_PROMPTS.map((prompt) => [prompt.id, prompt]),
);

export const BannerAiPromptRefV1Schema = z
  .strictObject({
    id: BannerAiPromptIdSchema,
    version: z.literal(1),
    contentSha256: PromptContentSha256Schema,
  })
  .superRefine((reference, context) => {
    const canonical = canonicalPromptById.get(reference.id);
    if (
      canonical === undefined ||
      canonical.version !== reference.version ||
      canonical.contentSha256 !== reference.contentSha256
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Prompt reference is stale or differs from the canonical catalog entry.',
      });
    }
  })
  .readonly();

export type BannerAiPromptRefV1 = z.infer<typeof BannerAiPromptRefV1Schema>;

export const getCanonicalBannerAiPrompt = (input: unknown): BannerAiPromptCatalogEntryV1 => {
  const id = BannerAiPromptIdSchema.parse(input);
  const prompt = canonicalPromptById.get(id);
  if (prompt === undefined) {
    throw new TypeError('Canonical Banner AI prompt was not found.');
  }
  return prompt;
};

export const canonicalBannerAiPromptRef = (input: unknown): BannerAiPromptRefV1 => {
  const prompt = getCanonicalBannerAiPrompt(input);
  return BannerAiPromptRefV1Schema.parse({
    id: prompt.id,
    version: prompt.version,
    contentSha256: prompt.contentSha256,
  });
};

export const validateCanonicalBannerAiPromptRef = (input: unknown): BannerAiPromptRefV1 =>
  BannerAiPromptRefV1Schema.parse(input);
