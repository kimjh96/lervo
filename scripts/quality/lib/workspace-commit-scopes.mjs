import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "yaml";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

function packageScope(name) {
  if (typeof name !== "string" || !name.startsWith("@lervo/") || name.length === "@lervo/".length) {
    throw new Error("Every workspace package must have an @lervo/<scope> name.");
  }
  return name.slice("@lervo/".length);
}

function packageDirectories(root) {
  const workspacePath = resolve(root, "pnpm-workspace.yaml");
  const workspace = parse(readFileSync(workspacePath, "utf8"));
  if (!Array.isArray(workspace?.packages) || workspace.packages.length === 0) {
    throw new Error("pnpm-workspace.yaml has no package patterns.");
  }
  return workspace.packages.flatMap((pattern) => {
    const match = /^([^/*]+)\/\*$/u.exec(pattern);
    if (match === null)
      throw new Error(`Unsupported workspace package pattern: ${String(pattern)}`);
    const parent = resolve(root, match[1]);
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => resolve(parent, entry.name));
  });
}

export function workspaceCommitScopes(root = repositoryRoot) {
  const scopes = packageDirectories(resolve(root))
    .map((directory) => {
      const manifestPath = resolve(directory, "package.json");
      const metadata = lstatSync(manifestPath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error(`Unsafe workspace package manifest: ${manifestPath}`);
      }
      return packageScope(JSON.parse(readFileSync(manifestPath, "utf8")).name);
    })
    .sort();
  if (new Set(scopes).size !== scopes.length)
    throw new Error("Workspace package names produce duplicate commit scopes.");
  return scopes;
}
