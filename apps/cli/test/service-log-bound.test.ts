import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";

import { boundServiceLog } from "../src/service-log-bound.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("keeps one previous generation and truncates an oversized service log in place", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-service-log-"));
  roots.push(root);
  const path = resolve(root, "knowledge-host.log");
  expect(await boundServiceLog(path, 16)).toBe(false);
  await writeFile(path, "small\n");
  expect(await boundServiceLog(path, 16)).toBe(false);
  await writeFile(path, "a".repeat(24) + "x".repeat(16));
  expect(await boundServiceLog(path, 16)).toBe(true);
  expect((await stat(path)).size).toBe(0);
  // The previous generation keeps only the newest bytes, within the same bound.
  expect(await readFile(`${path}.1`, "utf8")).toBe("x".repeat(16));
});
