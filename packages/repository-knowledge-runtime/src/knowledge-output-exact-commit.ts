import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);

async function git(root: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const { stdout } = await execute("git", ["-C", root, ...args], {
    maxBuffer: 16 * 1024 * 1024,
    ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
  });
  return stdout.trim();
}

/** Writes `bytes` as a blob exactly as given: no clean filter or line-ending conversion runs. */
function writeBlob(root: string, bytes: Buffer): Promise<string> {
  return new Promise((resolveBlob, reject) => {
    const child = spawn("git", ["-C", root, "hash-object", "-w", "--no-filters", "--stdin"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolveBlob(stdout.trim()) : reject(new Error(`git hash-object exited ${code}`)),
    );
    child.stdin.end(bytes);
  });
}

/**
 * Commits exactly the given bytes on top of `parent` and moves HEAD only if it still names
 * `parent`. Blobs come from memory, never from the working tree, so a file edited after its
 * bytes were checked can never enter the commit; the edit stays in the working tree. A null
 * `bytes` removes the path. Returns the new commit, or null when nothing changes or HEAD moved.
 * No hook runs, as for the private seal commit; `commit.gpgsign` is honoured.
 */
export async function commitExactKnowledgeBytes(input: {
  repositoryRoot: string;
  parent: string;
  entries: readonly { path: string; bytes: Buffer | null }[];
  messages: readonly string[];
  identity: NodeJS.ProcessEnv;
}): Promise<string | null> {
  const root = input.repositoryRoot;
  const directory = await mkdtemp(join(tmpdir(), "lervo-knowledge-commit-index-"));
  try {
    const index = { GIT_INDEX_FILE: join(directory, "index") };
    await git(root, ["read-tree", input.parent], index);
    for (const entry of input.entries) {
      if (entry.bytes === null) {
        await git(root, ["update-index", "--force-remove", "--", entry.path], index);
        continue;
      }
      const blob = await writeBlob(root, entry.bytes);
      const committed = await git(root, ["ls-tree", "-z", input.parent, "--", entry.path]);
      const mode = committed === "" ? "100644" : committed.split(" ")[0]!;
      await git(
        root,
        ["update-index", "--add", "--cacheinfo", `${mode},${blob},${entry.path}`],
        index,
      );
    }
    const tree = await git(root, ["write-tree"], index);
    if (tree === (await git(root, ["rev-parse", `${input.parent}^{tree}`]))) return null;
    const sign = await git(root, ["config", "--type=bool", "--get", "commit.gpgsign"]).catch(
      () => "false",
    );
    const commit = await git(
      root,
      [
        "commit-tree",
        tree,
        "-p",
        input.parent,
        ...(sign === "true" ? ["-S"] : []),
        ...input.messages.flatMap((message) => ["-m", message]),
      ],
      input.identity,
    );
    try {
      await git(root, [
        "update-ref",
        "-m",
        `commit: ${input.messages[0]}`,
        "HEAD",
        commit,
        input.parent,
      ]);
    } catch {
      return null;
    }
    // The developer's index follows the commit for these paths; any other staged work stays.
    await git(root, ["reset", "-q", "--", ...input.entries.map((entry) => entry.path)]).catch(
      () => undefined,
    );
    return commit;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
