import { execFile } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { digestRepositoryWorkPath } from "./repository-work-observation.js";
import { readRepositoryWorkGitTreeEntry } from "./repository-work-git-objects.js";
import type {
  RepositoryWorkSourceManifest,
  SourceCoordinate,
} from "./repository-work-source-manifest.js";
import { parseRepositoryWorkSourceManifest } from "./repository-work-source-manifest.js";

const execute = promisify(execFile);

export type RepositoryWorkSourceCurrency =
  | { status: "ready_for_review"; changedPathCount: number }
  | {
      status: "stale" | "needs_review";
      changedPathCount: number;
      reasonCode:
        | "source_bytes_changed"
        | "before_bytes_unavailable"
        | "source_evidence_unavailable"
        | "unsafe_path_resolution";
    };

async function git(repositoryRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execute("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    maxBuffer: 1_048_576,
  });
  return stdout;
}

async function safeParentDirectories(repositoryRoot: string, path: string): Promise<boolean> {
  const root = await realpath(repositoryRoot);
  const segments = path.split("/");
  let parent = root;
  for (const segment of segments.slice(0, -1)) {
    parent = resolve(parent, segment);
    try {
      const entry = await lstat(parent);
      if (!entry.isDirectory() || entry.isSymbolicLink()) return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw error;
    }
  }
  return true;
}

async function afterCoordinateIsCurrent(input: {
  repositoryRoot: string;
  path: string;
  coordinate: SourceCoordinate;
}): Promise<boolean> {
  if (input.coordinate.kind === "missing")
    return (await digestRepositoryWorkPath(input.repositoryRoot, input.path)) === "missing";
  if (input.coordinate.kind === "working_tree")
    return (
      (await digestRepositoryWorkPath(input.repositoryRoot, input.path)) === input.coordinate.digest
    );
  const dirty = await git(input.repositoryRoot, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    input.path,
  ]);
  if (dirty !== "") return false;
  return (
    JSON.stringify(
      await readRepositoryWorkGitTreeEntry(
        input.repositoryRoot,
        input.coordinate.commit,
        input.path,
      ),
    ) ===
    JSON.stringify(await readRepositoryWorkGitTreeEntry(input.repositoryRoot, "HEAD", input.path))
  );
}

/** Checks exact source currency only; it does not attest semantic review or knowledge success. */
export async function inspectRepositoryWorkSourceCurrency(input: {
  repositoryRoot: string;
  manifest: RepositoryWorkSourceManifest;
}): Promise<RepositoryWorkSourceCurrency> {
  let manifest: RepositoryWorkSourceManifest;
  try {
    manifest = parseRepositoryWorkSourceManifest(
      Buffer.from(JSON.stringify(input.manifest), "utf8"),
    );
  } catch {
    return {
      status: "needs_review",
      changedPathCount: 0,
      reasonCode: "source_evidence_unavailable",
    };
  }
  const changedPathCount = manifest.paths.length;
  let beforeBytesUnavailable = false;
  try {
    for (const item of manifest.paths) {
      if (!(await safeParentDirectories(input.repositoryRoot, item.path))) {
        return { status: "needs_review", changedPathCount, reasonCode: "unsafe_path_resolution" };
      }
      if (
        !(await afterCoordinateIsCurrent({
          repositoryRoot: input.repositoryRoot,
          path: item.path,
          coordinate: item.after,
        }))
      ) {
        return { status: "stale", changedPathCount, reasonCode: "source_bytes_changed" };
      }
      if (item.before.kind === "git_tree") {
        await readRepositoryWorkGitTreeEntry(input.repositoryRoot, item.before.commit, item.path);
      } else if (item.before.kind === "working_tree") {
        beforeBytesUnavailable = true;
      }
    }
  } catch {
    return { status: "needs_review", changedPathCount, reasonCode: "source_evidence_unavailable" };
  }
  return beforeBytesUnavailable
    ? { status: "needs_review", changedPathCount, reasonCode: "before_bytes_unavailable" }
    : { status: "ready_for_review", changedPathCount };
}
