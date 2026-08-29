import { ContextSelectionAccumulator } from "./accumulator.js";
import { managedLinkedEvidenceDefaultPolicy } from "./managed-linked-evidence-canary.js";
import { applyManagedLinkedEvidenceSelections } from "./managed-linked-evidence-selection.js";
import type { ContextDocumentCandidate, ManagedLinkedEvidenceSelection } from "./types.js";

export function applyDefaultManagedLinkedEvidenceSelections(input: {
  selections: readonly ManagedLinkedEvidenceSelection[];
  candidates: ReadonlyMap<string, ContextDocumentCandidate>;
  accumulator: ContextSelectionAccumulator;
}): void {
  applyManagedLinkedEvidenceSelections({
    selections: input.selections,
    candidates: input.candidates,
    accumulator: new ContextSelectionAccumulator(),
  });
  for (const selection of input.selections) {
    input.accumulator.select({
      candidate: input.candidates.get(selection.documentId)!,
      reason: {
        reasonCode: "explicit_link",
        ruleId: `${managedLinkedEvidenceDefaultPolicy.selectionRuleId}:${selection.selectionAttemptId}`,
      },
      referenceEligible: false,
      expectedContentHash: selection.contentHash,
    });
  }
}
