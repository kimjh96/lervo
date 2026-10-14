import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { WorkspaceHostError } from "@lervo/workspace-host";

const execute = promisify(execFile);

/** Throws the adapter's common host failure. */
export function fail(
  code: ConstructorParameters<typeof WorkspaceHostError>[0],
  message: string,
  cause?: unknown,
): never {
  throw new WorkspaceHostError(code, message, cause === undefined ? undefined : { cause });
}

/** Runs one Git command in `root`, translating any failure into `host_git_failed`. */
export async function git(root: string, arguments_: string[]): Promise<string> {
  try {
    const { stdout } = await execute("git", ["-C", root, ...arguments_], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    fail("host_git_failed", "The Git workspace operation failed.", error);
  }
}
