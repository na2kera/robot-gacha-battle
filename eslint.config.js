import { defineConfig } from 'eslint/config';
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default defineConfig([
  { ignores: ['dist', '.wrangler', 'node_modules', 'worker-configuration.d.ts', 'docs'] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // 先頭 _ の引数・変数は未使用を許す
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // shared は他層を参照しない
    files: ['shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['phaser', '**/client/**', '**/server/**', 'cloudflare:*'] },
      ],
    },
  },
  prettier,
]);
