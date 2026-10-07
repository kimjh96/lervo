import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";

/**
 * ADR-0489: an ADR-0488 executable-path migration changes only string leaves, and each new value
 * names a path through a host `current` pointer. This module recognizes exactly that change so the
 * guarded Node service transition can apply it, and so a configuration already migrated in place
 * can be matched to its retained predecessor.
 */
const POINTER_PATH = /\/runtimes\/(?:cli|node)\/current\//u;
const BACKUP_INFIX = ".pre-adr-0488-";
const BACKUP_SUFFIX = /^[a-f0-9]{12}$/u;
const MAXIMUM_CONFIG_BYTES = 1024 * 1024;

const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function sameKeys(left, right) {
  return isDeepStrictEqual(Object.keys(left).sort(), Object.keys(right).sort());
}

function collect(before, after, changes) {
  if (typeof before === "string" && typeof after === "string") {
    if (before === after) return true;
    if (!isAbsolute(after) || !POINTER_PATH.test(after) || after.includes("\0")) return false;
    changes.push({ before, after });
    return true;
  }
  if (Array.isArray(before) || Array.isArray(after)) {
    return (
      Array.isArray(before) &&
      Array.isArray(after) &&
      before.length === after.length &&
      before.every((item, index) => collect(item, after[index], changes))
    );
  }
  if (before !== null && after !== null && typeof before === "object" && typeof after === "object")
    return (
      sameKeys(before, after) &&
      Object.keys(before).every((key) => collect(before[key], after[key], changes))
    );
  return isDeepStrictEqual(before, after);
}

/**
 * The string leaves that differ between two configurations, when every difference moves one
 * value to a path through a host pointer; null for any other difference or for no difference.
 */
export function executablePathRewrites(before, after) {
  const changes = [];
  return collect(before, after, changes) && changes.length > 0 ? changes : null;
}

/** Each rewritten path must resolve to a file this user owns that others cannot write. */
export async function assertOwnedRewrittenPaths(changes) {
  for (const change of changes) {
    const info = await stat(change.after);
    if (!info.isFile() || info.uid !== process.getuid() || (info.mode & 0o022) !== 0)
      throw new Error("A rewritten Node executable path is not an owned regular file.");
  }
}

async function ownedBytes(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      info.size > MAXIMUM_CONFIG_BYTES ||
      (info.mode & 0o077) !== 0 ||
      info.uid !== process.getuid()
    )
      return null;
    return await handle.readFile();
  } finally {
    await handle.close();
  }
}

/**
 * The retained ADR-0488 backups of `configPath` that differ from the current configuration only by
 * executable-path rewrites. A Node that kept running through an in-place migration still holds
 * its admission session under one of these digests.
 */
export async function findMigratedConfigPredecessors(configPath, currentConfig) {
  const prefix = `${basename(configPath)}${BACKUP_INFIX}`;
  let names;
  try {
    names = await readdir(dirname(configPath));
  } catch {
    return [];
  }
  const predecessors = [];
  for (const name of names.filter((entry) => entry.startsWith(prefix)).sort()) {
    if (!BACKUP_SUFFIX.test(name.slice(prefix.length))) continue;
    const path = resolve(dirname(configPath), name);
    const bytes = await ownedBytes(path).catch(() => null);
    if (bytes === null) continue;
    const configDigest = digest(bytes);
    // The backup name binds the first twelve hexadecimal digits of its content digest.
    if (configDigest.slice(7, 19) !== name.slice(prefix.length)) continue;
    let config;
    try {
      config = JSON.parse(bytes.toString("utf8"));
    } catch {
      continue;
    }
    const changes = executablePathRewrites(config, currentConfig);
    if (changes === null) continue;
    try {
      await assertOwnedRewrittenPaths(changes);
    } catch {
      continue;
    }
    predecessors.push({ configDigest, bytes });
  }
  return predecessors;
}
