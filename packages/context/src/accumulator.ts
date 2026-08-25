import type { SelectionReasonCode } from "@lervo/schemas";

import {
  type ContextDocumentCandidate,
  ContextPreparationError,
  type ContextSelectionReason,
  type PlannedContextDocument,
} from "./types.js";
import { compareCanonicalText } from "./paths.js";

const reasonOrder: Record<SelectionReasonCode, number> = {
  explicit_instruction: 0,
  parent_instruction: 1,
  role_required: 2,
  path_rule: 3,
  explicit_link: 4,
  handoff: 5,
  search_recommendation: 6,
  graph_recommendation: 7,
};

interface MutablePlannedDocument {
  candidate: ContextDocumentCandidate;
  reasons: ContextSelectionReason[];
  sharedContextIds: string[];
  expectedContentHash?: string;
}

export class ContextSelectionAccumulator {
  private readonly selected = new Map<string, MutablePlannedDocument>();
  private readonly discovered = new Map<string, ContextDocumentCandidate>();

  discover(candidate: ContextDocumentCandidate): void {
    this.discovered.set(candidate.documentId, candidate);
  }

  select(input: {
    candidate: ContextDocumentCandidate;
    reason: ContextSelectionReason;
    sharedContextId?: string;
    expectedContentHash?: string;
  }): void {
    this.discover(input.candidate);
    const document = this.selected.get(input.candidate.documentId) ?? {
      candidate: input.candidate,
      reasons: [],
      sharedContextIds: [],
    };
    if (
      input.expectedContentHash !== undefined &&
      document.expectedContentHash !== undefined &&
      document.expectedContentHash !== input.expectedContentHash
    ) {
      throw new ContextPreparationError(
        "content_expectation_conflict",
        `Different content hashes were required for ${input.candidate.documentId}.`,
      );
    }
    if (input.expectedContentHash !== undefined) {
      document.expectedContentHash = input.expectedContentHash;
    }
    if (
      !document.reasons.some(
        (existing) =>
          existing.reasonCode === input.reason.reasonCode &&
          existing.ruleId === input.reason.ruleId,
      )
    ) {
      document.reasons.push(input.reason);
    }
    if (
      input.sharedContextId !== undefined &&
      !document.sharedContextIds.includes(input.sharedContextId)
    ) {
      document.sharedContextIds.push(input.sharedContextId);
    }
    this.selected.set(input.candidate.documentId, document);
  }

  discoveries(): ContextDocumentCandidate[] {
    return [...this.discovered.values()].sort((left, right) =>
      compareCanonicalText(left.path, right.path),
    );
  }

  documents(): PlannedContextDocument[] {
    return [...this.selected.values()]
      .map((document) => {
        const common = {
          documentId: document.candidate.documentId,
          path: document.candidate.path,
          required: true as const,
          scope: { kind: "full" as const },
          reasons: [...document.reasons].sort(
            (left, right) =>
              reasonOrder[left.reasonCode] - reasonOrder[right.reasonCode] ||
              compareCanonicalText(left.ruleId, right.ruleId),
          ),
          sharedContextIds: [...document.sharedContextIds].sort(),
          ...(document.candidate.knowledgeContext === undefined
            ? {}
            : { knowledgeContext: structuredClone(document.candidate.knowledgeContext) }),
        };
        return document.expectedContentHash === undefined
          ? common
          : { ...common, expectedContentHash: document.expectedContentHash };
      })
      .sort((left, right) => compareCanonicalText(left.path, right.path));
  }
}
