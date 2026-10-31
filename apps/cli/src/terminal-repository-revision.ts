import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

/** Stop binds skill evidence to an immutable commit, including when the checkout later moves. */
export async function gitHeadRevision(root: string): Promise<string | null> {
  try {
    const { stdout } = await execute(
      "git",
      ["-C", root, "rev-parse", "--verify", "HEAD^{commit}"],
      {
        timeout: 2000,
        maxBuffer: 1024,
      },
    );
    const revision = stdout.trim();
    return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(revision) ? revision : null;
  } catch {
    return null;
  }
}
