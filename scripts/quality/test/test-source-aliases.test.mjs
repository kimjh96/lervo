import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, expect, it } from "vitest";

import {
  checkTestSourceAliases,
  inspectTestSourceAliases,
  sourceAliases,
  testImports,
} from "../lib/test-source-aliases.mjs";

const packages = [{ name: "@lervo/example", directory: "packages/example" }];
const path = "packages/consumer/test/example.test.ts";
const rootAlias = ["@lervo/example", "./packages/example/src/index.ts"];
function check(specifier, aliases = [], exceptions) {
  return checkTestSourceAliases({
    packages,
    aliases,
    imports: [{ path, specifiers: [specifier] }],
    exceptions,
  });
}

it("finds imports and mocks without reading prose or comments", () => {
  expect(
    testImports(
      path,
      [
        'import type { A } from "@lervo/types";',
        'export { B } from "@lervo/barrel";',
        'type C = import("@lervo/type-query").C;',
        'await import("@lervo/dynamic");',
        'require("@lervo/required");',
        'vi.mock("@lervo/mocked", () => ({}));',
        'await vi.importActual("@lervo/actual");',
        "const prose = 'import(\"@lervo/prose\")';",
        '// import "@lervo/comment";',
      ].join("\n"),
    ),
  ).toEqual([
    "@lervo/actual",
    "@lervo/barrel",
    "@lervo/dynamic",
    "@lervo/mocked",
    "@lervo/required",
    "@lervo/type-query",
    "@lervo/types",
  ]);
});

it("requires source aliases only for workspace imports", () => {
  expect(check("@lervo/example")).toEqual([expect.stringContaining("missing source alias")]);
  expect(check("@lervo/example", [rootAlias])).toEqual([]);
  expect(check("external-dependency")).toEqual([]);
});

it("requires a specific subpath alias before its root alias", () => {
  const subpath = ["@lervo/example/workstream", "./packages/example/src/workstream.ts"];
  expect(check(subpath[0], [rootAlias])).toHaveLength(1);
  expect(check(subpath[0], [rootAlias, subpath])).toHaveLength(1);
  expect(check(subpath[0], [subpath, rootAlias])).toEqual([]);
});

it("rejects dist targets and aliases into another package", () => {
  for (const target of ["./packages/example/dist/index.js", "./packages/other/src/index.ts"]) {
    expect(check("@lervo/example", [["@lervo/example", target]])).toHaveLength(1);
  }
});

it("requires exact reasoned exceptions and never excuses a bad alias", () => {
  const exceptions = new Map([["@lervo/example", "Packed executable contract."]]);
  expect(check("@lervo/example", [], exceptions)).toEqual([]);
  expect(check("@lervo/example/other", [], exceptions)).toHaveLength(1);
  expect(check("@lervo/example", [], new Map([["@lervo/example", " "]]))).toHaveLength(1);
  expect(
    check("@lervo/example", [["@lervo/example", "./packages/example/dist/index.js"]], exceptions),
  ).toHaveLength(1);
});

it("parses literal aliases and rejects unsupported config or malformed source", () => {
  expect(
    sourceAliases(`const prose = '"@lervo/ignored": fromRoot("./fake")';
export default defineConfig({resolve: {alias: {"@lervo/example": fromRoot("./packages/example/src/index.ts")}}});`),
  ).toEqual([rootAlias]);
  expect(() => sourceAliases("export default defineConfig({});")).toThrow("literal resolve.alias");
  expect(() =>
    sourceAliases("export default defineConfig({resolve: {alias: {...shared}}});"),
  ).toThrow("literal names");
  expect(() => testImports(path, "import {")).toThrow("Cannot parse");
});

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function write(root, path, content) {
  mkdirSync(dirname(resolve(root, path)), { recursive: true });
  writeFileSync(resolve(root, path), content);
}

it("inspects untracked tests and helpers, checks targets, and preserves artifact paths", () => {
  const root = mkdtempSync(resolve(tmpdir(), "lervo-test-source-aliases-"));
  roots.push(root);
  execFileSync("git", ["init", "--quiet"], { cwd: root });
  write(root, "packages/example/package.json", JSON.stringify({ name: "@lervo/example" }));
  write(
    root,
    "vitest.config.ts",
    `export default defineConfig({resolve: {alias: {"@lervo/example": fromRoot("./packages/example/src/index.ts")}}});`,
  );
  write(root, path, 'import "@lervo/example"; await import("../../example/dist/index.js");');
  write(root, "packages/consumer/test/fixture.ts", 'export { A } from "@lervo/example/subpath";');
  const result = inspectTestSourceAliases(root);
  expect(result.packageCount).toBe(1);
  expect(result.testFileCount).toBe(2);
  expect(result.issues).toEqual([
    expect.stringContaining("needs an exact alias"),
    expect.stringContaining("alias target is missing"),
  ]);
  write(root, "packages/example/src/index.ts", "export const A = 1;");
  write(root, "packages/consumer/test/fixture.ts", 'export { A } from "@lervo/example";');
  expect(inspectTestSourceAliases(root).issues).toEqual([]);
});

it("keeps CI aliases inherited from the base config", () => {
  const config = readFileSync(new URL("../ci-vitest.config.mjs", import.meta.url), "utf8");
  expect(config).toContain('import base from "../../vitest.config.ts"');
  expect(config).toMatch(/mergeConfig\(base, \{/u);
  expect(config).not.toContain("alias:");
});
