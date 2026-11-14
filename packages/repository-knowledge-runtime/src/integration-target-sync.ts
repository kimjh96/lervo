import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { convergenceGit } from "./canonical-workspace.js";
import { committedBlobHashes } from "./committed-blob-hashes.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import {
  absorbIntegrationTarget,
  inspectIntegrationTargetAbsorption,
  type IntegrationTargetAbsorption,
} from "./integration-target-absorption.js";
import { restoreDiscardedIntegratedDrafts } from "./integration-target-discard.js";

const execute = promisify(execFile);

/** The SHA-256 of a committed path's bytes, or `null` when the commit has no such blob. */
export async function integrationTargetBlobHash(
  root: string,
  commit: string,
  path: string,
): Promise<string | null> {
  return (await committedBlobHashes(root, commit, [path])).get(path) ?? null;
}

/** The commit a ref names, or `null` when this repository has no such ref. */
export async function resolveIntegrationTarget(root: string, ref: string): Promise<string | null> {
  try {
    const { stdout } = await execute("git", [
      "-C",
      root,
      "rev-parse",
      "--verify",
      "--quiet",
      `${ref}^{commit}`,
    ]);
    return stdout.trim() || null;
  } catch (error) {
    // `--verify --quiet` exits 1 without output only when the ref is absent.
    if ((error as { code?: unknown }).code === 1) return null;
    throw error;
  }
}

/**
 * A reviewed delegation can name a host-local branch that this host has never created. Starting it
 * at `HEAD` is the same transition as fast-forwarding an ancestor ref. The empty old value makes Git
 * refuse to replace a ref that another writer created meanwhile.
 */
async function createIntegrationTarget(root: string, ref: string): Promise<void> {
  const head = await resolveIntegrationTarget(root, "HEAD");
  if (head === null)
    throw new KnowledgeConvergenceRuntimeError("knowledge_integration_target_unavailable");
  await convergenceGit(root, ["update-ref", ref, head, ""]).catch(() => undefined);
  if ((await resolveIntegrationTarget(root, ref)) === null)
    throw new KnowledgeConvergenceRuntimeError("knowledge_integration_target_unavailable");
}

/**
 * Root apply commits integrated drafts as ordinary working-branch commits, so the integration ref
 * drifts from `HEAD`. When every ref-only change is an integrated draft that already reached the
 * working tree, record a merge with `HEAD`'s exact tree. When a squash merge absorbed the ref
 * (ADR-0482), move it to `HEAD`; otherwise leave the ref untouched. An absent ref starts at `HEAD`.
 * A ref ahead of `HEAD` returns integrated drafts the working branch discarded (ADR-0530).
 */
export async function synchronizeIntegrationTarget(input: {
  repositoryRoot: string;
  ref: string;
  /** Whether exact draft bytes settled integration, including their root apply. */
  integrated: (path: string, contentHash: string) => boolean;
  /** Records an ADR-0482 squash absorption after the ref moved; absent records nothing. */
  recordAbsorbed?: (
    absorption: IntegrationTargetAbsorption & { backupRef: string; pathSetHash: string },
  ) => void;
}): Promise<"unchanged" | "synchronized" | "created" | "absorbed" | "restored"> {
  const root = input.repositoryRoot;
  const target = await resolveIntegrationTarget(root, input.ref);
  if (target === null) {
    await createIntegrationTarget(root, input.ref);
    return "created";
  }
  const head = await convergenceGit(root, ["rev-parse", "HEAD"]);
  if (target === head) return "unchanged";
  const isAncestor = async (ancestor: string, descendant: string) =>
    execute("git", ["-C", root, "merge-base", "--is-ancestor", ancestor, descendant]).then(
      () => true,
      () => false,
    );
  if (await isAncestor(head, target)) {
    const restored = await restoreDiscardedIntegratedDrafts({
      repositoryRoot: root,
      ref: input.ref,
      target,
      head,
      integrated: input.integrated,
    });
    return restored.length === 0 ? "unchanged" : "restored";
  }
  if (await isAncestor(target, head)) {
    await convergenceGit(root, ["update-ref", input.ref, head, target]);
    return "synchronized";
  }
  const base = await convergenceGit(root, ["merge-base", target, head]);
  const changed = (await convergenceGit(root, ["diff", "--name-only", "-z", base, target]))
    .split("\0")
    .filter(Boolean);
  const hashes = await committedBlobHashes(root, target, changed);
  for (const path of changed) {
    const hash = hashes.get(path) ?? null;
    if (hash === null || !input.integrated(path, hash)) {
      const absorption = await inspectIntegrationTargetAbsorption(root, target, head);
      if (absorption === null) return "unchanged";
      const moved = await absorbIntegrationTarget(root, input.ref, absorption);
      input.recordAbsorbed?.({ ...absorption, ...moved });
      return "absorbed";
    }
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
