import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
export const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
export async function artifactBuildHash(repository) {
  const entries = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (
        entry.name.endsWith(".js") ||
        entry.name.endsWith(".node") ||
        entry.name === "file-sync.json" ||
        entry.name === "cas-io.json"
      )
        entries.push([child.slice(repository.length + 1), digest(await readFile(child))]);
    }
  }
  for (const parent of ["packages", "apps"])
    for (const entry of await readdir(resolve(repository, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      try {
        await visit(resolve(repository, parent, entry.name, "dist"));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  return digest(JSON.stringify(entries.sort((a, b) => a[0].localeCompare(b[0]))));
}
