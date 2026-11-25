import { chmod, mkdtemp, readFile, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ensureHostTerminalLauncher,
  hostTerminalLauncherPath,
  loadTerminalHookLauncher,
  trustedHostTerminalLauncher,
} from "../src/terminal-runtime.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function store(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lervo-store-")));
  roots.push(root);
  return root;
}

describe("the host launcher beside the runtime store", () => {
  it("is kept an owner-only copy of this CLI's launcher, replacing an older one or a link", async () => {
    const root = await store();
    const path = hostTerminalLauncherPath(root);
    expect(path).toBe(join(root, "launcher.mjs"));
    const launcher = await loadTerminalHookLauncher();
    await ensureHostTerminalLauncher(root);
    expect(await readFile(path, "utf8")).toBe(launcher);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    // A release that changes only the launcher still replaces it.
    await writeFile(path, "// older launcher\n");
    await ensureHostTerminalLauncher(root);
    expect(await readFile(path, "utf8")).toBe(launcher);
    // A link is replaced by a file; its target is left alone.
    const elsewhere = join(root, "elsewhere.mjs");
    await writeFile(elsewhere, "// someone else's file\n");
    await rm(path);
    await symlink(elsewhere, path);
    await ensureHostTerminalLauncher(root);
    expect((await stat(path)).isFile()).toBe(true);
    expect(await readFile(path, "utf8")).toBe(launcher);
    expect(await readFile(elsewhere, "utf8")).toBe("// someone else's file\n");
  });

  it("is trusted only as an exact, unlinked, owner-only copy", async () => {
    const root = await store();
    const path = hostTerminalLauncherPath(root);
    expect(await trustedHostTerminalLauncher(path)).toBe(false);
    await ensureHostTerminalLauncher(root);
    expect(await trustedHostTerminalLauncher(path)).toBe(true);
    await chmod(path, 0o620);
    expect(await trustedHostTerminalLauncher(path)).toBe(false);
    await chmod(path, 0o600);
    await writeFile(path, `${await loadTerminalHookLauncher()}// changed\n`);
    expect(await trustedHostTerminalLauncher(path)).toBe(false);
    const copy = join(root, "copy.mjs");
    await writeFile(copy, await loadTerminalHookLauncher(), { mode: 0o600 });
    await rm(path);
    await symlink(copy, path);
    expect(await trustedHostTerminalLauncher(path)).toBe(false);
  });
});
