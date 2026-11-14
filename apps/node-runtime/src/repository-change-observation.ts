import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { resolve, relative, isAbsolute } from "node:path";

/**
 * Disposable metadata hint; no source body, replica success or mutation authority is inferred.
 * `--no-optional-locks` keeps the periodic status from refreshing the index, which would itself
 * look like a repository change to every watcher of this checkout.
 */
export async function observeRepositoryChangeHint(input: {
  root: string;
  gitDirectory: string;
  commonDirectory: string;
  git(args: string[]): Promise<string>;
}): Promise<string> {
  const [status, references] = await Promise.all([
    input.git(["--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all"]),
    input.git(["for-each-ref", "--format=%(refname) %(objectname)", "refs/heads"]),
  ]);
  const entries = status.split("\0").filter(Boolean);
  const paths: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    if (entry.length < 4 || entry[2] !== " ")
      throw new Error("Invalid repository change observation.");
    const path = resolve(input.root, entry.slice(3));
    const child = relative(input.root, path);
    if (child.startsWith("..") || isAbsolute(child))
      throw new Error("Unsafe repository change observation.");
    paths.push(path);
    if (entry.slice(0, 2).includes("R") || entry.slice(0, 2).includes("C")) i++;
  }
  if (paths.length > 20_000) throw new Error("Repository change observation limit exceeded.");
  // A linked worktree keeps HEAD and its index in its own Git directory; excludes are shared.
  paths.push(
    resolve(input.gitDirectory, "HEAD"),
    resolve(input.gitDirectory, "index"),
    resolve(input.commonDirectory, "info", "exclude"),
    resolve(input.root, ".lervo/state/repository-replica-request.json"),
  );
  const metadata: unknown[] = [];
  for (let offset = 0; offset < paths.length; offset += 64) {
    metadata.push(
      ...(await Promise.all(
        paths.slice(offset, offset + 64).map(async (path) => {
          try {
            const stat = await lstat(path, { bigint: true });
            return [
              path,
              stat.ino.toString(),
              stat.size.toString(),
              stat.mtimeNs.toString(),
              stat.ctimeNs.toString(),
            ];
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return [path, null];
            throw error;
          }
        }),
      )),
    );
  }
  return createHash("sha256")
    .update(JSON.stringify([status, references, metadata]))
    .digest("hex");
}
