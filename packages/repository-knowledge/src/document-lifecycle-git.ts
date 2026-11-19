import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import {
  DocumentStalenessGitUnavailable,
  gitDocumentStalenessPort,
  type DocumentStalenessGitPort,
} from "./document-staleness-git.js";

const executeFile = promisify(execFile);
const MAXIMUM_OUTPUT_BYTES = 64 * 1024 * 1024;
/** Changed lines kept per file; a larger diff still yields its first lines for name matching. */
const MAXIMUM_CHANGED_LINES_PER_FILE = 20_000;

/** Read-only Git facts the document lifecycle needs beyond staleness. */
export interface DocumentLifecycleGitPort extends DocumentStalenessGitPort {
  /** Paths that differ between two commits; a rename is a deletion plus an addition. */
  changes(from: string, to: string): Promise<{ changedPaths: string[]; deletedPaths: string[] }>;
  /** Bytes for each `revision:path` lookup, or null when absent there. */
  blobs(lookups: readonly string[]): Promise<Map<string, string | null>>;
  /** Added and removed line texts per path between two commits. */
  changedLines(from: string, to: string, paths: readonly string[]): Promise<Map<string, string[]>>;
}

const gitEnvironment = {
  ...process.env,
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
};

function parseChangedLines(output: string): Map<string, string[]> {
  const lines = new Map<string, string[]>();
  let current: string[] | null = null;
  // File headers precede the first hunk; inside hunks, `--- ` is a removed line, not a header.
  let header = false;
  for (const line of output.split("\n")) {
    if (line.startsWith("diff --git ")) {
      current = null;
      header = true;
      continue;
    }
    if (header && (line.startsWith("+++ ") || line.startsWith("--- "))) {
      const path = line.slice(4).replace(/\t$/u, "");
      if (path === "/dev/null") continue;
      const name = path.replace(/^[ab]\//u, "");
      current = lines.get(name) ?? [];
      lines.set(name, current);
      continue;
    }
    if (line.startsWith("@@")) {
      header = false;
      continue;
    }
    if (header || current === null || current.length >= MAXIMUM_CHANGED_LINES_PER_FILE) continue;
    if (line.startsWith("+") || line.startsWith("-")) current.push(line.slice(1));
  }
  return lines;
}

function readBatch(root: string, lookups: readonly string[]): Promise<Map<string, string | null>> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("git", ["cat-file", "--batch"], {
      cwd: root,
      env: gitEnvironment,
      windowsHide: true,
    });
    const chunks: Buffer[] = [];
    let size = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAXIMUM_OUTPUT_BYTES) child.kill();
      else chunks.push(chunk);
    });
    child.on("error", (error) =>
      reject(new DocumentStalenessGitUnavailable("Git is unavailable.", { cause: error })),
    );
    child.on("close", (code) => {
      if (code !== 0 || size > MAXIMUM_OUTPUT_BYTES) {
        reject(new DocumentStalenessGitUnavailable("Git object read failed."));
        return;
      }
      const output = Buffer.concat(chunks);
      const result = new Map<string, string | null>();
      let offset = 0;
      for (const lookup of lookups) {
        const end = output.indexOf(0x0a, offset);
        if (end < 0) {
          reject(new DocumentStalenessGitUnavailable("Git object output is malformed."));
          return;
        }
        const header = output.subarray(offset, end).toString("utf8");
        offset = end + 1;
        const fields = header.split(" ");
        if (fields.at(-1) === "missing" || fields[1] !== "blob") {
          result.set(lookup, null);
          if (fields[1] !== undefined && fields.at(-1) !== "missing")
            offset += Number(fields[2]) + 1;
          continue;
        }
        const length = Number(fields[2]);
        result.set(lookup, output.subarray(offset, offset + length).toString("utf8"));
        offset += length + 1;
      }
      resolvePromise(result);
    });
    child.stdin.end(lookups.map((lookup) => `${lookup}\n`).join(""));
  });
}

/** Read-only Git adapter. It never writes refs, the index, or objects. */
export function gitDocumentLifecyclePort(repositoryRoot: string): DocumentLifecycleGitPort {
  const git = async (args: string[]): Promise<string> => {
    try {
      const result = await executeFile(
        "git",
        ["-c", "core.quotePath=false", "--literal-pathspecs", ...args],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: gitEnvironment,
          maxBuffer: MAXIMUM_OUTPUT_BYTES,
          timeout: 60_000,
          windowsHide: true,
        },
      );
      return result.stdout;
    } catch (error) {
      throw new DocumentStalenessGitUnavailable("Git history is unavailable.", { cause: error });
    }
  };
  return {
    ...gitDocumentStalenessPort(repositoryRoot),
    async changes(from, to) {
      const fields = (await git(["diff", "-z", "--no-renames", "--name-status", from, to])).split(
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
      return { changedPaths, deletedPaths };
    },
    blobs(lookups) {
      return lookups.length === 0 ? Promise.resolve(new Map()) : readBatch(repositoryRoot, lookups);
    },
    async changedLines(from, to, paths) {
      if (paths.length === 0) return new Map();
      return parseChangedLines(
        await git([
          "diff",
          "-U0",
          "--no-color",
          "--no-renames",
          "--no-ext-diff",
          from,
          to,
          "--",
          ...paths,
        ]),
      );
    },
  };
}
