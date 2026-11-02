import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { RelationChange, RelationWorkspacePackage } from "@lervo/repository-knowledge";

const execute = promisify(execFile);
const manifestPattern = /^(?:apps|packages)\/[^/]+\/package\.json$/u;

async function git(root: string, args: string[]): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, "-c", "core.quotePath=false", ...args], {
    timeout: 30_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout;
}

async function deletedPackage(
  root: string,
  revision: string,
  path: string,
): Promise<RelationWorkspacePackage | null> {
  try {
    const name = (
      JSON.parse(await git(root, ["show", `${revision}:${path}`])) as { name?: unknown }
    ).name;
    return typeof name === "string"
      ? { name, directory: path.slice(0, -"/package.json".length) }
      : null;
  } catch {
    // An unreadable deleted manifest names no package; its directory is still a removed path.
    return null;
  }
}

/** Markdown bytes at `revision` for paths that existed there, through one batch process. */
async function previousMarkdown(
  root: string,
  revision: string,
  paths: readonly string[],
): Promise<Map<string, string>> {
  const markdown = paths.filter((path) => /\.mdx?$/iu.test(path));
  const contents = new Map<string, string>();
  if (markdown.length === 0) return contents;
  const output = await new Promise<Buffer>((resolveOutput, reject) => {
    const child = execFile(
      "git",
      ["-C", root, "cat-file", "--batch"],
      { encoding: "buffer", timeout: 30_000, maxBuffer: 256 * 1024 * 1024 },
      (error, stdout) => (error === null ? resolveOutput(stdout) : reject(error)),
    );
    child.stdin?.end(markdown.map((path) => `${revision}:${path}\n`).join(""));
  });
  let offset = 0;
  for (const path of markdown) {
    const headerEnd = output.indexOf(0x0a, offset);
    const header = output.subarray(offset, headerEnd).toString("utf8");
    offset = headerEnd + 1;
    // An added document is `<object> missing`; it has no previous bytes.
    if (header.endsWith(" missing")) continue;
    const size = Number(header.split(" ")[2]);
    if (!Number.isSafeInteger(size)) throw new Error(`Unreadable Git object for ${path}.`);
    contents.set(path, output.subarray(offset, offset + size).toString("utf8"));
    offset += size + 1;
  }
  return contents;
}

/**
 * The change from `since` to the worktree for the relation web (ADR-0562): renames count as a
 * deletion plus an addition, untracked files that are not ignored count as added, a deleted
 * workspace manifest keeps its package name, and changed Markdown keeps its bytes at `since`. The
 * previous command catalog is unknown here.
 */
export async function relationChangeSince(
  root: string,
  since: string,
): Promise<
  RelationChange & {
    changedPaths: string[];
    deletedPaths: string[];
    /** Changed Markdown bytes at `since`, for telling new header declarations from old ones. */
    previousDocuments: Map<string, string>;
  }
> {
  const revision = (await git(root, ["rev-parse", "--verify", `${since}^{commit}`])).trim();
  const fields = (await git(root, ["diff", "-z", "--no-renames", "--name-status", revision])).split(
    "\0",
  );
  const changedPaths: string[] = [];
  const deletedPaths: string[] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const status = fields[index]!;
    const path = fields[index + 1]!;
    if (status === "D") deletedPaths.push(path);
    else if (status !== "") changedPaths.push(path);
  }
  const untracked = (await git(root, ["ls-files", "-z", "--others", "--exclude-standard"]))
    .split("\0")
    .filter((path) => path !== "" && !path.startsWith(".lervo/state/"));
  const deletedPackages = (
    await Promise.all(
      deletedPaths
        .filter((path) => manifestPattern.test(path))
        .map((path) => deletedPackage(root, revision, path)),
    )
  ).filter((item): item is RelationWorkspacePackage => item !== null);
  return {
    changedPaths: [...changedPaths, ...untracked],
    deletedPaths,
    deletedPackages,
    previousDocuments: await previousMarkdown(root, revision, changedPaths),
  };
}
