import { SHA256_PATTERN, SOURCE_ID_PATTERN, safeRepositoryPath } from "@lervo/search";

import { ContextSelectionAccumulator } from "./accumulator.js";
import {
  type ContextDocumentCandidate,
  ContextPreparationError,
  type ManagedLinkedEvidenceSelection,
} from "./types.js";

const MAXIMUM_SELECTIONS = 8;
const ATTEMPT_ID_PATTERN = /^lsel_[a-f0-9]{24}$/u;

function invalid(message: string): never {
  throw new ContextPreparationError("invalid_context_plan", message);
}

export function applyManagedLinkedEvidenceSelections(input: {
  selections: readonly ManagedLinkedEvidenceSelection[];
  candidates: ReadonlyMap<string, ContextDocumentCandidate>;
  accumulator: ContextSelectionAccumulator;
}): void {
  if (input.selections.length > MAXIMUM_SELECTIONS) {
    invalid("The managed linked-evidence selection limit was exceeded.");
  }
  const documentIds = new Set<string>();
  const attemptIds = new Set<string>();
  for (const [index, selection] of input.selections.entries()) {
    if (
      selection.schemaVersion !== 1 ||
      selection.rank !== index + 1 ||
      !ATTEMPT_ID_PATTERN.test(selection.selectionAttemptId) ||
      !SOURCE_ID_PATTERN.test(selection.documentId) ||
      !safeRepositoryPath(selection.path) ||
      !SHA256_PATTERN.test(selection.contentHash) ||
      documentIds.has(selection.documentId)
    ) {
      invalid("A managed linked-evidence selection is invalid or duplicated.");
    }
    documentIds.add(selection.documentId);
    attemptIds.add(selection.selectionAttemptId);
    const candidate = input.candidates.get(selection.documentId);
    if (candidate === undefined || candidate.path !== selection.path) {
      invalid("A managed linked-evidence selection does not match a registered document.");
    }
    input.accumulator.select({
      candidate,
      reason: {
        reasonCode: "explicit_link",
        ruleId: `linked_evidence_canary:${selection.selectionAttemptId}`,
      },
      referenceEligible: false,
      expectedContentHash: selection.contentHash,
    });
  }
  if (attemptIds.size > 1) {
    invalid("Managed linked-evidence selections must share one selection attempt.");
  }
}
