import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ensureHostTerminalLauncher,
  hostTerminalLauncherPath,
  loadTerminalHookLauncher,
} from "../src/terminal-runtime.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("the host launcher beside the runtime store", () => {
  it("is written once as an owner-only copy of the launcher, and again after a runtime change", async () => {
    const store = await realpath(await mkdtemp(join(tmpdir(), "lervo-store-")));
    roots.push(store);
    const path = hostTerminalLauncherPath(store);
    expect(path).toBe(join(store, "launcher.mjs"));
    await ensureHostTerminalLauncher(store, false);
    const launcher = await loadTerminalHookLauncher();
    expect(await readFile(path, "utf8")).toBe(launcher);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    await writeFile(path, "// older launcher\n");
    await ensureHostTerminalLauncher(store, false);
    expect(await readFile(path, "utf8")).toBe("// older launcher\n");
    await ensureHostTerminalLauncher(store, true);
    expect(await readFile(path, "utf8")).toBe(launcher);
  });
});
