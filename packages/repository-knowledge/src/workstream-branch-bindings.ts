import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { RepositoryKnowledgeError } from "./types.js";

/** Local selection only: which workstream each checked-out branch continues. Never canonical. */
export const WORKSTREAM_BRANCH_BINDINGS_PATH = ".lervo/state/workstreams/bindings.json";
const CURRENT_WORKSTREAM_PATH = ".lervo/state/workstreams/current.json";
const MAXIMUM_BINDINGS = 256;
const MAXIMUM_BYTES = 64 * 1024;
const WORKSTREAM_ID = /^wks_[a-f0-9]{24}$/u;
// Git ref names: no control characters, spaces, `~^:?*[\`, `..`, or `@{`.
const BRANCH_NAME = /^(?!.*\.\.)(?!.*@\{)[^\s~^:?*[\\\x00-\x1f\x7f]{1,255}$/u;

export interface WorkstreamBranchBindings {
  schemaVersion: 1;
  /** The branch that holds the repository-wide workstream, which Hub replication publishes. */
  defaultBranch: string;
  bindings: Record<string, string>;
}

function validBindings(value: unknown): value is WorkstreamBranchBindings {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<WorkstreamBranchBindings>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.defaultBranch !== "string" ||
    !BRANCH_NAME.test(candidate.defaultBranch) ||
    typeof candidate.bindings !== "object" ||
    candidate.bindings === null
  )
    return false;
  const entries = Object.entries(candidate.bindings);
  return (
    entries.length <= MAXIMUM_BINDINGS &&
    entries.every(
      ([branch, workstreamId]) =>
        BRANCH_NAME.test(branch) &&
        typeof workstreamId === "string" &&
        WORKSTREAM_ID.test(workstreamId),
    )
  );
}

export async function readWorkstreamBranchBindings(
  repositoryRoot: string,
): Promise<WorkstreamBranchBindings | null> {
  let content: string;
  try {
    const path = resolve(repositoryRoot, WORKSTREAM_BRANCH_BINDINGS_PATH);
    const stats = await lstat(path);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.size > MAXIMUM_BYTES)
      throw new RepositoryKnowledgeError(
        "knowledge_source_unsafe",
        "The workstream branch bindings are not a safe regular file.",
      );
    content = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    value = null;
  }
  if (!validBindings(value))
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The workstream branch bindings do not satisfy the v1 contract.",
    );
  return value;
}

async function writeAtomically(root: string, path: string, content: string): Promise<void> {
  const target = resolve(root, path);
  const directory = dirname(target);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stats = await lstat(directory);
  if (!stats.isDirectory() || stats.isSymbolicLink())
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "The workstream projection directory is unsafe.",
    );
  const temporary = `${target}.bind-${process.pid}`;
  await rm(temporary, { force: true });
  const handle = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600,
  );
  try {
    await handle.writeFile(content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
}

export async function writeWorkstreamBranchBindings(
  repositoryRoot: string,
  value: WorkstreamBranchBindings,
): Promise<void> {
  const sorted: WorkstreamBranchBindings = {
    schemaVersion: 1,
    defaultBranch: value.defaultBranch,
    bindings: Object.fromEntries(
      Object.entries(value.bindings).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
  if (!validBindings(sorted))
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The workstream branch bindings do not satisfy the v1 contract.",
    );
  await writeAtomically(
    repositoryRoot,
    WORKSTREAM_BRANCH_BINDINGS_PATH,
    `${JSON.stringify(sorted)}\n`,
  );
}

/**
 * Removes the selected projection when the checked-out branch continues no workstream. The
 * projection is rebuildable from events and content-addressed snapshots, so nothing is lost.
 */
export async function clearCurrentWorkstreamProjection(repositoryRoot: string): Promise<void> {
  await rm(resolve(repositoryRoot, CURRENT_WORKSTREAM_PATH), { force: true });
}
