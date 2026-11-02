import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  CONVERGENCE_HOST_TRAILER,
  knowledgeOutputCommitGrant,
  readConvergenceOwnerFence,
} from "./convergence-owner-fence.js";
import { readConvergenceOwnerHost } from "./convergence-owner-host.js";
import {
  KNOWLEDGE_OUTPUT_COMMIT_IDENTITY,
  knowledgeOutputCommitSafe,
} from "./knowledge-output-commit.js";

const execute = promisify(execFile);

/**
 * Who may apply a stored owner-rule candidate (ADR-0467, ADR-0561). A host without Hub coordination
 * applies as a single host does: it writes the generated rule and leaves the commit to its owner.
 * A Hub-coordinated host applies only while its ADR-0466 fence grants ownership, and then commits
 * the rule as `Lervo Knowledge` so publication and the replica carry it to every host.
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

/**
 * Commits exactly the given owner-rule paths, including deletions, as `Lervo Knowledge` with the
 * owner trailer. Only tracked paths can carry a deletion; an untracked deleted path is simply gone.
 * Returns null when committing is unsafe or ownership ended; the written bytes stay for the next
 * owner.
 */
async function commitOwnerRulePaths(input: {
  repositoryRoot: string;
  paths: readonly string[];
  subject: string;
  trailer: string;
}): Promise<string | null> {
  const root = input.repositoryRoot;
  if (!(await knowledgeOutputCommitSafe(root))) return null;
  const grant = await knowledgeOutputCommitGrant(root);
  if (!grant.allowed) return null;
  const git = async (args: string[], env?: NodeJS.ProcessEnv) =>
    (
      await execute("git", ["-C", root, ...args], {
        maxBuffer: 16 * 1024 * 1024,
        ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
      })
    ).stdout;
  const trailers = [
    input.trailer,
    ...(grant.hostHash === null ? [] : [`${CONVERGENCE_HOST_TRAILER}: ${grant.hostHash}`]),
  ].join("\n");
  try {
    const before = (await git(["rev-parse", "HEAD"])).trim();
    const paths: string[] = [];
    for (const path of input.paths)
      if (
        (await git(["ls-files", "--", path])).trim() !== "" ||
        (await git(["status", "--porcelain", "--", path])).trim() !== ""
      )
        paths.push(path);
    if (paths.length === 0) return null;
    await git(["add", "-A", "--", ...paths]);
    await git(
      ["commit", "--only", "--quiet", "-m", input.subject, "-m", trailers, "--", ...paths],
      KNOWLEDGE_OUTPUT_COMMIT_IDENTITY,
    );
    const after = (await git(["rev-parse", "HEAD"])).trim();
    return (await git(["rev-parse", `${after}^`])).trim() === before ? after : null;
  } catch {
    return null;
  }
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
