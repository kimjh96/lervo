import { listDurableInstructionCandidates } from "@lervo/repository-knowledge";
import { instructionCandidateApplyAuthority } from "@lervo/repository-knowledge-runtime";

import { applyDurableInstructionCandidate } from "./durable-instruction-apply.js";

export interface InstructionCandidateApplyResult {
  applied: number;
  /** Candidates left for a later cycle, for example while a rule commit is pending. */
  deferred: number;
}

/**
 * ADR-0561: on the convergence owner, or a single host, the resident applies every stored
 * candidate. A candidate exists only after its fidelity check or independent cross-check passed,
 * whatever the rule's risk or authority, so nothing here waits for the owner.
 */
export async function applyStoredInstructionCandidates(input: {
  repositoryRoot: string;
  now: () => Date;
}): Promise<InstructionCandidateApplyResult> {
  const result: InstructionCandidateApplyResult = { applied: 0, deferred: 0 };
  const authority = await instructionCandidateApplyAuthority(input.repositoryRoot);
  if (authority.status === "owner_elsewhere") return result;
  for (const candidate of await listDurableInstructionCandidates(input.repositoryRoot)) {
    try {
      await applyDurableInstructionCandidate({
        repositoryRoot: input.repositoryRoot,
        candidateId: candidate.candidateId,
        now: input.now(),
      });
      result.applied += 1;
    } catch {
      // The candidate stays in the store; the next cycle retries it.
      result.deferred += 1;
    }
  }
  return result;
}
