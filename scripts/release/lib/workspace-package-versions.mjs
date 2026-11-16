import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

// Mirrors the package globs of pnpm-workspace.yaml.
const workspaceDirectories = Object.freeze(["apps", "packages"]);

/** Maps every workspace package name to its version, as `pnpm pack` resolves `workspace:` ranges. */
export async function readWorkspacePackageVersions(repositoryRoot) {
  const versions = new Map();
  for (const directory of workspaceDirectories) {
    const entries = await readdir(resolve(repositoryRoot, directory), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let manifest;
      try {
        manifest = JSON.parse(
          await readFile(resolve(repositoryRoot, directory, entry.name, "package.json"), "utf8"),
        );
      } catch (error) {
        if (error?.code === "ENOENT") continue;
        throw error;
      }
      if (typeof manifest.name === "string" && typeof manifest.version === "string")
        versions.set(manifest.name, manifest.version);
    }
  }
  return versions;
}
