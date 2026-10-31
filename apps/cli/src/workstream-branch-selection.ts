import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { WorkstreamSnapshot } from "@lervo/schemas";
import {
  readWorkstreamBranchBindings,
  writeWorkstreamBranchBindings,
  type WorkstreamBranchBindings,
} from "@lervo/repository-knowledge";

const execute = promisify(execFile);

async function git(root: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execute("git", ["-C", root, ...args], {
      timeout: 5_000,
      maxBuffer: 4096,
    });
    const value = stdout.trim();
    return value.length === 0 ? null : value;
  } catch {
    return null;
  }
}

/** The checked-out branch; null outside Git or on a detached HEAD. */
export async function observeCheckedOutBranch(root: string): Promise<string | null> {
  return git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
}

/** The branch that carries the repository-wide workstream: the remote default, else main/master. */
export async function resolveDefaultBranch(root: string, checkedOut: string): Promise<string> {
  const remote = await git(root, [
    "symbolic-ref",
    "--quiet",
    "--short",
    "refs/remotes/origin/HEAD",
  ]);
  if (remote !== null && remote.startsWith("origin/")) return remote.slice("origin/".length);
  for (const candidate of ["main", "master"])
    if ((await git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`])) !== null)
      return candidate;
  return checkedOut;
}

export type WorkstreamBranchSelection =
  /** Outside Git, on a detached HEAD, or before any workstream: the single-projection behavior. */
  | { kind: "unscoped" }
  | { kind: "bound"; branch: string; workstreamId: string; bindings: WorkstreamBranchBindings }
  | { kind: "unbound"; branch: string; bindings: WorkstreamBranchBindings };

/**
 * Resolves which workstream the checked-out branch continues. The first call in a repository that
 * already has a workstream binds it to the default branch, where it continues as the repository-wide
 * workstream; every other branch starts its own.
 */
export async function selectBranchWorkstream(input: {
  root: string;
  projected: Pick<WorkstreamSnapshot, "workstreamId" | "origin"> | null;
}): Promise<WorkstreamBranchSelection> {
  const branch = await observeCheckedOutBranch(input.root);
  if (branch === null) return { kind: "unscoped" };
  let bindings = await readWorkstreamBranchBindings(input.root);
  if (bindings === null) {
    if (input.projected === null) return { kind: "unscoped" };
    const defaultBranch = await resolveDefaultBranch(input.root, branch);
    bindings = {
      schemaVersion: 1,
      defaultBranch,
      bindings: { [defaultBranch]: input.projected.workstreamId },
    };
    await writeWorkstreamBranchBindings(input.root, bindings);
  }
  let workstreamId = bindings.bindings[branch];
  const projected = input.projected;
  if (
    workstreamId !== undefined &&
    projected !== null &&
    projected.workstreamId !== workstreamId &&
    projected.origin.kind === "successor" &&
    projected.origin.predecessorWorkstreamId === workstreamId
  ) {
    // A successor started for this branch's settled goal continues the branch.
    workstreamId = projected.workstreamId;
    bindings = { ...bindings, bindings: { ...bindings.bindings, [branch]: workstreamId } };
    await writeWorkstreamBranchBindings(input.root, bindings);
  }
  return workstreamId === undefined
    ? { kind: "unbound", branch, bindings }
    : { kind: "bound", branch, workstreamId, bindings };
}

/** Binds the checked-out branch to a workstream it just started; a no-op outside a branch. */
export async function bindCheckedOutBranch(root: string, workstreamId: string): Promise<void> {
  const branch = await observeCheckedOutBranch(root);
  if (branch === null) return;
  const bindings = (await readWorkstreamBranchBindings(root)) ?? {
    schemaVersion: 1 as const,
    defaultBranch: await resolveDefaultBranch(root, branch),
    bindings: {},
  };
  await writeWorkstreamBranchBindings(root, {
    ...bindings,
    bindings: { ...bindings.bindings, [branch]: workstreamId },
  });
}
