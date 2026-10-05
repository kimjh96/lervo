import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { ProjectStorage } from "@lervo/project-storage";

/** The storage surface every freshness write path needs. */
export type FreshnessStorage = Pick<ProjectStorage, "events" | "artifacts" | "manifest" | "paths">;

/** A failed owner or agent operation; the document is left exactly as found. */
export class DocumentFreshnessOperationError extends Error {
  constructor(
    readonly code:
      | "candidate_not_found"
      | "candidate_not_reviewable"
      | "approval_mismatch"
      | "source_changed"
      | "freshness_hold_active"
      | "revert_conflict"
      | "write_failed"
      | "owner_lock_busy",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DocumentFreshnessOperationError";
  }
}

/** Bytes of a regular file in the working tree, or null when absent or not a plain file. */
export async function currentDocumentBytes(root: string, path: string): Promise<Buffer | null> {
  try {
    const stat = await lstat(resolve(root, path));
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
    return await readFile(resolve(root, path));
  } catch {
    return null;
  }
}

/** Atomic same-directory replacement that keeps the file's mode. */
export async function writeDocumentBytes(
  root: string,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  const target = resolve(root, path);
  await mkdir(dirname(target), { recursive: true });
  const mode = await lstat(target).then(
    (stat) => stat.mode & 0o777,
    () => 0o644,
  );
  const temporary = resolve(dirname(target), `.lervo-freshness-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes, { flag: "wx", mode });
    await chmod(temporary, mode);
    await rename(temporary, target);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
