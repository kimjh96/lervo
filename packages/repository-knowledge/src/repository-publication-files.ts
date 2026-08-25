import { constants } from "node:fs";
import { lstat, open, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { listKnowledgeArtifactPaths } from "./artifact-paths.js";

export async function generatedKnowledgePaths(root: string): Promise<Set<string>> {
  const result = new Set<string>();
  for (const directory of [".lervo/generated/manifests", ".lervo/generated/semantic-manifests"]) {
    const paths =
      directory === ".lervo/generated/manifests"
        ? [".lervo/generated/manifests/current.json"]
        : await listKnowledgeArtifactPaths({
            root,
            directory,
            extension: "json",
            maximumFiles: 20_000,
          });
    for (const path of paths) {
      try {
        const value = JSON.parse(await readFile(resolve(root, path), "utf8")) as {
          outputs?: Array<{ path?: unknown }>;
        };
        for (const output of value.outputs ?? [])
          if (typeof output.path === "string") result.add(output.path);
      } catch {
        // lint reports malformed manifests separately.
      }
    }
  }
  return result;
}

export function safePublicationPath(root: string, path: string): string | null {
  const target = resolve(root, path);
  const fromRoot = relative(root, target);
  return fromRoot === ".." || fromRoot.startsWith(`..${sep}`) ? null : target;
}

export async function readSafePublication(
  root: string,
  path: string,
  maximumBytes: number,
): Promise<Uint8Array | null> {
  const target = safePublicationPath(root, path);
  if (target === null) return null;
  let current = root;
  try {
    const rootStats = await lstat(root);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) return null;
    const segments = relative(root, target).split(sep);
    for (const [index, segment] of segments.entries()) {
      current = resolve(current, segment);
      const stats = await lstat(current);
      if (stats.isSymbolicLink()) return null;
      if (index === segments.length - 1 ? !stats.isFile() : !stats.isDirectory()) return null;
    }
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const before = await handle.stat();
      if (!before.isFile() || before.size > maximumBytes) return null;
      const bytes = await handle.readFile();
      const after = await handle.stat();
      if (
        before.dev !== after.dev ||
        before.ino !== after.ino ||
        before.size !== after.size ||
        before.mtimeMs !== after.mtimeMs ||
        before.ctimeMs !== after.ctimeMs ||
        bytes.byteLength !== before.size
      )
        return null;
      return bytes;
    } finally {
      await handle.close();
    }
  } catch {
    return null;
  }
}
