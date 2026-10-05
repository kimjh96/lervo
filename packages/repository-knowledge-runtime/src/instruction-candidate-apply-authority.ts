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
 * Who may apply a reviewed owner-rule candidate (ADR-0467). A host without Hub coordination
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

/**
 * Commits exactly the applied rule file as `Lervo Knowledge` with the owner trailer. Returns
 * null when committing is unsafe or ownership ended; the written rule stays for the next owner.
 */
export async function commitAppliedInstructionCandidate(input: {
  repositoryRoot: string;
  targetPath: string;
  candidateId: string;
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
    `Lervo-Instruction-Candidate: ${input.candidateId}`,
    ...(grant.hostHash === null ? [] : [`${CONVERGENCE_HOST_TRAILER}: ${grant.hostHash}`]),
  ].join("\n");
  try {
    const before = (await git(["rev-parse", "HEAD"])).trim();
    await git(["add", "--", input.targetPath]);
    await git(
      [
        "commit",
        "--only",
        "--quiet",
        "-m",
        "docs: apply a reviewed owner rule",
        "-m",
        trailers,
        "--",
        input.targetPath,
      ],
      KNOWLEDGE_OUTPUT_COMMIT_IDENTITY,
    );
    const after = (await git(["rev-parse", "HEAD"])).trim();
    return (await git(["rev-parse", `${after}^`])).trim() === before ? after : null;
  } catch {
    return null;
  }
}
