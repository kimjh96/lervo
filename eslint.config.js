import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

import { errorCausePlugin } from "./scripts/quality/lib/eslint-error-cause-rule.mjs";
import { jsxLiteralPlugin } from "./scripts/quality/lib/eslint-jsx-literal-rule.mjs";
import { providerSchemaPlugin } from "./scripts/quality/lib/eslint-provider-schema-any-rule.mjs";

export default defineConfig(
  globalIgnores(
    [
      "**/node_modules/**",
      "**/dist/**",
      "coverage/**",
      ".lervo/data/**",
      ".lervo/generated/**",
      ".lervo/knowledge/**",
      ".lervo/state/**",
      ".claude/worktrees/**",
      "packages/session-host-contract/generated/**",
      "apps/ade/target/**",
    ],
    "Lervo generated and dependency artifacts",
  ),
  {
    name: "lervo/javascript",
    files: ["**/*.{js,mjs,cjs}"],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: "latest",
      globals: globals.node,
      sourceType: "module",
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "no-control-regex": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
        },
      ],
      "prefer-const": ["error", { destructuring: "all", ignoreReadBeforeAssign: true }],
    },
  },
  {
    name: "lervo/browser-assets",
    files: ["apps/hub/assets/**/*.js"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    name: "lervo/typescript",
    files: ["**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    rules: {
      "no-control-regex": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "@typescript-eslint/no-empty-object-type": [
        "error",
        { allowInterfaces: "with-single-extends" },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
        },
      ],
      "prefer-const": ["error", { destructuring: "all", ignoreReadBeforeAssign: true }],
    },
  },
  {
    name: "lervo/error-fidelity",
    files: ["apps/*/src/**/*.ts", "packages/*/src/**/*.ts"],
    plugins: { lervo: errorCausePlugin },
    rules: {
      "lervo/require-caught-error-cause": "error",
    },
  },
  {
    // ADR-0608: an `any` value may not stand where a provider output schema is expected. The rule
    // reads types, so only production source pays for the project service.
    name: "lervo/provider-schema-any",
    files: ["apps/*/src/**/*.ts", "packages/*/src/**/*.ts"],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    plugins: { "lervo-provider-schema": providerSchemaPlugin },
    rules: {
      "lervo-provider-schema/no-any-provider-schema": "error",
    },
  },
  {
    // A connection must install its busy handler before any statement that can need a lock.
    name: "lervo/sqlite-connection-owner",
    files: ["apps/*/src/**/*.ts", "packages/*/src/**/*.ts"],
    ignores: ["packages/sqlite-connection/src/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='DatabaseSync']",
          message: "Open SQLite connections with openSqliteDatabase from @lervo/sqlite-connection.",
        },
      ],
    },
  },
  {
    name: "lervo/test-fixtures",
    files: ["**/*.test.{js,mjs,cjs,ts}", "**/test/**/*.{js,mjs,cjs,ts}"],
    rules: {
      "no-useless-escape": "off",
      "require-yield": "off",
    },
  },
  {
    name: "lervo/self-referential-runtime-test-fixtures",
    files: [
      "apps/node-runtime/test/managed-provider-runtime.test.ts",
      "apps/node-runtime/test/runtime.test.ts",
    ],
    rules: {
      "prefer-const": "off",
    },
  },
  {
    // ADE convention: the React interface runs in a webview, keeps interface text in message
    // catalogs, uses accessible native controls, and never imports Lervo packages directly.
    name: "lervo/ade-interface",
    files: ["apps/ade/**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      globals: globals.browser,
      parser: tseslint.parser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: "error",
    },
    plugins: { "lervo-jsx": jsxLiteralPlugin },
    rules: {
      "lervo-jsx/no-jsx-literals": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@lervo/*", "!@lervo/session-host-contract"],
              message: "The ADE interface reaches Lervo only through @lervo/session-host-contract.",
            },
          ],
        },
      ],
    },
  },
  {
    name: "lervo/ade-build-config",
    files: ["apps/ade/vite.config.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    ...eslintConfigPrettier,
    name: "lervo/prettier-compatibility",
  },
);
