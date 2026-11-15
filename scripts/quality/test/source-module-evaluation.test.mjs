import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import {
  inspectSourceModuleEvaluation,
  sourceModuleEvaluationFacts,
  valueImportCycles,
} from "../lib/source-module-evaluation.mjs";
import { writeFiles } from "./fixtures/direct-barrel-package.mjs";

let root;
beforeEach(() => {
  root = mkdtempSync(resolve(tmpdir(), "lervo-source-evaluation-"));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("lists only imports that evaluate a module", () => {
  const { imports } = sourceModuleEvaluationFacts(
    "a.ts",
    [
      'import type { A } from "./type-only.js";',
      'import { type B, type C } from "./type-elements.js";',
      'import { type D, value } from "./value.js";',
      'import fallback from "./default.js";',
      'import * as all from "./namespace.js";',
      'import "./bare.js";',
      'export * from "./star.js";',
      'export { named } from "./named.js";',
      'export type { E } from "./type-export.js";',
      'export { type F } from "./type-export-elements.js";',
      'const lazy = () => import("./dynamic.js");',
    ].join("\n"),
  );
  expect(imports).toEqual([
    "./value.js",
    "./default.js",
    "./namespace.js",
    "./bare.js",
    "./star.js",
    "./named.js",
  ]);
});

it("reports each top-level statement that is not a declaration", () => {
  const { sideEffects } = sourceModuleEvaluationFacts(
    "a.ts",
    [
      'import { check } from "./check.js";',
      "export const table = new Map([[1, 2]]);",
      "let counter = 0;",
      "export function run() { counter += 1; }",
      "export class Engine { static instance = new Engine(); }",
      "export enum Mode { A }",
      "export interface Shape {}",
      "export type Alias = string;",
      "declare global { var marker: string }",
      "export default table;",
      ";",
      "check(table);",
      "if (table.size > 0) counter = 1;",
      "for (const entry of table) counter += entry[0];",
      "try { run(); } catch {}",
      "{ counter = 2; }",
    ].join("\n"),
  );
  expect(sideEffects).toEqual([
    { line: 12, text: "check(table);" },
    { line: 13, text: "if (table.size > 0) counter = 1;" },
    { line: 14, text: "for (const entry of table) counter += entry[0];" },
    { line: 15, text: "try { run(); } catch {}" },
    { line: 16, text: "{ counter = 2; }" },
  ]);
});

it("finds every value-import cycle, including a module importing itself", () => {
  const edges = new Map([
    ["a", ["b"]],
    ["b", ["c"]],
    ["c", ["a", "d"]],
    ["d", []],
    ["e", ["e"]],
    ["f", ["d"]],
  ]);
  expect(valueImportCycles(edges)).toEqual([["a", "b", "c"], ["e"]]);
  expect(
    valueImportCycles(
      new Map([
        ["a", ["b"]],
        ["b", []],
      ]),
    ),
  ).toEqual([]);
});

function repository(files) {
  writeFiles(root, {
    "vitest.config.ts": `import { defineConfig } from "vitest/config";
const fromRoot = (path: string) => path;
export default defineConfig({
  resolve: {
    alias: {
      "@lervo/one": fromRoot("./packages/one/src/index.ts"),
      "@lervo/two": fromRoot("./packages/two/src/index.ts"),
    },
  },
});
`,
    "packages/one/src/index.ts": 'export * from "./value.js";\n',
    "packages/one/src/value.ts": 'import { two } from "@lervo/two";\nexport const one = two;\n',
    "packages/two/src/index.ts": 'export const two = 2;\nexport * from "./reviewed.js";\n',
    "packages/two/src/reviewed.ts": "export const ready = true;\nassertReady(ready);\n",
    "packages/two/test/two.test.ts": 'import { it } from "vitest";\nit("runs", () => {});\n',
    // An entrypoint that no aliased entry reaches is never reordered or skipped.
    "packages/two/src/bin.ts": 'import { two } from "./index.js";\nprocess.exitCode = two;\n',
    ...files,
  });
  return inspectSourceModuleEvaluation({
    repositoryRoot: root,
    reviewedSideEffects: new Map([["packages/two/src/reviewed.ts", ["assertReady(ready);"]]]),
  });
}

it("passes an acyclic source graph whose only side effect is reviewed", () => {
  expect(repository({})).toEqual({ issues: [], moduleCount: 4, importCount: 3 });
});

it("fails a value-import cycle across aliased packages and through relative imports", () => {
  const { issues } = repository({
    "packages/two/src/index.ts":
      'import { one } from "@lervo/one";\nexport const two = 2;\nexport { one };\nexport * from "./reviewed.js";\n',
  });
  expect(issues).toEqual([
    "value-import cycle among packages/one/src/index.ts, packages/one/src/value.ts, packages/two/src/index.ts",
  ]);
});

it("fails a new or changed top-level side effect, and a stale review", () => {
  const { issues } = repository({
    "packages/one/src/value.ts":
      'import { two } from "@lervo/two";\nexport const one = two;\nglobalThis.one = one;\n',
    "packages/two/src/reviewed.ts": "export const ready = true;\nassertReady(!ready);\n",
  });
  expect(issues).toEqual([
    "packages/one/src/value.ts:3: top-level side effect: globalThis.one = one;",
    "packages/two/src/reviewed.ts:2: top-level side effect: assertReady(!ready);",
    "packages/two/src/reviewed.ts: reviewed side effect no longer present: assertReady(ready);",
  ]);
});
