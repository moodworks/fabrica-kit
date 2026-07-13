import path from 'node:path';

import { Linter } from 'eslint';
import tseslint from 'typescript-eslint';
import { describe, expect, it } from 'vitest';

import { architectureBoundaryRule } from '../../eslint.config.mjs';

const repositoryRoot = process.cwd();
const bannerFile = path.join(repositoryRoot, 'packages/banner-ai/src/fixture.ts');
const databaseFile = path.join(repositoryRoot, 'packages/db/src/fixture.ts');
const webFile = path.join(repositoryRoot, 'apps/web/src/fixture.ts');

const verify = (code: string, filename: string) => {
  const linter = new Linter({ configType: 'flat' });
  return linter.verify(
    code,
    [
      {
        files: ['**/*.ts'],
        languageOptions: {
          parser: tseslint.parser,
          parserOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
          },
        },
        plugins: {
          'fabrica-architecture': {
            rules: { boundaries: architectureBoundaryRule },
          },
        },
        rules: { 'fabrica-architecture/boundaries': 'error' },
      },
    ],
    { filename },
  );
};

describe('architecture boundary lint rule', () => {
  it.each([
    [bannerFile, "import { z } from 'zod';"],
    [bannerFile, "import type { Local } from './local.js';"],
    [databaseFile, "import type { BannerSceneV1 } from '@fabrica/banner-ai';"],
    [webFile, "import '@fabrica/banner-ai'; import '@fabrica/db';"],
    [bannerFile, "type Zod = import('zod').ZodType;"],
  ])('allows an inward dependency from %s', (filename, code) => {
    expect(verify(code, filename)).toEqual([]);
  });

  it.each([
    [bannerFile, "import '../../db/src/index.js';", 'forbiddenBoundary'],
    [bannerFile, "export * from '../../../apps/web/src/index.js';", 'forbiddenBoundary'],
    [bannerFile, "export { value } from '@fabrica/db';", 'forbiddenBare'],
    [databaseFile, "import '../../../apps/web/src/index.js';", 'forbiddenBoundary'],
    [databaseFile, "import type { Route } from '@fabrica/web/routes';", 'forbiddenBare'],
    [bannerFile, "import Next from 'next';", 'forbiddenBare'],
    [bannerFile, "import React from 'react';", 'forbiddenBare'],
    [bannerFile, "import { eq } from 'drizzle-orm';", 'forbiddenBare'],
    [bannerFile, "import Stripe from 'stripe';", 'forbiddenBare'],
    [bannerFile, "import { createClient } from '@supabase/supabase-js';", 'forbiddenBare'],
    [bannerFile, "import OpenAI from 'openai';", 'forbiddenBare'],
    [bannerFile, "import { S3Client } from '@aws-sdk/client-s3';", 'forbiddenBare'],
    [bannerFile, "import { Queue } from 'bullmq';", 'forbiddenBare'],
    [bannerFile, "const db = import('@fabrica/db');", 'forbiddenBare'],
    [bannerFile, "const db = require('@fabrica/db');", 'forbiddenBare'],
    [bannerFile, "type Database = import('@fabrica/db').Database;", 'forbiddenBare'],
    [bannerFile, "const target = '@fabrica/db'; import(target);", 'nonLiteralDependency'],
    [bannerFile, "const target = '@fabrica/db'; require(target);", 'nonLiteralDependency'],
    [bannerFile, 'require();', 'nonLiteralDependency'],
  ])('rejects an outward or opaque dependency in %s', (filename, code, messageId) => {
    const messages = verify(code, filename);

    expect(messages).toHaveLength(1);
    expect(messages[0]?.messageId).toBe(messageId);
  });
});
