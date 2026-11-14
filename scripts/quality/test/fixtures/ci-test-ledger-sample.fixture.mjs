import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, it, vi } from "vitest";

import { normalizeGeneratedText } from "../../lib/generated-text.mjs";

// Run by ci-test-ledger-reporter.test.mjs in a nested Vitest with the ledger on.
const root = resolve(import.meta.dirname, "../../../..");

it("reads repository inputs, starts a child and reads the clock", () => {
  expect(normalizeGeneratedText("a\r\n")).toBe("a\n");
  expect(readFileSync(resolve(root, "package.json"), "utf8")).toContain('"name"');
  execFileSync(process.execPath, ["-e", "require('node:fs').readFileSync('pnpm-workspace.yaml')"], {
    cwd: root,
  });
  Date.now();
  new Date();
  vi.useFakeTimers();
  for (let index = 0; index < 3; index += 1) {
    Date.now();
    new Date();
  }
  vi.useRealTimers();
});
