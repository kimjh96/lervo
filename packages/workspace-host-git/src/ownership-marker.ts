import { constants } from "node:fs";
import { lstat, open, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { replaceFile } from "@lervo/filesystem-durability";
import type { WorkspaceOwnershipMarker } from "@lervo/workspace-host";

import { fail } from "./git-command.js";
import { stableJson } from "./stable-json.js";

/** The marker's file in the checkout's own Git directory, which no commit or status shows. */
export const MARKER_NAME = "lervo-workspace-owner.json";
const MAXIMUM_MARKER_BYTES = 16_384;

function markerBytes(marker: WorkspaceOwnershipMarker): string {
  return `${JSON.stringify(marker, null, 2)}\n`;
}

/** Whether the checkout's marker is exactly `expected`; an unreadable marker matches nothing. */
export async function markerMatches(
  gitDirectory: string,
  expected: WorkspaceOwnershipMarker,
): Promise<boolean> {
  try {
    const path = resolve(gitDirectory, MARKER_NAME);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAXIMUM_MARKER_BYTES) return false;
    return stableJson(JSON.parse(await readFile(path, "utf8"))) === stableJson(expected);
  } catch {
    return false;
  }
}

/** Creates the first generation's marker; a marker already there fails the write. */
export async function createMarker(
  gitDirectory: string,
  marker: WorkspaceOwnershipMarker,
): Promise<void> {
  const handle = await open(
    resolve(gitDirectory, MARKER_NAME),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    await handle.writeFile(markerBytes(marker));
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/** Whether the process that wrote a lock still runs; a malformed lock counts as live. */
function lockHolderLive(content: string): boolean {
  const pid = Number(content.trim());
  if (!Number.isSafeInteger(pid) || pid <= 0) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/**
 * Takes the marker's replacement lock: a file created exclusively that names this process. A lock
 * whose process no longer exists is removed once, as the coordination home's initialization lock
 * is; a live or unreadable holder refuses with `host_operation_in_progress`.
 */
async function acquireReplacementLock(path: string): Promise<() => Promise<void>> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(
        path,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
        0o600,
      );
      try {
        await handle.writeFile(`${process.pid}\n`);
      } finally {
        await handle.close();
      }
      return () => rm(path, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const content = await readFile(path, "utf8").catch(() => "");
      if (attempt > 0 || lockHolderLive(content)) break;
      await rm(path, { force: true });
    }
  }
  fail("host_operation_in_progress", "Another process is replacing the workspace marker.");
}

function nextGenerationOf(
  expected: WorkspaceOwnershipMarker,
  next: WorkspaceOwnershipMarker,
): boolean {
  return (
    next.generation === expected.generation + 1 &&
    next.repositoryInstanceId === expected.repositoryInstanceId &&
    next.adapterKind === expected.adapterKind &&
    next.adapterVersion === expected.adapterVersion &&
    next.pathDigest === expected.pathDigest
  );
}

/**
 * Replaces the checkout's marker with `next` only while it is exactly `expected`, and only when
 * `next` is the following generation of the same checkout. The comparison and the replacement
 * hold one lock, and the replacement is durable and atomic: a reader sees the old marker or the
 * new one. A marker that changed refuses with `host_marker_mismatch` and stays as it is.
 */
export async function replaceMarker(
  gitDirectory: string,
  expected: WorkspaceOwnershipMarker,
  next: WorkspaceOwnershipMarker,
): Promise<void> {
  if (!nextGenerationOf(expected, next))
    fail("host_coordinate_invalid", "The next marker is not the checkout's following generation.");
  const path = resolve(gitDirectory, MARKER_NAME);
  const release = await acquireReplacementLock(`${path}.lock`);
  try {
    if (!(await markerMatches(gitDirectory, expected)))
      fail("host_marker_mismatch", "The workspace marker changed before its replacement.");
    await replaceFile(path, markerBytes(next), { mode: 0o600 });
  } finally {
    await release();
  }
}
