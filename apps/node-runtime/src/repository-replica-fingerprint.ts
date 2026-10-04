import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

import { git } from "./repository-replica-git-command.js";
import { HOST_LOCAL_REPLICA_PATHS } from "./repository-replica-git.js";

/** Bumped whenever capture semantics change, so older fingerprints can never match. */
const FINGERPRINT_VERSION = "lervo-repository-replica-snapshot-fingerprint-v1";
const MAXIMUM_FINGERPRINT_PATHS = 20_000;
/**
 * A file whose timestamps are this close to the observation may still be written within the same
 * timestamp tick, so a fingerprint that includes it must not be stored.
 */
const RACY_WINDOW_MS = 2_000;

export interface ObservedFingerprint {
  fingerprint: string;
  /** False when the fingerprint cannot prove that every captured byte is covered. */
  cacheable: boolean;
  head: string | null;
  branch: string | null;
  gitDirectory: string;
}

interface StatusEntries {
  head: string | null;
  branch: string | null;
  paths: string[];
  submodule: boolean;
}

/** Field counts before the path in `git status --porcelain=v2` records. */
const PATH_FIELD_INDEX: Record<string, number> = { "1": 8, "2": 9, u: 10, "?": 1, "!": 1 };

function parseStatus(output: string): StatusEntries {
  const records = output.split("\0");
  const entries: StatusEntries = { head: null, branch: null, paths: [], submodule: false };
  for (let index = 0; index < records.length; index++) {
    const record = records[index]!;
    if (record === "") continue;
    if (record.startsWith("# ")) {
      const [, key, value] = record.split(" ", 3);
      if (key === "branch.oid" && value !== undefined && /^[0-9a-f]{40,64}$/u.test(value))
        entries.head = value;
      if (key === "branch.head" && value !== undefined && value !== "(detached)")
        entries.branch = value;
      continue;
    }
    const type = record[0]!;
    const pathIndex = PATH_FIELD_INDEX[type];
    if (pathIndex === undefined) throw new Error("Unsupported repository status record.");
    const fields = record.split(" ");
    if (fields.length <= pathIndex) throw new Error("Invalid repository status record.");
    if (type !== "?" && type !== "!" && fields[2]?.startsWith("S")) entries.submodule = true;
    entries.paths.push(fields.slice(pathIndex).join(" "));
    // A rename or copy record is followed by its original path.
    if (type === "2") {
      index += 1;
      const original = records[index];
      if (original === undefined || original === "") throw new Error("Invalid rename record.");
      entries.paths.push(original);
    }
  }
  return entries;
}

async function statCoordinate(path: string, racyAfterMs: number) {
  try {
    const stat = await lstat(path, { bigint: true });
    const racy =
      Number(stat.mtimeNs / 1_000_000n) >= racyAfterMs ||
      Number(stat.ctimeNs / 1_000_000n) >= racyAfterMs;
    return {
      racy,
      value: [
        stat.mode.toString(),
        stat.ino.toString(),
        stat.size.toString(),
        stat.mtimeNs.toString(),
        stat.ctimeNs.toString(),
      ],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { racy: false, value: null };
    throw error;
  }
}

/**
 * Observes every coordinate that can change a captured snapshot: HEAD and branch, the index file,
 * repository configuration and attributes, the porcelain status, and the metadata of each path it
 * lists. Git's own stat checks keep clean tracked files out of the status; dirty and untracked
 * paths are covered by their metadata because the status line alone does not change on a second
 * edit. Reading status never writes the user's index.
 */
export async function observeRepositoryReplicaFingerprint(
  repositoryRoot: string,
  nowMilliseconds: () => number = Date.now,
): Promise<ObservedFingerprint> {
  const racyAfterMs = nowMilliseconds() - RACY_WINDOW_MS;
  const [topLevel, gitDirectory, commonDirectory, indexPath] = (
    await git(repositoryRoot, [
      "rev-parse",
      "--show-toplevel",
      "--absolute-git-dir",
      "--path-format=absolute",
      "--git-common-dir",
      "--git-path",
      "index",
    ])
  ).stdout
    .toString("utf8")
    .split("\n");
  if (!topLevel || !gitDirectory || !commonDirectory || !indexPath)
    throw new Error("The repository coordinates could not be resolved.");
  const status = (
    await git(
      repositoryRoot,
      ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"],
      { environment: { GIT_OPTIONAL_LOCKS: "0" } },
    )
  ).stdout.toString("utf8");
  const entries = parseStatus(status);
  let cacheable =
    !entries.submodule &&
    entries.head !== null &&
    entries.paths.length <= MAXIMUM_FINGERPRINT_PATHS;
  const paths = entries.paths.map((path) => {
    const absolute = resolve(topLevel, path);
    const child = relative(topLevel, absolute);
    if (child.startsWith("..") || isAbsolute(child))
      throw new Error("Unsafe repository status path.");
    return absolute;
  });
  const coordinates = [
    indexPath,
    join(commonDirectory, "config"),
    join(commonDirectory, "info", "attributes"),
    ...(cacheable ? paths : []),
  ];
  const metadata: unknown[] = [];
  for (let offset = 0; offset < coordinates.length; offset += 64) {
    const batch = coordinates.slice(offset, offset + 64);
    const observed = await Promise.all(batch.map((path) => statCoordinate(path, racyAfterMs)));
    observed.forEach((item, index) => {
      if (item.racy) cacheable = false;
      metadata.push([batch[index], item.value]);
    });
  }
  const fingerprint = `sha256:${createHash("sha256")
    .update(
      JSON.stringify([
        FINGERPRINT_VERSION,
        HOST_LOCAL_REPLICA_PATHS,
        repositoryRoot,
        createHash("sha256").update(status).digest("hex"),
        metadata,
      ]),
    )
    .digest("hex")}`;
  return { fingerprint, cacheable, head: entries.head, branch: entries.branch, gitDirectory };
}
