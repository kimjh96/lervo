import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { moduleObjectReferencesIn, scanTestModulePins } from "../lib/test-module-pins.mjs";
import { examplePackage, writeFiles } from "./fixtures/direct-barrel-package.mjs";

let root;
let aliases;
const at = (path) => resolve(root, path);
const source = (name) => at(`packages/example/src/${name}.ts`);
const test = () => at("packages/example/test/example.test.ts");
const pinnedBy = (lines) =>
  [...moduleObjectReferencesIn(test(), lines.join("\n"), aliases).pinned].sort();

beforeEach(() => {
  root = mkdtempSync(resolve(tmpdir(), "lervo-module-pins-"));
  writeFiles(root, examplePackage);
  aliases = new Map([["@lervo/example", source("index")]]);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("pins mocked, actual-imported, namespace-imported and required modules", () => {
  expect(
    pinnedBy([
      'vi.mock("@lervo/example", () => ({}));',
      'vi.mock(import("../src/more.js"));',
      "vi.doMock(`../src/left.js`);",
      'await vi.importActual<typeof import("../src/right.js")>("../src/right.js");',
      'import * as values from "../src/values.js";',
      'export * as reexported from "../src/imported.js";',
      'const { renamed } = require("../src/renamed.js");',
      'import { deep } from "../src/nested/deep.js";',
    ]),
  ).toEqual(["index", "more", "left", "right", "values", "imported", "renamed"].map(source).sort());
});

it("pins a namespace imported beside a default binding", () => {
  expect(pinnedBy(['import fallback, * as values from "@lervo/example";'])).toEqual([
    source("index"),
  ]);
});

it("pins every dynamic import whose module object the test keeps", () => {
  expect(
    pinnedBy([
      "let assigned;",
      'assigned = await import("../src/values.js");',
      'vi.spyOn(await import("../src/more.js"), "more");',
      'import("../src/left.js").then((module) => module);',
      'const kept = await import("@lervo/example");',
      'const [right] = await Promise.all([import("../src/right.js")]);',
    ]),
  ).toEqual(["values", "more", "left", "index", "right"].map(source).sort());
});

it("never pins a dynamic import that only reads members, or a type position", () => {
  expect(
    pinnedBy([
      'const { more } = await import("../src/more.js");',
      'const value = (await import("../src/values.js")).value;',
      'const left = (await import("../src/left.js"))["clash"];',
      'type T = typeof import("../src/right.js");',
      'type U = import("../src/values.js").Shape;',
      'import type * as Types from "../src/types.js";',
      'export type * as Exported from "../src/types.js";',
      '// vi.mock("../src/imported.js"); a comment loads nothing',
      "const text = \"import * as fake from '../src/renamed.js'\";",
    ]),
  ).toEqual([]);
});

it("reports a mock whose specifier is computed", () => {
  // Assembled at run time, so the repository scan never sees a computed mock in this file.
  const computed = (call, argument) => `vi.${call}(${argument});`;
  for (const argument of ["path", "`../src/${name}.js`", 'import(path + ".js")'])
    expect(moduleObjectReferencesIn(test(), computed("mock", argument), aliases).computedMock).toBe(
      true,
    );
  expect(moduleObjectReferencesIn(test(), 'vi.mock("../src/more.js");', aliases).computedMock).toBe(
    false,
  );
});

it("scans tests, helpers that import vitest, and every configured setup file", () => {
  const computed = (call, argument) => `vi.${call}(${argument});`;
  writeFiles(root, {
    "packages/example/test/helper.ts": 'vi.mock("../src/left.js");\n',
    "packages/example/src/product.ts":
      'const note = "vi.mock(\\"./right.js\\")";\nvi.mock("./right.js");\n',
    "packages/example/src/testing.ts": 'import { vi } from "vitest";\nvi.mock("./more.js");\n',
    "packages/example/test/computed.test.ts": `${computed("doMock", "target")}\n`,
    "tools/setup/mock-values.mjs": 'vi.mock("../../packages/example/src/values.js");\n',
    "tools/setup/global.mjs":
      'import * as deep from "../../packages/example/src/nested/deep.js";\n',
  });
  const scanned = scanTestModulePins({
    repositoryRoot: root,
    aliases,
    setupFiles: [at("tools/setup/mock-values.mjs"), at("tools/setup/global.mjs")],
  });
  expect(scanned.pinned.has(source("left"))).toBe(true);
  expect(scanned.pinned.has(source("more"))).toBe(true);
  expect(scanned.pinned.has(source("values"))).toBe(true);
  expect(scanned.pinned.has(source("nested/deep"))).toBe(true);
  // Product code that never imports vitest cannot register a mock.
  expect(scanned.pinned.has(source("right"))).toBe(false);
  expect(scanned.computedMocks).toEqual(["packages/example/test/computed.test.ts"]);
});
