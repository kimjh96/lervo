import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { resolveProjectPaths } from "@lervo/project";
import { assertNoKnowledgeMaterializationTransaction } from "@lervo/repository-knowledge";

/** A content-bound inventory of `.lervo/state`; `.lervo/data` is never part of it. */
export interface StatePlan {
  schemaVersion: 1;
  planKind: "derived_state_reset";
  planId: string;
  repositoryRoot: string;
  status: "ready" | "current";
  fileCount: number;
  totalBytes: number;
  contentDigest: string;
  durableDataPath: ".lervo/data";
  durableDataDisposition: "preserved";
}

async function fileHash(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

async function inventory(
  root: string,
  current: string,
  result: Array<{ path: string; bytes: number; hash: string | null }>,
  budget: { bytes: number },
  bindContent: boolean,
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink())
      throw new Error("Derived state contains a symbolic link and cannot be reset safely.");
    const path = resolve(current, entry.name);
    if (entry.isDirectory()) await inventory(root, path, result, budget, bindContent);
    else if (entry.isFile()) {
      const stats = await lstat(path);
      budget.bytes += stats.size;
      result.push({
        path: relative(root, path).split(sep).join("/"),
        bytes: stats.size,
        hash: bindContent ? await fileHash(path) : null,
      });
    } else throw new Error("Derived state contains an unsupported filesystem entry.");
    if (result.length > 20_000 || budget.bytes > 2 * 1024 * 1024 * 1024)
      throw new Error("Derived state exceeds the bounded reset inventory.");
  }
}

/**
 * Inventories derived state for `lervo state reset` and `status`. Binding content hashes every
 * file by stream; status counts paths and bytes only.
 */
export async function planStateReset(
  repositoryRoot: string,
  bindContent: boolean,
): Promise<StatePlan> {
  const root = resolve(repositoryRoot);
  if (bindContent) await assertNoKnowledgeMaterializationTransaction({ repositoryRoot: root });
  const state = resolveProjectPaths(root).state;
  const files: Array<{ path: string; bytes: number; hash: string | null }> = [];
  try {
    const stats = await lstat(state);
    if (!stats.isDirectory() || stats.isSymbolicLink())
      throw new Error("Derived state must be a physical directory.");
    await inventory(state, state, files, { bytes: 0 }, bindContent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const contentDigest = `sha256:${createHash("sha256").update(JSON.stringify(files)).digest("hex")}`;
  return {
    schemaVersion: 1,
    planKind: "derived_state_reset",
    planId: `kstatereset_${contentDigest.slice(7, 31)}`,
    repositoryRoot: root,
    status: files.length === 0 ? "current" : "ready",
    fileCount: files.length,
    totalBytes: files.reduce((total, item) => total + item.bytes, 0),
    contentDigest,
    durableDataPath: ".lervo/data",
    durableDataDisposition: "preserved",
  };
}
