import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { resolve } from "node:path";

import { IdentityMigrationError } from "./types.js";

const PREFIX_PATTERN = /^[a-f0-9]{2}$/;
const SUFFIX_PATTERN = /^[a-f0-9]{62}$/;

async function entryKind(path: string): Promise<"missing" | "directory" | "file" | "unsafe"> {
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) return "unsafe";
    if (stats.isDirectory()) return "directory";
    if (stats.isFile()) return "file";
    return "unsafe";
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path, { flags: "r" })) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export async function inspectLegacyCas(root: string): Promise<number> {
  const kind = await entryKind(root);
  if (kind === "missing") return 0;
  if (kind !== "directory") {
    throw new IdentityMigrationError(
      "migration_blocked",
      "The previous CAS path is not a real directory.",
    );
  }
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    if (
      !["sha256", ".tmp"].includes(entry.name) ||
      !entry.isDirectory() ||
      entry.isSymbolicLink()
    ) {
      throw new IdentityMigrationError(
        "migration_blocked",
        "The previous CAS contains an entry outside the contract.",
      );
    }
  }
  const temporaryRoot = resolve(root, ".tmp");
  if (
    (await entryKind(temporaryRoot)) === "directory" &&
    (await readdir(temporaryRoot)).length > 0
  ) {
    throw new IdentityMigrationError(
      "migration_blocked",
      "Temporary files remain in the previous CAS. Stop active work and check the state.",
    );
  }
  const objectsRoot = resolve(root, "sha256");
  if ((await entryKind(objectsRoot)) === "missing") return 0;
  if ((await entryKind(objectsRoot)) !== "directory") {
    throw new IdentityMigrationError(
      "migration_blocked",
      "The previous CAS object path is unsafe.",
    );
  }
  let count = 0;
  const prefixes = await readdir(objectsRoot, { withFileTypes: true });
  for (const prefix of prefixes) {
    if (!PREFIX_PATTERN.test(prefix.name) || !prefix.isDirectory() || prefix.isSymbolicLink()) {
      throw new IdentityMigrationError(
        "migration_blocked",
        "A previous CAS object prefix does not satisfy the contract.",
      );
    }
    const prefixRoot = resolve(objectsRoot, prefix.name);
    const objects = await readdir(prefixRoot, { withFileTypes: true });
    for (const object of objects) {
      if (!SUFFIX_PATTERN.test(object.name) || !object.isFile() || object.isSymbolicLink()) {
        throw new IdentityMigrationError(
          "migration_blocked",
          "A previous CAS object path does not satisfy the contract.",
        );
      }
      const expected = `${prefix.name}${object.name}`;
      if ((await hashFile(resolve(prefixRoot, object.name))) !== expected) {
        throw new IdentityMigrationError(
          "migration_blocked",
          "A previous CAS object's content hash does not match.",
        );
      }
      count += 1;
      if (count > 100_000) {
        throw new IdentityMigrationError(
          "migration_blocked",
          "The previous CAS object count exceeds the inspection limit.",
        );
      }
    }
  }
  return count;
}
