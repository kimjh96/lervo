import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);
const OBJECT_ID = /^[a-f0-9]{40,64}$/u;
const COMMIT = /^[a-f0-9]{40,64}$/u;

export interface RepositoryWorkGitTreeEntry {
  mode: string;
  type: "blob" | "tree" | "commit";
  objectId: string;
}

export async function readRepositoryWorkGitTreeEntry(
  repositoryRoot: string,
  commit: string,
  path: string,
): Promise<RepositoryWorkGitTreeEntry | null> {
  if ((commit !== "HEAD" && !COMMIT.test(commit)) || path.length === 0 || path.includes("\0"))
    throw new TypeError("The Git source coordinate is invalid.");
  const { stdout } = await execute(
    "git",
    ["-C", repositoryRoot, "ls-tree", "-z", commit, "--", path],
    {
      encoding: "utf8",
      maxBuffer: 1_048_576,
    },
  );
  if (stdout === "") return null;
  const entries = stdout.split("\0").filter(Boolean);
  if (entries.length !== 1) throw new Error("The Git source path is ambiguous.");
  const entry = entries[0]!;
  const separator = entry.indexOf("\t");
  const descriptor = entry.slice(0, separator).split(" ");
  if (
    separator < 0 ||
    entry.slice(separator + 1) !== path ||
    descriptor.length !== 3 ||
    !/^[0-7]{6}$/u.test(descriptor[0]!) ||
    !["blob", "tree", "commit"].includes(descriptor[1]!) ||
    !OBJECT_ID.test(descriptor[2]!)
  )
    throw new Error("The Git source tree entry is invalid.");
  return {
    mode: descriptor[0]!,
    type: descriptor[1] as RepositoryWorkGitTreeEntry["type"],
    objectId: descriptor[2]!,
  };
}

export async function readRepositoryWorkGitBlob(input: {
  repositoryRoot: string;
  objectId: string;
  maximumBytes: number;
}): Promise<Uint8Array> {
  if (
    !OBJECT_ID.test(input.objectId) ||
    !Number.isSafeInteger(input.maximumBytes) ||
    input.maximumBytes < 0
  )
    throw new TypeError("The Git blob read bound is invalid.");
  const size = await execute(
    "git",
    ["-C", input.repositoryRoot, "cat-file", "-s", input.objectId],
    {
      encoding: "utf8",
      maxBuffer: 128,
    },
  );
  const byteCount = Number(size.stdout.trim());
  if (!Number.isSafeInteger(byteCount) || byteCount < 0)
    throw new Error("The Git blob size is invalid.");
  if (byteCount > input.maximumBytes) throw new RepositoryWorkGitBlobLimitError();
  const { stdout } = await execute(
    "git",
    ["-C", input.repositoryRoot, "cat-file", "blob", input.objectId],
    { encoding: "buffer", maxBuffer: input.maximumBytes + 1 },
  );
  if (stdout.byteLength !== byteCount) throw new Error("The Git blob byte count changed.");
  return stdout;
}

export class RepositoryWorkGitBlobLimitError extends Error {
  readonly code = "review_source_limit_exceeded";

  constructor() {
    super("The repository review source exceeds its byte bound.");
    this.name = "RepositoryWorkGitBlobLimitError";
  }
}
