import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import {
  createBarrelExportOrigins,
  parseModuleExports,
} from "../lib/test-barrel-export-origins.mjs";
import { examplePackage, writeFiles } from "./fixtures/direct-barrel-package.mjs";

let root;
const at = (path) => resolve(root, path);

beforeEach(() => {
  root = mkdtempSync(resolve(tmpdir(), "lervo-barrel-origins-"));
  writeFiles(root, examplePackage);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

it("reads value exports and skips type-only and ambient declarations", () => {
  const parsed = parseModuleExports(
    "values.ts",
    [
      "export const value = 1;",
      "export function run() {}",
      "export class Engine {}",
      "export enum Mode { A }",
      "export const { left: destructured, ...rest } = { left: 1 };",
      "export interface Shape {}",
      "export type Alias = string;",
      "export declare const ambient: number;",
      "export default function main() {}",
      'import { a, type T } from "./a.js";',
      'import * as all from "./all.js";',
      "export { a, all, type T };",
      'export { type Hidden, shown } from "./b.js";',
    ].join("\n"),
  );
  expect([...parsed.local].sort()).toEqual(
    ["Engine", "Mode", "default", "destructured", "rest", "run", "value"].sort(),
  );
  expect(parsed.named).toEqual(
    new Map([
      ["shown", { specifier: "./b.js", name: "shown" }],
      ["a", { specifier: "./a.js", name: "a" }],
    ]),
  );
  expect([...parsed.namespaces]).toEqual(["all"]);
});

it("resolves names to their declaring modules and keeps every unprovable name", () => {
  const origins = createBarrelExportOrigins();
  const barrel = at("packages/example/src/index.ts");
  const resolved = (name) => {
    const origin = origins.resolve(barrel, name);
    return origin && { file: origin.file, name: origin.name };
  };
  expect(resolved("value")).toEqual({ file: at("packages/example/src/values.ts"), name: "value" });
  expect(resolved("destructured")?.file).toBe(at("packages/example/src/values.ts"));
  expect(resolved("more")?.file).toBe(at("packages/example/src/more.ts"));
  expect(resolved("publicName")).toEqual({
    file: at("packages/example/src/renamed.ts"),
    name: "renamed",
  });
  expect(resolved("defaultValue")).toEqual({
    file: at("packages/example/src/renamed.ts"),
    name: "default",
  });
  expect(resolved("imported")?.file).toBe(at("packages/example/src/imported.ts"));
  expect(resolved("deep")?.file).toBe(at("packages/example/src/nested/deep.ts"));
  // Declared in the barrel itself, ambiguous between two stars, a namespace, or missing.
  for (const name of ["local", "clash", "namespace", "missing", "default", "OnlyType"])
    expect(resolved(name)).toBeNull();
});

it("lists every module whose exports decided a resolution", () => {
  const origins = createBarrelExportOrigins();
  const barrel = at("packages/example/src/index.ts");
  // `deep` passes the barrel's earlier stars, which declare no such name, and the nested barrel.
  expect(origins.resolve(barrel, "deep")?.consulted).toEqual(
    [
      "packages/example/src/index.ts",
      "packages/example/src/values.ts",
      "packages/example/src/more.ts",
      "packages/example/src/left.ts",
      "packages/example/src/right.ts",
      "packages/example/src/nested/index.ts",
      "packages/example/src/nested/deep.ts",
    ]
      .map(at)
      .sort(),
  );
  // A memoized step still reports what decided it.
  expect(origins.resolve(at("packages/example/src/nested/index.ts"), "deep")?.consulted).toEqual([
    at("packages/example/src/nested/deep.ts"),
    at("packages/example/src/nested/index.ts"),
  ]);
  expect(origins.resolve(barrel, "publicName")?.consulted).toEqual([
    at("packages/example/src/index.ts"),
    at("packages/example/src/renamed.ts"),
  ]);
});

it("follows re-exports of other aliased source packages, but never unaliased packages", () => {
  writeFiles(root, {
    "packages/facade/src/index.ts": 'export * from "@lervo/example";\nexport * from "external";\n',
    "packages/direct/src/index.ts": 'export * from "@lervo/example";\n',
  });
  const aliases = new Map([["@lervo/example", at("packages/example/src/index.ts")]]);
  const origins = createBarrelExportOrigins({ aliases });
  const direct = origins.resolve(at("packages/direct/src/index.ts"), "more");
  expect(direct?.file).toBe(at("packages/example/src/more.ts"));
  expect(direct?.consulted).toContain(at("packages/direct/src/index.ts"));
  expect(direct?.consulted).toContain(at("packages/example/src/index.ts"));
  expect(origins.resolve(at("packages/facade/src/index.ts"), "more")).toBeNull();
  const pinnedOrigins = createBarrelExportOrigins({
    aliases,
    pinned: new Set([at("packages/example/src/index.ts")]),
  });
  expect(pinnedOrigins.resolve(at("packages/direct/src/index.ts"), "more")).toBeNull();
});

it("never passes through a pinned module, but may still import from it", () => {
  const nested = at("packages/example/src/nested/index.ts");
  const barrel = at("packages/example/src/index.ts");
  const origins = createBarrelExportOrigins({ pinned: new Set([nested]) });
  expect(origins.resolve(barrel, "deep")).toBeNull();
  expect(origins.resolve(barrel, "more")?.file).toBe(at("packages/example/src/more.ts"));
  expect(
    createBarrelExportOrigins({ pinned: new Set([barrel]) }).resolve(barrel, "more"),
  ).toBeNull();
});
