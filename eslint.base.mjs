import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Shared flat ESLint config for every workspace.
 *
 * Security-relevant rules are enabled deliberately:
 *   - no-explicit-any            → prevents `any` from eroding type safety at the
 *                                 boundary where authorization metadata lives
 *   - no-unnecessary-condition   → catches impossible null checks that often hide
 *                                 "maybe I forgot to scope this query"
 *   - no-implicit-coercion      → prevents surprising truthiness on IDs and codes
 */
/**
 * Files that participate in type-aware linting. Plain JS/MJS (eslint configs,
 * the service worker) are linted by the recommended non-typed rules only:
 * asking the project service to resolve them raises a parsing error, and the
 * typed rules would fail with "requires type information".
 */
const TYPED_FILES = ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'];

export const baseConfig = [
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/storage/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  // Scope every typed preset to TypeScript files: the presets themselves carry
  // type-aware rules that throw if no type information is available.
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: config.files ?? TYPED_FILES,
  })),
  {
    files: TYPED_FILES,
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'separate-type-imports' },
      ],
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-implicit-coercion': ['error', { boolean: false }],
      eqeqeq: ['error', 'smart'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'no-return-await': 'error',
      // Log payloads are assembled from objects the type system cannot vouch for
      // (pino serializers, Prisma results). Passing one to `log.info` hands an
      // `any` straight to the serializer, so the unsafe-* family is enforced on
      // call sites instead of blanket-disabled.
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
    },
  },
];

export default baseConfig;