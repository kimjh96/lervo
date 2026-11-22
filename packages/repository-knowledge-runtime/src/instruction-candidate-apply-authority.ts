import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  knowledgeOutputCommitGrant,
  readConvergenceOwnerFence,
} from "./convergence-owner-fence.js";
import { readConvergenceOwnerHost } from "./convergence-owner-host.js";
import { commitKnowledgePaths } from "./knowledge-effect-commit.js";

const execute = promisify(execFile);

/**
 * Who may apply a stored owner-rule candidate (ADR-0467, ADR-0561). A host without Hub coordination
 * applies as a single host does. A Hub-coordinated host applies only while its ADR-0466 fence
 * grants ownership. Either commits the rule as `Lervo Knowledge` (ADR-0610), so publication and
 * the replica carry it to every host and no rule stays uncommitted in the owner's checkout.
 */
export type InstructionCandidateApplyAuthority =
  | { status: "single_host" }
  | { status: "owner"; hostHash: string | null }
  | { status: "owner_elsewhere"; reason: string; holderLabel: string | null };

export async function instructionCandidateApplyAuthority(
  repositoryRoot: string,
): Promise<InstructionCandidateApplyAuthority> {
  let host: Awaited<ReturnType<typeof readConvergenceOwnerHost>>;
  try {
    host = await readConvergenceOwnerHost(repositoryRoot);
  } catch {
    return {
      status: "owner_elsewhere",
      reason: "convergence_owner_host_invalid",
      holderLabel: null,
    };
  }
  if (host === null || host.config.coordination.mode !== "hub") return { status: "single_host" };
  const grant = await knowledgeOutputCommitGrant(repositoryRoot);
  if (grant.allowed) return { status: "owner", hostHash: grant.hostHash };
  const fence = await readConvergenceOwnerFence(repositoryRoot);
  return {
    status: "owner_elsewhere",
    reason: grant.reason,
    holderLabel: fence?.verdict.holder?.label ?? null,
  };
}

/** The commit subjects of owner-rule changes; ADR-0549 notices classify them. */
export const OWNER_RULE_COMMIT_SUBJECT = "docs: apply an owner rule";
export const OWNER_RULE_RETIRE_COMMIT_SUBJECT = "docs: retire an owner rule";

/** Commits exactly the given owner-rule paths as `Lervo Knowledge` with the owner trailer. */
async function commitOwnerRulePaths(input: {
  repositoryRoot: string;
  paths: readonly string[];
  subject: string;
  trailer: string;
}): Promise<string | null> {
  const result = await commitKnowledgePaths({
    repositoryRoot: input.repositoryRoot,
    paths: input.paths,
    subject: input.subject,
    trailers: [input.trailer],
  });
  return result.status === "committed" ? result.after : null;
}

/**
 * Commits the applied rule file and the deletion of any generated rule it replaced. The commit is
 * the undo point: reverting it restores the replaced rule (ADR-0561).
 */
export function commitAppliedInstructionCandidate(input: {
  repositoryRoot: string;
  targetPath: string;
  replacedPaths?: readonly string[];
  candidateId: string;
}): Promise<string | null> {
  return commitOwnerRulePaths({
    repositoryRoot: input.repositoryRoot,
    paths: [input.targetPath, ...(input.replacedPaths ?? [])],
    subject: OWNER_RULE_COMMIT_SUBJECT,
    trailer: `Lervo-Instruction-Candidate: ${input.candidateId}`,
  });
}

/** Commits the deletion of one retired generated rule, the undo of an applied rule. */
export function commitRetiredInstruction(input: {
  repositoryRoot: string;
  path: string;
  ruleId: string;
}): Promise<string | null> {
  return commitOwnerRulePaths({
    repositoryRoot: input.repositoryRoot,
    paths: [input.path],
    subject: OWNER_RULE_RETIRE_COMMIT_SUBJECT,
    trailer: `Lervo-Instruction-Rule: ${input.ruleId}`,
  });
}

/**
 * Whether the applied rule file is tracked and identical to HEAD, and every replaced rule is
 * deleted in HEAD, so an earlier apply already committed it. A retry then settles the candidate
 * without a second commit.
 */
export async function appliedInstructionCandidateCommitted(input: {
  repositoryRoot: string;
  targetPath: string;
  replacedPaths?: readonly string[];
}): Promise<boolean> {
  try {
    const git = async (args: string[]) =>
      (await execute("git", ["-C", input.repositoryRoot, ...args], { maxBuffer: 1024 * 1024 }))
        .stdout;
    if ((await git(["ls-files", "--", input.targetPath])).trim() === "") return false;
    return (
      (
        await git(["status", "--porcelain", "--", input.targetPath, ...(input.replacedPaths ?? [])])
      ).trim() === ""
    );
  } catch {
    return false;
  }
}
