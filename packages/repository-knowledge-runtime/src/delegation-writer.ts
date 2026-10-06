import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { knowledgeOutputCommitGrant } from "./convergence-owner-fence.js";
import { CONVERGENCE_DELEGATION_PATH } from "./delegation-contract.js";

const execute = promisify(execFile);

/**
 * ADR-0478: who may write this checkout's delegation now. Exactly one host renews or rebinds a
 * repository's delegation: the convergence owner, which is the host the ADR-0466 commit grant
 * allows (the Hub lease holder, a standalone owner, or an unconfigured single host).
 *
 * - `owner`: renews and rebinds under the host policy.
 * - `follower`: another host owns the repository and the delegation file is host-local, so this
 *   host adopts the owner's term from the owner's Hub host record.
 * - `replica_follower`: another host owns the repository and `HEAD` tracks the delegation file,
 *   so it is shared repository content; the repository replica carries the owner's exact bytes
 *   and this host writes nothing.
 */
export type DelegationWriter = "owner" | "follower" | "replica_follower";

/** Whether `HEAD` tracks the delegation path; an unborn or unreadable history tracks nothing. */
export async function delegationTrackedAtHead(repositoryRoot: string): Promise<boolean> {
  try {
    const { stdout } = await execute(
      "git",
      ["-C", repositoryRoot, "ls-tree", "--name-only", "HEAD", "--", CONVERGENCE_DELEGATION_PATH],
      { maxBuffer: 64 * 1024 },
    );
    return stdout.trim() === CONVERGENCE_DELEGATION_PATH;
  } catch {
    return false;
  }
}

export async function observeDelegationWriter(
  repositoryRoot: string,
  now: number,
): Promise<DelegationWriter> {
  if ((await knowledgeOutputCommitGrant(repositoryRoot, now)).allowed) return "owner";
  return (await delegationTrackedAtHead(repositoryRoot)) ? "replica_follower" : "follower";
}
