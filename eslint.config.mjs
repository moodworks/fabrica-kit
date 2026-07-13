import js from '@eslint/js';
import nextTypeScript from 'eslint-config-next/typescript';
import nextVitals from 'eslint-config-next/core-web-vitals';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';

const scopeConfigs = (configs, files) =>
  (Array.isArray(configs) ? configs : [configs]).map((config) => ({
    ...config,
    files,
  }));

const javascriptFiles = ['**/*.{js,jsx,mjs,cjs}'];
const typeScriptFiles = ['**/*.{ts,tsx}'];
const webFiles = ['apps/web/**/*.{js,jsx,mjs,cjs,ts,tsx}'];
const webTypeScriptFiles = ['apps/web/**/*.{ts,tsx}'];

const repositoryRoot = path.dirname(fileURLToPath(import.meta.url));
const bannerRoot = path.join(repositoryRoot, 'packages', 'banner-ai');
const databaseRoot = path.join(repositoryRoot, 'packages', 'db');
const webRoot = path.join(repositoryRoot, 'apps', 'web');

const bannerForbiddenBarePrefixes = [
  '@fabrica/web',
  '@fabrica/db',
  'apps/web',
  'packages/db',
  'next',
  'react',
  'react-dom',
  'drizzle-orm',
  'postgres',
  '@supabase',
  '@makerkit',
  'stripe',
  '@stripe',
  'openai',
  '@anthropic-ai',
  'replicate',
  '@runpod',
  '@aws-sdk',
  '@google-cloud',
  '@vercel',
  'cloudflare',
  'bullmq',
  'inngest',
  '@trigger.dev',
];

const databaseForbiddenBarePrefixes = ['@fabrica/web', 'apps/web', 'next', 'react', 'react-dom'];

const isWithin = (candidate, boundary) => {
  const relative = path.relative(boundary, candidate);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
};

const matchesBarePrefix = (specifier, prefix) =>
  specifier === prefix || specifier.startsWith(`${prefix}/`);

const getLiteralSpecifier = (source) => {
  if (typeof source?.value === 'string') {
    return source.value;
  }

  if (source?.type === 'TemplateLiteral' && source.expressions.length === 0) {
    return source.quasis[0]?.value.cooked ?? null;
  }

  return null;
};

export const architectureBoundaryRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce inward package dependencies and reject forbidden vendor imports.',
    },
    schema: [],
    messages: {
      forbiddenBare:
        '{{zone}} must not import forbidden framework, outer-package, provider, cloud, auth, billing, storage, or queue module {{specifier}}.',
      forbiddenBoundary: '{{zone}} must not import files from {{targetZone}}.',
      nonLiteralDependency:
        '{{zone}} must use one statically analyzable literal for dynamic import/require dependencies so boundaries remain enforceable.',
    },
  },
  create(context) {
    const importer = path.resolve(context.filename ?? context.getFilename());
    const zone = isWithin(importer, bannerRoot)
      ? 'banner-ai'
      : isWithin(importer, databaseRoot)
        ? 'db'
        : null;

    if (zone === null) {
      return {};
    }

    const checkSpecifier = (node, source, dynamic = false) => {
      const specifier = getLiteralSpecifier(source);

      if (specifier === null) {
        if (dynamic) {
          context.report({ node, messageId: 'nonLiteralDependency', data: { zone } });
        }
        return;
      }

      const barePrefixes =
        zone === 'banner-ai' ? bannerForbiddenBarePrefixes : databaseForbiddenBarePrefixes;
      const isRelative =
        specifier === '.' ||
        specifier === '..' ||
        specifier.startsWith('./') ||
        specifier.startsWith('../');
      const isPathLike = isRelative || path.isAbsolute(specifier);

      if (!isPathLike && barePrefixes.some((prefix) => matchesBarePrefix(specifier, prefix))) {
        context.report({
          node: source,
          messageId: 'forbiddenBare',
          data: { specifier, zone },
        });
        return;
      }

      if (!isPathLike) {
        return;
      }

      const resolvedTarget = path.resolve(path.dirname(importer), specifier);
      const forbiddenTarget =
        zone === 'banner-ai'
          ? isWithin(resolvedTarget, databaseRoot)
            ? 'packages/db'
            : isWithin(resolvedTarget, webRoot)
              ? 'apps/web'
              : null
          : isWithin(resolvedTarget, webRoot)
            ? 'apps/web'
            : null;

      if (forbiddenTarget !== null) {
        context.report({
          node: source,
          messageId: 'forbiddenBoundary',
          data: { targetZone: forbiddenTarget, zone },
        });
      }
    };

    return {
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') {
          if (node.arguments.length !== 1) {
            context.report({ node, messageId: 'nonLiteralDependency', data: { zone } });
            return;
          }
          checkSpecifier(node, node.arguments[0], true);
        }
      },
      ExportAllDeclaration(node) {
        checkSpecifier(node, node.source);
      },
      ExportNamedDeclaration(node) {
        if (node.source != null) {
          checkSpecifier(node, node.source);
        }
      },
      ImportDeclaration(node) {
        checkSpecifier(node, node.source);
      },
      ImportExpression(node) {
        checkSpecifier(node, node.source, true);
      },
      TSImportType(node) {
        checkSpecifier(node, node.source);
      },
    };
  },
};

export const architecturePlugin = {
  meta: {
    name: 'fabrica-architecture',
    version: '1.0.0',
  },
  rules: {
    boundaries: architectureBoundaryRule,
  },
};

export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.local-data/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  {
    ...js.configs.recommended,
    files: javascriptFiles,
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
  },
  ...scopeConfigs(tseslint.configs.recommended, typeScriptFiles),
  ...scopeConfigs(nextVitals, webFiles),
  ...scopeConfigs(nextTypeScript, webTypeScriptFiles),
  {
    files: ['packages/banner-ai/**/*.{ts,tsx}', 'packages/db/**/*.{ts,tsx}'],
    plugins: {
      'fabrica-architecture': architecturePlugin,
    },
    rules: {
      'fabrica-architecture/boundaries': 'error',
    },
  },
];
