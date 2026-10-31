import { assertRealRuntimeRoot } from "./node-runtime-root-guard.js";
import { lstat, readdir, readFile, readlink } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

import { nodeRuntimesDirectory } from "./node-runtime-pointer.js";

export interface RetainedRuntimeDirectory {
  name: string;
  modifiedAt: number;
  bytes: number;
  identity: string;
}

/** Reject links, foreign entries and incomplete installations before granting deletion authority. */
async function runtimeTree(path: string): Promise<number | null> {
  let bytes = 0;
  const pending = [path];
  let count = 0;
  while (pending.length) {
    const directory = pending.pop()!;
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (++count > 100_000) return null;
      const child = resolve(directory, item.name);
      const info = await lstat(child);
      if (info.isSymbolicLink()) {
        const target = resolve(dirname(child), await readlink(child));
        if (!target.startsWith(`${path}${sep}`)) return null;
        bytes += info.size;
        continue;
      }
      if (info.isDirectory()) pending.push(child);
      else if (info.isFile()) bytes += info.size;
      else return null;
    }
  }
  return bytes;
}

export async function managedRuntimeInventory(
  homeDirectory?: string,
  platform?: NodeJS.Platform,
): Promise<RetainedRuntimeDirectory[]> {
  const root = nodeRuntimesDirectory(homeDirectory, platform);
  const info = await lstat(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (info === null) return [];
  await assertRealRuntimeRoot(root, platform);
  const entries = await readdir(root, { withFileTypes: true });
  if (entries.length > 4096) throw new Error("Runtime retention inventory exceeds its bound.");
  const inventory: RetainedRuntimeDirectory[] = [];
  for (const entry of entries) {
    if (!/^[a-f0-9]{16}$/u.test(entry.name) || !entry.isDirectory()) continue;
    const path = resolve(root, entry.name);
    const metadata = await lstat(path);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) continue;
    const names = await readdir(path);
    const launcher = `lervo-node-launcher-${entry.name.slice(0, 12)}`;
    if (
      names.some(
        (name) =>
          name !== "node-runtime.js" &&
          name !== launcher &&
          name !== "node_modules" &&
          name !== ".processes" &&
          name !== "repository-runtime.json" &&
          !/^repository-runtime(?:-[a-zA-Z0-9][a-zA-Z0-9_-]{0,79})?\.(?:js|cjs)$/u.test(name),
      )
    )
      continue;
    if (!names.includes("node-runtime.js") || !names.includes(launcher)) continue;
    // A directory named like a runtime is insufficient: require the writer's launcher contract.
    const payload = await lstat(resolve(path, "node-runtime.js"));
    const executable = await lstat(resolve(path, launcher));
    if (!payload.isFile() || !executable.isFile() || executable.size > 8192) continue;
    const content = await readFile(resolve(path, launcher), "utf8");
    const quotedPayload = `'${resolve(path, "node-runtime.js").replaceAll("'", `'"'"'`)}'`;
    if (!content.startsWith("#!/bin/sh\nexec '") || !content.endsWith(` ${quotedPayload} "$@"\n`))
      continue;
    const bytes = await runtimeTree(path);
    if (bytes === null) continue;
    inventory.push({
      name: entry.name,
      modifiedAt: metadata.mtimeMs,
      bytes,
      identity: `${metadata.dev}:${metadata.ino}:${metadata.mtimeMs}:${bytes}`,
    });
  }
  return inventory;
}
