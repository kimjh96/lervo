import { lstat, open, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { runtimeModuleManifest } from "./runtime-module-contract.js";
import {
  readRuntimeModuleArtifact,
  readRuntimeModuleFile,
  validateRuntimeModuleArtifact,
  type RuntimeModuleArtifact,
} from "./runtime-module-artifact.js";

/** Publish only admitted bytes; interrupted missing members can be repaired, conflicts survive. */
export async function publishRuntimeModuleArtifact(
  directory: string,
  expected: RuntimeModuleArtifact,
): Promise<void> {
  validateRuntimeModuleArtifact(expected);
  const snapshot: RuntimeModuleArtifact = {
    hash: expected.hash,
    files: new Map([...expected.files].map(([name, bytes]) => [name, Buffer.from(bytes)])),
  };
  validateRuntimeModuleArtifact(snapshot);
  const before = await lstat(directory, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink())
    throw new Error("runtime_module_directory_invalid");
  const missing = await inspectMembers(directory, snapshot);
  // Install the manifest last; a partial artifact cannot pass complete inventory verification.
  missing.sort(
    (a, b) =>
      Number(a === runtimeModuleManifest) - Number(b === runtimeModuleManifest) ||
      a.localeCompare(b),
  );
  for (const name of missing) {
    try {
      const file = await open(resolve(directory, name), "wx", 0o600);
      try {
        await file.writeFile(snapshot.files.get(name)!);
      } finally {
        await file.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  const after = await lstat(directory, { bigint: true });
  if (
    !after.isDirectory() ||
    after.isSymbolicLink() ||
    after.dev !== before.dev ||
    after.ino !== before.ino ||
    (await readRuntimeModuleArtifact(directory)).hash !== snapshot.hash
  )
    throw new Error("runtime_module_publication_conflict");
}

async function inspectMembers(
  directory: string,
  snapshot: RuntimeModuleArtifact,
): Promise<string[]> {
  for (const name of await readdir(directory)) {
    if (
      (name === runtimeModuleManifest ||
        name === "repository-runtime.js" ||
        name.startsWith("repository-runtime-")) &&
      !snapshot.files.has(name)
    )
      throw new Error("runtime_module_inventory_invalid");
  }
  const missing: string[] = [];
  for (const [name, bytes] of snapshot.files) {
    try {
      if (!(await readRuntimeModuleFile(resolve(directory, name), bytes.length)).equals(bytes))
        throw new Error("runtime_module_content_mismatch");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.push(name);
    }
  }
  return missing;
}

export async function inspectRuntimeModuleArtifact(
  directory: string,
  expected: RuntimeModuleArtifact,
): Promise<"current" | "missing" | "conflict"> {
  try {
    validateRuntimeModuleArtifact(expected);
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) return "conflict";
    return (await inspectMembers(directory, expected)).length ? "missing" : "current";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "conflict";
  }
}
