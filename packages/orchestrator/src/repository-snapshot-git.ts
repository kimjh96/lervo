import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execute = promisify(execFile);
/** A snapshot pins the observed commit. Blob digest comparison still rejects dirty former bytes. */
export async function repositorySnapshotGitHead(root: string): Promise<string | undefined> {
  try {
    const { stdout } = await execute("git", ["-C", root, "rev-parse", "--verify", "HEAD"], {
      timeout: 5_000,
      maxBuffer: 4096,
    });
    const head = stdout.trim();
    return /^[a-f0-9]{40,64}$/u.test(head) ? head : undefined;
  } catch {
    return undefined;
  }
}
