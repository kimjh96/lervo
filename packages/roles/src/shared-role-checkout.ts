// Where a linked Git worktree's shared roles live. Every worktree of a repository shares one agent
// registry, in Git's common directory, so the roles its agents name must resolve in each of them.
// A role the main checkout keeps and no commit holds yet, such as a template written on a first
// hire, is missing from a worktree made from a commit; the worktree reads it from the main checkout.
import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

/** A `.git` file or `commondir` entry holds one short path; anything longer is not one. */
const MAXIMUM_POINTER_BYTES = 4096;

async function pointer(path: string): Promise<string | undefined> {
  const text = await readFile(path, "utf8");
  if (text.length > MAXIMUM_POINTER_BYTES) return undefined;
  return text.trim();
}

/**
 * The main checkout of the linked Git worktree at `root`, read from Git's own files without running
 * Git. A main checkout, a submodule, a bare repository's worktree, and a directory outside Git have
 * none.
 */
export async function mainCheckoutOf(root: string): Promise<string | undefined> {
  try {
    const marker = await pointer(resolve(root, ".git"));
    const linked = /^gitdir: (.+)$/mu.exec(marker ?? "")?.[1]?.trim();
    if (linked === undefined) return undefined;
    const gitDirectory = resolve(root, linked);
    const common = await pointer(resolve(gitDirectory, "commondir"));
    if (common === undefined || common === "") return undefined;
    const commonDirectory = resolve(gitDirectory, common);
    return basename(commonDirectory) === ".git" ? dirname(commonDirectory) : undefined;
  } catch {
    // A main checkout's `.git` is a directory, and a plain directory has no `.git` at all.
    return undefined;
  }
}
