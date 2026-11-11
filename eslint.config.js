import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/dist-app/**',
      // Exports made by the editor in browser mode: built player code.
      'exports/**',
      'projects/**',
      '**/src-tauri/target/**',
      '**/src-tauri/gen/**',
      '**/coverage/**',
      'packages/schema/json/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: [
      'packages/runtime/**/*.ts',
      'apps/player-web/**/*.ts',
      'apps/editor/src/**/*.{ts,tsx}',
      'packages/player/src/**/*.ts',
    ],
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    files: ['apps/editor/src/**/*.{ts,tsx}'],
    ...reactHooks.configs.flat['recommended-latest'],
  },
  {
    // core must stay pure: no rendering, no DOM, no runtime.
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['pixi.js', 'pixi.js/*', '@pixi/*'],
              message: 'core must not depend on rendering.',
            },
            {
              group: ['@freequest/runtime', '@freequest/runtime/*'],
              message: 'core must never import runtime.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'window',
        'document',
        'navigator',
        'requestAnimationFrame',
      ],
    },
  },
  prettier,
);
