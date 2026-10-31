import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { rememberTerminalWorkerEntry, terminalWorkerEntry } from "../src/terminal-worker-entry.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("retains a full CLI entry only in a private host-local file and tolerates missing bindings", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-worker-entry-"));
  roots.push(root);
  expect(await terminalWorkerEntry(root)).toBeNull();
  await rememberTerminalWorkerEntry(root, undefined);
  await rememberTerminalWorkerEntry(root, "relative-cli.js");
  expect(await terminalWorkerEntry(root)).toBeNull();
  const entry = resolve(root, "installed/bin.js");
  await rememberTerminalWorkerEntry(root, entry);
  const path = resolve(root, ".lervo/state/terminal-integration/worker-entry.json");
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect(await terminalWorkerEntry(root)).toBe(entry);
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ entry });
});
