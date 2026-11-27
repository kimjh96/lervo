import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const objectName = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
const MAXIMUM_LOG_BYTES = 64 * 1024 * 1024;
const MAXIMUM_LOOKUPS = 300_000;

export interface GitPathRevision {
  revision: string;
  committedAt: string;
  /** Zero for HEAD's own change; larger values are older first-parent changes. */
  order: number;
}

export interface DocumentStalenessGitPort {
  headRevision(): Promise<string>;
  /** Latest first-parent change for each matching path, newest first. */
  latestPathRevisions(pathspecs: readonly string[]): Promise<Map<string, GitPathRevision>>;
  /** Object name for each `revision:path` lookup, or null when absent at that revision. */
  objectNames(lookups: readonly string[]): Promise<Map<string, string | null>>;
}

export class DocumentStalenessGitUnavailable extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DocumentStalenessGitUnavailable";
  }
}

const gitEnvironment = {
  ...process.env,
  GIT_OPTIONAL_LOCKS: "0",
  GIT_TERMINAL_PROMPT: "0",
  LC_ALL: "C",
};

/** Read-only Git adapter. It never writes refs, the index, or objects. */
export function gitDocumentStalenessPort(repositoryRoot: string): DocumentStalenessGitPort {
  const git = async (args: string[], maxBuffer: number): Promise<string> => {
    try {
      const result = await executeFile("git", args, {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: gitEnvironment,
        maxBuffer,
        timeout: 60_000,
        windowsHide: true,
      });
      return result.stdout;
    } catch (error) {
      throw new DocumentStalenessGitUnavailable("Git history is unavailable.", { cause: error });
    }
  };
  return {
    async headRevision() {
      const output = (await git(["rev-parse", "--verify", "HEAD^{commit}"], 1024)).trim();
      if (!objectName.test(output))
        throw new DocumentStalenessGitUnavailable("HEAD is not a commit.");
      return output;
    },
    async latestPathRevisions(pathspecs) {
      const output = await git(
        [
          "log",
          "--first-parent",
          "--diff-merges=first-parent",
          "--name-only",
          "--no-renames",
          "-z",
          "--format=%x01%H %cI",
          "--",
          ...pathspecs,
        ],
        MAXIMUM_LOG_BYTES,
      );
      const latest = new Map<string, GitPathRevision>();
      let order = 0;
      for (const record of output.split("\u0001").slice(1)) {
        const [header, ...names] = record.split("\u0000");
        const [revision, committedAt] = (header ?? "").split(" ");
        if (revision === undefined || committedAt === undefined || !objectName.test(revision))
          throw new DocumentStalenessGitUnavailable("Git log output is malformed.");
        for (const path of names) {
          const name = path.replace(/^\n/u, "");
          if (name !== "" && !latest.has(name)) latest.set(name, { revision, committedAt, order });
        }
        order += 1;
      }
      return latest;
    },
    objectNames(lookups) {
      if (lookups.length > MAXIMUM_LOOKUPS)
        return Promise.reject(new DocumentStalenessGitUnavailable("Too many object lookups."));
      return new Promise((resolvePromise, reject) => {
        const child = spawn("git", ["cat-file", "--batch-check=%(objectname)"], {
          cwd: repositoryRoot,
          env: gitEnvironment,
          windowsHide: true,
        });
        let stdout = "";
        // Git that exits before reading every lookup answered only some of them.
        let lookupsCutShort = false;
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
          stdout += chunk;
        });
        child.on("error", (error) =>
          reject(new DocumentStalenessGitUnavailable("Git is unavailable.", { cause: error })),
        );
        child.on("close", (code) => {
          const lines = stdout.split("\n").slice(0, lookups.length);
          if (code !== 0 || lines.length !== lookups.length || lookupsCutShort) {
            reject(new DocumentStalenessGitUnavailable("Git object lookup failed."));
            return;
          }
          resolvePromise(
            new Map(
              lookups.map((lookup, index) => {
                const line = lines[index]!.trim();
                return [lookup, objectName.test(line) ? line : null];
              }),
            ),
          );
        });
        child.stdin.on("error", () => {
          lookupsCutShort = true;
        });
        child.stdin.end(lookups.map((lookup) => `${lookup}\n`).join(""));
      });
    },
  };
}
