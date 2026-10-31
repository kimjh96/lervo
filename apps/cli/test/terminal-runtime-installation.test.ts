import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { isInstalledTerminalRuntimeCli } from "../src/terminal-runtime-installation.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each(["node_modules/@lervo/cli", "global/pnpm/@lervo/cli", "deploy", "settled-1234"])(
  "recognizes %s without requiring a node_modules path",
  async (layout) => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-installation-"));
    roots.push(root);
    const entry = resolve(root, layout, "dist/bin.js");
    await mkdir(dirname(entry), { recursive: true });
    await writeFile(entry, "");
    expect(await isInstalledTerminalRuntimeCli(entry)).toBe(true);
    await mkdir(resolve(dirname(entry), "../src"));
    await writeFile(resolve(dirname(entry), "../src/bin.ts"), "");
    expect(await isInstalledTerminalRuntimeCli(entry)).toBe(false);
  },
);
