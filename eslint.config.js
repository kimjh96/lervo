import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import globals from "globals";
import tseslint from "typescript-eslint";

import { errorCausePlugin } from "./scripts/quality/lib/eslint-error-cause-rule.mjs";
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
    ...eslintConfigPrettier,
    name: "lervo/prettier-compatibility",
  },
);
