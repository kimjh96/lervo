import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, expect, it } from "vitest";

import {
  FUNCTION_LINE_LIMIT,
  inspectFunctionLengths,
  measureFunctions,
} from "../check-function-length.mjs";

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const body = (lines) =>
  Array.from({ length: lines }, (_, index) => `  const v${index} = ${index};`).join("\n");

async function fixture(source, functions) {
  const root = await mkdtemp(join(tmpdir(), "lervo-function-length-"));
  roots.push(root);
  await mkdir(join(root, "apps"), { recursive: true });
  await mkdir(join(root, "scripts/quality"), { recursive: true });
  await writeFile(join(root, "apps/flow.ts"), source);
  await writeFile(
    join(root, "scripts/quality/function-length-baseline.json"),
    `${JSON.stringify({ schemaVersion: 1, limit: FUNCTION_LINE_LIMIT, functions })}\n`,
  );
  return root;
}

it("names declarations, methods, and functions bound to a name, and counts their lines", () => {
  const lengths = measureFunctions(
    "apps/flow.ts",
    `export function run() {\n${body(3)}\n}\nclass Store {\n  write() {\n    return 1;\n  }\n}\nconst open = () => {\n  return 2;\n};\nfunction run() {}\n`,
  );
  expect(Object.fromEntries(lengths)).toEqual({
    "apps/flow.ts:run": 5,
    "apps/flow.ts:Store.write": 3,
    "apps/flow.ts:open": 3,
    "apps/flow.ts:run#2": 1,
  });
});

it("fails a new long function, a listed one that grew, and a listed one that shrank", async () => {
  const long = `export function flow() {\n${body(FUNCTION_LINE_LIMIT)}\n}\n`;
  expect((await inspectFunctionLengths({ root: await fixture(long, {}) })).failures).toEqual([
    `apps/flow.ts:flow is ${FUNCTION_LINE_LIMIT + 2} lines, above ${FUNCTION_LINE_LIMIT}; split it.`,
  ]);
  const listed = { "apps/flow.ts:flow": FUNCTION_LINE_LIMIT + 1 };
  expect((await inspectFunctionLengths({ root: await fixture(long, listed) })).failures).toEqual([
    `apps/flow.ts:flow grew from ${FUNCTION_LINE_LIMIT + 1} to ${FUNCTION_LINE_LIMIT + 2} lines; split it instead.`,
  ]);
  const short = `export function flow() {\n${body(10)}\n}\n`;
  expect((await inspectFunctionLengths({ root: await fixture(short, listed) })).failures).toEqual([
    `apps/flow.ts:flow is no longer ${FUNCTION_LINE_LIMIT + 1} lines: lower or remove its baseline entry (--write).`,
  ]);
  const exact = { "apps/flow.ts:flow": FUNCTION_LINE_LIMIT + 2 };
  expect((await inspectFunctionLengths({ root: await fixture(long, exact) })).failures).toEqual([]);
});
