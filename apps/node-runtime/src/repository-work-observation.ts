import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readlink } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { MAXIMUM_CONVERSATION_REPOSITORY_WORK_CHANGED_PATHS } from "@lervo/schemas";

const execute = promisify(execFile);
const MAXIMUM_CHANGED_PATHS = 1_024;

export class RepositoryWorkObservationLimitError extends Error {
  readonly code = "repository_changed_path_limit_exceeded";

  constructor(message: string) {
    super(message);
    this.name = "RepositoryWorkObservationLimitError";
  }
}

export interface RepositoryWorkObservation {
  head: string;
  paths: Map<string, string>;
  revision: string;
}

export interface RepositoryWorkChange {
  repositoryRevisionBefore: string;
  repositoryRevisionAfter: string;
  changedPaths: string[];
}

async function git(repositoryRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execute("git", ["-C", repositoryRoot, ...args], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

function statusPaths(output: string): string[] {
  const fields = output.split("\0").filter((value) => value.length > 0);
  const paths: string[] = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    if (field.length < 4) continue;
    const status = field.slice(0, 2);
    paths.push(field.slice(3));
    if (status.includes("R") || status.includes("C")) {
      const renamed = fields[index + 1];
      if (renamed !== undefined) {
        paths.push(renamed);
        index += 1;
      }
    }
  }
  const uniquePaths = [...new Set(paths)].sort();
  if (uniquePaths.length > MAXIMUM_CHANGED_PATHS) {
    throw new RepositoryWorkObservationLimitError(
      `The Git observation exceeds ${MAXIMUM_CHANGED_PATHS} changed paths.`,
    );
  }
  return uniquePaths;
}

export async function digestRepositoryWorkPath(
  repositoryRoot: string,
  path: string,
): Promise<string> {
  const absolute = resolve(repositoryRoot, path);
  try {
    const metadata = await lstat(absolute);
    if (metadata.isSymbolicLink()) {
      return `link:${createHash("sha256")
        .update(await readlink(absolute))
        .digest("hex")}`;
    }
    if (!metadata.isFile()) return `kind:${metadata.mode}`;
    return await new Promise<string>((resolveDigest, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(absolute);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.once("error", reject);
      stream.once("end", () => resolveDigest(`file:${metadata.mode}:${hash.digest("hex")}`));
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

export async function observeRepositoryWork(
  repositoryRoot: string,
): Promise<RepositoryWorkObservation> {
  const [head, status] = await Promise.all([
    git(repositoryRoot, ["rev-parse", "HEAD"]),
    git(repositoryRoot, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]),
  ]);
  const paths = new Map<string, string>();
  for (const path of statusPaths(status))
    paths.set(path, await digestRepositoryWorkPath(repositoryRoot, path));
  const resolvedHead = head.trim();
  const revision = `sha256:${createHash("sha256")
    .update(JSON.stringify([resolvedHead, [...paths.entries()]]))
    .digest("hex")}`;
  return { head: resolvedHead, paths, revision };
}

export async function compareRepositoryWork(input: {
  repositoryRoot: string;
  before: RepositoryWorkObservation;
  after: RepositoryWorkObservation;
}): Promise<RepositoryWorkChange> {
  const candidates = new Set([...input.before.paths.keys(), ...input.after.paths.keys()]);
  if (input.before.head !== input.after.head) {
    const committed = await git(input.repositoryRoot, [
      "diff",
      "--name-only",
      "-z",
      input.before.head,
      input.after.head,
    ]);
    for (const path of committed.split("\0")) if (path.length > 0) candidates.add(path);
  }
  const changed: string[] = [];
  if (candidates.size > MAXIMUM_CHANGED_PATHS) {
    throw new RepositoryWorkObservationLimitError(
      `The repository comparison exceeds ${MAXIMUM_CHANGED_PATHS} candidate paths.`,
    );
  }
  for (const path of [...candidates].sort()) {
    const before = input.before.paths.get(path) ?? `head:${input.before.head}`;
    const after = input.after.paths.get(path) ?? `head:${input.after.head}`;
    if (before !== after) changed.push(path);
  }
  if (changed.length > MAXIMUM_CONVERSATION_REPOSITORY_WORK_CHANGED_PATHS) {
    throw new RepositoryWorkObservationLimitError(
      `The conversation completion exceeds ${MAXIMUM_CONVERSATION_REPOSITORY_WORK_CHANGED_PATHS} changed paths.`,
    );
  }
  return {
    repositoryRevisionBefore: input.before.revision,
    repositoryRevisionAfter: input.after.revision,
    changedPaths: changed,
  };
}
