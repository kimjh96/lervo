import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { convergenceGit } from "./canonical-workspace.js";

const execute = promisify(execFile);

async function blobHash(root: string, commit: string, path: string): Promise<string | null> {
  try {
    const { stdout } = await execute("git", ["-C", root, "cat-file", "blob", `${commit}:${path}`], {
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    });
    return `sha256:${createHash("sha256").update(stdout).digest("hex")}`;
  } catch {
    return null;
  }
}

/**
 * Root apply commits integrated drafts as ordinary working-branch commits, so the integration ref
 * drifts from `HEAD`. When every ref-only change is an integrated draft that already reached the
 * working tree, record a merge with `HEAD`'s exact tree; otherwise leave the ref untouched.
 */
export async function synchronizeIntegrationTarget(input: {
  repositoryRoot: string;
  ref: string;
  /** Whether exact draft bytes settled integration, including their root apply. */
  integrated: (path: string, contentHash: string) => boolean;
}): Promise<"unchanged" | "synchronized"> {
  const root = input.repositoryRoot;
  const target = await convergenceGit(root, ["rev-parse", input.ref]);
  const head = await convergenceGit(root, ["rev-parse", "HEAD"]);
  if (target === head) return "unchanged";
  const isAncestor = async (ancestor: string, descendant: string) =>
    execute("git", ["-C", root, "merge-base", "--is-ancestor", ancestor, descendant]).then(
      () => true,
      () => false,
    );
  if (await isAncestor(head, target)) return "unchanged";
  if (await isAncestor(target, head)) {
    await convergenceGit(root, ["update-ref", input.ref, head, target]);
    return "synchronized";
  }
  const base = await convergenceGit(root, ["merge-base", target, head]);
  const changed = (await convergenceGit(root, ["diff", "--name-only", "-z", base, target]))
    .split("\0")
    .filter(Boolean);
  for (const path of changed) {
    const hash = await blobHash(root, target, path);
    if (hash === null || !input.integrated(path, hash)) return "unchanged";
  }
  const tree = await convergenceGit(root, ["rev-parse", "HEAD^{tree}"]);
  // The merge carries Lervo's own identity, so it never depends on a configured developer identity.
  const merge = await convergenceGit(root, [
    "-c",
    "user.name=Lervo Knowledge Worker",
    "-c",
    "user.email=knowledge@lervo.invalid",
    "commit-tree",
    tree,
    "-p",
    target,
    "-p",
    head,
    "-m",
    "Synchronize knowledge integration target with the reviewed working branch",
  ]);
  await convergenceGit(root, ["update-ref", input.ref, merge, target]);
  return "synchronized";
}
