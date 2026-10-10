import { baseConfig } from '../../eslint.base.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
      },
    },
    rules: {
      // Entry point and jobs legitimately use console/process before the logger
      // exists; everything else routes through lib/logger.ts.
      'no-console': 'off',
      '@typescript-eslint/no-unnecessary-condition': 'off',
    },
  },
  {
    // `validated.body()` and friends return `T['_output']`. Because
    // `ZodTypeAny` is `ZodType<any, any, any>`, that type IS `any`, so the
    // compiler cannot verify the assertion — even though the value was produced
    // by the very schema the caller passes in, which makes it sound.
    //
    // `no-unsafe-return` is therefore silenced for this file only, rather than
    // weakening the return type to `unknown` (which would strip inference from
    // every route handler) or adding a disable comment to every accessor.
    files: ['src/middleware/validate.ts'],
    rules: { '@typescript-eslint/no-unsafe-return': 'off' },
  },
  {
    // Prisma client generates very large unions that confuse type-aware linting.
    files: ['src/types/prisma.d.ts', 'prisma/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
];