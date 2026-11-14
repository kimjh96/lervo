import { dirname, resolve, sep } from "node:path";

const maximumDirectories = 4_096;

/** Lists source parents and Git coordinate directories whose direct children are watched. */
export async function listRepositoryChangeDirectories(input: {
  root: string;
  state: string;
  gitRoots: ReadonlySet<string>;
  commonDirectory: string;
  git: (args: string[]) => Promise<string>;
}): Promise<Set<string>> {
  const { root, commonDirectory, git } = input;
  const paths = (await git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]))
    .split("\0")
    .filter(Boolean);
  const directories = new Set([
    root,
    input.state,
    ...input.gitRoots,
    resolve(commonDirectory, "refs"),
    resolve(commonDirectory, "refs/heads"),
  ]);
  for (const path of paths) {
    let parent = dirname(resolve(root, path));
    while (parent !== root && parent.startsWith(`${root}${sep}`)) {
      directories.add(parent);
      parent = dirname(parent);
    }
  }
  for (const reference of (await git(["for-each-ref", "--format=%(refname)", "refs/heads"]))
    .trim()
    .split("\n")
    .filter(Boolean)) {
    let parent = dirname(resolve(commonDirectory, reference));
    while (parent.startsWith(`${commonDirectory}${sep}refs${sep}heads`)) {
      directories.add(parent);
      parent = dirname(parent);
    }
  }
  if (directories.size > maximumDirectories)
    throw new Error("Repository watcher directory limit exceeded.");
  return directories;
}
