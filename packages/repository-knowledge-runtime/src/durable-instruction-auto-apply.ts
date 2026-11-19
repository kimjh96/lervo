import { listDurableInstructionCandidates } from "@lervo/repository-knowledge";

import { applyDurableInstructionCandidate } from "./durable-instruction-apply.js";
import { instructionCandidateApplyAuthority } from "./instruction-candidate-apply-authority.js";
import {
  instructionApplyFailureCode,
  nextInstructionApplyFailure,
  readInstructionApplyFailures,
  writeInstructionApplyFailures,
  type InstructionApplyFailure,
} from "./instruction-apply-failures.js";

export interface InstructionCandidateApplyResult {
  applied: number;
  /** Candidates left for a later cycle, for example while a rule commit is pending. */
  deferred: number;
}

/**
 * ADR-0561: on the convergence owner, or a single host, the resident applies every stored
 * candidate. A candidate exists only after its fidelity check or independent cross-check passed,
 * whatever the rule's risk or authority, so nothing here waits for the owner. Both the CLI host and
 * the node-runtime worker call this, so every host behaves the same (ADR-0594). A candidate that
 * fails stays for the next cycle, and its failure code is recorded for attention.
 */
export async function applyStoredInstructionCandidates(input: {
  repositoryRoot: string;
  now: () => Date;
}): Promise<InstructionCandidateApplyResult> {
  const result: InstructionCandidateApplyResult = { applied: 0, deferred: 0 };
  const authority = await instructionCandidateApplyAuthority(input.repositoryRoot);
  if (authority.status === "owner_elsewhere") return result;
  const candidates = await listDurableInstructionCandidates(input.repositoryRoot);
  const previous = await readInstructionApplyFailures(input.repositoryRoot);
  const failures = new Map<string, InstructionApplyFailure>();
  for (const candidate of candidates) {
    try {
      await applyDurableInstructionCandidate({
        repositoryRoot: input.repositoryRoot,
        candidateId: candidate.candidateId,
        now: input.now(),
      });
      result.applied += 1;
    } catch (error) {
      result.deferred += 1;
      failures.set(
        candidate.candidateId,
        nextInstructionApplyFailure(
          previous.get(candidate.candidateId),
          instructionApplyFailureCode(error),
          input.now().toISOString(),
        ),
      );
    }
  }
  // Recording is diagnostic only; failing to write it never blocks the next cycle.
  if (failures.size > 0 || previous.size > 0)
    await writeInstructionApplyFailures(input.repositoryRoot, failures).catch(() => undefined);
  return result;
}
