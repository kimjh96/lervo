import { listDurableInstructionCandidates } from "@lervo/repository-knowledge";
import { instructionCandidateApplyAuthority } from "@lervo/repository-knowledge-runtime";

import { applyReviewedDurableInstruction } from "./durable-instruction-intake.js";

/** The settling reviewer recorded for rules the owner stated and the automatic gate admitted. */
export const OWNER_STATED_RULE_REVIEWER = "lervo-principal-proxy";

export interface OwnerStatedInstructionApplyResult {
  applied: number;
  /** Candidates left for a later cycle, for example after a catalog change. */
  deferred: number;
}

/**
 * ADR-0545: on the convergence owner, the resident applies every candidate the owner stated
 * explicitly. Each apply re-runs the ADR-0467 automatic gate against the current instruction
 * catalog, so a candidate that is no longer `ready` stays for the principal proxy.
 */
export async function applyOwnerStatedInstructionCandidates(input: {
  repositoryRoot: string;
  now: () => Date;
}): Promise<OwnerStatedInstructionApplyResult> {
  const result: OwnerStatedInstructionApplyResult = { applied: 0, deferred: 0 };
  const authority = await instructionCandidateApplyAuthority(input.repositoryRoot);
  if (authority.status === "owner_elsewhere") return result;
  for (const candidate of await listDurableInstructionCandidates(input.repositoryRoot)) {
    if (candidate.instruction.authority !== "explicit_user") continue;
    try {
      await applyReviewedDurableInstruction({
        repositoryRoot: input.repositoryRoot,
        candidateId: candidate.candidateId,
        candidateHash: candidate.candidateHash,
        reviewerId: OWNER_STATED_RULE_REVIEWER,
        now: input.now(),
      });
      result.applied += 1;
    } catch {
      // The candidate stays in the store; the next cycle retries it against the then-current catalog.
      result.deferred += 1;
    }
  }
  return result;
}
