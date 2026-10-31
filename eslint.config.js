import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default [
  // .claude: werkmappen (worktrees) van Claude-helpers; die hebben hun eigen controle.
  { ignores: ['dist', 'dist-voorbeeld', 'voorbeeld', 'node_modules', 'brug/node_modules', '.claude'] },
  js.configs.recommended,
  {
    files: ['src/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Componenten (hoofdletter) gebruik je in JSX; dat ziet de kale regel niet.
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['brug/**/*.{js,mjs}', 'scripts/**/*.mjs', 'base44/tests/**/*.js', '*.config.js', '**/*.test.{js,jsx}'],
    languageOptions: { globals: globals.node },
  },
  {
    // De servercode draait op Base44 in Deno, niet in Node: geen Node-globals
    // (Buffer, process) en geen imports uit 'node:…'. De rooktest in Deno
    // (base44/tests/rook.deno.js) proeft het echt.
    files: ['base44/**/*.js'],
    ignores: ['base44/tests/**'],
    languageOptions: { globals: { ...globals.browser, Deno: 'readonly' } },
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['node:*'], message: 'Base44 draait de functies in Deno: geen Node-modules.' }] }],
    },
  },
  {
    files: ['base44/tests/**/*.deno.js'],
    languageOptions: { globals: { Deno: 'readonly' } },
  },
];
