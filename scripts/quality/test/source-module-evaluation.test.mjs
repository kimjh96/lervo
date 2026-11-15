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
      "export class Engine { static mode = 1; }",
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

function repository(files, reviewedCallees = new Map()) {
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
    reviewedCallees,
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

it("fails a module that registers into another module's state behind a barrel", () => {
  // Review repro: with direct imports a test reaches zz-b.ts without evaluating zz-a.ts.
  const { issues } = repository({
    "packages/one/src/index.ts":
      'export * from "./value.js";\nexport * from "./zz-a.js";\nexport * from "./zz-b.js";\n',
    "packages/one/src/zz-registry.ts": "export const zzRegistry: string[] = [];\n",
    "packages/one/src/zz-a.ts":
      'import { zzRegistry } from "./zz-registry.js";\nexport const zzRegisteredA = zzRegistry.push("a");\n',
    "packages/one/src/zz-b.ts":
      'import { zzRegistry } from "./zz-registry.js";\nexport function zzRegisteredNames() {\n  return [...zzRegistry];\n}\n',
  });
  expect(issues).toEqual([
    'packages/one/src/zz-a.ts:2: top-level side effect: zzRegistry.push("a")',
  ]);
});

it("fails a class static block that acts when the module is evaluated", () => {
  const { issues } = repository({
    "packages/one/src/value.ts":
      'import { two } from "@lervo/two";\nimport { zzRegistry } from "./zz-registry.js";\nexport const one = two;\nexport class Registered {\n  static {\n    zzRegistry.push("registered");\n  }\n}\n',
    "packages/one/src/zz-registry.ts": "export const zzRegistry: string[] = [];\n",
  });
  expect(issues).toEqual([
    'packages/one/src/value.ts:5: top-level side effect: static {\n    zzRegistry.push("registered");\n  }',
  ]);
});

it("passes a reviewed repository callee by its declaring module, and fails a stale review", () => {
  const files = {
    "packages/two/src/index.ts":
      'export const two = 2;\nexport * from "./reviewed.js";\nexport { digest } from "./digest.js";\n',
    "packages/two/src/digest.ts": "export function digest(value: string) {\n  return value;\n}\n",
    "packages/one/src/value.ts":
      'import { two, digest } from "@lervo/two";\nexport const one = digest(String(two));\n',
  };
  expect(repository(files).issues).toEqual([
    "packages/one/src/value.ts:2: top-level side effect: digest(String(two))",
  ]);
  const reviewed = new Map([["packages/two/src/digest.ts#digest", "Returns its argument."]]);
  expect(repository(files, reviewed).issues).toEqual([]);
  expect(repository({}, reviewed).issues).toEqual([
    "packages/two/src/digest.ts#digest: reviewed callee is no longer called",
  ]);
});
