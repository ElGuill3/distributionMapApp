import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Main source files - use main tsconfig
  {
    files: ['src/ts/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    rules: {
      // Allow existing eslint-disable directives to continue working
      // No additional strict rules for first-pass rollout
    },
  },
  // Test files - use lint-specific tsconfig that includes tests
  {
    files: ['tests/**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.lint.json',
      },
    },
    rules: {
      // Allow existing eslint-disable directives to continue working
      // Tests may have different conventions (e.g., looser typing)
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    // Explicitly ignore excluded paths
    ignores: [
      'static/**',
      'node_modules/**',
      'dist/**',
      'build/**',
      '**/*.d.ts',
    ],
  },
];
