import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['build/**', 'dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.jest,
        window: 'readonly',
        document: 'readonly',
        indexedDB: 'readonly',
        FileReader: 'readonly',
      },
    },
    rules: {
      'comma-dangle': ['warn', 'always-multiline'],
      'no-extra-semi': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-var': 'warn',
      'prefer-const': 'warn',
      radix: 'warn',
      semi: ['warn', 'always'],
      'semi-spacing': ['warn', { before: false, after: true }],
    },
  },
];
