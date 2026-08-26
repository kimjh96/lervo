import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { WorkspaceHostError } from "@lervo/workspace-host";

const execute = promisify(execFile);

function fail(
  code: ConstructorParameters<typeof WorkspaceHostError>[0],
  message: string,
  cause?: unknown,
): never {
  throw new WorkspaceHostError(code, message, cause === undefined ? undefined : { cause });
}

async function git(root: string, arguments_: string[]): Promise<string> {
  try {
    const { stdout } = await execute("git", ["-C", root, ...arguments_], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    fail("host_git_failed", "The Git target-ref operation failed.", error);
  }
}

async function gitSucceeds(root: string, arguments_: string[]): Promise<boolean> {
  try {
    await execute("git", ["-C", root, ...arguments_], {
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024,
    });
    return true;
  } catch {
    return false;
  }
}

export async function exactTargetCommit(
  repositoryRoot: string,
  targetRef: string,
): Promise<string | null> {
  try {
    const { stdout } = await execute(
      "git",
      ["-C", repositoryRoot, "rev-parse", "--verify", targetRef],
      { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
    );
    return stdout.trim();
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    if (code === 128) return null;
    fail("host_git_failed", "The Git integration target could not be inspected.", error);
  }
}

async function assertTargetRefNotCheckedOut(
  repositoryRoot: string,
  targetRef: string,
): Promise<void> {
  const output = await git(repositoryRoot, ["worktree", "list", "--porcelain", "-z"]);
  if (output.split("\0").some((field) => field === `branch ${targetRef}`))
    fail(
      "host_coordinate_invalid",
      "The Git integration target ref is checked out in a registered worktree.",
    );
}

async function assertCandidateGraph(input: {
  repositoryRoot: string;
  targetBeforeCommit: string;
  candidateCommit: string;
  candidateTreeHash: string;
}): Promise<void> {
  const [treeHash, descendsFromTarget] = await Promise.all([
    git(input.repositoryRoot, ["rev-parse", `${input.candidateCommit}^{tree}`]),
    gitSucceeds(input.repositoryRoot, [
      "merge-base",
      "--is-ancestor",
      input.targetBeforeCommit,
      input.candidateCommit,
    ]),
  ]);
  if (treeHash !== input.candidateTreeHash || !descendsFromTarget)
    fail(
      "host_effect_uncertain",
      "The Git integration candidate no longer matches its exact target ancestry and tree.",
    );
}

async function compareAndSwapTarget(input: {
  repositoryRoot: string;
  targetRef: string;
  expectedCommit: string;
  nextCommit: string;
}): Promise<boolean> {
  const updated = await gitSucceeds(input.repositoryRoot, [
    "update-ref",
    input.targetRef,
    input.nextCommit,
    input.expectedCommit,
  ]);
  const observed = await exactTargetCommit(input.repositoryRoot, input.targetRef);
  if (observed === input.nextCommit) return true;
  if (observed !== input.expectedCommit)
    fail("host_effect_uncertain", "The Git integration target ref changed concurrently.");
  if (!updated) fail("host_git_failed", "The Git integration target ref compare-and-swap failed.");
  fail("host_effect_uncertain", "The Git integration target ref update was not observable.");
}

export async function advanceExactTargetRef(input: {
  repositoryRoot: string;
  targetRef: string;
  targetBeforeCommit: string;
  candidateCommit: string;
  candidateTreeHash: string;
}): Promise<"advanced" | "already_advanced"> {
  await assertTargetRefNotCheckedOut(input.repositoryRoot, input.targetRef);
  await assertCandidateGraph(input);
  const targetCommit = await exactTargetCommit(input.repositoryRoot, input.targetRef);
  if (targetCommit === input.candidateCommit) return "already_advanced";
  if (targetCommit !== input.targetBeforeCommit)
    fail("host_effect_uncertain", "The Git integration target ref changed before advancement.");
  await compareAndSwapTarget({
    repositoryRoot: input.repositoryRoot,
    targetRef: input.targetRef,
    expectedCommit: input.targetBeforeCommit,
    nextCommit: input.candidateCommit,
  });
  return "advanced";
}

export async function rollbackExactTargetRef(input: {
  repositoryRoot: string;
  targetRef: string;
  targetBeforeCommit: string;
  candidateCommit: string;
  candidateTreeHash: string;
}): Promise<boolean> {
  await assertTargetRefNotCheckedOut(input.repositoryRoot, input.targetRef);
  await assertCandidateGraph(input);
  const targetCommit = await exactTargetCommit(input.repositoryRoot, input.targetRef);
  if (targetCommit === input.targetBeforeCommit) return true;
  if (targetCommit !== input.candidateCommit)
    fail("host_effect_uncertain", "The Git integration target ref changed before rollback.");
  return compareAndSwapTarget({
    repositoryRoot: input.repositoryRoot,
    targetRef: input.targetRef,
    expectedCommit: input.candidateCommit,
    nextCommit: input.targetBeforeCommit,
  });
}
