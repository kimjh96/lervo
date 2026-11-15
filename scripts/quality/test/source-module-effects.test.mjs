import ts from "typescript";
import { expect, it } from "vitest";

import { topLevelEffects } from "../lib/source-module-effects.mjs";

const effectsOf = (lines, options) =>
  topLevelEffects(
    ts.createSourceFile("module.ts", lines.join("\n"), ts.ScriptTarget.Latest, true),
    options,
  ).map(({ text }) => text);

it("passes declarations built only from inert values", () => {
  expect(
    effectsOf([
      'import { base, schema } from "./base.js";',
      'import { promisify } from "node:util";',
      'import { execFile } from "node:child_process";',
      'export const name = "x";',
      "export const limit = -1 * 60 * 1000;",
      "export const shape = { ...base, nested: [base.items, `${name}/**`], [name]: schema.id } as const;",
      "export const pick = base.required ?? [];",
      "export const handler = (value: string) => register(value);",
      "export const names = new Set<string>([name]);",
      "export const frozen = Object.freeze({ name });",
      "export const keys = Object.keys(shape);",
      "export const run = promisify(execFile);",
      'export const zero = "0".repeat(40);',
      "export const prefixed = base.items.map((item) => `${item}/**`);",
      'export const hash = createHash("sha256").update(name).digest("hex");',
      "export function register(value: string) { base.items.push(value); }",
      "export class Engine { static mode = name; field = register(name); }",
      "export enum Mode { A = 1, B = A << 1 }",
      "export interface Shape {}",
      "export type Alias = string;",
      "declare global { var marker: string }",
      "declare const ambient: number;",
      "export default shape;",
    ]),
  ).toEqual(['createHash("sha256")']);
});

it("reports every form that can act outside the module's own values", () => {
  expect(
    effectsOf([
      'import { registry } from "./registry.js";',
      "export const registered = registry.push(1);",
      "export const counter = registry.length++;",
      "export const loaded = await registry.load();",
      "export const tagged = sql`select`;",
      "export const shared = Object.freeze(registry);",
      "export const sorted = registry.sort();",
      "export const element = registry.find((entry) => entry.ready).push(0);",
      "export const mapped = registry.map((entry) => entry.register());",
      "export const block = registry.map((entry) => { entry.seen = true; return entry; });",
      "export class Static { static { registry.push(2); } }",
      "export class Field { static instance = new Field(); }",
      "export class Derived extends mixin(registry) {}",
      "@decorate export class Decorated {}",
      "export enum Computed { A = registry.count() }",
      "export namespace Space { registry.push(3); }",
      "(() => registry.push(4))();",
      "registry.push(5);",
    ]),
  ).toEqual([
    "registry.push(1)",
    "registry.length++",
    "await registry.load()",
    "sql`select`",
    "Object.freeze(registry)",
    "registry.sort()",
    "registry.find((entry) => entry.ready).push(0)",
    "entry.register()",
    "(entry) => { entry.seen = true; return entry; }",
    "static { registry.push(2); }",
    "new Field()",
    "mixin(registry)",
    "@decorate",
    "registry.count()",
    "registry.push(3);",
    "(() => registry.push(4))();",
    "registry.push(5);",
  ]);
});

it("passes export default only as a literal, an identifier, or a function or class", () => {
  expect(effectsOf(['export default "x";'])).toEqual([]);
  expect(effectsOf(["export default () => register();"])).toEqual([]);
  expect(effectsOf(["export default register();"])).toEqual(["register()"]);
  expect(effectsOf(["export default { value: 1 };"])).toEqual(["{ value: 1 }"]);
});

it("passes a repository callee only when the caller reviewed it", () => {
  const lines = [
    'import { digest } from "./integrity.js";',
    "function local() { return 1; }",
    'export const id = digest("x");',
    "export const value = local();",
    "export const set = new Set();",
  ];
  expect(effectsOf(lines)).toEqual(['digest("x")', "local()"]);
  const asked = [];
  const reviewed = (binding) => {
    asked.push(binding);
    return true;
  };
  expect(effectsOf(lines, { reviewedCallee: reviewed })).toEqual([]);
  expect(asked).toEqual([{ specifier: "./integrity.js", name: "digest" }, { local: "local" }]);
  // A local declaration shadows the global of the same name.
  expect(effectsOf(["class Set {}", "export const set = new Set();"])).toEqual(["new Set()"]);
});
