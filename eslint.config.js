import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

import { errorCausePlugin } from "./scripts/quality/lib/eslint-error-cause-rule.mjs";
import { adeMotionPlugin } from "./scripts/quality/lib/eslint-ade-motion-rule.mjs";
import { jsxLiteralPlugin } from "./scripts/quality/lib/eslint-jsx-literal-rule.mjs";
import { providerSchemaPlugin } from "./scripts/quality/lib/eslint-provider-schema-any-rule.mjs";

/** Only `@lervo/session-host-contract` among the Lervo packages reaches the ADE interface. */
const adeLervoImports = {
  group: ["@lervo/*", "!@lervo/session-host-contract"],
  message: "The ADE interface reaches Lervo only through @lervo/session-host-contract.",
};

/**
 * ADE convention, "Layers": dependencies point inward. Models depend on ports and the contract,
 * views reach other features through their `index.ts`, only the composition root builds I/O
 * adapters, and `ui/`, `ports/`, and `platform/` know no feature. Tests import the module they
 * test, so these rules cover `src/` only.
 */
function adeLayerRules() {
  // A group is a list of gitignore-style paths, or a regular expression for a shape the paths
  // cannot express.
  const restriction = ([match, message]) =>
    match instanceof RegExp ? { regex: match.source, message } : { group: match, message };
  const layer = (name, files, groups) => ({
    name: `lervo/ade-layer-${name}`,
    files,
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [adeLervoImports, ...groups.map(restriction)] },
      ],
    },
  });
  const otherFeatureInternals = [
    ["../../*/model", "../../*/model/**", "../../*/view", "../../*/view/**"],
    "Import another feature through its index.ts.",
  ];
  // A model reaches another feature through that feature's model entry, `<feature>/model`, since
  // the feature's index.ts also loads its views.
  const otherFeatureModelInternals = [
    ["../../*/model/**", "../../*/view", "../../*/view/**"],
    "Import another feature's model through its model entry, `<feature>/model`.",
  ];
  const otherFeatureIndex = [
    /^\.\.\/\.\.\/[^/]+$/u,
    "A model imports another feature through its model entry, `<feature>/model`; the feature's index.ts also loads its views.",
  ];
  const composition = [["**/app", "**/app/**"], "Only main.tsx depends on the composition root."];
  const ioAdapters = [
    [
      "**/platform/session-host",
      "**/platform/session-host/**",
      "**/platform/clipboard",
      "**/platform/notifications",
      "**/platform/storage",
      "**/platform/visibility",
    ],
    "Features reach I/O through ports; main.tsx builds the adapters.",
  ];
  return [
    layer(
      "features",
      ["apps/ade/src/features/**/*.{ts,tsx}"],
      [otherFeatureInternals, composition, ioAdapters],
    ),
    layer(
      "models",
      ["apps/ade/src/features/*/model/**/*.{ts,tsx}"],
      [
        otherFeatureModelInternals,
        otherFeatureIndex,
        composition,
        [
          ["**/platform", "**/platform/**", "**/ui", "**/ui/**", "**/view", "**/view/**"],
          "Models perform no I/O and render nothing; effects enter through ports.",
        ],
        [["react-intl", "react-dom", "@tauri-apps/*"], "Models perform no I/O and render nothing."],
      ],
    ),
    layer(
      "app",
      ["apps/ade/src/app/**/*.{ts,tsx}"],
      [
        [
          [
            "**/features/*/model",
            "**/features/*/model/**",
            "**/features/*/view",
            "**/features/*/view/**",
          ],
          "Import a feature through its index.ts.",
        ],
      ],
    ),
    layer(
      "ports",
      ["apps/ade/src/ports/**/*.{ts,tsx}"],
      [
        [
          [
            "**/features",
            "**/features/**",
            "**/app",
            "**/app/**",
            "**/platform",
            "**/platform/**",
            "**/ui",
            "**/ui/**",
          ],
          "Ports depend only on the contract.",
        ],
      ],
    ),
    layer(
      "platform",
      ["apps/ade/src/platform/**/*.{ts,tsx}"],
      [
        [
          ["**/features", "**/features/**", "**/app", "**/app/**", "**/ui", "**/ui/**"],
          "Adapters implement ports and know no feature.",
        ],
      ],
    ),
    layer(
      "catalog",
      ["apps/ade/catalog/**/*.{ts,tsx}"],
      [
        [
          [
            "**/src/features",
            "**/src/features/**",
            "**/src/app",
            "**/src/app/**",
            "**/src/platform",
            "**/src/platform/**",
            "**/src/ports",
            "**/src/ports/**",
          ],
          "The catalog shows shared components and tokens only.",
        ],
      ],
    ),
    layer(
      "ui",
      ["apps/ade/src/ui/**/*.{ts,tsx}"],
      [
        [
          [
            "**/features",
            "**/features/**",
            "**/app",
            "**/app/**",
            "**/platform",
            "**/platform/**",
            "**/ports",
            "**/ports/**",
          ],
          "Shared primitives know nothing about Lervo concepts.",
        ],
      ],
    ),
  ];
}

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
          patterns: [adeLervoImports],
        },
      ],
    },
  },
  ...adeLayerRules(),
  {
    // The catalog documents components with example text; it is not shipped interface copy.
    name: "lervo/ade-catalog",
    files: ["apps/ade/catalog/**/*.tsx"],
    rules: { "lervo-jsx/no-jsx-literals": "off" },
  },
  {
    // ADE motion, "Coming and going": every element a view shows sometimes has a decided motion.
    name: "lervo/ade-motion",
    files: ["apps/ade/src/features/**/view/**/*.tsx", "apps/ade/src/app/**/*.tsx"],
    plugins: { "lervo-ade-motion": adeMotionPlugin },
    rules: { "lervo-ade-motion/declared-motion": "error" },
  },
  {
    name: "lervo/ade-build-config",
    files: ["apps/ade/vite.config.ts", "apps/ade/vite.catalog.config.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    ...eslintConfigPrettier,
    name: "lervo/prettier-compatibility",
  },
);
